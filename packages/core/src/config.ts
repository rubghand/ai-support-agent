import { z } from "zod";

export const LLM_PROVIDERS = ["ollama", "google", "anthropic"] as const;
export type LlmProvider = (typeof LLM_PROVIDERS)[number];

/** Defaults per provider; override with MODEL_SMALL / MODEL_LARGE when model names change. */
export const DEFAULT_MODELS: Record<LlmProvider, { small: string; large: string }> = {
  ollama: { small: "qwen3:4b", large: "qwen3:14b" },
  google: { small: "gemini-2.5-flash-lite", large: "gemini-2.5-flash" },
  anthropic: { small: "claude-haiku-4-5", large: "claude-sonnet-4-5" },
};

const envSchema = z.object({
  DATABASE_URL: z.string().url().default("postgres://agent:agent@localhost:5455/agent"),
  LLM_PROVIDER: z.enum(LLM_PROVIDERS).default("ollama"),
  OLLAMA_BASE_URL: z.string().url().default("http://localhost:11434"),
  MODEL_SMALL: z.string().min(1).optional(),
  MODEL_LARGE: z.string().min(1).optional(),
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().min(1).optional(),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
});

export type AppConfig = Omit<z.infer<typeof envSchema>, "MODEL_SMALL" | "MODEL_LARGE"> & {
  MODEL_SMALL: string;
  MODEL_LARGE: string;
};

/** Empty strings (e.g. `KEY=` copied from .env.example) are treated as unset. */
function withoutEmpty(env: Record<string, string | undefined>) {
  return Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ""));
}

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const parsed = envSchema.safeParse(withoutEmpty(env));
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration:\n${z.prettifyError(parsed.error)}`);
  }
  const config = parsed.data;
  if (config.LLM_PROVIDER === "google" && !config.GOOGLE_GENERATIVE_AI_API_KEY) {
    throw new Error("LLM_PROVIDER=google requires GOOGLE_GENERATIVE_AI_API_KEY");
  }
  if (config.LLM_PROVIDER === "anthropic" && !config.ANTHROPIC_API_KEY) {
    throw new Error("LLM_PROVIDER=anthropic requires ANTHROPIC_API_KEY");
  }
  const defaults = DEFAULT_MODELS[config.LLM_PROVIDER];
  return {
    ...config,
    MODEL_SMALL: config.MODEL_SMALL ?? defaults.small,
    MODEL_LARGE: config.MODEL_LARGE ?? defaults.large,
  };
}
