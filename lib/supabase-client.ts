/**
 * @module lib/supabase-client
 * @description Fábrica de cliente Supabase para componentes de navegador (`@supabase/ssr`) con inyección segura
 * de `teg_token` en peticiones PostgREST/Storage y sincronización automática con Realtime.
 *
 * @businessRules
 * - Adjunta `Authorization: Bearer <teg_token>` únicamente cuando `teg_token` en `localStorage` es un JWT de 3 segmentos
 *   y su `exp` sigue vigente con margen de 5 segundos (`exp * 1000 > Date.now() + 5000`).
 * - Si el token expiró en una tableta o sesión de personal (`user_type !== 'employee'`), lanza `ensureFreshTabletAuth(true)`
 *   en segundo plano y degrada esa solicitud puntual a `NEXT_PUBLIC_SUPABASE_ANON_KEY` para nunca provocar `401 PGRST301`.
 *
 * @dataFlow
 * - Browser Component -> `createClient()` -> `browserSsrAuthFetch` (`teg_token` válido o `anon`) -> Supabase PostgREST / Realtime.
 *
 * @notes
 * - [2026-11-21] Endurecido para compatibilidad transparente con RLS `authenticated` y operación 24/7 en tabletas de cocina.
 */

import { createBrowserClient } from '@supabase/ssr'
import { ensureFreshTabletAuth } from '@/lib/tablet-cache-cleaner'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder'

function readValidBrowserJwt(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem('teg_token')
    if (!raw) return null
    const token = raw.trim()
    const parts = token.split('.')
    if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
      return null
    }

    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
    const payload = JSON.parse(atob(padded))
    if (!payload || typeof payload !== 'object') return null

    if (!payload.exp || (typeof payload.exp === 'number' && payload.exp * 1000 > Date.now() + 5000)) {
      return token
    }

    if (payload.user_type !== 'employee') {
      ensureFreshTabletAuth(true).catch(() => {})
    }
    return null
  } catch {
    return null
  }
}

let lastSsrRealtimeToken: string | null = null
let browserClientRef: ReturnType<typeof createBrowserClient> | null = null

function syncSsrRealtimeAuth(validToken: string | null) {
  if (typeof window === 'undefined' || !browserClientRef?.realtime) return
  const nextToken = validToken || supabaseAnonKey
  if (lastSsrRealtimeToken === nextToken) return
  lastSsrRealtimeToken = nextToken
  try {
    browserClientRef.realtime.setAuth(nextToken)
  } catch {
    // Socket aún no inicializado
  }
}

const browserSsrAuthFetch: typeof fetch = (input, init) => {
  if (typeof window === 'undefined') {
    return fetch(input, init)
  }

  const headers = new Headers(init?.headers)
  if (!headers.has('apikey') && supabaseAnonKey) {
    headers.set('apikey', supabaseAnonKey)
  }

  const validToken = readValidBrowserJwt()
  syncSsrRealtimeAuth(validToken)
  headers.set('Authorization', `Bearer ${validToken || supabaseAnonKey}`)

  return fetch(input, {
    ...init,
    headers
  })
}

export function createClient() {
  const client = createBrowserClient(
    supabaseUrl,
    supabaseAnonKey,
    typeof window !== 'undefined'
      ? {
          global: {
            fetch: browserSsrAuthFetch
          }
        }
      : undefined
  )

  if (typeof window !== 'undefined') {
    browserClientRef = client
    syncSsrRealtimeAuth(readValidBrowserJwt())
  }

  return client
}
