
import { getSupabaseClient } from '../lib/supabase'

async function checkColumn() {
    console.log('Verificando columna inspector_photo_url en supervisor_inspections...')
    const supabase = await getSupabaseClient()

    // Intentamos seleccionar solo esa columna de 1 fila cualquiera
    const { data, error } = await supabase
        .from('supervisor_inspections')
        .select('inspector_photo_url')
        .limit(1)

    if (error) {
        if (error.message.includes('does not exist') || error.code === 'PGRST301') {
            console.error('❌ LA COLUMNA NO EXISTE. Debes ejecutar el SQL manualmente.')
            console.error('Error detallado:', error.message)
        } else {
            console.error('⚠️ Error inesperado al verificar:', error.message)
        }
    } else {
        console.log('✅ LA COLUMNA EXISTE. Todo está listo para la prueba.')
    }
}

checkColumn()
