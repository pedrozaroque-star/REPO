import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// ============================================================================
// Menú realista de Tacos Gavilán — Datos para sync a app_menu_cache
// ============================================================================

/** Estructura de un modificador individual */
interface MenuModifier {
  guid: string
  name: string
  price: number
}

/** Estructura de un grupo de modificadores */
interface ModifierGroup {
  name: string
  minSelections: number
  maxSelections: number
  modifiers: MenuModifier[]
}

/** Estructura de un item del menú para inserción */
interface MenuItem {
  category_name: string
  toast_item_guid: string
  name: string
  description: string
  price: number
  image_url: string | null
  modifier_groups_json: ModifierGroup[]
  is_available: boolean
}

// ============================================================================
// Grupos de modificadores compartidos por la mayoría de items
// ============================================================================

/** Modificadores de ingredientes — aplican a tacos, burritos, quesadillas */
const INGREDIENTES_GROUP: ModifierGroup = {
  name: 'Ingredientes',
  minSelections: 0,
  maxSelections: 3,
  modifiers: [
    { guid: 'mod-sin-cebolla', name: 'Sin Cebolla', price: 0 },
    { guid: 'mod-sin-cilantro', name: 'Sin Cilantro', price: 0 },
    { guid: 'mod-extra-cebolla', name: 'Extra Cebolla', price: 0.25 },
  ],
}

/** Extras premium — aplican a todos los items de comida */
const EXTRAS_GROUP: ModifierGroup = {
  name: 'Extras',
  minSelections: 0,
  maxSelections: 3,
  modifiers: [
    { guid: 'mod-doble-carne', name: 'Doble Carne', price: 2.00 },
    { guid: 'mod-guacamole', name: 'Guacamole', price: 1.50 },
    { guid: 'mod-crema', name: 'Crema', price: 0.50 },
  ],
}

/** Modificadores combinados para items de comida */
const FOOD_MODIFIERS: ModifierGroup[] = [INGREDIENTES_GROUP, EXTRAS_GROUP]

// ============================================================================
// Definición completa del menú de Tacos Gavilán
// ============================================================================

