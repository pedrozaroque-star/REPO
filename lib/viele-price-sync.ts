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
 * - Errores de lectura/escritura se propagan; no reemplazar posiciones a partir de una lectura fallida.
 * - [2026-09-21] AUDITORÍA & ESTABILIDAD: syncVieleOrderGuides preserva estrictamente el orden personalizado (Drag & Drop)
 *   de cada sucursal al sincronizar, anexando productos nuevos al final con incremento determinista de posición.
 *   Los errores en inserción de PARs o de orden ahora marcan la sucursal con estatus 'error' en vez de reportar éxito falso.
 * - Respeta las reglas de no mutar columnas generadas en PostgreSQL.
 * - Las variaciones detectadas alimentan los semáforos de compras e informes ejecutivos.
 * - 2026-09-07 Fix: EL4LID migrado automáticamente a KDL76PP preservando PAR y orden.
 */

import fs from 'fs';
import path from 'path';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { ParsedSupplierItem } from './supplier-price-parser';
import { isVieleSoda, isVieleChemical } from './viele-catalog-data';
import { parseVieleNonnegativeInteger } from './viele-catalog-validation';
import { loginViele, fetchVieleOrderGuide } from './viele-api';
import { getVieleStoreAccount, getVieleStoreAccounts, getMissingVieleStoreCredentialStoreIds } from './viele-credentials-server';

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
      .single().throwOnError();

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
      if (!Number.isFinite(newPrice) || newPrice < 0) throw new Error(`Precio inválido para ${code}`);
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
          throw new Error(`Error al insertar ${code}: ${insertErr.message}`);
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
          }, { onConflict: 'supplier_id,supplier_sku' }).throwOnError();
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
            throw new Error(`Error al actualizar ${code}: ${updateErr.message}`);
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
            .eq('item_code', code).throwOnError();
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
        .eq('item_code', oldCode).throwOnError();

      if (oldPars && oldPars.length > 0) {
        const { data: newPars } = await supabase
          .from('viele_store_pars')
          .select('id, store_id')
          .eq('item_code', newCode).throwOnError();

        const newParsStoreIds = new Set((newPars || []).map(p => p.store_id));

        for (const oldPar of oldPars) {
          if (newParsStoreIds.has(oldPar.store_id)) {
            await supabase.from('viele_store_pars').delete().eq('id', oldPar.id).throwOnError();
          } else {
            await supabase
              .from('viele_store_pars')
              .update({ item_code: newCode })
              .eq('id', oldPar.id).throwOnError();
          }
        }
        console.log(`[VielePriceSync] 🔄 Migrados ${oldPars.length} registros de PAR: ${oldCode} -> ${newCode}`);
      }

      // b) Migrar viele_store_sort_orders
      const { data: oldSorts } = await supabase
        .from('viele_store_sort_orders')
        .select('store_id, sort_order')
        .eq('item_code', oldCode).throwOnError();

      if (oldSorts && oldSorts.length > 0) {
        for (const s of oldSorts) {
          const { data: existingNewSort } = await supabase
            .from('viele_store_sort_orders')
            .select('store_id')
            .eq('store_id', s.store_id)
            .eq('item_code', newCode)
            .maybeSingle().throwOnError();

          if (existingNewSort) {
            await supabase
              .from('viele_store_sort_orders')
              .delete()
              .eq('store_id', s.store_id)
              .eq('item_code', oldCode).throwOnError();
          } else {
            await supabase
              .from('viele_store_sort_orders')
              .update({ item_code: newCode })
              .eq('store_id', s.store_id)
              .eq('item_code', oldCode).throwOnError();
          }
        }
      }

      // c) Desactivar SKU obsoleto en viele_items
      await supabase
        .from('viele_items')
        .update({ is_active: false })
        .eq('item_code', oldCode).throwOnError();
    }

    // 5. Desactivar artículos descontinuados confirmados
    for (const discCode of VIELE_DISCONTINUED_SKUS) {
      await supabase
        .from('viele_items')
        .update({ is_active: false })
        .eq('item_code', discCode).throwOnError();
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

/**
 * Resultado de la sincronización de Order Guides por tienda
 */
export interface OrderGuideSyncResult {
  success: boolean;
  storesSynced: number;
  storesFailed: number;
  totalItemsSynced: number;
  newItemsDetected: string[];
  durationMs: number;
  details: Array<{ storeId: number; storeName: string; items: number; status: 'ok' | 'error'; error?: string }>;
}

/**
 * Sincroniza el Order Guide de Viele & Sons para TODAS las tiendas.
 * - Login real a cada cuenta de tienda en V&S
 * - Extrae la lista completa del Order Guide con su posición (DisplayOrder)
 * - Conserva posiciones locales, anexa SKU nuevos y retira únicamente SKU ausentes del guide completo.
 * - Si detecta un item nuevo que no existe en viele_items, lo inserta automáticamente
 */
export async function syncVieleOrderGuides(): Promise<OrderGuideSyncResult> {
  const startTime = Date.now();
  const supabase = await getSupabaseAdminClient();
  const details: OrderGuideSyncResult['details'] = [];
  const allNewItems: string[] = [];
  let totalItemsSynced = 0;
  const missingCredentialStoreIds = getMissingVieleStoreCredentialStoreIds();

  // Una sincronización de las 15 tiendas nunca debe reportar éxito parcial por una
  // configuración incompleta: evita que un secreto omitido parezca un catálogo actualizado.
  if (missingCredentialStoreIds.length > 0) {
    return {
      success: false,
      storesSynced: 0,
      storesFailed: missingCredentialStoreIds.length,
      totalItemsSynced: 0,
      newItemsDetected: [],
      durationMs: Date.now() - startTime,
      details: missingCredentialStoreIds.map(storeId => ({
        storeId,
        storeName: `Tienda #${storeId}`,
        items: 0,
        status: 'error' as const,
        error: 'Credencial de Viele no configurada en el entorno del servidor'
      }))
    };
  }

  // Obtener catálogo existente para detectar items nuevos
  const { data: existingItems } = await supabase
    .from('viele_items')
    .select('item_code').throwOnError();
  const existingCodes = new Set((existingItems || []).map(i => i.item_code.trim().toUpperCase()));

  // Obtener max sort_order actual para asignar a items nuevos
  const { data: maxSortData } = await supabase
    .from('viele_items')
    .select('sort_order')
    .order('sort_order', { ascending: false })
    .limit(1).throwOnError();
  let maxSortOrder = maxSortData?.[0]?.sort_order || 0;

  const storeIds = getVieleStoreAccounts().map(account => account.storeId);

  for (const storeId of storeIds) {
    const account = getVieleStoreAccount(storeId);
    if (!account) continue;

    try {
      // 1. Login a la tienda
      const loginRes = await loginViele(account.email, account.password);
      if (!loginRes.success) {
        details.push({ storeId, storeName: account.storeName, items: 0, status: 'error', error: `Login falló: ${loginRes.error}` });
        continue;
      }

      // 2. Jalar Order Guide
      const guideRes = await fetchVieleOrderGuide(loginRes.cookieHeader);
      if (!guideRes.success || !guideRes.items || guideRes.items.length === 0) {
        details.push({ storeId, storeName: account.storeName, items: 0, status: 'error', error: `Order Guide vacío: ${guideRes.error || 'sin items'}` });
        continue;
      }

      const guideItems = guideRes.items;
      const guideCodes = guideItems.map(item => (item.ItemID || '').trim().toUpperCase());
      if (guideCodes.some(code => !code) || new Set(guideCodes).size !== guideCodes.length) {
        throw new Error('Order Guide contiene SKU vacíos o duplicados; membresía preservada.');
      }

      // Obtener PARs existentes de esta tienda para sincronizar productos nuevos en viele_store_pars
      const { data: existingStorePars } = await supabase
        .from('viele_store_pars')
        .select('item_code')
        .eq('store_id', storeId).throwOnError();
      const existingParCodes = new Set((existingStorePars || []).map(p => p.item_code.trim().toUpperCase()));
      const missingParInserts: Array<{ store_id: number; item_code: string; par_quantity: number; updated_at: string }> = [];

      // Obtener ordenamiento previo existente en la tienda para preservar Drag & Drop personalizado
      const { data: existingStoreSort } = await supabase
        .from('viele_store_sort_orders')
        .select('item_code, sort_order')
        .eq('store_id', storeId)
        .order('sort_order', { ascending: true }).throwOnError();

      const hasPreviousSort = Boolean(existingStoreSort && existingStoreSort.length > 0);
      const existingSortMap = new Map<string, number>(
        (existingStoreSort || []).map(s => [s.item_code.trim().toUpperCase(), s.sort_order])
      );
      let nextCustomSortOrder = (existingStoreSort || []).reduce((max, s) => Math.max(max, s.sort_order), 0);

      // 3. Preparar upserts para viele_store_sort_orders
      const sortUpserts: Array<{ store_id: number; item_code: string; sort_order: number; updated_at: string }> = [];
      const nowIso = new Date().toISOString();

      for (let i = 0; i < guideItems.length; i++) {
        const item = guideItems[i];
        const itemCode = (item.ItemID || '').trim().toUpperCase();
        if (!itemCode) continue;

        let position: number;
        if (hasPreviousSort) {
          // Si el producto ya tenía una posición asignada por la tienda, se respeta estrictamente
          if (existingSortMap.has(itemCode)) {
            position = existingSortMap.get(itemCode)!;
          } else {
            // Si es un producto nuevo que la tienda no tenía, se anexa al final
            nextCustomSortOrder++;
            position = nextCustomSortOrder;
          }
        } else {
          // Si la tienda nunca ha personalizado su orden, se usa la posición oficial de V&S Order Guide
          position = parseInt(item.DisplayOrder) || (i + 1);
        }

        sortUpserts.push({
          store_id: storeId,
          item_code: itemCode,
          sort_order: position,
          updated_at: nowIso
        });

        // Asegurar que el item exista en viele_store_pars para esta tienda
        if (!existingParCodes.has(itemCode)) {
          const remotePar = item.Par === '' || item.Par == null ? 0 : parseVieleNonnegativeInteger(item.Par);
          if (remotePar === null) throw new Error(`PAR oficial inválido para ${itemCode}`);
          missingParInserts.push({
            store_id: storeId,
            item_code: itemCode,
            par_quantity: remotePar,
            updated_at: nowIso
          });
          existingParCodes.add(itemCode);
        }

        // 4. Detectar items nuevos que no existen en viele_items
        if (!existingCodes.has(itemCode)) {
          maxSortOrder++;
          const isSoda = isVieleSoda(itemCode);
          const isChemical = isVieleChemical(itemCode);
          const category = inferVieleCategory(item.Description || '', itemCode);
          const price = parseFloat(item.Price) || 0;

          const { error: insertErr } = await supabase
            .from('viele_items')
            .insert([{
              item_code: itemCode,
              description: (item.Description || '').trim(),
              uom: (item.UnitOfMeasure || 'CS').toUpperCase(),
              unit_price: price,
              category,
              image_file: `/images/viele/${itemCode}.jpg`,
              sort_order: maxSortOrder,
              is_active: true,
              is_soda: isSoda,
              is_chemical: isChemical,
              is_taxable: false,
              price_status: 'new',
              last_scanned_at: nowIso
            }]);

          if (insertErr) throw new Error(`Error al insertar ${itemCode}: ${insertErr.message}`);
          {
            existingCodes.add(itemCode);
            allNewItems.push(itemCode);
            console.log(`[OrderGuideSync] ✨ Nuevo item detectado en ${account.storeName}: ${itemCode} - ${item.Description}`);

            // Descargar imagen oficial desde CDN de Viele & Sons si está disponible
            if (item.ImageFile) {
              try {
                const imgUrl = `https://shop.vieleandsons.com/catalog/items/${item.ImageFile}`;
                const imgRes = await fetch(imgUrl, { headers: { Cookie: loginRes.cookieHeader } });
                if (imgRes.ok) {
                  const imgBuf = Buffer.from(await imgRes.arrayBuffer());
                  const imgDir = path.join(process.cwd(), 'public', 'images', 'viele');
                  if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });
                  fs.writeFileSync(path.join(imgDir, `${itemCode}.jpg`), imgBuf);
                  console.log(`[OrderGuideSync] 🖼️ Imagen oficial descargada para ${itemCode} desde Viele CDN`);
                }
              } catch (imgErr: any) {
                console.warn(`[OrderGuideSync] ⚠️ No se pudo descargar imagen para ${itemCode}:`, imgErr.message);
              }
            }
          }
        }
      }

      // 5. Sincronizar sort orders de esta tienda preservando membresía y orden personalizado
      let sortSyncFailed = false;
      if (sortUpserts.length > 0) {
        // Upsert atómico por (store_id, item_code) sin borrar todo indiscriminadamente
        const { error: upsertErr } = await supabase
          .from('viele_store_sort_orders')
          .upsert(sortUpserts, { onConflict: 'store_id,item_code' });

        if (upsertErr) {
          console.warn(`[OrderGuideSync] ⚠️ Error en upsert de sort orders para ${account.storeName}:`, upsertErr.message);
          sortSyncFailed = true;
          details.push({ storeId, storeName: account.storeName, items: sortUpserts.length, status: 'error', error: `Sort error: ${upsertErr.message}` });
        } else {
          // Limpiar productos que hayan sido retirados permanentemente del Order Guide de Viele & Sons
          const activeCodes = new Set(guideItems.map(g => (g.ItemID || '').trim().toUpperCase()));
          const obsoleteCodes = (existingStoreSort || [])
            .filter(s => !activeCodes.has(s.item_code.trim().toUpperCase()))
            .map(s => s.item_code);

          if (obsoleteCodes.length > 0) {
            await supabase
              .from('viele_store_sort_orders')
              .delete()
              .eq('store_id', storeId)
              .in('item_code', obsoleteCodes).throwOnError();
            console.log(`[OrderGuideSync] 🧹 Removidos ${obsoleteCodes.length} items obsoletos de viele_store_sort_orders para ${account.storeName}`);
          }
        }
      }

      // 6. Si hay items nuevos en el Order Guide sin registro en viele_store_pars, insertarlos
      let parSyncFailed = false;
      if (missingParInserts.length > 0) {
        const { error: parErr } = await supabase
          .from('viele_store_pars')
          .insert(missingParInserts);

        if (parErr) {
          console.warn(`[OrderGuideSync] ⚠️ Error insertando PARs para ${account.storeName}:`, parErr.message);
          parSyncFailed = true;
        } else {
          console.log(`[OrderGuideSync] 📌 ${missingParInserts.length} nuevos productos vinculados en viele_store_pars para ${account.storeName}`);
        }
      }

      if (!sortSyncFailed) {
        if (parSyncFailed) {
          details.push({ storeId, storeName: account.storeName, items: sortUpserts.length, status: 'error', error: 'Error insertando PARs faltantes' });
        } else {
          totalItemsSynced += sortUpserts.length;
          details.push({ storeId, storeName: account.storeName, items: sortUpserts.length, status: 'ok' });
        }
      }
    } catch (err: any) {
      console.error(`[OrderGuideSync] ❌ Error en ${account.storeName}:`, err.message);
      details.push({ storeId, storeName: account.storeName, items: 0, status: 'error', error: err.message });
    }
  }

  const durationMs = Date.now() - startTime;
  const storesSynced = details.filter(d => d.status === 'ok').length;
  const storesFailed = details.filter(d => d.status === 'error').length;

  console.log(`[OrderGuideSync] ✅ Completado en ${durationMs}ms: ${storesSynced}/${storeIds.length} tiendas, ${totalItemsSynced} items, ${allNewItems.length} nuevos.`);

  return {
    success: storesFailed === 0,
    storesSynced,
    storesFailed,
    totalItemsSynced,
    newItemsDetected: allNewItems,
    durationMs,
    details
  };
}
