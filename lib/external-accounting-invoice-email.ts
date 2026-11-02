/**
 * @module lib/external-accounting-invoice-email
 * @description Generador oficial de documentos PDF estilo QuickBooks Online (Statement Invoice, Standard Invoice,
 * Payment Receipt, Sales Receipt, Estimate, Credit Memo, Refund Receipt y los 3 tipos de Customer Statement:
 * Balance Forward, Open Item y Transaction Statement) con paginación multi-página real y despachador SMTP
 * automático de correos electrónicos con el PDF adjunto para las 8 razones sociales de Contabilidad Externa.
 *
 * @businessRules
 * - Formato PDF 1:1 idéntico al estándar de QuickBooks Online:
 *   1. Encabezado con Razón Social, Dirección Fiscal, Teléfono y Correo de la empresa emisora.
 *   2. Título dinámico ("INVOICE", "PAYMENT RECEIPT", "SALES RECEIPT", "ESTIMATE", "CREDIT MEMO", "REFUND RECEIPT", "STATEMENT")
 *      en azul pizarra (#6b96b3), bloque "BILL TO" / "RECEIVED FROM" y metadatos derechos.
 *   3. En Statement Invoices: Tabla 1 ("ACCOUNT SUMMARY") + Tabla 2 ("DESCRIPTION | QTY | RATE | AMOUNT").
 *   4. Paginación multi-página automática (`doc.addPage()`) cuando las líneas superan el alto de página Letter.
 *   5. Estados de cuenta ("STATEMENT") soportan los 3 modos oficiales de QBO:
 *      - `balance_forward`: Saldo inicial a `startDate`, movimientos en `[startDate, endDate]` con saldo corrido y Aging Buckets.
 *      - `open_item`: Facturas y cargos abiertos al `endDate` con monto original, saldo abierto y Aging Buckets.
 *      - `transaction_statement`: Listado de transacciones del rango `[startDate, endDate]` con totales de cargos y pagos.
 *
 * @dataFlow
 * - POST /api/external-accounting (`send_invoice_email`, `generate_invoice_pdf`, `generate_statement_pdf`, `send_statement_email`)
 *   -> `generateQboInvoicePdfBuffer()` / `generateQboStatementPdfBuffer()` -> `sendQboInvoiceEmail()` / `sendQboStatementEmail()`.
 */

import nodemailer from 'nodemailer'
import { jsPDF } from 'jspdf'

export type QboDocumentType =
  | 'Invoice'
  | 'Estimate'
  | 'SalesReceipt'
  | 'Payment'
  | 'CreditMemo'
  | 'RefundReceipt'

export interface QboInvoiceLineItem {
  itemName: string
  description?: string
  qty?: number | string | null
  rate: number
  amount: number
}

export interface QboInvoiceAccountSummary {
  priorInvoiceDate?: string | null
  dayBeforeInvoiceDate?: string | null
  balanceForward: number
  paymentsAndCredits: number
  otherInvoicesSameDate: number
  newCharges: number
  totalAmountDue: number
}

export interface QboInvoicePdfInput {
  docType?: QboDocumentType
  includeAccountSummary?: boolean
  isReminder?: boolean
  companyName: string
  companyAddressLines: string[]
  companyPhone?: string
  companyEmail?: string
  invoiceNumber: string
  invoiceDate: string // YYYY-MM-DD or MM/DD/YYYY
  dueDate: string     // YYYY-MM-DD or MM/DD/YYYY
  terms: string
  paymentMethod?: string
  referenceNumber?: string
  depositToAccount?: string
  billToLines: string[]
  contactGreetingName: string
  customerDisplayName: string
  customerEmail?: string
  accountSummary: QboInvoiceAccountSummary
  lineItems: QboInvoiceLineItem[]
  totalNewCharges: number
  balanceDue: number
  memo?: string
}

export function formatUsDateSlash(dateStr?: string | null): string {
  if (!dateStr) return ''
  const clean = String(dateStr).trim().slice(0, 10)
  const m = clean.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (m) {
    return `${m[2]}/${m[3]}/${m[1]}`
  }
  return clean
}

