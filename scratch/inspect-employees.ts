import { supabase } from '../lib/supabase';

async function inspect() {
    console.log('Querying toast_employees...');
    const { data, error } = await supabase.from('toast_employees').select('*').limit(5);
    if (error) {
        console.error('Error:', error);
    } else {
        console.log('Successfully fetched employees:');
        data.forEach((emp, i) => {
            console.log(`\n--- Employee ${i + 1} ---`);
            console.log(JSON.stringify(emp, null, 2));
        });
    }
}

inspect();
