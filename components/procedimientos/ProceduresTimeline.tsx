'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Clock, Users, Calendar, Filter, ChevronDown, CheckCircle2, ChevronRight, PlayCircle, Edit2, Save, X } from 'lucide-react';
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

export default function ProceduresTimeline() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'manager';

  const [procedures, setProcedures] = useState<Procedure[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterShift, setFilterShift] = useState<string>('Todos');
  const [filterDay, setFilterDay] = useState<string>('Diario');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<Procedure>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchProcedures();
  }, []);

  const getSortValue = (timeStr: string) => {
    if (!timeStr) return 0;
    const [h, m] = timeStr.split(':').map(Number);
    // El día laboral empieza a las 6 AM
    // Las horas de 00:00 a 05:59 corresponden al final del turno de cierre del "día laboral actual"
    const effectiveHour = h >= 6 ? h : h + 24;
    return effectiveHour * 60 + m;
  };

  const fetchProcedures = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('operating_procedures')
        .select('*');

      if (error) throw error;
      
      const sortedData = (data || []).sort((a, b) => getSortValue(a.start_time) - getSortValue(b.start_time));
      setProcedures(sortedData);
    } catch (error) {
      console.error('Error fetching procedures:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleEditClick = (proc: Procedure, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(proc.id);
    setEditForm(proc);
    // Para que no se cierre si estaba expandido
    if (expandedId !== proc.id) setExpandedId(proc.id);
  };

  const handleCancelEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(null);
    setEditForm({});
  };

  const handleSave = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!editingId) return;

    try {
      setSaving(true);
      const res = await fetch(`/api/procedimientos`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ ...editForm, id: editingId })
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Error al guardar');

      // Update local state
      setProcedures(prev => {
        const newData = prev.map(p => p.id === editingId ? { ...p, ...editForm } : p);
        return newData.sort((a, b) => getSortValue(a.start_time) - getSortValue(b.start_time));
      });
      
      setEditingId(null);
    } catch (err) {
      console.error('Error:', err);
      alert('Error al guardar los cambios');
    } finally {
      setSaving(false);
    }
  };

  const handleChange = (field: keyof Procedure, value: any) => {
    setEditForm(prev => ({ ...prev, [field]: value }));
  };

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

  const formatTimeRange = (timeStr: string, durationMin?: number) => {
    if (!timeStr) return '';
    const [h, m] = timeStr.split(':').map(Number);
    
    const formatSingle = (hours: number, mins: number) => {
        const ampm = (hours % 24) >= 12 ? 'PM' : 'AM';
        let displayHour = hours % 12;
        displayHour = displayHour ? displayHour : 12; 
        const displayMin = mins.toString().padStart(2, '0');
        return `${displayHour}:${displayMin} ${ampm}`;
    }

    const startFormatted = formatSingle(h, m);
    if (!durationMin) return startFormatted;

    let endM = m + durationMin;
    let endH = h + Math.floor(endM / 60);
    endM = endM % 60;
    
    const endFormatted = formatSingle(endH, endM);
    return `${startFormatted} - ${endFormatted}`;
  };

  // Convert HH:mm:ss back to HH:mm for input[type="time"]
  const getShortTime = (timeStr: string) => {
    if (!timeStr) return '';
    const parts = timeStr.split(':');
    return `${parts[0]}:${parts[1]}`;
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-500"></div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-6xl mx-auto p-4 sm:p-6 pb-24">
      
      {/* Header Section */}
      <div className="mb-8 p-6 rounded-3xl bg-white/40 dark:bg-slate-900/40 backdrop-blur-xl border border-white/20 dark:border-slate-800/50 shadow-xl overflow-hidden relative">
        <div className="absolute top-0 right-0 w-64 h-64 bg-orange-500/20 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3"></div>
        <div className="absolute bottom-0 left-0 w-64 h-64 bg-blue-500/20 rounded-full blur-3xl translate-y-1/2 -translate-x-1/3"></div>
        
        <div className="relative z-10">
          <h1 className="text-3xl font-extrabold bg-gradient-to-r from-orange-600 to-red-600 dark:from-orange-400 dark:to-red-400 bg-clip-text text-transparent mb-2">
            Manual de Operaciones
          </h1>
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

      {/* Timeline Section */}
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
                    <div className="h-px flex-1 bg-gradient-to-r from-slate-200 dark:from-slate-700 to-transparent ml-4"></div>
                  </div>
                </div>

                <div className="relative pl-4 sm:pl-12 border-l-2 border-slate-200/60 dark:border-slate-700/60 space-y-6">
                  {shiftProcedures.map((proc, idx) => {
                    const isEditing = editingId === proc.id;

                    return (
                      <motion.div
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: idx * 0.02 }}
                        key={proc.id}
                        className="relative"
                      >
                        <div className={`absolute -left-[21px] sm:-left-[53px] w-4 h-4 rounded-full border-4 border-white dark:border-[#0B1120] bg-gradient-to-br ${shiftColors[proc.shift_type]} shadow-sm z-10 top-6`} />
                        
                        <div 
                          className={`bg-white dark:bg-slate-800/80 rounded-2xl border transition-all duration-300 overflow-hidden ${!isEditing ? 'cursor-pointer' : ''} ${
                            expandedId === proc.id || isEditing
                              ? 'border-orange-500/50 shadow-[0_8px_30px_rgb(249,115,22,0.12)] dark:shadow-[0_8px_30px_rgb(249,115,22,0.05)]' 
                              : 'border-slate-100 dark:border-slate-700/50 shadow-sm hover:shadow-md hover:border-slate-200 dark:hover:border-slate-600'
                          }`}
                          onClick={() => {
                            if (!isEditing) {
                              setExpandedId(expandedId === proc.id ? null : proc.id);
                            }
                          }}
                        >
                          <div className="p-4 sm:p-5 flex flex-col sm:flex-row gap-4">
                            {/* Time Column */}
                            <div className="flex-shrink-0 sm:w-28 flex flex-row sm:flex-col items-center sm:items-start gap-2 sm:gap-1">
                              {isEditing ? (
                                <input 
                                  type="time" 
                                  className="w-full text-sm border border-slate-300 dark:border-slate-600 rounded p-1 dark:bg-slate-700 text-slate-800 dark:text-slate-100"
                                  value={getShortTime(editForm.start_time || '')}
                                  onChange={(e) => handleChange('start_time', e.target.value + ':00')}
                                />
                              ) : (
                                <div className="flex items-center gap-1.5 text-orange-600 dark:text-orange-400 font-bold text-sm sm:text-base whitespace-nowrap">
                                  <Clock className="w-4 h-4 flex-shrink-0" />
                                  {formatTimeRange(proc.start_time, proc.duration_minutes)}
                                </div>
                              )}

                              {isEditing ? (
                                <div className="flex items-center mt-1">
                                  <input 
                                    type="number" 
                                    placeholder="Min"
                                    className="w-16 text-xs border border-slate-300 dark:border-slate-600 rounded p-1 dark:bg-slate-700 text-slate-800 dark:text-slate-100"
                                    value={editForm.duration_minutes || ''}
                                    onChange={(e) => handleChange('duration_minutes', e.target.value)}
                                  />
                                </div>
                              ) : (
                                proc.duration_minutes && (
                                  <div className="text-xs font-medium text-slate-500 bg-slate-100 dark:bg-slate-700/50 px-2.5 py-1 rounded-full whitespace-nowrap">
                                    {proc.duration_minutes} min
                                  </div>
                                )
                              )}
                            </div>
                            
                            {/* Content Column */}
                            <div className="flex-1 min-w-0">
                              <div className="flex justify-between items-start gap-4">
                                {isEditing ? (
                                  <input 
                                    type="text"
                                    className="w-full font-bold text-base sm:text-lg border border-slate-300 dark:border-slate-600 rounded p-1.5 dark:bg-slate-700 text-slate-800 dark:text-slate-100"
                                    value={editForm.activity || ''}
                                    onChange={(e) => handleChange('activity', e.target.value)}
                                    autoFocus
                                  />
                                ) : (
                                  <h3 className="text-base sm:text-lg font-bold text-slate-800 dark:text-slate-100 leading-tight">
                                    {proc.activity}
                                  </h3>
                                )}
                                
                                <div className="flex items-center gap-2">
                                  {isAdmin && !isEditing && (
                                    <button 
                                      onClick={(e) => handleEditClick(proc, e)}
                                      className="text-slate-400 hover:text-blue-500 transition-colors p-1"
                                      title="Editar"
                                    >
                                      <Edit2 className="w-4 h-4" />
                                    </button>
                                  )}
                                  {isEditing && (
                                    <div className="flex gap-1">
                                      <button 
                                        onClick={handleSave}
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
    </div>
  );
}
