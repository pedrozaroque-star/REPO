
// lib/holidays.ts

export interface HolidayMapping {
    name: string
    date2026: string
    date2025: string
    date2024: string
    date2023: string
    impact: 'HIGH' | 'LOW' | 'NEUTRAL' | 'CLOSED'
}

// MASTER HOLIDAY DICTIONARY 2023-2026
// Sources: Google Calendar, PublicHolidays.mx, TimeAndDate.com

export const HOLIDAY_CALENDAR: HolidayMapping[] = [
    // --- HIGH IMPACT (SALES SPIKES) ---
    {
        name: "Super Bowl Sunday",
        date2026: "2026-02-08",
        date2025: "2025-02-09",
        date2024: "2024-02-11", // KC vs SF
        date2023: "2023-02-12", // KC vs PHI
        impact: 'HIGH'
    },
    {
        name: "Cinco de Mayo",
        date2026: "2026-05-05",
        date2025: "2025-05-05",
        date2024: "2024-05-05",
        date2023: "2023-05-05",
        impact: 'HIGH'
    },
    {
        name: "Mother's Day (Día de las Madres)", // US & MX Coincide often or observed same weekend
        // US Mother's Day is 2nd Sunday. MX is fixed May 10.
        // We track the US Weekend spike mainly.
        date2026: "2026-05-10",
        date2025: "2025-05-11",
        date2024: "2024-05-12",
        date2023: "2023-05-14",
        impact: 'HIGH'
    },
    {
        name: "Valentine's Day",
        date2026: "2026-02-14",
        date2025: "2025-02-14",
        date2024: "2024-02-14",
        date2023: "2023-02-14",
        impact: 'HIGH'
    },
    {
        name: "Mexican Independence (Grito)",
        date2026: "2026-09-16",
        date2025: "2025-09-16",
        date2024: "2024-09-16",
        date2023: "2023-09-16",
        impact: 'HIGH'
    },
    {
        name: "Dia de la Virgen (Guadalupe)",
        date2026: "2026-12-12",
        date2025: "2025-12-12",
        date2024: "2024-12-12",
        date2023: "2023-12-12",
        impact: 'HIGH'
    },

    // --- FOOD PROMOS ---
    {
        name: "National Burrito Day (1st Thu April)",
        date2026: "2026-04-02",
        date2025: "2025-04-03",
        date2024: "2024-04-04",
        date2023: "2023-04-06",
        impact: 'HIGH'
    },
    {
        name: "National Taco Day (Oct 4)",
        date2026: "2026-10-04",
        date2025: "2025-10-04",
        date2024: "2024-10-04",
        date2023: "2023-10-04",
        impact: 'HIGH'
    },

    // --- HOLIDAYS (Variable Volume) ---
    {
        name: "New Year's Day",
        date2026: "2026-01-01",
        date2025: "2025-01-01",
        date2024: "2024-01-01",
        date2023: "2023-01-01",
        impact: 'NEUTRAL'
    },
    {
        name: "Martin Luther King Day",
        date2026: "2026-01-19",
        date2025: "2025-01-20",
        date2024: "2024-01-15",
        date2023: "2023-01-16",
        impact: 'NEUTRAL'
    },
    {
        name: "Good Friday (Viernes Santo)",
        date2026: "2026-04-03",
        date2025: "2025-04-18",
        date2024: "2024-03-29",
        date2023: "2023-04-07",
        impact: 'CLOSED'
    },
    {
        name: "Easter Sunday",
        date2026: "2026-04-05",
        date2025: "2025-04-20",
        date2024: "2024-03-31",
        date2023: "2023-04-09",
        impact: 'HIGH'
    },
    {
        name: "Memorial Day",
        date2026: "2026-05-25",
        date2025: "2025-05-26",
        date2024: "2024-05-27",
        date2023: "2023-05-29",
        impact: 'HIGH'
    },
    {
        name: "Labor Day",
        date2026: "2026-09-07",
        date2025: "2025-09-01",
        date2024: "2024-09-02",
        date2023: "2023-09-04",
        impact: 'HIGH'
    },
    {
        name: "Independence Day (4th July)",
        date2026: "2026-07-04",
        date2025: "2025-07-04",
        date2024: "2024-07-04",
        date2023: "2023-07-04",
        impact: 'LOW' // Historical factor 0.80
    },
    {
        name: "Father's Day (3rd Sun June)",
        date2026: "2026-06-21",
        date2025: "2025-06-15",
        date2024: "2024-06-16",
        date2023: "2023-06-18",
        impact: 'LOW' // Historical factor 0.88
    },
    {
        name: "Halloween",
        date2026: "2026-10-31",
        date2025: "2025-10-31",
        date2024: "2024-10-31",
        date2023: "2023-10-31",
        impact: 'HIGH'
    },
    {
        name: "Thanksgiving",
        date2026: "2026-11-26",
        date2025: "2025-11-27",
        date2024: "2024-11-28",
        date2023: "2023-11-23",
        impact: 'LOW' // Early Close 4pm
    },
    {
        name: "Christmas Eve",
        date2026: "2026-12-24",
        date2025: "2025-12-24",
        date2024: "2024-12-24",
        date2023: "2023-12-24",
        impact: 'LOW' // Early Close 4pm
    },
    {
        name: "Christmas Day",
        date2026: "2026-12-25",
        date2025: "2025-12-25",
        date2024: "2024-12-25",
        date2023: "2023-12-25",
        impact: 'CLOSED'
    },
    {
        name: "New Year's Eve",
        date2026: "2026-12-31",
        date2025: "2025-12-31",
        date2024: "2024-12-31",
        date2023: "2023-12-31",
        impact: 'LOW' // Early Close 4pm
    }
]

export function getComparativeDates(targetDate: string): string[] | null {
    // 1. Check if targetDate is a Holiday in 2026/2025
    // Note: This logic assumes we mostly query for 2026 future dates, but needs to be year-agnostic if possible.
    // Enhanced: check if targetDate matches ANY date col in the row, then return the others.

    const h = HOLIDAY_CALENDAR.find(h =>
        h.date2026 === targetDate ||
        h.date2025 === targetDate ||
        h.date2024 === targetDate
    )

    if (h) {
        // Return historical peers
        const peers = []
        if (h.date2025 && h.date2025 !== targetDate) peers.push(h.date2025)
        if (h.date2024 && h.date2024 !== targetDate) peers.push(h.date2024)
        if (h.date2023 && h.date2023 !== targetDate) peers.push(h.date2023)
        return peers
    }

    return null
}

export function getHolidayName(targetDate: string): string | null {
    const h = HOLIDAY_CALENDAR.find(h =>
        h.date2026 === targetDate ||
        h.date2025 === targetDate ||
        h.date2024 === targetDate ||
        h.date2023 === targetDate
    )
    return h ? h.name : null
}

export function getHolidayImpact(targetDate: string): string | null {
    const h = HOLIDAY_CALENDAR.find(h =>
        h.date2026 === targetDate ||
        h.date2025 === targetDate ||
        h.date2024 === targetDate ||
        h.date2023 === targetDate
    )
    return h ? h.impact : null
}
