'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Clock, Users, Calendar, Filter, ChevronDown, ChevronRight, PlayCircle, Edit2, Save, X, Plus, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/components/ProtectedRoute';

interface Procedure {
  id: string;
  start_time: string;
  duration_minutes: number;
  activity: string;
  shift_type: string;
  frequency: string;
  role: string;
  description: string;
}

const EMPTY_FORM: Partial<Procedure> = {
  start_time: '08:00:00',
  duration_minutes: undefined,
  activity: '',
  shift_type: 'Apertura',
  frequency: 'Diario',
  role: '',
  description: ''
};

export default function ProceduresTimeline() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'manager';

  const [procedures, setProcedures] = useState<Procedure[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterShift, setFilterShift] = useState<string>('Todos');
  const [filterDay, setFilterDay] = useState<string>('Diario');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<Procedure>>({});
  const [saving, setSaving] = useState(false);

  // Create state
  const [isCreating, setIsCreating] = useState(false);
  const [createForm, setCreateForm] = useState<Partial<Procedure>>(EMPTY_FORM);

  // Delete confirmation
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    fetchProcedures();
  }, []);

  // ═══════════════════════════════════════
  // Sorting: día laboral 6 AM → 5:59 AM
  // ═══════════════════════════════════════
  const getSortValue = (timeStr: string) => {
    if (!timeStr) return 0;
    const [h, m] = timeStr.split(':').map(Number);
    const effectiveHour = h >= 6 ? h : h + 24;
    return effectiveHour * 60 + m;
  };

  const sortProcedures = (data: Procedure[]) => {
    return [...data].sort((a, b) => getSortValue(a.start_time) - getSortValue(b.start_time));
  };

  // ═══════════════════════════════════════
  // FETCH
  // ═══════════════════════════════════════
  const fetchProcedures = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('operating_procedures')
        .select('*');

      if (error) throw error;
      setProcedures(sortProcedures(data || []));
    } catch (error) {
      console.error('Error fetching procedures:', error);
    } finally {
      setLoading(false);
    }
  };

  // ═══════════════════════════════════════
  // EDIT
  // ═══════════════════════════════════════
  const handleEditClick = (proc: Procedure, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(proc.id);
    setEditForm(proc);
    if (expandedId !== proc.id) setExpandedId(proc.id);
  };

  const handleCancelEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(null);
    setEditForm({});
  };

  const handleSaveEdit = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!editingId) return;

    try {
      setSaving(true);
      const res = await fetch('/api/procedimientos', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...editForm, id: editingId })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Error al guardar');

      // Actualizar y re-ordenar automáticamente
      setProcedures(prev => sortProcedures(
        prev.map(p => p.id === editingId ? { ...p, ...editForm } as Procedure : p)
      ));
      setEditingId(null);
      setEditForm({});
    } catch (err: any) {
      console.error('Error:', err);
      alert('Error al guardar: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  // ═══════════════════════════════════════
  // CREATE
  // ═══════════════════════════════════════
  const handleCreate = async () => {
    if (!createForm.activity?.trim()) {
      alert('La actividad es obligatoria');
      return;
    }

    try {
      setSaving(true);
      const res = await fetch('/api/procedimientos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createForm)
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Error al crear');

      // Agregar y re-ordenar automáticamente
      setProcedures(prev => sortProcedures([...prev, json.data as Procedure]));
      setIsCreating(false);
      setCreateForm(EMPTY_FORM);
    } catch (err: any) {
      console.error('Error:', err);
      alert('Error al crear: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  // ═══════════════════════════════════════
  // DELETE
  // ═══════════════════════════════════════
  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      setSaving(true);
      const res = await fetch(`/api/procedimientos?id=${id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Error al eliminar');

      setProcedures(prev => prev.filter(p => p.id !== id));
      setDeletingId(null);
      if (expandedId === id) setExpandedId(null);
    } catch (err: any) {
      console.error('Error:', err);
      alert('Error al eliminar: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleChange = (field: keyof Procedure, value: any) => {
    setEditForm(prev => ({ ...prev, [field]: value }));
  };

  const handleCreateChange = (field: keyof Procedure, value: any) => {
    setCreateForm(prev => ({ ...prev, [field]: value }));
  };

  // ═══════════════════════════════════════
  // Colores y configuración visual
  // ═══════════════════════════════════════
  const shiftColors: Record<string, string> = {
    'Apertura': 'from-amber-400 to-orange-500',
    'Regular': 'from-blue-400 to-cyan-500',
    'Cierre': 'from-indigo-600 to-purple-800'
  };
  
  const shiftIcons: Record<string, string> = {
    'Apertura': '🌅',
    'Regular': '☀️',
    'Cierre': '🌙'
  };

  const filteredProcedures = procedures.filter(p => {
    if (filterShift !== 'Todos' && p.shift_type !== filterShift) return false;
    if (filterDay === 'Diario') {
      return p.frequency === 'Diario';
    } else {
      return p.frequency.toUpperCase() === 'DIARIO' || p.frequency.toUpperCase().includes(filterDay.toUpperCase());
    }
  });

  const groupedProcedures = filteredProcedures.reduce((acc, proc) => {
    if (!acc[proc.shift_type]) acc[proc.shift_type] = [];
    acc[proc.shift_type].push(proc);
    return acc;
  }, {} as Record<string, Procedure[]>);

  // ═══════════════════════════════════════
  // Formateo de tiempo
  // ═══════════════════════════════════════
  const formatSingleTime = (hours: number, mins: number) => {
    const ampm = (hours % 24) >= 12 ? 'PM' : 'AM';
    let displayHour = hours % 12;
    displayHour = displayHour ? displayHour : 12; 
    const displayMin = mins.toString().padStart(2, '0');
    return `${displayHour}:${displayMin} ${ampm}`;
  };

  const getTimeData = (timeStr: string, durationMin?: number) => {
    if (!timeStr) return { start: '', end: '' };
    const [h, m] = timeStr.split(':').map(Number);
    const start = formatSingleTime(h, m);
    if (!durationMin) return { start, end: '' };
    let endM = m + durationMin;
    let endH = h + Math.floor(endM / 60);
    endM = endM % 60;
    return { start, end: formatSingleTime(endH, endM) };
  };

  const getShortTime = (timeStr: string) => {
    if (!timeStr) return '';
    const parts = timeStr.split(':');
    return `${parts[0]}:${parts[1]}`;
  };

  // ═══════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════
  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-500"></div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-6xl mx-auto p-4 sm:p-6 pb-24">
      
      {/* ══════ Header Section ══════ */}
      <div className="mb-8 p-6 rounded-3xl bg-white/40 dark:bg-slate-900/40 backdrop-blur-xl border border-white/20 dark:border-slate-800/50 shadow-xl overflow-hidden relative">
        <div className="absolute top-0 right-0 w-64 h-64 bg-orange-500/20 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3"></div>
        <div className="absolute bottom-0 left-0 w-64 h-64 bg-blue-500/20 rounded-full blur-3xl translate-y-1/2 -translate-x-1/3"></div>
        
        <div className="relative z-10">
          <div className="mb-2">
            <h1 className="text-3xl font-extrabold bg-gradient-to-r from-orange-600 to-red-600 dark:from-orange-400 dark:to-red-400 bg-clip-text text-transparent">
              Manual de Operaciones
            </h1>
          </div>
          <p className="text-slate-600 dark:text-slate-400 mb-6 max-w-2xl text-sm sm:text-base">
            Procedimientos estandarizados para asegurar la excelencia operativa en Tacos Gavilan. Selecciona tu turno y día para ver tus responsabilidades.
          </p>

          <div className="flex flex-wrap gap-4 items-center">
            <div className="flex items-center gap-2 bg-white/60 dark:bg-slate-800/60 rounded-2xl p-1.5 shadow-inner border border-slate-200/50 dark:border-slate-700/50">
              <Filter className="w-4 h-4 text-slate-500 ml-2" />
              {['Todos', 'Apertura', 'Regular', 'Cierre'].map(shift => (
                <button
                  key={shift}
                  onClick={() => setFilterShift(shift)}
                  className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all duration-300 ${
                    filterShift === shift 
                      ? 'bg-gradient-to-r from-orange-500 to-red-500 text-white shadow-md' 
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700/50'
                  }`}
                >
                  {shift}
                </button>
              ))}
            </div>

            <select
              value={filterDay}
              onChange={(e) => setFilterDay(e.target.value)}
              className="bg-white/60 dark:bg-slate-800/60 border border-slate-200/50 dark:border-slate-700/50 text-slate-700 dark:text-slate-200 text-sm rounded-2xl focus:ring-orange-500 focus:border-orange-500 block p-3 shadow-inner font-medium outline-none cursor-pointer hover:bg-white/80 transition-colors"
            >
              <option value="Diario">Todos los Días (Diario)</option>
              <option value="Lunes">Lunes</option>
              <option value="Martes">Martes</option>
              <option value="Miercoles">Miércoles</option>
              <option value="Jueves">Jueves</option>
              <option value="Viernes">Viernes</option>
              <option value="Sabado">Sábado</option>
              <option value="Domingo">Domingo</option>
            </select>
          </div>
        </div>
      </div>

      {/* ══════ CREATE FORM (Modal-like card at top) ══════ */}
      <AnimatePresence>
        {isCreating && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="mb-8 p-6 rounded-2xl bg-green-50 dark:bg-green-900/20 border-2 border-green-300 dark:border-green-700 shadow-lg"
          >
            <h3 className="text-lg font-bold text-green-800 dark:text-green-300 mb-4 flex items-center gap-2">
              <Plus className="w-5 h-5" />
              Nueva Actividad
            </h3>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
              {/* Actividad */}
              <div className="sm:col-span-2 lg:col-span-3">
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Actividad *</label>
                <input
                  type="text"
                  placeholder="Ej: Lavar freidoras"
                  className="w-full border border-slate-300 dark:border-slate-600 rounded-xl p-2.5 text-sm dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-green-500 outline-none"
                  value={createForm.activity || ''}
                  onChange={(e) => handleCreateChange('activity', e.target.value)}
                  autoFocus
                />
              </div>
              
              {/* Hora de inicio */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Hora de Inicio</label>
                <input
                  type="time"
                  className="w-full border border-slate-300 dark:border-slate-600 rounded-xl p-2.5 text-sm dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-green-500 outline-none"
                  value={getShortTime(createForm.start_time || '08:00:00')}
                  onChange={(e) => handleCreateChange('start_time', e.target.value + ':00')}
                />
              </div>

              {/* Duración */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Duración (minutos)</label>
                <input
                  type="number"
                  placeholder="Ej: 15"
                  className="w-full border border-slate-300 dark:border-slate-600 rounded-xl p-2.5 text-sm dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-green-500 outline-none"
                  value={createForm.duration_minutes || ''}
                  onChange={(e) => handleCreateChange('duration_minutes', e.target.value)}
                />
              </div>

              {/* Categoría */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Categoría *</label>
                <select
                  className="w-full border border-slate-300 dark:border-slate-600 rounded-xl p-2.5 text-sm dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-green-500 outline-none"
                  value={createForm.shift_type || 'Apertura'}
                  onChange={(e) => handleCreateChange('shift_type', e.target.value)}
                >
                  <option value="Apertura">🌅 Apertura</option>
                  <option value="Regular">☀️ Regular</option>
                  <option value="Cierre">🌙 Cierre</option>
                </select>
              </div>

              {/* Frecuencia */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Frecuencia *</label>
                <select
                  className="w-full border border-slate-300 dark:border-slate-600 rounded-xl p-2.5 text-sm dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-green-500 outline-none"
                  value={createForm.frequency || 'Diario'}
                  onChange={(e) => handleCreateChange('frequency', e.target.value)}
                >
                  <option value="Diario">Diario</option>
                  <option value="Lunes">Lunes</option>
                  <option value="Martes">Martes</option>
                  <option value="Miercoles">Miércoles</option>
                  <option value="Jueves">Jueves</option>
                  <option value="Viernes">Viernes</option>
                  <option value="Sabado">Sábado</option>
                  <option value="Domingo">Domingo</option>
                  <option value="Jueves y Domingo">Jueves y Domingo</option>
                </select>
              </div>

              {/* Responsable */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Responsable</label>
                <input
                  type="text"
                  placeholder="Ej: Asistente/SL"
                  className="w-full border border-slate-300 dark:border-slate-600 rounded-xl p-2.5 text-sm dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-green-500 outline-none"
                  value={createForm.role || ''}
                  onChange={(e) => handleCreateChange('role', e.target.value)}
                />
              </div>

              {/* Descripción */}
              <div className="sm:col-span-2 lg:col-span-3">
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Descripción / Instrucciones</label>
                <textarea
                  placeholder="Detalles de cómo realizar esta actividad..."
                  className="w-full border border-slate-300 dark:border-slate-600 rounded-xl p-2.5 text-sm dark:bg-slate-800 text-slate-800 dark:text-slate-100 min-h-[60px] focus:ring-2 focus:ring-green-500 outline-none"
                  value={createForm.description || ''}
                  onChange={(e) => handleCreateChange('description', e.target.value)}
                />
              </div>
            </div>

            <div className="flex justify-end gap-3">
              <button
                onClick={() => { setIsCreating(false); setCreateForm(EMPTY_FORM); }}
                disabled={saving}
                className="px-5 py-2.5 text-sm font-semibold text-slate-600 dark:text-slate-300 bg-slate-200 dark:bg-slate-700 rounded-xl hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleCreate}
                disabled={saving || !createForm.activity?.trim()}
                className="px-5 py-2.5 text-sm font-semibold text-white bg-gradient-to-r from-green-500 to-emerald-600 rounded-xl shadow-md hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? 'Guardando...' : 'Crear Actividad'}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ══════ Timeline Section ══════ */}
      <div className="space-y-12">
        {Object.keys(groupedProcedures).length === 0 ? (
          <div className="text-center py-20 text-slate-500">
            No hay procedimientos que coincidan con los filtros seleccionados.
          </div>
        ) : (
          ['Apertura', 'Regular', 'Cierre'].map(shiftKey => {
            const shiftProcedures = groupedProcedures[shiftKey];
            if (!shiftProcedures || shiftProcedures.length === 0) return null;

            return (
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                key={shiftKey} 
                className="relative"
              >
                {/* Shift Header */}
                <div className="sticky top-0 z-20 pt-4 pb-4 bg-slate-50/90 dark:bg-[#0B1120]/90 backdrop-blur-xl mb-6">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-2xl bg-gradient-to-br ${shiftColors[shiftKey]} flex items-center justify-center text-xl shadow-lg`}>
                      {shiftIcons[shiftKey]}
                    </div>
                    <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100">{shiftKey}</h2>
                    <span className="text-sm text-slate-400 font-medium">({shiftProcedures.length})</span>
                    <div className="h-px flex-1 bg-gradient-to-r from-slate-200 dark:from-slate-700 to-transparent ml-4"></div>
                  </div>
                </div>

                <div className="relative pl-4 sm:pl-12 border-l-2 border-slate-200/60 dark:border-slate-700/60 space-y-6">
                  {shiftProcedures.map((proc, idx) => {
                    const isEditing = editingId === proc.id;
                    const isDeleting = deletingId === proc.id;
                    const timeData = getTimeData(proc.start_time, proc.duration_minutes);

                    return (
                      <motion.div
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: idx * 0.02 }}
                        key={proc.id}
                        layout
                        className="relative"
                      >
                        <div className={`absolute -left-[21px] sm:-left-[53px] w-4 h-4 rounded-full border-4 border-white dark:border-[#0B1120] bg-gradient-to-br ${shiftColors[proc.shift_type]} shadow-sm z-10 top-6`} />
                        
                        <div 
                          className={`bg-white dark:bg-slate-800/80 rounded-2xl border transition-all duration-300 overflow-hidden ${!isEditing ? 'cursor-pointer' : ''} ${
                            expandedId === proc.id || isEditing
                              ? 'border-orange-500/50 shadow-[0_8px_30px_rgb(249,115,22,0.12)] dark:shadow-[0_8px_30px_rgb(249,115,22,0.05)]' 
                              : isDeleting
                                ? 'border-red-400 shadow-[0_8px_30px_rgb(239,68,68,0.15)]'
                                : 'border-slate-100 dark:border-slate-700/50 shadow-sm hover:shadow-md hover:border-slate-200 dark:hover:border-slate-600'
                          }`}
                          onClick={() => {
                            if (!isEditing && !isDeleting) {
                              setExpandedId(expandedId === proc.id ? null : proc.id);
                            }
                          }}
                        >
                          {/* Delete confirmation bar */}
                          <AnimatePresence>
                            {isDeleting && (
                              <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                className="bg-red-50 dark:bg-red-900/30 border-b border-red-200 dark:border-red-800 px-4 py-3 flex items-center justify-between gap-4"
                              >
                                <span className="text-sm font-medium text-red-700 dark:text-red-300">
                                  ¿Seguro que deseas eliminar esta actividad?
                                </span>
                                <div className="flex gap-2">
                                  <button
                                    onClick={(e) => handleDelete(proc.id, e)}
                                    disabled={saving}
                                    className="px-3 py-1.5 text-xs font-bold text-white bg-red-500 rounded-lg hover:bg-red-600 transition-colors"
                                  >
                                    {saving ? '...' : 'Sí, Eliminar'}
                                  </button>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); setDeletingId(null); }}
                                    className="px-3 py-1.5 text-xs font-bold text-slate-600 dark:text-slate-300 bg-slate-200 dark:bg-slate-700 rounded-lg hover:bg-slate-300 transition-colors"
                                  >
                                    No
                                  </button>
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>

                          <div className="p-4 sm:p-5 flex flex-col sm:flex-row gap-4">
                            {/* Time Column */}
                            <div className="flex-shrink-0 sm:w-32 flex flex-row sm:flex-col items-center sm:items-start gap-2 sm:gap-0.5">
                              {isEditing ? (
                                <>
                                  <input 
                                    type="time" 
                                    className="w-full text-sm border border-slate-300 dark:border-slate-600 rounded p-1 dark:bg-slate-700 text-slate-800 dark:text-slate-100"
                                    value={getShortTime(editForm.start_time || '')}
                                    onChange={(e) => handleChange('start_time', e.target.value + ':00')}
                                  />
                                  <div className="flex items-center mt-1 gap-1">
                                    <input 
                                      type="number" 
                                      placeholder="Min"
                                      className="w-16 text-xs border border-slate-300 dark:border-slate-600 rounded p-1 dark:bg-slate-700 text-slate-800 dark:text-slate-100"
                                      value={editForm.duration_minutes || ''}
                                      onChange={(e) => handleChange('duration_minutes', e.target.value)}
                                    />
                                    <span className="text-xs text-slate-400">min</span>
                                  </div>
                                </>
                              ) : (
                                <>
                                  <div className="flex items-center gap-1.5 text-orange-600 dark:text-orange-400 font-bold text-base">
                                    <Clock className="w-4 h-4 flex-shrink-0" />
                                    {timeData.start}
                                  </div>
                                  {timeData.end && (
                                    <div className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                                      <ChevronRight className="w-3 h-3" />
                                      {timeData.end}
                                    </div>
                                  )}
                                  {proc.duration_minutes && (
                                    <div className="text-[10px] font-medium text-slate-400 bg-slate-100 dark:bg-slate-700/50 px-2 py-0.5 rounded-full whitespace-nowrap mt-1">
                                      {proc.duration_minutes} min
                                    </div>
                                  )}
                                </>
                              )}
                            </div>
                            
                            {/* Content Column */}
                            <div className="flex-1 min-w-0">
                              <div className="flex justify-between items-start gap-2">
                                {isEditing ? (
                                  <input 
                                    type="text"
                                    className="w-full font-bold text-base border border-slate-300 dark:border-slate-600 rounded p-1.5 dark:bg-slate-700 text-slate-800 dark:text-slate-100"
                                    value={editForm.activity || ''}
                                    onChange={(e) => handleChange('activity', e.target.value)}
                                    autoFocus
                                  />
                                ) : (
                                  <h3 className="text-base sm:text-lg font-bold text-slate-800 dark:text-slate-100 leading-tight">
                                    {proc.activity}
                                  </h3>
                                )}
                                
                                <div className="flex items-center gap-1 flex-shrink-0">
                                  {isAdmin && !isEditing && (
                                    <>
                                      <button 
                                        onClick={(e) => handleEditClick(proc, e)}
                                        className="text-slate-400 hover:text-blue-500 transition-colors p-1"
                                        title="Editar"
                                      >
                                        <Edit2 className="w-4 h-4" />
                                      </button>
                                      <button 
                                        onClick={(e) => { e.stopPropagation(); setDeletingId(isDeleting ? null : proc.id); }}
                                        className="text-slate-400 hover:text-red-500 transition-colors p-1"
                                        title="Eliminar"
                                      >
                                        <Trash2 className="w-4 h-4" />
                                      </button>
                                    </>
                                  )}
                                  {isEditing && (
                                    <div className="flex gap-1">
                                      <button 
                                        onClick={handleSaveEdit}
                                        disabled={saving}
                                        className="text-green-500 hover:bg-green-50 dark:hover:bg-green-900/20 p-1.5 rounded transition-colors"
                                        title="Guardar"
                                      >
                                        <Save className="w-4 h-4" />
                                      </button>
                                      <button 
                                        onClick={handleCancelEdit}
                                        disabled={saving}
                                        className="text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 p-1.5 rounded transition-colors"
                                        title="Cancelar"
                                      >
                                        <X className="w-4 h-4" />
                                      </button>
                                    </div>
                                  )}
                                  {!isEditing && (
                                    <ChevronDown className={`w-5 h-5 text-slate-400 transition-transform duration-300 flex-shrink-0 ${expandedId === proc.id ? 'rotate-180 text-orange-500' : ''}`} />
                                  )}
                                </div>
                              </div>
                              
                              <div className="flex flex-wrap gap-3 mt-3 items-center">
                                {isEditing && (
                                  <select
                                    className="text-xs border border-slate-300 dark:border-slate-600 rounded p-1 w-24 dark:bg-slate-700 text-slate-800 dark:text-slate-100"
                                    value={editForm.shift_type || ''}
                                    onChange={(e) => handleChange('shift_type', e.target.value)}
                                  >
                                    <option value="Apertura">Apertura</option>
                                    <option value="Regular">Regular</option>
                                    <option value="Cierre">Cierre</option>
                                  </select>
                                )}
                                {isEditing ? (
                                  <input 
                                    type="text"
                                    placeholder="Rol (ej. Asistente)"
                                    className="text-xs border border-slate-300 dark:border-slate-600 rounded p-1 w-32 dark:bg-slate-700 text-slate-800 dark:text-slate-100"
                                    value={editForm.role || ''}
                                    onChange={(e) => handleChange('role', e.target.value)}
                                  />
                                ) : (
                                  proc.role && (
                                    <div className="flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 px-2.5 py-1 rounded-full border border-blue-100 dark:border-blue-800/30">
                                      <Users className="w-3 h-3" />
                                      {proc.role}
                                    </div>
                                  )
                                )}

                                {isEditing ? (
                                  <input 
                                    type="text"
                                    placeholder="Frecuencia"
                                    className="text-xs border border-slate-300 dark:border-slate-600 rounded p-1 w-32 dark:bg-slate-700 text-slate-800 dark:text-slate-100"
                                    value={editForm.frequency || ''}
                                    onChange={(e) => handleChange('frequency', e.target.value)}
                                  />
                                ) : (
                                  proc.frequency !== 'Diario' && (
                                    <div className="flex items-center gap-1 text-xs font-medium text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/20 px-2.5 py-1 rounded-full border border-purple-100 dark:border-purple-800/30">
                                      <Calendar className="w-3 h-3" />
                                      {proc.frequency}
                                    </div>
                                  )
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Expandable Details */}
                          <AnimatePresence>
                            {(expandedId === proc.id || isEditing) && (
                              <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.2 }}
                              >
                                <div className="px-5 pb-5 pt-0">
                                  <div className="h-px w-full bg-slate-100 dark:bg-slate-700/50 mb-4"></div>
                                  <div className="bg-orange-50/50 dark:bg-orange-900/10 rounded-xl p-4 border border-orange-100/50 dark:border-orange-500/10">
                                    <h4 className="text-xs font-bold uppercase tracking-wider text-orange-600/80 dark:text-orange-500/80 mb-2 flex items-center gap-1.5">
                                      <PlayCircle className="w-3.5 h-3.5" />
                                      Detalles del Procedimiento
                                    </h4>
                                    
                                    {isEditing ? (
                                      <textarea 
                                        className="w-full text-sm border border-slate-300 dark:border-slate-600 rounded p-2 dark:bg-slate-700 text-slate-800 dark:text-slate-100 min-h-[80px]"
                                        placeholder="Descripción o instrucciones..."
                                        value={editForm.description || ''}
                                        onChange={(e) => handleChange('description', e.target.value)}
                                      />
                                    ) : (
                                      <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                                        {proc.description || 'Sin descripción adicional.'}
                                      </p>
                                    )}
                                  </div>
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              </motion.div>
            );
          })
        )}
      </div>

      {/* ══════ Floating Action Button ══════ */}
      {isAdmin && !isCreating && (
        <button
          onClick={() => { setIsCreating(true); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
          className="fixed bottom-24 right-6 z-50 flex items-center gap-2 px-5 py-3.5 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-2xl text-sm font-bold shadow-[0_8px_30px_rgb(34,197,94,0.35)] hover:shadow-[0_8px_40px_rgb(34,197,94,0.5)] transition-all hover:scale-105 active:scale-95"
        >
          <Plus className="w-5 h-5" />
          Nueva Actividad
        </button>
      )}
    </div>
  );
}
