'use server'

/**
 * @module app/admin/tv-menus/actions
 * @description Server Actions autenticadas para la administración de menús digitales en televisores de comedor (`tv_menus` / `tv_images`).
 *
 * @businessRules
 * - Toda mutación exige sesión activa verificada mediante cookie `teg_token` + `verifyAuthToken`, bloqueando peticiones anónimas y cuentas de empleado (`employee`).
 * - Restringe extensiones, números de pantalla (`1..20`) y rutas de almacenamiento para impedir traversal (`..`).
 *
 * @dataFlow
 * - `/admin/tv-menus` -> Cookie `teg_token` -> `requireTvMenusStaffAuth()` -> Supabase Admin (`storage.tv_menus`, `public.tv_images`).
 *
 * @notes
 * - Endurecido 2026-11-20: agregada validación obligatoria de JWT administrativo en las 4 Server Actions.
 */

import { cookies } from 'next/headers'
import { createClient } from '@supabase/supabase-js'
import { verifyAuthToken } from '@/lib/auth-server'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)

const ALLOWED_TV_ROLES = new Set(['admin', 'administrador', 'supervisor', 'manager'])

async function requireTvMenusStaffAuth() {
    const cookieStore = await cookies()
    const token = cookieStore.get('teg_token')?.value?.trim()
    if (!token) {
        throw new Error('No autorizado: sesión de autenticación no encontrada.')
    }

    const user = verifyAuthToken(token)
    if (!user) {
        throw new Error('No autorizado: token inválido o expirado.')
    }

    const role = (user.role || user.user_role || '').toLowerCase()
    if (user.user_type === 'employee' || role === 'employee' || !ALLOWED_TV_ROLES.has(role)) {
        throw new Error('Acceso denegado: permisos insuficientes para administrar TV Menús.')
    }

    return user
}

export async function getSignedUploadUrlAction(
    screenNumber: number,
    fileExt: string
) {
    await requireTvMenusStaffAuth()

    const safeScreen = Number(screenNumber)
    if (!Number.isInteger(safeScreen) || safeScreen < 1 || safeScreen > 20) {
        throw new Error('Número de pantalla inválido.')
    }

    const safeExt = String(fileExt || 'jpg').trim().toLowerCase().replace(/[^a-z0-9]/g, '')
    if (!safeExt || safeExt.length > 5) {
        throw new Error('Extensión de archivo inválida.')
    }

    const fileName = `${Math.random().toString(36).substring(2)}_${Date.now()}.${safeExt}`
    const filePath = `screen_${safeScreen}/${fileName}`

    const { data, error } = await supabaseAdmin.storage
        .from('tv_menus')
        .createSignedUploadUrl(filePath)

    if (error) {
        throw new Error(error.message)
    }

    return {
        signedUrl: data.signedUrl,
        path: data.path,
        token: data.token
    }
}

export async function saveDbRecordAction(
    filePath: string,
    sortOrder: number,
    screenNumber: number,
    isUniversal: boolean,
    storeAssignments: string[]
) {
    await requireTvMenusStaffAuth()

    const cleanPath = String(filePath || '').trim()
    if (!/^screen_\d{1,2}\/[a-zA-Z0-9_.-]{3,120}$/.test(cleanPath) || cleanPath.includes('..')) {
        throw new Error('Ruta de imagen inválida.')
    }

    const safeScreen = Number(screenNumber)
    if (!Number.isInteger(safeScreen) || safeScreen < 1 || safeScreen > 20) {
        throw new Error('Número de pantalla inválido.')
    }

    const safeAssignments = Array.isArray(storeAssignments)
        ? storeAssignments
              .filter((s): s is string => typeof s === 'string')
              .map(s => s.trim().toUpperCase())
              .filter(s => /^[A-Z0-9 _-]{1,36}$/.test(s))
        : []

    const { data: { publicUrl } } = supabaseAdmin.storage
        .from('tv_menus')
        .getPublicUrl(cleanPath)

    const { error: dbError } = await supabaseAdmin
        .from('tv_images')
        .insert([{
            storage_path: publicUrl,
            sort_order: Number.isFinite(Number(sortOrder)) ? Number(sortOrder) : 0,
            duration_seconds: 15,
            screen_number: safeScreen,
            is_universal: Boolean(isUniversal),
            store_assignments: safeAssignments
        }])

    if (dbError) {
        console.error('Action Error saveDbRecordAction:', dbError)
        throw new Error(dbError.message)
    }

    return true
}

export async function deleteImageNewAction(id: string, storagePath: string) {
    await requireTvMenusStaffAuth()

    const cleanId = String(id || '').trim()
    if (!cleanId || !/^[a-zA-Z0-9_-]{1,64}$/.test(cleanId)) {
        throw new Error('ID de imagen inválido.')
    }

    const { error: dbError } = await supabaseAdmin
        .from('tv_images')
        .delete()
        .eq('id', cleanId)

    if (dbError) throw new Error(dbError.message)

    try {
        const urlParts = String(storagePath || '').split('/tv_menus/')
        if (urlParts.length > 1) {
            const path = urlParts[1]
            if (path && !path.includes('..') && /^screen_\d{1,2}\/[a-zA-Z0-9_.-]+$/.test(path)) {
                await supabaseAdmin.storage.from('tv_menus').remove([path])
            }
        }
    } catch (e) {
        console.error('Error removing from storage, ignoring...', e)
    }

    return true
}

export async function updateImageStoresAction(id: string, storeAssignments: string[]) {
    await requireTvMenusStaffAuth()

    const cleanId = String(id || '').trim()
    if (!cleanId || !/^[a-zA-Z0-9_-]{1,64}$/.test(cleanId)) {
        throw new Error('ID de imagen inválido.')
    }

    const safeAssignments = Array.isArray(storeAssignments)
        ? storeAssignments
              .filter((s): s is string => typeof s === 'string')
              .map(s => s.trim().toUpperCase())
              .filter(s => /^[A-Z0-9 _-]{1,36}$/.test(s))
        : []

    const { error } = await supabaseAdmin
        .from('tv_images')
        .update({ store_assignments: safeAssignments })
        .eq('id', cleanId)

    if (error) {
        throw new Error(error.message)
    }
    return true
}
