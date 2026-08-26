import { supabase } from '../lib/supabase';

const PRESETS = [
    { id: 'apertura', label: 'Apertura', start: '08:00', end: '16:30', color: 'bg-emerald-50 text-emerald-950 border-emerald-300' },
    { id: 'intermedio', label: 'Intermedio', start: '11:00', end: '19:30', color: 'bg-blue-50 text-blue-950 border-blue-300' },
    { id: 'cierre', label: 'Cierre', start: '17:00', end: '01:30', color: 'bg-amber-50 text-amber-950 border-amber-300' },
    { id: 'madrugada', label: 'Madrugada', start: '20:00', end: '04:30', color: 'bg-purple-50 text-purple-950 border-purple-300' },
];

function getShiftCoverage(startStr: string, endStr: string) {
    if (!startStr || !endStr) return { startMin: 0, endMin: 0 };
    const [sh, sm] = startStr.split(':').map(Number);
    const [eh, em] = endStr.split(':').map(Number);
    const startMin = sh * 60 + sm;
    let endMin = eh * 60 + em;
    if (endMin <= startMin) endMin += 24 * 60;
    return { startMin, endMin };
}

function coversBlock(shiftStart: string, shiftEnd: string, blockStartHour: number, blockEndHour: number): boolean {
    const { startMin, endMin } = getShiftCoverage(shiftStart, shiftEnd);
    const bStart = blockStartHour * 60;
    let bEnd = blockEndHour * 60;
    if (bEnd <= bStart) bEnd += 24 * 60;
    const overlapStart = Math.max(startMin, bStart);
    const overlapEnd = Math.min(endMin, bEnd);
    const overlap = Math.max(0, overlapEnd - overlapStart);
    return overlap >= 240;
}

function calculateDailyStatus(
    dateStr: string,
    shifts: any[],
    users: any[],
    supervisorShift: any,
    supervisorAvailableAM: boolean = true,
    supervisorAvailablePM: boolean = true
) {
    const managers = users.filter(u => ['manager', 'gerente'].some(r => (u.role || '').toLowerCase().includes(r)));
    const managerIds = new Set(managers.map(m => m.id));
    const storeShifts = shifts.filter(s => managerIds.has(s.user_id) && s.date === dateStr);

    let hasAM = false;
    let hasPM = false;

    storeShifts.forEach(s => {
        if (coversBlock(s.start_time, s.end_time, 0, 17)) hasAM = true;
        if (coversBlock(s.start_time, s.end_time, 17, 6)) hasPM = true;
    });

    let usedSupAM = false;
    let usedSupPM = false;

    if (supervisorShift && supervisorShift.date === dateStr) {
        if (!hasAM && supervisorAvailableAM && coversBlock(supervisorShift.start_time, supervisorShift.end_time, 0, 17)) {
            hasAM = true;
            usedSupAM = true;
        }
        if (!hasPM && supervisorAvailablePM && coversBlock(supervisorShift.start_time, supervisorShift.end_time, 17, 6)) {
            hasPM = true;
            usedSupPM = true;
        }
    }

    if (shifts.length === 0 && !supervisorShift) {
        return { status: 'empty', label: 'Sin Horarios', missingAM: true, missingPM: true, usedSupAM, usedSupPM };
    }

    if (hasAM && hasPM) {
        const isSupervisorAssisted = usedSupAM || usedSupPM;
        return {
            status: isSupervisorAssisted ? 'ok-sup' : 'ok',
            label: isSupervisorAssisted ? 'OK (Sup)' : 'OK',
            missingAM: false,
            missingPM: false,
            usedSupAM,
            usedSupPM
        };
    }

    const missing = [];
    if (!hasAM) missing.push('Falta AM');
    if (!hasPM) missing.push('Falta PM');

    return {
        status: 'bad',
        label: missing.join(', '),
        missingAM: !hasAM,
        missingPM: !hasPM,
        usedSupAM,
        usedSupPM
    };
}

