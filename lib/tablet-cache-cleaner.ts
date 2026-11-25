/**
 * @module lib/tablet-cache-cleaner
 * @description Motor automático de autolimpieza de caché (`CacheStorage`, `ServiceWorker`, `localStorage`, `sessionStorage`)
 * y renovación silenciosa de sesión JWT (`teg_token`) para tabletas de cocina (`/inventory/preparador`) y pantallas (`/order-ready-board`).
 *
 * @businessRules
 * - Elimina automáticamente llaves históricas acumuladas en `localStorage` (`teg_prep_overrides_*` de días pasados,
 *   `prep_meat_history_*`, `teg_prep_manual_weekly_*`, `prep_real_meat_*`, `prep_intelligence_*` de otras tiendas o días)
 *   para evitar desbordes de cuota (`QuotaExceededError` de 5MB) en tabletas que operan 24/7.
 * - Preserva estrictamente la sesión activa (`teg_token`, `teg_user`) y preferencias operativas (`teg_preparador_store`,
 *   `teg_order_ready_*`, `prep_hide_drinks`, `language`, `theme`).
 * - Limpia programáticamente `window.caches` (`CacheStorage`) y desregistra Service Workers obsoletos sin necesidad de abrir
 *   la configuración del navegador en la tableta.
 * - Re-sincroniza la cookie `teg_token` y renueva silenciosamente el JWT vía `POST /api/auth/refresh` cuando está próximo a vencer
 *   o ya venció su ventana de 7 días.
 *
 * @dataFlow
 * - Invocado automáticamente al montar `/inventory/preparador` y `/order-ready-board`, cada 15 minutos en background,
 *   en el corte de las 6:00 AM (`America/Los_Angeles`), al despertar pantalla (`focus`/`online`/`visibilitychange`) y al pulsar refrescar.
 *
 * @notes
 * - Incluye `safeLocalStorageSet` con recuperación automática ante `QuotaExceededError`.
 * - Fix 2026-11-24: Aísla `teg_tab_staff_token` y `teg_tab_staff_user` en `sessionStorage` por pestaña para que `/inventory/preparador` y `/order-ready-board` jamás pierdan su token Staff si un empleado abre `/mis-horarios` en otra pestaña de la misma PC.
 */

export interface CacheCleanerOptions {
  activeStoreId?: string
  activeDate?: string
  activeDow?: number
  clearBrowserCaches?: boolean
  forceTokenRefresh?: boolean
  force?: boolean
  clearSessionStorage?: boolean
}

let lastAuthRefreshAttemptMs = 0
const AUTH_REFRESH_THROTTLE_MS = 5 * 60 * 1000 // Máximo 1 intento cada 5 minutos

const TAB_STAFF_TOKEN_KEY = 'teg_tab_staff_token'
const TAB_STAFF_USER_KEY = 'teg_tab_staff_user'

function decodeJwtPayloadSafe(token: string | null | undefined): Record<string, any> | null {
  if (!token) return null
  try {
    const parts = token.trim().split('.')
    if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return null
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
    return JSON.parse(atob(padded))
  } catch {
    return null
  }
}

function isStaffJwtToken(token: string | null | undefined): boolean {
  const payload = decodeJwtPayloadSafe(token)
  if (!payload || !payload.sub) return false
  if (payload.user_type === 'employee') return false
  const role = String(payload.user_role || payload.user_metadata?.role || '').trim().toLowerCase()
  return role !== 'employee'
}

function isLocalStorageOccupiedByActiveEmployee(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const rawUser = localStorage.getItem('teg_user')
    const rawToken = localStorage.getItem('teg_token')
    if (!rawUser || !rawToken) return false
    const parsed = JSON.parse(rawUser)
    if (parsed?.user_type !== 'employee' && String(parsed?.role || '').toLowerCase() !== 'employee') {
      return false
    }
    const payload = decodeJwtPayloadSafe(rawToken)
    const expMs = Number(payload?.exp || 0) * 1000
    return expMs > Date.now()
  } catch {
    return false
  }
}

