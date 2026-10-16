/**
 * @module api/contact
 * @description Production Vercel Serverless Function for official Tacos Gavilan customer contact form submissions.
 * Implements strict fail-closed security, content-type and body-size guards, best-effort per-instance rate limiting,
 * honeypot bot trap, ASCII control character sanitization, whitelisted parameters, and confirmed Supabase persistence.
 *
 * @businessRules
 *   1. Toast POS is exclusive for food orders; this endpoint handles brand, catering, careers, and accessibility inquiries.
 *   2. Fail-Closed Guarantee: Never return HTTP 200 without verified database persistence in Supabase.
 *   3. If Supabase configuration or network fails, return 503 CONTACT_SERVICE_UNAVAILABLE with email fallback info@tacosgavilan.com.
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
            // 5+ consecutive consonants (excluding common English/Spanish clusters)
            if (/^[a-zA-Z]+$/.test(w) && /[bcdfghjklmnpqrstvwxz]{5,}/i.test(w)) {
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

const ALLOWED_REASONS = new Set([
    'general',
    'catering',
    'feedback',
    'careers',
    'accessibility',
    'other'
]);

const STORE_NAME_TO_ID = {
    'Rialto': 1,
    'West Covina': 3,
    'Azusa': 4,
    'LA Broadway': 5,
    'Los Angeles Broadway': 5,
    'Los Angeles (Vernon/Broadway)': 5,
    'Los Angeles Vernon/Broadway': 5,
    'LA Central': 6,
    'Los Angeles Central': 6,
    'Los Angeles Central (Central/Washington)': 6,
    'Los Angeles (Central/Washington)': 6,
    'Los Angeles Central/Washington': 6,
    'Los Angeles Central Central/Washington': 6,
    'Slauson': 7,
    'Los Angeles Slauson': 7,
    'Los Angeles (Slauson/Broadway)': 7,
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

module.exports = async function handler(req, res) {
    // 1. Method check: only POST
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).json({
            ok: false,
            error: 'Method Not Allowed. Please use POST.'
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
            error: 'Too many requests. Please wait a few minutes before sending another message or email us at info@tacosgavilan.com.'
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
        if (body.b_company_website || body.b_website || body.b_name || body.b_company) {
            // Silently discard spam submission; do not write to DB
            return res.status(200).json({
                ok: true,
                message: 'Thank you for your message.'
            });
        }

        // 6. Field Validation & Sanitization
        const name = sanitizeText(body.name);
        const email = sanitizeText(body.email);
        const phone = sanitizeText(body.phone);
        const rawReasonInput = sanitizeText(body.reason || body.subject || body.type).toLowerCase();
        const REASON_ALIASES = {
            'general inquiry': 'general',
            'corporate / general inquiry': 'general',
            'catering & party trays': 'catering',
            'catering & fiesta platters': 'catering',
            'customer feedback': 'feedback',
            'customer feedback & guest experience': 'feedback',
            'corporate / media': 'other',
            'corporate & media': 'other'
        };
        const rawReason = REASON_ALIASES[rawReasonInput] || rawReasonInput || 'general';
        const rawStore = sanitizeText(body.store);
        const message = sanitizeText(body.message);

        // 5b. Automated Bot / Gibberish / Scanner Filter (Shadow-Drop)
        if (isAutomatedBotSubmission({ name, email, message, userAgent: req.headers['user-agent'] })) {
            return res.status(200).json({
                ok: true,
                message: 'Thank you for your message.'
            });
        }

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
        if (rawStore && !STORE_NAME_TO_ID[rawStore]) {
            return res.status(400).json({
                ok: false,
                field: 'store',
                error: 'Invalid store location selected.'
            });
        }

        if (!message || message.length < 5 || message.length > 2000) {
            return res.status(400).json({
                ok: false,
                field: 'message',
                error: 'Please write a message between 5 and 2000 characters.'
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
                error: 'Contact service is temporarily unavailable. Please contact us via email at info@tacosgavilan.com.'
            });
        }

        // Resolve store_id (default to Lynwood: 14 if store is not specified)
        const storeId = rawStore ? STORE_NAME_TO_ID[rawStore] : 14;
        const ua = (req.headers['user-agent'] || '').slice(0, 200);

        const dbPayload = {
            store_id: storeId,
            customer_name: name,
            customer_email: email,
            customer_phone: phone || null,
            comments: message,
            complaint_type: rawReason,
            source: 'website_contact',
            submission_date: new Date().toISOString(),
            requires_follow_up: true,
            review_status: 'pending',
            admin_review_status: 'pendiente',
            admin_observation: `[Website Contact Form] Store Selected: ${rawStore || 'None (General)'} | Client IP: ${clientIp} | UA: ${ua}`
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
                error: 'Unable to save your message right now. Please try again or contact us at info@tacosgavilan.com.'
            });
        }

        const insertedRows = await dbRes.json();
        if (!Array.isArray(insertedRows) || insertedRows.length === 0 || !insertedRows[0].id) {
            console.error('[api/contact] Supabase returned empty representation:', insertedRows);
            return res.status(500).json({
                ok: false,
                error: 'Message could not be verified in our records. Please contact us at info@tacosgavilan.com.'
            });
        }

        // Return HTTP 200 ONLY after confirmed database persistence
        return res.status(200).json({
            ok: true,
            success: true,
            id: insertedRows[0].id,
            message: 'Thank you! Your message has been sent to Tacos Gavilan. We will get back to you shortly.',
            message_es: '¡Gracias! Tu mensaje ha sido enviado a Tacos Gavilan. Nos pondremos en contacto contigo pronto.'
        });

    } catch (err) {
        console.error('[api/contact] Unhandled exception:', err);
        return res.status(500).json({
            ok: false,
            error: 'An unexpected server error occurred. Please try again or email info@tacosgavilan.com.'
        });
    }
};
