/**
 * @module ActividadesResolution
 * @description Motor compartido de resolución de actividades operativas, turnos, estaciones,
 * frecuencias, reconciliación de snapshots legacy y horarios efectivos por sucursal y fecha laboral.
 *
 * @businessRules
 * 1. Jornada Laboral: Inicia a las 6:00 AM (`360` min) y termina a las 5:59 AM del día siguiente
 *    (`1799` min) en zona horaria `America/Los_Angeles`.
 * 2. Ventanas de Turno Semiabiertas (`[start, end)` con precisión de minutos):
 *    - Turno AM: `[06:00, 17:00)` -> `[360, 1020)` (incluyendo apertura temprana `05:00–05:59 AM` -> `[300, 1020)`).
 *    - Turno PM: `[17:00, 06:00 +1d)` -> `[1020, 1800)`.
 *    - Regla explícita de apertura temprana 05:00–05:59 AM: Si un turno inicia entre las 05:00 y 05:59 AM
 *      y termina el mismo día (`>= 06:00 AM`, ej. `05:00–13:30` o `05:00–18:00`), su inicio operativo
 *      se ancla en `300..359` min (mañana del mismo día) y su fin en `endHour * 60 + endMin`,
 *      permitiendo que `05:00–18:00` traslape tanto con AM como con PM sin desaparecer de PM.
 * 3. Normalización de Texto con Preservación de Letras Base (`normalizeText`):
 *    - Usa descomposición Unicode `NFD` para quitar tildes sin eliminar la letra base
 *      (ej. `"Caja 1 / Salón"` -> `"caja1salon"`, `"Miércoles"` -> `"miercoles"`).
 * 4. Frecuencia por Fecha Laboral (`isFreqMatch`):
 *    - Evalúa frecuencias diarias, semanales (`Lunes`..`Domingo`, con/sin acentos y espacios),
 *      mensuales (`Mensual`, `Día 1`, `Día 15`) y fechas específicas (`YYYY-MM-DD`).
 * 5. Modelo de Tienda (`stores.has_drive_thru`) y Bandera de Piloto (`isStorePilotActiveForActivitiesEmail`):
 *    - Filtra actividades `DRIVE_THRU`/`DT` vs `REGULAR`/`NO_DT` usando exclusivamente `stores.has_drive_thru`.
 *    - Soporta técnicamente las 15 sucursales; la activación operativa del bloque de actividades en correos
 *      reales se controla por configuración (`ACTIVIDADES_EMAIL_ENABLED_STORES`, por defecto solo Slauson).
 * 6. Deduplicación por Identidad de Ocurrencia y Orden Cronológico de Jornada:
 *    - Si dos estaciones comparten la misma actividad en el mismo horario/tramo, se deduplica en una
 *      sola entrada conservando ambas estaciones en `source_stations`.
 *    - Si existen dos ocurrencias legítimas en horarios distintos, ambas se conservan.
 *    - El ordenamiento cronológico respeta la jornada laboral `06:00` -> `23:59` -> `00:00` -> `05:59`
 *      (`sort_minutes`), dejando actividades sin hora (`EVENT_NO_TIME`) al final sin inventarles `00:00`.
 * 7. Exclusividad de Ausente / Callback (`is_callback === true`):
 *    - Si un turno es `is_callback`, es mutuamente excluyente con actividades operativas.
 */

import {
    applyTimeOffset,
    calculateStoreOffsetsForDate,
    formatTime12h,
    parseTimeToMinutesStrict,
    resolveTemporalPolicy,
    resolveTimeAnchor,
    StoreScheduleConfig,
    StoreTimeOffsets,
    TemporalPolicy,
    TimeAnchor,
} from './store-time-offset';

export interface ProcedureStoreOverride {
    enabled?: boolean;
    disabled?: boolean;
    activity?: string;
    description?: string;
    start_time?: string;
    duration_minutes?: number;
    shift_type?: string;
    frequency?: string;
    role?: string;
    store_model?: string;
}

export interface CatalogProcedureRecord {
    id: string;
    activity?: string;
    description?: string | null;
    shift_type?: string | null;
    shift?: string | null;
    start_time?: string | null;
    end_time?: string | null;
    duration_minutes?: number | null;
    frequency?: string | null;
    store_model?: string | null;
    order_index?: number | null;
    is_critical?: boolean | null;
    requires_photo?: boolean | null;
    role?: string | null;
    overrides?: Record<string, any> | null;
}

export interface PositionActivityMappingRecord {
    id?: string;
    position_key?: string;
    position_name?: string;
    activity_id: string;
    shift?: string | null;
    frequency?: string | null;
    store_model?: string | null;
    sort_order?: number | null;
}

export type ActivityOriginSource =
    | 'catalog_mapping'
    | 'legacy_catalog_task'
    | 'manual_task'
    | 'legacy_snapshot';

export interface ResolvedActivityItem {
    activity_id: string;
    occurrence_key: string;
    title: string;
    description: string;
    category: string;
    shift: string;
    base_start_time: string | null;
    effective_start_time: string | null;
    formatted_time: string;
    relative_day_offset: 0 | 1;
    duration_minutes: number | null;
    frequency: string;
    inclusion_reason: string;
    store_model: string;
    time_anchor: TimeAnchor;
    temporal_policy: TemporalPolicy;
    order_index: number;
    is_critical: boolean;
    requires_photo: boolean;
    origin: ActivityOriginSource;
    is_manual_or_legacy: boolean;
    needs_review: boolean;
    config_version: string;
    source_stations: string[];
    sort_minutes: number;
}

export type StationMappingDisposition =
    | 'configured'
    | 'break_coverage_inherits_target'
    | 'pending_operational_decision'
    | 'manual_extra_slot';

export interface CanonicalStationDefinition {
    station: string;
    group: 'front' | 'kitchen' | 'drive-thru' | 'leadership' | 'extras';
    sectionId: 'front' | 'kitchen' | 'drivethru' | 'leadership' | 'extras';
    mainStation: string;
    subPosition: string;
    positionKey: string;
    label: string;
    displayLabel: string;
    storeModel: 'AMBOS' | 'REGULAR' | 'DRIVE_THRU';
    isLeadership: boolean;
    isExtra: boolean;
    defaultDisposition: StationMappingDisposition;
    dispositionReason: string;
}

function makeStationDef(params: {
    station: string;
    group: 'front' | 'kitchen' | 'drive-thru' | 'leadership' | 'extras';
    label: string;
    storeModel?: 'AMBOS' | 'REGULAR' | 'DRIVE_THRU';
    isLeadership?: boolean;
    isExtra?: boolean;
    defaultDisposition: StationMappingDisposition;
    dispositionReason: string;
}): CanonicalStationDefinition {
    const sectionId = params.group === 'drive-thru' ? 'drivethru' : params.group;
    return {
        station: params.station,
        group: params.group,
        sectionId,
        mainStation: params.station,
        subPosition: '',
        positionKey: params.station,
        label: params.label,
        displayLabel: params.label,
        storeModel: params.storeModel || 'AMBOS',
        isLeadership: Boolean(params.isLeadership),
        isExtra: Boolean(params.isExtra),
        defaultDisposition: params.defaultDisposition,
        dispositionReason: params.dispositionReason,
    };
}

/**
 * Catálogo único canónico de las 31 estaciones operativas del sistema (A21, A22),
 * alineado con `station_assignments.main_station` y `position_activities.position_key` en Supabase.
 */
