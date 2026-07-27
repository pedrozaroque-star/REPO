import { getQuickBooksClient } from '../lib/quickbooks.js'
import { getSupabaseAdminClient } from '../lib/supabase.js'


import * as dotenv from 'dotenv'
import * as path from 'path'

dotenv.config({ path: path.join(__dirname, '../.env.local') })

async function main() {
    console.log("=== INSPECCIONANDO ITEMS EN QUICKBOOKS ONLINE (TS) ===")
    
    try {
        const qbo = await getQuickBooksClient()
        console.log("✅ Cliente de QuickBooks obtenido.")

        console.log("Buscando items activos en QuickBooks...")
        const qbItems = await new Promise<any[]>((resolve, reject) => {
            qbo.findItems({ active: true }, (err: any, result: any) => {
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
            console.log(`Type: ${item.Type}`)
            console.log(`UnitPrice (Venta): $${item.UnitPrice}`)
            console.log(`PurchaseCost (Compra): $${item.PurchaseCost}`)
            console.log(`Sku: ${item.Sku}`)
        }
    } catch (e: any) {
        console.error("❌ Error en la ejecución:", e.message || e)
    }
}

main().then(() => process.exit(0))
