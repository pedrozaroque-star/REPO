/**
 * @module api/drive-thru/kore/session
 * @description Crea una sesión del simulador "Kore Drive-Thru": autentica al gerente, valida que la sucursal tenga
 * Drive-Thru, carga el menú real (`app_menu_cache`), la Base de Conocimiento y la tasa de impuesto estimada, arma el
 * system prompt + `BidiGenerateContentSetup` de Gemini Live (`gemini-3.8-live`, voz `Kore`) y devuelve un token
 * efímero (ephemeral token) de un solo uso para que el navegador abra el WebSocket constrained directo con Gemini.
 *
 * @businessRules
 * - **Solo roles de liderazgo**: `admin`/`administrador`/`supervisor`/`regional_manager` (las 15 sucursales) y
 *   `manager`/`general_manager`/`gerente` (únicamente su sucursal asignada o `store_scope`). Asistentes, shift leaders
 *   y empleados quedan fuera (403). Guard: `authorizePhoneModuleRequest` (mismo que `/api/phone/simulate`: JWT estricto
 *   sin gracia de expiración + verificación en vivo de `public.users.is_active` y paridad de email).
 * - **Solo sucursales con Drive-Thru** (`stores.has_drive_thru = true`; hoy #3, #6, #10, #12, #14, #15) y activas.
 * - **Simulación**: nada se envía a Toast; el ticket vive en el navegador (`lib/drive-thru-kore-order.ts`).
 * - **Nunca se devuelve la API key**: solo el token efímero `auth_tokens/...` (uses: 1, expira en 20 min y debe abrir
 *   sesión dentro de 60 s). El setup va BLOQUEADO dentro del token (ver @notes de `lib/drive-thru-kore.ts`).
 * - Anti-abuso: máximo 6 sesiones por minuto por usuario (cada token consume una llamada a Gemini).
 *
 * @dataFlow
 * - `POST /api/drive-thru/kore/session` `{ storeId: number (stores.id), lang?: 'es'|'en' }`
 *   -> `authorizePhoneModuleRequest(permission 'simulate')` -> rol permitido -> alcance de tienda
 *   -> `loadKoreStore` -> `loadKoreMenu` + `loadKoreKnowledge` + `getKoreStoreTaxRate` -> `buildKoreSystemPrompt`
 *   -> `buildKoreLiveSetup` -> `createKoreEphemeralToken` -> `{ token, wsUrl, model, setup, menu, store, expiresAt, ... }`.
 *
 * @notes
 * - El navegador debe enviar `{ setup }` como primer mensaje (el protocolo lo exige), aunque Gemini use el setup
 *   bloqueado en el token.
 * - `store.taxIsEstimate` siempre es `true`: la tasa sale de la matriz CDTFA oct-2026, no de Toast.
 */

import { NextRequest, NextResponse } from 'next/server'
import { authorizePhoneModuleRequest } from '@/lib/phone-agent-access'
import { formatCustomerStoreName } from '@/lib/customer-store-names'
import {
  KORE_LIVE_MODEL,
  KORE_SIM_ALLOWED_ROLES,
  KoreTokenError,
  buildKoreLiveSetup,
  buildKoreSystemPrompt,
  buildKoreWsUrl,
  createKoreEphemeralToken,
  getKoreStoreTaxRate,
  loadKoreEbtStoreMatrix,
  loadKoreKnowledge,
  loadKoreMenu,
  loadKoreStore,
  pickKoreDriveThruGreeting,
  prewarmKoreDriverOrdersCache,
  type KoreLang
} from '@/lib/drive-thru-kore'
import { loadActiveKoreLearnedRules } from '@/lib/drive-thru-kore-learning'
import { getInitialGreetingFastClips } from '@/lib/drive-thru-kore-fast-clips'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store, max-age=0' }
const RATE_WINDOW_MS = 60_000
const RATE_MAX_PER_WINDOW = 6
const sessionStartsByUser = new Map<string, number[]>()

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: NO_STORE_HEADERS })
}

function allowRate(userId: string, now = Date.now()): boolean {
  const recent = (sessionStartsByUser.get(userId) || []).filter((t) => now - t < RATE_WINDOW_MS)
  if (recent.length >= RATE_MAX_PER_WINDOW) {
    sessionStartsByUser.set(userId, recent)
    return false
  }
  recent.push(now)
  sessionStartsByUser.set(userId, recent)
  if (sessionStartsByUser.size > 500) {
    for (const [k, v] of sessionStartsByUser) if (!v.some((t) => now - t < RATE_WINDOW_MS)) sessionStartsByUser.delete(k)
  }
  return true
}

