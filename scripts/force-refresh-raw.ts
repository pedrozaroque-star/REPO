
import * as dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import axios from 'axios';

dotenv.config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function forceRefresh() {
    const { data: integration } = await supabase.from('integrations').select('*').eq('service_name', 'quickbooks').single();
    if (!integration) return;

    console.log('--- REFRESH FORZADO (RAW HTTP) ---');

    const auth = Buffer.from(`${process.env.QUICKBOOKS_CLIENT_ID}:${process.env.QUICKBOOKS_CLIENT_SECRET}`).toString('base64');

    try {
        const response = await axios.post('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
            `grant_type=refresh_token&refresh_token=${integration.refresh_token}`,
            {
                headers: {
                    'Authorization': `Basic ${auth}`,
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Accept': 'application/json'
                }
            }
        );

        console.log('✅ REFRESH EXITOSO (RAW)!');
        const tokens = response.data;

        await supabase.from('integrations').update({
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            updated_at: new Date()
        }).eq('id', integration.id);

        console.log('Base de datos actualizada.');
    } catch (error: any) {
        console.error('❌ ERROR EN REFRESH RAW:');
        console.error(error.response?.data || error.message);

        if (error.response?.data?.error === 'invalid_grant') {
            console.log('\nEXPLICACIÓN: El Refresh Token ya no es válido para Intuit. Esto sucede si se usó una vez y no se guardó el nuevo, o si pasaron más de 24h sin usarse en algunos casos de producción.');
        }
    }
}

forceRefresh();
