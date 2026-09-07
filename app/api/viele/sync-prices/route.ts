/**
 * @module api/viele/sync-prices
 * @description Endpoint para sincronización bajo demanda de precios de Viele & Sons desde la UI.
 *              Ejecuta el scraper en vivo contra shop.vieleandsons.com, detecta variaciones
 *              y actualiza el catálogo de compras viele_items y el Radar de Precios.
 *
 * @businessRules
 * - Marca oficial: Tacos Gavilan
 * - Solo accesible para usuarios autenticados / administradores.
 * - Detecta variaciones de precio (aumentos/rebajas) y nuevos SKUs.
 * - Actualiza timestamp last_scanned_at en todos los productos escaneados.
 *
 * @dataFlow
 * - Frontend (/admin/compras/viele) -> POST /api/viele/sync-prices
 * - syncVielePortalDirect -> syncVielePurchasesCatalog -> Supabase (viele_items, supplier_price_history)
 */

import { NextResponse } from 'next/server';
import { syncVielePortalDirect } from '@/lib/vendor-scraper';
import { syncVielePurchasesCatalog } from '@/lib/viele-price-sync';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST() {
  const startTime = Date.now();

  try {
    // 1. Scraping en vivo desde Viele & Sons
    const scrapeResult = await syncVielePortalDirect();

    if (!scrapeResult.success || scrapeResult.items.length === 0) {
      return NextResponse.json({
        success: false,
        error: scrapeResult.errorMessage || 'No se pudieron extraer los artículos de Viele & Sons.'
      }, { status: 500 });
    }

    // 2. Sincronizar catálogo de compras y radar de precios
    const syncSummary = await syncVielePurchasesCatalog(scrapeResult.items);

    if (!syncSummary.success) {
      return NextResponse.json({
        success: false,
        error: syncSummary.errorMessage || 'Error al actualizar base de datos.'
      }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      data: {
        totalScraped: syncSummary.totalScraped,
        totalUpdated: syncSummary.totalUpdated,
        totalIncreases: syncSummary.totalIncreases,
        totalDecreases: syncSummary.totalDecreases,
        totalUnchanged: syncSummary.totalUnchanged,
        totalNew: syncSummary.totalNew,
        newItemsList: syncSummary.newItemsList,
        changedItemsList: syncSummary.changedItemsList,
        durationMs: Date.now() - startTime
      }
    });
  } catch (err: any) {
    console.error('[Api:VieleSyncPrices] ❌ Error:', err);
    return NextResponse.json({
      success: false,
      error: err.message || 'Error interno al sincronizar precios.'
    }, { status: 500 });
  }
}
