import fs from 'fs'
import path from 'path'
import dotenv from 'dotenv'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { createClient } from '@supabase/supabase-js'

interface QBSalesSummary {
  id: string
  docNumber: string
  date: string
  storeName: string
  netSales: number
  taxes: number
  totalGross: number
  forHere: number
  toGo: number
  driveThru: number
  uberSales: number
  doordashSales: number
  grubhubSales: number
  taxPaidByUber: number
  salesTax: number
  marketplaceTax: number
  ebtAmount: number
  uberPayment: number
  doordashPayment: number
  grubhubPayment: number
  creditCardDeposit: number
  creditCardFees: number
  cashDeposit: number
  debits: number
  credits: number
  isBalanced: boolean
  linesCount: number
}

// Canonical store names mapping from Class/Location in QB
const STORE_NAME_MAP: Record<string, string> = {
  'azusa': 'Azusa',
  'bell': 'Bell',
  'broadway': 'Broadway',
  'broadway la': 'Broadway',
  'central': 'Central',
  'central la': 'Central',
  'downey': 'Downey',
  'hollywood': 'Hollywood',
  'huntington park': 'Huntington Park',
  'la puente': 'La Puente',
  'lynwood': 'Lynwood',
  'norwalk': 'Norwalk',
  'paramount': 'Paramount',
  'rialto': 'Rialto',
  'santa ana': 'Santa Ana',
  'santa fe': 'Santa Fe',
  'slauson': 'Slauson',
  'south gate': 'South Gate',
  'souht gate': 'South Gate',
  'vernon': 'Vernon',
  'west covina': 'West Covina'
}

function parseQBEntry(entry: any): QBSalesSummary | null {
  const lines = entry.Line || []
  const hasSales = lines.some((l: any) => l.JournalEntryLineDetail?.AccountRef?.name === 'Sales')
  if (!hasSales) return null

  // Determine store from Class or Location
  let rawStore = ''
  for (const l of lines) {
    const cls = l.JournalEntryLineDetail?.ClassRef?.name
    const loc = l.JournalEntryLineDetail?.DepartmentRef?.name
    if (cls) { rawStore = cls; break }
    if (loc) { rawStore = loc; break }
  }

  // Fallback to DocNumber parsing e.g. POS20260107WESTCOVIN1
  if (!rawStore && entry.DocNumber) {
    rawStore = entry.DocNumber.replace(/^POS\d{8}/, '').replace(/\d+$/, '')
  }

  const normalizedKey = rawStore.toLowerCase().trim()
  const storeName = STORE_NAME_MAP[normalizedKey] || rawStore

  let forHere = 0
  let toGo = 0
  let driveThru = 0
  let uberSales = 0
  let doordashSales = 0
  let grubhubSales = 0
  let taxPaidByUber = 0
  let salesTax = 0
  let marketplaceTax = 0
  let ebtAmount = 0
  let uberPayment = 0
  let doordashPayment = 0
  let grubhubPayment = 0
  let creditCardDeposit = 0
  let creditCardFees = 0
  let cashDeposit = 0
  let debits = 0
  let credits = 0

  for (const l of lines) {
    const dt = l.JournalEntryLineDetail
    const amt = Number(l.Amount || 0)
    const isDebit = dt?.PostingType === 'Debit'
    const isCredit = dt?.PostingType === 'Credit'
    const desc = (l.Description || '').toLowerCase()
    const acct = (dt?.AccountRef?.name || '').toLowerCase()

    if (isDebit) debits += amt
    if (isCredit) credits += amt

    // Sales Revenue Breakdown (Any Credit to Sales or Delivery accounts)
    if (isCredit) {
      if (acct === 'sales' || acct.includes('food sales')) {
        if (desc.includes('for here') || desc.includes('comedor')) {
          forHere += amt
        } else if (desc.includes('to go') || desc.includes('llevar')) {
          toGo += amt
        } else if (desc.includes('drive thru')) {
          driveThru += amt
        } else {
          // Toast Online, Catering, Curbside, etc.
          toGo += amt
        }
      } else if (acct.includes('uber') && (desc.includes('delivery') || desc.includes('takeout') || desc.includes('sales'))) {
        uberSales += amt
      } else if (acct.includes('doordash') && (desc.includes('delivery') || desc.includes('takeout') || desc.includes('sales'))) {
        doordashSales += amt
      } else if (acct.includes('grubhub') && (desc.includes('delivery') || desc.includes('takeout') || desc.includes('sales'))) {
        grubhubSales += amt
      } else if (desc.includes('tax paid by uber') || desc.includes('facilitator tax paid')) {
        taxPaidByUber += amt
      } else if (desc.includes('marketplace') || desc.includes('facilitator taxes not paid')) {
        marketplaceTax += amt
      } else if (acct.includes('sales tax payable') || desc.includes('sale tax') || desc.includes('sales tax')) {
        salesTax += amt
      }
    }

    // Payments & Receivables Breakdown
    if (isDebit) {
      if (desc === 'ebt') {
        ebtAmount += amt
      } else if (desc.includes('credit card deposit')) {
        creditCardDeposit += amt
      } else if (desc.includes('credit card fee') || desc.includes('merchant fee') || acct.includes('merchant fee')) {
        creditCardFees += amt
      } else if (desc.includes('deposit to bank') || acct.includes('undeposited') || acct.includes('cash on hand')) {
        cashDeposit += amt
      } else if (desc.includes('uber') || acct.includes('receivables due from uber')) {
        uberPayment += amt
      } else if (desc.includes('doordash') || acct.includes('receivables due from doordash')) {
        doordashPayment += amt
      } else if (desc.includes('grubhub') || acct.includes('receivables due from grubhub')) {
        grubhubPayment += amt
      }
    }
  }

  const netSales = forHere + toGo + driveThru + uberSales + doordashSales + grubhubSales
  const taxes = salesTax + marketplaceTax + taxPaidByUber
  const totalGross = netSales + taxes

  return {
    id: entry.Id,
    docNumber: entry.DocNumber,
    date: entry.TxnDate,
    storeName,
    netSales: Math.round(netSales * 100) / 100,
    taxes: Math.round(taxes * 100) / 100,
    totalGross: Math.round(totalGross * 100) / 100,
    forHere: Math.round(forHere * 100) / 100,
    toGo: Math.round(toGo * 100) / 100,
    driveThru: Math.round(driveThru * 100) / 100,
    uberSales: Math.round(uberSales * 100) / 100,
    doordashSales: Math.round(doordashSales * 100) / 100,
    grubhubSales: Math.round(grubhubSales * 100) / 100,
    taxPaidByUber: Math.round(taxPaidByUber * 100) / 100,
    salesTax: Math.round(salesTax * 100) / 100,
    marketplaceTax: Math.round(marketplaceTax * 100) / 100,
    ebtAmount: Math.round(ebtAmount * 100) / 100,
    uberPayment: Math.round(uberPayment * 100) / 100,
    doordashPayment: Math.round(doordashPayment * 100) / 100,
    grubhubPayment: Math.round(grubhubPayment * 100) / 100,
    creditCardDeposit: Math.round(creditCardDeposit * 100) / 100,
    creditCardFees: Math.round(creditCardFees * 100) / 100,
    cashDeposit: Math.round(cashDeposit * 100) / 100,
    debits: Math.round(debits * 100) / 100,
    credits: Math.round(credits * 100) / 100,
    isBalanced: Math.abs(debits - credits) < 0.01,
    linesCount: lines.length
  }
}

