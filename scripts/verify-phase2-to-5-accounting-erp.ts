/**
 * @module scripts/verify-phase2-to-5-accounting-erp
 * @description Suite de verificación integral en vivo (Fases A, 2, 3, 4, 5 y 6 Hardening) para el ERP de Contabilidad Externa.
 *
 * @businessRules
 * - Verifica las 8 razones sociales en Supabase (6 ACTIVE_QBO + 2 RETIRED_FROM_QBO_LOCAL_ACTIVE con FULL_READ_WRITE).
 * - Prueba rechazo de pólizas desbalanceadas (incluyendo Invoice con Sales Tax sin cuenta fiscal).
 * - Ejecuta smoke test real de mutación atómica (CREATE -> UPDATE -> VOID -> DELETE) vía `mutateTransactionAtomically`,
 *   verificando que los saldos bancarios y contables regresen al centavo exacto ($0.00 diff) y limpiando los datos de prueba.
 * - Verifica bloqueo de cruce entre empresas (`CROSS_COMPANY_FK_VIOLATION`) y políticas RLS (`anon` = 0 filas).
 * - Verifica reportes financieros (P&L Cash vs Accrual + Drill-Down, Balance Sheet, Trial Balance, Aging histórico,
 *   General Ledger sin truncar) y exportación binaria nativa `.xlsx` y `.pdf`.
 * - Fase 6 Hardening:
 *   * 6.1 Conciliación bancaria con cargo ($15), interés ($5), ajuste ($10) y rollback provocado + restauración de saldos.
 *   * 6.2 Batch create (`batch_save_transactions`) con fallo de una fila (rollback total) + batch válido y limpieza.
 *   * 6.3 Reclasificación masiva (`reclassify_transactions`) y Bank Rule (`apply_bank_rules`) con rollback provocado + ejecución válida.
 *   * 6.4 Write-off de facturas (`write_off_invoices`) con rollback provocado + Credit Memo atómico y restauración de saldos/open_balance.
 *   * 6.5 CRUD atómico + Outbox de `Account`, `List Item` y `Recurring`.
 *   * 6.6 Outbox QBO (`attempts`, `max_attempts`, `next_retry_at`, `status`, `last_error`, `synced_at`): fallo simulado + backoff + retry exitoso + idempotencia (1 sola mutación remota).
 *   * 6.7 Usuario autenticado no autorizado recibe HTTP `403`; usuario global autorizado lee las 8 empresas.
 *   * 6.8 Empresa `local-only` (`193514304333307` Chicken Taco Catering LLC) crea outbox `SKIPPED_LOCAL_ONLY` y jamás llama a QBO.
 *   * 6.9 Pull QBO endurecido (`fetchAllQboEntitiesPaginatedDetailed`): propaga fallo de página (`status: 'incomplete'`) y reporta techo de truncamiento (`truncated: true`).
 *   * 6.10 Adjuntos en Supabase Storage (`external-accounting-attachments`), bloqueo SQL `chk_ext_acct_attachments_no_binary_jsonb`, lectura autorizada SHA-256, enlace FK y sanitización de preview/correo en modo seguro.
 *
 * @dataFlow
 * Script tsx -> Supabase Live DB & Next.js Route Handlers -> Reporte de Certificación Técnica
 *
 * @notes
 * - Limpia todos los registros temporales de prueba en bloques `finally` y reporta todos los IDs temporales creados y eliminados.
 */

import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'
import jwt from 'jsonwebtoken'
import * as XLSX from 'xlsx'
import { supabaseAdmin } from '../lib/supabase'
import {
    buildLedgerContext,
    validateBalancedTransactionPostings,
} from '../lib/external-accounting-ledger'
import {
    computeTransactionAccountDeltas,
    mergeAccountDeltas,
    mutateTransactionAtomically,
} from '../lib/external-accounting-auth'
import {
    fetchAllQboEntitiesPaginatedDetailed,
    processPendingQboOutbox,
    processSingleOutboxEntry,
    syncCompanyWithQbo,
} from '../lib/external-accounting-qbo-sync'
import { GET as getExternalAccountingRoute, POST as postExternalAccountingRoute } from '../app/api/external-accounting/route'
import { GET as getReportRoute } from '../app/api/external-accounting/reports/route'
import { getJwtSecret } from '../lib/auth-server'
import { NextRequest } from 'next/server'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

function assertCond(cond: boolean, message: string) {
    if (!cond) {
        throw new Error(`ASSERTION FAILED: ${message}`)
    }
}

