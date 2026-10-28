import { NextRequest, NextResponse } from 'next/server';
import { getAuthClient } from '@/lib/quickbooks';
import OAuthClient from 'intuit-oauth';
import { createClient } from '@supabase/supabase-js';

const FIRM_REALM_ID = '123145825185692';

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
    process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder'
);

export async function GET(req: NextRequest) {
    try {
        const url = new URL(req.url);
        const mode = url.searchParams.get('mode') || '';
        let targetRealmId = url.searchParams.get('realmId') || '';

        // Si mode === 'external_all' y no se especificó realmId, buscar la primera empresa de Raquel aún no conectada
        if (mode === 'external_all' && !targetRealmId) {
            const { data: allComps } = await supabase
                .from('external_accounting_companies')
                .select('realm_id, metadata')
                .order('company_name', { ascending: true });

            const firstUnconnected = (allComps || []).find(
                (c: any) => !c.metadata?.qbo_oauth?.refresh_token
            );
            targetRealmId = firstUnconnected?.realm_id || allComps?.[0]?.realm_id || '';
        }

        const stateStr =
            mode === 'external_all'
                ? `external_all:${targetRealmId}`
                : mode === 'external'
                ? `external:${targetRealmId}`
                : 'init';

        const client = getAuthClient();
        let authUri = client.authorizeUri({
            scope: [OAuthClient.scopes.Accounting, OAuthClient.scopes.OpenId],
            state: stateStr,
        });

        // Saltar el selector manual de empresa de Intuit (`companyselection`) inyectando realm_id y firm_id directo a /authorize
        if ((mode === 'external' || mode === 'external_all') && targetRealmId) {
            authUri =
                authUri.replace(
                    'https://appcenter.intuit.com/connect/oauth2?',
                    'https://appcenter.intuit.com/app/connect/oauth2/authorize?'
                ) + `&locale=en-us&realm_id=${encodeURIComponent(targetRealmId)}&firm_id=${FIRM_REALM_ID}`;
        }

        console.log('Redirecting to QuickBooks Auth URI:', authUri);
        return NextResponse.redirect(authUri);
    } catch (error: any) {
        console.error('Error initiating QuickBooks auth:', error);
        return NextResponse.json({ error: 'Failed to initiate authentication', details: error.message }, { status: 500 });
    }
}
