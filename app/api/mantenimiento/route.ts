/**
 * @module api/mantenimiento
 * @description API route principal para el Registro de Actividades de Mantenimiento y Proveedores de Tacos Gavilan.
 * @businessRules
 * - GET: Protegido con autenticación JWT (teg_token). Retorna la bitácora de mantenimientos con soporte de filtros
 *   por sucursal, categoría, estado y rango de fechas, además de métricas globales (KPIs) en tiempo real.
 * - POST: Permite el registro público de actividades de técnicos y proveedores desde el portal QR móvil, validando
 *   estrictamente sucursal existente, categoría, tipo de servicio, evidencias fotográficas y firma digital del encargado.
 * - DELETE: Protegido exclusivamente para roles 'admin' y 'supervisor'. Elimina permanentemente un registro de
 *   mantenimiento por su ID único, purgando también todas sus evidencias fotográficas, PDFs y firmas del bucket
 *   'checklist-photos' en Supabase Storage.
 * - En cada registro exitoso, genera notificaciones de sistema para supervisores y administradores.
 * - Las fechas y horas respetan la zona horaria oficial 'America/Los_Angeles' y la jornada de 6:00 AM a 5:59 AM.
 * @dataFlow
 * - Frontend (Portal QR Móvil / Panel Admin) -> /api/mantenimiento -> PostgreSQL (maintenance_service_logs & stores)
 *   & Supabase Storage (checklist-photos).
 * @notes
 * - Utiliza getSupabaseAdminClient() en el servidor tras validar permisos y entradas.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/supabase'
import { verifyAuthToken, getCronSecret } from '@/lib/auth-server'

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
    let matchedStore: { id: string | number; name: string; code?: string } | undefined

    if (rawStoreParam === 'bodega' || rawStoreParam === 'la bodega') {
      matchedStore = BODEGA_LOCATION
    } else {
      const { data: storesList } = await supabase
        .from('stores')
        .select('id, name, code')

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

    // Generar notificación del sistema para supervisores y administradores
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

    return NextResponse.json({
      success: true,
      message: 'Actividad de mantenimiento registrada exitosamente',
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
