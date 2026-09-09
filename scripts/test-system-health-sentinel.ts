/**
 * @module scripts/test-system-health-sentinel
 * @description Script de prueba y simulación obligatoria para el Guardián de Salud (System Health Sentinel).
 * Ejecuta el diagnóstico real, evalúa umbrales y envía un correo de prueba de confirmación a carlos@tacosgavilan.com.
 * 
 * Run via: npx tsx scripts/test-system-health-sentinel.ts
 */

import { checkAndNotifySystemHealth, runSystemHealthCheck } from '../lib/system-health-sentinel'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

async function runTest() {
    console.log('==================================================================')
    console.log('🛡️ PRUEBA DEL GUARDIÁN DE SALUD (SYSTEM HEALTH SENTINEL)')
    console.log('==================================================================')

    console.log('\n1. Ejecutando diagnóstico en vivo contra Supabase y Vercel...')
    const report = await runSystemHealthCheck()
    console.log('Reporte obtenido:')
    console.log(`- Estado General: ${report.overallStatus}`)
    console.log(`- Almacenamiento Estimado: ${report.storage.estimatedTotalGb} GB / ${report.storage.maxDiskGb} GB (${report.storage.usagePercent}%)`)
    console.log(`- Espacio Libre: ${report.storage.headroomGb} GB`)
    console.log(`- Latencia Supabase: ${report.databaseLatencyMs} ms`)
    console.log(`- Vercel Producción: ${report.vercelProduction.status} (${report.vercelProduction.latencyMs} ms)`)
    console.log(`- Tiendas activas hoy: ${report.toastSync.activeStoresToday}`)
    console.log(`- Alertas: ${report.alerts.length === 0 ? 'Ninguna' : report.alerts.join(' | ')}`)

    console.log('\n2. Probando ciclo completo con envío de correo a carlos@tacosgavilan.com...')
    const result = await checkAndNotifySystemHealth(true) // Forzar envío para validación
    console.log('✅ Ciclo ejecutado exitosamente.')
    console.log(`Estado final: ${result.overallStatus}`)

    console.log('\n==================================================================')
    console.log('✨ VERIFICACIÓN FINALIZADA CON ÉXITO')
    console.log('==================================================================')
}

runTest().catch((err) => {
    console.error('❌ Error en prueba del Guardián:', err)
    process.exit(1)
})
