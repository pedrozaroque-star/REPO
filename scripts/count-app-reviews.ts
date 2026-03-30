import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('❌ Missing SUPABASE credentials in .env.local')
    process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

async function main() {
    console.log('📊 Contando reseñas de Nuestra Propia App por sucursal...\n')

    // 1. Get stores mapping
    const { data: stores, error: storesError } = await supabase.from('stores').select('id, name')
    if (storesError) {
        console.error('❌ Error consultando tiendas:', storesError.message)
        return
    }
    const storeMap = stores.reduce((acc, s) => { acc[s.id] = s.name; return acc; }, {} as Record<string, string>);

    // 2. Get reviews for the App (source != 'google')
    const { data: reviews, error: reviewsError } = await supabase
        .from('customer_feedback')
        .select('id, store_id, source, created_at')
        .neq('source', 'google')

    if (reviewsError) {
        console.error('❌ Error consultando reseñas:', reviewsError.message)
        return
    }

    if (!reviews || reviews.length === 0) {
        console.log('No hay reseñas de la app en la base de datos.');
        return;
    }

    // 3. Find the oldest date
    let oldestDate = new Date(reviews[0].created_at);
    
    // 4. Count by store
    const countMap: Record<string, number> = {}
    
    // Also track unique sources just to be sure
    const sources = new Set<string>();

    reviews.forEach(r => {
        sources.add(r.source);
        const rDate = new Date(r.created_at);
        if (rDate < oldestDate) oldestDate = rDate;
        countMap[r.store_id] = (countMap[r.store_id] || 0) + 1
    })

    console.log(`✅ Total de reseñas en la app: ${reviews.length}`);
    console.log(`✅ Ingresando desde: ${oldestDate.toLocaleDateString()}`);
    console.log(`✅ Fuentes detectadas: ${Array.from(sources).join(', ')}\n`);

    // 5. Print table
    const tableData = Object.entries(countMap).map(([storeId, count]) => {
        return {
            'Sucursal': storeMap[storeId] || `ID: ${storeId}`,
            'Total Reseñas App': count
        }
    });

    tableData.sort((a, b) => b['Total Reseñas App'] - a['Total Reseñas App']);
    console.table(tableData);
}

main()
