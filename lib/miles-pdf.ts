/**
 * @module lib/miles-pdf
 * @description Executive and individual PDF report generator for Tacos Gavilan MilesIQ module.
 * @businessRules
 * - Official brand name: strictly "Tacos Gavilan" (NEVER "Tacos El Gavilan").
 * - Format: Horizontal (Landscape, Letter: 279.4mm x 215.9mm) for optimal multi-column financial tables.
 * - Language: Strictly English for corporate payroll/HR audit compliance.
 * - Dates: US Standard Format (MM/DD/YYYY).
 * - Official IRS rate: $0.760 per mile + parking/tolls.
 * - Supports one-way and round-trip journeys with audited distance accounting.
 * - Includes legal compliance and signature blocks for Supervisor and HR / Payroll.
 * @dataFlow Trips data ('supervisor_mileage_trips') -> jsPDF + jspdf-autotable -> Binary PDF Buffer.
 * @notes Designed to run seamlessly in serverless Node.js (Next.js API routes) without external browser binaries.
 */

import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'

export interface TripRecordForPdf {
  id: string
  trip_date: string
  start_time?: string
  origin_name: string
  destination_name: string
  is_round_trip: boolean
  distance_miles: number
  rate_per_mile?: number
  parking_amount?: number
  tolls_amount?: number
  total_reimbursement?: number
  purpose?: string
  purpose_notes?: string
  status?: string
}

export interface SupervisorPdfOptions {
  supervisorId?: string
  supervisorName: string
  supervisorEmail?: string
  periodStart: string // YYYY-MM-DD
  periodEnd: string   // YYYY-MM-DD
  trips: TripRecordForPdf[]
  ratePerMile?: number
  submittedByName?: string
  submissionId?: string
}

export interface SupervisorPdfResult {
  filename: string
  buffer: Buffer
  stats: {
    totalTrips: number
    totalMiles: number
    totalParking: number
    totalTolls: number
    totalReimbursement: number
  }
}

/**
 * Format ISO date string (YYYY-MM-DD) into US date format (MM/DD/YYYY).
 */
export function formatUsaDate(isoDateStr: string): string {
  if (!isoDateStr) return '—'
  const parts = isoDateStr.trim().split('-')
  if (parts.length === 3) {
    const [year, month, day] = parts
    return `${month}/${day}/${year}`
  }
  return isoDateStr
}

/**
 * Format ISO date string into safe filename token (MM-DD-YYYY).
 */
export function formatUsaDateForFilename(isoDateStr: string): string {
  if (!isoDateStr) return ''
  const parts = isoDateStr.trim().split('-')
  if (parts.length === 3) {
    const [year, month, day] = parts
    return `${month}-${day}-${year}`
  }
  return isoDateStr.replace(/[^a-zA-Z0-9]/g, '-')
}

/**
 * Generates an executive, professional PDF audit report in English with US dates for a given supervisor.
 */