export const CANONICAL_STATIONS_CATALOG: CanonicalStationDefinition[] = [
    // SALÓN / SERVICIO (7)
    makeStationDef({
        station: 'Caja 1 / Salón',
        group: 'front',
        label: 'Caja 1 / Salón',
        defaultDisposition: 'configured',
        dispositionReason: 'Estación principal de caja configurada en position_activities.',
    }),
    makeStationDef({
        station: 'Caja 2',
        group: 'front',
        label: 'Caja 2',
        defaultDisposition: 'configured',
        dispositionReason: 'Segunda estación de caja configurada en position_activities.',
    }),
    makeStationDef({
        station: 'Caja 3',
        group: 'front',
        label: 'Caja 3',
        defaultDisposition: 'pending_operational_decision',
        dispositionReason: 'Caja de apoyo en horas pico; sin actividades fijas configuradas (pendiente decisión operativa).',
    }),
    makeStationDef({
        station: 'Uber + Salsas',
        group: 'front',
        label: 'Uber + Salsas',
        defaultDisposition: 'configured',
        dispositionReason: 'Configurada en position_activities.',
    }),
    makeStationDef({
        station: 'ENTREGA',
        group: 'front',
        label: 'Entrega',
        defaultDisposition: 'configured',
        dispositionReason: 'Configurada en position_activities.',
    }),
    makeStationDef({
        station: 'LIMPIEZA',
        group: 'front',
        label: 'Limpieza',
        defaultDisposition: 'configured',
        dispositionReason: 'Configurada en position_activities.',
    }),
    makeStationDef({
        station: 'CUBRIR DESCANSOS (SALÓN)',
        group: 'front',
        label: 'Cubrir Descansos (Salón)',
        defaultDisposition: 'break_coverage_inherits_target',
        dispositionReason: 'Puesto comodín para relevo de descansos en salón; deliberadamente sin checklist propio.',
    }),

    // COCINA (8 + 6 ACTIVIDADES EXTRA = 14)
    makeStationDef({
        station: 'TACOS',
        group: 'kitchen',
        label: 'Tacos',
        defaultDisposition: 'configured',
        dispositionReason: 'Configurada en position_activities.',
    }),
    makeStationDef({
        station: 'CARNES',
        group: 'kitchen',
        label: 'Carnes',
        defaultDisposition: 'configured',
        dispositionReason: 'Configurada en position_activities.',
    }),
    makeStationDef({
        station: 'BURRITOS',
        group: 'kitchen',
        label: 'Burritos',
        defaultDisposition: 'configured',
        dispositionReason: 'Configurada en position_activities.',
    }),
    makeStationDef({
        station: 'TORTILLAS',
        group: 'kitchen',
        label: 'Tortillas',
        defaultDisposition: 'pending_operational_decision',
        dispositionReason: 'Estación operativa sin mapeos propios en position_activities; pendiente de decisión operativa.',
    }),
    makeStationDef({
        station: 'TORTAS/QUESADILLAS',
        group: 'kitchen',
        label: 'Tortas / Quesadillas',
        defaultDisposition: 'configured',
        dispositionReason: 'Configurada en position_activities.',
    }),
    makeStationDef({
        station: 'TORTAS/MULITAS',
        group: 'kitchen',
        label: 'Tortas / Mulitas',
        defaultDisposition: 'pending_operational_decision',
        dispositionReason: 'Estación operativa sin mapeos propios en position_activities; pendiente de decisión operativa.',
    }),
    makeStationDef({
        station: 'CUBRIR DESCANSOS (COCINA)',
        group: 'kitchen',
        label: 'Cubrir Descansos (Cocina)',
        defaultDisposition: 'configured',
        dispositionReason: 'Configurada en position_activities.',
    }),
    makeStationDef({
        station: 'PREPARACION',
        group: 'kitchen',
        label: 'Preparación',
        defaultDisposition: 'configured',
        dispositionReason: 'Configurada en position_activities.',
    }),
    ...[1, 2, 3, 4, 5, 6].map((num) =>
        makeStationDef({
            station: `ACTIVIDADES EXTRA ${num}`,
            group: 'extras',
            label: `Extra ${num}`,
            isExtra: true,
            defaultDisposition: 'manual_extra_slot',
            dispositionReason: 'Slot de actividades extra / apoyo específico por turno.',
        })
    ),

    // DRIVE-THRU (6)
    makeStationDef({
        station: 'Ventana 1',
        group: 'drive-thru',
        label: 'Ventanilla 1',
        storeModel: 'DRIVE_THRU',
        defaultDisposition: 'pending_operational_decision',
        dispositionReason: 'Estación DT sin actividades configuradas en position_activities; pendiente de decisión operativa.',
    }),
    makeStationDef({
        station: 'Ventana 2',
        group: 'drive-thru',
        label: 'Ventanilla 2',
        storeModel: 'DRIVE_THRU',
        defaultDisposition: 'pending_operational_decision',
        dispositionReason: 'Estación DT sin actividades configuradas en position_activities; pendiente de decisión operativa.',
    }),
    makeStationDef({
        station: 'Ventana 2 (B)',
        group: 'drive-thru',
        label: 'Ventanilla 2 (B)',
        storeModel: 'DRIVE_THRU',
        defaultDisposition: 'pending_operational_decision',
        dispositionReason: 'Ventanilla DT de apoyo en hora pico; sin checklist fijo configurado.',
    }),
    makeStationDef({
        station: 'TORTAS/QUESADILLAS (DT)',
        group: 'drive-thru',
        label: 'Tortas / Quesadillas (DT)',
        storeModel: 'DRIVE_THRU',
        defaultDisposition: 'pending_operational_decision',
        dispositionReason: 'Estación de línea DT sin actividades configuradas en position_activities.',
    }),
    makeStationDef({
        station: 'TACOS/BURRITOS (DT)',
        group: 'drive-thru',
        label: 'Tacos / Burritos (DT)',
        storeModel: 'DRIVE_THRU',
        defaultDisposition: 'pending_operational_decision',
        dispositionReason: 'Estación de línea DT sin actividades configuradas en position_activities.',
    }),
    makeStationDef({
        station: 'CUBRIR DESCANSOS (DT)',
        group: 'drive-thru',
        label: 'Cubrir Descansos (DT)',
        storeModel: 'DRIVE_THRU',
        defaultDisposition: 'break_coverage_inherits_target',
        dispositionReason: 'Puesto comodín para relevo de descansos en Drive-Thru; deliberadamente sin checklist propio.',
    }),

    // LIDERAZGO (4)
    makeStationDef({
        station: 'MANAGER',
        group: 'leadership',
        label: 'Manager',
        isLeadership: true,
        defaultDisposition: 'configured',
        dispositionReason: 'Configurada en position_activities.',
    }),
    makeStationDef({
        station: 'ASSISTANT',
        group: 'leadership',
        label: 'Asistente',
        isLeadership: true,
        defaultDisposition: 'configured',
        dispositionReason: 'Configurada en position_activities.',
    }),
    makeStationDef({
        station: 'SHIFT_LEADER_MALE',
        group: 'leadership',
        label: 'Shift Leader (M)',
        isLeadership: true,
        defaultDisposition: 'configured',
        dispositionReason: 'Configurada en position_activities.',
    }),
    makeStationDef({
        station: 'SHIFT_LEADER_FEMALE',
        group: 'leadership',
        label: 'Shift Leader (F)',
        isLeadership: true,
        defaultDisposition: 'configured',
        dispositionReason: 'Configurada en position_activities.',
    }),
];

/**
 * Mapa bidireccional de alias de estaciones para garantizar compatibilidad total
 * entre etiquetas de UI, nombres históricos y llaves de `position_activities`.
 */
const STATION_EQUIVALENCE_GROUPS: string[][] = [
    ['Caja 1 / Salón', 'Caja 1 / Salon', 'CAJERO 1', 'Caja 1', 'CAJERO|Caja 1', 'CASHIER'],
    ['Caja 2', 'CAJERO 2', 'CAJERO|Caja 2'],
    ['Caja 3', 'CAJERO 3', 'CAJERO|Caja 3'],
    ['Uber + Salsas', 'UBER + SALSA', 'UBER + SALSAS', 'SALSA BAR Y COMEDOR'],
    ['CUBRIR DESCANSOS (SALÓN)', 'CUBRIR DESCANSOS (SALON)'],
    ['TORTILLAS', 'TORTILLERA'],
    ['TORTAS/QUESADILLAS', 'TORTAS/QUESADILLA', 'MULITAS/QUESADILLAS'],
    ['Ventana 1', 'VENTANA 1', 'Ventanilla 1', 'CAJERO DRIVE THRU|Ventana 1'],
    ['Ventana 2', 'VENTANA 2', 'Ventanilla 2', 'CAJERO DRIVE THRU|Ventana 2'],
    ['Ventana 2 (B)', 'VENTANA 2 (B)', 'Ventanilla 2 (B)', 'CAJERO DRIVE THRU|Ventana 2 (B)'],
    ['MANAGER', 'Manager', 'LIDERAZGO|Manager', 'Gerente'],
    ['ASSISTANT', 'Asistente', 'Asistente de Manager', 'LIDERAZGO|Asistente de Manager', 'LIDERAZGO|Asistente'],
    ['SHIFT_LEADER_MALE', 'SHIFT_LEADER_FEMALE', 'Shift Leader', 'LIDERAZGO|Shift Leader'],
];