/**
 * Resuelve el token Staff efectivo para la pestaña actual y respalda la sesión Staff en `sessionStorage`.
 * Si un empleado inicia sesión en `/mis-horarios` desde otra pestaña de la PC de la sucursal (sobrescribiendo o borrando
 * `localStorage.teg_token` con un token de 15 min), la pestaña 24/7 (`/order-ready-board` o `/inventory/preparador`)
 * conserva su propio `teg_tab_staff_token` aislado en `sessionStorage` sin caerse jamás.
 */
export function getEffectiveTabletStaffToken(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const lsToken = localStorage.getItem('teg_token')
    const lsUser = localStorage.getItem('teg_user')
    if (lsToken && isStaffJwtToken(lsToken)) {
      try {
        sessionStorage.setItem(TAB_STAFF_TOKEN_KEY, lsToken)
        if (lsUser) sessionStorage.setItem(TAB_STAFF_USER_KEY, lsUser)
      } catch {}
      return lsToken
    }
    const tabToken = sessionStorage.getItem(TAB_STAFF_TOKEN_KEY)
    if (tabToken && isStaffJwtToken(tabToken)) {
      return tabToken
    }
    return lsToken || null
  } catch {
    return null
  }
}

/**
 * Sincroniza la cookie `teg_token` desde `localStorage` / `sessionStorage` y renueva silenciosamente el JWT si venció o vence en < 72h.
 * Si el token ya venció (o es inválido, ej. `g_sso_...`) y `/api/auth/refresh` falla o devuelve 401/403,
 * retorna `null` para que `ProtectedRoute` cierre la sesión zombi y redirija a `/login`.
 */
