
import { NextRequest, NextResponse } from 'next/server';
import { authClient } from '@/lib/quickbooks';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(req: NextRequest) {
    const url = new URL(req.url);
    const parseRedirect = url.href;

    try {
        // 1. Exchange auth code for tokens
        const authResponse = await authClient.createToken(parseRedirect);
        const tokens = authResponse.getJson();

        const realmId = url.searchParams.get('realmId');

        if (!realmId) {
            return NextResponse.json({ error: 'Missing Realm ID (Company ID)' }, { status: 400 });
        }

        // 2. Store tokens in Supabase
        const { error } = await supabase
            .from('integrations')
            .upsert({
                service_name: 'quickbooks',
                realm_id: realmId,
                access_token: tokens.access_token,
                refresh_token: tokens.refresh_token,
                token_type: tokens.token_type,
                expires_at: new Date(Date.now() + tokens.expires_in * 1000),
                updated_at: new Date(),
            }, { onConflict: 'service_name' });

        if (error) {
            console.error('Database error:', error);
            return NextResponse.json({ error: 'Failed to save tokens' }, { status: 500 });
        }

        return NextResponse.json({ message: 'QuickBooks Connected Successfully! You can close this window.' });

    } catch (error) {
        console.error('OAuth Error:', error);
        return NextResponse.json({ error: 'Authentication Failed' }, { status: 500 });
    }
}
