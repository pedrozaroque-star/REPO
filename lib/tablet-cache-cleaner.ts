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

/**
 * Sincroniza la cookie `teg_token` desde `localStorage` y renueva silenciosamente el JWT si venció o vence en < 72h.
 */
export async function ensureFreshTabletAuth(force = false): Promise<string | null> {
  if (typeof window === 'undefined') return null
  try {
    let token = localStorage.getItem('teg_token')
    if (!token) return null

    // 1. Asegurar que la cookie teg_token exista siempre en el navegador
    const maxAge = 30 * 24 * 60 * 60
    const secureFlag = window.location.protocol === 'https:' ? '; Secure' : ''
    document.cookie = `teg_token=${token}; path=/; max-age=${maxAge}; SameSite=Lax${secureFlag}`

    // 2. Revisar si el token ya venció o vence dentro de las próximas 72 horas
    let needsRefresh = force
    try {
      const payload = JSON.parse(atob(token.split('.')[1]))
      const expMs = (payload?.exp || 0) * 1000
      if (!expMs || Date.now() + 72 * 60 * 60 * 1000 >= expMs) {
        needsRefresh = true
      }
    } catch {
      needsRefresh = true
    }

    const now = Date.now()
    if (needsRefresh && (force || now - lastAuthRefreshAttemptMs >= AUTH_REFRESH_THROTTLE_MS)) {
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
          localStorage.setItem('teg_token', token)
          if (data.user) {
            localStorage.setItem('teg_user', JSON.stringify(data.user))
          }
          document.cookie = `teg_token=${token}; path=/; max-age=${maxAge}; SameSite=Lax${secureFlag}`
        }
      }
    }

    return token
  } catch {
    return typeof window !== 'undefined' ? localStorage.getItem('teg_token') : null
  }
}

/**
 * Devuelve cabeceras anti-caché + Authorization Bearer con el `teg_token` actual.
 */
export function getTabletNoCacheHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    Pragma: 'no-cache'
  }
  if (typeof window !== 'undefined') {
    try {
      const token = localStorage.getItem('teg_token')
      if (token) {
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
    if (clearSessionStorage) {
      sessionStorage.clear()
    } else {
      const sessionKeysToRemove: string[] = []
      for (let i = 0; i < sessionStorage.length; i++) {
        const sk = sessionStorage.key(i)
        if (!sk) continue
        if (sk.startsWith('blindaje_packer_') || sk.startsWith('blindaje_kds_announced_')) {
          continue
        }
        sessionKeysToRemove.push(sk)
      }
      for (const sk of sessionKeysToRemove) {
        sessionStorage.removeItem(sk)
      }
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
