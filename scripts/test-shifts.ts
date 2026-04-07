import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({path: '.env.local'});
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
async function run() {
    const {data: shifts} = await supabase.from('shifts').select('employee_id').eq('store_id', 'aadb1b5b-01ec-43c3-ae34-ec2ffc0e5a6a').eq('shift_date', '2026-04-06').limit(1);
    if(shifts && shifts[0]) {
       console.log('shift emp_id:', shifts[0].employee_id);
       const {data: emp} = await supabase.from('toast_employees').select('id, toast_guid, store_ids').eq('id', shifts[0].employee_id);
       if(emp && emp[0]) console.log('emp by id:', emp[0].id, emp[0].store_ids);
       const {data: emp2} = await supabase.from('toast_employees').select('id, toast_guid, store_ids').eq('toast_guid', shifts[0].employee_id);
       if(emp2 && emp2[0]) console.log('emp by toast_guid:', emp2[0].id, emp2[0].store_ids);
    }
}
run();
