import { createHash } from "node:crypto";
import type { Embedder } from "../rag/embed";

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://agent:agent@localhost:5455/agent_test";

/** Deterministic embedder for tests: no model download; counts how many documents it embedded. */
export function fakeEmbedder(): Embedder & { calls: number } {
  const vectorFor = (text: string) => {
    const bytes = createHash("sha256").update(text).digest();
    const raw = Array.from({ length: 384 }, (_, i) => bytes[i % bytes.length]! - 128);
    const norm = Math.hypot(...raw);
    return raw.map((v) => v / norm);
  };
  const embedder = {
    model: "fake",
    dimensions: 384,
    calls: 0,
    embedDocuments: async (texts: string[]) => {
      embedder.calls += texts.length;
      return texts.map(vectorFor);
    },
    embedQuery: async (text: string) => vectorFor(text),
  };
  return embedder;
}
