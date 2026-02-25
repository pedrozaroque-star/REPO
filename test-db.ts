import { createClient } from '@supabase/supabase-js';
require('dotenv').config({ path: '.env.local' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
supabase.from('inventory_items').select('name, yield_percent').eq('id', 'fab9d589-8ae8-4381-87da-85f836068996').single().then(res => console.log(res.data));
