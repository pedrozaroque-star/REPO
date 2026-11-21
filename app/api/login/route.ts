/**
 * @module api/login
 * @description Endpoint de autenticación central para usuarios del sistema TEG (administradores, supervisores, gerentes y empleados).
 *
 * @businessRules
 * - Valida formato y longitud de `email` y `password` antes de tocar la base de datos (previniendo enumeración de cuentas con contraseña vacía).
 * - Aplica rate limiting en memoria por IP (`máx 12` intentos fallidos / `10 min`) y por correo normalizado (`máx 8` intentos fallidos / `10 min`).
 * - Bloquea inyección de comodines PostgREST `ILIKE` (`%`, `_`, `\0`, espacios) y exige coincidencia exacta en JS (`row.email.trim().toLowerCase() === normalizedEmail`).
 * - Verificación híbrida `bcrypt` (`$2a$`, `$2b$`, `$2y$`) + comparación en tiempo constante (`safeTimingEqual`) con actualización automática progresiva a `bcrypt` (cost 12) tras login exitoso.
 * - Genera token JWT HS256 compatible con Supabase PostgREST para RLS (`role: 'authenticated'`) y sincroniza cookie `teg_token`.
 *
 * @dataFlow
 * - POST /api/login { email, password } -> Rate Limit + Validación -> Supabase `users` / `toast_employees` -> `bcrypt.compare` / upgrade -> JWT token en cookie + JSON.
 *
 * @notes
 * - Fail-closed: verificación estricta de `SUPABASE_JWT_SECRET` en el servidor; sin secretos por defecto hardcodeados.
 * - Contraseña compartida de empleados configurable vía `process.env.EMPLOYEE_SHARED_PASSWORD` (fallback `'Gavilan123'`), comparada en tiempo constante.
 */

import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import {
  checkRateLimit,
  getJwtSecret,
  invalidateActiveUserStatusCache,
  peekRateLimit,
  resetRateLimit,
  safeTimingEqual,
} from '@/lib/auth-server'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

const LOGIN_WINDOW_MS = 10 * 60 * 1000 // 10 minutos
const MAX_FAILED_PER_IP = 12
const MAX_FAILED_PER_EMAIL = 8

// Exige inicio/fin alfanumérico en local-part y bloquea %, *, \, espacios y caracteres de control
const SAFE_EMAIL_REGEX = /^[a-z0-9](?:[a-z0-9._+-]*[a-z0-9])?@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i
const BCRYPT_HASH_REGEX = /^\$2[aby]\$\d{2}\$/

function getClientIp(request: Request): string {
  const vercelFwd = request.headers.get('x-vercel-forwarded-for')
  if (vercelFwd) {
    const first = vercelFwd.split(',')[0]?.trim()
    if (first) return first
  }
  const xFwd = request.headers.get('x-forwarded-for')
  if (xFwd) {
    const first = xFwd.split(',')[0]?.trim()
    if (first) return first
  }
  const realIp = request.headers.get('x-real-ip')?.trim()
  if (realIp) return realIp
  return 'unknown'
}

function escapePostgrestIlike(email: string): string {
  return email.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
}

function rateLimitedResponse(retryAfterSec: number) {
  return NextResponse.json(
    { error: 'Demasiados intentos de inicio de sesión. Intenta nuevamente en unos minutos.' },
    {
      status: 429,
      headers: {
        'Retry-After': String(Math.max(1, retryAfterSec)),
      },
    }
  )
}

