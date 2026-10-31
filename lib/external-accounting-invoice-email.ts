/**
 * @module lib/external-accounting-invoice-email
 * @description Generador oficial de Facturas PDF estilo QuickBooks Online (Statement Invoice con Account Summary + Line Items)
 * y despachador automático de correos electrónicos con el PDF adjunto para los inquilinos/clientes (Tenants & Customers)
 * de las 8 razones sociales de Contabilidad Externa (Gutierrez Financial, 7947 Downey Plaza LLC, Canasty Financial, etc.).
 *
 * @businessRules
 * - Formato PDF 1:1 idéntico al estándar de QuickBooks Online ("Statement Invoice"):
 *   1. Encabezado centrado-izquierdo con Razón Social, Dirección Fiscal, Teléfono y Correo de la empresa emisora.
 *   2. Título "INVOICE" en azul pizarra (#6b96b3), bloque "BILL TO" (Nombre de contacto, Empresa/Tenant, Dirección)
 *      y bloque derecho ("INVOICE #", "DATE", "DUE DATE", "TERMS").
 *   3. Tabla 1 ("ACCOUNT SUMMARY"): Balance Forward, Pagos/Créditos intermedios, Otras facturas de la fecha,
 *      Nuevos cargos y Total Amount Due.
 *   4. Tabla 2 ("DESCRIPTION | QTY | RATE | AMOUNT"): Concepto en negrita (ej. "Rent") y descripción ("Monthly Rent").
 *   5. Línea punteada inferior con "TOTAL OF NEW CHARGES" y "BALANCE DUE $X,XXX.XX".
 * - Correo HTML 1:1 con encabezado azul claro (#dce8f0) "Your invoice is ready! BALANCE DUE $X,XXX.XX",
 *   mensaje personalizado ("Dear [Contact Name], Your invoice is attached...") y el archivo PDF adjunto.
 *
 * @dataFlow
 * - POST /api/external-accounting (action: 'send_invoice_email' o al guardar factura con sendEmail: true)
 *   -> buildInvoiceAccountSummary() -> generateQboInvoicePdfBuffer() -> sendQboInvoiceEmail() (Nodemailer SMTP).
 */

import nodemailer from 'nodemailer'
import { jsPDF } from 'jspdf'

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
  companyName: string
  companyAddressLines: string[]
  companyPhone?: string
  companyEmail?: string
  invoiceNumber: string
  invoiceDate: string // YYYY-MM-DD or MM/DD/YYYY
  dueDate: string     // YYYY-MM-DD or MM/DD/YYYY
  terms: string
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

  // Find most recent prior Invoice before invDate
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

  // Sum payments and credits between priorInvoiceDate and dayBeforeInvoiceDate
  // Note: Only Payment and CreditMemo reduce A/R on QBO Statement Invoices (Deposits are bank movements of Payments)
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

  // Other invoices from this same date
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

/**
 * Genera el archivo PDF binario (Buffer) con diseño idéntico al PDF oficial de QuickBooks Online
 * (ej. Invoice_3313_from_Gutierrez_Financial.pdf).
 */
