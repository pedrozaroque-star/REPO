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

// Helper for format
const fmt = (h: number, m: number = 0) => `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;

// Configuration to apply
// 12am -> 00:00, 1am -> 01:00, 11pm -> 23:00
const UPDATES = [
    {
        nameKeywords: ['Azusa'],
        defaultOpen: '10:00',
        defaultClose: '23:00', // Mod: Mon-Thu/Sun is 11pm
        weekly: [
            { day: 1, open: '10:00', close: '23:00' }, // Mon
            { day: 2, open: '10:00', close: '23:00' }, // Tue
            { day: 3, open: '10:00', close: '23:00' }, // Wed
            { day: 4, open: '10:00', close: '23:00' }, // Thu
            { day: 5, open: '10:00', close: '00:00' }, // Fri (12am)
            { day: 6, open: '10:00', close: '00:00' }, // Sat (12am)
            { day: 0, open: '10:00', close: '23:00' }, // Sun
        ]
    },
    {
        nameKeywords: ['West Covina'],
        defaultOpen: '10:00',
        defaultClose: '01:00', // Mod: Mon-Thu/Sun is 1am
        weekly: [
            { day: 1, open: '10:00', close: '01:00' }, // Mon
            { day: 2, open: '10:00', close: '01:00' }, // Tue
            { day: 3, open: '10:00', close: '01:00' }, // Wed
            { day: 4, open: '10:00', close: '01:00' }, // Thu
            { day: 5, open: '10:00', close: '03:00' }, // Fri
            { day: 6, open: '10:00', close: '03:00' }, // Sat
            { day: 0, open: '10:00', close: '01:00' }, // Sun
        ]
    },
    {
        nameKeywords: ['Rialto'],
        defaultOpen: '10:00',
        defaultClose: '00:00', // Mod: Mon-Thu/Sun is 12am
        weekly: [
            { day: 1, open: '10:00', close: '00:00' }, // Mon
            { day: 2, open: '10:00', close: '00:00' }, // Tue
            { day: 3, open: '10:00', close: '00:00' }, // Wed
            { day: 4, open: '10:00', close: '00:00' }, // Thu
            { day: 5, open: '10:00', close: '02:00' }, // Fri
            { day: 6, open: '10:00', close: '02:00' }, // Sat
            { day: 0, open: '10:00', close: '00:00' }, // Sun
        ]
    }
];

async function main() {
    console.log('🚀 Aplicando actualizaciones específicas de horarios...');

    const { data: stores, error } = await supabase.from('stores').select('id, name');
    if (error) {
        console.error('❌ Error fetching stores:', error);
        return;
    }

    for (const update of UPDATES) {
        const match = stores.find(s => update.nameKeywords.some(k => s.name.includes(k)));
        if (!match) {
            console.warn(`⚠️ No se encontró tienda con keywords: ${update.nameKeywords.join(', ')}`);
            continue;
        }

        console.log(`🔄 Actualizando ${match.name}...`);

        const { error: updError } = await supabase
            .from('stores')
            .update({
                opening_time: update.defaultOpen,
                closing_time: update.defaultClose,
                weekly_hours: update.weekly
            })
            .eq('id', match.id);

        if (updError) {
            console.error(`❌ Falló actualización de ${match.name}:`, updError);
        } else {
            console.log(`✅ ${match.name} actualizado correctamente.`);
        }
    }
}

main().catch(console.error);
