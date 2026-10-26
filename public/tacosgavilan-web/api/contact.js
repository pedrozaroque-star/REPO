/**
 * @module api/contact
 * @description Production Vercel Serverless Function for official Tacos Gavilan customer contact form submissions.
 * Implements strict fail-closed security, content-type and body-size guards, best-effort per-instance rate limiting,
 * honeypot bot trap, ASCII control character sanitization, whitelisted parameters, and confirmed Supabase persistence.
 *
 * @businessRules
 *   1. Toast POS is exclusive for food orders; this endpoint handles brand, catering, careers, and accessibility inquiries.
 *   2. Fail-Closed Guarantee: Never return HTTP 200 without verified database persistence in Supabase.
 *   3. If Supabase configuration or network fails, return 503 CONTACT_SERVICE_UNAVAILABLE with email fallback support@tacosgavilan.com.
 *   4. Strictly whitelist topics and store names to prevent injection or corruption of customer_feedback records.
 *   5. Each warm serverless instance limits an IP to 5 submissions per 10-minute window; this is defense in depth,
 *      not a distributed global rate limit.
 *
 * @dataFlow
 *   - index.html (#contact-form) -> POST /api/contact -> Supabase public.customer_feedback (store_id, customer_name, comments, complaint_type).
 *
 * @notes
 *   - Verified against live Supabase schema for public.customer_feedback (references stores.id).
 *   - Default fallback store_id: 14 (Lynwood) when no specific store is chosen.
 *   - Expired in-memory rate-limit entries are periodically purged to bound memory use in warm instances.
 *   - Includes B2B Cold-Outreach / Commercial Solicitation Filter (isB2BSolicitationSpam) to shadow-drop
 *     unsolicited agency pitches (website redesigns, AI tools, SEO/backlinks, lead gen, merchant cash advances).
 */

const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const MAX_REQUESTS_PER_WINDOW = 5;
const MAX_PAYLOAD_BYTES = 10240; // 10 KB

// In-memory rate limiting store (per serverless instance)
const rateLimitMap = new Map();
let rateLimitChecks = 0;

function isRateLimited(ip) {
    if (!ip) return false;
    const now = Date.now();
    rateLimitChecks++;
    if (rateLimitChecks % 100 === 0) {
        for (const [storedIp, storedRecord] of rateLimitMap.entries()) {
            if (now > storedRecord.resetAt) rateLimitMap.delete(storedIp);
        }
    }
    const record = rateLimitMap.get(ip);

    if (!record) {
        rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
        return false;
    }

    if (now > record.resetAt) {
        rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
        return false;
    }

    record.count++;
    if (record.count > MAX_REQUESTS_PER_WINDOW) {
        return true;
    }
    return false;
}

function sanitizeText(str) {
    if (!str || typeof str !== 'string') return '';
    // Strip ASCII control characters and harmful HTML brackets
    return str
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
        .replace(/[<>]/g, '')
        .trim();
}

function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

/**
 * Detects automated form-spam bots and vulnerability scanners (e.g., random gibberish strings
 * like "ovqjDtWDLvqzWsbkECjAxUny", consonant clusters like "Bzuchqo Gtgtno", Gmail dot-stuffing
 * like "u.ze.ziz.ez7.67@gmail.com", or malformed/scanner User-Agents).
 */