export function subtractOneDayIso(dateStr: string): string {
  const clean = String(dateStr || '').trim().slice(0, 10)
  const m = clean.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return clean
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  d.setDate(d.getDate() - 1)
  const yy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

function fmtAmount(num: number, withDollar = false): string {
  const n = Number(num || 0)
  const absFormatted = Math.abs(n).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  if (n < 0) {
    return withDollar ? `-$${absFormatted}` : `-${absFormatted}`
  }
  return withDollar ? `$${absFormatted}` : absFormatted
}

/**
 * Calcula dinámicamente el bloque "ACCOUNT SUMMARY" de QuickBooks Online para un inquilino/cliente
 * a partir del historial de transacciones (facturas y pagos previos) en la empresa activa.
 */
export function computeTenantAccountSummary(
  currentInvoice: {
    id?: string
    doc_number?: string
    txn_date: string
    total_amount: number
  },
  tenantTransactions: Array<{
    id?: string
    txn_type?: string
    doc_number?: string
    txn_date?: string
    total_amount?: number
    is_voided?: boolean
  }>,
  _contact?: any
): QboInvoiceAccountSummary {
  const invDate = String(currentInvoice.txn_date || '').slice(0, 10)
  const newCharges = Math.round(Number(currentInvoice.total_amount || 0) * 100) / 100

  const validTxns = (tenantTransactions || []).filter(
    (t) => !t.is_voided && t.id !== currentInvoice.id
  )

  const priorInvoices = validTxns
    .filter(
      (t) =>
        t.txn_type === 'Invoice' &&
        String(t.txn_date || '').slice(0, 10) < invDate
    )
    .sort((a, b) =>
      String(b.txn_date || '').localeCompare(String(a.txn_date || ''))
    )

  const latestPriorInvoice = priorInvoices[0] || null
  const priorInvoiceDate = latestPriorInvoice
    ? String(latestPriorInvoice.txn_date || '').slice(0, 10)
    : null
  const dayBeforeInvoiceDate = invDate ? subtractOneDayIso(invDate) : null

  const balanceForward = latestPriorInvoice
    ? Math.round(Number(latestPriorInvoice.total_amount || 0) * 100) / 100
    : 0

  let paymentsSum = 0
  if (priorInvoiceDate) {
    for (const t of validTxns) {
      const d = String(t.txn_date || '').slice(0, 10)
      if (d >= priorInvoiceDate && d < invDate) {
        if (t.txn_type === 'Payment' || t.txn_type === 'CreditMemo') {
          paymentsSum += Number(t.total_amount || 0)
        }
      }
    }
  }
  const paymentsAndCredits = -Math.round(paymentsSum * 100) / 100

  const sameDateInvoicesSum = validTxns
    .filter(
      (t) =>
        t.txn_type === 'Invoice' &&
        String(t.txn_date || '').slice(0, 10) === invDate &&
        String(t.doc_number || '') !== String(currentInvoice.doc_number || '')
    )
    .reduce((acc, t) => acc + Number(t.total_amount || 0), 0)

  const otherInvoicesSameDate = Math.round(sameDateInvoicesSum * 100) / 100
  const totalAmountDue =
    Math.round(
      (balanceForward + paymentsAndCredits + otherInvoicesSameDate + newCharges) *
        100
    ) / 100

  return {
    priorInvoiceDate,
    dayBeforeInvoiceDate,
    balanceForward,
    paymentsAndCredits,
    otherInvoicesSameDate,
    newCharges,
    totalAmountDue: Math.max(0, totalAmountDue),
  }
}

function getDocTypeMeta(docType: QboDocumentType) {
  switch (docType) {
    case 'Payment':
      return {
        title: 'PAYMENT RECEIPT',
        billToLabel: 'RECEIVED FROM',
        numLabel: 'PAYMENT #',
        dateLabel: 'PAYMENT DATE',
        totalLabelTop: 'TOTAL APPLIED',
        totalLabelBottom: 'AMOUNT RECEIVED',
        filePrefix: 'Payment_Receipt',
        emailBannerTitle: 'Thank you for your payment!',
        emailBannerLabel: 'AMOUNT RECEIVED',
      }
    case 'SalesReceipt':
      return {
        title: 'SALES RECEIPT',
        billToLabel: 'SOLD TO',
        numLabel: 'RECEIPT #',
        dateLabel: 'SALES DATE',
        totalLabelTop: 'TOTAL',
        totalLabelBottom: 'AMOUNT PAID',
        filePrefix: 'Sales_Receipt',
        emailBannerTitle: 'Your sales receipt is ready!',
        emailBannerLabel: 'AMOUNT PAID',
      }
    case 'Estimate':
      return {
        title: 'ESTIMATE',
        billToLabel: 'ADDRESS',
        numLabel: 'ESTIMATE #',
        dateLabel: 'DATE',
        totalLabelTop: 'SUBTOTAL',
        totalLabelBottom: 'ESTIMATE TOTAL',
        filePrefix: 'Estimate',
        emailBannerTitle: 'Your estimate is ready for review!',
        emailBannerLabel: 'ESTIMATE TOTAL',
      }
    case 'CreditMemo':
      return {
        title: 'CREDIT MEMO',
        billToLabel: 'CREDIT TO',
        numLabel: 'CREDIT #',
        dateLabel: 'CREDIT DATE',
        totalLabelTop: 'SUBTOTAL',
        totalLabelBottom: 'TOTAL CREDIT',
        filePrefix: 'Credit_Memo',
        emailBannerTitle: 'Your credit memo is attached',
        emailBannerLabel: 'TOTAL CREDIT',
      }
    case 'RefundReceipt':
      return {
        title: 'REFUND RECEIPT',
        billToLabel: 'REFUND TO',
        numLabel: 'REFUND #',
        dateLabel: 'REFUND DATE',
        totalLabelTop: 'SUBTOTAL',
        totalLabelBottom: 'TOTAL REFUNDED',
        filePrefix: 'Refund_Receipt',
        emailBannerTitle: 'Your refund receipt is ready',
        emailBannerLabel: 'TOTAL REFUNDED',
      }
    case 'Invoice':
    default:
      return {
        title: 'INVOICE',
        billToLabel: 'BILL TO',
        numLabel: 'INVOICE #',
        dateLabel: 'DATE',
        totalLabelTop: 'TOTAL OF NEW CHARGES',
        totalLabelBottom: 'BALANCE DUE',
        filePrefix: 'Invoice',
        emailBannerTitle: 'Your invoice is ready!',
        emailBannerLabel: 'BALANCE DUE',
      }
  }
}

/**
 * Genera el archivo PDF binario (Buffer) con diseño idéntico al PDF oficial de QuickBooks Online
 * y paginación multi-página automática.
 */
export function generateQboInvoicePdfBuffer(input: QboInvoicePdfInput): Buffer {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'pt',
    format: 'letter', // 612 x 792 pt
  })

  const docType: QboDocumentType = input.docType || 'Invoice'
  const metaCfg = getDocTypeMeta(docType)
  const pageWidth = 612
  const leftMargin = 48
  const rightMargin = pageWidth - 48
  const bandHeight = 18

  let pageNumber = 1
  const drawPageFooter = (pNum: number) => {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(140, 140, 140)
    doc.text(`Page ${pNum}`, rightMargin, 760, { align: 'right' })
  }

  const drawLineItemsTableHeader = (yPos: number) => {
    doc.setFillColor(220, 232, 240) // #dce8f0
    doc.rect(leftMargin - 30, yPos - 12, pageWidth - (leftMargin - 30) * 2, bandHeight, 'F')

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.setTextColor(92, 135, 166)
    if (docType === 'Payment') {
      doc.text('DESCRIPTION / APPLIED INVOICE', leftMargin, yPos)
      doc.text('ORIGINAL AMOUNT', 440, yPos, { align: 'right' })
      doc.text('PAYMENT APPLIED', rightMargin, yPos, { align: 'right' })
    } else {
      doc.text('DESCRIPTION', leftMargin, yPos)
      doc.text('QTY', 380, yPos, { align: 'right' })
      doc.text('RATE', 480, yPos, { align: 'right' })
      doc.text('AMOUNT', rightMargin, yPos, { align: 'right' })
    }
  }

  // 1. Company Header Block (x = 178pt, top = 46pt — exact QBO positioning)
  let compY = 46
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10.5)
  doc.setTextColor(20, 20, 20)
  doc.text(input.companyName || 'Company', 178, compY)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9.5)
  doc.setTextColor(35, 35, 35)
  for (const line of input.companyAddressLines || []) {
    if (!line || !line.trim()) continue
    compY += 13
    doc.text(line.trim(), 178, compY)
  }
  if (input.companyPhone) {
    compY += 13
    doc.text(input.companyPhone.trim(), 178, compY)
  }
  if (input.companyEmail) {
    compY += 13
    doc.text(input.companyEmail.trim(), 178, compY)
  }

  // 2. Document Title in QBO Slate Blue (#6b96b3)
  const invoiceTitleY = Math.max(compY + 26, 134)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(20)
  doc.setTextColor(107, 150, 179)
  doc.text(metaCfg.title, leftMargin, invoiceTitleY)

  // 3. BILL TO / RECEIVED FROM (Left) & DOCUMENT META (Right)
  const billToStartY = invoiceTitleY + 24
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(20, 20, 20)
  doc.text(metaCfg.billToLabel, leftMargin, billToStartY)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9.5)
  doc.setTextColor(30, 30, 30)
  let billY = billToStartY + 14
  for (const bLine of input.billToLines || []) {
    if (!bLine || !bLine.trim()) continue
    doc.text(bLine.trim(), leftMargin, billY)
    billY += 13
  }

  // Right Meta Labels & Values
  const metaLabelRightX = 460
  const metaValueLeftX = 466
  let metaY = billToStartY
  const metaRows: Array<[string, string]> = [
    [metaCfg.numLabel, String(input.invoiceNumber || '')],
    [metaCfg.dateLabel, formatUsDateSlash(input.invoiceDate)],
  ]

  if (docType === 'Invoice') {
    metaRows.push(['DUE DATE', formatUsDateSlash(input.dueDate || input.invoiceDate)])
    metaRows.push(['TERMS', String(input.terms || 'Due on receipt')])
  } else if (docType === 'Estimate') {
    if (input.dueDate) metaRows.push(['EXPIRATION DATE', formatUsDateSlash(input.dueDate)])
  } else if (docType === 'Payment' || docType === 'SalesReceipt' || docType === 'RefundReceipt') {
    if (input.paymentMethod) metaRows.push(['PAYMENT METHOD', String(input.paymentMethod)])
    if (input.referenceNumber) metaRows.push(['REF #', String(input.referenceNumber)])
    if (input.depositToAccount) metaRows.push(['ACCOUNT', String(input.depositToAccount)])
  }

  for (const [lbl, val] of metaRows) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(20, 20, 20)
    doc.text(lbl, metaLabelRightX, metaY, { align: 'right' })

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9.5)
    doc.setTextColor(30, 30, 30)
    doc.text(String(val || '').slice(0, 26), metaValueLeftX, metaY)
    metaY += 13.5
  }

  // 4. Horizontal Divider Line
  const dividerY = Math.max(billY, metaY) + 18
  doc.setDrawColor(190, 205, 218)
  doc.setLineWidth(0.75)
  doc.line(leftMargin, dividerY, rightMargin, dividerY)

  let curY = dividerY + 26

  // 5. Table 1: ACCOUNT SUMMARY (Only for Statement Invoices when enabled)
  const showAccountSummary =
    docType === 'Invoice' && input.includeAccountSummary !== false && Boolean(input.accountSummary)

  if (showAccountSummary) {
    doc.setFillColor(220, 232, 240) // #dce8f0 QBO light blue band
    doc.rect(leftMargin - 30, curY - 12, pageWidth - (leftMargin - 30) * 2, bandHeight, 'F')

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.setTextColor(92, 135, 166) // #5c87a6
    doc.text('DATE', leftMargin, curY)
    doc.text('ACCOUNT SUMMARY', 138, curY)
    doc.text('AMOUNT', rightMargin, curY, { align: 'right' })

    curY += 20
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9.5)
    doc.setTextColor(25, 25, 25)

    const sum = input.accountSummary
    const priorDateFormatted = sum.priorInvoiceDate
      ? formatUsDateSlash(sum.priorInvoiceDate)
      : formatUsDateSlash(input.invoiceDate)
    const throughDateFormatted = sum.dayBeforeInvoiceDate
      ? formatUsDateSlash(sum.dayBeforeInvoiceDate)
      : formatUsDateSlash(input.invoiceDate)

    const summaryRows: Array<{ date: string; label: string; amount: string }> = [
      {
        date: priorDateFormatted,
        label: 'Balance Forward',
        amount: fmtAmount(sum.balanceForward),
      },
      {
        date: '',
        label: sum.priorInvoiceDate
          ? `Other payments and credits after ${priorDateFormatted} through ${throughDateFormatted}`
          : 'Other payments and credits',
        amount: fmtAmount(sum.paymentsAndCredits),
      },
      {
        date: formatUsDateSlash(input.invoiceDate),
        label: 'Other invoices from this date',
        amount: fmtAmount(sum.otherInvoicesSameDate),
      },
      {
        date: '',
        label: 'New charges (details below)',
        amount: fmtAmount(sum.newCharges),
      },
      {
        date: '',
        label: 'Total Amount Due',
        amount: fmtAmount(sum.totalAmountDue),
      },
    ]

    for (const sRow of summaryRows) {
      if (sRow.date) {
        doc.text(sRow.date, leftMargin, curY)
      }
      doc.text(sRow.label, 138, curY)
      doc.text(sRow.amount, rightMargin, curY, { align: 'right' })
      curY += 17
    }

    curY += 14
  }

  // 6. Table 2: Line Items Table with Multi-Page Pagination
  drawLineItemsTableHeader(curY)
  curY += 20

  const linesToRender =
    input.lineItems && input.lineItems.length > 0
      ? input.lineItems
      : [
          {
            itemName: docType === 'Payment' ? 'Payment Applied' : 'Services',
            description: input.memo || '',
            qty: 1,
            rate: input.totalNewCharges || input.balanceDue,
            amount: input.totalNewCharges || input.balanceDue,
          },
        ]

  for (const item of linesToRender) {
    const descLines =
      item.description &&
      item.description.trim() &&
      item.description.trim() !== String(item.itemName || '').trim()
        ? doc.splitTextToSize(item.description.trim(), 270)
        : []
    const neededHeight = 20 + descLines.length * 12

    if (curY + neededHeight > 695) {
      drawPageFooter(pageNumber)
      doc.addPage()
      pageNumber += 1
      curY = 56
      drawLineItemsTableHeader(curY)
      curY += 20
    }

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9.5)
    doc.setTextColor(20, 20, 20)
    doc.text(String(item.itemName || 'Item').slice(0, 52), leftMargin, curY)

    doc.setFont('helvetica', 'normal')
    if (docType === 'Payment') {
      doc.text(fmtAmount(item.rate || item.amount), 440, curY, { align: 'right' })
      doc.text(fmtAmount(item.amount), rightMargin, curY, { align: 'right' })
    } else {
      const qtyStr =
        item.qty !== undefined &&
        item.qty !== null &&
        String(item.qty) !== '' &&
        Number(item.qty) !== 1
          ? String(item.qty)
          : ''
      if (qtyStr) {
        doc.text(qtyStr, 380, curY, { align: 'right' })
      }
      doc.text(fmtAmount(item.rate), 480, curY, { align: 'right' })
      doc.text(fmtAmount(item.amount), rightMargin, curY, { align: 'right' })
    }

    if (descLines.length > 0) {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(9.2)
      doc.setTextColor(50, 50, 50)
      for (const dLine of descLines) {
        curY += 12
        doc.text(String(dLine), leftMargin, curY)
      }
    }
    curY += 20
  }

  // 7. Dotted Divider Line + Bottom Totals (ensure room on page)
  if (curY + 80 > 730) {
    drawPageFooter(pageNumber)
    doc.addPage()
    pageNumber += 1
    curY = 60
  }

  curY += 6
  doc.setDrawColor(160, 160, 160)
  doc.setLineDashPattern([1.5, 2.5], 0)
  doc.line(leftMargin, curY, rightMargin, curY)
  doc.setLineDashPattern([], 0)

  curY += 18

  // Optional Memo on the left side of footer
  if (input.memo && input.memo.trim()) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.setTextColor(95, 95, 95)
    const memoLines = doc.splitTextToSize(input.memo.trim(), 230)
    doc.text(memoLines.slice(0, 4), leftMargin, curY)
  }

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9.5)
  doc.setTextColor(30, 30, 30)

  if (docType === 'Invoice') {
    doc.text('TOTAL OF NEW', 312, curY)
    doc.text(fmtAmount(input.totalNewCharges), rightMargin, curY, { align: 'right' })
    curY += 12
    doc.text('CHARGES', 312, curY)
    curY += 18
    doc.text('BALANCE DUE', 312, curY)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(15)
    doc.setTextColor(15, 15, 15)
    doc.text(fmtAmount(input.balanceDue, true), rightMargin, curY + 1, { align: 'right' })
  } else {
    doc.text(metaCfg.totalLabelTop, 312, curY)
    doc.text(fmtAmount(input.totalNewCharges), rightMargin, curY, { align: 'right' })
    curY += 22
    doc.text(metaCfg.totalLabelBottom, 312, curY)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(15)
    doc.setTextColor(15, 15, 15)
    const primaryTotal =
      docType === 'Payment' || docType === 'SalesReceipt' || docType === 'Estimate' || docType === 'CreditMemo' || docType === 'RefundReceipt'
        ? input.totalNewCharges || input.balanceDue
        : input.balanceDue
    doc.text(fmtAmount(primaryTotal, true), rightMargin, curY + 1, { align: 'right' })
  }

  if (pageNumber > 1) {
    drawPageFooter(pageNumber)
  }

  const arrayBuf = doc.output('arraybuffer')
  return Buffer.from(arrayBuf)
}

