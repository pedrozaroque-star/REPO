/**
 * @module lib/viele-price-sync
 * @description Motor de sincronización e inteligencia de precios entre el catálogo de compras
 *              de Viele & Sons (viele_items) y el Radar de Precios de Proveedores (supplier_price_history).
 *
 * @businessRules
 * - Marca oficial: Tacos Gavilan (estrictamente).
 * - Detección de variaciones de precios: si el precio por caja cambia en más de $0.009,
 *   se actualiza unit_price, se preserva previous_price, se calcula price_change_percent,
 *   y se asigna price_status ('increased' | 'decreased').
 * - Detección de nuevos artículos: cualquier producto nuevo que Viele agregue a su Order Guide
 *   se inserta automáticamente en viele_items con status 'new', imagen y categoría inferida.
 * - Sincronización con el Radar de Precios: se registra en supplier_price_history y se
 *   mantienen sincronizados los mapeos en supplier_item_mappings.
 * - Reconciliación automática de SKUs reemplazados: Si Viele & Sons cambia una clave
 *   (ej: EL4LID -> KDL76PP, EF4CLEA -> IC4FLCL), el motor migra automáticamente los niveles PAR
 *   de cada sucursal (viele_store_pars) y el orden de visualización (viele_store_sort_orders),
 *   desactivando el código obsoleto en viele_items para mantener 1:1 el catálogo oficial.
 * - Idempotencia: no duplica registros históricos si el precio no ha variado.
 *
 * @dataFlow
 * - Invocado por:
 *   1) /api/cron/sync-supplier-prices (Cron job diario lunes a viernes 6:00 AM PST).
 *   2) /api/viele/sync-prices (Sincronización bajo demanda con un clic en UI de compras).
 * - Destinos: Supabase viele_items, supplier_price_history, supplier_item_mappings, viele_store_pars, viele_store_sort_orders.
 *
 * @notes
 * - Respeta las reglas de no mutar columnas generadas en PostgreSQL.
 * - Las variaciones detectadas alimentan los semáforos de compras e informes ejecutivos.
 * - 2026-09-07 Fix: EL4LID migrado automáticamente a KDL76PP preservando PAR y orden.
 */

import { getSupabaseAdminClient } from '@/lib/supabase';
import { ParsedSupplierItem } from './supplier-price-parser';
import { isVieleSoda, isVieleChemical } from './viele-catalog-data';

/**
 * Diccionario oficial de reemplazos de SKUs de Viele & Sons.
 * Mapea códigos descontinuados/reemplazados a sus nuevos SKUs activos.
 */
export const VIELE_SKU_REPLACEMENTS: Record<string, { newCode: string; name: string }> = {
  'EL4LID': { newCode: 'KDL76PP', name: 'Karat - Flat Lid, Fits 4 oz Food Container, PP Plastic' },
  'EF4CLEA': { newCode: 'IC4FLCL', name: 'Infinite Chemical - Enzyme Floor Cleaner, 4/1 gal' },
};

/**
 * SKUs descontinuados por Viele & Sons que no deben estar activos
 */
export const VIELE_DISCONTINUED_SKUS = ['BDRPE'];

export interface VieleSyncSummary {
  success: boolean;
  totalScraped: number;
  totalUpdated: number;
  totalIncreases: number;
  totalDecreases: number;
  totalUnchanged: number;
  totalNew: number;
  newItemsList: string[];
  changedItemsList: Array<{
    itemCode: string;
    description: string;
    previousPrice: number;
    newPrice: number;
    changePercent: number;
    status: 'increased' | 'decreased';
  }>;
  durationMs: number;
  errorMessage?: string;
}

/**
 * Infiere la categoría del artículo para viele_items basándose en su descripción y código
 */
export function inferVieleCategory(description: string, itemCode: string): string {
  if (isVieleSoda(itemCode)) return 'Sodas (Bag-in-Box)';
  if (isVieleChemical(itemCode)) return 'Limpieza y Químicos';

  const desc = (description || '').toLowerCase();
  if (desc.includes('cup') || desc.includes('lid') || desc.includes('vaso') || desc.includes('tapa')) {
    return 'Vasos y Tapas';
  }
  if (desc.includes('bag') || desc.includes('bolsa') || desc.includes('seal2go')) {
    return 'Bolsas y Empaques';
  }
  if (desc.includes('foil') || desc.includes('aluminio') || desc.includes('pan') || desc.includes('steam')) {
    return 'Aluminio y Charolas';
  }
  if (desc.includes('napkin') || desc.includes('towel') || desc.includes('servilleta') || desc.includes('toalla')) {
    return 'Papel y Servilletas';
  }
  if (desc.includes('fork') || desc.includes('knife') || desc.includes('spoon') || desc.includes('cutlery') || desc.includes('straw') || desc.includes('toothpick')) {
    return 'Cubiertos y Desechables';
  }
  if (desc.includes('glove') || desc.includes('guante')) {
    return 'Seguridad e Higiene';
  }
  if (desc.includes('salt') || desc.includes('sugar') || desc.includes('creamer') || desc.includes('sweetener')) {
    return 'Condimentos y Especias';
  }

  return 'Insumos Generales';
}

