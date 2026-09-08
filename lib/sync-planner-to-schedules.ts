/**
 * @module sync-planner-to-schedules
 * @description Sincroniza los turnos publicados de Managers y Asistentes desde el Planificador (tabla `shifts`)
 * hacia la matriz quincenal de Supervisores (`schedules`), garantizando que cuando un gerente publica su horario
 * semanal, la cobertura de liderazgo se refleje de inmediato y sin doble captura en el módulo de Horarios.
 * 
 * @businessRules
 * 1. Solo se sincronizan turnos en estado 'published' (ignora borradores).
 * 2. Solo se sincronizan colaboradores de liderazgo (Managers y Asistentes de Gerente). Los turnos de cocina,
 *    cajas y limpieza se quedan exclusivamente en el Planificador.
 * 3. Los turnos de los Supervisores nunca se sobreescriben ni se eliminan; el supervisor mantiene el control
 *    de sus turnos de visita y comodín de apoyo.
 * 4. Conversión estricta de huso horario 'America/Los_Angeles' (Pacific Time) para traducir timestamps UTC de
 *    `shifts` a formatos locales 'HH:mm' compatibles con el semáforo AM/PM.
 * 5. Reemplazo atómico de semana: para los gerentes y asistentes de esa tienda, se limpian sus turnos previos
 *    en el rango publicado antes de insertar la nueva verdad oficial del Planificador.
 * 
 * @dataFlow
 * - Lee de: `stores`, `users`, `toast_employees`, `shifts`
 * - Escribe en: `schedules`
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient } from './supabase';

const PRESETS = [
    { id: 'apertura', label: 'Apertura', start: '08:00', end: '16:00' },
    { id: 'am', label: 'Mañana', start: '09:00', end: '17:00' },
    { id: 'inter', label: 'Intermedio', start: '14:00', end: '22:00' },
    { id: 'pm', label: 'Tarde/Noche', start: '17:00', end: '01:00' },
    { id: 'cierre', label: 'Cierre', start: '17:00', end: '02:00' },
    { id: 'cierre_fds', label: 'Cierre FDS', start: '17:00', end: '04:00' },
    { id: 'visita', label: 'Visita Sup.', start: '09:00', end: '17:00' },
];

/**
 * Convierte un timestamp ISO UTC o cadena de hora al formato local 'HH:mm' en America/Los_Angeles.
 */
export function formatToLATime(timeInput: string | null | undefined): string {
    if (!timeInput) return '00:00';
    if (!timeInput.includes('T')) {
        return timeInput.slice(0, 5);
    }
    try {
        const d = new Date(timeInput);
        return new Intl.DateTimeFormat('en-GB', {
            timeZone: 'America/Los_Angeles',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        }).format(d);
    } catch {
        return '00:00';
    }
}

/**
 * Convierte un timestamp ISO UTC a la fecha local 'YYYY-MM-DD' en America/Los_Angeles.
 */
export function formatToLADate(dateOrIso: string | null | undefined): string {
    if (!dateOrIso) return '';
    if (!dateOrIso.includes('T')) {
        return dateOrIso;
    }
    try {
        const d = new Date(dateOrIso);
        return new Intl.DateTimeFormat('en-CA', {
            timeZone: 'America/Los_Angeles',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }).format(d);
    } catch {
        return '';
    }
}

function normalizeText(text: string | null | undefined): string {
    return (text || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]/g, '')
        .trim();
}

function matchPresetLabel(start: string, end: string): string {
    const s = start.slice(0, 5);
    const e = end.slice(0, 5);
    const preset = PRESETS.find(p => p.start === s && p.end === e);
    if (preset) return preset.label;

    const [sh] = s.split(':').map(Number);
    if (sh <= 9) return 'Apertura';
    if (sh >= 16) return 'Cierre';
    return 'Custom';
}

export interface SyncPlannerParams {
    storeExternalId?: string;
    storeNumericId?: number;
    startDate: string; // 'YYYY-MM-DD'
    endDate: string;   // 'YYYY-MM-DD'
    customClient?: SupabaseClient;
}

