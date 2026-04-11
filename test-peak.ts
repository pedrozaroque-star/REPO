import fs from 'fs';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
const env = dotenv.parse(fs.readFileSync('.env.local'));
const supa = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
    const { data: stores } = await supa.from('toast_restaurants').select('*');
    const slauson = stores.find(s => s.name.toLowerCase().includes('slauson'));
    
    if (!slauson) return console.log('NO SLAUSON');
    
    const { data: proj } = await supa.from('toast_sales_projections').select('*').eq('restaurant_guid', slauson.toast_guid);
    
    let hours = proj?.[0]?.hourly_breakdown;
    if (!hours) return console.log('NO HOURS');

    let maxSales = 1;
    let operatingHours = [];
    for (const h in hours) {
        let val = hours[h];
        if (val > maxSales) maxSales = val;
        operatingHours.push({ hour: parseInt(h, 10), projected_sales: val });
    }

    const hourScores = new Map<number, number>();
    operatingHours.forEach((h) => {
        hourScores.set(h.hour, h.projected_sales / maxSales);
    });

    console.log("6:00 PM Score:", hourScores.get(18));
    console.log("8:00 PM Score:", hourScores.get(20));

    let bStarts = [new Date("2026-04-09T01:00:00.000Z"), new Date("2026-04-09T03:30:00.000Z")]; // 6PM PDT and 8:30PM PDT

    for (const bStart of bStarts) {
        const hour = bStart.getHours();
        const salesScore = hourScores.get(hour) ?? 1.0;
        let peakPenalty = 0;
            if (salesScore >= 0.95) {
                peakPenalty = salesScore * 5000000;
            } else if (salesScore >= 0.85) {
                peakPenalty = salesScore * 2000000; 
            } else if (salesScore >= 0.75) {
                peakPenalty = salesScore * 500000;
            } else if (salesScore >= 0.50) {
                peakPenalty = salesScore * 100000;
            } else {
                peakPenalty = salesScore * 5000; 
            }
        console.log(`Time: ${bStart.getHours()} -> salesScore: ${salesScore.toFixed(3)} -> penalty: ${peakPenalty}`);
    }
}
run();
