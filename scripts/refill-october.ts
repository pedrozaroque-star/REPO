
import { fetchToastData } from '../lib/toast-api'

async function refillOctober() {
    console.log("🚀 Iniciando recarga de datos para OCTUBRE 2025...")

    // Rango: 1 de Octubre al 31 de Octubre 2025
    const startDate = '2025-10-01'
    const endDate = '2025-10-31'

    console.log(`📅 Solicitando datos desde ${startDate} hasta ${endDate}...`)
    console.log("⏳ Esto puede tardar unos segundos porque fetchToastData obtendrá los datos de Toast y los guardará en Supabase...")

    try {
        // Al llamar a fetchToastData con fechas pasadas, si no están en cache (que acabamos de borrar),
        // automáticamente irá a la API de Toast y luego hará un UPSERT a Supabase.
        const result = await fetchToastData({
            storeIds: 'all',
            startDate,
            endDate,
            groupBy: 'day'
        })

        if (result.connectionError) {
            console.error("❌ Error de conexión:", result.connectionError)
        } else {
            console.log(`✅ ¡Éxito! Se procesaron ${result.rows.length} registros.`)
            console.log("💾 Los datos han sido guardados en Supabase automáticamente.")
        }

    } catch (error) {
        console.error("🔥 Error crítico ejecutando el script:", error)
    }
}

refillOctober()
