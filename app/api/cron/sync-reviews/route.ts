
import { NextResponse } from 'next/server'
import { getSupabaseClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const maxDuration = 300 // 5 minutes max

// --- CONFIG ---
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET
const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN

// --- HELPERS ---

async function getAccessToken() {
    if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
        throw new Error('Missing Google Credentials')
    }

    const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            refresh_token: REFRESH_TOKEN,
            grant_type: 'refresh_token',
        })
    })

    const data = await res.json()
    if (!res.ok) throw new Error(data.error_description || JSON.stringify(data))
    return data.access_token
}

async function listAccounts(token: string) {
    const res = await fetch('https://mybusinessaccountmanagement.googleapis.com/v1/accounts', {
        headers: { Authorization: `Bearer ${token}` }
    })
    const data = await res.json()
    return data.accounts || []
}

async function listLocations(token: string, accountName: string) {
    // Critical: Get Address for strict matching
    const readMask = 'name,title,storeCode,metadata,storefrontAddress'
    const res = await fetch(`https://mybusinessbusinessinformation.googleapis.com/v1/${accountName}/locations?readMask=${readMask}`, {
        headers: { Authorization: `Bearer ${token}` }
    })
    const data = await res.json()
    return data.locations || []
}

async function listReviews(token: string, locationName: string, accountName: string) {
    // 1. Construct Resource Name
    let resourceName = locationName
    if (!resourceName.startsWith('accounts/')) {
        resourceName = `${accountName}/${locationName}`
    }
    const cleanResource = resourceName.replace(/\s/g, '')

    // 2. Probe Endpoint (Business API v4)
    const candidates = [
        `https://mybusinessreviews.googleapis.com/v4/${cleanResource}/reviews`,
        `https://mybusiness.googleapis.com/v4/${cleanResource}/reviews`
    ]

    let workingBaseUrl = ''
    for (const url of candidates) {
        try {
            const probe = await fetch(`${url}?pageSize=1`, { headers: { Authorization: `Bearer ${token}` } })
            if (probe.ok) {
                workingBaseUrl = url
                break
            }
        } catch (e) { }
    }

    if (!workingBaseUrl) return [] // Fail silently per location

    // 3. Paginator Loop (Limit to 100 recent for daily sync)
    let allReviews: any[] = []
    let pageToken: string | null = null
    let pageCount = 0

    do {
        const urlWithPage: string = `${workingBaseUrl}?pageSize=50${pageToken ? `&pageToken=${pageToken}` : ''}`
        const res = await fetch(urlWithPage, { headers: { Authorization: `Bearer ${token}` } })

        if (!res.ok) break

        const data = await res.json()
        if (data.reviews && Array.isArray(data.reviews)) {
            allReviews = allReviews.concat(data.reviews)
        }

        pageToken = data.nextPageToken || null
        pageCount++

        if (pageCount >= 4) break // Cap at 200 reviews per day to be safe

    } while (pageToken)

    return allReviews
}

// --- MAIN ROUTE ---

interface Store {
    id: string
    name: string
    address: string
    city: string
    external_id?: string
    google_place_id?: string
}

export async function GET(request: Request) {
    console.log('[CRON] Starting Strict Google Reviews Sync...')

    if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
        // If creds are missing, we don't crash, just skip.
        console.error('[CRON] Missing Google Params')
        return NextResponse.json({ error: 'Missing Credentials' }, { status: 500 })
    }

    try {
        const supabase = await getSupabaseClient()
        const token = await getAccessToken()
        const accounts = await listAccounts(token)
        if (!accounts || accounts.length === 0) return NextResponse.json({ message: 'No accounts' })

        const account = accounts[0]
        const locations = await listLocations(token, account.name)

        // Get DB Stores with City info
        const { data: storesRaw } = await supabase.from('stores').select('*')
        if (!storesRaw) return NextResponse.json({ error: 'No DB Stores' })

        // Cast to typed array to avoid TS errors
        const stores = storesRaw as unknown as Store[]

        let totalSynced = 0
        const logs: string[] = []

        for (const loc of locations) {
            const locName = loc.name
            // Strict Address Matching
            const lines = loc.storefrontAddress?.addressLines || []
            const city = loc.storefrontAddress?.locality || ''
            const fullAddress = `${lines.join(' ')} ${city}`.toUpperCase()

            // 1. Try Match by Google Place ID (Most Reliable if already linked)
            const placeId = loc.metadata?.placeId
            let store = stores.find((s: Store) => s.google_place_id === placeId)

            // 2. Try Match by City Name (Strict)
            if (!store) {
                // Format: "LYNWOOD"
                const cityClean = city.toUpperCase().trim()

                // Find stores in that city
                const candidates = stores.filter((s: Store) => s.city && s.city.toUpperCase().trim() === cityClean)

                if (candidates.length === 1) {
                    store = candidates[0]
                    if (placeId) {
                        // Auto-link for next time
                        await supabase.from('stores').update({ google_place_id: placeId }).eq('id', store.id)
                    }
                } else if (candidates.length > 1) {
                    // Multiple stores in same city (e.g. Los Angeles)
                    // Fallback to Address matching
                    store = candidates.find((s: Store) => fullAddress.includes(s.address.toUpperCase()))
                }
            }

            if (!store) {
                logs.push(`⚠️ SKIPPED: ${fullAddress} (No clear match in DB)`)
                continue
            }

            logs.push(`✅ MATCH: ${store.name} <-> ${fullAddress}`)

            // Sync Reviews
            const reviews = await listReviews(token, locName, account.name)

            // Upsert
            let upsertCount = 0
            const STAR_MAP: any = { 'ONE': 1, 'TWO': 2, 'THREE': 3, 'FOUR': 4, 'FIVE': 5 }

            if (reviews.length > 0) {
                const rows = reviews.map((r: any) => ({
                    store_id: store!.id,
                    source: 'google',
                    external_id: r.reviewId,
                    rating: STAR_MAP[r.starRating] || 0,
                    comments: r.comment || '',
                    customer_name: r.reviewer?.displayName || 'Anónimo',
                    author_url: r.reviewer?.profilePhotoUrl || '',
                    submission_date: r.createTime,
                    photo_urls: []
                }))

                const { error } = await supabase.from('customer_feedback')
                    .upsert(rows, { onConflict: 'external_id' })

                if (!error) upsertCount = rows.length
                else logs.push(`   ❌ DB Error for ${store.name}: ${error.message}`)
            }

            totalSynced += upsertCount
        }

        return NextResponse.json({ success: true, total: totalSynced, logs })

    } catch (e: any) {
        console.error('[CRON] Reviews Error:', e)
        return NextResponse.json({ error: e.message }, { status: 500 })
    }
}
