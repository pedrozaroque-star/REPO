import { type NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import {
  corsResponse,
  jsonOk,
  jsonError,
  getAuthUser,
  isAuthSuccess,
} from '../_helpers'

// ============================================================================
// /api/mobile/favorites — Combinaciones favoritas (protegido)
// ============================================================================
// Permite al usuario guardar y recuperar sus combinaciones favoritas.
// Cada favorito es un snapshot de ítems del carrito con un nombre personalizado.
//
// Métodos:
//   GET  — Listar favoritos del usuario autenticado
//   POST — Guardar un nuevo favorito
// ============================================================================

// --- Tipos ---

/** Modificador dentro de un ítem favorito */
interface FavoriteModifier {
  guid: string
  name: string
  price: number
}

/** Estructura de un ítem dentro de un favorito */
interface FavoriteItem {
  itemGuid: string
  name: string
  price: number
  quantity: number
  modifiers: FavoriteModifier[]
}

/** Cuerpo del POST request */
interface FavoritePostBody {
  name: string
  items: FavoriteItem[]
  storeId: number
}

/** Fila de la tabla app_favorite_orders */
interface FavoriteRow {
  id: string
  store_id: number
  name: string
  items_json: FavoriteItem[]
  created_at: string
}

/** Favorito formateado para la respuesta de la API */
interface FavoriteResponse {
  id: string
  storeId: number
  name: string
  items: FavoriteItem[]
  createdAt: string
}

// ============================================================================
// GET — Listar favoritos del usuario autenticado
// ============================================================================
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const auth = await getAuthUser(request)
    if (!isAuthSuccess(auth)) {
      return jsonError(auth.error, 401)
    }

    const { data, error } = await supabaseAdmin
      .from('app_favorite_orders')
      .select('id, store_id, name, items_json, created_at')
      .eq('user_id', auth.userId)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('❌ [mobile/favorites] Error al obtener favoritos:', error.message)
      return jsonError('Error al obtener los favoritos', 500)
    }

    const rows = (data ?? []) as FavoriteRow[]

    // Mapear a formato camelCase para la respuesta
    const favorites: FavoriteResponse[] = rows.map((row) => ({
      id: row.id,
      storeId: row.store_id,
      name: row.name,
      items: row.items_json ?? [],
      createdAt: row.created_at,
    }))

    return jsonOk({ favorites })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error desconocido'
    console.error('❌ [mobile/favorites] GET Error inesperado:', message)
    return jsonError('Error interno del servidor', 500)
  }
}

// ============================================================================
// POST — Guardar un nuevo favorito
// ============================================================================
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const auth = await getAuthUser(request)
    if (!isAuthSuccess(auth)) {
      return jsonError(auth.error, 401)
    }

    // Parsear y validar el cuerpo del request
    let body: FavoritePostBody
    try {
      body = await request.json() as FavoritePostBody
    } catch {
      return jsonError('Cuerpo del request inválido (JSON esperado)', 400)
    }

    // Validar nombre
    if (!body.name || typeof body.name !== 'string' || body.name.trim().length === 0) {
      return jsonError('El campo "name" es requerido', 400)
    }

    const trimmedName = body.name.trim()
    if (trimmedName.length > 100) {
      return jsonError('El nombre no puede exceder 100 caracteres', 400)
    }

    // Validar items
    if (!body.items || !Array.isArray(body.items) || body.items.length === 0) {
      return jsonError('El campo "items" es requerido y debe tener al menos un ítem', 400)
    }

    // Validar storeId
    if (!body.storeId || typeof body.storeId !== 'number' || body.storeId <= 0) {
      return jsonError('El campo "storeId" es requerido y debe ser un número positivo', 400)
    }

    // Validar estructura de cada ítem
    for (const item of body.items) {
      if (!item.itemGuid || typeof item.itemGuid !== 'string') {
        return jsonError('Cada ítem requiere un "itemGuid" válido', 400)
      }
      if (typeof item.quantity !== 'number' || item.quantity < 1) {
        return jsonError(`Cantidad inválida para el ítem "${item.name || item.itemGuid}"`, 400)
      }
    }

    // Limitar la cantidad de favoritos por usuario (máximo 20)
    const { count, error: countError } = await supabaseAdmin
      .from('app_favorite_orders')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', auth.userId)

    if (countError) {
      console.error('❌ [mobile/favorites] Error al contar favoritos:', countError.message)
      return jsonError('Error al verificar límite de favoritos', 500)
    }

    if (count !== null && count >= 20) {
      return jsonError('Has alcanzado el límite de 20 favoritos. Elimina uno antes de agregar más.', 400)
    }

    // Insertar el nuevo favorito
    const { data, error } = await supabaseAdmin
      .from('app_favorite_orders')
      .insert({
        user_id: auth.userId,
        store_id: body.storeId,
        name: trimmedName,
        items_json: body.items,
      })
      .select('id, store_id, name, items_json, created_at')
      .single()

    if (error) {
      console.error('❌ [mobile/favorites] Error al guardar favorito:', error.message)
      return jsonError('Error al guardar el favorito', 500)
    }

    const row = data as FavoriteRow

    const favorite: FavoriteResponse = {
      id: row.id,
      storeId: row.store_id,
      name: row.name,
      items: row.items_json ?? [],
      createdAt: row.created_at,
    }

    return jsonOk({ favorite }, 201)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error desconocido'
    console.error('❌ [mobile/favorites] POST Error inesperado:', message)
    return jsonError('Error interno del servidor', 500)
  }
}

// ============================================================================
// OPTIONS — Preflight CORS
// ============================================================================
export async function OPTIONS(): Promise<NextResponse> {
  return corsResponse()
}
