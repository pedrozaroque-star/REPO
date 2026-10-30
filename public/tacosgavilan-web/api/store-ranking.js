/**
 * @module api/store-ranking
 * @description Automatic Monthly Store Sales Ranking Endpoint for https://tacosgavilan.com.
 * Queries live monthly Net Sales from Supabase `public.sales_daily_cache` (the same data source
 * powering the VENTAS module in the TEG monitoring system) and returns the canonical 15 Tacos Gavilan
 * restaurant locations ordered from highest to lowest monthly sales (`mayor a menor mensuales`).
 *
 * @businessRules
 *   1. Tacos Gavilan Business Day runs from 6:00 AM to 5:59 AM the next morning in `America/Los_Angeles`.
 *   2. Monthly Window Selection (`auto` mode):
 *      - On Day 1 of a new month (`day === 1`, e.g., November 1st when October has just closed at 5:59 AM),
 *        the endpoint evaluates the full just-completed calendar month (`last_month`, e.g., Oct 1 – Oct 31)
 *        so the website reflects the complete monthly close on the 1st of the month.
 *      - From Day 2 through the end of the month (`day >= 2`), the endpoint evaluates the active
 *        Month-to-Date window (`current_month_mtd`: `YYYY-MM-01` through `business_date`), matching the
 *        "Este Mes" (`month`) view in the VENTAS module in real time.
 *      - Safety Fallback: If the current month has fewer than 14 active stores with sales > 0 in
 *        `sales_daily_cache` (e.g., before the morning Toast sync completes on Day 2), it automatically
 *        falls back to the previous completed calendar month.
 *   3. Financial Privacy: Raw dollar figures (`net_sales`) are aggregated strictly server-side and are
 *      NEVER exposed in the public JSON payload—only the ordered store `slug`, `code`, `name`, and `rank`.
 *
 * @dataFlow
 *   - Supabase `public.sales_daily_cache` (`business_date`, `store_id`, `store_name`, `net_sales`)
 *     -> Server-side aggregation & descending sort -> `GET /api/store-ranking`
 *     -> `js/main.js` dynamic DOM reordering of `.locations-grid` (Homepage), `#locations-list` (Locations Directory),
 *        `gavilanLocations` (Interactive Map & Fallback List), and Contact Form store dropdowns.
 *
 * @notes
 *   - Cached at the Vercel Edge CDN (`s-maxage=300, stale-while-revalidate=600`) for instant response
 *     times while staying continuously synchronized with Toast POS / VENTAS cache updates.
 */

const CANONICAL_STORES = [
    {
        id: '8685e942-3f07-403a-afb6-faec697cd2cb',
        slug: 'la-central',
        code: 'LACENTRAL',
        name: 'LA Central',
        aliases: ['la central', 'los angeles central', 'central & washington']
    },
    {
        id: '80a1ec95-bc73-402e-8884-e5abbe9343e6',
        slug: 'lynwood',
        code: 'LYNWOOD',
        name: 'Lynwood',
        aliases: ['lynwood']
    },
    {
        id: '475bc112-187d-4b9c-884d-1f6a041698ce',
        slug: 'la-broadway',
        code: 'LABROADWY',
        name: 'LA Broadway',
        aliases: ['la broadway', 'vernon & broadway', 'los angeles broadway']
    },
    {
        id: '42ed15a6-106b-466a-9076-1e8f72451f6b',
        slug: 'norwalk',
        code: 'NORWALK',
        name: 'Norwalk',
        aliases: ['norwalk']
    },
    {
        id: '9625621e-1b5e-48d7-87ae-7094fab5a4fd',
        slug: 'slauson',
        code: 'SLAUSON',
        name: 'Slauson',
        aliases: ['slauson', 'slauson & broadway']
    },
    {
        id: '5f4a006e-9a6e-4bcf-b5bd-7f5e9d801a02',
        slug: 'west-covina',
        code: 'WCOVINA',
        name: 'West Covina',
        aliases: ['west covina']
    },
    {
        id: 'acf15327-54c8-4da4-8d0d-3ac0544dc422',
        slug: 'rialto',
        code: 'RIALTO',
        name: 'Rialto',
        aliases: ['rialto']
    },
    {
        id: '95866cfc-eeb8-4af9-9586-f78931e1ea04',
        slug: 'south-gate',
        code: 'SOUTHGATE',
        name: 'South Gate',
        aliases: ['south gate']
    },
    {
        id: 'b7f63b01-f089-4ad7-a346-afdb1803dc1a',
        slug: 'downey',
        code: 'DOWNEY',
        name: 'Downey',
        aliases: ['downey']
    },
    {
        id: '5fbb58f5-283c-4ea4-9415-04100ee6978b',
        slug: 'hollywood',
        code: 'HOLLYWOOD',
        name: 'Hollywood',
        aliases: ['hollywood']
    },
    {
        id: '3c2d8251-c43c-43b8-8306-387e0a4ed7c2',
        slug: 'santa-ana',
        code: 'SANTAANA',
        name: 'Santa Ana',
        aliases: ['santa ana']
    },
    {
        id: '47256ade-2cd4-4073-9632-84567ad9e2c8',
        slug: 'huntington-park',
        code: 'HPARK',
        name: 'Huntington Park',
        aliases: ['huntington park']
    },
    {
        id: '3a803939-eb13-4def-a1a4-462df8e90623',
        slug: 'la-puente',
        code: 'LAPUENTE',
        name: 'La Puente',
        aliases: ['la puente']
    },
    {
        id: 'e0345b1f-d6d6-40b2-bd06-5f9f4fd944e8',
        slug: 'azusa',
        code: 'AZUSA',
        name: 'Azusa',
        aliases: ['azusa']
    },
    {
        id: 'a83901db-2431-4283-834e-9502a2ba4b3b',
        slug: 'bell',
        code: 'BELL',
        name: 'Bell',
        aliases: ['bell']
    }
];

