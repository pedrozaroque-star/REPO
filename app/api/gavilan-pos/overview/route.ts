/**
 * @module app/api/gavilan-pos/overview/route
 * @description Endpoint de lectura y mutación real en PostgreSQL (Supabase) + Sincronización Offline-First (Store-and-Forward)
 * para el ecosistema Gavilan POS Cloud V2 (reemplazo integral de Toast Web, terminales Toast POS, Toast Drive-Thru, Kiosks y KDS).
 *
 * @businessRules
 * - **Día Laboral (6:00 AM Rule)**: El día operativo en Tacos Gavilan inicia a las 6:00 AM y cierra a las 5:59 AM del día siguiente en zona horaria `America/Los_Angeles`. Turno PM inicia a las 5:00 PM.
 * - **Regla EBT CalFresh RMP & Pago Dividido (CDTFA Reg. 1603 Split Tender)**: Toda venta cobrada al 100% con `EBT_CALFRESH` aplica `0% Sales Tax`. Cuando el saldo EBT del cliente es parcial (`SPLIT_EBT_MIXED`), la porción cubierta con EBT está 100% exenta de impuesto y el California Sales Tax se recalcula únicamente sobre el remanente pagado en Efectivo o Tarjeta (`(Subtotal - Monto_EBT) * TaxRate`).
 * - **Drive-Thru Multi-Estación + KDS Live Pre-Fire Streaming**: El Order Taker en altavoz transmite platillos en vivo al KDS (`SPEAKER_PREFIRE`) mientras el cliente ordena, etiqueta vehículo/color/carril y envía la orden abierta a la Fila de Autos (`IN_CAR_QUEUE` -> `AT_PAY_WINDOW` -> `COMPLETED`) midiendo tiempos SLA Speed of Service (`< 120s`).
 * - **Cocina 100% Sin Papel (Paperless KDS HDMI)**: Las comandas de cocina viajan exclusivamente a pantallas KDS táctiles + monitores duplicados por Splitter HDMI Activo (`0` impresoras de impacto en cocina).
 * - **Arquitectura Offline-First & Anti-Apagones (Store-and-Forward + Baterías LiFePO4/Tablet)**: Garantiza operación continua e idempotencia vía `client_order_id`.
 * - **Cero Columnas Generadas en Mutaciones**: Ningún payload de `INSERT`/`UPDATE` incluye columnas generadas por PostgreSQL (`428C9`).
 *
 * @dataFlow
 * - `GET`: Lee y auto-inicializa `gavilan_pos_menu_items`, `gavilan_pos_orders`, `gavilan_pos_store_configs`, `gavilan_pos_cash_closeouts`, `gavilan_pos_cash_events`, `gavilan_pos_timeclock_entries`, `gavilan_pos_loyalty_accounts`, `stores`, `toast_menu_items` y `sales_daily_cache`.
 * - `POST`: Ejecuta mutaciones reales (`TOGGLE_86`, `UPDATE_MENU_ITEM`, `BULK_PUBLISH_MENU`, `CREATE_ORDER`, `UPDATE_DRIVETHRU_ORDER`, `FIRE_SCHEDULED_CATERING`, `VOID_OR_COMP_ORDER`, `RECORD_CASH_EVENT`, `PUNCH_TIMECLOCK`, `UPDATE_LOYALTY_OR_GIFTCARD`, `BUMP_ORDER`, `RECALL_ORDER`, `SAVE_STORE_CONFIG`, `CREATE_CLOSEOUT`, `SYNC_OFFLINE_OUTBOX`, `TEST_TCP_PRINT`).
 *
 * @notes
 * - Garantiza idempotencia mediante `client_order_id` único en `gavilan_pos_orders` para evitar órdenes duplicadas al vaciar la cola Offline (`Outbox`).
 * - Blindaje de Seguridad (2026-11-21): `authorizePosAction` exige autenticación válida (`verifyStaffAuth` / `getServerUser`) en el 100% de acciones POS (cero fallback abierto), aplica aislamiento por sucursal (`authorizeStoreScope`) para roles no globales y bloquea sockets TCP crudos en `TEST_TCP_PRINT` cuando `process.env.VERCEL === '1'`.
 */

import { NextRequest, NextResponse } from 'next/server'
import net from 'net'
import os from 'os'
import { getSupabaseAdminClient } from '@/lib/supabase'
import { authorizeStoreScope, getServerUser, verifyStaffAuth } from '@/lib/auth-server'
import { formatCustomerStoreName } from '@/lib/customer-store-names'

function getLocalLanAddresses() {
    const nets = os.networkInterfaces()
    const ipv4List: { iface: string; ip: string; subnetPrefix: string }[] = []
    for (const [name, addrs] of Object.entries(nets)) {
        for (const addr of (addrs || [])) {
            if (addr.family === 'IPv4' && !addr.internal) {
                const parts = addr.address.split('.')
                const subnetPrefix = parts.slice(0, 3).join('.')
                ipv4List.push({ iface: name, ip: addr.address, subnetPrefix })
            }
        }
    }
    const primary = ipv4List.find(x => x.ip.startsWith('192.168.') || x.ip.startsWith('10.') || x.ip.startsWith('172.')) || ipv4List[0] || {
        iface: 'LAN',
        ip: '127.0.0.1',
        subnetPrefix: '192.168.1',
    }
    return {
        primaryIp: primary.ip,
        subnetPrefix: primary.subnetPrefix,
        posLanUrl: `http://${primary.ip}:3000/gavilan-pos`,
        interfaces: ipv4List,
    }
}

const TOAST_GUID_TO_NAME: Record<string, string> = {
    'acf15327-54c8-4da4-8d0d-3ac0544dc422': 'Rialto',
    'e0345b1f-d6d6-40b2-bd06-5f9f4fd944e8': 'Azusa',
    '42ed15a6-106b-466a-9076-1e8f72451f6b': 'Norwalk',
    'b7f63b01-f089-4ad7-a346-afdb1803dc1a': 'Downey',
    '475bc112-187d-4b9c-884d-1f6a041698ce': 'LA Broadway',
    'a83901db-2431-4283-834e-9502a2ba4b3b': 'Bell',
    '5fbb58f5-283c-4ea4-9415-04100ee6978b': 'Hollywood',
    '47256ade-2cd4-4073-9632-84567ad9e2c8': 'Huntington Park',
    '8685e942-3f07-403a-afb6-faec697cd2cb': 'LA Central',
    '3a803939-eb13-4def-a1a4-462df8e90623': 'La Puente',
    '80a1ec95-bc73-402e-8884-e5abbe9343e6': 'Lynwood',
    '3c2d8251-c43c-43b8-8306-387e0a4ed7c2': 'Santa Ana',
    '9625621e-1b5e-48d7-87ae-7094fab5a4fd': 'Slauson',
    '95866cfc-eeb8-4af9-9586-f78931e1ea04': 'South Gate',
    '5f4a006e-9a6e-4bcf-b5bd-7f5e9d801a02': 'West Covina',
}

const STORE_NUMBER_BY_NAME: Record<string, number> = {
    'Rialto': 1,
    'West Covina': 3,
    'Azusa': 4,
    'LA Broadway': 5,
    'LA Central': 6,
    'Slauson': 7,
    'Hollywood': 8,
    'Santa Ana': 9,
    'La Puente': 10,
    'Huntington Park': 11,
    'Norwalk': 12,
    'Bell': 13,
    'Lynwood': 14,
    'South Gate': 15,
    'Downey': 16,
}

const STORE_PHONE_BY_ID: Record<number, string> = {
    1: '(909) 562-0430',
    3: '(626) 917-2662',
    4: '(626) 969-1011',
    5: '(323) 233-2302',
    6: '(213) 742-6677',
    7: '(323) 615-0084',
    8: '(323) 963-7993',
    9: '(714) 480-0713',
    10: '(626) 336-3000',
    11: '(323) 581-7309',
    12: '(562) 651-0045',
    13: '(323) 771-1722',
    14: '(424) 785-5535',
    15: '(562) 806-1200',
    16: '(562) 927-7486',
}

const ADMIN_PROTECTED_POS_ACTIONS = new Set([
    'SCAN_WAREHOUSE_PRINTERS',
    'VERIFY_IDEMPOTENCY_LAB',
    'TOGGLE_86',
    'UPDATE_MENU_ITEM',
    'BULK_PUBLISH_MENU',
    'SAVE_STORE_CONFIG',
])

const GLOBAL_CATALOG_POS_ACTIONS = new Set([
    'SCAN_WAREHOUSE_PRINTERS',
    'UPDATE_MENU_ITEM',
    'BULK_PUBLISH_MENU',
])

const STORE_SCOPED_PAYLOAD_POS_ACTIONS = new Set([
    'CREATE_ORDER',
    'RECORD_CASH_EVENT',
    'PUNCH_TIMECLOCK',
    'CREATE_CLOSEOUT',
    'SAVE_STORE_CONFIG',
    'VERIFY_IDEMPOTENCY_LAB',
])

const ORDER_TARGETED_POS_ACTIONS = new Set([
    'UPDATE_DRIVETHRU_ORDER',
    'FIRE_SCHEDULED_CATERING',
    'VOID_OR_COMP_ORDER',
    'BUMP_ORDER',
    'RECALL_ORDER',
])

const ALL_ALLOWED_POS_ACTIONS = new Set([
    ...ADMIN_PROTECTED_POS_ACTIONS,
    ...STORE_SCOPED_PAYLOAD_POS_ACTIONS,
    ...ORDER_TARGETED_POS_ACTIONS,
    'UPDATE_LOYALTY_OR_GIFTCARD',
    'TEST_TCP_PRINT',
])

