import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // No on-screen Next.js badge (keeps demos and screenshots clean). Compile and
  // runtime errors are still shown in development.
  devIndicators: false,
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
