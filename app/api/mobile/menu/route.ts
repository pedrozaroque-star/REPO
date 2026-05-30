import { type NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { corsResponse, jsonOk, jsonError } from '../_helpers'

// ============================================================================
// GET /api/mobile/menu?storeId=N — Menú por sucursal (público)
// ============================================================================
// Devuelve el menú de una tienda específica, agrupado por categorías.
// También extrae y devuelve los grupos de modificadores (extras, toppings, etc.)
// para que la app pueda renderizar los selectores de personalización.
// ============================================================================

// --- Tipos internos ---

/** Modificador individual dentro de un grupo (ej: "Extra Queso", "+$1.50") */
interface ModifierOption {
  guid: string
  name: string
  price: number
}

/** Grupo de modificadores (ej: "Extras", "Salsas", "Tipo de Tortilla") */
interface ModifierGroup {
  name: string
  guid: string
  minSelections: number
  maxSelections: number
  options: ModifierOption[]
}

/** Ítem de menú tal como se devuelve en la respuesta */
interface MenuItemResponse {
  id: string
  toastGuid: string
  name: string
  description: string | null
  price: number
  imageUrl: string | null
  modifierGroupIds: string[]
}

/** Fila cruda de la tabla app_menu_cache */
interface MenuCacheRow {
  id: string
  toast_item_guid: string
  category_name: string
  name: string
  description: string | null
  price: number
  image_url: string | null
  modifier_groups_json: ModifierGroupJson[] | null
}

/** Estructura JSON almacenada en modifier_groups_json */
interface ModifierGroupJson {
  guid: string
  name: string
  minSelections?: number
  maxSelections?: number
  options?: ModifierOptionJson[]
}

/** Opción dentro del JSON de un grupo de modificadores */
interface ModifierOptionJson {
  guid: string
  name: string
  price?: number
}

// --- Columnas a seleccionar ---
const MENU_SELECT = 'id, toast_item_guid, category_name, name, description, price, image_url, modifier_groups_json' as const

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    // Extraer y validar el parámetro storeId
    const { searchParams } = new URL(request.url)
    const storeIdParam = searchParams.get('storeId')

    if (!storeIdParam) {
      return jsonError('El parámetro storeId es requerido', 400)
    }

    const storeId = parseInt(storeIdParam, 10)
    if (isNaN(storeId) || storeId <= 0) {
      return jsonError('storeId debe ser un número entero positivo', 400)
    }

    // Consultar la tabla app_menu_cache para esta sucursal
    const { data, error } = await supabaseAdmin
      .from('app_menu_cache')
      .select(MENU_SELECT)
      .eq('store_id', storeId)
      .eq('is_available', true)
      .order('category_name', { ascending: true })
      .order('name', { ascending: true })

    if (error) {
      console.error('❌ [mobile/menu] Error al consultar menú:', error.message)
      return jsonError('Error al obtener el menú', 500)
    }

    const rows = (data ?? []) as MenuCacheRow[]

    // ---- Agrupar por categoría y extraer modifier groups ----
    const categories: Record<string, MenuItemResponse[]> = {}
    const modifierGroups: Record<string, ModifierGroup> = {}

    for (const row of rows) {
      const categoryName = row.category_name || 'Otros'

      // Inicializar la categoría si no existe
      if (!categories[categoryName]) {
        categories[categoryName] = []
      }

      // Parsear modifier_groups_json y acumular IDs de grupo
      const modGroupIds: string[] = []
      const rawModGroups = row.modifier_groups_json

      if (rawModGroups && Array.isArray(rawModGroups)) {
        for (const group of rawModGroups) {
          if (!group.guid || !group.name) continue

          modGroupIds.push(group.guid)

          // Si aún no hemos registrado este grupo, agregarlo al mapa global
          if (!modifierGroups[group.guid]) {
            modifierGroups[group.guid] = {
              guid: group.guid,
              name: group.name,
              minSelections: group.minSelections ?? 0,
              maxSelections: group.maxSelections ?? 10,
              options: (group.options ?? []).map((opt) => ({
                guid: opt.guid,
                name: opt.name,
                price: opt.price ?? 0,
              })),
            }
          }
        }
      }

      // Agregar el ítem a su categoría
      categories[categoryName].push({
        id: row.id,
        toastGuid: row.toast_item_guid,
        name: row.name,
        description: row.description,
        price: row.price,
        imageUrl: row.image_url,
        modifierGroupIds: modGroupIds,
      })
    }

    return jsonOk({ categories, modifierGroups })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error desconocido'
    console.error('❌ [mobile/menu] Error inesperado:', message)
    return jsonError('Error interno del servidor', 500)
  }
}

// ============================================================================
// OPTIONS — Preflight CORS
// ============================================================================
export async function OPTIONS(): Promise<NextResponse> {
  return corsResponse()
}
