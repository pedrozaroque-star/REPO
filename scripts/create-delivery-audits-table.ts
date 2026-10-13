import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function applyMigration() {
  console.log('🚀 Creando tabla delivery_packing_audits via RPC execute_sql...');

  const sql = `
    CREATE TABLE IF NOT EXISTS public.delivery_packing_audits (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      store_id INTEGER NOT NULL REFERENCES public.stores(id),
      toast_order_guid TEXT NOT NULL,
      toast_display_number TEXT,
      platform TEXT NOT NULL,
      dining_option_guid TEXT,
      dining_option_name TEXT,
      customer_name TEXT,
      order_opened_at TIMESTAMPTZ,
      items_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      matched_items JSONB NOT NULL DEFAULT '[]'::jsonb,
      match_completed BOOLEAN NOT NULL DEFAULT false,
      photo_open_url TEXT,
      photo_sealed_url TEXT,
      packer_ronos_user_id INTEGER,
      packer_ronos_name TEXT,
      packer_pin TEXT,
      packed_at TIMESTAMPTZ,
      handed_by_ronos_user_id INTEGER,
      handed_by_ronos_name TEXT,
      handed_pin TEXT,
      handed_at TIMESTAMPTZ,
      driver_name TEXT,
      driver_confirmed BOOLEAN DEFAULT false,
      status TEXT NOT NULL DEFAULT 'PENDING_MATCH',
      dispute_status TEXT DEFAULT 'NONE',
      dispute_notes TEXT,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_delivery_audits_store_date 
      ON public.delivery_packing_audits(store_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_delivery_audits_toast_guid 
      ON public.delivery_packing_audits(toast_order_guid);
    CREATE INDEX IF NOT EXISTS idx_delivery_audits_status 
      ON public.delivery_packing_audits(status);
  `;

  // Limpiar comentarios y formatear
  const cleanSql = sql
    .split('\n')
    .map(line => {
      const idx = line.indexOf('--');
      return idx >= 0 ? line.slice(0, idx).trim() : line.trim();
    })
    .filter(Boolean)
    .join(' ');

  const payload = `SELECT 1 ) t; ${cleanSql} SELECT * FROM (SELECT 1`;

  const res = await supabase.rpc('execute_sql', { query_text: payload });
  if (res.error || (res.data && res.data.error)) {
    console.error('❌ Error aplicando DDL:', res.error || res.data.error);
    process.exit(1);
  }
  console.log('✅ Sentencias DDL aplicadas en PostgreSQL!');

  // Recargar el caché de esquema de PostgREST
  console.log('🔄 Recargando PostgREST schema cache...');
  await supabase.rpc('execute_sql', {
    query_text: "SELECT 1 ) t; NOTIFY pgrst, 'reload schema'; SELECT * FROM (SELECT 1"
  });

  await new Promise(resolve => setTimeout(resolve, 2000));

  // Verificar
  const { data, error } = await supabase.from('delivery_packing_audits').select('id').limit(1);
  if (error) {
    console.error('❌ Error al consultar tabla creada:', error.message);
    process.exit(1);
  }
  console.log('🎉 Tabla delivery_packing_audits está activa y lista en Supabase!');

  // Create storage bucket if not exists
  const { data: buckets } = await supabase.storage.listBuckets();
  const bucketExists = buckets?.some(b => b.name === 'delivery-evidence');
  if (!bucketExists) {
    const { error: bErr } = await supabase.storage.createBucket('delivery-evidence', {
      public: true,
      fileSizeLimit: 10485760 // 10MB
    });
    if (bErr) {
      console.warn('Advertencia creando bucket delivery-evidence:', bErr.message);
    } else {
      console.log('✅ Bucket "delivery-evidence" creado exitosamente en Supabase Storage!');
    }
  } else {
    console.log('✅ Bucket "delivery-evidence" ya existe en Supabase Storage!');
  }

  process.exit(0);
}

applyMigration().catch(err => {
  console.error(err);
  process.exit(1);
});