/**
 * Devuelve todos los nombres equivalentes de una estación para cruzar `station_assignments` y `position_activities`.
 */
export function getPositionMatchCandidates(stationKey: string): string[] {
    const clean = (stationKey || '').replace(/\s*_(AM|PM)$/i, '').trim();
    if (!clean) return [];
    const normClean = normalizeText(clean);

    for (const group of STATION_EQUIVALENCE_GROUPS) {
        if (group.some((alias) => normalizeText(alias) === normClean)) {
            return Array.from(new Set([clean, ...group]));
        }
    }
    return [clean];
}

const DAY_NAMES_MONDAY_FIRST_NORM = [
    'lunes',
    'martes',
    'miercoles',
    'jueves',
    'viernes',
    'sabado',
    'domingo',
];

const DAY_NAMES_SUNDAY_FIRST_DISPLAY = [
    'Domingo',
    'Lunes',
    'Martes',
    'Miércoles',
    'Jueves',
    'Viernes',
    'Sábado',
];

/**
 * Normaliza un texto preservando letras acentuadas (NFD) y conservando únicamente [a-z0-9].
 */
export function normalizeText(str?: string | null): string {
    return (str || '')
        .toString()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
}

/**
 * Normaliza un texto preservando espacios (sin tildes, en minúsculas y con trim).
 */
export function normalizePhrase(str?: string | null): string {
    return (str || '')
        .toString()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Verifica si una sucursal tiene habilitado el envío operativo de actividades en el correo
 * de publicación de horarios (Feature Flag de despliegue gradual).
 * Por defecto únicamente Slauson (`id: 7`, `9625621e-1b5e-48d7-87ae-7094fab5a4fd`) está activa
 * en producción hasta que se autorice cada tienda adicional vía `ACTIVIDADES_EMAIL_ENABLED_STORES`.
 */
export function isStorePilotActiveForActivitiesEmail(
    store: StoreScheduleConfig | null | undefined,
    overrideEnabledStoresEnv?: string
): boolean {
    if (!store) return false;
    const rawFlag = (
        overrideEnabledStoresEnv ??
        process.env.ACTIVIDADES_EMAIL_ENABLED_STORES ??
        'Slauson,7,9625621e-1b5e-48d7-87ae-7094fab5a4fd'
    ).trim();
    if (rawFlag.toUpperCase() === 'ALL' || rawFlag === '*') return true;

    const allowedTokens = rawFlag
        .split(',')
        .map((s) => normalizeText(s))
        .filter(Boolean);

    const storeTokens = [
        store.id !== null && store.id !== undefined ? normalizeText(String(store.id)) : '',
        store.external_id ? normalizeText(store.external_id) : '',
        store.name ? normalizeText(store.name) : '',
    ].filter(Boolean);

    return storeTokens.some((tok) =>
        allowedTokens.some((allowed) => tok === allowed || (allowed.length >= 5 && tok.includes(allowed)))
    );
}

/**
 * Extrae `{ hour, minute }` en zona `America/Los_Angeles` desde un ISO string o string `"HH:MM(:SS)"`.
 */
export function getTimePartsLA(isoOrTime: string | null | undefined): { hour: number; minute: number } | null {
    if (!isoOrTime || typeof isoOrTime !== 'string') return null;
    const clean = isoOrTime.trim();
    if (!clean) return null;

    if (!clean.includes('T') && !clean.includes('-')) {
        const mins = parseTimeToMinutesStrict(clean);
        if (mins === null) return null;
        return { hour: Math.floor(mins / 60), minute: mins % 60 };
    }

    const d = new Date(clean);
    if (Number.isNaN(d.getTime())) return null;

    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Los_Angeles',
        hour: 'numeric',
        minute: 'numeric',
        hour12: false,
    }).formatToParts(d);

    const hRaw = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
    const mRaw = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
    return {
        hour: hRaw === 24 ? 0 : hRaw,
        minute: Number.isNaN(mRaw) ? 0 : mRaw,
    };
}

/**
 * Devuelve la hora (0-23) en `America/Los_Angeles` para un timestamp ISO o string `"HH:MM"`.
 */
export function getHourLA(isoOrTime: string): number {
    const parts = getTimePartsLA(isoOrTime);
    return parts ? parts.hour : 0;
}

/**
 * Determina el turno de inicio (`'AM' | 'PM'`) a partir de una hora o timestamp en `America/Los_Angeles`.
 * Jornada AM: 06:00 a 16:59. Jornada PM: 17:00 a 05:59.
 */
export function getShiftFromTime(startTime: string): 'AM' | 'PM' {
    const h = getHourLA(startTime);
    return h >= 6 && h < 17 ? 'AM' : 'PM';
}

/**
 * Convierte `{ hour, minute }` al eje continuo de minutos de la jornada laboral:
 * `06:00 AM` = `360`, `17:00 PM` = `1020`, `00:00 AM` = `1440`, `05:59 AM` = `1799`.
 */
export function toBusinessDayMinutes(hour: number, minute: number = 0): number {
    const adjustedHour = hour < 6 ? hour + 24 : hour;
    return adjustedHour * 60 + minute;
}

/**
 * Calcula los intervalos continuos `[startBMin, endBMin)` de un turno de empleado sobre el eje
 * de la jornada laboral (`06:00` = `360` .. `05:59 +1d` = `1799`), aplicando:
 * 1. Regla explícita de apertura temprana (`05:00–05:59 AM`, minutos `300..359`): si el turno inicia en la hora 5 AM
 *    y continúa hacia la mañana, se ancla en `[300 + sM, endMin)` para cubrir pre-apertura y mañana sin salto.
 * 2. Partición matemática exacta en la frontera de las `06:00 AM` (`1800` -> `360`): cualquier turno que inicie
 *    antes de las `06:00 AM` (p. ej. `22:00–06:30`, `23:00–07:30`, `00:00–06:30`, `00:00–08:00`, `04:30–15:00`)
 *    y cruce `1800` se divide exactamente en `[startBMin, 1800]` (porción PM/madrugada) y `[360, endBMin - 1440]` (porción AM).
 */
export function getShiftContinuousIntervals(
    startTime: string | null | undefined,
    endTime: string | null | undefined
): Array<[number, number]> {
    const startParts = getTimePartsLA(startTime);
    if (!startParts) return [];
    const endParts = getTimePartsLA(endTime);

    const sH = startParts.hour;
    const sM = startParts.minute;

    if (!endParts) {
        const bStart = sH === 5 ? 300 + sM : toBusinessDayMinutes(sH, sM);
        return [[bStart, bStart + 60]];
    }

    const eH = endParts.hour;
    const eM = endParts.minute;

    // Caso 1: Apertura temprana 05:00–05:59 AM que termina en la mañana/tarde (>= 06:00 AM)
    if (sH === 5 && eH >= 6) {
        const startMin = 5 * 60 + sM; // 300..359
        const endMin = eH * 60 + eM;  // >= 360
        return [[startMin, endMin]];
    }

    // Caso general sobre el eje continuo [360, 1800) con partición exacta si cruza las 06:00 AM (1800)
    const startBMin = toBusinessDayMinutes(sH, sM);
    let endBMin = toBusinessDayMinutes(eH, eM);
    if (endBMin <= startBMin) {
        endBMin += 1440;
    }

    if (endBMin > 1800) {
        const wrappedMorningEnd = endBMin - 1440;
        const segments: Array<[number, number]> = [[startBMin, 1800]];
        if (wrappedMorningEnd > 360) {
            segments.push([360, Math.min(1800, wrappedMorningEnd)]);
        }
        return segments;
    }

    return [[startBMin, endBMin]];
}

