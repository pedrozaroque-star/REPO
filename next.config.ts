import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  outputFileTracingExcludes: {
    "/api/**": [
      "./exports/**",
      "./docs/**",
      "./ordenes/**",
      "./scripts/**",
      "./data/**",
      "./reports/**",
      "./.next - Copy/**",
      "./r365_analysis/**",
      "./screenshots/**",
      "./tmp/**",
      "./.tmp/**",
      "./backups/**",
      "./cohesion_dump/**",
    ],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '15mb',
    },
  },
};

export default nextConfig;
