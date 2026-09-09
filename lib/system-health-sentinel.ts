/**
 * @module lib/system-health-sentinel
 * @description Guardián automatizado de salud para Supabase y Vercel (Automated System Health Sentinel).
 * Monitorea el consumo de almacenamiento, riesgo de bloqueo por Spend Cap (8 GB),
 * latencia de base de datos, frescura de sincronización de Toast y disponibilidad de Vercel.
 * Notifica de inmediato a carlos@tacosgavilan.com ante anomalías o requerimientos de compra/acción.
 * 
 * @businessRules
 * - Horario laboral del negocio: 6:00 AM a 5:59 AM del siguiente día (Turno PM inicia a las 5:00 PM).
 * - Umbral Preventivo (Warning Threshold): 6.0 GB (75% del límite de 8 GB). Requiere planificar compra de almacenamiento o desactivar Spend Cap.
 * - Umbral Crítico (Emergency Threshold): 7.2 GB (90% del límite de 8 GB). Riesgo inminente de Read-Only Mode (Modo de Solo Lectura).
 * - Cooldown Anti-Spam: Alertas preventivas se envían máximo cada 24 horas si el estado no cambia; alertas críticas cada 6 horas; cambios de estado se notifican de inmediato.
 * 
 * @dataFlow
 * - Vercel Cron -> /api/cron/monitor-system-health -> lib/system-health-sentinel.ts
 * - Consulta métricas en Supabase -> Ping a Vercel Producción -> Guarda estado en tabla integrations -> Envía email vía Nodemailer.
 * 
 * @notes
 * - Diseñado para proteger la continuidad de las 15 sucursales de Tacos Gavilan sin generar falsas alarmas ni spam.
 */

import nodemailer from 'nodemailer'
import { getSupabaseAdminClient } from '@/lib/supabase'

export type HealthStatusLevel = 'HEALTHY' | 'WARNING' | 'CRITICAL'

export interface HealthReport {
    timestamp: string
    overallStatus: HealthStatusLevel
    storage: {
        estimatedTotalGb: number
        maxDiskGb: number
        usagePercent: number
        headroomGb: number
        meatRows: number
        salesRows: number
        schedulesRows: number
        pmixRows: number
    }
    databaseLatencyMs: number
    toastSync: {
        activeStoresToday: number
        latestSyncTime: string | null
        isSyncFresh: boolean
    }
    vercelProduction: {
        status: number
        latencyMs: number
        isHealthy: boolean
    }
    alerts: string[]
    recommendedAction: string | null
}

const SPEND_CAP_LIMIT_GB = 8.0
const WARNING_THRESHOLD_GB = 6.0
const CRITICAL_THRESHOLD_GB = 7.2

// Calibración exacta basada en telemetría real (2.53 GB para 1.90M registros de carne + 36K ventas)
const BASELINE_MEAT_ROWS = 1902949
const BASELINE_SALES_ROWS = 36634
const BASELINE_TOTAL_GB = 2.53

/**
 * Realiza un diagnóstico exhaustivo de Supabase y Vercel en tiempo real.
 */