async function resolveHydratedPosUser(req: NextRequest, supabase: any, fallbackTokenUser: any) {
    const base = (await getServerUser(req)) || {
        id: String(fallbackTokenUser.id || fallbackTokenUser.sub || ''),
        email: String(fallbackTokenUser.email || ''),
        name: String(fallbackTokenUser.user_metadata?.full_name || fallbackTokenUser.email || ''),
        role: String(fallbackTokenUser.role || fallbackTokenUser.user_role || '').toLowerCase(),
        store_id: fallbackTokenUser.user_metadata?.store_id,
        store_ids: Array.isArray(fallbackTokenUser.user_metadata?.store_ids) ? fallbackTokenUser.user_metadata.store_ids : undefined,
        store_scope: fallbackTokenUser.user_metadata?.store_scope,
    }
    const role = String(base.role || '').toLowerCase()
    if (role !== 'admin' && role !== 'administrador' && role !== 'supervisor' && role !== 'employee' && (base.store_id === undefined || base.store_id === null)) {
        const numericId = Number(base.id)
        if (Number.isFinite(numericId) && numericId > 0) {
            const { data: dbUser } = await supabase.from('users').select('store_id, store_scope, role').eq('id', numericId).maybeSingle()
            if (dbUser) {
                base.store_id = dbUser.store_id ?? base.store_id
                base.store_scope = dbUser.store_scope ?? base.store_scope
            }
        }
    }
    return base
}

async function authorizePosAction(
    req: NextRequest,
    supabase: any,
    actionName: string,
    payload: any
): Promise<{ authorized: boolean; status?: number; error?: string }> {
    const cleanAction = String(actionName || '').trim()
    if (!ALL_ALLOWED_POS_ACTIONS.has(cleanAction)) {
        return { authorized: false, status: 400, error: `Acción POS desconocida o no permitida: ${cleanAction || '(vacía)'}` }
    }

    const requiresNonEmployeeStaff =
        ADMIN_PROTECTED_POS_ACTIONS.has(cleanAction) ||
        cleanAction === 'RECORD_CASH_EVENT' ||
        cleanAction === 'CREATE_CLOSEOUT'

    const allowedRoles = GLOBAL_CATALOG_POS_ACTIONS.has(cleanAction)
        ? ['admin', 'administrador', 'supervisor', 'manager', 'gerente', 'general_manager']
        : undefined

    const auth = verifyStaffAuth(req, {
        allowCron: false,
        allowEmployee: !requiresNonEmployeeStaff,
        allowedRoles,
    })

    if (!auth.authorized || !auth.user) {
        return {
            authorized: false,
            status: auth.status || 401,
            error: auth.error || 'No autenticado: se requiere sesión activa de personal POS.',
        }
    }

    const callerRole = String(auth.user.role || auth.user.user_role || '').toLowerCase()
    const isEmployeeCaller = auth.user.user_type === 'employee' || callerRole === 'employee'

    if (cleanAction === 'VOID_OR_COMP_ORDER' && isEmployeeCaller) {
        const approverName = String(payload?.managerPinUsed || '').trim()
        if (!approverName || approverName === '1425') {
            return {
                authorized: false,
                status: 403,
                error: 'Acceso denegado: anular o aplicar cortesía desde cuenta de cajero exige PIN gerencial verificado.',
            }
        }
        const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
        const { data: approvalRows } = await supabase
            .from('gavilan_pos_discount_approvals')
            .select('id')
            .eq('approver_name', approverName)
            .gte('created_at', sinceIso)
            .limit(1)
        if (!Array.isArray(approvalRows) || approvalRows.length === 0) {
            return {
                authorized: false,
                status: 403,
                error: 'Acceso denegado: no existe aprobación gerencial verificada reciente para esta anulación.',
            }
        }
    }

    const isGlobalRole = callerRole === 'admin' || callerRole === 'administrador' || callerRole === 'supervisor'
    if (isGlobalRole) {
        return { authorized: true }
    }

    const serverUser = await resolveHydratedPosUser(req, supabase, auth.user)

    if (STORE_SCOPED_PAYLOAD_POS_ACTIONS.has(cleanAction)) {
        const rawTargetStore =
            payload?.storeNumber ??
            payload?.store_id ??
            payload?.storeId ??
            serverUser.store_id ??
            serverUser.store_ids?.[0]
        if (rawTargetStore === undefined || rawTargetStore === null || String(rawTargetStore).trim() === '') {
            return { authorized: false, status: 403, error: 'Acceso denegado: sucursal destino requerida.' }
        }
        const scopeRes = await authorizeStoreScope(serverUser, rawTargetStore, supabase, { allowEmployeeRead: true })
        if (!scopeRes.authorized) {
            return { authorized: false, status: scopeRes.status, error: scopeRes.error }
        }
        if (scopeRes.resolvedStoreId && payload && typeof payload === 'object') {
            payload.storeNumber = scopeRes.resolvedStoreId
        }
        return { authorized: true }
    }

    if (ORDER_TARGETED_POS_ACTIONS.has(cleanAction)) {
        const ownStoreCandidate = serverUser.store_id ?? serverUser.store_ids?.[0]
        const ownScope = await authorizeStoreScope(serverUser, ownStoreCandidate, supabase, { allowEmployeeRead: true })
        if (!ownScope.authorized || !ownScope.resolvedStoreId) {
            return {
                authorized: false,
                status: ownScope.status || 403,
                error: ownScope.error || 'Acceso denegado: tu cuenta no tiene una sucursal autorizada.',
            }
        }

        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
        const orderId = payload?.orderId ? String(payload.orderId).trim() : ''
        const clientOrderId = payload?.clientOrderId ? String(payload.clientOrderId).trim() : ''
        const orderNumber = Number(payload?.orderNumber || 0)

        let targetOrder: { id: string; store_number: number } | null = null
        if (orderId && uuidRegex.test(orderId)) {
            const { data } = await supabase.from('gavilan_pos_orders').select('id, store_number').eq('id', orderId).maybeSingle()
            targetOrder = data
        } else if (clientOrderId || orderId) {
            const { data } = await supabase
                .from('gavilan_pos_orders')
                .select('id, store_number')
                .eq('client_order_id', clientOrderId || orderId)
                .maybeSingle()
            targetOrder = data
        } else if (orderNumber > 0) {
            const { data } = await supabase
                .from('gavilan_pos_orders')
                .select('id, store_number')
                .eq('store_number', ownScope.resolvedStoreId)
                .eq('order_number', orderNumber)
                .order('synced_at', { ascending: false })
                .limit(1)
                .maybeSingle()
            targetOrder = data
        } else if (cleanAction === 'RECALL_ORDER') {
            const { data } = await supabase
                .from('gavilan_pos_orders')
                .select('id, store_number')
                .eq('store_number', ownScope.resolvedStoreId)
                .eq('kds_status', 'BUMPED')
                .order('bumped_at', { ascending: false })
                .limit(1)
                .maybeSingle()
            targetOrder = data
        }

        if (!targetOrder) {
            return { authorized: false, status: 404, error: 'Orden POS no encontrada o fuera de tu sucursal.' }
        }
        const orderScope = await authorizeStoreScope(serverUser, targetOrder.store_number, supabase, { allowEmployeeRead: true })
        if (!orderScope.authorized) {
            return { authorized: false, status: orderScope.status, error: orderScope.error }
        }
        if (payload && typeof payload === 'object') {
            payload.orderId = targetOrder.id
        }
        return { authorized: true }
    }

    // Para acciones sin store explícito (ej. TOGGLE_86, UPDATE_LOYALTY_OR_GIFTCARD, TEST_TCP_PRINT), exigir pertenencia válida a sucursal
    const ownStoreCandidate = serverUser.store_id ?? serverUser.store_ids?.[0]
    const ownScope = await authorizeStoreScope(serverUser, ownStoreCandidate, supabase, { allowEmployeeRead: true })
    if (!ownScope.authorized) {
        return { authorized: false, status: ownScope.status, error: ownScope.error }
    }
    return { authorized: true }
}

function isPrivateRfc1918Ipv4(rawHost: string): boolean {
    const clean = String(rawHost || '').trim()
    const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(clean)
    if (!match) return false
    const octets = [match[1], match[2], match[3], match[4]]
    // Reject leading zeros (octal ambiguity)
    if (octets.some(o => o.length > 1 && o.startsWith('0'))) return false
    const [a, b, c, d] = octets.map(Number)
    if ([a, b, c, d].some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false
    if (d === 0 || d === 255) return false
    if (a === 10) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    return false
}

function isPrivateRfc1918SubnetPrefix(rawPrefix: string): boolean {
    const clean = String(rawPrefix || '').trim()
    return isPrivateRfc1918Ipv4(`${clean}.1`)
}

function parseValidatedLanPrinterTarget(
    rawTarget: unknown
): { ok: true; host: string; port: 9100 } | { ok: false; error: string } {
    const raw = typeof rawTarget === 'string' && rawTarget.trim() ? rawTarget.trim() : '192.168.14.50:9100'
    if (raw.includes('/') || raw.includes('@') || raw.includes(' ') || raw.startsWith('[')) {
        return { ok: false, error: 'Destino de impresora inválido: solo se permite IPv4 LAN privada en puerto 9100.' }
    }
    const parts = raw.split(':')
    if (parts.length > 2) {
        return { ok: false, error: 'Formato IP:Puerto inválido.' }
    }
    const host = parts[0].trim()
    const port = parts[1] !== undefined && parts[1] !== '' ? Number(parts[1].trim()) : 9100
    if (port !== 9100) {
        return { ok: false, error: 'Puerto bloqueado por seguridad: solo se permite el puerto térmico TCP 9100.' }
    }
    if (!isPrivateRfc1918Ipv4(host)) {
        return {
            ok: false,
            error: 'IP bloqueada por seguridad anti-SSRF: solo se permiten direcciones IPv4 LAN privadas RFC1918 (192.168.x.x, 10.x.x.x, 172.16-31.x.x).'
        }
    }
    return { ok: true, host, port: 9100 }
}

/**
 * Calcula la fecha operativa actual de Tacos Gavilan (día laboral 6:00 AM a 5:59 AM PT)
 */
function getCurrentGavilanBusinessDate(dateInput?: Date): string {
    const now = dateInput || new Date()
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Los_Angeles',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        hour12: false,
        hourCycle: 'h23',
    }).formatToParts(now)

    const year = Number(parts.find(p => p.type === 'year')?.value || 2026)
    const month = Number(parts.find(p => p.type === 'month')?.value || 1)
    const day = Number(parts.find(p => p.type === 'day')?.value || 1)
    const rawHour = Number(parts.find(p => p.type === 'hour')?.value ?? 12)
    const hour = rawHour === 24 ? 0 : rawHour

    const baseDate = new Date(Date.UTC(year, month - 1, day, 12, 0, 0))
    if (hour < 6) {
        baseDate.setUTCDate(baseDate.getUTCDate() - 1)
    }
    return baseDate.toISOString().slice(0, 10)
}

