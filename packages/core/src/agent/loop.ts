import { type ModelMessage, Output, type ToolSet, generateText, jsonSchema, tool } from "ai";
import { z } from "zod";
import type { Llm, ModelTier } from "../llm/provider";
import { AGENT_SYSTEM_PROMPT } from "../prompts/agent";
import { type CitedAnswer, type Source, answerSchema, finalizeAnswer, renderSource } from "../rag/answer";
import { streamStructuredAnswer } from "../rag/answer-stream";
import type { RetrievedChunk } from "../rag/search";
import { type InputVerdict, inputRefusal } from "../guard/input";
import { wrapUntrusted } from "../guard/untrusted";
import { type ApprovalPending, approvalPendingSchema } from "../tools/approval";
import { type McpClientLike, loadMcpToolset } from "./mcp-toolset";
import { describeToolCall } from "./tool-labels";

export const SEARCH_DOCS = "search_docs";

export interface AgentDeps {
  llm: Llm;
  /** MCP client already bound to the caller's identity. */
  mcp: McpClientLike;
  /** Retrieval over the knowledge base; the agent decides when to call it. */
  search: (query: string) => Promise<RetrievedChunk[]>;
  /** Screens the question before any model or tool runs (see `checkInput`); no screening when omitted. */
  inputGuard?: (question: string) => Promise<InputVerdict>;
}

export interface AgentOptions {
  tier?: ModelTier;
  /** Earlier turns of the conversation (see `loadConversationHistory`), placed before the question. */
  history?: ModelMessage[];
  /** Maximum model calls that may request tools before the agent must answer. */
  maxSteps?: number;
  /** Per model call and per tool call. */
  stepTimeoutMs?: number;
  signal?: AbortSignal;
}

export interface ToolCallRecord {
  id: string;
  name: string;
  args: unknown;
  ok: boolean;
  durationMs: number;
  /** Set when a high-risk call was filed for staff approval instead of running. */
  pendingActionId?: number;
}

export interface AgentAnswer extends CitedAnswer {
  toolCalls: ToolCallRecord[];
  /** Doc chunks the agent retrieved via search_docs, in label order (S1, S2, ...). */
  retrieved: RetrievedChunk[];
  /** Model calls that requested tools. */
  steps: number;
}

export type AgentEvent =
  | { type: "tool_call"; id: string; name: string; label: string; args: unknown }
  | { type: "tool_result"; id: string; name: string; ok: boolean }
  | { type: "approval_pending"; actionId: number; summary: string }
  | { type: "token"; text: string }
  | { type: "final"; answer: AgentAnswer };

