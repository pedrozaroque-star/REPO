
/**
 * @module hooks/useSystemUpdate
 * @description Hook React para detectar automáticamente despliegues de nuevas versiones del sistema consultando `/api/system/version`.
 * @businessRules
 * - Usa la URL canónica `/api/system/version` sin parámetros cache-busting (`?t=...`) con `{ cache: 'no-cache' }` para que el navegador revalide contra Vercel Edge CDN (`s-maxage=60, stale-while-revalidate=60`) obteniendo `X-Vercel-Cache: HIT` sin invocar funciones Serverless.
 * - Soporta desactivación completa pasando `checkIntervalMs` como `null` o `<= 0` (usado por modo TV `/tv` y `/t/` para generar cero peticiones).
 * - Omite los ticks de `setInterval` cuando `document.visibilityState === 'hidden'`; al volver a la pestaña, el evento `visibilitychange` dispara una verificación inmediata.
 * - Almacena la versión base en `useRef` (no en `useState` ni en el arreglo de dependencias de `useEffect`) para evitar un doble `fetch` al montar el componente.
 * @dataFlow
 * - GET /api/system/version (Vercel Edge CDN 60s) -> useSystemUpdate (`currentVersionRef`, `hasUpdate`, `updateMessage`) -> components/SystemUpdateDetector.
 * @notes
 * - Fix 2026-11-19: Eliminado `?t=${Date.now()}` que invalidaba la llave de caché CDN (~42k invocaciones/día), corregido doble fetch al montar causado por `[currentVersion, checkIntervalMs]`, agregado skip en pestañas ocultas y soporte para deshabilitar polling (`null` / `<= 0`).
 */

import { useState, useEffect, useRef } from 'react'

export function useSystemUpdate(checkIntervalMs: number | null = 60000) {
    const [hasUpdate, setHasUpdate] = useState(false)
    const [updateMessage, setUpdateMessage] = useState('')
    const currentVersionRef = useRef<string | null>(null)

    useEffect(() => {
        // Allow callers (e.g., TV mode) to disable polling completely with null or <= 0
        if (checkIntervalMs === null || !Number.isFinite(checkIntervalMs) || checkIntervalMs <= 0) {
            return
        }

        let isMounted = true
        let inFlight = false

        const checkVersion = async () => {
            if (inFlight) return
            inFlight = true

            try {
                // Revalidate browser cache against Vercel Edge CDN (s-maxage=60, stale-while-revalidate=60)
                // without cache-busting query params so the Edge CDN serves X-Vercel-Cache: HIT.
                const res = await fetch('/api/system/version', { cache: 'no-cache' })
                if (!res.ok) return

                const data = await res.json()
                const remoteVersion = typeof data?.version === 'string' ? data.version : null
                if (!remoteVersion || !isMounted) return

                const baselineVersion = currentVersionRef.current
                if (!baselineVersion) {
                    // First load: Set baseline in ref (does NOT re-run effect or trigger a second fetch)
                    currentVersionRef.current = remoteVersion
                } else if (remoteVersion !== baselineVersion) {
                    // Subsequent load: Detected change
                    // Ignore if both are 'dev' (local dev mode usually returns stable 'dev')
                    if (baselineVersion !== 'dev' || remoteVersion !== 'dev') {
                        setHasUpdate(true)
                        setUpdateMessage(data.message || 'Mejoras y correcciones')
                    }
                }
            } catch (e) {
                console.error('Failed to check system version', e)
            } finally {
                inFlight = false
            }
        }

        // Establish initial baseline once on mount
        checkVersion()

        // Polling: skip ticks while tab is hidden (visibilitychange handles return-to-tab)
        const intervalId = setInterval(() => {
            if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
                return
            }
            checkVersion()
        }, checkIntervalMs)

        // Visibility Change (User comes back to tab)
        const onVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                checkVersion()
            }
        }
        if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', onVisibilityChange)
        }

        return () => {
            isMounted = false
            clearInterval(intervalId)
            if (typeof document !== 'undefined') {
                document.removeEventListener('visibilitychange', onVisibilityChange)
            }
        }
    }, [checkIntervalMs])

    return {
        hasUpdate,
        updateMessage,
        triggerUpdate: () => {
            if (typeof window !== 'undefined') {
                window.location.reload()
            }
        }
    }
}