function isAutomatedBotSubmission({ name, email, message, userAgent }) {
    const ua = String(userAgent || '').trim();
    // 1. Literal quotes around User-Agent or known automated scanner tools
    if (
        ua.startsWith('"') ||
        ua.endsWith('"') ||
        /(sqlmap|nikto|nmap|masscan|zgrab|python-requests|go-http-client|scrapy|libwww-perl)/i.test(ua)
    ) {
        return true;
    }

    // 2. Gmail dot-stuffing bot pattern (3+ dots in local part of gmail/googlemail)
    const emailLower = String(email || '').toLowerCase().trim();
    const [localPart, domainPart] = emailLower.split('@');
    if (localPart && (domainPart === 'gmail.com' || domainPart === 'googlemail.com')) {
        const dotCount = (localPart.match(/\./g) || []).length;
        if (dotCount >= 3) return true;
    }

    // 3. Random case-switching gibberish token (e.g., "ovqjDtWDLvqzWsbkECjAxUny")
    const checkRandomToken = (text) => {
        const words = String(text || '').trim().split(/\s+/);
        for (const w of words) {
            if (w.length >= 14 && !/^https?:\/\//i.test(w)) {
                let caseTransitions = 0;
                for (let i = 1; i < w.length; i++) {
                    const prevIsUpper = w[i - 1] >= 'A' && w[i - 1] <= 'Z';
                    const currIsUpper = w[i] >= 'A' && w[i] <= 'Z';
                    const prevIsAlpha = /[a-zA-Z]/.test(w[i - 1]);
                    const currIsAlpha = /[a-zA-Z]/.test(w[i]);
                    if (prevIsAlpha && currIsAlpha && prevIsUpper !== currIsUpper) {
                        caseTransitions++;
                    }
                }
                if (caseTransitions >= 4) return true;
            }
            // 7+ consecutive consonants (avoids false positives on English words like "strengths")
            if (/^[a-zA-Z]+$/.test(w) && /[bcdfghjklmnpqrstvwxz]{7,}/i.test(w)) {
                return true;
            }
        }
        return false;
    };

    if (checkRandomToken(name) || checkRandomToken(message)) {
        return true;
    }

    // 4. Message of 16+ characters with zero spaces (single unbroken random string)
    const trimmedMsg = String(message || '').trim();
    if (trimmedMsg.length >= 16 && !/\s/.test(trimmedMsg)) {
        return true;
    }

    return false;
}

/**
 * Detects unsolicited B2B cold outreach and commercial solicitation spam
 * (e.g., web design agencies claiming "I rebuilt your homepage", AI tool pitches,
 * SEO/backlink sellers, lead-generation agencies, virtual assistants, or merchant cash advances)
 * while preserving 100% of real restaurant guest feedback, catering inquiries, job applicants, and CCPA/ADA requests.
 */
