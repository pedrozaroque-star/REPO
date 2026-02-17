import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ Falta configuración de Supabase en .env.local');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// --- COPIADO DIRECTAMENTE DE route.ts ---

// Store-specific closing hours: { storeName: { dayOfWeek: closingHour } }
// dayOfWeek: 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
const STORE_CLOSING_HOURS: Record<string, Record<number, number>> = {
    'Azusa': { 0: 24, 1: 24, 2: 24, 3: 24, 4: 24, 5: 25, 6: 25 },  // 10AM → 12AM, Fri-Sat: 1AM
    'Bell': { 0: 24, 1: 24, 2: 24, 3: 24, 4: 24, 5: 26, 6: 26 },  // 10AM → 12AM, Fri-Sat: 2AM
    'Downey': { 0: 24, 1: 24, 2: 24, 3: 24, 4: 24, 5: 27, 6: 27 },  // 12AM / 3AM
    'Hollywood': { 0: 24, 1: 24, 2: 24, 3: 24, 4: 24, 5: 27, 6: 27 },  // 9AM → 12AM, Fri-Sat: 3AM
    'Huntington': { 0: 24, 1: 24, 2: 24, 3: 24, 4: 26, 5: 27, 6: 27 },  // 10AM → 12AM, Thu: 2AM, Fri-Sat: 3AM
    'LA Broadway': { 0: 26, 1: 25, 2: 25, 3: 25, 4: 26, 5: 28, 6: 28 },  // Sun:2AM, Mon-Wed:1AM, Thu:2AM / 4AM
    'LA Central': { 0: 26, 1: 26, 2: 26, 3: 26, 4: 27, 5: 28, 6: 28 },  // 2AM, Thu:3AM / 4AM
    'La Puente': { 0: 24, 1: 24, 2: 24, 3: 24, 4: 24, 5: 26, 6: 26 },  // 12AM / 2AM
    'Lynwood': { 0: 25, 1: 25, 2: 25, 3: 25, 4: 26, 5: 27, 6: 27 },  // 1AM, Thu:2AM / 3AM
    'Norwalk': { 0: 25, 1: 25, 2: 25, 3: 25, 4: 25, 5: 27, 6: 27 },  // 1AM / 3AM
    'Rialto': { 0: 24, 1: 24, 2: 24, 3: 24, 4: 25, 5: 27, 6: 27 },  // 9AM → 12AM, Thu: 1AM, Fri-Sat: 3AM
    'Santa Ana': { 0: 24, 1: 24, 2: 24, 3: 24, 4: 24, 5: 26, 6: 26 },  // 12AM / 2AM
    'Slauson': { 0: 25, 1: 25, 2: 25, 3: 25, 4: 25, 5: 27, 6: 27 },  // 10AM → 1AM, Fri-Sat: 3AM
    'South Gate': { 0: 24, 1: 24, 2: 24, 3: 24, 4: 24, 5: 27, 6: 27 },  // 10AM → 12AM, Fri-Sat: 3AM
    'West Covina': { 0: 25, 1: 25, 2: 25, 3: 25, 4: 25, 5: 27, 6: 27 }   // 1AM / 3AM
};

// Store opening hours (prep starts 1 hour before)
const STORE_OPENING_HOURS: Record<string, number> = {
    'Azusa': 10,        // Opens 10AM
    'Bell': 10,         // Opens 10AM
    'Downey': 9,        // Opens 9AM
    'Hollywood': 9,     // Opens 9AM
    'Huntington': 10,   // Opens 10AM
    'LA Broadway': 8,   // Opens 8AM
    'LA Central': 8,    // Opens 8AM
    'La Puente': 10,    // Opens 10AM
    'Lynwood': 9,       // Opens 9AM (prep at 8AM)
    'Norwalk': 9,       // Opens 9AM
    'Rialto': 9,        // Opens 9AM
    'Santa Ana': 10,    // Opens 10AM
    'Slauson': 10,      // Opens 10AM
    'South Gate': 10,   // Opens 10AM
    'West Covina': 9    // Opens 9AM
};

// --- FIN COPIA ---

const formatHour = (h: number): string => {
    // Normalizar > 24
    let hour = h;
    if (hour >= 24) hour -= 24;
    return `${hour.toString().padStart(2, '0')}:00`;
}

async function main() {
    console.log('🚀 Iniciando sincronización de horarios OFICIALES desde Constants...');

    // Fetch actual stores from DB
    const { data: dbStores, error } = await supabase.from('stores').select('id, name, code');
    if (error) {
        console.error('❌ Error fetching stores:', error);
        process.exit(1);
    }
    console.log(`🏢 Se encontraron ${dbStores.length} tiendas en DB.`);

    // Iterate over official config
    for (const storeKey of Object.keys(STORE_CLOSING_HOURS)) {
        // Find DB match
        // Key example: "Azusa", DB Name: "Tacos Gavilan Azusa"
        const match = dbStores.find(s => s.name.toLowerCase().includes(storeKey.toLowerCase()));

        if (!match) {
            console.warn(`⚠️ No se encontró tienda en DB para key: ${storeKey}`);
            continue;
        }

        const openingHour = STORE_OPENING_HOURS[storeKey] || 9;
        const closingMap = STORE_CLOSING_HOURS[storeKey];

        // Generate weekly_hours array
        // 0=Sun, 1=Mon, ...
        const weekly_hours = [];

        // Calculate frequent closing hour for default
        const closingCounts: Record<number, number> = {};

        for (let d = 0; d <= 6; d++) {
            const closeH = closingMap[d] || 24;
            closingCounts[closeH] = (closingCounts[closeH] || 0) + 1;

            weekly_hours.push({
                day: d, // 0=Sun
                open: formatHour(openingHour),
                close: formatHour(closeH)
            });
        }

        // Determine most common closing hour
        const sortedClosing = Object.entries(closingCounts).sort((a, b) => b[1] - a[1]);
        const defaultCloseH = parseInt(sortedClosing[0][0]);

        const defaultOpenStr = formatHour(openingHour);
        const defaultCloseStr = formatHour(defaultCloseH);

        console.log(`🔄 Actualizando ${match.name}...`);
        console.log(`   Open: ${defaultOpenStr}, Default Close: ${defaultCloseStr}`);

        const { error: updateError } = await supabase
            .from('stores')
            .update({
                opening_time: defaultOpenStr,
                closing_time: defaultCloseStr,
                weekly_hours: weekly_hours
            })
            .eq('id', match.id);

        if (updateError) {
            console.error(`❌ Error al actualizar:`, updateError);
        } else {
            console.log(`✅ Actualizado.`);
        }
    }
    console.log('✨ Sincronización finalizada.');
}

main().catch(console.error);
