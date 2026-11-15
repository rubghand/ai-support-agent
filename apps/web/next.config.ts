import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@app/core", "@app/db"],
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