export async function POST(request: Request) {
  try {
    const secret = getJwtSecret()
    if (!secret) {
      console.error('❌ Server authentication configuration error: JWT_SECRET / SUPABASE_JWT_SECRET no configurado')
      return NextResponse.json(
        { error: 'Server authentication configuration error' },
        { status: 500 }
      )
    }

    const clientIp = getClientIp(request)
    const ipKey = `login:ip:${clientIp}`

    const ipPeek = peekRateLimit(ipKey, MAX_FAILED_PER_IP)
    if (ipPeek.limited) {
      return rateLimitedResponse(ipPeek.retryAfterSec)
    }

    let body: any = null
    try {
      body = await request.json()
    } catch {
      checkRateLimit(ipKey, MAX_FAILED_PER_IP, LOGIN_WINDOW_MS)
      return NextResponse.json({ error: 'Solicitud inválida' }, { status: 400 })
    }

    const rawEmail = body?.email
    const rawPassword = body?.password

    // Validación estricta ANTES de tocar la base de datos (elimina enumeración con password vacío)
    if (
      typeof rawEmail !== 'string' ||
      typeof rawPassword !== 'string' ||
      rawEmail.trim().length === 0 ||
      rawEmail.trim().length > 254 ||
      rawPassword.length === 0 ||
      rawPassword.trim().length === 0 ||
      rawPassword.length > 256
    ) {
      const ipHit = checkRateLimit(ipKey, MAX_FAILED_PER_IP, LOGIN_WINDOW_MS)
      if (ipHit.limited) return rateLimitedResponse(ipHit.retryAfterSec)
      return NextResponse.json(
        { error: 'Email y contraseña válidos son requeridos' },
        { status: 400 }
      )
    }

    const normalizedEmail = rawEmail.trim().toLowerCase()
    const password = rawPassword

    // Bloquear comodines %, *, \0, \, espacios o formato inválido ANTES de consultar PostgREST
    if (
      normalizedEmail.includes('%') ||
      normalizedEmail.includes('*') ||
      normalizedEmail.includes('\0') ||
      normalizedEmail.includes('\\') ||
      /\s/.test(normalizedEmail) ||
      !SAFE_EMAIL_REGEX.test(normalizedEmail)
    ) {
      const ipHit = checkRateLimit(ipKey, MAX_FAILED_PER_IP, LOGIN_WINDOW_MS)
      if (ipHit.limited) return rateLimitedResponse(ipHit.retryAfterSec)
      return NextResponse.json(
        { error: 'Formato de correo electrónico inválido' },
        { status: 400 }
      )
    }

    const emailKey = `login:email:${normalizedEmail}`
    const emailPeek = peekRateLimit(emailKey, MAX_FAILED_PER_EMAIL)
    if (emailPeek.limited) {
      return rateLimitedResponse(emailPeek.retryAfterSec)
    }

    const recordFailedLogin = () => {
      const ipRes = checkRateLimit(ipKey, MAX_FAILED_PER_IP, LOGIN_WINDOW_MS)
      const emRes = checkRateLimit(emailKey, MAX_FAILED_PER_EMAIL, LOGIN_WINDOW_MS)
      if (ipRes.limited || emRes.limited) {
        return rateLimitedResponse(Math.max(ipRes.retryAfterSec, emRes.retryAfterSec))
      }
      return null
    }

    const escapedEmail = escapePostgrestIlike(normalizedEmail)

    // ============================================
    // STEP 1: Check USERS table (admins/managers)
    // ============================================
    const usersResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/users?email=ilike.${encodeURIComponent(escapedEmail)}&select=id,email,password,full_name,role,store_scope,store_id,is_active&limit=5`,
      {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
        },
      }
    )

    const usersRaw = await usersResponse.json()
    const matchedUser = Array.isArray(usersRaw)
      ? usersRaw.find((row: any) => String(row?.email || '').trim().toLowerCase() === normalizedEmail)
      : null

    if (matchedUser) {
      const user = matchedUser

      if (user.is_active === false) {
        const rlResp = recordFailedLogin()
        if (rlResp) return rlResp
        return NextResponse.json(
          { error: 'Usuario inactivo. Contacta al administrador.' },
          { status: 403 }
        )
      }

      const storedPassword = typeof user.password === 'string' ? user.password : ''
      if (!storedPassword) {
        const rlResp = recordFailedLogin()
        if (rlResp) return rlResp
        return NextResponse.json(
          { error: 'Credenciales incorrectas' },
          { status: 401 }
        )
      }

      const isBcryptStored = BCRYPT_HASH_REGEX.test(storedPassword)
      let isPasswordValid = false

      if (isBcryptStored) {
        isPasswordValid = await bcrypt.compare(password, storedPassword)
      } else {
        isPasswordValid = safeTimingEqual(password, storedPassword)
      }

      if (!isPasswordValid) {
        const rlResp = recordFailedLogin()
        if (rlResp) return rlResp
        return NextResponse.json(
          { error: 'Credenciales incorrectas' },
          { status: 401 }
        )
      }

      // Login exitoso: limpiar contador de fallos del email
      resetRateLimit(emailKey)

      // Actualización progresiva automática a bcrypt (cost 12) + last_login vía service-role PATCH
      const patchPayload: Record<string, unknown> = {
        last_login: new Date().toISOString(),
      }
      if (!isBcryptStored) {
        try {
          patchPayload.password = await bcrypt.hash(password, 12)
        } catch (hashErr) {
          console.warn('⚠️ [login] No se pudo generar hash bcrypt progresivo:', hashErr)
        }
      }

      try {
        await fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${encodeURIComponent(String(user.id))}`, {
          method: 'PATCH',
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
            Prefer: 'return=minimal',
          },
          body: JSON.stringify(patchPayload),
        })
      } catch (patchErr) {
        console.warn('⚠️ [login] No se pudo actualizar last_login/password upgrade:', patchErr)
      }

      invalidateActiveUserStatusCache(user.id, user.email)

      const token = jwt.sign(
        {
          sub: String(user.id),
          aud: 'authenticated',
          role: 'authenticated',
          email: user.email,
          user_role: user.role,
          user_type: 'admin',
          user_metadata: {
            full_name: user.full_name,
            role: user.role,
            store_scope: user.store_scope,
            store_id: user.store_id,
          },
        },
        secret,
        {
          algorithm: 'HS256',
          expiresIn: '30d',
        }
      )

      const response = NextResponse.json({
        success: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.full_name,
          role: user.role,
          store_scope: user.store_scope,
          store_id: user.store_id,
          user_type: 'admin',
        },
        token,
      })

      // httpOnly: false requerido porque ProtectedRoute.tsx y el cliente browser de Supabase sincronizan teg_token en cliente
      response.cookies.set('teg_token', token, {
        httpOnly: false,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 30 * 24 * 60 * 60, // 30 days
      })

      return response
    }

    // ============================================
    // STEP 2: Check TOAST_EMPLOYEES table (employees)
    // ============================================
    const employeesResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/toast_employees?email=ilike.${encodeURIComponent(escapedEmail)}&deleted=eq.false&select=id,toast_guid,first_name,last_name,email,store_ids&limit=5`,
      {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
        },
      }
    )

    const employeesRaw = await employeesResponse.json()
    const matchedEmployee = Array.isArray(employeesRaw)
      ? employeesRaw.find((row: any) => String(row?.email || '').trim().toLowerCase() === normalizedEmail)
      : null

    if (matchedEmployee) {
      const employee = matchedEmployee
      const employeeSharedPassword = process.env.EMPLOYEE_SHARED_PASSWORD || 'Gavilan123'

      if (!safeTimingEqual(password, employeeSharedPassword)) {
        const rlResp = recordFailedLogin()
        if (rlResp) return rlResp
        return NextResponse.json(
          { error: 'Credenciales incorrectas' },
          { status: 401 }
        )
      }

      resetRateLimit(emailKey)

      let position_type: 'kitchen' | 'cashier' | null = null

      const empResponse = await fetch(
        `${SUPABASE_URL}/rest/v1/toast_employees?id=eq.${encodeURIComponent(String(employee.id))}&select=job_references`,
        {
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
          },
        }
      )

      const empData = await empResponse.json()
      const jobRefs = empData?.[0]?.job_references || []

      if (jobRefs.length > 0) {
        const firstJobGuid = jobRefs[0]?.guid
        if (firstJobGuid) {
          const jobResponse = await fetch(
            `${SUPABASE_URL}/rest/v1/toast_jobs?guid=eq.${encodeURIComponent(String(firstJobGuid))}&select=title`,
            {
              headers: {
                apikey: SUPABASE_KEY,
                Authorization: `Bearer ${SUPABASE_KEY}`,
              },
            }
          )
          const jobData = await jobResponse.json()
          const jobTitle = jobData?.[0]?.title?.toLowerCase() || ''

          if (
            jobTitle.includes('cook') ||
            jobTitle.includes('cocinero') ||
            jobTitle.includes('kitchen') ||
            jobTitle.includes('prep') ||
            jobTitle.includes('preparador')
          ) {
            position_type = 'kitchen'
          } else if (
            jobTitle.includes('cashier') ||
            jobTitle.includes('cajero') ||
            jobTitle.includes('register')
          ) {
            position_type = 'cashier'
          }
        }
      }

      let shift_type: 'AM' | 'PM' | null = null
      const thirtyDaysAgo = new Date()
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
      const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0]

      const punchesResponse = await fetch(
        `${SUPABASE_URL}/rest/v1/punches?employee_toast_guid=eq.${encodeURIComponent(String(employee.toast_guid || ''))}&business_date=gte.${thirtyDaysAgoStr}&clock_in=not.is.null&select=clock_in`,
        {
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
          },
        }
      )

      const punches = await punchesResponse.json()

      if (Array.isArray(punches) && punches.length >= 3) {
        let totalMinutes = 0
        let validPunches = 0

        for (const punch of punches) {
          if (punch.clock_in) {
            const clockIn = new Date(punch.clock_in)
            const laTimeStr = clockIn.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })
            const laTime = new Date(laTimeStr)
            const totalMins = laTime.getHours() * 60 + laTime.getMinutes()

            if (totalMins >= 360 && totalMins <= 1320) {
              totalMinutes += totalMins
              validPunches++
            }
          }
        }

        if (validPunches >= 3) {
          const avgMinutes = totalMinutes / validPunches
          shift_type = avgMinutes < 900 ? 'AM' : 'PM'
        }
      }

      const token = jwt.sign(
        {
          sub: employee.id,
          aud: 'authenticated',
          role: 'authenticated',
          email: employee.email,
          user_role: 'employee',
          user_type: 'employee',
          position_type,
          shift_type,
          user_metadata: {
            full_name: `${employee.first_name || ''} ${employee.last_name || ''}`.trim(),
            role: 'employee',
            store_ids: employee.store_ids,
            toast_guid: employee.toast_guid,
            position_type,
            shift_type,
          },
        },
        secret,
        {
          algorithm: 'HS256',
          expiresIn: '15m',
        }
      )

      const response = NextResponse.json({
        success: true,
        user: {
          id: employee.id,
          email: employee.email,
          name: `${employee.first_name || ''} ${employee.last_name || ''}`.trim(),
          role: 'employee',
          store_ids: employee.store_ids,
          user_type: 'employee',
          position_type,
          shift_type,
        },
        token,
        redirect: '/mis-horarios',
      })

      response.cookies.set('teg_token', token, {
        httpOnly: false,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 15 * 60, // 15 minutes
      })

      return response
    }

    // ============================================
    // STEP 3: No user found in either table (respuesta uniforme anti-enumeración)
    // ============================================
    const rlResp = recordFailedLogin()
    if (rlResp) return rlResp

    return NextResponse.json(
      { error: 'Credenciales incorrectas' },
      { status: 401 }
    )
  } catch (error) {
    console.error('Error en login:', error)
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    )
  }
}
