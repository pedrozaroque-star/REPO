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

export type SafetyReviewCategory = 'roof' | 'chemicals' | 'cash_alarm';

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
    requires_safety_review?: boolean;
    safety_review_categories?: SafetyReviewCategory[];
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
 * Nota: `defaultDisposition` es la disposición cuando la estación NO tiene mappings reales aprobados
 * en `position_activities`. Una estación solo pasa a `configured` en `getStationConfigStatus` cuando
 * `directCount > 0` con mappings reales aprobados.
 */
export const CANONICAL_STATIONS_CATALOG: CanonicalStationDefinition[] = [
    // SALÓN / SERVICIO (7)
    makeStationDef({
        station: 'Caja 1 / Salón',
        group: 'front',
        label: 'Caja 1 / Salón',
        defaultDisposition: 'pending_operational_decision',
        dispositionReason: 'Estación principal de caja; requiere relaciones aprobadas en position_activities.',
    }),
    makeStationDef({
        station: 'Caja 2',
        group: 'front',
        label: 'Caja 2',
        defaultDisposition: 'pending_operational_decision',
        dispositionReason: 'Segunda estación de caja; requiere relaciones aprobadas en position_activities.',
    }),
    makeStationDef({
        station: 'Caja 3',
        group: 'front',
        label: 'Caja 3',
        defaultDisposition: 'pending_operational_decision',
        dispositionReason: 'Tercera estación de caja sin mapeo propio aprobado; pendiente de decisión operativa.',
    }),
    makeStationDef({
        station: 'Uber + Salsas',
        group: 'front',
        label: 'Uber + Salsas',
        defaultDisposition: 'pending_operational_decision',
        dispositionReason: 'Estación de entrega y barra de salsas; requiere relaciones aprobadas en position_activities.',
    }),
    makeStationDef({
        station: 'ENTREGA',
        group: 'front',
        label: 'Entrega',
        defaultDisposition: 'pending_operational_decision',
        dispositionReason: 'Estación de entrega en mostrador; requiere relaciones aprobadas en position_activities.',
    }),
    makeStationDef({
        station: 'LIMPIEZA',
        group: 'front',
        label: 'Limpieza',
        defaultDisposition: 'pending_operational_decision',
        dispositionReason: 'Estación de limpieza de salón; requiere relaciones aprobadas en position_activities.',
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
        defaultDisposition: 'pending_operational_decision',
        dispositionReason: 'Estación de línea de tacos; requiere relaciones aprobadas en position_activities.',
    }),
    makeStationDef({
        station: 'CARNES',
        group: 'kitchen',
        label: 'Carnes',
        defaultDisposition: 'pending_operational_decision',
        dispositionReason: 'Estación de parrilla y carnes; requiere relaciones aprobadas en position_activities.',
    }),
    makeStationDef({
        station: 'BURRITOS',
        group: 'kitchen',
        label: 'Burritos',
        defaultDisposition: 'pending_operational_decision',
        dispositionReason: 'Estación de línea de burritos; requiere relaciones aprobadas en position_activities.',
    }),
    makeStationDef({
        station: 'TORTILLAS',
        group: 'kitchen',
        label: 'Tortillas',
        defaultDisposition: 'pending_operational_decision',
        dispositionReason: 'Estación de tortillera sin mapeo propio aprobado; pendiente de decisión operativa.',
    }),
    makeStationDef({
        station: 'TORTAS/QUESADILLAS',
        group: 'kitchen',
        label: 'Tortas / Quesadillas',
        defaultDisposition: 'pending_operational_decision',
        dispositionReason: 'Estación de tortas y quesadillas; requiere relaciones aprobadas en position_activities.',
    }),
    makeStationDef({
        station: 'TORTAS/MULITAS',
        group: 'kitchen',
        label: 'Tortas / Mulitas',
        defaultDisposition: 'pending_operational_decision',
        dispositionReason: 'Variante histórica/alternativa sin mapeo propio aprobado; pendiente de decisión operativa.',
    }),
    makeStationDef({
        station: 'CUBRIR DESCANSOS (COCINA)',
        group: 'kitchen',
        label: 'Cubrir Descansos (Cocina)',
        defaultDisposition: 'break_coverage_inherits_target',
        dispositionReason: 'Puesto comodín para relevo de descansos en cocina; configurable en position_activities.',
    }),
    makeStationDef({
        station: 'PREPARACION',
        group: 'kitchen',
        label: 'Preparación',
        defaultDisposition: 'pending_operational_decision',
        dispositionReason: 'Estación de preparación; requiere relaciones aprobadas en position_activities.',
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
        dispositionReason: 'Estación Drive-Thru pendiente de homologación y aprobación operativa en position_activities.',
    }),
    makeStationDef({
        station: 'Ventana 2',
        group: 'drive-thru',
        label: 'Ventanilla 2',
        storeModel: 'DRIVE_THRU',
        defaultDisposition: 'pending_operational_decision',
        dispositionReason: 'Estación Drive-Thru pendiente de homologación y aprobación operativa en position_activities.',
    }),
    makeStationDef({
        station: 'Ventana 2 (B)',
        group: 'drive-thru',
        label: 'Ventanilla 2 (B)',
        storeModel: 'DRIVE_THRU',
        defaultDisposition: 'pending_operational_decision',
        dispositionReason: 'Subestación de apoyo en Drive-Thru pendiente de aprobación operativa en position_activities.',
    }),
    makeStationDef({
        station: 'TORTAS/QUESADILLAS (DT)',
        group: 'drive-thru',
        label: 'Tortas / Quesadillas (DT)',
        storeModel: 'DRIVE_THRU',
        defaultDisposition: 'pending_operational_decision',
        dispositionReason: 'Estación de cocina Drive-Thru pendiente de aprobación operativa en position_activities.',
    }),
    makeStationDef({
        station: 'TACOS/BURRITOS (DT)',
        group: 'drive-thru',
        label: 'Tacos / Burritos (DT)',
        storeModel: 'DRIVE_THRU',
        defaultDisposition: 'pending_operational_decision',
        dispositionReason: 'Estación de cocina Drive-Thru pendiente de aprobación operativa en position_activities.',
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
        defaultDisposition: 'pending_operational_decision',
        dispositionReason: 'Puesto de gerencia; requiere relaciones aprobadas en position_activities.',
    }),
    makeStationDef({
        station: 'ASSISTANT',
        group: 'leadership',
        label: 'Asistente',
        isLeadership: true,
        defaultDisposition: 'pending_operational_decision',
        dispositionReason: 'Puesto de asistente de gerencia; requiere relaciones aprobadas en position_activities.',
    }),
    makeStationDef({
        station: 'SHIFT_LEADER_MALE',
        group: 'leadership',
        label: 'Shift Leader (M)',
        isLeadership: true,
        defaultDisposition: 'pending_operational_decision',
        dispositionReason: 'Puesto de líder de turno; requiere relaciones aprobadas en position_activities.',
    }),
    makeStationDef({
        station: 'SHIFT_LEADER_FEMALE',
        group: 'leadership',
        label: 'Shift Leader (F)',
        isLeadership: true,
        defaultDisposition: 'pending_operational_decision',
        dispositionReason: 'Puesto de líder de turno; requiere relaciones aprobadas en position_activities.',
    }),
];

