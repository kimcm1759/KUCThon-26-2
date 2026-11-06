import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  // Let phones on the same Wi-Fi load dev assets via the PC's LAN address
  // (npm run dev:lan). Without this the page renders but never hydrates.
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*"],
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
