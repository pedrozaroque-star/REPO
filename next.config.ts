import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  experimental: {
    serverActions: {
      bodySizeLimit: '15mb',
    },
  },
  async rewrites() {
    return [
      {
        source: '/t/:screen/:store',
        destination: '/tv?screen=:screen&store=:store'
      }
    ]
  }
};

export default nextConfig;
