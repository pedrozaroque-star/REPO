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
    const { data: stores } = await supabase.from('stores').select('id, name')
    const lynwood = stores?.find(s => s.name === 'Lynwood')
    
    if (!lynwood) return;

    const { data: allLynwoodReviews } = await supabase
        .from('customer_feedback')
        .select('*')
        .eq('store_id', lynwood.id)
        .neq('source', 'google')
    
    if (!allLynwoodReviews || allLynwoodReviews.length === 0) return;

    console.log(`✅ Reseñas totales de la App en Lynwood: ${allLynwoodReviews.length}\n`);

    // Let's check submission_date and visit_date
    const validSubmissions = allLynwoodReviews.filter(r => r.submission_date);
    
    validSubmissions.sort((a, b) => new Date(a.submission_date || a.created_at).getTime() - new Date(b.submission_date || b.created_at).getTime());

    console.log('📅 Las 5 reseñas MÁS ANTIGUAS en Lynwood (ordenadas por submission_date):');
    for (let i = 0; i < Math.min(5, validSubmissions.length); i++) {
        const r = validSubmissions[i];
        console.log(`- submission_date: ${r.submission_date} | visit_date: ${r.visit_date} | created_at: ${r.created_at}`);
    }
}

main()
