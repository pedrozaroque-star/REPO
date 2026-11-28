/**
 * @module app/planificador/lib/utils
 * @description Shared utilities for the Tacos Gavilan schedule planner: Los Angeles timezone/6:00 AM business-day helpers,
 * pure shift state reconciliation & Realtime payload reducers, non-blocking DOM toast notifications, role weighting,
 * and WhatsApp/SMS schedule text formatters.
 *
 * @businessRules
 * - Workday runs 6:00 AM to 5:59 AM next calendar day in America/Los_Angeles.
 * - Afternoon/night (PM) shift starts at 5:00 PM (17:00).
 * - Brand name is strictly Tacos Gavilan.
 *
 * @notes
 * - [2026-11-27] Added `getBusinessDateISOFromTimestamp` (fixes V8 `hour12: false` returning `"24"` at midnight `00:00`),
 *   made `getBusinessTodayISO` and `getMonday` strictly browser-timezone-independent (anchored to 12:00 PM `America/Los_Angeles`),
 *   and added pure helpers `resolveEditShiftIdsForDays`, `reconcileShiftsUpsert`, `applyRealtimeShiftPayload`, and
 *   `shiftsMatchCoreFields` so desktop/mobile state updates and Realtime `postgres_changes` (`REPLICA IDENTITY FULL`)
 *   remain deterministic without clobbering active-week edits.
 */

import { Shift } from './types'
import { formatStoreDisplayName } from '@/lib/store-display'

function showDomToast(message: string, variant: 'success' | 'error' | 'info') {
    if (typeof document === 'undefined') {
        console.log(`[Planner ${variant}]`, message)
        return
    }
    const existing = document.getElementById('teg-planner-toast')
    if (existing) existing.remove()

    const el = document.createElement('div')
    el.id = 'teg-planner-toast'
    const palette =
        variant === 'error'
            ? 'background:#dc2626;color:#ffffff;border:1px solid rgba(255,255,255,0.2);'
            : variant === 'info'
                ? 'background:#4f46e5;color:#ffffff;border:1px solid rgba(255,255,255,0.2);'
                : 'background:#0f172a;color:#ffffff;border:1px solid rgba(16,185,129,0.45);'

    el.setAttribute('role', 'status')
    el.setAttribute(
        'style',
        `position:fixed;top:68px;left:50%;transform:translateX(-50%);z-index:300;max-width:min(92vw,420px);padding:10px 16px;border-radius:9999px;font-size:12px;font-weight:700;line-height:1.35;box-shadow:0 16px 32px -8px rgba(15,23,42,0.35);cursor:pointer;display:flex;align-items:center;gap:8px;white-space:pre-line;text-align:center;${palette}`
    )
    el.textContent = message
    el.onclick = () => el.remove()
    document.body.appendChild(el)
    setTimeout(() => {
        if (el.parentNode) el.remove()
    }, 3800)
}

export const toast = {
    success: (m: string) => showDomToast(m, 'success'),
    error: (m: string) => showDomToast(m, 'error'),
    info: (m: string) => showDomToast(m, 'info')
}

const TIMEZONE = 'America/Los_Angeles';

// Helper to get parts in LA time
const getLAParts = (d: Date) => {
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: TIMEZONE,
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        weekday: 'short',
        hour: 'numeric',
        minute: 'numeric',
        hourCycle: 'h23'
    });
    const parts = formatter.formatToParts(d);
    const part = (type: string) => parts.find(p => p.type === type)?.value;
    return {
        year: parseInt(part('year') || '0'),
        month: parseInt(part('month') || '0') - 1, // 0-indexed
        day: parseInt(part('day') || '0'),
        weekday: part('weekday'), // 'Mon', 'Tue'...
        hour: parseInt(part('hour') || '0') % 24,
        minute: parseInt(part('minute') || '0')
    };
}

