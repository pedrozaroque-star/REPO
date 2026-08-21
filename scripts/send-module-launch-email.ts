import dotenv from 'dotenv'
import path from 'path'
import nodemailer from 'nodemailer'

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const RECIPIENTS = [
  'roberto@tacosgavilan.com',
  'raquel@tacosgavilan.com',
  'gonzalo@tacosgavilan.com',
  'carlos@tacosgavilan.com'
]

const SCREENSHOT_PATH = 'C:/Users/pedro/.gemini/antigravity/brain/cd97748a-342b-451f-b676-4a32d3bb8566/.user_uploaded/media_1787340371340.png'
const PDF_DESKTOP_PATH = 'c:/Users/pedro/Desktop/presentacion_radar_de_precios.pdf'
const PDF_MOBILE_PATH = 'c:/Users/pedro/Desktop/presentacion_radar_de_precios_movil.pdf'

async function sendModuleLaunchEmail() {
  console.log('===============================================================')
  console.log('🚀 TACOS GAVILAN · DESPACHO DE PRESENTACIÓN DEL RADAR DE PRECIOS')
  console.log('===============================================================')
  console.log('📧 Destinatarios:')
  RECIPIENTS.forEach((r, idx) => console.log(`   ${idx + 1}. ${r}`))
  console.log('---------------------------------------------------------------')

  const smtpUser = process.env.SMTP_EMAIL || 'carlos@tacosgavilan.com'
  const smtpPass = process.env.SMTP_PASSWORD

  if (!smtpPass) {
    throw new Error('SMTP_PASSWORD no configurado en .env.local')
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: smtpUser,
      pass: smtpPass
    }
  })

  const htmlContent = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Nuevo Módulo: Radar de Precios de Proveedores — Tacos Gavilan</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #0f172a;">
  
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f8fafc; padding: 24px 12px;">
    <tr>
      <td align="center">
        
        <!-- CONTENEDOR PRINCIPAL -->
        <table role="presentation" width="100%" style="max-width: 720px; background-color: #ffffff; border-radius: 16px; overflow: hidden; border: 1px solid #e2e8f0; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.05);" cellspacing="0" cellpadding="0">
          
          <!-- BANDA ROJA SUPERIOR GAVILAN -->
          <tr>
            <td style="background-color: #DA291C; height: 6px;"></td>
          </tr>

          <!-- ENCABEZADO -->
          <tr>
            <td style="padding: 26px 32px 18px 32px; border-bottom: 1px solid #e2e8f0;">
              <table width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td>
                    <div style="display: inline-block; background-color: #DA291C; color: #ffffff; font-weight: 900; font-size: 14px; padding: 4px 10px; border-radius: 6px; letter-spacing: 0.5px;">
                      TACOS GAVILAN
                    </div>
                    <span style="font-size: 12px; font-weight: 700; color: #64748b; margin-left: 8px; text-transform: uppercase; letter-spacing: 0.5px;">
                      SM TEG · Sistema de Monitoreo
                    </span>
                  </td>
                  <td align="right">
                    <span style="background-color: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; font-size: 11px; font-weight: 800; padding: 4px 10px; border-radius: 12px; text-transform: uppercase;">
                      NUEVA HERRAMIENTA
                    </span>
                  </td>
                </tr>
                <tr>
                  <td colspan="2" style="padding-top: 14px;">
                    <h1 style="margin: 0; font-size: 22px; font-weight: 900; color: #0f172a; line-height: 1.3;">
                      Presentación de Nuevo Módulo: Radar de Precios de Proveedores & Auditoría COGS
                    </h1>
                    <div style="font-size: 13px; color: #64748b; margin-top: 4px;">
                      Para: <strong>Roberto, Raquel, Gonzalo y Carlos</strong> · Control y Auditoría de Costos
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- BANNER DE ACLARACIÓN DE PRUEBA -->
          <tr>
            <td style="padding: 18px 32px 10px 32px;">
              <table width="100%" cellspacing="0" cellpadding="0" style="background-color: #fffbeb; border: 1px solid #fde68a; border-radius: 10px; padding: 14px 18px;">
                <tr>
                  <td width="30" style="vertical-align: top; font-size: 20px;">ℹ️</td>
                  <td style="vertical-align: top; font-size: 12.5px; color: #92400e; line-height: 1.5;">
                    <strong style="color: #78350f;">Aviso de Aclaración:</strong> El correo que recibieron hace unos momentos con el asunto <em>"Alerta de Aumento de Precios"</em> correspondió a una <strong>SIMULACIÓN Y PRUEBA TÉCNICA EN VIVO</strong> para verificar el funcionamiento del sistema de notificaciones.
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- CUERPO PRINCIPAL -->
          <tr>
            <td style="padding: 14px 32px 20px 32px; font-size: 13.5px; color: #334155; line-height: 1.6;">
              <p style="margin: 0 0 14px 0;">
                Estimados <strong>Roberto, Raquel, Gonzalo y Carlos</strong>,
              </p>
              <p style="margin: 0 0 16px 0;">
                Les presentamos el nuevo módulo <strong>Radar de Precios de Proveedores & Auditoría COGS</strong>, diseñado para monitorear y proteger el costo de los 87 insumos y empaques de <strong>Viele & Sons</strong> (y futuros proveedores como Sysco y US Foods) en las 15 sucursales de <strong>Tacos Gavilan</strong>.
              </p>

              <!-- UBICACIÓN EN EL SISTEMA -->
              <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin-bottom: 20px;">
                <div style="font-size: 12px; font-weight: 800; color: #0f172a; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px;">
                  📍 ¿Dónde se encuentra en el Sistema de Monitoreo SM TEG?
                </div>
                <div style="font-size: 13.5px; color: #1e293b;">
                  En el menú lateral izquierdo, bajo la sección <strong>INVENTARIO Y MERCANCÍA</strong>, encontrarán el nuevo acceso directo:
                  <div style="margin-top: 8px; font-size: 14px; font-weight: bold; color: #DA291C; background-color: #fef2f2; border: 1px solid #fecaca; padding: 8px 12px; border-radius: 8px; display: inline-block;">
                    📦 INVENTARIO Y MERCANCÍA ➔ 📊 Radar de Precios <span style="background-color: #DA291C; color: white; font-size: 10px; padding: 2px 6px; border-radius: 4px; margin-left: 6px;">NUEVO</span>
                  </div>
                </div>
              </div>

              <!-- CAPTURA DE PANTALLA -->
              <div style="margin-bottom: 22px; text-align: center;">
                <div style="font-size: 12px; font-weight: 800; color: #64748b; text-transform: uppercase; margin-bottom: 8px; text-align: left;">
                  📸 Captura de Pantalla del Módulo en SM TEG:
                </div>
                <div style="border: 2px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.08);">
                  <img src="cid:radar_screenshot" alt="Ubicación del Radar de Precios en SM TEG" style="width: 100%; height: auto; display: block;" />
                </div>
                <div style="font-size: 11px; color: #64748b; margin-top: 6px; font-style: italic;">
                  Vista del menú lateral con la flecha roja indicando la ubicación del módulo en <code>/admin/precios-proveedores</code>.
                </div>
              </div>

              <!-- PUNTOS CLAVE DEL FUNCIONAMIENTO -->
              <div style="font-size: 14px; font-weight: 800; color: #0f172a; margin-bottom: 10px;">
                🚀 ¿Qué hace este nuevo módulo?
              </div>

              <table width="100%" cellspacing="0" cellpadding="0" style="margin-bottom: 20px;">
                <tr>
                  <td style="padding: 10px 14px; background-color: #ffffff; border: 1px solid #e2e8f0; border-left: 4px solid #059669; border-radius: 8px; margin-bottom: 8px;">
                    <strong style="color: #059669; font-size: 13px;">1. Consulta en 1 Clic (1.3 segundos):</strong><br>
                    <span style="font-size: 12px; color: #475569;">Conecta de forma segura y directa al portal de Viele & Sons sin necesidad de descargar archivos de Excel ni capturar datos a mano.</span>
                  </td>
                </tr>
                <tr><td height="8"></td></tr>
                <tr>
                  <td style="padding: 10px 14px; background-color: #ffffff; border: 1px solid #e2e8f0; border-left: 4px solid #DA291C; border-radius: 8px; margin-bottom: 8px;">
                    <strong style="color: #DA291C; font-size: 13px;">2. Cálculo de Impacto en Dinero ($ USD):</strong><br>
                    <span style="font-size: 12px; color: #475569;">Al detectar una variación de costo, multiplica el aumento por el consumo real anual de las 15 tiendas para mostrar de inmediato el dinero en riesgo.</span>
                  </td>
                </tr>
                <tr><td height="8"></td></tr>
                <tr>
                  <td style="padding: 10px 14px; background-color: #ffffff; border: 1px solid #e2e8f0; border-left: 4px solid #2563eb; border-radius: 8px; margin-bottom: 8px;">
                    <strong style="color: #2563eb; font-size: 13px;">3. Cascada Automática a Costos de Platillos:</strong><br>
                    <span style="font-size: 12px; color: #475569;">Al aprobar los precios, divide la caja entre el número de piezas y actualiza al instante el costo de los tacos, burritos y charolas del menú.</span>
                  </td>
                </tr>
                <tr><td height="8"></td></tr>
                <tr>
                  <td style="padding: 10px 14px; background-color: #ffffff; border: 1px solid #e2e8f0; border-left: 4px solid #d97706; border-radius: 8px;">
                    <strong style="color: #d97706; font-size: 13px;">4. Alerta Automática los Lunes a las 6:00 AM:</strong><br>
                    <span style="font-size: 12px; color: #475569;">Un robot programado revisa los precios todos los lunes antes de abrir las 15 tiendas y les enviará un correo automático únicamente si detecta aumentos reales.</span>
                  </td>
                </tr>
              </table>

              <!-- ADJUNTOS -->
              <div style="background-color: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 10px; padding: 14px 18px; margin-bottom: 24px;">
                <div style="font-size: 12px; font-weight: 800; color: #334155; text-transform: uppercase; margin-bottom: 6px;">
                  📎 Documentos Adjuntos en este Correo:
                </div>
                <div style="font-size: 12.5px; color: #475569;">
                  • <strong>Presentacion_Radar_de_Precios_Tacos_Gavilan.pdf:</strong> Guía ejecutiva en formato presentación horizontal (10 diapositivas).<br>
                  • <strong>Presentacion_Radar_de_Precios_Movil_Tacos_Gavilan.pdf:</strong> Versión vertical adaptada para leer en smartphones.
                </div>
              </div>

              <!-- BOTÓN DE ENLACE DIRECTO -->
              <div style="text-align: center; margin: 28px 0 10px 0;">
                <table role="presentation" cellspacing="0" cellpadding="0" align="center">
                  <tr>
                    <td align="center" style="border-radius: 10px; background-color: #DA291C;">
                      <a href="https://tacosgavilan.vercel.app/admin/precios-proveedores" target="_blank" style="font-size: 14px; font-family: inherit; font-weight: 800; color: #ffffff; text-decoration: none; display: inline-block; padding: 14px 28px; border-radius: 10px; box-shadow: 0 4px 12px rgba(218, 41, 28, 0.3);">
                        Ingresar al Radar de Precios en SM TEG ➔
                      </a>
                    </td>
                  </tr>
                </table>
              </div>

            </td>
          </tr>

          <!-- PIE DE PÁGINA -->
          <tr>
            <td style="background-color: #f8fafc; padding: 20px 32px; border-top: 1px solid #e2e8f0; font-size: 11px; color: #64748b; text-align: center; line-height: 1.5;">
              <strong>Tacos Gavilan · Dirección de Operaciones, Finanzas y Tecnología</strong><br>
              SM TEG · Sistema de Monitoreo y Auditoría Operativa de Sucursales<br>
              Destinatarios: <code>roberto@tacosgavilan.com</code>, <code>raquel@tacosgavilan.com</code>, <code>gonzalo@tacosgavilan.com</code>, <code>carlos@tacosgavilan.com</code>
            </td>
          </tr>

        </table>

      </td>
    </tr>
  </table>

