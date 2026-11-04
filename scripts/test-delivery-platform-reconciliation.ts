/**
 * @module scripts/test-delivery-platform-reconciliation
 * @description Suite reproducible de validación integral del módulo "Delivery Platform Order Reconciliation"
 *              de Tacos Gavilan (Lógica Contable, Reglas Fiscales, Concurrencia Atómica, Vínculos QBO,
 *              Anulaciones Toast vs Plataforma, Recuperaciones Parciales/Totales, Corte 6AM/DST y Datos Reales).
 *
 * @businessRules
 * 1. Payout oficial publicable con alertas informativas (sin convertir alertas en "conciliadas").
 * 2. Bloqueo estricto por importes oficiales faltantes, valores inválidos o desbalance (prohibido inventar plugs).
 * 3. Lock atómico concurrente (2 solicitudes simultáneas: exactamente 1 adquiere) y estado RECOVERY_REQUIRED.
 * 4. Coincidencias históricas QBO: firmes por ID/Ref, candidatas pendientes de confirmación, ambiguas y conflictivas.
 * 5. Anulaciones en Toast (`voided = true`) sin poner en cero importes de plataforma + verificación de las 5 órdenes investigadas.
 * 6. Recuperación parcial vs total exigiendo vínculo con payout posterior, importe, fecha y evidencia.
 * 7. Reglas fiscales DoorDash/Grubhub (`24001`) vs Uber Eats (`12050`) y prohibición de revertir el tax completo en reembolsos parciales.
 * 8. Corte operativo 5:59 AM / 6:00 AM PT y transiciones DST (`America/Los_Angeles`).
 */

import fs from 'fs'
import assert from 'assert'

const envFile = fs.readFileSync('.env.local', 'utf-8')
for (const line of envFile.split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/)
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
}

import { NextRequest } from 'next/server'
import jwt from 'jsonwebtoken'
import { supabaseAdmin } from '../lib/supabase'
import { getJwtSecret } from '../lib/auth-server'
import {
  evaluateDisputeRecovery,
  toOperationalBusinessDate,
  localLaComponentsToIso,
  parseLocalLaDateTime,
} from '../lib/delivery-reconciliation'
import {
  classifyOrderActionGroupAndExplanation,
  GET as getDeliveryReconciliation,
} from '../app/api/delivery-reconciliation/route'
import {
  buildPayoutJournalPreview,
  evaluateHistoricalQboJournalMatch,
  acquireAtomicPayoutPublishLock,
  buildPayoutIdempotencyKey,
  GET as getQuickBooksJournal,
} from '../app/api/delivery-reconciliation/quickbooks-journal/route'