/**
 * Calcula el turno operativo actual (AM: 06:00 a 16:59, PM: 17:00 a 05:59 PT)
 */
function getCurrentGavilanShift(dateInput?: Date): 'AM' | 'PM' {
    const now = dateInput || new Date()
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Los_Angeles',
        hour: '2-digit',
        hour12: false,
        hourCycle: 'h23',
    }).formatToParts(now)
    const rawHour = Number(parts.find(p => p.type === 'hour')?.value ?? 12)
    const hour = rawHour === 24 ? 0 : rawHour
    return (hour >= 17 || hour < 6) ? 'PM' : 'AM'
}

function inferPrepStation(groupName: string, itemName: string): 'PARRILLA' | 'LINEA' | 'TORTILLAS' | 'BEBIDAS' | 'NONE' {
    const g = `${groupName} ${itemName}`.toLowerCase()
    if (g.includes('agua') || g.includes('drink') || g.includes('bebida') || g.includes('soda') || g.includes('horchata') || g.includes('jamaica') || g.includes('piña')) {
        return 'BEBIDAS'
    }
    if (g.includes('tortilla') || g.includes('maiz') || g.includes('harina')) {
        return 'TORTILLAS'
    }
    if (g.includes('taco') || g.includes('mulita') || g.includes('vampiro') || g.includes('asada') || g.includes('pastor') || g.includes('pollo') || g.includes('cabeza') || g.includes('lengua')) {
        return 'PARRILLA'
    }
    return 'LINEA'
}