function parseApprovalPending(text: string): ApprovalPending | null {
  try {
    const parsed = approvalPendingSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

const searchDocsTool = tool({
  description:
    "Search the Ledgerly help docs. Returns numbered sources like [S1]. Use a short, specific query.",
  inputSchema: jsonSchema<{ query: string }>({
    type: "object",
    properties: { query: { type: "string", description: "What to look up in the docs" } },
    required: ["query"],
  }),
});

const searchInput = z.object({ query: z.string().trim().min(1).max(300) });
const TOOL_RESULT_LIMIT = 6000;
const APPROVED_REFUND = /"status":\s*"(approved|refunded)"/;

/** Tool output goes back to the model as delimited data, like doc sources. */
const toolResult = (toolCallId: string, toolName: string, text: string) => ({
  type: "tool-result" as const,
  toolCallId,
  toolName,
  output: {
    type: "text" as const,
    value: wrapUntrusted("tool_result", text.slice(0, TOOL_RESULT_LIMIT), { name: toolName }),
  },
});

/**
 * The agent loop, written out explicitly: ask the model, run the tools it requests (through MCP, or
 * the local doc search), feed the results back, repeat up to `maxSteps`; then produce the final
 * structured, cited answer. Tool-calling steps and the final answer are separate model calls, so the
 * final answer keeps the strict schema, citation resolution, and streaming from the RAG path.
 * A high-risk call filed for staff approval pauses the loop: no further tool steps run this turn, and
 * the answer tells the customer the request is pending. Staff decisions are posted to the chat later.
 */
export async function* runAgent(
  { llm, mcp, search, inputGuard }: AgentDeps,
  question: string,
  { tier = "large", history = [], maxSteps = 5, stepTimeoutMs = 60_000, signal }: AgentOptions = {},
): AsyncGenerator<AgentEvent> {
  const started = performance.now();
  if (inputGuard) {
    const verdict = await inputGuard(question);
    if (verdict.category !== "support") {
      const text = inputRefusal(verdict.category);
      yield { type: "token", text };
      yield {
        type: "final",
        answer: {
          answer: text,
          kind: "refuse",
          citations: [],
          confidence: "high",
          needsHuman: false,
          invalidCitations: [],
          grounded: false,
          model: llm.modelId("small"),
          usage: { inputTokens: 0, outputTokens: 0 },
          latencyMs: Math.round(performance.now() - started),
          attempts: 1,
          guardFlags: [`input:${verdict.category}`],
          toolCalls: [],
          retrieved: [],
          steps: 0,
        },
      };
      return;
    }
  }
  const toolset = await loadMcpToolset(mcp);
  const tools: ToolSet = { [SEARCH_DOCS]: searchDocsTool, ...toolset.definitions };
  const sources: Source[] = [];
  const records: ToolCallRecord[] = [];
  const messages: ModelMessage[] = [...history, { role: "user", content: question }];
  const usage = { inputTokens: 0, outputTokens: 0 };
  const withTimeout = () =>
    signal
      ? AbortSignal.any([signal, AbortSignal.timeout(stepTimeoutMs)])
      : AbortSignal.timeout(stepTimeoutMs);

  const runSearch = async (query: string): Promise<string> => {
    const chunks = await search(query);
    const blocks = chunks.map((chunk) => {
      let source = sources.find((s) => s.chunkId === chunk.chunkId);
      if (!source) {
        source = { ...chunk, label: `S${sources.length + 1}` };
        sources.push(source);
      }
      return renderSource(source);
    });
    return blocks.length > 0 ? blocks.join("\n\n") : "No matching documentation found.";
  };

  let steps = 0;
  let awaitingApproval = false;
  let approvalConfirmed = false;
  while (steps < maxSteps && !awaitingApproval) {
    const step = await generateText({
      model: llm.model(tier),
      system: AGENT_SYSTEM_PROMPT,
      messages,
      tools,
      temperature: 0,
      providerOptions: llm.providerOptions,
      abortSignal: withTimeout(),
    });
    usage.inputTokens += step.usage.inputTokens ?? 0;
    usage.outputTokens += step.usage.outputTokens ?? 0;
    if (step.toolCalls.length === 0) break;
    steps++;
    messages.push(...step.response.messages);

    const results = [];
    for (const call of step.toolCalls) {
      const args = call.input;
      yield {
        type: "tool_call",
        id: call.toolCallId,
        name: call.toolName,
        label: describeToolCall(call.toolName, args),
        args,
      };
      const callStarted = performance.now();
      let ok = false;
      let text: string;
      try {
        if (call.toolName === SEARCH_DOCS) {
          const parsed = searchInput.safeParse(args);
          text = parsed.success
            ? await runSearch(parsed.data.query)
            : "Invalid input: provide a non-empty query.";
          ok = parsed.success;
        } else if (call.toolName in toolset.definitions) {
          ({ ok, text } = await toolset.call(call.toolName, args, { timeoutMs: stepTimeoutMs, signal }));
        } else {
          text = `Unknown tool: ${call.toolName}`;
        }
      } catch (error) {
        if (signal?.aborted) throw error;
        text = `Tool failed: ${error instanceof Error ? error.message : "unknown error"}`;
      }
      const pending = ok && toolset.highRisk.has(call.toolName) ? parseApprovalPending(text) : null;
      if (ok && call.toolName !== SEARCH_DOCS && APPROVED_REFUND.test(text)) approvalConfirmed = true;
      records.push({
        id: call.toolCallId,
        name: call.toolName,
        args,
        ok,
        durationMs: Math.round(performance.now() - callStarted),
        ...(pending && { pendingActionId: pending.actionId }),
      });
      yield { type: "tool_result", id: call.toolCallId, name: call.toolName, ok };
      if (pending) {
        awaitingApproval = true;
        yield { type: "approval_pending", actionId: pending.actionId, summary: pending.summary };
      }
      results.push(toolResult(call.toolCallId, call.toolName, text));
    }
    messages.push({ role: "tool", content: results });
  }

  // Safety net: a model that answers without using any tool would answer from memory, which is how
  // support bots invent policies. Run the retrieval it skipped, so the final answer is always grounded
  // in sources (the same behaviour as the single-shot RAG path).
  if (records.length === 0) {
    const id = "auto-search";
    const args = { query: question.slice(0, 300) };
    yield { type: "tool_call", id, name: SEARCH_DOCS, label: describeToolCall(SEARCH_DOCS, args), args };
    const callStarted = performance.now();
    const text = await runSearch(args.query);
    records.push({
      id,
      name: SEARCH_DOCS,
      args,
      ok: true,
      durationMs: Math.round(performance.now() - callStarted),
    });
    yield { type: "tool_result", id, name: SEARCH_DOCS, ok: true };
    messages.push(
      {
        role: "assistant",
        content: [{ type: "tool-call", toolCallId: id, toolName: SEARCH_DOCS, input: args }],
      },
      { role: "tool", content: [toolResult(id, SEARCH_DOCS, text)] },
    );
  }

  const groundedByTools = records.some((r) => r.ok && r.name !== SEARCH_DOCS);
  const retrieved: RetrievedChunk[] = sources;
  // A successful high-risk action (a refund request) always needs staff, whatever the model flagged.
  const staffMustFollowUp = records.some((r) => r.ok && toolset.highRisk.has(r.name));
  const finish = (answer: CitedAnswer): AgentAnswer => ({
    ...answer,
    needsHuman: answer.needsHuman || staffMustFollowUp,
    toolCalls: records,
    retrieved,
    steps,
    latencyMs: Math.round(performance.now() - started),
  });

  const blocking = async (): Promise<CitedAnswer> => {
    const { output, usage: u } = await generateText({
      model: llm.model(tier),
      system: AGENT_SYSTEM_PROMPT,
      messages,
      output: Output.object({ schema: answerSchema, name: "SupportAnswer" }),
      temperature: 0,
      providerOptions: llm.providerOptions,
      abortSignal: withTimeout(),
    });
    return finalizeAnswer(
      output,
      sources,
      {
        model: llm.modelId(tier),
        usage: {
          inputTokens: usage.inputTokens + (u.inputTokens ?? 0),
          outputTokens: usage.outputTokens + (u.outputTokens ?? 0),
        },
        latencyMs: 0,
        attempts: 2,
      },
      { groundedByTools, approvalConfirmed },
    );
  };

  for await (const event of streamStructuredAnswer({
    llm,
    tier,
    system: AGENT_SYSTEM_PROMPT,
    input: { messages },
    sources,
    fallback: blocking,
    groundedByTools,
    approvalConfirmed,
    priorUsage: usage,
    signal,
  })) {
    yield event.type === "token" ? event : { type: "final", answer: finish(event.answer) };
  }
}
