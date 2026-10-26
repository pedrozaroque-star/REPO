/**
 * @module lib/maintenance-email
 * @description Generador y despachador automático de notificaciones por correo electrónico
 * para Administración y Contabilidad (raquel@tacosgavilan.com) cuando un técnico o proveedor
 * finaliza un servicio y guarda los 7 pasos en el portal de Mantenimiento de Tacos Gavilan.
 * @businessRules
 * - Destinatario oficial automático: raquel@tacosgavilan.com.
 * - Se ejecuta automáticamente en POST /api/mantenimiento inmediatamente después de guardar el registro en Supabase.
 * - Incluye el desglose estructurado de los 7 pasos capturados:
 *   1. Sucursal / Ubicación, fecha oficial y horario/duración del servicio.
 *   2. Empresa / Proveedor, nombre del técnico y teléfono de contacto.
 *   3. Categoría, tipo de servicio, estado final y días de garantía.
 *   4. Equipos/áreas intervenidas, descripción del trabajo y piezas reemplazadas.
 *   5. Evidencias fotográficas (Antes y Después) con vista previa y enlaces directos.
 *   6. Datos contables: Número de Factura/Nota, Costo Estimado ($ USD) y documento/foto de factura.
 *   7. Validación del encargado en turno y su Firma Digital (o aviso de Servicio Nocturno).
 * - Usa exclusivamente la marca oficial Tacos Gavilan con su logo (/logo.png) y lema "¡Ya está!" (/ya esta.png) en el encabezado.
 * @dataFlow
 * - POST /api/mantenimiento -> sendMaintenanceServiceEmail() -> Nodemailer (SMTP Gmail) -> raquel@tacosgavilan.com.
 * @notes
 * - Diseñado en modo no bloqueante ante fallos de red SMTP para no interrumpir jamás el guardado en base de datos.
 */

import nodemailer from 'nodemailer'
import { formatStoreName } from '@/lib/supabase'

export const MAINTENANCE_NOTIFICATION_RECIPIENTS = [
  'raquel@tacosgavilan.com'
]

export interface MaintenanceEmailPayload {
  id?: string
  store_id: string
  store_name: string
  store_address?: string | null
  company_name: string
  technician_name: string
  technician_phone?: string | null
  category: string
  service_type: string
  area_equipment: string
  work_description: string
  parts_replaced?: string | null
  status: string
  service_date: string
  start_time?: string | null
  end_time?: string | null
  photos_before?: string[]
  photos_after?: string[]
  photos_invoice?: string[]
  invoice_number?: string | null
  cost_estimate?: number | null
  manager_name: string
  manager_signature_url?: string | null
  notes?: string | null
  is_after_hours?: boolean
  warranty_days?: number | null
}

const CATEGORY_LABELS: Record<string, string> = {
  hood_cleaning: '🔥 Limpieza de Campanas y Ductos',
  refrigeration: '❄️ Refrigeración y Máquinas de Hielo',
  grease_trap: '💧 Trampa de Grasa y Plomería',
  pest_control: '🐜 Control de Plagas y Fumigación',
  cooking_equipment: '🔧 Equipos de Cocina (Parrillas / Freidoras)',
  electrical: '⚡ Eléctrico e Iluminación',
  power_washing: '✨ Lavado a Presión (Power Washing)',
  security_locks: '🔒 Cerrajería, Puertas y Seguridad',
  it_pos: '💻 Sistemas, POS y Redes',
  general: '🛠️ Mantenimiento General / Otros'
}

const SERVICE_TYPE_LABELS: Record<string, string> = {
  preventive: 'Preventivo / Programado',
  corrective: 'Correctivo / Reparación',
  emergency: '🚨 Emergencia / Urgente',
  inspection: 'Inspección / Diagnóstico',
  installation: 'Instalación de Equipo',
  warranty: '🛡️ Reclamación de Garantía ($0)'
}

const STATUS_META: Record<string, { label: string; bg: string; text: string; border: string }> = {
  completed: {
    label: '✅ Completado al 100%',
    bg: '#dcfce7',
    text: '#15803d',
    border: '#86efac'
  },
  pending_parts: {
    label: '⏳ Pendiente de Refacciones',
    bg: '#fef3c7',
    text: '#b45309',
    border: '#fcd34d'
  },
  follow_up_needed: {
    label: '🔄 Requiere Seguimiento',
    bg: '#dbeafe',
    text: '#1d4ed8',
    border: '#93c5fd'
  }
}