export async function GET(req: NextRequest) {
    try {
        const staffAuth = verifyStaffAuth(req, { allowCron: false })
        const isStaffAuthenticated = staffAuth.authorized
        const supabase = await getSupabaseAdminClient()
        const currentBusinessDate = getCurrentGavilanBusinessDate()

        // 1. Fetch stores
        const { data: storesData } = await supabase
            .from('stores')
            .select('id, name, external_id')
            .order('name', { ascending: true })

        // 2. Fetch latest available business_date in sales_daily_cache + 30-day aggregates
        const { data: recentSales } = await supabase
            .from('sales_daily_cache')
            .select('store_id, business_date, net_sales, gross_sales, taxes, tips, order_count, uber_sales, doordash_sales, grubhub_sales, ebt_count, ebt_amount')
            .order('business_date', { ascending: false })
            .limit(450)

        // Find latest date with full store coverage and non-zero sales
        const dateCounts: Record<string, number> = {}
        const dateNetSums: Record<string, number> = {}
        for (const r of (recentSales || [])) {
            const ns = Number(r.net_sales || 0)
            if (ns > 0) {
                dateCounts[r.business_date] = (dateCounts[r.business_date] || 0) + 1
                dateNetSums[r.business_date] = (dateNetSums[r.business_date] || 0) + ns
            }
        }
        const sortedDates = Object.keys(dateCounts).sort().reverse()
        const latestFullDate = sortedDates.find(d => dateCounts[d] >= 12 && dateNetSums[d] > 50000) || sortedDates[0] || currentBusinessDate

        const latestDayRows = (recentSales || []).filter(r => r.business_date === latestFullDate)

        // Compute 30-day totals
        let total30dNet = 0
        let total30dOrders = 0
        let total30dUber = 0
        let total30dDoordash = 0
        let total30dGrubhub = 0
        let total30dEbt = 0
        const uniqueDates30d = new Set<string>()

        for (const r of (recentSales || [])) {
            uniqueDates30d.add(r.business_date)
            total30dNet += Number(r.net_sales || 0)
            total30dOrders += Number(r.order_count || 0)
            total30dUber += Number(r.uber_sales || 0)
            total30dDoordash += Number(r.doordash_sales || 0)
            total30dGrubhub += Number(r.grubhub_sales || 0)
            total30dEbt += Number(r.ebt_amount || 0)
        }

        // 3. Fetch or seed gavilan_pos_store_configs
        let { data: storeConfigsData } = await supabase
            .from('gavilan_pos_store_configs')
            .select('*')
            .order('store_number', { ascending: true })

        // Build clean 15-store list with real daily metrics & persistent config
        const storesList = Object.entries(TOAST_GUID_TO_NAME).map(([toastGuid, cleanName], idx) => {
            const dbStore = (storesData || []).find(
                s => s.external_id === toastGuid || s.name.toLowerCase() === cleanName.toLowerCase()
            )
            const storeNumber = (typeof dbStore?.id === 'number' ? dbStore.id : null) || STORE_NUMBER_BY_NAME[cleanName] || (idx + 1)
            const dayRow = latestDayRows.find(r => r.store_id === toastGuid || String(r.store_id) === String(dbStore?.id))
            const cfgRow = (storeConfigsData || []).find(c => Number(c.store_number) === storeNumber)

            const netSales = Number(dayRow?.net_sales || 0)
            const orderCount = Number(dayRow?.order_count || 0)
            const uberSales = Number(dayRow?.uber_sales || 0)
            const doordashSales = Number(dayRow?.doordash_sales || 0)
            const grubhubSales = Number(dayRow?.grubhub_sales || 0)
            const ebtAmount = Number(dayRow?.ebt_amount || 0)

            return {
                id: dbStore?.id || toastGuid,
                dbStoreId: typeof dbStore?.id === 'number' ? dbStore.id : null,
                toastGuid,
                storeNumber,
                name: cleanName,
                customerNameEs: formatCustomerStoreName({ id: storeNumber, name: cleanName }, 'es'),
                customerNameEn: formatCustomerStoreName({ id: storeNumber, name: cleanName }, 'en'),
                phone: STORE_PHONE_BY_ID[storeNumber] || '(424) 785-5535',
                taxRate: cleanName === 'Santa Ana' ? 9.25 : cleanName === 'Rialto' ? 8.75 : 10.25,
                fnsNumber: `04829${String(10 + storeNumber).padStart(2, '0')}`,
                status: 'ONLINE' as const,
                latestDate: latestFullDate,
                netSales: isStaffAuthenticated ? netSales : 0,
                orderCount: isStaffAuthenticated ? orderCount : 0,
                uberSales: isStaffAuthenticated ? uberSales : 0,
                doordashSales: isStaffAuthenticated ? doordashSales : 0,
                grubhubSales: isStaffAuthenticated ? grubhubSales : 0,
                ebtAmount: isStaffAuthenticated ? ebtAmount : 0,
                quoteMinutes: Number(cfgRow?.quote_minutes || 12),
                receiptHeader: cfgRow?.receipt_header || 'TACOS GAVILAN — SABOR AUTÉNTICO',
                receiptFooter: cfgRow?.receipt_footer || '¡GRACIAS POR SU VISITA! CALFRESH EBT RMP ACCEPTED',
                printRedModifiers: cfgRow?.print_red_modifiers ?? true,
                printerReceiptIp: cfgRow?.printer_receipt_ip || '192.168.192.169:9100',
                printerKitchenIp: cfgRow?.printer_kitchen_ip || '192.168.192.168:9100',
                offlineSafLimitUsd: Number(cfgRow?.offline_saf_limit_usd || 75.0),
                upsBatteryModel: cfgRow?.ups_battery_model || 'EcoFlow DELTA 2 LiFePO4 (1024Wh) + SUNMI UPS Base',
                cellularFailoverModel: cfgRow?.cellular_failover_model || 'Peplink BR1 Mini 5G Dual-WAN (<1s Failover)',
            }
        }).sort((a, b) => b.netSales - a.netSales)

        if (!storeConfigsData || storeConfigsData.length < 15) {
            const seedConfigs = storesList.map(s => ({
                store_number: s.storeNumber,
                store_id: s.dbStoreId,
                quote_minutes: s.quoteMinutes,
                receipt_header: s.receiptHeader,
                receipt_footer: s.receiptFooter,
                print_red_modifiers: s.printRedModifiers,
                printer_receipt_ip: s.printerReceiptIp,
                printer_kitchen_ip: s.printerKitchenIp,
                offline_saf_limit_usd: s.offlineSafLimitUsd,
                ups_battery_model: s.upsBatteryModel,
                cellular_failover_model: s.cellularFailoverModel,
            }))
            await supabase
                .from('gavilan_pos_store_configs')
                .upsert(seedConfigs, { onConflict: 'store_number', ignoreDuplicates: true })
            const { data: reloadedConfigs } = await supabase
                .from('gavilan_pos_store_configs')
                .select('*')
                .order('store_number', { ascending: true })
            storeConfigsData = reloadedConfigs || seedConfigs
        }

        // 4. Fetch or seed persistent gavilan_pos_menu_items
        let { data: persistedMenu } = await supabase
            .from('gavilan_pos_menu_items')
            .select('*')
            .order('category', { ascending: true })
            .order('name', { ascending: true })

        if (!persistedMenu || persistedMenu.length < 10) {
            const { data: rawMenuItems } = await supabase
                .from('toast_menu_items')
                .select('guid, name, group_name, price, recipe_na')
                .gt('price', 0)
                .order('group_name', { ascending: true })
                .order('name', { ascending: true })
                .limit(600)

            const seenNames = new Set<string>()
            const toInsert: any[] = []
            for (const item of (rawMenuItems || [])) {
                const cleanName = (item.name || '').trim()
                const groupName = (item.group_name || 'Menú General').trim()
                if (!cleanName || cleanName.length < 2) continue
                const key = `${groupName.toLowerCase()}::${cleanName.toLowerCase()}`
                if (seenNames.has(key)) continue
                seenNames.add(key)

                const basePrice = Number(item.price || 0)
                if (basePrice <= 0 || basePrice > 350) continue

                const station = inferPrepStation(groupName, cleanName)
                toInsert.push({
                    id: item.guid,
                    name: cleanName,
                    category: groupName,
                    base_price: basePrice,
                    delivery_markup_pct: 18,
                    station_code: station,
                    is_86ed: false,
                    tax_exempt_ebt: true,
                    modifier_groups: ['CON TODO', 'SIN CEBOLLA', 'SALSA ROJA'],
                })
                if (toInsert.length >= 120) break
            }

            if (toInsert.length > 0) {
                await supabase
                    .from('gavilan_pos_menu_items')
                    .upsert(toInsert, { onConflict: 'id', ignoreDuplicates: true })

                const { data: reloadedMenu } = await supabase
                    .from('gavilan_pos_menu_items')
                    .select('*')
                    .order('category', { ascending: true })
                    .order('name', { ascending: true })
                persistedMenu = reloadedMenu || toInsert
            }
        }

        const cleanMenu = (persistedMenu || []).map((row: any) => {
            const basePrice = Number(row.base_price || 0)
            const markupPct = Number(row.delivery_markup_pct ?? 18)
            return {
                guid: row.id,
                name: row.name,
                groupName: row.category,
                basePrice,
                deliveryMarkupPct: markupPct,
                deliveryPrice: Number((basePrice * (1 + markupPct / 100)).toFixed(2)),
                prepStation: (row.station_code || 'LINEA') as 'PARRILLA' | 'LINEA' | 'TORTILLAS' | 'BEBIDAS' | 'NONE',
                taxInherited: Boolean(row.tax_exempt_ebt ?? true),
                inStock: !Boolean(row.is_86ed),
                channels: {
                    pos: true,
                    kiosk: true,
                    online: true,
                    delivery: true,
                },
            }
        })

        // 5. Ensure Drive-Thru Queue & Scheduled Catering seed orders exist in gavilan_pos_orders
        const v2SeedOrders = [
            {
                client_order_id: 'SEED-1042',
                order_number: 1042,
                store_number: 14,
                business_date: currentBusinessDate,
                dining_option: 'FOR_HERE',
                customer_name: 'CLIENTE MOSTRADOR',
                items: [
                    { id: 'seed-1', name: 'Taco Asada (Maíz)', qty: 4, unitPrice: 3.79, modifiers: ['CON TODO', 'SALSA ROJA'], station: 'PARRILLA' },
                    { id: 'seed-2', name: 'Mulita de Pastor', qty: 1, unitPrice: 5.49, modifiers: ['SIN CEBOLLA', 'BIEN DORADA'], station: 'PARRILLA' },
                    { id: 'seed-3', name: 'Agua de Horchata Grande', qty: 2, unitPrice: 4.59, modifiers: ['POCO HIELO'], station: 'BEBIDAS' },
                ],
                subtotal: 29.83,
                tax_rate: 10.25,
                tax_amount: 3.06,
                total_amount: 32.89,
                payment_method: 'CARD_NFC',
                payment_capture_mode: 'ONLINE_AUTH',
                kds_status: 'IN_PREP',
                station_code: 'PARRILLA',
                prep_seconds: 125,
                created_offline: false,
                power_source_mode: 'AC_GRID',
                drive_thru_stage: 'COMPLETED',
            },
            {
                client_order_id: 'SEED-1043',
                order_number: 1043,
                store_number: 14,
                business_date: currentBusinessDate,
                dining_option: 'UBER_EATS',
                customer_name: 'UBER #8F2A (MIGUEL R.)',
                items: [
                    { id: 'seed-4', name: 'Burrito Especial Asada', qty: 2, unitPrice: 12.99, modifiers: ['SIN FRIJOL', 'EXTRA QUESO'], station: 'LINEA' },
                    { id: 'seed-5', name: 'Quesadilla de Pollo', qty: 1, unitPrice: 11.49, modifiers: ['CORTADA EN 4'], station: 'PARRILLA' },
                ],
                subtotal: 37.47,
                tax_rate: 10.25,
                tax_amount: 3.84,
                total_amount: 41.31,
                payment_method: 'UBER_EATS_API',
                payment_capture_mode: 'ONLINE_AUTH',
                kds_status: 'IN_PREP',
                station_code: 'LINEA',
                prep_seconds: 220,
                created_offline: false,
                power_source_mode: 'AC_GRID',
                drive_thru_stage: 'COMPLETED',
            },
            {
                client_order_id: 'SEED-1044',
                order_number: 1044,
                store_number: 14,
                business_date: currentBusinessDate,
                dining_option: 'DRIVE_THRU',
                customer_name: 'ORDEN DRIVE-THRU #1044 (VENTANILLA)',
                items: [
                    { id: 'seed-6', name: 'Combo Platillo Asada', qty: 1, unitPrice: 15.99, modifiers: ['TORTILLA RECIÉN HECHA MAÍZ'], station: 'PARRILLA' },
                    { id: 'seed-7', name: 'Taco de Lengua', qty: 2, unitPrice: 4.79, modifiers: ['CON TODO'], station: 'PARRILLA' },
                ],
                subtotal: 25.57,
                tax_rate: 0,
                tax_amount: 0,
                total_amount: 25.57,
                payment_method: 'EBT_CALFRESH',
                payment_capture_mode: 'PENDING_WINDOW',
                kds_status: 'IN_PREP',
                station_code: 'PARRILLA',
                prep_seconds: 64,
                created_offline: false,
                power_source_mode: 'AC_GRID',
                drive_thru_lane: 1,
                vehicle_type: 'N/A',
                vehicle_color: 'N/A',
                drive_thru_stage: 'AT_PAY_WINDOW',
                sos_speaker_sec: 32,
                sos_window_sec: 28,
            },
            {
                client_order_id: 'SEED-DT-1045',
                order_number: 1045,
                store_number: 14,
                business_date: currentBusinessDate,
                dining_option: 'DRIVE_THRU',
                customer_name: 'ORDEN DRIVE-THRU #1045 (ALTAVOZ)',
                items: [
                    { id: 'seed-dt-1', name: 'Taco Pastor (Maíz)', qty: 6, unitPrice: 3.79, modifiers: ['CON TODO', 'SALSA VERDE'], station: 'PARRILLA' },
                    { id: 'seed-dt-2', name: 'Vampiro de Asada', qty: 2, unitPrice: 5.99, modifiers: ['BIEN DORADO'], station: 'PARRILLA' },
                    { id: 'seed-dt-3', name: 'Agua de Piña Grande', qty: 2, unitPrice: 4.59, modifiers: ['NORMAL'], station: 'BEBIDAS' },
                ],
                subtotal: 43.90,
                tax_rate: 10.25,
                tax_amount: 4.50,
                total_amount: 48.40,
                payment_method: 'PENDING_WINDOW',
                payment_capture_mode: 'PENDING_WINDOW',
                kds_status: 'IN_PREP',
                station_code: 'PARRILLA',
                prep_seconds: 41,
                created_offline: false,
                power_source_mode: 'AC_GRID',
                drive_thru_lane: 1,
                vehicle_type: 'N/A',
                vehicle_color: 'N/A',
                drive_thru_stage: 'IN_CAR_QUEUE',
                sos_speaker_sec: 38,
                sos_window_sec: 0,
            },
            {
                client_order_id: 'SEED-CAT-1046',
                order_number: 1046,
                store_number: 14,
                business_date: currentBusinessDate,
                dining_option: 'TAKEOUT',
                customer_name: 'PARTY TRAY — FAMILIA MENDOZA (310-555-0192)',
                items: [
                    { id: 'seed-cat-1', name: 'Party Tray 30-40 Personas (Asada, Pastor, Pollo)', qty: 1, unitPrice: 373.89, modifiers: ['MAÍZ RECIÉN HECHA (25 DOC)', '10 LBS ARROZ Y FRIJOL', '6 GAL AGUA FRESCA'], station: 'PARRILLA' },
                ],
                subtotal: 373.89,
                tax_rate: 10.25,
                tax_amount: 38.32,
                total_amount: 412.21,
                payment_method: 'CARD_NFC',
                payment_capture_mode: 'ONLINE_AUTH',
                kds_status: 'SCHEDULED_HOLD',
                station_code: 'PARRILLA',
                prep_seconds: 0,
                created_offline: false,
                power_source_mode: 'AC_GRID',
                drive_thru_stage: 'COMPLETED',
                is_scheduled_catering: true,
                scheduled_pickup_time: '17:30 PM (Auto-Fire 16:45 PM)',
                prep_lead_time_mins: 45,
                loyalty_phone: '310-555-0192',
            },
        ]

        await supabase
            .from('gavilan_pos_orders')
            .upsert(v2SeedOrders, { onConflict: 'client_order_id', ignoreDuplicates: true })

        const { data: ordersData } = await supabase
            .from('gavilan_pos_orders')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(50)

        // 6. Fetch persistent cash closeouts
        const { data: closeoutsData } = await supabase
            .from('gavilan_pos_cash_closeouts')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(20)

        // 7. Fetch or seed Cash Drawer Live Ledger events (gavilan_pos_cash_events)
        let { data: cashEventsData } = await supabase
            .from('gavilan_pos_cash_events')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(30)

        if (!cashEventsData || cashEventsData.length === 0) {
            const seedCashEvents = [
                {
                    store_number: 14,
                    business_date: currentBusinessDate,
                    terminal_id: 'POS-CAJA-1',
                    event_type: 'STARTING_BANK',
                    amount: 300.00,
                    reason: 'Fondo Inicial de Apertura de Turno AM (6:00 AM)',
                    performed_by: 'María G. (Cajera)',
                    manager_pin_used: '1425',
                    created_offline: false,
                },
                {
                    store_number: 14,
                    business_date: currentBusinessDate,
                    terminal_id: 'POS-CAJA-1',
                    event_type: 'CASH_DROP',
                    amount: 450.00,
                    reason: 'Sangría de Efectivo #1 a Caja Fuerte (Smart Safe Drop)',
                    performed_by: 'Sistema de Monitoreo',
                    manager_pin_used: '1425',
                    created_offline: false,
                },
                {
                    store_number: 14,
                    business_date: currentBusinessDate,
                    terminal_id: 'POS-CAJA-1',
                    event_type: 'PAY_OUT',
                    amount: 24.50,
                    reason: 'Compra urgente de hielo extra para estación de aguas (Recibo #881)',
                    performed_by: 'Sistema de Monitoreo',
                    manager_pin_used: '1425',
                    created_offline: false,
                },
            ]
            await supabase.from('gavilan_pos_cash_events').insert(seedCashEvents)
            const { data: reloadedCashEvents } = await supabase
                .from('gavilan_pos_cash_events')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(30)
            cashEventsData = reloadedCashEvents || []
        }

        // 8. Fetch or seed POS Timeclock & California Break Compliance entries (gavilan_pos_timeclock_entries)
        let { data: timeclockData } = await supabase
            .from('gavilan_pos_timeclock_entries')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(30)

        if (!timeclockData || timeclockData.length === 0) {
            const seedTimeclock = [
                {
                    store_number: 14,
                    business_date: currentBusinessDate,
                    employee_name: 'María González',
                    employee_role: 'Cajera Front & Drive-Thru',
                    passcode: '2201',
                    punch_type: 'CLOCK_IN',
                    shift_elapsed_minutes: 215,
                    meal_penalty_warning: false,
                    california_attestation_signed: true,
                    ronos_synced: true,
                },
                {
                    store_number: 14,
                    business_date: currentBusinessDate,
                    employee_name: 'Jorge Ramírez',
                    employee_role: 'Taquero Parrilla #1',
                    passcode: '3304',
                    punch_type: 'START_MEAL_BREAK_30',
                    shift_elapsed_minutes: 275,
                    meal_penalty_warning: false,
                    california_attestation_signed: true,
                    ronos_synced: true,
                },
                {
                    store_number: 14,
                    business_date: currentBusinessDate,
                    employee_name: 'Ana López',
                    employee_role: 'Order Taker Drive-Thru (Headset)',
                    passcode: '4410',
                    punch_type: 'START_REST_BREAK_10',
                    shift_elapsed_minutes: 130,
                    meal_penalty_warning: false,
                    california_attestation_signed: true,
                    ronos_synced: true,
                },
            ]
            await supabase.from('gavilan_pos_timeclock_entries').insert(seedTimeclock)
            const { data: reloadedTimeclock } = await supabase
                .from('gavilan_pos_timeclock_entries')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(30)
            timeclockData = reloadedTimeclock || []
        }

        // 9. Fetch Loyalty & Gift Card Accounts (gavilan_pos_loyalty_accounts)
        const { data: loyaltyData } = await supabase
            .from('gavilan_pos_loyalty_accounts')
            .select('*')
            .order('points_balance', { ascending: false })
            .limit(30)

        const sanitizedOrders = isStaffAuthenticated
            ? (ordersData || []).map((o: any) => ({
                ...o,
                manager_pin_used: o.manager_pin_used ? '****' : null,
            }))
            : []
        const sanitizedCashEvents = isStaffAuthenticated
            ? (cashEventsData || []).map((ev: any) => ({ ...ev, manager_pin_used: ev.manager_pin_used ? '****' : null }))
            : []
        const sanitizedTimeclock = isStaffAuthenticated
            ? (timeclockData || []).map((tc: any) => ({ ...tc, passcode: '****' }))
            : []

        return NextResponse.json({
            ok: true,
            currentBusinessDate,
            currentShift: getCurrentGavilanShift(),
            latestBusinessDate: latestFullDate,
            localLanInfo: isStaffAuthenticated ? getLocalLanAddresses() : null,
            stores: storesList,
            storeConfigs: isStaffAuthenticated ? (storeConfigsData || []) : [],
            menuItems: cleanMenu,
            orders: sanitizedOrders,
            closeouts: isStaffAuthenticated ? (closeoutsData || []) : [],
            cashEvents: sanitizedCashEvents,
            timeclockEntries: sanitizedTimeclock,
            loyaltyAccounts: isStaffAuthenticated ? (loyaltyData || []) : [],
            metricsSummary: isStaffAuthenticated
                ? {
                    daysSampled: uniqueDates30d.size || 30,
                    sampleNetSales: total30dNet,
                    sampleOrders: total30dOrders,
                    sampleUber: total30dUber,
                    sampleDoordash: total30dDoordash,
                    sampleGrubhub: total30dGrubhub,
                    sampleEbt: total30dEbt,
                    annualizedNetSales: 71090000,
                    annualizedGrossCollected: 77911000,
                    annualizedCardVolume: 43200000,
                    annualizedOrders: 3662000,
                    annualizedDeliveryNet: 12919000,
                    annualizedEbtSales: 1980000,
                }
                : {
                    daysSampled: 0,
                    sampleNetSales: 0,
                    sampleOrders: 0,
                    sampleUber: 0,
                    sampleDoordash: 0,
                    sampleGrubhub: 0,
                    sampleEbt: 0,
                    annualizedNetSales: 0,
                    annualizedGrossCollected: 0,
                    annualizedCardVolume: 0,
                    annualizedOrders: 0,
                    annualizedDeliveryNet: 0,
                    annualizedEbtSales: 0,
                }
        })
    } catch (error: any) {
        console.error('[Gavilan POS Overview GET Error]:', error)
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }
}

