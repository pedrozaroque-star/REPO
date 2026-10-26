/**
 * @module api/mantenimiento
 * @description API route principal para el Registro de Actividades de Mantenimiento y Proveedores de Tacos Gavilan.
 * @businessRules
 * - GET: Protegido con autenticación JWT (teg_token) para la bitácora completa; incluye modos públicos acotados
 *   `?directory=1` (directorio de empresas/técnicos recurrentes para el Paso 2) y `?shift_leaders=1&store_id=...`
 *   (encargados del turno del día en curso desde el Módulo PLANIFICADOR `shifts` y el Módulo HORARIOS `schedules`
 *   para elegir en el Paso 7 a Supervisor, Manager, Asistente Manager o Shift Leader).
 * - POST: Permite el registro público de actividades de técnicos y proveedores desde el portal QR móvil, validando
 *   estrictamente sucursal existente, categoría, tipo de servicio, evidencias fotográficas y firma digital del encargado.
 * - DELETE: Protegido exclusivamente para roles 'admin' y 'supervisor'. Elimina permanentemente un registro de
 *   mantenimiento por su ID único, purgando también todas sus evidencias fotográficas, PDFs y firmas del bucket
 *   'checklist-photos' en Supabase Storage.
 * - En cada registro exitoso, genera notificaciones de sistema para supervisores y administradores y despacha
 *   automáticamente por correo electrónico el reporte de los 7 pasos a Administración/Contabilidad (raquel@tacosgavilan.com).
 * - Las fechas y horas respetan la zona horaria oficial 'America/Los_Angeles' y la jornada de 6:00 AM a 5:59 AM.
 * @dataFlow
 * - Frontend (Portal QR Móvil / Panel Admin) -> /api/mantenimiento -> PostgreSQL (maintenance_service_logs & stores)
 *   & Supabase Storage (checklist-photos) & Nodemailer SMTP (raquel@tacosgavilan.com).
 * @notes
 * - Utiliza getSupabaseAdminClient() en el servidor tras validar permisos y entradas.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/supabase'
import { verifyAuthToken, getCronSecret } from '@/lib/auth-server'
import { sendMaintenanceServiceEmail } from '@/lib/maintenance-email'

export const dynamic = 'force-dynamic'

const ALLOWED_CATEGORIES = [
  'hood_cleaning',
  'refrigeration',
  'grease_trap',
  'pest_control',
  'cooking_equipment',
  'electrical',
  'power_washing',
  'security_locks',
  'it_pos',
  'general'
]

const ALLOWED_SERVICE_TYPES = [
  'preventive',
  'corrective',
  'emergency',
  'inspection',
  'installation',
  'warranty'
]

const ALLOWED_STATUSES = ['completed', 'pending_parts', 'follow_up_needed']

const BODEGA_LOCATION = {
  id: 'BODEGA',
  name: 'La Bodega (Almacén Central)',
  code: 'BODEGA',
  city: 'Vernon / Los Angeles',
  address: 'Almacén Central Tacos Gavilan',
  is_active: true
}

/**
 * Obtiene la fecha de negocio oficial en California PST ('America/Los_Angeles')
 * aplicando la regla de Tacos Gavilan: el día laboral inicia a las 6:00 AM.
 */
function getBusinessDatePST(date = new Date()): string {
  const laDate = new Date(date.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }))
  const hour = laDate.getHours()
  if (hour < 6) {
    laDate.setDate(laDate.getDate() - 1)
  }
  const yyyy = laDate.getFullYear()
  const mm = String(laDate.getMonth() + 1).padStart(2, '0')
  const dd = String(laDate.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

/**
 * Obtiene la hora actual en formato HH:MM (24h) en 'America/Los_Angeles'
 * compatible con columnas PostgreSQL de tipo TIME.
 */
function getCurrentTimePST(date = new Date()): string {
  const laDate = new Date(date.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }))
  const hh = String(laDate.getHours()).padStart(2, '0')
  const mi = String(laDate.getMinutes()).padStart(2, '0')
  return `${hh}:${mi}`
}

/**
 * Sanitiza un valor de hora para columnas PostgreSQL TIME ('HH:MM' o 'HH:MM:SS').
 * Si recibe un timestamp ISO o un valor inválido, lo convierte o usa la hora PST actual.
 */
function sanitizeTimePST(input: unknown, fallbackToNow = true): string | null {
  if (typeof input === 'string') {
    const trimmed = input.trim()
    if (/^\d{2}:\d{2}(:\d{2})?$/.test(trimmed)) {
      return trimmed.slice(0, 5)
    }
    const parsed = new Date(trimmed)
    if (!isNaN(parsed.getTime())) {
      return getCurrentTimePST(parsed)
    }
  }
  return fallbackToNow ? getCurrentTimePST() : null
}

/**
 * Verifica que la petición provenga de un usuario autenticado con rol autorizado
 * (mediante cookie 'teg_token' o header 'Authorization: Bearer ...') o de un job interno con CRON_SECRET.
 */
function verifyMaintenanceAuth(
  request: NextRequest,
  requireAdminOrSupervisor = false
): { authorized: boolean; error?: string; status?: number } {
  const authHeader = request.headers.get('authorization') || request.headers.get('Authorization')
  const cookieHeader = request.headers.get('cookie') || ''
  const cronHeader = request.headers.get('x-cron-auth') || authHeader
  const cronSecret = getCronSecret()

  if (cronSecret && (cronHeader === `Bearer ${cronSecret}` || cronHeader === cronSecret)) {
    return { authorized: true }
  }

  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.substring(7).trim()
    : request.cookies.get('teg_token')?.value || cookieHeader.match(/teg_token=([^;]+)/)?.[1]?.trim() || null

  if (!token) {
    return {
      authorized: false,
      error: 'No autorizado: Inicia sesión para acceder a la bitácora de mantenimiento',
      status: 401
    }
  }

  const decoded = verifyAuthToken(token)
  if (!decoded) {
    return {
      authorized: false,
      error: 'No autorizado: Sesión inválida o expirada',
      status: 401
    }
  }

  const rawRole = String(decoded.user_role || (decoded as any).role || decoded.user_metadata?.role || '').toLowerCase()
  const isAdminOrSupervisor = ['admin', 'administrador', 'supervisor'].includes(rawRole)
  const isStaff = isAdminOrSupervisor || ['manager', 'gerente', 'asistente', 'assistant'].includes(rawRole)

  if (requireAdminOrSupervisor && !isAdminOrSupervisor) {
    return {
      authorized: false,
      error: 'Acceso denegado: Se requiere rol de Administrador o Supervisor para eliminar registros',
      status: 403
    }
  }

  if (!isStaff) {
    return {
      authorized: false,
      error: 'Acceso denegado: Rol sin permisos para consultar bitácora de mantenimiento',
      status: 403
    }
  }

  return { authorized: true }
}

/**
 * Sanitiza un arreglo de URLs de evidencias fotográficas o documentos.
 */
