import { type FeatureExtractionPipeline, pipeline } from "@huggingface/transformers";

export const EMBEDDING_MODEL = "Xenova/bge-small-en-v1.5";

/** bge models are trained to embed queries with this instruction; documents are embedded as-is. */
const QUERY_INSTRUCTION = "Represent this sentence for searching relevant passages: ";
const BATCH_SIZE = 16;

export interface Embedder {
  model: string;
  dimensions: number;
  embedDocuments(texts: string[]): Promise<number[][]>;
  embedQuery(text: string): Promise<number[]>;
}

let extractor: Promise<FeatureExtractionPipeline> | undefined;

function getExtractor(): Promise<FeatureExtractionPipeline> {
  extractor ??= pipeline("feature-extraction", EMBEDDING_MODEL, { dtype: "fp32" });
  return extractor;
}

async function embed(texts: string[]): Promise<number[][]> {
  const run = await getExtractor();
  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const output = await run(texts.slice(i, i + BATCH_SIZE), { pooling: "cls", normalize: true });
    vectors.push(...(output.tolist() as number[][]));
  }
  return vectors;
}

/** Local, free embeddings (384 dimensions) running in-process via ONNX. */
export function createLocalEmbedder(): Embedder {
  return {
    model: EMBEDDING_MODEL,
    dimensions: 384,
    embedDocuments: (texts) => embed(texts),
    embedQuery: async (text) => (await embed([QUERY_INSTRUCTION + text]))[0]!,
  };
}
