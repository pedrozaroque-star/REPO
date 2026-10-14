/**
 * @module api/mobile/menu
 * @description Endpoint público que devuelve el catálogo de menú y grupos de modificadores por platillo para una sucursal.
 *
 * @businessRules
 * - Lee de `public.app_menu_cache` filtrado por `store_id` e `is_available = true`.
 * - Adjunta a cada platillo (`modifierGroups`) exclusivamente los grupos de modificadores que le corresponden
 *   (ej. Hielo en aguas frescas, Tipo de Tortilla obligatoria en platos, cero modificadores en postres/aguas embotelladas).
 * - Emite `catalogMetadata` explícito identificando la fuente (`LEGACY_CACHE_UNRECONCILED`, `purchasable: false`)
 *   mientras Toast POS mantiene bloqueados los scopes `menus.channel:read` / `menus:read` y `/orders/v2/prices`.
 *
 * @dataFlow
 * - GET /api/mobile/menu?storeId=N&channel=PICKUP -> Supabase `app_menu_cache` -> `{ categories, modifierGroups, catalogMetadata }`.
 *
 * @notes
 * - Se adjunta `modifierGroups` directamente en cada ítem además del diccionario `modifierGroups` para evitar pérdida
 *   de variaciones por platillo y proveer `optionGroupGuid` en cada opción.
 */

import { type NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { corsResponse, jsonOk, jsonError } from '../_helpers'

interface ModifierOption {
  guid: string
  optionGroupGuid: string
  name: string
  price: number
  isDefault?: boolean
  imageUrl?: string | null
}

interface ModifierGroup {
  name: string
  guid: string
  minSelections: number
  maxSelections: number
  required: boolean
  isMultiSelect: boolean
  options: ModifierOption[]
}

interface MenuItemResponse {
  id: string
  guid: string
  toastGuid: string
  name: string
  description: string | null
  price: number
  imageUrl: string | null
  modifierGroupIds: string[]
  modifierGroups: ModifierGroup[]
}

interface MenuCacheRow {
  id: string
  toast_item_guid: string
  category_name: string
  name: string
  description: string | null
  price: number
  image_url: string | null
  modifier_groups_json: ModifierGroupJson[] | null
  last_synced: string | null
}

interface ModifierGroupJson {
  guid: string
  name: string
  minSelections?: number
  maxSelections?: number
  required?: boolean
  isMultiSelect?: boolean
  options?: ModifierOptionJson[]
}

interface ModifierOptionJson {
  guid: string
  name: string
  price?: number
  isDefault?: boolean
  imageUrl?: string | null
}

const MENU_SELECT =
  'id, toast_item_guid, category_name, name, description, price, image_url, modifier_groups_json, last_synced' as const

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url)
    const storeIdParam = searchParams.get('storeId')
    const channelParam = (searchParams.get('channel') || 'PICKUP').toUpperCase()

    if (!storeIdParam) {
      return jsonError('El parámetro storeId es requerido', 400)
    }

    const storeId = parseInt(storeIdParam, 10)
    if (isNaN(storeId) || storeId <= 0) {
      return jsonError('storeId debe ser un número entero positivo', 400)
    }

    // Ordenar estrictamente por last_synced ASC (que codifica la secuencia exacta de Toast Online Ordering:
    // Online Menu -> Online Drinks -> Desayunos (Toast), respetando el orden de grupos e ítems de Toast)
    const { data, error } = await supabaseAdmin
      .from('app_menu_cache')
      .select(MENU_SELECT)
      .eq('store_id', storeId)
      .eq('is_available', true)
      .order('last_synced', { ascending: true })
      .order('id', { ascending: true })

    if (error) {
      console.error('❌ [mobile/menu] Error al consultar menú:', error.message)
      return jsonError('Error al obtener el menú', 500)
    }

    const rows = (data ?? []) as MenuCacheRow[]

    const categories: Record<string, MenuItemResponse[]> = {}
    const modifierGroups: Record<string, ModifierGroup> = {}
    let latestSyncedAt: string | null = null

    for (const row of rows) {
      if (row.last_synced && (!latestSyncedAt || row.last_synced > latestSyncedAt)) {
        latestSyncedAt = row.last_synced
      }

      const categoryName = row.category_name || 'Otros'
      if (!categories[categoryName]) {
        categories[categoryName] = []
      }

      const modGroupIds: string[] = []
      const itemModifierGroups: ModifierGroup[] = []
      const rawModGroups = row.modifier_groups_json

      if (rawModGroups && Array.isArray(rawModGroups)) {
        for (const group of rawModGroups) {
          if (!group.guid || !group.name) continue

          const optsList = group.options ?? []
          const minSel = group.minSelections ?? 0
          const isMulti = Boolean(group.isMultiSelect) || (group.maxSelections ?? 0) > 1
          const maxSel =
            group.maxSelections && group.maxSelections > 0
              ? group.maxSelections
              : isMulti
                ? Math.max(1, optsList.length)
                : 1

          const normalizedGroup: ModifierGroup = {
            guid: group.guid,
            name: group.name,
            minSelections: minSel,
            maxSelections: maxSel,
            required: Boolean(group.required) || minSel > 0,
            isMultiSelect: isMulti || maxSel > 1,
            options: optsList.map((opt) => ({
              guid: opt.guid,
              optionGroupGuid: group.guid,
              name: opt.name,
              price: Number(opt.price ?? 0),
              isDefault: Boolean(opt.isDefault),
              imageUrl: opt.imageUrl ?? null,
            })),
          }

          modGroupIds.push(group.guid)
          itemModifierGroups.push(normalizedGroup)

          if (!modifierGroups[group.guid]) {
            modifierGroups[group.guid] = normalizedGroup
          }
        }
      }

      categories[categoryName].push({
        id: row.id,
        guid: row.toast_item_guid,
        toastGuid: row.toast_item_guid,
        name: row.name,
        description: row.description,
        price: Number(row.price),
        imageUrl: row.image_url,
        modifierGroupIds: modGroupIds,
        modifierGroups: itemModifierGroups,
      })
    }

    const categoryOrder = Object.keys(categories)

    const catalogMetadata = {
      source: 'LEGACY_CACHE_UNRECONCILED' as const,
      isReconciledWithToastMenusV3: false,
      purchasable: false,
      storeId,
      channel: channelParam,
      lastSyncedAt: latestSyncedAt,
      warning:
        'Catálogo de sucursal sincronizado con el orden, fotografías y modificadores de Toast Online Ordering. El cierre de orden nativa permanece en espera de habilitación de scopes de escritura Toast POS.',
    }

    return jsonOk({ categories, categoryOrder, modifierGroups, catalogMetadata })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error desconocido'
    console.error('❌ [mobile/menu] Error inesperado:', message)
    return jsonError('Error interno del servidor', 500)
  }
}

export async function OPTIONS(): Promise<NextResponse> {
  return corsResponse()
}