function escapeHtml(str: string): string {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Genera el cuerpo HTML del correo electrónico idéntico al de QuickBooks Online
 * (soportando Invoice, Overdue Reminder, Payment Receipt, Sales Receipt, Estimate, Credit Memo, Refund Receipt).
 */
export function generateQboInvoiceEmailHtml(
  input: QboInvoicePdfInput,
  customMessage?: string
): string {
  const docType: QboDocumentType = input.docType || 'Invoice'
  const metaCfg = getDocTypeMeta(docType)
  const displayAmount =
    docType === 'Invoice' ? input.balanceDue : input.totalNewCharges || input.balanceDue
  const balanceFormatted = fmtAmount(displayAmount, true)
  const addressSingleLine = (input.companyAddressLines || []).filter(Boolean).join(' ')
  const greetingName = input.contactGreetingName || input.customerDisplayName || 'Valued Customer'

  const bannerBg = input.isReminder ? '#fef3c7' : '#dce8f0'
  const bannerTitle = input.isReminder
    ? `Reminder: Invoice #${input.invoiceNumber} is past due`
    : metaCfg.emailBannerTitle
  const pillLabel = `${metaCfg.filePrefix.replace(/_/g, ' ')} #${input.invoiceNumber} Attached (PDF)`

  const defaultBodyHtml =
    docType === 'Payment'
      ? `<p style="margin: 0 0 16px 0;">Thank you for your payment of <strong>${escapeHtml(balanceFormatted)}</strong>. Your official payment receipt is attached to this email for your records.</p>`
      : docType === 'SalesReceipt'
      ? `<p style="margin: 0 0 16px 0;">Thank you for your purchase! Your sales receipt is attached to this email for your records.</p>`
      : docType === 'Estimate'
      ? `<p style="margin: 0 0 16px 0;">Please find attached our estimate for your review. Let us know if you have any questions.</p>`
      : docType === 'CreditMemo'
      ? `<p style="margin: 0 0 16px 0;">Please find attached your credit memo for <strong>${escapeHtml(balanceFormatted)}</strong>.</p>`
      : input.isReminder
      ? `<p style="margin: 0 0 8px 0;">This is a friendly reminder that Invoice #${escapeHtml(input.invoiceNumber)} (Due ${escapeHtml(formatUsDateSlash(input.dueDate || input.invoiceDate))}) has an open balance of <strong>${escapeHtml(balanceFormatted)}</strong>.</p>
         <p style="margin: 0 0 18px 0;">Please remit payment at your earliest convenience. If you have already sent payment, please disregard this notice.</p>`
      : `<p style="margin: 0 0 4px 0;">Your invoice is attached. Please remit payment at your earliest convenience.</p>
         <p style="margin: 0 0 18px 0;">Thank you for your business - we appreciate it very much.</p>`

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(metaCfg.filePrefix.replace(/_/g, ' '))} #${escapeHtml(input.invoiceNumber)} from ${escapeHtml(input.companyName)}</title>
</head>
<body style="margin: 0; padding: 24px 12px; background-color: #ffffff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 0 auto; border-collapse: collapse;">
    <!-- TOP BANNER -->
    <tr>
      <td style="background-color: ${bannerBg}; padding: 32px 24px; text-align: center; border-radius: 4px;">
        <div style="font-size: 16px; font-weight: 700; color: #1e293b; margin-bottom: 18px;">
          ${escapeHtml(bannerTitle)}
        </div>
        <div style="font-size: 10px; font-weight: 600; letter-spacing: 1px; color: #475569; text-transform: uppercase; margin-bottom: 6px;">
          ${escapeHtml(metaCfg.emailBannerLabel)}
        </div>
        <div style="font-size: 32px; font-weight: 500; color: #1e293b;">
          ${escapeHtml(balanceFormatted)}
        </div>
      </td>
    </tr>

    <!-- GREEN PILL BUTTON -->
    <tr>
      <td style="padding: 28px 24px 18px 24px; text-align: center;">
        <span style="display: inline-block; background-color: #108000; color: #ffffff; font-size: 14px; font-weight: 700; padding: 12px 44px; border-radius: 999px; text-decoration: none;">
          ${escapeHtml(pillLabel)}
        </span>
      </td>
    </tr>

    <!-- PERSONALIZED MESSAGE -->
    <tr>
      <td style="padding: 16px 32px 28px 32px; font-size: 14px; line-height: 1.6; color: #1e293b;">
        <p style="margin: 0 0 16px 0;">Dear ${escapeHtml(greetingName)},</p>
        ${
          customMessage && customMessage.trim()
            ? `<p style="margin: 0 0 16px 0; white-space: pre-line;">${escapeHtml(customMessage.trim())}</p>`
            : defaultBodyHtml
        }
        <p style="margin: 0;">Sincerely,<br /><strong>${escapeHtml(input.companyName)}</strong></p>
      </td>
    </tr>

    <!-- BOTTOM LIGHT-BLUE COMPANY CARD -->
    <tr>
      <td style="background-color: #dce8f0; padding: 24px; text-align: center; border-radius: 4px; font-size: 12px; line-height: 1.6; color: #334155;">
        <div style="font-weight: 700; color: #1e293b; margin-bottom: 6px;">
          ${escapeHtml(input.companyName)}
        </div>
        ${
          addressSingleLine
            ? `<div style="color: #2563eb; margin-bottom: 6px;">${escapeHtml(addressSingleLine)}</div>`
            : ''
        }
        <div>
          ${input.companyPhone ? `<span style="color: #2563eb; margin-right: 12px;">${escapeHtml(input.companyPhone)}</span>` : ''}
          ${input.companyEmail ? `<a href="mailto:${escapeHtml(input.companyEmail)}" style="color: #2563eb; text-decoration: underline;">${escapeHtml(input.companyEmail)}</a>` : ''}
        </div>
      </td>
    </tr>

    <!-- SECURITY FOOTER -->
    <tr>
      <td style="padding: 20px 16px; text-align: center; font-size: 11px; color: #64748b;">
        If you receive an email that seems fraudulent, please check with the business owner before paying.
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim()
}