const MENU_ITEMS: MenuItem[] = [
  // --- TACOS (6 items) ---
  {
    category_name: 'Tacos',
    toast_item_guid: 'taco-asada',
    name: 'Taco de Asada',
    description: 'Taco de carne asada con cebolla y cilantro en tortilla de maíz',
    price: 2.75,
    image_url: null,
    modifier_groups_json: FOOD_MODIFIERS,
    is_available: true,
  },
  {
    category_name: 'Tacos',
    toast_item_guid: 'taco-pastor',
    name: 'Taco al Pastor',
    description: 'Taco al pastor con piña, cebolla y cilantro en tortilla de maíz',
    price: 2.75,
    image_url: null,
    modifier_groups_json: FOOD_MODIFIERS,
    is_available: true,
  },
  {
    category_name: 'Tacos',
    toast_item_guid: 'taco-pollo',
    name: 'Taco de Pollo',
    description: 'Taco de pollo asado con cebolla y cilantro en tortilla de maíz',
    price: 2.50,
    image_url: null,
    modifier_groups_json: FOOD_MODIFIERS,
    is_available: true,
  },
  {
    category_name: 'Tacos',
    toast_item_guid: 'taco-carnitas',
    name: 'Taco de Carnitas',
    description: 'Taco de carnitas de cerdo con cebolla y cilantro en tortilla de maíz',
    price: 2.75,
    image_url: null,
    modifier_groups_json: FOOD_MODIFIERS,
    is_available: true,
  },
  {
    category_name: 'Tacos',
    toast_item_guid: 'taco-chorizo',
    name: 'Taco de Chorizo',
    description: 'Taco de chorizo con cebolla y cilantro en tortilla de maíz',
    price: 2.75,
    image_url: null,
    modifier_groups_json: FOOD_MODIFIERS,
    is_available: true,
  },
  {
    category_name: 'Tacos',
    toast_item_guid: 'taco-cabeza',
    name: 'Taco de Cabeza',
    description: 'Taco de cabeza de res con cebolla y cilantro en tortilla de maíz',
    price: 3.00,
    image_url: null,
    modifier_groups_json: FOOD_MODIFIERS,
    is_available: true,
  },

  // --- BURRITOS (4 items) ---
  {
    category_name: 'Burritos',
    toast_item_guid: 'burrito-asada',
    name: 'Burrito de Asada',
    description: 'Burrito de carne asada con arroz, frijoles, cebolla y cilantro',
    price: 9.50,
    image_url: null,
    modifier_groups_json: FOOD_MODIFIERS,
    is_available: true,
  },
  {
    category_name: 'Burritos',
    toast_item_guid: 'burrito-pastor',
    name: 'Burrito al Pastor',
    description: 'Burrito al pastor con arroz, frijoles, piña, cebolla y cilantro',
    price: 9.50,
    image_url: null,
    modifier_groups_json: FOOD_MODIFIERS,
    is_available: true,
  },
  {
    category_name: 'Burritos',
    toast_item_guid: 'burrito-pollo',
    name: 'Burrito de Pollo',
    description: 'Burrito de pollo asado con arroz, frijoles, cebolla y cilantro',
    price: 9.00,
    image_url: null,
    modifier_groups_json: FOOD_MODIFIERS,
    is_available: true,
  },
  {
    category_name: 'Burritos',
    toast_item_guid: 'burrito-bean-cheese',
    name: 'Burrito de Frijol con Queso',
    description: 'Burrito de frijoles refritos con queso derretido',
    price: 7.50,
    image_url: null,
    modifier_groups_json: FOOD_MODIFIERS,
    is_available: true,
  },

  // --- QUESADILLAS (3 items) ---
  {
    category_name: 'Quesadillas',
    toast_item_guid: 'quesadilla-asada',
    name: 'Quesadilla de Asada',
    description: 'Quesadilla de carne asada con queso derretido en tortilla de harina',
    price: 8.50,
    image_url: null,
    modifier_groups_json: FOOD_MODIFIERS,
    is_available: true,
  },
  {
    category_name: 'Quesadillas',
    toast_item_guid: 'quesadilla-pollo',
    name: 'Quesadilla de Pollo',
    description: 'Quesadilla de pollo asado con queso derretido en tortilla de harina',
    price: 8.00,
    image_url: null,
    modifier_groups_json: FOOD_MODIFIERS,
    is_available: true,
  },
  {
    category_name: 'Quesadillas',
    toast_item_guid: 'quesadilla-cheese',
    name: 'Quesadilla de Queso',
    description: 'Quesadilla de queso derretido en tortilla de harina',
    price: 6.50,
    image_url: null,
    modifier_groups_json: FOOD_MODIFIERS,
    is_available: true,
  },

  // --- BEBIDAS (5 items) — Sin modificadores de ingredientes/extras ---
  {
    category_name: 'Bebidas',
    toast_item_guid: 'bebida-horchata',
    name: 'Horchata Grande',
    description: 'Agua fresca de horchata preparada con arroz, canela y vainilla (32 oz)',
    price: 3.50,
    image_url: null,
    modifier_groups_json: [],
    is_available: true,
  },
  {
    category_name: 'Bebidas',
    toast_item_guid: 'bebida-jamaica',
    name: 'Jamaica Grande',
    description: 'Agua fresca de flor de jamaica (32 oz)',
    price: 3.50,
    image_url: null,
    modifier_groups_json: [],
    is_available: true,
  },
  {
    category_name: 'Bebidas',
    toast_item_guid: 'bebida-coca-mexicana',
    name: 'Coca-Cola Mexicana',
    description: 'Coca-Cola importada de México en botella de vidrio (355 ml)',
    price: 3.00,
    image_url: null,
    modifier_groups_json: [],
    is_available: true,
  },
  {
    category_name: 'Bebidas',
    toast_item_guid: 'bebida-agua',
    name: 'Agua',
    description: 'Botella de agua purificada (500 ml)',
    price: 2.00,
    image_url: null,
    modifier_groups_json: [],
    is_available: true,
  },
  {
    category_name: 'Bebidas',
    toast_item_guid: 'bebida-jarritos',
    name: 'Jarritos',
    description: 'Refresco Jarritos sabor variado en botella de vidrio (370 ml)',
    price: 2.50,
    image_url: null,
    modifier_groups_json: [],
    is_available: true,
  },
]

