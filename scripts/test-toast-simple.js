
const TOAST_API_HOST = 'https://ws-api.toasttab.com'
const TOAST_CLIENT_ID = 'MX3ppl7KA8U5xcpQBvx2IbkPJg5q9sIm'
const TOAST_CLIENT_SECRET = 'fKuukR6VYyTBhMSNIGkSRynmsm-K5BiPL_n9BoL9YZf_bV4uDU5o0x3F2nGQ8_n_'

// Minimal fetch polyfill logic if needed for old node, but node 18+ has fetch
async function test() {
    console.log("Testing Connection (JS)...")
    try {
        const res = await fetch(`${TOAST_API_HOST}/authentication/v1/authentication/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                clientId: TOAST_CLIENT_ID,
                clientSecret: TOAST_CLIENT_SECRET,
                userAccessType: 'TOAST_MACHINE_CLIENT'
            })
        })

        console.log(`Login Status: ${res.status}`)
        const text = await res.text()
        console.log(`Response Body: ${text.substring(0, 500)}`)

        if (res.ok) {
            const data = JSON.parse(text)
            const token = data.token.accessToken
            console.log("Token acquired. Fetching restaurants...")

            const rRes = await fetch(`${TOAST_API_HOST}/restaurants/v1/restaurants`, {
                headers: { 'Authorization': `Bearer ${token}` }
            })
            console.log(`Restaurants Status: ${rRes.status}`)
            console.log(`Restaurants Body: ${(await rRes.text()).substring(0, 500)}`)
        }

    } catch (e) {
        console.error("Error:", e)
    }
}
test()
