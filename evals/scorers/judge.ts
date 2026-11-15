import { type Llm, buildUserPrompt, labelSources, type RetrievedChunk } from "@app/core";
import { Output, generateText } from "ai";
import { z } from "zod";

const verdictSchema = z.object({
  supported: z.boolean().describe("True when every factual claim in the answer is supported by the sources."),
  reason: z.string().describe("One short sentence."),
});

const JUDGE_SYSTEM = `You are a strict fact-checker for a customer-support assistant.
You get SOURCES and an ANSWER. Decide whether every factual claim in the ANSWER (numbers, prices, time limits, policies, steps) is supported by the SOURCES.
- supported=false if any claim is missing from the sources, contradicts them, or follows an outdated source that a newer source replaces.
- Statements like "I don't know" or "a human will follow up" make no factual claim and count as supported.
- Citation markers like [S1] are not claims. Judge only the content.`;

export interface Verdict {
  supported: boolean;
  reason: string;
}

/** LLM-as-judge groundedness check. The judge never sees the customer's identity or the expected answer. */
export async function judgeGroundedness(
  llm: Llm,
  question: string,
  chunks: RetrievedChunk[],
  answer: string,
): Promise<Verdict> {
  const { output } = await generateText({
    model: llm.model("large"),
    system: JUDGE_SYSTEM,
    prompt: `${buildUserPrompt(question, labelSources(chunks))}\n\n<answer>\n${answer}\n</answer>`,
    output: Output.object({ schema: verdictSchema, name: "Verdict" }),
    temperature: 0,
    providerOptions: llm.providerOptions,
  });
  return output;
}
