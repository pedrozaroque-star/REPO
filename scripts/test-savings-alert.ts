import fs from 'fs'
import path from 'path'

// Cargar variables de entorno
const envPath = path.resolve(process.cwd(), '.env.local')
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8')
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim()
    if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
      const idx = trimmed.indexOf('=')
      const key = trimmed.substring(0, idx).trim()
      const val = trimmed.substring(idx + 1).trim().replace(/^["']|["']$/g, '')
      if (!process.env[key]) {
        process.env[key] = val
      }
    }
  })
}

import { generatePriceAlertEmailHtml, sendSupplierPriceAlertEmail, PriceChangeItem } from '../lib/supplier-price-email'

async function testSavingsAlert() {
  console.log('======================================================================')
  console.log('🎉 TEST: ALERTA DE REBAJAS DE PRECIOS & AHORROS (SOLICITUD DE ROBERTO)')
  console.log('======================================================================\n')

  const sampleDecreases: PriceChangeItem[] = [
    {
      supplierSku: 'ELSDR16',
      description: 'El Gavilan - Cup, 16 oz Hot, 600 count',
      packUnit: 'CS',
      packQuantity: 600,
      previousCasePrice: 82.30,
      newCasePrice: 58.00,
      diffAmount: -24.30,
      changePercent: -29.53,
      annualVolume: 800,
      annualImpactUsd: -19440.00
    },
    {
      supplierSku: 'CPLUG-OR',
      description: 'StixToGo - Hot Beverage Plug, Orange Plastic Circle',
      packUnit: 'CS',
      packQuantity: 2000,
      previousCasePrice: 64.83,
      newCasePrice: 53.85,
      diffAmount: -10.98,
      changePercent: -16.94,
      annualVolume: 200,
      annualImpactUsd: -2196.00
    },
    {
      supplierSku: 'EL2CS2G',
      description: 'El Gavilan - Bag, 14x15+2.5 Seal2Go, 250 count',
      packUnit: 'CS',
      packQuantity: 250,
      previousCasePrice: 25.99,
      newCasePrice: 20.50,
      diffAmount: -5.49,
      changePercent: -21.12,
      annualVolume: 200,
      annualImpactUsd: -1098.00
    },
    {
      supplierSku: 'DX900GE',
      description: 'Dispenser Napkin, 2-Ply White Interfold 24/250',
      packUnit: 'CS',
      packQuantity: 6000,
      previousCasePrice: 25.55,
      newCasePrice: 25.13,
      diffAmount: -0.42,
      changePercent: -1.64,
      annualVolume: 1200,
      annualImpactUsd: -504.00
    }
  ]

  const totalSavings = sampleDecreases.reduce((acc, i) => acc + i.annualImpactUsd, 0)

  console.log(`Insumos con Rebaja: ${sampleDecreases.length} productos`)
  console.log(`Ahorro Anual Proyectado (15 Tiendas): -$${Math.abs(totalSavings).toLocaleString('en-US', { minimumFractionDigits: 2 })} USD/año\n`)

  const html = generatePriceAlertEmailHtml({
    supplierName: 'Viele & Sons',
    supplierCode: 'VIELE',
    detectedAt: new Date(),
    sourceType: 'cron_auto',
    decreases: sampleDecreases,
    netAnnualImpactUsd: totalSavings,
    isTest: true
  })

  const previewPath = path.resolve(process.cwd(), 'scratch_savings_email_preview.html')
  fs.writeFileSync(previewPath, html)
  console.log(`✅ Vista previa HTML generada en: ${previewPath}`)
  console.log(`HTML Length: ${html.length} bytes`)
  console.log(`Contiene "Alerta de Reducción de Precios & Oportunidades de Ahorro"? ${html.includes('Alerta de Reducción de Precios & Oportunidades de Ahorro')}`)
  console.log(`Contiene "-$23,238.00 USD"? ${html.includes('23,238.00')}`)

  console.log('\n======================================================================')
  console.log('🏆 ¡TEST COMPLETADO CON ÉXITO!')
  console.log('======================================================================')
}

testSavingsAlert().catch(console.error)