export async function POST(request: NextRequest) {
  try {
    const auth = await authorizePhoneModuleRequest(request, { permission: 'simulate' })
    if (!auth.authorized || !auth.user) {
      return auth.response || jsonError(auth.error || 'No autenticado.', auth.status || 401)
    }
    const user = auth.user
    if (!KORE_SIM_ALLOWED_ROLES.has(user.role)) {
      return jsonError(`Acceso denegado: el rol '${user.role}' no puede usar el simulador Kore Drive-Thru.`, 403)
    }

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body)) return jsonError('Cuerpo JSON inválido.', 400)
    const rawStoreId = (body as any).storeId ?? (body as any).store_id
    const storeId = typeof rawStoreId === 'number' ? rawStoreId : /^\d+$/.test(String(rawStoreId ?? '').trim()) ? Number(rawStoreId) : NaN
    if (!Number.isInteger(storeId) || storeId <= 0) return jsonError('storeId inválido (usa stores.id numérico).', 400)
    const rawLang = (body as any).lang
    if (rawLang !== undefined && rawLang !== null && rawLang !== 'es' && rawLang !== 'en') {
      return jsonError("lang inválido (usa 'es' o 'en').", 400)
    }
    const lang: KoreLang = rawLang === 'en' ? 'en' : 'es'

    if (!user.isGlobalAdmin && !user.allowedStoreIds.includes(storeId)) {
      return jsonError(`Acceso denegado: tu cuenta solo tiene autorización sobre la sucursal #${user.assignedStoreId}.`, 403)
    }
    if (!allowRate(user.id)) return jsonError('Demasiadas sesiones seguidas. Espera un minuto e intenta de nuevo.', 429)

    const store = await loadKoreStore(storeId)
    if (!store || !store.isActive) return jsonError('Sucursal no encontrada o inactiva.', 404)
    if (!store.hasDriveThru) return jsonError('Esta sucursal no tiene Drive-Thru; el simulador Kore solo aplica a tiendas con Drive-Thru.', 422)

    // Precalienta en background la cola de Blindaje Delivery para que `driver-lookup` responda en milisegundos
    prewarmKoreDriverOrdersCache(store.id)

    const pickedGreeting = pickKoreDriveThruGreeting(store.id, lang)

    const [menu, knowledge, tax, learnedRules, ebtMatrix, initialGreetingClips] = await Promise.all([
      loadKoreMenu(store.id),
      loadKoreKnowledge(store.id),
      getKoreStoreTaxRate(store),
      loadActiveKoreLearnedRules(store.id),
      loadKoreEbtStoreMatrix(),
      getInitialGreetingFastClips(store.id, pickedGreeting.index, 650)
    ])
    if (menu.length === 0) return jsonError('El menú en línea de esta sucursal no está disponible en este momento.', 503)

    const systemText = buildKoreSystemPrompt({
      storeId: store.id,
      lang,
      menu,
      knowledge,
      taxRatePct: tax.taxRatePct,
      learnedRules,
      acceptsEbt: store.acceptsEbt,
      city: store.city,
      ebtMatrixSummary: ebtMatrix,
      greetingVariantIndex: pickedGreeting.index
    })
    const setup = buildKoreLiveSetup(systemText)
    const tok = await createKoreEphemeralToken(setup)

    return NextResponse.json(
      {
        simulation: true,
        token: tok.token,
        wsUrl: buildKoreWsUrl(tok.token),
        model: KORE_LIVE_MODEL,
        setup,
        menu,
        lang,
        initialGreetingClips,
        store: {
          id: store.id,
          internalName: store.name,
          city: store.city,
          acceptsEbt: store.acceptsEbt,
          customerName: formatCustomerStoreName(store.id, lang, { style: 'display' }),
          customerNameEs: formatCustomerStoreName(store.id, 'es', { style: 'display' }),
          customerNameEn: formatCustomerStoreName(store.id, 'en', { style: 'display' }),
          taxRatePct: tax.taxRatePct,
          taxIsEstimate: tax.taxIsEstimate,
          taxSource: tax.taxSource,
          observedTaxRatePct: tax.observedTaxRatePct
        },
        expiresAt: tok.expiresAt,
        newSessionExpiresAt: tok.newSessionExpiresAt
      },
      { headers: NO_STORE_HEADERS }
    )
  } catch (err: any) {
    if (err instanceof KoreTokenError) return jsonError(err.message, err.status)
    console.error('[Kore DT session] Error:', String(err?.message || err).slice(0, 300))
    return jsonError('Error interno creando la sesión de Kore Drive-Thru.', 500)
  }
}
