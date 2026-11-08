import type { Db } from "@app/db";
import { NoObjectGeneratedError, Output, generateText } from "ai";
import { z } from "zod";
import type { Llm, ModelTier } from "../llm/provider";
import { SUPPORT_SYSTEM_PROMPT } from "../prompts/system";
import type { Embedder } from "./embed";
import { type RetrievedChunk, retrieve } from "./search";

export const answerSchema = z.object({
  answer: z.string().trim().min(1).describe("The reply to the customer, with [S1]-style citation markers."),
  citations: z.array(z.string()).describe('Source ids cited in the answer, e.g. ["S1", "S3"].'),
  confidence: z.enum(["high", "medium", "low"]),
  needsHuman: z.boolean().describe("True when a human agent should follow up."),
});

export type ModelAnswer = z.infer<typeof answerSchema>;

export interface Citation {
  label: string;
  chunkId: string;
  documentId: string;
  title: string;
  url: string;
}

export interface CitedAnswer {
  answer: string;
  citations: Citation[];
  confidence: ModelAnswer["confidence"];
  needsHuman: boolean;
  /** Source ids the model cited that were not in the prompt (hallucinated citations). */
  invalidCitations: string[];
  /** True when at least one valid citation backs the answer. */
  grounded: boolean;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
  latencyMs: number;
  /** 1 normally; 2 when the first output failed schema validation and was retried. */
  attempts: number;
}

export type Source = RetrievedChunk & { label: string };

export function labelSources(chunks: RetrievedChunk[]): Source[] {
  return chunks.map((chunk, i) => ({ ...chunk, label: `S${i + 1}` }));
}

const escapeSource = (text: string) => text.replaceAll("</source>", "</ source>");

/** Dynamic part of the prompt: retrieved sources (with dates for conflict handling) and the question. */
export function buildUserPrompt(question: string, sources: Source[]): string {
  const blocks = sources.map(
    (s) =>
      `<source id="${s.label}" title="${s.title}" section="${s.headingPath}" updated="${s.updatedOn.toISOString().slice(0, 10)}">\n${escapeSource(s.content)}\n</source>`,
  );
  return `<sources>\n${blocks.join("\n\n")}\n</sources>\n\n<question>\n${question}\n</question>`;
}

const MARKER = /\[(S\d+)\]/g;

/**
 * Maps the model's source ids back to real chunks. Markers in the answer text count too, because
 * small models often cite inline but forget the "citations" array. Unknown ids are reported, and
 * markers pointing to them are removed from the text.
 */
export function resolveCitations(output: ModelAnswer, sources: Source[]) {
  const byLabel = new Map(sources.map((s) => [s.label, s]));
  const cited = new Set([...output.citations, ...[...output.answer.matchAll(MARKER)].map((m) => m[1]!)]);
  const citations: Citation[] = [];
  const invalidCitations: string[] = [];
  for (const label of [...cited].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))) {
    const source = byLabel.get(label);
    if (!source) {
      invalidCitations.push(label);
      continue;
    }
    const { chunkId, documentId, title, url } = source;
    citations.push({ label, chunkId, documentId, title, url });
  }
  const answer = output.answer
    .replace(MARKER, (marker, label: string) => (byLabel.has(label) ? marker : ""))
    .trim();
  return { answer, citations, invalidCitations };
}

export interface GenerateAnswerOptions {
  tier?: ModelTier;
}

export async function generateCitedAnswer(
  llm: Llm,
  question: string,
  chunks: RetrievedChunk[],
  { tier = "large" }: GenerateAnswerOptions = {},
): Promise<CitedAnswer> {
  const sources = labelSources(chunks);
  const prompt = buildUserPrompt(question, sources);
  const started = performance.now();
  const usage = { inputTokens: 0, outputTokens: 0 };

  const attempt = async (repairNote?: string) => {
    const result = await generateText({
      model: llm.model(tier),
      system: SUPPORT_SYSTEM_PROMPT,
      prompt: repairNote ? `${prompt}\n\n${repairNote}` : prompt,
      output: Output.object({ schema: answerSchema, name: "SupportAnswer" }),
      temperature: 0,
      providerOptions: llm.providerOptions,
    });
    usage.inputTokens += result.usage.inputTokens ?? 0;
    usage.outputTokens += result.usage.outputTokens ?? 0;
    return result.output;
  };

  let attempts = 1;
  let output: ModelAnswer;
  try {
    output = await attempt();
  } catch (error) {
    if (!NoObjectGeneratedError.isInstance(error)) throw error;
    usage.inputTokens += error.usage?.inputTokens ?? 0;
    usage.outputTokens += error.usage?.outputTokens ?? 0;
    attempts = 2;
    output = await attempt(
      "Your previous reply was not valid. Respond with a single JSON object with exactly the keys answer, citations, confidence, needsHuman.",
    );
  }

  const resolved = resolveCitations(output, sources);
  const grounded = resolved.citations.length > 0;
  return {
    ...resolved,
    // An answer with no valid citation can't be trusted, whatever the model claimed.
    confidence: grounded ? output.confidence : "low",
    needsHuman: output.needsHuman,
    grounded,
    model: llm.modelId(tier),
    usage,
    latencyMs: Math.round(performance.now() - started),
    attempts,
  };
}

export interface AnswerDeps {
  db: Db;
  embedder: Embedder;
  llm: Llm;
}

export interface AnswerQuestionOptions extends GenerateAnswerOptions {
  /** Number of retrieved chunks passed to the model. */
  k?: number;
}

/** Full RAG round trip: hybrid retrieval, then a cited, schema-validated answer. */
export async function answerQuestion(
  { db, embedder, llm }: AnswerDeps,
  question: string,
  { k = 5, ...options }: AnswerQuestionOptions = {},
): Promise<CitedAnswer & { retrieved: RetrievedChunk[]; retrievalMs: number }> {
  const started = performance.now();
  const retrieved = await retrieve(db, embedder, question, { k });
  const retrievalMs = Math.round(performance.now() - started);
  return { ...(await generateCitedAnswer(llm, question, retrieved, options)), retrieved, retrievalMs };
}
