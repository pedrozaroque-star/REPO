require('dotenv').config({path:'.env.local'});
const {createClient} = require('@supabase/supabase-js');
const axios = require('axios');
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
    const {data: i} = await s.from('integrations').select('*').eq('service_name','quickbooks').single();
    const query = "SELECT DocNumber, Id, CustomerRef FROM Estimate ORDER BY MetaData.LastUpdatedTime DESC MAXRESULTS 15";
    const r = await axios.get(`https://quickbooks.api.intuit.com/v3/company/${i.realm_id}/query`, {
        headers: { 'Authorization': `Bearer ${i.access_token}`, 'Accept': 'application/json' },
        params: { query, minorversion: 75 }
    });
    const ests = r.data?.QueryResponse?.Estimate || [];
    console.log('Últimos 15 Estimates:');
    ests.forEach(e => console.log(`  ID: ${e.Id} | DocNumber: ${e.DocNumber || '(vacío)'} | Customer: ${e.CustomerRef?.name}`));
    
    // Find the max DocNumber
    const nums = ests.map(e => parseInt(e.DocNumber, 10)).filter(n => !isNaN(n));
    console.log('\nMax DocNumber encontrado:', Math.max(...nums));
    console.log('Siguiente debería ser:', Math.max(...nums) + 1);
})();