export const getLAHoursMinutes = (input: string | Date): { hour: number; minute: number; hhmm: string } => {
    const d = typeof input === 'string' ? new Date(input) : input;
    if (Number.isNaN(d.getTime())) return { hour: 9, minute: 0, hhmm: '09:00' };
    const { hour, minute } = getLAParts(d);
    return {
        hour,
        minute,
        hhmm: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
    };
}

export const addCalendarDaysISO = (dateStr: string, days: number): string => {
    const [y, m, d] = dateStr.split('-').map(Number);
    const utcNoon = new Date(Date.UTC(y, (m || 1) - 1, d || 1, 12, 0, 0));
    utcNoon.setUTCDate(utcNoon.getUTCDate() + days);
    return utcNoon.toISOString().slice(0, 10);
}

export const laWallClockToDate = (calendarDateStr: string, hour: number, minute: number): Date => {
    const [y, m, d] = calendarDateStr.split('-').map(Number);
    const targetUtcRef = Date.UTC(y, (m || 1) - 1, d || 1, hour, minute, 0, 0);
    let guess = targetUtcRef;
    for (let i = 0; i < 2; i++) {
        const la = getLAParts(new Date(guess));
        const laAsUtc = Date.UTC(la.year, la.month, la.day, la.hour, la.minute, 0, 0);
        guess += (targetUtcRef - laAsUtc);
    }
    return new Date(guess);
}

/**
 * Builds exact America/Los_Angeles start & end Date objects for a business date (6:00 AM -> 5:59 AM next day).
 * - Start times 00:00..05:59 belong to the next calendar morning of the same business date.
 * - End times <= start time automatically roll into the next calendar day.
 */
export const buildShiftTimestampsForBusinessDate = (
    businessDateStr: string,
    startHHMM: string,
    endHHMM: string
): { start: Date; end: Date } => {
    const [shRaw, smRaw] = (startHHMM || '09:00').split(':').map(Number);
    const [ehRaw, emRaw] = (endHHMM || '17:00').split(':').map(Number);
    const sh = Number.isFinite(shRaw) ? shRaw : 9;
    const sm = Number.isFinite(smRaw) ? smRaw : 0;
    const eh = Number.isFinite(ehRaw) ? ehRaw : 17;
    const em = Number.isFinite(emRaw) ? emRaw : 0;

    const startCalendarDate = sh < 6 ? addCalendarDaysISO(businessDateStr, 1) : businessDateStr;
    const start = laWallClockToDate(startCalendarDate, sh, sm);
    let end = laWallClockToDate(startCalendarDate, eh, em);
    if (end.getTime() <= start.getTime()) {
        end = laWallClockToDate(addCalendarDaysISO(startCalendarDate, 1), eh, em);
    }
    return { start, end };
}

/**
 * Detects whether a candidate shift [start_time, end_time) overlaps any existing shift for the same employee.
 * Back-to-back shifts (candidate start === existing end) do NOT overlap and are allowed.
 */
export const findOverlappingShift = (
    existingShifts: any[],
    candidate: {
        employee_id?: string | null;
        is_open?: boolean;
        start_time: string | Date;
        end_time: string | Date;
        excludeId?: string | null;
    }
): any | null => {
    if (candidate.is_open || !candidate.employee_id || !Array.isArray(existingShifts)) {
        return null;
    }
    const candStart = new Date(candidate.start_time).getTime();
    const candEnd = new Date(candidate.end_time).getTime();
    if (!Number.isFinite(candStart) || !Number.isFinite(candEnd) || candEnd <= candStart) {
        return null;
    }

    for (const s of existingShifts) {
        if (!s || s.is_open || !s.employee_id) continue;
        if (String(s.employee_id) !== String(candidate.employee_id)) continue;
        if (candidate.excludeId && String(s.id) === String(candidate.excludeId)) continue;

        const exStart = new Date(s.start_time).getTime();
        const exEnd = new Date(s.end_time).getTime();
        if (!Number.isFinite(exStart) || !Number.isFinite(exEnd)) continue;

        if (candStart < exEnd && candEnd > exStart) {
            return s;
        }
    }
    return null;
}

