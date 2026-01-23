import { Shift } from './types'

export const toast = { success: (m: string) => window.alert(m), error: (m: string) => window.alert(m), info: (m: string) => window.alert(m) }

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
        hour12: false
    });
    const parts = formatter.formatToParts(d);
    const part = (type: string) => parts.find(p => p.type === type)?.value;
    return {
        year: parseInt(part('year') || '0'),
        month: parseInt(part('month') || '0') - 1, // 0-indexed
        day: parseInt(part('day') || '0'),
        weekday: part('weekday'), // 'Mon', 'Tue'...
        hour: parseInt(part('hour') || '0'),
        minute: parseInt(part('minute') || '0')
    };
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

export const formatDateNice = (input: string | Date) => {
    if (!input) return '';
    let d: Date;
    if (typeof input === 'string') {
        // Assume input string YYYY-MM-DD is already "Store Day"
        // Force noon to avoid TZ shift
        d = new Date(input + 'T12:00:00');
    } else {
        d = input;
    }

    return new Intl.DateTimeFormat('es-US', { // Spanish for user preference
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
    if (t.includes('cashier') || t.includes('cajera')) return '#ec4899'; // Rosa
    if (t.includes('cook') || t.includes('cocinero') || t.includes('prep') || t.includes('preparador') || t.includes('taquero') || t.includes('tortill')) return '#ef4444'; // Rojo

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
            const start = new Date(s.start_time);
            const end = new Date(s.end_time);

            // Normalize to hours (float 0-24)
            const startH = start.getHours() + (start.getMinutes() / 60);
            let endH = end.getHours() + (end.getMinutes() / 60);
            if (endH < startH) endH += 24; // Overnight shift logic

            // AM Window: 0 to 17 (5 PM)
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
