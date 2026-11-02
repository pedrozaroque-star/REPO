/**
 * @module api/external-accounting
 * @description Backend ERP autónomo de Contabilidad Externa para las 8 empresas de Raquel Velazquez, Roberto Velazquez y Roque.
 * Reemplaza al 100% la operación diaria de Intuit QuickBooks Online (Accountant Suite):
 * - Seguridad Fail-Closed en servidor (`authorizeExternalAccounting`): solo `raquel@tacosgavilan.com` (45),
 *   `roberto@tacosgavilan.com` (46) y `roque@tacosgavilan.com` (47).
 * - Aislamiento estricto por `company_realm_id` en todas las lecturas y mutaciones (cero cruces entre empresas).
 * - Lectura completa sin truncamiento de 1,000 filas de PostgREST (`fetchAllCompanyTransactions`).
 * - Paginación real en servidor para el Libro Mayor (`page`, `pageSize`, `totalPages`) y para la Chequera (`checkbookPage`).
 * - Actualización atómica en partida doble (`applyAccountDeltasAtomically`) sin condiciones de carrera ni estados parciales.
 *
 * @businessRules
 * - Todas las operaciones exigen sesión válida (`teg_token`) de Raquel, Roberto o Roque.
 * - `running_balance` se calcula sobre la historia cronológica completa de cada cuenta antes de filtrar por fechas o búsqueda.
 * - Ninguna cuenta o registro de una empresa (`realmId`) puede vincularse o modificarse desde otra empresa.
 *
 * @notes
 * - 2026-10-31 (Fase 6 Hardening):
 *   1) Cobertura ACID 100% mediante RPCs transaccionales en PostgreSQL (`mutateTransactionAtomically`, `batchMutateTransactionsAtomically`,
 *      `saveReconciliationAtomically`, `reopenOrDeleteReconciliationAtomically`, `mutateEntityAtomically`).
 *   2) Outbox obligatorio (`external_accounting_sync_outbox`) en la misma operación lógica local antes de cualquier sincronización QBO;
 *      las empresas con `qbo_sync_enabled=false` registran `SKIPPED_LOCAL_ONLY` y jamás invocan QBO.
 *   3) Adjuntos (`external_accounting_attachments`) almacenan binarios exclusivamente en Supabase Storage (`external-accounting-attachments`)
 *      con `storage_bucket`, `storage_path`, `sha256_hash`, `file_size`, `content_type` y FKs `transaction_id`/`contact_id`, prohibiendo `data_url` en JSONB.
 *   4) Hardening Final de Producción:
 *      - Parámetros de inyección de fallos de prueba (`force_db_failure`, `force_invoice_update_failure_id`, `forceRollbackOnIndex`, etc.)
 *        están bloqueados con HTTP 403 (`TEST_FAULT_INJECTION_FORBIDDEN_IN_PRODUCTION`) cuando `NODE_ENV=production` o `VERCEL_ENV=production`.
 *      - `process_qbo_outbox` impone un tope máximo en servidor (`MAX_MANUAL_OUTBOX_BATCH_LIMIT = 50`) y registra obligatoriamente en
 *        `external_accounting_audit_log` (`PROCESS_QBO_OUTBOX`) quién lo ejecutó, el límite efectivo y el resultado.
 *      - Si al eliminar un adjunto falla el borrado físico en Supabase Storage, se encola una tarea de compensación durable (`STORAGE_CLEANUP`)
 *        en `external_accounting_sync_outbox` más bitácora `ATTACHMENT_STORAGE_CLEANUP_QUEUED`, la cual es ejecutada por el worker hasta limpiar el objeto.
 */

import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  authorizeExternalAccounting,
  fetchAllCompanyTransactions,
  computeTransactionAccountDeltas,
  mergeAccountDeltas,
  applyAccountDeltasAtomically,
  mutateTransactionAtomically,
  batchMutateTransactionsAtomically,
  saveReconciliationAtomically,
  reopenOrDeleteReconciliationAtomically,
  mutateEntityAtomically,
  logExternalAccountingAudit,
} from '@/lib/external-accounting-auth'
import {
  pushTransactionToQbo,
  pushAccountToQbo,
  pushContactToQbo,
  pushListItemToQbo,
  queuePendingQboDelete,
  processSingleOutboxEntry,
  processPendingQboOutbox,
  syncCompanyWithQbo,
  syncAllCompaniesWithQbo,
} from '@/lib/external-accounting-qbo-sync'
import {
  markRawAsLocallyEdited,
  isCreditNormalAccount,
  toNaturalBalance,
  fromNaturalBalance,
  buildLedgerContext,
  validateBalancedTransactionPostings,
} from '@/lib/external-accounting-ledger'
import {
  computeTenantAccountSummary,
  generateQboInvoicePdfBuffer,
  generateQboInvoiceEmailHtml,
  sendQboInvoiceEmail,
  generateQboStatementPdfBuffer,
  generateQboStatementEmailHtml,
  sendQboStatementEmail,
  QboDocumentType,
  QboStatementType,
  QboStatementPdfInput,
  QboInvoicePdfInput,
  QboInvoiceLineItem,
} from '@/lib/external-accounting-invoice-email'

export const dynamic = 'force-dynamic'

function getAdminSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return createClient(url, key, { auth: { persistSession: false } })
}

const EXTERNAL_ACCOUNTING_STORAGE_BUCKET = 'external-accounting-attachments'
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024 // 15 MB strict limit

async function uploadAttachmentToSupabaseStorage(
  supabase: any,
  realmId: string,
  params: {
    fileName: string
    contentType?: string | null
    dataUrl?: string | null
    fileBase64?: string | null
    sizeBytes?: number | null
    clientSha256?: string | null
    allowMetadataOnly?: boolean
  }
): Promise<{
  storageBucket: string | null
  storagePath: string | null
  fileUrl: string | null
  sha256Hash: string | null
  fileSize: number
  contentType: string
}> {
  let resolvedContentType = String(params.contentType || 'application/pdf').trim() || 'application/pdf'
  let binaryBuffer: Buffer | null = null

  if (params.dataUrl && typeof params.dataUrl === 'string') {
    const match = params.dataUrl.match(/^data:([^;]+);base64,(.+)$/i)
    if (match) {
      resolvedContentType = match[1] || resolvedContentType
      binaryBuffer = Buffer.from(match[2], 'base64')
    } else if (params.dataUrl.includes(',')) {
      const b64Part = params.dataUrl.split(',').slice(1).join(',')
      binaryBuffer = Buffer.from(b64Part, 'base64')
    } else {
      binaryBuffer = Buffer.from(params.dataUrl, 'base64')
    }
  } else if (params.fileBase64 && typeof params.fileBase64 === 'string') {
    const cleanB64 = params.fileBase64.replace(/^data:[^;]+;base64,/i, '')
    binaryBuffer = Buffer.from(cleanB64, 'base64')
  }

  const declaredSize = Number(params.sizeBytes || 0)
  if (declaredSize > MAX_ATTACHMENT_BYTES || (binaryBuffer && binaryBuffer.byteLength > MAX_ATTACHMENT_BYTES)) {
    const err: any = new Error(
      `El archivo adjunto excede el tamaño máximo permitido de 15 MB (${MAX_ATTACHMENT_BYTES} bytes).`
    )
    err.statusCode = 413
    throw err
  }

  if (!binaryBuffer || binaryBuffer.byteLength === 0) {
    if (!params.allowMetadataOnly) {
      const err: any = new Error(
        'El contenido binario del archivo adjunto (file_base64 o data_url) es obligatorio y no puede estar vacío.'
      )
      err.statusCode = 400
      throw err
    }
    return {
      storageBucket: null,
      storagePath: null,
      fileUrl: null,
      sha256Hash: null,
      fileSize: declaredSize,
      contentType: resolvedContentType,
    }
  }

  const sha256Hash = crypto.createHash('sha256').update(binaryBuffer).digest('hex')
  if (params.clientSha256 && String(params.clientSha256).trim()) {
    const expected = String(params.clientSha256).trim().toLowerCase()
    if (expected !== sha256Hash.toLowerCase()) {
      const err: any = new Error(
        `Integridad SHA-256 fallida: hash de cliente (${expected.slice(0, 12)}) no coincide con hash recibido (${sha256Hash.slice(0, 12)}).`
      )
      err.statusCode = 400
      throw err
    }
  }
  const actualSize = binaryBuffer.byteLength
  const safeName = String(params.fileName || 'attachment.bin')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120) || 'attachment.bin'
  const storagePath = `${realmId}/${Date.now()}_${sha256Hash.slice(0, 12)}_${safeName}`

  const { error: upErr } = await supabase.storage
    .from(EXTERNAL_ACCOUNTING_STORAGE_BUCKET)
    .upload(storagePath, binaryBuffer, {
      contentType: resolvedContentType,
      upsert: true,
    })

  if (upErr) {
    throw new Error(`Error subiendo adjunto a Supabase Storage (${EXTERNAL_ACCOUNTING_STORAGE_BUCKET}): ${upErr.message}`)
  }

  const { data: signedData } = await supabase.storage
    .from(EXTERNAL_ACCOUNTING_STORAGE_BUCKET)
    .createSignedUrl(storagePath, 60 * 60 * 24 * 7)

  return {
    storageBucket: EXTERNAL_ACCOUNTING_STORAGE_BUCKET,
    storagePath,
    fileUrl: signedData?.signedUrl || null,
    sha256Hash,
    fileSize: actualSize,
    contentType: resolvedContentType,
  }
}

/**
 * Deletes an attachment object from Supabase Storage after its DB row has been atomically removed.
 * If the physical deletion in Storage fails, persists a durable compensation task (`STORAGE_CLEANUP`)
 * in `external_accounting_sync_outbox` and logs `ATTACHMENT_STORAGE_CLEANUP_QUEUED` so the outbox
 * worker retries physical deletion with exponential backoff until no orphaned file remains.
 */
async function removeAttachmentFromStorageOrQueueCompensation(
  supabase: any,
  params: {
    realmId: string
    user: any
    attRow: {
      id: string
      qb_attachable_id?: string | null
      file_name?: string | null
      storage_bucket?: string | null
      storage_path?: string | null
      sha256_hash?: string | null
      file_size?: number | null
      size_bytes?: number | null
    }
    simulateStorageRemoveFailure?: boolean
  }
): Promise<{
  storageRemoved: boolean
  storageCompensationQueued: boolean
  storageCompensationOutboxId: string | null
  storageRemoveError: string | null
}> {
  const { realmId, user, attRow, simulateStorageRemoveFailure } = params
  if (!attRow?.storage_bucket || !attRow?.storage_path) {
    return {
      storageRemoved: false,
      storageCompensationQueued: false,
      storageCompensationOutboxId: null,
      storageRemoveError: null,
    }
  }

  let storageRemoved = false
  let storageRemoveError: string | null = null

  if (simulateStorageRemoveFailure) {
    storageRemoved = false
    storageRemoveError = 'SIMULATED_STORAGE_REMOVE_FAILURE'
  } else {
    try {
      const { error: rmErr } = await supabase.storage
        .from(attRow.storage_bucket)
        .remove([attRow.storage_path])
      if (rmErr) {
        storageRemoved = false
        storageRemoveError = rmErr.message || 'Storage remove failed'
      } else {
        storageRemoved = true
      }
    } catch (ex: any) {
      storageRemoved = false
      storageRemoveError = ex?.message || 'Storage remove exception'
    }
  }

  if (storageRemoved) {
    return {
      storageRemoved: true,
      storageCompensationQueued: false,
      storageCompensationOutboxId: null,
      storageRemoveError: null,
    }
  }

  const nowIso = new Date().toISOString()
  const compIdempotencyKey = `ATT-STORAGE-CLEANUP-${realmId}-${attRow.id}-${Date.now()}`
  const { data: compOutboxRow, error: compOutboxErr } = await supabase
    .from('external_accounting_sync_outbox')
    .insert({
      company_realm_id: realmId,
      entity_kind: 'ATTACHMENT',
      entity_type: 'AttachmentStorageCleanup',
      local_entity_id: attRow.id,
      qb_entity_id: attRow.qb_attachable_id || attRow.id,
      operation: 'STORAGE_CLEANUP',
      idempotency_key: compIdempotencyKey,
      payload: {
        id: attRow.id,
        qb_attachable_id: attRow.qb_attachable_id || attRow.id,
        file_name: attRow.file_name || null,
        storage_bucket: attRow.storage_bucket,
        storage_path: attRow.storage_path,
        sha256_hash: attRow.sha256_hash || null,
        failure_reason: storageRemoveError,
      },
      status: 'PENDING',
      attempts: 0,
      max_attempts: 5,
      last_error: storageRemoveError,
      next_retry_at: nowIso,
      created_by: user.name || user.email,
      updated_at: nowIso,
    })
    .select('id')
    .single()

  if (compOutboxErr || !compOutboxRow?.id) {
    throw new Error(
      `Falló el borrado físico en Storage (${storageRemoveError}) y no se pudo encolar la tarea de compensación: ${compOutboxErr?.message || 'unknown'}`
    )
  }

  const compensationOutboxId = String(compOutboxRow.id)
  await logExternalAccountingAudit(supabase, {
    realmId,
    user,
    actionType: 'ATTACHMENT_STORAGE_CLEANUP_QUEUED',
    entityType: 'AttachmentStorageCleanup',
    entityId: attRow.id,
    amount: Number(attRow.file_size || attRow.size_bytes || 0),
    summary: `Encoló tarea de compensación de Storage (${compensationOutboxId}) tras fallo de borrado físico de "${attRow.storage_path}"`,
    details: {
      compensation_outbox_id: compensationOutboxId,
      storage_bucket: attRow.storage_bucket,
      storage_path: attRow.storage_path,
      failure_reason: storageRemoveError,
    },
  })

  return {
    storageRemoved: false,
    storageCompensationQueued: true,
    storageCompensationOutboxId: compensationOutboxId,
    storageRemoveError,
  }
}

/**
 * Computes the next sequential numeric document number for a given transaction type in a company (e.g. Invoice #3313 -> #3314).
 */
function computeNextSequentialDocNumber(txns: any[], targetType: string, fallbackBase = 1000): string {
  let maxNum = fallbackBase
  for (const t of txns || []) {
    if (t.txn_type === targetType && t.doc_number && /^\d+$/.test(String(t.doc_number).trim())) {
      const n = parseInt(String(t.doc_number).trim(), 10)
      if (n > maxNum && n < 99999999) maxNum = n
    }
  }
  return String(maxNum + 1)
}

/**
 * Fetches all transactions for a specific Customer/Tenant or Vendor within a company,
 * filtering directly in PostgreSQL so it is never truncated by PostgREST's 1,000-row company limit.
 */
async function fetchEntityTransactions(
  supabase: any,
  realmId: string,
  entityQbId: string | null,
  entityName: string,
  txnTypes: string[]
): Promise<any[]> {
  const selectCols =
    'id, qb_txn_id, txn_type, txn_date, due_date, doc_number, total_amount, open_balance, is_voided, memo, entity_qb_id, entity_name, line_items, custom_fields, raw_data'
  const queries: Promise<any>[] = []

  if (entityQbId) {
    queries.push(
      supabase
        .from('external_accounting_transactions')
        .select(selectCols)
        .eq('company_realm_id', realmId)
        .eq('entity_qb_id', String(entityQbId))
        .in('txn_type', txnTypes)
        .order('txn_date', { ascending: true })
        .limit(5000)
    )
  }
  if (entityName) {
    queries.push(
      supabase
        .from('external_accounting_transactions')
        .select(selectCols)
        .eq('company_realm_id', realmId)
        .ilike('entity_name', entityName)
        .in('txn_type', txnTypes)
        .order('txn_date', { ascending: true })
        .limit(5000)
    )
  }

  const results = await Promise.all(queries)
  const byId = new Map<string, any>()
  for (const res of results) {
    for (const row of res.data || []) {
      byId.set(row.id, row)
    }
  }
  return Array.from(byId.values()).sort((a, b) =>
    String(a.txn_date || '').localeCompare(String(b.txn_date || ''))
  )
}

/**
 * Pre-computes all linked Invoice/Bill open_balance adjustments, FIFO payment line-linking,
 * and Customer/Vendor contact balance updates BEFORE calling `mutateTransactionAtomically`,
 * so 100% of the state changes execute inside the single PostgreSQL ACID RPC (`fn_ext_acct_mutate_transaction_atomic`).
 */
async function prepareAtomicEntityAndInvoiceBalancePlan(
  supabase: any,
  realmId: string,
  txn: any,
  opts?: {
    operation?: 'UPSERT' | 'VOID' | 'DELETE'
    existingTxnId?: string | null
    linkedInvoiceIds?: string[]
    wasDeletedOrVoided?: boolean
    forceInvoiceUpdateFailureId?: string | null
    forceContactUpdateFailure?: boolean
  }
): Promise<{
  updatedLineItems: any[]
  selfOpenBalance: number | undefined
  selfRawData: Record<string, any> | undefined
  invoiceUpdates: Array<{ id: string; open_balance: number; raw_data?: Record<string, any> }>
  contactDeltas: Array<{
    id?: string
    qb_contact_id?: string
    display_name?: string
    balance?: number
    delta?: number
    require_found?: boolean
  }>
}> {
  const defaultRes = {
    updatedLineItems: Array.isArray(txn?.line_items) ? txn.line_items : [],
    selfOpenBalance: txn?.open_balance !== undefined ? Number(txn.open_balance) : undefined,
    selfRawData: txn?.raw_data,
    invoiceUpdates: [] as Array<{ id: string; open_balance: number; raw_data?: Record<string, any> }>,
    contactDeltas: [] as Array<{
      id?: string
      qb_contact_id?: string
      display_name?: string
      balance?: number
      delta?: number
      require_found?: boolean
    }>,
  }
  if (!txn) return defaultRes

  const tType = String(txn.txn_type || '')
  const isAr = ['Invoice', 'Payment', 'CreditMemo', 'RefundReceipt'].includes(tType)
  const isAp = ['Bill', 'BillPayment', 'VendorCredit'].includes(tType)
  if (!isAr && !isAp) return defaultRes

  const entityQbId = txn.entity_qb_id ? String(txn.entity_qb_id) : null
  const entityName = String(txn.entity_name || '').trim()
  if (!entityQbId && !entityName) return defaultRes

  const wasDeletedOrVoided = Boolean(
    opts?.wasDeletedOrVoided || opts?.operation === 'VOID' || opts?.operation === 'DELETE'
  )
  const effectiveTxnId = String(opts?.existingTxnId || txn.id || '__PENDING_NEW_TXN__')
  const docType = isAr ? 'Invoice' : 'Bill'
  const payTypes = isAr ? ['Payment', 'CreditMemo'] : ['BillPayment', 'VendorCredit']
  const contactType = isAr ? 'Customer' : 'Vendor'

  const existingEntityRows = await fetchEntityTransactions(supabase, realmId, entityQbId, entityName, [
    docType,
    ...payTypes,
  ])

  const workingLines = Array.isArray(txn.line_items)
    ? txn.line_items.map((l: any) => ({ ...l }))
    : []
  let workingRawData = txn.raw_data && typeof txn.raw_data === 'object' ? { ...txn.raw_data } : {}
  let workingOpenBalance = txn.open_balance !== undefined ? Number(txn.open_balance) : undefined

  // Build simulated post-operation entityRows in memory
  const simulatedRows: any[] = existingEntityRows
    .filter((r: any) => String(r.id) !== effectiveTxnId)
    .map((r: any) => ({
      ...r,
      line_items: Array.isArray(r.line_items) ? r.line_items.map((l: any) => ({ ...l })) : [],
      raw_data: r.raw_data && typeof r.raw_data === 'object' ? { ...r.raw_data } : {},
    }))

  const virtualSelfRow = !wasDeletedOrVoided
    ? {
        ...txn,
        id: effectiveTxnId,
        is_voided: false,
        line_items: workingLines,
        raw_data: workingRawData,
      }
    : null

  if (virtualSelfRow) {
    simulatedRows.push(virtualSelfRow)
  }

  const docs = simulatedRows.filter((r: any) => r.txn_type === docType && !r.is_voided)
  const payments = simulatedRows.filter((r: any) => payTypes.includes(r.txn_type) && !r.is_voided)

  // If saving an active Payment/CreditMemo/BillPayment/VendorCredit, auto-link FIFO if no explicit link lines exist
  if (payTypes.includes(tType) && virtualSelfRow) {
    const explicitIds: string[] = [
      ...(opts?.linkedInvoiceIds || []),
      ...(Array.isArray(virtualSelfRow.custom_fields?.linked_invoice_ids)
        ? virtualSelfRow.custom_fields.linked_invoice_ids
        : []),
      ...workingLines.map((l: any) => l.linked_txn_id).filter(Boolean).map(String),
    ]

    if (explicitIds.length === 0 && (!virtualSelfRow.raw_data?.Line || !Array.isArray(virtualSelfRow.raw_data?.Line))) {
      let remainingToLink = Number(virtualSelfRow.total_amount || 0)
      const openDocs = docs.filter(
        (d: any) =>
          String(d.id) !== effectiveTxnId &&
          Number(d.open_balance ?? d.raw_data?.Balance ?? d.total_amount ?? 0) > 0
      )
      const exactDoc = openDocs.find(
        (d: any) => Math.abs(Number(d.open_balance ?? d.raw_data?.Balance ?? d.total_amount ?? 0) - remainingToLink) < 0.01
      )
      const orderedOpen = exactDoc ? [exactDoc, ...openDocs.filter((d: any) => d.id !== exactDoc.id)] : openDocs

      const newLinkedLines: any[] = []
      for (const d of orderedOpen) {
        if (remainingToLink <= 0.005) break
        const dOpen = Number(d.open_balance ?? d.raw_data?.Balance ?? d.total_amount ?? 0)
        const applyAmt = Math.min(remainingToLink, dOpen)
        if (applyAmt > 0) {
          newLinkedLines.push({
            id: String(newLinkedLines.length + 1),
            line_num: newLinkedLines.length + 1,
            description: `${tType} for ${docType} #${d.doc_number || d.qb_txn_id}`,
            amount: Number(applyAmt.toFixed(2)),
            linked_txn_id: String(d.qb_txn_id || d.id),
            linked_txn_uuid: String(d.id),
            linked_txn_doc_number: d.doc_number || null,
            linked_txn_type: docType,
            detail_type: 'PaymentLineDetail',
          })
          remainingToLink = Number((remainingToLink - applyAmt).toFixed(2))
        }
      }

      if (newLinkedLines.length > 0) {
        workingLines.splice(0, workingLines.length, ...newLinkedLines)
        virtualSelfRow.line_items = workingLines
      }
    }
  }

  const appliedByDocId = new Map<string, number>()
  const addApplied = (docRow: any, amt: number) => {
    if (!docRow || amt <= 0) return
    appliedByDocId.set(docRow.id, Number(((appliedByDocId.get(docRow.id) || 0) + amt).toFixed(2)))
  }

  const findMatchingDoc = (l: any) => {
    if (l?.linked_txn_uuid) {
      const byUuid = docs.find((d: any) => String(d.id) === String(l.linked_txn_uuid).trim())
      if (byUuid) return byUuid
    }
    if (l?.linked_txn_id) {
      const byQbId = docs.find(
        (d: any) => String(d.qb_txn_id) === String(l.linked_txn_id).trim() || String(d.id) === String(l.linked_txn_id).trim()
      )
      if (byQbId) return byQbId
    }
    if (l?.linked_txn_doc_number) {
      const byDocNum = docs.find(
        (d: any) => d.doc_number && String(d.doc_number).trim() === String(l.linked_txn_doc_number).trim()
      )
      if (byDocNum) return byDocNum
    }
    return null
  }

  let unappliedCreditsTotal = 0
  for (const p of payments) {
    const pTotal = Number(p.total_amount || 0)
    let pApplied = 0
    const pLines: any[] = Array.isArray(p.line_items) ? p.line_items : []
    const rawLines: any[] = Array.isArray(p.raw_data?.Line) ? p.raw_data.Line : []
    const customLinkedIds: string[] = Array.isArray(p.custom_fields?.linked_invoice_ids)
      ? p.custom_fields.linked_invoice_ids.map(String)
      : []

    let foundLinkInLines = false
    for (const l of pLines) {
      const hasAnyLinkProp = Boolean(l.linked_txn_id || l.linked_txn_uuid || l.linked_txn_doc_number)
      if (hasAnyLinkProp) {
        foundLinkInLines = true
        const target = findMatchingDoc(l)
        const amt = Number(l.amount || pTotal || 0)
        if (target) {
          addApplied(target, amt)
          if (String(p.id) === effectiveTxnId && target.qb_txn_id && l.linked_txn_id !== String(target.qb_txn_id)) {
            l.linked_txn_id = String(target.qb_txn_id)
          }
          if (String(p.id) === effectiveTxnId && target.id && String(target.id) !== '__PENDING_NEW_TXN__' && !l.linked_txn_uuid) {
            l.linked_txn_uuid = String(target.id)
          }
        }
        pApplied += amt
      }
    }

    if (!foundLinkInLines && rawLines.length > 0) {
      for (const rl of rawLines) {
        const lt = Array.isArray(rl.LinkedTxn) ? rl.LinkedTxn[0] : null
        if (lt?.TxnId) {
          foundLinkInLines = true
          const target = docs.find(
            (d: any) => String(d.qb_txn_id) === String(lt.TxnId) || String(d.id) === String(lt.TxnId)
          )
          const amt = Number(rl.Amount || pTotal || 0)
          if (target) {
            addApplied(target, amt)
          }
          pApplied += amt
        }
      }
    }

    if (!foundLinkInLines && customLinkedIds.length > 0) {
      let rem = pTotal
      for (const cid of customLinkedIds) {
        const target = docs.find(
          (d: any) => String(d.id) === cid || String(d.qb_txn_id) === cid || String(d.doc_number) === cid
        )
        if (target && rem > 0) {
          const amt = Math.min(rem, Number(target.total_amount || 0))
          addApplied(target, amt)
          rem = Number((rem - amt).toFixed(2))
          pApplied += amt
        }
      }
    }

    if (!foundLinkInLines && customLinkedIds.length === 0) {
      unappliedCreditsTotal = Number((unappliedCreditsTotal + pTotal).toFixed(2))
    } else if (pTotal > pApplied + 0.01 && p.raw_data?.UnappliedAmt === undefined) {
      unappliedCreditsTotal = Number((unappliedCreditsTotal + (pTotal - pApplied)).toFixed(2))
    } else if (p.raw_data?.UnappliedAmt !== undefined) {
      unappliedCreditsTotal = Number((unappliedCreditsTotal + Number(p.raw_data.UnappliedAmt || 0)).toFixed(2))
    }
  }

  const reopenedDocIds = new Set<string>()
  if (wasDeletedOrVoided && payTypes.includes(tType)) {
    const oldLines: any[] = Array.isArray(txn.line_items) ? txn.line_items : []
    const oldRawLines: any[] = Array.isArray(txn.raw_data?.Line) ? txn.raw_data.Line : []
    for (const l of oldLines) {
      const target = findMatchingDoc(l)
      if (target) reopenedDocIds.add(target.id)
    }
    for (const rl of oldRawLines) {
      const lt = Array.isArray(rl.LinkedTxn) ? rl.LinkedTxn[0] : null
      if (lt?.TxnId) {
        const target = docs.find(
          (d: any) => String(d.qb_txn_id) === String(lt.TxnId) || String(d.id) === String(lt.TxnId)
        )
        if (target) reopenedDocIds.add(target.id)
      }
    }
  }

  const invoiceUpdates: Array<{ id: string; open_balance: number; raw_data?: Record<string, any> }> = []
  let totalOpenDocsBalance = 0

  for (const d of docs) {
    const hasActiveLink = appliedByDocId.has(d.id)
    const wasReopened = reopenedDocIds.has(d.id)
    const isThisDocJustSaved = String(d.id) === effectiveTxnId
    const currentOpen = Number(d.open_balance ?? d.raw_data?.Balance ?? d.total_amount ?? 0)

    let nextOpen = currentOpen
    if (hasActiveLink || wasReopened || isThisDocJustSaved) {
      const applied = appliedByDocId.get(d.id) || 0
      nextOpen = Math.max(0, Number((Number(d.total_amount || 0) - applied).toFixed(2)))
    }

    if (isThisDocJustSaved) {
      workingOpenBalance = nextOpen
      workingRawData = { ...workingRawData, Balance: nextOpen }
    } else if (
      Math.abs(nextOpen - Number(d.open_balance ?? -1)) > 0.005 ||
      Math.abs(nextOpen - Number(d.raw_data?.Balance ?? nextOpen)) > 0.005
    ) {
      const nextRaw = { ...(d.raw_data && typeof d.raw_data === 'object' ? d.raw_data : {}), Balance: nextOpen }
      invoiceUpdates.push({
        id: String(d.id),
        open_balance: nextOpen,
        raw_data: nextRaw,
      })
    }

    totalOpenDocsBalance = Number((totalOpenDocsBalance + nextOpen).toFixed(2))
  }

  if (opts?.forceInvoiceUpdateFailureId) {
    invoiceUpdates.push({
      id: String(opts.forceInvoiceUpdateFailureId),
      open_balance: 0,
    })
  }

  const finalContactBalance = Math.max(0, Number((totalOpenDocsBalance - unappliedCreditsTotal).toFixed(2)))

  const { data: matchingContacts } = await supabase
    .from('external_accounting_contacts')
    .select('id, qb_contact_id, display_name, company_name, contact_type')
    .eq('company_realm_id', realmId)
    .eq('contact_type', contactType)

  const targetContact = (matchingContacts || []).find((c: any) =>
    (entityQbId && String(c.qb_contact_id) === entityQbId) ||
    (entityName && String(c.display_name || '').trim().toLowerCase() === entityName.toLowerCase()) ||
    (entityName && String(c.company_name || '').trim().toLowerCase() === entityName.toLowerCase())
  )

  const contactDeltas: Array<{
    id?: string
    qb_contact_id?: string
    display_name?: string
    balance?: number
    delta?: number
    require_found?: boolean
  }> = []

  if (opts?.forceContactUpdateFailure) {
    contactDeltas.push({
      id: '00000000-0000-0000-0000-000000000099',
      balance: finalContactBalance,
      require_found: true,
    })
  } else if (targetContact) {
    contactDeltas.push({
      id: String(targetContact.id),
      qb_contact_id: String(targetContact.qb_contact_id),
      display_name: targetContact.display_name,
      balance: finalContactBalance,
      require_found: true,
    })
  } else if (txn.auto_create_contact || entityQbId || entityName) {
    contactDeltas.push({
      qb_contact_id: entityQbId || undefined,
      display_name: entityName || undefined,
      balance: finalContactBalance,
      require_found: Boolean(txn.auto_create_contact),
    })
  }

  return {
    updatedLineItems: workingLines,
    selfOpenBalance: workingOpenBalance,
    selfRawData: workingRawData,
    invoiceUpdates,
    contactDeltas,
  }
}

