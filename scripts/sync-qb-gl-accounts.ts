/**
 * Sincronizar catálogo de cuentas GL con QuickBooks Online en vivo.
 * Run via: npx tsx scripts/sync-qb-gl-accounts.ts
 */

import dotenv from 'dotenv'
import path from 'path'
import { supabaseAdmin } from '../lib/supabase'
import { getQuickBooksClient } from '../lib/quickbooks'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

async function syncAccounts() {
  console.log('🔄 Conectando con Intuit QuickBooks Online...')
  try {
    const qbo = await getQuickBooksClient()

    const qbResult: any = await new Promise((resolve, reject) => {
      qbo.findAccounts({ fetchAll: true }, (err: any, data: any) => {
        if (err) reject(err)
        else resolve(data)
      })
    })

    const accounts = qbResult?.QueryResponse?.Account || []
    console.log(`✅ Se obtuvieron ${accounts.length} cuentas desde QuickBooks Online.`)

    // Mapear cuentas existentes en nuestra DB
    const { data: dbAccounts } = await supabaseAdmin.from('accounting_gl_accounts').select('*')
    console.log(`📊 Cuentas en nuestra base de datos: ${dbAccounts?.length || 0}`)

    let updatedCount = 0

    for (const qbAcct of accounts) {
      // Buscar coincidencia por AcctNum o por nombre
      const acctNum = qbAcct.AcctNum || (qbAcct.Name.match(/^(\d{5})/)?.[1])
      const qbName = qbAcct.Name.replace(/^(\d{5})\s*[-–]\s*/, '').trim()

      const match = dbAccounts?.find(db => 
        (acctNum && db.account_number === acctNum) ||
        (db.account_name.toLowerCase() === qbName.toLowerCase()) ||
        (qbAcct.FullyQualifiedName && qbAcct.FullyQualifiedName.toLowerCase().includes(db.account_name.toLowerCase()))
      )

      if (match) {
        console.log(`  ✓ Matched: ${match.account_number} (${match.account_name}) ➔ QB ID: #${qbAcct.Id}`)
        await supabaseAdmin
          .from('accounting_gl_accounts')
          .update({ qb_account_id: String(qbAcct.Id) })
          .eq('id', match.id)
        updatedCount++
      }
    }

    console.log(`\n🎉 Total de cuentas actualizadas con su ID oficial de QuickBooks: ${updatedCount}`)
  } catch (err: any) {
    console.log(`⚠️ Nota: ${err.message}`)
  }
}

syncAccounts().catch(console.error)
