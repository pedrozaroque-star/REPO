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
 * - PRECIO CORRECTO: Se usa `PurchaseCost` (costo de compra al proveedor externo),
 *   NO `UnitPrice` (precio de venta/reventa). Ejemplo real: "Papelito Para Torta"
 *   tiene UnitPrice=$18 (venta) vs PurchaseCost=$0.58 (compra). Usar UnitPrice
 *   causaba oscilaciones de costos absurdas.
 * - Fallback: `UnitPrice` solo se usa para items NonInventory/Service sin PurchaseCost.
 * - MODELO BODEGA: La bodega de Tacos Gavilán es el proveedor interno que compra
 *   al proveedor externo y revende a los restaurantes. Items creados desde QB
 *   se marcan con `is_bodega: true` (items de almacén/warehouse). Ambos tipos
 *   (bodega y restaurant) usan PurchaseCost porque representa el costo real
 *   del proveedor externo.
 * - Solo se procesan items de QB con Type = 'Inventory' o 'NonInventory'.
 *
 * DATA FLOW:
 * 1. Lee la integración de QB desde `integrations` table (tokens OAuth)
 * 2. Renueva el OAuth token via `authClient.refreshUsingToken()`
 * 3. Inicializa QB client con `node-quickbooks` SDK
 * 4. Fetch de todos los items activos de QB (`findItems`)
 * 5. Para cada QB item:
 *    - Case A (ya mapeado): Actualiza precio en `inventory_items`, registra
 *      cambio en `inventory_price_history` si |oldPrice - newPrice| > $0.001
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
 * - `quickbooks_mappings` → relación QB item ID ↔ inventory_item_id
 * - `inventory_price_history` → historial de cambios de precio por item
 *
 * NOTES:
 * - Si el token refresh falla, se intenta usar el token existente (probable 401).
 * - `DEFAULT_CATEGORY_ID` apunta a la categoría "QuickBooks Import" para items
 *   auto-creados que no tienen categoría asignada.
 * - Items nuevos se crean con `unit_type: 'Unit'` por defecto; el gerente
 *   debe ajustar la unidad correcta después.
 * - El matching de nombres es exact-match case-insensitive con trim.
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

        // 2. Refresh Token
        let accessToken = integration.access_token;
        try {
            console.log('Intentando renovar token de QuickBooks...');
            const authResponse = await authClient.refreshUsingToken(integration.refresh_token);
            const tokens = authResponse.getJson();
            accessToken = tokens.access_token;

            // Save new tokens
            await supabase.from('integrations').update({
                access_token: tokens.access_token,
                refresh_token: tokens.refresh_token,
                expires_at: new Date(Date.now() + tokens.expires_in * 1000),
                updated_at: new Date(),
            }).eq('id', integration.id);
            console.log('✅ Token renovado exitosamente.');
        } catch (refreshError) {
            console.error('Error refreshing token:', refreshError);
            // Si el refresh falla, intentamos usar el que tenemos, pero probablemente de 401
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

        const { data: existingMappings } = await supabase.from('quickbooks_mappings').select('qb_item_id, inventory_item_id');
        const mappedQbIds = new Set(existingMappings?.map(m => m.qb_item_id));
        const usedInternalIds = new Set(existingMappings?.map(m => m.inventory_item_id));

        let updatedCount = 0;
        let createdCount = 0;
        let priceChanges = 0;

        // Build a lookup of current prices for change detection
        const currentPriceMap = new Map<string, number>();
        internalItems.forEach(item => {
            currentPriceMap.set(item.id, Number(item.purchase_unit_cost) || 0);
        });

        const DEFAULT_CATEGORY_ID = '5678dc7e-4514-4757-a5d0-9330e904140e'; // QuickBooks Import
        const now = new Date();

        for (const qbItem of qbItems) {
            if (qbItem.Type !== 'Inventory' && qbItem.Type !== 'NonInventory') continue;

            // CRITICAL: Use PurchaseCost (costo de compra al proveedor), NOT UnitPrice (precio de venta).
            // UnitPrice caused oscillation bugs (e.g., Papelito Para Torta: $18 sale vs $0.58 purchase).
            // Fallback to UnitPrice only for NonInventory/Service items that lack PurchaseCost.
            const purchaseCost = Number(qbItem.PurchaseCost || 0);
            const unitPrice = Number(qbItem.UnitPrice || 0);
            const rate = purchaseCost > 0 ? purchaseCost : unitPrice;

            // Case A: Already mapped
            const existingMapping = existingMappings?.find(m => m.qb_item_id === qbItem.Id);
            if (existingMapping) {
                const oldPrice = currentPriceMap.get(existingMapping.inventory_item_id) || 0;

                // Save price history ONLY if the price actually changed
                if (Math.abs(oldPrice - rate) > 0.001 && rate > 0) {
                    await supabase.from('inventory_price_history').insert({
                        inventory_item_id: existingMapping.inventory_item_id,
                        purchase_unit_cost: rate,
                        effective_date: now.toISOString()
                    });
                    priceChanges++;
                    console.log(`[QB-Sync] 💰 Price change: ${qbItem.Name} $${oldPrice.toFixed(2)} → $${rate.toFixed(2)}`);
                }

                await supabase.from('inventory_items').update({ purchase_unit_cost: rate, updated_at: now }).eq('id', existingMapping.inventory_item_id);
                await supabase.from('quickbooks_mappings').update({ last_fetch_cost: rate, updated_at: now }).eq('qb_item_id', qbItem.Id);
                updatedCount++;
                continue;
            }

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

        console.log(`[QB-Sync] ✅ Done: ${updatedCount} updated, ${createdCount} created, ${priceChanges} price changes tracked`);

        return NextResponse.json({
            success: true,
            updatedCount,
            createdCount,
            priceChanges
        });

    } catch (error: any) {
        console.error('Sync error:', error);
        return NextResponse.json({ error: error.message || 'Error en la sincronización' }, { status: 500 });
    }
}