function isB2BSolicitationSpam({ email, message }) {
    const emailLower = String(email || '').toLowerCase().trim();
    const domainPart = emailLower.split('@')[1] || '';

    // 1. Known cold-outreach burner domains
    const BLOCKED_OUTREACH_DOMAINS = new Set([
        'signalsetbase.com'
    ]);
    if (BLOCKED_OUTREACH_DOMAINS.has(domainPart)) {
        return true;
    }

    const msgNorm = String(message || '')
        .toLowerCase()
        .replace(/[\u2018\u2019`]/g, "'")
        .replace(/[\u2013\u2014]/g, '-')
        .replace(/\s+/g, ' ')
        .trim();

    if (!msgNorm) return false;

    // 2. High-confidence B2B cold solicitation phrases (single match is definitive commercial spam)
    const HIGH_CONFIDENCE_SOLICITATION_PATTERNS = [
        /\b(rebuilt|redesigned|revamped|remade)\s+your\s+(homepage|website|site|landing\s+page|web\s+page)\b/i,
        /\b(live,?\s+working\s+version|not\s+a\s+mockup)\b/i,
        /\bfocused\s+on\s+clarity,\s+trust,\s+and\s+decision\s+flow\b/i,
        /\btop\s+ai\s+tools\s+on\s+the\s+market\b/i,
        /\b(seo\s+services|search\s+engine\s+optimization|high[- ]authority\s+backlinks|guest\s+post\s+opportunities|domain\s+authority)\b/i,
        /\b(rank\s+higher\s+on\s+google|first\s+page\s+of\s+google|google\s+page\s+1\s+ranking)\b/i,
        /\b(lead\s+generation\s+agency|b2b\s+lead\s+generation|qualified\s+leads\s+for\s+your\s+business)\b/i,
        /\b(ai\s+voice\s+agent|ai\s+receptionist|ai\s+phone\s+answering)\b/i,
        /\b(merchant\s+cash\s+advance|business\s+working\s+capital|unsecured\s+business\s+funding|lower\s+your\s+credit\s+card\s+processing\s+fees)\b/i,
        /\b(offshore\s+developers|dedicated\s+virtual\s+assistant|hire\s+virtual\s+assistants)\b/i,
        /\b(rediseñamos\s+tu\s+sitio\s+web|posicionamiento\s+seo\s+en\s+google|agencia\s+de\s+marketing\s+digital)\b/i
    ];

    for (const pattern of HIGH_CONFIDENCE_SOLICITATION_PATTERNS) {
        if (pattern.test(msgNorm)) {
            return true;
        }
    }

    // 3. Multi-signal cold-outreach scoring (requires 2+ distinct B2B pitch signals in the same message)
    const COLD_OUTREACH_SIGNALS = [
        /\bi\s+see\s+you\s+serve\s+authentic\s+mexican\s+food\b/i,
        /\busing\s+your\s+existing\s+positioning\b/i,
        /\bif\s+not,?\s+you\s+can\s+feel\s+free\s+to\s+ignore\s+this\b/i,
        /\bi\s+can\s+send\s+it\s+over\s+and\s+you\s+can\s+review\s+it\s+directly\b/i,
        /\b(calendly\.com\/|loom\.com\/share\/)\b/i,
        /\b(quick\s+10[- ]minute\s+call|book\s+a\s+quick\s+call|15[- ]minute\s+discovery\s+call)\b/i,
        /\b(web\s+design\s+agency|digital\s+marketing\s+services|social\s+media\s+management\s+agency)\b/i
    ];

    let signalMatches = 0;
    for (const sig of COLD_OUTREACH_SIGNALS) {
        if (sig.test(msgNorm)) {
            signalMatches++;
            if (signalMatches >= 2) return true;
        }
    }

    return false;
}

const ALLOWED_REASONS = new Set([
    'general',
    'catering',
    'feedback',
    'careers',
    'employment',
    'accessibility',
    'ccpa_know',
    'ccpa_delete',
    'ccpa_correct',
    'ccpa_optout',
    'ccpa_agent',
    'privacy',
    'other'
]);

const STORE_NAME_TO_ID = {
    'Rialto': 1,
    'West Covina': 3,
    'Azusa': 4,
    'LA Broadway': 5,
    'Los Angeles Broadway': 5,
    'Los Angeles (Vernon/Broadway)': 5,
    'Los Angeles (Vernon & Broadway)': 5,
    'Los Angeles Vernon & Broadway': 5,
    'Los Angeles Vernon/Broadway': 5,
    'LA Central': 6,
    'Los Angeles Central': 6,
    'Los Angeles Central & Washington': 6,
    'Los Angeles Central &amp; Washington': 6,
    'Los Angeles Central (Central/Washington)': 6,
    'Los Angeles (Central/Washington)': 6,
    'Los Angeles (Central & Washington)': 6,
    'Los Angeles Central/Washington': 6,
    'Los Angeles Central Central/Washington': 6,
    'Slauson': 7,
    'Los Angeles Slauson': 7,
    'Los Angeles Slauson & Broadway': 7,
    'Los Angeles (Slauson/Broadway)': 7,
    'Los Angeles (Slauson & Broadway)': 7,
    'Los Angeles Slauson/Broadway': 7,
    'Hollywood': 8,
    'Santa Ana': 9,
    'La Puente': 10,
    'Huntington Park': 11,
    'Norwalk': 12,
    'Bell': 13,
    'Lynwood': 14,
    'South Gate': 15,
    'Downey': 16
};

function resolveStoreId(rawStore) {
    if (!rawStore) return 14;
    if (STORE_NAME_TO_ID[rawStore]) return STORE_NAME_TO_ID[rawStore];
    const s = String(rawStore).toLowerCase();
    if (s.includes('rialto')) return 1;
    if (s.includes('west covina') || s.includes('covina')) return 3;
    if (s.includes('azusa')) return 4;
    if (s.includes('vernon') || s.includes('la broadway') || s.includes('4380')) return 5;
    if (s.includes('central') || s.includes('washington') || s.includes('1900')) return 6;
    if (s.includes('slauson') || s.includes('5833')) return 7;
    if (s.includes('hollywood') || s.includes('sunset')) return 8;
    if (s.includes('santa ana') || s.includes('17th')) return 9;
    if (s.includes('la puente') || s.includes('valley')) return 10;
    if (s.includes('huntington')) return 11;
    if (s.includes('norwalk') || s.includes('rosecrans')) return 12;
    if (s.includes('bell')) return 13;
    if (s.includes('lynwood') || s.includes('imperial')) return 14;
    if (s.includes('south gate') || s.includes('firestone')) return 15;
    if (s.includes('downey')) return 16;
    return null;
}

function isAllowedOriginOrReferer(req) {
    const origin = String(req.headers['origin'] || '').trim().toLowerCase();
    const referer = String(req.headers['referer'] || '').trim().toLowerCase();
    const checkUrl = origin || referer;
    if (!checkUrl) {
        // Allow same-origin or server-side tests where Origin header is omitted
        return true;
    }
    try {
        const parsed = new URL(checkUrl);
        const host = parsed.hostname.toLowerCase();
        if (
            host === 'tacosgavilan.com' ||
            host === 'www.tacosgavilan.com' ||
            host.endsWith('.tacosgavilan.com') ||
            host.endsWith('.vercel.app') ||
            host === 'localhost' ||
            host === '127.0.0.1'
        ) {
            return true;
        }
        return false;
    } catch (_) {
        return false;
    }
}

function escapeHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function buildMimeBase64Url({ from, to, cc, replyTo, subject, html }) {
    const encodedSubject = `=?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`;
    const headers = [
        `From: ${from}`,
        `To: ${to}`,
        ...(cc ? [`Cc: ${cc}`] : []),
        ...(replyTo ? [`Reply-To: ${replyTo}`] : []),
        `Subject: ${encodedSubject}`,
        'MIME-Version: 1.0',
        'Content-Type: text/html; charset="UTF-8"',
        'Content-Transfer-Encoding: base64',
        '',
        Buffer.from(html, 'utf8').toString('base64')
    ];
    const rawMime = headers.join('\r\n');
    return Buffer.from(rawMime, 'utf8')
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

async function dispatchContactEmails({ supabaseUrl, supabaseKey, name, email, phone, rawReason, rawStore, message, referenceId, confirmedTimestamp }) {
    try {
        const cfgRes = await fetch(
            `${supabaseUrl}/rest/v1/integrations?service_name=eq.website_contact_gmail&select=access_token&limit=1`,
            {
                headers: {
                    'apikey': supabaseKey,
                    'Authorization': `Bearer ${supabaseKey}`
                }
            }
        );
        if (!cfgRes.ok) return false;
        const cfgRows = await cfgRes.json();
        if (!Array.isArray(cfgRows) || !cfgRows[0]?.access_token) return false;

        const cfg = JSON.parse(cfgRows[0].access_token);
        if (!cfg.client_id || !cfg.client_secret || !cfg.refresh_token) return false;

        const tokenParams = new URLSearchParams({
            client_id: cfg.client_id,
            client_secret: cfg.client_secret,
            refresh_token: cfg.refresh_token,
            grant_type: 'refresh_token'
        });

        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: tokenParams.toString()
        });
        if (!tokenRes.ok) return false;
        const tokenData = await tokenRes.json();
        const accessToken = tokenData.access_token;
        if (!accessToken) return false;

        const supportEmail = cfg.support_email || 'support@tacosgavilan.com';
        const fromHeader = `Tacos Gavilan Website <${cfg.from_email || 'carlos@tacosgavilan.com'}>`;
        const safeName = escapeHtml(name);
        const safeEmail = escapeHtml(email);
        const safePhone = escapeHtml(phone || 'N/A');
        const safeReason = escapeHtml(rawReason);
        const safeStore = escapeHtml(rawStore || 'Corporate / General');
        const safeMessage = escapeHtml(message);

        // 1. Internal notification to support@tacosgavilan.com (CC carlos@tacosgavilan.com)
        const internalHtml = `
<div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 620px; margin: 0 auto; background: #141210; color: #ffffff; border: 1px solid #FFC72C; border-radius: 12px; overflow: hidden;">
  <div style="background: linear-gradient(135deg, #DA291C 0%, #9e1b11 100%); padding: 20px 24px; border-bottom: 2px solid #FFC72C;">
    <h2 style="margin: 0; font-size: 20px; color: #ffffff;">Tacos Gavilan — Website Contact Submission</h2>
    <p style="margin: 4px 0 0; font-size: 13px; color: #FFC72C; font-weight: 600;">Reference ID: ${referenceId}</p>
  </div>
  <div style="padding: 24px;">
    <table style="width: 100%; border-collapse: collapse; font-size: 14px; color: #f3f4f6;">
      <tr><td style="padding: 8px 0; color: #FFC72C; font-weight: 700; width: 150px;">Name:</td><td style="padding: 8px 0; color: #ffffff;">${safeName}</td></tr>
      <tr><td style="padding: 8px 0; color: #FFC72C; font-weight: 700;">Email:</td><td style="padding: 8px 0;"><a href="mailto:${safeEmail}" style="color: #FFC72C;">${safeEmail}</a></td></tr>
      <tr><td style="padding: 8px 0; color: #FFC72C; font-weight: 700;">Phone:</td><td style="padding: 8px 0; color: #ffffff;">${safePhone}</td></tr>
      <tr><td style="padding: 8px 0; color: #FFC72C; font-weight: 700;">Topic:</td><td style="padding: 8px 0; color: #ffffff;">${safeReason}</td></tr>
      <tr><td style="padding: 8px 0; color: #FFC72C; font-weight: 700;">Store Location:</td><td style="padding: 8px 0; color: #ffffff;">${safeStore}</td></tr>
      <tr><td style="padding: 8px 0; color: #FFC72C; font-weight: 700;">Submitted (UTC):</td><td style="padding: 8px 0; color: #ffffff;">${confirmedTimestamp}</td></tr>
    </table>
    <div style="margin-top: 18px; padding: 16px; background: rgba(255,255,255,0.06); border-left: 4px solid #FFC72C; border-radius: 6px;">
      <div style="font-size: 12px; text-transform: uppercase; letter-spacing: 0.8px; color: #FFC72C; font-weight: 700; margin-bottom: 6px;">Message</div>
      <div style="font-size: 15px; line-height: 1.5; color: #ffffff; white-space: pre-wrap;">${safeMessage}</div>
    </div>
    <p style="margin-top: 20px; font-size: 12px; color: #9ca3af;">
      Reply directly to this email to respond to <strong>${safeName} (${safeEmail})</strong>.
    </p>
  </div>
</div>`;

        const rawInternal = buildMimeBase64Url({
            from: fromHeader,
            to: supportEmail,
            cc: 'carlos@tacosgavilan.com',
            replyTo: `${name.replace(/["<>]/g, '')} <${email}>`,
            subject: `[Tacos Gavilan Web] Contact (${rawReason} - ${rawStore || 'General'}) — ${name} (${referenceId})`,
            html: internalHtml
        });

        // 2. Customer confirmation email
        const confirmHtml = `
<div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 620px; margin: 0 auto; background: #141210; color: #ffffff; border: 1px solid #FFC72C; border-radius: 12px; overflow: hidden;">
  <div style="background: linear-gradient(135deg, #DA291C 0%, #9e1b11 100%); padding: 20px 24px; border-bottom: 2px solid #FFC72C;">
    <h2 style="margin: 0; font-size: 20px; color: #ffffff;">Thank You for Contacting Tacos Gavilan!</h2>
    <p style="margin: 4px 0 0; font-size: 13px; color: #FFC72C; font-weight: 600;">Confirmation ID: ${referenceId}</p>
  </div>
  <div style="padding: 24px; font-size: 14px; line-height: 1.6; color: #f3f4f6;">
    <p>Hi <strong>${safeName}</strong>,</p>
    <p>We have received your message at <strong>Tacos Gavilan</strong> and our team will review it shortly.</p>
    <div style="margin: 18px 0; padding: 14px 16px; background: rgba(255,255,255,0.06); border-left: 4px solid #FFC72C; border-radius: 6px;">
      <div><strong style="color: #FFC72C;">Topic:</strong> ${safeReason}</div>
      <div><strong style="color: #FFC72C;">Store:</strong> ${safeStore}</div>
      <div style="margin-top: 8px;"><strong style="color: #FFC72C;">Your Message:</strong><br>${safeMessage}</div>
    </div>
    <p style="font-size: 12px; color: #9ca3af;">If you need additional assistance, please email us at <a href="mailto:support@tacosgavilan.com" style="color: #FFC72C;">support@tacosgavilan.com</a>.</p>
  </div>
</div>`;

        const rawConfirm = buildMimeBase64Url({
            from: fromHeader,
            to: email,
            replyTo: supportEmail,
            subject: `We received your message — Tacos Gavilan (${referenceId})`,
            html: confirmHtml
        });

        await Promise.all([
            fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ raw: rawInternal })
            }),
            fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ raw: rawConfirm })
            })
        ]);
        return true;
    } catch (e) {
        console.error('[api/contact] Email dispatch warning:', e);
        return false;
    }
}

