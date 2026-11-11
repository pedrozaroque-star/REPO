/**
 * @module HolidayCalendar
 * @description Calendario maestro multianual de fechas especiales, cierres totales, cierres tempranos y aperturas tarde
 * de las 15 sucursales de Tacos Gavilan (validado contra 21,094 registros diarios de ventas por hora en Toast POS 2023–2026).
 *
 * @businessRules
 * - Solo se permiten comparativos estrictamente anteriores a la fecha proyectada; el día laboral va de 6:00 AM a 5:59 AM.
 * - **7 Fechas Oficiales Anuales con Horario Especial en las 15 Sucursales**:
 *   1. **Año Nuevo / New Year's Day (1 de enero)**: Apertura tarde a las **11:00 AM** (`lateOpenHour: 11`), cierre regular.
 *   2. **Viernes Santo / Good Friday (viernes previo a Pascua)**: **CERRADO TODO EL DÍA** (`impact: 'CLOSED'`).
 *   3. **Thanksgiving / Día de Acción de Gracias (4.º jueves de noviembre)**: Apertura regular por tienda, **cierre temprano a las 4:00 PM** (`earlyCloseHour: 16`).
 *   4. **Day After Thanksgiving / Black Friday (viernes siguiente a Thanksgiving)**: Apertura tarde a las **11:00 AM** (`lateOpenHour: 11`), cierre regular.
 *   5. **Nochebuena / Christmas Eve (24 de diciembre)**: Apertura regular por tienda, **cierre temprano a las 4:00 PM** (`earlyCloseHour: 16`).
 *   6. **Navidad / Christmas Day (25 de diciembre)**: **CERRADO TODO EL DÍA** (`impact: 'CLOSED'`).
 *   7. **Fin de Año / New Year's Eve (31 de diciembre)**: Apertura regular por tienda, **cierre temprano a las 4:00 PM** (`earlyCloseHour: 16`).
 * - Todos los demás festivos (Super Bowl, Domingo de Pascua, Cinco de Mayo, Día de las Madres, Memorial Day, Father's Day,
 *   4 de Julio, Labor Day, 15 y 16 de Septiembre, Halloween, Día de Muertos y 12 de Diciembre) operan en **horario regular**.
 *
 * @dataFlow
 * - Fecha objetivo -> pares históricos, nombre, impacto y ajustes de horario -> `lib/intelligence.ts` (Proyecciones)
 *   y `lib/phone-agent.ts` (Contestadora IA en tiempo real para las 15 sucursales, combinando overrides de `phone_special_hours`).
 *
 * @notes
 * - Incluye cálculo perpetuo astronómico/calendárico (`getOfficialStoreHolidaySchedule`) para que el sistema resuelva
 *   automáticamente Pascua/Viernes Santo, Thanksgiving, Black Friday y fiestas decembrinas en cualquier año (2023–2099)
 *   sin depender de actualizaciones manuales cada cambio de año.
 */

export interface HolidayMapping {
    name: string
    date2028?: string
    date2027?: string
    date2026: string
    date2025: string
    date2024: string
    date2023: string
    impact: 'HIGH' | 'LOW' | 'NEUTRAL' | 'CLOSED'
    earlyCloseHour?: number // 24-hour format (e.g. 16 for 4pm)
    lateOpenHour?: number // 24-hour format (e.g. 11 for 11am)
}

export interface OfficialStoreHolidayRule {
    event_date: string
    holiday_key:
        | 'new_years_day'
        | 'good_friday'
        | 'thanksgiving'
        | 'day_after_thanksgiving'
        | 'christmas_eve'
        | 'christmas_day'
        | 'new_years_eve'
    holiday_name: string
    holiday_name_es: string
    holiday_name_en: string
    is_closed: boolean
    open_time: string | null // '11:00' en aperturas tarde; null = cada sucursal abre a su hora regular
    close_time: string | null // '16:00' en cierres tempranos; null = cada sucursal cierra a su hora regular
    notes_es: string
    notes_en: string
}

// MASTER HOLIDAY DICTIONARY 2023-2028
// Sources: Toast POS Historical Sales (2023-2026), Google Calendar, TimeAndDate.com