/**
 * Envía por correo electrónico el documento (HTML estilo QBO + archivo PDF adjunto)
 * usando Nodemailer SMTP.
 */
export async function sendQboInvoiceEmail(options: {
  pdfInput: QboInvoicePdfInput
  toEmails: string[]
  ccEmails?: string[]
  subject?: string
  customMessage?: string
}): Promise<{
  success: boolean
  messageId?: string
  recipients: string[]
  filename: string
  pdfBase64: string
  error?: string
}> {
  const { pdfInput, toEmails, ccEmails = [], subject, customMessage } = options
  const docType: QboDocumentType = pdfInput.docType || 'Invoice'
  const metaCfg = getDocTypeMeta(docType)
  const pdfBuffer = generateQboInvoicePdfBuffer(pdfInput)
  const safeComp = String(pdfInput.companyName || 'Company')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
  const filename = `${metaCfg.filePrefix}_${pdfInput.invoiceNumber || 'Draft'}_from_${safeComp}.pdf`
  const pdfBase64 = pdfBuffer.toString('base64')

  const smtpUser = process.env.SMTP_EMAIL || 'carlos@tacosgavilan.com'
  const smtpPass = process.env.SMTP_PASSWORD

  const cleanTo = toEmails.map((e) => e.trim()).filter(Boolean)
  const cleanCc = ccEmails.map((e) => e.trim()).filter(Boolean)

  if (!smtpPass) {
    return {
      success: false,
      recipients: cleanTo,
      filename,
      pdfBase64,
      error: 'SMTP_PASSWORD no configurado en el servidor.',
    }
  }

  if (cleanTo.length === 0) {
    return {
      success: false,
      recipients: [],
      filename,
      pdfBase64,
      error: 'Debe especificar al menos un correo destinatario.',
    }
  }

  const defaultSubject = pdfInput.isReminder
    ? `Reminder: Invoice #${pdfInput.invoiceNumber} from ${pdfInput.companyName}`
    : `${metaCfg.filePrefix.replace(/_/g, ' ')} #${pdfInput.invoiceNumber} from ${pdfInput.companyName}`

  const finalSubject = subject && subject.trim() ? subject.trim() : defaultSubject
  const html = generateQboInvoiceEmailHtml(pdfInput, customMessage)

  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    })

    const info = await transporter.sendMail({
      from: `"${pdfInput.companyName}" <${smtpUser}>`,
      replyTo: pdfInput.companyEmail || 'raquel@tacosgavilan.com',
      to: cleanTo.join(', '),
      cc: cleanCc.length > 0 ? cleanCc.join(', ') : undefined,
      subject: finalSubject,
      html,
      attachments: [
        {
          filename,
          content: pdfBuffer,
          contentType: 'application/pdf',
        },
      ],
    })

    return {
      success: true,
      messageId: info.messageId,
      recipients: [...cleanTo, ...cleanCc],
      filename,
      pdfBase64,
    }
  } catch (err: any) {
    console.error('[QboInvoiceEmail] Error sending document email:', err)
    return {
      success: false,
      recipients: cleanTo,
      filename,
      pdfBase64,
      error: err?.message || 'Error enviando correo del documento',
    }
  }
}

