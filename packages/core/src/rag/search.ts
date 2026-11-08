import { type Db, chunks, documents } from "@app/db";
import { eq, inArray, sql } from "drizzle-orm";
import type { Embedder } from "./embed";

export type RetrievalMode = "hybrid" | "vector" | "keyword";
export type KeywordScoring = "ts_rank" | "idf";

export interface RetrieveOptions {
  /** Number of chunks returned. */
  k?: number;
  /** Candidates fetched from each retriever before fusion. */
  candidates?: number;
  mode?: RetrievalMode;
  keywordScoring?: KeywordScoring;
  /** Relative weight of each retriever in the fusion. */
  weights?: { vector: number; keyword: number };
  /** RRF damping constant; 60 is the value from the original paper and a common default. */
  rrfK?: number;
}

export const DEFAULT_RETRIEVE_OPTIONS: Required<RetrieveOptions> = {
  k: 5,
  candidates: 20,
  mode: "hybrid",
  keywordScoring: "idf",
  weights: { vector: 1, keyword: 1 },
  rrfK: 60,
};

export interface RetrievedChunk {
  chunkId: string;
  documentId: string;
  title: string;
  url: string;
  headingPath: string;
  content: string;
  updatedOn: Date;
  score: number;
  /** 1-based rank in each retriever's list, or null if that retriever didn't return the chunk. */
  vectorRank: number | null;
  keywordRank: number | null;
}

export interface RankedList {
  ids: string[];
  weight?: number;
}

/**
 * Weighted Reciprocal Rank Fusion: score(id) = Σ weight / (rrfK + rank) over every list containing the id.
 * Uses only ranks, so scores from different retrievers (cosine vs ts_rank) never need calibrating.
 */
export function reciprocalRankFusion(lists: RankedList[], rrfK = 60): Array<{ id: string; score: number }> {
  const scores = new Map<string, number>();
  for (const { ids, weight = 1 } of lists) {
    ids.forEach((id, index) => scores.set(id, (scores.get(id) ?? 0) + weight / (rrfK + index + 1)));
  }
  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

async function vectorSearch(db: Db, embedding: number[], limit: number): Promise<string[]> {
  const result = await db.execute<{ id: string }>(sql`
    SELECT id FROM chunks
    ORDER BY embedding <=> ${JSON.stringify(embedding)}::vector
    LIMIT ${limit}`);
  return result.rows.map((row) => row.id);
}

/**
 * Full-text search with OR semantics: plainto_tsquery ANDs every word, which almost never matches a
 * natural-language question, so the '&' operators are rewritten to '|' and ts_rank_cd does the ordering.
 */
async function keywordSearchTsRank(db: Db, query: string, limit: number): Promise<string[]> {
  const result = await db.execute<{ id: string }>(sql`
    WITH q AS (
      SELECT replace(plainto_tsquery('english', ${query})::text, '&', '|')::tsquery AS query
    )
    SELECT c.id FROM chunks c, q
    WHERE q.query <> ''::tsquery AND c.tsv @@ q.query
    ORDER BY ts_rank_cd(c.tsv, q.query) DESC, c.id
    LIMIT ${limit}`);
  return result.rows.map((row) => row.id);
}

/** Extra weight for a query term that appears in a chunk's heading trail (tsvector weight A). */
const HEADING_BOOST = 1.5;

/**
 * Keyword search scored like BM25 with binary term frequency: each matching query term adds its
 * inverse document frequency, so rare terms ("429", "SEPA") outweigh common ones ("plan", "error").
 * Document frequencies come from ts_stat over all chunks, which is fine for a few thousand chunks;
 * a large corpus would keep them in a precomputed table instead.
 */
async function keywordSearchIdf(db: Db, query: string, limit: number): Promise<string[]> {
  const result = await db.execute<{ id: string }>(sql`
    WITH terms AS (
      SELECT DISTINCT unnest(tsvector_to_array(to_tsvector('english', ${query}))) AS term
    ),
    stats AS (
      SELECT word AS term, ndoc FROM ts_stat('SELECT tsv FROM chunks')
      WHERE word IN (SELECT term FROM terms)
    ),
    total AS (SELECT count(*)::float AS n FROM chunks)
    SELECT c.id
    FROM chunks c, stats s, total
    WHERE c.tsv @@ quote_literal(s.term)::tsquery
    GROUP BY c.id
    ORDER BY sum(
      ln(1 + (total.n - s.ndoc + 0.5) / (s.ndoc + 0.5))
      * CASE WHEN c.tsv @@ (quote_literal(s.term) || ':A')::tsquery THEN ${HEADING_BOOST}::float ELSE 1 END
    ) DESC, c.id
    LIMIT ${limit}`);
  return result.rows.map((row) => row.id);
}

export async function retrieve(
  db: Db,
  embedder: Embedder,
  query: string,
  options: RetrieveOptions = {},
): Promise<RetrievedChunk[]> {
  const { k, candidates, mode, keywordScoring, weights, rrfK } = { ...DEFAULT_RETRIEVE_OPTIONS, ...options };
  const keywordSearch = keywordScoring === "idf" ? keywordSearchIdf : keywordSearchTsRank;

  const [vectorIds, keywordIds] = await Promise.all([
    mode === "keyword" ? [] : embedder.embedQuery(query).then((v) => vectorSearch(db, v, candidates)),
    mode === "vector" ? [] : keywordSearch(db, query, candidates),
  ]);

  const fused = reciprocalRankFusion(
    [
      { ids: vectorIds, weight: weights.vector },
      { ids: keywordIds, weight: weights.keyword },
    ],
    rrfK,
  ).slice(0, k);
  if (fused.length === 0) return [];

  const rows = await db
    .select({
      chunkId: chunks.id,
      documentId: chunks.documentId,
      title: documents.title,
      url: documents.url,
      headingPath: chunks.headingPath,
      content: chunks.content,
      updatedOn: documents.updatedOn,
    })
    .from(chunks)
    .innerJoin(documents, eq(chunks.documentId, documents.id))
    .where(
      inArray(
        chunks.id,
        fused.map((f) => f.id),
      ),
    );
  const byId = new Map(rows.map((row) => [row.chunkId, row]));
  const rankIn = (list: string[], id: string) => (list.includes(id) ? list.indexOf(id) + 1 : null);

  return fused.flatMap(({ id, score }) => {
    const row = byId.get(id);
    return row
      ? [{ ...row, score, vectorRank: rankIn(vectorIds, id), keywordRank: rankIn(keywordIds, id) }]
      : [];
  });
}
