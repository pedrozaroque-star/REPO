import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

// Cargar variables si no existen (para scripts de backend)
if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
  dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// ============================================================================
// SINGLE CLIENT INSTANCE - Configurado para minimizar warnings
// ============================================================================
// Este cliente único se reutiliza en toda la aplicación.
// Las opciones de auth están configuradas para evitar conflictos con GoTrueClient.
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false,     // No persistir sesión automáticamente
    autoRefreshToken: false,    // No refrescar tokens automáticamente
    detectSessionInUrl: false,  // No detectar sesión en URL
    flowType: 'pkce'            // Flow type recomendado
  }
})

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
// ⚠️ SOLO usar en operaciones administrativas del lado del servidor o
// en componentes client-side que requieran permisos elevados (como gestión de usuarios).
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY!

export const supabaseAdmin = supabaseServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  })
  : supabase // Fallback al cliente normal si no hay service key

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