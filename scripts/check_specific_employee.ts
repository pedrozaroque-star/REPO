import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://ywwwdcvgfculqmcfkihq.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl3d3dkY3ZnZmN1bHFtY2ZraWhxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NjQyNDE4NiwiZXhwIjoyMDgyMDAwMTg2fQ.66P0FVgOuTV47tfSQ1r5FaFg8zSSwykw5DDIG33R_OA';
const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
  const targetId = '7c3a836e-c76c-425f-bc08-e4d24c3701c0';
  
  const { data: emp } = await supabase
    .from('toast_employees')
    .select('*')
    .eq('id', targetId);

  console.log('Search by ID in toast_employees:', emp);

  const { data: empByV2 } = await supabase
    .from('toast_employees')
    .select('*')
    .eq('v2_toast_guid', targetId);

  console.log('Search by v2_toast_guid in toast_employees:', empByV2);
  
  const { data: empByGuid } = await supabase
    .from('toast_employees')
    .select('*')
    .eq('toast_guid', targetId);

  console.log('Search by toast_guid in toast_employees:', empByGuid);
}

test();
