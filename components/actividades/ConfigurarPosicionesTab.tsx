'use client';

/**
 * @module ConfigurarPosicionesTab
 * @description Full-page tab component that lets supervisors assign activities from the catalog
 * (operating_procedures) to positions (position_activities). Two-column layout with a grouped
 * position sidebar on the left and an activity assignment panel on the right.
 * @businessRules
 * - Activity assignments are global (not per-store).
 * - Each position can have multiple activities assigned with unique (position_key, shift, activity_id, frequency, store_model).
 * - Shift filter: AM / PM / AMBOS. Store model filter: REGULAR / DRIVE_THRU / AMBOS.
 * - Category color coding: Apertura=amber/orange, Regular=blue/cyan, Cierre=indigo/purple.
 * - The business day starts at 6:00 AM and ends at 5:59 AM next day; PM shift starts at 5:00 PM.
 * @dataFlow
 * - On mount: fetches position_activities via GET /api/roles/activities AND procedures via GET /api/procedimientos.
 * - Add: POST /api/roles/activities with {position_key, shift, activity_id, frequency, store_model}.
 * - Remove: POST /api/roles/activities with {position_key, shift, activity_id, frequency, store_model, action:'delete'}.
 * - After each add/remove, refetches position_activities.
 * - Realtime subscription on position_activities table for live sync across devices.
 * @notes
 * - Export default. Takes no props.
 * - Responsive: on mobile sidebar becomes horizontal scrollable chips.
 */

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search,
  ChevronDown,
  ChevronRight,
  Plus,
  X,
  CheckCircle2,
  Clock,
  Users,
  LayoutGrid,
  Loader2,
  Settings2,
  Building2,
  Car,
  Utensils,
  ShieldCheck,
  Coffee,
  Trash2,
} from 'lucide-react';
import { useLanguage } from '@/lib/i18n';
import { createClient } from '@/lib/supabase-client';

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════
interface OperatingProcedure {
  id: string;
  activity: string;
  start_time: string | null;
  duration_minutes: number | null;
  shift_type: string; // Apertura | Regular | Cierre
  frequency: string;
  role: string | null;
  description: string | null;
  shift?: string;
  store_model?: string;
}

interface PositionActivity {
  id: string;
  position_key: string;
  shift: string;  // AM | PM | AMBOS
  activity_id: string;
  frequency: string;
  store_model: string;
  sort_order: number;
  operating_procedures: OperatingProcedure | null;
}

// ═══════════════════════════════════════════════════════════════
// Position Groups Configuration
// ═══════════════════════════════════════════════════════════════
interface PositionGroup {
  key: string;
  // i18n key for the group name label
  labelKey: string;
  icon: React.ReactNode;
  color: string;
  positions: string[];
}

