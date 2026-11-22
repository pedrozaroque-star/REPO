/**
 * @module app/api/cron/audit-employee-wages/route
 * @description Endpoint de Vercel Cron ejecutado automáticamente todos los sábados por la tarde
 *   hora de Los Ángeles, California (`15 22 * * 6` UTC -> 2:15 PM PST / 3:15 PM PDT) para auditar
 *   en vivo los salarios por hora de cada colaborador activo en las 15 sucursales de Tacos Gavilan,
 *   comparando la tarifa oficial registrada en Simplify HR OS (Cingular HR) contra la tarifa configurada
 *   directamente en la API en vivo de Toast POS (`GET /labor/v1/employees` + `GET /labor/v1/jobs`)
 *   y los puestos con ponchadas recientes (`punches`), despachando alertas de corrección a cada
 *   Gerente de Tienda (`To`) con copia a su Supervisor de Zona (`CC`) antes de la publicación semanal
 *   de horarios en `/planificador`, más un resumen ejecutivo semanal interno a `carlos@tacosgavilan.com`.
 *
 * @businessRules
 *   - Programación semanal: Sábados a las 2:15 PM PST / 3:15 PM PDT (`15 22 * * 6` en `vercel.json`),
 *     15 minutos después de la auditoría de correos (`/api/cron/audit-employee-emails`).
 *   - Seguridad estricta Fail-Closed de datos salariales (`AGENTS.md`):
 *     * Los salarios por hora son datos confidenciales de nómina. Queda estrictamente prohibido
 *       permitir acceso sin autenticar, incluso cuando se envía `?dry_run=true`.
 *     * Exige en todas las peticiones (`GET` y `POST`): `Authorization: Bearer ${CRON_SECRET}`
 *       validado en tiempo constante (`safeTimingEqual`) O sesión JWT válida (`getServerUser`)
 *       con rol `admin` (`carlos@tacosgavilan.com`, alcance global) o `supervisor` (validando alcance
 *       de tienda con `authorizeStoreScope` cuando se especifica `store_id`).
 *     * Cualquier otro rol (`employee`, `manager`, `asistente`, `basecamp`) recibe `HTTP 403 Forbidden`;
 *       toda petición sin credenciales válidas recibe `HTTP 401 Unauthorized`.
 *   - Exclusión de asalariados (`Yearly` / `Exempt` / puestos `SALARY` en Toast) y cuentas bot de POS.
 *   - En `dry_run=true`, evalúa las tiendas en vivo y calcula los HTML sin enviar correos ni escribir en DB.
 *
 * @dataFlow
 *   `GET` / `POST` `/api/cron/audit-employee-wages`
 *     -> Fail-Closed Auth (`CRON_SECRET` | `verifyStaffAuth` + `getServerUser` + `authorizeStoreScope`)
 *     -> Validación de parámetros (`dry_run`, `force`, `store_id`, `test_to`)
 *     -> `runEmployeeWageAudit({ dryRun, force, storeId, testTo })` (`lib/employee-wage-auditor.ts`)
 *     -> JSON `{ success: true, report }`.
 *
 * @notes
 *   - Soporta parámetros por query string o JSON body (`POST`): `dry_run`, `force`, `store_id` / `storeId`, `test_to` / `testTo`.
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import {
  authorizeStoreScope,
  getCronSecret,
  getServerUser,
  safeTimingEqual,
  verifyStaffAuth,
} from '@/lib/auth-server'
import { runEmployeeWageAudit } from '@/lib/employee-wage-auditor'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const VALID_EMAIL_REGEX = /^[^\s@]+@([^\s@]+\.[^\s@]{2,})$/
const VALID_STORE_ID_REGEX = /^(?:\d+|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[a-zA-Z0-9_-]{1,32})$/

function parseBooleanParam(val: unknown): boolean {
  if (typeof val === 'boolean') return val
  if (typeof val === 'string') {
    const clean = val.trim().toLowerCase()
    return clean === 'true' || clean === '1'
  }
  if (typeof val === 'number') return val === 1
  return false
}

async function handleWageAuditRequest(req: Request) {
  try {
    // 1. Autenticación Fail-Closed estricta ANTES de leer dry_run o consultar datos salariales
    const authHeader = req.headers.get('authorization') || req.headers.get('Authorization') || ''
    const cronHeader = req.headers.get('x-cron-auth') || authHeader
    const cronSecret = getCronSecret()

    const isValidCronBearer =
      Boolean(cronSecret) &&
      (safeTimingEqual(cronHeader.trim(), `Bearer ${cronSecret}`) ||
        safeTimingEqual(cronHeader.trim(), cronSecret!))

    let authUser: Awaited<ReturnType<typeof getServerUser>> = null
    let isGlobalAdmin = false

    if (!isValidCronBearer) {
      const staffAuth = verifyStaffAuth(req, {
        allowedRoles: ['admin', 'supervisor'],
        allowCron: false,
      })
      if (!staffAuth.authorized) {
        return (
          staffAuth.response ||
          NextResponse.json(
            { success: false, error: staffAuth.error || 'Unauthorized' },
            { status: staffAuth.status || 401 }
          )
        )
      }

      authUser = await getServerUser(req)
      if (!authUser) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
      }

      const roleNorm = String(authUser.role || '').trim().toLowerCase()
      const emailNorm = String(authUser.email || '').trim().toLowerCase()
      isGlobalAdmin = roleNorm === 'admin' || emailNorm === 'carlos@tacosgavilan.com'

      if (!isGlobalAdmin && roleNorm !== 'supervisor') {
        return NextResponse.json(
          { success: false, error: 'Acceso restringido a Dirección y Supervisores.' },
          { status: 403 }
        )
      }
    } else {
      isGlobalAdmin = true
    }

    // 2. Extraer y sanitizar parámetros de query string y JSON body (en POST)
    const url = new URL(req.url)
    let body: Record<string, any> = {}
    if (req.method === 'POST') {
      body = await req.json().catch(() => ({}))
    }

    const dryRun = parseBooleanParam(
      url.searchParams.get('dry_run') ?? url.searchParams.get('dryRun') ?? body.dry_run ?? body.dryRun
    )
    const force = parseBooleanParam(url.searchParams.get('force') ?? body.force)

    const rawStoreId =
      url.searchParams.get('store_id') ??
      url.searchParams.get('storeId') ??
      body.store_id ??
      body.storeId
    let storeId: string | number | null = null

    if (rawStoreId !== undefined && rawStoreId !== null && String(rawStoreId).trim() !== '') {
      const cleanStoreId = String(rawStoreId).trim()
      if (!VALID_STORE_ID_REGEX.test(cleanStoreId)) {
        return NextResponse.json(
          { success: false, error: 'Parámetro store_id inválido.' },
          { status: 400 }
        )
      }
      if (/^\d+$/.test(cleanStoreId)) {
        const numId = parseInt(cleanStoreId, 10)
        if (numId <= 0) {
          return NextResponse.json(
            { success: false, error: 'Parámetro store_id debe ser mayor a 0.' },
            { status: 400 }
          )
        }
        storeId = numId
      } else {
        storeId = cleanStoreId
      }
    }

    // Si es supervisor (no admin global), validar alcance sobre la sucursal
    if (!isValidCronBearer && !isGlobalAdmin && authUser) {
      if (storeId !== null) {
        const scopeCheck = await authorizeStoreScope(authUser, storeId, supabaseAdmin, {
          allowedRoles: ['admin', 'supervisor'],
        })
        if (!scopeCheck.authorized) {
          return NextResponse.json(
            {
              success: false,
              error: scopeCheck.error || 'Sin autorización para auditar esta sucursal.',
            },
            { status: scopeCheck.status || 403 }
          )
        }
      } else {
        return NextResponse.json(
          {
            success: false,
            error: 'El rol supervisor requiere especificar store_id o contar con rol admin para auditoría global.',
          },
          { status: 403 }
        )
      }
    }

    const rawTestTo =
      url.searchParams.get('test_to') ??
      url.searchParams.get('testTo') ??
      body.test_to ??
      body.testTo
    let testTo: string | null = null

    if (rawTestTo !== undefined && rawTestTo !== null && String(rawTestTo).trim() !== '') {
      const cleanTestTo = String(rawTestTo).trim().toLowerCase()
      if (!VALID_EMAIL_REGEX.test(cleanTestTo) || /[\r\n,;\s]/.test(cleanTestTo)) {
        return NextResponse.json(
          {
            success: false,
            error: 'Parámetro test_to inválido: debe ser un correo electrónico válido.',
          },
          { status: 400 }
        )
      }
      testTo = cleanTestTo
    }

    // 3. Ejecutar la auditoría semanal de salarios Simplify HR vs Toast POS
    const report = await runEmployeeWageAudit({
      dryRun,
      force,
      storeId,
      testTo,
    })

    return NextResponse.json({
      success: true,
      report,
    })
  } catch (error: any) {
    console.error('[CRON AUDIT EMPLOYEE WAGES] Fatal error:', error)
    return NextResponse.json(
      {
        success: false,
        error: error?.message || 'Internal Server Error',
      },
      { status: 500 }
    )
  }
}

export async function GET(req: Request) {
  return handleWageAuditRequest(req)
}

export async function POST(req: Request) {
  return handleWageAuditRequest(req)
}