export function generateQboInvoicePdfBuffer(input: QboInvoicePdfInput): Buffer {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'pt',
    format: 'letter', // 612 x 792 pt
  })

  const pageWidth = 612
  const leftMargin = 48
  const rightMargin = pageWidth - 48

  // 1. Company Header Block (x = 178pt, top = 46pt — exact QBO positioning)
  let compY = 46
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10.5)
  doc.setTextColor(20, 20, 20)
  doc.text(input.companyName || 'Company', 178, compY)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9.5)
  doc.setTextColor(35, 35, 35)
  for (const line of input.companyAddressLines) {
    if (!line.trim()) continue
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

  // 2. "INVOICE" Title in QBO Slate Blue (#6b96b3)
  const invoiceTitleY = Math.max(compY + 26, 134)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(20)
  doc.setTextColor(107, 150, 179)
  doc.text('INVOICE', leftMargin, invoiceTitleY)

  // 3. BILL TO (Left) & INVOICE META (Right)
  const billToStartY = invoiceTitleY + 24
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(20, 20, 20)
  doc.text('BILL TO', leftMargin, billToStartY)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9.5)
  doc.setTextColor(30, 30, 30)
  let billY = billToStartY + 14
  for (const bLine of input.billToLines) {
    if (!bLine.trim()) continue
    doc.text(bLine.trim(), leftMargin, billY)
    billY += 13
  }

  // Right Meta Labels & Values
  const metaLabelRightX = 460
  const metaValueLeftX = 466
  let metaY = billToStartY
  const metaRows: Array<[string, string]> = [
    ['INVOICE #', String(input.invoiceNumber || '')],
    ['DATE', formatUsDateSlash(input.invoiceDate)],
    ['DUE DATE', formatUsDateSlash(input.dueDate || input.invoiceDate)],
    ['TERMS', String(input.terms || 'Due on receipt')],
  ]
  for (const [lbl, val] of metaRows) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(20, 20, 20)
    doc.text(lbl, metaLabelRightX, metaY, { align: 'right' })

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9.5)
    doc.setTextColor(30, 30, 30)
    doc.text(val, metaValueLeftX, metaY)
    metaY += 13.5
  }

  // 4. Horizontal Divider Line
  const dividerY = Math.max(billY, metaY) + 18
  doc.setDrawColor(190, 205, 218)
  doc.setLineWidth(0.75)
  doc.line(leftMargin, dividerY, rightMargin, dividerY)

  // 5. Table 1: ACCOUNT SUMMARY (QBO Statement Summary Table)
  let curY = dividerY + 26
  const bandHeight = 18
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

  const summaryRows: Array<{ date: string; label: string; amount: string; bold?: boolean }> = [
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

  // 6. Table 2: DESCRIPTION | QTY | RATE | AMOUNT
  curY += 14
  doc.setFillColor(220, 232, 240) // #dce8f0
  doc.rect(leftMargin - 30, curY - 12, pageWidth - (leftMargin - 30) * 2, bandHeight, 'F')

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.setTextColor(92, 135, 166)
  doc.text('DESCRIPTION', leftMargin, curY)
  doc.text('QTY', 380, curY, { align: 'right' })
  doc.text('RATE', 480, curY, { align: 'right' })
  doc.text('AMOUNT', rightMargin, curY, { align: 'right' })

  curY += 20
  for (const item of input.lineItems) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9.5)
    doc.setTextColor(20, 20, 20)
    doc.text(String(item.itemName || 'Rent'), leftMargin, curY)

    const qtyStr =
      item.qty !== undefined && item.qty !== null && String(item.qty) !== '' && Number(item.qty) !== 1
        ? String(item.qty)
        : ''
    doc.setFont('helvetica', 'normal')
    if (qtyStr) {
      doc.text(qtyStr, 380, curY, { align: 'right' })
    }
    doc.text(fmtAmount(item.rate), 480, curY, { align: 'right' })
    doc.text(fmtAmount(item.amount), rightMargin, curY, { align: 'right' })

    if (item.description && item.description.trim() && item.description.trim() !== item.itemName.trim()) {
      curY += 12
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(9.2)
      doc.setTextColor(40, 40, 40)
      doc.text(item.description.trim(), leftMargin, curY)
    }
    curY += 20
  }

  // 7. Dotted Divider Line + Bottom Totals
  curY += 6
  doc.setDrawColor(160, 160, 160)
  doc.setLineDashPattern([1.5, 2.5], 0)
  doc.line(leftMargin, curY, rightMargin, curY)
  doc.setLineDashPattern([], 0)

  curY += 18
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9.5)
  doc.setTextColor(30, 30, 30)
  doc.text('TOTAL OF NEW', 312, curY)
  doc.text(fmtAmount(input.totalNewCharges), rightMargin, curY, { align: 'right' })
  curY += 12
  doc.text('CHARGES', 312, curY)

  curY += 18
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9.5)
  doc.text('BALANCE DUE', 312, curY)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(15)
  doc.setTextColor(15, 15, 15)
  doc.text(fmtAmount(input.balanceDue, true), rightMargin, curY + 1, { align: 'right' })

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
 * (con encabezado azul claro #dce8f0, BALANCE DUE, botón verde y tarjeta inferior de la empresa).
 */
export function generateQboInvoiceEmailHtml(
  input: QboInvoicePdfInput,
  customMessage?: string
): string {
  const balanceFormatted = fmtAmount(input.balanceDue, true)
  const addressSingleLine = input.companyAddressLines.filter(Boolean).join(' ')
  const greetingName = input.contactGreetingName || input.customerDisplayName || 'Valued Customer'

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Invoice #${escapeHtml(input.invoiceNumber)} from ${escapeHtml(input.companyName)}</title>
</head>
<body style="margin: 0; padding: 24px 12px; background-color: #ffffff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 0 auto; border-collapse: collapse;">
    <!-- TOP LIGHT-BLUE BANNER -->
    <tr>
      <td style="background-color: #dce8f0; padding: 32px 24px; text-align: center; border-radius: 4px;">
        <div style="font-size: 16px; font-weight: 700; color: #1e293b; margin-bottom: 18px;">
          Your invoice is ready!
        </div>
        <div style="font-size: 10px; font-weight: 600; letter-spacing: 1px; color: #475569; text-transform: uppercase; margin-bottom: 6px;">
          BALANCE DUE
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
          Invoice #${escapeHtml(input.invoiceNumber)} Attached (PDF)
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
            : `<p style="margin: 0 0 4px 0;">Your invoice is attached. Please remit payment at your earliest convenience.</p>
               <p style="margin: 0 0 18px 0;">Thank you for your business - we appreciate it very much.</p>`
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
 * Envía por correo electrónico la factura (HTML estilo QBO + archivo PDF adjunto)
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
  const pdfBuffer = generateQboInvoicePdfBuffer(pdfInput)
  const safeComp = String(pdfInput.companyName || 'Company')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
  const filename = `Invoice_${pdfInput.invoiceNumber || 'Draft'}_from_${safeComp}.pdf`
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
      : `Invoice #${pdfInput.invoiceNumber} from ${pdfInput.companyName}`

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
    console.error('[QboInvoiceEmail] Error sending invoice email:', err)
    return {
      success: false,
      recipients: cleanTo,
      filename,
      pdfBase64,
      error: err?.message || 'Error enviando correo de factura',
    }
  }
}