</body>
</html>
  `

  console.log('Despachando correo con imagen incrustada (CID) y 2 PDFs adjuntos...')

  const info = await transporter.sendMail({
    from: `"Tacos Gavilan · SM TEG" <${smtpUser}>`,
    to: RECIPIENTS.join(', '),
    subject: '📋 Presentación de Nuevo Módulo: Radar de Precios de Proveedores & Auditoría COGS — SM TEG',
    html: htmlContent,
    attachments: [
      {
        filename: 'ubicacion_modulo_sm_teg.png',
        path: SCREENSHOT_PATH,
        cid: 'radar_screenshot'
      },
      {
        filename: 'Presentacion_Radar_de_Precios_Tacos_Gavilan.pdf',
        path: PDF_DESKTOP_PATH
      },
      {
        filename: 'Presentacion_Radar_de_Precios_Movil_Tacos_Gavilan.pdf',
        path: PDF_MOBILE_PATH
      }
    ]
  })

  console.log('---------------------------------------------------------------')
  console.log('✅ ¡CORREO DE PRESENTACIÓN ENVIADO CON ÉXITO!')
  console.log(`ID del Mensaje: ${info.messageId}`)
  console.log(`Destinatarios confirmados: ${RECIPIENTS.join(', ')}`)
  console.log('Archivos adjuntados con éxito:')
  console.log('  1. Captura de ubicación incrustada (CID)')
  console.log('  2. Presentacion_Radar_de_Precios_Tacos_Gavilan.pdf (Desktop)')
  console.log('  3. Presentacion_Radar_de_Precios_Movil_Tacos_Gavilan.pdf (Móvil)')
  console.log('===============================================================')
}

sendModuleLaunchEmail().catch(err => {
  console.error('Error fatal al enviar:', err)
  process.exit(1)
})
