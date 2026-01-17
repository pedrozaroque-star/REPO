'use client'

import React, { useState, useEffect, Suspense, useRef, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import ProtectedRoute, { useAuth } from '@/components/ProtectedRoute'
import { getSupabaseClient, formatStoreName } from '@/lib/supabase'
import { motion, AnimatePresence } from 'framer-motion'
import { formatDateLA, formatTimeLA } from '@/lib/checklistPermissions'
import {
    X, Clock, Coffee, Sun, Sunrise, Moon, MoonStar,
    Calendar, User, Save, Trash2, ArrowRight, Sparkles, Zap, Store,
    ChevronLeft, ChevronRight, ShieldCheck, AlertTriangle, AlertCircle,
    Briefcase, Activity, ShieldAlert
} from 'lucide-react'
import SurpriseLoader from '@/components/SurpriseLoader'

// --- CONFIGURACIÓN DE DATOS ---
const PRESETS = [
    { id: 'apertura', label: 'Apertura', start: '08:00', end: '16:00', icon: <Sunrise size={16} />, color: 'bg-amber-100 text-amber-900 group-hover:bg-amber-200' },
    { id: 'am', label: 'Mañana', start: '09:00', end: '17:00', icon: <Sun size={16} />, color: 'bg-emerald-100 text-emerald-900 group-hover:bg-emerald-200' },
    { id: 'inter', label: 'Intermedio', start: '14:00', end: '22:00', icon: <Coffee size={16} />, color: 'bg-blue-100 text-blue-900 group-hover:bg-blue-200' },
    { id: 'pm', label: 'Tarde/Noche', start: '17:00', end: '01:00', icon: <Moon size={16} />, color: 'bg-indigo-100 text-indigo-900 group-hover:bg-indigo-200' },
    { id: 'cierre', label: 'Cierre', start: '17:00', end: '02:00', icon: <MoonStar size={16} />, color: 'bg-purple-100 text-purple-900 group-hover:bg-purple-200' },
    { id: 'cierre_fds', label: 'Cierre FDS', start: '17:00', end: '04:00', icon: <Sparkles size={16} />, color: 'bg-fuchsia-100 text-fuchsia-900 group-hover:bg-fuchsia-200' },
    { id: 'visita', label: 'Visita Sup.', start: '09:00', end: '17:00', icon: <User size={16} />, color: 'bg-cyan-50 text-cyan-800 border-2 border-dashed border-cyan-200' },
]

// --- UTILIDADES ---
const getMonday = (d: Date) => {
    const date = new Date(d);
    const day = date.getDay();
    const diff = date.getDate() - day + (day === 0 ? -6 : 1);
    return new Date(date.setDate(diff));
}
const addDays = (d: Date, days: number) => {
    const result = new Date(d);
    result.setDate(result.getDate() + days);
    return result;
}
const formatDateISO = (d: Date) => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};
const formatDateNice = (d: Date) => {
    const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    return `${d.getDate()} ${months[d.getMonth()]}`;
}
const getDayName = (d: Date) => ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB'][d.getDay()];

// Helper para formato 12h (AM/PM)
const formatTime12h = (time: string) => {
    if (!time) return '';
    try {
        const [hStr, mStr] = time.split(':');
        const hours = parseInt(hStr);
        const ampm = hours >= 12 ? 'PM' : 'AM';
        const hours12 = hours % 12 || 12;
        const minDisplay = mStr === '00' ? '' : `:${mStr}`;
        return `${hours12}${minDisplay} ${ampm}`;
    } catch (e) { return time; }
}

// --- SEMÁFORO (LÓGICA OPERATIVA) ---
// --- HELPER PARA COBERTURA DE HORAS (4 HORAS MINIMO) ---
const getMinutes = (timeStr: string) => {
    if (!timeStr) return 0;
    const [h, m] = timeStr.split(':').map(Number);
    return h * 60 + (m || 0);
};

const coversBlock = (shift: any, blockStartHour: number, blockEndHour: number) => {
    if (!shift || !shift.start_time || !shift.end_time) return false;

    let start = getMinutes(shift.start_time);
    let end = getMinutes(shift.end_time);

    // Manejo de turno nocturno (ej: 5pm a 1am -> 17 a 25)
    if (end < start) end += 24 * 60;

    // Definir bloque objetivo AM (0-17) o PM (17-30)
    const blockStart = blockStartHour * 60;
    const blockEnd = blockEndHour * 60;

    // Calcular intersección
    const overlapStart = Math.max(start, blockStart);
    const overlapEnd = Math.min(end, blockEnd);

    // Duración de la intersección en minutos
    const overlap = overlapEnd - overlapStart;

    // Regla: Debe cubrir al menos 4 horas (240 minutos) del bloque
    return overlap >= 240;
};


// --- SEMÁFORO (LÓGICA OPERATIVA 4H + COMODÍN) ---
// --- SEMÁFORO (LÓGICA OPERATIVA 4H + COMODÍN FINITO) ---
const calculateDailyStatus = (
    dateStr: string,
    storeShifts: any[],
    storeUsers: any[],
    supervisorShift?: any,
    supAvailableAM: boolean = true,
    supAvailablePM: boolean = true
) => {
    const dayShifts = storeShifts.filter(s => s.date === dateStr);

    // 1. Verificar cobertura del PERSONAL DE LA TIENDA
    // AM: Bloque 00:00 - 17:00 (5 PM)
    const storeCoversAM = dayShifts.some(s => coversBlock(s, 0, 17));
    // PM: Bloque 17:00 - 30:00 (6 AM next day)
    const storeCoversPM = dayShifts.some(s => coversBlock(s, 17, 30));

    let finalAM = storeCoversAM;
    let finalPM = storeCoversPM;

    let usedSupAM = false;
    let usedSupPM = false;

    // 2. Verificar cobertura del SUPERVISOR (Comodín Finito)
    if (supervisorShift) {
        // Solo intentar cubrir si la tienda NO lo cubre Y el supervisor está disponible para ese bloque
        if (!finalAM && supAvailableAM && coversBlock(supervisorShift, 0, 17)) {
            finalAM = true;
            usedSupAM = true;
        }
        if (!finalPM && supAvailablePM && coversBlock(supervisorShift, 17, 30)) {
            finalPM = true;
            usedSupPM = true;
        }
    }

    const coveredBySup = usedSupAM || usedSupPM;

    // Retorno extendido para la lógica de consumo
    const baseResult = {
        usedSupAM,
        usedSupPM,
        missingAM: !finalAM,
        missingPM: !finalPM
    };

    // CASO 1: Sin personal capturado (Pendiente) o turnos sin horas validas
    const hasValidShifts = dayShifts.some(s => s.start_time && s.end_time);

    if (dayShifts.length === 0 || !hasValidShifts) {
        return {
            ...baseResult,
            status: 'empty',
            label: 'VACÍO',
            color: 'bg-gray-100 text-gray-400 border-gray-200'
        };
    }

    // CASO 2: Cobertura Total
    if (finalAM && finalPM) {
        return {
            ...baseResult,
            status: coveredBySup ? 'ok-sup' : 'ok',
            label: coveredBySup ? 'CUBIERTO (SUP)' : 'CUBIERTO',
            color: coveredBySup ? 'bg-indigo-100 text-indigo-700 border-indigo-200' : 'bg-emerald-500 text-white shadow-md'
        };
    }

    // CASO 3: Faltas de personal (Solo si ya se empezó a capturar)
    return {
        ...baseResult,
        status: 'bad',
        label: !finalAM && !finalPM ? 'FALTA AM/PM' : (!finalAM ? 'FALTA AM' : 'FALTA PM'),
        color: 'bg-red-500 text-white animate-pulse shadow-md'
    };
}