export interface QboStatementPdfInput {
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
 * incluyendo la tabla cronológica con saldo corrido (Running Balance) y la barra inferior de antigüedad (Aging Buckets).
 */
export function generateQboStatementPdfBuffer(input: QboStatementPdfInput): Buffer {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'pt',
    format: 'letter',
  })

  const pageWidth = 612
  const leftMargin = 48
  const rightMargin = pageWidth - 48

  let y = 48
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(35, 39, 46)
  doc.text(input.companyName || 'Gutierrez Financial', leftMargin, y)
  y += 14

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9.5)
  doc.setTextColor(65, 72, 82)
  for (const line of input.companyAddressLines) {
    if (!line.trim()) continue
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

  doc.setFontSize(9)
  doc.setTextColor(80, 90, 102)
  doc.text('STATEMENT DATE', rightMargin - 165, 82)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(35, 39, 46)
  doc.text(formatUsDateSlash(input.statementDate), rightMargin, 82, { align: 'right' })

  doc.setFont('helvetica', 'bold')
  doc.setTextColor(80, 90, 102)
  doc.text('TOTAL AMOUNT DUE', rightMargin - 165, 98)
  doc.setTextColor(17, 24, 39)
  doc.text(fmtAmount(input.totalBalanceDue, true), rightMargin, 98, { align: 'right' })

  // TO Block
  let toY = Math.max(y + 18, 125)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(75, 85, 99)
  doc.text('TO', leftMargin, toY)
  toY += 14
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9.5)
  doc.setTextColor(35, 39, 46)
  for (const line of input.billToLines.slice(0, 5)) {
    doc.text(line, leftMargin, toY)
    toY += 12.5
  }

  // Table Header
  let tableY = Math.max(toY + 20, 210)
  doc.setFillColor(219, 234, 254)
  doc.rect(leftMargin, tableY, rightMargin - leftMargin, 20, 'F')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.setTextColor(37, 99, 235)
  doc.text('DATE', leftMargin + 8, tableY + 13)
  doc.text('ACTIVITY', leftMargin + 82, tableY + 13)
  doc.text('AMOUNT', rightMargin - 95, tableY + 13, { align: 'right' })
  doc.text('BALANCE', rightMargin - 8, tableY + 13, { align: 'right' })

  let rowY = tableY + 34
  let runningBal = 0
  const sorted = [...(input.transactions || [])].sort((a, b) => {
    const cmp = String(a.txn_date || '').localeCompare(String(b.txn_date || ''))
    if (cmp !== 0) return cmp
    const aOrder = a.txn_type === 'Invoice' ? 0 : 1
    const bOrder = b.txn_type === 'Invoice' ? 0 : 1
    return aOrder - bOrder
  })

  const withRunning = sorted.map((tx) => {
    const isCredit = tx.txn_type === 'Payment' || tx.txn_type === 'CreditMemo'
    const signedAmt = isCredit ? -Math.abs(Number(tx.total_amount || 0)) : Math.abs(Number(tx.total_amount || 0))
    runningBal = Math.round((runningBal + signedAmt) * 100) / 100
    return { tx, signedAmt, runningBal }
  })

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(35, 39, 46)

  const displayStart = Math.max(0, withRunning.length - 22)
  if (displayStart > 0) {
    const prevRow = withRunning[displayStart - 1]
    doc.setFont('helvetica', 'bold')
    doc.text(formatUsDateSlash(prevRow.tx.txn_date), leftMargin + 8, rowY)
    doc.text('Balance Forward', leftMargin + 82, rowY)
    doc.text(fmtAmount(prevRow.runningBal, false), rightMargin - 8, rowY, { align: 'right' })
    doc.setFont('helvetica', 'normal')
    rowY += 16
  }

  for (const item of withRunning.slice(displayStart)) {
    const { tx, signedAmt, runningBal: rBal } = item
    const activityText = `${tx.txn_type}${tx.doc_number ? ` #${tx.doc_number}` : ''}${tx.due_date ? ` (Due ${formatUsDateSlash(tx.due_date)})` : ''}`
    doc.text(formatUsDateSlash(tx.txn_date), leftMargin + 8, rowY)
    doc.text(activityText.slice(0, 56), leftMargin + 82, rowY)
    doc.text(fmtAmount(signedAmt, false), rightMargin - 95, rowY, { align: 'right' })
    doc.text(fmtAmount(rBal, false), rightMargin - 8, rowY, { align: 'right' })
    rowY += 16
    if (rowY > 650) break
  }

  // Aging buckets footer box
  const agingY = Math.max(rowY + 28, 670)
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

  const arrayBuf = doc.output('arraybuffer')
  return Buffer.from(arrayBuf)
}

