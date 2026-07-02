import OAuthClient from 'intuit-oauth';
import QuickBooks from 'node-quickbooks';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

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

const SANDBOX_TOKEN_FILE = path.join(process.cwd(), '.sandbox_tokens.json');

export function getLocalSandboxIntegration() {
    if (!fs.existsSync(SANDBOX_TOKEN_FILE)) {
        return null;
    }
    try {
        const data = fs.readFileSync(SANDBOX_TOKEN_FILE, 'utf8');
        return JSON.parse(data);
    } catch (e) {
        return null;
    }
}

export function saveLocalSandboxIntegration(tokens: any, realmId: string) {
    const data = {
        service_name: 'quickbooks',
        realm_id: realmId,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        token_type: tokens.token_type || 'Bearer',
        expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
        updated_at: new Date().toISOString()
    };
    fs.writeFileSync(SANDBOX_TOKEN_FILE, JSON.stringify(data, null, 2), 'utf8');
    return data;
}

export async function getQuickBooksClient(companyId: string) {
    // 1. Fetch tokens
    let integration: any;

    if (process.env.QUICKBOOKS_ENVIRONMENT === 'sandbox') {
        integration = getLocalSandboxIntegration();
        if (!integration) {
            throw new Error('No local sandbox token found. Please visit /api/integrations/quickbooks/connect to authorize.');
        }
    } else {
        const { data, error } = await supabase
            .from('integrations')
            .select('*')
            .eq('service_name', 'quickbooks')
            .eq('realm_id', companyId)
            .single();

        if (error || !data) {
            throw new Error('No QuickBooks integration found for this company.');
        }
        integration = data;
    }

    // 2. Refresh token if needed
    if (new Date(integration.expires_at) <= new Date()) {
        try {
            const authResponse = await authClient.refreshUsingToken(integration.refresh_token);
            const tokens = authResponse.getJson();

            if (process.env.QUICKBOOKS_ENVIRONMENT === 'sandbox') {
                integration = saveLocalSandboxIntegration(tokens, integration.realm_id);
            } else {
                await supabase
                    .from('integrations')
                    .update({
                        access_token: tokens.access_token,
                        refresh_token: tokens.refresh_token,
                        expires_at: new Date(Date.now() + tokens.expires_in * 1000),
                        updated_at: new Date(),
                    })
                    .eq('id', integration.id);

                integration.access_token = tokens.access_token;
            }
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
