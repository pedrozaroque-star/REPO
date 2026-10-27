'use client';

/**
 * @module AsignacionDiariaTab
 * @description Tab de asignación diaria de empleados a estaciones/posiciones operativas.
 *   Permite a los managers asignar personal a cada estación de trabajo por día y turno,
 *   visualizando un mapa de estaciones con actividades (checklist) provenientes de position_activities.
 * @businessRules
 *   - El día laboral inicia a las 6:00 AM y finaliza a las 5:59 AM del día siguiente (`America/Los_Angeles`).
 *   - El turno PM inicia a las 5:00 PM (`America/Los_Angeles`).
 *   - Auto-Reconfiguración 24/7 y Modal de Despertar Tableta (3h de inactividad):
 *     A las 6:00 AM cambia automáticamente al nuevo día de negocio y turno AM; a las 5:00 PM cambia automáticamente al turno PM;
 *     limpia cachés obsoletas cada 15 min; retorna automáticamente al día/turno actual tras 2 min de inactividad;
 *     y muestra el modal "☀️ Despertar Tableta" tras 3h sin actividad.
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
 *   - i18n keys bajo namespace `actividades.daily.*` y `prep.*` para controles de despertar tableta.
 *   - Fix: Motor unificado `resolveStationActivities` compartido con Correo, Calendario y Checklist.
 *   - Fix: El Tablero Visual (`showVisualBoard`) conserva el mapa físico de estaciones (Salón, Cocina y, en tiendas con Drive-Thru, Drive-Thru en la parte inferior con ajuste proporcional de tarjetas sin scroll). Liderazgo y Actividades Extra se gestionan en la vista de lista de Asignación Diaria, Checklist, Correo y Calendario.
 *   - Fix: Restricción de edición de asignaciones (`canEditAssignments`) para que `shift_leader` consulte el tablero sin permisos de escritura sobre asignaciones.
 *   - Fix: La clonación de semana completa compara `expected_revision` del destino dentro de la RPC; cambios concurrentes se rechazan sin reemplazar asignaciones recientes.
 *   - Fix: Al abrir una estación en el Tablero Operativo (`selectedSlotForCard`), el panel de actividades soporta Zoom táctil con 2 dedos (`pinch-to-zoom`), controles `- / 100% / +` (hasta 250% con reacomodo automático de columnas y tipografía fluida) y vista ampliada de tarjeta individual al tocar cualquier actividad (con navegación `< Anterior / Siguiente >`).
 */

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
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
  Zap,
  Eye,
  Mail,
  ZoomIn,
  ZoomOut,
  Maximize2,
} from 'lucide-react';
import { useLanguage } from '@/lib/i18n';
import { useAuth } from '@/components/ProtectedRoute';
import { useWakeLock } from '@/lib/use-wake-lock';
import { purgeTabletStaleCaches } from '@/lib/tablet-cache-cleaner';
import { supabase } from '@/lib/supabase';
import {
  calculateStoreOffsetsForDate,
  applyTimeOffset,
  type StoreOffsets,
  type StoreDayHours,
} from '@/lib/store-time-offset';
import {
  type ClearedStationAssignmentScope,
  doesShiftOverlapPeriod,
  extractCatalogProceduresPayload,
  extractLiteralShiftSuffix,
  getStationConfigStatus,
  getStoreOverrideForProcedure,
  getBusinessDaySortMinutes,
  isConfirmedStoreDriveThru,
  normalizeAssignmentSubPosition,
  normalizeText,
  isStorePilotActiveForActivitiesEmail,
  resolveStationActivities,
  filterApprovedPositionActivities,
  sanitizeUnsafeProcedureDescription,
} from '@/lib/actividades-resolution';
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
  opening_time?: string | null;
  closing_time?: string | null;
  weekly_hours?: StoreDayHours[] | string | null;
  has_drive_thru?: boolean | null;
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
    shift?: string;
    frequency: string;
    role: string;
    store_model?: string;
    description: string;
    overrides?: Record<string, any> | null;
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
      'TORTAS/MULITAS',
      'CUBRIR DESCANSOS (COCINA)',
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
    stations: ['Ventana 1', 'Ventana 2', 'Ventana 2 (B)', 'TORTAS/QUESADILLAS (DT)', 'TACOS/BURRITOS (DT)', 'CUBRIR DESCANSOS (DT)'],
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

/** Determine current operational shift in California (AM: 6:00 AM - 4:59 PM, PM: 5:00 PM - 5:59 AM) */
const getCurrentShiftLA = (): 'AM' | 'PM' => {
  const la = getLATime();
  const h = la.getHours();
  return h >= 17 || h < 6 ? 'PM' : 'AM';
};

/** Format date as YYYY-MM-DD */
const formatDateISO = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};
/** Get hour in LA timezone safely */
const getHourLA = (timeStr: string): number => {
  if (!timeStr) return -1;
  // Si es formato HH:MM:SS simple (no ISO), parsear directamente
  if (timeStr.includes(':') && !timeStr.includes('T')) {
    return parseInt(timeStr.split(':')[0], 10);
  }
  // Si es formato ISO, convertir a hora de Los Ángeles
  try {
    const d = new Date(timeStr);
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles', hour: 'numeric', hour12: false
    }).formatToParts(d);
    const hourPart = parts.find(p => p.type === 'hour');
    return hourPart ? parseInt(hourPart.value, 10) % 24 : d.getHours();
  } catch { return -1; }
};

/** Detect shift from ISO start_time */
const getShiftFromTime = (startTimeStr: string): 'AM' | 'PM' => {
  const hour = getHourLA(startTimeStr);
  if (hour === -1) return 'AM';
  return hour >= 17 || hour < 6 ? 'PM' : 'AM';
};