// --- COMPONENTE UI: PICKER DE SEMANA PERSONALIZADO (Copia Visual) ---
function WeekSelector({ currentDate, onDateChange, weekStart }: { currentDate: Date, onDateChange: (d: Date) => void, weekStart: Date }) {
    const [isOpen, setIsOpen] = useState(false);
    const [viewDate, setViewDate] = useState(new Date(currentDate)); // Para navegar meses sin cambiar selección

    // Sincronizar viewDate si cambia currentDate externamente
    useEffect(() => { setViewDate(new Date(currentDate)); }, [currentDate]);

    // Helpers de Fecha UI
    const MonthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    const ShortMonths = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

    const getDaysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
    const getFirstDayOfMonth = (year: number, month: number) => {
        const day = new Date(year, month, 1).getDay();
        return day === 0 ? 6 : day - 1; // Ajustar para Lunes=0
    };

    const handlePrevMonth = () => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1));
    const handleNextMonth = () => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1));

    const handleDayClick = (dayStr: number) => {
        const selectedDate = new Date(viewDate.getFullYear(), viewDate.getMonth(), dayStr);
        onDateChange(selectedDate); // El padre calculará el Start of Week automáticamente
        setIsOpen(false);
    };

    // Generar Grid
    const daysInMonth = getDaysInMonth(viewDate.getFullYear(), viewDate.getMonth());
    const startOffset = getFirstDayOfMonth(viewDate.getFullYear(), viewDate.getMonth());
    const matrix = [];
    let counter = 1;
    for (let i = 0; i < 6; i++) {
        const row = [];
        for (let j = 0; j < 7; j++) {
            if (i === 0 && j < startOffset) {
                row.push(null);
            } else if (counter > daysInMonth) {
                row.push(null);
            } else {
                row.push(counter++);
            }
        }
        matrix.push(row);
        if (counter > daysInMonth) break;
    }

    // Rango Seleccionado Visual
    const startRange = weekStart;
    const endRange = addDays(weekStart, 13); // Visualmente mostramos 2 semanas en el texto, pero el picker selecciona 1 fecha base.
    // Ajuste: El usuario quiere seleccionar UNA semana. La logica actual maneja 2 semanas.
    // El picker sombreará la semana a la que pertenece el día que se renderiza.

    const isDayInSelectedWeek = (d: number) => {
        const target = new Date(viewDate.getFullYear(), viewDate.getMonth(), d);
        const targetTime = target.getTime();
        // Verificar si está en la semana actual seleccionada (Semana 1)
        const s1Start = new Date(weekStart); s1Start.setHours(0, 0, 0, 0);
        const s1End = addDays(s1Start, 6); s1End.setHours(23, 59, 59, 999);

        // Verificar si está en la semana siguiente (Semana 2) -> Opcional si queremos sombrear las 2 semanas
        // La imagen del usuario muestra 1 semana sombreada (12-18). Vamos a sombrear solo esa semana base para ser fieles a la imagen UI.
        // Pero el sistema usa 2 semanas. Sombrearemos la semana que contiene a la fecha 'currentDate'.

        return targetTime >= s1Start.getTime() && targetTime <= s1End.getTime();
    };

    const isStart = (d: number) => {
        const target = new Date(viewDate.getFullYear(), viewDate.getMonth(), d);
        return target.toDateString() === weekStart.toDateString();
    };
    const isEnd = (d: number) => {
        const target = new Date(viewDate.getFullYear(), viewDate.getMonth(), d);
        const wEnd = addDays(weekStart, 6);
        return target.toDateString() === wEnd.toDateString();
    };

    const dateRangeText = `${ShortMonths[weekStart.getMonth()]} ${weekStart.getDate()}, ${weekStart.getFullYear()}  →  ${ShortMonths[addDays(weekStart, 6).getMonth()]} ${addDays(weekStart, 6).getDate()}, ${addDays(weekStart, 6).getFullYear()}`;

    return (
        <div className="relative flex items-center gap-2 z-[100]">
            {/* Backdrop click closer */}
            {isOpen && <div className="fixed inset-0 z-[80]" onClick={() => setIsOpen(false)}></div>}

            <div className={`flex items-center bg-white rounded-md shadow-sm border p-1 transition-all ${isOpen ? 'border-indigo-300 ring-2 ring-indigo-100' : 'border-gray-200'}`}>
                <button
                    onClick={() => onDateChange(addDays(currentDate, -7))}
                    className="w-7 h-7 flex items-center justify-center hover:bg-gray-50 rounded text-gray-500 hover:text-gray-900 transition-colors border-r border-gray-100"
                >
                    <ChevronLeft size={16} strokeWidth={2.5} />
                </button>

                <div
                    onClick={() => setIsOpen(!isOpen)}
                    className="relative px-3 flex items-center gap-2 text-sm text-gray-700 hover:bg-gray-50 h-7 rounded mx-0.5 cursor-pointer select-none min-w-[200px] justify-center"
                >
                    <Calendar size={14} className="text-gray-400 mb-0.5 group-hover:text-indigo-500 transition-colors" />
                    <span className="tabular-nums tracking-tight text-xs md:text-sm whitespace-nowrap">
                        {dateRangeText}
                    </span>
                </div>

                <button
                    onClick={() => onDateChange(addDays(currentDate, 7))}
                    className="w-7 h-7 flex items-center justify-center hover:bg-gray-50 rounded text-gray-500 hover:text-gray-900 transition-colors border-l border-gray-100"
                >
                    <ChevronRight size={16} strokeWidth={2.5} />
                </button>
            </div>

            <button
                onClick={() => onDateChange(new Date())}
                className="bg-white border border-gray-200 text-gray-700 text-xs font-bold px-3 py-1.5 rounded-md shadow-sm hover:bg-gray-50 transition-colors hidden md:block"
            >
                Hoy
            </button>

            {/* POPOVER CALENDARIO */}
            {isOpen && (
                <motion.div
                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.95 }}
                    className="absolute top-full left-0 mt-2 bg-white rounded-xl shadow-2xl border border-gray-100 p-4 w-[300px] z-[90]"
                >
                    {/* Header Mes */}
                    <div className="flex items-center justify-between mb-4">
                        <span className="font-bold text-gray-800 text-sm">
                            {MonthNames[viewDate.getMonth()]} {viewDate.getFullYear()}
                        </span>
                        <div className="flex gap-1">
                            <button onClick={handlePrevMonth} className="p-1 hover:bg-gray-100 rounded text-gray-500"><ChevronLeft size={16} /></button>
                            <button onClick={handleNextMonth} className="p-1 hover:bg-gray-100 rounded text-gray-500"><ChevronRight size={16} /></button>
                        </div>
                    </div>

                    {/* Grid Dias Semana */}
                    <div className="grid grid-cols-7 mb-2 text-center">
                        {['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sa', 'Do'].map(d => (
                            <span key={d} className="text-[10px] font-bold text-gray-400 uppercase">{d}</span>
                        ))}
                    </div>

                    {/* Grid Fechas */}
                    <div className="grid grid-cols-7 gap-y-1">
                        {matrix.map((row, i) => (
                            <React.Fragment key={i}>
                                {row.map((day, j) => {
                                    if (!day) return <span key={`${i}-${j}`} className="p-2"></span>;

                                    const isSelected = isDayInSelectedWeek(day);
                                    const isStartDay = isStart(day);
                                    const isEndDay = isEnd(day);

                                    let cellClass = "text-gray-700 hover:bg-gray-100"; // Default

                                    if (isSelected) {
                                        cellClass = "bg-indigo-50 text-indigo-700 font-bold";
                                        if (isStartDay) cellClass += " rounded-l-lg bg-indigo-100 text-indigo-900";
                                        if (isEndDay) cellClass += " rounded-r-lg bg-indigo-100 text-indigo-900";
                                    } else {
                                        cellClass += " rounded-lg"; // Round hover for non-selected
                                    }

                                    return (
                                        <button
                                            key={`${i}-${j}`}
                                            onClick={() => handleDayClick(day)}
                                            className={`h-8 w-full text-xs flex items-center justify-center transition-all ${cellClass}`}
                                        >
                                            {day}
                                        </button>
                                    );
                                })}
                            </React.Fragment>
                        ))}
                    </div>
                </motion.div>
            )}
        </div>
    );
}

