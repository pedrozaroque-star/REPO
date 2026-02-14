import { getAuthToken } from '../lib/toast-api'

const TOAST_API_HOST = process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com'

async function inspectModifierPricing() {
    const storeId = '80a1ec95-bc73-402e-8884-e5abbe9343e6' // Lynwood
    const date = '20260212'
    const token = await getAuthToken()

    const url = `${TOAST_API_HOST}/orders/v2/ordersBulk?businessDate=${date}&pageSize=10`
    const res = await fetch(url, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Toast-Restaurant-External-ID': storeId
        }
    })

    const orders = await res.json()

    // Find an order with modifiers that have a price > 0
    for (const order of orders) {
        for (const check of order.checks || []) {
            for (const sel of check.selections || []) {
                const mods = sel.modifiers || []
                const paidMods = mods.filter((m: any) => Number(m.price) > 0)

                if (paidMods.length > 0) {
                    console.log('--- Found Item with Paid Modifiers ---')
                    console.log(`Item: ${sel.displayName}`)
                    console.log(`Item Price (sel.price): ${sel.price}`)
                    console.log(`Item Tax: ${sel.tax}`)

                    console.log('Modifiers:')
                    let modsTotal = 0
                    paidMods.forEach((m: any) => {
                        console.log(` - ${m.displayName}: ${m.price}`)
                        modsTotal += Number(m.price)
                    })

                    console.log(`Sum of Modifier Prices: ${modsTotal}`)
                    console.log(`Parent Price - Mod Total = ${Number(sel.price) - modsTotal}`)
                    return // Found one, exit
                }
            }
        }
    }
    console.log("No items with paid modifiers found in first 10 orders.")
}

inspectModifierPricing()
