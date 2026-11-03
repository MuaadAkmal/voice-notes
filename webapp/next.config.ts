import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Plain files for Cloudflare Pages: everything runs in the browser and talks only to the sync function.
  output: "export",
  images: { unoptimized: true },
  trailingSlash: true,
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
