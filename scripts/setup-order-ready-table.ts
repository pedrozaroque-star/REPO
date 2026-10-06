import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function run() {
  console.log('🚀 Iniciando creación de tabla order_ready_announcements...')

  const sql = `
    CREATE TABLE IF NOT EXISTS public.order_ready_announcements (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at TIMESTAMPTZ DEFAULT now(),
      store_id VARCHAR(100) NOT NULL,
      store_code VARCHAR(50),
      store_name VARCHAR(100),
      order_number VARCHAR(50) NOT NULL,
      order_guid VARCHAR(100),
      dining_option VARCHAR(50) NOT NULL DEFAULT 'TOGO',
      customer_name VARCHAR(100),
      status VARCHAR(30) NOT NULL DEFAULT 'IN_PROGRESS',
      ready_at TIMESTAMPTZ,
      announced BOOLEAN DEFAULT false,
      announced_at TIMESTAMPTZ,
      items_summary TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_order_ready_store_status ON public.order_ready_announcements(store_code, status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_order_ready_store_id ON public.order_ready_announcements(store_id, status);

    GRANT ALL ON TABLE public.order_ready_announcements TO anon, authenticated, service_role;
  `

  const payload = `SELECT 1 ) t; ${sql.replace(/\n/g, ' ')} SELECT * FROM (SELECT 1`

  console.log('📄 Ejecutando DDL...')
  const res = await supabase.rpc('execute_sql', { query_text: payload })
  if (res.error) {
    console.error('❌ Error aplicando DDL:', res.error)
    process.exit(1)
  }
  console.log('✅ DDL aplicado correctamente.')

  console.log('🔄 Recargando caché de PostgREST...')
  await supabase.rpc('execute_sql', {
    query_text: "SELECT 1 ) t; NOTIFY pgrst, 'reload schema'; SELECT * FROM (SELECT 1"
  })

  // Esperar 2.5 segundos para que PostgREST actualice su catálogo
  await new Promise(r => setTimeout(r, 2500))

  console.log('🔍 Probando lectura en PostgREST...')
  const { data, error } = await supabase.from('order_ready_announcements').select('*').limit(1)
  if (error) {
    console.error('❌ Error en PostgREST:', error)
    process.exit(1)
  }

  console.log('🎉 ¡Éxito total! Tabla lista y verificada. Registros:', data.length)
}

run().catch(err => {
  console.error('Error fatal:', err)
  process.exit(1)
})
