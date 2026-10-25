import { NextRequest, NextResponse } from 'next/server';
import { getAuthClient } from '@/lib/quickbooks';
import OAuthClient from 'intuit-oauth';

export async function GET(req: NextRequest) {
    try {
        const url = new URL(req.url);
        const mode = url.searchParams.get('mode') || '';
        const targetRealmId = url.searchParams.get('realmId') || '';
        const stateStr = mode === 'external' ? `external:${targetRealmId}` : 'init';

        const client = getAuthClient();
        const authUri = client.authorizeUri({
            scope: [OAuthClient.scopes.Accounting, OAuthClient.scopes.OpenId],
            state: stateStr,
        });

        console.log('Redirecting to QuickBooks Auth URI:', authUri);
        return NextResponse.redirect(authUri);
    } catch (error: any) {
        console.error('Error initiating QuickBooks auth:', error);
        return NextResponse.json({ error: 'Failed to initiate authentication', details: error.message }, { status: 500 });
    }
}
