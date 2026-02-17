import { NextRequest, NextResponse } from 'next/server'
import { verifyAuthToken } from '@/lib/auth-server'
import { supabaseAdmin } from '@/lib/supabase'
import { getAuthToken } from '@/lib/toast-api'

export const dynamic = 'force-dynamic' // No caching

// MASTER MAPPING: Toast GUID -> Clean DB Name
const GUID_TO_CLEAN_NAME: Record<string, string> = {
    "acf15327-54c8-4da4-8d0d-3ac0544dc422": "Rialto",
    "e0345b1f-d6d6-40b2-bd06-5f9f4fd944e8": "Azusa",
    "42ed15a6-106b-466a-9076-1e8f72451f6b": "Norwalk",
    "b7f63b01-f089-4ad7-a346-afdb1803dc1a": "Downey",
    "475bc112-187d-4b9c-884d-1f6a041698ce": "LA Broadway",
    "a83901db-2431-4283-834e-9502a2ba4b3b": "Bell",
    "5fbb58f5-283c-4ea4-9415-04100ee6978b": "Hollywood",
    "47256ade-2cd4-4073-9632-84567ad9e2c8": "Huntington Park",
    "8685e942-3f07-403a-afb6-faec697cd2cb": "LA Central",
    "3a803939-eb13-4def-a1a4-462df8e90623": "La Puente",
    "80a1ec95-bc73-402e-8884-e5abbe9343e6": "Lynwood",
    "3c2d8251-c43c-43b8-8306-387e0a4ed7c2": "Santa Ana",
    "9625621e-1b5e-48d7-87ae-7094fab5a4fd": "Slauson",
    "95866cfc-eeb8-4af9-9586-f78931e1ea04": "South Gate",
    "5f4a006e-9a6e-4bcf-b5bd-7f5e9d801a02": "West Covina"
}

// FALLBACK ADDRESS MAP (If Toast fails)
const FALLBACK_ADDRESSES: Record<string, any> = {
    "Rialto": { address: "240 W Baseline Rd", city: "Rialto", state: "CA", zip: "92376", phone: "(909) 873-9888" },
    "Azusa": { address: "122 N Azusa Ave", city: "Azusa", state: "CA", zip: "91702", phone: "(626) 334-3100" },
    "Santa Ana": { address: "801 W 17th St", city: "Santa Ana", state: "CA", zip: "92706", phone: "(714) 543-3000" },
    "West Covina": { address: "2330 S Azusa Ave", city: "West Covina", state: "CA", zip: "91792", phone: "(626) 965-0200" },
    "Hollywood": { address: "7083 Sunset Blvd", city: "Los Angeles", state: "CA", zip: "90028", phone: "(323) 465-0300" },
    "LA Broadway": { address: "4363 S Broadway", city: "Los Angeles", state: "CA", zip: "90037", phone: "(323) 232-0500" },
    "Slauson": { address: "200 W Slauson Ave", city: "Los Angeles", state: "CA", zip: "90003", phone: "(323) 234-0100" },
    "LA Central": { address: "4801 S Central Ave", city: "Los Angeles", state: "CA", zip: "90011", phone: "(323) 231-0100" },
    "Huntington Park": { address: "2652 Florence Ave", city: "Huntington Park", state: "CA", zip: "90255", phone: "(323) 585-0200" },
    "South Gate": { address: "8940 Garfield Ave", city: "South Gate", state: "CA", zip: "90280", phone: "(562) 927-0400" },
    "Downey": { address: "12051 Paramount Blvd", city: "Downey", state: "CA", zip: "90242", phone: "(562) 869-0400" },
    "Lynwood": { address: "3740 E Imperial Hwy", city: "Lynwood", state: "CA", zip: "90262", phone: "(310) 639-0200" },
    "Norwalk": { address: "12539 Rosecrans Ave", city: "Norwalk", state: "CA", zip: "90650", phone: "(562) 864-0100" },
    "La Puente": { address: "15225 Valley Blvd", city: "City of Industry", state: "CA", zip: "91746", phone: "(626) 333-0100" },
    "Bell": { address: "4370 Gage Ave", city: "Bell", state: "CA", zip: "90201", phone: "(323) 773-0300" }
}