export const getBusinessDateISOFromTimestamp = (input: string | Date): string => {
    const d = typeof input === 'string' ? new Date(input) : input;
    if (Number.isNaN(d.getTime())) return formatDateISO(new Date());
    const { year, month, day, hour } = getLAParts(d);
    const calDate = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return hour < 6 ? addCalendarDaysISO(calDate, -1) : calDate;
}

export const getBusinessTodayISO = (now: Date = new Date()): string => {
    return getBusinessDateISOFromTimestamp(now);
}

const LA_WEEKDAY_TO_MONDAY_OFFSET: Record<string, number> = {
    Mon: 0,
    Tue: -1,
    Wed: -2,
    Thu: -3,
    Fri: -4,
    Sat: -5,
    Sun: -6,
};

export const getMonday = (d: Date) => {
    // Compute LA calendar date and weekday directly so result is immune to browser local timezone & DST boundaries
    const { year, month, day, weekday } = getLAParts(d);
    const calDate = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const offset = LA_WEEKDAY_TO_MONDAY_OFFSET[weekday || 'Mon'] ?? 0;
    const mondayISO = addCalendarDaysISO(calDate, offset);
    // Anchor at 12:00 PM America/Los_Angeles so formatDateISO() and addDays() never cross midnight boundaries
    return laWallClockToDate(mondayISO, 12, 0);
}

/**
 * Resolves which shift ID (if any) each selected business date should receive when saving from ShiftModal.
 * - Create Mode (`!initialData?.id`): every day gets `undefined` so 2nd/split shifts always insert cleanly.
 * - Edit Mode (`initialData?.id` present):
 *   * If the original business date is still selected, ONLY that date preserves `initialData.id` (extra days insert new copies).
 *   * If the original business date was toggled OFF (user moved the shift to another day/days), the first selected day
 *     preserves `initialData.id` so the shift is moved cleanly without leaving an orphaned copy on the old day.
 */
export const resolveEditShiftIdsForDays = (params: {
    selectedDayDates: string[];
    initialData?: { id?: string; shift_date?: string; start_time?: string } | null;
}): Array<{ dateStr: string; shiftId: string | undefined }> => {
    const { selectedDayDates, initialData } = params;
    if (!initialData?.id) {
        return selectedDayDates.map(dateStr => ({ dateStr, shiftId: undefined }));
    }

    const initialBusinessDate =
        initialData.shift_date ||
        (initialData.start_time ? getBusinessDateISOFromTimestamp(initialData.start_time) : '');

    const keepsOriginalDay = Boolean(initialBusinessDate && selectedDayDates.includes(initialBusinessDate));

    return selectedDayDates.map((dateStr, idx) => {
        if (keepsOriginalDay) {
            return { dateStr, shiftId: dateStr === initialBusinessDate ? initialData.id : undefined };
        }
        return { dateStr, shiftId: idx === 0 ? initialData.id : undefined };
    });
}

/**
 * Pure, idempotent shift-array reconciler used after optimistic saves, DB responses, drag/drop, and Realtime upserts.
 * Guarantees saved rows are never silently dropped (unlike `.map()`), deduplicates IDs, removes replaced `temp-*`
 * placeholders, and enforces active store + `[weekStartStr..weekEndStr]` boundaries.
 */
