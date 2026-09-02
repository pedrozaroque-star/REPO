/**
 * Enviar el correo final formateado para Raquel directamente a carlos@tacosgavilan.com
 * 
 * Run via: npx tsx scripts/send-final-raquel-email.ts
 */

import nodemailer from 'nodemailer'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

async function sendFinalEmail() {
  console.log('📧 Enviando correo final para Raquel a carlos@tacosgavilan.com...')

  if (!process.env.SMTP_EMAIL || !process.env.SMTP_PASSWORD) {
    throw new Error('Falta configurar SMTP_EMAIL o SMTP_PASSWORD')
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.SMTP_EMAIL,
      pass: process.env.SMTP_PASSWORD,
    },
  })

  const htmlContent = `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8">
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #1e293b; background-color: #f1f5f9; margin: 0; padding: 24px; }
      .email-wrapper { max-width: 680px; margin: 0 auto; background: #ffffff; border-radius: 10px; border: 1px solid #cbd5e1; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.06); }
      .banner { background: #0f172a; padding: 24px 30px; border-bottom: 3px solid #f59e0b; }
      .brand { font-size: 11px; font-weight: 800; color: #f59e0b; letter-spacing: 1px; text-transform: uppercase; }
      .banner h1 { color: #ffffff; font-size: 20px; margin: 8px 0 0 0; font-weight: 700; }
      .body-content { padding: 30px; font-size: 14px; color: #334155; }
      .lead { font-size: 15px; font-weight: 600; color: #0f172a; margin-bottom: 16px; }
      .section-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 18px 20px; margin: 20px 0; }
      .section-title { font-size: 14px; font-weight: 700; color: #0f172a; margin-top: 0; margin-bottom: 10px; text-transform: uppercase; letter-spacing: 0.5px; }
      .feature-list { margin: 0; padding-left: 20px; }
      .feature-list li { margin-bottom: 8px; }
      table { width: 100%; border-collapse: collapse; font-size: 12.5px; margin: 12px 0; }
      th { background: #e2e8f0; padding: 8px 10px; text-align: left; font-weight: 700; color: #334155; border-bottom: 1px solid #cbd5e1; }
      td { padding: 7px 10px; border-bottom: 1px solid #f1f5f9; }
      .credit-row td { background: #f0fdf4; }
      .debit-row td { background: #eff6ff; }
      .badge-tag { display: inline-block; font-size: 10.5px; font-weight: 700; padding: 2px 6px; border-radius: 4px; font-family: monospace; }
      .badge-credit { background: #dcfce7; color: #166534; border: 1px solid #bbf7d0; }
      .badge-debit { background: #dbeafe; color: #1e40af; border: 1px solid #bfdbfe; }
      .callout { background: #fffbeb; border-left: 4px solid #f59e0b; padding: 14px 18px; border-radius: 4px; margin: 20px 0; font-size: 13px; color: #78350f; }
      .signature { margin-top: 28px; padding-top: 20px; border-top: 1px solid #e2e8f0; }
      .footer-note { font-size: 11px; color: #94a3b8; text-align: center; padding: 16px; background: #f8fafc; border-top: 1px solid #e2e8f0; }
    </style>
  </head>
  <body>
    <div class="email-wrapper">
      
      <!-- Encabezado / Banner -->
      <div class="banner">
        <div class="brand">TACOS GAVILAN • DEPARTAMENTO DE CONTABILIDAD</div>
        <h1>Propuesta: Nuevo Módulo de Pólizas Diarias (Toast → QuickBooks)</h1>
      </div>

      <!-- Contenido Principal -->
      <div class="body-content">
        <p class="lead">Hola Raquel,</p>
        
        <p>Espero que estés teniendo un excelente día.</p>
        
        <p>Te escribo para presentarte una mejora importante que hemos integrado en el sistema central de <strong>Tacos Gavilan</strong> para la conciliación y publicación de las ventas diarias a QuickBooks Online.</p>

        <p>Actualmente pagamos <strong>$450 USD mensuales ($5,400 USD anuales)</strong> por la plataforma externa Cohesion ($30/mes por sucursal). Con el fin de eliminar este costo recurrente y darte una herramienta más rápida y accesible, desarrollamos un módulo interno que realiza <strong>exactamente la misma función que Cohesion</strong>, pero de forma 100% automatizada.</p>

        <!-- Sección 1: Cómo funciona -->
        <div class="section-card">
          <div class="section-title">✨ ¿Cómo funciona el nuevo módulo para ti?</div>
          <ul class="feature-list">
            <li><strong>Auto-Generación Temprana (7:30 AM):</strong> Todas las mañanas, el sistema extrae las ventas, delivery, impuestos y pagos de las 15 tiendas directamente desde Toast POS.</li>
            <li><strong>Calendario Semanal en Pantalla:</strong> Puedes ver un calendario claro de 15 tiendas por 7 días con el estado de cada póliza (<em>Listo</em>, <em>Revisado</em>, <em>Publicado</em>).</li>
            <li><strong>Edición y Conciliación de Depósito:</strong> Si el depósito bancario real difiere del efectivo esperado, simplemente capturas el monto real y el sistema calcula y balancea automáticamente el sobrante o faltante en la cuenta <code>51050 - Cash Over/(Short)</code>.</li>
            <li><strong>Publicación a QuickBooks con 1 Clic:</strong> Puedes publicar tienda por tienda o usar el botón <strong>"Publicar Todo el Día"</strong> para enviar las 15 sucursales a QuickBooks en segundos.</li>
          </ul>
        </div>

        <!-- Sección 2: Cero Cambios en el Catálogo -->
        <div class="section-card">
          <div class="section-title">🔒 Cero Cambios en tu Catálogo Contable</div>
          <p style="font-size: 13px; margin-top: 0;">El módulo respeta al 100% tu catálogo actual. Mantiene exactamente las mismas <strong>17 cuentas contables</strong>, clases y ubicaciones:</p>
          
          <table>
            <thead>
              <tr>
                <th style="width: 80px;">Tipo</th>
                <th style="width: 90px;">Cuenta</th>
                <th>Concepto / Canal en Toast POS</th>
              </tr>
            </thead>
            <tbody>
              <tr class="credit-row">
                <td><span class="badge-tag badge-credit">CRÉDITO</span></td>
                <td><strong>40050</strong></td>
                <td>Ventas Comedor (<em>For Here</em>) y Para Llevar (<em>To Go</em>)</td>
              </tr>
              <tr class="credit-row">
                <td><span class="badge-tag badge-credit">CRÉDITO</span></td>
                <td><strong>40060</strong></td>
                <td>Uber Eats (<em>Delivery</em> y <em>Takeout</em>)</td>
              </tr>
              <tr class="credit-row">
                <td><span class="badge-tag badge-credit">CRÉDITO</span></td>
                <td><strong>40062</strong></td>
                <td>DoorDash (<em>Delivery</em> y <em>Takeout</em>)</td>
              </tr>
              <tr class="credit-row">
                <td><span class="badge-tag badge-credit">CRÉDITO</span></td>
                <td><strong>40063</strong></td>
                <td>GrubHub (<em>Delivery</em>)</td>
              </tr>
              <tr class="credit-row">
                <td><span class="badge-tag badge-credit">CRÉDITO</span></td>
                <td><strong>12050</strong></td>
                <td>Impuestos retenidos por Uber Eats</td>
              </tr>
              <tr class="credit-row">
                <td><span class="badge-tag badge-credit">CRÉDITO</span></td>
                <td><strong>24001</strong></td>
                <td>Sales Tax (Impuesto Ciudad) y Marketplace Facilitator Tax</td>
              </tr>
              <tr class="debit-row">
                <td><span class="badge-tag badge-debit">DÉBITO</span></td>
                <td><strong>10000 - 10015</strong></td>
                <td>Banco de la Sucursal (Depósito neto Tarjetas y EBT)</td>
              </tr>
              <tr class="debit-row">
                <td><span class="badge-tag badge-debit">DÉBITO</span></td>
                <td><strong>12050</strong></td>
                <td>Cuenta por Cobrar (A/R) Uber Eats</td>
              </tr>
              <tr class="debit-row">
                <td><span class="badge-tag badge-debit">DÉBITO</span></td>
                <td><strong>12053</strong></td>
                <td>Cuenta por Cobrar (A/R) DoorDash</td>
              </tr>
              <tr class="debit-row">
                <td><span class="badge-tag badge-debit">DÉBITO</span></td>
                <td><strong>12054</strong></td>
                <td>Cuenta por Cobrar (A/R) GrubHub</td>
              </tr>
              <tr class="debit-row">
                <td><span class="badge-tag badge-debit">DÉBITO</span></td>
                <td><strong>51030</strong></td>
                <td>Comisiones de Tarjetas (<em>Merchant Fees</em>)</td>
              </tr>
              <tr class="debit-row">
                <td><span class="badge-tag badge-debit">DÉBITO</span></td>
                <td><strong>13200</strong></td>
                <td>Efectivo Depositado a Banco (<em>Undeposited Funds</em>)</td>
              </tr>
              <tr class="debit-row">
                <td><span class="badge-tag badge-debit">AJUSTE</span></td>
                <td><strong>51050</strong></td>
                <td>Ajuste de Efectivo (<em>Cash Over / Short</em>)</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Callout de Validación -->
        <div class="callout">
          <strong>🧪 Validación Matemática:</strong> Realizamos simulaciones con datos reales de 5 tiendas (Azusa, Lynwood, Huntington Park, Santa Ana y West Covina) incluyendo días con faltantes y sobrantes de caja. En todos los casos, <strong>el cuadre contable fue 100% exacto al centavo ($0.00 de diferencia)</strong>.
        </div>

        <!-- Próximos Pasos -->
        <div class="section-card">
          <div class="section-title">🤝 Próximos Pasos y Visto Bueno</div>
          <p style="font-size: 13px; margin-top: 0;">Para tu total tranquilidad, te proponemos:</p>
          <ol class="feature-list" style="padding-left: 20px;">
            <li><strong>Correr 3 días de prueba en paralelo:</strong> Te damos acceso exclusivo de Administrador al módulo para que revises las pólizas generadas en nuestro sistema y verifiques que coinciden exactamente con lo que necesitas.</li>
            <li>Confirmar que los números de cuentas bancarias (<code>10000</code> a <code>10015</code>) y cuentas por cobrar de apps correspondan a tu catálogo actual.</li>
            <li>Una vez que nos des tu visto bueno y confirmes que estás satisfecha, procederemos a cancelar la suscripción externa de Cohesion.</li>
          </ol>
        </div>

        <p>Quedo muy atento a tus comentarios y con mucho gusto te muestro la pantalla cuando tengas oportunidad.</p>

        <!-- Firma -->
        <div class="signature">
          <p style="margin: 0; font-weight: 700; color: #0f172a;">Carlos Roque</p>
          <p style="margin: 2px 0 0 0; font-size: 13px; color: #64748b;">Tacos Gavilan</p>
        </div>
      </div>

      <!-- Pie de página -->
      <div class="footer-note">
        Tacos Gavilan © 2026 • Sistema Central TEG Modernizado • Confidencial
      </div>

    </div>
  </body>
  </html>
  `

  const mailOptions = {
    from: `"Carlos Roque - Tacos Gavilan" <${process.env.SMTP_EMAIL}>`,
    to: 'carlos@tacosgavilan.com',
    subject: 'Propuesta y Validación: Nuevo Módulo de Pólizas de Ventas Diarias (Toast POS → QuickBooks Online)',
    html: htmlContent,
  }

  const info = await transporter.sendMail(mailOptions)
  console.log(`✅ Correo final enviado exitosamente a carlos@tacosgavilan.com (MessageID: ${info.messageId})`)
}

sendFinalEmail().catch(err => {
  console.error('❌ Error enviando correo:', err)
})
