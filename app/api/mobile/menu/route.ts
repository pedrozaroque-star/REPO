/**
 * @module api/mobile/menu
 * @description Endpoint público que devuelve el catálogo de menú y grupos de modificadores por platillo para una sucursal.
 *
 * @businessRules
 * - Cuando `STOREFRONT_ORDER_SESSION_ENABLED=true` y DoorDash Storefront API responde con el menú autorizado
 *   (`GET /storefront/api/v1/stores/{store_id}/menus`), hidrata el catálogo usando los IDs autoritativos de
 *   DoorDash Storefront (`menu.id`, `item.id`, `extra.id`, `option.id`) y precios vigentes, enriqueciendo cada
 *   platillo con la fotografía de alta resolución y categoría canónica de `public.app_menu_cache`, y emitiendo
 *   `catalogMetadata: { source: 'DOORDASH_STOREFRONT', menuId, isReconciledWithToastMenusV3: true, purchasable: true }`.
 * - Mientras DoorDash Storefront API no esté habilitado en las credenciales del restaurante (o ante indisponibilidad
 *   del proveedor), sirve `public.app_menu_cache` filtrado por `store_id` e `is_available = true` con
 *   `catalogMetadata: { source: 'LEGACY_CACHE_UNRECONCILED', isReconciledWithToastMenusV3: false, purchasable: false }`.
 * - Adjunta a cada platillo (`modifierGroups`) exclusivamente los grupos de modificadores que le corresponden.
 *
 * @dataFlow
 * - GET /api/mobile/menu?storeId=N&channel=PICKUP -> `fetchStorefrontMenu` (si activo) + Supabase `app_menu_cache`
 *   -> `{ categories, categoryOrder, modifierGroups, catalogMetadata }`.
 *
 * @notes
 * - Normaliza nombres de categorías de DoorDash Storefront (ej. `"Tacos (In Store)"` -> `"Tacos"`) y cruza contra
 *   la categoría canónica de `app_menu_cache` para que `Menu2` (`buildCompactedMenuSections`) compacte el 100%
 *   de platillos y bebidas sin pérdida.
 */

