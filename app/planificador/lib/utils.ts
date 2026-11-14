/**
 * @module app/planificador/lib/utils
 * @description Shared utilities for the Tacos Gavilan schedule planner: Los Angeles timezone/6:00 AM business-day helpers,
 * non-blocking DOM toast notifications, role weighting, and WhatsApp/SMS schedule text formatters.
 *
 * @businessRules
 * - Workday runs 6:00 AM to 5:59 AM next calendar day in America/Los_Angeles.
 * - Afternoon/night (PM) shift starts at 5:00 PM (17:00).
 * - Brand name is strictly Tacos Gavilan.
 */

import { Shift } from './types'

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

export const getBusinessTodayISO = (now: Date = new Date()): string => {
    const { hour } = getLAParts(now);
    const todayISO = formatDateISO(now);
    if (hour < 6) {
        const yesterday = new Date(todayISO + 'T12:00:00');
        yesterday.setDate(yesterday.getDate() - 1);
        return formatDateISO(yesterday);
    }
    return todayISO;
}

export const getMonday = (d: Date) => {
    // Create a date object that represents the same wall-clock time in UTC as LA time
    // This is a common trick to do "local" math safely without complex library
    // But here we just want to find Monday based on LA day of week.

    // 1. Get current day of week in LA (0=Sun, 1=Mon...)
    const laDateString = d.toLocaleString('en-US', { timeZone: TIMEZONE });
    const laDate = new Date(laDateString);
    const day = laDate.getDay();

    // 2. Calculate diff to Monday
    const diff = laDate.getDate() - day + (day === 0 ? -6 : 1);

    // 3. Set date
    laDate.setDate(diff);
    // 4. Return as native Date (careful, this "laDate" object has browser's timezone offset but holds LA's wall clock numbers)
    // The consumer likely expects a real Date object. 
    // Best approach for Planner is usually treating Dates as "Noons" to avoid boundary jumps.
    return laDate;
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
    return name?.replace?.(/toast/i, '')?.trim() || name;
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
        const dayShifts = shifts.filter(s => s.shift_date === dStr);
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
        const dayShifts = shifts.filter(s => s.shift_date === dStr);
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
