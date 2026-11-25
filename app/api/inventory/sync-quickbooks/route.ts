/**
 * @module api/inventory/sync-quickbooks
 *
 * @description Endpoint de sincronización de precios y plantillas de inventario desde QuickBooks Online (QBO).
 * Se ejecuta diariamente vía cron o manualmente vía GET/POST, actualizando `inventory_items.purchase_unit_cost`
 * y registrando cambios en `inventory_price_history`.
 *
 * @businessRules
 * - PRECIO CORRECTO: Se usa `UnitPrice` (precio que la bodega cobra al restaurante),
 *   que refleja el costo real del restaurante. `PurchaseCost` es fallback o usado cuando `multiplier > 1`.
 * - QuickBooks gobierna todos los insumos explícitamente vinculados en `quickbooks_mappings` (incluyendo las 8 carnes y abarrotes ordenables por restaurante con `is_bodega = false`), excluyendo ÚNICAMENTE artículos gobernados por proveedores externos (`supplier_item_mappings`, p. ej. Viele & Sons). El filtro `is_bodega === true` solo restringe el auto-matching de ítems no mapeados (Case B/C).
 * - Solo se procesan items de QB con Type = 'Inventory' o 'NonInventory'.
 * - `max_drop_percent`: bloquea caídas sospechosas > 50% salvo cambio legítimo de empaque.
 *
 * @dataFlow
 * - Cron / Admin -> `GET|POST /api/inventory/sync-quickbooks` -> `integrations` -> QBO SDK/REST -> `inventory_items`, `quickbooks_mappings`, `inventory_price_history`, `store_order_template`.
 *
 * @notes
 * - [2026-06-19] Added smart price protection: multiplier from DB, max_drop_percent blocking.
 * - [2026-07-08] Fixed liquids template matching to search specifically for 'orden liquidos' to prevent 'Bodega Liquidos' from overwriting it.
 * - [2026-07-26] Added packaging auto-sync from QB RecurringTransactions.
 * - [2026-11-10] Added QBO Invoice return reconciliation (`reconcileStoreOrdersWithQbInvoices`).
 * - [2026-11-23] Enforced `allowedRoles: ['admin', 'supervisor', 'manager']` with `allowCron: true`, paginated `qbo.findItems` beyond 100 items, added `MAXRESULTS 1000` to PASO 0 `RecurringTransaction` pre-scan, `.limit(5000)` on `inventory_items`, blocked `$0` (`rate <= 0`) price overwrites, unfroze QB-mapped restaurant items/meats (`is_bodega = false`) by skipping only `supplier_item_mappings` external SKUs on mapped items, removed duplicate manual `inventory_price_history` inserts, and aligned cache invalidation to 7 LA business days.
 * - Blindaje Fail-Closed (`verifyStaffAuth`): exige `CRON_SECRET` o sesión `admin`/`supervisor`/`manager` en GET y POST (rechaza tokens de `employee` y llamadas anónimas).
 */
import { NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { authClient } from '@/lib/quickbooks';
import QuickBooks from 'node-quickbooks';
import { verifyStaffAuth } from '@/lib/auth-server';
import { reconcileStoreOrdersWithQbInvoices } from '@/lib/inventory/qb-shipped-reconciliation';
import { addDaysIso, getBusinessDateLA } from '@/lib/inventory/food-cost-sales-resolver';

// ── Packaging Parser ──────────────────────────────────────────────────
// Extrae cantidad y unidad de medida del campo Description de QB
// Ej: "(Bag of 5 lbs)" → { qty: 5, unit: 'lb', description: '(Bag of 5 lbs)' }
// Ej: "(Crate of 400 ct)" → { qty: 400, unit: 'pza', description: '(Crate of 400 ct)' }
// Ej: "(Bag of 1 Gallon)" → { qty: 1, unit: 'gal', description: '(Bag of 1 Gallon)' }
// Empaques físicos verificados en operación cuyo texto legado en QBO RecurringTransaction no debe sobrescribir la base:
const LOCKED_PACKAGING_OVERRIDES: Record<string, { qty: number; unit: string; description: string }> = {
    '62968b74-7877-4650-aa43-4ec6e9eb1888': { qty: 440, unit: 'oz', description: '(Case of 440 oz)' }, // Amarillo Cheese (4 bolsas x 110 oz)
    '8ba55664-5ca9-4886-8ac8-acf1fd070713': { qty: 1, unit: 'pza', description: '(Per Unit)' },        // Cheesecake individual
};

function parsePackaging(description: string | undefined | null): { qty: number; unit: string; description: string } | null {
    if (!description) return null;
    
    // 1. Encontrar lo que esté entre paréntesis
    const parenMatch = description.match(/\(([^)]+)\)/);
    if (!parenMatch) return null;
    
    const innerText = parenMatch[1];

    // 1b. Soportar pesos compuestos exactos como "(Bag of 6 lbs 9 oz)" -> 6 + 9/16 = 6.5625 lb
    const compoundLbOz = innerText.match(/([\d.]+)\s*lbs?\s+([\d.]+)\s*oz\b/i);
    if (compoundLbOz) {
        const lbs = parseFloat(compoundLbOz[1]);
        const oz = parseFloat(compoundLbOz[2]);
        if (Number.isFinite(lbs) && Number.isFinite(oz) && (lbs + oz / 16) > 0) {
            return {
                qty: Number((lbs + oz / 16).toFixed(4)),
                unit: 'lb',
                description: parenMatch[0].trim(),
            };
        }
    }
    
    // 2. Buscar un patrón de número seguido por unidad admitida
    const unitRegex = /([\d.]+)\s*(lbs?|oz|gal(?:lon)?s?|ct|pza?|unis?|units?|rolls?|kg|g|l|ml|fl\s*oz)\b/i;
    const match = innerText.match(unitRegex);
    if (!match) return null;
    
    const qty = parseFloat(match[1]);
    if (isNaN(qty) || qty <= 0) return null;
    
    const rawUnit = match[2].toLowerCase().trim();
    const unitMap: Record<string, string> = {
        'lb': 'lb', 'lbs': 'lb',
        'oz': 'oz', 'fl oz': 'fl oz',
        'gal': 'gal', 'gallon': 'gal', 'gallons': 'gal',
        'ct': 'pza', 'pz': 'pza', 'pza': 'pza',
        'uni': 'pza', 'unis': 'pza', 'unit': 'pza', 'units': 'pza',
        'roll': 'pza', 'rolls': 'pza',
        'kg': 'kg', 'g': 'g', 'l': 'l', 'ml': 'ml'
    };
    
    return { 
        qty, 
        unit: unitMap[rawUnit] || rawUnit, 
        description: parenMatch[0].trim() 
    };
}

export const maxDuration = 300;

export async function GET(request: Request) {
    return POST(request);
}

