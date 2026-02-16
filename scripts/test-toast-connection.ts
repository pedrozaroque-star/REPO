
import { getAuthToken } from '../lib/toast-api'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

async function testConnection() {
    console.log('Testing Toast Connection...')
    try {
        const token = await getAuthToken()
        console.log(`✅ Token received: ${token ? 'YES (Length: ' + token.length + ')' : 'NO'}`)

        // Now try to get restaurants
        if (token) {
            const res = await fetch('https://ws-api.toasttab.com/partners/v1/restaurants', {
                headers: { 'Authorization': `Bearer ${token}` }
            })
            if (res.ok) {
                const data = await res.json()
                console.log(`✅ Restaurants found: ${data.length}`)
                data.forEach((r: any) => console.log(` - ${r.restaurantName} (${r.restaurantGuid})`))
            } else {
                console.error(`❌ Failed to fetch restaurants: ${res.status} ${res.statusText}`)
                const txt = await res.text()
                console.error(txt)
            }
        }

    } catch (e: any) {
        console.error('❌ Connection Failed:', e.message)
        if (e.response) {
            console.error('Response:', await e.response.text())
        }
    }
}

testConnection()