/**
 * Evalúa si una actividad con hora efectiva `effectiveStartTime` cae dentro del intervalo
 * semiabierto `[shiftStartTime, shiftEndTime)` del turno del empleado (inicio inclusivo, fin exclusivo).
 * Documenta y soporta:
 * - Actividades sin hora (`EVENT_NO_TIME` -> `true`)
 * - Apertura temprana `05:00–05:59 AM` (`300..359`)
 * - Excepción de cambio de turno (`FIXED_HANDOFF` a las `17:00` = `1020`) en el borde exacto de salida `AM` (`b === 1020`)
 * - Tolerancia de salida de cierre (`isClosingShift = true` para tareas de `Cierre` hasta +60 min tras el cierre público)
 */
export function doesActivityIntersectShiftWindow(
    arg1:
        | {
              effectiveStartTime: string | null | undefined;
              shiftStartTime: string | null | undefined;
              shiftEndTime: string | null | undefined;
              temporalPolicy?: TemporalPolicy;
              category?: string | null;
              isClosingShift?: boolean;
              isCambioDeTurno?: boolean;
          }
        | string
        | null
        | undefined,
    shiftStartTimeArg?: string | null,
    shiftEndTimeArg?: string | null,
    optionsArg?: {
        temporalPolicy?: TemporalPolicy;
        category?: string | null;
        isClosingShift?: boolean;
        isCambioDeTurno?: boolean;
    }
): boolean {
    const params =
        typeof arg1 === 'object' && arg1 !== null
            ? arg1
            : {
                  effectiveStartTime: arg1,
                  shiftStartTime: shiftStartTimeArg,
                  shiftEndTime: shiftEndTimeArg,
                  ...optionsArg,
              };
    const {
        effectiveStartTime,
        shiftStartTime,
        shiftEndTime,
        temporalPolicy,
        category,
        isClosingShift,
        isCambioDeTurno,
    } = params;
    if (!shiftStartTime || !shiftEndTime) return true;
    if (!effectiveStartTime || !effectiveStartTime.trim()) return true;

    const rawMins = parseTimeToMinutesStrict(effectiveStartTime);
    if (rawMins === null) return true;

    const intervals = getShiftContinuousIntervals(shiftStartTime, shiftEndTime);
    if (intervals.length === 0) return true;

    const actBMin = rawMins < 360 ? rawMins + 1440 : rawMins;
    const isCierreCategory = (category || '').toString().trim().toLowerCase() === 'cierre';
    const isHandoff = temporalPolicy === 'FIXED_HANDOFF' || isCambioDeTurno === true;

    for (const [a, b] of intervals) {
        // 1. Intersección estándar semiabierta [a, b) (inicio inclusivo, fin exclusivo)
        if (actBMin >= a && actBMin < b) {
            return true;
        }
        // 2. Apertura temprana 05:00–05:59 AM cuando el intervalo inicia en [300, 360) o cubre madrugada
        if (rawMins >= 300 && rawMins < 360 && rawMins >= a && rawMins < b) {
            return true;
        }
        // 3. Cambio de turno (FIXED_HANDOFF a las 17:00 = 1020) en el borde exacto de salida del turno AM
        if (isHandoff && actBMin === b && b === 1020) {
            return true;
        }
        // 4. Si el empleado cierra la tienda (isClosingShift), incluye tareas de cierre exacto o hasta 60 min después
        if (isClosingShift && (isCierreCategory || actBMin === b) && actBMin >= b && actBMin <= b + 60) {
            return true;
        }
    }

    return false;
}

/**
 * Evalúa si un turno `[start_time, end_time)` traslapa con el periodo `'AM'` (`[06:00, 17:00)`)
 * o `'PM'` (`[17:00, 06:00 +1d)`) usando intervalos semiabiertos con precisión de minutos.
 */
export function doesShiftOverlapPeriod(
    startTime: string | null | undefined,
    endTime: string | null | undefined,
    targetPeriod: 'AM' | 'PM'
): boolean {
    const intervals = getShiftContinuousIntervals(startTime, endTime);
    if (intervals.length === 0) return false;

    const windowStart = targetPeriod === 'AM' ? 300 : 1020;
    const windowEnd = targetPeriod === 'AM' ? 1020 : 1800;

    return intervals.some(([a, b]) => Math.max(a, windowStart) < Math.min(b, windowEnd));
}

/**
 * Devuelve los períodos (`['AM']`, `['PM']` o `['AM', 'PM']`) con los que traslapa un turno.
 */
export function getShiftOverlappingPeriods(
    startTime: string | null | undefined,
    endTime: string | null | undefined
): Array<'AM' | 'PM'> {
    const periods: Array<'AM' | 'PM'> = [];
    if (doesShiftOverlapPeriod(startTime, endTime, 'AM')) periods.push('AM');
    if (doesShiftOverlapPeriod(startTime, endTime, 'PM')) periods.push('PM');
    return periods;
}

/**
 * Obtiene la fecha laboral actual (`YYYY-MM-DD`) en `America/Los_Angeles` considerando el corte de las 6:00 AM.
 */
export function getBusinessDateLA(now: Date = new Date()): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Los_Angeles',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        hour12: false,
    }).formatToParts(now);

    const year = Number(parts.find((p) => p.type === 'year')?.value);
    const month = Number(parts.find((p) => p.type === 'month')?.value);
    const day = Number(parts.find((p) => p.type === 'day')?.value);
    const rawHour = Number(parts.find((p) => p.type === 'hour')?.value);
    const hour = rawHour === 24 ? 0 : rawHour;

    if (hour < 6) {
        const prev = new Date(Date.UTC(year, month - 1, day - 1, 12, 0, 0));
        return prev.toISOString().split('T')[0];
    }
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Obtiene el turno operativo actual (`'AM' | 'PM'`) en `America/Los_Angeles`.
 */
export function getCurrentShiftLA(now: Date = new Date()): 'AM' | 'PM' {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Los_Angeles',
        hour: '2-digit',
        hour12: false,
    }).formatToParts(now);
    const rawHour = Number(parts.find((p) => p.type === 'hour')?.value ?? '6');
    const hour = rawHour === 24 ? 0 : rawHour;
    return hour >= 6 && hour < 17 ? 'AM' : 'PM';
}

/**
 * Convierte una fecha `YYYY-MM-DD` o nombre de día en español al índice basado en Lunes (`0` = Lunes ... `6` = Domingo).
 */
export function getMondayBasedDayIdx(dateOrDayStr: string): number {
    const clean = (dateOrDayStr || '').trim();
    const norm = normalizePhrase(clean);
    const directDayIdx = DAY_NAMES_MONDAY_FIRST_NORM.indexOf(norm);
    if (directDayIdx !== -1) return directDayIdx;
    if (/^[0-6]$/.test(norm)) return Number(norm);

    const d = new Date(clean.includes('T') ? clean : `${clean}T12:00:00Z`);
    if (Number.isNaN(d.getTime())) return 0;
    const utcDay = d.getUTCDay(); // 0=Dom .. 6=Sáb
    return utcDay === 0 ? 6 : utcDay - 1;
}

/**
 * Devuelve el nombre del día en español (con tilde) para una fecha `YYYY-MM-DD`.
 */
export function getDayNameES(dateStr: string): string {
    const clean = (dateStr || '').trim();
    const d = new Date(clean.includes('T') ? clean : `${clean}T12:00:00Z`);
    if (Number.isNaN(d.getTime())) return 'Lunes';
    return DAY_NAMES_SUNDAY_FIRST_DISPLAY[d.getUTCDay()] || 'Lunes';
}

/**
 * Evalúa si la frecuencia de una actividad aplica para el día indicado (`dayIdx` 0=Lunes..6=Domingo, nombre de día o `YYYY-MM-DD`).
 */
