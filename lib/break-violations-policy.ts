/**
 * @module lib/break-violations-policy
 * @description Política centralizada de evaluación de infracciones en descansos pagados (Rest Breaks de 10 min)
 * y almuerzos no pagados (Meal Lunches de 30 min), validación de correos de empleados y plantillas HTML oficiales
 * para empleados y Gerentes de Tienda en Tacos Gavilan.
 *
 * @businessRules
 * - Tiempos oficiales autorizados: 10 minutos exactos para Rest Break pagado y 30 minutos exactos para Meal Lunch no pagado.
 * - Margen técnico interno confidencial: +1 minuto en Break (10m y 11m cumplidos, hasta 11m 59s sin alerta; cortando en >= 12m 00s)
 *   y +2 minutos en Lunch (30m, 31m y 32m cumplidos, hasta 32m 59s sin alerta; cortando en >= 33m 00s).
 * - REGLA ESTRICTA DE CONFIDENCIALIDAD: Queda terminantemente prohibido mencionar o insinuar cualquier margen
 *   de tolerancia en correos electrónicos, reportes gerenciales, interfaz de usuario o respuestas del asistente.
 * - Responsabilidad compartida obligatoria:
 *   1) Cada empleado recibe aviso directo recordándole su obligación de respetar estrictamente sus 10m / 30m.
 *   2) El Gerente de Tienda recibe diariamente el reporte consolidado de su sucursal con recordatorio expreso
 *      de sus funciones de supervisión en piso, seguimiento individual y corrección inmediata.
 *
 * @dataFlow
 * - Usado por `/api/cron/sync-violations`, `/api/scheduler/violations/notify`, `/api/cron/report-breaks` y `/planificador`.
 *
 * @notes
 * - Usa minutos enteros cumplidos (`Math.floor(durationSeconds / 60)`) para evitar discrepancias de redondeo
 *   entre el umbral exacto de segundos y el número entero impreso en pantalla/correo.
 * - Todos los correos y reportes generados por este módulo especifican de forma explícita que corresponden a
 *   `PLANIFICADOR (EXCLUSIVO TOAST POS)`, diferenciándolos de la tarjeta oficial de nómina en RONOS (Cingular HR).
 */

export const AUTHORIZED_BREAK_MINUTES = 10
export const AUTHORIZED_LUNCH_MINUTES = 30

// Umbrales internos estrictamente confidenciales:
// Break: 10m autorizados + 1m tolerancia confidencial (10m y 11m limpios, hasta 11m 59s) -> infracción desde >= 12m 00s
// Lunch: 30m autorizados + 2m tolerancia confidencial (30m, 31m y 32m limpios, hasta 32m 59s) -> infracción desde >= 33m 00s
export const INTERNAL_BREAK_MIN_VIOLATION_MINUTES = 12
export const INTERNAL_LUNCH_MIN_VIOLATION_MINUTES = 33
export const SEVERE_PUNCH_ANOMALY_MINUTES = 60

export const KNOWN_OFFICIAL_CORPORATE_EMAILS = new Set([
    'noreply@tacosgavilan.com',
    'raquel@tacosgavilan.com',
    'roberto@tacosgavilan.com',
    'gonzalo@tacosgavilan.com',
    'carlos@tacosgavilan.com',
    'roque@tacosgavilan.com',
    'ricardo@tacosgavilan.com',
    'javier@tacosgavilan.com',
    'willian@tacosgavilan.com',
    'estefani@tacosgavilan.com',
    'erick@tacosgavilan.com',
    'eliseo@tacosgavilan.com',
    'support@tacosgavilan.com',
])

const NON_ROUTABLE_DOMAINS = new Set([
    'example.com',
    'example.org',
    'example.net',
    'toasttab.com',
    'tryotter.com',
    'localhost',
    'invalid',
    'test.com',
])

export interface BreakViolationEvaluation {
    isViolation: boolean
    type: 'BRK' | 'LUN'
    allowedMinutes: number
    actualMinutes: number
    actualExactMinutes: number
    excessMinutes: number
    isAnomaly: boolean
}

