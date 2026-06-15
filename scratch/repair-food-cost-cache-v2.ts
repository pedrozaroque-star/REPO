import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const MAX_RETRIES = 3;
const DELAY_MS = 500; // medio segundo entre requests
const TIMEOUT_MS = 30000; // 30 segundos timeout por request

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function fetchWithRetry(url: string, retries = MAX_RETRIES): Promise<any> {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
            
            const res = await fetch(url, { signal: controller.signal });
            clearTimeout(timeoutId);
            
            if (!res.ok) {
                const txt = await res.text();
                throw new Error(`HTTP ${res.status}: ${txt.substring(0, 100)}`);
            }
            return await res.json();
        } catch (e: any) {
            if (attempt === retries) throw e;
            console.log(`    ⚠️ Attempt ${attempt} failed: ${e.message}. Retrying in ${attempt * 2}s...`);
            await sleep(attempt * 2000);
        }
    }
}

async function repairCacheRobust() {
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: oldest } = await supabase.from('food_cost_daily_cache')
        .select('business_date').order('business_date', { ascending: true }).limit(1);
    const { data: newest } = await supabase.from('food_cost_daily_cache')
        .select('business_date').order('business_date', { ascending: false }).limit(1);
    const { count } = await supabase.from('food_cost_daily_cache')
        .select('id', { count: 'exact', head: true });

    const firstDate = oldest?.[0]?.business_date;
    const lastDate = newest?.[0]?.business_date;
    console.log(`Cache actual: ${firstDate} → ${lastDate} (${count} entries)`);

    if (!firstDate || !lastDate) { console.log('No dates'); return; }

    // Borrar cache
    console.log('\n🗑️  Borrando cache...');
    await supabase.from('food_cost_daily_cache').delete().gte('business_date', '2000-01-01');

    // Generar lista de fechas
    const BASE_URL = 'http://localhost:3000';
    const dates: string[] = [];
    const cursor = new Date(firstDate);
    const end = new Date(lastDate);
    while (cursor <= end) {
        dates.push(cursor.toISOString().split('T')[0]);
        cursor.setDate(cursor.getDate() + 1);
    }

    console.log(`🔄 Recalculando ${dates.length} días con retry + delay...\n`);

    let success = 0, errors = 0;
    const failed: string[] = [];

    for (const dateStr of dates) {
        try {
            const url = `${BASE_URL}/api/inventory/food-cost?storeId=all&startDate=${dateStr}&endDate=${dateStr}`;
            const json = await fetchWithRetry(url);
            success++;
            if (success % 10 === 0 || success === 1) {
                console.log(`  ✅ ${dateStr} (${success}/${dates.length})`);
            }
        } catch (e: any) {
            errors++;
            failed.push(dateStr);
            console.error(`  ❌ ${dateStr}: ${e.message}`);
        }
        await sleep(DELAY_MS);
    }

    console.log(`\n✅ RESULTADO: ${success} OK, ${errors} errores`);
    if (failed.length > 0) {
        console.log(`\n⚠️ Días fallidos (re-ejecutar manualmente):`);
        failed.forEach(d => console.log(`  ${d}`));
    }
}

repairCacheRobust();