function sanitizePhotoUrls(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  return input
    .filter((item): item is string => typeof item === 'string' && item.trim().startsWith('http'))
    .map(item => item.trim())
    .slice(0, 5)
}

const GENERIC_TRADE_LABELS = new Set([
  'servicio de campanas y ductos',
  'hood & exhaust cleaning service',
  'técnico de refrigeración y hielo',
  'refrigeration & ice machine service',
  'control de plagas y fumigación',
  'pest control & extermination',
  'plomería y trampa de grasa',
  'plumbing & grease trap service',
  'técnico de equipos de cocina',
  'cooking equipment technician',
  'servicio eléctrico e iluminación',
  'electrical & lighting service',
  'servicio de plomería y drenajes',
  'test'
])

export type LeadershipRoleType = 'supervisor' | 'manager' | 'assistant_manager' | 'shift_leader'

function classifyLeadershipRole(rawTitleOrRole: string | null | undefined): LeadershipRoleType | null {
  const t = (rawTitleOrRole || '').toLowerCase().trim()
  if (!t) return null
  if (t.includes('supervisor') || t === 'sup') return 'supervisor'
  if (t.includes('asst') || t.includes('assist') || t.includes('asistente') || t.includes('subgerente')) {
    return 'assistant_manager'
  }
  if (t.includes('shift') || t.includes('leader') || t.includes('lider') || t.includes('líder') || t.includes('encargado')) {
    return 'shift_leader'
  }
  if (t.includes('manager') || t.includes('gerente')) return 'manager'
  return null
}

function getLeadershipRank(role: LeadershipRoleType): number {
  switch (role) {
    case 'supervisor':
      return 1
    case 'manager':
      return 2
    case 'assistant_manager':
      return 3
    case 'shift_leader':
      return 4
    default:
      return 5
  }
}

function isAbsenceSchedule(label: string | null | undefined, startTime?: string | null, endTime?: string | null): boolean {
  const l = (label || '').toLowerCase()
  if (
    l.includes('enferm') ||
    l.includes('sick') ||
    l.includes('vacac') ||
    l.includes('vacat') ||
    l.includes('permis') ||
    l.includes('leave') ||
    l.includes('unpaid') ||
    l.includes('off') ||
    l.includes('descanso') ||
    l.includes('ausenc') ||
    l.includes('absence')
  ) {
    return true
  }
  if (startTime && endTime && startTime.startsWith('00:00') && endTime.startsWith('00:00')) {
    return true
  }
  return false
}

function formatToLATimeHHMM(timeInput: string | null | undefined): string {
  if (!timeInput) return ''
  const trimmed = String(timeInput).trim()
  if (!trimmed.includes('T')) {
    const m = trimmed.match(/^(\d{1,2}):(\d{2})/)
    return m ? `${m[1].padStart(2, '0')}:${m[2]}` : ''
  }
  try {
    const d = new Date(trimmed)
    if (isNaN(d.getTime())) return ''
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'America/Los_Angeles',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(d)
  } catch {
    return ''
  }
}

function normalizePhoneticPersonName(name: string | null | undefined): string {
  return (name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ck/g, 'k')
    .replace(/z/g, 's')
    .replace(/v/g, 'b')
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
}

function areSameLeaderName(nameA: string, nameB: string): boolean {
  const a = normalizePhoneticPersonName(nameA)
  const b = normalizePhoneticPersonName(nameB)
  if (!a || !b) return false
  if (a === b) return true
  const partsA = a.split(' ')
  const partsB = b.split(' ')
  if (partsA.length >= 2 && partsB.length >= 2) {
    if (partsA[0] === partsB[0] && partsA[partsA.length - 1] === partsB[partsB.length - 1]) {
      return true
    }
  }
  return false
}

function titleCasePersonName(name: string): string {
  return (name || '')
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map(w => (w.length > 0 ? w[0].toUpperCase() + w.slice(1).toLowerCase() : ''))
    .join(' ')
}

function computeShiftBlockAndActive(
  startHHMM: string,
  endHHMM: string,
  refTimeHHMM: string
): { shift_block: 'AM' | 'PM' | 'FULL' | null; is_on_shift_now: boolean } {
  if (!startHHMM || !endHHMM) {
    return { shift_block: null, is_on_shift_now: false }
  }
  const toMin = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number)
    if (isNaN(h) || isNaN(m)) return null
    return h * 60 + m
  }
  const sMin = toMin(startHHMM)
  let eMin = toMin(endHHMM)
  const rMinRaw = toMin(refTimeHHMM)
  if (sMin === null || eMin === null) {
    return { shift_block: null, is_on_shift_now: false }
  }
  if (eMin <= sMin) {
    eMin += 24 * 60
  }

  // En Tacos Gavilan el día laboral empieza a las 6:00 AM y el turno PM inicia a las 5:00 PM (17:00 = 1020 min)
  const pmBoundary = 17 * 60
  const overlapAM = Math.max(0, Math.min(eMin, pmBoundary) - Math.max(sMin, 6 * 60))
  const overlapPM = Math.max(0, eMin - Math.max(sMin, pmBoundary))

  let shift_block: 'AM' | 'PM' | 'FULL' = 'AM'
  if (overlapAM >= 180 && overlapPM >= 180) {
    shift_block = 'FULL'
  } else if (overlapPM > overlapAM || sMin >= 14 * 60) {
    shift_block = 'PM'
  } else {
    shift_block = 'AM'
  }

  let is_on_shift_now = false
  if (rMinRaw !== null) {
    // Ventana con 45 minutos de tolerancia antes de entrada y después de salida
    const grace = 45
    const rMin1 = rMinRaw
    const rMin2 = rMinRaw + 24 * 60
    if (
      (rMin1 >= sMin - grace && rMin1 <= eMin + grace) ||
      (rMin2 >= sMin - grace && rMin2 <= eMin + grace)
    ) {
      is_on_shift_now = true
    }
  }

  return { shift_block, is_on_shift_now }
}