export const reconcileShiftsUpsert = (
    prev: Shift[],
    incoming: Shift[],
    options?: {
        replaceTempIds?: string[];
        activeStoreGuid?: string | null;
        weekStartStr?: string;
        weekEndStr?: string;
    }
): Shift[] => {
    const replaceSet = new Set((options?.replaceTempIds || []).map(id => String(id)));
    const next: Shift[] = prev.filter(s => !replaceSet.has(String(s.id || '')));

    for (const rawRow of incoming) {
        if (!rawRow) continue;
        const rowId = rawRow.id !== undefined && rawRow.id !== null ? String(rawRow.id) : '';
        const rowDate = rawRow.shift_date || (rawRow.start_time ? getBusinessDateISOFromTimestamp(rawRow.start_time) : '');
        const normalized: Shift = rowDate && rowDate !== rawRow.shift_date ? { ...rawRow, shift_date: rowDate } : rawRow;

        const wrongStore = Boolean(
            options?.activeStoreGuid &&
            normalized.store_id &&
            String(normalized.store_id) !== String(options.activeStoreGuid)
        );
        const outsideWeek = Boolean(
            options?.weekStartStr &&
            options?.weekEndStr &&
            (!rowDate || rowDate < options.weekStartStr || rowDate > options.weekEndStr)
        );

        if (wrongStore || outsideWeek) {
            if (rowId) {
                for (let i = next.length - 1; i >= 0; i--) {
                    if (String(next[i].id || '') === rowId) next.splice(i, 1);
                }
            }
            continue;
        }

        if (rowId) {
            let replaced = false;
            for (let i = next.length - 1; i >= 0; i--) {
                if (String(next[i].id || '') === rowId) {
                    if (!replaced) {
                        next[i] = normalized;
                        replaced = true;
                    } else {
                        next.splice(i, 1);
                    }
                }
            }
            if (!replaced) {
                next.push(normalized);
            }
        } else {
            next.push(normalized);
        }
    }

    return next;
}

/**
 * Compares core schedule fields between two shift snapshots to identify idempotent Realtime self-echoes.
 */
export const shiftsMatchCoreFields = (
    a?: Partial<Shift> | null,
    b?: Partial<Shift> | null
): boolean => {
    if (!a || !b) return false;
    const ms = (v?: string) => (v ? new Date(v).getTime() : NaN);
    const sameTime = (x?: string, y?: string) => {
        const mx = ms(x);
        const my = ms(y);
        return Number.isFinite(mx) && Number.isFinite(my) ? mx === my : (x || '') === (y || '');
    };
    return (
        String(a.id || '') === String(b.id || '') &&
        String(a.employee_id || '') === String(b.employee_id || '') &&
        String(a.job_id || '') === String(b.job_id || '') &&
        String(a.store_id || '') === String(b.store_id || '') &&
        String(a.shift_date || '') === String(b.shift_date || '') &&
        String(a.status || '') === String(b.status || '') &&
        Boolean(a.is_open) === Boolean(b.is_open) &&
        String(a.notes || '') === String(b.notes || '') &&
        sameTime(a.start_time, b.start_time) &&
        sameTime(a.end_time, b.end_time)
    );
}

/**
 * Pure reducer for Supabase Realtime `postgres_changes` events on `public.shifts` (`REPLICA IDENTITY FULL`).
 * Strictly scopes updates to the currently active `{ storeGuid, startStr, endStr }` so mutations in another week
 * never overwrite or wipe the active week's React state.
 */
export const applyRealtimeShiftPayload = (
    prev: Shift[],
    payload: { eventType?: string; new?: any; old?: any },
    activeContext: { storeGuid: string; startStr: string; endStr: string }
): {
    nextShifts: Shift[];
    changed: boolean;
    employeeIdToCheck?: string | null;
    needsFullReload?: boolean;
} => {
    const eventType = String(payload?.eventType || '').toUpperCase();
    const { storeGuid, startStr, endStr } = activeContext;
    if (!storeGuid || !startStr || !endStr) {
        return { nextShifts: prev, changed: false };
    }

    if (eventType === 'INSERT' || eventType === 'UPDATE') {
        const row = payload?.new;
        if (!row || !row.id) {
            return { nextShifts: prev, changed: false, needsFullReload: true };
        }
        if (row.store_id && String(row.store_id) !== String(storeGuid)) {
            return { nextShifts: prev, changed: false };
        }

        const rowDate = row.shift_date || (row.start_time ? getBusinessDateISOFromTimestamp(row.start_time) : '');
        const inCurrentWeek = Boolean(rowDate && rowDate >= startStr && rowDate <= endStr);
        const existsInPrev = prev.some(s => String(s.id || '') === String(row.id));

        if (!inCurrentWeek) {
            if (!existsInPrev) {
                return { nextShifts: prev, changed: false };
            }
            return {
                nextShifts: prev.filter(s => String(s.id || '') !== String(row.id)),
                changed: true,
            };
        }

        const normalizedRow: Shift = { ...row, shift_date: rowDate };
        const nextShifts = reconcileShiftsUpsert(prev, [normalizedRow], {
            activeStoreGuid: storeGuid,
            weekStartStr: startStr,
            weekEndStr: endStr,
        });

        return {
            nextShifts,
            changed: true,
            employeeIdToCheck: normalizedRow.employee_id || null,
        };
    }

    if (eventType === 'DELETE') {
        const deletedId = payload?.old?.id;
        if (!deletedId) {
            return { nextShifts: prev, changed: false, needsFullReload: true };
        }
        const existsInPrev = prev.some(s => String(s.id || '') === String(deletedId));
        if (!existsInPrev) {
            return { nextShifts: prev, changed: false };
        }
        return {
            nextShifts: prev.filter(s => String(s.id || '') !== String(deletedId)),
            changed: true,
        };
    }

    return { nextShifts: prev, changed: false };
}

