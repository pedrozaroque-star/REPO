// lib/config.ts
// Configuración centralizada de variables de entorno

export const config = {
  supabase: {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
  }
}

// Validar que las variables existan
if (typeof window !== 'undefined') {
  if (!config.supabase.url || !config.supabase.anonKey) {
    console.error('❌ Variables de entorno faltantes. Verifica tu .env.local')
  }
}
