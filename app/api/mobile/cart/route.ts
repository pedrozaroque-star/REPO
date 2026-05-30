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
// /api/mobile/cart — Carrito de compras persistente (protegido)
// ============================================================================
// Cada usuario tiene UN solo carrito (UNIQUE en user_id).
// El carrito se persiste en Supabase para sincronizar entre dispositivos.
//
// Métodos:
//   GET    — Obtener el carrito actual del usuario autenticado
//   PUT    — Crear o actualizar el carrito (upsert por user_id)
//   DELETE — Vaciar/eliminar el carrito del usuario
// ============================================================================

// --- Tipos ---

/** Estructura de un ítem del carrito almacenado en items_json */
interface CartItem {
  itemGuid: string
  name: string
  price: number
  quantity: number
  modifiers: CartModifier[]
}

/** Modificador seleccionado dentro de un ítem del carrito */
interface CartModifier {
  guid: string
  name: string
  price: number
}

/** Cuerpo del PUT request */
interface CartPutBody {
  items: CartItem[]
  storeId: number
}

/** Fila de la tabla app_carts */
interface CartRow {
  id: string
  store_id: number
  items_json: CartItem[]
  updated_at: string
}

// ============================================================================
// GET — Obtener carrito del usuario autenticado
// ============================================================================
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const auth = await getAuthUser(request)
    if (!isAuthSuccess(auth)) {
      return jsonError(auth.error, 401)
    }

    const { data, error } = await supabaseAdmin
      .from('app_carts')
      .select('id, store_id, items_json, updated_at')
      .eq('user_id', auth.userId)
      .maybeSingle()

    if (error) {
      console.error('❌ [mobile/cart] Error al obtener carrito:', error.message)
      return jsonError('Error al obtener el carrito', 500)
    }

    // Si no existe carrito, devolver uno vacío
    if (!data) {
      return jsonOk({
        cart: {
          items: [] as CartItem[],
          storeId: null as number | null,
          updatedAt: null as string | null,
        },
      })
    }

    const row = data as CartRow

    return jsonOk({
      cart: {
        items: row.items_json ?? [],
        storeId: row.store_id,
        updatedAt: row.updated_at,
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error desconocido'
    console.error('❌ [mobile/cart] GET Error inesperado:', message)
    return jsonError('Error interno del servidor', 500)
  }
}

// ============================================================================
// PUT — Crear o actualizar el carrito (upsert)
// ============================================================================
export async function PUT(request: NextRequest): Promise<NextResponse> {
  try {
    const auth = await getAuthUser(request)
    if (!isAuthSuccess(auth)) {
      return jsonError(auth.error, 401)
    }

    // Parsear y validar el cuerpo del request
    let body: CartPutBody
    try {
      body = await request.json() as CartPutBody
    } catch {
      return jsonError('Cuerpo del request inválido (JSON esperado)', 400)
    }

    if (!body.items || !Array.isArray(body.items)) {
      return jsonError('El campo "items" es requerido y debe ser un arreglo', 400)
    }

    if (!body.storeId || typeof body.storeId !== 'number' || body.storeId <= 0) {
      return jsonError('El campo "storeId" es requerido y debe ser un número positivo', 400)
    }

    // Validar que cada ítem tenga la estructura mínima necesaria
    for (const item of body.items) {
      if (!item.itemGuid || typeof item.itemGuid !== 'string') {
        return jsonError('Cada ítem requiere un "itemGuid" válido', 400)
      }
      if (typeof item.quantity !== 'number' || item.quantity < 1) {
        return jsonError(`Cantidad inválida para el ítem "${item.name || item.itemGuid}"`, 400)
      }
    }

    const now = new Date().toISOString()

    // Upsert: si ya existe un carrito para este user_id, se actualiza
    const { data, error } = await supabaseAdmin
      .from('app_carts')
      .upsert(
        {
          user_id: auth.userId,
          store_id: body.storeId,
          items_json: body.items,
          updated_at: now,
        },
        { onConflict: 'user_id' }
      )
      .select('id, store_id, items_json, updated_at')
      .single()

    if (error) {
      console.error('❌ [mobile/cart] Error al guardar carrito:', error.message)
      return jsonError('Error al guardar el carrito', 500)
    }

    const row = data as CartRow

    return jsonOk({
      cart: {
        items: row.items_json ?? [],
        storeId: row.store_id,
        updatedAt: row.updated_at,
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error desconocido'
    console.error('❌ [mobile/cart] PUT Error inesperado:', message)
    return jsonError('Error interno del servidor', 500)
  }
}

// ============================================================================
// DELETE — Eliminar el carrito del usuario
// ============================================================================
export async function DELETE(request: NextRequest): Promise<NextResponse> {
  try {
    const auth = await getAuthUser(request)
    if (!isAuthSuccess(auth)) {
      return jsonError(auth.error, 401)
    }

    const { error } = await supabaseAdmin
      .from('app_carts')
      .delete()
      .eq('user_id', auth.userId)

    if (error) {
      console.error('❌ [mobile/cart] Error al eliminar carrito:', error.message)
      return jsonError('Error al eliminar el carrito', 500)
    }

    return jsonOk({
      cart: {
        items: [] as CartItem[],
        storeId: null as number | null,
        updatedAt: null as string | null,
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error desconocido'
    console.error('❌ [mobile/cart] DELETE Error inesperado:', message)
    return jsonError('Error interno del servidor', 500)
  }
}

// ============================================================================
// OPTIONS — Preflight CORS
// ============================================================================
export async function OPTIONS(): Promise<NextResponse> {
  return corsResponse()
}