const POSITION_GROUPS: PositionGroup[] = [
  {
    key: 'liderazgo',
    labelKey: 'actividades.config.group_leadership',
    icon: <ShieldCheck className="w-4 h-4" />,
    color: 'from-amber-500 to-yellow-500',
    positions: ['MANAGER', 'ASSISTANT', 'SHIFT_LEADER_MALE', 'SHIFT_LEADER_FEMALE'],
  },
  {
    key: 'salon',
    labelKey: 'actividades.config.group_salon',
    icon: <Coffee className="w-4 h-4" />,
    color: 'from-blue-500 to-cyan-500',
    positions: [
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
    key: 'cocina',
    labelKey: 'actividades.config.group_kitchen',
    icon: <Utensils className="w-4 h-4" />,
    color: 'from-orange-500 to-red-500',
    positions: ['TACOS', 'CARNES', 'BURRITOS', 'TORTILLAS', 'TORTAS/QUESADILLAS', 'PREPARACION'],
  },
  {
    key: 'drive_thru',
    labelKey: 'actividades.config.group_drive_thru',
    icon: <Car className="w-4 h-4" />,
    color: 'from-emerald-500 to-teal-500',
    positions: ['Ventana 1', 'Ventana 2'],
  },
];

const ALL_POSITIONS = POSITION_GROUPS.flatMap(g => g.positions);

// ═══════════════════════════════════════════════════════════════
// Helper: format time for display badges
// ═══════════════════════════════════════════════════════════════
function formatTimeBadge(timeStr: string | null): string {
  if (!timeStr) return '';
  const [h, m] = timeStr.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  let h12 = h % 12;
  h12 = h12 === 0 ? 12 : h12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

// ═══════════════════════════════════════════════════════════════
// Helper: shift_type badge colors
// ═══════════════════════════════════════════════════════════════
function getShiftTypeBadge(shiftType: string): { bg: string; text: string; emoji: string } {
  switch (shiftType) {
    case 'Apertura':
      return { bg: 'bg-amber-100 dark:bg-amber-900/30', text: 'text-amber-700 dark:text-amber-300', emoji: '🌅' };
    case 'Regular':
      return { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-700 dark:text-blue-300', emoji: '☀️' };
    case 'Cierre':
      return { bg: 'bg-indigo-100 dark:bg-indigo-900/30', text: 'text-indigo-700 dark:text-indigo-300', emoji: '🌙' };
    default:
      return { bg: 'bg-slate-100 dark:bg-slate-700', text: 'text-slate-600 dark:text-slate-300', emoji: '📋' };
  }
}

// ═══════════════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════════════

/**
 * i18n keys needed (to be added to i18n.tsx by parent agent):
 *
 * actividades.config.title                 → "Configurar Posiciones" / "Configure Positions"
 * actividades.config.subtitle              → "Asigna actividades del catálogo a cada posición" / "Assign catalog activities to each position"
 * actividades.config.search_positions      → "Buscar posición..." / "Search position..."
 * actividades.config.search_activities     → "Buscar actividad..." / "Search activity..."
 * actividades.config.group_leadership      → "Liderazgo" / "Leadership"
 * actividades.config.group_salon           → "Salón / Servicio" / "Dining / Service"
 * actividades.config.group_kitchen         → "Cocina" / "Kitchen"
 * actividades.config.group_drive_thru      → "Drive-Thru" / "Drive-Thru"
 * actividades.config.assigned_activities   → "Actividades Asignadas" / "Assigned Activities"
 * actividades.config.available_activities  → "Actividades Disponibles" / "Available Activities"
 * actividades.config.no_assigned           → "Sin actividades asignadas" / "No activities assigned"
 * actividades.config.no_available          → "No hay actividades disponibles con estos filtros" / "No activities available with these filters"
 * actividades.config.empty_state_title     → "Selecciona una Posición" / "Select a Position"
 * actividades.config.empty_state_subtitle  → "Elige una posición del panel izquierdo para ver y asignar actividades" / "Choose a position from the left panel to view and assign activities"
 * actividades.config.shift_label           → "Turno" / "Shift"
 * actividades.config.store_model_label     → "Modelo" / "Model"
 * actividades.config.all                   → "Todos" / "All"
 * actividades.config.loading               → "Cargando datos..." / "Loading data..."
 * actividades.config.adding                → "Agregando..." / "Adding..."
 * actividades.config.removing              → "Removiendo..." / "Removing..."
 * actividades.config.error_add             → "Error al asignar actividad" / "Error assigning activity"
 * actividades.config.error_remove          → "Error al remover actividad" / "Error removing activity"
 * actividades.config.error_load            → "Error al cargar datos" / "Error loading data"
 * actividades.config.activities_count      → "actividades" / "activities"
 * actividades.config.positions             → "Posiciones" / "Positions"
 */

export default function ConfigurarPosicionesTab() {
  const { t } = useLanguage();
  const supabase = useRef(createClient()).current;

  // ═══════════════ State ═══════════════
  const [procedures, setProcedures] = useState<OperatingProcedure[]>([]);
  const [positionActivities, setPositionActivities] = useState<PositionActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null); // activity_id being added/removed

  const [selectedPosition, setSelectedPosition] = useState<string | null>(null);
  const [positionSearch, setPositionSearch] = useState('');
  const [activitySearch, setActivitySearch] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(POSITION_GROUPS.map(g => [g.key, true]))
  );

  // Filters for the right panel
  const [filterShift, setFilterShift] = useState<string>('AMBOS');
  const [filterStoreModel, setFilterStoreModel] = useState<string>('AMBOS');

  // ═══════════════ Data Fetching ═══════════════
  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [paRes, procRes] = await Promise.all([
        fetch('/api/roles/activities'),
        fetch('/api/procedimientos'),
      ]);

      if (!paRes.ok) throw new Error('Failed to fetch position activities');
      if (!procRes.ok) throw new Error('Failed to fetch procedures');

      const paData: PositionActivity[] = await paRes.json();
      const procJson = await procRes.json();
      const procData: OperatingProcedure[] = procJson.data || procJson;

      setPositionActivities(Array.isArray(paData) ? paData : []);
      // Excluir las actividades internas del módulo Roles (solo visibles en ese módulo)
      const catalogOnly = (Array.isArray(procData) ? procData : []).filter(p => p.role !== 'ROLES_MODULE');
      setProcedures(catalogOnly);
    } catch (err) {
      console.error('Error loading config data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const refetchPositionActivities = useCallback(async () => {
    try {
      const res = await fetch('/api/roles/activities');
      if (!res.ok) throw new Error('Failed to refetch');
      const data: PositionActivity[] = await res.json();
      setPositionActivities(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Error refetching position activities:', err);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ═══════════════ Realtime ═══════════════
  useEffect(() => {
    let debounceTimer: NodeJS.Timeout | null = null;

    const channel = supabase
      .channel('config-positions-realtime')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'position_activities',
      }, () => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          refetchPositionActivities();
        }, 800);
      })
      .subscribe();

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      supabase.removeChannel(channel);
    };
  }, [supabase, refetchPositionActivities]);

  // ═══════════════ Derived Data ═══════════════

  // Count of assigned activities per position
  const activityCountByPosition = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const pa of positionActivities) {
      counts[pa.position_key] = (counts[pa.position_key] || 0) + 1;
    }
    return counts;
  }, [positionActivities]);

  // Assigned activity IDs for the selected position (considering shift + store_model filter)
  const assignedForSelected = useMemo(() => {
    if (!selectedPosition) return [];
    return positionActivities.filter(pa => {
      if (pa.position_key !== selectedPosition) return false;
      // When filtering, show all that match or are AMBOS
      if (filterShift !== 'AMBOS') {
        if (pa.shift !== filterShift && pa.shift !== 'AMBOS') return false;
      }
      if (filterStoreModel !== 'AMBOS') {
        if (pa.store_model !== filterStoreModel && pa.store_model !== 'AMBOS') return false;
      }
      return true;
    });
  }, [selectedPosition, positionActivities, filterShift, filterStoreModel]);

  const assignedActivityIds = useMemo(
    () => new Set(assignedForSelected.map(pa => pa.activity_id)),
    [assignedForSelected]
  );

  // Available (unassigned) procedures filtered
  const availableProcedures = useMemo(() => {
    return procedures.filter(proc => {
      // Exclude those already assigned
      if (assignedActivityIds.has(proc.id)) return false;
      // Search filter
      if (activitySearch) {
        const q = activitySearch.toLowerCase();
        if (
          !proc.activity.toLowerCase().includes(q) &&
          !(proc.description || '').toLowerCase().includes(q) &&
          !(proc.role || '').toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [procedures, assignedActivityIds, activitySearch]);

  // Assigned procedures with enriched data, also filtered by activity search
  const assignedProcedures = useMemo(() => {
    return assignedForSelected
      .map(pa => ({
        positionActivity: pa,
        procedure: pa.operating_procedures || procedures.find(p => p.id === pa.activity_id) || null,
      }))
      .filter(item => {
        if (!item.procedure) return false;
        if (activitySearch) {
          const q = activitySearch.toLowerCase();
          if (
            !item.procedure.activity.toLowerCase().includes(q) &&
            !(item.procedure.description || '').toLowerCase().includes(q)
          ) {
            return false;
          }
        }
        return true;
      });
  }, [assignedForSelected, procedures, activitySearch]);

  // Filter positions by search
  const filteredGroups = useMemo(() => {
    if (!positionSearch) return POSITION_GROUPS;
    const q = positionSearch.toLowerCase();
    return POSITION_GROUPS.map(group => ({
      ...group,
      positions: group.positions.filter(pos => pos.toLowerCase().includes(q)),
    })).filter(group => group.positions.length > 0);
  }, [positionSearch]);

  // ═══════════════ Actions ═══════════════
  const handleAddActivity = useCallback(async (proc: OperatingProcedure) => {
    if (!selectedPosition || actionLoading) return;
    setActionLoading(proc.id);
    try {
      const res = await fetch('/api/roles/activities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          position_key: selectedPosition,
          shift: filterShift,
          activity_id: proc.id,
          frequency: proc.frequency || 'Diario',
          store_model: filterStoreModel,
        }),
      });
      if (!res.ok) {
        const errJson = await res.json();
        throw new Error(errJson.error || 'Unknown error');
      }
      await refetchPositionActivities();
    } catch (err) {
      console.error('Error adding activity:', err);
      alert(t('actividades.config.error_add'));
    } finally {
      setActionLoading(null);
    }
  }, [selectedPosition, filterShift, filterStoreModel, actionLoading, refetchPositionActivities, t]);

  const handleRemoveActivity = useCallback(async (pa: PositionActivity) => {
    if (actionLoading) return;
    setActionLoading(pa.activity_id);
    try {
      const res = await fetch('/api/roles/activities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          position_key: pa.position_key,
          shift: pa.shift,
          activity_id: pa.activity_id,
          frequency: pa.frequency,
          store_model: pa.store_model,
          action: 'delete',
        }),
      });
      if (!res.ok) {
        const errJson = await res.json();
        throw new Error(errJson.error || 'Unknown error');
      }
      await refetchPositionActivities();
    } catch (err) {
      console.error('Error removing activity:', err);
      alert(t('actividades.config.error_remove'));
    } finally {
      setActionLoading(null);
    }
  }, [actionLoading, refetchPositionActivities, t]);

  const toggleGroup = useCallback((key: string) => {
    setExpandedGroups(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  // ═══════════════ Loading State ═══════════════
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-4">
        <Loader2 className="w-10 h-10 text-indigo-500 animate-spin" />
        <p className="text-slate-500 dark:text-slate-400 text-sm font-medium">
          {t('actividades.config.loading')}
        </p>
      </div>
    );
  }

  // ═══════════════ Render ═══════════════
  return (
    <div className="w-full max-w-[1600px] mx-auto px-2 sm:px-4 lg:px-6 pb-24">
      {/* ══════ Header ══════ */}
      <div className="mb-4 sm:mb-6 p-4 sm:p-6 rounded-2xl sm:rounded-3xl bg-white/40 dark:bg-slate-900/40 backdrop-blur-xl border border-white/20 dark:border-slate-800/50 shadow-xl overflow-hidden relative">
        <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/15 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3" />
        <div className="absolute bottom-0 left-0 w-48 h-48 bg-blue-500/10 rounded-full blur-3xl translate-y-1/2 -translate-x-1/3" />
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg">
              <Settings2 className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-extrabold bg-gradient-to-r from-indigo-600 to-purple-600 dark:from-indigo-400 dark:to-purple-400 bg-clip-text text-transparent">
                {t('actividades.config.title')}
              </h1>
              <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
                {t('actividades.config.subtitle')}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ══════ Main 2-Column Layout ══════ */}
      <div className="flex flex-col lg:flex-row gap-4 sm:gap-6">

        {/* ─────── LEFT SIDEBAR: Position List ─────── */}
        <div className="w-full lg:w-[300px] lg:flex-shrink-0">
          <div className="sticky top-4 bg-white/60 dark:bg-slate-800/60 backdrop-blur-xl rounded-2xl border border-white/20 dark:border-slate-700/50 shadow-lg overflow-hidden">
            {/* Sidebar Header */}
            <div className="p-3 border-b border-slate-200/50 dark:border-slate-700/50">
              <div className="flex items-center gap-2 mb-2">
                <Users className="w-4 h-4 text-indigo-500" />
                <h2 className="text-sm font-bold text-slate-700 dark:text-slate-200">
                  {t('actividades.config.positions')}
                </h2>
                <span className="ml-auto text-xs font-semibold text-slate-400 bg-slate-100 dark:bg-slate-700 px-2 py-0.5 rounded-full">
                  {ALL_POSITIONS.length}
                </span>
              </div>
              {/* Position Search */}
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                <input
                  type="text"
                  placeholder={t('actividades.config.search_positions')}
                  value={positionSearch}
                  onChange={e => setPositionSearch(e.target.value)}
                  className="w-full pl-8 pr-3 py-2 text-xs bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-700 dark:text-slate-200 placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-500/50 outline-none transition-all"
                />
              </div>
            </div>

            {/* ─── Desktop: Grouped expandable list ─── */}
            <div className="hidden lg:block max-h-[calc(100vh-280px)] overflow-y-auto scrollbar-hide">
              {filteredGroups.map(group => (
                <div key={group.key}>
                  {/* Group Header */}
                  <button
                    onClick={() => toggleGroup(group.key)}
                    className="w-full flex items-center gap-2 px-3 py-2.5 text-xs font-bold text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors uppercase tracking-wider"
                  >
                    <div className={`w-5 h-5 rounded-lg bg-gradient-to-br ${group.color} flex items-center justify-center text-white`}>
                      {group.icon}
                    </div>
                    <span className="flex-1 text-left">{t(group.labelKey)}</span>
                    {expandedGroups[group.key] ? (
                      <ChevronDown className="w-3.5 h-3.5" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5" />
                    )}
                  </button>

                  {/* Position Items */}
                  <AnimatePresence initial={false}>
                    {expandedGroups[group.key] && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                      >
                        {group.positions.map(pos => {
                          const count = activityCountByPosition[pos] || 0;
                          const isSelected = selectedPosition === pos;
                          return (
                            <button
                              key={pos}
                              onClick={() => setSelectedPosition(isSelected ? null : pos)}
                              className={`w-full flex items-center gap-2 px-4 py-2 text-left text-sm transition-all duration-200 border-l-[3px] ${
                                isSelected
                                  ? 'bg-indigo-50 dark:bg-indigo-900/20 border-l-indigo-500 text-indigo-700 dark:text-indigo-300 font-semibold'
                                  : 'border-l-transparent text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/30'
                              }`}
                            >
                              <span className="flex-1 truncate text-xs">{pos}</span>
                              <span
                                className={`flex-shrink-0 min-w-[22px] h-5 flex items-center justify-center rounded-full text-[10px] font-bold px-1.5 ${
                                  count > 0
                                    ? isSelected
                                      ? 'bg-indigo-500 text-white'
                                      : 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-300'
                                    : 'bg-slate-100 dark:bg-slate-700 text-slate-400'
                                }`}
                              >
                                {count}
                              </span>
                            </button>
                          );
                        })}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              ))}
              {filteredGroups.length === 0 && (
                <div className="p-4 text-center text-xs text-slate-400">
                  {t('actividades.config.no_available')}
                </div>
              )}
            </div>

            {/* ─── Mobile: Horizontal scrollable chips ─── */}
            <div className="lg:hidden p-3 flex gap-2 overflow-x-auto scrollbar-hide">
              {filteredGroups.flatMap(group =>
                group.positions.map(pos => {
                  const count = activityCountByPosition[pos] || 0;
                  const isSelected = selectedPosition === pos;
                  return (
                    <button
                      key={pos}
                      onClick={() => setSelectedPosition(isSelected ? null : pos)}
                      className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all whitespace-nowrap ${
                        isSelected
                          ? 'bg-indigo-500 text-white shadow-md'
                          : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      {pos}
                      <span
                        className={`min-w-[18px] h-4 flex items-center justify-center rounded-full text-[9px] font-bold px-1 ${
                          isSelected ? 'bg-white/30 text-white' : 'bg-slate-200 dark:bg-slate-600 text-slate-500 dark:text-slate-300'
                        }`}
                      >
                        {count}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* ─────── RIGHT PANEL: Activity Assignment ─────── */}
        <div className="flex-1 min-w-0">
          <AnimatePresence mode="wait">
            {selectedPosition ? (
              <motion.div
                key={selectedPosition}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.25 }}
              >
                {/* ── Right Panel Header ── */}
                <div className="bg-white/60 dark:bg-slate-800/60 backdrop-blur-xl rounded-2xl border border-white/20 dark:border-slate-700/50 shadow-lg p-4 sm:p-5 mb-4">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-md">
                        <LayoutGrid className="w-4 h-4 text-white" />
                      </div>
                      <div className="min-w-0">
                        <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100 truncate">
                          {selectedPosition}
                        </h2>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          {assignedForSelected.length} {t('actividades.config.activities_count')}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* ── Filter Bar ── */}
                  <div className="flex flex-col sm:flex-row gap-3">
                    {/* Shift toggle */}
                    <div className="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-900/50 rounded-xl p-1 border border-slate-200/50 dark:border-slate-700/50">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider ml-2 mr-1">
                        {t('actividades.config.shift_label')}
                      </span>
                      {['AM', 'PM', 'AMBOS'].map(s => (
                        <button
                          key={s}
                          onClick={() => setFilterShift(s)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                            filterShift === s
                              ? 'bg-indigo-500 text-white shadow-sm'
                              : 'text-slate-500 dark:text-slate-400 hover:bg-slate-200/50 dark:hover:bg-slate-700/50'
                          }`}
                        >
                          {s === 'AMBOS' ? t('actividades.config.all') : s}
                        </button>
                      ))}
                    </div>

                    {/* Store Model toggle */}
                    <div className="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-900/50 rounded-xl p-1 border border-slate-200/50 dark:border-slate-700/50">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider ml-2 mr-1">
                        {t('actividades.config.store_model_label')}
                      </span>
                      {[
                        { value: 'AMBOS', label: t('actividades.config.all'), icon: null },
                        { value: 'REGULAR', label: 'Regular', icon: <Building2 className="w-3 h-3" /> },
                        { value: 'DRIVE_THRU', label: 'Drive-Thru', icon: <Car className="w-3 h-3" /> },
                      ].map(m => (
                        <button
                          key={m.value}
                          onClick={() => setFilterStoreModel(m.value)}
                          className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                            filterStoreModel === m.value
                              ? 'bg-emerald-500 text-white shadow-sm'
                              : 'text-slate-500 dark:text-slate-400 hover:bg-slate-200/50 dark:hover:bg-slate-700/50'
                          }`}
                        >
                          {m.icon}
                          {m.label}
                        </button>
                      ))}
                    </div>

                    {/* Activity Search */}
                    <div className="relative flex-1 min-w-[180px]">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                      <input
                        type="text"
                        placeholder={t('actividades.config.search_activities')}
                        value={activitySearch}
                        onChange={e => setActivitySearch(e.target.value)}
                        className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-700 dark:text-slate-200 placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-500/50 outline-none transition-all"
                      />
                    </div>
                  </div>
                </div>

                {/* ── Assigned Activities Section ── */}
                <div className="mb-4">
                  <div className="flex items-center gap-2 mb-3 px-1">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                    <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200">
                      {t('actividades.config.assigned_activities')}
                    </h3>
                    <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 px-2 py-0.5 rounded-full">
                      {assignedProcedures.length}
                    </span>
                  </div>

                  {assignedProcedures.length === 0 ? (
                    <div className="bg-white/60 dark:bg-slate-800/60 backdrop-blur-xl rounded-2xl border border-dashed border-slate-300 dark:border-slate-600 p-6 text-center">
                      <p className="text-sm text-slate-400">{t('actividades.config.no_assigned')}</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <AnimatePresence initial={false}>
                        {assignedProcedures.map(({ positionActivity: pa, procedure: proc }) => {
                          if (!proc) return null;
                          const badge = getShiftTypeBadge(proc.shift_type);
                          const isRemoving = actionLoading === pa.activity_id;
                          return (
                            <motion.div
                              key={pa.id}
                              layout
                              initial={{ opacity: 0, scale: 0.95, y: -8 }}
                              animate={{ opacity: 1, scale: 1, y: 0 }}
                              exit={{ opacity: 0, scale: 0.95, x: -40 }}
                              transition={{ duration: 0.2 }}
                              className="bg-white/70 dark:bg-slate-800/70 backdrop-blur-xl rounded-2xl border border-emerald-200/50 dark:border-emerald-700/30 p-3 sm:p-4 shadow-sm hover:shadow-md transition-shadow"
                            >
                              <div className="flex items-start gap-3">
                                <div className="flex-shrink-0 w-7 h-7 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                                  <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">
                                    {proc.activity}
                                  </p>
                                  <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                                    {proc.start_time && (
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-slate-100 dark:bg-slate-700 text-[10px] font-semibold text-slate-600 dark:text-slate-300">
                                        <Clock className="w-3 h-3" />
                                        {formatTimeBadge(proc.start_time)}
                                      </span>
                                    )}
                                    <span className={`px-2 py-0.5 rounded-lg text-[10px] font-semibold ${badge.bg} ${badge.text}`}>
                                      {badge.emoji} {proc.shift_type}
                                    </span>
                                    <span className="px-2 py-0.5 rounded-lg bg-purple-50 dark:bg-purple-900/20 text-[10px] font-semibold text-purple-600 dark:text-purple-300">
                                      {pa.frequency}
                                    </span>
                                    <span className="px-2 py-0.5 rounded-lg bg-slate-50 dark:bg-slate-700/50 text-[10px] font-medium text-slate-500 dark:text-slate-400">
                                      {pa.shift} · {pa.store_model}
                                    </span>
                                  </div>
                                </div>
                                <button
                                  onClick={() => handleRemoveActivity(pa)}
                                  disabled={!!actionLoading}
                                  className="flex-shrink-0 w-8 h-8 rounded-xl bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/40 flex items-center justify-center text-red-500 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                                  title={t('actividades.config.removing')}
                                >
                                  {isRemoving ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                  ) : (
                                    <Trash2 className="w-4 h-4" />
                                  )}
                                </button>
                              </div>
                            </motion.div>
                          );
                        })}
                      </AnimatePresence>
                    </div>
                  )}
                </div>

                {/* ── Available Activities Section ── */}
                <div>
                  <div className="flex items-center gap-2 mb-3 px-1">
                    <Plus className="w-4 h-4 text-blue-500" />
                    <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200">
                      {t('actividades.config.available_activities')}
                    </h3>
                    <span className="text-xs font-semibold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 px-2 py-0.5 rounded-full">
                      {availableProcedures.length}
                    </span>
                  </div>

                  {availableProcedures.length === 0 ? (
                    <div className="bg-white/60 dark:bg-slate-800/60 backdrop-blur-xl rounded-2xl border border-dashed border-slate-300 dark:border-slate-600 p-6 text-center">
                      <p className="text-sm text-slate-400">{t('actividades.config.no_available')}</p>
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-[50vh] overflow-y-auto scrollbar-hide pr-1">
                      <AnimatePresence initial={false}>
                        {availableProcedures.map(proc => {
                          const badge = getShiftTypeBadge(proc.shift_type);
                          const isAdding = actionLoading === proc.id;
                          return (
                            <motion.div
                              key={proc.id}
                              layout
                              initial={{ opacity: 0, scale: 0.95, y: 8 }}
                              animate={{ opacity: 1, scale: 1, y: 0 }}
                              exit={{ opacity: 0, scale: 0.95, x: 40 }}
                              transition={{ duration: 0.2 }}
                              className="bg-white/50 dark:bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-slate-200/50 dark:border-slate-700/50 p-3 sm:p-4 shadow-sm hover:shadow-md hover:border-blue-200 dark:hover:border-blue-700/50 transition-all"
                            >
                              <div className="flex items-start gap-3">
                                <div className="flex-shrink-0 w-7 h-7 rounded-lg bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center">
                                  <LayoutGrid className="w-4 h-4 text-blue-400" />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-bold text-slate-700 dark:text-slate-200 truncate">
                                    {proc.activity}
                                  </p>
                                  <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                                    {proc.start_time && (
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-slate-100 dark:bg-slate-700 text-[10px] font-semibold text-slate-600 dark:text-slate-300">
                                        <Clock className="w-3 h-3" />
                                        {formatTimeBadge(proc.start_time)}
                                      </span>
                                    )}
                                    <span className={`px-2 py-0.5 rounded-lg text-[10px] font-semibold ${badge.bg} ${badge.text}`}>
                                      {badge.emoji} {proc.shift_type}
                                    </span>
                                    <span className="px-2 py-0.5 rounded-lg bg-purple-50 dark:bg-purple-900/20 text-[10px] font-semibold text-purple-600 dark:text-purple-300">
                                      {proc.frequency}
                                    </span>
                                    {proc.role && (
                                      <span className="px-2 py-0.5 rounded-lg bg-slate-50 dark:bg-slate-700/50 text-[10px] font-medium text-slate-500 dark:text-slate-400">
                                        {proc.role}
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <button
                                  onClick={() => handleAddActivity(proc)}
                                  disabled={!!actionLoading}
                                  className="flex-shrink-0 w-8 h-8 rounded-xl bg-indigo-50 dark:bg-indigo-900/20 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 flex items-center justify-center text-indigo-500 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                                  title={t('actividades.config.adding')}
                                >
                                  {isAdding ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                  ) : (
                                    <Plus className="w-4 h-4" />
                                  )}
                                </button>
                              </div>
                            </motion.div>
                          );
                        })}
                      </AnimatePresence>
                    </div>
                  )}
                </div>
              </motion.div>
            ) : (
              /* ── Empty State ── */
              <motion.div
                key="empty-state"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-center justify-center h-[60vh] bg-white/40 dark:bg-slate-800/40 backdrop-blur-xl rounded-2xl border border-dashed border-slate-300 dark:border-slate-600"
              >
                <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-indigo-100 to-purple-100 dark:from-indigo-900/30 dark:to-purple-900/30 flex items-center justify-center mb-5 shadow-inner">
                  <Settings2 className="w-10 h-10 text-indigo-400 dark:text-indigo-500" />
                </div>
                <h3 className="text-lg font-bold text-slate-600 dark:text-slate-300 mb-2">
                  {t('actividades.config.empty_state_title')}
                </h3>
                <p className="text-sm text-slate-400 dark:text-slate-500 max-w-sm text-center px-4">
                  {t('actividades.config.empty_state_subtitle')}
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
