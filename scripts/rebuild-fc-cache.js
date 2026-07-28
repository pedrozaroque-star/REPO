// Reconstruir toda la caché de food cost (Enero 1 → Julio 26, 2026)
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

async function main() {
    const baseUrl = 'http://localhost:3000';
    
    // Generar todas las fechas desde Jan 1 hasta Jul 26
    const startDate = new Date('2026-01-01');
    const endDate = new Date('2026-07-26');
    const dates = [];
    
    const cursor = new Date(startDate);
    while (cursor <= endDate) {
        const y = cursor.getFullYear();
        const m = String(cursor.getMonth() + 1).padStart(2, '0');
        const d = String(cursor.getDate()).padStart(2, '0');
        dates.push(`${y}-${m}-${d}`);
        cursor.setDate(cursor.getDate() + 1);
    }

    console.log(`🔄 Reconstruyendo caché de food cost: ${dates.length} días (${dates[0]} → ${dates[dates.length-1]})`);
    console.log(`   Estimado: ~${Math.ceil(dates.length * 10 / 60)} minutos\n`);

    let success = 0;
    let errors = 0;
    const startTime = Date.now();

    for (let i = 0; i < dates.length; i++) {
        const dateStr = dates[i];
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
        const pct = ((i / dates.length) * 100).toFixed(1);
        
        try {
            const url = `${baseUrl}/api/inventory/food-cost?storeId=all&startDate=${dateStr}&endDate=${dateStr}`;
            const res = await fetch(url);
            
            if (!res.ok) {
                console.log(`  ❌ ${dateStr} — HTTP ${res.status} [${pct}% | ${elapsed}s]`);
                errors++;
                continue;
            }
            
            const json = await res.json();
            const items = json.data?.length || 0;
            success++;
            
            // Log every 5th day to avoid spam
            if (i % 5 === 0 || i === dates.length - 1) {
                console.log(`  ✅ ${dateStr} — ${items} items [${pct}% | ${elapsed}s elapsed | ${success}/${i+1} OK]`);
            }
        } catch (e) {
            console.log(`  ❌ ${dateStr} — ${e.message} [${pct}% | ${elapsed}s]`);
            errors++;
        }
    }

    const totalTime = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
    console.log(`\n${'═'.repeat(50)}`);
    console.log(`✅ RECONSTRUCCIÓN COMPLETADA`);
    console.log(`   Días procesados: ${success}/${dates.length}`);
    console.log(`   Errores: ${errors}`);
    console.log(`   Tiempo total: ${totalTime} minutos`);
    console.log(`${'═'.repeat(50)}`);
}

main().catch(console.error);
