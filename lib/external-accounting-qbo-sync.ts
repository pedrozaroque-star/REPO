/**
 * @module lib/external-accounting-qbo-sync
 * @description Motor de Sincronización Bidireccional en Vivo (Two-Way Mirror Sync) entre
 * TEG Contabilidad Externa (Supabase `external_accounting_*`) e Intuit QuickBooks Online V3 REST API
 * para las 8 empresas de Raquel Velazquez.
 *
 * @businessRules
 * - Cada una de las 8 empresas externas (`external_accounting_companies`) almacena sus propios tokens OAuth 2.0
 *   en `metadata.qbo_oauth` (y respaldo en `integrations` bajo `service_name = 'quickbooks_ext_' + realmId`),
 *   aislados al 100% del token principal de Tacos Gavilan (`realm_id = '187736243'`).
 * - Mientras el "Modo Espejo QBO" (`qbo_sync_enabled !== false`) esté activo y la empresa tenga OAuth conectado:
 *   1) Cualquier creación, edición, anulación (`VOID`) o eliminación de transacciones, cuentas o contactos en
 *      `/admin/contabilidad-externa` se replica automáticamente en vivo hacia Intuit QuickBooks Online V3.
 *   2) Si una transacción aún no estaba conectada al momento de capturarse, queda marcada como `PENDING_QBO_SYNC`
 *      y se sube a QBO automáticamente al presionar "Sincronizar con QBO" (`syncCompanyWithQbo`).
 *   3) El botón "Sincronizar con QBO" ejecuta Push de pendientes locales + Pull incremental de cambios hechos en QBO.
 * - Cuando concluya la etapa de pruebas paralelas y se decida apagar QuickBooks ("matar QB"), basta con
 *   desactivar `qbo_sync_enabled` para operar 100% autónomo en Supabase sin tocar una línea de código.
 *
 * @dataFlow
 * `/api/external-accounting` (POST/PUT/DELETE) <-> `lib/external-accounting-qbo-sync.ts` <-> Intuit QBO V3 API (`https://quickbooks.api.intuit.com/v3/company/{realmId}/...`)
 *
 * @notes
 * - Soporta auto-renovación transparente de tokens (`refresh_token`) vía `intuit-oauth`.
 * - Antes de hacer UPDATE o DELETE en QBO, consulta el `SyncToken` más reciente en vivo para evitar errores `Stale Object (5010)`.
 * - 2026-10-27/28 (auditoría contra QBO en vivo): el Pull ahora normaliza también `Bill`, `BillPayment`, `Invoice` y `Payment`
 *   (antes se descargaban pero se descartaban, por lo que faltaban cobros como el Payment #8122 de $8,445.16).
 * - 2026-10-28: los Depósitos se normalizan con `buildDepositLineItems()`: líneas con `LinkedTxn` salen de *Undeposited Funds*
 *   con cliente/factura/método de pago, y el `CashBack` se guarda como línea `CashBackLineDetail` (antes 132 depósitos quedaron
 *   sin cuenta en sus líneas y 43 sin Cash Back; se repararon desde `raw_data`). Los pagos recuperan "Payment for Invoice #N (fecha)",
 *   cada transacción guarda su Location (`DepartmentRef`) y los errores de `upsert` ya no se ignoran en silencio.
 */

import { SupabaseClient } from '@supabase/supabase-js'
import { getAuthClient } from '@/lib/quickbooks'

const QBO_MINOR_VERSION = '73'

export interface QboOAuthState {
  connected: boolean
  syncEnabled: boolean
  realmId: string
  accessToken?: string
  refreshToken?: string
  expiresAt?: string
  connectedAt?: string
  lastSyncedAt?: string
  lastSyncError?: string | null
}

function getQboBaseUrl(): string {
  return process.env.QUICKBOOKS_ENVIRONMENT === 'sandbox'
    ? 'https://sandbox-quickbooks.api.intuit.com'
    : 'https://quickbooks.api.intuit.com'
}

export function isLocalId(qbId: string | null | undefined): boolean {
  if (!qbId) return true
  const s = String(qbId).trim()
  return (
    s.startsWith('LOCAL-') ||
    s.startsWith('REC-') ||
    s.startsWith('BATCH-') ||
    s.startsWith('FEE-') ||
    s.startsWith('INT-')
  )
}

/**
 * Obtiene y refresca automáticamente (si venció) el token OAuth 2.0 de una de las 8 empresas externas.
 */
export async function getExternalCompanyQboAuth(
  supabase: SupabaseClient,
  realmId: string
): Promise<QboOAuthState> {
  const { data: comp } = await supabase
    .from('external_accounting_companies')
    .select('realm_id, company_name, metadata')
    .eq('realm_id', realmId)
    .maybeSingle()

  const meta = comp?.metadata && typeof comp.metadata === 'object' ? comp.metadata : {}
  let oauth = meta.qbo_oauth && typeof meta.qbo_oauth === 'object' ? { ...meta.qbo_oauth } : null
  const syncEnabled = meta.qbo_sync_enabled !== false

  // Fallback check in `integrations` table under `quickbooks_ext_${realmId}`
  if (!oauth?.refresh_token) {
    const { data: extInt } = await supabase
      .from('integrations')
      .select('*')
      .eq('service_name', `quickbooks_ext_${realmId}`)
      .maybeSingle()

    if (extInt?.refresh_token) {
      oauth = {
        access_token: extInt.access_token,
        refresh_token: extInt.refresh_token,
        token_type: extInt.token_type || 'Bearer',
        expires_at: extInt.expires_at,
        connected_at: extInt.updated_at,
      }
    }
  }

  if (!oauth?.refresh_token || !oauth?.access_token) {
    return {
      connected: false,
      syncEnabled,
      realmId,
      lastSyncedAt: oauth?.last_synced_at || undefined,
      lastSyncError: oauth?.last_sync_error || null,
    }
  }

  // Check if access_token is expired or expiring within 90 seconds
  const expiresMs = oauth.expires_at ? new Date(oauth.expires_at).getTime() : 0
  if (expiresMs <= Date.now() + 90_000) {
    try {
      const client = getAuthClient()
      const authResponse = await client.refreshUsingToken(oauth.refresh_token)
      const tokens = authResponse.getJson()
      const newExpiresAt = new Date(Date.now() + Number(tokens.expires_in || 3600) * 1000).toISOString()

      oauth = {
        ...oauth,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token || oauth.refresh_token,
        token_type: tokens.token_type || 'Bearer',
        expires_at: newExpiresAt,
        updated_at: new Date().toISOString(),
        last_sync_error: null,
      }

      const updatedMeta = { ...meta, qbo_oauth: oauth }
      await supabase
        .from('external_accounting_companies')
        .update({ metadata: updatedMeta, updated_at: new Date().toISOString() })
        .eq('realm_id', realmId)

      await supabase.from('integrations').upsert(
        {
          service_name: `quickbooks_ext_${realmId}`,
          realm_id: realmId,
          access_token: oauth.access_token,
          refresh_token: oauth.refresh_token,
          token_type: oauth.token_type,
          expires_at: newExpiresAt,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'service_name' }
      )
    } catch (refreshErr: any) {
      const errMsg = refreshErr?.message || 'Error refreshing QBO token'
      const updatedMeta = {
        ...meta,
        qbo_oauth: { ...oauth, last_sync_error: errMsg },
      }
      await supabase
        .from('external_accounting_companies')
        .update({ metadata: updatedMeta })
        .eq('realm_id', realmId)

      return {
        connected: false,
        syncEnabled,
        realmId,
        lastSyncedAt: oauth?.last_synced_at,
        lastSyncError: `Token QBO expirado o revocado: ${errMsg}`,
      }
    }
  }

  return {
    connected: true,
    syncEnabled,
    realmId,
    accessToken: oauth.access_token,
    refreshToken: oauth.refresh_token,
    expiresAt: oauth.expires_at,
    connectedAt: oauth.connected_at,
    lastSyncedAt: oauth.last_synced_at,
    lastSyncError: oauth.last_sync_error || null,
  }
}

/**
 * Ejecuta una petición autenticada contra Intuit QuickBooks Online V3 API para el `realmId` indicado.
 */
export async function qboV3Request(
  supabase: SupabaseClient,
  realmId: string,
  method: 'GET' | 'POST',
  resourcePath: string,
  payload?: any
): Promise<{ ok: boolean; status: number; data?: any; error?: string }> {
  const auth = await getExternalCompanyQboAuth(supabase, realmId)
  if (!auth.connected || !auth.accessToken) {
    return {
      ok: false,
      status: 401,
      error: auth.lastSyncError || 'Empresa no conectada por OAuth a QuickBooks Online.',
    }
  }

  const sep = resourcePath.includes('?') ? '&' : '?'
  const url = `${getQboBaseUrl()}/v3/company/${realmId}/${resourcePath}${sep}minorversion=${QBO_MINOR_VERSION}`

  const headers: Record<string, string> = {
    Authorization: `Bearer ${auth.accessToken}`,
    Accept: 'application/json',
  }
  if (method === 'POST') {
    headers['Content-Type'] = 'application/json'
  }

  const res = await fetch(url, {
    method,
    headers,
    body: method === 'POST' && payload !== undefined ? JSON.stringify(payload) : undefined,
  })

  const text = await res.text()
  let json: any = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = { raw: text }
  }

  if (!res.ok) {
    const faultMsg =
      json?.Fault?.Error?.map((e: any) => `${e.Message || ''} ${e.Detail || ''}`.trim()).join(' | ') ||
      json?.error ||
      `HTTP ${res.status}`
    return { ok: false, status: res.status, data: json, error: faultMsg }
  }

  return { ok: true, status: res.status, data: json }
}

/**
 * Registra en `company.metadata.pending_qbo_deletes` y `deleted_qbo_ids` cualquier eliminación o anulación
 * realizada cuando QBO aún no está conectado por OAuth (o si la llamada en vivo falla temporalmente),
 * garantizando que al sincronizar se afecte en QuickBooks Online y jamás se vuelva a re-importar en un Pull.
 */
export async function queuePendingQboDelete(
  supabase: SupabaseClient,
  realmId: string,
  entry: {
    kind: 'TRANSACTION' | 'ACCOUNT' | 'CONTACT' | 'LIST_ITEM'
    entityType: string
    endpoint: string
    qbId: string
    operation?: 'DELETE' | 'VOID' | 'DEACTIVATE'
    label?: string
  }
): Promise<void> {
  if (!entry.qbId || isLocalId(entry.qbId)) return
  const { data: comp } = await supabase
    .from('external_accounting_companies')
    .select('metadata')
    .eq('realm_id', realmId)
    .maybeSingle()

  const meta = comp?.metadata && typeof comp.metadata === 'object' ? comp.metadata : {}
  const pendingList: any[] = Array.isArray(meta.pending_qbo_deletes) ? meta.pending_qbo_deletes : []
  const deletedArchive: any[] = Array.isArray(meta.deleted_qbo_ids) ? meta.deleted_qbo_ids : []

  const key = `${entry.kind}:${entry.entityType}:${entry.qbId}`
  const existsInPending = pendingList.some(
    (p: any) => `${p.kind}:${p.entityType}:${p.qbId}` === key
  )
  const nowIso = new Date().toISOString()

  const nextPending = existsInPending
    ? pendingList
    : [
        ...pendingList,
        {
          ...entry,
          operation: entry.operation || (entry.kind === 'TRANSACTION' ? 'DELETE' : 'DEACTIVATE'),
          queued_at: nowIso,
        },
      ]

  const existsInArchive = deletedArchive.some(
    (d: any) => `${d.kind}:${d.entityType}:${d.qbId}` === key
  )
  const nextArchive = existsInArchive
    ? deletedArchive
    : [
        ...deletedArchive,
        {
          kind: entry.kind,
          entityType: entry.entityType,
          qbId: String(entry.qbId),
          deleted_at: nowIso,
        },
      ]

  await supabase
    .from('external_accounting_companies')
    .update({
      metadata: {
        ...meta,
        pending_qbo_deletes: nextPending,
        deleted_qbo_ids: nextArchive,
      },
      updated_at: nowIso,
    })
    .eq('realm_id', realmId)
}

