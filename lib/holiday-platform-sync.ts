/**
 * @module lib/holiday-platform-sync
 * @description Motor perpetuo e idempotente de sincronización de los 7 días festivos oficiales de Tacos Gavilan
 * hacia las 4 plataformas externas con API (Google Business Profile, Grubhub, DoorDash y Uber Eats),
 * con soporte multi-año automático (2023–2099), guardas de madrugada (spillover guards) agnósticas al día
 * de la semana y alertas automáticas por correo ante expiración de sesión o recordatorio anual de Apple/Bing.
 *
 * @businessRules
 * - Fuente única de verdad de festivos: `getUpcomingOfficialStoreHolidays` / `getOfficialStoreHolidaySchedule` en `lib/holidays.ts`
 *   (7 fechas oficiales anuales: Año Nuevo 11 AM, Viernes Santo Cerrado, Thanksgiving 4 PM, Black Friday 11 AM,
 *   Nochebuena 4 PM, Navidad Cerrado, Fin de Año 4 PM).
 * - Fuente única de horarios regulares de las 15 sucursales: `public.stores.weekly_hours` (normalizado vía `normalizeWeeklyHours`).
 * - Idempotencia estricta: siempre lee el estado actual de cada plataforma y SOLO escribe cuando falta alguna
 *   fecha dentro de la ventana rodante (`horizonDays`, por defecto 330 días / ~11 meses, siempre < 365 días para evitar límites de API) o difiere del horario oficial.
 * - Protección de madrugada (*overnight spillover*):
 *   - Días posteriores a cierres totales (Navidad / Viernes Santo) reciben guarda explícita en Google y Uber Eats
 *     siempre que el día festivo cerrado normalmente derrame después de medianoche (`01:00–05:59`), sin importar
 *     en qué día de la semana caiga en años futuros (2027, 2028, 2029...).
 *   - Días de cierre temprano (`16:00`) preservan la madrugada del día anterior en Uber Eats si el día anterior fue regular.
 * - Protección de servidores: `AbortSignal.timeout(15_000)` en todo `fetch()`, cero `SELECT *`, ejecución
 *   secuencial por tienda con pausas cortas y presupuesto de tiempo acotado.
 * - Alertas automáticas desde `noreply@tacosgavilan.com` a `carlos@tacosgavilan.com` únicamente cuando:
 *   1) Falla autenticación de DoorDash/Uber Eats (`401/403`) teniendo un festivo en <= 60 días, o
 *   2) Recordatorio preventivo de renovación anual de Apple Business Connect (sin API permanente) y Bing Sync
 *      en octubre y febrero (máximo 1 vez por mes).
 *
 * @dataFlow
 * - Vercel Cron (`17 11 1 * *`, día 1 de cada mes 3:17 AM PT) -> GET `/api/cron/sync-holiday-hours`
 *   -> `syncUpcomingHolidaysAcrossPlatforms()` -> Google Business Profile + Grubhub + DoorDash + Uber Eats
 *   -> resumen JSON + alerta condicional vía `lib/system-mailer.ts`.
 *
 * @notes
 * - Soporta `dryRun: true` para auditar en vivo las 4 plataformas sin mutar ningún dato.
 * - Compatible con años futuros donde 24/25 dic o 31 dic/1 ene caigan en viernes/sábado/domingo/lunes.
 */

import { getSupabaseAdminClient } from '@/lib/supabase'
import {
    getOfficialStoreHolidaySchedule,
    getUpcomingOfficialStoreHolidays,
    type OfficialStoreHolidayRule,
} from '@/lib/holidays'
import { normalizeWeeklyHours } from '@/lib/phone-agent'
import {
    decryptIntegrationSecret,
    getGrubhubMerchantToken,
} from '@/lib/delivery-reconciliation'
import { sendSystemEmail } from '@/lib/system-mailer'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const FETCH_TIMEOUT_MS = 15_000

export type SupportedPlatform = 'gbp' | 'grubhub' | 'doordash' | 'ubereats'

export interface StoreWeeklyWindow {
    open: string  // HH:MM
    close: string // HH:MM
}

export interface SyncStoreContext {
    id: number
    code: string
    name: string
    address: string
    phone: string
    weekly: Record<number, StoreWeeklyWindow> // 0=Sun..6=Sat
    doordashStoreId: string
    doordashBusinessId: string
    ubereatsStoreUuid: string
    grubhubCustId: string
}

export interface PlatformSyncSummary {
    platform: SupportedPlatform
    status: 'ok' | 'auth_expired' | 'skipped' | 'error'
    storesChecked: number
    storesAlreadySynced: number
    storesUpdated: number
    storesFailed: number
    details: Array<{
        storeId: number
        storeName: string
        action: 'already_synced' | 'would_update' | 'updated' | 'error'
        diffs?: string[]
        error?: string
    }>
    error?: string
}

export interface HolidaySyncReport {
    executedAt: string
    todayLA: string
    horizonDays: number
    dryRun: boolean
    upcomingHolidays: Array<{
        date: string
        key: OfficialStoreHolidayRule['holiday_key']
        nameEn: string
        isClosed: boolean
        openTime: string | null
        closeTime: string | null
    }>
    platforms: Record<SupportedPlatform, PlatformSyncSummary>
    emailAlertSent: boolean
    emailReason: string | null
}

// ============================================================================
// PURE CALENDAR & TIME HELPERS (100% DAY-OF-WEEK AGNOSTIC, 2023–2099)
// ============================================================================

export function getTodayDateLA(nowDate: Date = new Date()): string {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Los_Angeles',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(nowDate)
    const y = parts.find((p) => p.type === 'year')?.value || '2026'
    const m = parts.find((p) => p.type === 'month')?.value || '01'
    const d = parts.find((p) => p.type === 'day')?.value || '01'
    return `${y}-${m}-${d}`
}

