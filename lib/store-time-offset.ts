/**
 * @module StoreTimeOffset
 * @description Motor de cálculo de desfases horarios (time offsets) por sucursal y fecha laboral
 * para el catálogo corporativo de actividades operativas.
 *
 * @businessRules
 * 1. El catálogo base de actividades (`operating_procedures`) está calibrado con el horario base
 *    de referencia de Slauson entre semana:
 *    - Apertura al público: 10:00 AM (preparación inicia 1h antes -> 09:00 AM).
 *    - Cierre al público: 01:00 AM del día siguiente (limpieza termina 1h después -> 02:00 AM).
 * 2. Desfase de Apertura (`OPENING` / `OPENING_OFFSET` / `REGULAR_OFFSET`):
 *    - Aplica a las categorías `Apertura` y `Regular` (comparación case-insensitive).
 *    - Se calcula como: `(Hora Apertura Sucursal en Fecha) - 10:00 AM`.
 * 3. Desfase de Cierre (`CLOSING` / `CLOSING_OFFSET`):
 *    - Aplica a todo el bloque de la categoría `Cierre` (comparación case-insensitive),
 *      incluyendo tareas pre-cierre que inician antes de cerrar puertas (ej. 11:00 PM / `23:00:00`).
 *    - Se calcula normalizando horas de madrugada (`00:00` a `05:59` -> `+24h`):
 *      `(Hora Cierre Sucursal Normalizada en Fecha) - 01:00 AM (25:00)`.
 * 4. Ancla Temporal Fija (`FIXED` / `FIXED_HANDOFF` - Cambio de Turno 5:00 PM):
 *    - ÚNICAMENTE las actividades con ancla explícita `FIXED` / `FIXED_HANDOFF` (como el hito
 *      "Cambio de turno" a las `17:00:00`) permanecen fijas a las 5:00 PM en todas las tiendas.
 *    - Otras actividades operativas programadas a las `17:00:00` (ej. "Solicitar orden de liquidos
 *      a la BODEGA y la orden Viele & Sons", categoría `Regular`) usan su ancla `OPENING`
 *      y se desplazan según la apertura de la tienda (ej. `15:00:00` / `3:00 PM` en LA Central).
 * 5. Actividades sin hora (`EVENT_NO_TIME`):
 *    - Si una actividad no tiene `start_time` (`null` o vacío), NO se le inventa hora medianoche (`00:00`).
 * 6. Horarios Semanales (`stores.weekly_hours`):
 *    - Para cualquier fecha laboral (`YYYY-MM-DD`), se consulta primero `stores.weekly_hours`
 *      según el día de la semana (`0` = Domingo ... `5` = Viernes, `6` = Sábado).
 *    - Si la tienda no tiene entrada válida para ese día en `weekly_hours`, usa `opening_time`
 *      y `closing_time` generales.
 * 7. Seguridad ante Configuración Inválida:
 *    - Si las horas de apertura o cierre son `null`, vacías o mal formadas, devuelve desfase `0`
 *      y `isValidConfig: false` (nunca `-600` ni `-1500`).
 *
 * @dataFlow
 * - Consumido por: `lib/actividades-resolution.ts`, `AsignacionDiariaTab.tsx`, `ChecklistMode.tsx`,
 *   `ReportesChecklistTab.tsx`, `/api/notifications/publish-schedule` y `/api/schedule/calendar`.
 *
 * @notes
 * - Las actividades `Regular` siguen siempre el ancla `OPENING` (`REGULAR_OFFSET`), incluso en
 *   horario nocturno (9:00 PM - 5:59 AM), salvo que el procedimiento tenga un override explícito
 *   `time_anchor = 'CLOSING'`. No se convierten automáticamente en `CLOSING`.
 */

export type TimeAnchor = 'OPENING' | 'CLOSING' | 'FIXED';

export type TemporalPolicy =
    | 'OPENING_OFFSET'
    | 'REGULAR_OFFSET'
    | 'CLOSING_OFFSET'
    | 'FIXED_HANDOFF'
    | 'EVENT_NO_TIME';

export interface WeeklyHourConfig {
    day: number;
    open: string;
    close: string;
}

export type StoreDayHours = WeeklyHourConfig;

