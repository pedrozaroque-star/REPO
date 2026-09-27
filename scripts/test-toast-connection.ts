/**
 * @module scripts/test-toast-connection
 * @description Prueba la conectividad con el API de Toast (login y ordersBulk) sin imprimir credenciales.
 * @businessRules Verifica tokens, encabezados y formato de ordersBulk.
 * @dataFlow .env.local → Toast API → diagnóstico de respuesta.
 * @notes Toast exige 'Bearer ' en el token de ordersBulk.
 */
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local', quiet: true })

const toastHost = process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com'

async function testConnection() {
  console.log('Probando autenticación con Toast API...')
  const authRes = await fetch(`${toastHost}/authentication/v1/authentication/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientId: process.env.TOAST_CLIENT_ID,
      clientSecret: process.env.TOAST_CLIENT_SECRET,
      userAccessType: 'TOAST_MACHINE_CLIENT',
    }),
  })

  if (!authRes.ok) {
    throw new Error(`Toast login falló: HTTP ${authRes.status} ${authRes.statusText}`)
  }

  const authData = await authRes.json()
  const token = authData?.token?.accessToken
  console.log('Login exitoso. Token obtenido:', token ? 'OK (longitud: ' + token.length + ')' : 'NO DISPONIBLE')

  // Probar una consulta de diningOptions para Lynwood
  const lynwoodExternalId = '80a1ec95-bc73-402e-8884-e5abbe9343e6'
  console.log('Consultando diningOptions para Lynwood...')
  const optRes = await fetch(`${toastHost}/config/v2/diningOptions`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Toast-Restaurant-External-ID': lynwoodExternalId,
    },
  })
  if (!optRes.ok) {
    throw new Error(`diningOptions falló: HTTP ${optRes.status}`)
  }
  const options = await optRes.json()
  console.log(`diningOptions obtenidos: ${options?.length || 0}`)
  options.forEach((opt: any) => console.log(`- ${opt.name} (behavior: ${opt.behavior}, guid: ${opt.guid})`))

  // Probar 1 página de ordersBulk para 2026-09-22
  console.log('\nConsultando 1 página de ordersBulk (pageSize=5) para Lynwood 2026-09-22...')
  const ordersRes = await fetch(`${toastHost}/orders/v2/ordersBulk?businessDate=20260922&pageSize=5&page=1`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Toast-Restaurant-External-ID': lynwoodExternalId,
    },
  })
  if (!ordersRes.ok) {
    throw new Error(`ordersBulk falló: HTTP ${ordersRes.status}`)
  }
  const orders = await ordersRes.json()
  console.log(`Órdenes devueltas en página de prueba: ${orders?.length || 0}`)
  if (orders?.length > 0) {
    const o = orders[0]
    console.log('Orden ID:', o.guid, 'Source:', o.source, 'Dining Option:', o.diningOption?.name)
    const check = o.checks?.[0]
    console.log('Total checks:', o.checks?.length, 'Selections en check 0:', check?.selections?.length)
    if (check?.selections?.length > 0) {
      const s = check.selections[0]
      console.log('Muestra de selección:', {
        displayName: s.displayName,
        itemGuid: s.item?.guid,
        quantity: s.quantity,
        modifiersCount: s.modifiers?.length,
        modifiers: s.modifiers?.map((m: any) => ({ displayName: m.displayName, itemGuid: m.item?.guid, quantity: m.quantity })),
      })
    }
  }
}

testConnection().catch(err => {
  console.error('Error:', err.message)
  process.exitCode = 1
})