export function shiftDateUTC(dateStr: string, deltaDays: number): string {
    const [y, m, d] = dateStr.split('-').map(Number)
    return new Date(Date.UTC(y, m - 1, d + deltaDays, 12, 0, 0)).toISOString().slice(0, 10)
}

export function getDayOfWeekUTC(dateStr: string): number {
    const [y, m, d] = dateStr.split('-').map(Number)
    return new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).getUTCDay() // 0=Sun..6=Sat
}

export function parseYMD(dateStr: string): { year: number; month: number; day: number } {
    const [year, month, day] = dateStr.split('-').map(Number)
    return { year, month, day }
}

export function parseHHMM(hhmm: string): { hours: number; minutes: number } {
    const [h, m] = String(hhmm || '00:00').split(':').map(Number)
    return { hours: Number.isFinite(h) ? h : 0, minutes: Number.isFinite(m) ? m : 0 }
}

export function normalizeHHMM(raw: string): string {
    const { hours, minutes } = parseHHMM(raw)
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

export function isAfterMidnightClose(closeHHMM: string): boolean {
    const { hours, minutes } = parseHHMM(closeHHMM)
    return (hours > 0 && hours < 6) || (hours === 0 && minutes > 0)
}

export function isMidnightClose(closeHHMM: string): boolean {
    const norm = normalizeHHMM(closeHHMM)
    return norm === '00:00' || norm === '24:00' || norm === '23:59'
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ============================================================================
// 1. GOOGLE BUSINESS PROFILE — PURE PAYLOAD BUILDER & SYNC
// ============================================================================

export interface GbpTimeOfDay {
    hours?: number
    minutes?: number
}

export interface GbpSpecialPeriod {
    startDate: { year: number; month: number; day: number }
    endDate: { year: number; month: number; day: number }
    openTime?: GbpTimeOfDay
    closeTime?: GbpTimeOfDay
    closed: boolean
}

function mkGbpTime(hhmm: string): GbpTimeOfDay {
    const { hours, minutes } = parseHHMM(hhmm)
    return minutes ? { hours, minutes } : { hours }
}

export function buildGbpExpectedSpecialPeriods(
    weekly: Record<number, StoreWeeklyWindow>,
    holidays: OfficialStoreHolidayRule[]
): GbpSpecialPeriod[] {
    const periods: GbpSpecialPeriod[] = []
    const coveredDates = new Set<string>()

    for (const h of holidays) {
        const dow = getDayOfWeekUTC(h.event_date)
        const nextDate = shiftDateUTC(h.event_date, 1)
        const nextDow = (dow + 1) % 7
        const regToday = weekly[dow]
        const regNext = weekly[nextDow]
        const nextHoliday = getOfficialStoreHolidaySchedule(nextDate)

        if (h.is_closed) {
            periods.push({
                startDate: parseYMD(h.event_date),
                endDate: parseYMD(h.event_date),
                closed: true,
            })
            coveredDates.add(h.event_date)

            // Spillover guard for day immediately after a CLOSED holiday if closed day normally spilled past midnight
            if (!nextHoliday && isAfterMidnightClose(regToday.close) && !coveredDates.has(nextDate)) {
                const nextSpills = isAfterMidnightClose(regNext.close)
                const nextMidnight = isMidnightClose(regNext.close)
                periods.push({
                    startDate: parseYMD(nextDate),
                    openTime: mkGbpTime(regNext.open),
                    endDate: parseYMD(nextSpills ? shiftDateUTC(nextDate, 1) : nextDate),
                    closeTime: nextSpills
                        ? mkGbpTime(regNext.close)
                        : nextMidnight
                            ? { hours: 24 }
                            : mkGbpTime(regNext.close),
                    closed: false,
                })
                coveredDates.add(nextDate)
            }
        } else if (h.close_time) {
            periods.push({
                startDate: parseYMD(h.event_date),
                openTime: mkGbpTime(regToday.open),
                endDate: parseYMD(h.event_date),
                closeTime: mkGbpTime(h.close_time),
                closed: false,
            })
            coveredDates.add(h.event_date)
        } else if (h.open_time) {
            const todaySpills = isAfterMidnightClose(regToday.close)
            const todayMidnight = isMidnightClose(regToday.close)
            periods.push({
                startDate: parseYMD(h.event_date),
                openTime: mkGbpTime(h.open_time),
                endDate: parseYMD(todaySpills ? nextDate : h.event_date),
                closeTime: todaySpills
                    ? mkGbpTime(regToday.close)
                    : todayMidnight
                        ? { hours: 24 }
                        : mkGbpTime(regToday.close),
                closed: false,
            })
            coveredDates.add(h.event_date)
        }
    }

    return periods
}

function gbpDateKey(d?: { year?: number; month?: number; day?: number }): string {
    if (!d?.year || !d?.month || !d?.day) return ''
    return `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`
}

function gbpTimeKey(t?: GbpTimeOfDay): string {
    if (!t) return ''
    return `${String(t.hours ?? 0).padStart(2, '0')}:${String(t.minutes ?? 0).padStart(2, '0')}`
}

function gbpPeriodSig(p: GbpSpecialPeriod): string {
    const startKey = gbpDateKey(p.startDate)
    if (p.closed) return `${startKey}|${gbpDateKey(p.endDate) || startKey}|CLOSED`
    let endKey = gbpDateKey(p.endDate)
    let closeKey = gbpTimeKey(p.closeTime)
    // Google Business Profile API normalizes same-day midnight close (24:00) into nextDate + 00:00 (empty closeTime `{}`)
    if (startKey && endKey === shiftDateUTC(startKey, 1) && closeKey === '00:00') {
        endKey = startKey
        closeKey = '24:00'
    }
    return `${startKey}|${endKey}|${gbpTimeKey(p.openTime)}-${closeKey}`
}

async function syncGbpHolidays(
    stores: SyncStoreContext[],
    holidays: OfficialStoreHolidayRule[],
    todayLA: string,
    dryRun: boolean
): Promise<PlatformSyncSummary> {
    const summary: PlatformSyncSummary = {
        platform: 'gbp',
        status: 'ok',
        storesChecked: 0,
        storesAlreadySynced: 0,
        storesUpdated: 0,
        storesFailed: 0,
        details: [],
    }

    const clientId = process.env.GOOGLE_CLIENT_ID
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET
    const refreshToken = process.env.GOOGLE_REFRESH_TOKEN
    if (!clientId || !clientSecret || !refreshToken) {
        summary.status = 'auth_expired'
        summary.error = 'Missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN'
        return summary
    }

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            refresh_token: refreshToken,
            grant_type: 'refresh_token',
        }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    const tokenJson: any = await tokenRes.json().catch(() => ({}))
    if (!tokenRes.ok || !tokenJson.access_token) {
        summary.status = 'auth_expired'
        summary.error = `Google OAuth HTTP ${tokenRes.status}: ${tokenJson.error || 'unknown'}`
        return summary
    }
    const token: string = tokenJson.access_token

    // List live GBP accounts & locations
    const accRes = await fetch('https://mybusinessaccountmanagement.googleapis.com/v1/accounts', {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!accRes.ok) {
        summary.status = accRes.status === 401 || accRes.status === 403 ? 'auth_expired' : 'error'
        summary.error = `GBP accounts HTTP ${accRes.status}`
        return summary
    }
    const accounts: any[] = (await accRes.json()).accounts || []
    const gbpLocations: any[] = []
    for (const acc of accounts) {
        let pageToken: string | null = null
        do {
            const u = new URL(`https://mybusinessbusinessinformation.googleapis.com/v1/${acc.name}/locations`)
            u.searchParams.set('pageSize', '100')
            u.searchParams.set('readMask', 'name,storefrontAddress,phoneNumbers,specialHours')
            if (pageToken) u.searchParams.set('pageToken', pageToken)
            const lr = await fetch(u.toString(), {
                headers: { Authorization: `Bearer ${token}` },
                signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
            })
            if (!lr.ok) throw new Error(`GBP list locations HTTP ${lr.status}`)
            const lj: any = await lr.json()
            gbpLocations.push(...(lj.locations || []))
            pageToken = lj.nextPageToken || null
        } while (pageToken)
    }

    const normPhone = (p: string) => String(p || '').replace(/\D/g, '').slice(-10)
    const normStreetNum = (addr: string) => (String(addr || '').match(/\b\d{3,5}\b/) || [''])[0]

    for (const st of stores) {
        summary.storesChecked++
        const stPhone = normPhone(st.phone)
        const stNum = normStreetNum(st.address)
        const gbp = gbpLocations.find((l) => {
            const p = normPhone(l.phoneNumbers?.primaryPhone || '')
            if (stPhone && p === stPhone) return true
            const lAddr = (l.storefrontAddress?.addressLines || []).join(' ')
            return Boolean(stNum && lAddr.includes(stNum))
        })
        if (!gbp) {
            summary.storesFailed++
            summary.details.push({ storeId: st.id, storeName: st.name, action: 'error', error: 'GBP location match not found' })
            continue
        }

        const expectedPeriods = buildGbpExpectedSpecialPeriods(st.weekly, holidays)
        const existingPeriods: GbpSpecialPeriod[] = gbp.specialHours?.specialHourPeriods || []
        const existingSigs = new Set(existingPeriods.map(gbpPeriodSig))
        const expectedStartDates = new Set(expectedPeriods.map((p) => gbpDateKey(p.startDate)))

        const missingOrDifferent: string[] = []
        for (const ep of expectedPeriods) {
            const sig = gbpPeriodSig(ep)
            if (!existingSigs.has(sig)) {
                missingOrDifferent.push(sig)
            }
        }

        if (missingOrDifferent.length === 0) {
            summary.storesAlreadySynced++
            summary.details.push({ storeId: st.id, storeName: st.name, action: 'already_synced' })
            continue
        }

        if (dryRun) {
            summary.storesUpdated++
            summary.details.push({ storeId: st.id, storeName: st.name, action: 'would_update', diffs: missingOrDifferent })
            continue
        }

        // Preserve any unrelated future specialHours dates, replace managed holiday dates cleanly
        const preserved = existingPeriods.filter((ep) => {
            const dk = gbpDateKey(ep.startDate)
            return dk >= todayLA && !expectedStartDates.has(dk)
        })
        const merged = [...preserved, ...expectedPeriods].sort((a, b) =>
            gbpDateKey(a.startDate).localeCompare(gbpDateKey(b.startDate))
        )

        const pr = await fetch(
            `https://mybusinessbusinessinformation.googleapis.com/v1/${gbp.name}?updateMask=specialHours`,
            {
                method: 'PATCH',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ specialHours: { specialHourPeriods: merged } }),
                signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
            }
        )
        if (!pr.ok) {
            const errTxt = (await pr.text()).slice(0, 220)
            summary.storesFailed++
            summary.details.push({ storeId: st.id, storeName: st.name, action: 'error', error: `PATCH HTTP ${pr.status}: ${errTxt}` })
        } else {
            summary.storesUpdated++
            summary.details.push({ storeId: st.id, storeName: st.name, action: 'updated', diffs: missingOrDifferent })
        }
        await sleep(160)
    }

    if (summary.storesFailed > 0 && summary.storesUpdated === 0 && summary.storesAlreadySynced === 0) {
        summary.status = 'error'
    }
    return summary
}

