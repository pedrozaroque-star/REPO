/**
 * Comparación forense entre:
 * 1. La póliza #572651 creada por Cohesion en QuickBooks Online.
 * 2. El payload generado por nuestro sistema moderno para Azusa (01/09/2026).
 */

import { supabaseAdmin } from '../lib/supabase'
import { getQBStoreRefs } from '../lib/qb-classes-locations'

async function comparePayload() {
  const packetId = '83fd5b90-3a06-4723-9843-30b3e2883e7b'
  const { data: packet } = await supabaseAdmin
    .from('accounting_sales_packets')
    .select('*, stores(name)')
    .eq('id', packetId)
    .single()

  if (!packet) {
    console.error('Packet not found')
    return
  }

  const storeRefs = getQBStoreRefs(packet.stores?.name || 'Azusa')
  console.log('Store Refs:', storeRefs)

  console.log('\n📋 LÍNEAS DEL DIARIO EN NUESTRO SISTEMA:')
  console.log('---------------------------------------------------------------------------------------------------------')
  console.log('#   Cuenta  Memo                            Débito      Crédito     Entity        Ubicación   Clase')
  console.log('---------------------------------------------------------------------------------------------------------')
  
  packet.journal_lines.forEach((l: any, i: number) => {
    const entity = l.account === '13200' ? storeRefs.cohCustomerName : '—'
    console.log(
      `${String(i + 1).padStart(2)}  ` +
      `${l.account.padEnd(8)}` +
      `${l.memo.padEnd(32)}` +
      `$${l.debit.toFixed(2).padStart(9)}  ` +
      `$${l.credit.toFixed(2).padStart(9)}  ` +
      `${entity.padEnd(14)}` +
      `${l.location.padEnd(12)}` +
      `${l.className || l.class}`
    )
  })
  console.log('---------------------------------------------------------------------------------------------------------')
  console.log(`TOTALES: Débitos = $${packet.journal_total_debits.toFixed(2)} | Créditos = $${packet.journal_total_credits.toFixed(2)} | Cuadre exacto = ${packet.journal_total_debits === packet.journal_total_credits}`)
}

comparePayload().catch(console.error)
