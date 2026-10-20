/**
 * @module CalendarHelper
 * @description Utilities to generate RFC 5545 compliant iCalendar (.ics) files, signed calendar access tokens,
 * and calendar sync links for employee work shifts.
 * @businessRules
 * - Compliant with RFC 5545 standard for iOS (Apple Calendar), Android (Google Calendar / Samsung Calendar), Outlook, and webmail.
 * - Formats timestamps in UTC format (YYYYMMDDTHHmmssZ).
 * - Escapes special characters in text fields (commas, semicolons, backslashes, newlines).
 * - Embeds 1-hour and 2-hour display alarms (VALARM) so employees receive reminders prior to shift starts.
 * - Signs calendar download URLs with HMAC-SHA256 (`signCalendarAccessToken` / `verifyCalendarAccessToken`)
 *   scoped to `employeeId`, `storeId`, `startDate`, `endDate` (and optional `shiftId`) with expiration (`exp`).
 * @dataFlow
 * - Reads shift records, store locations, employee names, station assignments, and break schedules -> Generates .ics payload / signed calendar URLs.
 * @notes
 * - Uses CRLF (\r\n) line endings as strictly mandated by RFC 5545.
 */

import crypto from 'crypto';

export interface CalendarShiftItem {
    id: string | number;
    shift_date: string;
    start_time: string; // ISO date string
    end_time: string;   // ISO date string
    position_title?: string;
    tasks?: string[];
    breaks?: Array<{
        type: string;
        start_time: string;
    }>;
}

export interface CalendarStoreInfo {
    name: string;
    address?: string;
    city?: string;
    state?: string;
    zip_code?: string;
    phone?: string;
}

export interface CalendarOptions {
    store: CalendarStoreInfo;
    employeeName: string;
    shifts: CalendarShiftItem[];
    calendarName?: string;
}

export interface CalendarAccessTokenPayload {
    scope: 'calendar_download';
    employeeId: string;
    storeId: string;
    startDate?: string;
    endDate?: string;
    shiftId?: string;
    exp: number;
}

function getCalendarSigningSecret(): string | null {
    const raw =
        process.env.CALENDAR_TOKEN_SECRET ||
        process.env.SUPABASE_JWT_SECRET ||
        process.env.JWT_SECRET ||
        process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!raw || !raw.trim()) return null;
    return raw.trim().replace(/^"(.*)"$/, '$1');
}

/**
 * Genera un token firmado HMAC-SHA256 para descarga segura de calendario (.ics),
 * acotado a `employeeId`, `storeId`, `startDate`, `endDate` (o `shiftId`) y con expiración (`exp`).
 */
export function signCalendarAccessToken(
    params: {
        employeeId: string;
        storeId: string;
        startDate?: string;
        endDate?: string;
        shiftId?: string;
        expiresInSeconds?: number;
        expTimestamp?: number;
    },
    customSecret?: string
): string | null {
    const secret = customSecret || getCalendarSigningSecret();
    if (!secret) return null;

    const nowSec = Math.floor(Date.now() / 1000);
    const exp =
        params.expTimestamp !== undefined
            ? Number(params.expTimestamp)
            : nowSec + (params.expiresInSeconds ?? 45 * 24 * 60 * 60); // 45 días por defecto

    const payload: CalendarAccessTokenPayload = {
        scope: 'calendar_download',
        employeeId: String(params.employeeId).trim(),
        storeId: String(params.storeId).trim(),
        ...(params.startDate ? { startDate: String(params.startDate).trim() } : {}),
        ...(params.endDate ? { endDate: String(params.endDate).trim() } : {}),
        ...(params.shiftId ? { shiftId: String(params.shiftId).trim() } : {}),
        exp,
    };

    const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const sig = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
    return `${payloadB64}.${sig}`;
}

/**
 * Verifica un token firmado de calendario y comprueba que coincida exactamente con los
 * parámetros solicitados (`employeeId`, `storeId`, `startDate`, `endDate`, `shiftId`) y no haya expirado.
 */
