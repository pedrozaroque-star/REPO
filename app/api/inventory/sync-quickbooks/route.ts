
import { NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { authClient } from '@/lib/quickbooks';
import QuickBooks from 'node-quickbooks';

export async function POST() {
    try {
        const supabase = await getSupabaseAdminClient();

        // 1. Get Integration
        const { data: integration } = await supabase
            .from('integrations')
            .select('*')
            .eq('service_name', 'quickbooks')
            .single();

        if (!integration) {
            return NextResponse.json({ error: 'No se encontró la integración de QuickBooks' }, { status: 404 });
        }

        // 2. Refresh Token
        let accessToken = integration.access_token;
        try {
            console.log('Intentando renovar token de QuickBooks...');
            const authResponse = await authClient.refreshUsingToken(integration.refresh_token);
            const tokens = authResponse.getJson();
            accessToken = tokens.access_token;

            // Save new tokens
            await supabase.from('integrations').update({
                access_token: tokens.access_token,
                refresh_token: tokens.refresh_token,
                expires_at: new Date(Date.now() + tokens.expires_in * 1000),
                updated_at: new Date(),
            }).eq('id', integration.id);
            console.log('✅ Token renovado exitosamente.');
        } catch (refreshError) {
            console.error('Error refreshing token:', refreshError);
            // Si el refresh falla, intentamos usar el que tenemos, pero probablemente de 401
        }

        // 3. Initialize QB Client
        const qbo = new QuickBooks(
            process.env.QUICKBOOKS_CLIENT_ID,
            process.env.QUICKBOOKS_CLIENT_SECRET,
            accessToken,
            false,
            integration.realm_id,
            process.env.QUICKBOOKS_ENVIRONMENT === 'production' ? false : true,
            false,
            null,
            '2.0',
            integration.refresh_token
        );

        // 4. Fetch QB Items
        const qbItems = await new Promise<any[]>((resolve, reject) => {
            qbo.findItems({ active: true }, (err, result) => {
                if (err) reject(err);
                else resolve(result?.QueryResponse?.Item || []);
            });
        });

        // 5. Fetch Internal Items
        const { data: internalItems } = await supabase.from('inventory_items').select('*');
        if (!internalItems) throw new Error('No internal items found');

        const updates_mappings = [];
        const updates_inventory = [];

        for (const internal of internalItems) {
            let qbMatch = null;
            const internalSku = internal.sku?.trim().toUpperCase();
            const internalNameNormalized = internal.name.toLowerCase().trim();

            // Match by SKU
            if (internalSku) {
                qbMatch = qbItems.find(q => q.Sku?.trim().toUpperCase() === internalSku);
            }

            // Match by Name
            if (!qbMatch) {
                qbMatch = qbItems.find(q => q.Name.toLowerCase().trim() === internalNameNormalized);
            }

            // Manual fallbacks
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
                const targetName = manualMaps[internalNameNormalized];
                if (targetName) qbMatch = qbItems.find(q => q.Name === targetName);
            }

            if (qbMatch && qbMatch.UnitPrice > 0) {
                const rate = Number(qbMatch.UnitPrice);

                updates_mappings.push({
                    qb_item_id: qbMatch.Id,
                    qb_item_name: qbMatch.Name,
                    inventory_item_id: internal.id,
                    last_fetch_cost: rate,
                    updated_at: new Date()
                });

                updates_inventory.push({
                    id: internal.id,
                    purchase_unit_cost: rate,
                    updated_at: new Date()
                });
            }
        }

        // 6. Perform Updates in Bulk (Supabase upsert handles arrays)
        if (updates_mappings.length > 0) {
            await supabase.from('quickbooks_mappings').upsert(updates_mappings, { onConflict: 'qb_item_id' });
        }

        if (updates_inventory.length > 0) {
            // Upsert inventory items to update costs
            // Note: Upsert needs all required fields, but we only want to update purchase_unit_cost.
            // Using a loop or a smart query is better here if upsert is too destructive.
            // Since we have the IDs, we can do multiple updates or a single upsert if we select enough fields.
            for (const invUpdate of updates_inventory) {
                await supabase.from('inventory_items')
                    .update({ purchase_unit_cost: invUpdate.purchase_unit_cost, updated_at: new Date() })
                    .eq('id', invUpdate.id);
            }
        }

        return NextResponse.json({
            success: true,
            mappedCount: updates_mappings.length
        });

    } catch (error: any) {
        console.error('Sync error:', error);
        return NextResponse.json({ error: error.message || 'Error en la sincronización' }, { status: 500 });
    }
}
