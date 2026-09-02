/**
 * Extraer todos los IDs de cuentas de QuickBooks desde el dump completo de Cohesion
 * y actualizar la tabla accounting_gl_accounts en Supabase.
 * 
 * Run via: npx tsx scripts/extract-all-qb-accounts-from-dump.ts
 */

import fs from 'fs'
import path from 'path'
import dotenv from 'dotenv'
import { supabaseAdmin } from '../lib/supabase'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

async function extractAccounts() {
  const filePath = path.join(__dirname, 'cohesion_dump', 'all_mappings', 'azusa_full_form.json')
  if (!fs.existsSync(filePath)) {
    console.error('File not found:', filePath)
    return
  }

  const rawData = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  const inputs = rawData.inputs || []

  console.log(`Total controls in form: ${inputs.length}`)

  // Search for select controls that list QuickBooks accounts
  // In Cohesion, bank accounts, sales accounts, tax accounts, etc. are <select> elements populated with QuickBooks Chart of Accounts
  const accountMap = new Map<string, { id: string; name: string; number: string; rawText: string }>()

  // Let's read the raw HTML if available or parse the select options from the HTML files in company_deep
  const companyDeepDir = path.join(__dirname, 'cohesion_dump', 'company_deep')
  if (fs.existsSync(companyDeepDir)) {
    const htmlFiles = fs.readdirSync(companyDeepDir).filter(f => f.endsWith('.html'))
    for (const f of htmlFiles) {
      const content = fs.readFileSync(path.join(companyDeepDir, f), 'utf8')
      // Find all <option value="12345">10000 - Azusa</option> or similar
      const regex = /<option[^>]*value=["'](\d+)["'][^>]*>\s*([0-9]{5})?\s*[-–]?\s*([^<]+)<\/option>/gi
      let match
      while ((match = regex.exec(content)) !== null) {
        const qbId = match[1]
        const acctNum = match[2] || ''
        const acctName = match[3]?.trim() || ''
        if (acctNum || acctName) {
          accountMap.set(qbId, { id: qbId, name: acctName, number: acctNum, rawText: match[0] })
        }
      }
    }
  }

  // Also check all_mappings/
  const allMappingsDir = path.join(__dirname, 'cohesion_dump')
  const scanDir = (dir: string) => {
    const files = fs.readdirSync(dir)
    for (const file of files) {
      const fullPath = path.join(dir, file)
      if (fs.statSync(fullPath).isDirectory()) {
        scanDir(fullPath)
      } else if (file.endsWith('.html')) {
        const content = fs.readFileSync(fullPath, 'utf8')
        const regex = /<option[^>]*value=["'](\d{5,})["'][^>]*>\s*(?:([0-9]{5})\s*[-–]\s*)?([^<]+)<\/option>/gi
        let match
        while ((match = regex.exec(content)) !== null) {
          const qbId = match[1]
          const acctNum = match[2] || ''
          const acctName = match[3]?.trim() || ''
          accountMap.set(qbId, { id: qbId, name: acctName, number: acctNum, rawText: match[0] })
        }
      }
    }
  }

  scanDir(allMappingsDir)

  console.log(`\n✅ Se encontraron ${accountMap.size} cuentas con IDs de QuickBooks en los dumps de Cohesion:`)
  for (const [id, acc] of accountMap.entries()) {
    console.log(`   • ID: #${id.padEnd(8)} | Num: ${acc.number.padEnd(6)} | Name: ${acc.name}`)
  }

  // Actualizar en Supabase
  const { data: dbAccounts } = await supabaseAdmin.from('accounting_gl_accounts').select('*')
  let updated = 0

  for (const [qbId, acc] of accountMap.entries()) {
    const match = dbAccounts?.find(db => 
      (acc.number && db.account_number === acc.number) ||
      (acc.name && db.account_name.toLowerCase() === acc.name.toLowerCase()) ||
      (acc.name && acc.name.toLowerCase().includes(db.account_name.toLowerCase()))
    )

    if (match) {
      console.log(`  Updating ${match.account_number} (${match.account_name}) ➔ QB ID: #${qbId}`)
      await supabaseAdmin
        .from('accounting_gl_accounts')
        .update({ qb_account_id: qbId })
        .eq('id', match.id)
      updated++
    }
  }

  console.log(`\n🎉 Cuentas actualizadas en Supabase: ${updated}`)
}

extractAccounts()
