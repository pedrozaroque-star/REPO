import { supabase } from '../lib/supabase';

async function testMissing() {
    const targets = [
        { name: 'Jesus Velazquez', first: 'Jesus', last: 'Velazquez' },
        { name: 'Alfonso Carrillo', first: 'Alfonso', last: 'Carrillo' },
        { name: 'Erick Martinez', first: 'Erick', last: 'Martinez' }
    ];

    for (const t of targets) {
        const { data } = await supabase
            .from('toast_employees')
            .select('id, toast_guid, first_name, last_name, email, deleted')
            .ilike('first_name', '%' + t.first + '%')
            .ilike('last_name', '%' + t.last + '%');
        console.log(t.name, '->', data);
    }
}

testMissing().catch(console.error);
