export { DEFAULT_MODELS, LLM_PROVIDERS, loadConfig, type AppConfig, type LlmProvider } from "./config";
export { createLlm, type Llm, type ModelTier } from "./llm/provider";
export { SUPPORT_SYSTEM_PROMPT } from "./prompts/system";
export {
  answerQuestion,
  answerSchema,
  generateCitedAnswer,
  type AnswerDeps,
  type CitedAnswer,
  type Citation,
} from "./rag/answer";
export {
  frontmatterSchema,
  loadKnowledgeBase,
  validateKnowledgeBase,
  type DocFrontmatter,
  type KbDocument,
} from "./kb/load";
export {
  DEFAULT_CHUNK_OPTIONS,
  chunkMarkdown,
  estimateTokens,
  type Chunk,
  type ChunkOptions,
} from "./rag/chunk";
export { EMBEDDING_MODEL, createLocalEmbedder, type Embedder } from "./rag/embed";
export { ingestKnowledgeBase, type IngestStats } from "./rag/ingest";
export {
  reciprocalRankFusion,
  retrieve,
  type RetrievalMode,
  type RetrieveOptions,
  type RetrievedChunk,
} from "./rag/search";