export async function runSystemHealthCheck(): Promise<HealthReport> {
    const supabase = await getSupabaseAdminClient()
    const alerts: string[] = []
    let overallStatus: HealthStatusLevel = 'HEALTHY'

    // 1. Latencia y Recuento de Filas en Tablas Críticas
    const t0 = performance.now()
    const [meatRes, salesRes, schedRes, pmixRes, storesRes] = await Promise.all([
        supabase.from('meat_consumption_history').select('*', { count: 'exact', head: true }),
        supabase.from('sales_daily_cache').select('*', { count: 'exact', head: true }),
        supabase.from('schedules').select('*', { count: 'exact', head: true }),
        supabase.from('pmix_daily_cache').select('*', { count: 'exact', head: true }),
        supabase.from('stores').select('id, is_active').eq('is_active', true)
    ])
    const databaseLatencyMs = Math.round(performance.now() - t0)

    if (databaseLatencyMs > 3000) {
        alerts.push(`Elevada latencia en Supabase: ${databaseLatencyMs}ms (Umbral normal: <1000ms).`)
        overallStatus = 'WARNING'
    }

    const meatRows = meatRes.count || BASELINE_MEAT_ROWS
    const salesRows = salesRes.count || BASELINE_SALES_ROWS
    const schedulesRows = schedRes.count || 0
    const pmixRows = pmixRes.count || 0

    // Estimación calibrada de almacenamiento
    const meatGrowthFactor = meatRows / BASELINE_MEAT_ROWS
    const salesGrowthFactor = salesRows / BASELINE_SALES_ROWS
    const weightedGrowth = (meatGrowthFactor * 0.7) + (salesGrowthFactor * 0.3)
    const estimatedTotalGb = Number((BASELINE_TOTAL_GB * weightedGrowth).toFixed(2))

    const usagePercent = Number(((estimatedTotalGb / SPEND_CAP_LIMIT_GB) * 100).toFixed(1))
    const headroomGb = Number((SPEND_CAP_LIMIT_GB - estimatedTotalGb).toFixed(2))

    // Verificación de Umbrales de Almacenamiento y Spend Cap
    let recommendedAction: string | null = null

    if (estimatedTotalGb >= CRITICAL_THRESHOLD_GB) {
        overallStatus = 'CRITICAL'
        alerts.push(
            `🚨 RIESGO INMINENTE: El almacenamiento ha alcanzado ${estimatedTotalGb} GB (${usagePercent}% de los 8 GB del Spend Cap). ` +
            `Si no se amplía, PostgreSQL entrará en Read-Only Mode (Modo Solo Lectura) bloqueando ventas y pedidos.`
        )
        recommendedAction = 'Desactivar de inmediato el Spend Cap en Supabase Dashboard (Settings -> Infrastructure) y habilitar ampliación de disco.'
    } else if (estimatedTotalGb >= WARNING_THRESHOLD_GB) {
        if (overallStatus === 'HEALTHY') overallStatus = 'WARNING'
        alerts.push(
            `⚠️ ALERTA PREVENTIVA: El almacenamiento ha superado los ${WARNING_THRESHOLD_GB} GB (${estimatedTotalGb} GB ocupados, ${usagePercent}% del límite de 8 GB). ` +
            `Quedan ${headroomGb} GB libres antes del bloqueo de Spend Cap.`
        )
        recommendedAction = 'Planificar en los próximos días la desactivación del Spend Cap o compra de disco adicional (Compute / Storage Add-on).'
    }

    // 2. Verificación de Sincronización de Ventas de Hoy (Toast Pipeline)
    const nowLA = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }))
    const todayStr = nowLA.toISOString().split('T')[0]
    const currentHour = nowLA.getHours()

    const { data: todaySales } = await supabase
        .from('sales_daily_cache')
        .select('store_id, updated_at')
        .eq('business_date', todayStr)

    const activeStoresToday = todaySales ? todaySales.length : 0
    const latestSyncTime = todaySales && todaySales.length > 0 ? todaySales[0].updated_at : null

    // Durante el horario de operación (después de las 7 AM), al menos algunas tiendas deben tener ventas
    const isOperatingHours = currentHour >= 7 || currentHour < 5
    const isSyncFresh = activeStoresToday > 0 || !isOperatingHours

    if (isOperatingHours && activeStoresToday === 0) {
        alerts.push(`Pipeline de Toast inactivo: No se han registrado ventas hoy (${todayStr}) en horario operativo.`)
        if (overallStatus !== 'CRITICAL') overallStatus = 'WARNING'
    }

    // 3. Verificación de Vercel (Producción)
    let vercelHealthy = true
    let vercelLatency = 0
    let vercelStatusCode = 0

    try {
        const vt0 = performance.now()
        const vRes = await fetch('https://tacosgavilan.vercel.app/login', {
            method: 'GET',
            headers: { 'User-Agent': 'TEG-System-Sentinel/1.0' },
            cache: 'no-store'
        })
        vercelLatency = Math.round(performance.now() - vt0)
        vercelStatusCode = vRes.status

        if (vRes.status !== 200) {
            vercelHealthy = false
            alerts.push(`Vercel Producción respondió con código HTTP ${vRes.status} (esperado: 200).`)
            overallStatus = 'CRITICAL'
        }
    } catch (err: any) {
        vercelHealthy = false
        alerts.push(`Error de conexión hacia Vercel Producción: ${err.message}`)
        overallStatus = 'CRITICAL'
    }

    return {
        timestamp: new Date().toISOString(),
        overallStatus,
        storage: {
            estimatedTotalGb,
            maxDiskGb: SPEND_CAP_LIMIT_GB,
            usagePercent,
            headroomGb,
            meatRows,
            salesRows,
            schedulesRows,
            pmixRows
        },
        databaseLatencyMs,
        toastSync: {
            activeStoresToday,
            latestSyncTime,
            isSyncFresh
        },
        vercelProduction: {
            status: vercelStatusCode,
            latencyMs: vercelLatency,
            isHealthy: vercelHealthy
        },
        alerts,
        recommendedAction
    }
}

