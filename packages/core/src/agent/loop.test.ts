import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { MockLanguageModelV4, simulateReadableStream } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import type { Llm } from "../llm/provider";
import type { RetrievedChunk } from "../rag/search";
import { type AgentEvent, runAgent } from "./loop";
import type { McpClientLike } from "./mcp-toolset";

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

type Step = { tool: string; input: object } | { tools: Array<{ tool: string; input: object }> };

const chunk: RetrievedChunk = {
  chunkId: "faq:0",
  documentId: "faq",
  title: "FAQ",
  url: "https://docs.ledgerly.example/faq",
  headingPath: "FAQ",
  content: "Yes, a 14-day trial.",
  updatedOn: new Date("2026-10-01"),
  score: 0.03,
  vectorRank: 1,
  keywordRank: 1,
};

/** Each doGenerate call requests the next scripted tool step; once the script runs out it just replies. */
function scriptedLlm(script: Step[], finalJson: object) {
  let call = 0;
  const finalText = JSON.stringify(finalJson);
  const model = new MockLanguageModelV4({
    doGenerate: async () => {
      const step = script[call++];
      if (!step) {
        return {
          content: [{ type: "text", text: finalText }],
          finishReason: { unified: "stop", raw: undefined },
          usage,
          warnings: [],
        };
      }
      const calls = "tools" in step ? step.tools : [step];
      return {
        content: calls.map((c, i) => ({
          type: "tool-call" as const,
          toolCallId: `call-${call}-${i}`,
          toolName: c.tool,
          input: JSON.stringify(c.input),
        })),
        finishReason: { unified: "tool-calls", raw: undefined },
        usage,
        warnings: [],
      };
    },
    doStream: async () => {
      const parts: LanguageModelV4StreamPart[] = [
        { type: "text-start", id: "t" },
        { type: "text-delta", id: "t", delta: finalText },
        { type: "text-end", id: "t" },
        { type: "finish", finishReason: { unified: "stop", raw: undefined }, usage },
      ];
      return { stream: simulateReadableStream({ chunks: parts }) };
    },
  });
  const llm: Llm = { provider: "ollama", model: () => model, modelId: () => "mock", providerOptions: {} };
  return { llm, generateCalls: () => model.doGenerateCalls.length };
}

function fakeMcp(results: Record<string, { ok: boolean; text: string }>) {
  const callTool = vi.fn(async ({ name }: { name: string }) => {
    const r = results[name] ?? { ok: false, text: "no such tool" };
    return { content: [{ type: "text", text: r.text }], isError: !r.ok };
  });
  const listTools = vi.fn(async () => ({
    tools: ["lookup_order", "request_refund"].map((name) => ({
      name,
      description: name,
      _meta: { risk: name === "request_refund" ? "high" : "low" },
      inputSchema: { type: "object" as const, properties: { orderId: { type: "string" } } },
    })),
  }));
  return { mcp: { callTool, listTools } as unknown as McpClientLike, callTool };
}

async function collect(gen: AsyncGenerator<AgentEvent>) {
  const events: AgentEvent[] = [];
  for await (const e of gen) events.push(e);
  const final = events.find((e) => e.type === "final");
  if (final?.type !== "final") throw new Error("no final event");
  return { events, answer: final.answer };
}

const pendingText = JSON.stringify({
  status: "pending_approval",
  actionId: 7,
  summary: "Refund $29.00 for order ORD-1042",
  message: "Filed for staff review.",
});

const reply = (extra: object = {}) => ({
  answer: "Done.",
  citations: [],
  confidence: "high",
  needsHuman: false,
  ...extra,
});

