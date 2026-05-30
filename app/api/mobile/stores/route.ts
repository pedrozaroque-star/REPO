import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { corsResponse, jsonOk, jsonError } from '../_helpers'

// ============================================================================
// GET /api/mobile/stores — Lista de sucursales activas (público)
// ============================================================================
// Devuelve todas las tiendas Tacos Gavilán activas con su ubicación.
// No requiere autenticación — la app necesita mostrar sucursales al usuario
// antes de que inicie sesión para elegir la más cercana.
// ============================================================================

/** Columnas seleccionadas de la tabla stores */
const STORE_SELECT_COLUMNS = 'id, name, address, city, latitude, longitude, phone' as const

export async function GET(): Promise<NextResponse> {
  try {
    const { data, error } = await supabaseAdmin
      .from('stores')
      .select(STORE_SELECT_COLUMNS)
      .eq('is_active', true)
      .order('name', { ascending: true })

    if (error) {
      console.error('❌ [mobile/stores] Error al consultar tiendas:', error.message)
      return jsonError('Error al obtener las sucursales', 500)
    }

    return jsonOk({ stores: data ?? [] })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error desconocido'
    console.error('❌ [mobile/stores] Error inesperado:', message)
    return jsonError('Error interno del servidor', 500)
  }
}

// ============================================================================
// OPTIONS — Preflight CORS
// ============================================================================
export async function OPTIONS(): Promise<NextResponse> {
  return corsResponse()
}
