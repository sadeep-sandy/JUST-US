import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root to this project so Next.js doesn't pick up an
  // unrelated lockfile higher up the directory tree.
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