async function runFullAudit() {
  console.log('═══════════════════════════════════════════════════════════════════════')
  console.log('🔬 AUDITORÍA FORENSE COMPLETA: ENERO A JULIO 2026 (QUICKBOOKS VS TOAST/TEG)')
  console.log('═══════════════════════════════════════════════════════════════════════\n')

  const qbRaw = JSON.parse(fs.readFileSync('data/qb_historical_entries_2026.json', 'utf-8'))
  console.log(`Cargadas ${qbRaw.length} entradas brutas de QuickBooks Online.`)

  const parsedPackets: QBSalesSummary[] = []
  for (const e of qbRaw) {
    const p = parseQBEntry(e)
    if (p) parsedPackets.push(p)
  }

  console.log(`✓ Filtradas ${parsedPackets.length} pólizas POS de ventas de Cohesion.\n`)

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Fetch all cached sales from Supabase for Jan 1 to Jul 31 2026 with pagination
  console.log('Consultando base de datos Toast POS (sales_daily_cache) para Enero - Julio 2026 con paginación...')
  let cacheRows: any[] = []
  let pageOffset = 0
  const pageSize = 1000
  let moreCache = true

  while (moreCache) {
    const { data: pageData, error } = await supabase
      .from('sales_daily_cache')
      .select('*')
      .gte('business_date', '2026-01-01')
      .lte('business_date', '2026-07-31')
      .range(pageOffset, pageOffset + pageSize - 1)

    if (error) {
      console.error('Error fetching cache:', error)
      break
    }

    if (pageData && pageData.length > 0) {
      cacheRows = cacheRows.concat(pageData)
      if (pageData.length < pageSize) moreCache = false
      else pageOffset += pageSize
    } else {
      moreCache = false
    }
  }

  console.log(`✓ Obtenidos ${cacheRows.length} registros de ventas diarias de Toast POS.\n`)

  // Index cache by `${store_name.toLowerCase()}_${business_date}`
  const cacheMap = new Map<string, any>()
  for (const r of cacheRows || []) {
    const cleanStore = (r.store_name || '').replace(/Tacos Gavilan\s*/i, '').toLowerCase().trim()
    cacheMap.set(`${cleanStore}_${r.business_date}`, r)
  }

  // Monthly stats accumulators
  const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio']
  const monthlyStats: Record<string, {
    totalPackets: number
    exactMatches: number
    diffUnder5Cents: number
    outOfBalanceCount: number
    totalQBSales: number
    totalTEGSales: number
    diffNetSales: number
    totalQBTax: number
    totalTEGTax: number
    diffTax: number
    totalQBEBT: number
    totalTEGEBT: number
    diffEBT: number
  }> = {}

  for (const m of monthNames) {
    monthlyStats[m] = {
      totalPackets: 0,
      exactMatches: 0,
      diffUnder5Cents: 0,
      outOfBalanceCount: 0,
      totalQBSales: 0,
      totalTEGSales: 0,
      diffNetSales: 0,
      totalQBTax: 0,
      totalTEGTax: 0,
      diffTax: 0,
      totalQBEBT: 0,
      totalTEGEBT: 0,
      diffEBT: 0
    }
  }

  const discrepancyList: any[] = []

  // Audit each QB packet
  for (const qb of parsedPackets) {
    const monthIndex = parseInt(qb.date.split('-')[1], 10) - 1
    if (monthIndex < 0 || monthIndex > 6) continue
    const monthName = monthNames[monthIndex]
    const stat = monthlyStats[monthName]
    stat.totalPackets++

    const key = `${qb.storeName.toLowerCase()}_${qb.date}`
    const tegCache = cacheMap.get(key)

    if (!tegCache) {
      // Store or date not found in cache
      continue
    }

    const tegNet = Number(tegCache.net_sales || 0)
    const tegTax = Number(tegCache.taxes || 0)
    const tegEbt = Number(tegCache.ebt_amount || 0)

    stat.totalQBSales += qb.netSales
    stat.totalTEGSales += tegNet
    stat.totalQBTax += qb.taxes
    stat.totalTEGTax += tegTax
    stat.totalQBEBT += qb.ebtAmount
    stat.totalTEGEBT += tegEbt

    const diffNet = Math.abs(qb.netSales - tegNet)
    const diffTax = Math.abs(qb.taxes - tegTax)
    const diffEbt = Math.abs(qb.ebtAmount - tegEbt)

    stat.diffNetSales += diffNet
    stat.diffTax += diffTax
    stat.diffEBT += diffEbt

    if (diffNet < 0.02 && diffTax < 0.02) {
      stat.exactMatches++
    } else if (diffNet <= 0.05) {
      stat.diffUnder5Cents++
    } else {
      stat.outOfBalanceCount++
      discrepancyList.push({
        store: qb.storeName,
        date: qb.date,
        doc: qb.docNumber,
        qbNet: qb.netSales,
        tegNet,
        diffNet,
        qbTax: qb.taxes,
        tegTax,
        diffTax
      })
    }
  }

  console.log('═══════════════════════════════════════════════════════════════════════')
  console.log('📊 MATRIZ DE AUDITORÍA MES POR MES (QUICKBOOKS ONLINE VS APP TEG)')
  console.log('═══════════════════════════════════════════════════════════════════════')

  const summaryTable = Object.entries(monthlyStats).map(([month, s]) => {
    const matchPct = s.totalPackets > 0 
      ? (((s.exactMatches + s.diffUnder5Cents) / s.totalPackets) * 100).toFixed(2) + '%'
      : '0.00%'

    return {
      'Mes': month,
      'Pólizas Auditadas': s.totalPackets,
      'Cuadre Exacto': s.exactMatches,
      'Dif. <= $0.05': s.diffUnder5Cents,
      'Tickets Desbalanceados': s.outOfBalanceCount,
      'Ventas QB ($)': '$' + s.totalQBSales.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      'Ventas TEG ($)': '$' + s.totalTEGSales.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      'Dif. Total Ventas ($)': '$' + s.diffNetSales.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      'Paridad Contable': matchPct
    }
  })

  console.table(summaryTable)

  console.log('\n═══════════════════════════════════════════════════════════════════════')
  console.log(`🔍 DETALLE DE DISCREPANCIAS ENCONTRADAS: ${discrepancyList.length} de ${parsedPackets.length}`)
  console.log('═══════════════════════════════════════════════════════════════════════')
  if (discrepancyList.length > 0) {
    console.log('Muestra de las primeras 10 diferencias operativas:')
    console.table(discrepancyList.slice(0, 10).map(d => ({
      'Sucursal': d.store,
      'Fecha': d.date,
      'Doc QB': d.doc,
      'Net QB': `$${d.qbNet.toFixed(2)}`,
      'Net TEG': `$${d.tegNet.toFixed(2)}`,
      'Dif Net': `$${d.diffNet.toFixed(2)}`,
      'Tax QB': `$${d.qbTax.toFixed(2)}`,
      'Tax TEG': `$${d.tegTax.toFixed(2)}`,
      'Dif Tax': `$${d.diffTax.toFixed(2)}`
    })))
  }

  // Save audit report
  fs.writeFileSync('data/audit_full_results_2026.json', JSON.stringify({
    timestamp: new Date().toISOString(),
    totalPacketsAudited: parsedPackets.length,
    monthlyStats,
    discrepancyList
  }, null, 2))

  console.log('\n✓ Resultados completos guardados en data/audit_full_results_2026.json')
}

runFullAudit()
