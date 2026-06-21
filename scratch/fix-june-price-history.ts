/**
 * REPARACIÓN DE HISTORIAL DE PRECIOS DE JUNIO 2026
 * 
 * ¿Por qué bajó el food cost el 2 de junio?
 * El 2 de junio corrió un sync automático con el código viejo, guardando
 * los precios de compra bajos (PurchaseCost) en lugar de los precios de venta (UnitPrice).
 * Como el cálculo de food cost usa la fecha histórica ("máquina del tiempo"),
 * todos los días desde el 2 de junio en adelante usaron esos precios incorrectos.
 * 
 * Solución:
 * 1. Borrar los registros incorrectos creados entre el 2 de junio y hoy a las 19:40 PM.
 * 2. Mover la fecha de los registros correctos de hoy (sincronizados a las 19:49 PM)
 *    para que sean efectivos a partir del 2 de junio a las 00:00:00.
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('❌ Missing credentials');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function fix() {
    console.log('═══ REPARANDO HISTORIAL DE PRECIOS — JUNIO 2026 ═══');

    // 1. Borrar registros incorrectos
    console.log('\n🗑️  Eliminando registros de precio incorrectos (2 de Junio al 19 de Junio 19:40 PM)...');
    const { data: delData, error: delError } = await supabase.rpc('execute_sql', {
        query_text: `
            DELETE FROM inventory_price_history 
            WHERE effective_date >= '2026-06-02T00:00:00+00:00' 
              AND effective_date < '2026-06-19T19:40:00+00:00'
        `
    });

    if (delError) {
        console.error('❌ Error al borrar precios:', delError.message);
        process.exit(1);
    }
    console.log('✅ Registros incorrectos eliminados.');

    // 2. Obtener cuántos registros correctos tenemos de hoy
    const { data: countData } = await supabase.rpc('execute_sql', {
        query_text: `
            SELECT count(*) FROM inventory_price_history 
            WHERE effective_date >= '2026-06-19T19:40:00+00:00'
        `
    });
    console.log(`📊 Registros correctos encontrados hoy (después de las 19:40 PM): ${countData?.[0]?.count || 0}`);

    // 3. Mover la fecha de efectividad a Junio 2 para que cubra todo el mes
    console.log('🔄 Moviendo la fecha de efectividad de los precios correctos al 2 de Junio...');
    const { error: updateError } = await supabase.rpc('execute_sql', {
        query_text: `
            UPDATE inventory_price_history 
            SET effective_date = '2026-06-02T00:00:00+00:00' 
            WHERE effective_date >= '2026-06-19T19:40:00+00:00'
        `
    });

    if (updateError) {
        console.error('❌ Error al actualizar fechas:', updateError.message);
        process.exit(1);
    }
    console.log('✅ Fechas de efectividad actualizadas correctamente al 2026-06-02.');
}

fix()
    .then(() => {
        console.log('\n🎉 ¡Reparación completada!');
        process.exit(0);
    })
    .catch(err => {
        console.error('💥 Error fatal:', err);
        process.exit(1);
    });
