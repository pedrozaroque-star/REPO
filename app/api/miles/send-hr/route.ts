/**
 * @module api/miles/send-hr/route
 * @description API endpoint to dispatch supervisor mileage payroll summaries directly to HR via email.
 * @businessRules
 * - Uses active logged-in user session credentials as the sender profile.
 * - Saves or updates recipient emails into the 'mileage_recurrent_emails' catalog for easy 1-click reuse.
 * - Updates trip statuses to 'submitted_hr' and records submission in 'mileage_hr_submissions'.
 * - Generates structured HTML email with per-supervisor breakdowns, miles, rate, parking, tolls, and reimbursement totals.
 * @dataFlow Client POST request -> DB update -> Nodemailer dispatch -> JSON response.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/supabase'
import nodemailer from 'nodemailer'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      sender_id,
      sender_name = 'Usuario Sistema',
      sender_email = 'carlos@tacosgavilan.com',
      recipient_email,
      period_start,
      period_end,
      trip_ids = []
    } = body

    if (!recipient_email || !period_start || !period_end) {
      return NextResponse.json(
        { error: 'Campos requeridos faltantes: recipient_email, period_start, period_end' },
        { status: 400 }
      )
    }

    const supabase = await getSupabaseAdminClient()

    // 1. Save or increment recurrent recipient email in DB
    try {
      const { data: existingRec } = await supabase
        .from('mileage_recurrent_emails')
        .select('*')
        .eq('email', recipient_email.toLowerCase().trim())
        .single()

      if (existingRec) {
        await supabase
          .from('mileage_recurrent_emails')
          .update({
            use_count: (existingRec.use_count || 1) + 1,
            last_used_at: new Date().toISOString()
          })
          .eq('id', existingRec.id)
      } else {
        await supabase
          .from('mileage_recurrent_emails')
          .insert({
            email: recipient_email.toLowerCase().trim(),
            label: 'Recursos Humanos / Nómina',
            use_count: 1,
            created_by: sender_id || null
          })
      }
    } catch (e: any) {
      console.warn('Recurrent email update non-fatal error:', e.message)
    }

    // 2. Query target trips
    let query = supabase
      .from('supervisor_mileage_trips')
      .select('*')
      .gte('trip_date', period_start)
      .lte('trip_date', period_end)

    if (trip_ids && trip_ids.length > 0) {
      query = query.in('id', trip_ids)
    }

    const { data: trips, error: tripsErr } = await query

    if (tripsErr) {
      console.error('Error fetching trips for HR submission:', tripsErr.message)
      return NextResponse.json({ error: tripsErr.message }, { status: 500 })
    }

    const targetTrips = trips || []

    if (targetTrips.length === 0) {
      return NextResponse.json(
        { error: 'No se encontraron viajes en el rango de fechas seleccionado para enviar a RRHH.' },
        { status: 400 }
      )
    }

    // 3. Group by supervisor for executive summary
    const summaryBySupervisor: Record<string, {
      name: string
      email: string
      trip_count: number
      total_miles: number
      total_parking: number
      total_tolls: number
      total_reimbursement: number
    }> = {}

    let globalMiles = 0
    let globalReimbursement = 0

    targetTrips.forEach(t => {
      const supKey = t.supervisor_id || t.supervisor_email || t.supervisor_name
      if (!summaryBySupervisor[supKey]) {
        summaryBySupervisor[supKey] = {
          name: t.supervisor_name || 'Supervisor',
          email: t.supervisor_email || '',
          trip_count: 0,
          total_miles: 0,
          total_parking: 0,
          total_tolls: 0,
          total_reimbursement: 0
        }
      }

      const miles = Number(t.distance_miles) || 0
      const parking = Number(t.parking_amount) || 0
      const tolls = Number(t.tolls_amount) || 0
      const rate = Number(t.rate_per_mile) || 0.76
      const reim = (miles * rate) + parking + tolls

      summaryBySupervisor[supKey].trip_count += 1
      summaryBySupervisor[supKey].total_miles += miles
      summaryBySupervisor[supKey].total_parking += parking
      summaryBySupervisor[supKey].total_tolls += tolls
      summaryBySupervisor[supKey].total_reimbursement += reim

      globalMiles += miles
      globalReimbursement += reim
    })

    const supervisorCount = Object.keys(summaryBySupervisor).length

    // 4. Summary rows for executive table (accumulated total per supervisor)
    const rowsHtml = Object.values(summaryBySupervisor).map(s => `
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="padding: 12px; font-weight: bold; color: #1e293b;">${s.name}</td>
        <td style="padding: 12px; text-align: center; color: #64748b;">${s.trip_count}</td>
        <td style="padding: 12px; text-align: right; font-weight: 600; color: #2563eb;">${s.total_miles.toFixed(2)} mi</td>
        <td style="padding: 12px; text-align: right; color: #475569;">$${s.total_parking.toFixed(2)}</td>
        <td style="padding: 12px; text-align: right; color: #475569;">$${s.total_tolls.toFixed(2)}</td>
        <td style="padding: 12px; text-align: right; font-weight: bold; color: #059669; font-size: 15px;">$${s.total_reimbursement.toFixed(2)} USD</td>
      </tr>
    `).join('')

    // 4b. Build detailed trip rows per supervisor (grouped and sorted by date)
    const detailedRowsHtml = Object.values(summaryBySupervisor).map(s => {
      // Get all trips for this supervisor, sorted by date
      const supTrips = targetTrips
        .filter(t => (t.supervisor_name || 'Supervisor') === s.name)
        .sort((a, b) => (a.trip_date || '').localeCompare(b.trip_date || ''))

      const tripRows = supTrips.map(t => {
        const miles = Number(t.distance_miles) || 0
        const rate = Number(t.rate_per_mile) || 0.76
        const parking = Number(t.parking_amount) || 0
        const tolls = Number(t.tolls_amount) || 0
        const total = (miles * rate) + parking + tolls
        const route = `${(t.origin_name || '').replace('Tacos Gavilan ', '')} → ${(t.destination_name || '').replace('Tacos Gavilan ', '')}`
        const roundTrip = t.is_round_trip ? ' 🔄' : ''

        return `
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 8px 10px; color: #475569; font-size: 13px;">${t.trip_date || '—'}</td>
            <td style="padding: 8px 10px; color: #334155; font-size: 13px;">${route}${roundTrip}</td>
            <td style="padding: 8px 10px; text-align: right; color: #2563eb; font-weight: 600; font-size: 13px;">${miles.toFixed(2)}</td>
            <td style="padding: 8px 10px; text-align: right; color: #64748b; font-size: 13px;">$${rate.toFixed(3)}</td>
            <td style="padding: 8px 10px; text-align: right; color: #64748b; font-size: 13px;">$${(parking + tolls).toFixed(2)}</td>
            <td style="padding: 8px 10px; text-align: right; color: #059669; font-weight: 700; font-size: 13px;">$${total.toFixed(2)}</td>
          </tr>
        `
      }).join('')

      return `
        <tr>
          <td colspan="6" style="padding: 14px 10px 6px 10px; background: #f8fafc; border-top: 2px solid #cbd5e1;">
            <strong style="font-size: 14px; color: #0f172a;">👤 ${s.name}</strong>
            <span style="font-size: 12px; color: #94a3b8; margin-left: 8px;">${s.email}</span>
          </td>
        </tr>
        ${tripRows}
        <tr style="border-bottom: 2px solid #cbd5e1;">
          <td colspan="2" style="padding: 10px; text-align: right; font-weight: bold; font-size: 13px; color: #334155;">
            Subtotal ${s.name}: ${s.trip_count} viaje(s)
          </td>
          <td style="padding: 10px; text-align: right; font-weight: bold; color: #2563eb; font-size: 13px;">${s.total_miles.toFixed(2)} mi</td>
          <td style="padding: 10px; text-align: right; color: #64748b; font-size: 13px;">—</td>
          <td style="padding: 10px; text-align: right; color: #64748b; font-size: 13px;">$${(s.total_parking + s.total_tolls).toFixed(2)}</td>
          <td style="padding: 10px; text-align: right; font-weight: bold; color: #059669; font-size: 14px;">$${s.total_reimbursement.toFixed(2)}</td>
        </tr>
      `
    }).join('')

    const emailHtml = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 750px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
        <div style="background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); color: #ffffff; padding: 24px; text-align: center;">
          <h1 style="margin: 0; font-size: 24px; letter-spacing: -0.5px;">🚗 MilesIQ — Reporte de Millas y Nómina</h1>
          <p style="margin: 6px 0 0 0; opacity: 0.85; font-size: 14px;">Tacos Gavilan • Control Operativo de Supervisores</p>
        </div>
        
        <div style="padding: 24px;">
          <p style="font-size: 15px; color: #334155; line-height: 1.5; margin-top: 0;">
            Estimado equipo de <strong>Recursos Humanos / Nómina</strong>,
          </p>
          <p style="font-size: 14px; color: #475569; line-height: 1.5;">
            A continuación se presenta el desglose consolidado de millas recorridas y montos a reembolsar a los supervisores correspondiente al período del <strong>${period_start}</strong> al <strong>${period_end}</strong>.
          </p>

          <div style="display: flex; gap: 12px; margin: 20px 0; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px;">
            <div style="flex: 1; text-align: center;">
              <span style="font-size: 12px; text-transform: uppercase; color: #64748b; font-weight: 600;">Supervisores</span>
              <div style="font-size: 20px; font-weight: bold; color: #1e293b; margin-top: 4px;">${supervisorCount}</div>
            </div>
            <div style="flex: 1; text-align: center; border-left: 1px solid #cbd5e1; border-right: 1px solid #cbd5e1;">
              <span style="font-size: 12px; text-transform: uppercase; color: #64748b; font-weight: 600;">Millas Totales</span>
              <div style="font-size: 20px; font-weight: bold; color: #2563eb; margin-top: 4px;">${globalMiles.toFixed(2)} mi</div>
            </div>
            <div style="flex: 1; text-align: center;">
              <span style="font-size: 12px; text-transform: uppercase; color: #64748b; font-weight: 600;">Total Reembolso</span>
              <div style="font-size: 20px; font-weight: bold; color: #059669; margin-top: 4px;">$${globalReimbursement.toFixed(2)} USD</div>
            </div>
          </div>

          <!-- Resumen Ejecutivo por Supervisor -->
          <h3 style="font-size: 14px; color: #1e293b; margin: 24px 0 8px 0; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px;">📊 Resumen Ejecutivo por Supervisor</h3>
          <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
            <thead>
              <tr style="background: #f1f5f9; text-align: left; color: #475569; font-size: 12px; text-transform: uppercase;">
                <th style="padding: 10px;">Supervisor</th>
                <th style="padding: 10px; text-align: center;">Viajes</th>
                <th style="padding: 10px; text-align: right;">Millas</th>
                <th style="padding: 10px; text-align: right;">Parking</th>
                <th style="padding: 10px; text-align: right;">Tolls</th>
                <th style="padding: 10px; text-align: right;">Total Reembolso</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
              <tr style="background: #0f172a; color: #ffffff;">
                <td style="padding: 12px; font-weight: bold; font-size: 13px;">GRAN TOTAL</td>
                <td style="padding: 12px; text-align: center; font-weight: bold;">${targetTrips.length}</td>
                <td style="padding: 12px; text-align: right; font-weight: bold;">${globalMiles.toFixed(2)} mi</td>
                <td style="padding: 12px; text-align: right;">${Object.values(summaryBySupervisor).reduce((s, v) => s + v.total_parking, 0).toFixed(2)}</td>
                <td style="padding: 12px; text-align: right;">${Object.values(summaryBySupervisor).reduce((s, v) => s + v.total_tolls, 0).toFixed(2)}</td>
                <td style="padding: 12px; text-align: right; font-weight: bold; font-size: 16px;">$${globalReimbursement.toFixed(2)} USD</td>
              </tr>
            </tbody>
          </table>

          <!-- Desglose Detallado de Viajes -->
          <h3 style="font-size: 14px; color: #1e293b; margin: 28px 0 8px 0; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px;">📋 Desglose Detallado de Viajes por Fecha</h3>
          <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
            <thead>
              <tr style="background: #f1f5f9; color: #475569; font-size: 11px; text-transform: uppercase;">
                <th style="padding: 8px 10px; text-align: left;">Fecha</th>
                <th style="padding: 8px 10px; text-align: left;">Ruta</th>
                <th style="padding: 8px 10px; text-align: right;">Millas</th>
                <th style="padding: 8px 10px; text-align: right;">Tarifa</th>
                <th style="padding: 8px 10px; text-align: right;">Extras</th>
                <th style="padding: 8px 10px; text-align: right;">Total</th>
              </tr>
            </thead>
            <tbody>
              ${detailedRowsHtml}
              <tr style="background: #059669; color: #ffffff;">
                <td colspan="2" style="padding: 12px; font-weight: bold; font-size: 14px;">GRAN TOTAL ACUMULADO</td>
                <td style="padding: 12px; text-align: right; font-weight: bold;">${globalMiles.toFixed(2)} mi</td>
                <td style="padding: 12px; text-align: right;">—</td>
                <td style="padding: 12px; text-align: right;">${Object.values(summaryBySupervisor).reduce((s, v) => s + v.total_parking + v.total_tolls, 0).toFixed(2)}</td>
                <td style="padding: 12px; text-align: right; font-weight: bold; font-size: 16px;">$${globalReimbursement.toFixed(2)} USD</td>
              </tr>
            </tbody>
          </table>

          <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #64748b;">
            <p style="margin: 0;"><strong>Enviado por:</strong> ${sender_name} (${sender_email})</p>
            <p style="margin: 4px 0 0 0;"><strong>Fecha de Envío:</strong> ${new Date().toLocaleString('es-MX', { timeZone: 'America/Los_Angeles' })} PST</p>
          </div>
        </div>

        <div style="background: #f8fafc; padding: 16px; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0;">
          Tacos Gavilan Operations System • Módulo MilesIQ
        </div>
      </div>
    `

    // 5. Dispatch email via Nodemailer
    let emailSent = false
    let emailErrorMsg = ''

    try {
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: process.env.SMTP_EMAIL || 'carlos@tacosgavilan.com',
          pass: process.env.SMTP_PASSWORD || ''
        }
      })

      await transporter.sendMail({
        from: `"${sender_name} via Tacos Gavilan" <${process.env.SMTP_EMAIL || 'carlos@tacosgavilan.com'}>`,
        replyTo: sender_email,
        to: recipient_email,
        subject: `🚗 MilesIQ Reporte de Millas Supervisores (${period_start} al ${period_end}) - $${globalReimbursement.toFixed(2)} USD`,
        html: emailHtml
      })

      emailSent = true
    } catch (sendErr: any) {
      console.error('Error dispatching mail:', sendErr)
      emailErrorMsg = sendErr.message
    }

    // 6. Log batch in mileage_hr_submissions FIRST to get ID
    const { data: hrSub } = await supabase
      .from('mileage_hr_submissions')
      .insert({
        period_start,
        period_end,
        submitted_by_id: sender_id || '00000000-0000-0000-0000-000000000000',
        sender_email,
        sender_name,
        recipient_email,
        total_supervisors: supervisorCount,
        total_miles: globalMiles,
        total_reimbursement: globalReimbursement,
        email_status: emailSent ? 'sent' : `failed: ${emailErrorMsg}`
      })
      .select()
      .single()

    // 7. Update trip statuses to 'submitted_hr' AND link submission ID ONLY if email was sent
    const tripIdsToUpdate = targetTrips.map(t => t.id)
    if (tripIdsToUpdate.length > 0 && emailSent && hrSub) {
      await supabase
        .from('supervisor_mileage_trips')
        .update({
          status: 'submitted_hr',
          hr_submitted_at: new Date().toISOString(),
          hr_submission_id: hrSub.id
        })
        .in('id', tripIdsToUpdate)
    }

    return NextResponse.json({
      success: true,
      emailSent,
      submission: hrSub,
      totals: {
        supervisors: supervisorCount,
        miles: globalMiles,
        reimbursement: globalReimbursement
      }
    })
  } catch (err: any) {
    console.error('Error in POST /api/miles/send-hr:', err)
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 })
  }
}
