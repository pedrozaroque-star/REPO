/**
 * @module scripts/simulate-real-tickets-consumption
 * @description Simulación de consumo de inventario y empaques en tiempo de ejecución
 *              utilizando tickets reales de días pasados cerrados para múltiples sucursales.
 * @businessRules
 *   - Evalúa exclusivamente días pasados completamente cerrados (ej. 2026-09-22 y 2026-09-23).
 *   - Aplica las reglas operativas oficiales confirmadas por Carlos:
 *     * Tacos: 1.5 oz servida cocida base (+1.5 oz cocida en extra carne = 3.0 oz).
 *     * Burritos: 6.0 oz servida cocida base (+6.0 oz cocida en extra carne = 12.0 oz).
 *     * Mitad y mitad: 0.75 oz c/u en tacos; 3.0 oz c/u en burritos.
 *     * Carne Dorada: 1.9 oz cocida servida copeteada (~3.09 oz crudo bodega con merma de 61.5%).
 *     * Side Order Carne: 6.0 oz cocida en vaso de papel de 8 oz con tapa plana.
 *     * Carne por Libra (2, 6, 12 lb): peso cocido exacto; RC478 aluminio + 709DO para 2 lb; Half/Full Pan para 6/12 lb.
 *     * Taco Plate: 3 tacos + 4 oz arroz + 4 oz frijol en plato 983BLKB con tapa 983LID.
 *     * Salsas tortas especiales: 2 rojas por defecto.
 *     * Bolsas exteriores: ELTSBALA para ToGo/DriveThru; ELMES2G/ELLAS2G para Delivery.
 *     * Aguas frescas: Bodega envía galones preparados; venta de galón consume 1 gal líquido + 1 galón vacío.
 * @dataFlow Supabase (recipes, inventory_items, toast_menu_items) + Toast API / Snapshots → Simulación → Reporte JSON.
 */

import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'
import { calculateTicketPackaging, type ToastTicketSelection } from '../lib/inventory/ticket-packaging'
import {
  parseProteinAllocation,
  cookedOzToRawLbs,
  ACTIVE_PROTEIN_IDS,
  MEAT_COOKING_YIELDS,
  type MeatRecipeIngredient
} from '../lib/inventory/meat-allocation'
import { resolvePackagingChannel, resolveTicketChannel } from '../lib/inventory/recipe-channels'

dotenv.config({ path: '.env.local', quiet: true })

const TOAST_API_HOST = process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
)

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

interface RawToastTicket {
  storeId: number
  storeName: string
  businessDate: string
  orderGuid: string
  diningOptionName: string | null
  diningOptionBehavior: string | null
  source: string | null
  deliveryService: string | null
  selections: ToastTicketSelection[]
}

interface StoreSimulationResult {
  storeId: number
  storeName: string
  businessDate: string
  totalTickets: number
  totalSelections: number
  totalModifiers: number
  channelsCount: Record<string, number>
  packagingChannelsCount: Record<string, number>
  specialCases: {
    extraMeatTickets: number
    halfMeatTickets: number
    carneDoradaTickets: number
    sideOrderCarneTickets: number
    cateringMeatTickets: number
    tacoPlateTickets: number
    gallonAguaTickets: number
    specialTortaTickets: number
  }
  meatConsumption: {
    cookedOz: Record<string, number>
    rawLbs: Record<string, number>
  }
  packagingTotals: Record<string, number>
  recipeIngredientsUsage: Record<string, { name: string; quantity: number; unit: string }>
  warningsCount: number
  sampleWarnings: string[]
}

async function fetchStoreDiningOptions(token: string, extStoreId: string) {
  const res = await fetch(`${TOAST_API_HOST}/config/v2/diningOptions`, {
    headers: { Authorization: `Bearer ${token}`, 'Toast-Restaurant-External-ID': extStoreId },
  })
  if (!res.ok) throw new Error(`Dining options error: ${res.status}`)
  const opts = await res.json() as Array<{ guid: string; name: string; behavior?: string }>
  return new Map(opts.map(o => [o.guid, o]))
}

