/**
 * @module api/inventory/sync-quickbooks
 *
 * MODULE:
 * Endpoint de sincronización de precios de inventario desde QuickBooks Online (QBO).
 * Se ejecuta diariamente vía cron (7 AM PDT) o manualmente vía GET/POST.
 * Actualiza `inventory_items.purchase_unit_cost` con el costo real de compra
 * del proveedor y registra cambios de precio en `inventory_price_history`.
 *
 * BUSINESS RULES:
 * - PRECIO CORRECTO: Se usa `UnitPrice` (precio que la bodega cobra al restaurante),
 *   que refleja el costo real del restaurante. `PurchaseCost` es lo que la bodega
 *   paga al proveedor externo y resulta en un food cost artificialmente bajo (~27%
 *   en vez del real ~33-35%).
 * - Fallback: `PurchaseCost` se usa si `UnitPrice` no existe.
 * - EXCEPCIÓN multiplier: Items con multiplier > 1 (ej: Papelito, que tiene UnitPrice=$18
 *   inflado) usan PurchaseCost × multiplier para obtener el precio correcto por case.
 * - MODELO BODEGA: La bodega de Tacos Gavilán compra al proveedor externo (PurchaseCost)
 *   y revende a los restaurantes (UnitPrice). El food cost del restaurante debe usar
 *   UnitPrice porque es lo que realmente paga.
 * - Solo se procesan items de QB con Type = 'Inventory' o 'NonInventory'.
 *
 * SMART PRICE PROTECTION (2026-06-19):
 * - `multiplier`: Columna en `quickbooks_mappings` para items donde QB tiene precio
 *   por pieza pero DB guarda por case. Ej: Papelito (QB $0.58/pza × 60 = DB $34.80).
 *   Fallback: mapa hardcodeado `FALLBACK_MULTIPLIERS` si la columna no existe.
 * - `max_drop_percent`: % máximo permitido de caída por sync (default 50%).
 *   → SUBIDAS de precio: SIEMPRE se permiten (ej: $0.58 → $0.62 ✅)
 *   → BAJADAS ≤ max_drop_percent: se permiten (ej: -10% ✅)
 *   → BAJADAS > max_drop_percent: se BLOQUEAN y se logea warning (ej: -60% ❌)
 *
 * DATA FLOW:
 * 1. Lee la integración de QB desde `integrations` table (tokens OAuth)
 * 2. Renueva el OAuth token via `authClient.refreshUsingToken()`
 * 3. Inicializa QB client con `node-quickbooks` SDK
 * 4. Fetch de todos los items activos de QB (`findItems`)
 * 5. Para cada QB item:
 *    - Case A (ya mapeado): Verifica protección → Actualiza si pasa
 *    - Case B (no mapeado, nombre coincide): Crea mapping en `quickbooks_mappings`
 *    - Case C (no mapeado, no existe): Crea nuevo `inventory_item` + mapping
 *
 * Dependencias:
 * - `@/lib/supabase` → `getSupabaseAdminClient` (acceso admin a DB)
 * - `@/lib/quickbooks` → `authClient` (OAuth2 client para QuickBooks)
 * - `node-quickbooks` → SDK para la API de QuickBooks Online
 *
 * Tablas Supabase:
 * - `integrations` → tokens OAuth, realm_id de QuickBooks
 * - `inventory_items` → catálogo interno de ingredientes con precios
 * - `quickbooks_mappings` → relación QB item ID ↔ inventory_item_id + multiplier + max_drop_percent
 * - `inventory_price_history` → historial de cambios de precio por item
 *
 * NOTES:
 * - Si el token refresh falla, se intenta usar el token existente (probable 401).
 * - `DEFAULT_CATEGORY_ID` apunta a la categoría "QuickBooks Import" para items
 *   auto-creados que no tienen categoría asignada.
 * - Items nuevos se crean con `unit_type: 'Unit'` por defecto; el gerente
 *   debe ajustar la unidad correcta después.
 * - El matching de nombres es exact-match case-insensitive con trim.
 * - [2026-06-19] Added smart price protection: multiplier from DB, max_drop_percent blocking.
 * - [2026-07-08] Fixed liquids template matching to search specifically for 'orden liquidos' to prevent 'Bodega Liquidos' from overwriting it.
 */
import { NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { authClient } from '@/lib/quickbooks';
import QuickBooks from 'node-quickbooks';

export async function GET() {
    return POST();
}

export async function POST() {
    try {
        const supabase = await getSupabaseAdminClient();

        // 1. Get Integration
        const { data: integration } = await supabase
            .from('integrations')
            .select('*')
            .eq('service_name', 'quickbooks')
            .single();

        if (!integration) {
            return NextResponse.json({ error: 'No se encontró la integración de QuickBooks' }, { status: 404 });
        }

        // 2. Refresh Token if expired
        let accessToken = integration.access_token;
        const isExpired = new Date(integration.expires_at) <= new Date();
        if (isExpired) {
            try {
                console.log('[QB-Sync] Token de QuickBooks expirado. Intentando renovar...');
                const authResponse = await authClient.refreshUsingToken(integration.refresh_token);
                const tokens = authResponse.getJson();
                accessToken = tokens.access_token;
                console.log('[QB-Sync] ✅ Token renovado exitosamente.');

                // Save new tokens
                await supabase.from('integrations').update({
                    access_token: tokens.access_token,
                    refresh_token: tokens.refresh_token,
                    expires_at: new Date(Date.now() + tokens.expires_in * 1000),
                    updated_at: new Date(),
                }).eq('id', integration.id);
            } catch (refreshError: any) {
                console.error('[QB-Sync] Error refreshing token:', refreshError.message || refreshError);
                return NextResponse.json({ 
                    error: 'QuickBooks session expired. Please re-authenticate.', 
                    reauth_url: '/api/integrations/quickbooks/auth' 
                }, { status: 401 });
            }
        } else {
            console.log('[QB-Sync] ✅ Token de QuickBooks aún es válido. No se requiere renovación.');
        }

        // 3. Initialize QB Client
        const qbo = new QuickBooks(
            process.env.QUICKBOOKS_CLIENT_ID,
            process.env.QUICKBOOKS_CLIENT_SECRET,
            accessToken,
            false,
            integration.realm_id,
            process.env.QUICKBOOKS_ENVIRONMENT === 'production' ? false : true,
            false,
            null,
            '2.0',
            integration.refresh_token
        );

        // 4. Fetch QB Items
        const qbItems = await new Promise<any[]>((resolve, reject) => {
            qbo.findItems({ active: true }, (err: any, result: any) => {
                if (err) reject(err);
                else resolve(result?.QueryResponse?.Item || []);
            });
        });

        // 5. Fetch Internal Items
        const { data: internalItems } = await supabase.from('inventory_items').select('*');
        if (!internalItems) throw new Error('No internal items found');

        // Fetch mappings with protection columns (multiplier, max_drop_percent)
        // If columns don't exist yet (pre-migration), the select still works — those fields will be undefined
        const { data: existingMappings } = await supabase.from('quickbooks_mappings').select('qb_item_id, inventory_item_id, multiplier, max_drop_percent');
        const mappedQbIds = new Set(existingMappings?.map(m => m.qb_item_id));
        const usedInternalIds = new Set(existingMappings?.map(m => m.inventory_item_id));

        let updatedCount = 0;
        let createdCount = 0;
        let priceChanges = 0;
        let blockedCount = 0;
        const blockedItems: string[] = [];

        // Build a lookup of current prices for change detection
        const currentPriceMap = new Map<string, number>();
        internalItems.forEach(item => {
            currentPriceMap.set(item.id, Number(item.purchase_unit_cost) || 0);
        });

        const DEFAULT_CATEGORY_ID = '5678dc7e-4514-4757-a5d0-9330e904140e'; // QuickBooks Import
        const now = new Date();

        // FALLBACK multipliers: Used when the DB columns don't exist yet (pre-migration)
        // Once the migration runs, these are overridden by quickbooks_mappings.multiplier
        const FALLBACK_MULTIPLIERS: Record<string, number> = {
            '540': 60, // Papelito Para Torta (QB has price per piece, DB has Case of 60)
        };
        const DEFAULT_MAX_DROP_PERCENT = 50; // Block drops > 50% by default

        for (const qbItem of qbItems) {
            if (qbItem.Type !== 'Inventory' && qbItem.Type !== 'NonInventory') continue;

            // PRICE FIELD SELECTION:
            // La bodega compra al proveedor externo (PurchaseCost) y revende al restaurante (UnitPrice).
            // El food cost del RESTAURANTE debe usar UnitPrice (lo que realmente paga).
            // Fallback: PurchaseCost si UnitPrice no existe.
            // EXCEPCIÓN: Items con multiplier > 1 (ej: Papelito) usan PurchaseCost × multiplier
            //   porque QB tiene precio unitario ($0.58/pza) y el multiplier lo convierte a case ($34.80).
            //   UnitPrice para estos items suele ser un precio de venta inflado ($18) que no aplica.
            const purchaseCost = Number(qbItem.PurchaseCost || 0);
            const unitPrice = Number(qbItem.UnitPrice || 0);
            // Default: UnitPrice first, PurchaseCost as fallback
            const baseRate = unitPrice > 0 ? unitPrice : purchaseCost;

            // Case A: Already mapped
            const existingMapping = existingMappings?.find(m => m.qb_item_id === qbItem.Id);
            if (existingMapping) {
                // --- SMART PRICE PROTECTION ---
                // 1. Get multiplier: from DB column (post-migration) or fallback map (pre-migration)
                const dbMultiplier = Number((existingMapping as any).multiplier);
                const multiplier = (dbMultiplier && dbMultiplier > 0) ? dbMultiplier : (FALLBACK_MULTIPLIERS[qbItem.Id] || 1);
                // Items con multiplier > 1 (ej: Papelito) deben usar PurchaseCost × multiplier
                // porque QB tiene precio unitario y UnitPrice es un precio de venta inflado.
                const effectiveBase = multiplier > 1 ? (purchaseCost > 0 ? purchaseCost : baseRate) : baseRate;
                const rate = effectiveBase * multiplier;

                const oldPrice = currentPriceMap.get(existingMapping.inventory_item_id) || 0;

                // 2. Check price protection: allow increases, block suspicious drops
                if (oldPrice > 0 && rate > 0 && rate < oldPrice) {
                    const dropPercent = ((oldPrice - rate) / oldPrice) * 100;
                    const maxDrop = Number((existingMapping as any).max_drop_percent) || DEFAULT_MAX_DROP_PERCENT;

                    if (dropPercent > maxDrop) {
                        // 🛡️ BLOCKED: Suspicious price drop
                        console.log(`[QB-Sync] 🛡️ BLOCKED: "${qbItem.Name}" price drop ${dropPercent.toFixed(1)}% exceeds max ${maxDrop}% ($${oldPrice.toFixed(2)} → $${rate.toFixed(2)})`);
                        blockedCount++;
                        blockedItems.push(`${qbItem.Name}: $${oldPrice.toFixed(2)} → $${rate.toFixed(2)} (-${dropPercent.toFixed(1)}%)`);
                        // Still update the mapping's last_fetch_cost so we know what QB tried to send
                        await supabase.from('quickbooks_mappings').update({ last_fetch_cost: rate, updated_at: now }).eq('qb_item_id', qbItem.Id);
                        continue; // Skip the actual price update
                    }
                }

                // 3. Price is acceptable (increase or small drop) — apply update
                // Save price history ONLY if the price actually changed
                if (Math.abs(oldPrice - rate) > 0.001 && rate > 0) {
                    await supabase.from('inventory_price_history').insert({
                        inventory_item_id: existingMapping.inventory_item_id,
                        purchase_unit_cost: rate,
                        effective_date: now.toISOString()
                    });
                    priceChanges++;
                    const direction = rate > oldPrice ? '⬆️' : '⬇️';
                    console.log(`[QB-Sync] ${direction} Price change: ${qbItem.Name} $${oldPrice.toFixed(2)} → $${rate.toFixed(2)}`);
                }

                await supabase.from('inventory_items').update({ purchase_unit_cost: rate, updated_at: now }).eq('id', existingMapping.inventory_item_id);
                await supabase.from('quickbooks_mappings').update({ last_fetch_cost: rate, updated_at: now }).eq('qb_item_id', qbItem.Id);
                updatedCount++;
                continue;
            }

            // For new/unmapped items, apply multiplier from fallback map only
            const newItemMultiplier = FALLBACK_MULTIPLIERS[qbItem.Id] || 1;
            const rate = baseRate * newItemMultiplier;

            // Case B: Not mapped, try to find a FREE internal item by Name exactly
            let internal = internalItems.find(i =>
                !usedInternalIds.has(i.id) &&
                (i.name.toLowerCase().trim() === qbItem.Name.toLowerCase().trim())
            );

            if (!internal) {
                // Case C: Create new item
                const { data: newItem, error: createError } = await supabase.from('inventory_items').insert({
                    name: qbItem.Name,
                    sku: qbItem.Sku || null,
                    category_id: DEFAULT_CATEGORY_ID,
                    purchase_unit_cost: rate,
                    unit_type: 'Unit',
                    is_bodega: true
                }).select().single();

                if (createError) continue;
                internal = newItem;
                createdCount++;

                // Save initial price for new items too
                if (rate > 0) {
                    await supabase.from('inventory_price_history').insert({
                        inventory_item_id: internal.id,
                        purchase_unit_cost: rate,
                        effective_date: now.toISOString()
                    });
                }
            }

            // Create Mapping
            await supabase.from('quickbooks_mappings').insert({
                qb_item_id: qbItem.Id,
                qb_item_name: qbItem.Name,
                inventory_item_id: internal.id,
                last_fetch_cost: rate,
                updated_at: now
            });

            usedInternalIds.add(internal.id);
            updatedCount++;
        }

        // ====================================================================
        // AUTO-SYNC: Vincular tiendas sin qb_customer_id con clientes de QB
        // Patrón de matching: store.name "Compton" → QB customer "Compton-TEG"
        // ====================================================================
        let storesLinked = 0;
        try {
            const { data: unlinkedStores } = await supabase
                .from('stores')
                .select('id, name')
                .eq('is_active', true)
                .is('qb_customer_id', null);

            if (unlinkedStores && unlinkedStores.length > 0) {
                console.log(`[QB-Sync] 🔗 ${unlinkedStores.length} tienda(s) sin QB Customer ID. Buscando match...`);

                const qbCustomers = await new Promise<any[]>((resolve, reject) => {
                    qbo.findCustomers({ fetchAll: true }, (err: any, result: any) => {
                        if (err) reject(err);
                        else resolve(result?.QueryResponse?.Customer || []);
                    });
                });

                // Normaliza un nombre: quita espacios, guiones, puntos, todo lowercase
                // "LA Broadway" → "labroadway", "Compton - TEG" → "comptonteg"
                const normalize = (s: string) => s.toLowerCase().replace(/[\s\-_.,']/g, '');

                // Extrae la parte de ciudad del nombre QB: "Broadway-TEG" → "broadway"
                const extractCity = (qbName: string) => {
                    const clean = qbName.replace(/[-\s]*(teg|coh)$/i, '').trim();
                    return normalize(clean);
                };

                for (const store of unlinkedStores) {
                    const storeNorm = normalize(store.name);

                    // Buscar match flexible entre store y QB customers con sufijo -TEG
                    const match = qbCustomers.find(c => {
                        const dn = (c.DisplayName || '');
                        // Solo matchear customers que terminen en TEG (no COH u otros)
                        if (!/teg$/i.test(normalize(dn))) return false;

                        const qbCity = extractCity(dn);

                        // Match directo normalizado: "huntingtonpark" === "huntingtonpark"
                        if (storeNorm === qbCity) return true;

                        // Match por contención: "labroadway".includes("broadway") ✅
                        if (storeNorm.includes(qbCity) || qbCity.includes(storeNorm)) return true;

                        return false;
                    });

                    if (match) {
                        await supabase
                            .from('stores')
                            .update({ qb_customer_id: match.Id })
                            .eq('id', store.id);
                        console.log(`[QB-Sync] ✅ Linked: ${store.name} → ${match.DisplayName} (QB ID: ${match.Id})`);
                        storesLinked++;
                    } else {
                        console.log(`[QB-Sync] ⚠️ No QB customer match for store: ${store.name} (buscando "${store.name}-TEG")`);
                    }
                }
            }
        } catch (custError: any) {
            console.error('[QB-Sync] Error en auto-link de stores:', custError.message);
        }

        // ====================================================================
        // NOTA: Anteriormente aquí había una sección "AUTO-SYNC: Template de QB → Items Ordenables"
        // que leía el Estimate MÁS RECIENTE de QB para determinar qué items eran ordenables.
        // Se ELIMINÓ porque usaba un Estimate random (podría ser de cualquier tienda)
        // en vez del RecurringTransaction correcto. Esto podía marcar items como
        // "descontinuados" erróneamente. La sección de RecurringTransactions (abajo)
        // es la fuente de verdad correcta para templates por tienda.
        // ====================================================================
        let itemsAdded = 0;
        let itemsRemoved = 0;

        // ====================================================================
        // AUTO-SYNC: Templates de QB por tienda → store_order_template
        // ====================================================================
        let templatesUpdated = 0;
        let templateItemsSynced = 0;
        try {
            console.log('[QB-Sync] 🔄 Sincronizando templates de QB por tienda...');
            // 1. Obtener todas las tiendas activas con qb_customer_id
            const { data: activeStores } = await supabase
                .from('stores')
                .select('id, name, qb_customer_id')
                .not('qb_customer_id', 'is', null);

            // 2. Obtener mappings
            const { data: allMappings } = await supabase
                .from('quickbooks_mappings')
                .select('qb_item_id, inventory_item_id, qb_item_name');
            
            const qbToInternal = new Map<string, any>();
            allMappings?.forEach(m => qbToInternal.set(m.qb_item_id, m));

            // Helper para hacer queries a QB (usando fetch nativo)
            const qbQuery = async (sql: string) => {
                const res = await fetch(`https://quickbooks.api.intuit.com/v3/company/${integration.realm_id}/query?query=${encodeURIComponent(sql)}&minorversion=75`, {
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Accept': 'application/json'
                    }
                });
                if (!res.ok) throw new Error(`QB Query Failed: ${res.statusText}`);
                const data = await res.json();
                return data?.QueryResponse?.RecurringTransaction || [];
            };

            console.log('[QB-Sync] 🔄 Consultando todos los RecurringTransactions de QBO...');
            const allRecurring = await qbQuery("SELECT * FROM RecurringTransaction");
            console.log(`[QB-Sync] 📊 Encontrados ${allRecurring.length} recurring transactions en QB.`);

            // Agrupar los templates de tipo Estimate por Customer ID
            const dailyTemplatesByCustomerId = new Map<string, any>();
            let liquidsTemplate: any = null;

            allRecurring.forEach((t: any) => {
                if (!t.Estimate) return;
                const est = t.Estimate;
                const templateName = (est.RecurringInfo?.Name || '').toLowerCase();
                const customerId = est.CustomerRef?.value;

                if (templateName.includes('orden diaria')) {
                    dailyTemplatesByCustomerId.set(String(customerId), est);
                } else if (templateName.includes('orden liquidos') || templateName.includes('orden de liquidos')) {
                    liquidsTemplate = est;
                }
            });

            if (activeStores && activeStores.length > 0) {
                // 1. Sincronizar templates Diarios por tienda
                for (const store of activeStores) {
                    try {
                        const est = dailyTemplatesByCustomerId.get(String(store.qb_customer_id));
                        if (!est) {
                            console.log(`[QB-Sync] ⚠️ ${store.name}: No se encontró plantilla "Orden Diaria" en Recurring Transactions.`);
                            continue;
                        }

                        const lines = est.Line || [];
                        const toInsert: any[] = [];
                        let pos = 1;
                        for (const line of lines) {
                            if (line.DetailType === 'SalesItemLineDetail' && line.SalesItemLineDetail?.ItemRef?.value) {
                                const qbItemId = line.SalesItemLineDetail.ItemRef.value;
                                const qbItemName = line.SalesItemLineDetail.ItemRef.name || 'Unknown';
                                
                                const mapping = qbToInternal.get(qbItemId);
                                if (!mapping) continue;

                                toInsert.push({
                                    store_id: store.id,
                                    inventory_item_id: mapping.inventory_item_id,
                                    qb_item_id: qbItemId,
                                    qb_item_name: qbItemName,
                                    sort_position: pos++,
                                    order_type: 'daily'
                                });
                            }
                        }

                        if (toInsert.length > 0) {
                            // Limpiar template anterior diario
                            await supabase.from('store_order_template').delete().eq('store_id', store.id).eq('order_type', 'daily');

                            // Insertar nuevo template diario
                            const { error: insertErr } = await supabase.from('store_order_template').insert(toInsert);
                            if (insertErr) {
                                console.error(`[QB-Sync] ❌ Error insertando template para ${store.name}:`, insertErr.message);
                            } else {
                                console.log(`[QB-Sync] ✅ Template de ${store.name} sincronizado (${toInsert.length} items)`);
                                templatesUpdated++;
                                templateItemsSynced += toInsert.length;
                            }
                        }
                    } catch (storeError: any) {
                        console.error(`[QB-Sync] ❌ Error en template de ${store.name}:`, storeError.message);
                    }
                }

                // 2. Sincronizar template único de Líquidos
                try {
                    if (liquidsTemplate) {
                        console.log(`[QB-Sync] 🧴 Sincronizando template único de Líquidos: "${liquidsTemplate.RecurringInfo?.Name || 'Líquidos'}"`);
                        const lines = liquidsTemplate.Line || [];
                        const liquidsItems: any[] = [];
                        let pos = 1;
                        
                        for (const line of lines) {
                            if (line.DetailType === 'SalesItemLineDetail' && line.SalesItemLineDetail?.ItemRef?.value) {
                                const qbItemId = line.SalesItemLineDetail.ItemRef.value;
                                const qbItemName = line.SalesItemLineDetail.ItemRef.name || 'Unknown';
                                
                                const mapping = qbToInternal.get(qbItemId);
                                if (!mapping) continue;

                                liquidsItems.push({
                                    inventory_item_id: mapping.inventory_item_id,
                                    qb_item_id: qbItemId,
                                    qb_item_name: qbItemName,
                                    sort_position: pos++
                                });
                            }
                        }

                        if (liquidsItems.length > 0) {
                            // Limpiar todos los templates de líquidos anteriores en la DB
                            await supabase.from('store_order_template').delete().eq('order_type', 'liquids');

                            // Preparar registros para todas las tiendas
                            const allStoresLiquids: any[] = [];
                            activeStores.forEach(store => {
                                liquidsItems.forEach(item => {
                                    allStoresLiquids.push({
                                        store_id: store.id,
                                        inventory_item_id: item.inventory_item_id,
                                        qb_item_id: item.qb_item_id,
                                        qb_item_name: item.qb_item_name,
                                        sort_position: item.sort_position,
                                        order_type: 'liquids'
                                    });
                                });
                            });

                            // Insertar en lotes de 100
                            for (let i = 0; i < allStoresLiquids.length; i += 100) {
                                const batch = allStoresLiquids.slice(i, i + 100);
                                const { error: insertErr } = await supabase.from('store_order_template').insert(batch);
                                if (insertErr) {
                                    console.error(`[QB-Sync] ❌ Error insertando batch de líquidos:`, insertErr.message);
                                }
                            }
                            console.log(`[QB-Sync] 🧴 Template único de Líquidos sincronizado para las ${activeStores.length} tiendas (${liquidsItems.length} items c/u)`);
                        }
                    } else {
                        console.log('[QB-Sync] ⚠️ No se encontró ningún Template de Líquidos en Recurring Transactions de QBO.');
                    }
                } catch (liquidsError: any) {
                    console.error('[QB-Sync] ❌ Error en sync de template de líquidos:', liquidsError.message);
                }
            }
        } catch (templateError: any) {
            console.error('[QB-Sync] Error general en template sync:', templateError.message);
        }

        // Log summary with protection details
        console.log(`[QB-Sync] ✅ Done: ${updatedCount} updated, ${createdCount} created, ${priceChanges} price changes, ${blockedCount} blocked, ${storesLinked} stores linked, ${itemsAdded} items added, ${itemsRemoved} items removed, ${templatesUpdated} templates updated (${templateItemsSynced} items)`);
        if (blockedItems.length > 0) {
            console.log(`[QB-Sync] 🛡️ Blocked items:`);
            blockedItems.forEach(b => console.log(`  - ${b}`));
        }

        return NextResponse.json({
            success: true,
            updatedCount,
            createdCount,
            priceChanges,
            blockedCount,
            blockedItems: blockedItems.length > 0 ? blockedItems : undefined,
            storesLinked,
            templateSync: { itemsAdded, itemsRemoved, templatesUpdated, templateItemsSynced }
        });

    } catch (error: any) {
        console.error('Sync error:', error);
        return NextResponse.json({ error: error.message || 'Error en la sincronización' }, { status: 500 });
    }
}
