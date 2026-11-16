import { env } from "@huggingface/transformers";

/**
 * transformers.js caches downloaded models next to its own install by default, which is read-only (or
 * thrown away) in a container image. `MODEL_CACHE_DIR` points it at a writable, persistent directory instead.
 */
export function applyModelCacheDir(dir = process.env.MODEL_CACHE_DIR): void {
  if (dir) env.cacheDir = dir;
}