export const HOLIDAY_CALENDAR: HolidayMapping[] = [
    // --- HIGH IMPACT (SALES SPIKES) ---
    {
        name: "Super Bowl Sunday",
        date2028: "2028-02-13",
        date2027: "2027-02-14",
        date2026: "2026-02-08",
        date2025: "2025-02-09",
        date2024: "2024-02-11", // KC vs SF
        date2023: "2023-02-12", // KC vs PHI
        impact: 'HIGH'
    },
    {
        name: "Cinco de Mayo",
        date2028: "2028-05-05",
        date2027: "2027-05-05",
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
        date2028: "2028-05-14",
        date2027: "2027-05-09",
        date2026: "2026-05-10",
        date2025: "2025-05-11",
        date2024: "2024-05-12",
        date2023: "2023-05-14",
        impact: 'HIGH'
    },
    {
        name: "Valentine's Day",
        date2028: "2028-02-14",
        date2027: "2027-02-14",
        date2026: "2026-02-14",
        date2025: "2025-02-14",
        date2024: "2024-02-14",
        date2023: "2023-02-14",
        impact: 'HIGH'
    },
    {
        name: "Víspera del Grito (Sep 15)",
        date2028: "2028-09-15",
        date2027: "2027-09-15",
        date2026: "2026-09-15",
        date2025: "2025-09-15",
        date2024: "2024-09-15",
        date2023: "2023-09-15",
        impact: 'HIGH'
    },
    {
        name: "Mexican Independence (Grito)",
        date2028: "2028-09-16",
        date2027: "2027-09-16",
        date2026: "2026-09-16",
        date2025: "2025-09-16",
        date2024: "2024-09-16",
        date2023: "2023-09-16",
        impact: 'HIGH'
    },
    {
        name: "Dia de la Virgen (Guadalupe)",
        date2028: "2028-12-12",
        date2027: "2027-12-12",
        date2026: "2026-12-12",
        date2025: "2025-12-12",
        date2024: "2024-12-12",
        date2023: "2023-12-12",
        impact: 'HIGH'
    },

    // --- FOOD PROMOS ---
    {
        name: "National Burrito Day (1st Thu April)",
        date2028: "2028-04-06",
        date2027: "2027-04-01",
        date2026: "2026-04-02",
        date2025: "2025-04-03",
        date2024: "2024-04-04",
        date2023: "2023-04-06",
        impact: 'HIGH'
    },
    {
        name: "National Taco Day (Oct 4)",
        date2028: "2028-10-04",
        date2027: "2027-10-04",
        date2026: "2026-10-04",
        date2025: "2025-10-04",
        date2024: "2024-10-04",
        date2023: "2023-10-04",
        impact: 'HIGH'
    },

    // --- HOLIDAYS (Variable Volume & Special Store Hours) ---
    {
        name: "New Year's Day",
        date2028: "2028-01-01",
        date2027: "2027-01-01",
        date2026: "2026-01-01",
        date2025: "2025-01-01",
        date2024: "2024-01-01",
        date2023: "2023-01-01",
        impact: 'NEUTRAL',
        lateOpenHour: 11 // 11am
    },
    {
        name: "Martin Luther King Day",
        date2028: "2028-01-17",
        date2027: "2027-01-18",
        date2026: "2026-01-19",
        date2025: "2025-01-20",
        date2024: "2024-01-15",
        date2023: "2023-01-16",
        impact: 'NEUTRAL'
    },
    {
        name: "Good Friday (Viernes Santo)",
        date2028: "2028-04-14",
        date2027: "2027-03-26",
        date2026: "2026-04-03",
        date2025: "2025-04-18",
        date2024: "2024-03-29",
        date2023: "2023-04-07",
        impact: 'CLOSED'
    },
    {
        name: "Easter Sunday",
        date2028: "2028-04-16",
        date2027: "2027-03-28",
        date2026: "2026-04-05",
        date2025: "2025-04-20",
        date2024: "2024-03-31",
        date2023: "2023-04-09",
        impact: 'HIGH'
    },
    {
        name: "Memorial Day",
        date2028: "2028-05-29",
        date2027: "2027-05-31",
        date2026: "2026-05-25",
        date2025: "2025-05-26",
        date2024: "2024-05-27",
        date2023: "2023-05-29",
        impact: 'HIGH'
    },
    {
        name: "Labor Day",
        date2028: "2028-09-04",
        date2027: "2027-09-06",
        date2026: "2026-09-07",
        date2025: "2025-09-01",
        date2024: "2024-09-02",
        date2023: "2023-09-04",
        impact: 'HIGH'
    },
    {
        name: "Independence Day (4th July)",
        date2028: "2028-07-04",
        date2027: "2027-07-04",
        date2026: "2026-07-04",
        date2025: "2025-07-04",
        date2024: "2024-07-04",
        date2023: "2023-07-04",
        impact: 'LOW' // Historical factor 0.80
    },
    {
        name: "Father's Day (3rd Sun June)",
        date2028: "2028-06-18",
        date2027: "2027-06-20",
        date2026: "2026-06-21",
        date2025: "2025-06-15",
        date2024: "2024-06-16",
        date2023: "2023-06-18",
        impact: 'LOW' // Historical factor 0.88
    },
    {
        name: "Halloween",
        date2028: "2028-10-31",
        date2027: "2027-10-31",
        date2026: "2026-10-31",
        date2025: "2025-10-31",
        date2024: "2024-10-31",
        date2023: "2023-10-31",
        impact: 'HIGH'
    },
    {
        name: "Día de Muertos",
        date2028: "2028-11-02",
        date2027: "2027-11-02",
        date2026: "2026-11-02",
        date2025: "2025-11-02",
        date2024: "2024-11-02",
        date2023: "2023-11-02",
        impact: 'HIGH'
    },
    {
        name: "Thanksgiving",
        date2028: "2028-11-23",
        date2027: "2027-11-25",
        date2026: "2026-11-26",
        date2025: "2025-11-27",
        date2024: "2024-11-28",
        date2023: "2023-11-23",
        impact: 'LOW',
        earlyCloseHour: 16 // 4pm
    },
    {
        name: "Day After Thanksgiving",
        date2028: "2028-11-24",
        date2027: "2027-11-26",
        date2026: "2026-11-27",
        date2025: "2025-11-28",
        date2024: "2024-11-29",
        date2023: "2023-11-24",
        impact: 'NEUTRAL',
        lateOpenHour: 11 // 11am
    },
    {
        name: "Christmas Eve",
        date2028: "2028-12-24",
        date2027: "2027-12-24",
        date2026: "2026-12-24",
        date2025: "2025-12-24",
        date2024: "2024-12-24",
        date2023: "2023-12-24",
        impact: 'LOW',
        earlyCloseHour: 16 // 4pm
    },
    {
        name: "Christmas Day",
        date2028: "2028-12-25",
        date2027: "2027-12-25",
        date2026: "2026-12-25",
        date2025: "2025-12-25",
        date2024: "2024-12-25",
        date2023: "2023-12-25",
        impact: 'CLOSED'
    },
    {
        name: "New Year's Eve",
        date2028: "2028-12-31",
        date2027: "2027-12-31",
        date2026: "2026-12-31",
        date2025: "2025-12-31",
        date2024: "2024-12-31",
        date2023: "2023-12-31",
        impact: 'LOW',
        earlyCloseHour: 16 // 4pm
    }
]

