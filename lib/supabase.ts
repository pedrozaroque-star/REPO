import { createClient } from '@supabase/supabase-js'

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