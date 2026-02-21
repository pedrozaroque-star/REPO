
import { getSupabaseAdminClient } from '../lib/supabase';
import { authClient } from '../lib/quickbooks';
import QuickBooks from 'node-quickbooks';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function fullSync() {
    const supabase = await getSupabaseAdminClient();
    const { data: integration } = await supabase.from('integrations').select('*').eq('service_name', 'quickbooks').single();
    if (!integration) return;

    const oauthClient = authClient;
    oauthClient.setToken(integration);
    const authResponse = await oauthClient.refreshUsingToken(integration.refresh_token);
    const tokens = authResponse.getJson();

    const qbo = new QuickBooks(
        process.env.QUICKBOOKS_CLIENT_ID, process.env.QUICKBOOKS_CLIENT_SECRET,
        tokens.access_token, false, integration.realm_id,
        process.env.QUICKBOOKS_ENVIRONMENT === 'sandbox', false, null, '2.0', tokens.refresh_token
    );

    const qbItems = await new Promise<any[]>((res) => qbo.findItems({ active: true }, (err, result) => res(result.QueryResponse.Item)));
    const { data: internalItems } = await supabase.from('inventory_items').select('*');

    for (const internal of internalItems!) {
        const qbMatch = qbItems.find(q => q.Sku === internal.sku) || qbItems.find(q => q.Name.toLowerCase() === internal.name.toLowerCase());

        if (qbMatch && qbMatch.UnitPrice > 0) {
            console.log(`Updating ${internal.name} to $${qbMatch.UnitPrice}`);
            await supabase.from('inventory_items').update({ purchase_unit_cost: qbMatch.UnitPrice }).eq('id', internal.id);
            await supabase.from('quickbooks_mappings').upsert({
                qb_item_id: qbMatch.Id,
                qb_item_name: qbMatch.Name,
                inventory_item_id: internal.id,
                last_fetch_cost: qbMatch.UnitPrice,
                updated_at: new Date()
            }, { onConflict: 'qb_item_id' });
        }
    }
    console.log('✅ Finalizado');
}

fullSync();
