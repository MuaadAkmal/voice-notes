import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Plain files for Cloudflare Pages: no server, so no API routes or middleware.
  output: "export",
  images: { unoptimized: true },
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
