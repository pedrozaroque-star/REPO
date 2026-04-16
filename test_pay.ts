import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function run() {
    const { data } = await supabase.from('shifts')
        .select('*')
        .ilike('employee_name', '%Veronica Osorio%')
        .limit(1);
    console.log("Veronica:", data?.[0]?.job_id, data?.[0]?.job_title);
    
    const { data: d2 } = await supabase.from('shifts')
        .select('*')
        .ilike('employee_name', '%Eufrosina Perez%')
        .limit(1);
    console.log("Eufrosina:", d2?.[0]?.job_id, d2?.[0]?.job_title);
}
run();
