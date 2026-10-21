'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseClient } from '@/lib/supabase'

const ASSISTANT_TIMEOUT = 60 * 60 * 1000 // 1 Hour

export default function IdleTimer() {
    const router = useRouter()
    const timerRef = useRef<NodeJS.Timeout | null>(null)
    const lastActivityRef = useRef<number>(Date.now())

    const handleLogout = async () => {
        const token = localStorage.getItem('teg_token')
        const userStr = localStorage.getItem('teg_user')
        if (!token || !userStr) return

        try {
            const user = JSON.parse(userStr)
            // SOLO aplicar logout forzado a ASISTENTES
            if (user.role !== 'assistant') return

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
