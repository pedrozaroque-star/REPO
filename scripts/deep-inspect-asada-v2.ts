
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

async function deepInspectAsada() {
    console.log('--- REVISANDO TOKEN Y REFRESCANDO ---');

    const { data: integration, error: dbError } = await supabase.from('integrations').select('*').eq('service_name', 'quickbooks').single();
    if (dbError || !integration) {
        console.error('Error DB:', dbError);
        return;
    }

    const oauthClient = new OAuthClient({
        clientId: process.env.QUICKBOOKS_CLIENT_ID!,
        clientSecret: process.env.QUICKBOOKS_CLIENT_SECRET!,
        environment: process.env.QUICKBOOKS_ENVIRONMENT as 'sandbox' | 'production',
        redirectUri: process.env.QUICKBOOKS_REDIRECT_URI!,
    });

    oauthClient.setToken(integration);

    try {
        console.log('Intentando refresh...');
        const authResponse = await oauthClient.refresh();
        const newToken = authResponse.getJson();
        console.log('✅ Refresh exitoso.');

        await supabase.from('integrations').update({
            access_token: newToken.access_token,
            refresh_token: newToken.refresh_token,
            updated_at: new Date()
        }).eq('id', integration.id);

        integration.access_token = newToken.access_token;
        integration.refresh_token = newToken.refresh_token;
    } catch (e: any) {
        console.error('❌ Error en refresh:', e.message);
        if (e.authResponse) {
            console.error('Detalle auth:', JSON.stringify(e.authResponse.json, null, 2));
        }
    }

    const qbo = new QuickBooks(
        process.env.QUICKBOOKS_CLIENT_ID, process.env.QUICKBOOKS_CLIENT_SECRET,
        integration.access_token, false, integration.realm_id,
        process.env.QUICKBOOKS_ENVIRONMENT === 'sandbox', false, null, '2.0',
        integration.refresh_token
    );

    console.log('Buscando item 009W...');
    qbo.findItems({ Sku: '009W' }, (err, result) => {
        if (err) {
            console.error('Error QB:', err);
            return;
        }
        const item = result?.QueryResponse?.Item?.[0];
        if (item) {
            console.log('-----------------------------------');
            console.log('ITEM ENCONTRADO (009W):');
            console.log(`Nombre: ${item.Name}`);
            console.log(`FQN: ${item.FullyQualifiedName}`);
            console.log(`Costo de Compra (PurchaseCost): $${item.PurchaseCost}`);
            console.log(`Precio de Venta (UnitPrice): $${item.UnitPrice}`);
            console.log(`Descripción: ${item.Description}`);
            console.log('-----------------------------------');
        } else {
            console.log('No se encontró el item 009W con findItems({ Sku: "009W" })');

            // Intento por nombre exacto
            qbo.findItems({ Name: 'Carne Asada' }, (err2, result2) => {
                const item2 = result2?.QueryResponse?.Item?.[0];
                if (item2) console.log('Encontrado por nombre:', item2.Name, 'Cost:', item2.PurchaseCost);
                else console.log('Tampoco por nombre exacto.');
            });
        }
    });

    // También verificamos si hay algún item con el precio exacto que dice el usuario
    qbo.findItems({ PurchaseCost: 66.12 }, (err, result) => {
        const matches = result?.QueryResponse?.Item || [];
        if (matches.length) {
            console.log('\n--- MATCH POR PRECIO $66.12 ---');
            matches.forEach((m: any) => console.log(`- ${m.Name} (SKU: ${m.Sku})`));
        }
    });
}

deepInspectAsada().catch(console.error);
