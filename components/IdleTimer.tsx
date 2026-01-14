'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseClient } from '@/lib/supabase'

const TIMEOUT_DURATION = 60 * 60 * 1000 // 60 minutes

export default function IdleTimer() {
    const router = useRouter()
    const timerRef = useRef<NodeJS.Timeout | null>(null)

    // Reset timer on any user activity
    const resetTimer = () => {
        if (timerRef.current) clearTimeout(timerRef.current)
        timerRef.current = setTimeout(handleLogout, TIMEOUT_DURATION)
    }

    const handleLogout = async () => {
        // Only logout if we have a token (user is logged in)
        const token = localStorage.getItem('teg_token')
        if (!token) return

        try {
            const supabase = await getSupabaseClient()
            await supabase.auth.signOut()
        } catch (error) {
            console.error('Error signing out due to inactivity:', error)
        } finally {
            localStorage.removeItem('teg_token')
            localStorage.removeItem('teg_user')

            // Redirect with reason param for optional specific UI handling
            window.location.href = '/login?reason=timeout'
        }
    }

    useEffect(() => {
        // List of events that reset the timer
        const events = ['mousemove', 'mousedown', 'click', 'scroll', 'keypress', 'touchstart', 'touchmove']

        // Initialize timer
        resetTimer()

        // Attach listeners
        events.forEach(event => {
            window.addEventListener(event, resetTimer)
        })

        return () => {
            // Cleanup listeners
            events.forEach(event => {
                window.removeEventListener(event, resetTimer)
            })
            if (timerRef.current) clearTimeout(timerRef.current)
        }
    }, [])

    return null // This component renders nothing
}
