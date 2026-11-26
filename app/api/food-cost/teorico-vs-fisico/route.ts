/**
 * @module app/api/food-cost/teorico-vs-fisico
 * @description Endpoint API protegido del Tablero y Reporte Ejecutivo
 *   "Platillos Vendidos & Consumo Teórico (POS) vs. Consumo Físico Real (Sobrantes + Bodega)"
 *   de Tacos Gavilan.
 *
 * @businessRules
 *   - Protegido mediante `verifyStaffAuth` (`allowedRoles: ['admin', 'accounting', 'supervisor', 'manager', 'asistente']`).
 *   - Usuarios con rol local (`manager` / `asistente`) quedan estrictamente acotados a sus sucursales autorizadas
 *     (`userStoreId` / `store_scope` en `public.users`): si piden `'all'` se redirige a su sucursal, y si solicitan
 *     cualquier sucursal ajena se rechaza con `HTTP 403`.
 *   - Aplica deduplicación `single-flight`, semáforo global de concurrencia (`MAX_CONCURRENT_COMPUTES = 2`)
 *     y caché en memoria de 3 minutos para ventanas cerradas (`endDate < todayLA`) y 15 segundos para intradía.
 *   - Valida rango máximo de fechas (`35` días consolidado 15 tiendas / `65` días tienda individual).
 *
 * @dataFlow
 *   `GET /api/food-cost/teorico-vs-fisico?storeId=all&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD`
 *   -> `computeExecutiveTheoreticalVsPhysicalReport()` -> JSON.
 *
 * @notes
 *   - [2026-11-25] Reforzado control RBAC de alcance por tienda (`allowedRoles` explícito y validación contra
 *     `public.users.store_id` / `store_scope` para impedir lectura cruzada `?storeId=X` entre gerentes locales).
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyStaffAuth } from '@/lib/auth-server'
import { getSupabaseAdminClient } from '@/lib/supabase'
import {
  addDaysIso,
  diffCalendarDays,
  getBusinessDateLA,
  isValidIsoDate,
} from '@/lib/inventory/food-cost-sales-resolver'
import {
  computeExecutiveTheoreticalVsPhysicalReport,
  type ExecutiveTheoreticalVsPhysicalReport,
} from '@/lib/inventory/executive-theoretical-vs-physical'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const inFlightRequests = new Map<string, Promise<ExecutiveTheoreticalVsPhysicalReport>>()
const responseWindowCache = new Map<string, { expiresAt: number; data: ExecutiveTheoreticalVsPhysicalReport }>()
const CLOSED_CACHE_TTL_MS = 3 * 60 * 1000
const OPEN_CACHE_TTL_MS = 15 * 1000
const MAX_CACHE_ENTRIES = 24

// Semáforo global para proteger Supabase `ci_small` (2 GB RAM) ante ráfagas de rangos distintos en paralelo
const MAX_CONCURRENT_COMPUTES = 2
const MAX_QUEUED_COMPUTES = 8
let activeComputes = 0
const waitQueue: Array<() => void> = []

async function withComputeSemaphore<T>(fn: () => Promise<T>): Promise<T> {
  if (activeComputes >= MAX_CONCURRENT_COMPUTES) {
    if (waitQueue.length >= MAX_QUEUED_COMPUTES) {
      throw new Error('Server busy processing heavy Food Cost reports. Please retry in a few seconds.')
    }
    await new Promise<void>((resolve) => waitQueue.push(resolve))
  }
  activeComputes++
  try {
    return await fn()
  } finally {
    activeComputes--
    const next = waitQueue.shift()
    if (next) next()
  }
}

function setBoundedCache(key: string, data: ExecutiveTheoreticalVsPhysicalReport, ttlMs: number) {
  if (responseWindowCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = responseWindowCache.keys().next().value
    if (oldestKey !== undefined) responseWindowCache.delete(oldestKey)
  }
  responseWindowCache.set(key, { expiresAt: Date.now() + ttlMs, data })
}

const ALLOWED_TVF_ROLES = [
  'admin',
  'administrador',
  'accounting',
  'contador',
  'supervisor',
  'manager',
  'asistente',
  'assistant',
]

let cachedStoresDirectory: {
  expiresAt: number
  byAnyKey: Map<string, number>
} | null = null

async function getStoresDirectoryMap(): Promise<Map<string, number>> {
  if (cachedStoresDirectory && cachedStoresDirectory.expiresAt > Date.now()) {
    return cachedStoresDirectory.byAnyKey
  }
  const supabase = await getSupabaseAdminClient()
  const { data, error } = await supabase
    .from('stores')
    .select('id, name, code, external_id, is_active')
    .eq('is_active', true)
  if (error) throw new Error(error.message)
  const byAnyKey = new Map<string, number>()
  for (const s of data || []) {
    const idNum = Number(s.id)
    byAnyKey.set(String(idNum), idNum)
    if (s.external_id) byAnyKey.set(String(s.external_id).trim().toLowerCase(), idNum)
    if (s.code) byAnyKey.set(String(s.code).trim().toLowerCase(), idNum)
    if (s.name) byAnyKey.set(String(s.name).trim().toLowerCase(), idNum)
  }
  cachedStoresDirectory = { expiresAt: Date.now() + 5 * 60 * 1000, byAnyKey }
  return byAnyKey
}

async function resolveManagerAllowedStores(
  user: any,
  storeByAnyKey: Map<string, number>
): Promise<number[]> {
  const allowed = new Set<number>()
  const parsedUid = Number(user?.id ?? user?.sub)
  const uid = Number.isFinite(parsedUid) && parsedUid > 0 ? parsedUid : null

  let dbStoreId: unknown = user?.storeId ?? user?.store_id ?? user?.user_metadata?.store_id ?? null
  let dbStoreScope: unknown = user?.storeScope ?? user?.store_scope ?? user?.user_metadata?.store_scope ?? null

  if (uid !== null) {
    const supabase = await getSupabaseAdminClient()
    const { data: uRow } = await supabase
      .from('users')
      .select('store_id, store_scope')
      .eq('id', uid)
      .maybeSingle()
    if (uRow) {
      if (uRow.store_id !== null && uRow.store_id !== undefined) dbStoreId = uRow.store_id
      if (uRow.store_scope !== null && uRow.store_scope !== undefined) dbStoreScope = uRow.store_scope
    }
  }

  if (dbStoreId !== null && dbStoreId !== undefined && String(dbStoreId).trim() !== '') {
    const mapped = storeByAnyKey.get(String(dbStoreId).trim().toLowerCase())
    if (mapped) allowed.add(mapped)
  }
  if (Array.isArray(dbStoreScope)) {
    for (const raw of dbStoreScope) {
      const mapped = storeByAnyKey.get(String(raw ?? '').trim().toLowerCase())
      if (mapped) allowed.add(mapped)
    }
  }
  return Array.from(allowed)
}

export async function GET(request: NextRequest) {
  try {
    const auth = verifyStaffAuth(request, { allowedRoles: ALLOWED_TVF_ROLES, allowCron: true })
    if (!auth.authorized) {
      return auth.response || NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: auth.status || 401 })
    }

    const sp = request.nextUrl.searchParams
    const todayLA = getBusinessDateLA()
    const defaultEnd = addDaysIso(todayLA, -1)
    const defaultStart = addDaysIso(defaultEnd, -6)

    let rawStoreId = (sp.get('storeId') || sp.get('store') || 'all').trim()
    const role = auth.user ? String(auth.user.role || '').toLowerCase().trim() : 'cron'
    const hasChainAccess =
      !auth.user ||
      role === 'admin' ||
      role === 'administrador' ||
      role === 'accounting' ||
      role === 'contador' ||
      role === 'supervisor'

    if (!hasChainAccess) {
      const storeByAnyKey = await getStoresDirectoryMap()
      const allowedStoreIds = await resolveManagerAllowedStores(auth.user, storeByAnyKey)
      if (allowedStoreIds.length === 0) {
        return NextResponse.json(
          { error: 'Acceso denegado: Usuario sin sucursal asignada.' },
          { status: 403 }
        )
      }
      if (!rawStoreId || rawStoreId.toLowerCase() === 'all') {
        rawStoreId = String(allowedStoreIds[0])
      } else {
        const requestedNum = storeByAnyKey.get(rawStoreId.toLowerCase())
        if (!requestedNum) {
          return NextResponse.json({ error: `Store not found: ${rawStoreId}` }, { status: 404 })
        }
        if (!allowedStoreIds.includes(requestedNum)) {
          return NextResponse.json(
            { error: 'Acceso denegado: No tienes permisos sobre la sucursal solicitada.' },
            { status: 403 }
          )
        }
        rawStoreId = String(requestedNum)
      }
    }

    const startDate = (sp.get('startDate') || defaultStart).trim()
    const endDate = (sp.get('endDate') || defaultEnd).trim()
    const reconcileQb = sp.get('reconcileQb') !== '0'

    if (!isValidIsoDate(startDate) || !isValidIsoDate(endDate) || startDate > endDate) {
      return NextResponse.json({ error: 'Invalid date range (YYYY-MM-DD)' }, { status: 400 })
    }

    const spanDays = diffCalendarDays(startDate, endDate) + 1
    const maxDays = rawStoreId.toLowerCase() === 'all' ? 35 : 65
    if (spanDays > maxDays) {
      return NextResponse.json(
        { error: `El rango máximo permitido es de ${maxDays} días (${spanDays} solicitados).` },
        { status: 400 }
      )
    }

    const includeChainBenchmark = hasChainAccess
    const cacheKey = `${rawStoreId.toLowerCase()}|${startDate}|${endDate}|${includeChainBenchmark ? 'chain' : 'local'}`
    const isClosedWindow = endDate < todayLA

    const hit = responseWindowCache.get(cacheKey)
    if (hit && hit.expiresAt > Date.now()) {
      return NextResponse.json(hit.data, {
        headers: {
          'Cache-Control': isClosedWindow ? 'private, max-age=180' : 'no-store, no-cache, must-revalidate',
        },
      })
    }

    let pending = inFlightRequests.get(cacheKey)
    if (!pending) {
      pending = withComputeSemaphore(() =>
        computeExecutiveTheoreticalVsPhysicalReport({
          rawStoreId,
          startDate,
          endDate,
          reconcileQb,
          includeChainBenchmark,
        })
      ).finally(() => {
        inFlightRequests.delete(cacheKey)
      })
      inFlightRequests.set(cacheKey, pending)
    }

    const report = await pending
    setBoundedCache(cacheKey, report, isClosedWindow ? CLOSED_CACHE_TTL_MS : OPEN_CACHE_TTL_MS)

    return NextResponse.json(report, {
      headers: {
        'Cache-Control': isClosedWindow ? 'private, max-age=180' : 'no-store, no-cache, must-revalidate',
      },
    })
  } catch (error: any) {
    console.error('[GET /api/food-cost/teorico-vs-fisico]', error)
    const msg = String(error?.message || 'Internal Server Error')
    const status = /Store not found/i.test(msg) ? 404 : /Server busy/i.test(msg) ? 503 : 500
    return NextResponse.json({ error: msg }, { status })
  }
}
