/**
 * @module cron/sync-mobile-menu
 * @description Pipeline de sincronización que construye y actualiza el catálogo móvil oficial de Tacos Gavilan (`public.app_menu_cache`) directamente desde el endpoint oficial `GET https://ws-api.toasttab.com/menus/v2/menus` por cada una de las 15 sucursales.
 * @businessRules
 * - Sincroniza exclusivamente los menús, categorías (`menuGroups`), platillos (`menuItems`), grupos de modificadores (`modifierGroupReferences`) y opciones (`modifierOptionReferences`) con visibilidad `TOAST_ONLINE_ORDERING`.
 * - Preserva de forma idéntica el orden exacto de categorías y de platillos configurado en Toast Online Ordering (`Online Menu` -> `Online Drinks` -> `Desayunos (Toast)`).
 * - Conserva las fotografías oficiales de Toast S3 (`it.image` y `opt.image`), descripciones reales de Toast Online (`it.description`), precios exactos por sucursal (`it.price`) y UUIDs reales tanto de platillos como de `modifierGroups` y `modifierOptions`.
 * - Filtra separadores internos de POS, ítems de prueba y proteínas descontinuadas (`Tripa`).
 * - Sincroniza las 15 sucursales activas de Tacos Gavilan con rollback en memoria por tienda en caso de fallo de red.
 * @dataFlow
 * - Lee sucursales activas (`id, name, external_id`) de `public.stores`.
 * - Consulta `GET https://ws-api.toasttab.com/menus/v2/menus` con header `Toast-Restaurant-External-ID` por sucursal.
 * - Reemplaza de forma segura las filas de `public.app_menu_cache` codificando la secuencia exacta en `last_synced` (+10ms por ítem) y metadatos de ordenamiento.
 * @notes
 * - Garantiza paridad 1:1 en orden de categorías, orden de productos, fotografías S3 y modificadores con Toast Local / Toast Online Ordering.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getAuthToken } from '@/lib/toast-api'

export const dynamic = 'force-dynamic'

const TOAST_MENUS_V2_URL = 'https://ws-api.toasttab.com/menus/v2/menus'
const ONLINE_CHANNEL_VISIBILITY = 'TOAST_ONLINE_ORDERING'

export interface MenuModifier {
  guid: string
  optionGroupGuid: string
  name: string
  price: number
  isDefault: boolean
  imageUrl: string | null
}

export interface ModifierGroup {
  guid: string
  name: string
  minSelections: number
  maxSelections: number
  required: boolean
  isMultiSelect: boolean
  options: MenuModifier[]
}

interface MenuCacheRow {
  store_id: number
  category_name: string
  toast_item_guid: string
  name: string
  description: string
  price: number
  image_url: string
  modifier_groups_json: ModifierGroup[]
  is_available: boolean
  last_synced: string
}

function isVisibleInToastOnline(visibility: unknown): boolean {
  if (!Array.isArray(visibility)) return true
  return visibility.includes(ONLINE_CHANNEL_VISIBILITY)
}

function isSeparatorOrDiscontinued(name: string): boolean {
  const clean = (name || '').toLowerCase().trim()
  if (!clean) return true
  if (/^[-\s#=*_.•]+$/.test(clean)) return true
  return (
    clean.includes('separator') ||
    clean.includes('separador') ||
    clean.includes('test item') ||
    clean.includes('policia') ||
    clean.includes('empleado') ||
    clean.includes('tripa') ||
    clean.includes('tripe')
  )
}

function getOnlineMenuSortPriority(menuName: string): number {
  const normalized = (menuName || '').trim().toLowerCase()
  if (normalized === 'online menu') return 0
  if (normalized === 'online drinks') return 1
  if (normalized.includes('desayuno') || normalized.includes('breakfast')) return 2
  return 3
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const startTime = Date.now()
  const syncBatchBaseMs = Math.floor(startTime / 1000) * 1000

  // 0. Protección obligatoria de autenticación para endpoints CRON (solo vía Header Authorization)
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret) {
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json(
        { ok: false, error: 'CRON_SECRET no configurado en producción.' },
        { status: 503 }
      )
    }
  } else if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json(
      { ok: false, error: 'No autorizado para sincronizar el menú de la app móvil.' },
      { status: 401 }
    )
  }

  try {
    console.log('🔄 [MOBILE MENU SYNC] Starting live Toast Online Ordering menu sync across stores...')

    // 1. Obtener tiendas activas con su Toast external_id
    const { data: stores, error: storesErr } = await supabaseAdmin
      .from('stores')
      .select('id, name, external_id')
      .order('id')

    if (storesErr || !stores || stores.length === 0) {
      console.error('❌ [MOBILE MENU SYNC] Error fetching stores:', storesErr?.message)
      return NextResponse.json(
        { ok: false, error: 'No se encontraron tiendas activas en public.stores' },
        { status: 500 }
      )
    }

    // 2. Autenticarse contra Toast API
    const token = await getAuthToken()

    let totalInserted = 0
    const storeResults: {
      storeId: number
      name: string
      categories: number
      items: number
      withOfficialImage: number
      success: boolean
      error?: string
    }[] = []

    // 3. Sincronizar cada sucursal desde su propio payload de Toast /menus/v2/menus
    for (const store of stores) {
      if (!store.external_id) {
        storeResults.push({
          storeId: store.id,
          name: store.name,
          categories: 0,
          items: 0,
          withOfficialImage: 0,
          success: false,
          error: 'Sucursal sin external_id de Toast',
        })
        continue
      }

      // Respaldar filas actuales de la tienda en memoria antes de reemplazar
      const { data: previousRows } = await supabaseAdmin
        .from('app_menu_cache')
        .select(
          'store_id, category_name, toast_item_guid, name, description, price, image_url, modifier_groups_json, is_available, last_synced'
        )
        .eq('store_id', store.id)

      try {
        const res = await fetch(TOAST_MENUS_V2_URL, {
          headers: {
            Authorization: `Bearer ${token}`,
            'Toast-Restaurant-External-ID': store.external_id,
          },
          cache: 'no-store',
        })

        if (!res.ok) {
          throw new Error(`Toast /menus/v2/menus HTTP ${res.status}`)
        }

        const payload = await res.json()
        const rawMenus = Array.isArray(payload?.menus) ? payload.menus : []
        const mgRefs: Record<string, any> = payload?.modifierGroupReferences || {}
        const moRefs: Record<string, any> = payload?.modifierOptionReferences || {}

        // Filtrar menús visibles en TOAST_ONLINE_ORDERING y ordenar: Online Menu -> Online Drinks -> Desayunos (Toast)
        const onlineMenus = rawMenus
          .filter((m: any) => isVisibleInToastOnline(m?.visibility))
          .sort(
            (a: any, b: any) =>
              getOnlineMenuSortPriority(a?.name) - getOnlineMenuSortPriority(b?.name)
          )

        const storeRows: MenuCacheRow[] = []
        const seenItemGuidsInCategory = new Set<string>()
        const seenCategories = new Set<string>()
        let sequenceIndex = 0
        let withOfficialImage = 0

        for (const menu of onlineMenus) {
          const groups = Array.isArray(menu?.menuGroups) ? menu.menuGroups : []

          for (const group of groups) {
            if (!isVisibleInToastOnline(group?.visibility)) continue
            const categoryName = String(group?.name || '').trim()
            if (!categoryName || isSeparatorOrDiscontinued(categoryName)) continue

            const items = Array.isArray(group?.menuItems) ? group.menuItems : []

            for (const item of items) {
              if (!isVisibleInToastOnline(item?.visibility)) continue
              const itemName = String(item?.name || '').trim()
              const itemGuid = String(item?.guid || '').trim()
              if (!itemGuid || !itemName || isSeparatorOrDiscontinued(itemName)) continue

              const dedupKey = `${categoryName}::${itemGuid}`
              if (seenItemGuidsInCategory.has(dedupKey)) continue
              seenItemGuidsInCategory.add(dedupKey)
              seenCategories.add(categoryName)

              // Resolver grupos de modificadores oficiales de Toast Online Ordering para este platillo
              const itemModGroups: ModifierGroup[] = []
              const refIds = Array.isArray(item?.modifierGroupReferences)
                ? item.modifierGroupReferences
                : []
              const seenModGroupGuids = new Set<string>()

              for (const refId of refIds) {
                const mg = mgRefs[String(refId)]
                if (!mg || !mg.guid || !isVisibleInToastOnline(mg.visibility)) continue

                const mgGuid = String(mg.guid).trim()
                if (seenModGroupGuids.has(mgGuid)) continue

                const optRefs = Array.isArray(mg.modifierOptionReferences)
                  ? mg.modifierOptionReferences
                  : []
                const options: MenuModifier[] = []
                const seenOptGuids = new Set<string>()

                for (const optRefId of optRefs) {
                  const opt = moRefs[String(optRefId)]
                  if (!opt || !opt.guid || !isVisibleInToastOnline(opt.visibility)) continue
                  const optName = String(opt.name || '').trim()
                  if (!optName || isSeparatorOrDiscontinued(optName)) continue

                  const optGuid = String(opt.guid).trim()
                  if (seenOptGuids.has(optGuid)) continue
                  seenOptGuids.add(optGuid)

                  options.push({
                    guid: optGuid,
                    optionGroupGuid: mgGuid,
                    name: optName.replace(/\(In Store\)/gi, '').trim(),
                    price: Number(opt.price) || 0,
                    isDefault: Boolean(opt.isDefault),
                    imageUrl: typeof opt.image === 'string' && opt.image.trim() ? opt.image.trim() : null,
                  })
                }

                if (options.length === 0) continue
                seenModGroupGuids.add(mgGuid)

                const minSel = Math.max(
                  Number(mg.minSelections) || 0,
                  mg.requiredMode === 'REQUIRED' ? 1 : 0
                )
                const isMulti =
                  Boolean(mg.isMultiSelect) || (Number(mg.maxSelections) || 0) > 1
                const rawMax =
                  mg.maxSelections !== null &&
                  mg.maxSelections !== undefined &&
                  Number(mg.maxSelections) > 0
                    ? Number(mg.maxSelections)
                    : isMulti
                      ? options.length
                      : 1
                const maxSel = Math.max(minSel, rawMax)

                itemModGroups.push({
                  guid: mgGuid,
                  name: String(mg.name || '').replace(/\(In Store\)/gi, '').trim(),
                  minSelections: minSel,
                  maxSelections: maxSel,
                  required: minSel > 0,
                  isMultiSelect: maxSel > 1 || isMulti,
                  options,
                })
              }

              const officialImage =
                typeof item.image === 'string' && item.image.trim()
                  ? item.image.trim()
                  : typeof item.highResImage === 'string' && item.highResImage.trim()
                    ? item.highResImage.trim()
                    : ''

              if (officialImage.startsWith('http')) {
                withOfficialImage++
              }

              // Codificar el índice secuencial exacto en last_synced (+10ms por ítem)
              // para garantizar que ORDER BY last_synced ASC devuelva el orden idéntico a Toast Online
              const orderedTimestamp = new Date(syncBatchBaseMs + sequenceIndex * 10).toISOString()
              sequenceIndex++

              storeRows.push({
                store_id: store.id,
                category_name: categoryName,
                toast_item_guid: itemGuid,
                name: itemName,
                description: String(item.description || '').trim(),
                price: Number(item.price) || 0,
                image_url: officialImage,
                modifier_groups_json: itemModGroups,
                is_available: true,
                last_synced: orderedTimestamp,
              })
            }
          }
        }

        if (storeRows.length === 0) {
          throw new Error('Toast devolvió 0 artículos visibles en TOAST_ONLINE_ORDERING')
        }

        // Borrar caché previo de esta tienda e insertar el catálogo nuevo en bloques de 50
        const { error: delErr } = await supabaseAdmin
          .from('app_menu_cache')
          .delete()
          .eq('store_id', store.id)
        if (delErr) throw delErr

        const chunkSize = 50
        for (let i = 0; i < storeRows.length; i += chunkSize) {
          const chunk = storeRows.slice(i, i + chunkSize)
          const { error: insErr } = await supabaseAdmin.from('app_menu_cache').insert(chunk)
          if (insErr) throw insErr
        }

        totalInserted += storeRows.length
        storeResults.push({
          storeId: store.id,
          name: store.name,
          categories: seenCategories.size,
          items: storeRows.length,
          withOfficialImage,
          success: true,
        })
        console.log(
          `✅ [MOBILE MENU SYNC] Tienda ${store.id} (${store.name}): ${storeRows.length} items (${withOfficialImage} con foto oficial Toast S3) en ${seenCategories.size} categorías`
        )
      } catch (storeError) {
        const msg = storeError instanceof Error ? storeError.message : 'Error desconocido'
        console.error(
          `❌ [MOBILE MENU SYNC] Error en tienda ${store.id} (${store.name}), restaurando respaldo previo:`,
          msg
        )
        if (previousRows && previousRows.length > 0) {
          await supabaseAdmin.from('app_menu_cache').delete().eq('store_id', store.id)
          await supabaseAdmin.from('app_menu_cache').insert(previousRows)
        }
        storeResults.push({
          storeId: store.id,
          name: store.name,
          categories: 0,
          items: 0,
          withOfficialImage: 0,
          success: false,
          error: msg,
        })
      }
    }

    const durationMs = Date.now() - startTime
    console.log(
      `🎉 [MOBILE MENU SYNC] Completed in ${durationMs}ms — ${totalInserted} items across ${stores.length} stores.`
    )

    return NextResponse.json({
      ok: true,
      source: 'TOAST_ONLINE_ORDERING_MENUS_V2',
      durationMs,
      storesCount: stores.length,
      itemsCount: totalInserted,
      details: storeResults,
      syncedAt: new Date(syncBatchBaseMs).toISOString(),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error interno desconocido'
    console.error('❌ [MOBILE MENU SYNC] Critical fatal error:', message)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
