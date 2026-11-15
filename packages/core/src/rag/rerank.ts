import { AutoModelForSequenceClassification, AutoTokenizer } from "@huggingface/transformers";
import type { RetrievedChunk } from "./search";

export const RERANKER_MODEL = "Xenova/bge-reranker-base";

/** Scores how well each document answers the query, jointly (a cross-encoder), higher is better. */
export interface Reranker {
  model: string;
  score(query: string, documents: string[]): Promise<number[]>;
}

export interface RerankOptions {
  /** Chunks kept after reranking. */
  k?: number;
}

/**
 * Reorders `chunks` by cross-encoder score and keeps the best `k`. Ties keep the incoming (fused) order,
 * so a reranker that returns equal scores changes nothing.
 */
export async function rerankChunks(
  reranker: Reranker,
  query: string,
  chunks: RetrievedChunk[],
  { k = 5 }: RerankOptions = {},
): Promise<RetrievedChunk[]> {
  if (chunks.length === 0) return [];
  const scores = await reranker.score(
    query,
    chunks.map((c) => `${c.title} - ${c.headingPath}\n${c.content}`),
  );
  if (scores.length !== chunks.length) {
    throw new Error(`Reranker returned ${scores.length} scores for ${chunks.length} chunks`);
  }
  return chunks
    .map((chunk, index) => ({ chunk, index, rerankScore: scores[index]! }))
    .sort((a, b) => b.rerankScore - a.rerankScore || a.index - b.index)
    .slice(0, k)
    .map(({ chunk, rerankScore }) => ({ ...chunk, rerankScore }));
}

const BATCH_SIZE = 8;
const MAX_LENGTH = 512;

let loaded:
  | Promise<{
      tokenizer: Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>>;
      model: Awaited<ReturnType<typeof AutoModelForSequenceClassification.from_pretrained>>;
    }>
  | undefined;

function load() {
  loaded ??= Promise.all([
    AutoTokenizer.from_pretrained(RERANKER_MODEL),
    AutoModelForSequenceClassification.from_pretrained(RERANKER_MODEL, { dtype: "q8" }),
  ]).then(([tokenizer, model]) => ({ tokenizer, model }));
  return loaded;
}

/** Local, free cross-encoder (bge-reranker-base, 8-bit ONNX) running in-process. */
export function createLocalReranker(): Reranker {
  return {
    model: RERANKER_MODEL,
    async score(query, documents) {
      const { tokenizer, model } = await load();
      const scores: number[] = [];
      for (let i = 0; i < documents.length; i += BATCH_SIZE) {
        const batch = documents.slice(i, i + BATCH_SIZE);
        const inputs = tokenizer(new Array<string>(batch.length).fill(query), {
          text_pair: batch,
          padding: true,
          truncation: true,
          max_length: MAX_LENGTH,
        });
        const { logits } = await model(inputs);
        scores.push(...(logits.tolist() as number[][]).map((row) => row[0]!));
      }
      return scores;
    },
  };
}
