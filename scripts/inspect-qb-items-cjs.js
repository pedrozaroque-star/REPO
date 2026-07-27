const { createClient } = require('@supabase/supabase-js')
const dotenv = require('dotenv')
const path = require('path')
const OAuthClient = require('intuit-oauth')
const QuickBooks = require('node-quickbooks')

dotenv.config({ path: path.join(__dirname, '../.env.local') })

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const authClient = new OAuthClient({
    clientId: process.env.QUICKBOOKS_CLIENT_ID,
    clientSecret: process.env.QUICKBOOKS_CLIENT_SECRET,
    environment: process.env.QUICKBOOKS_ENVIRONMENT || 'sandbox',
    redirectUri: process.env.QUICKBOOKS_REDIRECT_URI,
})

async function main() {
    console.log("=== INSPECCIONANDO ITEMS EN QUICKBOOKS ONLINE (CJS) ===")
    
    // 1. Obtener la integración de QB
    const { data: integration, error: intErr } = await supabase
        .from('integrations')
        .select('*')
        .eq('service_name', 'quickbooks')
        .single()

    if (intErr || !integration) {
        console.error("No se encontró la integración de QuickBooks:", intErr?.message)
        return
    }

    // 2. Refresh Token
    let accessToken = integration.access_token
    const isExpired = new Date(integration.expires_at) <= new Date()
    
    try {
        console.log("Renovando token de QuickBooks usando intuit-oauth SDK...")
        const authResponse = await authClient.refreshUsingToken(integration.refresh_token)
        const tokens = authResponse.getJson()
        accessToken = tokens.access_token
        console.log("✅ Token renovado exitosamente.")

        // Actualizar en base de datos
        await supabase.from('integrations').update({
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
            updated_at: new Date().toISOString()
        }).eq('id', integration.id)
    } catch (refreshError) {
        console.error("Error refreshing token with SDK:", refreshError.message || refreshError)
        // Fallback: usar el access_token actual si no expira o por si las dudas
        console.log("Intentando usar el access token actual...")
    }

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
        integration.refresh_token
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

    const targets = ['pollo', 'pastor', 'lengua', 'cabeza', 'asada']
    const matched = qbItems.filter(item => 
        targets.some(t => item.Name.toLowerCase().includes(t))
    )

    console.log(`\nItems que coinciden en QuickBooks:`)
    for (const item of matched) {
        console.log(`\n----------------------------------------`)
        console.log(`ID: ${item.Id}`)
        console.log(`Nombre: ${item.Name}`)
        console.log(`UnitPrice (Venta): $${item.UnitPrice}`)
        console.log(`PurchaseCost (Compra): $${item.PurchaseCost}`)
        console.log(`Sku: ${item.Sku}`)
    }
}

main().then(() => process.exit(0)).catch(console.error)
