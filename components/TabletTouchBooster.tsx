/**
 * @module components/TabletTouchBooster
 * @description Motor global de sensibilidad táctil (Ultra-Sensitive Forgiving Tap Engine) para las 5 tabletas
 *   operativas de Tacos Gavilan (Preparador, Descansos, Actividades, Delivery, Cocina Trasera).
 *
 * @businessRules
 * - En ambientes de cocina y empaque (uso de guantes de nitrilo, manos húmedas o toques rápidos en ángulo
 *   sobre tabletas montadas en pared), el dedo suele deslizarse entre 8px y 30px durante el contacto.
 * - Los navegadores móviles (Chrome Android / Safari iPadOS) cancelan el evento nativo `click` cuando el
 *   dedo se mueve más de ~8px dentro de un contenedor con scroll, interpretándolo como un intento de desplazamiento.
 * - Asimismo, si React re-renderiza un nodo DOM entre `pointerdown` y `pointerup` (por relojes en vivo o
 *   actualizaciones por WebSocket/polling), el navegador descarta el `click`.
 * - Este motor escucha globalmente en fase de captura (`passive: true`), aplica feedback visual instantáneo (`0ms`)
 *   y rescata cualquier toque intencional (hasta `44px` de tolerancia de deslizamiento / touch-slop) cuyo `click`
 *   nativo haya sido suprimido por el navegador o por un re-render intermedio.
 *
 * @dataFlow
 * - `pointerdown` (touch/pen) -> registra coordenadas iniciales, contenedor scroll y elemento interactivo objetivo.
 * - `pointerup` -> valida tolerancia (`<= 44px`, `<= 1200ms`, scroll real `<= 22px`) y si el navegador no emite
 *   `click` en `26ms`, sintetiza `.click()` sobre el nodo original o un nodo re-renderizado con el MISMO `data-tap-key`/`id`.
 * - Incluye candado anti-rebote y bloqueo estricto contra auto-clics fantasma cuando un botón (ej. Alerta #1) se desmonta.
 */

'use client'

import { useEffect } from 'react'

const INTERACTIVE_SELECTOR = [
  'button',
  'a[href]',
  'label',
  'summary',
  '[role="button"]',
  '[role="tab"]',
  '[role="checkbox"]',
  '[role="switch"]',
  '[role="menuitem"]',
  '[data-order-card="true"]',
  '[data-touch-tap="true"]',
  '.cursor-pointer',
  '.checklist-card',
].join(', ')

const NATIVE_FORM_INPUT_SELECTOR =
  'input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]), textarea, select, [contenteditable="true"]'

const MAX_TOUCH_SLOP_PX = 44
const MAX_TAP_DURATION_MS = 1200
const MAX_SCROLL_DRIFT_PX = 22
const RESCUE_DELAY_MS = 26

interface ActiveTouch {
  pointerId: number
  startX: number
  startY: number
  startTime: number
  targetEl: HTMLElement
  tagName: string
  tapKey: string | null
  elId: string | null
  scrollParent: HTMLElement | null
  startScrollTop: number
  startScrollLeft: number
  visualOnly: boolean
}