export type QboStatementType = 'balance_forward' | 'open_item' | 'transaction_statement'

export interface QboStatementPdfInput {
  statementType?: QboStatementType
  startDate?: string
  endDate?: string
  companyName: string
  companyAddressLines: string[]
  companyPhone: string
  companyEmail: string
  statementDate: string
  customerDisplayName: string
  billToLines: string[]
  totalBalanceDue: number
  transactions: Array<{
    txn_date: string
    txn_type: string
    doc_number?: string
    due_date?: string
    total_amount: number
    open_balance?: number
    memo?: string
  }>
  aging: {
    current: number
    days1_30: number
    days31_60: number
    days61_90: number
    over90: number
  }
}

/**
 * Genera el PDF oficial de Estado de Cuenta ("STATEMENT") de QuickBooks Online para un Inquilino/Cliente
 * soportando los 3 modos oficiales (`balance_forward`, `open_item`, `transaction_statement`) y paginación multi-página.
 */
export function generateQboStatementPdfBuffer(input: QboStatementPdfInput): Buffer {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'pt',
    format: 'letter',
  })

  const stmtType: QboStatementType = input.statementType || 'balance_forward'
  const pageWidth = 612
  const leftMargin = 48
  const rightMargin = pageWidth - 48
  let pageNumber = 1

  const drawPageFooter = (pNum: number) => {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(140, 140, 140)
    doc.text(`Page ${pNum}`, rightMargin, 765, { align: 'right' })
  }

  const drawTableHeaderBand = (yPos: number) => {
    doc.setFillColor(219, 234, 254)
    doc.rect(leftMargin, yPos, rightMargin - leftMargin, 20, 'F')

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    doc.setTextColor(37, 99, 235)
    if (stmtType === 'open_item') {
      doc.text('DATE', leftMargin + 8, yPos + 13)
      doc.text('TRANSACTION', leftMargin + 82, yPos + 13)
      doc.text('DUE DATE', leftMargin + 260, yPos + 13)
      doc.text('ORIGINAL AMT', rightMargin - 95, yPos + 13, { align: 'right' })
      doc.text('OPEN BALANCE', rightMargin - 8, yPos + 13, { align: 'right' })
    } else if (stmtType === 'transaction_statement') {
      doc.text('DATE', leftMargin + 8, yPos + 13)
      doc.text('TRANSACTION', leftMargin + 82, yPos + 13)
      doc.text('AMOUNT', rightMargin - 8, yPos + 13, { align: 'right' })
    } else {
      doc.text('DATE', leftMargin + 8, yPos + 13)
      doc.text('ACTIVITY', leftMargin + 82, yPos + 13)
      doc.text('AMOUNT', rightMargin - 95, yPos + 13, { align: 'right' })
      doc.text('BALANCE', rightMargin - 8, yPos + 13, { align: 'right' })
    }
  }

  let y = 48
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(35, 39, 46)
  doc.text(input.companyName || 'Gutierrez Financial', leftMargin, y)
  y += 14

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9.5)
  doc.setTextColor(65, 72, 82)
  for (const line of input.companyAddressLines || []) {
    if (!line || !line.trim()) continue
    doc.text(line, leftMargin, y)
    y += 12.5
  }
  const contactLine = [input.companyPhone, input.companyEmail].filter(Boolean).join('   ')
  if (contactLine) {
    doc.text(contactLine, leftMargin, y)
    y += 14
  }

  // Right title: STATEMENT
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(20)
  doc.setTextColor(59, 130, 246)
  doc.text('STATEMENT', rightMargin, 60, { align: 'right' })

  const stmtModeLabel =
    stmtType === 'open_item'
      ? 'Open Item Statement'
      : stmtType === 'transaction_statement'
      ? 'Transaction Statement'
      : 'Balance Forward Statement'
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.setTextColor(100, 116, 139)
  doc.text(stmtModeLabel, rightMargin, 72, { align: 'right' })

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(80, 90, 102)
  doc.text('STATEMENT DATE', rightMargin - 165, 88)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(35, 39, 46)
  doc.text(formatUsDateSlash(input.statementDate), rightMargin, 88, { align: 'right' })

  if (input.startDate && stmtType !== 'open_item') {
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(80, 90, 102)
    doc.text('PERIOD', rightMargin - 165, 102)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(35, 39, 46)
    doc.text(
      `${formatUsDateSlash(input.startDate)} - ${formatUsDateSlash(input.endDate || input.statementDate)}`,
      rightMargin,
      102,
      { align: 'right' }
    )
  }

  doc.setFont('helvetica', 'bold')
  doc.setTextColor(80, 90, 102)
  doc.text('TOTAL AMOUNT DUE', rightMargin - 165, 116)
  doc.setTextColor(17, 24, 39)
  doc.text(fmtAmount(input.totalBalanceDue, true), rightMargin, 116, { align: 'right' })

  // TO Block
  let toY = Math.max(y + 18, 130)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(75, 85, 99)
  doc.text('TO', leftMargin, toY)
  toY += 14
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9.5)
  doc.setTextColor(35, 39, 46)
  for (const line of (input.billToLines || []).slice(0, 5)) {
    doc.text(line, leftMargin, toY)
    toY += 12.5
  }

  let tableY = Math.max(toY + 18, 214)
  drawTableHeaderBand(tableY)
  let rowY = tableY + 34

  const sorted = [...(input.transactions || [])].sort((a, b) => {
    const cmp = String(a.txn_date || '').localeCompare(String(b.txn_date || ''))
    if (cmp !== 0) return cmp
    const aOrder = a.txn_type === 'Invoice' ? 0 : 1
    const bOrder = b.txn_type === 'Invoice' ? 0 : 1
    return aOrder - bOrder
  })

  const startFilter = input.startDate ? String(input.startDate).slice(0, 10) : ''
  const endFilter = input.endDate ? String(input.endDate).slice(0, 10) : String(input.statementDate || '').slice(0, 10)

  const ensureRowSpace = () => {
    if (rowY > 645) {
      drawPageFooter(pageNumber)
      doc.addPage()
      pageNumber += 1
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(10)
      doc.setTextColor(80, 90, 102)
      doc.text(`${input.companyName} — STATEMENT (${input.customerDisplayName})`, leftMargin, 42)
      drawTableHeaderBand(52)
      rowY = 86
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(9)
      doc.setTextColor(35, 39, 46)
    }
  }

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(35, 39, 46)

  if (stmtType === 'open_item') {
    const openRows = sorted.filter((tx) => {
      const d = String(tx.txn_date || '').slice(0, 10)
      if (endFilter && d > endFilter) return false
      const openBal = tx.open_balance !== undefined ? Number(tx.open_balance) : Number(tx.total_amount || 0)
      return tx.txn_type === 'Invoice' ? openBal > 0.009 : false
    })

    for (const tx of openRows) {
      ensureRowSpace()
      const activityText = `${tx.txn_type}${tx.doc_number ? ` #${tx.doc_number}` : ''}`
      const openBal = tx.open_balance !== undefined ? Number(tx.open_balance) : Number(tx.total_amount || 0)
      doc.text(formatUsDateSlash(tx.txn_date), leftMargin + 8, rowY)
      doc.text(activityText.slice(0, 40), leftMargin + 82, rowY)
      doc.text(formatUsDateSlash(tx.due_date || tx.txn_date), leftMargin + 260, rowY)
      doc.text(fmtAmount(tx.total_amount, false), rightMargin - 95, rowY, { align: 'right' })
      doc.text(fmtAmount(openBal, false), rightMargin - 8, rowY, { align: 'right' })
      rowY += 16
    }
  } else if (stmtType === 'transaction_statement') {
    let totalCharges = 0
    let totalPayments = 0
    const periodRows = sorted.filter((tx) => {
      const d = String(tx.txn_date || '').slice(0, 10)
      if (startFilter && d < startFilter) return false
      if (endFilter && d > endFilter) return false
      return true
    })

    for (const tx of periodRows) {
      ensureRowSpace()
      const isCredit = tx.txn_type === 'Payment' || tx.txn_type === 'CreditMemo'
      const signedAmt = isCredit ? -Math.abs(Number(tx.total_amount || 0)) : Math.abs(Number(tx.total_amount || 0))
      if (isCredit) totalPayments += Math.abs(Number(tx.total_amount || 0))
      else totalCharges += Math.abs(Number(tx.total_amount || 0))

      const activityText = `${tx.txn_type}${tx.doc_number ? ` #${tx.doc_number}` : ''}${tx.memo ? ` - ${tx.memo}` : ''}`
      doc.text(formatUsDateSlash(tx.txn_date), leftMargin + 8, rowY)
      doc.text(activityText.slice(0, 68), leftMargin + 82, rowY)
      doc.text(fmtAmount(signedAmt, false), rightMargin - 8, rowY, { align: 'right' })
      rowY += 16
    }

    ensureRowSpace()
    rowY += 6
    doc.setFont('helvetica', 'bold')
    doc.text(`Total Charges: ${fmtAmount(totalCharges, true)}   |   Total Payments/Credits: ${fmtAmount(totalPayments, true)}`, rightMargin - 8, rowY, { align: 'right' })
    doc.setFont('helvetica', 'normal')
    rowY += 16
  } else {
    // balance_forward
    let runningBal = 0
    const withRunning = sorted.map((tx) => {
      const isCredit = tx.txn_type === 'Payment' || tx.txn_type === 'CreditMemo'
      const signedAmt = isCredit ? -Math.abs(Number(tx.total_amount || 0)) : Math.abs(Number(tx.total_amount || 0))
      runningBal = Math.round((runningBal + signedAmt) * 100) / 100
      return { tx, signedAmt, runningBal }
    })

    const beforeStart = startFilter
      ? withRunning.filter((r) => String(r.tx.txn_date || '').slice(0, 10) < startFilter)
      : []
    const inPeriod = withRunning.filter((r) => {
      const d = String(r.tx.txn_date || '').slice(0, 10)
      if (startFilter && d < startFilter) return false
      if (endFilter && d > endFilter) return false
      return true
    })

    if (beforeStart.length > 0) {
      const lastPrior = beforeStart[beforeStart.length - 1]
      doc.setFont('helvetica', 'bold')
      doc.text(formatUsDateSlash(startFilter || lastPrior.tx.txn_date), leftMargin + 8, rowY)
      doc.text('Balance Forward', leftMargin + 82, rowY)
      doc.text(fmtAmount(lastPrior.runningBal, false), rightMargin - 8, rowY, { align: 'right' })
      doc.setFont('helvetica', 'normal')
      rowY += 16
    }

    for (const item of inPeriod) {
      ensureRowSpace()
      const { tx, signedAmt, runningBal: rBal } = item
      const activityText = `${tx.txn_type}${tx.doc_number ? ` #${tx.doc_number}` : ''}${tx.due_date ? ` (Due ${formatUsDateSlash(tx.due_date)})` : ''}`
      doc.text(formatUsDateSlash(tx.txn_date), leftMargin + 8, rowY)
      doc.text(activityText.slice(0, 56), leftMargin + 82, rowY)
      doc.text(fmtAmount(signedAmt, false), rightMargin - 95, rowY, { align: 'right' })
      doc.text(fmtAmount(rBal, false), rightMargin - 8, rowY, { align: 'right' })
      rowY += 16
    }
  }

  // Aging buckets footer box on the final page
  if (rowY + 75 > 745) {
    drawPageFooter(pageNumber)
    doc.addPage()
    pageNumber += 1
    rowY = 70
  }

  const agingY = Math.max(rowY + 24, 670)
  const colW = (rightMargin - leftMargin) / 6
  const headers = [
    'CURRENT',
    '1-30 DAYS\nPAST DUE',
    '31-60 DAYS\nPAST DUE',
    '61-90 DAYS\nPAST DUE',
    'OVER 90 DAYS\nPAST DUE',
    'Amount Due',
  ]
  const values = [
    input.aging.current,
    input.aging.days1_30,
    input.aging.days31_60,
    input.aging.days61_90,
    input.aging.over90,
    input.totalBalanceDue,
  ]

  doc.setFillColor(239, 246, 255)
  doc.rect(leftMargin, agingY, rightMargin - leftMargin, 26, 'F')
  doc.setDrawColor(191, 219, 254)
  doc.rect(leftMargin, agingY, rightMargin - leftMargin, 48)

  for (let i = 0; i < 6; i++) {
    const cx = leftMargin + i * colW + colW / 2
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7.5)
    doc.setTextColor(37, 99, 235)
    const hLines = headers[i].split('\n')
    if (hLines.length === 1) {
      doc.text(hLines[0], cx, agingY + 16, { align: 'center' })
    } else {
      doc.text(hLines[0], cx, agingY + 11, { align: 'center' })
      doc.text(hLines[1], cx, agingY + 20, { align: 'center' })
    }

    doc.setFont('helvetica', i === 5 ? 'bold' : 'normal')
    doc.setFontSize(9.5)
    doc.setTextColor(17, 24, 39)
    doc.text(fmtAmount(values[i], i === 5), cx, agingY + 40, { align: 'center' })
  }

  if (pageNumber > 1) {
    drawPageFooter(pageNumber)
  }

  const arrayBuf = doc.output('arraybuffer')
  return Buffer.from(arrayBuf)
}

