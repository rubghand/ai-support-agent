import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModel } from "ai";
import { createOllama } from "ollama-ai-provider-v2";
import type { AppConfig } from "../config";

export type ModelTier = "small" | "large";

/** Options passed to every call; used to switch off Qwen3's slow "thinking" mode on Ollama. */
export type ProviderOptions = Record<string, Record<string, string | number | boolean>>;

export interface Llm {
  provider: AppConfig["LLM_PROVIDER"];
  model(tier: ModelTier): LanguageModel;
  modelId(tier: ModelTier): string;
  providerOptions: ProviderOptions;
}

/** One interface over all providers, so the rest of the app never imports a provider SDK. */
export function createLlm(config: AppConfig): Llm {
  const ids: Record<ModelTier, string> = { small: config.MODEL_SMALL, large: config.MODEL_LARGE };
  const provider = config.LLM_PROVIDER;

  switch (provider) {
    case "ollama": {
      const ollama = createOllama({ baseURL: `${config.OLLAMA_BASE_URL}/api` });
      return {
        provider,
        model: (t) => ollama(ids[t]),
        modelId: (t) => ids[t],
        providerOptions: { ollama: { think: false } },
      };
    }
    case "google": {
      const google = createGoogleGenerativeAI({ apiKey: config.GOOGLE_GENERATIVE_AI_API_KEY });
      return { provider, model: (t) => google(ids[t]), modelId: (t) => ids[t], providerOptions: {} };
    }
    case "anthropic": {
      const anthropic = createAnthropic({ apiKey: config.ANTHROPIC_API_KEY });
      return { provider, model: (t) => anthropic(ids[t]), modelId: (t) => ids[t], providerOptions: {} };
    }
    default: {
      const unhandled: never = provider;
      throw new Error(`Unsupported LLM provider: ${String(unhandled)}`);
    }
  }
}