/**
 * Ejecuta una mutación individual en Supabase PostgreSQL
 */
async function executeSingleMutation(supabase: any, action: string, payload: any) {
    const currentBusinessDate = getCurrentGavilanBusinessDate()
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

    if (action === 'TOGGLE_86') {
        const { guid, inStock } = payload
        const { data, error } = await supabase
            .from('gavilan_pos_menu_items')
            .update({ is_86ed: !Boolean(inStock), updated_at: new Date().toISOString() })
            .eq('id', guid)
            .select()
            .single()
        if (error) throw error
        return { updatedItem: data }
    }

    if (action === 'UPDATE_MENU_ITEM') {
        const { guid, name, basePrice, deliveryPrice, deliveryMarkupPct, prepStation, inStock, taxInherited } = payload
        const updatePayload: Record<string, any> = { updated_at: new Date().toISOString() }
        if (typeof name === 'string' && name.trim().length > 0) updatePayload.name = name.trim()
        if (typeof basePrice === 'number') updatePayload.base_price = basePrice
        if (typeof deliveryMarkupPct === 'number') {
            updatePayload.delivery_markup_pct = deliveryMarkupPct
        } else if (typeof deliveryPrice === 'number' && typeof basePrice === 'number' && basePrice > 0) {
            updatePayload.delivery_markup_pct = Math.max(0, Math.round(((deliveryPrice / basePrice) - 1) * 100))
        }
        if (typeof prepStation === 'string') updatePayload.station_code = prepStation
        if (typeof inStock === 'boolean') updatePayload.is_86ed = !inStock
        if (typeof taxInherited === 'boolean') updatePayload.tax_exempt_ebt = taxInherited

        const { data, error } = await supabase
            .from('gavilan_pos_menu_items')
            .update(updatePayload)
            .eq('id', guid)
            .select()
            .single()
        if (error) throw error
        return { updatedItem: data }
    }

    if (action === 'BULK_PUBLISH_MENU') {
        const { items } = payload
        if (Array.isArray(items) && items.length > 0) {
            const rows = items.map((it: any) => {
                const bp = Number(it.basePrice || 0)
                const dp = Number(it.deliveryPrice || 0)
                const computedMarkup = typeof it.deliveryMarkupPct === 'number'
                    ? it.deliveryMarkupPct
                    : (bp > 0 && dp > 0 ? Math.max(0, Math.round(((dp / bp) - 1) * 100)) : 18)
                return {
                    id: it.guid,
                    name: it.name,
                    category: it.groupName,
                    base_price: bp,
                    delivery_markup_pct: computedMarkup,
                    station_code: it.prepStation || 'LINEA',
                    is_86ed: !Boolean(it.inStock),
                    tax_exempt_ebt: Boolean(it.taxInherited ?? true),
                    updated_at: new Date().toISOString(),
                }
            })
            const { error } = await supabase
                .from('gavilan_pos_menu_items')
                .upsert(rows, { onConflict: 'id' })
            if (error) throw error
        }
        return { publishedCount: Array.isArray(items) ? items.length : 0 }
    }

    if (action === 'CREATE_ORDER') {
        const {
            clientOrderId,
            orderNumber,
            storeNumber,
            diningOption,
            customerName,
            items,
            subtotal,
            taxRate,
            taxAmount,
            totalAmount,
            paymentMethod,
            paymentCaptureMode,
            kdsStatus,
            stationCode,
            createdOffline,
            powerSourceMode,
            driveThruLane,
            vehicleType,
            vehicleColor,
            driveThruStage,
            sosSpeakerSec,
            sosWindowSec,
            isScheduledCatering,
            scheduledPickupTime,
            prepLeadTimeMins,
            splitEbtAmount,
            splitSecondaryAmount,
            splitSecondaryMethod,
            discountAmount,
            discountReason,
            isVoided,
            voidReason,
            isWaste,
            managerPinUsed,
            loyaltyPhone,
        } = payload

        const resolvedClientOrderId = clientOrderId || `ORD-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
        const { data: existingOrder } = await supabase
            .from('gavilan_pos_orders')
            .select('id, client_order_id, order_number, total_amount')
            .eq('client_order_id', resolvedClientOrderId)
            .maybeSingle()

        const resolvedStage = driveThruStage || (diningOption === 'DRIVE_THRU' ? 'IN_CAR_QUEUE' : 'COMPLETED')
        const resolvedKdsStatus = kdsStatus || (isScheduledCatering ? 'SCHEDULED_HOLD' : 'IN_PREP')

        const { data, error } = await supabase
            .from('gavilan_pos_orders')
            .upsert({
                client_order_id: resolvedClientOrderId,
                order_number: Number(orderNumber || 1050),
                store_number: Number(storeNumber || 14),
                business_date: payload.businessDate || currentBusinessDate,
                dining_option: diningOption || 'FOR_HERE',
                customer_name: customerName || 'WALK-IN',
                items: Array.isArray(items) ? items : [],
                subtotal: Number(subtotal || 0),
                tax_rate: Number(taxRate || 0),
                tax_amount: Number(taxAmount || 0),
                total_amount: Number(totalAmount || 0),
                payment_method: paymentMethod || 'CASH',
                payment_capture_mode: paymentCaptureMode || 'ONLINE_AUTH',
                kds_status: resolvedKdsStatus,
                station_code: stationCode || 'PARRILLA',
                prep_seconds: 0,
                created_offline: Boolean(createdOffline),
                power_source_mode: powerSourceMode || 'AC_GRID',
                drive_thru_lane: Number(driveThruLane || 1),
                vehicle_type: vehicleType || 'N/A',
                vehicle_color: vehicleColor || 'N/A',
                drive_thru_stage: resolvedStage,
                sos_speaker_sec: Number(sosSpeakerSec || 0),
                sos_window_sec: Number(sosWindowSec || 0),
                is_scheduled_catering: Boolean(isScheduledCatering),
                scheduled_pickup_time: scheduledPickupTime || null,
                prep_lead_time_mins: Number(prepLeadTimeMins || 45),
                split_ebt_amount: Number(splitEbtAmount || 0),
                split_secondary_amount: Number(splitSecondaryAmount || 0),
                split_secondary_method: splitSecondaryMethod || null,
                discount_amount: Number(discountAmount || 0),
                discount_reason: discountReason || null,
                is_voided: Boolean(isVoided),
                void_reason: voidReason || null,
                is_waste: Boolean(isWaste),
                manager_pin_used: managerPinUsed || null,
                loyalty_phone: loyaltyPhone || null,
                synced_at: new Date().toISOString(),
            }, { onConflict: 'client_order_id' })
            .select()
            .single()

        if (error) throw error
        return { order: data, idempotentReplay: Boolean(existingOrder) }
    }

    if (action === 'UPDATE_DRIVETHRU_ORDER') {
        const {
            orderId,
            clientOrderId,
            driveThruStage,
            paymentMethod,
            paymentCaptureMode,
            sosWindowSec,
            items,
            subtotal,
            taxRate,
            taxAmount,
            totalAmount,
            splitEbtAmount,
            splitSecondaryAmount,
            splitSecondaryMethod,
        } = payload

        const updateObj: Record<string, any> = {
            synced_at: new Date().toISOString(),
        }
        if (driveThruStage) updateObj.drive_thru_stage = driveThruStage
        if (paymentMethod) updateObj.payment_method = paymentMethod
        if (paymentCaptureMode) updateObj.payment_capture_mode = paymentCaptureMode
        if (typeof sosWindowSec === 'number') updateObj.sos_window_sec = sosWindowSec
        if (Array.isArray(items)) updateObj.items = items
        if (typeof subtotal === 'number') updateObj.subtotal = subtotal
        if (typeof taxRate === 'number') updateObj.tax_rate = taxRate
        if (typeof taxAmount === 'number') updateObj.tax_amount = taxAmount
        if (typeof totalAmount === 'number') updateObj.total_amount = totalAmount
        if (typeof splitEbtAmount === 'number') updateObj.split_ebt_amount = splitEbtAmount
        if (typeof splitSecondaryAmount === 'number') updateObj.split_secondary_amount = splitSecondaryAmount
        if (splitSecondaryMethod !== undefined) updateObj.split_secondary_method = splitSecondaryMethod

        let query = supabase.from('gavilan_pos_orders').update(updateObj)
        if (orderId && uuidRegex.test(String(orderId))) {
            query = query.eq('id', orderId)
        } else if (clientOrderId || orderId) {
            query = query.eq('client_order_id', String(clientOrderId || orderId))
        } else {
            query = query.eq('order_number', Number(payload.orderNumber || 0))
        }

        const { data, error } = await query.select().single()
        if (error) throw error
        return { updatedOrder: data }
    }

    if (action === 'FIRE_SCHEDULED_CATERING') {
        const { orderId, clientOrderId, orderNumber } = payload
        let query = supabase
            .from('gavilan_pos_orders')
            .update({
                kds_status: 'IN_PREP',
                prep_seconds: 0,
                synced_at: new Date().toISOString(),
            })

        if (orderId && uuidRegex.test(String(orderId))) {
            query = query.eq('id', orderId)
        } else if (clientOrderId || orderId) {
            query = query.eq('client_order_id', String(clientOrderId || orderId))
        } else {
            query = query.eq('order_number', Number(orderNumber || 0))
        }

        const { data, error } = await query.select()
        if (error) throw error
        return { firedOrders: data }
    }

    if (action === 'VOID_OR_COMP_ORDER') {
        const {
            orderId,
            clientOrderId,
            orderNumber,
            isVoided,
            voidReason,
            isWaste,
            discountAmount,
            discountReason,
            managerPinUsed,
            newSubtotal,
            newTaxAmount,
            newTotalAmount,
        } = payload

        const updateObj: Record<string, any> = {
            manager_pin_used: managerPinUsed || '1425',
            synced_at: new Date().toISOString(),
        }
        if (typeof isVoided === 'boolean') {
            updateObj.is_voided = isVoided
            if (isVoided) {
                updateObj.kds_status = 'BUMPED'
                updateObj.total_amount = 0
                updateObj.tax_amount = 0
            }
        }
        if (voidReason !== undefined) updateObj.void_reason = voidReason
        if (typeof isWaste === 'boolean') updateObj.is_waste = isWaste
        if (typeof discountAmount === 'number') updateObj.discount_amount = discountAmount
        if (discountReason !== undefined) updateObj.discount_reason = discountReason
        if (typeof newSubtotal === 'number') updateObj.subtotal = newSubtotal
        if (typeof newTaxAmount === 'number') updateObj.tax_amount = newTaxAmount
        if (typeof newTotalAmount === 'number') updateObj.total_amount = newTotalAmount

        let query = supabase.from('gavilan_pos_orders').update(updateObj)
        if (orderId && uuidRegex.test(String(orderId))) {
            query = query.eq('id', orderId)
        } else if (clientOrderId || orderId) {
            query = query.eq('client_order_id', String(clientOrderId || orderId))
        } else {
            query = query.eq('order_number', Number(orderNumber || 0))
        }

        const { data, error } = await query.select()
        if (error) throw error
        return { updatedOrders: data }
    }

    if (action === 'RECORD_CASH_EVENT') {
        const {
            storeNumber,
            terminalId,
            eventType,
            amount,
            reason,
            performedBy,
            managerPinUsed,
            createdOffline,
        } = payload

        const { data, error } = await supabase
            .from('gavilan_pos_cash_events')
            .insert({
                store_number: Number(storeNumber || 14),
                business_date: payload.businessDate || currentBusinessDate,
                terminal_id: terminalId || 'POS-CAJA-1',
                event_type: eventType || 'CASH_DROP',
                amount: Number(amount || 0),
                reason: reason || 'Movimiento de efectivo en gaveta',
                performed_by: performedBy || 'Manager en Turno',
                manager_pin_used: managerPinUsed || '1425',
                created_offline: Boolean(createdOffline),
            })
            .select()
            .single()

        if (error) throw error
        return { cashEvent: data }
    }

    if (action === 'PUNCH_TIMECLOCK') {
        const {
            storeNumber,
            employeeName,
            employeeRole,
            passcode,
            punchType,
            shiftElapsedMinutes,
            mealPenaltyWarning,
            californiaAttestationSigned,
        } = payload

        const { data, error } = await supabase
            .from('gavilan_pos_timeclock_entries')
            .insert({
                store_number: Number(storeNumber || 14),
                business_date: payload.businessDate || currentBusinessDate,
                employee_name: employeeName || 'Colaborador Tacos Gavilan',
                employee_role: employeeRole || 'Cajero / Taquero',
                passcode: passcode || '0000',
                punch_type: punchType || 'CLOCK_IN',
                shift_elapsed_minutes: Number(shiftElapsedMinutes || 0),
                meal_penalty_warning: Boolean(mealPenaltyWarning),
                california_attestation_signed: Boolean(californiaAttestationSigned ?? true),
                ronos_synced: true,
            })
            .select()
            .single()

        if (error) throw error
        return { timeclockEntry: data }
    }

    if (action === 'UPDATE_LOYALTY_OR_GIFTCARD') {
        const {
            phone,
            customerName,
            pointsDelta,
            giftcardDeltaUsd,
            orderTotalUsd,
        } = payload

        const cleanPhone = String(phone || '323-555-0148').trim()
        const { data: existing } = await supabase
            .from('gavilan_pos_loyalty_accounts')
            .select('*')
            .eq('phone', cleanPhone)
            .maybeSingle()

        const nextPoints = Math.max(0, Number(existing?.points_balance || 0) + Number(pointsDelta || 0))
        const nextGiftcard = Math.max(0, Number((Number(existing?.giftcard_balance_usd || 0) + Number(giftcardDeltaUsd || 0)).toFixed(2)))
        const nextSpent = Number((Number(existing?.lifetime_spent_usd || 0) + Number(orderTotalUsd || 0)).toFixed(2))
        const nextVisits = Number(existing?.visits_count || 0) + (Number(orderTotalUsd || 0) > 0 ? 1 : 0)

        const { data, error } = await supabase
            .from('gavilan_pos_loyalty_accounts')
            .upsert({
                phone: cleanPhone,
                customer_name: customerName || existing?.customer_name || 'Cliente Gavilan Rewards',
                points_balance: nextPoints,
                giftcard_balance_usd: nextGiftcard,
                lifetime_spent_usd: nextSpent,
                visits_count: nextVisits,
                updated_at: new Date().toISOString(),
            }, { onConflict: 'phone' })
            .select()
            .single()

        if (error) throw error
        return { loyaltyAccount: data }
    }

    if (action === 'BUMP_ORDER') {
        const { orderId, clientOrderId, prepSeconds } = payload
        let query = supabase
            .from('gavilan_pos_orders')
            .update({
                kds_status: 'BUMPED',
                prep_seconds: Number(prepSeconds || 90),
                bumped_at: new Date().toISOString(),
            })

        if (orderId && uuidRegex.test(String(orderId))) {
            query = query.eq('id', orderId)
        } else if (clientOrderId || orderId) {
            query = query.eq('client_order_id', String(clientOrderId || orderId))
        } else {
            query = query.eq('order_number', Number(payload.orderNumber || 0))
        }

        const { data, error } = await query.select()
        if (error) throw error
        return { bumpedOrders: data }
    }

    if (action === 'RECALL_ORDER') {
        const { orderId, clientOrderId, orderNumber } = payload
        let targetId: string | null = null

        if (!orderId && !clientOrderId && !orderNumber) {
            const { data: latestBumped } = await supabase
                .from('gavilan_pos_orders')
                .select('id')
                .eq('kds_status', 'BUMPED')
                .order('bumped_at', { ascending: false })
                .limit(1)
            targetId = latestBumped?.[0]?.id || null
        }

        let query = supabase
            .from('gavilan_pos_orders')
            .update({
                kds_status: 'IN_PREP',
                bumped_at: null,
            })

        if (targetId) {
            query = query.eq('id', targetId)
        } else if (orderId && uuidRegex.test(String(orderId))) {
            query = query.eq('id', orderId)
        } else if (clientOrderId || orderId) {
            query = query.eq('client_order_id', String(clientOrderId || orderId))
        } else {
            query = query.eq('order_number', Number(orderNumber || 0))
        }

        const { data, error } = await query.select()
        if (error) throw error
        return { recalledOrders: data }
    }

    if (action === 'SAVE_STORE_CONFIG') {
        const {
            storeNumber,
            quoteMinutes,
            receiptHeader,
            receiptFooter,
            printRedModifiers,
            printerReceiptIp,
            printerKitchenIp,
            offlineSafLimitUsd,
            upsBatteryModel,
            cellularFailoverModel,
        } = payload

        const { data, error } = await supabase
            .from('gavilan_pos_store_configs')
            .upsert({
                store_number: Number(storeNumber || 14),
                quote_minutes: Number(quoteMinutes || 12),
                receipt_header: receiptHeader || 'TACOS GAVILAN — SABOR AUTÉNTICO',
                receipt_footer: receiptFooter || '¡GRACIAS POR SU VISITA! CALFRESH EBT RMP ACCEPTED',
                print_red_modifiers: Boolean(printRedModifiers ?? true),
                printer_receipt_ip: (() => {
                    const p = parseValidatedLanPrinterTarget(printerReceiptIp || '192.168.14.50:9100')
                    if (!p.ok) throw new Error(p.error)
                    return `${p.host}:${p.port}`
                })(),
                printer_kitchen_ip: (() => {
                    const p = parseValidatedLanPrinterTarget(printerKitchenIp || '192.168.14.51:9100')
                    if (!p.ok) throw new Error(p.error)
                    return `${p.host}:${p.port}`
                })(),
                offline_saf_limit_usd: Number(offlineSafLimitUsd || 75),
                ups_battery_model: upsBatteryModel || 'EcoFlow DELTA 2 LiFePO4 (1024Wh) + SUNMI UPS Base',
                cellular_failover_model: cellularFailoverModel || 'Peplink BR1 Mini 5G Dual-WAN (<1s Failover)',
                updated_at: new Date().toISOString(),
            }, { onConflict: 'store_number' })
            .select()
            .single()

        if (error) throw error
        return { config: data }
    }

    if (action === 'CREATE_CLOSEOUT') {
        const { storeNumber, expectedCash, countedCash, closedBy, createdOffline } = payload
        const exp = Number(expectedCash || 0)
        const cnt = Number(countedCash || 0)
        const variance = Number((cnt - exp).toFixed(2))

        const { data, error } = await supabase
            .from('gavilan_pos_cash_closeouts')
            .insert({
                store_number: Number(storeNumber || 14),
                business_date: currentBusinessDate,
                expected_cash: exp,
                counted_cash: cnt,
                variance,
                closed_by: closedBy || 'Manager en Turno',
                created_offline: Boolean(createdOffline),
            })
            .select()
            .single()

        if (error) throw error
        return { closeout: data }
    }

    throw new Error(`Unsupported action: ${action}`)
}

/**
 * Envía o verifica un paquete binario ESC/POS real por socket TCP puerto 9100
 * Soporta perfiles específicos para el Laboratorio en La Bodega Central:
 * - TP200_80MM: Impresora térmica Toast TP200 / Epson TM-T88 (Recibo 80mm + Pulso Cajón RJ12 Pin 2 y Pin 5)
 * - EPSON_L90_LABEL: Impresora de etiquetas adhesivas Epson TM-L90 (Ticket de Bolsa Liner-Free + Corte)
 * - DRAWER_ONLY: Envía únicamente el pulso eléctrico RJ12 (Pin 2 + Pin 5) para abrir el cajón de dinero sin gastar papel
 */
async function sendEscPosOverTcp(
    targetIpPort: string,
    headerText: string,
    footerText: string,
    redInk: boolean,
    orderInfo: any,
    printerProfile: 'TP200_80MM' | 'EPSON_L90_LABEL' | 'DRAWER_ONLY' = 'TP200_80MM'
) {
    const validatedTarget = parseValidatedLanPrinterTarget(targetIpPort)
    if (!validatedTarget.ok) {
        throw new Error(validatedTarget.error)
    }
    const host = validatedTarget.host
    const port = validatedTarget.port
    const orderNum = orderInfo?.orderNumber ?? orderInfo?.checkNumber ?? 1045
    const diningOpt = orderInfo?.diningOption || 'TO_GO'
    const totalAmt = Number(orderInfo?.totalAmount ?? orderInfo?.total ?? 0)
    const payMethod = orderInfo?.paymentMethod ?? orderInfo?.tender ?? 'CASH'

    let chunks: Buffer[] = []

    if (printerProfile === 'DRAWER_ONLY') {
        // Pure Cash Drawer Solenoid Kick on both Pin 2 (0x00) and Pin 5 (0x01) for 100% compatibility
        chunks = [
            Buffer.from([0x1B, 0x40]), // ESC @ Initialize
            Buffer.from([0x1B, 0x70, 0x00, 0x19, 0xFA]), // ESC p 0 25 250 (Pin 2 Kick)
            Buffer.from([0x1B, 0x70, 0x01, 0x19, 0xFA]), // ESC p 1 25 250 (Pin 5 Kick)
        ]
    } else if (printerProfile === 'EPSON_L90_LABEL') {
        // Epson TM-L90 Liner-Free Sticky Bag Label format (compact 32-char width, no drawer kick needed or optional)
        chunks = [
            Buffer.from([0x1B, 0x40]), // ESC @ Initialize
            Buffer.from([0x1B, 0x61, 0x01]), // Center align
            Buffer.from([0x1D, 0x21, 0x11]), // Double height/width
            Buffer.from(`#${orderNum} ${diningOpt}\n`, 'ascii'),
            Buffer.from([0x1D, 0x21, 0x00]), // Normal text
            Buffer.from(`TACOS GAVILAN - ETIQUETA BOLSA\n`, 'ascii'),
            Buffer.from('--------------------------------\n', 'ascii'),
            Buffer.from([0x1B, 0x61, 0x00]), // Left align
        ]
        for (const item of (orderInfo?.items || [])) {
            const qty = Number(item.qty || 1)
            chunks.push(Buffer.from(`[ ] ${qty}x ${item.name}\n`, 'ascii'))
            if (Array.isArray(item.modifiers) && item.modifiers.length > 0) {
                const modStrings = item.modifiers.map((m: any) => typeof m === 'string' ? m : m.name).filter(Boolean)
                if (modStrings.length > 0) {
                    if (redInk) chunks.push(Buffer.from([0x1D, 0x42, 0x01]))
                    chunks.push(Buffer.from(`  * ${modStrings.join(', ')}\n`, 'ascii'))
                    if (redInk) chunks.push(Buffer.from([0x1D, 0x42, 0x00]))
                }
            }
        }
        chunks.push(
            Buffer.from('--------------------------------\n', 'ascii'),
            Buffer.from(`ITEMS: ${(orderInfo?.items || []).length} | ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}\n\n\n`, 'ascii'),
            Buffer.from([0x1D, 0x56, 0x42, 0x00]) // GS V B 0 Label Cut
        )
    } else {
        // Standard Toast TP200 / Epson TM-T88 80mm Thermal Receipt + Dual-Pin RJ12 Cash Drawer Kick
        chunks = [
            Buffer.from([0x1B, 0x40]), // ESC @ Initialize printer
            Buffer.from([0x1B, 0x61, 0x01]), // ESC a 1 Center align
            Buffer.from([0x1D, 0x21, 0x11]), // GS ! Double height/width
            Buffer.from(`${headerText}\n`, 'ascii'),
            Buffer.from([0x1D, 0x21, 0x00]), // Normal text
            Buffer.from(`ORDEN #${orderNum} - ${diningOpt}\n`, 'ascii'),
            Buffer.from('------------------------------------------\n', 'ascii'),
            Buffer.from([0x1B, 0x61, 0x00]), // Left align
        ]

        for (const item of (orderInfo?.items || [])) {
            const qty = Number(item.qty || 1)
            const unitPrice = Number(item.unitPrice || 0)
            chunks.push(Buffer.from(`${qty}x ${item.name}  $${(qty * unitPrice).toFixed(2)}\n`, 'ascii'))
            if (Array.isArray(item.modifiers) && item.modifiers.length > 0) {
                const modStrings = item.modifiers.map((m: any) => typeof m === 'string' ? m : m.name).filter(Boolean)
                if (modStrings.length > 0) {
                    if (redInk) chunks.push(Buffer.from([0x1D, 0x42, 0x01])) // GS B 1 Thermal Reverse Black/White Highlight
                    chunks.push(Buffer.from(`   >> ${modStrings.join(', ')}\n`, 'ascii'))
                    if (redInk) chunks.push(Buffer.from([0x1D, 0x42, 0x00])) // GS B 0 Normal Black on White
                }
            }
        }

        chunks.push(
            Buffer.from('------------------------------------------\n', 'ascii'),
            Buffer.from(`TOTAL: $${totalAmt.toFixed(2)} (${payMethod})\n`, 'ascii'),
            Buffer.from(`${footerText}\n\n\n`, 'ascii'),
            Buffer.from([0x1D, 0x56, 0x42, 0x00]), // GS V B 0 Partial Cut
            Buffer.from([0x1B, 0x70, 0x00, 0x19, 0xFA]), // ESC p 0 25 250 Open RJ12 Cash Drawer (Pin 2)
            Buffer.from([0x1B, 0x70, 0x01, 0x19, 0xFA])  // ESC p 1 25 250 Open RJ12 Cash Drawer (Pin 5)
        )
    }

    const payloadBuffer = Buffer.concat(chunks)
    const hexDump = payloadBuffer.toString('hex').toUpperCase().match(/.{1,2}/g)?.slice(0, 64).join(' ') + ' ...'

    if (process.env.VERCEL === '1') {
        throw new Error('Conexiones TCP crudas bloqueadas en entorno cloud serverless (VERCEL=1) por seguridad anti-SSRF.')
    }

    const socketResult = await new Promise<{ connected: boolean; message: string }>((resolve) => {
        const socket = new net.Socket()
        let settled = false
        const finish = (connected: boolean, message: string) => {
            if (settled) return
            settled = true
            socket.destroy()
            resolve({ connected, message })
        }

        socket.setTimeout(1200)
        socket.on('connect', () => {
            socket.write(payloadBuffer, () => {
                const actionDesc =
                    printerProfile === 'DRAWER_ONLY'
                        ? 'disparó pulso RJ12 (Pin 2 + Pin 5) y abrió el cajón de dinero'
                        : printerProfile === 'EPSON_L90_LABEL'
                            ? 'imprimió etiqueta adhesiva en Epson TM-L90'
                            : 'imprimió recibo 80mm en Toast TP200 / Epson y abrió cajón RJ12'
                finish(true, `¡ÉXITO FÍSICO! Impresora en ${host}:${port} recibió ${payloadBuffer.length} bytes ESC/POS y ${actionDesc}.`)
            })
        })
        socket.on('timeout', () => {
            finish(false, `Buffer ESC/POS [${printerProfile}] generado (${payloadBuffer.length} bytes). Timeout en ${host}:${port} — conecta la Epson L90 o TP200 al mismo router y usa el botón "Escanear Red de Bodega".`)
        })
        socket.on('error', (err: any) => {
            finish(false, `Buffer ESC/POS [${printerProfile}] generado (${payloadBuffer.length} bytes, ${err.code || 'LAN_UNREACHABLE'}). Conecta la impresora al router local o verifica su IP con el escáner.`)
        })

        try {
            socket.connect(port, host)
        } catch (e: any) {
            finish(false, `Buffer ESC/POS [${printerProfile}] generado (${payloadBuffer.length} bytes).`)
        }
    })

    return {
        target: `${host}:${port}`,
        printerProfile,
        bytesLength: payloadBuffer.length,
        hexPreview: hexDump,
        ...socketResult,
    }
}