// ============================================================================
// GET /api/mantenimiento
// ============================================================================
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)

    // Modo público de directorio (?directory=1) para el Paso 2 del portal móvil QR:
    // Retorna únicamente los proveedores y técnicos que ya han realizado trabajos en las tiendas (sin datos sensibles).
    if (searchParams.get('directory') === '1') {
      const supabase = await getSupabaseAdminClient()
      const targetStoreId = (searchParams.get('store_id') || '').trim()

      const { data: rawLogs, error: dirErr } = await supabase
        .from('maintenance_service_logs')
        .select('company_name, technician_name, technician_phone, category, store_id, service_date, created_at')
        .order('service_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(500)

      if (dirErr) {
        return NextResponse.json({ success: false, error: dirErr.message }, { status: 500 })
      }

      const companiesMap = new Map<
        string,
        {
          company_name: string
          last_technician_name: string
          last_technician_phone: string
          last_category: string
          visit_count: number
          store_ids: Set<string>
        }
      >()

      const techniciansMap = new Map<
        string,
        {
          technician_name: string
          company_name: string
          technician_phone: string
          category: string
          visit_count: number
          store_ids: Set<string>
        }
      >()

      for (const row of rawLogs || []) {
        const compRaw = String(row.company_name || '').trim()
        const techRaw = String(row.technician_name || '').trim()
        const phoneRaw = String(row.technician_phone || '').trim()
        const catRaw = ALLOWED_CATEGORIES.includes(String(row.category || '').trim())
          ? String(row.category).trim()
          : 'general'
        const stRaw = String(row.store_id || '').trim()

        const compLower = compRaw.toLowerCase()
        const techLower = techRaw.toLowerCase()
        const isGenericTrade = GENERIC_TRADE_LABELS.has(compLower)
        const isTestTech =
          techLower === 'test' ||
          techLower.includes('verificación') ||
          techLower.includes('verificacion')

        if (compRaw && !isGenericTrade && !isTestTech) {
          const existingComp = companiesMap.get(compLower)
          if (!existingComp) {
            const storeSet = new Set<string>()
            if (stRaw) storeSet.add(stRaw)
            companiesMap.set(compLower, {
              company_name: compRaw,
              last_technician_name: techRaw,
              last_technician_phone: phoneRaw,
              last_category: catRaw,
              visit_count: 1,
              store_ids: storeSet
            })
          } else {
            existingComp.visit_count += 1
            if (stRaw) existingComp.store_ids.add(stRaw)
            if (!existingComp.last_technician_name && techRaw) {
              existingComp.last_technician_name = techRaw
            }
            if (!existingComp.last_technician_phone && phoneRaw) {
              existingComp.last_technician_phone = phoneRaw
            }
          }
        }

        if (techRaw && !isTestTech) {
          const cleanCompany = !isGenericTrade ? compRaw : ''
          const techKey = `${techLower}__${cleanCompany.toLowerCase()}`
          const existingTech = techniciansMap.get(techKey)
          if (!existingTech) {
            const storeSet = new Set<string>()
            if (stRaw) storeSet.add(stRaw)
            techniciansMap.set(techKey, {
              technician_name: techRaw,
              company_name: cleanCompany,
              technician_phone: phoneRaw,
              category: catRaw,
              visit_count: 1,
              store_ids: storeSet
            })
          } else {
            existingTech.visit_count += 1
            if (stRaw) existingTech.store_ids.add(stRaw)
            if (!existingTech.technician_phone && phoneRaw) {
              existingTech.technician_phone = phoneRaw
            }
            if (!existingTech.company_name && cleanCompany) {
              existingTech.company_name = cleanCompany
            }
          }
        }
      }

      const sortByStoreAndVisits = <T extends { store_ids: Set<string>; visit_count: number }>(list: T[]) => {
        return list.sort((a, b) => {
          if (targetStoreId) {
            const aInStore = a.store_ids.has(targetStoreId) ? 1 : 0
            const bInStore = b.store_ids.has(targetStoreId) ? 1 : 0
            if (aInStore !== bInStore) return bInStore - aInStore
          }
          return b.visit_count - a.visit_count
        })
      }

      const companies = sortByStoreAndVisits(Array.from(companiesMap.values()))
        .slice(0, 20)
        .map(c => ({
          company_name: c.company_name,
          last_technician_name: c.last_technician_name,
          last_technician_phone: c.last_technician_phone,
          last_category: c.last_category,
          visit_count: c.visit_count,
          store_ids: Array.from(c.store_ids)
        }))

      const technicians = sortByStoreAndVisits(Array.from(techniciansMap.values()))
        .slice(0, 20)
        .map(t => ({
          technician_name: t.technician_name,
          company_name: t.company_name,
          technician_phone: t.technician_phone,
          category: t.category,
          visit_count: t.visit_count,
          store_ids: Array.from(t.store_ids)
        }))

      return NextResponse.json({
        success: true,
        companies,
        technicians
      })
    }

    // Modo público de encargados en turno (?shift_leaders=1&store_id=...&date=...) para el Paso 7 del portal móvil QR:
    // Cruza el Módulo PLANIFICADOR (shifts + toast_employees + toast_jobs) y el Módulo HORARIOS (schedules + users)
    // del día laboral en curso para retornar los encargados elegibles: Supervisor, Manager, Asistente Manager y Shift Leader.
    if (searchParams.get('shift_leaders') === '1') {
      const supabase = await getSupabaseAdminClient()
      const rawStoreId = (searchParams.get('store_id') || '').trim()
      const rawDate = (searchParams.get('date') || '').trim()
      const targetDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : getBusinessDatePST()
      const refTimeHHMM = sanitizeTimePST(searchParams.get('time'), true) || getCurrentTimePST()

      if (!rawStoreId) {
        return NextResponse.json({
          success: true,
          business_date: targetDate,
          reference_time: refTimeHHMM,
          leaders: []
        })
      }

      // Caso especial: La Bodega (Almacén Central) -> Retornar supervisores activos
      if (rawStoreId.toUpperCase() === 'BODEGA') {
        const { data: supUsers } = await supabase
          .from('users')
          .select('id, full_name, role, is_active')
          .eq('is_active', true)
          .ilike('role', '%supervisor%')
          .order('full_name')

        const bodegaLeaders = (supUsers || []).map((u: any) => ({
          id: `user_${u.id}`,
          name: titleCasePersonName(u.full_name),
          role: 'supervisor' as LeadershipRoleType,
          start_time: '',
          end_time: '',
          shift_block: null,
          shift_label: 'Supervisor Corporativo',
          source: 'supervisor',
          scheduled_today: true,
          is_on_shift_now: true
        }))

        return NextResponse.json({
          success: true,
          business_date: targetDate,
          reference_time: refTimeHHMM,
          leaders: bodegaLeaders
        })
      }

      // Resolver la sucursal en stores (por id numérico, code o external_id)
      const { data: allStores } = await supabase
        .from('stores')
        .select('id, name, code, external_id, supervisor_id')

      const matchedStore = (allStores || []).find(
        (s: any) =>
          String(s.id) === rawStoreId ||
          String(s.code || '').toUpperCase() === rawStoreId.toUpperCase() ||
          String(s.external_id || '') === rawStoreId
      )

      if (!matchedStore) {
        return NextResponse.json({
          success: true,
          business_date: targetDate,
          reference_time: refTimeHHMM,
          leaders: []
        })
      }

      const storeNumId = Number(matchedStore.id)
      const storeGuid = String(matchedStore.external_id || '')
      const storeSupId = matchedStore.supervisor_id ? Number(matchedStore.supervisor_id) : null

      // Consultar en paralelo Horarios (schedules), Planificador (shifts), Usuarios (users) y Puestos (toast_jobs)
      const [schedulesRes, shiftsRes, usersRes, jobsRes] = await Promise.all([
        supabase
          .from('schedules')
          .select('id, user_id, store_id, date, start_time, end_time, shift_label, role')
          .eq('date', targetDate)
          .eq('store_id', storeNumId),
        storeGuid
          ? supabase
              .from('shifts')
              .select('id, store_id, employee_id, job_id, shift_date, start_time, end_time, status')
              .eq('store_id', storeGuid)
              .eq('shift_date', targetDate)
          : Promise.resolve({ data: [] as any[] }),
        supabase
          .from('users')
          .select('id, full_name, role, store_id, is_active, toast_guid')
          .eq('is_active', true),
        supabase
          .from('toast_jobs')
          .select('id, guid, title')
      ])

      const stSchedules = schedulesRes.data || []
      const stShifts = shiftsRes.data || []
      const activeUsers = usersRes.data || []
      const allJobs = jobsRes.data || []

      const jobById = new Map<string, any>()
      const jobByGuid = new Map<string, any>()
      for (const j of allJobs) {
        if (j.id) jobById.set(String(j.id), j)
        if (j.guid) jobByGuid.set(String(j.guid), j)
      }

      // Cargar empleados de Toast de los turnos del día + empleados activos de la sucursal
      const shiftEmpIds = Array.from(new Set(stShifts.map((s: any) => String(s.employee_id)).filter(Boolean)))
      const [shiftEmpsRes, storeEmpsRes] = await Promise.all([
        shiftEmpIds.length > 0
          ? supabase
              .from('toast_employees')
              .select('id, toast_guid, first_name, last_name, chosen_name, job_references, deleted')
              .in('id', shiftEmpIds)
          : Promise.resolve({ data: [] as any[] }),
        storeGuid
          ? supabase
              .from('toast_employees')
              .select('id, toast_guid, first_name, last_name, chosen_name, job_references, deleted')
              .contains('store_ids', JSON.stringify([storeGuid]))
              .eq('deleted', false)
          : Promise.resolve({ data: [] as any[] })
      ])

      const empById = new Map<string, any>()
      for (const e of [...(storeEmpsRes.data || []), ...(shiftEmpsRes.data || [])]) {
        if (e?.id) empById.set(String(e.id), e)
      }

      interface LeaderCandidate {
        id: string
        name: string
        role: LeadershipRoleType
        start_time: string
        end_time: string
        shift_block: 'AM' | 'PM' | 'FULL' | null
        shift_label: string
        source: 'horarios' | 'planificador' | 'horarios+planificador' | 'supervisor' | 'store_roster'
        scheduled_today: boolean
        is_on_shift_now: boolean
        toast_guid?: string
        user_id?: number
      }

      const candidates: LeaderCandidate[] = []

      const upsertCandidate = (incoming: LeaderCandidate) => {
        const existing = candidates.find(c => {
          if (incoming.toast_guid && c.toast_guid && incoming.toast_guid === c.toast_guid) return true
          if (incoming.user_id && c.user_id && incoming.user_id === c.user_id) return true
          return areSameLeaderName(c.name, incoming.name)
        })

        if (existing) {
          if (incoming.scheduled_today) existing.scheduled_today = true
          if (incoming.is_on_shift_now) existing.is_on_shift_now = true
          if (
            (existing.source === 'horarios' && incoming.source === 'planificador') ||
            (existing.source === 'planificador' && incoming.source === 'horarios')
          ) {
            existing.source = 'horarios+planificador'
          } else if (existing.source === 'store_roster' && incoming.scheduled_today) {
            existing.source = incoming.source
          }
          if (!existing.start_time && incoming.start_time) existing.start_time = incoming.start_time
          if (!existing.end_time && incoming.end_time) existing.end_time = incoming.end_time
          if (!existing.shift_block && incoming.shift_block) existing.shift_block = incoming.shift_block
          if (getLeadershipRank(incoming.role) < getLeadershipRank(existing.role)) {
            existing.role = incoming.role
          }
          if (!existing.toast_guid && incoming.toast_guid) existing.toast_guid = incoming.toast_guid
          if (!existing.user_id && incoming.user_id) existing.user_id = incoming.user_id
        } else {
          candidates.push(incoming)
        }
      }

      // Identificar usuarios en ausencia hoy (Vacaciones / Enfermedad / Permiso) para excluirlos
      const absentUserIdsToday = new Set<number>()
      for (const sc of stSchedules) {
        if (isAbsenceSchedule(sc.shift_label, sc.start_time, sc.end_time) && sc.user_id) {
          absentUserIdsToday.add(Number(sc.user_id))
        }
      }

      // 1. Procesar Módulo HORARIOS (schedules del día en curso)
      for (const sc of stSchedules) {
        if (isAbsenceSchedule(sc.shift_label, sc.start_time, sc.end_time)) continue
        const u = activeUsers.find((x: any) => Number(x.id) === Number(sc.user_id))
        if (!u) continue
        const roleKey = classifyLeadershipRole(sc.role || u.role)
        if (!roleKey) continue

        const startHHMM = formatToLATimeHHMM(sc.start_time)
        const endHHMM = formatToLATimeHHMM(sc.end_time)
        const { shift_block, is_on_shift_now } = computeShiftBlockAndActive(startHHMM, endHHMM, refTimeHHMM)

        upsertCandidate({
          id: `sched_${sc.id}`,
          name: titleCasePersonName(u.full_name),
          role: roleKey,
          start_time: startHHMM,
          end_time: endHHMM,
          shift_block,
          shift_label: sc.shift_label || 'Horarios',
          source: 'horarios',
          scheduled_today: true,
          is_on_shift_now,
          toast_guid: u.toast_guid ? String(u.toast_guid) : undefined,
          user_id: Number(u.id)
        })
      }

      // 2. Procesar Módulo PLANIFICADOR (shifts del día en curso)
      for (const sh of stShifts) {
        const job = jobById.get(String(sh.job_id))
        const emp = empById.get(String(sh.employee_id))
        if (!emp) continue

        const matchedUser = emp.toast_guid
          ? activeUsers.find((u: any) => u.toast_guid && String(u.toast_guid) === String(emp.toast_guid))
          : activeUsers.find(
              (u: any) =>
                Number(u.store_id) === storeNumId &&
                areSameLeaderName(u.full_name, `${emp.first_name || ''} ${emp.last_name || ''}`)
            )

        if (matchedUser && absentUserIdsToday.has(Number(matchedUser.id))) continue

        const roleFromJob = classifyLeadershipRole(job?.title)
        const roleFromUser = matchedUser ? classifyLeadershipRole(matchedUser.role) : null
        const roleKey =
          roleFromJob && roleFromUser
            ? getLeadershipRank(roleFromUser) < getLeadershipRank(roleFromJob)
              ? roleFromUser
              : roleFromJob
            : roleFromJob || roleFromUser

        if (!roleKey) continue

        const startHHMM = formatToLATimeHHMM(sh.start_time)
        const endHHMM = formatToLATimeHHMM(sh.end_time)
        const { shift_block, is_on_shift_now } = computeShiftBlockAndActive(startHHMM, endHHMM, refTimeHHMM)
        const displayName = matchedUser?.full_name
          ? titleCasePersonName(matchedUser.full_name)
          : titleCasePersonName(`${emp.first_name || ''} ${emp.last_name || ''}`)

        upsertCandidate({
          id: `shift_${sh.id}`,
          name: displayName,
          role: roleKey,
          start_time: startHHMM,
          end_time: endHHMM,
          shift_block,
          shift_label: 'Planificador',
          source: 'planificador',
          scheduled_today: true,
          is_on_shift_now,
          toast_guid: emp.toast_guid ? String(emp.toast_guid) : undefined,
          user_id: matchedUser ? Number(matchedUser.id) : undefined
        })
      }

      // 3. Incluir al Supervisor Asignado de la Sucursal (stores.supervisor_id)
      if (storeSupId) {
        const supUser = activeUsers.find((u: any) => Number(u.id) === storeSupId)
        if (supUser && !absentUserIdsToday.has(Number(supUser.id))) {
          upsertCandidate({
            id: `sup_${supUser.id}`,
            name: titleCasePersonName(supUser.full_name),
            role: 'supervisor',
            start_time: '',
            end_time: '',
            shift_block: null,
            shift_label: 'Supervisor de Sucursal',
            source: 'supervisor',
            scheduled_today: false,
            is_on_shift_now: false,
            toast_guid: supUser.toast_guid ? String(supUser.toast_guid) : undefined,
            user_id: Number(supUser.id)
          })
        }
      }

      // 4. Respaldo de Plantilla Activa de Liderazgo de la Sucursal (por si cubren turno o no se ha publicado el día)
      const storeUsers = activeUsers.filter((u: any) => Number(u.store_id) === storeNumId)
      for (const u of storeUsers) {
        if (absentUserIdsToday.has(Number(u.id))) continue
        const rKey = classifyLeadershipRole(u.role)
        if (!rKey) continue
        upsertCandidate({
          id: `user_${u.id}`,
          name: titleCasePersonName(u.full_name),
          role: rKey,
          start_time: '',
          end_time: '',
          shift_block: null,
          shift_label: 'Plantilla de Sucursal',
          source: 'store_roster',
          scheduled_today: false,
          is_on_shift_now: false,
          toast_guid: u.toast_guid ? String(u.toast_guid) : undefined,
          user_id: Number(u.id)
        })
      }

      // Si no hubo Shift Leaders en los turnos del día, agregar Shift Leaders activos de la tienda desde toast_employees
      const hasScheduledShiftLeader = candidates.some(c => c.role === 'shift_leader' && c.scheduled_today)
      if (!hasScheduledShiftLeader) {
        for (const emp of storeEmpsRes.data || []) {
          if (emp.deleted) continue
          const refs = Array.isArray(emp.job_references) ? emp.job_references : []
          let bestRole: LeadershipRoleType | null = null
          for (const ref of refs) {
            const j = ref?.guid ? jobByGuid.get(String(ref.guid)) : null
            const r = classifyLeadershipRole(j?.title)
            if (r && (!bestRole || getLeadershipRank(r) < getLeadershipRank(bestRole))) {
              bestRole = r
            }
          }
          if (bestRole) {
            upsertCandidate({
              id: `emp_${emp.id}`,
              name: titleCasePersonName(`${emp.first_name || ''} ${emp.last_name || ''}`),
              role: bestRole,
              start_time: '',
              end_time: '',
              shift_block: null,
              shift_label: 'Plantilla de Sucursal',
              source: 'store_roster',
              scheduled_today: false,
              is_on_shift_now: false,
              toast_guid: emp.toast_guid ? String(emp.toast_guid) : undefined
            })
          }
        }
      }

      // Ordenar: 1) En turno ahora (is_on_shift_now), 2) Programados hoy (scheduled_today), 3) Supervisor de tienda, 4) Jerarquía (Supervisor > Manager > Asistente > Shift Leader), 5) Nombre
      candidates.sort((a, b) => {
        if (a.is_on_shift_now !== b.is_on_shift_now) return a.is_on_shift_now ? -1 : 1
        if (a.scheduled_today !== b.scheduled_today) return a.scheduled_today ? -1 : 1
        const rankDiff = getLeadershipRank(a.role) - getLeadershipRank(b.role)
        if (rankDiff !== 0) return rankDiff
        return a.name.localeCompare(b.name)
      })

      return NextResponse.json({
        success: true,
        business_date: targetDate,
        reference_time: refTimeHHMM,
        store_name: matchedStore.name,
        leaders: candidates.map(({ toast_guid, user_id, ...rest }) => rest)
      })
    }

    const auth = verifyMaintenanceAuth(request, false)
    if (!auth.authorized) {
      return NextResponse.json({ success: false, error: auth.error }, { status: auth.status || 401 })
    }

    const supabase = await getSupabaseAdminClient()

    const storeId = searchParams.get('store_id')
    const category = searchParams.get('category')
    const status = searchParams.get('status')
    const serviceType = searchParams.get('service_type')
    const from = searchParams.get('from')
    const to = searchParams.get('to')
    const search = searchParams.get('search')
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '100', 10) || 100, 1), 500)
    const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10) || 0, 0)

    // 1. Obtener mapa de tiendas para enriquecer resultados (incluyendo La Bodega)
    const { data: storesList } = await supabase
      .from('stores')
      .select('id, name, code, city, address, is_active')
      .order('name')

    const storesMap = new Map<string, any>()
    ;(storesList || []).forEach(s => {
      storesMap.set(String(s.id), s)
    })
    storesMap.set('BODEGA', BODEGA_LOCATION)

    const allStoresWithBodega = [
      ...(storesList || []),
      ...((storesList || []).some((s: any) => String(s.id).toUpperCase() === 'BODEGA') ? [] : [BODEGA_LOCATION])
    ]

    // 2. Calcular KPIs globales en zona horaria oficial 'America/Los_Angeles' (6:00 AM)
    const todayPST = getBusinessDatePST()
    const currentMonthStart = `${todayPST.slice(0, 7)}-01`

    const [monthCountRes, pendingCountRes, allStoreIdsRes] = await Promise.all([
      supabase
        .from('maintenance_service_logs')
        .select('id', { count: 'exact', head: true })
        .gte('service_date', currentMonthStart),
      supabase
        .from('maintenance_service_logs')
        .select('id', { count: 'exact', head: true })
        .in('status', ['pending_parts', 'follow_up_needed']),
      supabase
        .from('maintenance_service_logs')
        .select('store_id')
    ])

    const distinctStores = new Set((allStoreIdsRes.data || []).map((r: any) => String(r.store_id))).size
    const kpis = {
      totalMonth: monthCountRes.count || 0,
      pendingPartsCount: pendingCountRes.count || 0,
      distinctStoresCount: distinctStores
    }

    // 3. Consulta filtrada de registros
    let query = supabase
      .from('maintenance_service_logs')
      .select('*', { count: 'exact' })
      .order('service_date', { ascending: false })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (storeId && storeId !== 'all') {
      query = query.eq('store_id', storeId)
    }
    if (category && category !== 'all') {
      query = query.eq('category', category)
    }
    if (status && status !== 'all') {
      query = query.eq('status', status)
    }
    if (serviceType && serviceType !== 'all') {
      query = query.eq('service_type', serviceType)
    }
    if (from) {
      query = query.gte('service_date', from)
    }
    if (to) {
      query = query.lte('service_date', to)
    }
    if (search) {
      const sanitizedSearch = search.replace(/[,()]/g, ' ').trim()
      if (sanitizedSearch) {
        query = query.or(
          `company_name.ilike.%${sanitizedSearch}%,technician_name.ilike.%${sanitizedSearch}%,area_equipment.ilike.%${sanitizedSearch}%,work_description.ilike.%${sanitizedSearch}%,invoice_number.ilike.%${sanitizedSearch}%,manager_name.ilike.%${sanitizedSearch}%,notes.ilike.%${sanitizedSearch}%`
        )
      }
    }

    const { data: logs, error, count } = await query

    if (error) {
      console.error('[mantenimiento] Error al consultar logs:', error)
      return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }

    // Detectar reincidencias (<30 días en la misma tienda y misma categoría)
    const enrichedLogs = (logs || []).map(log => {
      const storeInfo = storesMap.get(String(log.store_id))
      const logTime = new Date(`${log.service_date}T12:00:00`).getTime()
      const hasRecentRepeat = (logs || []).some(other => {
        if (other.id === log.id) return false
        if (String(other.store_id) !== String(log.store_id)) return false
        if (other.category !== log.category) return false
        const otherTime = new Date(`${other.service_date}T12:00:00`).getTime()
        const diffDays = Math.abs(logTime - otherTime) / (1000 * 60 * 60 * 24)
        return diffDays <= 30
      })

      return {
        ...log,
        has_repeat_within_30d: hasRecentRepeat,
        store: storeInfo || { id: log.store_id, name: `Sucursal ${log.store_id}`, code: '' }
      }
    })

    return NextResponse.json({
      success: true,
      data: enrichedLogs,
      total: count || 0,
      kpis,
      stores: allStoresWithBodega
    })
  } catch (err: any) {
    console.error('[mantenimiento] Excepción en GET:', err)
    return NextResponse.json({ success: false, error: err.message || 'Error interno' }, { status: 500 })
  }
}