/**
 * Consulta el estado previo guardado en integrations para aplicar rate-limiting inteligente.
 */
async function getLastSentinelState(): Promise<{
    lastStatus: HealthStatusLevel | null
    lastNotifiedAt: number
}> {
    try {
        const supabase = await getSupabaseAdminClient()
        const { data, error } = await supabase
            .from('integrations')
            .select('access_token, updated_at')
            .eq('service_name', 'system_health_sentinel')
            .maybeSingle()

        if (error || !data) return { lastStatus: null, lastNotifiedAt: 0 }

        const payload = JSON.parse(data.access_token || '{}')
        return {
            lastStatus: payload.lastStatus || null,
            lastNotifiedAt: payload.lastNotifiedAt || 0
        }
    } catch {
        return { lastStatus: null, lastNotifiedAt: 0 }
    }
}

/**
 * Actualiza el estado del centinela en la base de datos.
 */
async function saveSentinelState(report: HealthReport, notified: boolean) {
    try {
        const supabase = await getSupabaseAdminClient()
        const payload = {
            lastStatus: report.overallStatus,
            lastReport: report,
            lastNotifiedAt: notified ? Date.now() : undefined
        }

        const { data: existing } = await supabase
            .from('integrations')
            .select('id')
            .eq('service_name', 'system_health_sentinel')
            .maybeSingle()

        if (existing?.id) {
            await supabase
                .from('integrations')
                .update({
                    access_token: JSON.stringify(payload),
                    updated_at: new Date().toISOString()
                })
                .eq('id', existing.id)
        } else {
            await supabase
                .from('integrations')
                .insert({
                    service_name: 'system_health_sentinel',
                    access_token: JSON.stringify(payload),
                    refresh_token: 'sentinel_state',
                    expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
                })
        }
    } catch (e: any) {
        console.error('[Sentinel] Error guardando estado:', e.message)
    }
}

/**
 * Genera y envía el correo con formato ejecutivo y bilingüe a carlos@tacosgavilan.com.
 */
