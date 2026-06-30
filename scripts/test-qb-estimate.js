require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const QuickBooks = require('node-quickbooks');

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
    const { data: integration } = await supabase
        .from('integrations').select('*').eq('service_name', 'quickbooks').single();

    const qbo = new QuickBooks(
        process.env.QUICKBOOKS_CLIENT_ID, process.env.QUICKBOOKS_CLIENT_SECRET,
        integration.access_token, false, integration.realm_id,
        process.env.QUICKBOOKS_ENVIRONMENT === 'production' ? false : true,
        false, null, '2.0', integration.refresh_token
    );

    // MISMO ALGORITMO que send-to-qb/route.ts
    const recentEstimates = await new Promise((resolve, reject) => {
        qbo.findEstimates({ fetchAll: false, limit: 20, desc: 'MetaData.LastUpdatedTime' }, (err, result) => {
            if (err) reject(err);
            else resolve(result?.QueryResponse?.Estimate || []);
        });
    });

    let maxNum = 0;
    for (const est of recentEstimates) {
        if (est.DocNumber) {
            const num = parseInt(est.DocNumber, 10);
            if (!isNaN(num) && num > maxNum) maxNum = num;
        }
    }
    const nextDocNumber = String(maxNum + 1);
    console.log(`Max DocNumber: ${maxNum} → Asignando: ${nextDocNumber}`);

    const today = new Date().toISOString().split('T')[0];
    const estimate = await new Promise((resolve, reject) => {
        qbo.createEstimate({
            DocNumber: nextDocNumber,
            CustomerRef: { value: '1108' },
            TxnDate: today,
            CustomerMemo: { value: `🧪 PRUEBA #3 - NO CONVERTIR A INVOICE\nPedido Lynwood - ${today}\n📝 Verificando numeración automática` },
            PrivateNote: '🧪 TEST #3 - ELIMINAR',
            Line: [
                { DetailType: 'SalesItemLineDetail', Amount: 0, SalesItemLineDetail: { ItemRef: { value: '201' }, Qty: 1, UnitPrice: 0 } },
            ]
        }, (err, result) => { if (err) reject(err); else resolve(result); });
    });

    console.log('\n✅ Estimate #' + estimate.DocNumber + ' | ID: ' + estimate.Id + ' | Customer: ' + estimate.CustomerRef?.name);
    console.log('⚠️  ELIMINAR después de verificar');
})();
