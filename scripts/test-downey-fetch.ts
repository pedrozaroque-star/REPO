import dotenv from 'dotenv'

dotenv.config({ path: '.env.local', quiet: true })

const TOAST_API_HOST = process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com'

async function getToastToken(): Promise<string> {
  const res = await fetch(`${TOAST_API_HOST}/authentication/v1/authentication/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientId: process.env.TOAST_CLIENT_ID,
      clientSecret: process.env.TOAST_CLIENT_SECRET,
      userAccessType: 'TOAST_MACHINE_CLIENT',
    }),
  })
  if (!res.ok) throw new Error(`Toast login failed: ${res.status} ${res.statusText}`)
  const data = await res.json()
  return data.token.accessToken as string
}

async function testFetch() {
  const token = await getToastToken()
  const downeyExtId = 'b7f63b01-f089-4ad7-a346-afdb1803dc1a'
  const date = '20260923'
  
  const res = await fetch(`${TOAST_API_HOST}/orders/v2/ordersBulk?businessDate=${date}&pageSize=5&page=1`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Toast-Restaurant-External-ID': downeyExtId,
    },
  })
  console.log('Downey fetch status:', res.status)
  if (res.ok) {
    const orders = await res.json()
    console.log(`Fetched ${orders.length} orders sample. First order checks:`, orders[0]?.checks?.length)
  }
}

testFetch().catch(console.error)
