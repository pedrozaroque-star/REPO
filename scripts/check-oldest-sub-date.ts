import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()

if (!SUPABASE_URL || !SUPABASE_KEY) {
    process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

async function main() {
    const { data: reviews } = await supabase
        .from('customer_feedback')
        .select('submission_date, created_at')
        .neq('source', 'google')
    
    if (!reviews || reviews.length === 0) return;

    let oldestSubmission = new Date('2030-01-01');
    let submissionCount = 0;

    reviews.forEach(r => {
        if (r.submission_date) {
            submissionCount++;
            const sDate = new Date(r.submission_date);
            if (sDate < oldestSubmission) {
                oldestSubmission = sDate;
            }
        }
    });

    console.log(`✅ Registro real más antiguo (submission_date): ${oldestSubmission.toLocaleDateString()}`);
}

main()
