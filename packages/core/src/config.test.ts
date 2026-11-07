import { describe, expect, it } from "vitest";
import { loadConfig } from "./config";

describe("loadConfig", () => {
  it("applies defaults for local development", () => {
    const config = loadConfig({});
    expect(config.LLM_PROVIDER).toBe("ollama");
    expect(config.MODEL_SMALL).toBe("qwen3:4b");
    expect(config.DATABASE_URL).toContain("localhost:5455");
  });

  it("rejects an unknown provider", () => {
    expect(() => loadConfig({ LLM_PROVIDER: "openai" })).toThrow(/Invalid environment/);
  });

  it("requires an API key for hosted providers", () => {
    expect(() => loadConfig({ LLM_PROVIDER: "google" })).toThrow(/GOOGLE_GENERATIVE_AI_API_KEY/);
    expect(loadConfig({ LLM_PROVIDER: "google", GOOGLE_GENERATIVE_AI_API_KEY: "k" }).LLM_PROVIDER).toBe(
      "google",
    );
  });
});
