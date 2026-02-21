
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

async function massImport() {
    console.log('🚀 INITIALIZING MASS IMPORT FROM QUICKBOOKS...');

    const { data: integration } = await supabase.from('integrations').select('*').eq('service_name', 'quickbooks').single();
    if (!integration) {
        console.error('No integration found');
        return;
    }

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
        console.log('✅ Token refreshed.');
    } catch (e) {
        console.log('Using current token...');
    }

    const qbo = new QuickBooks(
        process.env.QUICKBOOKS_CLIENT_ID, process.env.QUICKBOOKS_CLIENT_SECRET,
        accessToken, false, integration.realm_id,
        process.env.QUICKBOOKS_ENVIRONMENT === 'sandbox', false, null, '2.0',
        integration.refresh_token
    );

    const qbItems = await new Promise<any[]>((res) => {
        qbo.findItems({ active: true }, (err, result) => res(result?.QueryResponse?.Item || []));
    });

    console.log(`Fetched ${qbItems.length} items from QB.`);

    const { data: existingInternal } = await supabase.from('inventory_items').select('id, name, sku');
    const { data: existingMappings } = await supabase.from('quickbooks_mappings').select('qb_item_id, inventory_item_id');

    let createdCount = 0;
    let mappedCount = 0;

    for (const qbItem of qbItems) {
        // Skip categories and non-relevant types
        if (qbItem.Type !== 'Inventory' && qbItem.Type !== 'NonInventory') continue;

        // Check if already mapped
        const mapping = existingMappings?.find(m => m.qb_item_id === qbItem.Id);

        if (mapping) {
            // Already synced, just update cost
            await supabase.from('inventory_items').update({
                purchase_unit_cost: qbItem.UnitPrice,
                updated_at: new Date()
            }).eq('id', mapping.inventory_item_id);

            await supabase.from('quickbooks_mappings').update({
                last_fetch_cost: qbItem.UnitPrice,
                updated_at: new Date()
            }).eq('qb_item_id', qbItem.Id);

            mappedCount++;
            continue;
        }

        // Check if exists in inventory but not mapped
        let internal = existingInternal?.find(i =>
            (i.sku && i.sku.trim().toUpperCase() === qbItem.Sku?.trim().toUpperCase()) ||
            (i.name.toLowerCase().trim() === qbItem.Name.toLowerCase().trim())
        );

        if (!internal) {
            // CREATE NEW ITEM
            const { data: newItem, error: createError } = await supabase.from('inventory_items').insert({
                name: qbItem.Name,
                sku: qbItem.Sku || null,
                category_id: DEFAULT_CATEGORY_ID,
                purchase_unit_cost: qbItem.UnitPrice || 0,
                unit_type: 'Unit'
            }).select().single();

            if (createError) {
                console.error(`Error creating item ${qbItem.Name}:`, createError.message);
                continue;
            }
            internal = newItem;
            createdCount++;
        }

        // Create Mapping
        await supabase.from('quickbooks_mappings').insert({
            qb_item_id: qbItem.Id,
            qb_item_name: qbItem.Name,
            inventory_item_id: internal.id,
            last_fetch_cost: qbItem.UnitPrice || 0,
            updated_at: new Date()
        });

        // Ensure cost is updated even if it was pre-existing but unmapped
        await supabase.from('inventory_items').update({
            purchase_unit_cost: qbItem.UnitPrice || 0,
            updated_at: new Date()
        }).eq('id', internal.id);

        mappedCount++;
    }

    console.log(`\n✅ MASS IMPORT COMPLETED`);
    console.log(`Items Created: ${createdCount}`);
    console.log(`Total Mapped/Updated: ${mappedCount}`);
}

massImport();