const STORE_BY_ID = new Map(CANONICAL_STORES.map((s, idx) => [s.id, { ...s, defaultIndex: idx }]));

function resolveCanonicalStore(storeId, storeName) {
    if (storeId && STORE_BY_ID.has(String(storeId).trim())) {
        return STORE_BY_ID.get(String(storeId).trim());
    }
    if (storeName && typeof storeName === 'string') {
        const norm = storeName.toLowerCase().trim();
        for (let i = 0; i < CANONICAL_STORES.length; i++) {
            const candidate = CANONICAL_STORES[i];
            if (candidate.name.toLowerCase() === norm || candidate.aliases.some(a => norm.includes(a))) {
                return { ...candidate, defaultIndex: i };
            }
        }
    }
    return null;
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

/**
 * Computes current month-to-date range and previous completed calendar month range
 * from a YYYY-MM-DD business date string.
 */
function getMonthlyDateWindows(bizDateStr) {
    const [year, month, day] = bizDateStr.split('-').map(Number);

    const currentMonthStart = `${year}-${String(month).padStart(2, '0')}-01`;
    const currentMonthEnd = bizDateStr;

    const prevMonthDate = new Date(Date.UTC(year, month - 2, 1, 12, 0, 0));
    const prevYear = prevMonthDate.getUTCFullYear();
    const prevMonth = prevMonthDate.getUTCMonth() + 1;
    const prevMonthLastDay = new Date(Date.UTC(prevYear, prevMonth, 0, 12, 0, 0)).getUTCDate();

    const prevMonthStart = `${prevYear}-${String(prevMonth).padStart(2, '0')}-01`;
    const prevMonthEnd = `${prevYear}-${String(prevMonth).padStart(2, '0')}-${String(prevMonthLastDay).padStart(2, '0')}`;

    return {
        dayOfMonth: day,
        currentMonth: {
            mode: 'current_month_mtd',
            startDate: currentMonthStart,
            endDate: currentMonthEnd
        },
        previousMonth: {
            mode: 'previous_completed_month',
            startDate: prevMonthStart,
            endDate: prevMonthEnd
        }
    };
}

/**
 * Aggregates store sales from an array of `sales_daily_cache` rows and returns
 * the 15 canonical stores sorted from highest to lowest `net_sales`.
 */
function computeRankingFromRows(rows) {
    const totalsBySlug = new Map();
    const distinctDays = new Set();

    CANONICAL_STORES.forEach((s, idx) => {
        totalsBySlug.set(s.slug, {
            slug: s.slug,
            code: s.code,
            name: s.name,
            netSales: 0,
            defaultIndex: idx
        });
    });

    if (Array.isArray(rows)) {
        for (const row of rows) {
            const store = resolveCanonicalStore(row.store_id, row.store_name);
            if (!store) continue;
            const net = Number(row.net_sales) || 0;
            const entry = totalsBySlug.get(store.slug);
            if (entry) {
                entry.netSales += net;
                if (net > 0 && row.business_date) {
                    distinctDays.add(String(row.business_date).slice(0, 10));
                }
            }
        }
    }

    const activeStoresWithSales = Array.from(totalsBySlug.values()).filter(s => s.netSales > 0).length;

    const sorted = Array.from(totalsBySlug.values()).sort((a, b) => {
        if (b.netSales !== a.netSales) {
            return b.netSales - a.netSales;
        }
        return a.defaultIndex - b.defaultIndex;
    });

    return {
        activeStoresWithSales,
        daysCounted: distinctDays.size,
        ranking: sorted.map((s, idx) => ({
            rank: idx + 1,
            slug: s.slug,
            code: s.code,
            name: s.name
        })),
        order: sorted.map(s => s.slug)
    };
}

async function fetchSalesWindow(supabaseUrl, supabaseKey, startDate, endDate) {
    const endpoint = `${supabaseUrl}/rest/v1/sales_daily_cache?select=store_id,store_name,business_date,net_sales&business_date=gte.${encodeURIComponent(startDate)}&business_date=lte.${encodeURIComponent(endDate)}&limit=2000`;
    const response = await fetch(endpoint, {
        method: 'GET',
        headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Accept': 'application/json'
        }
    });

    if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw new Error(`Supabase query failed (${response.status}): ${errText.slice(0, 160)}`);
    }

    return response.json();
}

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }

    if (req.method !== 'GET') {
        res.setHeader('Allow', ['GET', 'OPTIONS']);
        return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
    }

    // Cache at Vercel Edge CDN for 5 minutes with 10-minute stale-while-revalidate
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || 'https://ywwwdcvgfculqmcfkihq.supabase.co';
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    // Lock public requests to live business date and auto monthly window to prevent historical scraping or CDN cache-busting
    const queryMode = 'auto';
    const bizDateStr = getGavilanBusinessDate(new Date());
    const windows = getMonthlyDateWindows(bizDateStr);

    if (!supabaseKey) {
        const fallback = computeRankingFromRows([]);
        return res.status(200).json({
            ok: true,
            source: 'static_fallback',
            business_date: bizDateStr,
            period: {
                mode: 'fallback',
                start_date: windows.currentMonth.startDate,
                end_date: windows.currentMonth.endDate,
                days_counted: 0
            },
            order: fallback.order,
            ranking: fallback.ranking
        });
    }

    try {
        // Determine primary window:
        // - On Day 1 of the month (e.g. Nov 1st when Oct just closed), or when mode === 'last_month',
        //   evaluate the just-completed calendar month first.
        // - On Day 2..31 (or when mode === 'current_month'), evaluate the current month-to-date ("Este Mes")
        //   and automatically fall back to the previous completed month if the current month has < 14 stores synced.
        const preferPreviousMonthFirst = (queryMode === 'last_month') || (queryMode === 'auto' && windows.dayOfMonth === 1);

        const primaryWindow = preferPreviousMonthFirst ? windows.previousMonth : windows.currentMonth;
        const secondaryWindow = preferPreviousMonthFirst ? windows.currentMonth : windows.previousMonth;

        const primaryRows = await fetchSalesWindow(supabaseUrl, supabaseKey, primaryWindow.startDate, primaryWindow.endDate);
        let result = computeRankingFromRows(primaryRows);
        let chosenWindow = primaryWindow;

        if (result.activeStoresWithSales < 14 && queryMode === 'auto') {
            const secondaryRows = await fetchSalesWindow(supabaseUrl, supabaseKey, secondaryWindow.startDate, secondaryWindow.endDate);
            const secondaryResult = computeRankingFromRows(secondaryRows);
            if (secondaryResult.activeStoresWithSales > result.activeStoresWithSales) {
                result = secondaryResult;
                chosenWindow = secondaryWindow;
            }
        }

        return res.status(200).json({
            ok: true,
            source: 'sales_daily_cache',
            business_date: bizDateStr,
            period: {
                mode: chosenWindow.mode,
                start_date: chosenWindow.startDate,
                end_date: chosenWindow.endDate,
                days_counted: result.daysCounted
            },
            order: result.order,
            ranking: result.ranking
        });
    } catch (err) {
        console.error('[api/store-ranking] Error computing monthly store ranking:', err.message || err);
        const fallback = computeRankingFromRows([]);
        return res.status(200).json({
            ok: true,
            source: 'error_fallback',
            business_date: bizDateStr,
            period: {
                mode: 'fallback',
                start_date: windows.currentMonth.startDate,
                end_date: windows.currentMonth.endDate,
                days_counted: 0
            },
            order: fallback.order,
            ranking: fallback.ranking
        });
    }
};

// Export internal helpers for unit/runtime simulation testing
module.exports._internal = {
    CANONICAL_STORES,
    resolveCanonicalStore,
    getGavilanBusinessDate,
    getMonthlyDateWindows,
    computeRankingFromRows
};
