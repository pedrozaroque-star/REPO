"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.scheduleBreaksWithDemand = scheduleBreaksWithDemand;
// ─────────────────────────────────────────────────────────────────────────────
//  CONSTANTES GLOBALES
// ─────────────────────────────────────────────────────────────────────────────
// Heat thresholds — NUNCA SE RELAJAN
// La zona visible en el Gantt:
//   ≥ 0.95 = rojo oscuro MAX  → absolutamente bloqueado
//   ≥ 0.85 = rojo fuerte      → meals bloqueados aquí
//   ≥ 0.75 = rojo medio       → rests bloqueados aquí, meals también
//   ≥ 0.65 = naranja          → zona caliente, permitida con preferencia baja
var HEAT_ABSOLUTE = 0.90; // Nada entra aquí — nunca, bajo ningún nivel
var HEAT_MEAL = 0.78; // Meals bloqueados — naranja-rojo medio y arriba
var HEAT_REST = 0.70; // Rests bloqueados — naranja claro y arriba
// Personal spacing (mismo empleado) — piso absoluto, NUNCA bajan
var GAP_RR_MS = 90 * 60000; // rest ↔ rest: 90 min mínimo
var GAP_MM_MS = 120 * 60000; // meal ↔ meal: 120 min mínimo
var GAP_MR_MS = 75 * 60000; // meal ↔ rest: 75 min mínimo ABSOLUTO
// Wave prevention — gaps preferidos entre empleados del mismo rol/categoría
// PUEDEN reducirse si no hay otra opción que no sea zona caliente
var WAVE_SAME_ROLE_MEAL_MS = 45 * 60000; // entre meals del mismo rol
var WAVE_LEADER_MEAL_MS = 30 * 60000; // entre leaders
var WAVE_FOH_BOH_MAX_OVL_MS = 15 * 60000; // máximo overlap FOH↔BOH
var WAVE_SAME_ROLE_REST_MS = 90 * 60000; // entre rests del mismo rol
var WAVE_SAME_CAT_REST_MS = 60 * 60000; // entre rests misma categoría
var WAVE_CROSS_REST_MS = 30 * 60000; // entre rests diferente categoría
// Mínimos de wave en modo relaxed (cuando no hay otra opción fría)
var WAVE_MIN_MEAL_MS = 20 * 60000;
var WAVE_MIN_REST_MS = 15 * 60000;
// Grid de tiempo y offsets legales
var SLOT_STEP_MS = 10 * 60000; // grilla de 10 min alineada a medianoche
var H_MIN_START = 1.0; // mínimo 1h desde inicio del turno
var H_END_BUFFER = 1.0; // ningún break en la última hora del turno
var H_FIRST_MEAL_MAX = 5.0; // CA law: primer meal antes de la 5ta hora
var H_SECOND_MEAL_START = 7.0; // segundo meal no antes de 7h trabajadas
var H_SECOND_MEAL_END = 10.0; // segundo meal no después de 10h trabajadas
// ─────────────────────────────────────────────────────────────────────────────
//  UTILIDADES
// ─────────────────────────────────────────────────────────────────────────────
var ms = function (mins) { return mins * 60000; };
var toIso = function (d) { return d.toISOString(); };
var midMs = function (startMs, durMs) { return startMs + durMs / 2; };
function normalizeHour(h) {
    if (h < 0)
        return h + 24;
    if (h > 23)
        return h - 24;
    return h;
}
function sortChron(arr) {
    return __spreadArray([], arr, true).sort(function (a, b) { return new Date(a.start_time).getTime() - new Date(b.start_time).getTime(); });
}
function getRoleKey(shift) {
    return (shift.job_title || shift.job_id || 'unknown').toLowerCase().trim();
}
function getRoleCategory(rk) {
    if (rk.includes('manager') || rk.includes('leader') ||
        rk.includes('shift') || rk.includes('lead') ||
        rk.includes('assistant') || rk.includes('asistente') ||
        rk.includes('asst') || rk.includes('encargado'))
        return 'leader';
    if (rk.includes('cashier') || rk.includes('cajera') || rk.includes('cajero'))
        return 'foh';
    return 'boh';
}
// ─────────────────────────────────────────────────────────────────────────────
//  LEY CALIFORNIA: breaks requeridos
// ─────────────────────────────────────────────────────────────────────────────
function getRequiredBreaks(startMs, endMs) {
    var h = (endMs - startMs) / 3600000;
    var result = [];
    var restCount = h > 14 ? 4 : h > 10 ? 3 : h > 6 ? 2 : h >= 3.5 ? 1 : 0;
    for (var i = 0; i < restCount; i++)
        result.push({ type: 'rest_10' });
    if (h > 6)
        result.push({ type: 'meal_30' });
    if (h > 10)
        result.push({ type: 'meal_30' });
    return result;
}
// ─────────────────────────────────────────────────────────────────────────────
//  HEATMAP
// ─────────────────────────────────────────────────────────────────────────────
function buildHeatFn(operatingHours) {
    // Curva mock: simula un restaurante típico con rush de mediodía (~12PM) y tarde (~7PM)
    var MOCK = {
        6: 10, 7: 30, 8: 80, 9: 150, 10: 300, 11: 600, 12: 950, 13: 850, 14: 400,
        15: 250, 16: 300, 17: 500, 18: 800, 19: 900, 20: 750, 21: 500, 22: 300, 23: 150,
        0: 50, 1: 20, 2: 10, 3: 5
    };
    var scores = new Map();
    var maxS = operatingHours.length > 0
        ? Math.max.apply(Math, operatingHours.map(function (h) { return Number(h.projected_sales || 0); })) : 0;
    if (maxS < 10) {
        maxS = 950;
        for (var _i = 0, _a = Object.entries(MOCK); _i < _a.length; _i++) {
            var _b = _a[_i], h = _b[0], s = _b[1];
            scores.set(parseInt(h), s / maxS);
        }
    }
    else {
        for (var _c = 0, operatingHours_1 = operatingHours; _c < operatingHours_1.length; _c++) {
            var h = operatingHours_1[_c];
            scores.set(normalizeHour(Number(h.hour)), Number(h.projected_sales || 0) / maxS);
        }
    }
    return function (tMs) { var _a; return (_a = scores.get(normalizeHour(new Date(tMs).getHours()))) !== null && _a !== void 0 ? _a : 0.05; };
}
// Peor score de calor en un span, muestreado cada 5 min
function spanHeat(sMs, eMs, getHeat) {
    var worst = 0;
    for (var t = sMs; t < eMs; t += ms(5)) {
        var sc = getHeat(t);
        if (sc > worst)
            worst = sc;
    }
    return worst;
}
// ─────────────────────────────────────────────────────────────────────────────
//  COHORTES — stagger dentro del grupo de turno similar
// ─────────────────────────────────────────────────────────────────────────────
function assignCohorts(shifts) {
    // Agrupa por bloque de 30 min de inicio + categoría de rol
    // Así cajeras PM que arrancan juntas forman una cohorte y se distribuyen
    var groups = new Map();
    for (var _i = 0, shifts_1 = shifts; _i < shifts_1.length; _i++) {
        var s = shifts_1[_i];
        var block = Math.floor(new Date(s.start_time).getTime() / ms(30));
        var cat = getRoleCategory(getRoleKey(s));
        var key = "".concat(block, "|").concat(cat);
        if (!groups.has(key))
            groups.set(key, []);
        groups.get(key).push(s);
    }
    var _loop_1 = function (group) {
        group.forEach(function (s, i) {
            s._cohortIdx = i;
            s._cohortSize = group.length;
        });
    };
    for (var _a = 0, _b = groups.values(); _a < _b.length; _a++) {
        var group = _b[_a];
        _loop_1(group);
    }
}
// ─────────────────────────────────────────────────────────────────────────────
//  EXPORT PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────────
function scheduleBreaksWithDemand(shifts, operatingHours) {
    var _a, _b;
    console.warn('%c🧠 BREAKS ENGINE V16 — CONSTRAINT-FIRST', 'background:#0f2447;color:#60a5fa;font-size:14px;font-weight:bold;padding:4px 10px;border-radius:4px');
    var getHeat = buildHeatFn(operatingHours);
    // Log del heatmap para diagnóstico
    var heatLog = [];
    for (var h = 6; h <= 26; h++) {
        var hh = normalizeHour(h);
        var sc = getHeat(new Date(2000, 0, 1, hh, 0, 0).getTime());
        if (sc > 0.05)
            heatLog.push("".concat(hh, ":00=").concat(sc.toFixed(2)));
    }
    console.warn("\uD83D\uDCCA HEATMAP: ".concat(heatLog.join(' | ')));
    // ── Augmentar shifts ────────────────────────────────────────────────────
    var augmented = shifts.map(function (s) { return (__assign(__assign({}, s), { breaks_schedule: [] })); });
    assignCohorts(augmented);
    var globalSlots = [];
    // ────────────────────────────────────────────────────────────────────────
    //  FUNCIÓN: ¿Este slot está bloqueado por calor? (DURO — nunca se relaja)
    //  Ahora sólo bloqueamos de forma dura los niveles absolutos ("MAX" Rojo Oscuro).
    //  Las zonas naranjas se penalizan matemáticamente en Score, para permitir fluidez si hay asfixia.
    // ────────────────────────────────────────────────────────────────────────
    function heatBlocks(sMs, eMs, isMeal) {
        var h = spanHeat(sMs, eMs, getHeat);
        if (h >= HEAT_ABSOLUTE)
            return true; // Bloqueo duro solo en MAX
        return false;
    }
    // ────────────────────────────────────────────────────────────────────────
    //  FUNCIÓN: ¿Viola el spacing personal del mismo empleado? (DURO)
    //  - Nunca puede quedar less than GAP_MR_MS (75 min) entre meal y rest propios
    // ────────────────────────────────────────────────────────────────────────
    function personalViolation(sMs, eMs, newType, existing) {
        for (var _i = 0, existing_1 = existing; _i < existing_1.length; _i++) {
            var pb = existing_1[_i];
            var ps = new Date(pb.start_time).getTime();
            var pe = new Date(pb.end_time).getTime();
            // Traslape directo: siempre bloqueado
            if (sMs < pe && eMs > ps)
                return true;
            // Gap mínimo según tipo de par
            var requiredGap = newType === 'rest_10' && pb.type === 'rest_10' ? GAP_RR_MS :
                newType === 'meal_30' && pb.type === 'meal_30' ? GAP_MM_MS :
                    GAP_MR_MS; // cross-type: el más crítico
            // Distancia entre el nuevo break y el existente
            var dist = sMs >= pe ? sMs - pe : ps - eMs;
            if (dist < requiredGap)
                return true;
        }
        return false;
    }
    // ────────────────────────────────────────────────────────────────────────
    //  FUNCIÓN: ¿Viola wave prevention? (SUAVE — puede relajarse)
    //  Pero NUNCA se relaja si eso requiere entrar a zona de calor bloqueada.
    //  mode='normal'  → gaps completos preferidos
    //  mode='relaxed' → gaps mínimos (20 min meals, 15 min rests)
    //  mode='off'     → ignorar wave gaps (solo overlaps duros permanecen)
    // ────────────────────────────────────────────────────────────────────────
    function waveViolation(sMs, eMs, shift, isMeal, mode) {
        var _a;
        var rk = getRoleKey(shift);
        var cat = getRoleCategory(rk);
        var empId = (_a = shift.employee_id) !== null && _a !== void 0 ? _a : null;
        for (var _i = 0, globalSlots_1 = globalSlots; _i < globalSlots_1.length; _i++) {
            var slot = globalSlots_1[_i];
            // Ignorar slots del mismo empleado (ya controlados por personalViolation)
            if (slot.empId !== null && slot.empId === empId)
                continue;
            var overlapMs = Math.max(0, Math.min(eMs, slot.endMs) - Math.max(sMs, slot.startMs));
            var startDiff = Math.abs(sMs - slot.startMs);
            var sameRole = slot.roleKey === rk;
            var sameCat = slot.category === cat;
            var isLeaderConflict = cat === 'leader' && slot.category === 'leader';
            var sameGroupMeal = sameRole || isLeaderConflict;
            var isCrossSect = (cat === 'foh' && slot.category === 'boh') ||
                (cat === 'boh' && slot.category === 'foh');
            if (isMeal && slot.type === 'meal_30') {
                // ── DURO: no traslape mismo rol / leaders ──────────────────
                if (sameGroupMeal && overlapMs > 0)
                    return true;
                // ── DURO: FOH↔BOH máximo 15 min de traslape ───────────────
                if (isCrossSect && overlapMs > WAVE_FOH_BOH_MAX_OVL_MS)
                    return true;
                // ── SUAVE: wave gap mismo rol/leaders ─────────────────────
                if (mode !== 'off' && sameGroupMeal && overlapMs === 0) {
                    var gap = mode === 'relaxed' ? WAVE_MIN_MEAL_MS : WAVE_SAME_ROLE_MEAL_MS;
                    if (startDiff < gap)
                        return true;
                }
                // ── SUAVE: wave gap leader-leader (extra control) ──────────
                if (mode !== 'off' && isLeaderConflict && overlapMs === 0) {
                    var gap = mode === 'relaxed' ? WAVE_MIN_MEAL_MS : WAVE_LEADER_MEAL_MS;
                    if (startDiff < gap)
                        return true;
                }
            }
            if (!isMeal && slot.type === 'rest_10') {
                // ── DURO: ningún rest se traslapa con otro rest ────────────
                if (overlapMs > 0)
                    return true;
                // ── SUAVE: wave gap entre rests ────────────────────────────
                if (mode !== 'off') {
                    var gap = sameRole
                        ? (mode === 'relaxed' ? WAVE_MIN_REST_MS : WAVE_SAME_ROLE_REST_MS)
                        : sameCat
                            ? (mode === 'relaxed' ? WAVE_MIN_REST_MS : WAVE_SAME_CAT_REST_MS)
                            : WAVE_CROSS_REST_MS;
                    if (startDiff < gap)
                        return true;
                }
            }
            if (!isMeal && slot.type === 'meal_30') {
                // Rest no debe traslaparse con el meal de otro empleado
                // (ambos fuera de la línea operativa al mismo tiempo)
                if (overlapMs > 0)
                    return true;
            }
        }
        return false;
    }
    // ────────────────────────────────────────────────────────────────────────
    //  FUNCIÓN: Scoring de un slot válido (menor = mejor)
    //  Entre candidatos que pasaron todos los filtros duros + wave,
    //  se prefiere: zona más fría > lejos de olas > cerca del target
    // ────────────────────────────────────────────────────────────────────────
    function scoreSlot(sMs, durMs, isMeal, targetMs, shift) {
        var _a;
        var eMs = sMs + durMs;
        var h = spanHeat(sMs, eMs, getHeat);
        var rk = getRoleKey(shift);
        var cat = getRoleCategory(rk);
        var empId = (_a = shift.employee_id) !== null && _a !== void 0 ? _a : null;
        // 1. Penalidad por calor — escala agresivamente con temperatura
        //    (ya pasó el bloqueo duro pero seguimos prefiriendo lo más frío)
        var heatPenalty = Math.pow(h, 6) * 1e10
            + (h >= 0.40 ? 5e9 : 0)
            + (h >= 0.55 ? 1e10 : 0)
            + (h >= 0.65 ? 3e10 : 0);
        // 2. Penalidad por distancia al target (preferencia posicional)
        var distPenalty = Math.abs(midMs(sMs, durMs) - targetMs) / ms(1) * 4e6;
        // 3. Penalidad por olas (soft: desincentivar clustering)
        var wavePenalty = 0;
        for (var _i = 0, globalSlots_2 = globalSlots; _i < globalSlots_2.length; _i++) {
            var slot = globalSlots_2[_i];
            if (slot.empId !== null && slot.empId === empId)
                continue;
            // 1. Olas de la misma categoría (distanciamiento social)
            var isGroup = slot.roleKey === rk ||
                (cat === 'leader' && slot.category === 'leader');
            if (isGroup && slot.type === (isMeal ? 'meal_30' : 'rest_10')) {
                var diff = Math.abs(sMs - slot.startMs);
                var ref = isMeal ? WAVE_SAME_ROLE_MEAL_MS : WAVE_SAME_ROLE_REST_MS;
                if (diff < ref) {
                    var prox = 1 - diff / ref;
                    wavePenalty += prox * prox * 4e9;
                }
            }
            // 2. Penalidad MASSIVA (Simétrica) Líder ↔ Subordinado
            // Líderes y subordinados deben huir mutuamente con máxima prioridad,
            // garantizando que el líder siempre esté libre cuando el equipo come.
            var isLeaderFleeing = cat === 'leader' && slot.category !== 'leader';
            var isSubordinateFleeing = cat !== 'leader' && slot.category === 'leader';
            if (isLeaderFleeing || isSubordinateFleeing) {
                var overlapMs = Math.max(0, Math.min(eMs, slot.endMs) - Math.max(sMs, slot.startMs));
                if (overlapMs > 0) {
                    var overlapRatio = overlapMs / ms(30); // Penlaización proporcional (minimizador de colisión)
                    if (isMeal && slot.type === 'meal_30') {
                        wavePenalty += 5e11 * overlapRatio; // Meal vs Meal cruzado jerarquías
                    }
                    else {
                        wavePenalty += 5e8 * overlapRatio;
                    }
                }
            }
        }
        return heatPenalty + distPenalty + wavePenalty;
    }
    // ────────────────────────────────────────────────────────────────────────
    //  FUNCIÓN: Encuentra el target más frío dentro de una ventana
    //  Para turnos PM donde el centro de la ventana cae en zona caliente,
    //  esto evita que el "target ideal" apunte al MAX.
    // ────────────────────────────────────────────────────────────────────────
    function coolTarget(wStartMs, wEndMs, durMs) {
        var best = wStartMs, bestH = Infinity;
        for (var t = wStartMs; t <= wEndMs - durMs; t += SLOT_STEP_MS) {
            var h = spanHeat(t, t + durMs, getHeat);
            if (h < bestH) {
                bestH = h;
                best = t;
            }
        }
        return midMs(best, durMs);
    }
    // ────────────────────────────────────────────────────────────────────────
    //  FUNCIÓN PRINCIPAL: Encontrar el mejor slot para un break
    //
    //  Fase 1: Filtro duro  → elimina heat bloqueado + violaciones personales
    //  Fase 2: Filtro wave  → normal → relaxed → off (en ese orden)
    //  Fase 3: Scoring      → entre válidos, menor costo gana
    //  Fallback: si nada pasa Fase 1 → slot más frío disponible (ignora gaps
    //            personales excepto traslape directo, NUNCA ignora heat absoluto)
    // ────────────────────────────────────────────────────────────────────────
    function findSlot(wStartMs, wEndMs, durationMins, personalBreaks, shift, isMeal, targetMs) {
        var _a;
        var durMs = ms(durationMins);
        var type = isMeal ? 'meal_30' : 'rest_10';
        // Generar grilla de candidatos alineada a medianoche en pasos de 10 min
        // PREVENCIÓN DE MEAL PENALTY: Aunque la ley dice "comenzar antes de finalizar la 5ta hora",
        // restamos - durMs (30 min) a wEndMs asegurando un colchón sagrado.
        // Si el límite se ajusta exacto a su 5ta hora, un minuto tarde al checador de reloj lo quiebra todo.
        var gridFirst = Math.ceil(wStartMs / SLOT_STEP_MS) * SLOT_STEP_MS;
        var candidates = [];
        for (var t = gridFirst; t <= wEndMs - durMs; t += SLOT_STEP_MS) {
            candidates.push(t);
        }
        if (candidates.length === 0) {
            console.warn("\u26A0\uFE0F  Ventana vac\u00EDa para ".concat(shift.employee_name, " \u2014 usando wStart"));
            return new Date(wStartMs);
        }
        // ── Fase 1: Filtro duro ─────────────────────────────────────────────
        var rk = getRoleKey(shift);
        var cat = getRoleCategory(rk);
        var empId = (_a = shift.employee_id) !== null && _a !== void 0 ? _a : null;
        var hardValid = candidates.filter(function (t) {
            if (heatBlocks(t, t + durMs, isMeal))
                return false;
            if (personalViolation(t, t + durMs, type, personalBreaks))
                return false;
            // Regla Estructural Inviolable: JAMÁS empalmar mismo rol o líder con líder en Fase 1
            for (var _i = 0, globalSlots_3 = globalSlots; _i < globalSlots_3.length; _i++) {
                var slot = globalSlots_3[_i];
                if (slot.empId !== null && slot.empId === empId)
                    continue;
                var overlapMs = Math.max(0, Math.min(t + durMs, slot.endMs) - Math.max(t, slot.startMs));
                if (overlapMs > 0) {
                    var isSameRole = slot.roleKey === rk;
                    var isLeaderConflict = cat === 'leader' && slot.category === 'leader';
                    if (isSameRole || isLeaderConflict) {
                        return false;
                    }
                }
            }
            return true;
        });
        // ── Fase 2: Filtro wave (normal → relaxed → off) ────────────────────
        var pool = [];
        // Intento 1: wave normal
        pool = hardValid.filter(function (t) { return !waveViolation(t, t + durMs, shift, isMeal, 'normal'); });
        // Intento 2: wave relaxed (si no hay opciones normales)
        if (pool.length === 0) {
            pool = hardValid.filter(function (t) { return !waveViolation(t, t + durMs, shift, isMeal, 'relaxed'); });
            if (pool.length > 0) {
                console.warn("\u26A0\uFE0F  Wave RELAXED para ".concat(isMeal ? 'meal' : 'rest', " \u2014 ").concat(shift.employee_name || shift.employee_id));
            }
        }
        // Intento 3: wave off (si aún no hay opciones — mantiene heat + personal)
        if (pool.length === 0) {
            pool = hardValid;
            if (pool.length > 0) {
                console.warn("\u26A0\uFE0F  Wave OFF para ".concat(isMeal ? 'meal' : 'rest', " \u2014 ").concat(shift.employee_name || shift.employee_id));
            }
        }
        // ── Fallback: ningún slot pasó heat + personal ──────────────────────
        // Esto solo ocurre en turnos donde TODA la ventana legal es zona caliente.
        // En ese caso tomamos el slot MENOS caliente disponible que sea ESTRUCTURALMENTE LEGAL 
        // (es decir, ignora wave soft preferentials, ¡pero NUNCA permite empalmes ilegales!)
        if (pool.length === 0) {
            console.warn("\uD83D\uDD34 HEAT FALLBACK \u2014 ".concat(isMeal ? 'meal' : 'rest', " para ").concat(shift.employee_name || shift.employee_id, ". Toda la ventana es zona caliente."));
            var fallback = candidates
                .filter(function (t) {
                var _a;
                // 1. Personal Overlap Directo (Mismo Empleado) - INVIOLABLE
                // No podemos permitir "back-to-back" breaks para el mismo empleado nunca.
                for (var _i = 0, personalBreaks_1 = personalBreaks; _i < personalBreaks_1.length; _i++) {
                    var pb = personalBreaks_1[_i];
                    var ps = new Date(pb.start_time).getTime();
                    var pe = new Date(pb.end_time).getTime();
                    // Traslape directo (borde a borde) o gap menor a 45 minutos.
                    var dist = t >= pe ? t - pe : ps - (t + durMs);
                    if (dist < 45 * 60000)
                        return false;
                }
                // 2. Global Overlaps Estructurales - ILEGALES
                // NUNCA empalmamos mismo rol; líderes no se empalman.
                // PERO DEBEMOS PERMITIR empalmes cross-role porque matemáticamente 
                // no caben 15 empleados sin tocarse.
                var rk = getRoleKey(shift);
                var cat = getRoleCategory(rk);
                var empId = (_a = shift.employee_id) !== null && _a !== void 0 ? _a : null;
                for (var _b = 0, globalSlots_4 = globalSlots; _b < globalSlots_4.length; _b++) {
                    var slot = globalSlots_4[_b];
                    if (slot.empId !== null && slot.empId === empId)
                        continue;
                    var overlapMs = Math.max(0, Math.min(t + durMs, slot.endMs) - Math.max(t, slot.startMs));
                    if (overlapMs > 0) {
                        var isSameRole = slot.roleKey === rk;
                        var isLeaderConflict = cat === 'leader' && slot.category === 'leader';
                        // Mismos roles o líderes no pueden empalmarse bajo ninguna circunstancia
                        if (isSameRole || isLeaderConflict) {
                            return false;
                        }
                    }
                }
                // NOTA: Ignoramos heatBlocks(). Si llegamos aquí, ACEPTAMOS LA ZONA ROJA
                // a cambio de no violar la ley personal y el de mismo rol.
                return true;
            })
                .sort(function (a, b) { return spanHeat(a, a + durMs, getHeat) - spanHeat(b, b + durMs, getHeat); });
            if (fallback.length > 0)
                return new Date(fallback[0]);
            // Caso extremo absoluto: matemáticamente imposible sin empalmar o salir de la ventana.
            console.warn("\uD83D\uDCA5 FALLBACK TOTAL EXHAUSTO para ".concat(shift.employee_name, ". Imposibilidad matem\u00E1tica detectada."));
            return new Date(wStartMs);
        }
        // ── Fase 3: Scoring — menor costo gana ─────────────────────────────
        var bestSlot = pool[0];
        var bestCost = Infinity;
        for (var _i = 0, pool_1 = pool; _i < pool_1.length; _i++) {
            var t = pool_1[_i];
            var cost = scoreSlot(t, durMs, isMeal, targetMs, shift);
            if (cost < bestCost) {
                bestCost = cost;
                bestSlot = t;
            }
        }
        return new Date(bestSlot);
    }
    // ────────────────────────────────────────────────────────────────────────
    //  ORDEN DE PROCESAMIENTO: shifts con ventana de meal más estrecha primero
    //  (los más restringidos por el calor se asignan primero para no dejarlos
    //   sin opciones cuando los demás ya ocuparon los slots fríos)
    // ────────────────────────────────────────────────────────────────────────
    function countCoolMealSlots(shift) {
        var sMs = new Date(shift.start_time).getTime();
        var eMs = new Date(shift.end_time).getTime();
        var wEnd = Math.min(sMs + ms(60 * H_FIRST_MEAL_MAX), eMs - ms(60 * H_END_BUFFER));
        var wStart = sMs + ms(60 * H_MIN_START);
        var cool = 0;
        for (var t = wStart; t <= wEnd - ms(30); t += SLOT_STEP_MS) {
            if (!heatBlocks(t, t + ms(30), true))
                cool++;
        }
        return cool;
    }
    // Ordenar: menos slots fríos disponibles → se procesa primero
    var processed = __spreadArray([], augmented, true).sort(function (a, b) { return countCoolMealSlots(a) - countCoolMealSlots(b); });
    var _loop_2 = function (shift) {
        var sMs = new Date(shift.start_time).getTime();
        var eMs = new Date(shift.end_time).getTime();
        var req = getRequiredBreaks(sMs, eMs);
        var meals = req.filter(function (b) { return b.type === 'meal_30'; });
        var restCount = req.filter(function (b) { return b.type === 'rest_10'; }).length;
        var endBuf = eMs - ms(60 * H_END_BUFFER);
        // Cohort: distribuir empleados del mismo grupo a lo largo de la ventana
        // en lugar de apuntar todos al mismo target
        var cohortIdx = (_a = shift._cohortIdx) !== null && _a !== void 0 ? _a : 0;
        var cohortSize = (_b = shift._cohortSize) !== null && _b !== void 0 ? _b : 1;
        meals.forEach(function (_, mealIdx) {
            var _a;
            var wStartMs;
            var wEndMs;
            if (mealIdx === 0) {
                // CA law: primer meal antes de la 5ta hora trabajada
                // El usuario pidió: "se pueden adelantar lunches antes de los breaks si es necesario, 
                // respetando una hora despues de haber iniciado turno".
                var minOff = 1.0;
                wStartMs = sMs + ms(60 * minOff);
                wEndMs = Math.min(sMs + ms(60 * H_FIRST_MEAL_MAX), endBuf);
            }
            else {
                // Segundo meal: entre la 7a y 10a hora trabajada
                wStartMs = sMs + ms(60 * H_SECOND_MEAL_START);
                wEndMs = Math.min(sMs + ms(60 * H_SECOND_MEAL_END), endBuf);
            }
            // Garantizar ventana mínima de 60 min
            if (wEndMs - wStartMs < ms(60)) {
                wEndMs = Math.min(endBuf, wStartMs + ms(90));
            }
            // ── Cohort stagger ────────────────────────────────────────────
            // Distribuir cada miembro del cohorte en una fracción diferente
            // de la ventana, LUEGO snappear al punto más frío cerca de ahí.
            //
            // Esto evita que los 4 PM cashiers apunten todos al mismo target.
            // En vez de eso, uno va al inicio de ventana, otro al centro, etc.
            var frac = cohortSize > 1
                ? cohortIdx / (cohortSize - 1)
                : 0.5;
            var rawTarget = wStartMs + (wEndMs - wStartMs) * frac;
            // Buscar el punto más frío dentro de ±40 min del target crudo
            var snapStart = Math.max(wStartMs, rawTarget - ms(40));
            var snapEnd = Math.min(wEndMs, rawTarget + ms(40));
            var targetMs = coolTarget(snapStart, snapEnd, ms(30));
            var best = findSlot(wStartMs, wEndMs, 30, shift.breaks_schedule, shift, true, targetMs);
            var bestEnd = new Date(best.getTime() + ms(30));
            shift.breaks_schedule.push({
                type: 'meal_30',
                start_time: toIso(best),
                end_time: toIso(bestEnd),
                status: 'scheduled'
            });
            var rk = getRoleKey(shift);
            globalSlots.push({
                type: 'meal_30',
                startMs: best.getTime(),
                endMs: bestEnd.getTime(),
                roleKey: rk,
                category: getRoleCategory(rk),
                empId: (_a = shift.employee_id) !== null && _a !== void 0 ? _a : null
            });
            console.warn("\uD83C\uDF7D\uFE0F  ".concat(shift.employee_name || shift.employee_id, " meal#").concat(mealIdx + 1) +
                " \u2192 ".concat(best.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })) +
                " (heat=".concat(spanHeat(best.getTime(), bestEnd.getTime(), getHeat).toFixed(2), ")"));
        });
        shift.breaks_schedule = sortChron(shift.breaks_schedule);
    };
    // ══════════════════════════════════════════════════════════════════════════
    //  PASS 1 — MEALS PRIMERO
    //
    //  Razón: Los rests deben segmentarse ALREDEDOR de los meals.
    //  Si asignamos rests primero, no podemos garantizar la distribución correcta.
    // ══════════════════════════════════════════════════════════════════════════
    for (var _i = 0, processed_1 = processed; _i < processed_1.length; _i++) {
        var shift = processed_1[_i];
        _loop_2(shift);
    }
    var _loop_3 = function (shift) {
        var sMs = new Date(shift.start_time).getTime();
        var eMs = new Date(shift.end_time).getTime();
        var req = getRequiredBreaks(sMs, eMs);
        var rests = req.filter(function (b) { return b.type === 'rest_10'; });
        if (rests.length === 0)
            return "continue";
        var minStart = sMs + ms(60 * H_MIN_START);
        var endBuf = eMs - ms(60 * H_END_BUFFER);
        var meals = sortChron(shift.breaks_schedule.filter(function (b) { return b.type === 'meal_30'; })).map(function (m) { return ({
            sMs: new Date(m.start_time).getTime(),
            eMs: new Date(m.end_time).getTime()
        }); });
        var rawSegments = [];
        var safeStart = minStart;
        for (var _e = 0, meals_1 = meals; _e < meals_1.length; _e++) {
            var m = meals_1[_e];
            if (m.sMs > safeStart) {
                rawSegments.push({ sMs: safeStart, eMs: m.sMs });
            }
            safeStart = m.eMs;
        }
        if (endBuf > safeStart) {
            rawSegments.push({ sMs: safeStart, eMs: endBuf });
        }
        // Descartar segmentos donde es físicamente imposible meter un Rest separado
        // Queremos al menos 45 min de espacio para que no choque con el meal
        var validSegments = rawSegments.filter(function (seg) { return (seg.eMs - seg.sMs) >= ms(45); });
        if (validSegments.length === 0) {
            // Rescate de emergencia, agarramos todo el turno
            validSegments.push({ sMs: minStart, eMs: endBuf });
        }
        var totalValidMs = validSegments.reduce(function (sum, seg) { return sum + (seg.eMs - seg.sMs); }, 0);
        // ── Asignar cada rest proporcionalmente en el espacio válido ─────────────
        rests.forEach(function (_, restIdx) {
            var _a;
            var idealTargetMs = totalValidMs * ((restIdx + 0.5) / rests.length);
            var accum = 0;
            var targetSeg = validSegments[validSegments.length - 1];
            for (var _i = 0, validSegments_1 = validSegments; _i < validSegments_1.length; _i++) {
                var seg = validSegments_1[_i];
                var w = seg.eMs - seg.sMs;
                if (idealTargetMs <= accum + w) {
                    targetSeg = seg;
                    break;
                }
                accum += w;
            }
            var wStart = targetSeg.sMs;
            var wEnd = targetSeg.eMs;
            // Ya no es necesario forzar expansiones porque validSegments siempre >= 45m
            // Target: punto central del gap que le toca
            var rawMid = targetSeg.sMs + (idealTargetMs - accum);
            var targetMs = coolTarget(rawMid - ms(20), rawMid + ms(20), ms(10));
            var best = findSlot(wStart, wEnd, 10, shift.breaks_schedule, shift, false, targetMs);
            var bestEnd = new Date(best.getTime() + ms(10));
            shift.breaks_schedule.push({
                type: 'rest_10',
                start_time: toIso(best),
                end_time: toIso(bestEnd),
                status: 'scheduled'
            });
            var rk = getRoleKey(shift);
            globalSlots.push({
                type: 'rest_10',
                startMs: best.getTime(),
                endMs: bestEnd.getTime(),
                roleKey: rk,
                category: getRoleCategory(rk),
                empId: (_a = shift.employee_id) !== null && _a !== void 0 ? _a : null
            });
            shift.breaks_schedule = sortChron(shift.breaks_schedule);
        });
    };
    // ══════════════════════════════════════════════════════════════════════════
    //  PASS 2 — RESTS (segmentados alrededor de los meals ya asignados)
    //
    //  Segmentación:
    //  0 meals → rests distribuidos uniformemente en el turno
    //  1 meal  → 1 rest: en el segmento más largo (antes o después del meal)
    //            2 rests: 1 antes del meal, 1 después
    //  2 meals → 3 rests: antes de meal1, entre meal1 y meal2, después de meal2
    // ══════════════════════════════════════════════════════════════════════════
    for (var _c = 0, processed_2 = processed; _c < processed_2.length; _c++) {
        var shift = processed_2[_c];
        _loop_3(shift);
    }
    // ══════════════════════════════════════════════════════════════════════════
    //  DIAGNÓSTICO FINAL — log de todo lo asignado para verificación
    // ══════════════════════════════════════════════════════════════════════════
    console.warn('─'.repeat(60));
    console.warn('📋 RESUMEN FINAL DE BREAKS ENGINE V16:');
    var violations = 0;
    for (var _d = 0, augmented_1 = augmented; _d < augmented_1.length; _d++) {
        var shift = augmented_1[_d];
        var sched = sortChron(shift.breaks_schedule);
        var log = sched.map(function (b) {
            var t = new Date(b.start_time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
            var h = spanHeat(new Date(b.start_time).getTime(), new Date(b.end_time).getTime(), getHeat);
            var hFlag = h >= HEAT_MEAL ? '🔴' : h >= HEAT_REST ? '🟠' : h >= 0.50 ? '🟡' : '🟢';
            return "".concat(b.type === 'meal_30' ? '🍽️' : '☕', " ").concat(t, " ").concat(hFlag).concat(h.toFixed(2));
        }).join('  |  ');
        // Verificar violaciones de spacing personal
        for (var i = 0; i < sched.length; i++) {
            for (var j = i + 1; j < sched.length; j++) {
                var a = sched[i], b = sched[j];
                var ae = new Date(a.end_time).getTime();
                var bs = new Date(b.start_time).getTime();
                var gap = bs - ae;
                var req = a.type === b.type
                    ? (a.type === 'rest_10' ? GAP_RR_MS : GAP_MM_MS)
                    : GAP_MR_MS;
                if (gap < req) {
                    console.warn("\uD83D\uDEA8 VIOLATION: ".concat(shift.employee_name, " gap=").concat(Math.round(gap / 60000), "min < req=").concat(Math.round(req / 60000), "min"));
                    violations++;
                }
            }
        }
        console.warn("\uD83D\uDC64 ".concat((shift.employee_name || shift.employee_id || '?').toString().padEnd(22), " | ").concat(log));
    }
    if (violations === 0) {
        console.warn('✅ Sin violaciones de spacing personal detectadas');
    }
    else {
        console.warn("\uD83D\uDEA8 ".concat(violations, " violaciones de spacing detectadas \u2014 revisar turnos cortos o ventanas saturadas"));
    }
    console.warn('─'.repeat(60));
    return augmented;
}
