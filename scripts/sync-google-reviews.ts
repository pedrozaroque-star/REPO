
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
const MAPS_KEY = process.env.GOOGLE_MAPS_KEY?.trim()

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('❌ Missing SUPABASE credentials in .env.local')
    process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET
const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN

const TARGET_FILTER = process.argv[2]?.toUpperCase() || null

async function getAccessToken() {
    console.log('🔄 Refreshing Access Token...')
    try {
        const res = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: CLIENT_ID!,
                client_secret: CLIENT_SECRET!,
                refresh_token: REFRESH_TOKEN!,
                grant_type: 'refresh_token',
            })
        })

        const data = await res.json()
        if (!res.ok) throw new Error(data.error_description || JSON.stringify(data))
        return data.access_token
    } catch (error: any) {
        console.error('   💀 FATAL AUTH ERROR:', error.message)
        process.exit(1)
    }
}

async function listAccounts(token: string) {
    const res = await fetch('https://mybusinessaccountmanagement.googleapis.com/v1/accounts', {
        headers: { Authorization: `Bearer ${token}` }
    })
    const data = await res.json()
    return data.accounts || []
}

async function listLocations(token: string, accountName: string) {
    const readMask = 'name,title,storeCode,metadata,storefrontAddress'
    let allLocations: any[] = []
    let pageToken: string | null = null

    do {
        const url: string = `https://mybusinessbusinessinformation.googleapis.com/v1/${accountName}/locations?readMask=${readMask}&pageSize=100${pageToken ? `&pageToken=${pageToken}` : ''}`
        const res: any = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
        const data: any = await res.json()

        if (data.locations) {
            allLocations = allLocations.concat(data.locations)
        }
        pageToken = data.nextPageToken || null
    } while (pageToken)

    return allLocations
}

async function listReviews(token: string, locationName: string, accountName: string) {
    // BUSINESS API v4
    let resourceName = locationName
    if (!resourceName.startsWith('accounts/')) {
        resourceName = `${accountName}/${locationName}`
    }
    const cleanResource = resourceName.replace(/\s/g, '')

    // Probe Endpoint
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

    if (!workingBaseUrl) return []

    // DOWNLOAD LOOP (All History - 15 Years)
    const CUTOFF_DATE = new Date()
    CUTOFF_DATE.setFullYear(CUTOFF_DATE.getFullYear() - 15) // Approx 2010
    console.log(`   📅 Fetching history until: ${CUTOFF_DATE.toISOString().split('T')[0]}`)

    let allReviews: any[] = []
    let pageToken: string | null = null
    let keepFetching = true
    let pageCount = 0

    do {
        const urlWithPage: string = `${workingBaseUrl}?pageSize=50${pageToken ? `&pageToken=${pageToken}` : ''}`

        const res = await fetch(urlWithPage, { headers: { Authorization: `Bearer ${token}` } })
        if (!res.ok) break

        const data = await res.json()
        const pageReviews = data.reviews || []

        if (pageReviews.length === 0) break

        // Filter & Check Dates
        for (const r of pageReviews) {
            const reviewDate = new Date(r.createTime)
            if (reviewDate >= CUTOFF_DATE) {
                allReviews.push(r)
            } else {
                // Found an old review, stop fetching deeper
                keepFetching = false
            }
        }

        // Log progress every 5 pages
        if (pageCount % 5 === 0) process.stdout.write('.')

        // If we processed reviews but stopped, break
        if (!keepFetching) break

        pageToken = data.nextPageToken || null
        pageCount++

        if (pageCount > 2000) { // Safety limit (100,000 reviews per store max)
            console.warn('   ⚠️ Reached 100k reviews limit. Stopping.')
            break
        }

    } while (pageToken && keepFetching)
    console.log('') // Newline after dots

    return allReviews
}


