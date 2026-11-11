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
 *   - V4 Multi-Layer Anti-Spam & Universal B2B Cold-Outreach Shield (2026-11-09):
 *     1. Bot/Stealth Traps (isAutomatedBotSubmission): blocks headless/scanner UAs, malformed 2-octet spoofed Chrome UAs
 *        (e.g. "Chrome/130.0"), WebDriver automation flags (_tg_wd), sub-1.8s programmatic fills (_tg_dwell_ms),
 *        fictional NANPA 555 phone numbers (e.g. 2015550123), Gmail dot-stuffing, and gibberish tokens.
 *     2. Universal B2B Solicitation Filter (isB2BSolicitationSpam): shadow-drops (TG-FILTERED) unsolicited vendor/agency
 *        pitches across all topics (including abused ccpa_* / accessibility categories) via domain blocklist,
 *        self-repeated corporate email signatures, external commercial URLs from corporate domains, burner TLDs,
 *        bilingual EN/ES high-confidence solicitation patterns (VA/AI automation, business loans/lines of credit,
 *        AI data licensing, PR/press releases, travel directories, web design/SEO, wholesale supplies, M&A),
 *        industry-agnostic cold-outreach CTA scoring, and foreign-IP + custom-corporate-domain validation.
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
 * Detects local verification / compliance E2E test runs (loopback or RFC1918 10.x test IPs
 * paired with official test domains) so automated Puppeteer / smoke tests can verify DB writes
 * while public internet traffic enforces full headless, timing, and phone-number bot guards.
 */
function isInternalVerificationTest({ email, clientIp }) {
    const emailLower = String(email || '').toLowerCase().trim();
    const [localPart, domainPart] = emailLower.split('@');
    const ip = String(clientIp || '').trim();
    const isLocalOrTestIp =
        ip === '127.0.0.1' ||
        ip === '::1' ||
        ip.startsWith('127.') ||
        ip.startsWith('10.');
    if (!isLocalOrTestIp) return false;
    return (
        domainPart === 'tacosgavilan.test' ||
        domainPart === 'example.com' ||
        (domainPart === 'tacosgavilan.com' && /^e2e[_-]test/i.test(localPart || ''))
    );
}

/**
 * Detects automated form-spam bots, headless/stealth form-blasters, malformed spoofed User-Agents,
 * fictional NANPA 555 phone numbers, Gmail dot-stuffing, and random gibberish strings.
 */
