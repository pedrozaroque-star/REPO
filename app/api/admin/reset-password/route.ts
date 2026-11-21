/**
 * @module ResetPasswordRoute
 * @description API route para restablecer y sincronizar la contraseña de un usuario tanto en `public.users` (con hash `bcrypt` cost 12) como en Supabase Auth.
 *
 * @businessRules
 * - Exige sesión autenticada vía `verifyStaffAuth` (`allowCron: false`).
 * - Restablecer la contraseña de otro usuario exige rol autoritativo `'admin'` verificado en `public.users`.
 * - Usuarios no-admin solo pueden restablecer su propia contraseña resolviendo estrictamente su propia identidad autenticada.
 * - Persiste siempre `await bcrypt.hash(password, 12)` en `public.users.password` (nunca texto plano) y sincroniza `supabaseAdmin.auth.admin.updateUserById`.
 *
 * @dataFlow
 * - Request (`userId`/`email`, `password`) -> `verifyStaffAuth` + DB role check -> `bcrypt.hash(password, 12)` en `public.users` + `supabaseAdmin.auth.admin.updateUserById` -> Response (`{ success: true }`)
 *
 * @notes
 * - Hardened 2026-11-20: Cerrado vector de Admin Account Takeover por desajuste entre `email` y `userId`.
 * - Hardened 2026-11-21: Almacenamiento obligatorio de hash `bcrypt` (cost 12) en `public.users.password`.
 */

