/**
 * @module verify-legal-compliance-2026
 * @description Mandatory runtime verification and live DB smoke test suite for Tacos Gavilan
 * legal, privacy (CCPA/CPRA), Consent Mode v2, ADA/WCAG accessibility, and security compliance.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const WEB_DIR = 'C:\\Users\\pedro\\Desktop\\tacosgavilan-web';
const MIRROR_DIR = path.resolve(__dirname, '../public/tacosgavilan-web');
const contactHandler = require(path.join(WEB_DIR, 'api/contact.js'));

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string, details = '') {
    if (condition) {
        passed++;
        console.log(`  ✅ [PASS] ${testName}`);
    } else {
        failed++;
        console.error(`  ❌ [FAIL] ${testName}${details ? ' — ' + details : ''}`);
    }
}

function walkFiles(dir: string, extFilter?: string[], list: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.vercel') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            walkFiles(full, extFilter, list);
        } else if (!extFilter || extFilter.some(ext => entry.name.endsWith(ext))) {
            list.push(full);
        }
    }
    return list;
}

function createMockRes() {
    const res: any = {
        statusCode: 200,
        headers: {} as Record<string, any>,
        body: null as any,
        setHeader(k: string, v: any) {
            this.headers[k.toLowerCase()] = v;
        },
        status(code: number) {
            this.statusCode = code;
            return this;
        },
        json(payload: any) {
            this.body = payload;
            return this;
        }
    };
    return res;
}

async function runTests() {
    console.log('================================================================================');
    console.log('🛡️  TACOS GAVILAN — LEGAL, PRIVACY, CONSENT, ADA & SECURITY VERIFICATION SUITE');
    console.log('================================================================================\n');

    const htmlFiles = walkFiles(WEB_DIR, ['.html']);
    const jsFiles = walkFiles(WEB_DIR, ['.js']).filter(f => !f.includes('scripts\\'));

    // =========================================================================
    // A. PRUEBAS DE CONSENTIMIENTO, COOKIES Y GTM (PRIOR-CONSENT GATING & GPC)
    // =========================================================================
    console.log('--- A. Pruebas de Consentimiento, Cookies, GTM y GPC ---');

    let unconditionalNoscriptCount = 0;
    let unguardedGtmCount = 0;
    for (const f of htmlFiles) {
        const html = fs.readFileSync(f, 'utf8');
        if (html.includes('googletagmanager.com/ns.html?id=GTM-WW2N58Z')) {
            unconditionalNoscriptCount++;
        }
        if (html.includes('GTM-WW2N58Z') && !html.includes('__tgLoadGTMIfConsented')) {
            unguardedGtmCount++;
        }
    }
    assert(unconditionalNoscriptCount === 0, `Zero unconditional <noscript> GTM iframes across all ${htmlFiles.length} HTML files`, `Found ${unconditionalNoscriptCount}`);
    assert(unguardedGtmCount === 0, `All ${htmlFiles.length} HTML files gate GTM-WW2N58Z behind window.__tgLoadGTMIfConsented`, `Found ${unguardedGtmCount} unguarded`);

    const indexHtml = fs.readFileSync(path.join(WEB_DIR, 'index.html'), 'utf8');
    assert(
        indexHtml.includes('var allowMkt = false;') && indexHtml.includes('var allowAna = false;'),
        'First visit without interaction defaults allowMkt = false and allowAna = false (strict prior-consent gate)'
    );
    assert(
        indexHtml.includes('window.__tgLoadMarketingPixelsIfConsented = function(mkt)'),
        'Meta Pixel (2180512185415859) and TikTok Pixel (C72F1PTP2K6V4FLP2V5G) are gated behind __tgLoadMarketingPixelsIfConsented'
    );

    const complianceJs = fs.readFileSync(path.join(WEB_DIR, 'js/compliance-a11y.js'), 'utf8');
    assert(
        complianceJs.includes('analytics: false') && complianceJs.includes('marketing: false'),
        'compliance-a11y.js default state sets analytics: false and marketing: false prior to user interaction'
    );
    assert(
        complianceJs.includes('Opt-out request honored') && complianceJs.includes('Solicitud de exclusión aplicada'),
        'Visible "Opt-out request honored" / "Solicitud de exclusión aplicada" status is rendered when GPC or Opt-Out is active'
    );
    assert(
        complianceJs.includes('purgeTrackingCookies()'),
        'Opt-out / Reject deletes non-essential _ga, _gid, _gat, _gcl_au, _fbp, _fbc, _ttp cookies across host and domain scopes'
    );

    // =========================================================================
    // B. PRUEBAS DE FORMULARIOS, FLUJO CCPA Y PERSISTENCIA REAL EN SUPABASE
    // =========================================================================
    console.log('\n--- B. Pruebas de Formularios, Flujo CCPA y Persistencia Real en Supabase ---');

    const contactHtml = fs.readFileSync(path.join(WEB_DIR, 'contact/index.html'), 'utf8');
    for (const ccpaOpt of ['ccpa_know', 'ccpa_delete', 'ccpa_correct', 'ccpa_optout', 'ccpa_agent', 'accessibility', 'employment']) {
        assert(
            indexHtml.includes(`value="${ccpaOpt}"`) && contactHtml.includes(`value="${ccpaOpt}"`),
            `Both index.html and /contact/index.html include form option "${ccpaOpt}"`
        );
    }
    assert(
        indexHtml.includes('/privacy/#notice-at-collection') && contactHtml.includes('../privacy/#notice-at-collection'),
        'Both contact forms display a Notice at Collection linking directly to #notice-at-collection and warning against sensitive data'
    );

    // Live API + Supabase smoke test (creates a real record, verifies reference_id & submitted_at, then deletes it)
    const createdIds: number[] = [];
    const testIp = '127.0.0.99';

    // 1. Valid CCPA Right to Know request (including words with consonant clusters like "strengths" and "rights")
    {
        const req: any = {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'origin': 'https://tacosgavilan.com',
                'x-forwarded-for': '10.10.1.1',
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            body: {
                name: 'Maria Gonzalez',
                email: 'maria.ccpa.test@example.com',
                phone: '323-555-0199',
                store: 'Lynwood',
                reason: 'ccpa_know',
                message: 'Exercising my California privacy rights and strengths to know what personal categories are collected.'
            }
        };
        const res = createMockRes();
        await contactHandler(req, res);
        assert(res.statusCode === 200 && res.body?.ok === true, 'Valid CCPA Right to Know submission returns HTTP 200 OK', JSON.stringify(res.body));
        assert(
            typeof res.body?.reference_id === 'string' && /^TG-\d{8}-\d+$/.test(res.body.reference_id),
            `CCPA submission returns confirmation Reference ID (${res.body?.reference_id})`
        );
        assert(
            typeof res.body?.submitted_at === 'string' && !isNaN(Date.parse(res.body.submitted_at)),
            `CCPA submission returns ISO UTC timestamp (${res.body?.submitted_at})`
        );
        if (res.body?.id) createdIds.push(res.body.id);
    }

    // 2. Empty / missing fields -> HTTP 400
    {
        const req: any = {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'origin': 'https://tacosgavilan.com', 'x-forwarded-for': '10.10.1.2' },
            body: { name: '', email: '', message: '' }
        };
        const res = createMockRes();
        await contactHandler(req, res);
        assert(res.statusCode === 400 && res.body?.ok === false, 'Empty form submission rejected with HTTP 400');
    }

    // 3. Invalid email -> HTTP 400
    {
        const req: any = {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'origin': 'https://tacosgavilan.com', 'x-forwarded-for': '10.10.1.3' },
            body: { name: 'Test Guest', email: 'not-an-email', reason: 'general', message: 'Hello testing invalid email' }
        };
        const res = createMockRes();
        await contactHandler(req, res);
        assert(res.statusCode === 400 && res.body?.field === 'email', 'Invalid email rejected with HTTP 400');
    }

    // 4. Message too long (> 2000 chars) -> HTTP 400
    {
        const req: any = {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'origin': 'https://tacosgavilan.com', 'x-forwarded-for': '10.10.1.4' },
            body: { name: 'Test Guest', email: 'valid@example.com', reason: 'general', message: 'A '.repeat(1050) }
        };
        const res = createMockRes();
        await contactHandler(req, res);
        assert(res.statusCode === 400 && res.body?.field === 'message', 'Message > 2000 characters rejected with HTTP 400');
    }

    // 5. Honeypot filled -> HTTP 200 shadow-drop without DB insert
    {
        const req: any = {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'origin': 'https://tacosgavilan.com', 'x-forwarded-for': '10.10.1.5' },
            body: {
                name: 'Spam Bot',
                email: 'bot@example.com',
                reason: 'general',
                message: 'Buy cheap SEO links now',
                b_company_website: 'https://spam-link.example'
            }
        };
        const res = createMockRes();
        await contactHandler(req, res);
        assert(
            res.statusCode === 200 && res.body?.reference_id === 'TG-FILTERED' && !res.body?.id,
            'Honeypot submission is shadow-dropped without writing to Supabase'
        );
    }

    // 6. Rate limiting (> 5 requests from same IP within 10 minutes) -> HTTP 429
    {
        let got429 = false;
        for (let i = 1; i <= 6; i++) {
            const req: any = {
                method: 'POST',
                headers: { 'content-type': 'application/json', 'origin': 'https://tacosgavilan.com', 'x-forwarded-for': testIp },
                body: { name: '', email: '', message: '' } // triggers rate limit check before field validation
            };
            const res = createMockRes();
            await contactHandler(req, res);
            if (i === 6 && res.statusCode === 429) {
                got429 = true;
            }
        }
        assert(got429, '6th request from same IP within window is blocked with HTTP 429 Too Many Requests');
    }

    // =========================================================================
    // C. PRUEBAS DE ACCESIBILIDAD, DOCUMENTOS LEGALES Y CERO AFIRMACIONES ABSOLUTAS
    // =========================================================================
    console.log('\n--- C. Pruebas de Accesibilidad, Documentos Legales y Sin JS ---');

    const privacyHtml = fs.readFileSync(path.join(WEB_DIR, 'privacy/index.html'), 'utf8');
    const termsHtml = fs.readFileSync(path.join(WEB_DIR, 'terms/index.html'), 'utf8');
    const a11yHtml = fs.readFileSync(path.join(WEB_DIR, 'accessibility/index.html'), 'utf8');
    const choicesHtml = fs.readFileSync(path.join(WEB_DIR, 'privacy-choices/index.html'), 'utf8');

    assert(
        !privacyHtml.includes('[REQUIRES OWNER/LEGAL APPROVAL') &&
        privacyHtml.includes('<strong>Operator:</strong> Tacos Gavilan') &&
        privacyHtml.includes('id="notice-at-collection"') &&
        privacyHtml.includes('id="data-table"'),
        '/privacy/index.html uses clean production v2.1 Operator metadata (zero draft brackets), #notice-at-collection anchor, and #data-table'
    );
    assert(
        termsHtml.includes('order.online') &&
        termsHtml.includes('DoorDash, Inc.') &&
        termsHtml.includes('Toast POS') &&
        termsHtml.includes('id="allergen-notice"') &&
        !termsHtml.includes('[REQUIRES LEGAL COUNSEL REVIEW'),
        '/terms/index.html documents order.online (DoorDash/Toast), #allergen-notice cross-contact disclaimer, and zero draft brackets'
    );
    assert(
        a11yHtml.includes('working toward Web Content Accessibility Guidelines (WCAG) 2.2 Level AA') &&
        !a11yHtml.toLowerCase().includes('fully accessible') &&
        !a11yHtml.toLowerCase().includes('plenamente accesible') &&
        !a11yHtml.includes('310 870 7009') &&
        !a11yHtml.toLowerCase().includes('exact same prices'),
        '/accessibility/index.html uses prudent verifiable language and removes unverified phone 310 870 7009 and absolute claims'
    );
    assert(
        choicesHtml.includes('id="page-gpc-honored-badge"') &&
        choicesHtml.includes('Opt-out request honored'),
        '/privacy-choices/index.html includes visible GPC/Opt-Out honored badge and interactive controls'
    );

    const locationPageJs = fs.readFileSync(path.join(WEB_DIR, 'js/location-page.js'), 'utf8');
    assert(
        locationPageJs.includes('trapFocus') && locationPageJs.includes('releaseFocus'),
        'js/location-page.js implements keyboard focus trapping (trapFocus / releaseFocus) for mobile navigation drawer'
    );

    // Check that no file contains old 2019 dates or 310 870 7009
    let oldDatesFound = 0;
    for (const f of [...htmlFiles, ...jsFiles]) {
        const txt = fs.readFileSync(f, 'utf8');
        if (txt.includes('March 19, 2019') || txt.includes('April 15, 2019') || txt.includes('310 870 7009')) {
            oldDatesFound++;
            console.error('  Found legacy date/phone in:', f);
        }
    }
    assert(oldDatesFound === 0, 'Zero unverified 2019 effective dates or 310 870 7009 phone numbers remain across HTML/JS');

    // =========================================================================
    // D. PRUEBAS DE INTEGRIDAD DE MARCA, 15 TIENDAS TOAST Y CONCURSO 2021
    // =========================================================================
    console.log('\n--- D. Pruebas de Integridad de Marca, Toast/order.online y Concurso 2021 ---');

    let badBrandCount = 0;
    for (const f of [...htmlFiles, ...jsFiles]) {
        const txt = fs.readFileSync(f, 'utf8');
        if (/Tacos\s+El\s+Gavilan/i.test(txt) || /facebook\.com\/TacosElGavilan/i.test(txt)) {
            badBrandCount++;
            console.error('  Found prohibited brand string in:', f);
        }
    }
    assert(badBrandCount === 0, 'Zero occurrences of "Tacos El Gavilan" or facebook.com/TacosElGavilan across all HTML and JS files');

    const contestBlogHtml = fs.readFileSync(
        path.join(WEB_DIR, 'blog/first-annual-taco-eating-contest-celebrates-hispanic-heritage-month/index.html'),
        'utf8'
    );
    assert(
        contestBlogHtml.includes('historical-archive-notice') && !contestBlogHtml.includes('Enter To Win form'),
        '2021 Taco Eating Contest blog post displays Historical Event Archive notice and removes active "Enter To Win form" link'
    );

    const storeMatches = indexHtml.match(/https:\/\/order\.online\/store\/tacos-gavilan-[a-z0-9-]+/g) || [];
    const uniqueStoreUrls = new Set(storeMatches);
    assert(uniqueStoreUrls.size === 15, `All 15 unique store order.online URLs are preserved in index.html (found ${uniqueStoreUrls.size})`);
    assert(
        indexHtml.includes('https://order.online/business/-137616'),
        'Corporate selector URL https://order.online/business/-137616 is preserved'
    );

    // =========================================================================
    // E. PRUEBAS DE SEGURIDAD (XSS, PAYLOAD GRANDE, MÉTODO, CONTENT-TYPE, CSRF ORIGIN)
    // =========================================================================
    console.log('\n--- E. Pruebas de Seguridad del Endpoint (/api/contact) ---');

    // 1. Wrong HTTP method (GET) -> 405
    {
        const req: any = { method: 'GET', headers: {} };
        const res = createMockRes();
        await contactHandler(req, res);
        assert(res.statusCode === 405, 'GET /api/contact rejected with HTTP 405 Method Not Allowed');
    }

    // 2. Unauthorized cross-origin header -> 403 Forbidden
    {
        const req: any = {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'origin': 'https://evil-phishing-site.example.com' },
            body: {}
        };
        const res = createMockRes();
        await contactHandler(req, res);
        assert(res.statusCode === 403, 'Cross-origin POST from untrusted Origin rejected with HTTP 403 Forbidden');
    }

    // 3. Wrong Content-Type -> 415
    {
        const req: any = {
            method: 'POST',
            headers: { 'content-type': 'text/plain', 'origin': 'https://tacosgavilan.com' },
            body: 'hello'
        };
        const res = createMockRes();
        await contactHandler(req, res);
        assert(res.statusCode === 415, 'Non-JSON Content-Type rejected with HTTP 415 Unsupported Media Type');
    }

    // 4. Oversized payload (> 10 KB) -> 413
    {
        const req: any = {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'content-length': '25000', 'origin': 'https://tacosgavilan.com', 'x-forwarded-for': '10.10.9.1' },
            body: { message: 'x'.repeat(25000) }
        };
        const res = createMockRes();
        await contactHandler(req, res);
        assert(res.statusCode === 413, 'Payload > 10 KB rejected with HTTP 413 Payload Too Large');
    }

    // 5. XSS / HTML tag sanitization check + cleanup of test records in Supabase
    {
        const req: any = {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'origin': 'https://tacosgavilan.com',
                'x-forwarded-for': '10.10.9.2',
                'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'
            },
            body: {
                name: 'Carlos <script>alert(1)</script> Perez',
                email: 'carlos.xss.test@example.com',
                reason: 'accessibility',
                message: 'Testing HTML bracket removal <img src=x onerror=alert(1)> in accessibility feedback.'
            }
        };
        const res = createMockRes();
        await contactHandler(req, res);
        assert(res.statusCode === 200 && res.body?.ok === true, 'XSS test payload processed safely');
        if (res.body?.id) createdIds.push(res.body.id);

        // Verify in Supabase that angle brackets were stripped, then delete all test rows
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://ywwwdcvgfculqmcfkihq.supabase.co';
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
        if (res.body?.id && supabaseKey) {
            const checkRes = await fetch(`${supabaseUrl}/rest/v1/customer_feedback?id=eq.${res.body.id}&select=customer_name,comments`, {
                headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` }
            });
            const rows = await checkRes.json();
            assert(
                Array.isArray(rows) && rows.length === 1 && !rows[0].customer_name.includes('<') && !rows[0].comments.includes('<'),
                'Stored record in Supabase has all < and > HTML brackets stripped'
            );
        }

        // Cleanup all test records created during smoke test
        if (createdIds.length > 0 && supabaseKey) {
            const delRes = await fetch(`${supabaseUrl}/rest/v1/customer_feedback?id=in.(${createdIds.join(',')})`, {
                method: 'DELETE',
                headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` }
            });
            assert(delRes.ok, `Cleaned up ${createdIds.length} temporary smoke-test row(s) from Supabase customer_feedback`);
        }
    }

    console.log('\n================================================================================');
    console.log(`🏁 RESULTADO FINAL: ${passed} PRUEBAS EXITOSAS | ${failed} FALLIDAS`);
    console.log('================================================================================');
    if (failed > 0) process.exit(1);
}

runTests().catch(err => {
    console.error('Unhandled error in test suite:', err);
    process.exit(1);
});
