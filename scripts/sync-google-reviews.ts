
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'
import fs from 'fs'

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY! // Use Service Role for backend ops
const supabase = createClient(supabaseUrl, supabaseKey)

// Google Credentials
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET
const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN

if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
    console.error('❌ Missing Google Credentials in .env.local')
    process.exit(1)
}

async function getAccessToken() {
    console.log('🔄 Refreshing Access Token...')
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
    if (!res.ok) throw new Error(data.error_description || data.error)
    console.log('✅ Access Token Obtained')
    return data.access_token
}

async function listAccounts(token: string) {
    const res = await fetch('https://mybusinessaccountmanagement.googleapis.com/v1/accounts', {
        headers: { Authorization: `Bearer ${token}` }
    })
    const data = await res.json()
    console.log('🔍 DIRECT API RESPONSE (Accounts):', JSON.stringify(data, null, 2))
    return data.accounts || []
}

async function listLocations(token: string, accountName: string) {
    // Note: read_mask is required for v1
    const readMask = 'name,title,storeCode,metadata'
    const res = await fetch(`https://mybusinessbusinessinformation.googleapis.com/v1/${accountName}/locations?readMask=${readMask}`, {
        headers: { Authorization: `Bearer ${token}` }
    })
    const data = await res.json()
    return data.locations || []
}

async function listReviews(token: string, locationName: string) { // locationName looks like "accounts/X/locations/Y"
    // Use v4 for reviews
    // Endpoint: https://mybusinessreviews.googleapis.com/v4/{name=accounts/*/locations/*}/reviews
    const res = await fetch(`https://mybusinessreviews.googleapis.com/v4/${locationName}/reviews?pageSize=20`, {
        headers: { Authorization: `Bearer ${token}` }
    })
    const data = await res.json()
    return data.reviews || []
}

async function main() {
    try {
        const token = await getAccessToken()

        // 1. Get Account (Usually just one)
        const accounts = await listAccounts(token)
        if (accounts.length === 0) {
            console.error('❌ No Google Business Accounts found.')
            return
        }
        const account = accounts[0]
        console.log(`🏢 Found Account: ${account.accountName} (${account.name})`)

        // 2. Get Locations
        const locations = await listLocations(token, account.name)
        console.log(`📍 Found ${locations.length} Locations`)

        // 3. Load Stores from DB to Map
        const { data: stores } = await supabase.from('stores').select('*')
        if (!stores) {
            console.error('❌ No stores in DB')
            return
        }

        // 4. Iterate Locations and Sync Reviews
        for (const loc of locations) {
            const locName = loc.name // "accounts/X/locations/Y"
            const title = loc.title

            console.log(`\n🔎 Processing: ${title} (${locName})`)

            // A. Match Store
            // Try fuzzy match by name or use 'google_place_id' if exists
            // Since we don't have place_id in `loc` response (it's in metadata), checking...
            // Actually `metadata` field has `placeId`.

            const placeId = loc.metadata?.placeId
            let store = stores.find(s => s.google_place_id === placeId)

            if (!store) {
                // Fuzzy match by name
                store = stores.find(s =>
                    s.name.toLowerCase().includes(title.toLowerCase()) ||
                    title.toLowerCase().includes(s.name.toLowerCase())
                )

                if (store) {
                    console.log(`   ✅ Matched to DB Store: ${store.name} (ID: ${store.id})`)
                    // Update Place ID for future exact matches
                    if (placeId) {
                        await supabase.from('stores').update({ google_place_id: placeId }).eq('id', store.id)
                        console.log(`   💾 Linked Google Place ID: ${placeId}`)
                    }
                } else {
                    console.warn(`   ⚠️ Could not match '${title}' to any store in DB. Skipping reviews.`)
                    continue
                }
            } else {
                console.log(`   ✅ Exact Match (Place ID): ${store.name}`)
            }

            // B. Fetch Reviews
            const reviews = await listReviews(token, locName)
            console.log(`   📝 Found ${reviews.length} reviews`)

            // C. Insert into DB
            for (const r of reviews) {
                const formattedReview = {
                    store_id: store.id,
                    source: 'google',
                    external_id: r.reviewId,
                    rating: r.starRating ? parseFloat(r.starRating) : 0,
                    comment: r.comment || '',
                    author_url: r.reviewer?.profilePhotoUrl || '',
                    customer_name: r.reviewer?.displayName || 'Anónimo',
                    // Google createTime is ISO
                    submission_date: r.createTime,
                    // If it has a reply
                    admin_review_status: r.reviewReply ? 'cerrado' : 'pendiente',
                    reviewer_phone: '', // Google doesn't share this
                    status: 'new' // Internal status
                }

                // Upsert
                const { error } = await supabase
                    .from('customer_feedback')
                    .upsert(formattedReview, { onConflict: 'external_id' })

                if (error) console.error('   ❌ Error upserting review:', error.message)
            }
            console.log('   ✅ Synced.')
        }

    } catch (e: any) {
        console.error('CRITICAL ERROR:', e.message)
        if (e.response) {
            console.error('Response:', await e.response.text())
        }
    }
}

main()
