import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // NOTE: "standalone" output is NOT compatible with Vercel deployment.
  // For Docker/self-hosted, use `next start` instead of `node server.js`.
  // For Vercel, just deploy normally — Vercel handles the build itself.
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // ffmpeg-static must be external so Vercel bundles the native binary correctly
  serverExternalPackages: ['sharp', 'ffmpeg-static'],
  outputFileTracingExcludes: {
    '*': ['agent-ctx'],
  },
  // The agent code-execution sandbox stages COMPLETE copies of these curated
  // npm packages into the lambda bundle (child processes resolve them via
  // NODE_PATH). Without this the output tracer copies them only partially and
  // require() fails in the sandbox.
  outputFileTracingIncludes: {
    '/api/agent/execute': [
      './node_modules/adm-zip/**/*',
      './node_modules/date-fns/**/*',
    ],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '100mb',
    },
  },
};

export default nextConfig;