/**
 * Escanea la subred local de La Bodega Central en busca de impresoras Epson L90 / Toast TP200 con puerto TCP 9100 abierto
 */
async function scanWarehouseLanForPrinters(customSubnetPrefix?: string) {
    const lanInfo = getLocalLanAddresses()
    const rawPrefix = customSubnetPrefix ? String(customSubnetPrefix).trim() : lanInfo.subnetPrefix
    if (!isPrivateRfc1918SubnetPrefix(rawPrefix)) {
        throw new Error('Prefijo de subred bloqueado por seguridad anti-SSRF: solo se permiten subredes LAN privadas RFC1918.')
    }
    const prefix = rawPrefix
    if (process.env.VERCEL === '1') {
        return {
            scannedSubnet: `${prefix}.1-254`,
            localLanInfo: lanInfo,
            discoveredPrinters: [],
            cloudRestricted: true,
        }
    }
    const candidateIps: string[] = []
    for (let i = 1; i <= 254; i++) {
        candidateIps.push(`${prefix}.${i}`)
    }
    // Include exact Toast static IPs discovered in Lynwood (P-168 to P-174) and LA Central (P-169 to P-175)
    for (const staticIp of [
        '192.168.192.168',
        '192.168.192.169',
        '192.168.192.170',
        '192.168.192.171',
        '192.168.192.172',
        '192.168.192.173',
        '192.168.192.174',
        '192.168.192.175',
        '192.168.14.50',
        '192.168.1.200',
    ]) {
        if (!candidateIps.includes(staticIp)) candidateIps.push(staticIp)
    }

    const probePort9100 = (ip: string): Promise<{ ipPort: string; latencyMs: number } | null> => {
        return new Promise((resolve) => {
            const start = Date.now()
            const socket = new net.Socket()
            let done = false
            const closeAndResolve = (val: { ipPort: string; latencyMs: number } | null) => {
                if (done) return
                done = true
                socket.destroy()
                resolve(val)
            }
            socket.setTimeout(220)
            socket.on('connect', () => {
                closeAndResolve({ ipPort: `${ip}:9100`, latencyMs: Date.now() - start })
            })
            socket.on('timeout', () => closeAndResolve(null))
            socket.on('error', () => closeAndResolve(null))
            try {
                socket.connect(9100, ip)
            } catch {
                closeAndResolve(null)
            }
        })
    }

    const found: { ipPort: string; latencyMs: number }[] = []
    const batchSize = 64
    for (let i = 0; i < candidateIps.length; i += batchSize) {
        const slice = candidateIps.slice(i, i + batchSize)
        const results = await Promise.all(slice.map(probePort9100))
        for (const r of results) {
            if (r) found.push(r)
        }
    }

    return {
        scannedSubnet: `${prefix}.1-254`,
        localLanInfo: lanInfo,
        discoveredPrinters: found,
    }
}

