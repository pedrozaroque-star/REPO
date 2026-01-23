import { Shift } from './types'

export const toast = { success: (m: string) => window.alert(m), error: (m: string) => window.alert(m), info: (m: string) => window.alert(m) }

export const getMonday = (d: Date) => {
    const date = new Date(d);
    const day = date.getDay();
    const diff = date.getDate() - day + (day === 0 ? -6 : 1);
    return new Date(date.setDate(diff));
}

export const addDays = (d: Date, days: number) => {
    const result = new Date(d);
    result.setDate(result.getDate() + days);
    return result;
}

export const formatDateISO = (d: Date) => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

export const formatDateNice = (input: string | Date) => {
    if (!input) return '';
    let d: Date;
    if (typeof input === 'string') {
        d = new Date(input + 'T12:00:00');
    } else {
        d = input;
    }
    const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    return `${d.getDate()} ${months[d.getMonth()]}`;
}

export const formatStoreName = (name: string) => {
    return name?.replace?.(/toast/i, '')?.trim() || name;
}

export const getDayName = (d: Date) => ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB'][d.getDay()];

export const formatTime12h = (isoString: string) => {
    if (!isoString) return '';
    try {
        const date = new Date(isoString);
        let hours = date.getHours();
        const minutes = date.getMinutes();
        const ampm = hours >= 12 ? 'pm' : 'am';
        hours = hours % 12;
        hours = hours ? hours : 12;
        if (minutes === 0) return `${hours}${ampm}`;
        const mStr = minutes < 10 ? '0' + minutes : minutes;
        return `${hours}:${mStr}${ampm}`;
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
