/**
 * @module use-wake-lock
 * @description Hook React que evita que la tableta/pantalla se duerma (screen sleep / auto-lock)
 *   mientras un modo kiosko esté activo (ej. Modo Tableta en /descansos).
 *   Funciona tanto conectada a la corriente como con batería.
 *
 * @businessRules
 * - Solo se mantiene la pantalla encendida mientras `enabled === true` (Modo Tableta activo).
 *   Al salir del modo, se libera el bloqueo inmediatamente para no gastar batería.
 * - Si el empleado cambia de app / minimiza el navegador, el sistema libera el bloqueo
 *   automáticamente (regla del navegador). Al regresar a la pestaña se vuelve a pedir solo.
 *
 * @dataFlow
 * 1. Estrategia primaria: Screen Wake Lock API nativa (`navigator.wakeLock.request('screen')`).
 *    Soportada en Chrome/Edge Android y Safari iPadOS/iOS 16.4+.
 * 2. Estrategia de respaldo (fallback): video MP4 silencioso de 16x16 px en loop
 *    (`/media/wake-lock.mp4`, `muted` + `playsinline`). Un video reproduciéndose impide el auto-lock.
 *    Se usa cuando:
 *    - El navegador no tiene la API nativa, o la petición fue rechazada (ej. Ahorro de Batería en Android).
 *    - La app corre como PWA instalada en iPad/iPhone (`display-mode: standalone`): en iPadOS < 18.4
 *      la API nativa "acepta" la petición pero NO funciona dentro de apps de pantalla de inicio
 *      (bug de WebKit 254545), por lo que se activan ambas estrategias a la vez.
 * 3. Reintento: al volver a la pestaña (`visibilitychange`) y en el siguiente toque del usuario
 *    (`pointerdown`) si el bloqueo se perdió — iOS en Modo de Bajo Consumo bloquea el autoplay
 *    hasta que hay un gesto del usuario.
 *
 * @notes
 * - Requiere contexto seguro (HTTPS o localhost). Vercel es HTTPS.
 * - `requestNow()` debe llamarse DENTRO del handler de click que activa el modo (gesto de usuario)
 *   para garantizar el permiso de reproducción del video en iOS.
 * - Limitación del sistema operativo: en iPad con "Modo de Bajo Consumo" el Bloqueo Automático
 *   del sistema se fuerza a 30 s; el video de respaldo lo mantiene despierto mientras la pestaña esté visible.
 */
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export type WakeLockMethod = 'none' | 'native' | 'video' | 'native+video'

export interface UseWakeLockResult {
    /** true si al menos una estrategia está manteniendo la pantalla encendida */
    isActive: boolean
    /** Estrategia actualmente en uso */
    method: WakeLockMethod
    /** Pide el bloqueo inmediatamente (llamar desde un gesto de usuario: click/tap) */
    requestNow: () => Promise<void>
}

const WAKE_VIDEO_SRC = '/media/wake-lock.mp4'