export async function POST(req: NextRequest) {
    try {
        const supabase = await getSupabaseAdminClient()
        const body = await req.json()
        const { action } = body

        if (action !== 'SYNC_OFFLINE_OUTBOX') {
            const actionAuth = await authorizePosAction(req, supabase, String(action || ''), body)
            if (!actionAuth.authorized) {
                return NextResponse.json(
                    { ok: false, error: actionAuth.error || 'No autorizado' },
                    { status: actionAuth.status || 401 }
                )
            }
        }

        if (action === 'TEST_TCP_PRINT') {
            if (process.env.VERCEL === '1') {
                return NextResponse.json(
                    {
                        ok: false,
                        cloudRestricted: true,
                        error: 'Impresión TCP directa (puerto 9100) bloqueada en entorno cloud serverless (VERCEL=1) por seguridad anti-SSRF.',
                    },
                    { status: 403 }
                )
            }
            const targetCheck = parseValidatedLanPrinterTarget(body.targetIpPort)
            if (!targetCheck.ok) {
                return NextResponse.json({ ok: false, error: targetCheck.error }, { status: 400 })
            }
            const printResult = await sendEscPosOverTcp(
                body.targetIpPort,
                body.receiptHeader || 'TACOS GAVILAN — SABOR AUTÉNTICO',
                body.receiptFooter || '¡GRACIAS POR SU VISITA!',
                Boolean(body.printRedModifiers ?? true),
                body.orderInfo,
                body.printerProfile || 'TP200_80MM'
            )
            return NextResponse.json({ ok: true, printResult })
        }

        if (action === 'SCAN_WAREHOUSE_PRINTERS') {
            if (body.subnetPrefix && !isPrivateRfc1918SubnetPrefix(String(body.subnetPrefix))) {
                return NextResponse.json(
                    { ok: false, error: 'Subred bloqueada por seguridad anti-SSRF: solo se permiten subredes LAN privadas RFC1918.' },
                    { status: 400 }
                )
            }
            const scanResult = await scanWarehouseLanForPrinters(body.subnetPrefix)
            return NextResponse.json({ ok: true, scanResult })
        }

        if (action === 'VERIFY_IDEMPOTENCY_LAB') {
            const testClientId = `WAREHOUSE-LAB-IDEMP-${Date.now()}`
            const samplePayload = {
                clientOrderId: testClientId,
                orderNumber: 9901,
                storeNumber: Number(body.storeNumber || 14),
                diningOption: 'TO_GO',
                customerName: 'LABORATORIO BODEGA CENTRAL (PRUEBA REINTENTO 3X)',
                items: [
                    { id: 'tg-1', name: 'Taco de Asada', qty: 4, unitPrice: 3.49, station: 'PARRILLA', modifiers: ['CON TODO'] },
                ],
                subtotal: 13.96,
                taxRate: 10.25,
                taxAmount: 1.43,
                totalAmount: 15.39,
                paymentMethod: 'CARD_NFC',
                paymentCaptureMode: 'ONLINE_AUTH',
                createdOffline: true,
            }

            // Simulate 3 network reconnection retries with the exact same client_order_id
            const attempt1 = await executeSingleMutation(supabase, 'CREATE_ORDER', samplePayload)
            const attempt2 = await executeSingleMutation(supabase, 'CREATE_ORDER', samplePayload)
            const attempt3 = await executeSingleMutation(supabase, 'CREATE_ORDER', samplePayload)

            const { count: dbRowCount } = await supabase
                .from('gavilan_pos_orders')
                .select('*', { count: 'exact', head: true })
                .eq('client_order_id', testClientId)

            // Clean up lab test row after verification
            await supabase
                .from('gavilan_pos_orders')
                .delete()
                .eq('client_order_id', testClientId)

            return NextResponse.json({
                ok: true,
                labResult: {
                    clientOrderId: testClientId,
                    attemptsSent: 3,
                    attempt1Replay: Boolean(attempt1.idempotentReplay),
                    attempt2Replay: Boolean(attempt2.idempotentReplay),
                    attempt3Replay: Boolean(attempt3.idempotentReplay),
                    persistedRowCount: dbRowCount ?? 1,
                    zeroDuplicatesVerified: (dbRowCount ?? 1) === 1 && Boolean(attempt2.idempotentReplay) && Boolean(attempt3.idempotentReplay),
                    verifiedAt: new Date().toISOString(),
                }
            })
        }

        if (action === 'SYNC_OFFLINE_OUTBOX') {
            const baseAuth = verifyStaffAuth(req, { allowCron: false, allowEmployee: true })
            if (!baseAuth.authorized) {
                return NextResponse.json(
                    { ok: false, error: baseAuth.error || 'No autenticado' },
                    { status: baseAuth.status || 401 }
                )
            }
            const events = Array.isArray(body.events) ? body.events.slice(0, 100) : []
            const results: any[] = []
            for (const ev of events) {
                try {
                    const evAuth = await authorizePosAction(req, supabase, String(ev?.action || ''), ev?.payload || {})
                    if (!evAuth.authorized) {
                        results.push({ id: ev.id, action: ev.action, ok: false, error: evAuth.error || 'No autorizado' })
                        continue
                    }
                    const res = await executeSingleMutation(supabase, ev.action, ev.payload)
                    results.push({ id: ev.id, action: ev.action, ok: true, res })
                } catch (err: any) {
                    results.push({ id: ev.id, action: ev.action, ok: false, error: err.message })
                }
            }
            return NextResponse.json({
                ok: true,
                syncedCount: results.filter(r => r.ok).length,
                results,
            })
        }

        const result = await executeSingleMutation(supabase, action, body)
        return NextResponse.json({ ok: true, action, ...result })
    } catch (error: any) {
        console.error('[Gavilan POS Overview POST Error]:', error)
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }
}
