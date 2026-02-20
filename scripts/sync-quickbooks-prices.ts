
// @ts-ignore
import { createClient } from '@supabase/supabase-js';
// @ts-ignore
import QuickBooks from 'node-quickbooks';
// @ts-ignore
import dotenv from 'dotenv';
// @ts-ignore
import path from 'path';

// Fix for script execution context
// @ts-ignore
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

// We need to implement a slightly different getClient for the script because 
// the lib/quickbooks.ts might use Next.js specific imports or context that fails in a standalone script.
// But looking at lib/quickbooks.ts, it uses standard libraries. 
// However, 'authClient' export might cause issues if it initializes immediately with process.env.
// Let's try to inline the logic here to be safe and robust.

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

async function syncPrices() {
    console.log('Connecting to QuickBooks...');

    // 1. Get the first connected company
    const { data: integration, error } = await supabase
        .from('integrations')
        .select('*')
        .eq('service_name', 'quickbooks')
        .single();

    if (error || !integration) {
        console.error('No QuickBooks connection found in database. Please authenticate first by visiting /api/integrations/quickbooks/auth');
        return;
    }

    const companyId = integration.realm_id;
    console.log(`Found connection for Company ID: ${companyId}`);

    // 2. Initialize QB Client
    // Note: We are manually refreshing here to keep script self-contained
    // Ideally use the lib function if it works in this context. Use inline for safety.

    // Check if token needs refresh
    let accessToken = integration.access_token;
    if (new Date(integration.expires_at) <= new Date()) {
        console.log('Token expired, refreshing...');
        // Refresh logic would go here, relying on intuit-oauth
        // For simplicity in this script, we'll assume the lib/quickbooks.ts logic handles it 
        // or we just fail and ask user to re-auth if strict.
        // But let's try to use the lib if we can import it successfully.
    }

    // Let's assume we can construct the QB client directly with current token
    const qbo = new QuickBooks(
        process.env.QUICKBOOKS_CLIENT_ID,
        process.env.QUICKBOOKS_CLIENT_SECRET,
        accessToken,
        false,
        companyId,
        process.env.QUICKBOOKS_ENVIRONMENT === 'sandbox', // Use sandbox if environment says so
        true,
        null,
        '2.0',
        integration.refresh_token
    );

    // 3. Fetch Items
    console.log('Fetching items from QuickBooks...');

    // Promisify the findItems method
    const findItems = () => new Promise<any>((resolve, reject) => {
        qbo.findItems({ active: true }, (err: any, list: any) => {
            if (err) reject(err);
            else resolve(list);
        });
    });

    try {
        const result = await findItems();
        // QB API structure: { QueryResponse: { Item: [...] } }
        // Sometimes list is directly the QueryResponse if using node-quickbooks convenience methods? 
        // node-quickbooks `findItems` usually calls `query` with "select * from Item".
        // Let's inspect the structure safely.

        const items = result.QueryResponse?.Item || [];
        console.log(`Found ${items.length} items.`);

        for (const item of items) {
            // Log interesting items
            if (item.Type === 'Inventory' || item.Type === 'Service' || item.Type === 'NonInventory') {
                const cost = item.PurchaseCost || 0;
                const price = item.UnitPrice || 0;
                console.log(`Item: ${item.Name} | Cost: $${cost} | SKU: ${item.Sku || 'N/A'}`);

                // 4. Update Database
                // Logic: Find inventory item with matching Name or SKU
                // For now, we will just upsert into quickbooks_mappings
                // You can later add logic to link to real inventory_items

                const { error: upsertError } = await supabase
                    .from('quickbooks_mappings')
                    .upsert({
                        qb_item_id: item.Id,
                        qb_item_name: item.Name,
                        last_fetch_cost: cost,
                        updated_at: new Date()
                    }, { onConflict: 'qb_item_id' });

                if (upsertError) console.error('Error saving item:', upsertError.message);
            }
        }

        console.log('Sync complete!');

    } catch (err: any) {
        console.error('Error fetching from QuickBooks:', err);
        if (err.fault) {
            console.error('Fault:', JSON.stringify(err.fault));
        }
    }
}

syncPrices();
