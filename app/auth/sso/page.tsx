'use client'
import { useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Loader2 } from 'lucide-react'

function SSOHandler() {
    const router = useRouter()
    const searchParams = useSearchParams()

    useEffect(() => {
        const token = searchParams.get('token')
        const userStr = searchParams.get('user')

        if (token && userStr) {
            try {
                // Login
                localStorage.setItem('teg_token', token)
                localStorage.setItem('teg_user', userStr)

                // Guardar token en cookie para soporte de autenticación en SSR/Callbacks (e.g., Basecamp)
                document.cookie = `teg_token=${token}; path=/; max-age=${7 * 24 * 60 * 60}; SameSite=Lax${window.location.protocol === 'https:' ? '; Secure' : ''}`

                // Decode user to check role
                const user = JSON.parse(userStr)
                const role = (user.role || '').toLowerCase()

                // Redirect (Hard Reload)
                if (role === 'asistente') {
                    window.location.href = '/checklists'
                } else {
                    window.location.href = '/dashboard'
                }

            } catch (e) {
                console.error('SSO Parse Error', e)
                router.push('/login?error=sso_failed')
            }
        } else {
            // Wait briefly before redirecting to allow params to mount if slow
            const t = setTimeout(() => {
                router.push('/login?error=invalid_sso_params')
            }, 2000)
            return () => clearTimeout(t)
        }
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
