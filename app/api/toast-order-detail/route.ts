/**
 * @module api/toast-order-detail
 * @description Endpoint de consulta en tiempo real del detalle completo de una orden/ticket de Toast POS para auditoría forense.
 * @businessRules
 *   - Resuelve el detalle de selecciones (items), precios de menú, descuentos por platillo, descuentos por cheque y pagos aplicados.
 *   - Mapeo dinámico de Dining Options mediante getDiningOptionsMap para traducir GUIDs de canal de venta.
 * @dataFlow Client (AuditoriaDescuentos) -> /api/toast-order-detail?guid=...&storeId=... -> Toast POS API /orders/{guid} -> Client Modal
 * @notes Utiliza getAuthToken() centralizado para reutilizar tokens en memoria y caché.
 */

import { NextResponse } from 'next/server'
import { getAuthToken } from '@/lib/toast-api'

const TOAST_API_HOST = process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com'

export const dynamic = 'force-dynamic'

async function getDiningOptionsMap(token: string, storeId: string): Promise<Record<string, string>> {
    try {
        const url = new URL(`${TOAST_API_HOST}/config/v2/diningOptions`)
        const res = await fetch(url.toString(), {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Toast-Restaurant-External-ID': storeId
            }
        })
        if (!res.ok) return {}
        const data = await res.json()
        const map: Record<string, string> = {}
        if (Array.isArray(data)) {
            data.forEach((opt: any) => {
                if (opt.guid && opt.name) map[opt.guid] = opt.name
            })
        }
        return map
    } catch (e) {
        return {}
    }
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
        
        const res = await fetch(url.toString(), {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Toast-Restaurant-External-ID': storeId!
            }
        })

        if (!res.ok) {
            const err = await res.text()
            return NextResponse.json({ error: `Toast Error: ${res.status} ${err}` }, { status: res.status })
        }

        const data = await res.json()
        
        // Resolver el nombre del Dining Option dinámicamente
        if (data.diningOption) {
            const map = await getDiningOptionsMap(token, storeId!)
            const optId = data.diningOption.guid || data.diningOption.id
            if (optId && map[optId]) {
                data.diningOption.name = map[optId]
            }
        }

        return NextResponse.json({ order: data })

    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
