
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

async function autoMapEverything() {
    console.log('🚀 INITIALIZING AUTOMATIC MAPPING WITH UNIT PRICE...');

    const { data: integration } = await supabase.from('integrations').select('*').single();
    if (!integration) return;

    // Refresh Token Logic
    const oauthClient = new OAuthClient({
        clientId: process.env.QUICKBOOKS_CLIENT_ID!,
        clientSecret: process.env.QUICKBOOKS_CLIENT_SECRET!,
        environment: process.env.QUICKBOOKS_ENVIRONMENT as 'sandbox' | 'production',
        redirectUri: process.env.QUICKBOOKS_REDIRECT_URI!,
    });

    oauthClient.setToken(integration);
    let accessToken = integration.access_token;

    try {
        console.log('Validando sesión de QuickBooks...');
        const authResponse = await oauthClient.refresh();
        const newToken = authResponse.getJson();
        accessToken = newToken.access_token;
        await supabase.from('integrations').update({
            access_token: newToken.access_token,
            refresh_token: newToken.refresh_token,
            updated_at: new Date()
        }).eq('id', integration.id);
        console.log('✅ Sesión renovada.');
    } catch (e) {
        console.log('Usando token actual (o requiere re-autorización manual).');
    }

    const qbo = new QuickBooks(
        process.env.QUICKBOOKS_CLIENT_ID, process.env.QUICKBOOKS_CLIENT_SECRET,
        accessToken, false, integration.realm_id,
        process.env.QUICKBOOKS_ENVIRONMENT === 'sandbox', false, null, '2.0', integration.refresh_token
    );

    const qbItems = await new Promise<any[]>((res) => {
        qbo.findItems({ active: true }, (err, result) => {
            if (err) {
                console.error('Error fetching items:', err.message);
                res([]);
                return;
            }
            res(result?.QueryResponse?.Item || []);
        });
    });

    const { data: internalItems } = await supabase.from('inventory_items').select('*');
    if (!internalItems) return;

    const mappingsMap = new Map<string, any>();

    for (const internal of internalItems) {
        let qbMatch = null;
        const internalSku = internal.sku?.trim().toUpperCase();
        const internalNameNormalized = internal.name.toLowerCase().trim();

        if (internalSku) {
            qbMatch = qbItems.find(q => q.Sku?.trim().toUpperCase() === internalSku);
        }

        if (!qbMatch) {
            qbMatch = qbItems.find(q => q.Name.toLowerCase().trim() === internalNameNormalized);
        }

        if (!qbMatch) {
            const manualMaps: Record<string, string> = {
                'asada': 'Carne Asada',
                'pollo': 'Pollo',
                'pastor': 'Pastor',
                'cabeza': 'Cabeza',
                'lengua': 'Lengua',
                'chorizo': 'Chorizo',
                'tripas': 'DPK COOKED TRIPAS'
            };
            const targetName = manualMaps[internalNameNormalized];
            if (targetName) qbMatch = qbItems.find(q => q.Name === targetName);
        }

        if (qbMatch) {
            // If multiple internal items match the same QB item, we just keep the mapping.
            // But the table unique constraint is on qb_item_id. 
            // Should it be unique on inventory_item_id too?
            // Usually one inventory item = one QB item.
            mappingsMap.set(qbMatch.Id, {
                qb_item_id: qbMatch.Id,
                qb_item_name: qbMatch.Name,
                inventory_item_id: internal.id,
                last_fetch_cost: qbMatch.UnitPrice || 0,
                updated_at: new Date()
            });
        }
    }

    const mappingsToAdd = Array.from(mappingsMap.values());

    if (mappingsToAdd.length > 0) {
        const { error } = await supabase.from('quickbooks_mappings').upsert(mappingsToAdd, { onConflict: 'qb_item_id' });
        if (error) {
            console.error('❌ Error saving mappings:', error.message);
        } else {
            console.log(`✅ SUCCESS! Mapped ${mappingsToAdd.length} items to QuickBooks.`);
        }
    }
}

autoMapEverything().catch(console.error);