// ============================================================================
// GET /api/cron/sync-mobile-menu
// Sincroniza el menú de Tacos Gavilán a la tabla app_menu_cache
// para cada tienda activa.
// ============================================================================
export async function GET(request: Request) {
  try {
    // --- Verificar autorización del cron (CRON_SECRET) ---
    const authHeader = request.headers.get('authorization')
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      if (process.env.CRON_SECRET) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
    }

    console.log('⏰ [MOBILE CRON] Iniciando sincronización de menú móvil...')

    // --- 1. OBTENER TODAS LAS TIENDAS ACTIVAS ---
    const { data: stores, error: storesError } = await supabaseAdmin
      .from('stores')
      .select('id, name')
      .eq('is_active', true)

    if (storesError) {
      console.error('[MOBILE CRON] Error obteniendo tiendas:', storesError)
      return NextResponse.json(
        { ok: false, error: 'Error al obtener tiendas activas.' },
        { status: 500 }
      )
    }

    if (!stores || stores.length === 0) {
      console.log('[MOBILE CRON] No se encontraron tiendas activas.')
      return NextResponse.json({
        ok: true,
        storesProcessed: 0,
        itemsSynced: 0,
        message: 'No hay tiendas activas para sincronizar.',
      })
    }

    let totalItemsSynced = 0
    const storeResults: Array<{ storeId: number; name: string; items: number; success: boolean }> = []
    const now = new Date().toISOString()

    // --- 2. PROCESAR CADA TIENDA ---
    for (const store of stores) {
      try {
        // 🛡️ PROTOCOLO DE REPARACIÓN: Borrar caché existente de la tienda
        // antes de insertar datos frescos (evita duplicados y datos obsoletos)
        const { error: deleteError } = await supabaseAdmin
          .from('app_menu_cache')
          .delete()
          .eq('store_id', store.id)

        if (deleteError) {
          console.error(
            `[MOBILE CRON] Error borrando caché de tienda ${store.id} (${store.name}):`,
            deleteError
          )
          storeResults.push({ storeId: store.id, name: store.name, items: 0, success: false })
          continue
        }

        // Preparar filas para inserción masiva
        const rows = MENU_ITEMS.map(item => ({
          store_id: store.id,
          category_name: item.category_name,
          toast_item_guid: item.toast_item_guid,
          name: item.name,
          description: item.description,
          price: item.price,
          image_url: item.image_url,
          modifier_groups_json: item.modifier_groups_json,
          is_available: item.is_available,
          last_synced: now,
        }))

        const { error: insertError } = await supabaseAdmin
          .from('app_menu_cache')
          .insert(rows)

        if (insertError) {
          console.error(
            `[MOBILE CRON] Error insertando menú para tienda ${store.id} (${store.name}):`,
            insertError
          )
          storeResults.push({ storeId: store.id, name: store.name, items: 0, success: false })
          continue
        }

        totalItemsSynced += rows.length
        storeResults.push({ storeId: store.id, name: store.name, items: rows.length, success: true })

        console.log(
          `✅ [MOBILE CRON] Tienda ${store.id} (${store.name}): ${rows.length} items sincronizados`
        )
      } catch (storeErr: unknown) {
        const msg = storeErr instanceof Error ? storeErr.message : 'Error desconocido'
        console.error(`[MOBILE CRON] Error procesando tienda ${store.id} (${store.name}):`, msg)
        storeResults.push({ storeId: store.id, name: store.name, items: 0, success: false })
      }
    }

    // --- 3. RESUMEN FINAL ---
    const storesProcessed = storeResults.filter(r => r.success).length
    console.log(
      `✅ [MOBILE CRON] Sincronización completada — ${storesProcessed}/${stores.length} tiendas — ${totalItemsSynced} items totales`
    )

    return NextResponse.json({
      ok: true,
      storesProcessed,
      itemsSynced: totalItemsSynced,
      details: storeResults,
      syncedAt: now,
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Error interno desconocido'
    console.error('[MOBILE CRON] Error crítico en sync-mobile-menu:', message)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
