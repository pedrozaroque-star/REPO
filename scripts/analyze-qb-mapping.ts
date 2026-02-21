
import { createClient } from '@supabase/supabase-js';
import QuickBooks from 'node-quickbooks';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function performMappingAnalysis() {
    console.log('--- MAPPING ANALYSIS: INTERNAL vs QUICKBOOKS ---');

    // 1. Get QuickBooks Items
    const { data: integration } = await supabase
        .from('integrations')
        .select('*')
        .eq('service_name', 'quickbooks')
        .single();

    if (!integration) {
        console.error('No QB integration found');
        return;
    }

    const qbo = new QuickBooks(
        process.env.QUICKBOOKS_CLIENT_ID,
        process.env.QUICKBOOKS_CLIENT_SECRET,
        integration.access_token,
        false,
        integration.realm_id,
        process.env.QUICKBOOKS_ENVIRONMENT === 'sandbox',
        false,
        null,
        '2.0',
        integration.refresh_token
    );

    const findItems = () => new Promise<any>((resolve, reject) => {
        qbo.findItems({ active: true }, (err, result) => {
            if (err) reject(err);
            else resolve(result.QueryResponse.Item);
        });
    });

    const qbItems = await findItems() as any[];
    console.log(`Fetched ${qbItems.length} active items from QuickBooks.`);

    // 2. Get Internal Inventory Items
    const { data: internalItems } = await supabase.from('inventory_items').select('*');
    if (!internalItems) return;
    console.log(`Fetched ${internalItems.length} standard inventory items.`);

    // 3. Mapping Logic
    const exactSkuMatches: any[] = [];
    const potentialNameMatches: any[] = [];
    const missing: any[] = [];

    for (const internal of internalItems) {
        const internalSku = internal.sku?.trim().toUpperCase();

        // Exact SKU Match
        const matchBySku = qbItems.find(q => q.Sku?.trim().toUpperCase() === internalSku);
        if (matchBySku) {
            exactSkuMatches.push({ internal, qb: matchBySku });
            continue;
        }

        // Potential Name Match (Case Insensitive)
        const matchByName = qbItems.find(q => q.Name?.toLowerCase().includes(internal.name.toLowerCase()) || internal.name.toLowerCase().includes(q.Name?.toLowerCase()));
        if (matchByName) {
            potentialNameMatches.push({ internal, qb: matchByName });
            continue;
        }

        missing.push(internal);
    }

    console.log('\n✅ EXACT SKU MATCHES (Ready to map):');
    exactSkuMatches.slice(0, 10).forEach(m => {
        console.log(`- ${m.internal.name} [SKU: ${m.internal.sku}] <---> QB: ${m.qb.Name} [Cost: $${m.qb.PurchaseCost}]`);
    });
    console.log(`... and ${exactSkuMatches.length - 10} more.`);

    console.log('\n🤔 POTENTIAL NAME MATCHES (Need verification):');
    potentialNameMatches.slice(0, 10).forEach(m => {
        console.log(`- ${m.internal.name} <---> QB: ${m.qb.Name} [Cost: $${m.qb.PurchaseCost}]`);
    });

    console.log('\n❌ MISSING IN QUICKBOOKS (Or NO match found):');
    const meatKeywords = ['carne', 'pollo', 'asada', 'pastor', 'tripa', 'chorizo', 'cabeza', 'lengua'];
    const criticalMissing = missing.filter(m => meatKeywords.some(k => m.name.toLowerCase().includes(k)));

    console.log('Critical (Meats):');
    criticalMissing.forEach(m => console.log(`- ${m.name} (Unit: ${m.unit_type})`));
}

performMappingAnalysis();