export function verifyCalendarAccessToken(
    token: string | null | undefined,
    requested: {
        employeeId?: string | null;
        storeId?: string | null;
        startDate?: string | null;
        endDate?: string | null;
        shiftId?: string | null;
    },
    customSecret?: string
): { valid: boolean; reason?: string; payload?: CalendarAccessTokenPayload } {
    if (!token || typeof token !== 'string' || !token.includes('.')) {
        return { valid: false, reason: 'missing_or_malformed_token' };
    }

    const secret = customSecret || getCalendarSigningSecret();
    if (!secret) {
        return { valid: false, reason: 'server_secret_unavailable' };
    }

    const parts = token.trim().split('.');
    if (parts.length !== 2) {
        return { valid: false, reason: 'invalid_token_format' };
    }

    const [payloadB64, providedSig] = parts;
    const expectedSig = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');

    const sigBufA = Buffer.from(providedSig, 'utf8');
    const sigBufB = Buffer.from(expectedSig, 'utf8');
    if (sigBufA.length !== sigBufB.length || !crypto.timingSafeEqual(sigBufA, sigBufB)) {
        return { valid: false, reason: 'invalid_signature' };
    }

    let payload: CalendarAccessTokenPayload;
    try {
        payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    } catch {
        return { valid: false, reason: 'invalid_payload_json' };
    }

    if (!payload || payload.scope !== 'calendar_download') {
        return { valid: false, reason: 'invalid_scope' };
    }

    const nowSec = Math.floor(Date.now() / 1000);
    if (!Number.isFinite(payload.exp) || payload.exp < nowSec) {
        return { valid: false, reason: 'token_expired' };
    }

    if (!requested.employeeId || String(requested.employeeId).trim() !== payload.employeeId) {
        return { valid: false, reason: 'employee_mismatch' };
    }

    if (!requested.storeId || String(requested.storeId).trim() !== payload.storeId) {
        return { valid: false, reason: 'store_mismatch' };
    }

    if (payload.shiftId) {
        if (!requested.shiftId || String(requested.shiftId).trim() !== payload.shiftId) {
            return { valid: false, reason: 'shift_mismatch' };
        }
    } else {
        if (payload.startDate && (!requested.startDate || String(requested.startDate).trim() !== payload.startDate)) {
            return { valid: false, reason: 'start_date_mismatch' };
        }

        if (payload.endDate && (!requested.endDate || String(requested.endDate).trim() !== payload.endDate)) {
            return { valid: false, reason: 'end_date_mismatch' };
        }
    }

    return { valid: true, payload };
}

/**
 * Format a Date object to RFC 5545 UTC timestamp (YYYYMMDDTHHmmssZ).
 */
