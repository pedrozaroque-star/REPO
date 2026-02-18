import { supabase } from './lib/supabase';

async function testConnection() {
    console.log('Testing Supabase Connection...');
    try {
        const { data, error } = await supabase.from('sales_daily_cache').select('*').limit(1);

        if (error) {
            console.error('❌ Connection Failed:', error.message);
        } else {
            console.log('✅ Connection Successful!');
            console.log('Data received:', data);
        }
    } catch (err) {
        console.error('❌ Unexpected Error:', err);
    }
}

testConnection();
