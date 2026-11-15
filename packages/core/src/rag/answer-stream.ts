import { type ModelMessage, Output, streamText } from "ai";
import type { Llm, ModelTier } from "../llm/provider";
import { SUPPORT_SYSTEM_PROMPT } from "../prompts/system";
import {
  type CitedAnswer,
  type GenerateAnswerOptions,
  type ModelAnswer,
  type Source,
  answerSchema,
  buildUserPrompt,
  finalizeAnswer,
  generateCitedAnswer,
  labelSources,
} from "./answer";
import type { RetrievedChunk } from "./search";

export type AnswerStreamEvent = { type: "token"; text: string } | { type: "final"; answer: CitedAnswer };

export interface StructuredStreamRequest {
  llm: Llm;
  tier: ModelTier;
  system: string;
  input: { prompt: string } | { messages: ModelMessage[] };
  sources: Source[];
  /** Used when the streamed output doesn't validate; should be the blocking path with its repair retry. */
  fallback: () => Promise<CitedAnswer>;
  groundedByTools?: boolean;
  /** Tokens already spent on earlier steps, added to this call's usage. */
  priorUsage?: { inputTokens: number; outputTokens: number };
  signal?: AbortSignal;
}

/**
 * Streams the `answer` field of the structured output as text deltas, then yields the final,
 * citation-resolved answer. If the model's output doesn't validate, falls back to the blocking
 * path; the caller then just gets the final event.
 */
export async function* streamStructuredAnswer(
  req: StructuredStreamRequest,
): AsyncGenerator<AnswerStreamEvent> {
  const { llm, tier, sources, signal } = req;
  const started = performance.now();
  let failed = false;
  const result = streamText({
    model: llm.model(tier),
    system: req.system,
    ...req.input,
    output: Output.object({ schema: answerSchema, name: "SupportAnswer" }),
    temperature: 0,
    providerOptions: llm.providerOptions,
    abortSignal: signal,
    onError: () => {
      failed = true;
    },
  });

  let streamed = "";
  for await (const partial of result.partialOutputStream) {
    const text = typeof partial.answer === "string" ? partial.answer : "";
    if (text.length > streamed.length && text.startsWith(streamed)) {
      yield { type: "token", text: text.slice(streamed.length) };
      streamed = text;
    }
  }

  let output: ModelAnswer;
  try {
    if (failed) throw new Error("stream failed");
    output = await result.output;
  } catch {
    if (signal?.aborted) return;
    yield { type: "final", answer: await req.fallback() };
    return;
  }
  const usage = await result.usage;
  yield {
    type: "final",
    answer: finalizeAnswer(
      output,
      sources,
      {
        model: llm.modelId(tier),
        usage: {
          inputTokens: (req.priorUsage?.inputTokens ?? 0) + (usage.inputTokens ?? 0),
          outputTokens: (req.priorUsage?.outputTokens ?? 0) + (usage.outputTokens ?? 0),
        },
        latencyMs: Math.round(performance.now() - started),
        attempts: 1,
      },
      { groundedByTools: req.groundedByTools },
    ),
  };
}

/** Single-shot RAG streaming: the sources are already retrieved and put in the prompt. */
export function streamCitedAnswer(
  llm: Llm,
  question: string,
  chunks: RetrievedChunk[],
  { tier = "large" }: GenerateAnswerOptions = {},
  signal?: AbortSignal,
): AsyncGenerator<AnswerStreamEvent> {
  const sources = labelSources(chunks);
  return streamStructuredAnswer({
    llm,
    tier,
    system: SUPPORT_SYSTEM_PROMPT,
    input: { prompt: buildUserPrompt(question, sources) },
    sources,
    fallback: () => generateCitedAnswer(llm, question, chunks, { tier }),
    signal,
  });
}