// ============================================================================
// 2. GRUBHUB — PURE PAYLOAD BUILDER & SYNC
// ============================================================================

export interface GrubhubHolidaySpec {
    date: string
    description: string
    intervals: Array<{ from: string; to: string }>
}

export function buildGrubhubExpectedHolidays(
    weekly: Record<number, StoreWeeklyWindow>,
    holidays: OfficialStoreHolidayRule[]
): GrubhubHolidaySpec[] {
    const toMs = (hhmm: string) => `${normalizeHHMM(hhmm)}:00.000`
    return holidays.map((h) => {
        const dow = getDayOfWeekUTC(h.event_date)
        const reg = weekly[dow]
        if (h.is_closed) {
            return { date: h.event_date, description: h.holiday_name_en, intervals: [] }
        }
        if (h.close_time) {
            return {
                date: h.event_date,
                description: h.holiday_name_en,
                intervals: [{ from: toMs(reg.open), to: toMs(h.close_time) }],
            }
        }
        return {
            date: h.event_date,
            description: h.holiday_name_en,
            intervals: [{ from: toMs(h.open_time || reg.open), to: toMs(reg.close) }],
        }
    })
}

async function syncGrubhubHolidays(
    stores: SyncStoreContext[],
    holidays: OfficialStoreHolidayRule[],
    dryRun: boolean
): Promise<PlatformSyncSummary> {
    const summary: PlatformSyncSummary = {
        platform: 'grubhub',
        status: 'ok',
        storesChecked: 0,
        storesAlreadySynced: 0,
        storesUpdated: 0,
        storesFailed: 0,
        details: [],
    }

    let token: string
    try {
        token = await getGrubhubMerchantToken()
    } catch (e: any) {
        summary.status = 'auth_expired'
        summary.error = e?.message || 'Failed to obtain Grubhub token'
        return summary
    }

    const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': UA,
        Origin: 'https://restaurant.grubhub.com',
        Referer: 'https://restaurant.grubhub.com/',
    }
    const catalogs = ['STANDARD_DELIVERY', 'STANDARD_PICKUP'] as const

    for (const st of stores) {
        if (!st.grubhubCustId) continue
        summary.storesChecked++

        const expected = buildGrubhubExpectedHolidays(st.weekly, holidays)
        const getRes = await fetch(
            `https://api-merchant-gtm.grubhub.com/catalogedit/restaurant/${st.grubhubCustId}/hours`,
            { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }
        )
        if (getRes.status === 401 || getRes.status === 403) {
            summary.status = 'auth_expired'
            summary.error = `Grubhub catalogedit HTTP ${getRes.status}`
            return summary
        }
        if (!getRes.ok) {
            summary.storesFailed++
            summary.details.push({ storeId: st.id, storeName: st.name, action: 'error', error: `GET hours HTTP ${getRes.status}` })
            continue
        }
        const catJson: any = await getRes.json().catch(() => ({}))

        const neededWrites: Array<{ catalogId: string; h: GrubhubHolidaySpec }> = []
        const diffs: string[] = []

        for (const catalogId of catalogs) {
            const actualSpecials: any[] =
                catJson?.availability_by_catalog?.[catalogId]?.custom_schedules ||
                catJson?.availability_by_catalog?.[catalogId]?.special_hours ||
                []
            for (const h of expected) {
                const found = actualSpecials.find((x: any) => String(x.date || '').slice(0, 10) === h.date)
                const actIntervals: any[] = found?.intervals || found?.schedule_intervals || []
                const expSig = JSON.stringify(h.intervals.map((i) => `${i.from.slice(0, 5)}-${i.to.slice(0, 5)}`))
                const actSig = JSON.stringify(actIntervals.map((i: any) => `${String(i.from || '').slice(0, 5)}-${String(i.to || '').slice(0, 5)}`))
                if (!found || expSig !== actSig) {
                    neededWrites.push({ catalogId, h })
                    diffs.push(`${catalogId}:${h.date} (${found ? actSig : 'MISSING'} -> ${expSig})`)
                }
            }
        }

        if (neededWrites.length === 0) {
            summary.storesAlreadySynced++
            summary.details.push({ storeId: st.id, storeName: st.name, action: 'already_synced' })
            await sleep(120)
            continue
        }

        if (dryRun) {
            summary.storesUpdated++
            summary.details.push({ storeId: st.id, storeName: st.name, action: 'would_update', diffs })
            await sleep(120)
            continue
        }

        let failedInStore = 0
        for (const { catalogId, h } of neededWrites) {
            const payload = {
                catalog_id: catalogId,
                date: h.date,
                source: 'GFR',
                description: h.description,
                schedule_intervals: h.intervals,
            }
            let r = await fetch(
                `https://api-merchant-gtm.grubhub.com/catalogedit/restaurant/${st.grubhubCustId}/hours/custom-schedule?checkImpactedOrders=true`,
                { method: 'PUT', headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }
            )
            if (r.status === 409) {
                r = await fetch(
                    `https://api-merchant-gtm.grubhub.com/catalogedit/restaurant/${st.grubhubCustId}/hours/custom-schedule?checkImpactedOrders=false`,
                    { method: 'PUT', headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }
                )
            }
            if (r.status !== 200 && r.status !== 204) {
                failedInStore++
            }
            await sleep(140)
        }

        if (failedInStore > 0) {
            summary.storesFailed++
            summary.details.push({ storeId: st.id, storeName: st.name, action: 'error', diffs, error: `${failedInStore}/${neededWrites.length} PUT failures` })
        } else {
            summary.storesUpdated++
            summary.details.push({ storeId: st.id, storeName: st.name, action: 'updated', diffs })
        }
    }

    return summary
}

