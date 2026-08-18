/**
 * @module app/api/inventory/supplier-prices/suppliers/route
 * @description Endpoint para la creación y gestión de proveedores en el Radar de Precios.
 *   Permite a los administradores registrar nuevos proveedores (ej. Sysco, US Foods, Shamrock, distribuidores locales)
 *   directamente desde la interfaz para auditar cotizaciones y listas de precios.
 *
 * @businessRules
 *   - El nombre del proveedor debe ser único.
 *   - Genera automáticamente un código único en mayúsculas (supplier_code) si no se provee.
 *   - Habilita al proveedor de inmediato para mapeo de productos y comparaciones de inflación.
 *
 * @dataFlow
 *   Frontend (Modal + Nuevo Proveedor) -> POST -> suppliers (Supabase) -> Actualización instantánea en el selector del Radar.
 *
 * @notes
 *   - Cumple con las políticas RLS y estándares de arquitectura multi-proveedor de Tacos Gavilan.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { name, supplier_code, category = 'general', portal_url, notes } = body

    if (!name || typeof name !== 'string' || !name.trim()) {
      return NextResponse.json({ success: false, error: 'El nombre del proveedor es obligatorio' }, { status: 400 })
    }

    const cleanName = name.trim()
    const cleanCode = (supplier_code || cleanName.replace(/[^a-zA-Z0-9]/g, '_')).toUpperCase().substring(0, 30)

    const supabase = await getSupabaseAdminClient()

    // 1. Verificar si ya existe
    const { data: existing } = await supabase
      .from('suppliers')
      .select('id, name')
      .or(`name.ilike.${cleanName},supplier_code.eq.${cleanCode}`)
      .limit(1)

    if (existing && existing.length > 0) {
      return NextResponse.json({
        success: false,
        error: `Ya existe un proveedor con el nombre "${cleanName}" o código "${cleanCode}".`
      }, { status: 400 })
    }

    // 2. Insertar nuevo proveedor
    const { data: newSupplier, error: insertErr } = await supabase
      .from('suppliers')
      .insert({
        name: cleanName,
        supplier_code: cleanCode,
        category: category || 'general',
        portal_url: portal_url ? portal_url.trim() : null,
        notes: notes ? notes.trim() : null,
        is_active: true
      })
      .select()
      .single()

    if (insertErr) {
      throw insertErr
    }

    return NextResponse.json({
      success: true,
      supplier: newSupplier
    })
  } catch (error: any) {
    console.error('[CreateSupplierAPI] Error:', error)
    return NextResponse.json({ success: false, error: error.message || 'Error al crear el proveedor' }, { status: 500 })
  }
}