// ============================================================================
// POST /api/mantenimiento (Público — Para Técnicos, Proveedores y Kioscos)
// ============================================================================
export async function POST(request: NextRequest) {
  try {
    const supabase = await getSupabaseAdminClient()
    const body = await request.json()

    const {
      store_id,
      company_name,
      technician_name,
      technician_phone,
      category,
      service_type,
      area_equipment,
      work_description,
      parts_replaced,
      status,
      service_date,
      start_time,
      end_time,
      photos_before,
      photos_after,
      photos_invoice,
      invoice_number,
      cost_estimate,
      manager_name,
      manager_signature_url,
      notes,
      is_after_hours,
      warranty_days
    } = body

    const isAfterHours = Boolean(is_after_hours)

    // Validaciones obligatorias
    if (!store_id) {
      return NextResponse.json({ success: false, error: 'Debes seleccionar la sucursal de Tacos Gavilan' }, { status: 400 })
    }
    if (!company_name || !String(company_name).trim()) {
      return NextResponse.json({ success: false, error: 'El nombre de la empresa o proveedor es obligatorio' }, { status: 400 })
    }
    if (!technician_name || !String(technician_name).trim()) {
      return NextResponse.json({ success: false, error: 'El nombre del técnico es obligatorio' }, { status: 400 })
    }
    if (!category || !ALLOWED_CATEGORIES.includes(String(category))) {
      return NextResponse.json({ success: false, error: 'Debes seleccionar una categoría de servicio válida' }, { status: 400 })
    }
    if (!area_equipment || !String(area_equipment).trim()) {
      return NextResponse.json({ success: false, error: 'Especifica el equipo o área intervenida' }, { status: 400 })
    }
    if (!work_description || !String(work_description).trim()) {
      return NextResponse.json({ success: false, error: 'La descripción del trabajo realizado es obligatoria' }, { status: 400 })
    }

    // Validar que exista evidencia fotográfica válida
    const cleanBefore = sanitizePhotoUrls(photos_before)
    const cleanAfter = sanitizePhotoUrls(photos_after)
    const cleanInvoice = sanitizePhotoUrls(photos_invoice)
    const totalEvidenceCount = cleanBefore.length + cleanAfter.length + cleanInvoice.length

    if (totalEvidenceCount === 0) {
      return NextResponse.json(
        { success: false, error: 'Es obligatorio adjuntar al menos una fotografía de evidencia (Antes, Después o Factura)' },
        { status: 400 }
      )
    }

    // Validación de Firma del Encargado vs Servicio Nocturno (After-Hours)
    let resolvedManagerName = manager_name ? String(manager_name).trim() : ''
    let resolvedSignatureUrl: string | null =
      typeof manager_signature_url === 'string' && manager_signature_url.trim().startsWith('http')
        ? manager_signature_url.trim()
        : null

    if (isAfterHours) {
      if (totalEvidenceCount < 2) {
        return NextResponse.json(
          {
            success: false,
            error: 'En servicios nocturnos sin firma del encargado es obligatorio adjuntar al menos 2 fotografías de evidencia'
          },
          { status: 400 }
        )
      }
      if (!resolvedManagerName) {
        resolvedManagerName = 'Turno Nocturno (Pendiente Validación AM)'
      } else if (!resolvedManagerName.toLowerCase().includes('nocturno')) {
        resolvedManagerName = `${resolvedManagerName} (Turno Nocturno)`
      }
    } else {
      if (!resolvedManagerName) {
        return NextResponse.json(
          { success: false, error: 'El nombre del encargado en turno que valida el servicio es obligatorio' },
          { status: 400 }
        )
      }
      if (!resolvedSignatureUrl) {
        return NextResponse.json(
          { success: false, error: 'La firma táctil del encargado en turno es obligatoria para certificar la visita' },
          { status: 400 }
        )
      }
    }

    // Verificar que la sucursal exista en la tabla stores o sea La Bodega
    const rawStoreParam = String(store_id).trim().toLowerCase()
    let matchedStore: { id: string | number; name: string; code?: string; address?: string; city?: string } | undefined

    if (rawStoreParam === 'bodega' || rawStoreParam === 'la bodega') {
      matchedStore = BODEGA_LOCATION
    } else {
      const { data: storesList } = await supabase
        .from('stores')
        .select('id, name, code, address, city')

      matchedStore = (storesList || []).find((s: any) =>
        String(s.id).toLowerCase() === rawStoreParam ||
        (!isNaN(Number(rawStoreParam)) && String(s.id) === String(Number(rawStoreParam))) ||
        s.code?.toLowerCase() === rawStoreParam ||
        s.name?.toLowerCase() === rawStoreParam
      )
    }

    if (!matchedStore) {
      return NextResponse.json({ success: false, error: 'La sucursal seleccionada no es válida' }, { status: 400 })
    }

    const officialDate = service_date && /^\d{4}-\d{2}-\d{2}$/.test(String(service_date))
      ? String(service_date)
      : getBusinessDatePST()

    const validServiceType = ALLOWED_SERVICE_TYPES.includes(String(service_type))
      ? String(service_type)
      : 'corrective'

    // Sanitizar y asegurar que cost_estimate sea numérico válido o null (0 automático para garantías)
    let numericCost: number | null = validServiceType === 'warranty' ? 0 : null
    if (cost_estimate !== null && cost_estimate !== undefined && String(cost_estimate).trim() !== '') {
      const cleaned = parseFloat(String(cost_estimate).replace(/[^0-9.]/g, ''))
      if (!isNaN(cleaned) && isFinite(cleaned) && cleaned >= 0) {
        numericCost = Math.round(cleaned * 100) / 100
      }
    }

    const validStatus = ALLOWED_STATUSES.includes(String(status))
      ? String(status)
      : 'completed'

    // Construir notas incluyendo días de garantía si fueron especificados
    const parsedWarrantyDays = Number(warranty_days)
    let finalNotes = notes ? String(notes).trim() : ''
    if (!isNaN(parsedWarrantyDays) && [30, 60, 90].includes(parsedWarrantyDays)) {
      const warrantyTag = `[Garantía: ${parsedWarrantyDays} días]`
      if (!finalNotes.includes(warrantyTag)) {
        finalNotes = finalNotes ? `${warrantyTag} ${finalNotes}` : warrantyTag
      }
    }

    // Construir payload atómico (sin columnas generadas y con formato TIME 'HH:MM' válido)
    const insertPayload = {
      store_id: String(matchedStore.id),
      company_name: String(company_name).trim().slice(0, 150),
      technician_name: String(technician_name).trim().slice(0, 150),
      technician_phone: technician_phone ? String(technician_phone).trim().slice(0, 40) : null,
      category: String(category),
      service_type: validServiceType,
      area_equipment: String(area_equipment).trim().slice(0, 200),
      work_description: String(work_description).trim().slice(0, 2000),
      parts_replaced: parts_replaced ? String(parts_replaced).trim().slice(0, 500) : null,
      status: validStatus,
      service_date: officialDate,
      start_time: sanitizeTimePST(start_time, true),
      end_time: sanitizeTimePST(end_time, true),
      photos_before: cleanBefore,
      photos_after: cleanAfter,
      photos_invoice: cleanInvoice,
      invoice_number: invoice_number ? String(invoice_number).trim().slice(0, 80) : null,
      cost_estimate: numericCost,
      manager_name: resolvedManagerName.slice(0, 150),
      manager_signature_url: resolvedSignatureUrl,
      notes: finalNotes ? finalNotes.slice(0, 1000) : null
    }

    const { data: insertedRecord, error: insertError } = await supabase
      .from('maintenance_service_logs')
      .insert(insertPayload)
      .select('*')
      .single()

    if (insertError) {
      console.error('[mantenimiento] Error al insertar registro:', insertError)
      return NextResponse.json({ success: false, error: insertError.message }, { status: 500 })
    }

    const storeDisplayName = matchedStore.name || `Sucursal #${matchedStore.id}`
    const storeAddressFormatted = [matchedStore.address, matchedStore.city].filter(Boolean).join(', ') || null

    // 1. Generar notificación del sistema para supervisores y administradores
    try {
      const { data: targetUsers } = await supabase
        .from('users')
        .select('id')
        .in('role', ['admin', 'supervisor'])
        .limit(20)

      if (targetUsers && targetUsers.length > 0) {
        const notifPayloads = targetUsers.map(u => ({
          user_id: u.id,
          title: `🛠️ Servicio Registrado: ${insertPayload.company_name}`,
          message: `${insertPayload.technician_name} completó servicio de ${category} (${insertPayload.area_equipment}) en ${storeDisplayName}. Validado por ${insertPayload.manager_name}.`,
          type: 'maintenance',
          read: false,
          link: '/admin/mantenimiento'
        }))

        await supabase.from('notifications').insert(notifPayloads)
      }
    } catch (notifErr) {
      // No romper el flujo principal si la notificación opcional falla
      console.warn('[mantenimiento] No se pudo crear notificación:', notifErr)
    }

    // 2. Despachar automáticamente correo electrónico ejecutivo con los 7 pasos a raquel@tacosgavilan.com
    let emailNotified = false
    try {
      const emailRes = await sendMaintenanceServiceEmail({
        id: insertedRecord.id,
        store_id: insertPayload.store_id,
        store_name: storeDisplayName,
        store_address: storeAddressFormatted,
        company_name: insertPayload.company_name,
        technician_name: insertPayload.technician_name,
        technician_phone: insertPayload.technician_phone,
        category: insertPayload.category,
        service_type: insertPayload.service_type,
        area_equipment: insertPayload.area_equipment,
        work_description: insertPayload.work_description,
        parts_replaced: insertPayload.parts_replaced,
        status: insertPayload.status,
        service_date: insertPayload.service_date,
        start_time: insertPayload.start_time,
        end_time: insertPayload.end_time,
        photos_before: insertPayload.photos_before,
        photos_after: insertPayload.photos_after,
        photos_invoice: insertPayload.photos_invoice,
        invoice_number: insertPayload.invoice_number,
        cost_estimate: insertPayload.cost_estimate,
        manager_name: insertPayload.manager_name,
        manager_signature_url: insertPayload.manager_signature_url,
        notes: insertPayload.notes,
        is_after_hours: isAfterHours,
        warranty_days: !isNaN(parsedWarrantyDays) && [30, 60, 90].includes(parsedWarrantyDays) ? parsedWarrantyDays : null
      })
      emailNotified = emailRes.success
    } catch (emailErr) {
      console.warn('[mantenimiento] No se pudo despachar correo a raquel@tacosgavilan.com:', emailErr)
    }

    return NextResponse.json({
      success: true,
      message: 'Actividad de mantenimiento registrada exitosamente',
      emailNotified,
      data: insertedRecord
    }, { status: 201 })
  } catch (err: any) {
    console.error('[mantenimiento] Excepción en POST:', err)
    return NextResponse.json({ success: false, error: err.message || 'Error interno al guardar registro' }, { status: 500 })
  }
}