module.exports = async function handler(req, res) {
    const reqOrigin = req.headers['origin'] || '';
    if (isAllowedOriginOrReferer(req) && reqOrigin) {
        res.setHeader('Access-Control-Allow-Origin', reqOrigin);
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    }
    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }
    // 1. Method check: only POST
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).json({
            ok: false,
            error: 'Method Not Allowed. Please use POST.'
        });
    }

    // 1b. Origin / Referer CSRF protection check
    if (!isAllowedOriginOrReferer(req)) {
        return res.status(403).json({
            ok: false,
            error: 'Forbidden: Cross-origin form submissions are not permitted.'
        });
    }

    // 2. Content-Type check
    const contentType = req.headers['content-type'] || '';
    if (!contentType.toLowerCase().includes('application/json')) {
        return res.status(415).json({
            ok: false,
            error: 'Unsupported Media Type. Content-Type must be application/json.'
        });
    }

    // 3. Client IP extraction & Rate Limiting
    const forwarded = req.headers['x-forwarded-for'];
    const clientIp = (typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : '') ||
                     req.headers['x-real-ip'] ||
                     req.socket?.remoteAddress ||
                     '127.0.0.1';

    if (isRateLimited(clientIp)) {
        res.setHeader('Retry-After', '600');
        return res.status(429).json({
            ok: false,
            error: 'Too many requests. Please wait a few minutes before sending another message or email us at support@tacosgavilan.com.'
        });
    }

    try {
        // 4. Payload size check
        const rawLength = req.headers['content-length'];
        if (rawLength && parseInt(rawLength, 10) > MAX_PAYLOAD_BYTES) {
            return res.status(413).json({
                ok: false,
                error: 'Payload Too Large. Maximum allowed size is 10 KB.'
            });
        }

        let body = req.body;
        if (typeof body === 'string') {
            if (body.length > MAX_PAYLOAD_BYTES) {
                return res.status(413).json({
                    ok: false,
                    error: 'Payload Too Large. Maximum allowed size is 10 KB.'
                });
            }
            try { body = JSON.parse(body); } catch (_) {
                return res.status(400).json({ ok: false, error: 'Malformed JSON payload.' });
            }
        }
        body = body || {};

        // 5. Honeypot Anti-Spam Check
        if (body.b_company_website || body.b_website || body.b_name || body.b_company || body.website) {
            // Silently discard spam submission; do not write to DB
            return res.status(200).json({
                ok: true,
                reference_id: 'TG-FILTERED',
                submitted_at: new Date().toISOString(),
                message: 'Thank you for your message.'
            });
        }

        // 6. Field Validation & Sanitization
        const name = sanitizeText(body.name);
        const email = sanitizeText(body.email);
        const phone = sanitizeText(body.phone);
        const rawReasonInput = sanitizeText(body.reason || body.subject || body.type || body.category).toLowerCase();
        const REASON_ALIASES = {
            'general inquiry': 'general',
            'corporate / general inquiry': 'general',
            'catering & party trays': 'catering',
            'catering & fiesta platters': 'catering',
            'customer feedback': 'feedback',
            'customer feedback & guest experience': 'feedback',
            'employment / careers inquiry': 'employment',
            'website accessibility / ada assistance': 'accessibility',
            'privacy request: right to know / access (ccpa)': 'ccpa_know',
            'privacy request: right to delete (ccpa)': 'ccpa_delete',
            'privacy request: right to correct (ccpa)': 'ccpa_correct',
            'privacy request: opt-out of sale/sharing (ccpa)': 'ccpa_optout',
            'privacy request: authorized agent / appeal': 'ccpa_agent',
            'corporate / media': 'other',
            'corporate & media': 'other'
        };
        const rawReason = REASON_ALIASES[rawReasonInput] || rawReasonInput || 'general';
        const rawStore = sanitizeText(body.store || body.location);
        const message = sanitizeText(body.message);

        if (!name || name.length < 2 || name.length > 100) {
            return res.status(400).json({
                ok: false,
                field: 'name',
                error: 'Please provide a valid name (2-100 characters).'
            });
        }

        if (!email || !isValidEmail(email) || email.length > 150) {
            return res.status(400).json({
                ok: false,
                field: 'email',
                error: 'Please provide a valid email address.'
            });
        }

        if (phone && phone.length > 30) {
            return res.status(400).json({
                ok: false,
                field: 'phone',
                error: 'Phone number cannot exceed 30 characters.'
            });
        }

        if (!ALLOWED_REASONS.has(rawReason)) {
            return res.status(400).json({
                ok: false,
                field: 'reason',
                error: 'Invalid topic selected. Please choose a valid category.'
            });
        }

        // If a store is specified, it MUST be in the approved list
        if (rawStore && !resolveStoreId(rawStore)) {
            return res.status(400).json({
                ok: false,
                field: 'store',
                error: 'Invalid store location selected.'
            });
        }

        if (!message || message.length < 2 || message.length > 2000) {
            return res.status(400).json({
                ok: false,
                field: 'message',
                error: 'Please write a message between 2 and 2000 characters.'
            });
        }

        // 6b. Automated Bot / Gibberish / Scanner / B2B Cold-Outreach Solicitation Filter (Shadow-Drop)
        if (
            isAutomatedBotSubmission({ name, email, message, userAgent: req.headers['user-agent'] }) ||
            isB2BSolicitationSpam({ email, message })
        ) {
            return res.status(200).json({
                ok: true,
                reference_id: 'TG-FILTERED',
                submitted_at: new Date().toISOString(),
                message: 'Thank you for your message.'
            });
        }

        // 7. Fail-Closed Supabase Configuration Check
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || 'https://ywwwdcvgfculqmcfkihq.supabase.co';
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

        if (!supabaseKey) {
            console.error('[api/contact] Critical configuration failure: SUPABASE_SERVICE_ROLE_KEY is not defined.');
            return res.status(503).json({
                ok: false,
                code: 'CONTACT_SERVICE_UNAVAILABLE',
                error: 'Contact service is temporarily unavailable. Please contact us via email at support@tacosgavilan.com.'
            });
        }

        // Resolve store_id (default to Lynwood: 14 if store is not specified)
        const storeId = rawStore ? (resolveStoreId(rawStore) || 14) : 14;
        const ua = (req.headers['user-agent'] || '').slice(0, 200);
        const submittedAt = new Date().toISOString();
        const isCcpaRequest = rawReason.startsWith('ccpa_') || rawReason === 'privacy';
        const tagPrefix = isCcpaRequest
            ? `[CCPA/CPRA PRIVACY REQUEST: ${rawReason.toUpperCase()} | 10-Bus-Day Receipt / 45-Day Statutory SLA]`
            : `[Website Contact Form: ${rawReason}]`;

        const dbPayload = {
            store_id: storeId,
            customer_name: name,
            customer_email: email,
            customer_phone: phone || null,
            comments: message,
            complaint_type: rawReason,
            source: 'website_contact',
            submission_date: submittedAt,
            requires_follow_up: true,
            review_status: 'pending',
            admin_review_status: 'pendiente',
            admin_observation: `${tagPrefix} Store Selected: ${rawStore || 'None (General)'} | Submitted UTC: ${submittedAt} | Client IP: ${clientIp} | UA: ${ua}`
        };

        const dbRes = await fetch(`${supabaseUrl}/rest/v1/customer_feedback`, {
            method: 'POST',
            headers: {
                'apikey': supabaseKey,
                'Authorization': `Bearer ${supabaseKey}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=representation'
            },
            body: JSON.stringify(dbPayload)
        });

        if (!dbRes.ok) {
            const dbError = await dbRes.text();
            console.error('[api/contact] Supabase write failed:', dbRes.status, dbError);
            return res.status(500).json({
                ok: false,
                error: 'Unable to save your message right now. Please try again or contact us at support@tacosgavilan.com.'
            });
        }

        const insertedRows = await dbRes.json();
        if (!Array.isArray(insertedRows) || insertedRows.length === 0 || !insertedRows[0].id) {
            console.error('[api/contact] Supabase returned empty representation:', insertedRows);
            return res.status(500).json({
                ok: false,
                error: 'Message could not be verified in our records. Please contact us at support@tacosgavilan.com.'
            });
        }

        const recordId = insertedRows[0].id;
        const confirmedTimestamp = insertedRows[0].submission_date || submittedAt;
        const dateCompact = confirmedTimestamp.slice(0, 10).replace(/-/g, '');
        const referenceId = `TG-${dateCompact}-${recordId}`;

        // Dispatch notification email to support@tacosgavilan.com and confirmation to customer
        const emailDispatched = await dispatchContactEmails({
            supabaseUrl,
            supabaseKey,
            name,
            email,
            phone,
            rawReason,
            rawStore,
            message,
            referenceId,
            confirmedTimestamp
        });

        // Return HTTP 200 ONLY after confirmed database persistence
        return res.status(200).json({
            ok: true,
            success: true,
            id: recordId,
            reference_id: referenceId,
            submitted_at: confirmedTimestamp,
            email_dispatched: emailDispatched,
            category: rawReason,
            message: `Thank you! Your submission has been received by Tacos Gavilan. Confirmation Reference ID: ${referenceId} (Recorded at ${confirmedTimestamp}).`,
            message_es: `¡Gracias! Tu solicitud ha sido recibida por Tacos Gavilan. ID de Confirmación: ${referenceId} (Registrado el ${confirmedTimestamp}).`
        });

    } catch (err) {
        console.error('[api/contact] Unhandled exception:', err);
        return res.status(500).json({
            ok: false,
            error: 'An unexpected server error occurred. Please try again or email support@tacosgavilan.com.'
        });
    }
};
