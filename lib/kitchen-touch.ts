/**
 * @module lib/kitchen-touch
 * @description Motor táctil unificado para guantes húmedos y pantallas industriales en las tabletas de cocina
 *   de Tacos Gavilan (Tableta 1: Samsung Galaxy Tab S10 FE 10.9" `/inventory/preparador`, Tableta 2: MESWAO 15.6"
 *   `/inventory/preparador/bodega`, Temporizador `BeanCookingTimerTFS4` y `DeliveryPhoneNotesAlertPanel`).
 *
 * @businessRules
 * - Disparo instantáneo en `onPointerDown` (`touch`/`pen`) con bloqueo de `onClick` sintético por `1200ms`
 *   para impedir dobles ejecuciones (`+2` en carrito o auto-cancelación de ollas) cuando un cocinero con guante
 *   sostiene el dedo `>= 320ms` antes de levantarlo.
 * - Marca cada elemento con `data-ultra-tap="true"` y `data-tap-key` para que `TabletTouchBooster` aplique
 *   únicamente feedback visual (`data-touch-pressing`) sin disparar rescates sintéticos sobre nodos desmontados.
 * - Calibra dinámicamente el radio del radar de proximidad magnético: `18px` en tabletas `10.9"` (`<= 1280px` CSS)
 *   para evitar cruces entre tarjetas vecinas, y `38px` en paneles grandes `15.6"` (`> 1280px` CSS).
 * - Poda automáticamente los mapas de deduplicación al superar `80` llaves para garantizar memoria acotada 24/7.
 *
 * @dataFlow
 * - Eventos `PointerEvent` / `MouseEvent` -> `useKitchenTapGuard` / `createKitchenTapGuard` -> ejecución única
 *   segura (`0ms` en táctil, nativo en mouse/teclado).
 *
 * @notes
 * - Creado en el rediseño industrial 2026-11-26 para unificar los 4 motores táctiles previos en un solo estándar.
 */

'use client'

import type React from 'react'
import { useCallback, useRef } from 'react'

export const KITCHEN_TOUCH_DEDUPE_MS = 1200
const MAX_TRACKED_KEYS = 80

export interface KitchenInstantTapOptions {
  /** Ventana anti-doble-disparo en milisegundos (default: 1200ms para guantes lentos) */
  dedupeMs?: number
  /** Detener propagación del evento hacia contenedores padres (default: true) */
  stopPropagation?: boolean
  /** Evitar disparo en `onPointerDown` si se prefiere solo `onClick` (ej. botones dentro de scroll) */
  deferToClick?: boolean
  /** Callback opcional de feedback táctil/sonoro (ej. tick Web Audio) */
  onFeedback?: () => void
}

export interface KitchenTapBindProps {
  'data-ultra-tap': 'true'
  'data-tap-key': string
  onPointerDown: (e: React.PointerEvent) => void
  onClick: (e: React.MouseEvent) => void
  onContextMenu: (e: React.MouseEvent) => void
}

/**
 * Devuelve el radio magnético óptimo del radar de proximidad según el tamaño físico del panel:
 * - `18px` en Samsung Galaxy Tab S10 FE 10.9" (`1024×640` / `1152×720`) para cero falsos cruces entre columnas.
 * - `38px` en MESWAO 15.6" (`> 1280px`) para compensar el air-gap capacitivo.
 */
export function getAdaptiveProximityRadiusPx(viewportWidth?: number): number {
  const w =
    typeof viewportWidth === 'number' && Number.isFinite(viewportWidth)
      ? viewportWidth
      : typeof window !== 'undefined'
        ? window.innerWidth
        : 1024
  return w <= 1280 ? 18 : 38
}

/**
 * Hook ligero y sin fuga de memoria 24/7 para vincular botones táctiles de cocina (guantes, vapor, mica).
 */
export function useKitchenTapGuard() {
  const lastTouchByKeyRef = useRef<Map<string, number>>(new Map())

  const pruneIfNeeded = useCallback((map: Map<string, number>, now: number) => {
    if (map.size <= MAX_TRACKED_KEYS) return
    for (const [k, ts] of map.entries()) {
      if (now - ts > 15_000) {
        map.delete(k)
      }
    }
    while (map.size > MAX_TRACKED_KEYS) {
      const oldest = map.keys().next().value
      if (oldest === undefined) break
      map.delete(oldest)
    }
  }, [])

  const bindInstantTap = useCallback(
    (
      tapKey: string,
      action: () => void,
      opts: KitchenInstantTapOptions = {}
    ): KitchenTapBindProps => {
      const dedupeMs = opts.dedupeMs ?? KITCHEN_TOUCH_DEDUPE_MS
      const shouldStop = opts.stopPropagation !== false

      return {
        'data-ultra-tap': 'true',
        'data-tap-key': tapKey,
        onPointerDown: (e: React.PointerEvent) => {
          if (opts.deferToClick) return
          if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return
          e.preventDefault()
          if (shouldStop) e.stopPropagation()

          const now = Date.now()
          const map = lastTouchByKeyRef.current
          const prev = map.get(tapKey) || 0
          if (now - prev < Math.min(dedupeMs, 380)) return
          map.set(tapKey, now)
          pruneIfNeeded(map, now)

          opts.onFeedback?.()
          action()
        },
        onClick: (e: React.MouseEvent) => {
          if (shouldStop) e.stopPropagation()
          const now = Date.now()
          const prev = lastTouchByKeyRef.current.get(tapKey) || 0
          if (!opts.deferToClick && now - prev < dedupeMs) {
            return
          }
          lastTouchByKeyRef.current.set(tapKey, now)
          pruneIfNeeded(lastTouchByKeyRef.current, now)
          opts.onFeedback?.()
          action()
        },
        onContextMenu: (e: React.MouseEvent) => {
          e.preventDefault()
        },
      }
    },
    [pruneIfNeeded]
  )

  return { bindInstantTap }
}
