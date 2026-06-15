import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function repairCache() {
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // 1. Ver qué hay en el cache
    const { data: oldest } = await supabase.from('food_cost_daily_cache')
        .select('business_date').order('business_date', { ascending: true }).limit(1);
    const { data: newest } = await supabase.from('food_cost_daily_cache')
        .select('business_date').order('business_date', { ascending: false }).limit(1);
    const { count } = await supabase.from('food_cost_daily_cache')
        .select('id', { count: 'exact', head: true });

    const firstDate = oldest?.[0]?.business_date;
    const lastDate = newest?.[0]?.business_date;
    console.log(`Cache actual: ${firstDate} → ${lastDate} (${count} entries)`);

    // 2. Borrar TODO el cache
    console.log('\n🗑️  Borrando cache completo...');
    const { error: delErr } = await supabase
        .from('food_cost_daily_cache')
        .delete()
        .gte('business_date', '2000-01-01');

    if (delErr) { console.error('Error:', delErr.message); return; }

    const { count: remaining } = await supabase
        .from('food_cost_daily_cache')
        .select('id', { count: 'exact', head: true });
    console.log(`  Entries restantes: ${remaining}`);

    // 3. Recalcular día por día llamando a la API de food-cost
    if (!firstDate || !lastDate) { console.log('No dates to recalculate'); return; }

    const BASE_URL = 'http://localhost:3000';
    const start = new Date(firstDate);
    const end = new Date(lastDate);
    const dates: string[] = [];
    
    const cursor = new Date(start);
    while (cursor <= end) {
        const y = cursor.getFullYear();
        const m = String(cursor.getMonth() + 1).padStart(2, '0');
        const d = String(cursor.getDate()).padStart(2, '0');
        dates.push(`${y}-${m}-${d}`);
        cursor.setDate(cursor.getDate() + 1);
    }

    console.log(`\n🔄 Recalculando ${dates.length} días (${firstDate} → ${lastDate})...`);
    console.log(`   Usando recetas + precios corregidos\n`);

    let success = 0, errors = 0;

    for (const dateStr of dates) {
        try {
            const url = `${BASE_URL}/api/inventory/food-cost?storeId=all&startDate=${dateStr}&endDate=${dateStr}`;
            const res = await fetch(url);
            
            if (!res.ok) {
                const txt = await res.text();
                throw new Error(`${res.status}: ${txt.substring(0, 100)}`);
            }

            const json = await res.json();
            success++;
            
            // Progress log every 5 days
            if (success % 5 === 0 || success === 1) {
                console.log(`  ✅ ${dateStr} — ${json.data?.length || 0} stores (${success}/${dates.length})`);
            }
        } catch (e: any) {
            errors++;
            console.error(`  ❌ ${dateStr}: ${e.message}`);
        }
    }

    console.log(`\n✅ RECÁLCULO COMPLETO:`);
    console.log(`  Success: ${success}/${dates.length}`);
    console.log(`  Errors: ${errors}`);

    // 4. Verificar resultado
    const { count: newCount } = await supabase
        .from('food_cost_daily_cache')
        .select('id', { count: 'exact', head: true });
    
    const { data: sample } = await supabase
        .from('food_cost_daily_cache')
        .select('business_date, store_name, total_cost, net_sales, cost_percentage')
        .order('business_date', { ascending: false })
        .limit(3);

    console.log(`\n  Nuevas entries en cache: ${newCount}`);
    console.log('  Muestra:');
    sample?.forEach(s => {
        console.log(`    ${s.business_date} | ${s.store_name} | FC: $${s.total_cost} | Sales: $${s.net_sales} | FC%: ${s.cost_percentage}%`);
    });
}

repairCache();
