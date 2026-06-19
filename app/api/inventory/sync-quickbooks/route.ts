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

        // Log summary with protection details
        console.log(`[QB-Sync] ✅ Done: ${updatedCount} updated, ${createdCount} created, ${priceChanges} price changes, ${blockedCount} blocked`);
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
            blockedItems: blockedItems.length > 0 ? blockedItems : undefined
        });

    } catch (error: any) {
        console.error('Sync error:', error);
        return NextResponse.json({ error: error.message || 'Error en la sincronización' }, { status: 500 });
    }
}
