/**
 * @module api/toast-order-detail
 * @description Endpoint autenticado de consulta en tiempo real del detalle completo de una orden/ticket de Toast POS para auditoría forense y visor de tickets.
 * @businessRules
 *   - Exige sesión activa de personal interno mediante `verifyStaffAuth`.
 *   - Valida estrictamente `orderGuid` (`/^[a-f0-9-]{8,64}$/i`), `storeId` y `serverGuid` antes de construir URLs hacia Toast API o filtros `.or(...)` en Supabase (prevención total de path traversal `../` e inyección PostgREST).
 *   - Mapeo dinámico de Dining Options mediante `getDiningOptionsMap` para traducir GUIDs de canal de venta.
 *   - Resolución automática del nombre real del cajero/a (`server.name`) cruzando `server.guid` contra `toast_employees` en Supabase (`toast_guid` y `v2_toast_guid`) con respaldo en Toast Labor API (`/labor/v1/employees/{guid}`) y caché en memoria.
 * @dataFlow Client (OrderReadyBoard / AuditoriaDescuentos / DriveThru / Dashboard / FoodCost) -> `/api/toast-order-detail?guid=...&storeId=...` -> `verifyStaffAuth` + UUID validation -> Toast POS API `/orders/{guid}` + Supabase `toast_employees` -> Client Modal
 * @notes Endurecido 2026-11-20: agregados `verifyStaffAuth` y validación estricta de formato GUID/UUID.
 */

import { NextResponse } from 'next/server'
import { getAuthToken } from '@/lib/toast-api'
import { supabaseAdmin } from '@/lib/supabase'
import { verifyStaffAuth } from '@/lib/auth-server'

const TOAST_API_HOST = process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com'
const STRICT_TOAST_GUID_REGEX = /^[a-f0-9-]{8,64}$/i
const STRICT_STORE_ID_REGEX = /^(?:[a-f0-9-]{8,64}|\d{1,6})$/i

export const dynamic = 'force-dynamic'

const diningOptionsCache = new Map<string, { at: number; map: Record<string, string> }>()
const DINING_CACHE_TTL_MS = 60 * 60 * 1000 // 60 minutos

const employeeNameCache = new Map<string, { at: number; name: string }>()
const EMPLOYEE_CACHE_TTL_MS = 60 * 60 * 1000 // 60 minutos

async function getDiningOptionsMap(token: string, storeId: string): Promise<Record<string, string>> {
    const cached = diningOptionsCache.get(storeId)
    if (cached && Date.now() - cached.at < DINING_CACHE_TTL_MS) {
        return cached.map
    }
    try {
        const url = new URL(`${TOAST_API_HOST}/config/v2/diningOptions`)
        const res = await fetch(url.toString(), {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Toast-Restaurant-External-ID': storeId
            }
        })
        if (!res.ok) return cached?.map || {}
        const data = await res.json()
        const map: Record<string, string> = {}
        if (Array.isArray(data)) {
            data.forEach((opt: any) => {
                if (opt.guid && opt.name) map[opt.guid] = opt.name
            })
        }
        diningOptionsCache.set(storeId, { at: Date.now(), map })
        return map
    } catch {
        return cached?.map || {}
    }
}

async function resolveEmployeeName(guid: string, token: string, storeId: string): Promise<string | null> {
    const cleanGuid = String(guid || '').trim()
    if (!cleanGuid || !STRICT_TOAST_GUID_REGEX.test(cleanGuid)) return null

    const cached = employeeNameCache.get(cleanGuid)
    if (cached && Date.now() - cached.at < EMPLOYEE_CACHE_TTL_MS) {
        return cached.name
    }

    // 1. Buscar en Supabase (toast_employees por toast_guid o v2_toast_guid con GUID validado)
    try {
        const { data: employees } = await supabaseAdmin
            .from('toast_employees')
            .select('toast_guid, v2_toast_guid, first_name, last_name, chosen_name')
            .or(`toast_guid.eq.${cleanGuid},v2_toast_guid.eq.${cleanGuid}`)
            .limit(1)

        if (employees && employees.length > 0) {
            const emp = employees[0]
            const firstLast = `${emp.first_name || ''} ${emp.last_name || ''}`.replace(/\s+/g, ' ').trim()
            const fullName = firstLast || (emp.chosen_name || '').trim()
            if (fullName) {
                const now = Date.now()
                if (emp.toast_guid) employeeNameCache.set(emp.toast_guid, { at: now, name: fullName })
                if (emp.v2_toast_guid) employeeNameCache.set(emp.v2_toast_guid, { at: now, name: fullName })
                employeeNameCache.set(cleanGuid, { at: now, name: fullName })
                return fullName
            }
        }
    } catch {
        // Continuar al fallback de Toast Labor API si falla la consulta
    }

    // 2. Respaldo directo en Toast Labor API (/labor/v1/employees/{guid})
    try {
        const empRes = await fetch(`${TOAST_API_HOST}/labor/v1/employees/${encodeURIComponent(cleanGuid)}`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Toast-Restaurant-External-ID': storeId
            }
        })
        if (empRes.ok) {
            const emp = await empRes.json()
            const firstLast = `${emp.firstName || ''} ${emp.lastName || ''}`.replace(/\s+/g, ' ').trim()
            const fullName = firstLast || (emp.chosenName || '').trim()
            if (fullName) {
                const now = Date.now()
                employeeNameCache.set(cleanGuid, { at: now, name: fullName })
                if (emp.guid) employeeNameCache.set(emp.guid, { at: now, name: fullName })
                if (emp.v2EmployeeGuid) employeeNameCache.set(emp.v2EmployeeGuid, { at: now, name: fullName })
                return fullName
            }
        }
    } catch {
        // Ignorar errores de red secundarios
    }

    return null
}