// --- COMPONENTE PRINCIPAL ---
function ScheduleManager() {
    const { user } = useAuth()
    const searchParams = useSearchParams()
    const canEdit = ['admin', 'supervisor'].some(role => user?.role?.toLowerCase().includes(role));

    // 🔄 FUNCIÓN PARA OBTENER CLIENTE CON TOKEN ACTUAL (igual que dashboard)
    const getSupabase = async () => {
        const token = localStorage.getItem('teg_token')
        const supabase = await getSupabaseClient()
        if (token) {
            await supabase.auth.setSession({ access_token: token, refresh_token: '' })
        }
        return supabase
    }

    const [viewMode, setViewMode] = useState<'dashboard' | 'editor'>('dashboard');
    const [currentDate, setCurrentDate] = useState(new Date())
    const [stores, setStores] = useState<any[]>([])
    const [selectedStoreId, setSelectedStoreId] = useState<string>('')
    const [selectedSupervisorId, setSelectedSupervisorId] = useState<string>('')

    const [allSchedules, setAllSchedules] = useState<any[]>([])
    const [allUsers, setAllUsers] = useState<any[]>([])
    const [localUsers, setLocalUsers] = useState<any[]>([])
    const [localSchedules, setLocalSchedules] = useState<any[]>([])
    const [loading, setLoading] = useState(true)
    const [editingShift, setEditingShift] = useState<any>(null);
    const [selectedDayIndex, setSelectedDayIndex] = useState(0); // For Mobile View switching

    // --- ESTADOS PARA DRAG & DROP (COPIAR) ---
    const [isDragging, setIsDragging] = useState(false);
    const [dragSource, setDragSource] = useState<any>(null);

    // --- REPLICACIÓN DE SEMANA ---
    const [showReplicationModal, setShowReplicationModal] = useState(false);
    const [replicationLoading, setReplicationLoading] = useState(false);
    const [replicationCandidates, setReplicationCandidates] = useState<{ id: string, name: string }[]>([]);

    const weekStart = getMonday(currentDate)
    const weekDays = Array.from({ length: 14 }).map((_, i) => addDays(weekStart, i))

    const loadGlobalData = async () => {
        setLoading(true)
        try {
            const supabase = await getSupabase()
            const startStr = formatDateISO(weekStart)
            const endStr = formatDateISO(addDays(weekStart, 13))
            const { data: sData } = await supabase.from('schedules').select('*').gte('date', startStr).lte('date', endStr)
            setAllSchedules(sData || [])
            const { data: uData } = await supabase.from('users').select('id, full_name, role, store_id').eq('is_active', true)
            setAllUsers(uData || [])
        } catch (e) { console.error(e) } finally { setLoading(false) }
    }

    const filterLocalData = () => {
        // Obtenemos las tiendas a mostrar (Puede ser 1 o todas las del supervisor)
        const targetStoreIds = selectedSupervisorId
            ? stores.filter(s => String(s.supervisor_id) === String(selectedSupervisorId)).map(s => String(s.id))
            : [String(selectedStoreId)];

        // Filtramos usuarios que pertenezcan a esas tiendas O sean el supervisor
        // Nota: Si es vista de supervisor, queremos ver a todos los usuarios de todas sus tiendas
        const filteredUsers = allUsers.filter(u => {
            const isTargetStore = targetStoreIds.includes(String(u.store_id));
            const isSelectedSup = String(u.id) === String(selectedSupervisorId);
            const isAdmin = u.role.toLowerCase().includes('admin');

            // Mostrar si es de la tienda y NO es admin, O si es el supervisor seleccionado específicamente
            return (isTargetStore && !isAdmin) || isSelectedSup;
        }).sort((a, b) => {
            // 1. Supervisor siempre arriba
            const isSupA = a.role.toLowerCase().includes('sup') || String(a.id) === String(selectedSupervisorId);
            const isSupB = b.role.toLowerCase().includes('sup') || String(b.id) === String(selectedSupervisorId);
            if (isSupA && !isSupB) return -1;
            if (!isSupA && isSupB) return 1;

            // 2. Managers después
            const isManagerA = ['manager', 'gerente'].some(r => a.role.toLowerCase().includes(r));
            const isManagerB = ['manager', 'gerente'].some(r => b.role.toLowerCase().includes(r));
            if (isManagerA && !isManagerB) return -1;
            if (!isManagerA && isManagerB) return 1;

            // 3. Alfabético
            return a.full_name.localeCompare(b.full_name);
        });
        setLocalUsers(filteredUsers);

        // Filtramos horarios de esas tiendas
        const filteredSchedules = allSchedules.filter(s => targetStoreIds.includes(String(s.store_id)));
        setLocalSchedules(filteredSchedules);
    }

    // --- ESTADO PARA CONTROLAR REPETICIÓN DEL MODAL ---
    const dismissedReplicationsRef = useRef<Set<string>>(new Set());

    // --- TOUR DE BIENVENIDA ---
    const [showTour, setShowTour] = useState(false);

    // --- COMPONENTE INTERNO DEL TOUR ---
    const OnboardingTour = ({ onComplete }: { onComplete: () => void }) => {
        return (
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[200] bg-black/40 flex flex-col items-center justify-center p-4"
            >
                <div className="relative w-full max-w-[1600px] h-full pointer-events-none">

                    {/* 1. SEMÁFORO (Top Right - Moved Left) */}
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.2 }}
                        className="absolute top-[65px] right-[400px] flex flex-col items-end"
                    >
                        <motion.div
                            animate={{ y: [0, -10, 0] }}
                            transition={{ repeat: Infinity, duration: 2 }}
                        >
                            <ArrowRight size={40} className="text-white drop-shadow-lg rotate-[-45deg] mb-2" strokeWidth={3} />
                        </motion.div>
                        <div className="bg-white text-gray-900 px-5 py-3 rounded-2xl shadow-2xl max-w-xs text-right">
                            <h3 className="font-black text-lg mb-1">🚦 Semáforo de Control</h3>
                            <p className="font-medium text-sm text-gray-600">
                                Tu guía visual rapida: <br />
                                <span className="text-emerald-600 font-bold">VERDE:</span> Todo cubierto.<br />
                                <span className="text-red-500 font-bold">ROJO:</span> ¡Atención inmediata!
                            </p>
                        </div>
                    </motion.div>

                    {/* 2. NAVEGACIÓN (Top Right Corner - Fixed) */}
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.8 }}
                        className="absolute top-[65px] right-[30px] flex flex-col items-end"
                    >
                        <motion.div
                            animate={{ x: [0, 10, 0] }}
                            transition={{ repeat: Infinity, duration: 2 }}
                        >
                            <ArrowRight size={40} className="text-white drop-shadow-lg rotate-[-45deg] mb-2 mr-10" strokeWidth={3} />
                        </motion.div>
                        <div className="bg-white text-indigo-900 px-5 py-3 rounded-2xl shadow-2xl max-w-xs text-right">
                            <h3 className="font-black text-lg mb-1">📅 Cambia de Semana</h3>
                            <p className="font-medium text-sm opacity-90">
                                Muévete entre semanas aquí para planificar con anticipación.
                            </p>
                        </div>
                    </motion.div>

                    {/* 3. FILA MAESTRA (Lowered slightly) */}
                    <motion.div
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 1.4 }}
                        className="absolute top-[250px] left-[10px] lg:left-[50px] flex gap-4 items-center"
                    >
                        <div className="bg-white text-indigo-900 px-6 py-4 rounded-2xl shadow-2xl max-w-sm border-l-8 border-indigo-500">
                            <h3 className="font-black text-xl mb-1">👑 Tu Fila Maestra</h3>
                            <p className="font-medium text-sm leading-relaxed opacity-90">
                                Define aquí TU horario. El sistema lo usará para rellenar huecos automáticamente.
                            </p>
                        </div>
                        <motion.div
                            animate={{ x: [0, 10, 0] }}
                            transition={{ repeat: Infinity, duration: 1.5 }}
                        >
                            <ArrowRight size={48} className="text-white drop-shadow-xl" strokeWidth={3} />
                        </motion.div>
                    </motion.div>

                    {/* 4. TIENDAS (Lower Left) */}
                    <motion.div
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 2.0 }}
                        className="absolute top-[400px] left-[10px] lg:left-[50px] flex gap-4 items-center"
                    >
                        <div className="bg-white text-gray-900 px-6 py-4 rounded-2xl shadow-2xl max-w-sm border-l-8 border-gray-800">
                            <h3 className="font-black text-xl mb-1">🏢 Tus Tiendas</h3>
                            <p className="font-medium text-sm leading-relaxed opacity-90">
                                Cada bloque representa una tienda. Busca los huecos <span className="category-badge-bad">ROJOS</span> para asignar personal.
                            </p>
                        </div>
                        <motion.div
                            animate={{ x: [0, 10, 0] }}
                            transition={{ repeat: Infinity, duration: 1.5, delay: 0.2 }}
                        >
                            <ArrowRight size={48} className="text-white drop-shadow-xl" strokeWidth={3} />
                        </motion.div>
                    </motion.div>

                    {/* 5. ESCENARIOS (Right Side Panel - Lowered to avoid overlap) */}
                    <motion.div
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 2.4 }}
                        className="absolute top-[300px] right-[50px] flex flex-col items-end"
                    >
                        <div className="bg-white text-gray-900 rounded-2xl shadow-2xl p-6 max-w-sm border-r-8 border-indigo-600">
                            <h3 className="font-black text-xl mb-4 text-gray-800 border-b pb-2 flex items-center gap-2">
                                <ShieldCheck size={24} className="text-indigo-600" />
                                Escenarios de Cobertura
                            </h3>
                            <div className="space-y-4">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center shrink-0">
                                        <AlertCircle size={20} className="text-red-600" />
                                    </div>
                                    <div>
                                        <p className="font-bold text-red-600 text-sm">Falta Personal</p>
                                        <p className="text-xs text-gray-500 leading-tight">Hueco crítico en AM o PM.</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
                                        <Clock size={20} className="text-amber-600" />
                                    </div>
                                    <div>
                                        <p className="font-bold text-amber-600 text-sm">Vacío / Pendiente</p>
                                        <p className="text-xs text-gray-500 leading-tight">Turno aún no asignado.</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
                                        <ShieldCheck size={20} className="text-emerald-600" />
                                    </div>
                                    <div>
                                        <p className="font-bold text-emerald-600 text-sm">Cubierto</p>
                                        <p className="text-xs text-gray-500 leading-tight">Personal asignado correctamente.</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center shrink-0">
                                        <span className="text-lg">👑</span>
                                    </div>
                                    <div>
                                        <p className="font-bold text-indigo-600 text-sm">Cubierto por Ti</p>
                                        <p className="text-xs text-gray-500 leading-tight">Tu horario cubre este hueco.</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </motion.div>

                    {/* 6. INTERACCIÓN (Bottom Center - Darker) */}
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 3.0 }}
                        className="absolute bottom-[100px] left-1/2 -translate-x-1/2 flex flex-col items-center"
                    >
                        <div className="bg-gray-900 text-white px-8 py-5 rounded-2xl border border-gray-700 shadow-2xl flex items-center gap-5 max-w-lg">
                            <div className="bg-yellow-500/20 p-3 rounded-full">
                                <Sparkles size={32} className="text-yellow-400" />
                            </div>
                            <div className="text-left">
                                <h3 className="font-bold text-lg leading-tight">Tip Profesional</h3>
                                <p className="text-sm font-medium opacity-90">
                                    Haz <span className="font-bold text-yellow-300">CLIC</span> para editar. <br />
                                    Mantén <span className="font-bold text-yellow-300">SHIFT + CLICK</span> y arrastra para copiar.
                                </p>
                            </div>
                        </div>
                        <motion.div
                            animate={{ y: [0, 10, 0] }}
                            transition={{ repeat: Infinity, duration: 1.5 }}
                            className="mt-4"
                        >
                            <ArrowRight size={40} className="text-white drop-shadow-lg rotate-90" strokeWidth={3} />
                        </motion.div>
                    </motion.div>

                </div>

                <div className="absolute bottom-10 z-[210] flex justify-center pointer-events-auto">
                    <button
                        onClick={onComplete}
                        className="bg-indigo-600 text-white px-12 py-4 rounded-full font-black text-xl shadow-2xl hover:scale-105 active:scale-95 transition-all flex items-center gap-3 ring-4 ring-white/20 hover:bg-indigo-500"
                    >
                        <span>¡Entendido, a trabajar!</span>
                        <ArrowRight size={24} />
                    </button>
                </div>
            </motion.div>
        );
    };

    // 🔍 CONTROL DE CAMBIO DE VISTA (Para el Tour)
    const prevViewMode = useRef('dashboard');

    // ACTIVAR TOUR SOLO AL ENTRAR AL EDITOR (Transición)
    useEffect(() => {
        if (viewMode === 'editor' && prevViewMode.current !== 'editor') {
            setShowTour(true);
        }
        prevViewMode.current = viewMode;
    }, [viewMode]);

    // 🔍 VERIFICAR OPORTUNIDAD DE RÉPLICA (Automático al cambiar de semana o CERRAR tour)
    useEffect(() => {
        // Separated logic above
        const checkReplication = async () => {
            if (viewMode !== 'editor' || loading || showTour) return;

            // Generar una clave única para esta combinación de vista/semana
            const currentKey = `${formatDateISO(weekStart)}-${selectedStoreId || selectedSupervisorId}`;

            // Chequear contra la referencia actual (siempre viva)
            if (dismissedReplicationsRef.current.has(currentKey)) return;

            // Definir targetStores basado en la selección actual
            const targetStoresList = selectedSupervisorId
                ? stores.filter(s => String(s.supervisor_id) === String(selectedSupervisorId))
                : stores.filter(s => String(s.id) === String(selectedStoreId));

            if (targetStoresList.length === 0) return;

            const supabase = await getSupabase();
            const candidates: { id: string, name: string }[] = [];

            const currentStart = formatDateISO(weekStart);
            const currentEnd = formatDateISO(addDays(weekStart, 6)); // Solo Semana 1
            const prevStart = formatDateISO(addDays(weekStart, -7));
            const prevEnd = formatDateISO(addDays(weekStart, -1));

            // Verificar tienda por tienda
            for (const store of targetStoresList) {
                // ... (rest of logic unchanged) ...
                // 1. Chequear semana ACTUAL (debe estar vacía)
                const { count: currentCount } = await supabase
                    .from('schedules')
                    .select('*', { count: 'exact', head: true })
                    .eq('store_id', store.id)
                    .gte('date', currentStart)
                    .lte('date', currentEnd);

                if (currentCount && currentCount > 0) continue;

                // 2. Chequear semana ANTERIOR (debe tener datos)
                const { count: prevCount } = await supabase
                    .from('schedules')
                    .select('*', { count: 'exact', head: true })
                    .eq('store_id', store.id)
                    .gte('date', prevStart)
                    .lte('date', prevEnd);

                if (prevCount && prevCount > 0) {
                    // Evitar duplicados si la lista de tiendas base los tiene
                    if (!candidates.some(c => c.id === store.id)) {
                        candidates.push({ id: store.id, name: store.name });
                    }
                }
            }

            if (candidates.length > 0) {
                // Doble chequeo por si el usuario descartó mientras se ejecutaba esto
                if (dismissedReplicationsRef.current.has(currentKey)) return;

                setReplicationCandidates(candidates);
                setShowReplicationModal(true);
            }
        };

        if (!loading) checkReplication();
    }, [showTour, weekStart, viewMode, selectedSupervisorId, selectedStoreId, stores, loading]); // Agregado showTour

    const dismissReplication = () => {
        const currentKey = `${formatDateISO(weekStart)}-${selectedStoreId || selectedSupervisorId}`;
        dismissedReplicationsRef.current.add(currentKey);
        setShowReplicationModal(false);
    };

    const handleReplicateWeek = async () => {
        if (replicationCandidates.length === 0) return;
        setReplicationLoading(true);
        try {
            const supabase = await getSupabase();
            const candidateIds = replicationCandidates.map(c => c.id);

            // 1. Obtener datos semana anterior SOLO de las tiendas candidatas
            const prevStart = formatDateISO(addDays(weekStart, -7));
            const prevEnd = formatDateISO(addDays(weekStart, -1));

            const { data: sourceShifts, error: fetchError } = await supabase
                .from('schedules')
                .select('*')
                .in('store_id', candidateIds)
                .gte('date', prevStart)
                .lte('date', prevEnd);

            if (fetchError) {
                console.error("Error fetching source shifts:", fetchError);
                throw new Error(`Fetch error: ${fetchError.message}`);
            }

            if (!sourceShifts || sourceShifts.length === 0) {
                // No hay nada que copiar (raro si llegamos aquí, pero posible)
                setShowReplicationModal(false);
                return;
            }

            // 2. Preparar nuevos turnos (+7 días)
            const newShifts = sourceShifts.map(s => {
                if (!s.date) return null; // Safety check
                const oldDate = new Date(s.date + 'T12:00:00');
                const newDate = addDays(oldDate, 7);

                // Mapeo explicito incluyendo todos los campos necesarios
                return {
                    user_id: s.user_id,
                    store_id: s.store_id,
                    date: formatDateISO(newDate),
                    start_time: s.start_time,
                    end_time: s.end_time,
                    shift_label: s.shift_label || 'Custom',
                    role: s.role || 'ventas'
                };
            }).filter(Boolean); // Remover nulos

            if (newShifts.length === 0) {
                setShowReplicationModal(false);
                return;
            }

            // 3. Insertar con Upsert para evitar conflictos de clave única
            const { error: insertError } = await supabase
                .from('schedules')
                .upsert(newShifts, { onConflict: 'user_id, date' });

            if (insertError) {
                console.error("Error detailed (JSON):", JSON.stringify(insertError));
                console.error("Error detailed (Object):", insertError);
                throw new Error(`Insert error: ${insertError.message} - ${insertError.details || 'no details'}`);
            }

            // 4. Recargar
            await loadGlobalData();
            setShowReplicationModal(false);
            setReplicationCandidates([]);

        } catch (e: any) {
            console.error("FULL Error replicating week:", e);
            alert(`Hubo un error al replicar: ${e.message || 'Error desconocido'}. Revisa la consola para más detalles.`);
        } finally {
            setReplicationLoading(false);
        }
    };

    // 🔗 DEEP LINKING: Cargar tienda y fecha desde URL (Notificaciones)
    useEffect(() => {
        const storeId = searchParams.get('store_id')
        if (storeId && stores.length > 0) {
            setSelectedStoreId(storeId)
            const dateParam = searchParams.get('date')
            if (dateParam) {
                // Parse YYYY-MM-DD carefully to local time
                const [y, m, d] = dateParam.split('-').map(Number)
                if (y && m && d) setCurrentDate(new Date(y, m - 1, d))
            }
        }
    }, [searchParams, stores])

    useEffect(() => {
        async function init() {
            const supabase = await getSupabase()
            const { data } = await supabase.from('stores').select('*').order('name')
            if (data && data.length > 0) {
                setStores(data)
                setSelectedStoreId(String(data[0].id))
            }
        }
        init()
    }, [])

    useEffect(() => { loadGlobalData() }, [currentDate, viewMode])

    useEffect(() => {
        if (selectedStoreId && viewMode === 'editor') filterLocalData()
    }, [selectedStoreId, allSchedules, allUsers, viewMode])

    // Listener global para soltar el click
    useEffect(() => {
        const handleMouseUp = () => {
            setIsDragging(false);
            setDragSource(null);
        };
        window.addEventListener('mouseup', handleMouseUp);
        return () => window.removeEventListener('mouseup', handleMouseUp);
    }, []);

    // --- DRAG & DROP ---
    // --- DRAG & DROP ---
    const handleCellMouseDown = (e: React.MouseEvent, user: any, date: Date, shift: any, storeId?: string) => {
        if (e.shiftKey && canEdit) {
            e.preventDefault();
            setIsDragging(true);
            setDragSource(shift);
        } else {
            openEditModal(user, date, shift, storeId);
        }
    };

    const handleCellMouseEnter = async (user: any, date: Date) => {
        if (isDragging && canEdit) {
            await duplicateShift(user, date, dragSource);
        }
    };

    const duplicateShift = async (targetUser: any, targetDate: Date, sourceShift: any) => {
        const supabase = await getSupabase()
        const dateStr = formatDateISO(targetDate);
        const isDelete = !sourceShift;

        const tempSchedules = allSchedules.filter(s => !(String(s.user_id) === String(targetUser.id) && s.date === dateStr));

        if (!isDelete) {
            tempSchedules.push({
                user_id: targetUser.id,
                store_id: targetUser.store_id, // CORRECCIÓN: Usar la tienda del usuario destino
                date: dateStr,
                shift_label: sourceShift.shift_label,
                start_time: sourceShift.start_time,
                end_time: sourceShift.end_time,
                role: targetUser.role
            });
        }
        setAllSchedules([...tempSchedules]);

        if (isDelete) {
            await supabase.from('schedules').delete().match({ user_id: targetUser.id, date: dateStr });
        } else {
            await supabase.from('schedules').upsert({
                user_id: targetUser.id,
                store_id: targetUser.store_id, // CORRECCIÓN: Usar la tienda del usuario destino
                date: dateStr,
                shift_label: sourceShift.shift_label,
                start_time: sourceShift.start_time,
                end_time: sourceShift.end_time,
                role: targetUser.role
            }, { onConflict: 'user_id, date' });
        }
    };

    // --- COPIAR SEMANA ANTERIOR ---
    const copyFromLastWeek = async () => {
        if (!selectedStoreId || !canEdit) return;
        setLoading(true);
        try {
            const supabase = await getSupabase();

            // 1. Definir rango de la semana anterior
            const lastWeekStart = addDays(weekStart, -7);
            const lastWeekEnd = addDays(weekStart, -1);
            const lastWeekStartStr = formatDateISO(lastWeekStart);
            const lastWeekEndStr = formatDateISO(lastWeekEnd);

            // 2. Obtener horarios de la semana anterior para esta tienda
            const { data: lastWeekData, error } = await supabase
                .from('schedules')
                .select('*')
                .eq('store_id', selectedStoreId)
                .gte('date', lastWeekStartStr)
                .lte('date', lastWeekEndStr);

            if (error) throw error;
            if (!lastWeekData || lastWeekData.length === 0) {
                alert("No se encontraron horarios en la semana anterior para esta tienda.");
                return;
            }

            // 3. Preparar nuevos registros (Ajustar fecha +7 días)
            const newSchedules = lastWeekData.map(s => {
                const oldDate = new Date(s.date + 'T00:00:00');
                const newDate = addDays(oldDate, 7);
                const { id, created_at, ...rest } = s; // Eliminar campos autogenerados
                return {
                    ...rest,
                    date: formatDateISO(newDate)
                };
            });

            // 4. Upsert masivo
            const { error: upsertError } = await supabase
                .from('schedules')
                .upsert(newSchedules, { onConflict: 'user_id, date' });

            if (upsertError) throw upsertError;

            // 5. Recargar datos globales para actualizar UI
            await loadGlobalData();
            alert(`¡Éxito! Se han copiado ${newSchedules.length} horarios de la semana anterior.`);

        } catch (e) {
            console.error("Error al copiar semana:", e);
            alert("Hubo un error al copiar los horarios.");
        } finally {
            setLoading(false);
        }
    };

    // --- GUARDADO ---
    const saveShift = async () => {
        if (!editingShift || !canEdit) return;
        const supabase = await getSupabase()
        const dateStr = formatDateISO(editingShift.date);
        const isDelete = !editingShift.start || !editingShift.end;

        let labelToSave = 'Custom';
        const preset = PRESETS.find(p => p.start === editingShift.start && p.end === editingShift.end);
        if (preset) labelToSave = preset.label;
        else if (editingShift.presetId === 'visita') labelToSave = 'Visita Sup.';

        const targetStoreId = parseInt(editingShift.storeId || selectedStoreId); // INTENTAR USAR ID DEL MODAL, SI NO EL SELECCIONADO
        if (!targetStoreId || isNaN(targetStoreId)) {
            console.error("Error: Store ID invalido al guardar");
            return;
        }

        const newEntry = {
            user_id: parseInt(editingShift.userId),
            store_id: targetStoreId,
            date: dateStr,
            shift_label: labelToSave,
            start_time: editingShift.start,
            end_time: editingShift.end,
            role: editingShift.userRole
        }

        const tempSchedules = allSchedules.filter(s => !(String(s.user_id) === String(editingShift.userId) && s.date === dateStr));
        if (!isDelete) tempSchedules.push(newEntry);
        setAllSchedules(tempSchedules);
        setEditingShift(null);

        if (isDelete) await supabase.from('schedules').delete().match({ user_id: editingShift.userId, date: dateStr })
        else await supabase.from('schedules').upsert(newEntry, { onConflict: 'user_id, date' })
    }

    const openEditModal = (user: any, date: Date, currentShift: any, storeId?: string) => {
        if (!canEdit) return;
        setEditingShift({
            userId: user.id, userName: user.full_name, userRole: user.role,
            storeId: storeId, // GUARDAR STORE ID
            date: date, start: currentShift?.start_time || '', end: currentShift?.end_time || '',
            presetId: currentShift ? 'custom' : 'off'
        })
    }

    // --- RENDERIZADO ---

    const renderDashboard = () => {
        // Calcular supervisores y sus métricas
        const supervisorsList = Object.values(stores.reduce((acc: any, store: any) => {
            const supId = store.supervisor_id;
            // Si no tiene supervisor, lo agrupamos bajo "Sin Supervisor" (ID 0 o similar)
            // O simplemente lo mostramos como tarjeta individual si preferimos.
            // Aqui usaremos el ID del supervisor como clave.
            if (!supId) return acc; // Ignorar tiendas sin supervisor por ahora para simplificar dashboard

            if (!acc[supId]) {
                acc[supId] = {
                    id: supId,
                    name: store.supervisor_name || 'Sin Nombre',
                    stores: [],
                    risk: false,
                    issues: [],
                    stats: { empty: 0, bad: 0, ok: 0, progress: 0 },
                    lastCapture: null as string | null
                };
            }

            // Calcular riesgo de esta tienda: SOLO para personal de esta tienda
            const storeUserIds = new Set(allUsers?.filter(u => String(u.store_id) === String(store.id)).map(u => String(u.id)) || []);
            // Calcular riesgo de esta tienda: SOLO para personal ACTIVO de esta tienda (Evita shifts fantasma)
            const storeShifts = allSchedules.filter(s => String(s.store_id) === String(store.id) && storeUserIds.has(String(s.user_id)));

            // BUSCAR ÚLTIMA CAPTURA (Max created_at o similar de esta tienda)
            // Nota: created_at viene de Supabase por defecto en el select *
            const storeLatest = storeShifts.reduce((max, s) => {
                const ts = s.created_at || s.inserted_at; // Soporte para ambos nombres comunes
                if (!ts) return max;
                return !max || ts > max ? ts : max;
            }, null as string | null);

            if (storeLatest) {
                if (!acc[supId].lastCapture || storeLatest > acc[supId].lastCapture) {
                    acc[supId].lastCapture = storeLatest;
                }
            }

            // Calculo seguro de estado semanal
            const weekStatuses = weekDays.map(d => {
                const dateStr = formatDateISO(d);
                try {
                    const supShift = allSchedules.find(s => String(s.user_id) === String(supId) && s.date === dateStr);
                    return calculateDailyStatus(dateStr, storeShifts, allUsers || [], supShift, true, true);
                } catch (e) {
                    return { status: 'error', missingAM: true, missingPM: true };
                }
            });

            const hasRisk = weekStatuses.some(s => s.status === 'bad' || s.status === 'empty');
            const storeHasBad = weekStatuses.some(s => s.status === 'bad');
            const storeHasEmpty = weekStatuses.some(s => s.status === 'empty');

            if (storeHasBad) {
                const badDays = weekStatuses
                    .map((s, idx) => s.status === 'bad' ? getDayName(weekDays[idx]).substring(0, 3) : null)
                    .filter(Boolean);
                acc[supId].issues.push({ store: formatStoreName(store.name), days: badDays, type: 'bad' });
            } else if (storeHasEmpty) {
                const emptyDays = weekStatuses
                    .map((s, idx) => s.status === 'empty' ? getDayName(weekDays[idx]).substring(0, 3) : null)
                    .filter(Boolean);
                acc[supId].issues.push({ store: formatStoreName(store.name), days: emptyDays, type: 'empty' });
            }

            acc[supId].stores.push(store);
            if (hasRisk) acc[supId].risk = true;

            const allOk = weekStatuses.every(s => s.status === 'ok' || s.status === 'ok-sup');
            const anyBad = weekStatuses.some(s => s.status === 'bad');
            const anyEmpty = weekStatuses.some(s => s.status === 'empty');
            const allEmpty = weekStatuses.every(s => s.status === 'empty');

            const storeRes = anyBad ? 'bad' : (allOk ? 'ok' : 'empty');
            acc[supId].stats[storeRes]++;

            // Calcular Estatus General del Supervisor
            if (anyBad) acc[supId].overallStatus = 'bad';
            else if (acc[supId].overallStatus !== 'bad') {
                // Si no hay errores, solo marcamos OK si TODO está OK
                // De lo contrario, queda como EMPTY (Pendiente de terminar)
                if (allOk) acc[supId].overallStatus = 'ok';
                else acc[supId].overallStatus = 'empty';
            }

            return acc;
        }, {} as Record<string, any>));

        // Refinar mensajes para cada supervisor
        supervisorsList.forEach((sup: any) => {
            // Asegurar que progress se detecte si hay mezcla de tiendas OK y EMPTY
            if (!sup.overallStatus) sup.overallStatus = 'empty';
            // if (sup.stats.progress > 0 || (sup.stats.ok > 0 && sup.stats.empty > 0)) sup.overallStatus = 'progress'; // ELIMINADO POR SOLICITUD
            if (sup.stats.bad > 0) sup.overallStatus = 'bad';
            if (sup.stats.ok === sup.stores.length) sup.overallStatus = 'ok';
            const badIssues = sup.issues.filter((i: any) => i.type === 'bad');
            const emptyIssues = sup.issues.filter((i: any) => i.type === 'empty');
            sup.alertLines = [];

            if (badIssues.length > 0) {
                badIssues.forEach((i: any) => {
                    sup.alertLines.push({
                        text: `Alerta: ${i.store} tiene turnos descubiertos (${i.days.join(', ')}).`,
                        color: 'text-red-600 bg-red-50'
                    });
                });
            } else if (emptyIssues.length > 0) {
                // Si hay problemas de progreso o vacío, lo contamos como pendiente (Ambar)
                const totalPending = emptyIssues.length;
                sup.alertLines.push({
                    text: `${totalPending} ${totalPending === 1 ? 'tienda está' : 'tiendas están'} sin horarios programados.`,
                    color: 'text-amber-600 bg-amber-50'
                });
            } else if (sup.alertLines.length === 0) {
                if (sup.overallStatus === 'ok') {
                    sup.alertLines.push({
                        text: `¡Excelente! Todas las tiendas están cubiertas.`,
                        color: 'text-emerald-600 bg-emerald-50'
                    });
                } else {
                    sup.alertLines.push({
                        text: `${sup.stores.length} tiendas sin horarios programados.`,
                        color: 'text-amber-600 bg-amber-50'
                    });
                }
            }
        });

        if (stores.length === 0) {
            return (
                <div className="flex flex-col items-center justify-center h-64 text-gray-400">
                    <Store size={48} className="mb-4 opacity-20" />
                    <p>No hay tiendas configuradas.</p>
                </div>
            )
        }

        if (supervisorsList.length === 0) {
            return (
                <div className="flex flex-col items-center justify-center h-64 text-gray-400">
                    <User size={48} className="mb-4 opacity-20" />
                    <p>No se encontraron supervisores asignados.</p>
                </div>
            )
        }

        return (
            <div className="animate-fade-in h-full relative overflow-y-auto p-4 lg:p-8">
                <div className="max-w-[1536px] mx-auto">
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4 mb-6">
                        <div>
                            <h2 className="text-4xl font-black text-gray-900 tracking-tight text-balance">Control de Operaciones</h2>
                            <p className="text-lg text-gray-500 mt-1">
                                {canEdit ? 'Revisa el estado de tus tiendas y atiende las alertas de la semana.' : '👀 Vista de lectura: Monitor de cobertura de tiendas.'}
                            </p>
                        </div>
                        <div className="flex items-center gap-3 w-full md:w-auto">
                            <WeekSelector currentDate={currentDate} onDateChange={setCurrentDate} weekStart={weekStart} />

                            <div className="hidden md:flex bg-white px-4 py-2 rounded-xl border border-gray-100 shadow-sm items-center gap-2">
                                <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></div>
                                <span className="text-xs font-bold text-gray-600">Alerta</span>
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-6 pb-20">
                        {supervisorsList.map((sup: any) => (
                            <div
                                key={sup.id}
                                onClick={() => { setSelectedSupervisorId(String(sup.id)); setViewMode('editor'); }}
                                className={`bg-white rounded-3xl p-8 border border-slate-200 shadow-[0_8px_30px_rgb(0,0,0,0.04)] transition-all duration-300 cursor-pointer group hover:scale-[1.01] hover:shadow-[0_20px_40px_rgba(0,0,0,0.08)] relative overflow-hidden`}
                            >
                                {/* Barra de Estatus Superior */}
                                <div className={`absolute top-0 left-0 right-0 h-1.5 
                                        ${sup.overallStatus === 'bad' ? 'bg-red-500' :
                                        sup.overallStatus === 'empty' ? 'bg-amber-500' :
                                            'bg-emerald-500'}`} />
                                {/* Fondo decorativo */}
                                <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-50 rounded-full -mr-32 -mt-32 blur-3xl group-hover:bg-indigo-100 transition-all"></div>

                                {sup.risk && (
                                    <div className="absolute top-0 right-0 bg-red-50 text-red-600 text-[11px] font-black px-4 py-2 rounded-bl-2xl shadow-sm z-10 border-b border-l border-red-100 uppercase tracking-widest">
                                        ATENCIÓN
                                    </div>
                                )}

                                <div className="flex items-center gap-5 relative z-10">
                                    <div className={`w-16 h-16 rounded-2xl flex items-center justify-center shadow-sm
                                        ${sup.overallStatus === 'bad' ? 'bg-red-50 text-red-500' :
                                            sup.overallStatus === 'empty' ? 'bg-amber-50 text-amber-500' :
                                                'bg-emerald-50 text-emerald-600'}`}>
                                        {sup.overallStatus === 'bad' && <ShieldAlert size={32} strokeWidth={2.5} />}
                                        {sup.overallStatus === 'empty' && <AlertCircle size={32} strokeWidth={2.5} />}
                                        {sup.overallStatus === 'ok' && <ShieldCheck size={32} strokeWidth={2.5} />}
                                    </div>
                                    <div>
                                        <h3 className="font-black text-gray-900 text-2xl leading-tight group-hover:text-indigo-600 transition-colors">
                                            {sup.name}
                                        </h3>
                                        <p className="text-sm text-gray-500 font-medium uppercase tracking-wide mt-1">
                                            {sup.stores.length} Tiendas Asignadas
                                        </p>
                                        {sup.lastCapture && (
                                            <p className="text-xs text-indigo-500 font-bold uppercase tracking-wider mt-1.5 flex items-center gap-1.5 bg-indigo-50 px-2 py-0.5 rounded-md w-fit">
                                                <Clock size={12} />
                                                Última captura: {formatDateLA(sup.lastCapture)} {formatTimeLA(sup.lastCapture)}
                                            </p>
                                        )}
                                    </div>
                                </div>

                                <div className="mt-8 flex flex-wrap gap-2 relative z-10">
                                    {sup.stores.map((s: any) => (
                                        <span key={s.id} className="px-3 py-1.5 rounded-lg bg-gray-50 border border-gray-100 text-gray-700 text-xs font-normal group-hover:bg-white group-hover:border-gray-200 transition-colors uppercase tracking-tight">
                                            {formatStoreName(s.name)}
                                        </span>
                                    ))}
                                </div>

                                {/* Mensaje de Estatus Dinámico */}
                                <div className="mt-6 space-y-2 relative z-10">
                                    {sup.alertLines.map((line: any, idx: number) => (
                                        <div key={idx} className={`p-3.5 rounded-xl border-l-4 border-current ${line.color} font-bold text-sm flex items-center gap-3 shadow-sm animate-fade-in`}>
                                            <Sparkles size={16} className="opacity-70 flex-shrink-0" />
                                            <span>{line.text}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        );
    };

    const renderEditor = () => {
        // Determinar qué tiendas mostrar (1 o todas las del supervisor)
        const targetStores = selectedSupervisorId
            ? stores.filter(s => String(s.supervisor_id) === String(selectedSupervisorId))
            : [stores.find(s => String(s.id) === String(selectedStoreId))].filter(Boolean);

        return (
            <div className="h-full flex flex-col">
                {/* TARJETA UNIFICADA: Header + Tabla */}
                <div className="bg-white shadow-sm border-b border-gray-200 flex flex-col flex-1 overflow-hidden">
                    {/* HEADER DEL PLANIFICADOR (parte de la tarjeta) */}
                    <div className="bg-white border-b border-gray-200 p-4 px-6 flex-none flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            <button onClick={() => setViewMode('dashboard')} className="w-10 h-10 flex items-center justify-center rounded-full bg-gray-50 text-gray-600 hover:bg-black hover:text-white transition-all border border-gray-200">←</button>
                            <div>
                                <h2 className="text-2xl font-black text-gray-900">Organizador de Horarios</h2>
                                <p className="text-sm text-gray-500 font-medium tracking-tight">Asigna los turnos de tu equipo y asegura que todo esté cubierto.</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-4">
                            {/* Leyenda de colores */}
                            <div className="hidden md:flex items-center gap-2 mr-4 border-r border-gray-200 pr-4">
                                <span className="text-xs font-black text-gray-400 uppercase tracking-widest mr-1">ESTATUS:</span>
                                <span className="px-4 py-2 rounded-md text-xs font-black bg-emerald-500 text-white shadow-sm">CUBIERTO</span>
                                <span className="px-4 py-2 rounded-md text-xs font-black bg-red-500 text-white shadow-sm animate-pulse">FALTA AM/PM</span>
                                <span className="px-4 py-2 rounded-md text-xs font-black bg-gray-100 text-gray-400 border border-gray-200">VACÍO</span>
                            </div>
                            <WeekSelector currentDate={currentDate} onDateChange={setCurrentDate} weekStart={weekStart} />
                        </div>
                    </div>

                    {/* AREA DE TABLA CON SCROLL INTERNO */}
                    <div className="flex-1 overflow-auto custom-scrollbar relative">
                        <table className="w-full text-sm border-separate border-spacing-0">
                            {/* THEAD STICKY: Incluye headers de fechas Y fila de supervisor */}
                            <thead className="sticky top-0 z-[20] shadow-sm ring-1 ring-black/5">
                                <tr className="bg-white">
                                    <th className="p-4 text-left min-w-[320px] sticky left-0 z-[30] bg-white border-r border-gray-200 border-b border-gray-200">
                                        <div className="flex items-center gap-2">
                                            <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600">
                                                <User size={20} />
                                            </div>
                                            <span className="text-sm font-black text-gray-500 uppercase tracking-widest">Colaborador</span>
                                        </div>
                                    </th>
                                    {weekDays.map((day, idx) => {
                                        // Calcular estatus global del día (si alguna tienda falla, es fail)
                                        let globalStatus = 'ok';

                                        // Buscar turno del supervisor para usar como comodin global
                                        const supShift = allSchedules.find(s => String(s.user_id) === String(selectedSupervisorId) && s.date === formatDateISO(day));

                                        if (targetStores.length > 0) {
                                            // SIMULACIÓN EXACTA DE PRIORIDAD: Iterar todas las tiendas en orden
                                            // para ver si alguna queda descubierta tras consumir al supervisor.
                                            let tempSupAvailable = { am: true, pm: true };

                                            // Verificar si el supervisor ya "trabaja" ese día para saber si tiene capacidad inicial
                                            // La capacidad real depende del turno (getShiftCoverage ya lo maneja dentro de calculateDailyStatus)
                                            // Pero aquí solo pasamos los flags "Available". El "supShift" se pasa completo.

                                            let hasOk = false;
                                            let hasEmpty = false;
                                            let hasBad = false;

                                            for (const store of targetStores) {
                                                const sUsers = localUsers.filter(u => String(u.store_id) === String(store.id) && String(u.id) !== String(selectedSupervisorId));
                                                const sUserIds = new Set(sUsers.map(u => String(u.id)));

                                                const sShifts = allSchedules.filter(s => String(s.store_id) === String(store.id) && sUserIds.has(String(s.user_id)));
                                                const valShifts = sShifts.filter(s => String(s.user_id) !== String(selectedSupervisorId));

                                                const status = calculateDailyStatus(formatDateISO(day), valShifts, sUsers, supShift, tempSupAvailable.am, tempSupAvailable.pm);

                                                if (status.usedSupAM) tempSupAvailable.am = false;
                                                if (status.usedSupPM) tempSupAvailable.pm = false;

                                                if (status.status === 'bad') hasBad = true;
                                                if (status.status === 'ok' || status.status === 'ok-sup') hasOk = true;
                                                if (status.status === 'empty') hasEmpty = true;
                                            }

                                            globalStatus = hasBad ? 'bad' : ((hasOk && !hasEmpty) ? 'ok' : 'empty');
                                        }

                                        return (
                                            <th key={idx} className={`p-1 min-w-[105px] border-b border-gray-200 last:border-0 bg-white z-[20] ${idx === 6 ? 'border-r-4 border-slate-300' : 'border-r border-gray-200'}`}>
                                                <div className="flex flex-col items-center gap-1 py-2">
                                                    <span className="text-[14px] font-medium text-black uppercase tracking-wide">{getDayName(day)}</span>
                                                    <span className="text-2xl font-black text-gray-900 -mt-1">{day.getDate()}</span>
                                                    <div className={`mt-1 px-4 py-1 rounded-full text-[11px] font-black tracking-wide shadow-sm ${globalStatus === 'ok' ? 'bg-emerald-500 text-white' :
                                                        globalStatus === 'empty' ? 'bg-amber-100 text-amber-700 border border-amber-200 font-bold' :
                                                            'bg-red-500 text-white animate-pulse'
                                                        }`}>
                                                        {globalStatus === 'ok' ? 'CUBIERTO' : globalStatus === 'empty' ? 'PENDIENTE' : 'FALTA AM/PM'}
                                                    </div>
                                                </div>
                                            </th>
                                        );
                                    })}
                                </tr>
                                {selectedSupervisorId && (() => {
                                    const supervisorUser = localUsers.find(u => String(u.id) === String(selectedSupervisorId)) ||
                                        allUsers.find(u => String(u.id) === String(selectedSupervisorId));

                                    if (!supervisorUser) return null;

                                    return (
                                        <tr className="bg-indigo-50 border-b-4 border-slate-100 shadow-sm">
                                            <th className="p-4 sticky left-0 z-[30] bg-indigo-50 border-r border-gray-200 text-left font-normal shadow-[4px_0_4px_-2px_rgba(0,0,0,0.05)]">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-14 h-14 rounded-xl bg-indigo-600 flex items-center justify-center text-xl font-black text-white shadow-indigo-200 shadow-lg ring-4 ring-indigo-50">
                                                        {supervisorUser.full_name.substring(0, 1).toUpperCase()}
                                                    </div>
                                                    <div className="flex flex-col">
                                                        <span className="font-black text-gray-900 text-xl flex items-center gap-1">
                                                            {supervisorUser.full_name}
                                                            <span className="text-amber-500 text-base">👑</span>
                                                        </span>
                                                        <span className="text-[11px] font-black text-indigo-600 uppercase tracking-widest bg-indigo-50 px-2 py-0.5 rounded w-fit mt-0.5">SUPERVISOR DE ZONA</span>
                                                    </div>
                                                </div>
                                            </th>
                                            {weekDays.map((day, idx) => {
                                                const dateStr = formatDateISO(day);
                                                const currentShift = allSchedules.find(s =>
                                                    String(s.user_id) === String(supervisorUser.id) &&
                                                    s.date === dateStr
                                                );

                                                let cardContent = <div className="w-1.5 h-1.5 rounded-full bg-indigo-200/50 group-hover:bg-indigo-300"></div>;
                                                let cardClass = "bg-transparent hover:bg-white/50 border border-transparent";

                                                if (currentShift) {
                                                    const preset = PRESETS.find(p => p.start === currentShift.start_time && p.end === currentShift.end_time);
                                                    const color = preset ? preset.color : 'bg-indigo-100 text-indigo-900 group-hover:bg-indigo-200';
                                                    cardClass = `${color} shadow-sm group-hover:shadow-md transform transition-all duration-200 ${canEdit ? 'hover:-translate-y-1' : ''}`;
                                                    cardContent = (
                                                        <div className="flex flex-col items-center justify-center w-full h-full p-1 gap-0">
                                                            <span className="text-[18px] font-medium tracking-tight opacity-95 leading-none">
                                                                {formatTime12h(currentShift.start_time?.slice(0, 5))}
                                                            </span>
                                                            <span className="text-[18px] font-medium tracking-tight opacity-95 leading-none">
                                                                {formatTime12h(currentShift.end_time?.slice(0, 5))}
                                                            </span>
                                                        </div>
                                                    );
                                                }

                                                return (
                                                    <th
                                                        key={`sup-${day.toISOString()}`}
                                                        className={`p-1 h-[65px] last:border-0 align-middle font-normal z-[20] bg-indigo-50 ${idx === 6 ? 'border-r-4 border-indigo-200' : 'border-r border-indigo-100'}`}
                                                        onMouseDown={(e) => handleCellMouseDown(e, supervisorUser, day, currentShift)}
                                                        onMouseEnter={() => handleCellMouseEnter(supervisorUser, day)}
                                                    >
                                                        <div className={`w-full h-full rounded-xl flex items-center justify-center transition-all duration-200 cursor-pointer p-0.5 ${cardClass} ${!canEdit && 'cursor-default hover:translate-y-0 hover:shadow-none'}`}>
                                                            {cardContent}
                                                        </div>
                                                    </th>
                                                );
                                            })}
                                        </tr>
                                    );
                                })()}
                            </thead>
                            <tbody className="divide-y divide-gray-100 bg-white">
                                {/* 2. ITERAR POR TIENDAS (SIN REPETIR SUPERVISOR) */}
                                {(() => {
                                    // Inicializar mapa de uso del supervisor por día
                                    // Key: DateString, Value: { amUsed: boolean, pmUsed: boolean }
                                    const dailySupUsage = new Map<string, { amUsed: boolean, pmUsed: boolean }>();

                                    return targetStores.map((currentStore: any) => {
                                        // Filtrar datos por tienda
                                        const storeUsers = localUsers.filter(u =>
                                            String(u.store_id) === String(currentStore.id) &&
                                            String(u.id) !== String(selectedSupervisorId)
                                        );
                                        const storeUserIds = new Set(storeUsers.map(u => String(u.id)));

                                        // Filtrar datos por tienda y SOLO usuarios activos en esta vista
                                        const storeSchedules = allSchedules.filter(s =>
                                            String(s.store_id) === String(currentStore.id) &&
                                            storeUserIds.has(String(s.user_id))
                                        );

                                        // Excluir al supervisor para la validación de cobertura de tienda
                                        const validationSchedules = storeSchedules.filter(s => String(s.user_id) !== String(selectedSupervisorId));

                                        const dailyStatuses = weekDays.map(d => {
                                            const dateStr = formatDateISO(d);
                                            const supShift = allSchedules.find(s => String(s.user_id) === String(selectedSupervisorId) && s.date === dateStr);

                                            // Obtener estado de uso actual para este día
                                            const usage = dailySupUsage.get(dateStr) || { amUsed: false, pmUsed: false };

                                            // Calcular estatus pasando disponibilidad (Solo disponible si NO se ha usado)
                                            const result = calculateDailyStatus(
                                                dateStr,
                                                validationSchedules,
                                                storeUsers,
                                                supShift,
                                                !usage.amUsed, // Available AM
                                                !usage.pmUsed  // Available PM
                                            );

                                            // Actualizar uso global si esta tienda consumió el recurso
                                            if (result.usedSupAM || result.usedSupPM) {
                                                dailySupUsage.set(dateStr, {
                                                    amUsed: usage.amUsed || result.usedSupAM,
                                                    pmUsed: usage.pmUsed || result.usedSupPM
                                                });
                                            }

                                            return result; // Retorna el objeto extendido con status
                                        });

                                        return (
                                            <React.Fragment key={currentStore.id}>
                                                {/* FILA DE CABECERA DE TIENDA */}
                                                <tr className="bg-slate-50 border-b border-slate-200">
                                                    <td className="p-3 sticky left-0 z-[15] bg-slate-50 border-r border-gray-200 border-t-4 border-t-blue-200 shadow-[4px_0_4px_-2px_rgba(0,0,0,0.05)]">
                                                        <div className="flex items-center gap-3">
                                                            <div className="w-8 h-8 rounded-lg bg-white border border-gray-200 flex items-center justify-center text-gray-700 shadow-sm">
                                                                <Store size={16} />
                                                            </div>
                                                            <h3 className="font-headings font-black text-gray-900 uppercase tracking-tight text-lg">
                                                                {formatStoreName(currentStore.name)}
                                                            </h3>
                                                        </div>
                                                    </td>
                                                    {dailyStatuses.map((status, idx) => (
                                                        <td key={idx} className={`p-2 text-center bg-slate-50/50 border-t-4 border-t-blue-200 ${idx === 6 ? 'border-r-4 border-slate-300' : 'border-r border-gray-200'}`}>
                                                            {status.status === 'ok' ? (
                                                                <div className="w-3.5 h-3.5 rounded-full bg-emerald-400 mx-auto shadow-sm ring-2 ring-emerald-100"></div>
                                                            ) : status.status === 'ok-sup' ? (
                                                                <div className="mx-auto px-2 py-1 rounded-lg bg-indigo-100 text-indigo-700 border border-indigo-200 text-[10px] font-black tracking-wide shadow-sm whitespace-nowrap">
                                                                    SUPLIDO
                                                                </div>
                                                            ) : status.status === 'bad' ? (
                                                                <div className="mx-auto px-2 py-1 rounded-lg bg-red-400 text-white text-[10px] font-black tracking-wider animate-pulse shadow-sm shadow-red-200">
                                                                    {status.label}
                                                                </div>
                                                            ) : (
                                                                <div className="w-1.5 h-1.5 rounded-full bg-gray-200 mx-auto"></div>
                                                            )}
                                                        </td>
                                                    ))}
                                                </tr>

                                                {/* FILAS DE USUARIOS */}
                                                {storeUsers.map(user => (
                                                    <tr key={`${currentStore.id}-${user.id}`} className="group hover:bg-gray-50 transition-colors">
                                                        <td className="p-2 sticky left-0 z-[10] bg-white group-hover:bg-gray-50 border-r border-gray-200 transition-colors shadow-[4px_0_4px_-2px_rgba(0,0,0,0.05)]">
                                                            <div className="flex items-center gap-3">
                                                                <div className={`w-12 h-12 rounded-lg flex items-center justify-center text-lg font-black text-white shadow-md
                                                                ${['manager'].some(r => user.role.toLowerCase().includes(r))
                                                                        ? 'bg-gradient-to-br from-indigo-500 to-purple-600' : 'bg-gradient-to-br from-gray-400 to-gray-500'}`}>
                                                                    {user.full_name.substring(0, 1).toUpperCase()}
                                                                </div>
                                                                <div className="flex flex-col">
                                                                    <span className="font-medium text-gray-900 text-lg flex items-center gap-1">
                                                                        {user.full_name}
                                                                        {['manager'].some(r => user.role.toLowerCase().includes(r)) && <span className="text-amber-500">👑</span>}
                                                                    </span>
                                                                    <span className="text-[11px] font-medium text-gray-400 uppercase tracking-widest bg-gray-100 px-2 py-0.5 rounded w-fit mt-1">{user.role}</span>
                                                                </div>
                                                            </div>
                                                        </td>
                                                        {weekDays.map((day, idx) => {
                                                            const dateStr = formatDateISO(day);
                                                            const currentShift = storeSchedules.find(s =>
                                                                String(s.user_id) === String(user.id) &&
                                                                s.date === dateStr &&
                                                                String(s.store_id) === String(currentStore.id)
                                                            );
                                                            const dayStatus = dailyStatuses[idx];

                                                            let cardContent = <div className="w-1.5 h-1.5 rounded-full bg-gray-100 group-hover:bg-gray-200"></div>;
                                                            let cardClass = "bg-transparent hover:bg-gray-100 border border-transparent";

                                                            if (currentShift) {
                                                                const preset = PRESETS.find(p => p.start === currentShift.start_time && p.end === currentShift.end_time);
                                                                const color = preset ? preset.color : 'bg-slate-100 text-slate-700 group-hover:bg-slate-200';
                                                                cardClass = `${color} shadow-sm group-hover:shadow-md transform transition-all duration-200 ${canEdit ? 'hover:-translate-y-1' : ''}`;
                                                                cardContent = (
                                                                    <div className="flex flex-col items-center justify-center w-full h-full p-1 gap-0">
                                                                        <span className="text-[18px] font-medium tracking-tight opacity-95 leading-none">
                                                                            {formatTime12h(currentShift.start_time?.slice(0, 5))}
                                                                        </span>
                                                                        <span className="text-[18px] font-medium tracking-tight opacity-95 leading-none">
                                                                            {formatTime12h(currentShift.end_time?.slice(0, 5))}
                                                                        </span>
                                                                    </div>
                                                                );
                                                            } else if (dayStatus.status === 'bad') {
                                                                // SOLO Marcar espacios vacíos si hay un ERROR de cobertura (Falta AM o PM)
                                                                // No marcar si está simplemente vacío (sin iniciar)
                                                                cardClass = "bg-red-50/50 border-2 border-dashed border-red-200 hover:bg-red-100 hover:border-red-300 animate-pulse";
                                                                cardContent = <div className="w-1.5 h-1.5 rounded-full bg-red-200 group-hover:bg-red-300"></div>;
                                                            }

                                                            return (
                                                                <td
                                                                    key={day.toISOString()}
                                                                    className={`p-1 h-[65px] last:border-0 align-middle ${idx === 6 ? 'border-r-4 border-slate-300' : 'border-r border-gray-200'}`}
                                                                    // PASAR EL ID DE LA TIENDA ACTUAL AL ABRIR EL MODAL
                                                                    onMouseDown={(e) => handleCellMouseDown(e, user, day, currentShift, String(currentStore.id))}
                                                                    onMouseEnter={() => handleCellMouseEnter(user, day)}
                                                                >
                                                                    <div className={`w-full h-full rounded-lg flex items-center justify-center transition-all duration-200 cursor-pointer p-0.5 ${cardClass} ${!canEdit && 'cursor-default hover:translate-y-0 hover:shadow-none'}`}>
                                                                        {cardContent}
                                                                    </div>
                                                                </td>
                                                            );
                                                        })}
                                                    </tr>
                                                ))}
                                            </React.Fragment>
                                        );
                                    })
                                }
                                )()}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div >
        );
    };

    const handleTourComplete = () => {
        setShowTour(false);
    };

    return (
        <div className="flex bg-transparent font-sans text-gray-900 w-full h-[calc(100vh-64px)] animate-in fade-in duration-500">
            {/* TOUR OVERLAY */}
            <AnimatePresence>
                {showTour && <OnboardingTour onComplete={handleTourComplete} />}
            </AnimatePresence>

            <main className="flex-1 flex flex-col w-full relative transition-all duration-300 min-h-0">

                {/* CONTENIDO PRINCIPAL SCROLLABLE */}
                <div className={`flex-1 w-full relative transition-all duration-300 min-h-0 ${viewMode === 'dashboard' ? 'overflow-y-auto p-4 md:p-6' : 'overflow-hidden flex flex-col'}`}>
                    {loading ? (
                        <div className="flex flex-col items-center justify-center h-64 gap-4">
                            <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                            <p className="text-gray-400 font-medium">Sincronizando horarios...</p>
                        </div>
                    ) : (
                        viewMode === 'dashboard' ? renderDashboard() : renderEditor()
                    )}
                </div>

                {/* MODAL */}
                <AnimatePresence>
                    {editingShift && (
                        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                            {/* Backdrop */}
                            <motion.div
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                onClick={() => setEditingShift(null)}
                                className="absolute inset-0 bg-black/50 backdrop-blur-sm"
                            />

                            {/* Modal Container */}
                            <motion.div
                                initial={{ scale: 0.95, opacity: 0, y: 10 }}
                                animate={{ scale: 1, opacity: 1, y: 0 }}
                                exit={{ scale: 0.95, opacity: 0, y: 10 }}
                                className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]"
                            >
                                {/* Header Estilo Pregunta (Indigo Gradient) */}
                                <div className="bg-gradient-to-r from-indigo-500 to-indigo-600 px-6 py-5 text-white flex items-center justify-between shrink-0">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center text-sm font-bold border border-white/20">
                                            {editingShift.userName?.[0]?.toUpperCase()}
                                        </div>
                                        <div>
                                            <h3 className="text-lg font-bold leading-tight">{editingShift.userName}</h3>
                                            <div className="flex items-center gap-1 text-indigo-100 text-xs font-medium uppercase tracking-wide">
                                                <Calendar size={12} />
                                                {formatDateNice(editingShift.date)}
                                            </div>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => setEditingShift(null)}
                                        className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/25 flex items-center justify-center transition-colors"
                                    >
                                        <X size={16} />
                                    </button>
                                </div>

                                <div className="p-6 overflow-y-auto custom-scrollbar space-y-8">
                                    {/* Presets Grid - Clean Style */}
                                    <div className="space-y-3">
                                        <label className="text-xs font-bold text-indigo-900 uppercase tracking-wider block">Turnos Comunes</label>
                                        <div className="grid grid-cols-2 gap-2">
                                            <button
                                                onClick={() => setEditingShift({ ...editingShift, start: '', end: '', presetId: 'off' })}
                                                className={`p-3 rounded-lg border text-sm font-bold flex items-center justify-center gap-2 transition-all
                                                    ${!editingShift.start
                                                        ? 'bg-indigo-600 border-indigo-600 text-white shadow-md shadow-indigo-200'
                                                        : 'bg-white border-indigo-100 text-indigo-600 hover:border-indigo-300 hover:bg-indigo-50'}`}
                                            >
                                                <MoonStar size={14} />
                                                <span>DESCANSO</span>
                                            </button>

                                            {PRESETS.map(p => {
                                                const isSelected = editingShift.start === p.start && editingShift.end === p.end;
                                                return (
                                                    <button
                                                        key={p.id}
                                                        onClick={() => setEditingShift({ ...editingShift, start: p.start, end: p.end, presetId: p.id })}
                                                        className={`p-3 rounded-lg border text-sm font-bold transition-all
                                                            ${isSelected
                                                                ? 'bg-indigo-600 border-indigo-600 text-white shadow-md shadow-indigo-200'
                                                                : 'bg-white border-indigo-100 text-indigo-600 hover:border-indigo-300 hover:bg-indigo-50'}`}
                                                    >
                                                        {formatTime12h(p.start)} - {formatTime12h(p.end)}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    {/* Time Inputs - Digital Clock Style */}
                                    <div className="space-y-3">
                                        <label className="text-xs font-bold text-indigo-900 uppercase tracking-wider block">Horario Manual</label>
                                        <div className="flex items-center gap-4 bg-indigo-50/50 p-4 rounded-xl border border-indigo-100">
                                            <div className="flex-1">
                                                <label className="text-[10px] font-bold text-indigo-400 uppercase mb-1 block">Entrada</label>
                                                <input
                                                    type="time"
                                                    value={editingShift.start}
                                                    onChange={(e) => setEditingShift({ ...editingShift, start: e.target.value, presetId: 'custom' })}
                                                    className="w-full bg-white px-3 py-2 rounded-lg border border-indigo-200 text-xl font-mono font-bold text-center text-zinc-900 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all"
                                                />
                                            </div>
                                            <div className="text-indigo-300 pt-4">
                                                <ArrowRight size={20} />
                                            </div>
                                            <div className="flex-1 text-right">
                                                <label className="text-[10px] font-bold text-indigo-400 uppercase mb-1 block">Salida</label>
                                                <input
                                                    type="time"
                                                    value={editingShift.end}
                                                    onChange={(e) => setEditingShift({ ...editingShift, end: e.target.value, presetId: 'custom' })}
                                                    className="w-full bg-white px-3 py-2 rounded-lg border border-indigo-200 text-xl font-mono font-bold text-center text-zinc-900 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Footer Actions */}
                                <div className="p-4 border-t border-indigo-100 bg-indigo-50/30 flex items-center justify-end gap-3 shrink-0">
                                    <button
                                        onClick={() => setEditingShift(null)}
                                        className="px-5 py-3 rounded-xl text-sm font-bold text-indigo-400 hover:text-indigo-700 hover:bg-indigo-50 transition-colors"
                                    >
                                        Cancelar
                                    </button>
                                    <motion.button
                                        whileHover={{ scale: 1.02 }}
                                        whileTap={{ scale: 0.98 }}
                                        onClick={saveShift}
                                        className="px-6 py-3 bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-700 hover:to-indigo-800 text-white rounded-xl text-sm font-bold shadow-lg shadow-indigo-200 flex items-center gap-2 transition-all"
                                    >
                                        <Save size={16} />
                                        <span>Guardar</span>
                                    </motion.button>
                                </div>
                            </motion.div>
                        </div>
                    )}
                </AnimatePresence>
            </main>
            {/* MODAL DE REPLICACIÓN */}
            <AnimatePresence>
                {showReplicationModal && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
                    >
                        <motion.div
                            initial={{ scale: 0.95, y: 20 }}
                            animate={{ scale: 1, y: 0 }}
                            className="bg-white rounded-2xl shadow-2xl max-w-sm w-full overflow-hidden"
                        >
                            <div className="bg-gradient-to-r from-indigo-500 to-indigo-600 p-6 text-white text-center">
                                <Sparkles size={48} className="mx-auto mb-4 opacity-80" />
                                <h3 className="text-xl font-black">¿Copiar Semana Anterior?</h3>
                                <p className="text-indigo-100 text-sm mt-2 leading-relaxed">
                                    Detectamos tiendas sin horarios. ¿Deseas replicar los turnos anteriores?
                                </p>
                            </div>
                            <div className="p-6">
                                <div className="bg-indigo-50 rounded-lg p-4 mb-6 border border-indigo-100">
                                    <div className="flex items-center gap-2 text-indigo-900 text-sm font-bold mb-2">
                                        <Store size={16} className="text-indigo-500" />
                                        <span>Tiendas a rellenar:</span>
                                    </div>
                                    <ul className="list-disc pl-8 mb-3 space-y-1">
                                        {replicationCandidates.map(c => (
                                            <li key={c.id} className="text-xs font-bold text-gray-600 uppercase tracking-wide">
                                                {formatStoreName(c.name)}
                                            </li>
                                        ))}
                                    </ul>
                                    <div className="h-px bg-indigo-200 my-2"></div>
                                    <div className="flex items-center gap-2 text-indigo-900 text-xs font-medium">
                                        <Calendar size={14} className="text-indigo-400" />
                                        <span>Origen: {formatDateNice(addDays(weekStart, -7))} al {formatDateNice(addDays(weekStart, -1))}</span>
                                    </div>
                                    <div className="flex items-center gap-2 text-indigo-900 text-xs font-medium mt-1">
                                        <ArrowRight size={14} className="text-emerald-500" />
                                        <span>Destino: {formatDateNice(weekStart)} al {formatDateNice(addDays(weekStart, 6))} (Semana 1)</span>
                                    </div>
                                </div>

                                <div className="flex gap-3">
                                    <button
                                        onClick={dismissReplication}
                                        className="flex-1 py-3 px-4 rounded-xl font-bold text-gray-500 hover:bg-gray-50 transition-colors"
                                    >
                                        No, gracias
                                    </button>
                                    <button
                                        onClick={handleReplicateWeek}
                                        disabled={replicationLoading}
                                        className="flex-1 py-3 px-4 rounded-xl font-bold bg-indigo-600 text-white hover:bg-indigo-700 shadow-lg shadow-indigo-200 transition-all flex items-center justify-center gap-2"
                                    >
                                        {replicationLoading ? 'Copiando...' : 'Sí, Copiar'}
                                    </button>
                                </div>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    )
}

export default function HorariosPage() {
    return (
        <ProtectedRoute>
            <Suspense fallback={<SurpriseLoader />}>
                <ScheduleManager />
            </Suspense>
        </ProtectedRoute>
    )
}