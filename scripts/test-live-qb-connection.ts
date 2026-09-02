/**
 * TEST EN VIVO DE CONEXIÓN A QUICKBOOKS ONLINE
 * 1. Consultar el token actualizado en la tabla integrations de Supabase.
 * 2. Conectarse a Intuit QuickBooks Online via node-quickbooks SDK.
 * 3. Consultar CompanyInfo (Información de la Compañía).
 * 4. Consultar el Chart of Accounts en vivo (Catálogo de Cuentas).
 * 5. Consultar los Journal Entries registrados recientemente (Asientos Contables).
 * 
 * Run via: npx tsx scripts/test-live-qb-connection.ts
 */

import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

async function testLiveQB() {
  console.log('═══════════════════════════════════════════════════════════════════════════════════')
  console.log('🚀 CONECTANDO EN VIVO A INTUIT QUICKBOOKS ONLINE...')
  console.log('═══════════════════════════════════════════════════════════════════════════════════\n')

  const { supabaseAdmin } = await import('../lib/supabase')
  const { getQuickBooksClient } = await import('../lib/quickbooks')

  // 1. Verificar tokens en Supabase
  const { data: integ } = await supabaseAdmin
    .from('integrations')
    .select('*')
    .eq('service_name', 'quickbooks')
    .single()

  console.log('📦 ESTADO DE INTEGRACIÓN EN SUPABASE:')
  console.log(`   • Realm ID (Company ID): ${integ?.realm_id}`)
  console.log(`   • Token Expiration:      ${integ?.expires_at}`)
  console.log(`   • Updated At:            ${integ?.updated_at}\n`)

  try {
    const qbo = await getQuickBooksClient()
    console.log('✅ Cliente de QuickBooks inicializado exitosamente.\n')

    // 2. Consultar Company Info
    console.log('🏢 1. Consultando Información de la Compañía en QuickBooks Online...')
    const companyInfo: any = await new Promise((resolve, reject) => {
      qbo.getCompanyInfo(integ?.realm_id, (err: any, data: any) => {
        if (err) reject(err)
        else resolve(data)
      })
    })

    console.log(`   ✓ Nombre Legal:    ${companyInfo?.LegalName || companyInfo?.CompanyName}`)
    console.log(`   ✓ Nombre Comercial: ${companyInfo?.CompanyName}`)
    console.log(`   ✓ Dirección:        ${companyInfo?.CompanyAddr?.Line1}, ${companyInfo?.CompanyAddr?.City}, ${companyInfo?.CompanyAddr?.CountrySubDivisionCode} ${companyInfo?.CompanyAddr?.PostalCode}`)
    console.log(`   ✓ Moneda:           ${companyInfo?.SupportedLanguages || 'USD'}\n`)

    // 3. Consultar Cuentas Contables en Vivo
    console.log('📒 2. Consultando Catálogo de Cuentas (Chart of Accounts) en Vivo desde QuickBooks...')
    const accountsRes: any = await new Promise((resolve, reject) => {
      qbo.findAccounts({ fetchAll: true }, (err: any, data: any) => {
        if (err) reject(err)
        else resolve(data)
      })
    })

    const accounts = accountsRes?.QueryResponse?.Account || []
    console.log(`   ✓ Total de Cuentas Contables encontradas en QuickBooks: ${accounts.length}\n`)

    console.log('📋 MUESTRA DE CUENTAS PRINCIPALES EN QUICKBOOKS:')
    console.log('┌────────┬────────────────────────────────────────┬──────────────────────┬─────────────┬──────────┐')
    console.log('│ QB ID  │ Nombre de la Cuenta                    │ Número de Cuenta     │ Tipo Intuit │ Balance  │')
    console.log('├────────┼────────────────────────────────────────┼──────────────────────┼─────────────┼──────────┤')

    const keyAccounts = accounts.filter((a: any) => 
      a.Name.includes('Azusa') || a.Name.includes('Lynwood') || a.Name.includes('Sales') ||
      a.Name.includes('Uber') || a.Name.includes('DoorDash') || a.Name.includes('Tax') ||
      a.Name.includes('Cash') || a.Name.includes('Bank')
    ).slice(0, 15)

    for (const a of keyAccounts) {
      const idStr = String(a.Id).padEnd(6)
      const nameStr = a.Name.padEnd(38).substring(0, 38)
      const numStr = (a.AcctNum || '—').padEnd(20)
      const typeStr = a.AccountType.padEnd(11)
      const balStr = a.CurrentBalance !== undefined ? `$${Number(a.CurrentBalance).toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '—'
      console.log(`│ #${idStr} │ ${nameStr} │ ${numStr} │ ${typeStr} │ ${balStr.padStart(8)} │`)
    }
    console.log('└────────┴────────────────────────────────────────┴──────────────────────┴─────────────┴──────────┘\n')

    // 4. Consultar Journal Entries en Vivo (Asientos Contables)
    console.log('📑 3. Consultando Asientos Contables (Journal Entries) en Vivo desde QuickBooks...')
    const journalRes: any = await new Promise((resolve, reject) => {
      qbo.findJournalEntries([
        { field: 'fetchAll', value: true },
        { field: 'limit', value: 10 }
      ], (err: any, data: any) => {
        if (err) reject(err)
        else resolve(data)
      })
    })

    const journals = journalRes?.QueryResponse?.JournalEntry || []
    console.log(`   ✓ Asientos Contables encontrados: ${journals.length}\n`)

    if (journals.length > 0) {
      console.log('📋 ÚLTIMOS ASIENTOS REGISTRADOS EN QUICKBOOKS:')
      for (const j of journals.slice(0, 5)) {
        console.log(`   • Póliza DocNumber: ${j.DocNumber || 'Sin DocNum'} | Fecha: ${j.TxnDate} | Total Líneas: ${j.Line?.length || 0} | Nota: ${j.PrivateNote || '—'}`)
      }
    }

    console.log('\n═══════════════════════════════════════════════════════════════════════════════════')
    console.log('🎉 ¡CONEXIÓN EN VIVO A QUICKBOOKS ONLINE EXITOSA AL 100%!')
    console.log('═══════════════════════════════════════════════════════════════════════════════════')
  } catch (err: any) {
    console.error('❌ Error durante la consulta a QuickBooks:', err.originalMessage || err.message)
    if (err.authResponse) {
      console.error('Auth Response:', err.authResponse.text())
    }
  }
}

testLiveQB().catch(console.error)