async function main() {
    console.log('🚀 Starting Google Reviews History Sync...')
    if (TARGET_FILTER) console.log(`🎯 FILTER ACTIVE: "${TARGET_FILTER}"`)

    try {
        const token = await getAccessToken()

        const accounts = await listAccounts(token)
        if (accounts.length === 0) return
        const account = accounts[0]

        const locations = await listLocations(token, account.name)
        console.log(`📍 Found ${locations.length} Google Locations`)

        // Load Stores
        const { data: stores, error } = await supabase.from('stores').select('*')
        if (error || !stores) { console.error('❌ Supabase Error'); return }

        let successCount = 0

        for (const loc of locations) {
            const locName = loc.name

            const lines = loc.storefrontAddress?.addressLines || []
            const city = loc.storefrontAddress?.locality || ''
            const fullAddress = `${lines.join(' ')} ${city}`.toUpperCase()

            if (TARGET_FILTER && !fullAddress.includes(TARGET_FILTER)) continue

            console.log(`\n🔎 Processing: ${fullAddress}`)

            // STRICT MATCHING
            const placeId = loc.metadata?.placeId
            let store = stores.find(s => s.google_place_id === placeId)

            if (!store) {
                const cityClean = city.toUpperCase().trim()
                const candidates = stores.filter(s => s.city && s.city.toUpperCase().trim() === cityClean)

                const normalize = (a: string) => a.toUpperCase()
                    .replace(/[^A-Z0-9]/g, '')
                    .replace(/STREET/g, 'ST')
                    .replace(/AVENUE/g, 'AVE')
                    .replace(/BOULEVARD/g, 'BLVD')
                    .replace(/SOUTH/g, 'S')
                    .replace(/NORTH/g, 'N')
                    .replace(/EAST/g, 'E')
                    .replace(/WEST/g, 'W')

                const gNorm = normalize(fullAddress)

                if (candidates.length === 1) {
                    store = candidates[0]
                } else if (candidates.length > 1) {
                    store = candidates.find(s => s.address && gNorm.includes(normalize(s.address)))
                }

                // Global fallback by address (if city mismatched)
                if (!store) {
                    store = stores.find(s => s.address && gNorm.includes(normalize(s.address)))
                }

                // Global fallback by TITLE (Google Title vs DB Store Name)
                if (!store && loc.title) {
                    const gTitle = loc.title.toUpperCase()
                    store = stores.find(s => {
                        const sName = s.name.toUpperCase().replace('LA ', '').trim()
                        return gTitle.includes(sName) || fullAddress.includes(sName)
                    })
                }
            }

            if (!store) {
                console.warn(`   ⚠️ SKIPPED: No match for "${loc.title || city}" (Address: ${fullAddress})`)
                continue
            }

            console.log(`   ✅ MATCHED: ${store.name} (ID: ${store.id})`)

            if (placeId && store.google_place_id !== placeId) {
                await supabase.from('stores').update({ google_place_id: placeId }).eq('id', store.id)
            }

            // SYNC HISTORY
            const reviews = await listReviews(token, locName, account.name)

            if (reviews.length === 0) {
                console.log('   📝 No se encontraron reseñas en Google para esta sucursal.')
                continue
            }

            // OBTENER RESEÑAS YA EXISTENTES
            const { data: existingData } = await supabase
                .from('customer_feedback')
                .select('external_id')
                .eq('store_id', store.id)
                .eq('source', 'google')

            const existingIds = new Set(existingData?.map(r => r.external_id) || [])
            const newReviews = reviews.filter(r => !existingIds.has(r.reviewId))

            console.log(`   📝 Encontradas: ${reviews.length} totales. Omitiendo: ${reviews.length - newReviews.length} ya existentes.`)
            console.log(`   ✨ Guardando ${newReviews.length} reseñas nuevas...`)

            if (newReviews.length === 0) continue

            // Upsert (Batch 100)
            const STAR_MAP: any = { 'ONE': 1, 'TWO': 2, 'THREE': 3, 'FOUR': 4, 'FIVE': 5 }

            const batchSize = 100
            for (let i = 0; i < newReviews.length; i += batchSize) {
                const chunk = newReviews.slice(i, i + batchSize)
                // Construct a helpful link (Deep link to specific review is hard without public ID)
                // Fallback: Link to the Store's Reviews List
                const mapsLink = store.google_place_id
                    ? `https://search.google.com/local/reviews?placeid=${store.google_place_id}`
                    : '';

                const rows = chunk.map((r: any) => ({
                    store_id: store!.id,
                    source: 'google',
                    external_id: r.reviewId,
                    rating: STAR_MAP[r.starRating] || 0,
                    comments: r.comment || '',
                    customer_name: r.reviewer?.displayName || 'Anónimo',
                    author_url: r.reviewer?.profilePhotoUrl || '',
                    original_url: mapsLink, // <--- SAVED HERE
                    submission_date: r.createTime,
                    photo_urls: []
                }))

                const { error: upsertError } = await supabase.from('customer_feedback').upsert(rows, { onConflict: 'external_id' })
                if (upsertError) console.error('   ❌ DB Error:', upsertError.message)
            }
            console.log(`   ✨ Saved history.`)
            successCount++
        }

        console.log(`\n🎉 DONE! Processed ${successCount} stores.`)

    } catch (e: any) {
        console.error('ERROR:', e.message)
    }
}

main()
