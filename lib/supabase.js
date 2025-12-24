import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

console.log('🔍 Verificando variables:')
console.log('URL:', supabaseUrl)
console.log('Key:', supabaseAnonKey ? 'Sí existe' : 'NO EXISTE')

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('❌ FALTAN LAS VARIABLES DE ENTORNO')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)