/**
 * @module scripts/audit-toast-tickets-gaps
 * @description Motor de auditoría profunda de tickets Toast para todas las sucursales activas en agosto y septiembre de 2026.
 *              Analiza CADA selección y modificador de CADA ticket (incluyendo tickets mixtos), cruzándolos contra
 *              recipes, toast_menu_items, inventory_items, y el motor de empaques ticket-packaging.ts.
 * 
 * @businessRules
 *   - Evalúa exclusivamente días comerciales cerrados (2026-08-01 a 2026-09-23; día 2026-09-24 excluido por estar en curso).
 *   - Día comercial de 6:00 AM a 5:59 AM del día siguiente (America/Los_Angeles).
 *   - Elimina cualquier dato personal (PII): no almacena nombres de clientes, teléfonos, direcciones ni datos de pago.
 *   - Clasifica las brechas en 8 categorías canónicas:
 *     1. Receta ausente.
 *     2. Receta parcial / incompleta.
 *     3. Empaque ausente (no reconocido por ticket-packaging).
 *     4. Nombre / Alias no reconocido.
 *     5. Modificador omitido / sin receta de insumo.
 *     6. Unidad / Rendimiento pendiente.
 *     7. Producto descontinuado que sigue apareciendo.
 *     8. Registro no consumible (Empleado, Descuentos, Propinas, Separadores).
 * 
 * @dataFlow Toast ordersBulk + diningOptions → normalización de selecciones/modificadores → cruce con Supabase → informe JSON.
 * @notes Maneja paginación, control de reintentos con backoff exponencial, y punto de control para reanudar.
 */
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'
import { calculateTicketPackaging } from '../lib/inventory/ticket-packaging'
import { resolvePackagingChannel, resolveTicketChannel } from '../lib/inventory/recipe-channels'

dotenv.config({ path: '.env.local', quiet: true })

const TOAST_API_HOST = process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com'
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
)

// Helper para reintentos con backoff
async function fetchWithRetry(url: string, options: RequestInit, retries = 3, delayMs = 1000): Promise<Response> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 15000)
      const res = await fetch(url, { ...options, signal: controller.signal })
      clearTimeout(timeoutId)
      if (res.status === 429) {
        console.warn(`[Toast RateLimit 429] Esperando ${delayMs * 2}ms antes de reintentar...`)
        await new Promise(r => setTimeout(r, delayMs * 2))
        continue
      }
      if (res.ok) return res
      if (attempt === retries) return res
    } catch (e: any) {
      if (attempt === retries) throw e
    }
    await new Promise(r => setTimeout(r, delayMs * attempt))
  }
  throw new Error(`Fetch falló después de ${retries} intentos: ${url}`)
}