/**
 * Genera el cuerpo HTML para el envío de Estado de Cuenta ("STATEMENT") por correo electrónico.
 */
export function generateQboStatementEmailHtml(
  input: QboStatementPdfInput,
  customMessage?: string
): string {
  const balanceFormatted = fmtAmount(input.totalBalanceDue, true)
  const addressSingleLine = (input.companyAddressLines || []).filter(Boolean).join(' ')
  const greetingName = input.customerDisplayName || 'Valued Customer'

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Statement from ${escapeHtml(input.companyName)}</title>
</head>
<body style="margin: 0; padding: 24px 12px; background-color: #ffffff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 0 auto; border-collapse: collapse;">
    <tr>
      <td style="background-color: #dce8f0; padding: 32px 24px; text-align: center; border-radius: 4px;">
        <div style="font-size: 16px; font-weight: 700; color: #1e293b; margin-bottom: 18px;">
          Statement from ${escapeHtml(input.companyName)}
        </div>
        <div style="font-size: 10px; font-weight: 600; letter-spacing: 1px; color: #475569; text-transform: uppercase; margin-bottom: 6px;">
          TOTAL BALANCE DUE
        </div>
        <div style="font-size: 32px; font-weight: 500; color: #1e293b;">
          ${escapeHtml(balanceFormatted)}
        </div>
      </td>
    </tr>
    <tr>
      <td style="padding: 28px 24px 18px 24px; text-align: center;">
        <span style="display: inline-block; background-color: #108000; color: #ffffff; font-size: 14px; font-weight: 700; padding: 12px 44px; border-radius: 999px; text-decoration: none;">
          Account Statement Attached (PDF)
        </span>
      </td>
    </tr>
    <tr>
      <td style="padding: 16px 32px 28px 32px; font-size: 14px; line-height: 1.6; color: #1e293b;">
        <p style="margin: 0 0 16px 0;">Dear ${escapeHtml(greetingName)},</p>
        ${
          customMessage && customMessage.trim()
            ? `<p style="margin: 0 0 16px 0; white-space: pre-line;">${escapeHtml(customMessage.trim())}</p>`
            : `<p style="margin: 0 0 12px 0;">Please find attached your latest account statement as of <strong>${escapeHtml(formatUsDateSlash(input.statementDate))}</strong>.</p>
               <p style="margin: 0 0 18px 0;">Thank you for your business - we appreciate it very much.</p>`
        }
        <p style="margin: 0;">Sincerely,<br /><strong>${escapeHtml(input.companyName)}</strong></p>
      </td>
    </tr>
    <tr>
      <td style="background-color: #dce8f0; padding: 24px; text-align: center; border-radius: 4px; font-size: 12px; line-height: 1.6; color: #334155;">
        <div style="font-weight: 700; color: #1e293b; margin-bottom: 6px;">
          ${escapeHtml(input.companyName)}
        </div>
        ${
          addressSingleLine
            ? `<div style="color: #2563eb; margin-bottom: 6px;">${escapeHtml(addressSingleLine)}</div>`
            : ''
        }
        <div>
          ${input.companyPhone ? `<span style="color: #2563eb; margin-right: 12px;">${escapeHtml(input.companyPhone)}</span>` : ''}
          ${input.companyEmail ? `<a href="mailto:${escapeHtml(input.companyEmail)}" style="color: #2563eb; text-decoration: underline;">${escapeHtml(input.companyEmail)}</a>` : ''}
        </div>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim()
}