/**
 * Evalúa un bloque de descanso/comida de Toast POS contra la política oficial de Tacos Gavilan.
 */
export function evaluatePunchBreakViolation(params: {
    paid?: boolean | null
    inDate?: string | Date | null
    outDate?: string | Date | null
}): BreakViolationEvaluation | null {
    const { paid, inDate, outDate } = params
    if (!inDate || !outDate) return null

    const startMs = new Date(inDate).getTime()
    const endMs = new Date(outDate).getTime()
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
        return null
    }

    const durationSeconds = Math.floor((endMs - startMs) / 1000)
    const actualExactMinutes = (endMs - startMs) / 60_000
    const completedMinutes = Math.floor(durationSeconds / 60)

    const isPaidBreak = Boolean(paid)
    const type: 'BRK' | 'LUN' = isPaidBreak ? 'BRK' : 'LUN'
    const allowedMinutes = isPaidBreak ? AUTHORIZED_BREAK_MINUTES : AUTHORIZED_LUNCH_MINUTES
    const minViolationMinutes = isPaidBreak
        ? INTERNAL_BREAK_MIN_VIOLATION_MINUTES
        : INTERNAL_LUNCH_MIN_VIOLATION_MINUTES

    const isViolation = completedMinutes >= minViolationMinutes
    const excessMinutes = Math.max(0, completedMinutes - allowedMinutes)

    return {
        isViolation,
        type,
        allowedMinutes,
        actualMinutes: completedMinutes,
        actualExactMinutes,
        excessMinutes,
        isAnomaly: actualExactMinutes >= SEVERE_PUNCH_ANOMALY_MINUTES,
    }
}

export interface RecipientEmailValidation {
    deliverable: boolean
    cleanEmail: string | null
    reason: 'ok' | 'missing' | 'placeholder_domain' | 'invalid_syntax' | 'unregistered_corporate'
}

/**
 * Verifica que el correo del empleado en Toast POS sea entregable antes de despachar por Gmail API,
 * evitando rebotes (`Mail Delivery Subsystem`) hacia dominios ficticios de POS (`@toasttab.com`, `@example.com`)
 * o cuentas `@tacosgavilan.com` inexistentes.
 */
export function validateEmployeeViolationEmail(
    rawEmail?: string | null,
    registeredCorporateEmails?: Set<string>
): RecipientEmailValidation {
    if (!rawEmail || typeof rawEmail !== 'string') {
        return { deliverable: false, cleanEmail: null, reason: 'missing' }
    }

    const clean = rawEmail.trim().toLowerCase()
    if (!clean) {
        return { deliverable: false, cleanEmail: null, reason: 'missing' }
    }

    const basicEmailRegex = /^[^\s@]+@([^\s@]+\.[^\s@]{2,})$/
    const match = clean.match(basicEmailRegex)
    if (!match) {
        return { deliverable: false, cleanEmail: null, reason: 'invalid_syntax' }
    }

    const domain = match[1]
    if (NON_ROUTABLE_DOMAINS.has(domain)) {
        return { deliverable: false, cleanEmail: null, reason: 'placeholder_domain' }
    }

    if (domain === 'tacosgavilan.com' && registeredCorporateEmails && registeredCorporateEmails.size > 0) {
        if (!registeredCorporateEmails.has(clean) && !KNOWN_OFFICIAL_CORPORATE_EMAILS.has(clean)) {
            return { deliverable: false, cleanEmail: null, reason: 'unregistered_corporate' }
        }
    }

    return { deliverable: true, cleanEmail: clean, reason: 'ok' }
}

export function escapeHtmlSafe(value: unknown): string {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
}

export function formatTimeLA(isoString?: string | null): string {
    if (!isoString) return '--'
    const d = new Date(isoString)
    if (Number.isNaN(d.getTime())) return '--'
    return d.toLocaleTimeString('en-US', {
        timeZone: 'America/Los_Angeles',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
    })
}

