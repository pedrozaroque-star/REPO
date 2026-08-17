/**
 * @module scripts/seed-suppliers-and-viele
 * @description Script de inicialización que inserta los proveedores oficiales,
 *   los 87 artículos del catálogo de Viele & Sons en inventory_items, y genera
 *   las relaciones en supplier_item_mappings y el historial inicial en supplier_price_history.
 */
import fs from 'fs'
import path from 'path'
import { createClient } from '@supabase/supabase-js'
import { VIELE_CATALOG_87 } from '../lib/seeds/viele-catalog-87'

// Leer .env.local
const envPath = path.resolve(process.cwd(), '.env.local')
const envContent = fs.readFileSync(envPath, 'utf-8')
const env: Record<string, string> = {}
for (const line of envContent.split('\n')) {
  const match = line.match(/^([^=]+)=(.*)$/)
  if (match) {
    let val = match[2].trim()
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1)
    env[match[1].trim()] = val
  }
}

const supabaseUrl = env['NEXT_PUBLIC_SUPABASE_URL']!
const supabaseServiceKey = env['SUPABASE_SERVICE_ROLE_KEY']!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function runSeed() {
  console.log('🚀 Starting Supplier & Catalog Seed for Tacos Gavilan...\n')

  // 1. Obtener categorías existentes
  const { data: categories, error: catError } = await supabase
    .from('inventory_categories')
    .select('id, name')
  
  if (catError || !categories) {
    console.error('❌ Error fetching categories:', catError)
    process.exit(1)
  }

  const categoryMap: Record<string, string> = {}
  for (const c of categories) {
    categoryMap[c.name.toLowerCase()] = c.id
  }

  console.log('✅ Categories mapped:', Object.keys(categoryMap))

  // 2. Sembrar Proveedores
  const defaultSuppliers = [
    {
      name: 'Viele & Sons',
      supplier_code: 'VIELE',
      category: 'packaging_janitorial_beverages',
      portal_url: 'https://shop.vieleandsons.com',
      notes: 'Proveedor principal de vasos personalizados, desechables, químicos Infinite y jarabes Coca-Cola.',
      is_active: true
    },
    {
      name: 'Sysco',
      supplier_code: 'SYSCO',
      category: 'broadline',
      portal_url: 'https://shop.sysco.com',
      notes: 'Distribuidor mayorista broadline alternativo para abarrotes, desechables y carnes.',
      is_active: true
    },
    {
      name: 'US Foods',
      supplier_code: 'US_FOODS',
      category: 'broadline',
      portal_url: 'https://www.usfoods.com',
      notes: 'Distribuidor mayorista alternativo.',
      is_active: true
    },
    {
      name: 'Infinite Chemical',
      supplier_code: 'INFINITE_CHEMICAL',
      category: 'chemicals',
      notes: 'Fabricante de químicos de limpieza institucional (distribuido a través de Viele & Sons).',
      is_active: true
    },
    {
      name: 'Coca-Cola',
      supplier_code: 'COCA_COLA',
      category: 'beverages',
      notes: 'Fabricante de jarabes y concentrados para máquinas de fuente.',
      is_active: true
    },
    {
      name: 'Formaryx Uniforms',
      supplier_code: 'FORMARYX',
      category: 'uniforms',
      notes: 'Fabricante y maquila de camisas, mandiles y chamarras oficiales.',
      is_active: true
    },
    {
      name: 'Restaurant Depot',
      supplier_code: 'REST_DEPOT',
      category: 'cash_and_carry',
      notes: 'Almacén cash-and-carry para compras de emergencia y menaje.',
      is_active: true
    }
  ]

  console.log('\n--- Seeding Suppliers ---')
  for (const s of defaultSuppliers) {
    const { data, error } = await supabase
      .from('suppliers')
      .upsert(s, { onConflict: 'name' })
      .select('id, name')
      .single()
    
    if (error) {
      console.error(`❌ Error inserting supplier ${s.name}:`, error.message)
    } else {
      console.log(`✅ Supplier: ${data.name} (ID: ${data.id})`)
    }
  }

  // Obtener el ID de Viele & Sons
  const { data: vieleSupplier } = await supabase
    .from('suppliers')
    .select('id')
    .eq('name', 'Viele & Sons')
    .single()
  
  if (!vieleSupplier) {
    console.error('❌ Could not find Viele & Sons in database')
    process.exit(1)
  }

  const vieleId = vieleSupplier.id

  // 3. Sembrar los 87 productos en inventory_items y supplier_item_mappings
  console.log(`\n--- Seeding ${VIELE_CATALOG_87.length} Items from Viele & Sons ---`)
  
  let insertedItems = 0
  let mappedCount = 0
  let priceHistoryCount = 0

  for (const item of VIELE_CATALOG_87) {
    const catId = categoryMap[item.categoryName.toLowerCase()] || categoryMap['desechables']

    // A. Buscar si ya existe en inventory_items por SKU o por Nombre similar
    const { data: existingItem } = await supabase
      .from('inventory_items')
      .select('id, name, sku, purchase_unit_cost, quantity_per_unit')
      .eq('sku', item.sku)
      .maybeSingle()

    let masterItemId: string

    if (existingItem) {
      masterItemId = existingItem.id
      // Actualizar datos si faltaban
      await supabase
        .from('inventory_items')
        .update({
          name: existingItem.name || item.name,
          category_id: catId,
          unit_type: item.unitType,
          unit_measure: item.unitMeasure,
          quantity_per_unit: item.packQuantity,
          purchase_unit_cost: item.recentPrice,
          is_bodega: false,
          updated_at: new Date().toISOString()
        })
        .eq('id', masterItemId)
    } else {
      // Insertar nuevo item
      const { data: newItem, error: newError } = await supabase
        .from('inventory_items')
        .insert({
          sku: item.sku,
          name: item.name,
          category_id: catId,
          unit_type: item.unitType,
          unit_measure: item.unitMeasure,
          quantity_per_unit: item.packQuantity,
          purchase_unit_cost: item.recentPrice,
          yield_percent: 100,
          is_bodega: false
        })
        .select('id')
        .single()

      if (newError || !newItem) {
        console.error(`❌ Error inserting item ${item.sku}:`, newError?.message)
        continue
      }
      masterItemId = newItem.id
      insertedItems++
    }

    // B. Crear / Actualizar Mapping en supplier_item_mappings
    const { error: mapError } = await supabase
      .from('supplier_item_mappings')
      .upsert({
        supplier_id: vieleId,
        supplier_sku: item.sku,
        supplier_description: item.description,
        master_item_id: masterItemId,
        pack_quantity: item.packQuantity,
        pack_unit: item.packUnit,
        base_unit: item.unitMeasure,
        is_primary: true,
        updated_at: new Date().toISOString()
      }, { onConflict: 'supplier_id,supplier_sku' })

    if (mapError) {
      console.error(`❌ Mapping error for ${item.sku}:`, mapError.message)
    } else {
      mappedCount++
    }

    // C. Insertar Registro Inicial en supplier_price_history si no existe
    const unitCost = Number((item.recentPrice / item.packQuantity).toFixed(4))

    const { data: existingHistory } = await supabase
      .from('supplier_price_history')
      .select('id')
      .eq('supplier_id', vieleId)
      .eq('supplier_sku', item.sku)
      .limit(1)

    if (!existingHistory || existingHistory.length === 0) {
      const { error: histError } = await supabase
        .from('supplier_price_history')
        .insert({
          supplier_id: vieleId,
          supplier_sku: item.sku,
          master_item_id: masterItemId,
          case_price: item.recentPrice,
          unit_cost: unitCost,
          previous_unit_cost: unitCost,
          change_percent: 0,
          effective_date: new Date().toISOString().split('T')[0],
          source_type: 'initial_catalog_seed',
          notes: 'Baseline price from August 2026 Tech Pack audit.'
        })

      if (!histError) priceHistoryCount++
    }
  }

  console.log(`\n🎉 SEED COMPLETED SUCCESSFULLY!`)
  console.log(`- New Items Created in inventory_items: ${insertedItems}`)
  console.log(`- Total Items Mapped to Viele & Sons: ${mappedCount}`)
  console.log(`- Baseline Price History Records: ${priceHistoryCount}`)
}

runSeed().catch(console.error)