// ============================================================================
// 3. DOORDASH — PURE PAYLOAD BUILDER & SYNC
// ============================================================================

export interface DoorDashSpecialItem {
    date: string
    closed: boolean
    startTime: string | null
    endTime: string | null
    description: string
}

export interface DoorDashHolidayBatch {
    key: string
    date: string
    items: DoorDashSpecialItem[]
}

export function buildDoorDashExpectedBatches(
    weekly: Record<number, StoreWeeklyWindow>,
    holidays: OfficialStoreHolidayRule[]
): DoorDashHolidayBatch[] {
    const toHMS = (hhmm: string) => `${normalizeHHMM(hhmm)}:00`
    return holidays.map((h) => {
        const dow = getDayOfWeekUTC(h.event_date)
        const nextDate = shiftDateUTC(h.event_date, 1)
        const reg = weekly[dow]
        const label = h.holiday_name_en

        if (h.is_closed) {
            return {
                key: h.holiday_key,
                date: h.event_date,
                items: [{ date: h.event_date, closed: true, startTime: null, endTime: null, description: label }],
            }
        }
        if (h.close_time) {
            return {
                key: h.holiday_key,
                date: h.event_date,
                items: [{ date: h.event_date, closed: false, startTime: toHMS(reg.open), endTime: toHMS(h.close_time), description: label }],
            }
        }
        // Late open (11:00 AM -> regular close of that weekday)
        const openHms = toHMS(h.open_time || '11:00')
        if (isAfterMidnightClose(reg.close)) {
            return {
                key: h.holiday_key,
                date: h.event_date,
                items: [
                    { date: h.event_date, closed: false, startTime: openHms, endTime: '23:59:59', description: label },
                    { date: nextDate, closed: false, startTime: '00:00:00', endTime: toHMS(reg.close), description: label },
                ],
            }
        }
        const endHms = isMidnightClose(reg.close) ? '23:59:59' : toHMS(reg.close)
        return {
            key: h.holiday_key,
            date: h.event_date,
            items: [{ date: h.event_date, closed: false, startTime: openHms, endTime: endHms, description: label }],
        }
    })
}