// ============================================================================
// PATCH /api/mantenimiento (Actualización de Estado, Factura, Costo y Validación)
// ============================================================================
export async function PATCH(request: NextRequest) {
  try {
    const auth = verifyMaintenanceAuth(request, false)
    if (!auth.authorized) {
      return NextResponse.json({ success: false, error: auth.error }, { status: auth.status || 401 })
    }

    const supabase = await getSupabaseAdminClient()
    const body = await request.json()
    const {
      id,
      status,
      invoice_number,
      cost_estimate,
      notes,
      photos_invoice,
      manager_name,
      manager_signature_url
    } = body

    if (!id || typeof id !== 'string' || !id.trim()) {
      return NextResponse.json({ success: false, error: 'Se requiere el ID del registro a actualizar' }, { status: 400 })
    }

    const updatePayload: Record<string, any> = {}

    if (status !== undefined) {
      if (!ALLOWED_STATUSES.includes(String(status))) {
        return NextResponse.json({ success: false, error: 'Estado de servicio no válido' }, { status: 400 })
      }
      updatePayload.status = String(status)
    }

    if (invoice_number !== undefined) {
      updatePayload.invoice_number = invoice_number ? String(invoice_number).trim().slice(0, 80) : null
    }

    if (cost_estimate !== undefined) {
      if (cost_estimate === null || String(cost_estimate).trim() === '') {
        updatePayload.cost_estimate = null
      } else {
        const cleaned = parseFloat(String(cost_estimate).replace(/[^0-9.]/g, ''))
        if (!isNaN(cleaned) && isFinite(cleaned) && cleaned >= 0) {
          updatePayload.cost_estimate = Math.round(cleaned * 100) / 100
        }
      }
    }

    if (notes !== undefined) {
      updatePayload.notes = notes ? String(notes).trim().slice(0, 1000) : null
    }

    if (photos_invoice !== undefined) {
      updatePayload.photos_invoice = sanitizePhotoUrls(photos_invoice)
    }

    if (manager_name !== undefined && String(manager_name).trim()) {
      updatePayload.manager_name = String(manager_name).trim().slice(0, 150)
    }

    if (manager_signature_url !== undefined) {
      updatePayload.manager_signature_url =
        typeof manager_signature_url === 'string' && manager_signature_url.trim().startsWith('http')
          ? manager_signature_url.trim()
          : null
    }

    if (Object.keys(updatePayload).length === 0) {
      return NextResponse.json({ success: false, error: 'No se enviaron campos para actualizar' }, { status: 400 })
    }

    const { data: updatedRecord, error: updateError } = await supabase
      .from('maintenance_service_logs')
      .update(updatePayload)
      .eq('id', id.trim())
      .select('*')
      .single()

    if (updateError) {
      console.error('[mantenimiento] Error al actualizar registro:', updateError)
      return NextResponse.json({ success: false, error: updateError.message }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      message: 'Registro de mantenimiento actualizado exitosamente',
      data: updatedRecord
    })
  } catch (err: any) {
    console.error('[mantenimiento] Excepción en PATCH:', err)
    return NextResponse.json(
      { success: false, error: err.message || 'Error interno al actualizar el registro' },
      { status: 500 }
    )
  }
}

