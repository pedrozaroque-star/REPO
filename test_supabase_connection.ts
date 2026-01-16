import { supabase } from './lib/supabase';

async function testConnection() {
    console.log('Testing Supabase Connection...');
    try {
        const { data, error } = await supabase.from('users').select('count').limit(1).single();

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