export async function ensureFreshTabletAuth(force = false): Promise<string | null> {
  if (typeof window === 'undefined') return null
  let isAlreadyExpired = false
  try {
    let token = getEffectiveTabletStaffToken()
    if (!token) return null

    const maxAge = 30 * 24 * 60 * 60
    const secureFlag = window.location.protocol === 'https:' ? '; Secure' : ''
    const employeeInOtherTab = isLocalStorageOccupiedByActiveEmployee()

    // 1. Revisar si el token es un JWT válido y si ya venció o vence dentro de las próximas 72 horas
    let needsRefresh = force
    const payload = decodeJwtPayloadSafe(token)
    if (!payload) {
      isAlreadyExpired = true
      needsRefresh = true
    } else {
      const expMs = (payload?.exp || 0) * 1000
      if (!expMs || Date.now() >= expMs) {
        isAlreadyExpired = true
        needsRefresh = true
      } else if (Date.now() + 72 * 60 * 60 * 1000 >= expMs) {
        needsRefresh = true
      }
    }

    // Solo sincronizar la cookie/localStorage de inmediato si el token actual no está vencido ni hay empleado activo en otra pestaña
    if (!isAlreadyExpired && !employeeInOtherTab) {
      if (!localStorage.getItem('teg_token') && isStaffJwtToken(token)) {
        localStorage.setItem('teg_token', token)
        const tabUser = sessionStorage.getItem(TAB_STAFF_USER_KEY)
        if (tabUser && !localStorage.getItem('teg_user')) {
          localStorage.setItem('teg_user', tabUser)
        }
      }
      document.cookie = `teg_token=${token}; path=/; max-age=${maxAge}; SameSite=Lax${secureFlag}`
    }

    const now = Date.now()
    if (needsRefresh && (force || isAlreadyExpired || now - lastAuthRefreshAttemptMs >= AUTH_REFRESH_THROTTLE_MS)) {
      lastAuthRefreshAttemptMs = now
      const res = await fetch(`/api/auth/refresh?_t=${now}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          Pragma: 'no-cache'
        },
        body: JSON.stringify({ token }),
        cache: 'no-store'
      })

      if (res.ok) {
        const data = await res.json()
        if (data?.success && data?.token) {
          token = data.token as string
          try {
            sessionStorage.setItem(TAB_STAFF_TOKEN_KEY, token)
            if (data.user) {
              sessionStorage.setItem(TAB_STAFF_USER_KEY, JSON.stringify(data.user))
            }
          } catch {}
          if (!isLocalStorageOccupiedByActiveEmployee()) {
            localStorage.setItem('teg_token', token)
            if (data.user) {
              localStorage.setItem('teg_user', JSON.stringify(data.user))
            }
            document.cookie = `teg_token=${token}; path=/; max-age=${maxAge}; SameSite=Lax${secureFlag}`
          }
          return token
        }
      }

      if (res.status === 401 || res.status === 403 || isAlreadyExpired) {
        return null
      }
    }

    return isAlreadyExpired ? null : token
  } catch {
    if (isAlreadyExpired) return null
    return getEffectiveTabletStaffToken()
  }
}

/**
 * Devuelve cabeceras anti-caché + Authorization Bearer con el token Staff efectivo de la pestaña.
 */
export function getTabletNoCacheHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    Pragma: 'no-cache'
  }
  if (typeof window !== 'undefined') {
    try {
      const token = getEffectiveTabletStaffToken()
      if (token && token !== 'null' && token !== 'undefined') {
        headers['Authorization'] = `Bearer ${token}`
      }
    } catch {
      // Ignorar
    }
  }
  return headers
}

/**
 * Limpia automáticamente cachés obsoletos en `localStorage`, `sessionStorage`, `window.caches` y Service Workers
 * sin cerrar la sesión del usuario ni perder la sucursal configurada.
 */
export async function purgeTabletStaleCaches(options: CacheCleanerOptions = {}): Promise<{
  removedLocalStorageKeys: number
  clearedCacheBuckets: number
  unregisteredServiceWorkers: number
}> {
  let removedLocalStorageKeys = 0
  let clearedCacheBuckets = 0
  let unregisteredServiceWorkers = 0

  if (typeof window === 'undefined') {
    return { removedLocalStorageKeys, clearedCacheBuckets, unregisteredServiceWorkers }
  }

  const {
    activeStoreId,
    activeDate,
    activeDow,
    clearBrowserCaches = true,
    forceTokenRefresh = false,
    force = false,
    clearSessionStorage = false
  } = options

  // 1. Limpieza inteligente de localStorage (eliminar basura acumulada de días/tiendas anteriores)
  try {
    const keysToRemove: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key) continue

      // a) Overrides manuales de fechas pasadas: teg_prep_overrides_${storeId}_${date}
      if (key.startsWith('teg_prep_overrides_')) {
        if (!activeDate || !key.endsWith(`_${activeDate}`)) {
          keysToRemove.push(key)
        }
        continue
      }

      // b) Historial pesado de carnes por tienda y día: prep_meat_history_${storeId}_${dow}
      if (key.startsWith('prep_meat_history_')) {
        const expected = activeStoreId && activeDow ? `prep_meat_history_${activeStoreId}_${activeDow}` : null
        if (!expected || key !== expected) {
          keysToRemove.push(key)
        }
        continue
      }

      // c) Horario manual semanal por tienda y día: teg_prep_manual_weekly_${storeId}_${dow}
      if (key.startsWith('teg_prep_manual_weekly_')) {
        const expected = activeStoreId && activeDow ? `teg_prep_manual_weekly_${activeStoreId}_${activeDow}` : null
        if (!expected || key !== expected) {
          keysToRemove.push(key)
        }
        continue
      }

      // d) Consumos reales e inteligencia intradía de otras tiendas
      if (key.startsWith('prep_real_meat_')) {
        const expected = activeStoreId ? `prep_real_meat_${activeStoreId}` : null
        if (!expected || key !== expected) {
          keysToRemove.push(key)
        }
        continue
      }

      if (key.startsWith('prep_intelligence_')) {
        const expected = activeStoreId ? `prep_intelligence_${activeStoreId}` : null
        if (!expected || key !== expected) {
          keysToRemove.push(key)
        }
        continue
      }

      // e) Confirmaciones de galones de champurrado de fechas pasadas: teg_galones_ack_${storeId}_${date}
      if (key.startsWith('teg_galones_ack_')) {
        if (!activeDate || !key.endsWith(`_${activeDate}`)) {
          keysToRemove.push(key)
        }
        continue
      }

      // f) Órdenes KDS anunciadas en Delivery de otras tiendas
      if (key.startsWith('blindaje_kds_announced_')) {
        const expected = activeStoreId ? `blindaje_kds_announced_${activeStoreId}` : null
        if (expected && key !== expected) {
          keysToRemove.push(key)
        }
        continue
      }

      // g) Auditorías confirmadas en Delivery de fechas pasadas: blindaje_sticky_audits_${storeId}_${date}
      if (key.startsWith('blindaje_sticky_audits_')) {
        if (!activeDate || !key.endsWith(`_${activeDate}`)) {
          keysToRemove.push(key)
        }
        continue
      }

      // h) Temporizador Digital TFS4 de Frijoles: preservar SIEMPRE la sucursal activa (incluso en corte 6:00 AM si hay olla en lumbre)
      if (key.startsWith('teg_bean_timer_active_')) {
        const expected = activeStoreId ? `teg_bean_timer_active_${activeStoreId}` : null
        if (expected && key !== expected) {
          keysToRemove.push(key)
        }
        continue
      }
    }

    for (const k of keysToRemove) {
      try {
        localStorage.removeItem(k)
        removedLocalStorageKeys++
      } catch {
        // Ignorar
      }
    }
  } catch {
    // Ignorar errores de acceso a localStorage
  }

  // 2. Limpiar sessionStorage temporal (preservando sesión activa de PIN de Delivery y órdenes anunciadas salvo en rollover 6 AM / Wake Up)
  try {
    const shouldPreserveSessionKey = (sk: string) =>
      sk === TAB_STAFF_TOKEN_KEY ||
      sk === TAB_STAFF_USER_KEY ||
      sk === 'teg_board_audio_unlocked' ||
      sk === 'teg_chunk_recovery_at' ||
      sk === 'teg_update_completed' ||
      (!clearSessionStorage && (sk.startsWith('blindaje_packer_') || sk.startsWith('blindaje_kds_announced_')))

    const sessionKeysToRemove: string[] = []
    for (let i = 0; i < sessionStorage.length; i++) {
      const sk = sessionStorage.key(i)
      if (!sk || shouldPreserveSessionKey(sk)) continue
      sessionKeysToRemove.push(sk)
    }
    for (const sk of sessionKeysToRemove) {
      sessionStorage.removeItem(sk)
    }
  } catch {
    // Ignorar
  }

  // 3. Purgar CacheStorage del navegador (window.caches) para eliminar respuestas HTTP o assets viejos en caché
  if (clearBrowserCaches && 'caches' in window) {
    try {
      const cacheNames = await window.caches.keys()
      await Promise.all(
        cacheNames.map(async (name) => {
          const deleted = await window.caches.delete(name)
          if (deleted) clearedCacheBuckets++
        })
      )
    } catch {
      // Ignorar
    }
  }

  // 4. Desregistrar cualquier Service Worker obsoleto que pueda interceptar peticiones /api/order-ready/*
  if (clearBrowserCaches && 'serviceWorker' in navigator) {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations()
      await Promise.all(
        registrations.map(async (reg) => {
          const ok = await reg.unregister()
          if (ok) unregisteredServiceWorkers++
        })
      )
    } catch {
      // Ignorar
    }
  }

  // 5. Asegurar cookie y token JWT frescos
  await ensureFreshTabletAuth(forceTokenRefresh || force)

  return { removedLocalStorageKeys, clearedCacheBuckets, unregisteredServiceWorkers }
}

/**
 * Escritura segura en `localStorage` con autolimpieza inmediata si se alcanza el límite de 5MB (`QuotaExceededError`).
 */
export function safeLocalStorageSet(key: string, value: string, options: CacheCleanerOptions = {}): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(key, value)
  } catch {
    // Si la memoria localStorage se llenó, purgar llaves viejas de inmediato y reintentar
    purgeTabletStaleCaches({ ...options, clearBrowserCaches: false }).finally(() => {
      try {
        localStorage.setItem(key, value)
      } catch {
        // Ignorar si el navegador está en modo incógnito restringido
      }
    })
  }
}
