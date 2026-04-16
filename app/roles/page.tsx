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
  Loader2
} from 'lucide-react';
import { format, startOfWeek, addDays, isSameDay, subDays } from 'date-fns';
import { es } from 'date-fns/locale';
import { getRoleWeight, getMonday, formatDateISO, formatStoreName } from '../planificador-v2/lib/utils';

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
  const [activeDay, setActiveDay] = useState(new Date());
  const [activeWeeklyShifts, setActiveWeeklyShifts] = useState<any[]>([]);
  
  // Derived GUID
  const selectedStoreGuid = useMemo(() => {
    return stores.find(s => String(s.id) === String(selectedStoreId))?.external_id || '';
  }, [stores, selectedStoreId]);
  
  // States for Templates
  const [templates, setTemplates] = useState<any[]>([]);
  const [newTemplateName, setNewTemplateName] = useState('');
  const [showTemplateSave, setShowTemplateSave] = useState(false);

  const SECTIONS = [
    { id: 'front', title: 'Front of House', icon: Monitor, color: 'blue', stations: ['Ventana 1', 'Ventana 2', 'Cajas + Salón', 'Uber + Salsas', 'Relieve'] },
    { id: 'kitchen', title: 'Back of House', icon: ChefHat, color: 'orange', stations: ['Planchas', 'Tacos/Parrilla', 'Corte/Prep', 'Burritos/Torta', 'Lava Platos'] }
  ];

  useEffect(() => {
    fetchStores();
  }, []);


  const fetchStores = async () => {
    const { data } = await supabase.from('stores').select('*').order('name');
    if (data) {
      setStores(data);
      // PRIORIDAD ABSOLUTA: ID 78 (Slauson Real)
      const officialStore = data.find(s => String(s.id) === '78');
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
    const index = newAssignments.findIndex(a => a.assignment_date === dateStr && a.sub_position === station);

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
        sub_position: station,
        station_group: group
      });
    }
    setAssignments(newAssignments);
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
    
    // Solo guardamos las asignaciones del DIA ACTIVO para plantillas
    const activeDateStr = format(activeDay, 'yyyy-MM-dd');
    const dayData = assignments
        .filter(a => a.assignment_date === activeDateStr)
        .map(({ store_id, assignment_date, id, ...rest }) => rest);

    const response = await fetch('/api/roles/templates', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        store_id: selectedStoreGuid, 
        template_name: newTemplateName,
        data: dayData 
      })
    });

    if (response.ok) {
      alert('💾 Plantilla Guardada');
      setNewTemplateName('');
      setShowTemplateSave(false);
      fetchTemplates();
    }
  };

  const applyTemplate = (templateData: any[]) => {
    const activeDateStr = format(activeDay, 'yyyy-MM-dd');
    const nonDayAssignments = assignments.filter(a => a.assignment_date !== activeDateStr);
    
    const newDayAssignments = templateData.map(a => ({
        ...a,
        store_id: selectedStoreGuid,
        assignment_date: activeDateStr
    }));

    setAssignments([...nonDayAssignments, ...newDayAssignments]);
    alert('✨ Plantilla Aplicada al día seleccionado');
  };

  const copyLastWeek = async () => {
    const startLast = format(subDays(currentWeekStart, 7), 'yyyy-MM-dd');
    const endLast = format(subDays(currentWeekStart, 1), 'yyyy-MM-dd');

    const resp = await fetch(`/api/roles?store_id=${selectedStoreGuid}&start_date=${startLast}&end_date=${endLast}`);
    const lastData = await resp.json();

    if (lastData && lastData.length > 0) {
      const newAssignments = lastData.map((a: any) => {
          const originalDate = new Date(a.assignment_date + 'T00:00:00');
          const newDate = addDays(originalDate, 7);
          return {
              ...a,
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
    <div className="min-h-screen bg-[#0f172a] flex flex-col items-center justify-center p-12">
      <div className="w-16 h-16 border-4 border-amber-500/20 border-t-amber-500 rounded-full animate-spin mb-8 shadow-[0_0_40px_rgba(245,158,11,0.2)]" />
      <h2 className="text-2xl font-black text-white tracking-[0.3em] animate-pulse">HUB SYNCING...</h2>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#0f172a] text-slate-200 font-sans selection:bg-amber-500/30">
      {/* --- MISSION CONTROL HUD --- */}
      <header className="sticky top-0 z-50 bg-[#0f172a]/80 backdrop-blur-2xl border-b border-slate-800/60 px-8 py-5 shadow-2xl">
        <div className="max-w-[1900px] mx-auto flex flex-wrap items-center justify-between gap-8">
          
          <div className="flex items-center gap-5">
            <div className="relative">
              <div className="absolute inset-0 bg-amber-500 blur-xl opacity-30 animate-pulse"></div>
              <div className="relative bg-gradient-to-br from-amber-400 to-amber-600 p-3 rounded-2xl shadow-2xl">
                <Zap className="text-white fill-white" size={28} />
              </div>
            </div>
            <div>
              <h1 className="text-2xl font-black tracking-tighter text-white flex items-center gap-3">
                COMMAND HUB <span className="text-amber-500 text-[10px] bg-amber-500/10 px-3 py-1 rounded-full border border-amber-500/20 tracking-[0.2em] font-black uppercase">Slauson 78</span>
              </h1>
              <p className="text-[10px] uppercase tracking-[0.4em] font-black text-slate-500">Fleet Deployment System</p>
            </div>
          </div>

          <div className="flex items-center gap-4 bg-slate-950/40 p-2 rounded-2xl border border-slate-800/80 shadow-inner">
            <div className="flex items-center gap-2 px-4 border-r border-slate-800/80">
              <Building2 size={16} className="text-slate-500" />
              <select
                value={selectedStoreId}
                onChange={(e) => setSelectedStoreId(e.target.value)}
                className="bg-transparent border-none text-[12px] font-black tracking-widest text-slate-400 focus:ring-0 cursor-pointer hover:text-white transition-colors"
              >
                {stores.map(s => (
                  <option key={s.id} value={s.id} className="bg-slate-900 text-white">
                    {formatStoreName(s.name).toUpperCase()}
                  </option>
                ))}
              </select>
            </div>
            
            <div className="flex items-center gap-3 px-2">
              <button 
                onClick={() => setCurrentWeekStart(subDays(currentWeekStart, 7))}
                className="p-2.5 hover:bg-slate-800 rounded-xl text-slate-500 hover:text-white transition-all active:scale-90"
              >
                <ChevronLeft size={20} />
              </button>
              
              <div className="text-center min-w-[200px]">
                <span className="text-[14px] font-black text-white tracking-tight">
                  {format(getMonday(currentWeekStart), 'MMM dd', { locale: es })} - {format(addDays(getMonday(currentWeekStart), 6), 'MMM dd', { locale: es })}
                </span>
                <span className="block text-[9px] font-black text-amber-500/60 uppercase tracking-[0.3em] mt-0.5">Tactical Window</span>
              </div>

              <button 
                onClick={() => setCurrentWeekStart(addDays(currentWeekStart, 7))}
                className="p-2.5 hover:bg-slate-800 rounded-xl text-slate-500 hover:text-white transition-all active:scale-90"
              >
                <ChevronRight size={20} />
              </button>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <button 
              onClick={copyLastWeek}
              className="group flex items-center gap-2 bg-slate-800/30 hover:bg-slate-800 text-slate-400 px-5 py-3 rounded-2xl border border-slate-800 font-black text-[11px] tracking-widest transition-all hover:text-white"
            >
              <Copy size={16} className="group-hover:rotate-12 transition-transform" />
              CLONE LAST WEEK
            </button>
            
            <button 
              onClick={() => setShowTemplateSave(true)}
              className="group flex items-center gap-2 bg-slate-800/30 hover:bg-slate-800 text-slate-400 px-5 py-3 rounded-2xl border border-slate-800 font-black text-[11px] tracking-widest transition-all hover:text-white"
            >
              <LayoutTemplate size={16} className="group-hover:rotate-12 transition-transform" />
              LIBRARY
            </button>

            <button 
              onClick={saveAssignments}
              disabled={saving}
              className={`flex items-center gap-3 px-8 py-3 rounded-2xl font-black text-[11px] tracking-[0.2em] shadow-2xl transition-all active:scale-95 ${
                saving 
                ? 'bg-slate-800 text-slate-600 cursor-not-allowed border border-slate-700' 
                : 'bg-gradient-to-r from-amber-500 to-orange-600 text-white hover:shadow-[0_0_40px_rgba(245,158,11,0.4)] hover:scale-105 border border-amber-400/20'
              }`}
            >
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
              {saving ? 'UPLOADING...' : 'DEPLOY ROTATION'}
            </button>
          </div>
        </div>
      </header>

      <main className="p-8 max-w-[1900px] mx-auto space-y-12">
        
        {/* --- TACTICAL MATRIX --- */}
        <div className="grid grid-cols-1 gap-16">
          {SECTIONS.map((section, sIdx) => (
            <div key={section.id} className="relative group/section">
              
              <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-5">
                   <div className={`p-4 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl group-hover/section:border-${section.color === 'blue' ? 'blue' : 'orange'}-500/50 transition-colors`}>
                      <section.icon size={24} className={`text-${section.color === 'blue' ? 'blue' : 'orange'}-500`} />
                   </div>
                   <div>
                     <h2 className="text-2xl font-black text-white tracking-widest uppercase">{section.title}</h2>
                     <p className="text-[10px] font-bold text-slate-500 tracking-[0.3em] mt-1 uppercase">Operational Area Deployment</p>
                   </div>
                </div>
                <div className="flex-1 h-[1px] bg-gradient-to-r from-slate-800 via-slate-800 to-transparent ml-12" />
              </div>

              <div className="overflow-x-auto pb-8 custom-scrollbar rounded-3xl">
                <div className="inline-grid grid-cols-[240px_repeat(7,200px)] gap-4 min-w-full">
                  
                  {/* Matrix Header: Tactical Timeline */}
                  <div className="bg-transparent" />
                  {[0, 1, 2, 3, 4, 5, 6].map(offset => {
                    const day = addDays(getMonday(currentWeekStart), offset);
                    const isToday = isSameDay(day, new Date());
                    return (
                      <div 
                        key={offset} 
                        className={`text-center p-4 rounded-3xl border transition-all duration-500 ${
                          isToday 
                          ? 'bg-amber-500/10 border-amber-500/40 shadow-[0_0_30px_rgba(245,158,11,0.1)]' 
                          : 'bg-slate-900/40 border-slate-800/80'
                        }`}
                      >
                        <span className="block text-[11px] font-black text-slate-500 uppercase tracking-[0.3em] mb-2">
                          {format(day, 'EEEE', { locale: es })}
                        </span>
                        <div className={`text-2xl font-black ${isToday ? 'text-amber-500' : 'text-white'}`}>
                          {format(day, 'dd')}
                        </div>
                      </div>
                    );
                  })}

                  {/* Matrix Rows: Operational Units */}
                  {section.stations.map((station) => (
                    <React.Fragment key={station}>
                      
                      {/* Unit Title */}
                      <div className="flex items-center px-6 bg-slate-900/60 border border-slate-800/80 rounded-3xl shadow-inner min-h-[80px]">
                        <div className="flex flex-col">
                          <span className="text-[13px] font-black text-white uppercase tracking-tight leading-tight">
                            {station}
                          </span>
                          <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mt-1">Ready for deploy</span>
                        </div>
                      </div>

                      {/* Tactical Deployment Slots */}
                      {[0, 1, 2, 3, 4, 5, 6].map(offset => {
                        const day = addDays(getMonday(currentWeekStart), offset);
                        const dateStr = formatDateISO(day);
                        const currentAssigned = assignments.find(a => a.assignment_date === dateStr && a.sub_position === station);
                        const emp = employees.find(e => String(e.id) === String(currentAssigned?.employee_id));

                        return (
                          <div 
                            key={offset} 
                            className={`relative rounded-3xl border-2 p-1 transition-all duration-500 group/slot ${
                              emp 
                              ? `bg-slate-800/40 border-${section.color === 'blue' ? 'blue' : 'orange'}-500/30 shadow-2xl` 
                              : 'bg-slate-950/20 border-slate-800/50 hover:bg-slate-900/40 hover:border-slate-700/80 border-dashed'
                            }`}
                          >
                            <select
                              value={currentAssigned?.employee_id || ''}
                              onChange={(e) => updateAssignment(dateStr, station, e.target.value, section.id)}
                              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-30"
                            >
                              <option value="" className="bg-slate-900">EMPTY UNIT</option>
                              {employees.map(e => (
                                <option key={e.id} value={e.id} className="bg-slate-900 text-white">
                                  {(e.chosen_name || e.first_name).toUpperCase()} {e.last_name?.toUpperCase()}
                                </option>
                              ))}
                            </select>

                            <div className="flex items-center gap-3 p-3 h-full">
                              <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-sm font-black shadow-2xl transition-all duration-500 group-hover/slot:scale-110 ${
                                emp 
                                ? `bg-gradient-to-br from-slate-700 to-slate-900 text-${section.color === 'blue' ? 'blue' : 'orange'}-400 border border-white/5`
                                : 'bg-slate-900/50 text-slate-700 border border-slate-800/50'
                              }`}>
                                {emp ? (emp.chosen_name || emp.first_name)?.[0]?.toUpperCase() + (emp.last_name?.[0]?.toUpperCase() || '') : <Users size={18} className="opacity-30" />}
                              </div>
                              <div className="flex-1 min-w-0 pr-4">
                                <p className={`text-[12px] font-black truncate leading-tight tracking-tight ${emp ? 'text-white' : 'text-slate-600 uppercase tracking-widest'}`}>
                                  {emp ? (emp.chosen_name || emp.first_name).toUpperCase() : 'Empty'}
                                </p>
                                {emp && (
                                  <p className="text-[10px] font-bold text-slate-500 truncate leading-none mt-1 uppercase opacity-60">
                                    {emp.last_name}
                                  </p>
                                )}
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

      {/* --- BLUEPRINT MODAL --- */}
      <AnimatePresence>
        {showTemplateSave && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-8 bg-slate-950/95 backdrop-blur-xl">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 40 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 40 }}
              className="bg-slate-900 w-full max-w-lg rounded-[2.5rem] border border-slate-800 p-10 shadow-[0_0_100px_rgba(0,0,0,1)] relative overflow-hidden"
            >
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-amber-500 to-orange-600" />
              
              <div className="flex items-center gap-5 mb-10">
                <div className="bg-amber-500/10 text-amber-500 p-4 rounded-3xl border border-amber-500/20">
                  <LayoutTemplate size={32} />
                </div>
                <div>
                  <h3 className="text-2xl font-black text-white tracking-widest uppercase">Rotation Library</h3>
                  <p className="text-[10px] font-black text-slate-500 tracking-[0.3em] mt-1 uppercase">Save & Deploy Tactical Blueprints</p>
                </div>
              </div>

              <div className="space-y-10">
                <div>
                  <label className="block text-[11px] font-black text-amber-500 uppercase tracking-[0.3em] mb-4">Save Daily Context</label>
                  <div className="flex gap-3">
                    <input 
                      type="text"
                      placeholder="e.g. MON - PEAK SEASON"
                      value={newTemplateName}
                      onChange={(e) => setNewTemplateName(e.target.value)}
                      className="flex-1 bg-slate-950/80 border border-slate-800 rounded-2xl px-6 py-4 text-sm font-bold text-white focus:ring-2 focus:ring-amber-500 transition-all outline-none shadow-inner"
                    />
                    <button 
                      onClick={saveCurrentAsTemplate}
                      className="bg-amber-500 hover:bg-amber-600 text-white p-4 rounded-2xl transition-all shadow-2xl active:scale-90"
                    >
                      <Save size={24} />
                    </button>
                  </div>
                </div>

                <div className="space-y-4">
                  <label className="block text-[11px] font-black text-slate-500 uppercase tracking-[0.3em] mb-2">Stored Blueprints</label>
                  <div className="space-y-3 max-h-[280px] overflow-y-auto pr-4 custom-scrollbar">
                    {templates.length === 0 ? (
                      <div className="text-center py-12 bg-slate-950/40 rounded-3xl border border-slate-800 border-dashed text-slate-600 italic text-sm font-bold">No stored rotation archives found</div>
                    ) : templates.map(t => (
                      <div key={t.id} className="group flex items-center justify-between p-5 bg-slate-950/60 hover:bg-slate-950 rounded-3xl border border-slate-800 hover:border-amber-500/40 transition-all">
                        <div>
                          <span className="text-sm font-black text-white tracking-wide uppercase transition-colors group-hover:text-amber-500">{t.template_name}</span>
                          <span className="block text-[9px] font-bold text-slate-600 uppercase tracking-widest mt-1">Ready for deployment</span>
                        </div>
                        <div className="flex gap-2">
                          <button 
                            onClick={() => {
                              applyTemplate(t.data);
                              setShowTemplateSave(false);
                            }}
                            className="bg-slate-900 hover:bg-amber-500 text-slate-600 hover:text-white p-3 rounded-xl transition-all shadow-xl active:scale-90"
                            title="Deploy Selected"
                          >
                            <Zap size={18} fill="currentColor" />
                          </button>
                          <button 
                            onClick={async () => {
                              if (confirm('Erase this tactical blueprint?')) {
                                await fetch(`/api/roles/templates?id=${t.id}`, { method: 'DELETE' });
                                fetchTemplates();
                              }
                            }}
                            className="bg-slate-900 hover:bg-red-500 text-slate-600 hover:text-white p-3 rounded-xl transition-all shadow-xl active:scale-90"
                          >
                            <Trash2 size={18} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <button 
                onClick={() => setShowTemplateSave(false)}
                className="w-full mt-10 py-5 rounded-3xl border border-slate-800 text-slate-500 font-black text-[12px] tracking-[0.3em] hover:bg-slate-800 hover:text-white transition-all shadow-2xl uppercase"
              >
                Exit Console
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar { height: 10px; width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: #020617; border-radius: 100px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #1e293b; border-radius: 100px; border: 2px solid #020617; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #334155; }
        select option { background-color: #0f172a; color: white; padding: 12px; font-weight: 800; font-size: 14px; }
        
        @keyframes fade-in { 
          from { opacity: 0; transform: translateY(20px); } 
          to { opacity: 1; transform: translateY(0); } 
        }
        .animate-in { animation: fade-in 0.8s cubic-bezier(0.16, 1, 0.3, 1); }
      `}</style>
    </div>
  );
}

