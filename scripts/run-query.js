require('dotenv').config({ path: '.env.local' });
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const projectRef = supabaseUrl.replace('https://', '').split('.')[0];

async function main() {
  const query = process.argv[2] || "SELECT proname FROM pg_proc WHERE pronamespace = 'public'::regnamespace ORDER BY proname";
  const res = await fetch(`https://${projectRef}.supabase.co/rest/v1/rpc/execute_sql`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      'apikey': serviceKey
    },
    body: JSON.stringify({ query_text: query })
  });
  console.log('Result:', await res.json());
}
main();
