import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const TOAST_API_HOST = process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com'
const TOAST_CLIENT_ID = process.env.TOAST_CLIENT_ID || ''
const TOAST_CLIENT_SECRET = process.env.TOAST_CLIENT_SECRET || ''

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const TOAST_GUID_MAP: Record<string, string> = {
    "a83901db-2431-4283-834e-9502a2ba4b3b": "Bell",
    "9625621e-1b5e-48d7-87ae-7094fab5a4fd": "Slauson"
}

export async function GET() {
    try {
        const { data: employees } = await supabase.from('toast_employees').select('toast_guid, first_name, last_name, chosen_name')
        
        const authRes = await fetch(`${TOAST_API_HOST}/authentication/v1/authentication/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                clientId: TOAST_CLIENT_ID,
                clientSecret: TOAST_CLIENT_SECRET,
                userAccessType: 'TOAST_MACHINE_CLIENT'
            })
        })
        const token = (await authRes.json()).token.accessToken

        const storeId = "a83901db-2431-4283-834e-9502a2ba4b3b" // Bell
        let page = 1;
        let hasMore = true;
        let discountKeys = new Set<string>();
        let randomDiscountDump: any = null;
        
        while(hasMore && page <= 5) {
            const url = new URL(`${TOAST_API_HOST}/orders/v2/ordersBulk`)
            url.searchParams.append('businessDate', '20260420')
            url.searchParams.append('pageSize', '20')
            url.searchParams.append('page', String(page))

            const res = await fetch(url.toString(), {
                headers: { 'Authorization': `Bearer ${token}`, 'Toast-Restaurant-External-ID': storeId }
            })
            const orders = await res.json()
            if (!Array.isArray(orders) || orders.length === 0) {
                hasMore = false; break;
            }

            orders.forEach(order => {
                order.checks?.forEach((check: any) => {
                    check.appliedDiscounts?.forEach((d: any) => {
                        Object.keys(d).forEach(k => discountKeys.add(k));
                        if (!randomDiscountDump) randomDiscountDump = d;
                    })
                    check.selections?.forEach((sel: any) => {
                        sel.appliedDiscounts?.forEach((d: any) => {
                            Object.keys(d).forEach(k => discountKeys.add(k));
                            if (!randomDiscountDump) randomDiscountDump = d;
                        })
                    })
                })
            })
            if (orders.length < 20) hasMore = false;
            page++;
        }

        return NextResponse.json({
            keys: Array.from(discountKeys),
            sample: randomDiscountDump
        })
    } catch (e: any) {
        return NextResponse.json({ error: e.message })
    }
}