// ============================================================================
// DELETE /api/mantenimiento?id={uuid} (Eliminación de Registro + Fotos en Storage)
// ============================================================================
export async function DELETE(request: NextRequest) {
  try {
    const auth = verifyMaintenanceAuth(request, true)
    if (!auth.authorized) {
      return NextResponse.json({ success: false, error: auth.error }, { status: auth.status || 401 })
    }

    const supabase = await getSupabaseAdminClient()
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')?.trim()

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'Se requiere el ID del registro de mantenimiento a eliminar' },
        { status: 400 }
      )
    }

    // 1. Consultar el registro primero para obtener todas las URLs de fotos y firma digital
    const { data: existingLog, error: fetchError } = await supabase
      .from('maintenance_service_logs')
      .select('id, photos_before, photos_after, photos_invoice, manager_signature_url')
      .eq('id', id)
      .maybeSingle()

    if (fetchError) {
      console.error('[mantenimiento] Error al buscar registro para eliminar:', fetchError)
      return NextResponse.json({ success: false, error: fetchError.message }, { status: 500 })
    }

    if (!existingLog) {
      return NextResponse.json(
        { success: false, error: 'El registro de mantenimiento no existe o ya fue eliminado' },
        { status: 404 }
      )
    }

    // 2. Extraer las rutas internas de Supabase Storage del bucket 'checklist-photos'
    const allUrls: string[] = [
      ...(Array.isArray(existingLog.photos_before) ? existingLog.photos_before : []),
      ...(Array.isArray(existingLog.photos_after) ? existingLog.photos_after : []),
      ...(Array.isArray(existingLog.photos_invoice) ? existingLog.photos_invoice : []),
      ...(existingLog.manager_signature_url ? [existingLog.manager_signature_url] : [])
    ].filter((u): u is string => typeof u === 'string' && u.trim().length > 0)

    const bucketName = 'checklist-photos'
    const marker = `/storage/v1/object/public/${bucketName}/`
    const filesToRemove: string[] = []

    for (const url of allUrls) {
      const idx = url.indexOf(marker)
      if (idx !== -1) {
        const rawPath = url.slice(idx + marker.length).split('?')[0]
        const decodedPath = decodeURIComponent(rawPath)
        if (decodedPath && decodedPath.startsWith('maintenance/')) {
          filesToRemove.push(decodedPath)
        }
      } else if (url.startsWith('maintenance/')) {
        filesToRemove.push(url.split('?')[0])
      }
    }

    // 3. Purgar archivos físicos del bucket de Storage si existen
    let filesDeletedCount = 0
    if (filesToRemove.length > 0) {
      try {
        const { error: storageRemoveError } = await supabase.storage
          .from(bucketName)
          .remove(filesToRemove)

        if (storageRemoveError) {
          console.warn('[mantenimiento] Advertencia al purgar fotos de Storage:', storageRemoveError.message)
        } else {
          filesDeletedCount = filesToRemove.length
          console.log(`[mantenimiento] ${filesDeletedCount} archivos eliminados de Storage para el registro ${id}:`, filesToRemove)
        }
      } catch (storageEx: any) {
        console.warn('[mantenimiento] Excepción no bloqueante al limpiar Storage:', storageEx?.message)
      }
    }

    // 4. Ejecutar eliminación del registro en base de datos
    const { error: deleteError } = await supabase
      .from('maintenance_service_logs')
      .delete()
      .eq('id', id)

    if (deleteError) {
      console.error('[mantenimiento] Error al eliminar registro:', deleteError)
      return NextResponse.json({ success: false, error: deleteError.message }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      message: 'Registro de mantenimiento y sus evidencias fotográficas eliminados exitosamente',
      deletedId: id,
      deletedFilesCount: filesDeletedCount
    })
  } catch (err: any) {
    console.error('[mantenimiento] Excepción en DELETE:', err)
    return NextResponse.json(
      { success: false, error: err.message || 'Error interno al procesar la eliminación' },
      { status: 500 }
    )
  }
}