/**
 * IDs de relaciones sintéticas insertadas el 2026-10-20 sin aprobación operativa de gerencia.
 * Se excluyen por defecto en código (sin ejecutar DELETE en base de datos) para preservar
 * únicamente las 120 relaciones reales aprobadas y no marcar falsamente como `configured`
 * estaciones pendientes de decisión operativa (`Caja 3`, `TORTILLAS`, `TORTAS/MULITAS`, `Drive-Thru`).
 */
export const UNAPPROVED_SYNTHETIC_MAPPING_IDS_20261020: ReadonlySet<string> = new Set([
    '5a9dcea5-e675-4a81-87ee-34ea2d08b97d',
    'a36075d9-4b28-4a16-90f7-a2169c9659ab',
    '9ab49465-9ada-4335-a92b-26ddcf959c75',
    'a7707a52-e84e-4a07-b346-915e611f9872',
    '7422effb-52f2-490d-86a6-fbb65b7ad039',
    'd7cb4dc0-4df9-4c7d-837a-cb4c36cdb49b',
    'c2a6cf19-0d4f-4644-9771-4bde154651c1',
    '2c57a70c-bce1-4789-bf3f-84ceee0ca9ea',
    '5f432c70-be8c-420d-802a-1eb973d44fa1',
    'b86779de-88ae-40ca-af20-40a6f62b6ad0',
    '16a3e717-8765-4cde-9f2e-36f6456426bd',
    'cb7069c2-d5c9-4dec-9317-4ed53614a08d',
    '6ff60cae-985e-4ca6-9da3-8ce82c9b003d',
    'd0a0522e-4d27-420a-8054-8611780b039f',
    '5edbfcc1-6f69-4d14-9fa3-29a3242ffbf6',
    'e3a2805c-7871-4cb4-8e52-1884d3c4e3ca',
    '47460bfd-4f72-4379-b879-a29dcc260d7f',
    'badfe80f-be20-477e-ba59-12ca6079a337',
    '2d27c545-f49b-4359-b7a0-6c31be8e9869',
    '746323bf-97ef-4bad-9871-ecf9c1440f59',
    '8b2c4974-4816-4bf8-be7a-bacd1057af52',
    '2e1b7135-5832-4a48-b130-840308f7db61',
    '0b4611ed-b456-4c53-93eb-b990b3121f7f',
    '475677b9-9176-4da0-8570-01d2377ae1b6',
    '03538031-433d-45c5-8854-5e569833cb6c',
    'bf5ca4ea-0061-4020-9133-f4519407ee2c',
    '11cf0ddc-c06a-431c-9ee2-adfc0a511c1d',
    'db5ea3ba-f124-458a-8ae2-dea9a58b9ead',
    '308fd0ae-1dc6-4749-8441-fe11c4b2e271',
    'e3107880-9395-45ee-ba18-aa9680b8f65a',
    '939e4753-8b0e-4fa7-9b80-5d9d6bdbfa4e',
    '103bedc0-7cb2-48e3-a286-2eb9a1df9685',
    '1d6ffc2f-90a5-40f3-a175-dbe8f42d0516',
    'df4b8e85-e6e6-4cec-9e2c-2b5bdc32ae00',
    'ae8e5513-d864-43fc-a7da-a45cac59573e',
    '35211661-e79e-4974-95a2-93065f2006ef',
    'd7f995b5-b892-486b-b1bf-9b3a42d18c7a',
    '44611609-62a8-49df-9189-c1e0d46d6b4f',
    'aa21740d-a786-46a3-8f66-179093f5255a',
    'f5f2d1b4-be77-4f4f-be7c-6e431235f18a',
    '0e7e5a5a-10f5-4d57-9aff-aee95243f820',
    '4607941a-35b4-428a-8ce1-df6d1ebdf12b',
    'c8456c1a-31fd-46c4-99e7-4f251d47f410',
    '1e3f9b1b-31f7-43bd-b8a1-f3fc8679ea37',
    'ef4043db-a0ca-43cd-a156-faa9a8c8ca8a',
    '9ff9f5ea-d09d-49b9-ad90-00206861d539',
    '13cac2bc-fb55-472c-8cea-c4f85eebbc2a',
    'abebcc90-faea-4925-afa3-5eaacb83011d',
    '75376f24-6c9b-42e9-8ded-c99529d5410f',
    '4e1800c7-621d-4d74-89ff-6d6b7a2edb06',
    '09b0024d-a88e-4951-b1a7-8dfcefe24279',
    'e0a8c0c4-7774-4cd5-a930-dc51c22ea057',
    'b942eccf-2055-449e-820f-3b09b300b821',
    'ca0bbe31-35f7-4902-a8b9-dd8cdaee76ba',
    'c4e28991-8f92-4b2e-a549-39c8b3d8b625',
    'af3f7c1f-c482-4369-8b60-1fad34ea6317',
    '5f948d06-9be7-47b5-8783-1b2d0f98c324',
    'ae4410fa-383a-4c22-8444-91ac5c9cf9d7',
    'fd2b3c90-7c8c-4f64-a3f6-86751c7dbdc5',
    '4ab3b099-7416-4753-b2d3-a40368c3eea9',
    '56e07a41-6a39-4107-940c-9a15bd962d9d',
    'f3ed8269-8204-4972-9d22-662bbbcc17f0',
    '27037427-e3d9-4a19-86ce-6bc12f917454',
    '17232f31-d9fd-448c-97fc-987f782d8d7b',
    '2e7bcbe7-2112-4c1d-b030-5b287c4956bc',
    'f1ef47ba-8e60-411a-bd90-b766954fc07c',
    '0314e164-41a7-47d4-aa42-72d817c3aca2',
    'ab6ac044-f82f-4c52-bdcd-61d4cd7528ae',
    'a8e8bf2a-4129-4d48-9e77-cba370318ca4',
    '477a7f00-86f1-4652-b620-296c936eca80',
    'ef40e651-d524-403b-8043-226ee19741e1',
    '8dfa1022-8891-47cf-9a51-9e4b981a8e8a',
]);