/** iPhone / iPad (incluye iPadOS que se reporta como "MacIntel" con pantalla táctil) */
function isAppleMobile(): boolean {
    if (typeof navigator === 'undefined') return false
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

/** La app corre instalada en pantalla de inicio (PWA standalone) */
function isStandalonePWA(): boolean {
    if (typeof window === 'undefined') return false
    return window.matchMedia?.('(display-mode: standalone)').matches === true ||
        (navigator as any).standalone === true
}

export function useWakeLock(enabled: boolean): UseWakeLockResult {
    const sentinelRef = useRef<any>(null)
    const videoRef = useRef<HTMLVideoElement | null>(null)
    // forceRef: requestNow() se llama en el click ANTES de que `enabled` cambie a true (el setState aún no se aplica)
    const forceRef = useRef(false)
    const forceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const enabledRef = useRef(enabled)
    const inFlightRef = useRef(false)
    const [nativeActive, setNativeActive] = useState(false)
    const [videoActive, setVideoActive] = useState(false)

    enabledRef.current = enabled || forceRef.current

    // ── Estrategia 1: API nativa ─────────────────────────────────────────
    const acquireNative = useCallback(async (): Promise<boolean> => {
        const wl = (navigator as any)?.wakeLock
        if (!wl || typeof wl.request !== 'function') return false
        if (document.visibilityState !== 'visible') return false
        if (sentinelRef.current && !sentinelRef.current.released) return true
        try {
            const sentinel = await wl.request('screen')
            // Si el modo se desactivó mientras esperábamos, soltar de inmediato
            if (!enabledRef.current) {
                await sentinel.release().catch(() => {})
                return false
            }
            sentinelRef.current = sentinel
            setNativeActive(true)
            sentinel.addEventListener('release', () => {
                if (sentinelRef.current === sentinel) sentinelRef.current = null
                setNativeActive(false)
            })
            return true
        } catch (err) {
            console.warn('🔆 [WakeLock] Native request rejected:', (err as Error)?.name, (err as Error)?.message)
            return false
        }
    }, [])

    const releaseNative = useCallback(async () => {
        const s = sentinelRef.current
        sentinelRef.current = null
        setNativeActive(false)
        if (s && !s.released) await s.release().catch(() => {})
    }, [])

    // ── Estrategia 2: video silencioso en loop ───────────────────────────
    const startVideo = useCallback(async (): Promise<boolean> => {
        if (typeof document === 'undefined') return false
        let v = videoRef.current
        if (!v) {
            v = document.createElement('video')
            v.setAttribute('playsinline', '')
            v.setAttribute('webkit-playsinline', '')
            v.setAttribute('muted', '')
            v.setAttribute('aria-hidden', 'true')
            v.setAttribute('title', 'wake-lock')
            v.muted = true
            v.playsInline = true
            v.loop = true
            v.preload = 'auto'
            v.disableRemotePlayback = true
            v.src = WAKE_VIDEO_SRC
            Object.assign(v.style, {
                position: 'fixed', left: '0', bottom: '0', width: '1px', height: '1px',
                opacity: '0.01', pointerEvents: 'none', zIndex: '-1'
            } as Partial<CSSStyleDeclaration>)
            v.addEventListener('pause', () => setVideoActive(false))
            v.addEventListener('playing', () => setVideoActive(true))
            document.body.appendChild(v)
            videoRef.current = v
        }
        if (!v.paused) return true
        try {
            await v.play()
            if (!enabledRef.current) { v.pause(); return false }
            setVideoActive(true)
            return true
        } catch (err) {
            console.warn('🔆 [WakeLock] Video fallback blocked (needs user tap):', (err as Error)?.name)
            setVideoActive(false)
            return false
        }
    }, [])

    const stopVideo = useCallback(() => {
        const v = videoRef.current
        videoRef.current = null
        setVideoActive(false)
        if (v) {
            v.pause()
            v.removeAttribute('src')
            v.load()
            v.remove()
        }
    }, [])

    // ── Orquestador ──────────────────────────────────────────────────────
    const acquire = useCallback(async () => {
        if (!enabledRef.current || inFlightRef.current) return
        inFlightRef.current = true
        try {
            const wl = (navigator as any)?.wakeLock
            const hasNative = !!wl && typeof wl.request === 'function'
            const appleStandalone = isAppleMobile() && isStandalonePWA()
            // ⚠️ El video se arranca SINCRÓNICAMENTE (antes de cualquier await) para conservar el
            // gesto del usuario: iOS pierde el permiso de reproducción después de un await.
            const videoPromise = (!hasNative || appleStandalone) ? startVideo() : null
            const nativeOk = await acquireNative()
            if (videoPromise) await videoPromise
            else if (!nativeOk) await startVideo() // nativa rechazada (ej. Ahorro de Batería) → respaldo
        } finally {
            inFlightRef.current = false
        }
    }, [acquireNative, startVideo])

    const release = useCallback(async () => {
        stopVideo()
        await releaseNative()
    }, [releaseNative, stopVideo])

    const clearForce = useCallback(() => {
        forceRef.current = false
        if (forceTimerRef.current) { clearTimeout(forceTimerRef.current); forceTimerRef.current = null }
    }, [])

    /** Llamar desde el click/tap. Funciona aunque `enabled` todavía no haya cambiado a true. */
    const requestNow = useCallback(async () => {
        if (!enabled) {
            forceRef.current = true
            enabledRef.current = true
            if (forceTimerRef.current) clearTimeout(forceTimerRef.current)
            // Seguridad: si el modo no llega a activarse en 3 s, soltar para no gastar batería
            forceTimerRef.current = setTimeout(() => {
                forceTimerRef.current = null
                if (forceRef.current) {
                    forceRef.current = false
                    enabledRef.current = false
                    release()
                }
            }, 3000)
        }
        await acquire()
    }, [enabled, acquire, release])

    // Activar / desactivar según el modo
    useEffect(() => {
        clearForce()
        enabledRef.current = enabled
        if (enabled) acquire()
        else release()
    }, [enabled, acquire, release, clearForce])

    // Al volver a la pestaña el navegador ya soltó el bloqueo → pedirlo de nuevo
    useEffect(() => {
        const onVisibility = () => {
            if (document.visibilityState === 'visible' && enabledRef.current) acquire()
        }
        document.addEventListener('visibilitychange', onVisibility)
        return () => document.removeEventListener('visibilitychange', onVisibility)
    }, [acquire])

    const isActive = nativeActive || videoActive

    // Si el bloqueo se perdió (ej. autoplay bloqueado), reintentar al finalizar el toque
    // (se usa pointerup en lugar de pointerdown para no disparar setState ni re-renders a mitad de un toque)
    useEffect(() => {
        if (!enabled || isActive) return
        const onTap = () => { acquire() }
        document.addEventListener('pointerup', onTap, { passive: true })
        return () => document.removeEventListener('pointerup', onTap)
    }, [enabled, isActive, acquire])

    // Limpieza total al desmontar la página
    useEffect(() => () => { clearForce(); release() }, [release, clearForce])

    const method: WakeLockMethod = nativeActive && videoActive
        ? 'native+video'
        : nativeActive ? 'native' : videoActive ? 'video' : 'none'

    return { isActive, method, requestNow }
}