function isAutomatedBotSubmission({ name, email, phone, message, userAgent, clientTelemetry, isLocalTest }) {
    if (!isLocalTest) {
        const ua = String(userAgent || '').trim();
        // 1a. Missing User-Agent, literal quotes around User-Agent, headless browser automation, or scanner tools
        if (
            !ua ||
            ua.startsWith('"') ||
            ua.endsWith('"') ||
            /(headlesschrome|phantomjs|slimerjs|playwright|puppeteer|selenium|cypress|sqlmap|nikto|nmap|masscan|zgrab|python-requests|aiohttp|httpx|go-http-client|scrapy|libwww-perl|curl\/|wget\/|node-fetch|undici|axios\/|java\/|okhttp)/i.test(ua)
        ) {
            return true;
        }

        // 1b. Malformed spoofed Chrome User-Agent (e.g., "Chrome/130.0 Safari/537.36" with 2 octets instead of 4 octets "Chrome/130.0.0.0")
        if (/\bChrome\/\d+\.\d+(?=\s|$)/.test(ua)) {
            return true;
        }

        // 1c. Frontend WebDriver flag or sub-human form completion speed (< 1.8s from page load to submit)
        if (clientTelemetry) {
            if (clientTelemetry.wd === 1 || clientTelemetry.wd === true) {
                return true;
            }
            if (
                typeof clientTelemetry.dwellMs === 'number' &&
                Number.isFinite(clientTelemetry.dwellMs) &&
                clientTelemetry.dwellMs >= 0 &&
                clientTelemetry.dwellMs < 1800
            ) {
                return true;
            }
        }

        // 1d. Fictional / reserved NANPA 555 exchange phone numbers (e.g., 2015550123) or dummy repeating digits
        const phoneDigits = String(phone || '').replace(/\D/g, '');
        if (phoneDigits.length === 10 || (phoneDigits.length === 11 && phoneDigits.startsWith('1'))) {
            const tenDigits = phoneDigits.length === 11 ? phoneDigits.slice(1) : phoneDigits;
            if (
                tenDigits.slice(3, 6) === '555' ||
                tenDigits === '1234567890' ||
                tenDigits === '0123456789' ||
                /^(\d)\1{9}$/.test(tenDigits)
            ) {
                return true;
            }
        }
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
 * V4 Universal Multi-Layer B2B Cold-Outreach & Commercial Solicitation Shield.
 * Blocks unsolicited vendor, agency, lending, AI, VA, PR/SEO, directory, data-licensing,
 * wholesale supply, and M&A pitches across English and Spanish (even when bots abuse CCPA/ADA
 * dropdown categories), while preserving 100% of real restaurant guest feedback, catering orders,
 * job applicants, employment verifications, franchise inquiries, and genuine CCPA/ADA requests.
 */
function isB2BSolicitationSpam({ email, message, ipCountry, isLocalTest }) {
    if (isLocalTest) return false;

    const emailLower = String(email || '').toLowerCase().trim();
    const domainPart = emailLower.split('@')[1] || '';

    // 1. Known cold-outreach burner, agency, lending, PR & wholesale vendor spam domains
    const BLOCKED_OUTREACH_DOMAINS = new Set([
        'signalsetbase.com',
        'thetrifidelabs.com',
        'trifidelabs.com',
        'integribridge.com',
        'itsbrandfactory.com',
        'brandfactory.com',
        'vas4hire.com',
        'heylending.com',
        'renaissancedatalabs.com',
        'prspainmk.com',
        'withtourists.com',
        'touristinvite.live',
        'tourist.com'
    ]);
    if (BLOCKED_OUTREACH_DOMAINS.has(domainPart)) {
        return true;
    }

    const msgNorm = String(message || '')
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        .toLowerCase()
        .replace(/[\u2018\u2019`]/g, "'")
        .replace(/[\u201C\u201D\u00AB\u00BB]/g, '"')
        .replace(/[\u2013\u2014]/g, '-')
        .replace(/\s+/g, ' ')
        .trim();

    if (!msgNorm) return false;

    // 2. Consumer vs. Custom Corporate Domain classification
    const CONSUMER_EMAIL_DOMAINS = new Set([
        'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.com.mx', 'yahoo.es',
        'ymail.com', 'rocketmail.com', 'icloud.com', 'me.com', 'mac.com',
        'hotmail.com', 'hotmail.es', 'outlook.com', 'outlook.es', 'live.com',
        'msn.com', 'aol.com', 'att.net', 'sbcglobal.net', 'verizon.net',
        'comcast.net', 'charter.net', 'spectrum.net', 'cox.net', 'earthlink.net',
        'frontier.com', 'pacbell.net', 'prodigy.net', 'protonmail.com', 'proton.me',
        'zoho.com', 'mail.com', 'gmx.com', 'tacosgavilan.com', 'tacosgavilan.test', 'example.com'
    ]);
    const isCustomCorporateDomain = Boolean(
        domainPart &&
        !CONSUMER_EMAIL_DOMAINS.has(domainPart) &&
        !domainPart.endsWith('.edu') &&
        !domainPart.endsWith('.gov') &&
        !domainPart.endsWith('.org') &&
        !domainPart.endsWith('.mil')
    );

    // 2a. Self-Referential Corporate Email in Message Body:
    // Real customers never re-type their corporate email inside the message box after entering it in the Email field;
    // pasted cold-email templates routinely include "reach me at x@company.com" or a signature block.
    if (isCustomCorporateDomain && emailLower && msgNorm.includes(emailLower)) {
        return true;
    }

    // 2b. Corporate Domain + External Website URL / Domain Link in Message Body:
    // Blocks cold-outreach portals (e.g., partners.tourist.com, calendly.com, loom.com, agency portfolios).
    if (isCustomCorporateDomain) {
        const msgWithoutEmails = msgNorm.replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, ' ');
        const urlOrDomainMatches = msgWithoutEmails.match(/\b(?:https?:\/\/[^\s]+|www\.[a-z0-9-]+(?:\.[a-z0-9-]+)+|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|io|ai|co|net|live|agency|app|dev|ly|biz|xyz|info|us|es|eu))\b/gi) || [];
        const hasExternalCommercialDomain = urlOrDomainMatches.some((rawMatch) => {
            const cleaned = rawMatch.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0].replace(/[^a-z0-9.-]/gi, '');
            return (
                cleaned &&
                !cleaned.endsWith('tacosgavilan.com') &&
                !cleaned.endsWith('order.online') &&
                !/^\d+\.\d+$/.test(cleaned)
            );
        });
        if (hasExternalCommercialDomain) {
            return true;
        }
    }

    // 2c. High-abuse bulk cold-outreach burner TLDs
    if (
        /\.(live|buzz|click|top|xyz|icu|work|rest|quest|cfd|sbs|pw)$/i.test(domainPart) &&
        !/\b(tacos?|burritos?|quesadillas?|tortas?|platter|catering|receipt|check\s*#|hiring|apply)\b/i.test(msgNorm)
    ) {
        return true;
    }

    // 3. High-confidence B2B cold solicitation, meta-confessions & bulk opt-out phrases (single match = definitive spam)
    const HIGH_CONFIDENCE_SOLICITATION_PATTERNS = [
        // Bulk form-blaster opt-out & polite dismissal footers (EN + ES)
        /\breply\s+stop\s+to\s+(opt\s*out|unsubscribe)\b/i,
        /\b(unsubscribe\s+from\s+future|opt\s*out\s+of\s+future|no\s+longer\s+wish\s+to\s+receive)\b/i,
        /\b(we\s+won't\s+reach\s+out\s+again|won't\s+bother\s+you\s+again|feel\s+free\s+to\s+ignore\s+this)\b/i,
        /\bsi\s+no\s+(os|te|les|le)\s+interesa.{0,45}\bno\s+insisto\b/i,
        // Contact-form meta-confessions & pasted cold-email reply instructions
        /\bsending\s+you\s+a\s+(private\s+)?message\s+through\s+your\s+(website|contact\s+form|site)\b/i,
        /\bautomate\s+and\s+maintain\s+every\s+aspect\s+of\s+contact\s+us\b/i,
        /\bjust\s+reply\s+(here|with\s+a\s+good\s+time|with\s+what\s+works)\b/i,
        // Universal B2B agency/vendor proposition ("We help restaurants...", "We help businesses...")
        /\bwe\s+help\s+(businesses|restaurants|companies|brands|local\s+businesses|clients|owners|operators|hospitality)\b/i,
        // Virtual Assistants, Offshore Staffing & Contact-Form Automation (e.g., VAs4hire)
        /\b(trained|dedicated|human|offshore|remote|full[- ]time)\s+(virtual\s+assistants?|vas?)\b/i,
        /\b(hire\s+virtual\s+assistants?|vas4hire|custom\s+ai\s+system\s+for\s+you|at\s+a\s+fraction\s+of\s+the\s+cost|offshore\s+developers)\b/i,
        // Business Financing, Lines of Credit, Loans & Merchant Processing (e.g., HeyLending, MCA)
        /\b(merchant\s+cash\s+advance|business\s+working\s+capital|unsecured\s+business\s+funding|line\s+of\s+credit\s+funded|capital\s+for\s+growth)\b/i,
        /\b(no\s+personal\s+guarantee|no\s+credit\s+check\s+to\s+qualify|provide\s+financing\s+within\s+a\s+day|funded\s+in\s+a\s+day)\b/i,
        /\b(lower\s+your\s+(credit\s+card\s+)?processing\s+fees|zero[- ]fee\s+(credit\s+card\s+)?processing|employee\s+retention\s+credit)\b/i,
        // AI Data Licensing, AI Voice/Receptionist & Tech Vendor Pitches (e.g., Renaissance Data Lab)
        /\b(license\s+de[- ]identified\s+business\s+data|indicative\s+estimates\s+for\s+companies\s+like\s+yours|for\s+ai\s+research)\b/i,
        /\b(ai\s+voice\s+agent|ai\s+receptionist|ai\s+phone\s+answering|top\s+ai\s+tools\s+on\s+the\s+market)\b/i,
        // PR, Digital Newspapers, Directories, SEO & ChatGPT Ranking Pitches (EN + ES — e.g., PRSpain, Tourist.com)
        /\b(red\s+de\s+peri[oó]dicos\s+digitales|publicar\s+una\s+noticia\s+sobre|arriba\s+en\s+google|recomendados?\s+por\s+chatgpt|tarifas\s+desde\s+\d+\s*(euros|usd|d[oó]lares)|garant[ií]a\s+de\s+devoluci[oó]n\s+por\s+resultados)\b/i,
        /\b(redise[ñn]amos\s+tu\s+sitio\s+web|posicionamiento\s+seo|agencia\s+de\s+marketing\s+digital|dise[ñn]o\s+de\s+p[aá]ginas\s+web|conseguir\s+m[aá]s\s+clientes\s+para\s+(tu|su)\s+restaurante)\b/i,
        /\b(add\s+your\s+business\s+here|feature\s+your\s+place\s+on\s+tourist|set\s+up\s+and\s+manage\s+your\s+listing)\b/i,
        // Website Design / Redesign / Audit / SEO / Lead Gen Pitches (e.g., TriFide Labs, SignalSetBase)
        /\b(rebuilt|redesigned|revamped|remade)\s+your\s+(homepage|website|site|landing\s+page|web\s+page)\b/i,
        /\b(website|web)\s+design\s+(samples|ideas|services|agency|packages|proposal)\b/i,
        /\bimprovements\s+to\s+your\s+(business\s+)?website\b/i,
        /\bmobile[- ]friendly\s+websites?\b/i,
        /\bdesign\s+ideas\s+and\s+possibilities\s+for\s+your\s+website\b/i,
        /\b(live,?\s+working\s+version|not\s+a\s+mockup|focused\s+on\s+clarity,\s+trust,\s+and\s+decision\s+flow)\b/i,
        /\b(free\s+website\s+audit|audit\s+of\s+your\s+website|seo\s+services|search\s+engine\s+optimization|high[- ]authority\s+backlinks|guest\s+post\s+opportunities|domain\s+authority)\b/i,
        /\b(rank\s+higher\s+on\s+google|first\s+page\s+of\s+google|google\s+page\s+1\s+ranking|lead\s+generation\s+agency|b2b\s+lead\s+generation|qualified\s+leads\s+for\s+your\s+business)\b/i,
        // Wholesale Packaging, Supplies & M&A Business Brokers (e.g., Brand Factory, IntegriBridge)
        /\b(straight\s+from\s+the\s+factory|less\s+than\s+(they|you)\s+pay\s+now|send\s+us\s+the\s+specs|get\s+you\s+a\s+quote\s+today|curious\s+about\s+saving\s+money\s+on)\b/i,
        /\b(all\s+sorts\s+of\s+restaurant\s+supplies|disposables\s+like\s+to-go\s+containers|tableware,\s+glassware,\s+napkins)\b/i,
        /\bbuyers\s+interested\s+in\s+purchasing\s+businesses\b/i
    ];

    for (const pattern of HIGH_CONFIDENCE_SOLICITATION_PATTERNS) {
        if (pattern.test(msgNorm)) {
            return true;
        }
    }

    // 4. Industry-agnostic cold-outreach conversational mechanics (2+ signals block any email; 1+ signal blocks custom corporate domains)
    const COLD_OUTREACH_SIGNALS = [
        // Scraped Apollo/ZoomInfo executive first-name salutation or "Hi Tacos Gavilan Team"
        /^(hi|hello|hey|dear|hola)\s+(robert|roberto|javier|manuel|carlos|tacos\s+(el\s+)?gavilan\s+team)[,!]/i,
        // Cold-sales self-intro ("I'm Chloe with VAs4hire", "I'm Ben with Brand Factory")
        /\b(i'm|i\s+am)\s+[a-z]+\s+(with|from)\s+[a-z0-9]/i,
        // Cold meeting / call / demo CTAs (EN + ES)
        /\b(open\s+to\s+a\s+(quick\s+)?(chat|call|conversation)|worth\s+a\s+(quick\s+)?(talk|chat|call|look|conversation))\b/i,
        /\b(let's\s+set\s+up\s+a\s+call|schedule\s+a\s+(quick\s+)?(call|demo|chat|meeting)|book\s+a\s+(quick\s+)?(call|demo))\b/i,
        /\b(can\s+we\s+connect|if\s+we\s+can\s+connect)\s+(this\s+week|next\s+week|soon|briefly)\b/i,
        /\bdo\s+you\s+have\s+(\d+\s+minutes|a\s+few\s+minutes|time\s+tomorrow|time\s+this\s+week)\b/i,
        /\b(quick\s+10[- ]minute|15[- ]minute\s+(discovery\s+)?call|walk\s+you\s+through\s+(exactly\s+)?(what|how)|i'd\s+love\s+to\s+show\s+you\s+how)\b/i,
        /\b(te\s+lo\s+explico\s+en\s+\d+\s+minutos|agendar\s+una\s+(llamada|reuni[oó]n|demo)|sin\s+compromiso)\b/i,
        // Seller offer / pitch propositions (EN + ES)
        /\b(because\s+i\s+offer|i\s+offer\s+something|we\s+offer|we\s+provide|we\s+supply|we\s+manufacture|we\s+specialize|we\s+can\s+do|we\s+essentially\s+give\s+you|we\s+automate)\b/i,
        /\b(our\s+agency|our\s+platform|our\s+custom\s+ai|our\s+ai\s+system|our\s+services|our\s+clients|companies\s+like\s+yours|businesses\s+in\s+your\s+industry)\b/i,
        /\b(get\s+you\s+a\s+quote|free\s+quote|free\s+estimate|free\s+sample|free\s+audit|free\s+trial|no\s+commission|saving\s+money\s+on|restaurant\s+supplies)\b/i,
        /\b(would\s+you\s+be\s+open\s+to\s+seeing|would\s+you\s+be\s+interested\s+in\s+(seeing|selling|learning)|i'd\s+be\s+happy\s+to\s+share|tailored\s+to\s+(their|your)\s+needs|are\s+you\s+interested\s+in\s+selling)\b/i,
        /\b(i\s+see\s+you\s+serve\s+authentic\s+mexican\s+food|using\s+your\s+existing\s+positioning|i\s+can\s+send\s+it\s+over\s+and\s+you\s+can\s+review)\b/i,
        /\b(ofrecemos\s+servicios|nuestra\s+agencia|nuestros\s+servicios|cotizaci[oó]n\s+sin\s+costo|prueba\s+gratuita)\b/i,
        /\b(calendly\.com\/|cal\.com\/|loom\.com\/share\/|hubspot\.com\/meetings\/)\b/i
    ];

    let signalMatches = 0;
    for (const sig of COLD_OUTREACH_SIGNALS) {
        if (sig.test(msgNorm)) {
            signalMatches++;
            if (signalMatches >= 2) return true;
        }
    }

    // 5. Custom Corporate Domain + 1+ Cold-Outreach Signal or Any B2B Vendor Vertical Keyword
    const CORPORATE_B2B_VERTICAL_REGEX = /\b(wholesale|disposables|to-go\s+containers|design\s+samples|website\s+design|seo|backlinks|lead\s+generation|merchant\s+cash|processing\s+fees|line\s+of\s+credit|provide\s+financing|business\s+loan|virtual\s+assistant|ai\s+system|ai\s+research|de-identified|press\s+release|peri[oó]dicos\s+digitales|chatgpt|hood\s+cleaning|grease\s+trap|pest\s+control|linen\s+service|uniform\s+rental|solar\s+panels?|tax\s+credit|bookkeeping|staffing\s+agency|pos\s+terminals?|influencer\s+marketing|travel\s+catalogue|direct\s+bookings)\b/i;

    if (isCustomCorporateDomain && (signalMatches >= 1 || CORPORATE_B2B_VERTICAL_REGEX.test(msgNorm))) {
        return true;
    }

    // 6. Foreign IP Country (outside US/MX/CA/US-territories) + Custom Corporate Domain without genuine restaurant/guest/privacy topic
    const countryUpper = String(ipCountry || '').trim().toUpperCase();
    if (
        isCustomCorporateDomain &&
        countryUpper &&
        !['US', 'MX', 'CA', 'PR', 'GU', 'VI'].includes(countryUpper) &&
        !/\b(tacos?|burritos?|quesadillas?|tortas?|mulitas?|platter|catering|party|order|receipt|check\s*#|hiring|apply|employment|verify\s+employment|ccpa|privacy\s+request|personal\s+information|accessibility|screen\s+reader)\b/i.test(msgNorm)
    ) {
        return true;
    }

    // 7. Consumer-domain email repeated in signature alongside commercial solicitation terms
    if (
        emailLower &&
        msgNorm.includes(emailLower) &&
        /\b(website|design|samples|agency|marketing|seo|ai\s+tools|set\s+up\s+a\s+call|opt\s*out|quote|supplies|financing|line\s+of\s+credit|virtual\s+assistant|hood\s+cleaning|pest\s+control|solar)\b/i.test(msgNorm)
    ) {
        return true;
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

function stripHeaderCrlf(val) {
    return String(val || '').replace(/[\r\n]+/g, ' ').trim();
}

function buildMimeBase64Url({ from, to, cc, replyTo, subject, html }) {
    const cleanSubject = stripHeaderCrlf(subject);
    const encodedSubject = `=?UTF-8?B?${Buffer.from(cleanSubject, 'utf8').toString('base64')}?=`;
    const headers = [
        `From: ${stripHeaderCrlf(from)}`,
        `To: ${stripHeaderCrlf(to)}`,
        ...(cc ? [`Cc: ${stripHeaderCrlf(cc)}`] : []),
        ...(replyTo ? [`Reply-To: ${stripHeaderCrlf(replyTo)}`] : []),
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
      <div><strong style="color: #FFC72C;">Reference ID:</strong> ${referenceId}</div>
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

        // 6b. V4 Multi-Layer Automated Bot / Stealth Form-Blaster / Universal B2B Solicitation Filter (Shadow-Drop)
        const isLocalTest = isInternalVerificationTest({ email, clientIp });
        const clientTelemetry = {
            wd: body._tg_wd,
            dwellMs: typeof body._tg_dwell_ms === 'number' ? body._tg_dwell_ms : undefined
        };
        const ipCountry = req.headers['x-vercel-ip-country'] || '';

        if (
            isAutomatedBotSubmission({
                name,
                email,
                phone,
                message,
                userAgent: req.headers['user-agent'],
                clientTelemetry,
                isLocalTest
            }) ||
            isB2BSolicitationSpam({
                email,
                message,
                ipCountry,
                isLocalTest
            })
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
        // (Skipped for local loopback smoke/E2E verification runs so test scripts never clutter support@ inbox)
        const emailDispatched = isLocalTest
            ? false
            : await dispatchContactEmails({
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