/**
 * Filtra las relaciones de `position_activities` excluyendo el lote sintético no aprobado
 * del 2026-10-20, salvo que se habilite explícitamente por configuración.
 */
export function filterApprovedPositionActivities<T extends PositionActivityMappingRecord>(
    rows: T[] | null | undefined,
    includeUnapprovedSyntheticBatch: boolean = false
): T[] {
    if (!Array.isArray(rows) || rows.length === 0) return [];
    if (
        includeUnapprovedSyntheticBatch ||
        process.env.ACTIVIDADES_INCLUDE_UNAPPROVED_20261020_MAPPINGS === 'true'
    ) {
        return rows;
    }
    return rows.filter((row) => !row?.id || !UNAPPROVED_SYNTHETIC_MAPPING_IDS_20261020.has(String(row.id)));
}

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

export const DEFAULT_PILOT_STORES_ACTIVIDADES = 'Slauson,7,9625621e-1b5e-48d7-87ae-7094fab5a4fd';

/**
 * Verifica si una sucursal tiene habilitado el envío operativo de actividades en el correo
 * de publicación de horarios y calendario .ics (Feature Flag de despliegue controlado).
 * Por defecto está cerrado EXCLUSIVAMENTE para Slauson (`Slauson,7,9625621e-1b5e-48d7-87ae-7094fab5a4fd`)
 * cuando no existe configuración explícita. Solo permite `'ALL'` cuando se configura explícitamente.
 */
