import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://ywwwdcvgfculqmcfkihq.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl3d3dkY3ZnZmN1bHFtY2ZraWhxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NjQyNDE4NiwiZXhwIjoyMDgyMDAwMTg2fQ.66P0FVgOuTV47tfSQ1r5FaFg8zSSwykw5DDIG33R_OA';
const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
  const { data: stores } = await supabase.from('stores').select('*');
  console.log('Stores:', stores);
}

test();
