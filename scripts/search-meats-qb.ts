
import { createClient } from '@supabase/supabase-js';
import QuickBooks from 'node-quickbooks';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function findMeatsInQB() {
    const { data: integration, error: intError } = await supabase.from('integrations').select('*').single();
    if (intError) {
        console.error('Error fetching integration:', intError);
        return;
    }

    const qbo = new QuickBooks(
        process.env.QUICKBOOKS_CLIENT_ID, process.env.QUICKBOOKS_CLIENT_SECRET,
        integration.access_token, false, integration.realm_id,
        process.env.QUICKBOOKS_ENVIRONMENT === 'sandbox', false, null, '2.0', integration.refresh_token
    );

    const itemsResult = await new Promise<any>((res, rej) => {
        qbo.findItems({ active: true }, (err, result) => {
            if (err) rej(err);
            else res(result);
        });
    });

    const items = itemsResult.QueryResponse.Item;
    const keywords = ['meat', 'beef', 'chicken', 'pork', 'asada', 'pastor', 'pollo', 'carne', 'chuck', 'flap', 'shoulder', 'cabeza', 'lengua', 'tripa', 'chorizo'];

    console.log('--- MEAT-RELATED ITEMS IN QUICKBOOKS ---');
    items.forEach(q => {
        const full = (q.Name + ' ' + (q.Description || '')).toLowerCase();
        if (keywords.some(k => full.includes(k))) {
            console.log(`- ${q.Name} | Sku: ${q.Sku || 'N/A'} | Cost: $${q.PurchaseCost} | Desc: ${q.Description || ''}`);
        }
    });
}

findMeatsInQB().catch(console.error);