export interface StoreScheduleConfig {
    id?: number | string | null;
    external_id?: string | null;
    name?: string | null;
    opening_time?: string | null;
    closing_time?: string | null;
    weekly_hours?: WeeklyHourConfig[] | string | null;
    has_drive_thru?: boolean | null;
}

export interface StoreTimeOffsets {
    openingOffsetMinutes: number;
    closingOffsetMinutes: number;
    isValidConfig: boolean;
    effectiveOpeningTime?: string;
    effectiveClosingTime?: string;
    dayOfWeek?: number | null;
    source?: 'weekly_hours' | 'general' | 'missing';
}

export type StoreOffsets = StoreTimeOffsets;

export interface TimeOffsetOptions {
    timeAnchor?: TimeAnchor | TemporalPolicy | string | null;
    activityTitle?: string | null;
    baseTimeStr?: string | null;
    overrides?: Record<string, any> | null;
    activityId?: string | null;
}

// Referencias base del catálogo corporativo (Slauson Lunes-Jueves)
const BASE_OPENING_MINUTES = 10 * 60; // 10:00 AM = 600 min
const BASE_CLOSING_MINUTES = (1 + 24) * 60; // 01:00 AM (+1 día) = 1500 min

/**
 * Valida y convierte un string de hora ("HH:MM:SS" o "HH:MM") a minutos desde las 00:00.
 * Devuelve `null` si el valor es nulo, vacío o mal formado.
 */
export function parseTimeToMinutesStrict(timeStr: string | null | undefined): number | null {
    if (!timeStr || typeof timeStr !== 'string') return null;
    const clean = timeStr.trim();
    const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(clean);
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
    return hours * 60 + minutes;
}

/**
 * Convierte minutos del día (con soporte de cruce de medianoche) a formato "HH:MM:SS" (24h).
 */
