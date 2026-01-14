'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import ProtectedRoute, { useAuth } from '@/components/ProtectedRoute'
import { getSupabaseClient, formatStoreName } from '@/lib/supabase'
import { motion, AnimatePresence } from 'framer-motion'
import {
    X, Clock, Coffee, Sun, Sunrise, Moon, MoonStar,
    Calendar, User, Save, Trash2, ArrowRight, Sparkles, Zap
} from 'lucide-react'

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
const formatDateISO = (d: Date) => d.toISOString().split('T')[0];
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
        return `${hours12}:${mStr} ${ampm}`;
    } catch (e) { return time; }
}

// --- SEMÁFORO (LÓGICA OPERATIVA) ---
const calculateDailyStatus = (dateStr: string, shifts: any[], users: any[]) => {
    // 1. Filtrar turnos del día
    const dayShifts = shifts.filter(s => s.date === dateStr);

    // CASO 1: Tienda sola (Nadie programado)
    if (dayShifts.length === 0) {
        return {
            status: 'empty',
            label: 'VACÍO',
            color: 'bg-gray-100 text-gray-400 border-gray-200'
        };
    }

    // 2. Analizar Cobertura de Turnos (Sin importar el rango/rol)
    // Se considera "AM" si alguien entra temprano (antes de la 1 PM)
    const hasMorning = dayShifts.some(s => {
        const startHour = parseInt(s.start_time?.split(':')[0] || '0');
        return startHour < 13;
    });

    // Se considera "PM" si alguien cubre la tarde/noche
    // Criterio: Entra tarde (>= 2 PM) O sale tarde (>= 8 PM) O es turno nocturno (cierra otro día)
    const hasEvening = dayShifts.some(s => {
        const start = parseInt(s.start_time?.split(':')[0] || '0');
        const end = parseInt(s.end_time?.split(':')[0] || '0');
        return start >= 14 || end >= 20 || end < start;
    });

    // CASO 2: Cobertura Total (Hay alguien en AM y alguien en PM)
    if (hasMorning && hasEvening) {
        return {
            status: 'ok',
            label: 'CUBIERTO',
            color: 'bg-emerald-500 text-white shadow-emerald-200 shadow-md'
        };
    }

    // CASO 3: Falta algún turno
    return {
        status: 'bad',
        label: !hasMorning ? 'FALTA AM' : 'FALTA PM',
        color: 'bg-red-500 text-white shadow-red-200 shadow-md'
    };
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

    const weekStart = getMonday(currentDate)
    const weekDays = Array.from({ length: 7 }).map((_, i) => addDays(weekStart, i))

    const loadGlobalData = async () => {
        setLoading(true)
        try {
            const supabase = await getSupabase()
            const startStr = formatDateISO(weekStart)
            const endStr = formatDateISO(addDays(weekStart, 6))
            const { data: sData } = await supabase.from('schedules').select('*').gte('date', startStr).lte('date', endStr)
            setAllSchedules(sData || [])
            const { data: uData } = await supabase.from('users').select('id, full_name, role, store_id').eq('is_active', true)
            setAllUsers(uData || [])
        } catch (e) { console.error(e) } finally { setLoading(false) }
    }

    const filterLocalData = () => {
        const currentStore = stores.find(s => String(s.id) === String(selectedStoreId));
        const supId = currentStore?.supervisor_id;
        const filteredUsers = allUsers.filter(u =>
            String(u.store_id) === String(selectedStoreId) || String(u.id) === String(supId)
        ).sort((a, b) => {
            const isLeaderA = ['manager', 'sup', 'gerente'].some(r => a.role.toLowerCase().includes(r));
            const isLeaderB = ['manager', 'sup', 'gerente'].some(r => b.role.toLowerCase().includes(r));
            if (isLeaderA && !isLeaderB) return -1;
            if (!isLeaderA && isLeaderB) return 1;
            return a.full_name.localeCompare(b.full_name);
        });
        setLocalUsers(filteredUsers);
        const filteredSchedules = allSchedules.filter(s => String(s.store_id) === String(selectedStoreId));
        setLocalSchedules(filteredSchedules);
    }

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
    const handleCellMouseDown = (e: React.MouseEvent, user: any, date: Date, shift: any) => {
        if (e.shiftKey && canEdit) {
            e.preventDefault();
            setIsDragging(true);
            setDragSource(shift);
        } else {
            openEditModal(user, date, shift);
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
                store_id: parseInt(selectedStoreId),
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
                store_id: parseInt(selectedStoreId),
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

        const newEntry = {
            user_id: parseInt(editingShift.userId),
            store_id: parseInt(selectedStoreId),
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

    const openEditModal = (user: any, date: Date, currentShift: any) => {
        if (!canEdit) return;
        setEditingShift({
            userId: user.id, userName: user.full_name, userRole: user.role,
            date: date, start: currentShift?.start_time || '', end: currentShift?.end_time || '',
            presetId: currentShift ? 'custom' : 'off'
        })
    }

    // --- RENDERIZADO ---

    const renderDashboard = () => (
        <div className="animate-fade-in">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4 mb-6">
                <div>
                    <h2 className="text-3xl font-black text-gray-900 tracking-tight">Centro de Control</h2>
                    <p className="text-gray-500 mt-1">
                        {canEdit ? '👋 Hola Admin. Selecciona una tienda para gestionar.' : '👀 Modo Lectura. Visualización de cobertura.'}
                    </p>
                </div>
                <div className="flex items-center gap-3 w-full md:w-auto">
                    <div className="flex items-center justify-between md:justify-start bg-white rounded-full p-1 shadow-sm border border-gray-200 w-full md:w-auto">
                        <button onClick={() => setCurrentDate(addDays(currentDate, -7))} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-500">◀</button>
                        <span className="px-4 font-mono font-bold text-xs text-gray-700 whitespace-nowrap">
                            {formatDateNice(weekStart)} — {formatDateNice(addDays(weekStart, 6))}
                        </span>
                        <button onClick={() => setCurrentDate(addDays(currentDate, 7))} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-500">▶</button>
                    </div>

                    <div className="hidden md:flex bg-white px-4 py-2 rounded-xl border border-gray-100 shadow-sm items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></div>
                        <span className="text-xs font-bold text-gray-600">Alerta</span>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
                {stores.map(store => {
                    const storeShifts = allSchedules.filter(s => String(s.store_id) === String(store.id));
                    const weekStatuses = weekDays.map(d => calculateDailyStatus(formatDateISO(d), storeShifts, allUsers));
                    const hasRisk = weekStatuses.some(s => s.status === 'bad');

                    return (
                        <div
                            key={store.id}
                            onClick={() => { setSelectedStoreId(String(store.id)); setViewMode('editor'); }}
                            className={`bg-white rounded-2xl p-6 border-2 transition-all duration-300 cursor-pointer group hover:-translate-y-1 relative overflow-hidden
                            ${hasRisk ? 'border-red-100 hover:border-red-300 shadow-red-50' : 'border-transparent hover:border-blue-200 shadow-sm hover:shadow-xl'}
                        `}
                        >
                            {hasRisk && (
                                <div className="absolute top-0 right-0 bg-red-500 text-white text-[9px] font-bold px-3 py-1 rounded-bl-xl">
                                    ATENCIÓN
                                </div>
                            )}
                            <div className="flex items-center gap-4 mb-5">
                                <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-xl shadow-inner
                                ${hasRisk ? 'bg-red-50 text-red-500' : 'bg-blue-50 text-blue-600'}`}>
                                    🏪
                                </div>
                                <div>
                                    <h3 className="font-bold text-gray-900 text-lg leading-tight group-hover:text-blue-600 transition-colors">
                                        {formatStoreName(store.name)}
                                    </h3>
                                    <p className="text-xs text-gray-400 font-medium uppercase tracking-wider mt-0.5">
                                        {store.supervisor_name || 'Sin Supervisor'}
                                    </p>
                                </div>
                            </div>
                            <div className="flex justify-between items-end">
                                {weekStatuses.map((st, idx) => (
                                    <div key={idx} className="flex flex-col items-center gap-1.5 w-full">
                                        <div className={`w-full h-1.5 rounded-full ${st.color.split(' ')[0]}`}></div>
                                        <span className="text-[9px] font-bold text-gray-400">{['L', 'M', 'M', 'J', 'V', 'S', 'D'][idx]}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )
                })}
            </div>
        </div>
    );

    const renderEditor = () => {
        const currentStore = stores.find(s => String(s.id) === String(selectedStoreId));
        const isEmptyWeek = localSchedules.length === 0;

        return (
            <div className="animate-fade-in space-y-4">
                {/* BANNER COPIAR SEMANA (Solo si está vacío y puede editar) */}
                <AnimatePresence>
                    {isEmptyWeek && canEdit && !loading && (
                        <motion.div
                            initial={{ opacity: 0, y: -20 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -20 }}
                            className="bg-slate-900 rounded-[2rem] p-8 text-white flex flex-col md:flex-row items-center justify-between gap-6 shadow-2xl shadow-slate-200 border border-white/10 relative overflow-hidden"
                        >
                            <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/10 rounded-full -mr-32 -mt-32 blur-3xl"></div>
                            <div className="relative flex items-center gap-6">
                                <div className="w-16 h-16 rounded-3xl bg-white/10 backdrop-blur-md border border-white/20 flex items-center justify-center shadow-xl">
                                    <Zap size={32} className="text-amber-400 fill-amber-400" />
                                </div>
                                <div>
                                    <h3 className="text-xl font-black tracking-tight">Semana sin programación</h3>
                                    <p className="text-slate-400 text-sm">¿Quieres ahorrar tiempo copiando los horarios de la semana anterior?</p>
                                </div>
                            </div>
                            <motion.button
                                whileHover={{ scale: 1.05 }}
                                whileTap={{ scale: 0.95 }}
                                onClick={copyFromLastWeek}
                                className="relative bg-white text-slate-900 px-8 py-4 rounded-2xl font-black text-sm shadow-xl flex items-center gap-2 hover:bg-slate-100 transition-colors"
                            >
                                <Zap size={16} className="fill-slate-900" />
                                COPIAR SEMANA ANTERIOR
                            </motion.button>
                        </motion.div>
                    )}
                </AnimatePresence>

                <div className="bg-white border-b border-gray-200 sticky top-0 z-30 p-4 rounded-2xl shadow-sm flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <button onClick={() => setViewMode('dashboard')} className="w-10 h-10 flex items-center justify-center rounded-full bg-gray-100 text-gray-600 hover:bg-black hover:text-white transition-all">←</button>
                        <div>
                            <h2 className="text-xl font-black text-gray-900">{formatStoreName(currentStore?.name)}</h2>
                            <p className="text-xs text-gray-500 font-medium">Gestión Semanal • {canEdit ? 'Shift + Arrastrar para copiar' : 'Solo Lectura'}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-4">
                        <div className="flex items-center bg-transparent rounded-full p-1 border border-gray-200">
                            <button onClick={() => setCurrentDate(addDays(currentDate, -7))} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white text-gray-500 shadow-sm transition-all">◀</button>
                            <span className="px-4 font-mono font-bold text-xs text-gray-700">
                                {formatDateNice(weekStart)} — {formatDateNice(addDays(weekStart, 6))}
                            </span>
                            <button onClick={() => setCurrentDate(addDays(currentDate, 7))} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white text-gray-500 shadow-sm transition-all">▶</button>
                        </div>
                        <select value={selectedStoreId} onChange={(e) => setSelectedStoreId(e.target.value)} className="hidden md:block text-sm bg-gray-50 border-none rounded-lg px-4 py-2 font-bold text-gray-700 cursor-pointer hover:bg-gray-100 focus:ring-0">
                            {stores.map(s => <option key={s.id} value={s.id}>{formatStoreName(s.name)}</option>)}
                        </select>
                    </div>
                </div>

                {/* 🔥 LEYENDA VISUAL (Desktop Only) 🔥 */}
                <div className="hidden md:flex bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex-col md:flex-row gap-6 justify-between items-start md:items-center">
                    <div className="space-y-2">
                        <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Estatus del Día</h3>
                        <div className="flex flex-wrap gap-2">
                            <span className="px-2 py-1 rounded text-[10px] font-bold bg-emerald-500 text-white shadow-sm">CUBIERTO</span>
                            <span className="px-2 py-1 rounded text-[10px] font-bold bg-red-500 text-white shadow-sm">FALTA AM/PM</span>
                            <span className="px-2 py-1 rounded text-[10px] font-bold bg-gray-100 text-gray-400 border border-gray-200">VACÍO</span>
                        </div>
                    </div>
                    <div className="space-y-2">
                        <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Tipos de Turno</h3>
                        <div className="flex flex-wrap gap-2">
                            {PRESETS.map(p => (
                                <span key={p.id} className={`px-2 py-1 rounded text-[10px] font-bold border ${p.color}`}>
                                    {p.label}
                                </span>
                            ))}
                            <span className="px-2 py-1 rounded text-[10px] font-bold bg-white border border-blue-200 text-blue-800 shadow-sm">
                                Personal
                            </span>
                        </div>
                    </div>
                </div>

                {/* 📱 MOBILE EDITOR VIEW (Day Tabs + List) */}
                <div className="md:hidden space-y-4">
                    {/* Day Selector Tabs */}
                    <div className="flex overflow-x-auto gap-2 pb-2 scrollbar-hide snap-x">
                        {weekDays.map((date, idx) => {
                            const isSelected = selectedDayIndex === idx;
                            const dateStr = formatDateISO(date);
                            const status = calculateDailyStatus(dateStr, localSchedules, localUsers);

                            return (
                                <button
                                    key={idx}
                                    onClick={() => setSelectedDayIndex(idx)}
                                    className={`flex-none snap-start flex flex-col items-center justify-center w-[4.5rem] h-20 rounded-2xl border-2 transition-all duration-200 ${isSelected
                                        ? 'bg-gray-900 border-gray-900 text-white shadow-lg scale-105 z-10'
                                        : 'bg-white border-gray-100 text-gray-400 hover:border-gray-200'
                                        }`}
                                >
                                    <span className="text-[10px] font-bold uppercase tracking-wider">{getDayName(date)}</span>
                                    <span className={`text-xl font-black ${isSelected ? 'text-white' : 'text-gray-800'}`}>{date.getDate()}</span>
                                    <div className={`w-1.5 h-1.5 rounded-full mt-1 ${status.status === 'ok' ? 'bg-emerald-500' :
                                        status.status === 'bad' ? 'bg-red-500' : 'bg-gray-200'
                                        }`}></div>
                                </button>
                            );
                        })}
                    </div>

                    {/* Day Status Header */}
                    {(() => {
                        const currentDayDate = weekDays[selectedDayIndex];
                        const dateStr = formatDateISO(currentDayDate);
                        const status = calculateDailyStatus(dateStr, localSchedules, localUsers);

                        return (
                            <div className={`p-3 rounded-xl flex items-center justify-between shadow-sm ${status.color}`}>
                                <span className="text-xs font-bold uppercase tracking-wider opacity-90">Estatus del Día</span>
                                <span className="text-sm font-black">{status.label}</span>
                            </div>
                        );
                    })()}

                    {/* Users List for Selected Day */}
                    <div className="space-y-3 pb-24">
                        {localUsers.map(user => {
                            const currentDayDate = weekDays[selectedDayIndex];
                            const dateStr = formatDateISO(currentDayDate);
                            const currentShift = localSchedules.find(s => String(s.user_id) === String(user.id) && s.date === dateStr);

                            let preset = null;
                            if (currentShift) {
                                preset = PRESETS.find(p => p.start === currentShift.start_time && p.end === currentShift.end_time);
                            }

                            return (
                                <div
                                    key={user.id}
                                    onClick={() => openEditModal(user, currentDayDate, currentShift)}
                                    className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 active:scale-[0.98] transition-all flex items-center justify-between"
                                >
                                    <div className="flex items-center gap-3">
                                        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-lg font-bold text-white shadow-sm
                                            ${['manager', 'admin', 'sup'].some(r => user.role.toLowerCase().includes(r))
                                                ? 'bg-gradient-to-br from-indigo-500 to-purple-600' : 'bg-gradient-to-br from-gray-400 to-gray-500'}`}>
                                            {user.full_name.substring(0, 1).toUpperCase()}
                                        </div>
                                        <div>
                                            <h4 className="font-bold text-gray-900 leading-tight">
                                                {user.full_name}
                                                {['manager', 'sup'].some(r => user.role.toLowerCase().includes(r)) && <span className="ml-1 text-amber-500 text-xs">👑</span>}
                                            </h4>
                                            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{user.role}</span>
                                        </div>
                                    </div>

                                    {/* Shift Pill */}
                                    <div className="text-right">
                                        {currentShift ? (
                                            <div className={`flex flex-col items-end`}>
                                                <span className={`px-3 py-1 rounded-lg text-xs font-bold shadow-sm mb-1 ${preset ? preset.color : 'bg-white border text-blue-800 border-blue-200'
                                                    }`}>
                                                    {preset ? preset.label : 'Personal'}
                                                </span>
                                                <span className="text-[10px] font-mono font-medium text-gray-400">
                                                    {formatTime12h(currentShift.start_time?.slice(0, 5))} - {formatTime12h(currentShift.end_time?.slice(0, 5))}
                                                </span>
                                            </div>
                                        ) : (
                                            <span className="px-3 py-1 rounded-lg bg-gray-50 text-gray-400 text-xs font-bold border border-gray-100">
                                                OFF
                                            </span>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* 💻 DESKTOP TABLE (Hidden on Mobile) */}
                <div className="hidden md:block bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden select-none">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm border-collapse">
                            <thead>
                                <tr className="bg-gray-50/50">
                                    <th className="p-4 text-left min-w-[220px] sticky left-0 bg-gray-50 z-20 border-r border-gray-200">
                                        <span className="text-xs font-black text-gray-400 uppercase tracking-widest">Colaborador</span>
                                    </th>
                                    {weekDays.map(day => {
                                        const dateStr = formatDateISO(day);
                                        const status = calculateDailyStatus(dateStr, localSchedules, localUsers);
                                        return (
                                            <th key={day.toISOString()} className="p-3 min-w-[140px] border-r border-gray-200 last:border-0">
                                                <div className="flex flex-col items-center gap-1">
                                                    <span className="text-[10px] font-bold text-gray-400 uppercase">{getDayName(day)}</span>
                                                    <span className="text-xl font-black text-gray-800">{day.getDate()}</span>
                                                    <div className={`mt-1 px-3 py-0.5 rounded-full text-[10px] font-bold tracking-wide w-full text-center ${status.color}`}>
                                                        {status.label}
                                                    </div>
                                                </div>
                                            </th>
                                        )
                                    })}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                                {localUsers.map(user => (
                                    <tr key={user.id} className="group hover:bg-gray-50 transition-colors">
                                        <td className="p-4 sticky left-0 bg-white group-hover:bg-gray-50 z-10 border-r border-gray-200 transition-colors">
                                            <div className="flex items-center gap-3">
                                                <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold text-white shadow-md
                                                ${['manager', 'admin', 'sup'].some(r => user.role.toLowerCase().includes(r))
                                                        ? 'bg-gradient-to-br from-indigo-500 to-purple-600' : 'bg-gradient-to-br from-gray-400 to-gray-500'}`}>
                                                    {user.full_name.substring(0, 1).toUpperCase()}
                                                </div>
                                                <div className="flex flex-col">
                                                    <span className="font-bold text-gray-900 text-sm flex items-center gap-1">
                                                        {user.full_name}
                                                        {['manager', 'sup'].some(r => user.role.toLowerCase().includes(r)) && <span className="text-amber-500">👑</span>}
                                                    </span>
                                                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide bg-gray-100 px-1.5 rounded w-fit mt-0.5">{user.role}</span>
                                                </div>
                                            </div>
                                        </td>
                                        {weekDays.map(day => {
                                            const dateStr = formatDateISO(day);
                                            const currentShift = localSchedules.find(s => String(s.user_id) === String(user.id) && s.date === dateStr);

                                            let cardContent = <div className="w-1.5 h-1.5 rounded-full bg-gray-200 group-hover:bg-gray-300"></div>;
                                            let cardClass = "bg-transparent hover:bg-gray-100 border border-transparent";

                                            if (currentShift) {
                                                const preset = PRESETS.find(p => p.start === currentShift.start_time && p.end === currentShift.end_time);
                                                // Cleaner style: No border, solid pastel, shadow
                                                const color = preset ? preset.color : 'bg-slate-100 text-slate-700 group-hover:bg-slate-200';

                                                cardClass = `${color} shadow-sm group-hover:shadow-md transform transition-all duration-200 ${canEdit ? 'hover:-translate-y-1' : ''}`;

                                                cardContent = (
                                                    <div className="flex flex-col items-center justify-center w-full h-full p-2 gap-1">
                                                        <span className="text-[10px] font-black uppercase tracking-wider opacity-60 leading-none">
                                                            {preset ? preset.label : 'Personal'}
                                                        </span>
                                                        <span className="text-xs md:text-xs font-bold font-mono tracking-tight leading-none bg-white/40 px-1.5 py-0.5 rounded-md">
                                                            {formatTime12h(currentShift.start_time?.slice(0, 5))} - {formatTime12h(currentShift.end_time?.slice(0, 5))}
                                                        </span>
                                                    </div>
                                                );
                                            }
                                            return (
                                                <td
                                                    key={day.toISOString()}
                                                    className="p-2 h-[80px] border-r border-gray-200 last:border-0"
                                                    onMouseDown={(e) => handleCellMouseDown(e, user, day, currentShift)}
                                                    onMouseEnter={() => handleCellMouseEnter(user, day)}
                                                >
                                                    <div className={`w-full h-full rounded-xl flex items-center justify-center transition-all duration-200 cursor-pointer ${cardClass} ${!canEdit && 'cursor-default hover:translate-y-0 hover:shadow-none'}`}>
                                                        {cardContent}
                                                    </div>
                                                </td>
                                            );
                                        })}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="flex bg-transparent font-sans text-gray-900 w-full animate-in fade-in duration-500">
            <main className="flex-1 flex flex-col w-full relative transition-all duration-300">

                {/* CONTENIDO PRINCIPAL SCROLLABLE */}
                <div className="flex-1 overflow-y-auto p-4 md:p-6 w-full">
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
                                className="absolute inset-0 bg-slate-900/60 backdrop-blur-md"
                            />

                            {/* Modal Container */}
                            <motion.div
                                initial={{ scale: 0.9, opacity: 0, y: 20 }}
                                animate={{ scale: 1, opacity: 1, y: 0 }}
                                exit={{ scale: 0.9, opacity: 0, y: 20 }}
                                className="relative bg-white rounded-[2rem] shadow-2xl w-full max-w-lg overflow-hidden border border-white/20"
                            >
                                {/* Header Premium - Solid Dark */}
                                <div className="bg-slate-950 px-8 py-8 text-white relative overflow-hidden">
                                    <div className="relative flex justify-between items-start">
                                        <div className="flex items-center gap-4">
                                            <div className="w-16 h-16 rounded-2xl bg-white/10 backdrop-blur-md border border-white/20 flex items-center justify-center text-2xl font-black shadow-xl">
                                                {editingShift.userName?.[0]?.toUpperCase()}
                                            </div>
                                            <div>
                                                <h3 className="text-2xl font-black tracking-tight leading-none mb-1">{editingShift.userName}</h3>
                                                <div className="flex items-center gap-2 text-indigo-100">
                                                    <Calendar size={14} className="opacity-70" />
                                                    <span className="text-xs font-bold uppercase tracking-widest leading-none">
                                                        {formatDateNice(editingShift.date)} • {getDayName(editingShift.date)}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => setEditingShift(null)}
                                            className="p-2 rounded-full hover:bg-white/10 transition-colors"
                                        >
                                            <X size={20} />
                                        </button>
                                    </div>
                                </div>

                                <div className="p-8 space-y-8 max-h-[70vh] overflow-y-auto custom-scrollbar">
                                    {/* Grid de Presets */}
                                    <div className="space-y-4">
                                        <div className="flex items-center justify-between">
                                            <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Seleccionar Turno</h4>
                                            <div className="h-px flex-1 bg-slate-100 ml-4"></div>
                                        </div>

                                        <div className="grid grid-cols-2 gap-3">
                                            {/* Botón OFF */}
                                            <motion.button
                                                whileHover={{ scale: 1.02 }}
                                                whileTap={{ scale: 0.98 }}
                                                onClick={() => setEditingShift({ ...editingShift, start: '', end: '', presetId: 'off' })}
                                                className={`col-span-2 group flex items-center justify-between p-4 rounded-2xl border-2 transition-all ${!editingShift.start
                                                    ? 'bg-slate-900 border-slate-900 text-white shadow-lg'
                                                    : 'bg-white border-slate-100 text-slate-600 hover:border-slate-200'
                                                    }`}
                                            >
                                                <div className="flex items-center gap-3">
                                                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${!editingShift.start ? 'bg-white/10 text-white' : 'bg-slate-50 text-slate-400'}`}>
                                                        <MoonStar size={18} />
                                                    </div>
                                                    <span className="font-bold text-sm">DIA DE DESCANSO (OFF)</span>
                                                </div>
                                                {!editingShift.start && <Sparkles size={16} className="text-amber-400" />}
                                            </motion.button>

                                            {/* Presets Grid */}
                                            {PRESETS.map(p => {
                                                const isSelected = editingShift.start === p.start && editingShift.end === p.end;
                                                return (
                                                    <motion.button
                                                        key={p.id}
                                                        whileHover={{ scale: 1.02 }}
                                                        whileTap={{ scale: 0.98 }}
                                                        onClick={() => setEditingShift({ ...editingShift, start: p.start, end: p.end, presetId: p.id })}
                                                        className={`relative flex flex-col items-start p-4 rounded-2xl border-2 transition-all group overflow-hidden ${isSelected
                                                            ? `border-purple-600 shadow-xl ring-2 ring-purple-600/10`
                                                            : `border-slate-100 hover:border-slate-200`
                                                            }`}
                                                    >
                                                        {/* Icono de fondo decorativo */}
                                                        <div className={`absolute -right-4 -bottom-4 opacity-5 group-hover:opacity-10 transition-opacity ${isSelected ? 'opacity-20 scale-150' : ''}`}>
                                                            {p.icon}
                                                        </div>

                                                        <div className="flex items-center gap-2 mb-2">
                                                            <div className={`w-6 h-6 rounded-lg flex items-center justify-center ${isSelected ? 'bg-purple-600 text-white' : 'bg-slate-50 text-slate-400'}`}>
                                                                {p.icon}
                                                            </div>
                                                            <span className={`text-[10px] font-black uppercase tracking-wider ${isSelected ? 'text-purple-600' : 'text-slate-400'}`}>
                                                                {p.label}
                                                            </span>
                                                        </div>
                                                        <span className={`text-sm font-black ${isSelected ? 'text-slate-900' : 'text-slate-700'}`}>
                                                            {formatTime12h(p.start)} - {formatTime12h(p.end)}
                                                        </span>

                                                        {isSelected && (
                                                            <motion.div
                                                                layoutId="active-bg"
                                                                className="absolute inset-0 bg-purple-50 -z-10"
                                                            />
                                                        )}
                                                    </motion.button>
                                                )
                                            })}
                                        </div>
                                    </div>

                                    {/* Horario Personalizado */}
                                    <div className="space-y-4 pt-4 border-t border-slate-100">
                                        <div className="flex items-center justify-between">
                                            <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Horario Personalizado</h4>
                                            <div className="h-px flex-1 bg-slate-100 ml-4"></div>
                                        </div>

                                        <div className="bg-slate-50 p-6 rounded-3xl border border-slate-100 grid grid-cols-2 gap-8 relative overflow-hidden">
                                            <div className="space-y-2">
                                                <label className="flex items-center gap-2 text-[10px] font-black text-slate-400 uppercase tracking-wider">
                                                    <Sunrise size={12} className="text-amber-500" />
                                                    Entrada
                                                </label>
                                                <input
                                                    type="time"
                                                    value={editingShift.start}
                                                    onChange={(e) => setEditingShift({ ...editingShift, start: e.target.value, presetId: 'custom' })}
                                                    className="w-full bg-white p-3 rounded-2xl border-2 border-slate-200 text-xl font-black text-slate-800 focus:border-indigo-500 outline-none shadow-sm transition-all"
                                                />
                                            </div>

                                            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 translate-y-2 text-slate-300">
                                                <ArrowRight size={24} />
                                            </div>

                                            <div className="space-y-2 text-right">
                                                <label className="flex items-center justify-end gap-2 text-[10px] font-black text-slate-400 uppercase tracking-wider">
                                                    Salida
                                                    <Moon size={12} className="text-indigo-500" />
                                                </label>
                                                <input
                                                    type="time"
                                                    value={editingShift.end}
                                                    onChange={(e) => setEditingShift({ ...editingShift, end: e.target.value, presetId: 'custom' })}
                                                    className="w-full bg-white p-3 rounded-2xl border-2 border-slate-200 text-xl font-black text-slate-800 focus:border-indigo-500 outline-none shadow-sm transition-all"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Footer con Botones */}
                                <div className="p-8 bg-slate-50 border-t border-slate-200/60 flex items-center justify-between gap-4">
                                    <button
                                        onClick={() => setEditingShift(null)}
                                        className="h-14 px-8 text-sm font-bold text-slate-500 hover:text-slate-800 transition-colors"
                                    >
                                        Cancelar
                                    </button>

                                    <motion.button
                                        whileHover={{ scale: 1.02 }}
                                        whileTap={{ scale: 0.98 }}
                                        onClick={saveShift}
                                        className="flex-1 h-14 bg-slate-900 hover:bg-black text-white rounded-2xl text-sm font-black shadow-lg shadow-slate-200 flex items-center justify-center gap-2 transition-all"
                                    >
                                        <Save size={18} />
                                        GUARDAR CAMBIOS
                                    </motion.button>
                                </div>
                            </motion.div>
                        </div>
                    )}
                </AnimatePresence>
            </main>
        </div>
    )
}

export default function HorariosPage() {
    return (
        <ProtectedRoute>
            <Suspense fallback={<div className="p-10 text-center">Cargando Horarios...</div>}>
                <ScheduleManager />
            </Suspense>
        </ProtectedRoute>
    )
}