function matchesHolidayRow(h: HolidayMapping, targetDate: string): boolean {
    return (
        h.date2028 === targetDate ||
        h.date2027 === targetDate ||
        h.date2026 === targetDate ||
        h.date2025 === targetDate ||
        h.date2024 === targetDate ||
        h.date2023 === targetDate
    )
}

/**
 * Calcula Domingo de Pascua (algoritmo gregoriano exacto de Meeus/Jones/Butcher) en UTC.
 */
function computeGregorianEasterUtc(year: number): Date {
    const a = year % 19
    const b = Math.floor(year / 100)
    const c = year % 100
    const d = Math.floor(b / 4)
    const e = b % 4
    const f = Math.floor((b + 8) / 25)
    const g = Math.floor((b - f + 1) / 3)
    const h = (19 * a + b - d - g + 15) % 30
    const i = Math.floor(c / 4)
    const k = c % 4
    const l = (32 + 2 * e + 2 * i - h - k) % 7
    const m = Math.floor((a + 11 * h + 22 * l) / 451)
    const month = Math.floor((h + l - 7 * m + 114) / 31) // 3 = marzo, 4 = abril
    const day = ((h + l - 7 * m + 114) % 31) + 1
    return new Date(Date.UTC(year, month - 1, day, 12, 0, 0))
}

function computeGoodFridayDateStr(year: number): string {
    const easter = computeGregorianEasterUtc(year)
    easter.setUTCDate(easter.getUTCDate() - 2)
    return easter.toISOString().slice(0, 10)
}

/**
 * Calcula el 4.º jueves de noviembre (Thanksgiving) y el viernes inmediato posterior (Day After Thanksgiving) en UTC.
 */
function computeThanksgivingPair(year: number): { thanksgiving: string; dayAfter: string } {
    const nov1 = new Date(Date.UTC(year, 10, 1, 12, 0, 0))
    const dow = nov1.getUTCDay() // 0=Dom ... 4=Jue ... 6=Sáb
    const offsetToFirstThu = (4 - dow + 7) % 7
    const fourthThuDay = 1 + offsetToFirstThu + 21
    const thuUtc = new Date(Date.UTC(year, 10, fourthThuDay, 12, 0, 0))
    const friUtc = new Date(thuUtc.getTime())
    friUtc.setUTCDate(friUtc.getUTCDate() + 1)
    return {
        thanksgiving: thuUtc.toISOString().slice(0, 10),
        dayAfter: friUtc.toISOString().slice(0, 10)
    }
}