export async function POST(request: Request) {
    try {
        const auth = verifyStaffAuth(request, {
            allowedRoles: ['admin', 'supervisor', 'manager'],
            allowCron: true,
        });
        if (!auth.authorized) {
            return auth.response || NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: auth.status || 401 });
        }
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

        // 4. Fetch ALL Active QB Items (paginated via limit/offset so catalogs > 100 items are never truncated)
        const QB_PAGE_SIZE = 1000;
        const QB_MAX_PAGES = 20;
        const qbItems: any[] = [];
        const seenQbItemIds = new Set<string>();
        let qbOffset = 1;

        for (let page = 0; page < QB_MAX_PAGES; page++) {
            const batch = await new Promise<any[]>((resolve, reject) => {
                qbo.findItems({ active: true, limit: QB_PAGE_SIZE, offset: qbOffset }, (err: any, result: any) => {
                    if (err) reject(err);
                    else resolve(result?.QueryResponse?.Item || []);
                });
            });

            if (!Array.isArray(batch) || batch.length === 0) break;

            for (const item of batch) {
                const itemId = String(item?.Id || '');
                if (itemId && !seenQbItemIds.has(itemId)) {
                    seenQbItemIds.add(itemId);
                    qbItems.push(item);
                }
            }

            if (batch.length < QB_PAGE_SIZE) break;
            qbOffset += batch.length;
        }
        console.log(`[QB-Sync] 📋 Fetched ${qbItems.length} active QB items across paginated query.`);

        // 5. Fetch Internal Items (explicit limit above PostgREST 1,000-row default)
        const { data: internalItems } = await supabase.from('inventory_items').select('*').limit(5000);
        if (!internalItems) throw new Error('No internal items found');

        // Fetch mappings with protection columns (multiplier, max_drop_percent)
        // If columns don't exist yet (pre-migration), the select still works — those fields will be undefined
        const { data: existingMappings } = await supabase
            .from('quickbooks_mappings')
            .select('qb_item_id, inventory_item_id, multiplier, max_drop_percent')
            .limit(5000);
        const mappedQbIds = new Set(existingMappings?.map(m => m.qb_item_id));
        const usedInternalIds = new Set(existingMappings?.map(m => m.inventory_item_id));

        // Fetch external distributor mappings (e.g. Viele & Sons) so QB never overwrites external supplier prices,
        // while allowing QB-mapped restaurant items (`is_bodega = false` such as all 8 active meats) to sync cleanly.
        const { data: supplierMappings } = await supabase
            .from('supplier_item_mappings')
            .select('master_item_id')
            .not('master_item_id', 'is', null)
            .limit(5000);
        const externalSupplierItemIds = new Set<string>(
            (supplierMappings || [])
                .map((sm: any) => sm.master_item_id)
                .filter(Boolean)
        );

        let updatedCount = 0;
        let createdCount = 0;
        let priceChanges = 0;
        let blockedCount = 0;
        let packagingChanges = 0;
        const blockedItems: string[] = [];
        const packagingUpdates: string[] = [];

        // Build a lookup of current prices for change detection
        const currentPriceMap = new Map<string, number>();
        const currentQtyPerUnitMap = new Map<string, number>();
        internalItems.forEach(item => {
            currentPriceMap.set(item.id, Number(item.purchase_unit_cost) || 0);
            currentQtyPerUnitMap.set(item.id, Number(item.quantity_per_unit) || 1);
        });

        const DEFAULT_CATEGORY_ID = '5678dc7e-4514-4757-a5d0-9330e904140e'; // QuickBooks Import
        const now = new Date();

        // FALLBACK multipliers: Used when the DB columns don't exist yet (pre-migration)
        // Once the migration runs, these are overridden by quickbooks_mappings.multiplier
        const FALLBACK_MULTIPLIERS: Record<string, number> = {
            '540': 60, // Papelito Para Torta (QB has price per piece, DB has Case of 60)
        };
        const DEFAULT_MAX_DROP_PERCENT = 50; // Block drops > 50% by default

        // ====================================================================
        // PASO 0: PRE-SCAN — Leer RecurringTransactions para extraer empaques
        // Construye un mapa qbItemId → {newQty, newUnit, newDescription}
        // Se ejecuta ANTES del sync de precios para informar al Smart Price Protection
        // ====================================================================
        const packagingMap = new Map<string, { qty: number; unit: string; description: string }>();
        try {
            console.log('[QB-Sync] 📦 PASO 0: Pre-scanning RecurringTransactions para datos de empaque...');
            const qbQueryPreScan = async (sql: string) => {
                const res = await fetch(`https://quickbooks.api.intuit.com/v3/company/${integration.realm_id}/query?query=${encodeURIComponent(sql)}&minorversion=75`, {
                    headers: { 'Authorization': `Bearer ${accessToken}`, 'Accept': 'application/json' }
                });
                if (!res.ok) throw new Error(`QB Query Failed: ${res.statusText}`);
                const data = await res.json();
                return data?.QueryResponse?.RecurringTransaction || [];
            };
            const preScanRecurring = await qbQueryPreScan('SELECT * FROM RecurringTransaction MAXRESULTS 1000');
            for (const t of preScanRecurring) {
                if (!t.Estimate) continue;
                const lines = t.Estimate.Line || [];
                for (const line of lines) {
                    if (line.DetailType !== 'SalesItemLineDetail' || !line.SalesItemLineDetail?.ItemRef?.value) continue;
                    const qbItemId = line.SalesItemLineDetail.ItemRef.value;
                    if (packagingMap.has(qbItemId)) continue; // Ya parseado desde otro template
                    const pkg = parsePackaging(line.Description);
                    if (pkg) packagingMap.set(qbItemId, pkg);
                }
            }
            console.log(`[QB-Sync] 📦 Pre-scan completado: ${packagingMap.size} items con datos de empaque.`);
        } catch (preScanErr: any) {
            console.error('[QB-Sync] ⚠️ Pre-scan de empaques falló (continuando sin datos de empaque):', preScanErr.message);
        }

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

            // Case A: Already mapped in `quickbooks_mappings`
            const existingMapping = existingMappings?.find(m => m.qb_item_id === qbItem.Id);
            if (existingMapping) {
                // 🛡️ REGLA FUNDAMENTAL DE NEGOCIO:
                // Items explícitamente mapeados a distribuidores externos (`supplier_item_mappings`, ej. Viele & Sons)
                // son gobernados exclusivamente por el Radar de Precios. Los ítems de restaurante abastecidos por
                // La Bodega (incluyendo las 8 carnes con `is_bodega = false`) SÍ sincronizan precio/empaque desde QBO.
                const targetItem = internalItems.find(i => i.id === existingMapping.inventory_item_id);
                if (targetItem && externalSupplierItemIds.has(targetItem.id)) {
                    continue;
                }

                // --- SMART PRICE PROTECTION ---
                // 1. Get multiplier: from DB column (post-migration) or fallback map (pre-migration)
                const dbMultiplier = Number((existingMapping as any).multiplier);
                const multiplier = (dbMultiplier && dbMultiplier > 0) ? dbMultiplier : (FALLBACK_MULTIPLIERS[qbItem.Id] || 1);
                // Items con multiplier > 1 (ej: Papelito) deben usar PurchaseCost × multiplier
                // porque QB tiene precio unitario y UnitPrice es un precio de venta inflado.
                const effectiveBase = multiplier > 1 ? (purchaseCost > 0 ? purchaseCost : baseRate) : baseRate;
                const rate = effectiveBase * multiplier;

                const oldPrice = currentPriceMap.get(existingMapping.inventory_item_id) || 0;

                // 🛡️ ZERO-PRICE PROTECTION: Never overwrite a valid purchase_unit_cost with $0 or negative rate
                if (!Number.isFinite(rate) || rate <= 0) {
                    console.warn(`[QB-Sync] ⚠️ Skipping non-positive QB rate ($${rate}) for "${qbItem.Name}" (preserving current cost $${oldPrice.toFixed(2)})`);
                    continue;
                }

                // 2. Check price protection: allow increases, block suspicious drops
                if (oldPrice > 0 && rate > 0 && rate < oldPrice) {
                    const dropPercent = ((oldPrice - rate) / oldPrice) * 100;
                    const maxDrop = Number((existingMapping as any).max_drop_percent) || DEFAULT_MAX_DROP_PERCENT;

                    if (dropPercent >= maxDrop) {
                        // Check if this is a legitimate packaging change
                        // If the Description shows a different bag size, compare cost-per-unit-measure
                        const pkgInfo = packagingMap.get(qbItem.Id);
                        const oldQtyPerUnit = currentQtyPerUnitMap.get(existingMapping.inventory_item_id) || 1;
                        let isLegitPackagingChange = false;

                        if (pkgInfo && Math.abs(pkgInfo.qty - oldQtyPerUnit) > 0.01) {
                            // Packaging changed! Compare cost per unit of measure (e.g. $/lb)
                            const oldCostPerMeasure = oldPrice / oldQtyPerUnit;
                            const newCostPerMeasure = rate / pkgInfo.qty;
                            const costPerMeasureDiff = Math.abs(oldCostPerMeasure - newCostPerMeasure) / oldCostPerMeasure * 100;
                            // If cost per unit of measure changed less than 10%, it's a packaging change
                            if (costPerMeasureDiff < 10) {
                                isLegitPackagingChange = true;
                                console.log(`[QB-Sync] 📦 PACKAGING CHANGE DETECTED: "${qbItem.Name}" bag ${oldQtyPerUnit} → ${pkgInfo.qty} ${pkgInfo.unit}. Cost/unit: $${oldCostPerMeasure.toFixed(2)} → $${newCostPerMeasure.toFixed(2)} (diff ${costPerMeasureDiff.toFixed(1)}%). ALLOWING price update.`);
                            }
                        }

                        if (!isLegitPackagingChange) {
                            // 🛡️ BLOCKED: Suspicious price drop (not explained by packaging)
                            console.log(`[QB-Sync] 🛡️ BLOCKED: "${qbItem.Name}" price drop ${dropPercent.toFixed(1)}% exceeds max ${maxDrop}% ($${oldPrice.toFixed(2)} → $${rate.toFixed(2)})`);
                            blockedCount++;
                            blockedItems.push(`${qbItem.Name}: $${oldPrice.toFixed(2)} → $${rate.toFixed(2)} (-${dropPercent.toFixed(1)}%)`);
                            // Still update the mapping's last_fetch_cost so we know what QB tried to send
                            await supabase.from('quickbooks_mappings').update({ last_fetch_cost: rate, updated_at: now }).eq('qb_item_id', qbItem.Id);
                            continue; // Skip the actual price update
                        }
                    }
                }

                // 3. Price is acceptable (increase or small drop) — apply update
                // Note: `trigger_log_inventory_price` on `inventory_items` logs `inventory_price_history` atomically with `quantity_per_unit`.
                if (Math.abs(oldPrice - rate) > 0.001) {
                    const currentQty = packagingMap.get(qbItem.Id)?.qty || currentQtyPerUnitMap.get(existingMapping.inventory_item_id) || 1;
                    await supabase.from('inventory_items').update({ purchase_unit_cost: rate, updated_at: now }).eq('id', existingMapping.inventory_item_id);
                    priceChanges++;
                    const direction = rate > oldPrice ? '⬆️' : '⬇️';
                    console.log(`[QB-Sync] ${direction} Price change: ${qbItem.Name} $${oldPrice.toFixed(2)} → $${rate.toFixed(2)} (qty_per_unit: ${currentQty})`);
                }

                await supabase.from('quickbooks_mappings').update({ last_fetch_cost: rate, updated_at: now }).eq('qb_item_id', qbItem.Id);
                updatedCount++;
                continue;
            }

            // For new/unmapped items, apply multiplier from fallback map only
            const newItemMultiplier = FALLBACK_MULTIPLIERS[qbItem.Id] || 1;
            const rate = baseRate * newItemMultiplier;

            if (!Number.isFinite(rate) || rate <= 0) {
                continue;
            }

            // Case B: Not mapped, try to find a FREE internal item by Name exactly (solo para items de Bodega)
            let internal = internalItems.find(i =>
                !usedInternalIds.has(i.id) &&
                (i.name.toLowerCase().trim() === qbItem.Name.toLowerCase().trim()) &&
                i.is_bodega === true
            );

            if (!internal) {
                // Case C: Create new item (`trigger_log_inventory_price` records initial price in `inventory_price_history`)
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
            createdCount++;
        }

        // ====================================================================
        // PASO 2: EMPAQUE — Actualizar descripciones y quantity_per_unit de QB
        // NOTA CRÍTICA: NUNCA se tocan los PARs automáticamente.
        // Los PARs son valores de negocio configurados manualmente por los gerentes.
        // Solo se actualizan: order_unit_description, unit_measure, quantity_per_unit.
        // ====================================================================
        try {
            for (const [qbItemId, rawPkgInfo] of packagingMap.entries()) {
                const mapping = existingMappings?.find(m => m.qb_item_id === qbItemId);
                if (!mapping) continue;
                const invItemId = mapping.inventory_item_id;
                const currentItem = internalItems.find(i => i.id === invItemId);
                if (currentItem && externalSupplierItemIds.has(currentItem.id)) continue;
                const pkgInfo = LOCKED_PACKAGING_OVERRIDES[invItemId] || rawPkgInfo;

                // PROTECCIÓN DE PIEZAS: Si el item se vende por pieza (pza/unit/dz), NO permitir que el sync cambie unit_measure a peso/volumen (lb, oz, gal)
                const isPieceItem = currentItem?.unit_measure === 'pza' || currentItem?.unit_measure === 'unit' || currentItem?.unit_measure === 'dz';
                const isWeightOrVolume = ['lb', 'oz', 'gal', 'kg', 'g', 'l', 'ml'].includes((pkgInfo.unit || '').toLowerCase());
                const newUnit = (isPieceItem && isWeightOrVolume) ? currentItem.unit_measure : pkgInfo.unit;

                // 1. Siempre actualizar descripción y unidad de medida si difieren
                if (currentItem && (
                    currentItem.order_unit_description !== pkgInfo.description ||
                    currentItem.unit_measure !== newUnit
                )) {
                    console.log(`[QB-Sync] 📝 Actualizando empaque de ${currentItem.name}: "${currentItem.order_unit_description || ''}" → "${pkgInfo.description}" (unit_measure: ${newUnit})`);
                    await supabase.from('inventory_items').update({
                        order_unit_description: pkgInfo.description,
                        unit_measure: newUnit,
                        updated_at: now.toISOString()
                    }).eq('id', invItemId);
                }

                // 2. Actualizar quantity_per_unit si cambió (para cálculos de food cost)
                // IMPORTANTE: Si el item es por pieza y la descripción trae peso (lb/oz), NO cambiar quantity_per_unit
                const oldQtyPerUnit = currentQtyPerUnitMap.get(invItemId) || 0;
                if (!(isPieceItem && isWeightOrVolume) && pkgInfo.qty > 0 && Math.abs(oldQtyPerUnit - pkgInfo.qty) > 0.01) {
                    const itemName = currentItem?.name || qbItemId;
                    console.log(`[QB-Sync] ⚖️ quantity_per_unit actualizado para ${itemName}: ${oldQtyPerUnit} → ${pkgInfo.qty} (sin tocar PARs)`);
                    await supabase.from('inventory_items').update({
                        quantity_per_unit: pkgInfo.qty,
                        updated_at: now.toISOString()
                    }).eq('id', invItemId);
                    packagingChanges++;
                    packagingUpdates.push(`${itemName}: qty_per_unit ${oldQtyPerUnit} → ${pkgInfo.qty} ${newUnit}`);
                }
            }

            // 2d. Invalidate food cost cache across the last 7 LA business days if any packaging, price, or new item changes occurred
            if (packagingChanges > 0 || priceChanges > 0 || createdCount > 0) {
                const cutoffStr = addDaysIso(getBusinessDateLA(), -7);
                await supabase.from('food_cost_daily_cache').delete().gte('business_date', cutoffStr);
                console.log(`[QB-Sync] 🗑️ Caché de food cost invalidada (últimos 7 días LA desde ${cutoffStr}) por ${packagingChanges} cambios de empaque + ${priceChanges} cambios de precio.`);
            }
        } catch (cascadeErr: any) {
            console.error('[QB-Sync] ❌ Error en cascada de empaques:', cascadeErr.message);
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

            // Helper: auto-resolver un item de QB que no tiene mapping
            // Busca en inventory_items por nombre, si no existe lo crea, y luego crea el mapping
            const autoResolveQbItem = async (qbItemId: string, qbItemName: string): Promise<any | null> => {
                try {
                    // Limpiar prefijo de categoría QB (e.g. "CLEANING SUPPLIES:Hand Sanitizer" → "Hand Sanitizer")
                    const cleanName = qbItemName.includes(':') ? qbItemName.split(':').pop()!.trim() : qbItemName;
                    
                    // Buscar en inventory_items por nombre (exacto o parcial)
                    const { data: existingItems } = await supabase
                        .from('inventory_items')
                        .select('id, name')
                        .or(`name.ilike.%${cleanName}%,name.ilike.%${qbItemName}%`)
                        .limit(1);
                    
                    let inventoryItemId: string;
                    
                    if (existingItems && existingItems.length > 0) {
                        inventoryItemId = existingItems[0].id;
                        console.log(`[QB-Sync] 🔗 Auto-linked: "${qbItemName}" (QB:${qbItemId}) → existing item "${existingItems[0].name}"`);
                    } else {
                        // Crear nuevo inventory_item
                        const { data: newItem, error: createErr } = await supabase
                            .from('inventory_items')
                            .insert({
                                name: cleanName,
                                unit_type: 'Case',
                                purchase_unit_cost: 0,
                                is_bodega: true
                            })
                            .select('id, name')
                            .single();
                        
                        if (createErr || !newItem) {
                            console.error(`[QB-Sync] ❌ No se pudo crear item "${cleanName}":`, createErr?.message);
                            return null;
                        }
                        inventoryItemId = newItem.id;
                        console.log(`[QB-Sync] ✨ Auto-created: "${newItem.name}" (QB:${qbItemId}) → new item ${newItem.id}`);
                    }
                    
                    // Crear mapping en quickbooks_mappings
                    const { error: mapErr } = await supabase
                        .from('quickbooks_mappings')
                        .upsert({
                            qb_item_id: qbItemId,
                            qb_item_name: qbItemName,
                            inventory_item_id: inventoryItemId
                        }, { onConflict: 'qb_item_id' });
                    
                    if (mapErr) {
                        console.error(`[QB-Sync] ❌ No se pudo crear mapping para "${qbItemName}":`, mapErr.message);
                        return null;
                    }
                    
                    // Agregar al mapa en memoria para este ciclo
                    const newMapping = { qb_item_id: qbItemId, inventory_item_id: inventoryItemId, qb_item_name: qbItemName };
                    qbToInternal.set(qbItemId, newMapping);
                    return newMapping;
                } catch (err: any) {
                    console.error(`[QB-Sync] ❌ Error auto-resolviendo "${qbItemName}":`, err.message);
                    return null;
                }
            };

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

            console.log('[QB-Sync] 🔄 Consultando todos los RecurringTransactions de QBO (MAXRESULTS 1000)...');
            const allRecurring = await qbQuery("SELECT * FROM RecurringTransaction MAXRESULTS 1000");
            console.log(`[QB-Sync] 📊 Encontrados ${allRecurring.length} recurring transactions en QB.`);

            // Agrupar los templates de tipo Estimate por Customer ID o categoría
            const dailyTemplatesByCustomerId = new Map<string, any>();
            let liquidsTemplate: any = null;
            let uniformsTemplate: any = null;

            allRecurring.forEach((t: any) => {
                if (!t.Estimate) return;
                const est = t.Estimate;
                const templateName = (est.RecurringInfo?.Name || t.RecurringInfo?.Name || '').toLowerCase();
                const customerId = est.CustomerRef?.value;
                const lineCount = (est.Line || []).filter((l: any) => l.DetailType === 'SalesItemLineDetail').length;

                if (templateName.includes('orden diaria') || templateName.includes('daily') || templateName.includes('diaria')) {
                    const existing = dailyTemplatesByCustomerId.get(String(customerId));
                    const existingCount = existing ? (existing.Line || []).filter((l: any) => l.DetailType === 'SalesItemLineDetail').length : 0;
                    if (!existing || lineCount > existingCount) {
                        dailyTemplatesByCustomerId.set(String(customerId), est);
                    }
                } else if (
                    templateName.includes('liquids') || 
                    templateName.includes('liquidos') || 
                    templateName.includes('líquidos')
                ) {
                    const currentCount = liquidsTemplate ? (liquidsTemplate.Line || []).filter((l: any) => l.DetailType === 'SalesItemLineDetail').length : 0;
                    if (!liquidsTemplate || lineCount > currentCount) {
                        liquidsTemplate = est;
                        console.log(`[QB-Sync] 🧴 Plantilla de Líquidos seleccionada: "${est.RecurringInfo?.Name}" (${lineCount} ítems)`);
                    }
                } else if (
                    templateName.includes('uniforms') || 
                    templateName.includes('uniformes')
                ) {
                    const currentCount = uniformsTemplate ? (uniformsTemplate.Line || []).filter((l: any) => l.DetailType === 'SalesItemLineDetail').length : 0;
                    if (!uniformsTemplate || lineCount > currentCount) {
                        uniformsTemplate = est;
                        console.log(`[QB-Sync] 🎽 Plantilla de Uniformes seleccionada: "${est.RecurringInfo?.Name}" (${lineCount} ítems)`);
                    }
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
                                
                                let mapping = qbToInternal.get(qbItemId);
                                if (!mapping) {
                                    mapping = await autoResolveQbItem(qbItemId, qbItemName);
                                    if (!mapping) {
                                        console.warn(`[QB-Sync] ⚠️ Template ${store.name}: Item "${qbItemName}" (QB:${qbItemId}) no se pudo resolver. Saltando.`);
                                        continue;
                                    }
                                }

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
                        const salesLines = lines.filter((l: any) => l.DetailType === 'SalesItemLineDetail');
                        console.log(`[QB-Sync] 🧴 Líquidos: ${lines.length} líneas totales, ${salesLines.length} SalesItemLineDetail`);
                        salesLines.forEach((l: any, i: number) => {
                            const ref = l.SalesItemLineDetail?.ItemRef;
                            const hasMappingInMemory = qbToInternal.has(ref?.value);
                            console.log(`[QB-Sync]   ${i+1}. ${ref?.name} (QB:${ref?.value}) → ${hasMappingInMemory ? '✅ mapeado' : '❌ SIN MAPEO'}`);
                        });
                        const liquidsItems: any[] = [];
                        let pos = 1;
                        
                        for (const line of lines) {
                            if (line.DetailType === 'SalesItemLineDetail' && line.SalesItemLineDetail?.ItemRef?.value) {
                                const qbItemId = line.SalesItemLineDetail.ItemRef.value;
                                const qbItemName = line.SalesItemLineDetail.ItemRef.name || 'Unknown';
                                
                                let mapping = qbToInternal.get(qbItemId);
                                if (!mapping) {
                                    mapping = await autoResolveQbItem(qbItemId, qbItemName);
                                    if (!mapping) {
                                        console.warn(`[QB-Sync] ⚠️ Template Líquidos: Item "${qbItemName}" (QB:${qbItemId}) no se pudo resolver. Saltando.`);
                                        continue;
                                    }
                                }

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

                // 3. Sincronizar template único de Uniformes
                try {
                    if (uniformsTemplate) {
                        console.log(`[QB-Sync] 🎽 Sincronizando template único de Uniformes: "${uniformsTemplate.RecurringInfo?.Name || 'Uniformes'}"`);
                        const uniLines = uniformsTemplate.Line || [];
                        const uniformsItems: any[] = [];
                        let uniPos = 1;
                        
                        for (const line of uniLines) {
                            if (line.DetailType === 'SalesItemLineDetail' && line.SalesItemLineDetail?.ItemRef?.value) {
                                const qbItemId = line.SalesItemLineDetail.ItemRef.value;
                                const qbItemName = line.SalesItemLineDetail.ItemRef.name || 'Unknown';
                                
                                let mapping = qbToInternal.get(qbItemId);
                                if (!mapping) {
                                    mapping = await autoResolveQbItem(qbItemId, qbItemName);
                                    if (!mapping) {
                                        console.warn(`[QB-Sync] ⚠️ Template Uniformes: Item "${qbItemName}" (QB:${qbItemId}) no se pudo resolver. Saltando.`);
                                        continue;
                                    }
                                }

                                uniformsItems.push({
                                    inventory_item_id: mapping.inventory_item_id,
                                    qb_item_id: qbItemId,
                                    qb_item_name: qbItemName,
                                    sort_position: uniPos++
                                });
                            }
                        }

                        if (uniformsItems.length > 0) {
                            // Limpiar todos los templates de uniformes anteriores en la DB
                            await supabase.from('store_order_template').delete().eq('order_type', 'uniforms');

                            // Preparar registros para todas las tiendas
                            const allStoresUniforms: any[] = [];
                            activeStores.forEach(store => {
                                uniformsItems.forEach(item => {
                                    allStoresUniforms.push({
                                        store_id: store.id,
                                        inventory_item_id: item.inventory_item_id,
                                        qb_item_id: item.qb_item_id,
                                        qb_item_name: item.qb_item_name,
                                        sort_position: item.sort_position,
                                        order_type: 'uniforms'
                                    });
                                });
                            });

                            // Insertar en lotes de 100
                            for (let i = 0; i < allStoresUniforms.length; i += 100) {
                                const batch = allStoresUniforms.slice(i, i + 100);
                                const { error: insertErr } = await supabase.from('store_order_template').insert(batch);
                                if (insertErr) {
                                    console.error(`[QB-Sync] ❌ Error insertando batch de uniformes:`, insertErr.message);
                                }
                            }
                            console.log(`[QB-Sync] 🎽 Template único de Uniformes sincronizado para las ${activeStores.length} tiendas (${uniformsItems.length} items c/u)`);
                        }
                    } else {
                        console.log('[QB-Sync] ⚠️ No se encontró ningún Template de Uniformes en Recurring Transactions de QBO.');
                    }
                } catch (uniformsError: any) {
                    console.error('[QB-Sync] ❌ Error en sync de template de uniformes:', uniformsError.message);
                }
            }
        } catch (templateError: any) {
            console.error('[QB-Sync] Error general en template sync:', templateError.message);
        }

        // 6. Reconcile shipped QBO Invoices back into inventory_order_lines (non-blocking fail-safe)
        const invoiceReconciliation = await reconcileStoreOrdersWithQbInvoices({ lookbackDays: 14 });
        if (invoiceReconciliation.reconciledOrders > 0) {
            console.log(
                `[QB-Sync] 🧾 Invoices conciliados: ${invoiceReconciliation.reconciledOrders} órdenes, ` +
                `${invoiceReconciliation.updatedLines} líneas ajustadas, ${invoiceReconciliation.zeroedLines} recortadas a 0, ` +
                `${invoiceReconciliation.addedLines} agregadas por Bodega.`
            );
        }

        // Log summary with protection details
        console.log(`[QB-Sync] ✅ Done: ${updatedCount} updated, ${createdCount} created, ${priceChanges} price changes, ${blockedCount} blocked, ${packagingChanges} packaging cascades, ${storesLinked} stores linked, ${itemsAdded} items added, ${itemsRemoved} items removed, ${templatesUpdated} templates updated (${templateItemsSynced} items)`);
        if (blockedItems.length > 0) {
            console.log(`[QB-Sync] 🛡️ Blocked items:`);
            blockedItems.forEach(b => console.log(`  - ${b}`));
        }
        if (packagingUpdates.length > 0) {
            console.log(`[QB-Sync] 📦 Packaging changes applied:`);
            packagingUpdates.forEach(p => console.log(`  - ${p}`));
        }

        return NextResponse.json({
            success: true,
            updatedCount,
            createdCount,
            priceChanges,
            blockedCount,
            blockedItems: blockedItems.length > 0 ? blockedItems : undefined,
            packagingSync: {
                packagingChanges,
                packagingUpdates: packagingUpdates.length > 0 ? packagingUpdates : undefined
            },
            storesLinked,
            templateSync: { itemsAdded, itemsRemoved, templatesUpdated, templateItemsSynced },
            invoiceReconciliation
        });

    } catch (error: any) {
        console.error('Sync error:', error);
        return NextResponse.json({ error: error.message || 'Error en la sincronización' }, { status: 500 });
    }
}
