'use client';

/**
 * @module AsignacionDiariaTab
 * @description Tab de asignación diaria de empleados a estaciones/posiciones operativas.
 *   Permite a los managers asignar personal a cada estación de trabajo por día y turno,
 *   visualizando un mapa de estaciones con actividades (checklist) provenientes de position_activities.
 * @businessRules
 *   - El día laboral inicia a las 6:00 AM y finaliza a las 5:59 AM del día siguiente.
 *   - El turno PM inicia a las 5:00 PM.
 *   - Los empleados se filtran por store_id (Toast GUID) y se cruzan con shifts del día seleccionado.
 *   - Estaciones vacantes se muestran pulsando en rojo para llamar la atención.
 *   - Las actividades de cada estación se resuelven dinámicamente desde position_activities.
 * @dataFlow
 *   - stores → Supabase table `stores` → resolución a external_id (Toast GUID)
 *   - shifts → Supabase table `shifts` WHERE store_id=guid AND shift_date=selectedDate
 *   - assignments → GET /api/roles?store_id=guid&start_date=date&end_date=date
 *   - position_activities → GET /api/roles/activities
 *   - save → POST /api/roles { assignments[], store_id, start_date, end_date, active_shift }
 * @notes
 *   - Usa `supabase` importado directamente de @/lib/supabase para queries client-side.
 *   - El componente exporta default y no recibe props.
 *   - i18n keys bajo namespace `actividades.daily.*` — deben agregarse a i18n.tsx por el agente padre.
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Building2,
  ChevronLeft,
  ChevronRight,
  Save,
  Search,
  Users,
  ChefHat,
  Monitor,
  Crown,
  Car,
  Clock,
  Loader2,
  Sun,
  Moon,
  CheckCircle2,
  ChevronDown,
  UserCheck,
  AlertCircle,
  LayoutTemplate,
  X,
  Phone,
  UserMinus,
  RefreshCw,
  Copy,
  ClipboardList,
  Calendar,
} from 'lucide-react';
import { useLanguage } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';
import {
  startOfWeek,
  addDays,
  subDays,
  format,
  isSameDay,
  subWeeks,
  addWeeks,
} from 'date-fns';
import { es, enUS } from 'date-fns/locale';

// ════════════════════════════════════════════════════════════════════
// TYPES
// ════════════════════════════════════════════════════════════════════

interface Store {
  id: number;
  name: string;
  external_id: string;
}

interface ShiftRecord {
  id: string;
  employee_id: string;
  store_id: string;
  shift_date: string;
  start_time: string;
  end_time: string;
  is_callback: boolean;
}

interface Employee {
  id: string;
  first_name: string;
  last_name: string;
  chosen_name?: string;
  email?: string;
  deleted: boolean;
  store_ids: string[] | string;
  job_references?: Array<{ guid: string; title: string }>;
}

interface Assignment {
  store_id: string;
  employee_id: string;
  assignment_date: string;
  main_station: string;
  sub_position: string;
  station_group: string;
  tasks: string[];
}

interface PositionActivity {
  id: string;
  position_key: string;
  shift: string;
  activity_id: string;
  frequency: string;
  store_model: string;
  sort_order: number;
  operating_procedures?: {
    id: string;
    activity: string;
    start_time: string;
    duration_minutes: number;
    shift_type: string;
    frequency: string;
    role: string;
    description: string;
  };
}

// ════════════════════════════════════════════════════════════════════
// CONSTANTS
// ════════════════════════════════════════════════════════════════════

const SECTIONS = [
  {
    id: 'front',
    titleKey: 'actividades.daily.section_salon',
    color: 'blue',
    Icon: Monitor,
    stations: [
      'Caja 1 / Salón',
      'Caja 2',
      'Caja 3',
      'Uber + Salsas',
      'ENTREGA',
      'LIMPIEZA',
      'CUBRIR DESCANSOS (SALÓN)',
    ],
  },
  {
    id: 'kitchen',
    titleKey: 'actividades.daily.section_kitchen',
    color: 'amber',
    Icon: ChefHat,
    stations: [
      'TACOS',
      'CARNES',
      'BURRITOS',
      'TORTILLAS',
      'TORTAS/QUESADILLAS',
      'PREPARACION',
      'ACTIVIDADES EXTRA 1',
      'ACTIVIDADES EXTRA 2',
      'ACTIVIDADES EXTRA 3',
      'ACTIVIDADES EXTRA 4',
      'ACTIVIDADES EXTRA 5',
      'ACTIVIDADES EXTRA 6',
    ],
  },
  {
    id: 'leadership',
    titleKey: 'actividades.daily.section_leadership',
    color: 'purple',
    Icon: Crown,
    stations: [
      'MANAGER',
      'ASSISTANT',
      'SHIFT_LEADER_MALE',
      'SHIFT_LEADER_FEMALE',
    ],
  },
  {
    id: 'drive-thru',
    titleKey: 'actividades.daily.section_drivethru',
    color: 'emerald',
    Icon: Car,
    stations: ['Ventana 1', 'Ventana 2'],
    collapsible: true,
  },
];

const SECTION_COLORS: Record<string, { bg: string; border: string; badge: string; text: string; gradient: string }> = {
  blue: {
    bg: 'bg-blue-50 dark:bg-blue-950/30',
    border: 'border-blue-200 dark:border-blue-800/50',
    badge: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300',
    text: 'text-blue-700 dark:text-blue-300',
    gradient: 'from-blue-500 to-cyan-500',
  },
  amber: {
    bg: 'bg-amber-50 dark:bg-amber-950/30',
    border: 'border-amber-200 dark:border-amber-800/50',
    badge: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300',
    text: 'text-amber-700 dark:text-amber-300',
    gradient: 'from-amber-500 to-orange-500',
  },
  purple: {
    bg: 'bg-purple-50 dark:bg-purple-950/30',
    border: 'border-purple-200 dark:border-purple-800/50',
    badge: 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300',
    text: 'text-purple-700 dark:text-purple-300',
    gradient: 'from-purple-500 to-fuchsia-500',
  },
  emerald: {
    bg: 'bg-emerald-50 dark:bg-emerald-950/30',
    border: 'border-emerald-200 dark:border-emerald-800/50',
    badge: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300',
    text: 'text-emerald-700 dark:text-emerald-300',
    gradient: 'from-emerald-500 to-teal-500',
  },
};

const DAY_LABELS_KEYS = [
  'actividades.daily.day_mon',
  'actividades.daily.day_tue',
  'actividades.daily.day_wed',
  'actividades.daily.day_thu',
  'actividades.daily.day_fri',
  'actividades.daily.day_sat',
  'actividades.daily.day_sun',
];

// ════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════

/** Get the Los Angeles time right now */
const getLATime = (): Date => {
  return new Date(
    new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })
  );
};

/** Determine business-day-adjusted "today" (business day starts at 6AM) */
const getBusinessToday = (): Date => {
  const la = getLATime();
  if (la.getHours() < 6) {
    la.setDate(la.getDate() - 1);
  }
  return new Date(la.getFullYear(), la.getMonth(), la.getDate());
};

/** Format date as YYYY-MM-DD */
const formatDateISO = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

/** Detect shift from ISO start_time */
const getShiftFromTime = (startTimeStr: string): 'AM' | 'PM' => {
  if (!startTimeStr) return 'AM';
  try {
    if (startTimeStr.includes(':') && !startTimeStr.includes('T')) {
      const hour = parseInt(startTimeStr.split(':')[0], 10);
      return hour >= 17 || hour < 6 ? 'PM' : 'AM';
    }
    const date = new Date(startTimeStr);
    const hour = date.getHours();
    return hour >= 17 || hour < 6 ? 'PM' : 'AM';
  } catch {
    return 'AM';
  }
};

