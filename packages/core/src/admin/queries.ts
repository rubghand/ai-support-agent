import { type Db, conversations, messageFeedback, messages, spans, traces, users } from "@app/db";
import { asc, desc, eq, sql } from "drizzle-orm";

export interface DailyStat {
  day: string;
  requests: number;
  errors: number;
  avgLatencyMs: number;
  projectedCostUsd: number;
}

export interface DashboardStats {
  days: number;
  totals: {
    conversations: number;
    requests: number;
    errors: number;
    avgLatencyMs: number;
    p95LatencyMs: number;
    projectedCostUsd: number;
    inputTokens: number;
    outputTokens: number;
  };
  daily: DailyStat[];
  /** Agent (answer-generating) calls by model tier: the routing split. */
  routing: { tier: string; model: string; calls: number; projectedCostUsd: number }[];
  /** Model calls by purpose (guard, route, summary, agent). */
  purposes: { purpose: string; calls: number; avgLatencyMs: number; projectedCostUsd: number }[];
  feedback: { up: number; down: number };
}

const num = (value: unknown) => Number(value ?? 0);

/** Aggregates over the last `days` days (UTC day buckets); days with no traffic are filled with zeros. */
export async function getDashboardStats(db: Db, days = 14): Promise<DashboardStats> {
  const since = sql`now() - make_interval(days => ${days})`;
  const [traceTotals, callTotals, convoTotals, dailyTraces, dailyCalls, routing, purposes, feedback] =
    await Promise.all([
      db.execute<{ n: string; errors: string; avg: string; p95: string }>(sql`
        select count(*) n, count(*) filter (where status = 'error') errors,
          coalesce(avg(duration_ms), 0) avg,
          coalesce(percentile_cont(0.95) within group (order by duration_ms), 0) p95
        from traces where started_at >= ${since}`),
      db.execute<{ cost: string; inp: string; outp: string }>(sql`
        select coalesce(sum(projected_cost_usd), 0) cost, coalesce(sum(input_tokens), 0) inp,
          coalesce(sum(output_tokens), 0) outp
        from llm_calls where created_at >= ${since}`),
      db.execute<{ n: string }>(sql`select count(*) n from conversations where created_at >= ${since}`),
      db.execute<{ day: string; n: string; errors: string; avg: string }>(sql`
        select to_char(date_trunc('day', started_at at time zone 'UTC'), 'YYYY-MM-DD') as day, count(*) n,
          count(*) filter (where status = 'error') errors, coalesce(avg(duration_ms), 0) avg
        from traces where started_at >= ${since} group by 1`),
      db.execute<{ day: string; cost: string }>(sql`
        select to_char(date_trunc('day', created_at at time zone 'UTC'), 'YYYY-MM-DD') as day,
          sum(projected_cost_usd) cost
        from llm_calls where created_at >= ${since} group by 1`),
      db.execute<{ tier: string; model: string; n: string; cost: string }>(sql`
        select tier, model, count(*) n, sum(projected_cost_usd) cost
        from llm_calls where purpose = 'agent' and created_at >= ${since} group by 1, 2 order by 3 desc`),
      db.execute<{ purpose: string; n: string; avg: string; cost: string }>(sql`
        select purpose, count(*) n, avg(latency_ms) avg, sum(projected_cost_usd) cost
        from llm_calls where created_at >= ${since} group by 1 order by 2 desc`),
      db.execute<{ rating: string; n: string }>(sql`
        select rating, count(*) n from message_feedback where created_at >= ${since} group by 1`),
    ]);

  const traceRow = traceTotals.rows[0]!;
  const callRow = callTotals.rows[0]!;
  const tracesByDay = new Map(dailyTraces.rows.map((r) => [r.day, r]));
  const costByDay = new Map(dailyCalls.rows.map((r) => [r.day, num(r.cost)]));
  const today = new Date();
  const daily: DailyStat[] = Array.from({ length: days }, (_, i) => {
    const date = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - (days - 1 - i)),
    );
    const day = date.toISOString().slice(0, 10);
    const t = tracesByDay.get(day);
    return {
      day,
      requests: num(t?.n),
      errors: num(t?.errors),
      avgLatencyMs: Math.round(num(t?.avg)),
      projectedCostUsd: costByDay.get(day) ?? 0,
    };
  });
  const rating = (r: string) => num(feedback.rows.find((row) => row.rating === r)?.n);

  return {
    days,
    totals: {
      conversations: num(convoTotals.rows[0]?.n),
      requests: num(traceRow.n),
      errors: num(traceRow.errors),
      avgLatencyMs: Math.round(num(traceRow.avg)),
      p95LatencyMs: Math.round(num(traceRow.p95)),
      projectedCostUsd: num(callRow.cost),
      inputTokens: num(callRow.inp),
      outputTokens: num(callRow.outp),
    },
    daily,
    routing: routing.rows.map((r) => ({
      tier: r.tier,
      model: r.model,
      calls: num(r.n),
      projectedCostUsd: num(r.cost),
    })),
    purposes: purposes.rows.map((r) => ({
      purpose: r.purpose,
      calls: num(r.n),
      avgLatencyMs: Math.round(num(r.avg)),
      projectedCostUsd: num(r.cost),
    })),
    feedback: { up: rating("up"), down: rating("down") },
  };
}

