import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// Cliente básico de Supabase
export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Función para crear cliente con JWT token del usuario
export function getSupabaseClient() {
  const token = typeof window !== 'undefined' ? localStorage.getItem('teg_token') : null
  
  if (token) {
    // Cliente con JWT custom en headers
    return createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    })
  }
  
  return supabase
}

// Helper para hacer requests con autenticación
export async function fetchWithAuth(url: string, options: RequestInit = {}) {
  const token = localStorage.getItem('teg_token')
  
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