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

// Current hardcoded mapping from lib/toast-api.ts
// These act as the SOURCE OF TRUTH for the migration
const STORE_NAME_OVERRIDES: Record<string, string> = {
    'acf15327-54c8-4da4-8d0d-3ac0544dc422': 'Rialto',
    'e0345b1f-d6d6-40b2-bd06-5f9f4fd944e8': 'Azusa',
    '42ed15a6-106b-466a-9076-1e8f72451f6b': 'Norwalk',
    'b7f63b01-f089-4ad7-a346-afdb1803dc1a': 'Downey',
    '475bc112-187d-4b9c-884d-1f6a041698ce': 'LA Broadway',
    'a83901db-2431-4283-834e-9502a2ba4b3b': 'Bell',
    '5fbb58f5-283c-4ea4-9415-04100ee6978b': 'Hollywood',
    '47256ade-2cd4-4073-9632-84567ad9e2c8': 'Huntington', // Renaming logic to match likely DB name
    '8685e942-3f07-403a-afb6-faec697cd2cb': 'LA Central',
    '3a803939-eb13-4def-a1a4-462df8e90623': 'La Puente',
    '80a1ec95-bc73-402e-8884-e5abbe9343e6': 'Lynwood',
    '3c2d8251-c43c-43b8-8306-387e0a4ed7c2': 'Santa Ana',
    '9625621e-1b5e-48d7-87ae-7094fab5a4fd': 'Slauson',
    '95866cfc-eeb8-4af9-9586-f78931e1ea04': 'South Gate',
    '5f4a006e-9a6e-4bcf-b5bd-7f5e9d801a02': 'West Covina'
}

async function main() {
    console.log('🚀 Iniciando Migración Definitiva de Escalabilidad Toast...');

    // 1. Ensure 'toast_guid' column exists via raw SQL if possible, or assume it exists
    // Since we can't run DDL easily via client, we'll try to update first. 
    // If it fails, we assume user needs to add column manually or we use a separate migration step.
    // However, given previous steps, let's try to infer if we can proceed.

    // We will just try to update. If column missing, it will error, and user must add it.
    // BUT WAIT: The user asked to "Do All Steps". I should probably try to automate column creation if I can.
    // I don't have direct SQL access through client-js easily for DDL.
    // I will assume the column MIGHT exist, or I will instruct the user if it fails.
    // Actually, I can use the 'rpc' hack if there's an exec_sql function, but likely not.
    // Let's proceed with the update logic.

    console.log('📦 Obteniendo tiendas y conciliando IDs...');

    const { data: dbStores, error } = await supabase.from('stores').select('id, name');
    if (error) {
        console.error('❌ Error fetching db stores:', error);
        return;
    }

    console.log(`🏢 Se encontraron ${dbStores.length} tiendas en DB.`);

    let successCount = 0;
    let failCount = 0;

    for (const [toastId, targetName] of Object.entries(STORE_NAME_OVERRIDES)) {
        // Find DB store by loose name matching
        const match = dbStores.find(s => s.name.toLowerCase().includes(targetName.toLowerCase()));

        if (!match) {
            console.warn(`⚠️ No se encontró tienda en DB para: ${targetName} (Toast ID: ${toastId})`);
            continue;
        }

        // Update the toast_guid
        // Note: This relies on 'toast_guid' column existing.
        const { error: updError } = await supabase
            .from('stores')
            .update({ toast_guid: toastId } as any) // Cast as any because column might not be typed locally
            .eq('id', match.id);

        if (updError) {
            console.error(`❌ Falló al asignar GUID a ${match.name}:`, updError.message);
            if (updError.message.includes('column "toast_guid" of relation "stores" does not exist')) {
                console.error('🚨 CRITICAL: La columna "toast_guid" no existe en la tabla "stores".');
                console.error('   Solución: Ejecuta este SQL en Supabase: ALTER TABLE stores ADD COLUMN toast_guid TEXT;');
                process.exit(1);
            }
            failCount++;
        } else {
            console.log(`✅ ${match.name} vinculado con Toast ID: ${toastId}`);
            successCount++;
        }
    }

    console.log(`\n✨ Migración terminada.`);
    console.log(`   Exitos: ${successCount}`);
    console.log(`   Fallos: ${failCount}`);

    if (successCount > 0) {
        console.log('\n✅ Ahora el sistema es agnóstico del nombre. La vinculación es por ID robusto.');
    }
}

main().catch(console.error);
