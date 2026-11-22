
// --- HOLIDAY RULES ENGINE (Fixed + Mobile) ---
export const checkHoliday = (d: Date) => {
    const m = d.getMonth()
    const date = d.getDate()
    const day = d.getDay()
    const year = d.getFullYear()

    // Helper: Get Nth Weekday of Month (e.g. 2nd Sunday)
    const getNthWeekday = (month: number, weekday: number, n: number) => {
        const firstDay = new Date(year, month, 1).getDay()
        const offset = (weekday - firstDay + 7) % 7
        const firstDate = 1 + offset
        return firstDate + (n - 1) * 7
    }

    // Helper: Get Last Weekday of Month (e.g. Last Monday)
    const getLastWeekday = (month: number, weekday: number) => {
        const lastDay = new Date(year, month + 1, 0)
        const lastDate = lastDay.getDate()
        const lastDayOfWeek = lastDay.getDay()
        const offset = (lastDayOfWeek - weekday + 7) % 7
        return lastDate - offset
    }

    // --- 1. FIXED DATES ---
    // Operational Rules (Closed/Hours) + Sales Factors
    if (m === 11 && date === 24) return { factor: 0.4, label: '🎅 Nochebuena (Cierre 4pm)' }
    if (m === 11 && date === 25) return { factor: 0.0, label: '🎄 Navidad (Cerrado)' }
    if (m === 11 && date === 31) return { factor: 0.4, label: '🎉 Fin de Año (Cierre 4pm)' }
    if (m === 0 && date === 1) return { factor: 0.9, label: '🌅 Año Nuevo (Abre 11am)' }
    if (m === 1 && date === 14) return { factor: 1.05, label: '💘 San Valentin' }
    if (m === 4 && date === 5) return { factor: 1.25, label: '🇲🇽 5 de Mayo' }
    if (m === 6 && date === 4) return { factor: 0.80, label: '🎆 4 de Julio' }

    // Mexican National Holidays (Validated 2024)
    if (m === 8 && date === 15) return { factor: 0.96, label: '🔔 Grito de Independencia' }
    if (m === 8 && date === 16) return { factor: 0.90, label: '🇲🇽 Día de la Independencia' }
    if (m === 9 && date === 31) return { factor: 1.15, label: '🎃 Halloween' }
    if (m === 10 && (date === 1 || date === 2)) return { factor: 1.03, label: '💀 Día de Muertos' }
    if (m === 11 && date === 12) return { factor: 1.07, label: '⛪ Virgen de Guadalupe' }

    // Fixed Mexico Mother's Day (May 10) - Priority
    if (m === 4 && date === 10) return { factor: 0.93, label: '💐 Dia de las Madres' }


    // --- 2. MOBILE DATES ---

    // Thanksgiving (4th Thu Nov) & Day After Thanksgiving / Black Friday (Abre 11am)
    if (m === 10) {
        const date4thThu = getNthWeekday(10, 4, 4)
        if (date === date4thThu) return { factor: 0.35, label: '🦃 Thanksgiving (Cierre 4pm)' }
        if (date === date4thThu + 1) return { factor: 0.78, label: '🛍️ Day After Thanksgiving (Abre 11am)' }
    }

    // Memorial Day (Last Mon May)
    if (m === 4) {
        const dateLastMon = getLastWeekday(4, 1)
        if (date === dateLastMon) return { factor: 1.15, label: '🇺🇸 Memorial Day' }
    }

    // Labor Day (1st Mon Sep)
    if (m === 8) {
        const date1stMon = getNthWeekday(8, 1, 1)
        if (date === date1stMon) return { factor: 1.19, label: '🛠️ Labor Day' }
    }

    // Fathers Day (3rd Sun Jun)
    if (m === 5) {
        const date3rdSun = getNthWeekday(5, 0, 3)
        if (date === date3rdSun) return { factor: 0.88, label: '👨 Dia del Padre' }
    }

    // Super Bowl (2nd Sun Feb) - Approx rule
    if (m === 1) {
        const date2ndSun = getNthWeekday(1, 0, 2)
        if (date === date2ndSun) return { factor: 0.85, label: '🏈 Super Bowl' }
    }

    // Good Friday (Viernes Santo)
    if (m === 2 || m === 3) {
        // Easter Algorithm
        const a = year % 19
        const b = Math.floor(year / 100)
        const c = year % 100
        const d_calc = Math.floor(b / 4)
        const e = b % 4
        const f = Math.floor((b + 8) / 25)
        const g = Math.floor((b - f + 1) / 3)
        const h = (19 * a + b - d_calc - g + 15) % 30
        const i = Math.floor(c / 4)
        const k = c % 4
        const l = (32 + 2 * e + 2 * i - h - k) % 7
        const m_calc = Math.floor((a + 11 * h + 22 * l) / 451)
        const month = Math.floor((h + l - 7 * m_calc + 114) / 31) - 1 // 0-indexed
        const dayVal = ((h + l - 7 * m_calc + 114) % 31) + 1

        const easter = new Date(year, month, dayVal)
        const goodFriday = new Date(easter)
        goodFriday.setDate(easter.getDate() - 2)

        if (m === goodFriday.getMonth() && date === goodFriday.getDate()) {
            return { factor: 0.0, label: '✝️ Viernes Santo (Cerrado)' }
        }
    }

    return { factor: 1.0, label: '' }
}