export function isFreqMatch(
    freq: string | null | undefined,
    dayIdxOrDateStr: number | string,
    optionalBusinessDateStr?: string
): boolean {
    const f = normalizePhrase(freq);
    if (!f || f === 'diario' || f === 'todos los dias') return true;

    const rawDateCandidate =
        optionalBusinessDateStr && /^\d{4}-\d{2}-\d{2}/.test(optionalBusinessDateStr.trim())
            ? optionalBusinessDateStr.trim().slice(0, 10)
            : typeof dayIdxOrDateStr === 'string' && /^\d{4}-\d{2}-\d{2}/.test(dayIdxOrDateStr.trim())
              ? dayIdxOrDateStr.trim().slice(0, 10)
              : null;

    // Fecha específica YYYY-MM-DD en la frecuencia
    const isoMatch = /(\d{4}-\d{2}-\d{2})/.exec(f);
    if (isoMatch) {
        if (!rawDateCandidate) return false;
        return f.includes(rawDateCandidate);
    }

    const dayIdx =
        typeof dayIdxOrDateStr === 'number'
            ? dayIdxOrDateStr
            : getMondayBasedDayIdx(dayIdxOrDateStr);

    if (dayIdx < 0 || dayIdx > 6) return true;
    const dayName = DAY_NAMES_MONDAY_FIRST_NORM[dayIdx];

    if (f === String(dayIdx)) return true;
    if (f === 'entre semana' || f === 'lunes a viernes') return dayIdx >= 0 && dayIdx <= 4;
    if (f === 'fin de semana') return dayIdx === 5 || dayIdx === 6;

    // Mensual / Día del mes
    if (f.includes('mensual') || /\bdia\s+\d{1,2}\b/.test(f)) {
        const dayNumMatch = /\bdia\s+(\d{1,2})\b/.exec(f);
        if (rawDateCandidate) {
            const dom = Number(rawDateCandidate.split('-')[2]);
            if (dayNumMatch) return dom === Number(dayNumMatch[1]);
            return dom === 1;
        }
        return dayIdx === 0;
    }

    if (f.includes(dayName)) return true;

    // Si dice "semanal" sin día específico, se programa el Lunes (inicio de semana)
    if (f === 'semanal') return dayIdx === 0;

    return false;
}

/**
 * Convierte una hora `"HH:MM(:SS)"` a minutos de ordenamiento dentro de la jornada laboral (06:00 -> 05:59).
 * Si no tiene hora válida (`EVENT_NO_TIME`), devuelve `9999` para ubicarla al final sin inventar `00:00`.
 */
export function getBusinessDaySortMinutes(timeStr?: string | null): number {
    const mins = parseTimeToMinutesStrict(timeStr);
    if (mins === null) return 9999;
    return mins < 360 ? mins + 1440 : mins;
}

/**
 * Determina el desplazamiento de día civil relativo (`0` = mismo día civil de la fecha laboral,
 * `1` = madrugada `00:00–05:59` del día civil siguiente).
 */
export function getRelativeDayOffset(timeStr?: string | null): 0 | 1 {
    const mins = parseTimeToMinutesStrict(timeStr);
    if (mins === null) return 0;
    return mins < 360 ? 1 : 0;
}

/**
 * Comparador determinístico de actividades por jornada laboral (`06:00` -> `23:59` -> `00:00` -> `05:59`),
 * desempatando por `order_index` y título/ID.
 */
export function compareActivitiesChronologically(
    a: { effective_start_time?: string | null; order_index?: number | null; title?: string; activity_id?: string },
    b: { effective_start_time?: string | null; order_index?: number | null; title?: string; activity_id?: string }
): number {
    const sortA = getBusinessDaySortMinutes(a.effective_start_time);
    const sortB = getBusinessDaySortMinutes(b.effective_start_time);
    if (sortA !== sortB) return sortA - sortB;

    const idxA = a.order_index ?? 999;
    const idxB = b.order_index ?? 999;
    if (idxA !== idxB) return idxA - idxB;

    return (a.title || a.activity_id || '').localeCompare(b.title || b.activity_id || '');
}

/**
 * Determina el turno operativo efectivo (`'AM' | 'PM'`) de una actividad para el filtro del Checklist.
 */
export function getEffectiveShiftForChecklist(
    proc: { shift_type?: string | null; shift?: string | null },
    effectiveTimeStr?: string | null
): 'AM' | 'PM' | 'ALL' {
    const cat = (proc.shift_type || '').toString().trim().toLowerCase();
    if (cat === 'apertura') return 'AM';
    if (cat === 'cierre') return 'PM';

    const sortMins = getBusinessDaySortMinutes(effectiveTimeStr);
    if (sortMins !== 9999) {
        return sortMins >= 360 && sortMins < 1020 ? 'AM' : 'PM';
    }

    const rawShift = (proc.shift || 'ALL').toString().trim().toUpperCase();
    if (rawShift === 'AM' || rawShift === 'PM') return rawShift;
    return 'ALL';
}

/**
 * Determina si una actividad pertenece a la vista actual del Checklist (`Apertura`, `Regular`, `Cierre` o `Todos`).
 * Soporta tanto firma posicional `(shiftType, effectiveTimeStr, categoryFilter)` como objeto `{ proc, effectiveTimeStr, shiftFilter, categoryFilter }`.
 */
export function doesActivityBelongToChecklistView(
    arg1:
        | string
        | null
        | undefined
        | {
              proc: { shift_type?: string | null; shift?: string | null };
              effectiveTimeStr?: string | null;
              shiftFilter?: 'AM' | 'PM' | 'ALL';
              categoryFilter: string;
          },
    effectiveTimeStrArg?: string | null,
    categoryFilterArg?: string
): boolean {
    let procCat = '';
    let procShift: string | null | undefined = null;
    let effectiveTimeStr: string | null | undefined = null;
    let shiftFilter: 'AM' | 'PM' | 'ALL' = 'ALL';
    let categoryFilter = 'Todos';

    if (arg1 && typeof arg1 === 'object') {
        procCat = (arg1.proc.shift_type || '').toString().trim();
        procShift = arg1.proc.shift;
        effectiveTimeStr = arg1.effectiveTimeStr;
        shiftFilter = arg1.shiftFilter || 'ALL';
        categoryFilter = arg1.categoryFilter || 'ALL';
    } else {
        procCat = (arg1 || '').toString().trim();
        effectiveTimeStr = effectiveTimeStrArg;
        categoryFilter = categoryFilterArg || 'Todos';
    }

    if (shiftFilter !== 'ALL') {
        const effectiveShift = getEffectiveShiftForChecklist({ shift_type: procCat, shift: procShift }, effectiveTimeStr);
        if (shiftFilter === 'AM' && effectiveShift === 'PM') return false;
        if (shiftFilter === 'PM' && effectiveShift === 'AM') return false;
    }

    const catFilterLower = categoryFilter.toLowerCase();
    if (catFilterLower === 'all' || catFilterLower === 'todos') return true;

    const procCatLower = procCat.toLowerCase();
    if (procCatLower === catFilterLower) return true;

    // Regla A04: Si una actividad Regular fue desplazada antes de las 12:00 PM (ej. 10:00 AM en LA Central)
    // y el usuario está viendo el bloque de Apertura (6:00 AM - 11:59 AM), hacerla visible para que no quede oculta.
    const sortMins = getBusinessDaySortMinutes(effectiveTimeStr);
    if (catFilterLower === 'apertura' && procCatLower === 'regular' && sortMins >= 360 && sortMins < 720) {
        return true;
    }

    return false;
}

/**
 * Evalúa si una actividad o mapeo es compatible con el modelo de la tienda (`has_drive_thru`).
 * Soporta `'AMBOS' | 'ALL'`, `'DRIVE_THRU' | 'DT'`, `'REGULAR' | 'NO_DT'`.
 */
export function isStoreModelMatch(
    model: string | null | undefined,
    hasDriveThru: boolean | string | null | undefined
): boolean {
    const m = (model || 'AMBOS').toString().trim().toUpperCase();
    if (!m || m === 'ALL' || m === 'AMBOS') return true;
    const isDT =
        typeof hasDriveThru === 'string'
            ? ['DT', 'DRIVE_THRU', 'TRUE', '1'].includes(hasDriveThru.trim().toUpperCase())
            : Boolean(hasDriveThru);
    if ((m === 'DT' || m === 'DRIVE_THRU') && !isDT) return false;
    if ((m === 'NO_DT' || m === 'REGULAR') && isDT) return false;
    return true;
}

/**
 * Resuelve la llave canónica de estación (`position_key`) a partir de `main_station`, `sub_position`
 * y el conjunto de `position_key` disponibles en `position_activities`.
 */
