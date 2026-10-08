/**
 * @module api/mantenimiento
 * @description API route principal para el Registro de Actividades de Mantenimiento y Proveedores de Tacos Gavilan.
 * @businessRules
 * - GET: Retorna la bitácora de mantenimientos con soporte de filtros por sucursal, categoría, estado y rango de fechas.
 * - Soporta parámetro ?summary=true para entregar métricas ejecutivas y semáforo de mantenimientos recurrentes
 *   (lavado de campanas, trampas de grasa y control de plagas) por cada sucursal.
 * - POST: Permite el registro público de actividades de técnicos y proveedores sin requerir inicio de sesión previo.
 * - Valida campos mandatorios (tienda, proveedor, técnico, categoría, equipo/área, descripción de trabajo, encargado).
 * - En cada registro exitoso, genera notificaciones de sistema para supervisores y administradores.
 * - Las fechas y horas respetan la zona horaria oficial 'America/Los_Angeles' y la jornada de 6:00 AM a 5:59 AM.
 * @dataFlow
 * - Frontend (Kiosco / Formulario Móvil / Panel Admin) -> /api/mantenimiento -> PostgreSQL (maintenance_service_logs & stores).
 * @notes
 * - Utiliza getSupabaseAdminClient() para garantizar transacciones de lectura y escritura seguras.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

/**
 * Obtiene la fecha de negocio actual en 'America/Los_Angeles' considerando que el día
 * laboral inicia a las 6:00 AM y termina a las 5:59 AM del día siguiente.
 */
function getBusinessDatePST(): string {
  const now = new Date()
  const laString = now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })
  const laDate = new Date(laString)
  const hour = laDate.getHours()

  // Si son antes de las 6:00 AM, el día de negocio corresponde a ayer
  if (hour < 6) {
    laDate.setDate(laDate.getDate() - 1)
  }

  const yyyy = laDate.getFullYear()
  const mm = String(laDate.getMonth() + 1).padStart(2, '0')
  const dd = String(laDate.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

// ============================================================================
// GET: Consultar Bitácora y Métricas
// ============================================================================
export async function GET(request: NextRequest) {
  try {
    const supabase = await getSupabaseAdminClient()
    const { searchParams } = new URL(request.url)

    const storeId = searchParams.get('store_id')
    const category = searchParams.get('category')
    const status = searchParams.get('status')
    const serviceType = searchParams.get('service_type')
    const from = searchParams.get('from')
    const to = searchParams.get('to')
    const search = searchParams.get('search')?.trim()
    const summary = searchParams.get('summary') === 'true'
    const limit = Math.min(parseInt(searchParams.get('limit') || '100', 10), 500)
    const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10), 0)

    // 1. Obtener catálogo de tiendas activas para enriquecer los registros
    const { data: storesList } = await supabase
      .from('stores')
      .select('id, name, code, city, address, is_active')
      .order('name')

    const storesMap = new Map<string, any>()
    storesList?.forEach(s => {
      storesMap.set(String(s.id), s)
    })

    // Si se solicitó solo o además el resumen operativo:
    if (summary) {
      const now = new Date()
      const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]

      // Logs del mes actual
      const { data: monthLogs } = await supabase
        .from('maintenance_service_logs')
        .select('id, store_id, category, status, service_date')
        .gte('service_date', firstDayOfMonth)

      const totalMonth = monthLogs?.length || 0
      const pendingParts = monthLogs?.filter(l => l.status === 'pending_parts').length || 0

      // Último servicio de categorías críticas por sucursal
      const { data: allRecurrent } = await supabase
        .from('maintenance_service_logs')
        .select('store_id, category, service_date')
        .in('category', ['hood_cleaning', 'grease_trap', 'pest_control'])
        .order('service_date', { ascending: false })

      const recurrentByStore: Record<string, { lastHood?: string; lastGreaseTrap?: string; lastPestControl?: string }> = {}
      allRecurrent?.forEach(r => {
        if (!recurrentByStore[r.store_id]) {
          recurrentByStore[r.store_id] = {}
        }
        if (r.category === 'hood_cleaning' && !recurrentByStore[r.store_id].lastHood) {
          recurrentByStore[r.store_id].lastHood = r.service_date
        }
        if (r.category === 'grease_trap' && !recurrentByStore[r.store_id].lastGreaseTrap) {
          recurrentByStore[r.store_id].lastGreaseTrap = r.service_date
        }
        if (r.category === 'pest_control' && !recurrentByStore[r.store_id].lastPestControl) {
          recurrentByStore[r.store_id].lastPestControl = r.service_date
        }
      })

      return NextResponse.json({
        success: true,
        summary: {
          totalMonth,
          pendingParts,
          recurrentByStore,
          stores: storesList || []
        }
      })
    }

    // 2. Consulta filtrada de registros
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
      query = query.or(
        `company_name.ilike.%${search}%,technician_name.ilike.%${search}%,area_equipment.ilike.%${search}%,work_description.ilike.%${search}%,invoice_number.ilike.%${search}%`
      )
    }

    const { data: logs, error, count } = await query

    if (error) {
      console.error('[mantenimiento] Error al consultar logs:', error)
      return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }

    // Unir metadatos de tienda
    const enrichedLogs = (logs || []).map(log => {
      const storeInfo = storesMap.get(String(log.store_id))
      return {
        ...log,
        store: storeInfo || {
          id: log.store_id,
          name: 'Sucursal ' + (log.store_id?.slice(0, 6) || ''),
          code: 'N/A'
        }
      }
    })

    return NextResponse.json({
      success: true,
      data: enrichedLogs,
      totalCount: count || 0,
      limit,
      offset,
      stores: storesList || []
    })
  } catch (err: any) {
    console.error('[mantenimiento] Excepción en GET:', err)
    return NextResponse.json({ success: false, error: err.message || 'Error interno del servidor' }, { status: 500 })
  }
}

