const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
);

async function inspect() {
  console.log('Querying distinct roles from operating_procedures...');
  const { data, error } = await supabase.from('operating_procedures').select('role');
  if (error) {
    console.error('Error:', error);
  } else {
    const rolesSet = new Set();
    data.forEach(row => {
      if (row.role) rolesSet.add(row.role);
    });
    console.log('Distinct roles found:', Array.from(rolesSet));
  }
}

inspect();
