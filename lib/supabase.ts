/**
 * @module lib/supabase
 * @description Cliente centralizado de Supabase para servidor (Node.js / API Routes / Server Actions) y cliente (PCs, Tablets, TVs y Kioscos).
 *
 * @businessRules
 * - En entorno de servidor (`typeof window === 'undefined'`), utiliza automáticamente `SUPABASE_SERVICE_ROLE_KEY` para que los endpoints de backend y Cron Jobs operen con privilegio `service_role` sin abrir permisos anónimos en tablas financieras o de integraciones.
 * - En entorno de navegador (`typeof window !== 'undefined'`), utiliza `NEXT_PUBLIC_SUPABASE_ANON_KEY` como base e inyecta dinámicamente `Authorization: Bearer <teg_token>` mediante `browserAuthFetch` ÚNICAMENTE cuando `teg_token` es un JWT válido no expirado (`exp * 1000 > Date.now() + 5000`).
 * - NUNCA envía un JWT expirado a PostgREST (evitando errores `401 PGRST301` en kioscos o tabletas 24/7); si el token de personal venció, dispara `ensureFreshTabletAuth(true)` en segundo plano y usa `supabaseAnonKey` de forma transparente para esa petición.
 * - Mantiene `supabase.realtime.setAuth(...)` sincronizado automáticamente cuando cambia `teg_token`.
 *
 * @dataFlow
 * - Browser -> `supabase` / `fetchWithAuth` (`browserAuthFetch` + `teg_token` válido o `NEXT_PUBLIC_SUPABASE_ANON_KEY`) -> PostgREST / Realtime
 * - Server -> `supabase` / `supabaseAdmin` (`SUPABASE_SERVICE_ROLE_KEY`) -> PostgREST / Storage / RPC
 *
 * @notes
 * - [2026-10-26] Removido fallback `NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY` para impedir cualquier exposición accidental de la llave maestra en el bundle cliente.
 * - [2026-11-21] Añadido `browserAuthFetch` con validación de `exp` sin excepciones, auto-renovación silenciosa para tabletas y sincronización Realtime.
 * - [2026-11-24] `formatStoreName` delega a `formatStoreDisplayName` (`@/lib/store-display`) para eliminar prefijos/sufijos numéricos `#` en nombres de sucursales.
 */

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'
import { formatStoreDisplayName, type StoreDisplayInput } from '@/lib/store-display'
import { ensureFreshTabletAuth } from '@/lib/tablet-cache-cleaner'

