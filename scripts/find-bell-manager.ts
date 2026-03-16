import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkBell() {
    const { data: stores } = await supabase.from('stores').select('*').ilike('name', '%Bell%');
    console.log("Bell Store Data:", stores);

    const { data: users } = await supabase.from('users').select('*').ilike('email', '%bell%');
    console.log("Users with Bell in email:", users);
    
    // Find who tried to send it based on recently updated schedules?
    // Let's just output this.
}

checkBell();