/**
 * Envía por correo electrónico el Estado de Cuenta (HTML estilo QBO + archivo PDF adjunto) usando Nodemailer SMTP.
 */
export async function sendQboStatementEmail(options: {
  statementInput: QboStatementPdfInput
  toEmails: string[]
  ccEmails?: string[]
  subject?: string
  customMessage?: string
}): Promise<{
  success: boolean
  messageId?: string
  recipients: string[]
  filename: string
  pdfBase64: string
  error?: string
}> {
  const { statementInput, toEmails, ccEmails = [], subject, customMessage } = options
  const pdfBuffer = generateQboStatementPdfBuffer(statementInput)
  const safeCust = String(statementInput.customerDisplayName || 'Customer')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
  const filename = `Statement_${safeCust}_${statementInput.statementDate}.pdf`
  const pdfBase64 = pdfBuffer.toString('base64')

  const smtpUser = process.env.SMTP_EMAIL || 'carlos@tacosgavilan.com'
  const smtpPass = process.env.SMTP_PASSWORD

  const cleanTo = toEmails.map((e) => e.trim()).filter(Boolean)
  const cleanCc = ccEmails.map((e) => e.trim()).filter(Boolean)

  if (!smtpPass) {
    return {
      success: false,
      recipients: cleanTo,
      filename,
      pdfBase64,
      error: 'SMTP_PASSWORD no configurado en el servidor.',
    }
  }

  if (cleanTo.length === 0) {
    return {
      success: false,
      recipients: [],
      filename,
      pdfBase64,
      error: 'Debe especificar al menos un correo destinatario.',
    }
  }

  const finalSubject =
    subject && subject.trim()
      ? subject.trim()
      : `Statement from ${statementInput.companyName} (${formatUsDateSlash(statementInput.statementDate)})`

  const html = generateQboStatementEmailHtml(statementInput, customMessage)

  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    })

    const info = await transporter.sendMail({
      from: `"${statementInput.companyName}" <${smtpUser}>`,
      replyTo: statementInput.companyEmail || 'raquel@tacosgavilan.com',
      to: cleanTo.join(', '),
      cc: cleanCc.length > 0 ? cleanCc.join(', ') : undefined,
      subject: finalSubject,
      html,
      attachments: [
        {
          filename,
          content: pdfBuffer,
          contentType: 'application/pdf',
        },
      ],
    })

    return {
      success: true,
      messageId: info.messageId,
      recipients: [...cleanTo, ...cleanCc],
      filename,
      pdfBase64,
    }
  } catch (err: any) {
    console.error('[QboStatementEmail] Error sending statement email:', err)
    return {
      success: false,
      recipients: cleanTo,
      filename,
      pdfBase64,
      error: err?.message || 'Error enviando correo de estado de cuenta',
    }
  }
}
