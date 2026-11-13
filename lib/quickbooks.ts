/**
 * @module lib/quickbooks
 * @description Cliente OAuth 2.0 e integración oficial con Intuit QuickBooks Online para Tacos Gavilan
 * y utilidades criptográficas HMAC-SHA256 para proteger el flujo OAuth (`state` + cookie `qb_oauth_nonce`).
 *
 * @businessRules
 * - En producción almacena credenciales de Tacos Gavilan en `public.integrations` (`service_name = 'quickbooks'`).
 * - Las empresas de Contabilidad Externa utilizan filas aisladas (`quickbooks_ext_<realmId>`) y `external_accounting_companies.metadata.qbo_oauth`.
 * - Todo flujo OAuth (`/auth` -> `/callback`) firma criptográficamente `state` con HMAC-SHA256 y valida nonce HttpOnly (`15 min` TTL).
 *
 * @dataFlow
 * - `signQuickBooksOAuthState` -> Intuit `/authorize` -> `/api/integrations/quickbooks/callback` -> `verifyQuickBooksOAuthState`.
 *
 * @notes
 * - 2026-11-12 (Wave P0 Security): Agregada firma HMAC-SHA256 (`timingSafeEqual`) y sanitización HTML/JS para impedir CSRF/token-overwrite.
 */

import crypto from 'crypto';
import OAuthClient from 'intuit-oauth';
import QuickBooks from 'node-quickbooks';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

export const QB_OAUTH_NONCE_COOKIE = 'qb_oauth_nonce';

export interface SignedQbOAuthState {
    m: 'init' | 'external' | 'external_all' | 'diagnose';
    r: string;
    n: string;
    u: string;
    exp: number;
}

function getOAuthStateSecret(): string {
    const secret =
        process.env.SUPABASE_JWT_SECRET ||
        process.env.JWT_SECRET ||
        process.env.QUICKBOOKS_CLIENT_SECRET ||
        '';
    if (!secret.trim()) {
        throw new Error('Missing server secret for QuickBooks OAuth state signing');
    }
    return secret.trim().replace(/^"(.*)"$/, '$1');
}

export function signQuickBooksOAuthState(params: {
    mode: 'init' | 'external' | 'external_all' | 'diagnose';
    targetRealmId?: string;
    userId: string;
    nonce?: string;
    ttlMs?: number;
}): { state: string; nonce: string } {
    const nonce = params.nonce || crypto.randomBytes(16).toString('hex');
    const payloadObj: SignedQbOAuthState = {
        m: params.mode,
        r: String(params.targetRealmId || '').trim(),
        n: nonce,
        u: String(params.userId || '').trim(),
        exp: Date.now() + (params.ttlMs ?? 15 * 60 * 1000),
    };
    const payloadB64 = Buffer.from(JSON.stringify(payloadObj), 'utf8').toString('base64url');
    const sigB64 = crypto
        .createHmac('sha256', getOAuthStateSecret())
        .update(payloadB64)
        .digest('base64url');
    return {
        state: `${payloadB64}.${sigB64}`,
        nonce,
    };
}

export function verifyQuickBooksOAuthState(
    rawState: string | null | undefined,
    expectedCookieNonce: string | null | undefined
): SignedQbOAuthState | null {
    try {
        if (!rawState || !expectedCookieNonce) return null;
        const parts = rawState.split('.');
        if (parts.length !== 2) return null;
        const [payloadB64, sigB64] = parts;
        if (!payloadB64 || !sigB64) return null;

        const expectedSig = crypto
            .createHmac('sha256', getOAuthStateSecret())
            .update(payloadB64)
            .digest('base64url');

        const a = Buffer.from(sigB64, 'utf8');
        const b = Buffer.from(expectedSig, 'utf8');
        if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
            return null;
        }

        const parsed = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as SignedQbOAuthState;
        if (!parsed || typeof parsed !== 'object') return null;
        if (!parsed.exp || Date.now() > Number(parsed.exp)) return null;

        const nonceA = Buffer.from(String(parsed.n || ''), 'utf8');
        const nonceB = Buffer.from(String(expectedCookieNonce || ''), 'utf8');
        if (nonceA.length === 0 || nonceA.length !== nonceB.length || !crypto.timingSafeEqual(nonceA, nonceB)) {
            return null;
        }
        return parsed;
    } catch {
        return null;
    }
}

export function escapeQbHtml(input: unknown): string {
    return String(input ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function safeInlineJson(input: unknown): string {
    return JSON.stringify(input).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

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