/** Format ISO time to "8:00 AM" style */
const formatTimeTo12h = (isoTime: string): string => {
  if (!isoTime) return '';
  try {
    const d = new Date(isoTime);
    let h = d.getHours();
    const m = d.getMinutes();
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${h}:${String(m).padStart(2, '0')} ${ampm}`;
  } catch {
    // fallback for raw HH:MM:SS
    const parts = isoTime.split(':');
    if (parts.length >= 2) {
      let h = parseInt(parts[0], 10);
      const m = parts[1];
      const ampm = h >= 12 ? 'PM' : 'AM';
      h = h % 12 || 12;
      return `${h}:${m} ${ampm}`;
    }
    return isoTime;
  }
};

/** Get a deterministic gradient from an employee name for the initials circle */
const getInitialsGradient = (name: string): string => {
  const gradients = [
    'from-blue-500 to-cyan-400',
    'from-purple-500 to-pink-400',
    'from-orange-500 to-red-400',
    'from-emerald-500 to-teal-400',
    'from-indigo-500 to-purple-400',
    'from-rose-500 to-orange-400',
    'from-fuchsia-500 to-purple-400',
    'from-amber-500 to-yellow-400',
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return gradients[Math.abs(hash) % gradients.length];
};

/** Get initials from first+last name */
const getInitials = (emp: Employee): string => {
  const first = emp.chosen_name || emp.first_name || '';
  const last = emp.last_name || '';
  return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();
};

/** Get display name */
const getDisplayName = (emp: Employee): string => {
  const first = emp.chosen_name || emp.first_name || '';
  const last = emp.last_name || '';
  return `${first} ${last}`.trim();
};

/** Format store name (strip "Tacos Gavilan" prefix) */
const formatStoreName = (name: string | null | undefined): string => {
  if (!name) return '';
  return name.replace(/^Tacos Gavilan\s+/i, '').trim();
};

/** Resolve section group from station name */
const getSectionForStation = (stationName: string): string => {
  for (const section of SECTIONS) {
    if (section.stations.includes(stationName)) return section.id;
  }
  return 'front';
};

// ════════════════════════════════════════════════════════════════════
// SUB-COMPONENTE PARA EL TABLERO VISUAL
// ════════════════════════════════════════════════════════════════════
interface BoardSlotProps {
  label: string;
  stationKey: string;
  group: string;
  assignee: any;
  employees: Employee[];
  className?: string;
  onClick: (stationKey: string, label: string, group: string, emp: any, assignee: any) => void;
  hasDriveThru?: boolean;
}

const BoardSlot: React.FC<BoardSlotProps> = ({
  label,
  stationKey,
  group,
  assignee,
  employees,
  className = '',
  onClick,
  hasDriveThru = true,
}) => {
  const { t } = useLanguage();
  const emp = assignee
    ? employees.find((e) => String(e.id) === String(assignee.employee_id))
    : null;

  const sUpper = stationKey?.toUpperCase();
  const isGreenGroup = sUpper === 'ENTREGA' || sUpper === 'TORTILLAS';
  const isYellowGroup =
    sUpper === 'CAJA 2' ||
    sUpper === 'VENTANA 2' ||
    sUpper === 'VENTANILLA 2' ||
    sUpper === 'VENTANA 2 (B)';

  const paddingClass = hasDriveThru ? 'p-[0.8vh] sm:p-[1.2vh]' : 'p-[1.4vh] sm:p-[2vh]';
  const labelSizeClass = hasDriveThru ? 'text-[1.2vh] sm:text-[1.6vh]' : 'text-[1.6vh] sm:text-[2.2vh]';
  const nameSizeClass = hasDriveThru ? 'text-[1.8vh] sm:text-[2.4vh]' : 'text-[2.6vh] sm:text-[3.6vh]';
  const lastNameSizeClass = hasDriveThru ? 'text-[1vh] sm:text-[1.3vh]' : 'text-[1.3vh] sm:text-[1.8vh]';

  return (
    <div
      onClick={() => onClick(stationKey, label, group, emp, assignee)}
      className={`p-[0.15vh] flex flex-col h-full cursor-pointer group active:scale-95 transition-all ${className}`}
    >
      <div
        className={`w-full h-full ${paddingClass} rounded-[1.2vh] sm:rounded-[1.6vh] transition-all duration-300 overflow-hidden relative flex flex-col items-center justify-center border-[0.25vh] ${
          emp
            ? isGreenGroup
              ? 'bg-emerald-500 border-emerald-600 dark:bg-emerald-600 dark:border-emerald-700 shadow-md text-white'
              : isYellowGroup
              ? 'bg-yellow-400 border-yellow-500 dark:bg-yellow-500 dark:border-yellow-600 shadow-md text-black'
              : 'bg-white border-slate-200 dark:bg-slate-800 dark:border-slate-700 shadow-md hover:border-slate-300 dark:hover:border-slate-600'
            : isGreenGroup
            ? 'bg-emerald-50 border-dashed border-emerald-300 dark:bg-emerald-950/20 dark:border-emerald-800/50'
            : isYellowGroup
            ? 'bg-yellow-50 border-dashed border-yellow-300 dark:bg-yellow-950/20 dark:border-yellow-800/50'
            : 'bg-slate-50/50 border-dashed border-slate-200 dark:bg-slate-900/50 dark:border-slate-800 shadow-sm hover:border-slate-300 dark:hover:border-slate-700'
        }`}
      >
        <span
          className={`font-black uppercase tracking-wider mb-[0.2vh] text-center transition-colors ${labelSizeClass} ${
            isGreenGroup || isYellowGroup
              ? emp
                ? isGreenGroup
                  ? 'text-white'
                  : 'text-black'
                : 'text-slate-500 dark:text-slate-400'
              : emp
              ? 'text-indigo-600 dark:text-indigo-400'
              : 'text-slate-400 dark:text-slate-500'
          }`}
        >
          {label}
        </span>
        <span
          className={`font-black uppercase tracking-tight leading-none text-center transition-all ${nameSizeClass} ${
            emp
              ? isGreenGroup
                ? 'text-white'
                : 'text-slate-900 dark:text-white'
              : 'text-slate-300 dark:text-slate-600'
          }`}
        >
          {emp ? emp.chosen_name || emp.first_name : t('actividades.daily.vacant')}
        </span>
        {emp && (
          <p
            className={`font-bold uppercase tracking-widest truncate w-full text-center mt-[0.2vh] ${lastNameSizeClass} ${
              isGreenGroup || isYellowGroup
                ? isGreenGroup
                  ? 'text-emerald-100'
                  : 'text-yellow-900/60'
                : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            {emp.last_name}
          </p>
        )}
      </div>
    </div>
  );
};

// ════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ════════════════════════════════════════════════════════════════════

