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
 * - 2026-10-31 (Fase 6 Hardening):
 *   1) Contrato unificado de Outbox (`external_accounting_sync_outbox`): usa exclusivamente `attempts`, `max_attempts`, `next_retry_at`,
 *      `status`, `last_error`, `synced_at` con backoff exponencial, idempotencia y `SKIPPED_LOCAL_ONLY` para empresas con `qbo_sync_enabled=false`.
 *   2) Pull paginado endurecido (`fetchAllQboEntitiesPaginatedDetailed`): si cualquier página falla devuelve `ok: false, status: 'incomplete'`
 *      con `failedEntity`, `failedPage`, `cursor` y `error`; si se alcanza el techo técnico (`maxPages`) reporta `truncated: true` y `truncatedEntities`.
 */

import crypto from 'crypto'
import { SupabaseClient } from '@supabase/supabase-js'
import { getAuthClient } from '@/lib/quickbooks'

const QBO_MINOR_VERSION = '73'
const QBO_ATTACHMENT_BUCKET = 'external-accounting-attachments'
const MAX_QBO_ATTACHMENT_BYTES = 15 * 1024 * 1024

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

  // Check if access_token is expired or expiring within 90 seconds (protected by distributed Postgres row mutex)
  const expiresMs = oauth.expires_at ? new Date(oauth.expires_at).getTime() : 0
  if (expiresMs <= Date.now() + 90_000) {
    try {
      const { data: lockData } = await supabase.rpc('fn_ext_acct_acquire_qbo_refresh_lock', {
        p_realm_id: realmId,
        p_lock_seconds: 20,
      })

      if (lockData?.already_fresh && lockData.metadata?.qbo_oauth?.access_token) {
        oauth = lockData.metadata.qbo_oauth
      } else if (lockData?.locked) {
        // Another worker holds the refresh mutex; poll briefly for the rotated token
        for (let attempt = 0; attempt < 4; attempt++) {
          await new Promise(resolve => setTimeout(resolve, 500))
          const { data: freshComp } = await supabase
            .from('external_accounting_companies')
            .select('metadata')
            .eq('realm_id', realmId)
            .maybeSingle()
          const freshOauth = freshComp?.metadata?.qbo_oauth
          const freshExpMs = freshOauth?.expires_at ? new Date(freshOauth.expires_at).getTime() : 0
          if (freshOauth?.access_token && freshExpMs > Date.now() + 30_000) {
            oauth = freshOauth
            break
          }
        }
      }

      const recheckExpMs = oauth?.expires_at ? new Date(oauth.expires_at).getTime() : 0
      if (recheckExpMs <= Date.now() + 30_000) {
        const latestMeta =
          lockData?.metadata && typeof lockData.metadata === 'object' ? lockData.metadata : meta
        const latestRefreshToken = latestMeta?.qbo_oauth?.refresh_token || oauth.refresh_token
        const client = getAuthClient()
        const authResponse = await client.refreshUsingToken(latestRefreshToken)
        const tokens = authResponse.getJson()
        const newExpiresAt = new Date(Date.now() + Number(tokens.expires_in || 3600) * 1000).toISOString()
        const nowIso = new Date().toISOString()

        oauth = {
          ...(latestMeta?.qbo_oauth || oauth),
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token || latestRefreshToken,
          token_type: tokens.token_type || 'Bearer',
          expires_at: newExpiresAt,
          updated_at: nowIso,
          last_sync_error: null,
        }

        const { data: currCompAfter } = await supabase
          .from('external_accounting_companies')
          .select('metadata')
          .eq('realm_id', realmId)
          .maybeSingle()
        const baseMetaAfter =
          currCompAfter?.metadata && typeof currCompAfter.metadata === 'object'
            ? currCompAfter.metadata
            : latestMeta
        const { qbo_refresh_lock_until: _dropLock, ...cleanMetaAfter } = baseMetaAfter as Record<string, any>

        await supabase
          .from('external_accounting_companies')
          .update({ metadata: { ...cleanMetaAfter, qbo_oauth: oauth }, updated_at: nowIso })
          .eq('realm_id', realmId)

        await supabase.from('integrations').upsert(
          {
            service_name: `quickbooks_ext_${realmId}`,
            realm_id: realmId,
            access_token: oauth.access_token,
            refresh_token: oauth.refresh_token,
            token_type: oauth.token_type,
            expires_at: newExpiresAt,
            updated_at: nowIso,
          },
          { onConflict: 'service_name' }
        )
      }
    } catch (refreshErr: any) {
      const errMsg = refreshErr?.message || 'Error refreshing QBO token'
      // Re-read latest metadata BEFORE writing error so we NEVER clobber tokens rotated by a concurrent worker
      const { data: latestComp } = await supabase
        .from('external_accounting_companies')
        .select('metadata')
        .eq('realm_id', realmId)
        .maybeSingle()
      const latestMetaObj =
        latestComp?.metadata && typeof latestComp.metadata === 'object' ? latestComp.metadata : meta
      const latestOauthObj = latestMetaObj?.qbo_oauth || oauth
      const latestExpMs = latestOauthObj?.expires_at ? new Date(latestOauthObj.expires_at).getTime() : 0
      if (latestOauthObj?.access_token && latestExpMs > Date.now() + 60_000) {
        oauth = latestOauthObj
      } else {
        const { qbo_refresh_lock_until: _dropLockOnErr, ...cleanErrMeta } = latestMetaObj as Record<string, any>
        await supabase
          .from('external_accounting_companies')
          .update({
            metadata: {
              ...cleanErrMeta,
              qbo_oauth: { ...latestOauthObj, last_sync_error: errMsg },
            },
          })
          .eq('realm_id', realmId)

        return {
          connected: false,
          syncEnabled,
          realmId,
          lastSyncedAt: latestOauthObj?.last_synced_at,
          lastSyncError: `Token QBO expirado o revocado: ${errMsg}`,
        }
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
function isQboNotFoundError(errMsg?: string | null): boolean {
  return /object not found|\b610\b|does not exist|entity not found/i.test(String(errMsg || ''))
}

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
  },
  options?: { alreadyDeletedInQbo?: boolean }
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

  const nextPending = options?.alreadyDeletedInQbo
    ? pendingList.filter((p: any) => `${p.kind}:${p.entityType}:${p.qbId}` !== key)
    : existsInPending
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
    await queuePendingQboDelete(
      supabase,
      realmId,
      {
        kind: 'ACCOUNT',
        entityType: 'Account',
        endpoint: 'account',
        qbId: String(accountRow.qb_account_id),
        operation: 'DEACTIVATE',
        label: accountRow.name,
      },
      { alreadyDeletedInQbo: delRes.ok || isQboNotFoundError(delRes.error) }
    )
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
    await queuePendingQboDelete(
      supabase,
      realmId,
      {
        kind: 'CONTACT',
        entityType: cType,
        endpoint,
        qbId: String(contactRow.qb_contact_id),
        operation: 'DEACTIVATE',
        label: contactRow.display_name,
      },
      { alreadyDeletedInQbo: delRes.ok || isQboNotFoundError(delRes.error) }
    )
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
    await queuePendingQboDelete(
      supabase,
      realmId,
      {
        kind: 'LIST_ITEM',
        entityType: cfg.entityType,
        endpoint: cfg.endpoint,
        qbId: rawId,
        operation: 'DEACTIVATE',
        label: itemPayload.Name || rawId,
      },
      { alreadyDeletedInQbo: delRes.ok || isQboNotFoundError(delRes.error) }
    )
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
    const qboLines = lines
      .map((l: any) => ({
        Amount: Number(Number(l.amount || totalAmt).toFixed(2)),
        LinkedTxn: l.linked_txn_id && !isLocalId(l.linked_txn_id)
          ? [{ TxnId: String(l.linked_txn_id), TxnType: l.linked_txn_type || 'Bill' }]
          : [],
      }))
      .filter((ql: any) => ql.LinkedTxn.length > 0)
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
      if (l.account_qb_id && !isLocalId(l.account_qb_id)) {
        salesDetail.ItemAccountRef = { value: String(l.account_qb_id), name: l.account_name || undefined }
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
    const qboLines = lines
      .map((l: any) => ({
        Amount: Number(Number(l.amount || totalAmt).toFixed(2)),
        LinkedTxn: l.linked_txn_id && !isLocalId(l.linked_txn_id)
          ? [{ TxnId: String(l.linked_txn_id), TxnType: l.linked_txn_type || 'Invoice' }]
          : [],
      }))
      .filter((ql: any) => ql.LinkedTxn.length > 0)
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

  // Rebuild payload after resolving any LOCAL-C-* or LOCAL-ACC-* references
  const { payload: resolvedPayload } = buildQboTransactionPayload(workingTxn)
  Object.assign(payload, resolvedPayload)

  // 4. Handle DELETE in QBO
  if (operation === 'DELETE') {
    const getRes = await qboV3Request(supabase, realmId, 'GET', `${endpoint}/${workingTxn.qb_txn_id}`)
    const syncToken = getRes.data?.[entityName]?.SyncToken ?? workingTxn.raw_data?.SyncToken ?? '0'
    const delRes = await qboV3Request(supabase, realmId, 'POST', `${endpoint}?operation=delete`, {
      Id: String(workingTxn.qb_txn_id),
      SyncToken: String(syncToken),
    })
    const alreadyGone = delRes.ok || isQboNotFoundError(delRes.error) || isQboNotFoundError(getRes.error)
    await queuePendingQboDelete(
      supabase,
      realmId,
      {
        kind: 'TRANSACTION',
        entityType: entityName,
        endpoint,
        qbId: String(workingTxn.qb_txn_id),
        operation: 'DELETE',
        label: `${workingTxn.txn_type || entityName} #${workingTxn.doc_number || workingTxn.qb_txn_id}`,
      },
      { alreadyDeletedInQbo: alreadyGone }
    )
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
      const remoteObj = getRes.data[entityName]
      const preservedKeys = [
        'SalesTermRef',
        'BillEmail',
        'BillAddr',
        'ShipAddr',
        'CustomerMemo',
        'CustomField',
        'ClassRef',
        'DepartmentRef',
        'CurrencyRef',
        'ExchangeRate',
        'ApplyTaxAfterDiscount',
        'GlobalTaxCalculation',
        'AllowIPNPayment',
        'AllowOnlinePayment',
        'AllowOnlineCreditCardPayment',
        'AllowOnlineACHPayment',
      ]
      for (const k of preservedKeys) {
        if (payload[k] === undefined && remoteObj[k] !== undefined) {
          payload[k] = remoteObj[k]
        }
      }
      if (
        payload.TxnTaxDetail === undefined &&
        remoteObj.TxnTaxDetail !== undefined &&
        Math.abs(Number(remoteObj.TotalAmt ?? 0) - Number(workingTxn.total_amount ?? 0)) < 0.01
      ) {
        payload.TxnTaxDetail = remoteObj.TxnTaxDetail
      }
      payload.Id = String(remoteObj.Id)
      payload.SyncToken = String(remoteObj.SyncToken || '0')
      payload.sparse = true
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

  const localLines = Array.isArray(workingTxn.line_items) ? workingTxn.line_items : []
  let salesIdx = 0
  const mergedQboLines = Array.isArray(qboEntity.Line)
    ? qboEntity.Line.map((ql: any) => {
        if (ql?.DetailType === 'SalesItemLineDetail') {
          const localLine = localLines[salesIdx++]
          if (localLine?.account_qb_id) {
            return {
              ...ql,
              SalesItemLineDetail: {
                ...(ql.SalesItemLineDetail || {}),
                ItemAccountRef: {
                  value: String(localLine.account_qb_id),
                  name: localLine.account_name || ql.SalesItemLineDetail?.ItemAccountRef?.name || undefined,
                },
              },
            }
          }
        }
        return ql
      })
    : qboEntity.Line

  await supabase
    .from('external_accounting_transactions')
    .update({
      qb_entity_type: entityName,
      qb_txn_id: realQbTxnId,
      entity_qb_id: workingTxn.entity_qb_id,
      account_qb_id: workingTxn.account_qb_id,
      raw_data: {
        ...qboEntity,
        ...(Array.isArray(mergedQboLines) ? { Line: mergedQboLines } : {}),
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

export interface PaginatedQboPullResult {
  ok: boolean
  status: 'complete' | 'incomplete' | 'truncated'
  entityName: string
  items: any[]
  pagesFetched: number
  truncated: boolean
  truncationCeiling?: number
  nextCursor?: number
  failedPage?: number
  cursor?: number
  error?: string
}

export type CustomQboQueryRunner = (
  realmId: string,
  query: string,
  page: number,
  startPosition: number
) => Promise<{ ok: boolean; status: number; data?: any; error?: string }>

/**
 * Consulta paginada endurecida contra Intuit QuickBooks V3 Query API (`STARTPOSITION` / `MAXRESULTS`).
 * - NUNCA ignora ni devuelve éxito parcial silencioso si falla una página (`status: 'incomplete'`, `failedPage`, `cursor`).
 * - NUNCA trunca sin visibilidad: si alcanza `maxPages` con página llena, reporta `truncated: true`, `truncationCeiling` y `nextCursor`.
 */
export async function fetchAllQboEntitiesPaginatedDetailed(
  supabase: SupabaseClient,
  realmId: string,
  entityName: string,
  options?: {
    whereClause?: string
    orderByClause?: string
    pageSize?: number
    maxPages?: number
    queryRunner?: CustomQboQueryRunner
  }
): Promise<PaginatedQboPullResult> {
  const pageSize = Math.min(Math.max(options?.pageSize ?? 500, 1), 1000)
  const maxPages = Math.max(options?.maxPages ?? 25, 1)
  const allItems: any[] = []
  let startPosition = 1
  let pagesFetched = 0
  let truncated = false
  let truncationCeiling: number | undefined
  let nextCursor: number | undefined

  for (let page = 0; page < maxPages; page++) {
    let query = `SELECT * FROM ${entityName}`
    if (options?.whereClause) {
      query += ` WHERE ${options.whereClause}`
    }
    if (options?.orderByClause) {
      query += ` ORDERBY ${options.orderByClause}`
    }
    query += ` STARTPOSITION ${startPosition} MAXRESULTS ${pageSize}`

    const res = options?.queryRunner
      ? await options.queryRunner(realmId, query, page + 1, startPosition)
      : await qboV3Request(supabase, realmId, 'GET', `query?query=${encodeURIComponent(query)}`)

    if (!res.ok) {
      return {
        ok: false,
        status: 'incomplete',
        entityName,
        items: allItems,
        pagesFetched,
        truncated: false,
        failedPage: page + 1,
        cursor: startPosition,
        error:
          res.error ||
          `Error en paginación QBO para entidad ${entityName} en página ${page + 1} (STARTPOSITION ${startPosition})`,
      }
    }

    pagesFetched = page + 1
    const batch = res.data?.QueryResponse?.[entityName]
    if (!Array.isArray(batch) || batch.length === 0) break

    allItems.push(...batch)
    if (batch.length < pageSize) break

    startPosition += batch.length
    if (page + 1 === maxPages) {
      truncated = true
      truncationCeiling = maxPages * pageSize
      nextCursor = startPosition
    }
  }

  return {
    ok: true,
    status: truncated ? 'truncated' : 'complete',
    entityName,
    items: allItems,
    pagesFetched,
    truncated,
    truncationCeiling,
    nextCursor,
  }
}

/**
 * Wrapper retrocompatible que devuelve el arreglo de entidades pero lanza excepción explícita
 * si alguna página falla, evitando truncamientos silenciosos.
 */
export async function fetchAllQboEntitiesPaginated(
  supabase: SupabaseClient,
  realmId: string,
  entityName: string,
  options?: {
    whereClause?: string
    orderByClause?: string
    pageSize?: number
    maxPages?: number
    queryRunner?: CustomQboQueryRunner
  }
): Promise<any[]> {
  const res = await fetchAllQboEntitiesPaginatedDetailed(supabase, realmId, entityName, options)
  if (!res.ok) {
    throw new Error(
      `[QBO Pull Incomplete] entity=${res.entityName} page=${res.failedPage} cursor=${res.cursor}: ${res.error}`
    )
  }
  return res.items
}

export interface OutboxExecutionResult {
  synced: boolean
  qbEntityId?: string | null
  status?: string
  error?: string | null
}

export type OutboxCustomExecutor = (entry: Record<string, any>) => Promise<OutboxExecutionResult>

/**
 * Procesa una única fila del Outbox QBO (`external_accounting_sync_outbox`) respetando:
 * - Contrato unificado (`attempts`, `max_attempts`, `next_retry_at`, `status`, `last_error`, `synced_at`).
 * - Idempotencia estricta: si la fila o su `idempotency_key` ya está `SYNCED`, no vuelve a mutar QBO.
 * - Empresas `qbo_sync_enabled = false`: marca `SKIPPED_LOCAL_ONLY` y jamás llama a QBO.
 * - Backoff exponencial en `next_retry_at` cuando ocurre un error, sin perder jamás la operación.
 */
export async function processSingleOutboxEntry(
  supabase: SupabaseClient,
  realmIdOrOutboxId: string,
  outboxIdOrOptions?:
    | string
    | {
        customExecutor?: OutboxCustomExecutor
        baseBackoffSeconds?: number
        forceNow?: boolean
        alreadyClaimed?: boolean
      },
  maybeOptions?: {
    customExecutor?: OutboxCustomExecutor
    baseBackoffSeconds?: number
    forceNow?: boolean
    alreadyClaimed?: boolean
  }
): Promise<{
  id: string
  status:
    | 'SYNCED'
    | 'FAILED'
    | 'SKIPPED_LOCAL_ONLY'
    | 'ALREADY_SYNCED'
    | 'ALREADY_PROCESSING'
    | 'MAX_ATTEMPTS_EXCEEDED'
    | 'NOT_DUE_YET'
  attempts: number
  maxAttempts: number
  qbEntityId: string | null
  qbId: string | null
  lastError: string | null
  error: string | null
  nextRetryAt: string | null
  syncedAt: string | null
  remoteCalled: boolean
  alreadyIdempotent: boolean
}> {
  const isTwoArgForm = typeof outboxIdOrOptions !== 'string'
  const outboxId = isTwoArgForm ? realmIdOrOutboxId : outboxIdOrOptions
  const explicitRealmId = isTwoArgForm ? null : realmIdOrOutboxId
  const options = isTwoArgForm ? outboxIdOrOptions : maybeOptions

  let loadQuery = supabase
    .from('external_accounting_sync_outbox')
    .select('*')
    .eq('id', outboxId)
  if (explicitRealmId) {
    loadQuery = loadQuery.eq('company_realm_id', explicitRealmId)
  }
  const { data: ob, error: loadErr } = await loadQuery.maybeSingle()

  if (loadErr || !ob) {
    throw new Error(`Outbox entry ${outboxId} not found${explicitRealmId ? ` in company ${explicitRealmId}` : ''}`)
  }
  const realmId = String(ob.company_realm_id)

  const currentAttempts = Number(ob.attempts ?? 0)
  const maxAttempts = Number(ob.max_attempts ?? 5)

  // 1. Idempotency check on the row itself
  if (ob.status === 'SYNCED') {
    const qId = ob.qb_entity_id || null
    return {
      id: ob.id,
      status: 'ALREADY_SYNCED',
      attempts: currentAttempts,
      maxAttempts,
      qbEntityId: qId,
      qbId: qId,
      lastError: null,
      error: null,
      nextRetryAt: ob.next_retry_at || null,
      syncedAt: ob.synced_at || null,
      remoteCalled: false,
      alreadyIdempotent: true,
    }
  }

  if (ob.status === 'SKIPPED_LOCAL_ONLY') {
    const qId = ob.qb_entity_id || null
    return {
      id: ob.id,
      status: 'SKIPPED_LOCAL_ONLY',
      attempts: currentAttempts,
      maxAttempts,
      qbEntityId: qId,
      qbId: qId,
      lastError: null,
      error: null,
      nextRetryAt: null,
      syncedAt: null,
      remoteCalled: false,
      alreadyIdempotent: false,
    }
  }

  // 2. Check if another entry with the same idempotency_key already succeeded
  if (ob.idempotency_key) {
    const { data: dupSynced } = await supabase
      .from('external_accounting_sync_outbox')
      .select('id, qb_entity_id, synced_at')
      .eq('company_realm_id', realmId)
      .eq('idempotency_key', ob.idempotency_key)
      .eq('status', 'SYNCED')
      .neq('id', ob.id)
      .limit(1)
      .maybeSingle()

    if (dupSynced) {
      const nowIso = new Date().toISOString()
      const qId = dupSynced.qb_entity_id || ob.qb_entity_id || null
      await supabase
        .from('external_accounting_sync_outbox')
        .update({
          status: 'SYNCED',
          qb_entity_id: qId,
          last_error: null,
          synced_at: dupSynced.synced_at || nowIso,
          updated_at: nowIso,
        })
        .eq('id', ob.id)
      return {
        id: ob.id,
        status: 'ALREADY_SYNCED',
        attempts: currentAttempts,
        maxAttempts,
        qbEntityId: qId,
        qbId: qId,
        lastError: null,
        error: null,
        nextRetryAt: null,
        syncedAt: dupSynced.synced_at || nowIso,
        remoteCalled: false,
        alreadyIdempotent: true,
      }
    }
  }

  const isLocalStorageCleanupTask =
    ob.entity_kind === 'ATTACHMENT' && ob.operation === 'STORAGE_CLEANUP'

  // 3. Check company qbo_sync_enabled flag BEFORE any remote call (except local Storage cleanup compensation tasks)
  const { data: compRow } = await supabase
    .from('external_accounting_companies')
    .select('metadata')
    .eq('realm_id', realmId)
    .maybeSingle()

  if (!isLocalStorageCleanupTask && compRow?.metadata?.qbo_sync_enabled === false) {
    const nowIso = new Date().toISOString()
    const qId = ob.qb_entity_id || null
    await supabase
      .from('external_accounting_sync_outbox')
      .update({
        status: 'SKIPPED_LOCAL_ONLY',
        last_error: null,
        updated_at: nowIso,
      })
      .eq('id', ob.id)
    return {
      id: ob.id,
      status: 'SKIPPED_LOCAL_ONLY',
      attempts: currentAttempts,
      maxAttempts,
      qbEntityId: qId,
      qbId: qId,
      lastError: null,
      error: null,
      nextRetryAt: null,
      syncedAt: null,
      remoteCalled: false,
      alreadyIdempotent: false,
    }
  }

  // 4. Respect max_attempts
  if (currentAttempts >= maxAttempts) {
    const qId = ob.qb_entity_id || null
    const errStr = ob.last_error || 'Max attempts reached'
    return {
      id: ob.id,
      status: 'MAX_ATTEMPTS_EXCEEDED',
      attempts: currentAttempts,
      maxAttempts,
      qbEntityId: qId,
      qbId: qId,
      lastError: errStr,
      error: errStr,
      nextRetryAt: ob.next_retry_at || null,
      syncedAt: null,
      remoteCalled: false,
      alreadyIdempotent: false,
    }
  }

  // 5. Respect next_retry_at <= NOW() unless forceNow is set
  if (!options?.forceNow && ob.next_retry_at) {
    const retryMs = new Date(ob.next_retry_at).getTime()
    if (Number.isFinite(retryMs) && retryMs > Date.now() + 50) {
      const qId = ob.qb_entity_id || null
      return {
        id: ob.id,
        status: 'NOT_DUE_YET',
        attempts: currentAttempts,
        maxAttempts,
        qbEntityId: qId,
        qbId: qId,
        lastError: ob.last_error || null,
        error: ob.last_error || null,
        nextRetryAt: ob.next_retry_at,
        syncedAt: null,
        remoteCalled: false,
        alreadyIdempotent: false,
      }
    }
  }

  // 6. Atomic Compare-And-Swap claim when invoked directly (prevents concurrent HTTP + Cron double-CREATE in QBO)
  if (!options?.alreadyClaimed) {
    const updatedMs = ob.updated_at ? new Date(ob.updated_at).getTime() : 0
    if (ob.status === 'PROCESSING' && updatedMs > Date.now() - 5 * 60 * 1000) {
      const qId = ob.qb_entity_id || null
      return {
        id: ob.id,
        status: 'ALREADY_PROCESSING',
        attempts: currentAttempts,
        maxAttempts,
        qbEntityId: qId,
        qbId: qId,
        lastError: null,
        error: null,
        nextRetryAt: ob.next_retry_at || null,
        syncedAt: null,
        remoteCalled: false,
        alreadyIdempotent: true,
      }
    }

    const { data: claimedRow } = await supabase
      .from('external_accounting_sync_outbox')
      .update({ status: 'PROCESSING', updated_at: new Date().toISOString() })
      .eq('id', ob.id)
      .in('status', ['PENDING', 'FAILED', 'PROCESSING'])
      .select('id')
      .maybeSingle()

    if (!claimedRow) {
      const qId = ob.qb_entity_id || null
      return {
        id: ob.id,
        status: 'ALREADY_PROCESSING',
        attempts: currentAttempts,
        maxAttempts,
        qbEntityId: qId,
        qbId: qId,
        lastError: null,
        error: null,
        nextRetryAt: ob.next_retry_at || null,
        syncedAt: null,
        remoteCalled: false,
        alreadyIdempotent: true,
      }
    }
  }

  let execRes: OutboxExecutionResult
  if (options?.customExecutor) {
    execRes = await options.customExecutor(ob)
  } else if (ob.entity_kind === 'TRANSACTION') {
    let txnPayload = ob.payload
    if (ob.local_entity_id && ob.operation !== 'DELETE') {
      const { data: dbTxn } = await supabase
        .from('external_accounting_transactions')
        .select('*')
        .eq('id', ob.local_entity_id)
        .eq('company_realm_id', realmId)
        .maybeSingle()
      if (dbTxn) txnPayload = dbTxn
    }
    const op = ob.operation === 'DELETE' ? 'DELETE' : ob.operation === 'VOID' ? 'VOID' : 'UPSERT'
    const pushRes = await pushTransactionToQbo(supabase, realmId, txnPayload, op)
    execRes = {
      synced: pushRes.synced,
      qbEntityId: pushRes.qbTxnId || ob.qb_entity_id || null,
      status: pushRes.status,
      error: pushRes.error || null,
    }
  } else if (ob.entity_kind === 'ACCOUNT') {
    let accPayload = ob.payload
    if (ob.local_entity_id && ob.operation !== 'DELETE') {
      const { data: dbAcc } = await supabase
        .from('external_accounting_accounts')
        .select('*')
        .eq('id', ob.local_entity_id)
        .eq('company_realm_id', realmId)
        .maybeSingle()
      if (dbAcc) accPayload = dbAcc
    }
    const op = ob.operation === 'DELETE' || ob.operation === 'DEACTIVATE' ? 'DELETE' : 'UPSERT'
    const pushRes = await pushAccountToQbo(supabase, realmId, accPayload, op)
    execRes = {
      synced: pushRes.synced,
      qbEntityId: pushRes.qbAccountId || ob.qb_entity_id || null,
      status: pushRes.status,
      error: pushRes.error || null,
    }
  } else if (ob.entity_kind === 'CONTACT') {
    let conPayload = ob.payload
    if (ob.local_entity_id && ob.operation !== 'DELETE') {
      const { data: dbCon } = await supabase
        .from('external_accounting_contacts')
        .select('*')
        .eq('id', ob.local_entity_id)
        .eq('company_realm_id', realmId)
        .maybeSingle()
      if (dbCon) conPayload = dbCon
    }
    const op = ob.operation === 'DELETE' || ob.operation === 'DEACTIVATE' ? 'DELETE' : 'UPSERT'
    const pushRes = await pushContactToQbo(supabase, realmId, conPayload, op)
    execRes = {
      synced: pushRes.synced,
      qbEntityId: pushRes.qbContactId || ob.qb_entity_id || null,
      status: pushRes.status,
      error: pushRes.error || null,
    }
  } else if (ob.entity_kind === 'LIST_ITEM') {
    const listKey = String(ob.entity_type || ob.payload?.listKey || 'items')
    const op = ob.operation === 'DELETE' || ob.operation === 'DEACTIVATE' ? 'DEACTIVATE' : 'UPSERT'
    const pushRes = await pushListItemToQbo(supabase, realmId, listKey, ob.payload || {}, op)
    if (pushRes.status === 'LOCAL_ONLY_LIST') {
      const nowIso = new Date().toISOString()
      const qId = ob.qb_entity_id || null
      await supabase
        .from('external_accounting_sync_outbox')
        .update({
          status: 'SKIPPED_LOCAL_ONLY',
          last_error: null,
          updated_at: nowIso,
        })
        .eq('id', ob.id)
      return {
        id: ob.id,
        status: 'SKIPPED_LOCAL_ONLY',
        attempts: currentAttempts,
        maxAttempts,
        qbEntityId: qId,
        qbId: qId,
        lastError: null,
        error: null,
        nextRetryAt: null,
        syncedAt: null,
        remoteCalled: false,
        alreadyIdempotent: false,
      }
    }
    execRes = {
      synced: pushRes.synced,
      qbEntityId: pushRes.qbId || ob.qb_entity_id || null,
      status: pushRes.status,
      error: pushRes.error || null,
    }
  } else if (isLocalStorageCleanupTask) {
    const storageBucket = String(ob.payload?.storage_bucket || 'external-accounting-attachments')
    const storagePath = String(ob.payload?.storage_path || '')
    if (!storagePath) {
      execRes = {
        synced: false,
        qbEntityId: ob.qb_entity_id || null,
        status: 'INVALID_STORAGE_PATH',
        error: 'Missing storage_path in STORAGE_CLEANUP payload',
      }
    } else {
      const { error: rmErr } = await supabase.storage.from(storageBucket).remove([storagePath])
      if (rmErr) {
        execRes = {
          synced: false,
          qbEntityId: ob.qb_entity_id || null,
          status: 'STORAGE_REMOVE_FAILED',
          error: rmErr.message || 'Failed to remove orphaned file from Supabase Storage',
        }
      } else {
        await supabase.from('external_accounting_audit_log').insert({
          company_realm_id: realmId,
          user_id: 'SYSTEM',
          user_name: ob.created_by || 'Outbox Compensation Worker',
          user_email: null,
          action_type: 'ATTACHMENT_STORAGE_CLEANUP_COMPLETED',
          entity_type: 'AttachmentStorageCleanup',
          entity_id: ob.local_entity_id ? String(ob.local_entity_id) : ob.id,
          summary: `Completó limpieza física diferida en Supabase Storage ("${storagePath}") desde tarea de compensación ${ob.id}`,
          details: {
            outbox_id: ob.id,
            storage_bucket: storageBucket,
            storage_path: storagePath,
          },
        })
        execRes = {
          synced: true,
          qbEntityId: ob.qb_entity_id || null,
          status: 'SYNCED',
          error: null,
        }
      }
    }
  } else {
    // RECURRING & ATTACHMENT local-first metadata sync when QBO endpoint is not invoked directly
    const auth = await getExternalCompanyQboAuth(supabase, realmId)
    if (!auth.connected || !auth.syncEnabled) {
      execRes = {
        synced: false,
        qbEntityId: ob.qb_entity_id || null,
        status: !auth.connected ? 'NOT_CONNECTED' : 'SYNC_DISABLED',
        error: !auth.connected ? 'NOT_CONNECTED' : 'SYNC_DISABLED',
      }
    } else {
      execRes = {
        synced: true,
        qbEntityId: ob.qb_entity_id || null,
        status: 'SYNCED',
        error: null,
      }
    }
  }

  const nextAttempts = currentAttempts + 1
  const nowIso = new Date().toISOString()

  if (execRes.synced) {
    const finalQbId = execRes.qbEntityId || ob.qb_entity_id || null
    await supabase
      .from('external_accounting_sync_outbox')
      .update({
        status: 'SYNCED',
        qb_entity_id: finalQbId,
        attempts: nextAttempts,
        last_error: null,
        synced_at: nowIso,
        updated_at: nowIso,
      })
      .eq('id', ob.id)

    return {
      id: ob.id,
      status: 'SYNCED',
      attempts: nextAttempts,
      maxAttempts,
      qbEntityId: finalQbId,
      qbId: finalQbId,
      lastError: null,
      error: null,
      nextRetryAt: ob.next_retry_at || nowIso,
      syncedAt: nowIso,
      remoteCalled: true,
      alreadyIdempotent: false,
    }
  }

  // Failed: compute exponential backoff and preserve operation in FAILED state
  const baseBackoff = options?.baseBackoffSeconds !== undefined ? options.baseBackoffSeconds : 30
  const backoffSec = Math.min(3600, Math.max(0, baseBackoff * Math.pow(2, nextAttempts - 1)))
  const nextRetryIso = new Date(Date.now() + backoffSec * 1000).toISOString()
  const errMsg = execRes.error || 'Error sincronizando operación con QuickBooks Online'
  const qId = execRes.qbEntityId || ob.qb_entity_id || null

  await supabase
    .from('external_accounting_sync_outbox')
    .update({
      status: 'FAILED',
      qb_entity_id: qId,
      attempts: nextAttempts,
      last_error: errMsg,
      next_retry_at: nextRetryIso,
      synced_at: null,
      updated_at: nowIso,
    })
    .eq('id', ob.id)

  return {
    id: ob.id,
    status: 'FAILED',
    attempts: nextAttempts,
    maxAttempts,
    qbEntityId: qId,
    qbId: qId,
    lastError: errMsg,
    error: errMsg,
    nextRetryAt: nextRetryIso,
    syncedAt: null,
    remoteCalled: true,
    alreadyIdempotent: false,
  }
}

/**
 * Worker del Outbox QBO:
 * - Consulta únicamente filas `PENDING` o `FAILED` cuyo `next_retry_at <= NOW()`.
 * - Respeta `attempts < max_attempts`.
 * - Incrementa `attempts`, calcula backoff exponencial en `next_retry_at`, registra `last_error` y jamás pierde una operación.
 */
export async function processPendingQboOutbox(
  supabase: SupabaseClient,
  realmIdOrOptions?:
    | string
    | {
        realmId?: string
        limit?: number
        outboxIds?: string[]
        customExecutor?: OutboxCustomExecutor
        baseBackoffSeconds?: number
        forceNow?: boolean
      },
  maybeOptions?: {
    limit?: number
    outboxIds?: string[]
    customExecutor?: OutboxCustomExecutor
    baseBackoffSeconds?: number
    forceNow?: boolean
  }
): Promise<{
  processedCount: number
  syncedCount: number
  failedCount: number
  skippedCount: number
  results: Array<Awaited<ReturnType<typeof processSingleOutboxEntry>>>
}> {
  const isOptionsObj = typeof realmIdOrOptions === 'object' && realmIdOrOptions !== null
  const realmId = isOptionsObj ? realmIdOrOptions.realmId : realmIdOrOptions
  const options = isOptionsObj ? realmIdOrOptions : maybeOptions

  const MAX_OUTBOX_WORKER_BATCH_LIMIT = 100
  const rawLimit = Number(options?.limit ?? 50)
  const effectiveLimit =
    Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(Math.floor(rawLimit), MAX_OUTBOX_WORKER_BATCH_LIMIT)
      : 50

  let eligible: any[] = []
  let claimedViaRpc = false

  if (options?.outboxIds && options.outboxIds.length > 0) {
    const nowIso = new Date().toISOString()
    let query = supabase
      .from('external_accounting_sync_outbox')
      .select('*')
      .in('status', ['PENDING', 'FAILED'])
      .in('id', options.outboxIds)
      .order('created_at', { ascending: true })

    if (realmId) {
      query = query.eq('company_realm_id', realmId)
    }
    if (!options?.forceNow) {
      query = query.lte('next_retry_at', nowIso)
    }

    const { data: candidates, error } = await query
    if (error) {
      throw new Error(`Outbox worker query failed: ${error.message}`)
    }
    eligible = (candidates || [])
      .filter((row: any) => Number(row.attempts ?? 0) < Number(row.max_attempts ?? 5))
      .slice(0, effectiveLimit)
  } else {
    const { data: claimedRows, error: claimErr } = await supabase.rpc('fn_ext_acct_claim_pending_qbo_outbox', {
      p_realm_id: realmId || null,
      p_limit: effectiveLimit,
      p_force_now: Boolean(options?.forceNow),
    })
    if (claimErr) {
      throw new Error(`Outbox atomic claim failed: ${claimErr.message}`)
    }
    eligible = Array.isArray(claimedRows) ? claimedRows : []
    claimedViaRpc = true
  }

  let syncedCount = 0
  let failedCount = 0
  let skippedCount = 0
  const results: Array<Awaited<ReturnType<typeof processSingleOutboxEntry>>> = []

  for (const row of eligible) {
    const res = await processSingleOutboxEntry(supabase, String(row.company_realm_id), row.id, {
      customExecutor: options?.customExecutor,
      baseBackoffSeconds: options?.baseBackoffSeconds,
      forceNow: options?.forceNow,
      alreadyClaimed: claimedViaRpc,
    })
    results.push(res)
    if (res.status === 'SYNCED' || res.status === 'ALREADY_SYNCED') syncedCount++
    else if (res.status === 'FAILED') failedCount++
    else skippedCount++
  }

  return {
    processedCount: eligible.length,
    syncedCount,
    failedCount,
    skippedCount,
    results,
  }
}

/**
 * Ejecuta una sincronización bidireccional completa (Push de pendientes locales + Pull paginado de QBO V3) para la empresa activa.
 * Si cualquier página de cualquier entidad falla, aborta y devuelve `ok: false, status: 'incomplete'` con `failedEntity`, `failedPage` y `cursor`.
 */
export async function syncCompanyWithQbo(
  supabase: SupabaseClient,
  realmId: string,
  options?: {
    incrementalSince?: string
    fullHistory?: boolean
    queryRunner?: CustomQboQueryRunner
    maxPagesOverride?: number
  }
): Promise<{
  ok: boolean
  status?: 'complete' | 'incomplete' | 'completed_with_truncation_warning' | 'skipped_local_only'
  pushedTransactions: number
  pushedAccounts: number
  pushedContacts: number
  pulledAccounts: number
  pulledContacts: number
  pulledTransactions: number
  pulledLists?: number
  failedEntity?: string
  failedPage?: number
  cursor?: number
  truncated?: boolean
  truncatedEntities?: Array<{ entityName: string; fetchedCount: number; ceiling?: number; nextCursor?: number }>
  error?: string
}> {
  const { data: compCheck } = await supabase
    .from('external_accounting_companies')
    .select('metadata')
    .eq('realm_id', realmId)
    .maybeSingle()

  if (compCheck?.metadata?.qbo_sync_enabled === false) {
    return {
      ok: false,
      status: 'skipped_local_only',
      pushedTransactions: 0,
      pushedAccounts: 0,
      pushedContacts: 0,
      pulledAccounts: 0,
      pulledContacts: 0,
      pulledTransactions: 0,
      error: 'Esta empresa está configurada en modo autónomo local (qbo_sync_enabled=false). No se realiza conexión a QuickBooks Online.',
    }
  }

  const auth = options?.queryRunner
    ? { connected: true, syncEnabled: true, lastSyncError: null }
    : await getExternalCompanyQboAuth(supabase, realmId)
  if (!auth.connected) {
    return {
      ok: false,
      status: 'incomplete',
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
  const truncatedEntities: Array<{ entityName: string; fetchedCount: number; ceiling?: number; nextCursor?: number }> = []

  const recordIncompletePullFailure = async (pageRes: PaginatedQboPullResult) => {
    const meta = compCheck?.metadata && typeof compCheck.metadata === 'object' ? compCheck.metadata : {}
    await supabase
      .from('external_accounting_companies')
      .update({
        metadata: {
          ...meta,
          qbo_oauth: {
            ...(meta.qbo_oauth || {}),
            last_sync_status: 'incomplete',
            last_sync_error: pageRes.error,
            failed_entity: pageRes.entityName,
            failed_page: pageRes.failedPage,
            failed_cursor: pageRes.cursor,
            last_attempt_at: new Date().toISOString(),
          },
        },
        updated_at: new Date().toISOString(),
      })
      .eq('realm_id', realmId)

    return {
      ok: false,
      status: 'incomplete' as const,
      pushedTransactions,
      pushedAccounts,
      pushedContacts,
      pulledAccounts,
      pulledContacts,
      pulledTransactions,
      failedEntity: pageRes.entityName,
      failedPage: pageRes.failedPage,
      cursor: pageRes.cursor,
      error: pageRes.error,
    }
  }

  // ---------------------------------------------------------------------------
  // PHASE 1: PUSH LOCAL PENDING ACCOUNTS, CONTACTS, TRANSACTIONS & DELETES TO QBO
  // ---------------------------------------------------------------------------
  const preMeta = compCheck?.metadata && typeof compCheck.metadata === 'object' ? compCheck.metadata : {}
  const pendingDeletes: any[] = Array.isArray(preMeta.pending_qbo_deletes) ? preMeta.pending_qbo_deletes : []
  const deletedArchive: any[] = Array.isArray(preMeta.deleted_qbo_ids) ? preMeta.deleted_qbo_ids : []
  const remainingPendingDeletes: any[] = []

  if (!options?.queryRunner) {
    for (const delItem of pendingDeletes) {
      if (!delItem?.qbId || isLocalId(delItem.qbId)) continue
      const endpoint = String(delItem.endpoint || '').toLowerCase()
      const entityType = String(delItem.entityType || '')
      if (!endpoint || !entityType) continue

      const getRes = await qboV3Request(supabase, realmId, 'GET', `${endpoint}/${delItem.qbId}`)
      if (!getRes.ok && isQboNotFoundError(getRes.error)) {
        // Already deleted in QBO — drop from pending queue
        continue
      }
      const syncToken = getRes.data?.[entityType]?.SyncToken ?? '0'

      if (delItem.kind === 'TRANSACTION') {
        const opQuery = delItem.operation === 'VOID' ? 'void' : 'delete'
        const delRes = await qboV3Request(supabase, realmId, 'POST', `${endpoint}?operation=${opQuery}`, {
          Id: String(delItem.qbId),
          SyncToken: String(syncToken),
          ...(opQuery === 'void' ? { sparse: true } : {}),
        })
        if (delRes.ok || isQboNotFoundError(delRes.error)) {
          pushedTransactions++
        } else {
          remainingPendingDeletes.push(delItem)
        }
      } else {
        const currentObj = getRes.data?.[entityType] || {}
        if (currentObj.Active === false) {
          continue
        }
        const deactPayload: Record<string, any> = {
          ...currentObj,
          Id: String(delItem.qbId),
          SyncToken: String(syncToken),
          Active: false,
          sparse: true,
        }
        const deactRes = await qboV3Request(supabase, realmId, 'POST', endpoint, deactPayload)
        if (deactRes.ok || isQboNotFoundError(deactRes.error)) {
          if (delItem.kind === 'ACCOUNT') pushedAccounts++
          if (delItem.kind === 'CONTACT') pushedContacts++
        } else {
          remainingPendingDeletes.push(delItem)
        }
      }
    }

    // 1b. Process pending/failed retryable entries in external_accounting_sync_outbox via unified worker
    const outboxWorkerRes = await processPendingQboOutbox(supabase, realmId, { limit: 100 })
    pushedTransactions += outboxWorkerRes.syncedCount
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

  // ---------------------------------------------------------------------------
  // PHASE 2: PULL ACCOUNTS, CONTACTS, LISTS, ATTACHABLES & TRANSACTIONS FROM QBO V3
  // ---------------------------------------------------------------------------
  let pulledLists = 0

  // 2a. Pull Accounts with pagination
  const accountsPageRes = await fetchAllQboEntitiesPaginatedDetailed(supabase, realmId, 'Account', {
    whereClause: 'Active IN (true, false)',
    pageSize: 500,
    maxPages: options?.maxPagesOverride ?? 10,
    queryRunner: options?.queryRunner,
  })
  if (!accountsPageRes.ok) return recordIncompletePullFailure(accountsPageRes)
  if (accountsPageRes.truncated) {
    truncatedEntities.push({
      entityName: 'Account',
      fetchedCount: accountsPageRes.items.length,
      ceiling: accountsPageRes.truncationCeiling,
      nextCursor: accountsPageRes.nextCursor,
    })
  }

  const rawAccounts = accountsPageRes.items.filter(
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

  // 2b. Pull Vendors, Customers & Employees with pagination (excluding locally deleted contacts)
  for (const cType of ['Vendor', 'Customer', 'Employee'] as const) {
    const contactsPageRes = await fetchAllQboEntitiesPaginatedDetailed(supabase, realmId, cType, {
      whereClause: 'Active IN (true, false)',
      pageSize: 500,
      maxPages: options?.maxPagesOverride ?? 10,
      queryRunner: options?.queryRunner,
    })
    if (!contactsPageRes.ok) return recordIncompletePullFailure(contactsPageRes)
    if (contactsPageRes.truncated) {
      truncatedEntities.push({
        entityName: cType,
        fetchedCount: contactsPageRes.items.length,
        ceiling: contactsPageRes.truncationCeiling,
        nextCursor: contactsPageRes.nextCursor,
      })
    }
    const rawContacts = contactsPageRes.items.filter(
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

  // 2b-ii. Pull Complete QBO Lists (Item, Category, Class, Department, PaymentMethod, Term)
  const itemsPageRes = await fetchAllQboEntitiesPaginatedDetailed(supabase, realmId, 'Item', {
    whereClause: 'Active IN (true, false)',
    pageSize: 500,
    maxPages: options?.maxPagesOverride ?? 10,
    queryRunner: options?.queryRunner,
  })
  if (!itemsPageRes.ok) return recordIncompletePullFailure(itemsPageRes)
  if (itemsPageRes.truncated) {
    truncatedEntities.push({
      entityName: 'Item',
      fetchedCount: itemsPageRes.items.length,
      ceiling: itemsPageRes.truncationCeiling,
      nextCursor: itemsPageRes.nextCursor,
    })
  }
  const rawItemsAll = itemsPageRes.items
  if (rawItemsAll.length > 0) {
    const categoryItems = rawItemsAll.filter((it: any) => it.Type === 'Category')
    const productServiceItems = rawItemsAll.filter((it: any) => it.Type !== 'Category')
    if (categoryItems.length > 0) {
      const catRows = categoryItems.map((cat: any) => ({
        company_realm_id: realmId,
        qb_category_id: String(cat.Id),
        name: cat.Name || 'Unnamed Category',
        fully_qualified_name: cat.FullyQualifiedName || cat.Name || '',
        parent_qb_id: cat.ParentRef?.value ? String(cat.ParentRef.value) : null,
        is_sub_category: Boolean(cat.SubItem),
        is_active: cat.Active !== false,
        raw_data: cat,
        updated_at: new Date().toISOString(),
      }))
      await supabase
        .from('external_accounting_categories')
        .upsert(catRows, { onConflict: 'company_realm_id,qb_category_id' })
      pulledLists += catRows.length
    }
    if (productServiceItems.length > 0) {
      const itemRows = productServiceItems.map((it: any) => ({
        company_realm_id: realmId,
        qb_item_id: String(it.Id),
        name: it.Name || 'Unnamed Item',
        fully_qualified_name: it.FullyQualifiedName || it.Name || '',
        sku: it.Sku || null,
        item_type: it.Type || 'Service',
        category_qb_id: it.ParentRef?.value ? String(it.ParentRef.value) : null,
        category_name: it.ParentRef?.name || null,
        description: it.Description || null,
        unit_price: Number(it.UnitPrice ?? 0),
        income_account_qb_id: it.IncomeAccountRef?.value ? String(it.IncomeAccountRef.value) : null,
        income_account_name: it.IncomeAccountRef?.name || null,
        purchase_desc: it.PurchaseDesc || null,
        purchase_cost: Number(it.PurchaseCost ?? 0),
        expense_account_qb_id: it.ExpenseAccountRef?.value ? String(it.ExpenseAccountRef.value) : null,
        expense_account_name: it.ExpenseAccountRef?.name || null,
        asset_account_qb_id: it.AssetAccountRef?.value ? String(it.AssetAccountRef.value) : null,
        asset_account_name: it.AssetAccountRef?.name || null,
        track_qty_on_hand: Boolean(it.TrackQtyOnHand),
        qty_on_hand: Number(it.QtyOnHand ?? 0),
        taxable: Boolean(it.Taxable),
        is_active: it.Active !== false,
        raw_data: it,
        updated_at: new Date().toISOString(),
      }))
      await supabase
        .from('external_accounting_items')
        .upsert(itemRows, { onConflict: 'company_realm_id,qb_item_id' })
      pulledLists += itemRows.length
    }
  }

  const classesPageRes = await fetchAllQboEntitiesPaginatedDetailed(supabase, realmId, 'Class', {
    whereClause: 'Active IN (true, false)',
    pageSize: 500,
    maxPages: options?.maxPagesOverride ?? 5,
    queryRunner: options?.queryRunner,
  })
  if (!classesPageRes.ok) return recordIncompletePullFailure(classesPageRes)
  if (classesPageRes.truncated) {
    truncatedEntities.push({
      entityName: 'Class',
      fetchedCount: classesPageRes.items.length,
      ceiling: classesPageRes.truncationCeiling,
      nextCursor: classesPageRes.nextCursor,
    })
  }
  const rawClasses = classesPageRes.items
  if (rawClasses.length > 0) {
    const classRows = rawClasses.map((cl: any) => ({
      company_realm_id: realmId,
      qb_class_id: String(cl.Id),
      name: cl.Name || 'Unnamed Class',
      fully_qualified_name: cl.FullyQualifiedName || cl.Name || '',
      parent_qb_id: cl.ParentRef?.value ? String(cl.ParentRef.value) : null,
      is_sub_class: Boolean(cl.SubClass),
      is_active: cl.Active !== false,
      raw_data: cl,
      updated_at: new Date().toISOString(),
    }))
    await supabase
      .from('external_accounting_classes')
      .upsert(classRows, { onConflict: 'company_realm_id,qb_class_id' })
    pulledLists += classRows.length
  }

  const deptsPageRes = await fetchAllQboEntitiesPaginatedDetailed(supabase, realmId, 'Department', {
    whereClause: 'Active IN (true, false)',
    pageSize: 500,
    maxPages: options?.maxPagesOverride ?? 5,
    queryRunner: options?.queryRunner,
  })
  if (!deptsPageRes.ok) return recordIncompletePullFailure(deptsPageRes)
  if (deptsPageRes.truncated) {
    truncatedEntities.push({
      entityName: 'Department',
      fetchedCount: deptsPageRes.items.length,
      ceiling: deptsPageRes.truncationCeiling,
      nextCursor: deptsPageRes.nextCursor,
    })
  }
  const rawDepts = deptsPageRes.items
  if (rawDepts.length > 0) {
    const locRows = rawDepts.map((dp: any) => ({
      company_realm_id: realmId,
      qb_location_id: String(dp.Id),
      name: dp.Name || 'Unnamed Location',
      fully_qualified_name: dp.FullyQualifiedName || dp.Name || '',
      parent_qb_id: dp.ParentRef?.value ? String(dp.ParentRef.value) : null,
      is_sub_location: Boolean(dp.SubDepartment),
      is_active: dp.Active !== false,
      raw_data: dp,
      updated_at: new Date().toISOString(),
    }))
    await supabase
      .from('external_accounting_locations')
      .upsert(locRows, { onConflict: 'company_realm_id,qb_location_id' })
    pulledLists += locRows.length
  }

  const pmPageRes = await fetchAllQboEntitiesPaginatedDetailed(supabase, realmId, 'PaymentMethod', {
    whereClause: 'Active IN (true, false)',
    pageSize: 500,
    maxPages: options?.maxPagesOverride ?? 5,
    queryRunner: options?.queryRunner,
  })
  if (!pmPageRes.ok) return recordIncompletePullFailure(pmPageRes)
  if (pmPageRes.truncated) {
    truncatedEntities.push({
      entityName: 'PaymentMethod',
      fetchedCount: pmPageRes.items.length,
      ceiling: pmPageRes.truncationCeiling,
      nextCursor: pmPageRes.nextCursor,
    })
  }
  const rawPaymentMethods = pmPageRes.items
  if (rawPaymentMethods.length > 0) {
    const pmRows = rawPaymentMethods.map((pm: any) => ({
      company_realm_id: realmId,
      qb_payment_method_id: String(pm.Id),
      name: pm.Name || 'Payment Method',
      method_type: pm.Type || 'NON_CREDIT_CARD',
      is_active: pm.Active !== false,
      raw_data: pm,
      updated_at: new Date().toISOString(),
    }))
    await supabase
      .from('external_accounting_payment_methods')
      .upsert(pmRows, { onConflict: 'company_realm_id,qb_payment_method_id' })
    pulledLists += pmRows.length
  }

  const termsPageRes = await fetchAllQboEntitiesPaginatedDetailed(supabase, realmId, 'Term', {
    whereClause: 'Active IN (true, false)',
    pageSize: 500,
    maxPages: options?.maxPagesOverride ?? 5,
    queryRunner: options?.queryRunner,
  })
  if (!termsPageRes.ok) return recordIncompletePullFailure(termsPageRes)
  if (termsPageRes.truncated) {
    truncatedEntities.push({
      entityName: 'Term',
      fetchedCount: termsPageRes.items.length,
      ceiling: termsPageRes.truncationCeiling,
      nextCursor: termsPageRes.nextCursor,
    })
  }
  const rawTerms = termsPageRes.items
  if (rawTerms.length > 0) {
    const termRows = rawTerms.map((tm: any) => ({
      company_realm_id: realmId,
      qb_term_id: String(tm.Id),
      name: tm.Name || 'Term',
      term_type: tm.Type || 'STANDARD',
      due_days: Number(tm.DueDays ?? 30),
      discount_percent: Number(tm.DiscountPercent ?? 0),
      discount_days: Number(tm.DiscountDays ?? 0),
      is_active: tm.Active !== false,
      raw_data: tm,
      updated_at: new Date().toISOString(),
    }))
    await supabase
      .from('external_accounting_terms')
      .upsert(termRows, { onConflict: 'company_realm_id,qb_term_id' })
    pulledLists += termRows.length
  }

  // 2c. Pull Transactions across all 14 QBO Transaction Entity Types (paginated)
  const pulledTxnRows: any[] = []
  const pullEntities = [
    'Purchase',
    'Deposit',
    'JournalEntry',
    'Transfer',
    'Bill',
    'BillPayment',
    'Invoice',
    'Payment',
    'CreditMemo',
    'VendorCredit',
    'SalesReceipt',
    'RefundReceipt',
    'Estimate',
    'PurchaseOrder',
  ] as const

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

  // Phase A: download paginated pages of every entity (supporting incrementalSince or full paginated pull)
  const fetchedByEnt: Record<string, any[]> = {}
  const whereClause = options?.incrementalSince
    ? `MetaData.LastUpdatedTime >= '${options.incrementalSince}'`
    : undefined
  for (const ent of pullEntities) {
    const entPageRes = await fetchAllQboEntitiesPaginatedDetailed(supabase, realmId, ent, {
      whereClause,
      orderByClause: 'MetaData.LastUpdatedTime DESC',
      pageSize: 500,
      maxPages: options?.maxPagesOverride ?? (options?.fullHistory ? 25 : 5),
      queryRunner: options?.queryRunner,
    })
    if (!entPageRes.ok) return recordIncompletePullFailure(entPageRes)
    if (entPageRes.truncated) {
      truncatedEntities.push({
        entityName: ent,
        fetchedCount: entPageRes.items.length,
        ceiling: entPageRes.truncationCeiling,
        nextCursor: entPageRes.nextCursor,
      })
    }
    fetchedByEnt[ent] = entPageRes.items.filter(
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
        const isCreditPurchase = Boolean(item.Credit)
        const txnType = isCreditPurchase
          ? 'CreditCardCredit'
          : pType === 'Check'
          ? 'Check'
          : pType === 'CreditCard'
          ? 'CreditCardExpense'
          : 'Expense'
        const isVoided = Boolean(item.PrivateNote && /void/i.test(item.PrivateNote)) && Number(item.TotalAmt ?? 0) === 0
        pulledTxnRows.push({
          company_realm_id: realmId,
          txn_type: txnType,
          qb_entity_type: 'Purchase',
          qb_txn_id: String(item.Id),
          txn_date: item.TxnDate,
          doc_number: item.DocNumber || null,
          payment_type: pType,
          direction: isCreditPurchase ? 'IN' : 'OUT',
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
      } else if (ent === 'CreditMemo' || ent === 'SalesReceipt' || ent === 'RefundReceipt' || ent === 'Estimate') {
        const arId = item.ARAccountRef?.value ? String(item.ARAccountRef.value) : defaultArAcc?.id || null
        const arName = item.ARAccountRef?.name || (arId ? accNameById.get(arId) : null) || defaultArAcc?.name || 'Accounts Receivable (A/R)'
        const depId = item.DepositToAccountRef?.value ? String(item.DepositToAccountRef.value) : null
        const depName = item.DepositToAccountRef?.name || (depId ? accNameById.get(depId) : null) || null
        const headerAccId = (ent === 'SalesReceipt' || ent === 'RefundReceipt') ? (depId || undepositedFunds?.id || arId) : arId
        const headerAccName = (ent === 'SalesReceipt' || ent === 'RefundReceipt') ? (depName || undepositedFunds?.name || arName) : arName
        pulledTxnRows.push({
          company_realm_id: realmId,
          txn_type: ent,
          qb_entity_type: ent,
          qb_txn_id: String(item.Id),
          txn_date: item.TxnDate,
          due_date: item.DueDate || item.TxnDate || null,
          doc_number: item.DocNumber || null,
          payment_type: item.PaymentMethodRef?.name || ent,
          direction: ent === 'SalesReceipt' ? 'IN' : ent === 'RefundReceipt' ? 'OUT' : ent === 'Estimate' ? 'NON_POSTING' : 'ACCRUAL',
          account_qb_id: headerAccId,
          account_name: headerAccName,
          to_account_qb_id: lineItems[0]?.account_qb_id || null,
          to_account_name: lineItems[0]?.account_name || lineItems[0]?.item_name || null,
          entity_qb_id: item.CustomerRef?.value ? String(item.CustomerRef.value) : null,
          entity_name: item.CustomerRef?.name || null,
          entity_type: 'Customer',
          total_amount: Number(item.TotalAmt ?? 0),
          open_balance: ent === 'CreditMemo' ? Number(item.RemainingCredit ?? item.Balance ?? 0) : Number(item.Balance ?? 0),
          memo: item.PrivateNote || item.CustomerMemo?.value || lineItems.map((l: any) => l.description).filter(Boolean).join('; ') || null,
          category_summary: categorySummary || lineItems[0]?.item_name || ent,
          print_status: item.PrintStatus || 'NotSet',
          cleared_status: 'Cleared',
          is_voided: false,
          line_items: lineItems,
          raw_data: syncedRaw,
          updated_at: new Date().toISOString(),
        })
      } else if (ent === 'VendorCredit' || ent === 'PurchaseOrder') {
        const apId = item.APAccountRef?.value ? String(item.APAccountRef.value) : defaultApAcc?.id || null
        const apName = item.APAccountRef?.name || (apId ? accNameById.get(apId) : null) || defaultApAcc?.name || 'Accounts Payable (A/P)'
        pulledTxnRows.push({
          company_realm_id: realmId,
          txn_type: ent,
          qb_entity_type: ent,
          qb_txn_id: String(item.Id),
          txn_date: item.TxnDate,
          due_date: item.DueDate || item.TxnDate || null,
          doc_number: item.DocNumber || null,
          payment_type: ent,
          direction: ent === 'PurchaseOrder' ? 'NON_POSTING' : 'ACCRUAL',
          account_qb_id: ent === 'PurchaseOrder' ? null : apId,
          account_name: ent === 'PurchaseOrder' ? null : apName,
          to_account_qb_id: lineItems[0]?.account_qb_id || null,
          to_account_name: lineItems[0]?.account_name || null,
          entity_qb_id: item.VendorRef?.value ? String(item.VendorRef.value) : null,
          entity_name: item.VendorRef?.name || null,
          entity_type: 'Vendor',
          total_amount: Number(item.TotalAmt ?? 0),
          open_balance: Number(item.Balance ?? 0),
          memo: item.PrivateNote || lineItems.map((l: any) => l.description).filter(Boolean).join('; ') || null,
          category_summary: categorySummary || ent,
          print_status: 'NotSet',
          cleared_status: 'Cleared',
          is_voided: false,
          line_items: lineItems,
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
    // Preserve local cleared_status ('Reconciled' / 'Uncleared' / 'Voided') and detect QBO-voided transactions
    const existingStateMap = new Map<string, { cleared_status: string | null; is_voided: boolean }>()
    let stateOffset = 0
    while (true) {
      const { data: statePage, error: stateErr } = await supabase
        .from('external_accounting_transactions')
        .select('qb_entity_type, qb_txn_id, cleared_status, is_voided')
        .eq('company_realm_id', realmId)
        .order('id', { ascending: true })
        .range(stateOffset, stateOffset + 999)
      if (stateErr || !statePage || statePage.length === 0) break
      for (const st of statePage) {
        existingStateMap.set(`${st.qb_entity_type}:${st.qb_txn_id}`, {
          cleared_status: st.cleared_status,
          is_voided: Boolean(st.is_voided),
        })
      }
      if (statePage.length < 1000) break
      stateOffset += 1000
    }

    for (const pRow of pulledTxnRows) {
      const key = `${pRow.qb_entity_type}:${pRow.qb_txn_id}`
      const prev = existingStateMap.get(key)
      const noteText = String(pRow.raw_data?.PrivateNote || pRow.memo || '')
      const isQboVoided =
        (/\bvoided\b/i.test(noteText) && Number(pRow.total_amount || 0) === 0) ||
        Boolean(prev?.is_voided)
      if (isQboVoided) {
        pRow.is_voided = true
        pRow.cleared_status = 'Voided'
      } else if (prev?.cleared_status) {
        pRow.cleared_status = prev.cleared_status
      }
    }

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

  // 2d. Pull QBO Attachables AFTER transactions & contacts are upserted so FK trigger resolves transaction_id and contact_id UUIDs
  const attPageRes = await fetchAllQboEntitiesPaginatedDetailed(supabase, realmId, 'Attachable', {
    orderByClause: 'MetaData.LastUpdatedTime DESC',
    pageSize: 500,
    maxPages: options?.maxPagesOverride ?? 5,
    queryRunner: options?.queryRunner,
  })
  if (!attPageRes.ok) {
    return await recordIncompletePullFailure(attPageRes)
  }
  if (attPageRes.truncated) {
    truncatedEntities.push({
      entityName: 'Attachable',
      fetchedCount: attPageRes.items.length,
      ceiling: attPageRes.truncationCeiling,
      nextCursor: attPageRes.nextCursor,
    })
  }
  const rawAttachables = attPageRes.items
  if (rawAttachables.length > 0) {
    const attRows: any[] = []
    for (const att of rawAttachables) {
      const firstRef = Array.isArray(att.AttachableRef) ? att.AttachableRef[0]?.EntityRef : null
      const refType = firstRef?.type ? String(firstRef.type) : null
      const refId = firstRef?.value ? String(firstRef.value) : null
      const isContactRef = refType === 'Customer' || refType === 'Vendor' || refType === 'Employee'
      const rawFileName = String(att.FileName || att.Note || `Attachment-${att.Id}`)
      const contentType = String(att.ContentType || 'application/octet-stream')
      let fileSize = Number(att.Size ?? 0)
      let storageBucket: string | null = null
      let storagePath: string | null = null
      let sha256Hash: string | null = null
      let fileUrl: string | null = att.TempDownloadUri || att.FileAccessUri || null

      if (att.TempDownloadUri && (fileSize === 0 || fileSize <= MAX_QBO_ATTACHMENT_BYTES)) {
        try {
          const dlRes = await fetch(String(att.TempDownloadUri))
          if (dlRes.ok) {
            const arrBuf = await dlRes.arrayBuffer()
            const binBuf = Buffer.from(arrBuf)
            if (binBuf.byteLength > 0 && binBuf.byteLength <= MAX_QBO_ATTACHMENT_BYTES) {
              fileSize = binBuf.byteLength
              sha256Hash = crypto.createHash('sha256').update(binBuf).digest('hex')
              const safeName = rawFileName
                .replace(/[^a-zA-Z0-9._-]+/g, '_')
                .replace(/^_+|_+$/g, '')
                .slice(0, 120) || 'attachment.bin'
              const pathInBucket = `${realmId}/qbo_${String(att.Id)}_${sha256Hash.slice(0, 12)}_${safeName}`
              const { error: upErr } = await supabase.storage
                .from(QBO_ATTACHMENT_BUCKET)
                .upload(pathInBucket, binBuf, {
                  contentType,
                  upsert: true,
                })
              if (!upErr) {
                storageBucket = QBO_ATTACHMENT_BUCKET
                storagePath = pathInBucket
                const { data: signedData } = await supabase.storage
                  .from(QBO_ATTACHMENT_BUCKET)
                  .createSignedUrl(pathInBucket, 60 * 60 * 24 * 7)
                if (signedData?.signedUrl) {
                  fileUrl = signedData.signedUrl
                }
              }
            }
          }
        } catch {
          // Keep metadata even if QBO temporary URI has expired or failed network fetch
        }
      }

      attRows.push({
        company_realm_id: realmId,
        qb_attachable_id: String(att.Id),
        file_name: rawFileName,
        content_type: contentType,
        file_size: fileSize,
        size_bytes: fileSize,
        storage_bucket: storageBucket,
        storage_path: storagePath,
        sha256_hash: sha256Hash,
        file_url: fileUrl,
        linked_entity_type: refType,
        linked_entity_id: refId,
        qb_txn_id: !isContactRef && refId ? refId : null,
        qb_contact_id: isContactRef && refId ? refId : null,
        note: att.Note || null,
        raw_data: att,
        updated_at: new Date().toISOString(),
      })
    }
    await supabase
      .from('external_accounting_attachments')
      .upsert(attRows, { onConflict: 'company_realm_id,qb_attachable_id' })
    pulledLists += attRows.length
  }

  // Update last_synced_at in company metadata
  const { data: compRow } = await supabase
    .from('external_accounting_companies')
    .select('metadata')
    .eq('realm_id', realmId)
    .maybeSingle()
  const meta = compRow?.metadata && typeof compRow.metadata === 'object' ? compRow.metadata : {}
  const syncFinalStatus =
    truncatedEntities.length > 0 ? 'completed_with_truncation_warning' : 'complete'
  const updatedMeta = {
    ...meta,
    pending_qbo_deletes: remainingPendingDeletes,
    qbo_oauth: {
      ...(meta.qbo_oauth || {}),
      last_synced_at: new Date().toISOString(),
      last_sync_error: null,
      last_sync_status: syncFinalStatus,
      last_sync_truncated_entities: truncatedEntities,
      last_sync_incomplete_cursor: null,
    },
  }
  await supabase
    .from('external_accounting_companies')
    .update({ metadata: updatedMeta, updated_at: new Date().toISOString() })
    .eq('realm_id', realmId)

  return {
    ok: true,
    status: syncFinalStatus,
    pushedTransactions,
    pushedAccounts,
    pushedContacts,
    pulledAccounts,
    pulledContacts,
    pulledTransactions,
    pulledLists,
    truncated: truncatedEntities.length > 0,
    truncatedEntities,
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