async function runAllTests() {
  console.log('================================================================================')
  console.log('🧪 SUITE REPRODUCIBLE: DELIVERY PLATFORM ORDER RECONCILIATION — TACOS GAVILAN')
  console.log('================================================================================\n')

  let suitesPassed = 0

  // ===========================================================================
  // SUITE 1: PAYOUT OFICIAL PUBLICABLE CON ALERTAS (SEPARACIÓN BLOQUEOS VS ALERTAS)
  // ===========================================================================
  console.log('▶ [Suite 1/8] Payout oficial publicable con alertas informativas...')
  {
    const officialPayout = {
      id: 'test-payout-suite-1',
      store_id: 14,
      platform: 'DOORDASH',
      payout_reference_id: 'DD-2026-10-26-LW',
      period_start: '2026-10-26',
      period_end: '2026-11-01',
      payout_date: '2026-11-05',
      orders_count: 120,
      subtotal_sales: 8500.0,
      tax_paid_to_merchant: 956.25,
      platform_gross_receivable: 9456.25,
      commission_fees: -1418.44,
      delivery_fees: 0,
      processing_fees: 0,
      marketing_fees: -100.0,
      error_charges: -45.5,
      adjustments_amount: 0,
      net_payout_amount: 7892.31, // 7892.31 + 1518.44 - (-45.50) = 9456.25 exact
      toast_Expected_gross: 9600.0,
      gross_variance: -143.75,
      raw_payload: {},
    }

    const sampleOrdersWithPendingIssues = [
      {
        id: 'ord-1',
        store_id: 14,
        platform: 'DOORDASH',
        business_date: '2026-10-28',
        platform_order_id: 'DD-ORD-101',
        payout_reference_id: 'DD-2026-10-26-LW',
        toast_order_guid: 'guid-101',
        toast_display_number: '101',
        toast_net_sales: 40.0,
        toast_tax: 4.5,
        toast_expected_gross: 44.5,
        platform_subtotal: 40.0,
        platform_tax_paid_to_merchant: 4.5,
        platform_gross_receivable: 44.5,
        error_charge: -45.5,
        adjustment_amount: 0,
        net_payout: -7.68,
        reconciliation_status: 'REFUNDED_OR_DISPUTED',
        dispute_status: 'OPEN',
        raw_payload: { missing_tax_breakdown: true },
      },
      {
        id: 'ord-toast-only',
        store_id: 14,
        platform: 'DOORDASH',
        business_date: '2026-10-29',
        platform_order_id: 'TOAST-999',
        toast_order_guid: 'guid-999',
        toast_display_number: '999',
        toast_net_sales: 32.0,
        toast_tax: 3.6,
        toast_expected_gross: 35.6,
        platform_subtotal: 0,
        platform_gross_receivable: 0,
        match_confidence: 'TOAST_ONLY',
        reconciliation_status: 'MISSING_IN_PLATFORM',
        raw_payload: {},
      },
    ]

    const preview = buildPayoutJournalPreview({
      payout: officialPayout,
      storeName: 'Lynwood',
      storeOrders: sampleOrdersWithPendingIssues,
      splitTaxOnRefunds: false,
    })

    assert.strictEqual(preview.isBalanced, true, 'El asiento de 4 líneas debe balancear al centavo')
    assert.strictEqual(preview.canPublish, true, 'Debe permitir publicar cuando los importes oficiales del settlement están completos')
    assert.strictEqual(preview.publishBlockers.length, 0, 'No debe tener publishBlockers contables')
    assert(preview.auditWarnings.length >= 3, 'Debe conservar las alertas de auditoría (cobertura incompleta, diferencia vs Toast, disputas/tax)')
    for (const w of preview.auditWarnings) {
      assert(w.cause_es && w.cause_en, `Alerta ${w.code} debe incluir causa explicativa`)
      assert(w.next_action_es && w.next_action_en, `Alerta ${w.code} debe incluir siguiente acción`)
    }
    console.log(
      `   ✓ Payout oficial publicable (canPublish=true, 0 bloqueos) conservando ${preview.auditWarnings.length} alertas informativas con causa y siguiente acción.`
    )
    suitesPassed++
  }

  // ===========================================================================
  // SUITE 2: BLOQUEO POR IMPORTES FALTANTES / DESBALANCE (CERO PLUGS INVENTADOS)
  // ===========================================================================
  console.log('\n▶ [Suite 2/8] Bloqueos contables por importes faltantes, tienda faltante o desbalance...')
  {
    // Caso 2A: Falta sucursal / mapeo
    const missingStorePreview = buildPayoutJournalPreview({
      payout: {
        id: 'p-no-store',
        store_id: 0,
        platform: 'UBER_EATS',
        payout_reference_id: 'UE-REF-1',
        net_payout_amount: 1000,
        platform_gross_receivable: 1200,
        commission_fees: -200,
      },
      storeName: 'UNASSIGNED_STORE',
      storeOrders: [],
    })
    assert.strictEqual(missingStorePreview.canPublish, false)
    assert(missingStorePreview.publishBlockers.some((b) => b.code === 'MISSING_STORE_OR_MAPPING'))

    // Caso 2B: Falta referencia oficial del payout
    const missingRefPreview = buildPayoutJournalPreview({
      payout: {
        id: 'p-no-ref',
        store_id: 14,
        platform: 'UBER_EATS',
        payout_reference_id: '',
        net_payout_amount: 1000,
        platform_gross_receivable: 1200,
        commission_fees: -200,
      },
      storeName: 'Lynwood',
      storeOrders: [],
    })
    assert.strictEqual(missingRefPreview.canPublish, false)
    assert(missingRefPreview.publishBlockers.some((b) => b.code === 'MISSING_PAYOUT_REFERENCE'))

    // Caso 2C: Faltan importes oficiales del settlement (platform_gross_receivable = 0 sin raw_payload oficial)
    const missingAmountsPreview = buildPayoutJournalPreview({
      payout: {
        id: 'p-no-gross',
        store_id: 14,
        platform: 'DOORDASH',
        payout_reference_id: 'DD-NO-GROSS',
        net_payout_amount: 1500,
        platform_gross_receivable: 0,
        subtotal_sales: 0,
        commission_fees: -300,
        raw_payload: {},
      },
      storeName: 'Lynwood',
      storeOrders: [],
    })
    assert.strictEqual(missingAmountsPreview.canPublish, false)
    assert(
      missingAmountsPreview.publishBlockers.some((b) => b.code === 'MISSING_OFFICIAL_SETTLEMENT_AMOUNTS'),
      'Debe bloquear cuando falta el importe bruto oficial del settlement en lugar de inventarlo'
    )

    // Caso 2D: Desbalance contable real ($25.00 de diferencia entre bruto oficial y neto + fees - refunds)
    const unbalancedPreview = buildPayoutJournalPreview({
      payout: {
        id: 'p-unbalanced',
        store_id: 14,
        platform: 'DOORDASH',
        payout_reference_id: 'DD-UNBALANCED',
        net_payout_amount: 1000.0,
        commission_fees: -200.0,
        error_charges: 0,
        platform_gross_receivable: 1225.0, // Desbalance de $25.00
        subtotal_sales: 1100.0,
        tax_paid_to_merchant: 125.0,
        raw_payload: {},
      },
      storeName: 'Lynwood',
      storeOrders: [],
    })
    assert.strictEqual(unbalancedPreview.isBalanced, false, 'Debe detectar que Débitos ($1,200) != Créditos ($1,225)')
    assert.strictEqual(unbalancedPreview.canPublish, false, 'Debe bloquear publicación cuando no balancea')
    assert(unbalancedPreview.publishBlockers.some((b) => b.code === 'UNBALANCED_JOURNAL'))
    console.log(
      '   ✓ Bloqueos verificados: MISSING_STORE_OR_MAPPING, MISSING_PAYOUT_REFERENCE, MISSING_OFFICIAL_SETTLEMENT_AMOUNTS y UNBALANCED_JOURNAL (sin inventar plugs).'
    )
    suitesPassed++
  }

  // ===========================================================================
  // SUITE 3: CONCURRENCIA ATÓMICA EN VIVO Y RECUPERACIÓN TRAS FALLO (RECOVERY_REQUIRED)
  // ===========================================================================
  console.log('\n▶ [Suite 3/8] Prueba en vivo de lock atómico concurrente (2 solicitudes simultáneas) y RECOVERY_REQUIRED...')
  {
    const tempRef = `TEST-LOCK-${Date.now()}`
    const { data: insertedRow, error: insErr } = await supabaseAdmin
      .from('delivery_platform_payouts')
      .insert({
        store_id: 14,
        platform: 'DOORDASH',
        payout_reference_id: tempRef,
        period_start: '2099-01-01',
        period_end: '2099-01-07',
        payout_date: '2099-01-10',
        orders_count: 1,
        subtotal_sales: 100,
        tax_collected: 11.25,
        tax_remitted_by_platform: 0,
        tax_paid_to_merchant: 11.25,
        platform_gross_receivable: 111.25,
        commission_fees: -20,
        delivery_fees: 0,
        processing_fees: 0,
        marketing_fees: 0,
        error_charges: 0,
        adjustments_amount: 0,
        tips_amount: 0,
        net_payout_amount: 91.25,
        toast_matched_orders_count: 1,
        toast_net_sales: 100,
        toast_tax_amount: 11.25,
        toast_expected_gross: 111.25,
        gross_variance: 0,
        status: 'VERIFIED',
        source_type: 'TEST_CONCURRENCY',
        raw_payload: { test_ephemeral: true },
      })
      .select('*')
      .single()

    if (insErr || !insertedRow) {
      throw new Error(`No se pudo insertar fila temporal para prueba de concurrencia: ${insErr?.message}`)
    }

    try {
      const idempKey = buildPayoutIdempotencyKey('DOORDASH', 14, tempRef)
      // Lanzar DOS adquisiciones concurrentes al mismo milisegundo
      const [lockA, lockB] = await Promise.all([
        acquireAtomicPayoutPublishLock({
          payoutId: insertedRow.id,
          currentRawPayload: insertedRow.raw_payload || {},
          idempotencyKey: idempKey,
          userEmail: 'concurrent_req_1@tacosgavilan.com',
          userId: 1,
          userRole: 'admin',
        }),
        acquireAtomicPayoutPublishLock({
          payoutId: insertedRow.id,
          currentRawPayload: insertedRow.raw_payload || {},
          idempotencyKey: idempKey,
          userEmail: 'concurrent_req_2@tacosgavilan.com',
          userId: 2,
          userRole: 'admin',
        }),
      ])

      const acquiredCount = (lockA.acquired ? 1 : 0) + (lockB.acquired ? 1 : 0)
      assert.strictEqual(
        acquiredCount,
        1,
        `Exactamente 1 solicitud concurrente debe adquirir el lock atómico (obtenido: ${acquiredCount})`
      )
      const winner = lockA.acquired ? lockA : lockB
      const loser = lockA.acquired ? lockB : lockA
      assert.strictEqual(winner.affectedRows, 1)
      assert.strictEqual(loser.acquired, false)

      // Simular que la solicitud ganadora dejó el payout en RECOVERY_REQUIRED tras fallo de red/persistencia
      await supabaseAdmin
        .from('delivery_platform_payouts')
        .update({
          raw_payload: {
            test_ephemeral: true,
            qb_publish_status: 'RECOVERY_REQUIRED',
            qb_idempotency_key: idempKey,
          },
        })
        .eq('id', insertedRow.id)

      const { data: recRow } = await supabaseAdmin
        .from('delivery_platform_payouts')
        .select('*')
        .eq('id', insertedRow.id)
        .single()

      const lockDuringRecovery = await acquireAtomicPayoutPublishLock({
        payoutId: insertedRow.id,
        currentRawPayload: recRow?.raw_payload || {},
        idempotencyKey: idempKey,
        userEmail: 'retry_without_check@tacosgavilan.com',
      })
      assert.strictEqual(
        lockDuringRecovery.acquired,
        false,
        'Debe bloquear reintento directo cuando el payout está en RECOVERY_REQUIRED hasta verificar QBO'
      )

      console.log(
        `   ✓ Concurrencia atómica verificada en vivo en Supabase: de 2 llamadas simultáneas, 1 adquirió (affectedRows=1) y 1 fue bloqueada (${loser.reason}). Estado RECOVERY_REQUIRED bloquea reintento ciego.`
      )
      suitesPassed++
    } finally {
      await supabaseAdmin.from('delivery_platform_payouts').delete().eq('id', insertedRow.id)
    }
  }

  // ===========================================================================
  // SUITE 4: COINCIDENCIAS QBO FIRMES, CANDIDATAS, AMBIGUAS Y CONFLICTIVAS + AUDITORÍA DE 379 VÍNCULOS
  // ===========================================================================
  console.log('\n▶ [Suite 4/8] Evaluación de pólizas históricas QBO (firme, candidata, ambigua, conflicto) y auditoría DB...')
  {
    const basePayout = {
      id: 'payout-lw-1',
      store_id: 14,
      platform: 'DOORDASH',
      payout_reference_id: '99887766',
      period_start: '2026-10-19',
      period_end: '2026-10-25',
      payout_date: '2026-10-30',
      net_payout_amount: 7500.0,
      platform_gross_receivable: 9100.0,
      raw_payload: {},
    }

    const jeWithRef = {
      Id: '9001',
      DocNumber: '20261099',
      TxnDate: '2026-10-30',
      PrivateNote: 'DOORDASH Settlement #99887766 - Lynwood',
      Line: [
        {
          Amount: 7500.0,
          JournalEntryLineDetail: {
            PostingType: 'Debit',
            AccountRef: { value: '258', name: '10014 Lynwood' },
            DepartmentRef: { value: '13', name: 'Lynwood' },
          },
        },
        {
          Amount: 9100.0,
          JournalEntryLineDetail: {
            PostingType: 'Credit',
            AccountRef: { value: '453', name: '12053 Receivables Due from DoorDash' },
            DepartmentRef: { value: '13', name: 'Lynwood' },
          },
        },
      ],
    }

    // 4A: Firme por referencia oficial en PrivateNote
    const firmMatch = evaluateHistoricalQboJournalMatch({
      payout: basePayout,
      storeLocationId: '13',
      bankAccountQbId: '258',
      receivableQbId: '453',
      expectedReceivableAmount: 9100.0,
      qbJournalEntries: [jeWithRef],
      autoLinkAccountingSingleCandidate: false,
    })
    assert.strictEqual(firmMatch.classification, 'FIRM_ID_OR_REF')
    assert.strictEqual(firmMatch.matchedJe?.Id, '9001')

    // 4B: Candidato histórico sin referencia en PrivateNote (autoLinkAccountingSingleCandidate = false -> requiere confirmación)
    const jeWithoutRef1 = {
      ...jeWithRef,
      Id: '9002',
      DocNumber: 'POS20261030',
      PrivateNote: 'Historical manual entry by bookkeeper',
    }
    const candidateMatch = evaluateHistoricalQboJournalMatch({
      payout: basePayout,
      storeLocationId: '13',
      bankAccountQbId: '258',
      receivableQbId: '453',
      expectedReceivableAmount: 9100.0,
      qbJournalEntries: [jeWithoutRef1],
      autoLinkAccountingSingleCandidate: false,
    })
    assert.strictEqual(candidateMatch.classification, 'HISTORICAL_CANDIDATE_PENDING_REVIEW')
    assert.strictEqual(candidateMatch.matchedJe, null, 'No debe auto-vincular silenciosamente sin confirmación')
    assert.strictEqual(candidateMatch.candidates.length, 1)

    // 4C: Ambigüedad (>1 candidato contable con mismo banco, CxC, tienda e importe)
    const jeWithoutRef2 = {
      ...jeWithoutRef1,
      Id: '9003',
      DocNumber: 'POS20261031',
      TxnDate: '2026-10-31',
    }
    const ambiguousMatch = evaluateHistoricalQboJournalMatch({
      payout: basePayout,
      storeLocationId: '13',
      bankAccountQbId: '258',
      receivableQbId: '453',
      expectedReceivableAmount: 9100.0,
      qbJournalEntries: [jeWithoutRef1, jeWithoutRef2],
      autoLinkAccountingSingleCandidate: true,
    })
    assert.strictEqual(ambiguousMatch.classification, 'AMBIGUOUS_CANDIDATES')
    assert.strictEqual(ambiguousMatch.matchedJe, null, 'Nunca debe vincular automáticamente cuando hay ambigüedad')
    assert.strictEqual(ambiguousMatch.candidates.length, 2)

    // 4D: Conflicto por póliza ya asignada a otro payout distinto
    const assignedMap = new Map<string, string>([['9001', 'other-payout-id-999']])
    const conflictMatch = evaluateHistoricalQboJournalMatch({
      payout: basePayout,
      storeLocationId: '13',
      bankAccountQbId: '258',
      receivableQbId: '453',
      expectedReceivableAmount: 9100.0,
      qbJournalEntries: [jeWithRef],
      alreadyAssignedJeIds: assignedMap,
    })
    assert.strictEqual(conflictMatch.classification, 'CONFLICT_DUPLICATE_JE')
    assert.strictEqual(conflictMatch.matchedJe, null)
    assert.strictEqual(conflictMatch.conflictWithPayoutId, 'other-payout-id-999')

    // 4E: Verificación en vivo de los 416 payouts en Supabase (0 duplicados)
    const { data: allDbPayouts } = await supabaseAdmin
      .from('delivery_platform_payouts')
      .select('id, raw_payload')
    const seenJeIds = new Set<string>()
    let duplicateJeCount = 0
    let linkedCount = 0
    for (const p of allDbPayouts || []) {
      const jeId = String(p.raw_payload?.qb_journal_entry_id || '').trim()
      if (jeId) {
        linkedCount++
        if (seenJeIds.has(jeId)) duplicateJeCount++
        seenJeIds.add(jeId)
      }
    }
    assert.strictEqual(duplicateJeCount, 0, 'Cero pólizas QBO duplicadas entre payouts en base de datos')
    console.log(
      `   ✓ Evaluación QBO verificada (FIRM_ID_OR_REF, HISTORICAL_CANDIDATE_PENDING_REVIEW, AMBIGUOUS_CANDIDATES, CONFLICT_DUPLICATE_JE) y ${linkedCount}/${allDbPayouts?.length || 0} vínculos en DB con 0 duplicados.`
    )
    suitesPassed++
  }

  // ===========================================================================
  // SUITE 5: ANULACIONES EN TOAST SIN ALTERAR IMPORTES DE PLATAFORMA + 5 ÓRDENES INVESTIGADAS
  // ===========================================================================
  console.log('\n▶ [Suite 5/8] Anulaciones en Toast (voided=true) y verificación en vivo de las 5 órdenes investigadas...')
  {
    const targetCodes = ['D9C51', 'B411C', 'A6353', '84B4D', 'B77B5']
    const { data: fiveOrders, error: fiveErr } = await supabaseAdmin
      .from('delivery_platform_orders')
      .select('*')
      .in('platform_order_id', targetCodes)

    if (fiveErr || !fiveOrders || fiveOrders.length !== 5) {
      throw new Error(`No se encontraron las 5 órdenes investigadas en DB: ${fiveErr?.message}`)
    }

    const expectedSubtotals: Record<string, number> = {
      D9C51: 13.38,
      B411C: 26.07,
      A6353: 27.06,
      '84B4D': 16.88,
      B77B5: 20.74,
    }
    const expectedNetPayouts: Record<string, number> = {
      D9C51: 10.3,
      B411C: 20.07,
      A6353: 20.84,
      '84B4D': 13.0,
      B77B5: 15.97,
    }

    for (const ord of fiveOrders) {
      const code = ord.platform_order_id
      const expSub = expectedSubtotals[code]
      const expNet = expectedNetPayouts[code]
      assert.strictEqual(
        Number(ord.platform_subtotal),
        expSub,
        `Orden #${code} debe conservar su platform_subtotal original ($${expSub}) sin ponerse en $0.00`
      )
      assert.strictEqual(
        Number(ord.platform_gross_receivable),
        expSub,
        `Orden #${code} debe conservar su platform_gross_receivable original ($${expSub})`
      )
      assert.strictEqual(
        Number(ord.net_payout),
        expNet,
        `Orden #${code} debe conservar su net_payout original ($${expNet})`
      )
      assert.strictEqual(Number(ord.toast_net_sales), 0, `Orden #${code} tiene toast_net_sales = 0 por void en POS`)
      assert.strictEqual(Boolean(ord.raw_payload?.toast_voided), true, `Orden #${code} tiene toast_voided = true`)

      const classified = classifyOrderActionGroupAndExplanation(ord)
      assert.strictEqual(
        classified.action_group,
        'VARIANCE_INVESTIGATE',
        `Orden #${code} debe permanecer en VARIANCE_INVESTIGATE y nunca darse por conciliada automáticamente`
      )
      if (code === '84B4D' || code === 'B77B5') {
        assert.strictEqual(classified.status_code, 'VOIDED_CANCELED_PLATFORM_AMOUNT_INCONSISTENCY')
      } else {
        assert.strictEqual(classified.status_code, 'PAID_BY_PLATFORM_VOIDED_IN_TOAST')
      }
      console.log(
        `   ✓ #${code} (Store #${ord.store_id}, ${ord.business_date}): Toast=$0.00 (orig $${ord.raw_payload?.toast_voided_original_subtotal}) | Plat=$${ord.platform_gross_receivable} | Net=$${ord.net_payout} | Status=${classified.status_code}`
      )
    }
    suitesPassed++
  }

  // ===========================================================================
  // SUITE 6: RECUPERACIÓN PARCIAL Y TOTAL CON EVIDENCIA VERIFICABLE
  // ===========================================================================
  console.log('\n▶ [Suite 6/8] Evaluación de recuperación parcial, total y sin evidencia verificable...')
  {
    const baseDisputedOrder = {
      id: 'disp-1',
      store_id: 14,
      platform: 'UBER_EATS',
      platform_order_id: 'UE-DISP-1',
      payout_reference_id: 'UE-CUT-1',
      toast_order_guid: 'guid-d1',
      toast_display_number: '501',
      toast_expected_gross: 30.0,
      platform_gross_receivable: 30.0,
      error_charge: -25.0,
      adjustment_amount: 0,
      net_payout: -1.5,
      is_disputed: true,
      reconciliation_status: 'REFUNDED_OR_DISPUTED',
      dispute_status: 'REIMBURSED',
    }

    // 6A: Recuperación Total ($25.00 de $25.00 con payout, fecha y evidencia)
    const fullOrd = {
      ...baseDisputedOrder,
      dispute_notes: 'Evidencia de reembolso completo en liquidación posterior',
      raw_payload: {
        reimbursement_payout_ref: 'UE-CUT-2',
        reimbursement_amount: 25.0,
        reimbursement_deposit_date: '2026-11-04',
        reimbursement_evidence: 'Aprobado en portal Uber Eats ref UE-CUT-2',
      },
    }
    const evalFull = evaluateDisputeRecovery(fullOrd)
    const classFull = classifyOrderActionGroupAndExplanation(fullOrd)
    assert.strictEqual(evalFull.recoveryClassification, 'FULL_RECOVERY')
    assert.strictEqual(evalFull.unrecoveredAmount, 0)
    assert.strictEqual(classFull.status_code, 'DISPUTE_RECOVERED')

    // 6B: Recuperación Parcial ($15.00 de $25.00 -> $10.00 pendientes)
    const partialOrd = {
      ...baseDisputedOrder,
      dispute_notes: 'Reembolso parcial otorgado por plataforma',
      raw_payload: {
        reimbursement_payout_ref: 'UE-CUT-2',
        reimbursement_amount: 15.0,
        reimbursement_deposit_date: '2026-11-04',
        reimbursement_evidence: 'Reembolso parcial en corte UE-CUT-2',
      },
    }
    const evalPartial = evaluateDisputeRecovery(partialOrd)
    const classPartial = classifyOrderActionGroupAndExplanation(partialOrd)
    assert.strictEqual(evalPartial.recoveryClassification, 'PARTIAL_RECOVERY')
    assert.strictEqual(evalPartial.unrecoveredAmount, 10.0)
    assert.strictEqual(classPartial.status_code, 'DISPUTE_PARTIALLY_RECOVERED')

    // 6C: Sin evidencia verificable (falta fecha o referencia de payout)
    const unverifiedOrd = {
      ...baseDisputedOrder,
      dispute_notes: 'Dicen que ya pagaron',
      raw_payload: {
        reimbursement_payout_ref: '',
        reimbursement_amount: 25.0,
        reimbursement_deposit_date: '',
      },
    }
    const evalUnverified = evaluateDisputeRecovery(unverifiedOrd)
    const classUnverified = classifyOrderActionGroupAndExplanation(unverifiedOrd)
    assert.strictEqual(evalUnverified.recoveryClassification, 'UNVERIFIED_RECOVERY')
    assert.strictEqual(classUnverified.status_code, 'DISPUTE_RECOVERY_MISSING_EVIDENCE')

    console.log(
      '   ✓ Recuperaciones verificadas: FULL_RECOVERY ($0 pendiente), PARTIAL_RECOVERY ($10.00 no recuperados) y UNVERIFIED_RECOVERY bloqueada sin evidencia.'
    )
    suitesPassed++
  }

  // ===========================================================================
  // SUITE 7: REGLAS FISCALES DOORDASH / GRUBHUB / UBER EATS Y REEMBOLSOS PARCIALES
  // ===========================================================================
  console.log('\n▶ [Suite 7/8] Reglas fiscales DD/GH (24001) vs Uber Eats (12050) y reembolsos parciales...')
  {
    // 7A: Uber Eats jamás genera reversión ni pasivo en 24001 Sales Tax Payable
    const uberPayout = {
      id: 'p-uber-tax',
      store_id: 14,
      platform: 'UBER_EATS',
      payout_reference_id: 'UE-TAX-1',
      period_start: '2026-10-26',
      period_end: '2026-11-01',
      payout_date: '2026-11-03',
      subtotal_sales: 5000.0,
      tax_collected: 562.5,
      tax_remitted_by_platform: 562.5,
      tax_paid_to_merchant: 0,
      platform_gross_receivable: 5000.0,
      commission_fees: -1000.0,
      error_charges: -30.0,
      net_payout_amount: 3970.0,
      raw_payload: {},
    }
    const uberPreview = buildPayoutJournalPreview({
      payout: uberPayout,
      storeName: 'Lynwood',
      storeOrders: [
        {
          id: 'u-ord-1',
          store_id: 14,
          platform: 'UBER_EATS',
          platform_order_id: 'UE1',
          payout_reference_id: 'UE-TAX-1',
          platform_subtotal: 30.0,
          platform_gross_receivable: 30.0,
          toast_tax: 3.38,
          error_charge: -30.0,
          raw_payload: {},
        },
      ],
      splitTaxOnRefunds: true,
    })
    assert.strictEqual(uberPreview.embeddedRefundTax, 0, 'Uber Eats jamás debe calcular tax para cuenta 24001')
    assert(
      !uberPreview.lines.some((l) => l.accountNumber === '24001'),
      'Uber Eats jamás debe tocar la cuenta 24001 Sales tax payable'
    )

    // 7B: DoorDash con reembolso PARCIAL (-$10.00 sobre orden de $44.50 con tax total de $4.50 sin desglose del tax del reembolso)
    const ddPayoutPartial = {
      id: 'p-dd-partial-tax',
      store_id: 14,
      platform: 'DOORDASH',
      payout_reference_id: 'DD-PARTIAL-TAX',
      period_start: '2026-10-26',
      period_end: '2026-11-01',
      payout_date: '2026-11-05',
      subtotal_sales: 1000.0,
      tax_paid_to_merchant: 112.5,
      platform_gross_receivable: 1112.5,
      commission_fees: -200.0,
      error_charges: -10.0,
      net_payout_amount: 902.5,
      raw_payload: {},
    }
    const ddPartialPreview = buildPayoutJournalPreview({
      payout: ddPayoutPartial,
      storeName: 'Lynwood',
      storeOrders: [
        {
          id: 'dd-ord-partial',
          store_id: 14,
          platform: 'DOORDASH',
          platform_order_id: 'DD-PART-1',
          payout_reference_id: 'DD-PARTIAL-TAX',
          platform_subtotal: 40.0,
          platform_tax_paid_to_merchant: 4.5,
          platform_gross_receivable: 44.5,
          toast_net_sales: 40.0,
          toast_tax: 4.5,
          error_charge: -10.0, // Reembolso parcial ($10.00 < $44.50)
          raw_payload: { tax_breakdown_verified: true },
        },
      ],
      splitTaxOnRefunds: true,
    })
    assert.strictEqual(
      ddPartialPreview.embeddedRefundTax,
      0,
      'PROHIBIDO revertir el tax completo ($4.50) de la orden cuando el reembolso ($10.00) es parcial'
    )
    assert(
      ddPartialPreview.auditWarnings.some((w) => w.code === 'PARTIAL_REFUND_TAX_PENDING_INVESTIGATION'),
      'Debe emitir alerta PARTIAL_REFUND_TAX_PENDING_INVESTIGATION dejando la investigación pendiente'
    )
    assert.strictEqual(
      ddPartialPreview.canPublish,
      true,
      'La falta de detalle fiscal por orden parcial NO impide publicar el settlement oficial de 4 líneas'
    )

    // 7C: DoorDash con reembolso TOTAL (-$44.50 sobre orden de $44.50 con tax verificado de $4.50)
    const ddPayoutFull = {
      ...ddPayoutPartial,
      id: 'p-dd-full-tax',
      payout_reference_id: 'DD-FULL-TAX',
      error_charges: -44.5,
      net_payout_amount: 868.0,
    }
    const ddFullPreview = buildPayoutJournalPreview({
      payout: ddPayoutFull,
      storeName: 'Lynwood',
      storeOrders: [
        {
          id: 'dd-ord-full',
          store_id: 14,
          platform: 'DOORDASH',
          platform_order_id: 'DD-FULL-1',
          payout_reference_id: 'DD-FULL-TAX',
          platform_subtotal: 40.0,
          platform_tax_paid_to_merchant: 4.5,
          platform_gross_receivable: 44.5,
          toast_net_sales: 40.0,
          toast_tax: 4.5,
          error_charge: -44.5, // Reembolso total = 100% de la orden
          raw_payload: { tax_breakdown_verified: true },
        },
      ],
      splitTaxOnRefunds: true,
    })
    assert.strictEqual(ddFullPreview.embeddedRefundTax, 4.5, 'En reembolso total comprobado sí permite separar $4.50 de tax real')
    assert(ddFullPreview.lines.some((l) => l.accountNumber === '24001' && l.amount === 4.5))

    console.log(
      '   ✓ Reglas fiscales comprobadas: Uber Eats (0 en 24001), Reembolso Parcial DD (no revierte tax completo y emite alerta sin bloquear) y Reembolso Total DD ($4.50 en 24001).'
    )
    suitesPassed++
  }

  // ===========================================================================
  // SUITE 8: CORTE OPERATIVO 5:59 AM / 6:00 AM PT Y CAMBIOS DST (AMERICA/LOS_ANGELES)
  // ===========================================================================
  console.log('\n▶ [Suite 8/9] Corte de día laboral 5:59 AM vs 6:00 AM PT y transiciones DST...')
  {
    // 2026-10-28 en PDT (UTC-7):
    // 05:59:59 AM PDT = 2026-10-28T12:59:59Z -> pertenece al día laboral 2026-10-27
    // 06:00:00 AM PDT = 2026-10-28T13:00:00Z -> inicia el día laboral 2026-10-28
    const bDateBefore6 = toOperationalBusinessDate('2026-10-28T12:59:59.000Z')
    const bDateAt6 = toOperationalBusinessDate('2026-10-28T13:00:00.000Z')
    assert.strictEqual(bDateBefore6, '2026-10-27', '5:59:59 AM PT debe pertenecer al día laboral anterior (2026-10-27)')
    assert.strictEqual(bDateAt6, '2026-10-28', '6:00:00 AM PT debe iniciar el nuevo día laboral (2026-10-28)')

    // Cambio DST Primavera (Spring Forward: 2026-03-08 pasa de PST UTC-8 a PDT UTC-7)
    // 2026-03-08 05:59:00 AM PDT = 2026-03-08T12:59:00Z -> 2026-03-07
    // 2026-03-08 06:00:00 AM PDT = 2026-03-08T13:00:00Z -> 2026-03-08
    assert.strictEqual(toOperationalBusinessDate('2026-03-08T12:59:00.000Z'), '2026-03-07')
    assert.strictEqual(toOperationalBusinessDate('2026-03-08T13:00:00.000Z'), '2026-03-08')

    // Hora local inexistente en Spring Forward (2026-03-08 02:30 AM)
    const nonExistentDst = parseLocalLaDateTime('2026-03-08', '02:30:00 AM')
    assert.strictEqual(nonExistentDst.nonExistentDstLocalTime, true, 'Debe detectar hora local inexistente en Spring Forward')
    assert.strictEqual(nonExistentDst.unverifiedReason, 'NONEXISTENT_DST_LOCAL_TIME')

    // Cambio DST Otoño (Fall Back: 2026-11-01 pasa de PDT UTC-7 a PST UTC-8)
    // 2026-11-01 05:59:00 AM PST = 2026-11-01T13:59:00Z -> 2026-10-31
    // 2026-11-01 06:00:00 AM PST = 2026-11-01T14:00:00Z -> 2026-11-01
    assert.strictEqual(toOperationalBusinessDate('2026-11-01T13:59:00.000Z'), '2026-10-31')
    assert.strictEqual(toOperationalBusinessDate('2026-11-01T14:00:00.000Z'), '2026-11-01')

    assert.strictEqual(localLaComponentsToIso(2026, 10, 26, 6, 0, 0), '2026-10-26T13:00:00.000Z', 'Inicio 6:00 AM PDT (UTC-7)')
    assert.strictEqual(localLaComponentsToIso(2026, 11, 2, 5, 59, 59), '2026-11-02T13:59:59.000Z', 'Fin 5:59:59 AM PST (UTC-8 tras cambio horario)')

    console.log(
      `   ✓ Corte operativo 6:00 AM -> 5:59 AM PT y cambios DST (Primavera 2026-03-08, hora inexistente 02:30 AM y Otoño 2026-11-01) verificados al milisegundo.`
    )
    suitesPassed++
  }

  // ===========================================================================
  // SUITE 9: FLUJO INTEGRAL DE SUCURSAL Y PERIODO CERRADO (3 PLATAFORMAS, API REAL)
  // ===========================================================================
  console.log('\n▶ [Suite 9/9] Flujo integral de sucursal (Lynwood #14) y periodo cerrado en las 3 plataformas...')
  {
    const { data: adminUser } = await supabaseAdmin
      .from('users')
      .select('id, email, full_name, role')
      .eq('role', 'admin')
      .eq('is_active', true)
      .limit(1)
      .single()
    assert(adminUser, 'Debe existir al menos un usuario admin activo en public.users')

    const testToken = jwt.sign(
      { sub: String(adminUser.id), email: adminUser.email, name: adminUser.full_name, role: 'admin' },
      getJwtSecret()!,
      { algorithm: 'HS256', expiresIn: '1h' }
    )
    const authHeaders = { Authorization: `Bearer ${testToken}` }

    const reqReconcil = new NextRequest(
      'http://localhost:3000/api/delivery-reconciliation?store_id=14&start_date=2026-10-05&end_date=2026-11-01',
      { headers: authHeaders }
    )
    const resReconcil = await getDeliveryReconciliation(reqReconcil)
    const jsonReconcil = await resReconcil.json()
    assert.strictEqual(jsonReconcil.success, true, 'API /api/delivery-reconciliation debe responder success=true')
    assert(Array.isArray(jsonReconcil.orders) && jsonReconcil.orders.length > 0, 'Debe retornar órdenes reales de Lynwood')
    assert(Array.isArray(jsonReconcil.payouts) && jsonReconcil.payouts.length > 0, 'Debe retornar payouts reales de Lynwood')

    const platformsInPayouts = new Set(jsonReconcil.payouts.map((p: any) => p.platform))
    assert(platformsInPayouts.has('DOORDASH'), 'Lynwood debe incluir payouts de DOORDASH en el periodo cerrado')
    assert(platformsInPayouts.has('UBER_EATS'), 'Lynwood debe incluir payouts de UBER_EATS en el periodo cerrado')
    assert(platformsInPayouts.has('GRUBHUB'), 'Lynwood debe incluir payouts de GRUBHUB en el periodo cerrado')

    const reqQb = new NextRequest(
      'http://localhost:3000/api/delivery-reconciliation/quickbooks-journal?store_id=14&start_date=2026-10-05&end_date=2026-11-01',
      { headers: authHeaders }
    )
    const resQb = await getQuickBooksJournal(reqQb)
    const jsonQb = await resQb.json()
    assert.strictEqual(jsonQb.success, true, 'API /api/delivery-reconciliation/quickbooks-journal debe responder success=true')
    assert(Array.isArray(jsonQb.records) && jsonQb.records.length > 0, 'Debe retornar registros contables de payouts para Lynwood')

    for (const rec of jsonQb.records) {
      assert(rec.payoutPolicyStatus && rec.payoutPolicyStatus.code, 'Cada payout debe exponer payoutPolicyStatus independiente')
      assert(rec.auditStatus && rec.auditStatus.code, 'Cada payout debe exponer auditStatus independiente')
      assert(rec.disputeRecoveryStatus && rec.disputeRecoveryStatus.code, 'Cada payout debe exponer disputeRecoveryStatus independiente')
      assert(
        rec.bankVerification && typeof rec.bankVerification.status === 'string',
        'Cada payout debe distinguir bankVerification.status de la póliza QBO'
      )
    }

    console.log(
      `   ✓ Flujo real Lynwood (#14, 2026-10-05..2026-11-01): ${jsonReconcil.orders.length} órdenes, ${jsonQb.records.length} payouts en las 3 plataformas (${Array.from(platformsInPayouts).join(', ')}) con los 3 estados independientes verificados.`
    )
    suitesPassed++
  }

  console.log('\n================================================================================')
  console.log(`🎉 TODAS LAS SUITES PASARON EXITOSAMENTE (${suitesPassed}/9)`)
  console.log('================================================================================')
}

runAllTests().catch((err) => {
  console.error('\n❌ FALLO EN LA SUITE DE PRUEBAS:', err)
  process.exit(1)
})