export default function AsignacionDiariaTab() {
  const { t, language } = useLanguage();
  const locale = language === 'es' ? es : enUS;

  // ── State ──
  const [stores, setStores] = useState<Store[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState<string>('7');
  const [currentWeekStart, setCurrentWeekStart] = useState<Date>(() =>
    startOfWeek(getBusinessToday(), { weekStartsOn: 1 })
  );
  const [selectedDay, setSelectedDay] = useState<Date>(() => getBusinessToday());
  const [activeShift, setActiveShift] = useState<'AM' | 'PM'>(() => {
    const la = getLATime();
    const h = la.getHours();
    return h >= 17 || h < 6 ? 'PM' : 'AM';
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [copying, setCopying] = useState(false);
  const [copyingAll, setCopyingAll] = useState(false);

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [shifts, setShifts] = useState<ShiftRecord[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [positionActivities, setPositionActivities] = useState<PositionActivity[]>([]);
  const [driveThruCollapsed, setDriveThruCollapsed] = useState(false);

  // ── Visual Board States ──
  const [showVisualBoard, setShowVisualBoard] = useState(false);
  const [selectedSlotForCard, setSelectedSlotForCard] = useState<{ label: string; assignee: any; stationKey?: string } | null>(null);
  const [selectedEmployeeCard, setSelectedEmployeeCard] = useState<Employee | null>(null);
  const [isReassigning, setIsReassigning] = useState(false);
  const [hasDriveThru, setHasDriveThru] = useState(true);

  // ── Fullscreen Helpers & Event Listener ──
  const enterFullscreen = () => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    const docEl = document.documentElement;
    if (docEl.requestFullscreen) {
      docEl.requestFullscreen().catch((err) => {
        console.error('Error attempting to enable fullscreen:', err);
      });
    } else if ((docEl as any).webkitRequestFullscreen) { /* Safari */
      (docEl as any).webkitRequestFullscreen();
    } else if ((docEl as any).msRequestFullscreen) { /* IE11 */
      (docEl as any).msRequestFullscreen();
    }
  };

  const exitFullscreen = () => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    const isFullscreen = !!(
      document.fullscreenElement ||
      (document as any).webkitFullscreenElement ||
      (document as any).mozFullScreenElement ||
      (document as any).msFullscreenElement
    );
    if (!isFullscreen) return;

    if (document.exitFullscreen) {
      document.exitFullscreen().catch((err) => {
        console.error('Error attempting to exit fullscreen:', err);
      });
    } else if ((document as any).webkitExitFullscreen) { /* Safari */
      (document as any).webkitExitFullscreen();
    } else if ((document as any).msExitFullscreen) { /* IE11 */
      (document as any).msExitFullscreen();
    }
  };

  // Sync showVisualBoard with native fullscreen state
  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    const handleFullscreenChange = () => {
      const isFullscreen = !!(
        document.fullscreenElement ||
        (document as any).webkitFullscreenElement ||
        (document as any).mozFullscreenElement ||
        (document as any).msFullscreenElement
      );
      if (!isFullscreen && showVisualBoard) {
        setShowVisualBoard(false);
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('mozfullscreenchange', handleFullscreenChange);
    document.addEventListener('MSFullscreenChange', handleFullscreenChange);
    
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      document.removeEventListener('mozfullscreenchange', handleFullscreenChange);
      document.removeEventListener('MSFullscreenChange', handleFullscreenChange);
    };
  }, [showVisualBoard]);

  // ── Derived ──
  const selectedStoreGuid = useMemo(() => {
    return stores.find((s) => String(s.id) === String(selectedStoreId))?.external_id || '';
  }, [stores, selectedStoreId]);

  // Load hasDriveThru from localStorage when store changes
  useEffect(() => {
    if (selectedStoreGuid) {
      const stored = localStorage.getItem(`hasDriveThru_${selectedStoreGuid}`);
      if (stored !== null) {
        setHasDriveThru(stored === 'true');
      } else {
        setHasDriveThru(true);
      }
    }
  }, [selectedStoreGuid]);

  const selectedDateStr = useMemo(() => formatDateISO(selectedDay), [selectedDay]);

  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => addDays(currentWeekStart, i));
  }, [currentWeekStart]);

  const weekRangeLabel = useMemo(() => {
    const start = currentWeekStart;
    const end = addDays(start, 6);
    return `${format(start, 'MMM d', { locale })} - ${format(end, 'MMM d, yyyy', { locale })}`;
  }, [currentWeekStart, locale]);

  // Filter shifts for selected day + shift
  // Uses OVERLAP logic: if a shift spans both AM and PM, it appears in both.
  // AM window: 6:00 AM - 4:59 PM | PM window: 5:00 PM - 5:59 AM (next day)
  const todayShifts = useMemo(() => {
    return shifts.filter((s) => {
      if (s.shift_date !== selectedDateStr) return false;

      // Parse start/end hours
      const getHour = (timeStr: string): number => {
        if (!timeStr) return 0;
        try {
          if (timeStr.includes(':') && !timeStr.includes('T')) {
            return parseInt(timeStr.split(':')[0], 10);
          }
          return new Date(timeStr).getHours();
        } catch { return 0; }
      };

      const startH = getHour(s.start_time);
      const endH = getHour(s.end_time);

      if (activeShift === 'AM') {
        // AM window: 6:00 - 16:59
        // Show if: starts in AM window, OR ends during AM window (after 6:00)
        const startsInAM = startH >= 6 && startH < 17;
        return startsInAM;
      } else {
        // PM window: 17:00 - 5:59
        // Show if: starts in PM window, OR starts before PM but ends in/after PM (crosses 5PM boundary)
        const startsInPM = startH >= 17 || startH < 6;
        const crossesIntoPM = startH < 17 && startH >= 6 && (endH >= 17 || endH < startH);
        return startsInPM || crossesIntoPM;
      }
    });
  }, [shifts, selectedDateStr, activeShift]);

  // Build roster of employees for the day
  const roster = useMemo(() => {
    return todayShifts.map((s) => {
      const emp = employees.find((e) => String(e.id) === String(s.employee_id));
      const isAssigned = assignments.some(
        (a) =>
          a.assignment_date === selectedDateStr &&
          a.employee_id === String(s.employee_id) &&
          a.sub_position?.endsWith(`_${activeShift}`)
      );
      return {
        shift: s,
        employee: emp,
        isAbsent: s.is_callback === true,
        isAssigned,
      };
    });
  }, [todayShifts, employees, assignments, selectedDateStr, activeShift]);

  // Split roster: available (not callback) vs absent (callback)
  const availableRoster = useMemo(() => {
    let list = roster.filter((r) => !r.isAbsent && r.employee);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter((r) => {
        const name = getDisplayName(r.employee!).toLowerCase();
        return name.includes(q);
      });
    }
    return list;
  }, [roster, searchQuery]);

  const absentRoster = useMemo(() => {
    return roster.filter((r) => r.isAbsent && r.employee);
  }, [roster]);

  // Build assignment map: sub_position -> Assignment
  const assignmentMap = useMemo(() => {
    const map: Record<string, Assignment> = {};
    assignments
      .filter(
        (a) =>
          a.assignment_date === selectedDateStr &&
          a.sub_position?.endsWith(`_${activeShift}`)
      )
      .forEach((a) => {
        map[a.sub_position] = a;
      });
    return map;
  }, [assignments, selectedDateStr, activeShift]);

  // Activity map: position_key -> activities[] filtered by shift, store model, and selected day frequency
  const activityMap = useMemo(() => {
    const map: Record<string, PositionActivity[]> = {};
    
    // Get current day index (0 = Monday, ..., 6 = Sunday)
    const jsDay = selectedDay.getDay(); // 0 = Sunday, 1 = Monday, etc.
    const myDayIndex = jsDay === 0 ? 6 : jsDay - 1;

    // Determine current store model for filtering
    const storeModel = hasDriveThru ? 'DRIVE_THRU' : 'REGULAR';

    // Helper matching frequency strings (like 'Diario', 'Domingo', 'Jueves y Domingo', '6')
    const isFreqMatch = (paFrequency: string, dayIdx: number): boolean => {
      if (!paFrequency) return false;
      const freqLower = paFrequency.toLowerCase();
      if (freqLower === 'diario') return true;
      if (paFrequency === String(dayIdx)) return true;
      
      const dayNamesMap: Record<string, string[]> = {
        '0': ['lunes'],
        '1': ['martes'],
        '2': ['miercoles', 'miércoles'],
        '3': ['jueves'],
        '4': ['viernes'],
        '5': ['sabado', 'sábado'],
        '6': ['domingo']
      };
      
      const names = dayNamesMap[String(dayIdx)];
      if (!names) return false;
      
      return names.some(name => freqLower.includes(name));
    };

    positionActivities.forEach((pa) => {
      // Filter by shift
      if (pa.shift !== 'AMBOS' && pa.shift !== activeShift) return;

      // Filter by store model (Regular vs Drive-Thru)
      if (pa.store_model && pa.store_model !== 'AMBOS' && pa.store_model !== storeModel) return;
      
      // Filter by frequency matching with selectedDay
      if (pa.frequency && !isFreqMatch(pa.frequency, myDayIndex)) return;

      if (!map[pa.position_key]) map[pa.position_key] = [];
      map[pa.position_key].push(pa);
    });
    return map;
  }, [positionActivities, activeShift, selectedDay, hasDriveThru]);

  // ── Data Fetching ──
  const fetchStores = useCallback(async () => {
    const { data } = await supabase.from('stores').select('id, name, external_id').order('name');
    if (data) setStores(data as Store[]);
  }, []);

  const fetchShifts = useCallback(async () => {
    if (!selectedStoreGuid) return;
    const { data } = await supabase
      .from('shifts')
      .select('*')
      .eq('store_id', selectedStoreGuid)
      .eq('shift_date', selectedDateStr);
    setShifts((data || []) as ShiftRecord[]);
  }, [selectedStoreGuid, selectedDateStr]);

  const fetchEmployees = useCallback(async () => {
    if (!selectedStoreGuid) return;
    // Paginate through all employees (>1000 possible)
    let allEmps: Employee[] = [];
    let page = 0;
    const PAGE_SIZE = 1000;
    let hasMore = true;
    while (hasMore) {
      const { data } = await supabase
        .from('toast_employees')
        .select('*')
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
      if (!data || data.length === 0) break;
      allEmps = [...allEmps, ...data];
      if (data.length < PAGE_SIZE) hasMore = false;
      page++;
    }

    // Filter: employees for this store or who have a shift
    const shiftEmpIds = new Set(shifts.map((s) => String(s.employee_id)));
    const filtered = allEmps.filter((e: Employee) => {
      if (shiftEmpIds.has(String(e.id))) return true;
      if (e.deleted) return false;

      let storeIds: string[] = [];
      if (Array.isArray(e.store_ids)) {
        storeIds = e.store_ids;
      } else if (typeof e.store_ids === 'string') {
        if (e.store_ids.trim().startsWith('[')) {
          try {
            const parsed = JSON.parse(e.store_ids);
            if (Array.isArray(parsed)) storeIds = parsed;
          } catch {
            storeIds = [e.store_ids];
          }
        } else {
          storeIds = [e.store_ids];
        }
      }
      return storeIds.includes(selectedStoreGuid);
    });

    setEmployees(filtered as Employee[]);
  }, [selectedStoreGuid, shifts]);

  const fetchAssignments = useCallback(async () => {
    if (!selectedStoreGuid) return;
    try {
      const res = await fetch(
        `/api/roles?store_id=${selectedStoreGuid}&start_date=${selectedDateStr}&end_date=${selectedDateStr}`
      );
      const data = await res.json();
      if (Array.isArray(data)) {
        setAssignments(data as Assignment[]);
      }
    } catch (err) {
      console.error('Error fetching assignments:', err);
    }
  }, [selectedStoreGuid, selectedDateStr]);

  const fetchPositionActivities = useCallback(async () => {
    try {
      const res = await fetch('/api/roles/activities');
      const data = await res.json();
      if (Array.isArray(data)) {
        setPositionActivities(data as PositionActivity[]);
      }
    } catch (err) {
      console.error('Error fetching position activities:', err);
    }
  }, []);

  // ── Initial load ──
  useEffect(() => {
    fetchStores();
    fetchPositionActivities();
  }, [fetchStores, fetchPositionActivities]);

  // ── When store or date changes ──
  useEffect(() => {
    if (!selectedStoreGuid) return;
    const loadData = async () => {
      setLoading(true);
      await Promise.all([fetchShifts(), fetchAssignments()]);
      setLoading(false);
    };
    loadData();
  }, [selectedStoreGuid, selectedDateStr, fetchShifts, fetchAssignments]);

  // ── Load employees when shifts change ──
  useEffect(() => {
    if (selectedStoreGuid) {
      fetchEmployees();
    }
  }, [selectedStoreGuid, shifts, fetchEmployees]);

  // ── Actions ──
  const getAssignee = useCallback((date: Date, station: string) => {
    const dateStr = formatDateISO(date);
    return assignments.find((a) => a.assignment_date === dateStr && a.sub_position === station);
  }, [assignments]);

  const updateAssignment = useCallback((dateStr: string, station: string, employeeId: string, group: string) => {
    const subPos = `${station}_${activeShift}`;
    const stationActivitiesList = activityMap[station] || [];
    const defaultTasks = stationActivitiesList
      .map(pa => pa.operating_procedures?.activity)
      .filter(Boolean) as string[];

    setAssignments((prev) => {
      // Only clear the current station slot — never remove the employee from other stations
      const filtered = prev.filter(
        (a) => !(a.assignment_date === dateStr && a.sub_position === subPos)
      );

      if (!employeeId) return filtered;

      return [
        ...filtered,
        {
          store_id: selectedStoreGuid,
          employee_id: employeeId,
          assignment_date: dateStr,
          main_station: station,
          sub_position: subPos,
          station_group: group,
          tasks: defaultTasks,
        },
      ];
    });
  }, [selectedStoreGuid, activeShift, activityMap]);

  const handleSlotClick = useCallback((stationKey: string, label: string, group: string, emp: any, assignee: any) => {
    setSelectedSlotForCard({ 
      stationKey, 
      label, 
      assignee: assignee ? { ...assignee, station_group: group } : null
    });
    setSelectedEmployeeCard(emp);
    setIsReassigning(false);
  }, []);

  const handleAssignEmployee = (stationName: string, employeeId: string) => {
    const group = getSectionForStation(stationName);
    updateAssignment(selectedDateStr, stationName, employeeId, group);
  };

  const handleSave = async () => {
    if (!selectedStoreGuid) return;
    setSaving(true);
    setSaveSuccess(false);

    const payload = {
      assignments: assignments.filter(
        (a) =>
          a.assignment_date === selectedDateStr &&
          a.sub_position?.endsWith(`_${activeShift}`) &&
          a.employee_id
      ),
      store_id: selectedStoreGuid,
      start_date: selectedDateStr,
      end_date: selectedDateStr,
      active_shift: activeShift,
    };

    try {
      const res = await fetch('/api/roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success) {
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 3000);
      } else {
        alert(t('actividades.daily.save_error'));
      }
    } catch {
      alert(t('actividades.daily.save_error'));
    } finally {
      setSaving(false);
    }
  };

  const handleCopyPreviousWeek = useCallback(async () => {
    if (!selectedStoreGuid) return;
    setCopying(true);
    try {
      const prevDate = subDays(selectedDay, 7);
      const prevDateStr = formatDateISO(prevDate);
      
      const res = await fetch(
        `/api/roles?store_id=${selectedStoreGuid}&start_date=${prevDateStr}&end_date=${prevDateStr}`
      );
      if (!res.ok) throw new Error('Failed to fetch previous week assignments');
      
      const data = await res.json();
      if (Array.isArray(data)) {
        if (data.length === 0) {
          alert(language === 'es' ? 'No se encontraron asignaciones del mismo día de la semana anterior para copiar.' : 'No assignments found for the same day of the previous week.');
          setCopying(false);
          return;
        }

        // Map previous week assignments to the current day date
        // Only keep those matching the current active shift (e.g. if we are on PM, copy the PM assignments)
        const prevShiftSuffix = `_${activeShift}`;
        const shiftFiltered = data.filter((a: any) => a.sub_position?.endsWith(prevShiftSuffix));

        if (shiftFiltered.length === 0) {
          alert(language === 'es' ? `No se encontraron asignaciones en el turno ${activeShift} para el mismo día de la semana anterior.` : `No assignments found in ${activeShift} shift for the same day of the previous week.`);
          setCopying(false);
          return;
        }

        const clonedAssignments = shiftFiltered.map((a: any) => {
          const stationActivitiesList = activityMap[a.main_station] || [];
          const defaultTasks = stationActivitiesList
            .map(pa => pa.operating_procedures?.activity)
            .filter(Boolean) as string[];

          return {
            store_id: selectedStoreGuid,
            employee_id: String(a.employee_id),
            assignment_date: selectedDateStr,
            main_station: a.main_station,
            sub_position: a.sub_position || `${a.main_station}_${activeShift}`,
            station_group: a.station_group,
            tasks: a.tasks && a.tasks.length > 0 ? a.tasks : defaultTasks,
          };
        });

        // Merge with existing assignments for other shifts or overwrite current shift
        setAssignments((prev) => {
          // Remove current shift assignments first
          const otherShifts = prev.filter(
            (a) => !(a.assignment_date === selectedDateStr && a.sub_position?.endsWith(`_${activeShift}`))
          );
          return [...otherShifts, ...clonedAssignments];
        });
        
        setSaveSuccess(false); // force manual save
        alert(language === 'es' ? '¡Asignaciones de la semana anterior copiadas! Revisa los cambios y haz clic en Guardar Cambios para confirmarlos.' : 'Previous week assignments copied! Review and click Save Changes to confirm.');
      }
    } catch (err) {
      console.error('Error copying previous week assignments:', err);
      alert(language === 'es' ? 'Hubo un error al copiar las asignaciones.' : 'An error occurred while copying assignments.');
    } finally {
      setCopying(false);
    }
  }, [selectedStoreGuid, selectedDay, selectedDateStr, activeShift, activityMap, language]);

  const handleCopyPreviousWeekAll = useCallback(async () => {
    if (!selectedStoreGuid) return;
    if (!confirm(language === 'es' ? '¿Estás seguro de que quieres clonar TODA la semana pasada? Esto reemplazará todas las asignaciones de esta semana de forma permanente.' : 'Are you sure you want to clone the ENTIRE previous week? This will overwrite all assignments for the current week permanently.')) return;
    
    setCopyingAll(true);
    try {
      // 1. Calculate previous week date range
      const prevWeekStart = subDays(currentWeekStart, 7);
      const prevWeekEnd = subDays(currentWeekStart, 1);
      const prevWeekStartStr = formatDateISO(prevWeekStart);
      const prevWeekEndStr = formatDateISO(prevWeekEnd);

      // Current week date range
      const currentWeekEnd = addDays(currentWeekStart, 6);
      const currentWeekStartStr = formatDateISO(currentWeekStart);
      const currentWeekEndStr = formatDateISO(currentWeekEnd);

      // 2. Fetch all assignments from previous week
      const res = await fetch(
        `/api/roles?store_id=${selectedStoreGuid}&start_date=${prevWeekStartStr}&end_date=${prevWeekEndStr}`
      );
      if (!res.ok) throw new Error('Failed to fetch previous week assignments');

      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) {
        alert(language === 'es' ? 'No se encontraron asignaciones en la semana anterior para copiar.' : 'No assignments found in the previous week.');
        setCopyingAll(false);
        return;
      }

      // 3. Map assignments to current week dates (adding 7 days)
      const clonedAssignments = data.map((a: any) => {
        const prevAssignDate = new Date(a.assignment_date + 'T00:00:00');
        const nextAssignDate = addDays(prevAssignDate, 7);
        const nextAssignDateStr = formatDateISO(nextAssignDate);

        // Fetch defaults if tasks are missing
        const stationActivitiesList = activityMap[a.main_station] || [];
        const defaultTasks = stationActivitiesList
          .map(pa => pa.operating_procedures?.activity)
          .filter(Boolean) as string[];

        return {
          store_id: selectedStoreGuid,
          employee_id: String(a.employee_id),
          assignment_date: nextAssignDateStr,
          main_station: a.main_station,
          sub_position: a.sub_position || `${a.main_station}_${activeShift}`,
          station_group: a.station_group,
          tasks: a.tasks && a.tasks.length > 0 ? a.tasks : defaultTasks,
        };
      });

      // 4. Send POST request to write it directly to the DB (clearing the entire current week range)
      const saveRes = await fetch('/api/roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assignments: clonedAssignments,
          store_id: selectedStoreGuid,
          start_date: currentWeekStartStr,
          end_date: currentWeekEndStr,
          // Sending without active_shift so it deletes and overwrites both AM and PM shifts for the entire week
        }),
      });

      const saveResult = await saveRes.json();
      if (saveResult.success) {
        // Reload current data
        await Promise.all([fetchShifts(), fetchAssignments()]);
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 3000);
        alert(language === 'es' ? '¡Semana completa clonada y guardada con éxito!' : 'Entire week cloned and saved successfully!');
      } else {
        alert(language === 'es' ? 'Hubo un error al guardar las asignaciones clonadas.' : 'Error saving cloned assignments.');
      }
    } catch (err) {
      console.error('Error cloning entire week:', err);
      alert(language === 'es' ? 'Hubo un error al clonar la semana.' : 'An error occurred while cloning the week.');
    } finally {
      setCopyingAll(false);
    }
  }, [selectedStoreGuid, currentWeekStart, activeShift, activityMap, language, fetchShifts, fetchAssignments]);

  // ── Navigation ──
  const goToPrevWeek = () => {
    const newStart = subWeeks(currentWeekStart, 1);
    setCurrentWeekStart(newStart);
    setSelectedDay(newStart);
  };
  const goToNextWeek = () => {
    const newStart = addWeeks(currentWeekStart, 1);
    setCurrentWeekStart(newStart);
    setSelectedDay(newStart);
  };

  // ── Format time for activity badge ──
  const formatActivityTime = (timeStr: string): string => {
    if (!timeStr) return '';
    const parts = timeStr.split(':');
    if (parts.length < 2) return timeStr;
    let h = parseInt(parts[0], 10);
    const m = parts[1];
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${h}:${m} ${ampm}`;
  };

  // ════════════════════════════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════════════════════════════

  return (
    <div className="w-full max-w-[1600px] mx-auto px-3 sm:px-6 pb-24">
      {/* ═══════════════ HEADER ═══════════════ */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-6 p-4 sm:p-6 rounded-2xl sm:rounded-3xl bg-white/40 dark:bg-slate-900/40 backdrop-blur-xl border border-white/20 dark:border-slate-800/50 shadow-xl relative overflow-hidden"
      >
        {/* Decorative blurs */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/15 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3" />
        <div className="absolute bottom-0 left-0 w-64 h-64 bg-blue-500/15 rounded-full blur-3xl translate-y-1/2 -translate-x-1/3" />

        <div className="relative z-10 space-y-4">
          {/* Row 1: Title + Store Selector + Save */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div>
              <h1 className="text-xl sm:text-2xl font-extrabold bg-gradient-to-r from-indigo-600 to-blue-600 dark:from-indigo-400 dark:to-blue-400 bg-clip-text text-transparent">
                {t('actividades.daily.title')}
              </h1>
              <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                {t('actividades.daily.subtitle')}
              </p>
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              {/* Store selector */}
              <div className="flex items-center gap-2 bg-white/60 dark:bg-slate-800/60 rounded-xl px-3 py-2 border border-slate-200/50 dark:border-slate-700/50">
                <Building2 className="w-4 h-4 text-slate-500 flex-shrink-0" />
                <select
                  value={selectedStoreId}
                  onChange={(e) => setSelectedStoreId(e.target.value)}
                  className="text-sm font-semibold bg-transparent outline-none text-slate-800 dark:text-slate-200 cursor-pointer"
                >
                  {stores.map((store) => (
                    <option key={store.id} value={String(store.id)}>
                      {formatStoreName(store.name)}
                    </option>
                  ))}
                </select>
              </div>

              {/* Switch Drive-Thru */}
              <div className="flex items-center gap-3 px-3 py-2 bg-white/60 dark:bg-slate-800/60 rounded-xl border border-slate-200/50 dark:border-slate-700/50">
                <span className="text-xs font-semibold text-slate-600 dark:text-slate-400 whitespace-nowrap">
                  {t('actividades.daily.drive_thru_toggle')}
                </span>
                <button
                  onClick={() => {
                    const newVal = !hasDriveThru;
                    setHasDriveThru(newVal);
                    if (selectedStoreGuid) {
                      localStorage.setItem(`hasDriveThru_${selectedStoreGuid}`, String(newVal));
                    }
                  }}
                  className={`relative w-10 h-5 rounded-full transition-all duration-300 ${
                    hasDriveThru 
                      ? 'bg-indigo-600 dark:bg-indigo-500 shadow-lg shadow-indigo-500/20' 
                      : 'bg-slate-200 dark:bg-slate-700'
                  }`}
                >
                  <div 
                    className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all duration-300 ${
                      hasDriveThru ? 'left-6' : 'left-1'
                    }`} 
                  />
                </button>
              </div>

              {/* Clonar Semana Completa */}
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleCopyPreviousWeekAll}
                disabled={copyingAll}
                className="px-5 py-2.5 rounded-xl text-sm font-bold bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/50 shadow-sm transition-all flex items-center gap-2 disabled:opacity-60"
              >
                {copyingAll ? (
                  <Loader2 className="w-4 h-4 animate-spin text-indigo-500" />
                ) : (
                  <Calendar className="w-4 h-4 text-indigo-500" />
                )}
                {copyingAll ? t('actividades.daily.copying_prev_week_all') : t('actividades.daily.copy_prev_week_all')}
              </motion.button>

              {/* Clonar por Día y Turno */}
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleCopyPreviousWeek}
                disabled={copying}
                className="px-5 py-2.5 rounded-xl text-sm font-bold bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/50 shadow-sm transition-all flex items-center gap-2 disabled:opacity-60"
              >
                {copying ? (
                  <Loader2 className="w-4 h-4 animate-spin text-indigo-500" />
                ) : (
                  <Copy className="w-4 h-4 text-indigo-500" />
                )}
                {copying ? t('actividades.daily.copying_prev_week') : t('actividades.daily.copy_prev_week')}
              </motion.button>

              {/* Tablero */}
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => {
                  setShowVisualBoard(true);
                  enterFullscreen();
                }}
                className="px-5 py-2.5 rounded-xl text-sm font-bold bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 hover:bg-black dark:hover:bg-white shadow-md transition-all flex items-center gap-2"
              >
                <LayoutTemplate className="w-4 h-4 text-indigo-400 dark:text-indigo-600" />
                {t('actividades.daily.tablero')}
              </motion.button>

              {/* Save */}
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleSave}
                disabled={saving}
                className={`px-5 py-2.5 rounded-xl text-sm font-bold text-white shadow-lg transition-all flex items-center gap-2 ${
                  saveSuccess
                    ? 'bg-gradient-to-r from-green-500 to-emerald-600'
                    : 'bg-gradient-to-r from-green-500 to-emerald-600 hover:shadow-xl'
                } disabled:opacity-60`}
              >
                {saving ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : saveSuccess ? (
                  <CheckCircle2 className="w-4 h-4" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                {saving
                  ? t('actividades.daily.saving')
                  : saveSuccess
                  ? t('actividades.daily.saved')
                  : t('actividades.daily.save')}
              </motion.button>
            </div>
          </div>

          {/* Row 2: Week Nav + Day Selector */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
            {/* Week navigation */}
            <div className="flex items-center gap-2 bg-white/60 dark:bg-slate-800/60 rounded-xl px-2 py-1.5 border border-slate-200/50 dark:border-slate-700/50">
              <button
                onClick={goToPrevWeek}
                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors"
              >
                <ChevronLeft className="w-4 h-4 text-slate-600 dark:text-slate-300" />
              </button>
              <span className="text-sm font-semibold text-slate-700 dark:text-slate-200 whitespace-nowrap px-2">
                {weekRangeLabel}
              </span>
              <button
                onClick={goToNextWeek}
                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors"
              >
                <ChevronRight className="w-4 h-4 text-slate-600 dark:text-slate-300" />
              </button>
            </div>

            {/* Day buttons */}
            <div className="flex items-center gap-1 bg-white/60 dark:bg-slate-800/60 rounded-xl p-1 border border-slate-200/50 dark:border-slate-700/50">
              {weekDays.map((day, idx) => {
                const isSelected = isSameDay(day, selectedDay);
                const isToday = isSameDay(day, getBusinessToday());
                return (
                  <button
                    key={idx}
                    onClick={() => setSelectedDay(day)}
                    className={`relative px-2.5 py-1.5 rounded-lg text-xs sm:text-sm font-bold transition-all duration-200 ${
                      isSelected
                        ? 'bg-gradient-to-r from-indigo-500 to-blue-500 text-white shadow-md'
                        : isToday
                        ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-300'
                        : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700/50'
                    }`}
                  >
                    {t(DAY_LABELS_KEYS[idx])}
                    {isToday && !isSelected && (
                      <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-indigo-500 rounded-full" />
                    )}
                  </button>
                );
              })}
            </div>

            {/* Shift toggle */}
            <div className="flex items-center bg-white/60 dark:bg-slate-800/60 rounded-xl p-1 border border-slate-200/50 dark:border-slate-700/50">
              {(['AM', 'PM'] as const).map((shift) => (
                <button
                  key={shift}
                  onClick={() => setActiveShift(shift)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold transition-all duration-200 ${
                    activeShift === shift
                      ? shift === 'AM'
                        ? 'bg-gradient-to-r from-amber-400 to-orange-500 text-white shadow-md'
                        : 'bg-gradient-to-r from-indigo-600 to-purple-700 text-white shadow-md'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700/50'
                  }`}
                >
                  {shift === 'AM' ? (
                    <Sun className="w-3.5 h-3.5" />
                  ) : (
                    <Moon className="w-3.5 h-3.5" />
                  )}
                  {shift === 'AM'
                    ? t('actividades.daily.shift_am')
                    : t('actividades.daily.shift_pm')}
                </button>
              ))}
            </div>
          </div>

          {/* Date subtitle */}
          <p className="text-xs text-slate-400 dark:text-slate-500">
            {format(selectedDay, "EEEE, MMMM d, yyyy", { locale })}
          </p>
        </div>
      </motion.div>

      {/* ═══════════════ MAIN CONTENT: 2-column ═══════════════ */}
      {loading ? (
        <div className="flex justify-center items-center h-64">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="w-10 h-10 animate-spin text-indigo-500" />
            <span className="text-sm text-slate-500">{t('actividades.daily.loading')}</span>
          </div>
        </div>
      ) : (
        <div className="flex flex-col lg:flex-row gap-5">
          {/* ─── LEFT COLUMN: Disponibles Hoy ─── */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1 }}
            className="w-full lg:w-[280px] flex-shrink-0"
          >
            <div className="sticky top-4 space-y-4">
              {/* Available employees card */}
              <div className="rounded-2xl bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl border border-white/20 dark:border-slate-800/50 shadow-lg overflow-hidden">
                {/* Header */}
                <div className="px-4 py-3 bg-gradient-to-r from-indigo-500/10 to-blue-500/10 dark:from-indigo-500/5 dark:to-blue-500/5 border-b border-slate-200/30 dark:border-slate-700/30">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                      <Users className="w-4 h-4 text-indigo-500" />
                      {t('actividades.daily.available_today')}
                    </h3>
                    <span className="text-xs font-bold bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-300 px-2 py-0.5 rounded-full">
                      {availableRoster.length}
                    </span>
                  </div>
                  {/* Search */}
                  <div className="mt-2 relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder={t('actividades.daily.search_placeholder')}
                      className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg bg-white/70 dark:bg-slate-800/70 border border-slate-200/50 dark:border-slate-700/50 outline-none focus:ring-2 focus:ring-indigo-500/30 text-slate-700 dark:text-slate-200 placeholder:text-slate-400"
                    />
                  </div>
                </div>

                {/* Employee list */}
                <div className="max-h-[calc(100vh-420px)] overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/50">
                  {availableRoster.length === 0 ? (
                    <div className="p-4 text-center text-xs text-slate-400">
                      {t('actividades.daily.no_employees')}
                    </div>
                  ) : (
                    availableRoster.map((r) => {
                      const emp = r.employee!;
                      const displayName = getDisplayName(emp);
                      const initials = getInitials(emp);
                      const gradient = getInitialsGradient(displayName);
                      const shiftTime = `${formatTimeTo12h(r.shift.start_time)} - ${formatTimeTo12h(r.shift.end_time)}`;

                      return (
                        <motion.div
                          key={r.shift.id || emp.id}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          className={`px-3 py-2.5 flex items-center gap-2.5 hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors ${
                            r.isAssigned ? 'opacity-60' : ''
                          }`}
                        >
                          {/* Initials circle */}
                          <div
                            className={`w-8 h-8 rounded-full bg-gradient-to-br ${gradient} flex items-center justify-center text-white text-xs font-bold flex-shrink-0 shadow-sm`}
                          >
                            {initials}
                          </div>
                          {/* Info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">
                                {displayName}
                              </p>
                              {r.isAssigned && (
                                <UserCheck className="w-3 h-3 text-green-500 flex-shrink-0" />
                              )}
                            </div>
                            <p className="text-[10px] text-slate-400 dark:text-slate-500 flex items-center gap-1">
                              <Clock className="w-2.5 h-2.5" />
                              {shiftTime}
                            </p>
                          </div>
                        </motion.div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Absent section */}
              {absentRoster.length > 0 && (
                <div className="rounded-2xl bg-red-50/60 dark:bg-red-950/20 backdrop-blur-xl border border-red-200/30 dark:border-red-800/30 shadow-lg overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-red-200/30 dark:border-red-800/30">
                    <h3 className="text-xs font-bold text-red-600 dark:text-red-400 flex items-center gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5" />
                      {t('actividades.daily.absent_section')}
                      <span className="ml-auto text-[10px] bg-red-100 dark:bg-red-900/40 px-1.5 py-0.5 rounded-full">
                        {absentRoster.length}
                      </span>
                    </h3>
                  </div>
                  <div className="divide-y divide-red-100 dark:divide-red-900/30">
                    {absentRoster.map((r) => {
                      const emp = r.employee!;
                      return (
                        <div
                          key={r.shift.id || emp.id}
                          className="px-3 py-2 flex items-center gap-2"
                        >
                          <div className="w-6 h-6 rounded-full bg-red-200 dark:bg-red-900/40 flex items-center justify-center text-red-600 text-[9px] font-bold flex-shrink-0">
                            {getInitials(emp)}
                          </div>
                          <p className="text-xs text-red-400 line-through truncate">
                            {getDisplayName(emp)}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </motion.div>

          {/* ─── RIGHT COLUMN: Station Map ─── */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.2 }}
            className="flex-1 space-y-6"
          >
            {SECTIONS.map((section) => {
              if (section.id === 'drive-thru' && !hasDriveThru) return null;
              const sColor = SECTION_COLORS[section.color];
              const SectionIcon = section.Icon;
              const isCollapsible = section.collapsible || false;
              const isCollapsed = isCollapsible && driveThruCollapsed;

              return (
                <div key={section.id}>
                  {/* Section header */}
                  <div
                    className={`flex items-center gap-2 mb-3 ${
                      isCollapsible ? 'cursor-pointer' : ''
                    }`}
                    onClick={() => {
                      if (isCollapsible) setDriveThruCollapsed(!driveThruCollapsed);
                    }}
                  >
                    <div
                      className={`w-8 h-8 rounded-xl bg-gradient-to-br ${sColor.gradient} flex items-center justify-center shadow-md`}
                    >
                      <SectionIcon className="w-4 h-4 text-white" />
                    </div>
                    <h2 className={`text-sm sm:text-base font-bold ${sColor.text}`}>
                      {t(section.titleKey)}
                    </h2>
                    <span className="text-xs text-slate-400 font-medium">
                      ({section.stations.length})
                    </span>
                    <div className="h-px flex-1 bg-gradient-to-r from-slate-200 dark:from-slate-700 to-transparent" />
                    {isCollapsible && (
                      <ChevronDown
                        className={`w-4 h-4 text-slate-400 transition-transform ${
                          isCollapsed ? '' : 'rotate-180'
                        }`}
                      />
                    )}
                  </div>

                  {/* Station cards */}
                  <AnimatePresence>
                    {!isCollapsed && (
                      <motion.div
                        initial={isCollapsible ? { height: 0, opacity: 0 } : undefined}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={isCollapsible ? { height: 0, opacity: 0 } : undefined}
                        className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3"
                      >
                        {section.stations.map((stationName) => {
                          const subPos = `${stationName}_${activeShift}`;
                          const assignment = assignmentMap[subPos];
                          const assignedEmp = assignment
                            ? employees.find(
                                (e) => String(e.id) === String(assignment.employee_id)
                              )
                            : null;
                          const stationActivities = activityMap[stationName] || [];
                          const isVacant = !assignedEmp;

                          return (
                            <motion.div
                              key={stationName}
                              initial={{ opacity: 0, y: 10 }}
                              animate={{ opacity: 1, y: 0 }}
                              className={`rounded-2xl border backdrop-blur-xl shadow-sm transition-all hover:shadow-md overflow-hidden ${
                                isVacant
                                  ? `${sColor.bg} ${sColor.border} ring-1 ring-red-300/40 dark:ring-red-500/20`
                                  : `bg-white/70 dark:bg-slate-800/70 border-slate-200/50 dark:border-slate-700/50`
                              }`}
                            >
                              {/* Vacant pulse indicator */}
                              {isVacant && (
                                <div className="absolute inset-0 rounded-2xl animate-pulse bg-red-500/[0.03] pointer-events-none" />
                              )}

                              {/* Station name + dropdown */}
                              <div className="p-3 relative">
                                <div className="flex items-center justify-between mb-2">
                                  <h3 className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wide">
                                    {stationName}
                                  </h3>
                                  {assignedEmp && (
                                    <div
                                      className={`w-6 h-6 rounded-full bg-gradient-to-br ${getInitialsGradient(
                                        getDisplayName(assignedEmp)
                                      )} flex items-center justify-center text-white text-[9px] font-bold shadow-sm`}
                                    >
                                      {getInitials(assignedEmp)}
                                    </div>
                                  )}
                                </div>

                                {/* Employee selector */}
                                <select
                                  value={assignment?.employee_id || ''}
                                  onChange={(e) =>
                                    handleAssignEmployee(stationName, e.target.value)
                                  }
                                  className={`w-full text-xs font-semibold rounded-lg px-2.5 py-2 outline-none transition-all border ${
                                    isVacant
                                      ? 'bg-red-50 dark:bg-red-950/30 border-red-300 dark:border-red-700/50 text-red-600 dark:text-red-400'
                                      : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200'
                                  } focus:ring-2 focus:ring-indigo-500/30 cursor-pointer`}
                                >
                                  <option value="">
                                    {isVacant
                                      ? `⚠ ${t('actividades.daily.vacant')}`
                                      : `— ${t('actividades.daily.unassign')} —`}
                                  </option>
                                  {availableRoster.map((r) => {
                                    const emp = r.employee!;
                                    return (
                                      <option key={emp.id} value={String(emp.id)}>
                                        {getDisplayName(emp)}
                                      </option>
                                    );
                                  })}
                                </select>

                                {/* Activity checklist */}
                                {stationActivities.length > 0 && (
                                  <div className="mt-2.5 space-y-1">
                                    <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1">
                                      {t('actividades.daily.activities_label')}
                                    </p>
                                    {stationActivities.slice(0, 5).map((pa) => {
                                      const proc = pa.operating_procedures;
                                      if (!proc) return null;
                                      return (
                                        <div
                                          key={pa.id}
                                          className="flex items-start gap-1.5"
                                        >
                                          <span className="text-[8px] mt-1 text-slate-400">
                                            •
                                          </span>
                                          <span className="text-[10px] text-slate-600 dark:text-slate-400 leading-tight flex-1 truncate">
                                            {proc.activity}
                                          </span>
                                          {proc.start_time && (
                                            <span
                                              className={`text-[9px] font-medium ${sColor.badge} px-1.5 py-0.5 rounded-md whitespace-nowrap`}
                                            >
                                              {formatActivityTime(proc.start_time)}
                                            </span>
                                          )}
                                        </div>
                                      );
                                    })}
                                    {stationActivities.length > 5 && (
                                      <p className="text-[9px] text-slate-400 italic">
                                        +{stationActivities.length - 5}{' '}
                                        {t('actividades.daily.more_activities')}
                                      </p>
                                    )}
                                  </div>
                                )}
                              </div>
                            </motion.div>
                          );
                        })}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </motion.div>
        </div>
      )}

      {/* ═══════════════ VISUAL BOARD PORTAL ═══════════════ */}
      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {showVisualBoard && (() => {
            const cardHeightClass = hasDriveThru ? 'h-[9vh] sm:h-[11vh]' : 'h-[12vh] sm:h-[15.5vh]';
            const containerGapClass = hasDriveThru ? 'gap-[1.5vh] sm:gap-[2.5vh]' : 'gap-[3vh] sm:gap-[5vh]';
            const containerPaddingClass = hasDriveThru 
              ? 'pt-[2vh] pb-[10vh] sm:pt-[3vh] sm:pb-[15vh]' 
              : 'pt-[3vh] pb-[10vh] sm:pt-[6vh] sm:pb-[15vh]';

            return (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[9999] bg-white dark:bg-slate-950 flex flex-col overflow-hidden text-slate-950 dark:text-white"
              >
                {/* Header */}
                <div className="bg-slate-50 dark:bg-slate-900 border-b-2 border-black/5 dark:border-white/5 px-6 py-3 flex items-center justify-between flex-shrink-0">
                  <div className="flex items-center gap-4">
                    <div className="bg-indigo-600 p-2 rounded-xl text-white">
                      <LayoutTemplate size={20} />
                    </div>
                    <div>
                      <h1 className="text-lg sm:text-xl font-black tracking-widest uppercase italic">
                        {t('actividades.daily.tablero_title')}
                        <span className="text-orange-500 not-italic ml-2 font-bold">{activeShift}</span>
                      </h1>
                    </div>
                  </div>

                  {/* Date & Shift Selectors */}
                  <div className="flex items-center gap-3 bg-white dark:bg-slate-800 p-1.5 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm flex-wrap">
                    <div className="flex gap-1">
                      {(['AM', 'PM'] as const).map((sh) => (
                        <button
                          key={sh}
                          onClick={() => setActiveShift(sh)}
                          className={`px-4 sm:px-6 py-2 rounded-xl text-xs sm:text-sm font-black transition-all uppercase tracking-wider ${
                            activeShift === sh
                              ? 'bg-indigo-600 text-white shadow-sm'
                              : 'text-slate-400 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700'
                          }`}
                        >
                          {sh === 'AM' ? t('actividades.daily.shift_am') : t('actividades.daily.shift_pm')}
                        </button>
                      ))}
                    </div>
                    <div className="w-px h-6 bg-slate-200 dark:bg-slate-700 hidden sm:block mx-1" />
                    <div className="flex items-center gap-3 px-2 text-slate-800 dark:text-slate-200 font-black uppercase text-sm tracking-tight">
                      <button
                        onClick={() => setSelectedDay((d) => subDays(d, 1))}
                        className="w-8 h-8 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg flex items-center justify-center text-slate-400 hover:bg-indigo-50 dark:hover:bg-indigo-950 hover:text-indigo-600 transition-colors shadow-sm"
                      >
                        <ChevronLeft size={18} />
                      </button>
                      <span className="min-w-[120px] text-center font-bold">
                        {format(selectedDay, 'EEEE dd', { locale })}
                      </span>
                      <button
                        onClick={() => setSelectedDay((d) => addDays(d, 1))}
                        className="w-8 h-8 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg flex items-center justify-center text-slate-400 hover:bg-indigo-50 dark:hover:bg-indigo-950 hover:text-indigo-600 transition-colors shadow-sm"
                      >
                        <ChevronRight size={18} />
                      </button>
                    </div>
                  </div>

                  {/* Close */}
                  <button
                    onClick={() => {
                      setShowVisualBoard(false);
                      exitFullscreen();
                    }}
                    className="bg-black dark:bg-white text-white dark:text-black px-6 py-2.5 rounded-full font-black text-xs uppercase tracking-widest transition-all hover:bg-slate-800 dark:hover:bg-slate-200 active:scale-95"
                  >
                    {t('actividades.daily.close_board')}
                  </button>
                </div>

                {/* Layout Content */}
                <div className={`flex-1 p-[2vh] flex flex-col justify-start items-center bg-slate-100/40 dark:bg-slate-950 overflow-y-auto select-none relative ${containerGapClass} ${containerPaddingClass}`}>
                  {/* Dining Area section */}
                  <div className="flex flex-col gap-[0.2vh] relative z-10 w-full max-w-[96vw] mx-auto">
                    <div className="flex items-center justify-center gap-[1vh] mb-[0.5vh]">
                      <h2 className="text-[1.8vh] sm:text-[2.2vh] font-black text-indigo-600 dark:text-indigo-400 uppercase tracking-[0.4em] italic leading-none">
                        {t('actividades.daily.section_salon')}
                      </h2>
                    </div>
                    <div className="flex flex-col items-center gap-[0.2vh]">
                      <div className="flex gap-[0.5vh] w-full max-w-2xl md:max-w-4xl">
                        <BoardSlot
                          label="Limpieza"
                          stationKey="LIMPIEZA"
                          group="Salón"
                          assignee={getAssignee(selectedDay, `LIMPIEZA_${activeShift}`)}
                          employees={employees}
                          className={`flex-1 ${cardHeightClass}`}
                          onClick={handleSlotClick}
                        />
                        <BoardSlot
                          label="Descansos"
                          stationKey="CUBRIR DESCANSOS (SALÓN)"
                          group="Salón"
                          assignee={getAssignee(selectedDay, `CUBRIR DESCANSOS (SALÓN)_${activeShift}`)}
                          employees={employees}
                          className={`flex-1 ${cardHeightClass}`}
                          onClick={handleSlotClick}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Kitchen section */}
                  <div className="flex flex-col gap-[0.2vh] relative z-10 w-full max-w-[96vw] mx-auto">
                    <div className="flex items-center justify-center gap-[1vh] mb-[0.5vh]">
                      <h2 className="text-[1.8vh] sm:text-[2.2vh] font-black text-indigo-600 dark:text-indigo-400 uppercase tracking-[0.4em] italic leading-none text-center">
                        {t('actividades.daily.section_kitchen')}
                      </h2>
                    </div>
                    <div className="w-full flex flex-col items-center gap-[0.2vh]">
                      {/* Counter Line */}
                      <div className="w-full grid grid-cols-2 sm:grid-cols-7 gap-[0.2vh]">
                        <BoardSlot
                          label="Delivery"
                          stationKey="Uber + Salsas"
                          group="Salón"
                          assignee={getAssignee(selectedDay, `Uber + Salsas_${activeShift}`)}
                          employees={employees}
                          className={cardHeightClass}
                          onClick={handleSlotClick}
                        />
                        <BoardSlot
                          label="Entrega"
                          stationKey="ENTREGA"
                          group="Salón"
                          assignee={getAssignee(selectedDay, `ENTREGA_${activeShift}`)}
                          employees={employees}
                          className={cardHeightClass}
                          onClick={handleSlotClick}
                        />
                        <BoardSlot
                          label="Tacos"
                          stationKey="TACOS"
                          group="Salón"
                          assignee={getAssignee(selectedDay, `TACOS_${activeShift}`)}
                          employees={employees}
                          className={cardHeightClass}
                          onClick={handleSlotClick}
                        />
                        <BoardSlot
                          label="Burritos"
                          stationKey="BURRITOS"
                          group="Salón"
                          assignee={getAssignee(selectedDay, `BURRITOS_${activeShift}`)}
                          employees={employees}
                          className={cardHeightClass}
                          onClick={handleSlotClick}
                        />
                        <BoardSlot
                          label="Caja 3"
                          stationKey="Caja 3"
                          group="Salón"
                          assignee={getAssignee(selectedDay, `Caja 3_${activeShift}`)}
                          employees={employees}
                          className={cardHeightClass}
                          onClick={handleSlotClick}
                        />
                        <BoardSlot
                          label="Caja 2"
                          stationKey="Caja 2"
                          group="Salón"
                          assignee={getAssignee(selectedDay, `Caja 2_${activeShift}`)}
                          employees={employees}
                          className={cardHeightClass}
                          onClick={handleSlotClick}
                        />
                        <BoardSlot
                          label="Caja 1"
                          stationKey="Caja 1 / Salón"
                          group="Salón"
                          assignee={getAssignee(selectedDay, `Caja 1 / Salón_${activeShift}`)}
                          employees={employees}
                          className={cardHeightClass}
                          onClick={handleSlotClick}
                        />
                      </div>

                      {/* Back Kitchen Line */}
                      <div className="w-full grid grid-cols-2 sm:grid-cols-4 gap-[0.2vh] mt-[0.2vh]">
                        <BoardSlot
                          label="Carnes"
                          stationKey="CARNES"
                          group="Cocina"
                          assignee={getAssignee(selectedDay, `CARNES_${activeShift}`)}
                          employees={employees}
                          className={cardHeightClass}
                          onClick={handleSlotClick}
                        />
                        <BoardSlot
                          label="Tortillas"
                          stationKey="TORTILLAS"
                          group="Cocina"
                          assignee={getAssignee(selectedDay, `TORTILLAS_${activeShift}`)}
                          employees={employees}
                          className={cardHeightClass}
                          onClick={handleSlotClick}
                        />
                        <BoardSlot
                          label="Tortas / Mulitas"
                          stationKey="TORTAS/MULITAS"
                          group="Cocina"
                          assignee={getAssignee(selectedDay, `TORTAS/MULITAS_${activeShift}`)}
                          employees={employees}
                          className={cardHeightClass}
                          onClick={handleSlotClick}
                        />
                        <BoardSlot
                          label="Tortas / Quesadillas"
                          stationKey="TORTAS/QUESADILLAS"
                          group="Cocina"
                          assignee={getAssignee(selectedDay, `TORTAS/QUESADILLAS_${activeShift}`)}
                          employees={employees}
                          className={cardHeightClass}
                          onClick={handleSlotClick}
                        />
                      </div>

                      {/* Kitchen Bottom Line */}
                      <div className="w-full grid grid-cols-1 sm:grid-cols-3 gap-[0.2vh]">
                        <BoardSlot
                          label="Preparación"
                          stationKey="PREPARACION"
                          group="Cocina"
                          assignee={getAssignee(selectedDay, `PREPARACION_${activeShift}`)}
                          employees={employees}
                          className={`${cardHeightClass} sm:col-span-2`}
                          onClick={handleSlotClick}
                        />
                        <BoardSlot
                          label="Descansos"
                          stationKey="CUBRIR DESCANSOS (COCINA)"
                          group="Cocina"
                          assignee={getAssignee(selectedDay, `CUBRIR DESCANSOS (COCINA)_${activeShift}`)}
                          employees={employees}
                          className={cardHeightClass}
                          onClick={handleSlotClick}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Drive Thru section */}
                  {hasDriveThru && (
                    <div className="flex flex-col gap-[0.2vh] relative z-10 w-full max-w-[96vw] mx-auto">
                      <div className="flex items-center justify-center gap-[1vh] mb-[0.5vh] w-full">
                        <h2 className="text-[1.8vh] sm:text-[2.2vh] font-black text-indigo-600 dark:text-indigo-400 uppercase tracking-[0.4em] italic leading-none">
                          {t('actividades.daily.section_drive_thru')}
                        </h2>
                      </div>
                      <div className="w-full grid grid-cols-2 sm:grid-cols-7 gap-[0.2vh] items-stretch">
                        <BoardSlot
                          label="Ventanilla 1"
                          stationKey="Ventana 1"
                          group="Drive-Thru"
                          assignee={getAssignee(selectedDay, `Ventana 1_${activeShift}`)}
                          employees={employees}
                          className="col-span-2 sm:col-span-1 sm:row-span-2 h-[9vh] sm:h-auto w-full"
                          onClick={handleSlotClick}
                        />
                        <BoardSlot
                          label="Tortas / Quesadillas (DT)"
                          stationKey="TORTAS/QUESADILLAS (DT)"
                          group="Drive-Thru"
                          assignee={getAssignee(selectedDay, `TORTAS/QUESADILLAS (DT)_${activeShift}`)}
                          employees={employees}
                          className={`col-span-1 sm:col-span-3 ${cardHeightClass} w-full`}
                          onClick={handleSlotClick}
                        />
                        <BoardSlot
                          label="Descansos"
                          stationKey="CUBRIR DESCANSOS (DT)"
                          group="Drive-Thru"
                          assignee={getAssignee(selectedDay, `CUBRIR DESCANSOS (DT)_${activeShift}`)}
                          employees={employees}
                          className={`col-span-1 sm:col-span-3 ${cardHeightClass} w-full`}
                          onClick={handleSlotClick}
                        />
                        <BoardSlot
                          label="Tacos / Burritos (DT)"
                          stationKey="TACOS/BURRITOS (DT)"
                          group="Drive-Thru"
                          assignee={getAssignee(selectedDay, `TACOS/BURRITOS (DT)_${activeShift}`)}
                          employees={employees}
                          className={`col-span-1 sm:col-span-2 ${cardHeightClass} w-full`}
                          onClick={handleSlotClick}
                        />
                        <BoardSlot
                          label="Ventanilla 2"
                          stationKey="Ventana 2"
                          group="Drive-Thru"
                          assignee={getAssignee(selectedDay, `Ventana 2_${activeShift}`)}
                          employees={employees}
                          className={`col-span-1 sm:col-span-2 ${cardHeightClass} w-full`}
                          onClick={handleSlotClick}
                        />
                        <BoardSlot
                          label="Ventanilla 2 (B)"
                          stationKey="Ventana 2 (B)"
                          group="Drive-Thru"
                          assignee={getAssignee(selectedDay, `Ventana 2 (B)_${activeShift}`)}
                          employees={employees}
                          className={`col-span-2 sm:col-span-2 ${cardHeightClass} w-full`}
                          onClick={handleSlotClick}
                        />
                      </div>
                    </div>
                  )}
                </div>
                {/* Clock Status in bottom right */}
                <div className="absolute bottom-4 right-6 flex items-end gap-3 opacity-30 pointer-events-none transform scale-75 origin-bottom-right">
                  <div className="text-right">
                    <p className="text-[8px] font-black uppercase tracking-[0.1em] text-zinc-400 font-mono">SYS STATUS: OK</p>
                  </div>
                  <div className="w-px h-6 bg-zinc-300 dark:bg-zinc-700" />
                  <div className="flex flex-col">
                    <span className="text-2xl font-black text-slate-800 dark:text-slate-200 tracking-tighter leading-none">
                      {format(new Date(), 'HH:mm')}
                    </span>
                  </div>
                </div>
            </motion.div>
          );
        })()}
        </AnimatePresence>,
        document.body
      )}

      {/* ═══════════════ SELECTED SLOT DETAILS CARD PORTAL ═══════════════ */}
      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {selectedSlotForCard && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[10000] bg-slate-50 dark:bg-slate-900 flex flex-col overflow-hidden text-slate-900 dark:text-white cursor-default"
            >
              {/* Header */}
              <div className="bg-indigo-600 p-5 sm:p-6 text-white relative flex-shrink-0">
                <button
                  onClick={() => setSelectedSlotForCard(null)}
                  className="absolute top-4 right-4 sm:top-5 sm:right-6 p-2 bg-white/10 hover:bg-white/20 text-white rounded-xl transition-all z-30"
                >
                  <X size={20} />
                </button>
                <div className="max-w-7xl mx-auto w-full">
                  <p className="text-[10px] sm:text-xs font-black uppercase tracking-[0.4em] opacity-75 mb-1">
                    {t('actividades.daily.operational_control')}
                  </p>
                  <h3 className="text-2xl sm:text-4xl md:text-5xl font-black uppercase tracking-tight">
                    {selectedSlotForCard.label}
                  </h3>
                </div>
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto md:overflow-hidden custom-scrollbar p-4 sm:p-6 md:p-8 flex flex-col min-h-0">
                <div className="max-w-7xl mx-auto w-full flex-1 flex flex-col min-h-0">
                  {(() => {
                    const shiftStationKey = `${selectedSlotForCard.stationKey}_${activeShift}`;
                    const currentAssignee = getAssignee(selectedDay, shiftStationKey);
                    const currentEmp = currentAssignee
                      ? employees.find((e) => String(e.id) === String(currentAssignee.employee_id))
                      : null;

                    if (currentEmp && !isReassigning) {
                      // Display Employee Profile + Activities
                      // Collect activities from ALL stations this employee is assigned to (not just the clicked one)
                      const empAssignments = assignments.filter(a => 
                        a.assignment_date === selectedDateStr && 
                        a.employee_id === String(currentEmp.id) &&
                        a.sub_position?.endsWith(`_${activeShift}`)
                      );
                      const empStationKeys = empAssignments.map(a => a.main_station).filter(Boolean);
                      // Ensure current station is included
                      const clickedStation = selectedSlotForCard.stationKey || selectedSlotForCard.label;
                      if (!empStationKeys.includes(clickedStation)) {
                        empStationKeys.push(clickedStation);
                      }
                      // Merge activities from all assigned stations, deduplicated
                      const seenIds = new Set<string>();
                      const stationActivitiesList: PositionActivity[] = [];
                      empStationKeys.forEach(sk => {
                        const acts = activityMap[sk] || [];
                        acts.forEach(a => {
                          const key = a.id || a.activity_id || `${sk}_${a.operating_procedures?.activity}`;
                          if (!seenIds.has(key)) {
                            seenIds.add(key);
                            stationActivitiesList.push(a);
                          }
                        });
                      });
                      
                      // Sort activities by category: Apertura (1) -> Regular (2) -> Cierre (3)
                      const sortedActivities = [...stationActivitiesList].sort((a, b) => {
                        const typeA = (a.operating_procedures?.shift_type || 'REGULAR').toUpperCase();
                        const typeB = (b.operating_procedures?.shift_type || 'REGULAR').toUpperCase();
                        const orderA = typeA.includes('APE') || typeA.includes('OPEN') ? 1 : typeA.includes('CIE') || typeA.includes('CLOSE') ? 3 : 2;
                        const orderB = typeB.includes('APE') || typeB.includes('OPEN') ? 1 : typeB.includes('CIE') || typeB.includes('CLOSE') ? 3 : 2;
                        return orderA - orderB;
                      });

                      const totalActivities = sortedActivities.length;
                      
                      // Calculate columns and rows count dynamically to auto-fit
                      const numCols = totalActivities > 20 ? 5 : totalActivities > 12 ? 4 : 3;
                      const numRows = Math.ceil(totalActivities / numCols);
                      
                      let gridColsClass = "grid-cols-2 md:grid-cols-3";
                      let cardPadding = "p-[1.4vh] sm:p-[1.8vh]";
                      let titleFontSize = "text-[1.4vh] sm:text-[1.8vh]";
                      let gapClass = "gap-[1.2vh] sm:gap-[1.6vh]";
                      let badgeSize = "text-[0.9vh] sm:text-[1.1vh]";
                      let clockSize = "text-[1.1vh] sm:text-[1.3vh]";
                      let clockIconClass = "w-[1.2vh] h-[1.2vh] sm:w-[1.5vh] sm:h-[1.5vh]";
                      let checkIconClass = "w-[1.6vh] h-[1.6vh] sm:w-[2vh] sm:h-[2vh]";

                      if (totalActivities > 12) {
                        gridColsClass = "grid-cols-2 md:grid-cols-4";
                        cardPadding = "p-[1.1vh] sm:p-[1.4vh]";
                        titleFontSize = "text-[1.2vh] sm:text-[1.5vh]";
                        gapClass = "gap-[0.9vh] sm:gap-[1.2vh]";
                        badgeSize = "text-[0.8vh] sm:text-[1vh]";
                        clockSize = "text-[1vh] sm:text-[1.2vh]";
                        clockIconClass = "w-[1vh] h-[1vh] sm:w-[1.3vh] sm:h-[1.3vh]";
                        checkIconClass = "w-[1.4vh] h-[1.4vh] sm:w-[1.8vh] sm:h-[1.8vh]";
                      }
                      if (totalActivities > 20) {
                        gridColsClass = "grid-cols-3 md:grid-cols-5";
                        cardPadding = "p-[0.8vh] sm:p-[1.1vh]";
                        titleFontSize = "text-[1vh] sm:text-[1.2vh]";
                        gapClass = "gap-[0.7vh] sm:gap-[0.9vh]";
                        badgeSize = "text-[0.7vh] sm:text-[0.9vh]";
                        clockSize = "text-[0.9vh] sm:text-[1vh]";
                        clockIconClass = "w-[0.9vh] h-[0.9vh] sm:w-[1.1vh] sm:h-[1.1vh]";
                        checkIconClass = "w-[1.2vh] h-[1.2vh] sm:w-[1.5vh] sm:h-[1.5vh]";
                      }

                      return (
                        <div className="grid grid-cols-1 md:grid-cols-12 gap-[2vh] sm:gap-[3vh] flex-1 min-h-0 h-full">
                          {/* Profile Info & Actions Column */}
                          <div className="md:col-span-3 flex flex-col h-full flex-shrink-0">
                            <div className="bg-white dark:bg-slate-800 p-[2vh] rounded-[2vh] shadow-md border border-slate-100 dark:border-slate-800/80 flex flex-col justify-around h-full py-[3vh]">
                              {/* Profile section */}
                              <div className="flex flex-col items-center text-center">
                                <div className="w-[8vh] h-[8vh] sm:w-[10vh] sm:h-[10vh] bg-indigo-600 rounded-[1.8vh] flex items-center justify-center text-[3.5vh] sm:text-[4.5vh] font-black text-white shadow-md italic mb-[1.5vh]">
                                  {(currentEmp.chosen_name || currentEmp.first_name)?.[0]?.toUpperCase()}
                                </div>
                                <h4 className="text-[2vh] sm:text-[2.6vh] font-black text-slate-900 dark:text-white uppercase leading-tight mb-[0.4vh]">
                                  {currentEmp.chosen_name || currentEmp.first_name}
                                </h4>
                                <p className="text-[1.1vh] sm:text-[1.4vh] font-bold text-slate-400 uppercase tracking-widest">
                                  {currentEmp.last_name}
                                </p>
                              </div>

                              {/* Action Buttons section */}
                              <div className="flex flex-col gap-[1.2vh]">
                                <button
                                  onClick={() => {
                                    updateAssignment(
                                      formatDateISO(selectedDay),
                                      selectedSlotForCard.stationKey || selectedSlotForCard.label,
                                      '',
                                      currentAssignee?.station_group || 'front'
                                    );
                                    setSelectedSlotForCard(null);
                                  }}
                                  className="w-full flex items-center justify-center gap-[1vh] py-[1.2vh] px-[1.6vh] bg-red-500 hover:bg-red-600 text-white rounded-[1vh] font-bold uppercase tracking-wider text-[1.1vh] sm:text-[1.3vh] transition-all shadow-sm active:scale-95"
                                >
                                  <UserMinus className="w-[1.5vh] h-[1.5vh] sm:w-[1.8vh] sm:h-[1.8vh]" />
                                  {t('actividades.daily.mark_absent')}
                                </button>
                                <button
                                  onClick={() => setIsReassigning(true)}
                                  className="w-full flex items-center justify-center gap-[1vh] py-[1.2vh] px-[1.6vh] bg-indigo-600 hover:bg-indigo-700 text-white rounded-[1vh] font-bold uppercase tracking-wider text-[1.1vh] sm:text-[1.3vh] transition-all shadow-sm active:scale-95"
                                >
                                  <RefreshCw className="w-[1.5vh] h-[1.5vh] sm:w-[1.8vh] sm:h-[1.8vh]" />
                                  {t('actividades.daily.change_person')}
                                </button>
                              </div>
                            </div>
                          </div>

                          {/* Activities checklist */}
                          <div className="md:col-span-9 flex flex-col min-h-0 h-full">
                            <div className="bg-white dark:bg-slate-800 p-[2vh] rounded-[2vh] shadow-md border border-slate-100 dark:border-slate-800/80 h-full flex flex-col min-h-0">
                              <div className="flex items-center justify-between mb-[1.5vh] pb-[1vh] border-b border-slate-100 dark:border-slate-700 flex-shrink-0">
                                <div className="flex items-center gap-[1vh]">
                                  <div className="p-[0.8vh] bg-indigo-600 text-white rounded-[0.8vh] shadow">
                                    <ClipboardList className="w-[1.6vh] h-[1.6vh] sm:w-[2vh] sm:h-[2vh]" />
                                  </div>
                                  <h5 className="text-[1.6vh] sm:text-[2.2vh] font-black text-slate-900 dark:text-white uppercase tracking-tight">
                                    {t('actividades.daily.activities_label')}
                                  </h5>
                                </div>
                                <span className="bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 py-[0.4vh] px-[1.2vh] rounded-full text-[1vh] sm:text-[1.2vh] font-black uppercase tracking-widest">
                                  {format(selectedDay, 'EEEE dd', { locale })}
                                </span>
                              </div>
                              <div className="flex-grow overflow-y-auto md:overflow-hidden custom-scrollbar pr-1 min-h-0 pb-2">
                                {sortedActivities.length > 0 ? (
                                  <div 
                                    className={`grid ${gridColsClass} ${gapClass} h-full`}
                                    style={{
                                      gridTemplateRows: `repeat(${numRows}, 1fr)`
                                    }}
                                  >
                                    {sortedActivities.map((pa, i) => {
                                      const proc = pa.operating_procedures;
                                      if (!proc) return null;
                                      
                                      const category = (proc.shift_type || 'REGULAR').toUpperCase();
                                      const isApertura = category.includes('APE') || category.includes('OPEN');
                                      const isCierre = category.includes('CIE') || category.includes('CLOSE');
                                      
                                      const badgeColor = isApertura
                                        ? 'bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border-amber-200/50'
                                        : isCierre
                                        ? 'bg-purple-100 dark:bg-purple-950/40 text-purple-700 dark:text-purple-400 border-purple-200/50'
                                        : 'bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400 border-blue-200/50';

                                      return (
                                        <div
                                          key={i}
                                          className={`flex flex-col justify-between ${cardPadding} bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-[1.2vh] hover:bg-indigo-50/30 dark:hover:bg-indigo-950/10 hover:border-indigo-100 dark:hover:border-indigo-900/50 transition-all shadow-sm h-full`}
                                          title={proc.activity}
                                        >
                                          <div className="mb-[0.5vh]">
                                            <span className={`inline-block ${badgeSize} font-extrabold px-[0.6vh] py-[0.2vh] rounded border uppercase tracking-wider mb-[0.4vh] ${badgeColor}`}>
                                              {proc.shift_type || 'REGULAR'}
                                            </span>
                                            <span 
                                              className={`block ${titleFontSize} font-black text-slate-800 dark:text-slate-100 uppercase tracking-tight leading-tight`}
                                              style={{
                                                display: '-webkit-box',
                                                WebkitLineClamp: 2,
                                                WebkitBoxOrient: 'vertical',
                                                overflow: 'hidden'
                                              }}
                                            >
                                              {proc.activity}
                                            </span>
                                          </div>
                                          <div className="flex items-center justify-between mt-[0.5vh] pt-[0.4vh] border-t border-slate-100 dark:border-slate-800">
                                            {proc.start_time ? (
                                              <div className="flex items-center gap-[0.5vh]">
                                                <Clock className={`${clockIconClass} text-amber-500`} />
                                                <span className={`${clockSize} font-extrabold text-amber-600 dark:text-amber-400 uppercase tracking-wider`}>
                                                  {formatActivityTime(proc.start_time)}
                                                </span>
                                              </div>
                                            ) : (
                                              <div />
                                            )}
                                            <CheckCircle2 className={`${checkIconClass} text-indigo-300 dark:text-indigo-700`} />
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                ) : (
                                  <div className="py-16 flex flex-col items-center justify-center opacity-30">
                                    <ClipboardList size={48} className="mb-3" />
                                    <p className="text-sm font-black text-slate-400 uppercase italic tracking-widest">
                                      {t('actividades.daily.no_activities_assigned')}
                                    </p>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    }

                    // Reassignment select panel
                    return (
                      <div className="space-y-6 max-w-4xl mx-auto w-full flex-1 flex flex-col min-h-0">
                        <div className="flex items-center justify-between flex-shrink-0">
                          <h4 className="text-lg sm:text-xl font-black text-slate-400 uppercase tracking-widest italic">
                            {t('actividades.daily.reassign_position')}
                          </h4>
                          {currentEmp && (
                            <button
                              onClick={() => setIsReassigning(false)}
                              className="text-xs font-bold text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950 px-3.5 py-1.5 rounded-lg transition-all"
                            >
                              {t('actividades.daily.back_to_profile')}
                            </button>
                          )}
                        </div>
                        <div className="flex-1 overflow-y-auto space-y-2.5 pr-2 custom-scrollbar min-h-0">
                          <button
                            onClick={() => {
                              updateAssignment(
                                formatDateISO(selectedDay),
                                selectedSlotForCard.stationKey || selectedSlotForCard.label,
                                '',
                                currentAssignee?.station_group || 'front'
                              );
                              setSelectedSlotForCard(null);
                            }}
                            className="w-full p-4 rounded-xl sm:rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 font-black uppercase tracking-widest text-sm hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-all text-left flex items-center gap-4"
                          >
                            <X size={18} />
                            <span>{t('actividades.daily.leave_vacant')}</span>
                          </button>
                          {(() => {
                            // Only show employees scheduled at this store today (from roster)
                            const rosterEmployees = todayShifts
                              .filter(s => !s.is_callback)
                              .map(s => employees.find(e => String(e.id) === String(s.employee_id)))
                              .filter((e): e is Employee => !!e)
                              // Deduplicate (cross-shift employees may appear twice)
                              .filter((e, idx, arr) => arr.findIndex(x => String(x.id) === String(e.id)) === idx);

                            return rosterEmployees.map((e) => {
                            const shiftSuffix = `_${activeShift}`;
                            const isBusy = assignments.some(
                              (a) =>
                                a.assignment_date === formatDateISO(selectedDay) &&
                                a.sub_position.endsWith(shiftSuffix) &&
                                String(a.employee_id) === String(e.id)
                            );
                            if (isBusy && String(e.id) !== String(currentEmp?.id)) return null;
                            return (
                              <button
                                key={e.id}
                                onClick={() => {
                                  updateAssignment(
                                    formatDateISO(selectedDay),
                                    selectedSlotForCard.stationKey || selectedSlotForCard.label,
                                    String(e.id),
                                    currentAssignee?.station_group || 'front'
                                  );
                                  setSelectedSlotForCard(null);
                                }}
                                className="w-full p-4 rounded-xl sm:rounded-2xl bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 shadow-sm hover:border-indigo-500 dark:hover:border-indigo-500 hover:bg-indigo-50/30 dark:hover:bg-indigo-950/10 transition-all text-left flex items-center gap-5 group"
                              >
                                <div className="w-12 h-12 bg-slate-50 dark:bg-slate-900 rounded-xl flex items-center justify-center text-lg font-black text-slate-400 group-hover:text-indigo-600 shadow-inner">
                                  {(e.chosen_name || e.first_name)?.[0]?.toUpperCase()}
                                </div>
                                <div>
                                  <p className="text-base font-black text-slate-900 dark:text-white uppercase leading-none mb-1">
                                    {e.chosen_name || e.first_name}
                                  </p>
                                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                                    {e.last_name}
                                  </p>
                                </div>
                              </button>
                            );
                          });
                          })()}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}

      {/* Webkit scrollbar styling */}
      <style dangerouslySetInnerHTML={{__html: `
        .custom-scrollbar::-webkit-scrollbar { height: 8px; width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #e2e8f0; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #cbd5e1; }
      `}} />
    </div>
  );
}
