
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

async function compareSystems() {
    console.log('--- COMPARATIVO: SISTEMA INTERNO VS QUICKBOOKS ---');

    // 1. Obtener mapeos
    const { data: mappings, error } = await supabase
        .from('quickbooks_mappings')
        .select(`
            last_fetch_cost,
            qb_item_id,
            qb_item_name,
            inv:inventory_item_id (
                name,
                sku
            )
        `);

    if (error) {
        console.error('Error:', error.message);
        return;
    }

    // 2. Obtener integración
    const { data: integration } = await supabase.from('integrations').select('*').single();
    if (!integration) return;

    // 3. Crear cliente OAuth para refrescar token si es necesario
    const oauthClient = new OAuthClient({
        clientId: process.env.QUICKBOOKS_CLIENT_ID!,
        clientSecret: process.env.QUICKBOOKS_CLIENT_SECRET!,
        environment: process.env.QUICKBOOKS_ENVIRONMENT as 'sandbox' | 'production',
        redirectUri: process.env.QUICKBOOKS_REDIRECT_URI!,
    });

    oauthClient.setToken(integration);

    let accessToken = integration.access_token;

    // Intentar refrescar si es posible/necesario
    try {
        console.log('Validando sesión de QuickBooks...');
        const authResponse = await oauthClient.refresh();
        const newToken = authResponse.getJson();
        accessToken = newToken.access_token;

        // Guardar nuevo token
        await supabase.from('integrations').update({
            access_token: newToken.access_token,
            refresh_token: newToken.refresh_token,
            expires_in: newToken.expires_in,
            x_refresh_token_expires_in: newToken.x_refresh_token_expires_in,
            updated_at: new Date()
        }).eq('id', integration.id);

        console.log('✅ Token refrescado.');
    } catch (e) {
        console.log('El token aún es válido o no se pudo refrescar (usando el actual).');
    }

    const qbo = new QuickBooks(
        process.env.QUICKBOOKS_CLIENT_ID, process.env.QUICKBOOKS_CLIENT_SECRET,
        accessToken, false, integration.realm_id,
        process.env.QUICKBOOKS_ENVIRONMENT === 'sandbox', false, null, '2.0',
        integration.refresh_token
    );

    const qbItems = await new Promise<any[]>((res) => {
        qbo.findItems({ active: true }, (err, result) => {
            res(result?.QueryResponse?.Item || []);
        });
    });

    console.log('\n| Insumo (SISTEMA) | SKU (SISTEMA) | Producto (QUICKBOOKS) | SKU (QB) | Costo QB |');
    console.log('| :--- | :--- | :--- | :--- | :--- |');

    mappings.forEach(m => {
        // @ts-ignore
        const inv = m.inv;
        const qbMatch = qbItems.find(q => q.Id === m.qb_item_id);

        const systemName = (inv?.name || 'N/A').substring(0, 30);
        const systemSku = inv?.sku || '-';
        const qbName = (m.qb_item_name || 'N/A').substring(0, 30);
        const qbSku = qbMatch?.Sku || '-';
        const cost = m.last_fetch_cost;

        console.log(`| ${systemName} | ${systemSku} | ${qbName} | ${qbSku} | $${cost} |`);
    });
}

compareSystems().catch(console.error);