import { type NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import {
  fetchStorefrontMenu,
  generateDoorDashAuthToken,
  getDoorDashStoreMapping,
  isStorefrontOrderSessionEnabled,
} from '@/lib/doordash-storefront'
import {
  STOREFRONT_CATALOG_SOURCE,
  type StorefrontMenu,
} from '@/lib/storefront/order-session-contract'
import { corsResponse, jsonOk, jsonError } from '../_helpers'

export interface ModifierOption {
  guid: string
  optionGroupGuid: string
  name: string
  price: number
  isDefault?: boolean
  imageUrl?: string | null
}

export interface ModifierGroup {
  name: string
  guid: string
  minSelections: number
  maxSelections: number
  required: boolean
  isMultiSelect: boolean
  options: ModifierOption[]
}

export interface MenuItemResponse {
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

export interface MenuCacheRow {
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

function normalizeLookupKey(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function normalizeStorefrontCategoryName(rawCategoryName: string | undefined): string {
  const cleaned = (rawCategoryName || 'Otros')
    .replace(/\s*\(in[\s-]*store\)\s*$/i, '')
    .replace(/\s*\(online\)\s*$/i, '')
    .trim()
  return cleaned || 'Otros'
}

export function buildStorefrontHydratedCatalog(
  storefrontMenu: StorefrontMenu,
  cacheRows: MenuCacheRow[],
  storeId: number,
  channelParam: string
) {
  const cacheByNormalizedName = new Map<string, MenuCacheRow>()
  const cacheByToastGuid = new Map<string, MenuCacheRow>()

  for (const row of cacheRows) {
    const normName = normalizeLookupKey(row.name)
    if (normName && !cacheByNormalizedName.has(normName)) {
      cacheByNormalizedName.set(normName, row)
    }
    if (row.toast_item_guid && !cacheByToastGuid.has(row.toast_item_guid)) {
      cacheByToastGuid.set(row.toast_item_guid, row)
    }
  }

  const categories: Record<string, MenuItemResponse[]> = {}
  const modifierGroups: Record<string, ModifierGroup> = {}

  for (const cat of storefrontMenu.categories || []) {
    const fallbackCatName = normalizeStorefrontCategoryName(cat.name)
    for (const sfItem of cat.items || []) {
      if (!sfItem || !sfItem.id || !sfItem.name || sfItem.available === false) {
        continue
      }

      const matchedCacheRow =
        cacheByToastGuid.get(sfItem.id) ||
        cacheByNormalizedName.get(normalizeLookupKey(sfItem.name))

      const categoryName = matchedCacheRow?.category_name || fallbackCatName
      if (!categories[categoryName]) {
        categories[categoryName] = []
      }

      const modGroupIds: string[] = []
      const itemModifierGroups: ModifierGroup[] = []

      for (const extra of sfItem.extras || []) {
        if (!extra || !extra.id || !extra.name) continue
        const availableOpts = (extra.options || []).filter(
          (opt) => opt && opt.id && opt.name && opt.available !== false
        )
        if (availableOpts.length === 0) continue

        const minSel =
          typeof extra.min_num_options === 'number' && extra.min_num_options > 0
            ? extra.min_num_options
            : 0
        const maxSel =
          typeof extra.max_num_options === 'number' && extra.max_num_options > 0
            ? extra.max_num_options
            : Math.max(1, availableOpts.length)

        const normalizedGroup: ModifierGroup = {
          guid: extra.id,
          name: extra.name,
          minSelections: minSel,
          maxSelections: maxSel,
          required: minSel > 0,
          isMultiSelect: maxSel > 1,
          options: availableOpts.map((opt) => ({
            guid: opt.id,
            optionGroupGuid: extra.id,
            name: opt.name || opt.id,
            price: Number((((opt.price?.value ?? 0) as number) / 100).toFixed(2)),
            isDefault: Boolean(opt.default_on),
            imageUrl: null,
          })),
        }

        modGroupIds.push(extra.id)
        itemModifierGroups.push(normalizedGroup)
        if (!modifierGroups[extra.id]) {
          modifierGroups[extra.id] = normalizedGroup
        }
      }

      const itemPriceDollars = Number(
        (((sfItem.price?.value ?? 0) as number) / 100).toFixed(2)
      )

      categories[categoryName].push({
        id: matchedCacheRow?.id || sfItem.id,
        guid: sfItem.id,
        toastGuid: matchedCacheRow?.toast_item_guid || sfItem.id,
        name: sfItem.name,
        description: sfItem.description || matchedCacheRow?.description || null,
        price: itemPriceDollars,
        imageUrl: matchedCacheRow?.image_url || null,
        modifierGroupIds: modGroupIds,
        modifierGroups: itemModifierGroups,
      })
    }
  }

  const categoryOrder = Object.keys(categories)
  const catalogMetadata = {
    source: STOREFRONT_CATALOG_SOURCE,
    menuId: storefrontMenu.id,
    isReconciledWithToastMenusV3: true,
    purchasable: true,
    storeId,
    channel: channelParam,
    lastSyncedAt: new Date().toISOString(),
  }

  return { categories, categoryOrder, modifierGroups, catalogMetadata }
}

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

    // Si el flujo de sesiones DoorDash Storefront está activo y el proveedor autoriza la lectura
    // del menú de la sucursal (`GET /storefront/api/v1/stores/{store_id}/menus`), hidratamos el
    // catálogo con los IDs autoritativos de Storefront (`menu.id`, `item.id`, `extra.id`, `option.id`)
    // preservando la fotografía y categoría canónica de `app_menu_cache`.
    if (isStorefrontOrderSessionEnabled()) {
      const storeMapping = getDoorDashStoreMapping(storeId)
      const token = storeMapping ? generateDoorDashAuthToken() : null
      if (storeMapping && token) {
        const sfMenuResult = await fetchStorefrontMenu(storeMapping.doorDashStoreId, token)
        if (sfMenuResult.ok) {
          const hydrated = buildStorefrontHydratedCatalog(
            sfMenuResult.menu,
            rows,
            storeId,
            channelParam
          )
          if (hydrated.categoryOrder.length > 0) {
            return jsonOk(hydrated)
          }
        }
      }
    }

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
