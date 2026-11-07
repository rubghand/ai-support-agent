import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().url().default("postgres://agent:agent@localhost:5455/agent"),
  LLM_PROVIDER: z.enum(["ollama", "google", "anthropic"]).default("ollama"),
  OLLAMA_BASE_URL: z.string().url().default("http://localhost:11434"),
  MODEL_SMALL: z.string().default("qwen3:4b"),
  MODEL_LARGE: z.string().default("qwen3:14b"),
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
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
  return config;
}