function minutesToTimeStr(totalMinutes: number): string {
    const normalized = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;
    const hours = Math.floor(normalized / 60);
    const mins = normalized % 60;
    return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:00`;
}

/**
 * Normaliza minutos de cierre considerando que las horas entre 00:00 y 06:00 AM
 * pertenecen al cierre de la madrugada del día siguiente (+24 horas = +1440 min).
 */
function normalizeClosingMinutes(minutes: number): number {
    if (minutes <= 6 * 60) {
        return minutes + 24 * 60;
    }
    return minutes;
}

/**
 * Obtiene el día de la semana (`0` = Domingo ... `6` = Sábado) para una fecha `YYYY-MM-DD`.
 * Devuelve `null` si la fecha no tiene formato válido.
 */
export function getDayOfWeekFromDateStr(businessDateStr?: string | null): number | null {
    if (!businessDateStr || typeof businessDateStr !== 'string') return null;
    const clean = businessDateStr.trim();
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(clean);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const dt = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
    if (
        Number.isNaN(dt.getTime()) ||
        dt.getUTCFullYear() !== year ||
        dt.getUTCMonth() !== month - 1 ||
        dt.getUTCDate() !== day
    ) {
        return null;
    }
    return dt.getUTCDay();
}

/**
 * Resuelve el horario de apertura y cierre efectivo de una sucursal para una fecha laboral dada,
 * priorizando `stores.weekly_hours` por día de la semana y usando `opening_time` / `closing_time`
 * como respaldo.
 */
export function resolveStoreHoursForDate(
    store: StoreScheduleConfig | null | undefined,
    businessDateStr?: string | null
): {
    openingTime: string | null;
    closingTime: string | null;
    dayOfWeek: number | null;
    source: 'weekly_hours' | 'general' | 'missing';
} {
    if (!store) {
        return { openingTime: null, closingTime: null, dayOfWeek: null, source: 'missing' };
    }

    const dayOfWeek = getDayOfWeekFromDateStr(businessDateStr);
    let parsedWeeklyHours: WeeklyHourConfig[] | null = null;
    if (Array.isArray(store.weekly_hours)) {
        parsedWeeklyHours = store.weekly_hours;
    } else if (typeof store.weekly_hours === 'string' && store.weekly_hours.trim().startsWith('[')) {
        try {
            const parsed = JSON.parse(store.weekly_hours);
            if (Array.isArray(parsed)) parsedWeeklyHours = parsed;
        } catch {
            parsedWeeklyHours = null;
        }
    }

    if (dayOfWeek !== null && parsedWeeklyHours && parsedWeeklyHours.length > 0) {
        const dayEntry = parsedWeeklyHours.find((entry) => Number(entry?.day) === dayOfWeek);
        if (
            dayEntry &&
            parseTimeToMinutesStrict(dayEntry.open) !== null &&
            parseTimeToMinutesStrict(dayEntry.close) !== null
        ) {
            return {
                openingTime: dayEntry.open.trim(),
                closingTime: dayEntry.close.trim(),
                dayOfWeek,
                source: 'weekly_hours',
            };
        }
    }

    if (
        parseTimeToMinutesStrict(store.opening_time) !== null &&
        parseTimeToMinutesStrict(store.closing_time) !== null
    ) {
        return {
            openingTime: store.opening_time!.trim(),
            closingTime: store.closing_time!.trim(),
            dayOfWeek,
            source: 'general',
        };
    }

    return {
        openingTime: store.opening_time ?? null,
        closingTime: store.closing_time ?? null,
        dayOfWeek,
        source: 'missing',
    };
}

/**
 * Calcula los desfases de apertura y cierre en minutos a partir de strings de hora.
 * Si falta algún horario o tiene formato inválido, devuelve desfase `0` e `isValidConfig: false`.
 */
export function calculateStoreOffsets(
    openingTimeStr?: string | null,
    closingTimeStr?: string | null
): StoreTimeOffsets {
    const storeOpenMins = parseTimeToMinutesStrict(openingTimeStr);
    const storeCloseRawMins = parseTimeToMinutesStrict(closingTimeStr);

    if (storeOpenMins === null || storeCloseRawMins === null) {
        return {
            openingOffsetMinutes: 0,
            closingOffsetMinutes: 0,
            isValidConfig: false,
        };
    }

    const storeCloseMins = normalizeClosingMinutes(storeCloseRawMins);

    return {
        openingOffsetMinutes: storeOpenMins - BASE_OPENING_MINUTES,
        closingOffsetMinutes: storeCloseMins - BASE_CLOSING_MINUTES,
        isValidConfig: true,
    };
}

/**
 * Calcula los desfases horarios de una tienda para una fecha laboral específica (`YYYY-MM-DD`),
 * utilizando `weekly_hours` cuando esté disponible.
 */
export function calculateStoreOffsetsForDate(
    store: StoreScheduleConfig | null | undefined,
    businessDateStr?: string | null
): StoreTimeOffsets {
    const resolved = resolveStoreHoursForDate(store, businessDateStr);
    const baseOffsets = calculateStoreOffsets(resolved.openingTime, resolved.closingTime);
    return {
        ...baseOffsets,
        effectiveOpeningTime: resolved.openingTime || undefined,
        effectiveClosingTime: resolved.closingTime || undefined,
        dayOfWeek: resolved.dayOfWeek,
        source: resolved.source,
    };
}

/**
 * Determina el ancla temporal (`OPENING`, `CLOSING`, `FIXED`) de una actividad.
 */
export function resolveTimeAnchor(
    shiftType: string | null | undefined,
    options?: TimeOffsetOptions | null
): TimeAnchor {
    const explicitAnchor = (
        options?.timeAnchor ||
        options?.overrides?.time_anchor ||
        options?.overrides?.temporal_policy ||
        ''
    )
        .toString()
        .trim()
        .toUpperCase();

    if (explicitAnchor === 'FIXED' || explicitAnchor === 'FIXED_HANDOFF') {
        return 'FIXED';
    }
    if (explicitAnchor === 'CLOSING' || explicitAnchor === 'CLOSING_OFFSET') {
        return 'CLOSING';
    }
    if (
        explicitAnchor === 'OPENING' ||
        explicitAnchor === 'OPENING_OFFSET' ||
        explicitAnchor === 'REGULAR_OFFSET'
    ) {
        return 'OPENING';
    }

    const normalizedShiftType = (shiftType || '').toString().trim().toLowerCase();
    if (normalizedShiftType === 'fixed' || normalizedShiftType === 'fixed_handoff') {
        return 'FIXED';
    }

    // ID canónico del hito "Cambio de turno" en operating_procedures o coincidencia semántica exacta
    if (options?.activityId === 'a2b10878-d062-4686-965b-f4ef853ff584') {
        return 'FIXED';
    }

    const rawTitle = (options?.activityTitle || '')
        .toString()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase();
    if (rawTitle && /\bcambio\s+de\s+turno\b/.test(rawTitle)) {
        return 'FIXED';
    }

    if (normalizedShiftType === 'cierre' || normalizedShiftType === 'closing_offset') {
        return 'CLOSING';
    }

    // Regla aprobada: Las actividades Regular mantienen su ancla OPENING (REGULAR_OFFSET)
    // independientemente de su hora base, salvo que tengan override explícito (evaluado arriba).
    return 'OPENING';
}

/**
 * Resuelve la política temporal explícita (`OPENING_OFFSET`, `REGULAR_OFFSET`, `CLOSING_OFFSET`,
 * `FIXED_HANDOFF`, `EVENT_NO_TIME`) para trazabilidad del motor de dominio.
 */
export function resolveTemporalPolicy(
    baseTimeStr: string | null | undefined,
    shiftType: string | null | undefined,
    options?: TimeOffsetOptions | null
): TemporalPolicy {
    if (!baseTimeStr || parseTimeToMinutesStrict(baseTimeStr) === null) {
        return 'EVENT_NO_TIME';
    }
    const anchor = resolveTimeAnchor(shiftType, { ...options, baseTimeStr });
    if (anchor === 'FIXED') return 'FIXED_HANDOFF';
    if (anchor === 'CLOSING') return 'CLOSING_OFFSET';
    const cat = (shiftType || '').toString().trim().toLowerCase();
    if (cat === 'regular') return 'REGULAR_OFFSET';
    return 'OPENING_OFFSET';
}

/**
 * Aplica el desfase horario de la sucursal a la hora base de una actividad.
 *
 * @param baseTimeStr Hora base en el catálogo (ej. "09:00:00", "17:00:00", "23:30:00")
 * @param shiftType Categoría o ancla de la actividad ('Apertura' | 'Regular' | 'Cierre' | 'FIXED')
 * @param offsets Desfases calculados de la sucursal
 * @param options Metadatos opcionales (título de actividad, ancla explícita u overrides)
 * @returns Hora ajustada en formato "HH:MM:SS"
 */
export function applyTimeOffset(
    baseTimeStr: string | null | undefined,
    shiftType: string | null | undefined,
    offsets: StoreTimeOffsets | null | undefined,
    options?: TimeOffsetOptions | null
): string {
    if (!baseTimeStr) return '';
    const baseMins = parseTimeToMinutesStrict(baseTimeStr);
    if (baseMins === null) return baseTimeStr;

    if (!offsets || offsets.isValidConfig === false) {
        return minutesToTimeStr(baseMins);
    }

    const anchor = resolveTimeAnchor(shiftType, { ...options, baseTimeStr });

    // Regla de negocio: El hito de cambio de turno (FIXED, 5:00 PM) es inamovible
    if (anchor === 'FIXED') {
        return minutesToTimeStr(baseMins);
    }

    if (anchor === 'CLOSING') {
        return minutesToTimeStr(baseMins + (offsets.closingOffsetMinutes || 0));
    }

    // Por defecto (OPENING: Apertura y Regular) se desplaza según la apertura
    return minutesToTimeStr(baseMins + (offsets.openingOffsetMinutes || 0));
}

/**
 * Formatea una hora "HH:MM:SS" o "HH:MM" a formato legible de 12 horas (ej. "9:00 AM", "11:30 PM").
 */
export function formatTime12h(timeStr: string | null | undefined): string {
    if (!timeStr) return 'Sin hora';
    const mins = parseTimeToMinutesStrict(timeStr);
    if (mins === null) return timeStr;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

/**
 * Aplica el desfase horario de la sucursal y devuelve directamente el texto formateado en 12h.
 */
export function formatOffsetTime(
    baseTimeStr: string | null | undefined,
    shiftType: string | null | undefined,
    offsets: StoreTimeOffsets | null | undefined,
    options?: TimeOffsetOptions | null
): string {
    if (!baseTimeStr) return '';
    const adjusted = applyTimeOffset(baseTimeStr, shiftType, offsets, options);
    return formatTime12h(adjusted);
}
