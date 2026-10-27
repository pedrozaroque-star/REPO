/**
 * @module lib/supabase
 * @description Cliente centralizado de Supabase para servidor (Node.js / API Routes / Server Actions) y cliente (PCs, Tablets, TVs y Kioscos).
 *
 * @businessRules
 * - En entorno de servidor (`typeof window === 'undefined'`), utiliza automáticamente `SUPABASE_SERVICE_ROLE_KEY` para que los endpoints de backend y Cron Jobs operen con privilegio `service_role` sin abrir permisos anónimos en tablas financieras o de integraciones.
 * - En entorno de navegador (`typeof window !== 'undefined'`), utiliza estrictamente `NEXT_PUBLIC_SUPABASE_ANON_KEY`, manteniendo compatibilidad 100% zero-downtime con todas las PCs, Tablets, TVs y Kioscos en tienda.
 *
 * @dataFlow
 * - Browser -> `supabase` (`NEXT_PUBLIC_SUPABASE_ANON_KEY`) -> PostgREST / Realtime
 * - Server -> `supabase` / `supabaseAdmin` (`SUPABASE_SERVICE_ROLE_KEY`) -> PostgREST / Storage / RPC
 *
 * @notes
 * - [2026-10-26] Removido fallback `NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY` para impedir cualquier exposición accidental de la llave maestra en el bundle cliente.
 */

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

// Cargar variables si no existen (para scripts de backend)
if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
  dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder'
const isServerRuntime = typeof window === 'undefined'
const supabaseServiceKey = isServerRuntime ? process.env.SUPABASE_SERVICE_ROLE_KEY : undefined

// ============================================================================
// SINGLE CLIENT INSTANCE - Configurado para minimizar warnings
// ============================================================================
// Este cliente único se reutiliza en toda la aplicación.
// En el servidor usa SUPABASE_SERVICE_ROLE_KEY; en el navegador usa NEXT_PUBLIC_SUPABASE_ANON_KEY.
export const supabase = createClient(
  supabaseUrl,
  isServerRuntime && supabaseServiceKey ? supabaseServiceKey : supabaseAnonKey,
  {
    auth: {
      persistSession: false,     // No persistir sesión automáticamente
      autoRefreshToken: false,    // No refrescar tokens automáticamente
      detectSessionInUrl: false,  // No detectar sesión en URL
      flowType: 'pkce'            // Flow type recomendado
    }
  }
)

// ============================================================================
// FUNCIÓN DE CONVENIENCIA (ASYNC)
// ============================================================================
// Devuelve siempre la misma instancia del cliente.
export async function getSupabaseClient() {
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
// Este helper se mantiene para compatibilidad con el sistema de JWT custom.
export async function fetchWithAuth(url: string, options: RequestInit = {}) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('teg_token') : null

  const headers = {
    ...options.headers,
    'apikey': supabaseAnonKey,
    'Authorization': `Bearer ${token || supabaseAnonKey}`,
    'Content-Type': 'application/json'
  }

  return fetch(url, {
    ...options,
    headers
  })
}

// ============================================================================
// FORMATTERS
// ============================================================================
export const formatStoreName = (name: string | null | undefined): string => {
  if (!name) return ''
  return name.replace(/^Tacos Gavilan\s+/i, '').trim()
}

// ============================================================================
// AUTHENTICATED CLIENT (para componentes client-side que necesitan rol 'authenticated')
// ============================================================================
// Este helper crea un cliente Supabase con el token JWT del usuario (teg_token).
// El token JWT generado en /api/login tiene role: 'authenticated', lo que le permite
// pasar las políticas RLS de las tablas bc_* sin necesidad del service_role key.
// ⚠️ Solo funciona en el lado del cliente (browser) donde existe localStorage.
export function getSupabaseWithAuth() {
  if (typeof window === 'undefined') return supabase // Fallback en SSR

  const token = localStorage.getItem('teg_token')
  if (!token) return supabase // Sin token, retorna el cliente anon

  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${token}`
      }
    }
  })
}
