const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const dotenv = require('dotenv');

// Load env directly since we are in a script
try {
    const envConfig = dotenv.parse(fs.readFileSync('.env.local'));
    const supabase = createClient(envConfig.NEXT_PUBLIC_SUPABASE_URL, envConfig.NEXT_PUBLIC_SUPABASE_ANON_KEY);

    async function verifyAdmins() {
        console.log('Verifying Admin users in Supabase (JS)...');
        const { data: admins, error } = await supabase
            .from('users')
            .select('id, email, full_name, role, store_id, store_scope')
            .eq('role', 'admin');

        if (error) {
            console.error('Error:', error.message);
        } else {
            console.log(JSON.stringify(admins, null, 2));
        }
    }

    verifyAdmins();

} catch (e) {
    console.error(e);
}