export function formatToICSDate(date: Date | string): string {
    const d = typeof date === 'string' ? new Date(date) : date;
    if (isNaN(d.getTime())) {
        return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    }
    return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/**
 * Escape text for iCalendar properties per RFC 5545 Section 3.3.11.
 */
export function escapeICSText(text: string): string {
    if (!text) return '';
    return text
        .replace(/\\/g, '\\\\')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,')
        .replace(/\r\n|\n|\r/g, '\\n');
}

/**
 * Builds a clean location string from store information.
 */
export function formatStoreLocation(store: CalendarStoreInfo): string {
    const rawName = store.name || '';
    const cleanName = rawName.startsWith('Tacos Gavilan') ? rawName : `Tacos Gavilan ${rawName}`.trim();
    const parts = [
        cleanName,
        store.address,
        store.city,
        store.state || 'CA',
        store.zip_code
    ].filter(Boolean);

    return parts.join(', ');
}

/**
 * Generates an RFC 5545 iCalendar (.ics) string for an employee's shifts.
 */
export function generateScheduleICS(options: CalendarOptions): string {
    const { store, employeeName, shifts, calendarName } = options;
    const nowUtc = formatToICSDate(new Date());
    const rawName = store.name || 'Tacos Gavilan';
    const storeDisplayName = rawName.startsWith('Tacos Gavilan') ? rawName : `Tacos Gavilan ${rawName}`.trim();
    const storeLocation = formatStoreLocation(store);
    const calTitle = calendarName || `Horario ${storeDisplayName}`;

    const lines: string[] = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Tacos Gavilan//SM-TEG Schedule//EN',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        `X-WR-CALNAME:${escapeICSText(calTitle)}`,
        'X-WR-TIMEZONE:America/Los_Angeles'
    ];

    shifts.forEach((shift) => {
        const startUtc = formatToICSDate(shift.start_time);
        const endUtc = formatToICSDate(shift.end_time);

        const startDate = new Date(shift.start_time);
        const endDate = new Date(shift.end_time);
        const startTimeStr = !isNaN(startDate.getTime())
            ? startDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Los_Angeles' })
            : '';
        const endTimeStr = !isNaN(endDate.getTime())
            ? endDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Los_Angeles' })
            : '';

        const positionDisplay = shift.position_title ? ` (${shift.position_title})` : '';
        const summary = `🌮 Turno ${storeDisplayName}${positionDisplay}`;

        // Build rich description
        const descLines: string[] = [
            `🌮 TURNO DE TRABAJO - TACOS GAVILAN`,
            `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
            `👤 Empleado: ${employeeName}`,
            `🏪 Sucursal: ${storeDisplayName}`,
            `📍 Dirección: ${storeLocation}`,
            `⏰ Horario: ${startTimeStr} - ${endTimeStr}`
        ];

        if (shift.position_title) {
            descLines.push(`👨‍🍳 Posición: ${shift.position_title}`);
        }

        if (shift.tasks && shift.tasks.length > 0) {
            descLines.push(`📋 Actividades:`);
            shift.tasks.forEach(t => descLines.push(`  • ${t}`));
        }

        if (shift.breaks && shift.breaks.length > 0) {
            descLines.push(`☕ Breaks Programados:`);
            shift.breaks.forEach(b => {
                const bDate = new Date(b.start_time);
                const bTime = !isNaN(bDate.getTime())
                    ? bDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Los_Angeles' })
                    : '';
                const bLabel = b.type === 'meal_30' ? 'Almuerzo (30m)' : 'Descanso (10m)';
                descLines.push(`  • ${bLabel}: ${bTime}`);
            });
        }

        descLines.push(`━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        descLines.push(`⚠️ Aviso: Los horarios de breaks son una guía inicial sujeta a flujo de clientes.`);
        descLines.push(`Enviado desde Sistema de Monitoreo Tacos Gavilan.`);

        const description = descLines.join('\n');
        const uid = `shift-${shift.id}-${shift.shift_date}@tacosgavilan.com`;

        lines.push('BEGIN:VEVENT');
        lines.push(`UID:${uid}`);
        lines.push(`DTSTAMP:${nowUtc}`);
        lines.push(`DTSTART:${startUtc}`);
        lines.push(`DTEND:${endUtc}`);
        lines.push(`SUMMARY:${escapeICSText(summary)}`);
        lines.push(`DESCRIPTION:${escapeICSText(description)}`);
        lines.push(`LOCATION:${escapeICSText(storeLocation)}`);
        lines.push('STATUS:CONFIRMED');
        lines.push('TRANSP:OPAQUE');
        lines.push('SEQUENCE:0');

        // Alarm 1: 1 Hour Before
        lines.push('BEGIN:VALARM');
        lines.push('TRIGGER:-PT1H');
        lines.push('ACTION:DISPLAY');
        lines.push(`DESCRIPTION:${escapeICSText(`Recordatorio: Tu turno en ${storeDisplayName} comienza en 1 hora`)}`);
        lines.push('END:VALARM');

        // Alarm 2: 2 Hours Before
        lines.push('BEGIN:VALARM');
        lines.push('TRIGGER:-PT2H');
        lines.push('ACTION:DISPLAY');
        lines.push(`DESCRIPTION:${escapeICSText(`Prepárate: Turno hoy en ${storeDisplayName} a las ${startTimeStr}`)}`);
        lines.push('END:VALARM');

        lines.push('END:VEVENT');
    });

    lines.push('END:VCALENDAR');

    // RFC 5545 strictly mandates CRLF (\r\n) line endings
    return lines.join('\r\n');
}

/**
 * Builds a direct Google Calendar Web URL for a single shift.
 */
export function buildGoogleCalendarUrl(options: {
    title: string;
    details: string;
    location: string;
    startTime: Date | string;
    endTime: Date | string;
}): string {
    const startUtc = formatToICSDate(options.startTime);
    const endUtc = formatToICSDate(options.endTime);

    const params = new URLSearchParams({
        action: 'TEMPLATE',
        text: options.title,
        dates: `${startUtc}/${endUtc}`,
        details: options.details,
        location: options.location
    });

    return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/**
 * Generates universal direct calendar download / subscription URL (with HMAC token when secret is available).
 */
export function buildCalendarApiUrl(params: {
    baseUrl?: string;
    employeeId: string;
    storeId: string;
    startDate: string;
    endDate: string;
    token?: string;
}): string {
    const base = params.baseUrl || (typeof window !== 'undefined' ? window.location.origin : 'https://tacosgavilan.vercel.app');
    const signedToken =
        params.token ||
        signCalendarAccessToken({
            employeeId: params.employeeId,
            storeId: params.storeId,
            startDate: params.startDate,
            endDate: params.endDate,
        });

    const query = new URLSearchParams({
        employee_id: params.employeeId,
        store_id: params.storeId,
        start_date: params.startDate,
        end_date: params.endDate,
        ...(signedToken ? { token: signedToken } : {}),
    });
    return `${base}/api/schedule/calendar?${query.toString()}`;
}
