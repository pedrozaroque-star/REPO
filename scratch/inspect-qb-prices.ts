/**
 * Inspeccionar campos de precio de QB directamente
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import OAuthClient from 'intuit-oauth';
// @ts-ignore
import QuickBooks from 'node-quickbooks';

async function inspectQBPrices() {
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const authClient = new OAuthClient({
        clientId: process.env.QUICKBOOKS_CLIENT_ID!,
        clientSecret: process.env.QUICKBOOKS_CLIENT_SECRET!,
        environment: process.env.QUICKBOOKS_ENVIRONMENT || 'sandbox',
        redirectUri: process.env.QUICKBOOKS_REDIRECT_URI!,
    });

    const { data: integration } = await supabase
        .from('integrations')
        .select('*')
        .eq('service_name', 'quickbooks')
        .single();

    if (!integration) { console.log('No QB integration found'); return; }

    // Refresh token
    const tokenResult = await authClient.refreshUsingToken(integration.refresh_token);
    const json = tokenResult.getJson ? tokenResult.getJson() : tokenResult;
    const accessToken = json.access_token;
    const refreshToken = json.refresh_token;

    if (!accessToken) { console.log('Failed to get access token'); return; }

    await supabase.from('integrations').update({
        access_token: accessToken,
        refresh_token: refreshToken,
        updated_at: new Date()
    }).eq('id', integration.id);

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
        refreshToken
    );

    const items: any[] = await new Promise((resolve, reject) => {
        qbo.findItems({ fetchAll: true, Active: true }, (err: any, data: any) => {
            if (err) reject(err);
            else resolve(data.QueryResponse?.Item || []);
        });
    });

    console.log(`\n═══ QB API: ${items.length} items ═══\n`);

    const keyItems = ['Carne Asada', 'Pastor', 'Cabeza', 'Lengua', 'Buche 6', 'Pollo', 
                      'Horchata', 'Salsa Roja', 'Papelito', 'Arroz', 'Frijol Molido',
                      'Chorizo', 'Carnitas 6', 'Queso Rayado', 'Mulitas', 'Salchicha',
                      'Bolsa Aguacate', 'Teleras', 'Milaneza', 'Quesadilla Bodega',
                      'Piña Concentrate', 'Tamarindo', 'Jamaica', 'Salsa Verde',
                      'Bolsa Crema', 'Jamon', 'Queso Cotija', 'Sopes'];

    console.log(`${'Nombre'.padEnd(45)} | ${'PurchaseCost'.padStart(13)} | ${'UnitPrice'.padStart(10)} | ${'→ Sync usa'.padStart(12)} | ID`);
    console.log('─'.repeat(100));

    for (const name of keyItems) {
        const matches = items.filter((i: any) => i.Name.toLowerCase().includes(name.toLowerCase()));
        for (const item of matches) {
            const pc = Number(item.PurchaseCost || 0);
            const up = Number(item.UnitPrice || 0);
            const used = up > 0 ? up : pc;
            const field = up > 0 ? 'UnitPrice' : 'PurchaseCost';
            console.log(
                `${item.Name.substring(0, 45).padEnd(45)} | $${pc.toFixed(2).padStart(12)} | $${up.toFixed(2).padStart(9)} | $${used.toFixed(2).padStart(8)} (${field}) | ${item.Id}`
            );
        }
    }

    // Full JSON for Carne Asada
    const asada = items.find((i: any) => i.Name === 'Carne Asada');
    if (asada) {
        console.log('\n═══ FULL JSON: Carne Asada ═══');
        console.log(JSON.stringify(asada, null, 2));
    }
}

inspectQBPrices().catch(console.error);
