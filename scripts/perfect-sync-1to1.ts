
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

const IMPORT_CAT_ID = '5678dc7e-4514-4757-a5d0-9330e904140e';

async function perfectSync() {
    console.log('🚀 INITIALIZING PERFECT 1-TO-1 SYNC...');

    // 1. Wipe mappings
    await supabase.from('quickbooks_mappings').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    console.log('🗑️ Mappings wiped.');

    // 2. Auth
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

    // 3. Get Items
    const qbItems = await new Promise<any[]>((res) => {
        qbo.findItems({ active: true }, (err, result) => res(result?.QueryResponse?.Item || []));
    });
    const { data: internalItems } = await supabase.from('inventory_items').select('*');

    const usedInternalIds = new Set<string>();
    let createdCount = 0;
    let mappedCount = 0;

    for (const qbItem of qbItems) {
        if (qbItem.Type !== 'Inventory' && qbItem.Type !== 'NonInventory') continue;

        // Try exact match
        let internal = internalItems?.find(i =>
            !usedInternalIds.has(i.id) && (
                (i.sku && i.sku.trim().toUpperCase() === qbItem.Sku?.trim().toUpperCase()) ||
                (i.name.toLowerCase().trim() === qbItem.Name.toLowerCase().trim())
            )
        );

        if (!internal) {
            // Create new item
            const { data: newItem, error } = await supabase.from('inventory_items').insert({
                name: qbItem.Name,
                sku: qbItem.Sku || null,
                category_id: IMPORT_CAT_ID,
                purchase_unit_cost: qbItem.UnitPrice || 0,
                unit_type: 'Unit'
            }).select().single();

            if (error) {
                console.error(`Error creating ${qbItem.Name}:`, error.message);
                continue;
            }
            internal = newItem;
            createdCount++;
        }

        // Create mapping
        await supabase.from('quickbooks_mappings').insert({
            qb_item_id: qbItem.Id,
            qb_item_name: qbItem.Name,
            inventory_item_id: internal.id,
            last_fetch_cost: qbItem.UnitPrice || 0,
            updated_at: new Date()
        });

        // Update cost
        await supabase.from('inventory_items').update({
            purchase_unit_cost: qbItem.UnitPrice || 0,
            updated_at: new Date()
        }).eq('id', internal.id);

        usedInternalIds.add(internal.id);
        mappedCount++;
        if (mappedCount % 50 === 0) console.log(`Processed ${mappedCount} items...`);
    }

    console.log(`\n✅ PERFECT SYNC COMPLETED`);
    console.log(`New Items Created: ${createdCount}`);
    console.log(`Total Items Mapped (1-to-1): ${mappedCount}`);
}

perfectSync();
