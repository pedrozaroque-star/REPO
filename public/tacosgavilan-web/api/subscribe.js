/**
 * @module api/subscribe
 * @description Production Vercel Serverless Function for customer newsletter, Fiesta Platter specials, and offer subscriptions.
 * Implements strict fail-closed security, content-type and body-size guards, in-memory rate limiting,
 * honeypot bot trap, ASCII control character sanitization, and confirmed Supabase persistence.
 *
 * @businessRules
 *   1. Captures newsletter subscriptions and special offers signups.
 *   2. Fail-Closed Guarantee: Confirmed database persistence before returning HTTP 200.
 *
 * @dataFlow
 *   - index.html / modal -> POST /api/subscribe -> Supabase public.customer_feedback (complaint_type: 'newsletter', source: 'website_newsletter').
 */

const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 5;
const MAX_PAYLOAD_BYTES = 5120; // 5 KB

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
    return record.count > MAX_REQUESTS_PER_WINDOW;
}

function sanitizeText(str) {
    if (!str || typeof str !== 'string') return '';
    return str
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
        .replace(/[<>]/g, '')
        .trim();
}

function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).json({
            ok: false,
            error: 'Method Not Allowed. Please use POST.'
        });
    }

    const contentType = req.headers['content-type'] || '';
    if (!contentType.toLowerCase().includes('application/json')) {
        return res.status(415).json({
            ok: false,
            error: 'Unsupported Media Type. Content-Type must be application/json.'
        });
    }

    const forwarded = req.headers['x-forwarded-for'];
    const clientIp = (typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : '') ||
                     req.headers['x-real-ip'] ||
                     req.socket?.remoteAddress ||
                     '127.0.0.1';

    if (isRateLimited(clientIp)) {
        res.setHeader('Retry-After', '600');
        return res.status(429).json({
            ok: false,
            error: 'Too many requests. Please wait a few minutes.'
        });
    }

    try {
        let body = req.body;
        if (typeof body === 'string') {
            if (body.length > MAX_PAYLOAD_BYTES) {
                return res.status(413).json({ ok: false, error: 'Payload Too Large.' });
            }
            try { body = JSON.parse(body); } catch (_) {
                return res.status(400).json({ ok: false, error: 'Malformed JSON payload.' });
            }
        }
        body = body || {};

        // Honeypot check
        if (body.b_company || body.b_website) {
            return res.status(200).json({
                ok: true,
                message: 'Thank you for subscribing.'
            });
        }

        const email = sanitizeText(body.email);
        const name = sanitizeText(body.name) || 'Subscriber';
        const campaign = sanitizeText(body.campaign) || 'general_offers';

        if (!email || !isValidEmail(email) || email.length > 150) {
            return res.status(400).json({
                ok: false,
                field: 'email',
                error: 'Please provide a valid email address.'
            });
        }

        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || 'https://ywwwdcvgfculqmcfkihq.supabase.co';
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

        if (!supabaseKey) {
            console.error('[api/subscribe] Critical configuration failure: SUPABASE_SERVICE_ROLE_KEY is not defined.');
            return res.status(503).json({
                ok: false,
                code: 'SUBSCRIBE_SERVICE_UNAVAILABLE',
                error: 'Subscription service is temporarily unavailable.'
            });
        }

        const ua = (req.headers['user-agent'] || '').slice(0, 200);

        const dbPayload = {
            store_id: 14,
            customer_name: name,
            customer_email: email,
            comments: `[Newsletter / Offers Subscription] Campaign: ${campaign}`,
            complaint_type: 'newsletter',
            source: 'website_newsletter',
            submission_date: new Date().toISOString(),
            requires_follow_up: false,
            review_status: 'approved',
            admin_review_status: 'aprobado',
            admin_observation: `[Newsletter Subscription] Email: ${email} | Campaign: ${campaign} | IP: ${clientIp} | UA: ${ua}`
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
            console.error('[api/subscribe] Supabase write failed:', dbRes.status, dbError);
            return res.status(500).json({
                ok: false,
                error: 'Unable to save subscription. Please try again.'
            });
        }

        const insertedRows = await dbRes.json();
        if (!Array.isArray(insertedRows) || insertedRows.length === 0 || !insertedRows[0].id) {
            console.error('[api/subscribe] Supabase returned empty representation:', insertedRows);
            return res.status(500).json({
                ok: false,
                error: 'Subscription could not be verified in our records.'
            });
        }

        return res.status(200).json({
            ok: true,
            success: true,
            id: insertedRows[0].id,
            message: 'Thank you for subscribing to Tacos Gavilan special offers!',
            message_es: '¡Gracias por suscribirte a las ofertas especiales de Tacos Gavilan!'
        });

    } catch (err) {
        console.error('[api/subscribe] Unhandled exception:', err);
        return res.status(500).json({
            ok: false,
            error: 'An unexpected server error occurred.'
        });
    }
};
