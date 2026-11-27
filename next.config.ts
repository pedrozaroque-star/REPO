/**
 * @module next.config
 * @description Configuración global de Next.js 16 para Tacos Gavilan: compilador React, exclusiones de trazado para paquetes serverless,
 * límite de Server Actions y cabeceras HTTP de seguridad global en todas las respuestas.
 *
 * @businessRules
 * - Suprime `X-Powered-By` (`poweredByHeader: false`).
 * - Inyecta HSTS, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `X-Frame-Options: SAMEORIGIN`,
 *   `Permissions-Policy` acotada a `(self)` y `Content-Security-Policy` base (`frame-ancestors 'self'; object-src 'none'; base-uri 'self'`).
 *
 * @dataFlow
 * - Next.js Edge / Server Router -> `headers()` sobre `/:path*` -> Browser / API Client.
 *
 * @notes
 * - Hardened 2026-11-21: Cabeceras globales de seguridad HTTP habilitadas sin afectar WebRTC/cámara propia (`(self)`).
 * - Anti-OOM Vercel Build (2026-11-26): `npm run build` ejecuta secuencialmente `next typegen && tsc --noEmit && next build`.
 *   La verificación estricta de tipos (`tsc --noEmit`, con caché incremental en `.next/cache/tsconfig.tsbuildinfo`) corre y libera
 *   toda su RAM ANTES de lanzar Turbopack; `typescript.ignoreBuildErrors: true` evita únicamente el segundo worker duplicado de
 *   TypeScript en paralelo con Turbopack que superaba el límite de 8 GB RAM del contenedor estándar de Vercel (`SIGKILL OOM`).
 */

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactCompiler: true,
  typescript: {
    // Ejecutado estrictamente ANTES de `next build` en `package.json` (`next typegen && tsc --noEmit && next build`)
    // para liberar RAM entre TypeScript y Turbopack y evitar OOM en contenedores Vercel de 8 GB.
    ignoreBuildErrors: true,
  },
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
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(self), microphone=(self), geolocation=(self), payment=(self)',
          },
          {
            key: 'Content-Security-Policy',
            value: "frame-ancestors 'self'; object-src 'none'; base-uri 'self'",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