export function resolvePositionKey(
    mainStation: string,
    subPosition?: string | null,
    availableKeys?: Iterable<string>
): string {
    const cleanMain = (mainStation || '').replace(/\s*_(AM|PM)$/i, '').trim();
    const cleanSub = (subPosition || '').replace(/\s*_(AM|PM)$/i, '').trim();
    const primaryTarget = cleanSub && cleanSub !== cleanMain ? `${cleanMain}|${cleanSub}` : cleanMain;

    if (!availableKeys) return cleanMain;
    const keyList = Array.from(availableKeys);

    const candidates = new Set<string>([
        ...getPositionMatchCandidates(cleanMain),
        ...(cleanSub ? getPositionMatchCandidates(cleanSub) : []),
        primaryTarget,
    ]);
    const normCandidates = new Set(Array.from(candidates).map(normalizeText));

    for (const k of keyList) {
        if (candidates.has(k) || normCandidates.has(normalizeText(k))) {
            return k;
        }
    }

    return cleanMain;
}

/**
 * Obtiene el estado de configuración explícito de cualquier estación del catálogo (incluyendo las 10 sin mapeo, A21).
 */
export function getStationConfigStatus(
    mainStation: string,
    subPositionOrActivities?: string | null | PositionActivityMappingRecord[],
    maybeActivities?: PositionActivityMappingRecord[]
): {
    positionKey: string;
    hasDirectMappings: boolean;
    hasInheritedMainMappings: boolean;
    mappingCount: number;
    disposition: StationMappingDisposition;
    dispositionReason: string;
} {
    const cleanMain = (mainStation || '').replace(/\s*_(AM|PM)$/i, '').trim();
    const positionActivities: PositionActivityMappingRecord[] = Array.isArray(subPositionOrActivities)
        ? subPositionOrActivities
        : maybeActivities || [];

    const candidateNorms = new Set(getPositionMatchCandidates(cleanMain).map(normalizeText));

    const directCount = positionActivities.filter((pa) => {
        const key = pa.position_key || pa.position_name || '';
        return candidateNorms.has(normalizeText(key));
    }).length;

    const catalogEntry = CANONICAL_STATIONS_CATALOG.find((c) =>
        candidateNorms.has(normalizeText(c.station))
    );

    if (directCount > 0) {
        return {
            positionKey: catalogEntry?.station || cleanMain,
            hasDirectMappings: true,
            hasInheritedMainMappings: false,
            mappingCount: directCount,
            disposition: 'configured',
            dispositionReason: `Configurada con ${directCount} relación(es) en position_activities.`,
        };
    }

    return {
        positionKey: catalogEntry?.station || cleanMain,
        hasDirectMappings: false,
        hasInheritedMainMappings: false,
        mappingCount: 0,
        disposition: catalogEntry?.defaultDisposition || 'pending_operational_decision',
        dispositionReason:
            catalogEntry?.dispositionReason ||
            'Estación sin relaciones configuradas en position_activities; pendiente de decisión operativa.',
    };
}

/**
 * Genera una firma/versión determinística de configuración a partir del catálogo y mapeos aplicados.
 */
export function computeConfigVersionTag(
    proceduresCount: number,
    mappingsCount: number,
    storeOffsets: StoreTimeOffsets,
    businessDateStr: string
): string {
    return `v1:${businessDateStr}:p${proceduresCount}:m${mappingsCount}:o${storeOffsets.openingOffsetMinutes}:c${storeOffsets.closingOffsetMinutes}`;
}

/**
 * Obtiene el objeto de override por sucursal (`proc.overrides.stores[...]`) buscando
 * tanto por `external_id` (UUID) como por `id` numérico de la tienda.
 */
export function getStoreOverrideForProcedure(
    proc: CatalogProcedureRecord | null | undefined,
    store: StoreScheduleConfig | null | undefined
): ProcedureStoreOverride | undefined {
    const storesMap = proc?.overrides?.stores;
    if (!storesMap || !store) return undefined;
    if (store.external_id && storesMap[String(store.external_id)]) {
        return storesMap[String(store.external_id)];
    }
    if (store.id !== null && store.id !== undefined && storesMap[String(store.id)]) {
        return storesMap[String(store.id)];
    }
    return undefined;
}

/**
 * Resuelve las actividades operativas efectivas para una asignación de estación en una tienda,
 * fecha laboral y turno (`AM` o `PM`), con soporte opcional de intersección por minutos con el turno del empleado.
 */