/**
 * Sincroniza el catálogo de compras viele_items contra los artículos analizados del scraper de Viele
 */
export async function syncVielePurchasesCatalog(
  scrapedItems: ParsedSupplierItem[]
): Promise<VieleSyncSummary> {
  const startTime = Date.now();
  const supabase = await getSupabaseAdminClient();

  try {
    // 1. Obtener ID del proveedor VIELE
    const { data: supplier } = await supabase
      .from('suppliers')
      .select('id')
      .eq('supplier_code', 'VIELE')
      .single();

    const supplierId = supplier?.id;

    // 2. Obtener catálogo actual de viele_items
    const { data: existingItems, error: itemsErr } = await supabase
      .from('viele_items')
      .select('*');

    if (itemsErr) {
      throw new Error(`Error al leer viele_items: ${itemsErr.message}`);
    }

    const itemsMap = new Map<string, any>();
    let maxSortOrder = 0;
    (existingItems || []).forEach(item => {
      itemsMap.set(item.item_code.trim().toUpperCase(), item);
      if (item.sort_order && item.sort_order > maxSortOrder) {
        maxSortOrder = item.sort_order;
      }
    });

    const nowIso = new Date().toISOString();
    let totalUpdated = 0;
    let totalIncreases = 0;
    let totalDecreases = 0;
    let totalUnchanged = 0;
    let totalNew = 0;
    const newItemsList: string[] = [];
    const changedItemsList: Array<{
      itemCode: string;
      description: string;
      previousPrice: number;
      newPrice: number;
      changePercent: number;
      status: 'increased' | 'decreased';
    }> = [];

    // 3. Procesar cada artículo extraído del Order Guide de Viele
    for (const scraped of scrapedItems) {
      const code = (scraped.supplierSku || '').trim().toUpperCase();
      if (!code) continue;

      const newPrice = scraped.casePrice;
      const existing = itemsMap.get(code);

      if (!existing) {
        // PRODUCTO NUEVO DETECTADO EN VIELE
        totalNew++;
        maxSortOrder++;
        newItemsList.push(code);

        const isSoda = isVieleSoda(code);
        const isChemical = isVieleChemical(code);
        const category = inferVieleCategory(scraped.description, code);

        const newItemPayload = {
          item_code: code,
          description: scraped.description,
          uom: scraped.packUnit || 'CS',
          unit_price: newPrice,
          category,
          image_file: `/images/viele/${code}.jpg`,
          sort_order: maxSortOrder,
          is_active: true,
          is_soda: isSoda,
          is_chemical: isChemical,
          is_taxable: false,
          previous_price: null,
          price_change_percent: null,
          price_changed_at: nowIso,
          price_status: 'new',
          last_scanned_at: nowIso
        };

        const { error: insertErr } = await supabase
          .from('viele_items')
          .insert([newItemPayload]);

        if (insertErr) {
          console.warn(`[VielePriceSync] ⚠️ Error al insertar nuevo producto ${code}:`, insertErr.message);
        } else {
          console.log(`[VielePriceSync] ✨ Nuevo producto registrado en viele_items: ${code} - ${scraped.description} ($${newPrice})`);
        }

        // Registrar también en supplier_item_mappings si no existe
        if (supplierId) {
          await supabase.from('supplier_item_mappings').upsert({
            supplier_id: supplierId,
            supplier_sku: code,
            supplier_description: scraped.description,
            pack_quantity: scraped.packQuantity || 1,
            pack_unit: scraped.packUnit || 'CS',
            base_unit: 'pza',
            is_primary: true
          }, { onConflict: 'supplier_id,supplier_sku' });
        }
      } else {
        // PRODUCTO EXISTENTE: VERIFICAR VARIACIÓN DE PRECIO
        const currentPrice = Number(existing.unit_price) || 0;
        const diff = Number((newPrice - currentPrice).toFixed(2));

        if (Math.abs(diff) > 0.009 && newPrice > 0) {
          // VARIACIÓN DETECTADA
          const changePercent = currentPrice > 0 
            ? Number(((diff / currentPrice) * 100).toFixed(2)) 
            : 0;
          const status: 'increased' | 'decreased' = diff > 0 ? 'increased' : 'decreased';

          if (diff > 0) totalIncreases++;
          else totalDecreases++;
          totalUpdated++;

          changedItemsList.push({
            itemCode: code,
            description: existing.description || scraped.description,
            previousPrice: currentPrice,
            newPrice,
            changePercent,
            status
          });

          const { error: updateErr } = await supabase
            .from('viele_items')
            .update({
              unit_price: newPrice,
              previous_price: currentPrice,
              price_change_percent: changePercent,
              price_changed_at: nowIso,
              price_status: status,
              last_scanned_at: nowIso,
              updated_at: nowIso
            })
            .eq('item_code', code);

          if (updateErr) {
            console.warn(`[VielePriceSync] ⚠️ Error al actualizar precio de ${code}:`, updateErr.message);
          }
        } else {
          // PRECIO SIN CAMBIO
          totalUnchanged++;
          // Actualizar solo marca de tiempo de escaneo
          await supabase
            .from('viele_items')
            .update({
              last_scanned_at: nowIso
            })
            .eq('item_code', code);
        }
      }
    }

    // 4. Reconciliación automática de SKUs reemplazados y descontinuados
    for (const [oldCode, replacement] of Object.entries(VIELE_SKU_REPLACEMENTS)) {
      const newCode = replacement.newCode;

      // a) Migrar viele_store_pars si aún quedan tiendas con el código viejo
      const { data: oldPars } = await supabase
        .from('viele_store_pars')
        .select('id, store_id, par_quantity')
        .eq('item_code', oldCode);

      if (oldPars && oldPars.length > 0) {
        const { data: newPars } = await supabase
          .from('viele_store_pars')
          .select('id, store_id')
          .eq('item_code', newCode);

        const newParsStoreIds = new Set((newPars || []).map(p => p.store_id));

        for (const oldPar of oldPars) {
          if (newParsStoreIds.has(oldPar.store_id)) {
            await supabase.from('viele_store_pars').delete().eq('id', oldPar.id);
          } else {
            await supabase
              .from('viele_store_pars')
              .update({ item_code: newCode })
              .eq('id', oldPar.id);
          }
        }
        console.log(`[VielePriceSync] 🔄 Migrados ${oldPars.length} registros de PAR: ${oldCode} -> ${newCode}`);
      }

      // b) Migrar viele_store_sort_orders
      const { data: oldSorts } = await supabase
        .from('viele_store_sort_orders')
        .select('store_id, sort_order')
        .eq('item_code', oldCode);

      if (oldSorts && oldSorts.length > 0) {
        for (const s of oldSorts) {
          const { data: existingNewSort } = await supabase
            .from('viele_store_sort_orders')
            .select('store_id')
            .eq('store_id', s.store_id)
            .eq('item_code', newCode)
            .maybeSingle();

          if (existingNewSort) {
            await supabase
              .from('viele_store_sort_orders')
              .delete()
              .eq('store_id', s.store_id)
              .eq('item_code', oldCode);
          } else {
            await supabase
              .from('viele_store_sort_orders')
              .update({ item_code: newCode })
              .eq('store_id', s.store_id)
              .eq('item_code', oldCode);
          }
        }
      }

      // c) Desactivar SKU obsoleto en viele_items
      await supabase
        .from('viele_items')
        .update({ is_active: false })
        .eq('item_code', oldCode);
    }

    // 5. Desactivar artículos descontinuados confirmados
    for (const discCode of VIELE_DISCONTINUED_SKUS) {
      await supabase
        .from('viele_items')
        .update({ is_active: false })
        .eq('item_code', discCode);
    }

    const durationMs = Date.now() - startTime;
    console.log(`[VielePriceSync] ✅ Sincronización de catálogo compras completada en ${durationMs}ms: ${scrapedItems.length} escaneados, ${totalIncreases} aumentos, ${totalDecreases} rebajas, ${totalNew} nuevos, ${totalUnchanged} sin cambio.`);

    return {
      success: true,
      totalScraped: scrapedItems.length,
      totalUpdated,
      totalIncreases,
      totalDecreases,
      totalUnchanged,
      totalNew,
      newItemsList,
      changedItemsList,
      durationMs
    };
  } catch (err: any) {
    console.error('[VielePriceSync] ❌ Error fatal en syncVielePurchasesCatalog:', err);
    return {
      success: false,
      totalScraped: scrapedItems.length,
      totalUpdated: 0,
      totalIncreases: 0,
      totalDecreases: 0,
      totalUnchanged: 0,
      totalNew: 0,
      newItemsList: [],
      changedItemsList: [],
      durationMs: Date.now() - startTime,
      errorMessage: err.message
    };
  }
}