export function isStorePilotActiveForActivitiesEmail(
    store: StoreScheduleConfig | null | undefined,
    overrideEnabledStoresEnv?: string
): boolean {
    if (!store) return false;
    const configured = (
        overrideEnabledStoresEnv !== undefined
            ? overrideEnabledStoresEnv
            : process.env.ACTIVIDADES_EMAIL_ENABLED_STORES ?? ''
    ).trim();
    const rawFlag = configured || DEFAULT_PILOT_STORES_ACTIVIDADES;
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
 * Valida estrictamente que una fecha tenga formato ISO `YYYY-MM-DD` y corresponda a un día real
 * del calendario (rechazando fechas inexistentes como `2026-02-31` o `2026-13-01`).
 */
export function isValidCalendarDateISO(dateStr: string | null | undefined): boolean {
    if (!dateStr || typeof dateStr !== 'string') return false;
    const clean = dateStr.trim();
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(clean);
    if (!match) return false;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (year < 2020 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return false;
    const dt = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
    return (
        !Number.isNaN(dt.getTime()) &&
        dt.getUTCFullYear() === year &&
        dt.getUTCMonth() === month - 1 &&
        dt.getUTCDate() === day
    );
}

export const ALLOWED_STATION_GROUPS: ReadonlySet<string> = new Set([
    'front',
    'kitchen',
    'drive-thru',
    'drivethru',
    'leadership',
    'extras',
    'salon',
    'cocina',
]);

export function isValidStationGroup(group: string | null | undefined): boolean {
    if (!group || typeof group !== 'string') return false;
    return ALLOWED_STATION_GROUPS.has(group.trim().toLowerCase());
}

/**
 * Detecta si un texto sugiere mezclar cloro (hipoclorito) con otros productos químicos
 * (desengrasante, ácido, amoníaco o jabón/detergente en la misma aplicación).
 */
export function hasUnsafeChemicalMixture(text: string | null | undefined): boolean {
    if (!text || typeof text !== 'string') return false;
    const norm = normalizePhrase(text);
    if (!/\bcloro\b/.test(norm)) return false;
    // Si ya contiene advertencia explícita de NO mezclar cloro, es seguro
    if (/\bnunca\s+mezclar\s+cloro\b|\bno\s+mezclar\s+cloro\b/.test(norm)) return false;
    return /\b(desengrasante|acido|amoniaco|jabon|detergente)\b/.test(norm);
}

/**
 * Sanitiza descripciones operativas para garantizar que NUNCA se sugiera mezclar cloro
 * con desengrasante, ácido, jabón u otros químicos.
 */
export function sanitizeUnsafeProcedureDescription(description: string | null | undefined): string {
    if (!description || typeof description !== 'string') return '';
    let sanitized = description.trim();
    if (!hasUnsafeChemicalMixture(sanitized)) return sanitized;

    sanitized = sanitized
        .replace(
            /tallar con cepillo,\s*cloro y desengrasante/gi,
            'tallar con cepillo y desengrasante aprobado (NUNCA mezclar cloro con desengrasante ni otros químicos)'
        )
        .replace(
            /agua,\s*jab[oó]n y cloro/gi,
            'agua y desengrasante/detergente aprobado (si se desinfecta con cloro diluido, enjuagar antes; NUNCA mezclar cloro con otros químicos)'
        )
        .replace(
            /cloro y desengrasante/gi,
            'desengrasante aprobado (NUNCA mezclar cloro con otros químicos)'
        )
        .replace(
            /desengrasante y cloro/gi,
            'desengrasante aprobado (NUNCA mezclar cloro con otros químicos)'
        );

    if (hasUnsafeChemicalMixture(sanitized)) {
        sanitized = `${sanitized.replace(/\bcloro\b/gi, 'sanitizante aprobado')} (NUNCA mezclar cloro con otros químicos).`;
    }
    return sanitized;
}

/**
 * Evalúa si un procedimiento involucra instrucciones sensibles (azotea/roof, químicos/ácido/cloro,
 * o caja fuerte/efectivo/alarma) o carece de validación de Manager/Safety.
 */
export function evaluateProcedureSafetyReview(proc: {
    id?: string | null;
    activity?: string | null;
    description?: string | null;
    overrides?: Record<string, any> | null;
}): {
    requiresSafetyReview: boolean;
    categories: SafetyReviewCategory[];
    isApprovedBySafetyOrManager: boolean;
    needsReview: boolean;
    hadUnsafeChemicalText: boolean;
} {
    const rawText = `${proc?.activity || ''} ${proc?.description || ''}`;
    const norm = normalizePhrase(rawText);
    const categories: SafetyReviewCategory[] = [];

    if (/\b(roof|azotea|techo|escalera)\b/.test(norm)) {
        categories.push('roof');
    }
    if (/\b(acido|cloro|desengrasante|quimico|quimicos|sanitizante)\b/.test(norm)) {
        categories.push('chemicals');
    }
    if (/\b(caja fuerte|cash drop|retiro de efectivo|alarma|deposito bancario|fondo de caja|corte de caja|cortes de caja)\b/.test(norm)) {
        categories.push('cash_alarm');
    }

    const hadUnsafeChemicalText = hasUnsafeChemicalMixture(proc?.description);
    const explicitPendingReview = Boolean(
        proc?.overrides?.needs_manager_safety_review ||
            proc?.overrides?.pending_safety_approval
    );
    const requiresSafetyReview = categories.length > 0 || hadUnsafeChemicalText || explicitPendingReview;
    const isApprovedBySafetyOrManager =
        Boolean(proc?.overrides?.safety_approved_by) && !hadUnsafeChemicalText && !explicitPendingReview;

    return {
        requiresSafetyReview,
        categories,
        isApprovedBySafetyOrManager,
        needsReview: requiresSafetyReview && !isApprovedBySafetyOrManager,
        hadUnsafeChemicalText,
    };
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

    // Fin de mes / Último día del mes
    if (f.includes('fin de mes') || f.includes('ultimo dia')) {
        if (rawDateCandidate) {
            const [yStr, mStr, dStr] = rawDateCandidate.split('-');
            const y = Number(yStr);
            const m = Number(mStr);
            const dom = Number(dStr);
            if (Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(dom)) {
                const lastDayOfMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
                return dom === lastDayOfMonth;
            }
        }
        return false;
    }

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
 * Resuelve la categoría única efectiva (`'Apertura' | 'Regular' | 'Cierre'`) de una actividad
 * para Checklist y Reportes, garantizando una partición 100% disjunta (cero duplicados entre
 * categorías). Si una actividad `Regular` ocurre en el bloque de mañana/apertura (`06:00–11:59 AM`),
 * su categoría efectiva única pasa a ser `'Apertura'` y deja de contarse en `'Regular'`.
 */
export function resolveEffectiveChecklistCategory(
    rawShiftType: string | null | undefined,
    effectiveTimeStr?: string | null
): 'Apertura' | 'Regular' | 'Cierre' {
    const procCatLower = (rawShiftType || 'Regular').toString().trim().toLowerCase();
    if (procCatLower === 'apertura') return 'Apertura';
    if (procCatLower === 'cierre') return 'Cierre';

    const sortMins = getBusinessDaySortMinutes(effectiveTimeStr);
    if (procCatLower === 'regular' && sortMins >= 360 && sortMins < 720) {
        return 'Apertura';
    }
    return 'Regular';
}

/**
 * Determina si una actividad pertenece a la vista actual del Checklist (`Apertura`, `Regular`, `Cierre` o `Todos`).
 * Cada actividad pertenece a UNA SOLA categoría efectiva (`resolveEffectiveChecklistCategory`),
 * evitando que una actividad Regular desplazada a horario de Apertura se cuente en ambas categorías.
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

    const singleEffectiveCategory = resolveEffectiveChecklistCategory(procCat, effectiveTimeStr).toLowerCase();
    return singleEffectiveCategory === catFilterLower;
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
 * Obtiene el estado de configuración explícito de cualquier estación del catálogo.
 * Una estación solo se marca como `configured` si tiene mappings reales aprobados (`directCount > 0`).
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
    const rawPositionActivities: PositionActivityMappingRecord[] = Array.isArray(subPositionOrActivities)
        ? subPositionOrActivities
        : maybeActivities || [];
    const positionActivities = filterApprovedPositionActivities(rawPositionActivities);

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
            dispositionReason: `Configurada con ${directCount} relación(es) aprobada(s) en position_activities.`,
        };
    }

    const fallbackDisposition =
        catalogEntry?.defaultDisposition && catalogEntry.defaultDisposition !== 'configured'
            ? catalogEntry.defaultDisposition
            : 'pending_operational_decision';

    return {
        positionKey: catalogEntry?.station || cleanMain,
        hasDirectMappings: false,
        hasInheritedMainMappings: false,
        mappingCount: 0,
        disposition: fallbackDisposition,
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
    if (!proc?.overrides || !store) return undefined;
    const storesMap = proc.overrides.stores;
    const extKey = store.external_id ? String(store.external_id) : '';
    const numKey = store.id !== null && store.id !== undefined ? String(store.id) : '';

    const rawOv =
        (extKey && storesMap?.[extKey]) ||
        (numKey && storesMap?.[numKey]) ||
        (extKey && typeof proc.overrides[extKey] === 'object' ? proc.overrides[extKey] : undefined) ||
        (numKey && typeof proc.overrides[numKey] === 'object' ? proc.overrides[numKey] : undefined);

    if (!rawOv || typeof rawOv !== 'object') return undefined;

    return {
        ...rawOv,
        start_time: rawOv.start_time ?? rawOv.startTime,
    };
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
        legacyTasks,
        shiftStartTime,
        shiftEndTime,
        enforceShiftWindow,
        isClosingShift,
    } = params;
    const positionActivities = filterApprovedPositionActivities(params.positionActivities);

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

        // Hallazgo 6: Una asignación AMBOS NO debe saltarse las horas reales de disponibilidad
        // del empleado (`[shiftStartTime, shiftEndTime)`) cuando `enforceShiftWindow` está activo,
        // salvo cuando un procedimiento del catálogo con hora base matutina (06:00-16:59) fue asignado
        // explícitamente en `position_activities` a `PM` o `AMBOS` y se resuelve para el turno `PM`.
        const actSortMins = getBusinessDaySortMinutes(effectiveStartTime);
        const isPmReusedMorningCatalogTask =
            shift === 'PM' &&
            Boolean(
                mapping?.shift &&
                    ['PM', 'AMBOS', 'ALL'].includes(mapping.shift.toString().trim().toUpperCase())
            ) &&
            actSortMins >= 360 &&
            actSortMins < 1020 &&
            doesShiftOverlapPeriod(shiftStartTime, shiftEndTime, 'PM');

        if (
            enforceShiftWindow &&
            shiftStartTime &&
            shiftEndTime &&
            !isPmReusedMorningCatalogTask &&
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

        const rawDescription = (storeOv?.description || proc.description || '').trim();
        const safeDescription = sanitizeUnsafeProcedureDescription(rawDescription);
        const safetyEval = evaluateProcedureSafetyReview({
            id: proc.id,
            activity: title,
            description: rawDescription,
            overrides: proc.overrides,
        });

        return {
            activity_id: proc.id,
            occurrence_key: occurrenceKey,
            title,
            description: safeDescription,
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
            needs_review: safetyEval.needsReview,
            requires_safety_review: safetyEval.requiresSafetyReview,
            safety_review_categories: safetyEval.categories,
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
    const { mainStation, subPosition, tasks, procedures } = params;
    const positionActivities = filterApprovedPositionActivities(params.positionActivities);
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
 * - Partición única por categoría (`resolveEffectiveChecklistCategory`: cero duplicados entre Apertura y Regular)
 * - Sanitización de descripciones químicas y banderas de validación de seguridad (`evaluateProcedureSafetyReview`)
 * - Ordenamiento cronológico de jornada laboral (`06:00 -> 05:59`, `EVENT_NO_TIME` al final sin inventar `00:00`)
 */
export function resolveStoreCatalogActivitiesForDay<T extends CatalogProcedureRecord>(params: {
    procedures: T[];
    store: StoreScheduleConfig | null | undefined;
    businessDateStr: string;
    categoryFilter?: 'Apertura' | 'Regular' | 'Cierre' | 'ALL' | 'Todos' | string;
    storeOffsets?: StoreTimeOffsets;
}): Array<
    T & {
        effective_start_time: string;
        effective_category: 'Apertura' | 'Regular' | 'Cierre';
        raw_shift_type: string;
        requires_safety_review: boolean;
        safety_review_categories: SafetyReviewCategory[];
        needs_review: boolean;
    }
> {
    const { procedures, store, businessDateStr, categoryFilter = 'ALL' } = params;
    const hasDriveThru = Boolean(store?.has_drive_thru);
    const offsets = params.storeOffsets || calculateStoreOffsetsForDate(store, businessDateStr);

    const results: Array<
        T & {
            effective_start_time: string;
            effective_category: 'Apertura' | 'Regular' | 'Cierre';
            raw_shift_type: string;
            requires_safety_review: boolean;
            safety_review_categories: SafetyReviewCategory[];
            needs_review: boolean;
        }
    > = [];

    for (const p of procedures) {
        if (!p || p.role === 'ROLES_MODULE') continue;

        const storeOv = getStoreOverrideForProcedure(p, store);
        if (storeOv?.disabled === true || storeOv?.enabled === false) continue;

        const effectiveFreq = (storeOv?.frequency || p.frequency || 'Diario').toString().trim();
        if (!isFreqMatch(effectiveFreq, businessDateStr, businessDateStr)) continue;

        const effectiveModel = p.store_model || 'AMBOS';
        if (!isStoreModelMatch(effectiveModel, hasDriveThru)) continue;

        const rawCategory = (storeOv?.shift_type || p.shift_type || 'Regular').toString().trim();
        const effectiveTitle = (storeOv?.activity || p.activity || '').toString().trim();
        const rawDesc = (storeOv?.description ?? p.description ?? '').toString();
        const effectiveDesc = sanitizeUnsafeProcedureDescription(rawDesc);
        const rawBaseStart = storeOv?.start_time ?? p.start_time ?? null;
        const hasValidBaseTime = parseTimeToMinutesStrict(rawBaseStart) !== null;
        const baseStartTime = hasValidBaseTime ? rawBaseStart!.trim() : '';

        const adjustedTime = baseStartTime
            ? applyTimeOffset(baseStartTime, rawCategory, offsets, {
                  activityId: p.id,
                  activityTitle: effectiveTitle,
                  overrides: p.overrides,
              })
            : '';

        if (!doesActivityBelongToChecklistView(rawCategory, adjustedTime, categoryFilter)) {
            continue;
        }

        const singleEffectiveCategory = resolveEffectiveChecklistCategory(rawCategory, adjustedTime);
        const safetyEval = evaluateProcedureSafetyReview({
            id: p.id,
            activity: effectiveTitle,
            description: rawDesc,
            overrides: p.overrides,
        });

        results.push({
            ...p,
            activity: effectiveTitle || p.activity,
            description: effectiveDesc,
            shift_type: singleEffectiveCategory,
            raw_shift_type: rawCategory,
            frequency: effectiveFreq,
            start_time: adjustedTime,
            effective_start_time: adjustedTime,
            effective_category: singleEffectiveCategory,
            requires_safety_review: safetyEval.requiresSafetyReview,
            safety_review_categories: safetyEval.categories,
            needs_review: safetyEval.needsReview,
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

/**
 * Resuelve por actividad del Checklist el turno operativo responsable (`'AM' | 'PM'`)
 * desde su horario efectivo (`getEffectiveShiftForChecklist`) y cruza estaciones/empleados
 * asignados en dicho turno (Hallazgo 4: evita asignar actividades Regular de PM/noche a AM por defecto).
 */
export function resolveChecklistActivityResponsibility(params: {
    procedures: Array<{
        id: string;
        shift_type?: string | null;
        raw_shift_type?: string | null;
        shift?: string | null;
        start_time?: string | null;
        effective_start_time?: string | null;
    }>;
    positionActivities: PositionActivityMappingRecord[];
    assignments: Array<{
        assignment_date: string;
        sub_position?: string | null;
        main_station?: string | null;
        employee_id?: string | number | null;
    }>;
    employees: Array<{
        id: string | number;
        first_name?: string | null;
        last_name?: string | null;
        preferred_name?: string | null;
        chosen_name?: string | null;
    }>;
    businessDateStr: string;
    hasDriveThru: boolean;
    fallbackShift?: 'AM' | 'PM';
}): Map<string, { shift: 'AM' | 'PM'; stations: string[]; employees: string[] }> {
    const {
        procedures,
        assignments,
        employees,
        businessDateStr,
        hasDriveThru,
        fallbackShift = 'AM',
    } = params;
    const approvedMappings = filterApprovedPositionActivities(params.positionActivities);
    const storeModel = hasDriveThru ? 'DRIVE_THRU' : 'REGULAR';

    const empNameMap = new Map<string, string>();
    for (const emp of employees || []) {
        const first = emp.preferred_name || emp.chosen_name || emp.first_name || '';
        const displayName = `${first} ${emp.last_name || ''}`.trim();
        if (displayName) empNameMap.set(String(emp.id), displayName);
    }

    const stationToEmployeeNamesByShift: Record<'AM' | 'PM', Map<string, string[]>> = {
        AM: new Map<string, string[]>(),
        PM: new Map<string, string[]>(),
    };

    for (const a of assignments || []) {
        if (a.assignment_date !== businessDateStr || !a.employee_id) continue;
        const rawPos = String(a.sub_position || a.main_station || '').trim();
        if (!rawPos) continue;
        const isPM = /_PM$/i.test(rawPos);
        const isAM = /_AM$/i.test(rawPos);
        if (!isAM && !isPM) continue;
        const shiftBucket: 'AM' | 'PM' = isPM ? 'PM' : 'AM';
        const baseStation = rawPos.replace(/_(AM|PM)$/i, '').trim();
        const empName = empNameMap.get(String(a.employee_id));
        if (!empName) continue;
        const normKey = normalizeText(baseStation);
        const bucketMap = stationToEmployeeNamesByShift[shiftBucket];
        const list = bucketMap.get(normKey) || [];
        if (!list.includes(empName)) list.push(empName);
        bucketMap.set(normKey, list);
    }

    const result = new Map<string, { shift: 'AM' | 'PM'; stations: string[]; employees: string[] }>();

    for (const proc of procedures || []) {
        const effectiveTime = proc.effective_start_time ?? proc.start_time ?? null;
        const rawShift = getEffectiveShiftForChecklist(
            {
                shift_type: proc.raw_shift_type || proc.shift_type,
                shift: proc.shift,
            },
            effectiveTime
        );
        const responsibleShift: 'AM' | 'PM' =
            rawShift === 'AM' || rawShift === 'PM' ? rawShift : fallbackShift;

        const stations: string[] = [];
        const assignedEmployees: string[] = [];
        const bucketMap = stationToEmployeeNamesByShift[responsibleShift];

        for (const pa of approvedMappings) {
            if (pa.activity_id !== proc.id) continue;
            if (!isStoreModelMatch(pa.store_model || undefined, storeModel)) continue;
            const paShift = String(pa.shift || 'AMBOS').toUpperCase().trim();
            if (paShift !== 'AMBOS' && paShift !== 'ALL' && paShift !== responsibleShift) continue;

            const posKey = String(pa.position_key || pa.position_name || '').trim();
            if (posKey && !stations.includes(posKey)) {
                stations.push(posKey);
            }

            const candidates = getPositionMatchCandidates(posKey).map(normalizeText);
            for (const cand of candidates) {
                const names = bucketMap.get(cand) || [];
                for (const name of names) {
                    if (!assignedEmployees.includes(name)) {
                        assignedEmployees.push(name);
                    }
                }
            }
        }

        result.set(proc.id, {
            shift: responsibleShift,
            stations,
            employees: assignedEmployees,
        });
    }

    return result;
}
