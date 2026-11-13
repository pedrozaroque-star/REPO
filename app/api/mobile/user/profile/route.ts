/**
 * @module app/api/mobile/user/profile/route
 * @description Endpoint autenticado de lectura y actualización del perfil del comensal móvil
 * (nombre, apellido, correo electrónico y teléfono) en `public.app_users` para Tacos Gavilan App.
 *
 * @businessRules
 * - Requiere autenticación válida mediante Bearer JWT de Supabase Auth (`getAuthUser`).
 * - Permite consultar (`GET`) y actualizar (`PUT` / `POST`) `first_name`, `last_name`, `email` y `phone` del propio comensal.
 * - Sanitiza longitudes de cadenas y valida el formato de correo electrónico o teléfono si se proporciona.
 * - Oculta en la respuesta de lectura/escritura el placeholder técnico `em_...` de la columna `phone` cuando el usuario inició sesión por correo y aún no registra teléfono.
 *
 * @dataFlow
 * - App Móvil (`GET` / `PUT` `/api/mobile/user/profile`) -> `getAuthUser` -> `supabaseAdmin.from('app_users')` -> JSON `{ ok: true, user }`.
 *
 * @notes
 * - Sincronizado con `AuthContext.updateProfile`, `app/(tabs)/account.tsx` (V1) y `components/customer-app-v2/*` (V2); devuelve HTTP 409 (`PHONE_CONFLICT`/`EMAIL_CONFLICT`) en duplicados, valida teléfono 10 dígitos y preserva nombres en actualizaciones parciales.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import {
  corsResponse,
  getAuthUser,
  isAuthSuccess,
  jsonOk,
  jsonError,
} from '@/app/api/mobile/_helpers'
import {
  EMAIL_REGEX,
  buildUniqueEmailPhonePlaceholder,
  normalizeDisplayPhone,
} from '@/lib/mobile-auth-email'

export const dynamic = 'force-dynamic'

export async function OPTIONS(): Promise<NextResponse> {
  return corsResponse()
}

function normalizePhone10Optional(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('1')) {
    return digits.slice(1, 11)
  }
  return digits.slice(0, 10)
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const authResult = await getAuthUser(request)
    if (!isAuthSuccess(authResult)) {
      return jsonError(authResult.error, 401)
    }

    const { data: userRecord, error } = await supabaseAdmin
      .from('app_users')
      .select('id, phone, first_name, last_name, email, avatar_url, created_at, updated_at')
      .eq('id', authResult.userId)
      .maybeSingle()

    if (error) {
      return jsonError(error.message, 500)
    }

    return jsonOk({
      user: userRecord
        ? {
            ...userRecord,
            phone: normalizeDisplayPhone(userRecord.phone),
          }
        : null,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al consultar perfil'
    return jsonError(msg, 500)
  }
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  try {
    const authResult = await getAuthUser(request)
    if (!isAuthSuccess(authResult)) {
      return jsonError(authResult.error, 401)
    }

    let body: {
      first_name?: unknown
      firstName?: unknown
      last_name?: unknown
      lastName?: unknown
      email?: unknown
      phone?: unknown
    }
    try {
      body = (await request.json()) as {
        first_name?: unknown
        firstName?: unknown
        last_name?: unknown
        lastName?: unknown
        email?: unknown
        phone?: unknown
      }
    } catch {
      return jsonError('Cuerpo JSON de solicitud inválido.', 400, 'VALIDATION_ERROR')
    }

    const hasFirstField =
      typeof body.first_name === 'string' || typeof body.firstName === 'string'
    const hasLastField =
      typeof body.last_name === 'string' || typeof body.lastName === 'string'
    const rawFirst =
      typeof body.first_name === 'string'
        ? body.first_name
        : typeof body.firstName === 'string'
        ? body.firstName
        : ''
    const rawLast =
      typeof body.last_name === 'string'
        ? body.last_name
        : typeof body.lastName === 'string'
        ? body.lastName
        : ''
    const firstName = rawFirst.trim().slice(0, 60)
    const lastName = rawLast.trim().slice(0, 60)
    const hasEmailField = typeof body.email === 'string'
    const rawEmail =
      hasEmailField ? String(body.email).trim().toLowerCase().slice(0, 120) : ''
    const hasPhoneField = body.phone !== undefined && body.phone !== null && String(body.phone).trim().length > 0
    const rawPhone10 = normalizePhone10Optional(body.phone)

    if (rawEmail.length > 0 && !EMAIL_REGEX.test(rawEmail)) {
      return jsonError(
        'Por favor ingresa un correo electrónico válido.',
        400,
        'VALIDATION_ERROR'
      )
    }

    if (hasPhoneField && rawPhone10.length !== 10) {
      return jsonError(
        'Por favor ingresa un número telefónico válido de 10 dígitos.',
        400,
        'VALIDATION_ERROR'
      )
    }

    const nowIso = new Date().toISOString()

    const { data: existingUser } = await supabaseAdmin
      .from('app_users')
      .select('id, phone, first_name, last_name, email, avatar_url, created_at')
      .eq('id', authResult.userId)
      .maybeSingle()

    if (existingUser) {
      let nextPhoneDb = existingUser.phone || buildUniqueEmailPhonePlaceholder(authResult.userId)
      if (rawPhone10.length === 10) {
        const { data: phoneConflict } = await supabaseAdmin
          .from('app_users')
          .select('id')
          .eq('phone', rawPhone10)
          .neq('id', authResult.userId)
          .maybeSingle()
        if (phoneConflict) {
          return jsonError(
            'Este número telefónico ya está registrado en otra cuenta.',
            409,
            'PHONE_CONFLICT'
          )
        }
        nextPhoneDb = rawPhone10
      }

      if (rawEmail.length > 0) {
        const { data: emailConflict } = await supabaseAdmin
          .from('app_users')
          .select('id')
          .ilike('email', rawEmail)
          .neq('id', authResult.userId)
          .maybeSingle()
        if (emailConflict) {
          return jsonError(
            'Este correo electrónico ya está asociado a otra cuenta.',
            409,
            'EMAIL_CONFLICT'
          )
        }
      }

      const nextEmail =
        hasEmailField
          ? rawEmail || null
          : existingUser.email || authResult.email || null

      const { data: updatedUser, error: updateError } = await supabaseAdmin
        .from('app_users')
        .update({
          first_name: hasFirstField ? firstName : (existingUser.first_name || ''),
          last_name: hasLastField ? lastName : (existingUser.last_name || ''),
          email: nextEmail,
          phone: nextPhoneDb,
          updated_at: nowIso,
        })
        .eq('id', authResult.userId)
        .select('id, phone, first_name, last_name, email, avatar_url, created_at, updated_at')
        .single()

      if (updateError) {
        const isUniqueViolation =
          updateError.code === '23505' ||
          updateError.message.toLowerCase().includes('duplicate key')
        return jsonError(
          isUniqueViolation
            ? 'El teléfono o correo electrónico ya está asociado a otra cuenta.'
            : updateError.message,
          isUniqueViolation ? 409 : 500,
          isUniqueViolation ? 'PROFILE_CONFLICT' : 'DATABASE_ERROR'
        )
      }

      return jsonOk({
        user: {
          ...updatedUser,
          phone: normalizeDisplayPhone(updatedUser.phone),
        },
      })
    }

    if (rawPhone10.length === 10) {
      const { data: phoneConflict } = await supabaseAdmin
        .from('app_users')
        .select('id')
        .eq('phone', rawPhone10)
        .neq('id', authResult.userId)
        .maybeSingle()
      if (phoneConflict) {
        return jsonError(
          'Este número telefónico ya está registrado en otra cuenta.',
          409,
          'PHONE_CONFLICT'
        )
      }
    }

    if (rawEmail.length > 0) {
      const { data: emailConflict } = await supabaseAdmin
        .from('app_users')
        .select('id')
        .ilike('email', rawEmail)
        .neq('id', authResult.userId)
        .maybeSingle()
      if (emailConflict) {
        return jsonError(
          'Este correo electrónico ya está asociado a otra cuenta.',
          409,
          'EMAIL_CONFLICT'
        )
      }
    }

    const fallbackPhoneDb =
      rawPhone10.length === 10
        ? rawPhone10
        : buildUniqueEmailPhonePlaceholder(authResult.userId)

    const { data: insertedUser, error: insertError } = await supabaseAdmin
      .from('app_users')
      .insert({
        id: authResult.userId,
        phone: fallbackPhoneDb,
        first_name: firstName,
        last_name: lastName,
        email: rawEmail.length > 0 ? rawEmail : authResult.email || null,
        avatar_url: null,
      })
      .select('id, phone, first_name, last_name, email, avatar_url, created_at, updated_at')
      .single()

    if (insertError) {
      const isUniqueViolation =
        insertError.code === '23505' ||
        insertError.message.toLowerCase().includes('duplicate key')
      return jsonError(
        isUniqueViolation
          ? 'El teléfono o correo electrónico ya está asociado a otra cuenta.'
          : insertError.message,
        isUniqueViolation ? 409 : 500,
        isUniqueViolation ? 'PROFILE_CONFLICT' : 'DATABASE_ERROR'
      )
    }

    return jsonOk({
      user: {
        ...insertedUser,
        phone: normalizeDisplayPhone(insertedUser.phone),
      },
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al actualizar perfil'
    return jsonError(msg, 500)
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return PUT(request)
}
