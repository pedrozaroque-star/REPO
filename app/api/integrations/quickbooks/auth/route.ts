import { NextResponse } from 'next/server';
import { authClient } from '@/lib/quickbooks';
import OAuthClient from 'intuit-oauth';

export async function GET() {
    try {
        const authUri = authClient.authorizeUri({
            scope: [OAuthClient.scopes.Accounting, OAuthClient.scopes.OpenId],
            state: 'init',
        });

        console.log('Redirecting to QuickBooks Auth URI:', authUri);
        return NextResponse.redirect(authUri);
    } catch (error: any) {
        console.error('Error initiating QuickBooks auth:', error);
        return NextResponse.json({ error: 'Failed to initiate authentication', details: error.message }, { status: 500 });
    }
}