async function fetchOrdersFromToast(token: string, extStoreId: string, storeId: number, storeName: string, businessDate: string): Promise<RawToastTicket[]> {
  const diningOptionMap = await fetchStoreDiningOptions(token, extStoreId)
  const tickets: RawToastTicket[] = []
  const dateFormatted = businessDate.replaceAll('-', '')

  for (let page = 1; ; page++) {
    const res = await fetch(`${TOAST_API_HOST}/orders/v2/ordersBulk?businessDate=${dateFormatted}&pageSize=100&page=${page}`, {
      headers: { Authorization: `Bearer ${token}`, 'Toast-Restaurant-External-ID': extStoreId },
    })
    if (!res.ok) throw new Error(`Toast ordersBulk failed: ${res.status}`)
    const orders = await res.json() as any[]
    if (!Array.isArray(orders) || orders.length === 0) break

    for (const order of orders) {
      if (order.voided || !order.guid) continue

      const selections: ToastTicketSelection[] = (order.checks || []).filter((c: any) => !c.voided).flatMap((c: any) =>
        (c.selections || []).filter((s: any) => !s.voided).map((s: any) => ({
          guid: s.item?.guid || null,
          name: s.displayName || s.item?.name || 'Item Desconocido',
          quantity: Number(s.quantity || 1),
          modifiers: (s.modifiers || []).filter((m: any) => !m.voided).map((m: any) => ({
            guid: m.item?.guid || null,
            name: m.displayName || m.item?.name || '',
            quantity: Number(m.quantity || 1),
          })),
        }))
      )

      const diningOption = diningOptionMap.get(order.diningOption?.guid)
      const diningOptionName = diningOption?.name || order.diningOption?.name || null
      const diningOptionBehavior = diningOption?.behavior || order.diningOption?.behavior || null
      const serviceValue = order.deliveryInfo?.deliveryService?.name || order.deliveryService?.name || order.deliveryService
      const deliveryService = typeof serviceValue === 'string' ? serviceValue : null

      tickets.push({
        storeId,
        storeName,
        businessDate,
        orderGuid: order.guid,
        diningOptionName,
        diningOptionBehavior,
        source: order.source || null,
        deliveryService,
        selections,
      })
    }

    if (orders.length < 100) break
  }

  return tickets
}

async function loadExistingSnapshots(storeId: number, storeName: string, businessDate: string): Promise<RawToastTicket[]> {
  const { data: rows, error } = await supabase
    .from('toast_ticket_consumption_snapshots')
    .select('*')
    .eq('store_id', storeId)
    .eq('business_date', businessDate)

  if (error) throw error
  if (!rows || rows.length === 0) return []

  return rows.map(r => ({
    storeId,
    storeName,
    businessDate,
    orderGuid: r.toast_order_guid,
    diningOptionName: r.dining_option_name,
    diningOptionBehavior: r.channel_metadata?.diningOption?.behavior || null,
    source: r.channel_metadata?.source || null,
    deliveryService: r.channel_metadata?.deliveryService || null,
    selections: Array.isArray(r.selections) ? r.selections as ToastTicketSelection[] : [],
  }))
}

