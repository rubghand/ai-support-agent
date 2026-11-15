import { type SQL, sql } from "drizzle-orm";
import {
  customType,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  vector,
} from "drizzle-orm/pg-core";

export const EMBEDDING_DIMENSIONS = 384;

const tsvector = customType<{ data: string }>({
  dataType: () => "tsvector",
});

// ---------- Knowledge base ----------

export const documents = pgTable("documents", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  url: text("url").notNull().unique(),
  category: text("category").notNull(),
  updatedOn: date("updated_on", { mode: "date" }).notNull(),
  contentHash: text("content_hash").notNull(),
  ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull().defaultNow(),
});

export const chunks = pgTable(
  "chunks",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    headingPath: text("heading_path").notNull(),
    content: text("content").notNull(),
    tokenCount: integer("token_count").notNull(),
    contentHash: text("content_hash").notNull(),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }).notNull(),
    tsv: tsvector("tsv")
      .notNull()
      .generatedAlwaysAs(
        (): SQL =>
          sql`setweight(to_tsvector('english', ${chunks.headingPath}), 'A') || setweight(to_tsvector('english', ${chunks.content}), 'B')`,
      ),
  },
  (t) => [
    index("chunks_document_id_idx").on(t.documentId),
    index("chunks_content_hash_idx").on(t.contentHash),
    index("chunks_embedding_hnsw_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
    index("chunks_tsv_gin_idx").using("gin", t.tsv),
  ],
);

// ---------- Fake product data (what the support tools will act on) ----------

export const planEnum = pgEnum("plan", ["free", "starter", "growth", "scale"]);
export const billingCycleEnum = pgEnum("billing_cycle", ["monthly", "annual"]);
export const orderKindEnum = pgEnum("order_kind", ["plan", "addon"]);
export const orderStatusEnum = pgEnum("order_status", ["paid", "pending", "failed", "refunded"]);
export const ticketStatusEnum = pgEnum("ticket_status", ["open", "pending", "closed"]);
export const ticketPriorityEnum = pgEnum("ticket_priority", ["low", "normal", "high", "urgent"]);

export const customers = pgTable("customers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  company: text("company").notNull(),
  plan: planEnum("plan").notNull(),
  billingCycle: billingCycleEnum("billing_cycle").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

export const orders = pgTable(
  "orders",
  {
    id: text("id").primaryKey(),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id),
    kind: orderKindEnum("kind").notNull(),
    item: text("item").notNull(),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("USD"),
    status: orderStatusEnum("status").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("orders_customer_id_idx").on(t.customerId)],
);

export const tickets = pgTable(
  "tickets",
  {
    id: serial("id").primaryKey(),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    status: ticketStatusEnum("status").notNull().default("open"),
    priority: ticketPriorityEnum("priority").notNull().default("normal"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("tickets_customer_id_idx").on(t.customerId)],
);

// ---------- Chat ----------

export const messageRoleEnum = pgEnum("message_role", ["user", "assistant"]);

export const conversations = pgTable("conversations", {
  id: text("id").primaryKey(),
  /** Owner; only this user may read or append to the conversation. */
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const messages = pgTable(
  "messages",
  {
    id: serial("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: messageRoleEnum("role").notNull(),
    content: text("content").notNull(),
    /** Assistant messages only: resolved citations, confidence, model, usage, latency. */
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("messages_conversation_id_idx").on(t.conversationId, t.id)],
);

// ---------- Auth + rate limiting ----------

export const userRoleEnum = pgEnum("user_role", ["customer", "admin"]);

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: userRoleEnum("role").notNull(),
  /** Set for customers; the identity every support tool will act on. Null for admins. */
  customerId: text("customer_id").references(() => customers.id),
});

export const rateLimits = pgTable("rate_limits", {
  /** e.g. `chat:user:3` or `chat:ip:203.0.113.9`. */
  key: text("key").primaryKey(),
  tokens: doublePrecision("tokens").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

// ---------- Actions: refunds and audit trail ----------

export const refundStatusEnum = pgEnum("refund_status", ["requested", "approved", "rejected"]);

/**
 * An issued refund. Rows are created only when staff approve a `request_refund` action; the request
 * itself lives in `pending_actions` until then. (`requested`/`rejected` are kept for the enum's history.)
 */
export const refunds = pgTable(
  "refunds",
  {
    id: serial("id").primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id),
    amountCents: integer("amount_cents").notNull(),
    reason: text("reason").notNull(),
    status: refundStatusEnum("status").notNull().default("requested"),
    requestedByUserId: integer("requested_by_user_id").references(() => users.id, { onDelete: "set null" }),
    decidedByUserId: integer("decided_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (t) => [
    // At most one live (requested or approved) refund per order, enforced by the database.
    uniqueIndex("refunds_one_live_per_order_idx")
      .on(t.orderId)
      .where(sql`${t.status} in ('requested', 'approved')`),
  ],
);

/** Append-only record of who did what; written in the same transaction as the change it describes. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: serial("id").primaryKey(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    actorUserId: integer("actor_user_id"),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [index("audit_log_target_idx").on(t.targetType, t.targetId)],
);

// ---------- Human-in-the-loop approvals ----------

/**
 * `approved` means a staff member claimed the action and it is executing; it ends as `executed` or
 * `failed` (the tool's re-check or execution refused it). `rejected` actions never run.
 */
export const actionStatusEnum = pgEnum("action_status", [
  "pending",
  "approved",
  "rejected",
  "executed",
  "failed",
]);

/** A high-risk tool call that waits for a human decision before it runs. */
export const pendingActions = pgTable(
  "pending_actions",
  {
    id: serial("id").primaryKey(),
    toolName: text("tool_name").notNull(),
    /** Validated tool input, replayed on approval. */
    args: jsonb("args").$type<Record<string, unknown>>().notNull(),
    /** What the approver is asked to approve, e.g. "Refund $29.00 for order ORD-1042 (Priority support)". */
    summary: text("summary").notNull(),
    /** What the action targets, e.g. `order:ORD-1042`. */
    subjectKey: text("subject_key").notNull(),
    requestedByUserId: integer("requested_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Where to notify the customer; null for calls from external MCP clients. */
    conversationId: text("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
    status: actionStatusEnum("status").notNull().default("pending"),
    decidedByUserId: integer("decided_by_user_id").references(() => users.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    /** Optional note from staff, shown to the customer. */
    decisionNote: text("decision_note"),
    /** Tool result after execution: `{ ok, data }` or `{ ok: false, error }`. */
    result: jsonb("result").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One open action per tool and subject, so duplicate or concurrent requests are decided by the database.
    uniqueIndex("pending_actions_one_open_idx")
      .on(t.toolName, t.subjectKey)
      .where(sql`${t.status} in ('pending', 'approved')`),
    index("pending_actions_status_idx").on(t.status, t.createdAt),
  ],
);