function msToHHMM(ms: number | null | undefined): string {
    if (ms === null || ms === undefined) return ''
    const totalSec = Math.round(ms / 1000)
    if (totalSec >= 86399) return '23:59'
    const hh = Math.floor(totalSec / 3600)
    const mm = Math.floor((totalSec % 3600) / 60)
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

async function syncDoorDashHolidays(
    stores: SyncStoreContext[],
    holidays: OfficialStoreHolidayRule[],
    rawCookie: string | null,
    dryRun: boolean
): Promise<PlatformSyncSummary> {
    const summary: PlatformSyncSummary = {
        platform: 'doordash',
        status: 'ok',
        storesChecked: 0,
        storesAlreadySynced: 0,
        storesUpdated: 0,
        storesFailed: 0,
        details: [],
    }
    if (!rawCookie) {
        summary.status = 'auth_expired'
        summary.error = 'Missing doordash_merchant integration cookie in Supabase'
        return summary
    }

    const csrfToken = rawCookie.match(/(?:^|;\s*)csrf_token=([^;]+)/)?.[1] || ''
    const base = 'https://merchant-portal.doordash.com/merchant-data-service'

    const ddCall = async (ddId: string, bizId: string, method: string, suffix: string, body?: any) => {
        const res = await fetch(`${base}${suffix}`, {
            method,
            headers: {
                Cookie: rawCookie,
                'User-Agent': UA,
                Accept: 'application/json',
                'Content-Type': 'application/json',
                Origin: 'https://merchant-portal.doordash.com',
                Referer: `https://merchant-portal.doordash.com/merchant/store-availability/special-hours?business_id=${bizId}&store_id=${ddId}`,
                ...(csrfToken ? { 'X-CSRFToken': csrfToken } : {}),
            },
            body: body !== undefined ? JSON.stringify(body) : undefined,
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        })
        const text = await res.text()
        let json: any = null
        try { json = JSON.parse(text) } catch {}
        return { status: res.status, text, json }
    }

    for (const st of stores) {
        if (!st.doordashStoreId) continue
        summary.storesChecked++

        const agg = await ddCall(st.doordashStoreId, st.doordashBusinessId, 'GET', `/api/v1/stores/${st.doordashStoreId}/aggregatedMenuHours?activeOnly=false`)
        if (agg.status === 401 || agg.status === 403) {
            summary.status = 'auth_expired'
            summary.error = `DoorDash Merchant session expired (HTTP ${agg.status})`
            return summary
        }
        if (agg.status !== 200) {
            summary.storesFailed++
            summary.details.push({ storeId: st.id, storeName: st.name, action: 'error', error: `GET aggregatedMenuHours HTTP ${agg.status}` })
            continue
        }

        const actualByDate = new Map<string, any[]>()
        for (const dayEntry of (agg.json?.specialHours || [])) {
            actualByDate.set(dayEntry.date, dayEntry.specialHours || [])
        }

        const expectedBatches = buildDoorDashExpectedBatches(st.weekly, holidays)
        const batchesToApply: DoorDashHolidayBatch[] = []
        const diffs: string[] = []

        for (const b of expectedBatches) {
            let batchOk = true
            for (const item of b.items) {
                const actualItems = actualByDate.get(item.date) || []
                const match = actualItems.some((a: any) => {
                    if (item.closed) return Boolean(a.isClosed)
                    if (a.isClosed) return false
                    const aStart = msToHHMM(a.startTime)
                    const aEnd = msToHHMM(a.endTime)
                    return aStart === String(item.startTime).slice(0, 5) && aEnd === String(item.endTime).slice(0, 5)
                })
                if (!match) {
                    batchOk = false
                    diffs.push(`${item.date}:${item.closed ? 'CLOSED' : `${item.startTime?.slice(0, 5)}-${item.endTime?.slice(0, 5)}`}`)
                }
            }
            if (!batchOk) batchesToApply.push(b)
        }

        if (batchesToApply.length === 0) {
            summary.storesAlreadySynced++
            summary.details.push({ storeId: st.id, storeName: st.name, action: 'already_synced' })
            await sleep(100)
            continue
        }

        if (dryRun) {
            summary.storesUpdated++
            summary.details.push({ storeId: st.id, storeName: st.name, action: 'would_update', diffs })
            await sleep(100)
            continue
        }

        // Delete conflicting IDs only on dates being replaced, then preview + POST
        const datesToReplace = new Set(batchesToApply.flatMap((b) => b.items.map((i) => i.date)))
        const conflictIds: string[] = []
        for (const d of datesToReplace) {
            for (const sh of (actualByDate.get(d) || [])) {
                if (sh.id) conflictIds.push(sh.id)
            }
        }

        let errMsg: string | null = null
        if (conflictIds.length > 0) {
            const del = await ddCall(st.doordashStoreId, st.doordashBusinessId, 'POST', `/api/v1/stores/${st.doordashStoreId}/delete_special_hours_batch`, {
                storeSpecialHoursIds: conflictIds,
            })
            if (del.status < 200 || del.status >= 300) {
                errMsg = `DELETE HTTP ${del.status}`
            }
        }

        if (!errMsg) {
            for (const b of batchesToApply) {
                const prev = await ddCall(st.doordashStoreId, st.doordashBusinessId, 'POST', `/api/v1/stores/${st.doordashStoreId}/store_special_hours_preview`, {
                    specialHours: b.items,
                })
                const hasErr = (prev.json?.validation || []).some((v: any) => v.validationStatus === 1)
                if (prev.status !== 200 || hasErr) {
                    errMsg = `Preview failed ${b.date}: HTTP ${prev.status}`
                    break
                }
                const post = await ddCall(st.doordashStoreId, st.doordashBusinessId, 'POST', `/api/v1/stores/${st.doordashStoreId}/special_hours`, {
                    specialHoursList: b.items,
                })
                if (post.status < 200 || post.status >= 300) {
                    errMsg = `POST ${b.date} HTTP ${post.status}`
                    break
                }
                await sleep(120)
            }
        }

        if (errMsg) {
            summary.storesFailed++
            summary.details.push({ storeId: st.id, storeName: st.name, action: 'error', diffs, error: errMsg })
        } else {
            summary.storesUpdated++
            summary.details.push({ storeId: st.id, storeName: st.name, action: 'updated', diffs })
        }
    }

    return summary
}

// ============================================================================
// 4. UBER EATS — PURE PAYLOAD BUILDER & SYNC
// ============================================================================

export type UberHourRecord = { startTime: string; endTime: string }
export type UberHolidayMap = Record<string, { hourRecords: UberHourRecord[] }>

export function buildUberEatsExpectedHolidayMap(
    weekly: Record<number, StoreWeeklyWindow>,
    holidays: OfficialStoreHolidayRule[],
    todayLA: string
): UberHolidayMap {
    const map: UberHolidayMap = {}

    for (const h of holidays) {
        const dow = getDayOfWeekUTC(h.event_date)
        const prevDate = shiftDateUTC(h.event_date, -1)
        const nextDate = shiftDateUTC(h.event_date, 1)
        const prevDow = (dow + 6) % 7
        const nextDow = (dow + 1) % 7
        const regPrev = weekly[prevDow]
        const regToday = weekly[dow]
        const regNext = weekly[nextDow]
        const prevHoliday = getOfficialStoreHolidaySchedule(prevDate)
        const nextHoliday = getOfficialStoreHolidaySchedule(nextDate)

        if (h.is_closed) {
            map[h.event_date] = { hourRecords: [{ startTime: '00:00', endTime: '00:00' }] }
            // Strip spillover on the next calendar day if the closed holiday normally spilled past midnight
            if (!nextHoliday && isAfterMidnightClose(regToday.close)) {
                const nextEnd = (isMidnightClose(regNext.close) || isAfterMidnightClose(regNext.close))
                    ? '23:59'
                    : normalizeHHMM(regNext.close)
                map[nextDate] = { hourRecords: [{ startTime: normalizeHHMM(regNext.open), endTime: nextEnd }] }
            }
        } else if (h.close_time) {
            const recs: UberHourRecord[] = []
            // Preserve previous night's late close ONLY for future dates when previous day was regular & spilled past midnight
            if (h.event_date > todayLA && !prevHoliday && isAfterMidnightClose(regPrev.close)) {
                recs.push({ startTime: '00:00', endTime: normalizeHHMM(regPrev.close) })
            }
            recs.push({ startTime: normalizeHHMM(regToday.open), endTime: normalizeHHMM(h.close_time) })
            map[h.event_date] = { hourRecords: recs }
        } else if (h.open_time) {
            const endStr = (isMidnightClose(regToday.close) || isAfterMidnightClose(regToday.close))
                ? '23:59'
                : normalizeHHMM(regToday.close)
            map[h.event_date] = { hourRecords: [{ startTime: normalizeHHMM(h.open_time), endTime: endStr }] }
        }
    }

    return map
}

async function syncUberEatsHolidays(
    stores: SyncStoreContext[],
    holidays: OfficialStoreHolidayRule[],
    rawCookie: string | null,
    todayLA: string,
    dryRun: boolean
): Promise<PlatformSyncSummary> {
    const summary: PlatformSyncSummary = {
        platform: 'ubereats',
        status: 'ok',
        storesChecked: 0,
        storesAlreadySynced: 0,
        storesUpdated: 0,
        storesFailed: 0,
        details: [],
    }
    if (!rawCookie) {
        summary.status = 'auth_expired'
        summary.error = 'Missing ubereats_merchant integration cookie in Supabase'
        return summary
    }

    const cleanCookie = rawCookie
        .split(';')
        .map((c) => c.trim())
        .filter((c) => c && !c.toLowerCase().startsWith('selectedrestaurant='))
        .join('; ')

    const ueHeaders = (uuid: string) => ({
        'Content-Type': 'application/json',
        'x-csrf-token': 'x',
        'User-Agent': UA,
        Origin: 'https://merchants.ubereats.com',
        Referer: `https://merchants.ubereats.com/manager/hours?restaurantUUID=${uuid}`,
        Cookie: `${cleanCookie}; selectedRestaurant=${uuid}`,
    })

    for (const st of stores) {
        if (!st.ubereatsStoreUuid) continue
        summary.storesChecked++

        const getRes = await fetch('https://merchants.ubereats.com/manager/api/getHolidayHours?localeCode=en', {
            method: 'POST',
            headers: ueHeaders(st.ubereatsStoreUuid),
            body: JSON.stringify({ uuid: st.ubereatsStoreUuid }),
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        })
        if (getRes.status === 401 || getRes.status === 403) {
            const snippet = (await getRes.text().catch(() => '')).slice(0, 300)
            const isCfChallenge = /just a moment|cf-browser-verification|cloudflare/i.test(snippet)
            summary.status = 'auth_expired'
            summary.error = isCfChallenge
                ? `Uber Eats Manager blocked server request with Cloudflare anti-bot challenge (HTTP ${getRes.status}) — verify/refresh session manually in merchants.ubereats.com`
                : `Uber Eats Manager session expired (HTTP ${getRes.status})`
            return summary
        }
        const getJson: any = await getRes.json().catch(() => ({}))
        if (!getRes.ok || getJson?.status !== 'success') {
            summary.storesFailed++
            summary.details.push({ storeId: st.id, storeName: st.name, action: 'error', error: `getHolidayHours HTTP ${getRes.status}` })
            continue
        }

        const actualMap: UberHolidayMap = getJson?.data?.holidayHoursMap || {}
        const expectedMap = buildUberEatsExpectedHolidayMap(st.weekly, holidays, todayLA)

        const diffs: string[] = []
        for (const [date, expVal] of Object.entries(expectedMap)) {
            const actVal = actualMap[date]
            if (!actVal || JSON.stringify(actVal.hourRecords) !== JSON.stringify(expVal.hourRecords)) {
                diffs.push(`${date}:${JSON.stringify(actVal?.hourRecords || 'MISSING')}->${JSON.stringify(expVal.hourRecords)}`)
            }
        }

        if (diffs.length === 0) {
            summary.storesAlreadySynced++
            summary.details.push({ storeId: st.id, storeName: st.name, action: 'already_synced' })
            await sleep(120)
            continue
        }

        if (dryRun) {
            summary.storesUpdated++
            summary.details.push({ storeId: st.id, storeName: st.name, action: 'would_update', diffs })
            await sleep(120)
            continue
        }

        // Preserve any unrelated future dates, drop expired past dates, upsert expectedMap
        const mergedMap: UberHolidayMap = {}
        for (const [date, val] of Object.entries(actualMap)) {
            if (date >= todayLA && !expectedMap[date]) {
                mergedMap[date] = val
            }
        }
        for (const [date, val] of Object.entries(expectedMap)) {
            mergedMap[date] = val
        }

        const setRes = await fetch('https://merchants.ubereats.com/manager/api/setHoursOverrides?localeCode=en', {
            method: 'POST',
            headers: ueHeaders(st.ubereatsStoreUuid),
            body: JSON.stringify({ restaurantUUID: st.ubereatsStoreUuid, hoursOverridesMap: mergedMap }),
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        })
        const setJson: any = await setRes.json().catch(() => ({}))
        if (!setRes.ok || setJson?.status !== 'success') {
            summary.storesFailed++
            summary.details.push({ storeId: st.id, storeName: st.name, action: 'error', diffs, error: `setHoursOverrides HTTP ${setRes.status}` })
        } else {
            summary.storesUpdated++
            summary.details.push({ storeId: st.id, storeName: st.name, action: 'updated', diffs })
        }
        await sleep(160)
    }

    return summary
}

// ============================================================================
// ORCHESTRATOR: RUN PERPETUAL SYNC + CONDITIONAL ALERT EMAIL
// ============================================================================

export async function syncUpcomingHolidaysAcrossPlatforms(options?: {
    dryRun?: boolean
    horizonDays?: number
    platforms?: SupportedPlatform[]
    nowDate?: Date
    skipEmail?: boolean
}): Promise<HolidaySyncReport> {
    const dryRun = Boolean(options?.dryRun)
    const horizonDays = Math.min(360, Math.max(30, Math.trunc(options?.horizonDays ?? 330)))
    const nowDate = options?.nowDate || new Date()
    const todayLA = getTodayDateLA(nowDate)
    const activePlatforms = new Set<SupportedPlatform>(
        options?.platforms?.length ? options.platforms : ['gbp', 'grubhub', 'doordash', 'ubereats']
    )

    const holidays = getUpcomingOfficialStoreHolidays(todayLA, horizonDays)
    const supabase = await getSupabaseAdminClient()

    const [storesRes, mapRes, intRes] = await Promise.all([
        supabase
            .from('stores')
            .select('id, code, name, address, phone, weekly_hours')
            .eq('is_active', true)
            .order('id', { ascending: true }),
        supabase
            .from('delivery_platform_store_mappings')
            .select('store_id, doordash_store_id, doordash_business_id, ubereats_store_uuid, grubhub_cust_id')
            .order('store_id', { ascending: true }),
        supabase
            .from('integrations')
            .select('service_name, access_token')
            .in('service_name', ['doordash_merchant', 'ubereats_merchant']),
    ])

    if (storesRes.error || !storesRes.data) {
        throw new Error(`Failed loading stores: ${storesRes.error?.message || 'empty'}`)
    }
    if (mapRes.error || !mapRes.data) {
        throw new Error(`Failed loading mappings: ${mapRes.error?.message || 'empty'}`)
    }

    const mapById = new Map<number, any>()
    for (const m of mapRes.data) mapById.set(m.store_id, m)

    const stores: SyncStoreContext[] = storesRes.data.map((s: any) => {
        const m = mapById.get(s.id) || {}
        const norm = normalizeWeeklyHours(s.weekly_hours)
        const weekly: Record<number, StoreWeeklyWindow> = {}
        for (let d = 0; d <= 6; d++) {
            weekly[d] = { open: normalizeHHMM(norm[d].open), close: normalizeHHMM(norm[d].close) }
        }
        return {
            id: s.id,
            code: s.code,
            name: s.name,
            address: s.address || '',
            phone: s.phone || '',
            weekly,
            doordashStoreId: String(m.doordash_store_id || ''),
            doordashBusinessId: String(m.doordash_business_id || '137616'),
            ubereatsStoreUuid: String(m.ubereats_store_uuid || ''),
            grubhubCustId: String(m.grubhub_cust_id || ''),
        }
    })

    const ddEncrypted = intRes.data?.find((x: any) => x.service_name === 'doordash_merchant')?.access_token || null
    const ueEncrypted = intRes.data?.find((x: any) => x.service_name === 'ubereats_merchant')?.access_token || null
    const ddCookie = ddEncrypted ? decryptIntegrationSecret(ddEncrypted) : null
    const ueCookie = ueEncrypted ? decryptIntegrationSecret(ueEncrypted) : null

    const mkSkipped = (platform: SupportedPlatform): PlatformSyncSummary => ({
        platform, status: 'skipped', storesChecked: 0, storesAlreadySynced: 0, storesUpdated: 0, storesFailed: 0, details: [],
    })

    const platforms: Record<SupportedPlatform, PlatformSyncSummary> = {
        gbp: activePlatforms.has('gbp') ? await syncGbpHolidays(stores, holidays, todayLA, dryRun) : mkSkipped('gbp'),
        grubhub: activePlatforms.has('grubhub') ? await syncGrubhubHolidays(stores, holidays, dryRun) : mkSkipped('grubhub'),
        doordash: activePlatforms.has('doordash') ? await syncDoorDashHolidays(stores, holidays, ddCookie, dryRun) : mkSkipped('doordash'),
        ubereats: activePlatforms.has('ubereats') ? await syncUberEatsHolidays(stores, holidays, ueCookie, todayLA, dryRun) : mkSkipped('ubereats'),
    }

    // Determine whether to send preventive email alert (ONLY on real runs, never on dryRun)
    const authExpiredPlatforms = Object.values(platforms)
        .filter((p) => p.status === 'auth_expired' || p.status === 'error')
        .map((p) => `${p.platform.toUpperCase()} (${p.error || 'error'})`)
    const month = Number(todayLA.slice(5, 7))
    const dayOfMonth = Number(todayLA.slice(8, 10))
    const isAnnualAppleBingReminderWindow = (month === 10 || month === 2) && dayOfMonth <= 3
    const next60Holidays = getUpcomingOfficialStoreHolidays(todayLA, 60)

    let emailAlertSent = false
    let emailReason: string | null = null

    if (!dryRun && !options?.skipEmail) {
        const shouldWarnAuth = authExpiredPlatforms.length > 0 && next60Holidays.length > 0
        if (shouldWarnAuth || isAnnualAppleBingReminderWindow) {
            emailReason = shouldWarnAuth
                ? `auth_expired:${authExpiredPlatforms.join(',')}`
                : `annual_apple_bing_reminder_${todayLA.slice(0, 7)}`
            const holidayRowsHtml = holidays
                .map((h) => `<li><strong>${h.event_date}</strong> — ${h.holiday_name_es} (${h.holiday_name_en}): ${h.is_closed ? 'CERRADO TODO EL DÍA' : h.close_time ? `Cierre temprano ${h.close_time}` : `Apertura tarde ${h.open_time}`}</li>`)
                .join('')
            const statusRowsHtml = Object.values(platforms)
                .map((p) => `<li><strong>${p.platform.toUpperCase()}</strong>: ${p.status} (sincronizadas: ${p.storesAlreadySynced}, actualizadas: ${p.storesUpdated}, errores: ${p.storesFailed}${p.error ? ` — ${p.error}` : ''})</li>`)
                .join('')

            await sendSystemEmail({
                to: 'carlos@tacosgavilan.com',
                subject: shouldWarnAuth
                    ? `[Tacos Gavilan] Alerta: Renovar sesión para sincronización de festivos (${next60Holidays[0].event_date})`
                    : `[Tacos Gavilan] Recordatorio Semestral: Sincronización de Festivos en Apple Business & Bing (${todayLA.slice(0, 4)})`,
                html: `
                    <h2>Sincronización Perpetua de 7 Días Festivos — Tacos Gavilan</h2>
                    <p>Fecha de ejecución: <strong>${todayLA}</strong> (ventana de ${horizonDays} días).</p>
                    <h3>Estado de Plataformas Automáticas (15 sucursales)</h3>
                    <ul>${statusRowsHtml}</ul>
                    ${isAnnualAppleBingReminderWindow ? '<p><strong>Acción breve (2 min):</strong> Apple Business Connect no cuenta con API permanente autoservicio — revisa y carga las próximas fechas en <code>business.apple.com</code>, y en Bing Places haz clic en <em>Sync from Google Business Profile</em>.</p>' : ''}
                    ${shouldWarnAuth ? '<p><strong>Acción requerida:</strong> Renueva la cookie/sesión de la plataforma afectada en Supabase para mantener sincronizados automáticamente los festivos antes del próximo evento.</p>' : ''}
                    <h3>Próximos Festivos Oficiales (${holidays.length})</h3>
                    <ul>${holidayRowsHtml}</ul>
                `,
            }).then(() => { emailAlertSent = true }).catch((e) => {
                console.error('[HOLIDAY SYNC EMAIL ERROR]', e?.message || e)
            })
        }
    }

    return {
        executedAt: new Date().toISOString(),
        todayLA,
        horizonDays,
        dryRun,
        upcomingHolidays: holidays.map((h) => ({
            date: h.event_date,
            key: h.holiday_key,
            nameEn: h.holiday_name_en,
            isClosed: h.is_closed,
            openTime: h.open_time,
            closeTime: h.close_time,
        })),
        platforms,
        emailAlertSent,
        emailReason,
    }
}
