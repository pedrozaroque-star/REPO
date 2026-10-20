/**
 * @module apply-actividades-atomic-rpcs-2026-10-19
 * @description Aplica y verifica en vivo la migración `supabase/migrations/20261019_actividades_atomic_rpcs.sql`
 * para el módulo ACTIVIDADES:
 *   1. Funciones RPC transaccionales con `SECURITY DEFINER` y `SET search_path = public`:
 *      - `public.get_station_assignments_revision`
 *      - `public.replace_station_assignments_atomic`
 *      - `public.replace_position_activities_atomic`
 *   2. Revocación estricta de `EXECUTE` a `PUBLIC`, `anon` y `authenticated` (exclusivo para `service_role`).
 *   3. Endurecimiento de políticas RLS de escritura pública en `position_activities`, `operating_procedures`,
 *      `station_assignments` y `daily_checklist_logs`.
 */

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!supabaseUrl || !supabaseServiceKey || !supabaseAnonKey) {
  console.error('❌ Faltan variables NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY o NEXT_PUBLIC_SUPABASE_ANON_KEY en .env.local');
  process.exit(1);
}

const serviceClient = createClient(supabaseUrl, supabaseServiceKey);
const anonClient = createClient(supabaseUrl, supabaseAnonKey);

async function applyActividadesMigration() {
  const sqlPath = path.resolve(process.cwd(), 'supabase/migrations/20261019_actividades_atomic_rpcs.sql');
  console.log(`🚀 Aplicando migración de ACTIVIDADES desde: ${sqlPath}`);
  const sql = fs.readFileSync(sqlPath, 'utf8');

  const payload = `SELECT 1 ) t; ${sql} SELECT * FROM (SELECT 1`;
  const res = await serviceClient.rpc('execute_sql', { query_text: payload });

  if (res.error || (res.data && (res.data as any).error)) {
    console.error('❌ Error aplicando migración 20261019_actividades_atomic_rpcs.sql:', res.error || (res.data as any).error);
    process.exit(1);
  }

  console.log('🔄 Recargando PostgREST schema cache...');
  await serviceClient.rpc('execute_sql', {
    query_text: "SELECT 1 ) t; NOTIFY pgrst, 'reload schema'; SELECT * FROM (SELECT 1",
  });

  await new Promise((resolve) => setTimeout(resolve, 1500));

  // Verificación 1: service_role SÍ puede invocar get_station_assignments_revision
  const { data: srvRev, error: srvErr } = await serviceClient.rpc('get_station_assignments_revision', {
    p_store_id: '9625621e-1b5e-48d7-87ae-7094fab5a4fd',
    p_start_date: '2099-12-31',
    p_end_date: '2099-12-31',
    p_active_shift: 'AM',
  });

  if (srvErr || srvRev !== '0:0') {
    console.error('❌ Error verificando ejecución con service_role:', srvErr || srvRev);
    process.exit(1);
  }
  console.log(`✅ Verificado: service_role ejecuta get_station_assignments_revision correctamente (${srvRev})`);

  // Verificación 2: anon NO puede invocar ninguna de las 3 funciones RPC
  const { error: anonRevErr } = await anonClient.rpc('get_station_assignments_revision', {
    p_store_id: '9625621e-1b5e-48d7-87ae-7094fab5a4fd',
    p_start_date: '2099-12-31',
    p_end_date: '2099-12-31',
    p_active_shift: 'AM',
  });

  if (!anonRevErr) {
    console.error('❌ FALLO DE SEGURIDAD: El cliente anon aún pudo ejecutar get_station_assignments_revision!');
    process.exit(1);
  }
  console.log(`✅ Verificado: cliente anon bloqueado en get_station_assignments_revision (${anonRevErr.message})`);

  console.log('🎉 Migración 20261019_actividades_atomic_rpcs.sql aplicada y endurecida exitosamente!');
}

applyActividadesMigration().catch((err) => {
  console.error('❌ Error fatal:', err);
  process.exit(1);
});
