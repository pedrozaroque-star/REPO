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
  const data = await res.json()
  return data.token.accessToken as string
}

async function testOptions() {
  const token = await getToastToken()
  const stores = [
    { name: 'Downey', extId: 'b7f63b01-f089-4ad7-a346-afdb1803dc1a' },
    { name: 'South Gate', extId: '95866cfc-eeb8-4af9-9586-f78931e1ea04' },
  ]

  for (const s of stores) {
    const res = await fetch(`${TOAST_API_HOST}/config/v2/diningOptions`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Toast-Restaurant-External-ID': s.extId,
      },
    })
    console.log(`${s.name} dining options status:`, res.status)
    if (res.ok) {
      const opts = await res.json()
      console.log(`${s.name} options:`, opts.map((o: any) => `${o.name} (${o.behavior})`))
    }
  }
}

testOptions().catch(console.error)
