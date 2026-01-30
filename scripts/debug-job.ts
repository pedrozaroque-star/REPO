
import dotenv from 'dotenv';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const envPath = path.resolve(process.cwd(), '.env.local');
dotenv.config({ path: envPath });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function checkJob() {
    const { data: job } = await supabase
        .from('toast_jobs')
        .select('*')
        .eq('guid', 'e002a07f-9fe4-429d-b60d-3d2dee905841')
        .maybeSingle();

    console.log('JOB FOUND:', job);
}

checkJob();
