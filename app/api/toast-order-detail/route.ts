import { NextResponse } from 'next/server'
import { getAuthToken } from '@/lib/toast-api'

const TOAST_API_HOST = process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url)
        const orderGuid = searchParams.get('guid')
        const storeId = searchParams.get('storeId') || process.env.TOAST_RESTAURANT_ID

        if (!orderGuid) {
            return NextResponse.json({ error: 'Falta orderGuid' }, { status: 400 })
        }

        const token = await getAuthToken()

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
        return NextResponse.json({ order: data })

    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
