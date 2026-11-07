import { type SQL, sql } from "drizzle-orm";
import {
  customType,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
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