// ============================================================================
// POST: Registrar Nueva Actividad de Proveedor / Mantenimiento
// ============================================================================
export async function POST(request: NextRequest) {
  try {
    const supabase = await getSupabaseAdminClient()
    const body = await request.json()

    const {
      store_id,
      service_date,
      start_time,
      end_time,
      company_name,
      technician_name,
      technician_phone,
      category,
      service_type = 'corrective',
      area_equipment,
      work_description,
      parts_replaced,
      status = 'completed',
      photos_before = [],
      photos_after = [],
      photos_invoice = [],
      invoice_number,
      cost_estimate,
      manager_name,
      manager_signature_url,
      notes
    } = body

    // Validaciones estrictas
    if (!store_id) {
      return NextResponse.json({ success: false, error: 'La sucursal (store_id) es obligatoria' }, { status: 400 })
    }
    if (!company_name?.trim()) {
      return NextResponse.json({ success: false, error: 'El nombre de la empresa proveedora es obligatorio' }, { status: 400 })
    }
    if (!technician_name?.trim()) {
      return NextResponse.json({ success: false, error: 'El nombre del técnico es obligatorio' }, { status: 400 })
    }
    if (!category?.trim()) {
      return NextResponse.json({ success: false, error: 'La categoría del servicio es obligatoria' }, { status: 400 })
    }
    if (!area_equipment?.trim()) {
      return NextResponse.json({ success: false, error: 'El equipo o área intervenida es obligatorio' }, { status: 400 })
    }
    if (!work_description?.trim()) {
      return NextResponse.json({ success: false, error: 'La descripción del trabajo realizado es obligatoria' }, { status: 400 })
    }
    if (!manager_name?.trim()) {
      return NextResponse.json({ success: false, error: 'El nombre del encargado en turno que validó la visita es obligatorio' }, { status: 400 })
    }

    const officialDate = service_date || getBusinessDatePST()

    // Preparar objeto de inserción atómico (sin columnas autogeneradas)
    const insertPayload: Record<string, any> = {
      store_id,
      service_date: officialDate,
      start_time: start_time || null,
      end_time: end_time || null,
      company_name: company_name.trim(),
      technician_name: technician_name.trim(),
      technician_phone: technician_phone?.trim() || null,
      category: category.trim(),
      service_type: service_type.trim(),
      area_equipment: area_equipment.trim(),
      work_description: work_description.trim(),
      parts_replaced: parts_replaced?.trim() || null,
      status: ['completed', 'pending_parts', 'follow_up_needed'].includes(status) ? status : 'completed',
      photos_before: Array.isArray(photos_before) ? photos_before : [],
      photos_after: Array.isArray(photos_after) ? photos_after : [],
      photos_invoice: Array.isArray(photos_invoice) ? photos_invoice : [],
      invoice_number: invoice_number?.trim() || null,
      cost_estimate: cost_estimate !== undefined && cost_estimate !== null && cost_estimate !== '' ? Number(cost_estimate) : null,
      manager_name: manager_name.trim(),
      manager_signature_url: manager_signature_url || null,
      notes: notes?.trim() || null
    }

    const { data: insertedRecord, error: insertError } = await supabase
      .from('maintenance_service_logs')
      .insert(insertPayload)
      .select()
      .single()

    if (insertError) {
      console.error('[mantenimiento] Error al insertar registro:', insertError)
      return NextResponse.json({ success: false, error: insertError.message }, { status: 500 })
    }

    // Buscar el nombre de la tienda para generar la notificación
    let storeDisplayName = 'la sucursal'
    try {
      const { data: storeData } = await supabase
        .from('stores')
        .select('name, code')
        .eq('id', store_id)
        .maybeSingle()
      if (storeData) {
        storeDisplayName = storeData.code ? `${storeData.name} #${storeData.code}` : storeData.name
      }
    } catch {
      // Fallback
    }

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
          title: `🛠️ Servicio Registrado: ${company_name.trim()}`,
          message: `${technician_name.trim()} completó servicio de ${category} (${area_equipment.trim()}) en ${storeDisplayName}. Validado por ${manager_name.trim()}.`,
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
