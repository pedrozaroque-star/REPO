/**
 * @module api/track
 * @description Production Vercel Serverless Function for real-time first-party website analytics
 * on https://tacosgavilan.com. Tracks page views (website_page_view) and outbound order/action clicks
 * (website_order_click) per store, platform (Toast order.online, Phone, Directions, Delivery),
 * device type, and language, persisting directly to Supabase public.activity_logs.
 *
 * @businessRules
 *   1. Tacos Gavilan Business Day starts at 6:00 AM and ends at 5:59 AM the next day (America/Los_Angeles).
 *   2. Privacy-first (CCPA/CPRA compliant): Uses anonymous session_id, stores zero personal data (PII).
 *   3. Supports both navigator.sendBeacon (text/plain or application/json) and fetch keepalive POST.
 *   4. Maps all 15 official Tacos Gavilan locations to their canonical Supabase store_id (1..16).
 *
 * @dataFlow
 *   - Client (compliance-a11y.js / main.js) -> POST /api/track -> Supabase public.activity_logs (entity_type: 'tacosgavilan_web').
 */

const MAX_PAYLOAD_BYTES = 8192; // 8 KB
const TRACK_RATE_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const MAX_TRACK_EVENTS_PER_WINDOW = 60;
const trackRateMap = new Map();
let trackRateChecks = 0;

function isTrackRateLimited(ip) {
    if (!ip) return false;
    const now = Date.now();
    trackRateChecks++;
    if (trackRateChecks % 200 === 0) {
        for (const [k, v] of trackRateMap.entries()) {
            if (now > v.resetAt) trackRateMap.delete(k);
        }
    }
    const rec = trackRateMap.get(ip);
    if (!rec || now > rec.resetAt) {
        trackRateMap.set(ip, { count: 1, resetAt: now + TRACK_RATE_WINDOW_MS });
        return false;
    }
    rec.count++;
    return rec.count > MAX_TRACK_EVENTS_PER_WINDOW;
}

const STORE_ID_TO_NAME = {
    1: 'Rialto',
    3: 'West Covina',
    4: 'Azusa',
    5: 'LA Broadway',
    6: 'LA Central',
    7: 'Slauson',
    8: 'Hollywood',
    9: 'Santa Ana',
    10: 'La Puente',
    11: 'Huntington Park',
    12: 'Norwalk',
    13: 'Bell',
    14: 'Lynwood',
    15: 'South Gate',
    16: 'Downey'
};

function sanitizeText(str, maxLen = 180) {
    if (!str || typeof str !== 'string') return '';
    return str
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F<>]/g, '')
        .trim()
        .slice(0, maxLen);
}

/**
 * Computes the Tacos Gavilan Business Date (YYYY-MM-DD) in America/Los_Angeles
 * where the workday runs from 6:00 AM to 5:59 AM the next morning.
 */
function getGavilanBusinessDate(now = new Date()) {
    try {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/Los_Angeles',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            hour12: false
        }).formatToParts(now);

        const map = {};
        for (const p of parts) {
            if (p.type !== 'literal') map[p.type] = p.value;
        }

        const year = parseInt(map.year, 10);
        const month = parseInt(map.month, 10);
        const day = parseInt(map.day, 10);
        const hour = parseInt(map.hour, 10) % 24;

        const dt = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
        if (hour < 6) {
            dt.setUTCDate(dt.getUTCDate() - 1);
        }
        return dt.toISOString().slice(0, 10);
    } catch (_) {
        return now.toISOString().slice(0, 10);
    }
}

module.exports = async function handler(req, res) {
    // Allow CORS for preview/live domains
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }

    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST', 'OPTIONS']);
        return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
    }

    try {
        let body = req.body;
        if (typeof body === 'string') {
            if (body.length > MAX_PAYLOAD_BYTES) {
                return res.status(413).json({ ok: false, error: 'Payload Too Large' });
            }
            try {
                body = JSON.parse(body);
            } catch (_) {
                return res.status(400).json({ ok: false, error: 'Invalid JSON' });
            }
        }
        body = body || {};

        const rawType = sanitizeText(body.event_type, 30);
        const action = rawType === 'order_click' ? 'website_order_click' : 'website_page_view';

        const rawStoreId = Number(body.store_id);
        const validStoreId = STORE_ID_TO_NAME[rawStoreId] ? rawStoreId : null;
        const storeName = validStoreId
            ? STORE_ID_TO_NAME[validStoreId]
            : sanitizeText(body.store_name, 80) || null;

        const pagePath = sanitizeText(body.page_path || '/', 160) || '/';
        const sessionId = sanitizeText(body.session_id || 'anon', 64);
        const platform = sanitizeText(body.platform || (action === 'website_order_click' ? 'toast' : 'web'), 40);
        const buttonSource = sanitizeText(body.button_source || 'page', 60);
        const deviceType = ['mobile', 'tablet', 'desktop'].includes(body.device_type)
            ? body.device_type
            : 'desktop';
        const lang = body.lang === 'es' ? 'es' : 'en';
        const referrer = sanitizeText(body.referrer || 'direct', 150) || 'direct';
        const targetUrl = sanitizeText(body.target_url || '', 220) || null;
        const businessDate = getGavilanBusinessDate();

        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || 'https://ywwwdcvgfculqmcfkihq.supabase.co';
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

        if (!supabaseKey) {
            return res.status(503).json({ ok: false, error: 'Analytics storage unconfigured' });
        }

        const forwarded = req.headers['x-forwarded-for'];
        const clientIp = (typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : '') ||
                         req.headers['x-real-ip'] ||
                         req.socket?.remoteAddress ||
                         '127.0.0.1';
        if (isTrackRateLimited(clientIp)) {
            return res.status(429).json({ ok: false, error: 'Too Many Requests' });
        }

        const ua = sanitizeText(req.headers['user-agent'] || '', 240);

        // Skip obvious automated headless bots/crawlers so metrics reflect real human visitors
        if (/bot|crawler|spider|headless|lighthouse|uptime|pingdom|sqlmap|nikto|nmap|python-requests|go-http-client|curl|wget/i.test(ua)) {
            return res.status(200).json({ ok: true, skipped: 'bot' });
        }

        const dbPayload = {
            user_id: null,
            action,
            entity_type: 'tacosgavilan_web',
            entity_id: validStoreId,
            old_values: null,
            new_values: {
                business_date: businessDate,
                session_id: sessionId,
                page_path: pagePath,
                store_id: validStoreId,
                store_name: storeName,
                platform,
                button_source: buttonSource,
                device_type: deviceType,
                lang,
                referrer,
                target_url: targetUrl
            },
            ip_address: null,
            user_agent: ua || null
        };

        const dbRes = await fetch(`${supabaseUrl}/rest/v1/activity_logs`, {
            method: 'POST',
            headers: {
                'apikey': supabaseKey,
                'Authorization': `Bearer ${supabaseKey}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal'
            },
            body: JSON.stringify(dbPayload)
        });

        if (!dbRes.ok) {
            const errText = await dbRes.text();
            console.error('[api/track] Supabase insert error:', dbRes.status, errText);
            return res.status(500).json({ ok: false });
        }

        return res.status(200).json({ ok: true, business_date: businessDate, action });
    } catch (err) {
        console.error('[api/track] Exception:', err);
        return res.status(500).json({ ok: false });
    }
};
