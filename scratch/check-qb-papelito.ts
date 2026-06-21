// 1. Load dotenv FIRST
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

// 2. Import everything else AFTER dotenv runs
import { createClient } from '@supabase/supabase-js';

async function checkQBPapelito() {
    // Dynamic import to ensure process.env is populated when lib/quickbooks.ts evaluates
    const { getQuickBooksClient } = await import('../lib/quickbooks');

    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: integration } = await supabase
        .from('integrations')
        .select('*')
        .eq('service_name', 'quickbooks')
        .single();

    if (!integration) {
        console.log('No QB integration found');
        return;
    }

    console.log(`Found integration: realm_id = ${integration.realm_id}`);

    try {
        const qbo = await getQuickBooksClient(integration.realm_id);
        const qbItems = await new Promise<any[]>((resolve, reject) => {
            qbo.findItems({ active: true }, (err: any, result: any) => {
                if (err) reject(err);
                else resolve(result?.QueryResponse?.Item || []);
            });
        });

        const papelitos = qbItems.filter((i: any) => i.Name.toLowerCase().includes('papelito'));
        console.log(`\n=== QB ITEMS matching "papelito" (${papelitos.length} found) ===`);
        papelitos.forEach((p: any) => {
            console.log(`  ID: ${p.Id} | Name: "${p.Name}" | Type: ${p.Type}`);
            console.log(`    UnitPrice (Sale Price): $${p.UnitPrice}`);
            console.log(`    PurchaseCost (Buy Price): $${p.PurchaseCost || 'N/A'}`);
            console.log(`    Description: ${p.Description || 'N/A'}`);
            console.log(`    PurchaseDesc: ${p.PurchaseDesc || 'N/A'}`);
            console.log('');
        });
    } catch (e: any) {
        console.error('Error connecting to QB or fetching items:', e);
    }
}

checkQBPapelito();
