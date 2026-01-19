
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
// Intentar usar service key primero, si no anon key
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !key) {
    console.error('❌ Error: No se encontraron las credenciales en .env.local');
    process.exit(1);
}

const supabase = createClient(url, key);

async function verUsuarios() {
    console.log('\n🔍 Consultando usuarios en Supabase...\n');

    const { data, error } = await supabase
        .from('users')
        .select('full_name, role, email, is_active')
        .order('role', { ascending: true });

    if (error) {
        console.error('❌ Error Supabase:', error.message);
    } else {
        console.table(data);
        console.log(`\n✅ Total Usuarios Encontrados: ${data.length}\n`);

        // Resumen por rol
        const roles = {};
        data.forEach(u => {
            const r = u.role || 'Sin Rol';
            roles[r] = (roles[r] || 0) + 1;
        });
        console.log('📊 Resumen por Rol:');
        console.table(roles);
    }
}

verUsuarios();