export interface SyncPlannerResult {
    success: boolean;
    storeId: number;
    storeName: string;
    syncedShiftsCount: number;
    leadershipUsersCount: number;
    details: string;
}

/**
 * Sincroniza los turnos de liderazgo de una tienda y semana desde `shifts` hacia `schedules`.
 */
export async function syncPlannerToSchedules(params: SyncPlannerParams): Promise<SyncPlannerResult> {
    const supabase = params.customClient || await getSupabaseClient();
    const { storeExternalId, storeNumericId, startDate, endDate } = params;

    // 1. Resolver tienda
    let storeQuery = supabase.from('stores').select('id, name, external_id');
    if (storeNumericId) {
        storeQuery = storeQuery.eq('id', storeNumericId);
    } else if (storeExternalId) {
        storeQuery = storeQuery.eq('external_id', storeExternalId);
    } else {
        throw new Error('Debe proveer storeExternalId o storeNumericId para sincronizar.');
    }

    const { data: store, error: storeErr } = await storeQuery.single();
    if (storeErr || !store) {
        throw new Error(`Tienda no encontrada: ${storeErr?.message || 'ID inválido'}`);
    }

    // 2. Obtener usuarios encargados de la sucursal (Managers y Asistentes)
    const { data: storeUsers, error: usersErr } = await supabase
        .from('users')
        .select('id, full_name, email, role, store_id, toast_guid')
        .eq('store_id', store.id)
        .eq('is_active', true);

    if (usersErr) {
        throw new Error(`Error consultando usuarios de la tienda: ${usersErr.message}`);
    }

    const leadershipUsers = (storeUsers || []).filter(u => {
        const role = (u.role || '').toLowerCase();
        return ['manager', 'gerente', 'asistente', 'asst'].some(r => role.includes(r));
    });

    if (leadershipUsers.length === 0) {
        return {
            success: true,
            storeId: store.id,
            storeName: store.name,
            syncedShiftsCount: 0,
            leadershipUsersCount: 0,
            details: 'No se encontraron managers o asistentes activos en users para esta tienda.'
        };
    }

    // 3. Vincular usuarios con toast_employees
    const userGuids = leadershipUsers.map(u => u.toast_guid).filter(Boolean) as string[];
    let toastEmployees: any[] = [];

    if (userGuids.length > 0) {
        const { data: empsByGuid } = await supabase
            .from('toast_employees')
            .select('id, toast_guid, first_name, last_name, email')
            .in('toast_guid', userGuids);
        if (empsByGuid) toastEmployees = [...toastEmployees, ...empsByGuid];
    }

    // Fallback por nombre para usuarios sin toast_guid
    const missingGuidUsers = leadershipUsers.filter(u => !u.toast_guid);
    if (missingGuidUsers.length > 0) {
        const { data: allStoreEmps } = await supabase
            .from('toast_employees')
            .select('id, toast_guid, first_name, last_name, email')
            .limit(1000);

        if (allStoreEmps) {
            for (const mUser of missingGuidUsers) {
                const normName = normalizeText(mUser.full_name);
                const matched = allStoreEmps.find(e => {
                    const eNorm = normalizeText(`${e.first_name} ${e.last_name}`);
                    return eNorm === normName || (e.email && e.email.toLowerCase() === (mUser.email || '').toLowerCase());
                });
                if (matched && !toastEmployees.some(e => e.id === matched.id)) {
                    toastEmployees.push(matched);
                }
            }
        }
    }

    // Mapa: toast_employee_id -> leadership user
    const employeeToUserMap = new Map<string, any>();
    for (const u of leadershipUsers) {
        const matchedEmp = toastEmployees.find(e => {
            if (u.toast_guid && e.toast_guid === u.toast_guid) return true;
            if (u.email && e.email && u.email.toLowerCase() === e.email.toLowerCase()) return true;
            return normalizeText(u.full_name) === normalizeText(`${e.first_name} ${e.last_name}`);
        });

        if (matchedEmp) {
            employeeToUserMap.set(String(matchedEmp.id), u);
        }
    }

    const matchedToastIds = Array.from(employeeToUserMap.keys());
    if (matchedToastIds.length === 0) {
        return {
            success: true,
            storeId: store.id,
            storeName: store.name,
            syncedShiftsCount: 0,
            leadershipUsersCount: leadershipUsers.length,
            details: 'Ningún manager o asistente pudo ser vinculado con su ID de Toast.'
        };
    }

    // 4. Obtener turnos publicados en shifts para esa semana
    const { data: publishedShifts, error: shiftsErr } = await supabase
        .from('shifts')
        .select('*')
        .eq('store_id', store.external_id)
        .eq('status', 'published')
        .gte('shift_date', startDate)
        .lte('shift_date', endDate)
        .in('employee_id', matchedToastIds);

    if (shiftsErr) {
        throw new Error(`Error consultando turnos publicados en shifts: ${shiftsErr.message}`);
    }

    // 5. Preparar reemplazo atómico en schedules
    const leadershipUserIds = Array.from(new Set(Array.from(employeeToUserMap.values()).map(u => u.id)));

    // A. Limpiar turnos previos de estos gerentes/asistentes en esta tienda y semana
    const { error: deleteErr } = await supabase
        .from('schedules')
        .delete()
        .eq('store_id', store.id)
        .in('user_id', leadershipUserIds)
        .gte('date', startDate)
        .lte('date', endDate);

    if (deleteErr) {
        console.error('Error eliminando turnos previos en schedules:', deleteErr);
    }

    if (!publishedShifts || publishedShifts.length === 0) {
        return {
            success: true,
            storeId: store.id,
            storeName: store.name,
            syncedShiftsCount: 0,
            leadershipUsersCount: leadershipUsers.length,
            details: 'Turnos previos limpiados; no hay turnos de liderazgo publicados en el Planificador para esta semana.'
        };
    }

    // B. Mapear y agrupar por (user_id, date) para respetar la clave única
    const shiftsByUserDate = new Map<string, any[]>();

    for (const shift of publishedShifts) {
        const user = employeeToUserMap.get(String(shift.employee_id));
        if (!user) continue;

        const dateStr = shift.shift_date || formatToLADate(shift.start_time);
        if (!dateStr) continue;

        const key = `${user.id}_${dateStr}`;
        const list = shiftsByUserDate.get(key) || [];
        list.push({ shift, user, dateStr });
        shiftsByUserDate.set(key, list);
    }

    const newScheduleEntries: any[] = [];

    for (const [_, items] of shiftsByUserDate.entries()) {
        const first = items[0];
        const user = first.user;
        const dateStr = first.dateStr;

        // Si hay múltiples turnos el mismo día, calcular el rango de inicio más temprano y fin más tardío
        let earliestStart = formatToLATime(first.shift.start_time);
        let latestEnd = formatToLATime(first.shift.end_time);

        for (let i = 1; i < items.length; i++) {
            const st = formatToLATime(items[i].shift.start_time);
            const et = formatToLATime(items[i].shift.end_time);
            if (st < earliestStart) earliestStart = st;
            if (et > latestEnd) latestEnd = et;
        }

        const label = matchPresetLabel(earliestStart, latestEnd);

        newScheduleEntries.push({
            user_id: user.id,
            store_id: store.id,
            date: dateStr,
            start_time: earliestStart,
            end_time: latestEnd,
            shift_label: label,
            role: user.role || 'manager'
        });
    }

    // C. Upsert masivo en schedules
    if (newScheduleEntries.length > 0) {
        const { error: insertErr } = await supabase
            .from('schedules')
            .upsert(newScheduleEntries, { onConflict: 'user_id,date' });

        if (insertErr) {
            throw new Error(`Error insertando en schedules: ${insertErr.message}`);
        }
    }

    return {
        success: true,
        storeId: store.id,
        storeName: store.name,
        syncedShiftsCount: newScheduleEntries.length,
        leadershipUsersCount: leadershipUsers.length,
        details: `Sincronizados exitosamente ${newScheduleEntries.length} turnos de liderazgo.`
    };
}
