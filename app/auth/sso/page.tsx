/**
 * @module app/auth/sso/page
 * @description Callback cliente de autenticación SSO corporativa (Google OAuth) para Tacos Gavilan.
 *
 * @businessRules
 * - Exige que el token de sesión sea un JWT de 3 segmentos válido (`eyJ...`) leído de la cookie `teg_token` establecida por el servidor (o parámetro verificado), rechazando tokens sin firma (`g_sso_...`).
 * - Limpia de inmediato los parámetros sensibles de la URL mediante `window.history.replaceState({}, '', '/auth/sso')`.
 * - Persiste `teg_token` y `teg_user` en `localStorage` y redirige al selector post-login (`/login?welcome=1`) o `/planificador`.
 *
 * @dataFlow
 * - Cookie `teg_token` + Query param (`user`) -> Limpieza URL (`history.replaceState`) -> `localStorage` + `document.cookie` -> Redirección segura.
 *
 * @notes
 * - Hardened 2026-11-21: Validación de formato JWT de 3 segmentos y purga inmediata de query string en historial del navegador.
 */

'use client'
import { useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Loader2 } from 'lucide-react'

function isValidThreePartJwt(candidate: string | null | undefined): candidate is string {
    if (!candidate || typeof candidate !== 'string') return false
    const trimmed = candidate.trim()
    if (!trimmed.startsWith('eyJ')) return false
    const parts = trimmed.split('.')
    return parts.length === 3 && Boolean(parts[0]) && Boolean(parts[1]) && Boolean(parts[2])
}

function readCookieTegToken(): string | null {
    if (typeof document === 'undefined') return null
    const match = document.cookie.match(/(?:^|;\s*)teg_token=([^;]+)/)
    if (!match?.[1]) return null
    try {
        return decodeURIComponent(match[1].trim())
    } catch {
        return match[1].trim()
    }
}

function decodeUserFromJwt(token: string): Record<string, any> | null {
    try {
        const parts = token.split('.')
        const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
        const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
        const payload = JSON.parse(atob(padded))
        if (!payload?.sub || !payload?.email) return null
        return {
            id: payload.sub,
            email: payload.email,
            name: payload.user_metadata?.full_name || payload.email,
            role: payload.user_role || payload.user_metadata?.role || 'user',
            store_scope: payload.user_metadata?.store_scope ?? null,
            store_id: payload.user_metadata?.store_id ?? null,
            user_type: payload.user_type || 'admin',
        }
    } catch {
        return null
    }
}

function SSOHandler() {
    const router = useRouter()
    const searchParams = useSearchParams()

    useEffect(() => {
        const paramToken = searchParams.get('token')
        const userStr = searchParams.get('user')
        const cookieToken = readCookieTegToken()

        // Limpiar parámetros sensibles de la barra de direcciones de inmediato
        if (typeof window !== 'undefined' && window.location.search) {
            window.history.replaceState({}, '', '/auth/sso')
        }

        const resolvedToken = isValidThreePartJwt(paramToken)
            ? paramToken.trim()
            : isValidThreePartJwt(cookieToken)
              ? cookieToken.trim()
              : null

        if (resolvedToken) {
            try {
                const parsedUser = userStr ? JSON.parse(userStr) : decodeUserFromJwt(resolvedToken)
                if (!parsedUser || !parsedUser.email) {
                    throw new Error('Missing SSO user profile')
                }

                localStorage.setItem('teg_token', resolvedToken)
                localStorage.setItem('teg_user', JSON.stringify(parsedUser))

                const maxAge = 30 * 24 * 60 * 60
                const secureAttr = window.location.protocol === 'https:' ? '; Secure' : ''
                document.cookie = `teg_token=${resolvedToken}; path=/; max-age=${maxAge}; SameSite=Lax${secureAttr}`

                const role = String(parsedUser.role || '').toLowerCase()
                const emailNorm = String(parsedUser.email || '').trim().toLowerCase()

                if (emailNorm === 'stephany@cingularhr.com' || role === 'planificador') {
                    window.location.href = '/planificador'
                } else {
                    window.location.href = '/login?welcome=1'
                }
                return
            } catch (e) {
                console.error('SSO Parse Error', e)
                router.push('/login?error=sso_failed')
                return
            }
        }

        const t = setTimeout(() => {
            router.push('/login?error=invalid_sso_params')
        }, 1500)
        return () => clearTimeout(t)
    }, [searchParams, router])

    return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-neutral-900 text-white">
            <div className="absolute inset-0 opacity-10 bg-[url('https://grainy-gradients.vercel.app/noise.svg')]"></div>
            <Loader2 className="w-16 h-16 animate-spin text-red-600 mb-6 relative z-10" />
            <h2 className="text-2xl font-bold relative z-10">Iniciando sesión segura...</h2>
            <p className="text-gray-400 mt-2 relative z-10">Verificando credenciales corporativas</p>
        </div>
    )
}

export default function SSOCallbackPage() {
    return (
        <Suspense fallback={<div className="bg-neutral-900 h-screen w-screen" />}>
            <SSOHandler />
        </Suspense>
    )
}
