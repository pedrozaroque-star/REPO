import { getSupabaseAdminClient } from '../lib/supabase';
import { fetchToastData } from '../lib/toast-api';

async function run() {
    const supabase = await getSupabaseAdminClient();

    // 1. Encontrar ID de Broadway
    const broadwayToastId = '475bc112-187d-4b9c-884d-1f6a041698ce';

    console.log('Borrando caché corrupta de LA Broadway para Enero 2026...');
    const { error } = await supabase
        .from('sales_daily_cache')
        .delete()
        .eq('store_id', broadwayToastId)
        .gte('business_date', '2026-01-01')
        .lte('business_date', '2026-01-31');

    if (error) {
        console.error('Error borrando caché:', error);
        return;
    }
    console.log('Caché borrada exitosamente. Iniciando re-sincronización forzada desde Toast API...');

    // 2. Refetch full month directly from Toast without cache
    // By passing skipCache, fetchToastData will hit Toast APIs and automatically invoke 
    // the Self-Healing mechanism (upserting the fresh data back into Supabase).
    await fetchToastData({
        storeIds: broadwayToastId,
        startDate: '2026-01-01',
        endDate: '2026-01-31',
        groupBy: 'day',
        skipCache: true
    });

    console.log('✅ Reparación completada. Los datos reales de Toast ahora están sincronizados en la base de datos.');
}

run();
