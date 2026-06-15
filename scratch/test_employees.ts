import { supabase } from '../lib/supabase';

async function testEmployees() {
    console.log('Fetching employees...');
    const start = Date.now();
    try {
        let allEmps: any[] = [];
        let page = 0;
        const PAGE_SIZE = 1000;
        let hasMore = true;

        while (hasMore) {
            console.log(`Fetching page ${page}...`);
            const { data, error } = await supabase
                .from('toast_employees')
                .select('*')
                .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

            if (error) {
                console.error('❌ Error at page', page, ':', error.message);
                break;
            }
            if (!data) {
                console.log('No data returned on page', page);
                break;
            }
            allEmps = [...allEmps, ...data];
            console.log(`Retrieved ${data.length} employees on page ${page}. Total so far: ${allEmps.length}`);
            if (data.length < PAGE_SIZE) {
                hasMore = false;
            }
            page++;
        }
        console.log(`✅ Success! Total employees fetched: ${allEmps.length} in ${Date.now() - start}ms`);
    } catch (err) {
        console.error('❌ Unexpected error:', err);
    }
}

testEmployees();