export async function GET(request: Request) {
    const auth = verifyStaffAuth(request, { allowCron: false })
    if (!auth.authorized) {
        return auth.response!
    }

    try {
        const { searchParams } = new URL(request.url)
        const orderGuid = (searchParams.get('guid') || '').trim()
        const rawStoreId = (searchParams.get('storeId') || process.env.TOAST_RESTAURANT_ID || '').trim()

        if (!orderGuid) {
            return NextResponse.json({ error: 'Falta orderGuid' }, { status: 400 })
        }

        if (!STRICT_TOAST_GUID_REGEX.test(orderGuid)) {
            return NextResponse.json({ error: 'Formato de orderGuid inválido' }, { status: 400 })
        }

        if (!rawStoreId || !STRICT_STORE_ID_REGEX.test(rawStoreId)) {
            return NextResponse.json({ error: 'Formato de storeId inválido' }, { status: 400 })
        }

        let resolvedToastStoreGuid = rawStoreId
        if (/^\d+$/.test(rawStoreId)) {
            const { data: stRow } = await supabaseAdmin
                .from('stores')
                .select('external_id')
                .eq('id', Number(rawStoreId))
                .maybeSingle()
            if (stRow?.external_id && STRICT_TOAST_GUID_REGEX.test(stRow.external_id)) {
                resolvedToastStoreGuid = stRow.external_id
            }
        }

        const token = await getAuthToken()
        if (!token) {
            return NextResponse.json({ error: 'No se pudo obtener el token de Toast' }, { status: 401 })
        }

        const url = new URL(`${TOAST_API_HOST}/orders/v2/orders/${encodeURIComponent(orderGuid)}`)

        const [res, map] = await Promise.all([
            fetch(url.toString(), {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Toast-Restaurant-External-ID': resolvedToastStoreGuid
                }
            }),
            getDiningOptionsMap(token, resolvedToastStoreGuid)
        ])

        if (!res.ok) {
            const err = await res.text()
            return NextResponse.json({ error: `Toast Error: ${res.status} ${err}` }, { status: res.status })
        }

        const data = await res.json()

        // Resolver el nombre del Dining Option dinámicamente
        if (data.diningOption) {
            const optId = data.diningOption.guid || data.diningOption.id
            if (optId && map[optId]) {
                data.diningOption.name = map[optId]
            }
        }

        // Resolver el nombre real del Cajero/a (server.name)
        const serverObj =
            data.server ||
            data.checks?.[0]?.server ||
            data.checks?.[0]?.payments?.[0]?.server ||
            data.creator
        const serverGuid =
            data.server?.guid ||
            data.server?.id ||
            (typeof data.server === 'string' ? data.server : null) ||
            data.checks?.[0]?.server?.guid ||
            data.checks?.[0]?.server?.id ||
            data.checks?.[0]?.payments?.[0]?.server?.guid ||
            data.checks?.[0]?.payments?.[0]?.server?.id ||
            data.creator?.guid ||
            data.creator?.id ||
            null

        let resolvedServerName: string | null = null
        if (serverObj && typeof serverObj === 'object') {
            const directFirstLast = `${serverObj.firstName || ''} ${serverObj.lastName || ''}`.replace(/\s+/g, ' ').trim()
            if (directFirstLast) {
                resolvedServerName = directFirstLast
            } else if (serverObj.name && serverObj.name !== 'Unknown Server') {
                resolvedServerName = String(serverObj.name).trim()
            }
        }

        if (!resolvedServerName && serverGuid) {
            resolvedServerName = await resolveEmployeeName(String(serverGuid), token, resolvedToastStoreGuid)
        }

        if (resolvedServerName) {
            data.server = {
                ...(typeof data.server === 'object' && data.server ? data.server : {}),
                guid: serverGuid || data.server?.guid,
                name: resolvedServerName
            }
        }

        return NextResponse.json({ order: data })
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
