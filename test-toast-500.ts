import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const TOAST_API_HOST = process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com'
const TOAST_CLIENT_ID = process.env.TOAST_CLIENT_ID
const TOAST_CLIENT_SECRET = process.env.TOAST_CLIENT_SECRET

async function getAuthToken() {
    const res = await fetch(`${TOAST_API_HOST}/authentication/v1/authentication/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            clientId: TOAST_CLIENT_ID,
            clientSecret: TOAST_CLIENT_SECRET,
            userAccessType: 'TOAST_MACHINE_CLIENT'
        })
    })

    if (!res.ok) throw new Error(`Toast Auth Failed: ${res.status}`)
    const data = await res.json()
    return data.token.accessToken
}

async function testOrdersBulk() {
    try {
        const token = await getAuthToken()
        const storeId = '47256ade-2cd4-4073-9632-84567ad9e2c8' // Huntington Park

        // Format to YYYYMMDD
        const now = new Date()
        if (now.getHours() < 6) now.setDate(now.getDate() - 1)
        
        const y = now.getFullYear()
        const m = String(now.getMonth() + 1).padStart(2, '0')
        const d = String(now.getDate()).padStart(2, '0')
        const formattedDate = `${y}${m}${d}`

        console.log(`Fetching ordersBulk para Huntington Park, fecha: ${formattedDate}`)

        // Fields de "FULL PRECISION MODE" en lib/toast-api.ts
        const fields = [
            'diningOption', 'voided', 'openedDate', 'numberOfGuests',
            'checks.voided', 'checks.amount', 'checks.taxAmount',
            'checks.appliedDiscounts', 'checks.appliedServiceCharges',
            'checks.payments.tipAmount', 'checks.payments.amount',
            'checks.payments.displayName', 'checks.payments.paymentInstrument',
            'checks.payments.type', 'checks.payments.otherPayment',
            'checks.payments.refundStatus', 'checks.payments.refundAmount',
            'checks.selections.price', 'checks.selections.preDiscountPrice',
            'checks.selections.quantity', 'checks.selections.tax',
            'checks.selections.taxInclusion', 'checks.selections.displayName',
            'checks.selections.voided', 'checks.selections.deferred',
            'checks.selections.refundDetails', 'checks.selections.toastGiftCard',
            'checks.serviceCharges', 'serviceCharges', 'source', 'deliveryService'
        ].join(',')

        const url = new URL(`${TOAST_API_HOST}/orders/v2/ordersBulk`)
        url.searchParams.append('businessDate', formattedDate)
        url.searchParams.append('pageSize', '100')
        url.searchParams.append('page', '1')
        url.searchParams.append('fields', fields)

        const res = await fetch(url.toString(), {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Toast-Restaurant-External-ID': storeId
            }
        })

        if (!res.ok) {
            const errTxt = await res.text()
            console.error(`🚨 Error HTTP ${res.status}: ${errTxt}`)
            console.log("\nProcesando diagnóstico... Vamos a intentar con 'fastMode' fields para ver si es un problema de JSON demasiado pesado.")
            
            const fastFields = [
                'openedDate', 'voided', 'numberOfGuests', 'closedDate', 'duration',
                'checks.voided', 'checks.amount', 'checks.taxAmount',
                'checks.payments.tipAmount', 'checks.payments.amount',
                'checks.appliedDiscounts'
            ].join(',')

            const urlFast = new URL(`${TOAST_API_HOST}/orders/v2/ordersBulk`)
            urlFast.searchParams.append('businessDate', formattedDate)
            urlFast.searchParams.append('pageSize', '100')
            urlFast.searchParams.append('page', '1')
            urlFast.searchParams.append('fields', fastFields)

            const resFast = await fetch(urlFast.toString(), {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Toast-Restaurant-External-ID': storeId
                }
            })

            if (resFast.ok) {
                console.log("✅ Con Fast Mode la respuesta es exitosa. El problema es uno de los campos en Full Precision Mode.")
            } else {
                console.log(`❌ Con Fast Mode también falla: HTTP ${resFast.status}`)
            }

        } else {
            console.log(`✅ Success! Status: ${res.status}`)
            const data = await res.json()
            console.log(`Recibidos ${Array.isArray(data) ? data.length : 'unknown'} orders en la primera página.`)
        }
    } catch (e) {
        console.error("Error ejecutando test:", e)
    }
}

testOrdersBulk()