export function resolveStationActivities(params: {
    mainStation: string;
    subPosition?: string | null;
    shift: 'AM' | 'PM';
    businessDateStr: string;
    store: StoreScheduleConfig | null | undefined;
    procedures: CatalogProcedureRecord[];
    positionActivities: PositionActivityMappingRecord[];
    legacyTasks?: string[] | null;
    storeOffsets?: StoreTimeOffsets;
    isCallback?: boolean;
    shiftStartTime?: string | null;
    shiftEndTime?: string | null;
    enforceShiftWindow?: boolean;
    isClosingShift?: boolean;
}): ResolvedActivityItem[] {
    // Regla A08: Si el turno es Ausente/Callback, jamás recibe actividades operativas
    if (params.isCallback) {
        return [];
    }

    const {
        mainStation,
        subPosition,
        shift,
        businessDateStr,
        store,
        procedures,
        positionActivities,
        legacyTasks,
        shiftStartTime,
        shiftEndTime,
        enforceShiftWindow,
        isClosingShift,
    } = params;

    const cleanMain = (mainStation || '').replace(/\s*_(AM|PM)$/i, '').trim();
    if (!cleanMain || /^ausente\b/i.test(cleanMain)) {
        return [];
    }

    const cleanSub = (subPosition || '').replace(/\s*_(AM|PM)$/i, '').trim();
    const stationLabel = cleanSub && cleanSub !== cleanMain ? `${cleanMain} (${cleanSub})` : cleanMain;
    const hasDriveThru = Boolean(store?.has_drive_thru);
    const offsets = params.storeOffsets || calculateStoreOffsetsForDate(store, businessDateStr);
    const configVersion = computeConfigVersionTag(
        procedures.length,
        positionActivities.length,
        offsets,
        businessDateStr
    );

    const procById = new Map<string, CatalogProcedureRecord>();
    const procByNormTitle = new Map<string, CatalogProcedureRecord[]>();
    for (const p of procedures) {
        if (!p || p.role === 'ROLES_MODULE') continue;
        procById.set(p.id, p);
        const ovTitle = getStoreOverrideForProcedure(p, store)?.activity;
        const prevTitle =
            typeof p.overrides?.previous_activity_title === 'string'
                ? p.overrides.previous_activity_title
                : undefined;
        const prevTitlesArr = Array.isArray(p.overrides?.previous_activity_titles)
            ? p.overrides.previous_activity_titles
            : [];
        for (const t of [ovTitle, p.activity, prevTitle, ...prevTitlesArr]) {
            const key = normalizePhrase(t);
            if (!key) continue;
            const list = procByNormTitle.get(key) || [];
            if (!list.some((existing) => existing.id === p.id)) {
                list.push(p);
                procByNormTitle.set(key, list);
            }
        }
    }

    const candidateNorms = new Set<string>([
        ...getPositionMatchCandidates(cleanMain).map(normalizeText),
        ...(cleanSub ? getPositionMatchCandidates(cleanSub).map(normalizeText) : []),
    ]);

    const stationMappings = positionActivities.filter((pa) => {
        const key = pa.position_key || pa.position_name || '';
        return candidateNorms.has(normalizeText(key));
    });

    const resolvedMap = new Map<string, ResolvedActivityItem>();

    const buildResolvedFromProc = (
        proc: CatalogProcedureRecord,
        mapping: PositionActivityMappingRecord | null,
        origin: ActivityOriginSource
    ): ResolvedActivityItem | null => {
        const storeOv = getStoreOverrideForProcedure(proc, store);
        if (storeOv?.disabled === true || storeOv?.enabled === false) return null;

        const effectiveShiftRule = (mapping?.shift || proc.shift || 'AMBOS').toString().trim().toUpperCase();
        if (
            effectiveShiftRule !== 'ALL' &&
            effectiveShiftRule !== 'AMBOS' &&
            effectiveShiftRule !== shift
        ) {
            return null;
        }

        const effectiveFreq = (storeOv?.frequency || mapping?.frequency || proc.frequency || 'Diario')
            .toString()
            .trim();
        if (!isFreqMatch(effectiveFreq, businessDateStr, businessDateStr)) {
            return null;
        }

        const effectiveModel =
            mapping?.store_model &&
            mapping.store_model !== 'ALL' &&
            mapping.store_model !== 'AMBOS'
                ? mapping.store_model
                : proc.store_model || 'AMBOS';
        if (!isStoreModelMatch(effectiveModel, hasDriveThru)) {
            return null;
        }

        const title = (storeOv?.activity || proc.activity || '').trim();
        if (!title) return null;

        const category = (storeOv?.shift_type || proc.shift_type || 'Regular').trim();
        const rawBaseStart = storeOv?.start_time ?? proc.start_time ?? null;
        const hasValidBaseTime = parseTimeToMinutesStrict(rawBaseStart) !== null;
        const baseStartTime = hasValidBaseTime ? rawBaseStart!.trim() : null;

        const timeAnchor = resolveTimeAnchor(category, {
            activityId: proc.id,
            activityTitle: title,
            baseTimeStr: baseStartTime,
            overrides: proc.overrides,
        });
        const temporalPolicy = resolveTemporalPolicy(baseStartTime, category, {
            activityId: proc.id,
            activityTitle: title,
            baseTimeStr: baseStartTime,
            overrides: proc.overrides,
        });

        // Regla A25: Nunca inventar hora (00:00) si la actividad no tiene start_time válido
        const effectiveStartTime = baseStartTime
            ? applyTimeOffset(baseStartTime, category, offsets, {
                  activityId: proc.id,
                  activityTitle: title,
                  baseTimeStr: baseStartTime,
                  overrides: proc.overrides,
                  timeAnchor,
              })
            : null;

        // Si NO viene de un mapeo explícito AMBOS en position_activities (ej. tarea legacy sólo en catálogo)
        // y tiene hora efectiva específica (y no es el hito de 17:00), respetar su bloque natural (AM vs PM).
        // Si en position_activities está configurada explícitamente como shift='AMBOS', aplica a AM y PM.
        const hasExplicitAmbosMapping = Boolean(
            mapping?.shift && ['AMBOS', 'ALL'].includes(mapping.shift.toString().trim().toUpperCase())
        );
        if (
            !hasExplicitAmbosMapping &&
            (effectiveShiftRule === 'AMBOS' || effectiveShiftRule === 'ALL') &&
            effectiveStartTime &&
            temporalPolicy !== 'FIXED_HANDOFF'
        ) {
            const naturalShift = getEffectiveShiftForChecklist(
                { shift_type: category, shift: effectiveShiftRule },
                effectiveStartTime
            );
            if (naturalShift !== 'ALL' && naturalShift !== shift) {
                return null;
            }
        }

        // Intersección temporal con el turno del empleado cuando enforceShiftWindow está activo (M-02 / A06),
        // excepto para actividades continuas de estación mapeadas explícitamente como AMBOS con hora base de apertura (10:00).
        if (
            enforceShiftWindow &&
            !hasExplicitAmbosMapping &&
            shiftStartTime &&
            shiftEndTime &&
            !doesActivityIntersectShiftWindow({
                effectiveStartTime,
                shiftStartTime,
                shiftEndTime,
                temporalPolicy,
                category,
                isClosingShift,
            })
        ) {
            return null;
        }

        const formattedTime = effectiveStartTime ? formatTime12h(effectiveStartTime) : 'Sin hora';
        const occurrenceKey = `${proc.id}::${effectiveStartTime || 'NO_TIME'}::${shift}`;

        const rawOrderIdx = proc.order_index ?? proc.overrides?.order_index ?? mapping?.sort_order;
        const orderIndex =
            rawOrderIdx !== null && rawOrderIdx !== undefined && Number.isFinite(Number(rawOrderIdx))
                ? Number(rawOrderIdx)
                : 999;

        return {
            activity_id: proc.id,
            occurrence_key: occurrenceKey,
            title,
            description: (storeOv?.description || proc.description || '').trim(),
            category,
            shift: effectiveShiftRule,
            base_start_time: baseStartTime,
            effective_start_time: effectiveStartTime,
            formatted_time: formattedTime,
            relative_day_offset: getRelativeDayOffset(effectiveStartTime),
            duration_minutes:
                proc.duration_minutes !== null &&
                proc.duration_minutes !== undefined &&
                Number.isFinite(Number(proc.duration_minutes))
                    ? Number(proc.duration_minutes)
                    : null,
            frequency: effectiveFreq,
            inclusion_reason: `station:${cleanMain}|freq:${effectiveFreq}|model:${effectiveModel}|policy:${temporalPolicy}`,
            store_model: effectiveModel,
            time_anchor: timeAnchor,
            temporal_policy: temporalPolicy,
            order_index: orderIndex,
            is_critical: Boolean(proc.is_critical ?? proc.overrides?.is_critical),
            requires_photo: Boolean(proc.requires_photo ?? proc.overrides?.requires_photo),
            origin,
            is_manual_or_legacy: origin !== 'catalog_mapping',
            needs_review: false,
            config_version: configVersion,
            source_stations: [stationLabel],
            sort_minutes: getBusinessDaySortMinutes(effectiveStartTime),
        };
    };

    // 1. Resolver desde position_activities (fuente primaria del catálogo)
    for (const pa of stationMappings) {
        const proc = procById.get(pa.activity_id);
        if (!proc) continue;
        const item = buildResolvedFromProc(proc, pa, 'catalog_mapping');
        if (!item) continue;
        if (!resolvedMap.has(item.occurrence_key)) {
            resolvedMap.set(item.occurrence_key, item);
        }
    }

    // 2. Reconciliación no destructiva de legacyTasks (station_assignments.tasks)
    if (Array.isArray(legacyTasks) && legacyTasks.length > 0) {
        const hasCatalogMappingsForStation = stationMappings.length > 0;
        for (const rawTask of legacyTasks) {
            const cleanTask = (rawTask || '').toString().trim();
            if (!cleanTask) continue;
            const normTask = normalizePhrase(cleanTask);
            const matchedProcs = procByNormTitle.get(normTask) || [];

            if (matchedProcs.length > 0) {
                if (!hasCatalogMappingsForStation) {
                    for (const matchedProc of matchedProcs) {
                        const item = buildResolvedFromProc(matchedProc, null, 'legacy_catalog_task');
                        if (item && !resolvedMap.has(item.occurrence_key)) {
                            resolvedMap.set(item.occurrence_key, item);
                        }
                    }
                }
            } else {
                // Tarea manual o snapshot legacy no clasificable en el catálogo actual:
                // SE CONSERVA ÍNTEGRAMENTE (nunca se borra) y se etiqueta para trazabilidad.
                const manualId = `manual:${normTask}`;
                const occurrenceKey = `${manualId}::NO_TIME::${shift}`;
                if (!resolvedMap.has(occurrenceKey)) {
                    resolvedMap.set(occurrenceKey, {
                        activity_id: manualId,
                        occurrence_key: occurrenceKey,
                        title: cleanTask,
                        description: '',
                        category: 'Regular',
                        shift,
                        base_start_time: null,
                        effective_start_time: null,
                        formatted_time: 'Sin hora',
                        relative_day_offset: 0,
                        duration_minutes: null,
                        frequency: 'Diario',
                        inclusion_reason: `manual_or_legacy_preserved:${stationLabel}`,
                        store_model: 'AMBOS',
                        time_anchor: 'OPENING',
                        temporal_policy: 'EVENT_NO_TIME',
                        order_index: 999,
                        is_critical: false,
                        requires_photo: false,
                        origin: cleanMain.toUpperCase().includes('EXTRA') ? 'manual_task' : 'legacy_snapshot',
                        is_manual_or_legacy: true,
                        needs_review: !cleanMain.toUpperCase().includes('EXTRA'),
                        config_version: configVersion,
                        source_stations: [stationLabel],
                        sort_minutes: 9999,
                    });
                }
            }
        }
    }

    return Array.from(resolvedMap.values()).sort(compareActivitiesChronologically);
}

