import { Output, streamText } from "ai";
import type { Llm } from "../llm/provider";
import { SUPPORT_SYSTEM_PROMPT } from "../prompts/system";
import {
  type CitedAnswer,
  type GenerateAnswerOptions,
  answerSchema,
  buildUserPrompt,
  finalizeAnswer,
  generateCitedAnswer,
  labelSources,
} from "./answer";
import type { RetrievedChunk } from "./search";

export type AnswerStreamEvent = { type: "token"; text: string } | { type: "final"; answer: CitedAnswer };

/**
 * Streams the `answer` field of the structured output as text deltas, then yields the final,
 * citation-resolved answer. If the model's output doesn't validate, falls back to the blocking
 * path (which has its own repair retry); the caller then just gets the final event.
 */
export async function* streamCitedAnswer(
  llm: Llm,
  question: string,
  chunks: RetrievedChunk[],
  { tier = "large" }: GenerateAnswerOptions = {},
  signal?: AbortSignal,
): AsyncGenerator<AnswerStreamEvent> {
  const sources = labelSources(chunks);
  const started = performance.now();
  let failed = false;
  const result = streamText({
    model: llm.model(tier),
    system: SUPPORT_SYSTEM_PROMPT,
    prompt: buildUserPrompt(question, sources),
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

  let output;
  try {
    if (failed) throw new Error("stream failed");
    output = await result.output;
  } catch {
    if (signal?.aborted) return;
    yield { type: "final", answer: await generateCitedAnswer(llm, question, chunks, { tier }) };
    return;
  }
  const usage = await result.usage;
  yield {
    type: "final",
    answer: finalizeAnswer(output, sources, {
      model: llm.modelId(tier),
      usage: { inputTokens: usage.inputTokens ?? 0, outputTokens: usage.outputTokens ?? 0 },
      latencyMs: Math.round(performance.now() - started),
      attempts: 1,
    }),
  };
}
