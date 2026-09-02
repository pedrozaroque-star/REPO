import { supabaseAdmin } from '../lib/supabase';

async function main() {
    console.log('🔍 Buscando usuario de Raquel en users table...');
    const { data: users, error } = await supabaseAdmin
        .from('users')
        .select('*')
        .or('email.ilike.%raquel%,full_name.ilike.%raquel%');

    console.log('Usuarios coincidentes con Raquel:', users);
}

main().catch(console.error);