/**
 * Consolida y deduplica actividades de múltiples estaciones asignadas a un mismo empleado
 * en una fecha y turno por identidad de ocurrencia (`occurrence_key` = `activity_id::effective_start_time::shift`),
 * preservando todas las estaciones de origen (`source_stations`) y sin borrar ocurrencias legítimas en horas distintas.
 */
export function mergeAndDeduplicateActivities(
    stationLists: ResolvedActivityItem[][]
): ResolvedActivityItem[] {
    const merged = new Map<string, ResolvedActivityItem>();

    for (const list of stationLists) {
        for (const item of list) {
            const key = item.occurrence_key || `${item.activity_id}::${item.effective_start_time || 'NO_TIME'}::${item.shift}`;
            const existing = merged.get(key);
            if (!existing) {
                merged.set(key, {
                    ...item,
                    source_stations: [...item.source_stations],
                });
            } else {
                for (const st of item.source_stations) {
                    if (!existing.source_stations.includes(st)) {
                        existing.source_stations.push(st);
                    }
                }
            }
        }
    }

    return Array.from(merged.values()).sort(compareActivitiesChronologically);
}

/**
 * Clasifica de forma no destructiva los textos legacy de `station_assignments.tasks`
 * frente al catálogo actual y los mapeos vigentes de la estación.
 */
export function classifyLegacyTasksSnapshot(params: {
    mainStation: string;
    subPosition?: string | null;
    tasks: string[] | null | undefined;
    procedures: CatalogProcedureRecord[];
    positionActivities: PositionActivityMappingRecord[];
}): {
    matchedActiveMapping: string[];
    matchedCatalogOnly: string[];
    unclassifiedOrManualPreserved: string[];
} {
    const { mainStation, subPosition, tasks, procedures, positionActivities } = params;
    if (!Array.isArray(tasks) || tasks.length === 0) {
        return {
            matchedActiveMapping: [],
            matchedCatalogOnly: [],
            unclassifiedOrManualPreserved: [],
        };
    }

    const cleanMain = (mainStation || '').replace(/\s*_(AM|PM)$/i, '').trim();
    const cleanSub = (subPosition || '').replace(/\s*_(AM|PM)$/i, '').trim();
    const candidateNorms = new Set<string>([
        ...getPositionMatchCandidates(cleanMain).map(normalizeText),
        ...(cleanSub ? getPositionMatchCandidates(cleanSub).map(normalizeText) : []),
    ]);

    const mappedIds = new Set(
        positionActivities
            .filter((pa) => candidateNorms.has(normalizeText(pa.position_key || pa.position_name || '')))
            .map((pa) => pa.activity_id)
    );

    const procByNorm = new Map<string, CatalogProcedureRecord>();
    for (const p of procedures) {
        if (!p || p.role === 'ROLES_MODULE') continue;
        procByNorm.set(normalizePhrase(p.activity), p);
        const prevCandidates: string[] = [];
        if (typeof p.overrides?.previous_activity_title === 'string') {
            prevCandidates.push(p.overrides.previous_activity_title);
        }
        if (Array.isArray(p.overrides?.previous_activity_titles)) {
            prevCandidates.push(...p.overrides.previous_activity_titles);
        }
        for (const prev of prevCandidates) {
            const prevKey = normalizePhrase(prev);
            if (prevKey && !procByNorm.has(prevKey)) {
                procByNorm.set(prevKey, p);
            }
        }
    }

    const matchedActiveMapping: string[] = [];
    const matchedCatalogOnly: string[] = [];
    const unclassifiedOrManualPreserved: string[] = [];

    for (const t of tasks) {
        const clean = (t || '').toString().trim();
        if (!clean) continue;
        const proc = procByNorm.get(normalizePhrase(clean));
        if (!proc) {
            unclassifiedOrManualPreserved.push(clean);
        } else if (mappedIds.has(proc.id)) {
            matchedActiveMapping.push(clean);
        } else {
            matchedCatalogOnly.push(clean);
        }
    }

    return {
        matchedActiveMapping,
        matchedCatalogOnly,
        unclassifiedOrManualPreserved,
    };
}

/**
 * Resuelve de forma unificada las actividades del catálogo aplicables a una sucursal, fecha laboral
 * y filtro de categoría (`'Apertura' | 'Regular' | 'Cierre' | 'ALL'`), aplicando:
 * - Exclusión de `ROLES_MODULE`
 * - Overrides por sucursal (`getStoreOverrideForProcedure` tanto por UUID como por ID numérico)
 * - Evaluación de frecuencia (`isFreqMatch` con fecha ISO exacta)
 * - Evaluación de modelo de tienda (`isStoreModelMatch` con `stores.has_drive_thru`)
 * - Desplazamientos horarios por fecha (`calculateStoreOffsetsForDate` / `weekly_hours` + `applyTimeOffset`)
 * - Visibilidad en ventana de Apertura para actividades `Regular` desplazadas antes de las 12:00 PM (A04)
 * - Ordenamiento cronológico de jornada laboral (`06:00 -> 05:59`, `EVENT_NO_TIME` al final sin inventar `00:00`)
 */
export function resolveStoreCatalogActivitiesForDay<T extends CatalogProcedureRecord>(params: {
    procedures: T[];
    store: StoreScheduleConfig | null | undefined;
    businessDateStr: string;
    categoryFilter?: 'Apertura' | 'Regular' | 'Cierre' | 'ALL' | 'Todos' | string;
    storeOffsets?: StoreTimeOffsets;
}): Array<T & { effective_start_time: string; effective_category: string }> {
    const { procedures, store, businessDateStr, categoryFilter = 'ALL' } = params;
    const hasDriveThru = Boolean(store?.has_drive_thru);
    const offsets = params.storeOffsets || calculateStoreOffsetsForDate(store, businessDateStr);

    const results: Array<T & { effective_start_time: string; effective_category: string }> = [];

    for (const p of procedures) {
        if (!p || p.role === 'ROLES_MODULE') continue;

        const storeOv = getStoreOverrideForProcedure(p, store);
        if (storeOv?.disabled === true || storeOv?.enabled === false) continue;

        const effectiveFreq = (storeOv?.frequency || p.frequency || 'Diario').toString().trim();
        if (!isFreqMatch(effectiveFreq, businessDateStr, businessDateStr)) continue;

        const effectiveModel = p.store_model || 'AMBOS';
        if (!isStoreModelMatch(effectiveModel, hasDriveThru)) continue;

        const effectiveCategory = (storeOv?.shift_type || p.shift_type || 'Regular').toString().trim();
        const effectiveTitle = (storeOv?.activity || p.activity || '').toString().trim();
        const effectiveDesc = (storeOv?.description ?? p.description ?? '').toString();
        const rawBaseStart = storeOv?.start_time ?? p.start_time ?? null;
        const hasValidBaseTime = parseTimeToMinutesStrict(rawBaseStart) !== null;
        const baseStartTime = hasValidBaseTime ? rawBaseStart!.trim() : '';

        const adjustedTime = baseStartTime
            ? applyTimeOffset(baseStartTime, effectiveCategory, offsets, {
                  activityId: p.id,
                  activityTitle: effectiveTitle,
                  overrides: p.overrides,
              })
            : '';

        if (!doesActivityBelongToChecklistView(effectiveCategory, adjustedTime, categoryFilter)) {
            continue;
        }

        results.push({
            ...p,
            activity: effectiveTitle || p.activity,
            description: effectiveDesc,
            shift_type: effectiveCategory,
            frequency: effectiveFreq,
            start_time: adjustedTime,
            effective_start_time: adjustedTime,
            effective_category: effectiveCategory,
        });
    }

    results.sort((a, b) => {
        const av = getBusinessDaySortMinutes(a.effective_start_time);
        const bv = getBusinessDaySortMinutes(b.effective_start_time);
        if (av !== bv) return av - bv;
        const ai = a.order_index ?? a.overrides?.order_index ?? 999;
        const bi = b.order_index ?? b.overrides?.order_index ?? 999;
        if (ai !== bi) return Number(ai) - Number(bi);
        return (a.activity || '').localeCompare(b.activity || '');
    });

    return results;
}