/**
 * Devuelve las 7 fechas oficiales con horario especial de sucursal de Tacos Gavilan para cualquier año (ej. 2023..2099).
 */
export function getOfficialStoreHolidaysForYear(year: number): OfficialStoreHolidayRule[] {
    if (!Number.isInteger(year) || year < 2020 || year > 2100) return []
    const goodFriday = computeGoodFridayDateStr(year)
    const { thanksgiving, dayAfter } = computeThanksgivingPair(year)

    const rules: OfficialStoreHolidayRule[] = [
        {
            event_date: `${year}-01-01`,
            holiday_key: 'new_years_day',
            holiday_name: "Año Nuevo / New Year's Day",
            holiday_name_es: 'Año Nuevo (1 de enero)',
            holiday_name_en: "New Year's Day (Jan 1)",
            is_closed: false,
            open_time: '11:00',
            close_time: null,
            notes_es: 'Apertura tarde a las 11:00 AM en las 15 sucursales; cierre en horario regular.',
            notes_en: 'Late opening at 11:00 AM across all 15 locations; regular closing hours.'
        },
        {
            event_date: goodFriday,
            holiday_key: 'good_friday',
            holiday_name: 'Viernes Santo / Good Friday',
            holiday_name_es: 'Viernes Santo',
            holiday_name_en: 'Good Friday',
            is_closed: true,
            open_time: null,
            close_time: null,
            notes_es: 'Cerrado todo el día en las 15 sucursales por Viernes Santo.',
            notes_en: 'Closed all day across all 15 locations for Good Friday.'
        },
        {
            event_date: thanksgiving,
            holiday_key: 'thanksgiving',
            holiday_name: 'Día de Acción de Gracias / Thanksgiving',
            holiday_name_es: 'Día de Acción de Gracias (Thanksgiving)',
            holiday_name_en: 'Thanksgiving Day',
            is_closed: false,
            open_time: null,
            close_time: '16:00',
            notes_es: 'Apertura en horario regular de cada sucursal y cierre temprano a las 4:00 PM.',
            notes_en: 'Regular morning opening per store and early closing at 4:00 PM.'
        },
        {
            event_date: dayAfter,
            holiday_key: 'day_after_thanksgiving',
            holiday_name: 'Viernes después de Thanksgiving / Black Friday',
            holiday_name_es: 'Viernes después de Acción de Gracias (Black Friday)',
            holiday_name_en: 'Day After Thanksgiving (Black Friday)',
            is_closed: false,
            open_time: '11:00',
            close_time: null,
            notes_es: 'Apertura tarde a las 11:00 AM en las 15 sucursales; cierre nocturno regular.',
            notes_en: 'Late opening at 11:00 AM across all 15 locations; regular Friday closing hours.'
        },
        {
            event_date: `${year}-12-24`,
            holiday_key: 'christmas_eve',
            holiday_name: 'Nochebuena / Christmas Eve',
            holiday_name_es: 'Nochebuena (24 de diciembre)',
            holiday_name_en: 'Christmas Eve (Dec 24)',
            is_closed: false,
            open_time: null,
            close_time: '16:00',
            notes_es: 'Apertura en horario regular de cada sucursal y cierre temprano a las 4:00 PM.',
            notes_en: 'Regular morning opening per store and early closing at 4:00 PM.'
        },
        {
            event_date: `${year}-12-25`,
            holiday_key: 'christmas_day',
            holiday_name: 'Navidad / Christmas Day',
            holiday_name_es: 'Navidad (25 de diciembre)',
            holiday_name_en: 'Christmas Day (Dec 25)',
            is_closed: true,
            open_time: null,
            close_time: null,
            notes_es: 'Cerrado todo el día en las 15 sucursales por Navidad.',
            notes_en: 'Closed all day across all 15 locations for Christmas Day.'
        },
        {
            event_date: `${year}-12-31`,
            holiday_key: 'new_years_eve',
            holiday_name: "Fin de Año / New Year's Eve",
            holiday_name_es: 'Fin de Año (31 de diciembre)',
            holiday_name_en: "New Year's Eve (Dec 31)",
            is_closed: false,
            open_time: null,
            close_time: '16:00',
            notes_es: 'Apertura en horario regular de cada sucursal y cierre temprano a las 4:00 PM.',
            notes_en: 'Regular morning opening per store and early closing at 4:00 PM.'
        }
    ]

    return rules.sort((a, b) => a.event_date.localeCompare(b.event_date))
}

