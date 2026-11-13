/**
 * @module api/external-accounting/reports
 * @description Motor de generación de Reportes Financieros Avanzados para la Contadora (CPA)
 * del módulo CONTABILIDAD EXTERNA (Raquel Velazquez).
 *
 * @businessRules
 * - Soporta cálculo dinámico en vivo por rango de fechas (`startDate`, `endDate`) y método contable (`Accrual` vs `Cash`):
 *   1. `pnl`: Estado de Resultados (Profit & Loss) + comparativo multianual.
 *   2. `balance_sheet`: Balance General (Activos, Pasivos y Capital).
 *   3. `bank_register`: Auxiliar Bancario con Saldo Acumulado (Running Balance).
 *   4. `general_ledger`: Libro Mayor detallado cuenta por cuenta.
 *   5. `trial_balance`: Balanza de Comprobación (Cargos vs Abonos).
 *   6. `vendor_expenses`: Resumen de Salidas por Proveedor (Auditoría 1099 / Contadora).
 *   7. `customer_income`: Resumen de Entradas por Cliente / Arrendatario.
 *   8. `check_detail`: Reporte Detallado de Cheques Emitidos.
 *   9. `deposit_detail`: Reporte Detallado de Depósitos Bancarios.
 *   10. `qbo_archive`: Visor de Reportes Oficiales Históricos respaldados de Intuit QBO.
 *   11. `account_quickreport`: Transaction Report / Drill-Down por cuenta, grupo, lista o contacto.
 *
 * @dataFlow
 * Client (/admin/contabilidad-externa) -> GET /api/external-accounting/reports -> Supabase
 * Todas las cifras salen del Libro Mayor en partida doble (`lib/external-accounting-ledger.ts`).
 *
 * @notes
 * - 2026-10-28 (auditoría en vivo contra QBO V3 de las 6 empresas conectadas): se reescribieron P&L, Balance Sheet,
 *   Trial Balance, General Ledger, Bank Register, Expenses by Vendor / Income by Customer y el Transaction Report
 *   sobre el motor de pólizas. Errores corregidos: Total Liabilities salía negativo; préstamos al corte desfasados
 *   (los pagos posteriores se revertían con signo invertido); Retained Earnings en $0 y "Net Income" como cifra de
 *   cuadre; depósitos a cuentas de Balance (préstamos, Cash on hand) contados como Ingreso; Trial Balance sin cuentas
 *   de Resultados y con pasivos del lado deudor; Expenses by Vendor sumaba pagos de facturas y abonos a capital.
 * - Convención de montos de salida: signo de presentación QBO (pasivos, capital e ingresos en positivo).
 * - Paginación PostgREST siempre ordenada por `txn_date` + `id` (sin orden, las páginas pueden repetir o saltar filas).
 * - 2026-11-12 (Wave P0/P1 Hardening):
 *   1) Paridad exacta de Capital (`kpi_scorecard` vs `balance_sheet`) y motor de Partida Doble Base Efectivo (`basis === 'Cash'`)
 *      en `balanceAsOf`, `activityBetween` y `equityRollForward`, garantizando `Assets === Liabilities + Equity` y `Debits === Credits` al centavo.
 *   2) Paginación determinista sin truncamiento (`fetchAllTableRows`) en `accounts`, `contacts`, `items`, `reports_archive` y `budgets`.
 *   3) Soporte completo de alias de reportes CPA (`pnl_by_month`, `balance_sheet_comparison`, `estimates_progress`, `payroll_summary`, etc.)
 *      y controles de personalización (`comparePeriod`, `only1099`, `hideZeroRows`, `showCents`).
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import * as XLSX from 'xlsx'
import { jsPDF } from 'jspdf'
import { authorizeExternalAccounting, fetchAllTableRows } from '@/lib/external-accounting-auth'
import {
  buildLedgerContext,
  buildTxnPostings,
  isRawAuthoritative,
  isBalanceSheetAccountType,
  isProfitLossAccount,
  isIncomeAccount,
  isExpenseAccount,
  toNaturalBalance,
  fiscalYearStart,
  dayBefore,
  type Posting,
} from '@/lib/external-accounting-ledger'

export const dynamic = 'force-dynamic'

function formatCurrencyForPdf(n: number, showCents = true): string {
  const raw = Number(n || 0)
  const val = showCents ? raw : Math.round(raw)
  const digits = showCents ? 2 : 0
  const abs = Math.abs(val).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
  return val < 0 ? `-$${abs}` : `$${abs}`
}

function shiftIsoDateByYears(isoDate: string, deltaYears: number): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  const targetYear = y + deltaYears
  const maxDay = new Date(Date.UTC(targetYear, m, 0)).getUTCDate()
  const clampedDay = Math.min(d, maxDay)
  return `${String(targetYear).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(clampedDay).padStart(2, '0')}`
}

function shiftIsoDateByDays(isoDate: string, deltaDays: number): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays))
  return dt.toISOString().slice(0, 10)
}

function computeComparisonDates(
  startDate: string | null,
  endDate: string | null,
  asOfDate: string,
  mode: 'none' | 'previous_period' | 'previous_year'
): { startDate: string | null; endDate: string } | null {
  if (mode === 'none') return null
  const effEnd = endDate || asOfDate
  if (mode === 'previous_year') {
    return {
      startDate: startDate ? shiftIsoDateByYears(startDate, -1) : null,
      endDate: shiftIsoDateByYears(effEnd, -1),
    }
  }
  // previous_period
  if (startDate) {
    const [sy, sm, sd] = startDate.split('-').map(Number)
    const [ey, em, ed] = effEnd.split('-').map(Number)
    const spanDays = Math.max(
      1,
      Math.round((Date.UTC(ey, em - 1, ed) - Date.UTC(sy, sm - 1, sd)) / 86400000) + 1
    )
    return {
      startDate: shiftIsoDateByDays(startDate, -spanDays),
      endDate: shiftIsoDateByDays(startDate, -1),
    }
  }
  // Point-in-time (no startDate): compare against prior month-end / 30 days prior
  return {
    startDate: null,
    endDate: shiftIsoDateByDays(effEnd, -30),
  }
}

function extractReportTableForExport(payload: Record<string, any>): {
  title: string
  subtitle: string
  headers: string[]
  rows: Array<Array<string | number>>
} {
  const rt = String(payload.reportType || 'report')
  const compName = payload.company?.company_name || payload.company?.legal_name || 'Company'
  const basisLabel = payload.basis ? ` (${payload.basis} Basis)` : ''
  const periodLabel = payload.asOfDate
    ? `As of ${payload.asOfDate}`
    : payload.startDate || payload.endDate
    ? `${payload.startDate || 'Beginning'} to ${payload.endDate || 'Today'}`
    : 'All Dates'

  if (rt === 'pnl' && payload.pnl) {
    const p = payload.pnl
    const rows: Array<Array<string | number>> = []
    for (const sec of p.sections || []) {
      rows.push([String(sec.key || '').toUpperCase().replace(/_/g, ' '), ''])
      for (const r of sec.rows || []) {
        const indent = '  '.repeat(Number(r.depth || 0))
        rows.push([`${indent}${r.name || r.category || ''}`, Number(r.amount || 0)])
      }
      rows.push([`Total ${String(sec.key || '').replace(/_/g, ' ')}`, Number(sec.total || 0)])
    }
    rows.push(['Gross Profit', Number(p.grossProfit || 0)])
    rows.push(['Net Operating Income', Number(p.netOperatingIncome || 0)])
    rows.push(['Net Income', Number(p.netIncome || 0)])
    return {
      title: `${compName} — Profit and Loss`,
      subtitle: `${periodLabel}${basisLabel}`,
      headers: ['Account / Line', 'Total (USD)'],
      rows,
    }
  }

  if (rt === 'balance_sheet' && payload.balanceSheet) {
    const bs = payload.balanceSheet
    const rows: Array<Array<string | number>> = []
    const pushTree = (label: string, tree: any[], totalVal: number) => {
      rows.push([label, ''])
      for (const r of tree || []) {
        const indent = '  '.repeat(Number(r.depth || 0) + 1)
        rows.push([`${indent}${r.name || ''}`, Number(r.display_balance ?? r.current_balance ?? 0)])
      }
      rows.push([`Total ${label}`, Number(totalVal || 0)])
    }
    pushTree('Bank Accounts', bs.bankAccountsTree, bs.totalBankAccounts)
    pushTree('Accounts Receivable', bs.accountsReceivableTree, bs.totalAccountsReceivable)
    pushTree('Other Current Assets', bs.otherCurrentAssetsTree, bs.totalOtherCurrentAssets)
    rows.push(['Total Current Assets', Number(bs.totalCurrentAssets || 0)])
    pushTree('Fixed Assets', bs.fixedAssetsTree, bs.totalFixedAssets)
    pushTree('Other Assets', bs.otherAssetsTree, bs.totalOtherAssets)
    rows.push(['TOTAL ASSETS', Number(bs.totalAssets || 0)])
    pushTree('Accounts Payable', bs.accountsPayableTree, bs.totalAccountsPayable)
    pushTree('Credit Cards', bs.creditCardsTree, bs.totalCreditCards)
    pushTree('Other Current Liabilities', bs.otherCurrentLiabilitiesTree, bs.totalOtherCurrentLiabilities)
    rows.push(['Total Current Liabilities', Number(bs.totalCurrentLiabilities || 0)])
    pushTree('Long-Term Liabilities', bs.longTermLiabilitiesTree, bs.totalLongTermLiabilities)
    rows.push(['TOTAL LIABILITIES', Number(bs.totalLiabilities || 0)])
    pushTree('Equity', bs.equityTree, bs.statedEquity)
    rows.push(['Net Income', Number(bs.netIncome || 0)])
    rows.push(['TOTAL EQUITY', Number(bs.totalEquity || 0)])
    rows.push(['TOTAL LIABILITIES AND EQUITY', Number(bs.totalLiabilitiesAndEquity || 0)])
    return {
      title: `${compName} — Balance Sheet`,
      subtitle: `As of ${bs.asOfDate || payload.endDate || ''}`,
      headers: ['Account', 'Balance (USD)'],
      rows,
    }
  }

  if (rt === 'trial_balance' && payload.trialBalance) {
    const tb = payload.trialBalance
    const rows: Array<Array<string | number>> = (tb.rows || []).map((r: any) => [
      r.fully_qualified_name || r.name || '',
      r.account_type || '',
      Number(r.debit || 0),
      Number(r.credit || 0),
    ])
    rows.push(['TOTAL', '', Number(tb.totalDebit || 0), Number(tb.totalCredit || 0)])
    return {
      title: `${compName} — Trial Balance`,
      subtitle: `As of ${tb.asOfDate || ''}`,
      headers: ['Account', 'Type', 'Debit (USD)', 'Credit (USD)'],
      rows,
    }
  }

  if (rt === 'general_ledger' && Array.isArray(payload.generalLedger)) {
    const rows: Array<Array<string | number>> = []
    for (const acc of payload.generalLedger) {
      rows.push([
        acc.account_name || '',
        'Beginning Balance',
        '',
        '',
        '',
        '',
        '',
        Number(acc.beginning_balance || 0),
      ])
      for (const e of acc.entries || []) {
        rows.push([
          acc.account_name || '',
          e.date || e.txn_date || '',
          e.type || e.txn_type || '',
          e.doc || e.doc_number || '',
          e.name || e.entity_name || '',
          e.memo || '',
          Number((e.debit || 0) - (e.credit || 0)),
          Number(e.balance || 0),
        ])
      }
      rows.push([
        `Total ${acc.account_name || ''}`,
        '',
        '',
        '',
        '',
        '',
        Number(acc.net_movement || 0),
        Number(acc.ending_balance || 0),
      ])
    }
    return {
      title: `${compName} — General Ledger`,
      subtitle: periodLabel,
      headers: ['Account', 'Date', 'Type', 'Num', 'Name', 'Memo', 'Amount', 'Balance'],
      rows,
    }
  }

  if ((rt === 'ar_aging' || rt === 'ap_aging') && Array.isArray(payload.rows)) {
    const rows: Array<Array<string | number>> = payload.rows.map((r: any) => [
      r.entity_name || r.name || '',
      Number(r.current || 0),
      Number(r.days1_30 ?? r.days_1_30 ?? 0),
      Number(r.days31_60 ?? r.days_31_60 ?? 0),
      Number(r.days61_90 ?? r.days_61_90 ?? 0),
      Number(r.over90 ?? r.days_91_plus ?? 0),
      Number(r.total || 0),
    ])
    if (payload.totals) {
      const t = payload.totals
      rows.push([
        'TOTAL',
        Number(t.current || 0),
        Number(t.days1_30 ?? t.days_1_30 ?? 0),
        Number(t.days31_60 ?? t.days_31_60 ?? 0),
        Number(t.days61_90 ?? t.days_61_90 ?? 0),
        Number(t.over90 ?? t.days_91_plus ?? 0),
        Number(t.total || 0),
      ])
    }
    return {
      title: `${compName} — ${rt === 'ar_aging' ? 'A/R Aging Summary' : 'A/P Aging Summary'}`,
      subtitle: `As of ${payload.asOfDate || ''}`,
      headers: ['Name', 'Current', '1 - 30', '31 - 60', '61 - 90', '91 and over', 'Total'],
      rows,
    }
  }

  if (rt === 'cash_flow' && payload.cashFlow) {
    const cf = payload.cashFlow
    const rows: Array<Array<string | number>> = [
      ['OPERATING ACTIVITIES', ''],
      ['Net Income', Number(cf.netIncome || 0)],
      ...(cf.operatingAdjustments || []).map((r: any) => [`  ${r.name}`, Number(r.amount || 0)]),
      ['Net cash provided by operating activities', Number(cf.netCashOperating || 0)],
      ['INVESTING ACTIVITIES', ''],
      ...(cf.investingRows || []).map((r: any) => [`  ${r.name}`, Number(r.amount || 0)]),
      ['Net cash provided by investing activities', Number(cf.netCashInvesting || 0)],
      ['FINANCING ACTIVITIES', ''],
      ...(cf.financingRows || []).map((r: any) => [`  ${r.name}`, Number(r.amount || 0)]),
      ['Net cash provided by financing activities', Number(cf.netCashFinancing || 0)],
      ['Net cash increase for period', Number(cf.netCashChange || 0)],
      ['Cash at beginning of period', Number(cf.beginningCash || 0)],
      ['Cash at end of period', Number(cf.endingCash || 0)],
    ]
    return {
      title: `${compName} — Statement of Cash Flows`,
      subtitle: periodLabel,
      headers: ['Activity / Account', 'Amount (USD)'],
      rows,
    }
  }

  if (rt === 'account_quickreport' && payload.quickReport) {
    const qr = payload.quickReport
    const rows: Array<Array<string | number>> = (qr.rows || []).map((r: any) => [
      r.txn_date || '',
      r.txn_type || '',
      r.doc_number || '',
      r.entity_name || '',
      r.account_name || '',
      r.split_account || '',
      r.memo || '',
      Number(r.amount || 0),
      Number(r.running_balance || 0),
    ])
    return {
      title: `${compName} — ${qr.title || 'Transaction Report'}`,
      subtitle: `${qr.subtitle || periodLabel}${basisLabel}`,
      headers: ['Date', 'Type', 'Num', 'Name', 'Account', 'Split', 'Memo', 'Amount', 'Balance'],
      rows,
    }
  }

  if (rt === 'qbo_archive' && payload.archiveReport) {
    const ar = payload.archiveReport
    const headers: string[] =
      Array.isArray(ar.columns) && ar.columns.length > 0 ? ar.columns : ['Account / Line', 'Amount']
    const rows: Array<Array<string | number>> = (ar.rows || []).map((r: any) => {
      if (Array.isArray(r.cells) && r.cells.length > 0) {
        const indent = '  '.repeat(Number(r.depth || 0))
        return [
          `${indent}${String(r.cells[0] ?? '')}`,
          ...r.cells.slice(1).map((c: any) => {
            const num = Number(String(c ?? '').replace(/[,$]/g, ''))
            return Number.isFinite(num) && String(c ?? '').trim() !== '' ? num : String(c ?? '')
          }),
        ]
      }
      return [r.label || r.name || '', Number(r.amount || 0)]
    })
    return {
      title: `${compName} — ${ar.title || 'Official QBO Archive Report'}`,
      subtitle: `${ar.startPeriod || ''} ${ar.endPeriod ? `to ${ar.endPeriod}` : ''} (${ar.basis || 'Accrual'})`.trim(),
      headers,
      rows,
    }
  }

  if (rt === 'sales_tax_liability' && payload.salesTaxLiability) {
    const st = payload.salesTaxLiability
    const rows: Array<Array<string | number>> = (st.rows || []).map((r: any) => [
      r.name || '',
      r.type || '',
      Number(r.gross_sales || 0),
      Number(r.taxable_sales || 0),
      Number(r.tax_collected || 0),
      Number(r.tax_paid || 0),
      Number(r.tax_liability_balance || 0),
    ])
    rows.push([
      'TOTAL',
      '',
      Number(st.totalGrossSales || 0),
      Number(st.totalTaxableSales || 0),
      Number(st.totalTaxCollected || 0),
      Number(st.totalTaxPaid || 0),
      Number(st.endingTaxLiability || 0),
    ])
    return {
      title: `${compName} — Sales Tax Liability Report`,
      subtitle: `${periodLabel}${basisLabel}`,
      headers: ['Account / Agency', 'Type', 'Gross Sales', 'Taxable Sales', 'Tax Collected', 'Tax Paid', 'Liability Balance'],
      rows,
    }
  }

  if (rt === 'inventory_valuation' && payload.inventoryValuation) {
    const iv = payload.inventoryValuation
    const rows: Array<Array<string | number>> = (iv.rows || []).map((r: any) => [
      r.name || '',
      r.item_type || '',
      r.sku || '—',
      Number(r.qty_on_hand || 0),
      Number(r.purchase_cost || 0),
      Number(r.unit_price || 0),
      Number(r.asset_value || 0),
      Number(r.sales_revenue_period || 0),
    ])
    rows.push([
      'TOTAL',
      '',
      '',
      Number(iv.totalQtyOnHand || 0),
      '',
      '',
      Number(iv.totalAssetValue || 0),
      Number(iv.totalPeriodRevenue || 0),
    ])
    return {
      title: `${compName} — Inventory Valuation & Item Summary`,
      subtitle: `As of ${payload.asOfDate || payload.endDate || ''}`,
      headers: ['Product / Service', 'Type', 'SKU', 'Qty on Hand', 'Cost', 'Sales Price', 'Asset Value', 'Period Revenue'],
      rows,
    }
  }

  if (rt === 'budget_vs_actual' && payload.budgetVsActual) {
    const bva = payload.budgetVsActual
    const rows: Array<Array<string | number>> = (bva.rows || []).map((r: any) => [
      r.account_name || '',
      r.account_type || '',
      Number(r.actual_amount || 0),
      Number(r.budget_amount || 0),
      Number(r.variance_amount || 0),
      `${Number(r.pct_of_budget || 0).toFixed(1)}%`,
    ])
    if (bva.totals) {
      rows.push([
        'NET INCOME (ACTUAL VS BUDGET)',
        '',
        Number(bva.totals.actualNetIncome || 0),
        Number(bva.totals.budgetNetIncome || 0),
        Number(bva.totals.varianceNetIncome || 0),
        '',
      ])
    }
    return {
      title: `${compName} — Budget vs. Actuals`,
      subtitle: `${periodLabel} (FY ${bva.fiscalYear || 2026})`,
      headers: ['Account', 'Type', 'Actual (USD)', 'Budget (USD)', 'Over / (Under) Budget', '% of Budget'],
      rows,
    }
  }

  if (rt === 'kpi_scorecard' && payload.kpiScorecard) {
    const ks = payload.kpiScorecard
    const rows: Array<Array<string | number>> = (ks.kpis || []).map((k: any) => [
      k.category || '',
      k.name || '',
      k.formula || '',
      k.formattedValue || String(k.value ?? ''),
      k.benchmark || '',
      k.status || '',
    ])
    return {
      title: `${compName} — Financial KPIs & Ratios Scorecard`,
      subtitle: `${periodLabel}${basisLabel}`,
      headers: ['Category', 'KPI / Ratio', 'Formula', 'Actual Value', 'Benchmark', 'Status'],
      rows,
    }
  }

  const genericRows: any[] =
    payload.rows ||
    payload.entitySummary?.rows ||
    payload.detailReport?.rows ||
    payload.bankRegister?.rows ||
    payload.archiveReport?.rows ||
    []

  const mappedGeneric: Array<Array<string | number>> = genericRows.map((r: any) => {
    if (Array.isArray(r.cells)) return r.cells
    return [
      r.txn_date || r.last_date || r.name || r.vendor_name || '',
      r.txn_type || r.categories || r.tax_id || '',
      r.doc_number || r.count || '',
      r.entity_name || r.name || r.vendor_name || '',
      r.memo || r.account_name || '',
      Number(r.amount ?? r.total_amount ?? r.total_paid ?? r.inflow ?? 0),
    ]
  })

  return {
    title: `${compName} — ${rt.toUpperCase().replace(/_/g, ' ')}`,
    subtitle: `${periodLabel}${basisLabel}`,
    headers: ['Col 1', 'Col 2', 'Col 3', 'Col 4', 'Col 5', 'Amount'],
    rows: mappedGeneric,
  }
}

function generateReportXlsxBuffer(payload: Record<string, any>): Buffer {
  const table = extractReportTableForExport(payload)
  const aoa: Array<Array<string | number>> = [
    [table.title],
    [table.subtitle],
    [],
    table.headers,
    ...table.rows,
  ]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = table.headers.map((_, idx) => ({ wch: idx === 0 ? 42 : 18 }))
  const wb = XLSX.utils.book_new()
  const sheetName = String(payload.reportType || 'Report').slice(0, 31)
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
  return Buffer.isBuffer(buf) ? buf : Buffer.from(buf)
}

function generateReportPdfBuffer(payload: Record<string, any>): Buffer {
  const table = extractReportTableForExport(payload)
  const isWide = table.headers.length > 4
  const doc = new jsPDF({
    orientation: isWide ? 'landscape' : 'portrait',
    unit: 'pt',
    format: 'letter',
  })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const marginX = 36

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.setTextColor(17, 24, 39)
  doc.text(table.title, marginX, 40)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9.5)
  doc.setTextColor(107, 114, 128)
  doc.text(table.subtitle, marginX, 56)

  let y = 76
  const colCount = Math.max(1, table.headers.length)
  const availW = pageW - marginX * 2
  const firstColW = colCount === 2 ? availW * 0.72 : Math.max(130, availW * 0.28)
  const otherColW = colCount > 1 ? (availW - firstColW) / (colCount - 1) : availW

  const drawHeader = () => {
    doc.setFillColor(243, 244, 246)
    doc.rect(marginX, y - 11, availW, 18, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    doc.setTextColor(31, 41, 55)
    let x = marginX + 4
    table.headers.forEach((h, i) => {
      const w = i === 0 ? firstColW : otherColW
      if (i === colCount - 1) {
        doc.text(String(h), x + w - 8, y, { align: 'right' })
      } else {
        doc.text(String(h).slice(0, 28), x, y)
      }
      x += w
    })
    y += 16
  }

  drawHeader()

  for (const row of table.rows) {
    if (y > pageH - 42) {
      doc.addPage()
      y = 44
      drawHeader()
    }
    const firstCell = String(row[0] ?? '')
    const isTotalRow = /^total/i.test(firstCell.trim()) || /^net income/i.test(firstCell.trim()) || /^gross profit/i.test(firstCell.trim())
    doc.setFont('helvetica', isTotalRow ? 'bold' : 'normal')
    doc.setFontSize(8.2)
    doc.setTextColor(17, 24, 39)

    let x = marginX + 4
    row.forEach((cell, i) => {
      const w = i === 0 ? firstColW : otherColW
      const showCentsFlag = payload.customization?.showCents !== false
      const txt = typeof cell === 'number' ? formatCurrencyForPdf(cell, showCentsFlag) : String(cell ?? '')
      if (i === colCount - 1 || typeof cell === 'number') {
        doc.text(txt, x + w - 8, y, { align: 'right' })
      } else {
        doc.text(txt.slice(0, i === 0 ? 52 : 24), x, y)
      }
      x += w
    })
    y += 14
  }

  const out = doc.output('arraybuffer')
  return Buffer.from(out)
}

function respondReport(req: NextRequest, payload: Record<string, any>) {
  const { searchParams } = new URL(req.url)
  const format = (searchParams.get('format') || searchParams.get('export') || '').trim().toLowerCase()
  const safeComp = String(payload.company?.company_name || 'Company').replace(/[^a-zA-Z0-9]+/g, '_')
  const safeRep = String(payload.reportType || 'report').replace(/[^a-zA-Z0-9_]+/g, '_')

  if (!payload.customization) {
    payload.customization = {
      comparePeriod: searchParams.get('comparePeriod') || 'none',
      only1099: searchParams.get('only1099') === 'true' || searchParams.get('only1099') === '1',
      hideZeroRows: searchParams.get('hideZeroRows') === 'true' || searchParams.get('hideZeroRows') === '1',
      showCents: searchParams.get('showCents') !== 'false' && searchParams.get('showCents') !== '0',
      requestedReportType: searchParams.get('reportType') || payload.reportType || 'pnl',
    }
  }

  if (format === 'xlsx') {
    const buf = generateReportXlsxBuffer(payload)
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${safeComp}_${safeRep}.xlsx"`,
      },
    })
  }

  if (format === 'pdf') {
    const buf = generateReportPdfBuffer(payload)
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${safeComp}_${safeRep}.pdf"`,
      },
    })
  }

  return NextResponse.json(payload)
}

function getAdminSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

async function fetchAllTxns(
  supabase: ReturnType<typeof getAdminSupabase>,
  realmId: string,
  startDate?: string | null,
  endDate?: string | null
) {
  const rows: any[] = []
  let from = 0
  const step = 1000
  while (true) {
    let data: any[] | null = null
    let error: any = null
    for (let attempt = 0; attempt < 3; attempt++) {
      let q = supabase
        .from('external_accounting_transactions')
        .select('*')
        .eq('company_realm_id', realmId)
        .order('txn_date', { ascending: true })
        .order('id', { ascending: true })
        .range(from, from + step - 1)

      if (startDate) q = q.gte('txn_date', startDate)
      if (endDate) q = q.lte('txn_date', endDate)

      const res = await q
      data = res.data
      error = res.error
      const errMsg = String(error?.message || '')
      const isTransient = errMsg.includes('<!DOCTYPE html>') || /520|521|522|524|502|503|504|fetch failed|ECONNRESET/i.test(errMsg)
      if (!error || !isTransient || attempt === 2) break
      await new Promise((r) => setTimeout(r, 350 * (attempt + 1)))
    }
    if (error) throw error
    if (!data || data.length === 0) break
    rows.push(...data)
    if (data.length < step) break
    from += step
  }
  return rows
}

function flattenQboReportRows(rows: any[] = [], depth = 0, out: any[] = []): any[] {
  for (const r of rows) {
    if (r.Header?.ColData) {
      out.push({
        rowType: 'section_header',
        depth,
        cells: r.Header.ColData.map((c: any) => c.value ?? '')
      })
    }
    if (r.type === 'Data' && r.ColData) {
      out.push({
        rowType: 'data',
        depth,
        cells: r.ColData.map((c: any) => c.value ?? '')
      })
    }
    if (r.Rows?.Row) {
      flattenQboReportRows(r.Rows.Row, depth + 1, out)
    }
    if (r.Summary?.ColData) {
      out.push({
        rowType: 'summary',
        depth,
        cells: r.Summary.ColData.map((c: any) => c.value ?? '')
      })
    }
  }
  return out
}

export async function GET(req: NextRequest) {
  try {
    const supabase = getAdminSupabase()

    // Strict Backend Authorization (Fail-Closed)
    const auth = await authorizeExternalAccounting(req, supabase)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const { searchParams } = new URL(req.url)

    const realmId = (searchParams.get('realmId') || '').trim()
    const rawReportType = (searchParams.get('reportType') || 'pnl').trim()
    const REPORT_ALIAS_MAP: Record<string, string> = {
      qbo_archive_snapshot: 'qbo_archive',
      pnl_by_month: 'pnl',
      pnl_by_customer: 'pnl',
      pnl_by_class: 'pnl',
      balance_sheet_comparison: 'balance_sheet',
      expenses_by_vendor: 'vendor_expenses',
      payroll_summary: 'vendor_expenses',
      sales_by_customer: 'customer_income',
      sales_by_item: 'inventory_valuation',
      budget_vs_actuals: 'budget_vs_actual',
      budget_overview: 'budget_vs_actual',
      unbilled_charges: 'ar_aging',
      estimates_progress: 'transaction_list_by_date',
      time_activities: 'transaction_list_by_date',
      audit_log: 'transaction_list_by_date',
    }
    const SUPPORTED_REPORT_TYPES = new Set([
      'pnl',
      'pnl_by_month',
      'pnl_by_customer',
      'pnl_by_class',
      'balance_sheet',
      'balance_sheet_comparison',
      'trial_balance',
      'general_ledger',
      'account_quickreport',
      'ar_aging',
      'ap_aging',
      'cash_flow',
      'tax_summary',
      'sales_tax_liability',
      'inventory_valuation',
      'budget_vs_actual',
      'budget_vs_actuals',
      'budget_overview',
      'kpi_scorecard',
      'transaction_list_by_date',
      'bank_register',
      'vendor_expenses',
      'expenses_by_vendor',
      'customer_income',
      'sales_by_customer',
      'sales_by_item',
      'check_detail',
      'deposit_detail',
      'qbo_archive',
      'qbo_archive_snapshot',
      'estimates_progress',
      'unbilled_charges',
      'payroll_summary',
      'time_activities',
      'audit_log',
    ])
    if (!SUPPORTED_REPORT_TYPES.has(rawReportType)) {
      return NextResponse.json(
        { error: `Unsupported reportType: "${rawReportType}".`, code: 'INVALID_REPORT_TYPE' },
        { status: 400 }
      )
    }
    const reportType = REPORT_ALIAS_MAP[rawReportType] || rawReportType
    const startDate = searchParams.get('startDate') ? String(searchParams.get('startDate')).trim() : null
    const endDate = searchParams.get('endDate') ? String(searchParams.get('endDate')).trim() : null
    const rawBasis = (searchParams.get('basis') || searchParams.get('accountingMethod') || 'Accrual').trim()
    const accountId = (searchParams.get('accountId') || 'ALL').trim()
    const qboArchiveKey = (searchParams.get('qboArchiveKey') || searchParams.get('qboReportKey') || searchParams.get('reportKey') || 'ProfitAndLoss_ByYear_Accrual').trim()
    const rawExportFormat = (searchParams.get('format') || searchParams.get('export') || '').trim().toLowerCase()
    const rawCompare = (searchParams.get('comparePeriod') || (rawReportType === 'balance_sheet_comparison' ? 'previous_year' : 'none')).trim().toLowerCase()
    const comparePeriod: 'none' | 'previous_period' | 'previous_year' =
      rawCompare === 'previous_year' || rawCompare === 'py'
        ? 'previous_year'
        : rawCompare === 'previous_period' || rawCompare === 'pp'
        ? 'previous_period'
        : 'none'
    const only1099 = searchParams.get('only1099') === 'true' || searchParams.get('only1099') === '1'
    const hideZeroRows = searchParams.get('hideZeroRows') === 'true' || searchParams.get('hideZeroRows') === '1'
    const showCents = searchParams.get('showCents') !== 'false' && searchParams.get('showCents') !== '0'
    const customizationMeta = { comparePeriod, only1099, hideZeroRows, showCents, requestedReportType: rawReportType }

    if (!realmId) {
      return NextResponse.json({ error: 'Missing realmId' }, { status: 400 })
    }

    if (rawBasis.toLowerCase() !== 'accrual' && rawBasis.toLowerCase() !== 'cash') {
      return NextResponse.json(
        { error: `Invalid accounting basis "${rawBasis}". Must be "Accrual" or "Cash".`, code: 'INVALID_BASIS' },
        { status: 400 }
      )
    }
    const basis: 'Accrual' | 'Cash' = rawBasis.toLowerCase() === 'cash' ? 'Cash' : 'Accrual'

    if (rawExportFormat && !['json', 'xlsx', 'excel', 'pdf'].includes(rawExportFormat)) {
      return NextResponse.json(
        { error: `Invalid export format "${rawExportFormat}". Allowed: json, xlsx, pdf.`, code: 'INVALID_EXPORT_FORMAT' },
        { status: 400 }
      )
    }

    const isValidIsoCalendarDate = (dStr: string): boolean => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dStr)) return false
      const [y, m, d] = dStr.split('-').map(Number)
      if (y < 1970 || y > 2100 || m < 1 || m > 12 || d < 1) return false
      const maxDay = new Date(Date.UTC(y, m, 0)).getUTCDate()
      return d <= maxDay
    }

    if (startDate !== null && startDate !== '' && !isValidIsoCalendarDate(startDate)) {
      return NextResponse.json(
        { error: `Invalid startDate "${startDate}". Expected valid calendar date YYYY-MM-DD.`, code: 'INVALID_START_DATE' },
        { status: 400 }
      )
    }
    if (endDate !== null && endDate !== '' && !isValidIsoCalendarDate(endDate)) {
      return NextResponse.json(
        { error: `Invalid endDate "${endDate}". Expected valid calendar date YYYY-MM-DD.`, code: 'INVALID_END_DATE' },
        { status: 400 }
      )
    }
    if (startDate && endDate && startDate > endDate) {
      return NextResponse.json(
        { error: `Invalid date range: startDate (${startDate}) cannot be after endDate (${endDate}).`, code: 'INVALID_DATE_RANGE' },
        { status: 400 }
      )
    }

    // Fetch company, accounts, contacts, items, and available archive keys (paginated beyond PostgREST 1,000-row cap)
    const [compRes, accRes, conRes, itemsRes, archListRes] = await Promise.all([
      supabase.from('external_accounting_companies').select('*').eq('realm_id', realmId).maybeSingle(),
      fetchAllTableRows(supabase, 'external_accounting_accounts', {
        realmId,
        orders: [{ column: 'name', ascending: true }],
      }),
      fetchAllTableRows(supabase, 'external_accounting_contacts', {
        realmId,
        orders: [{ column: 'display_name', ascending: true }],
      }),
      fetchAllTableRows(supabase, 'external_accounting_items', {
        realmId,
        orders: [{ column: 'name', ascending: true }],
      }),
      fetchAllTableRows(supabase, 'external_accounting_reports_archive', {
        select: 'id, report_key, report_title, accounting_method, start_date, end_date',
        realmId,
        orders: [{ column: 'report_key', ascending: true }],
      }),
    ])

    if (compRes.error) throw compRes.error
    if (accRes.error) throw accRes.error
    if (conRes.error) throw conRes.error
    if (itemsRes.error) throw itemsRes.error
    if (archListRes.error) throw archListRes.error

    const company = compRes.data
    if (!company) {
      return NextResponse.json({ error: `Empresa no encontrada para realmId: ${realmId}` }, { status: 404 })
    }
    const accounts = accRes.data || []
    const contacts = conRes.data || []
    const items = itemsRes.data || []
    const availableArchives = archListRes.data || []

    const accountTypeMap = new Map<string, any>()
    const accountUuidMap = new Map<string, any>()
    const accountNameMap = new Map<string, any>()
    for (const a of accounts) {
      accountTypeMap.set(String(a.qb_account_id), a)
      if (a.id) accountUuidMap.set(String(a.id), a)
      if (a.name) accountNameMap.set(String(a.name).toLowerCase(), a)
      if (a.fully_qualified_name) accountNameMap.set(String(a.fully_qualified_name).toLowerCase(), a)
    }

    if (accountId && accountId !== 'ALL' && !accountId.startsWith('GROUP:')) {
      if (!accountTypeMap.has(accountId) && !accountUuidMap.has(accountId)) {
        return NextResponse.json(
          { error: `Account "${accountId}" not found in company ${realmId}.`, code: 'ACCOUNT_NOT_FOUND' },
          { status: 404 }
        )
      }
    }

    const itemByIdMap = new Map<string, any>()
    const itemByNameMap = new Map<string, any>()
    for (const it of items) {
      itemByIdMap.set(String(it.qb_item_id), it)
      if (it.name) itemByNameMap.set(String(it.name).toLowerCase(), it)
      if (it.fully_qualified_name) itemByNameMap.set(String(it.fully_qualified_name).toLowerCase(), it)
    }

    const BALANCE_SHEET_TYPES = new Set([
      'Bank',
      'Accounts Receivable',
      'Other Current Asset',
      'Fixed Asset',
      'Other Asset',
      'Accounts Payable',
      'Credit Card',
      'Other Current Liability',
      'Long Term Liability',
      'Equity',
    ])

    const isBalanceSheetAccount = (acc: any): boolean => {
      if (!acc) return false
      if (BALANCE_SHEET_TYPES.has(acc.account_type)) return true
      if (['Asset', 'Liability', 'Equity'].includes(acc.classification || '')) return true
      return false
    }

    const resolveLineAccount = (t: any, l: any, mode: 'INCOME' | 'EXPENSE' | 'ANY' = 'ANY'): { acc: any | null; categoryName: string } => {
      // 1. Direct account_qb_id match
      if (l?.account_qb_id && accountTypeMap.has(String(l.account_qb_id))) {
        const acc = accountTypeMap.get(String(l.account_qb_id))
        return { acc, categoryName: acc.fully_qualified_name || acc.name }
      }
      // 2. Item reference (ItemRef -> IncomeAccountRef / ExpenseAccountRef in Chart of Accounts)
      const itemId = l?.item_qb_id || l?.item_id
      const itemName = l?.item_name || l?.account_name
      const matchedItem =
        (itemId && itemByIdMap.get(String(itemId))) ||
        (itemName && itemByNameMap.get(String(itemName).toLowerCase())) ||
        null

      if (matchedItem) {
        const targetAccId =
          mode === 'EXPENSE'
            ? (matchedItem.expense_account_qb_id || matchedItem.income_account_qb_id)
            : (matchedItem.income_account_qb_id || matchedItem.expense_account_qb_id)
        const targetAccName =
          mode === 'EXPENSE'
            ? (matchedItem.expense_account_name || matchedItem.income_account_name)
            : (matchedItem.income_account_name || matchedItem.expense_account_name)

        if (targetAccId && accountTypeMap.has(String(targetAccId))) {
          const acc = accountTypeMap.get(String(targetAccId))
          return { acc, categoryName: acc.fully_qualified_name || acc.name }
        }
        if (targetAccName && accountNameMap.has(String(targetAccName).toLowerCase())) {
          const acc = accountNameMap.get(String(targetAccName).toLowerCase())
          return { acc, categoryName: acc.fully_qualified_name || acc.name }
        }
        if (targetAccName) {
          return { acc: null, categoryName: targetAccName }
        }
      }

      // 3. Direct account_name or fully_qualified_name match in Chart of Accounts
      const rawCat = String(l?.account_name || t?.to_account_name || t?.category_summary || '').trim()
      if (rawCat && accountNameMap.has(rawCat.toLowerCase())) {
        const acc = accountNameMap.get(rawCat.toLowerCase())
        return { acc, categoryName: acc.fully_qualified_name || acc.name }
      }
      // Also check leaf name if rawCat has colon hierarchy (e.g. "Parent:Child")
      if (rawCat.includes(':')) {
        const leaf = rawCat.split(':').pop()?.trim() || ''
        if (leaf && accountNameMap.has(leaf.toLowerCase())) {
          const acc = accountNameMap.get(leaf.toLowerCase())
          return { acc, categoryName: acc.fully_qualified_name || acc.name }
        }
      }

      return { acc: null, categoryName: rawCat || (mode === 'INCOME' ? 'Operating Income' : 'Operating Expense') }
    }

    // -------------------------------------------------------------------------
    // MODE A: OFFICIAL QBO ARCHIVE SNAPSHOT
    // -------------------------------------------------------------------------
    if (reportType === 'qbo_archive') {
      const explicitArchiveKey = (searchParams.get('qboArchiveKey') || searchParams.get('reportKey') || '').trim()
      const effectiveArchiveKey = explicitArchiveKey || qboArchiveKey || availableArchives[0]?.report_key || 'ProfitAndLoss_ByYear_Accrual'

      const { data: arch, error: archErr } = await supabase
        .from('external_accounting_reports_archive')
        .select('*')
        .eq('company_realm_id', realmId)
        .eq('report_key', effectiveArchiveKey)
        .maybeSingle()

      if (archErr) throw archErr

      if (!arch || !arch.report_data) {
        return NextResponse.json(
          {
            error: `Snapshot de archivo QBO "${effectiveArchiveKey}" no encontrado para la empresa ${realmId}.`,
            code: 'ARCHIVE_SNAPSHOT_NOT_FOUND',
            reportType,
            requestedKey: effectiveArchiveKey,
            availableArchives,
          },
          { status: 404 }
        )
      }

      const repData = arch.report_data
      const columns = (repData?.Columns?.Column || []).map((c: any) => c.ColTitle || '')
      const flatRows = flattenQboReportRows(repData?.Rows?.Row || [])

      return respondReport(req, {
        reportType,
        company,
        availableArchives,
        archiveReport: {
          key: arch.report_key,
          title: repData?.Header?.ReportName || arch.report_title,
          basis: repData?.Header?.ReportBasis || arch.accounting_method,
          startPeriod: repData?.Header?.StartPeriod || arch.start_date,
          endPeriod: repData?.Header?.EndPeriod || arch.end_date,
          currency: repData?.Header?.Currency || 'USD',
          columns,
          rows: flatRows,
        }
      })
    }

    // -------------------------------------------------------------------------
    // LIBRO MAYOR (GENERAL LEDGER) EN PARTIDA DOBLE — fuente única de todos los reportes
    // Se carga el historial COMPLETO de la empresa una sola vez y cada transacción se convierte en
    // sus pólizas (`postings`, débito positivo) con `lib/external-accounting-ledger.ts`, igual que QBO.
    // -------------------------------------------------------------------------
    const allTxns = await fetchAllTxns(supabase, realmId)
    const ledgerCtx = buildLedgerContext(accounts, items, allTxns)
    const fiscalStartMonth = company?.metadata?.fiscal_year_start_month || 'January'
    const todayLA = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date())
    const asOfDate = endDate || todayLA
    const inRange = (d: string) => (!startDate || d >= startDate) && (!endDate || d <= endDate)
    const txns = allTxns.filter(t => inRange(String(t.txn_date || '')))
    const activeTxns = txns.filter(t => !t.is_voided)
    const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100

    const postingCache = new Map<string, Posting[]>()
    const postingsOf = (t: any): Posting[] => {
      const key = String(t.id)
      let p = postingCache.get(key)
      if (!p) {
        p = buildTxnPostings(t, ledgerCtx)
        postingCache.set(key, p)
      }
      return p
    }
    const accName = (id: string | null | undefined) => {
      const a = id ? ledgerCtx.accounts.get(String(id)) : null
      return a ? (a.fully_qualified_name || a.name || String(id)) : (id ? String(id) : '—')
    }
    /** QBO "Split" column: the other side of the posting (single account name or "-Split-"). */
    const splitLabel = (t: any, accountId: string) => {
      const others = Array.from(new Set(postingsOf(t).filter(p => p.account_qb_id !== accountId).map(p => p.account_qb_id)))
      if (others.length === 0) return '—'
      if (others.length === 1) return accName(others[0])
      return '-Split-'
    }
    const retainedEarningsIds = new Set(
      accounts.filter((a: any) => a.account_sub_type === 'RetainedEarnings').map((a: any) => String(a.qb_account_id))
    )

    // Precomputed helpers for Cash-Basis Double-Entry Adjustments (Balance Sheet, Trial Balance, P&L Comparison & KPI Scorecard)
    const txnByTypeAndQbId = new Map<string, any>()
    for (const t of allTxns) {
      if (!t.is_voided) txnByTypeAndQbId.set(`${t.qb_entity_type || t.txn_type}:${t.qb_txn_id}`, t)
    }
    const cashUnappliedIncomeAcc = accounts.find((a: any) =>
      a.account_sub_type === 'UnappliedCashPaymentIncome' ||
      String(a.name || '').toLowerCase() === 'unapplied cash payment income'
    )
    const cashUnappliedExpenseAcc = accounts.find((a: any) =>
      a.account_sub_type === 'UnappliedCashBillPaymentExpense' ||
      String(a.name || '').toLowerCase() === 'unapplied cash bill payment expense'
    )
    const extractPaymentLinks = (t: any): Array<{ type: string; id: string; amount: number }> => {
      const raw = t.raw_data
      const out: Array<{ type: string; id: string; amount: number }> = []
      if (isRawAuthoritative(t) && Array.isArray(raw?.Line)) {
        for (const l of raw.Line) {
          if (!Array.isArray(l.LinkedTxn) || l.LinkedTxn.length === 0) continue
          const lineAmt = Number(l.Amount || 0)
          const perLinkAmt = l.LinkedTxn.length === 1 ? lineAmt : lineAmt / l.LinkedTxn.length
          for (const lt of l.LinkedTxn) {
            if (!lt?.TxnId) continue
            out.push({
              type: String(lt.TxnType || (t.txn_type === 'BillPayment' ? 'Bill' : 'Invoice')),
              id: String(lt.TxnId),
              amount: Number(lt.Amount ?? perLinkAmt),
            })
          }
        }
        return out
      }
      for (const l of Array.isArray(t.line_items) ? t.line_items : []) {
        if (Array.isArray(l.linked_txns) && l.linked_txns.length > 0) {
          const lineAmt = Number(l.amount || 0)
          const perLinkAmt = l.linked_txns.length === 1 ? lineAmt : lineAmt / l.linked_txns.length
          for (const lt of l.linked_txns) {
            const ltId = lt.TxnId || lt.linked_txn_id
            if (!ltId) continue
            out.push({
              type: String(lt.TxnType || lt.linked_txn_type || (t.txn_type === 'BillPayment' ? 'Bill' : 'Invoice')),
              id: String(ltId),
              amount: Number(lt.Amount ?? lt.amount ?? perLinkAmt),
            })
          }
        } else if (l.linked_txn_id) {
          out.push({
            type: String(l.linked_txn_type || (t.txn_type === 'BillPayment' ? 'Bill' : 'Invoice')),
            id: String(l.linked_txn_id),
            amount: Number(l.amount || 0),
          })
        }
      }
      return out
    }

    const ACCRUAL_OPEN_DOC_TYPES = new Set(['Invoice', 'CreditMemo', 'Bill', 'VendorCredit'])
    const cashDeltaCache = new Map<string, Map<string, number>>()

    /**
     * Computes a strictly zero-sum (penny-balanced) Cash-Basis adjustment map as of `cutoffDate`.
     * 1) Reverses unsettled fractions of Invoices, Credit Memos, Bills & Vendor Credits dated <= cutoffDate.
     * 2) Reclassifies unapplied/prepaid Payment & BillPayment balances out of A/R or A/P into
     *    Unapplied Cash Payment Income / Unapplied Cash Bill Payment Expense when present in CoA.
     * Because every adjustment entry sums to 0.00 across its legs, Assets === Liabilities + Equity
     * and Trial Balance Debits === Credits hold to $0.00 identically.
     */
    const computeCashBasisDeltaAsOf = (cutoffDate: string | null): Map<string, number> => {
      if (basis !== 'Cash') return new Map<string, number>()
      const effCutoff = cutoffDate || '9999-12-31'
      const cached = cashDeltaCache.get(effCutoff)
      if (cached) return cached

      const delta = new Map<string, number>()
      const addDelta = (accId: string, amt: number) => {
        if (!accId || amt === 0) return
        delta.set(accId, r2((delta.get(accId) || 0) + amt))
      }

      const settledBySrcUuid = new Map<string, number>()

      for (const t of allTxns) {
        if (t.is_voided || t.direction === 'NON_POSTING') continue
        if (t.txn_type !== 'Payment' && t.txn_type !== 'BillPayment') continue
        const payDate = String(t.txn_date || '')
        if (payDate > effCutoff) continue

        const isBillPay = t.txn_type === 'BillPayment'
        const tLinks = extractPaymentLinks(t)
        let appliedValid = 0
        let prepaidFuture = 0

        for (const link of tLinks) {
          const src = txnByTypeAndQbId.get(`${link.type}:${link.id}`)
          if (!src || src.is_voided) continue
          const linkAbs = Math.abs(Number(link.amount || 0))
          if (linkAbs <= 0) continue
          appliedValid = r2(appliedValid + linkAbs)
          const srcDate = String(src.txn_date || '')
          if (srcDate <= effCutoff) {
            settledBySrcUuid.set(String(src.id), r2((settledBySrcUuid.get(String(src.id)) || 0) + linkAbs))
          } else {
            prepaidFuture = r2(prepaidFuture + linkAbs)
          }
        }

        const totalPayAmt = Math.abs(Number(t.total_amount || 0))
        const unappliedRem = r2(Math.max(0, totalPayAmt - appliedValid))
        const cashPrepaidOrUnapplied = r2(prepaidFuture + unappliedRem)

        if (cashPrepaidOrUnapplied >= 0.01) {
          const unappliedAcc = isBillPay ? cashUnappliedExpenseAcc : cashUnappliedIncomeAcc
          const arApPosting = postingsOf(t).find((p) => {
            const pAcc = ledgerCtx.accounts.get(p.account_qb_id)
            return isBillPay ? pAcc?.account_type === 'Accounts Payable' : pAcc?.account_type === 'Accounts Receivable'
          })
          if (unappliedAcc && arApPosting) {
            const arApAdj = r2(isBillPay ? -cashPrepaidOrUnapplied : cashPrepaidOrUnapplied)
            addDelta(arApPosting.account_qb_id, arApAdj)
            addDelta(String(unappliedAcc.qb_account_id), r2(-arApAdj))
          }
        }
      }

      for (const s of allTxns) {
        if (s.is_voided || s.direction === 'NON_POSTING') continue
        if (!ACCRUAL_OPEN_DOC_TYPES.has(String(s.txn_type))) continue
        const srcDate = String(s.txn_date || '')
        if (srcDate > effCutoff) continue

        const sPostings = postingsOf(s)
        if (sPostings.length === 0) continue
        const headerIdx = Math.max(0, sPostings.findIndex((p) => p.is_header))
        const srcTotal = Math.abs(Number(s.total_amount || sPostings[headerIdx]?.amount || 0))
        if (srcTotal < 0.005) continue

        const settled = Math.min(srcTotal, settledBySrcUuid.get(String(s.id)) || 0)
        const unsettledRatio = Math.max(0, Math.min(1, (srcTotal - settled) / srcTotal))
        if (unsettledRatio < 1e-7) continue

        let nonHeaderSum = 0
        for (let i = 0; i < sPostings.length; i++) {
          if (i === headerIdx) continue
          const leg = r2(-unsettledRatio * sPostings[i].amount)
          addDelta(sPostings[i].account_qb_id, leg)
          nonHeaderSum = r2(nonHeaderSum + leg)
        }
        const headerLeg = r2(-nonHeaderSum)
        addDelta(sPostings[headerIdx].account_qb_id, headerLeg)
      }

      cashDeltaCache.set(effCutoff, delta)
      return delta
    }

    /** Balance Sheet balances (debit-positive) as of `date`, supporting both Accrual and QBO Cash Basis. */
    const balanceAsOf = (date: string | null): Map<string, number> => {
      const m = new Map<string, number>()
      for (const a of accounts) m.set(String(a.qb_account_id), Number(a.current_balance || 0))
      if (date) {
        for (const t of allTxns) {
          if (t.is_voided || !(String(t.txn_date || '') > date)) continue
          for (const p of postingsOf(t)) {
            if (m.has(p.account_qb_id)) m.set(p.account_qb_id, r2((m.get(p.account_qb_id) || 0) - p.amount))
          }
        }
      }
      if (basis === 'Cash') {
        const cashDelta = computeCashBasisDeltaAsOf(date)
        for (const [accId, dAmt] of cashDelta.entries()) {
          m.set(accId, r2((m.get(accId) || 0) + dAmt))
        }
      }
      return m
    }

    /** Sum of postings (debit-positive) per account between two dates (inclusive; null = open), supporting Accrual and Cash Basis. */
    const activityBetween = (from: string | null, to: string | null): Map<string, number> => {
      const m = new Map<string, number>()
      for (const t of allTxns) {
        const d = String(t.txn_date || '')
        if (t.is_voided || (from && d < from) || (to && d > to)) continue
        for (const p of postingsOf(t)) m.set(p.account_qb_id, r2((m.get(p.account_qb_id) || 0) + p.amount))
      }
      if (basis === 'Cash') {
        const deltaTo = computeCashBasisDeltaAsOf(to)
        const deltaBeforeFrom = from ? computeCashBasisDeltaAsOf(dayBefore(from)) : new Map<string, number>()
        const touchedIds = new Set<string>([...deltaTo.keys(), ...deltaBeforeFrom.keys()])
        for (const accId of touchedIds) {
          const netDelta = r2((deltaTo.get(accId) || 0) - (deltaBeforeFrom.get(accId) || 0))
          if (netDelta !== 0) m.set(accId, r2((m.get(accId) || 0) + netDelta))
        }
      }
      return m
    }

    /**
     * QBO equity roll-forward as of `date` (Accrual and Cash Basis):
     * - Net Income = fiscal-year-to-date P&L.
     * - Retained Earnings = all P&L of prior fiscal years + entries posted directly to Retained Earnings.
     */
    const equityRollForward = (date: string) => {
      const fys = fiscalYearStart(date, fiscalStartMonth)
      let plBefore = 0
      let plYtd = 0
      let rePosted = 0
      for (const t of allTxns) {
        const d = String(t.txn_date || '')
        if (t.is_voided || d > date) continue
        for (const p of postingsOf(t)) {
          const acc = ledgerCtx.accounts.get(p.account_qb_id)
          if (isProfitLossAccount(acc)) {
            if (d < fys) plBefore += p.amount
            else plYtd += p.amount
          }
          if (retainedEarningsIds.has(p.account_qb_id)) rePosted += p.amount
        }
      }
      plBefore = r2(plBefore)
      plYtd = r2(plYtd)
      rePosted = r2(rePosted)

      if (basis === 'Cash') {
        const prevFyEnd = dayBefore(fys)
        const deltaPrevFy = computeCashBasisDeltaAsOf(prevFyEnd)
        const deltaAsOf = computeCashBasisDeltaAsOf(date)
        const allTouched = new Set<string>([...deltaPrevFy.keys(), ...deltaAsOf.keys()])
        for (const accId of allTouched) {
          const acc = ledgerCtx.accounts.get(accId)
          const dPrev = deltaPrevFy.get(accId) || 0
          const dEnd = deltaAsOf.get(accId) || 0
          if (isProfitLossAccount(acc)) {
            plBefore = r2(plBefore + dPrev)
            plYtd = r2(plYtd + (dEnd - dPrev))
          }
          if (retainedEarningsIds.has(accId)) {
            rePosted = r2(rePosted + dEnd)
          }
        }
      }

      return {
        fiscalYearStart: fys,
        netIncome: r2(-plYtd),
        retainedEarnings: r2(-(plBefore + rePosted)),
        retainedEarningsDebitPositive: r2(plBefore + rePosted),
      }
    }

    // Backwards-compatible helper used by the drill-down engine
    const computeBalancesAsOfEndDate = async (): Promise<Map<string, number>> => balanceAsOf(endDate)

    /** Builds a QBO-style transaction row for a posting (amount already in presentation sign). */
    const postingRow = (t: any, p: Posting, amount: number, accountId: string) => ({
      id: t.id,
      qb_txn_id: t.qb_txn_id,
      txn_date: t.txn_date,
      txn_type: t.txn_type,
      doc_number: t.doc_number || '',
      entity_name: p.entity_name || t.entity_name || '—',
      department_name: p.department_name || t.department_name || '',
      location_name: p.department_name || t.department_name || '',
      class_name: p.class_name || t.class_name || '',
      memo: p.memo || t.memo || '',
      account_qb_id: t.account_qb_id || accountId,
      account_name: accName(accountId),
      to_account_qb_id: t.to_account_qb_id || null,
      to_account_name: t.to_account_name || null,
      category_summary: t.category_summary || splitLabel(t, accountId),
      split_account: splitLabel(t, accountId),
      item_name: p.item_name || '',
      amount: r2(amount),
      total_amount: r2(Number(t.total_amount ?? Math.abs(amount))),
      line_items: Array.isArray(t.line_items) ? t.line_items : [],
      payment_method: t.payment_type || '',
      is_voided: Boolean(t.is_voided),
      year: String(t.txn_date || '').slice(0, 4),
      cleared_status: t.cleared_status || 'Cleared',
    })

    /**
     * Unified Accrual / Cash P&L posting iterator used by P&L, Expenses by Vendor, and Income by Customer.
     * Implements QBO Cash-Basis recognition, including prepayment recognition/reversal on
     * Unapplied Cash Payment Income / Unapplied Cash Bill Payment Expense when payDate < srcDate.
     */
    const forEachPlPosting = (cb: (acc: any, p: Posting, effectiveTxn: any, sourceTxn?: any) => void) => {
      if (basis === 'Cash') {
        const byKey = new Map<string, any>()
        for (const t of allTxns) byKey.set(`${t.qb_entity_type || t.txn_type}:${t.qb_txn_id}`, t)
        const NON_CASH = new Set(['Invoice', 'CreditMemo', 'Bill', 'VendorCredit', 'Estimate', 'PurchaseOrder'])
        const unappliedIncomeAcc = accounts.find((a: any) =>
          a.account_sub_type === 'UnappliedCashPaymentIncome' ||
          String(a.name || '').toLowerCase() === 'unapplied cash payment income'
        )
        const unappliedExpenseAcc = accounts.find((a: any) =>
          a.account_sub_type === 'UnappliedCashBillPaymentExpense' ||
          String(a.name || '').toLowerCase() === 'unapplied cash bill payment expense'
        )
        const linksOf = (t: any): Array<{ type: string; id: string; amount: number }> => {
          const raw = t.raw_data
          const out: Array<{ type: string; id: string; amount: number }> = []
          if (isRawAuthoritative(t) && Array.isArray(raw?.Line)) {
            for (const l of raw.Line) {
              if (!Array.isArray(l.LinkedTxn) || l.LinkedTxn.length === 0) continue
              const lineAmt = Number(l.Amount || 0)
              const perLinkAmt = l.LinkedTxn.length === 1 ? lineAmt : lineAmt / l.LinkedTxn.length
              for (const lt of l.LinkedTxn) {
                if (!lt?.TxnId) continue
                out.push({
                  type: String(lt.TxnType || (t.txn_type === 'BillPayment' ? 'Bill' : 'Invoice')),
                  id: String(lt.TxnId),
                  amount: Number(lt.Amount ?? perLinkAmt),
                })
              }
            }
            return out
          }
          for (const l of Array.isArray(t.line_items) ? t.line_items : []) {
            if (Array.isArray(l.linked_txns) && l.linked_txns.length > 0) {
              const lineAmt = Number(l.amount || 0)
              const perLinkAmt = l.linked_txns.length === 1 ? lineAmt : lineAmt / l.linked_txns.length
              for (const lt of l.linked_txns) {
                const ltId = lt.TxnId || lt.linked_txn_id
                if (!ltId) continue
                out.push({
                  type: String(lt.TxnType || lt.linked_txn_type || (t.txn_type === 'BillPayment' ? 'Bill' : 'Invoice')),
                  id: String(ltId),
                  amount: Number(lt.Amount ?? lt.amount ?? perLinkAmt),
                })
              }
            } else if (l.linked_txn_id) {
              out.push({
                type: String(l.linked_txn_type || (t.txn_type === 'BillPayment' ? 'Bill' : 'Invoice')),
                id: String(l.linked_txn_id),
                amount: Number(l.amount || 0),
              })
            }
          }
          return out
        }
        // 1. Direct cash transactions in active date range
        for (const t of activeTxns) {
          if (NON_CASH.has(t.txn_type) || t.txn_type === 'Payment' || t.txn_type === 'BillPayment' || t.direction === 'NON_POSTING') continue
          for (const p of postingsOf(t)) {
            const acc = ledgerCtx.accounts.get(p.account_qb_id)
            if (isProfitLossAccount(acc)) cb(acc, p, t)
          }
        }
        // 2. Payments & BillPayments across allTxns (handles normal payDate >= srcDate, prepayments payDate < srcDate, and unapplied cash payments)
        for (const t of allTxns) {
          if (t.is_voided || t.direction === 'NON_POSTING') continue
          if (t.txn_type !== 'Payment' && t.txn_type !== 'BillPayment') continue
          const payDate = String(t.txn_date || '')
          const isBillPay = t.txn_type === 'BillPayment'
          const unappliedAcc = isBillPay ? unappliedExpenseAcc : unappliedIncomeAcc
          const tLinks = linksOf(t)
          let appliedSum = 0
          for (const link of tLinks) {
            const src = byKey.get(`${link.type}:${link.id}`)
            if (!src || src.is_voided) continue
            appliedSum = r2(appliedSum + Number(link.amount || 0))
            const srcDate = String(src.txn_date || '')
            const srcTotal = Number(src.total_amount || 0)
            if (!srcTotal || !link.amount) continue
            const ratio = link.amount / srcTotal
            if (payDate >= srcDate) {
              if (!inRange(payDate)) continue
              for (const p of postingsOf(src)) {
                const acc = ledgerCtx.accounts.get(p.account_qb_id)
                if (!isProfitLossAccount(acc)) continue
                cb(acc, { ...p, amount: p.amount * ratio }, t, src)
              }
            } else {
              // Prepayment (payDate < srcDate): QBO books Unapplied Cash Payment Income on payDate,
              // then reverses it and recognizes the invoice/bill P&L lines on srcDate.
              if (inRange(payDate) && unappliedAcc) {
                const entName = src.entity_name || t.entity_name || null
                const entId = src.entity_id || t.entity_id || null
                cb(unappliedAcc, {
                  account_qb_id: String(unappliedAcc.qb_account_id),
                  amount: isBillPay ? link.amount : -link.amount,
                  line_index: 0,
                  is_header: false,
                  memo: String(t.memo || src.memo || ''),
                  entity_type: isBillPay ? 'Vendor' : 'Customer',
                  entity_qb_id: entId ? String(entId) : null,
                  entity_name: entName ? String(entName) : null,
                  customer_qb_id: !isBillPay && entId ? String(entId) : null,
                  customer_name: !isBillPay && entName ? String(entName) : null,
                  department_qb_id: t.department_id || src.department_id || null,
                  department_name: t.department_name || src.department_name || null,
                  class_qb_id: t.class_id || src.class_id || null,
                  class_name: t.class_name || src.class_name || null,
                  item_name: null,
                }, t, src)
              }
              if (inRange(srcDate)) {
                for (const p of postingsOf(src)) {
                  const acc = ledgerCtx.accounts.get(p.account_qb_id)
                  if (!isProfitLossAccount(acc)) continue
                  cb(acc, { ...p, amount: p.amount * ratio }, src, t)
                }
                if (unappliedAcc) {
                  const entName = src.entity_name || t.entity_name || null
                  const entId = src.entity_id || t.entity_id || null
                  cb(unappliedAcc, {
                    account_qb_id: String(unappliedAcc.qb_account_id),
                    amount: isBillPay ? -link.amount : link.amount,
                    line_index: 0,
                    is_header: false,
                    memo: String(src.memo || t.memo || ''),
                    entity_type: isBillPay ? 'Vendor' : 'Customer',
                    entity_qb_id: entId ? String(entId) : null,
                    entity_name: entName ? String(entName) : null,
                    customer_qb_id: !isBillPay && entId ? String(entId) : null,
                    customer_name: !isBillPay && entName ? String(entName) : null,
                    department_qb_id: src.department_id || t.department_id || null,
                    department_name: src.department_name || t.department_name || null,
                    class_qb_id: src.class_id || t.class_id || null,
                    class_name: src.class_name || t.class_name || null,
                    item_name: null,
                  }, src, t)
                }
              }
            }
          }

          // Unapplied payment balance (Payment or BillPayment with no LinkedTxn or partial LinkedTxn)
          const totalPayAmt = Number(t.total_amount || 0)
          const unappliedRem = r2(Math.max(0, totalPayAmt - appliedSum))
          if (unappliedRem >= 0.01 && inRange(payDate) && unappliedAcc) {
            const entName = t.entity_name || null
            const entId = t.entity_qb_id || t.entity_id || null
            cb(unappliedAcc, {
              account_qb_id: String(unappliedAcc.qb_account_id),
              amount: isBillPay ? unappliedRem : -unappliedRem,
              line_index: 0,
              is_header: false,
              memo: String(t.memo || `Unapplied ${t.txn_type}`),
              entity_type: isBillPay ? 'Vendor' : 'Customer',
              entity_qb_id: entId ? String(entId) : null,
              entity_name: entName ? String(entName) : null,
              customer_qb_id: !isBillPay && entId ? String(entId) : null,
              customer_name: !isBillPay && entName ? String(entName) : null,
              department_qb_id: t.department_qb_id || t.department_id || null,
              department_name: t.department_name || null,
              class_qb_id: t.class_qb_id || t.class_id || null,
              class_name: t.class_name || null,
              item_name: null,
            }, t)
          }
        }
      } else {
        for (const t of activeTxns) {
          for (const p of postingsOf(t)) {
            const acc = ledgerCtx.accounts.get(p.account_qb_id)
            if (isProfitLossAccount(acc)) cb(acc, p, t)
          }
        }
      }
    }

    // -------------------------------------------------------------------------
    // 1. PROFIT & LOSS (ESTADO DE RESULTADOS) — ESTRUCTURA QBO + DRILL-DOWN POR RENGLÓN
    //    Income · Cost of Goods Sold · Gross Profit · Expenses · Net Operating Income ·
    //    Other Income · Other Expenses · Net Other Income · Net Income
    // -------------------------------------------------------------------------
    if (reportType === 'pnl') {
      type PnlSectionKey = 'income' | 'cogs' | 'expenses' | 'other_income' | 'other_expenses'
      const sectionOf = (acc: any): PnlSectionKey => {
        switch (acc?.account_type) {
          case 'Income': return 'income'
          case 'Other Income': return 'other_income'
          case 'Cost of Goods Sold': return 'cogs'
          case 'Other Expense': return 'other_expenses'
          default: return isIncomeAccount(acc) ? 'income' : 'expenses'
        }
      }
      const rowsByAcc = new Map<string, {
        category: string
        name: string
        account_qb_id: string
        parent_qb_id: string | null
        account_type: string
        section: PnlSectionKey
        amount: number
        count: number
        byYear: Record<string, number>
        transactions: any[]
      }>()
      const yearsSet = new Set<string>()

      const addPl = (acc: any, naturalAmt: number, t: any, p: Posting, sourceTxn?: any) => {
        if (!acc || Math.abs(naturalAmt) < 0.000001) return
        const id = String(acc.qb_account_id)
        const yr = String(t.txn_date || '').slice(0, 4) || 'Unknown'
        yearsSet.add(yr)
        let row = rowsByAcc.get(id)
        if (!row) {
          row = {
            category: acc.fully_qualified_name || acc.name || id,
            name: acc.name || acc.fully_qualified_name || id,
            account_qb_id: id,
            parent_qb_id: acc.parent_qb_id ? String(acc.parent_qb_id) : null,
            account_type: acc.account_type || '',
            section: sectionOf(acc),
            amount: 0,
            count: 0,
            byYear: {},
            transactions: [],
          }
          rowsByAcc.set(id, row)
        }
        row.amount = r2(row.amount + naturalAmt)
        row.count++
        row.byYear[yr] = r2((row.byYear[yr] || 0) + naturalAmt)
        const txRow = postingRow(sourceTxn || t, p, naturalAmt, id)
        if (sourceTxn) {
          // Cash basis: recognized on the payment date, document comes from the invoice/bill
          txRow.txn_date = t.txn_date
          txRow.year = yr
          txRow.memo = `${t.txn_type} ${t.doc_number || ''} → ${sourceTxn.txn_type} #${sourceTxn.doc_number || sourceTxn.qb_txn_id}`.trim()
        }
        row.transactions.push(txRow)
      }
      const naturalOf = (acc: any, p: Posting) => (isIncomeAccount(acc) ? -p.amount : p.amount)

      forEachPlPosting((acc, p, t, src) => {
        addPl(acc, naturalOf(acc, p), t, p, src)
      })

      const years = Array.from(yearsSet).sort()
      const finalize = (r: any) => {
        let run = 0
        const txnsWithRun = r.transactions
          .sort((a: any, b: any) => String(a.txn_date).localeCompare(String(b.txn_date)))
          .map((tx: any) => {
            run = r2(run + Number(tx.amount || 0))
            return { ...tx, running_balance: run }
          })
        for (const y of Object.keys(r.byYear)) r.byYear[y] = r2(r.byYear[y])
        return { ...r, amount: r2(r.amount), transactions: txnsWithRun }
      }
      const allRows = Array.from(rowsByAcc.values()).map(finalize)

      /** QBO hierarchy: parent account row, indented sub-accounts and a "Total <parent>" row. */
      const buildSection = (key: PnlSectionKey) => {
        const rows = allRows.filter(r => r.section === key)
        const rowIds = new Set(rows.map(r => r.account_qb_id))
        const parentIds = new Set<string>()
        for (const r of rows) {
          let pid = r.parent_qb_id
          while (pid) {
            parentIds.add(pid)
            pid = ledgerCtx.accounts.get(pid)?.parent_qb_id ? String(ledgerCtx.accounts.get(pid)!.parent_qb_id) : null
          }
        }
        // Parent accounts without own amount still appear as headers (like QBO)
        for (const pid of parentIds) {
          if (rowIds.has(pid)) continue
          const acc = ledgerCtx.accounts.get(pid)
          if (!acc) continue
          rows.push({
            category: acc.fully_qualified_name || acc.name || pid,
            name: acc.name || pid,
            account_qb_id: pid,
            parent_qb_id: acc.parent_qb_id ? String(acc.parent_qb_id) : null,
            account_type: acc.account_type || '',
            section: key,
            amount: 0,
            count: 0,
            byYear: {},
            transactions: [],
          })
        }
        const children = new Map<string | null, any[]>()
        for (const r of rows) {
          const k = r.parent_qb_id && rows.some(x => x.account_qb_id === r.parent_qb_id) ? r.parent_qb_id : null
          if (!children.has(k)) children.set(k, [])
          children.get(k)!.push(r)
        }
        for (const list of children.values()) list.sort((a, b) => String(a.name).localeCompare(String(b.name)))
        const display: any[] = []
        const walk = (parentKey: string | null, depth: number): { amount: number; byYear: Record<string, number>; transactions: any[] } => {
          const agg = { amount: 0, byYear: {} as Record<string, number>, transactions: [] as any[] }
          for (const r of children.get(parentKey) || []) {
            const kids = children.get(r.account_qb_id) || []
            display.push({ kind: kids.length > 0 ? 'parent' : 'account', depth, ...r })
            let subtotal = { amount: r.amount, byYear: { ...r.byYear }, transactions: [...r.transactions] }
            if (kids.length > 0) {
              const k = walk(r.account_qb_id, depth + 1)
              subtotal = {
                amount: r2(r.amount + k.amount),
                byYear: Object.fromEntries(Array.from(new Set([...Object.keys(r.byYear), ...Object.keys(k.byYear)])).map(y => [y, r2((r.byYear[y] || 0) + (k.byYear[y] || 0))])),
                transactions: [...r.transactions, ...k.transactions],
              }
              display.push({
                kind: 'total',
                depth,
                category: `Total ${r.name}`,
                name: `Total ${r.name}`,
                account_qb_id: r.account_qb_id,
                section: key,
                amount: subtotal.amount,
                byYear: subtotal.byYear,
                transactions: subtotal.transactions,
              })
            }
            agg.amount = r2(agg.amount + subtotal.amount)
            for (const [y, v] of Object.entries(subtotal.byYear)) agg.byYear[y] = r2((agg.byYear[y] || 0) + Number(v))
            agg.transactions.push(...subtotal.transactions)
          }
          return agg
        }
        const totals = walk(null, 0)
        return { key, rows: display, total: totals.amount, byYear: totals.byYear, transactions: totals.transactions }
      }

      const sIncome = buildSection('income')
      const sCogs = buildSection('cogs')
      const sExpenses = buildSection('expenses')
      const sOtherIncome = buildSection('other_income')
      const sOtherExpenses = buildSection('other_expenses')
      const byYearCombine = (fn: (y: string) => number) => Object.fromEntries(years.map(y => [y, r2(fn(y))]))
      const yv = (s: { byYear: Record<string, number> }, y: string) => Number(s.byYear[y] || 0)

      const totalIncome = sIncome.total
      const totalCogs = sCogs.total
      const grossProfit = r2(totalIncome - totalCogs)
      const totalExpenses = sExpenses.total
      const netOperatingIncome = r2(grossProfit - totalExpenses)
      const totalOtherIncome = sOtherIncome.total
      const totalOtherExpenses = sOtherExpenses.total
      const netOtherIncome = r2(totalOtherIncome - totalOtherExpenses)
      const netIncome = r2(netOperatingIncome + netOtherIncome)

      const compDates = computeComparisonDates(startDate, endDate, asOfDate, comparePeriod)
      const compActMap = compDates ? activityBetween(compDates.startDate, compDates.endDate) : null

      const enrichPnlSection = (sec: any) => {
        const filteredRows = hideZeroRows
          ? sec.rows.filter((r: any) => r.kind !== 'account' || Math.abs(Number(r.amount || 0)) >= 0.005)
          : sec.rows
        if (!compActMap) return { ...sec, rows: filteredRows }

        // Compute prior amount per account + parent rollups
        const priorOwn = (accId: string) => {
          const acc = ledgerCtx.accounts.get(accId)
          const dp = compActMap.get(accId) || 0
          return r2(isIncomeAccount(acc) ? -dp : dp)
        }
        const rowsWithComp = filteredRows.map((r: any) => {
          let pAmt = priorOwn(String(r.account_qb_id))
          if (r.kind === 'total') {
            // Sum all descendant accounts in this section whose parent chain includes r.account_qb_id
            pAmt = 0
            for (const cand of allRows) {
              if (cand.section !== sec.key) continue
              let cur: string | null = cand.account_qb_id
              while (cur) {
                if (cur === r.account_qb_id) {
                  pAmt = r2(pAmt + priorOwn(cand.account_qb_id))
                  break
                }
                cur = ledgerCtx.accounts.get(cur)?.parent_qb_id ? String(ledgerCtx.accounts.get(cur)!.parent_qb_id) : null
              }
            }
          }
          const deltaAmt = r2(Number(r.amount || 0) - pAmt)
          const deltaPct = Math.abs(pAmt) >= 0.005 ? r2((deltaAmt / Math.abs(pAmt)) * 100) : null
          return { ...r, prior_amount: pAmt, delta_amount: deltaAmt, delta_pct: deltaPct }
        })
        let secPriorTotal = 0
        for (const acc of accounts) {
          if (!isProfitLossAccount(acc)) continue
          const secKey = sectionOf(acc)
          if (secKey !== sec.key) continue
          secPriorTotal = r2(secPriorTotal + priorOwn(String(acc.qb_account_id)))
        }
        return {
          ...sec,
          rows: rowsWithComp,
          priorTotal: secPriorTotal,
          deltaAmount: r2(sec.total - secPriorTotal),
          deltaPct: Math.abs(secPriorTotal) >= 0.005 ? r2(((sec.total - secPriorTotal) / Math.abs(secPriorTotal)) * 100) : null,
        }
      }

      const esIncome = enrichPnlSection(sIncome)
      const esCogs = enrichPnlSection(sCogs)
      const esExpenses = enrichPnlSection(sExpenses)
      const esOtherIncome = enrichPnlSection(sOtherIncome)
      const esOtherExpenses = enrichPnlSection(sOtherExpenses)

      const pnlComparison = compDates
        ? (() => {
            const pInc = Number(esIncome.priorTotal || 0)
            const pCogs = Number(esCogs.priorTotal || 0)
            const pGross = r2(pInc - pCogs)
            const pExp = Number(esExpenses.priorTotal || 0)
            const pOpInc = r2(pGross - pExp)
            const pOthInc = Number(esOtherIncome.priorTotal || 0)
            const pOthExp = Number(esOtherExpenses.priorTotal || 0)
            const pNet = r2(pOpInc + pOthInc - pOthExp)
            const dNet = r2(netIncome - pNet)
            return {
              mode: comparePeriod,
              startDate: compDates.startDate,
              endDate: compDates.endDate,
              totalIncome: pInc,
              totalCogs: pCogs,
              grossProfit: pGross,
              totalExpenses: pExp,
              netOperatingIncome: pOpInc,
              totalOtherIncome: pOthInc,
              totalOtherExpenses: pOthExp,
              netIncome: pNet,
              deltaAmount: dNet,
              deltaPct: Math.abs(pNet) >= 0.005 ? r2((dNet / Math.abs(pNet)) * 100) : null,
            }
          })()
        : null

      const flatAccounts = (s: any) =>
        s.rows.filter(
          (r: any) =>
            r.kind !== 'total' &&
            (hideZeroRows ? Math.abs(Number(r.amount || 0)) >= 0.005 : r.amount !== 0 || r.transactions.length > 0)
        )

      return respondReport(req, {
        reportType,
        company,
        basis,
        startDate,
        endDate,
        customization: customizationMeta,
        availableArchives,
        pnl: {
          years,
          comparison: pnlComparison,
          sections: [esIncome, esCogs, esExpenses, esOtherIncome, esOtherExpenses],
          // Back-compat flat lists (all income-type rows / all expense-type rows)
          incomeRows: [...flatAccounts(sIncome), ...flatAccounts(sOtherIncome)],
          expenseRows: [...flatAccounts(sCogs), ...flatAccounts(sExpenses), ...flatAccounts(sOtherExpenses)],
          totalIncome,
          totalCogs,
          grossProfit,
          totalExpenses,
          netOperatingIncome,
          totalOtherIncome,
          totalOtherExpenses,
          netOtherIncome,
          netIncome,
          incomeByYear: sIncome.byYear,
          cogsByYear: sCogs.byYear,
          grossProfitByYear: byYearCombine(y => yv(sIncome, y) - yv(sCogs, y)),
          expenseByYear: sExpenses.byYear,
          netOperatingIncomeByYear: byYearCombine(y => yv(sIncome, y) - yv(sCogs, y) - yv(sExpenses, y)),
          otherIncomeByYear: sOtherIncome.byYear,
          otherExpenseByYear: sOtherExpenses.byYear,
          netOtherIncomeByYear: byYearCombine(y => yv(sOtherIncome, y) - yv(sOtherExpenses, y)),
          netIncomeByYear: byYearCombine(y => yv(sIncome, y) - yv(sCogs, y) - yv(sExpenses, y) + yv(sOtherIncome, y) - yv(sOtherExpenses, y)),
        }
      })
    }

    // -------------------------------------------------------------------------
    // 2. BALANCE SHEET (BALANCE GENERAL — JERÁRQUICO QBO CON SALDOS HISTÓRICOS A `endDate`)
    //    Montos en signo de presentación QBO: Activos, Pasivos y Capital en positivo.
    // -------------------------------------------------------------------------
    if (reportType === 'balance_sheet') {
      const endMap = balanceAsOf(asOfDate)
      const begDate = startDate ? dayBefore(startDate) : null
      const begMap = begDate ? balanceAsOf(begDate) : null
      const eqEnd = equityRollForward(asOfDate)
      const eqBeg = begDate ? equityRollForward(begDate) : null
      const bsCompDates = computeComparisonDates(startDate, asOfDate, asOfDate, comparePeriod)
      const compMap = bsCompDates ? balanceAsOf(bsCompDates.endDate) : null
      const eqComp = bsCompDates ? equityRollForward(bsCompDates.endDate) : null

      const everPosted = new Set<string>()
      for (const t of allTxns) {
        if (t.is_voided || String(t.txn_date || '') > asOfDate) continue
        for (const p of postingsOf(t)) everPosted.add(p.account_qb_id)
      }

      const withHistoricalBalance = (a: any) => {
        const idStr = String(a.qb_account_id)
        const isRE = retainedEarningsIds.has(idStr)
        const endNat = isRE ? eqEnd.retainedEarnings : toNaturalBalance(a, endMap.get(idStr) ?? 0)
        const begNat = begDate
          ? (isRE ? (eqBeg?.retainedEarnings ?? 0) : toNaturalBalance(a, begMap?.get(idStr) ?? 0))
          : 0
        const priorNat = compMap && eqComp
          ? (isRE ? eqComp.retainedEarnings : toNaturalBalance(a, compMap.get(idStr) ?? 0))
          : null
        const deltaAmt = priorNat !== null ? r2(endNat - priorNat) : null
        const deltaPct = priorNat !== null && Math.abs(priorNat) >= 0.005 ? r2(((endNat - priorNat) / Math.abs(priorNat)) * 100) : null
        return {
          ...a,
          current_balance: endNat,
          balance_as_of: endNat,
          beginning_balance: begNat,
          period_change: r2(endNat - begNat),
          prior_balance: priorNat,
          delta_amount: deltaAmt,
          delta_pct: deltaPct,
          balance_sign: 'natural',
        }
      }

      const allBsWithBal = accounts
        .filter((a: any) => isBalanceSheetAccountType(a))
        .map(withHistoricalBalance)
      const allBsById = new Map<string, any>()
      const allBsByFqnLower = new Map<string, any>()
      for (const a of allBsWithBal) {
        allBsById.set(String(a.qb_account_id), a)
        allBsByFqnLower.set(String(a.fully_qualified_name || a.name || '').toLowerCase(), a)
      }

      const bsAccounts = allBsWithBal.filter((a: any) =>
        hideZeroRows
          ? Math.abs(Number(a.current_balance || 0)) > 0.004 || Math.abs(Number(a.prior_balance || 0)) > 0.004
          : a.is_active || Math.abs(Number(a.current_balance || 0)) > 0.004 || everPosted.has(String(a.qb_account_id))
      )

      // Build QBO hierarchical parent -> sub-account -> sub-sub-account -> Total [Parent] tree for Balance Sheet sections
      const buildBsTree = (sectionList: any[]) => {
        const nodeMap = new Map<string, any>()
        for (const a of sectionList) {
          nodeMap.set(String(a.qb_account_id), a)
        }
        // Ensure any ancestor of an included sub-account is also present in nodeMap so the parent header appears
        for (const a of sectionList) {
          let cur: any = a
          const visited = new Set<string>()
          while (cur) {
            const cId = String(cur.qb_account_id)
            if (visited.has(cId)) break
            visited.add(cId)
            let pId = String(cur.parent_qb_id || cur.raw_data?.ParentRef?.value || '').trim()
            if (!pId && cur.fully_qualified_name && String(cur.fully_qualified_name).includes(':')) {
              const prefix = String(cur.fully_qualified_name).split(':').slice(0, -1).join(':').toLowerCase()
              const pAcc = allBsByFqnLower.get(prefix)
              if (pAcc && String(pAcc.qb_account_id) !== cId) pId = String(pAcc.qb_account_id)
            }
            if (pId && pId !== cId && allBsById.has(pId)) {
              const parentAcc = allBsById.get(pId)!
              if (parentAcc.account_type === a.account_type && !nodeMap.has(pId)) {
                nodeMap.set(pId, parentAcc)
              }
              cur = parentAcc
            } else {
              break
            }
          }
        }

        const childrenByParent = new Map<string | null, any[]>()
        for (const a of nodeMap.values()) {
          const cId = String(a.qb_account_id)
          let pId: string | null = String(a.parent_qb_id || a.raw_data?.ParentRef?.value || '').trim() || null
          if (!pId && a.fully_qualified_name && String(a.fully_qualified_name).includes(':')) {
            const prefix = String(a.fully_qualified_name).split(':').slice(0, -1).join(':').toLowerCase()
            const pAcc = allBsByFqnLower.get(prefix)
            if (pAcc && String(pAcc.qb_account_id) !== cId) pId = String(pAcc.qb_account_id)
          }
          const validParent = pId && pId !== cId && nodeMap.has(pId) ? pId : null
          if (!childrenByParent.has(validParent)) childrenByParent.set(validParent, [])
          childrenByParent.get(validParent)!.push(a)
        }
        for (const arr of childrenByParent.values()) {
          arr.sort((x, y) => String(x.name || '').localeCompare(String(y.name || '')))
        }

        const displayRows: any[] = []
        const walk = (parentId: string | null, depth: number, visited = new Set<string>()): number => {
          let sum = 0
          for (const node of childrenByParent.get(parentId) || []) {
            const nId = String(node.qb_account_id)
            if (visited.has(nId)) continue
            visited.add(nId)
            const kids = childrenByParent.get(nId) || []
            const ownBal = r2(Number(node.current_balance || 0))
            if (kids.length === 0) {
              const showLeaf = hideZeroRows
                ? Math.abs(ownBal) > 0.004 || Math.abs(Number(node.prior_balance || 0)) > 0.004
                : Math.abs(ownBal) > 0.004 || node.is_active
              if (showLeaf) {
                displayRows.push({
                  ...node,
                  kind: 'account',
                  depth,
                  display_balance: ownBal,
                  rollup_balance: ownBal,
                })
              }
              sum = r2(sum + ownBal)
            } else {
              const headerIdx = displayRows.length
              displayRows.push({
                ...node,
                kind: 'parent',
                depth,
                display_balance: ownBal,
                rollup_balance: ownBal,
                children_count: kids.length,
              })
              const childSum = walk(nId, depth + 1, visited)
              const subTotal = r2(ownBal + childSum)
              displayRows[headerIdx].rollup_balance = subTotal
              if (Math.abs(subTotal) > 0.004 || displayRows.length > headerIdx + 1) {
                displayRows.push({
                  id: `total-${nId}`,
                  qb_account_id: nId,
                  name: `Total ${node.name}`,
                  fully_qualified_name: node.fully_qualified_name || node.name,
                  account_type: node.account_type,
                  kind: 'total',
                  depth,
                  current_balance: subTotal,
                  display_balance: subTotal,
                  rollup_balance: subTotal,
                })
              } else {
                // Hide completely empty zero-balance parent with no visible children
                displayRows.splice(headerIdx, 1)
              }
              sum = r2(sum + subTotal)
            }
          }
          return sum
        }
        walk(null, 0)
        return displayRows
      }

      const assets = bsAccounts.filter((a: any) => ['Bank', 'Accounts Receivable', 'Other Current Asset', 'Fixed Asset', 'Other Asset'].includes(a.account_type))
      const liabilities = bsAccounts.filter((a: any) => ['Accounts Payable', 'Credit Card', 'Other Current Liability', 'Long Term Liability'].includes(a.account_type))
      const equity = bsAccounts.filter((a: any) => a.account_type === 'Equity')

      const bankAccounts = assets.filter((a: any) => a.account_type === 'Bank')
      const accountsReceivable = assets.filter((a: any) => a.account_type === 'Accounts Receivable')
      const otherCurrentAssets = assets.filter((a: any) => a.account_type === 'Other Current Asset')
      const fixedAssets = assets.filter((a: any) => a.account_type === 'Fixed Asset')
      const otherAssets = assets.filter((a: any) => a.account_type === 'Other Asset')

      const sumBal = (list: any[]) => r2(list.reduce((s, a) => s + Number(a.current_balance || 0), 0))

      const totalBankAccounts = sumBal(bankAccounts)
      const totalAccountsReceivable = sumBal(accountsReceivable)
      const totalOtherCurrentAssets = sumBal(otherCurrentAssets)
      const totalCurrentAssets = r2(totalBankAccounts + totalAccountsReceivable + totalOtherCurrentAssets)
      const totalFixedAssets = sumBal(fixedAssets)
      const totalOtherAssets = sumBal(otherAssets)
      const totalAssets = r2(totalCurrentAssets + totalFixedAssets + totalOtherAssets)

      const accountsPayable = liabilities.filter((a: any) => a.account_type === 'Accounts Payable')
      const creditCards = liabilities.filter((a: any) => a.account_type === 'Credit Card')
      const otherCurrentLiabilities = liabilities.filter((a: any) => a.account_type === 'Other Current Liability')
      const longTermLiabilities = liabilities.filter((a: any) => a.account_type === 'Long Term Liability')

      const totalAccountsPayable = sumBal(accountsPayable)
      const totalCreditCards = sumBal(creditCards)
      const totalOtherCurrentLiabilities = sumBal(otherCurrentLiabilities)
      const totalCurrentLiabilities = r2(totalAccountsPayable + totalCreditCards + totalOtherCurrentLiabilities)
      const totalLongTermLiabilities = sumBal(longTermLiabilities)
      const totalLiabilities = r2(totalCurrentLiabilities + totalLongTermLiabilities)

      const statedEquity = sumBal(equity) // includes Retained Earnings
      const netIncome = eqEnd.netIncome
      const totalEquity = r2(statedEquity + netIncome)
      const totalLiabilitiesAndEquity = r2(totalLiabilities + totalEquity)

      const sumPrior = (list: any[]) => r2(list.reduce((s, a) => s + Number(a.prior_balance || 0), 0))
      const bsComparison = bsCompDates && eqComp
        ? (() => {
            const pAssets = sumPrior(allBsWithBal.filter((a: any) => ['Bank', 'Accounts Receivable', 'Other Current Asset', 'Fixed Asset', 'Other Asset'].includes(a.account_type)))
            const pLiab = sumPrior(allBsWithBal.filter((a: any) => ['Accounts Payable', 'Credit Card', 'Other Current Liability', 'Long Term Liability'].includes(a.account_type)))
            const pStatedEq = sumPrior(allBsWithBal.filter((a: any) => a.account_type === 'Equity'))
            const pEq = r2(pStatedEq + eqComp.netIncome)
            return {
              mode: comparePeriod,
              asOfDate: bsCompDates.endDate,
              totalAssets: pAssets,
              totalLiabilities: pLiab,
              statedEquity: pStatedEq,
              retainedEarnings: eqComp.retainedEarnings,
              netIncome: eqComp.netIncome,
              totalEquity: pEq,
              totalLiabilitiesAndEquity: r2(pLiab + pEq),
              deltaAssets: r2(totalAssets - pAssets),
              deltaLiabilities: r2(totalLiabilities - pLiab),
              deltaEquity: r2(totalEquity - pEq),
            }
          })()
        : null

      return respondReport(req, {
        reportType,
        company,
        basis,
        startDate,
        endDate: asOfDate,
        customization: customizationMeta,
        availableArchives,
        balanceSheet: {
          asOfDate,
          comparison: bsComparison,
          fiscalYearStart: eqEnd.fiscalYearStart,
          assets,
          liabilities,
          equity,
          bankAccounts,
          accountsReceivable,
          otherCurrentAssets,
          fixedAssets,
          otherAssets,
          accountsPayable,
          creditCards,
          otherCurrentLiabilities,
          longTermLiabilities,
          bankAccountsTree: buildBsTree(bankAccounts),
          accountsReceivableTree: buildBsTree(accountsReceivable),
          otherCurrentAssetsTree: buildBsTree(otherCurrentAssets),
          fixedAssetsTree: buildBsTree(fixedAssets),
          otherAssetsTree: buildBsTree(otherAssets),
          accountsPayableTree: buildBsTree(accountsPayable),
          creditCardsTree: buildBsTree(creditCards),
          otherCurrentLiabilitiesTree: buildBsTree(otherCurrentLiabilities),
          longTermLiabilitiesTree: buildBsTree(longTermLiabilities),
          equityTree: buildBsTree(equity),
          totalBankAccounts,
          totalAccountsReceivable,
          totalOtherCurrentAssets,
          totalCurrentAssets,
          totalFixedAssets,
          totalOtherAssets,
          totalAssets,
          totalAccountsPayable,
          totalCreditCards,
          totalOtherCurrentLiabilities,
          totalCurrentLiabilities,
          totalLongTermLiabilities,
          totalLiabilities,
          statedEquity,
          retainedEarnings: eqEnd.retainedEarnings,
          netIncome,
          // Kept for UI compatibility: the "Net Income" line of the QBO Balance Sheet
          retainedNetIncome: netIncome,
          totalEquity,
          totalLiabilitiesAndEquity,
          balanceCheckDifference: r2(totalAssets - totalLiabilitiesAndEquity),
        }
      })
    }

    // -------------------------------------------------------------------------
    // 3. BANK / CREDIT CARD REGISTER (AUXILIAR) — saldo inicial + saldo corrido como el registro de QBO
    // -------------------------------------------------------------------------
    if (reportType === 'bank_register') {
      const bankAccounts = accounts
        .filter((a: any) => a.account_type === 'Bank' || a.account_type === 'Credit Card')
        .map((a: any) => ({ ...a, current_balance: toNaturalBalance(a, Number(a.current_balance || 0)), balance_sign: 'natural' }))
      const targetAcctId = accountId !== 'ALL' ? accountId : (bankAccounts[0]?.qb_account_id || '')
      const targetAcc = ledgerCtx.accounts.get(String(targetAcctId))
      const begDp = startDate ? (balanceAsOf(dayBefore(startDate)).get(String(targetAcctId)) ?? 0) : 0
      let runningDp = begDp

      const registerRows: any[] = []
      for (const t of activeTxns) {
        const ps = postingsOf(t).filter(p => p.account_qb_id === String(targetAcctId))
        if (ps.length === 0) continue
        const dp = r2(ps.reduce((s, p) => s + p.amount, 0))
        if (dp === 0) continue
        runningDp = r2(runningDp + dp)
        registerRows.push({
          id: t.id,
          qb_txn_id: t.qb_txn_id,
          txn_date: t.txn_date,
          txn_type: t.txn_type,
          doc_number: t.doc_number,
          entity_name: t.entity_name || ps[0].entity_name,
          account_name: t.account_name,
          category_summary: splitLabel(t, String(targetAcctId)),
          memo: t.memo || ps[0].memo,
          inflow: dp > 0 ? dp : 0,
          outflow: dp < 0 ? -dp : 0,
          running_balance: toNaturalBalance(targetAcc, runningDp),
          cleared_status: t.cleared_status,
        })
      }

      const totalIn = r2(registerRows.reduce((s, r) => s + r.inflow, 0))
      const totalOut = r2(registerRows.reduce((s, r) => s + r.outflow, 0))

      return respondReport(req, {
        reportType,
        company,
        availableArchives,
        bankRegister: {
          selectedAccountId: targetAcctId,
          bankAccounts,
          beginningBalance: toNaturalBalance(targetAcc, begDp),
          rows: registerRows.reverse(), // Newest at top, chronological running_balance preserved
          totalInflows: totalIn,
          totalOutflows: totalOut,
          endingBalance: toNaturalBalance(targetAcc, runningDp),
        }
      })
    }

    // -------------------------------------------------------------------------
    // 4. GENERAL LEDGER (LIBRO MAYOR DETALLADO) — por cuenta: saldo inicial, cargos/abonos, saldo corrido
    // -------------------------------------------------------------------------
    if (reportType === 'general_ledger') {
      const requestedMaxEntries = Number(searchParams.get('maxEntries') || 0)
      const glStart = startDate || null
      const begBS = glStart ? balanceAsOf(dayBefore(glStart)) : null
      const begPL = glStart ? activityBetween(fiscalYearStart(glStart, fiscalStartMonth), dayBefore(glStart)) : null
      const byAcc = new Map<string, { entries: any[]; total_debit: number; total_credit: number }>()
      for (const t of activeTxns) {
        for (const p of postingsOf(t)) {
          if (!ledgerCtx.accounts.has(p.account_qb_id)) continue
          let g = byAcc.get(p.account_qb_id)
          if (!g) {
            g = { entries: [], total_debit: 0, total_credit: 0 }
            byAcc.set(p.account_qb_id, g)
          }
          const debit = p.amount > 0 ? r2(p.amount) : 0
          const credit = p.amount < 0 ? r2(-p.amount) : 0
          g.total_debit = r2(g.total_debit + debit)
          g.total_credit = r2(g.total_credit + credit)
          g.entries.push({
            id: t.id,
            qb_txn_id: t.qb_txn_id,
            date: t.txn_date,
            txn_date: t.txn_date,
            type: t.txn_type,
            txn_type: t.txn_type,
            doc: t.doc_number || '',
            doc_number: t.doc_number || '',
            name: p.entity_name || t.entity_name || '',
            entity_name: p.entity_name || t.entity_name || '',
            memo: p.memo || t.memo || '',
            split: splitLabel(t, p.account_qb_id),
            split_account: splitLabel(t, p.account_qb_id),
            account_qb_id: t.account_qb_id || p.account_qb_id,
            account_name: t.account_name || accName(p.account_qb_id),
            to_account_qb_id: t.to_account_qb_id || null,
            to_account_name: t.to_account_name || null,
            category_summary: t.category_summary || splitLabel(t, p.account_qb_id),
            total_amount: r2(Number(t.total_amount ?? Math.abs(p.amount))),
            line_items: Array.isArray(t.line_items) ? t.line_items : [],
            is_voided: Boolean(t.is_voided),
            debit,
            credit,
            dp: p.amount,
          })
        }
      }
      const ledgerRows: any[] = []
      const accIds = new Set<string>([...byAcc.keys()])
      if (begBS) {
        for (const a of accounts) {
          const id = String(a.qb_account_id)
          const b = isBalanceSheetAccountType(a) ? (begBS.get(id) ?? 0) : (begPL?.get(id) ?? 0)
          if (Math.abs(b) > 0.004) accIds.add(id)
        }
      }
      for (const id of accIds) {
        const acc = ledgerCtx.accounts.get(id)
        if (!acc) continue
        const g = byAcc.get(id) || { entries: [], total_debit: 0, total_credit: 0 }
        const isBS = isBalanceSheetAccountType(acc)
        const begDp = retainedEarningsIds.has(id)
          ? (glStart ? equityRollForward(dayBefore(glStart)).retainedEarningsDebitPositive : 0)
          : (isBS ? (begBS?.get(id) ?? 0) : (begPL?.get(id) ?? 0))
        let run = begDp
        const entries = g.entries.map(e => {
          run = r2(run + e.dp)
          const { dp, ...rest } = e
          return { ...rest, balance: toNaturalBalance(acc, run) }
        })
        const shouldTruncate = requestedMaxEntries > 0 && entries.length > requestedMaxEntries
        ledgerRows.push({
          account_qb_id: id,
          account_name: acc.fully_qualified_name || acc.name || id,
          account_type: acc.account_type,
          beginning_balance: toNaturalBalance(acc, begDp),
          total_debit: g.total_debit,
          total_credit: g.total_credit,
          net_movement: r2(g.total_debit - g.total_credit),
          ending_balance: toNaturalBalance(acc, run),
          entry_count: entries.length,
          truncated: shouldTruncate,
          entries: shouldTruncate ? entries.slice(-requestedMaxEntries) : entries,
        })
      }
      ledgerRows.sort((a, b) => a.account_name.localeCompare(b.account_name))

      return respondReport(req, {
        reportType,
        company,
        startDate,
        endDate,
        availableArchives,
        generalLedger: ledgerRows,
      })
    }

    // -------------------------------------------------------------------------
    // 5. TRIAL BALANCE (BALANZA DE COMPROBACIÓN) — igual que QBO:
    //    cuentas de Balance al corte, cuentas de Resultados del año fiscal a la fecha y Retained Earnings.
    // -------------------------------------------------------------------------
    if (reportType === 'trial_balance') {
      const endMap = balanceAsOf(asOfDate)
      const eq = equityRollForward(asOfDate)
      const ytd = activityBetween(eq.fiscalYearStart, asOfDate)
      const everPosted = new Set<string>()
      for (const t of allTxns) {
        if (t.is_voided || String(t.txn_date || '') > asOfDate) continue
        for (const p of postingsOf(t)) everPosted.add(p.account_qb_id)
      }
      const tbRows = accounts
        .map((a: any) => {
          const id = String(a.qb_account_id)
          let dp = 0
          if (retainedEarningsIds.has(id)) dp = eq.retainedEarningsDebitPositive
          else if (isBalanceSheetAccountType(a)) dp = endMap.get(id) ?? 0
          else if (isProfitLossAccount(a)) dp = ytd.get(id) ?? 0
          dp = r2(dp)
          return {
            account_id: id,
            account_qb_id: id,
            acct_num: a.acct_num,
            name: a.name,
            fully_qualified_name: a.fully_qualified_name || a.name,
            account_type: a.account_type,
            debit: dp > 0 ? dp : 0,
            credit: dp < 0 ? r2(-dp) : 0,
            _keep: hideZeroRows
              ? Math.abs(dp) > 0.004
              : Math.abs(dp) > 0.004 || everPosted.has(id) || retainedEarningsIds.has(id) || a.account_sub_type === 'OpeningBalanceEquity',
          }
        })
        .filter((r: any) => r._keep)
        .map(({ _keep, ...r }: any) => r)

      const totalDebit = r2(tbRows.reduce((s: number, r: any) => s + r.debit, 0))
      const totalCredit = r2(tbRows.reduce((s: number, r: any) => s + r.credit, 0))

      return respondReport(req, {
        reportType,
        company,
        basis,
        customization: customizationMeta,
        availableArchives,
        trialBalance: {
          asOfDate,
          fiscalYearStart: eq.fiscalYearStart,
          rows: tbRows,
          totalDebit,
          totalCredit,
          difference: r2(totalDebit - totalCredit),
        }
      })
    }

    // -------------------------------------------------------------------------
    // 6. EXPENSES BY VENDOR SUMMARY & INCOME BY CUSTOMER SUMMARY (QBO)
    //    Suma de pólizas a cuentas de Gasto (o Ingreso) agrupadas por proveedor (o cliente).
    // -------------------------------------------------------------------------
    if (reportType === 'vendor_expenses' || reportType === 'customer_income') {
      const isVendor = reportType === 'vendor_expenses'
      const contactMap = new Map<string, any>()
      for (const c of contacts) {
        contactMap.set((c.display_name || '').toLowerCase(), c)
        if (c.qb_contact_id) contactMap.set(`id:${c.contact_type}:${c.qb_contact_id}`, c)
      }

      const agg: Record<string, {
        name: string
        count: number
        total_amount: number
        expenses_amount: number
        net_amount: number
        last_date: string
        tax_identifier: string | null
        vendor_1099: boolean
        categories: Set<string>
        txnIds: Set<string>
        transactions: any[]
      }> = {}

      forEachPlPosting((acc, p, t, src) => {
          const incomeAcc = isIncomeAccount(acc)
          const expenseAcc = isExpenseAccount(acc)
          if (!incomeAcc && !expenseAcc) return
          let name: string
          if (isVendor) {
            // QBO Expenses by Vendor: only Vendor-type payees; any other payee type is "Not Specified"
            if (!expenseAcc) return
            name = p.entity_type === 'Vendor' && p.entity_name ? String(p.entity_name).trim() : 'Not Specified'
          } else {
            // QBO Income by Customer: only postings tied to a Customer (payee or billable customer)
            const cust = p.entity_type === 'Customer' ? p.entity_name : p.customer_name
            if (!cust) return
            name = String(cust).trim()
          }
          // Vendor report: expenses positive. Customer report: Income column positive; Expenses column = −debits (QBO sign)
          const amt = r2(isVendor ? p.amount : -p.amount)
          if (amt === 0) return
          if (!agg[name]) {
            const matchedContact = contactMap.get(name.toLowerCase())
            agg[name] = {
              name,
              count: 0,
              total_amount: 0,
              expenses_amount: 0,
              net_amount: 0,
              last_date: t.txn_date,
              tax_identifier: matchedContact?.tax_identifier || null,
              vendor_1099: Boolean(matchedContact?.vendor_1099),
              categories: new Set<string>(),
              txnIds: new Set<string>(),
              transactions: [],
            }
          }
          const g = agg[name]
          if (!g.txnIds.has(String(t.id))) {
            g.txnIds.add(String(t.id))
            g.count++
          }
          if (isVendor || incomeAcc) g.total_amount = r2(g.total_amount + amt)
          else g.expenses_amount = r2(g.expenses_amount + amt)
          g.net_amount = r2(g.total_amount + (isVendor ? 0 : g.expenses_amount))
          if (String(t.txn_date) > g.last_date) g.last_date = t.txn_date
          g.categories.add(accName(p.account_qb_id))
          const txRow = postingRow(src || t, p, amt, p.account_qb_id)
          if (src) {
            txRow.txn_date = t.txn_date
            txRow.year = String(t.txn_date || '').slice(0, 4)
          }
          g.transactions.push(txRow)
      })

      const rows = Object.values(agg)
        .map(r => {
          let run = 0
          const txnsWithRun = r.transactions
            .sort((a: any, b: any) => String(a.txn_date).localeCompare(String(b.txn_date)))
            .map(tx => {
              run = r2(run + Number(tx.amount || 0))
              return { ...tx, running_balance: run }
            })
          const { txnIds, ...rest } = r
          return {
            ...rest,
            categories: Array.from(r.categories).slice(0, 3).join(', '),
            transactions: txnsWithRun,
          }
        })
        .filter(r => (Math.abs(r.total_amount) > 0.004 || Math.abs(r.expenses_amount) > 0.004) && (!only1099 || !isVendor || r.vendor_1099))
        .sort((a, b) => a.name === 'Not Specified' ? 1 : b.name === 'Not Specified' ? -1 : a.name.localeCompare(b.name))

      const grandTotal = r2(rows.reduce((s, r) => s + r.total_amount, 0))
      const grandExpenses = r2(rows.reduce((s, r) => s + r.expenses_amount, 0))

      return respondReport(req, {
        reportType,
        company,
        basis,
        startDate,
        endDate,
        availableArchives,
        entitySummary: {
          rows,
          grandTotal,
          grandExpenses,
          grandNet: r2(grandTotal + grandExpenses),
        }
      })
    }

    // -------------------------------------------------------------------------
    // 7. CHECK DETAIL & DEPOSIT DETAIL
    // -------------------------------------------------------------------------
    if (reportType === 'check_detail' || reportType === 'deposit_detail') {
      const targetTypes = reportType === 'check_detail' ? ['Check', 'BillPayment'] : ['Deposit', 'Payment']
      const rows = txns
        .filter(t => targetTypes.includes(t.txn_type))
        .reverse()
      const totalAmount = Number(
        rows.filter(r => !r.is_voided).reduce((s, r) => s + Number(r.total_amount || 0), 0).toFixed(2)
      )

      return respondReport(req, {
        reportType,
        company,
        startDate,
        endDate,
        availableArchives,
        detailReport: {
          rows,
          totalAmount,
          count: rows.length,
        }
      })
    }

    // -------------------------------------------------------------------------
    // 8. ACCOUNT QUICKREPORT / ECOSYSTEM DRILL-DOWN TRANSACTION REPORT
    //    Supports:
    //    - Single Account (`accountId` or `accountName`)
    //    - Parent Account + all Sub-Accounts (`Prepaid Expenses`, `Short Term Investments`, `Buildings`, `Land`, etc.)
    //    - Balance Sheet / Trial Balance / P&L Group Totals (`GROUP:BANK`, `GROUP:CURRENT_ASSETS`, `GROUP:TOTAL_ASSETS`, etc., or QBO summary titles like `Total Bank Accounts`)
    //    - Relational Lists & Contacts Drill-Down (`filterType=item|location|class|payment_method|term|contact` + `filterValue`)
    // -------------------------------------------------------------------------
    if (reportType === 'account_quickreport') {
      const rawNameParam = (searchParams.get('accountName') || '').trim()
      const targetNameParam = rawNameParam.toLowerCase()
      const filterType = (searchParams.get('filterType') || '').trim().toLowerCase()
      const filterValue = (searchParams.get('filterValue') || '').trim()
      const filterId = (searchParams.get('filterId') || '').trim()

      // MODE 8A: RELATIONAL LISTS / CONTACTS DRILL-DOWN (`filterType` provided)
      if (filterType && (filterValue || filterId)) {
        const valLower = filterValue.toLowerCase()
        const matchedRows: any[] = []
        let runningTotal = 0

        for (const t of activeTxns) {
          if (t.txn_type === 'Estimate' || t.txn_type === 'PurchaseOrder' || t.direction === 'NON_POSTING') continue
          const lines = Array.isArray(t.line_items) && t.line_items.length > 0 ? t.line_items : []

          let matched = false
          let matchedAmt = Number(t.total_amount || 0)
          let matchedMemo = t.memo || ''
          let matchedAcct = t.account_name || t.category_summary || '—'
          let matchedSplit = t.to_account_name || t.category_summary || '—'

          if (filterType === 'contact') {
            if (
              (filterId && String(t.entity_qb_id || '') === filterId) ||
              (valLower && String(t.entity_name || '').toLowerCase() === valLower)
            ) {
              matched = true
              if (t.direction === 'OUT' || t.txn_type === 'Bill') matchedAmt = -Math.abs(matchedAmt)
            } else {
              for (const l of lines) {
                if (
                  (filterId && String(l.entity_qb_id || '') === filterId) ||
                  (valLower && String(l.entity_name || '').toLowerCase() === valLower)
                ) {
                  matched = true
                  matchedAmt = Number(l.amount ?? t.total_amount ?? 0)
                  matchedMemo = l.description || t.memo || ''
                  matchedAcct = l.account_name || matchedAcct
                  break
                }
              }
            }
          } else if (filterType === 'payment_method') {
            if (valLower && String(t.payment_type || '').toLowerCase() === valLower) {
              matched = true
              if (t.direction === 'OUT') matchedAmt = -Math.abs(matchedAmt)
            }
          } else if (filterType === 'term') {
            const rawTerm = String(t.raw_data?.SalesTermRef?.name || t.payment_type || '').toLowerCase()
            if (valLower && rawTerm === valLower) {
              matched = true
            }
          } else if (filterType === 'location' || filterType === 'department') {
            // QBO Location (DepartmentRef) is a transaction-header field: match by Id, exact name or FullyQualifiedName leaf
            const hdrDeptId = String(t.department_qb_id || t.raw_data?.DepartmentRef?.value || '')
            const hdrDeptName = String(t.department_name || t.raw_data?.DepartmentRef?.name || '').toLowerCase().trim()
            const sameLocation = (candidate: string) =>
              Boolean(candidate) && Boolean(valLower) &&
              (candidate === valLower || candidate.split(':').pop()!.trim() === valLower || valLower.split(':').pop()!.trim() === candidate)
            if ((filterId && hdrDeptId === filterId) || sameLocation(hdrDeptName)) {
              matched = true
              if (t.direction === 'OUT' || t.txn_type === 'Bill') matchedAmt = -Math.abs(matchedAmt)
            } else {
              let lineSum = 0
              for (const l of lines) {
                const lDeptId = String(l.department_qb_id || '')
                const lDeptName = String(l.department_name || '').toLowerCase().trim()
                if ((filterId && lDeptId === filterId) || sameLocation(lDeptName)) {
                  matched = true
                  lineSum += Number(l.amount || 0)
                  matchedAcct = l.account_name || matchedAcct
                }
              }
              if (matched && lineSum !== 0) matchedAmt = lineSum
            }
          } else if (filterType === 'class') {
            const hdrClassId = String(t.class_qb_id || '')
            const hdrClassName = String(t.class_name || '').toLowerCase()
            if ((filterId && hdrClassId === filterId) || (valLower && hdrClassName === valLower)) {
              matched = true
              if (t.direction === 'OUT') matchedAmt = -Math.abs(matchedAmt)
            } else {
              let lineSum = 0
              for (const l of lines) {
                const lClassId = String(l.class_qb_id || '')
                const lClassName = String(l.class_name || '').toLowerCase()
                if ((filterId && lClassId === filterId) || (valLower && lClassName === valLower)) {
                  matched = true
                  lineSum += Number(l.amount || 0)
                  matchedAcct = l.account_name || matchedAcct
                }
              }
              if (matched && lineSum !== 0) matchedAmt = lineSum
            }
          } else if (filterType === 'item') {
            let lineSum = 0
            for (const l of lines) {
              const lItemId = String(l.item_qb_id || l.item_id || '')
              const lItemName = String(l.item_name || l.account_name || '').toLowerCase()
              if ((filterId && lItemId === filterId) || (valLower && lItemName === valLower)) {
                matched = true
                lineSum += Number(l.amount || 0)
                const { categoryName } = resolveLineAccount(t, l, 'ANY')
                matchedAcct = categoryName || l.account_name || matchedAcct
                matchedSplit = t.account_name || '—'
                matchedMemo = l.description || t.memo || ''
              }
            }
            if (matched) matchedAmt = lineSum || Number(t.total_amount || 0)
          }

          if (matched) {
            runningTotal = Number((runningTotal + matchedAmt).toFixed(2))
            matchedRows.push({
              id: t.id,
              qb_txn_id: t.qb_txn_id,
              txn_date: t.txn_date,
              txn_type: t.txn_type,
              doc_number: t.doc_number || '',
              entity_name: t.entity_name || '—',
              department_name: t.department_name || '',
              location_name: t.department_name || '',
              class_name: t.class_name || '',
              memo: matchedMemo,
              account_qb_id: t.account_qb_id || null,
              account_name: matchedAcct,
              to_account_qb_id: t.to_account_qb_id || null,
              to_account_name: t.to_account_name || null,
              category_summary: t.category_summary || matchedSplit,
              split_account: matchedSplit,
              amount: Number(matchedAmt.toFixed(2)),
              total_amount: Number((t.total_amount ?? Math.abs(matchedAmt)).toFixed(2)),
              line_items: Array.isArray(t.line_items) ? t.line_items : [],
              payment_method: t.payment_type || '',
              is_voided: Boolean(t.is_voided),
              running_balance: runningTotal,
              year: (t.txn_date || '').slice(0, 4),
              cleared_status: t.cleared_status || 'Cleared',
            })
          }
        }

        const reportTitle = rawNameParam || filterValue || filterType.toUpperCase()
        const singleGroup = {
          account_id: filterId || filterType,
          account_qb_id: filterId || filterType,
          account_name: reportTitle,
          fully_qualified_name: reportTitle,
          account_type: filterType.toUpperCase(),
          is_balance_sheet: false,
          beginning_balance: 0,
          transactions: matchedRows,
          period_net_change: runningTotal,
          ending_balance: runningTotal,
        }

        return respondReport(req, {
          reportType,
          company,
          rows: matchedRows,
          totalAmount: runningTotal,
          count: matchedRows.length,
          quickReport: {
            title: reportTitle,
            subtitle: `${startDate || 'Inicio'} — ${endDate || 'Hoy'}`,
            isBalanceSheetReport: false,
            totalBeginningBalance: 0,
            totalAmount: runningTotal,
            totalEndingBalance: runningTotal,
            count: matchedRows.length,
            groups: [singleGroup],
            rows: matchedRows,
          },
        })
      }

      // MODE 8B: RESOLVE ONE OR MULTIPLE TARGET ACCOUNTS (Single Account, Parent + Sub-Accounts, or Group Total)
      const resolveGroupToken = (tokenOrName: string): { groupTitle: string; list: any[] } | null => {
        const u = tokenOrName.trim().toUpperCase()
        const activeList = accounts.filter(a => a.is_active)
        if (u === 'GROUP:BANK' || u === 'TOTAL BANK ACCOUNTS' || u === 'TOTAL FOR BANK ACCOUNTS' || u === 'BANK ACCOUNTS') {
          return { groupTitle: 'Total Bank Accounts', list: activeList.filter(a => a.account_type === 'Bank') }
        }
        if (u === 'GROUP:AR' || u === 'TOTAL ACCOUNTS RECEIVABLE' || u === 'TOTAL FOR ACCOUNTS RECEIVABLE' || u === 'ACCOUNTS RECEIVABLE') {
          return { groupTitle: 'Total Accounts Receivable (A/R)', list: activeList.filter(a => a.account_type === 'Accounts Receivable') }
        }
        if (u === 'GROUP:OCA' || u === 'TOTAL OTHER CURRENT ASSETS' || u === 'TOTAL FOR OTHER CURRENT ASSETS' || u === 'OTHER CURRENT ASSETS') {
          return { groupTitle: 'Total Other Current Assets', list: activeList.filter(a => a.account_type === 'Other Current Asset') }
        }
        if (u === 'GROUP:CURRENT_ASSETS' || u === 'TOTAL CURRENT ASSETS' || u === 'TOTAL FOR CURRENT ASSETS' || u === 'CURRENT ASSETS') {
          return { groupTitle: 'Total Current Assets', list: activeList.filter(a => ['Bank', 'Accounts Receivable', 'Other Current Asset'].includes(a.account_type)) }
        }
        if (u === 'GROUP:FIXED_ASSETS' || u === 'TOTAL FIXED ASSETS' || u === 'TOTAL FOR FIXED ASSETS' || u === 'FIXED ASSETS') {
          return { groupTitle: 'Total Fixed Assets', list: activeList.filter(a => a.account_type === 'Fixed Asset') }
        }
        if (u === 'GROUP:OTHER_ASSETS' || u === 'TOTAL OTHER ASSETS' || u === 'TOTAL FOR OTHER ASSETS' || u === 'OTHER ASSETS') {
          return { groupTitle: 'Total Other Assets', list: activeList.filter(a => a.account_type === 'Other Asset') }
        }
        if (u === 'GROUP:TOTAL_ASSETS' || u === 'TOTAL ASSETS' || u === 'TOTAL FOR ASSETS') {
          return { groupTitle: 'Total Assets', list: activeList.filter(a => a.classification === 'Asset' || ['Bank', 'Accounts Receivable', 'Other Current Asset', 'Fixed Asset', 'Other Asset'].includes(a.account_type)) }
        }
        if (u === 'GROUP:AP' || u === 'TOTAL ACCOUNTS PAYABLE' || u === 'TOTAL FOR ACCOUNTS PAYABLE' || u === 'ACCOUNTS PAYABLE') {
          return { groupTitle: 'Total Accounts Payable (A/P)', list: activeList.filter(a => a.account_type === 'Accounts Payable') }
        }
        if (u === 'GROUP:CC' || u === 'TOTAL CREDIT CARDS' || u === 'TOTAL FOR CREDIT CARDS' || u === 'CREDIT CARDS') {
          return { groupTitle: 'Total Credit Cards', list: activeList.filter(a => a.account_type === 'Credit Card') }
        }
        if (u === 'GROUP:OCL' || u === 'TOTAL OTHER CURRENT LIABILITIES' || u === 'TOTAL FOR OTHER CURRENT LIABILITIES' || u === 'OTHER CURRENT LIABILITIES') {
          return { groupTitle: 'Total Other Current Liabilities', list: activeList.filter(a => a.account_type === 'Other Current Liability') }
        }
        if (u === 'GROUP:CURRENT_LIABILITIES' || u === 'TOTAL CURRENT LIABILITIES' || u === 'TOTAL FOR CURRENT LIABILITIES' || u === 'CURRENT LIABILITIES') {
          return { groupTitle: 'Total Current Liabilities', list: activeList.filter(a => ['Accounts Payable', 'Credit Card', 'Other Current Liability'].includes(a.account_type)) }
        }
        if (u === 'GROUP:LTL' || u === 'TOTAL LONG-TERM LIABILITIES' || u === 'TOTAL LONG TERM LIABILITIES' || u === 'TOTAL FOR LONG-TERM LIABILITIES' || u === 'LONG-TERM LIABILITIES' || u === 'LONG TERM LIABILITIES') {
          return { groupTitle: 'Total Long-Term Liabilities', list: activeList.filter(a => a.account_type === 'Long Term Liability') }
        }
        if (u === 'GROUP:TOTAL_LIABILITIES' || u === 'TOTAL LIABILITIES' || u === 'TOTAL FOR LIABILITIES') {
          return { groupTitle: 'Total Liabilities', list: activeList.filter(a => a.classification === 'Liability' || ['Accounts Payable', 'Credit Card', 'Other Current Liability', 'Long Term Liability'].includes(a.account_type)) }
        }
        if (u === 'GROUP:EQUITY' || u === 'TOTAL EQUITY' || u === 'TOTAL FOR EQUITY' || u === 'EQUITY') {
          return { groupTitle: 'Total Equity', list: activeList.filter(a => a.classification === 'Equity' || a.account_type === 'Equity') }
        }
        if (u === 'GROUP:LIABILITIES_AND_EQUITY' || u === 'TOTAL LIABILITIES AND EQUITY' || u === 'TOTAL LIABILITIES & EQUITY') {
          return {
            groupTitle: 'Total Liabilities and Equity',
            list: activeList.filter(a => ['Liability', 'Equity'].includes(a.classification || '') || ['Accounts Payable', 'Credit Card', 'Other Current Liability', 'Long Term Liability', 'Equity'].includes(a.account_type)),
          }
        }
        if (u === 'GROUP:ALL_TRIAL_BALANCE') {
          return { groupTitle: 'Trial Balance — All Active Accounts', list: activeList }
        }
        if (u === 'GROUP:NET_INCOME' || u === 'NET INCOME' || u === 'RETAINED NET INCOME' || u === 'UTILIDAD NETA' || u === 'UTILIDAD NETA RETENIDA') {
          return { groupTitle: 'Net Income', list: accounts.filter(a => isProfitLossAccount(a)) }
        }
        if (u === 'GROUP:INCOME' || u === 'TOTAL INCOME') {
          return { groupTitle: 'Total Income', list: accounts.filter(a => a.account_type === 'Income') }
        }
        if (u === 'GROUP:EXPENSES' || u === 'TOTAL EXPENSES') {
          return { groupTitle: 'Total Expenses', list: accounts.filter(a => a.account_type === 'Expense') }
        }
        if (u === 'GROUP:COGS' || u === 'TOTAL COST OF GOODS SOLD') {
          return { groupTitle: 'Total Cost of Goods Sold', list: accounts.filter(a => a.account_type === 'Cost of Goods Sold') }
        }
        if (u === 'GROUP:OTHER_INCOME' || u === 'TOTAL OTHER INCOME') {
          return { groupTitle: 'Total Other Income', list: accounts.filter(a => a.account_type === 'Other Income') }
        }
        if (u === 'GROUP:OTHER_EXPENSES' || u === 'TOTAL OTHER EXPENSES') {
          return { groupTitle: 'Total Other Expenses', list: accounts.filter(a => a.account_type === 'Other Expense') }
        }
        return null
      }

      let targetAccounts: any[] = []
      let reportTitle = rawNameParam || ''

      const groupByAccountId = accountId && accountId !== 'ALL' ? resolveGroupToken(accountId) : null
      const groupByName = !groupByAccountId && rawNameParam ? resolveGroupToken(rawNameParam) : null
      const resolvedGroup = groupByAccountId || groupByName
      // Balance Sheet "Net Income" line = fiscal-year-to-date P&L as of the report date
      const netIncomeMode = resolvedGroup?.groupTitle === 'Net Income'

      if (resolvedGroup) {
        targetAccounts = resolvedGroup.list
        reportTitle = rawNameParam || resolvedGroup.groupTitle
      } else if (accountId && accountId !== 'ALL' && accountId.includes(',')) {
        const idParts = accountId.split(',').map(s => s.trim()).filter(Boolean)
        for (const pid of idParts) {
          const acc = accountTypeMap.get(pid)
          if (acc) targetAccounts.push(acc)
        }
      } else {
        // Strip QBO Archive summary prefixes like "Total for Prepaid Expenses" or "Total Prepaid Expenses"
        const cleanedNameLower = targetNameParam
          .replace(/^total\s+for\s+/i, '')
          .replace(/^total\s+/i, '')
          .trim()

        const baseAccount =
          (accountId && accountId !== 'ALL' && accountTypeMap.get(String(accountId))) ||
          (targetNameParam && accountNameMap.get(targetNameParam)) ||
          (cleanedNameLower && accountNameMap.get(cleanedNameLower)) ||
          null

        if (baseAccount) {
          const baseId = String(baseAccount.qb_account_id)
          const baseFqLower = String(baseAccount.fully_qualified_name || baseAccount.name || '').toLowerCase()
          // Recursively collect all multi-level descendant sub-accounts (Level 1 -> Level 2 -> Level 3 -> Level 4)
          const visitedIds = new Set<string>([baseId])
          const queue: string[] = [baseId]
          const descendants: any[] = []
          while (queue.length > 0) {
            const curId = queue.shift()!
            for (const a of accounts) {
              const aId = String(a.qb_account_id)
              if (visitedIds.has(aId)) continue
              const pId = String(a.parent_qb_id || a.raw_data?.ParentRef?.value || '').trim()
              const fqLower = String(a.fully_qualified_name || '').toLowerCase()
              if (pId === curId || (curId === baseId && baseFqLower && fqLower.startsWith(`${baseFqLower}:`))) {
                visitedIds.add(aId)
                descendants.push(a)
                queue.push(aId)
              }
            }
          }
          targetAccounts = [baseAccount, ...descendants]
          reportTitle = rawNameParam || baseAccount.fully_qualified_name || baseAccount.name
        }
      }

      // Sort targetAccounts by name (just like QBO sorts BANK PARA TRUST, BOFA PRIVATE BANK-6980, Cash on hand, GUTIERREZ, Plaza Bank)
      targetAccounts.sort((a, b) =>
        String(a.fully_qualified_name || a.name || '').localeCompare(String(b.fully_qualified_name || b.name || ''))
      )

      // Build QBO-style Account Groups (`groups`) with Beginning Balance, Chronological Transactions, Running Balance, Period Net Change, and Ending Balance
      const groups: any[] = []
      const allFlatRows: any[] = []
      let totalBeginningBalance = 0
      let totalNetChange = 0
      let totalEndingBalance = 0
      let anyBalanceSheet = false

      if (targetAccounts.length > 0) {
        // Every amount comes from the double-entry postings; balances are shown with the QBO presentation sign
        const endMap = balanceAsOf(endDate)
        const rangeStart = netIncomeMode ? fiscalYearStart(asOfDate, fiscalStartMonth) : startDate
        const rangeEnd = netIncomeMode ? asOfDate : endDate
        const rangeTxns = netIncomeMode
          ? allTxns.filter(t => !t.is_voided && String(t.txn_date || '') >= String(rangeStart) && String(t.txn_date || '') <= String(rangeEnd))
          : activeTxns
        const targetIds = new Set(targetAccounts.map(a => String(a.qb_account_id)))
        const postingsByAcc = new Map<string, Array<{ t: any; p: Posting }>>()

        const allTargetsArePl = !netIncomeMode && targetAccounts.every(a => isProfitLossAccount(a))
        if (basis === 'Cash' && allTargetsArePl) {
          forEachPlPosting((acc, p, effectiveTxn, srcTxn) => {
            const accId = String(acc?.qb_account_id || p.account_qb_id)
            if (!targetIds.has(accId)) return
            if (!postingsByAcc.has(accId)) postingsByAcc.set(accId, [])
            const synthTxn = srcTxn
              ? {
                  ...srcTxn,
                  id: `${effectiveTxn.id}:${srcTxn.id}:${p.line_index}`,
                  txn_date: effectiveTxn.txn_date,
                  memo: `${effectiveTxn.txn_type} ${effectiveTxn.doc_number || ''} → ${srcTxn.txn_type} #${srcTxn.doc_number || srcTxn.qb_txn_id}`.trim(),
                }
              : effectiveTxn
            postingsByAcc.get(accId)!.push({ t: synthTxn, p })
          })
        } else {
          for (const t of rangeTxns) {
            if (t.txn_type === 'Estimate' || t.txn_type === 'PurchaseOrder' || t.direction === 'NON_POSTING') continue
            for (const p of postingsOf(t)) {
              if (!targetIds.has(p.account_qb_id)) continue
              if (!postingsByAcc.has(p.account_qb_id)) postingsByAcc.set(p.account_qb_id, [])
              postingsByAcc.get(p.account_qb_id)!.push({ t, p })
            }
          }
        }

        for (const acc of targetAccounts) {
          const accIdStr = String(acc.qb_account_id)
          const isBS = isBalanceSheetAccountType(acc)
          const isRE = retainedEarningsIds.has(accIdStr)
          if (isBS) anyBalanceSheet = true
          const accDisplayName = acc.fully_qualified_name || acc.name || ''

          // Merge postings of the same transaction on this account (e.g. two lines to the same account)
          const merged = new Map<string, { t: any; p: Posting; dp: number }>()
          for (const { t, p } of postingsByAcc.get(accIdStr) || []) {
            const k = String(t.id)
            const prev = merged.get(k)
            if (prev) prev.dp = r2(prev.dp + p.amount)
            else merged.set(k, { t, p, dp: p.amount })
          }
          const periodDp = r2(Array.from(merged.values()).reduce((s, x) => s + x.dp, 0))

          let endDp = 0
          if (isRE) {
            for (const t of allTxns) {
              if (t.is_voided || (rangeEnd && String(t.txn_date || '') > rangeEnd)) continue
              for (const p of postingsOf(t)) if (p.account_qb_id === accIdStr) endDp = r2(endDp + p.amount)
            }
          } else if (isBS) {
            endDp = endMap.get(accIdStr) ?? Number(acc.current_balance || 0)
          } else {
            endDp = periodDp
          }
          const begDp = isBS ? r2(endDp - periodDp) : 0

          const begBal = toNaturalBalance(acc, begDp)
          const finalEndBal = toNaturalBalance(acc, endDp)
          const periodNat = toNaturalBalance(acc, periodDp)

          // Skip completely unused sub-accounts when displaying a large multi-account group (QBO hides empty rows)
          if (
            targetAccounts.length > 5 &&
            acc.account_type !== 'Bank' &&
            merged.size === 0 &&
            Math.abs(begBal) < 0.001 &&
            Math.abs(finalEndBal) < 0.001
          ) {
            continue
          }

          let run = begBal
          const groupTxns = Array.from(merged.values())
            .sort((a, b) => String(a.t.txn_date).localeCompare(String(b.t.txn_date)))
            .map(({ t, p, dp }) => {
              const amt = toNaturalBalance(acc, dp)
              run = r2(run + amt)
              const row = { ...postingRow(t, p, amt, accIdStr), account_name: acc.name || accDisplayName, running_balance: run }
              allFlatRows.push(row)
              return row
            })

          totalBeginningBalance = r2(totalBeginningBalance + begBal)
          totalNetChange = r2(totalNetChange + periodNat)
          totalEndingBalance = r2(totalEndingBalance + finalEndBal)

          groups.push({
            account_id: accIdStr,
            account_qb_id: accIdStr,
            account_name: acc.name,
            fully_qualified_name: accDisplayName,
            account_type: acc.account_type,
            is_balance_sheet: isBS,
            beginning_balance: begBal,
            transactions: groupTxns,
            period_net_change: periodNat,
            ending_balance: finalEndBal,
          })
        }
        if (netIncomeMode) {
          // Net Income = Income − Expenses (income rows natural +, expense rows natural +)
          const ni = r2(groups.reduce((s, g) => s + (isIncomeAccount(ledgerCtx.accounts.get(g.account_qb_id)) ? g.period_net_change : -g.period_net_change), 0))
          totalNetChange = ni
          totalEndingBalance = ni
          totalBeginningBalance = 0
        }
      } else if (targetNameParam) {
        // Fallback name matching if an unmapped category/archive label was clicked
        let runningTotal = 0
        for (const t of activeTxns) {
          if (t.txn_type === 'Estimate' || t.txn_type === 'PurchaseOrder' || t.direction === 'NON_POSTING') continue
          const lines = Array.isArray(t.line_items) && t.line_items.length > 0 ? t.line_items : []
          for (const l of lines) {
            const { categoryName: resolvedCat } = resolveLineAccount(t, l, 'ANY')
            if (
              String(l.account_name || '').toLowerCase() === targetNameParam ||
              resolvedCat.toLowerCase() === targetNameParam
            ) {
              const amt = Number(l.amount ?? t.total_amount ?? 0)
              runningTotal = Number((runningTotal + amt).toFixed(2))
              allFlatRows.push({
                id: t.id,
                qb_txn_id: t.qb_txn_id,
                txn_date: t.txn_date,
                txn_type: t.txn_type,
                doc_number: t.doc_number || l.check_num || '',
                entity_name: l.entity_name || t.entity_name || '—',
                department_name: l.department_name || t.department_name || '',
                class_name: l.class_name || t.class_name || '',
                memo: l.description || t.memo || '',
                account_name: resolvedCat || rawNameParam,
                split_account: t.account_name || t.category_summary || '—',
                amount: Number(amt.toFixed(2)),
                running_balance: runningTotal,
                year: (t.txn_date || '').slice(0, 4),
                cleared_status: t.cleared_status || 'Cleared',
              })
            }
          }
        }
        totalNetChange = runningTotal
        totalEndingBalance = runningTotal
        groups.push({
          account_id: 'FALLBACK',
          account_qb_id: 'FALLBACK',
          account_name: rawNameParam,
          fully_qualified_name: rawNameParam,
          account_type: 'Account',
          is_balance_sheet: false,
          beginning_balance: 0,
          transactions: allFlatRows,
          period_net_change: runningTotal,
          ending_balance: runningTotal,
        })
      }

      return respondReport(req, {
        reportType,
        company,
        basis,
        startDate,
        endDate,
        account: targetAccounts[0] || null,
        rows: allFlatRows,
        totalAmount: totalNetChange,
        totalBeginningBalance,
        totalEndingBalance,
        count: allFlatRows.length,
        quickReport: {
          title: reportTitle || targetAccounts[0]?.fully_qualified_name || targetAccounts[0]?.name || 'Transaction Report',
          subtitle: `${startDate || 'Inicio'} — ${endDate || 'Hoy'} (${basis})`,
          basis,
          isBalanceSheetReport: anyBalanceSheet,
          totalBeginningBalance,
          totalAmount: totalNetChange,
          totalEndingBalance,
          count: allFlatRows.length,
          groups,
          rows: allFlatRows,
        },
      })
    }

    // -------------------------------------------------------------------------
    // 10. A/R AGING SUMMARY & A/P AGING SUMMARY (`ar_aging` / `ap_aging`)
    //     Truly historical "As of Date": reconstructs open balance as of `asOfDate`
    //     by rolling back payments/credits applied after `asOfDate`.
    // -------------------------------------------------------------------------
    if (reportType === 'ar_aging' || reportType === 'ap_aging') {
      const isAr = reportType === 'ar_aging'
      const docType = isAr ? 'Invoice' : 'Bill'
      const creditType = isAr ? 'CreditMemo' : 'VendorCredit'
      const paymentType = isAr ? 'Payment' : 'BillPayment'
      const asOfMs = new Date(`${asOfDate}T12:00:00Z`).getTime()

      // Collect payments/credits dated > asOfDate that were applied to Invoices/Bills
      const paymentsAfterAsOfByTarget = new Map<string, number>()
      for (const pt of allTxns) {
        if (pt.is_voided) continue
        const pDate = String(pt.txn_date || '')
        if (pDate <= asOfDate) continue
        if (pt.txn_type !== paymentType && pt.txn_type !== creditType) continue

        const rawLines = Array.isArray(pt.raw_data?.Line) ? pt.raw_data.Line : []
        if (rawLines.length > 0) {
          for (const rl of rawLines) {
            for (const lt of Array.isArray(rl.LinkedTxn) ? rl.LinkedTxn : []) {
              if (!lt?.TxnId) continue
              const k = `${lt.TxnType || docType}:${lt.TxnId}`
              const amt = Number(lt.Amount ?? rl.Amount ?? 0)
              paymentsAfterAsOfByTarget.set(k, r2((paymentsAfterAsOfByTarget.get(k) || 0) + amt))
            }
          }
        } else {
          for (const nl of Array.isArray(pt.line_items) ? pt.line_items : []) {
            if (!nl?.linked_txn_id) continue
            const k = `${nl.linked_txn_type || docType}:${nl.linked_txn_id}`
            const amt = Number(nl.amount ?? 0)
            paymentsAfterAsOfByTarget.set(k, r2((paymentsAfterAsOfByTarget.get(k) || 0) + amt))
          }
        }
      }

      const rowsByEntity = new Map<
        string,
        {
          name: string
          entity_name: string
          entity_qb_id: string | null
          current: number
          days1_30: number
          days_1_30: number
          days31_60: number
          days_31_60: number
          days61_90: number
          days_61_90: number
          over90: number
          days_91_plus: number
          total: number
          count: number
          transactions: any[]
        }
      >()

      for (const t of allTxns) {
        if (t.is_voided) continue
        const d = String(t.txn_date || '')
        if (d > asOfDate) continue
        if (t.txn_type !== docType && t.txn_type !== creditType) continue

        const currentOpen = Number(t.open_balance ?? t.raw_data?.Balance ?? 0)
        const totalDocAmt = Number(t.total_amount ?? t.raw_data?.TotalAmt ?? currentOpen)
        const rolledBackAfterAsOf = paymentsAfterAsOfByTarget.get(`${t.txn_type}:${t.qb_txn_id}`) || 0
        const historicalAbsOpen = Math.min(totalDocAmt, r2(currentOpen + rolledBackAfterAsOf))

        const openAmt = t.txn_type === docType ? historicalAbsOpen : -historicalAbsOpen
        if (Math.abs(openAmt) < 0.009) continue

        const entityName = String(t.entity_name || (isAr ? 'Unassigned Customer' : 'Unassigned Vendor')).trim()
        const key = entityName.toLowerCase()
        let entry = rowsByEntity.get(key)
        if (!entry) {
          entry = {
            name: entityName,
            entity_name: entityName,
            entity_qb_id: t.entity_qb_id ? String(t.entity_qb_id) : null,
            current: 0,
            days1_30: 0,
            days_1_30: 0,
            days31_60: 0,
            days_31_60: 0,
            days61_90: 0,
            days_61_90: 0,
            over90: 0,
            days_91_plus: 0,
            total: 0,
            count: 0,
            transactions: [],
          }
          rowsByEntity.set(key, entry)
        }

        const dueStr = String(t.due_date || t.txn_date || asOfDate).slice(0, 10)
        const diffDays = Math.floor((asOfMs - new Date(`${dueStr}T12:00:00Z`).getTime()) / 86400000)

        if (diffDays <= 0) {
          entry.current = r2(entry.current + openAmt)
        } else if (diffDays <= 30) {
          entry.days1_30 = r2(entry.days1_30 + openAmt)
          entry.days_1_30 = entry.days1_30
        } else if (diffDays <= 60) {
          entry.days31_60 = r2(entry.days31_60 + openAmt)
          entry.days_31_60 = entry.days31_60
        } else if (diffDays <= 90) {
          entry.days61_90 = r2(entry.days61_90 + openAmt)
          entry.days_61_90 = entry.days61_90
        } else {
          entry.over90 = r2(entry.over90 + openAmt)
          entry.days_91_plus = entry.over90
        }

        entry.total = r2(entry.total + openAmt)
        entry.count += 1
        entry.transactions.push({
          id: t.id,
          qb_txn_id: t.qb_txn_id,
          txn_date: t.txn_date,
          due_date: dueStr,
          txn_type: t.txn_type,
          doc_number: t.doc_number || '',
          entity_name: entityName,
          memo: t.memo || '',
          total_amount: r2(Number(t.total_amount || 0)),
          open_balance: r2(openAmt),
          days_past_due: Math.max(0, diffDays),
        })
      }

      const rows = Array.from(rowsByEntity.values())
        .filter(r => Math.abs(r.total) >= 0.01)
        .sort((a, b) => b.total - a.total)

      const totals = rows.reduce(
        (acc, r) => ({
          current: r2(acc.current + r.current),
          days1_30: r2(acc.days1_30 + r.days1_30),
          days_1_30: r2(acc.days_1_30 + r.days_1_30),
          days31_60: r2(acc.days31_60 + r.days31_60),
          days_31_60: r2(acc.days_31_60 + r.days_31_60),
          days61_90: r2(acc.days61_90 + r.days61_90),
          days_61_90: r2(acc.days_61_90 + r.days_61_90),
          over90: r2(acc.over90 + r.over90),
          days_91_plus: r2(acc.days_91_plus + r.days_91_plus),
          total: r2(acc.total + r.total),
          count: acc.count + r.count,
        }),
        {
          current: 0,
          days1_30: 0,
          days_1_30: 0,
          days31_60: 0,
          days_31_60: 0,
          days61_90: 0,
          days_61_90: 0,
          over90: 0,
          days_91_plus: 0,
          total: 0,
          count: 0,
        }
      )

      return respondReport(req, {
        reportType,
        company,
        asOfDate,
        rows,
        totals,
        agingReport: {
          asOfDate,
          rows,
          totals,
        },
      })
    }

    // -------------------------------------------------------------------------
    // 11. STATEMENT OF CASH FLOWS (`cash_flow`)
    // -------------------------------------------------------------------------
    if (reportType === 'cash_flow') {
      const effectiveStartDate = startDate || fiscalYearStart(asOfDate, fiscalStartMonth)
      const begDate = dayBefore(effectiveStartDate)
      const endMap = balanceAsOf(asOfDate)
      const begMap = balanceAsOf(begDate)

      let netIncome = 0
      for (const t of allTxns) {
        const d = String(t.txn_date || '')
        if (t.is_voided || d < effectiveStartDate || d > asOfDate) continue
        for (const p of postingsOf(t)) {
          const acc = ledgerCtx.accounts.get(p.account_qb_id)
          if (isProfitLossAccount(acc)) {
            netIncome = r2(netIncome - p.amount)
          }
        }
      }

      const operatingAdjustments: Array<{ name: string; account_qb_id: string; amount: number }> = []
      const investingRows: Array<{ name: string; account_qb_id: string; amount: number }> = []
      const financingRows: Array<{ name: string; account_qb_id: string; amount: number }> = []
      let beginningCash = 0
      let endingCash = 0

      for (const a of accounts) {
        const idStr = String(a.qb_account_id)
        const aType = String(a.account_type || '')
        const endDp = endMap.get(idStr) ?? 0
        const begDp = begMap.get(idStr) ?? 0
        const deltaDp = r2(endDp - begDp)

        if (aType === 'Bank') {
          beginningCash = r2(beginningCash + begDp)
          endingCash = r2(endingCash + endDp)
          continue
        }

        if (Math.abs(deltaDp) < 0.01) continue
        // Cash flow impact of a non-cash Balance Sheet account change = -delta(debit-positive balance)
        const cashEffect = r2(-deltaDp)
        const displayName = a.fully_qualified_name || a.name || idStr

        if (
          aType === 'Accounts Receivable' ||
          aType === 'Other Current Asset' ||
          aType === 'Accounts Payable' ||
          aType === 'Credit Card' ||
          aType === 'Other Current Liability'
        ) {
          operatingAdjustments.push({ name: displayName, account_qb_id: idStr, amount: cashEffect })
        } else if (aType === 'Fixed Asset' || aType === 'Other Asset') {
          investingRows.push({ name: displayName, account_qb_id: idStr, amount: cashEffect })
        } else if (aType === 'Long Term Liability' || aType === 'Equity') {
          financingRows.push({ name: displayName, account_qb_id: idStr, amount: cashEffect })
        }
      }

      const netCashInvesting = r2(investingRows.reduce((s, r) => s + r.amount, 0))
      const netCashFinancing = r2(financingRows.reduce((s, r) => s + r.amount, 0))
      const netCashChange = r2(endingCash - beginningCash)

      let totalOperatingAdjustments = r2(operatingAdjustments.reduce((s, r) => s + r.amount, 0))
      let netCashOperating = r2(netIncome + totalOperatingAdjustments)
      const cashResidual = r2(netCashChange - (netCashOperating + netCashInvesting + netCashFinancing))
      if (Math.abs(cashResidual) >= 0.01) {
        operatingAdjustments.push({
          name: 'Prior-Period / Unclassified Working Capital Adjustment',
          account_qb_id: 'WORKING_CAPITAL_RECONCILIATION',
          amount: cashResidual,
        })
        totalOperatingAdjustments = r2(operatingAdjustments.reduce((s, r) => s + r.amount, 0))
        netCashOperating = r2(netIncome + totalOperatingAdjustments)
      }

      const reconciledVariance = r2(netCashChange - (netCashOperating + netCashInvesting + netCashFinancing))

      return respondReport(req, {
        reportType,
        company,
        startDate: effectiveStartDate,
        endDate: asOfDate,
        cashFlow: {
          netIncome,
          operatingAdjustments,
          totalOperatingAdjustments,
          netCashOperating,
          investingRows,
          netCashInvesting,
          financingRows,
          netCashFinancing,
          netCashChange,
          netCashIncrease: netCashChange,
          beginningCash,
          endingCash,
          reconciledVariance,
          isReconciled: Math.abs(reconciledVariance) < 0.01,
        },
      })
    }

    // -------------------------------------------------------------------------
    // 12. TAX & 1099 CONTRACTOR SUMMARY (`tax_summary`)
    // -------------------------------------------------------------------------
    if (reportType === 'tax_summary') {
      const vendorMap = new Map<
        string,
        {
          name: string
          vendor_name: string
          vendor_qb_id: string | null
          tax_id: string
          is_1099_tracked: boolean
          check_payments: number
          card_payments: number
          total_paid: number
          count: number
          eligible_1099: boolean
          transactions: any[]
        }
      >()

      const contactByQbId = new Map<string, any>()
      const contactByName = new Map<string, any>()
      for (const c of contacts) {
        if (c.qb_contact_id) contactByQbId.set(String(c.qb_contact_id), c)
        if (c.display_name) contactByName.set(String(c.display_name).toLowerCase(), c)
      }

      let taxTotalIncome = 0
      let taxTotalExpenses = 0
      forEachPlPosting((acc, p) => {
        if (isIncomeAccount(acc)) taxTotalIncome = r2(taxTotalIncome - p.amount)
        else if (isExpenseAccount(acc)) taxTotalExpenses = r2(taxTotalExpenses + p.amount)
      })

      for (const t of activeTxns) {
        if (!['Check', 'Expense', 'BillPayment', 'CreditCardExpense'].includes(String(t.txn_type))) continue
        const amt = Number(t.total_amount || 0)
        if (amt <= 0) continue

        const vName = String(t.entity_name || 'Unassigned Vendor').trim()
        const matchedCon =
          (t.entity_qb_id && contactByQbId.get(String(t.entity_qb_id))) ||
          contactByName.get(vName.toLowerCase()) ||
          null

        const key = vName.toLowerCase()
        let row = vendorMap.get(key)
        if (!row) {
          row = {
            name: vName,
            vendor_name: vName,
            vendor_qb_id: t.entity_qb_id ? String(t.entity_qb_id) : matchedCon?.qb_contact_id || null,
            tax_id: matchedCon?.tax_identifier || matchedCon?.raw_data?.TaxIdentifier || '',
            is_1099_tracked: Boolean(matchedCon?.vendor_1099 || matchedCon?.track_1099 || matchedCon?.raw_data?.Vendor1099),
            check_payments: 0,
            card_payments: 0,
            total_paid: 0,
            count: 0,
            eligible_1099: false,
            transactions: [],
          }
          vendorMap.set(key, row)
        }

        const isCard = t.txn_type === 'CreditCardExpense' || String(t.payment_type || '').toLowerCase().includes('credit')
        if (isCard) row.card_payments = r2(row.card_payments + amt)
        else row.check_payments = r2(row.check_payments + amt)
        row.total_paid = r2(row.total_paid + amt)
        row.count += 1
        row.eligible_1099 = row.check_payments >= 600 || row.is_1099_tracked
        row.transactions.push({
          id: t.id,
          txn_date: t.txn_date,
          txn_type: t.txn_type,
          doc_number: t.doc_number || '',
          account_name: t.account_name || '',
          category_summary: t.category_summary || '',
          memo: t.memo || '',
          amount: r2(amt),
        })
      }

      const allVendorRows = Array.from(vendorMap.values()).sort((a, b) => b.total_paid - a.total_paid)
      const eligibleRows = allVendorRows.filter(r => r.eligible_1099)
      const rows = only1099 ? eligibleRows : allVendorRows
      const total1099Paid = r2(eligibleRows.reduce((s, r) => s + r.check_payments, 0))

      return respondReport(req, {
        reportType,
        company,
        basis,
        startDate,
        endDate,
        customization: customizationMeta,
        rows,
        eligible1099Count: eligibleRows.length,
        totalCheckPayments: r2(rows.reduce((s, r) => s + r.check_payments, 0)),
        totalCardPayments: r2(rows.reduce((s, r) => s + r.card_payments, 0)),
        totalPaid: r2(rows.reduce((s, r) => s + r.total_paid, 0)),
        taxSummary: {
          totalIncome: taxTotalIncome,
          totalExpenses: taxTotalExpenses,
          netTaxableIncome: r2(taxTotalIncome - taxTotalExpenses),
          total1099Paid,
          contractors1099: rows,
        },
      })
    }

    // -------------------------------------------------------------------------
    // 13. TRANSACTION LIST BY DATE (`transaction_list_by_date` & `estimates_progress`)
    // -------------------------------------------------------------------------
    if (reportType === 'transaction_list_by_date') {
      const isEstimatesOnly = rawReportType === 'estimates_progress'
      const rows = activeTxns
        .filter(t => isEstimatesOnly ? t.txn_type === 'Estimate' : (t.txn_type !== 'Estimate' && t.txn_type !== 'PurchaseOrder'))
        .sort((a, b) => String(a.txn_date || '').localeCompare(String(b.txn_date || '')))
        .map(t => ({
          id: t.id,
          qb_txn_id: t.qb_txn_id,
          txn_date: t.txn_date,
          txn_type: t.txn_type,
          doc_number: t.doc_number || '',
          entity_name: t.entity_name || '—',
          memo: t.memo || '',
          account_name: t.account_name || '—',
          category_summary: t.category_summary || t.to_account_name || '—',
          split_account: t.category_summary || t.to_account_name || '—',
          amount: r2(Number(t.total_amount || 0)),
          total_amount: r2(Number(t.total_amount || 0)),
          cleared_status: t.cleared_status || 'Cleared',
        }))

      const totalAmount = r2(rows.reduce((s, r) => s + r.amount, 0))
      return respondReport(req, {
        reportType,
        company,
        startDate,
        endDate,
        rows,
        count: rows.length,
        totalAmount,
        detailReport: {
          rows,
          count: rows.length,
          totalAmount,
        },
      })
    }

    // -------------------------------------------------------------------------
    // 14. SALES TAX LIABILITY REPORT (`sales_tax_liability`)
    // -------------------------------------------------------------------------
    if (reportType === 'sales_tax_liability') {
      const balMap = balanceAsOf(asOfDate)
      const taxAccounts = accounts.filter((a: any) => {
        const nm = String(a.fully_qualified_name || a.name || '').toLowerCase()
        const st = String(a.account_sub_type || '').toLowerCase()
        return (
          st.includes('salestax') ||
          st.includes('taxpayable') ||
          nm.includes('sales tax') ||
          nm.includes('tax payable') ||
          nm.includes('cdtfa') ||
          nm.includes('board of equalization')
        )
      })
      const taxAccIds = new Set<string>(taxAccounts.map((a: any) => String(a.qb_account_id)))

      const incomeByAccount = new Map<
        string,
        {
          account_qb_id: string
          name: string
          type: string
          gross_sales: number
          taxable_sales: number
          non_taxable_sales: number
          tax_collected: number
          tax_paid: number
          tax_liability_balance: number
        }
      >()

      let totalGrossSales = 0
      let totalTaxableSales = 0
      let totalNonTaxableSales = 0
      let totalTaxCollected = 0
      let totalTaxPaid = 0

      forEachPlPosting((acc, p, t) => {
        if (!isIncomeAccount(acc)) return
        const amt = r2(-p.amount)
        if (Math.abs(amt) < 0.005) return
        const idStr = String(acc.qb_account_id)
        const dispName = acc.fully_qualified_name || acc.name || idStr
        let row = incomeByAccount.get(idStr)
        if (!row) {
          row = {
            account_qb_id: idStr,
            name: dispName,
            type: acc.account_type || 'Income',
            gross_sales: 0,
            taxable_sales: 0,
            non_taxable_sales: 0,
            tax_collected: 0,
            tax_paid: 0,
            tax_liability_balance: 0,
          }
          incomeByAccount.set(idStr, row)
        }
        row.gross_sales = r2(row.gross_sales + amt)
        totalGrossSales = r2(totalGrossSales + amt)

        const rawTax = Number(t?.raw_data?.TxnTaxDetail?.TotalTax || 0)
        if (rawTax > 0) {
          row.taxable_sales = r2(row.taxable_sales + amt)
          totalTaxableSales = r2(totalTaxableSales + amt)
        } else {
          row.non_taxable_sales = r2(row.non_taxable_sales + amt)
          totalNonTaxableSales = r2(totalNonTaxableSales + amt)
        }
      })

      const taxTransactions: any[] = []
      for (const t of activeTxns) {
        for (const p of postingsOf(t)) {
          if (!taxAccIds.has(p.account_qb_id)) continue
          const acc = ledgerCtx.accounts.get(p.account_qb_id)
          const dispName = acc?.fully_qualified_name || acc?.name || p.account_qb_id
          let row = incomeByAccount.get(p.account_qb_id)
          if (!row) {
            row = {
              account_qb_id: p.account_qb_id,
              name: dispName,
              type: acc?.account_type || 'Other Current Liability',
              gross_sales: 0,
              taxable_sales: 0,
              non_taxable_sales: 0,
              tax_collected: 0,
              tax_paid: 0,
              tax_liability_balance: 0,
            }
            incomeByAccount.set(p.account_qb_id, row)
          }
          if (p.amount < 0) {
            const collected = r2(-p.amount)
            row.tax_collected = r2(row.tax_collected + collected)
            totalTaxCollected = r2(totalTaxCollected + collected)
          } else if (p.amount > 0) {
            const paid = r2(p.amount)
            row.tax_paid = r2(row.tax_paid + paid)
            totalTaxPaid = r2(totalTaxPaid + paid)
          }
          taxTransactions.push({
            id: t.id,
            txn_date: t.txn_date,
            txn_type: t.txn_type,
            doc_number: t.doc_number || '',
            entity_name: t.entity_name || '—',
            account_name: dispName,
            memo: p.memo || t.memo || '',
            amount: r2(-p.amount),
          })
        }
      }

      let endingTaxLiability = 0
      for (const ta of taxAccounts) {
        const idStr = String(ta.qb_account_id)
        const rawBal = balMap.get(idStr) || 0
        const natBal = r2(toNaturalBalance(ta, rawBal))
        endingTaxLiability = r2(endingTaxLiability + natBal)
        const existing = incomeByAccount.get(idStr)
        if (existing) {
          existing.tax_liability_balance = natBal
        } else if (Math.abs(natBal) > 0.005) {
          incomeByAccount.set(idStr, {
            account_qb_id: idStr,
            name: ta.fully_qualified_name || ta.name || idStr,
            type: ta.account_type || 'Other Current Liability',
            gross_sales: 0,
            taxable_sales: 0,
            non_taxable_sales: 0,
            tax_collected: 0,
            tax_paid: 0,
            tax_liability_balance: natBal,
          })
        }
      }

      const rows = Array.from(incomeByAccount.values()).sort((a, b) => b.gross_sales - a.gross_sales)
      return respondReport(req, {
        reportType,
        company,
        basis,
        startDate,
        endDate: asOfDate,
        rows,
        salesTaxLiability: {
          rows,
          taxAccountsCount: taxAccounts.length,
          totalGrossSales,
          totalTaxableSales,
          totalNonTaxableSales,
          totalTaxCollected,
          totalTaxPaid,
          endingTaxLiability,
          taxTransactions,
        },
      })
    }

    // -------------------------------------------------------------------------
    // 15. INVENTORY VALUATION & PRODUCT/SERVICE SUMMARY (`inventory_valuation`)
    // -------------------------------------------------------------------------
    if (reportType === 'inventory_valuation') {
      const balMap = balanceAsOf(asOfDate)
      const invAssetAccounts = accounts.filter((a: any) => {
        const nm = String(a.fully_qualified_name || a.name || '').toLowerCase()
        const st = String(a.account_sub_type || '').toLowerCase()
        return st.includes('inventory') || nm.includes('inventory')
      })
      let glInventoryBalance = 0
      for (const ia of invAssetAccounts) {
        glInventoryBalance = r2(glInventoryBalance + toNaturalBalance(ia, balMap.get(String(ia.qb_account_id)) || 0))
      }

      // Track both period activity (`activeTxns` within [startDate, asOfDate]) AND historical rollback after `asOfDate` (`allTxns` with `txn_date > asOfDate`)
      const itemStats = new Map<string, {
        unitsSoldPeriod: number
        revenuePeriod: number
        costPeriod: number
        unitsSoldAfterAsOf: number
        unitsPurchasedAfterAsOf: number
        valueAfterAsOfDelta: number
      }>()

      for (const t of allTxns) {
        if (t.is_voided) continue
        const d = String(t.txn_date || '')
        const isInPeriod = (!startDate || d >= startDate) && (!asOfDate || d <= asOfDate)
        const isAfterAsOf = Boolean(asOfDate && d > asOfDate)
        if (!isInPeriod && !isAfterAsOf) continue

        const lines = Array.isArray(t.line_items) ? t.line_items : []
        for (const l of lines) {
          const itemId = String(l.item_qb_id || l.item_id || '').trim()
          const itemName = String(l.item_name || '').trim().toLowerCase()
          const matchedIt =
            (itemId && itemByIdMap.get(itemId)) ||
            (itemName && itemByNameMap.get(itemName)) ||
            null
          if (!matchedIt) continue
          const key = String(matchedIt.qb_item_id)
          const cur = itemStats.get(key) || {
            unitsSoldPeriod: 0,
            revenuePeriod: 0,
            costPeriod: 0,
            unitsSoldAfterAsOf: 0,
            unitsPurchasedAfterAsOf: 0,
            valueAfterAsOfDelta: 0,
          }
          const qty = Number(l.qty || l.quantity || 1)
          const amt = Number(l.amount || 0)

          if (['Invoice', 'SalesReceipt', 'CreditMemo', 'RefundReceipt'].includes(String(t.txn_type))) {
            const sign = t.txn_type === 'CreditMemo' || t.txn_type === 'RefundReceipt' ? -1 : 1
            if (isInPeriod) {
              cur.unitsSoldPeriod = r2(cur.unitsSoldPeriod + qty * sign)
              cur.revenuePeriod = r2(cur.revenuePeriod + amt * sign)
            }
            if (isAfterAsOf) {
              cur.unitsSoldAfterAsOf = r2(cur.unitsSoldAfterAsOf + qty * sign)
            }
          } else if (['Bill', 'Check', 'Expense', 'VendorCredit'].includes(String(t.txn_type))) {
            const pSign = t.txn_type === 'VendorCredit' ? -1 : 1
            if (isInPeriod) {
              cur.costPeriod = r2(cur.costPeriod + amt * pSign)
            }
            if (isAfterAsOf) {
              cur.unitsPurchasedAfterAsOf = r2(cur.unitsPurchasedAfterAsOf + qty * pSign)
              cur.valueAfterAsOfDelta = r2(cur.valueAfterAsOfDelta + amt * pSign)
            }
          }
          itemStats.set(key, cur)
        }
      }

      const rows = (items || [])
        .filter((it: any) => it.is_active !== false)
        .map((it: any) => {
          const st = itemStats.get(String(it.qb_item_id)) || {
            unitsSoldPeriod: 0,
            revenuePeriod: 0,
            costPeriod: 0,
            unitsSoldAfterAsOf: 0,
            unitsPurchasedAfterAsOf: 0,
            valueAfterAsOfDelta: 0,
          }
          const currentQtyOnHand = Number(it.qty_on_hand ?? it.raw_data?.QtyOnHand ?? 0)
          const purchaseCost = Number(it.purchase_cost ?? it.raw_data?.PurchaseCost ?? 0)
          const unitPrice = Number(it.unit_price ?? it.raw_data?.UnitPrice ?? 0)
          const isInventoryType = String(it.item_type || '').toLowerCase() === 'inventory'
          // Roll back inventory quantity from current state to historical `asOfDate`:
          // Qty(asOf) = Qty(current) + SoldAfter(asOf) - PurchasedAfter(asOf)
          const historicalQtyOnHand = isInventoryType
            ? r2(currentQtyOnHand + st.unitsSoldAfterAsOf - st.unitsPurchasedAfterAsOf)
            : currentQtyOnHand
          const effectiveUnitCost = purchaseCost || unitPrice
          const assetValue = isInventoryType
            ? r2(Math.max(0, historicalQtyOnHand * effectiveUnitCost - st.valueAfterAsOfDelta))
            : 0
          return {
            id: it.id,
            qb_item_id: String(it.qb_item_id),
            name: it.fully_qualified_name || it.name || String(it.qb_item_id),
            item_type: it.item_type || 'Service',
            sku: it.sku || '',
            qty_on_hand: historicalQtyOnHand,
            current_qty_on_hand: currentQtyOnHand,
            purchase_cost: r2(purchaseCost),
            unit_price: r2(unitPrice),
            asset_value: assetValue,
            units_sold_period: st.unitsSoldPeriod,
            sales_revenue_period: st.revenuePeriod,
            purchases_period: st.costPeriod,
            income_account_name: it.income_account_name || '—',
            expense_account_name: it.expense_account_name || '—',
            as_of_date: asOfDate,
          }
        })
        .sort((a: any, b: any) => b.asset_value - a.asset_value || b.sales_revenue_period - a.sales_revenue_period)

      const totalQtyOnHand = r2(rows.reduce((s: number, r: any) => s + r.qty_on_hand, 0))
      const totalAssetValue = r2(rows.reduce((s: number, r: any) => s + r.asset_value, 0))
      const totalPeriodRevenue = r2(rows.reduce((s: number, r: any) => s + r.sales_revenue_period, 0))
      const totalInventoryItems = rows.filter((r: any) => String(r.item_type).toLowerCase() === 'inventory').length

      return respondReport(req, {
        reportType,
        company,
        asOfDate,
        startDate,
        endDate: asOfDate,
        rows,
        inventoryValuation: {
          asOfDate,
          rows,
          totalItems: rows.length,
          totalInventoryItems,
          totalQtyOnHand,
          totalAssetValue: totalAssetValue > 0 ? totalAssetValue : glInventoryBalance,
          glInventoryBalance,
          totalPeriodRevenue,
        },
      })
    }

    // -------------------------------------------------------------------------
    // 16. BUDGET VS. ACTUALS REPORT (`budget_vs_actual`)
    // -------------------------------------------------------------------------
    if (reportType === 'budget_vs_actual') {
      const fy = Number((endDate || startDate || '2026').slice(0, 4)) || 2026
      const { data: companyBudgets, error: budgetErr } = await fetchAllTableRows(
        supabase,
        'external_accounting_budgets',
        {
          realmId,
          eq: { fiscal_year: fy },
          orders: [{ column: 'account_name', ascending: true }],
        }
      )
      if (budgetErr) throw budgetErr

      const startMonth = startDate ? Math.max(1, Math.min(12, Number(startDate.slice(5, 7)) || 1)) : 1
      const endMonth = endDate ? Math.max(startMonth, Math.min(12, Number(endDate.slice(5, 7)) || 12)) : 12

      const budgetByAccountId = new Map<string, number>()
      for (const b of companyBudgets || []) {
        const mObj = b.monthly_amounts && typeof b.monthly_amounts === 'object' ? b.monthly_amounts : {}
        let sumBudget = 0
        for (let m = startMonth; m <= endMonth; m++) {
          const k = String(m).padStart(2, '0')
          sumBudget += Number(mObj[k] ?? mObj[String(m)] ?? 0)
        }
        if (sumBudget === 0 && Number(b.annual_total || 0) > 0) {
          const monthsCount = endMonth - startMonth + 1
          sumBudget = (Number(b.annual_total) * monthsCount) / 12
        }
        budgetByAccountId.set(String(b.account_qb_id), r2(sumBudget))
      }

      const actualByAccountId = new Map<string, number>()
      forEachPlPosting((acc, p) => {
        const idStr = String(acc.qb_account_id)
        const signedAmt = isIncomeAccount(acc) ? -p.amount : p.amount
        actualByAccountId.set(idStr, r2((actualByAccountId.get(idStr) || 0) + signedAmt))
      })

      const plAccounts = accounts.filter((a: any) => isProfitLossAccount(a) && a.is_active !== false)
      const rows: any[] = []
      let budgetIncome = 0
      let actualIncome = 0
      let budgetExpenses = 0
      let actualExpenses = 0

      for (const acc of plAccounts) {
        const idStr = String(acc.qb_account_id)
        const actualAmt = r2(actualByAccountId.get(idStr) || 0)
        const budgetAmt = r2(budgetByAccountId.get(idStr) || 0)
        if (Math.abs(actualAmt) < 0.005 && Math.abs(budgetAmt) < 0.005) continue
        const varianceAmt = r2(actualAmt - budgetAmt)
        const pctOfBudget = Math.abs(budgetAmt) > 0.005 ? r2((actualAmt / budgetAmt) * 100) : actualAmt > 0 ? 100 : 0
        const isInc = isIncomeAccount(acc)
        if (isInc) {
          budgetIncome = r2(budgetIncome + budgetAmt)
          actualIncome = r2(actualIncome + actualAmt)
        } else {
          budgetExpenses = r2(budgetExpenses + budgetAmt)
          actualExpenses = r2(actualExpenses + actualAmt)
        }
        rows.push({
          account_qb_id: idStr,
          account_name: acc.fully_qualified_name || acc.name || idStr,
          account_type: acc.account_type || (isInc ? 'Income' : 'Expense'),
          is_income: isInc,
          actual_amount: actualAmt,
          budget_amount: budgetAmt,
          variance_amount: varianceAmt,
          pct_of_budget: pctOfBudget,
        })
      }

      rows.sort((a, b) => {
        if (a.is_income !== b.is_income) return a.is_income ? -1 : 1
        return Math.abs(b.actual_amount) - Math.abs(a.actual_amount)
      })

      const budgetNetIncome = r2(budgetIncome - budgetExpenses)
      const actualNetIncome = r2(actualIncome - actualExpenses)
      const varianceNetIncome = r2(actualNetIncome - budgetNetIncome)

      return respondReport(req, {
        reportType,
        company,
        basis,
        startDate,
        endDate: asOfDate,
        rows,
        budgetVsActual: {
          fiscalYear: fy,
          startMonth,
          endMonth,
          hasSavedBudgets: (companyBudgets || []).length > 0,
          savedBudgetsCount: (companyBudgets || []).length,
          rows,
          totals: {
            budgetIncome,
            actualIncome,
            varianceIncome: r2(actualIncome - budgetIncome),
            budgetExpenses,
            actualExpenses,
            varianceExpenses: r2(actualExpenses - budgetExpenses),
            budgetNetIncome,
            actualNetIncome,
            varianceNetIncome,
          },
        },
      })
    }

    // -------------------------------------------------------------------------
    // 17. FINANCIAL KPIs & RATIOS SCORECARD (`kpi_scorecard`)
    // -------------------------------------------------------------------------
    if (reportType === 'kpi_scorecard') {
      const balMap = balanceAsOf(asOfDate)
      const eqRoll = equityRollForward(asOfDate)

      let cashAndBanks = 0
      let accountsReceivable = 0
      let otherCurrentAssets = 0
      let fixedAssets = 0
      let otherAssets = 0
      let accountsPayable = 0
      let creditCards = 0
      let otherCurrentLiabilities = 0
      let longTermLiabilities = 0
      let statedEquity = 0

      for (const a of accounts) {
        if (!isBalanceSheetAccountType(a)) continue
        const idStr = String(a.qb_account_id)
        const rawBal = retainedEarningsIds.has(idStr) ? eqRoll.retainedEarningsDebitPositive : (balMap.get(idStr) || 0)
        const nat = r2(toNaturalBalance(a, rawBal))
        if (Math.abs(nat) < 0.005) continue
        switch (a.account_type) {
          case 'Bank':
            cashAndBanks = r2(cashAndBanks + nat)
            break
          case 'Accounts Receivable':
            accountsReceivable = r2(accountsReceivable + nat)
            break
          case 'Other Current Asset':
            otherCurrentAssets = r2(otherCurrentAssets + nat)
            break
          case 'Fixed Asset':
            fixedAssets = r2(fixedAssets + nat)
            break
          case 'Other Asset':
            otherAssets = r2(otherAssets + nat)
            break
          case 'Accounts Payable':
            accountsPayable = r2(accountsPayable + nat)
            break
          case 'Credit Card':
            creditCards = r2(creditCards + nat)
            break
          case 'Other Current Liability':
            otherCurrentLiabilities = r2(otherCurrentLiabilities + nat)
            break
          case 'Long Term Liability':
            longTermLiabilities = r2(longTermLiabilities + nat)
            break
          case 'Equity':
            statedEquity = r2(statedEquity + nat)
            break
        }
      }

      const totalCurrentAssets = r2(cashAndBanks + accountsReceivable + otherCurrentAssets)
      const totalAssets = r2(totalCurrentAssets + fixedAssets + otherAssets)
      const totalCurrentLiabilities = r2(accountsPayable + creditCards + otherCurrentLiabilities)
      const totalLiabilities = r2(totalCurrentLiabilities + longTermLiabilities)
      const totalEquity = r2(statedEquity + eqRoll.netIncome)

      let totalIncome = 0
      let totalCogs = 0
      let operatingExpenses = 0
      let otherExpenses = 0
      forEachPlPosting((acc, p) => {
        if (isIncomeAccount(acc)) {
          totalIncome = r2(totalIncome - p.amount)
        } else if (acc.account_type === 'Cost of Goods Sold') {
          totalCogs = r2(totalCogs + p.amount)
        } else if (acc.account_type === 'Expense') {
          operatingExpenses = r2(operatingExpenses + p.amount)
        } else if (acc.account_type === 'Other Expense') {
          otherExpenses = r2(otherExpenses + p.amount)
        }
      })

      const grossProfit = r2(totalIncome - totalCogs)
      const netOperatingIncome = r2(grossProfit - operatingExpenses)
      const netIncome = r2(netOperatingIncome - otherExpenses)

      const safeDiv = (num: number, den: number): number | null =>
        Math.abs(den) > 0.005 ? r2(num / den) : null

      const currentRatio = safeDiv(totalCurrentAssets, totalCurrentLiabilities)
      const quickRatio = safeDiv(cashAndBanks + accountsReceivable, totalCurrentLiabilities)
      const workingCapital = r2(totalCurrentAssets - totalCurrentLiabilities)
      const grossMarginPct = totalIncome > 0.005 ? r2((grossProfit / totalIncome) * 100) : 0
      const operatingMarginPct = totalIncome > 0.005 ? r2((netOperatingIncome / totalIncome) * 100) : 0
      const netMarginPct = totalIncome > 0.005 ? r2((netIncome / totalIncome) * 100) : 0
      const roaPct = Math.abs(totalAssets) > 0.005 ? r2((netIncome / totalAssets) * 100) : 0
      const roePct = Math.abs(totalEquity) > 0.005 ? r2((netIncome / totalEquity) * 100) : 0
      const debtToAssetsPct = Math.abs(totalAssets) > 0.005 ? r2((totalLiabilities / totalAssets) * 100) : 0
      const debtToEquityRatio = safeDiv(totalLiabilities, totalEquity)

      const kpis = [
        {
          key: 'current_ratio',
          category: 'Liquidity',
          name: 'Current Ratio',
          formula: 'Current Assets / Current Liabilities',
          value: currentRatio,
          formattedValue: currentRatio !== null ? `${currentRatio.toFixed(2)}x` : 'N/A (Zero Current Liabilities)',
          benchmark: '≥ 1.50x',
          status: currentRatio === null || currentRatio >= 1.5 ? 'Healthy' : currentRatio >= 1.0 ? 'Watch' : 'Attention',
        },
        {
          key: 'quick_ratio',
          category: 'Liquidity',
          name: 'Quick Ratio (Acid Test)',
          formula: '(Cash + A/R) / Current Liabilities',
          value: quickRatio,
          formattedValue: quickRatio !== null ? `${quickRatio.toFixed(2)}x` : 'N/A (Zero Current Liabilities)',
          benchmark: '≥ 1.00x',
          status: quickRatio === null || quickRatio >= 1.0 ? 'Healthy' : quickRatio >= 0.75 ? 'Watch' : 'Attention',
        },
        {
          key: 'working_capital',
          category: 'Liquidity',
          name: 'Working Capital',
          formula: 'Current Assets - Current Liabilities',
          value: workingCapital,
          formattedValue: formatCurrencyForPdf(workingCapital),
          benchmark: '> $0.00',
          status: workingCapital >= 0 ? 'Healthy' : 'Attention',
        },
        {
          key: 'gross_margin',
          category: 'Profitability',
          name: 'Gross Profit Margin',
          formula: 'Gross Profit / Total Income',
          value: grossMarginPct,
          formattedValue: `${grossMarginPct.toFixed(1)}%`,
          benchmark: '≥ 50.0%',
          status: grossMarginPct >= 50 ? 'Healthy' : grossMarginPct >= 25 ? 'Watch' : 'Attention',
        },
        {
          key: 'operating_margin',
          category: 'Profitability',
          name: 'Operating Profit Margin',
          formula: 'Net Operating Income / Total Income',
          value: operatingMarginPct,
          formattedValue: `${operatingMarginPct.toFixed(1)}%`,
          benchmark: '≥ 15.0%',
          status: operatingMarginPct >= 15 ? 'Healthy' : operatingMarginPct >= 5 ? 'Watch' : 'Attention',
        },
        {
          key: 'net_margin',
          category: 'Profitability',
          name: 'Net Profit Margin',
          formula: 'Net Income / Total Income',
          value: netMarginPct,
          formattedValue: `${netMarginPct.toFixed(1)}%`,
          benchmark: '≥ 10.0%',
          status: netMarginPct >= 10 ? 'Healthy' : netMarginPct >= 0 ? 'Watch' : 'Attention',
        },
        {
          key: 'roa',
          category: 'Efficiency & Return',
          name: 'Return on Assets (ROA)',
          formula: 'Net Income / Total Assets',
          value: roaPct,
          formattedValue: `${roaPct.toFixed(1)}%`,
          benchmark: '≥ 5.0%',
          status: roaPct >= 5 ? 'Healthy' : roaPct >= 0 ? 'Watch' : 'Attention',
        },
        {
          key: 'roe',
          category: 'Efficiency & Return',
          name: 'Return on Equity (ROE)',
          formula: 'Net Income / Total Equity',
          value: roePct,
          formattedValue: `${roePct.toFixed(1)}%`,
          benchmark: '≥ 10.0%',
          status: roePct >= 10 ? 'Healthy' : roePct >= 0 ? 'Watch' : 'Attention',
        },
        {
          key: 'debt_to_assets',
          category: 'Leverage & Solvency',
          name: 'Debt-to-Assets Ratio',
          formula: 'Total Liabilities / Total Assets',
          value: debtToAssetsPct,
          formattedValue: `${debtToAssetsPct.toFixed(1)}%`,
          benchmark: '≤ 60.0%',
          status: debtToAssetsPct <= 60 ? 'Healthy' : debtToAssetsPct <= 80 ? 'Watch' : 'Attention',
        },
        {
          key: 'debt_to_equity',
          category: 'Leverage & Solvency',
          name: 'Debt-to-Equity Ratio',
          formula: 'Total Liabilities / Total Equity',
          value: debtToEquityRatio,
          formattedValue: debtToEquityRatio !== null ? `${debtToEquityRatio.toFixed(2)}x` : 'N/A',
          benchmark: '≤ 2.00x',
          status: debtToEquityRatio === null || (debtToEquityRatio >= 0 && debtToEquityRatio <= 2.0) ? 'Healthy' : 'Watch',
        },
      ]

      return respondReport(req, {
        reportType,
        company,
        basis,
        asOfDate,
        startDate,
        endDate: asOfDate,
        rows: kpis,
        kpiScorecard: {
          asOfDate,
          startDate,
          endDate: asOfDate,
          summary: {
            cashAndBanks,
            accountsReceivable,
            totalCurrentAssets,
            fixedAssets,
            totalAssets,
            accountsPayable,
            totalCurrentLiabilities,
            longTermLiabilities,
            totalLiabilities,
            totalEquity,
            totalIncome,
            grossProfit,
            netOperatingIncome,
            netIncome,
          },
          kpis,
        },
      })
    }

    return NextResponse.json({ error: `Unsupported reportType: ${reportType}` }, { status: 400 })
  } catch (err: any) {
    console.error('[GET /api/external-accounting/reports] Error:', err)
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 })
  }
}
