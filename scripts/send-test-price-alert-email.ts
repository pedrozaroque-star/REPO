import dotenv from 'dotenv'
import path from 'path'

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { sendSupplierPriceAlertEmail, DEFAULT_PRICE_ALERT_RECIPIENTS } from '../lib/supplier-price-email'

async function runTestEmail() {
  console.log('===============================================================')
  console.log('🚀 TACOS GAVILAN · TEST DE ENVÍO DE ALERTA DE PRECIOS')
  console.log('===============================================================')
  console.log('📧 Destinatarios configurados:')
  DEFAULT_PRICE_ALERT_RECIPIENTS.forEach((r, idx) => {
    console.log(`   ${idx + 1}. ${r}`)
  })
  console.log('---------------------------------------------------------------')

  const testIncreases = [
    {
      supplierSku: 'EP9PR',
      description: 'Primo MFPP Plate, 9" 3/COMP Ivory (Plato Térmico 3 Divisiones)',
      packUnit: 'Caja con 500 pzas',
      packQuantity: 500,
      previousCasePrice: 29.98,
      newCasePrice: 34.50,
      diffAmount: 4.52,
      changePercent: 15.08,
      annualVolume: 8776,
      annualImpactUsd: 39667.52
    },
    {
      supplierSku: 'EL4OZ',
      description: 'El Gavilan Portion Cup, 4 oz Translucent (Vaso Salsero 4 oz)',
      packUnit: 'Caja con 2,500 pzas',
      packQuantity: 2500,
      previousCasePrice: 24.80,
      newCasePrice: 27.30,
      diffAmount: 2.50,
      changePercent: 10.08,
      annualVolume: 4025,
      annualImpactUsd: 10062.50
    }
  ]

  const totalAnnualImpact = 39667.52 + 10062.50 // $49,730.02 USD / year

  console.log(`📦 Insumos con aumento de prueba: ${testIncreases.length}`)
  console.log(`💵 Impacto financiero total estimado: +$${totalAnnualImpact.toLocaleString('en-US', { minimumFractionDigits: 2 })} USD / año en 15 tiendas`)
  console.log('---------------------------------------------------------------')
  console.log('Despachando correo vía SMTP de Tacos Gavilan...')

  const result = await sendSupplierPriceAlertEmail({
    supplierName: 'Viele & Sons',
    supplierCode: 'VIELE',
    detectedAt: new Date(),
    sourceType: 'api_sync',
    increases: testIncreases,
    netAnnualImpactUsd: totalAnnualImpact,
    recipients: DEFAULT_PRICE_ALERT_RECIPIENTS,
    isTest: false // Correo formal y real
  })

  console.log('---------------------------------------------------------------')
  if (result.success) {
    console.log('✅ ¡CORREO ENVIADO CON ÉXITO!')
    console.log(`ID del Mensaje: ${result.messageId}`)
    console.log(`Entregado a: ${result.recipients.join(', ')}`)
  } else {
    console.error('❌ ERROR AL ENVIAR CORREO:')
    console.error(result.error)
  }
  console.log('===============================================================')
}

runTestEmail().catch(err => {
  console.error('Error fatal:', err)
  process.exit(1)
})
