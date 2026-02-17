
import dotenv from 'dotenv'
import path from 'path'

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const TOAST_API_HOST = process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com'
const TOAST_CLIENT_ID = process.env.TOAST_CLIENT_ID
const TOAST_CLIENT_SECRET = process.env.TOAST_CLIENT_SECRET

async function getAuthToken() {
    const res = await fetch(`${TOAST_API_HOST}/authentication/v1/authentication/login`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            clientId: TOAST_CLIENT_ID,
            clientSecret: TOAST_CLIENT_SECRET,
            userAccessType: 'TOAST_MACHINE_CLIENT'
        })
    })

    if (!res.ok) {
        const err = await res.text()
        throw new Error(`Auth Failed: ${res.status} ${err}`)
    }

    const data: any = await res.json()
    return data.token.accessToken
}

async function debugStore() {
    try {
        console.log('Fetching Token...')
        const token = await getAuthToken()
        console.log('Got Token! Fetching Restaurants...')

        const res = await fetch(`${TOAST_API_HOST}/partners/v1/restaurants`, {
            headers: { 'Authorization': `Bearer ${token}` }
        })

        const raw: any = await res.json()
        const list = Array.isArray(raw) ? raw : (raw.restaurants || [])

        // Find Santa Ana by GUID
        const santaAna = list.find((s: any) =>
            s.restaurantGuid === '3c2d8251-c43c-43b8-8306-387e0a4ed7c2' ||
            s.guid === '3c2d8251-c43c-43b8-8306-387e0a4ed7c2'
        )

        if (santaAna) {
            console.log('✅ Found Santa Ana GUID:', santaAna.restaurantGuid)

            // Try Configuration Endpoint
            console.log('🕵️‍♂️ Probing Config Endpoint...')
            const configRes = await fetch(`${TOAST_API_HOST}/config/v1/restaurants/${santaAna.restaurantGuid}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            })

            if (configRes.ok) {
                const configData = await configRes.json()
                console.log('🎉 CONFIG DATA:', JSON.stringify(configData, null, 2))
            } else {
                console.log(`❌ Config Endpoint Failed: ${configRes.status}`)
                // Try v2 just in case
                const configRes2 = await fetch(`${TOAST_API_HOST}/config/v2/restaurants/${santaAna.restaurantGuid}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                })
                if (configRes2.ok) {
                    console.log('🎉 CONFIG V2 DATA:', JSON.stringify(await configRes2.json(), null, 2))
                }
            }
        } else {
            console.log('❌ Santa Ana GUID not found in list. Dumping first item:')
            console.log(JSON.stringify(list[0], null, 2))
        }

    } catch (e) {
        console.error(e)
    }
}

debugStore()
