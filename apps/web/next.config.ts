import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server for the Docker image; tracing starts at the monorepo root so workspace packages
  // and the hoisted node_modules are included.
  output: "standalone",
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  // transformers.js loads onnxruntime-node through createRequire, which the tracer can't follow, and the
  // tracer keeps only the ESM half of onnxruntime-common, which onnxruntime-node requires as CommonJS.
  outputFileTracingIncludes: {
    "/*": [
      "../../node_modules/onnxruntime-common/**/*",
      "../../node_modules/onnxruntime-node/package.json",
      "../../node_modules/onnxruntime-node/dist/**/*",
      "../../node_modules/onnxruntime-node/bin/napi-v6/linux/**/*",
    ],
  },
  transpilePackages: ["@app/core", "@app/db", "@app/mcp-server"],
  serverExternalPackages: ["@huggingface/transformers", "onnxruntime-node", "pg"],
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