describe("runAgent", () => {
  it("runs the requested MCP tool, reports it, and grounds the answer on the tool result", async () => {
    const { llm } = scriptedLlm([{ tool: "lookup_order", input: { orderId: "ORD-1042" } }], reply());
    const { mcp, callTool } = fakeMcp({ lookup_order: { ok: true, text: '{"status":"paid"}' } });
    const search = vi.fn(async () => [chunk]);
    const { events, answer } = await collect(runAgent({ llm, mcp, search }, "status of ORD-1042?"));

    expect(callTool).toHaveBeenCalledOnce();
    expect(callTool.mock.calls[0]![0]).toEqual({ name: "lookup_order", arguments: { orderId: "ORD-1042" } });
    expect(events.map((e) => e.type)).toEqual(["tool_call", "tool_result", "token", "final"]);
    expect(events[0]).toMatchObject({ label: "Looking up order ORD-1042…" });
    expect(search).not.toHaveBeenCalled();
    expect(answer).toMatchObject({ grounded: true, steps: 1, confidence: "high" });
    expect(answer.toolCalls).toMatchObject([{ name: "lookup_order", ok: true }]);
  });

  it("always flags staff follow-up after a successful high-risk tool, even if the model didn't", async () => {
    const { llm } = scriptedLlm(
      [{ tool: "request_refund", input: { orderId: "ORD-1042" } }],
      reply({ needsHuman: false }),
    );
    const { mcp } = fakeMcp({ request_refund: { ok: true, text: pendingText } });
    const { answer } = await collect(runAgent({ llm, mcp, search: async () => [] }, "refund ORD-1042"));
    expect(answer.needsHuman).toBe(true);
  });

  it("pauses after a high-risk call is filed for approval and reports the pending action", async () => {
    const { llm, generateCalls } = scriptedLlm(
      [
        { tool: "request_refund", input: { orderId: "ORD-1042", reason: "Not needed" } },
        { tool: "lookup_order", input: { orderId: "ORD-1042" } },
      ],
      reply({ answer: "Your refund request is pending staff review." }),
    );
    const { mcp, callTool } = fakeMcp({
      request_refund: { ok: true, text: pendingText },
      lookup_order: { ok: true, text: "{}" },
    });
    const { events, answer } = await collect(
      runAgent({ llm, mcp, search: async () => [] }, "refund ORD-1042"),
    );

    expect(events.map((e) => e.type)).toEqual([
      "tool_call",
      "tool_result",
      "approval_pending",
      "token",
      "final",
    ]);
    expect(events[2]).toEqual({
      type: "approval_pending",
      actionId: 7,
      summary: "Refund $29.00 for order ORD-1042",
    });
    // The scripted second tool step never runs: the loop stopped asking the model for tools.
    expect(callTool).toHaveBeenCalledOnce();
    expect(generateCalls()).toBe(1);
    expect(answer.toolCalls).toMatchObject([{ name: "request_refund", ok: true, pendingActionId: 7 }]);
  });

  it("does not treat a failed high-risk call as pending", async () => {
    const { llm } = scriptedLlm([{ tool: "request_refund", input: { orderId: "ORD-1044" } }], reply());
    const { mcp } = fakeMcp({ request_refund: { ok: false, text: '{"code":"invalid_state"}' } });
    const { events, answer } = await collect(
      runAgent({ llm, mcp, search: async () => [] }, "refund ORD-1044"),
    );
    expect(events.some((e) => e.type === "approval_pending")).toBe(false);
    expect(answer.toolCalls[0]?.pendingActionId).toBeUndefined();
  });

  it("labels doc sources across search_docs calls and resolves citations to them", async () => {
    const { llm } = scriptedLlm(
      [{ tool: "search_docs", input: { query: "trial" } }],
      reply({ answer: "Yes, 14 days. [S1]", citations: ["S1"] }),
    );
    const { answer } = await collect(
      runAgent({ llm, mcp: fakeMcp({}).mcp, search: async () => [chunk] }, "Is there a trial?"),
    );
    expect(answer.citations).toMatchObject([{ label: "S1", documentId: "faq" }]);
    expect(answer.retrieved).toHaveLength(1);
    expect(answer.grounded).toBe(true);
  });

  it("falls back to retrieval when the model answers without using any tool", async () => {
    const { llm } = scriptedLlm([], reply({ answer: "14 days [S1]", citations: ["S1"] }));
    const search = vi.fn(async () => [chunk]);
    const { events, answer } = await collect(runAgent({ llm, mcp: fakeMcp({}).mcp, search }, "trial?"));
    expect(search).toHaveBeenCalledWith("trial?");
    expect(events[0]).toMatchObject({ type: "tool_call", name: "search_docs" });
    expect(answer.citations).toHaveLength(1);
    expect(answer.toolCalls).toMatchObject([{ id: "auto-search", name: "search_docs" }]);
  });

  it("stops requesting tools after maxSteps and still produces an answer", async () => {
    const forever: Step[] = Array.from({ length: 10 }, () => ({
      tool: "lookup_order",
      input: { orderId: "ORD-1042" },
    }));
    const { llm, generateCalls } = scriptedLlm(forever, reply());
    const { mcp, callTool } = fakeMcp({ lookup_order: { ok: true, text: "{}" } });
    const { answer } = await collect(runAgent({ llm, mcp, search: async () => [] }, "loop", { maxSteps: 3 }));
    expect(callTool).toHaveBeenCalledTimes(3);
    expect(generateCalls()).toBe(3);
    expect(answer.steps).toBe(3);
  });

  it("reports failed and unknown tool calls to the model instead of crashing", async () => {
    const { llm } = scriptedLlm(
      [
        {
          tools: [
            { tool: "lookup_order", input: { orderId: "ORD-9" } },
            { tool: "drop_tables", input: {} },
          ],
        },
      ],
      reply({ needsHuman: true }),
    );
    const { mcp } = fakeMcp({ lookup_order: { ok: false, text: '{"code":"not_found"}' } });
    const { events, answer } = await collect(runAgent({ llm, mcp, search: async () => [] }, "x"));
    expect(events.filter((e) => e.type === "tool_result")).toMatchObject([{ ok: false }, { ok: false }]);
    expect(answer.toolCalls.map((t) => t.ok)).toEqual([false, false]);
    // Nothing succeeded, so there is nothing to ground on.
    expect(answer.grounded).toBe(false);
  });

  it("aborts a model call that exceeds the per-step timeout", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: ({ abortSignal }) =>
        new Promise((_, reject) => {
          abortSignal?.addEventListener("abort", () => reject(abortSignal.reason));
        }),
    });
    const llm: Llm = { provider: "ollama", model: () => model, modelId: () => "mock", providerOptions: {} };
    await expect(
      collect(runAgent({ llm, mcp: fakeMcp({}).mcp, search: async () => [] }, "slow", { stepTimeoutMs: 30 })),
    ).rejects.toThrow();
  });
});