export interface ConversationSummary {
  id: string;
  userEmail: string;
  createdAt: Date;
  lastMessageAt: Date | null;
  messageCount: number;
  projectedCostUsd: number;
  thumbsUp: number;
  thumbsDown: number;
  /** First user message, as a preview. */
  firstQuestion: string | null;
}

export async function listConversations(
  db: Db,
  { limit = 50, offset = 0 } = {},
): Promise<ConversationSummary[]> {
  const result = await db.execute<{
    id: string;
    email: string;
    created_at: Date;
    last_at: Date | null;
    msgs: string;
    cost: string;
    up: string;
    down: string;
    first_q: string | null;
  }>(sql`
    select c.id, u.email, c.created_at,
      (select max(m.created_at) from messages m where m.conversation_id = c.id) as last_at,
      (select count(*) from messages m where m.conversation_id = c.id) msgs,
      (select coalesce(sum(l.projected_cost_usd), 0) from llm_calls l where l.conversation_id = c.id) cost,
      (select count(*) from message_feedback f join messages m on m.id = f.message_id
        where m.conversation_id = c.id and f.rating = 'up') as up,
      (select count(*) from message_feedback f join messages m on m.id = f.message_id
        where m.conversation_id = c.id and f.rating = 'down') as down,
      (select m.content from messages m where m.conversation_id = c.id and m.role = 'user'
        order by m.id limit 1) first_q
    from conversations c join users u on u.id = c.user_id
    order by last_at desc nulls last, c.created_at desc
    limit ${limit} offset ${offset}`);
  return result.rows.map((r) => ({
    id: r.id,
    userEmail: r.email,
    createdAt: new Date(r.created_at),
    lastMessageAt: r.last_at ? new Date(r.last_at) : null,
    messageCount: num(r.msgs),
    projectedCostUsd: num(r.cost),
    thumbsUp: num(r.up),
    thumbsDown: num(r.down),
    firstQuestion: r.first_q,
  }));
}

export interface ConversationMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  createdAt: Date;
  metadata: Record<string, unknown> | null;
  traceId: string | null;
  rating: "up" | "down" | null;
}

export interface ConversationDetail {
  id: string;
  userEmail: string;
  createdAt: Date;
  summary: string | null;
  messages: ConversationMessage[];
}

export async function getConversationDetail(db: Db, id: string): Promise<ConversationDetail | null> {
  const [convo] = await db
    .select({
      id: conversations.id,
      userEmail: users.email,
      createdAt: conversations.createdAt,
      summary: conversations.summary,
    })
    .from(conversations)
    .innerJoin(users, eq(users.id, conversations.userId))
    .where(eq(conversations.id, id));
  if (!convo) return null;
  const rows = await db
    .select({ message: messages, rating: messageFeedback.rating })
    .from(messages)
    .leftJoin(messageFeedback, eq(messageFeedback.messageId, messages.id))
    .where(eq(messages.conversationId, id))
    .orderBy(asc(messages.id));
  return {
    ...convo,
    messages: rows.map(({ message, rating }) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      createdAt: message.createdAt,
      metadata: message.metadata,
      traceId: typeof message.metadata?.traceId === "string" ? message.metadata.traceId : null,
      rating,
    })),
  };
}

export async function getTraceDetail(db: Db, id: string) {
  const [trace] = await db.select().from(traces).where(eq(traces.id, id));
  if (!trace) return null;
  const rows = await db.select().from(spans).where(eq(spans.traceId, id)).orderBy(asc(spans.startedAt));
  return { trace, spans: rows };
}

export async function listRecentTraces(db: Db, limit = 20) {
  return db.select().from(traces).orderBy(desc(traces.startedAt)).limit(limit);
}
