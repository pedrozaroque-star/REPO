
import dotenv from 'dotenv';
import path from 'path';
import { fetchToastData } from '../lib/toast-api';

const envPath = path.resolve(process.cwd(), '.env.local');
dotenv.config({ path: envPath });

const STORE_ID = '80a1ec95-bc73-402e-8884-e5abbe9343e6'; // Lynwood

async function repairThanksgiving() {
    console.log('\n🦃 REPARANDO THANKSGIVING 2025 (Forzando Sync desde Toast)...\n');

    try {
        // Al llamar con skipCache: true, forzamos a Toast API.
        // fetchToastData tiene lógica interna para guardar en Supabase (Self-Healing) si es fecha pasada.
        const result = await fetchToastData({
            storeIds: STORE_ID,
            startDate: '2025-11-27',
            endDate: '2025-11-27',
            groupBy: 'day',
            skipCache: true, // CLAVE: Ignorar lo que está en DB ($4k posiblemente incompleto)
            readOnly: false  // Permitir escritura en DB
        });

        const row = result.rows[0];
        if (row) {
            console.log(`\n✅ Sincronización Exitosa:`);
            console.log(`- Ventas Netas: $${row.netSales.toFixed(2)}`);
            console.log(`- Tickets: ${row.orderCount}`);
            console.log(`- Labor: ${row.totalHours.toFixed(2)} Hrs ($${row.laborCost.toFixed(2)})`);

            if (row.hourlySales) {
                console.log(`- Hourly Sales: ${Object.keys(row.hourlySales).length} horas registradas.`);
            }
        } else {
            console.log('❌ No se recibieron datos.');
        }

    } catch (error) {
        console.error('❌ Error Fatal:', error);
    }
}

repairThanksgiving();