export const addDays = (d: Date, days: number) => {
    const result = new Date(d);
    result.setDate(result.getDate() + days);
    return result;
}

export const formatDateISO = (d: Date) => {
    // Returns YYYY-MM-DD in Los Angeles
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(d);
};

export const formatDateNice = (input: string | Date, locale: string = 'es-US') => {
    if (!input) return '';
    let d: Date;
    if (typeof input === 'string') {
        // Assume input string YYYY-MM-DD is already "Store Day"
        // Force noon to avoid TZ shift
        d = new Date(input + 'T12:00:00');
    } else {
        d = input;
    }

    const intlLocale = locale === 'en' ? 'en-US' : locale === 'es' ? 'es-US' : locale;
    return new Intl.DateTimeFormat(intlLocale, {
        timeZone: TIMEZONE,
        day: 'numeric',
        month: 'short'
    }).format(d);
}

export const formatStoreName = (name: string) => {
    if (!name) return '';
    return formatStoreDisplayName(name.replace(/toast/gi, ''));
}

export const getDayName = (d: Date) => {
    const parts = new Intl.DateTimeFormat('es-US', {
        timeZone: TIMEZONE,
        weekday: 'short'
    }).format(d);
    return parts.toUpperCase().replace('.', '');
}

export const formatTime12h = (isoString: string) => {
    if (!isoString) return '';
    try {
        const d = new Date(isoString);
        return new Intl.DateTimeFormat('en-US', {
            timeZone: TIMEZONE,
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        }).format(d).toLowerCase().replace(' ', '');
    } catch (e) { return ''; }
}

export const stringToColor = (title: string) => {
    const t = (title || '').toLowerCase();
    // Check for Asst/Asistente FIRST before Manager to avoid "Asst Manager" being blue
    if (t.includes('asst') || t.includes('assist') || t.includes('asistente')) return '#22c55e'; // Verde
    if (t.includes('manager')) return '#3b82f6'; // Azul
    if (t.includes('shift') || t.includes('leader') || t.includes('encargado')) return '#000000'; // Negro
    if (t.includes('cashier') || t.includes('cajera')) return '#d946ef'; // Fuchsia-500 (Rosa muy claro/morado)
    if (t.includes('cook') || t.includes('cocinero') || t.includes('prep') || t.includes('preparador') || t.includes('taquero') || t.includes('tortill')) return '#ef4444'; // Red-500 (Más claro que rojo oscuro para notar contraste)

    // Fallback deterministic color
    let hash = 0;
    for (let i = 0; i < t.length; i++) {
        hash = t.charCodeAt(i) + ((hash << 5) - hash);
    }
    const c = (hash & 0x00FFFFFF).toString(16).toUpperCase();
    return '#' + '00000'.substring(0, 6 - c.length) + c;
}

