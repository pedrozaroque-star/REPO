import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ Falta configuración de Supabase en .env.local');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const CSV_PATH = path.resolve('docs', 'promedios_apertura_cierre_2025_con_supervisor.csv');

// Helper to convert 12h time to 24h string (HH:mm)
const convertTime = (timeStr: string): string => {
    if (!timeStr) return '';
    // Format: "10:00 AM", "12:00 AM", "1:00 AM"
    const [time, modifier] = timeStr.trim().split(' ');
    let [hours, minutes] = time.split(':');

    let h = parseInt(hours, 10);

    if (modifier === 'PM' && h !== 12) h += 12;
    if (modifier === 'AM' && h === 12) h = 0; // Midnight is 00:00

    return `${h.toString().padStart(2, '0')}:${minutes}`;
}

const dayMap: Record<string, number> = {
    'Domingo': 0,
    'Lunes': 1,
    'Martes': 2,
    'Miércoles': 3,
    'Jueves': 4,
    'Viernes': 5,
    'Sábado': 6
};

async function main() {
    console.log('🚀 Iniciando sincronización de horarios desde CSV...');

    if (!fs.existsSync(CSV_PATH)) {
        console.error(`❌ No se encontró el archivo CSV en: ${CSV_PATH}`);
        process.exit(1);
    }

    const csvContent = fs.readFileSync(CSV_PATH, 'utf-8');
    const lines = csvContent.trim().split('\n');

    // Skip header
    const header = lines.shift();
    console.log(`📋 Headers: ${header}`);

    // Group by Store Name
    // storeName -> { dayInt: { day: int, open: "HH:mm", close: "HH:mm" } }
    const storesConfig: Record<string, any[]> = {};
    const storeMeta: Record<string, { openCounts: Record<string, number>, closeCounts: Record<string, number> }> = {};

    for (const line of lines) {
        // Tienda;Supervisor;Dia;HoraApertura;VentasApertura;HoraCierre;VentasCierre
        const cols = line.split(';');
        if (cols.length < 7) continue;

        const rawStoreName = cols[0].trim();
        const dayName = cols[2].trim();
        const rawOpen = cols[3].trim();
        const rawClose = cols[5].trim();

        // Normalize store name to match DB (remove "Tacos Gavilan ")
        // We will do a fuzzy match later, but for grouping let's keep raw first

        const dayInt = dayMap[dayName];
        if (dayInt === undefined) {
            console.warn(`⚠️ Día desconocido: ${dayName}`);
            continue;
        }

        const open24 = convertTime(rawOpen);
        const close24 = convertTime(rawClose);

        if (!storesConfig[rawStoreName]) {
            storesConfig[rawStoreName] = [];
            storeMeta[rawStoreName] = { openCounts: {}, closeCounts: {} };
        }

        storesConfig[rawStoreName].push({
            day: dayInt,
            open: open24,
            close: close24
        });

        // Track frequency for default values
        storeMeta[rawStoreName].openCounts[open24] = (storeMeta[rawStoreName].openCounts[open24] || 0) + 1;
        storeMeta[rawStoreName].closeCounts[close24] = (storeMeta[rawStoreName].closeCounts[close24] || 0) + 1;
    }

    console.log(`📦 Se encontraron configuraciones para ${Object.keys(storesConfig).length} tiendas en el CSV.`);

    // Fetch actual stores from DB to match IDs
    const { data: dbStores, error } = await supabase.from('stores').select('id, name, code');
    if (error) {
        console.error('❌ Error fetching stores:', error);
        process.exit(1);
    }

    console.log(`🏢 Se encontraron ${dbStores.length} tiendas en la base de datos.`);

    // Process updates
    for (const rawName of Object.keys(storesConfig)) {
        // Try to find matching store
        // CSV Name example: "Tacos Gavilan Azusa"
        // DB Name example: "Azusa" or "Tacos Gavilan Azusa"

        // Simple logic: check if DB Name is contained in CSV Name or vice versa
        const cleanCsvName = rawName.replace('Tacos Gavilan', '').trim().toLowerCase();

        const match = dbStores.find(s =>
            s.name.toLowerCase().includes(cleanCsvName) ||
            cleanCsvName.includes(s.name.toLowerCase())
        );

        if (!match) {
            console.warn(`⚠️ No se encontró coincidencia en DB para: ${rawName}`);
            continue;
        }

        const weekly = storesConfig[rawName];
        // Calculate most common open/close for defaults
        const meta = storeMeta[rawName];
        const defaultOpen = Object.entries(meta.openCounts).sort((a, b) => b[1] - a[1])[0][0];
        const defaultClose = Object.entries(meta.closeCounts).sort((a, b) => b[1] - a[1])[0][0];

        console.log(`🔄 Actualizando ${match.name} (ID: ${match.id})...`);
        console.log(`   -> Default Open: ${defaultOpen}, Close: ${defaultClose}`);
        console.log(`   -> Weekly Days: ${weekly.length}`);

        // Update DB
        const { error: updateError } = await supabase
            .from('stores')
            .update({
                // opening_time: defaultOpen, // Keep existing or update? Let's update to be safe
                // closing_time: defaultClose,
                opening_time: defaultOpen,
                closing_time: defaultClose, // Set default
                weekly_hours: weekly
            })
            .eq('id', match.id);

        if (updateError) {
            console.error(`❌ Error actualizando ${match.name}:`, updateError);
        } else {
            console.log(`✅ ${match.name} actualizado correctamente.`);
        }
    }

    console.log('✨ Sincronización completada.');
}

main().catch(console.error);