import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { invalidateActiveUserStatusCache, verifyStaffAuth } from '@/lib/auth-server'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(request: Request) {
    const auth = verifyStaffAuth(request, { allowCron: false })
    if (!auth.authorized || !auth.user) return auth.response!

    try {
        const body = await request.json()
        const { email, password, userId } = body || {}

        if (typeof password !== 'string' || password.trim().length < 6 || password.length > 256) {
            return NextResponse.json(
                { error: 'La contraseña debe tener al menos 6 caracteres.' },
                { status: 400 }
            )
        }

        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

        if (!supabaseUrl || !serviceKey) {
            console.error('[reset-password] Missing SUPABASE_SERVICE_ROLE_KEY')
            return NextResponse.json(
                { error: 'Configuración de seguridad del servidor no disponible.' },
                { status: 500 }
            )
        }

        const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
            auth: {
                autoRefreshToken: false,
                persistSession: false,
            },
        })

        // Lookup authoritative caller record in public.users
        const callerIdStr = String(auth.user.id || '').trim()
        const callerEmailNorm = String(auth.user.email || '').trim().toLowerCase()
        let callerDbUser: { id: number; email: string; role: string; auth_id: string | null; is_active: boolean | null } | null = null

        if (/^\d+$/.test(callerIdStr)) {
            const { data } = await supabaseAdmin
                .from('users')
                .select('id, email, role, auth_id, is_active')
                .eq('id', Number(callerIdStr))
                .maybeSingle()
            callerDbUser = data
        }
        if (!callerDbUser && callerEmailNorm && !/[%*\0\\\s]/.test(callerEmailNorm)) {
            const escapedCallerEmail = callerEmailNorm.replace(/_/g, '\\_')
            const { data } = await supabaseAdmin
                .from('users')
                .select('id, email, role, auth_id, is_active')
                .ilike('email', escapedCallerEmail)
                .limit(5)
            if (Array.isArray(data)) {
                callerDbUser = data.find((r) => String(r.email || '').trim().toLowerCase() === callerEmailNorm) || null
            }
        }

        if (callerDbUser && callerDbUser.is_active === false) {
            return NextResponse.json({ error: 'Cuenta de usuario inactiva.' }, { status: 403 })
        }

        const authoritativeCallerEmail = (callerDbUser?.email || callerEmailNorm).trim().toLowerCase()
        const authoritativeCallerRole = String(callerDbUser?.role || auth.user.role || '').trim().toLowerCase()

        const rawUserId = userId !== undefined && userId !== null ? String(userId).trim() : ''
        const rawEmail = typeof email === 'string' ? email.trim().toLowerCase() : ''

        const matchesCallerId =
            !rawUserId ||
            rawUserId === callerIdStr ||
            (callerDbUser && rawUserId === String(callerDbUser.id)) ||
            (callerDbUser?.auth_id && rawUserId.toLowerCase() === callerDbUser.auth_id.toLowerCase())

        const matchesCallerEmail =
            !rawEmail ||
            (authoritativeCallerEmail.length > 0 && rawEmail === authoritativeCallerEmail)

        const isStrictSelfReset = Boolean(matchesCallerId && matchesCallerEmail)

        if (!isStrictSelfReset) {
            const adminCheck = verifyStaffAuth(request, { allowedRoles: ['admin'], allowCron: false })
            if (!adminCheck.authorized) {
                return adminCheck.response!
            }
            if (authoritativeCallerRole !== 'admin' && authoritativeCallerRole !== 'administrador') {
                return NextResponse.json(
                    { error: 'Forbidden: Solo un administrador puede restablecer la contraseña de otro usuario.' },
                    { status: 403 }
                )
            }
        }

        let targetAuthUuid: string | null = null
        let targetDbUserId: number | null = null
        let targetDbEmail: string | null = null

        if (isStrictSelfReset) {
            if (callerDbUser) {
                targetDbUserId = callerDbUser.id
                targetDbEmail = callerDbUser.email
            }
            if (callerDbUser?.auth_id && UUID_REGEX.test(callerDbUser.auth_id)) {
                targetAuthUuid = callerDbUser.auth_id
            } else if (UUID_REGEX.test(callerIdStr)) {
                targetAuthUuid = callerIdStr
            } else if (authoritativeCallerEmail) {
                const { data: rpcId } = await supabaseAdmin.rpc('get_auth_user_id_by_email', {
                    p_email: authoritativeCallerEmail,
                })
                if (typeof rpcId === 'string' && UUID_REGEX.test(rpcId.trim())) {
                    targetAuthUuid = rpcId.trim()
                }
            }
        } else {
            let targetEmailLookup = rawEmail
            if (rawUserId) {
                if (/^\d+$/.test(rawUserId)) {
                    const { data: targetDbUser } = await supabaseAdmin
                        .from('users')
                        .select('id, auth_id, email')
                        .eq('id', Number(rawUserId))
                        .maybeSingle()
                    if (targetDbUser) {
                        targetDbUserId = Number(targetDbUser.id)
                        targetDbEmail = targetDbUser.email
                    }
                    if (targetDbUser?.auth_id && UUID_REGEX.test(targetDbUser.auth_id)) {
                        targetAuthUuid = targetDbUser.auth_id
                    } else if (!targetEmailLookup && targetDbUser?.email) {
                        targetEmailLookup = String(targetDbUser.email).trim().toLowerCase()
                    }
                } else if (UUID_REGEX.test(rawUserId)) {
                    targetAuthUuid = rawUserId
                    const { data: byAuthId } = await supabaseAdmin
                        .from('users')
                        .select('id, email')
                        .eq('auth_id', rawUserId)
                        .maybeSingle()
                    if (byAuthId) {
                        targetDbUserId = Number(byAuthId.id)
                        targetDbEmail = byAuthId.email
                    }
                } else {
                    return NextResponse.json({ error: 'Identificador de usuario inválido.' }, { status: 400 })
                }
            }

            if (!targetDbUserId && targetEmailLookup && !/[%*\0\\\s]/.test(targetEmailLookup)) {
                const escapedTarget = targetEmailLookup.replace(/_/g, '\\_')
                const { data: rows } = await supabaseAdmin
                    .from('users')
                    .select('id, auth_id, email')
                    .ilike('email', escapedTarget)
                    .limit(5)
                const matchedDb = Array.isArray(rows)
                    ? rows.find((r) => String(r.email || '').trim().toLowerCase() === targetEmailLookup)
                    : null
                if (matchedDb) {
                    targetDbUserId = Number(matchedDb.id)
                    targetDbEmail = matchedDb.email
                    if (!targetAuthUuid && matchedDb.auth_id && UUID_REGEX.test(matchedDb.auth_id)) {
                        targetAuthUuid = matchedDb.auth_id
                    }
                }
            }

            if (!targetAuthUuid && targetEmailLookup) {
                const { data: rpcId } = await supabaseAdmin.rpc('get_auth_user_id_by_email', {
                    p_email: targetEmailLookup,
                })
                if (typeof rpcId === 'string' && UUID_REGEX.test(rpcId.trim())) {
                    targetAuthUuid = rpcId.trim()
                } else {
                    const { data, error } = await supabaseAdmin.auth.admin.listUsers()
                    if (error) throw error
                    const matched = data.users.find((u) => u.email?.toLowerCase() === targetEmailLookup)
                    if (matched?.id) targetAuthUuid = matched.id
                }
            }
        }

        if (!targetDbUserId && !targetAuthUuid) {
            return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 })
        }

        // 1. Persistir hash bcrypt (cost 12) en public.users.password para que /api/login nunca guarde texto plano
        const hashedPassword = await bcrypt.hash(password, 12)
        if (targetDbUserId) {
            const { error: dbPwErr } = await supabaseAdmin
                .from('users')
                .update({ password: hashedPassword, updated_at: new Date().toISOString() })
                .eq('id', targetDbUserId)
            if (dbPwErr) {
                console.error('[reset-password] Error updating public.users password:', dbPwErr)
                return NextResponse.json({ error: dbPwErr.message }, { status: 500 })
            }
            invalidateActiveUserStatusCache(targetDbUserId, targetDbEmail)
        }

        // 2. Sincronizar con Supabase Auth si la cuenta existe en auth.users
        if (targetAuthUuid) {
            const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(targetAuthUuid, {
                password,
                email_confirm: true,
                user_metadata: { email_verified: true },
            })

            if (updateError && !targetDbUserId) {
                console.error('Error supabaseAdmin update:', updateError)
                return NextResponse.json({ error: updateError.message }, { status: 400 })
            }
        }

        return NextResponse.json({ success: true })
    } catch (error: any) {
        console.error('Error en reset-password route:', error)
        return NextResponse.json({ error: error.message || 'Error interno' }, { status: 500 })
    }
}
