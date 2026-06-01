'use client';

import { useEffect, useState, useMemo, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useLanguage } from '@/lib/i18n';
import { Loader2, Printer, ArrowLeft, Clock, Users, Calendar, Building2, Car } from 'lucide-react';

interface Procedure {
  id: string;
  start_time: string;
  duration_minutes: number;
  activity: string;
  shift_type: string;
  frequency: string;
  role: string;
  description: string;
  overrides?: any;
  store_model?: string;
  shift?: string;
}

function PrintProceduresContent() {
  const { t } = useLanguage();
  const searchParams = useSearchParams();

  // Load filter parameters
  const filterShift = searchParams.get('shift') || 'Todos';
  const filterDay = searchParams.get('day') || 'Diario';
  const filterModel = searchParams.get('model') || 'Todos';

  const [procedures, setProcedures] = useState<Procedure[]>([]);
  const [loading, setLoading] = useState(true);

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
    return [...data].sort((a, b) => {
      const timeDiff = getSortValue(a.start_time) - getSortValue(b.start_time);
      if (timeDiff !== 0) return timeDiff;
      const aOrder = a.overrides?.order_index || 0;
      const bOrder = b.overrides?.order_index || 0;
      return aOrder - bOrder;
    });
  };

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        const { data, error } = await supabase
          .from('operating_procedures')
          .select('*');

        if (error) throw error;

        const filteredData = (data || []).filter(p => p.role !== 'ROLES_MODULE');
        setProcedures(sortProcedures(filteredData));
      } catch (error) {
        console.error('Error loading procedures:', error);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // ═══════════════════════════════════════
  // Apply exactly the same filters
  // ═══════════════════════════════════════
  const filteredProcedures = useMemo(() => {
    return procedures.filter(p => {
      // 1. Shift Category filter
      if (filterShift !== 'Todos' && p.shift_type !== filterShift) return false;

      // 2. Store Model filter
      if (filterModel !== 'Todos') {
        const model = p.store_model || 'AMBOS';
        if (model !== 'AMBOS' && model !== filterModel) return false;
      }

      // 3. Day filter
      if (filterDay === 'Diario') return true;
      const freq = (p.frequency || '').toUpperCase();
      if (freq === 'DIARIO') return true;
      return freq.includes(filterDay.toUpperCase());
    });
  }, [procedures, filterShift, filterDay, filterModel]);

  // Group by shift_type
  const groupedProcedures = useMemo(() => {
    return filteredProcedures.reduce((acc, proc) => {
      if (!acc[proc.shift_type]) acc[proc.shift_type] = [];
      acc[proc.shift_type].push(proc);
      return acc;
    }, {} as Record<string, Procedure[]>);
  }, [filteredProcedures]);

  // Time formatter helpers
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

  const shiftLabels: Record<string, string> = {
    'Apertura': t('procedures.filters.opening') || '🌅 Apertura',
    'Regular': t('procedures.filters.regular') || '☀️ Regular',
    'Cierre': t('procedures.filters.closing') || '🌙 Cierre',
  };

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col justify-center items-center bg-white text-slate-800 p-8">
        <Loader2 className="animate-spin h-10 w-10 text-orange-500 mb-3" />
        <p className="font-semibold text-sm">Generando vista de impresión...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white text-black p-6 print:p-0 font-sans">
      {/* ══════ Actions Bar (Hidden on Print) ══════ */}
      <div className="print:hidden flex justify-between items-center mb-6 pb-4 border-b border-slate-200">
        <button
          onClick={() => window.close()}
          className="flex items-center gap-2 px-4 py-2 border border-slate-300 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-50 transition-colors shadow-sm"
        >
          <ArrowLeft size={14} /> Volver / Cerrar
        </button>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-2 px-5 py-2.5 bg-black text-white hover:bg-slate-800 rounded-xl text-xs font-bold transition-all shadow-md"
        >
          <Printer size={15} /> Imprimir Ahora
        </button>
      </div>

      {/* ══════ Print Header ══════ */}
      <div className="border-b-4 border-black pb-4 mb-6">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-2xl font-black uppercase tracking-tight">
              Tacos El Gavilán
            </h1>
            <p className="text-md font-bold text-slate-700 uppercase tracking-widest mt-0.5">
              Manual de Operaciones — Procedimientos
            </p>
          </div>
          <div className="text-right text-xs text-slate-500 font-medium">
            <div>Fecha: {new Date().toLocaleDateString('es-US', { dateStyle: 'long' })}</div>
            <div>Tienda: Piloto Slauson</div>
          </div>
        </div>

        {/* Filter status badges in Print View */}
        <div className="mt-4 flex flex-wrap gap-2 text-xs font-bold uppercase text-slate-600 print:text-black">
          <span className="bg-slate-100 px-3 py-1 rounded border border-slate-200">
            Categoría: {filterShift === 'Todos' ? 'TODAS' : filterShift.toUpperCase()}
          </span>
          <span className="bg-slate-100 px-3 py-1 rounded border border-slate-200">
            Día: {filterDay === 'Diario' ? 'DIARIO' : filterDay.toUpperCase()}
          </span>
          <span className="bg-slate-100 px-3 py-1 rounded border border-slate-200">
            Modelo: {filterModel === 'Todos' ? 'TODOS' : filterModel}
          </span>
        </div>
      </div>

      {/* ══════ Print Empty State ══════ */}
      {filteredProcedures.length === 0 ? (
        <div className="text-center py-20 text-slate-500 font-medium border border-dashed border-slate-300 rounded-2xl">
          No hay procedimientos que coincidan con los filtros seleccionados.
        </div>
      ) : (
        /* ══════ Table Lists ══════ */
        <div className="space-y-8">
          {['Apertura', 'Regular', 'Cierre'].map(shiftKey => {
            const shiftProcedures = groupedProcedures[shiftKey];
            if (!shiftProcedures || shiftProcedures.length === 0) return null;

            return (
              <div key={shiftKey} className="break-inside-avoid">
                <h2 className="text-lg font-black uppercase tracking-wide border-b-2 border-black pb-1 mb-3">
                  {shiftLabels[shiftKey] || shiftKey} ({shiftProcedures.length})
                </h2>
                
                <table className="w-full text-xs border-collapse border border-slate-400">
                  <thead>
                    <tr className="bg-slate-100 text-black font-extrabold border-b border-slate-400">
                      <th className="py-2 px-2 text-left border-r border-slate-300 w-[14%]">Hora</th>
                      <th className="py-2 px-2 text-left border-r border-slate-300 w-[45%]">Actividad / Descripción</th>
                      <th className="py-2 px-2 text-left border-r border-slate-300 w-[15%]">Responsable</th>
                      <th className="py-2 px-2 text-center border-r border-slate-300 w-[10%]">Turno</th>
                      <th className="py-2 px-2 text-center border-r border-slate-300 w-[10%]">Frecuencia</th>
                      <th className="py-2 px-2 text-center w-[6%]">Firma</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shiftProcedures.map((proc, idx) => {
                      const timeData = getTimeData(proc.start_time, proc.duration_minutes);
                      const timeStr = timeData.end ? `${timeData.start} - ${timeData.end}` : timeData.start;

                      return (
                        <tr key={proc.id} className={`border-b border-slate-300 align-top ${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}`}>
                          {/* Time */}
                          <td className="py-2 px-2 font-bold border-r border-slate-300 text-slate-900">
                            {timeStr || 'Flexible'}
                            {proc.duration_minutes && (
                              <div className="text-[10px] font-medium text-slate-500">
                                ({proc.duration_minutes} min)
                              </div>
                            )}
                          </td>
                          
                          {/* Activity & Description */}
                          <td className="py-2 px-2 border-r border-slate-300">
                            <div className="font-extrabold text-[12px] text-black">
                              {proc.activity}
                            </div>
                            {proc.description && (
                              <div className="text-[10px] text-slate-600 font-medium leading-tight mt-1 whitespace-pre-wrap">
                                {proc.description}
                              </div>
                            )}
                          </td>
                          
                          {/* Responsible */}
                          <td className="py-2 px-2 border-r border-slate-300 font-bold text-slate-800">
                            {proc.role || 'Todo el Equipo'}
                          </td>

                          {/* Shift (AM / PM / Ambos) */}
                          <td className="py-2 px-2 text-center border-r border-slate-300 font-semibold text-slate-800">
                            {proc.shift === 'AM' ? '🌅 AM' : proc.shift === 'PM' ? '🌙 PM' : '🔄 Ambos'}
                          </td>

                          {/* Frequency */}
                          <td className="py-2 px-2 text-center border-r border-slate-300 font-semibold text-slate-800">
                            {proc.frequency}
                          </td>

                          {/* Checkbox / Sign-off */}
                          <td className="py-2 px-2 text-center align-middle">
                            <div className="w-4 h-4 border-2 border-slate-500 rounded mx-auto"></div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      )}

      {/* ══════ Print Styling ══════ */}
      <style jsx global>{`
        @media print {
          @page { size: portrait; margin: 0.4in; }
          body { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; background: white !important; color: black !important; }
          .break-inside-avoid { break-inside: avoid; page-break-inside: avoid; }
          nav, header, .no-print { display: none !important; }
        }
      `}</style>
    </div>
  );
}

export default function PrintProceduresPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-slate-500 font-semibold">Cargando vista de impresión...</div>}>
      <PrintProceduresContent />
    </Suspense>
  );
}
