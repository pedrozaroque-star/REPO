/**
 * Fix: 
 * 1. Revert Jun 8-14 shifts back to 'published' (were changed by mistake)
 * 2. Convert Jun 15-21 shifts to 'draft' (the actual target)
 */
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

async function main() {
  const storeExternalId = '80a1ec95-bc73-402e-8884-e5abbe9343e6' // Lynwood

  // === PASO 1: Restaurar semana Jun 8-14 a published ===
  console.log('🔄 PASO 1: Restaurando semana Jun 8-14 a "published"...')
  
  const { data: wrongWeek, error: err1 } = await supabase
    .from('shifts')
    .update({ status: 'published' })
    .eq('store_id', storeExternalId)
    .eq('status', 'draft')
    .gte('shift_date', '2026-06-08')
    .lte('shift_date', '2026-06-14')
    .select('id')

  if (err1) {
    console.error('❌ Error restaurando semana 8-14:', err1)
    return
  }
  console.log(`   ✅ ${wrongWeek?.length || 0} turnos restaurados a "published" (Jun 8-14)`)

  // === PASO 2: Convertir semana Jun 15-21 a draft ===
  console.log('\n🔄 PASO 2: Convirtiendo semana Jun 15-21 a "draft"...')

  // Primero verificar cuántos hay
  const { data: targetShifts, error: err2 } = await supabase
    .from('shifts')
    .select('id, shift_date, status, employee_id')
    .eq('store_id', storeExternalId)
    .eq('status', 'published')
    .gte('shift_date', '2026-06-15')
    .lte('shift_date', '2026-06-21')

  if (err2) {
    console.error('❌ Error buscando turnos Jun 15-21:', err2)
    return
  }

  if (!targetShifts || targetShifts.length === 0) {
    console.log('   ⚠️ No se encontraron turnos publicados para Lynwood Jun 15-21')
    
    // Debug: ver qué status tienen
    const { data: debug } = await supabase
      .from('shifts')
      .select('id, shift_date, status')
      .eq('store_id', storeExternalId)
      .gte('shift_date', '2026-06-15')
      .lte('shift_date', '2026-06-21')
      .limit(10)
    
    console.log('   Debug - turnos encontrados (cualquier status):', JSON.stringify(debug, null, 2))
    return
  }

  console.log(`   📋 Encontrados ${targetShifts.length} turnos publicados de Lynwood (Jun 15-21)`)

  const shiftIds = targetShifts.map(s => s.id)
  
  const { data: updated, error: err3 } = await supabase
    .from('shifts')
    .update({ status: 'draft' })
    .in('id', shiftIds)
    .select('id')

  if (err3) {
    console.error('❌ Error convirtiendo a draft:', err3)
    return
  }

  console.log(`   ✅ ${updated?.length || shiftIds.length} turnos de Lynwood convertidos a DRAFT (Jun 15-21)`)
  console.log(`\n🎉 ¡LISTO! Ahora ve al Planificador → Lynwood → semana del 15 → Publicar`)
}

main().catch(console.error)