export function formatBusinessDateEs(isoDate?: string | null): string {
    if (!isoDate) return ''
    const clean = String(isoDate).slice(0, 10)
    const date = new Date(`${clean}T12:00:00`)
    if (Number.isNaN(date.getTime())) return clean
    return date.toLocaleDateString('es-ES', {
        timeZone: 'America/Los_Angeles',
        weekday: 'short',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
    })
}

/**
 * Construye el correo individual de responsabilidad para el empleado que excedió su Break (10m) o Lunch (30m).
 * CERO mención de tolerancia; enfatiza responsabilidad individual y notifica que Gerencia dará seguimiento.
 */
export function buildEmployeeBreakViolationEmailHtml(params: {
    storeName: string
    employeeName: string
    type: 'BRK' | 'LUN'
    businessDate: string
    inDate: string
    outDate: string
    allowedMinutes: number
    actualMinutes: number
    managerContactEmail?: string | null
}): { subject: string; html: string } {
    const {
        storeName,
        employeeName,
        type,
        businessDate,
        inDate,
        outDate,
        allowedMinutes,
        actualMinutes,
        managerContactEmail,
    } = params

    const excessMinutes = Math.max(1, actualMinutes - allowedMinutes)
    const typeName = type === 'BRK' ? 'Break de 10 minutos' : 'Lunch de 30 minutos'
    const subject = `⚠️ Planificador (Toast POS): Aviso de Tiempo Excedido en ${typeName} — ${storeName}`

    const html = `
        <div style="font-family: Arial, Helvetica, sans-serif; color: #1f2937; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden; background-color: #ffffff;">
            <div style="background-color: #b91c1c; color: #ffffff; padding: 22px 20px; text-align: center;">
                <div style="font-size: 11px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; opacity: 0.9; margin-bottom: 4px;">TACOS GAVILAN • PLANIFICADOR (EXCLUSIVO TOAST POS)</div>
                <h2 style="margin: 0; font-size: 20px; font-weight: 800; text-transform: uppercase;">Aviso de Tiempo Excedido (Toast POS)</h2>
                <p style="margin: 6px 0 0 0; opacity: 0.95; font-size: 13px;">Sucursal: <strong>${escapeHtmlSafe(storeName)}</strong></p>
            </div>
            <div style="padding: 24px;">
                <p style="font-size: 15px; margin-top: 0;">Hola <strong>${escapeHtmlSafe(employeeName)}</strong>,</p>
                <p style="font-size: 14px; line-height: 1.6; color: #374151;">
                    En la terminal de Toast POS se registró que excediste la duración autorizada de tu <strong>${escapeHtmlSafe(typeName)}</strong> correspondiente a la jornada del <strong>${escapeHtmlSafe(formatBusinessDateEs(businessDate))}</strong>.
                </p>

                <div style="background-color: #eff6ff; border: 1px solid #bfdbfe; border-left: 4px solid #2563eb; border-radius: 8px; padding: 12px 14px; margin: 16px 0; font-size: 13px; color: #1e3a8a; line-height: 1.55;">
                    🖥️ <strong>Exclusivo Sistema Toast POS (Planificador):</strong> Este aviso proviene únicamente de tus ponchadas operativas de Break/Lunch registradas en Toast POS. Es independiente de tu tarjeta oficial de pago en RONOS (Cingular HR).
                </div>

                <div style="background-color: #fef2f2; border-left: 4px solid #dc2626; padding: 16px; border-radius: 8px; margin: 20px 0;">
                    <p style="margin: 0 0 8px 0; font-weight: 700; color: #991b1b; font-size: 14px;">Detalle oficial de tu ponchada en la terminal de Toast POS:</p>
                    <ul style="margin: 0; padding-left: 20px; color: #1f2937; font-size: 14px; line-height: 1.7;">
                        <li>Hora de salida: <strong>${escapeHtmlSafe(formatTimeLA(inDate))}</strong></li>
                        <li>Hora de regreso: <strong>${escapeHtmlSafe(formatTimeLA(outDate))}</strong></li>
                        <li>Tiempo oficial autorizado: <strong>${allowedMinutes} minutos exactos</strong></li>
                        <li>Tiempo registrado: <strong style="color: #b91c1c;">${actualMinutes} minutos (+${excessMinutes} min excedidos)</strong></li>
                    </ul>
                </div>

                <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px 16px; margin: 18px 0; font-size: 13px; color: #334155; line-height: 1.6;">
                    <strong>Compromiso y Responsabilidad Individual:</strong><br/>
                    En <strong>Tacos Gavilan</strong> es responsabilidad directa de cada colaborador controlar su tiempo y registrar su regreso puntualmente en la terminal de Toast POS al cumplirse los <strong>${allowedMinutes} minutos</strong> autorizados, respetando el turno de relevo de sus compañeros y la operación de la tienda. Tu Gerente de Tienda ha recibido copia de este registro para darle seguimiento directo contigo.
                </div>

                <p style="font-size: 13px; color: #475569; line-height: 1.5;">
                    Si tuviste alguna incidencia legítima en la terminal de Toast POS, repórtalo de inmediato con tu Gerente de Tienda${managerContactEmail ? ` (<a href="mailto:${escapeHtmlSafe(managerContactEmail)}" style="color: #b91c1c; font-weight: 600;">${escapeHtmlSafe(managerContactEmail)}</a>)` : ''}.
                </p>

                <div style="border-top: 1px solid #e5e7eb; margin-top: 22px; padding-top: 14px; font-size: 12px; color: #6b7280;">
                    Atentamente,<br/>
                    <strong>Sistema de Monitoreo</strong><br/>
                    Tacos Gavilan
                </div>
            </div>
        </div>
    `

    return { subject, html }
}