export function generateSupervisorMileagePdf(options: SupervisorPdfOptions): SupervisorPdfResult {
  const {
    supervisorName,
    supervisorEmail = '',
    periodStart,
    periodEnd,
    trips,
    ratePerMile = 0.76,
    submittedByName = 'TEG Administration'
  } = options

  // 1. Sort trips chronologically (by trip_date ascending, then start_time ascending)
  const sortedTrips = [...trips].sort((a, b) => {
    if (a.trip_date !== b.trip_date) {
      return (a.trip_date || '').localeCompare(b.trip_date || '')
    }
    return (a.start_time || '').localeCompare(b.start_time || '')
  })

  // 2. Compute exact totals
  let totalMiles = 0
  let totalParking = 0
  let totalTolls = 0
  let totalReimbursement = 0

  sortedTrips.forEach(t => {
    const miles = Number(t.distance_miles) || 0
    const parking = Number(t.parking_amount) || 0
    const tolls = Number(t.tolls_amount) || 0
    const rate = Number(t.rate_per_mile) || ratePerMile
    const reim = Number(t.total_reimbursement) || (miles * rate + parking + tolls)

    totalMiles += miles
    totalParking += parking
    totalTolls += tolls
    totalReimbursement += reim
  })

  // 3. Initialize jsPDF (Landscape, Letter format: 279.4mm x 215.9mm)
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'letter'
  })

  const pageWidth = doc.internal.pageSize.width // 279.4 mm
  const pageHeight = doc.internal.pageSize.height // 215.9 mm
  const margin = 14

  // --- HEADER SECTION ---
  // Top Accent Bar (Navy #0f172a)
  doc.setFillColor(15, 23, 42)
  doc.rect(0, 0, pageWidth, 5, 'F')

  // Brand Name
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.setTextColor(220, 38, 38) // Red #dc2626
  doc.text('TACOS GAVILAN', margin, 15)

  // Subtitle
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(71, 85, 105) // Slate #475569
  doc.text('SUPERVISOR MILEAGE & EXPENSE REIMBURSEMENT • MILESIQ', margin, 20)

  // Document Title
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.setTextColor(15, 23, 42)
  doc.text('SUPERVISOR MILEAGE AUDIT & REIMBURSEMENT REPORT', margin, 28)

  // Supervisor & Period Box (Right Side)
  const rightX = pageWidth - margin
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.setTextColor(15, 23, 42)
  doc.text(supervisorName, rightX, 15, { align: 'right' })

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(100, 116, 139)
  if (supervisorEmail) {
    doc.text(supervisorEmail, rightX, 20, { align: 'right' })
  }

  const usPeriodStart = formatUsaDate(periodStart)
  const usPeriodEnd = formatUsaDate(periodEnd)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(37, 99, 235) // Blue #2563eb
  doc.text(`Period: ${usPeriodStart} - ${usPeriodEnd}`, rightX, 26, { align: 'right' })

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(148, 163, 184)
  const emissionDate = new Date().toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles',
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  })
  doc.text(`Generated: ${emissionDate} PST`, rightX, 31, { align: 'right' })

  // --- KPI SUMMARY METRIC CARDS ---
  const kpiY = 36
  const kpiHeight = 16
  const kpiGap = 3.5
  const totalKpiWidth = pageWidth - (margin * 2)
  const numCards = 5
  const cardWidth = (totalKpiWidth - (kpiGap * (numCards - 1))) / numCards

  const kpis = [
    { label: 'TOTAL TRIPS', value: `${sortedTrips.length}`, color: [15, 23, 42], sub: 'Audited drives' },
    { label: 'TOTAL MILES', value: `${totalMiles.toFixed(2)} mi`, color: [37, 99, 235], sub: 'Net distance' },
    { label: 'IRS STANDARD RATE', value: `$${ratePerMile.toFixed(3)}/mi`, color: [71, 85, 105], sub: 'Official rate' },
    { label: 'PARKING / TOLLS', value: `$${(totalParking + totalTolls).toFixed(2)}`, color: [100, 116, 139], sub: 'Direct expenses' },
    { label: 'TOTAL REIMBURSEMENT', value: `$${totalReimbursement.toFixed(2)} USD`, color: [5, 150, 105], sub: 'Approved payout', highlight: true }
  ]

  kpis.forEach((kpi, idx) => {
    const cardX = margin + idx * (cardWidth + kpiGap)

    // Background
    if (kpi.highlight) {
      doc.setFillColor(236, 253, 245) // Light emerald #ecfdf5
      doc.setDrawColor(167, 243, 208) // Border #a7f3d0
    } else {
      doc.setFillColor(248, 250, 252) // Slate #f8fafc
      doc.setDrawColor(226, 232, 240) // Border #e2e8f0
    }
    doc.roundedRect(cardX, kpiY, cardWidth, kpiHeight, 1.5, 1.5, 'FD')

    // Label
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    doc.setTextColor(100, 116, 139)
    doc.text(kpi.label, cardX + cardWidth / 2, kpiY + 4.5, { align: 'center' })

    // Value
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10.5)
    doc.setTextColor(kpi.color[0], kpi.color[1], kpi.color[2])
    doc.text(kpi.value, cardX + cardWidth / 2, kpiY + 10.5, { align: 'center' })

    // Subtext
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.5)
    doc.setTextColor(148, 163, 184)
    doc.text(kpi.sub, cardX + cardWidth / 2, kpiY + 14.2, { align: 'center' })
  })

  // --- DETAILED TRIPS TABLE (jspdf-autotable) ---
  const tableHead = [[
    '#',
    'DATE',
    'TIME',
    'ROUTE (ORIGIN -> DESTINATION)',
    'TYPE',
    'MILES',
    'RATE',
    'MILEAGE ($)',
    'EXTRAS',
    'TOTAL ($)',
    'PURPOSE / NOTES'
  ]]

  const tableBody = sortedTrips.map((t, idx) => {
    const miles = Number(t.distance_miles) || 0
    const rate = Number(t.rate_per_mile) || ratePerMile
    const parking = Number(t.parking_amount) || 0
    const tolls = Number(t.tolls_amount) || 0
    const extras = parking + tolls
    const mileageVal = miles * rate
    const total = Number(t.total_reimbursement) || (mileageVal + extras)

    const cleanOrig = (t.origin_name || '').replace('Tacos Gavilan ', '').trim()
    const cleanDest = (t.destination_name || '').replace('Tacos Gavilan ', '').trim()
    const routeText = `${cleanOrig} -> ${cleanDest}`
    const tripType = t.is_round_trip ? 'Round-trip' : 'One-way'

    let notesText = t.purpose_notes || t.purpose || 'Store Operations Supervision'
    if (notesText.includes('quick_drive_modal')) {
      notesText = 'GPS Tracking (Quick Drive)'
    } else if (notesText.includes('passive_gps_tracker')) {
      notesText = 'Store Presence (Passive GPS)'
    } else if (notesText.includes('Inspección de Calidad') || notesText.includes('Quality')) {
      notesText = 'Quality Audit Inspection'
    } else if (notesText.includes('Ruta intermedia detectada') || notesText.includes('intermedia')) {
      notesText = 'Interpolated Gap Drive'
    } else if (notesText.startsWith('Ruta MilesIQ')) {
      notesText = 'MilesIQ Route Navigation'
    } else if (notesText.includes('Supervisión') || notesText.includes('Supervision')) {
      notesText = 'Store Operations Supervision'
    }
    notesText = notesText.replace(/→|➔/g, '->').replace(/·/g, '-')

    return [
      String(idx + 1),
      formatUsaDate(t.trip_date),
      t.start_time || '—',
      routeText,
      tripType,
      miles.toFixed(2),
      `$${rate.toFixed(3)}`,
      `$${mileageVal.toFixed(2)}`,
      extras > 0 ? `$${extras.toFixed(2)}` : '—',
      `$${total.toFixed(2)}`,
      notesText
    ]
  })

  // Foot Row
  const tableFoot = [[
    'TOTAL',
    '',
    '',
    `${sortedTrips.length} Audited Trips`,
    '',
    `${totalMiles.toFixed(2)} mi`,
    '',
    `$${(totalMiles * ratePerMile).toFixed(2)}`,
    `$${(totalParking + totalTolls).toFixed(2)}`,
    `$${totalReimbursement.toFixed(2)}`,
    'Approved Reimbursement Payout'
  ]]

  autoTable(doc, {
    startY: 56,
    margin: { left: margin, right: margin, bottom: 28 },
    head: tableHead,
    body: tableBody,
    foot: tableFoot,
    theme: 'grid',
    styles: {
      fontSize: 7.5,
      cellPadding: { top: 1.8, bottom: 1.8, left: 2, right: 2 },
      overflow: 'linebreak',
      valign: 'middle'
    },
    headStyles: {
      fillColor: [15, 23, 42], // Navy #0f172a
      textColor: 255,
      fontStyle: 'bold',
      fontSize: 7,
      halign: 'center'
    },
    footStyles: {
      fillColor: [5, 150, 105], // Emerald #059669
      textColor: 255,
      fontStyle: 'bold',
      fontSize: 8,
      halign: 'right'
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252] // Light slate #f8fafc
    },
    columnStyles: {
      0: { cellWidth: 8, halign: 'center', fontStyle: 'bold' }, // #
      1: { cellWidth: 20, halign: 'center' }, // DATE (MM/DD/YYYY)
      2: { cellWidth: 16, halign: 'center' }, // TIME
      3: { cellWidth: 54, halign: 'left', fontStyle: 'bold' }, // ROUTE
      4: { cellWidth: 18, halign: 'center' }, // TYPE (One-way / Round-trip)
      5: { cellWidth: 16, halign: 'right', fontStyle: 'bold', textColor: [37, 99, 235] }, // MILES
      6: { cellWidth: 14, halign: 'right' }, // RATE
      7: { cellWidth: 18, halign: 'right' }, // MILEAGE $
      8: { cellWidth: 15, halign: 'right' }, // EXTRAS
      9: { cellWidth: 20, halign: 'right', fontStyle: 'bold', textColor: [5, 150, 105] }, // TOTAL $
      10: { cellWidth: 'auto', halign: 'left', fontSize: 6.8, textColor: [100, 116, 139] } // NOTES
    },
    didParseCell: function (data) {
      if (data.section === 'foot') {
        if (data.column.index === 0 || data.column.index === 3) {
          data.cell.styles.halign = 'left'
        }
      }
    }
  })

  // --- SIGNATURES & AUDIT BLOCK ---
  const finalY = (doc as any).lastAutoTable.finalY || 150
  const roomNeeded = 32

  if (finalY + roomNeeded > pageHeight - 15) {
    doc.addPage()
  }

  const sigY = Math.max(finalY + 8, pageHeight - 34)
  const sigBoxWidth = 104
  const sigGap = totalKpiWidth - (sigBoxWidth * 2)

  // Supervisor Signature Box (Left)
  const supSigX = margin
  doc.setDrawColor(148, 163, 184)
  doc.setLineDashPattern([1.5, 1.5], 0)
  doc.line(supSigX, sigY + 12, supSigX + sigBoxWidth, sigY + 12)
  doc.setLineDashPattern([], 0)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.setTextColor(15, 23, 42)
  doc.text(supervisorName, supSigX + sigBoxWidth / 2, sigY + 16, { align: 'center' })

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(100, 116, 139)
  doc.text('Supervisor Signature • Certification of Business Travel Accuracy', supSigX + sigBoxWidth / 2, sigY + 19.5, { align: 'center' })

  // HR / Payroll Signature Box (Right)
  const hrSigX = margin + sigBoxWidth + sigGap
  doc.setDrawColor(148, 163, 184)
  doc.setLineDashPattern([1.5, 1.5], 0)
  doc.line(hrSigX, sigY + 12, hrSigX + sigBoxWidth, sigY + 12)
  doc.setLineDashPattern([], 0)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.setTextColor(15, 23, 42)
  doc.text('Human Resources & Payroll', hrSigX + sigBoxWidth / 2, sigY + 16, { align: 'center' })

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(100, 116, 139)
  doc.text('Reimbursement Approval • Tacos Gavilan Corporate', hrSigX + sigBoxWidth / 2, sigY + 19.5, { align: 'center' })

  // --- FOOTER ACROSS ALL PAGES ---
  const pageCount = (doc as any).internal.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)

    // Bottom Separator Line
    doc.setDrawColor(226, 232, 240)
    doc.setLineWidth(0.3)
    doc.line(margin, pageHeight - 8, pageWidth - margin, pageHeight - 8)

    // Footer Text
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(148, 163, 184)
    doc.text(
      `Tacos Gavilan • MilesIQ Official Module • Supervisor: ${supervisorName} (${usPeriodStart} - ${usPeriodEnd})`,
      margin,
      pageHeight - 4.5
    )

    doc.text(
      `Page ${i} of ${pageCount}`,
      pageWidth - margin,
      pageHeight - 4.5,
      { align: 'right' }
    )
  }

  // Sanitize name for filename
  const cleanName = supervisorName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '_')
    .replace(/_+/g, '_')

  const usPeriodStartFilename = formatUsaDateForFilename(periodStart)
  const usPeriodEndFilename = formatUsaDateForFilename(periodEnd)

  const filename = `Mileage_Report_${cleanName}_${usPeriodStartFilename}_to_${usPeriodEndFilename}.pdf`
  const buffer = Buffer.from(doc.output('arraybuffer'))

  return {
    filename,
    buffer,
    stats: {
      totalTrips: sortedTrips.length,
      totalMiles,
      totalParking,
      totalTolls,
      totalReimbursement
    }
  }
}