/** Format ISO time to "8:00 AM" style */
const formatTimeTo12h = (isoTime: string): string => {
  if (!isoTime) return '';
  try {
    if (isoTime.includes(':') && !isoTime.includes('T')) {
      const parts = isoTime.split(':');
      let h = parseInt(parts[0], 10);
      const m = parts[1] || '00';
      const ampm = h >= 12 ? 'PM' : 'AM';
      h = h % 12 || 12;
      return `${h}:${m.padStart(2, '0')} ${ampm}`;
    }
    const d = new Date(isoTime);
    if (isNaN(d.getTime())) return isoTime;
    
    // Parse in LA timezone
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    }).formatToParts(d);
    
    const h = parts.find(p => p.type === 'hour')?.value;
    const m = parts.find(p => p.type === 'minute')?.value;
    const ampm = parts.find(p => p.type === 'dayPeriod')?.value;
    
    if (h && m && ampm) return `${h}:${m} ${ampm.toUpperCase()}`;
    
    return isoTime;
  } catch {
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
    ? employees.find((e) => String(e.id) === String(assignee.employee_id)) || (assignee as any).toast_employees
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
      data-touch-tap="true"
      data-testid="visual-board-slot"
      data-station-key={stationKey}
      data-station-group={group}
      onClick={() => onClick(stationKey, label, group, emp, assignee)}
      className={`p-[0.15vh] flex flex-col h-full cursor-pointer group active:scale-95 transition-all select-none touch-manipulation ${className}`}
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
  const { user } = useAuth();

  // Auto-detectar tienda del usuario logueado (Auto-detect logged-in user's store)
  // Admin y Supervisor pueden cambiar a cualquier tienda; Manager solo su tienda
  const userRole = (user?.role || '').toLowerCase();
  const canChangeStore = ['admin', 'supervisor'].includes(userRole);
  const canEditAssignments = ['admin', 'supervisor', 'manager', 'asistente', 'assistant'].includes(userRole);

  // ── State ──
  const [stores, setStores] = useState<Store[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState<string>(() => {
    if (user?.store_id) return String(user.store_id);
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('actividades_store_id');
        if (saved) return saved;
      } catch {}
    }
    return '7';
  });
  const [currentWeekStart, setCurrentWeekStart] = useState<Date>(() =>
    startOfWeek(getBusinessToday(), { weekStartsOn: 1 })
  );
  const [selectedDay, setSelectedDay] = useState<Date>(() => getBusinessToday());
  const [activeShift, setActiveShift] = useState<'AM' | 'PM'>(() => getCurrentShiftLA());
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [copying, setCopying] = useState(false);
  const [copyingAll, setCopyingAll] = useState(false);

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [shifts, setShifts] = useState<ShiftRecord[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [persistedAssignments, setPersistedAssignments] = useState<Assignment[]>([]);
  const [assignmentsRevision, setAssignmentsRevision] = useState<string | null>(null);
  const assignmentsRevisionsByShiftRef = useRef<{ ALL: string | null; AM: string | null; PM: string | null }>({
    ALL: null,
    AM: null,
    PM: null,
  });
  const [remoteUpdatePending, setRemoteUpdatePending] = useState(false);
  const [weekShiftEmpIds, setWeekShiftEmpIds] = useState<Set<string>>(new Set());
  const [positionActivities, setPositionActivities] = useState<PositionActivity[]>([]);
  const [allProcedures, setAllProcedures] = useState<Array<NonNullable<PositionActivity['operating_procedures']>>>([]);
  const [driveThruCollapsed, setDriveThruCollapsed] = useState(false);

  // ── Vista Previa de Correo / Publicación (Fase 5) ──
  const [showPublishPreviewModal, setShowPublishPreviewModal] = useState(false);
  const [publishPreviewLoading, setPublishPreviewLoading] = useState(false);
  const [publishPreviewData, setPublishPreviewData] = useState<any | null>(null);

  // ── Secuencias para descartar respuestas obsoletas al cambiar de tienda/fecha (A15) ──
  const shiftsReqSeqRef = useRef(0);
  const assignmentsReqSeqRef = useRef(0);
  const weekShiftsReqSeqRef = useRef(0);
  const employeesReqSeqRef = useRef(0);
  const isDirtyRef = useRef(false);

  // @notes: Bug 1 - Sync selectedStoreId when user loads for managers to avoid race condition
  useEffect(() => {
    if (user?.store_id && (userRole === 'manager' || userRole === 'asistente')) {
      setSelectedStoreId(String(user.store_id));
    }
  }, [user?.store_id, userRole]);

  // ── Visual Board States ──
  const [showVisualBoard, setShowVisualBoard] = useState(false);
  const [selectedSlotForCard, setSelectedSlotForCard] = useState<{ label: string; assignee: any; stationKey?: string } | null>(null);
  const [selectedEmployeeCard, setSelectedEmployeeCard] = useState<Employee | null>(null);
  const [isReassigning, setIsReassigning] = useState(false);
  const [hasDriveThru, setHasDriveThru] = useState(false);
  const activitiesScrollRef = useRef<HTMLDivElement | null>(null);
  const [canScrollDownActivities, setCanScrollDownActivities] = useState(false);
  const [boardActivitiesZoom, setBoardActivitiesZoom] = useState<number>(1);
  const [expandedBoardActivityIndex, setExpandedBoardActivityIndex] = useState<number | null>(null);
  const pinchStartDistRef = useRef<number | null>(null);
  const pinchStartZoomRef = useRef<number>(1);

  useEffect(() => {
    setBoardActivitiesZoom(1);
    setExpandedBoardActivityIndex(null);
    pinchStartDistRef.current = null;
  }, [selectedSlotForCard?.stationKey, selectedSlotForCard?.label]);

  const handleActivitiesTouchStart = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        pinchStartDistRef.current = Math.hypot(dx, dy);
        pinchStartZoomRef.current = boardActivitiesZoom;
      }
    },
    [boardActivitiesZoom]
  );

  const handleActivitiesTouchMove = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length === 2 && pinchStartDistRef.current && pinchStartDistRef.current > 10) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      const scaleRatio = dist / pinchStartDistRef.current;
      const nextZoom = Math.min(2.5, Math.max(1, Number((pinchStartZoomRef.current * scaleRatio).toFixed(2))));
      setBoardActivitiesZoom(nextZoom);
    }
  }, []);

  const handleActivitiesTouchEnd = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length < 2) {
      pinchStartDistRef.current = null;
    }
  }, []);

  const handleActivitiesWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.15 : -0.15;
      setBoardActivitiesZoom((prev) => Math.min(2.5, Math.max(1, Number((prev + delta).toFixed(2)))));
    }
  }, []);

  const checkActivitiesScroll = useCallback(() => {
    const el = activitiesScrollRef.current;
    if (!el) {
      setCanScrollDownActivities(false);
      return;
    }
    setCanScrollDownActivities(el.scrollHeight - el.scrollTop - el.clientHeight > 12);
  }, []);

  useEffect(() => {
    if (!selectedSlotForCard || isReassigning) {
      setCanScrollDownActivities(false);
      return;
    }
    const t1 = window.setTimeout(checkActivitiesScroll, 50);
    const t2 = window.setTimeout(checkActivitiesScroll, 220);
    window.addEventListener('resize', checkActivitiesScroll);
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && activitiesScrollRef.current) {
      ro = new ResizeObserver(() => checkActivitiesScroll());
      ro.observe(activitiesScrollRef.current);
      if (activitiesScrollRef.current.firstElementChild) {
        ro.observe(activitiesScrollRef.current.firstElementChild);
      }
    }
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.removeEventListener('resize', checkActivitiesScroll);
      if (ro) ro.disconnect();
    };
  }, [selectedSlotForCard, isReassigning, activeShift, selectedDay, positionActivities, assignments, boardActivitiesZoom, checkActivitiesScroll]);

  // ── Auto-Reconfiguración 24/7 y Modal de 3h de Inactividad ──
  const [liveNow, setLiveNow] = useState<Date>(() => new Date());
  const [wakingUpTablet, setWakingUpTablet] = useState(false);
  const [tabletWakeSuccess, setTabletWakeSuccess] = useState(false);
  const [showWakeUpModal, setShowWakeUpModal] = useState(false);
  const lastInteractionAtRef = useRef<number>(Date.now());
  const lastBusinessDateRef = useRef<string>(formatDateISO(getBusinessToday()));
  const lastAutoShiftRef = useRef<'AM' | 'PM'>(getCurrentShiftLA());

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

  // ── Wake Lock 24/7: Prevenir que la tableta se duerma (con respaldo de video silencioso) ──
  const wakeLock = useWakeLock(true);
  const isScreenAwake = wakeLock.isActive;

  // Rastrear actividad del usuario para auto-retorno a Hoy/Turno (2 min) y modal de despertar (3 horas)
  useEffect(() => {
    const markInteraction = () => {
      lastInteractionAtRef.current = Date.now();
    };
    window.addEventListener('pointerdown', markInteraction, { passive: true });
    window.addEventListener('keydown', markInteraction, { passive: true });
    window.addEventListener('touchstart', markInteraction, { passive: true });
    window.addEventListener('wheel', markInteraction, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', markInteraction);
      window.removeEventListener('keydown', markInteraction);
      window.removeEventListener('touchstart', markInteraction);
      window.removeEventListener('wheel', markInteraction);
    };
  }, []);

  // Limpieza automática de cachés obsoletas y renovación silenciosa de JWT cada 15 minutos
  useEffect(() => {
    void purgeTabletStaleCaches();
    const cacheInterval = setInterval(() => {
      void purgeTabletStaleCaches({ force: true });
    }, 15 * 60 * 1000);
    return () => clearInterval(cacheInterval);
  }, []);

  // Centinela cada 15s: reloj en vivo, corte 6:00 AM CA (día + semana + turno AM), corte 5:00 PM CA (turno PM),
  // auto-retorno tras 2 min de inactividad en modo Tablero (o 15 min en editor sin cambios locales), y modal de despertar tras 3 horas (A05, A14)
  useEffect(() => {
    const INACTIVITY_WAKE_MODAL_MS = 3 * 60 * 60 * 1000; // 3 horas
    const IDLE_RETURN_BOARD_MS = 10 * 60 * 1000; // 10 minutos en modo Tablero
    const IDLE_RETURN_EDITOR_MS = 15 * 60 * 1000; // 15 minutos en modo Editor (solo si no hay borrador sucio)

    const timer = setInterval(() => {
      setLiveNow(new Date());
      const todayBDate = getBusinessToday();
      const todayBDateStr = formatDateISO(todayBDate);
      const currentShiftNow = getCurrentShiftLA();
      const idleMs = Date.now() - lastInteractionAtRef.current;

      // Caso 1: Cruce de 6:00 AM en California (Nuevo Día Laboral)
      if (lastBusinessDateRef.current && lastBusinessDateRef.current !== todayBDateStr) {
        if (!isDirtyRef.current) {
          console.log(`[Actividades 24/7] 🌅 Cambio de día laboral detectado: ${lastBusinessDateRef.current} -> ${todayBDateStr}`);
          lastBusinessDateRef.current = todayBDateStr;
          lastAutoShiftRef.current = currentShiftNow;
          setCurrentWeekStart(startOfWeek(todayBDate, { weekStartsOn: 1 }));
          setSelectedDay(todayBDate);
          setActiveShift(currentShiftNow);
          setSelectedSlotForCard(null);
          setSelectedEmployeeCard(null);
          setIsReassigning(false);
          void purgeTabletStaleCaches({ force: true });
        }
      } else if (lastAutoShiftRef.current !== currentShiftNow) {
        // Caso 2: Cruce automático de turno (ej. 5:00 PM -> cambio automático de AM a PM)
        lastAutoShiftRef.current = currentShiftNow;
        if (!isDirtyRef.current) {
          console.log(`[Actividades 24/7] 🌇 Cambio automático de turno detectado: -> ${currentShiftNow}`);
          setActiveShift(currentShiftNow);
          setSelectedSlotForCard(null);
          setSelectedEmployeeCard(null);
          setIsReassigning(false);
        }
      } else {
        lastBusinessDateRef.current = todayBDateStr;
        // Caso 3: Retorno automático solo si no hay cambios locales sin guardar (A05, A14)
        const viewedDateStr = formatDateISO(selectedDay);
        const returnThresholdMs = showVisualBoard ? IDLE_RETURN_BOARD_MS : IDLE_RETURN_EDITOR_MS;
        if (
          !isDirtyRef.current &&
          (viewedDateStr !== todayBDateStr || activeShift !== currentShiftNow) &&
          idleMs >= returnThresholdMs
        ) {
          console.log(`[Actividades 24/7] 🔄 Retornando automáticamente a Hoy (${todayBDateStr}) y turno ${currentShiftNow}`);
          setCurrentWeekStart(startOfWeek(todayBDate, { weekStartsOn: 1 }));
          setSelectedDay(todayBDate);
          setActiveShift(currentShiftNow);
          setSelectedSlotForCard(null);
          setSelectedEmployeeCard(null);
          setIsReassigning(false);
        }
      }

      // Caso 4: Tras 3 horas de inactividad continua, mostrar modal para despertar tableta
      if (!showWakeUpModal && !wakingUpTablet && idleMs >= INACTIVITY_WAKE_MODAL_MS) {
        setShowWakeUpModal(true);
      }
    }, 15_000);

    return () => clearInterval(timer);
  }, [selectedDay, activeShift, showVisualBoard, showWakeUpModal, wakingUpTablet]);

  // ── Derived ──
  const selectedStore = useMemo(() => {
    return stores.find(
      (s) => String(s.id) === String(selectedStoreId) || String(s.external_id) === String(selectedStoreId)
    );
  }, [stores, selectedStoreId]);

  const selectedStoreGuid = useMemo(() => {
    return selectedStore?.external_id || '';
  }, [selectedStore]);

  const selectedDateStr = useMemo(() => formatDateISO(selectedDay), [selectedDay]);

  // Calcular desfases horarios por tienda y día de la semana (A01, A02, A03)
  const storeOffsets: StoreOffsets = useMemo(() => {
    if (!selectedStore) return { openingOffsetMinutes: 0, closingOffsetMinutes: 0, isValidConfig: false };
    return calculateStoreOffsetsForDate(selectedStore, selectedDateStr);
  }, [selectedStore, selectedDateStr]);

  // Detectar si existen cambios locales sin guardar en la vista actual (A14)
  const isDirty = useMemo(() => {
    const serializeSlice = (list: Assignment[]) =>
      list
        .filter(
          (a) =>
            a.assignment_date === selectedDateStr &&
            a.sub_position?.endsWith(`_${activeShift}`) &&
            Boolean(a.employee_id)
        )
        .map((a) => `${a.sub_position}:${a.employee_id}:${a.main_station || ''}:${(a.tasks || []).join(',')}`)
        .sort()
        .join('|');
    return serializeSlice(assignments) !== serializeSlice(persistedAssignments);
  }, [assignments, persistedAssignments, selectedDateStr, activeShift]);

  useEffect(() => {
    isDirtyRef.current = isDirty;
  }, [isDirty]);

  // Advertir antes de cerrar la pestaña del navegador si hay cambios sin guardar
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirtyRef.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  // has_drive_thru solo se activa cuando la sucursal tiene has_drive_thru === true confirmado (nunca asumir true cuando es desconocido)
  useEffect(() => {
    setHasDriveThru(isConfirmedStoreDriveThru(selectedStore));
  }, [selectedStore]);

  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => addDays(currentWeekStart, i));
  }, [currentWeekStart]);

  const weekRangeLabel = useMemo(() => {
    const start = currentWeekStart;
    const end = addDays(start, 6);
    return `${format(start, 'MMM d', { locale })} - ${format(end, 'MMM d, yyyy', { locale })}`;
  }, [currentWeekStart, locale]);

  // Filtrar turnos por traslape real de intervalo con el periodo AM o PM (A06)
  // AM window: 06:00 - 16:59 | PM window: 17:00 - 05:59 (día siguiente)
  const todayShifts = useMemo(() => {
    return shifts.filter((s) => {
      if (s.shift_date !== selectedDateStr) return false;
      return doesShiftOverlapPeriod(s.start_time, s.end_time, activeShift);
    });
  }, [shifts, selectedDateStr, activeShift]);

  // Build roster of employees for the day
  const roster = useMemo(() => {
    return todayShifts.map((s) => {
      const emp = employees.find((e) => String(e.id) === String(s.employee_id));
      const isAssigned = assignments.some(
        (a) =>
          a.assignment_date === selectedDateStr &&
          String(a.employee_id) === String(s.employee_id) &&
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

  // Employees assigned to this store but NOT scheduled for today (day off / vacation)
  const offDutyEmployees = useMemo(() => {
    const todayScheduledIds = new Set(shifts.filter(s => s.shift_date === selectedDateStr).map(s => String(s.employee_id)));
    return employees
      .filter((e) => !e.deleted && !todayScheduledIds.has(String(e.id)) && weekShiftEmpIds.has(String(e.id)))
      .sort((a, b) => getDisplayName(a).localeCompare(getDisplayName(b)));
  }, [employees, shifts, selectedDateStr, weekShiftEmpIds]);

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

  // Helper para obtener la hora efectiva ya resuelta por `resolveStationActivities` (sin doble offset)
  const getAdjustedProcTime = useCallback(
    (proc?: PositionActivity['operating_procedures'] | null): string => {
      if (!proc) return '';
      return String(proc.start_time || '').trim();
    },
    []
  );

  const approvedPositionActivities = useMemo(() => {
    return filterApprovedPositionActivities(positionActivities);
  }, [positionActivities]);

  // Activity map: station -> activities[] resueltas con el motor compartido `resolveStationActivities` (Hallazgo 6)
  const activityMap = useMemo(() => {
    const map: Record<string, PositionActivity[]> = {};
    const allSectionStations = SECTIONS.flatMap((s) => s.stations);
    const storeContext = selectedStore
      ? { ...selectedStore, has_drive_thru: hasDriveThru }
      : { has_drive_thru: hasDriveThru };

    const procById = new Map<string, NonNullable<PositionActivity['operating_procedures']>>();
    for (const proc of allProcedures) {
      if (proc?.id) {
        procById.set(proc.id, proc);
      }
    }
    for (const pa of approvedPositionActivities) {
      if (pa.operating_procedures?.id && !procById.has(pa.operating_procedures.id)) {
        procById.set(pa.operating_procedures.id, pa.operating_procedures);
      }
    }
    const catalogProcs = Array.from(procById.values());

    for (const stationName of allSectionStations) {
      const subPos = `${stationName}_${activeShift}`;
      const assigned = assignmentMap[subPos];
      const empShift = assigned?.employee_id
        ? todayShifts.find(
            (s) =>
              String(s.employee_id) === String(assigned.employee_id) &&
              !s.is_callback
          )
        : undefined;

      // En las tarjetas por estación de un turno (AM o PM), SIEMPRE se deben mostrar
      // todas las actividades configuradas para esa estación en ese turno (`enforceShiftWindow: false`),
      // igual que en `/api/notifications/publish-schedule` y `/api/schedule/calendar`.
      const resolvedItems = resolveStationActivities({
        mainStation: stationName,
        subPosition: subPos,
        shift: activeShift,
        businessDateStr: selectedDateStr,
        store: storeContext,
        procedures: catalogProcs as any,
        positionActivities: approvedPositionActivities as any,
        legacyTasks: assigned?.tasks || null,
        storeOffsets,
        shiftStartTime: empShift?.start_time || null,
        shiftEndTime: empShift?.end_time || null,
        enforceShiftWindow: false,
      });

      map[stationName] = resolvedItems.map((item) => {
        const rawProc = item.activity_id ? procById.get(item.activity_id) : undefined;
        return {
          id: item.occurrence_key,
          position_key: stationName,
          shift: item.shift,
          activity_id: item.activity_id || item.occurrence_key,
          frequency: item.frequency,
          store_model: item.store_model,
          sort_order: item.order_index ?? 999,
          operating_procedures: {
            id: item.activity_id || item.occurrence_key,
            activity: item.title,
            start_time: item.effective_start_time || '',
            duration_minutes: item.duration_minutes ?? rawProc?.duration_minutes ?? 15,
            shift_type: item.category,
            shift: item.shift,
            frequency: item.frequency,
            role: rawProc?.role || 'STAFF',
            store_model: item.store_model,
            description: sanitizeUnsafeProcedureDescription(item.description),
            overrides: rawProc?.overrides || null,
          },
        };
      });
    }

    return map;
  }, [
    allProcedures,
    approvedPositionActivities,
    activeShift,
    selectedDateStr,
    hasDriveThru,
    selectedStore,
    storeOffsets,
    assignmentMap,
    todayShifts,
  ]);

  // ── Data Fetching con protección contra condiciones de carrera (A15) ──
  const fetchStores = useCallback(async () => {
    const { data } = await supabase
      .from('stores')
      .select('id, name, external_id, opening_time, closing_time, weekly_hours, has_drive_thru')
      .order('name');
    if (data) setStores(data as Store[]);
  }, []);

  const fetchShifts = useCallback(async () => {
    if (!selectedStoreGuid) return;
    const seq = ++shiftsReqSeqRef.current;
    const { data } = await supabase
      .from('shifts')
      .select('*')
      .eq('store_id', selectedStoreGuid)
      .eq('shift_date', selectedDateStr);
    if (seq !== shiftsReqSeqRef.current) return;
    setShifts((data || []) as ShiftRecord[]);
  }, [selectedStoreGuid, selectedDateStr]);

  const fetchEmployees = useCallback(async () => {
    if (!selectedStoreGuid) return;
    const seq = ++employeesReqSeqRef.current;
    try {
      const res = await fetch(
        `/api/roles/employees?store_id=${encodeURIComponent(selectedStoreGuid)}&reference_date=${encodeURIComponent(selectedDateStr)}`
      );
      if (res.ok) {
        const data = await res.json();
        if (seq !== employeesReqSeqRef.current) return;
        if (Array.isArray(data)) {
          setEmployees(data as Employee[]);
          return;
        }
      }
    } catch (err) {
      console.error('[fetchEmployees] Error fetching scoped store employees:', err);
    }
  }, [selectedStoreGuid, selectedDateStr]);

  const fetchAssignments = useCallback(
    async (options?: { forceOverwrite?: boolean }) => {
      if (!selectedStoreGuid) return;
      const seq = ++assignmentsReqSeqRef.current;
      try {
        const res = await fetch(
          `/api/roles?store_id=${encodeURIComponent(selectedStoreGuid)}&start_date=${selectedDateStr}&end_date=${selectedDateStr}&include_meta=1`
        );
        if (!res.ok) {
          console.error(`[fetchAssignments] HTTP ${res.status}:`, await res.text());
          return;
        }
        const data = await res.json();
        if (seq !== assignmentsReqSeqRef.current) return;

        const rawFetchedList: Assignment[] = Array.isArray(data)
          ? data
          : Array.isArray(data?.assignments)
          ? data.assignments
          : Array.isArray(data?.data)
          ? data.data
          : [];
        const fetchedList: Assignment[] = rawFetchedList.map((a) => ({
          ...a,
          sub_position: normalizeAssignmentSubPosition(a.main_station, a.sub_position, 'AM'),
        }));
        const fetchedRev: string | null =
          !Array.isArray(data) && typeof data?.revision === 'string' ? data.revision : null;

        setPersistedAssignments(fetchedList);
        if (fetchedRev) {
          setAssignmentsRevision(fetchedRev);
          assignmentsRevisionsByShiftRef.current = {
            ALL: fetchedRev,
            AM: typeof data?.revisions?.AM === 'string' ? data.revisions.AM : fetchedRev,
            PM: typeof data?.revisions?.PM === 'string' ? data.revisions.PM : fetchedRev,
          };
        }

        // Si el manager tiene cambios locales sin guardar y es un refresco de fondo (Realtime/heartbeat),
        // NO sobrescribir su borrador local (A14).
        if (!options?.forceOverwrite && isDirtyRef.current) {
          setRemoteUpdatePending(true);
          return;
        }

        setAssignments(fetchedList);
        setRemoteUpdatePending(false);
      } catch (err) {
        console.error('Error fetching assignments:', err);
      }
    },
    [selectedStoreGuid, selectedDateStr]
  );

  const fetchPositionActivities = useCallback(async () => {
    try {
      const [paRes, procRes] = await Promise.all([
        fetch('/api/roles/activities'),
        fetch('/api/procedimientos'),
      ]);
      if (paRes.ok) {
        const data = await paRes.json();
        if (Array.isArray(data)) {
          setPositionActivities(data as PositionActivity[]);
        }
      } else {
        console.error(`[fetchPositionActivities] HTTP ${paRes.status}:`, await paRes.text());
      }
      if (procRes.ok) {
        const procJson = await procRes.json();
        const procList = extractCatalogProceduresPayload<NonNullable<PositionActivity['operating_procedures']>>(procJson);
        if (procList !== null) {
          setAllProcedures(procList);
        }
      } else {
        console.error(`[fetchPositionActivities] /api/procedimientos HTTP ${procRes.status}`);
      }
    } catch (err) {
      console.error('Error fetching position activities:', err);
    }
  }, []);

  // Ventana histórica centrada en selectedDay (-60 días a +14 días) en lugar de new Date() (A24)
  const fetchWeekShiftEmpIds = useCallback(async () => {
    if (!selectedStoreGuid) return;
    const seq = ++weekShiftsReqSeqRef.current;
    const lookbackStart = formatDateISO(subDays(selectedDay, 60));
    const lookbackEnd = formatDateISO(addDays(selectedDay, 14));
    const { data } = await supabase
      .from('shifts')
      .select('employee_id')
      .eq('store_id', selectedStoreGuid)
      .gte('shift_date', lookbackStart)
      .lte('shift_date', lookbackEnd);
    if (seq !== weekShiftsReqSeqRef.current) return;
    if (data) {
      setWeekShiftEmpIds(new Set(data.map((s: { employee_id: string }) => String(s.employee_id))));
    }
  }, [selectedStoreGuid, selectedDay]);

  // ── Initial load ──
  useEffect(() => {
    fetchStores();
    fetchPositionActivities();
  }, [fetchStores, fetchPositionActivities]);

  // ── Supabase Realtime Subscription & Live Tablet Auto-Sync ──
  useEffect(() => {
    let debounceTimer: NodeJS.Timeout | null = null;

    const triggerRefresh = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        fetchPositionActivities();
        if (selectedStoreGuid) {
          fetchAssignments({ forceOverwrite: false });
          fetchShifts();
        }
      }, 500);
    };

    const channel = supabase
      .channel(`actividades-tablero-realtime-${selectedStoreGuid || 'global'}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'position_activities',
      }, triggerRefresh)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'operating_procedures',
      }, triggerRefresh)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'station_assignments',
        ...(selectedStoreGuid ? { filter: `store_id=eq.${selectedStoreGuid}` } : {}),
      }, triggerRefresh)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'shifts',
        ...(selectedStoreGuid ? { filter: `store_id=eq.${selectedStoreGuid}` } : {}),
      }, triggerRefresh)
      .subscribe();

    const heartbeat = setInterval(() => {
      fetchPositionActivities();
      if (selectedStoreGuid) {
        fetchAssignments({ forceOverwrite: false });
        fetchShifts();
      }
    }, 3 * 60 * 1000);

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      clearInterval(heartbeat);
      supabase.removeChannel(channel);
    };
  }, [selectedStoreGuid, fetchPositionActivities, fetchAssignments, fetchShifts]);

  // ── When store or date changes ──
  useEffect(() => {
    if (!selectedStoreGuid) return;
    let cancelled = false;
    const loadData = async () => {
      setLoading(true);
      await Promise.all([
        fetchShifts(),
        fetchAssignments({ forceOverwrite: true }),
        fetchWeekShiftEmpIds(),
        fetchEmployees(),
      ]);
      if (!cancelled) setLoading(false);
    };
    loadData();
    return () => {
      cancelled = true;
    };
  }, [selectedStoreGuid, selectedDateStr, fetchShifts, fetchAssignments, fetchWeekShiftEmpIds, fetchEmployees]);

  // ── Actions ──
  const getAssignee = useCallback((date: Date, station: string) => {
    const dateStr = formatDateISO(date);
    return assignments.find((a) => a.assignment_date === dateStr && a.sub_position === station);
  }, [assignments]);

  const handleSave = async (forceWithoutRevision = false, overrideAssignments?: Assignment[]) => {
    if (!canEditAssignments || !selectedStoreGuid) return;
    setSaving(true);
    setSaveSuccess(false);

    const sourceAssignments = overrideAssignments ?? assignments;
    const currentSlice = sourceAssignments
      .map((a) => ({
        ...a,
        sub_position: normalizeAssignmentSubPosition(a.main_station, a.sub_position, 'AM'),
      }))
      .filter(
        (a) =>
          a.assignment_date === selectedDateStr &&
          a.sub_position?.endsWith(`_${activeShift}`) &&
          a.employee_id
      );

    const activeScopedKeysInSlice = new Set(
      currentSlice.map(
        (a) =>
          `${normalizeText(selectedStoreGuid)}|${a.assignment_date}|${normalizeText(a.sub_position || '')}`
      )
    );
    const clearedAssignments: ClearedStationAssignmentScope[] = persistedAssignments
      .map((a) => ({
        ...a,
        sub_position: normalizeAssignmentSubPosition(a.main_station, a.sub_position, 'AM'),
      }))
      .filter(
        (a) =>
          normalizeText(String(a.store_id || selectedStoreGuid)) === normalizeText(selectedStoreGuid) &&
          a.assignment_date === selectedDateStr &&
          a.sub_position?.endsWith(`_${activeShift}`) &&
          a.employee_id &&
          !activeScopedKeysInSlice.has(
            `${normalizeText(selectedStoreGuid)}|${a.assignment_date}|${normalizeText(a.sub_position || '')}`
          )
      )
      .map((a) => ({
        store_id: selectedStoreGuid,
        assignment_date: a.assignment_date,
        main_station: a.main_station,
        sub_position: a.sub_position,
      }));

    const payload: Record<string, any> = {
      assignments: currentSlice,
      cleared_assignments: clearedAssignments,
      store_id: selectedStoreGuid,
      start_date: selectedDateStr,
      end_date: selectedDateStr,
      active_shift: activeShift,
    };

    const expectedRevForShift =
      assignmentsRevisionsByShiftRef.current[activeShift] || assignmentsRevision;
    if (!forceWithoutRevision && expectedRevForShift) {
      payload.expected_revision = expectedRevForShift;
    }

    try {
      const res = await fetch('/api/roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (res.status === 409) {
        const shouldReload = confirm(
          `${t('actividades.daily.conflict_reload_error')}\n\n${
            language === 'es'
              ? '¿Deseas recargar los datos actuales del servidor? (Cancelar para mantener tu borrador en pantalla)'
              : 'Do you want to reload current server data? (Cancel to keep your draft on screen)'
          }`
        );
        if (shouldReload) {
          await fetchAssignments({ forceOverwrite: true });
        } else if (data.current_revision) {
          setAssignmentsRevision(data.current_revision);
          assignmentsRevisionsByShiftRef.current[activeShift] = data.current_revision;
        }
        return;
      }

      if (data.success) {
        if (data.revision) {
          setAssignmentsRevision(data.revision);
          assignmentsRevisionsByShiftRef.current[activeShift] = data.revision;
        }
        setPersistedAssignments((prev) => {
          const otherSlices = prev.filter(
            (a) => !(a.assignment_date === selectedDateStr && a.sub_position?.endsWith(`_${activeShift}`))
          );
          return [...otherSlices, ...currentSlice];
        });
        setRemoteUpdatePending(false);
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 3000);
      } else {
        alert(data.error || t('actividades.daily.save_error'));
      }
    } catch {
      alert(t('actividades.daily.save_error'));
    } finally {
      setSaving(false);
    }
  };

  const updateAssignment = useCallback(
    (
      dateStr: string,
      station: string,
      employeeId: string,
      group: string,
      options?: { autoSave?: boolean }
    ) => {
      if (!canEditAssignments) return;
      const subPos = `${station}_${activeShift}`;
      const stationActivitiesList = activityMap[station] || [];
      const defaultTasks = stationActivitiesList
        .map((pa) => pa.operating_procedures?.activity)
        .filter(Boolean) as string[];

      const existingForStation = assignments.find(
        (a) => a.assignment_date === dateStr && a.sub_position === subPos
      );
      const mergedTasks = Array.from(
        new Set([
          ...(Array.isArray(existingForStation?.tasks)
            ? existingForStation.tasks.filter(Boolean)
            : []),
          ...defaultTasks,
        ])
      );

      const filtered = assignments.filter(
        (a) => !(a.assignment_date === dateStr && a.sub_position === subPos)
      );
      const nextAssignments: Assignment[] = !employeeId
        ? filtered
        : [
            ...filtered,
            {
              store_id: selectedStoreGuid,
              employee_id: employeeId,
              assignment_date: dateStr,
              main_station: station,
              sub_position: subPos,
              station_group: group,
              tasks: mergedTasks,
            },
          ];

      setAssignments(nextAssignments);
      if (options?.autoSave) {
        void handleSave(false, nextAssignments);
      }
    },
    [canEditAssignments, selectedStoreGuid, activeShift, activityMap, assignments, handleSave]
  );

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
    if (!canEditAssignments) return;
    const group = getSectionForStation(stationName);
    updateAssignment(selectedDateStr, stationName, employeeId, group);
  };

  const handleDiscardChanges = useCallback(() => {
    setAssignments(persistedAssignments);
    setRemoteUpdatePending(false);
  }, [persistedAssignments]);

  const handleOpenPublishPreview = useCallback(async () => {
    if (!selectedStoreGuid) return;
    setShowPublishPreviewModal(true);
    setPublishPreviewLoading(true);
    setPublishPreviewData(null);
    try {
      const weekStartStr = formatDateISO(currentWeekStart);
      const weekEndStr = formatDateISO(addDays(currentWeekStart, 6));
      const res = await fetch('/api/notifications/publish-schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          store_id: selectedStoreGuid,
          start_date: weekStartStr,
          end_date: weekEndStr,
          preview_only: true,
        }),
      });
      const data = await res.json();
      setPublishPreviewData(data);
    } catch (err: any) {
      setPublishPreviewData({ error: err.message || 'Error al generar vista previa' });
    } finally {
      setPublishPreviewLoading(false);
    }
  }, [selectedStoreGuid, currentWeekStart]);

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

        const prevShiftSuffix = `_${activeShift}`;
        const shiftFiltered = data
          .map((a: any) => ({
            ...a,
            sub_position: normalizeAssignmentSubPosition(a.main_station, a.sub_position, 'AM'),
          }))
          .filter((a: any) => a.sub_position?.endsWith(prevShiftSuffix));

        if (shiftFiltered.length === 0) {
          alert(language === 'es' ? `No se encontraron asignaciones en el turno ${activeShift} para el mismo día de la semana anterior.` : `No assignments found in ${activeShift} shift for the same day of the previous week.`);
          setCopying(false);
          return;
        }

        const clonedAssignments = shiftFiltered
          .filter((a: any) => a.employee_id)
          .map((a: any) => {
          const stationActivitiesList = activityMap[a.main_station] || [];
          const defaultTasks = stationActivitiesList
            .map(pa => pa.operating_procedures?.activity)
            .filter(Boolean) as string[];

          return {
            store_id: selectedStoreGuid,
            employee_id: a.employee_id,
            assignment_date: selectedDateStr,
            main_station: a.main_station,
            sub_position: normalizeAssignmentSubPosition(a.main_station, a.sub_position, activeShift),
            station_group: a.station_group,
            tasks: a.tasks && a.tasks.length > 0 ? a.tasks : defaultTasks,
          };
        });

        setAssignments((prev) => {
          const otherShifts = prev.filter(
            (a) => !(a.assignment_date === selectedDateStr && a.sub_position?.endsWith(`_${activeShift}`))
          );
          return [...otherShifts, ...clonedAssignments];
        });
        
        setSaveSuccess(false);
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
    if (!canEditAssignments || !selectedStoreGuid) return;
    if (!confirm(language === 'es' ? '¿Estás seguro de que quieres clonar TODA la semana pasada? Esto reemplazará todas las asignaciones de esta semana de forma permanente.' : 'Are you sure you want to clone the ENTIRE previous week? This will overwrite all assignments for the current week permanently.')) return;
    
    setCopyingAll(true);
    try {
      const prevWeekStart = subDays(currentWeekStart, 7);
      const prevWeekEnd = subDays(currentWeekStart, 1);
      const prevWeekStartStr = formatDateISO(prevWeekStart);
      const prevWeekEndStr = formatDateISO(prevWeekEnd);

      const currentWeekEnd = addDays(currentWeekStart, 6);
      const currentWeekStartStr = formatDateISO(currentWeekStart);
      const currentWeekEndStr = formatDateISO(currentWeekEnd);

      const res = await fetch(
        `/api/roles?store_id=${encodeURIComponent(selectedStoreGuid)}&start_date=${prevWeekStartStr}&end_date=${prevWeekEndStr}&include_meta=1`
      );
      if (!res.ok) throw new Error('Failed to fetch previous week assignments');

      const sourceSnapshot = await res.json();
      const data = Array.isArray(sourceSnapshot?.assignments) ? sourceSnapshot.assignments : [];
      if (typeof sourceSnapshot?.revision !== 'string' || !sourceSnapshot.revision) {
        throw new Error('Previous week assignments did not include a stable revision');
      }
      if (!Array.isArray(data) || data.length === 0) {
        alert(language === 'es' ? 'No se encontraron asignaciones en la semana anterior para copiar.' : 'No assignments found in the previous week.');
        setCopyingAll(false);
        return;
      }

      const clonedAssignments = data
        .filter((a: any) => a.employee_id)
        .map((a: any) => {
        const prevAssignDate = new Date(a.assignment_date + 'T00:00:00');
        const nextAssignDate = addDays(prevAssignDate, 7);
        const nextAssignDateStr = formatDateISO(nextAssignDate);

        const rowShift =
          (extractLiteralShiftSuffix(a.sub_position) || extractLiteralShiftSuffix(a.main_station)) === 'PM'
            ? 'PM'
            : 'AM';
        const stationActivitiesList = activityMap[a.main_station] || [];
        const defaultTasks = stationActivitiesList
          .map(pa => pa.operating_procedures?.activity)
          .filter(Boolean) as string[];

        return {
          store_id: selectedStoreGuid,
          employee_id: a.employee_id,
          assignment_date: nextAssignDateStr,
          main_station: a.main_station,
          sub_position: normalizeAssignmentSubPosition(a.main_station, a.sub_position, rowShift),
          station_group: a.station_group,
          tasks: a.tasks && a.tasks.length > 0 ? a.tasks : defaultTasks,
        };
      });

      if (clonedAssignments.length === 0) {
        alert(language === 'es' ? 'No se encontraron asignaciones válidas con empleado en la semana anterior para copiar.' : 'No valid employee assignments found in the previous week.');
        setCopyingAll(false);
        return;
      }

      // Capturar justo antes del reemplazo la revisión de toda la semana destino.
      // La RPC la compara dentro de la transacción; si otro manager guardó después,
      // el reemplazo completo se rechaza con 409 y no borra sus asignaciones.
      const targetSnapshotRes = await fetch(
        `/api/roles?store_id=${encodeURIComponent(selectedStoreGuid)}&start_date=${currentWeekStartStr}&end_date=${currentWeekEndStr}&revision_only=1`
      );
      if (!targetSnapshotRes.ok) throw new Error('Failed to read current target-week revision');
      const targetSnapshot = await targetSnapshotRes.json();
      if (typeof targetSnapshot?.revision !== 'string' || !targetSnapshot.revision) {
        throw new Error('Target week assignments did not include a stable revision');
      }

      const saveRes = await fetch('/api/roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assignments: clonedAssignments,
          replace_all_shifts_confirmed: true,
          expected_revision: targetSnapshot.revision,
          store_id: selectedStoreGuid,
          start_date: currentWeekStartStr,
          end_date: currentWeekEndStr,
        }),
      });

      const saveResult = await saveRes.json();
      if (saveResult.success) {
        await Promise.all([fetchShifts(), fetchAssignments({ forceOverwrite: true })]);
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 3000);
        alert(language === 'es' ? '¡Semana completa clonada y guardada con éxito!' : 'Entire week cloned and saved successfully!');
      } else if (saveResult.code === 'CONFLICT_REVISION_MISMATCH') {
        alert(language === 'es'
          ? 'No se clonó la semana: las asignaciones de destino cambiaron desde que se revisaron. No se sobrescribió ningún cambio. Recarga la semana y vuelve a intentarlo.'
          : 'The week was not cloned: target assignments changed after review. No changes were overwritten. Reload the week and try again.');
      } else {
        alert(language === 'es' ? 'Hubo un error al guardar las asignaciones clonadas.' : 'Error saving cloned assignments.');
      }
    } catch (err) {
      console.error('Error cloning entire week:', err);
      alert(language === 'es' ? 'Hubo un error al clonar la semana.' : 'An error occurred while cloning the week.');
    } finally {
      setCopyingAll(false);
    }
  }, [canEditAssignments, selectedStoreGuid, currentWeekStart, activeShift, activityMap, language, fetchShifts, fetchAssignments]);

  // ── Despertar Tableta (Reconfiguración 24/7 + Limpieza Caché + Día/Turno Actual) ──
  const handleWakeUpTablet = useCallback(async () => {
    lastInteractionAtRef.current = Date.now();
    setShowWakeUpModal(false);
    if (wakingUpTablet) return;
    setWakingUpTablet(true);
    setTabletWakeSuccess(false);
    try {
      wakeLock.requestNow();
      await purgeTabletStaleCaches({ force: true });

      setLiveNow(new Date());
      const todayBDate = getBusinessToday();
      const todayBDateStr = formatDateISO(todayBDate);
      const currentShiftNow = getCurrentShiftLA();

      lastBusinessDateRef.current = todayBDateStr;
      lastAutoShiftRef.current = currentShiftNow;

      setCurrentWeekStart(startOfWeek(todayBDate, { weekStartsOn: 1 }));
      setSelectedDay(todayBDate);
      setActiveShift(currentShiftNow);
      setSelectedSlotForCard(null);
      setSelectedEmployeeCard(null);
      setIsReassigning(false);

      await Promise.all([
        fetchStores(),
        fetchPositionActivities(),
        fetchShifts(),
        fetchAssignments({ forceOverwrite: true }),
        fetchWeekShiftEmpIds(),
      ]);

      setTabletWakeSuccess(true);
      setTimeout(() => setTabletWakeSuccess(false), 4000);
    } catch (err) {
      console.error('[Actividades WakeUp] Error reconfigurando tableta:', err);
    } finally {
      setWakingUpTablet(false);
    }
  }, [wakingUpTablet, wakeLock, fetchStores, fetchPositionActivities, fetchShifts, fetchAssignments, fetchWeekShiftEmpIds]);

  // ── Navigation con confirmación si hay borrador sin guardar (A14) ──
  const confirmNavigateIfDirty = (): boolean => {
    if (!isDirtyRef.current) return true;
    return confirm(
      language === 'es'
        ? 'Tienes cambios sin guardar en este turno. ¿Deseas cambiar de vista y descartar los cambios locales?'
        : 'You have unsaved changes in this shift. Do you want to switch views and discard local changes?'
    );
  };

  const goToPrevWeek = () => {
    if (!confirmNavigateIfDirty()) return;
    const newStart = subWeeks(currentWeekStart, 1);
    setCurrentWeekStart(newStart);
    setSelectedDay(newStart);
  };
  const goToNextWeek = () => {
    if (!confirmNavigateIfDirty()) return;
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
                  data-testid="store-selector"
                  value={selectedStoreId}
                  onChange={(e) => {
                    if (e.target.value !== selectedStoreId && !confirmNavigateIfDirty()) return;
                    setSelectedStoreId(e.target.value);
                    try { localStorage.setItem('actividades_store_id', e.target.value); } catch {}
                  }}
                  disabled={!canChangeStore}
                  className={`text-sm font-semibold bg-transparent outline-none text-slate-800 dark:text-slate-200 ${canChangeStore ? 'cursor-pointer' : 'cursor-default opacity-80'}`}
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
              {canEditAssignments && (
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleCopyPreviousWeekAll}
                  disabled={copyingAll}
                  className="px-4 py-2.5 rounded-xl text-sm font-bold bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/50 shadow-sm transition-all flex items-center gap-2 disabled:opacity-60"
                >
                  {copyingAll ? (
                    <Loader2 className="w-4 h-4 animate-spin text-indigo-500" />
                  ) : (
                    <Calendar className="w-4 h-4 text-indigo-500" />
                  )}
                  {copyingAll ? t('actividades.daily.copying_prev_week_all') : t('actividades.daily.copy_prev_week_all')}
                </motion.button>
              )}

              {/* Clonar por Día y Turno */}
              {canEditAssignments && (
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleCopyPreviousWeek}
                  disabled={copying}
                  className="px-4 py-2.5 rounded-xl text-sm font-bold bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/50 shadow-sm transition-all flex items-center gap-2 disabled:opacity-60"
                >
                  {copying ? (
                    <Loader2 className="w-4 h-4 animate-spin text-indigo-500" />
                  ) : (
                    <Copy className="w-4 h-4 text-indigo-500" />
                  )}
                  {copying ? t('actividades.daily.copying_prev_week') : t('actividades.daily.copy_prev_week')}
                </motion.button>
              )}

              {/* Vista Previa Correo / Publicación */}
              {canEditAssignments && (
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  type="button"
                  onClick={handleOpenPublishPreview}
                  className="px-4 py-2.5 rounded-xl text-sm font-bold bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800/60 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 shadow-sm transition-all flex items-center gap-2"
                >
                  <Eye className="w-4 h-4 text-indigo-500" />
                  <span>{t('actividades.daily.preview_publish_btn')}</span>
                </motion.button>
              )}

              {/* Tablero */}
              <motion.button
                data-testid="open-visual-board-btn"
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

              {/* Descartar cambios (solo cuando hay borrador local) */}
              {canEditAssignments && isDirty && (
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  type="button"
                  onClick={handleDiscardChanges}
                  className="px-3.5 py-2.5 rounded-xl text-xs font-bold bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-300 border border-rose-200 dark:border-rose-800/60 hover:bg-rose-100 transition-all"
                >
                  {t('actividades.daily.discard_changes')}
                </motion.button>
              )}

              {/* Save */}
              {canEditAssignments && (
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => handleSave(false)}
                  disabled={saving}
                  className={`px-5 py-2.5 rounded-xl text-sm font-bold text-white shadow-lg transition-all flex items-center gap-2 ${
                    saveSuccess
                      ? 'bg-gradient-to-r from-green-500 to-emerald-600'
                      : isDirty
                        ? 'bg-gradient-to-r from-amber-500 to-orange-600 hover:shadow-xl ring-2 ring-amber-400/50'
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
              )}
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
                    onClick={() => {
                      if (!isSelected && !confirmNavigateIfDirty()) return;
                      setSelectedDay(day);
                    }}
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
                  onClick={() => {
                    if (activeShift !== shift && !confirmNavigateIfDirty()) return;
                    setActiveShift(shift);
                  }}
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

          {/* Date subtitle & Draft / Remote update indicators */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-slate-400 dark:text-slate-500">
              {format(selectedDay, "EEEE, MMMM d, yyyy", { locale })}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {isDirty && (
                <span className="inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-lg bg-amber-100 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 border border-amber-300/60 dark:border-amber-700/50">
                  <AlertCircle className="w-3.5 h-3.5" />
                  {t('actividades.daily.unsaved_changes_warning')}
                </span>
              )}
              {remoteUpdatePending && (
                <button
                  type="button"
                  onClick={() => fetchAssignments({ forceOverwrite: true })}
                  className="inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-lg bg-blue-100 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 border border-blue-300/60 dark:border-blue-700/50 hover:bg-blue-200 transition-colors"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  {language === 'es'
                    ? 'Hay cambios remotos nuevos — clic para actualizar'
                    : 'New remote changes available — click to reload'}
                </button>
              )}
            </div>
          </div>
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
                              ) || (assignment as any).toast_employees
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
                                <div className="flex items-center justify-between mb-2 gap-1.5">
                                  <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                                    <h3 className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wide">
                                      {stationName}
                                    </h3>
                                    {stationActivities.length === 0 &&
                                      !getStationConfigStatus(stationName, approvedPositionActivities).hasDirectMappings && (
                                        <span
                                          title={t('actividades.daily.station_without_catalog_hint')}
                                          className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-100/90 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-300/60 dark:border-amber-700/50 whitespace-nowrap"
                                        >
                                          {t('actividades.daily.station_without_catalog_badge')}
                                        </span>
                                      )}
                                  </div>
                                  {assignedEmp && (
                                    <div
                                      className={`w-6 h-6 rounded-full bg-gradient-to-br ${getInitialsGradient(
                                        getDisplayName(assignedEmp)
                                      )} flex items-center justify-center text-white text-[9px] font-bold shadow-sm flex-shrink-0`}
                                    >
                                      {getInitials(assignedEmp)}
                                    </div>
                                  )}
                                </div>

                                {/* Employee selector */}
                                <select
                                  disabled={!canEditAssignments}
                                  value={assignment?.employee_id || ''}
                                  onChange={(e) =>
                                    handleAssignEmployee(stationName, e.target.value)
                                  }
                                  className={`w-full text-xs font-semibold rounded-lg px-2.5 py-2 outline-none transition-all border ${
                                    isVacant
                                      ? 'bg-red-50 dark:bg-red-950/30 border-red-300 dark:border-red-700/50 text-red-600 dark:text-red-400'
                                      : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200'
                                  } focus:ring-2 focus:ring-indigo-500/30 ${canEditAssignments ? 'cursor-pointer' : 'cursor-not-allowed opacity-75'}`}
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
                                  {offDutyEmployees.length > 0 && (
                                    <optgroup label={`── ${t('actividades.daily.off_duty')} ──`}>
                                      {offDutyEmployees.map((emp) => (
                                        <option key={`off-${emp.id}`} value={String(emp.id)}>
                                          {getDisplayName(emp)} 🌙
                                        </option>
                                      ))}
                                    </optgroup>
                                  )}
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
                                      const adjTime = getAdjustedProcTime(proc);
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
                                          {adjTime && (
                                            <span
                                              className={`text-[9px] font-medium ${sColor.badge} px-1.5 py-0.5 rounded-md whitespace-nowrap`}
                                            >
                                              {formatActivityTime(adjTime)}
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
            const boardHasDriveThru = isConfirmedStoreDriveThru(selectedStore) && hasDriveThru;
            const cardHeightClass = boardHasDriveThru ? 'h-[9.5vh] sm:h-[10.2vh]' : 'h-[14vh] sm:h-[16vh]';
            const containerGapClass = boardHasDriveThru ? 'gap-[0.8vh] sm:gap-[1.2vh]' : 'gap-[2.5vh] sm:gap-[4vh]';
            const containerPaddingClass = boardHasDriveThru
              ? 'pt-[0.8vh] pb-[1vh] px-[1.5vw]'
              : 'pt-[2vh] pb-[3vh] px-[1.5vw]';

            return (
              <motion.div
                data-testid="visual-board-portal"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[9999] w-screen h-[100dvh] bg-white dark:bg-slate-950 flex flex-col overflow-hidden text-slate-950 dark:text-white"
              >
                {/* Header */}
                <div className="bg-slate-50 dark:bg-slate-900 border-b-2 border-black/5 dark:border-white/5 px-[2vw] py-[1vh] flex items-center justify-between flex-shrink-0">
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

                    {/* Wake Lock Active Indicator */}
                    {isScreenAwake && (
                      <div 
                        className="hidden sm:flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200/80 dark:border-emerald-800/60 text-emerald-700 dark:text-emerald-300 text-xs font-bold shadow-sm"
                        title="Screen Wake Lock activo: la pantalla permanecerá encendida"
                      >
                        <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                        </span>
                        <span>{t('actividades.daily.screen_awake')}</span>
                      </div>
                    )}
                  </div>

                  {/* Date & Shift Selectors */}
                  <div className="flex items-center gap-3 bg-white dark:bg-slate-800 p-1.5 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm flex-wrap">
                    <div className="flex gap-1">
                      {(['AM', 'PM'] as const).map((sh) => (
                        <button
                          key={sh}
                          onClick={() => {
                            if (activeShift !== sh && !confirmNavigateIfDirty()) return;
                            setActiveShift(sh);
                          }}
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
                        onClick={() => {
                          if (!confirmNavigateIfDirty()) return;
                          setSelectedDay((d) => subDays(d, 1));
                        }}
                        className="w-8 h-8 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg flex items-center justify-center text-slate-400 hover:bg-indigo-50 dark:hover:bg-indigo-950 hover:text-indigo-600 transition-colors shadow-sm"
                      >
                        <ChevronLeft size={18} />
                      </button>
                      <span className="min-w-[120px] text-center font-bold">
                        {format(selectedDay, 'EEEE dd', { locale })}
                      </span>
                      <button
                        onClick={() => {
                          if (!confirmNavigateIfDirty()) return;
                          setSelectedDay((d) => addDays(d, 1));
                        }}
                        className="w-8 h-8 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg flex items-center justify-center text-slate-400 hover:bg-indigo-50 dark:hover:bg-indigo-950 hover:text-indigo-600 transition-colors shadow-sm"
                      >
                        <ChevronRight size={18} />
                      </button>
                    </div>
                  </div>

                  {/* Close */}
                  <div className="flex items-center gap-2.5">
                    <button
                      data-testid="close-visual-board-btn"
                      onClick={() => {
                        setShowVisualBoard(false);
                        exitFullscreen();
                      }}
                      className="bg-black dark:bg-white text-white dark:text-black px-6 py-2 rounded-full font-black text-xs uppercase tracking-widest transition-all hover:bg-slate-800 dark:hover:bg-slate-200 active:scale-95"
                    >
                      {t('actividades.daily.close_board')}
                    </button>
                  </div>
                </div>

                {/* Layout Content — Physical Workstation Floor Map (Salón, Cocina, Drive-Thru) */}
                <div
                  data-testid="visual-board-map"
                  className={`flex-1 min-h-0 flex flex-col justify-center items-center bg-slate-100/40 dark:bg-slate-950 overflow-y-auto select-none relative w-full ${containerGapClass} ${containerPaddingClass}`}
                >
                  {/* Dining Area section */}
                  <div className="flex flex-col gap-[0.3vh] relative z-10 w-full max-w-[98vw] mx-auto">
                    <div className="flex items-center justify-center gap-[1vh] mb-[0.4vh]">
                      <h2 className="text-[1.8vh] sm:text-[2.2vh] font-black text-indigo-600 dark:text-indigo-400 uppercase tracking-[0.4em] italic leading-none">
                        {t('actividades.daily.section_salon')}
                      </h2>
                    </div>
                    <div className="flex flex-col items-center gap-[0.2vh] w-full">
                      <div className="grid grid-cols-2 gap-[0.5vh] w-full max-w-4xl mx-auto">
                        <BoardSlot
                          label="Limpieza"
                          stationKey="LIMPIEZA"
                          group="Salón"
                          assignee={getAssignee(selectedDay, `LIMPIEZA_${activeShift}`)}
                          employees={employees}
                          className={cardHeightClass}
                          hasDriveThru={boardHasDriveThru}
                          onClick={handleSlotClick}
                        />
                        <BoardSlot
                          label="Descansos"
                          stationKey="CUBRIR DESCANSOS (SALÓN)"
                          group="Salón"
                          assignee={getAssignee(selectedDay, `CUBRIR DESCANSOS (SALÓN)_${activeShift}`)}
                          employees={employees}
                          className={cardHeightClass}
                          hasDriveThru={boardHasDriveThru}
                          onClick={handleSlotClick}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Kitchen section */}
                  <div className="flex flex-col gap-[0.3vh] relative z-10 w-full max-w-[98vw] mx-auto">
                    <div className="flex items-center justify-center gap-[1vh] mb-[0.4vh]">
                      <h2 className="text-[1.8vh] sm:text-[2.2vh] font-black text-indigo-600 dark:text-indigo-400 uppercase tracking-[0.4em] italic leading-none text-center">
                        {t('actividades.daily.section_kitchen')}
                      </h2>
                    </div>
                    <div className="w-full flex flex-col items-center gap-[0.3vh]">
                      {/* Counter Line */}
                      <div className="w-full grid grid-cols-2 sm:grid-cols-7 gap-[0.3vh]">
                        <BoardSlot
                          label="Delivery"
                          stationKey="Uber + Salsas"
                          group="Salón"
                          assignee={getAssignee(selectedDay, `Uber + Salsas_${activeShift}`)}
                          employees={employees}
                          className={cardHeightClass}
                          hasDriveThru={boardHasDriveThru}
                          onClick={handleSlotClick}
                        />
                        <BoardSlot
                          label="Entrega"
                          stationKey="ENTREGA"
                          group="Salón"
                          assignee={getAssignee(selectedDay, `ENTREGA_${activeShift}`)}
                          employees={employees}
                          className={cardHeightClass}
                          hasDriveThru={boardHasDriveThru}
                          onClick={handleSlotClick}
                        />
                        <BoardSlot
                          label="Tacos"
                          stationKey="TACOS"
                          group="Salón"
                          assignee={getAssignee(selectedDay, `TACOS_${activeShift}`)}
                          employees={employees}
                          className={cardHeightClass}
                          hasDriveThru={boardHasDriveThru}
                          onClick={handleSlotClick}
                        />
                        <BoardSlot
                          label="Burritos"
                          stationKey="BURRITOS"
                          group="Salón"
                          assignee={getAssignee(selectedDay, `BURRITOS_${activeShift}`)}
                          employees={employees}
                          className={cardHeightClass}
                          hasDriveThru={boardHasDriveThru}
                          onClick={handleSlotClick}
                        />
                        <BoardSlot
                          label="Caja 3"
                          stationKey="Caja 3"
                          group="Salón"
                          assignee={getAssignee(selectedDay, `Caja 3_${activeShift}`)}
                          employees={employees}
                          className={cardHeightClass}
                          hasDriveThru={boardHasDriveThru}
                          onClick={handleSlotClick}
                        />
                        <BoardSlot
                          label="Caja 2"
                          stationKey="Caja 2"
                          group="Salón"
                          assignee={getAssignee(selectedDay, `Caja 2_${activeShift}`)}
                          employees={employees}
                          className={cardHeightClass}
                          hasDriveThru={boardHasDriveThru}
                          onClick={handleSlotClick}
                        />
                        <BoardSlot
                          label="Caja 1"
                          stationKey="Caja 1 / Salón"
                          group="Salón"
                          assignee={getAssignee(selectedDay, `Caja 1 / Salón_${activeShift}`)}
                          employees={employees}
                          className={cardHeightClass}
                          hasDriveThru={boardHasDriveThru}
                          onClick={handleSlotClick}
                        />
                      </div>

                      {/* Back Kitchen Line */}
                      <div className="w-full grid grid-cols-2 sm:grid-cols-4 gap-[0.3vh] mt-[0.2vh]">
                        <BoardSlot
                          label="Carnes"
                          stationKey="CARNES"
                          group="Cocina"
                          assignee={getAssignee(selectedDay, `CARNES_${activeShift}`)}
                          employees={employees}
                          className={cardHeightClass}
                          hasDriveThru={boardHasDriveThru}
                          onClick={handleSlotClick}
                        />
                        <BoardSlot
                          label="Tortillas"
                          stationKey="TORTILLAS"
                          group="Cocina"
                          assignee={getAssignee(selectedDay, `TORTILLAS_${activeShift}`)}
                          employees={employees}
                          className={cardHeightClass}
                          hasDriveThru={boardHasDriveThru}
                          onClick={handleSlotClick}
                        />
                        <BoardSlot
                          label="Tortas / Mulitas"
                          stationKey="TORTAS/MULITAS"
                          group="Cocina"
                          assignee={getAssignee(selectedDay, `TORTAS/MULITAS_${activeShift}`)}
                          employees={employees}
                          className={cardHeightClass}
                          hasDriveThru={boardHasDriveThru}
                          onClick={handleSlotClick}
                        />
                        <BoardSlot
                          label="Tortas / Quesadillas"
                          stationKey="TORTAS/QUESADILLAS"
                          group="Cocina"
                          assignee={getAssignee(selectedDay, `TORTAS/QUESADILLAS_${activeShift}`)}
                          employees={employees}
                          className={cardHeightClass}
                          hasDriveThru={boardHasDriveThru}
                          onClick={handleSlotClick}
                        />
                      </div>

                      {/* Kitchen Bottom Line */}
                      <div className="w-full grid grid-cols-1 sm:grid-cols-3 gap-[0.3vh]">
                        <BoardSlot
                          label="Preparación"
                          stationKey="PREPARACION"
                          group="Cocina"
                          assignee={getAssignee(selectedDay, `PREPARACION_${activeShift}`)}
                          employees={employees}
                          className={`${cardHeightClass} sm:col-span-2`}
                          hasDriveThru={boardHasDriveThru}
                          onClick={handleSlotClick}
                        />
                        <BoardSlot
                          label="Descansos"
                          stationKey="CUBRIR DESCANSOS (COCINA)"
                          group="Cocina"
                          assignee={getAssignee(selectedDay, `CUBRIR DESCANSOS (COCINA)_${activeShift}`)}
                          employees={employees}
                          className={cardHeightClass}
                          hasDriveThru={boardHasDriveThru}
                          onClick={handleSlotClick}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Drive Thru section */}
                  {boardHasDriveThru && (
                    <div
                      data-testid="visual-board-drive-thru-section"
                      className="flex flex-col gap-[0.3vh] relative z-10 w-full max-w-[98vw] mx-auto"
                    >
                      <div className="flex items-center justify-center gap-[1vh] mb-[0.4vh] w-full">
                        <h2 className="text-[1.8vh] sm:text-[2.2vh] font-black text-indigo-600 dark:text-indigo-400 uppercase tracking-[0.4em] italic leading-none">
                          {t('actividades.daily.section_drive_thru')}
                        </h2>
                      </div>
                      <div className="w-full grid grid-cols-2 sm:grid-cols-7 gap-[0.3vh] items-stretch">
                        <BoardSlot
                          label="Ventanilla 1"
                          stationKey="Ventana 1"
                          group="Drive-Thru"
                          assignee={getAssignee(selectedDay, `Ventana 1_${activeShift}`)}
                          employees={employees}
                          className="col-span-2 sm:col-span-1 sm:row-span-2 h-[9.5vh] sm:h-auto w-full"
                          hasDriveThru={boardHasDriveThru}
                          onClick={handleSlotClick}
                        />
                        <BoardSlot
                          label="Tortas / Quesadillas (DT)"
                          stationKey="TORTAS/QUESADILLAS (DT)"
                          group="Drive-Thru"
                          assignee={getAssignee(selectedDay, `TORTAS/QUESADILLAS (DT)_${activeShift}`)}
                          employees={employees}
                          className={`col-span-1 sm:col-span-3 ${cardHeightClass} w-full`}
                          hasDriveThru={boardHasDriveThru}
                          onClick={handleSlotClick}
                        />
                        <BoardSlot
                          label="Descansos"
                          stationKey="CUBRIR DESCANSOS (DT)"
                          group="Drive-Thru"
                          assignee={getAssignee(selectedDay, `CUBRIR DESCANSOS (DT)_${activeShift}`)}
                          employees={employees}
                          className={`col-span-1 sm:col-span-3 ${cardHeightClass} w-full`}
                          hasDriveThru={boardHasDriveThru}
                          onClick={handleSlotClick}
                        />
                        <BoardSlot
                          label="Tacos / Burritos (DT)"
                          stationKey="TACOS/BURRITOS (DT)"
                          group="Drive-Thru"
                          assignee={getAssignee(selectedDay, `TACOS/BURRITOS (DT)_${activeShift}`)}
                          employees={employees}
                          className={`col-span-1 sm:col-span-2 ${cardHeightClass} w-full`}
                          hasDriveThru={boardHasDriveThru}
                          onClick={handleSlotClick}
                        />
                        <BoardSlot
                          label="Ventanilla 2"
                          stationKey="Ventana 2"
                          group="Drive-Thru"
                          assignee={getAssignee(selectedDay, `Ventana 2_${activeShift}`)}
                          employees={employees}
                          className={`col-span-1 sm:col-span-2 ${cardHeightClass} w-full`}
                          hasDriveThru={boardHasDriveThru}
                          onClick={handleSlotClick}
                        />
                        <BoardSlot
                          label="Ventanilla 2 (B)"
                          stationKey="Ventana 2 (B)"
                          group="Drive-Thru"
                          assignee={getAssignee(selectedDay, `Ventana 2 (B)_${activeShift}`)}
                          employees={employees}
                          className={`col-span-2 sm:col-span-2 ${cardHeightClass} w-full`}
                          hasDriveThru={boardHasDriveThru}
                          onClick={handleSlotClick}
                        />
                      </div>
                    </div>
                  )}
                </div>
                {/* Clock Status in bottom right */}
                <div className="absolute bottom-2 right-4 flex items-end gap-3 opacity-30 pointer-events-none transform scale-75 origin-bottom-right">
                  <div className="text-right">
                    <p className="text-[8px] font-black uppercase tracking-[0.1em] text-zinc-400 font-mono">SYS STATUS: OK</p>
                  </div>
                  <div className="w-px h-6 bg-zinc-300 dark:bg-zinc-700" />
                  <div className="flex flex-col">
                    <span className="text-2xl font-black text-slate-800 dark:text-slate-200 tracking-tighter leading-none">
                      {format(liveNow, 'HH:mm')}
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
              className="fixed inset-0 z-[10000] w-screen h-[100dvh] bg-slate-100 dark:bg-slate-950 flex flex-col overflow-hidden text-slate-900 dark:text-white cursor-default"
            >
              {/* Header — Viewport-Adaptive Full Screen Width */}
              <div className="bg-indigo-600 px-[2vw] py-[1.4vh] text-white relative flex-shrink-0 shadow-md">
                <button
                  onClick={() => setSelectedSlotForCard(null)}
                  className="absolute top-1/2 -translate-y-1/2 right-[2vw] p-[1vh] bg-white/15 hover:bg-white/25 text-white rounded-xl transition-all z-30"
                >
                  <X className="w-[2.4vh] h-[2.4vh] min-w-[20px] min-h-[20px]" />
                </button>
                <div className="w-full max-w-none pr-14 flex items-center">
                  <h3
                    className="font-black uppercase tracking-tight leading-none"
                    style={{ fontSize: 'clamp(22px, 3.6vh, 48px)' }}
                  >
                    {selectedSlotForCard.label}
                  </h3>
                </div>
              </div>

              {/* Content — 100% Viewport-Coupled (Adapts dynamically to screen height & width) */}
              <div className="flex-1 overflow-y-auto md:overflow-hidden custom-scrollbar px-[1.5vw] py-[1.5vh] flex flex-col min-h-0 w-full max-w-none">
                <div className="w-full max-w-none flex-1 flex flex-col min-h-0">
                  {(() => {
                    const shiftStationKey = `${selectedSlotForCard.stationKey}_${activeShift}`;
                    const currentAssignee = getAssignee(selectedDay, shiftStationKey);
                    const currentEmp = currentAssignee
                      ? employees.find((e) => String(e.id) === String(currentAssignee.employee_id)) || (currentAssignee as any).toast_employees
                      : null;

                    if (!isReassigning || !canEditAssignments) {
                      // Display Employee Profile (or Station Header if vacant & read-only) + Activities
                      // Collect activities from ALL stations this employee is assigned to (not just the clicked one)
                      const empAssignments = currentEmp
                        ? assignments.filter(a => 
                            a.assignment_date === selectedDateStr && 
                            String(a.employee_id) === String(currentEmp.id) &&
                            a.sub_position?.endsWith(`_${activeShift}`)
                          )
                        : [];
                      const empStationKeys = empAssignments.map(a => a.main_station).filter(Boolean);
                      // Ensure current station is included
                      const clickedStation = selectedSlotForCard.stationKey || selectedSlotForCard.label;
                      if (!empStationKeys.includes(clickedStation)) {
                        empStationKeys.push(clickedStation);
                      }
                      // Merge activities from all assigned stations, deduplicated by activity_id / normalized title (A11).
                      // En el Tablero Operativo se muestran todas las actividades configuradas para la estación
                      // (y demás estaciones cubiertas por el empleado en este turno) usando `activityMap[sk]`
                      // (`enforceShiftWindow: false`), garantizando paridad 100% con "2. Configurar Posiciones"
                      // y "3. Asignación Diaria" sin ocultar tareas de estación por la hora de entrada del turno.
                      const seenIds = new Set<string>();
                      const stationActivitiesList: PositionActivity[] = [];
                      empStationKeys.forEach(sk => {
                        const acts: PositionActivity[] = activityMap[sk] || [];
                        acts.forEach(a => {
                          const key =
                            a.activity_id ||
                            normalizeText(a.operating_procedures?.activity || '') ||
                            a.id;
                          if (!seenIds.has(key)) {
                            seenIds.add(key);
                            stationActivitiesList.push(a);
                          }
                        });
                      });
                      
                      // Sort activities by category: Apertura (1) -> Regular (2) -> Cierre (3), then chronologically (A11)
                      const sortedActivities = [...stationActivitiesList].sort((a, b) => {
                        const procA = a.operating_procedures;
                        const procB = b.operating_procedures;
                        const typeA = (procA?.shift_type || 'REGULAR').toUpperCase();
                        const typeB = (procB?.shift_type || 'REGULAR').toUpperCase();
                        const orderA = typeA.includes('APE') || typeA.includes('OPEN') ? 1 : typeA.includes('CIE') || typeA.includes('CLOSE') ? 3 : 2;
                        const orderB = typeB.includes('APE') || typeB.includes('OPEN') ? 1 : typeB.includes('CIE') || typeB.includes('CLOSE') ? 3 : 2;
                        if (orderA !== orderB) return orderA - orderB;
                        const minA = getBusinessDaySortMinutes(getAdjustedProcTime(procA));
                        const minB = getBusinessDaySortMinutes(getAdjustedProcTime(procB));
                        if (minA !== minB) return minA - minB;
                        return (procA?.activity || '').localeCompare(procB?.activity || '');
                      });

                      const totalActivities = sortedActivities.length;
                      
                      // Dynamic grid columns & rows coupled to activity count + screen aspect ratio + pinch/button zoom
                      const baseCols =
                        totalActivities <= 2
                          ? Math.max(1, totalActivities)
                          : totalActivities <= 4
                          ? 2
                          : totalActivities <= 9
                          ? 3
                          : totalActivities <= 16
                          ? 4
                          : 5;
                      const numCols =
                        boardActivitiesZoom >= 2.1
                          ? 1
                          : boardActivitiesZoom >= 1.7
                          ? Math.min(2, baseCols)
                          : boardActivitiesZoom >= 1.4
                          ? Math.min(3, baseCols)
                          : boardActivitiesZoom >= 1.15
                          ? Math.min(4, baseCols)
                          : baseCols;
                      const baseRows = Math.max(1, Math.ceil(totalActivities / baseCols));
                      const numRows = Math.max(1, Math.ceil(totalActivities / numCols));
                      const isZoomedActivities = boardActivitiesZoom > 1.02;

                      // Fluid viewport-coupled typography (`clamp(min, vh/vw, max)`) scaled by baseRows and boardActivitiesZoom
                      const baseTitleClamp =
                        baseRows <= 2
                          ? 'clamp(16px, 2.3vh, 28px)'
                          : baseRows === 3
                          ? 'clamp(14px, 1.95vh, 23px)'
                          : baseRows === 4
                          ? 'clamp(13px, 1.65vh, 19px)'
                          : 'clamp(12px, 1.4vh, 17px)';
                      const titleFontStyle = isZoomedActivities
                        ? `calc(${baseTitleClamp} * ${boardActivitiesZoom})`
                        : baseTitleClamp;

                      const baseDescClamp =
                        baseRows <= 2
                          ? 'clamp(13px, 1.8vh, 22px)'
                          : baseRows === 3
                          ? 'clamp(12px, 1.5vh, 18px)'
                          : baseRows === 4
                          ? 'clamp(11px, 1.3vh, 15.5px)'
                          : 'clamp(10.5px, 1.15vh, 14px)';
                      const descFontStyle = isZoomedActivities
                        ? `calc(${baseDescClamp} * ${boardActivitiesZoom})`
                        : baseDescClamp;

                      const baseBadgeClamp =
                        baseRows <= 2
                          ? 'clamp(10px, 1.2vh, 15px)'
                          : baseRows === 3
                          ? 'clamp(9.5px, 1.05vh, 13px)'
                          : 'clamp(9px, 0.95vh, 12px)';
                      const badgeFontStyle = isZoomedActivities
                        ? `calc(${baseBadgeClamp} * ${Math.min(1.8, boardActivitiesZoom)})`
                        : baseBadgeClamp;

                      const baseClockClamp =
                        baseRows <= 2
                          ? 'clamp(12px, 1.5vh, 19px)'
                          : baseRows === 3
                          ? 'clamp(11px, 1.3vh, 16px)'
                          : 'clamp(10px, 1.15vh, 14px)';
                      const clockFontStyle = isZoomedActivities
                        ? `calc(${baseClockClamp} * ${Math.min(1.9, boardActivitiesZoom)})`
                        : baseClockClamp;

                      const baseCardPaddingClamp =
                        baseRows <= 2
                          ? 'clamp(12px, 1.8vh, 24px)'
                          : baseRows === 3
                          ? 'clamp(10px, 1.4vh, 18px)'
                          : 'clamp(8px, 1.1vh, 14px)';
                      const cardPaddingStyle = isZoomedActivities
                        ? `calc(${baseCardPaddingClamp} * ${Math.min(1.6, boardActivitiesZoom)})`
                        : baseCardPaddingClamp;

                      const gridGapStyle =
                        baseRows <= 2
                          ? 'clamp(10px, 1.5vh, 20px)'
                          : baseRows === 3
                          ? 'clamp(8px, 1.2vh, 16px)'
                          : 'clamp(6px, 0.9vh, 12px)';

                      return (
                        <div className="flex flex-col md:flex-row gap-[1.5vw] flex-1 min-h-0 h-full w-full">
                          {/* Profile Info & Actions Column — Viewport-coupled width (18vw, clamped 210px..290px) */}
                          <div
                            className="w-full md:w-[18vw] md:min-w-[210px] md:max-w-[290px] flex flex-col h-auto md:h-full flex-shrink-0"
                          >
                            <div className="bg-white dark:bg-slate-800 p-[2vh] rounded-[2vh] shadow-md border border-slate-200/80 dark:border-slate-800/80 flex flex-col justify-between h-full">
                              {/* Profile section */}
                              <div className="flex flex-col items-center text-center my-auto py-[1.5vh]">
                                <div
                                  className={`${currentEmp ? 'bg-indigo-600' : 'bg-slate-400 dark:bg-slate-700'} rounded-[2vh] flex items-center justify-center font-black text-white shadow-lg italic mb-[1.5vh]`}
                                  style={{
                                    width: 'clamp(56px, 8.5vh, 100px)',
                                    height: 'clamp(56px, 8.5vh, 100px)',
                                    fontSize: 'clamp(24px, 4vh, 48px)',
                                  }}
                                >
                                  {currentEmp ? (currentEmp.chosen_name || currentEmp.first_name)?.[0]?.toUpperCase() : '—'}
                                </div>
                                <h4
                                  className="font-black text-slate-900 dark:text-white uppercase leading-tight mb-[0.4vh] break-words w-full"
                                  style={{ fontSize: 'clamp(18px, 2.5vh, 30px)' }}
                                >
                                  {currentEmp ? (currentEmp.chosen_name || currentEmp.first_name) : t('actividades.daily.vacant')}
                                </h4>
                                <p
                                  className="font-bold text-slate-400 uppercase tracking-widest truncate w-full"
                                  style={{ fontSize: 'clamp(11px, 1.35vh, 16px)' }}
                                >
                                  {currentEmp ? currentEmp.last_name : selectedSlotForCard.label}
                                </p>
                              </div>

                              {/* Action Buttons section */}
                              {canEditAssignments && (
                                <div className="flex flex-col gap-[1.2vh] mt-[1.5vh]">
                                  {currentEmp && (
                                    <button
                                      onClick={() => {
                                        const targetKey = selectedSlotForCard.stationKey || selectedSlotForCard.label;
                                        updateAssignment(
                                          formatDateISO(selectedDay),
                                          targetKey,
                                          '',
                                          currentAssignee?.station_group || getSectionForStation(targetKey),
                                          { autoSave: true }
                                        );
                                        setSelectedSlotForCard(null);
                                      }}
                                      className="w-full flex items-center justify-center gap-2 py-[1.3vh] px-3 bg-red-500 hover:bg-red-600 text-white rounded-[1.2vh] font-black uppercase tracking-wider transition-all shadow-sm active:scale-95"
                                      style={{ fontSize: 'clamp(11px, 1.3vh, 15px)' }}
                                    >
                                      <UserMinus className="w-[1.8vh] h-[1.8vh] min-w-[15px] min-h-[15px] flex-shrink-0" />
                                      {t('actividades.daily.mark_absent')}
                                    </button>
                                  )}
                                  <button
                                    onClick={() => setIsReassigning(true)}
                                    className="w-full flex items-center justify-center gap-2 py-[1.3vh] px-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-[1.2vh] font-black uppercase tracking-wider transition-all shadow-sm active:scale-95"
                                    style={{ fontSize: 'clamp(11px, 1.3vh, 15px)' }}
                                  >
                                    <RefreshCw className="w-[1.8vh] h-[1.8vh] min-w-[15px] min-h-[15px] flex-shrink-0" />
                                    {t('actividades.daily.change_person')}
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Activities checklist — Auto-fits 100% of remaining viewport width & height */}
                          <div className="flex-1 min-w-0 flex flex-col min-h-0 h-full">
                            <div className="relative overflow-hidden bg-white dark:bg-slate-800 p-[1.8vh] sm:p-[2.2vh] rounded-[2vh] shadow-md border border-slate-200/80 dark:border-slate-800/80 h-full flex flex-col min-h-0">
                              <div className="flex flex-wrap items-center justify-between gap-2 mb-[1.2vh] pb-[1vh] border-b border-slate-100 dark:border-slate-700 flex-shrink-0">
                                <div className="flex items-center gap-[1vh]">
                                  <div className="p-[0.8vh] bg-indigo-600 text-white rounded-[0.9vh] shadow">
                                    <ClipboardList className="w-[2vh] h-[2vh] min-w-[18px] min-h-[18px]" />
                                  </div>
                                  <h5
                                    className="font-black text-slate-900 dark:text-white uppercase tracking-tight"
                                    style={{ fontSize: 'clamp(16px, 2.2vh, 26px)' }}
                                  >
                                    {t('actividades.daily.activities_label')}
                                  </h5>
                                  <span className="hidden lg:inline-block text-[11px] font-bold text-slate-400 dark:text-slate-400 ml-2">
                                    ({t('actividades.daily.pinch_or_tap_hint')})
                                  </span>
                                </div>
                                <div className="flex items-center gap-2 sm:gap-3">
                                  {/* Zoom Controls (− / 100% / +) */}
                                  <div className="flex items-center bg-slate-100 dark:bg-slate-700/80 rounded-full p-1 border border-slate-200/80 dark:border-slate-600 shadow-inner">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setBoardActivitiesZoom((prev) =>
                                          Math.max(1, Number((prev - 0.25).toFixed(2)))
                                        )
                                      }
                                      disabled={boardActivitiesZoom <= 1}
                                      title={t('actividades.daily.zoom_out')}
                                      className="p-1.5 sm:px-2.5 sm:py-1 rounded-full text-slate-700 dark:text-slate-200 hover:bg-white dark:hover:bg-slate-600 disabled:opacity-35 disabled:pointer-events-none transition-all active:scale-95 flex items-center gap-1 font-black text-xs"
                                    >
                                      <ZoomOut className="w-4 h-4 sm:w-[18px] sm:h-[18px]" />
                                      <span className="hidden sm:inline">{t('actividades.daily.zoom_out')}</span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setBoardActivitiesZoom(1)}
                                      title={t('actividades.daily.zoom_reset')}
                                      className={`px-2.5 py-1 rounded-full font-black text-xs tracking-wider transition-all ${
                                        boardActivitiesZoom > 1.02
                                          ? 'bg-indigo-600 text-white shadow-sm'
                                          : 'text-slate-600 dark:text-slate-300 hover:bg-white/60 dark:hover:bg-slate-600/60'
                                      }`}
                                    >
                                      {Math.round(boardActivitiesZoom * 100)}%
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setBoardActivitiesZoom((prev) =>
                                          Math.min(2.5, Number((prev + 0.25).toFixed(2)))
                                        )
                                      }
                                      disabled={boardActivitiesZoom >= 2.5}
                                      title={t('actividades.daily.zoom_in')}
                                      className="p-1.5 sm:px-2.5 sm:py-1 rounded-full text-slate-700 dark:text-slate-200 hover:bg-white dark:hover:bg-slate-600 disabled:opacity-35 disabled:pointer-events-none transition-all active:scale-95 flex items-center gap-1 font-black text-xs"
                                    >
                                      <ZoomIn className="w-4 h-4 sm:w-[18px] sm:h-[18px]" />
                                      <span className="hidden sm:inline">{t('actividades.daily.zoom_in')}</span>
                                    </button>
                                  </div>
                                  <span
                                    className="bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 py-[0.5vh] px-[1.4vh] rounded-full font-black uppercase tracking-widest"
                                    style={{ fontSize: 'clamp(10px, 1.25vh, 15px)' }}
                                  >
                                    {format(selectedDay, 'EEEE dd', { locale })}
                                  </span>
                                </div>
                              </div>
                              <div
                                ref={activitiesScrollRef}
                                onScroll={checkActivitiesScroll}
                                onTouchStart={handleActivitiesTouchStart}
                                onTouchMove={handleActivitiesTouchMove}
                                onTouchEnd={handleActivitiesTouchEnd}
                                onTouchCancel={handleActivitiesTouchEnd}
                                onWheel={handleActivitiesWheel}
                                style={{ touchAction: 'pan-y pinch-zoom' }}
                                className="flex-1 overflow-y-auto custom-scrollbar pr-0.5 min-h-0 pb-2"
                              >
                                {sortedActivities.length > 0 ? (
                                  <div 
                                    className={`grid ${isZoomedActivities ? 'h-auto' : 'h-full min-h-full'}`}
                                    style={{
                                      gap: gridGapStyle,
                                      gridTemplateColumns: `repeat(${numCols}, minmax(0, 1fr))`,
                                      gridTemplateRows: isZoomedActivities
                                        ? 'auto'
                                        : `repeat(${numRows}, minmax(max-content, 1fr))`
                                    }}
                                  >
                                    {sortedActivities.map((pa, i) => {
                                      const proc = pa.operating_procedures;
                                      if (!proc) return null;
                                      const adjTime = getAdjustedProcTime(proc);
                                      
                                      const category = (proc.shift_type || 'REGULAR').toUpperCase();
                                      const isApertura = category.includes('APE') || category.includes('OPEN');
                                      const isCierre = category.includes('CIE') || category.includes('CLOSE');
                                      
                                      const badgeColor = isApertura
                                        ? 'bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border-amber-300/60'
                                        : isCierre
                                        ? 'bg-purple-100 dark:bg-purple-950/40 text-purple-800 dark:text-purple-300 border-purple-300/60'
                                        : 'bg-blue-100 dark:bg-blue-950/40 text-blue-800 dark:text-blue-300 border-blue-300/60';

                                      return (
                                        <div
                                          key={i}
                                          role="button"
                                          tabIndex={0}
                                          onClick={() => setExpandedBoardActivityIndex(i)}
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter' || e.key === ' ') {
                                              e.preventDefault();
                                              setExpandedBoardActivityIndex(i);
                                            }
                                          }}
                                          title={t('actividades.daily.expand_activity')}
                                          style={{ padding: cardPaddingStyle }}
                                          className="group cursor-pointer flex flex-col justify-between bg-slate-50/90 dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-[1.4vh] hover:bg-indigo-50/50 dark:hover:bg-indigo-950/30 hover:border-indigo-300 dark:hover:border-indigo-700 active:scale-[0.99] transition-all shadow-sm h-full min-h-0 text-left"
                                        >
                                          <div className="mb-[0.6vh]">
                                            <div className="flex items-center justify-between gap-2 mb-[0.5vh]">
                                              <span
                                                style={{ fontSize: badgeFontStyle }}
                                                className={`inline-block px-[0.8vh] py-[0.2vh] font-extrabold rounded border uppercase tracking-wider ${badgeColor}`}
                                              >
                                                {proc.shift_type || 'REGULAR'}
                                              </span>
                                              <Maximize2 className="w-3.5 h-3.5 text-slate-300 dark:text-slate-600 group-hover:text-indigo-500 transition-colors flex-shrink-0" />
                                            </div>
                                            <span
                                              style={{ fontSize: titleFontStyle }}
                                              className="block font-black text-slate-900 dark:text-slate-100 tracking-tight leading-snug"
                                            >
                                              {proc.activity}
                                            </span>
                                            {proc.description && (
                                              <span
                                                style={{ fontSize: descFontStyle }}
                                                className="block font-medium text-slate-600 dark:text-slate-300 leading-snug mt-[0.5vh]"
                                              >
                                                {sanitizeUnsafeProcedureDescription(proc.description)}
                                              </span>
                                            )}
                                          </div>
                                          <div className="flex items-center justify-between mt-[0.6vh] pt-[0.6vh] border-t border-slate-200/70 dark:border-slate-800 flex-shrink-0">
                                            {adjTime ? (
                                              <div className="flex items-center gap-[0.6vh]">
                                                <Clock className="w-[1.6vh] h-[1.6vh] min-w-[13px] min-h-[13px] text-amber-500 flex-shrink-0" />
                                                <span
                                                  style={{ fontSize: clockFontStyle }}
                                                  className="font-extrabold text-amber-600 dark:text-amber-400 uppercase tracking-wider"
                                                >
                                                  {formatActivityTime(adjTime)}
                                                </span>
                                              </div>
                                            ) : (
                                              <div />
                                            )}
                                            <CheckCircle2 className="w-[2vh] h-[2vh] min-w-[16px] min-h-[16px] text-indigo-400 dark:text-indigo-600 flex-shrink-0" />
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                ) : (
                                  <div className="py-16 flex flex-col items-center justify-center opacity-30 h-full">
                                    <ClipboardList size={48} className="mb-3" />
                                    <p className="text-sm font-black text-slate-400 uppercase italic tracking-widest">
                                      {t('actividades.daily.no_activities_assigned')}
                                    </p>
                                  </div>
                                )}
                              </div>

                              {/* Expanded Single Activity Lightbox Overlay (Tap any card to read in giant font) */}
                              <AnimatePresence>
                                {expandedBoardActivityIndex !== null && sortedActivities[expandedBoardActivityIndex] && (() => {
                                  const expPa = sortedActivities[expandedBoardActivityIndex];
                                  const expProc = expPa?.operating_procedures;
                                  if (!expProc) return null;
                                  const expTime = getAdjustedProcTime(expProc);
                                  const expCategory = (expProc.shift_type || 'REGULAR').toUpperCase();
                                  const expApertura = expCategory.includes('APE') || expCategory.includes('OPEN');
                                  const expCierre = expCategory.includes('CIE') || expCategory.includes('CLOSE');
                                  const expBadgeColor = expApertura
                                    ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border-amber-300'
                                    : expCierre
                                    ? 'bg-purple-100 dark:bg-purple-950/60 text-purple-800 dark:text-purple-300 border-purple-300'
                                    : 'bg-blue-100 dark:bg-blue-950/60 text-blue-800 dark:text-blue-300 border-blue-300';

                                  return (
                                    <motion.div
                                      initial={{ opacity: 0, scale: 0.96 }}
                                      animate={{ opacity: 1, scale: 1 }}
                                      exit={{ opacity: 0, scale: 0.96 }}
                                      onClick={() => setExpandedBoardActivityIndex(null)}
                                      className="absolute inset-0 z-30 bg-slate-900/75 backdrop-blur-sm p-3 sm:p-6 flex items-center justify-center"
                                    >
                                      <div
                                        onClick={(e) => e.stopPropagation()}
                                        className="w-full max-w-4xl max-h-full bg-white dark:bg-slate-900 border-2 border-indigo-500/40 dark:border-indigo-500/50 rounded-3xl shadow-2xl p-5 sm:p-8 flex flex-col justify-between overflow-y-auto"
                                      >
                                        <div>
                                          <div className="flex flex-wrap items-center justify-between gap-3 pb-4 mb-5 border-b border-slate-200 dark:border-slate-800">
                                            <div className="flex items-center gap-3">
                                              <span className={`px-3.5 py-1.5 text-sm sm:text-base font-black rounded-xl border uppercase tracking-wider ${expBadgeColor}`}>
                                                {expProc.shift_type || 'REGULAR'}
                                              </span>
                                              <span className="text-sm sm:text-base font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">
                                                {expandedBoardActivityIndex + 1} / {sortedActivities.length}
                                              </span>
                                            </div>
                                            <div className="flex items-center gap-3">
                                              {expTime && (
                                                <div className="flex items-center gap-2 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 px-3.5 py-1.5 rounded-xl">
                                                  <Clock className="w-5 h-5 text-amber-500" />
                                                  <span className="text-base sm:text-lg font-black text-amber-600 dark:text-amber-400 uppercase tracking-wider">
                                                    {formatActivityTime(expTime)}
                                                  </span>
                                                </div>
                                              )}
                                              <button
                                                type="button"
                                                onClick={() => setExpandedBoardActivityIndex(null)}
                                                className="p-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-all active:scale-95"
                                                title={t('actividades.daily.close_expanded')}
                                              >
                                                <X className="w-6 h-6" />
                                              </button>
                                            </div>
                                          </div>

                                          <h3
                                            className="font-black text-slate-900 dark:text-white tracking-tight leading-tight mb-4"
                                            style={{ fontSize: 'clamp(22px, 3.8vh, 42px)' }}
                                          >
                                            {expProc.activity}
                                          </h3>

                                          {expProc.description && (
                                            <p
                                              className="font-semibold text-slate-700 dark:text-slate-200 leading-relaxed whitespace-pre-line"
                                              style={{ fontSize: 'clamp(17px, 2.7vh, 30px)' }}
                                            >
                                              {sanitizeUnsafeProcedureDescription(expProc.description)}
                                            </p>
                                          )}
                                        </div>

                                        <div className="flex items-center justify-between gap-3 pt-5 mt-6 border-t border-slate-200 dark:border-slate-800">
                                          <button
                                            type="button"
                                            disabled={expandedBoardActivityIndex <= 0}
                                            onClick={() =>
                                              setExpandedBoardActivityIndex((prev) =>
                                                prev !== null && prev > 0 ? prev - 1 : prev
                                              )
                                            }
                                            className="flex items-center gap-2 px-5 py-3 rounded-2xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 font-black uppercase tracking-wider text-sm sm:text-base disabled:opacity-35 disabled:pointer-events-none transition-all active:scale-95"
                                          >
                                            <ChevronLeft className="w-5 h-5" />
                                            <span>{t('actividades.daily.prev_activity')}</span>
                                          </button>

                                          <button
                                            type="button"
                                            onClick={() => setExpandedBoardActivityIndex(null)}
                                            className="px-6 py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white font-black uppercase tracking-wider text-sm sm:text-base shadow-md transition-all active:scale-95"
                                          >
                                            {t('actividades.daily.close_expanded')}
                                          </button>

                                          <button
                                            type="button"
                                            disabled={expandedBoardActivityIndex >= sortedActivities.length - 1}
                                            onClick={() =>
                                              setExpandedBoardActivityIndex((prev) =>
                                                prev !== null && prev < sortedActivities.length - 1 ? prev + 1 : prev
                                              )
                                            }
                                            className="flex items-center gap-2 px-5 py-3 rounded-2xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 font-black uppercase tracking-wider text-sm sm:text-base disabled:opacity-35 disabled:pointer-events-none transition-all active:scale-95"
                                          >
                                            <span>{t('actividades.daily.next_activity')}</span>
                                            <ChevronRight className="w-5 h-5" />
                                          </button>
                                        </div>
                                      </div>
                                    </motion.div>
                                  );
                                })()}
                              </AnimatePresence>

                              {/* Animated Downward Scroll Indicator when there are more activities below */}
                              <AnimatePresence>
                                {canScrollDownActivities && (
                                  <>
                                    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-white via-white/85 to-transparent dark:from-slate-800 dark:via-slate-800/85 z-10" />
                                    <motion.button
                                      type="button"
                                      initial={{ opacity: 0, y: 12 }}
                                      animate={{ opacity: 1, y: 0 }}
                                      exit={{ opacity: 0, y: 12 }}
                                      onClick={() => {
                                        const el = activitiesScrollRef.current;
                                        if (el) {
                                          el.scrollBy({
                                            top: Math.max(240, el.clientHeight * 0.72),
                                            behavior: 'smooth',
                                          });
                                        }
                                      }}
                                      className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 px-5 py-2.5 rounded-full bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs sm:text-sm uppercase tracking-wider shadow-[0_8px_25px_rgba(79,70,229,0.45)] border-2 border-white/80 dark:border-slate-700 cursor-pointer active:scale-95 transition-all"
                                    >
                                      <ChevronDown className="w-5 h-5 animate-bounce stroke-[3]" />
                                      <span>{t('actividades.daily.scroll_more_activities')}</span>
                                      <ChevronDown className="w-5 h-5 animate-bounce stroke-[3]" />
                                    </motion.button>
                                  </>
                                )}
                              </AnimatePresence>
                            </div>
                          </div>
                        </div>
                      );
                    }

                    // Reassignment select panel — Full screen responsive grid
                    return (
                      <div className="space-y-5 w-full max-w-none flex-1 flex flex-col min-h-0">
                        <div className="flex items-center justify-between flex-shrink-0">
                          <h4 className="text-xl sm:text-2xl font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest italic">
                            {t('actividades.daily.reassign_position')}
                          </h4>
                          <button
                            onClick={() => setIsReassigning(false)}
                            className="text-sm font-bold text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950 px-4 py-2 rounded-xl transition-all border border-indigo-200 dark:border-indigo-800/50"
                          >
                            {t('actividades.daily.back_to_profile')}
                          </button>
                        </div>
                        <div className="flex-1 overflow-y-auto space-y-4 pr-2 custom-scrollbar min-h-0">
                          <button
                            onClick={() => {
                              const targetKey = selectedSlotForCard.stationKey || selectedSlotForCard.label;
                              updateAssignment(
                                formatDateISO(selectedDay),
                                targetKey,
                                '',
                                currentAssignee?.station_group || getSectionForStation(targetKey),
                                { autoSave: true }
                              );
                              setSelectedEmployeeCard(null);
                              setIsReassigning(false);
                            }}
                            className="w-full p-4 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 font-black uppercase tracking-widest text-sm sm:text-base hover:bg-white dark:hover:bg-slate-800/50 transition-all text-left flex items-center gap-4"
                          >
                            <X size={20} />
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

                            const shiftSuffix = `_${activeShift}`;
                            const targetStationKey = selectedSlotForCard.stationKey || selectedSlotForCard.label;

                            const scheduledButtons = rosterEmployees.map((e) => {
                              const coveredStations = assignments
                                .filter(
                                  (a) =>
                                    a.assignment_date === formatDateISO(selectedDay) &&
                                    a.sub_position?.endsWith(shiftSuffix) &&
                                    String(a.employee_id) === String(e.id) &&
                                    a.main_station !== targetStationKey
                                )
                                .map((a) => a.main_station)
                                .filter(Boolean);

                              return (
                                <button
                                  key={e.id}
                                  onClick={() => {
                                    updateAssignment(
                                      formatDateISO(selectedDay),
                                      targetStationKey,
                                      String(e.id),
                                      currentAssignee?.station_group || getSectionForStation(targetStationKey),
                                      { autoSave: true }
                                    );
                                    setSelectedEmployeeCard(e);
                                    setIsReassigning(false);
                                  }}
                                  className="w-full p-4 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700 shadow-sm hover:border-indigo-500 dark:hover:border-indigo-500 hover:bg-indigo-50/30 dark:hover:bg-indigo-950/10 transition-all text-left flex items-center gap-4 group"
                                >
                                  <div className="w-12 h-12 bg-slate-100 dark:bg-slate-900 rounded-xl flex items-center justify-center text-lg font-black text-slate-500 group-hover:text-indigo-600 shadow-inner flex-shrink-0">
                                    {(e.chosen_name || e.first_name)?.[0]?.toUpperCase()}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-base sm:text-lg font-black text-slate-900 dark:text-white uppercase leading-tight mb-0.5 truncate">
                                      {e.chosen_name || e.first_name}
                                    </p>
                                    <p className="text-xs font-bold text-slate-400 uppercase tracking-widest truncate">
                                      {e.last_name}
                                    </p>
                                  </div>
                                  {coveredStations.length > 0 && (
                                    <span className="text-[11px] font-bold text-indigo-600 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/50 border border-indigo-200/60 dark:border-indigo-800/50 px-2.5 py-1 rounded-lg uppercase">
                                      {t('actividades.daily.already_covers')} {coveredStations.join(', ')}
                                    </span>
                                  )}
                                </button>
                              );
                            });

                            // Off-duty employees (day off / vacation)
                            const offDutyButtons = offDutyEmployees.length > 0 ? (
                              <>
                                <div className="col-span-full w-full flex items-center gap-3 py-2 mt-2">
                                  <div className="flex-1 border-t border-dashed border-slate-300 dark:border-slate-700" />
                                  <span className="text-xs font-bold text-slate-400 uppercase tracking-widest whitespace-nowrap">
                                    🌙 {t('actividades.daily.off_duty')}
                                  </span>
                                  <div className="flex-1 border-t border-dashed border-slate-300 dark:border-slate-700" />
                                </div>
                                {offDutyEmployees.map((e) => {
                                  const coveredStations = assignments
                                    .filter(
                                      (a) =>
                                        a.assignment_date === formatDateISO(selectedDay) &&
                                        a.sub_position?.endsWith(shiftSuffix) &&
                                        String(a.employee_id) === String(e.id) &&
                                        a.main_station !== targetStationKey
                                    )
                                    .map((a) => a.main_station)
                                    .filter(Boolean);

                                  return (
                                    <button
                                      key={`off-${e.id}`}
                                      onClick={() => {
                                        updateAssignment(
                                          formatDateISO(selectedDay),
                                          targetStationKey,
                                          String(e.id),
                                          currentAssignee?.station_group || getSectionForStation(targetStationKey),
                                          { autoSave: true }
                                        );
                                        setSelectedEmployeeCard(e);
                                        setIsReassigning(false);
                                      }}
                                      className="w-full p-4 rounded-2xl bg-amber-50/50 dark:bg-amber-950/10 border border-dashed border-amber-200 dark:border-amber-800/40 shadow-sm hover:border-indigo-500 dark:hover:border-indigo-500 hover:bg-indigo-50/30 dark:hover:bg-indigo-950/10 transition-all text-left flex items-center gap-4 group"
                                    >
                                      <div className="w-12 h-12 bg-amber-50 dark:bg-amber-900/20 rounded-xl flex items-center justify-center text-lg font-black text-amber-500 group-hover:text-indigo-600 shadow-inner flex-shrink-0">
                                        {(e.chosen_name || e.first_name)?.[0]?.toUpperCase()}
                                      </div>
                                      <div className="flex-1 min-w-0">
                                        <p className="text-base sm:text-lg font-black text-slate-900 dark:text-white uppercase leading-tight mb-0.5 truncate">
                                          {e.chosen_name || e.first_name}
                                        </p>
                                        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest truncate">
                                          {e.last_name}
                                        </p>
                                      </div>
                                      {coveredStations.length > 0 && (
                                        <span className="text-[11px] font-bold text-indigo-600 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/50 border border-indigo-200/60 dark:border-indigo-800/50 px-2.5 py-1 rounded-lg uppercase">
                                          {t('actividades.daily.already_covers')} {coveredStations.join(', ')}
                                        </span>
                                      )}
                                      <span className="text-[10px] font-bold text-amber-600 bg-amber-100 dark:bg-amber-900/30 px-2.5 py-1 rounded-lg uppercase">
                                        {t('actividades.daily.day_off_badge')}
                                      </span>
                                    </button>
                                  );
                                })}
                              </>
                            ) : null;

                            return (
                              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                                {scheduledButtons}
                                {offDutyButtons}
                              </div>
                            );
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

      {/* ═══════════════ MODAL VISTA PREVIA DE PUBLICACIÓN / CORREOS (PORTAL) ═══════════════ */}
      {typeof document !== 'undefined' && showPublishPreviewModal && createPortal(
        <div
          onClick={() => setShowPublishPreviewModal(false)}
          className="fixed inset-0 z-[10001] bg-slate-950/75 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-4xl max-h-[88vh] rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col overflow-hidden"
          >
            {/* Header */}
            <div className="px-6 py-4 bg-gradient-to-r from-indigo-600 to-blue-600 text-white flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Mail className="w-5 h-5" />
                <div>
                  <h3 className="text-base sm:text-lg font-extrabold">
                    {t('actividades.daily.preview_publish_title')}
                  </h3>
                  <p className="text-xs text-indigo-100">
                    {selectedStore ? formatStoreName(selectedStore.name) : ''} • {weekRangeLabel}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowPublishPreviewModal(false)}
                className="p-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-4 custom-scrollbar">
              {/* Pilot Banner */}
              <div
                className={`p-3.5 rounded-2xl border flex items-center justify-between gap-3 ${
                  isStorePilotActiveForActivitiesEmail(selectedStore)
                    ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800/50 text-emerald-800 dark:text-emerald-300'
                    : 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800/50 text-amber-800 dark:text-amber-300'
                }`}
              >
                <div className="flex items-center gap-2.5 text-xs sm:text-sm font-bold">
                  <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                  <span>
                    {isStorePilotActiveForActivitiesEmail(selectedStore)
                      ? t('actividades.daily.pilot_active_badge')
                      : t('actividades.daily.pilot_inactive_badge')}
                  </span>
                </div>
                <span className="text-[11px] font-semibold opacity-80">
                  {t('actividades.daily.preview_publish_subtitle')}
                </span>
              </div>

              {publishPreviewLoading ? (
                <div className="py-16 flex flex-col items-center justify-center gap-3">
                  <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
                  <p className="text-xs font-semibold text-slate-500">
                    {t('actividades.daily.loading')}
                  </p>
                </div>
              ) : publishPreviewData?.error ? (
                <div className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-sm font-semibold">
                  {publishPreviewData.error}
                </div>
              ) : (
                <>
                  {/* Summary counters */}
                  {publishPreviewData?.summary && (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60">
                        <p className="text-[10px] font-bold uppercase text-slate-400">
                          {language === 'es' ? 'Empleados c/ Turno' : 'Scheduled Staff'}
                        </p>
                        <p className="text-lg font-black text-slate-800 dark:text-white">
                          {publishPreviewData.summary.employeesCount ?? 0}
                        </p>
                      </div>
                      <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60">
                        <p className="text-[10px] font-bold uppercase text-slate-400">
                          {language === 'es' ? 'Con Correo Válido' : 'Valid Emails'}
                        </p>
                        <p className="text-lg font-black text-emerald-600 dark:text-emerald-400">
                          {publishPreviewData.summary.validEmailsCount ?? 0}
                        </p>
                      </div>
                      <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60">
                        <p className="text-[10px] font-bold uppercase text-slate-400">
                          {language === 'es' ? 'Sin Correo' : 'Missing Email'}
                        </p>
                        <p className="text-lg font-black text-amber-600 dark:text-amber-400">
                          {publishPreviewData.summary.missingEmailsCount ?? 0}
                        </p>
                      </div>
                      <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60">
                        <p className="text-[10px] font-bold uppercase text-slate-400">
                          {language === 'es' ? 'Turnos Totales' : 'Total Shifts'}
                        </p>
                        <p className="text-lg font-black text-indigo-600 dark:text-indigo-400">
                          {publishPreviewData.summary.totalShifts ?? 0}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Per-employee preview list */}
                  <div className="space-y-3">
                    {(publishPreviewData?.previews || []).map((empPrev: any) => (
                      <div
                        key={empPrev.employeeId}
                        className="p-4 rounded-2xl bg-slate-50/80 dark:bg-slate-800/50 border border-slate-200/70 dark:border-slate-700/60 space-y-2.5"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <h4 className="text-sm font-black text-slate-900 dark:text-white">
                              {empPrev.employeeName}
                            </h4>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                              {empPrev.email || (
                                <span className="text-rose-500 font-bold">
                                  ⚠ {language === 'es' ? 'Sin correo registrado (no se enviará a buzón de respaldo)' : 'No email registered (will not fallback)'}
                                </span>
                              )}
                            </p>
                          </div>
                          <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-indigo-100 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300">
                            {(empPrev.shifts || []).length} {language === 'es' ? 'turnos' : 'shifts'}
                          </span>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          {(empPrev.shifts || []).map((sh: any, sIdx: number) => (
                            <div
                              key={sIdx}
                              className="p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800 text-xs space-y-1"
                            >
                              <div className="flex items-center justify-between font-bold text-slate-800 dark:text-slate-200">
                                <span>{sh.date}</span>
                                <span>{sh.startTime} - {sh.endTime}</span>
                              </div>
                              <div className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400">
                                {sh.stations?.length > 0
                                  ? sh.stations.join(' + ')
                                  : sh.position || '—'}
                              </div>
                              {Array.isArray(sh.activities) && sh.activities.length > 0 && (
                                <div className="pt-1 border-t border-slate-100 dark:border-slate-800 text-[10px] text-slate-500 dark:text-slate-400">
                                  {sh.activities.slice(0, 4).map((act: any, aIdx: number) => (
                                    <div key={aIdx} className="truncate">
                                      • {act.activity} {act.adjustedTime ? `(${act.adjustedTime.slice(0, 5)})` : ''}
                                    </div>
                                  ))}
                                  {sh.activities.length > 4 && (
                                    <div className="italic text-slate-400">
                                      +{sh.activities.length - 4} {t('actividades.daily.more_activities')}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ═══ MODAL AUTOMÁTICO: DESPERTAR TABLETA TRAS 3 HORAS DE INACTIVIDAD (PORTAL) ═══ */}
      {typeof document !== 'undefined' && showWakeUpModal && createPortal(
        <div
          onClick={handleWakeUpTablet}
          className="fixed inset-0 z-[100000] bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-6 animate-in fade-in duration-300 cursor-pointer select-none"
        >
          <div
            onClick={(e) => {
              e.stopPropagation();
              void handleWakeUpTablet();
            }}
            className="relative w-full max-w-xl rounded-3xl bg-gradient-to-b from-slate-900 via-slate-900 to-slate-950 border-2 border-amber-500/60 shadow-[0_0_80px_rgba(245,158,11,0.35)] p-8 text-center overflow-hidden"
          >
            <div className="mx-auto mb-5 w-20 h-20 rounded-full bg-amber-500/20 border-2 border-amber-400/60 flex items-center justify-center shadow-[0_0_35px_rgba(245,158,11,0.4)]">
              <RefreshCw className={`w-10 h-10 text-amber-400 ${wakingUpTablet ? 'animate-spin' : ''}`} />
            </div>

            <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight uppercase mb-2">
              {t('prep.wakeModalTitle')}
            </h2>
            <p className="text-sm sm:text-base text-slate-300 font-medium max-w-md mx-auto mb-6">
              {t('prep.wakeModalSubtitle')}
            </p>

            <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-4 mb-6 text-left space-y-2.5">
              <div className="flex items-center gap-3 text-xs sm:text-sm font-bold text-emerald-300">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>{t('prep.wakeModalCheck1')}</span>
              </div>
              <div className="flex items-center gap-3 text-xs sm:text-sm font-bold text-amber-300">
                <Clock className="w-4 h-4 text-amber-400 shrink-0" />
                <span>{t('prep.wakeModalCheck2')}</span>
              </div>
              <div className="flex items-center gap-3 text-xs sm:text-sm font-bold text-cyan-300">
                <Zap className="w-4 h-4 text-cyan-400 shrink-0" />
                <span>{t('prep.wakeModalCheck3')}</span>
              </div>
            </div>

            <button
              type="button"
              disabled={wakingUpTablet}
              onClick={(e) => {
                e.stopPropagation();
                void handleWakeUpTablet();
              }}
              className="w-full py-4 px-6 rounded-2xl bg-gradient-to-r from-amber-500 via-orange-500 to-amber-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 font-black text-lg sm:text-xl uppercase tracking-wider shadow-[0_10px_30px_rgba(245,158,11,0.45)] active:scale-[0.98] transition-all flex items-center justify-center gap-3"
            >
              <RefreshCw className={`w-6 h-6 ${wakingUpTablet ? 'animate-spin' : ''}`} />
              <span>{wakingUpTablet ? t('prep.wakingUpTablet') : t('prep.wakeUpTablet')}</span>
            </button>

            <p className="mt-4 text-[11px] font-bold uppercase tracking-widest text-amber-400/80 animate-pulse">
              {t('prep.wakeModalTapHint')}
            </p>
          </div>
        </div>,
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
