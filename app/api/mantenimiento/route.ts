/**
 * @module api/mantenimiento
 * @description API route principal para el Registro de Actividades de Mantenimiento y Proveedores de Tacos Gavilan.
 * @businessRules
 * - GET: Retorna la bitácora de mantenimientos con soporte de filtros por sucursal, categoría, estado y rango de fechas.
 * - Soporta parámetro ?summary=true para entregar métricas ejecutivas y semáforo de mantenimientos recurrentes
 *   (lavado de campanas, trampas de grasa y control de plagas) por cada sucursal.
 * - POST: Permite el registro público de actividades de técnicos y proveedores sin requerir inicio de sesión previo.
 * - DELETE: Permite a administradores eliminar permanentemente un registro de mantenimiento por su ID único, purgando también todas sus evidencias fotográficas y firmas del bucket 'checklist-photos' en Supabase Storage.
 * - Valida campos mandatorios (tienda, proveedor, técnico, categoría, equipo/área, descripción de trabajo, encargado).
 * - En cada registro exitoso, genera notificaciones de sistema para supervisores y administradores.
 * - Las fechas y horas respetan la zona horaria oficial 'America/Los_Angeles' y la jornada de 6:00 AM a 5:59 AM.
 * @dataFlow
 * - Frontend (Kiosco / Formulario Móvil / Panel Admin) -> /api/mantenimiento -> PostgreSQL (maintenance_service_logs & stores) & Supabase Storage (checklist-photos).
 * @notes
 * - Utiliza getSupabaseAdminClient() para garantizar transacciones de lectura, escritura y eliminación segura de datos y archivos.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

/**
 * Obtiene la fecha de negocio actual en 'America/Los_Angeles' considerando que el día
 * laboral inicia a las 6:00 AM y termina a las 5:59 AM del día siguiente.
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
      .order('id')

    const storesMap = new Map<string, any>()
    storesList?.forEach(s => {
      storesMap.set(String(s.id), s)
    })

    // Si se solicitó solo o además el resumen operativo:
    if (summary) {
      const businessDate = getBusinessDatePST()
      const [currYear, currMonth] = businessDate.split('-')
      const firstDayOfMonth = `${currYear}-${currMonth}-01`

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
      const sanitized = search.replace(/[,()]/g, ' ').trim()
      if (sanitized) {
        query = query.or(
          `company_name.ilike.%${sanitized}%,technician_name.ilike.%${sanitized}%,area_equipment.ilike.%${sanitized}%,work_description.ilike.%${sanitized}%,invoice_number.ilike.%${sanitized}%`
        )
      }
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

    // Validación estricta de evidencia fotográfica obligatoria
    const hasPhotosBefore = Array.isArray(photos_before) && photos_before.length > 0
    const hasPhotosAfter = Array.isArray(photos_after) && photos_after.length > 0
    const hasPhotosInvoice = Array.isArray(photos_invoice) && photos_invoice.length > 0

    if (!hasPhotosBefore && !hasPhotosAfter && !hasPhotosInvoice) {
      return NextResponse.json({
        success: false,
        error: 'Es obligatorio adjuntar al menos una fotografía como evidencia del servicio (antes, después o factura/ticket)'
      }, { status: 400 })
    }

    const officialDate = service_date || getBusinessDatePST()

    // Sanitizar y validar costo estimado para evitar PostgresError 22P02 con NaN
    let safeCostEstimate: number | null = null
    if (cost_estimate !== undefined && cost_estimate !== null && cost_estimate !== '') {
      const cleaned = typeof cost_estimate === 'string'
        ? parseFloat(cost_estimate.replace(/[^0-9.]/g, ''))
        : Number(cost_estimate)
      if (!isNaN(cleaned) && isFinite(cleaned)) {
        safeCostEstimate = Math.round(cleaned * 100) / 100
      }
    }

    // Preparar objeto de inserción atómico (sin columnas autogeneradas)
    const insertPayload: Record<string, any> = {
      store_id: String(store_id).trim(),
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
      cost_estimate: safeCostEstimate,
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
    const parsedStoreId = parseInt(String(store_id), 10)
    if (!isNaN(parsedStoreId)) {
      try {
        const { data: storeData } = await supabase
          .from('stores')
          .select('name, address')
          .eq('id', parsedStoreId)
          .maybeSingle()
        if (storeData) {
          storeDisplayName = storeData.name
        }
      } catch {
        // Fallback seguro
      }
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
          user_id: String(u.id),
          title: `🛠️ Servicio Registrado: ${company_name.trim()}`,
          message: `${technician_name.trim()} completó servicio de ${category} (${area_equipment.trim()}) en ${storeDisplayName}. Validado por ${manager_name.trim()}.`,
          type: 'maintenance',
          read: false,
          is_read: false,
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
// DELETE: Eliminar Registro de Actividad de Proveedor / Mantenimiento
// ============================================================================
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await getSupabaseAdminClient()
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')?.trim()

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'El parámetro ID es obligatorio para eliminar el registro' },
        { status: 400 }
      )
    }

    // 1. Verificar si el registro existe previamente y consultar las fotos/firmas asociadas
    const { data: existingRecord, error: findError } = await supabase
      .from('maintenance_service_logs')
      .select('id, company_name, technician_name, store_id, photos_before, photos_after, photos_invoice, manager_signature_url')
      .eq('id', id)
      .maybeSingle()

    if (findError) {
      console.error('[mantenimiento] Error al verificar registro previo para eliminar:', findError)
      return NextResponse.json({ success: false, error: findError.message }, { status: 500 })
    }

    if (!existingRecord) {
      return NextResponse.json(
        { success: false, error: 'El registro no fue encontrado o ya ha sido eliminado' },
        { status: 404 }
      )
    }

    // 2. Extraer rutas relativas de Supabase Storage para eliminar los archivos físicos
    const allUrls: string[] = [
      ...(Array.isArray(existingRecord.photos_before) ? existingRecord.photos_before : []),
      ...(Array.isArray(existingRecord.photos_after) ? existingRecord.photos_after : []),
      ...(Array.isArray(existingRecord.photos_invoice) ? existingRecord.photos_invoice : []),
      ...(existingRecord.manager_signature_url ? [existingRecord.manager_signature_url] : [])
    ]

    const filesToRemove: string[] = []
    const bucketName = 'checklist-photos'
    const bucketMarker = `/${bucketName}/`

    for (const url of allUrls) {
      if (!url || typeof url !== 'string') continue
      // Caso 1: URL pública de Supabase Storage con '/checklist-photos/'
      const markerIdx = url.indexOf(bucketMarker)
      if (markerIdx !== -1) {
        const rawPath = url.substring(markerIdx + bucketMarker.length).split('?')[0]
        const decodedPath = decodeURIComponent(rawPath)
        // Solo eliminamos archivos que pertenezcan a la carpeta de mantenimiento por seguridad
        if (decodedPath && decodedPath.startsWith('maintenance/')) {
          filesToRemove.push(decodedPath)
        }
      } else if (url.startsWith('maintenance/')) {
        // Caso 2: Ruta relativa directa
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

