'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import ProtectedRoute, { useAuth } from '@/components/ProtectedRoute'
import { getSupabaseClient } from '@/lib/supabase'

// --- CONFIGURACIÓN DE DATOS ---
const PRESETS = [
    { id: 'apertura', label: 'Apertura', start: '08:00', end: '16:00', color: 'bg-amber-100 text-amber-800 border-amber-300' },
    { id: 'am', label: 'Mañana', start: '09:00', end: '17:00', color: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
    { id: 'inter', label: 'Intermedio', start: '14:00', end: '22:00', color: 'bg-blue-100 text-blue-800 border-blue-300' },
    { id: 'pm', label: 'Tarde/Noche', start: '17:00', end: '01:00', color: 'bg-indigo-100 text-indigo-800 border-indigo-300' },
    { id: 'cierre', label: 'Cierre', start: '17:00', end: '02:00', color: 'bg-purple-100 text-purple-800 border-purple-300' },
    { id: 'cierre_fds', label: 'Cierre FDS', start: '17:00', end: '04:00', color: 'bg-fuchsia-100 text-fuchsia-800 border-fuchsia-300' },
    { id: 'visita', label: 'Visita Sup.', start: '09:00', end: '17:00', color: 'bg-cyan-50 text-cyan-700 border-cyan-300 border-dashed' },
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
            <div className="flex justify-between items-end mb-6">
                <div>
                    <h2 className="text-3xl font-black text-gray-900 tracking-tight">Centro de Control</h2>
                    <p className="text-gray-500 mt-1">
                        {canEdit ? '👋 Hola Admin. Selecciona una tienda para gestionar.' : '👀 Modo Lectura. Visualización de cobertura.'}
                    </p>
                </div>
                <div className="hidden md:flex items-center gap-3">
                    <div className="flex items-center bg-white rounded-full p-1 shadow-sm border border-gray-200">
                        <button onClick={() => setCurrentDate(addDays(currentDate, -7))} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-500">◀</button>
                        <span className="px-4 font-mono font-bold text-xs text-gray-700">
                            {formatDateNice(weekStart)} — {formatDateNice(addDays(weekStart, 6))}
                        </span>
                        <button onClick={() => setCurrentDate(addDays(currentDate, 7))} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-500">▶</button>
                    </div>

                    <div className="bg-white px-4 py-2 rounded-xl border border-gray-100 shadow-sm flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></div>
                        <span className="text-xs font-bold text-gray-600">Alerta de Cobertura</span>
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
                                        {store.name}
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

        return (
            <div className="animate-fade-in space-y-4">
                <div className="bg-white border-b border-gray-200 sticky top-0 z-30 p-4 rounded-2xl shadow-sm flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <button onClick={() => setViewMode('dashboard')} className="w-10 h-10 flex items-center justify-center rounded-full bg-gray-100 text-gray-600 hover:bg-black hover:text-white transition-all">←</button>
                        <div>
                            <h2 className="text-xl font-black text-gray-900">{currentStore?.name}</h2>
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
                            {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                    </div>
                </div>

                {/* 🔥 NUEVA LEYENDA VISUAL 🔥 */}
                <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex flex-col md:flex-row gap-6 justify-between items-start md:items-center">
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

                <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden select-none">
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
                                                const color = preset ? preset.color : 'bg-white border-blue-200 text-blue-800 shadow-sm';

                                                cardClass = `${color} border shadow-sm hover:shadow-md hover:-translate-y-0.5`;
                                                cardContent = (
                                                    <div className="flex flex-col items-center justify-center w-full h-full p-1">
                                                        <span className="text-xs font-bold leading-tight text-center">{preset ? preset.label : 'Personal'}</span>
                                                        <span className="text-[11px] opacity-90 mt-0.5 font-mono font-semibold">
                                                            {currentShift.start_time?.slice(0, 5)} - {currentShift.end_time?.slice(0, 5)}
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
        <div className="flex h-screen overflow-hidden bg-transparent font-sans text-gray-900 pt-20 lg:pt-0">
            <main className="flex-1 flex flex-col h-full w-full relative overflow-hidden transition-all duration-300">

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
                {
                    editingShift && (
                        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden transform transition-all scale-100">
                                <div className="bg-gray-50 px-6 py-4 border-b border-gray-100 flex justify-between items-center">
                                    <div>
                                        <h3 className="text-lg font-bold text-gray-900">{editingShift.userName}</h3>
                                        <p className="text-sm text-gray-500 capitalize">{formatDateNice(editingShift.date)} - {getDayName(editingShift.date)}</p>
                                    </div>
                                    <button onClick={() => setEditingShift(null)} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
                                </div>

                                <div className="p-6 space-y-5">
                                    <div className="grid grid-cols-2 gap-3">
                                        <button
                                            onClick={() => setEditingShift({ ...editingShift, start: '', end: '', presetId: 'off' })}
                                            className={`p-3 rounded-lg border text-sm font-bold transition-all ${!editingShift.start ? 'bg-gray-800 text-white ring-2 ring-offset-2 ring-gray-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
                                        >
                                            OFF (Descanso)
                                        </button>

                                        {PRESETS.map(p => (
                                            <button
                                                key={p.id}
                                                onClick={() => setEditingShift({ ...editingShift, start: p.start, end: p.end, presetId: p.id })}
                                                className={`p-2 rounded-lg border text-xs font-bold transition-all flex flex-col items-center justify-center gap-1
                               ${editingShift.start === p.start && editingShift.end === p.end
                                                        ? `ring-2 ring-offset-1 border-transparent ${p.color.replace('bg-', 'bg-opacity-100 bg-').replace('text-', 'text-black ')} ring-blue-500`
                                                        : `${p.color} hover:brightness-95`
                                                    }`}
                                            >
                                                <span>{p.label}</span>
                                                <span className="opacity-70 text-[10px] font-normal">{p.start} - {p.end}</span>
                                            </button>
                                        ))}
                                    </div>

                                    <div className="pt-4 border-t border-gray-100">
                                        <label className="text-xs font-bold text-gray-500 uppercase mb-2 block">Horario Personalizado</label>
                                        <div className="flex gap-4">
                                            <div className="flex-1">
                                                <span className="text-xs text-gray-400 mb-1 block">Entrada</span>
                                                <input
                                                    type="time"
                                                    value={editingShift.start}
                                                    onChange={(e) => setEditingShift({ ...editingShift, start: e.target.value })}
                                                    className="w-full p-2 border border-gray-300 rounded-lg text-lg font-mono font-bold text-gray-900 focus:ring-2 focus:ring-blue-500 outline-none"
                                                />
                                            </div>
                                            <div className="flex items-center text-gray-400 pt-5">➜</div>
                                            <div className="flex-1">
                                                <span className="text-xs text-gray-400 mb-1 block">Salida</span>
                                                <input
                                                    type="time"
                                                    value={editingShift.end}
                                                    onChange={(e) => setEditingShift({ ...editingShift, end: e.target.value })}
                                                    className="w-full p-2 border border-gray-300 rounded-lg text-lg font-mono font-bold text-gray-900 focus:ring-2 focus:ring-blue-500 outline-none"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div className="p-4 bg-gray-50 border-t border-gray-100 flex justify-end gap-3">
                                    <button onClick={() => setEditingShift(null)} className="px-4 py-2 text-sm font-bold text-gray-600 hover:bg-gray-200 rounded-lg">Cancelar</button>
                                    <button onClick={saveShift} className="px-6 py-2 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-md transition-colors">
                                        Guardar Cambios
                                    </button>
                                </div>
                            </div>
                        </div>
                    )
                }
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