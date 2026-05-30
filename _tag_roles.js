const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://ywwwdcvgfculqmcfkihq.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl3d3dkY3ZnZmN1bHFtY2ZraWhxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NjQyNDE4NiwiZXhwIjoyMDgyMDAwMTg2fQ.66P0FVgOuTV47tfSQ1r5FaFg8zSSwykw5DDIG33R_OA'
);

async function run() {
  // Fetch ROLES activities to know which ones are from ROLES
  const { data: rolesData } = await supabase.from('station_templates').select('data').eq('store_id', 'GLOBAL').eq('template_name', '__CONFIG_ACTIVITIES__').maybeSingle();
  const rolesActivities = rolesData?.data?.master_activities || [];
  const rolesNames = rolesActivities.map(r => r.name.trim());
  
  if (rolesNames.length === 0) return;

  // Set role = 'ROLES_MODULE' for those activities in operating_procedures
  const { data, error } = await supabase
    .from('operating_procedures')
    .update({ role: 'ROLES_MODULE' })
    .in('activity', rolesNames);
    
  console.log('Updated to ROLES_MODULE. Error:', error?.message || 'OK');
}
run();