// Cargar variables si no existen (para scripts de backend)
if (typeof window === 'undefined' && !process.env.NEXT_PUBLIC_SUPABASE_URL) {
  dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder'
const isServerRuntime = typeof window === 'undefined'
const supabaseServiceKey = isServerRuntime ? process.env.SUPABASE_SERVICE_ROLE_KEY : undefined

/**
 * Lee y valida en memoria que `teg_token` en `localStorage` sea un JWT de 3 partes no expirado (+5s de margen).
 * Si expiró y no es empleado, dispara renovación silenciosa en background y retorna `null` para evitar `401 PGRST301`.
 */
export function getValidBrowserTegToken(): string | null {
  if (typeof window === 'undefined') return null
  try {
    let raw = window.localStorage.getItem('teg_token')
    if (!raw && typeof document !== 'undefined' && document.cookie) {
      const m = document.cookie.match(/(?:^|;\s*)teg_token=([^;]+)/)
      if (m?.[1]) {
        try {
          raw = decodeURIComponent(m[1].trim())
        } catch {
          raw = m[1].trim()
        }
      }
    }
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

let lastRealtimeAuthToken: string | null = null

function syncRealtimeAuthToken(client: { realtime?: { setAuth?: (token: string) => void } } | null, validToken: string | null) {
  if (typeof window === 'undefined' || !client?.realtime?.setAuth) return
  const effectiveToken = validToken || supabaseAnonKey
  if (lastRealtimeAuthToken === effectiveToken) return
  lastRealtimeAuthToken = effectiveToken
  try {
    client.realtime.setAuth(effectiveToken)
  } catch {
    // Ignorar si el socket Realtime aún no está inicializado
  }
}

export const browserAuthFetch: typeof fetch = (input, init) => {
  if (typeof window === 'undefined') {
    return fetch(input, init)
  }

  const headers = new Headers(init?.headers)
  if (!headers.has('apikey') && supabaseAnonKey) {
    headers.set('apikey', supabaseAnonKey)
  }

  const validToken = getValidBrowserTegToken()
  syncRealtimeAuthToken(supabase, validToken)
  headers.set('Authorization', `Bearer ${validToken || supabaseAnonKey}`)

  return fetch(input, {
    ...init,
    headers
  })
}

// ============================================================================
// SINGLE CLIENT INSTANCE - Configurado para minimizar warnings
// ============================================================================
// Este cliente único se reutiliza en toda la aplicación.
// En el servidor usa SUPABASE_SERVICE_ROLE_KEY; en el navegador usa NEXT_PUBLIC_SUPABASE_ANON_KEY + browserAuthFetch.
export const supabase = createClient(
  supabaseUrl,
  isServerRuntime && supabaseServiceKey ? supabaseServiceKey : supabaseAnonKey,
  {
    auth: {
      persistSession: false,     // No persistir sesión automáticamente
      autoRefreshToken: false,    // No refrescar tokens automáticamente
      detectSessionInUrl: false,  // No detectar sesión en URL
      flowType: 'pkce'            // Flow type recomendado
    },
    ...(isServerRuntime
      ? {}
      : {
          global: {
            fetch: browserAuthFetch
          }
        })
  }
)

if (typeof window !== 'undefined') {
  syncRealtimeAuthToken(supabase, getValidBrowserTegToken())
  window.addEventListener('storage', (event) => {
    if (event.key === 'teg_token' || event.key === null) {
      syncRealtimeAuthToken(supabase, getValidBrowserTegToken())
    }
  })
}

// ============================================================================
// FUNCIÓN DE CONVENIENCIA (ASYNC)
// ============================================================================
// Devuelve siempre la misma instancia del cliente.
export async function getSupabaseClient() {
  if (typeof window !== 'undefined') {
    syncRealtimeAuthToken(supabase, getValidBrowserTegToken())
  }
  return supabase
}

// ============================================================================
// ADMIN CLIENT - Para operaciones que requieren bypasear RLS
// ============================================================================
// Este cliente usa el service_role key que ignora las políticas RLS.
export const supabaseAdmin = supabaseServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
      }
    })
  : supabase // Fallback al cliente normal en navegador

export async function getSupabaseAdminClient() {
  return supabaseAdmin
}

// ============================================================================
// HELPER PARA REQUESTS CON AUTENTICACIÓN (token custom)
// ============================================================================
// Este helper se mantiene para compatibilidad con el sistema de JWT custom y PostgREST REST directo.
export async function fetchWithAuth(url: string, options: RequestInit = {}) {
  const validToken = typeof window !== 'undefined' ? getValidBrowserTegToken() : null
  const headers = new Headers(options.headers)

  if (!headers.has('apikey') && supabaseAnonKey) {
    headers.set('apikey', supabaseAnonKey)
  }
  headers.set('Authorization', `Bearer ${validToken || supabaseAnonKey}`)
  if (!headers.has('Content-Type') && !(typeof FormData !== 'undefined' && options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json')
  }

  return fetch(url, {
    ...options,
    headers
  })
}

// ============================================================================
// FORMATTERS
// ============================================================================
export const formatStoreName = (name: StoreDisplayInput): string => {
  return formatStoreDisplayName(name)
}

// ============================================================================
// AUTHENTICATED CLIENT (para componentes client-side que necesitan rol 'authenticated')
// ============================================================================
// Reutiliza la instancia principal `supabase` (que ya inyecta `teg_token` dinámicamente vía `browserAuthFetch`
// y sincroniza Realtime) evitando duplicar instancias GoTrueClient en el navegador.
export function getSupabaseWithAuth() {
  if (typeof window !== 'undefined') {
    syncRealtimeAuthToken(supabase, getValidBrowserTegToken())
  }
  return supabase
}
