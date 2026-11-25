/**
 * @module app/api/food-cost/teorico-vs-fisico
 * @description Endpoint API protegido del Tablero y Reporte Ejecutivo
 *   "Platillos Vendidos & Consumo Teórico (POS) vs. Consumo Físico Real (Sobrantes + Bodega)"
 *   de Tacos Gavilan.
 *
 * @businessRules
 *   - Protegido mediante `verifyStaffAuth` (`admin`, `supervisor`, `manager`).
 *   - Si un usuario con rol `manager` no global consulta, restringe automáticamente a su `storeId` asignada
 *     salvo que sea `admin` o `supervisor`.
 *   - Aplica deduplicación `single-flight` y caché en memoria de 60 segundos para ventanas cerradas (`endDate < todayLA`).
 *   - Valida rango máximo de fechas (`35` días consolidado 15 tiendas / `65` días tienda individual).
 *
 * @dataFlow
 *   `GET /api/food-cost/teorico-vs-fisico?storeId=all&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD`
 *   -> `computeExecutiveTheoreticalVsPhysicalReport()` -> JSON.
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyStaffAuth } from '@/lib/auth-server'
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
const closedWindowCache = new Map<string, { expiresAt: number; data: ExecutiveTheoreticalVsPhysicalReport }>()
const CACHE_TTL_MS = 60 * 1000
const MAX_CACHE_ENTRIES = 16

function setBoundedCache(key: string, data: ExecutiveTheoreticalVsPhysicalReport) {
  if (closedWindowCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = closedWindowCache.keys().next().value
    if (oldestKey !== undefined) closedWindowCache.delete(oldestKey)
  }
  closedWindowCache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, data })
}

export async function GET(request: NextRequest) {
  try {
    const auth = verifyStaffAuth(request)
    if (!auth.authorized || !auth.user) {
      return auth.response || NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: auth.status || 401 })
    }

    const sp = request.nextUrl.searchParams
    const todayLA = getBusinessDateLA()
    const defaultEnd = addDaysIso(todayLA, -1)
    const defaultStart = addDaysIso(defaultEnd, -6)

    let rawStoreId = (sp.get('storeId') || sp.get('store') || 'all').trim()
    const role = String(auth.user.role || '').toLowerCase().trim()
    const userStoreId = (auth.user as any)?.storeId ?? (auth.user as any)?.store_id ?? null

    // Si es manager de una sola sucursal y pide 'all', preseleccionar su sucursal si no tiene acceso corporativo
    if (role !== 'admin' && role !== 'supervisor' && userStoreId && rawStoreId.toLowerCase() === 'all') {
      rawStoreId = String(userStoreId)
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

    const cacheKey = `${rawStoreId.toLowerCase()}|${startDate}|${endDate}`
    const isClosedWindow = endDate < todayLA

    if (isClosedWindow) {
      const hit = closedWindowCache.get(cacheKey)
      if (hit && hit.expiresAt > Date.now()) {
        return NextResponse.json(hit.data, {
          headers: { 'Cache-Control': 'private, max-age=60' },
        })
      }
    }

    let pending = inFlightRequests.get(cacheKey)
    if (!pending) {
      pending = computeExecutiveTheoreticalVsPhysicalReport({
        rawStoreId,
        startDate,
        endDate,
        reconcileQb,
      }).finally(() => {
        inFlightRequests.delete(cacheKey)
      })
      inFlightRequests.set(cacheKey, pending)
    }

    const report = await pending
    if (isClosedWindow) {
      setBoundedCache(cacheKey, report)
    }

    return NextResponse.json(report, {
      headers: {
        'Cache-Control': isClosedWindow ? 'private, max-age=60' : 'no-store, no-cache, must-revalidate',
      },
    })
  } catch (error: any) {
    console.error('[GET /api/food-cost/teorico-vs-fisico]', error)
    const msg = String(error?.message || 'Internal Server Error')
    const status = /Store not found/i.test(msg) ? 404 : 500
    return NextResponse.json({ error: msg }, { status })
  }
}
