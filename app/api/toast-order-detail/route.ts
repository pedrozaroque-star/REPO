/**
 * @module api/toast-order-detail
 * @description Endpoint de consulta en tiempo real del detalle completo de una orden/ticket de Toast POS para auditoría forense y visor de tickets.
 * @businessRules
 *   - Resuelve el detalle de selecciones (items), precios de menú, descuentos por platillo, descuentos por cheque y pagos aplicados.
 *   - Mapeo dinámico de Dining Options mediante getDiningOptionsMap para traducir GUIDs de canal de venta.
 *   - Resolución automática del nombre real del cajero/a (`server.name`) cruzando `server.guid` contra `toast_employees` en Supabase (`toast_guid` y `v2_toast_guid`) con respaldo en Toast Labor API (`/labor/v1/employees/{guid}`) y caché en memoria.
 * @dataFlow Client (OrderReadyBoard / AuditoriaDescuentos / DriveThru) -> /api/toast-order-detail?guid=...&storeId=... -> Toast POS API /orders/{guid} + Supabase toast_employees -> Client Modal
 * @notes Utiliza getAuthToken() centralizado y cachés en memoria (`diningOptionsCache`, `employeeNameCache`) para respuesta ultrarrápida.
 */

import { NextResponse } from 'next/server'
import { getAuthToken } from '@/lib/toast-api'
import { supabaseAdmin } from '@/lib/supabase'

const TOAST_API_HOST = process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com'

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
    } catch (e) {
        return cached?.map || {}
    }
}

async function resolveEmployeeName(guid: string, token: string, storeId: string): Promise<string | null> {
    if (!guid) return null
    const cached = employeeNameCache.get(guid)
    if (cached && Date.now() - cached.at < EMPLOYEE_CACHE_TTL_MS) {
        return cached.name
    }

    // 1. Buscar en Supabase (toast_employees por toast_guid o v2_toast_guid)
    try {
        const { data: employees } = await supabaseAdmin
            .from('toast_employees')
            .select('toast_guid, v2_toast_guid, first_name, last_name, chosen_name')
            .or(`toast_guid.eq.${guid},v2_toast_guid.eq.${guid}`)
            .limit(1)

        if (employees && employees.length > 0) {
            const emp = employees[0]
            const firstLast = `${emp.first_name || ''} ${emp.last_name || ''}`.replace(/\s+/g, ' ').trim()
            const fullName = firstLast || (emp.chosen_name || '').trim()
            if (fullName) {
                const now = Date.now()
                if (emp.toast_guid) employeeNameCache.set(emp.toast_guid, { at: now, name: fullName })
                if (emp.v2_toast_guid) employeeNameCache.set(emp.v2_toast_guid, { at: now, name: fullName })
                employeeNameCache.set(guid, { at: now, name: fullName })
                return fullName
            }
        }
    } catch {
        // Continuar al fallback de Toast Labor API si falla la consulta
    }

    // 2. Respaldo directo en Toast Labor API (/labor/v1/employees/{guid})
    try {
        const empRes = await fetch(`${TOAST_API_HOST}/labor/v1/employees/${guid}`, {
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
                employeeNameCache.set(guid, { at: now, name: fullName })
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
    try {
        const { searchParams } = new URL(request.url)
        const orderGuid = searchParams.get('guid')
        const storeId = searchParams.get('storeId') || process.env.TOAST_RESTAURANT_ID

        if (!orderGuid) {
            return NextResponse.json({ error: 'Falta orderGuid' }, { status: 400 })
        }

        const token = await getAuthToken()
        if (!token) {
            return NextResponse.json({ error: 'No se pudo obtener el token de Toast' }, { status: 401 })
        }

        const url = new URL(`${TOAST_API_HOST}/orders/v2/orders/${orderGuid}`)

        // Ejecutar consulta de orden y mapa de diningOptions en paralelo (con caché en memoria para diningOptions)
        const [res, map] = await Promise.all([
            fetch(url.toString(), {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Toast-Restaurant-External-ID': storeId!
                }
            }),
            getDiningOptionsMap(token, storeId!)
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
            resolvedServerName = await resolveEmployeeName(serverGuid, token, storeId!)
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
