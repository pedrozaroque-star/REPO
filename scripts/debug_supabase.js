require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

async function checkConnection() {
    console.log('Checking connection...');
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!url || !key) {
        console.error('Missing env vars!');
        console.log('URL:', url);
        console.log('Key:', key ? 'FOUND' : 'MISSING');
        return;
    }

    const supabase = createClient(url, key);

    try {
        const { data, error } = await supabase.from('templates').select('count', { count: 'exact', head: true });
        if (error) {
            console.error('Connection Error:', error.message);
            console.error('Details:', error);
        } else {
            console.log('Connection Successful! Total templates:', data);
        }
    } catch (err) {
        console.error('Exception:', err);
    }
}

checkConnection();