export async function POST(request: NextRequest) {
    try {
        const authHeader = request.headers.get('Authorization')
        if (!authHeader) return NextResponse.json({ error: 'Missing Authorization' }, { status: 401 })

        const token = authHeader.replace('Bearer ', '')
        const user = verifyAuthToken(token)
        if (!user || user.user_role !== 'admin') return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

        const toastToken = await getAuthToken()
        if (!toastToken) throw new Error('Failed to auth with Toast')

        console.log('🔄 Syncing Deep Details (Master Fallback V4)...')

        const rawRes = await fetch(`${process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com'}/partners/v1/restaurants`, {
            headers: { 'Authorization': `Bearer ${toastToken}` }
        })
        const rawData = await rawRes.json()
        const rawList = Array.isArray(rawData) ? rawData : (rawData.restaurants || [])

        let created = 0
        let updated = 0
        let errors = 0
        const logs: string[] = []

        for (const rawStore of rawList) {
            const toastId = rawStore.restaurantGuid || rawStore.guid || rawStore.id
            const rawName = (rawStore.restaurantName || rawStore.name || 'Unknown Store').trim()

            // 🎯 Determine Clean Name
            let cleanName = GUID_TO_CLEAN_NAME[toastId]
            if (!cleanName) {
                if (rawName.includes(' - ')) cleanName = rawName.split(' - ').pop()?.trim() || rawName
                else if (rawName.includes('(')) cleanName = rawName.match(/\(([^)]+)\)/)?.[1].trim() || rawName
            }

            // ⚠️ FETCH FULL DETAILS (Standard Toast)
            let detail: any = {}
            try {
                // Rate limit guard
                await new Promise(r => setTimeout(r, 100))
                const detailRes = await fetch(`${process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com'}/partners/v1/restaurants/${toastId}`, {
                    headers: { 'Authorization': `Bearer ${toastToken}` }
                })
                if (detailRes.ok) detail = await detailRes.json()
            } catch (e) { }

            // Extract Data (or fallback to empty)
            let addr1 = detail.address?.address1 || detail.address?.street1 || ''
            let city = detail.address?.city || ''
            let state = detail.address?.state || ''
            let zip = detail.address?.zipCode || detail.address?.zip || ''
            let phone = detail.phoneNumber || detail.phone || ''

            // 🚨 MASTER FALLBACK: If Toast gives empty address, use our Map
            if (!addr1 && FALLBACK_ADDRESSES[cleanName]) {
                const fb = FALLBACK_ADDRESSES[cleanName]
                // console.log(`Using Fallback Address for ${cleanName}`)
                addr1 = fb.address
                city = fb.city
                state = fb.state
                zip = fb.zip
                phone = fb.phone // Ensuring phone is populated too
            }

            const lat = detail.latitude || detail.address?.latitude || null
            const lng = detail.longitude || detail.address?.longitude || null

            // Hours Extraction placeholder
            let derivedHours: any[] = []
            let derivedOpen = '09:00'
            let derivedClose = '01:00'
            const schedules = detail.schedules || detail.hours
            const hoursFound = !!schedules

            // DB Operations
            let existing: any = null

            // 1. GUID Match
            const { data: byGuid } = await supabaseAdmin.from('stores').select('*').eq('toast_guid', toastId).maybeSingle()
            if (byGuid) existing = byGuid

            // 2. Name Match
            if (!existing) {
                const { data: byName } = await supabaseAdmin.from('stores').select('*').ilike('name', cleanName).maybeSingle()
                if (byName) existing = byName
            }

            const dbId = existing?.id

            if (dbId) {
                // UPDATE (Safe Mode)
                const updatePayload: any = {
                    toast_guid: toastId,
                    name: cleanName,
                    ...(addr1 ? { address: addr1 } : {}),
                    ...(city ? { city: city } : {}),
                    ...(state ? { state: state } : {}),
                    ...(zip ? { zip: zip } : {}), // Might fail if column missing
                    ...(phone ? { phone: phone } : {}),
                    ...(hoursFound ? { weekly_hours: derivedHours } : {})
                }
                if (lat && lng) { updatePayload.latitude = lat; updatePayload.longitude = lng }

                const { error: updErr } = await supabaseAdmin.from('stores').update(updatePayload).eq('id', dbId)

                if (updErr) {
                    // Safe Fallback (No risky columns)
                    const safePayload: any = {
                        name: cleanName,
                        ...(addr1 ? { address: addr1 } : {}), // Force update valid address
                        ...(city ? { city: city } : {}),
                        ...(state ? { state: state } : {}),
                        ...(phone ? { phone: phone } : {}) // Try phone in safe mode
                    }
                    const { error: retryErr } = await supabaseAdmin.from('stores').update(safePayload).eq('id', dbId)
                    if (retryErr) {
                        // ULTRA SAFE FALLBACK (No Phone)
                        const ultraSafe = { ...safePayload }; delete ultraSafe.phone
                        const { error: finalErr } = await supabaseAdmin.from('stores').update(ultraSafe).eq('id', dbId)
                        if (finalErr) logs.push(`Failed Update: ${cleanName}`)
                        else logs.push(`Updated (Address Only): ${cleanName}`)
                    } else {
                        updated++; logs.push(`Updated (Core): ${cleanName}`)
                    }
                } else {
                    updated++; logs.push(`Updated Full: ${cleanName}`)
                }

            } else {
                // CREATE
                let baseCode = cleanName.substring(0, 3).toUpperCase().replace(/[^A-Z]/g, '')
                if (baseCode.length < 3) baseCode = (cleanName + 'XXX').substring(0, 3).toUpperCase()

                const newStore = {
                    name: cleanName,
                    address: addr1,
                    city: city,
                    state: state,
                    zip: zip,
                    phone: phone,
                    is_active: true,
                    toast_guid: toastId,
                    code: baseCode,
                    latitude: lat,
                    longitude: lng,
                    opening_time: derivedOpen,
                    closing_time: derivedClose
                }
                const { error: insErr } = await supabaseAdmin.from('stores').insert(newStore)
                if (insErr) {
                    // Create Fallback
                    const safePayload: any = { ...newStore }
                    delete safePayload.toast_guid
                    delete safePayload.zip
                    delete safePayload.latitude
                    delete safePayload.longitude
                    delete safePayload.weekly_hours

                    if (insErr.message.includes('stores_code_key')) {
                        safePayload.code = baseCode + Math.floor(Math.random() * 90 + 10)
                    }
                    const { error: retryErr } = await supabaseAdmin.from('stores').insert(safePayload)
                    // If retry fails (maybe phone missing), try Ultra Safe?
                    if (retryErr) {
                        delete safePayload.phone
                        const { error: finalErr } = await supabaseAdmin.from('stores').insert(safePayload)
                        if (finalErr) logs.push(`Failed Create: ${cleanName}`)
                        else logs.push(`Created (Minimal): ${cleanName}`)
                    }
                    else { created++; logs.push(`Created: ${cleanName}`) }
                } else {
                    created++; logs.push(`Created: ${cleanName}`)
                }
            }
        }

        return NextResponse.json({ success: true, updated, created, errors, logs })

    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 })
    }
}