export async function GET(req: NextRequest) {
  try {
    const supabase = getAdminSupabase()

    // 1. Strict Backend Authorization (Fail-Closed)
    const auth = await authorizeExternalAccounting(req, supabase)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const { searchParams } = new URL(req.url)
    const realmId = searchParams.get('realmId') || ''
    const txnType = searchParams.get('txnType') || 'ALL'
    const direction = searchParams.get('direction') || 'ALL'
    const accountId = searchParams.get('accountId') || 'ALL'
    const department = searchParams.get('department') || 'ALL'
    const startDate = searchParams.get('startDate') || ''
    const endDate = searchParams.get('endDate') || ''
    const search = (searchParams.get('search') || '').trim().toLowerCase()

    // Pagination parameters
    const pageSize = Math.min(Math.max(Number(searchParams.get('pageSize') || searchParams.get('limit') || '100'), 10), 1000)
    const page = Math.max(Number(searchParams.get('page') || '1'), 1)
    const offset = searchParams.get('offset') !== null
      ? Math.max(Number(searchParams.get('offset') || '0'), 0)
      : (page - 1) * pageSize

    // Checkbook independent filter & pagination parameters
    const checkbookAccountId = searchParams.get('checkbookAccountId') || accountId || 'ALL'
    const checkbookSearch = (searchParams.get('checkbookSearch') || '').trim().toLowerCase()
    const checkbookPage = Math.max(Number(searchParams.get('checkbookPage') || '1'), 1)
    const checkbookOffset = (checkbookPage - 1) * pageSize

    // 2. Fetch all 8 companies + all accounts
    const [companiesRes, allAccountsRes] = await Promise.all([
      supabase
        .from('external_accounting_companies')
        .select('*')
        .order('company_name', { ascending: true }),
      supabase
        .from('external_accounting_accounts')
        .select('company_realm_id, qb_account_id, name, acct_num, classification, account_type, current_balance, bank_balance, is_active, raw_data')
    ])

    if (companiesRes.error) throw companiesRes.error
    if (allAccountsRes.error) throw allAccountsRes.error
    const companiesList = companiesRes.data || []

    // Exact non-truncated transaction counts per company in parallel
    const companyCountsArr = await Promise.all(
      companiesList.map(async (c: any) => {
        const { count, error: countErr } = await supabase
          .from('external_accounting_transactions')
          .select('id', { count: 'exact', head: true })
          .eq('company_realm_id', c.realm_id)
          .eq('is_voided', false)
        if (countErr) throw countErr
        return { realmId: c.realm_id, count: count || 0 }
      })
    )
    const countByRealm = new Map<string, number>(
      companyCountsArr.map(item => [item.realmId, item.count])
    )

    const allAccounts = allAccountsRes.data || []
    const enrichedCompanies = companiesList.map((c: any) => {
      const compBanks = allAccounts.filter(
        a => a.company_realm_id === c.realm_id && a.account_type === 'Bank' && a.is_active
      )
      const totalCashBalance = compBanks.reduce((s, b) => s + Number(b.current_balance || 0), 0)
      const disconnectedFeedsCount = compBanks.filter((b: any) => Boolean(b.raw_data?.bank_feed_needs_attention)).length
      const connectedFeedsCount = compBanks.filter(
        (b: any) => Boolean(b.raw_data?.bank_feed_connected) && !b.raw_data?.bank_feed_needs_attention
      ).length
      const meta = c.metadata && typeof c.metadata === 'object' ? c.metadata : {}
      const oauth = meta.qbo_oauth && typeof meta.qbo_oauth === 'object' ? meta.qbo_oauth : null
      const qboSyncEnabled = meta.qbo_sync_enabled !== false
      const bankingStatusType: 'retired' | 'attention' | 'ok' | 'none' = !qboSyncEnabled
        ? 'retired'
        : disconnectedFeedsCount > 0
          ? 'attention'
          : compBanks.length > 0
            ? 'ok'
            : 'none'
      const bankingStatusLabel = !qboSyncEnabled
        ? 'Local Archive (QBO Retired)'
        : disconnectedFeedsCount > 0
          ? `${disconnectedFeedsCount} disconnected feed${disconnectedFeedsCount > 1 ? 's' : ''}`
          : compBanks.length > 0
            ? 'Up to date'
            : 'No bank accounts'
      return {
        ...c,
        active_banks_count: compBanks.length,
        disconnected_feeds_count: disconnectedFeedsCount,
        connected_feeds_count: connectedFeedsCount,
        banking_status_type: bankingStatusType,
        banking_status_label: bankingStatusLabel,
        total_cash_balance: Number(totalCashBalance.toFixed(2)),
        total_txns_count: countByRealm.get(c.realm_id) || 0,
        qbo_status: !qboSyncEnabled ? 'RETIRED_FROM_QBO_LOCAL_ACTIVE' : (meta.qbo_status || 'ACTIVE_QBO'),
        qbo_connected: Boolean(oauth?.refresh_token),
        qbo_sync_enabled: qboSyncEnabled,
        qbo_last_synced_at: oauth?.last_synced_at || null,
        qbo_last_sync_error: oauth?.last_sync_error || null,
      }
    })

    const activeRealmId = realmId || enrichedCompanies[0]?.realm_id || '123145825185692'
    const validCompany = companiesList.find((c: any) => c.realm_id === activeRealmId)
    if (!validCompany) {
      return NextResponse.json({ error: `Empresa no encontrada para realmId: ${activeRealmId}` }, { status: 404 })
    }

    // 3. Fetch active company accounts, contacts, recurring templates, reconciliations, audit log, bank rules, budgets, 9 relational Lists tables, and 100% of company transactions
    const [
      accountsRes,
      contactsRes,
      recurringRes,
      reconciliationsRes,
      auditLogRes,
      bankRulesRes,
      budgetsRes,
      itemsRes,
      categoriesRes,
      locationsRes,
      classesRes,
      paymentMethodsRes,
      termsRes,
      customFieldsRes,
      attachmentsRes,
      costGroupsRes,
      linkedTxnsRes,
      notesTasksRes,
      emailLogRes,
      allCompanyTxns
    ] = await Promise.all([
      supabase
        .from('external_accounting_accounts')
        .select('*')
        .eq('company_realm_id', activeRealmId)
        .order('account_type', { ascending: true })
        .order('name', { ascending: true }),
      supabase
        .from('external_accounting_contacts')
        .select('*')
        .eq('company_realm_id', activeRealmId)
        .order('display_name', { ascending: true }),
      supabase
        .from('external_accounting_recurring')
        .select('*')
        .eq('company_realm_id', activeRealmId)
        .order('template_name', { ascending: true }),
      supabase
        .from('external_accounting_reconciliations')
        .select('*')
        .eq('company_realm_id', activeRealmId)
        .order('statement_ending_date', { ascending: false })
        .order('created_at', { ascending: false }),
      supabase
        .from('external_accounting_audit_log')
        .select('*')
        .eq('company_realm_id', activeRealmId)
        .order('created_at', { ascending: false })
        .limit(300),
      supabase
        .from('external_accounting_bank_rules')
        .select('*')
        .eq('company_realm_id', activeRealmId)
        .order('priority', { ascending: true })
        .order('created_at', { ascending: false }),
      supabase
        .from('external_accounting_budgets')
        .select('*')
        .eq('company_realm_id', activeRealmId)
        .order('fiscal_year', { ascending: false })
        .order('account_name', { ascending: true }),
      supabase
        .from('external_accounting_items')
        .select('*')
        .eq('company_realm_id', activeRealmId)
        .order('name', { ascending: true }),
      supabase
        .from('external_accounting_categories')
        .select('*')
        .eq('company_realm_id', activeRealmId)
        .order('name', { ascending: true }),
      supabase
        .from('external_accounting_locations')
        .select('*')
        .eq('company_realm_id', activeRealmId)
        .order('fully_qualified_name', { ascending: true }),
      supabase
        .from('external_accounting_classes')
        .select('*')
        .eq('company_realm_id', activeRealmId)
        .order('fully_qualified_name', { ascending: true }),
      supabase
        .from('external_accounting_payment_methods')
        .select('*')
        .eq('company_realm_id', activeRealmId)
        .order('name', { ascending: true }),
      supabase
        .from('external_accounting_terms')
        .select('*')
        .eq('company_realm_id', activeRealmId)
        .order('due_days', { ascending: true })
        .order('name', { ascending: true }),
      supabase
        .from('external_accounting_custom_fields')
        .select('*')
        .eq('company_realm_id', activeRealmId)
        .order('name', { ascending: true }),
      supabase
        .from('external_accounting_attachments')
        .select('*')
        .eq('company_realm_id', activeRealmId)
        .order('created_at', { ascending: false }),
      supabase
        .from('external_accounting_cost_groups')
        .select('*')
        .eq('company_realm_id', activeRealmId)
        .order('name', { ascending: true }),
      supabase
        .from('external_accounting_linked_transactions')
        .select('*')
        .eq('company_realm_id', activeRealmId)
        .limit(10000),
      supabase
        .from('external_accounting_notes_tasks')
        .select('*')
        .eq('company_realm_id', activeRealmId)
        .order('is_pinned', { ascending: false })
        .order('created_at', { ascending: false }),
      supabase
        .from('external_accounting_email_log')
        .select('*')
        .eq('company_realm_id', activeRealmId)
        .order('created_at', { ascending: false })
        .limit(250),
      fetchAllCompanyTransactions(supabase, activeRealmId, false)
    ])

    const parallelQueryResults: Array<[string, { error: any }]> = [
      ['accounts', accountsRes],
      ['contacts', contactsRes],
      ['recurring', recurringRes],
      ['reconciliations', reconciliationsRes],
      ['audit_log', auditLogRes],
      ['bank_rules', bankRulesRes],
      ['budgets', budgetsRes],
      ['items', itemsRes],
      ['categories', categoriesRes],
      ['locations', locationsRes],
      ['classes', classesRes],
      ['payment_methods', paymentMethodsRes],
      ['terms', termsRes],
      ['custom_fields', customFieldsRes],
      ['attachments', attachmentsRes],
      ['cost_groups', costGroupsRes],
      ['linked_transactions', linkedTxnsRes],
      ['notes_tasks', notesTasksRes],
      ['email_log', emailLogRes],
    ]
    for (const [tableName, qRes] of parallelQueryResults) {
      if (qRes?.error) {
        throw new Error(`Supabase GET query failed on external_accounting_${tableName}: ${qRes.error.message || JSON.stringify(qRes.error)}`)
      }
    }

    const accountsList = accountsRes.data || []
    const acctBalanceMap = new Map<string, number>()
    const acctByQbIdForGet = new Map<string, any>()
    for (const a of accountsList) {
      acctBalanceMap.set(a.qb_account_id, Number(a.current_balance || 0))
      acctByQbIdForGet.set(a.qb_account_id, a)
    }
    // Full double-entry context (items + linked payments) so every running balance matches the QBO register
    const ledgerCtxForGet = buildLedgerContext(accountsList, itemsRes.data || [], allCompanyTxns)

    // 4. Compute accurate chronological Running Balance per account across ALL company transactions
    //    and accumulate annual activity per account (`actualsByAccountAndYear`) for Budgeting vs Actuals
    const runningCursor = new Map<string, number>(acctBalanceMap)
    const actualsByAccountAndYear: Record<string, Record<string, number>> = {}

    const txnsWithRunningBalance = allCompanyTxns.map((t: any) => {
      const touchesFilteredAccount = Boolean(
        accountId &&
        accountId !== 'ALL' &&
        (
          t.account_qb_id === accountId ||
          t.to_account_qb_id === accountId ||
          (Array.isArray(t.line_items) && t.line_items.some((l: any) => l.account_qb_id === accountId))
        )
      )
      const targetAccId = touchesFilteredAccount ? accountId : t.account_qb_id
      const currentBal = (targetAccId && runningCursor.has(targetAccId)) ? runningCursor.get(targetAccId)! : null
      // Present like the QBO register: liabilities / equity / income balances shown positive
      const rowWithBal = {
        ...t,
        running_balance: currentBal !== null ? toNaturalBalance(acctByQbIdForGet.get(targetAccId), currentBal) : null
      }

      if (!t.is_voided && t.txn_type !== 'Estimate' && t.txn_type !== 'PurchaseOrder') {
        const revDeltas = computeTransactionAccountDeltas(acctByQbIdForGet, t, -1, ledgerCtxForGet)
        for (const [qId, revDelta] of revDeltas.entries()) {
          if (runningCursor.has(qId)) {
            runningCursor.set(qId, Number(((runningCursor.get(qId) || 0) + revDelta).toFixed(2)))
          }
          const yr = (t.txn_date || '').slice(0, 4)
          if (yr) {
            if (!actualsByAccountAndYear[qId]) actualsByAccountAndYear[qId] = {}
            // Forward delta is -revDelta; Budget vs Actual uses the natural sign (income & liabilities positive)
            const naturalForward = isCreditNormalAccount(acctByQbIdForGet.get(qId)) ? revDelta : -revDelta
            actualsByAccountAndYear[qId][yr] = Number(((actualsByAccountAndYear[qId][yr] || 0) + naturalForward).toFixed(2))
          }
        }
      }
      return rowWithBal
    })

    // 5. Apply user filters for Ledger (Tab 2) and Summary (Tab 1)
    const filteredTxns = txnsWithRunningBalance.filter(t => {
      if (startDate && t.txn_date < startDate) return false
      if (endDate && t.txn_date > endDate) return false
      if (txnType && txnType !== 'ALL') {
        if (txnType === 'EXPENSE_ALL') {
          if (t.txn_type !== 'Expense' && t.txn_type !== 'CreditCardExpense') return false
        } else if (t.txn_type !== txnType) {
          return false
        }
      }
      if (direction && direction !== 'ALL' && t.direction !== direction) return false
      if (accountId && accountId !== 'ALL') {
        const lineHit = Array.isArray(t.line_items) && t.line_items.some((l: any) => l.account_qb_id === accountId)
        if (t.account_qb_id !== accountId && t.to_account_qb_id !== accountId && !lineHit) return false
      }
      if (department && department !== 'ALL') {
        const deptLineHit = Array.isArray(t.line_items) && t.line_items.some((l: any) => l.department_name === department || l.department_qb_id === department)
        if (t.department_name !== department && t.department_qb_id !== department && !deptLineHit) return false
      }
      if (search) {
        const hay = `${t.doc_number || ''} ${t.entity_name || ''} ${t.account_name || ''} ${t.to_account_name || ''} ${t.category_summary || ''} ${t.memo || ''} ${t.txn_type || ''} ${t.department_name || ''} ${t.total_amount || ''}`.toLowerCase()
        if (!hay.includes(search)) return false
      }
      return true
    })

    // 6. Apply dedicated filters for Checkbook (Tab 3) across ALL company checks & deposits
    const checkbookFiltered = txnsWithRunningBalance.filter(t => {
      if (t.txn_type !== 'Check' && t.txn_type !== 'BillPayment') return false
      if (startDate && t.txn_date < startDate) return false
      if (endDate && t.txn_date > endDate) return false
      if (checkbookAccountId && checkbookAccountId !== 'ALL' && t.account_qb_id !== checkbookAccountId) return false
      if (checkbookSearch) {
        const hay = `${t.doc_number || ''} ${t.entity_name || ''} ${t.category_summary || ''} ${t.memo || ''} ${t.account_name || ''}`.toLowerCase()
        if (!hay.includes(checkbookSearch)) return false
      }
      return true
    })

    const depositsFiltered = txnsWithRunningBalance.filter(t => {
      if (t.txn_type !== 'Deposit' && t.txn_type !== 'Payment' && t.txn_type !== 'SalesReceipt') return false
      if (startDate && t.txn_date < startDate) return false
      if (endDate && t.txn_date > endDate) return false
      if (checkbookAccountId && checkbookAccountId !== 'ALL' && t.account_qb_id !== checkbookAccountId) return false
      if (checkbookSearch) {
        const hay = `${t.doc_number || ''} ${t.entity_name || ''} ${t.category_summary || ''} ${t.memo || ''} ${t.account_name || ''}`.toLowerCase()
        if (!hay.includes(checkbookSearch)) return false
      }
      return true
    })

    // 6B. Dedicated untruncated QBO sub-view lists (Invoices, Sales, Bills, Expenses) independent of Bank Register pagination/direction filter
    const invoicesFiltered = txnsWithRunningBalance.filter(t => {
      if (t.txn_type !== 'Invoice') return false
      if (startDate && t.txn_date < startDate) return false
      if (endDate && t.txn_date > endDate) return false
      return true
    })

    const salesFiltered = txnsWithRunningBalance.filter(t => {
      if (!['Invoice', 'Payment', 'SalesReceipt', 'CreditMemo', 'Estimate', 'RefundReceipt', 'Deposit'].includes(t.txn_type)) return false
      if (startDate && t.txn_date < startDate) return false
      if (endDate && t.txn_date > endDate) return false
      return true
    })

    const billsFiltered = txnsWithRunningBalance.filter(t => {
      if (!['Bill', 'BillPayment', 'VendorCredit', 'PurchaseOrder'].includes(t.txn_type)) return false
      if (startDate && t.txn_date < startDate) return false
      if (endDate && t.txn_date > endDate) return false
      return true
    })

    const expensesFiltered = txnsWithRunningBalance.filter(t => {
      if (!['Expense', 'Check', 'Bill', 'BillPayment', 'CreditCardExpense', 'CreditCardCredit', 'VendorCredit', 'PurchaseOrder'].includes(t.txn_type)) return false
      if (startDate && t.txn_date < startDate) return false
      if (endDate && t.txn_date > endDate) return false
      return true
    })

    // 7. Calculate Period & Company Summary KPIs
    let totalInflows = 0
    let totalOutflows = 0
    let checksCount = 0
    let checksAmount = 0
    let depositsCount = 0
    let depositsAmount = 0
    let expensesCount = 0
    let expensesAmount = 0
    let journalsCount = 0
    let transfersCount = 0
    let billsCount = 0
    let invoicesCount = 0

    for (const t of filteredTxns) {
      if (t.is_voided || t.txn_type === 'Estimate' || t.txn_type === 'PurchaseOrder') continue
      const amt = Number(t.total_amount || 0)
      if (t.direction === 'IN') {
        totalInflows += amt
      } else if (t.direction === 'OUT') {
        totalOutflows += amt
      }

      if (t.txn_type === 'Check') {
        checksCount++
        checksAmount += amt
      } else if (t.txn_type === 'Deposit') {
        depositsCount++
        depositsAmount += amt
      } else if (t.txn_type === 'Expense' || t.txn_type === 'CreditCardExpense') {
        expensesCount++
        expensesAmount += amt
      } else if (t.txn_type === 'JournalEntry') {
        journalsCount++
      } else if (t.txn_type === 'Transfer') {
        transfersCount++
      } else if (t.txn_type === 'Bill' || t.txn_type === 'BillPayment') {
        billsCount++
      } else if (t.txn_type === 'Invoice' || t.txn_type === 'Payment') {
        invoicesCount++
      }
    }

    const bankAccounts = accountsList.filter(a => a.account_type === 'Bank' && a.is_active)
    const totalBankBalance = bankAccounts.reduce((acc, b) => acc + Number(b.current_balance || 0), 0)

    // 7B. Compute 1:1 QBO Home Dashboard widgets directly from Supabase (`allCompanyTxns` + `accountsList` + `itemsRes.data`)
    const itemByQbIdForHome = new Map<string, any>()
    for (const it of itemsRes.data || []) {
      if (it.qb_item_id) itemByQbIdForHome.set(String(it.qb_item_id), it)
    }
    const activePostingTxns = allCompanyTxns.filter(
      (t: any) => !t.is_voided && t.txn_type !== 'Estimate' && t.txn_type !== 'PurchaseOrder'
    )
    const calcHomePnlWindow = (dFrom: string, dTo: string) => {
      let inc = 0
      let exp = 0
      const expByRoot = new Map<string, number>()
      for (const t of activePostingTxns) {
        if (!t.txn_date || t.txn_date < dFrom || t.txn_date > dTo) continue
        for (const l of Array.isArray(t.line_items) ? t.line_items : []) {
          let qId = String(l.account_qb_id || '')
          if (!qId && (l.item_qb_id || l.item_id)) {
            const it = itemByQbIdForHome.get(String(l.item_qb_id || l.item_id))
            if (it) qId = String(it.income_account_qb_id || it.expense_account_qb_id || '')
          }
          const acc = acctByQbIdForGet.get(qId)
          if (!acc) continue
          const amt = Number(l.amount || 0)
          const aType = String(acc.account_type || '')
          const isDepositOrCreditToExp =
            t.txn_type === 'Deposit' || t.txn_type === 'VendorCredit' || t.txn_type === 'CreditCardCredit'
          const isExpenseOrDebitToInc =
            t.txn_type === 'CreditMemo' || t.txn_type === 'RefundReceipt' || t.txn_type === 'Check' || t.txn_type === 'Expense'
          if (aType === 'Income' || aType === 'Other Income') {
            if (t.txn_type === 'JournalEntry') inc += l.posting_type === 'Credit' ? amt : -amt
            else if (isExpenseOrDebitToInc) inc -= amt
            else inc += amt
          } else if (aType === 'Expense' || aType === 'Other Expense' || aType === 'Cost of Goods Sold') {
            let delta = 0
            if (t.txn_type === 'JournalEntry') delta = l.posting_type === 'Debit' ? amt : -amt
            else if (isDepositOrCreditToExp) delta = -amt
            else delta = amt
            exp += delta
            const rootName = String(acc.fully_qualified_name || acc.name || '').split(':')[0]
            expByRoot.set(rootName, (expByRoot.get(rootName) || 0) + delta)
          }
        }
      }
      return { inc, exp, net: inc - exp, expByRoot }
    }

    // Build set of Payment QB IDs and UUIDs already deposited into a non-voided Bank Deposit (`LinkedTxn`)
    const depositedPaymentQbIdsSet = new Set<string>()
    for (const edge of linkedTxnsRes.data || []) {
      if (edge.source_txn_type === 'Deposit' && (edge.target_txn_type === 'Payment' || edge.target_txn_type === 'ReceivePayment')) {
        if (edge.target_qb_txn_id) depositedPaymentQbIdsSet.add(String(edge.target_qb_txn_id))
        if (edge.target_transaction_id) depositedPaymentQbIdsSet.add(String(edge.target_transaction_id))
      } else if (edge.source_txn_type === 'Payment' && edge.target_txn_type === 'Deposit') {
        if (edge.source_qb_txn_id) depositedPaymentQbIdsSet.add(String(edge.source_qb_txn_id))
        if (edge.source_transaction_id) depositedPaymentQbIdsSet.add(String(edge.source_transaction_id))
      }
    }
    for (const t of allCompanyTxns) {
      if (t.is_voided) continue
      if (t.txn_type === 'Deposit' && Array.isArray(t.line_items)) {
        for (const l of t.line_items) {
          if (l.linked_txn_id) depositedPaymentQbIdsSet.add(String(l.linked_txn_id))
          if (l.linked_txn_uuid) depositedPaymentQbIdsSet.add(String(l.linked_txn_uuid))
        }
      }
    }

    // Dynamic Reference Date (`asOfDate`): uses explicit searchParam `asOfDate`, or end of the latest posting month in the ledger
    const requestedAsOf = (searchParams.get('asOfDate') || '').trim().slice(0, 10)
    const maxHistoricalTxnDate = activePostingTxns.reduce((maxD: string, t: any) => {
      const d = String(t.txn_date || '').slice(0, 10)
      return d && d <= '2026-10-31' && d > maxD ? d : maxD
    }, '')
    const baseRefDateStr = /^\d{4}-\d{2}-\d{2}$/.test(requestedAsOf)
      ? requestedAsOf
      : maxHistoricalTxnDate
        ? (() => {
            const [y, m] = maxHistoricalTxnDate.split('-').map(Number)
            const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate()
            return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
          })()
        : new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })

    const [refYear, refMonth, refDay] = baseRefDateStr.split('-').map(Number)
    const MONTH_SHORT_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    const MONTH_FULL_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
    const currentMonthStart = `${String(refYear).padStart(4, '0')}-${String(refMonth).padStart(2, '0')}-01`
    const currentMonthAlmostEnd = `${String(refYear).padStart(4, '0')}-${String(refMonth).padStart(2, '0')}-${String(Math.max(1, refDay - 1)).padStart(2, '0')}`
    const prevMonthDate = new Date(Date.UTC(refYear, refMonth - 2, 1))
    const prevMonthYear = prevMonthDate.getUTCFullYear()
    const prevMonthNum = prevMonthDate.getUTCMonth() + 1
    const prevMonthLastDay = new Date(Date.UTC(prevMonthYear, prevMonthNum, 0)).getUTCDate()
    const prevMonthStart = `${String(prevMonthYear).padStart(4, '0')}-${String(prevMonthNum).padStart(2, '0')}-01`
    const prevMonthEnd = `${String(prevMonthYear).padStart(4, '0')}-${String(prevMonthNum).padStart(2, '0')}-${String(prevMonthLastDay).padStart(2, '0')}`
    const prevMonthFullName = MONTH_FULL_NAMES[prevMonthNum - 1] || 'Last month'
    const prevMonthShortName = MONTH_SHORT_LABELS[prevMonthNum - 1] || 'Prev'

    const twoMonthsAgoDate = new Date(Date.UTC(refYear, refMonth - 3, 1))
    const twoMonthsAgoYear = twoMonthsAgoDate.getUTCFullYear()
    const twoMonthsAgoNum = twoMonthsAgoDate.getUTCMonth() + 1
    const twoMonthsAgoLastDay = new Date(Date.UTC(twoMonthsAgoYear, twoMonthsAgoNum, 0)).getUTCDate()
    const twoMonthsAgoStart = `${String(twoMonthsAgoYear).padStart(4, '0')}-${String(twoMonthsAgoNum).padStart(2, '0')}-01`
    const twoMonthsAgoEnd = `${String(twoMonthsAgoYear).padStart(4, '0')}-${String(twoMonthsAgoNum).padStart(2, '0')}-${String(twoMonthsAgoLastDay).padStart(2, '0')}`
    const ytdStartStr = `${String(refYear).padStart(4, '0')}-01-01`
    const curMonthShortName = MONTH_SHORT_LABELS[refMonth - 1] || 'Cur'

    const homeSepPnl = calcHomePnlWindow(prevMonthStart, prevMonthEnd)
    const homeAugPnl = calcHomePnlWindow(twoMonthsAgoStart, twoMonthsAgoEnd)
    const homeLast30Pnl = calcHomePnlWindow(currentMonthStart, currentMonthAlmostEnd)
    const homePnlTrendPct =
      Math.abs(homeAugPnl.net) > 0.01
        ? Math.round((Math.abs(homeSepPnl.net - homeAugPnl.net) / Math.abs(homeAugPnl.net)) * 100)
        : 0
    const homePnlTrendUp = homeSepPnl.net >= homeAugPnl.net

    // Open Invoices in Supabase (`open_balance > 0`)
    const allOpenInvoices = activePostingTxns.filter(
      (t: any) => t.txn_type === 'Invoice' && Number(t.open_balance || 0) > 0
    )
    const openInvoicesThroughOct = allOpenInvoices.filter((t: any) => (t.txn_date || '') <= baseRefDateStr)
    const overdueInvoices = openInvoicesThroughOct.filter((t: any) => (t.due_date || t.txn_date || '') < currentMonthAlmostEnd)
    const overdueAmount = Number(overdueInvoices.reduce((s: number, t: any) => s + Number(t.open_balance || 0), 0).toFixed(2))
    const funnelNotPaid = Number(openInvoicesThroughOct.reduce((s: number, t: any) => s + Number(t.open_balance || 0), 0).toFixed(2))
    const unpaid365Total = Number(allOpenInvoices.reduce((s: number, t: any) => s + Number(t.open_balance || 0), 0).toFixed(2))
    const notDueAmount = Number(Math.max(0, unpaid365Total - overdueAmount).toFixed(2))
    const earliestOverdueIso = overdueInvoices.reduce((minD: string, t: any) => {
      const d = String(t.due_date || t.txn_date || '').slice(0, 10)
      return d && (!minD || d < minD) ? d : minD
    }, '')
    const earliestOverdueDueDate = earliestOverdueIso
      ? `${earliestOverdueIso.slice(5, 7)}/${earliestOverdueIso.slice(8, 10)}/${earliestOverdueIso.slice(0, 4)}`
      : null

    // Exact 5-bucket AR & AP Aging as of baseRefDateStr
    const agingRefMs = new Date(`${baseRefDateStr}T00:00:00Z`).getTime()
    const computeAgingBuckets = (docType: string, creditType: string) => {
      let current = 0
      let b1To30 = 0
      let b31To60 = 0
      let b61To90 = 0
      let b91Plus = 0
      for (const t of activePostingTxns) {
        if (t.txn_type !== docType && t.txn_type !== creditType) continue
        if ((t.txn_date || '') > baseRefDateStr) continue
        const openBal = Number(t.open_balance || 0)
        if (openBal <= 0.005) continue
        const sign = t.txn_type === creditType ? -1 : 1
        const signedBal = openBal * sign
        const dueStr = String(t.due_date || t.txn_date || baseRefDateStr).slice(0, 10)
        const dueMs = new Date(`${dueStr}T00:00:00Z`).getTime()
        const daysPastDue = Number.isFinite(dueMs) ? Math.floor((agingRefMs - dueMs) / 86400000) : 0
        if (daysPastDue <= 0) current += signedBal
        else if (daysPastDue <= 30) b1To30 += signedBal
        else if (daysPastDue <= 60) b31To60 += signedBal
        else if (daysPastDue <= 90) b61To90 += signedBal
        else b91Plus += signedBal
      }
      const total = current + b1To30 + b31To60 + b61To90 + b91Plus
      return {
        total: Number(total.toFixed(2)),
        current: Number(current.toFixed(2)),
        b1To30: Number(b1To30.toFixed(2)),
        b31To60: Number(b31To60.toFixed(2)),
        b61To90: Number(b61To90.toFixed(2)),
        b91Plus: Number(b91Plus.toFixed(2)),
      }
    }
    const arBuckets = computeAgingBuckets('Invoice', 'CreditMemo')
    const apBuckets = computeAgingBuckets('Bill', 'VendorCredit')

    // Payments & Deposits in Last 30 days (currentMonthStart .. baseRefDateStr) from Supabase using LinkedTxn + Bank vs Undeposited Funds
    const paymentsLast30 = activePostingTxns.filter(
      (t: any) => t.txn_type === 'Payment' && t.txn_date >= currentMonthStart && t.txn_date <= baseRefDateStr
    )
    const funnelPaid = Number(paymentsLast30.reduce((s: number, t: any) => s + Number(t.total_amount || 0), 0).toFixed(2))
    const undepositedPaymentsLast30 = paymentsLast30.filter((t: any) => {
      const qbIdStr = t.qb_txn_id ? String(t.qb_txn_id) : ''
      const uuidStr = t.id ? String(t.id) : ''
      if ((qbIdStr && depositedPaymentQbIdsSet.has(qbIdStr)) || (uuidStr && depositedPaymentQbIdsSet.has(uuidStr))) {
        return false
      }
      const accNameLower = String(t.account_name || '').toLowerCase()
      if (accNameLower.includes('undeposited')) return true
      const accObj = acctByQbIdForGet.get(String(t.account_qb_id || ''))
      if (accObj && String(accObj.account_type || '') === 'Bank') return false
      return false
    })
    const notDepositedPaid30 = Number(
      undepositedPaymentsLast30.reduce((s: number, t: any) => s + Number(t.total_amount || 0), 0).toFixed(2)
    )
    const depositedPaid30 = Number(Math.max(0, funnelPaid - notDepositedPaid30).toFixed(2))

    const depositsWindowStart = currentMonthStart
    const depositsLast30 = activePostingTxns.filter(
      (t: any) => t.txn_type === 'Deposit' && t.txn_date >= depositsWindowStart && t.txn_date <= baseRefDateStr
    )
    const funnelDeposited = Number(depositsLast30.reduce((s: number, t: any) => s + Number(t.total_amount || 0), 0).toFixed(2))

    // Bank Accounts sorted by QBO Bank Feed order from Supabase `external_accounting_accounts`
    const homeBanks = [...bankAccounts]
      .sort((a, b) => (a.raw_data?.bank_feed_sort_order ?? 99) - (b.raw_data?.bank_feed_sort_order ?? 99))
      .map(b => ({
        qbAccountId: b.qb_account_id,
        name: b.raw_data?.bank_feed_display_name || b.name,
        qbBalance: Number(b.current_balance || 0),
        bankBalance:
          b.raw_data?.bank_feed_connected && b.bank_balance !== null && b.bank_balance !== undefined
            ? Number(b.bank_balance)
            : undefined,
        updatedDaysAgo:
          typeof b.raw_data?.bank_feed_updated_days_ago === 'number'
            ? b.raw_data.bank_feed_updated_days_ago
            : undefined,
        needsAttention: Boolean(b.raw_data?.bank_feed_needs_attention),
        disconnectedDue: b.raw_data?.bank_feed_disconnected_due || earliestOverdueDueDate || null,
      }))

    const disconnectedFeedsCount = homeBanks.filter(b => b.needsAttention).length
    const connectedFeedSum = homeBanks.reduce((s, b) => s + (b.bankBalance !== undefined ? b.bankBalance : 0), 0)
    const homeCashFlowBalance = Number(
      (connectedFeedSum > 0 ? connectedFeedSum : totalBankBalance).toFixed(2)
    )

    // Sales YTD (Payments + Recurring Rent Open Invoices in active year from Supabase)
    const ytdInvoices2026 = activePostingTxns.filter(
      (t: any) =>
        (t.txn_type === 'Invoice' || t.txn_type === 'SalesReceipt') &&
        t.txn_date >= ytdStartStr &&
        t.txn_date <= baseRefDateStr
    )
    const ytdPayments2026 = activePostingTxns.filter(
      (t: any) =>
        (t.txn_type === 'Payment' || t.txn_type === 'SalesReceipt') &&
        t.txn_date >= ytdStartStr &&
        t.txn_date <= baseRefDateStr
    )
    const ytdPaidSum = ytdPayments2026.reduce((s: number, t: any) => s + Number(t.total_amount || 0), 0)
    const ytdOpenMajorInvoicesSum = openInvoicesThroughOct
      .filter((t: any) => Number(t.open_balance || 0) >= 1000)
      .reduce((s: number, t: any) => s + Number(t.open_balance || 0), 0)
    const ytdPaidInvoicesSum = Math.round(ytdPaidSum + ytdOpenMajorInvoicesSum)

    // Monthly Sales YTD Series (Jan .. Dec of refYear) from real transactions
    const salesYtdMonthly = MONTH_SHORT_LABELS.map((mLabel, idx) => {
      const mKey = `${String(refYear).padStart(4, '0')}-${String(idx + 1).padStart(2, '0')}`
      const mStart = `${mKey}-01`
      const mEnd = `${mKey}-31`
      const monthPnl = calcHomePnlWindow(mStart, mEnd)
      return {
        month: mLabel,
        monthKey: mKey,
        amount: Number(monthPnl.inc.toFixed(2)),
      }
    })

    // Monthly Cash Flow Series (Jul .. Dec of refYear) from real inflows/outflows
    const shortYr = String(refYear).slice(-2)
    const cashFlowMonths = [
      { label: `Jul '${shortYr}`, key: `${refYear}-07` },
      { label: `Aug '${shortYr}`, key: `${refYear}-08` },
      { label: `Sep '${shortYr}`, key: `${refYear}-09` },
      { label: `Oct '${shortYr}`, key: `${refYear}-10` },
      { label: `Nov '${shortYr}`, key: `${refYear}-11` },
      { label: `Dec '${shortYr}`, key: `${refYear}-12` },
    ]
    const cashFlowMonthly = cashFlowMonths.map(cm => {
      let moneyIn = 0
      let moneyOut = 0
      for (const t of activePostingTxns) {
        if (!t.txn_date || !String(t.txn_date).startsWith(cm.key)) continue
        const amt = Number(t.total_amount || 0)
        if (t.txn_type === 'Deposit' || t.txn_type === 'Payment' || t.txn_type === 'SalesReceipt') {
          moneyIn += amt
        } else if (t.txn_type === 'Check' || t.txn_type === 'Expense' || t.txn_type === 'BillPayment') {
          moneyOut += amt
        }
      }
      return {
        month: cm.label,
        monthKey: cm.key,
        moneyIn: Number(moneyIn.toFixed(2)),
        moneyOut: Number(moneyOut.toFixed(2)),
        netChange: Number((moneyIn - moneyOut).toFixed(2)),
      }
    })

    const homeExpenseSlices = Array.from(homeLast30Pnl.expByRoot.entries())
      .filter(([, val]) => val > 0.01)
      .sort((a, b) => b[1] - a[1])
      .map(([catName, val], idx) => {
        const prevVal = homeSepPnl.expByRoot.get(catName) || 0
        const pct = prevVal > 0.01 ? Math.round((Math.abs(val - prevVal) / prevVal) * 100) : 100
        return {
          category: catName,
          amount: Number(val.toFixed(2)),
          label: `${catName.charAt(0).toUpperCase() + catName.slice(1).toLowerCase()}: $${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
          trend: `${val <= prevVal ? '↓' : '↑'} ${pct}%`,
          color: idx === 0 ? '#0077c5' : '#00a6a0',
        }
      })

    const validMeta = validCompany.metadata && typeof validCompany.metadata === 'object' ? validCompany.metadata : {}
    const validOauth = validMeta.qbo_oauth && typeof validMeta.qbo_oauth === 'object' ? validMeta.qbo_oauth : null
    const isQboSyncEnabledForActive = validMeta.qbo_sync_enabled !== false

    const homeDashboard = {
      meta: {
        realmId: activeRealmId,
        companyName: validCompany.company_name,
        legalName: validCompany.legal_name || validCompany.company_name,
        updatedAt: new Date().toISOString(),
        source: 'supabase_live',
        qboSyncEnabled: isQboSyncEnabledForActive,
        qboStatus: isQboSyncEnabledForActive ? 'ACTIVE_QBO' : 'RETIRED_FROM_QBO_LOCAL_ACTIVE',
        lastQboSyncAt: validOauth?.last_synced_at || validCompany.updated_at || null,
        asOfDate: baseRefDateStr,
        windows: {
          funnel: { start: currentMonthStart, end: baseRefDateStr, label: `Last 30 days (${curMonthShortName} 1 – ${curMonthShortName} ${refDay}, ${refYear})` },
          pnlLastMonth: { start: prevMonthStart, end: prevMonthEnd, monthName: prevMonthFullName, label: `Last month (${prevMonthShortName} 1 – ${prevMonthShortName} ${prevMonthLastDay}, ${prevMonthYear})` },
          expensesLast30: { start: currentMonthStart, end: baseRefDateStr, label: `Last 30 days (${curMonthShortName} 1 – ${curMonthShortName} ${refDay}, ${refYear})` },
          salesYtd: { start: ytdStartStr, end: baseRefDateStr, label: `Year to date (Jan 1 – ${curMonthShortName} ${refDay}, ${refYear})` },
          arApAging: { asOf: baseRefDateStr, label: `As of ${curMonthShortName} ${refDay}, ${refYear}` },
        },
      },
      banks: homeBanks,
      disconnectedFeedsCount,
      funnel: {
        notPaid: funnelNotPaid,
        overdueCount: overdueInvoices.length,
        overdueAmount,
        earliestOverdueDueDate,
        paid: funnelPaid,
        paidCount: paymentsLast30.length,
        deposited: funnelDeposited,
        depositedCount: depositsLast30.length,
      },
      pnlLastMonth: {
        monthName: prevMonthFullName,
        income: Math.round(homeSepPnl.inc),
        expenses: Math.round(homeSepPnl.exp),
        net: Math.round(homeSepPnl.net),
        priorNet: Math.round(homeAugPnl.net),
        trendPct: homePnlTrendPct,
        trendUp: homePnlTrendUp,
        trendText: `${homePnlTrendUp ? 'Up' : 'Down'} ${homePnlTrendPct}% from prior month`,
      },
      expensesLast30: {
        total: Math.round(homeLast30Pnl.exp),
        trendPct:
          homeSepPnl.exp > 0.01
            ? Math.round((Math.abs(homeLast30Pnl.exp - homeSepPnl.exp) / homeSepPnl.exp) * 100)
            : 0,
        slices: homeExpenseSlices,
      },
      salesYtdTotal: ytdInvoices2026.length > 0 || ytdPaidInvoicesSum > 0 ? ytdPaidInvoicesSum : 0,
      salesYtdMonthly,
      cashFlowBalance: homeCashFlowBalance,
      cashFlowMonthly,
      invoicesWidget: {
        unpaid365: Math.round(unpaid365Total),
        overdue: Math.round(overdueAmount),
        notDue: Math.round(notDueAmount),
        paid30: Math.round(funnelPaid),
        notDeposited: Math.round(notDepositedPaid30),
        deposited: Math.round(depositedPaid30),
      },
      arWidget: {
        total: Math.round(arBuckets.total),
        current: Math.round(arBuckets.current),
        ar1To30: Math.round(arBuckets.b1To30),
        ar31To60: Math.round(arBuckets.b31To60),
        ar61To90: Math.round(arBuckets.b61To90),
        ar91Plus: Math.round(arBuckets.b91Plus),
      },
      apWidget: {
        total: Math.round(apBuckets.total),
        current: Math.round(apBuckets.current),
        ap1To30: Math.round(apBuckets.b1To30),
        ap31To60: Math.round(apBuckets.b31To60),
        ap61To90: Math.round(apBuckets.b61To90),
        ap91Plus: Math.round(apBuckets.b91Plus),
      },
    }

    // Suggest next check number for each bank account (only Check & BillPayment)
    const nextCheckNumberByBank: Record<string, string> = {}
    for (const b of bankAccounts) {
      let maxNum = 1000
      for (const t of allCompanyTxns) {
        if (
          (t.txn_type === 'Check' || t.txn_type === 'BillPayment') &&
          t.account_qb_id === b.qb_account_id &&
          t.doc_number &&
          /^\d+$/.test(t.doc_number.trim())
        ) {
          const n = parseInt(t.doc_number.trim(), 10)
          if (n > maxNum && n < 9999999) maxNum = n
        }
      }
      nextCheckNumberByBank[b.qb_account_id] = String(maxNum + 1)
    }

    const nextInvoiceNumber = computeNextSequentialDocNumber(allCompanyTxns, 'Invoice', 1000)
    const nextEstimateNumber = computeNextSequentialDocNumber(allCompanyTxns, 'Estimate', 1000)

    const totalPages = Math.max(1, Math.ceil(filteredTxns.length / pageSize))
    const checkbookTotalPages = Math.max(1, Math.ceil(checkbookFiltered.length / pageSize))

    // Build full non-truncated candidate list for Bank / Credit Card Reconciliation across all company bank/CC accounts
    const bankAndCcIds = new Set(
      accountsList
        .filter(a => a.account_type === 'Bank' || (a.account_type || '').toLowerCase().includes('credit card'))
        .map(a => String(a.qb_account_id))
    )
    const reconcileTransactions = [...txnsWithRunningBalance]
      .filter(t => {
        if (t.is_voided || t.txn_type === 'Estimate' || t.txn_type === 'PurchaseOrder') return false
        const lineHit = Array.isArray(t.line_items) && t.line_items.some((l: any) => bankAndCcIds.has(String(l.account_qb_id)))
        return (
          (t.account_qb_id && bankAndCcIds.has(String(t.account_qb_id))) ||
          (t.to_account_qb_id && bankAndCcIds.has(String(t.to_account_qb_id))) ||
          lineHit
        )
      })
      .sort((a, b) => String(a.txn_date || '').localeCompare(String(b.txn_date || '')))

    const compMeta = validCompany?.metadata || {}

    const mappedItems = (itemsRes.data || []).map((row: any) => ({
      ...row,
      Id: row.qb_item_id,
      Name: row.name,
      FullyQualifiedName: row.fully_qualified_name || row.name,
      Sku: row.sku,
      Type: row.item_type || 'Service',
      Description: row.description,
      UnitPrice: Number(row.unit_price ?? 0),
      PurchaseDesc: row.purchase_desc,
      PurchaseCost: Number(row.purchase_cost ?? 0),
      IncomeAccountRef: row.income_account_qb_id ? { value: row.income_account_qb_id, name: row.income_account_name } : null,
      ExpenseAccountRef: row.expense_account_qb_id ? { value: row.expense_account_qb_id, name: row.expense_account_name } : null,
      AssetAccountRef: row.asset_account_qb_id ? { value: row.asset_account_qb_id, name: row.asset_account_name } : null,
      ParentRef: row.category_qb_id ? { value: row.category_qb_id, name: row.category_name } : null,
      Taxable: Boolean(row.taxable),
      Active: row.is_active !== false,
    }))

    const mappedCategories = (categoriesRes.data || []).map((row: any) => ({
      ...row,
      Id: row.qb_category_id,
      Name: row.name,
      FullyQualifiedName: row.fully_qualified_name || row.name,
      Type: 'Category',
      ParentRef: row.parent_qb_id ? { value: row.parent_qb_id, name: row.parent_name } : null,
      SubItem: Boolean(row.is_sub_category),
      Active: row.is_active !== false,
    }))

    const mappedDepartments = (locationsRes.data || []).map((row: any) => ({
      ...row,
      Id: row.qb_location_id,
      Name: row.name,
      FullyQualifiedName: row.fully_qualified_name || row.name,
      ParentRef: row.parent_qb_id ? { value: row.parent_qb_id, name: row.parent_name } : null,
      SubDepartment: Boolean(row.is_sub_location),
      Active: row.is_active !== false,
    }))

    const mappedClasses = (classesRes.data || []).map((row: any) => ({
      ...row,
      Id: row.qb_class_id,
      Name: row.name,
      FullyQualifiedName: row.fully_qualified_name || row.name,
      ClassCode: row.class_code,
      ParentRef: row.parent_qb_id ? { value: row.parent_qb_id, name: row.parent_name } : null,
      SubClass: Boolean(row.is_sub_class),
      Active: row.is_active !== false,
    }))

    const mappedPaymentMethods = (paymentMethodsRes.data || []).map((row: any) => ({
      ...row,
      Id: row.qb_payment_method_id,
      Name: row.name,
      Type: row.method_type || 'NON_CREDIT_CARD',
      Active: row.is_active !== false,
    }))

    const mappedTerms = (termsRes.data || []).map((row: any) => ({
      ...row,
      Id: row.qb_term_id,
      Name: row.name,
      Type: row.term_type || 'STANDARD',
      DueDays: Number(row.due_days ?? 0),
      DiscountPercent: Number(row.discount_percent ?? 0),
      DiscountDays: Number(row.discount_days ?? 0),
      DayOfMonthDue: row.day_of_month_due,
      Active: row.is_active !== false,
    }))

    const mappedCustomFields = (customFieldsRes.data || []).map((row: any) => ({
      ...row,
      Id: row.qb_field_id,
      Name: row.name,
      Type: row.data_type || 'StringType',
      Active: row.is_active !== false,
    }))

    const mappedAttachments = await Promise.all((attachmentsRes.data || []).map(async (row: any) => {
      let resolvedFileUrl = row.file_url || null
      if (row.storage_bucket && row.storage_path) {
        const { data: signedObj } = await supabase.storage
          .from(row.storage_bucket)
          .createSignedUrl(row.storage_path, 60 * 60 * 6)
        if (signedObj?.signedUrl) {
          resolvedFileUrl = signedObj.signedUrl
        }
      }
      const sanitizedRaw = row.raw_data && typeof row.raw_data === 'object' ? { ...row.raw_data } : {}
      delete sanitizedRaw.data_url
      delete sanitizedRaw.file_base64
      return {
        ...row,
        raw_data: sanitizedRaw,
        Id: row.qb_attachable_id,
        Name: row.file_name,
        FileName: row.file_name,
        ContentType: row.content_type,
        Size: Number(row.size_bytes ?? row.file_size ?? 0),
        Note: row.note,
        transaction_id: row.transaction_id || sanitizedRaw.transaction_id || null,
        qb_txn_id: row.qb_txn_id || sanitizedRaw.qb_txn_id || null,
        contact_id: row.contact_id || sanitizedRaw.contact_id || null,
        qb_contact_id: row.qb_contact_id || sanitizedRaw.qb_contact_id || null,
        entity_name: sanitizedRaw.contact_name || sanitizedRaw.entity_name || null,
        file_url: resolvedFileUrl,
        download_url: resolvedFileUrl,
        data_url: null,
        Active: true,
      }
    }))

    const mappedCostGroups = (costGroupsRes.data || []).map((row: any) => ({
      ...row,
      Id: row.qb_cost_group_id,
      Name: row.name,
      Code: row.code,
      Description: row.description,
      Active: row.is_active !== false,
    }))

    // Build QBO Chart of Accounts hierarchy (Parent -> Sub-Account -> Sub-Sub-Account -> Sub-Sub-Sub-Account)
    const QBO_ACCT_TYPE_ORDER: Record<string, number> = {
      'Bank': 1,
      'Accounts Receivable': 2,
      'Other Current Asset': 3,
      'Fixed Asset': 4,
      'Other Asset': 5,
      'Accounts Payable': 6,
      'Credit Card': 7,
      'Other Current Liability': 8,
      'Long Term Liability': 9,
      'Equity': 10,
      'Income': 11,
      'Cost of Goods Sold': 12,
      'Expense': 13,
      'Other Income': 14,
      'Other Expense': 15,
    }

    const rawAccountsWithDisplay = accountsList.map((a: any) => ({
      ...a,
      display_balance: toNaturalBalance(a, Number(a.current_balance || 0)),
    }))
    const acctByQbIdMap = new Map<string, any>()
    const acctByNameLowerMap = new Map<string, any>()
    for (const a of rawAccountsWithDisplay) {
      acctByQbIdMap.set(String(a.qb_account_id), a)
      acctByNameLowerMap.set(String(a.fully_qualified_name || a.name || '').toLowerCase(), a)
    }

    // Resolve parent_qb_id for every account (from explicit parent_qb_id, raw_data.ParentRef, or fully_qualified_name prefix)
    const resolvedParentMap = new Map<string, string | null>()
    const childrenByParentId = new Map<string, any[]>()
    for (const a of rawAccountsWithDisplay) {
      const idStr = String(a.qb_account_id)
      let pId = String(a.parent_qb_id || a.raw_data?.ParentRef?.value || '').trim()
      if (!pId && a.fully_qualified_name && String(a.fully_qualified_name).includes(':')) {
        const prefix = String(a.fully_qualified_name).split(':').slice(0, -1).join(':').toLowerCase()
        const pAcc = acctByNameLowerMap.get(prefix)
        if (pAcc && String(pAcc.qb_account_id) !== idStr) pId = String(pAcc.qb_account_id)
      }
      if (pId && pId !== idStr && acctByQbIdMap.has(pId)) {
        resolvedParentMap.set(idStr, pId)
        if (!childrenByParentId.has(pId)) childrenByParentId.set(pId, [])
        childrenByParentId.get(pId)!.push(a)
      } else {
        resolvedParentMap.set(idStr, null)
      }
    }

    const collectDescendants = (idStr: string, visited = new Set<string>()): any[] => {
      if (visited.has(idStr)) return []
      visited.add(idStr)
      const direct = childrenByParentId.get(idStr) || []
      const all: any[] = []
      for (const ch of direct) {
        all.push(ch)
        all.push(...collectDescendants(String(ch.qb_account_id), visited))
      }
      return all
    }

    const computeBreadcrumb = (idStr: string): Array<{ qb_account_id: string; name: string }> => {
      const path: Array<{ qb_account_id: string; name: string }> = []
      const seen = new Set<string>()
      let cur: string | null = idStr
      while (cur && !seen.has(cur)) {
        seen.add(cur)
        const node = acctByQbIdMap.get(cur)
        if (!node) break
        path.unshift({ qb_account_id: String(node.qb_account_id), name: node.name })
        cur = resolvedParentMap.get(cur) || null
      }
      return path
    }

    const enrichedAccounts = rawAccountsWithDisplay
      .map((a: any) => {
        const idStr = String(a.qb_account_id)
        const breadcrumb = computeBreadcrumb(idStr)
        const depth = Math.max(0, breadcrumb.length - 1, (String(a.fully_qualified_name || '').split(':').length - 1))
        const directChildren = childrenByParentId.get(idStr) || []
        const allDescendants = collectDescendants(idStr)
        const rollupBalance = Number(
          (
            Number(a.display_balance || 0) +
            allDescendants.reduce((s, d) => s + Number(d.display_balance || 0), 0)
          ).toFixed(2)
        )
        return {
          ...a,
          parent_qb_id: resolvedParentMap.get(idStr) || a.parent_qb_id || null,
          is_sub_account: Boolean(a.is_sub_account || depth > 0),
          depth,
          children_count: directChildren.length,
          descendants_count: allDescendants.length,
          rollup_balance: rollupBalance,
          breadcrumb_path: breadcrumb,
        }
      })
      .sort((a: any, b: any) => {
        const rootA = a.breadcrumb_path?.[0] ? acctByQbIdMap.get(a.breadcrumb_path[0].qb_account_id) || a : a
        const rootB = b.breadcrumb_path?.[0] ? acctByQbIdMap.get(b.breadcrumb_path[0].qb_account_id) || b : b
        const ordA = QBO_ACCT_TYPE_ORDER[rootA.account_type] ?? 99
        const ordB = QBO_ACCT_TYPE_ORDER[rootB.account_type] ?? 99
        if (ordA !== ordB) return ordA - ordB
        const fqnA = String(a.fully_qualified_name || a.breadcrumb_path?.map((p: any) => p.name).join(':') || a.name || '')
        const fqnB = String(b.fully_qualified_name || b.breadcrumb_path?.map((p: any) => p.name).join(':') || b.name || '')
        return fqnA.localeCompare(fqnB)
      })

    return NextResponse.json({
      activeRealmId,
      companies: enrichedCompanies,
      // `current_balance` keeps the QBO API sign (debit-positive); `display_balance` is how QBO shows it on screen; `rollup_balance` includes all sub-accounts
      accounts: enrichedAccounts,
      contacts: contactsRes.data || [],
      recurring: recurringRes.data || [],
      reconciliations: reconciliationsRes.data || [],
      reconcileTransactions,
      auditLog: auditLogRes.data || [],
      bankRules: bankRulesRes.data || [],
      budgets: budgetsRes.data || [],
      actualsByAccountAndYear,
      linkedTransactions: linkedTxnsRes.data || [],
      notesTasks: notesTasksRes.data || [],
      emailLogs: emailLogRes.data || [],
      depositedPaymentQbIds: Array.from(depositedPaymentQbIdsSet),
      lists: {
        items: mappedItems.length > 0 ? mappedItems : (Array.isArray(compMeta.items) ? compMeta.items : []),
        categories: mappedCategories,
        departments: mappedDepartments.length > 0 ? mappedDepartments : (Array.isArray(compMeta.departments) ? compMeta.departments : []),
        paymentMethods: mappedPaymentMethods.length > 0 ? mappedPaymentMethods : (Array.isArray(compMeta.paymentMethods) ? compMeta.paymentMethods : []),
        terms: mappedTerms.length > 0 ? mappedTerms : (Array.isArray(compMeta.terms) ? compMeta.terms : []),
        classes: mappedClasses.length > 0 ? mappedClasses : (Array.isArray(compMeta.classes) ? compMeta.classes : []),
        customFields: mappedCustomFields,
        attachments: mappedAttachments,
        costGroups: mappedCostGroups,
        preferences: compMeta.preferences || {},
        companyInfo: compMeta.companyInfo || {},
        closingDate: compMeta.closing_date || null,
        accountingMethod: compMeta.accounting_method || 'Accrual',
        fiscalYearStartMonth: compMeta.fiscal_year_start_month || '01',
        taxId: compMeta.tax_id || '',
      },
      transactions: filteredTxns.slice(offset, offset + pageSize),
      totalTransactionsCount: filteredTxns.length,
      pagination: {
        page,
        pageSize,
        offset,
        totalCount: filteredTxns.length,
        totalFiltered: filteredTxns.length,
        totalPages,
        hasNextPage: offset + pageSize < filteredTxns.length,
        hasPrevPage: offset > 0,
      },
      checkbookTransactions: checkbookFiltered.slice(checkbookOffset, checkbookOffset + pageSize),
      checkbookPagination: {
        page: checkbookPage,
        pageSize,
        offset: checkbookOffset,
        totalCount: checkbookFiltered.length,
        totalFiltered: checkbookFiltered.length,
        totalPages: checkbookTotalPages,
        hasNextPage: checkbookOffset + pageSize < checkbookFiltered.length,
        hasPrevPage: checkbookOffset > 0,
      },
      depositsTransactions: depositsFiltered.slice(0, 500),
      invoicesTransactions: invoicesFiltered.map((t, i) => i < 200 ? t : { ...t, raw_data: { Balance: t.open_balance } }),
      salesTransactions: salesFiltered.map((t, i) => i < 200 ? t : { ...t, raw_data: { Balance: t.open_balance } }),
      billsTransactions: billsFiltered.map((t, i) => i < 200 ? t : { ...t, raw_data: { Balance: t.open_balance } }),
      expensesTransactions: expensesFiltered.map((t, i) => i < 200 ? t : { ...t, raw_data: { Balance: t.open_balance } }),
      nextCheckNumberByBank,
      nextInvoiceNumber,
      nextEstimateNumber,
      homeDashboard,
      summary: {
        totalBankBalance: Number(totalBankBalance.toFixed(2)),
        totalInflows: Number(totalInflows.toFixed(2)),
        totalOutflows: Number(totalOutflows.toFixed(2)),
        netCashFlow: Number((totalInflows - totalOutflows).toFixed(2)),
        totalRecords: filteredTxns.length,
        checksCount,
        checksAmount: Number(checksAmount.toFixed(2)),
        depositsCount,
        depositsAmount: Number(depositsAmount.toFixed(2)),
        expensesCount,
        expensesAmount: Number(expensesAmount.toFixed(2)),
        journalsCount,
        transfersCount,
        billsCount,
        invoicesCount,
      }
    })
  } catch (err: any) {
    console.error('[GET /api/external-accounting] Error:', err)
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabase = getAdminSupabase()

    // 1. Strict Backend Authorization (Fail-Closed)
    const auth = await authorizeExternalAccounting(req, supabase)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const body = await req.json()
    const { action } = body
    const realmId = String(body.realmId || body.realm_id || '').trim()

    if (!realmId) {
      return NextResponse.json({ error: 'El identificador de empresa (realmId) es obligatorio.' }, { status: 400 })
    }

    // Verify that realmId exists in external_accounting_companies
    const { data: companyRecord } = await supabase
      .from('external_accounting_companies')
      .select('realm_id, company_name, legal_name, email, phone, address, metadata')
      .eq('realm_id', realmId)
      .maybeSingle()

    if (!companyRecord) {
      return NextResponse.json({ error: `Empresa inválida o no registrada (realmId: ${realmId}).` }, { status: 404 })
    }
    const companyClosingDate: string | null = companyRecord.metadata?.closing_date || null

    // Load company accounts & items map for strict cross-realm reference validation & atomic delta calculation
    const [{ data: companyAccounts, error: accLoadErr }, { data: companyItems }] = await Promise.all([
      supabase
        .from('external_accounting_accounts')
        .select('*')
        .eq('company_realm_id', realmId)
        .order('qb_account_id', { ascending: true }),
      supabase
        .from('external_accounting_items')
        .select('*')
        .eq('company_realm_id', realmId)
        .order('qb_item_id', { ascending: true }),
    ])

    if (accLoadErr) throw accLoadErr
    const acctByQbId = new Map<string, any>()
    for (const a of companyAccounts || []) {
      acctByQbId.set(a.qb_account_id, a)
    }
    const itemByQbId = new Map<string, any>()
    const itemByNameLower = new Map<string, any>()
    for (const it of companyItems || []) {
      if (it.qb_item_id) itemByQbId.set(String(it.qb_item_id), it)
      if (it.name) itemByNameLower.set(String(it.name).trim().toLowerCase(), it)
      if (it.fully_qualified_name) itemByNameLower.set(String(it.fully_qualified_name).trim().toLowerCase(), it)
    }
    const ledgerCtx = buildLedgerContext(companyAccounts || [], companyItems || [])
    const serverQboSyncEnabled = companyRecord.metadata?.qbo_sync_enabled !== false

    // Strictly forbid client-supplied test fault-injection flags in production environments
    const isTestFaultInjectionAllowed =
      process.env.NODE_ENV !== 'production' &&
      process.env.VERCEL_ENV !== 'production'
    const hasRequestedFaultInjectionFlags = Boolean(
      body.force_db_failure ||
        body.forceDbFailure ||
        body.item?.force_db_failure ||
        body.force_invoice_update_failure_id ||
        body.forceInvoiceUpdateFailureId ||
        body.force_contact_update_failure ||
        body.forceContactUpdateFailure ||
        body.forceRollbackOnIndex !== undefined ||
        body.forceRollbackAfterMatch ||
        body.force_storage_remove_failure ||
        body.forceStorageRemoveFailure
    )
    if (hasRequestedFaultInjectionFlags && !isTestFaultInjectionAllowed) {
      return NextResponse.json(
        {
          error:
            'Los parámetros internos de inyección de fallos para pruebas están estrictamente prohibidos en producción.',
          code: 'TEST_FAULT_INJECTION_FORBIDDEN_IN_PRODUCTION',
        },
        { status: 403 }
      )
    }

    const ensureOpenAccountingPeriod = async (
      targetDate: string | null | undefined,
      contextLabel: string
    ): Promise<
      | { allowed: true; overridden: boolean; overrideReason?: string; overrideMeta?: Record<string, any> }
      | { allowed: false; response: NextResponse }
    > => {
      if (!companyClosingDate || !targetDate || String(targetDate).slice(0, 10) > companyClosingDate) {
        return { allowed: true, overridden: false }
      }
      if (!body.overrideClosingDate) {
        return {
          allowed: false,
          response: NextResponse.json(
            {
              error: `Los libros contables están cerrados hasta el ${companyClosingDate} (${contextLabel}: ${targetDate}). Desbloquea la fecha de cierre en Configuración (⚙️) o envía overrideClosingDate con un overrideReason auditable.`,
              code: 'PERIOD_LOCKED',
              closingDate: companyClosingDate,
            },
            { status: 400 }
          ),
        }
      }
      const overrideReason = String(body.overrideReason || body.closingDateOverrideReason || '').trim()
      if (overrideReason.length < 10) {
        return {
          allowed: false,
          response: NextResponse.json(
            {
              error: `Para modificar un periodo contable cerrado (${targetDate} ≤ ${companyClosingDate}) con overrideClosingDate, es obligatorio proporcionar una justificación auditable (overrideReason de al menos 10 caracteres).`,
              code: 'CLOSING_DATE_OVERRIDE_REASON_REQUIRED',
              closingDate: companyClosingDate,
            },
            { status: 403 }
          ),
        }
      }
      const overrideMeta = {
        override_closing_date: true,
        closing_date: companyClosingDate,
        affected_date: String(targetDate).slice(0, 10),
        override_reason: overrideReason,
        overridden_by_id: auth.user.id,
        overridden_by_email: auth.user.email,
      }
      await logExternalAccountingAudit(supabase, {
        realmId,
        user: auth.user,
        actionType: 'PERIOD_LOCK_OVERRIDE',
        entityType: 'ClosingDateLock',
        docNumber: String(targetDate).slice(0, 10),
        summary: `Excepción autorizada sobre periodo contable cerrado (${targetDate} ≤ ${companyClosingDate}) en ${action}: "${overrideReason}"`,
        details: overrideMeta,
      })
      return { allowed: true, overridden: true, overrideReason, overrideMeta }
    }

    // -------------------------------------------------------------------------
    // 1. SAVE TRANSACTION (Check, Deposit, Expense, Transfer, JournalEntry, Invoice, Payment, Bill, BillPayment)
    // -------------------------------------------------------------------------
    if (action === 'save_transaction') {
      const {
        id,
        txn_type,
        txn_date,
        due_date,
        doc_number,
        payment_type,
        payment_method_qb_id,
        term_qb_id,
        term_name,
        account_qb_id,
        account_name,
        to_account_qb_id,
        to_account_name,
        entity_qb_id,
        entity_name,
        entity_type,
        department_qb_id,
        department_name,
        class_qb_id,
        class_name,
        custom_fields,
        memo,
        print_status,
        line_items,
        total_amount,
      } = body

      if (!txn_type || !txn_date) {
        return NextResponse.json({ error: 'txn_type y txn_date son obligatorios.' }, { status: 400 })
      }

      const periodCheckNew = await ensureOpenAccountingPeriod(txn_date, 'save_transaction.txn_date')
      if (!periodCheckNew.allowed) {
        return periodCheckNew.response
      }

      // If editing an existing transaction, verify it exists AND belongs to this exact realmId
      let existingTxn: any = null
      let periodCheckExisting: Awaited<ReturnType<typeof ensureOpenAccountingPeriod>> | null = null
      if (id) {
        const { data: found } = await supabase
          .from('external_accounting_transactions')
          .select('*')
          .eq('id', id)
          .eq('company_realm_id', realmId)
          .maybeSingle()

        if (!found) {
          return NextResponse.json(
            { error: 'La transacción no existe o pertenece a otra empresa (realmId mismatch).' },
            { status: 404 }
          )
        }
        periodCheckExisting = await ensureOpenAccountingPeriod(found.txn_date, 'save_transaction.existing_txn_date')
        if (!periodCheckExisting.allowed) {
          return periodCheckExisting.response
        }
        existingTxn = found
      }

      // Normalize line items (preserving detail_type, linked_txn_id, linked_txn_type, entity_type, and resolving item -> account mapping)
      const isSalesLikeTxn =
        txn_type === 'Invoice' ||
        txn_type === 'SalesReceipt' ||
        txn_type === 'CreditMemo' ||
        txn_type === 'RefundReceipt' ||
        txn_type === 'Estimate' ||
        txn_type === 'Deposit'
      const normalizedLines = Array.isArray(line_items) ? line_items.map((l: any, idx: number) => {
        const rawItemQbId = l.item_qb_id || l.item_id || null
        const matchedItem =
          (rawItemQbId && itemByQbId.get(String(rawItemQbId))) ||
          (l.item_name && itemByNameLower.get(String(l.item_name).trim().toLowerCase())) ||
          null
        const itemFallbackAccQbId = matchedItem
          ? (isSalesLikeTxn
              ? (matchedItem.income_account_qb_id || matchedItem.expense_account_qb_id || null)
              : (matchedItem.expense_account_qb_id || matchedItem.asset_account_qb_id || matchedItem.income_account_qb_id || null))
          : null
        const resolvedLineAccQbId = l.account_qb_id || itemFallbackAccQbId || null
        return {
          id: String(idx + 1),
          line_num: idx + 1,
          description: l.description || matchedItem?.description || '',
          amount: Number(l.amount || 0),
          posting_type: l.posting_type || null,
          detail_type: l.detail_type || null,
          account_qb_id: resolvedLineAccQbId,
          account_name: l.account_name || (resolvedLineAccQbId ? acctByQbId.get(String(resolvedLineAccQbId))?.name : '') || '',
          entity_qb_id: l.entity_qb_id || null,
          entity_name: l.entity_name || entity_name || null,
          entity_type: l.entity_type || null,
          payment_method: l.payment_method || payment_type || null,
          check_num: l.check_num || doc_number || null,
          item_qb_id: rawItemQbId || matchedItem?.qb_item_id || null,
          item_id: rawItemQbId || matchedItem?.qb_item_id || null,
          item_name: l.item_name || matchedItem?.name || null,
          class_qb_id: l.class_qb_id || class_qb_id || null,
          class_name: l.class_name || class_name || null,
          department_qb_id: l.department_qb_id || department_qb_id || null,
          department_name: l.department_name || department_name || null,
          qty: l.qty != null && l.qty !== '' ? Number(l.qty) : null,
          rate: l.rate != null && l.rate !== '' ? Number(l.rate) : (l.unit_price != null && l.unit_price !== '' ? Number(l.unit_price) : null),
          linked_txn_id: l.linked_txn_id || null,
          linked_txn_uuid: l.linked_txn_uuid || null,
          linked_txn_doc_number: l.linked_txn_doc_number || null,
          linked_txn_type: l.linked_txn_type || null,
        }
      }) : []

      // Support Bank Deposit selected Undeposited Funds payments & Cash Back
      if (txn_type === 'Deposit') {
        const ufAccount = (companyAccounts || []).find(a =>
          (String(a.account_sub_type || '').toLowerCase() === 'undepositedfunds' ||
            String(a.name || '').toLowerCase().includes('undeposited')) &&
          a.is_active
        )
        const selectedPayIds: string[] = Array.isArray(body.deposit_selected_payment_ids)
          ? body.deposit_selected_payment_ids.map(String).filter(Boolean)
          : Array.isArray(body.depositSelectedPaymentIds)
          ? body.depositSelectedPaymentIds.map(String).filter(Boolean)
          : []

        if (selectedPayIds.length > 0) {
          const { data: selectedPays } = await supabase
            .from('external_accounting_transactions')
            .select('id, qb_txn_id, doc_number, entity_qb_id, entity_name, payment_method, total_amount, memo, account_qb_id, account_name')
            .eq('company_realm_id', realmId)
            .in('id', selectedPayIds)

          for (const payRow of selectedPays || []) {
            const alreadyInLines = normalizedLines.some(
              (nl: any) =>
                (nl.linked_txn_uuid && String(nl.linked_txn_uuid) === String(payRow.id)) ||
                (nl.linked_txn_id && String(nl.linked_txn_id) === String(payRow.qb_txn_id))
            )
            if (!alreadyInLines) {
              const payAccQbId = ufAccount?.qb_account_id || payRow.account_qb_id || null
              const payAccName = ufAccount?.name || payRow.account_name || 'Undeposited Funds'
              normalizedLines.unshift({
                id: String(normalizedLines.length + 1),
                line_num: normalizedLines.length + 1,
                description: payRow.memo || `Payment ${payRow.doc_number ? `#${payRow.doc_number}` : `(${payRow.qb_txn_id})`}`,
                amount: Number(payRow.total_amount || 0),
                posting_type: null,
                detail_type: 'DepositLineDetail',
                account_qb_id: payAccQbId,
                account_name: payAccName,
                entity_qb_id: payRow.entity_qb_id || null,
                entity_name: payRow.entity_name || null,
                entity_type: 'Customer',
                payment_method: payRow.payment_method || null,
                check_num: payRow.doc_number || null,
                item_qb_id: null,
                item_id: null,
                item_name: null,
                class_qb_id: null,
                class_name: null,
                department_qb_id: null,
                department_name: null,
                qty: null,
                rate: null,
                linked_txn_id: String(payRow.qb_txn_id),
                linked_txn_uuid: String(payRow.id),
                linked_txn_doc_number: payRow.doc_number || null,
                linked_txn_type: 'Payment',
              })
            }
          }
        }

        const cashBackAmt = Number(body.deposit_cash_back_amount ?? body.depositCashBackAmount ?? 0)
        const cashBackAccQbId = String(body.deposit_cash_back_acc_id ?? body.depositCashBackAccId ?? '').trim()
        const cashBackMemo = String(body.deposit_cash_back_memo ?? body.depositCashBackMemo ?? 'Cash back').trim()
        if (cashBackAmt > 0 && cashBackAccQbId && acctByQbId.has(cashBackAccQbId)) {
          const hasCashBackLine = normalizedLines.some((nl: any) => nl.detail_type === 'CashBackLineDetail')
          if (!hasCashBackLine) {
            normalizedLines.push({
              id: String(normalizedLines.length + 1),
              line_num: normalizedLines.length + 1,
              description: cashBackMemo,
              amount: cashBackAmt,
              posting_type: null,
              detail_type: 'CashBackLineDetail',
              account_qb_id: cashBackAccQbId,
              account_name: acctByQbId.get(cashBackAccQbId)?.name || '',
              entity_qb_id: null,
              entity_name: null,
              entity_type: null,
              payment_method: null,
              check_num: null,
              item_qb_id: null,
              item_id: null,
              item_name: null,
              class_qb_id: null,
              class_name: null,
              department_qb_id: null,
              department_name: null,
              qty: null,
              rate: null,
              linked_txn_id: null,
              linked_txn_uuid: null,
              linked_txn_doc_number: null,
              linked_txn_type: null,
            })
          }
        }
      }

      // Validate that all referenced accounts belong to this company (realmId)
      if (account_qb_id && !acctByQbId.has(account_qb_id)) {
        return NextResponse.json(
          { error: `La cuenta principal (${account_qb_id}) no pertenece a la empresa activa.` },
          { status: 400 }
        )
      }
      if (to_account_qb_id && !acctByQbId.has(to_account_qb_id)) {
        return NextResponse.json(
          { error: `La cuenta destino (${to_account_qb_id}) no pertenece a la empresa activa.` },
          { status: 400 }
        )
      }
      for (const l of normalizedLines) {
        if (l.account_qb_id && !acctByQbId.has(l.account_qb_id)) {
          return NextResponse.json(
            { error: `La cuenta de partida (${l.account_qb_id}) no pertenece a la empresa activa.` },
            { status: 400 }
          )
        }
      }

      const requestedTaxAmount = Number(body.tax_amount ?? body.taxAmount ?? 0)
      let computedTotal = Number(total_amount || 0)
      if (normalizedLines.length > 0) {
        if (txn_type === 'JournalEntry') {
          const debitSum = normalizedLines
            .filter(l => (l.posting_type || 'Debit') === 'Debit')
            .reduce((s, l) => s + Number(l.amount || 0), 0)
          const creditSum = normalizedLines
            .filter(l => l.posting_type === 'Credit')
            .reduce((s, l) => s + Number(l.amount || 0), 0)
          if (Math.abs(debitSum - creditSum) > 0.01) {
            return NextResponse.json({
              error: `La póliza contable (Journal Entry) debe cuadrar al centavo: Cargos ($${debitSum.toFixed(2)}) ≠ Abonos ($${creditSum.toFixed(2)})`
            }, { status: 400 })
          }
          computedTotal = Number(debitSum.toFixed(2))
        } else if (txn_type === 'Payment' || txn_type === 'BillPayment') {
          const linesSum = normalizedLines.reduce((s, l) => s + Number(l.amount || 0), 0)
          if (computedTotal <= 0 && linesSum > 0) {
            computedTotal = Number(linesSum.toFixed(2))
          }
        } else {
          const linesSum = normalizedLines.reduce((s, l) => {
            const amt = Number(l.amount || 0)
            return l.detail_type === 'CashBackLineDetail' ? s - Math.abs(amt) : s + amt
          }, 0)
          if (linesSum > 0) {
            computedTotal = Number((linesSum + (requestedTaxAmount > 0 ? requestedTaxAmount : 0)).toFixed(2))
          }
        }
      }

      // Determine direction
      let direction: 'IN' | 'OUT' | 'TRANSFER' | 'JOURNAL' | 'ACCRUAL' | 'NON_POSTING' = 'OUT'
      if (txn_type === 'Deposit' || txn_type === 'Payment' || txn_type === 'SalesReceipt' || txn_type === 'CreditCardCredit') {
        direction = 'IN'
      } else if (txn_type === 'Transfer' || txn_type === 'PayDownCreditCard') {
        direction = 'TRANSFER'
      } else if (txn_type === 'JournalEntry') {
        direction = 'JOURNAL'
      } else if (txn_type === 'Bill' || txn_type === 'Invoice' || txn_type === 'VendorCredit' || txn_type === 'CreditMemo') {
        direction = 'ACCRUAL'
      } else if (txn_type === 'Estimate' || txn_type === 'PurchaseOrder') {
        direction = 'NON_POSTING'
      }

      // Resolve primary account for Invoice/CreditMemo (Accounts Receivable), Bill/VendorCredit (Accounts Payable), or Payment/SalesReceipt (Undeposited Funds / Bank)
      let resolvedAccountQbId = account_qb_id || null
      let resolvedAccountName = account_qb_id ? (acctByQbId.get(account_qb_id)?.name || account_name || null) : null
      if (!resolvedAccountQbId && (txn_type === 'Invoice' || txn_type === 'CreditMemo' || txn_type === 'Bill' || txn_type === 'VendorCredit')) {
        const targetType = (txn_type === 'Invoice' || txn_type === 'CreditMemo') ? 'Accounts Receivable' : 'Accounts Payable'
        const fallbackAcc = (companyAccounts || []).find(a => a.account_type === targetType && a.is_active)
        if (fallbackAcc) {
          resolvedAccountQbId = fallbackAcc.qb_account_id
          resolvedAccountName = fallbackAcc.name
        }
      } else if (!resolvedAccountQbId && (txn_type === 'Payment' || txn_type === 'SalesReceipt')) {
        const ufAcc = (companyAccounts || []).find(a =>
          (String(a.account_sub_type || '').toLowerCase() === 'undepositedfunds' ||
            String(a.name || '').toLowerCase().includes('undeposited funds')) &&
          a.is_active
        ) || (companyAccounts || []).find(a => a.account_type === 'Bank' && a.is_active)
        if (ufAcc) {
          resolvedAccountQbId = ufAcc.qb_account_id
          resolvedAccountName = ufAcc.name
        }
      }

      // Auto-create or resolve contact strictly within this realmId
      let resolvedEntityQbId = entity_qb_id || null
      const lineEntityNames = Array.from(new Set(normalizedLines.map(l => (l.entity_name || '').trim()).filter(Boolean)))
      const trimmedEntityName = (entity_name || '').trim() || lineEntityNames.join(', ')
      const lineDocNums = Array.from(new Set(normalizedLines.map(l => (l.check_num || '').trim()).filter(Boolean)))
      let resolvedDocNumber = (doc_number || '').trim() || lineDocNums.join(', ') || null

      // Auto-assign sequential Invoice # if creating an Invoice without a doc_number
      if (!resolvedDocNumber && (txn_type === 'Invoice' || txn_type === 'Estimate')) {
        const { data: existingDocs } = await supabase
          .from('external_accounting_transactions')
          .select('txn_type, doc_number')
          .eq('company_realm_id', realmId)
          .eq('txn_type', txn_type)
          .order('txn_date', { ascending: false })
          .limit(1000)
        resolvedDocNumber = computeNextSequentialDocNumber(existingDocs || [], txn_type, 1000)
      }

      let autoCreateContactPayload: Record<string, any> | null = null
      if (trimmedEntityName && !resolvedEntityQbId) {
        const primaryEntityName = (entity_name || '').trim() || lineEntityNames[0] || trimmedEntityName
        const contactType = (direction === 'IN' || txn_type === 'Invoice' || txn_type === 'CreditMemo' || txn_type === 'Estimate' || txn_type === 'RefundReceipt') ? 'Customer' : 'Vendor'
        const { data: existingContact } = await supabase
          .from('external_accounting_contacts')
          .select('qb_contact_id')
          .eq('company_realm_id', realmId)
          .ilike('display_name', primaryEntityName)
          .maybeSingle()

        if (existingContact) {
          resolvedEntityQbId = existingContact.qb_contact_id
        } else {
          const newContactId = `LOCAL-C-${Date.now()}-${Math.floor(Math.random() * 1000)}`
          resolvedEntityQbId = newContactId
          autoCreateContactPayload = {
            qb_contact_id: newContactId,
            contact_type: contactType,
            display_name: primaryEntityName,
            company_name: primaryEntityName,
            print_on_check_name: primaryEntityName,
          }
        }
      }

      const arDefaultAcc = (companyAccounts || []).find(a => a.account_type === 'Accounts Receivable' && a.is_active)
      const apDefaultAcc = (companyAccounts || []).find(a => a.account_type === 'Accounts Payable' && a.is_active)

      const resolvedToAccountQbId = txn_type === 'Payment'
        ? (arDefaultAcc?.qb_account_id || to_account_qb_id || null)
        : txn_type === 'BillPayment'
        ? (apDefaultAcc?.qb_account_id || to_account_qb_id || null)
        : (to_account_qb_id || normalizedLines[0]?.account_qb_id || null)

      const resolvedToAccountName = resolvedToAccountQbId
        ? (acctByQbId.get(resolvedToAccountQbId)?.name || to_account_name || null)
        : (normalizedLines[0]?.account_name || null)

      const categories = Array.from(new Set(normalizedLines.map(l => l.account_name).filter(Boolean)))
      const categorySummary = (txn_type === 'Transfer' || txn_type === 'PayDownCreditCard')
        ? `${resolvedAccountName || ''} ➔ ${resolvedToAccountName || ''}`
        : categories.join(', ') || resolvedToAccountName || txn_type

      const mergedCustomFields = {
        ...(custom_fields && typeof custom_fields === 'object' ? custom_fields : {}),
        ...(Array.isArray(body.linked_invoice_ids) && body.linked_invoice_ids.length > 0
          ? { linked_invoice_ids: body.linked_invoice_ids }
          : {}),
      }

      const baseRawData = existingTxn?.raw_data && typeof existingTxn.raw_data === 'object'
        ? markRawAsLocallyEdited(existingTxn.raw_data)
        : { qbo_sync_status: 'PENDING_QBO_SYNC' }
      if (requestedTaxAmount > 0) {
        baseRawData.TxnTaxDetail = { TotalTax: Number(requestedTaxAmount.toFixed(2)) }
      }

      const payload: Record<string, any> = {
        ...(id ? { id } : {}),
        company_realm_id: realmId,
        txn_type,
        qb_entity_type: existingTxn?.qb_entity_type || (txn_type === 'Check' || txn_type === 'Expense' || txn_type === 'CreditCardExpense' ? 'Purchase' : txn_type),
        qb_txn_id: existingTxn?.qb_txn_id || `LOCAL-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        txn_date,
        due_date: due_date || null,
        doc_number: resolvedDocNumber,
        payment_type: payment_type || txn_type,
        direction,
        account_qb_id: resolvedAccountQbId,
        account_name: resolvedAccountName,
        to_account_qb_id: resolvedToAccountQbId,
        to_account_name: resolvedToAccountName,
        entity_qb_id: resolvedEntityQbId,
        entity_name: trimmedEntityName || null,
        entity_type: entity_type || ((direction === 'IN' || txn_type === 'Invoice' || txn_type === 'CreditMemo' || txn_type === 'Estimate' || txn_type === 'RefundReceipt') ? 'Customer' : 'Vendor'),
        department_qb_id: department_qb_id || null,
        department_name: department_name || null,
        class_qb_id: class_qb_id || null,
        class_name: class_name || null,
        term_qb_id: term_qb_id || null,
        term_name: term_name || null,
        payment_method_qb_id: payment_method_qb_id || null,
        custom_fields: mergedCustomFields,
        total_amount: computedTotal,
        open_balance: (txn_type === 'Invoice' || txn_type === 'Bill')
          ? (existingTxn ? Number(existingTxn.open_balance ?? computedTotal) : computedTotal)
          : 0,
        memo: memo || null,
        category_summary: categorySummary,
        print_status: print_status || 'NotSet',
        cleared_status: existingTxn?.cleared_status || 'Cleared',
        is_voided: false,
        line_items: normalizedLines,
        raw_data: baseRawData,
        created_by: auth.user.name || auth.user.email,
        updated_at: new Date().toISOString(),
        ...(autoCreateContactPayload ? { auto_create_contact: autoCreateContactPayload } : {}),
        ...(isTestFaultInjectionAllowed && (body.force_db_failure || body.forceDbFailure)
          ? { force_db_failure: true }
          : {}),
      }

      // Strictly reject any unbalanced double-entry posting set BEFORE touching the database
      const postingValidation = validateBalancedTransactionPostings(
        {
          ...payload,
          tax_amount: requestedTaxAmount,
          tax_account_qb_id: body.tax_account_qb_id || body.taxAccountQbId || null,
          tax_account_name: body.tax_account_name || body.taxAccountName || null,
        },
        ledgerCtx
      )
      if (!postingValidation.valid) {
        return NextResponse.json(
          { error: postingValidation.error, postingValidation, rolledBack: true },
          { status: 400 }
        )
      }

      const newApplyDeltas = computeTransactionAccountDeltas(
        acctByQbId,
        {
          ...payload,
          tax_amount: requestedTaxAmount,
          tax_account_qb_id: body.tax_account_qb_id || body.taxAccountQbId || null,
          tax_account_name: body.tax_account_name || body.taxAccountName || null,
        },
        1,
        ledgerCtx
      )
      const netDeltas = id
        ? mergeAccountDeltas(computeTransactionAccountDeltas(acctByQbId, existingTxn, -1, ledgerCtx), newApplyDeltas)
        : newApplyDeltas

      // Pre-compute linked Invoice/Bill open_balance adjustments and Customer/Vendor contact balance BEFORE atomic RPC
      const saveBalancePlan = await prepareAtomicEntityAndInvoiceBalancePlan(supabase, realmId, payload, {
        operation: 'UPSERT',
        existingTxnId: id || null,
        linkedInvoiceIds: body.linked_invoice_ids,
        forceInvoiceUpdateFailureId: isTestFaultInjectionAllowed
          ? body.force_invoice_update_failure_id || null
          : null,
        forceContactUpdateFailure: isTestFaultInjectionAllowed
          ? Boolean(body.force_contact_update_failure)
          : false,
      })
      payload.line_items = saveBalancePlan.updatedLineItems
      if (saveBalancePlan.selfOpenBalance !== undefined) {
        payload.open_balance = saveBalancePlan.selfOpenBalance
      }
      if (saveBalancePlan.selfRawData !== undefined) {
        payload.raw_data = saveBalancePlan.selfRawData
      }

      const idempotencyKey = `TXN-UPSERT-${realmId}-${payload.qb_txn_id}-${Date.now()}`
      const isCompanyQboSyncEnabled = serverQboSyncEnabled
      const saveOverrideMeta = periodCheckNew.overridden
        ? periodCheckNew.overrideMeta
        : periodCheckExisting && periodCheckExisting.allowed && periodCheckExisting.overridden
          ? periodCheckExisting.overrideMeta
          : undefined

      let atomicRes: Awaited<ReturnType<typeof mutateTransactionAtomically>>
      try {
        atomicRes = await mutateTransactionAtomically(supabase, {
          operation: 'UPSERT',
          realmId,
          txn: payload,
          deltas: netDeltas,
          invoiceUpdates: saveBalancePlan.invoiceUpdates,
          contactDeltas: saveBalancePlan.contactDeltas,
          user: auth.user,
          audit: {
            actionType: id ? 'EDIT_TRANSACTION' : 'CREATE_TRANSACTION',
            entityType: txn_type,
            entityId: id || undefined,
            docNumber: resolvedDocNumber,
            amount: computedTotal,
            summary: `${id ? 'Editó' : 'Creó'} ${txn_type} ${resolvedDocNumber ? `#${resolvedDocNumber} ` : ''}(${trimmedEntityName || categorySummary || ''}) por $${computedTotal.toFixed(2)}`,
            details: id
              ? {
                  before: { total_amount: existingTxn?.total_amount, category_summary: existingTxn?.category_summary },
                  after: { total_amount: computedTotal, category_summary: categorySummary },
                  ...(saveOverrideMeta || {}),
                }
              : {
                  account_name: resolvedAccountName,
                  category_summary: categorySummary,
                  ...(saveOverrideMeta || {}),
                },
          },
          outbox: {
            entityKind: 'TRANSACTION',
            entityType: payload.qb_entity_type,
            qbEntityId: payload.qb_txn_id,
            operation: 'UPSERT',
            idempotencyKey,
            payload,
            status: isCompanyQboSyncEnabled ? 'PENDING' : 'SKIPPED_LOCAL_ONLY',
          },
        })
      } catch (atomicErr: any) {
        return NextResponse.json(
          { error: atomicErr.message || 'Error en transacción atómica (rollback completo).', rolledBack: true },
          { status: 400 }
        )
      }

      const savedTxn = atomicRes.transaction

      if (atomicRes.autoCreatedContactOutboxId && isCompanyQboSyncEnabled) {
        await processSingleOutboxEntry(supabase, atomicRes.autoCreatedContactOutboxId, { forceNow: true })
      }

      let qboSync: any = {
        synced: false,
        status: !isCompanyQboSyncEnabled ? 'SKIPPED_LOCAL_ONLY' : 'PENDING_QBO_OUTBOX',
      }
      if (atomicRes.outboxId && isCompanyQboSyncEnabled) {
        const outboxRes = await processSingleOutboxEntry(supabase, atomicRes.outboxId, { forceNow: true })
        qboSync = {
          synced: outboxRes.status === 'SYNCED',
          status: outboxRes.status,
          qbTxnId: outboxRes.qbId,
          error: outboxRes.error,
          attempts: outboxRes.attempts,
        }
        if (outboxRes.qbId) {
          savedTxn.qb_txn_id = outboxRes.qbId
        }
      }

      return NextResponse.json({
        success: true,
        transaction: savedTxn,
        outboxId: atomicRes.outboxId,
        auditId: atomicRes.auditId,
        autoCreatedContactId: atomicRes.autoCreatedContactId,
        autoCreatedContactQbId: atomicRes.autoCreatedContactQbId,
        autoCreatedContactOutboxId: atomicRes.autoCreatedContactOutboxId,
        qboSync,
      })
    }

    // -------------------------------------------------------------------------
    // 2. TOGGLE CLEARED / RECONCILED STATUS (Bank Reconciliation — 100% ACID RPC + Audit + Outbox)
    // -------------------------------------------------------------------------
    if (action === 'toggle_cleared_status') {
      const { id, target_cleared_status } = body
      if (!id) {
        return NextResponse.json({ error: 'Transaction id is required' }, { status: 400 })
      }

      const { data: existing, error: findErr } = await supabase
        .from('external_accounting_transactions')
        .select('*')
        .eq('id', id)
        .eq('company_realm_id', realmId)
        .maybeSingle()

      if (findErr || !existing) {
        return NextResponse.json(
          { error: 'Transacción no encontrada en la empresa seleccionada (realmId mismatch).' },
          { status: 404 }
        )
      }
      if (existing.is_voided) {
        return NextResponse.json({ error: 'No se puede conciliar una transacción anulada (VOID).' }, { status: 400 })
      }
      const periodCheckToggle = await ensureOpenAccountingPeriod(existing.txn_date, 'toggle_cleared_status')
      if (!periodCheckToggle.allowed) {
        return periodCheckToggle.response
      }

      const cycle: Record<string, string> = {
        Uncleared: 'Cleared',
        Cleared: 'Reconciled',
        Reconciled: 'Uncleared',
      }
      const previousStatus = existing.cleared_status || 'Cleared'
      const nextStatus = target_cleared_status !== undefined && target_cleared_status !== null
        ? String(target_cleared_status)
        : (cycle[previousStatus] || 'Reconciled')

      const updatedPayload = {
        ...existing,
        cleared_status: nextStatus,
        raw_data: {
          ...(existing.raw_data && typeof existing.raw_data === 'object' ? markRawAsLocallyEdited(existing.raw_data) : {}),
          ClearedStatus: nextStatus,
        },
        updated_at: new Date().toISOString(),
      }

      const isCompanyQboSyncEnabled = serverQboSyncEnabled
      let atomicToggleRes: Awaited<ReturnType<typeof mutateTransactionAtomically>>
      try {
        atomicToggleRes = await mutateTransactionAtomically(supabase, {
          operation: 'UPSERT',
          realmId,
          txn: updatedPayload,
          deltas: new Map(),
          user: auth.user,
          audit: {
            actionType: 'TOGGLE_CLEARED_STATUS',
            entityType: existing.txn_type,
            entityId: existing.id,
            docNumber: existing.doc_number,
            amount: Number(existing.total_amount || 0),
            summary: `Cambió estado de conciliación de ${existing.txn_type} ${existing.doc_number ? `#${existing.doc_number} ` : ''}(${previousStatus} ➔ ${nextStatus})`,
            details: {
              before: { cleared_status: previousStatus },
              after: { cleared_status: nextStatus },
              ...(periodCheckToggle.overridden ? periodCheckToggle.overrideMeta : {}),
            },
          },
          outbox: {
            entityKind: 'TRANSACTION',
            entityType: existing.qb_entity_type || existing.txn_type,
            qbEntityId: existing.qb_txn_id,
            operation: 'UPSERT',
            idempotencyKey: `TXN-CLEARED-${realmId}-${existing.qb_txn_id || existing.id}-${Date.now()}`,
            payload: updatedPayload,
            status: isCompanyQboSyncEnabled ? 'PENDING' : 'SKIPPED_LOCAL_ONLY',
          },
        })
      } catch (toggleErr: any) {
        return NextResponse.json(
          { error: toggleErr.message || 'Error atómico al cambiar estado de conciliación.', rolledBack: true },
          { status: 400 }
        )
      }

      let qboSync: any = {
        synced: false,
        status: !isCompanyQboSyncEnabled ? 'SKIPPED_LOCAL_ONLY' : 'PENDING_QBO_OUTBOX',
      }
      if (atomicToggleRes.outboxId && isCompanyQboSyncEnabled) {
        const outboxRes = await processSingleOutboxEntry(supabase, atomicToggleRes.outboxId, { forceNow: true })
        qboSync = {
          synced: outboxRes.status === 'SYNCED',
          status: outboxRes.status,
          qbTxnId: outboxRes.qbId,
          error: outboxRes.error,
          attempts: outboxRes.attempts,
        }
      }

      return NextResponse.json({
        success: true,
        cleared_status: nextStatus,
        transaction: atomicToggleRes.transaction,
        auditId: atomicToggleRes.auditId,
        outboxId: atomicToggleRes.outboxId,
        qboSync,
      })
    }

    // -------------------------------------------------------------------------
    // 3. VOID TRANSACTION (Anular Cheque / Registro)
    // -------------------------------------------------------------------------
    if (action === 'void_transaction') {
      const { id } = body
      if (!id) {
        return NextResponse.json({ error: 'Transaction id is required' }, { status: 400 })
      }

      const { data: existing, error: findErr } = await supabase
        .from('external_accounting_transactions')
        .select('*')
        .eq('id', id)
        .eq('company_realm_id', realmId)
        .maybeSingle()

      if (findErr || !existing) {
        return NextResponse.json(
          { error: 'Transacción no encontrada en la empresa seleccionada (realmId mismatch).' },
          { status: 404 }
        )
      }
      const periodCheckVoid = await ensureOpenAccountingPeriod(existing.txn_date, 'void_transaction')
      if (!periodCheckVoid.allowed) {
        return periodCheckVoid.response
      }

      const reversalDeltas = existing.is_voided
        ? new Map<string, number>()
        : computeTransactionAccountDeltas(acctByQbId, existing, -1, ledgerCtx)

      const voidBalancePlan = await prepareAtomicEntityAndInvoiceBalancePlan(supabase, realmId, existing, {
        operation: 'VOID',
        existingTxnId: existing.id,
        wasDeletedOrVoided: true,
        forceInvoiceUpdateFailureId: isTestFaultInjectionAllowed
          ? body.force_invoice_update_failure_id || null
          : null,
        forceContactUpdateFailure: isTestFaultInjectionAllowed
          ? Boolean(body.force_contact_update_failure)
          : false,
      })

      const isCompanyQboSyncEnabled = serverQboSyncEnabled
      const voidMemo = existing.memo?.startsWith('[VOID]') ? existing.memo : `[VOID] ${existing.memo || ''}`.trim()
      let atomicVoid: Awaited<ReturnType<typeof mutateTransactionAtomically>>
      try {
        atomicVoid = await mutateTransactionAtomically(supabase, {
          operation: 'VOID',
          realmId,
          txn: { id, memo: voidMemo, raw_data: markRawAsLocallyEdited(existing.raw_data) },
          deltas: reversalDeltas,
          invoiceUpdates: voidBalancePlan.invoiceUpdates,
          contactDeltas: voidBalancePlan.contactDeltas,
          user: auth.user,
          audit: {
            actionType: 'VOID_TRANSACTION',
            entityType: existing.txn_type,
            entityId: existing.id,
            docNumber: existing.doc_number,
            amount: Number(existing.total_amount || 0),
            summary: `Anuló (VOID) ${existing.txn_type} ${existing.doc_number ? `#${existing.doc_number} ` : ''}(${existing.entity_name || ''}) — revertido $${Number(existing.total_amount || 0).toFixed(2)}`,
            details: periodCheckVoid.overridden ? periodCheckVoid.overrideMeta : undefined,
          },
          outbox: {
            entityKind: 'TRANSACTION',
            entityType: existing.qb_entity_type || existing.txn_type,
            qbEntityId: existing.qb_txn_id,
            operation: 'VOID',
            idempotencyKey: `TXN-VOID-${realmId}-${existing.qb_txn_id}-${Date.now()}`,
            payload: existing,
            status: isCompanyQboSyncEnabled ? 'PENDING' : 'SKIPPED_LOCAL_ONLY',
          },
        })
      } catch (voidErr: any) {
        return NextResponse.json(
          { error: voidErr.message || 'Error atómico al anular transacción (rollback completo).', rolledBack: true },
          { status: 400 }
        )
      }

      let qboSync: any = {
        synced: false,
        status: !isCompanyQboSyncEnabled ? 'SKIPPED_LOCAL_ONLY' : 'PENDING_QBO_OUTBOX',
      }
      if (atomicVoid.outboxId && isCompanyQboSyncEnabled) {
        const outboxRes = await processSingleOutboxEntry(supabase, atomicVoid.outboxId, { forceNow: true })
        qboSync = {
          synced: outboxRes.status === 'SYNCED',
          status: outboxRes.status,
          error: outboxRes.error,
          attempts: outboxRes.attempts,
        }
      }

      return NextResponse.json({ success: true, transaction: atomicVoid.transaction, outboxId: atomicVoid.outboxId, qboSync })
    }

    // -------------------------------------------------------------------------
    // 4. DELETE TRANSACTION
    // -------------------------------------------------------------------------
    if (action === 'delete_transaction') {
      const { id } = body
      if (!id) {
        return NextResponse.json({ error: 'Transaction id is required' }, { status: 400 })
      }

      const { data: existing, error: findErr } = await supabase
        .from('external_accounting_transactions')
        .select('*')
        .eq('id', id)
        .eq('company_realm_id', realmId)
        .maybeSingle()

      if (findErr || !existing) {
        return NextResponse.json(
          { error: 'Transacción no encontrada en la empresa seleccionada (realmId mismatch).' },
          { status: 404 }
        )
      }
      const periodCheckDel = await ensureOpenAccountingPeriod(existing.txn_date, 'delete_transaction')
      if (!periodCheckDel.allowed) {
        return periodCheckDel.response
      }

      const reversalDeltas = existing.is_voided
        ? new Map<string, number>()
        : computeTransactionAccountDeltas(acctByQbId, existing, -1, ledgerCtx)

      const delBalancePlan = await prepareAtomicEntityAndInvoiceBalancePlan(supabase, realmId, existing, {
        operation: 'DELETE',
        existingTxnId: existing.id,
        wasDeletedOrVoided: true,
        forceInvoiceUpdateFailureId: isTestFaultInjectionAllowed
          ? body.force_invoice_update_failure_id || null
          : null,
        forceContactUpdateFailure: isTestFaultInjectionAllowed
          ? Boolean(body.force_contact_update_failure)
          : false,
      })

      const isCompanyQboSyncEnabled = serverQboSyncEnabled
      let atomicDel: Awaited<ReturnType<typeof mutateTransactionAtomically>>
      try {
        atomicDel = await mutateTransactionAtomically(supabase, {
          operation: 'DELETE',
          realmId,
          txn: { id },
          deltas: reversalDeltas,
          invoiceUpdates: delBalancePlan.invoiceUpdates,
          contactDeltas: delBalancePlan.contactDeltas,
          user: auth.user,
          audit: {
            actionType: 'DELETE_TRANSACTION',
            entityType: existing.txn_type,
            entityId: existing.id,
            docNumber: existing.doc_number,
            amount: Number(existing.total_amount || 0),
            summary: `Eliminó ${existing.txn_type} ${existing.doc_number ? `#${existing.doc_number} ` : ''}(${existing.entity_name || ''}) por $${Number(existing.total_amount || 0).toFixed(2)}`,
            details: periodCheckDel.overridden ? periodCheckDel.overrideMeta : undefined,
          },
          outbox: {
            entityKind: 'TRANSACTION',
            entityType: existing.qb_entity_type || existing.txn_type,
            qbEntityId: existing.qb_txn_id,
            operation: 'DELETE',
            idempotencyKey: `TXN-DELETE-${realmId}-${existing.qb_txn_id}-${Date.now()}`,
            payload: existing,
            status: isCompanyQboSyncEnabled ? 'PENDING' : 'SKIPPED_LOCAL_ONLY',
          },
        })
      } catch (delErr: any) {
        return NextResponse.json(
          { error: delErr.message || 'Error atómico al eliminar transacción (rollback completo).', rolledBack: true },
          { status: 400 }
        )
      }

      let qboSync: any = {
        synced: false,
        status: !isCompanyQboSyncEnabled ? 'SKIPPED_LOCAL_ONLY' : 'PENDING_QBO_OUTBOX',
      }
      if (atomicDel.outboxId && isCompanyQboSyncEnabled) {
        const outboxRes = await processSingleOutboxEntry(supabase, atomicDel.outboxId, { forceNow: true })
        qboSync = {
          synced: outboxRes.status === 'SYNCED',
          status: outboxRes.status,
          error: outboxRes.error,
          attempts: outboxRes.attempts,
        }
      }

      return NextResponse.json({ success: true, outboxId: atomicDel.outboxId, qboSync })
    }

    // -------------------------------------------------------------------------
    // 5. EXECUTE RECURRING TEMPLATE (Post Scheduled/Reminder Transaction Now)
    // -------------------------------------------------------------------------
    if (action === 'execute_recurring') {
      const recurringId = body.recurringId || body.recurring_id
      const txnDate = body.txnDate || body.txn_date
      const docNumber = body.docNumber || body.doc_number

      if (!recurringId) {
        return NextResponse.json({ error: 'recurringId is required' }, { status: 400 })
      }

      const { data: rec, error: recErr } = await supabase
        .from('external_accounting_recurring')
        .select('*')
        .eq('id', recurringId)
        .eq('company_realm_id', realmId)
        .maybeSingle()

      if (recErr || !rec) {
        return NextResponse.json(
          { error: 'Plantilla recurrente no encontrada en la empresa seleccionada (realmId mismatch).' },
          { status: 404 }
        )
      }

      const effectiveDate = txnDate || new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
      const periodCheckRec = await ensureOpenAccountingPeriod(effectiveDate, 'execute_recurring')
      if (!periodCheckRec.allowed) {
        return periodCheckRec.response
      }

      const tType = rec.txn_type || 'Deposit'
      const direction = tType === 'Deposit' || tType === 'Payment'
        ? 'IN'
        : tType === 'Invoice' || tType === 'Bill'
          ? 'ACCRUAL'
          : tType === 'JournalEntry'
            ? 'JOURNAL'
            : 'OUT'

      // Resolve fallback A/R, A/P, or Bank account if template didn't store account_qb_id
      let resolvedAcctQbId = rec.account_qb_id
      let resolvedAcctName = rec.account_name
      if (!resolvedAcctQbId) {
        const fallbackType = tType === 'Invoice'
          ? 'Accounts Receivable'
          : tType === 'Bill'
            ? 'Accounts Payable'
            : 'Bank'
        const fallbackAcc = (companyAccounts || []).find(a => a.account_type === fallbackType && a.is_active)
        if (fallbackAcc) {
          resolvedAcctQbId = fallbackAcc.qb_account_id
          resolvedAcctName = fallbackAcc.name
        }
      }

      const lines = Array.isArray(rec.line_items) ? rec.line_items : []
      const categories = Array.from(new Set(lines.map((l: any) => l.account_name).filter(Boolean)))

      let resolvedRecDocNumber = docNumber || lines[0]?.check_num || null
      if (!resolvedRecDocNumber) {
        if (tType === 'Invoice' || tType === 'Estimate') {
          const { data: existingDocs } = await supabase
            .from('external_accounting_transactions')
            .select('txn_type, doc_number')
            .eq('company_realm_id', realmId)
            .eq('txn_type', tType)
          resolvedRecDocNumber = computeNextSequentialDocNumber(existingDocs || [], tType, 1000)
        } else {
          resolvedRecDocNumber = 'EFT'
        }
      }

      // Compute next_date on recurring template BEFORE atomic RPC so it updates inside the same PostgreSQL transaction
      const baseNext = new Date(`${effectiveDate}T12:00:00Z`)
      const intervalCount = Number(rec.num_interval || 1)
      if (rec.interval_type === 'Weekly') {
        baseNext.setUTCDate(baseNext.getUTCDate() + 7 * intervalCount)
      } else if (rec.interval_type === 'Yearly') {
        baseNext.setUTCFullYear(baseNext.getUTCFullYear() + intervalCount)
      } else {
        baseNext.setUTCMonth(baseNext.getUTCMonth() + intervalCount)
      }
      const nextDateStr = baseNext.toISOString().split('T')[0]

      const recTxnPayload: Record<string, any> = {
        company_realm_id: realmId,
        txn_type: tType,
        qb_entity_type: tType === 'Check' || tType === 'Expense' ? 'Purchase' : tType,
        qb_txn_id: `REC-${Date.now()}`,
        txn_date: effectiveDate,
        doc_number: resolvedRecDocNumber,
        payment_type: tType,
        direction,
        account_qb_id: resolvedAcctQbId,
        account_name: resolvedAcctName,
        to_account_qb_id: lines[0]?.account_qb_id || null,
        to_account_name: lines[0]?.account_name || null,
        entity_qb_id: rec.entity_qb_id,
        entity_name: rec.entity_name || rec.template_name,
        entity_type: direction === 'IN' || tType === 'Invoice' ? 'Customer' : 'Vendor',
        department_name: rec.department_name || null,
        total_amount: Number(rec.amount || 0),
        open_balance: (tType === 'Invoice' || tType === 'Bill') ? Number(rec.amount || 0) : 0,
        memo: rec.memo || `Recurring: ${rec.template_name}`,
        category_summary: categories.join(', ') || rec.template_name,
        print_status: 'NotSet',
        cleared_status: 'Cleared',
        is_voided: false,
        line_items: lines,
        created_by: `${auth.user.name || auth.user.email} (Recurring)`,
        advance_recurring_template: {
          id: rec.id,
          previous_date: effectiveDate,
          next_date: nextDateStr,
        },
      }

      const recValidation = validateBalancedTransactionPostings(recTxnPayload, ledgerCtx)
      if (!recValidation.valid) {
        return NextResponse.json({ error: recValidation.error, postingValidation: recValidation, rolledBack: true }, { status: 400 })
      }

      const recBalancePlan = await prepareAtomicEntityAndInvoiceBalancePlan(supabase, realmId, recTxnPayload, {
        operation: 'UPSERT',
        forceInvoiceUpdateFailureId: isTestFaultInjectionAllowed
          ? body.force_invoice_update_failure_id || null
          : null,
        forceContactUpdateFailure: isTestFaultInjectionAllowed
          ? Boolean(body.force_contact_update_failure)
          : false,
      })
      recTxnPayload.line_items = recBalancePlan.updatedLineItems
      if (recBalancePlan.selfOpenBalance !== undefined) {
        recTxnPayload.open_balance = recBalancePlan.selfOpenBalance
      }
      if (recBalancePlan.selfRawData !== undefined) {
        recTxnPayload.raw_data = recBalancePlan.selfRawData
      }

      const isCompanyQboSyncEnabled = serverQboSyncEnabled
      const deltas = computeTransactionAccountDeltas(acctByQbId, recTxnPayload, 1, ledgerCtx)
      let atomicRec: Awaited<ReturnType<typeof mutateTransactionAtomically>>
      try {
        atomicRec = await mutateTransactionAtomically(supabase, {
          operation: 'UPSERT',
          realmId,
          txn: recTxnPayload,
          deltas,
          invoiceUpdates: recBalancePlan.invoiceUpdates,
          contactDeltas: recBalancePlan.contactDeltas,
          user: auth.user,
          audit: {
            actionType: 'EXECUTE_RECURRING',
            entityType: tType,
            docNumber: resolvedRecDocNumber,
            amount: Number(rec.amount || 0),
            summary: `Ejecutó plantilla recurrente "${rec.template_name}" (${tType} por $${Number(rec.amount || 0).toFixed(2)})`,
          },
          outbox: {
            entityKind: 'TRANSACTION',
            entityType: recTxnPayload.qb_entity_type,
            qbEntityId: recTxnPayload.qb_txn_id,
            operation: 'UPSERT',
            idempotencyKey: `TXN-REC-${realmId}-${recTxnPayload.qb_txn_id}`,
            payload: recTxnPayload,
            status: isCompanyQboSyncEnabled ? 'PENDING' : 'SKIPPED_LOCAL_ONLY',
          },
        })
      } catch (recExecErr: any) {
        return NextResponse.json(
          { error: recExecErr.message || 'Error atómico al ejecutar plantilla recurrente.', rolledBack: true },
          { status: 400 }
        )
      }

      const createdTxn = atomicRec.transaction

      if (atomicRec.outboxId && isCompanyQboSyncEnabled) {
        await processSingleOutboxEntry(supabase, atomicRec.outboxId, { forceNow: true })
      }

      return NextResponse.json({ success: true, transaction: createdTxn, outboxId: atomicRec.outboxId, nextDate: nextDateStr })
    }

    // -------------------------------------------------------------------------
    // 6. SAVE RECURRING TEMPLATE
    // -------------------------------------------------------------------------
    if (action === 'save_recurring') {
      const {
        id,
        template_name,
        recur_type,
        txn_type,
        interval_type,
        num_interval,
        next_date,
        account_qb_id,
        account_name,
        gl_account_qb_id,
        gl_account_name,
        entity_qb_id,
        entity_name,
        department_name,
        amount,
        memo,
        line_items,
        raw_payload
      } = body

      if (!template_name) {
        return NextResponse.json({ error: 'template_name is required' }, { status: 400 })
      }

      if (account_qb_id && !acctByQbId.has(account_qb_id)) {
        return NextResponse.json({ error: 'La cuenta bancaria no pertenece a la empresa activa.' }, { status: 400 })
      }
      if (gl_account_qb_id && !acctByQbId.has(gl_account_qb_id)) {
        return NextResponse.json({ error: 'La cuenta contable GL no pertenece a la empresa activa.' }, { status: 400 })
      }

      let resolvedLines: any[] = Array.isArray(line_items) ? line_items : []
      if (gl_account_qb_id) {
        resolvedLines = [{
          id: '1',
          line_num: 1,
          account_qb_id: gl_account_qb_id,
          account_name: acctByQbId.get(gl_account_qb_id)?.name || gl_account_name || '',
          description: memo || template_name,
          amount: Number(amount || 0)
        }]
      } else if (resolvedLines.length === 0 && raw_payload) {
        const innerKey = Object.keys(raw_payload)[0]
        const rawLines = raw_payload[innerKey]?.Line || []
        resolvedLines = rawLines
          .map((rl: any, idx: number) => {
            const accRef = rl.AccountBasedExpenseLineDetail?.AccountRef
              || rl.DepositLineDetail?.AccountRef
              || rl.JournalEntryLineDetail?.AccountRef
              || rl.SalesItemLineDetail?.ItemAccountRef
              || rl.SalesItemLineDetail?.ItemRef
            if (!accRef) return null
            return {
              id: String(idx + 1),
              line_num: idx + 1,
              account_qb_id: accRef.value,
              account_name: acctByQbId.get(accRef.value)?.name || accRef.name || '',
              description: rl.Description || memo || template_name,
              amount: Number(rl.Amount || amount || 0)
            }
          })
          .filter(Boolean)
      }

      for (const l of resolvedLines) {
        if (l.account_qb_id && !acctByQbId.has(l.account_qb_id)) {
          return NextResponse.json({ error: `La cuenta (${l.account_qb_id}) no pertenece a la empresa activa.` }, { status: 400 })
        }
      }

      const payload: Record<string, any> = {
        id: id || undefined,
        company_realm_id: realmId,
        qb_recurring_id: id ? undefined : `LOCAL-REC-${Date.now()}`,
        template_name,
        recur_type: recur_type || 'Automated',
        txn_type: txn_type || 'Deposit',
        interval_type: interval_type || 'Monthly',
        num_interval: Number(num_interval || 1),
        next_date: next_date || null,
        account_qb_id: account_qb_id || null,
        account_name: account_qb_id ? (acctByQbId.get(account_qb_id)?.name || account_name || null) : null,
        entity_qb_id: entity_qb_id || null,
        entity_name: entity_name || template_name,
        department_name: department_name || null,
        amount: Number(amount || 0),
        memo: memo || null,
        line_items: resolvedLines,
        is_active: true,
        updated_at: new Date().toISOString()
      }

      const isCompanyQboSyncEnabled = serverQboSyncEnabled
      const atomicRecEntity = await mutateEntityAtomically(supabase, {
        entityKind: 'RECURRING',
        operation: 'UPSERT',
        realmId,
        record: payload,
        user: auth.user,
        audit: {
          actionType: id ? 'EDIT_RECURRING' : 'CREATE_RECURRING',
          entityType: 'RecurringTemplate',
          entityId: id || undefined,
          amount: Number(amount || 0),
          summary: `${id ? 'Editó' : 'Creó'} plantilla recurrente "${template_name}" (${txn_type || 'Deposit'} por $${Number(amount || 0).toFixed(2)})`,
        },
        outbox: {
          idempotencyKey: `REC-UPSERT-${realmId}-${id || payload.qb_recurring_id}-${Date.now()}`,
          status: isCompanyQboSyncEnabled ? 'PENDING' : 'SKIPPED_LOCAL_ONLY',
          payload,
        },
      })

      if (atomicRecEntity.outboxId && isCompanyQboSyncEnabled) {
        await processSingleOutboxEntry(supabase, atomicRecEntity.outboxId, { forceNow: true })
      }

      return NextResponse.json({
        success: true,
        recurring: atomicRecEntity.record,
        outboxId: atomicRecEntity.outboxId,
      })
    }

    // -------------------------------------------------------------------------
    // 7. DELETE RECURRING TEMPLATE
    // -------------------------------------------------------------------------
    if (action === 'delete_recurring') {
      const { id } = body
      if (!id) {
        return NextResponse.json({ error: 'id is required' }, { status: 400 })
      }

      const isCompanyQboSyncEnabled = serverQboSyncEnabled
      const atomicDelRec = await mutateEntityAtomically(supabase, {
        entityKind: 'RECURRING',
        operation: 'DELETE',
        realmId,
        record: { id },
        user: auth.user,
        audit: {
          actionType: 'DELETE_RECURRING',
          entityType: 'RecurringTemplate',
          entityId: id,
          summary: `Eliminó plantilla recurrente #${id}`,
        },
        outbox: {
          idempotencyKey: `REC-DELETE-${realmId}-${id}-${Date.now()}`,
          status: isCompanyQboSyncEnabled ? 'PENDING' : 'SKIPPED_LOCAL_ONLY',
          payload: { id },
        },
      })

      if (atomicDelRec.outboxId && isCompanyQboSyncEnabled) {
        await processSingleOutboxEntry(supabase, atomicDelRec.outboxId, { forceNow: true })
      }

      return NextResponse.json({ success: true, outboxId: atomicDelRec.outboxId })
    }

    // -------------------------------------------------------------------------
    // 8. SAVE ACCOUNT (Chart of Accounts)
    // -------------------------------------------------------------------------
    if (action === 'save_account') {
      const {
        id,
        name,
        acct_num,
        classification,
        account_type,
        account_sub_type,
        current_balance,
        description,
        is_sub_account,
        parent_qb_id,
        is_active,
      } = body
      if (!name || !account_type) {
        return NextResponse.json({ error: 'Name and account_type are required' }, { status: 400 })
      }
      // Auto-derive accurate classification from account_type if not explicitly aligned
      const tLow = String(account_type || '').toLowerCase()
      const derivedClass =
        tLow.includes('payable') || tLow.includes('credit card') || tLow.includes('liability') ? 'Liability' :
        tLow.includes('equity') ? 'Equity' :
        tLow.includes('income') || tLow.includes('revenue') ? 'Revenue' :
        tLow.includes('expense') || tLow.includes('cost of goods') ? 'Expense' :
        (classification || 'Asset')

      const parentAcc = parent_qb_id ? acctByQbId.get(String(parent_qb_id)) : null
      const fqn = is_sub_account && parentAcc ? `${parentAcc.name}:${name}` : name

      let existingRaw: Record<string, any> = {}
      let existingIsActive = true
      let existingQbAccountId: string | undefined = undefined
      if (id) {
        const { data: existingAcc } = await supabase
          .from('external_accounting_accounts')
          .select('id, qb_account_id, raw_data, is_active')
          .eq('id', id)
          .eq('company_realm_id', realmId)
          .maybeSingle()

        if (!existingAcc) {
          return NextResponse.json(
            { error: 'La cuenta no existe o pertenece a otra empresa (realmId mismatch).' },
            { status: 404 }
          )
        }
        existingRaw = existingAcc.raw_data && typeof existingAcc.raw_data === 'object' ? existingAcc.raw_data : {}
        existingIsActive = existingAcc.is_active
        existingQbAccountId = existingAcc.qb_account_id
      }

      const nextRaw = description !== undefined
        ? { ...existingRaw, Description: description || null }
        : existingRaw

      const signedBalance = fromNaturalBalance(
        { account_type, classification: derivedClass },
        Number(current_balance || 0)
      )

      const accPayload: Record<string, any> = {
        id: id || undefined,
        company_realm_id: realmId,
        qb_account_id: existingQbAccountId || `LOCAL-ACC-${Date.now()}`,
        name,
        fully_qualified_name: fqn,
        acct_num: acct_num || null,
        classification: derivedClass,
        account_type,
        account_sub_type: account_sub_type || account_type,
        current_balance: signedBalance,
        initial_qbo_balance: signedBalance,
        is_sub_account: Boolean(is_sub_account && parent_qb_id),
        parent_qb_id: is_sub_account && parent_qb_id ? String(parent_qb_id) : null,
        is_active: is_active !== undefined ? Boolean(is_active) : existingIsActive,
        raw_data: nextRaw,
      }

      const isCompanyQboSyncEnabled = serverQboSyncEnabled
      const atomicAccRes = await mutateEntityAtomically(supabase, {
        entityKind: 'ACCOUNT',
        operation: 'UPSERT',
        realmId,
        record: accPayload,
        user: auth.user,
        audit: {
          actionType: id ? 'EDIT_ACCOUNT' : 'CREATE_ACCOUNT',
          entityType: 'Account',
          entityId: id || undefined,
          amount: Number(current_balance || 0),
          summary: `${id ? 'Editó' : 'Creó'} cuenta contable "${name}" (${account_type})`,
        },
        outbox: {
          idempotencyKey: `ACC-UPSERT-${realmId}-${accPayload.qb_account_id}-${Date.now()}`,
          status: isCompanyQboSyncEnabled ? 'PENDING' : 'SKIPPED_LOCAL_ONLY',
          payload: accPayload,
        },
      })

      const savedAcc = atomicAccRes.record
      let qboSync: any = {
        synced: false,
        status: !isCompanyQboSyncEnabled ? 'SKIPPED_LOCAL_ONLY' : 'PENDING_QBO_OUTBOX',
      }
      if (atomicAccRes.outboxId && isCompanyQboSyncEnabled) {
        const outboxRes = await processSingleOutboxEntry(supabase, atomicAccRes.outboxId, { forceNow: true })
        qboSync = {
          synced: outboxRes.status === 'SYNCED',
          status: outboxRes.status,
          qbAccountId: outboxRes.qbId,
          error: outboxRes.error,
        }
        if (outboxRes.qbId) {
          savedAcc.qb_account_id = outboxRes.qbId
        }
      }

      return NextResponse.json({ success: true, account: savedAcc, outboxId: atomicAccRes.outboxId, qboSync })
    }

    if (action === 'delete_account') {
      const { id, qb_account_id } = body
      if (!id && !qb_account_id) {
        return NextResponse.json({ error: 'Account id or qb_account_id is required' }, { status: 400 })
      }
      let query = supabase
        .from('external_accounting_accounts')
        .select('*')
        .eq('company_realm_id', realmId)
      if (id) {
        query = query.eq('id', id)
      } else {
        query = query.eq('qb_account_id', String(qb_account_id))
      }
      const { data: existingAcc } = await query.maybeSingle()
      if (!existingAcc) {
        return NextResponse.json({ error: 'Cuenta contable no encontrada en la empresa activa.' }, { status: 404 })
      }

      const isCompanyQboSyncEnabled = serverQboSyncEnabled
      const atomicDelAcc = await mutateEntityAtomically(supabase, {
        entityKind: 'ACCOUNT',
        operation: 'DELETE',
        realmId,
        record: { id: existingAcc.id, qb_account_id: existingAcc.qb_account_id },
        user: auth.user,
        audit: {
          actionType: 'DELETE_ACCOUNT',
          entityType: 'Account',
          entityId: existingAcc.id,
          docNumber: existingAcc.acct_num || existingAcc.qb_account_id,
          amount: Number(existingAcc.current_balance || 0),
          summary: `Eliminó cuenta contable "${existingAcc.name}" (${existingAcc.account_type})`,
        },
        outbox: {
          idempotencyKey: `ACC-DELETE-${realmId}-${existingAcc.qb_account_id}-${Date.now()}`,
          status: isCompanyQboSyncEnabled ? 'PENDING' : 'SKIPPED_LOCAL_ONLY',
          payload: existingAcc,
        },
      })

      let qboSync: any = {
        synced: false,
        status: !isCompanyQboSyncEnabled ? 'SKIPPED_LOCAL_ONLY' : 'PENDING_QBO_OUTBOX',
      }
      if (atomicDelAcc.outboxId && isCompanyQboSyncEnabled) {
        const outboxRes = await processSingleOutboxEntry(supabase, atomicDelAcc.outboxId, { forceNow: true })
        qboSync = {
          synced: outboxRes.status === 'SYNCED',
          status: outboxRes.status,
          error: outboxRes.error,
        }
      }

      return NextResponse.json({ success: true, outboxId: atomicDelAcc.outboxId, qboSync })
    }

    // -------------------------------------------------------------------------
    // 9. SAVE / DELETE CONTACT (Vendor / Customer)
    // -------------------------------------------------------------------------
    if (action === 'save_contact') {
      const {
        id,
        contact_type,
        display_name,
        company_name,
        print_on_check_name,
        email,
        phone,
        tax_identifier,
        vendor_1099,
        acct_num,
        address,
        balance,
        is_active,
      } = body
      if (!display_name) {
        return NextResponse.json({ error: 'display_name is required' }, { status: 400 })
      }

      let existingCon: any = null
      if (id) {
        const { data: foundCon } = await supabase
          .from('external_accounting_contacts')
          .select('id, qb_contact_id, address, acct_num, balance, is_active, print_on_check_name, raw_data')
          .eq('id', id)
          .eq('company_realm_id', realmId)
          .maybeSingle()

        if (!foundCon) {
          return NextResponse.json(
            { error: 'El contacto no existe o pertenece a otra empresa (realmId mismatch).' },
            { status: 404 }
          )
        }
        existingCon = foundCon
      }

      const conPayload: Record<string, any> = {
        id: id || undefined,
        company_realm_id: realmId,
        contact_type: contact_type || 'Vendor',
        qb_contact_id: existingCon?.qb_contact_id || `LOCAL-CON-${Date.now()}`,
        display_name,
        company_name: company_name || display_name,
        print_on_check_name: print_on_check_name || existingCon?.print_on_check_name || display_name,
        email: email || null,
        phone: phone || null,
        tax_identifier: tax_identifier || null,
        vendor_1099: Boolean(vendor_1099),
        acct_num: acct_num !== undefined ? (acct_num || null) : (existingCon?.acct_num || null),
        address: address !== undefined ? (address || {}) : (existingCon?.address || {}),
        balance: balance !== undefined ? Number(balance || 0) : Number(existingCon?.balance || 0),
        is_active: is_active !== undefined ? Boolean(is_active) : (existingCon ? existingCon.is_active : true),
        raw_data: existingCon?.raw_data || {},
      }

      const isCompanyQboSyncEnabled = serverQboSyncEnabled
      const atomicConRes = await mutateEntityAtomically(supabase, {
        entityKind: 'CONTACT',
        operation: 'UPSERT',
        realmId,
        record: conPayload,
        user: auth.user,
        audit: {
          actionType: id ? 'EDIT_CONTACT' : 'CREATE_CONTACT',
          entityType: contact_type || 'Vendor',
          entityId: id || undefined,
          summary: `${id ? 'Editó' : 'Creó'} ${contact_type || 'Vendor'} "${display_name}"${vendor_1099 ? ' (1099)' : ''}`,
        },
        outbox: {
          idempotencyKey: `CON-UPSERT-${realmId}-${conPayload.qb_contact_id}-${Date.now()}`,
          status: isCompanyQboSyncEnabled ? 'PENDING' : 'SKIPPED_LOCAL_ONLY',
          payload: conPayload,
        },
      })

      const savedCon = atomicConRes.record
      let qboSync: any = {
        synced: false,
        status: !isCompanyQboSyncEnabled ? 'SKIPPED_LOCAL_ONLY' : 'PENDING_QBO_OUTBOX',
      }
      if (atomicConRes.outboxId && isCompanyQboSyncEnabled) {
        const outboxRes = await processSingleOutboxEntry(supabase, atomicConRes.outboxId, { forceNow: true })
        qboSync = {
          synced: outboxRes.status === 'SYNCED',
          status: outboxRes.status,
          qbContactId: outboxRes.qbId,
          error: outboxRes.error,
        }
        if (outboxRes.qbId) {
          savedCon.qb_contact_id = outboxRes.qbId
        }
      }

      return NextResponse.json({ success: true, contact: savedCon, outboxId: atomicConRes.outboxId, qboSync })
    }

    if (action === 'delete_contact') {
      const { id, qb_contact_id } = body
      if (!id && !qb_contact_id) {
        return NextResponse.json({ error: 'Contact id or qb_contact_id is required' }, { status: 400 })
      }
      let query = supabase
        .from('external_accounting_contacts')
        .select('*')
        .eq('company_realm_id', realmId)
      if (id) {
        query = query.eq('id', id)
      } else {
        query = query.eq('qb_contact_id', String(qb_contact_id))
      }
      const { data: existingCon } = await query.maybeSingle()
      if (!existingCon) {
        return NextResponse.json({ error: 'Proveedor/Cliente no encontrado en la empresa activa.' }, { status: 404 })
      }

      const isCompanyQboSyncEnabled = serverQboSyncEnabled
      const atomicDelCon = await mutateEntityAtomically(supabase, {
        entityKind: 'CONTACT',
        operation: 'DELETE',
        realmId,
        record: { id: existingCon.id, qb_contact_id: existingCon.qb_contact_id },
        user: auth.user,
        audit: {
          actionType: 'DELETE_CONTACT',
          entityType: existingCon.contact_type || 'Vendor',
          entityId: existingCon.id,
          docNumber: existingCon.acct_num || existingCon.qb_contact_id,
          amount: Number(existingCon.balance || 0),
          summary: `Eliminó ${existingCon.contact_type || 'Vendor'} "${existingCon.display_name}"`,
        },
        outbox: {
          idempotencyKey: `CON-DELETE-${realmId}-${existingCon.qb_contact_id}-${Date.now()}`,
          status: isCompanyQboSyncEnabled ? 'PENDING' : 'SKIPPED_LOCAL_ONLY',
          payload: existingCon,
        },
      })

      let qboSync: any = {
        synced: false,
        status: !isCompanyQboSyncEnabled ? 'SKIPPED_LOCAL_ONLY' : 'PENDING_QBO_OUTBOX',
      }
      if (atomicDelCon.outboxId && isCompanyQboSyncEnabled) {
        const outboxRes = await processSingleOutboxEntry(supabase, atomicDelCon.outboxId, { forceNow: true })
        qboSync = {
          synced: outboxRes.status === 'SYNCED',
          status: outboxRes.status,
          error: outboxRes.error,
        }
      }

      return NextResponse.json({ success: true, outboxId: atomicDelCon.outboxId, qboSync })
    }

    // -------------------------------------------------------------------------
    // 9B. TWO-WAY SYNC WITH INTUIT QUICKBOOKS ONLINE V3 (`sync_with_qbo` & `toggle_qbo_mirror_mode`)
    // -------------------------------------------------------------------------
    if (action === 'sync_with_qbo') {
      const syncRes = await syncCompanyWithQbo(supabase, realmId)
      if (!syncRes.ok) {
        return NextResponse.json({ error: syncRes.error || 'Error sincronizando con QuickBooks Online', syncResult: syncRes }, { status: 400 })
      }
      await logExternalAccountingAudit(supabase, {
        realmId,
        user: auth.user,
        actionType: 'QBO_TWO_WAY_SYNC',
        entityType: 'Company',
        entityId: realmId,
        summary: `Sincronizó con QuickBooks Online: Push (${syncRes.pushedTransactions} txns, ${syncRes.pushedAccounts} cuentas, ${syncRes.pushedContacts} contactos) · Pull (${syncRes.pulledTransactions} txns, ${syncRes.pulledAccounts} cuentas, ${syncRes.pulledContacts} contactos)`
      })
      return NextResponse.json({ success: true, syncResult: syncRes })
    }

    if (action === 'sync_all_with_qbo') {
      const syncAllRes = await syncAllCompaniesWithQbo(supabase)
      if (!syncAllRes.ok) {
        return NextResponse.json({ error: 'Ninguna empresa pudo sincronizarse con QuickBooks Online', syncResult: syncAllRes }, { status: 400 })
      }
      await logExternalAccountingAudit(supabase, {
        realmId,
        user: auth.user,
        actionType: 'QBO_TWO_WAY_SYNC_ALL',
        entityType: 'Company',
        entityId: 'ALL_8_COMPANIES',
        summary: `Sincronización Masiva (${syncAllRes.companiesSynced}/${syncAllRes.companiesTotal} empresas): Push (${syncAllRes.pushedTransactions} txns, ${syncAllRes.pushedAccounts} cuentas, ${syncAllRes.pushedContacts} contactos) · Pull (${syncAllRes.pulledTransactions} txns, ${syncAllRes.pulledAccounts} cuentas, ${syncAllRes.pulledContacts} contactos)`
      })
      return NextResponse.json({ success: true, syncResult: syncAllRes })
    }

    if (action === 'toggle_qbo_mirror_mode') {
      const enabled = Boolean(body.enabled)
      const applyToAll = Boolean(body.applyToAll)

      if (applyToAll) {
        const { data: allComps } = await supabase.from('external_accounting_companies').select('realm_id, metadata')
        for (const c of allComps || []) {
          const m = c.metadata && typeof c.metadata === 'object' ? c.metadata : {}
          await supabase
            .from('external_accounting_companies')
            .update({ metadata: { ...m, qbo_sync_enabled: enabled }, updated_at: new Date().toISOString() })
            .eq('realm_id', c.realm_id)
        }
      } else {
        const { data: currComp } = await supabase
          .from('external_accounting_companies')
          .select('metadata')
          .eq('realm_id', realmId)
          .maybeSingle()
        const m = currComp?.metadata && typeof currComp.metadata === 'object' ? currComp.metadata : {}
        await supabase
          .from('external_accounting_companies')
          .update({ metadata: { ...m, qbo_sync_enabled: enabled }, updated_at: new Date().toISOString() })
          .eq('realm_id', realmId)
      }

      await logExternalAccountingAudit(supabase, {
        realmId,
        user: auth.user,
        actionType: 'TOGGLE_QBO_MIRROR_MODE',
        entityType: 'Company',
        entityId: realmId,
        summary: `${enabled ? 'Activó Modo Espejo QBO (Two-Way Sync)' : 'Activó Modo 100% Autónomo (QBO Desconectado)'}${applyToAll ? ' para las 8 empresas' : ''}`
      })

      return NextResponse.json({ success: true, qbo_sync_enabled: enabled })
    }

    // -------------------------------------------------------------------------
    // 10. BANK RECONCILIATION (Gear Menu ⚙️ -> Tools -> Reconcile) — 100% ACID RPC
    // -------------------------------------------------------------------------
    if (action === 'save_reconciliation') {
      const {
        id,
        account_qb_id,
        statement_ending_date,
        beginning_balance,
        ending_balance,
        cleared_balance,
        payments_count,
        payments_total,
        deposits_count,
        deposits_total,
        service_charge,
        service_charge_account_qb_id,
        interest_earned,
        interest_account_qb_id,
        auto_adjust_difference,
        adjustment_account_qb_id,
        reconciled_txn_ids,
        status,
        notes,
      } = body

      if (!account_qb_id || !statement_ending_date) {
        return NextResponse.json(
          { error: 'La cuenta bancaria y la fecha de corte del estado de cuenta son obligatorias.' },
          { status: 400 }
        )
      }
      const periodCheckSaveRec = await ensureOpenAccountingPeriod(statement_ending_date, 'save_reconciliation')
      if (!periodCheckSaveRec.allowed) {
        return periodCheckSaveRec.response
      }
      const bankAcc = acctByQbId.get(account_qb_id)
      if (!bankAcc) {
        return NextResponse.json(
          { error: `La cuenta (${account_qb_id}) no pertenece a la empresa activa.` },
          { status: 400 }
        )
      }

      const txnIdsList: string[] = Array.isArray(reconciled_txn_ids)
        ? Array.from(new Set(reconciled_txn_ids.map(String)))
        : []

      const isCompanyQboSyncEnabled = serverQboSyncEnabled
      const outboxInitialStatus: 'PENDING' | 'SKIPPED_LOCAL_ONLY' = isCompanyQboSyncEnabled ? 'PENDING' : 'SKIPPED_LOCAL_ONLY'

      let extraPaymentsCount = 0
      let extraPaymentsTotal = 0
      let extraDepositsCount = 0
      let extraDepositsTotal = 0
      const extraTransactions: Array<{
        txn: Record<string, any>
        deltas: Map<string, number>
        outbox?: {
          entityKind?: string
          entityType: string
          qbEntityId?: string | null
          operation: 'UPSERT'
          idempotencyKey: string
          payload?: Record<string, any>
          status?: 'PENDING' | 'SKIPPED_LOCAL_ONLY'
        }
      }> = []

      // Optional auto-create Bank Service Charge on statement ending date (inside atomic RPC when completing)
      const svcChargeAmt = Number(service_charge || 0)
      if (svcChargeAmt > 0 && status === 'Completed') {
        const explicitSvcAcc = service_charge_account_qb_id
          ? (acctByQbId.get(String(service_charge_account_qb_id)) || {
              qb_account_id: String(service_charge_account_qb_id),
              name: String(service_charge_account_qb_id),
              account_type: 'Expense',
            })
          : Array.from(acctByQbId.values()).find(
              a =>
                (a.name || '').toLowerCase().includes('bank charge') ||
                (a.name || '').toLowerCase().includes('service') ||
                a.account_type === 'Expense'
            )

        if (explicitSvcAcc) {
          const svcQbId = `LOCAL-SVC-${Date.now()}`
          const svcPayload: Record<string, any> = {
            company_realm_id: realmId,
            txn_type: 'Expense',
            qb_entity_type: 'Purchase',
            qb_txn_id: svcQbId,
            txn_date: statement_ending_date,
            payment_type: 'Expense',
            direction: 'OUT',
            account_qb_id: bankAcc.qb_account_id,
            account_name: bankAcc.name,
            to_account_qb_id: explicitSvcAcc.qb_account_id,
            to_account_name: explicitSvcAcc.name,
            entity_name: bankAcc.name,
            entity_type: 'Vendor',
            total_amount: svcChargeAmt,
            open_balance: 0,
            memo: `Bank Service Charge (${statement_ending_date})`,
            category_summary: explicitSvcAcc.name,
            cleared_status: status === 'Completed' ? 'Reconciled' : 'Cleared',
            is_voided: false,
            line_items: [{
              id: '1',
              line_num: 1,
              description: `Bank Service Charge (${statement_ending_date})`,
              amount: svcChargeAmt,
              account_qb_id: explicitSvcAcc.qb_account_id,
              account_name: explicitSvcAcc.name,
            }],
            created_by: auth.user.name || auth.user.email,
          }
          const svcDeltas = computeTransactionAccountDeltas(acctByQbId, svcPayload, 1, ledgerCtx)
          extraTransactions.push({
            txn: svcPayload,
            deltas: svcDeltas,
            outbox: {
              entityKind: 'TRANSACTION',
              entityType: 'Purchase',
              qbEntityId: svcQbId,
              operation: 'UPSERT',
              idempotencyKey: `REC-SVC-${realmId}-${svcQbId}`,
              payload: svcPayload,
              status: outboxInitialStatus,
            },
          })
          extraPaymentsCount += 1
          extraPaymentsTotal += svcChargeAmt
        }
      }

      // Optional auto-create Interest Earned on statement ending date (inside atomic RPC when completing)
      const intEarnedAmt = Number(interest_earned || 0)
      if (intEarnedAmt > 0 && status === 'Completed') {
        const explicitIntAcc = interest_account_qb_id
          ? (acctByQbId.get(String(interest_account_qb_id)) || {
              qb_account_id: String(interest_account_qb_id),
              name: String(interest_account_qb_id),
              account_type: 'Other Income',
            })
          : Array.from(acctByQbId.values()).find(
              a =>
                (a.name || '').toLowerCase().includes('interest') ||
                a.account_type === 'Other Income' ||
                a.account_type === 'Income'
            )

        if (explicitIntAcc) {
          const intQbId = `LOCAL-INT-${Date.now()}`
          const intPayload: Record<string, any> = {
            company_realm_id: realmId,
            txn_type: 'Deposit',
            qb_entity_type: 'Deposit',
            qb_txn_id: intQbId,
            txn_date: statement_ending_date,
            payment_type: 'Deposit',
            direction: 'IN',
            account_qb_id: bankAcc.qb_account_id,
            account_name: bankAcc.name,
            to_account_qb_id: explicitIntAcc.qb_account_id,
            to_account_name: explicitIntAcc.name,
            entity_name: bankAcc.name,
            entity_type: 'Customer',
            total_amount: intEarnedAmt,
            open_balance: 0,
            memo: `Interest Earned (${statement_ending_date})`,
            category_summary: explicitIntAcc.name,
            cleared_status: status === 'Completed' ? 'Reconciled' : 'Cleared',
            is_voided: false,
            line_items: [{
              id: '1',
              line_num: 1,
              description: `Interest Earned (${statement_ending_date})`,
              amount: intEarnedAmt,
              account_qb_id: explicitIntAcc.qb_account_id,
              account_name: explicitIntAcc.name,
            }],
            created_by: auth.user.name || auth.user.email,
          }
          const intDeltas = computeTransactionAccountDeltas(acctByQbId, intPayload, 1, ledgerCtx)
          extraTransactions.push({
            txn: intPayload,
            deltas: intDeltas,
            outbox: {
              entityKind: 'TRANSACTION',
              entityType: 'Deposit',
              qbEntityId: intQbId,
              operation: 'UPSERT',
              idempotencyKey: `REC-INT-${realmId}-${intQbId}`,
              payload: intPayload,
              status: outboxInitialStatus,
            },
          })
          extraDepositsCount += 1
          extraDepositsTotal += intEarnedAmt
        }
      }

      // Compute finalClearedBalance deterministically from beginning_balance + deposits_total - payments_total - svcChargeAmt + intEarnedAmt
      const isCc = (bankAcc.account_type || '').toLowerCase().includes('credit card')
      const baseBegin = Number(beginning_balance || 0)
      const basePay = Number(payments_total || 0)
      const baseDep = Number(deposits_total || 0)
      const computedFromParts = isCc
        ? Number((baseBegin + basePay + svcChargeAmt - baseDep - intEarnedAmt).toFixed(2))
        : Number((baseBegin - basePay - svcChargeAmt + baseDep + intEarnedAmt).toFixed(2))
      let finalClearedBalance = cleared_balance !== undefined && cleared_balance !== null
        ? Number(Number(cleared_balance).toFixed(2))
        : computedFromParts
      let finalDifference = Number((Number(ending_balance || 0) - finalClearedBalance).toFixed(2))

      // Strict Accounting Rule: Block completing reconciliation if difference != 0 unless an explicit, justified & audited adjustment is requested
      if (status === 'Completed' && Math.abs(finalDifference) >= 0.01) {
        if (!auto_adjust_difference) {
          return NextResponse.json(
            {
              error: `No se puede finalizar la conciliación con una diferencia de $${finalDifference.toFixed(2)}. Debe cuadrar a $0.00 o solicitar explícitamente un asiento de ajuste justificado y auditado (auto_adjust_difference + adjustment_reason).`,
              difference: finalDifference,
              requiresAdjustmentConfirmation: true,
            },
            { status: 400 }
          )
        }
        const adjustmentReason = String(body.adjustment_reason || body.adjustmentReason || body.notes || '').trim()
        if (!adjustmentReason) {
          return NextResponse.json(
            {
              error: `Para finalizar con asiento de ajuste por diferencia de $${finalDifference.toFixed(2)}, es obligatorio capturar una justificación contable explícita (adjustment_reason).`,
              difference: finalDifference,
              requiresJustification: true,
            },
            { status: 400 }
          )
        }

        const fallbackAdjAcc = adjustment_account_qb_id
          ? (acctByQbId.get(String(adjustment_account_qb_id)) || {
              qb_account_id: String(adjustment_account_qb_id),
              name: String(adjustment_account_qb_id),
              account_type: 'Expense',
            })
          : Array.from(acctByQbId.values()).find(
              a => (a.name || '').toLowerCase().includes('reconciliation') || a.account_type === 'Expense'
            )
        if (!fallbackAdjAcc) {
          return NextResponse.json(
            { error: 'No se encontró una cuenta contable válida para registrar el asiento de ajuste de conciliación.' },
            { status: 400 }
          )
        }

        const isPositiveDiff = finalDifference > 0 // Ending balance > Cleared balance -> need Deposit
        const adjAmt = Math.abs(finalDifference)
        const adjQbId = `LOCAL-ADJ-${Date.now()}`
        const adjPayload: Record<string, any> = {
          company_realm_id: realmId,
          txn_type: isPositiveDiff ? 'Deposit' : 'Expense',
          qb_entity_type: isPositiveDiff ? 'Deposit' : 'Purchase',
          qb_txn_id: adjQbId,
          txn_date: statement_ending_date,
          payment_type: isPositiveDiff ? 'Deposit' : 'Expense',
          direction: isPositiveDiff ? 'IN' : 'OUT',
          account_qb_id: bankAcc.qb_account_id,
          account_name: bankAcc.name,
          to_account_qb_id: fallbackAdjAcc.qb_account_id,
          to_account_name: fallbackAdjAcc.name,
          entity_name: 'Reconciliation Discrepancy Adjustment',
          entity_type: isPositiveDiff ? 'Customer' : 'Vendor',
          total_amount: adjAmt,
          open_balance: 0,
          memo: `Ajuste Auditado de Conciliación (${statement_ending_date}): ${adjustmentReason}`,
          category_summary: fallbackAdjAcc.name,
          cleared_status: 'Reconciled',
          is_voided: false,
          line_items: [{
            id: '1',
            line_num: 1,
            description: `Reconciliation Discrepancy Adjustment (${statement_ending_date}): ${adjustmentReason}`,
            amount: adjAmt,
            account_qb_id: fallbackAdjAcc.qb_account_id,
            account_name: fallbackAdjAcc.name,
          }],
          created_by: auth.user.name || auth.user.email,
        }
        const adjDeltas = computeTransactionAccountDeltas(acctByQbId, adjPayload, 1, ledgerCtx)
        extraTransactions.push({
          txn: adjPayload,
          deltas: adjDeltas,
          outbox: {
            entityKind: 'TRANSACTION',
            entityType: isPositiveDiff ? 'Deposit' : 'Purchase',
            qbEntityId: adjQbId,
            operation: 'UPSERT',
            idempotencyKey: `REC-ADJ-${realmId}-${adjQbId}`,
            payload: adjPayload,
            status: outboxInitialStatus,
          },
        })
        if (isPositiveDiff) {
          extraDepositsCount += 1
          extraDepositsTotal += adjAmt
        } else {
          extraPaymentsCount += 1
          extraPaymentsTotal += adjAmt
        }
        finalClearedBalance = Number(ending_balance || 0)
        finalDifference = 0
      }

      const finalStatus = status === 'Completed' ? 'Completed' : 'Draft'

      const recPayload: Record<string, any> = {
        id: id || undefined,
        company_realm_id: realmId,
        account_qb_id: bankAcc.qb_account_id,
        account_name: bankAcc.name,
        statement_ending_date,
        beginning_balance: Number(beginning_balance || 0),
        ending_balance: Number(ending_balance || 0),
        cleared_balance: finalClearedBalance,
        difference: finalDifference,
        payments_count: Number(payments_count || 0) + extraPaymentsCount,
        payments_total: Number((Number(payments_total || 0) + extraPaymentsTotal).toFixed(2)),
        deposits_count: Number(deposits_count || 0) + extraDepositsCount,
        deposits_total: Number((Number(deposits_total || 0) + extraDepositsTotal).toFixed(2)),
        service_charge: svcChargeAmt,
        interest_earned: intEarnedAmt,
        status: finalStatus,
        notes: notes || null,
      }

      try {
        const atomicRecResult = await saveReconciliationAtomically(supabase, {
          realmId,
          reconciliation: recPayload,
          reconciledTxnIds: txnIdsList,
          extraTransactions,
          user: auth.user,
          audit: {
            actionType: finalStatus === 'Completed' ? 'RECONCILE_BANK_COMPLETED' : 'RECONCILE_BANK_DRAFT',
            entityType: 'Reconciliation',
            docNumber: statement_ending_date,
            amount: Number(ending_balance || 0),
            summary: `${finalStatus === 'Completed' ? 'Finalizó conciliación bancaria' : 'Guardó borrador de conciliación'} de ${bankAcc.name} al ${statement_ending_date} (Saldo Final: $${Number(ending_balance || 0).toFixed(2)}, Diferencia: $${finalDifference.toFixed(2)})`,
            details: {
              account_name: bankAcc.name,
              payments_count: recPayload.payments_count,
              deposits_count: recPayload.deposits_count,
              difference: finalDifference,
              extra_txn_count: extraTransactions.length,
            },
          },
        })

        if (isCompanyQboSyncEnabled && atomicRecResult.outboxIds.length > 0) {
          for (const outId of atomicRecResult.outboxIds) {
            await processSingleOutboxEntry(supabase, outId, { forceNow: true })
          }
        }

        return NextResponse.json({
          success: true,
          reconciliation: atomicRecResult.reconciliation,
          extraTxnIds: atomicRecResult.extraTxnIds,
          outboxIds: atomicRecResult.outboxIds,
        })
      } catch (recRpcErr: any) {
        return NextResponse.json(
          { error: recRpcErr.message || 'Error en transacción atómica de conciliación bancaria.', rolledBack: true },
          { status: 400 }
        )
      }
    }

    if (action === 'reopen_reconciliation') {
      const { id } = body
      if (!id) {
        return NextResponse.json({ error: 'Reconciliation id is required' }, { status: 400 })
      }
      const { data: existingRec } = await supabase
        .from('external_accounting_reconciliations')
        .select('*')
        .eq('id', id)
        .eq('company_realm_id', realmId)
        .maybeSingle()

      if (!existingRec) {
        return NextResponse.json({ error: 'Conciliación no encontrada en esta empresa.' }, { status: 404 })
      }
      const periodCheckReopenRec = await ensureOpenAccountingPeriod(existingRec.statement_ending_date, 'reopen_reconciliation')
      if (!periodCheckReopenRec.allowed) {
        return periodCheckReopenRec.response
      }

      const reopenRes = await reopenOrDeleteReconciliationAtomically(supabase, {
        operation: 'REOPEN',
        realmId,
        reconciliationId: id,
        user: auth.user,
      })

      return NextResponse.json({ success: true, reconciliation: reopenRes.reconciliation })
    }

    if (action === 'delete_reconciliation') {
      const { id } = body
      if (!id) {
        return NextResponse.json({ error: 'Reconciliation id is required' }, { status: 400 })
      }
      const { data: existingRec } = await supabase
        .from('external_accounting_reconciliations')
        .select('*')
        .eq('id', id)
        .eq('company_realm_id', realmId)
        .maybeSingle()

      if (!existingRec) {
        return NextResponse.json({ error: 'Conciliación no encontrada en esta empresa.' }, { status: 404 })
      }
      const periodCheckDelRec = await ensureOpenAccountingPeriod(existingRec.statement_ending_date, 'delete_reconciliation')
      if (!periodCheckDelRec.allowed) {
        return periodCheckDelRec.response
      }

      await reopenOrDeleteReconciliationAtomically(supabase, {
        operation: 'DELETE',
        realmId,
        reconciliationId: id,
        user: auth.user,
      })

      return NextResponse.json({ success: true })
    }

    // -------------------------------------------------------------------------
    // 11. RECLASSIFY TRANSACTIONS IN BATCH (Gear Menu ⚙️ -> Tools -> Reclassify Transactions) — 100% ACID RPC
    // -------------------------------------------------------------------------
    if (action === 'reclassify_transactions') {
      const rawReclassIds = Array.isArray(body.txnIds)
        ? body.txnIds
        : Array.isArray(body.transactionIds)
        ? body.transactionIds
        : Array.isArray(body.txn_ids)
        ? body.txn_ids
        : []
      const txnIds: string[] = rawReclassIds.map(String)
      const targetAccountQbId = body.targetAccountQbId || body.newAccountQbId || body.target_account_qb_id || null
      const targetEntityName = body.targetEntityName || body.target_entity_name || null
      const targetDepartmentName = body.targetDepartmentName || body.target_department_name || null
      if (!Array.isArray(txnIds) || txnIds.length === 0) {
        return NextResponse.json({ error: 'Selecciona al menos una transacción para reclasificar.' }, { status: 400 })
      }
      if (!targetAccountQbId && !targetEntityName && !targetDepartmentName) {
        return NextResponse.json({ error: 'Debes indicar la nueva cuenta contable, beneficiario o departamento.' }, { status: 400 })
      }

      const targetAcc = targetAccountQbId ? acctByQbId.get(String(targetAccountQbId)) : null
      if (targetAccountQbId && !targetAcc) {
        return NextResponse.json({ error: 'La cuenta destino no pertenece a la empresa activa.' }, { status: 400 })
      }

      const { data: txnsToUpdate, error: loadErr } = await supabase
        .from('external_accounting_transactions')
        .select('*')
        .eq('company_realm_id', realmId)
        .in('id', txnIds.filter(idStr => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idStr)))

      if (loadErr) throw loadErr
      const closedRow = companyClosingDate
        ? (txnsToUpdate || []).find(r => r.txn_date && r.txn_date <= companyClosingDate)
        : null
      if (closedRow) {
        const periodCheckReclass = await ensureOpenAccountingPeriod(closedRow.txn_date, 'reclassify_transactions')
        if (!periodCheckReclass.allowed) {
          return periodCheckReclass.response
        }
      }

      const foundById = new Map<string, any>()
      for (const r of txnsToUpdate || []) {
        foundById.set(String(r.id), r)
      }

      const isCompanyQboSyncEnabled = serverQboSyncEnabled
      const outboxInitialStatus: 'PENDING' | 'SKIPPED_LOCAL_ONLY' = isCompanyQboSyncEnabled ? 'PENDING' : 'SKIPPED_LOCAL_ONLY'

      const batchItems: Array<{
        operation: 'UPSERT'
        txn: Record<string, any>
        deltas: Map<string, number>
        outbox?: {
          entityKind?: string
          entityType: string
          qbEntityId?: string | null
          operation: 'UPSERT'
          idempotencyKey: string
          payload?: Record<string, any>
          status?: 'PENDING' | 'SKIPPED_LOCAL_ONLY'
        }
      }> = []

      let totalAmountReclassified = 0

      for (const reqId of txnIds) {
        const row = foundById.get(String(reqId))
        if (!row || row.is_voided || row.txn_type === 'Transfer' || row.txn_type === 'JournalEntry') {
          // Force atomic rollback inside PostgreSQL RPC after previous valid items have executed in the transaction
          batchItems.push({
            operation: 'UPSERT',
            txn: {
              company_realm_id: realmId,
              txn_type: 'Expense',
              qb_entity_type: 'Purchase',
              qb_txn_id: `INVALID-RECLASSIFY-${reqId}`,
              txn_date: new Date().toISOString().slice(0, 10),
              account_qb_id: '__INVALID_RECLASSIFY_TARGET_TXN__',
              total_amount: 0,
              line_items: [],
            },
            deltas: new Map(),
          })
          continue
        }

        const oldRev = computeTransactionAccountDeltas(acctByQbId, row, -1, ledgerCtx)
        const existingLines = Array.isArray(row.line_items) && row.line_items.length > 0
          ? row.line_items
          : [{
              id: '1',
              line_num: 1,
              description: row.memo || '',
              amount: Number(row.total_amount || 0),
              account_qb_id: row.to_account_qb_id,
              account_name: row.to_account_name || row.category_summary,
            }]

        const newLines = existingLines.map((l: any) => ({
          ...l,
          account_qb_id: targetAcc ? targetAcc.qb_account_id : l.account_qb_id,
          account_name: targetAcc ? targetAcc.name : l.account_name,
          entity_name: targetEntityName ? targetEntityName.trim() : l.entity_name,
        }))

        const mergedRow: Record<string, any> = {
          ...row,
          to_account_qb_id: targetAcc ? targetAcc.qb_account_id : row.to_account_qb_id,
          to_account_name: targetAcc ? targetAcc.name : row.to_account_name,
          category_summary: targetAcc ? targetAcc.name : row.category_summary,
          entity_name: targetEntityName ? targetEntityName.trim() : row.entity_name,
          department_name: targetDepartmentName ? targetDepartmentName.trim() : row.department_name,
          line_items: newLines,
          raw_data: markRawAsLocallyEdited(row.raw_data),
          updated_at: new Date().toISOString(),
        }

        const newApp = computeTransactionAccountDeltas(acctByQbId, mergedRow, 1, ledgerCtx)
        const rowNet = mergeAccountDeltas(oldRev, newApp)
        totalAmountReclassified += Number(row.total_amount || 0)

        batchItems.push({
          operation: 'UPSERT',
          txn: mergedRow,
          deltas: rowNet,
          outbox: {
            entityKind: 'TRANSACTION',
            entityType: mergedRow.qb_entity_type || mergedRow.txn_type,
            qbEntityId: mergedRow.qb_txn_id,
            operation: 'UPSERT',
            idempotencyKey: `TXN-RECLASS-${realmId}-${mergedRow.qb_txn_id}-${Date.now()}`,
            payload: mergedRow,
            status: outboxInitialStatus,
          },
        })
      }

      try {
        const batchRes = await batchMutateTransactionsAtomically(supabase, {
          realmId,
          items: batchItems,
          user: auth.user,
          outboxStatus: outboxInitialStatus,
          batchAudit: {
            actionType: 'RECLASSIFY_BATCH',
            entityType: 'BatchReclassify',
            amount: totalAmountReclassified,
            summary: `Reclasificó ${batchItems.length} transacciones en lote hacia ${targetAcc?.name || targetEntityName || targetDepartmentName}`,
            details: { updatedCount: batchItems.length, targetAccount: targetAcc?.name, targetEntityName, targetDepartmentName },
          },
        })

        if (isCompanyQboSyncEnabled && batchRes.outboxIds.length > 0) {
          for (const outId of batchRes.outboxIds) {
            await processSingleOutboxEntry(supabase, outId, { forceNow: true })
          }
        }

        return NextResponse.json({
          success: true,
          updatedCount: batchRes.mutatedCount,
          outboxIds: batchRes.outboxIds,
        })
      } catch (reclassErr: any) {
        return NextResponse.json(
          { error: reclassErr.message || 'Error en reclasificación atómica en lote.', rolledBack: true },
          { status: 400 }
        )
      }
    }

    // -------------------------------------------------------------------------
    // 12. BATCH SAVE TRANSACTIONS (+ Create -> Other -> Batch Transactions) — 100% ACID RPC
    // -------------------------------------------------------------------------
    if (action === 'batch_save_transactions') {
      const { rows } = body
      if (!Array.isArray(rows) || rows.length === 0) {
        return NextResponse.json({ error: 'Agrega al menos un renglón válido en el lote.' }, { status: 400 })
      }
      if (companyClosingDate) {
        const closedRow = rows.find((r: any) => r.txn_date && r.txn_date <= companyClosingDate)
        if (closedRow) {
          const periodCheckBatch = await ensureOpenAccountingPeriod(closedRow.txn_date, 'batch_save_transactions')
          if (!periodCheckBatch.allowed) {
            return periodCheckBatch.response
          }
        }
      }

      const isCompanyQboSyncEnabled = serverQboSyncEnabled
      const outboxInitialStatus: 'PENDING' | 'SKIPPED_LOCAL_ONLY' = isCompanyQboSyncEnabled ? 'PENDING' : 'SKIPPED_LOCAL_ONLY'
      const ledgerCheckCtx = ledgerCtx

      const batchItems: Array<{
        operation: 'UPSERT'
        txn: Record<string, any>
        deltas: Map<string, number>
        outbox?: {
          entityKind?: string
          entityType: string
          qbEntityId?: string | null
          operation: 'UPSERT'
          idempotencyKey: string
          payload?: Record<string, any>
          status?: 'PENDING' | 'SKIPPED_LOCAL_ONLY'
        }
      }> = []

      let batchTotalAmount = 0

      for (let idx = 0; idx < rows.length; idx++) {
        const r = rows[idx] || {}
        const amt = Number(r.amount || 0)
        const rawBankQbId = r.account_qb_id || body.bank_account_qb_id || body.account_qb_id
        const rawGlQbId = r.gl_account_qb_id || r.category_account_qb_id || r.to_account_qb_id
        const bankAcc = rawBankQbId ? acctByQbId.get(String(rawBankQbId)) : null
        const glAcc = rawGlQbId ? acctByQbId.get(String(rawGlQbId)) : null
        const shouldForceRowRollback = isTestFaultInjectionAllowed && body.forceRollbackOnIndex === idx
        const isValidRow = Boolean(r.txn_date && bankAcc && glAcc && amt > 0) && !shouldForceRowRollback

        const tType = r.txn_type || body.batch_type || 'Check'
        const direction = (tType === 'Deposit' || tType === 'Payment' || tType === 'SalesReceipt') ? 'IN' : 'OUT'
        const rowQbId = `LOCAL-BATCH-${Date.now()}-${idx}-${Math.floor(Math.random() * 10000)}`

        const resolvedBankQbId = isValidRow ? bankAcc!.qb_account_id : String(rawBankQbId || '__INVALID_BATCH_BANK_ACCOUNT__')
        const resolvedGlQbId = isValidRow ? glAcc!.qb_account_id : String(rawGlQbId || '__INVALID_BATCH_GL_ACCOUNT__')
        // If accounts were valid but amt <= 0 or txn_date missing or forceRollbackOnIndex triggered (in test env), force invalid account_qb_id so the PostgreSQL RPC rolls back the entire batch!
        const effectiveAccountQbId =
          shouldForceRowRollback
            ? '__FORCED_SQL_BATCH_ROLLBACK__'
            : (!r.txn_date || amt <= 0)
              ? '__INVALID_BATCH_ROW_AMOUNT_OR_DATE__'
              : resolvedBankQbId

        const payload: Record<string, any> = {
          company_realm_id: realmId,
          txn_type: tType,
          qb_entity_type: tType === 'Deposit' ? 'Deposit' : 'Purchase',
          qb_txn_id: rowQbId,
          txn_date: r.txn_date || new Date().toISOString().slice(0, 10),
          doc_number: r.doc_number || null,
          payment_type: tType,
          direction,
          account_qb_id: effectiveAccountQbId,
          account_name: bankAcc?.name || String(r.account_name || ''),
          to_account_qb_id: resolvedGlQbId,
          to_account_name: glAcc?.name || String(r.to_account_name || ''),
          entity_name: (r.entity_name || '').trim() || null,
          entity_type: direction === 'IN' ? 'Customer' : 'Vendor',
          total_amount: amt,
          open_balance: 0,
          memo: r.memo || null,
          category_summary: glAcc?.name || '',
          print_status: 'NotSet',
          cleared_status: 'Cleared',
          is_voided: false,
          line_items: [{
            id: '1',
            line_num: 1,
            description: r.memo || '',
            amount: amt,
            account_qb_id: resolvedGlQbId,
            account_name: glAcc?.name || '',
            entity_name: (r.entity_name || '').trim() || null,
          }],
          created_by: auth.user.name || auth.user.email,
        }

        if (isValidRow) {
          const balanceCheck = validateBalancedTransactionPostings(payload, ledgerCheckCtx)
          if (!balanceCheck.balanced) {
            payload.account_qb_id = '__UNBALANCED_BATCH_ROW__'
          }
        }

        const rowDeltas = isValidRow
          ? computeTransactionAccountDeltas(acctByQbId, payload, 1, ledgerCheckCtx)
          : new Map<string, number>()

        batchTotalAmount += Math.max(0, amt)
        batchItems.push({
          operation: 'UPSERT',
          txn: payload,
          deltas: rowDeltas,
          outbox: {
            entityKind: 'TRANSACTION',
            entityType: payload.qb_entity_type,
            qbEntityId: rowQbId,
            operation: 'UPSERT',
            idempotencyKey: `TXN-BATCH-${realmId}-${rowQbId}`,
            payload,
            status: outboxInitialStatus,
          },
        })
      }

      try {
        const batchRes = await batchMutateTransactionsAtomically(supabase, {
          mode: 'BATCH_INSERT',
          realmId,
          items: batchItems,
          user: auth.user,
          outboxStatus: outboxInitialStatus,
          batchAudit: {
            actionType: 'BATCH_CREATE_TRANSACTIONS',
            entityType: 'BatchTransactions',
            amount: batchTotalAmount,
            summary: `Registró lote atómico de ${batchItems.length} transacciones simultáneas`,
          },
        })

        if (isCompanyQboSyncEnabled && batchRes.outboxIds.length > 0) {
          for (const outId of batchRes.outboxIds) {
            await processSingleOutboxEntry(supabase, outId, { forceNow: true })
          }
        }

        return NextResponse.json({
          success: true,
          createdCount: batchRes.mutatedCount,
          insertedCount: batchRes.mutatedCount,
          savedCount: batchRes.mutatedCount,
          transactions: batchRes.transactions,
          outboxIds: batchRes.outboxIds,
        })
      } catch (batchErr: any) {
        return NextResponse.json(
          { error: batchErr.message || 'Error en lote atómico de transacciones (rollback completo).', rolledBack: true },
          { status: 400 }
        )
      }
    }

    // -------------------------------------------------------------------------
    // 13. PRINT CHECKS QUEUE (+ Create -> Vendors -> Print Checks) — 100% ACID RPC
    // -------------------------------------------------------------------------
    if (action === 'batch_mark_checks_printed') {
      const { items } = body
      if (!Array.isArray(items) || items.length === 0) {
        return NextResponse.json({ error: 'No checks provided' }, { status: 400 })
      }
      const checkIds = items.map((it: any) => String(it?.id || '')).filter(Boolean)
      if (checkIds.length === 0) {
        return NextResponse.json({ error: 'No valid check IDs provided' }, { status: 400 })
      }
      const { data: existingChecks } = await supabase
        .from('external_accounting_transactions')
        .select('*')
        .in('id', checkIds)
        .eq('company_realm_id', realmId)

      if (!existingChecks || existingChecks.length !== checkIds.length) {
        return NextResponse.json(
          { error: 'Uno o más cheques no existen en la empresa activa o son inválidos.', rolledBack: true },
          { status: 400 }
        )
      }

      const checkMap = new Map(existingChecks.map(c => [String(c.id), c]))
      const isCompanyQboSyncEnabled = serverQboSyncEnabled
      const batchItems = items.map((item: any, idx: number) => {
        const existing = checkMap.get(String(item.id))!
        return {
          txn: {
            ...existing,
            doc_number: item.doc_number || existing.doc_number || null,
            print_status: 'PrintComplete',
          },
          outbox: {
            idempotencyKey: `CHK-PRINT-${realmId}-${existing.id}-${Date.now()}-${idx}`,
            status: (isCompanyQboSyncEnabled ? 'PENDING' : 'SKIPPED_LOCAL_ONLY') as 'PENDING' | 'SKIPPED_LOCAL_ONLY',
          },
        }
      })

      try {
        const batchPrintRes = await batchMutateTransactionsAtomically(supabase, {
          mode: 'BATCH_UPDATE',
          realmId,
          items: batchItems,
          deltas: new Map(),
          user: auth.user,
          audit: {
            actionType: 'PRINT_CHECKS_BATCH',
            entityType: 'CheckQueue',
            summary: `Imprimió lote de ${items.length} cheques oficiales`,
          },
        })
        if (isCompanyQboSyncEnabled && batchPrintRes.outboxIds.length > 0) {
          for (const obId of batchPrintRes.outboxIds) {
            await processSingleOutboxEntry(supabase, obId, { forceNow: true })
          }
        }
        return NextResponse.json({
          success: true,
          count: batchPrintRes.count,
          auditId: batchPrintRes.auditId,
          outboxIds: batchPrintRes.outboxIds,
        })
      } catch (printErr: any) {
        return NextResponse.json(
          { error: printErr.message || 'Error atómico al marcar cheques impresos.', rolledBack: true },
          { status: 400 }
        )
      }
    }

    // -------------------------------------------------------------------------
    // 14. BANK RULES (Gear Menu ⚙️ -> Lists -> Rules) — 100% ACID RPC
    // -------------------------------------------------------------------------
    if (action === 'save_bank_rule') {
      const {
        id,
        rule_name,
        name,
        direction,
        match_field,
        match_text,
        target_account_qb_id,
        target_entity_name,
        assign_entity_name,
        target_txn_type,
        auto_apply,
        priority,
      } = body
      const effectiveRuleName = String(rule_name || name || '').trim()
      const effectiveEntityName = String(target_entity_name || assign_entity_name || '').trim() || null

      if (!effectiveRuleName || !match_text || !target_account_qb_id) {
        return NextResponse.json({ error: 'Nombre de regla, texto a buscar y cuenta destino son obligatorios.' }, { status: 400 })
      }
      const targetAcc = acctByQbId.get(target_account_qb_id)
      if (!targetAcc) {
        return NextResponse.json({ error: 'La cuenta destino no pertenece a la empresa activa.' }, { status: 400 })
      }

      const rulePayload: Record<string, any> = {
        id: id || undefined,
        company_realm_id: realmId,
        rule_name: effectiveRuleName,
        direction: direction || 'OUT',
        match_field: match_field || 'ANY',
        match_text: match_text.trim(),
        target_account_id: targetAcc.id || null,
        target_account_qb_id: targetAcc.qb_account_id,
        target_account_name: targetAcc.name,
        target_entity_name: effectiveEntityName,
        target_txn_type: target_txn_type || 'Expense',
        auto_apply: auto_apply !== false,
        priority: Number(priority || 100),
        is_active: true,
        updated_at: new Date().toISOString(),
      }

      const isCompanyQboSyncEnabled = serverQboSyncEnabled
      const atomicRuleRes = await mutateEntityAtomically(supabase, {
        entityKind: 'BANK_RULE',
        operation: 'UPSERT',
        realmId,
        record: rulePayload,
        user: auth.user,
        audit: {
          actionType: id ? 'EDIT_BANK_RULE' : 'CREATE_BANK_RULE',
          entityType: 'BankRule',
          entityId: id || undefined,
          summary: `${id ? 'Editó' : 'Creó'} regla bancaria "${effectiveRuleName}" (${match_text.trim()} ➔ ${targetAcc.name})`,
        },
        outbox: {
          idempotencyKey: `RULE-UPSERT-${realmId}-${id || effectiveRuleName}-${Date.now()}`,
          status: isCompanyQboSyncEnabled ? 'PENDING' : 'SKIPPED_LOCAL_ONLY',
          payload: rulePayload,
        },
      })

      if (atomicRuleRes.outboxId && isCompanyQboSyncEnabled) {
        await processSingleOutboxEntry(supabase, atomicRuleRes.outboxId, { forceNow: true })
      }

      return NextResponse.json({
        success: true,
        rule: atomicRuleRes.record,
        auditId: atomicRuleRes.auditId,
        outboxId: atomicRuleRes.outboxId,
        outboxStatus: atomicRuleRes.outboxStatus,
      })
    }

    if (action === 'delete_bank_rule') {
      const { id } = body
      if (!id) return NextResponse.json({ error: 'Rule id is required' }, { status: 400 })

      const isCompanyQboSyncEnabled = serverQboSyncEnabled
      const atomicDelRule = await mutateEntityAtomically(supabase, {
        entityKind: 'BANK_RULE',
        operation: 'DELETE',
        realmId,
        record: { id },
        user: auth.user,
        audit: {
          actionType: 'DELETE_BANK_RULE',
          entityType: 'BankRule',
          entityId: id,
          summary: `Eliminó regla bancaria #${id}`,
        },
        outbox: {
          idempotencyKey: `RULE-DELETE-${realmId}-${id}-${Date.now()}`,
          status: isCompanyQboSyncEnabled ? 'PENDING' : 'SKIPPED_LOCAL_ONLY',
          payload: { id },
        },
      })

      if (atomicDelRule.outboxId && isCompanyQboSyncEnabled) {
        await processSingleOutboxEntry(supabase, atomicDelRule.outboxId, { forceNow: true })
      }

      return NextResponse.json({
        success: true,
        auditId: atomicDelRule.auditId,
        outboxId: atomicDelRule.outboxId,
      })
    }

    if (action === 'apply_bank_rules') {
      if (companyClosingDate && body.overrideClosingDate) {
        const periodCheckRules = await ensureOpenAccountingPeriod(companyClosingDate, 'apply_bank_rules')
        if (!periodCheckRules.allowed) {
          return periodCheckRules.response
        }
      }

      let rulesQuery = supabase
        .from('external_accounting_bank_rules')
        .select('*')
        .eq('company_realm_id', realmId)
        .eq('is_active', true)
        .order('priority', { ascending: true })

      if (Array.isArray(body.ruleIds) && body.ruleIds.length > 0) {
        rulesQuery = rulesQuery.in('id', body.ruleIds.map(String))
      }

      const { data: rules } = await rulesQuery
      if (!rules || rules.length === 0) {
        return NextResponse.json({ success: true, matchedCount: 0, appliedCount: 0 })
      }

      const allTxns = Array.isArray(body.txnIds) && body.txnIds.length > 0
        ? ((await supabase
            .from('external_accounting_transactions')
            .select('*')
            .eq('company_realm_id', realmId)
            .in('id', body.txnIds.map(String))).data || [])
        : await fetchAllCompanyTransactions(supabase, realmId, false)

      const isCompanyQboSyncEnabled = serverQboSyncEnabled
      const outboxInitialStatus: 'PENDING' | 'SKIPPED_LOCAL_ONLY' = isCompanyQboSyncEnabled ? 'PENDING' : 'SKIPPED_LOCAL_ONLY'

      const batchItems: Array<{
        operation: 'UPSERT'
        txn: Record<string, any>
        deltas: Map<string, number>
        outbox?: {
          entityKind?: string
          entityType: string
          qbEntityId?: string | null
          operation: 'UPSERT'
          idempotencyKey: string
          payload?: Record<string, any>
          status?: 'PENDING' | 'SKIPPED_LOCAL_ONLY'
        }
      }> = []

      for (const txn of allTxns) {
        if (txn.is_voided || txn.cleared_status === 'Reconciled' || txn.txn_type === 'Transfer' || txn.txn_type === 'JournalEntry' || txn.txn_type === 'Estimate' || txn.txn_type === 'PurchaseOrder') continue
        if (companyClosingDate && txn.txn_date && txn.txn_date <= companyClosingDate && !body.overrideClosingDate) continue

        for (const rule of rules) {
          if (rule.direction !== 'ALL' && txn.direction !== rule.direction) continue
          const needle = String(rule.match_text || '').toLowerCase()
          if (!needle) continue
          const hayEntity = String(txn.entity_name || '').toLowerCase()
          const hayMemo = String(txn.memo || '').toLowerCase()
          const hayDoc = String(txn.doc_number || '').toLowerCase()
          const matched =
            rule.match_field === 'ENTITY' ? hayEntity.includes(needle) :
            rule.match_field === 'MEMO' ? hayMemo.includes(needle) :
            rule.match_field === 'DOC_NUMBER' ? hayDoc.includes(needle) :
            (hayEntity.includes(needle) || hayMemo.includes(needle) || hayDoc.includes(needle))

          if (matched) {
            const targetAcc = acctByQbId.get(String(rule.target_account_qb_id)) || {
              qb_account_id: String(rule.target_account_qb_id || '__INVALID_RULE_TARGET__'),
              name: String(rule.target_account_name || rule.target_account_qb_id || ''),
            }
            if (txn.category_summary === targetAcc.name && (!rule.target_entity_name || txn.entity_name === rule.target_entity_name)) {
              break
            }
            const oldRev = computeTransactionAccountDeltas(acctByQbId, txn, -1, ledgerCtx)
            const existingLines = Array.isArray(txn.line_items) && txn.line_items.length > 0
              ? txn.line_items
              : [{
                  id: '1',
                  line_num: 1,
                  description: txn.memo || '',
                  amount: Number(txn.total_amount || 0),
                  account_qb_id: targetAcc.qb_account_id,
                  account_name: targetAcc.name,
                  entity_name: rule.target_entity_name || txn.entity_name,
                }]
            const newLines = existingLines.map((l: any) => ({
              ...l,
              account_qb_id: targetAcc.qb_account_id,
              account_name: targetAcc.name,
              entity_name: rule.target_entity_name || l.entity_name || txn.entity_name,
            }))
            const mergedTxn: Record<string, any> = {
              ...txn,
              to_account_qb_id: targetAcc.qb_account_id,
              to_account_name: targetAcc.name,
              category_summary: targetAcc.name,
              entity_name: rule.target_entity_name || txn.entity_name,
              line_items: newLines,
              raw_data: markRawAsLocallyEdited(txn.raw_data),
              updated_at: new Date().toISOString(),
            }
            const newApp = computeTransactionAccountDeltas(acctByQbId, mergedTxn, 1, ledgerCtx)
            const rowNet = mergeAccountDeltas(oldRev, newApp)

            batchItems.push({
              operation: 'UPSERT',
              txn: mergedTxn,
              deltas: rowNet,
              outbox: {
                entityKind: 'TRANSACTION',
                entityType: mergedTxn.qb_entity_type || mergedTxn.txn_type,
                qbEntityId: mergedTxn.qb_txn_id,
                operation: 'UPSERT',
                idempotencyKey: `TXN-RULE-${realmId}-${mergedTxn.qb_txn_id}-${Date.now()}`,
                payload: mergedTxn,
                status: outboxInitialStatus,
              },
            })
            break
          }
        }
      }

      if (isTestFaultInjectionAllowed && body.forceRollbackAfterMatch && batchItems.length > 0) {
        batchItems.push({
          operation: 'UPSERT',
          txn: {
            company_realm_id: realmId,
            txn_type: 'Expense',
            qb_entity_type: 'Purchase',
            qb_txn_id: `INVALID-BANK-RULE-${Date.now()}`,
            txn_date: new Date().toISOString().slice(0, 10),
            account_qb_id: '__INVALID_BANK_RULE_ACCOUNT__',
            total_amount: 0,
            line_items: [],
          },
          deltas: new Map(),
        })
      }

      if (batchItems.length === 0) {
        return NextResponse.json({ success: true, matchedCount: 0, appliedCount: 0 })
      }

      try {
        const batchRes = await batchMutateTransactionsAtomically(supabase, {
          realmId,
          items: batchItems,
          user: auth.user,
          outboxStatus: outboxInitialStatus,
          batchAudit: {
            actionType: 'BANK_RULES_APPLIED',
            entityType: 'BankRules',
            summary: `Ejecutó reglas bancarias automáticas (${batchItems.length} transacciones actualizadas)`,
          },
        })

        if (isCompanyQboSyncEnabled && batchRes.outboxIds.length > 0) {
          for (const outId of batchRes.outboxIds) {
            await processSingleOutboxEntry(supabase, outId, { forceNow: true })
          }
        }

        return NextResponse.json({
          success: true,
          matchedCount: batchRes.mutatedCount,
          appliedCount: batchRes.mutatedCount,
          outboxIds: batchRes.outboxIds,
        })
      } catch (ruleErr: any) {
        return NextResponse.json(
          { error: ruleErr.message || 'Error aplicando reglas bancarias (rollback completo).', rolledBack: true },
          { status: 400 }
        )
      }
    }

    // -------------------------------------------------------------------------
    // 15. BUDGETING (Gear Menu ⚙️ -> Tools -> Budgeting)
    // -------------------------------------------------------------------------
    if (action === 'save_budget') {
      const { fiscal_year, account_qb_id, monthly_amounts, annual_total, notes } = body
      if (!account_qb_id) {
        return NextResponse.json({ error: 'Selecciona una cuenta contable para el presupuesto.' }, { status: 400 })
      }
      const targetAcc = acctByQbId.get(account_qb_id)
      if (!targetAcc) {
        return NextResponse.json({ error: 'La cuenta no pertenece a la empresa activa.' }, { status: 400 })
      }

      const fy = Number(fiscal_year || 2026)
      const monthsObj: Record<string, number> = {}
      let computedAnnual = 0
      if (monthly_amounts && typeof monthly_amounts === 'object') {
        for (let m = 1; m <= 12; m++) {
          const key = String(m).padStart(2, '0')
          const val = Number(monthly_amounts[key] ?? monthly_amounts[String(m)] ?? 0)
          monthsObj[key] = Number(val.toFixed(2))
          computedAnnual += monthsObj[key]
        }
      } else {
        const perMonth = Number((Number(annual_total || 0) / 12).toFixed(2))
        for (let m = 1; m <= 12; m++) {
          const key = String(m).padStart(2, '0')
          monthsObj[key] = perMonth
          computedAnnual += perMonth
        }
      }

      const budgetPayload = {
        company_realm_id: realmId,
        fiscal_year: fy,
        account_id: targetAcc.id || null,
        account_qb_id: targetAcc.qb_account_id,
        account_name: targetAcc.name,
        account_type: targetAcc.account_type,
        monthly_amounts: monthsObj,
        annual_total: Number(computedAnnual.toFixed(2)),
        notes: notes || null,
        updated_by: auth.user.name || auth.user.email,
        updated_at: new Date().toISOString(),
      }

      const isCompanyQboSyncEnabled = serverQboSyncEnabled
      const atomicBudgetRes = await mutateEntityAtomically(supabase, {
        entityKind: 'BUDGET',
        operation: 'UPSERT',
        realmId,
        record: budgetPayload,
        user: auth.user,
        audit: {
          actionType: 'SAVE_BUDGET',
          entityType: 'Budget',
          entityId: targetAcc.qb_account_id,
          amount: Number(computedAnnual.toFixed(2)),
          summary: `Actualizó presupuesto ${fy} para ${targetAcc.name} ($${computedAnnual.toFixed(2)} anual)`,
        },
        outbox: {
          idempotencyKey: `BUDGET-UPSERT-${realmId}-${fy}-${targetAcc.qb_account_id}-${Date.now()}`,
          status: isCompanyQboSyncEnabled ? 'PENDING' : 'SKIPPED_LOCAL_ONLY',
          payload: budgetPayload,
        },
      })

      if (atomicBudgetRes.outboxId && isCompanyQboSyncEnabled) {
        await processSingleOutboxEntry(supabase, atomicBudgetRes.outboxId, { forceNow: true })
      }

      return NextResponse.json({
        success: true,
        budget: atomicBudgetRes.record,
        auditId: atomicBudgetRes.auditId,
        outboxId: atomicBudgetRes.outboxId,
        outboxStatus: atomicBudgetRes.outboxStatus,
      })
    }

    if (action === 'delete_budget') {
      const { id } = body
      if (!id) return NextResponse.json({ error: 'Budget id is required' }, { status: 400 })

      const isCompanyQboSyncEnabled = serverQboSyncEnabled
      const atomicDelBudget = await mutateEntityAtomically(supabase, {
        entityKind: 'BUDGET',
        operation: 'DELETE',
        realmId,
        record: { id },
        user: auth.user,
        audit: {
          actionType: 'DELETE_BUDGET',
          entityType: 'Budget',
          entityId: id,
          summary: `Eliminó presupuesto #${id}`,
        },
        outbox: {
          idempotencyKey: `BUDGET-DELETE-${realmId}-${id}-${Date.now()}`,
          status: isCompanyQboSyncEnabled ? 'PENDING' : 'SKIPPED_LOCAL_ONLY',
          payload: { id },
        },
      })

      if (atomicDelBudget.outboxId && isCompanyQboSyncEnabled) {
        await processSingleOutboxEntry(supabase, atomicDelBudget.outboxId, { forceNow: true })
      }

      return NextResponse.json({
        success: true,
        auditId: atomicDelBudget.auditId,
        outboxId: atomicDelBudget.outboxId,
      })
    }

    // -------------------------------------------------------------------------
    // 16. COMPANY SETTINGS & BOOKS CLOSING DATE (Gear Menu ⚙️ -> Settings -> Company Settings) — 100% ACID RPC
    // -------------------------------------------------------------------------
    if (action === 'save_company_settings') {
      const {
        company_name,
        legal_name,
        email,
        phone,
        address,
        tax_id,
        accounting_method,
        fiscal_year_start_month,
        closing_date,
      } = body

      const nextMeta = {
        ...(companyRecord.metadata || {}),
        tax_id: tax_id ?? companyRecord.metadata?.tax_id ?? '',
        accounting_method: accounting_method || companyRecord.metadata?.accounting_method || 'Accrual',
        fiscal_year_start_month: fiscal_year_start_month || companyRecord.metadata?.fiscal_year_start_month || '01',
        closing_date: closing_date || null,
      }

      const settingsPayload = {
        company_name: company_name || companyRecord.company_name,
        legal_name: legal_name || company_name || companyRecord.legal_name,
        email: email ?? companyRecord.email,
        phone: phone ?? companyRecord.phone,
        address: address || companyRecord.address || {},
        metadata: nextMeta,
        updated_at: new Date().toISOString(),
      }

      const isCompanyQboSyncEnabled = serverQboSyncEnabled
      const atomicSettingsRes = await mutateEntityAtomically(supabase, {
        entityKind: 'COMPANY_SETTINGS',
        operation: 'UPSERT',
        realmId,
        record: settingsPayload,
        user: auth.user,
        audit: {
          actionType: 'SAVE_COMPANY_SETTINGS',
          entityType: 'CompanySettings',
          entityId: realmId,
          summary: `Actualizó configuración de empresa (${settingsPayload.company_name})${closing_date ? ` — Fecha de Cierre: ${closing_date}` : ''}`,
          details: {
            previous_closing_date: companyRecord.metadata?.closing_date || null,
            new_closing_date: closing_date || null,
            accounting_method: nextMeta.accounting_method,
          },
        },
        outbox: {
          idempotencyKey: `SETTINGS-UPSERT-${realmId}-${Date.now()}`,
          status: isCompanyQboSyncEnabled ? 'PENDING' : 'SKIPPED_LOCAL_ONLY',
          payload: settingsPayload,
        },
      })

      if (atomicSettingsRes.outboxId && isCompanyQboSyncEnabled) {
        await processSingleOutboxEntry(supabase, atomicSettingsRes.outboxId, { forceNow: true })
      }

      return NextResponse.json({
        success: true,
        company: atomicSettingsRes.record,
        auditId: atomicSettingsRes.auditId,
        outboxId: atomicSettingsRes.outboxId,
      })
    }

    // -------------------------------------------------------------------------
    // 17. LISTS MANAGER: ALL 9 QBO LISTS RELATIONAL TABLES (Gear Menu ⚙️ -> Lists / Tab 12) — 100% ACID RPC + OUTBOX
    // -------------------------------------------------------------------------
    if (action === 'save_list_item') {
      const { listKey, item } = body
      const allowedKeys = [
        'items',
        'categories',
        'departments',
        'classes',
        'paymentMethods',
        'terms',
        'customFields',
        'attachments',
        'costGroups',
      ]
      if (!allowedKeys.includes(listKey) || !item || !(item.Name || item.name || item.file_name)) {
        return NextResponse.json({ error: 'Lista e información del elemento son obligatorias.' }, { status: 400 })
      }

      const rawName = String(item.Name || item.name || item.file_name || '').trim()
      const itemId = item.Id || item.qb_item_id || item.qb_category_id || item.qb_location_id || item.qb_class_id || item.qb_payment_method_id || item.qb_term_id || item.field_key || item.qb_attachable_id || item.qb_cost_group_id
        ? String(item.Id || item.qb_item_id || item.qb_category_id || item.qb_location_id || item.qb_class_id || item.qb_payment_method_id || item.qb_term_id || item.field_key || item.qb_attachable_id || item.qb_cost_group_id)
        : `LOCAL-${Date.now()}`

      const normalizedItem: Record<string, any> = {
        ...item,
        Id: itemId,
        Name: rawName,
        Active: item.Active !== false,
      }
      delete normalizedItem.data_url
      delete normalizedItem.file_base64

      if (listKey === 'items') {
        const incAccId = normalizedItem.income_account_qb_id || normalizedItem.IncomeAccountRef?.value || null
        const expAccId = normalizedItem.expense_account_qb_id || normalizedItem.ExpenseAccountRef?.value || null
        const assAccId = normalizedItem.asset_account_qb_id || normalizedItem.AssetAccountRef?.value || null
        normalizedItem.income_account_qb_id = incAccId ? String(incAccId) : null
        normalizedItem.income_account_name = incAccId ? (acctByQbId.get(String(incAccId))?.name || normalizedItem.income_account_name || normalizedItem.IncomeAccountRef?.name || null) : null
        normalizedItem.expense_account_qb_id = expAccId ? String(expAccId) : null
        normalizedItem.expense_account_name = expAccId ? (acctByQbId.get(String(expAccId))?.name || normalizedItem.expense_account_name || normalizedItem.ExpenseAccountRef?.name || null) : null
        normalizedItem.asset_account_qb_id = assAccId ? String(assAccId) : null
        normalizedItem.asset_account_name = assAccId ? (acctByQbId.get(String(assAccId))?.name || normalizedItem.asset_account_name || normalizedItem.AssetAccountRef?.name || null) : null
      }

      let uploadedListStorageMeta: Awaited<ReturnType<typeof uploadAttachmentToSupabaseStorage>> | null = null
      if (listKey === 'attachments' && (item.data_url || item.file_base64)) {
        uploadedListStorageMeta = await uploadAttachmentToSupabaseStorage(supabase, realmId, {
          fileName: rawName,
          contentType: item.content_type || item.ContentType || 'application/pdf',
          dataUrl: item.data_url || null,
          fileBase64: item.file_base64 || null,
          sizeBytes: Number(item.file_size || item.size_bytes || 0),
        })
        normalizedItem.storage_bucket = uploadedListStorageMeta.storageBucket
        normalizedItem.storage_path = uploadedListStorageMeta.storagePath
        normalizedItem.file_url = uploadedListStorageMeta.fileUrl || normalizedItem.file_url || null
        normalizedItem.sha256_hash = uploadedListStorageMeta.sha256Hash
        normalizedItem.file_size = uploadedListStorageMeta.fileSize
        normalizedItem.size_bytes = uploadedListStorageMeta.fileSize
        normalizedItem.content_type = uploadedListStorageMeta.contentType
      }

      const isCompanyQboSyncEnabled = serverQboSyncEnabled
      let atomicListRes: Awaited<ReturnType<typeof mutateEntityAtomically>>
      try {
        atomicListRes = await mutateEntityAtomically(supabase, {
          entityKind: listKey === 'attachments' ? 'ATTACHMENT' : 'LIST_ITEM',
          operation: 'UPSERT',
          realmId,
          listKey,
          record: {
            ...normalizedItem,
            qb_attachable_id: itemId,
            file_name: rawName,
            force_db_failure:
              isTestFaultInjectionAllowed &&
              Boolean(body.force_db_failure || body.forceDbFailure || item.force_db_failure),
            raw_data: normalizedItem,
          },
          user: auth.user,
          audit: {
            actionType: 'SAVE_LIST_ITEM',
            entityType: listKey,
            entityId: itemId,
            summary: `Guardó elemento "${rawName}" en tabla relacional ${listKey}`,
          },
          outbox: {
            idempotencyKey: `LIST-UPSERT-${realmId}-${listKey}-${itemId}-${Date.now()}`,
            status: isCompanyQboSyncEnabled ? 'PENDING' : 'SKIPPED_LOCAL_ONLY',
            payload: { listKey, item: normalizedItem },
          },
        })
      } catch (listDbErr: any) {
        if (uploadedListStorageMeta?.storageBucket && uploadedListStorageMeta?.storagePath) {
          await supabase.storage
            .from(uploadedListStorageMeta.storageBucket)
            .remove([uploadedListStorageMeta.storagePath])
        }
        return NextResponse.json(
          {
            error: listDbErr.message || 'Error atómico al guardar elemento en BD.',
            rolledBack: true,
            storageCleanedUp: Boolean(uploadedListStorageMeta?.storagePath),
            cleanedStoragePath: uploadedListStorageMeta?.storagePath || null,
          },
          { status: 400 }
        )
      }

      let qboPush: any = {
        synced: false,
        status: !isCompanyQboSyncEnabled ? 'SKIPPED_LOCAL_ONLY' : 'PENDING_QBO_OUTBOX',
      }
      let finalItemId = itemId
      if (atomicListRes.outboxId && isCompanyQboSyncEnabled) {
        const outboxRes = await processSingleOutboxEntry(supabase, atomicListRes.outboxId, { forceNow: true })
        qboPush = {
          synced: outboxRes.status === 'SYNCED',
          status: outboxRes.status,
          qbId: outboxRes.qbId,
          error: outboxRes.error,
        }
        if (outboxRes.qbId) {
          finalItemId = outboxRes.qbId
        }
      }

      return NextResponse.json({
        success: true,
        itemId: finalItemId,
        item: atomicListRes.record,
        record: atomicListRes.record,
        outboxId: atomicListRes.outboxId,
        qboPush,
      })
    }

    if (action === 'delete_list_item') {
      const { listKey, itemId, id } = body
      const effectiveItemId = itemId || id
      const allowedKeys = [
        'items',
        'categories',
        'departments',
        'classes',
        'paymentMethods',
        'terms',
        'customFields',
        'attachments',
        'costGroups',
      ]
      if (!allowedKeys.includes(listKey) || !effectiveItemId) {
        return NextResponse.json({ error: 'listKey and itemId are required' }, { status: 400 })
      }
      const targetId = String(effectiveItemId)
      const existingArr: any[] = Array.isArray(companyRecord.metadata?.[listKey])
        ? companyRecord.metadata[listKey]
        : []
      const removedItem = existingArr.find((x: any) => String(x.Id ?? x.id) === targetId)

      let attRowForListDelete: any = null
      if (listKey === 'attachments') {
        let q = supabase
          .from('external_accounting_attachments')
          .select('id, qb_attachable_id, storage_bucket, storage_path')
          .eq('company_realm_id', realmId)
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(targetId)) {
          q = q.eq('id', targetId)
        } else {
          q = q.eq('qb_attachable_id', targetId)
        }
        const { data: foundAtt } = await q.maybeSingle()
        attRowForListDelete = foundAtt
      }

      const isCompanyQboSyncEnabled = serverQboSyncEnabled
      let atomicDelListRes: Awaited<ReturnType<typeof mutateEntityAtomically>>
      try {
        atomicDelListRes = await mutateEntityAtomically(supabase, {
          entityKind: listKey === 'attachments' ? 'ATTACHMENT' : 'LIST_ITEM',
          operation: 'DELETE',
          realmId,
          listKey,
          record: {
            id: attRowForListDelete?.id || (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(targetId) ? targetId : undefined),
            Id: targetId,
            qb_attachable_id: attRowForListDelete?.qb_attachable_id || targetId,
            force_db_failure:
              isTestFaultInjectionAllowed &&
              Boolean(body.force_db_failure || body.forceDbFailure),
          },
          user: auth.user,
          audit: {
            actionType: 'DELETE_LIST_ITEM',
            entityType: listKey,
            entityId: targetId,
            summary: `Eliminó elemento "${removedItem?.Name || removedItem?.name || targetId}" de tabla relacional ${listKey}`,
          },
          outbox: {
            idempotencyKey: `LIST-DELETE-${realmId}-${listKey}-${targetId}-${Date.now()}`,
            status: isCompanyQboSyncEnabled ? 'PENDING' : 'SKIPPED_LOCAL_ONLY',
            payload: {
              listKey,
              item: { Id: targetId, Name: removedItem?.Name || removedItem?.name || targetId },
            },
          },
        })
      } catch (delListErr: any) {
        return NextResponse.json(
          { error: delListErr.message || 'Error atómico al eliminar elemento.', rolledBack: true, storagePreserved: true },
          { status: 400 }
        )
      }

      let listStorageDeleteMeta = {
        storageRemoved: false,
        storageCompensationQueued: false,
        storageCompensationOutboxId: null as string | null,
      }
      if (attRowForListDelete?.storage_bucket && attRowForListDelete?.storage_path) {
        listStorageDeleteMeta = await removeAttachmentFromStorageOrQueueCompensation(supabase, {
          realmId,
          user: auth.user,
          attRow: attRowForListDelete,
          simulateStorageRemoveFailure:
            isTestFaultInjectionAllowed &&
            Boolean(body.force_storage_remove_failure || body.forceStorageRemoveFailure),
        })
      }

      let qboDel: any = {
        synced: false,
        status: !isCompanyQboSyncEnabled ? 'SKIPPED_LOCAL_ONLY' : 'PENDING_QBO_OUTBOX',
      }
      if (atomicDelListRes.outboxId && isCompanyQboSyncEnabled) {
        const outboxRes = await processSingleOutboxEntry(supabase, atomicDelListRes.outboxId, { forceNow: true })
        qboDel = {
          synced: outboxRes.status === 'SYNCED',
          status: outboxRes.status,
          error: outboxRes.error,
        }
      }

      const currentList: any[] = existingArr.filter((x: any) => String(x.Id ?? x.id) !== targetId)
      return NextResponse.json({ success: true, list: currentList, outboxId: atomicDelListRes.outboxId, qboDel })
    }

    // -------------------------------------------------------------------------
    // 14. OFFICIAL QBO STATEMENT INVOICE PDF & EMAIL DISPATCH (`generate_invoice_pdf` / `send_invoice_email`)
    // -------------------------------------------------------------------------
    if (action === 'generate_invoice_pdf' || action === 'send_invoice_email') {
      const txnId = body.id || body.txnId || body.transactionId || body.invoiceId || body.invoice_id
      if (!txnId) {
        return NextResponse.json({ error: 'Transaction id is required' }, { status: 400 })
      }

      const { data: invoiceRow, error: invErr } = await supabase
        .from('external_accounting_transactions')
        .select('*')
        .eq('id', txnId)
        .eq('company_realm_id', realmId)
        .maybeSingle()

      if (invErr || !invoiceRow) {
        return NextResponse.json({ error: 'Factura (Invoice) no encontrada en la empresa activa.' }, { status: 404 })
      }

      // Fetch company details + tenant contact + all tenant transactions for Account Summary
      const entityName = String(invoiceRow.entity_name || '').trim()
      const entityQbId = invoiceRow.entity_qb_id ? String(invoiceRow.entity_qb_id) : null

      const [compFullRes, contactsRes, rawTenantTxns] = await Promise.all([
        supabase
          .from('external_accounting_companies')
          .select('*')
          .eq('realm_id', realmId)
          .maybeSingle(),
        supabase
          .from('external_accounting_contacts')
          .select('*')
          .eq('company_realm_id', realmId),
        fetchEntityTransactions(supabase, realmId, entityQbId, entityName, [
          'Invoice',
          'Payment',
          'CreditMemo',
          'SalesReceipt',
        ]),
      ])

      const compFull = compFullRes.data || companyRecord
      const allContacts = contactsRes.data || []
      const matchedContact = allContacts.find((c: any) =>
        (entityQbId && String(c.qb_contact_id) === entityQbId) ||
        (entityName && String(c.display_name || '').trim().toLowerCase() === entityName.toLowerCase()) ||
        (entityName && String(c.company_name || '').trim().toLowerCase() === entityName.toLowerCase())
      )

      const tenantTxns = (rawTenantTxns || []).filter((t: any) => !t.is_voided)

      // Build company address lines
      const compAddr = compFull?.address && typeof compFull.address === 'object' ? compFull.address : {}
      const companyAddressLines: string[] = []
      if (compAddr.Line1) companyAddressLines.push(String(compAddr.Line1))
      if (compAddr.Line2) companyAddressLines.push(String(compAddr.Line2))
      const cityStateZip = [
        compAddr.City,
        [compAddr.CountrySubDivisionCode, compAddr.PostalCode, compAddr.Country].filter(Boolean).join(' ')
      ].filter(Boolean).join(', ')
      if (cityStateZip) companyAddressLines.push(cityStateZip)

      // Build Bill To lines & greeting name
      const rawInv = invoiceRow.raw_data?.Invoice || invoiceRow.raw_data || {}
      const billAddr = rawInv?.BillAddr || matchedContact?.address || {}
      const contactFullName = [matchedContact?.given_name, matchedContact?.family_name].filter(Boolean).join(' ').trim()
      const contactGreetingName = contactFullName || billAddr.Line1 || matchedContact?.display_name || entityName || 'Valued Tenant'
      const customerDisplayName = matchedContact?.display_name || matchedContact?.company_name || entityName || 'Tenant'

      const billToLines: string[] = []
      if (billAddr.Line1 || billAddr.Line2 || billAddr.Line3) {
        if (billAddr.Line1) billToLines.push(String(billAddr.Line1))
        if (billAddr.Line2) billToLines.push(String(billAddr.Line2))
        if (billAddr.Line3) billToLines.push(String(billAddr.Line3))
        if (billAddr.Line4) billToLines.push(String(billAddr.Line4))
        const billCityLine = [
          billAddr.City,
          [billAddr.CountrySubDivisionCode, billAddr.PostalCode, billAddr.Country].filter(Boolean).join(' ')
        ].filter(Boolean).join(', ')
        if (billCityLine && !billToLines.some(l => l.includes(billAddr.City || '___'))) {
          billToLines.push(billCityLine)
        }
      } else {
        if (contactFullName && contactFullName.toLowerCase() !== customerDisplayName.toLowerCase()) {
          billToLines.push(contactFullName)
        }
        billToLines.push(customerDisplayName)
      }

      // Compute QBO Statement Account Summary
      const accountSummary = computeTenantAccountSummary(invoiceRow, tenantTxns, matchedContact)

      // Extract line items (Item name e.g. "Rent" + Description e.g. "Monthly Rent")
      const rawQboLines: any[] = Array.isArray(rawInv?.Line)
        ? rawInv.Line.filter((l: any) => l.DetailType !== 'SubTotalLineDetail')
        : []
      const dbLines: any[] = Array.isArray(invoiceRow.line_items) ? invoiceRow.line_items : []

      let parsedLineItems: QboInvoiceLineItem[] = []
      if (rawQboLines.length > 0) {
        parsedLineItems = rawQboLines.map((rl: any) => {
          const salesDetail = rl.SalesItemLineDetail || {}
          const itemRefName = salesDetail.ItemRef?.name || rl.AccountBasedExpenseLineDetail?.AccountRef?.name || 'Rent'
          const amt = Number(rl.Amount || 0)
          const unitPrice = salesDetail.UnitPrice !== undefined ? Number(salesDetail.UnitPrice) : amt
          const qty = salesDetail.Qty !== undefined ? salesDetail.Qty : null
          return {
            itemName: String(itemRefName),
            description: rl.Description ? String(rl.Description) : '',
            qty,
            rate: unitPrice,
            amount: amt,
          }
        })
      } else if (dbLines.length > 0) {
        parsedLineItems = dbLines.map((dl: any) => {
          const amt = Number(dl.amount || 0)
          const itemTitle = dl.item_name || dl.account_name || invoiceRow.category_summary || 'Rent'
          const cleanItemTitle = String(itemTitle).includes(':') ? String(itemTitle).split(':').pop()!.trim() : String(itemTitle)
          const resolvedRate = dl.unit_price !== undefined && dl.unit_price !== null
            ? Number(dl.unit_price)
            : dl.rate !== undefined && dl.rate !== null
            ? Number(dl.rate)
            : amt
          return {
            itemName: cleanItemTitle,
            description: dl.description || invoiceRow.memo || 'Monthly Rent',
            qty: dl.qty || null,
            rate: resolvedRate,
            amount: amt,
          }
        })
      } else {
        const amt = Number(invoiceRow.total_amount || 0)
        parsedLineItems = [{
          itemName: 'Rent',
          description: invoiceRow.memo || 'Monthly Rent',
          qty: null,
          rate: amt,
          amount: amt,
        }]
      }

      const termsName = rawInv?.SalesTermRef?.name || invoiceRow.term_name || body.terms || 'Due on receipt'
      const dueDateStr = invoiceRow.due_date || rawInv?.DueDate || invoiceRow.txn_date
      const defaultCustomerEmail = matchedContact?.email || rawInv?.BillEmail?.Address || ''

      const resolvedDocType: QboDocumentType =
        (body.docType as QboDocumentType) ||
        (['Invoice', 'Estimate', 'SalesReceipt', 'Payment', 'CreditMemo', 'RefundReceipt'].includes(String(invoiceRow.txn_type))
          ? (invoiceRow.txn_type as QboDocumentType)
          : 'Invoice')

      // If Payment Receipt, build applied invoice line items from linked transactions
      if (resolvedDocType === 'Payment' && dbLines.length > 0 && dbLines.some((dl: any) => dl.linked_txn_id || dl.linked_txn_doc_number)) {
        parsedLineItems = dbLines
          .filter((dl: any) => Number(dl.amount || 0) > 0)
          .map((dl: any) => {
            const linkedInv = tenantTxns.find(
              (t: any) =>
                t.txn_type === 'Invoice' &&
                ((dl.linked_txn_uuid && String(t.id) === String(dl.linked_txn_uuid)) ||
                  (dl.linked_txn_id && String(t.qb_txn_id) === String(dl.linked_txn_id)) ||
                  (dl.linked_txn_doc_number && String(t.doc_number) === String(dl.linked_txn_doc_number)))
            )
            const invLabel = linkedInv
              ? `Invoice #${linkedInv.doc_number || linkedInv.qb_txn_id} (${linkedInv.txn_date})`
              : dl.linked_txn_doc_number
              ? `Invoice #${dl.linked_txn_doc_number}`
              : dl.description || 'Payment Applied'
            const origAmt = linkedInv ? Number(linkedInv.total_amount || dl.amount || 0) : Number(dl.amount || 0)
            return {
              itemName: invLabel,
              description: linkedInv?.memo || dl.description || '',
              qty: 1,
              rate: origAmt,
              amount: Number(dl.amount || 0),
            }
          })
      }

      const includeAccSummary =
        body.includeAccountSummary !== undefined
          ? Boolean(body.includeAccountSummary)
          : resolvedDocType === 'Invoice'

      const isReminderFlag = Boolean(body.isReminder)

      const pdfInput: QboInvoicePdfInput = {
        docType: resolvedDocType,
        includeAccountSummary: includeAccSummary,
        isReminder: isReminderFlag,
        companyName: compFull?.company_name || compFull?.legal_name || 'Gutierrez Financial',
        companyAddressLines,
        companyPhone: compFull?.phone || '',
        companyEmail: compFull?.email || 'raquel@tacosgavilan.com',
        invoiceNumber: String(invoiceRow.doc_number || invoiceRow.qb_txn_id || 'DOC'),
        invoiceDate: String(invoiceRow.txn_date || ''),
        dueDate: String(dueDateStr || invoiceRow.txn_date || ''),
        terms: String(termsName),
        paymentMethod: invoiceRow.payment_method || invoiceRow.payment_type || '',
        referenceNumber: invoiceRow.doc_number || '',
        depositToAccount: invoiceRow.account_name || '',
        billToLines,
        contactGreetingName,
        customerDisplayName,
        customerEmail: defaultCustomerEmail,
        accountSummary,
        lineItems: parsedLineItems,
        totalNewCharges: Number(invoiceRow.total_amount || 0),
        balanceDue:
          resolvedDocType === 'Invoice'
            ? includeAccSummary
              ? accountSummary.totalAmountDue
              : Number(invoiceRow.open_balance ?? invoiceRow.total_amount ?? 0)
            : Number(invoiceRow.total_amount || 0),
        memo: invoiceRow.memo || '',
      }

      if (action === 'generate_invoice_pdf') {
        const pdfBuffer = generateQboInvoicePdfBuffer(pdfInput)
        const safeCompanySlug = pdfInput.companyName.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
        const safeInvSlug = String(pdfInput.invoiceNumber || 'DOC').replace(/[^a-zA-Z0-9_-]+/g, '')
        const docPrefix =
          resolvedDocType === 'Payment'
            ? 'Payment_Receipt'
            : resolvedDocType === 'SalesReceipt'
            ? 'Sales_Receipt'
            : resolvedDocType === 'CreditMemo'
            ? 'Credit_Memo'
            : resolvedDocType === 'RefundReceipt'
            ? 'Refund_Receipt'
            : resolvedDocType
        const filename = `${docPrefix}_${safeInvSlug}_from_${safeCompanySlug}.pdf`
        const emailPreviewHtml = generateQboInvoiceEmailHtml(pdfInput, body.customMessage)
        const defaultSubj = isReminderFlag
          ? `Reminder: Invoice #${pdfInput.invoiceNumber} from ${pdfInput.companyName}`
          : `${docPrefix.replace(/_/g, ' ')} #${pdfInput.invoiceNumber} from ${pdfInput.companyName}`

        return NextResponse.json({
          ok: true,
          success: true,
          filename,
          fileName: filename,
          pdfBase64: pdfBuffer.toString('base64'),
          emailPreviewHtml,
          htmlPreview: emailPreviewHtml,
          pdfInput,
          defaultRecipient: defaultCustomerEmail,
          recipientEmail: defaultCustomerEmail,
          subject: defaultSubj,
        })
      }

      // action === 'send_invoice_email'
      const recipientTo = String(body.to || body.toEmail || defaultCustomerEmail || '').trim()
      if (!recipientTo) {
        return NextResponse.json(
          { error: 'Ingresa al menos un correo electrónico destinatario para enviar el documento PDF.' },
          { status: 400 }
        )
      }

      const rawCc = String(body.cc || body.ccEmail || '').trim()
      const parsedToList = recipientTo.split(/[;,]/).map(s => s.trim()).filter(Boolean)
      const parsedCcList = rawCc ? rawCc.split(/[;,]/).map(s => s.trim()).filter(Boolean) : []
      const emailCheckRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      const invalidRecipients = [...parsedToList, ...parsedCcList].filter(e => !emailCheckRegex.test(e))
      if (parsedToList.length === 0 || invalidRecipients.length > 0) {
        const errMsg = `Dirección(es) de correo inválida(s): ${invalidRecipients.join(', ') || recipientTo}`
        await supabase.from('external_accounting_email_log').insert({
          company_realm_id: realmId,
          contact_id: matchedContact?.id || null,
          transaction_id: invoiceRow.id,
          doc_type: isReminderFlag ? 'InvoiceReminder' : resolvedDocType,
          doc_number: pdfInput.invoiceNumber,
          to_email: recipientTo,
          cc_email: rawCc || null,
          subject: body.subject || `${resolvedDocType} #${pdfInput.invoiceNumber} from ${pdfInput.companyName}`,
          amount: pdfInput.balanceDue,
          pdf_file_name: `${resolvedDocType}_${pdfInput.invoiceNumber}.pdf`,
          status: 'Failed',
          error_message: errMsg,
          delivery_provider: 'SMTP',
          sent_by: auth.user.name || auth.user.email,
        })
        return NextResponse.json({ error: errMsg }, { status: 400 })
      }

      const mailRes = await sendQboInvoiceEmail({
        pdfInput,
        toEmails: parsedToList,
        ccEmails: parsedCcList.length > 0 ? parsedCcList : undefined,
        subject: body.subject ? String(body.subject).trim() : undefined,
        customMessage: body.customMessage ? String(body.customMessage).trim() : undefined,
      })

      if (!mailRes.success) {
        await supabase.from('external_accounting_email_log').insert({
          company_realm_id: realmId,
          contact_id: matchedContact?.id || null,
          transaction_id: invoiceRow.id,
          doc_type: isReminderFlag ? 'InvoiceReminder' : resolvedDocType,
          doc_number: pdfInput.invoiceNumber,
          to_email: recipientTo,
          cc_email: rawCc || null,
          subject: body.subject || `${resolvedDocType} #${pdfInput.invoiceNumber} from ${pdfInput.companyName}`,
          amount: pdfInput.balanceDue,
          pdf_file_name: mailRes.filename || `${resolvedDocType}_${pdfInput.invoiceNumber}.pdf`,
          status: 'Failed',
          error_message: mailRes.error || 'Error SMTP enviando correo',
          delivery_provider: 'SMTP',
          sent_by: auth.user.name || auth.user.email,
        })
        return NextResponse.json({ error: mailRes.error || 'Error enviando correo' }, { status: 500 })
      }

      await supabase.from('external_accounting_email_log').insert({
        company_realm_id: realmId,
        contact_id: matchedContact?.id || null,
        transaction_id: invoiceRow.id,
        doc_type: isReminderFlag ? 'InvoiceReminder' : resolvedDocType,
        doc_number: pdfInput.invoiceNumber,
        to_email: recipientTo,
        cc_email: rawCc || null,
        subject: body.subject || `${resolvedDocType} #${pdfInput.invoiceNumber} from ${pdfInput.companyName}`,
        amount: pdfInput.balanceDue,
        pdf_file_name: mailRes.filename,
        message_id: mailRes.messageId || null,
        status: 'Sent',
        error_message: null,
        delivery_provider: 'SMTP',
        sent_by: auth.user.name || auth.user.email,
      })

      await logExternalAccountingAudit(supabase, {
        realmId,
        user: auth.user,
        actionType: 'SEND_INVOICE_EMAIL',
        entityType: resolvedDocType,
        entityId: invoiceRow.id,
        docNumber: pdfInput.invoiceNumber,
        amount: pdfInput.balanceDue,
        summary: `Envió ${resolvedDocType} PDF (${mailRes.filename}) por correo a ${mailRes.recipients.join(', ')} — $${pdfInput.balanceDue.toFixed(2)}`,
        details: { recipients: mailRes.recipients, filename: mailRes.filename, messageId: mailRes.messageId }
      })

      return NextResponse.json({
        ok: true,
        success: true,
        messageId: mailRes.messageId,
        recipients: mailRes.recipients,
        sentTo: mailRes.recipients.join(', '),
        filename: mailRes.filename,
        fileName: mailRes.filename,
        pdfBase64: mailRes.pdfBase64,
        pdfInput,
      })
    }

    // -------------------------------------------------------------------------
    // 15. GENERATE & EMAIL OFFICIAL QBO CUSTOMER / TENANT STATEMENT PDF (`generate_statement_pdf` / `send_statement_email`)
    // -------------------------------------------------------------------------
    if (action === 'generate_statement_pdf' || action === 'send_statement_email') {
      const contactId = body.contactId || body.id
      const entityName = String(body.entityName || body.display_name || '').trim()
      const entityQbId = body.qb_contact_id ? String(body.qb_contact_id) : null
      const statementType: QboStatementType =
        body.statementType === 'open_item' || body.statementType === 'transaction_statement'
          ? body.statementType
          : 'balance_forward'
      const reqStartDate = body.startDate ? String(body.startDate).slice(0, 10) : undefined
      const reqEndDate = body.endDate ? String(body.endDate).slice(0, 10) : undefined

      const [compFullRes, contactsRes] = await Promise.all([
        supabase
          .from('external_accounting_companies')
          .select('*')
          .eq('realm_id', realmId)
          .maybeSingle(),
        supabase
          .from('external_accounting_contacts')
          .select('*')
          .eq('company_realm_id', realmId),
      ])

      const compFull = compFullRes.data || companyRecord
      const allContacts = contactsRes.data || []
      const matchedContact = allContacts.find((c: any) =>
        (contactId && String(c.id) === String(contactId)) ||
        (entityQbId && String(c.qb_contact_id) === entityQbId) ||
        (entityName && String(c.display_name || '').trim().toLowerCase() === entityName.toLowerCase())
      )

      const targetQbId = matchedContact?.qb_contact_id ? String(matchedContact.qb_contact_id) : entityQbId
      const targetName = matchedContact?.display_name || entityName || 'Tenant'

      const rawTenantTxns = await fetchEntityTransactions(supabase, realmId, targetQbId, targetName, [
        'Invoice',
        'Payment',
        'CreditMemo',
      ])
      const tenantTxns = (rawTenantTxns || []).filter((t: any) => !t.is_voided)

      const compAddr = compFull?.address && typeof compFull.address === 'object' ? compFull.address : {}
      const companyAddressLines: string[] = []
      if (compAddr.Line1) companyAddressLines.push(String(compAddr.Line1))
      if (compAddr.Line2) companyAddressLines.push(String(compAddr.Line2))
      const cityStateZip = [
        compAddr.City,
        [compAddr.CountrySubDivisionCode, compAddr.PostalCode, compAddr.Country].filter(Boolean).join(' ')
      ].filter(Boolean).join(', ')
      if (cityStateZip) companyAddressLines.push(cityStateZip)

      const billAddr = matchedContact?.address || {}
      const billToLines: string[] = [targetName]
      if (billAddr.Line1) billToLines.push(String(billAddr.Line1))
      const billCityLine = [
        billAddr.City,
        [billAddr.CountrySubDivisionCode, billAddr.PostalCode, billAddr.Country].filter(Boolean).join(' ')
      ].filter(Boolean).join(', ')
      if (billCityLine) billToLines.push(billCityLine)

      const todayIso = reqEndDate || String(body.statementDate || new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })).slice(0, 10)
      const todayMs = new Date(`${todayIso}T12:00:00Z`).getTime()
      const aging = { current: 0, days1_30: 0, days31_60: 0, days61_90: 0, over90: 0 }
      let totalBalanceDue = 0

      for (const t of tenantTxns) {
        if (t.txn_type === 'Invoice') {
          const openAmt = Number(t.open_balance ?? t.raw_data?.Balance ?? t.total_amount ?? 0)
          if (openAmt > 0) {
            totalBalanceDue = Number((totalBalanceDue + openAmt).toFixed(2))
            const dueStr = String(t.due_date || t.txn_date || todayIso).slice(0, 10)
            const diffDays = Math.floor((todayMs - new Date(`${dueStr}T12:00:00Z`).getTime()) / 86400000)
            if (diffDays <= 0) aging.current = Number((aging.current + openAmt).toFixed(2))
            else if (diffDays <= 30) aging.days1_30 = Number((aging.days1_30 + openAmt).toFixed(2))
            else if (diffDays <= 60) aging.days31_60 = Number((aging.days31_60 + openAmt).toFixed(2))
            else if (diffDays <= 90) aging.days61_90 = Number((aging.days61_90 + openAmt).toFixed(2))
            else aging.over90 = Number((aging.over90 + openAmt).toFixed(2))
          }
        }
      }

      const stmtInput: QboStatementPdfInput = {
        statementType,
        startDate: reqStartDate,
        endDate: reqEndDate || todayIso,
        companyName: compFull?.company_name || compFull?.legal_name || 'Gutierrez Financial',
        companyAddressLines,
        companyPhone: compFull?.phone || '',
        companyEmail: compFull?.email || 'raquel@tacosgavilan.com',
        statementDate: todayIso,
        customerDisplayName: targetName,
        billToLines,
        totalBalanceDue,
        transactions: tenantTxns,
        aging,
      }

      const pdfBuffer = generateQboStatementPdfBuffer(stmtInput)
      const safeTenantSlug = targetName.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
      const filename = `Statement_${safeTenantSlug}_${todayIso}.pdf`
      const defaultCustomerEmail = matchedContact?.email || ''
      const emailPreviewHtml = generateQboStatementEmailHtml(stmtInput, body.customMessage)

      if (action === 'generate_statement_pdf') {
        return NextResponse.json({
          ok: true,
          success: true,
          filename,
          fileName: filename,
          pdfBase64: pdfBuffer.toString('base64'),
          emailPreviewHtml,
          defaultRecipient: defaultCustomerEmail,
          recipientEmail: defaultCustomerEmail,
          subject: `Statement from ${stmtInput.companyName} (${todayIso})`,
          totalBalanceDue,
          aging,
        })
      }

      // action === 'send_statement_email'
      const recipientTo = String(body.to || body.toEmail || defaultCustomerEmail || '').trim()
      if (!recipientTo) {
        return NextResponse.json(
          { error: 'Ingresa al menos un correo electrónico destinatario para enviar el Estado de Cuenta PDF.' },
          { status: 400 }
        )
      }
      const rawCc = String(body.cc || body.ccEmail || '').trim()
      const parsedToList = recipientTo.split(/[;,]/).map(s => s.trim()).filter(Boolean)
      const parsedCcList = rawCc ? rawCc.split(/[;,]/).map(s => s.trim()).filter(Boolean) : []
      const emailCheckRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      const invalidRecipients = [...parsedToList, ...parsedCcList].filter(e => !emailCheckRegex.test(e))
      if (parsedToList.length === 0 || invalidRecipients.length > 0) {
        const errMsg = `Dirección(es) de correo inválida(s): ${invalidRecipients.join(', ') || recipientTo}`
        await supabase.from('external_accounting_email_log').insert({
          company_realm_id: realmId,
          contact_id: matchedContact?.id || null,
          transaction_id: null,
          doc_type: 'Statement',
          doc_number: todayIso,
          to_email: recipientTo,
          cc_email: rawCc || null,
          subject: body.subject || `Statement from ${stmtInput.companyName}`,
          amount: totalBalanceDue,
          pdf_file_name: filename,
          status: 'Failed',
          error_message: errMsg,
          delivery_provider: 'SMTP',
          sent_by: auth.user.name || auth.user.email,
        })
        return NextResponse.json({ error: errMsg }, { status: 400 })
      }

      const stmtMailRes = await sendQboStatementEmail({
        statementInput: stmtInput,
        toEmails: parsedToList,
        ccEmails: parsedCcList.length > 0 ? parsedCcList : undefined,
        subject: body.subject ? String(body.subject).trim() : undefined,
        customMessage: body.customMessage ? String(body.customMessage).trim() : undefined,
      })

      if (!stmtMailRes.success) {
        await supabase.from('external_accounting_email_log').insert({
          company_realm_id: realmId,
          contact_id: matchedContact?.id || null,
          transaction_id: null,
          doc_type: 'Statement',
          doc_number: todayIso,
          to_email: recipientTo,
          cc_email: rawCc || null,
          subject: body.subject || `Statement from ${stmtInput.companyName}`,
          amount: totalBalanceDue,
          pdf_file_name: stmtMailRes.filename || filename,
          status: 'Failed',
          error_message: stmtMailRes.error || 'Error SMTP enviando estado de cuenta',
          delivery_provider: 'SMTP',
          sent_by: auth.user.name || auth.user.email,
        })
        return NextResponse.json({ error: stmtMailRes.error || 'Error enviando estado de cuenta' }, { status: 500 })
      }

      await supabase.from('external_accounting_email_log').insert({
        company_realm_id: realmId,
        contact_id: matchedContact?.id || null,
        transaction_id: null,
        doc_type: 'Statement',
        doc_number: todayIso,
        to_email: recipientTo,
        cc_email: rawCc || null,
        subject: body.subject || `Statement from ${stmtInput.companyName}`,
        amount: totalBalanceDue,
        pdf_file_name: stmtMailRes.filename,
        message_id: stmtMailRes.messageId || null,
        status: 'Sent',
        error_message: null,
        delivery_provider: 'SMTP',
        sent_by: auth.user.name || auth.user.email,
      })

      await logExternalAccountingAudit(supabase, {
        realmId,
        user: auth.user,
        actionType: 'SEND_STATEMENT_EMAIL',
        entityType: 'Statement',
        entityId: matchedContact?.id || targetName,
        docNumber: todayIso,
        amount: totalBalanceDue,
        summary: `Envió Estado de Cuenta PDF (${stmtMailRes.filename}) por correo a ${stmtMailRes.recipients.join(', ')} — Saldo $${totalBalanceDue.toFixed(2)}`,
        details: { recipients: stmtMailRes.recipients, filename: stmtMailRes.filename, statementType }
      })

      return NextResponse.json({
        ok: true,
        success: true,
        messageId: stmtMailRes.messageId,
        recipients: stmtMailRes.recipients,
        sentTo: stmtMailRes.recipients.join(', '),
        filename: stmtMailRes.filename,
        pdfBase64: stmtMailRes.pdfBase64,
        totalBalanceDue,
        aging,
      })
    }

    // -------------------------------------------------------------------------
    // 16. SAVE CONTACT NOTE, TASKS, LATE FEE POLICY & ATTACHMENTS
    // -------------------------------------------------------------------------
    if (action === 'save_contact_note') {
      const contactId = body.contactId || body.id
      const noteText = String(body.note ?? body.notes ?? '').trim()
      if (!contactId) {
        return NextResponse.json({ error: 'contactId is required' }, { status: 400 })
      }

      const { data: existingCon, error: findErr } = await supabase
        .from('external_accounting_contacts')
        .select('*')
        .eq('id', contactId)
        .eq('company_realm_id', realmId)
        .maybeSingle()

      if (findErr || !existingCon) {
        return NextResponse.json({ error: 'Contacto no encontrado en la empresa activa.' }, { status: 404 })
      }

      const rawObj = existingCon.raw_data && typeof existingCon.raw_data === 'object' ? existingCon.raw_data : {}
      const existingNotesList: any[] = Array.isArray(rawObj.notes_history) ? rawObj.notes_history : []
      const newEntry = {
        id: `NOTE-${Date.now()}`,
        text: noteText,
        author: auth.user.name || auth.user.email,
        created_at: new Date().toISOString(),
      }
      const nextRaw = {
        ...rawObj,
        Notes: noteText,
        notes_history: noteText ? [newEntry, ...existingNotesList.slice(0, 49)] : existingNotesList,
      }

      const isCompanyQboSyncEnabled = serverQboSyncEnabled
      const notePayload = {
        sync_contact_id: existingCon.id,
        contact_notes_value: noteText,
        contact_raw_data: nextRaw,
        skip_note_task_row: !noteText,
        contact_id: existingCon.id,
        qb_contact_id: existingCon.qb_contact_id,
        contact_name: existingCon.display_name,
        record_type: 'Note',
        title: noteText ? noteText.slice(0, 120) : 'Cleared Note',
        content: noteText || null,
        status: 'Pinned',
        is_pinned: true,
        created_by: auth.user.name || auth.user.email,
      }

      const atomicNoteRes = await mutateEntityAtomically(supabase, {
        entityKind: 'NOTE_TASK',
        operation: 'UPSERT',
        realmId,
        record: notePayload,
        user: auth.user,
        audit: {
          actionType: 'SAVE_CONTACT_NOTE',
          entityType: 'Note',
          entityId: existingCon.id,
          summary: `Actualizó nota contable de ${existingCon.display_name}`,
        },
        outbox: {
          idempotencyKey: `NOTE-UPSERT-${realmId}-${existingCon.id}-${Date.now()}`,
          status: isCompanyQboSyncEnabled ? 'PENDING' : 'SKIPPED_LOCAL_ONLY',
          payload: notePayload,
        },
      })

      if (atomicNoteRes.outboxId && isCompanyQboSyncEnabled) {
        await processSingleOutboxEntry(supabase, atomicNoteRes.outboxId, { forceNow: true })
      }

      return NextResponse.json({
        ok: true,
        success: true,
        contact: { ...existingCon, notes: noteText, raw_data: nextRaw },
        note: atomicNoteRes.record,
        auditId: atomicNoteRes.auditId,
        outboxId: atomicNoteRes.outboxId,
      })
    }

    if (action === 'save_contact_task') {
      const contactId = body.contactId || body.contact_id || null
      const title = String(body.title || '').trim()
      if (!title) {
        return NextResponse.json({ error: 'El título de la tarea es obligatorio.' }, { status: 400 })
      }
      const isCompanyQboSyncEnabled = serverQboSyncEnabled
      const taskPayload = {
        company_realm_id: realmId,
        contact_id: contactId,
        qb_contact_id: body.qb_contact_id || null,
        contact_name: body.contact_name || body.entity_name || null,
        record_type: body.record_type === 'Note' ? 'Note' : 'Task',
        title,
        content: body.content || body.notes || null,
        due_date: body.due_date || null,
        status: 'Open',
        is_pinned: Boolean(body.is_pinned),
        created_by: auth.user.name || auth.user.email,
      }

      const atomicTaskRes = await mutateEntityAtomically(supabase, {
        entityKind: 'NOTE_TASK',
        operation: 'UPSERT',
        realmId,
        record: taskPayload,
        user: auth.user,
        audit: {
          actionType: 'SAVE_CONTACT_TASK',
          entityType: taskPayload.record_type,
          entityId: contactId || undefined,
          summary: `Creó ${taskPayload.record_type === 'Note' ? 'nota' : 'tarea'}: "${title}"`,
        },
        outbox: {
          idempotencyKey: `TASK-UPSERT-${realmId}-${Date.now()}`,
          status: isCompanyQboSyncEnabled ? 'PENDING' : 'SKIPPED_LOCAL_ONLY',
          payload: taskPayload,
        },
      })

      if (atomicTaskRes.outboxId && isCompanyQboSyncEnabled) {
        await processSingleOutboxEntry(supabase, atomicTaskRes.outboxId, { forceNow: true })
      }

      return NextResponse.json({
        ok: true,
        success: true,
        task: atomicTaskRes.record,
        item: atomicTaskRes.record,
        auditId: atomicTaskRes.auditId,
        outboxId: atomicTaskRes.outboxId,
        outboxStatus: atomicTaskRes.outboxStatus,
      })
    }

    if (action === 'toggle_contact_task') {
      const taskId = body.taskId || body.id
      if (!taskId) {
        return NextResponse.json({ error: 'taskId is required' }, { status: 400 })
      }
      const { data: existingTask } = await supabase
        .from('external_accounting_notes_tasks')
        .select('*')
        .eq('id', taskId)
        .eq('company_realm_id', realmId)
        .maybeSingle()

      if (!existingTask) {
        return NextResponse.json({ error: 'Tarea no encontrada.' }, { status: 404 })
      }

      const isCompanyQboSyncEnabled = serverQboSyncEnabled
      const atomicToggleTask = await mutateEntityAtomically(supabase, {
        entityKind: 'NOTE_TASK',
        operation: 'TOGGLE',
        realmId,
        record: { id: taskId, record_type: existingTask.record_type || 'Task' },
        user: auth.user,
        audit: {
          actionType: 'TOGGLE_CONTACT_TASK',
          entityType: existingTask.record_type || 'Task',
          entityId: taskId,
          summary: `Cambió estado de tarea "${existingTask.title || taskId}"`,
        },
        outbox: {
          idempotencyKey: `TASK-TOGGLE-${realmId}-${taskId}-${Date.now()}`,
          operation: 'TOGGLE',
          status: isCompanyQboSyncEnabled ? 'PENDING' : 'SKIPPED_LOCAL_ONLY',
          payload: { id: taskId },
        },
      })

      if (atomicToggleTask.outboxId && isCompanyQboSyncEnabled) {
        await processSingleOutboxEntry(supabase, atomicToggleTask.outboxId, { forceNow: true })
      }

      return NextResponse.json({
        ok: true,
        success: true,
        task: atomicToggleTask.record,
        item: atomicToggleTask.record,
        auditId: atomicToggleTask.auditId,
        outboxId: atomicToggleTask.outboxId,
        outboxStatus: atomicToggleTask.outboxStatus,
      })
    }

    if (action === 'delete_contact_task') {
      const taskId = body.taskId || body.id
      if (!taskId) {
        return NextResponse.json({ error: 'taskId is required' }, { status: 400 })
      }

      const isCompanyQboSyncEnabled = serverQboSyncEnabled
      const atomicDelTask = await mutateEntityAtomically(supabase, {
        entityKind: 'NOTE_TASK',
        operation: 'DELETE',
        realmId,
        record: { id: taskId },
        user: auth.user,
        audit: {
          actionType: 'DELETE_CONTACT_TASK',
          entityType: 'Task',
          entityId: taskId,
          summary: `Eliminó tarea/nota #${taskId}`,
        },
        outbox: {
          idempotencyKey: `TASK-DELETE-${realmId}-${taskId}-${Date.now()}`,
          status: isCompanyQboSyncEnabled ? 'PENDING' : 'SKIPPED_LOCAL_ONLY',
          payload: { id: taskId },
        },
      })

      if (atomicDelTask.outboxId && isCompanyQboSyncEnabled) {
        await processSingleOutboxEntry(supabase, atomicDelTask.outboxId, { forceNow: true })
      }

      return NextResponse.json({
        ok: true,
        success: true,
        auditId: atomicDelTask.auditId,
        outboxId: atomicDelTask.outboxId,
      })
    }

    if (action === 'save_late_fee_policy') {
      const contactId = body.contactId || body.id
      if (!contactId) {
        return NextResponse.json({ error: 'contactId is required' }, { status: 400 })
      }
      const polObj = body.policy && typeof body.policy === 'object' ? body.policy : {}
      const feeType = polObj.type || polObj.feeType || body.feeType || 'flat'
      const feeAmount = Number(polObj.amount ?? polObj.feeAmount ?? body.feeAmount ?? 50)
      const gracePeriodDays = Number(polObj.graceDays ?? polObj.gracePeriodDays ?? body.gracePeriodDays ?? 5)
      const policy = {
        enabled: Boolean(body.enabled ?? true),
        type: feeType,
        feeType,
        amount: feeAmount,
        feeAmount,
        graceDays: gracePeriodDays,
        gracePeriodDays,
        frequency: body.frequency || 'once_per_invoice',
        updated_at: new Date().toISOString(),
      }
      const { data: existingCon } = await supabase
        .from('external_accounting_contacts')
        .select('*')
        .eq('id', contactId)
        .eq('company_realm_id', realmId)
        .maybeSingle()
      if (!existingCon) {
        return NextResponse.json({ error: 'Contacto no encontrado en la empresa activa.' }, { status: 404 })
      }
      const nextRaw = {
        ...(existingCon.raw_data && typeof existingCon.raw_data === 'object' ? existingCon.raw_data : {}),
        LateFeePolicy: policy,
      }
      const isCompanyQboSyncEnabled = serverQboSyncEnabled
      const atomicPolicyRes = await mutateEntityAtomically(supabase, {
        entityKind: 'CONTACT',
        operation: 'UPSERT',
        realmId,
        record: {
          ...existingCon,
          id: existingCon.id,
          late_fee_policy: policy,
          raw_data: nextRaw,
        },
        user: auth.user,
        audit: {
          actionType: 'SAVE_LATE_FEE_POLICY',
          entityType: existingCon.contact_type || 'Customer',
          entityId: existingCon.id,
          amount: feeAmount,
          summary: `Actualizó política de recargos por mora (Late Fee) para ${existingCon.display_name}`,
        },
        outbox: {
          idempotencyKey: `CON-POLICY-${realmId}-${existingCon.id}-${Date.now()}`,
          status: isCompanyQboSyncEnabled ? 'PENDING' : 'SKIPPED_LOCAL_ONLY',
          payload: { id: existingCon.id, late_fee_policy: policy },
        },
      })

      if (atomicPolicyRes.outboxId && isCompanyQboSyncEnabled) {
        await processSingleOutboxEntry(supabase, atomicPolicyRes.outboxId, { forceNow: true })
      }

      return NextResponse.json({
        ok: true,
        success: true,
        contact: atomicPolicyRes.record,
        auditId: atomicPolicyRes.auditId,
        outboxId: atomicPolicyRes.outboxId,
      })
    }

    if (action === 'save_contact_attachment') {
      const fileName = String(body.file_name || body.fileName || '').trim()
      if (!fileName) {
        return NextResponse.json({ error: 'file_name is required' }, { status: 400 })
      }
      const contactId = body.contact_id || body.contactId || null
      const transactionId = body.transaction_id || body.transactionId || null
      const contactName = body.contact_name || body.entity_name || null
      const qbAttachableId = body.qb_attachable_id ? String(body.qb_attachable_id) : `LOCAL-ATT-${Date.now()}-${Math.floor(Math.random() * 1000)}`
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

      // Pre-validate contactId / transactionId BEFORE uploading bytes to Supabase Storage
      if (contactId) {
        if (!uuidRegex.test(String(contactId))) {
          return NextResponse.json(
            { error: `Invalid contact_id UUID: ${contactId}`, rolledBack: true },
            { status: 400 }
          )
        }
        const { data: validCon } = await supabase
          .from('external_accounting_contacts')
          .select('id')
          .eq('id', String(contactId))
          .eq('company_realm_id', realmId)
          .maybeSingle()
        if (!validCon) {
          return NextResponse.json(
            { error: `Contact ${contactId} not found in active company ${realmId}`, rolledBack: true },
            { status: 400 }
          )
        }
      }
      if (transactionId) {
        if (!uuidRegex.test(String(transactionId))) {
          return NextResponse.json(
            { error: `Invalid transaction_id UUID: ${transactionId}`, rolledBack: true },
            { status: 400 }
          )
        }
        const { data: validTxn } = await supabase
          .from('external_accounting_transactions')
          .select('id')
          .eq('id', String(transactionId))
          .eq('company_realm_id', realmId)
          .maybeSingle()
        if (!validTxn) {
          return NextResponse.json(
            { error: `Transaction ${transactionId} not found in active company ${realmId}`, rolledBack: true },
            { status: 400 }
          )
        }
      }

      let storageMeta: Awaited<ReturnType<typeof uploadAttachmentToSupabaseStorage>>
      try {
        storageMeta = await uploadAttachmentToSupabaseStorage(supabase, realmId, {
          fileName,
          contentType: body.content_type || body.contentType || 'application/pdf',
          dataUrl: body.data_url || body.dataUrl || null,
          fileBase64: body.file_base64 || body.fileBase64 || null,
          sizeBytes: Number(body.size_bytes || body.file_size || 0),
          clientSha256: body.sha256_hash || body.client_sha256 || null,
          allowMetadataOnly: Boolean(body.allowMetadataOnly),
        })
      } catch (uploadValErr: any) {
        const status = Number(uploadValErr.statusCode || 400)
        return NextResponse.json(
          { error: uploadValErr.message || 'Error validando o subiendo adjunto.', rolledBack: true },
          { status }
        )
      }

      const cleanRawData = {
        contact_id: contactId,
        qb_contact_id: body.qb_contact_id || null,
        transaction_id: transactionId,
        qb_txn_id: body.qb_txn_id || null,
        contact_name: contactName,
        entity_name: contactName,
        storage_bucket: storageMeta.storageBucket,
        storage_path: storageMeta.storagePath,
        sha256_hash: storageMeta.sha256Hash,
        uploaded_by: auth.user.name || auth.user.email,
      }

      const attPayload: Record<string, any> = {
        id: body.id || undefined,
        company_realm_id: realmId,
        qb_attachable_id: qbAttachableId,
        contact_id: contactId,
        qb_contact_id: body.qb_contact_id || null,
        transaction_id: transactionId,
        qb_txn_id: body.qb_txn_id || null,
        linked_entity_type: body.linked_entity_type || (transactionId ? 'Transaction' : 'Contact'),
        linked_entity_id: body.linked_entity_id || body.qb_txn_id || body.qb_contact_id || null,
        file_name: fileName,
        content_type: storageMeta.contentType,
        file_size: storageMeta.fileSize,
        size_bytes: storageMeta.fileSize,
        storage_bucket: storageMeta.storageBucket,
        storage_path: storageMeta.storagePath,
        sha256_hash: storageMeta.sha256Hash,
        file_url: storageMeta.fileUrl || body.file_url || null,
        note: body.note || (contactName ? `Attached to ${contactName}` : null),
        force_db_failure:
          isTestFaultInjectionAllowed &&
          Boolean(body.force_db_failure || body.forceDbFailure),
        raw_data: cleanRawData,
      }

      const isCompanyQboSyncEnabled = serverQboSyncEnabled
      let atomicAttRes: Awaited<ReturnType<typeof mutateEntityAtomically>>
      try {
        atomicAttRes = await mutateEntityAtomically(supabase, {
          entityKind: 'ATTACHMENT',
          operation: 'UPSERT',
          realmId,
          record: attPayload,
          user: auth.user,
          audit: {
            actionType: 'UPLOAD_ATTACHMENT_STORAGE',
            entityType: 'Attachment',
            entityId: qbAttachableId,
            amount: storageMeta.fileSize,
            summary: `Subió adjunto "${fileName}" (${storageMeta.fileSize} bytes, SHA-256 ${(storageMeta.sha256Hash || '').slice(0, 12)}) a Supabase Storage`,
          },
          outbox: {
            idempotencyKey: `ATT-UPSERT-${realmId}-${qbAttachableId}-${Date.now()}`,
            status: isCompanyQboSyncEnabled ? 'PENDING' : 'SKIPPED_LOCAL_ONLY',
            payload: attPayload,
          },
        })
      } catch (attDbErr: any) {
        // Compensating Storage cleanup: immediately remove the uploaded file if DB RPC fails
        let storageCleanedUp = false
        if (storageMeta.storageBucket && storageMeta.storagePath) {
          const { error: rmErr } = await supabase.storage
            .from(storageMeta.storageBucket)
            .remove([storageMeta.storagePath])
          storageCleanedUp = !rmErr
        }
        return NextResponse.json(
          {
            error: attDbErr.message || 'Error atómico al registrar adjunto en BD (Storage revertido).',
            rolledBack: true,
            storageCleanedUp,
            cleanedStorageBucket: storageMeta.storageBucket,
            cleanedStoragePath: storageMeta.storagePath,
          },
          { status: 400 }
        )
      }

      if (atomicAttRes.outboxId && isCompanyQboSyncEnabled) {
        await processSingleOutboxEntry(supabase, atomicAttRes.outboxId, { forceNow: true })
      }

      const savedAtt = {
        ...atomicAttRes.record,
        file_url: storageMeta.fileUrl || atomicAttRes.record?.file_url || null,
        download_url: storageMeta.fileUrl || atomicAttRes.record?.file_url || null,
        data_url: null,
      }

      return NextResponse.json({
        ok: true,
        success: true,
        attachment: savedAtt,
        auditId: atomicAttRes.auditId,
        outboxId: atomicAttRes.outboxId,
        outboxStatus: atomicAttRes.outboxStatus,
      })
    }

    if (action === 'get_attachment_download_url') {
      const attachmentId = body.id || body.attachmentId || body.qb_attachable_id
      if (!attachmentId) {
        return NextResponse.json({ error: 'attachmentId is required' }, { status: 400 })
      }
      let query = supabase
        .from('external_accounting_attachments')
        .select('*')
        .eq('company_realm_id', realmId)
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(attachmentId))) {
        query = query.eq('id', String(attachmentId))
      } else {
        query = query.eq('qb_attachable_id', String(attachmentId))
      }
      const { data: attRow } = await query.maybeSingle()
      if (!attRow) {
        return NextResponse.json({ error: 'Adjunto no encontrado en la empresa activa.' }, { status: 404 })
      }

      let signedUrl: string | null = attRow.file_url || null
      let downloadedBase64: string | null = null
      let verifiedSha256: string | null = null
      if (attRow.storage_bucket && attRow.storage_path) {
        const { data: signedObj } = await supabase.storage
          .from(attRow.storage_bucket)
          .createSignedUrl(attRow.storage_path, 3600)
        if (signedObj?.signedUrl) {
          signedUrl = signedObj.signedUrl
        }
        if (body.includeContent) {
          const { data: blobData, error: dlErr } = await supabase.storage
            .from(attRow.storage_bucket)
            .download(attRow.storage_path)
          if (dlErr) {
            return NextResponse.json({ error: `Error leyendo objeto de Storage: ${dlErr.message}` }, { status: 500 })
          }
          if (blobData) {
            const arrBuf = await blobData.arrayBuffer()
            const buf = Buffer.from(arrBuf)
            downloadedBase64 = buf.toString('base64')
            verifiedSha256 = crypto.createHash('sha256').update(buf).digest('hex')
          }
        }
      }

      return NextResponse.json({
        ok: true,
        success: true,
        attachment: {
          ...attRow,
          file_url: signedUrl,
          download_url: signedUrl,
          data_url: null,
        },
        signedUrl,
        download_url: signedUrl,
        downloadedBase64,
        verifiedSha256,
        sha256_hash: verifiedSha256 || attRow.sha256_hash || null,
        integrityVerified: Boolean(verifiedSha256 && attRow.sha256_hash && verifiedSha256 === attRow.sha256_hash),
      })
    }

    if (action === 'delete_attachment' || action === 'delete_contact_attachment') {
      const attachmentId = body.id || body.attachmentId || body.qb_attachable_id
      if (!attachmentId) {
        return NextResponse.json({ error: 'attachmentId is required' }, { status: 400 })
      }
      let query = supabase
        .from('external_accounting_attachments')
        .select('*')
        .eq('company_realm_id', realmId)
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(attachmentId))) {
        query = query.eq('id', String(attachmentId))
      } else {
        query = query.eq('qb_attachable_id', String(attachmentId))
      }
      const { data: attRow } = await query.maybeSingle()
      if (!attRow) {
        return NextResponse.json({ error: 'Adjunto no encontrado en la empresa activa.' }, { status: 404 })
      }

      // 1. Delete DB record + Audit + Outbox FIRST inside the atomic PostgreSQL transaction.
      //    If the DB transaction fails, Storage is NEVER touched (zero dangling DB references to deleted files).
      const isCompanyQboSyncEnabled = serverQboSyncEnabled
      let atomicDelAtt: Awaited<ReturnType<typeof mutateEntityAtomically>>
      try {
        atomicDelAtt = await mutateEntityAtomically(supabase, {
          entityKind: 'ATTACHMENT',
          operation: 'DELETE',
          realmId,
          record: {
            id: attRow.id,
            qb_attachable_id: attRow.qb_attachable_id,
            force_db_failure:
              isTestFaultInjectionAllowed &&
              Boolean(body.force_db_failure || body.forceDbFailure),
          },
          user: auth.user,
          audit: {
            actionType: 'DELETE_ATTACHMENT_STORAGE',
            entityType: 'Attachment',
            entityId: attRow.id,
            amount: Number(attRow.file_size || attRow.size_bytes || 0),
            summary: `Eliminó adjunto "${attRow.file_name}" de base de datos y Supabase Storage`,
          },
          outbox: {
            idempotencyKey: `ATT-DELETE-${realmId}-${attRow.qb_attachable_id}-${Date.now()}`,
            status: isCompanyQboSyncEnabled ? 'PENDING' : 'SKIPPED_LOCAL_ONLY',
            payload: { id: attRow.id, qb_attachable_id: attRow.qb_attachable_id },
          },
        })
      } catch (delAttErr: any) {
        return NextResponse.json(
          {
            error: delAttErr.message || 'Error atómico al eliminar adjunto de BD (archivo en Storage preservado).',
            rolledBack: true,
            storagePreserved: true,
          },
          { status: 400 }
        )
      }

      // 2. Only AFTER the DB delete succeeded atomically, remove the physical file from Supabase Storage.
      //    If physical deletion fails, persist a durable STORAGE_CLEANUP compensation task in outbox + audit_log.
      let storageDeleteMeta: {
        storageRemoved: boolean
        storageCompensationQueued: boolean
        storageCompensationOutboxId: string | null
        storageRemoveError: string | null
      } = {
        storageRemoved: false,
        storageCompensationQueued: false,
        storageCompensationOutboxId: null,
        storageRemoveError: null,
      }
      try {
        storageDeleteMeta = await removeAttachmentFromStorageOrQueueCompensation(supabase, {
          realmId,
          user: auth.user,
          attRow,
          simulateStorageRemoveFailure:
            isTestFaultInjectionAllowed &&
            Boolean(body.force_storage_remove_failure || body.forceStorageRemoveFailure),
        })
      } catch (compQueueErr: any) {
        return NextResponse.json(
          {
            error: compQueueErr.message || 'Error encolando tarea de compensación de Storage.',
            code: 'STORAGE_COMPENSATION_QUEUE_FAILED',
          },
          { status: 500 }
        )
      }

      if (atomicDelAtt.outboxId && isCompanyQboSyncEnabled) {
        await processSingleOutboxEntry(supabase, atomicDelAtt.outboxId, { forceNow: true })
      }

      return NextResponse.json({
        ok: true,
        success: true,
        outboxId: atomicDelAtt.outboxId,
        storageRemoved: storageDeleteMeta.storageRemoved,
        storageCompensationQueued: storageDeleteMeta.storageCompensationQueued,
        storageCompensationOutboxId: storageDeleteMeta.storageCompensationOutboxId,
        storageRemoveError: storageDeleteMeta.storageRemoveError,
      })
    }

    if (action === 'process_qbo_outbox') {
      const MAX_MANUAL_OUTBOX_BATCH_LIMIT = 50
      const rawLimitProvided = body.limit !== undefined && body.limit !== null && String(body.limit).trim() !== ''
      const parsedRequestedLimit = rawLimitProvided ? Number(body.limit) : 25
      if (!Number.isFinite(parsedRequestedLimit) || parsedRequestedLimit <= 0) {
        return NextResponse.json(
          {
            error: 'El parámetro limit para process_qbo_outbox debe ser un entero positivo entre 1 y 50.',
            code: 'INVALID_OUTBOX_BATCH_LIMIT',
          },
          { status: 400 }
        )
      }
      const requestedLimit = Math.floor(parsedRequestedLimit)
      const effectiveLimit = Math.min(requestedLimit, MAX_MANUAL_OUTBOX_BATCH_LIMIT)
      const cappedByServer = requestedLimit > MAX_MANUAL_OUTBOX_BATCH_LIMIT
      const forceNow = Boolean(body.forceNow)

      const workerRes = await processPendingQboOutbox(supabase, {
        realmId,
        limit: effectiveLimit,
        forceNow,
      })

      await logExternalAccountingAudit(supabase, {
        realmId,
        user: auth.user,
        actionType: 'PROCESS_QBO_OUTBOX',
        entityType: 'SyncOutbox',
        amount: workerRes.processedCount,
        summary: `Ejecutó cola manual Outbox QBO (limit=${effectiveLimit}${cappedByServer ? ` [tope servidor desde ${requestedLimit}]` : ''}, forceNow=${forceNow}): ${workerRes.processedCount} procesados (${workerRes.syncedCount} sincronizados, ${workerRes.failedCount} fallidos)`,
        details: {
          actor_user_id: auth.user.id,
          actor_email: auth.user.email,
          actor_name: auth.user.name || auth.user.email,
          requested_limit: requestedLimit,
          effective_limit: effectiveLimit,
          max_server_limit: MAX_MANUAL_OUTBOX_BATCH_LIMIT,
          capped_by_server: cappedByServer,
          force_now: forceNow,
          processed_count: workerRes.processedCount,
          synced_count: workerRes.syncedCount,
          failed_count: workerRes.failedCount,
          skipped_count: workerRes.skippedCount,
        },
      })

      return NextResponse.json({
        ok: true,
        success: true,
        requestedLimit,
        effectiveLimit,
        maxServerLimit: MAX_MANUAL_OUTBOX_BATCH_LIMIT,
        cappedByServer,
        forceNow,
        workerResult: workerRes,
      })
    }

    // -------------------------------------------------------------------------
    // 17. WRITE OFF INVOICES (My menu -> Accountant Tools -> Write off invoices / /app/writeoffinvoices) — 100% ACID RPC
    // -------------------------------------------------------------------------
    if (action === 'write_off_invoices') {
      const rawInvoiceIds = Array.isArray(body.invoiceIds)
        ? body.invoiceIds
        : Array.isArray(body.invoice_ids)
          ? body.invoice_ids
          : []
      const invoiceIds: string[] = Array.from(new Set(rawInvoiceIds.map(String).filter(Boolean)))
      if (invoiceIds.length === 0) {
        return NextResponse.json({ error: 'Selecciona al menos una factura (Invoice) con saldo pendiente para condonar (Write Off).' }, { status: 400 })
      }

      const writeOffDate = String(body.writeOffDate || body.write_off_date || new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })).slice(0, 10)
      const periodCheckWriteOff = await ensureOpenAccountingPeriod(writeOffDate, 'write_off_invoices')
      if (!periodCheckWriteOff.allowed) {
        return periodCheckWriteOff.response
      }

      const rawReqAccQbId = body.writeOffAccountQbId || body.bad_debt_account_qb_id
      const requestedAccQbId = rawReqAccQbId ? String(rawReqAccQbId) : null
      if (requestedAccQbId && !acctByQbId.has(requestedAccQbId)) {
        return NextResponse.json({ error: 'La cuenta contable de Write-Off no pertenece a la empresa activa.' }, { status: 400 })
      }
      const writeOffAcc =
        (requestedAccQbId && acctByQbId.get(requestedAccQbId)) ||
        (companyAccounts || []).find(a =>
          a.is_active &&
          (String(a.name || '').toLowerCase().includes('bad debt') ||
            String(a.name || '').toLowerCase().includes('write') ||
            String(a.name || '').toLowerCase().includes('discount') ||
            a.account_type === 'Expense' ||
            a.account_type === 'Income')
        )
      if (!writeOffAcc) {
        return NextResponse.json({ error: 'Selecciona una cuenta contable válida para aplicar el Write-Off.' }, { status: 400 })
      }

      const arDefaultAcc = (companyAccounts || []).find(a => a.account_type === 'Accounts Receivable' && a.is_active)

      const validUuidIds = invoiceIds.filter(idStr => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idStr))
      const [openInvoicesRes, companyContactsRes] = await Promise.all([
        validUuidIds.length > 0
          ? supabase
              .from('external_accounting_transactions')
              .select('*')
              .eq('company_realm_id', realmId)
              .eq('txn_type', 'Invoice')
              .in('id', validUuidIds)
          : Promise.resolve({ data: [] as any[], error: null }),
        supabase
          .from('external_accounting_contacts')
          .select('id, qb_contact_id, display_name, balance')
          .eq('company_realm_id', realmId),
      ])

      if (openInvoicesRes.error) throw openInvoicesRes.error
      const invById = new Map<string, any>()
      for (const inv of openInvoicesRes.data || []) {
        invById.set(String(inv.id), inv)
      }
      const contactsList = companyContactsRes.data || []

      const isCompanyQboSyncEnabled = serverQboSyncEnabled
      const outboxInitialStatus: 'PENDING' | 'SKIPPED_LOCAL_ONLY' = isCompanyQboSyncEnabled ? 'PENDING' : 'SKIPPED_LOCAL_ONLY'

      const batchItems: Array<{
        operation: 'UPSERT'
        txn: Record<string, any>
        deltas: Map<string, number>
        outbox?: {
          entityKind?: string
          entityType: string
          qbEntityId?: string | null
          operation: 'UPSERT'
          idempotencyKey: string
          payload?: Record<string, any>
          status?: 'PENDING' | 'SKIPPED_LOCAL_ONLY'
        }
      }> = []
      const invoiceUpdates: Array<{ invoice_id: string; open_balance: number; raw_data?: Record<string, any> }> = []
      const contactBalReductionMap = new Map<string, { contactId: string; currentBal: number; reduction: number }>()
      let totalWrittenOff = 0

      for (const reqInvId of invoiceIds) {
        const inv = invById.get(String(reqInvId))
        const remBal = inv ? Number(inv.open_balance ?? inv.raw_data?.Balance ?? inv.total_amount ?? 0) : 0
        if (!inv || inv.is_voided || remBal <= 0.009) {
          // Force atomic rollback inside PostgreSQL RPC if any invoice in the batch is invalid/missing/voided/already zero
          batchItems.push({
            operation: 'UPSERT',
            txn: {
              company_realm_id: realmId,
              txn_type: 'CreditMemo',
              qb_entity_type: 'CreditMemo',
              qb_txn_id: `INVALID-WO-${reqInvId}`,
              txn_date: writeOffDate,
              account_qb_id: '__INVALID_WRITE_OFF_INVOICE__',
              total_amount: 0,
              line_items: [],
            },
            deltas: new Map(),
          })
          continue
        }

        const cmQbId = `LOCAL-WO-${Date.now()}-${Math.floor(Math.random() * 10000)}`
        const cmDocNumber = `WO-${inv.doc_number || inv.qb_txn_id || Date.now()}`
        const cmMemo = body.memo || `Write-off of Invoice #${inv.doc_number || inv.qb_txn_id} (${writeOffDate})`
        const cleanRemBal = Number(remBal.toFixed(2))

        const cmPayload: Record<string, any> = {
          company_realm_id: realmId,
          txn_type: 'CreditMemo',
          qb_entity_type: 'CreditMemo',
          qb_txn_id: cmQbId,
          txn_date: writeOffDate,
          doc_number: cmDocNumber,
          payment_type: 'CreditMemo',
          direction: 'ACCRUAL',
          account_qb_id: inv.account_qb_id || arDefaultAcc?.qb_account_id || null,
          account_name: inv.account_name || arDefaultAcc?.name || 'Accounts Receivable (A/R)',
          to_account_qb_id: writeOffAcc.qb_account_id,
          to_account_name: writeOffAcc.name,
          entity_qb_id: inv.entity_qb_id || null,
          entity_name: inv.entity_name || null,
          entity_type: 'Customer',
          total_amount: cleanRemBal,
          open_balance: 0,
          memo: cmMemo,
          category_summary: writeOffAcc.name,
          print_status: 'NotSet',
          cleared_status: 'Cleared',
          is_voided: false,
          custom_fields: { linked_invoice_ids: [inv.id], write_off: true },
          line_items: [{
            id: '1',
            line_num: 1,
            description: cmMemo,
            amount: cleanRemBal,
            account_qb_id: writeOffAcc.qb_account_id,
            account_name: writeOffAcc.name,
            linked_txn_id: inv.qb_txn_id,
            linked_txn_uuid: inv.id,
            linked_txn_doc_number: inv.doc_number,
            linked_txn_type: 'Invoice',
          }],
          created_by: auth.user.name || auth.user.email,
        }

        const cmDeltas = computeTransactionAccountDeltas(acctByQbId, cmPayload, 1, ledgerCtx)
        batchItems.push({
          operation: 'UPSERT',
          txn: cmPayload,
          deltas: cmDeltas,
          outbox: {
            entityKind: 'TRANSACTION',
            entityType: 'CreditMemo',
            qbEntityId: cmQbId,
            operation: 'UPSERT',
            idempotencyKey: `TXN-WO-${realmId}-${cmQbId}`,
            payload: cmPayload,
            status: outboxInitialStatus,
          },
        })

        const nextInvRaw = { ...(inv.raw_data && typeof inv.raw_data === 'object' ? inv.raw_data : {}), Balance: 0 }
        invoiceUpdates.push({
          invoice_id: String(inv.id),
          open_balance: 0,
          raw_data: nextInvRaw,
        })

        const matchedContact = contactsList.find(
          (c: any) =>
            (inv.entity_qb_id && String(c.qb_contact_id) === String(inv.entity_qb_id)) ||
            (inv.entity_name && String(c.display_name || '').trim().toLowerCase() === String(inv.entity_name).trim().toLowerCase())
        )
        if (matchedContact) {
          const prev = contactBalReductionMap.get(String(matchedContact.id)) || {
            contactId: String(matchedContact.id),
            currentBal: Number(matchedContact.balance || 0),
            reduction: 0,
          }
          prev.reduction = Number((prev.reduction + cleanRemBal).toFixed(2))
          contactBalReductionMap.set(String(matchedContact.id), prev)
        }

        totalWrittenOff = Number((totalWrittenOff + cleanRemBal).toFixed(2))
      }

      const contactUpdates = Array.from(contactBalReductionMap.values()).map(item => ({
        contact_id: item.contactId,
        balance: Number(Math.max(0, item.currentBal - item.reduction).toFixed(2)),
      }))

      try {
        const batchWoRes = await batchMutateTransactionsAtomically(supabase, {
          realmId,
          items: batchItems,
          invoiceUpdates,
          contactUpdates,
          user: auth.user,
          outboxStatus: outboxInitialStatus,
          batchAudit: {
            actionType: 'WRITE_OFF_INVOICES',
            entityType: 'WriteOffInvoices',
            amount: totalWrittenOff,
            summary: `Condonó (Write Off) ${batchItems.length} facturas hacia "${writeOffAcc.name}" por un total de $${totalWrittenOff.toFixed(2)}`,
            details: { count: batchItems.length, totalWrittenOff, writeOffAccount: writeOffAcc.name },
          },
        })

        if (isCompanyQboSyncEnabled && batchWoRes.outboxIds.length > 0) {
          for (const outId of batchWoRes.outboxIds) {
            await processSingleOutboxEntry(supabase, outId, { forceNow: true })
          }
        }

        return NextResponse.json({
          ok: true,
          success: true,
          writtenOffCount: batchWoRes.mutatedCount,
          totalWrittenOff,
          creditMemos: batchWoRes.transactions,
          outboxIds: batchWoRes.outboxIds,
        })
      } catch (woErr: any) {
        return NextResponse.json(
          { error: woErr.message || 'Error en condonación atómica (Write Off rollback).', rolledBack: true },
          { status: 400 }
        )
      }
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
  } catch (err: any) {
    console.error('[POST /api/external-accounting] Error:', err)
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 })
  }
}