function findScrollParent(el: HTMLElement | null): HTMLElement | null {
  let curr = el?.parentElement || null
  while (curr && curr !== document.body && curr !== document.documentElement) {
    const style = window.getComputedStyle(curr)
    const overflowY = style.overflowY
    const overflowX = style.overflowX
    const canScrollY =
      (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') &&
      curr.scrollHeight > curr.clientHeight
    const canScrollX =
      (overflowX === 'auto' || overflowX === 'scroll' || overflowX === 'overlay') &&
      curr.scrollWidth > curr.clientWidth
    if (canScrollY || canScrollX) return curr
    curr = curr.parentElement
  }
  return (document.scrollingElement as HTMLElement) || document.documentElement
}

export default function TabletTouchBooster() {
  useEffect(() => {
    const activeTouches = new Map<number, ActiveTouch>()

    let lastClickTimestamp = 0
    let lastSyntheticClickTimestamp = 0
    let lastSyntheticTarget: HTMLElement | null = null
    let isDispatchingSynthetic = false

    const clearPressingAttr = (el: HTMLElement | null) => {
      if (!el) return
      try {
        el.removeAttribute('data-touch-pressing')
      } catch {
        // Ignore DOM errors
      }
    }

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return
      const rawTarget = e.target as HTMLElement | null
      if (!rawTarget || typeof rawTarget.closest !== 'function') return

      // Prune stale touches (e.g., water drops / palm rests whose pointerup was lost on large 15.6" panels)
      const nowPerf = performance.now()
      if (activeTouches.size > 0) {
        for (const [pid, entry] of activeTouches.entries()) {
          if (nowPerf - entry.startTime > 5000) {
            clearPressingAttr(entry.targetEl)
            activeTouches.delete(pid)
          }
        }
      }

      // Leave text inputs, selects, and textareas to native browser handling
      if (rawTarget.closest(NATIVE_FORM_INPUT_SELECTOR)) {
        return
      }

      const interactiveEl = rawTarget.closest(INTERACTIVE_SELECTOR) as HTMLElement | null
      if (!interactiveEl) {
        return
      }

      if ((interactiveEl as HTMLButtonElement).disabled || interactiveEl.getAttribute('aria-disabled') === 'true') {
        return
      }

      const scrollParent = findScrollParent(interactiveEl)
      interactiveEl.setAttribute('data-touch-pressing', 'true')
      const isUltraTapHandled = Boolean(
        interactiveEl.hasAttribute('data-order-tap-id') ||
          interactiveEl.hasAttribute('data-ultra-tap') ||
          interactiveEl.closest('[data-order-tap-id], [data-ultra-tap="true"]')
      )

      activeTouches.set(e.pointerId, {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        startTime: nowPerf,
        targetEl: interactiveEl,
        tagName: interactiveEl.tagName,
        tapKey: interactiveEl.getAttribute('data-tap-key'),
        elId: interactiveEl.id || null,
        scrollParent,
        startScrollTop: scrollParent ? scrollParent.scrollTop : 0,
        startScrollLeft: scrollParent ? scrollParent.scrollLeft : 0,
        visualOnly: isUltraTapHandled,
      })
    }

    const onPointerCancel = (e: PointerEvent) => {
      const entry = activeTouches.get(e.pointerId)
      if (entry) {
        clearPressingAttr(entry.targetEl)
        activeTouches.delete(e.pointerId)
      }
    }

    const onPointerUp = (e: PointerEvent) => {
      const snapshot = activeTouches.get(e.pointerId)
      if (!snapshot) return
      activeTouches.delete(e.pointerId)
      clearPressingAttr(snapshot.targetEl)
      if (snapshot.visualOnly) return

      const now = performance.now()
      const elapsed = now - snapshot.startTime
      const dx = Math.abs(e.clientX - snapshot.startX)
      const dy = Math.abs(e.clientY - snapshot.startY)

      if (elapsed > MAX_TAP_DURATION_MS || dx > MAX_TOUCH_SLOP_PX || dy > MAX_TOUCH_SLOP_PX) {
        return
      }

      const scrollDrift = snapshot.scrollParent
        ? Math.abs(snapshot.scrollParent.scrollTop - snapshot.startScrollTop) +
          Math.abs(snapshot.scrollParent.scrollLeft - snapshot.startScrollLeft)
        : 0

      if (scrollDrift > MAX_SCROLL_DRIFT_PX) {
        return
      }

      // If an instant-touch handler already fired a click during pointerdown/pointerup, skip
      if (now - lastClickTimestamp < 120) {
        return
      }

      const endX = e.clientX
      const endY = e.clientY
      const pointerUpTime = now

      window.setTimeout(() => {
        // If native click or custom handler fired since pointerDown, do nothing
        if (lastClickTimestamp >= snapshot.startTime - 5) {
          return
        }
        if (performance.now() - pointerUpTime > 250) {
          return
        }

        let targetToClick: HTMLElement | null = snapshot.targetEl
        if (!targetToClick.isConnected) {
          // Solo recuperar si el nodo re-renderizado en esa coordenada coincide EXACTAMENTE con el mismo `data-tap-key` o `id`.
          // Jamás disparar `.click()` sobre un botón distinto que subió a la misma posición tras desmontarse una alerta anterior.
          const pointEl = document.elementFromPoint(endX, endY) as HTMLElement | null
          const recovered = pointEl?.closest?.(INTERACTIVE_SELECTOR) as HTMLElement | null
          const sameIdentity = Boolean(
            recovered &&
              recovered.tagName === snapshot.tagName &&
              !recovered.hasAttribute('data-ultra-tap') &&
              ((snapshot.tapKey && recovered.getAttribute('data-tap-key') === snapshot.tapKey) ||
                (snapshot.elId && recovered.id === snapshot.elId))
          )
          targetToClick = sameIdentity ? recovered : null
        }

        if (!targetToClick || !targetToClick.isConnected) return
        if ((targetToClick as HTMLButtonElement).disabled || targetToClick.getAttribute('aria-disabled') === 'true') {
          return
        }

        isDispatchingSynthetic = true
        lastSyntheticClickTimestamp = performance.now()
        lastSyntheticTarget = targetToClick
        lastClickTimestamp = lastSyntheticClickTimestamp
        try {
          targetToClick.click()
        } finally {
          isDispatchingSynthetic = false
        }
      }, RESCUE_DELAY_MS)
    }

    const onClickCapture = (e: MouseEvent) => {
      const now = performance.now()
      const clickEl = e.target as HTMLElement | null
      if (clickEl?.closest?.('[data-order-tap-id], [data-ultra-tap="true"]')) {
        lastClickTimestamp = now
        return
      }
      if (isDispatchingSynthetic) {
        lastClickTimestamp = now
        return
      }

      // Guard against delayed native click arriving right after our rescued synthetic click
      if (
        lastSyntheticTarget &&
        now - lastSyntheticClickTimestamp < 160 &&
        (e.target === lastSyntheticTarget || lastSyntheticTarget.contains(e.target as Node))
      ) {
        e.stopImmediatePropagation()
        e.stopPropagation()
        e.preventDefault()
        return
      }

      lastClickTimestamp = now
    }

    document.addEventListener('pointerdown', onPointerDown, { capture: true, passive: true })
    document.addEventListener('pointerup', onPointerUp, { capture: true, passive: true })
    document.addEventListener('pointercancel', onPointerCancel, { capture: true, passive: true })
    document.addEventListener('click', onClickCapture, { capture: true })

    return () => {
      activeTouches.clear()
      document.removeEventListener('pointerdown', onPointerDown, { capture: true })
      document.removeEventListener('pointerup', onPointerUp, { capture: true })
      document.removeEventListener('pointercancel', onPointerCancel, { capture: true })
      document.removeEventListener('click', onClickCapture, { capture: true })
    }
  }, [])

  return null
}
