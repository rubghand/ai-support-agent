/** Client-safe entry point: types and helpers with no DB, embedding, or provider imports. */
export { encodeSse, parseSse, type ChatEvent, type ChatTier } from "./chat/events";
export type { Citation } from "./rag/answer";
