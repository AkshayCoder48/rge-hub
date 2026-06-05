import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  serverExternalPackages: ['fluent-ffmpeg'],
  outputFileTracingExcludes: {
    '*': ['agent-ctx'],
  },
};

export default nextConfig;
