/**
 * @module scripts/backfill-supervisor-assignments
 * @description Auditoría segura de evidencia para las relaciones de supervisores de RONOS.
 *   No crea asignaciones ni nómina: identifica las relaciones que requieren evidencia nativa.
 *
 * @businessRules
 *   - Nunca se vincula por nombre, salario, tienda conocida ni listas escritas en código.
 *   - Solo un proceso que lea el paystub oficial de Simplify HR puede crear un pago verificado.
 *   - Las relaciones sin assignmentId/employeeId permanecen en revisión.
 *
 * @dataFlow
 *   stores -> reporte de evidencia pendiente; no hay mutaciones de Supabase.
 *
 * @notes
 *   Reemplaza el backfill histórico que contenía identidades y montos estáticos.
 */

import dotenv from 'dotenv'
import path from 'path'
import { supabaseAdmin } from '../lib/supabase'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

async function main() {
  const { data: stores, error } = await supabaseAdmin
    .from('stores')
    .select('id, name, supervisor_id, supervisor_name, is_active')
    .eq('is_active', true)
    .order('id')

  if (error) throw new Error(`No se pudieron consultar las tiendas: ${error.message}`)

  const pending = (stores || [])
    .filter(store => Boolean(store.supervisor_name) || Boolean(store.supervisor_id))
    .map(store => ({
      storeId: store.id,
      storeName: store.name,
      supervisorReference: store.supervisor_id || null,
      status: 'requires_native_simplify_evidence'
    }))

  console.table(pending)
  console.log(`${pending.length} relaciones requieren sincronización desde IDs nativos y paystubs de Simplify HR.`)
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
