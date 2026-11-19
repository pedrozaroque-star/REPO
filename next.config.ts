import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  outputFileTracingExcludes: {
    "/**": [
      "./server-debug.log",
      "./videos/**",
      "./public/tacosgavilan-web/**",
      "./public/images/viele/**",
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
      "./cohesion_deep_dive/**",
      "./cohesion_forensic_300/**",
      "./cohesion_master_knowledge/**",
      "./handoff_antigravity/**",
      "./*.pdf",
      "./*.xlsx",
      "./*.zip",
    ],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '15mb',
    },
  },
};

export default nextConfig;