export interface ManagerDailyViolationItem {
    employeeName: string
    type: 'BRK' | 'LUN'
    allowedMinutes: number
    actualMinutes: number
    inDate: string
    outDate: string
    isAnomaly: boolean
    deliveryStatusLabel: string
    emailDelivered: boolean
}

/**
 * Construye el reporte diario obligatorio para el Gerente de Tienda (con copia al Supervisor de Zona),
 * enlistando a cada empleado infractor y recordándole expresamente sus responsabilidades gerenciales diarias.
 */
export function buildManagerDailyViolationReportHtml(params: {
    storeName: string
    businessDate: string
    items: ManagerDailyViolationItem[]
    isManualDispatch?: boolean
}): { subject: string; html: string } {
    const { storeName, businessDate, items, isManualDispatch = false } = params
    const totalViolations = items.length
    const totalBreaks = items.filter((i) => i.type === 'BRK').length
    const totalLunches = items.filter((i) => i.type === 'LUN').length
    const uniqueEmployees = new Set(items.map((i) => i.employeeName)).size

    const rowsHtml = items
        .map((v) => {
            const typeBadge =
                v.type === 'BRK'
                    ? '<span style="background-color: #fef3c7; color: #92400e; padding: 3px 8px; border-radius: 9999px; font-weight: 700; font-size: 11px; white-space: nowrap;">☕ Break (10m)</span>'
                    : '<span style="background-color: #ede9fe; color: #5b21b6; padding: 3px 8px; border-radius: 9999px; font-weight: 700; font-size: 11px; white-space: nowrap;">🍽️ Lunch (30m)</span>'
            const anomalyBadge = v.isAnomaly
                ? '<div style="margin-top: 3px;"><span style="color: #b91c1c; font-weight: 700; font-size: 10px; background: #fee2e2; padding: 2px 6px; border-radius: 4px; display: inline-block;">⚠️ ANOMALÍA (&ge;60m): Verificar ponchada</span></div>'
                : ''
            const excess = Math.max(1, v.actualMinutes - v.allowedMinutes)

            return `
                <tr>
                    <td style="padding: 10px 8px; border-bottom: 1px solid #e5e7eb; font-weight: 700; color: #111827;">
                        ${escapeHtmlSafe(v.employeeName)}
                        ${anomalyBadge}
                    </td>
                    <td style="padding: 10px 8px; border-bottom: 1px solid #e5e7eb;">${typeBadge}</td>
                    <td style="padding: 10px 8px; border-bottom: 1px solid #e5e7eb; text-align: center; color: #4b5563;">${v.allowedMinutes}m</td>
                    <td style="padding: 10px 8px; border-bottom: 1px solid #e5e7eb; text-align: center; color: #dc2626; font-weight: 800;">${v.actualMinutes} min</td>
                    <td style="padding: 10px 8px; border-bottom: 1px solid #e5e7eb; text-align: center; color: #991b1b; font-weight: 700;">+${excess}m</td>
                    <td style="padding: 10px 8px; border-bottom: 1px solid #e5e7eb; text-align: center; white-space: nowrap; font-size: 12px; color: #374151;">${escapeHtmlSafe(formatTimeLA(v.inDate))} ➔ ${escapeHtmlSafe(formatTimeLA(v.outDate))}</td>
                    <td style="padding: 10px 8px; border-bottom: 1px solid #e5e7eb; font-size: 12px; font-weight: 600; color: ${v.emailDelivered ? '#047857' : '#b45309'};">
                        ${escapeHtmlSafe(v.deliveryStatusLabel)}
                    </td>
                </tr>
            `
        })
        .join('')

    const subject = `📋 Planificador (Toast POS): Acción Gerencial por Breaks/Lunches — ${storeName} (${businessDate})`

    const html = `
        <div style="font-family: Arial, Helvetica, sans-serif; color: #1f2937; max-width: 820px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden; background-color: #ffffff;">
            <div style="background-color: #1e293b; color: #ffffff; padding: 22px 20px; text-align: center;">
                <div style="font-size: 11px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; color: #fca5a5; margin-bottom: 4px;">TACOS GAVILAN • PLANIFICADOR (EXCLUSIVO TOAST POS)</div>
                <h2 style="margin: 0; text-transform: uppercase; font-size: 19px; font-weight: 800;">Reporte Diario de Control de Breaks y Lunches (Toast POS)</h2>
                <p style="margin: 6px 0 0 0; opacity: 0.95; font-size: 14px;">Sucursal: <strong>${escapeHtmlSafe(storeName)}</strong> — Jornada Auditada: <strong>${escapeHtmlSafe(formatBusinessDateEs(businessDate))}</strong></p>
                <p style="margin: 4px 0 0 0; font-size: 11px; opacity: 0.75;">${isManualDispatch ? 'Despacho oficial inmediato registrado en la terminal de Toast POS.' : 'Despacho diario automático tras el cierre de la ventana matutina de revisión en Toast POS.'}</p>
            </div>

            <div style="padding: 24px;">
                <p style="margin-top: 0; font-size: 15px;"><strong>Estimado(a) Gerente de Tienda (${escapeHtmlSafe(storeName)}):</strong></p>
                <p style="color: #374151; font-size: 14px; line-height: 1.6;">
                    Durante la jornada del <strong>${escapeHtmlSafe(formatBusinessDateEs(businessDate))}</strong> se registraron en la terminal de <strong>Toast POS</strong> los siguientes excesos sobre los tiempos oficiales autorizados de descanso (<strong>10 minutos en Break</strong> y <strong>30 minutos en Lunch</strong>). Este reporte audita exclusivamente las ponchadas operativas de Toast POS (Planificador) y es independiente de la tarjeta de nómina de RONOS (Cingular HR). Como Gerente de Tienda, es tu responsabilidad directa revisar cada caso hoy mismo y tomar acción inmediata con tu personal para evitar que estas situaciones se repitan.
                </p>

                <!-- KPI Summary -->
                <table style="width: 100%; border-collapse: separate; border-spacing: 8px; margin: 16px 0;">
                    <tr>
                        <td style="width: 25%; background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 12px 8px; text-align: center;">
                            <div style="font-size: 10px; font-weight: 700; text-transform: uppercase; color: #991b1b;">Total Excesos</div>
                            <div style="font-size: 22px; font-weight: 800; color: #b91c1c; margin-top: 2px;">${totalViolations}</div>
                        </td>
                        <td style="width: 25%; background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 12px 8px; text-align: center;">
                            <div style="font-size: 10px; font-weight: 700; text-transform: uppercase; color: #92400e;">Breaks (10m)</div>
                            <div style="font-size: 22px; font-weight: 800; color: #d97706; margin-top: 2px;">${totalBreaks}</div>
                        </td>
                        <td style="width: 25%; background: #faf5ff; border: 1px solid #e9d5ff; border-radius: 8px; padding: 12px 8px; text-align: center;">
                            <div style="font-size: 10px; font-weight: 700; text-transform: uppercase; color: #6b21a8;">Lunches (30m)</div>
                            <div style="font-size: 22px; font-weight: 800; color: #7c3aed; margin-top: 2px;">${totalLunches}</div>
                        </td>
                        <td style="width: 25%; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 8px; text-align: center;">
                            <div style="font-size: 10px; font-weight: 700; text-transform: uppercase; color: #334155;">Empleados</div>
                            <div style="font-size: 22px; font-weight: 800; color: #1e293b; margin-top: 2px;">${uniqueEmployees}</div>
                        </td>
                    </tr>
                </table>

                <!-- Violations Table -->
                <table style="width: 100%; border-collapse: collapse; margin: 18px 0; font-size: 13px; text-align: left;">
                    <thead>
                        <tr style="background-color: #f1f5f9; color: #334155; border-bottom: 2px solid #cbd5e1;">
                            <th style="padding: 10px 8px;">Empleado</th>
                            <th style="padding: 10px 8px;">Tipo</th>
                            <th style="padding: 10px 8px; text-align: center;">Autorizado</th>
                            <th style="padding: 10px 8px; text-align: center;">Registrado</th>
                            <th style="padding: 10px 8px; text-align: center;">Exceso</th>
                            <th style="padding: 10px 8px; text-align: center;">Salida ➔ Regreso</th>
                            <th style="padding: 10px 8px;">Aviso al Empleado</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rowsHtml}
                    </tbody>
                </table>

                <!-- Mandatory Manager Responsibilities Box -->
                <div style="background-color: #fff7ed; border: 1px solid #fdba74; border-left: 5px solid #ea580c; border-radius: 8px; padding: 16px 18px; margin-top: 22px; font-size: 13px; color: #431407; line-height: 1.6;">
                    <div style="font-weight: 800; font-size: 14px; text-transform: uppercase; color: #9a3412; margin-bottom: 8px;">
                        📌 Recordatorio de Funciones y Responsabilidad del Gerente de Tienda:
                    </div>
                    <ol style="margin: 0; padding-left: 20px;">
                        <li style="margin-bottom: 6px;"><strong>Supervisión Activa en Piso:</strong> Vigilar en tiempo real las salidas y regresos de cada <em>Break</em> (10 min exactos) y <em>Lunch</em> (30 min exactos) utilizando la Tableta de Descansos para evitar retrasos y desajustes en los relevos.</li>
                        <li style="margin-bottom: 6px;"><strong>Acción Correctiva Individual Hoy Mismo:</strong> Hablar personalmente con cada empleado enlistado arriba, darle retroalimentación directa y aplicar las acciones disciplinarias correspondientes en caso de reincidencia.</li>
                        <li style="margin-bottom: 6px;"><strong>Revisión Matutina en Toast POS (Antes de las 11:59 AM):</strong> Auditar diariamente las ponchadas del día anterior a primera hora para corregir cualquier error real de reloj antes del cierre diario automático.</li>
                        <li><strong>Correos Actualizados en Toast POS:</strong> Si algún empleado aparece marcado sin correo válido, notificarle verbalmente hoy mismo y actualizar su correo personal real en Toast POS.</li>
                    </ol>
                </div>

                <p style="font-size: 12px; color: #64748b; margin-top: 22px; text-align: center;">
                    <strong>Sistema de Monitoreo</strong> — Tacos Gavilan (CC Supervisor de Zona).
                </p>
            </div>
        </div>
    `

    return { subject, html }
}
