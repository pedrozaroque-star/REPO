/**
 * @module app/api/mobile/stores/route
 * @description Endpoint público de consulta de las 15 sucursales oficiales activas de Tacos Gavilan.
 *
 * @businessRules
 * - Retorna únicamente sucursales activas (`is_active = true`) con coordenadas GPS reales (`latitude`, `longitude`).
 * - No requiere sesión autenticada para permitir que comensales invitados seleccionen sucursal antes de iniciar sesión.
 *
 * @dataFlow
 * - App Móvil GET `/api/mobile/stores` -> Consulta `public.stores` -> Retorna arreglo ordenado alfabéticamente.
 *
 * @notes
 * - Sincronizado con los identificadores numéricos `1..15` de sucursales en Supabase.
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { corsResponse, jsonOk, jsonError } from '../_helpers'

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
