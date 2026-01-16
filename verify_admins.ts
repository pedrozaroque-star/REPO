import { supabase } from './lib/supabase';

async function verifyAdmins() {
    console.log('Verifying Admin users in Supabase...');
    try {
        const { data: admins, error } = await supabase
            .from('users')
            .select('id, email, full_name, role, store_id, store_scope')
            .eq('role', 'admin');

        if (error) {
            console.error('❌ Error fetching admins:', error.message);
            return;
        }

        if (admins && admins.length > 0) {
            console.log(`Found ${admins.length} admin(s):`);
            admins.forEach(admin => {
                console.log(`- ${admin.email} (${admin.full_name})`);
                console.log(`  Store ID: ${admin.store_id} ${admin.store_id ? '⚠️ (Should be null/empty)' : '✅'}`);
                console.log(`  Store Scope: ${JSON.stringify(admin.store_scope)}`);
            });
        } else {
            console.log('No admin users found.');
        }

    } catch (err) {
        console.error('❌ Unexpected Error:', err);
    }
}

verifyAdmins();
