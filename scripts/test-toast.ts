
// Scripts/test-toast.ts
// Direct test of Toast API connectivity

// DUPLICATE CONFIG to ensure standalone execution works even if imports are tricky
const TOAST_API_HOST = 'https://ws-api.toasttab.com'
const TOAST_CLIENT_ID = 'MX3ppl7KA8U5xcpQBvx2IbkPJg5q9sIm'
const TOAST_CLIENT_SECRET = 'fKuukR6VYyTBhMSNIGkSRynmsm-K5BiPL_n9BoL9YZf_bV4uDU5o0x3F2nGQ8_n_'

async function testConnection() {
    console.log("----------------------------------------")
    console.log("Testing Toast API Connection...")
    console.log(`Host: ${TOAST_API_HOST}`)
    console.log(`Client ID: ${TOAST_CLIENT_ID.substring(0, 5)}...`)

    try {
        // 1. AUTH
        console.log("\n1. Attempting Login...")
        const loginRes = await fetch(`${TOAST_API_HOST}/authentication/v1/authentication/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                clientId: TOAST_CLIENT_ID,
                clientSecret: TOAST_CLIENT_SECRET,
                userAccessType: 'TOAST_MACHINE_CLIENT'
            })
        })

        if (!loginRes.ok) {
            const text = await loginRes.text()
            throw new Error(`Login Failed: ${loginRes.status} ${loginRes.statusText} - ${text}`)
        }

        const loginData = await loginRes.json()
        const token = loginData.token.accessToken
        console.log("✅ Login Successful! Token received.")

        // 2. GET RESTAURANTS
        console.log("\n2. Fetching Restaurants (v1)...")
        const restRes = await fetch(`${TOAST_API_HOST}/restaurants/v1/restaurants`, {
            headers: { 'Authorization': `Bearer ${token}` }
        })

        if (!restRes.ok) {
            const text = await restRes.text()
            throw new Error(`Fetch Restaurants Failed: ${restRes.status} ${text}`)
        }

        const restaurants = await restRes.json()
        console.log(`✅ Success! Found ${restaurants.length} restaurants.`)

        if (restaurants.length > 0) {
            console.log("First 3 restaurants:")
            restaurants.slice(0, 3).forEach((r: any) => console.log(` - [${r.guid}] ${r.name}`))
        } else {
            console.log("⚠️ No restaurants returned. Check User Access Scope.")
        }

    } catch (error: any) {
        console.error("\n❌ ERROR DETAILS:")
        console.error(error.message)
        if (error.cause) console.error("Cause:", error.cause)
    }
    console.log("----------------------------------------")
}

testConnection()
