'use client';

/**
 * @module MissionControlRoles
 * @description Centro de control táctico para la asignación de roles y tareas en las estaciones de trabajo de las sucursales de Tacos El Gavilan (TEG). Permite gestionar la alineación diaria de empleados en sus respectivas estaciones y turnos.
 * @businessRules
 * - El día laboral empieza a las 6:00 AM y termina a las 5:59 AM del siguiente día.
 * - El turno PM inicia a las 5:00 PM.
 * - Asignaciones basadas en la programación de Toast, con opción de auto-llenado manual.
 * - Soporte bilingüe completo para todas las etiquetas y mensajes mostrados al usuario.
 * @dataFlow
 * - Carga información de tiendas, asignaciones y actividades desde Supabase (`stores`, `assignments`, `position_activities`, etc.).
 * - Actualiza estados localmente y persiste en Supabase al guardar.
 * @notes
 * - Corregido error de anidación de JSX / AnimatePresence en modal de asignación de tareas.
 * - Adaptado para usar el hook useLanguage() en todas las traducciones.
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useLanguage } from '@/lib/i18n';
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
  X,
  ClipboardList,
  Printer,
  AlertTriangle,
  ChevronUp,
  ChevronDown,
  Search,
  User,
  Plus
} from 'lucide-react';
import { format, startOfWeek, addDays, isSameDay, subDays } from 'date-fns';
import { es } from 'date-fns/locale';
import { getRoleWeight, getMonday, formatDateISO, formatStoreName } from '../planificador/lib/utils';

// SUB-COMPONENTE PARA EL TABLERO VISUAL
const BoardSlot = ({ label, stationKey, group, assignee, employees, className = "", onClick }: any) => {
  const emp = assignee ? employees.find((e: any) => String(e.id) === String(assignee.employee_id)) : null;
  
  const sUpper = stationKey?.toUpperCase();
  const isGreenGroup = sUpper === 'ENTREGA' || sUpper === 'TORTILLAS';
  const isYellowGroup = sUpper === 'CAJA 2' || sUpper === 'VENTANA 2' || sUpper === 'VENTANILLA 2' || sUpper === 'VENTANA 2 (B)';

  return (
    <div 
      onClick={() => onClick(stationKey, label, group, emp, assignee)}
      className={`p-1.5 flex flex-col h-full cursor-pointer group active:scale-95 transition-all ${className}`}
    >
      <div className={`w-full h-full p-2.5 rounded-[1.5rem] transition-all duration-300 overflow-hidden relative flex flex-col items-center justify-center border-4 ${
        emp 
        ? isGreenGroup ? 'bg-emerald-400 border-emerald-600 shadow-xl' : isYellowGroup ? 'bg-yellow-400 border-yellow-600 shadow-xl' : 'bg-white border-slate-200 shadow-xl group-hover:shadow-2xl group-hover:border-slate-300' 
        : isGreenGroup ? 'bg-emerald-100 border-emerald-400 shadow-md' : isYellowGroup ? 'bg-yellow-100 border-yellow-400 shadow-md' : 'bg-slate-50 border-dashed border-slate-300 shadow-md group-hover:shadow-lg group-hover:border-slate-400'
      }`}>
        <span className={`text-[24px] font-black uppercase tracking-widest mb-1.5 text-center transition-colors ${
          isGreenGroup || isYellowGroup ? 'text-black' : (emp ? 'text-[#ff9166]' : 'text-amber-800')
        }`}>
          {label}
        </span>
        <span className={`text-[32px] font-black uppercase tracking-tighter leading-none text-center transition-all ${
          isGreenGroup || isYellowGroup ? 'text-black' : (emp ? 'text-slate-900 font-black' : 'text-amber-400 drop-shadow-sm font-bold')
        }`}>
          {emp ? (emp.chosen_name || emp.first_name) : 'Libre'}
        </span>
        {emp && (
          <p className={`text-xs font-black mt-1.5 uppercase tracking-widest truncate w-full text-center ${isGreenGroup || isYellowGroup ? 'text-black/60' : 'text-slate-500'}`}>
            {emp.last_name}
          </p>
        )}
      </div>
    </div>
  );
};

// Helper to translate employee job + station group to standard roles
const resolvePositionKey = (jobTitle: string, stationName?: string, stationGroup?: string): string => {
  const title = (jobTitle || '').toLowerCase();
  
  if (title.includes('manager') && !title.includes('asst') && !title.includes('assist') && !title.includes('asistente') && !title.includes('shift')) {
    return 'MANAGER';
  }
  
  if (title.includes('asst') || title.includes('assist') || title.includes('asistente')) {
    return 'ASSISTANT';
  }
  
  if (title.includes('shift') || title.includes('leader') || title.includes('encargado')) {
    const group = (stationGroup || '').toLowerCase();
    const station = (stationName || '').toLowerCase();
    const isKitchen = group === 'kitchen' || ['burritos', 'tortillas', 'tacos', 'carnes', 'preparacion', 'cubrir descansos (cocina)'].some(s => station.includes(s));
    return isKitchen ? 'SHIFT_LEADER_MALE' : 'SHIFT_LEADER_FEMALE';
  }
  
  if (title.includes('cook') || title.includes('cocinero') || title.includes('prep') || title.includes('preparador') || title.includes('taquero') || title.includes('tortill')) {
    return 'COOK_MALE';
  }
  
  if (title.includes('cashier') || title.includes('cajera') || title.includes('cajero')) {
    return 'CASHIER';
  }
  
  const group = (stationGroup || '').toLowerCase();
  if (group === 'kitchen') {
    return 'COOK_MALE';
  }
  return 'CASHIER';
};

const STATION_BACKUPS: Record<string, string[]> = {
  // Kitchen
  'BURRITOS': ['TACOS', 'CARNES', 'TORTAS/QUESADILLAS', 'PREPARACION'],
  'TORTILLAS': ['TACOS', 'CARNES', 'BURRITOS', 'PREPARACION'],
  'TORTAS/QUESADILLAS': ['TORTAS/MULITAS', 'TACOS', 'CARNES'],
  'TORTAS/MULITAS': ['TORTAS/QUESADILLAS', 'TACOS', 'CARNES'],
  'TACOS': ['CARNES', 'BURRITOS', 'TORTAS/QUESADILLAS', 'PREPARACION'],
  'CARNES': ['TACOS', 'BURRITOS', 'TORTAS/QUESADILLAS', 'PREPARACION'],
  'PREPARACION': ['CARNES', 'TACOS', 'BURRITOS'],
  'CUBRIR DESCANSOS (COCINA)': ['TACOS', 'CARNES'],

  // Drive-Thru support
  'TORTAS/QUESADILLAS (DT)': ['TORTAS/QUESADILLAS', 'TACOS/BURRITOS (DT)'],
  'TACOS/BURRITOS (DT)': ['TACOS', 'BURRITOS', 'TORTAS/QUESADILLAS (DT)'],
  'CUBRIR DESCANSOS (DT)': ['CUBRIR DESCANSOS (COCINA)', 'CUBRIR DESCANSOS (SALÓN)'],

  // Front / Salon
  'Ventana 1': ['Ventana 2', 'Ventana 2 (B)', 'Caja 1 / Salón', 'ENTREGA'],
  'Ventana 2': ['Ventana 1', 'Ventana 2 (B)', 'Caja 1 / Salón', 'ENTREGA'],
  'Ventana 2 (B)': ['Ventana 2', 'Ventana 1', 'Caja 1 / Salón', 'ENTREGA'],
  'Caja 1 / Salón': ['Caja 2', 'Caja 3', 'Ventana 1', 'Uber + Salsas'],
  'Caja 2': ['Caja 1 / Salón', 'Caja 3', 'Uber + Salsas'],
  'Caja 3': ['Caja 2', 'Caja 1 / Salón', 'Uber + Salsas'],
  'Caja 4': ['Caja 3', 'Caja 2', 'Caja 1 / Salón'],
  'Caja 5': ['Caja 4', 'Caja 3', 'Caja 2'],
  'Uber + Salsas': ['Caja 1 / Salón', 'Caja 2', 'ENTREGA'],
  'ENTREGA': ['Uber + Salsas', 'Caja 1 / Salón', 'Ventana 1'],
  'LIMPIEZA': ['Caja 1 / Salón', 'Caja 2', 'Uber + Salsas'],
  'CUBRIR DESCANSOS (SALÓN)': ['Caja 1 / Salón', 'Ventana 1']
};

const getShiftFromTime = (startTimeStr: string): 'AM' | 'PM' => {
  if (!startTimeStr) return 'AM';
  try {
    if (startTimeStr.includes(':') && !startTimeStr.includes('T')) {
      const hour = parseInt(startTimeStr.split(':')[0], 10);
      return (hour >= 17 || hour < 6) ? 'PM' : 'AM';
    }
    const date = new Date(startTimeStr);
    const hour = date.getHours();
    return (hour >= 17 || hour < 6) ? 'PM' : 'AM';
  } catch (e) {
    return 'AM';
  }
};

export default function MissionControlRoles() {
  const supabase = createClient();
  const { t } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [stores, setStores] = useState<any[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState<string>('');
  const [showPositionConfigModal, setShowPositionConfigModal] = useState(false);
  const [selectedConfigPositionKey, setSelectedConfigPositionKey] = useState<string>('COOK_MALE');
  const [configShift, setConfigShift] = useState<string>('TODOS');
  const [configStoreModel, setConfigStoreModel] = useState<string>('TODOS');
  const [configFrequency, setConfigFrequency] = useState<string>('TODAS');
  const [taskSearchQuery, setTaskSearchQuery] = useState('');
  const [currentWeekStart, setCurrentWeekStart] = useState(startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [assignments, setAssignments] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [jobs, setJobs] = useState<any[]>([]);
  const [activeShift, setActiveShift] = useState<'AM' | 'PM'>(() => {
    const laTime = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
    const hour = laTime.getHours();
    const minute = laTime.getMinutes();
    const isPMShift = (hour > 16 || (hour === 16 && minute >= 50)) || (hour < 6);
    return isPMShift ? 'PM' : 'AM';
  });
  const [activeDay, setActiveDay] = useState<Date>(() => {
    const laTime = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
    if (laTime.getHours() < 6) {
      laTime.setDate(laTime.getDate() - 1);
    }
    return new Date(laTime.getFullYear(), laTime.getMonth(), laTime.getDate());
  });
  const [hasDriveThru, setHasDriveThru] = useState(true);
  const [extraCashiers, setExtraCashiers] = useState(1);
  const [activeWeeklyShifts, setActiveWeeklyShifts] = useState<any[]>([]);
  const [showVisualBoard, setShowVisualBoard] = useState(false);
  const [showActivitiesModal, setShowActivitiesModal] = useState(false);
  const [activitySearchQuery, setActivitySearchQuery] = useState('');
  const [showStationActivitiesModal, setShowStationActivitiesModal] = useState<string | null>(null);
  const [activities, setActivities] = useState<any[]>([]);
  const [positionActivities, setPositionActivities] = useState<any[]>([]);
  const [stationActivities, setStationActivities] = useState<Record<string, string[]>>({});
  const [newActivity, setNewActivity] = useState({ name: '', category: 'APERTURA', startTime: '', endTime: '', shift: 'AM' });
  const [editingActivityId, setEditingActivityId] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [duplicateWarning, setDuplicateWarning] = useState<{ newName: string, existing: any } | null>(null);
  const [assignmentDay, setAssignmentDay] = useState<string[]>(['DIARIO']);
  
  const [showSpecificTasksModal, setShowSpecificTasksModal] = useState(false);
  const [showUnassignedActivitiesModal, setShowUnassignedActivitiesModal] = useState(false);
  const [specificTasksEmployeeId, setSpecificTasksEmployeeId] = useState<string | null>(null);
  const [specificTasksSearch, setSpecificTasksSearch] = useState('');
  const [taskSelectorForAssign, setTaskSelectorForAssign] = useState<any | null>(null);
  const [extraTaskSearchQuery, setExtraTaskSearchQuery] = useState('');

  const saveMappingsTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pendingMappingsRef = useRef<Record<string, string[]> | null>(null);

  const [selectedEmployeeCard, setSelectedEmployeeCard] = useState<any>(null);
  const [selectedSlotForCard, setSelectedSlotForCard] = useState<{label: string, assignee: any, stationKey?: string} | null>(null);
  const [isReassigning, setIsReassigning] = useState(false);
  
  const selectedStoreGuid = useMemo(() => {
    return stores.find(s => String(s.id) === String(selectedStoreId))?.external_id || '';
  }, [stores, selectedStoreId]);
  
  const [templates, setTemplates] = useState<any[]>([]);
  const [newTemplateName, setNewTemplateName] = useState('');
  const [showTemplateSave, setShowTemplateSave] = useState(false);
  const [viewMode, setViewMode] = useState<'daily' | 'weekly'>('daily');
  const [rosterSearch, setRosterSearch] = useState('');

  const formatTime12h = (timeStr: string): string => {
    if (!timeStr) return '';
    if (timeStr.includes('-')) {
      return timeStr.split('-').map(t => formatTime12h(t.trim())).join(' - ');
    }
    const [hours, minutes] = timeStr.split(':');
    if (!hours || !minutes) return timeStr;
    let h = parseInt(hours);
    const m = minutes.substring(0, 2);
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12;
    h = h ? h : 12;
    return `${String(h).padStart(2, '0')}:${m} ${ampm}`;
  };

  const getFrequencyLabel = (freq: string) => {
    if (!freq) return t('roles_hub.daily') || 'Diario';
    const freqLower = freq.toLowerCase();
    if (freqLower === 'diario') return t('roles_hub.daily') || 'Diario';
    
    const daysKeys = [
      'sales.reports_page.days.monday',
      'sales.reports_page.days.tuesday',
      'sales.reports_page.days.wednesday',
      'sales.reports_page.days.thursday',
      'sales.reports_page.days.friday',
      'sales.reports_page.days.saturday',
      'sales.reports_page.days.sunday'
    ];

    if (/^[0-6]$/.test(freq)) {
      const idx = parseInt(freq, 10);
      return t(daysKeys[idx]) || ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'SΓö£íbado', 'Domingo'][idx];
    }

    return freq;
  };

  const SECTIONS = useMemo(() => {
    const baseCajeras = ['Ventana 1', 'Ventana 2', 'Ventana 2 (B)', 'Caja 1 / Salón'];
    const extrasCajeras = ['Caja 2', 'Caja 3', 'Caja 4', 'Caja 5'];
    
    const visibleExtras = extrasCajeras.filter((name, idx) => {
      const hasData = assignments.some(a => a.sub_position.startsWith(name));
      return hasData || (idx + 2 <= extraCashiers);
    });

    const finalCajeras = [...baseCajeras, ...visibleExtras, 'Uber + Salsas', 'ENTREGA', 'LIMPIEZA'].filter(s => {
      if (!hasDriveThru && (s === 'Ventana 1' || s === 'Ventana 2' || s === 'Ventana 2 (B)')) return false;
      return true;
    });

    return [
      { 
        id: 'front', 
        title: 'SALÓN / SERVICIO', 
        icon: Monitor, 
        color: 'blue', 
        stations: [...finalCajeras, 'CUBRIR DESCANSOS (SALÓN)']
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
          'PREPARACION',
          'CUBRIR DESCANSOS (COCINA)'
        ] 
      },
      {
        id: 'drive-thru',
        title: 'APOYO DRIVE-THRU',
        icon: Zap,
        color: 'indigo',
        stations: [
          'TORTAS/QUESADILLAS (DT)',
          'TACOS/BURRITOS (DT)',
          'CUBRIR DESCANSOS (DT)'
        ]
      }
    ];
  }, [hasDriveThru, extraCashiers, assignments]);

  const sectionIdForStation = (stationName: string): string => {
    for (const sec of SECTIONS) {
      if (sec.stations.includes(stationName)) return sec.id;
    }
    return 'front';
  };

  // Core Activity Resolution logic (un-memoized helper for precomputation and dynamic fallbacks)
  const resolveActivitiesInner = (assignee: any, dateStr: string, ignoreAbsence: boolean) => {
    if (!assignee) return [];
    
    const isShiftPM = assignee.sub_position?.includes('_PM');
    const shift = isShiftPM ? 'PM' : 'AM';
    const storeModel = hasDriveThru ? 'DRIVE_THRU' : 'REGULAR';
    
    // Day index computation
    const dateObj = new Date(dateStr + 'T12:00:00');
    const jsDay = dateObj.getDay();
    const dayIndex = jsDay === 0 ? '6' : String(jsDay - 1);
    
    const dayShiftAssignments = assignments.filter(a => a.assignment_date === dateStr && a.sub_position?.endsWith(`_${shift}`));

    // Immediate absence check: if employee is marked absent or not scheduled on this day/shift, they resolve no activities
    if (assignee.employee_id && !ignoreAbsence) {
      const hasShift = activeWeeklyShifts.some(s =>
        s.shift_date === dateStr &&
        String(s.employee_id) === String(assignee.employee_id) &&
        getShiftFromTime(s.start_time) === shift
      );
      const isAbsent = activeWeeklyShifts.some(s =>
        s.shift_date === dateStr &&
        String(s.employee_id) === String(assignee.employee_id) &&
        getShiftFromTime(s.start_time) === shift &&
        s.is_callback === true
      );
      if (isAbsent || !hasShift) return [];
    }

    // Helper to match frequency strings (like 'Diario', 'Domingo', 'Jueves y Domingo', '6')
    const isFreqMatch = (paFrequency: string, dayIdx: string): boolean => {
      if (!paFrequency) return false;
      const freqLower = paFrequency.toLowerCase();
      if (freqLower === 'diario') return true;
      if (paFrequency === dayIdx) return true;
      
      const dayNamesMap: Record<string, string[]> = {
        '0': ['lunes'],
        '1': ['martes'],
        '2': ['miercoles', 'miércoles'],
        '3': ['jueves'],
        '4': ['viernes'],
        '5': ['sabado', 'sábado'],
        '6': ['domingo']
      };
      
      const names = dayNamesMap[dayIdx];
      if (!names) return false;
      
      return names.some(n => freqLower.includes(n));
    };

    // 1. Resolve employee job role if assigned
    const emp = assignee.employee_id ? employees.find(e => String(e.id) === String(assignee.employee_id)) : null;
    const roleKey = emp ? resolvePositionKey(emp.job_references?.[0]?.title || '', assignee.main_station, assignee.station_group) : null;
    
    const isLeadership = roleKey && ['MANAGER', 'ASSISTANT', 'SHIFT_LEADER_MALE', 'SHIFT_LEADER_FEMALE'].includes(roleKey);

    // If manual tasks are set, use them
    if (assignee.tasks && assignee.tasks.length > 0) {
      const resolved = assignee.tasks.map((taskName: string) => {
        const matchedAct = activities.find(act => act.name === taskName);
        return {
          id: matchedAct?.id || taskName,
          position_key: assignee.main_station,
          shift,
          frequency: 'Diario',
          store_model: storeModel,
          operating_procedures: matchedAct ? {
            id: matchedAct.id,
            activity: matchedAct.name,
            start_time: matchedAct.startTime,
            duration_minutes: matchedAct._duration,
            shift_type: matchedAct.category,
            frequency: matchedAct._frequency || 'Diario',
            role: matchedAct._role || 'ROLES_MODULE',
            description: matchedAct._description || ''
          } : {
            id: taskName,
            activity: taskName,
            start_time: '',
            duration_minutes: 0,
            shift_type: 'OTRO',
            frequency: 'Diario',
            role: 'ROLES_MODULE',
            description: ''
          },
          sort_order: matchedAct?.startTime 
            ? parseInt(matchedAct.startTime.split(':')[0]) * 60 + parseInt(matchedAct.startTime.split(':')[1])
            : 9999
        };
      });
      resolved.sort((a: any, b: any) => a.sort_order - b.sort_order);
      return resolved;
    }

    // Otherwise, resolve dynamically
    const activeMappings = positionActivities.filter((item: any) => {
      const matchPos = (item.position_key === assignee.main_station) || (isLeadership && item.position_key === roleKey);
      if (!matchPos) return false;

      const matchShift = item.shift === 'AMBOS' || item.shift === shift;
      const matchFreq = isFreqMatch(item.frequency, dayIndex);
      const matchModel = item.store_model === 'AMBOS' || item.store_model === storeModel;
      return matchShift && matchFreq && matchModel;
    });

    const resolvedActivities = [...activeMappings];

    // Smart Fallback 1: Shift Leader inherits Assistant tasks if no Assistant is working
    const isShiftLeader = roleKey === 'SHIFT_LEADER_MALE' || roleKey === 'SHIFT_LEADER_FEMALE';
    if (isShiftLeader) {
      const isAssistantWorking = dayShiftAssignments.some(a => {
        const otherEmp = employees.find(e => String(e.id) === String(a.employee_id));
        if (!otherEmp) return false;
        const otherRole = resolvePositionKey(otherEmp.job_references?.[0]?.title || '', a.main_station, a.station_group);
        return otherRole === 'ASSISTANT';
      });

      if (!isAssistantWorking) {
        const assistantActs = positionActivities.filter((item: any) => {
          if (item.position_key !== 'ASSISTANT') return false;
          const matchShift = item.shift === 'AMBOS' || item.shift === shift;
          const matchFreq = isFreqMatch(item.frequency, dayIndex);
          const matchModel = item.store_model === 'AMBOS' || item.store_model === storeModel;
          return matchShift && matchFreq && matchModel;
        });
        resolvedActivities.push(...assistantActs);
      }
    }

    // Smart Fallback 2: Assistant inherits Manager tasks if no Manager is working
    const isAssistant = roleKey === 'ASSISTANT';
    if (isAssistant) {
      const isManagerWorking = dayShiftAssignments.some(a => {
        const otherEmp = employees.find(e => String(e.id) === String(a.employee_id));
        if (!otherEmp) return false;
        const otherRole = resolvePositionKey(otherEmp.job_references?.[0]?.title || '', a.main_station, a.station_group);
        return otherRole === 'MANAGER';
      });

      if (!isManagerWorking) {
        const managerActs = positionActivities.filter((item: any) => {
          if (item.position_key !== 'MANAGER') return false;
          const matchShift = item.shift === 'AMBOS' || item.shift === shift;
          const matchFreq = isFreqMatch(item.frequency, dayIndex);
          const matchModel = item.store_model === 'AMBOS' || item.store_model === storeModel;
          return matchShift && matchFreq && matchModel;
        });
        resolvedActivities.push(...managerActs);
      }
    }

    // Redistribution from Vacant Stations
    const activeStations = SECTIONS.flatMap(s => s.stations);
    const vacantStations = activeStations.filter(station => {
      const shiftStation = `${station}_${shift}`;
      const ass = dayShiftAssignments.find(a => a.sub_position === shiftStation);
      if (!ass || !ass.employee_id) return true;

      const isAbsent = activeWeeklyShifts.some(s =>
        s.shift_date === dateStr &&
        String(s.employee_id) === String(ass.employee_id) &&
        getShiftFromTime(s.start_time) === shift &&
        s.is_callback === true
      );
      return isAbsent;
    });

    const isRoleWorking = (roleToCheck: string) => {
      return dayShiftAssignments.some(a => {
        const otherEmp = employees.find(e => String(e.id) === String(a.employee_id));
        if (!otherEmp) return false;
        const otherRole = resolvePositionKey(otherEmp.job_references?.[0]?.title || '', a.main_station, a.station_group);
        return otherRole === roleToCheck;
      });
    };

    vacantStations.forEach(V => {
      const backups = STATION_BACKUPS[V] || [];
      const activeBackups = backups.filter(backupStation => {
        const shiftStation = `${backupStation}_${shift}`;
        const ass = dayShiftAssignments.find(a => a.sub_position === shiftStation);
        if (!ass || !ass.employee_id) return false;
        const isAbsent = activeWeeklyShifts.some(s =>
          s.shift_date === dateStr &&
          String(s.employee_id) === String(ass.employee_id) &&
          getShiftFromTime(s.start_time) === shift &&
          s.is_callback === true
        );
        return !isAbsent;
      });

      let shouldInherit = false;
      const isKitchenVacant = [
        'BURRITOS', 'TORTILLAS', 'TORTAS/QUESADILLAS', 'TORTAS/MULITAS',
        'TACOS', 'CARNES', 'PREPARACION', 'CUBRIR DESCANSOS (COCINA)',
        'TORTAS/QUESADILLAS (DT)', 'TACOS/BURRITOS (DT)', 'CUBRIR DESCANSOS (DT)'
      ].includes(V);

      if (activeBackups.length > 0) {
        shouldInherit = assignee.main_station === activeBackups[0];
      } else {
        if (isKitchenVacant) {
          if (roleKey === 'SHIFT_LEADER_MALE') {
            shouldInherit = true;
          } else if (roleKey === 'ASSISTANT' && !isRoleWorking('SHIFT_LEADER_MALE')) {
            shouldInherit = true;
          } else if (roleKey === 'MANAGER' && !isRoleWorking('SHIFT_LEADER_MALE') && !isRoleWorking('ASSISTANT')) {
            shouldInherit = true;
          }
        } else {
          if (roleKey === 'SHIFT_LEADER_FEMALE') {
            shouldInherit = true;
          } else if (roleKey === 'ASSISTANT' && !isRoleWorking('SHIFT_LEADER_FEMALE')) {
            shouldInherit = true;
          } else if (roleKey === 'MANAGER' && !isRoleWorking('SHIFT_LEADER_FEMALE') && !isRoleWorking('ASSISTANT')) {
            shouldInherit = true;
          }
        }
      }

      if (shouldInherit) {
        const vacantActs = positionActivities.filter((pa: any) => {
          if (pa.position_key !== V) return false;
          if (pa.shift !== 'AMBOS' && pa.shift !== shift) return false;
          if (pa.store_model !== 'AMBOS' && pa.store_model !== storeModel) return false;
          if (!isFreqMatch(pa.frequency, dayIndex)) return false;
          return true;
        });

        const tagged = vacantActs.map((pa: any) => ({
          ...pa,
          inheritedFrom: V
        }));
        resolvedActivities.push(...tagged);
      }
    });

    // Deduplicate and sort by sort_order
    const seen = new Set<string>();
    const uniqueResolved: any[] = [];
    resolvedActivities.forEach((item: any) => {
      const key = item.activity_id || item.id;
      if (item.operating_procedures?.activity && !seen.has(key)) {
        seen.add(key);
        uniqueResolved.push(item);
      }
    });

    uniqueResolved.sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0));
    return uniqueResolved;
  };

  const resolvedActivitiesMap = useMemo(() => {
    const cache = new Map<string, any[]>();
    if (loading || employees.length === 0 || positionActivities.length === 0) return cache;

    const shifts = ['AM', 'PM'] as const;
    const days = Array.from({ length: 7 }, (_, i) => formatDateISO(addDays(getMonday(currentWeekStart), i)));

    days.forEach(dateStr => {
      shifts.forEach(shift => {
        const shiftAssignments = assignments.filter(a => a.assignment_date === dateStr && a.sub_position?.endsWith(`_${shift}`));
        
        shiftAssignments.forEach(assignee => {
          const key = `${dateStr}_${shift}_${assignee.sub_position}`;
          const resolved = resolveActivitiesInner(assignee, dateStr, false);
          cache.set(key, resolved);
        });

        const activeStations = SECTIONS.flatMap(s => s.stations);
        activeStations.forEach(station => {
          const shiftStation = `${station}_${shift}`;
          const assignee = shiftAssignments.find(a => a.sub_position === shiftStation);
          if (!assignee) {
            const vacantAssignee = {
              store_id: selectedStoreGuid,
              employee_id: '',
              assignment_date: dateStr,
              main_station: station,
              sub_position: shiftStation,
              station_group: SECTIONS.find(s => s.stations.includes(station))?.id || 'front',
              tasks: []
            };
            const key = `${dateStr}_${shift}_${shiftStation}`;
            const resolved = resolveActivitiesInner(vacantAssignee, dateStr, false);
            cache.set(key, resolved);
          }
        });
      });
    });

    return cache;
  }, [loading, assignments, employees, positionActivities, activeWeeklyShifts, hasDriveThru, currentWeekStart]);

  const getResolvedActivities = (assignee: any, date: Date, ignoreAbsence = false) => {
    if (!assignee) return [];
    const dateStr = assignee.assignment_date || formatDateISO(date);
    const isShiftPM = assignee.sub_position?.includes('_PM');
    const shift = isShiftPM ? 'PM' : 'AM';
    const key = `${dateStr}_${shift}_${assignee.sub_position}`;
    
    if (ignoreAbsence || !resolvedActivitiesMap.has(key)) {
      return resolveActivitiesInner(assignee, dateStr, ignoreAbsence);
    }
    
    return resolvedActivitiesMap.get(key) || [];
  };

  const todayShifts = useMemo(() => {
    const dateStr = formatDateISO(activeDay);
    return activeWeeklyShifts.filter(s => 
      s.shift_date === dateStr && 
      getShiftFromTime(s.start_time) === activeShift
    );
  }, [activeWeeklyShifts, activeDay, activeShift]);

  const rosterToday = useMemo(() => {
    return todayShifts.map(s => {
      const emp = employees.find(e => String(e.id) === String(s.employee_id));
      const assignment = assignments.find(a => 
        a.assignment_date === s.shift_date && 
        a.employee_id === s.employee_id && 
        a.sub_position?.endsWith(`_${activeShift}`)
      );
      return {
        shift: s,
        employee: emp,
        assignment: assignment,
        isAbsent: s.is_callback === true,
        isAssigned: !!assignment
      };
    });
  }, [todayShifts, employees, assignments, activeShift]);

  const filteredRoster = useMemo(() => {
    if (!rosterSearch) return rosterToday;
    const q = rosterSearch.toLowerCase();
    return rosterToday.filter(r => {
      if (!r.employee) return false;
      const name = `${r.employee.chosen_name || r.employee.first_name || ''} ${r.employee.last_name || ''}`.toLowerCase();
      return name.includes(q);
    });
  }, [rosterToday, rosterSearch]);

  const autoFillToday = () => {
    const activeDateStr = formatDateISO(activeDay);
    const shiftSuffix = `_${activeShift}`;
    
    const scheduledEmps = activeWeeklyShifts
      .filter(s => s.shift_date === activeDateStr && getShiftFromTime(s.start_time) === activeShift && s.is_callback !== true)
      .map(s => employees.find(e => String(e.id) === String(s.employee_id)))
      .filter(Boolean);
      
    if (scheduledEmps.length === 0) {
      alert(t('roles_hub.autofill_no_shifts') || 'No se encontraron turnos de Toast para este día.');
      return;
    }

    const newAssignments = [...assignments];
    const cleanAssignments = newAssignments.filter(a => 
      !(a.assignment_date === activeDateStr && a.sub_position.endsWith(shiftSuffix))
    );

    let count = 0;
    const allStations = SECTIONS.flatMap(s => s.stations);

    scheduledEmps.forEach(emp => {
      if (!emp) return;
      const jobTitle = emp.job_references?.[0]?.title || '';
      const roleKey = resolvePositionKey(jobTitle);
      
      let matchedStation: string | null = null;

      if (roleKey === 'COOK_MALE') {
        matchedStation = allStations.find(st => 
          ['CARNES', 'TACOS', 'BURRITOS', 'TORTILLAS', 'TORTAS/QUESADILLAS', 'TORTAS/MULITAS', 'PREPARACION'].includes(st) &&
          !cleanAssignments.some(a => a.assignment_date === activeDateStr && a.sub_position === `${st}${shiftSuffix}`)
        ) || null;
      } else if (roleKey === 'CASHIER') {
        matchedStation = allStations.find(st => 
          ['Ventana 1', 'Ventana 2', 'Ventana 2 (B)', 'Caja 1 / Salón', 'Caja 2', 'Caja 3', 'Uber + Salsas', 'ENTREGA', 'LIMPIEZA'].includes(st) &&
          !cleanAssignments.some(a => a.assignment_date === activeDateStr && a.sub_position === `${st}${shiftSuffix}`)
        ) || null;
      } else if (['MANAGER', 'ASSISTANT', 'SHIFT_LEADER_MALE', 'SHIFT_LEADER_FEMALE'].includes(roleKey)) {
        matchedStation = allStations.find(st => 
          st.includes('CUBRIR DESCANSOS') &&
          !cleanAssignments.some(a => a.assignment_date === activeDateStr && a.sub_position === `${st}${shiftSuffix}`)
        ) || null;
      }

      if (!matchedStation) {
        matchedStation = allStations.find(st => 
          !cleanAssignments.some(a => a.assignment_date === activeDateStr && a.sub_position === `${st}${shiftSuffix}`)
        ) || null;
      }

      if (matchedStation) {
        const sectionId = SECTIONS.find(s => s.stations.includes(matchedStation!))?.id || 'front';
        const shiftStation = `${matchedStation}${shiftSuffix}`;
        const jsDay = activeDay.getDay();
        const myDayIndex = jsDay === 0 ? 6 : jsDay - 1;
        const dailyTasks = stationActivities[shiftStation] || [];
        const specificDayTasks = stationActivities[`${shiftStation}_${myDayIndex}`] || [];
        const defaultTasks = [...new Set([...dailyTasks, ...specificDayTasks])];

        cleanAssignments.push({
          store_id: selectedStoreGuid,
          employee_id: String(emp.id),
          assignment_date: activeDateStr,
          main_station: matchedStation,
          sub_position: shiftStation,
          station_group: sectionId,
          tasks: defaultTasks
        });
        count++;
      }
    });

    setAssignments(cleanAssignments);
    alert(t('roles_hub.autofill_success', { count }) || `¡Auto-llenado completado! Se asignaron ${count} personas.`);
  };

  const copyTomorrow = () => {
    const todayDateStr = formatDateISO(activeDay);
    const tomorrow = addDays(activeDay, 1);
    const tomorrowDateStr = formatDateISO(tomorrow);
    const shiftSuffix = `_${activeShift}`;

    const todayAss = assignments.filter(a => a.assignment_date === todayDateStr && a.sub_position.endsWith(shiftSuffix));
    if (todayAss.length === 0) {
      alert('No hay asignaciones hoy para copiar.');
      return;
    }

    const tomorrowEmpIds = new Set(
      activeWeeklyShifts
        .filter(s => s.shift_date === tomorrowDateStr && getShiftFromTime(s.start_time) === activeShift && s.is_callback !== true)
        .map(s => String(s.employee_id))
    );

    const newAssignments = assignments.filter(a => 
      !(a.assignment_date === tomorrowDateStr && a.sub_position.endsWith(shiftSuffix))
    );

    let count = 0;
    todayAss.forEach(a => {
      if (tomorrowEmpIds.has(String(a.employee_id))) {
        newAssignments.push({
          ...a,
          assignment_date: tomorrowDateStr
        });
        count++;
      }
    });

    setAssignments(newAssignments);
    alert(`Se copiaron ${count} asignaciones para mañana.`);
  };

  const clearToday = () => {
    const activeDateStr = formatDateISO(activeDay);
    const shiftSuffix = `_${activeShift}`;
    
    if (confirm('¿Deseas vaciar todas las asignaciones de hoy?')) {
      const updated = assignments.filter(a => 
        !(a.assignment_date === activeDateStr && a.sub_position.endsWith(shiftSuffix))
      );
      setAssignments(updated);
    }
  };

  const positionCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    const positions = ['COOK_MALE', 'CASHIER', 'SHIFT_LEADER_MALE', 'SHIFT_LEADER_FEMALE', 'ASSISTANT', 'MANAGER'];
    positions.forEach(pos => {
      counts[pos] = positionActivities.filter(pa => pa.position_key === pos).length;
    });
    return counts;
  }, [positionActivities]);

  const filteredActivitiesForConfig = useMemo(() => {
    return activities.filter(act => {
      if (taskSearchQuery) {
        const q = taskSearchQuery.toLowerCase();
        const nameMatch = act.name.toLowerCase().includes(q);
        const catMatch = (act.category || '').toLowerCase().includes(q);
        if (!nameMatch && !catMatch) return false;
      }
      
      if (configShift !== 'TODOS') {
        if (act.shift !== configShift && act.shift !== 'AMBOS') return false;
      }

      if (configFrequency !== 'TODAS') {
        const paFreq = act.frequency || act._frequency || 'Diario';
        if (configFrequency === 'Diario') {
          if (paFreq.toLowerCase() !== 'diario') return false;
        } else {
          if (paFreq !== configFrequency) return false;
        }
      }

      return true;
    });
  }, [activities, configShift, configFrequency, taskSearchQuery]);

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
      if (shiftEmployeeIds.has(String(e.id))) return true;
      if (e.deleted) return false;

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

  const fetchActivities = async () => {
    if (!selectedStoreGuid) return;
    try {
      const procsResp = await fetch('/api/procedimientos');
      const procsResult = await procsResp.json();
      const procs = procsResult.data || [];

      const masterList = procs.map((p: any) => ({
        id: String(p.id),
        name: p.activity,
        category: p.shift_type === 'Apertura' ? 'APERTURA' : p.shift_type === 'Cierre' ? 'CIERRE' : 'ACTIVIDAD REGULAR',
        startTime: p.start_time ? p.start_time.substring(0, 5) : '',
        endTime: p.start_time && p.duration_minutes ? (() => {
          const [h, m] = p.start_time.substring(0, 5).split(':').map(Number);
          const totalMin = h * 60 + m + p.duration_minutes;
          const eh = Math.floor(totalMin / 60) % 24;
          const em = totalMin % 60;
          return `${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}`;
        })() : '',
        shift: p.shift || 'AMBOS',
        overrides: p.overrides || {},
        _procId: p.id,
        _frequency: p.frequency,
        _role: p.role,
        _description: p.description,
        _duration: p.duration_minutes,
      }));

      const localResp = await fetch(`/api/roles/activities?store_id=${selectedStoreGuid}`);
      const localData = await localResp.json();

      setActivities(masterList);
      if (localData.station_mappings) setStationActivities(localData.station_mappings);
    } catch (e) {
      console.error('Error fetching activities:', e);
    }
  };

  const fetchPositionActivities = async () => {
    const res = await fetch('/api/roles/activities');
    const data = await res.json();
    setPositionActivities(data);
  };

  const saveActivities = async (newMaster?: any[], newMappings?: Record<string, string[]>) => {
    if (!selectedStoreGuid) return;
    try {
      if (newMappings) {
        pendingMappingsRef.current = newMappings;
        if (saveMappingsTimerRef.current) {
          clearTimeout(saveMappingsTimerRef.current);
        }
        saveMappingsTimerRef.current = setTimeout(async () => {
          const mappingsToSave = pendingMappingsRef.current;
          if (!mappingsToSave) return;
          pendingMappingsRef.current = null;
          try {
            await fetch('/api/roles/activities', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                store_id: selectedStoreGuid,
                master_activities: [],
                station_mappings: mappingsToSave
              })
            });
          } catch (e) {
            console.error('Error saving debounced mappings:', e);
          }
        }, 500);
      }
    } catch (e) {
      console.error('Error saving activities:', e);
    }
  };

  const handleTogglePositionActivity = async (activityId: string, isSelected: boolean) => {
    const actObj = activities.find(a => String(a.id) === String(activityId));
    if (!actObj) return;

    const nativeShift = actObj.shift || 'AMBOS';
    const nativeFrequency = actObj.frequency || 'Diario';
    const nativeStoreModel = actObj.store_model || 'AMBOS';

    let updatedActivities = [...positionActivities];
    
    if (isSelected) {
      const existingMapping = positionActivities.find(pa => 
        pa.position_key === selectedConfigPositionKey &&
        String(pa.activity_id) === String(activityId)
      );

      const shiftToDelete = existingMapping?.shift || nativeShift;
      const freqToDelete = existingMapping?.frequency || nativeFrequency;
      const modelToDelete = existingMapping?.store_model || nativeStoreModel;

      updatedActivities = updatedActivities.filter(pa => 
        !(pa.position_key === selectedConfigPositionKey &&
          String(pa.activity_id) === String(activityId))
      );

      setPositionActivities(updatedActivities);

      try {
        const resp = await fetch('/api/roles/activities', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            position_key: selectedConfigPositionKey,
            shift: shiftToDelete,
            activity_id: activityId,
            frequency: freqToDelete,
            store_model: modelToDelete,
            action: 'delete'
          })
        });
        if (!resp.ok) throw new Error('Failed to save activity mapping');
      } catch (e) {
        console.error(e);
        fetchPositionActivities();
        alert(t('roles_hub.error_save'));
      }
    } else {
      updatedActivities.push({
        position_key: selectedConfigPositionKey,
        shift: nativeShift,
        store_model: nativeStoreModel,
        frequency: nativeFrequency,
        activity_id: activityId,
        operating_procedures: actObj,
        sort_order: actObj?.start_time ? parseInt(actObj.start_time.split(':')[0]) * 60 + parseInt(actObj.start_time.split(':')[1]) : 0
      });

      setPositionActivities(updatedActivities);

      try {
        const resp = await fetch('/api/roles/activities', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            position_key: selectedConfigPositionKey,
            shift: nativeShift,
            activity_id: activityId,
            frequency: nativeFrequency,
            store_model: nativeStoreModel,
            action: 'add'
          })
        });
        if (!resp.ok) throw new Error('Failed to save activity mapping');
      } catch (e) {
        console.error(e);
        fetchPositionActivities();
        alert(t('roles_hub.error_save'));
      }
    }
  };

  // --- EFFECT HOOKS AND REAL-TIME SUBSCRIPTIONS ---
  useEffect(() => {
    const interval = setInterval(() => {
      const laTime = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
      const hour = laTime.getHours();
      const minute = laTime.getMinutes();
      
      const isPMShift = (hour > 16 || (hour === 16 && minute >= 50)) || (hour < 6);
      const targetShift = isPMShift ? 'PM' : 'AM';
      
      setActiveShift(prev => {
        if (prev !== targetShift) return targetShift;
        return prev;
      });

      if (hour === 6 && minute === 0) {
        const newBusinessDay = new Date(laTime.getFullYear(), laTime.getMonth(), laTime.getDate());
        setActiveDay(prev => prev.getTime() !== newBusinessDay.getTime() ? newBusinessDay : prev);
      }
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    fetchStores();
  }, []);

  useEffect(() => {
    if (!selectedStoreGuid) return;
    const stored = localStorage.getItem(`hasDriveThru_${selectedStoreGuid}`);
    if (stored !== null) {
      setHasDriveThru(stored === 'true');
    }
  }, [selectedStoreGuid]);

  useEffect(() => {
    if (!selectedStoreGuid) return;

    const channel = supabase
      .channel('mission-control-sync')
      .on(
        'postgres_changes',
        { 
          event: '*', 
          schema: 'public', 
          table: 'operating_procedures'
        },
        (payload: any) => {
          console.log('🔔 Real-time activity update from procedures:', payload);
          fetchActivities();
        }
      )
      .on(
        'postgres_changes',
        { 
          event: '*', 
          schema: 'public', 
          table: 'station_templates',
          filter: `template_name=eq.__CONFIG_ACTIVITIES__`
        },
        (payload: any) => {
          console.log('🔔 Real-time mapping update:', payload);
          if (payload.new && (payload.new.store_id === 'GLOBAL' || payload.new.store_id === selectedStoreGuid)) {
             fetchActivities();
          }
        }
      )
      .on(
        'postgres_changes',
        { 
          event: '*', 
          schema: 'public', 
          table: 'station_assignments',
          filter: `store_id=eq.${selectedStoreGuid}`
        },
        (payload: any) => {
          console.log('🔔 Real-time assignment update:', payload);
          const officialMonday = getMonday(currentWeekStart);
          const start = formatDateISO(officialMonday);
          const end = formatDateISO(addDays(officialMonday, 6));
          
          fetch(`/api/roles?store_id=${selectedStoreGuid}&start_date=${start}&end_date=${end}`)
            .then(res => res.json())
            .then(data => {
              setAssignments(Array.isArray(data) ? data : []);
            });
          fetchActivities();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'shifts',
          filter: `store_id=eq.${selectedStoreGuid}`
        },
        (payload: any) => {
          console.log('🔔 Real-time shifts update:', payload);
          const officialMonday = getMonday(currentWeekStart);
          const start = formatDateISO(officialMonday);
          const end = formatDateISO(addDays(officialMonday, 6));
          supabase
            .from('shifts')
            .select('*')
            .eq('store_id', selectedStoreGuid)
            .gte('shift_date', start)
            .lte('shift_date', end)
            .then(({ data }) => {
              if (data) setActiveWeeklyShifts(data);
            });
        }
      )
      .subscribe();

    fetchWeeklyData();
    fetchTemplates();
    fetchActivities();
    fetchPositionActivities();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedStoreGuid, currentWeekStart]);

  const finalizeSaveActivity = (force = false) => {
    let updated: any[];
    let oldName = '';
    let newName = newActivity.name.trim();
    let mappingsUpdated = false;
    let localMappings = { ...stationActivities };
    let localAssignments = [...assignments];

    if (editingActivityId) {
      const editTarget = activities.find(a => a.id === editingActivityId);
      
      updated = activities.map(a => {
        if (a.id === editingActivityId) {
          oldName = a.name;
          const isTimeChanged = a.startTime !== newActivity.startTime || a.endTime !== newActivity.endTime;
          
          const newOverrides = { ...(a.overrides || {}) };
          if (isTimeChanged) {
            newOverrides[selectedStoreGuid] = {
              startTime: newActivity.startTime,
              endTime: newActivity.endTime
            };
          }

          return { 
            ...a, 
            name: newName,
            category: newActivity.category,
            shift: newActivity.shift,
            overrides: newOverrides
          };
        }
        return a;
      });

      const shift_type = newActivity.category === 'APERTURA' ? 'Apertura' : newActivity.category === 'CIERRE' ? 'Cierre' : 'Regular';
      let duration_minutes = null;
      if (newActivity.startTime && newActivity.endTime) {
        const [sh, sm] = newActivity.startTime.split(':').map(Number);
        const [eh, em] = newActivity.endTime.split(':').map(Number);
        let startMin = sh * 60 + sm, endMin = eh * 60 + em;
        if (endMin <= startMin) endMin += 24 * 60;
        duration_minutes = endMin - startMin;
      }
      
      fetch('/api/procedimientos', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editTarget?._procId || editingActivityId,
          activity: newName,
          shift_type,
          start_time: newActivity.startTime ? newActivity.startTime + ':00' : null,
          duration_minutes,
          shift: newActivity.shift,
          overrides: updated.find(a => a.id === editingActivityId)?.overrides || {}
        })
      });

      if (oldName && oldName !== newName) {
        Object.keys(localMappings).forEach(key => {
          if (localMappings[key]?.includes(oldName)) {
            localMappings[key] = localMappings[key].map((t: string) => t === oldName ? newName : t);
            mappingsUpdated = true;
          }
        });

        let assignmentsUpdated = false;
        localAssignments = localAssignments.map(assign => {
          if (assign.tasks?.includes(oldName)) {
            assignmentsUpdated = true;
            return { ...assign, tasks: assign.tasks.map((t: string) => t === oldName ? newName : t) };
          }
          return assign;
        });

        if (mappingsUpdated) setStationActivities(localMappings);
        if (assignmentsUpdated) setAssignments(localAssignments);
      }
    } else {
      const exists = !force && activities.some(a => a.name === newName);
      if (exists) return;
      
      const shift_type = newActivity.category === 'APERTURA' ? 'Apertura' : newActivity.category === 'CIERRE' ? 'Cierre' : 'Regular';
      let duration_minutes = null;
      if (newActivity.startTime && newActivity.endTime) {
        const [sh, sm] = newActivity.startTime.split(':').map(Number);
        const [eh, em] = newActivity.endTime.split(':').map(Number);
        let startMin = sh * 60 + sm, endMin = eh * 60 + em;
        if (endMin <= startMin) endMin += 24 * 60;
        duration_minutes = endMin - startMin;
      }

      fetch('/api/procedimientos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          activity: newName,
          shift_type,
          start_time: newActivity.startTime ? newActivity.startTime + ':00' : null,
          duration_minutes,
          shift: newActivity.shift,
          overrides: {},
          frequency: 'Diario',
          role: 'ROLES_MODULE'
        })
      }).then(() => fetchActivities());

      updated = [...activities, { 
        ...newActivity, 
        name: newName,
        id: Date.now().toString(),
        overrides: {} 
      }];
    }
    
    setActivities(updated);
    setNewActivity({ name: '', category: 'APERTURA', startTime: '', endTime: '', shift: 'AM' });
    setEditingActivityId(null);
    
    saveActivities(updated, mappingsUpdated ? localMappings : undefined);

    if (oldName && oldName !== newName && JSON.stringify(localAssignments) !== JSON.stringify(assignments)) {
      const start = formatDateISO(getMonday(currentWeekStart));
      const end = formatDateISO(addDays(getMonday(currentWeekStart), 6));
      fetch('/api/roles', {
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          assignments: localAssignments, 
          store_id: selectedStoreGuid,
          start_date: start,
          end_date: end
        })
      });
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const toggleEmployeeSpecificTask = (assign: any, taskName: string) => {
    setAssignments(prev => prev.map(a => {
      if (a.assignment_date === assign.assignment_date && a.sub_position === assign.sub_position && a.employee_id === assign.employee_id) {
        const tasks = a.tasks || [];
        if (tasks.includes(taskName)) {
          return { ...a, tasks: tasks.filter((t: string) => t !== taskName) };
        } else {
          return { ...a, tasks: [...tasks, taskName] };
        }
      }
      return a;
    }));
  };

  const updateAssignment = (dateStr: string, station: string, employeeId: string, group: string) => {
    const newAssignments = [...assignments];
    const jsDay = new Date(dateStr + 'T12:00:00').getDay();
    const myDayIndex = jsDay === 0 ? 6 : jsDay - 1;
    const shiftStation = `${station}_${activeShift}`;
    
    const dailyTasks = stationActivities[shiftStation] || [];
    const specificDayTasks = stationActivities[`${shiftStation}_${myDayIndex}`] || [];
    const defaultTasks = [...new Set([...dailyTasks, ...specificDayTasks])];
    
    const index = newAssignments.findIndex(a => a.assignment_date === dateStr && a.sub_position === shiftStation);

    if (index !== -1) {
      if (employeeId === '') {
        newAssignments.splice(index, 1);
      } else {
        newAssignments[index] = { ...newAssignments[index], employee_id: employeeId, tasks: defaultTasks };
      }
    } else if (employeeId !== '') {
      newAssignments.push({
        store_id: selectedStoreGuid,
        employee_id: employeeId,
        assignment_date: dateStr,
        main_station: station,
        sub_position: shiftStation,
        station_group: group,
        tasks: defaultTasks
      });
    }
    setAssignments(newAssignments);
  };

  const handleSlotClick = (stationKey: string, label: string, group: string, emp: any, assignee: any) => {
    setSelectedSlotForCard({ 
      stationKey: stationKey, 
      label: label, 
      assignee: { ...assignee, station_group: group } 
    });
    setSelectedEmployeeCard(emp);
    setIsReassigning(false);
  };

  const saveAssignments = async () => {
    if (!selectedStoreGuid) return alert('Error: No hay tienda seleccionada');
    
    setSaving(true);
    const start = formatDateISO(getMonday(currentWeekStart));
    const end = formatDateISO(addDays(getMonday(currentWeekStart), 6));

    try {
      const shiftSuffix = `_${activeShift}`;
      const shiftAssignments = assignments.filter(a => a.sub_position?.endsWith(shiftSuffix));

      const response = await fetch('/api/roles', {
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          assignments: shiftAssignments, 
          store_id: selectedStoreGuid,
          start_date: start,
          end_date: end,
          active_shift: activeShift
        })
      });
      
      const result = await response.json();

      if (response.ok) {
        alert('🚀 Operación Guardada con Éxito');
      } else {
        throw new Error(result.error || 'Error desconocido al guardar');
      }
    } catch (error: any) { 
      console.error('SAVE ERROR:', error); 
      alert(`❌ ERROR SAVING: ${error.message}\n\nPlease do not refresh the page and try again.`);
    } finally { 
      setSaving(false); 
    }
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

    const result = await response.json();

    if (response.ok) {
      alert(`💾 Plantilla ${activeShift} Guardada`);
      setNewTemplateName('');
      setShowTemplateSave(false);
      fetchTemplates();
    } else {
      alert(`❌ ERROR SAVING TEMPLATE: ${result.error || 'Unknown error'}`);
    }
  };

  const applyTemplate = (templateData: any[]) => {
    const activeDateStr = format(activeDay, 'yyyy-MM-dd');
    const shiftSuffix = `_${activeShift}`;

    const mapStationName = (oldName: string, groupHint?: string) => {
      let name = oldName;
      if (name === 'BURRITOS (DT)') return 'TACOS/BURRITOS (DT)';
      
      if (name === 'TORTAS/QUESADILLAS' && groupHint === 'Drive-Thru') return 'TORTAS/QUESADILLAS (DT)';
      
      return name;
    };

    const findCurrentGroup = (stationName: string) => {
      for (const section of SECTIONS) {
        if (section.stations.includes(stationName)) return section.id;
      }
      return 'front';
    };

    const filteredAssignments = assignments.filter(a => 
      !(a.assignment_date === activeDateStr && a.sub_position.endsWith(shiftSuffix))
    );
    
    const jsDay = new Date(activeDateStr + 'T12:00:00').getDay();
    const myDayIndex = jsDay === 0 ? 6 : jsDay - 1;

    const newDayAssignments = templateData.map(a => {
        const mappedName = mapStationName(a.main_station, a.station_group);
        const shiftStation = mappedName + shiftSuffix;
        
        const dailyTasks = stationActivities[shiftStation] || [];
        const specificDayTasks = stationActivities[`${shiftStation}_${myDayIndex}`] || [];
        const defaultTasks = [...new Set([...dailyTasks, ...specificDayTasks])];
        
        const currentTasks = (a.tasks && a.tasks.length > 0) ? a.tasks : defaultTasks;
        
        return {
          ...a,
          main_station: mappedName,
          sub_position: shiftStation,
          station_group: findCurrentGroup(mappedName),
          store_id: selectedStoreGuid,
          assignment_date: activeDateStr,
          tasks: currentTasks
        };
    });

    setAssignments([...filteredAssignments, ...newDayAssignments]);
    alert(`✨ Plantilla ${activeShift} Aplicada con éxito`);
  };

  const copyLastWeek = async () => {
    const officialMonday = getMonday(currentWeekStart);
    const lastMonday = subDays(officialMonday, 7);
    const startLast = formatDateISO(lastMonday);
    const endLast = formatDateISO(addDays(lastMonday, 6));

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

    if (!lastData || lastData.length === 0) {
      alert('No hay datos de la semana anterior para copiar.');
      return;
    }

    const newAssignments = lastData.map((a: any) => {
        const originalDate = new Date(a.assignment_date + 'T12:00:00');
        const newDate = addDays(originalDate, 7);
        const newDateStr = format(newDate, 'yyyy-MM-dd');
        const mappedName = mapStationName(a.main_station, a.station_group);
        const isShiftPM = a.sub_position?.includes('_PM');
        const shiftSuffix = isShiftPM ? '_PM' : '_AM';
        const shiftStation = mappedName + shiftSuffix;
        
        const jsDay = newDate.getDay();
        const myDayIndex = jsDay === 0 ? 6 : jsDay - 1;
        const dailyTasks = stationActivities[shiftStation] || [];
        const specificDayTasks = stationActivities[`${shiftStation}_${myDayIndex}`] || [];
        const freshTasks = [...new Set([...dailyTasks, ...specificDayTasks])];
        
        return {
            store_id: selectedStoreGuid,
            employee_id: a.employee_id,
            main_station: mappedName,
            sub_position: shiftStation,
            station_group: findCurrentGroup(mappedName),
            assignment_date: newDateStr,
            tasks: freshTasks
        };
    });

    const amCount = newAssignments.filter((a: any) => a.sub_position.endsWith('_AM')).length;
    const pmCount = newAssignments.filter((a: any) => a.sub_position.endsWith('_PM')).length;

    setAssignments(newAssignments);
    alert(`📅 Semana anterior clonada con éxito\n\nAM: ${amCount} asignaciones\nPM: ${pmCount} asignaciones\n\n⚠️ Recuerda guardar (Save) para que se persista.`);
  };

  const getAssignee = (date: Date, station: string) => {
    const dateStr = format(date, 'yyyy-MM-dd');
    return assignments.find(a => a.assignment_date === dateStr && a.sub_position === station);
  };

  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(currentWeekStart, i));

  if (loading && stores.length === 0) return (
    <div className="min-h-screen bg-[#f8fafc] flex flex-col items-center justify-center p-12">
      <div className="w-12 h-12 border-4 border-indigo-100 border-t-indigo-600 rounded-full animate-spin mb-6" />
      <h2 className="text-sm font-bold text-slate-400 uppercase tracking-[0.3em]">Syncing Hub</h2>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-900 font-sans antialiased pb-20">
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-xl border-b border-black/5 px-8 pt-6">
        <div className="max-w-[1900px] mx-auto flex flex-wrap items-center justify-between gap-8 mb-6">
          <div className="flex items-center gap-4">
            <div className="bg-indigo-600 p-3 rounded-2xl shadow-lg shadow-indigo-200">
              <Zap className="text-white fill-white" size={24} />
            </div>
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-slate-900 flex items-center gap-3">
                Roles Hub <span className="text-[10px] bg-slate-100 px-3 py-1 rounded-full border border-slate-200 tracking-widest font-black uppercase text-slate-500">Operations</span>
              </h1>
              <p className="text-xs font-medium text-slate-400 mt-1 uppercase tracking-widest">Tactical Station Assignment</p>
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
                onClick={() => {
                  setCurrentWeekStart(prev => subDays(prev, 7));
                  setActiveDay(prev => subDays(prev, 7));
                }}
                className="p-2 hover:bg-slate-50 rounded-xl text-slate-400 hover:text-indigo-600 transition-all"
              >
                <ChevronLeft size={20} />
              </button>
              <div className="text-center min-w-[180px]"><span className="text-sm font-bold text-slate-900 tracking-tight">
                  {format(getMonday(currentWeekStart), 'MMM dd', { locale: es })} - {format(addDays(getMonday(currentWeekStart), 6), 'MMM dd', { locale: es })}
                </span>
                <span className="block text-[10px] font-bold text-indigo-500/60 uppercase tracking-widest mt-0.5">Planned Week</span>
              </div>
              <button 
                onClick={() => {
                  setCurrentWeekStart(prev => addDays(prev, 7));
                  setActiveDay(prev => addDays(prev, 7));
                }}
                className="p-2 hover:bg-slate-50 rounded-xl text-slate-400 hover:text-indigo-600 transition-all"
              >
                <ChevronRight size={20} />
              </button>
            </div>
            <div className="flex items-center gap-3 px-4 border-l border-slate-100">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">Has Drive-Thru</span>
              <button 
                onClick={() => {
                  const newVal = !hasDriveThru;
                  setHasDriveThru(newVal);
                  if (selectedStoreGuid) {
                    localStorage.setItem(`hasDriveThru_${selectedStoreGuid}`, String(newVal));
                  }
                }}
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
              onClick={() => setShowActivitiesModal(true)}
              className="flex items-center gap-2 bg-white hover:bg-indigo-50 text-slate-600 hover:text-indigo-600 px-5 py-3 rounded-2xl border border-slate-200 font-bold text-xs transition-all shadow-sm"
            >
              <FileText size={16} />
              Actividades
            </button>
            <button 
              onClick={() => setShowSpecificTasksModal(true)}
              className="flex items-center gap-2 bg-white hover:bg-indigo-50 text-slate-600 hover:text-indigo-600 px-5 py-3 rounded-2xl border border-slate-200 font-bold text-xs transition-all shadow-sm"
            >
              <ClipboardList size={16} />
              Tareas Especificas
            </button>
            <button
              onClick={() => setShowUnassignedActivitiesModal(true)}
              className="flex items-center gap-2 bg-rose-50 hover:bg-rose-100 text-rose-600 px-5 py-3 rounded-2xl border border-rose-200 font-bold text-xs transition-all shadow-sm"
            >
              <AlertTriangle size={16} />
              Actividades sin asignar
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
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
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
                      <button 
                        onClick={() => setShowStationActivitiesModal(station)}
                        className="w-full flex items-center justify-between px-4 text-left bg-slate-50 hover:bg-indigo-50/50 border border-slate-100 hover:border-indigo-200 rounded-2xl min-h-[70px] group/station transition-all shadow-sm hover:shadow-md"
                        title={`Asignar Actividades a ${station}`}
                      >
                        <span className="text-[11px] font-black text-slate-600 group-hover/station:text-indigo-700 uppercase tracking-tight leading-tight flex-1 pr-2 break-words">{station}</span>
                        <div className="p-2 text-slate-300 group-hover/station:text-indigo-600 group-hover/station:bg-white rounded-xl transition-all opacity-0 group-hover/station:opacity-100 shrink-0">
                          <FileText size={16} />
                        </div>
                      </button>

                      {[0, 1, 2, 3, 4, 5, 6].map(offset => {
                        const day = addDays(getMonday(currentWeekStart), offset);
                        const dateStr = formatDateISO(day);
                        const shiftStation = `${station}_${activeShift}`;
                        const currentAssigned = assignments.find(a => a.assignment_date === dateStr && a.sub_position === shiftStation);
                        const emp = employees.find(e => String(e.id) === String(currentAssigned?.employee_id));
                        const isToday = isSameDay(day, new Date());
                        const isActive = isSameDay(day, activeDay);

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

        <div className="bg-white/50 rounded-[2.5rem] border border-black/5 p-8 shadow-sm mt-12">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-4">
              <div className="bg-slate-900 text-white p-4 rounded-3xl shadow-xl shadow-slate-200">
                <ClipboardList size={24} />
              </div>
              <div>
                <h2 className="text-2xl font-black text-slate-900 tracking-tight uppercase italic">Resumen Operativo de Actividades ({activeShift})</h2>
                <p className="text-[10px] font-bold text-slate-400 mt-1 uppercase tracking-widest italic">Generado automáticamente según el rol de posiciones</p>
              </div>
            </div>
            <div className="flex items-center gap-3 no-print">
              <div className="flex items-center gap-4 px-6 py-3 bg-amber-50 border border-amber-100 rounded-2xl">
                <Zap className="text-amber-500" size={16} />
                <span className="text-[10px] font-black text-amber-700 uppercase tracking-widest">Priorizar las órdenes</span>
              </div>
              <button 
                onClick={handlePrint}
                className="flex items-center gap-3 bg-indigo-600 text-white px-8 py-3 rounded-2xl font-black uppercase tracking-widest text-[11px] shadow-lg hover:bg-indigo-700 hover:-translate-y-0.5 transition-all active:translate-y-0"
              >
                <Printer size={18} />
                Imprimir
              </button>
            </div>
          </div>

          <div id="printable-activity-report" className="overflow-x-auto custom-scrollbar bg-white">
            <table className="w-full border-separate border-spacing-0 rounded-3xl overflow-hidden border border-slate-200">
              <thead>
                <tr className="bg-slate-900">
                  <th className="p-4 text-[10px] font-black text-white/50 uppercase tracking-[0.2em] text-left border-r border-white/5">Categoría / Tarea</th>
                  <th className="p-4 text-[10px] font-black text-white/50 uppercase tracking-[0.2em] text-left border-r border-white/5 w-40">Horario</th>
                  {weekDays.map(day => (
                    <th key={day.toString()} className="p-4 text-[10px] font-black text-white uppercase tracking-[0.2em] text-center border-r border-white/5">
                      {format(day, 'EEEE', { locale: es }).toUpperCase()}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="bg-white">
                {[...new Set([...activities.map(a => a.category), 'APERTURA', 'CIERRE', 'ACTIVIDAD REGULAR', 'OTROS'])].filter(Boolean).map(cat => {
                  const catActivities = activities.filter(act => {
                    const matchesCategory = act.category === cat;
                    if (!matchesCategory) return false;

                    const matchesShift = act.shift === activeShift || act.shift === 'AMBOS' || !act.shift;
                    if (!matchesShift) return false;

                      const hasAnyAssignment = weekDays.some(day => {
                        const dateStr = formatDateISO(day);
                        const jsDay = day.getDay();
                        const myDayIndex = jsDay === 0 ? 6 : jsDay - 1;
                        const shiftSuffix = `_${activeShift}`;
                        
                        return assignments.some(a => {
                          if (a.assignment_date !== dateStr) return false;
                          if (!a.sub_position?.endsWith(shiftSuffix)) return false;
                          
                          const stationBase = a.main_station || a.sub_position.replace(shiftSuffix, '');
                          const shiftStationKey = `${stationBase}${shiftSuffix}`;
                          
                          const hasTask = (a.tasks && a.tasks.length > 0)
                            ? a.tasks.includes(act.name)
                            : (stationActivities[shiftStationKey]?.includes(act.name) ||
                               stationActivities[`${shiftStationKey}_${myDayIndex}`]?.includes(act.name));
                          return hasTask;
                        });
                      });

                    return hasAnyAssignment;
                  });

                  if (catActivities.length === 0) return null;

                  return (
                    <React.Fragment key={cat}>
                      <tr className="bg-slate-50/80">
                        <td colSpan={9} className="p-4 text-[11px] font-black text-indigo-600 uppercase tracking-[0.3em] border-b border-slate-200">
                          {cat}
                        </td>
                      </tr>
                      {catActivities.map(act => (
                        <tr key={act.id} className="hover:bg-slate-50/50 transition-colors group">
                          <td className="p-4 border-r border-slate-100 border-b border-slate-100">
                            <span className="text-[11px] font-bold text-slate-700 uppercase tracking-tight group-hover:text-indigo-600 transition-colors">{act.name}</span>
                          </td>
                          <td className="p-4 border-r border-slate-100 border-b border-slate-100">
                            <span className="text-[10px] font-black text-amber-500 uppercase">
                              {act.startTime ? `${formatTime12h(act.startTime)} - ${formatTime12h(act.endTime)}` : formatTime12h(act.schedule)}
                            </span>
                          </td>
                          {weekDays.map(day => {
                            const dateStr = formatDateISO(day);
                            const shiftSuffix = `_${activeShift}`;
                            const assignedPeople = assignments
                              .filter(a => {
                                const isDateMatch = a.assignment_date === dateStr;
                                const isShiftMatch = a.sub_position.endsWith(shiftSuffix);
                                const jsDay = day.getDay();
                                const myDayIndex = jsDay === 0 ? 6 : jsDay - 1;
                                
                                const stationBase = a.main_station || a.sub_position.replace(shiftSuffix, '');
                                const shiftStationKey = `${stationBase}${shiftSuffix}`;
                                
                                const hasTask = (a.tasks && a.tasks.length > 0)
                                  ? a.tasks.includes(act.name)
                                  : (stationActivities[shiftStationKey]?.includes(act.name) ||
                                     stationActivities[`${shiftStationKey}_${myDayIndex}`]?.includes(act.name));
                                return isDateMatch && isShiftMatch && hasTask;
                              })
                              .map(a => {
                                const e = employees.find(emp => String(emp.id) === String(a.employee_id));
                                return e ? (e.chosen_name || e.first_name).toUpperCase() : null;
                              })
                              .filter(Boolean);

                            return (
                              <td key={day.toString()} className="p-4 border-r border-slate-100 border-b border-slate-100 text-center">
                                {assignedPeople.length > 0 ? (
                                  <div className="flex flex-col gap-1">
                                    {assignedPeople.map((name, i) => (
                                      <span key={i} className="text-[12px] font-black text-slate-900 leading-tight bg-indigo-50/50 py-1 px-2 rounded-lg border border-indigo-100 shadow-sm">
                                        {name}
                                      </span>
                                    ))}
                                  </div>
                                ) : (
                                  <span className="text-[10px] font-bold text-slate-300 uppercase tracking-widest">-</span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-8 p-6 bg-red-600 rounded-2xl shadow-xl shadow-red-100">
            <p className="text-white text-center text-xs font-black uppercase tracking-[0.2em]">Se ubicara al personal y se cambiaran de posiciones conforme a las necesidades del Restaurante</p>
          </div>
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

      {typeof document !== 'undefined' && createPortal(
      <AnimatePresence>
        {showVisualBoard && (
           <motion.div 
             initial={{ opacity: 0 }}
             animate={{ opacity: 1 }}
             exit={{ opacity: 0 }}
             className="fixed inset-0 z-[9999] bg-white flex flex-col overflow-hidden"
           >
              <div className="bg-zinc-50 border-b-2 border-black/5 px-10 py-3 flex items-center justify-between">
                <div className="flex items-center gap-6">
                  <div className="bg-black p-2 rounded-xl">
                    <LayoutTemplate className="text-white" size={20} />
                  </div>
                  <div>
                    <h1 className="text-xl font-black text-black tracking-widest uppercase italic">Tablero Operativo <span className="text-orange-500 not-italic ml-2">{activeShift}</span></h1>
                  </div>
                </div>
                <div className="flex items-center gap-4 bg-white p-2 rounded-[2rem] border-2 border-slate-200 shadow-md">
                  <div className="flex gap-2">
                    {['AM', 'PM'].map(sh => (
                      <button
                        key={sh}
                        onClick={() => setActiveShift(sh as any)}
                        className={`px-10 py-3 rounded-xl text-sm md:text-base font-black transition-all uppercase tracking-widest ${activeShift === sh ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700'}`}
                      >
                        {sh === 'AM' ? 'TURNO AM' : 'TURNO PM'}
                      </button>
                    ))}
                  </div>
                  <div className="w-px h-10 bg-slate-200 mx-2" />
                  <div className="flex items-center gap-6 px-6 text-slate-800 font-black uppercase text-lg tracking-tight">
                    <button onClick={() => setActiveDay(subDays(activeDay, 1))} className="w-10 h-10 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-center text-slate-400 hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-200 transition-colors shadow-sm"><ChevronLeft size={24} /></button>
                    <span className="min-w-[180px] text-center">{format(activeDay, 'EEEE dd', { locale: es })}</span>
                    <button onClick={() => setActiveDay(addDays(activeDay, 1))} className="w-10 h-10 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-center text-slate-400 hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-200 transition-colors shadow-sm"><ChevronRight size={24} /></button>
                  </div>
                </div>
                <button 
                  onClick={() => setShowVisualBoard(false)}
                  className="bg-black text-white px-8 py-3 rounded-full font-black text-[10px] uppercase tracking-widest transition-all"
                >
                  Cerrar
                </button>
              </div>
              <div className="flex-1 p-4 flex flex-col justify-between bg-zinc-50/50 overflow-hidden select-none relative">
                <div className="flex flex-col gap-1 relative z-10">
                  <div className="flex items-center justify-center gap-4 mb-1">
                    <h2 className="text-4xl font-black text-indigo-600 uppercase tracking-[0.8em] italic leading-none drop-shadow-sm">Dining Area</h2>
                  </div>
                  <div className="flex flex-col items-center gap-1">
                    <div className="flex gap-2 w-full max-w-2xl">
                      <BoardSlot label="Limpieza" stationKey="LIMPIEZA" group="Salón" assignee={getAssignee(activeDay, `LIMPIEZA_${activeShift}`)} employees={employees} className="flex-1 h-18" onClick={handleSlotClick} />
                      <BoardSlot label="Descansos" stationKey="CUBRIR DESCANSOS (SALΓö£├┤N)" group="Salón" assignee={getAssignee(activeDay, `CUBRIR DESCANSOS (SALΓö£├┤N)_${activeShift}`)} employees={employees} className="flex-1 h-18" onClick={handleSlotClick} />
                    </div>
                    <div className="w-full grid grid-cols-7 gap-1">
                      <BoardSlot label="Delivery" stationKey="Uber + Salsas" group="Salón" assignee={getAssignee(activeDay, `Uber + Salsas_${activeShift}`)} employees={employees} className="h-18" onClick={handleSlotClick} />
                      <BoardSlot label="Entrega" stationKey="ENTREGA" group="Salón" assignee={getAssignee(activeDay, `ENTREGA_${activeShift}`)} employees={employees} className="h-18" onClick={handleSlotClick} />
                      <BoardSlot label="Tacos" stationKey="TACOS" group="Salón" assignee={getAssignee(activeDay, `TACOS_${activeShift}`)} employees={employees} className="h-18" onClick={handleSlotClick} />
                      <BoardSlot label="Burritos" stationKey="BURRITOS" group="Salón" assignee={getAssignee(activeDay, `BURRITOS_${activeShift}`)} employees={employees} className="h-18" onClick={handleSlotClick} />
                      <BoardSlot label="Caja 3" stationKey="Caja 3" group="Salón" assignee={getAssignee(activeDay, `Caja 3_${activeShift}`)} employees={employees} className="h-18" onClick={handleSlotClick} />
                      <BoardSlot label="Caja 2" stationKey="Caja 2" group="Salón" assignee={getAssignee(activeDay, `Caja 2_${activeShift}`)} employees={employees} className="h-18" onClick={handleSlotClick} />
                      <BoardSlot label="Caja 1" stationKey="Caja 1 / Salón" group="Salón" assignee={getAssignee(activeDay, `Caja 1 / Salón_${activeShift}`)} employees={employees} className="h-18" onClick={handleSlotClick} />
                    </div>
                  </div>
                </div>
                <div className="flex flex-col items-center flex-1 justify-center py-2 relative z-10">
                  <div className="w-full flex flex-col items-center gap-1">
                    <div className="w-full grid grid-cols-4 gap-2">
                      <BoardSlot label="Carnes" stationKey="CARNES" group="Cocina" assignee={getAssignee(activeDay, `CARNES_${activeShift}`)} employees={employees} className="h-28" onClick={handleSlotClick} />
                      <BoardSlot label="Tortillas" stationKey="TORTILLAS" group="Cocina" assignee={getAssignee(activeDay, `TORTILLAS_${activeShift}`)} employees={employees} className="h-28" onClick={handleSlotClick} />
                      <BoardSlot label="Tortas / Mulitas" stationKey="TORTAS/MULITAS" group="Cocina" assignee={getAssignee(activeDay, `TORTAS/MULITAS_${activeShift}`)} employees={employees} className="h-28" onClick={handleSlotClick} />
                      <BoardSlot label="Tortas / Quesadillas" stationKey="TORTAS/QUESADILLAS" group="Cocina" assignee={getAssignee(activeDay, `TORTAS/QUESADILLAS_${activeShift}`)} employees={employees} className="h-28" onClick={handleSlotClick} />
                    </div>
                    <div className="w-full grid grid-cols-3 gap-2">
                      <BoardSlot label="Preparación" stationKey="PREPARACION" group="Cocina" assignee={getAssignee(activeDay, `PREPARACION_${activeShift}`)} employees={employees} className="h-16 col-span-2" onClick={handleSlotClick} />
                      <BoardSlot label="Descansos" stationKey="CUBRIR DESCANSOS (COCINA)" group="Cocina" assignee={getAssignee(activeDay, `CUBRIR DESCANSOS (COCINA)_${activeShift}`)} employees={employees} className="h-16" onClick={handleSlotClick} />
                    </div>
                  </div>
                </div>
                {hasDriveThru && (
                  <div className="flex flex-col gap-1 items-center relative z-10">
                    <div className="flex items-center justify-center gap-4 mb-1 w-full">
                      <h2 className="text-4xl font-black text-indigo-600 uppercase tracking-[0.8em] italic leading-none drop-shadow-sm">Drive-Thru</h2>
                    </div>
                    <div className="flex gap-2 w-full px-1 items-stretch">
                       <BoardSlot label="Ventanilla 1" stationKey="Ventana 1" group="Drive-Thru" assignee={getAssignee(activeDay, `Ventana 1_${activeShift}`)} employees={employees} className="h-28 w-72" onClick={handleSlotClick} />
                       <div className="flex-1 flex flex-col gap-1">
                          <div className="grid grid-cols-2 gap-1">
                            <BoardSlot label="Tortas / Quesadillas (DT)" stationKey="TORTAS/QUESADILLAS (DT)" group="Drive-Thru" assignee={getAssignee(activeDay, `TORTAS/QUESADILLAS (DT)_${activeShift}`)} employees={employees} className="h-14 w-full" onClick={handleSlotClick} />
                            <BoardSlot label="Descansos" stationKey="CUBRIR DESCANSOS (DT)" group="Drive-Thru" assignee={getAssignee(activeDay, `CUBRIR DESCANSOS (DT)_${activeShift}`)} employees={employees} className="h-14" onClick={handleSlotClick} />
                          </div>
                          <div className="flex-1 grid grid-cols-3 gap-1">
                            <BoardSlot label="Tacos / Burritos (DT)" stationKey="TACOS/BURRITOS (DT)" group="Drive-Thru" assignee={getAssignee(activeDay, `TACOS/BURRITOS (DT)_${activeShift}`)} employees={employees} className="h-14" onClick={handleSlotClick} />
                            <BoardSlot label="Ventanilla 2" stationKey="Ventana 2" group="Drive-Thru" assignee={getAssignee(activeDay, `Ventana 2_${activeShift}`)} employees={employees} className="h-14" onClick={handleSlotClick} />
                            <BoardSlot label="Ventanilla 2 (B)" stationKey="Ventana 2 (B)" group="Drive-Thru" assignee={getAssignee(activeDay, `Ventana 2 (B)_${activeShift}`)} employees={employees} className="h-14" onClick={handleSlotClick} />
                          </div>
                       </div>
                    </div>
                  </div>
                )}
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
      , document.body)}

      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar { height: 8px; width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #e2e8f0; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #cbd5e1; }
        select option { background-color: white; color: #1e293b; padding: 12px; font-weight: bold; }
        @media print {
          @page { size: letter landscape; margin: 5mm; }
          body * { visibility: hidden; }
          #printable-activity-report, #printable-activity-report * { visibility: visible; }
          #printable-activity-report { position: absolute; left: 0; top: 0; width: 100%; background: white !important; padding: 0 !important; }
          .no-print { display: none !important; }
          table { width: 100% !important; border-collapse: collapse !important; border: 1px solid #e2e8f0 !important; }
          th, td { border: 1px solid #e2e8f0 !important; padding: 6px !important; font-size: 9px !important; }
          .bg-slate-900 { background-color: #0f172a !important; color: white !important; -webkit-print-color-adjust: exact; }
          .bg-slate-50\/80 { background-color: #f8fafc !important; -webkit-print-color-adjust: exact; }
          .text-indigo-600 { color: #4f46e5 !important; }
          .text-amber-500 { color: #f59e0b !important; }
          .bg-indigo-50\/50 { background-color: #f5f3ff !important; border-color: #e0e7ff !important; -webkit-print-color-exact: exact; }
        }
      `}</style>
      {typeof document !== 'undefined' && createPortal(<>
      <AnimatePresence>
        {selectedSlotForCard && (
          <div 
            onClick={() => setSelectedSlotForCard(null)}
            className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-md cursor-pointer"
          >
            <motion.div 
              onClick={(e) => e.stopPropagation()}
              initial={{ opacity: 0, y: 100 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 100 }}
              className="bg-slate-50 w-full h-full flex flex-col overflow-hidden relative cursor-default"
            >
              <div className="bg-indigo-600 p-8 text-white relative">
                <button 
                  onClick={() => setSelectedSlotForCard(null)}
                  className="absolute top-8 right-10 p-6 bg-white/10 hover:bg-white/20 text-white rounded-3xl transition-all z-30"
                >
                  <X size={48} />
                </button>
                <div className="max-w-7xl mx-auto w-full">
                  <p className="text-sm font-black uppercase tracking-[0.5em] opacity-70 mb-2">PANEL DE CONTROL OPERATIVO</p>
                  <h3 className="text-6xl font-black uppercase tracking-tighter">{selectedSlotForCard.label}</h3>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto custom-scrollbar p-6 md:p-12">
                <div className="max-w-7xl mx-auto w-full">
                {(() => {
                  const shiftStationKey = `${selectedSlotForCard.stationKey}_${activeShift}`;
                  const currentAssignee = getAssignee(activeDay, shiftStationKey);
                  const currentEmp = currentAssignee ? employees.find(e => String(e.id) === String(currentAssignee.employee_id)) : null;

                  if (currentEmp && !isReassigning) {
                    return (
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
                    <div className="lg:col-span-5 space-y-10">
                      <div className="bg-white p-10 rounded-[3rem] shadow-xl border border-slate-100 flex flex-col items-center text-center">
                        <div className="w-48 h-48 bg-indigo-600 rounded-[4rem] flex items-center justify-center text-7xl font-black text-white shadow-2xl shadow-indigo-200 italic mb-8">
                          {(currentEmp.chosen_name || currentEmp.first_name)?.[0]?.toUpperCase()}
                        </div>
                        <h4 className="text-5xl font-black text-slate-900 uppercase leading-tight mb-2">
                          {currentEmp.chosen_name || currentEmp.first_name}
                        </h4>
                        <p className="text-2xl font-bold text-slate-400 uppercase tracking-[0.3em]">
                          {currentEmp.last_name}
                        </p>
                      </div>
                      <div className="grid grid-cols-1 gap-4">
                        {currentEmp.phone && (
                          <a 
                            href={`tel:${currentEmp.phone}`}
                            className="flex items-center gap-8 p-8 bg-white rounded-[2.5rem] shadow-lg border border-slate-100 hover:border-indigo-300 transition-all group"
                          >
                            <div className="p-6 bg-indigo-50 rounded-3xl text-indigo-600 group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                              <Phone size={32} />
                            </div>
                            <div className="flex flex-col">
                              <span className="text-sm font-black text-slate-400 uppercase tracking-widest">Llamar Ahora</span>
                              <span className="text-3xl font-black text-slate-800">{currentEmp.phone}</span>
                            </div>
                          </a>
                        )}
                      </div>
                      <div className="flex flex-col gap-4 pt-6">
                        <button 
                          onClick={() => {
                            updateAssignment(formatDateISO(activeDay), selectedSlotForCard.stationKey || selectedSlotForCard.label, '', currentAssignee?.station_group || 'front');
                            setSelectedSlotForCard(null);
                          }}
                          className="w-full flex items-center justify-center gap-6 p-8 bg-red-500 text-white rounded-[2.5rem] font-black uppercase tracking-widest text-xl hover:bg-red-600 transition-all shadow-xl shadow-red-100"
                        >
                          <UserMinus size={32} />
                          Marcar como Ausente
                        </button>
                        <button 
                          onClick={() => setIsReassigning(true)}
                          className="w-full flex items-center justify-center gap-6 p-8 bg-indigo-600 text-white rounded-[2.5rem] font-black uppercase tracking-widest text-xl hover:bg-indigo-700 transition-all shadow-xl shadow-indigo-100"
                        >
                          <RefreshCw size={32} />
                          Cambiar Persona
                        </button>
                      </div>
                    </div>
                    <div className="lg:col-span-7">
                      <div className="bg-white p-10 rounded-[3rem] shadow-xl border border-slate-100 h-full">
                        <div className="flex items-center justify-between mb-8 pb-6 border-b border-slate-100">
                          <div className="flex items-center gap-4">
                            <div className="p-4 bg-indigo-600 text-white rounded-2xl shadow-lg shadow-indigo-100">
                              <ClipboardList size={32} />
                            </div>
                            <h5 className="text-2xl font-black text-slate-900 uppercase tracking-tight">Actividades del Día</h5>
                          </div>
                          <span className="bg-slate-100 text-slate-500 py-2 px-6 rounded-full text-sm font-black uppercase tracking-widest">
                            {format(activeDay, 'EEEE d', { locale: es })}
                          </span>
                        </div>
                        <div className="space-y-4">
                          {(() => {
                            const jsDay = activeDay.getDay();
                            const myDayIndex = jsDay === 0 ? 6 : jsDay - 1;
                            const liveTasks = [
                              ...(currentAssignee?.tasks || []),
                              ...(stationActivities[shiftStationKey] || []),
                              ...(stationActivities[`${shiftStationKey}_${myDayIndex}`] || [])
                            ];
                            const uniqueTasks = Array.from(new Set(liveTasks as string[])).filter(Boolean);
                            if (uniqueTasks.length > 0) {
                              const groupedTasks = uniqueTasks.reduce((acc: any, taskName: string) => {
                                const act = activities.find(a => a.name === taskName);
                                const category = act?.category || 'ESPECÍFICAS / OTRAS';
                                if (!acc[category]) acc[category] = [];
                                acc[category].push({ taskName, act });
                                return acc;
                              }, {});
                              return (
                                <div className="space-y-8">
                                  {Object.entries(groupedTasks).map(([category, tasks]: [string, any], idx) => (
                                    <div key={idx} className="space-y-4">
                                      <h6 className="text-xs font-black text-indigo-600 uppercase tracking-[0.2em] border-b-2 border-indigo-100 pb-3 pl-2 flex items-center gap-2">
                                        <div className="w-2 h-2 rounded-full bg-indigo-500 shadow-inner"></div>
                                        {category}
                                      </h6>
                                      <div className="space-y-3">
                                        {tasks.map(({ taskName, act }: any, i: number) => (
                                          <div key={i} className="flex items-center justify-between p-6 bg-slate-50 border border-slate-100 rounded-[1.5rem] group hover:bg-indigo-50 hover:border-indigo-100 transition-all shadow-sm">
                                            <div className="flex flex-col pr-4">
                                              <span className="text-xl font-black text-slate-800 uppercase tracking-tight mb-2 leading-none">{taskName}</span>
                                              {act && (act.startTime || act.endTime || act.schedule) && (
                                                <div className="flex items-center gap-2">
                                                  <Clock size={16} className="text-amber-500" />
                                                  <span className="text-sm font-black text-amber-600 uppercase tracking-[0.2em]">
                                                    {act.startTime ? `${formatTime12h(act.startTime)} - ${formatTime12h(act.endTime)}` : formatTime12h(act.schedule)}
                                                  </span>
                                                </div>
                                              )}
                                            </div>
                                            <CheckCircle2 size={32} className="text-indigo-300 group-hover:text-indigo-500 transition-colors shrink-0" />
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              );
                            }
                            return (
                              <div className="py-20 flex flex-col items-center justify-center opacity-30">
                                <ClipboardList size={80} className="mb-4" />
                                <p className="text-xl font-black text-slate-400 uppercase italic tracking-widest">Sin tareas asignadas</p>
                              </div>
                            );
                          })()}
                        </div>
                      </div>
                    </div>
                  </div>
                    );
                  }

                  return (
                  <div className="space-y-10 max-w-4xl mx-auto w-full">
                    <div className="flex items-center justify-between mb-4">
                       <h4 className="text-2xl font-black text-slate-400 uppercase tracking-[0.3em] italic">Select Replacement</h4>
                       {currentEmp && (
                         <button 
                           onClick={() => setIsReassigning(false)} 
                           className="text-xl font-bold text-indigo-600 hover:bg-indigo-50 px-6 py-3 rounded-2xl transition-all"
                         >
                           Back to profile
                         </button>
                       )}
                    </div>
                    <div className="max-h-[70vh] overflow-y-auto space-y-4 pr-4 custom-scrollbar">
                      <button 
                        onClick={() => {
                          updateAssignment(formatDateISO(activeDay), selectedSlotForCard.stationKey || selectedSlotForCard.label, '', currentAssignee?.station_group || 'front');
                          setSelectedSlotForCard(null);
                        }}
                        className="w-full p-8 rounded-[2.5rem] border-4 border-dashed border-slate-200 text-slate-400 font-black uppercase tracking-widest text-2xl hover:bg-slate-50 transition-all text-left flex items-center gap-8"
                      >
                         <X size={40} />
                         <span>Dejar Vacante (Libre)</span>
                      </button>
                      {employees.map(e => {
                        const shiftSuffix = `_${activeShift}`;
                        const isBusy = assignments.some(a => 
                           a.assignment_date === formatDateISO(activeDay) && 
                           a.sub_position.endsWith(shiftSuffix) && 
                           String(a.employee_id) === String(e.id)
                        );
                        if (isBusy && String(e.id) !== String(currentEmp?.id)) return null;
                        return (
                          <button 
                            key={e.id}
                            onClick={() => {
                              updateAssignment(formatDateISO(activeDay), selectedSlotForCard.stationKey || selectedSlotForCard.label, String(e.id), currentAssignee?.station_group || 'front');
                              setSelectedSlotForCard(null);
                            }}
                            className="w-full p-8 rounded-[3rem] bg-white border-2 border-slate-100 shadow-lg hover:border-indigo-500 hover:bg-indigo-50 transition-all text-left flex items-center gap-10 group"
                          >
                             <div className="w-24 h-24 bg-slate-50 rounded-[2rem] flex items-center justify-center text-4xl font-black text-slate-300 group-hover:text-indigo-600 shadow-inner">
                               {(e.chosen_name || e.first_name)?.[0]}
                             </div>
                             <div>
                               <p className="text-4xl font-black text-slate-900 uppercase leading-none mb-2">{(e.chosen_name || e.first_name)}</p>
                               <p className="text-xl font-bold text-slate-400 uppercase tracking-widest">{e.last_name}</p>
                             </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  );
                })()}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      </>, document.body)}

      <AnimatePresence>
        {showUnassignedActivitiesModal && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-md">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-slate-50 w-full max-w-5xl max-h-[90vh] rounded-[3rem] shadow-2xl flex flex-col overflow-hidden border border-slate-200"
            >
              <div className="p-8 border-b border-slate-200 flex justify-between items-center bg-white">
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 rounded-2xl bg-rose-100 flex items-center justify-center text-rose-500 shadow-inner">
                    <AlertTriangle size={32} />
                  </div>
                  <div>
                    <h3 className="text-3xl font-black text-slate-800 tracking-tight">Auditoría de Actividades</h3>
                    <p className="text-sm font-bold text-slate-400 uppercase tracking-widest mt-1">
                      Semana del {format(currentWeekStart, "d 'de' MMMM", { locale: es })}
                    </p>
                  </div>
                </div>
                <button 
                  onClick={() => setShowUnassignedActivitiesModal(false)} 
                  className="w-12 h-12 bg-white border-2 border-slate-200 text-slate-400 hover:text-red-500 hover:border-red-200 hover:bg-red-50 rounded-2xl flex items-center justify-center transition-all shadow-sm"
                >
                  <X size={24} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
                {(() => {
                  const shiftActivities = activities.filter(a => a.shift === activeShift || a.shift === 'AMBOS' || !a.shift);
                  const usageMap: Record<string, { assignedTo: string[], isUnassigned: boolean }> = {};
                  shiftActivities.forEach(act => {
                    usageMap[act.name] = { assignedTo: [], isUnassigned: true };
                  });
                  Object.entries(stationActivities).forEach(([key, tasks]) => {
                    tasks.forEach(taskName => {
                      if (usageMap[taskName]) {
                        const cleanKey = key.replace(/_(AM|PM)(_\d)?$/, ' ($1)');
                        const label = `Posición: ${cleanKey}`;
                        if (!usageMap[taskName].assignedTo.includes(label)) {
                          usageMap[taskName].assignedTo.push(label);
                          usageMap[taskName].isUnassigned = false;
                        }
                      }
                    });
                  });
                  assignments.forEach(assignment => {
                    if (assignment.tasks && Array.isArray(assignment.tasks)) {
                      assignment.tasks.forEach((taskName: string) => {
                        if (usageMap[taskName]) {
                          const employee = employees.find(e => e.id === assignment.employee_id);
                          const empName = employee ? `${employee.chosen_name || employee.first_name || ''} ${employee.last_name || ''}`.trim() : 'Desconocido';
                          const dayName = format(new Date(assignment.assignment_date), 'EEEE', { locale: es });
                          const label = `Empleado: ${empName} (${dayName})`;
                          if (!usageMap[taskName].assignedTo.includes(label)) {
                            usageMap[taskName].assignedTo.push(label);
                            usageMap[taskName].isUnassigned = false;
                          }
                        }
                      });
                    }
                  });
                  const unassigned = shiftActivities.filter(a => usageMap[a.name]?.isUnassigned);
                  const assigned = shiftActivities.filter(a => !usageMap[a.name]?.isUnassigned);
                  return (
                    <div className="space-y-12">
                      <div>
                        <div className="flex items-center gap-3 mb-6">
                          <h4 className="text-xl font-black text-rose-600 uppercase tracking-widest">Sin Asignar en esta Semana ({activeShift})</h4>
                          <span className="bg-rose-100 text-rose-600 px-3 py-1 rounded-full text-xs font-bold">{unassigned.length}</span>
                        </div>
                        {unassigned.length === 0 ? (
                          <div className="p-8 bg-emerald-50 rounded-3xl border border-emerald-200 text-center">
                            <CheckCircle2 size={40} className="text-emerald-500 mx-auto mb-3" />
                            <p className="text-emerald-700 font-bold">¡Excelente! Todas las actividades están siendo cubiertas.</p>
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {unassigned.map(act => (
                              <div key={act.id} className="p-5 bg-white border-2 border-rose-100 rounded-2xl shadow-sm hover:shadow-md transition-all">
                                <span className="text-[10px] font-black uppercase tracking-widest text-rose-400 mb-1 block">{act.category}</span>
                                <p className="text-sm font-black text-slate-800 leading-tight mb-3">{act.name}</p>
                                {act.shift && (
                                  <span className="inline-block px-2 py-1 bg-slate-100 text-slate-500 text-[10px] rounded-md font-bold uppercase">{act.shift}</span>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      <div>
                        <div className="flex items-center gap-3 mb-6">
                          <h4 className="text-lg font-black text-slate-400 uppercase tracking-widest">Actividades Asignadas</h4>
                          <span className="bg-slate-200 text-slate-500 px-3 py-1 rounded-full text-xs font-bold">{assigned.length}</span>
                        </div>
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                          {assigned.map(act => (
                            <div key={act.id} className="p-5 bg-white border border-slate-200 rounded-2xl flex flex-col gap-3 opacity-80 hover:opacity-100 transition-opacity">
                              <div>
                                <span className="text-[10px] font-black uppercase tracking-widest text-indigo-400 mb-1 block">{act.category}</span>
                                <p className="text-sm font-bold text-slate-700 leading-tight">{act.name}</p>
                              </div>
                              <div className="flex flex-wrap gap-2 mt-2 pt-3 border-t border-slate-100">
                                {usageMap[act.name]?.assignedTo.map((target, idx) => (
                                  <span key={idx} className="bg-indigo-50 text-indigo-600 text-[10px] px-2 py-1 rounded-md font-bold truncate max-w-full">
                                    {target}
                                  </span>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showSpecificTasksModal && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-md">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-slate-100 w-full max-w-[98vw] h-[95vh] rounded-[3rem] shadow-2xl flex overflow-hidden border border-slate-700 flex-col relative"
            >
              <AnimatePresence>
                {taskSelectorForAssign && (
                  <div className="absolute inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-8">
                    <motion.div 
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 20 }}
                      className="bg-white w-full max-w-4xl max-h-full rounded-[3rem] shadow-2xl flex flex-col overflow-hidden"
                    >
                      <div className="p-8 border-b border-slate-100 flex justify-between items-start bg-slate-50 gap-8">
                        <div className="flex-1">
                          <h3 className="text-3xl font-black text-slate-800 tracking-tight">Select Extra Task</h3>
                          <p className="text-sm font-bold text-slate-400 uppercase tracking-widest mt-1 mb-6">
                            Adding to: {taskSelectorForAssign.sub_position.replace(/_(AM|PM)$/, '')} ({taskSelectorForAssign.sub_position.includes('AM') ? 'AM' : 'PM'})
                          </p>
                          <div className="relative max-w-md">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                            <input 
                              type="text" 
                              placeholder="Search task or category..." 
                              className="w-full pl-12 pr-4 py-3 bg-white border-2 border-slate-200 rounded-2xl text-sm font-black text-slate-700 focus:ring-4 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all outline-none"
                              value={extraTaskSearchQuery}
                              onChange={e => setExtraTaskSearchQuery(e.target.value)}
                            />
                            {extraTaskSearchQuery && (
                              <button 
                                onClick={() => setExtraTaskSearchQuery('')}
                                className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500"
                              >
                                <X size={16} />
                              </button>
                            )}
                          </div>
                        </div>
                        <button 
                          onClick={() => {
                            setTaskSelectorForAssign(null);
                            setExtraTaskSearchQuery('');
                          }} 
                          className="w-12 h-12 shrink-0 bg-white border-2 border-slate-200 text-slate-400 hover:text-red-500 hover:border-red-200 hover:bg-red-50 rounded-2xl flex items-center justify-center transition-all shadow-sm"
                        >
                          <X size={24} />
                        </button>
                      </div>
                      <div className="p-6 overflow-y-auto bg-slate-100/50 flex-1">
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                          {activities.filter(act => 
                            act.name.toLowerCase().includes(extraTaskSearchQuery.toLowerCase()) || 
                            (act.category || '').toLowerCase().includes(extraTaskSearchQuery.toLowerCase())
                          ).map(act => {
                            const isSelected = (taskSelectorForAssign.tasks || []).includes(act.name);
                            return (
                              <button 
                                key={act.id}
                                onClick={() => toggleEmployeeSpecificTask(taskSelectorForAssign, act.name)}
                                className={`text-left p-5 rounded-[1.5rem] transition-all flex flex-col justify-between h-32 border-2 ${
                                  isSelected 
                                    ? 'bg-indigo-600 border-indigo-600 text-white shadow-lg shadow-indigo-200 scale-[1.02]' 
                                    : 'bg-white border-slate-100 hover:border-indigo-300 hover:bg-indigo-50 hover:shadow-md text-slate-700'
                                }`}
                              >
                                <span className={`text-[10px] font-black uppercase tracking-widest mb-2 ${isSelected ? 'text-indigo-200' : 'text-slate-400'}`}>{act.category}</span>
                                <div className="flex items-end justify-between w-full">
                                  <span className="text-sm font-black leading-tight uppercase flex-1 pr-2 line-clamp-3">{act.name}</span>
                                  {isSelected ? (
                                    <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center shrink-0">
                                      <CheckCircle2 size={16} className="text-white" />
                                    </div>
                                  ) : (
                                    <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center shrink-0 text-slate-300">
                                      <Plus size={16} />
                                    </div>
                                  )}
                                </div>
                              </button>
                            );
                          })}
                          {activities.filter(act => 
                            act.name.toLowerCase().includes(extraTaskSearchQuery.toLowerCase()) || 
                            (act.category || '').toLowerCase().includes(extraTaskSearchQuery.toLowerCase())
                          ).length === 0 && (
                            <div className="col-span-full p-12 text-center text-slate-400 font-bold text-lg">No tasks found matching that search.</div>
                          )}
                        </div>
                      </div>
                      <div className="p-6 bg-white border-t border-slate-100">
                        <button 
                          onClick={() => {
                            setTaskSelectorForAssign(null);
                            setExtraTaskSearchQuery('');
                          }}
                          className="w-full py-5 bg-slate-900 hover:bg-black text-white text-lg font-black rounded-2xl shadow-xl transition-all"
                        >
                          Hecho
                        </button>
                      </div>
                    </motion.div>
                  </div>
                )}
              </AnimatePresence>
              <div className="px-8 py-6 border-b border-slate-800 flex justify-between items-center bg-slate-900 shrink-0 text-white">
                <div className="flex items-center gap-6">
                  <div className="w-14 h-14 bg-indigo-500 rounded-[1.2rem] flex items-center justify-center shadow-lg shadow-indigo-500/20">
                    <ClipboardList size={28} className="text-white" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-black tracking-tight leading-none mb-1 text-white">Administrador de Tareas por Empleado</h2>
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Ajustes directos a la plantilla semanal</p>
                  </div>
                </div>
                <button 
                  onClick={() => setShowSpecificTasksModal(false)} 
                  className="w-12 h-12 bg-slate-800 text-slate-400 hover:text-white hover:bg-red-500 rounded-2xl flex items-center justify-center transition-all shadow-sm"
                >
                  <X size={24} />
                </button>
              </div>
              <div className="flex flex-1 overflow-hidden">
                <div className="w-[380px] bg-slate-800 flex flex-col shrink-0 z-10">
                  <div className="p-6 border-b border-slate-700">
                    <div className="relative">
                      <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                      <input 
                        type="text" 
                        placeholder="Buscar empleado..." 
                        className="w-full pl-12 pr-4 py-4 bg-slate-900/50 border border-slate-600 rounded-2xl text-sm font-black text-white placeholder-slate-500 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all outline-none"
                        value={specificTasksSearch}
                        onChange={e => setSpecificTasksSearch(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto p-4 space-y-2 custom-scrollbar">
                    {employees.filter(e => ((e.chosen_name || e.first_name) || '').toLowerCase().includes(specificTasksSearch.toLowerCase()) || (e.last_name || '').toLowerCase().includes(specificTasksSearch.toLowerCase())).map(emp => {
                      const empAssignments = assignments.filter(a => a.employee_id === String(emp.id));
                      const taskCount = empAssignments.reduce((acc, a) => acc + (a.tasks?.length || 0), 0);
                      const isSelected = specificTasksEmployeeId === String(emp.id);
                      return (
                        <button 
                          key={emp.id}
                          onClick={() => setSpecificTasksEmployeeId(String(emp.id))}
                          className={`w-full flex items-center gap-4 px-5 py-4 rounded-2xl transition-all border ${
                            isSelected
                              ? 'bg-indigo-600 border-indigo-500 text-white shadow-xl' 
                              : 'bg-slate-800/50 border-slate-700/50 hover:bg-slate-700 hover:border-slate-600 text-slate-300'
                          }`}
                        >
                          <div className={`w-12 h-12 rounded-xl flex flex-col items-center justify-center shrink-0 ${isSelected ? 'bg-white/20 text-white' : 'bg-slate-900 text-slate-500'}`}>
                            <User size={20} />
                          </div>
                          <div className="text-left flex-1 overflow-hidden">
                            <span className={`font-black block truncate text-[15px] ${isSelected ? 'text-white' : 'text-slate-100'}`}>
                              {emp.chosen_name || emp.first_name} {emp.last_name}
                            </span>
                            <span className={`text-[10px] font-black uppercase tracking-widest mt-0.5 block ${isSelected ? 'text-indigo-200' : 'text-slate-500'}`}>
                              {empAssignments.length} turnos • {taskCount} extras
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto p-8 lg:p-12 relative bg-slate-100">
                  {!specificTasksEmployeeId ? (
                    <div className="h-full flex flex-col items-center justify-center text-slate-400">
                      <div className="w-32 h-32 bg-slate-200 rounded-full flex items-center justify-center shadow-inner mb-6">
                        <User size={64} className="text-slate-300" />
                      </div>
                      <h3 className="text-3xl font-black text-slate-400">Selecciona un Empleado</h3>
                      <p className="font-bold mt-2 text-slate-500 text-lg">Su calendario de actividades de la semana aparecerá aquí.</p>
                    </div>
                  ) : (() => {
                    const emp = employees.find(e => String(e.id) === specificTasksEmployeeId);
                    return (
                      <div className="space-y-8 h-full flex flex-col">
                        <div className="flex justify-between items-center bg-white p-6 md:p-8 rounded-[2.5rem] shadow-sm border border-slate-200/60 shrink-0">
                          <div className="flex items-center gap-6">
                            <div className="w-20 h-20 bg-gradient-to-br from-indigo-500 to-indigo-700 text-white rounded-[2rem] flex items-center justify-center shadow-xl shadow-indigo-200">
                              <span className="text-3xl font-black">{(emp?.chosen_name || emp?.first_name)?.[0]}</span>
                            </div>
                            <div>
                              <h3 className="text-4xl font-black text-slate-800 tracking-tight leading-none mb-2">{emp?.chosen_name || emp?.first_name} {emp?.last_name}</h3>
                              <p className="text-sm font-black text-indigo-500 uppercase tracking-widest">Semana del {format(getMonday(currentWeekStart), "d 'de' MMMM", { locale: es })}</p>
                            </div>
                          </div>
                          <button onClick={saveAssignments} className="bg-slate-900 text-white px-8 py-5 rounded-[1.5rem] font-black hover:bg-black transition-all shadow-xl active:scale-95 flex items-center gap-3">
                            {saving ? <Loader2 size={20} className="animate-spin" /> : <Save size={20} />}
                            <span className="tracking-wide">Guardar Base de Datos</span>
                          </button>
                        </div>
                        <div className="flex-1 grid grid-cols-1 lg:grid-cols-7 gap-3 xl:gap-5 min-h-0">
                          {weekDays.map(day => {
                            const dateStr = formatDateISO(day);
                            const dayAssignments = assignments.filter(a => a.assignment_date === dateStr && a.employee_id === specificTasksEmployeeId);
                            const isToday = isSameDay(day, new Date());
                            return (
                              <div key={dateStr} className={`rounded-[2.5rem] border overflow-hidden flex flex-col transition-all ${isToday ? 'bg-indigo-50 border-indigo-200 shadow-lg shadow-indigo-100/50' : 'bg-white border-slate-200 shadow-sm'}`}>
                                <div className={`p-4 text-center border-b flex flex-col items-center justify-center gap-0.5 ${isToday ? 'bg-indigo-600 border-indigo-600 text-white shadow-md' : 'bg-slate-50 border-slate-100'}`}>
                                  <span className={`block text-[10px] font-black uppercase tracking-widest ${isToday ? 'text-indigo-200' : 'text-slate-400'}`}>{format(day, 'EEEE', { locale: es })}</span>
                                  <span className={`text-4xl font-black ${isToday ? 'text-white' : 'text-slate-800'}`}>{format(day, 'dd')}</span>
                                </div>
                                <div className="p-3 xl:p-4 flex-1 overflow-y-auto">
                                  {dayAssignments.length === 0 ? (
                                    <div className={`h-full flex items-center justify-center text-center p-4 border-2 border-dashed rounded-[2rem] ${isToday ? 'border-indigo-200 bg-white' : 'border-slate-200 bg-slate-50/50'}`}>
                                      <span className="text-[10px] font-black text-slate-300 uppercase tracking-widest rotate-[-15deg] opacity-70">Libre</span>
                                    </div>
                                  ) : (
                                    <div className="space-y-4">
                                      {dayAssignments.map((assign, idx) => {
                                        const isAM = assign.sub_position.includes('AM');
                                        const cleanPositionName = assign.sub_position.replace(/_(AM|PM)$/, '');
                                        return (
                                          <div key={idx} className="bg-white border-2 border-slate-100 rounded-[2rem] p-4 shadow-sm hover:shadow-md transition-all group/card">
                                            <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-100">
                                              <div className="flex-1 overflow-hidden pr-2">
                                                <span className="text-[10px] font-black text-slate-800 uppercase tracking-widest leading-none truncate block w-full" title={cleanPositionName}>
                                                  {cleanPositionName}
                                                </span>
                                              </div>
                                              <span className={`px-2 py-1 rounded-md text-[9px] font-black tracking-widest shrink-0 ${isAM ? 'bg-amber-100 text-amber-700' : 'bg-indigo-100 text-indigo-700'}`}>
                                                {isAM ? 'AM' : 'PM'}
                                              </span>
                                            </div>
                                            <div className="space-y-2 mb-4">
                                              {(assign.tasks || []).map((t: string) => (
                                                <div key={t} className="flex justify-between items-center group/task bg-slate-50 hover:bg-slate-100 p-3 rounded-xl border border-slate-100 transition-all">
                                                  <span className="text-[10px] font-black text-slate-700 uppercase leading-snug flex-1 pr-2 truncate" title={t}>{t}</span>
                                                  <button 
                                                    onClick={() => toggleEmployeeSpecificTask(assign, t)}
                                                    className="w-6 h-6 bg-white border border-slate-200 text-slate-400 hover:bg-red-500 hover:text-white hover:border-red-500 rounded-lg flex items-center justify-center transition-all shadow-sm shrink-0 opacity-0 group-hover/task:opacity-100"
                                                  >
                                                    <X size={12} />
                                                  </button>
                                                </div>
                                              ))}
                                              {(!assign.tasks || assign.tasks.length === 0) && (
                                                <div className="h-12 flex items-center justify-center border border-dashed border-slate-200 rounded-xl bg-slate-50">
                                                  <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">+ 0 Extras</span>
                                                </div>
                                              )}
                                            </div>
                                            <button 
                                              onClick={() => setTaskSelectorForAssign(assign)}
                                              className="w-full py-3 bg-slate-50 hover:bg-indigo-600 text-slate-600 hover:text-white text-[10px] font-black uppercase tracking-widest rounded-xl transition-all border border-slate-200 hover:border-indigo-600 flex items-center justify-center gap-2 shadow-sm"
                                            >
                                              <Plus size={14} />
                                              Asignar
                                            </button>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showActivitiesModal && (
          <div className="fixed inset-0 z-[150] flex items-center justify-center p-2 md:p-8 bg-slate-900/40 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }} 
              animate={{ opacity: 1, scale: 1, y: 0 }} 
              exit={{ opacity: 0, scale: 0.9, y: 20 }} 
              className="bg-white w-full max-w-6xl max-h-[95vh] md:max-h-[90vh] rounded-[2rem] md:rounded-[3rem] border border-black/5 shadow-2xl flex flex-col overflow-hidden relative"
            >
              <div className="p-5 md:p-8 pb-4 border-b border-slate-100 flex items-center justify-between bg-white z-20">
                <div className="flex items-center gap-4 md:gap-5">
                  <div className="bg-slate-900 text-white p-3 md:p-4 rounded-[1.2rem] md:rounded-[1.5rem] shadow-lg shadow-slate-200 shrink-0">
                    <FileText size={24} className="md:w-7 md:h-7" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-xl md:text-2xl font-bold text-slate-900 tracking-tight truncate">Centro de Control</h3>
                    <div className="flex items-center gap-3 mt-0.5">
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Librería Operativa GAVILÁN</p>
                    </div>
                  </div>
                </div>
                <button 
                  onClick={() => setShowActivitiesModal(false)} 
                  className="p-3 hover:bg-red-50 hover:text-red-600 rounded-[1.2rem] transition-all text-slate-400"
                >
                  <X size={22} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto lg:overflow-hidden flex flex-col lg:flex-row">
                <div className="w-full lg:w-[450px] shrink-0 bg-slate-50/50 p-6 md:p-8 lg:border-r lg:border-slate-100 overflow-y-auto custom-scrollbar">
                  <h4 className="text-[11px] font-bold text-indigo-600 uppercase tracking-widest mb-6">Editor de Tareas</h4>
                  <div className="space-y-6">
                    <div className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm space-y-5">
                      <div>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2.5 ml-2">Nombre</label>
                        <input 
                          type="text" 
                          placeholder="Ej: Limpieza Planchas" 
                          value={newActivity.name} 
                          onChange={(e) => setNewActivity({...newActivity, name: e.target.value})} 
                          className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-5 py-4 text-sm font-bold text-slate-900 outline-none focus:ring-4 focus:ring-indigo-500/10 transition-all placeholder:text-slate-300"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 ml-2">Turno</label>
                        <select 
                          value={newActivity.shift || 'AM'}
                          onChange={(e) => setNewActivity({...newActivity, shift: e.target.value})}
                          className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-4 py-4 text-sm font-bold text-slate-900 outline-none focus:ring-4 focus:ring-indigo-500/10 transition-all appearance-none cursor-pointer"
                        >
                          <option value="AM">☀️ AM</option>
                          <option value="PM">🌙 PM</option>
                          <option value="AMBOS">⚡ AMBOS</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 ml-2">Categoría</label>
                        <select 
                          value={newActivity.category}
                          onChange={(e) => setNewActivity({...newActivity, category: e.target.value})}
                          className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-4 py-4 text-sm font-bold text-slate-900 outline-none focus:ring-4 focus:ring-indigo-500/10 transition-all appearance-none cursor-pointer"
                        >
                          <option value="APERTURA">🌄 APERTURA</option>
                          <option value="CIERRE">🌙 CIERRE</option>
                          <option value="ACTIVIDAD REGULAR">⚡ ACTIVIDAD REGULAR</option>
                          <option value="OTRO">⚙️ OTRO</option>
                        </select>
                      </div>
                    </div>
                    <div className="flex flex-col gap-3 pb-8 lg:pb-0">
                      <button 
                        onClick={() => finalizeSaveActivity()}
                        className={`w-full py-5 rounded-[1.5rem] transition-all shadow-lg flex items-center justify-center gap-4 group active:scale-95 bg-slate-900 hover:bg-black text-white`}
                      >
                        <Save size={18} />
                        <span className="text-[10px] font-black uppercase tracking-widest">
                          {editingActivityId ? 'Actualizar Tarea' : 'Registrar Actividad'}
                        </span>
                      </button>
                    </div>
                  </div>
                </div>

                <div className="flex-1 p-6 md:p-8 lg:overflow-y-auto custom-scrollbar bg-white">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
                    <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">Listado de la Librería</h4>
                    <div className="flex items-center gap-2">
                      <input 
                        type="text" 
                        placeholder="BUSCAR TAREA..." 
                        value={activitySearchQuery}
                        onChange={(e) => setActivitySearchQuery(e.target.value)}
                        className="bg-slate-50 border border-slate-200 rounded-full px-4 py-2 text-[10px] font-black uppercase tracking-widest outline-none focus:ring-4 focus:ring-indigo-500/10 transition-all w-64"
                      />
                    </div>
                  </div>
                  <div className="space-y-12">
                    {activities.length === 0 ? (
                      <div className="text-center py-20 bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200 text-slate-400 italic text-sm p-6">
                        {t('roles_hub.no_catalog_activities')}
                      </div>
                    ) : (() => {
                      const filteredActs = activities.filter(act => {
                        if (activitySearchQuery) {
                          const query = activitySearchQuery.toLowerCase();
                          return act.name.toLowerCase().includes(query) || (act.category || '').toLowerCase().includes(query);
                        }
                        return true;
                      });

                      return ['APERTURA', 'CIERRE', 'ACTIVIDAD REGULAR', 'OTRO'].map(cat => {
                        const acts = filteredActs.filter(a => a.category === cat);
                        if (acts.length === 0) return null;
                        return (
                          <div key={cat} className="space-y-4">
                            <h4 className="text-[11px] font-bold text-indigo-600 uppercase tracking-widest border-b border-indigo-100 pb-2">{cat}</h4>
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                              {acts.map((act) => (
                                <div key={act.id} className="group flex items-center justify-between p-5 rounded-[2rem] border border-slate-100 bg-white hover:bg-slate-50 transition-all">
                                  <div className="flex flex-col">
                                    <span className="text-sm font-bold text-slate-900">{act.name}</span>
                                    <span className="text-[9px] font-black text-indigo-400 uppercase">{act.shift}</span>
                                  </div>
                                  <div className="flex gap-1">
                                    <button onClick={() => { setEditingActivityId(act.id); setNewActivity({ name: act.name, category: act.category, startTime: act.startTime || '', endTime: act.endTime || '', shift: act.shift || 'AM' }); }} className="p-3 text-slate-300 hover:text-indigo-600 rounded-xl"><RefreshCw size={16} /></button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      });
                    })()}
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* --- STATION ACTIVITIES ASSIGNMENT MODAL --- */}
      <AnimatePresence>
        {showStationActivitiesModal && (
          <div className="fixed inset-0 z-[150] flex items-center justify-center p-2 md:p-8 bg-slate-900/40 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }} 
              animate={{ opacity: 1, scale: 1 }} 
              exit={{ opacity: 0, scale: 0.9 }} 
              className="bg-white w-full max-w-4xl max-h-[95vh] md:max-h-[90vh] flex flex-col rounded-[2rem] md:rounded-[3rem] border border-black/5 shadow-2xl relative overflow-hidden"
            >
              <div className="p-5 md:p-8 border-b border-slate-100 flex items-center justify-between shrink-0 bg-white">
                <div className="flex items-center gap-4 md:gap-5">
                  <div className="bg-indigo-50 text-indigo-600 p-3 md:p-4 rounded-2xl md:rounded-3xl shrink-0">
                    <ClipboardList size={24} className="md:w-8 md:h-8" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-xl md:text-2xl font-bold text-slate-900 tracking-tight uppercase truncate">Asignar Tareas</h3>
                    <p className="text-[10px] md:text-xs font-medium text-slate-400 mt-1 uppercase tracking-widest truncate">Posición: {showStationActivitiesModal}</p>
                  </div>
                </div>
                <button onClick={() => setShowStationActivitiesModal(null)} className="p-3 hover:bg-slate-50 rounded-2xl transition-colors text-slate-400 shrink-0">
                  <X size={24} />
                </button>
              </div>

              <div className="p-5 md:p-8 overflow-y-auto custom-scrollbar flex-1 bg-white">
                <div className="bg-slate-50 p-6 rounded-[2rem] mb-8 border border-slate-100 flex flex-col gap-4">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex flex-col">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-2">Frecuencia de Tareas</span>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {['DIARIO', 'L', 'M', 'M', 'J', 'V', 'S', 'D'].map((d, i) => {
                        const dayVal = d === 'DIARIO' ? 'DIARIO' : (i - 1).toString();
                        const isActive = assignmentDay.includes(dayVal);
                        return (
                          <button
                            key={d + i}
                            onClick={() => {
                              if (dayVal === 'DIARIO') {
                                setAssignmentDay(['DIARIO']);
                              } else {
                                let next = assignmentDay.filter(x => x !== 'DIARIO');
                                if (next.includes(dayVal)) {
                                  next = next.filter(x => x !== dayVal);
                                } else {
                                  next.push(dayVal);
                                }
                                setAssignmentDay(next.length === 0 ? ['DIARIO'] : next);
                              }
                            }}
                            className={`h-10 flex items-center justify-center text-[11px] font-black transition-all ${
                              isActive 
                                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-100 scale-105' 
                                : 'bg-white text-slate-400 hover:bg-indigo-50 hover:text-indigo-600 border border-slate-200'
                            } ${d === 'DIARIO' ? 'px-8 rounded-xl' : 'w-10 rounded-full'}`}
                          >
                            {d}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
                <div className="max-h-[500px] overflow-y-auto pr-4 custom-scrollbar">
                  {activities.length === 0 ? (
                    <div className="text-center py-10 bg-slate-50 rounded-3xl border border-slate-200 border-dashed">
                      <p className="text-slate-400 italic text-sm">Primero crea actividades en la Librería Maestra.</p>
                    </div>
                  ) : (() => {
                    const shiftStationKey = `${showStationActivitiesModal}_${activeShift}`;
                    const firstDay = assignmentDay[0];
                    const firstKey = firstDay === 'DIARIO' ? shiftStationKey : `${shiftStationKey}_${firstDay}`;
                    
                    const filteredActivities = activities.filter(a => (a.shift === activeShift || a.shift === 'AMBOS' || !a.shift));
                    const selectedActs = filteredActivities.filter(act => stationActivities[firstKey]?.includes(act.name));
                    const availableActs = filteredActivities.filter(act => !stationActivities[firstKey]?.includes(act.name));

                    const renderActivityButton = (act: any, isSelected: boolean) => (
                      <button 
                        key={act.id || act.name}
                        onClick={() => {
                          const newState = !isSelected;
                          setStationActivities(prev => {
                            const newMappings = { ...prev };
                            assignmentDay.forEach(day => {
                              const currentShiftKey = day === 'DIARIO' ? shiftStationKey : `${shiftStationKey}_${day}`;
                              const oppositeShift = activeShift === 'AM' ? 'PM' : 'AM';
                              const oppositeShiftStationKey = `${showStationActivitiesModal}_${oppositeShift}`;
                              const oppositeShiftKey = day === 'DIARIO' ? oppositeShiftStationKey : `${oppositeShiftStationKey}_${day}`;
                              [currentShiftKey, oppositeShiftKey].forEach(storageKey => {
                                const current = newMappings[storageKey] || [];
                                if (newState) {
                                  if (!current.includes(act.name)) newMappings[storageKey] = [...current, act.name];
                                } else {
                                  newMappings[storageKey] = current.filter((a: string) => a !== act.name);
                                }
                              });
                            });
                            return newMappings;
                          });
                        }}
                        className={`flex items-center justify-between p-6 rounded-[2rem] border-2 transition-all text-left ${
                          isSelected ? 'bg-indigo-600 border-indigo-600 text-white shadow-xl shadow-indigo-100' : 'bg-white border-slate-100 text-slate-600 hover:border-indigo-300'
                        }`}
                      >
                        <div className="flex flex-col items-start w-full pr-4">
                          <span className={`text-[10px] font-black uppercase tracking-widest mb-1 ${isSelected ? 'text-white/40' : 'text-slate-400'}`}>{act.category}</span>
                          <span className="text-lg font-black uppercase tracking-tight break-words">{act.name}</span>
                        </div>
                        {isSelected ? <CheckCircle2 size={32} className="shrink-0" /> : <div className="w-8 h-8 rounded-full border-4 border-slate-50 shadow-inner shrink-0" />}
                      </button>
                    );

                    return (
                      <div className="space-y-8">
                        {selectedActs.length > 0 && (
                          <div className="space-y-4">
                            <h4 className="text-[11px] font-black text-indigo-600 uppercase tracking-widest flex items-center gap-2 border-b border-indigo-100 pb-2">
                              <CheckCircle2 size={14} />
                              Tareas Asignadas ({selectedActs.length})
                            </h4>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              {selectedActs.map(act => renderActivityButton(act, true))}
                            </div>
                          </div>
                        )}
                        
                        {availableActs.length > 0 && (
                          <div className="space-y-4">
                            <h4 className="text-[11px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2 border-b border-slate-100 pb-2">
                              <ClipboardList size={14} />
                              Tareas Disponibles ({availableActs.length})
                            </h4>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              {availableActs.map(act => renderActivityButton(act, false))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              </div>
              
              <div className="p-5 md:p-8 pt-4 border-t border-slate-100 shrink-0 bg-white z-10">
                <button 
                  onClick={() => setShowStationActivitiesModal(null)}
                  className="w-full bg-slate-900 text-white py-4 rounded-2xl font-black uppercase tracking-[0.2em] text-[11px] shadow-xl hover:bg-black transition-all"
                >
                  Save Station Configuration
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {duplicateWarning && (
          <div className="fixed inset-0 z-[300] flex items-center justify-center p-6 bg-slate-900/60 backdrop-blur-md">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white w-full max-w-md rounded-[2.5rem] p-10 shadow-2xl border border-white/20 text-center"
            >
              <div className="w-20 h-20 bg-amber-100 text-amber-600 rounded-[2rem] flex items-center justify-center mx-auto mb-8 shadow-inner">
                <AlertTriangle size={40} />
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-4 tracking-tight">Posible Actividad Duplicada</h3>
              <p className="text-sm text-slate-500 leading-relaxed mb-8 text-balance">
                Ya existe una actividad muy similar llamada <span className="font-bold text-slate-900">&ldquo;{duplicateWarning.existing.name}&rdquo;</span> en la categoría <span className="font-bold text-indigo-600">{duplicateWarning.existing.category}</span>.
              </p>
              
              <div className="space-y-3">
                <button 
                  onClick={() => setDuplicateWarning(null)}
                  className="w-full bg-slate-900 text-white py-4 rounded-2xl font-bold text-sm shadow-xl shadow-slate-200 transition-all hover:bg-slate-800"
                >
                  Entendido, usaré la existente
                </button>
                <button 
                  onClick={() => {
                    setDuplicateWarning(null);
                    finalizeSaveActivity(true);
                  }}
                  className="w-full bg-slate-50 text-slate-400 py-4 rounded-2xl font-bold text-xs transition-all hover:bg-red-50 hover:text-red-500"
                >
                  No, crear &ldquo;{duplicateWarning.newName}&rdquo; de todos modos
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