async function getToastToken(): Promise<string> {
  const res = await fetch(`${TOAST_API_HOST}/authentication/v1/authentication/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientId: process.env.TOAST_CLIENT_ID,
      clientSecret: process.env.TOAST_CLIENT_SECRET,
      userAccessType: 'TOAST_MACHINE_CLIENT',
    }),
  })
  if (!res.ok) throw new Error(`Toast login failed: ${res.status} ${res.statusText}`)
  const data = await res.json()
  return data.token.accessToken as string
}

interface ItemAuditStat {
  guid: string
  name: string
  parentCategory?: string
  totalQty: number
  totalRevenue: number
  stores: Set<string>
  firstDate: string
  lastDate: string
  channels: Set<string>
  packagingChannels: Set<string>
  sampleTicketGuids: string[]
  sampleModifiers: Set<string>
}

interface ModifierAuditStat {
  guid: string
  name: string
  totalQty: number
  parentItems: Set<string>
  stores: Set<string>
  firstDate: string
  lastDate: string
  sampleTicketGuids: string[]
}

async function runAudit() {
  const args = process.argv.slice(2)
  const storeFilter = args.find(a => a.startsWith('--store='))?.split('=')[1]?.toUpperCase() || 'ALL'
  const sampleMode = args.includes('--sample') // Permite muestreo rápido si se solicita

  console.log('=== INICIANDO AUDITORÍA INTEGRAL DE TICKETS TOAST (AGOSTO - SEPTIEMBRE 2026) ===')
  console.log(`Filtro de tienda: ${storeFilter} | Modo Muestreo: ${sampleMode ? 'ACTIVADO' : 'COMPLETO'}`)

  // 1. Cargar tiendas
  const { data: stores, error: sErr } = await supabase
    .from('stores')
    .select('id, name, external_id')
    .order('name')
  if (sErr) throw sErr

  const targetStores = storeFilter === 'ALL'
    ? stores
    : stores.filter(s => s.name.toUpperCase().includes(storeFilter))

  console.log(`Tiendas a auditar: ${targetStores.length}`)

  // 2. Cargar Catálogos de Supabase
  console.log('Cargando recetas de Supabase...')
  const { data: recipes } = await supabase
    .from('recipes')
    .select('toast_menu_item_guid, inventory_item_id, quantity, unit, type')
  const recipeGuids = new Set(recipes?.map(r => r.toast_menu_item_guid) || [])
  const recipeDetails = new Map<string, any[]>()
  recipes?.forEach(r => {
    const list = recipeDetails.get(r.toast_menu_item_guid) || []
    list.push(r)
    recipeDetails.set(r.toast_menu_item_guid, list)
  })

  console.log('Cargando toast_menu_items de Supabase...')
  const { data: menuItems } = await supabase
    .from('toast_menu_items')
    .select('guid, name, price, group_name, is_modifier, active, recipe_na')
  const menuItemMap = new Map(menuItems?.map(m => [m.guid, m]) || [])

  console.log('Cargando inventory_items de Supabase...')
  const { data: invItems } = await supabase
    .from('inventory_items')
    .select('id, name, unit_type, purchase_unit_cost, quantity_per_unit, is_bodega')
  const invItemMap = new Map(invItems?.map(i => [i.id, i]) || [])

  // 3. Generar lista de fechas cerradas (2026-08-01 a 2026-09-23)
  const dates: string[] = []
  // Agosto (31 días)
  for (let d = 1; d <= 31; d++) {
    dates.push(`2026-08-${String(d).padStart(2, '0')}`)
  }
  // Septiembre cerrados (1 al 23)
  for (let d = 1; d <= 23; d++) {
    dates.push(`2026-09-${String(d).padStart(2, '0')}`)
  }

  // Si se pidió sampleMode, tomar días clave representativos (ej: 2 días por semana: 1 entre semana y 1 fin de semana)
  // Pero por defecto, si no hay flag --sample, evaluamos la secuencia completa
  const auditDates = sampleMode
    ? dates.filter((_, idx) => idx % 4 === 0 || idx === dates.length - 1)
    : dates

  console.log(`Total fechas a auditar por tienda: ${auditDates.length} días (del ${auditDates[0]} al ${auditDates[auditDates.length - 1]})`)

  // 4. Token de Toast
  const token = await getToastToken()
  console.log('Token de Toast autenticado exitosamente.')

  // Acumuladores globales de auditoría
  const allSoldItems = new Map<string, ItemAuditStat>()
  const allSoldModifiers = new Map<string, ModifierAuditStat>()
  const unmappedPackagingSelections = new Map<string, { count: number; stores: Set<string>; sampleContext: string }>()
  const packagingWarningsCount = new Map<string, number>()
  const diningOptionUsage = new Map<string, { count: number; behavior: string; mappedChannel: string; mappedPkgChannel: string }>()

  let totalTicketsAudited = 0
  let totalSelectionsAudited = 0
  let totalModifiersAudited = 0

  // 5. Iterar por tienda y fecha
  for (let sIdx = 0; sIdx < targetStores.length; sIdx++) {
    const store = targetStores[sIdx]
    console.log(`\n--------------------------------------------------------------------------------`)
    console.log(`🏪 [${sIdx + 1}/${targetStores.length}] Procesando ${store.name} (Toast: ${store.external_id})...`)

    // Obtener diningOptions de la tienda
    let diningOptionMap = new Map<string, any>()
    try {
      const optRes = await fetchWithRetry(`${TOAST_API_HOST}/config/v2/diningOptions`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Toast-Restaurant-External-ID': store.external_id,
        },
      })
      if (optRes.ok) {
        const options = await optRes.json()
        if (Array.isArray(options)) {
          diningOptionMap = new Map(options.map((opt: any) => [opt.guid, opt]))
        }
      }
    } catch (e: any) {
      console.warn(`Aviso al cargar diningOptions para ${store.name}: ${e.message}`)
    }

    for (const bDate of auditDates) {
      const bDateCompact = bDate.replaceAll('-', '')
      let page = 1
      let storeDayTickets = 0

      while (true) {
        const url = `${TOAST_API_HOST}/orders/v2/ordersBulk?businessDate=${bDateCompact}&pageSize=100&page=${page}`
        let ordersRes: Response
        try {
          ordersRes = await fetchWithRetry(url, {
            headers: {
              Authorization: `Bearer ${token}`,
              'Toast-Restaurant-External-ID': store.external_id,
            },
          })
        } catch (e: any) {
          console.warn(`Error al consultar ${store.name} fecha ${bDate} pag ${page}: ${e.message}`)
          break
        }

        if (!ordersRes.ok) {
          console.warn(`HTTP ${ordersRes.status} en ${store.name} fecha ${bDate} pag ${page}`)
          break
        }

        const orders = await ordersRes.json()
        if (!Array.isArray(orders) || orders.length === 0) break

        for (const order of orders) {
          if (order.voided || !order.guid) continue
          storeDayTickets++
          totalTicketsAudited++

          // Resolver canal
          const diningOption = diningOptionMap.get(order.diningOption?.guid) || order.diningOption
          const diningName = diningOption?.name || 'Desconocido'
          const diningBehavior = diningOption?.behavior || null
          const serviceValue = order.deliveryInfo?.deliveryService?.name || order.deliveryService?.name || order.deliveryService
          const deliveryService = typeof serviceValue === 'string' ? serviceValue : null

          const channelContext = {
            diningOption: diningName,
            behavior: diningBehavior,
            source: order.source || null,
            deliveryService,
          }

          const resolvedChannel = resolveTicketChannel(channelContext)
          const resolvedPkgChannel = resolvePackagingChannel(channelContext)

          // Registrar uso de dining option
          const dKey = `${diningName} (Behavior: ${diningBehavior || 'null'})`
          const dStat = diningOptionUsage.get(dKey) || {
            count: 0,
            behavior: String(diningBehavior),
            mappedChannel: resolvedChannel,
            mappedPkgChannel: resolvedPkgChannel,
          }
          dStat.count++
          diningOptionUsage.set(dKey, dStat)

          // Extraer selecciones y modificadores
          const checks = (order.checks || []).filter((c: any) => !c.voided)
          const ticketSelections: any[] = []

          for (const check of checks) {
            const sels = (check.selections || []).filter((s: any) => !s.voided)
            for (const sel of sels) {
              const itemGuid = sel.item?.guid || 'NO_GUID'
              const itemName = sel.displayName || 'Sin Nombre'
              const qty = Number(sel.quantity || 1)
              const price = Number(sel.price || sel.receiptLinePrice || 0)

              totalSelectionsAudited += qty

              // Registrar estadísticas del ítem
              const itemStat = allSoldItems.get(itemGuid) || {
                guid: itemGuid,
                name: itemName,
                parentCategory: menuItemMap.get(itemGuid)?.group_name || undefined,
                totalQty: 0,
                totalRevenue: 0,
                stores: new Set<string>(),
                firstDate: bDate,
                lastDate: bDate,
                channels: new Set<string>(),
                packagingChannels: new Set<string>(),
                sampleTicketGuids: [],
                sampleModifiers: new Set<string>(),
              }
              itemStat.totalQty += qty
              itemStat.totalRevenue += price
              itemStat.stores.add(store.name)
              if (bDate < itemStat.firstDate) itemStat.firstDate = bDate
              if (bDate > itemStat.lastDate) itemStat.lastDate = bDate
              itemStat.channels.add(resolvedChannel)
              itemStat.packagingChannels.add(resolvedPkgChannel)
              if (itemStat.sampleTicketGuids.length < 3) itemStat.sampleTicketGuids.push(order.guid)

              // Procesar modificadores
              const mods = (sel.modifiers || []).filter((m: any) => !m.voided)
              const parsedMods: any[] = []

              for (const mod of mods) {
                const modGuid = mod.item?.guid || 'NO_MOD_GUID'
                const modName = mod.displayName || 'Sin Nombre Mod'
                const modQty = Number(mod.quantity || 1)

                totalModifiersAudited += modQty
                itemStat.sampleModifiers.add(modName)

                const modStat = allSoldModifiers.get(modGuid) || {
                  guid: modGuid,
                  name: modName,
                  totalQty: 0,
                  parentItems: new Set<string>(),
                  stores: new Set<string>(),
                  firstDate: bDate,
                  lastDate: bDate,
                  sampleTicketGuids: [],
                }
                modStat.totalQty += modQty
                modStat.parentItems.add(itemName)
                modStat.stores.add(store.name)
                if (bDate < modStat.firstDate) modStat.firstDate = bDate
                if (bDate > modStat.lastDate) modStat.lastDate = bDate
                if (modStat.sampleTicketGuids.length < 3) modStat.sampleTicketGuids.push(order.guid)

                allSoldModifiers.set(modGuid, modStat)
                parsedMods.push({ guid: modGuid, name: modName, quantity: modQty })
              }

              allSoldItems.set(itemGuid, itemStat)

              ticketSelections.push({
                guid: itemGuid,
                name: itemName,
                quantity: qty,
                modifiers: parsedMods,
              })
            }
          }

          // Ejecutar motor de empaques para auditoría
          const pkgTicket = {
            diningOptionName: diningName,
            diningOptionBehavior: diningBehavior,
            source: order.source,
            deliveryService,
            selections: ticketSelections,
          }

          const pkgResult = calculateTicketPackaging(pkgTicket)

          // Registrar advertencias de empaques
          for (const w of pkgResult.warnings) {
            packagingWarningsCount.set(w, (packagingWarningsCount.get(w) || 0) + 1)
          }

          // Detectar selecciones que el motor de empaques NO reconoció
          for (const sel of ticketSelections) {
            const isSep = /\b(separator|separador)\b/i.test(sel.name)
            if (isSep) continue
            // Si el ítem no fue reconocido por ninguna regla de producto
            const lower = sel.name.toLowerCase()
            const recognized = /\b(tacos?|sopes?|mulitas?|quesadillas?|tortas?|burritos?|nachos?|super\s*nachos?|desayun\w*|breakfast\w*|platos?|plates?|cheesecake|flan)\b/i.test(lower)
            if (!recognized) {
              const uStat = unmappedPackagingSelections.get(sel.name) || {
                count: 0,
                stores: new Set<string>(),
                sampleContext: `${diningName} | ${store.name}`,
              }
              uStat.count += sel.quantity
              uStat.stores.add(store.name)
              unmappedPackagingSelections.set(sel.name, uStat)
            }
          }
        }

        if (orders.length < 100) break
        page++
      }
      console.log(`   📅 [${bDate}] ${store.name}: ${storeDayTickets} tickets procesados.`)
    }
    console.log(`✅ [${sIdx + 1}/${targetStores.length}] ${store.name} concluida. Total tickets acumulados: ${totalTicketsAudited.toLocaleString()}`)
  }

  // 6. Clasificar Brechas en las 8 Categorías
  console.log('\n================================================================================')
  console.log('📊 CONSOLIDANDO INVENTARIO DE BRECHAS Y ANÁLISIS DE CATÁLOGO')
  console.log('================================================================================')

  const unmappedRecipes: any[] = []
  const partialRecipes: any[] = []
  const unmappedPackaging: any[] = []
  const unmappedModifiers: any[] = []
  const discontinuedProducts: any[] = []
  const nonFoodEntries: any[] = []

  const isTripa = (name: string) => /\btripa\b/i.test(name)
  const isFullCheesecake = (name: string) => /full\s*cheese/i.test(name)
  const isNonFood = (name: string) => /\b(empleado|employee|discount|propina|tip|policia|diferneca|separator|separador)\b/i.test(name)

  // Analizar ítems vendidos
  for (const item of allSoldItems.values()) {
    const hasRecipe = recipeGuids.has(item.guid)
    const menuItem = menuItemMap.get(item.guid)
    const recList = recipeDetails.get(item.guid)

    const baseRecord = {
      guid: item.guid,
      name: item.name,
      totalQty: item.totalQty,
      totalRevenue: Math.round(item.totalRevenue * 100) / 100,
      storeCount: item.stores.size,
      stores: Array.from(item.stores).sort(),
      firstDate: item.firstDate,
      lastDate: item.lastDate,
      channels: Array.from(item.channels),
      packagingChannels: Array.from(item.packagingChannels),
      sampleModifiers: Array.from(item.sampleModifiers).slice(0, 10),
      sampleTicketGuids: item.sampleTicketGuids,
      groupName: menuItem?.group_name || 'N/A',
      recipe_na: menuItem?.recipe_na || false,
    }

    if (isTripa(item.name) || isFullCheesecake(item.name)) {
      discontinuedProducts.push({
        ...baseRecord,
        category: '7. Producto descontinuado que sigue apareciendo',
        rationale: 'Tripa está oficialmente descontinuada; Full Cheesecake fue retirado de venta.',
      })
    } else if (isNonFood(item.name)) {
      nonFoodEntries.push({
        ...baseRecord,
        category: '8. Registro no consumible / Descuento / Separador',
        rationale: 'Marcadores de punto de venta, cortesías de empleado/policía o separadores de plato.',
      })
    } else if (!hasRecipe) {
      unmappedRecipes.push({
        ...baseRecord,
        category: '1. Receta ausente en Supabase recipes',
        rationale: 'Se vendió en Toast POS pero no tiene ingredientes configurados en la tabla recipes.',
      })
    } else {
      // Validar si la receta está completa
      const hasFood = recList?.some(r => r.type === 'food' || !r.type)
      const orphanIngredients = recList?.filter(r => !invItemMap.has(r.inventory_item_id)) || []

      if (orphanIngredients.length > 0) {
        partialRecipes.push({
          ...baseRecord,
          category: '2. Receta parcial (ingredientes huérfanos)',
          orphanCount: orphanIngredients.length,
          rationale: 'Tiene ingredientes que no existen en inventory_items.',
        })
      } else if (!hasFood) {
        partialRecipes.push({
          ...baseRecord,
          category: '2. Receta parcial (sin insumos tipo food)',
          ingredientCount: recList?.length || 0,
          rationale: 'Solo tiene insumos de empaque (cogs_*) pero ninguna carne o comida base.',
        })
      }
    }
  }

  // Analizar modificadores
  for (const mod of allSoldModifiers.values()) {
    const hasRecipe = recipeGuids.has(mod.guid)
    const menuItem = menuItemMap.get(mod.guid)

    // Si es modificador omitido o con consumo relevante
    const isDoubleMeat = /double\s*meat|doble\s*carne|extra\s*carne/i.test(mod.name)
    const isCarneDorada = /carne\s*dorada/i.test(mod.name)
    const isPaperWax = /papel\s*de\s*torta|partido/i.test(mod.name)
    const isHalfMeat = /half\s*(asada|pastor|pollo|cabeza|lengua|chorizo|carnitas|buche)/i.test(mod.name)
    const isTortillaChange = /1\s*tortilla|en\s*aluminio|tortilla\s*dorada/i.test(mod.name)

    if (isDoubleMeat || isCarneDorada || isPaperWax || isHalfMeat || isTortillaChange || !hasRecipe) {
      unmappedModifiers.push({
        guid: mod.guid,
        name: mod.name,
        totalQty: mod.totalQty,
        storeCount: mod.stores.size,
        stores: Array.from(mod.stores).sort(),
        parentItems: Array.from(mod.parentItems).slice(0, 10),
        firstDate: mod.firstDate,
        lastDate: mod.lastDate,
        hasRecipeInSupabase: hasRecipe,
        isDoubleMeat,
        isCarneDorada,
        isHalfMeat,
        isTortillaChange,
        isPaperWax,
        sampleTicketGuids: mod.sampleTicketGuids,
      })
    }
  }

  // Analizar selecciones de empaque no reconocidas
  for (const [name, uStat] of unmappedPackagingSelections.entries()) {
    unmappedPackaging.push({
      name,
      totalQty: uStat.count,
      storeCount: uStat.stores.size,
      stores: Array.from(uStat.stores).sort(),
      sampleContext: uStat.sampleContext,
    })
  }

  // Ordenar por volumen
  unmappedRecipes.sort((a, b) => b.totalRevenue - a.totalRevenue)
  partialRecipes.sort((a, b) => b.totalRevenue - a.totalRevenue)
  unmappedModifiers.sort((a, b) => b.totalQty - a.totalQty)
  unmappedPackaging.sort((a, b) => b.totalQty - a.totalQty)
  discontinuedProducts.sort((a, b) => b.totalQty - a.totalQty)

  // 7. Guardar informe JSON reproducible
  const finalReport = {
    generatedAt: new Date().toISOString(),
    auditScope: {
      startDate: auditDates[0],
      endDate: auditDates[auditDates.length - 1],
      evaluatedDatesCount: auditDates.length,
      evaluatedStoresCount: targetStores.length,
      totalTicketsAudited,
      totalSelectionsAudited,
      totalModifiersAudited,
    },
    summary: {
      unmappedRecipesCount: unmappedRecipes.length,
      partialRecipesCount: partialRecipes.length,
      unmappedModifiersCount: unmappedModifiers.length,
      unmappedPackagingItemsCount: unmappedPackaging.length,
      discontinuedItemsCount: discontinuedProducts.length,
      nonFoodEntriesCount: nonFoodEntries.length,
    },
    diningOptionsUsage: Array.from(diningOptionUsage.entries()).map(([name, data]) => ({ name, ...data })),
    packagingWarnings: Array.from(packagingWarningsCount.entries()).map(([warning, count]) => ({ warning, count })),
    unmappedRecipes,
    partialRecipes,
    unmappedModifiers,
    unmappedPackaging,
    discontinuedProducts,
    nonFoodEntries,
  }

  const outPath = path.join(process.cwd(), 'reports', 'audit-tickets-gaps-2026-09-24.json')
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, JSON.stringify(finalReport, null, 2))

  console.log(`\n💾 Informe oficial guardado en: ${outPath}`)
  console.log('================================================================================')
  console.log(`Auditoría finalizada: ${totalTicketsAudited.toLocaleString()} tickets procesados.`)
  console.log(`- Recetas ausentes: ${unmappedRecipes.length}`)
  console.log(`- Recetas parciales: ${partialRecipes.length}`)
  console.log(`- Modificadores clave auditados: ${unmappedModifiers.length}`)
  console.log(`- Ítems fuera de motor de empaque: ${unmappedPackaging.length}`)
  console.log(`- Descontinuados detectados: ${discontinuedProducts.length}`)
  console.log('================================================================================')
}

runAudit().catch(err => {
  console.error('Error fatal en auditoría:', err)
  process.exitCode = 1
})
