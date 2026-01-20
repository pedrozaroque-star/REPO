import { syncToastPunches } from './lib/toast-labor'
import { getSupabaseClient } from './lib/supabase'

const LYNWOOD_GUID = '80a1ec95-bc73-402e-8884-e5abbe9343e6'

async function resyncLynwood() {
    const supabase = await getSupabaseClient()

    console.log(`--- RE-SINCRONIZANDO LYNWOOD (${LYNWOOD_GUID}) ---`)

    // 1. Limpiar datos viejos de Lynwood para empezar de cero
    console.log('Borrando ponchadas viejas de Lynwood para asegurar limpieza...')
    const { error: delError } = await supabase
        .from('punches')
        .delete()
        .eq('store_id', LYNWOOD_GUID)

    if (delError) {
        console.error('Error al borrar:', delError.message)
        return
    }

    // 2. Sincronizar últimos 3 meses (en 3 chunks)
    for (let chunkIndex = 0; chunkIndex < 3; chunkIndex++) {
        const chunkEnd = new Date()
        chunkEnd.setUTCHours(0, 0, 0, 0)
        chunkEnd.setUTCDate(chunkEnd.getUTCDate() - (chunkIndex * 30))

        const chunkStart = new Date(chunkEnd)
        chunkStart.setUTCDate(chunkStart.getUTCDate() - 29)

        const startStr = chunkStart.toISOString().replace('Z', '+0000')
        const endStr = chunkEnd.toISOString().replace('Z', '+0000')

        console.log(`\nSincronizando Chunk ${chunkIndex + 1}/3 [${startStr.slice(0, 10)} al ${endStr.slice(0, 10)}]`)

        const res = await syncToastPunches(LYNWOOD_GUID, startStr, endStr)
        if (res.success) {
            console.log(`✅ Chunk ${chunkIndex + 1}: ${res.count} ponchadas guardadas.`)
        } else {
            console.log(`❌ Chunk ${chunkIndex + 1} Error: ${res.error}`)
        }
    }

    // 3. Verificación final
    const { data: checkPunches, count } = await supabase
        .from('punches')
        .select('*', { count: 'exact' })
        .eq('store_id', LYNWOOD_GUID)
        .limit(5)

    console.log(`\n--- VERIFICACIÓN FINAL ---`)
    console.log(`Total ponchadas ahora: ${count}`)
    checkPunches?.forEach(p => {
        console.log(`- Emp GUID: ${p.employee_toast_guid}, Start: ${p.start_time}`)
    })
}

resyncLynwood()
