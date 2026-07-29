import OAuthClient from 'intuit-oauth';
import QuickBooks from 'node-quickbooks';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

// Initialize Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

export function getSanitizedRedirectUri(): string {
    const raw = process.env.QUICKBOOKS_REDIRECT_URI || '';
    return raw.trim().replace(/\/+$/, '');
}

export function getAuthClient(): OAuthClient {
    return new OAuthClient({
        clientId: process.env.QUICKBOOKS_CLIENT_ID!,
        clientSecret: process.env.QUICKBOOKS_CLIENT_SECRET!,
        environment: process.env.QUICKBOOKS_ENVIRONMENT || 'sandbox',
        redirectUri: getSanitizedRedirectUri(),
    });
}

export const authClient = getAuthClient();

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

export async function getQuickBooksClient(companyId?: string) {
    // 1. Fetch tokens — sandbox tries local file first, falls back to Supabase (production)
    let integration: any;
    let usingSandboxTokens = false;

    if (process.env.QUICKBOOKS_ENVIRONMENT === 'sandbox') {
        integration = getLocalSandboxIntegration();
        if (integration) {
            usingSandboxTokens = true;
            console.log('[QB] Using local sandbox tokens');
        } else {
            // Fallback: use production tokens from Supabase so local dev can still work
            console.log('[QB] No sandbox tokens found, falling back to Supabase production tokens');
        }
    }

    // Production mode, or sandbox fallback: read from Supabase
    if (!integration) {
        const query = supabase.from('integrations').select('*').eq('service_name', 'quickbooks');
        if (companyId) query.eq('realm_id', companyId);
        const { data, error } = await query.single();

        if (error || !data) {
            throw new Error('No QuickBooks integration found. Please authorize at /api/integrations/quickbooks/auth');
        }
        integration = data;
    }

    // 2. Refresh token if needed
    if (new Date(integration.expires_at) <= new Date()) {
        try {
            console.log('[QB] Token expired, refreshing...');
            const authResponse = await authClient.refreshUsingToken(integration.refresh_token);
            const tokens = authResponse.getJson();

            if (usingSandboxTokens) {
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
                integration.refresh_token = tokens.refresh_token;
            }
            console.log('[QB] ✅ Token refreshed');
        } catch (e) {
            console.error('[QB] Error refreshing token:', e);
            throw new Error('Failed to refresh QuickBooks token. Please re-authenticate at /api/integrations/quickbooks/auth');
        }
    }

    // 3. Return QuickBooks client instance
    // useSandbox=true only if we're actually using sandbox tokens against the sandbox API
    const useSandbox = usingSandboxTokens;
    return new QuickBooks(
        process.env.QUICKBOOKS_CLIENT_ID,
        process.env.QUICKBOOKS_CLIENT_SECRET,
        integration.access_token,
        false, // no token secret for OAuth2
        companyId || integration.realm_id,
        useSandbox ? true : false, // sandbox mode only when using actual sandbox tokens
        false, // debug
        null, // minorversion
        '2.0', // oauth version
        integration.refresh_token
    );
}