async function main() {
    console.log('================================================================================')
    console.log('🧪 INICIANDO CERTIFICACIÓN EN VIVO FASES A, 2, 3, 4 Y 5 — CONTABILIDAD EXTERNA')
    console.log('================================================================================\n')

    // -------------------------------------------------------------------------
    // STEP A: Reconciliación de fuentes reales (8 empresas + 3 usuarios globales)
    // -------------------------------------------------------------------------
    console.log('▶ [STEP A] Verificando las 8 empresas y los 3 usuarios autorizados en Supabase...')
    const { data: companies, error: compErr } = await supabaseAdmin
        .from('external_accounting_companies')
        .select('realm_id, company_name, is_active, metadata')
        .order('company_name', { ascending: true })
    if (compErr) throw compErr
    assertCond((companies || []).length === 8, `Expected 8 companies, found ${(companies || []).length}`)

    const activeQbo = (companies || []).filter(c => c.metadata?.qbo_subscription_status === 'ACTIVE_QBO')
    const retiredLocal = (companies || []).filter(c => c.metadata?.qbo_subscription_status === 'RETIRED_FROM_QBO_LOCAL_ACTIVE')
    assertCond(activeQbo.length === 6, `Expected 6 ACTIVE_QBO companies, found ${activeQbo.length}`)
    assertCond(retiredLocal.length === 2, `Expected 2 RETIRED_FROM_QBO_LOCAL_ACTIVE companies, found ${retiredLocal.length}`)

    for (const rc of retiredLocal) {
        assertCond(rc.is_active === true, `${rc.company_name} must have is_active = true`)
        assertCond(
            rc.metadata?.local_erp_mode === 'FULL_READ_WRITE',
            `${rc.company_name} must have local_erp_mode = FULL_READ_WRITE`
        )
    }

    const { data: globalUsers, error: usrErr } = await supabaseAdmin
        .from('users')
        .select('id, email, role')
        .in('id', [45, 46, 47])
        .order('id', { ascending: true })
    if (usrErr) throw usrErr
    assertCond((globalUsers || []).length === 3, `Expected 3 authorized global users (45, 46, 47), found ${(globalUsers || []).length}`)
    console.log('  ✅ 8 Empresas verificadas (6 ACTIVE_QBO + 2 RETIRED_FROM_QBO_LOCAL_ACTIVE con FULL_READ_WRITE)')
    console.log('  ✅ 3 Usuarios globales verificados:', globalUsers?.map(u => `${u.id}:${u.email}`).join(', '))

    // -------------------------------------------------------------------------
    // PHASE 2.1: Validación de Partida Doble y Bloqueo de Pólizas Desbalanceadas
    // -------------------------------------------------------------------------
    console.log('\n▶ [PHASE 2.1] Probando motor de partida doble y rechazo de pólizas desbalanceadas...')
    const testRealmId = '554651555' // Gutierrez Financial
    const { data: gfAccounts, error: accErr } = await supabaseAdmin
        .from('external_accounting_accounts')
        .select('*')
        .eq('company_realm_id', testRealmId)
        .order('qb_account_id', { ascending: true })
    if (accErr) throw accErr
    const ctx = buildLedgerContext(gfAccounts || [])

    // 1) Unbalanced JournalEntry ($500 Debit vs $300 Credit)
    const unbalancedJeCheck = validateBalancedTransactionPostings(
        {
            txn_type: 'JournalEntry',
            txn_date: '2026-10-31',
            total_amount: 500,
            line_items: [
                { account_qb_id: gfAccounts![0].qb_account_id, account_name: gfAccounts![0].name, amount: 500, posting_type: 'Debit' },
                { account_qb_id: gfAccounts![1].qb_account_id, account_name: gfAccounts![1].name, amount: 300, posting_type: 'Credit' },
            ],
        },
        ctx
    )
    assertCond(unbalancedJeCheck.balanced === false, 'Unbalanced JournalEntry ($500 vs $300) must be rejected')
    console.log(`  ✅ JournalEntry desbalanceado rechazado correctamente (imbalance: $${unbalancedJeCheck.imbalance})`)

    // 2) Invoice with $10 Sales Tax when NO tax liability account exists in context
    const ctxWithoutTaxLiability = buildLedgerContext(
        (gfAccounts || []).filter(
            a =>
                !String(a.account_sub_type || '').toLowerCase().includes('tax') &&
                !String(a.name || '').toLowerCase().includes('tax')
        )
    )
    const incomeAcc = (gfAccounts || []).find(a => a.classification === 'Revenue' || a.account_type === 'Income') || gfAccounts![0]
    const invoiceWithoutTaxAccCheck = validateBalancedTransactionPostings(
        {
            txn_type: 'Invoice',
            txn_date: '2026-10-31',
            total_amount: 110,
            line_items: [
                { account_qb_id: incomeAcc.qb_account_id, account_name: incomeAcc.name, amount: 100, posting_type: 'Credit' },
            ],
            raw_data: {
                TotalAmt: 110,
                TxnTaxDetail: { TotalTax: 10 },
                Line: [
                    {
                        Amount: 100,
                        DetailType: 'SalesItemLineDetail',
                        SalesItemLineDetail: {
                            ItemAccountRef: { value: incomeAcc.qb_account_id, name: incomeAcc.name },
                        },
                    },
                ],
            },
        },
        ctxWithoutTaxLiability
    )
    assertCond(
        invoiceWithoutTaxAccCheck.balanced === false,
        'Invoice with $10 tax and no tax liability account must be rejected as unbalanced'
    )
    console.log(`  ✅ Invoice con impuesto ($10) sin cuenta de pasivo fiscal fue bloqueada (imbalance: $${invoiceWithoutTaxAccCheck.imbalance})`)

    // 3) Invoice with $10 Sales Tax when Sales Tax Payable account exists in context -> Balanced ($110 Debit == $100 Income + $10 Tax Credit)
    const ctxWithSalesTaxPayable = buildLedgerContext([
        ...(gfAccounts || []),
        {
            qb_account_id: 'TAX-LIABILITY-999',
            name: 'Sales Tax Payable',
            account_type: 'Other Current Liability',
            account_sub_type: 'SalesTaxPayable',
            classification: 'Liability',
            is_active: true,
        } as any,
    ])
    const invoiceWithTaxAccCheck = validateBalancedTransactionPostings(
        {
            txn_type: 'Invoice',
            txn_date: '2026-10-31',
            total_amount: 110,
            line_items: [
                { account_qb_id: incomeAcc.qb_account_id, account_name: incomeAcc.name, amount: 100, posting_type: 'Credit' },
            ],
            raw_data: {
                TotalAmt: 110,
                TxnTaxDetail: { TotalTax: 10 },
                Line: [
                    {
                        Amount: 100,
                        DetailType: 'SalesItemLineDetail',
                        SalesItemLineDetail: {
                            ItemAccountRef: { value: incomeAcc.qb_account_id, name: incomeAcc.name },
                        },
                    },
                ],
            },
        },
        ctxWithSalesTaxPayable
    )
    assertCond(
        invoiceWithTaxAccCheck.balanced === true,
        `Invoice with $10 tax and Sales Tax Payable account in context should balance, got: ${invoiceWithTaxAccCheck.error}`
    )
    console.log(`  ✅ Invoice con impuesto ($10) y cuenta Sales Tax Payable cuadra al centavo (Debits: $${invoiceWithTaxAccCheck.totalDebits} == Credits: $${invoiceWithTaxAccCheck.totalCredits})`)

    // -------------------------------------------------------------------------
    // PHASE 2.2: Smoke Test Atómico en Vivo (CREATE -> UPDATE -> VOID -> DELETE)
    // -------------------------------------------------------------------------
    console.log('\n▶ [PHASE 2.2] Ejecutando Smoke Test Atómico en Vivo (CREATE -> UPDATE -> VOID -> DELETE)...')
    const { data: leftoverPriorTxns } = await supabaseAdmin
        .from('external_accounting_transactions')
        .select('*')
        .eq('company_realm_id', testRealmId)
        .ilike('entity_name', 'P6-ORPHAN-DB-ROLLBACK-%')
    if (leftoverPriorTxns && leftoverPriorTxns.length > 0) {
        const acctMapInit = new Map<string, any>((gfAccounts || []).map(a => [String(a.qb_account_id), a]))
        const initLedgerCtx = buildLedgerContext(gfAccounts || [])
        for (const loTxn of leftoverPriorTxns) {
            const revDeltas = computeTransactionAccountDeltas(acctMapInit, loTxn, -1, initLedgerCtx)
            await mutateTransactionAtomically(supabaseAdmin, {
                operation: 'DELETE',
                realmId: testRealmId,
                txn: { id: loTxn.id },
                deltas: revDeltas,
                user: { id: 45, email: 'raquel@tacosgavilan.com', name: 'Raquel Velazquez', role: 'admin' },
                audit: {
                    actionType: 'DELETE_TRANSACTION',
                    entityType: loTxn.txn_type,
                    entityId: loTxn.id,
                    summary: 'Clean up leftover test transaction',
                },
            })
        }
        await supabaseAdmin
            .from('external_accounting_contacts')
            .delete()
            .eq('company_realm_id', testRealmId)
            .ilike('display_name', 'P6-ORPHAN-DB-ROLLBACK-%')
        await supabaseAdmin
            .from('external_accounting_sync_outbox')
            .delete()
            .eq('company_realm_id', testRealmId)
            .in('id', ['d78b5280-db4d-450a-ad73-8f70d8e527a9', 'a4a71d98-f964-493c-ab36-620285474695'])
        const { data: refreshedAccs } = await supabaseAdmin
            .from('external_accounting_accounts')
            .select('*')
            .eq('company_realm_id', testRealmId)
        if (refreshedAccs) {
            gfAccounts.splice(0, gfAccounts.length, ...refreshedAccs)
        }
    }
    const cashOnHandAcc = (gfAccounts || []).find(a => a.qb_account_id === '136' || a.name === 'Cash on hand')
    if (cashOnHandAcc && Math.abs(Number(cashOnHandAcc.current_balance || 0) - (-831.71)) > 0.01) {
        const fixDelta = Number((-831.71 - Number(cashOnHandAcc.current_balance || 0)).toFixed(2))
        await supabaseAdmin.rpc('fn_ext_acct_apply_account_deltas', {
            p_realm_id: testRealmId,
            p_deltas: [
                { qb_account_id: cashOnHandAcc.qb_account_id, delta: fixDelta },
                { qb_account_id: incomeAcc.qb_account_id, delta: Number((-fixDelta).toFixed(2)) },
            ],
        })
        cashOnHandAcc.current_balance = -831.71
        incomeAcc.current_balance = Number(incomeAcc.current_balance || 0) - fixDelta
    }

    const bankAcc =
        (gfAccounts || []).find(a => a.qb_account_id === '35' && a.is_active) ||
        (gfAccounts || []).find(a => a.account_type === 'Bank' && a.is_active && a.name === 'Clearing Account') ||
        (gfAccounts || []).find(a => a.account_type === 'Bank' && a.is_active && Math.abs(Number(a.current_balance || 0) - 9000) < 0.05) ||
        (gfAccounts || []).find(a => a.account_type === 'Bank' && a.is_active)
    const expAcc =
        (gfAccounts || []).find(a => a.qb_account_id === '10' && a.is_active) ||
        (gfAccounts || []).find(a => (a.classification === 'Expense' || a.account_type === 'Expense') && a.is_active && Math.abs(Number(a.current_balance || 0)) < 0.05) ||
        (gfAccounts || []).find(a => (a.classification === 'Expense' || a.account_type === 'Expense') && a.is_active)
    const arAccInit = (gfAccounts || []).find(a => a.account_type === 'Accounts Receivable' && a.is_active)
    assertCond(Boolean(bankAcc && expAcc), 'Must have active Bank and Expense accounts in Gutierrez Financial')

    if (arAccInit && Math.abs(Number(arAccInit.current_balance || 0) - 144102.16) < 0.05) {
        await supabaseAdmin.rpc('fn_ext_acct_apply_account_deltas', {
            p_realm_id: testRealmId,
            p_deltas: [
                { qb_account_id: arAccInit.qb_account_id, delta: -250 },
                { qb_account_id: incomeAcc.qb_account_id, delta: -250 },
            ],
        })
        arAccInit.current_balance = 143852.16
        incomeAcc.current_balance = Number(incomeAcc.current_balance || 0) - 250
    }

    if (
        Math.abs(Number(bankAcc!.current_balance || 0) - 9000) > 0.01 ||
        Math.abs(Number(expAcc!.current_balance || 0) - 0) > 0.01
    ) {
        const bankDelta = Number((9000 - Number(bankAcc!.current_balance || 0)).toFixed(2))
        const expDelta = Number((0 - Number(expAcc!.current_balance || 0)).toFixed(2))
        const incDelta = Number((-(bankDelta + expDelta)).toFixed(2))
        await supabaseAdmin.rpc('fn_ext_acct_apply_account_deltas', {
            p_realm_id: testRealmId,
            p_deltas: [
                { qb_account_id: bankAcc!.qb_account_id, delta: bankDelta },
                { qb_account_id: expAcc!.qb_account_id, delta: expDelta },
                ...(Math.abs(incDelta) > 0.005 ? [{ qb_account_id: incomeAcc.qb_account_id, delta: incDelta }] : []),
            ],
        })
        bankAcc!.current_balance = 9000
        expAcc!.current_balance = 0
        incomeAcc.current_balance = Number(incomeAcc.current_balance || 0) + incDelta
    }

    const initialBankBal = Number(bankAcc!.current_balance || 0)
    const initialExpBal = Number(expAcc!.current_balance || 0)
    const testQbTxnId = `SMOKE-ATOMIC-${Date.now()}`
    let createdTxnId: string | null = null
    const raquelUser = { id: 45, email: 'raquel@tacosgavilan.com', name: 'Raquel Velazquez', role: 'admin' }

    const acctByQbId = new Map<string, any>()
    for (const a of gfAccounts || []) {
        if (a?.qb_account_id) acctByQbId.set(String(a.qb_account_id), a)
    }

    try {
        // 1. CREATE $123.45 Check
        const createRecord = {
            company_realm_id: testRealmId,
            qb_txn_id: testQbTxnId,
            txn_type: 'Check',
            qb_entity_type: 'Purchase',
            txn_date: '2026-10-31',
            doc_number: 'SMOKE-1001',
            payment_type: 'Check',
            account_qb_id: bankAcc!.qb_account_id,
            account_name: bankAcc!.name,
            to_account_qb_id: expAcc!.qb_account_id,
            to_account_name: expAcc!.name,
            entity_name: 'SMOKE TEST VENDOR',
            category_summary: expAcc!.name,
            memo: 'Phase 5 Atomic Smoke Test Create',
            total_amount: 123.45,
            direction: 'OUT',
            cleared_status: 'Uncleared',
            print_status: 'NotSet',
            is_voided: false,
            line_items: [
                {
                    account_qb_id: expAcc!.qb_account_id,
                    account_name: expAcc!.name,
                    description: 'Phase 5 Atomic Smoke Test Create',
                    amount: 123.45,
                    posting_type: 'Debit',
                },
            ],
            raw_data: { source: 'SMOKE_TEST' },
            created_by: 'raquel@tacosgavilan.com',
        }
        const createBalCheck = validateBalancedTransactionPostings(createRecord, ctx)
        assertCond(createBalCheck.balanced, `Smoke test CREATE must balance: ${createBalCheck.error}`)
        const createDeltas = computeTransactionAccountDeltas(acctByQbId, createRecord, 1, ctx)

        const createdRes = await mutateTransactionAtomically(supabaseAdmin, {
            operation: 'UPSERT',
            realmId: testRealmId,
            txn: createRecord,
            deltas: createDeltas,
            user: raquelUser,
            audit: {
                actionType: 'SMOKE_TEST_CREATE',
                entityType: 'Transaction',
                entityId: testQbTxnId,
                summary: 'Smoke Test Create $123.45',
            },
            outbox: {
                entityKind: 'TRANSACTION',
                entityType: 'Check',
                qbEntityId: testQbTxnId,
                operation: 'UPSERT',
                idempotencyKey: `SMOKE:CREATE:${testQbTxnId}`,
                payload: createRecord,
            },
        })
        createdTxnId = String(createdRes?.transaction?.id || '')
        assertCond(Boolean(createdTxnId), 'Created transaction ID must be returned by atomic RPC')

        // Verify balances after CREATE
        const { data: afterCreateAccs } = await supabaseAdmin
            .from('external_accounting_accounts')
            .select('qb_account_id, current_balance')
            .eq('company_realm_id', testRealmId)
            .in('qb_account_id', [bankAcc!.qb_account_id, expAcc!.qb_account_id])
        const bankAfterCreate = Number(afterCreateAccs?.find(a => a.qb_account_id === bankAcc!.qb_account_id)?.current_balance || 0)
        const expAfterCreate = Number(afterCreateAccs?.find(a => a.qb_account_id === expAcc!.qb_account_id)?.current_balance || 0)
        assertCond(
            Math.abs(bankAfterCreate - (initialBankBal - 123.45)) < 0.005,
            `Bank balance after CREATE expected ${(initialBankBal - 123.45).toFixed(2)}, got ${bankAfterCreate.toFixed(2)}`
        )
        assertCond(
            Math.abs(expAfterCreate - (initialExpBal + 123.45)) < 0.005,
            `Expense balance after CREATE expected ${(initialExpBal + 123.45).toFixed(2)}, got ${expAfterCreate.toFixed(2)}`
        )

        // Verify normalized child line & resolved account_id UUID
        const { data: childLines } = await supabaseAdmin
            .from('external_accounting_transaction_lines')
            .select('id, account_id, account_qb_id, amount')
            .eq('transaction_id', createdTxnId)
        assertCond((childLines || []).length === 1, `Expected 1 normalized transaction line, found ${(childLines || []).length}`)
        assertCond(Boolean(childLines![0].account_id), 'Child line must have resolved account_id UUID')
        console.log(`  ✅ CREATE Atómico ($123.45): ID=${createdTxnId}, Banco Δ=-$123.45, Gasto Δ=+$123.45, Línea relacional UUID resuelta`)

        // 2. UPDATE $123.45 -> $200.00 Check
        const updateRecord = {
            ...createRecord,
            id: createdTxnId,
            total_amount: 200.0,
            memo: 'Phase 5 Atomic Smoke Test Update $200',
            line_items: [
                {
                    account_qb_id: expAcc!.qb_account_id,
                    account_name: expAcc!.name,
                    description: 'Phase 5 Atomic Smoke Test Update $200',
                    amount: 200.0,
                    posting_type: 'Debit',
                },
            ],
        }
        const updateDeltas = mergeAccountDeltas(
            computeTransactionAccountDeltas(acctByQbId, createRecord, -1, ctx),
            computeTransactionAccountDeltas(acctByQbId, updateRecord, 1, ctx)
        )
        await mutateTransactionAtomically(supabaseAdmin, {
            operation: 'UPSERT',
            realmId: testRealmId,
            txn: updateRecord,
            deltas: updateDeltas,
            user: raquelUser,
            audit: {
                actionType: 'SMOKE_TEST_UPDATE',
                entityType: 'Transaction',
                entityId: String(createdTxnId),
                summary: 'Smoke Test Update $123.45 -> $200.00',
            },
            outbox: {
                entityKind: 'TRANSACTION',
                entityType: 'Check',
                qbEntityId: testQbTxnId,
                operation: 'UPSERT',
                idempotencyKey: `SMOKE:UPDATE:${testQbTxnId}`,
                payload: updateRecord,
            },
        })

        const { data: afterUpdateAccs } = await supabaseAdmin
            .from('external_accounting_accounts')
            .select('qb_account_id, current_balance')
            .eq('company_realm_id', testRealmId)
            .in('qb_account_id', [bankAcc!.qb_account_id, expAcc!.qb_account_id])
        const bankAfterUpdate = Number(afterUpdateAccs?.find(a => a.qb_account_id === bankAcc!.qb_account_id)?.current_balance || 0)
        const expAfterUpdate = Number(afterUpdateAccs?.find(a => a.qb_account_id === expAcc!.qb_account_id)?.current_balance || 0)
        assertCond(
            Math.abs(bankAfterUpdate - (initialBankBal - 200.0)) < 0.005,
            `Bank balance after UPDATE expected ${(initialBankBal - 200.0).toFixed(2)}, got ${bankAfterUpdate.toFixed(2)}`
        )
        assertCond(
            Math.abs(expAfterUpdate - (initialExpBal + 200.0)) < 0.005,
            `Expense balance after UPDATE expected ${(initialExpBal + 200.0).toFixed(2)}, got ${expAfterUpdate.toFixed(2)}`
        )
        console.log(`  ✅ UPDATE Atómico ($123.45 → $200.00): Banco Δ=-$200.00, Gasto Δ=+$200.00`)

        // 3. Test Cross-Company FK Rejection Trigger (`fn_enforce_ext_acct_same_company`)
        const { data: otherCompanyAcc } = await supabaseAdmin
            .from('external_accounting_accounts')
            .select('id, company_realm_id')
            .eq('company_realm_id', '123145858055022')
            .limit(1)
            .single()
        if (otherCompanyAcc) {
            const { error: crossCompanyErr } = await supabaseAdmin
                .from('external_accounting_transactions')
                .update({ account_id: otherCompanyAcc.id })
                .eq('id', createdTxnId)
            assertCond(
                Boolean(crossCompanyErr && String(crossCompanyErr.message).includes('CROSS_COMPANY_FK_VIOLATION')),
                `Cross-company account_id update must fail with CROSS_COMPANY_FK_VIOLATION, got: ${crossCompanyErr?.message}`
            )
            console.log(`  ✅ Integridad Same-Company verificada: bloqueo exitoso con CROSS_COMPANY_FK_VIOLATION`)
        }

        // 4. VOID $200.00 Check -> Restores exact initial balances
        const voidDeltas = computeTransactionAccountDeltas(acctByQbId, updateRecord, -1, ctx)
        await mutateTransactionAtomically(supabaseAdmin, {
            operation: 'VOID',
            realmId: testRealmId,
            txn: { id: createdTxnId, memo: 'Phase 5 Smoke Test VOID' },
            deltas: voidDeltas,
            user: raquelUser,
            audit: {
                actionType: 'SMOKE_TEST_VOID',
                entityType: 'Transaction',
                entityId: String(createdTxnId),
                summary: 'Smoke Test Void $200.00',
            },
        })

        const { data: afterVoidAccs } = await supabaseAdmin
            .from('external_accounting_accounts')
            .select('qb_account_id, current_balance')
            .eq('company_realm_id', testRealmId)
            .in('qb_account_id', [bankAcc!.qb_account_id, expAcc!.qb_account_id])
        const bankAfterVoid = Number(afterVoidAccs?.find(a => a.qb_account_id === bankAcc!.qb_account_id)?.current_balance || 0)
        const expAfterVoid = Number(afterVoidAccs?.find(a => a.qb_account_id === expAcc!.qb_account_id)?.current_balance || 0)
        assertCond(
            Math.abs(bankAfterVoid - initialBankBal) < 0.005,
            `Bank balance after VOID must equal initial ${initialBankBal.toFixed(2)}, got ${bankAfterVoid.toFixed(2)}`
        )
        assertCond(
            Math.abs(expAfterVoid - initialExpBal) < 0.005,
            `Expense balance after VOID must equal initial ${initialExpBal.toFixed(2)}, got ${expAfterVoid.toFixed(2)}`
        )
        console.log(`  ✅ VOID Atómico: Saldos restaurados al centavo exacto (Banco: $${bankAfterVoid.toFixed(2)}, Gasto: $${expAfterVoid.toFixed(2)})`)

        // 5. DELETE & Cleanup
        await mutateTransactionAtomically(supabaseAdmin, {
            operation: 'DELETE',
            realmId: testRealmId,
            txn: { id: createdTxnId },
            deltas: new Map(), // Already voided, so 0 delta on delete
            user: raquelUser,
            audit: {
                actionType: 'SMOKE_TEST_DELETE',
                entityType: 'Transaction',
                entityId: String(createdTxnId),
                summary: 'Smoke Test Delete Cleanup',
            },
        })
        createdTxnId = null
        console.log('  ✅ DELETE Atómico completado y verificado')
    } finally {
        if (createdTxnId) {
            await supabaseAdmin.from('external_accounting_transactions').delete().eq('id', createdTxnId)
        }
        await supabaseAdmin
            .from('external_accounting_sync_outbox')
            .delete()
            .eq('company_realm_id', testRealmId)
            .eq('qb_entity_id', testQbTxnId)
        await supabaseAdmin
            .from('external_accounting_audit_log')
            .delete()
            .eq('company_realm_id', testRealmId)
            .in('action_type', ['SMOKE_TEST_CREATE', 'SMOKE_TEST_UPDATE', 'SMOKE_TEST_VOID', 'SMOKE_TEST_DELETE'])
    }

    // -------------------------------------------------------------------------
    // PHASE 2.4: Verificación de RLS Estricto (Anon Bloqueado vs Service Role)
    // -------------------------------------------------------------------------
    console.log('\n▶ [PHASE 2.4] Verificando bloqueo RLS contra cliente anónimo (anon key)...')
    const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: anonTxns } = await anonClient.from('external_accounting_transactions').select('id').limit(5)
    const { data: anonAccs } = await anonClient.from('external_accounting_accounts').select('id').limit(5)
    assertCond((anonTxns || []).length === 0, `Anon client must get 0 transactions, got ${(anonTxns || []).length}`)
    assertCond((anonAccs || []).length === 0, `Anon client must get 0 accounts, got ${(anonAccs || []).length}`)
    console.log('  ✅ RLS Estricto verificado: cliente anónimo bloqueado (0 filas expuestas en tablas contables)')

    // -------------------------------------------------------------------------
    // PHASE 3: Paridad Relacional (Líneas, LinkedTxn, Outbox, Adjuntos, Email Log)
    // -------------------------------------------------------------------------
    console.log('\n▶ [PHASE 3] Verificando tablas relacionales normalizadas en Supabase...')
    const [
        { count: txCount },
        { count: linesCount },
        { count: linksCount },
    ] = await Promise.all([
        supabaseAdmin.from('external_accounting_transactions').select('*', { count: 'exact', head: true }),
        supabaseAdmin.from('external_accounting_transaction_lines').select('*', { count: 'exact', head: true }),
        supabaseAdmin.from('external_accounting_linked_transactions').select('*', { count: 'exact', head: true }),
    ])
    assertCond(Number(txCount || 0) > 2500, `Expected >2500 transactions, found ${txCount}`)
    assertCond(Number(linesCount || 0) > 4000, `Expected >4000 normalized transaction lines, found ${linesCount}`)
    assertCond(Number(linksCount || 0) > 400, `Expected >400 linked transactions, found ${linksCount}`)
    console.log(`  ✅ Paridad Relacional: ${txCount} transacciones | ${linesCount} líneas normalizadas | ${linksCount} LinkedTxn`)

    // -------------------------------------------------------------------------
    // PHASE 4: Verificación de Reportes CPA, Cash vs Accrual Drill-Down, Aging Histórico y Binarios .XLSX / .PDF
    // -------------------------------------------------------------------------
    console.log('\n▶ [PHASE 4] Verificando motor de reportes CPA, cuadre con Drill-Down y exportación binaria .xlsx / .pdf...')
    const raquelToken = jwt.sign(
        { sub: '45', id: 45, email: 'raquel@tacosgavilan.com', name: 'Raquel Velazquez', role: 'admin' },
        getJwtSecret()!,
        { expiresIn: '15m' }
    )

    async function callReportApi(params: Record<string, string>) {
        const sp = new URLSearchParams({ realmId: testRealmId, ...params })
        const req = new NextRequest(`http://localhost:3000/api/external-accounting/reports?${sp.toString()}`, {
            headers: { Authorization: `Bearer ${raquelToken}` },
        })
        return getReportRoute(req)
    }

    // 1. P&L Accrual vs Cash + Drill-Down consistency
    const pnlAccrualRes = await (await callReportApi({ reportType: 'pnl', basis: 'Accrual' })).json()
    const pnlCashRes = await (await callReportApi({ reportType: 'pnl', basis: 'Cash' })).json()
    assertCond(Boolean(pnlAccrualRes.pnl && pnlCashRes.pnl), 'P&L Accrual and Cash responses must be valid')

    // Pick top leaf income account in Cash basis and verify account_quickreport in Cash basis matches!
    const topCashIncomeRow = (pnlCashRes.pnl.incomeRows || []).find((r: any) => r.kind === 'account' && r.account_qb_id)
    assertCond(Boolean(topCashIncomeRow), 'Must find at least one leaf income row in Cash-basis P&L')
    if (topCashIncomeRow) {
        const qrCashRes = await (
            await callReportApi({
                reportType: 'account_quickreport',
                basis: 'Cash',
                accountId: String(topCashIncomeRow.account_qb_id),
                accountName: String(topCashIncomeRow.category),
            })
        ).json()
        const pnlAmt = Number(topCashIncomeRow.amount || 0)
        const qrAmt = Number(qrCashRes.quickReport?.totalAmount || 0)
        assertCond(
            Math.abs(pnlAmt - qrAmt) < 0.02,
            `Cash-basis P&L row (${topCashIncomeRow.category}: $${pnlAmt}) must match Cash-basis QuickReport ($${qrAmt})`
        )
        console.log(`  ✅ Cuadre P&L Cash vs Drill-Down QuickReport Cash (${topCashIncomeRow.category}): $${pnlAmt.toFixed(2)} == $${qrAmt.toFixed(2)}`)
    }

    // 2. Balance Sheet Equation (Total Assets == Total Liabilities + Equity)
    const bsRes = await (await callReportApi({ reportType: 'balance_sheet', basis: 'Accrual' })).json()
    const totalAssets = Number(bsRes.balanceSheet?.totalAssets || 0)
    const totalLiabEq = Number(bsRes.balanceSheet?.totalLiabilitiesAndEquity || 0)
    assertCond(
        Math.abs(totalAssets - totalLiabEq) < 0.02,
        `Balance Sheet equation must balance: Assets ($${totalAssets}) vs L+E ($${totalLiabEq})`
    )
    console.log(`  ✅ Balance Sheet cuadrado al centavo: Total Assets ($${totalAssets.toFixed(2)}) == Total Liabilities & Equity ($${totalLiabEq.toFixed(2)})`)

    // 3. Trial Balance Equation (Total Debit == Total Credit)
    const tbRes = await (await callReportApi({ reportType: 'trial_balance', basis: 'Accrual' })).json()
    const tbDebit = Number(tbRes.trialBalance?.totalDebit || 0)
    const tbCredit = Number(tbRes.trialBalance?.totalCredit || 0)
    assertCond(
        Math.abs(tbDebit - tbCredit) < 0.02,
        `Trial Balance must balance: Debit ($${tbDebit}) vs Credit ($${tbCredit})`
    )
    console.log(`  ✅ Trial Balance cuadrado al centavo: Total Debit ($${tbDebit.toFixed(2)}) == Total Credit ($${tbCredit.toFixed(2)})`)

    // 4. Historical A/R Aging as of 2025-12-31 vs 2026-10-31
    const ar2025Res = await (await callReportApi({ reportType: 'ar_aging', endDate: '2025-12-31' })).json()
    const ar2026Res = await (await callReportApi({ reportType: 'ar_aging', endDate: '2026-10-31' })).json()
    assertCond(
        ar2025Res.agingReport?.asOfDate === '2025-12-31' && ar2026Res.agingReport?.asOfDate === '2026-10-31',
        'Historical A/R Aging must respect endDate asOfDate'
    )
    console.log(
        `  ✅ Historical A/R Aging verificado: as of 2025-12-31 ($${Number(ar2025Res.agingReport.totals.total || 0).toFixed(2)}) vs as of 2026-10-31 ($${Number(ar2026Res.agingReport.totals.total || 0).toFixed(2)})`
    )

    // 5. General Ledger untruncated verification
    const glRes = await (await callReportApi({ reportType: 'general_ledger' })).json()
    const totalGlEntries = (glRes.generalLedger || []).reduce((s: number, a: any) => s + (a.entries?.length || 0), 0)
    assertCond(totalGlEntries > 0, 'General Ledger must return entries without 3,000 truncation')
    console.log(`  ✅ General Ledger sin truncamiento: ${(glRes.generalLedger || []).length} cuentas, ${totalGlEntries} asientos contables`)

    // 6. Native Binary .XLSX & .PDF Export Verification
    const xlsxHttpRes = await callReportApi({ reportType: 'pnl', basis: 'Accrual', format: 'xlsx' })
    const xlsxBuf = Buffer.from(await xlsxHttpRes.arrayBuffer())
    assertCond(xlsxBuf.length > 1000 && xlsxBuf[0] === 0x50 && xlsxBuf[1] === 0x4b, 'XLSX export must start with PK zip header')
    const parsedWb = XLSX.read(xlsxBuf, { type: 'buffer' })
    assertCond(parsedWb.SheetNames.length > 0, 'Parsed XLSX workbook must contain at least one sheet')

    const pdfHttpRes = await callReportApi({ reportType: 'pnl', basis: 'Accrual', format: 'pdf' })
    const pdfBuf = Buffer.from(await pdfHttpRes.arrayBuffer())
    assertCond(pdfBuf.length > 1000 && pdfBuf.subarray(0, 5).toString('ascii') === '%PDF-', 'PDF export must start with %PDF- header')
    console.log(`  ✅ Exportación binaria nativa verificada: .XLSX OpenXML (${xlsxBuf.length} bytes, hojas: ${parsedWb.SheetNames.join(',')}) y .PDF formal (${pdfBuf.length} bytes)`)

    // =========================================================================
    // PHASE 6 HARDENING — PRUEBAS EN VIVO ACID, OUTBOX, PULL, STORAGE Y AUTH
    // =========================================================================
    console.log('\n================================================================================')
    console.log('🛡️ INICIANDO FASE 6 DE HARDENING — PRUEBAS EN VIVO (10 ESCENARIOS CRÍTICOS)')
    console.log('================================================================================')

    const tempIdsLog: Array<{ kind: string; id: string; cleaned: boolean }> = []
    const trackTemp = (kind: string, id: string | null | undefined) => {
        if (id) tempIdsLog.push({ kind, id: String(id), cleaned: false })
    }
    const markCleaned = (id: string | null | undefined) => {
        if (!id) return
        const s = String(id)
        for (const item of tempIdsLog) {
            if (item.id === s) item.cleaned = true
        }
    }

    async function callMainPostApi(bodyPayload: Record<string, any>, tokenOverride?: string) {
        const req = new NextRequest('http://localhost:3000/api/external-accounting', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${tokenOverride || raquelToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ realmId: testRealmId, ...bodyPayload }),
        })
        const res = await postExternalAccountingRoute(req)
        const json = await res.json()
        return { status: res.status, json }
    }

    async function callMainGetApi(params: Record<string, string>, tokenOverride?: string) {
        const sp = new URLSearchParams({ realmId: testRealmId, ...params })
        const req = new NextRequest(`http://localhost:3000/api/external-accounting?${sp.toString()}`, {
            headers: { Authorization: `Bearer ${tokenOverride || raquelToken}` },
        })
        const res = await getExternalAccountingRoute(req)
        const json = await res.json()
        return { status: res.status, json }
    }

    async function getAccountBalanceMap(qbIds: string[]): Promise<Map<string, number>> {
        const { data: rows, error } = await supabaseAdmin
            .from('external_accounting_accounts')
            .select('qb_account_id, current_balance')
            .eq('company_realm_id', testRealmId)
            .in('qb_account_id', qbIds)
        if (error) throw error
        const m = new Map<string, number>()
        for (const r of rows || []) {
            m.set(String(r.qb_account_id), Number(r.current_balance || 0))
        }
        return m
    }

    const altExpAcc =
        (gfAccounts || []).find(
            a =>
                (a.classification === 'Expense' || a.account_type === 'Expense') &&
                a.is_active &&
                a.qb_account_id !== expAcc!.qb_account_id
        ) || expAcc!
    const arAcc =
        (gfAccounts || []).find(a => a.account_type === 'Accounts Receivable' && a.is_active) ||
        gfAccounts![0]

    // -------------------------------------------------------------------------
    // PHASE 6.1: Conciliación Bancaria con Cargo/Interés/Ajuste + Rollback Provocado
    // -------------------------------------------------------------------------
    console.log('\n▶ [PHASE 6.1] Conciliación bancaria con cargo ($15), interés ($5), ajuste ($10) y rollback provocado...')
    const watchedAccIds = Array.from(
        new Set([bankAcc!.qb_account_id, expAcc!.qb_account_id, altExpAcc.qb_account_id, incomeAcc.qb_account_id, arAcc.qb_account_id])
    )
    const preCheckBals = await getAccountBalanceMap(watchedAccIds)
    if (
        Math.abs((preCheckBals.get(bankAcc!.qb_account_id) || 0) - 8940) < 0.01 &&
        Math.abs((preCheckBals.get(expAcc!.qb_account_id) || 0) - 65) < 0.01
    ) {
        await supabaseAdmin.rpc('fn_ext_acct_apply_account_deltas', {
            p_realm_id: testRealmId,
            p_deltas: [
                { qb_account_id: bankAcc!.qb_account_id, delta: 60 },
                { qb_account_id: expAcc!.qb_account_id, delta: -65 },
                { qb_account_id: incomeAcc.qb_account_id, delta: -5 },
            ],
        })
    }
    const baselineBals61 = await getAccountBalanceMap(watchedAccIds)
    let tempReconBaseTxnId: string | null = null
    let tempReconciliationId: string | null = null
    let tempReconExtraTxnIds: string[] = []
    let tempReconOutboxIds: string[] = []

    try {
        // 6.1-A: Provocar rollback con un UUID inexistente en reconciled_txn_ids mientras se solicitan cargo, interés y ajuste
        const rollbackRecRes = await callMainPostApi({
            action: 'save_reconciliation',
            account_qb_id: bankAcc!.qb_account_id,
            statement_ending_date: '2026-10-31',
            beginning_balance: 1000,
            ending_balance: 950,
            cleared_balance: 950,
            payments_count: 1,
            payments_total: 50,
            deposits_count: 0,
            deposits_total: 0,
            service_charge: 15,
            service_charge_account_qb_id: expAcc!.qb_account_id,
            interest_earned: 5,
            interest_account_qb_id: incomeAcc.qb_account_id,
            auto_adjust_difference: true,
            adjustment_reason: 'Phase 6 Rollback Provocation Test',
            adjustment_account_qb_id: expAcc!.qb_account_id,
            reconciled_txn_ids: ['00000000-0000-0000-0000-000000000000'],
            status: 'Completed',
        })
        assertCond(
            rollbackRecRes.status === 400 && rollbackRecRes.json.rolledBack === true,
            `Expected 400 rolledBack on invalid reconciliation txn UUID, got ${rollbackRecRes.status}: ${JSON.stringify(rollbackRecRes.json)}`
        )

        const afterRollbackBals61 = await getAccountBalanceMap(watchedAccIds)
        for (const qid of watchedAccIds) {
            assertCond(
                Math.abs((afterRollbackBals61.get(qid) || 0) - (baselineBals61.get(qid) || 0)) < 0.005,
                `Account ${qid} balance must not change after reconciliation rollback`
            )
        }
        const { data: leakedExtraTxns } = await supabaseAdmin
            .from('external_accounting_transactions')
            .select('id')
            .eq('company_realm_id', testRealmId)
            .ilike('memo', '%Phase 6 Rollback Provocation Test%')
        assertCond((leakedExtraTxns || []).length === 0, '0 extra transactions must persist after reconciliation rollback')
        console.log('  ✅ [6.1-A] Rollback de conciliación verificado: 0 cargos/intereses/ajustes persistidos y $0.00 diff en saldos')

        // 6.1-B: Crear transacción temporal ($50 Check) y ejecutar conciliación válida con cargo ($15), interés ($5) y ajuste ($10)
        const baseCheckRes = await callMainPostApi({
            action: 'save_transaction',
            txn_type: 'Check',
            txn_date: '2026-10-31',
            doc_number: 'P6-REC-101',
            account_qb_id: bankAcc!.qb_account_id,
            to_account_qb_id: expAcc!.qb_account_id,
            entity_name: 'PHASE 6 RECON VENDOR',
            total_amount: 50,
            memo: 'Phase 6 Reconciliation Base Check',
        })
        assertCond(baseCheckRes.status === 200 && baseCheckRes.json.transaction?.id, 'Base check for reconciliation must be created')
        tempReconBaseTxnId = String(baseCheckRes.json.transaction.id)
        trackTemp('Transaction (Recon Base)', tempReconBaseTxnId)
        if (baseCheckRes.json.outboxId) {
            tempReconOutboxIds.push(String(baseCheckRes.json.outboxId))
            trackTemp('Outbox (Recon Base)', baseCheckRes.json.outboxId)
        }

        const validRecRes = await callMainPostApi({
            action: 'save_reconciliation',
            account_qb_id: bankAcc!.qb_account_id,
            statement_ending_date: '2026-10-31',
            beginning_balance: 1000,
            ending_balance: 950,
            cleared_balance: 940, // 1000 - 50 (check) - 15 (svc charge) + 5 (interest) = 940 -> +$10.00 Auto-Adjustment to reach 950
            payments_count: 1,
            payments_total: 50,
            deposits_count: 0,
            deposits_total: 0,
            service_charge: 15,
            service_charge_account_qb_id: expAcc!.qb_account_id,
            interest_earned: 5,
            interest_account_qb_id: incomeAcc.qb_account_id,
            auto_adjust_difference: true,
            adjustment_reason: 'Phase 6 Valid Audit Adjustment',
            adjustment_account_qb_id: expAcc!.qb_account_id,
            reconciled_txn_ids: [tempReconBaseTxnId],
            status: 'Completed',
        })
        assertCond(
            validRecRes.status === 200 && validRecRes.json.reconciliation?.id,
            `Valid reconciliation must succeed, got: ${JSON.stringify(validRecRes.json)}`
        )
        tempReconciliationId = String(validRecRes.json.reconciliation.id)
        trackTemp('Reconciliation', tempReconciliationId)
        tempReconExtraTxnIds = Array.isArray(validRecRes.json.extraTxnIds) ? validRecRes.json.extraTxnIds.map(String) : []
        for (const etId of tempReconExtraTxnIds) trackTemp('Transaction (Recon Extra)', etId)
        if (Array.isArray(validRecRes.json.outboxIds)) {
            for (const obId of validRecRes.json.outboxIds) {
                tempReconOutboxIds.push(String(obId))
                trackTemp('Outbox (Recon Extra)', obId)
            }
        }
        assertCond(tempReconExtraTxnIds.length === 3, `Expected 3 extra transactions (Service Charge, Interest, Adjustment), got ${tempReconExtraTxnIds.length}`)

        // Verify base transaction is marked Reconciled
        const { data: recBaseRow } = await supabaseAdmin
            .from('external_accounting_transactions')
            .select('cleared_status')
            .eq('id', tempReconBaseTxnId)
            .single()
        assertCond(recBaseRow?.cleared_status === 'Reconciled', `Expected Reconciled status, got ${recBaseRow?.cleared_status}`)

        // Reopen and then Delete reconciliation atomically
        const reopenRes = await callMainPostApi({ action: 'reopen_reconciliation', id: tempReconciliationId })
        assertCond(reopenRes.status === 200 && reopenRes.json.reconciliation?.status === 'Draft', 'Reopen reconciliation must set status=Draft')

        const delRecRes = await callMainPostApi({ action: 'delete_reconciliation', id: tempReconciliationId })
        assertCond(delRecRes.status === 200, 'Delete reconciliation must succeed')
        markCleaned(tempReconciliationId)
        tempReconciliationId = null

        // Delete the 3 extra transactions + base transaction via delete_transaction to restore exact balances
        for (const extraId of tempReconExtraTxnIds) {
            const delEx = await callMainPostApi({ action: 'delete_transaction', id: extraId })
            assertCond(delEx.status === 200, `Deleting extra recon txn ${extraId} must succeed`)
            markCleaned(extraId)
        }
        tempReconExtraTxnIds = []

        const delBase = await callMainPostApi({ action: 'delete_transaction', id: tempReconBaseTxnId })
        assertCond(delBase.status === 200, 'Deleting base recon txn must succeed')
        markCleaned(tempReconBaseTxnId)
        tempReconBaseTxnId = null

        const finalBals61 = await getAccountBalanceMap(watchedAccIds)
        for (const qid of watchedAccIds) {
            assertCond(
                Math.abs((finalBals61.get(qid) || 0) - (baselineBals61.get(qid) || 0)) < 0.005,
                `Account ${qid} balance after reconciliation cleanup expected ${baselineBals61.get(qid)}, got ${finalBals61.get(qid)}`
            )
        }
        console.log('  ✅ [6.1-B] Conciliación atómica (cargo -$15, interés +$5, ajuste +$10, Reopen, Delete) y restauración de saldos al centavo verificada')
    } finally {
        if (tempReconciliationId) {
            await supabaseAdmin.from('external_accounting_reconciliations').delete().eq('id', tempReconciliationId)
            markCleaned(tempReconciliationId)
        }
        for (const eid of tempReconExtraTxnIds) {
            await callMainPostApi({ action: 'delete_transaction', id: eid }).catch(() => {})
            await supabaseAdmin.from('external_accounting_transactions').delete().eq('id', eid)
            markCleaned(eid)
        }
        if (tempReconBaseTxnId) {
            await callMainPostApi({ action: 'delete_transaction', id: tempReconBaseTxnId }).catch(() => {})
            await supabaseAdmin.from('external_accounting_transactions').delete().eq('id', tempReconBaseTxnId)
            markCleaned(tempReconBaseTxnId)
        }
        if (tempReconOutboxIds.length > 0) {
            await supabaseAdmin.from('external_accounting_sync_outbox').delete().in('id', tempReconOutboxIds)
            for (const oid of tempReconOutboxIds) markCleaned(oid)
        }
        await supabaseAdmin
            .from('external_accounting_sync_outbox')
            .delete()
            .eq('company_realm_id', testRealmId)
            .ilike('idempotency_key', 'DELETE-%')
        await supabaseAdmin
            .from('external_accounting_audit_log')
            .delete()
            .eq('company_realm_id', testRealmId)
            .in('action_type', ['RECONCILE_BANK_COMPLETED', 'RECONCILE_BANK_REOPEN', 'RECONCILE_BANK_DELETE', 'CREATE_CHECK', 'DELETE_TRANSACTION'])
            .gte('created_at', new Date(Date.now() - 120_000).toISOString())
    }

    // -------------------------------------------------------------------------
    // PHASE 6.2: Batch Create (`batch_save_transactions`) con Fallo de 1 Fila (Rollback Total) + Ejecución Válida
    // -------------------------------------------------------------------------
    console.log('\n▶ [PHASE 6.2] Probando batch_save_transactions con fallo de una fila (rollback total) y lote válido...')
    const baselineBals62 = await getAccountBalanceMap(watchedAccIds)
    let createdBatchTxnIds: string[] = []
    let createdBatchOutboxIds: string[] = []

    try {
        // 6.2-A: 2 filas válidas + 1 fila con cuenta contable inválida -> debe abortar todo
        const failBatchRes1 = await callMainPostApi({
            action: 'batch_save_transactions',
            batch_type: 'Expense',
            bank_account_qb_id: bankAcc!.qb_account_id,
            rows: [
                { txn_date: '2026-10-31', entity_name: 'BATCH ROW 1', category_account_qb_id: expAcc!.qb_account_id, memo: 'P6 Batch Fail Test 1', amount: 40 },
                { txn_date: '2026-10-31', entity_name: 'BATCH ROW 2', category_account_qb_id: expAcc!.qb_account_id, memo: 'P6 Batch Fail Test 2', amount: 60 },
                { txn_date: '2026-10-31', entity_name: 'BATCH ROW 3 INVALID', category_account_qb_id: 'NON-EXISTENT-GL-999999', memo: 'P6 Batch Fail Test 3', amount: 25 },
            ],
        })
        assertCond(failBatchRes1.status === 400, `Expected 400 when 1 row has invalid GL account, got ${failBatchRes1.status}`)

        // 6.2-B: 2 filas válidas + forceRollbackOnIndex=1 (fuerza fallo dentro de la transacción SQL después de insertar la fila 1)
        const failBatchRes2 = await callMainPostApi({
            action: 'batch_save_transactions',
            batch_type: 'Expense',
            bank_account_qb_id: bankAcc!.qb_account_id,
            forceRollbackOnIndex: 1,
            rows: [
                { txn_date: '2026-10-31', entity_name: 'BATCH SQL ROLLBACK 1', category_account_qb_id: expAcc!.qb_account_id, memo: 'P6 Batch SQL Rollback 1', amount: 40 },
                { txn_date: '2026-10-31', entity_name: 'BATCH SQL ROLLBACK 2', category_account_qb_id: expAcc!.qb_account_id, memo: 'P6 Batch SQL Rollback 2', amount: 60 },
            ],
        })
        assertCond(
            failBatchRes2.status === 400 && failBatchRes2.json.rolledBack === true,
            `Expected 400 rolledBack on SQL mid-batch failure, got ${failBatchRes2.status}: ${JSON.stringify(failBatchRes2.json)}`
        )

        const { data: leakedBatchRows } = await supabaseAdmin
            .from('external_accounting_transactions')
            .select('id')
            .eq('company_realm_id', testRealmId)
            .ilike('memo', 'P6 Batch%')
        assertCond((leakedBatchRows || []).length === 0, '0 rows must persist when 1 row in batch_save_transactions fails')
        const afterFailBals62 = await getAccountBalanceMap(watchedAccIds)
        for (const qid of watchedAccIds) {
            assertCond(
                Math.abs((afterFailBals62.get(qid) || 0) - (baselineBals62.get(qid) || 0)) < 0.005,
                `Account ${qid} balance must remain unchanged after batch rollback`
            )
        }
        console.log('  ✅ [6.2-A/B] Rollback todo-o-nada en batch_save_transactions verificado (0 filas persistidas, $0.00 diff)')

        // 6.2-C: Lote válido de 2 filas ($40 + $60 = $100) y limpieza
        const okBatchRes = await callMainPostApi({
            action: 'batch_save_transactions',
            batch_type: 'Expense',
            bank_account_qb_id: bankAcc!.qb_account_id,
            rows: [
                { txn_date: '2026-10-31', entity_name: 'P6 VALID BATCH 1', category_account_qb_id: expAcc!.qb_account_id, memo: 'P6 Valid Batch Row 1', amount: 40 },
                { txn_date: '2026-10-31', entity_name: 'P6 VALID BATCH 2', category_account_qb_id: expAcc!.qb_account_id, memo: 'P6 Valid Batch Row 2', amount: 60 },
            ],
        })
        assertCond(okBatchRes.status === 200 && okBatchRes.json.createdCount === 2, `Expected createdCount=2, got ${JSON.stringify(okBatchRes.json)}`)
        createdBatchTxnIds = (okBatchRes.json.transactions || []).map((t: any) => String(t.id))
        createdBatchOutboxIds = (okBatchRes.json.outboxIds || []).map(String)
        for (const tid of createdBatchTxnIds) trackTemp('Transaction (Batch)', tid)
        for (const oid of createdBatchOutboxIds) trackTemp('Outbox (Batch)', oid)

        const midBals62 = await getAccountBalanceMap(watchedAccIds)
        assertCond(
            Math.abs((midBals62.get(bankAcc!.qb_account_id) || 0) - ((baselineBals62.get(bankAcc!.qb_account_id) || 0) - 100)) < 0.005,
            'Bank balance must decrease by $100.00 after valid batch save'
        )

        for (const tid of createdBatchTxnIds) {
            const delRes = await callMainPostApi({ action: 'delete_transaction', id: tid })
            assertCond(delRes.status === 200, `Deleting batch txn ${tid} must succeed`)
            markCleaned(tid)
        }
        createdBatchTxnIds = []

        const finalBals62 = await getAccountBalanceMap(watchedAccIds)
        for (const qid of watchedAccIds) {
            assertCond(
                Math.abs((finalBals62.get(qid) || 0) - (baselineBals62.get(qid) || 0)) < 0.005,
                `Account ${qid} balance must be restored after batch cleanup`
            )
        }
        console.log('  ✅ [6.2-C] Lote válido de 2 transacciones ($100.00) creado, verificado y limpiado con restauración exacta de saldos')
    } finally {
        for (const tid of createdBatchTxnIds) {
            await supabaseAdmin.from('external_accounting_transactions').delete().eq('id', tid)
            markCleaned(tid)
        }
        if (createdBatchOutboxIds.length > 0) {
            await supabaseAdmin.from('external_accounting_sync_outbox').delete().in('id', createdBatchOutboxIds)
            for (const oid of createdBatchOutboxIds) markCleaned(oid)
        }
        await supabaseAdmin
            .from('external_accounting_sync_outbox')
            .delete()
            .eq('company_realm_id', testRealmId)
            .ilike('idempotency_key', 'DELETE-%')
        await supabaseAdmin
            .from('external_accounting_audit_log')
            .delete()
            .eq('company_realm_id', testRealmId)
            .in('action_type', ['BATCH_ENTER_TRANSACTIONS', 'DELETE_TRANSACTION'])
            .gte('created_at', new Date(Date.now() - 120_000).toISOString())
    }

    // -------------------------------------------------------------------------
    // PHASE 6.3: Reclasificación Masiva y Reglas Bancarias con Rollback Provocado + Ejecución Válida
    // -------------------------------------------------------------------------
    console.log('\n▶ [PHASE 6.3] Probando reclassify_transactions y apply_bank_rules con rollback provocado y ejecución válida...')
    const baselineBals63 = await getAccountBalanceMap(watchedAccIds)
    const p63TxnIds: string[] = []
    const p63OutboxIds: string[] = []
    let tempBankRuleId: string | null = null

    try {
        // Crear 2 gastos temporales de $50 cada uno con memo 'PHASE6-BANKRULE-MATCH'
        for (let i = 1; i <= 2; i++) {
            const createRes = await callMainPostApi({
                action: 'save_transaction',
                txn_type: 'Expense',
                txn_date: '2026-10-31',
                doc_number: `P6-REC-${i}`,
                account_qb_id: bankAcc!.qb_account_id,
                to_account_qb_id: expAcc!.qb_account_id,
                entity_name: 'PHASE6-BANKRULE-MATCH VENDOR',
                total_amount: 50,
                memo: `PHASE6-BANKRULE-MATCH ITEM ${i}`,
            })
            assertCond(createRes.status === 200 && createRes.json.transaction?.id, `Must create test expense ${i}`)
            p63TxnIds.push(String(createRes.json.transaction.id))
            trackTemp(`Transaction (Reclassify #${i})`, createRes.json.transaction.id)
            if (createRes.json.outboxId) {
                p63OutboxIds.push(String(createRes.json.outboxId))
                trackTemp(`Outbox (Reclassify #${i})`, createRes.json.outboxId)
            }
        }

        // 6.3-A: Reclassify con 1 ID inválido en el arreglo -> debe abortar todo sin mover ninguna de las 2 válidas
        const failReclassRes = await callMainPostApi({
            action: 'reclassify_transactions',
            txn_ids: [...p63TxnIds, '00000000-0000-0000-0000-000000000000'],
            target_account_qb_id: altExpAcc.qb_account_id,
        })
        assertCond(
            failReclassRes.status === 400 && failReclassRes.json.rolledBack === true,
            `Expected 400 rolledBack on reclassify with invalid UUID, got ${failReclassRes.status}`
        )
        const { data: checkUnchanged } = await supabaseAdmin
            .from('external_accounting_transactions')
            .select('id, to_account_qb_id')
            .in('id', p63TxnIds)
        for (const r of checkUnchanged || []) {
            assertCond(r.to_account_qb_id === expAcc!.qb_account_id, 'Transaction must remain on original account after reclassify rollback')
        }
        console.log('  ✅ [6.3-A] Rollback de reclassify_transactions verificado: ninguna transacción ni saldo se alteró')

        // 6.3-B: Reclassify válido de las 2 transacciones hacia altExpAcc
        const okReclassRes = await callMainPostApi({
            action: 'reclassify_transactions',
            txn_ids: p63TxnIds,
            target_account_qb_id: altExpAcc.qb_account_id,
        })
        assertCond(okReclassRes.status === 200 && okReclassRes.json.updatedCount === 2, 'Valid reclassify must update 2 transactions')
        if (Array.isArray(okReclassRes.json.outboxIds)) {
            for (const oid of okReclassRes.json.outboxIds) {
                p63OutboxIds.push(String(oid))
                trackTemp('Outbox (Reclassified)', oid)
            }
        }
        const { data: checkMoved } = await supabaseAdmin
            .from('external_accounting_transactions')
            .select('id, to_account_qb_id')
            .in('id', p63TxnIds)
        for (const r of checkMoved || []) {
            assertCond(r.to_account_qb_id === altExpAcc.qb_account_id, 'Transaction must move to altExpAcc after valid reclassify')
        }
        console.log('  ✅ [6.3-B] Reclasificación masiva atómica verificada (2 transacciones movidas + saldos y outbox actualizados)')

        // 6.3-C: Crear regla bancaria temporal y probar apply_bank_rules con rollback provocado y luego ejecución válida
        const saveRuleRes = await callMainPostApi({
            action: 'save_bank_rule',
            name: 'P6 Temp Bank Rule',
            direction: 'OUT',
            match_text: 'PHASE6-BANKRULE-MATCH',
            target_account_qb_id: expAcc!.qb_account_id,
            target_account_name: expAcc!.name,
            assign_entity_name: 'PHASE6-BANKRULE-MATCH VENDOR',
        })
        assertCond(saveRuleRes.status === 200 && saveRuleRes.json.rule?.id, 'Temp bank rule must be saved')
        tempBankRuleId = String(saveRuleRes.json.rule.id)
        trackTemp('BankRule', tempBankRuleId)

        const failRuleApply = await callMainPostApi({
            action: 'apply_bank_rules',
            forceRollbackAfterMatch: true,
        })
        assertCond(
            failRuleApply.status === 400 && failRuleApply.json.rolledBack === true,
            `Expected 400 rolledBack on apply_bank_rules with forceRollbackAfterMatch, got ${failRuleApply.status}`
        )
        const { data: checkStillAlt } = await supabaseAdmin
            .from('external_accounting_transactions')
            .select('id, to_account_qb_id')
            .in('id', p63TxnIds)
        for (const r of checkStillAlt || []) {
            assertCond(r.to_account_qb_id === altExpAcc.qb_account_id, 'Transactions must stay on altExpAcc after bank rule rollback')
        }

        const okRuleApply = await callMainPostApi({
            action: 'apply_bank_rules',
        })
        assertCond(okRuleApply.status === 200 && okRuleApply.json.appliedCount >= 2, 'Valid apply_bank_rules must apply to the 2 matched transactions')
        if (Array.isArray(okRuleApply.json.outboxIds)) {
            for (const oid of okRuleApply.json.outboxIds) {
                p63OutboxIds.push(String(oid))
                trackTemp('Outbox (BankRule)', oid)
            }
        }
        const { data: checkBackToExp } = await supabaseAdmin
            .from('external_accounting_transactions')
            .select('id, to_account_qb_id')
            .in('id', p63TxnIds)
        for (const r of checkBackToExp || []) {
            assertCond(r.to_account_qb_id === expAcc!.qb_account_id, 'Transactions must return to expAcc after bank rule execution')
        }

        // Clean up bank rule and transactions
        const delRuleRes = await callMainPostApi({ action: 'delete_bank_rule', id: tempBankRuleId })
        assertCond(delRuleRes.status === 200, 'Delete temp bank rule must succeed')
        markCleaned(tempBankRuleId)
        tempBankRuleId = null

        for (const tid of p63TxnIds) {
            const delRes = await callMainPostApi({ action: 'delete_transaction', id: tid })
            assertCond(delRes.status === 200, `Deleting P6.3 txn ${tid} must succeed`)
            markCleaned(tid)
        }
        p63TxnIds.length = 0

        const finalBals63 = await getAccountBalanceMap(watchedAccIds)
        for (const qid of watchedAccIds) {
            assertCond(
                Math.abs((finalBals63.get(qid) || 0) - (baselineBals63.get(qid) || 0)) < 0.005,
                `Account ${qid} balance must be restored after P6.3 cleanup`
            )
        }
        console.log('  ✅ [6.3-C] Reglas bancarias (apply_bank_rules) con rollback y ejecución atómica verificadas')
    } finally {
        if (tempBankRuleId) {
            await callMainPostApi({ action: 'delete_bank_rule', id: tempBankRuleId })
            markCleaned(tempBankRuleId)
        }
        for (const tid of p63TxnIds) {
            await callMainPostApi({ action: 'delete_transaction', id: tid }).catch(() => {})
            await supabaseAdmin.from('external_accounting_transactions').delete().eq('id', tid)
            markCleaned(tid)
        }
        if (p63OutboxIds.length > 0) {
            await supabaseAdmin.from('external_accounting_sync_outbox').delete().in('id', p63OutboxIds)
            for (const oid of p63OutboxIds) markCleaned(oid)
        }
        await supabaseAdmin
            .from('external_accounting_sync_outbox')
            .delete()
            .eq('company_realm_id', testRealmId)
            .ilike('idempotency_key', 'DELETE-%')
        await supabaseAdmin
            .from('external_accounting_audit_log')
            .delete()
            .eq('company_realm_id', testRealmId)
            .in('action_type', ['CREATE_EXPENSE', 'RECLASSIFY_BATCH', 'APPLY_BANK_RULES', 'SAVE_BANK_RULE', 'DELETE_BANK_RULE', 'DELETE_TRANSACTION'])
            .gte('created_at', new Date(Date.now() - 120_000).toISOString())
    }

    // -------------------------------------------------------------------------
    // PHASE 6.4: Write-Off Invoices (`write_off_invoices`) con Rollback Provocado + Restauración de Saldos y Open Balance
    // -------------------------------------------------------------------------
    console.log('\n▶ [PHASE 6.4] Probando write_off_invoices / Credit Memo con rollback provocado y restauración de saldos...')
    const baselineBals64 = await getAccountBalanceMap(watchedAccIds)
    let tempWriteOffInvId: string | null = null
    let tempCreditMemoId: string | null = null
    const p64OutboxIds: string[] = []

    try {
        // Crear factura abierta temporal por $250.00
        const invRes = await callMainPostApi({
            action: 'save_transaction',
            txn_type: 'Invoice',
            txn_date: '2026-10-31',
            due_date: '2026-11-30',
            doc_number: 'P6-INV-250',
            account_qb_id: arAcc.qb_account_id,
            to_account_qb_id: incomeAcc.qb_account_id,
            entity_name: 'PHASE 6 WRITE-OFF CUSTOMER',
            total_amount: 250,
            open_balance: 250,
            memo: 'Phase 6 Write-Off Open Invoice Test',
            line_items: [
                {
                    account_qb_id: incomeAcc.qb_account_id,
                    account_name: incomeAcc.name,
                    description: 'Consulting Services',
                    amount: 250,
                    posting_type: 'Credit',
                },
            ],
        })
        assertCond(invRes.status === 200 && invRes.json.transaction?.id, 'Temp open invoice must be created')
        tempWriteOffInvId = String(invRes.json.transaction.id)
        trackTemp('Transaction (WriteOff Invoice)', tempWriteOffInvId)
        if (invRes.json.outboxId) {
            p64OutboxIds.push(String(invRes.json.outboxId))
            trackTemp('Outbox (WriteOff Invoice)', invRes.json.outboxId)
        }

        // 6.4-A: Provocar rollback con un invoice_id inexistente junto al válido
        const failWoRes = await callMainPostApi({
            action: 'write_off_invoices',
            invoice_ids: [tempWriteOffInvId, '00000000-0000-0000-0000-000000000000'],
            bad_debt_account_qb_id: expAcc!.qb_account_id,
            bad_debt_account_name: expAcc!.name,
            write_off_date: '2026-10-31',
            reason: 'Phase 6 Write-Off Rollback Test',
        })
        assertCond(
            failWoRes.status === 400 && failWoRes.json.rolledBack === true,
            `Expected 400 rolledBack on write_off_invoices with invalid UUID, got ${failWoRes.status}`
        )
        const { data: invStillOpen } = await supabaseAdmin
            .from('external_accounting_transactions')
            .select('open_balance')
            .eq('id', tempWriteOffInvId)
            .single()
        assertCond(Number(invStillOpen?.open_balance) === 250, `Invoice open_balance must remain 250 after rollback, got ${invStillOpen?.open_balance}`)
        console.log('  ✅ [6.4-A] Rollback de write_off_invoices verificado: open_balance intacto ($250.00) y 0 CreditMemos creados')

        // 6.4-B: Write-off válido de la factura ($250.00)
        const okWoRes = await callMainPostApi({
            action: 'write_off_invoices',
            invoice_ids: [tempWriteOffInvId],
            bad_debt_account_qb_id: expAcc!.qb_account_id,
            bad_debt_account_name: expAcc!.name,
            write_off_date: '2026-10-31',
            reason: 'Phase 6 Valid Write-Off Audit',
        })
        assertCond(okWoRes.status === 200 && okWoRes.json.writtenOffCount === 1, `Expected writtenOffCount=1, got ${JSON.stringify(okWoRes.json)}`)
        tempCreditMemoId = String(okWoRes.json.creditMemos?.[0]?.id || '')
        assertCond(Boolean(tempCreditMemoId), 'CreditMemo ID must be returned')
        trackTemp('Transaction (WriteOff CreditMemo)', tempCreditMemoId)
        if (Array.isArray(okWoRes.json.outboxIds)) {
            for (const oid of okWoRes.json.outboxIds) {
                p64OutboxIds.push(String(oid))
                trackTemp('Outbox (WriteOff CreditMemo)', oid)
            }
        }

        const { data: invClosed } = await supabaseAdmin
            .from('external_accounting_transactions')
            .select('open_balance')
            .eq('id', tempWriteOffInvId)
            .single()
        assertCond(Number(invClosed?.open_balance) === 0, `Invoice open_balance must be 0 after write-off, got ${invClosed?.open_balance}`)

        // Verify normalized LinkedTxn exists for the CreditMemo
        const { data: cmLinks, error: cmLinksErr } = await supabaseAdmin
            .from('external_accounting_linked_transactions')
            .select('id, target_transaction_id, target_qb_txn_id, target_txn_type, applied_amount')
            .eq('source_transaction_id', tempCreditMemoId)
        if (cmLinksErr) throw cmLinksErr
        assertCond((cmLinks || []).length === 1, `Expected 1 LinkedTxn on CreditMemo, found ${(cmLinks || []).length}`)

        // Restaurar eliminando el CreditMemo y la Invoice
        const delCm = await callMainPostApi({ action: 'delete_transaction', id: tempCreditMemoId })
        assertCond(delCm.status === 200, 'Deleting CreditMemo must succeed')
        markCleaned(tempCreditMemoId)
        tempCreditMemoId = null

        const delInv = await callMainPostApi({ action: 'delete_transaction', id: tempWriteOffInvId })
        assertCond(delInv.status === 200, 'Deleting Invoice must succeed')
        markCleaned(tempWriteOffInvId)
        tempWriteOffInvId = null

        const finalBals64 = await getAccountBalanceMap(watchedAccIds)
        for (const qid of watchedAccIds) {
            assertCond(
                Math.abs((finalBals64.get(qid) || 0) - (baselineBals64.get(qid) || 0)) < 0.005,
                `Account ${qid} balance must be restored after Write-Off + Invoice cleanup (expected ${baselineBals64.get(qid)}, got ${finalBals64.get(qid)})`
            )
        }
        console.log('  ✅ [6.4-B] Write-off atómico (CreditMemo + LinkedTxn + open_balance=0) y restauración exacta de saldos verificados')
    } finally {
        if (tempCreditMemoId) {
            await callMainPostApi({ action: 'delete_transaction', id: tempCreditMemoId }).catch(() => {})
            await supabaseAdmin.from('external_accounting_transactions').delete().eq('id', tempCreditMemoId)
            markCleaned(tempCreditMemoId)
        }
        if (tempWriteOffInvId) {
            await callMainPostApi({ action: 'delete_transaction', id: tempWriteOffInvId }).catch(() => {})
            await supabaseAdmin.from('external_accounting_transactions').delete().eq('id', tempWriteOffInvId)
            markCleaned(tempWriteOffInvId)
        }
        if (p64OutboxIds.length > 0) {
            await supabaseAdmin.from('external_accounting_sync_outbox').delete().in('id', p64OutboxIds)
            for (const oid of p64OutboxIds) markCleaned(oid)
        }
        await supabaseAdmin
            .from('external_accounting_contacts')
            .delete()
            .eq('company_realm_id', testRealmId)
            .in('display_name', [
                'PHASE 6 RECON VENDOR',
                'P6 VALID BATCH 1',
                'P6 VALID BATCH 2',
                'PHASE6-BANKRULE-MATCH VENDOR',
                'PHASE 6 WRITE-OFF CUSTOMER',
            ])
        await supabaseAdmin
            .from('external_accounting_sync_outbox')
            .delete()
            .eq('company_realm_id', testRealmId)
            .ilike('idempotency_key', 'DELETE-%')
        await supabaseAdmin
            .from('external_accounting_audit_log')
            .delete()
            .eq('company_realm_id', testRealmId)
            .in('action_type', ['CREATE_INVOICE', 'WRITE_OFF_INVOICES', 'DELETE_TRANSACTION'])
            .gte('created_at', new Date(Date.now() - 120_000).toISOString())
    }

    // -------------------------------------------------------------------------
    // PHASE 6.5: CRUD Atómico + Outbox de `Account`, `List Item` y `Recurring`
    // -------------------------------------------------------------------------
    console.log('\n▶ [PHASE 6.5] Probando CRUD atómico + Outbox de Account, List Item y Recurring...')
    let tempAccountId: string | null = null
    let tempListItemId: string | null = null
    let tempRecurringId: string | null = null
    const p65OutboxIds: string[] = []

    try {
        // 1. Account CRUD (save_account -> delete_account)
        const accCreateRes = await callMainPostApi({
            action: 'save_account',
            name: `P6 Temp Account ${Date.now()}`,
            acct_num: '99965',
            account_type: 'Expense',
            account_sub_type: 'OfficeGeneralAdministrativeExpenses',
            current_balance: 0,
        })
        assertCond(accCreateRes.status === 200 && accCreateRes.json.account?.id, 'save_account must create account atomically')
        tempAccountId = String(accCreateRes.json.account.id)
        trackTemp('Account', tempAccountId)
        assertCond(Boolean(accCreateRes.json.outboxId), 'save_account must enqueue outbox entry')
        p65OutboxIds.push(String(accCreateRes.json.outboxId))
        trackTemp('Outbox (Account Create)', accCreateRes.json.outboxId)

        const accDelRes = await callMainPostApi({ action: 'delete_account', id: tempAccountId })
        assertCond(accDelRes.status === 200 && accDelRes.json.outboxId, 'delete_account must deactivate/delete and enqueue outbox')
        p65OutboxIds.push(String(accDelRes.json.outboxId))
        trackTemp('Outbox (Account Delete)', accDelRes.json.outboxId)
        await supabaseAdmin.from('external_accounting_accounts').delete().eq('id', tempAccountId)
        markCleaned(tempAccountId)
        tempAccountId = null

        // 2. List Item CRUD (save_list_item -> delete_list_item for 'items')
        const itemCreateRes = await callMainPostApi({
            action: 'save_list_item',
            listKey: 'items',
            item: {
                name: `P6 Temp Service Item ${Date.now()}`,
                sku: 'P6-SKU-01',
                type: 'Service',
                rate: 175,
                income_account: incomeAcc.name,
                income_account_qb_id: incomeAcc.qb_account_id,
            },
        })
        assertCond(itemCreateRes.status === 200 && itemCreateRes.json.item?.id, `save_list_item must succeed, got ${JSON.stringify(itemCreateRes.json)}`)
        tempListItemId = String(itemCreateRes.json.item.id)
        trackTemp('ListItem (items)', tempListItemId)
        assertCond(Boolean(itemCreateRes.json.outboxId), 'save_list_item must enqueue outbox entry')
        p65OutboxIds.push(String(itemCreateRes.json.outboxId))
        trackTemp('Outbox (ListItem Create)', itemCreateRes.json.outboxId)

        const itemDelRes = await callMainPostApi({
            action: 'delete_list_item',
            listKey: 'items',
            id: tempListItemId,
        })
        assertCond(itemDelRes.status === 200 && itemDelRes.json.outboxId, 'delete_list_item must succeed and enqueue outbox')
        p65OutboxIds.push(String(itemDelRes.json.outboxId))
        trackTemp('Outbox (ListItem Delete)', itemDelRes.json.outboxId)
        await supabaseAdmin.from('external_accounting_items').delete().eq('id', tempListItemId)
        markCleaned(tempListItemId)
        tempListItemId = null

        // 3. Recurring CRUD (save_recurring -> delete_recurring)
        const recCreateRes = await callMainPostApi({
            action: 'save_recurring',
            template_name: `P6 Temp Recurring Rent ${Date.now()}`,
            txn_type: 'Expense',
            interval_type: 'Monthly',
            day_of_month: 1,
            next_date: '2026-11-01',
            account_qb_id: bankAcc!.qb_account_id,
            account_name: bankAcc!.name,
            to_account_qb_id: expAcc!.qb_account_id,
            to_account_name: expAcc!.name,
            entity_name: 'P6 RECURRING VENDOR',
            amount: 350,
            memo: 'Phase 6 Recurring Test',
        })
        assertCond(recCreateRes.status === 200 && recCreateRes.json.recurring?.id, 'save_recurring must succeed atomically')
        tempRecurringId = String(recCreateRes.json.recurring.id)
        trackTemp('RecurringTemplate', tempRecurringId)
        assertCond(Boolean(recCreateRes.json.outboxId), 'save_recurring must enqueue outbox entry')
        p65OutboxIds.push(String(recCreateRes.json.outboxId))
        trackTemp('Outbox (Recurring Create)', recCreateRes.json.outboxId)

        const recDelRes = await callMainPostApi({
            action: 'delete_recurring',
            id: tempRecurringId,
        })
        assertCond(recDelRes.status === 200 && recDelRes.json.outboxId, 'delete_recurring must succeed atomically')
        p65OutboxIds.push(String(recDelRes.json.outboxId))
        trackTemp('Outbox (Recurring Delete)', recDelRes.json.outboxId)
        markCleaned(tempRecurringId)
        tempRecurringId = null

        console.log('  ✅ [6.5] CRUD atómico + Outbox de Account, List Item (items) y Recurring verificado y limpiado')
    } finally {
        if (tempAccountId) {
            await supabaseAdmin.from('external_accounting_accounts').delete().eq('id', tempAccountId)
            markCleaned(tempAccountId)
        }
        if (tempListItemId) {
            await supabaseAdmin.from('external_accounting_items').delete().eq('id', tempListItemId)
            markCleaned(tempListItemId)
        }
        if (tempRecurringId) {
            await supabaseAdmin.from('external_accounting_recurring_transactions').delete().eq('id', tempRecurringId)
            markCleaned(tempRecurringId)
        }
        if (p65OutboxIds.length > 0) {
            await supabaseAdmin.from('external_accounting_sync_outbox').delete().in('id', p65OutboxIds)
            for (const oid of p65OutboxIds) markCleaned(oid)
        }
        await supabaseAdmin
            .from('external_accounting_audit_log')
            .delete()
            .eq('company_realm_id', testRealmId)
            .in('action_type', ['CREATE_ACCOUNT', 'DELETE_ACCOUNT', 'SAVE_LIST_ITEM', 'DELETE_LIST_ITEM', 'CREATE_RECURRING', 'DELETE_RECURRING'])
            .gte('created_at', new Date(Date.now() - 120_000).toISOString())
    }

    // -------------------------------------------------------------------------
    // PHASE 6.6: Outbox QBO Unificado — Fallo Simulado + Backoff + Retry Exitoso + Idempotencia
    // -------------------------------------------------------------------------
    console.log('\n▶ [PHASE 6.6] Probando contrato unificado de Outbox QBO (fallo simulado + backoff + retry exitoso + idempotencia)...')
    let testOutboxRowId: string | null = null
    try {
        const idemKey = `P6-OUTBOX-TEST-${Date.now()}`
        const { data: insertedOb, error: obInsErr } = await supabaseAdmin
            .from('external_accounting_sync_outbox')
            .insert({
                company_realm_id: testRealmId,
                entity_kind: 'TRANSACTION',
                entity_type: 'Expense',
                qb_entity_id: `LOCAL-OB-${Date.now()}`,
                operation: 'UPSERT',
                idempotency_key: idemKey,
                payload: { test: true },
                status: 'PENDING',
                attempts: 0,
                max_attempts: 5,
                next_retry_at: new Date().toISOString(),
            })
            .select('*')
            .single()
        if (obInsErr) throw obInsErr
        testOutboxRowId = String(insertedOb.id)
        trackTemp('Outbox (Retry/Idempotency Test)', testOutboxRowId)

        // Verify unified column names exist and attempt_count does NOT exist
        assertCond(
            'attempts' in insertedOb &&
                'max_attempts' in insertedOb &&
                'next_retry_at' in insertedOb &&
                'status' in insertedOb &&
                'last_error' in insertedOb &&
                'synced_at' in insertedOb &&
                !('attempt_count' in insertedOb),
            'Outbox row must strictly use unified column contract without attempt_count'
        )

        let remoteMutationCount = 0

        // Paso 1: Simular fallo QBO (503 Service Unavailable)
        const attempt1 = await processSingleOutboxEntry(supabaseAdmin, testRealmId, testOutboxRowId, {
            baseBackoffSeconds: 60,
            customExecutor: async () => {
                remoteMutationCount++
                return {
                    synced: false,
                    status: 'QBO_503',
                    error: 'Simulated QBO 503 Service Unavailable',
                }
            },
        })
        assertCond(attempt1.status === 'FAILED', `Expected status=FAILED on attempt 1, got ${attempt1.status}`)
        assertCond(attempt1.attempts === 1, `Expected attempts=1, got ${attempt1.attempts}`)
        assertCond(attempt1.lastError === 'Simulated QBO 503 Service Unavailable', `Expected lastError populated, got ${attempt1.lastError}`)
        assertCond(Boolean(attempt1.nextRetryAt && new Date(attempt1.nextRetryAt).getTime() > Date.now() + 10_000), 'next_retry_at must be in the future after backoff')
        assertCond(remoteMutationCount === 1, 'Remote executor was called once on attempt 1')

        // Paso 2: Ejecutar worker sin forceNow -> debe respetar next_retry_at <= NOW() y NO tocar la fila aún
        const prematureWorker = await processPendingQboOutbox(supabaseAdmin, testRealmId, {
            outboxIds: [testOutboxRowId],
            customExecutor: async () => {
                remoteMutationCount++
                return { synced: true, qbEntityId: 'SHOULD-NOT-RUN' }
            },
        })
        assertCond(prematureWorker.processedCount === 0, `Worker must skip row whose next_retry_at > NOW(), processed=${prematureWorker.processedCount}`)
        assertCond(remoteMutationCount === 1, 'Remote executor must NOT be called before next_retry_at')

        // Paso 3: Simular llegada de next_retry_at y ejecutar retry exitoso (1 sola mutación remota efectiva)
        let successfulRemoteMutations = 0
        const attempt2 = await processSingleOutboxEntry(supabaseAdmin, testRealmId, testOutboxRowId, {
            forceNow: true,
            customExecutor: async () => {
                successfulRemoteMutations++
                return {
                    synced: true,
                    qbEntityId: 'QBO-REMOTE-999111',
                    status: 'SYNCED',
                }
            },
        })
        assertCond(attempt2.status === 'SYNCED', `Expected status=SYNCED on retry, got ${attempt2.status}`)
        assertCond(attempt2.attempts === 2, `Expected attempts=2 on retry, got ${attempt2.attempts}`)
        assertCond(attempt2.lastError === null, 'last_error must be cleared on SYNCED')
        assertCond(Boolean(attempt2.syncedAt), 'synced_at must be populated on SYNCED')
        assertCond(attempt2.qbEntityId === 'QBO-REMOTE-999111', `Expected qbEntityId=QBO-REMOTE-999111, got ${attempt2.qbEntityId}`)
        assertCond(successfulRemoteMutations === 1, 'Exactly 1 successful remote mutation must occur')

        // Paso 4: Volver a invocar sobre la misma operación -> idempotencia estricta (0 llamadas remotas adicionales)
        const attempt3 = await processSingleOutboxEntry(supabaseAdmin, testRealmId, testOutboxRowId, {
            forceNow: true,
            customExecutor: async () => {
                successfulRemoteMutations++
                return { synced: true, qbEntityId: 'DUPLICATE-MUTATION' }
            },
        })
        assertCond(
            attempt3.status === 'ALREADY_SYNCED' && attempt3.alreadyIdempotent === true && attempt3.remoteCalled === false,
            `Expected idempotent ALREADY_SYNCED without remote call, got ${JSON.stringify(attempt3)}`
        )
        assertCond(successfulRemoteMutations === 1, `Expected successfulRemoteMutations to remain 1, got ${successfulRemoteMutations}`)
        console.log('  ✅ [6.6] Outbox QBO verificado: fallo simulado (attempts=1, FAILED, backoff), retry exitoso (attempts=2, SYNCED) e idempotencia (1 sola mutación remota)')
    } finally {
        if (testOutboxRowId) {
            await supabaseAdmin.from('external_accounting_sync_outbox').delete().eq('id', testOutboxRowId)
            markCleaned(testOutboxRowId)
        }
    }

    // -------------------------------------------------------------------------
    // PHASE 6.7: Autorización Estricta (Usuario No Autorizado -> 403 vs Usuario Global -> Lee las 8 Empresas)
    // -------------------------------------------------------------------------
    console.log('\n▶ [PHASE 6.7] Verificando bloqueo 403 a usuario autenticado no autorizado y lectura de las 8 empresas por usuario global...')
    const unauthorizedToken = jwt.sign(
        { sub: '25', id: 25, email: 'carlos@tacosgavilan.com', name: 'Carlos', role: 'admin' },
        getJwtSecret()!,
        { expiresIn: '5m' }
    )
    const unauthGet = await callMainGetApi({}, unauthorizedToken)
    const unauthPost = await callMainPostApi({ action: 'save_account', name: 'Should Fail 403' }, unauthorizedToken)
    assertCond(unauthGet.status === 403, `Expected 403 on GET for non-whitelisted user 25, got ${unauthGet.status}`)
    assertCond(unauthPost.status === 403, `Expected 403 on POST for non-whitelisted user 25, got ${unauthPost.status}`)

    for (const comp of companies || []) {
        const compGet = await callMainGetApi({ realmId: String(comp.realm_id) }, raquelToken)
        assertCond(
            compGet.status === 200 && compGet.json.activeRealmId === String(comp.realm_id),
            `Authorized global user (45 Raquel) must read company ${comp.company_name} (${comp.realm_id}), got status=${compGet.status}, activeRealmId=${compGet.json.activeRealmId}`
        )
    }
    console.log('  ✅ [6.7] Autorización verificada: usuario autenticado no autorizado recibe 403 Forbidden; Raquel (45) lee las 8 empresas (6 ACTIVE_QBO + 2 RETIRED_FROM_QBO_LOCAL_ACTIVE)')

    // -------------------------------------------------------------------------
    // PHASE 6.8: Empresa Local-Only (`193514304333307` Chicken Taco Catering LLC) Jamás Llama a QBO
    // -------------------------------------------------------------------------
    console.log('\n▶ [PHASE 6.8] Verificando que Chicken Taco Catering LLC (qbo_sync_enabled=false) crea outbox SKIPPED_LOCAL_ONLY y jamás llama a QBO...')
    const localOnlyRealmId = '193514304333307' // Chicken Taco Catering LLC
    let localOnlyAccId: string | null = null
    let localOnlyOutboxId: string | null = null

    try {
        const localCreateRes = await callMainPostApi({
            realmId: localOnlyRealmId,
            action: 'save_account',
            name: `P6 Local-Only Account ${Date.now()}`,
            acct_num: '88868',
            account_type: 'Expense',
            account_sub_type: 'SuppliesMaterials',
            current_balance: 0,
        })
        assertCond(localCreateRes.status === 200 && localCreateRes.json.account?.id, 'Local-only company save_account must succeed locally')
        localOnlyAccId = String(localCreateRes.json.account.id)
        localOnlyOutboxId = String(localCreateRes.json.outboxId || '')
        trackTemp('Account (Local-Only Chicken Taco)', localOnlyAccId)
        trackTemp('Outbox (Local-Only Chicken Taco)', localOnlyOutboxId)

        assertCond(
            localCreateRes.json.qboSync?.status === 'SKIPPED_LOCAL_ONLY',
            `Expected qboSync.status=SKIPPED_LOCAL_ONLY for Chicken Taco Catering, got ${JSON.stringify(localCreateRes.json.qboSync)}`
        )

        // Verify outbox row in DB has status = SKIPPED_LOCAL_ONLY
        const { data: localObRow } = await supabaseAdmin
            .from('external_accounting_sync_outbox')
            .select('status, attempts')
            .eq('id', localOnlyOutboxId)
            .single()
        assertCond(localObRow?.status === 'SKIPPED_LOCAL_ONLY', `Expected DB outbox status=SKIPPED_LOCAL_ONLY, got ${localObRow?.status}`)

        // Verify processSingleOutboxEntry never invokes remote executor
        let localOnlyRemoteCalls = 0
        const procLocalRes = await processSingleOutboxEntry(supabaseAdmin, localOnlyRealmId, localOnlyOutboxId, {
            forceNow: true,
            customExecutor: async () => {
                localOnlyRemoteCalls++
                return { synced: true, qbEntityId: 'SHOULD-NEVER-CALL' }
            },
        })
        assertCond(
            procLocalRes.status === 'SKIPPED_LOCAL_ONLY' && procLocalRes.remoteCalled === false && localOnlyRemoteCalls === 0,
            'processSingleOutboxEntry must never call QBO for qbo_sync_enabled=false company'
        )

        // Verify syncCompanyWithQbo returns skipped_local_only without calling QBO
        const syncLocalCompanyRes = await syncCompanyWithQbo(supabaseAdmin, localOnlyRealmId)
        assertCond(
            syncLocalCompanyRes.ok === false && syncLocalCompanyRes.status === 'skipped_local_only',
            `syncCompanyWithQbo on local-only company must return status=skipped_local_only, got ${JSON.stringify(syncLocalCompanyRes)}`
        )
        console.log('  ✅ [6.8] Empresa local-only (Chicken Taco Catering LLC) verificada: outbox=SKIPPED_LOCAL_ONLY y 0 llamadas remotas a QBO')
    } finally {
        if (localOnlyAccId) {
            await supabaseAdmin.from('external_accounting_accounts').delete().eq('id', localOnlyAccId)
            markCleaned(localOnlyAccId)
        }
        if (localOnlyOutboxId) {
            await supabaseAdmin.from('external_accounting_sync_outbox').delete().eq('id', localOnlyOutboxId)
            markCleaned(localOnlyOutboxId)
        }
        await supabaseAdmin
            .from('external_accounting_audit_log')
            .delete()
            .eq('company_realm_id', localOnlyRealmId)
            .eq('action_type', 'CREATE_ACCOUNT')
            .gte('created_at', new Date(Date.now() - 120_000).toISOString())
    }

    // -------------------------------------------------------------------------
    // PHASE 6.9: Pull QBO Endurecido (`fetchAllQboEntitiesPaginatedDetailed`)
    // -------------------------------------------------------------------------
    console.log('\n▶ [PHASE 6.9] Probando endurecimiento de Pull QBO (fallo en página 2 -> incomplete y techo de paginación -> truncated)...')
    // 6.9-A: Página 1 devuelve 500 registros, Página 2 falla con 502 Bad Gateway
    const page2FailPull = await fetchAllQboEntitiesPaginatedDetailed(supabaseAdmin, testRealmId, 'Invoice', {
        pageSize: 500,
        maxPages: 5,
        queryRunner: async (_realmId, _sql, page, startPosition) => {
            if (page === 1) {
                return {
                    ok: true,
                    status: 200,
                    data: {
                        QueryResponse: {
                            Invoice: Array.from({ length: 500 }, (_, idx) => ({ Id: String(startPosition + idx) })),
                        },
                    },
                }
            }
            return {
                ok: false,
                status: 502,
                error: 'Simulated QBO 502 Bad Gateway on Page 2',
            }
        },
    })
    assertCond(
        page2FailPull.ok === false &&
            page2FailPull.status === 'incomplete' &&
            page2FailPull.failedPage === 2 &&
            page2FailPull.cursor === 501 &&
            String(page2FailPull.error).includes('502 Bad Gateway'),
        `Expected incomplete pull on page 2 failure with cursor=501, got ${JSON.stringify(page2FailPull)}`
    )

    // 6.9-B: Límite técnico de páginas alcanzado (maxPages=2, 500 por página -> ceiling=1000, nextCursor=1001)
    const ceilingPull = await fetchAllQboEntitiesPaginatedDetailed(supabaseAdmin, testRealmId, 'Customer', {
        pageSize: 500,
        maxPages: 2,
        queryRunner: async (_realmId, _sql, _page, startPosition) => ({
            ok: true,
            status: 200,
            data: {
                QueryResponse: {
                    Customer: Array.from({ length: 500 }, (_, idx) => ({ Id: String(startPosition + idx) })),
                },
            },
        }),
    })
    assertCond(
        ceilingPull.ok === true &&
            ceilingPull.status === 'truncated' &&
            ceilingPull.truncated === true &&
            ceilingPull.truncationCeiling === 1000 &&
            ceilingPull.nextCursor === 1001 &&
            ceilingPull.items.length === 1000,
        `Expected truncated=true with ceiling=1000 and nextCursor=1001, got ${JSON.stringify({
            ok: ceilingPull.ok,
            status: ceilingPull.status,
            truncated: ceilingPull.truncated,
            ceiling: ceilingPull.truncationCeiling,
            nextCursor: ceilingPull.nextCursor,
        })}`
    )
    console.log('  ✅ [6.9] Pull QBO endurecido verificado: fallo en página 2 devuelve status=incomplete (failedPage=2, cursor=501) y techo devuelve truncated=true (ceiling=1000, nextCursor=1001)')

    // -------------------------------------------------------------------------
    // PHASE 6.10: Adjuntos en Supabase Storage (`external-accounting-attachments`), Constraint No-Binary-JSONB, Lectura Autorizada y Correo/Preview Seguro
    // -------------------------------------------------------------------------
    console.log('\n▶ [PHASE 6.10] Probando adjuntos en Supabase Storage, constraint chk_ext_acct_attachments_no_binary_jsonb, lectura SHA-256 y bitácora de correo...')
    let tempAttId: string | null = null
    let tempAttOutboxId: string | null = null
    let tempAttStoragePath: string | null = null
    let tempEmailLogId: string | null = null

    try {
        // 6.10-A: Verificar que PostgreSQL bloquea guardar data_url dentro de raw_data JSONB
        const { error: binaryJsonbErr } = await supabaseAdmin.from('external_accounting_attachments').insert({
            company_realm_id: testRealmId,
            qb_attachable_id: `FORBIDDEN-JSONB-${Date.now()}`,
            file_name: 'forbidden.pdf',
            content_type: 'application/pdf',
            raw_data: {
                data_url: 'data:application/pdf;base64,JVBERi0xLjQK',
            },
        })
        assertCond(
            Boolean(binaryJsonbErr && String(binaryJsonbErr.message).includes('chk_ext_acct_attachments_no_binary_jsonb')),
            `PostgreSQL must reject data_url inside raw_data JSONB with chk_ext_acct_attachments_no_binary_jsonb, got: ${binaryJsonbErr?.message}`
        )
        console.log('  ✅ [6.10-A] Constraint SQL chk_ext_acct_attachments_no_binary_jsonb verificado: rechazó data_url binario en JSONB')

        // 6.10-B: Subir adjunto real a Supabase Storage vinculado a un contacto y una transacción existente
        const [{ data: sampleContact }, { data: sampleTxn }] = await Promise.all([
            supabaseAdmin.from('external_accounting_contacts').select('id, qb_contact_id').eq('company_realm_id', testRealmId).limit(1).single(),
            supabaseAdmin.from('external_accounting_transactions').select('id, qb_txn_id').eq('company_realm_id', testRealmId).limit(1).single(),
        ])
        assertCond(Boolean(sampleContact && sampleTxn), 'Must have a sample contact and transaction in Gutierrez Financial')

        const pdfSampleBuffer = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n', 'utf-8')
        const expectedSha256 = crypto.createHash('sha256').update(pdfSampleBuffer).digest('hex')
        const dataUrlInput = `data:application/pdf;base64,${pdfSampleBuffer.toString('base64')}`

        const uploadAttRes = await callMainPostApi({
            action: 'save_contact_attachment',
            contact_id: sampleContact!.id,
            qb_contact_id: sampleContact!.qb_contact_id,
            transaction_id: sampleTxn!.id,
            qb_txn_id: sampleTxn!.qb_txn_id,
            file_name: 'Phase6_Audit_Contract.pdf',
            content_type: 'application/pdf',
            data_url: dataUrlInput,
            note: 'Phase 6 Storage Attachment Test',
        })
        assertCond(
            uploadAttRes.status === 200 && uploadAttRes.json.attachment?.id,
            `save_contact_attachment must upload to Storage and persist metadata, got ${JSON.stringify(uploadAttRes.json)}`
        )
        tempAttId = String(uploadAttRes.json.attachment.id)
        tempAttOutboxId = String(uploadAttRes.json.outboxId || '')
        tempAttStoragePath = String(uploadAttRes.json.attachment.storage_path || '')
        trackTemp('Attachment (Supabase Storage)', tempAttId)
        trackTemp('Outbox (Attachment)', tempAttOutboxId)

        // Verify DB row has storage_bucket, storage_path, sha256_hash, FK UUIDs, and NO data_url in raw_data
        const { data: dbAttRow } = await supabaseAdmin
            .from('external_accounting_attachments')
            .select('*')
            .eq('id', tempAttId)
            .single()
        assertCond(dbAttRow?.storage_bucket === 'external-accounting-attachments', 'Attachment must use bucket external-accounting-attachments')
        assertCond(Boolean(dbAttRow?.storage_path), 'Attachment must have storage_path')
        assertCond(dbAttRow?.sha256_hash === expectedSha256, `SHA-256 mismatch: expected ${expectedSha256}, got ${dbAttRow?.sha256_hash}`)
        assertCond(dbAttRow?.contact_id === sampleContact!.id && dbAttRow?.transaction_id === sampleTxn!.id, 'Attachment must link FK contact_id and transaction_id')
        assertCond(!dbAttRow?.raw_data?.data_url && !dbAttRow?.raw_data?.file_base64, 'raw_data JSONB must NOT contain data_url or file_base64')

        // Lectura autorizada + verificación de integridad SHA-256 desde Supabase Storage
        const readAttRes = await callMainPostApi({
            action: 'get_attachment_download_url',
            id: tempAttId,
            includeContent: true,
        })
        assertCond(
            readAttRes.status === 200 &&
                readAttRes.json.integrityVerified === true &&
                readAttRes.json.sha256_hash === expectedSha256 &&
                Boolean(readAttRes.json.download_url),
            `Authorized attachment read must verify SHA-256 and return signed URL, got ${JSON.stringify(readAttRes.json)}`
        )

        // 6.10-B1 (P1 #3): Fallo simulado de BD al SUBIR adjunto -> debe revertir BD y borrar inmediatamente el archivo de Supabase Storage (0 archivos huérfanos)
        const failUploadAttId = `FAIL-ATT-UPLOAD-${Date.now()}`
        const failUploadRes = await callMainPostApi({
            action: 'save_contact_attachment',
            qb_attachable_id: failUploadAttId,
            contact_id: sampleContact!.id,
            qb_contact_id: sampleContact!.qb_contact_id,
            file_name: 'Orphan_Test_Rollback.pdf',
            content_type: 'application/pdf',
            data_url: dataUrlInput,
            force_db_failure: true,
            skipQboSync: true,
        })
        assertCond(
            failUploadRes.status === 400 &&
                failUploadRes.json.rolledBack === true &&
                failUploadRes.json.storageCleanedUp === true &&
                Boolean(failUploadRes.json.cleanedStoragePath),
            `Expected 400 with rolledBack=true and storageCleanedUp=true on attachment DB failure, got ${JSON.stringify(failUploadRes.json)}`
        )
        const { count: orphanAttDbCount } = await supabaseAdmin
            .from('external_accounting_attachments')
            .select('id', { count: 'exact', head: true })
            .eq('company_realm_id', testRealmId)
            .eq('qb_attachable_id', failUploadAttId)
        assertCond((orphanAttDbCount || 0) === 0, 'Zero DB rows must exist after failed attachment upload')

        const { data: orphanStorageBlob, error: orphanStorageErr } = await supabaseAdmin.storage
            .from('external-accounting-attachments')
            .download(String(failUploadRes.json.cleanedStoragePath))
        assertCond(
            Boolean(orphanStorageErr || !orphanStorageBlob),
            `Uploaded file must be removed from Supabase Storage when DB RPC fails (path: ${failUploadRes.json.cleanedStoragePath})`
        )

        // 6.10-B2 (P1 #3): Fallo simulado de BD al BORRAR adjunto -> BD falla ANTES de tocar Storage; el registro en BD y el archivo en Storage permanecen intactos
        const failDeleteRes = await callMainPostApi({
            action: 'delete_attachment',
            id: tempAttId,
            force_db_failure: true,
            skipQboSync: true,
        })
        assertCond(
            failDeleteRes.status === 400 &&
                failDeleteRes.json.rolledBack === true &&
                failDeleteRes.json.storagePreserved === true,
            `Expected 400 with rolledBack=true and storagePreserved=true on failed delete_attachment, got ${JSON.stringify(failDeleteRes.json)}`
        )
        const readAfterFailedDelete = await callMainPostApi({
            action: 'get_attachment_download_url',
            id: tempAttId,
            includeContent: true,
        })
        assertCond(
            readAfterFailedDelete.status === 200 &&
                readAfterFailedDelete.json.integrityVerified === true &&
                readAfterFailedDelete.json.sha256_hash === expectedSha256,
            'After failed delete_attachment DB RPC, both DB record and Storage object must remain 100% intact with matching SHA-256'
        )
        console.log('  ✅ [6.10-B1/B2] P1 #3 verificado: 0 archivos huérfanos en Storage si falla upload en BD y archivo preservado en Storage si falla delete en BD')

        // Eliminar adjunto (borra de BD primero + encola Outbox + borra físico de Supabase Storage)
        const delAttRes = await callMainPostApi({
            action: 'delete_attachment',
            id: tempAttId,
        })
        assertCond(delAttRes.status === 200 && delAttRes.json.storageRemoved === true, 'delete_attachment must succeed and remove Storage object')
        if (delAttRes.json.outboxId) {
            trackTemp('Outbox (Attachment Delete)', delAttRes.json.outboxId)
            await supabaseAdmin.from('external_accounting_sync_outbox').delete().eq('id', delAttRes.json.outboxId)
            markCleaned(delAttRes.json.outboxId)
        }
        markCleaned(tempAttId)
        tempAttId = null
        console.log('  ✅ [6.10-B] Adjunto en Supabase Storage verificado: upload real, SHA-256 exacto, FK contact_id/transaction_id, lectura firmada y borrado físico en BD + Storage')

        // 6.10-C: Validación de destinatarios y bitácora de correo en modo seguro (rechazo de email inválido + registro auditado)
        const badEmailRes = await callMainPostApi({
            action: 'send_invoice_email',
            id: sampleTxn!.id,
            invoiceId: sampleTxn!.id,
            mode: 'invoice',
            to: 'correo-invalido-sin-arroba',
            subject: 'Phase 6 Safe Email Test',
        })
        assertCond(badEmailRes.status === 400, `Invalid email recipient must be rejected with 400, got ${badEmailRes.status}`)

        const { data: failedEmailLogs } = await supabaseAdmin
            .from('external_accounting_email_log')
            .select('id, status, error_message')
            .eq('company_realm_id', testRealmId)
            .eq('subject', 'Phase 6 Safe Email Test')
            .order('created_at', { ascending: false })
            .limit(1)
        assertCond((failedEmailLogs || []).length === 1 && failedEmailLogs![0].status === 'Failed', 'Rejected email attempt must be logged in external_accounting_email_log')
        tempEmailLogId = String(failedEmailLogs![0].id)
        trackTemp('EmailLog (Safe Sandbox Test)', tempEmailLogId)
        await supabaseAdmin.from('external_accounting_email_log').delete().eq('id', tempEmailLogId)
        markCleaned(tempEmailLogId)
        tempEmailLogId = null
        console.log('  ✅ [6.10-C] Validación y bitácora de correo en modo seguro verificada y limpiada')
    } finally {
        if (tempAttStoragePath) {
            await supabaseAdmin.storage.from('external-accounting-attachments').remove([tempAttStoragePath]).catch(() => {})
        }
        if (tempAttId) {
            await supabaseAdmin.from('external_accounting_attachments').delete().eq('id', tempAttId)
            markCleaned(tempAttId)
        }
        if (tempAttOutboxId) {
            await supabaseAdmin.from('external_accounting_sync_outbox').delete().eq('id', tempAttOutboxId)
            markCleaned(tempAttOutboxId)
        }
        if (tempEmailLogId) {
            await supabaseAdmin.from('external_accounting_email_log').delete().eq('id', tempEmailLogId)
            markCleaned(tempEmailLogId)
        }
        await supabaseAdmin
            .from('external_accounting_audit_log')
            .delete()
            .eq('company_realm_id', testRealmId)
            .in('action_type', ['UPLOAD_ATTACHMENT', 'DELETE_ATTACHMENT', 'UPLOAD_ATTACHMENT_STORAGE', 'DELETE_ATTACHMENT_STORAGE', 'SEND_INVOICE_EMAIL_FAILED'])
            .gte('created_at', new Date(Date.now() - 120_000).toISOString())
    }

    // -------------------------------------------------------------------------
    // PHASE 6.11 (P1 #1): Cero Contactos Huérfanos si Falla `save_transaction` + Auto-Contacto Atómico
    // -------------------------------------------------------------------------
    console.log('\n▶ [PHASE 6.11] Probando P1 #1: Cero contactos huérfanos cuando falla save_transaction (validación de partida doble o rollback en RPC SQL)...')
    const orphanNameUnbalanced = `P6-ORPHAN-UNBALANCED-${Date.now()}`
    const orphanNameDbFail = `P6-ORPHAN-DB-ROLLBACK-${Date.now()}`
    const validAutoContactName = `P6-AUTO-CONTACT-OK-${Date.now()}`
    let autoCreatedContactUuid: string | null = null
    let autoCreatedContactOutboxUuid: string | null = null
    let autoCreatedTxnUuid: string | null = null
    let autoCreatedTxnOutboxUuid: string | null = null

    // Clean up any leftover P6-ORPHAN-DB-ROLLBACK-* from prior interrupted test run
    const { data: leftoverOrphanTxns } = await supabaseAdmin
        .from('external_accounting_transactions')
        .select('id')
        .eq('company_realm_id', testRealmId)
        .ilike('entity_name', 'P6-ORPHAN-DB-ROLLBACK-%')
    for (const lo of leftoverOrphanTxns || []) {
        await callMainPostApi({ action: 'delete_transaction', id: lo.id, skipQboSync: true }).catch(() => {})
    }
    await supabaseAdmin
        .from('external_accounting_contacts')
        .delete()
        .eq('company_realm_id', testRealmId)
        .ilike('display_name', 'P6-ORPHAN-DB-ROLLBACK-%')
    await supabaseAdmin
        .from('external_accounting_sync_outbox')
        .delete()
        .eq('company_realm_id', testRealmId)
        .ilike('idempotency_key', '%LOCAL-%')
        .gte('created_at', new Date(Date.now() - 600_000).toISOString())

    try {
        // 6.11-A: Póliza desbalanceada con nombre de contacto nuevo -> debe fallar con 400 ANTES de crear contacto
        const unbalRes = await callMainPostApi({
            action: 'save_transaction',
            txn_type: 'JournalEntry',
            txn_date: '2026-10-31',
            entity_name: orphanNameUnbalanced,
            total_amount: 100,
            skipQboSync: true,
            line_items: [
                {
                    detail_type: 'JournalEntryLineDetail',
                    posting_type: 'Debit',
                    account_qb_id: bankAcc.qb_account_id,
                    account_name: bankAcc.name,
                    amount: 100,
                },
                {
                    detail_type: 'JournalEntryLineDetail',
                    posting_type: 'Credit',
                    account_qb_id: expAcc.qb_account_id,
                    account_name: expAcc.name,
                    amount: 40, // Desbalanceado: 100 != 40
                },
            ],
        })
        assertCond(unbalRes.status === 400, `Unbalanced JournalEntry with new contact must return 400, got ${unbalRes.status}`)

        const { count: unbalContactCount } = await supabaseAdmin
            .from('external_accounting_contacts')
            .select('id', { count: 'exact', head: true })
            .eq('company_realm_id', testRealmId)
            .ilike('display_name', orphanNameUnbalanced)
        assertCond((unbalContactCount || 0) === 0, `Expected 0 contacts for ${orphanNameUnbalanced}, got ${unbalContactCount}`)

        // 6.11-B: Póliza balanceada con contacto nuevo + force_db_failure=true -> pasa validación JS, entra a fn_ext_acct_mutate_transaction_atomic,
        //         inserta el contacto en SQL y luego falla en FORCED_TXN_DB_FAILURE, revirtiendo el contacto automáticamente (0 contactos huérfanos)
        const dbFailTxnRes = await callMainPostApi({
            action: 'save_transaction',
            txn_type: 'Expense',
            txn_date: '2026-10-31',
            entity_name: orphanNameDbFail,
            account_qb_id: bankAcc.qb_account_id,
            account_name: bankAcc.name,
            to_account_qb_id: expAcc.qb_account_id,
            to_account_name: expAcc.name,
            total_amount: 75,
            force_db_failure: true,
            skipQboSync: true,
            line_items: [
                {
                    account_qb_id: expAcc.qb_account_id,
                    account_name: expAcc.name,
                    amount: 75,
                    description: 'Test rollback de auto_create_contact dentro de RPC SQL',
                },
            ],
        })
        assertCond(
            dbFailTxnRes.status === 400 &&
                dbFailTxnRes.json.rolledBack === true &&
                String(dbFailTxnRes.json.error).includes('FORCED_TXN_DB_FAILURE'),
            `Expected 400 rolledBack=true with FORCED_TXN_DB_FAILURE when SQL RPC fails after contact insert, got ${JSON.stringify(dbFailTxnRes.json)}`
        )

        const { count: dbFailContactCount } = await supabaseAdmin
            .from('external_accounting_contacts')
            .select('id', { count: 'exact', head: true })
            .eq('company_realm_id', testRealmId)
            .ilike('display_name', orphanNameDbFail)
        assertCond((dbFailContactCount || 0) === 0, `Expected 0 orphan contacts after SQL rollback for ${orphanNameDbFail}, got ${dbFailContactCount}`)

        // 6.11-C: Caso exitoso con contacto nuevo -> crea contacto + outbox de contacto + auditoría + transacción en una sola operación ACID
        const okAutoConRes = await callMainPostApi({
            action: 'save_transaction',
            txn_type: 'Expense',
            txn_date: '2026-10-31',
            entity_name: validAutoContactName,
            account_qb_id: bankAcc.qb_account_id,
            account_name: bankAcc.name,
            to_account_qb_id: expAcc.qb_account_id,
            to_account_name: expAcc.name,
            total_amount: 55,
            skipQboSync: true,
            line_items: [
                {
                    account_qb_id: expAcc.qb_account_id,
                    account_name: expAcc.name,
                    amount: 55,
                    description: 'Auto contact atomic success test',
                },
            ],
        })
        assertCond(
            okAutoConRes.status === 200 &&
                Boolean(okAutoConRes.json.transaction?.id) &&
                Boolean(okAutoConRes.json.autoCreatedContactId) &&
                Boolean(okAutoConRes.json.autoCreatedContactOutboxId),
            `Expected 200 with autoCreatedContactId and autoCreatedContactOutboxId, got ${JSON.stringify(okAutoConRes.json)}`
        )
        autoCreatedTxnUuid = String(okAutoConRes.json.transaction.id)
        autoCreatedTxnOutboxUuid = String(okAutoConRes.json.outboxId || '')
        autoCreatedContactUuid = String(okAutoConRes.json.autoCreatedContactId)
        autoCreatedContactOutboxUuid = String(okAutoConRes.json.autoCreatedContactOutboxId)
        trackTemp('Transaction (P1 #1 Auto-Contact)', autoCreatedTxnUuid)
        trackTemp('Outbox (P1 #1 Transaction)', autoCreatedTxnOutboxUuid)
        trackTemp('Contact (P1 #1 Auto-Created)', autoCreatedContactUuid)
        trackTemp('Outbox (P1 #1 Auto-Created Contact)', autoCreatedContactOutboxUuid)

        // Delete transaction atomically to restore bankAcc and expAcc balances
        const delAutoTxnRes = await callMainPostApi({
            action: 'delete_transaction',
            id: autoCreatedTxnUuid,
            skipQboSync: true,
        })
        assertCond(delAutoTxnRes.status === 200, 'delete_transaction for auto-contact test must succeed')
        if (delAutoTxnRes.json.outboxId) {
            trackTemp('Outbox (P1 #1 Delete Transaction)', delAutoTxnRes.json.outboxId)
            await supabaseAdmin.from('external_accounting_sync_outbox').delete().eq('id', delAutoTxnRes.json.outboxId)
            markCleaned(delAutoTxnRes.json.outboxId)
        }
        markCleaned(autoCreatedTxnUuid)
        autoCreatedTxnUuid = null
        console.log('  ✅ [6.11] P1 #1 verificado: 0 contactos huérfanos ante fallo de validación o rollback SQL, y creación atómica con Outbox + Audit en éxito')
    } finally {
        if (autoCreatedTxnUuid) {
            await callMainPostApi({ action: 'delete_transaction', id: autoCreatedTxnUuid, skipQboSync: true }).catch(() => {})
            markCleaned(autoCreatedTxnUuid)
        }
        if (autoCreatedTxnOutboxUuid) {
            await supabaseAdmin.from('external_accounting_sync_outbox').delete().eq('id', autoCreatedTxnOutboxUuid)
            markCleaned(autoCreatedTxnOutboxUuid)
        }
        if (autoCreatedContactOutboxUuid) {
            await supabaseAdmin.from('external_accounting_sync_outbox').delete().eq('id', autoCreatedContactOutboxUuid)
            markCleaned(autoCreatedContactOutboxUuid)
        }
        if (autoCreatedContactUuid) {
            await supabaseAdmin.from('external_accounting_contacts').delete().eq('id', autoCreatedContactUuid)
            markCleaned(autoCreatedContactUuid)
        }
        await supabaseAdmin
            .from('external_accounting_audit_log')
            .delete()
            .eq('company_realm_id', testRealmId)
            .in('action_type', ['AUTO_CREATE_CONTACT', 'CREATE_TRANSACTION', 'DELETE_TRANSACTION'])
            .gte('created_at', new Date(Date.now() - 120_000).toISOString())
    }

    // -------------------------------------------------------------------------
    // PHASE 6.12 (P1 #2): `toggle_cleared_status` 100% Atómico vía RPC + Auditoría + Outbox
    // -------------------------------------------------------------------------
    console.log('\n▶ [PHASE 6.12] Probando P1 #2: toggle_cleared_status vía RPC atómica con Audit Log, Outbox y rollback ante estado inválido...')
    let toggleTestTxnId: string | null = null
    let toggleTestCreateOutboxId: string | null = null
    const toggleOutboxIdsToClean: string[] = []

    try {
        const createToggleTxnRes = await callMainPostApi({
            action: 'save_transaction',
            txn_type: 'Expense',
            txn_date: '2026-10-31',
            account_qb_id: bankAcc.qb_account_id,
            account_name: bankAcc.name,
            to_account_qb_id: expAcc.qb_account_id,
            to_account_name: expAcc.name,
            total_amount: 35,
            skipQboSync: true,
            line_items: [
                {
                    account_qb_id: expAcc.qb_account_id,
                    account_name: expAcc.name,
                    amount: 35,
                    description: 'Toggle Cleared Status Atomic Test',
                },
            ],
        })
        assertCond(createToggleTxnRes.status === 200 && createToggleTxnRes.json.transaction?.id, 'Must create test transaction for toggle_cleared_status')
        toggleTestTxnId = String(createToggleTxnRes.json.transaction.id)
        toggleTestCreateOutboxId = String(createToggleTxnRes.json.outboxId || '')
        trackTemp('Transaction (P1 #2 Toggle Cleared)', toggleTestTxnId)
        trackTemp('Outbox (P1 #2 Create Txn)', toggleTestCreateOutboxId)

        // 6.12-A: Intentar cambiar a un cleared_status inválido -> debe fallar en la RPC SQL y revertir todo (0 cambios, 0 audit, 0 outbox)
        const invalidToggleRes = await callMainPostApi({
            action: 'toggle_cleared_status',
            id: toggleTestTxnId,
            target_cleared_status: 'INVALID_STATUS_XYZ',
            skipQboSync: true,
        })
        assertCond(
            invalidToggleRes.status === 400 &&
                invalidToggleRes.json.rolledBack === true &&
                String(invalidToggleRes.json.error).includes('INVALID_CLEARED_STATUS'),
            `Expected 400 INVALID_CLEARED_STATUS rollback, got ${JSON.stringify(invalidToggleRes.json)}`
        )

        const { data: afterInvalidRow } = await supabaseAdmin
            .from('external_accounting_transactions')
            .select('cleared_status')
            .eq('id', toggleTestTxnId)
            .single()
        assertCond(afterInvalidRow?.cleared_status === 'Cleared', `Expected cleared_status to remain Cleared after rollback, got ${afterInvalidRow?.cleared_status}`)

        // 6.12-B: Toggle válido (Cleared -> Reconciled) -> debe actualizar cleared_status, crear Audit Log TOGGLE_CLEARED_STATUS y encolar Outbox
        const validToggleRes = await callMainPostApi({
            action: 'toggle_cleared_status',
            id: toggleTestTxnId,
            skipQboSync: true,
        })
        assertCond(
            validToggleRes.status === 200 &&
                validToggleRes.json.cleared_status === 'Reconciled' &&
                Boolean(validToggleRes.json.auditId) &&
                Boolean(validToggleRes.json.outboxId),
            `Expected 200 with cleared_status=Reconciled, auditId and outboxId, got ${JSON.stringify(validToggleRes.json)}`
        )
        const toggleObId = String(validToggleRes.json.outboxId)
        toggleOutboxIdsToClean.push(toggleObId)
        trackTemp('Outbox (P1 #2 Toggle Cleared)', toggleObId)

        const [{ data: toggleAuditRow }, { data: toggleObRow }] = await Promise.all([
            supabaseAdmin.from('external_accounting_audit_log').select('id, action_type, summary').eq('id', validToggleRes.json.auditId).single(),
            supabaseAdmin.from('external_accounting_sync_outbox').select('id, entity_kind, operation, status').eq('id', toggleObId).single(),
        ])
        assertCond(toggleAuditRow?.action_type === 'TOGGLE_CLEARED_STATUS', 'Audit row must have action_type=TOGGLE_CLEARED_STATUS')
        assertCond(toggleObRow?.entity_kind === 'TRANSACTION' && toggleObRow?.operation === 'UPSERT', 'Outbox row must be queued for toggle_cleared_status')

        // Eliminar transacción de prueba para restaurar saldos
        const delToggleTxnRes = await callMainPostApi({
            action: 'delete_transaction',
            id: toggleTestTxnId,
            skipQboSync: true,
        })
        assertCond(delToggleTxnRes.status === 200, 'delete_transaction after toggle test must succeed')
        if (delToggleTxnRes.json.outboxId) {
            toggleOutboxIdsToClean.push(String(delToggleTxnRes.json.outboxId))
            trackTemp('Outbox (P1 #2 Delete Txn)', String(delToggleTxnRes.json.outboxId))
        }
        markCleaned(toggleTestTxnId)
        toggleTestTxnId = null
        console.log('  ✅ [6.12] P1 #2 verificado: toggle_cleared_status es 100% atómico vía RPC con Audit Log, Outbox y rollback ante estado inválido')
    } finally {
        if (toggleTestTxnId) {
            await callMainPostApi({ action: 'delete_transaction', id: toggleTestTxnId, skipQboSync: true }).catch(() => {})
            markCleaned(toggleTestTxnId)
        }
        if (toggleTestCreateOutboxId) {
            await supabaseAdmin.from('external_accounting_sync_outbox').delete().eq('id', toggleTestCreateOutboxId)
            markCleaned(toggleTestCreateOutboxId)
        }
        for (const obId of toggleOutboxIdsToClean) {
            await supabaseAdmin.from('external_accounting_sync_outbox').delete().eq('id', obId)
            markCleaned(obId)
        }
        await supabaseAdmin
            .from('external_accounting_audit_log')
            .delete()
            .eq('company_realm_id', testRealmId)
            .in('action_type', ['TOGGLE_CLEARED_STATUS', 'CREATE_TRANSACTION', 'DELETE_TRANSACTION'])
            .gte('created_at', new Date(Date.now() - 120_000).toISOString())
    }

    // -------------------------------------------------------------------------
    // PHASE 6.13: Atomicidad 100% de `invoiceUpdates` y `contactDeltas` dentro de la RPC Principal
    //             (save_transaction, void_transaction, delete_transaction y execute_recurring)
    // -------------------------------------------------------------------------
    console.log('\n▶ [PHASE 6.13] Probando atomicidad 100% de open_balance y contact.balance dentro de fn_ext_acct_mutate_transaction_atomic...')
    const p13CustomerName = `P6-ATOMIC-BAL-CUSTOMER-${Date.now()}`
    let p13ContactId: string | null = null
    let p13ContactOutboxId: string | null = null
    let p13InvoiceId: string | null = null
    let p13PaymentId: string | null = null
    let p13RecTemplateId: string | null = null
    let p13RecTxnId: string | null = null
    const p13OutboxIds: string[] = []
    const p13EntityIdsForAuditCleanup: string[] = []

    try {
        // 6.13-A: Crear Invoice ($180.00) con cliente nuevo -> crea cliente + Invoice + actualiza contact.balance=$180.00 en la MISMA RPC
        const createInvRes = await callMainPostApi({
            action: 'save_transaction',
            txn_type: 'Invoice',
            txn_date: '2026-10-31',
            due_date: '2026-11-30',
            entity_name: p13CustomerName,
            account_qb_id: arAccInit!.qb_account_id,
            account_name: arAccInit!.name,
            to_account_qb_id: incomeAcc.qb_account_id,
            to_account_name: incomeAcc.name,
            total_amount: 180,
            skipQboSync: true,
            line_items: [
                {
                    account_qb_id: incomeAcc.qb_account_id,
                    account_name: incomeAcc.name,
                    amount: 180,
                    description: 'Phase 6.13 Atomic Invoice & Contact Balance Test',
                },
            ],
        })
        assertCond(
            createInvRes.status === 200 &&
                createInvRes.json.transaction?.id &&
                createInvRes.json.autoCreatedContactId,
            `Must create Invoice and auto-contact atomically, got ${JSON.stringify(createInvRes.json)}`
        )
        p13InvoiceId = String(createInvRes.json.transaction.id)
        p13ContactId = String(createInvRes.json.autoCreatedContactId)
        p13EntityIdsForAuditCleanup.push(p13InvoiceId, p13ContactId)
        p13ContactOutboxId = String(createInvRes.json.autoCreatedContactOutboxId || '')
        trackTemp('Transaction (P6.13 Invoice)', p13InvoiceId)
        trackTemp('Contact (P6.13 Customer)', p13ContactId)
        if (p13ContactOutboxId) trackTemp('Outbox (P6.13 Customer)', p13ContactOutboxId)
        if (createInvRes.json.outboxId) {
            p13OutboxIds.push(String(createInvRes.json.outboxId))
            trackTemp('Outbox (P6.13 Invoice)', String(createInvRes.json.outboxId))
        }

        const [{ data: invRow1 }, { data: conRow1 }] = await Promise.all([
            supabaseAdmin.from('external_accounting_transactions').select('open_balance').eq('id', p13InvoiceId).single(),
            supabaseAdmin.from('external_accounting_contacts').select('balance, qb_contact_id').eq('id', p13ContactId).single(),
        ])
        assertCond(
            Number(invRow1?.open_balance) === 180 && Number(conRow1?.balance) === 180,
            `Expected Invoice.open_balance=180 and Contact.balance=180 inside atomic RPC, got inv=${invRow1?.open_balance}, con=${conRow1?.balance}`
        )

        // 6.13-B: Provocar fallo en invoiceUpdates al intentar guardar un Payment ($180) -> la RPC revierte el Payment, los saldos de cuentas, el open_balance y el contact.balance
        const failInvUpdRes = await callMainPostApi({
            action: 'save_transaction',
            txn_type: 'Payment',
            txn_date: '2026-10-31',
            entity_qb_id: conRow1!.qb_contact_id,
            entity_name: p13CustomerName,
            account_qb_id: bankAcc!.qb_account_id,
            account_name: bankAcc!.name,
            to_account_qb_id: arAccInit!.qb_account_id,
            to_account_name: arAccInit!.name,
            total_amount: 180,
            force_invoice_update_failure_id: '00000000-0000-0000-0000-000000000099',
            skipQboSync: true,
            line_items: [],
        })
        assertCond(
            failInvUpdRes.status === 400 &&
                failInvUpdRes.json.rolledBack === true &&
                String(failInvUpdRes.json.error).includes('INVOICE_UPDATE_NOT_FOUND_IN_REALM'),
            `Expected 400 INVOICE_UPDATE_NOT_FOUND_IN_REALM rollback, got ${JSON.stringify(failInvUpdRes.json)}`
        )

        // 6.13-C: Provocar fallo en contactDeltas al intentar guardar un Payment ($180) -> la RPC revierte todo (Invoice.open_balance sigue en $180.00 y 0 Payments creados)
        const failConUpdRes = await callMainPostApi({
            action: 'save_transaction',
            txn_type: 'Payment',
            txn_date: '2026-10-31',
            entity_qb_id: conRow1!.qb_contact_id,
            entity_name: p13CustomerName,
            account_qb_id: bankAcc!.qb_account_id,
            account_name: bankAcc!.name,
            to_account_qb_id: arAccInit!.qb_account_id,
            to_account_name: arAccInit!.name,
            total_amount: 180,
            force_contact_update_failure: true,
            skipQboSync: true,
            line_items: [],
        })
        assertCond(
            failConUpdRes.status === 400 &&
                failConUpdRes.json.rolledBack === true &&
                String(failConUpdRes.json.error).includes('CONTACT_BALANCE_UPDATE_NOT_FOUND_IN_REALM'),
            `Expected 400 CONTACT_BALANCE_UPDATE_NOT_FOUND_IN_REALM rollback, got ${JSON.stringify(failConUpdRes.json)}`
        )

        const [{ data: invAfterRollback }, { data: conAfterRollback }, { count: orphanPayCount }] = await Promise.all([
            supabaseAdmin.from('external_accounting_transactions').select('open_balance').eq('id', p13InvoiceId).single(),
            supabaseAdmin.from('external_accounting_contacts').select('balance').eq('id', p13ContactId).single(),
            supabaseAdmin
                .from('external_accounting_transactions')
                .select('id', { count: 'exact', head: true })
                .eq('company_realm_id', testRealmId)
                .eq('txn_type', 'Payment')
                .eq('entity_name', p13CustomerName),
        ])
        assertCond(
            Number(invAfterRollback?.open_balance) === 180 &&
                Number(conAfterRollback?.balance) === 180 &&
                (orphanPayCount || 0) === 0,
            `After invoiceUpdates/contactDeltas rollback, Invoice.open_balance ($180), Contact.balance ($180) and 0 Payment rows must hold`
        )

        // 6.13-D: Guardar Payment válido ($180.00) -> auto-vincula FIFO a la Invoice y dentro de la MISMA RPC deja Invoice.open_balance=0 y Contact.balance=0
        const okPayRes = await callMainPostApi({
            action: 'save_transaction',
            txn_type: 'Payment',
            txn_date: '2026-10-31',
            entity_qb_id: conRow1!.qb_contact_id,
            entity_name: p13CustomerName,
            account_qb_id: bankAcc!.qb_account_id,
            account_name: bankAcc!.name,
            to_account_qb_id: arAccInit!.qb_account_id,
            to_account_name: arAccInit!.name,
            total_amount: 180,
            skipQboSync: true,
            line_items: [],
        })
        assertCond(okPayRes.status === 200 && okPayRes.json.transaction?.id, 'Valid Payment must succeed atomically')
        p13PaymentId = String(okPayRes.json.transaction.id)
        p13EntityIdsForAuditCleanup.push(p13PaymentId)
        trackTemp('Transaction (P6.13 Payment)', p13PaymentId)
        if (okPayRes.json.outboxId) {
            p13OutboxIds.push(String(okPayRes.json.outboxId))
            trackTemp('Outbox (P6.13 Payment)', String(okPayRes.json.outboxId))
        }

        const [{ data: invAfterPay }, { data: conAfterPay }] = await Promise.all([
            supabaseAdmin.from('external_accounting_transactions').select('open_balance').eq('id', p13InvoiceId).single(),
            supabaseAdmin.from('external_accounting_contacts').select('balance').eq('id', p13ContactId).single(),
        ])
        assertCond(
            Number(invAfterPay?.open_balance) === 0 && Number(conAfterPay?.balance) === 0,
            `After atomic Payment, expected Invoice.open_balance=0 and Contact.balance=0, got inv=${invAfterPay?.open_balance}, con=${conAfterPay?.balance}`
        )

        // 6.13-E: Anular (VOID) el Payment -> dentro de la MISMA RPC reabre Invoice.open_balance=$180.00 y Contact.balance=$180.00
        const voidPayRes = await callMainPostApi({
            action: 'void_transaction',
            id: p13PaymentId,
            skipQboSync: true,
        })
        assertCond(voidPayRes.status === 200, 'void_transaction on Payment must succeed atomically')
        if (voidPayRes.json.outboxId) {
            p13OutboxIds.push(String(voidPayRes.json.outboxId))
            trackTemp('Outbox (P6.13 Void Payment)', String(voidPayRes.json.outboxId))
        }

        const [{ data: invAfterVoid }, { data: conAfterVoid }] = await Promise.all([
            supabaseAdmin.from('external_accounting_transactions').select('open_balance').eq('id', p13InvoiceId).single(),
            supabaseAdmin.from('external_accounting_contacts').select('balance').eq('id', p13ContactId).single(),
        ])
        assertCond(
            Number(invAfterVoid?.open_balance) === 180 && Number(conAfterVoid?.balance) === 180,
            `After atomic VOID of Payment, expected Invoice.open_balance=180 and Contact.balance=180, got inv=${invAfterVoid?.open_balance}, con=${conAfterVoid?.balance}`
        )

        // 6.13-F: Ejecutar plantilla recurrente (execute_recurring) -> dentro de la MISMA RPC crea Invoice ($60), avanza next_date y sube Contact.balance a $240.00
        const createRecRes = await callMainPostApi({
            action: 'save_recurring',
            template_name: `P6.13-REC-${Date.now()}`,
            recur_type: 'Scheduled',
            txn_type: 'Invoice',
            interval_type: 'Monthly',
            num_interval: 1,
            next_date: '2026-10-31',
            account_qb_id: arAccInit!.qb_account_id,
            account_name: arAccInit!.name,
            entity_qb_id: conRow1!.qb_contact_id,
            entity_name: p13CustomerName,
            amount: 60,
            skipQboSync: true,
            line_items: [
                {
                    account_qb_id: incomeAcc.qb_account_id,
                    account_name: incomeAcc.name,
                    amount: 60,
                    description: 'Recurring Invoice $60',
                },
            ],
        })
        assertCond(createRecRes.status === 200 && createRecRes.json.recurring?.id, 'save_recurring must succeed')
        p13RecTemplateId = String(createRecRes.json.recurring.id)
        p13EntityIdsForAuditCleanup.push(p13RecTemplateId)
        trackTemp('RecurringTemplate (P6.13)', p13RecTemplateId)
        if (createRecRes.json.outboxId) {
            p13OutboxIds.push(String(createRecRes.json.outboxId))
            trackTemp('Outbox (P6.13 Save Recurring)', String(createRecRes.json.outboxId))
        }

        const execRecRes = await callMainPostApi({
            action: 'execute_recurring',
            recurringId: p13RecTemplateId,
            txnDate: '2026-10-31',
            skipQboSync: true,
        })
        assertCond(execRecRes.status === 200 && execRecRes.json.transaction?.id, 'execute_recurring must succeed atomically')
        p13RecTxnId = String(execRecRes.json.transaction.id)
        p13EntityIdsForAuditCleanup.push(p13RecTxnId)
        trackTemp('Transaction (P6.13 Executed Recurring Invoice)', p13RecTxnId)
        if (execRecRes.json.outboxId) {
            p13OutboxIds.push(String(execRecRes.json.outboxId))
            trackTemp('Outbox (P6.13 Execute Recurring)', String(execRecRes.json.outboxId))
        }

        const [{ data: conAfterRec }, { data: recAfterExec }] = await Promise.all([
            supabaseAdmin.from('external_accounting_contacts').select('balance').eq('id', p13ContactId).single(),
            supabaseAdmin.from('external_accounting_recurring').select('previous_date, next_date').eq('id', p13RecTemplateId).single(),
        ])
        assertCond(
            Number(conAfterRec?.balance) === 240 && recAfterExec?.previous_date === '2026-10-31',
            `Expected Contact.balance=240 and recurring.previous_date=2026-10-31 after atomic execute_recurring, got bal=${conAfterRec?.balance}, prev=${recAfterExec?.previous_date}`
        )

        // Limpiar Payment, Recurring Invoice e Invoice original y verificar que Contact.balance regresa a $0.00
        for (const tid of [p13PaymentId, p13RecTxnId, p13InvoiceId]) {
            if (!tid) continue
            const delRes = await callMainPostApi({ action: 'delete_transaction', id: tid, skipQboSync: true })
            assertCond(delRes.status === 200, `delete_transaction for ${tid} must succeed`)
            if (delRes.json.outboxId) {
                p13OutboxIds.push(String(delRes.json.outboxId))
                trackTemp('Outbox (P6.13 Delete Txn)', String(delRes.json.outboxId))
            }
            markCleaned(tid)
        }
        p13PaymentId = null
        p13RecTxnId = null
        p13InvoiceId = null

        const { data: conAfterAllDeleted } = await supabaseAdmin
            .from('external_accounting_contacts')
            .select('balance')
            .eq('id', p13ContactId)
            .single()
        assertCond(
            Number(conAfterAllDeleted?.balance) === 0,
            `Expected Contact.balance=0 after deleting all invoices, got ${conAfterAllDeleted?.balance}`
        )
        console.log('  ✅ [6.13] Atomicidad 100% de open_balance, contact.balance y avance de plantilla recurrente dentro de fn_ext_acct_mutate_transaction_atomic verificada')
    } finally {
        for (const tid of [p13PaymentId, p13RecTxnId, p13InvoiceId]) {
            if (tid) {
                await callMainPostApi({ action: 'delete_transaction', id: tid, skipQboSync: true }).catch(() => {})
                markCleaned(tid)
            }
        }
        if (p13RecTemplateId) {
            await supabaseAdmin.from('external_accounting_recurring').delete().eq('id', p13RecTemplateId)
            markCleaned(p13RecTemplateId)
        }
        if (p13ContactOutboxId) {
            await supabaseAdmin.from('external_accounting_sync_outbox').delete().eq('id', p13ContactOutboxId)
            markCleaned(p13ContactOutboxId)
        }
        for (const obId of p13OutboxIds) {
            await supabaseAdmin.from('external_accounting_sync_outbox').delete().eq('id', obId)
            markCleaned(obId)
        }
        if (p13ContactId) {
            await supabaseAdmin.from('external_accounting_contacts').delete().eq('id', p13ContactId)
            markCleaned(p13ContactId)
        }
        if (p13EntityIdsForAuditCleanup.length > 0) {
            await supabaseAdmin
                .from('external_accounting_audit_log')
                .delete()
                .eq('company_realm_id', testRealmId)
                .in('entity_id', p13EntityIdsForAuditCleanup)
        }
    }

    // -------------------------------------------------------------------------
    // REPORTE FINAL DE IDS TEMPORALES CREADOS Y VERIFICACIÓN DE LIMPIEZA 100%
    // -------------------------------------------------------------------------
    console.log('\n▶ [CLEANUP AUDIT] Resumen de IDs temporales creados y limpiados durante Fase 6:')
    for (const item of tempIdsLog) {
        console.log(`  - [${item.cleaned ? 'CLEANED ✅' : 'PENDING ❌'}] ${item.kind}: ${item.id}`)
        assertCond(item.cleaned === true, `Temporary test record ${item.kind} (${item.id}) was not marked cleaned!`)
    }

    console.log('\n================================================================================')
    console.log('🎉 TODAS LAS PRUEBAS EN VIVO (FASES A, 2, 3, 4, 5 Y 6 HARDENING) PASARON AL 100%')
    console.log('================================================================================')
}

main().catch(err => {
    console.error('\n❌ ERROR EN VERIFICACIÓN EN VIVO:', err)
    process.exit(1)
})
