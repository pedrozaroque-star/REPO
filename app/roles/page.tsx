'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { createClient } from '@/lib/supabase-client';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Building2, 
  Users, 
  ChefHat, 
  Monitor, 
  ChevronLeft, 
  ChevronRight,
  Save,
  LayoutTemplate,
  Zap,
  CheckCircle2,
  Copy,
  FolderOpen,
  PlusCircle,
  Clock,
  Trash2,
  FileText,
  Loader2,
  Sun,
  Moon,
  Phone,
  Mail,
  UserMinus,
  RefreshCw,
  UserCheck,
  X
} from 'lucide-react';
import { format, startOfWeek, addDays, isSameDay, subDays } from 'date-fns';
import { es } from 'date-fns/locale';
import { getRoleWeight, getMonday, formatDateISO, formatStoreName } from '../planificador-v2/lib/utils';

// SUB-COMPONENTE PARA EL TABLERO VISUAL
const BoardSlot = ({ label, assignee, employees, className = "", onClick }: any) => {
  const emp = assignee ? employees.find((e: any) => String(e.id) === String(assignee.employee_id)) : null;
  
  return (
    <div 
      onClick={() => onClick(label, emp, assignee)}
      className={`p-1.5 flex flex-col h-full cursor-pointer group active:scale-95 transition-all ${className}`}
    >
      <div className={`w-full h-full p-2.5 rounded-[1.5rem] transition-all duration-300 overflow-hidden relative flex flex-col items-center justify-center ${
        emp 
        ? 'bg-white shadow-[0_8px_25px_rgba(0,0,0,0.08)] ring-1 ring-black/5 group-hover:shadow-[0_15px_40px_rgba(0,0,0,0.12)]' 
        : 'bg-amber-50/50 border-[2.5px] border-dashed border-amber-200/80 shadow-none group-hover:border-amber-300'
      }`}>
        {/* Subtle accent bar at top */}
        {emp && <div className="absolute top-0 inset-x-0 h-1 bg-indigo-600/80" />}
        
        <span className={`text-[13px] font-black uppercase tracking-[0.15em] mb-1 text-center transition-colors ${
          emp ? 'text-indigo-600/80' : 'text-amber-800'
        }`}>
          {label}
        </span>
        <span className={`text-2xl font-black uppercase tracking-tighter leading-none text-center transition-all ${
          emp ? 'text-slate-900 font-black' : 'text-amber-400 drop-shadow-sm font-bold'
        }`}>
          {emp ? (emp.chosen_name || emp.first_name) : 'Libre'}
        </span>
        {emp && (
          <p className="text-[10px] font-black text-slate-600 mt-1 uppercase tracking-widest truncate w-full text-center">
            {emp.last_name}
          </p>
        )}
      </div>
    </div>
  );
};

