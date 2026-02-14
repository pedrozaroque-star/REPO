import { getAuthToken, } from '../lib/toast-api'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

async function getRestaurantsHelper(token: string) {
    const res = await fetch(`${TOAST_API_HOST}/partners/v1/restaurants`, {
        headers: { 'Authorization': `Bearer ${token}` }
    })
    const data = await res.json()
    // handle array or object wrapper
    const list = Array.isArray(data) ? data : (data.restaurants || [])
    return list.length > 0 ? (list[0].restaurantGuid || list[0].guid) : null
}

const TOAST_API_HOST = process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com'

async function inspectPmix() {
    console.log('--- INSPECTING PMIX (Menu Item Sales) ---')
    const token = await getAuthToken()
    if (!token) { console.error('No Auth Token'); return }

    // 1. Get a store manually since getRestaurants isn't exported fully or I just want one
    const guid = await getRestaurantsHelper(token)
    if (!guid) { console.error('No Store Found'); return }
    console.log(`Store: ${guid}`)

    // 2. Try fetching PMIX for yesterday
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    const yStr = yesterday.toISOString().split('T')[0]
    const yStrCompact = yStr.replace(/-/g, '')

    console.log(`Fetching for date: ${yStr} (${yStrCompact})`)

    const urls = [
        `${TOAST_API_HOST}/reports/v2/menuItems?businessDate=${yStrCompact}`,
        `${TOAST_API_HOST}/reports/v2/sales/menuItems?businessDate=${yStrCompact}`,
        `${TOAST_API_HOST}/reports/v2/productMix?businessDate=${yStrCompact}`
    ]

    for (const url of urls) {
        console.log(`\nProbando: ${url}`)
        const res = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Toast-Restaurant-External-ID': guid
            }
        })

        if (res.ok) {
            console.log('✅ SUCCESS!')
            const data = await res.json()
            console.log(JSON.stringify(data, null, 2).slice(0, 500) + '...')
            break;
        } else {
            console.log(`❌ FAILED: ${res.status} ${res.statusText}`)
            // console.log(await res.text())
        }
    }
}

inspectPmix()
