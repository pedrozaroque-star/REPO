/**
 * @module components/IdleTimer
 * @description Temporizador de cierre automático de sesión por inactividad (60 minutos) exclusivo para sesiones administrativas de Asistentes en paneles de oficina.
 *
 * @businessRules
 * - Excluye estrictamente pantallas operativas 24/7 de tienda (`/inventory/preparador`, `/order-ready-board`, `/admin/blindaje-delivery/empaque`, `/tablet`, `/tv`, `/gavilan-pos`, `/descansos`, `/actividades`) para que jamás desconecte una tableta de cocina o la PC de bocinas del restaurante durante horas tranquilas.
 * - Solo aplica a usuarios con rol `assistant` / `asistente` fuera de las pantallas operativas continuas.
 *
 * @dataFlow
 * - Eventos pasivos (`pointerdown`, `keydown`, `click`, `visibilitychange`) -> verificación de ruta y rol -> cierre de sesión tras 60 min de inactividad en vistas administrativas.
 */
'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { getSupabaseClient } from '@/lib/supabase'

const ASSISTANT_TIMEOUT = 60 * 60 * 1000 // 1 Hour

const EXEMPT_24X7_PREFIXES = [
    '/inventory/preparador',
    '/order-ready-board',
    '/admin/blindaje-delivery/empaque',
    '/tablet',
    '/tv',
    '/t/',
    '/gavilan-pos',
    '/descansos',
    '/actividades',
]

function isExempt24x7Route(pathname: string | null | undefined): boolean {
    if (!pathname) return false
    return EXEMPT_24X7_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix + '/'))
}

export default function IdleTimer() {
    const pathname = usePathname()
    const pathnameRef = useRef<string | null>(pathname)
    pathnameRef.current = pathname
    const timerRef = useRef<NodeJS.Timeout | null>(null)
    const lastActivityRef = useRef<number>(Date.now())

    const handleLogout = async () => {
        if (isExempt24x7Route(pathnameRef.current)) return

        const token = localStorage.getItem('teg_token')
        const userStr = localStorage.getItem('teg_user')
        if (!token || !userStr) return

        try {
            const user = JSON.parse(userStr)
            const roleNorm = String(user?.role || '').trim().toLowerCase()
            // SOLO aplicar logout forzado a ASISTENTES fuera de pantallas 24/7
            if (roleNorm !== 'assistant' && roleNorm !== 'asistente') return

            console.log('⏳ Session expired due to inactivity (Assistant)')
            const supabase = await getSupabaseClient()
            await supabase.auth.signOut()

            localStorage.removeItem('teg_token')
            localStorage.removeItem('teg_user')
            window.location.href = '/login?reason=timeout'

        } catch (error) {
            console.error('Error checking idle status:', error)
        }
    }

    const resetTimer = () => {
        const now = Date.now()
        // Throttle timer resets so rapid touch/pointer activity never floods main thread
        if (now - lastActivityRef.current < 5000 && timerRef.current) return
        lastActivityRef.current = now
        if (timerRef.current) clearTimeout(timerRef.current)
        timerRef.current = setTimeout(handleLogout, ASSISTANT_TIMEOUT)
    }

    // Check on visibility change (minimize/tab switch) for long absences
    const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible') {
            const elapsed = Date.now() - lastActivityRef.current
            if (elapsed > ASSISTANT_TIMEOUT) {
                handleLogout()
            } else {
                resetTimer()
            }
        }
    }

    useEffect(() => {
        const events = ['pointerdown', 'keydown', 'click']

        // Initial setup
        resetTimer()

        // Passive Activity Listeners (never block touch compositor thread)
        events.forEach(event => window.addEventListener(event, resetTimer, { passive: true }))

        // Background/Minimize Listener
        document.addEventListener('visibilitychange', handleVisibilityChange)

        return () => {
            events.forEach(event => window.removeEventListener(event, resetTimer))
            document.removeEventListener('visibilitychange', handleVisibilityChange)
            if (timerRef.current) clearTimeout(timerRef.current)
        }
    }, [])

    return null
}
