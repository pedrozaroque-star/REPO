/**
 * REPARACIÓN DE HISTORIAL DE PRECIOS DE JUNIO 2026 (VÍA CLIENTE SUPABASE)
 * 
 * Este script realiza la limpieza utilizando los métodos nativos de Supabase para evitar
 * errores silenciosos de la función RPC.
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('❌ Missing Supabase credentials in .env.local');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function fixWithClient() {
    console.log('═══ REPARANDO HISTORIAL DE PRECIOS — CLIENT CLIENT ═══');

    // 1. Borrar registros incorrectos del 2 de junio al 19 de junio a las 19:40 PM
    console.log('\n🗑️  Eliminando registros de precio incorrectos (2 de Junio al 19 de Junio 19:40 PM)...');
    
    const { count, error: delError } = await supabase
        .from('inventory_price_history')
        .delete({ count: 'exact' })
        .gte('effective_date', '2026-06-02T00:00:00+00:00')
        .lt('effective_date', '2026-06-19T19:40:00+00:00');

    if (delError) {
        console.error('❌ Error al borrar precios:', delError.message);
        process.exit(1);
    }
    console.log(`✅ Registros incorrectos eliminados: ${count}`);

    // 2. Buscar cuántos registros de hoy (después de las 19:40 PM) existen
    const { data: correctRows, error: findError } = await supabase
        .from('inventory_price_history')
        .select('id, effective_date, purchase_unit_cost')
        .gte('effective_date', '2026-06-19T19:40:00+00:00');

    if (findError) {
        console.error('❌ Error al buscar registros correctos:', findError.message);
        process.exit(1);
    }
    console.log(`📊 Registros correctos encontrados hoy (después de las 19:40 PM): ${correctRows?.length || 0}`);

    if (!correctRows || correctRows.length === 0) {
        console.log('⚠️ No hay registros correctos de hoy para actualizar. ¿Ya corriste el sync de QuickBooks hoy?');
        return;
    }

    // 3. Actualizar la fecha de efectividad de los registros correctos al 2 de junio
    console.log('🔄 Moviendo la fecha de efectividad de los precios correctos al 2 de Junio...');
    const { count: updCount, error: updateError } = await supabase
        .from('inventory_price_history')
        .update({ effective_date: '2026-06-02T00:00:00+00:00' }, { count: 'exact' })
        .gte('effective_date', '2026-06-19T19:40:00+00:00');

    if (updateError) {
        console.error('❌ Error al actualizar fechas:', updateError.message);
        process.exit(1);
    }
    console.log(`✅ Fechas de efectividad actualizadas correctamente: ${updCount} registros movidos al 2026-06-02.`);
}

fixWithClient()
    .then(() => {
        console.log('\n🎉 ¡Reparación completada!');
        process.exit(0);
    })
    .catch(err => {
        console.error('💥 Error fatal:', err);
        process.exit(1);
    });