async function runSimulation() {
  console.log('═════════════════════════════════════════════════════════════════════════')
  console.log('🌮 SIMULACIÓN REAL DE CONSUMOS CON TICKETS DE DÍAS PASADOS (CERO MOCKS) 🌮')
  console.log('═════════════════════════════════════════════════════════════════════════\n')

  // 1. Cargar catálogo de recetas e ingredientes de Supabase en memoria
  console.log('Cargando catálogo maestro de Supabase (recipes, inventory_items, toast_menu_items)...')
  const { data: allRecipes, error: recErr } = await supabase
    .from('recipes')
    .select('toast_menu_item_guid, inventory_item_id, quantity, unit, type')
  if (recErr) throw recErr

  const { data: allInvItems, error: invErr } = await supabase
    .from('inventory_items')
    .select('id, name, unit_type, unit_measure, purchase_unit_cost, quantity_per_unit')
  if (invErr) throw invErr

  const { data: allMenuItems, error: menuErr } = await supabase
    .from('toast_menu_items')
    .select('guid, name, price, group_name')
  if (menuErr) throw menuErr

  const invItemMap = new Map(allInvItems.map(i => [i.id, i]))
  const menuItemMap = new Map(allMenuItems.map(m => [m.guid, m]))

  // Indexar recetas por GUID del menu item
  const recipesByMenuItemGuid = new Map<string, Array<{ inventory_item_id: string; quantity: number; unit: string; type: string }>>()
  for (const r of allRecipes || []) {
    if (!r.toast_menu_item_guid) continue
    const list = recipesByMenuItemGuid.get(r.toast_menu_item_guid) || []
    list.push(r)
    recipesByMenuItemGuid.set(r.toast_menu_item_guid, list)
  }
  console.log(`✅ Catálogo cargado: ${recipesByMenuItemGuid.size} platillos con receta, ${invItemMap.size} insumos de inventario.\n`)

  // Invertir ACTIVE_PROTEIN_IDS para mapear ID -> Nombre de proteína
  const proteinIdToName = new Map<string, keyof typeof ACTIVE_PROTEIN_IDS>()
  for (const [key, id] of Object.entries(ACTIVE_PROTEIN_IDS)) {
    proteinIdToName.set(id, key as keyof typeof ACTIVE_PROTEIN_IDS)
  }

  // 2. Definir tiendas y días pasados a simular
  const toastToken = await getToastToken()
  const storesToSimulate = process.env.SIM_LYNWOOD_2026_09_21 === '1' ? [{
    storeId: 14,
    storeName: 'Lynwood',
    extStoreId: '80a1ec95-bc73-402e-8884-e5abbe9343e6',
    businessDate: '2026-09-21',
    useSnapshots: false,
  }] : [
    {
      storeId: 14,
      storeName: 'Lynwood',
      extStoreId: '80a1ec95-bc73-402e-8884-e5abbe9343e6',
      businessDate: '2026-09-22',
      useSnapshots: true, // Ya en toast_ticket_consumption_snapshots
    },
    {
      storeId: 16,
      storeName: 'Downey',
      extStoreId: 'b7f63b01-f089-4ad7-a346-afdb1803dc1a',
      businessDate: '2026-09-23',
      useSnapshots: false, // Live fetch desde Toast
    },
    {
      storeId: 15,
      storeName: 'South Gate',
      extStoreId: '95866cfc-eeb8-4af9-9586-f78931e1ea04',
      businessDate: '2026-09-23',
      useSnapshots: false, // Live fetch desde Toast
    },
  ]

  const overallResults: StoreSimulationResult[] = []

  for (const target of storesToSimulate) {
    console.log(`─────────────────────────────────────────────────────────────────────────`)
    console.log(`📍 Simulando: ${target.storeName} (#${target.storeId}) — Fecha: ${target.businessDate}`)
    console.log(`─────────────────────────────────────────────────────────────────────────`)

    let tickets: RawToastTicket[] = []
    if (target.useSnapshots) {
      console.log(`Cargando tickets de snapshots existentes en Supabase...`)
      tickets = await loadExistingSnapshots(target.storeId, target.storeName, target.businessDate)
      console.log(`✅ ${tickets.length} tickets cargados de snapshots.`)
    } else {
      console.log(`Descargando tickets reales de Toast ordersBulk...`)
      tickets = await fetchOrdersFromToast(toastToken, target.extStoreId, target.storeId, target.storeName, target.businessDate)
      console.log(`✅ ${tickets.length} tickets reales descargados de Toast.`)
    }

    if (tickets.length === 0) {
      console.warn(`⚠️ No se encontraron tickets para ${target.storeName} en ${target.businessDate}. Saltando.`)
      continue
    }

    const res: StoreSimulationResult = {
      storeId: target.storeId,
      storeName: target.storeName,
      businessDate: target.businessDate,
      totalTickets: tickets.length,
      totalSelections: 0,
      totalModifiers: 0,
      channelsCount: {},
      packagingChannelsCount: {},
      specialCases: {
        extraMeatTickets: 0,
        halfMeatTickets: 0,
        carneDoradaTickets: 0,
        sideOrderCarneTickets: 0,
        cateringMeatTickets: 0,
        tacoPlateTickets: 0,
        gallonAguaTickets: 0,
        specialTortaTickets: 0,
      },
      meatConsumption: {
        cookedOz: {},
        rawLbs: {},
      },
      packagingTotals: {},
      recipeIngredientsUsage: {},
      warningsCount: 0,
      sampleWarnings: [],
    }

    // Inicializar carnes
    for (const protein of Object.keys(ACTIVE_PROTEIN_IDS)) {
      res.meatConsumption.cookedOz[protein] = 0
      res.meatConsumption.rawLbs[protein] = 0
    }

    // Procesar cada ticket individualmente
    for (const ticket of tickets) {
      // 1. Canal
      const channelContext = {
        diningOption: ticket.diningOptionName,
        behavior: ticket.diningOptionBehavior,
        source: ticket.source,
        deliveryService: ticket.deliveryService,
      }
      const salesChannel = resolveTicketChannel(channelContext)
      const pkgChannel = resolvePackagingChannel(channelContext)

      res.channelsCount[salesChannel] = (res.channelsCount[salesChannel] || 0) + 1
      res.packagingChannelsCount[pkgChannel] = (res.packagingChannelsCount[pkgChannel] || 0) + 1

      // 2. Empaques del ticket
      const pkgResult = calculateTicketPackaging({
        diningOptionName: ticket.diningOptionName,
        diningOptionBehavior: ticket.diningOptionBehavior,
        source: ticket.source,
        deliveryService: ticket.deliveryService,
        selections: ticket.selections,
      })

      for (const line of pkgResult.lines) {
        res.packagingTotals[line.key] = (res.packagingTotals[line.key] || 0) + line.quantity
      }

      if (pkgResult.warnings.length > 0) {
        res.warningsCount += pkgResult.warnings.length
        if (res.sampleWarnings.length < 5) {
          res.sampleWarnings.push(...pkgResult.warnings.slice(0, 5 - res.sampleWarnings.length))
        }
      }

      // Rastrear casos especiales en el ticket
      let hasExtra = false
      let hasHalf = false
      let hasDorada = false
      let hasSide = false
      let hasCatering = false
      let hasTacoPlate = false
      let hasGallon = false
      let hasSpecialTorta = false

      // 3. Selecciones e Ingredientes
      for (const sel of ticket.selections) {
        res.totalSelections += sel.quantity || 1
        res.totalModifiers += (sel.modifiers || []).reduce((s, m) => s + (m.quantity || 1), 0)

        const selText = [sel.name, ...(sel.modifiers || []).map(m => m.name)].filter(Boolean).join(' ').toLowerCase()

        if (/(?:double|doble|extra)\s*(?:meat|carne)/.test(selText)) hasExtra = true
        if (/mitad|half/.test(selText)) hasHalf = true
        if (/carne\s*dorada/.test(selText)) hasDorada = true
        if (/side\s*(?:order\s*)?carne/.test(selText)) hasSide = true
        if (/\b\d+\s*lb\s*meat\b/.test(selText)) hasCatering = true
        if (/\btaco\s*plate\b/.test(selText)) hasTacoPlate = true
        if (/gallon\s*agua/.test(selText)) hasGallon = true
        if (/\b(cubana|milanesa|jamon|queso)\b/.test(selText) && /torta/.test(selText)) hasSpecialTorta = true

        // A. Asignación de Carnes
        // Obtener ingredientes de la receta base
        const baseRecIngredients: MeatRecipeIngredient[] = (recipesByMenuItemGuid.get(sel.guid || '') || [])
          .map(r => ({ inventory_item_id: r.inventory_item_id, quantity: r.quantity, unit: r.unit }))

        const proteinAlloc = parseProteinAllocation(selText, baseRecIngredients)
        if (proteinAlloc) {
          const qty = sel.quantity || 1
          for (const [protId, cookedOzPerItem] of proteinAlloc.portionsOz.entries()) {
            const proteinName = proteinIdToName.get(protId)
            if (proteinName) {
              const totalCookedOz = cookedOzPerItem * qty
              const rawLbs = cookedOzToRawLbs(totalCookedOz, proteinName)
              res.meatConsumption.cookedOz[proteinName] += totalCookedOz
              res.meatConsumption.rawLbs[proteinName] += rawLbs
            }
          }
        }

        // B. Insumos generales de receta (Tortillas, queso, frijol, arroz, etc.)
        const recipeLines = recipesByMenuItemGuid.get(sel.guid || '') || []
        for (const rLine of recipeLines) {
          // Si es carne y ya fue procesada por proteinAlloc, omitir para no duplicar
          if (proteinAlloc && proteinAlloc.replacedBaseMeat && Object.values(ACTIVE_PROTEIN_IDS).includes(rLine.inventory_item_id as never)) {
            continue
          }

          // Si es empaque específico por canal, validar canal
          if (rLine.type === 'cogs_dine_in' && pkgChannel !== 'for_here') continue
          if (rLine.type === 'cogs_takeout' && pkgChannel !== 'to_go' && pkgChannel !== 'drive_thru') continue
          if (rLine.type === 'cogs_delivery' && pkgChannel !== 'delivery') continue

          const invItem = invItemMap.get(rLine.inventory_item_id)
          const itemName = invItem?.name || rLine.inventory_item_id
          const totalQty = (rLine.quantity || 0) * (sel.quantity || 1)

          if (!res.recipeIngredientsUsage[rLine.inventory_item_id]) {
            res.recipeIngredientsUsage[rLine.inventory_item_id] = {
              name: itemName,
              quantity: 0,
              unit: rLine.unit || invItem?.unit_measure || 'pza',
            }
          }
          res.recipeIngredientsUsage[rLine.inventory_item_id].quantity += totalQty
        }

        // C. Modificadores con receta propia
        for (const mod of sel.modifiers || []) {
          if (!mod.guid) continue
          const modRecLines = recipesByMenuItemGuid.get(mod.guid) || []
          for (const mLine of modRecLines) {
            const invItem = invItemMap.get(mLine.inventory_item_id)
            const itemName = invItem?.name || mLine.inventory_item_id
            const totalQty = (mLine.quantity || 0) * (mod.quantity || 1) * (sel.quantity || 1)

            if (!res.recipeIngredientsUsage[mLine.inventory_item_id]) {
              res.recipeIngredientsUsage[mLine.inventory_item_id] = {
                name: itemName,
                quantity: 0,
                unit: mLine.unit || invItem?.unit_measure || 'pza',
              }
            }
            res.recipeIngredientsUsage[mLine.inventory_item_id].quantity += totalQty
          }
        }
      }

      if (hasExtra) res.specialCases.extraMeatTickets++
      if (hasHalf) res.specialCases.halfMeatTickets++
      if (hasDorada) res.specialCases.carneDoradaTickets++
      if (hasSide) res.specialCases.sideOrderCarneTickets++
      if (hasCatering) res.specialCases.cateringMeatTickets++
      if (hasTacoPlate) res.specialCases.tacoPlateTickets++
      if (hasGallon) res.specialCases.gallonAguaTickets++
      if (hasSpecialTorta) res.specialCases.specialTortaTickets++
    }

    overallResults.push(res)

    // Impresión de resultados de la tienda
    console.log(`\n📊 RESULTADOS DE LA SIMULACIÓN: ${target.storeName} (${target.businessDate})`)
    console.log(`• Tickets procesados: ${res.totalTickets.toLocaleString()}`)
    console.log(`• Selecciones analizadas: ${res.totalSelections.toLocaleString()} platillos`)
    console.log(`• Modificadores auditados: ${res.totalModifiers.toLocaleString()} modificadores`)
    console.log(`• Desglose por canal de venta:`, res.channelsCount)
    console.log(`• Desglose por perfil de empaque:`, res.packagingChannelsCount)

    console.log(`\n🥩 CASOS OPERATIVOS ESPECIALES DETECTADOS EN TICKETS:`)
    console.log(`  - Tickets con Extra/Doble Carne: ${res.specialCases.extraMeatTickets}`)
    console.log(`  - Tickets con Mitad y Mitad (Half Meat): ${res.specialCases.halfMeatTickets}`)
    console.log(`  - Tickets con Carne Dorada: ${res.specialCases.carneDoradaTickets}`)
    console.log(`  - Tickets con Taco Plate: ${res.specialCases.tacoPlateTickets}`)
    console.log(`  - Tickets con Side Order Carne: ${res.specialCases.sideOrderCarneTickets}`)
    console.log(`  - Tickets con Carne por Libra (Catering): ${res.specialCases.cateringMeatTickets}`)
    console.log(`  - Tickets con Galón de Agua: ${res.specialCases.gallonAguaTickets}`)
    console.log(`  - Tickets con Torta Especial (Cubana/Milanesa/etc.): ${res.specialCases.specialTortaTickets}`)

    console.log(`\n🔥 CONSUMO TEÓRICO DE CARNES (Cocido servido vs Crudo deducido de Bodega):`)
    let totalCooked = 0
    let totalRaw = 0
    for (const [prot, cookedOz] of Object.entries(res.meatConsumption.cookedOz)) {
      const rawLbs = res.meatConsumption.rawLbs[prot] || 0
      totalCooked += cookedOz
      totalRaw += rawLbs
      const cookedLbs = cookedOz / 16
      const yieldPct = ((MEAT_COOKING_YIELDS[prot as keyof typeof ACTIVE_PROTEIN_IDS] || 1) * 100).toFixed(1)
      console.log(`  • ${prot.toUpperCase().padEnd(9)}: ${cookedOz.toFixed(1).padStart(7)} oz (${cookedLbs.toFixed(1).padStart(5)} lb cocido)  →  ${rawLbs.toFixed(2).padStart(6)} lb crudo bodega (Rendimiento: ${yieldPct}%)`)
    }
    console.log(`  TOTAL CARNES: ${(totalCooked / 16).toFixed(1)} lb cocidas servidas  →  ${totalRaw.toFixed(2)} lb crudas solicitadas a Bodega`)

    console.log(`\n📦 CONSUMO TEÓRICO DE EMPAQUES (Muestra clave):`)
    const pkgKeys = ['plate_9in', 'taco_cover', '983BLKB', '983LID', 'UP918PR', '981BLKB', '981LID', 'EL1254', 'salsa_roja_pack', 'salsa_verde_pack', 'mixta_bag', 'lime_bag', 'jalapeno_2oz_bag', 'ELTSBALA', 'ELMES2G', 'ELLAS2G', 'RC478', '709DO', 'cup_4oz', 'cup_8oz_paper']
    for (const k of pkgKeys) {
      if (res.packagingTotals[k]) {
        console.log(`  • ${k.padEnd(18)}: ${res.packagingTotals[k].toLocaleString()} pzas`)
      }
    }

    console.log(`\n🌽 CONSUMO TEÓRICO DE INSUMOS DE MENÚ (Muestra de recetas):`)
    const topIngredients = Object.values(res.recipeIngredientsUsage)
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 10)
    for (const ing of topIngredients) {
      console.log(`  • ${ing.name.padEnd(30)}: ${ing.quantity.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${ing.unit}`)
    }
  }

  // Guardar reporte consolidado
  const reportPath = path.resolve(process.cwd(), 'reports', process.env.SIM_LYNWOOD_2026_09_21 === '1' ? 'simulation-lynwood-2026-09-21.json' : 'simulation-real-tickets-multistore.json')
  fs.mkdirSync(path.dirname(reportPath), { recursive: true })
  fs.writeFileSync(reportPath, JSON.stringify(overallResults, null, 2), 'utf-8')
  console.log(`\n═════════════════════════════════════════════════════════════════════════`)
  console.log(`✅ SIMULACIÓN EXITOSA CONCLUIDA. Reporte guardado en:`)
  console.log(`   ${reportPath}`)
  console.log(`═════════════════════════════════════════════════════════════════════════\n`)
}

runSimulation().catch(err => {
  console.error('Error en simulación:', err)
  process.exit(1)
})