async function runAuditSimulation() {
    console.log('====================================================');
    console.log('🧪 EJECUTANDO SUITE DE PRUEBAS Y AUDITORÍA EN VIVO');
    console.log('====================================================\n');

    let passedTests = 0;
    let totalTests = 0;

    function assert(name: string, condition: boolean, details?: string) {
        totalTests++;
        if (condition) {
            console.log(`✅ [PASS] ${name}`);
            passedTests++;
        } else {
            console.error(`❌ [FAIL] ${name}${details ? ` -> ${details}` : ''}`);
        }
    }

    // 1. Test PRESETS matching with HH:mm:ss vs HH:mm
    const dbShift = { start_time: '08:00:00', end_time: '16:30:00' };
    const matchedPreset = PRESETS.find(p => p.start === dbShift.start_time?.slice(0, 5) && p.end === dbShift.end_time?.slice(0, 5));
    assert('Preset match con HH:mm:ss de PostgreSQL usando .slice(0,5)', matchedPreset?.id === 'apertura');

    // 2. Test overnight shift coverage in coversBlock
    const cierreShift = { start_time: '17:00', end_time: '01:30' }; // 8.5h overnight
    const coversPM = coversBlock(cierreShift.start_time, cierreShift.end_time, 17, 6);
    const coversAM = coversBlock(cierreShift.start_time, cierreShift.end_time, 0, 17);
    assert('Turno de cierre 17:00 a 01:30 cubre bloque PM (>=240 min)', coversPM === true);
    assert('Turno de cierre 17:00 a 01:30 NO cubre bloque AM', coversAM === false);

    // 3. Test safe sorting with null/undefined roles
    const testUsers = [
        { id: 1, full_name: 'Carlos Perez', role: null },
        { id: 2, full_name: 'Estefani Lopez', role: 'supervisor' },
        { id: 3, full_name: 'Alejandro Gomez', role: 'Gerente' },
        { id: 4, full_name: 'Beatriz Morales', role: 'Cajera' }
    ];

    const sortedUsers = [...testUsers].sort((a, b) => {
        const roleA = (a.role || '').toLowerCase();
        const roleB = (b.role || '').toLowerCase();
        const isSupA = roleA.includes('sup');
        const isSupB = roleB.includes('sup');
        if (isSupA && !isSupB) return -1;
        if (!isSupA && isSupB) return 1;

        const isManagerA = ['manager', 'gerente'].some(r => roleA.includes(r));
        const isManagerB = ['manager', 'gerente'].some(r => roleB.includes(r));
        if (isManagerA && !isManagerB) return -1;
        if (!isManagerA && isManagerB) return 1;

        return (a.full_name || '').localeCompare(b.full_name || '');
    });

    assert('Ordenamiento seguro con roles nulos: Supervisor primero', sortedUsers[0].full_name === 'Estefani Lopez');
    assert('Ordenamiento seguro: Gerente segundo', sortedUsers[1].full_name === 'Alejandro Gomez');
    assert('Ordenamiento seguro: Alfabético tercero', sortedUsers[2].full_name === 'Beatriz Morales');
    assert('Ordenamiento seguro: Rol nulo al final sin error', sortedUsers[3].full_name === 'Carlos Perez');

    // 4. Test supervisor wildcard consumption across 2 stores
    const supShift = { user_id: 10, date: '2026-08-25', start_time: '08:00', end_time: '16:30' }; // AM shift
    const store1Users = [{ id: 101, role: 'Gerente' }];
    const store1Shifts = [{ user_id: 101, date: '2026-08-25', start_time: '17:00', end_time: '01:30' }]; // PM only

    const store2Users = [{ id: 102, role: 'Gerente' }];
    const store2Shifts = [{ user_id: 102, date: '2026-08-25', start_time: '17:00', end_time: '01:30' }]; // PM only

    // Store 1 evaluates first with sup available
    let tempSup = { am: true, pm: true };
    const st1Result = calculateDailyStatus('2026-08-25', store1Shifts, store1Users, supShift, tempSup.am, tempSup.pm);
    if (st1Result.usedSupAM) tempSup.am = false;
    if (st1Result.usedSupPM) tempSup.pm = false;

    assert('Tienda 1 toma el comodín AM del supervisor y queda OK (Sup)', st1Result.status === 'ok-sup' && st1Result.usedSupAM === true);

    // Store 2 evaluates second with sup AM consumed
    const st2Result = calculateDailyStatus('2026-08-25', store2Shifts, store2Users, supShift, tempSup.am, tempSup.pm);
    assert('Tienda 2 no recibe comodín AM ya consumido y queda en BAD (Falta AM)', st2Result.status === 'bad' && st2Result.missingAM === true);

    // 5. Test Live Supabase Mutation Smoke Test
    console.log('\n--- 🔌 PROBANDO MUTACIÓN REAL EN SUPABASE (SMOKE TEST) ---');
    try {
        const { data: u, error: uErr } = await supabase.from('users').select('id, store_id, role').limit(1).single();
        if (uErr) throw uErr;

        const testUserId = u?.id;
        const testStoreId = u?.store_id;

        if (testUserId && testStoreId) {
            const testDate = '2099-12-31';
            const testPayload = {
                user_id: testUserId,
                store_id: testStoreId,
                date: testDate,
                start_time: '09:00',
                end_time: '17:30',
                shift_label: 'Prueba Auto',
                role: u.role || 'manager'
            };

            const { error: insertErr } = await supabase.from('schedules').upsert(testPayload, { onConflict: 'user_id,date' });
            assert('Inserción/Upsert en Supabase con { onConflict: "user_id,date" }', !insertErr, insertErr?.message);

            const { error: deleteErr } = await supabase.from('schedules').delete().match({ user_id: testUserId, date: testDate });
            assert('Limpieza (delete) inmediata del registro de prueba en Supabase', !deleteErr, deleteErr?.message);
        } else {
            console.log('⚠️ No se encontraron usuarios de prueba.');
        }
    } catch (e: any) {
        console.error('Error durante smoke test en Supabase:', e.message);
    }

    console.log('\n====================================================');
    console.log(`📊 RESULTADO FINAL: ${passedTests} / ${totalTests} PRUEBAS SUPERADAS`);
    console.log('====================================================\n');
}

runAuditSimulation().catch(console.error);
