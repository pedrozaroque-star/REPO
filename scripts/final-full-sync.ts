
import { createClient } from '@supabase/supabase-js';
import QuickBooks from 'node-quickbooks';
import OAuthClient from 'intuit-oauth';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function runFullSync() {
    console.log('🚀 RUNNING FULL SYNC (UNIT PRICE)...');

    const { data: integration } = await supabase.from('integrations').select('*').eq('service_name', 'quickbooks').single();
    if (!integration) return;

    const oauthClient = new OAuthClient({
        clientId: process.env.QUICKBOOKS_CLIENT_ID!,
        clientSecret: process.env.QUICKBOOKS_CLIENT_SECRET!,
        environment: process.env.QUICKBOOKS_ENVIRONMENT as 'sandbox' | 'production',
        redirectUri: process.env.QUICKBOOKS_REDIRECT_URI!,
    });

    oauthClient.setToken(integration);
    let accessToken = integration.access_token;

    try {
        const authResponse = await oauthClient.refresh();
        const tokens = authResponse.getJson();
        accessToken = tokens.access_token;
        await supabase.from('integrations').update({
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            updated_at: new Date()
        }).eq('id', integration.id);
    } catch (e) { }

    const qbo = new QuickBooks(
        process.env.QUICKBOOKS_CLIENT_ID, process.env.QUICKBOOKS_CLIENT_SECRET,
        accessToken, false, integration.realm_id,
        process.env.QUICKBOOKS_ENVIRONMENT === 'sandbox', false, null, '2.0',
        integration.refresh_token
    );

    const qbItems = await new Promise<any[]>((res) => {
        qbo.findItems({ active: true }, (err, result) => res(result?.QueryResponse?.Item || []));
    });

    const { data: internalItems } = await supabase.from('inventory_items').select('*');
    if (!internalItems) return;

    for (const internal of internalItems) {
        let qbMatch = qbItems.find(q => q.Sku?.trim().toUpperCase() === internal.sku?.trim().toUpperCase());
        if (!qbMatch) qbMatch = qbItems.find(q => q.Name.toLowerCase().trim() === internal.name.toLowerCase().trim());

        if (!qbMatch) {
            const manualMaps: Record<string, string> = {
                'asada': 'Carne Asada',
                'carne asada': 'Carne Asada',
                'pollo': 'Pollo',
                'pastor': 'Pastor',
                'cabeza': 'Cabeza',
                'lengua': 'Lengua',
                'chorizo': 'Chorizo',
                'tripas': 'DPK COOKED TRIPAS'
            };
            const targetName = manualMaps[internal.name.toLowerCase().trim()];
            if (targetName) qbMatch = qbItems.find(q => q.Name === targetName);
        }

        if (qbMatch && qbMatch.UnitPrice > 0) {
            const rate = Number(qbMatch.UnitPrice);
            console.log(`Syncing ${internal.name} -> $${rate}`);

            await supabase.from('inventory_items').update({ purchase_unit_cost: rate }).eq('id', internal.id);
            await supabase.from('quickbooks_mappings').upsert({
                qb_item_id: qbMatch.Id,
                qb_item_name: qbMatch.Name,
                inventory_item_id: internal.id,
                last_fetch_cost: rate,
                updated_at: new Date()
            }, { onConflict: 'qb_item_id' });
        }
    }
    console.log('✅ SYNC COMPLETE');
}

runFullSync();