export const getRoleWeight = (title: string, shifts: any[] = []) => {
    const t = (title || '').toLowerCase();

    // 1. Manager Global (Always Top, Score < 100)
    // Must exclude 'assistant' to avoid capturing 'Assistant Manager' here
    if (t.includes('manager') && !t.includes('asst') && !t.includes('assist') && !t.includes('asistente') && !t.includes('shift')) {
        return 10;
    }

    // 2. Determine Block (AM vs PM)
    // Logic: Calculate overlap with AM window (Open-17:00) vs PM window (17:00-Close)
    // Whichever has more hours determines the block.
    // Default to AM if no shifts or tie.
    let totalAmHours = 0;
    let totalPmHours = 0;

    if (shifts && shifts.length > 0) {
        shifts.forEach(s => {
            if (!s.start_time || !s.end_time) return;
            const startParts = getLAHoursMinutes(s.start_time);
            const endParts = getLAHoursMinutes(s.end_time);

            // Normalize to Tacos Gavilan business hours (6:00 AM -> 5:59 AM next day) in America/Los_Angeles
            const startH = (startParts.hour < 6 ? startParts.hour + 24 : startParts.hour) + (startParts.minute / 60);
            let endH = (endParts.hour < 6 ? endParts.hour + 24 : endParts.hour) + (endParts.minute / 60);
            if (endH < startH) endH += 24;

            // AM Window: 6:00 AM to 5:00 PM (17:00), PM Window: >= 17:00
            const amLimit = 17;

            // Overlap AM
            // Segment 1: startH to min(endH, 17)
            const overlapAm = Math.max(0, Math.min(endH, amLimit) - startH);

            // Overlap PM
            // Segment 2: max(startH, 17) to endH
            const overlapPm = Math.max(0, endH - Math.max(startH, amLimit));

            totalAmHours += overlapAm;
            totalPmHours += overlapPm;
        });
    }

    const isPM = totalPmHours > totalAmHours;

    // Base Scores: AM=1000, PM=2000
    const blockScore = isPM ? 2000 : 1000;

    // 3. Role Scores within Block
    let roleScore = 99;
    if (t.includes('asst') || t.includes('assist') || t.includes('asistente')) roleScore = 1;
    else if (t.includes('shift') || t.includes('leader') || t.includes('encargado')) roleScore = 2;
    else if (t.includes('cashier') || t.includes('cajera')) roleScore = 3;
    else if (t.includes('cook') || t.includes('cocinero') || t.includes('prep') || t.includes('preparador') || t.includes('taquero') || t.includes('tortill')) roleScore = 4;

    return blockScore + roleScore;
}

export const getJobColor = (title: string) => {
    // Deterministic color based on title for badge
    const colors = [
        'bg-red-500', 'bg-blue-500', 'bg-green-500', 'bg-purple-500',
        'bg-yellow-500', 'bg-pink-500', 'bg-indigo-500', 'bg-orange-500'
    ];
    let hash = 0;
    for (let i = 0; i < title.length; i++) hash = title.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
}

export const calculateShiftHours = (s: Shift) => {
    if (!s.start_time || !s.end_time) return 0;
    const start = new Date(s.start_time);
    const end = new Date(s.end_time);
    const diff = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
    return diff > 0 ? diff : 0;
}

export function formatPhoneForWhatsApp(phone?: string | null): string | null {
    if (!phone) return null;
    const digits = String(phone).replace(/\D/g, '');
    if (!digits) return null;
    if (digits.length === 10) return `1${digits}`;
    if (digits.length >= 11) return digits;
    return null;
}