/**
 * Resuelve en tiempo real si `targetDate` ("YYYY-MM-DD") corresponde a alguna de las 7 fechas anuales con horario especial.
 */
export function getOfficialStoreHolidaySchedule(targetDate: string): OfficialStoreHolidayRule | null {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) return null
    const year = Number(targetDate.slice(0, 4))
    const rules = getOfficialStoreHolidaysForYear(year)
    return rules.find((r) => r.event_date === targetDate) || null
}

/**
 * Devuelve las próximas fechas oficiales con horario especial dentro de una ventana de `daysAhead` días (por defecto 150 días).
 */
export function getUpcomingOfficialStoreHolidays(fromDateStr: string, daysAhead: number = 150): OfficialStoreHolidayRule[] {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDateStr)) return []
    const startUtc = new Date(`${fromDateStr}T12:00:00Z`)
    if (Number.isNaN(startUtc.getTime())) return []
    const endUtc = new Date(startUtc.getTime())
    endUtc.setUTCDate(endUtc.getUTCDate() + Math.max(1, daysAhead))
    const endDateStr = endUtc.toISOString().slice(0, 10)

    const startYear = Number(fromDateStr.slice(0, 4))
    const endYear = Number(endDateStr.slice(0, 4))
    const combined: OfficialStoreHolidayRule[] = []
    for (let y = startYear; y <= endYear; y++) {
        combined.push(...getOfficialStoreHolidaysForYear(y))
    }
    return combined.filter((r) => r.event_date >= fromDateStr && r.event_date <= endDateStr)
}

export function getComparativeDates(targetDate: string): string[] | null {
    const h = HOLIDAY_CALENDAR.find((row) => matchesHolidayRow(row, targetDate))
    if (h) {
        const peers = [h.date2028, h.date2027, h.date2026, h.date2025, h.date2024, h.date2023]
            .filter((date): date is string => Boolean(date && date < targetDate))
            .sort((a, b) => b.localeCompare(a))
        return peers
    }
    return null
}

export function getHolidayName(targetDate: string): string | null {
    const h = HOLIDAY_CALENDAR.find((row) => matchesHolidayRow(row, targetDate))
    if (h) return h.name
    const dynamicRule = getOfficialStoreHolidaySchedule(targetDate)
    return dynamicRule ? dynamicRule.holiday_name_en : null
}

export function getHolidayImpact(targetDate: string): string | null {
    const h = HOLIDAY_CALENDAR.find((row) => matchesHolidayRow(row, targetDate))
    if (h) return h.impact
    const dynamicRule = getOfficialStoreHolidaySchedule(targetDate)
    if (!dynamicRule) return null
    if (dynamicRule.is_closed) return 'CLOSED'
    if (dynamicRule.close_time) return 'LOW'
    return 'NEUTRAL'
}

export function getHolidayEarlyClose(targetDate: string): number | null {
    const h = HOLIDAY_CALENDAR.find((row) => matchesHolidayRow(row, targetDate))
    if (h && h.earlyCloseHour) return h.earlyCloseHour
    const dynamicRule = getOfficialStoreHolidaySchedule(targetDate)
    if (dynamicRule?.close_time) {
        const parsed = Number(dynamicRule.close_time.split(':')[0])
        return Number.isFinite(parsed) ? parsed : null
    }
    return null
}

export function getHolidayLateOpen(targetDate: string): number | null {
    const h = HOLIDAY_CALENDAR.find((row) => matchesHolidayRow(row, targetDate))
    if (h && h.lateOpenHour) return h.lateOpenHour
    const dynamicRule = getOfficialStoreHolidaySchedule(targetDate)
    if (dynamicRule?.open_time) {
        const parsed = Number(dynamicRule.open_time.split(':')[0])
        return Number.isFinite(parsed) ? parsed : null
    }
    return null
}

/**
 * Returns a numeric multiplier for holiday impact on sales.
 * HIGH = +10% boost, LOW = -20% penalty, NEUTRAL/null = no change.
 * CLOSED is handled separately (returns 0 sales).
 */
export function getHolidayMultiplier(targetDate: string): number {
    const impact = getHolidayImpact(targetDate)
    if (!impact || impact === 'NEUTRAL') return 1.0
    if (impact === 'HIGH') return 1.10
    if (impact === 'LOW') return 0.80
    if (impact === 'CLOSED') return 0.0
    return 1.0
}
