
import OAuthClient from 'intuit-oauth';
import QuickBooks from 'node-quickbooks';
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

export const authClient = new OAuthClient({
    clientId: process.env.QUICKBOOKS_CLIENT_ID!,
    clientSecret: process.env.QUICKBOOKS_CLIENT_SECRET!,
    environment: process.env.QUICKBOOKS_ENVIRONMENT || 'sandbox', // 'sandbox' or 'production'
    redirectUri: process.env.QUICKBOOKS_REDIRECT_URI!,
});

export async function getQuickBooksClient(companyId: string) {
    // 1. Fetch tokens from database
    const { data: integration, error } = await supabase
        .from('integrations')
        .select('*')
        .eq('service_name', 'quickbooks')
        .eq('realm_id', companyId)
        .single();

    if (error || !integration) {
        throw new Error('No QuickBooks integration found for this company.');
    }

    // 2. Refresh token if needed
    if (new Date(integration.expires_at) <= new Date()) {
        try {
            const authResponse = await authClient.refreshUsingToken(integration.refresh_token);

            // Update database with new tokens
            await supabase
                .from('integrations')
                .update({
                    access_token: authResponse.getJson().access_token,
                    refresh_token: authResponse.getJson().refresh_token,
                    expires_at: new Date(Date.now() + authResponse.getJson().expires_in * 1000),
                    updated_at: new Date(),
                })
                .eq('id', integration.id);

            integration.access_token = authResponse.getJson().access_token;
        } catch (e) {
            console.error('Error refreshing QuickBooks token:', e);
            throw new Error('Failed to refresh QuickBooks token. Please re-authenticate.');
        }
    }

    // 3. Return QuickBooks client instance
    return new QuickBooks(
        process.env.QUICKBOOKS_CLIENT_ID,
        process.env.QUICKBOOKS_CLIENT_SECRET,
        integration.access_token,
        false, // no token secret for OAuth2
        companyId,
        process.env.QUICKBOOKS_ENVIRONMENT === 'production' ? false : true, // sandbox mode
        true, // debugging
        null, // minorversion
        '2.0', // oauth version
        integration.refresh_token
    );
}