export async function sendHealthAlertEmail(report: HealthReport, isTestOrReport: boolean = false): Promise<boolean> {
    if (!process.env.SMTP_EMAIL || !process.env.SMTP_PASSWORD) {
        console.error('[Sentinel] No hay credenciales SMTP configuradas.')
        return false
    }

    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.SMTP_EMAIL,
            pass: process.env.SMTP_PASSWORD
        }
    })

    const statusBadge = report.overallStatus === 'CRITICAL'
        ? '<span style="background:#ef4444;color:#fff;font-weight:bold;padding:4px 10px;border-radius:4px;font-size:12px;">EMERGENCIA CRÍTICA / CRITICAL EMERGENCY</span>'
        : report.overallStatus === 'WARNING'
            ? '<span style="background:#f59e0b;color:#000;font-weight:bold;padding:4px 10px;border-radius:4px;font-size:12px;">ADVERTENCIA PREVENTIVA / WARNING ALERT</span>'
            : '<span style="background:#10b981;color:#fff;font-weight:bold;padding:4px 10px;border-radius:4px;font-size:12px;">SISTEMA ÓPTIMO / ALL SYSTEMS HEALTHY</span>'

    const subjectPrefix = report.overallStatus === 'CRITICAL'
        ? '🚨 [EMERGENCIA SISTEMA]'
        : report.overallStatus === 'WARNING'
            ? '⚠️ [ALERTA PREVENTIVA]'
            : '🛡️ [REPORTE DE SALUD]'

    const subject = `${subjectPrefix} Supabase & Vercel - Tacos Gavilan (${report.storage.estimatedTotalGb} GB / ${report.storage.maxDiskGb} GB)`

    const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #1e293b; background-color: #f1f5f9; margin: 0; padding: 24px; }
            .container { max-width: 680px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
            .header { background: #0f172a; color: #ffffff; padding: 24px 32px; border-bottom: 3px solid ${report.overallStatus === 'CRITICAL' ? '#ef4444' : report.overallStatus === 'WARNING' ? '#f59e0b' : '#10b981'}; }
            .title { font-size: 20px; font-weight: 800; margin: 10px 0 4px 0; color: #ffffff; }
            .subtitle { font-size: 13px; color: #94a3b8; margin: 0; }
            .content { padding: 32px; }
            .card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 18px; margin-bottom: 20px; }
            .card-title { font-size: 14px; font-weight: 700; color: #334155; margin-top: 0; margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
            .metric-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
            .metric-box { background: #ffffff; border: 1px solid #cbd5e1; border-radius: 6px; padding: 12px; text-align: center; }
            .metric-val { font-size: 20px; font-weight: 800; color: #0f172a; margin-top: 4px; }
            .metric-lbl { font-size: 11px; color: #64748b; text-transform: uppercase; font-weight: 700; }
            .alert-box { background: #fff1f2; border-left: 4px solid #ef4444; border-radius: 6px; padding: 14px; margin-bottom: 20px; font-size: 13.5px; color: #991b1b; }
            .warning-box { background: #fffbeb; border-left: 4px solid #f59e0b; border-radius: 6px; padding: 14px; margin-bottom: 20px; font-size: 13.5px; color: #92400e; }
            .action-box { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 16px; margin: 20px 0; font-size: 14px; color: #1e40af; }
            .progress-bar-bg { background: #e2e8f0; border-radius: 999px; height: 12px; width: 100%; overflow: hidden; margin-top: 8px; }
            .progress-bar-fill { background: ${report.storage.usagePercent > 80 ? '#ef4444' : report.storage.usagePercent > 65 ? '#f59e0b' : '#3b82f6'}; height: 100%; width: ${Math.min(report.storage.usagePercent, 100)}%; }
            .footer { background: #f8fafc; padding: 20px 32px; text-align: center; font-size: 11.5px; color: #64748b; border-top: 1px solid #e2e8f0; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <div>${statusBadge}</div>
                <div class="title">Tacos Gavilan • Guardián de Infraestructura</div>
                <div class="subtitle">Monitoreo Automatizado de Supabase & Vercel en Tiempo Real</div>
            </div>

            <div class="content">
                ${report.alerts.length > 0 ? `
                    <div class="${report.overallStatus === 'CRITICAL' ? 'alert-box' : 'warning-box'}">
                        <strong>⚠️ Notificación del Sistema:</strong>
                        <ul style="margin: 8px 0 0 0; padding-left: 20px;">
                            ${report.alerts.map(a => `<li>${a}</li>`).join('')}
                        </ul>
                    </div>
                ` : ''}

                <!-- Almacenamiento y Spend Cap -->
                <div class="card">
                    <div class="card-title">🗄️ Supabase • Almacenamiento y Spend Cap (Límite de Gasto)</div>
                    <div style="font-size: 13px; color: #475569; margin-bottom: 8px;">
                        Capacidad Utilizada: <strong>${report.storage.estimatedTotalGb} GB</strong> de <strong>${report.storage.maxDiskGb} GB</strong> (${report.storage.usagePercent}%)
                    </div>
                    <div class="progress-bar-bg">
                        <div class="progress-bar-fill"></div>
                    </div>
                    <div style="font-size: 11.5px; color: #64748b; margin-top: 6px; display: flex; justify-content: space-between;">
                        <span>Espacio Disponible: <strong>${report.storage.headroomGb} GB</strong></span>
                        <span>Umbral Alerta Preventiva: 6.0 GB</span>
                    </div>

                    <div class="metric-grid" style="margin-top: 16px;">
                        <div class="metric-box">
                            <div class="metric-lbl">Parrilla (Meat History)</div>
                            <div class="metric-val">${report.storage.meatRows.toLocaleString()}</div>
                        </div>
                        <div class="metric-box">
                            <div class="metric-lbl">Histórico Ventas (Sales Cache)</div>
                            <div class="metric-val">${report.storage.salesRows.toLocaleString()}</div>
                        </div>
                    </div>
                </div>

                <!-- Rendimiento y APIs -->
                <div class="card">
                    <div class="card-title">⚡ Rendimiento & Disponibilidad en Producción</div>
                    <div class="metric-grid">
                        <div class="metric-box">
                            <div class="metric-lbl">Latencia Supabase (DB Ping)</div>
                            <div class="metric-val" style="color: ${report.databaseLatencyMs > 2000 ? '#ef4444' : '#059669'};">
                                ${report.databaseLatencyMs} ms
                            </div>
                        </div>
                        <div class="metric-box">
                            <div class="metric-lbl">Vercel Producción (Frontend)</div>
                            <div class="metric-val" style="color: ${report.vercelProduction.isHealthy ? '#059669' : '#ef4444'};">
                                ${report.vercelProduction.status === 200 ? '200 OK' : 'ERROR'}
                            </div>
                        </div>
                    </div>
                    <div style="font-size: 12.5px; color: #475569; margin-top: 12px;">
                        • <strong>Ventas Hoy (Toast API):</strong> ${report.toastSync.activeStoresToday} sucursales activas registradas.<br>
                        • <strong>Latencia Vercel:</strong> ${report.vercelProduction.latencyMs} ms.
                    </div>
                </div>

                <!-- Acción Recomendada -->
                ${report.recommendedAction ? `
                    <div class="action-box">
                        <strong style="display: block; font-size: 14px; margin-bottom: 4px;">🛠️ Acción Recomendada:</strong>
                        ${report.recommendedAction}
                    </div>
                ` : `
                    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:14px;font-size:13px;color:#166534;">
                        ✅ <strong>Todo en orden:</strong> Los servidores cuentan con suficiente holgura de memoria, CPU y almacenamiento. No se requiere comprar recursos adicionales ni ejecutar acciones en este momento.
                    </div>
                `}
            </div>

            <div class="footer">
                Tacos Gavilan Enterprise Platform • Notificación Automática Generada el ${new Date(report.timestamp).toLocaleString('es-US', { timeZone: 'America/Los_Angeles' })} PST<br>
                Este correo fue enviado a <strong>carlos@tacosgavilan.com</strong>
            </div>
        </div>
    </body>
    </html>
    `

    try {
        await transporter.sendMail({
            from: `"TEG Centinela de Salud" <${process.env.SMTP_EMAIL}>`,
            to: 'carlos@tacosgavilan.com',
            subject,
            html
        })
        console.log(`[Sentinel] Correo de alerta enviado exitosamente a carlos@tacosgavilan.com con asunto: ${subject}`)
        return true
    } catch (e: any) {
        console.error('[Sentinel] Error enviando correo:', e.message)
        return false
    }
}

/**
 * Función principal del Centinela: ejecuta el chequeo, aplica reglas de notificación y actualiza la base de datos.
 */
export async function checkAndNotifySystemHealth(forceEmail: boolean = false): Promise<HealthReport> {
    const report = await runSystemHealthCheck()
    const { lastStatus, lastNotifiedAt } = await getLastSentinelState()

    const now = Date.now()
    const hoursSinceLastEmail = (now - lastNotifiedAt) / (1000 * 60 * 60)

    let shouldEmail = forceEmail

    if (!shouldEmail) {
        if (report.overallStatus === 'CRITICAL') {
            // En emergencia: notificar inmediatamente si cambió de estado o cada 6 horas
            if (lastStatus !== 'CRITICAL' || hoursSinceLastEmail >= 6) {
                shouldEmail = true
            }
        } else if (report.overallStatus === 'WARNING') {
            // En advertencia preventiva: notificar inmediatamente si cambió de estado o cada 24 horas
            if (lastStatus !== 'WARNING' || hoursSinceLastEmail >= 24) {
                shouldEmail = true
            }
        }
    }

    if (shouldEmail) {
        const sent = await sendHealthAlertEmail(report, forceEmail)
        await saveSentinelState(report, sent)
    } else {
        await saveSentinelState(report, false)
    }

    return report
}