export function escapeHtml(input: unknown): string {
  if (input === null || input === undefined) return ''
  return String(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function formatDurationLabel(start?: string | null, end?: string | null): string {
  const clean = (val?: string | null) => {
    if (!val) return ''
    const m = String(val).match(/^(\d{1,2}):(\d{2})/)
    return m ? `${m[1].padStart(2, '0')}:${m[2]}` : String(val)
  }
  const s = clean(start)
  const e = clean(end)
  if (s && e) {
    const [sh, sm] = s.split(':').map(Number)
    const [eh, em] = e.split(':').map(Number)
    if (!Number.isNaN(sh) && !Number.isNaN(sm) && !Number.isNaN(eh) && !Number.isNaN(em)) {
      let diffMin = eh * 60 + em - (sh * 60 + sm)
      if (diffMin < 0) diffMin += 24 * 60
      if (diffMin > 0 && diffMin < 1440) {
        const hrs = Math.floor(diffMin / 60)
        const mins = diffMin % 60
        const durStr = hrs > 0 ? `${hrs}h ${mins > 0 ? `${mins}m` : ''}`.trim() : `${mins}m`
        return `${s} – ${e} (${durStr})`
      }
    }
    return `${s} – ${e}`
  }
  return s || e || 'No especificado'
}

function formatServiceDateDisplay(serviceDate: string): string {
  try {
    if (/^\d{4}-\d{2}-\d{2}$/.test(serviceDate)) {
      const [y, m, d] = serviceDate.split('-').map(Number)
      const dateObj = new Date(Date.UTC(y, m - 1, d, 19, 0, 0))
      const formatted = dateObj.toLocaleDateString('es-MX', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'America/Los_Angeles'
      })
      return formatted.charAt(0).toUpperCase() + formatted.slice(1)
    }
    return serviceDate
  } catch {
    return serviceDate
  }
}

function renderEvidenceGallery(title: string, urls: string[] = []): string {
  if (!Array.isArray(urls) || urls.length === 0) return ''
  const itemsHtml = urls
    .map((url, idx) => {
      const safeUrl = escapeHtml(url)
      const isPdf = url.toLowerCase().split('?')[0].endsWith('.pdf')
      if (isPdf) {
        return `
          <td style="padding: 6px;">
            <a href="${safeUrl}" target="_blank" style="display: inline-block; background-color: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; padding: 10px 14px; border-radius: 10px; font-size: 12px; font-weight: 800; text-decoration: none;">
              📄 Abrir Documento PDF #${idx + 1}
            </a>
          </td>
        `
      }
      return `
        <td style="padding: 6px; vertical-align: top;">
          <a href="${safeUrl}" target="_blank" style="text-decoration: none; display: inline-block;">
            <img src="${safeUrl}" alt="${escapeHtml(title)} ${idx + 1}" style="width: 150px; height: 115px; object-fit: cover; border-radius: 10px; border: 1px solid #cbd5e1; display: block;" />
            <span style="display: block; font-size: 10px; font-weight: 700; color: #2563eb; margin-top: 4px; text-align: center;">
              🔍 Ver foto #${idx + 1}
            </span>
          </a>
        </td>
      `
    })
    .join('')

  return `
    <div style="margin-bottom: 14px;">
      <div style="font-size: 11px; font-weight: 800; color: #475569; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px;">
        ${escapeHtml(title)} (${urls.length})
      </div>
      <table role="presentation" border="0" cellspacing="0" cellpadding="0">
        <tr>
          ${itemsHtml}
        </tr>
      </table>
    </div>
  `
}

export function generateMaintenanceServiceEmailHtml(payload: MaintenanceEmailPayload): string {
  const cleanStore = formatStoreName(payload.store_name) || payload.store_name
  const dateDisplay = formatServiceDateDisplay(payload.service_date)
  const timeDisplay = formatDurationLabel(payload.start_time, payload.end_time)
  const categoryLabel = CATEGORY_LABELS[payload.category] || payload.category
  const serviceTypeLabel = SERVICE_TYPE_LABELS[payload.service_type] || payload.service_type
  const statusInfo = STATUS_META[payload.status] || STATUS_META.completed

  const costFormatted =
    typeof payload.cost_estimate === 'number' && !Number.isNaN(payload.cost_estimate)
      ? `$${payload.cost_estimate.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`
      : payload.service_type === 'warranty'
      ? '$0.00 USD (Garantía)'
      : 'Por confirmar en factura'

  const invoiceDisplay = payload.invoice_number?.trim()
    ? escapeHtml(payload.invoice_number.trim())
    : 'Pendiente / Sin nota física en sitio'

  const beforePhotos = Array.isArray(payload.photos_before) ? payload.photos_before : []
  const afterPhotos = Array.isArray(payload.photos_after) ? payload.photos_after : []
  const invoicePhotos = Array.isArray(payload.photos_invoice) ? payload.photos_invoice : []

  return `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Servicio de Mantenimiento Registrado — Tacos Gavilan</title>
</head>
<body style="margin: 0; padding: 24px 12px; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #0f172a; line-height: 1.5;">
  <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width: 660px; background-color: #ffffff; border-radius: 20px; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.08); border: 1px solid #e2e8f0;">

          <!-- CABECERA OFICIAL TACOS GAVILAN (LOGO + ¡YA ESTÁ! SIN DUPLICACIÓN) -->
          <tr>
            <td style="background: linear-gradient(135deg, #50050a 0%, #8b0d16 55%, #DA291C 100%); padding: 26px 24px; text-align: center; border-bottom: 4px solid #fdc82f;">
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center">
                    <table role="presentation" border="0" cellspacing="0" cellpadding="0" style="margin-bottom: 12px;">
                      <tr>
                        <td style="vertical-align: middle; padding-right: 12px;">
                          <div style="width: 64px; height: 64px; border-radius: 9999px; background-color: #ffffff; padding: 4px; border: 3px solid #fdc82f; display: inline-block;">
                            <img src="https://tacosgavilan.vercel.app/logo.png" alt="Tacos Gavilan" style="width: 56px; height: 56px; object-fit: contain; display: block;" />
                          </div>
                        </td>
                        <td style="vertical-align: middle; text-align: left;">
                          <div style="color: #ffffff; font-weight: 900; font-size: 20px; letter-spacing: 0.5px; text-transform: uppercase; line-height: 1.1;">
                            TACOS GAVILAN
                          </div>
                          <img src="https://tacosgavilan.vercel.app/ya%20esta.png" alt="¡Ya está!" style="height: 28px; width: auto; object-fit: contain; display: block; margin-top: 4px;" />
                        </td>
                      </tr>
                    </table>

                    <h1 style="color: #ffffff; font-size: 20px; font-weight: 900; margin: 0; letter-spacing: -0.3px;">
                      🛠️ Nuevo Servicio de Mantenimiento Registrado
                    </h1>
                    <p style="color: #fde68a; font-size: 12.5px; font-weight: 600; margin: 6px 0 0 0;">
                      Reporte automático de los 7 pasos completados en sucursal
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- CONTENIDO PRINCIPAL -->
          <tr>
            <td style="padding: 24px;">

              <!-- PASO 1 & 3: SUCURSAL, FECHA, HORARIO Y ESTADO -->
              <table role="presentation" width="100%" style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 16px; padding: 18px; margin-bottom: 18px;">
                <tr>
                  <td>
                    <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
                      <tr>
                        <td style="vertical-align: top;">
                          <span style="display: inline-block; background-color: #DA291C; color: #ffffff; font-size: 11px; font-weight: 800; text-transform: uppercase; padding: 4px 10px; border-radius: 6px; letter-spacing: 0.5px;">
                            📍 Tacos Gavilan • ${escapeHtml(cleanStore)}
                          </span>
                          ${payload.store_address ? `
                            <div style="font-size: 11.5px; color: #64748b; font-weight: 600; margin-top: 4px;">
                              ${escapeHtml(payload.store_address)}
                            </div>
                          ` : ''}
                        </td>
                        <td align="right" style="vertical-align: top;">
                          <span style="display: inline-block; background-color: ${statusInfo.bg}; color: ${statusInfo.text}; border: 1px solid ${statusInfo.border}; font-size: 11px; font-weight: 800; padding: 5px 12px; border-radius: 9999px;">
                            ${statusInfo.label}
                          </span>
                        </td>
                      </tr>
                    </table>

                    <table role="presentation" width="100%" style="margin-top: 14px; border-top: 1px dashed #cbd5e1; padding-top: 12px;">
                      <tr>
                        <td width="50%" style="vertical-align: top; padding-right: 8px;">
                          <div style="font-size: 10.5px; font-weight: 800; color: #64748b; text-transform: uppercase;">Fecha del Servicio</div>
                          <div style="font-size: 13.5px; font-weight: 800; color: #0f172a; margin-top: 2px;">${escapeHtml(dateDisplay)}</div>
                        </td>
                        <td width="50%" style="vertical-align: top; padding-left: 8px;">
                          <div style="font-size: 10.5px; font-weight: 800; color: #64748b; text-transform: uppercase;">Horario y Duración</div>
                          <div style="font-size: 13.5px; font-weight: 800; color: #0f172a; margin-top: 2px;">⏰ ${escapeHtml(timeDisplay)}</div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- PASO 2 & 3: PROVEEDOR, TÉCNICO Y CLASIFICACIÓN -->
              <h2 style="font-size: 13px; font-weight: 900; color: #0f172a; margin: 0 0 10px 0; text-transform: uppercase; letter-spacing: 0.5px;">
                👤 Proveedor, Técnico y Categoría
              </h2>
              <table role="presentation" width="100%" style="border-collapse: collapse; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; margin-bottom: 18px;">
                <tr style="border-bottom: 1px solid #f1f5f9;">
                  <td style="padding: 10px 14px; font-size: 12px; font-weight: 700; color: #64748b; width: 38%; background-color: #f8fafc;">Empresa / Proveedor</td>
                  <td style="padding: 10px 14px; font-size: 13.5px; font-weight: 900; color: #0f172a;">${escapeHtml(payload.company_name)}</td>
                </tr>
                <tr style="border-bottom: 1px solid #f1f5f9;">
                  <td style="padding: 10px 14px; font-size: 12px; font-weight: 700; color: #64748b; background-color: #f8fafc;">Técnico Responsable</td>
                  <td style="padding: 10px 14px; font-size: 13px; font-weight: 800; color: #1e293b;">
                    ${escapeHtml(payload.technician_name)}
                    ${payload.technician_phone ? ` · <a href="tel:${escapeHtml(payload.technician_phone)}" style="color: #DA291C; text-decoration: none; font-weight: 800;">📞 ${escapeHtml(payload.technician_phone)}</a>` : ''}
                  </td>
                </tr>
                <tr style="border-bottom: 1px solid #f1f5f9;">
                  <td style="padding: 10px 14px; font-size: 12px; font-weight: 700; color: #64748b; background-color: #f8fafc;">Categoría</td>
                  <td style="padding: 10px 14px; font-size: 13px; font-weight: 800; color: #0f172a;">${escapeHtml(categoryLabel)}</td>
                </tr>
                <tr>
                  <td style="padding: 10px 14px; font-size: 12px; font-weight: 700; color: #64748b; background-color: #f8fafc;">Tipo de Servicio</td>
                  <td style="padding: 10px 14px; font-size: 13px; font-weight: 800; color: #0f172a;">
                    ${escapeHtml(serviceTypeLabel)}
                    ${payload.warranty_days && payload.warranty_days > 0 ? ` <span style="display: inline-block; background-color: #ecfdf5; color: #047857; border: 1px solid #6ee7b7; font-size: 11px; font-weight: 800; padding: 2px 8px; border-radius: 9999px; margin-left: 6px;">🛡️ Garantía: ${payload.warranty_days} días</span>` : ''}
                  </td>
                </tr>
              </table>

              <!-- PASO 4: EQUIPO ATENDIDO Y DESCRIPCIÓN DEL TRABAJO -->
              <h2 style="font-size: 13px; font-weight: 900; color: #0f172a; margin: 0 0 10px 0; text-transform: uppercase; letter-spacing: 0.5px;">
                🔧 Detalle Técnico del Trabajo Realizado
              </h2>
              <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-left: 4px solid #DA291C; border-radius: 12px; padding: 14px 16px; margin-bottom: 18px;">
                <div style="font-size: 11px; font-weight: 800; color: #64748b; text-transform: uppercase; margin-bottom: 2px;">
                  Equipo o Área Intervenida
                </div>
                <div style="font-size: 14px; font-weight: 900; color: #0f172a; margin-bottom: 12px;">
                  ${escapeHtml(payload.area_equipment)}
                </div>

                <div style="font-size: 11px; font-weight: 800; color: #64748b; text-transform: uppercase; margin-bottom: 2px;">
                  Descripción de Actividades
                </div>
                <div style="font-size: 13.5px; color: #1e293b; font-weight: 600; white-space: pre-line; line-height: 1.5;">
                  ${escapeHtml(payload.work_description)}
                </div>

                ${payload.parts_replaced?.trim() ? `
                  <div style="margin-top: 12px; padding-top: 10px; border-top: 1px dashed #cbd5e1;">
                    <div style="font-size: 11px; font-weight: 800; color: #64748b; text-transform: uppercase; margin-bottom: 2px;">
                      Piezas o Refacciones Reemplazadas
                    </div>
                    <div style="font-size: 13px; color: #0f172a; font-weight: 700;">
                      🔩 ${escapeHtml(payload.parts_replaced)}
                    </div>
                  </div>
                ` : ''}

                ${payload.notes?.trim() ? `
                  <div style="margin-top: 10px; padding-top: 10px; border-top: 1px dashed #cbd5e1;">
                    <div style="font-size: 11px; font-weight: 800; color: #64748b; text-transform: uppercase; margin-bottom: 2px;">
                      Notas / Observaciones
                    </div>
                    <div style="font-size: 12.5px; color: #475569; font-weight: 600;">
                      ${escapeHtml(payload.notes)}
                    </div>
                  </div>
                ` : ''}
              </div>

              <!-- PASO 6: INFORMACIÓN DE FACTURACIÓN Y COSTO ESTIMADO (CONTABILIDAD) -->
              <h2 style="font-size: 13px; font-weight: 900; color: #0f172a; margin: 0 0 10px 0; text-transform: uppercase; letter-spacing: 0.5px;">
                💲 Facturación y Costo Estimado
              </h2>
              <table role="presentation" width="100%" style="background-color: #fffbeb; border: 1px solid #fde68a; border-left: 4px solid #f59e0b; border-radius: 12px; padding: 14px 16px; margin-bottom: 18px;">
                <tr>
                  <td width="50%" style="vertical-align: top; padding-right: 8px;">
                    <div style="font-size: 10.5px; font-weight: 800; color: #92400e; text-transform: uppercase;">N° de Factura / Nota / Ticket</div>
                    <div style="font-size: 14px; font-weight: 900; color: #78350f; margin-top: 2px; font-family: monospace;">
                      ${invoiceDisplay}
                    </div>
                  </td>
                  <td width="50%" style="vertical-align: top; padding-left: 8px;">
                    <div style="font-size: 10.5px; font-weight: 800; color: #92400e; text-transform: uppercase;">Costo Estimado Reportado</div>
                    <div style="font-size: 15px; font-weight: 900; color: #b45309; margin-top: 2px; font-family: monospace;">
                      ${escapeHtml(costFormatted)}
                    </div>
                  </td>
                </tr>
              </table>

              <!-- PASO 5 & 6: EVIDENCIAS FOTOGRÁFICAS Y DOCUMENTOS -->
              <h2 style="font-size: 13px; font-weight: 900; color: #0f172a; margin: 0 0 10px 0; text-transform: uppercase; letter-spacing: 0.5px;">
                📸 Evidencias Fotográficas y Documentos
              </h2>
              <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 14px 16px; margin-bottom: 18px;">
                ${renderEvidenceGallery('Fotos del Antes / Diagnóstico', beforePhotos)}
                ${renderEvidenceGallery('Fotos del Después / Trabajo Terminado', afterPhotos)}
                ${renderEvidenceGallery('Foto o PDF de Factura / Nota de Servicio', invoicePhotos)}
              </div>

              <!-- PASO 7: VALIDACIÓN Y FIRMA DEL ENCARGADO EN TURNO -->
              <h2 style="font-size: 13px; font-weight: 900; color: #0f172a; margin: 0 0 10px 0; text-transform: uppercase; letter-spacing: 0.5px;">
                ✍️ Conformidad y Validación en Sucursal
              </h2>
              <table role="presentation" width="100%" style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px; padding: 14px 16px; margin-bottom: 22px;">
                <tr>
                  <td style="vertical-align: middle;">
                    <div style="font-size: 10.5px; font-weight: 800; color: #166534; text-transform: uppercase;">
                      Encargado / Validación de Tienda
                    </div>
                    <div style="font-size: 14px; font-weight: 900; color: #14532d; margin-top: 2px;">
                      ${escapeHtml(payload.manager_name)}
                    </div>
                    ${payload.is_after_hours || !payload.manager_signature_url ? `
                      <div style="font-size: 11.5px; font-weight: 700; color: #b45309; margin-top: 6px; background-color: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 8px 10px;">
                        🌙 <strong>Servicio Nocturno / Sin Firma Presencial — Protocolo de Verificación por Cámaras de Seguridad (CCTV):</strong><br/>
                        El proveedor fue notificado que al no contar con firma de encargado en turno, el Departamento de Seguridad y Supervisión verificará mediante las cámaras de seguridad (CCTV) de la sucursal: (1) Hora exacta de entrada y salida reportada en el Paso 6, (2) Ejecución efectiva del trabajo en el área/equipo indicado, y (3) Inspección física del Gerente de Apertura (AM) para liberar el pago de factura.
                      </div>
                    ` : ''}
                  </td>
                  ${payload.manager_signature_url ? `
                    <td align="right" style="vertical-align: middle;">
                      <div style="background-color: #ffffff; border: 1px solid #86efac; border-radius: 10px; padding: 6px 10px; display: inline-block; text-align: center;">
                        <img src="${escapeHtml(payload.manager_signature_url)}" alt="Firma del Encargado" style="height: 54px; width: auto; max-width: 160px; object-fit: contain; display: block;" />
                        <span style="font-size: 9px; font-weight: 800; color: #15803d; text-transform: uppercase;">Firma Digital Certificada</span>
                      </div>
                    </td>
                  ` : ''}
                </tr>
              </table>

              <!-- BOTÓN CTA: ABRIR BITÁCORA EN SM TEG -->
              <div style="text-align: center; margin: 24px 0 8px 0;">
                <a href="https://tacosgavilan.vercel.app/admin/mantenimiento" target="_blank" style="display: inline-block; background: linear-gradient(135deg, #DA291C 0%, #b91c1c 100%); color: #ffffff; font-size: 14px; font-weight: 800; text-decoration: none; padding: 14px 28px; border-radius: 12px; box-shadow: 0 4px 14px rgba(218, 41, 28, 0.35); letter-spacing: 0.3px;">
                  🔍 Ver Registro en Bitácora de Mantenimiento
                </a>
              </div>
              <div style="text-align: center; font-size: 11px; color: #94a3b8;">
                ID de Registro: <code>${escapeHtml(payload.id || 'N/A')}</code>
              </div>

            </td>
          </tr>

          <!-- PIE DE CORREO -->
          <tr>
            <td style="background-color: #f8fafc; border-top: 1px solid #e2e8f0; padding: 18px 24px; text-align: center;">
              <p style="font-size: 12px; font-weight: 800; color: #475569; margin: 0 0 4px 0;">
                Tacos Gavilan • Control de Mantenimiento y Proveedores
              </p>
              <p style="font-size: 11px; color: #94a3b8; margin: 0;">
                Notificación automática enviada a Administración y Contabilidad (<code>raquel@tacosgavilan.com</code>) al completar los 7 pasos del registro.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim()
}

export async function sendMaintenanceServiceEmail(
  payload: MaintenanceEmailPayload,
  customRecipients?: string[]
): Promise<{ success: boolean; messageId?: string; recipients?: string[]; error?: string }> {
  const smtpUser = process.env.SMTP_EMAIL || 'carlos@tacosgavilan.com'
  const smtpPass = process.env.SMTP_PASSWORD

  if (!smtpPass) {
    console.warn('[MaintenanceEmail] ⚠️ SMTP_PASSWORD no configurado en variables de entorno.')
    return {
      success: false,
      error: 'SMTP_PASSWORD no configurado en el servidor.'
    }
  }

  const recipients =
    customRecipients && customRecipients.length > 0
      ? customRecipients
      : MAINTENANCE_NOTIFICATION_RECIPIENTS

  const cleanStore = formatStoreName(payload.store_name) || payload.store_name
  const costTag =
    typeof payload.cost_estimate === 'number' && !Number.isNaN(payload.cost_estimate)
      ? ` · $${payload.cost_estimate.toFixed(2)}`
      : ''

  const subject = `🛠️ Mantenimiento [${cleanStore}] — ${payload.company_name} (${payload.area_equipment})${costTag}`

  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: smtpUser,
        pass: smtpPass
      }
    })

    const html = generateMaintenanceServiceEmailHtml(payload)

    const info = await transporter.sendMail({
      from: `"Tacos Gavilan · Mantenimiento" <${smtpUser}>`,
      to: recipients.join(', '),
      subject,
      html
    })

    console.log(
      `[MaintenanceEmail] ✅ Correo de servicio despachado a [${recipients.join(', ')}]. Message ID: ${info.messageId}`
    )
    return {
      success: true,
      messageId: info.messageId,
      recipients
    }
  } catch (error: any) {
    console.error('[MaintenanceEmail] ❌ Error despachando correo de mantenimiento:', error)
    return {
      success: false,
      error: error?.message || 'Error desconocido al enviar correo de mantenimiento'
    }
  }
}
