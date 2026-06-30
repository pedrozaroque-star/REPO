require('dotenv').config({path:'.env.local'});
const {createClient} = require('@supabase/supabase-js');
const axios = require('axios');

const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
    const {data: integ} = await s.from('integrations').select('*').eq('service_name','quickbooks').single();
    const accessToken = integ.access_token;
    const realmId = integ.realm_id;
    const baseUrl = 'https://quickbooks.api.intuit.com';

    // Get the most recent Lynwood Estimate to see the actual items
    const query = "SELECT * FROM Estimate WHERE CustomerRef = '1108' ORDER BY MetaData.LastUpdatedTime DESC MAXRESULTS 1";
    const url = `${baseUrl}/v3/company/${realmId}/query`;
    
    try {
        const resp = await axios.get(url, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Accept': 'application/json'
            },
            params: { query, minorversion: 75 }
        });

        const estimates = resp.data?.QueryResponse?.Estimate || [];
        console.log('Lynwood estimates found:', estimates.length);
        
        if (estimates.length > 0) {
            const est = estimates[0];
            console.log(`\nEstimate #${est.DocNumber} | Date: ${est.TxnDate} | Total: $${est.TotalAmt}`);
            console.log('---');
            
            let itemCount = 0;
            est.Line?.forEach((line) => {
                if (line.DetailType === 'SalesItemLineDetail') {
                    itemCount++;
                    const detail = line.SalesItemLineDetail;
                    const itemName = detail?.ItemRef?.name || 'Unknown';
                    const qbId = detail?.ItemRef?.value || '-';
                    const qty = detail?.Qty || 0;
                    console.log(`${String(itemCount).padStart(3)}. ${itemName.padEnd(45)} | QB ID: ${String(qbId).padEnd(5)} | Qty: ${qty}`);
                }
            });
            console.log(`\n=== Total items in QB Estimate: ${itemCount} ===`);
        } else {
            console.log('No Lynwood estimates found. Trying all estimates...');
            const q2 = "SELECT * FROM Estimate ORDER BY MetaData.LastUpdatedTime DESC MAXRESULTS 3";
            const r2 = await axios.get(url, {
                headers: { 'Authorization': `Bearer ${accessToken}`, 'Accept': 'application/json' },
                params: { query: q2, minorversion: 75 }
            });
            const all = r2.data?.QueryResponse?.Estimate || [];
            console.log('Recent estimates:', all.length);
            all.forEach(e => {
                const custName = e.CustomerRef?.name || 'Unknown';
                const lines = e.Line?.filter(l => l.DetailType === 'SalesItemLineDetail')?.length || 0;
                console.log(`  #${e.DocNumber} | ${custName} | ${e.TxnDate} | ${lines} items`);
            });
        }
    } catch (err) {
        console.log('Error:', err.response?.status, err.response?.data?.Fault?.Error?.[0]?.Message || err.message);
    }
})();