/**
 * Sincroniza (Crea, Actualiza o Desactiva/Elimina) una Cuenta Contable (`Account`) hacia Intuit QuickBooks Online.
 */
export async function pushAccountToQbo(
  supabase: SupabaseClient,
  realmId: string,
  accountRow: any,
  operation: 'UPSERT' | 'DELETE' = 'UPSERT'
): Promise<{ synced: boolean; qbAccountId?: string; status?: string; error?: string }> {
  const isNewInQbo = isLocalId(accountRow.qb_account_id)
  if (operation === 'DELETE' && isNewInQbo) {
    return { synced: true, qbAccountId: String(accountRow.qb_account_id), status: 'LOCAL_ONLY_DELETED' }
  }

  const auth = await getExternalCompanyQboAuth(supabase, realmId)
  if (!auth.connected || !auth.syncEnabled) {
    if (operation === 'DELETE' && !isNewInQbo) {
      await queuePendingQboDelete(supabase, realmId, {
        kind: 'ACCOUNT',
        entityType: 'Account',
        endpoint: 'account',
        qbId: String(accountRow.qb_account_id),
        operation: 'DEACTIVATE',
        label: accountRow.name,
      })
      return {
        synced: false,
        qbAccountId: String(accountRow.qb_account_id),
        status: 'QUEUED_QBO_DELETE',
        error: !auth.connected ? 'NOT_CONNECTED' : 'SYNC_DISABLED',
      }
    }
    return { synced: false, error: !auth.connected ? 'NOT_CONNECTED' : 'SYNC_DISABLED' }
  }

  if (operation === 'DELETE') {
    const existingRes = await qboV3Request(supabase, realmId, 'GET', `account/${accountRow.qb_account_id}`)
    const syncToken = existingRes.data?.Account?.SyncToken ?? accountRow.raw_data?.SyncToken ?? '0'
    const delPayload = {
      Id: String(accountRow.qb_account_id),
      SyncToken: String(syncToken),
      Name: accountRow.name || existingRes.data?.Account?.Name || 'Deleted Account',
      AccountType: accountRow.account_type || existingRes.data?.Account?.AccountType || 'Expense',
      Active: false,
      sparse: true,
    }
    const delRes = await qboV3Request(supabase, realmId, 'POST', 'account', delPayload)
    await queuePendingQboDelete(supabase, realmId, {
      kind: 'ACCOUNT',
      entityType: 'Account',
      endpoint: 'account',
      qbId: String(accountRow.qb_account_id),
      operation: 'DEACTIVATE',
      label: accountRow.name,
    })
    return {
      synced: delRes.ok,
      qbAccountId: String(accountRow.qb_account_id),
      status: delRes.ok ? 'DEACTIVATED_IN_QBO' : 'QUEUED_QBO_DELETE',
      error: delRes.error,
    }
  }

  const qboPayload: Record<string, any> = {
    Name: accountRow.name,
    AccountType: accountRow.account_type || 'Expense',
    Active: accountRow.is_active !== false,
  }
  if (accountRow.acct_num) qboPayload.AcctNum = accountRow.acct_num
  if (accountRow.account_sub_type) qboPayload.AccountSubType = accountRow.account_sub_type
  if (accountRow.raw_data?.Description) qboPayload.Description = String(accountRow.raw_data.Description)
  if (accountRow.is_sub_account && accountRow.parent_qb_id && !isLocalId(accountRow.parent_qb_id)) {
    qboPayload.SubAccount = true
    qboPayload.ParentRef = { value: String(accountRow.parent_qb_id) }
  }

  if (!isNewInQbo) {
    const existingRes = await qboV3Request(supabase, realmId, 'GET', `account/${accountRow.qb_account_id}`)
    if (existingRes.ok && existingRes.data?.Account) {
      qboPayload.Id = String(existingRes.data.Account.Id)
      qboPayload.SyncToken = String(existingRes.data.Account.SyncToken || '0')
      qboPayload.sparse = true
    }
  }

  const saveRes = await qboV3Request(supabase, realmId, 'POST', 'account', qboPayload)
  if (!saveRes.ok || !saveRes.data?.Account) {
    return { synced: false, error: saveRes.error || 'Error guardando Account en QBO' }
  }

  const qboAcc = saveRes.data.Account
  const realQbId = String(qboAcc.Id)
  const oldQbId = String(accountRow.qb_account_id)

  await supabase
    .from('external_accounting_accounts')
    .update({
      qb_account_id: realQbId,
      raw_data: { ...qboAcc, qbo_sync_status: 'SYNCED', qbo_synced_at: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    })
    .eq('id', accountRow.id)
    .eq('company_realm_id', realmId)

  // If the account previously had a LOCAL-ACC-* id, update any transactions referencing it
  if (isNewInQbo && oldQbId !== realQbId) {
    await supabase
      .from('external_accounting_transactions')
      .update({ account_qb_id: realQbId })
      .eq('company_realm_id', realmId)
      .eq('account_qb_id', oldQbId)
  }

  return { synced: true, qbAccountId: realQbId, status: 'SYNCED' }
}

/**
 * Sincroniza (Crea, Actualiza o Desactiva/Elimina) un Proveedor o Cliente (`Vendor` / `Customer`) hacia Intuit QuickBooks Online.
 */
export async function pushContactToQbo(
  supabase: SupabaseClient,
  realmId: string,
  contactRow: any,
  operation: 'UPSERT' | 'DELETE' = 'UPSERT'
): Promise<{ synced: boolean; qbContactId?: string; status?: string; error?: string }> {
  const cType = contactRow.contact_type === 'Customer' ? 'Customer' : 'Vendor'
  const endpoint = cType.toLowerCase()
  const isNewInQbo = isLocalId(contactRow.qb_contact_id)

  if (operation === 'DELETE' && isNewInQbo) {
    return { synced: true, qbContactId: String(contactRow.qb_contact_id), status: 'LOCAL_ONLY_DELETED' }
  }

  const auth = await getExternalCompanyQboAuth(supabase, realmId)
  if (!auth.connected || !auth.syncEnabled) {
    if (operation === 'DELETE' && !isNewInQbo) {
      await queuePendingQboDelete(supabase, realmId, {
        kind: 'CONTACT',
        entityType: cType,
        endpoint,
        qbId: String(contactRow.qb_contact_id),
        operation: 'DEACTIVATE',
        label: contactRow.display_name,
      })
      return {
        synced: false,
        qbContactId: String(contactRow.qb_contact_id),
        status: 'QUEUED_QBO_DELETE',
        error: !auth.connected ? 'NOT_CONNECTED' : 'SYNC_DISABLED',
      }
    }
    return { synced: false, error: !auth.connected ? 'NOT_CONNECTED' : 'SYNC_DISABLED' }
  }

  if (operation === 'DELETE') {
    const existingRes = await qboV3Request(supabase, realmId, 'GET', `${endpoint}/${contactRow.qb_contact_id}`)
    const syncToken = existingRes.data?.[cType]?.SyncToken ?? contactRow.raw_data?.SyncToken ?? '0'
    const delPayload = {
      Id: String(contactRow.qb_contact_id),
      SyncToken: String(syncToken),
      DisplayName: contactRow.display_name || existingRes.data?.[cType]?.DisplayName || 'Deleted Contact',
      Active: false,
      sparse: true,
    }
    const delRes = await qboV3Request(supabase, realmId, 'POST', endpoint, delPayload)
    await queuePendingQboDelete(supabase, realmId, {
      kind: 'CONTACT',
      entityType: cType,
      endpoint,
      qbId: String(contactRow.qb_contact_id),
      operation: 'DEACTIVATE',
      label: contactRow.display_name,
    })
    return {
      synced: delRes.ok,
      qbContactId: String(contactRow.qb_contact_id),
      status: delRes.ok ? 'DEACTIVATED_IN_QBO' : 'QUEUED_QBO_DELETE',
      error: delRes.error,
    }
  }

  const qboPayload: Record<string, any> = {
    DisplayName: contactRow.display_name,
    PrintOnCheckName: contactRow.print_on_check_name || contactRow.display_name,
    Active: contactRow.is_active !== false,
  }
  if (contactRow.company_name) qboPayload.CompanyName = contactRow.company_name
  if (contactRow.given_name) qboPayload.GivenName = contactRow.given_name
  if (contactRow.family_name) qboPayload.FamilyName = contactRow.family_name
  if (contactRow.acct_num) qboPayload.AcctNum = contactRow.acct_num
  if (contactRow.email) qboPayload.PrimaryEmailAddr = { Address: contactRow.email }
  if (contactRow.phone) qboPayload.PrimaryPhone = { FreeFormNumber: contactRow.phone }
  if (contactRow.address && typeof contactRow.address === 'object' && Object.keys(contactRow.address).length > 0) {
    qboPayload.BillAddr = contactRow.address
  }
  if (cType === 'Vendor') {
    if (contactRow.tax_identifier) qboPayload.TaxIdentifier = contactRow.tax_identifier
    qboPayload.Vendor1099 = Boolean(contactRow.vendor_1099)
  }

  if (!isNewInQbo) {
    const existingRes = await qboV3Request(supabase, realmId, 'GET', `${endpoint}/${contactRow.qb_contact_id}`)
    if (existingRes.ok && existingRes.data?.[cType]) {
      qboPayload.Id = String(existingRes.data[cType].Id)
      qboPayload.SyncToken = String(existingRes.data[cType].SyncToken || '0')
      qboPayload.sparse = true
    }
  }

  const saveRes = await qboV3Request(supabase, realmId, 'POST', endpoint, qboPayload)
  if (!saveRes.ok || !saveRes.data?.[cType]) {
    // If DisplayName already exists in QBO, query it by DisplayName and link its ID
    const queryStr = `SELECT * FROM ${cType} WHERE DisplayName = '${String(contactRow.display_name).replace(/'/g, "\\'")}'`
    const qRes = await qboV3Request(supabase, realmId, 'GET', `query?query=${encodeURIComponent(queryStr)}`)
    const found = qRes.data?.QueryResponse?.[cType]?.[0]
    if (found?.Id) {
      const realId = String(found.Id)
      await supabase
        .from('external_accounting_contacts')
        .update({
          qb_contact_id: realId,
          raw_data: { ...found, qbo_sync_status: 'SYNCED', qbo_synced_at: new Date().toISOString() },
        })
        .eq('id', contactRow.id)
        .eq('company_realm_id', realmId)
      return { synced: true, qbContactId: realId }
    }
    return { synced: false, error: saveRes.error || `Error guardando ${cType} en QBO` }
  }

  const qboCon = saveRes.data[cType]
  const realQbId = String(qboCon.Id)
  const oldQbId = String(contactRow.qb_contact_id)

  await supabase
    .from('external_accounting_contacts')
    .update({
      qb_contact_id: realQbId,
      raw_data: { ...qboCon, qbo_sync_status: 'SYNCED', qbo_synced_at: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    })
    .eq('id', contactRow.id)
    .eq('company_realm_id', realmId)

  if (isNewInQbo && oldQbId !== realQbId) {
    await supabase
      .from('external_accounting_transactions')
      .update({ entity_qb_id: realQbId })
      .eq('company_realm_id', realmId)
      .eq('entity_qb_id', oldQbId)
  }

  return { synced: true, qbContactId: realQbId }
}

/**
 * Sincroniza (Crea, Actualiza o Desactiva) un elemento del catálogo de `Lists` (`Item`, `Category`, `Department`, `Class`, `PaymentMethod`, `Term`)
 * hacia Intuit QuickBooks Online V3.
 */
export async function pushListItemToQbo(
  supabase: SupabaseClient,
  realmId: string,
  listKey: string,
  itemPayload: Record<string, any>,
  operation: 'UPSERT' | 'DEACTIVATE' = 'UPSERT'
): Promise<{ synced: boolean; qbId?: string; status?: string; error?: string; qboObject?: any }> {
  const entityMap: Record<string, { entityType: string; endpoint: string }> = {
    items: { entityType: 'Item', endpoint: 'item' },
    categories: { entityType: 'Item', endpoint: 'item' },
    departments: { entityType: 'Department', endpoint: 'department' },
    paymentMethods: { entityType: 'PaymentMethod', endpoint: 'paymentmethod' },
    terms: { entityType: 'Term', endpoint: 'term' },
    classes: { entityType: 'Class', endpoint: 'class' },
  }
  const cfg = entityMap[listKey]
  if (!cfg) {
    return { synced: false, status: 'LOCAL_ONLY_LIST' }
  }

  const rawId = String(itemPayload.Id || itemPayload.qbId || '')
  const isNewInQbo = isLocalId(rawId)
  const auth = await getExternalCompanyQboAuth(supabase, realmId)

  if (!auth.connected || !auth.syncEnabled) {
    if (operation === 'DEACTIVATE' && !isNewInQbo) {
      await queuePendingQboDelete(supabase, realmId, {
        kind: 'LIST_ITEM',
        entityType: cfg.entityType,
        endpoint: cfg.endpoint,
        qbId: rawId,
        operation: 'DEACTIVATE',
        label: itemPayload.Name || rawId,
      })
      return { synced: false, qbId: rawId, status: 'QUEUED_QBO_DELETE' }
    }
    return { synced: false, qbId: rawId, status: !auth.connected ? 'NOT_CONNECTED' : 'SYNC_DISABLED' }
  }

  if (operation === 'DEACTIVATE') {
    if (isNewInQbo) return { synced: true, qbId: rawId, status: 'LOCAL_ONLY_DELETED' }
    const existingRes = await qboV3Request(supabase, realmId, 'GET', `${cfg.endpoint}/${rawId}`)
    const existingObj = existingRes.data?.[cfg.entityType] || {}
    const syncToken = existingObj.SyncToken ?? '0'
    const delPayload = {
      ...existingObj,
      Id: rawId,
      SyncToken: String(syncToken),
      Name: itemPayload.Name || existingObj.Name || 'Deactivated Item',
      Active: false,
      sparse: true,
    }
    const delRes = await qboV3Request(supabase, realmId, 'POST', cfg.endpoint, delPayload)
    await queuePendingQboDelete(supabase, realmId, {
      kind: 'LIST_ITEM',
      entityType: cfg.entityType,
      endpoint: cfg.endpoint,
      qbId: rawId,
      operation: 'DEACTIVATE',
      label: itemPayload.Name || rawId,
    })
    return {
      synced: delRes.ok,
      qbId: rawId,
      status: delRes.ok ? 'DEACTIVATED_IN_QBO' : 'QUEUED_QBO_DELETE',
      error: delRes.error,
    }
  }

  const qboBody: Record<string, any> = {
    Name: String(itemPayload.Name || '').trim(),
    Active: itemPayload.Active !== false,
  }

  if (listKey === 'categories') {
    qboBody.Type = 'Category'
    if (itemPayload.ParentRef?.value && !isLocalId(itemPayload.ParentRef.value)) {
      qboBody.SubItem = true
      qboBody.ParentRef = { value: String(itemPayload.ParentRef.value) }
    }
  } else if (listKey === 'items') {
    qboBody.Type = itemPayload.Type || 'Service'
    if (itemPayload.Sku) qboBody.Sku = String(itemPayload.Sku)
    if (itemPayload.Description) qboBody.Description = String(itemPayload.Description)
    if (itemPayload.UnitPrice != null) qboBody.UnitPrice = Number(itemPayload.UnitPrice || 0)
    if (itemPayload.PurchaseDesc) qboBody.PurchaseDesc = String(itemPayload.PurchaseDesc)
    if (itemPayload.PurchaseCost != null) qboBody.PurchaseCost = Number(itemPayload.PurchaseCost || 0)
    if (itemPayload.IncomeAccountRef?.value && !isLocalId(itemPayload.IncomeAccountRef.value)) {
      qboBody.IncomeAccountRef = {
        value: String(itemPayload.IncomeAccountRef.value),
        name: itemPayload.IncomeAccountRef.name || undefined,
      }
    }
    if (itemPayload.ExpenseAccountRef?.value && !isLocalId(itemPayload.ExpenseAccountRef.value)) {
      qboBody.ExpenseAccountRef = {
        value: String(itemPayload.ExpenseAccountRef.value),
        name: itemPayload.ExpenseAccountRef.name || undefined,
      }
    }
    if (itemPayload.AssetAccountRef?.value && !isLocalId(itemPayload.AssetAccountRef.value)) {
      qboBody.AssetAccountRef = {
        value: String(itemPayload.AssetAccountRef.value),
        name: itemPayload.AssetAccountRef.name || undefined,
      }
    }
    if (itemPayload.ParentRef?.value && !isLocalId(itemPayload.ParentRef.value)) {
      qboBody.SubItem = true
      qboBody.ParentRef = { value: String(itemPayload.ParentRef.value) }
    }
  } else if (listKey === 'departments') {
    if (itemPayload.ParentRef?.value && !isLocalId(itemPayload.ParentRef.value)) {
      qboBody.SubDepartment = true
      qboBody.ParentRef = { value: String(itemPayload.ParentRef.value) }
    }
  } else if (listKey === 'classes') {
    if (itemPayload.ParentRef?.value && !isLocalId(itemPayload.ParentRef.value)) {
      qboBody.SubClass = true
      qboBody.ParentRef = { value: String(itemPayload.ParentRef.value) }
    }
  } else if (listKey === 'paymentMethods') {
    qboBody.Type = itemPayload.Type === 'CREDIT_CARD' ? 'CREDIT_CARD' : 'NON_CREDIT_CARD'
  } else if (listKey === 'terms') {
    qboBody.DueDays = Number(itemPayload.DueDays ?? 30)
    if (itemPayload.DiscountPercent != null && Number(itemPayload.DiscountPercent) > 0) {
      qboBody.DiscountPercent = Number(itemPayload.DiscountPercent)
      qboBody.DiscountDays = Number(itemPayload.DiscountDays ?? 0)
    }
  }

  if (!isNewInQbo) {
    const existingRes = await qboV3Request(supabase, realmId, 'GET', `${cfg.endpoint}/${rawId}`)
    if (existingRes.ok && existingRes.data?.[cfg.entityType]) {
      qboBody.Id = String(existingRes.data[cfg.entityType].Id)
      qboBody.SyncToken = String(existingRes.data[cfg.entityType].SyncToken || '0')
      qboBody.sparse = true
    }
  }

  const saveRes = await qboV3Request(supabase, realmId, 'POST', cfg.endpoint, qboBody)
  if (!saveRes.ok || !saveRes.data?.[cfg.entityType]) {
    return { synced: false, qbId: rawId, error: saveRes.error }
  }

  const savedObj = saveRes.data[cfg.entityType]
  return {
    synced: true,
    qbId: String(savedObj.Id),
    status: 'SYNCED',
    qboObject: savedObj,
  }
}

/**
 * Construye el payload oficial de Intuit QuickBooks V3 para cualquier tipo de transacción.
 */
export function buildQboTransactionPayload(txn: any): { entityName: string; endpoint: string; payload: Record<string, any> } {
  const tType = txn.txn_type
  const lines = Array.isArray(txn.line_items) ? txn.line_items : []
  const totalAmt = Number(txn.total_amount || 0)

  // 1. Check / Expense / CreditCardExpense / CreditCardCredit -> Purchase
  if (tType === 'Check' || tType === 'Expense' || tType === 'CreditCardExpense' || tType === 'CreditCardCredit') {
    const pType = tType === 'Check' ? 'Check' : tType === 'CreditCardExpense' || tType === 'CreditCardCredit' ? 'CreditCard' : 'Cash'
    const qboLines = (lines.length > 0 ? lines : [{
      amount: totalAmt,
      description: txn.memo || '',
      account_qb_id: txn.to_account_qb_id,
      account_name: txn.to_account_name,
    }])
      .filter((l: any) => l.account_qb_id && !isLocalId(l.account_qb_id))
      .map((l: any) => {
        const expDetail: Record<string, any> = {
          AccountRef: {
            value: String(l.account_qb_id),
            name: l.account_name || undefined,
          },
        }
        if (l.entity_qb_id && !isLocalId(l.entity_qb_id)) {
          expDetail.CustomerRef = { value: String(l.entity_qb_id), name: l.entity_name || undefined }
        }
        return {
          Amount: Number(Number(l.amount || 0).toFixed(2)),
          Description: l.description || txn.memo || '',
          DetailType: 'AccountBasedExpenseLineDetail',
          AccountBasedExpenseLineDetail: expDetail,
        }
      })

    const payload: Record<string, any> = {
      PaymentType: pType,
      AccountRef: {
        value: String(txn.account_qb_id),
        name: txn.account_name || undefined,
      },
      TxnDate: txn.txn_date,
      Line: qboLines,
    }
    if (tType === 'CreditCardCredit') payload.Credit = true
    if (txn.doc_number) payload.DocNumber = String(txn.doc_number)
    if (txn.memo) payload.PrivateNote = String(txn.memo)
    if (txn.department_qb_id && !isLocalId(txn.department_qb_id)) {
      payload.DepartmentRef = { value: String(txn.department_qb_id), name: txn.department_name || undefined }
    }
    if (txn.entity_qb_id && !isLocalId(txn.entity_qb_id)) {
      payload.EntityRef = {
        value: String(txn.entity_qb_id),
        name: txn.entity_name || undefined,
        type: txn.entity_type === 'Customer' ? 'Customer' : 'Vendor',
      }
    }
    return { entityName: 'Purchase', endpoint: 'purchase', payload }
  }

  // 2. Deposit -> Deposit (supports LinkedTxn + CashBack)
  if (tType === 'Deposit') {
    const rawLines = lines.length > 0 ? lines : [{
      amount: totalAmt,
      description: txn.memo || '',
      account_qb_id: txn.to_account_qb_id,
      account_name: txn.to_account_name,
      entity_qb_id: txn.entity_qb_id,
      entity_name: txn.entity_name,
      check_num: txn.doc_number,
    }]

    const cashBackLine = rawLines.find(
      (l: any) => l.detail_type === 'CashBackLineDetail' || (Number(l.amount || 0) < 0 && l.account_qb_id)
    )
    const normalDepositLines = rawLines.filter((l: any) => l !== cashBackLine)

    const qboLines = normalDepositLines
      .filter((l: any) => (l.account_qb_id && !isLocalId(l.account_qb_id)) || l.linked_txn_id)
      .map((l: any) => {
        const detail: Record<string, any> = {}
        if (l.account_qb_id && !isLocalId(l.account_qb_id)) {
          detail.AccountRef = {
            value: String(l.account_qb_id),
            name: l.account_name || undefined,
          }
        }
        const entId = l.entity_qb_id || txn.entity_qb_id
        if (entId && !isLocalId(entId)) {
          detail.Entity = {
            value: String(entId),
            name: l.entity_name || txn.entity_name || undefined,
            type: 'Customer',
          }
        }
        if (l.check_num || txn.doc_number) {
          detail.CheckNum = String(l.check_num || txn.doc_number)
        }
        const lineObj: Record<string, any> = {
          Amount: Number(Math.abs(Number(l.amount || 0)).toFixed(2)),
          Description: l.description || txn.memo || '',
          DetailType: 'DepositLineDetail',
          DepositLineDetail: detail,
        }
        if (l.linked_txn_id && !isLocalId(l.linked_txn_id)) {
          lineObj.LinkedTxn = [
            {
              TxnId: String(l.linked_txn_id),
              TxnType: l.linked_txn_type || 'Payment',
              TxnLineId: '0',
            },
          ]
        }
        return lineObj
      })

    const payload: Record<string, any> = {
      DepositToAccountRef: {
        value: String(txn.account_qb_id),
        name: txn.account_name || undefined,
      },
      TxnDate: txn.txn_date,
      Line: qboLines,
    }
    if (cashBackLine && cashBackLine.account_qb_id && !isLocalId(cashBackLine.account_qb_id)) {
      payload.CashBack = {
        AccountRef: {
          value: String(cashBackLine.account_qb_id),
          name: cashBackLine.account_name || undefined,
        },
        Amount: Number(Math.abs(Number(cashBackLine.amount || 0)).toFixed(2)),
        Memo: cashBackLine.description || 'Cash Back',
      }
    }
    if (txn.department_qb_id && !isLocalId(txn.department_qb_id)) {
      payload.DepartmentRef = { value: String(txn.department_qb_id), name: txn.department_name || undefined }
    }
    if (txn.memo) payload.PrivateNote = String(txn.memo)
    return { entityName: 'Deposit', endpoint: 'deposit', payload }
  }

  // 3. Transfer / PayDownCreditCard -> Transfer
  if (tType === 'Transfer' || tType === 'PayDownCreditCard') {
    const payload: Record<string, any> = {
      FromAccountRef: {
        value: String(txn.account_qb_id),
        name: txn.account_name || undefined,
      },
      ToAccountRef: {
        value: String(txn.to_account_qb_id || lines[0]?.account_qb_id),
        name: txn.to_account_name || lines[0]?.account_name || undefined,
      },
      Amount: Number(totalAmt.toFixed(2)),
      TxnDate: txn.txn_date,
    }
    if (txn.memo) payload.PrivateNote = String(txn.memo)
    return { entityName: 'Transfer', endpoint: 'transfer', payload }
  }

  // 4. JournalEntry -> JournalEntry (supports per-line Entity & DepartmentRef)
  if (tType === 'JournalEntry') {
    const qboLines = lines
      .filter((l: any) => l.account_qb_id && !isLocalId(l.account_qb_id))
      .map((l: any) => {
        const jeDetail: Record<string, any> = {
          PostingType: l.posting_type === 'Credit' ? 'Credit' : 'Debit',
          AccountRef: {
            value: String(l.account_qb_id),
            name: l.account_name || undefined,
          },
        }
        if (l.entity_qb_id && !isLocalId(l.entity_qb_id)) {
          jeDetail.Entity = {
            Type: l.entity_type === 'Customer' ? 'Customer' : 'Vendor',
            EntityRef: {
              value: String(l.entity_qb_id),
              name: l.entity_name || undefined,
            },
          }
        }
        const deptId = l.department_qb_id || txn.department_qb_id
        if (deptId && !isLocalId(deptId)) {
          jeDetail.DepartmentRef = {
            value: String(deptId),
            name: l.department_name || txn.department_name || undefined,
          }
        }
        return {
          Amount: Number(Number(l.amount || 0).toFixed(2)),
          Description: l.description || txn.memo || '',
          DetailType: 'JournalEntryLineDetail',
          JournalEntryLineDetail: jeDetail,
        }
      })
    const payload: Record<string, any> = {
      TxnDate: txn.txn_date,
      Line: qboLines,
    }
    if (txn.doc_number) payload.DocNumber = String(txn.doc_number)
    if (txn.memo) payload.PrivateNote = String(txn.memo)
    return { entityName: 'JournalEntry', endpoint: 'journalentry', payload }
  }

  // 5. Bill / VendorCredit / PurchaseOrder
  if (tType === 'Bill' || tType === 'VendorCredit' || tType === 'PurchaseOrder') {
    const entityName = tType === 'VendorCredit' ? 'VendorCredit' : tType === 'PurchaseOrder' ? 'PurchaseOrder' : 'Bill'
    const endpoint = entityName.toLowerCase()
    const qboLines = (lines.length > 0 ? lines : [{
      amount: totalAmt,
      description: txn.memo || '',
      account_qb_id: txn.to_account_qb_id,
      account_name: txn.to_account_name,
    }])
      .filter((l: any) => l.account_qb_id && !isLocalId(l.account_qb_id))
      .map((l: any) => ({
        Amount: Number(Number(l.amount || 0).toFixed(2)),
        Description: l.description || txn.memo || '',
        DetailType: 'AccountBasedExpenseLineDetail',
        AccountBasedExpenseLineDetail: {
          AccountRef: {
            value: String(l.account_qb_id),
            name: l.account_name || undefined,
          },
        },
      }))

    const payload: Record<string, any> = {
      VendorRef: {
        value: String(txn.entity_qb_id),
        name: txn.entity_name || undefined,
      },
      TxnDate: txn.txn_date,
      Line: qboLines,
    }
    if (txn.due_date && tType === 'Bill') payload.DueDate = txn.due_date
    if (txn.doc_number) payload.DocNumber = String(txn.doc_number)
    if (txn.memo) payload.PrivateNote = String(txn.memo)
    if (txn.department_qb_id && !isLocalId(txn.department_qb_id)) {
      payload.DepartmentRef = { value: String(txn.department_qb_id), name: txn.department_name || undefined }
    }
    if (txn.account_qb_id && !isLocalId(txn.account_qb_id) && tType !== 'PurchaseOrder') {
      payload.APAccountRef = { value: String(txn.account_qb_id), name: txn.account_name || undefined }
    }
    return { entityName, endpoint, payload }
  }

  // 6. BillPayment -> BillPayment
  if (tType === 'BillPayment') {
    const payType = txn.payment_type === 'CreditCard' ? 'CreditCard' : 'Check'
    const qboLines = lines.map((l: any) => ({
      Amount: Number(Number(l.amount || totalAmt).toFixed(2)),
      LinkedTxn: l.linked_txn_id && !isLocalId(l.linked_txn_id)
        ? [{ TxnId: String(l.linked_txn_id), TxnType: l.linked_txn_type || 'Bill' }]
        : [],
    }))
    const payload: Record<string, any> = {
      VendorRef: {
        value: String(txn.entity_qb_id),
        name: txn.entity_name || undefined,
      },
      PayType: payType,
      TotalAmt: Number(totalAmt.toFixed(2)),
      TxnDate: txn.txn_date,
      Line: qboLines,
    }
    if (payType === 'CreditCard') {
      payload.CreditCardPayment = {
        CCAccountRef: { value: String(txn.account_qb_id), name: txn.account_name || undefined },
      }
    } else {
      payload.CheckPayment = {
        BankAccountRef: { value: String(txn.account_qb_id), name: txn.account_name || undefined },
        PrintStatus: txn.print_status || 'NotSet',
      }
    }
    if (txn.doc_number) payload.DocNumber = String(txn.doc_number)
    if (txn.memo) payload.PrivateNote = String(txn.memo)
    return { entityName: 'BillPayment', endpoint: 'billpayment', payload }
  }

  // 7. Invoice / CreditMemo / SalesReceipt / RefundReceipt / Estimate
  if (
    tType === 'Invoice' ||
    tType === 'CreditMemo' ||
    tType === 'SalesReceipt' ||
    tType === 'RefundReceipt' ||
    tType === 'Estimate'
  ) {
    const entityName = tType
    const endpoint = entityName.toLowerCase()
    const qboLines = (lines.length > 0 ? lines : [{
      amount: totalAmt,
      description: txn.memo || '',
      item_qb_id: '1',
      qty: 1,
      rate: totalAmt,
    }]).map((l: any) => {
      const amt = Number(Number(l.amount || 0).toFixed(2))
      const qty = l.qty != null ? Number(l.qty) : 1
      const rate = l.rate != null ? Number(l.rate) : amt
      const salesDetail: Record<string, any> = {
        Qty: qty,
        UnitPrice: rate,
      }
      if (l.item_qb_id && !isLocalId(l.item_qb_id)) {
        salesDetail.ItemRef = { value: String(l.item_qb_id), name: l.item_name || undefined }
      } else {
        salesDetail.ItemRef = { value: '1', name: l.item_name || l.account_name || 'Services' }
      }
      return {
        Amount: amt,
        Description: l.description || txn.memo || '',
        DetailType: 'SalesItemLineDetail',
        SalesItemLineDetail: salesDetail,
      }
    })

    const payload: Record<string, any> = {
      CustomerRef: {
        value: String(txn.entity_qb_id),
        name: txn.entity_name || undefined,
      },
      TxnDate: txn.txn_date,
      Line: qboLines,
    }
    if (txn.due_date && tType === 'Invoice') payload.DueDate = txn.due_date
    if (txn.doc_number) payload.DocNumber = String(txn.doc_number)
    if (txn.memo) payload.PrivateNote = String(txn.memo)
    if (txn.department_qb_id && !isLocalId(txn.department_qb_id)) {
      payload.DepartmentRef = { value: String(txn.department_qb_id), name: txn.department_name || undefined }
    }
    if ((tType === 'SalesReceipt' || tType === 'RefundReceipt') && txn.account_qb_id && !isLocalId(txn.account_qb_id)) {
      payload.DepositToAccountRef = { value: String(txn.account_qb_id), name: txn.account_name || undefined }
    }
    return { entityName, endpoint, payload }
  }

  // 8. Payment (Customer Payment) -> Payment
  if (tType === 'Payment') {
    const qboLines = lines.map((l: any) => ({
      Amount: Number(Number(l.amount || totalAmt).toFixed(2)),
      LinkedTxn: l.linked_txn_id && !isLocalId(l.linked_txn_id)
        ? [{ TxnId: String(l.linked_txn_id), TxnType: l.linked_txn_type || 'Invoice' }]
        : [],
    }))
    const payload: Record<string, any> = {
      CustomerRef: {
        value: String(txn.entity_qb_id),
        name: txn.entity_name || undefined,
      },
      TotalAmt: Number(totalAmt.toFixed(2)),
      TxnDate: txn.txn_date,
      Line: qboLines,
    }
    if (txn.account_qb_id && !isLocalId(txn.account_qb_id)) {
      payload.DepositToAccountRef = { value: String(txn.account_qb_id), name: txn.account_name || undefined }
    }
    if (txn.doc_number) payload.PaymentRefNum = String(txn.doc_number)
    if (txn.memo) payload.PrivateNote = String(txn.memo)
    return { entityName: 'Payment', endpoint: 'payment', payload }
  }

  // 9. Default fallback -> Purchase (Expense)
  return {
    entityName: 'Purchase',
    endpoint: 'purchase',
    payload: {
      PaymentType: 'Cash',
      AccountRef: { value: String(txn.account_qb_id) },
      TxnDate: txn.txn_date,
      PrivateNote: txn.memo || '',
      Line: [
        {
          Amount: Number(totalAmt.toFixed(2)),
          DetailType: 'AccountBasedExpenseLineDetail',
          AccountBasedExpenseLineDetail: {
            AccountRef: { value: String(txn.to_account_qb_id || lines[0]?.account_qb_id || txn.account_qb_id) },
          },
        },
      ],
    },
  }
}

/**
 * Envía en tiempo real una transacción creada, editada, anulada (`VOID`) o eliminada hacia Intuit QuickBooks Online V3.
 */
export async function pushTransactionToQbo(
  supabase: SupabaseClient,
  realmId: string,
  txnRow: any,
  operation: 'UPSERT' | 'VOID' | 'DELETE' = 'UPSERT'
): Promise<{ synced: boolean; qbTxnId?: string; status: string; error?: string }> {
  const workingTxn = { ...txnRow }

  // 1. If deleting or voiding a transaction that never existed in QBO (`LOCAL-*`), nothing to delete remotely
  if ((operation === 'DELETE' || operation === 'VOID') && isLocalId(workingTxn.qb_txn_id)) {
    return { synced: true, status: 'LOCAL_ONLY_DELETED' }
  }

  const { entityName, endpoint, payload } = buildQboTransactionPayload(workingTxn)
  const auth = await getExternalCompanyQboAuth(supabase, realmId)

  if (!auth.connected || !auth.syncEnabled) {
    if (operation === 'DELETE' || operation === 'VOID') {
      await queuePendingQboDelete(supabase, realmId, {
        kind: 'TRANSACTION',
        entityType: entityName,
        endpoint,
        qbId: String(workingTxn.qb_txn_id),
        operation,
        label: `${workingTxn.txn_type || entityName} #${workingTxn.doc_number || workingTxn.qb_txn_id} ($${Number(workingTxn.total_amount || 0).toFixed(2)})`,
      })
      return {
        synced: false,
        qbTxnId: String(workingTxn.qb_txn_id),
        status: operation === 'DELETE' ? 'QUEUED_QBO_DELETE' : 'QUEUED_QBO_VOID',
        error: !auth.connected ? 'NOT_CONNECTED' : 'SYNC_DISABLED',
      }
    }

    // Mark as PENDING_QBO_SYNC if sync is enabled but OAuth is not connected yet
    if (operation === 'UPSERT' && txnRow?.id) {
      const currRaw = txnRow.raw_data && typeof txnRow.raw_data === 'object' ? txnRow.raw_data : {}
      await supabase
        .from('external_accounting_transactions')
        .update({
          raw_data: {
            ...currRaw,
            qbo_sync_status: auth.syncEnabled ? 'PENDING_QBO_SYNC' : 'LOCAL_ONLY',
          },
        })
        .eq('id', txnRow.id)
        .eq('company_realm_id', realmId)
    }
    return {
      synced: false,
      status: auth.syncEnabled ? 'PENDING_QBO_SYNC' : 'LOCAL_ONLY',
      error: !auth.connected ? 'NOT_CONNECTED' : 'SYNC_DISABLED',
    }
  }

  // 2. Ensure any newly created local contact (`LOCAL-C-*`) is pushed to QBO first so we have a real `EntityRef.value`
  if (workingTxn.entity_qb_id && isLocalId(workingTxn.entity_qb_id)) {
    const { data: conRow } = await supabase
      .from('external_accounting_contacts')
      .select('*')
      .eq('company_realm_id', realmId)
      .eq('qb_contact_id', workingTxn.entity_qb_id)
      .maybeSingle()

    if (conRow) {
      const conPush = await pushContactToQbo(supabase, realmId, conRow)
      if (conPush.synced && conPush.qbContactId) {
        workingTxn.entity_qb_id = conPush.qbContactId
      }
    }
  }

  // 3. Ensure any newly created local account (`LOCAL-ACC-*`) is pushed to QBO first
  if (workingTxn.account_qb_id && isLocalId(workingTxn.account_qb_id)) {
    const { data: accRow } = await supabase
      .from('external_accounting_accounts')
      .select('*')
      .eq('company_realm_id', realmId)
      .eq('qb_account_id', workingTxn.account_qb_id)
      .maybeSingle()
    if (accRow) {
      const accPush = await pushAccountToQbo(supabase, realmId, accRow)
      if (accPush.synced && accPush.qbAccountId) {
        workingTxn.account_qb_id = accPush.qbAccountId
      }
    }
  }

  // 4. Handle DELETE in QBO
  if (operation === 'DELETE') {
    const getRes = await qboV3Request(supabase, realmId, 'GET', `${endpoint}/${workingTxn.qb_txn_id}`)
    const syncToken = getRes.data?.[entityName]?.SyncToken ?? workingTxn.raw_data?.SyncToken ?? '0'
    const delRes = await qboV3Request(supabase, realmId, 'POST', `${endpoint}?operation=delete`, {
      Id: String(workingTxn.qb_txn_id),
      SyncToken: String(syncToken),
    })
    await queuePendingQboDelete(supabase, realmId, {
      kind: 'TRANSACTION',
      entityType: entityName,
      endpoint,
      qbId: String(workingTxn.qb_txn_id),
      operation: 'DELETE',
      label: `${workingTxn.txn_type || entityName} #${workingTxn.doc_number || workingTxn.qb_txn_id}`,
    })
    return {
      synced: delRes.ok,
      qbTxnId: String(workingTxn.qb_txn_id),
      status: delRes.ok ? 'DELETED_IN_QBO' : 'QUEUED_QBO_DELETE',
      error: delRes.error,
    }
  }

  // 5. Handle VOID in QBO
  if (operation === 'VOID') {
    const getRes = await qboV3Request(supabase, realmId, 'GET', `${endpoint}/${workingTxn.qb_txn_id}`)
    const syncToken = getRes.data?.[entityName]?.SyncToken ?? workingTxn.raw_data?.SyncToken ?? '0'
    const voidRes = await qboV3Request(supabase, realmId, 'POST', `${endpoint}?operation=void`, {
      Id: String(workingTxn.qb_txn_id),
      SyncToken: String(syncToken),
      sparse: true,
    })
    return {
      synced: voidRes.ok,
      qbTxnId: String(workingTxn.qb_txn_id),
      status: voidRes.ok ? 'VOIDED_IN_QBO' : 'QBO_VOID_ERROR',
      error: voidRes.error,
    }
  }

  // 6. Handle CREATE or UPDATE (`UPSERT`) in QBO
  const isNewInQbo = isLocalId(workingTxn.qb_txn_id)
  if (!isNewInQbo) {
    const getRes = await qboV3Request(supabase, realmId, 'GET', `${endpoint}/${workingTxn.qb_txn_id}`)
    if (getRes.ok && getRes.data?.[entityName]) {
      payload.Id = String(getRes.data[entityName].Id)
      payload.SyncToken = String(getRes.data[entityName].SyncToken || '0')
      payload.sparse = false
    }
  }

  const saveRes = await qboV3Request(supabase, realmId, 'POST', endpoint, payload)
  const currRaw = workingTxn.raw_data && typeof workingTxn.raw_data === 'object' ? workingTxn.raw_data : {}

  if (!saveRes.ok || !saveRes.data?.[entityName]) {
    await supabase
      .from('external_accounting_transactions')
      .update({
        raw_data: {
          ...currRaw,
          qbo_sync_status: 'PENDING_QBO_SYNC',
          qbo_sync_error: saveRes.error || 'Error enviando a QBO',
          qbo_last_attempt_at: new Date().toISOString(),
        },
      })
      .eq('id', workingTxn.id)
      .eq('company_realm_id', realmId)

    return {
      synced: false,
      status: 'PENDING_QBO_SYNC',
      error: saveRes.error,
    }
  }

  const qboEntity = saveRes.data[entityName]
  const realQbTxnId = String(qboEntity.Id)

  await supabase
    .from('external_accounting_transactions')
    .update({
      qb_entity_type: entityName,
      qb_txn_id: realQbTxnId,
      entity_qb_id: workingTxn.entity_qb_id,
      account_qb_id: workingTxn.account_qb_id,
      raw_data: {
        ...qboEntity,
        qbo_sync_status: 'SYNCED',
        qbo_synced_at: new Date().toISOString(),
        qbo_sync_error: null,
      },
      updated_at: new Date().toISOString(),
    })
    .eq('id', workingTxn.id)
    .eq('company_realm_id', realmId)

  return {
    synced: true,
    qbTxnId: realQbTxnId,
    status: 'SYNCED',
  }
}

/**
 * Normaliza las líneas de una transacción proveniente de Intuit QuickBooks V3 al formato de `external_accounting_transactions`.
 */
function normalizeQboLines(lines: any[] = []): { items: any[]; categorySummary: string } {
  const items: any[] = []
  const categories = new Set<string>()

  for (const l of lines) {
    if (l.DetailType === 'SubTotalLineDetail') continue
    const acctDetail =
      l.AccountBasedExpenseLineDetail ||
      l.ItemBasedExpenseLineDetail ||
      l.DepositLineDetail ||
      l.JournalEntryLineDetail ||
      l.SalesItemLineDetail ||
      {}
    const accountRef = acctDetail.AccountRef || acctDetail.ItemAccountRef || null
    const entityRef = acctDetail.Entity?.EntityRef || acctDetail.Entity || acctDetail.CustomerRef || null
    const itemRef = acctDetail.ItemRef || null
    const classRef = acctDetail.ClassRef || null
    const deptRef = acctDetail.DepartmentRef || null
    const accountName = accountRef?.name || itemRef?.name || null
    if (accountName) categories.add(accountName)

    items.push({
      id: l.Id || null,
      line_num: l.LineNum || null,
      description: l.Description || '',
      amount: Number(l.Amount ?? 0),
      detail_type: l.DetailType || '',
      posting_type: acctDetail.PostingType || null,
      account_qb_id: accountRef?.value ? String(accountRef.value) : null,
      account_name: accountName,
      entity_qb_id: entityRef?.value ? String(entityRef.value) : null,
      entity_name: entityRef?.name || null,
      item_qb_id: itemRef?.value ? String(itemRef.value) : null,
      item_id: itemRef?.value ? String(itemRef.value) : null,
      item_name: itemRef?.name || null,
      class_qb_id: classRef?.value ? String(classRef.value) : null,
      class_name: classRef?.name || null,
      department_qb_id: deptRef?.value ? String(deptRef.value) : null,
      department_name: deptRef?.name || null,
      payment_method: acctDetail.PaymentMethodRef?.name || null,
      check_num: acctDetail.CheckNum || null,
      linked_txn_id: Array.isArray(l.LinkedTxn) && l.LinkedTxn[0]?.TxnId ? String(l.LinkedTxn[0].TxnId) : null,
      linked_txn_type: Array.isArray(l.LinkedTxn) && l.LinkedTxn[0]?.TxnType ? String(l.LinkedTxn[0].TxnType) : null,
    })
  }

  return {
    items,
    categorySummary: Array.from(categories).join(', '),
  }
}

/** Reads a `LineEx` NameValue (e.g. `txnReferenceNumber`) from a QBO Payment/BillPayment line. */
function readLineEx(line: any, name: string): string | null {
  const arr = line?.LineEx?.any
  if (!Array.isArray(arr)) return null
  const hit = arr.find((x: any) => x?.value?.Name === name)
  return hit?.value?.Value != null ? String(hit.value.Value) : null
}

/**
 * Builds Deposit `line_items` exactly like the forensic historical import:
 * - Lines with `LinkedTxn` (customer payments) come from Undeposited Funds and carry `linked_txn_id/type`,
 *   the customer, check number, payment method and "Payment for Invoice #N (Customer)" description.
 * - `CashBack` becomes a `CashBackLineDetail` line with negative amount (so `TotalAmt = Σ lines`).
 */
export function buildDepositLineItems(
  item: any,
  opts: {
    accNameById: Map<string, string>
    undepositedFunds: { id: string; name: string } | null
    linkedInfo: Map<string, { entity_qb_id: string | null; entity_name: string | null; invoice_doc: string | null; payment_method: string | null; account_qb_id: string | null }>
  }
): any[] {
  const { items: base } = normalizeQboLines(item?.Line)
  const rawLines: any[] = (Array.isArray(item?.Line) ? item.Line : []).filter((l: any) => l.DetailType !== 'SubTotalLineDetail')
  const out = base.map((l: any, idx: number) => {
    const raw = rawLines[idx] || {}
    const lt = Array.isArray(raw.LinkedTxn) ? raw.LinkedTxn[0] : null
    if (!lt?.TxnId) {
      if (l.account_qb_id && !l.account_name) l.account_name = opts.accNameById.get(l.account_qb_id) || null
      return { ...l, id: l.id || String(idx + 1), line_num: l.line_num || idx + 1, detail_type: l.detail_type || 'DepositLineDetail' }
    }
    const info = opts.linkedInfo.get(`${lt.TxnType}:${lt.TxnId}`)
    const srcAccId = info?.account_qb_id || opts.undepositedFunds?.id || null
    const srcAccName = (srcAccId && opts.accNameById.get(srcAccId)) || opts.undepositedFunds?.name || 'Undeposited Funds'
    const desc = l.description || (info?.invoice_doc
      ? `Payment for Invoice #${info.invoice_doc}${info.entity_name ? ` (${info.entity_name})` : ''}`
      : `${lt.TxnType} #${lt.TxnId}${info?.entity_name ? ` (${info.entity_name})` : ''}`)
    return {
      ...l,
      id: l.id || String(idx + 1),
      line_num: l.line_num || idx + 1,
      detail_type: 'DepositLineDetail',
      description: desc,
      account_qb_id: srcAccId,
      account_name: srcAccName,
      entity_qb_id: l.entity_qb_id || info?.entity_qb_id || null,
      entity_name: l.entity_name || info?.entity_name || null,
      entity_type: 'Customer',
      payment_method: l.payment_method || info?.payment_method || null,
      linked_txn_id: String(lt.TxnId),
      linked_txn_type: String(lt.TxnType),
    }
  })
  if (item?.CashBack && Number(item.CashBack.Amount || 0)) {
    const cbId = item.CashBack.AccountRef?.value ? String(item.CashBack.AccountRef.value) : null
    out.push({
      id: `CB-${item.Id}`,
      line_num: out.length + 1,
      description: item.CashBack.Memo || 'Cash back',
      amount: -Math.abs(Number(item.CashBack.Amount)),
      detail_type: 'CashBackLineDetail',
      posting_type: null,
      account_qb_id: cbId,
      account_name: item.CashBack.AccountRef?.name || (cbId ? opts.accNameById.get(cbId) : null) || null,
      entity_qb_id: null,
      entity_name: null,
      item_qb_id: null,
      item_id: null,
      item_name: null,
      class_qb_id: null,
      class_name: null,
      department_qb_id: null,
      department_name: null,
      payment_method: null,
      check_num: null,
      linked_txn_id: null,
      linked_txn_type: null,
    })
  }
  return out
}

/**
 * Ejecuta una sincronización bidireccional completa (Push de pendientes locales + Pull de QBO V3) para la empresa activa.
 */
export async function syncCompanyWithQbo(
  supabase: SupabaseClient,
  realmId: string
): Promise<{
  ok: boolean
  pushedTransactions: number
  pushedAccounts: number
  pushedContacts: number
  pulledAccounts: number
  pulledContacts: number
  pulledTransactions: number
  error?: string
}> {
  const auth = await getExternalCompanyQboAuth(supabase, realmId)
  if (!auth.connected) {
    return {
      ok: false,
      pushedTransactions: 0,
      pushedAccounts: 0,
      pushedContacts: 0,
      pulledAccounts: 0,
      pulledContacts: 0,
      pulledTransactions: 0,
      error: auth.lastSyncError || 'Esta empresa aún no está autorizada con QuickBooks Online (haz clic en "Conectar QBO").',
    }
  }

  let pushedAccounts = 0
  let pushedContacts = 0
  let pushedTransactions = 0
  let pulledAccounts = 0
  let pulledContacts = 0
  let pulledTransactions = 0

  // ---------------------------------------------------------------------------
  // PHASE 1: PUSH LOCAL PENDING ACCOUNTS, CONTACTS, TRANSACTIONS & DELETES TO QBO
  // ---------------------------------------------------------------------------
  const { data: preSyncComp } = await supabase
    .from('external_accounting_companies')
    .select('metadata')
    .eq('realm_id', realmId)
    .maybeSingle()

  const preMeta = preSyncComp?.metadata && typeof preSyncComp.metadata === 'object' ? preSyncComp.metadata : {}
  const pendingDeletes: any[] = Array.isArray(preMeta.pending_qbo_deletes) ? preMeta.pending_qbo_deletes : []
  const deletedArchive: any[] = Array.isArray(preMeta.deleted_qbo_ids) ? preMeta.deleted_qbo_ids : []
  const remainingPendingDeletes: any[] = []

  for (const delItem of pendingDeletes) {
    if (!delItem?.qbId || isLocalId(delItem.qbId)) continue
    const endpoint = String(delItem.endpoint || '').toLowerCase()
    const entityType = String(delItem.entityType || '')
    if (!endpoint || !entityType) continue

    const getRes = await qboV3Request(supabase, realmId, 'GET', `${endpoint}/${delItem.qbId}`)
    const syncToken = getRes.data?.[entityType]?.SyncToken ?? '0'

    if (delItem.kind === 'TRANSACTION') {
      const opQuery = delItem.operation === 'VOID' ? 'void' : 'delete'
      const delRes = await qboV3Request(supabase, realmId, 'POST', `${endpoint}?operation=${opQuery}`, {
        Id: String(delItem.qbId),
        SyncToken: String(syncToken),
        ...(opQuery === 'void' ? { sparse: true } : {}),
      })
      if (delRes.ok) {
        pushedTransactions++
      } else {
        remainingPendingDeletes.push(delItem)
      }
    } else {
      // ACCOUNT, CONTACT, LIST_ITEM -> Active: false sparse update in QBO V3
      const currentObj = getRes.data?.[entityType] || {}
      const deactPayload: Record<string, any> = {
        ...currentObj,
        Id: String(delItem.qbId),
        SyncToken: String(syncToken),
        Active: false,
        sparse: true,
      }
      const deactRes = await qboV3Request(supabase, realmId, 'POST', endpoint, deactPayload)
      if (deactRes.ok) {
        if (delItem.kind === 'ACCOUNT') pushedAccounts++
        if (delItem.kind === 'CONTACT') pushedContacts++
      } else {
        remainingPendingDeletes.push(delItem)
      }
    }
  }

  const deletedAccountIds = new Set(
    deletedArchive.filter((d: any) => d.kind === 'ACCOUNT').map((d: any) => String(d.qbId))
  )
  const deletedContactKeys = new Set(
    deletedArchive.filter((d: any) => d.kind === 'CONTACT').map((d: any) => `${d.entityType}:${d.qbId}`)
  )
  const deletedTxnKeys = new Set(
    deletedArchive.filter((d: any) => d.kind === 'TRANSACTION').map((d: any) => `${d.entityType}:${d.qbId}`)
  )

  const { data: localAccounts } = await supabase
    .from('external_accounting_accounts')
    .select('*')
    .eq('company_realm_id', realmId)
    .like('qb_account_id', 'LOCAL-%')

  for (const acc of localAccounts || []) {
    const r = await pushAccountToQbo(supabase, realmId, acc)
    if (r.synced) pushedAccounts++
  }

  const { data: localContacts } = await supabase
    .from('external_accounting_contacts')
    .select('*')
    .eq('company_realm_id', realmId)
    .like('qb_contact_id', 'LOCAL-%')

  for (const con of localContacts || []) {
    const r = await pushContactToQbo(supabase, realmId, con)
    if (r.synced) pushedContacts++
  }

  const { data: localTxns } = await supabase
    .from('external_accounting_transactions')
    .select('*')
    .eq('company_realm_id', realmId)
    .or('qb_txn_id.like.LOCAL-%,qb_txn_id.like.REC-%,qb_txn_id.like.BATCH-%')
    .eq('is_voided', false)

  for (const txn of localTxns || []) {
    const r = await pushTransactionToQbo(supabase, realmId, txn, 'UPSERT')
    if (r.synced) pushedTransactions++
  }

  // ---------------------------------------------------------------------------
  // PHASE 2: PULL ACCOUNTS, CONTACTS & RECENT TRANSACTIONS FROM QBO V3
  // ---------------------------------------------------------------------------
  // 2a. Pull Accounts (includes updated CurrentBalance from QBO, excluding locally deleted accounts)
  const accQuery = await qboV3Request(
    supabase,
    realmId,
    'GET',
    `query?query=${encodeURIComponent('SELECT * FROM Account WHERE Active IN (true, false) MAXRESULTS 1000')}`
  )
  const rawAccounts = (accQuery.data?.QueryResponse?.Account || []).filter(
    (acc: any) => !deletedAccountIds.has(String(acc.Id))
  )
  if (rawAccounts.length > 0) {
    const accountRows = rawAccounts.map((acc: any) => ({
      company_realm_id: realmId,
      qb_account_id: String(acc.Id),
      name: acc.Name || 'Unnamed Account',
      fully_qualified_name: acc.FullyQualifiedName || acc.Name || '',
      acct_num: acc.AcctNum || null,
      classification: acc.Classification || null,
      account_type: acc.AccountType || 'Expense',
      account_sub_type: acc.AccountSubType || null,
      current_balance: Number(acc.CurrentBalance ?? 0),
      is_sub_account: Boolean(acc.SubAccount),
      parent_qb_id: acc.ParentRef?.value ? String(acc.ParentRef.value) : null,
      is_active: acc.Active !== false,
      raw_data: { ...acc, qbo_sync_status: 'SYNCED', qbo_synced_at: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    }))
    await supabase
      .from('external_accounting_accounts')
      .upsert(accountRows, { onConflict: 'company_realm_id,qb_account_id' })
    pulledAccounts = accountRows.length
  }

  // 2b. Pull Vendors & Customers (excluding locally deleted contacts)
  for (const cType of ['Vendor', 'Customer'] as const) {
    const cQuery = await qboV3Request(
      supabase,
      realmId,
      'GET',
      `query?query=${encodeURIComponent(`SELECT * FROM ${cType} WHERE Active IN (true, false) MAXRESULTS 1000`)}`
    )
    const rawContacts = (cQuery.data?.QueryResponse?.[cType] || []).filter(
      (c: any) => !deletedContactKeys.has(`${cType}:${c.Id}`)
    )
    if (rawContacts.length > 0) {
      const contactRows = rawContacts.map((c: any) => ({
        company_realm_id: realmId,
        contact_type: cType,
        qb_contact_id: String(c.Id),
        display_name: c.DisplayName || c.CompanyName || `${c.GivenName || ''} ${c.FamilyName || ''}`.trim() || 'Unnamed',
        company_name: c.CompanyName || null,
        given_name: c.GivenName || null,
        family_name: c.FamilyName || null,
        print_on_check_name: c.PrintOnCheckName || c.DisplayName || null,
        email: c.PrimaryEmailAddr?.Address || null,
        phone: c.PrimaryPhone?.FreeFormNumber || null,
        address: c.BillAddr || c.PrimaryAddr || {},
        tax_identifier: c.TaxIdentifier || null,
        vendor_1099: Boolean(c.Vendor1099),
        acct_num: c.AcctNum || null,
        balance: Number(c.Balance ?? 0),
        is_active: c.Active !== false,
        raw_data: { ...c, qbo_sync_status: 'SYNCED', qbo_synced_at: new Date().toISOString() },
        updated_at: new Date().toISOString(),
      }))
      await supabase
        .from('external_accounting_contacts')
        .upsert(contactRows, { onConflict: 'company_realm_id,contact_type,qb_contact_id' })
      pulledContacts += contactRows.length
    }
  }

  // 2c. Pull Recent Transactions (Purchase, Deposit, JournalEntry, Transfer, Bill, BillPayment, Invoice, Payment)
  const pulledTxnRows: any[] = []
  const pullEntities = ['Purchase', 'Deposit', 'JournalEntry', 'Transfer', 'Bill', 'BillPayment', 'Invoice', 'Payment'] as const

  const accNameById = new Map<string, string>()
  let defaultArAcc: { id: string; name: string } | null = null
  let defaultApAcc: { id: string; name: string } | null = null
  for (const a of rawAccounts) {
    const idStr = String(a.Id)
    const nm = a.FullyQualifiedName || a.Name || 'Account'
    accNameById.set(idStr, nm)
    if (a.AccountType === 'Accounts Receivable' && !defaultArAcc) {
      defaultArAcc = { id: idStr, name: nm }
    }
    if (a.AccountType === 'Accounts Payable' && !defaultApAcc) {
      defaultApAcc = { id: idStr, name: nm }
    }
  }
  const ufAcc = rawAccounts.find((a: any) => a.AccountSubType === 'UndepositedFunds')
  const undepositedFunds = ufAcc ? { id: String(ufAcc.Id), name: ufAcc.FullyQualifiedName || ufAcc.Name || 'Undeposited Funds' } : null

  // Phase A: download the latest page of every entity first (so deposits can resolve their linked payments)
  const fetchedByEnt: Record<string, any[]> = {}
  for (const ent of pullEntities) {
    const q = `SELECT * FROM ${ent} ORDERBY MetaData.LastUpdatedTime DESC MAXRESULTS 250`
    const tRes = await qboV3Request(supabase, realmId, 'GET', `query?query=${encodeURIComponent(q)}`)
    fetchedByEnt[ent] = (tRes.data?.QueryResponse?.[ent] || []).filter(
      (item: any) => !deletedTxnKeys.has(`${ent}:${item.Id}`)
    )
  }

  // Phase B: linked payment info for Deposit lines (customer, invoice #, payment method, source account)
  const linkedInfo = new Map<string, { entity_qb_id: string | null; entity_name: string | null; invoice_doc: string | null; payment_method: string | null; account_qb_id: string | null }>()
  for (const p of fetchedByEnt['Payment'] || []) {
    linkedInfo.set(`Payment:${p.Id}`, {
      entity_qb_id: p.CustomerRef?.value ? String(p.CustomerRef.value) : null,
      entity_name: p.CustomerRef?.name || null,
      invoice_doc: readLineEx((p.Line || [])[0], 'txnReferenceNumber'),
      payment_method: p.PaymentMethodRef?.name || null,
      account_qb_id: p.DepositToAccountRef?.value ? String(p.DepositToAccountRef.value) : (undepositedFunds?.id || null),
    })
  }
  const missingLinked = new Map<string, Set<string>>()
  for (const d of fetchedByEnt['Deposit'] || []) {
    for (const l of d.Line || []) {
      const lt = Array.isArray(l.LinkedTxn) ? l.LinkedTxn[0] : null
      if (lt?.TxnId && !linkedInfo.has(`${lt.TxnType}:${lt.TxnId}`)) {
        if (!missingLinked.has(lt.TxnType)) missingLinked.set(lt.TxnType, new Set())
        missingLinked.get(lt.TxnType)!.add(String(lt.TxnId))
      }
    }
  }
  for (const [lType, ids] of missingLinked.entries()) {
    const idList = Array.from(ids)
    for (let i = 0; i < idList.length; i += 200) {
      const { data: linkedRows } = await supabase
        .from('external_accounting_transactions')
        .select('qb_txn_id, entity_qb_id, entity_name, account_qb_id, payment_type, line_items, raw_data')
        .eq('company_realm_id', realmId)
        .eq('qb_entity_type', lType)
        .in('qb_txn_id', idList.slice(i, i + 200))
      for (const r of linkedRows || []) {
        const firstLine = Array.isArray(r.line_items) ? r.line_items[0] : null
        const docFromDesc = String(firstLine?.description || '').match(/Invoice #([^\s(]+)/)?.[1] || null
        linkedInfo.set(`${lType}:${r.qb_txn_id}`, {
          entity_qb_id: r.entity_qb_id || null,
          entity_name: r.entity_name || null,
          invoice_doc: readLineEx((r.raw_data?.Line || [])[0], 'txnReferenceNumber') || docFromDesc,
          payment_method: r.raw_data?.PaymentMethodRef?.name || null,
          account_qb_id: r.account_qb_id || undepositedFunds?.id || null,
        })
      }
    }
  }

  // Phase C: Invoice / CreditMemo doc numbers & dates referenced by Payment lines ("Payment for Invoice #N (date)")
  const invoiceInfo = new Map<string, { doc: string | null; date: string | null }>()
  for (const inv of fetchedByEnt['Invoice'] || []) invoiceInfo.set(`Invoice:${inv.Id}`, { doc: inv.DocNumber || null, date: inv.TxnDate || null })
  const missingInv = new Map<string, Set<string>>()
  for (const p of fetchedByEnt['Payment'] || []) {
    for (const l of p.Line || []) {
      const lt = Array.isArray(l.LinkedTxn) ? l.LinkedTxn[0] : null
      if (lt?.TxnId && !invoiceInfo.has(`${lt.TxnType}:${lt.TxnId}`)) {
        if (!missingInv.has(lt.TxnType)) missingInv.set(lt.TxnType, new Set())
        missingInv.get(lt.TxnType)!.add(String(lt.TxnId))
      }
    }
  }
  for (const [lType, ids] of missingInv.entries()) {
    const idList = Array.from(ids)
    for (let i = 0; i < idList.length; i += 200) {
      const { data: invRows } = await supabase
        .from('external_accounting_transactions')
        .select('qb_txn_id, doc_number, txn_date')
        .eq('company_realm_id', realmId)
        .eq('qb_entity_type', lType)
        .in('qb_txn_id', idList.slice(i, i + 200))
      for (const r of invRows || []) invoiceInfo.set(`${lType}:${r.qb_txn_id}`, { doc: r.doc_number || null, date: r.txn_date || null })
    }
  }

  for (const ent of pullEntities) {
    const list = fetchedByEnt[ent] || []

    for (const item of list) {
      const { items: lineItems, categorySummary } = normalizeQboLines(item.Line)
      const syncedRaw = { ...item, qbo_sync_status: 'SYNCED', qbo_synced_at: new Date().toISOString() }

      if (ent === 'Purchase') {
        const pType = item.PaymentType || 'Check'
        const txnType = pType === 'Check' ? 'Check' : pType === 'CreditCard' ? 'CreditCardExpense' : 'Expense'
        const isVoided = Boolean(item.PrivateNote && /void/i.test(item.PrivateNote)) && Number(item.TotalAmt ?? 0) === 0
        pulledTxnRows.push({
          company_realm_id: realmId,
          txn_type: txnType,
          qb_entity_type: 'Purchase',
          qb_txn_id: String(item.Id),
          txn_date: item.TxnDate,
          doc_number: item.DocNumber || null,
          payment_type: pType,
          direction: 'OUT',
          account_qb_id: item.AccountRef?.value ? String(item.AccountRef.value) : null,
          account_name: item.AccountRef?.name || (item.AccountRef?.value ? accNameById.get(String(item.AccountRef.value)) : null) || null,
          to_account_qb_id: lineItems[0]?.account_qb_id || null,
          to_account_name: lineItems[0]?.account_name || null,
          entity_qb_id: item.EntityRef?.value ? String(item.EntityRef.value) : null,
          entity_name: item.EntityRef?.name || null,
          entity_type: item.EntityRef?.type || 'Vendor',
          total_amount: Number(item.TotalAmt ?? 0),
          open_balance: 0,
          memo: item.PrivateNote || lineItems.map((l: any) => l.description).filter(Boolean).join('; ') || null,
          category_summary: categorySummary || 'Uncategorized Expense',
          print_status: item.PrintStatus || 'NotSet',
          cleared_status: isVoided ? 'Voided' : 'Cleared',
          is_voided: isVoided,
          line_items: lineItems,
          raw_data: syncedRaw,
          updated_at: new Date().toISOString(),
        })
      } else if (ent === 'Deposit') {
        const depLines = buildDepositLineItems(item, { accNameById, undepositedFunds, linkedInfo })
        const firstLine = depLines[0] || {}
        const depCategories = Array.from(new Set(depLines.filter((l: any) => l.detail_type !== 'CashBackLineDetail').map((l: any) => l.account_name).filter(Boolean)))
        pulledTxnRows.push({
          company_realm_id: realmId,
          txn_type: 'Deposit',
          qb_entity_type: 'Deposit',
          qb_txn_id: String(item.Id),
          txn_date: item.TxnDate,
          doc_number: item.DocNumber || firstLine.check_num || null,
          payment_type: firstLine.payment_method || 'Deposit',
          direction: 'IN',
          account_qb_id: item.DepositToAccountRef?.value ? String(item.DepositToAccountRef.value) : null,
          account_name: item.DepositToAccountRef?.name || (item.DepositToAccountRef?.value ? accNameById.get(String(item.DepositToAccountRef.value)) : null) || null,
          to_account_qb_id: firstLine.account_qb_id || null,
          to_account_name: firstLine.account_name || null,
          entity_qb_id: firstLine.entity_qb_id || null,
          entity_name: firstLine.entity_name || null,
          entity_type: 'Customer',
          total_amount: Number(item.TotalAmt ?? 0),
          open_balance: 0,
          memo: item.PrivateNote || depLines.map((l: any) => l.description).filter(Boolean).join('; ') || null,
          category_summary: depCategories.join(', ') || categorySummary || 'Deposit',
          print_status: 'NotSet',
          cleared_status: 'Cleared',
          is_voided: false,
          line_items: depLines,
          raw_data: syncedRaw,
          updated_at: new Date().toISOString(),
        })
      } else if (ent === 'Transfer') {
        pulledTxnRows.push({
          company_realm_id: realmId,
          txn_type: 'Transfer',
          qb_entity_type: 'Transfer',
          qb_txn_id: String(item.Id),
          txn_date: item.TxnDate,
          payment_type: 'Transfer',
          direction: 'TRANSFER',
          account_qb_id: item.FromAccountRef?.value ? String(item.FromAccountRef.value) : null,
          account_name: item.FromAccountRef?.name || (item.FromAccountRef?.value ? accNameById.get(String(item.FromAccountRef.value)) : null) || null,
          to_account_qb_id: item.ToAccountRef?.value ? String(item.ToAccountRef.value) : null,
          to_account_name: item.ToAccountRef?.name || (item.ToAccountRef?.value ? accNameById.get(String(item.ToAccountRef.value)) : null) || null,
          total_amount: Number(item.Amount ?? 0),
          open_balance: 0,
          memo: item.PrivateNote || `Transfer from ${item.FromAccountRef?.name || ''} to ${item.ToAccountRef?.name || ''}`,
          category_summary: `${item.FromAccountRef?.name || ''} ➔ ${item.ToAccountRef?.name || ''}`,
          print_status: 'NotSet',
          cleared_status: 'Cleared',
          is_voided: false,
          line_items: [],
          raw_data: syncedRaw,
          updated_at: new Date().toISOString(),
        })
      } else if (ent === 'JournalEntry') {
        const debitSum = lineItems
          .filter((l: any) => l.posting_type === 'Debit')
          .reduce((acc: number, l: any) => acc + Number(l.amount || 0), 0)
        pulledTxnRows.push({
          company_realm_id: realmId,
          txn_type: 'JournalEntry',
          qb_entity_type: 'JournalEntry',
          qb_txn_id: String(item.Id),
          txn_date: item.TxnDate,
          doc_number: item.DocNumber || null,
          payment_type: 'JournalEntry',
          direction: 'JOURNAL',
          account_qb_id: lineItems[0]?.account_qb_id || null,
          account_name: lineItems[0]?.account_name || null,
          to_account_qb_id: lineItems[1]?.account_qb_id || null,
          to_account_name: lineItems[1]?.account_name || null,
          total_amount: Number(item.TotalAmt) > 0 ? Number(item.TotalAmt) : Number(debitSum.toFixed(2)),
          open_balance: 0,
          memo: item.PrivateNote || lineItems[0]?.description || null,
          category_summary: categorySummary || 'Journal Entry',
          print_status: 'NotSet',
          cleared_status: 'Cleared',
          is_voided: false,
          line_items: lineItems,
          raw_data: syncedRaw,
          updated_at: new Date().toISOString(),
        })
      } else if (ent === 'Bill') {
        const apId = item.APAccountRef?.value ? String(item.APAccountRef.value) : defaultApAcc?.id || null
        const apName = item.APAccountRef?.name || (apId ? accNameById.get(apId) : null) || defaultApAcc?.name || 'Accounts Payable (A/P)'
        pulledTxnRows.push({
          company_realm_id: realmId,
          txn_type: 'Bill',
          qb_entity_type: 'Bill',
          qb_txn_id: String(item.Id),
          txn_date: item.TxnDate,
          due_date: item.DueDate || item.TxnDate || null,
          doc_number: item.DocNumber || null,
          payment_type: 'Bill',
          direction: 'ACCRUAL',
          account_qb_id: apId,
          account_name: apName,
          to_account_qb_id: lineItems[0]?.account_qb_id || null,
          to_account_name: lineItems[0]?.account_name || null,
          entity_qb_id: item.VendorRef?.value ? String(item.VendorRef.value) : null,
          entity_name: item.VendorRef?.name || null,
          entity_type: 'Vendor',
          total_amount: Number(item.TotalAmt ?? 0),
          open_balance: Number(item.Balance ?? 0),
          memo: item.PrivateNote || lineItems.map((l: any) => l.description).filter(Boolean).join('; ') || null,
          category_summary: categorySummary || 'Accounts Payable (A/P)',
          print_status: 'NotSet',
          cleared_status: 'Cleared',
          is_voided: false,
          line_items: lineItems,
          raw_data: syncedRaw,
          updated_at: new Date().toISOString(),
        })
      } else if (ent === 'BillPayment') {
        const payType = item.PayType || 'Check'
        const bankRef = item.CheckPayment?.BankAccountRef || item.CreditCardPayment?.CCAccountRef
        const bankId = bankRef?.value ? String(bankRef.value) : null
        const bankName = bankRef?.name || (bankId ? accNameById.get(bankId) : null) || null
        const apId = item.APAccountRef?.value ? String(item.APAccountRef.value) : defaultApAcc?.id || null
        const apName = item.APAccountRef?.name || (apId ? accNameById.get(apId) : null) || defaultApAcc?.name || 'Accounts Payable (A/P)'
        const bpLines = (Array.isArray(item.Line) ? item.Line : []).map((l: any, idx: number) => ({
          id: String(l.Id || idx + 1),
          amount: Number(l.Amount ?? 0),
          line_num: idx + 1,
          description: item.PrivateNote || `BillPayment (${item.TxnDate})`,
          detail_type: 'BillPaymentLineDetail',
          entity_name: item.VendorRef?.name || null,
          entity_qb_id: item.VendorRef?.value ? String(item.VendorRef.value) : null,
          account_qb_id: apId,
          account_name: apName,
          linked_txn_id: l.LinkedTxn?.[0]?.TxnId ? String(l.LinkedTxn[0].TxnId) : null,
          linked_txn_type: l.LinkedTxn?.[0]?.TxnType || 'Bill',
        }))
        pulledTxnRows.push({
          company_realm_id: realmId,
          txn_type: 'BillPayment',
          qb_entity_type: 'BillPayment',
          qb_txn_id: String(item.Id),
          txn_date: item.TxnDate,
          doc_number: item.DocNumber || null,
          payment_type: payType,
          direction: 'OUT',
          account_qb_id: bankId,
          account_name: bankName,
          to_account_qb_id: apId,
          to_account_name: apName,
          entity_qb_id: item.VendorRef?.value ? String(item.VendorRef.value) : null,
          entity_name: item.VendorRef?.name || null,
          entity_type: 'Vendor',
          total_amount: Number(item.TotalAmt ?? 0),
          open_balance: 0,
          memo: item.PrivateNote || null,
          category_summary: apName,
          print_status: item.CheckPayment?.PrintStatus || 'NotSet',
          cleared_status: 'Cleared',
          is_voided: false,
          line_items: bpLines,
          raw_data: syncedRaw,
          updated_at: new Date().toISOString(),
        })
      } else if (ent === 'Invoice') {
        const arId = item.ARAccountRef?.value ? String(item.ARAccountRef.value) : defaultArAcc?.id || null
        const arName = item.ARAccountRef?.name || (arId ? accNameById.get(arId) : null) || defaultArAcc?.name || 'Accounts Receivable (A/R)'
        pulledTxnRows.push({
          company_realm_id: realmId,
          txn_type: 'Invoice',
          qb_entity_type: 'Invoice',
          qb_txn_id: String(item.Id),
          txn_date: item.TxnDate,
          due_date: item.DueDate || item.TxnDate || null,
          doc_number: item.DocNumber || null,
          payment_type: item.SalesTermRef?.name || 'Invoice',
          direction: 'ACCRUAL',
          account_qb_id: arId,
          account_name: arName,
          to_account_qb_id: lineItems[0]?.account_qb_id || null,
          to_account_name: lineItems[0]?.account_name || lineItems[0]?.item_name || null,
          entity_qb_id: item.CustomerRef?.value ? String(item.CustomerRef.value) : null,
          entity_name: item.CustomerRef?.name || null,
          entity_type: 'Customer',
          total_amount: Number(item.TotalAmt ?? 0),
          open_balance: Number(item.Balance ?? 0),
          memo: item.PrivateNote || item.CustomerMemo?.value || lineItems.map((l: any) => l.description).filter(Boolean).join('; ') || null,
          category_summary: categorySummary || lineItems[0]?.item_name || 'Sales',
          print_status: item.PrintStatus || 'NotSet',
          cleared_status: 'Cleared',
          is_voided: false,
          line_items: lineItems,
          raw_data: syncedRaw,
          updated_at: new Date().toISOString(),
        })
      } else if (ent === 'Payment') {
        const depId = item.DepositToAccountRef?.value ? String(item.DepositToAccountRef.value) : null
        const depName = item.DepositToAccountRef?.name || (depId ? accNameById.get(depId) : null) || null
        const arId = item.ARAccountRef?.value ? String(item.ARAccountRef.value) : defaultArAcc?.id || null
        const arName = item.ARAccountRef?.name || (arId ? accNameById.get(arId) : null) || defaultArAcc?.name || 'Accounts Receivable (A/R)'
        const pLines = (Array.isArray(item.Line) ? item.Line : []).map((l: any, idx: number) => {
          const ltId = l.LinkedTxn?.[0]?.TxnId ? String(l.LinkedTxn[0].TxnId) : null
          const ltType = l.LinkedTxn?.[0]?.TxnType || 'Invoice'
          const refNum = readLineEx(l, 'txnReferenceNumber')
          const inv = ltId ? invoiceInfo.get(`${ltType}:${ltId}`) : null
          const docNo = refNum || inv?.doc || null
          return {
            id: String(l.Id || idx + 1),
            amount: Number(l.Amount ?? 0),
            line_num: idx + 1,
            description: docNo
              ? `Payment for ${ltType} #${docNo}${inv?.date ? ` (${inv.date})` : ''}`
              : (item.PrivateNote || `Payment (${item.TxnDate})`),
            detail_type: 'PaymentLineDetail',
            entity_name: item.CustomerRef?.name || null,
            entity_qb_id: item.CustomerRef?.value ? String(item.CustomerRef.value) : null,
            account_qb_id: arId,
            account_name: arName,
            linked_txn_id: ltId,
            linked_txn_type: ltType,
          }
        })
        const firstDoc = pLines.find((pl: any) => /#/.test(pl.description))?.description?.match(/#([^\s(]+)/)?.[1]
        pulledTxnRows.push({
          company_realm_id: realmId,
          txn_type: 'Payment',
          qb_entity_type: 'Payment',
          qb_txn_id: String(item.Id),
          txn_date: item.TxnDate,
          doc_number: item.PaymentRefNum || item.DocNumber || null,
          payment_type: item.PaymentMethodRef?.name || 'Payment',
          payment_method_qb_id: item.PaymentMethodRef?.value ? String(item.PaymentMethodRef.value) : null,
          direction: depId && depId !== undepositedFunds?.id ? 'IN' : 'ACCRUAL',
          account_qb_id: depId || undepositedFunds?.id || null,
          account_name: depName || (depId ? null : undepositedFunds?.name || null),
          to_account_qb_id: arId,
          to_account_name: arName,
          entity_qb_id: item.CustomerRef?.value ? String(item.CustomerRef.value) : null,
          entity_name: item.CustomerRef?.name || null,
          entity_type: 'Customer',
          total_amount: Number(item.TotalAmt ?? 0),
          open_balance: Number(item.UnappliedAmt ?? 0),
          memo: item.PrivateNote || null,
          category_summary: firstDoc ? `${arName} (Invoice #${firstDoc})` : arName,
          print_status: 'NotSet',
          cleared_status: 'Cleared',
          is_voided: false,
          line_items: pLines.length > 0 ? pLines : [{
            id: '1',
            amount: Number(item.TotalAmt ?? 0),
            line_num: 1,
            description: item.PrivateNote || `Payment (${item.TxnDate})`,
            detail_type: 'PaymentLineDetail',
            entity_name: item.CustomerRef?.name || null,
            entity_qb_id: item.CustomerRef?.value ? String(item.CustomerRef.value) : null,
            account_qb_id: arId,
            account_name: arName,
          }],
          raw_data: syncedRaw,
          updated_at: new Date().toISOString(),
        })
      }

      // QBO Location (DepartmentRef) & Class (ClassRef) live on the transaction header
      const lastRow = pulledTxnRows[pulledTxnRows.length - 1]
      if (lastRow && lastRow.qb_txn_id === String(item.Id) && lastRow.qb_entity_type === ent) {
        lastRow.department_qb_id = item.DepartmentRef?.value ? String(item.DepartmentRef.value) : null
        lastRow.department_name = item.DepartmentRef?.name || null
        if (item.ClassRef?.value) {
          lastRow.class_qb_id = String(item.ClassRef.value)
          lastRow.class_name = item.ClassRef.name || null
        }
      }
    }
  }

  const upsertErrors: string[] = []
  if (pulledTxnRows.length > 0) {
    for (let i = 0; i < pulledTxnRows.length; i += 250) {
      const chunk = pulledTxnRows.slice(i, i + 250)
      const { error: upErr } = await supabase
        .from('external_accounting_transactions')
        .upsert(chunk, { onConflict: 'company_realm_id,qb_entity_type,qb_txn_id' })
      if (upErr) upsertErrors.push(upErr.message)
    }
    pulledTransactions = pulledTxnRows.length
  }
  if (upsertErrors.length > 0) {
    console.error(`[syncCompanyWithQbo] ${realmId} upsert errors:`, upsertErrors)
  }

  // Update last_synced_at in company metadata
  const { data: compRow } = await supabase
    .from('external_accounting_companies')
    .select('metadata')
    .eq('realm_id', realmId)
    .maybeSingle()
  const meta = compRow?.metadata && typeof compRow.metadata === 'object' ? compRow.metadata : {}
  const updatedMeta = {
    ...meta,
    pending_qbo_deletes: remainingPendingDeletes,
    qbo_oauth: {
      ...(meta.qbo_oauth || {}),
      last_synced_at: new Date().toISOString(),
      last_sync_error: null,
    },
  }
  await supabase
    .from('external_accounting_companies')
    .update({ metadata: updatedMeta, updated_at: new Date().toISOString() })
    .eq('realm_id', realmId)

  return {
    ok: true,
    pushedTransactions,
    pushedAccounts,
    pushedContacts,
    pulledAccounts,
    pulledContacts,
    pulledTransactions,
  }
}

/**
 * Sincroniza de un solo golpe (One-Click Batch Sync) TODAS las 8 empresas de Raquel Velazquez conectadas a QuickBooks Online.
 */
export async function syncAllCompaniesWithQbo(
  supabase: SupabaseClient
): Promise<{
  ok: boolean
  companiesSynced: number
  companiesTotal: number
  pushedTransactions: number
  pushedAccounts: number
  pushedContacts: number
  pulledAccounts: number
  pulledContacts: number
  pulledTransactions: number
  results: Array<{ realmId: string; companyName: string; ok: boolean; error?: string }>
}> {
  const { data: allComps } = await supabase
    .from('external_accounting_companies')
    .select('realm_id, company_name, metadata')
    .order('company_name', { ascending: true })

  const comps = allComps || []
  let companiesSynced = 0
  let pushedTransactions = 0
  let pushedAccounts = 0
  let pushedContacts = 0
  let pulledAccounts = 0
  let pulledContacts = 0
  let pulledTransactions = 0
  const results: Array<{ realmId: string; companyName: string; ok: boolean; error?: string }> = []

  for (const c of comps) {
    if (c.metadata?.qbo_sync_enabled === false) continue
    const res = await syncCompanyWithQbo(supabase, c.realm_id)
    results.push({
      realmId: c.realm_id,
      companyName: c.company_name,
      ok: res.ok,
      error: res.error,
    })
    if (res.ok) {
      companiesSynced++
      pushedTransactions += res.pushedTransactions
      pushedAccounts += res.pushedAccounts
      pushedContacts += res.pushedContacts
      pulledAccounts += res.pulledAccounts
      pulledContacts += res.pulledContacts
      pulledTransactions += res.pulledTransactions
    }
  }

  return {
    ok: companiesSynced > 0,
    companiesSynced,
    companiesTotal: comps.length,
    pushedTransactions,
    pushedAccounts,
    pushedContacts,
    pulledAccounts,
    pulledContacts,
    pulledTransactions,
    results,
  }
}