export function buildEmployeeScheduleText(params: {
    empName: string
    storeName: string
    weekDays: Date[]
    shifts: any[]
    jobs: any[]
    shiftStats?: Record<string, any>
    weeklyHours?: number
    language?: string
}): string {
    const { empName, storeName, weekDays, shifts, jobs, shiftStats, weeklyHours, language = 'es' } = params;
    const isEn = language === 'en';
    const locale = isEn ? 'en-US' : 'es-ES';
    const cleanStore = formatStoreName(storeName || 'Tacos Gavilan');
    const weekStartLabel = weekDays[0] ? formatDateNice(weekDays[0], locale) : '';
    const weekEndLabel = weekDays[6] ? formatDateNice(weekDays[6], locale) : '';

    let computedTotal = 0;
    const lines: string[] = [
        isEn
            ? `Hi ${empName}, here is your Tacos Gavilan schedule (${cleanStore}) for ${weekStartLabel} - ${weekEndLabel}:`
            : `Hola ${empName}, tu horario en Tacos Gavilan (${cleanStore}) del ${weekStartLabel} al ${weekEndLabel}:`
    ];

    weekDays.forEach((d) => {
        const dStr = formatDateISO(d);
        const dayLabel = d.toLocaleDateString(locale, { timeZone: TIMEZONE, weekday: 'short' }).replace('.', '');
        const niceDay = `${dayLabel.charAt(0).toUpperCase() + dayLabel.slice(1)} ${d.getDate()}`;
        const dayShifts = shifts
            .filter(s => s.shift_date === dStr)
            .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
        if (dayShifts.length === 0) {
            lines.push(`• ${niceDay}: ${isEn ? 'OFF' : 'Libre'}`);
        } else {
            const parts = dayShifts.map(s => {
                const dur = Number(shiftStats?.[s.id]?.duration ?? calculateShiftHours(s)) || 0;
                computedTotal += dur;
                const jobTitle = jobs.find(j => j.id === s.job_id)?.title;
                const timeRange = `${formatTime12h(s.start_time)} - ${formatTime12h(s.end_time)}`;
                return jobTitle ? `${timeRange} (${jobTitle})` : timeRange;
            });
            lines.push(`• ${niceDay}: ${parts.join(' / ')}`);
        }
    });

    const totalToShow = typeof weeklyHours === 'number' && weeklyHours > 0 ? weeklyHours : computedTotal;
    lines.push(isEn ? `Total week: ${totalToShow.toFixed(1)} hrs` : `Total semana: ${totalToShow.toFixed(1)} hrs`);
    return lines.join('\n');
}

export function buildTeamScheduleText(params: {
    storeName: string
    weekDays: Date[]
    employees: any[]
    shifts: any[]
    language?: string
}): string {
    const { storeName, weekDays, employees, shifts, language = 'es' } = params;
    const isEn = language === 'en';
    const locale = isEn ? 'en-US' : 'es-ES';
    const cleanStore = formatStoreName(storeName || 'Tacos Gavilan');
    const weekStartLabel = weekDays[0] ? formatDateNice(weekDays[0], locale) : '';
    const weekEndLabel = weekDays[6] ? formatDateNice(weekDays[6], locale) : '';

    const lines: string[] = [
        isEn
            ? `📅 Tacos Gavilan Weekly Schedule — ${cleanStore} (${weekStartLabel} - ${weekEndLabel})`
            : `📅 Horario Semanal Tacos Gavilan — ${cleanStore} (${weekStartLabel} - ${weekEndLabel})`,
        ''
    ];

    weekDays.forEach((d) => {
        const dStr = formatDateISO(d);
        const dayHeader = d.toLocaleDateString(locale, { timeZone: TIMEZONE, weekday: 'short', month: 'short', day: 'numeric' });
        const dayShifts = shifts
            .filter(s => s.shift_date === dStr)
            .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
        lines.push(`*${dayHeader.toUpperCase()}*`);
        if (dayShifts.length === 0) {
            lines.push(isEn ? '  - No shifts scheduled' : '  - Sin turnos programados');
        } else {
            dayShifts.forEach(s => {
                const emp = employees.find(e => e.id === s.employee_id);
                const empName = emp ? `${emp.chosen_name || emp.first_name} ${emp.last_name}`.trim() : (isEn ? 'Open Shift' : 'Turno Abierto');
                lines.push(`  • ${empName}: ${formatTime12h(s.start_time)} - ${formatTime12h(s.end_time)}`);
            });
        }
    });

    return lines.join('\n');
}
