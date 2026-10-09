/**
 * @module api/contact
 * @description Production Vercel Serverless Function for official Tacos Gavilan customer contact form submissions.
 * Implements strict fail-closed security, content-type and body-size guards, in-memory rate limiting,
 * honeypot bot trap, ASCII control character sanitization, whitelisted parameters, and confirmed Supabase persistence.
 *
 * @businessRules
 *   1. Toast POS is exclusive for food orders; this endpoint handles brand, catering, careers, and accessibility inquiries.
 *   2. Fail-Closed Guarantee: Never return HTTP 200 without verified database persistence in Supabase.
 *   3. If Supabase configuration or network fails, return 503 CONTACT_SERVICE_UNAVAILABLE with office phone fallback (310) 870-7009.
 *   4. Strictly whitelist topics and store names to prevent injection or corruption of customer_feedback records.
 *   5. Rate limited to 5 submissions per 10-minute window per IP to prevent spam and denial of service.
 *
 * @dataFlow
 *   - index.html (#contact-form) -> POST /api/contact -> Supabase public.customer_feedback (store_id, customer_name, comments, complaint_type).
 *
 * @notes
 *   - Verified against live Supabase schema for public.customer_feedback (references stores.id).
 *   - Corporate headquarters (Lynwood, store_id: 14) serves as default anchor when no specific store is chosen.
 */

const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const MAX_REQUESTS_PER_WINDOW = 5;
const MAX_PAYLOAD_BYTES = 10240; // 10 KB

// In-memory rate limiting store (per serverless instance)
const rateLimitMap = new Map();

function isRateLimited(ip) {
    if (!ip) return false;
    const now = Date.now();
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
    'LA Central': 6,
    'Slauson': 7,
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
            error: 'Too many requests. Please wait a few minutes before sending another message or call us at (310) 870-7009.'
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
        if (body.b_company_website || body.b_website || body.b_name) {
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
        const rawReason = sanitizeText(body.reason).toLowerCase() || 'general';
        const rawStore = sanitizeText(body.store);
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
                error: 'Contact service is temporarily unavailable. Please call our corporate office at (310) 870-7009.'
            });
        }

        // Resolve store_id (default to Lynwood HQ: 14 if store is not specified)
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
                error: 'Unable to save your message right now. Please try again or call our office at (310) 870-7009.'
            });
        }

        const insertedRows = await dbRes.json();
        if (!Array.isArray(insertedRows) || insertedRows.length === 0 || !insertedRows[0].id) {
            console.error('[api/contact] Supabase returned empty representation:', insertedRows);
            return res.status(500).json({
                ok: false,
                error: 'Message could not be verified in our records. Please call (310) 870-7009.'
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
            error: 'An unexpected server error occurred. Please try again or call (310) 870-7009.'
        });
    }
};
