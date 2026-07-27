const { createClient } = require('@supabase/supabase-js')
const dotenv = require('dotenv')
const path = require('path')
const QuickBooks = require('node-quickbooks')

dotenv.config({ path: path.join(__dirname, '../.env.local') })

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

async function main() {
    console.log("=== INSPECCIONANDO ITEMS EN QUICKBOOKS ONLINE ===")
    
    // 1. Obtener la integración de QB
    const { data: integration } = await supabase
        .from('integrations')
        .select('*')
        .eq('service_name', 'quickbooks')
        .single()

    if (!integration) {
        console.error("No se encontró la integración de QuickBooks")
        return
    }

    // 2. Refresh Token
    let accessToken = integration.access_token
    console.log("Renovando token de QuickBooks...")
    // Usamos fetch nativo para refrescar el token igual que en el callback
    const b64 = Buffer.from(`${process.env.QUICKBOOKS_CLIENT_ID}:${process.env.QUICKBOOKS_CLIENT_SECRET}`).toString('base64')
    const tokenRes = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
        method: 'POST',
        headers: {
            'Authorization': `Basic ${b64}`,
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json'
        },
        body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: integration.refresh_token
        })
    })

    if (!tokenRes.ok) {
        console.error("Error al renovar token:", await tokenRes.text())
        return
    }

    const tokens = await tokenRes.json()
    accessToken = tokens.access_token
    console.log("✅ Token renovado.")

    // Guardar tokens renovados para que no expiren
    await supabase.from('integrations').update({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
        updated_at: new Date().toISOString()
    }).eq('id', integration.id)

    // 3. Inicializar QB
    const qbo = new QuickBooks(
        process.env.QUICKBOOKS_CLIENT_ID,
        process.env.QUICKBOOKS_CLIENT_SECRET,
        accessToken,
        false,
        integration.realm_id,
        process.env.QUICKBOOKS_ENVIRONMENT === 'production' ? false : true,
        false,
        null,
        '2.0',
        tokens.refresh_token
    )

    // 4. Buscar items
    console.log("Obteniendo items de QuickBooks...")
    const qbItems = await new Promise((resolve, reject) => {
        qbo.findItems({ active: true }, (err, result) => {
            if (err) reject(err)
            else resolve(result?.QueryResponse?.Item || [])
        })
    })

    console.log(`Encontrados ${qbItems.length} items activos en QuickBooks.`)

    // Filtrar los que nos interesan
    const targets = ['pollo', 'pastor', 'lengua', 'cabeza', 'asada']
    const matched = qbItems.filter(item => 
        targets.some(t => item.Name.toLowerCase().includes(t))
    )

    console.log(`\nItems que coinciden en QuickBooks:`)
    for (const item of matched) {
        console.log(`\n----------------------------------------`)
        console.log(`ID: ${item.Id}`)
        console.log(`Nombre: ${item.Name}`)
        console.log(`Tipo: ${item.Type}`)
        console.log(`UnitPrice (Venta): $${item.UnitPrice}`)
        console.log(`PurchaseCost (Compra): $${item.PurchaseCost}`)
        console.log(`Sku: ${item.Sku}`)
        console.log(`Objeto Completo:`, JSON.stringify(item, null, 2))
    }
}

main().then(() => process.exit(0)).catch(console.error)