export default function MissionControlRoles() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [stores, setStores] = useState<any[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState<string>('');
  const [currentWeekStart, setCurrentWeekStart] = useState(startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [assignments, setAssignments] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [jobs, setJobs] = useState<any[]>([]);
  const [activeShift, setActiveShift] = useState<'AM' | 'PM'>(() => {
    const hour = new Date().getHours();
    return (hour >= 17 || hour < 6) ? 'PM' : 'AM';
  });
  const [activeDay, setActiveDay] = useState<Date>(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [hasDriveThru, setHasDriveThru] = useState(true);
  const [extraCashiers, setExtraCashiers] = useState(1);
  const [activeWeeklyShifts, setActiveWeeklyShifts] = useState<any[]>([]);
  const [showVisualBoard, setShowVisualBoard] = useState(false);

  // States for Employee Contact Card
  const [selectedEmployeeCard, setSelectedEmployeeCard] = useState<any>(null);
  const [selectedSlotForCard, setSelectedSlotForCard] = useState<{label: string, assignee: any} | null>(null);
  const [isReassigning, setIsReassigning] = useState(false);
  
  // Derived GUID
  const selectedStoreGuid = useMemo(() => {
    return stores.find(s => String(s.id) === String(selectedStoreId))?.external_id || '';
  }, [stores, selectedStoreId]);
  
  // States for Templates
  const [templates, setTemplates] = useState<any[]>([]);
  const [newTemplateName, setNewTemplateName] = useState('');
  const [showTemplateSave, setShowTemplateSave] = useState(false);

  // Dynamic SECTIONS based on Drive-Thru toggle and dynamic cashiers
  const SECTIONS = useMemo(() => {
    const baseCajeras = ['Ventana 1', 'Ventana 2', 'Caja 1 / Salón'];
    const extrasCajeras = ['Caja 2', 'Caja 3', 'Caja 4', 'Caja 5'];
    
    const visibleExtras = extrasCajeras.filter((name, idx) => {
      const hasData = assignments.some(a => a.sub_position.startsWith(name));
      return hasData || (idx + 2 <= extraCashiers);
    });

    const finalCajeras = [...baseCajeras, ...visibleExtras, 'Uber + Salsas', 'ENTREGA', 'LIMPIEZA'].filter(s => {
      if (!hasDriveThru && (s === 'Ventana 1' || s === 'Ventana 2')) return false;
      return true;
    });

    return [
      { 
        id: 'front', 
        title: 'SALÓN / SERVICIO', 
        icon: Monitor, 
        color: 'blue', 
        stations: finalCajeras
      },
      { 
        id: 'kitchen', 
        title: 'COCINA CENTRAL', 
        icon: ChefHat, 
        color: 'orange', 
        stations: [
          'BURRITOS', 
          'TORTILLAS',
          'TORTAS/QUESADILLAS', 
          'TORTAS/MULITAS', 
          'TACOS', 
          'CARNES', 
          'PREPARACION'
        ] 
      },
      {
        id: 'drive-thru',
        title: 'APOYO DRIVE-THRU',
        icon: Zap,
        color: 'indigo',
        stations: [
          'TORTAS/QUESADILLAS (DT)',
          'TACOS/BURRITOS (DT)'
        ]
      }
    ];
  }, [hasDriveThru, extraCashiers, assignments]);

  useEffect(() => {
    fetchStores();
  }, []);


  const fetchStores = async () => {
    const { data } = await supabase.from('stores').select('*').order('name');
    if (data) {
      setStores(data);
      // PRIORIDAD ABSOLUTA: ID 7 (Slauson)
      const officialStore = data.find(s => String(s.id) === '7');
      if (officialStore) {
        setSelectedStoreId(String(officialStore.id));
      } else if (data.length > 0) {
        setSelectedStoreId(String(data[0].id));
      }
    }
  };

  const fetchTemplates = async () => {
    if (!selectedStoreGuid) return;
    const resp = await fetch(`/api/roles/templates?store_id=${selectedStoreGuid}`);
    const data = await resp.json();
    setTemplates(data || []);
  };

  const fetchWeeklyData = async () => {
    if (!selectedStoreGuid) return;
    setLoading(true);
    
    const officialMonday = getMonday(currentWeekStart);
    const start = formatDateISO(officialMonday);
    const end = formatDateISO(addDays(officialMonday, 6));

    // CARGA MASIVA (DESCANSOS Estilo): Bucle para saltar el límite de 1000 registros
    let allEmps: any[] = [];
    let page = 0;
    const PAGE_SIZE = 1000;
    let hasMore = true;

    while (hasMore) {
        const { data, error } = await supabase
            .from('toast_employees')
            .select('*')
            .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

        if (error || !data) break;
        allEmps = [...allEmps, ...data];
        if (data.length < PAGE_SIZE) hasMore = false;
        page++;
    }

    const { data: jobsData } = await supabase.from('toast_jobs').select('*');
    if (jobsData) setJobs(jobsData);

    const { data: weekShifts } = await supabase
      .from('shifts')
      .select('*')
      .eq('store_id', selectedStoreGuid)
      .gte('shift_date', start)
      .lte('shift_date', end);

    setActiveWeeklyShifts(weekShifts || []);
    const shiftEmployeeIds = new Set((weekShifts || [])?.map(s => String(s.employee_id)));

    // LÓGICA ESPEJO ABSOLUTA: app/planificador/page.tsx (loadStoreData) + DESCANSOS
    const ALLOWED_ROLES = ['manager', 'shift', 'cook', 'cocinero', 'cashier', 'cajero', 'prep', 'taquero', 'assistant', 'asst'];

    const filteredEmps = allEmps.filter((e: any) => {
      // 1. SIEMPRE MOSTRAR si tiene turno esta semana en esta tienda
      if (shiftEmployeeIds.has(String(e.id))) return true;

      // 2. Si no tiene turno, NO mostrar si está borrado
      if (e.deleted) return false;

      // 3. Robust Store ID Check (Copiado de Planificador V1)
      let empStoreIds: string[] = [];
      if (Array.isArray(e.store_ids)) {
          empStoreIds = e.store_ids;
      } else if (typeof e.store_ids === 'string') {
          if (e.store_ids.trim().startsWith('[')) {
              try {
                  const parsed = JSON.parse(e.store_ids);
                  if (Array.isArray(parsed)) empStoreIds = parsed;
              } catch {
                  empStoreIds = [e.store_ids];
              }
          } else {
              empStoreIds = [e.store_ids];
          }
      }
      
      const isMatch = empStoreIds.includes(selectedStoreGuid);
      if (!isMatch) return false;

      // 4. Chequear roles en job_references Y wage_data (useVisibleEmployees logic)
      const empJobGuids = new Set<string>();
      if (e.job_references && Array.isArray(e.job_references)) {
          e.job_references.forEach((r: any) => empJobGuids.add(r.guid));
      }
      if (e.wage_data && Array.isArray(e.wage_data)) {
          e.wage_data.forEach((w: any) => empJobGuids.add(w.job_guid));
      }

      let hasAllowedRole = false;
      for (const guid of Array.from(empJobGuids)) {
          const job = (jobsData || []).find(j => j.guid === guid || j.id === guid);
          if (job && job.title) {
              const titleLower = job.title.toLowerCase();
              if (ALLOWED_ROLES.some(role => titleLower.includes(role))) {
                  hasAllowedRole = true;
                  break;
              }
          }
      }
      return hasAllowedRole;
    });

    const sortedEmps = filteredEmps.sort((a, b) => {
      const getTitleSafe = (e: any) => {
          const ref = e.job_references?.[0];
          if (!ref) return '';
          const match = (jobsData || []).find(j => j.guid === ref.guid || j.id === ref.guid);
          return match?.title || '';
      }

      const weightA = getRoleWeight(getTitleSafe(a), (weekShifts || []).filter(s => s.employee_id === a.id));
      const weightB = getRoleWeight(getTitleSafe(b), (weekShifts || []).filter(s => s.employee_id === b.id));

      if (weightA !== weightB) return weightA - weightB;

      const nameA = (a.chosen_name || a.first_name || '') + ' ' + (a.last_name || '');
      const nameB = (b.chosen_name || b.first_name || '') + ' ' + (b.last_name || '');
      return nameA.localeCompare(nameB);
    });

    setEmployees(sortedEmps);

    try {
      const resp = await fetch(`/api/roles?store_id=${selectedStoreGuid}&start_date=${start}&end_date=${end}`);
      const rolesData = await resp.json();
      setAssignments(Array.isArray(rolesData) ? rolesData : []);
    } catch (e) {
      console.error(e);
      setAssignments([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWeeklyData();
    fetchTemplates();
  }, [selectedStoreGuid, currentWeekStart]);

  const updateAssignment = (dateStr: string, station: string, employeeId: string, group: string) => {
    const newAssignments = [...assignments];
    const shiftStation = `${station}_${activeShift}`;
    const index = newAssignments.findIndex(a => a.assignment_date === dateStr && a.sub_position === shiftStation);

    if (index !== -1) {
      if (employeeId === '') {
        newAssignments.splice(index, 1);
      } else {
        newAssignments[index].employee_id = employeeId;
      }
    } else if (employeeId !== '') {
      newAssignments.push({
        store_id: selectedStoreGuid,
        employee_id: employeeId,
        assignment_date: dateStr,
        main_station: station,
        sub_position: shiftStation,
        station_group: group
      });
    }
    setAssignments(newAssignments);
  };

  const handleSlotClick = (stationLabel: string, emp: any, assignee: any, group: string) => {
    setSelectedSlotForCard({ label: stationLabel, assignee: { ...assignee, station_group: group } });
    setSelectedEmployeeCard(emp);
    setIsReassigning(false);
  };

  const saveAssignments = async () => {
    setSaving(true);
    try {
      const response = await fetch('/api/roles', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignments, store_id: selectedStoreGuid })
      });
      if (response.ok) alert('🚀 Operación Guardada');
    } catch (error) { console.error(error); } finally { setSaving(false); }
  };

  const saveCurrentAsTemplate = async () => {
    if (!newTemplateName) return alert('Ponle un nombre a la plantilla');
    
    const activeDateStr = format(activeDay, 'yyyy-MM-dd');
    const shiftSuffix = `_${activeShift}`;
    const dayData = assignments
        .filter(a => a.assignment_date === activeDateStr && a.sub_position.endsWith(shiftSuffix))
        .map(({ store_id, assignment_date, id, ...rest }) => rest);

    if (dayData.length === 0) return alert('No hay asignaciones para guardar en este turno');

    const fullTemplateName = `${newTemplateName} (${activeShift})`;

    const response = await fetch('/api/roles/templates', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        store_id: selectedStoreGuid, 
        template_name: fullTemplateName,
        data: dayData 
      })
    });

    if (response.ok) {
      alert(`💾 Plantilla ${activeShift} Guardada`);
      setNewTemplateName('');
      setShowTemplateSave(false);
      fetchTemplates();
    }
  };

  const applyTemplate = (templateData: any[]) => {
    const activeDateStr = format(activeDay, 'yyyy-MM-dd');
    const shiftSuffix = `_${activeShift}`;

    // Helper to map legacy names to new synchronized names
    const mapStationName = (oldName: string, groupHint?: string) => {
      let name = oldName;
      if (name === 'BURRITOS (DT)') return 'TACOS/BURRITOS (DT)';
      
      // If it was TORTAS/QUESADILLAS but in DT group, it must be (DT) now
      if (name === 'TORTAS/QUESADILLAS' && groupHint === 'Drive-Thru') return 'TORTAS/QUESADILLAS (DT)';
      
      return name;
    };

    // Helper to find the current correct group for a station
    const findCurrentGroup = (stationName: string) => {
      for (const section of SECTIONS) {
        if (section.stations.includes(stationName)) return section.id;
      }
      return 'front'; // fallback
    };

    // Remove only assignments for the SAME DAY and SAME SHIFT
    const filteredAssignments = assignments.filter(a => 
      !(a.assignment_date === activeDateStr && a.sub_position.endsWith(shiftSuffix))
    );
    
    const newDayAssignments = templateData.map(a => {
        const mappedName = mapStationName(a.main_station, a.station_group);
        return {
          ...a,
          main_station: mappedName,
          sub_position: `${mappedName}${shiftSuffix}`,
          station_group: findCurrentGroup(mappedName),
          store_id: selectedStoreGuid,
          assignment_date: activeDateStr
        };
    });

    setAssignments([...filteredAssignments, ...newDayAssignments]);
    alert(`✨ Plantilla ${activeShift} Aplicada con éxito`);
  };

  const copyLastWeek = async () => {
    const startLast = format(subDays(currentWeekStart, 7), 'yyyy-MM-dd');
    const endLast = format(subDays(currentWeekStart, 1), 'yyyy-MM-dd');

    // Helper for legacy mapping inside copy
    const mapStationName = (oldName: string, groupHint?: string) => {
      if (oldName === 'BURRITOS (DT)') return 'TACOS/BURRITOS (DT)';
      if (oldName === 'TORTAS/QUESADILLAS' && groupHint === 'Drive-Thru') return 'TORTAS/QUESADILLAS (DT)';
      return oldName;
    };

    const findCurrentGroup = (stationName: string) => {
      for (const section of SECTIONS) {
        if (section.stations.includes(stationName)) return section.id;
      }
      return 'front';
    };

    const resp = await fetch(`/api/roles?store_id=${selectedStoreGuid}&start_date=${startLast}&end_date=${endLast}`);
    const lastData = await resp.json();

    if (lastData && lastData.length > 0) {
      const newAssignments = lastData.map((a: any) => {
          const originalDate = new Date(a.assignment_date + 'T00:00:00');
          const newDate = addDays(originalDate, 7);
          const mappedName = mapStationName(a.main_station, a.station_group);
          
          return {
              ...a,
              main_station: mappedName,
              sub_position: `${mappedName}${a.sub_position.includes('_PM') ? '_PM' : '_AM'}`,
              station_group: findCurrentGroup(mappedName),
              assignment_date: format(newDate, 'yyyy-MM-dd'),
              id: undefined, created_at: undefined, updated_at: undefined
          };
      });
      setAssignments(newAssignments);
      alert('📅 Semana anterior copiada con éxito');
    } else {
      alert('No hay datos la semana pasada');
    }
  };

  const getAssignee = (date: Date, station: string) => {
    const dateStr = format(date, 'yyyy-MM-dd');
    return assignments.find(a => a.assignment_date === dateStr && a.sub_position === station);
  };

  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(currentWeekStart, i));

  if (loading && stores.length === 0) return (
    <div className="min-h-screen bg-[#f8fafc] flex flex-col items-center justify-center p-12">
      <div className="w-12 h-12 border-4 border-indigo-100 border-t-indigo-600 rounded-full animate-spin mb-6" />
      <h2 className="text-sm font-bold text-slate-400 uppercase tracking-[0.3em]">Sincronizando Hub</h2>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-900 font-sans antialiased pb-20">
      {/* --- TOP HEADER (SALES STYLE) --- */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-xl border-b border-black/5 px-8 pt-6">
        <div className="max-w-[1900px] mx-auto flex flex-wrap items-center justify-between gap-8 mb-6">
          
          <div className="flex items-center gap-4">
            <div className="bg-indigo-600 p-3 rounded-2xl shadow-lg shadow-indigo-200">
              <Zap className="text-white fill-white" size={24} />
            </div>
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-slate-900 flex items-center gap-3">
                Roles Hub <span className="text-[10px] bg-slate-100 px-3 py-1 rounded-full border border-slate-200 tracking-widest font-black uppercase text-slate-500">Operativo</span>
              </h1>
              <p className="text-xs font-medium text-slate-400 mt-1 uppercase tracking-widest">Asignación Táctica de Estaciones</p>
            </div>
          </div>

          <div className="flex items-center gap-3 bg-white p-1.5 rounded-2xl border border-black/5 shadow-sm">
            <div className="flex items-center gap-2 px-4 border-r border-slate-100">
              <Building2 size={16} className="text-slate-400" />
              <select
                value={selectedStoreId}
                onChange={(e) => setSelectedStoreId(e.target.value)}
                className="bg-transparent border-none text-xs font-bold tracking-tight text-slate-600 focus:ring-0 cursor-pointer hover:text-indigo-600 transition-colors"
              >
                {stores.map(s => (
                  <option key={s.id} value={s.id}>
                    {formatStoreName(s.name).toUpperCase()}
                  </option>
                ))}
              </select>
            </div>
            
            <div className="flex items-center gap-2 px-2">
              <button 
                onClick={() => setCurrentWeekStart(subDays(currentWeekStart, 7))}
                className="p-2 hover:bg-slate-50 rounded-xl text-slate-400 hover:text-indigo-600 transition-all"
              >
                <ChevronLeft size={20} />
              </button>
              
              <div className="text-center min-w-[180px]">
                <span className="text-sm font-bold text-slate-900 tracking-tight">
                  {format(getMonday(currentWeekStart), 'MMM dd', { locale: es })} - {format(addDays(getMonday(currentWeekStart), 6), 'MMM dd', { locale: es })}
                </span>
                <span className="block text-[10px] font-bold text-indigo-500/60 uppercase tracking-widest mt-0.5">Semana Planificada</span>
              </div>

              <button 
                onClick={() => setCurrentWeekStart(addDays(currentWeekStart, 7))}
                className="p-2 hover:bg-slate-50 rounded-xl text-slate-400 hover:text-indigo-600 transition-all"
              >
                <ChevronRight size={20} />
              </button>
            </div>

            <div className="flex items-center gap-3 px-4 border-l border-slate-100">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">Tiene Drive-Thru</span>
              <button 
                onClick={() => setHasDriveThru(!hasDriveThru)}
                className={`relative w-10 h-5 rounded-full transition-all duration-300 ${hasDriveThru ? 'bg-indigo-600 shadow-lg shadow-indigo-100' : 'bg-slate-200'}`}
              >
                <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all duration-300 ${hasDriveThru ? 'left-6' : 'left-1'}`} />
              </button>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button 
              onClick={copyLastWeek}
              className="flex items-center gap-2 bg-white hover:bg-slate-50 text-slate-600 px-5 py-3 rounded-2xl border border-slate-200 font-bold text-xs transition-all shadow-sm"
            >
              <Copy size={16} />
              Clonar
            </button>
            
            <button 
              onClick={() => setShowTemplateSave(true)}
              className="flex items-center gap-2 bg-white hover:bg-slate-50 text-slate-600 px-5 py-3 rounded-2xl border border-slate-200 font-bold text-xs transition-all shadow-sm"
            >
              <LayoutTemplate size={16} />
              Librería
            </button>

            <button 
              onClick={() => setShowVisualBoard(true)}
              className="flex items-center gap-2 bg-slate-900 text-white px-5 py-3 rounded-2xl font-bold text-xs transition-all shadow-xl hover:bg-black active:scale-95"
            >
              <LayoutTemplate size={16} className="text-indigo-400" />
              Tablero
            </button>

            <button 
              onClick={saveAssignments}
              disabled={saving}
              className={`flex items-center gap-2 px-8 py-3 rounded-2xl font-bold text-xs tracking-wide shadow-xl transition-all active:scale-95 ${
                saving 
                ? 'bg-slate-100 text-slate-400 cursor-not-allowed' 
                : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-indigo-100'
              }`}
            >
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
              {saving ? 'Guardando...' : 'Guardar Cambios'}
            </button>
          </div>
        </div>

        {/* SHIFT SELECTOR TABS (INDUSTRIAL HIGH-VIS) */}
        <div className="max-w-[1900px] mx-auto px-8 pb-4">
          <div className="bg-slate-100 p-1.5 rounded-[2rem] flex gap-2 shadow-inner border border-black/5">
            <button 
              onClick={() => setActiveShift('AM')}
              className={`flex-1 flex items-center justify-center gap-3 py-4 rounded-[1.8rem] text-sm font-black uppercase tracking-widest transition-all duration-300 ${
                activeShift === 'AM' 
                ? 'bg-indigo-600 text-white shadow-xl shadow-indigo-100' 
                : 'text-slate-400 hover:text-slate-600 hover:bg-slate-200/50'
              }`}
            >
              <Sun size={18} className={activeShift === 'AM' ? 'text-white' : 'text-slate-300'} />
              Turno AM <span className="opacity-40 text-[10px] lowercase font-bold tracking-normal italic">(Apertura)</span>
            </button>
            <button 
              onClick={() => setActiveShift('PM')}
              className={`flex-1 flex items-center justify-center gap-3 py-4 rounded-[1.8rem] text-sm font-black uppercase tracking-widest transition-all duration-300 ${
                activeShift === 'PM' 
                ? 'bg-slate-900 text-white shadow-xl' 
                : 'text-slate-400 hover:text-slate-600 hover:bg-slate-200/50'
              }`}
            >
              <Moon size={18} className={activeShift === 'PM' ? 'text-white' : 'text-slate-300'} />
              Turno PM <span className="opacity-40 text-[10px] lowercase font-bold tracking-normal italic">(Cierre)</span>
            </button>
          </div>
        </div>
      </header>

      <main className="p-8 max-w-[1900px] mx-auto space-y-12">
        <div className="flex flex-col gap-12">
          {SECTIONS.map((section) => (
            <div key={section.id} className="bg-white/50 rounded-[2.5rem] border border-black/5 p-8 shadow-sm">
              <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-4">
                   <div className={`p-4 rounded-2xl bg-white border border-slate-100 shadow-sm`}>
                      <section.icon size={24} className={`text-${section.color === 'blue' ? 'blue' : 'orange'}-500`} />
                   </div>
                   <div>
                     <h2 className="text-xl font-bold text-slate-900 uppercase tracking-tight flex items-center gap-3">
                       {section.title} 
                       <span className="text-indigo-500 text-sm opacity-50">{activeShift}</span>
                       {section.id === 'front' && (
                         <div className="flex items-center gap-1.5 ml-2">
                           <button 
                             onClick={(e) => {
                               e.stopPropagation();
                               setExtraCashiers(prev => Math.max(prev - 1, 1));
                             }}
                             className="flex items-center justify-center w-6 h-6 rounded-full bg-slate-50 text-slate-400 hover:bg-red-50 hover:text-red-600 transition-all border border-slate-100"
                             title="Quitar Caja"
                           >
                             <Trash2 size={12} />
                           </button>
                           <button 
                             onClick={(e) => {
                               e.stopPropagation();
                               setExtraCashiers(prev => Math.min(prev + 1, 5));
                             }}
                             className="flex items-center justify-center w-6 h-6 rounded-full bg-indigo-50 text-indigo-600 hover:bg-indigo-600 hover:text-white transition-all shadow-sm"
                             title="Añadir otra Caja"
                           >
                             <PlusCircle size={14} />
                           </button>
                         </div>
                       )}
                     </h2>
                     <p className="text-[10px] font-bold text-slate-400 tracking-widest mt-1 uppercase italic">Despliegue Operativo</p>
                   </div>
                </div>
              </div>

              <div className="pb-4">
                <div className="grid grid-cols-[160px_repeat(7,1fr)] gap-2 w-full">
                  <div className="bg-transparent" />
                  {[0, 1, 2, 3, 4, 5, 6].map(offset => {
                    const day = addDays(getMonday(currentWeekStart), offset);
                    const isToday = isSameDay(day, new Date());
                    const isActive = isSameDay(day, activeDay);
                    
                    return (
                      <button 
                        key={offset} 
                        onClick={() => setActiveDay(day)}
                        className={`text-center p-3 rounded-3xl border transition-all duration-300 relative ${
                          isActive 
                            ? 'bg-indigo-600 text-white shadow-xl shadow-indigo-200 border-indigo-600 scale-105 z-10' 
                            : isToday 
                              ? 'bg-indigo-50 border-indigo-200 text-indigo-600' 
                              : 'bg-white border-slate-100 text-slate-400 hover:border-indigo-200'
                        }`}
                      >
                        <span className={`block text-[10px] font-black uppercase tracking-widest mb-1 ${isActive ? 'text-white/70' : 'opacity-70'}`}>
                          {format(day, 'EEE', { locale: es })}
                        </span>
                        <div className="text-2xl font-black italic">{format(day, 'dd')}</div>
                        {isActive && (
                          <motion.div 
                            layoutId="activeDayDot"
                            className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-1.5 h-1.5 bg-indigo-600 rounded-full border-2 border-white shadow-sm"
                          />
                        )}
                      </button>
                    );
                  })}

                  {section.stations.map((station) => (
                    <React.Fragment key={station}>
                      <div className="flex items-center px-6 bg-slate-50 border border-slate-100 rounded-2xl min-h-[70px]">
                        <span className="text-[12px] font-black text-slate-600 uppercase tracking-tight leading-tight">{station}</span>
                      </div>

                      {[0, 1, 2, 3, 4, 5, 6].map(offset => {
                        const day = addDays(getMonday(currentWeekStart), offset);
                        const dateStr = formatDateISO(day);
                        // Filter by station AND shift suffix
                        const shiftStation = `${station}_${activeShift}`;
                        const currentAssigned = assignments.find(a => a.assignment_date === dateStr && a.sub_position === shiftStation);
                        const emp = employees.find(e => String(e.id) === String(currentAssigned?.employee_id));
                        const isToday = isSameDay(day, new Date());
                        const isActive = isSameDay(day, activeDay);

                        // Check who is already assigned in THIS SHIFT to exclude them from the list
                        const assignedIdsInShift = new Set(
                          assignments
                            .filter(a => a.assignment_date === dateStr && a.sub_position.endsWith(`_${activeShift}`))
                            .map(a => String(a.employee_id))
                        );

                        return (
                          <div key={offset} className={`relative rounded-3xl border transition-all duration-300 group/slot shadow-sm ${
                            emp 
                              ? `bg-white border-slate-200 shadow-md shadow-slate-200/50 hover:border-indigo-400 ring-offset-2 ${isActive ? 'ring-2 ring-indigo-500/20 bg-indigo-50/5' : ''}` 
                              : `bg-white border-slate-200 hover:bg-slate-50 hover:border-indigo-300 border-dashed ${isActive ? 'bg-indigo-50/30 border-indigo-200' : ''}`
                          }`}>
                            <select 
                              value={currentAssigned?.employee_id || ''} 
                              onChange={(e) => updateAssignment(dateStr, station, e.target.value, section.id)} 
                              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-30"
                            >
                              <option value="">Vacante</option>
                              {employees.map(e => {
                                const isBusy = assignedIdsInShift.has(String(e.id));
                                const isCurrent = String(e.id) === String(currentAssigned?.employee_id);
                                
                                // Hide if busy elsewhere, but show if it's the current one
                                if (isBusy && !isCurrent) return null;

                                return (
                                  <option key={e.id} value={e.id}>
                                    {(e.chosen_name || e.first_name).toUpperCase()} {e.last_name?.toUpperCase()}
                                  </option>
                                );
                              })}
                            </select>

                            <div className="flex items-center gap-2 p-2 h-full">
                              <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-[12px] font-black transition-all ${emp ? `bg-slate-50 text-slate-900 border border-slate-100 shadow-inner` : `bg-white text-slate-300 border border-slate-100 ${isToday ? 'text-indigo-300 border-indigo-100' : ''}`}`}>
                                {emp ? (emp.chosen_name || emp.first_name)?.[0]?.toUpperCase() + (emp.last_name?.[0]?.toUpperCase() || '') : <Users size={16} className="opacity-40" />}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className={`text-[11px] font-extrabold truncate leading-tight ${emp ? 'text-slate-900' : 'text-slate-400 uppercase tracking-widest opacity-60'}`}>{emp ? (emp.chosen_name || emp.first_name).toUpperCase() : 'Libre'}</p>
                                {emp && <p className="text-[9px] font-bold text-slate-500 truncate leading-none mt-1">{emp.last_name}</p>}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </React.Fragment>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </main>

      <AnimatePresence>
        {showTemplateSave && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-8 bg-slate-900/40 backdrop-blur-sm">
            <motion.div initial={{ opacity: 0, scale: 0.9, y: 40 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9, y: 40 }} className="bg-white w-full max-w-lg rounded-[2.5rem] border border-black/5 p-10 shadow-2xl relative">
              <div className="flex items-center gap-5 mb-10">
                <div className="bg-indigo-50 text-indigo-600 p-4 rounded-3xl"><LayoutTemplate size={32} /></div>
                <div>
                  <h3 className="text-2xl font-bold text-slate-900 tracking-tight uppercase">Librería {activeShift}</h3>
                  <p className="text-xs font-medium text-slate-400 mt-1 uppercase tracking-widest">Plantillas para {activeShift === 'AM' ? 'Apertura' : 'Cierre'}</p>
                </div>
              </div>

              <div className="space-y-10">
                <div>
                  <label className="block text-[11px] font-black text-slate-400 uppercase tracking-widest mb-4">Guardar como Plantilla ({activeShift})</label>
                  <div className="flex gap-3">
                    <input type="text" placeholder="Nombre de plantilla..." value={newTemplateName} onChange={(e) => setNewTemplateName(e.target.value)} className="flex-1 bg-slate-50 border border-slate-200 rounded-2xl px-6 py-4 text-sm font-bold text-slate-900 focus:ring-2 focus:ring-indigo-500/20 transition-all outline-none" />
                    <button onClick={saveCurrentAsTemplate} className="bg-indigo-600 hover:bg-indigo-700 text-white p-4 rounded-2xl transition-all shadow-xl active:scale-90"><Save size={24} /></button>
                  </div>
                </div>

                <div className="space-y-4">
                  <label className="block text-[11px] font-black text-slate-400 uppercase tracking-widest mb-2">Plantillas Registradas</label>
                  <div className="space-y-3 max-h-[300px] overflow-y-auto pr-4 custom-scrollbar">
                    {templates.filter(t => t.template_name?.includes(`(${activeShift})`)).length === 0 ? (
                      <div className="text-center py-12 bg-slate-50 rounded-3xl border border-slate-200 border-dashed text-slate-400 italic text-sm">No hay plantillas guardadas para {activeShift}</div>
                    ) : templates.filter(t => t.template_name?.includes(`(${activeShift})`)).map(t => (
                      <div key={t.id} className="group flex items-center justify-between p-5 bg-white hover:bg-slate-50 rounded-3xl border border-slate-200 transition-all">
                        <div>
                          <span className="text-sm font-bold text-slate-700 group-hover:text-indigo-600 transition-colors uppercase">{t.template_name.replace(` (${activeShift})`, '')}</span>
                          <span className="block text-[10px] font-bold text-slate-300 uppercase tracking-widest mt-1">Lista para aplicar</span>
                        </div>
                        <div className="flex gap-2">
                          <button onClick={() => { applyTemplate(t.data); setShowTemplateSave(false); }} className="bg-slate-900 border border-slate-800 text-white p-3 rounded-xl transition-all hover:scale-110" title="Aplicar"><Zap size={18} fill="currentColor" /></button>
                          <button onClick={async () => { if (confirm('¿Eliminar?')) { await fetch(`/api/roles/templates?id=${t.id}`, { method: 'DELETE' }); fetchTemplates(); } }} className="bg-white border border-slate-200 text-slate-400 hover:text-red-600 p-3 rounded-xl transition-all"><Trash2 size={18} /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <button onClick={() => setShowTemplateSave(false)} className="w-full mt-10 py-5 rounded-3xl border border-slate-200 text-slate-400 font-bold text-sm tracking-widest hover:bg-slate-50 hover:text-slate-900 transition-all uppercase">Cerrar Panel</button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showVisualBoard && (
           <motion.div 
             initial={{ opacity: 0 }}
             animate={{ opacity: 1 }}
             exit={{ opacity: 0 }}
             className="fixed inset-0 z-[200] bg-white flex flex-col overflow-hidden"
           >
              {/* BOARD HEADER (CLEAN LIGHT) */}
              <div className="bg-zinc-50 border-b-2 border-black/5 px-10 py-3 flex items-center justify-between">
                <div className="flex items-center gap-6">
                  <div className="bg-black p-2 rounded-xl">
                    <LayoutTemplate className="text-white" size={20} />
                  </div>
                  <div>
                    <h1 className="text-xl font-black text-black tracking-widest uppercase italic">Tablero Operativo <span className="text-orange-500 not-italic ml-2">{activeShift}</span></h1>
                  </div>
                </div>

                <div className="flex items-center gap-4 bg-white p-1 rounded-full border-2 border-black/5 shadow-sm">
                  <div className="flex gap-1">
                    {['AM', 'PM'].map(sh => (
                      <button
                        key={sh}
                        onClick={() => setActiveShift(sh as any)}
                        className={`px-8 py-2 rounded-full text-[10px] font-black transition-all ${activeShift === sh ? 'bg-black text-white' : 'text-zinc-400'}`}
                      >
                        {sh === 'AM' ? 'APERTURA' : 'CIERRE'}
                      </button>
                    ))}
                  </div>
                  <div className="w-px h-6 bg-zinc-200 mx-1" />
                  <div className="flex items-center gap-4 px-4 text-black font-black uppercase text-xs tracking-tighter">
                    <button onClick={() => setActiveDay(subDays(activeDay, 1))} className="text-zinc-400 hover:text-black transition-colors"><ChevronLeft size={20} /></button>
                    <span className="min-w-[150px] text-center">{format(activeDay, 'EEEE dd', { locale: es })}</span>
                    <button onClick={() => setActiveDay(addDays(activeDay, 1))} className="text-zinc-400 hover:text-black transition-colors"><ChevronRight size={20} /></button>
                  </div>
                </div>

                <button 
                  onClick={() => setShowVisualBoard(false)}
                  className="bg-black text-white px-8 py-3 rounded-full font-black text-[10px] uppercase tracking-widest transition-all"
                >
                  Cerrar
                </button>
              </div>

              {/* THE MAP AREA (COMPACT MISSION CONTROL) */}
              <div className="flex-1 p-4 flex flex-col justify-between bg-zinc-50/50 overflow-hidden select-none relative">
                
                {/* --- DINING ZONE --- */}
                <div className="flex flex-col gap-1 relative z-10">
                  <div className="flex items-center justify-center gap-4 mb-1">
                    <h2 className="text-4xl font-black text-[#ff9166] uppercase tracking-[0.8em] italic leading-none drop-shadow-sm">Dining Area</h2>
                  </div>
                  
                  <div className="flex flex-col items-center gap-1">
                    <BoardSlot label="Limpieza" group="Salón" assignee={getAssignee(activeDay, `LIMPIEZA_${activeShift}`)} employees={employees} className="w-64 h-18" onClick={handleSlotClick} />
                    
                    <div className="w-full grid grid-cols-7 gap-1">
                      <BoardSlot label="Delivery" group="Salón" assignee={getAssignee(activeDay, `Uber + Salsas_${activeShift}`)} employees={employees} className="h-18" onClick={handleSlotClick} />
                      <BoardSlot label="Entrega" group="Salón" assignee={getAssignee(activeDay, `ENTREGA_${activeShift}`)} employees={employees} className="h-18" onClick={handleSlotClick} />
                      <BoardSlot label="Tacos" group="Salón" assignee={getAssignee(activeDay, `TACOS_${activeShift}`)} employees={employees} className="h-18" onClick={handleSlotClick} />
                      <BoardSlot label="Burritos" group="Salón" assignee={getAssignee(activeDay, `BURRITOS_${activeShift}`)} employees={employees} className="h-18" onClick={handleSlotClick} />
                      <BoardSlot label="Caja 3" group="Salón" assignee={getAssignee(activeDay, `Caja 3_${activeShift}`)} employees={employees} className="h-18" onClick={handleSlotClick} />
                      <BoardSlot label="Caja 2" group="Salón" assignee={getAssignee(activeDay, `Caja 2_${activeShift}`)} employees={employees} className="h-18" onClick={handleSlotClick} />
                      <BoardSlot label="Caja 1" group="Salón" assignee={getAssignee(activeDay, `Caja 1 / Salón_${activeShift}`)} employees={employees} className="h-18" onClick={handleSlotClick} />
                    </div>
                  </div>
                </div>

                {/* --- KITCHEN CORE --- */}
                <div className="flex flex-col items-center flex-1 justify-center py-2 relative z-10">
                  <div className="w-full flex flex-col items-center gap-1">
                    <div className="w-full grid grid-cols-4 gap-2">
                      <BoardSlot label="Carnes" group="Cocina" assignee={getAssignee(activeDay, `CARNES_${activeShift}`)} employees={employees} className="h-28" onClick={handleSlotClick} />
                      <BoardSlot label="Tortillas" group="Cocina" assignee={getAssignee(activeDay, `TORTILLAS_${activeShift}`)} employees={employees} className="h-28" onClick={handleSlotClick} />
                      <BoardSlot label="Tortas / Mulitas" group="Cocina" assignee={getAssignee(activeDay, `TORTAS/MULITAS_${activeShift}`)} employees={employees} className="h-28" onClick={handleSlotClick} />
                      <BoardSlot label="Tortas / Quesadillas" group="Cocina" assignee={getAssignee(activeDay, `TORTAS/QUESADILLAS_${activeShift}`)} employees={employees} className="h-28" onClick={handleSlotClick} />
                    </div>
                    <div className="w-full">
                      <BoardSlot label="Preparación" group="Cocina" assignee={getAssignee(activeDay, `PREPARACION_${activeShift}`)} employees={employees} className="h-16 w-full" onClick={handleSlotClick} />
                    </div>
                  </div>
                </div>

                {/* --- DRIVE-THRU ZONE --- */}
                <div className="flex flex-col gap-1 items-center relative z-10">
                  <div className="flex items-center justify-center gap-4 mb-1 w-full">
                    <h2 className="text-4xl font-black text-[#ff9166] uppercase tracking-[0.8em] italic leading-none drop-shadow-sm">Drive-Thru</h2>
                  </div>
                  
                  <div className="flex gap-2 w-full px-1 items-stretch">
                     {/* Ventana 1 */}
                     <BoardSlot label="Ventanilla 1" group="Drive-Thru" assignee={getAssignee(activeDay, `Ventana 1_${activeShift}`)} employees={employees} className="h-28 w-72" onClick={handleSlotClick} />

                     {/* Central DT Area */}
                     <div className="flex-1 flex flex-col gap-1">
                        <BoardSlot label="Tortas / Quesadillas (DT)" group="Drive-Thru" assignee={getAssignee(activeDay, `TORTAS/QUESADILLAS (DT)_${activeShift}`)} employees={employees} className="h-14 w-full" onClick={handleSlotClick} />
                        <div className="flex-1 grid grid-cols-2 gap-1">
                          <BoardSlot label="Tacos / Burritos (DT)" group="Drive-Thru" assignee={getAssignee(activeDay, `TACOS/BURRITOS (DT)_${activeShift}`)} employees={employees} className="h-14" onClick={handleSlotClick} />
                          <BoardSlot label="Ventanilla 2" group="Drive-Thru" assignee={getAssignee(activeDay, `Ventana 2_${activeShift}`)} employees={employees} className="h-14" onClick={handleSlotClick} />
                        </div>
                     </div>
                  </div>
                </div>

                {/* DIGITAL WATERMARK / CLOCK */}
                <div className="absolute bottom-4 right-6 flex items-end gap-3 opacity-30 pointer-events-none transform scale-75 origin-bottom-right">
                  <div className="text-right">
                    <p className="text-[8px] font-black uppercase tracking-[0.1em] text-zinc-400 font-mono">SYS STATUS: OK</p>
                  </div>
                  <div className="w-px h-6 bg-zinc-300" />
                  <div className="flex flex-col">
                    <span className="text-2xl font-black text-slate-800 tracking-tighter leading-none">
                      {format(new Date(), 'HH:mm')}
                    </span>
                  </div>
                </div>

              </div>
            </motion.div>
        )}
      </AnimatePresence>

      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar { height: 8px; width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #e2e8f0; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #cbd5e1; }
        select option { background-color: white; color: #1e293b; padding: 12px; font-weight: bold; }
      `}</style>
      {/* EMPLOYEE CONTACT & REASSIGNMENT MODAL */}
      <AnimatePresence>
        {selectedSlotForCard && (
          <div 
            onClick={() => setSelectedSlotForCard(null)}
            className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-md cursor-pointer"
          >
            <motion.div 
              onClick={(e) => e.stopPropagation()}
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white w-full max-w-md rounded-[3rem] shadow-2xl overflow-hidden relative cursor-default"
            >
              {/* Header with Station Info */}
              <div className="bg-indigo-600 p-8 text-white relative">
                <button 
                  onClick={() => setSelectedSlotForCard(null)}
                  className="absolute top-6 right-6 p-2 hover:bg-white/10 rounded-full transition-colors"
                >
                  <X size={24} />
                </button>
                <p className="text-[10px] font-black uppercase tracking-[0.3em] opacity-70 mb-1">GESTIÓN DE ESTACIÓN</p>
                <h3 className="text-3xl font-black uppercase tracking-tighter">{selectedSlotForCard.label}</h3>
              </div>

              <div className="p-8">
                {selectedEmployeeCard && !isReassigning ? (
                  /* --- VIEW 1: CONTACT CARD --- */
                  <div className="space-y-8">
                    <div className="flex items-center gap-6">
                      <div className="w-20 h-20 bg-indigo-50 rounded-3xl flex items-center justify-center text-3xl font-black text-indigo-600 border-2 border-indigo-100 italic">
                        {(selectedEmployeeCard.chosen_name || selectedEmployeeCard.first_name)?.[0]?.toUpperCase()}
                      </div>
                      <div>
                        <h4 className="text-2xl font-black text-slate-900 uppercase">
                          {selectedEmployeeCard.chosen_name || selectedEmployeeCard.first_name}
                        </h4>
                        <p className="text-sm font-bold text-slate-500 uppercase tracking-widest">
                          {selectedEmployeeCard.last_name}
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4">
                      {selectedEmployeeCard.phone && (
                        <a 
                          href={`tel:${selectedEmployeeCard.phone}`}
                          className="flex items-center gap-4 p-4 bg-slate-50 rounded-2xl border border-slate-100 hover:border-indigo-300 transition-all group"
                        >
                          <div className="p-3 bg-white rounded-xl shadow-sm text-indigo-600 group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                            <Phone size={20} />
                          </div>
                          <div className="flex flex-col">
                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Teléfono</span>
                            <span className="text-lg font-black text-slate-700">{selectedEmployeeCard.phone}</span>
                          </div>
                        </a>
                      )}
                      
                      {selectedEmployeeCard.email && (
                        <a 
                          href={`mailto:${selectedEmployeeCard.email}`}
                          className="flex items-center gap-4 p-4 bg-slate-50 rounded-2xl border border-slate-100 hover:border-indigo-300 transition-all group"
                        >
                          <div className="p-3 bg-white rounded-xl shadow-sm text-indigo-600 group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                            <Mail size={20} />
                          </div>
                          <div className="flex flex-col">
                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Email</span>
                            <span className="text-sm font-bold text-slate-700 truncate max-w-[200px]">{selectedEmployeeCard.email}</span>
                          </div>
                        </a>
                      )}
                    </div>

                    <div className="flex flex-col gap-3 pt-4 border-t border-slate-100">
                      <button 
                        onClick={() => {
                          updateAssignment(formatDateISO(activeDay), selectedSlotForCard.label, '', selectedSlotForCard.assignee.station_group);
                          setSelectedSlotForCard(null);
                        }}
                        className="w-full flex items-center justify-center gap-3 p-5 bg-red-50 text-red-600 rounded-2xl font-black uppercase tracking-widest text-[12px] hover:bg-red-600 hover:text-white transition-all border-2 border-red-100"
                      >
                        <UserMinus size={18} />
                        Marcar como Ausente
                      </button>
                      
                      <button 
                        onClick={() => setIsReassigning(true)}
                        className="w-full flex items-center justify-center gap-3 p-5 bg-indigo-50 text-indigo-600 rounded-2xl font-black uppercase tracking-widest text-[12px] hover:bg-indigo-600 hover:text-white transition-all border-2 border-indigo-100"
                      >
                        <RefreshCw size={18} />
                        Sustituir / Cambiar Persona
                      </button>
                    </div>
                  </div>
                ) : (
                  /* --- VIEW 2: REASSIGNMENT (OR INITIAL ASSIGN) --- */
                  <div className="space-y-6">
                    <div className="flex items-center justify-between mb-2">
                       <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest italic">Seleccionar Reemplazo</h4>
                       {selectedEmployeeCard && (
                         <button onClick={() => setIsReassigning(false)} className="text-[10px] font-bold text-indigo-600 hover:underline">Volver a ficha</button>
                       )}
                    </div>
                    
                    <div className="max-h-[400px] overflow-y-auto space-y-2 pr-2 custom-scrollbar">
                      <button 
                        onClick={() => {
                          updateAssignment(formatDateISO(activeDay), selectedSlotForCard.label, '', selectedSlotForCard.assignee.station_group);
                          setSelectedSlotForCard(null);
                        }}
                        className="w-full p-4 rounded-2xl border-2 border-dashed border-slate-200 text-slate-400 font-bold hover:bg-slate-50 transition-all text-left flex items-center gap-3"
                      >
                         <X size={18} />
                         <span>Dejar Vacante (Libre)</span>
                      </button>
                      
                      {employees.map(e => {
                        // Exclude people already working in THIS shift to prevent duplicates
                        const shiftSuffix = `_${activeShift}`;
                        const isBusy = assignments.some(a => 
                           a.assignment_date === formatDateISO(activeDay) && 
                           a.sub_position.endsWith(shiftSuffix) && 
                           String(a.employee_id) === String(e.id)
                        );
                        
                        if (isBusy && String(e.id) !== String(selectedEmployeeCard?.id)) return null;

                        return (
                          <button 
                            key={e.id}
                            onClick={() => {
                              updateAssignment(formatDateISO(activeDay), selectedSlotForCard.label, String(e.id), selectedSlotForCard.assignee.station_group);
                              setSelectedSlotForCard(null);
                            }}
                            className="w-full p-4 rounded-2xl bg-slate-50 border border-slate-100 hover:border-indigo-500 hover:bg-indigo-50 transition-all text-left flex items-center gap-4 group"
                          >
                             <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center font-black text-slate-400 group-hover:text-indigo-600 shadow-sm">
                               {(e.chosen_name || e.first_name)?.[0]}
                             </div>
                             <div>
                               <p className="text-sm font-black text-slate-900 leading-none">{(e.chosen_name || e.first_name).toUpperCase()}</p>
                               <p className="text-[10px] font-bold text-slate-500 uppercase mt-1">{e.last_name}</p>
                             </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

