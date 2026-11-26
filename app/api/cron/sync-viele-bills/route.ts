/**
 * @module app/api/cron/sync-viele-bills/route
 * @description Cron job diario automatizado que se ejecuta todos los días a las 4:00 PM (hora de Los Ángeles, CA - America/Los_Angeles)
 *              para sincronizar de extremo a extremo todo el ecosistema del módulo "Crear Bills — QuickBooks Online":
 *              1) Las 15 sucursales de Tacos Gavilan en el portal de Viele & Sons (ClearNine: facturas Wxxxxxx de Sodas e Insumos + 50xxxxx de PO: CHEMICAL).
 *              2) Las facturas vivas del portal Wholesail (app.paywholesail.com) para todas las sucursales conectadas.
 *              3) Los Bills existentes en QuickBooks Online para Viele & Sons (Vendor ID '1', incluyendo validación de splits 3BLEA).
 *              4) Los Invoices y Bills de La Bodega Central (Tacos El Gavilan - Warehouse, Vendor ID '116') en QuickBooks Online.
 *
 * @businessRules
 * - Horario Oficial: Se ejecuta diariamente a las 4:00 PM hora de Los Ángeles (`America/Los_Angeles`, 16:00 hrs).
 * - Manejo de Horario de Verano (DST): En `vercel.json` están registrados `29 23 * * *` (4:29 PM PDT) y `29 0 * * *` (4:29 PM PST).
 *   Cuando la petición proviene del programador automático de Vercel (`vercel-cron`), el endpoint verifica que la hora actual
 *   en `America/Los_Angeles` sea las `16` hrs (4:00 PM) para evitar doble ejecución por cambio de horario estacional,
 *   salvo que se invoque manualmente o con `?force=true`.
 * - Ventana Móvil Acotada: Por defecto sincroniza los últimos 45 días (`addDaysIso(todayLA, -45)`) para impedir crecimiento ilimitado de payloads ClearNine/Wholesail/QBO; acepta override explícito con `?startDate=YYYY-MM-DD`.
 * - Persiste la caché unificada de las 15 sucursales en `integrations` (`service_name = 'viele_store_invoices_cache'`),
 *   el estado de última sincronización en `integrations` (`service_name = 'crear_bills_last_sync'`) y la auditoría en `activity_logs`.
 *
 * @dataFlow
 * - Vercel Cron (4:00 PM LA) -> `syncAllVieleStoresFromClearNine` -> `fetchVieleWholesailInvoicesWithBillStatus`
 *   -> `getWarehouseInvoicesWithBills` -> Supabase (`integrations` & `activity_logs`).
 *
 * @notes
 * - Soporta ejecución manual vía `GET` o `POST` con `?force=true` y `?startDate=YYYY-MM-DD`.
 * - HARDENING (2026-11-26): Se reemplazó el `startDate = '2026-07-01'` fijo por ventana móvil de 45 días (`DEFAULT_LOOKBACK_DAYS = 45`).
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyStaffAuth } from '@/lib/auth-server';
import { supabaseAdmin } from '@/lib/supabase';
import {
    fetchVieleWholesailInvoicesWithBillStatus,
    syncAllVieleStoresFromClearNine
} from '@/lib/viele-wholesail-bills';
import { getWarehouseInvoicesWithBills } from '@/lib/quickbooks-bills';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes max duration for Vercel Cron

const DEFAULT_LOOKBACK_DAYS = 45;

function addDaysIso(isoDate: string, deltaDays: number): string {
    const [year, month, day] = isoDate.split('-').map(Number);
    const utcDate = new Date(Date.UTC(year, (month || 1) - 1, (day || 1) + deltaDays));
    const y = utcDate.getUTCFullYear();
    const m = String(utcDate.getUTCMonth() + 1).padStart(2, '0');
    const d = String(utcDate.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function getLosAngelesDateTimeParts(date = new Date()): {
    laDateFormatted: string;
    laIsoDate: string;
    laHour: number;
    laTimeFormatted: string;
} {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Los_Angeles',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    }).formatToParts(date);

    const map: Record<string, string> = {};
    for (const p of parts) {
        map[p.type] = p.value;
    }

    const mm = map.month || '01';
    const dd = map.day || '01';
    const yyyy = map.year || '2026';
    const rawHour = Number(map.hour || '0');
    const laHour = rawHour === 24 ? 0 : rawHour;

    return {
        laDateFormatted: `${mm}-${dd}-${yyyy}`,
        laIsoDate: `${yyyy}-${mm}-${dd}`,
        laHour,
        laTimeFormatted: `${String(laHour).padStart(2, '0')}:${map.minute || '00'}:${map.second || '00'}`
    };
}

async function handleCronSync(request: NextRequest) {
    const auth = verifyStaffAuth(request, { allowedRoles: ['admin'], allowCron: true });
    if (!auth.authorized) return auth.response!;

    const startTime = Date.now();
    const { searchParams } = new URL(request.url);
    const force = searchParams.get('force') === 'true';
    const forceFullClearNine = searchParams.get('forceFullClearNine') === 'true';

    const userAgent = (request.headers.get('user-agent') || '').toLowerCase();
    const isVercelCron = userAgent.includes('vercel-cron');
    const { laDateFormatted, laIsoDate, laHour, laTimeFormatted } = getLosAngelesDateTimeParts();

    const rawStartDate = (searchParams.get('startDate') || '').trim();
    if (rawStartDate && !/^\d{4}-\d{2}-\d{2}$/.test(rawStartDate)) {
        return NextResponse.json(
            { success: false, error: 'startDate inválido: usa formato YYYY-MM-DD' },
            { status: 400 }
        );
    }
    const startDate = rawStartDate || addDaysIso(laIsoDate, -DEFAULT_LOOKBACK_DAYS);

    // Si es disparado automáticamente por las dos reglas UTC de Vercel Cron (PDT vs PST),
    // ejecutar únicamente cuando en Los Ángeles sean las 4:00 PM (16:00 hrs).
    if (isVercelCron && !force && laHour !== 16) {
        return NextResponse.json({
            success: true,
            skipped: true,
            reason: `Triggered at LA hour ${laHour}:00 (${laDateFormatted} ${laTimeFormatted} America/Los_Angeles). Scheduled execution is strictly at 16:00 (4:00 PM LA).`
        });
    }

    console.log(
        `[Cron:SyncCrearBills 4PM LA] 🚀 Iniciando sincronización total (${laDateFormatted} ${laTimeFormatted} America/Los_Angeles)...`
    );

    try {
        // 1. Sincronizar las 15 sucursales desde ClearNine (Wxxxxxx + 50xxxxx) + Wholesail vivo
        const clearNineCache = await syncAllVieleStoresFromClearNine(
            startDate,
            undefined,
            forceFullClearNine
        );
        const storesCachedCount = Object.keys(clearNineCache).length;

        // 2. Cruzar todas las facturas de Viele & Sons (ClearNine + Wholesail) contra QuickBooks Online Bills (Vendor ID '1')
        const { records: vieleRecords, storeStatuses } = await fetchVieleWholesailInvoicesWithBillStatus({
            startDate,
            refresh: false
        });

        const vieleTotal = vieleRecords.length;
        const vieleCreated = vieleRecords.filter((r) => r.hasBill).length;
        const vielePending = vieleRecords.filter((r) => !r.hasBill).length;
        const vieleTotalAmount = Number(
            vieleRecords.reduce((acc, r) => acc + r.totalAmount, 0).toFixed(2)
        );
        const vieleCreatedAmount = Number(
            vieleRecords.filter((r) => r.hasBill).reduce((acc, r) => acc + r.totalAmount, 0).toFixed(2)
        );
        const vielePendingAmount = Number(
            vieleRecords.filter((r) => !r.hasBill).reduce((acc, r) => acc + r.totalAmount, 0).toFixed(2)
        );
        const vieleSodasCount = vieleRecords.filter((r) => r.category === 'SODAS').length;
        const vieleSuppliesCount = vieleRecords.filter(
            (r) => r.category === 'SUPPLIES' || r.category === 'SUPPLIES_SPLIT'
        ).length;
        const vieleSuppliesSplitCount = vieleRecords.filter(
            (r) => r.category === 'SUPPLIES_SPLIT'
        ).length;
        const vieleChemicalsCount = vieleRecords.filter((r) => r.category === 'CHEMICALS').length;
        const wholesailConnectedStores = storeStatuses.filter((s) => s.connected).length;

        // 3. Sincronizar Invoices y Bills de La Bodega Central (Tacos El Gavilan - Warehouse, Vendor ID '116') en QuickBooks Online
        const warehouseRecords = await getWarehouseInvoicesWithBills({
            startDate,
            limit: 300
        });

        const warehouseTotal = warehouseRecords.length;
        const warehouseCreated = warehouseRecords.filter((r) => r.hasBill).length;
        const warehousePending = warehouseRecords.filter((r) => !r.hasBill).length;
        const warehouseTotalAmount = Number(
            warehouseRecords.reduce((acc, r) => acc + r.totalAmount, 0).toFixed(2)
        );
        const warehouseCreatedAmount = Number(
            warehouseRecords
                .filter((r) => r.hasBill)
                .reduce((acc, r) => acc + r.totalAmount, 0)
                .toFixed(2)
        );
        const warehousePendingAmount = Number(
            warehouseRecords
                .filter((r) => !r.hasBill)
                .reduce((acc, r) => acc + r.totalAmount, 0)
                .toFixed(2)
        );

        const durationMs = Date.now() - startTime;
        const executedAtIso = new Date().toISOString();

        const syncSummary = {
            status: 'success',
            schedule: 'Daily 4:00 PM America/Los_Angeles',
            startDate,
            laDateFormatted,
            laIsoDate,
            laTimeFormatted,
            executedAt: executedAtIso,
            durationMs,
            vieleAndSons: {
                storesSynced: storesCachedCount,
                wholesailConnectedStores,
                totalInvoices: vieleTotal,
                createdBills: vieleCreated,
                pendingBills: vielePending,
                totalAmount: vieleTotalAmount,
                createdAmount: vieleCreatedAmount,
                pendingAmount: vielePendingAmount,
                sodasCount: vieleSodasCount,
                suppliesCount: vieleSuppliesCount,
                suppliesSplit3BleaCount: vieleSuppliesSplitCount,
                chemicalsCount: vieleChemicalsCount
            },
            warehouseBodega: {
                totalInvoices: warehouseTotal,
                createdBills: warehouseCreated,
                pendingBills: warehousePending,
                totalAmount: warehouseTotalAmount,
                createdAmount: warehouseCreatedAmount,
                pendingAmount: warehousePendingAmount
            }
        };

        // 4. Guardar instantánea de última sincronización en `integrations` (`crear_bills_last_sync`)
        try {
            const fallbackExpiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
            const { data: existingSyncRow } = await supabaseAdmin
                .from('integrations')
                .select('id, expires_at')
                .eq('service_name', 'crear_bills_last_sync')
                .maybeSingle();

            if (existingSyncRow?.id) {
                const { error: updErr } = await supabaseAdmin
                    .from('integrations')
                    .update({
                        realm_id: 'daily_4pm_la_sync',
                        access_token: JSON.stringify(syncSummary),
                        refresh_token: laDateFormatted,
                        token_type: 'CRON_4PM_LA',
                        expires_at: existingSyncRow.expires_at || fallbackExpiresAt,
                        updated_at: executedAtIso
                    })
                    .eq('id', existingSyncRow.id);
                if (updErr) {
                    console.warn('[Cron:SyncCrearBills 4PM LA] ⚠️ Error actualizando crear_bills_last_sync:', updErr.message);
                }
            } else {
                const { error: insErr } = await supabaseAdmin.from('integrations').insert({
                    service_name: 'crear_bills_last_sync',
                    realm_id: 'daily_4pm_la_sync',
                    access_token: JSON.stringify(syncSummary),
                    refresh_token: laDateFormatted,
                    token_type: 'CRON_4PM_LA',
                    expires_at: fallbackExpiresAt,
                    updated_at: executedAtIso
                });
                if (insErr) {
                    console.warn('[Cron:SyncCrearBills 4PM LA] ⚠️ Error insertando crear_bills_last_sync:', insErr.message);
                }
            }
        } catch (cacheErr) {
            console.warn('[Cron:SyncCrearBills 4PM LA] ⚠️ No se pudo actualizar crear_bills_last_sync:', cacheErr);
        }

        // 5. Registrar auditoría en `activity_logs`
        try {
            await supabaseAdmin.from('activity_logs').insert({
                action: 'cron_sync_crear_bills',
                entity_type: 'quickbooks_bills',
                new_values: syncSummary
            });
        } catch (logErr) {
            console.warn('[Cron:SyncCrearBills 4PM LA] ⚠️ No se pudo registrar en activity_logs:', logErr);
        }

        console.log(
            `[Cron:SyncCrearBills 4PM LA] ✅ Sincronización completada en ${durationMs}ms | Viele: ${vieleTotal} (${vieleCreated} creados, ${vielePending} pendientes) | Bodega: ${warehouseTotal} (${warehouseCreated} creados, ${warehousePending} pendientes)`
        );

        return NextResponse.json({
            success: true,
            ...syncSummary
        });
    } catch (error: any) {
        const durationMs = Date.now() - startTime;
        console.error('[Cron:SyncCrearBills 4PM LA] ❌ Error:', error);

        try {
            await supabaseAdmin.from('activity_logs').insert({
                action: 'cron_sync_crear_bills',
                entity_type: 'quickbooks_bills',
                new_values: {
                    status: 'failed',
                    laDateFormatted,
                    laTimeFormatted,
                    error: error?.message || 'Unknown error',
                    durationMs,
                    executedAt: new Date().toISOString()
                }
            });
        } catch {
            // Ignore logging error
        }

        return NextResponse.json(
            {
                success: false,
                error: error?.message || 'Error en la sincronización diaria de Crear Bills (4:00 PM LA)'
            },
            { status: 500 }
        );
    }
}

export async function GET(request: NextRequest) {
    return handleCronSync(request);
}

export async function POST(request: NextRequest) {
    return handleCronSync(request);
}
