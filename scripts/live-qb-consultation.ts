/**
 * CONSULTA EN VIVO A INTUIT QUICKBOOKS ONLINE
 * Modo Estricto Solo Lectura (GET / Query)
 * 
 * Run via: npx tsx scripts/live-qb-consultation.ts
 */

import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

async function runLiveConsultation() {
  console.log('═════════════════════════════════════════════════════════════════════════════════════════════════════')
  console.log('🏛️ CONSULTA EN VIVO A INTUIT QUICKBOOKS ONLINE ADVANCED (TACOS GAVILAN LLC)')
  console.log('═════════════════════════════════════════════════════════════════════════════════════════════════════\n')

  const { supabaseAdmin } = await import('../lib/supabase')
  const { data: integ } = await supabaseAdmin
    .from('integrations')
    .select('*')
    .eq('service_name', 'quickbooks')
    .single()

  if (!integ) {
    console.error('No integration found')
    return
  }

  const realmId = integ.realm_id
  const token = integ.access_token
  const baseUrl = `https://quickbooks.api.intuit.com/v3/company/${realmId}`

  const qbFetch = async (endpoint: string) => {
    const url = `${baseUrl}/${endpoint}${endpoint.includes('?') ? '&' : '?'}minorversion=75`
    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    })
    if (!res.ok) {
      throw new Error(`QB API Error ${res.status}: ${await res.text()}`)
    }
    return await res.json()
  }

  // 1. Información de la Empresa
  console.log('🏢 1. INFORMACIÓN OFICIAL DE LA EMPRESA EN QUICKBOOKS:')
  const companyRes = await qbFetch(`companyinfo/${realmId}`)
  const c = companyRes.CompanyInfo
  console.log(`   • Razón Social:    ${c.LegalName}`)
  console.log(`   • Nombre Comercial: ${c.CompanyName}`)
  console.log(`   • Correo Contador:  ${c.Email?.Address}`)
  console.log(`   • Dirección Fiscal: ${c.CompanyAddr?.Line1}, ${c.CompanyAddr?.City}, ${c.CompanyAddr?.CountrySubDivisionCode} ${c.CompanyAddr?.PostalCode}`)
  console.log(`   • Zona Horaria:     ${c.DefaultTimeZone}\n`)

  // 2. Consultar Catálogo de Cuentas en Vivo
  console.log('📒 2. CONSULTANDO CATÁLOGO DE CUENTAS EN VIVO DESDE QUICKBOOKS...')
  const accountsSql = encodeURIComponent("SELECT Id, Name, AcctNum, AccountType, AccountSubType, CurrentBalance, Active FROM Account WHERE Active = true MAXRESULTS 500")
  const accountsData = await qbFetch(`query?query=${accountsSql}`)
  const liveAccounts = accountsData.QueryResponse?.Account || []

  console.log(`   ✓ Total de Cuentas Activas obtenidas en vivo de QuickBooks: ${liveAccounts.length}\n`)

  console.log('📋 MUESTRA DE CUENTAS BANCARIAS Y OPERATIVAS EN QUICKBOOKS:')
  console.log('┌────────┬────────────────────────────────────────┬─────────────┬──────────────────────────┬──────────────┐')
  console.log('│ ID QB  │ Nombre Oficial en QuickBooks           │ Número Acct │ Tipo Contable Intuit     │ Balance Real │')
  console.log('├────────┼────────────────────────────────────────┼─────────────┼──────────────────────────┼──────────────┤')

  // Bancos de tiendas
  const bankAccounts = liveAccounts.filter((a: any) => 
    a.AccountType === 'Bank' || 
    (a.AcctNum && a.AcctNum.startsWith('100')) ||
    a.Name.includes('Bank') || a.Name.includes('Sales') || a.Name.includes('Tax')
  ).slice(0, 20)

  for (const a of bankAccounts) {
    const idStr = String(a.Id).padEnd(6)
    const nameStr = a.Name.padEnd(38).substring(0, 38)
    const numStr = (a.AcctNum || '—').padEnd(11)
    const typeStr = (a.AccountType || '').padEnd(24).substring(0, 24)
    const bal = a.CurrentBalance !== undefined ? `$${Number(a.CurrentBalance).toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '—'
    console.log(`│ #${idStr} │ ${nameStr} │ ${numStr} │ ${typeStr} │ ${bal.padStart(12)} │`)
  }
  console.log('└────────┴────────────────────────────────────────┴─────────────┴──────────────────────────┴──────────────┘\n')

  // 3. Consultar Journal Entries en Vivo (Asientos Contables)
  console.log('📑 3. CONSULTANDO ASIENTOS DE DIARIO (JOURNAL ENTRIES) EN VIVO DESDE QUICKBOOKS...')
  const journalSql = encodeURIComponent("SELECT Id, DocNumber, TxnDate, PrivateNote, Line FROM JournalEntry ORDERBY TxnDate DESC MAXRESULTS 10")
  const journalData = await qbFetch(`query?query=${journalSql}`)
  const liveJournals = journalData.QueryResponse?.JournalEntry || []

  console.log(`   ✓ Asientos Contables obtenidos en vivo: ${liveJournals.length}\n`)
  for (const j of liveJournals) {
    const docStr = (j.DocNumber || 'Sin DocNum').padEnd(22)
    const dateStr = (j.TxnDate || '').padEnd(10)
    const linesCount = `${j.Line?.length || 0} líneas`.padStart(10)
    const noteStr = (j.PrivateNote || '—').substring(0, 50)
    console.log(`   • Póliza: ${docStr} | Fecha: ${dateStr} | ${linesCount} | Nota: ${noteStr}`)
  }

  // 4. Actualizar automáticamente los IDs en Supabase para que coincidan 100% con los IDs en vivo de Intuit
  console.log('\n🔄 4. ACTUALIZANDO IDs EN SUPABASE CON LA RESPUESTA EN VIVO...')
  const { data: dbAccounts } = await supabaseAdmin.from('accounting_gl_accounts').select('*')
  let syncedCount = 0

  for (const liveAcc of liveAccounts) {
    const match = dbAccounts?.find(db => 
      (liveAcc.AcctNum && db.account_number === liveAcc.AcctNum) ||
      (db.account_name.toLowerCase() === liveAcc.Name.toLowerCase())
    )

    if (match) {
      await supabaseAdmin
        .from('accounting_gl_accounts')
        .update({ qb_account_id: String(liveAcc.Id) })
        .eq('id', match.id)
      syncedCount++
    }
  }

  console.log(`   ✅ ${syncedCount} cuentas sincronizadas en Supabase con los IDs oficiales en vivo de QuickBooks.`)
  console.log('\n═════════════════════════════════════════════════════════════════════════════════════════════════════')
  console.log('🎉 AUDITORÍA Y CONSULTA EN VIVO A QUICKBOOKS ONLINE COMPLETADA CON ÉXITO AL 100%')
  console.log('═════════════════════════════════════════════════════════════════════════════════════════════════════')
}

runLiveConsultation().catch(console.error)
