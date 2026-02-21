
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

const DEFAULT_CATEGORY_ID = '5678dc7e-4514-4757-a5d0-9330e904140e'; // QuickBooks Import

async function fullOneToOneImport() {
    console.log('🚀 INITIALIZING 1-TO-1 MASS IMPORT...');

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
        accessToken = authResponse.getJson().access_token;
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

    const { data: currentMappings } = await supabase.from('quickbooks_mappings').select('qb_item_id');
    const mappedQbIds = new Set(currentMappings?.map(m => m.qb_item_id));

    let count = 0;
    for (const qbItem of qbItems) {
        if (qbItem.Type !== 'Inventory' && qbItem.Type !== 'NonInventory') continue;
        if (mappedQbIds.has(qbItem.Id)) continue; // Ya procesado

        // Creamos un item nuevo para este producto de QB (1-a-1)
        const { data: newItem, error } = await supabase.from('inventory_items').insert({
            name: qbItem.Name,
            sku: qbItem.Sku || null,
            category_id: DEFAULT_CATEGORY_ID,
            purchase_unit_cost: qbItem.UnitPrice || 0,
            unit_type: 'Unit'
        }).select().single();

        if (error) {
            console.error(`Error: ${error.message}`);
            continue;
        }

        await supabase.from('quickbooks_mappings').insert({
            qb_item_id: qbItem.Id,
            qb_item_name: qbItem.Name,
            inventory_item_id: newItem.id,
            last_fetch_cost: qbItem.UnitPrice || 0,
            updated_at: new Date()
        });

        count++;
        if (count % 10 === 0) console.log(`Created ${count} items...`);
    }

    console.log(`✅ IMPORT COMPLETED. Created ${count} new items.`);
}

fullOneToOneImport();
