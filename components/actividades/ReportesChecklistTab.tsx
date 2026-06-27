'use client'

/**
 * @module ReportesChecklistTab
 * @description Pestaña de reportes del checklist de operaciones. Muestra cumplimiento diario
 *   por turno y tienda, con vista de calendario, comparativo entre tiendas, y detalle de
 *   actividades faltantes. Diseño premium con glassmorphism y animaciones.
 * @businessRules
 *   - El día laboral empieza a las 6:00 AM y termina a las 5:59 AM del siguiente día
 *   - Se compara actividades completadas vs total de actividades por turno
 *   - Las actividades con role='ROLES_MODULE' se excluyen del total
 *   - Cada tienda tiene reportes independientes
 *   - Los turnos son: Apertura (6-11:59), Regular (12-16:59), Cierre (17-5:59)
 * @dataFlow
 *   - Lee actividades totales de operating_procedures
 *   - Lee completados de checklist_completions filtrado por fecha/tienda
 *   - Computa porcentajes y métricas derivadas
 * @notes
 *   - Soporta i18n completo (ES/EN) via useLanguage()
 *   - Optimizado para pantalla completa y tableta
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react'
import {
  BarChart3, Calendar, ChevronLeft, ChevronRight, Store, TrendingUp,
  CheckCircle2, AlertCircle, Clock, Award, ArrowUpRight, ArrowDownRight
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useLanguage } from '@/lib/i18n'

// ─── Types ───────────────────────────────────────────────────────────────────
interface StoreInfo {
  id: number
  name: string
  external_id: string
}

interface CompletionRecord {
  store_id: string
  checklist_date: string
  shift_type: string
  activity_id: string
  completed_at: string
  completed_by_name: string
}

interface Procedure {
  id: string
  shift_type: string
  frequency: string
  role: string
}

interface ShiftStats {
  shift: string
  total: number
  completed: number
  percent: number
  missing: string[]
}

interface DayReport {
  date: string
  totalActivities: number
  totalCompleted: number
  percent: number
  shifts: ShiftStats[]
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function getBusinessDate(offset = 0): string {
  const la = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }))
  if (la.getHours() < 6) la.setDate(la.getDate() - 1)
  la.setDate(la.getDate() + offset)
  return `${la.getFullYear()}-${String(la.getMonth() + 1).padStart(2, '0')}-${String(la.getDate()).padStart(2, '0')}`
}

function getDayNameForDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00')
  const days = ['Domingo', 'Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado']
  return days[d.getDay()]
}

function formatDateDisplay(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00')
  const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`
}

function getWeekDates(centerDate: string): string[] {
  const d = new Date(centerDate + 'T12:00:00')
  const dayOfWeek = d.getDay()
  const monday = new Date(d)
  monday.setDate(d.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1))
  const dates: string[] = []
  for (let i = 0; i < 7; i++) {
    const day = new Date(monday)
    day.setDate(monday.getDate() + i)
    dates.push(`${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`)
  }
  return dates
}

function getPercentColor(pct: number): string {
  if (pct >= 90) return '#16a34a'
  if (pct >= 70) return '#ca8a04'
  if (pct >= 50) return '#ea580c'
  return '#dc2626'
}

function getPercentBg(pct: number): string {
  if (pct >= 90) return '#f0fdf4'
  if (pct >= 70) return '#fefce8'
  if (pct >= 50) return '#fff7ed'
  return '#fef2f2'
}

function getPercentEmoji(pct: number): string {
  if (pct >= 90) return '🟢'
  if (pct >= 70) return '🟡'
  if (pct >= 50) return '🟠'
  return '🔴'
}

// ─── Component ───────────────────────────────────────────────────────────────
export default function ReportesChecklistTab() {
  const { t } = useLanguage()

  const [stores, setStores] = useState<StoreInfo[]>([])
  const [selectedStoreId, setSelectedStoreId] = useState<string>('ALL')
  const [procedures, setProcedures] = useState<Procedure[]>([])
  const [completions, setCompletions] = useState<CompletionRecord[]>([])
  const [selectedDate, setSelectedDate] = useState(getBusinessDate())
  const [loading, setLoading] = useState(true)
  const [viewMode, setViewMode] = useState<'day' | 'week'>('day')

  const todayBizDate = useMemo(() => getBusinessDate(), [])
  const weekDates = useMemo(() => getWeekDates(selectedDate), [selectedDate])

  // ─── Fetch stores ──────────────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      const { data } = await supabase.from('stores').select('id, name, external_id').order('name')
      if (data) setStores(data as StoreInfo[])
    }
    load()
  }, [])

  // ─── Fetch procedures ──────────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('operating_procedures')
        .select('id, shift_type, frequency, role')
      if (data) {
        setProcedures(data.filter((p: Procedure) => p.role !== 'ROLES_MODULE'))
      }
    }
    load()
  }, [])

  // ─── Fetch completions for date range ──────────────────────────────────
  const fetchCompletions = useCallback(async () => {
    setLoading(true)
    try {
      const dateRange = viewMode === 'week' ? weekDates : [selectedDate]
      const startDate = dateRange[0]
      const endDate = dateRange[dateRange.length - 1]

      let query = supabase
        .from('checklist_completions')
        .select('store_id, checklist_date, shift_type, activity_id, completed_at, completed_by_name')
        .gte('checklist_date', startDate)
        .lte('checklist_date', endDate)

      if (selectedStoreId !== 'ALL') {
        const store = stores.find(s => String(s.id) === selectedStoreId)
        if (store) query = query.eq('store_id', store.external_id)
      }

      const { data, error } = await query
      if (error) {
        console.warn('Error fetching completions:', error.message)
        setCompletions([])
      } else {
        setCompletions(data || [])
      }
    } catch {
      setCompletions([])
    }
    setLoading(false)
  }, [selectedDate, selectedStoreId, stores, viewMode, weekDates])

  useEffect(() => {
    if (stores.length > 0) fetchCompletions()
  }, [fetchCompletions, stores])

  // ─── Compute report for a specific date + store ────────────────────────
  const computeDayReport = useCallback((date: string, storeExternalId?: string): DayReport => {
    const dayName = getDayNameForDate(date)
    const shifts = ['Apertura', 'Regular', 'Cierre']

    const dayCompletions = completions.filter(c => {
      if (c.checklist_date !== date) return false
      if (storeExternalId && c.store_id !== storeExternalId) return false
      return true
    })

    const completedIds = new Set(dayCompletions.map(c => c.activity_id))

    const shiftStats: ShiftStats[] = shifts.map(shift => {
      const shiftProcs = procedures.filter(p => {
        if (p.shift_type !== shift) return false
        if (p.frequency !== 'Diario' && p.frequency !== dayName) return false
        return true
      })
      const completed = shiftProcs.filter(p => completedIds.has(p.id)).length
      const missing = shiftProcs.filter(p => !completedIds.has(p.id)).map(p => p.id)
      return {
        shift,
        total: shiftProcs.length,
        completed,
        percent: shiftProcs.length > 0 ? Math.round((completed / shiftProcs.length) * 100) : 0,
        missing,
      }
    })

    const totalActivities = shiftStats.reduce((s, ss) => s + ss.total, 0)
    const totalCompleted = shiftStats.reduce((s, ss) => s + ss.completed, 0)

    return {
      date,
      totalActivities,
      totalCompleted,
      percent: totalActivities > 0 ? Math.round((totalCompleted / totalActivities) * 100) : 0,
      shifts: shiftStats,
    }
  }, [procedures, completions])

  // ─── Current report ────────────────────────────────────────────────────
  const selectedStore = useMemo(() => stores.find(s => String(s.id) === selectedStoreId), [stores, selectedStoreId])

  const dayReport = useMemo(() => {
    return computeDayReport(selectedDate, selectedStoreId !== 'ALL' ? selectedStore?.external_id : undefined)
  }, [selectedDate, selectedStoreId, selectedStore, computeDayReport])

  const weekReports = useMemo(() => {
    return weekDates.map(d => computeDayReport(d, selectedStoreId !== 'ALL' ? selectedStore?.external_id : undefined))
  }, [weekDates, selectedStoreId, selectedStore, computeDayReport])

  // ─── All-stores comparison ─────────────────────────────────────────────
  const storeComparison = useMemo(() => {
    if (selectedStoreId !== 'ALL') return []
    return stores.map(store => {
      const report = computeDayReport(selectedDate, store.external_id)
      return { store, ...report }
    }).sort((a, b) => b.percent - a.percent)
  }, [stores, selectedDate, selectedStoreId, computeDayReport])

  // ─── Navigation ────────────────────────────────────────────────────────
  const navigateDate = (offset: number) => {
    const d = new Date(selectedDate + 'T12:00:00')
    d.setDate(d.getDate() + (viewMode === 'week' ? offset * 7 : offset))
    setSelectedDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
  }

  // ─── Shift labels ──────────────────────────────────────────────────────
  const shiftEmoji: Record<string, string> = { Apertura: '🌅', Regular: '☀️', Cierre: '🌙' }
  const shiftLabel: Record<string, string> = {
    Apertura: t('actividades.checklist.shift_apertura'),
    Regular: t('actividades.checklist.shift_regular'),
    Cierre: t('actividades.checklist.shift_cierre'),
  }

  // ─── Render ────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: '20px 16px', maxWidth: '1400px', margin: '0 auto' }}>
      {/* ─── Controls Bar ─────────────────────────────────────── */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center',
        marginBottom: '24px', padding: '16px 20px',
        background: '#fff', borderRadius: '16px',
        border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
      }}>
        {/* View Toggle */}
        <div style={{ display: 'flex', background: '#f1f5f9', borderRadius: '10px', padding: '3px' }}>
          {(['day', 'week'] as const).map(mode => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              style={{
                padding: '6px 16px', borderRadius: '8px', border: 'none', fontSize: '13px',
                fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s',
                background: viewMode === mode ? '#fff' : 'transparent',
                color: viewMode === mode ? '#ea580c' : '#64748b',
                boxShadow: viewMode === mode ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              }}
            >
              {mode === 'day' ? `📅 ${t('actividades.reports.day_view')}` : `📊 ${t('actividades.reports.week_view')}`}
            </button>
          ))}
        </div>

        {/* Date Navigation */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            onClick={() => navigateDate(-1)}
            style={{
              width: '34px', height: '34px', borderRadius: '10px', border: '1px solid #e2e8f0',
              background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <ChevronLeft size={16} />
          </button>
          <button
            onClick={() => setSelectedDate(todayBizDate)}
            style={{
              padding: '6px 14px', borderRadius: '10px', border: '1px solid #e2e8f0',
              background: selectedDate === todayBizDate ? '#fff7ed' : '#fff',
              color: selectedDate === todayBizDate ? '#ea580c' : '#334155',
              fontWeight: 600, fontSize: '13px', cursor: 'pointer',
              minWidth: '160px', textAlign: 'center',
            }}
          >
            <Calendar size={14} style={{ display: 'inline', verticalAlign: '-2px', marginRight: '6px' }} />
            {viewMode === 'day'
              ? `${getDayNameForDate(selectedDate).substring(0, 3)} ${formatDateDisplay(selectedDate)}`
              : `${formatDateDisplay(weekDates[0])} – ${formatDateDisplay(weekDates[6])}`
            }
          </button>
          <button
            onClick={() => navigateDate(1)}
            style={{
              width: '34px', height: '34px', borderRadius: '10px', border: '1px solid #e2e8f0',
              background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <ChevronRight size={16} />
          </button>
        </div>

        {/* Store Selector */}
        <select
          value={selectedStoreId}
          onChange={e => setSelectedStoreId(e.target.value)}
          style={{
            padding: '8px 14px', borderRadius: '10px', border: '1px solid #e2e8f0',
            background: '#fff', color: '#334155', fontSize: '13px', fontWeight: 500,
            cursor: 'pointer', minWidth: '180px',
          }}
        >
          <option value="ALL">🏢 {t('actividades.reports.all_stores')}</option>
          {stores.map(s => (
            <option key={s.id} value={String(s.id)}>{s.name}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', color: '#94a3b8', padding: '60px 0', fontSize: '16px' }}>
          {t('actividades.reports.loading')}
        </div>
      ) : viewMode === 'day' ? (
        /* ═══════════════ DAY VIEW ═══════════════ */
        <>
          {/* ─── Score Card ──────────────────────────── */}
          <div style={{
            background: `linear-gradient(135deg, ${getPercentBg(dayReport.percent)}, #fff)`,
            borderRadius: '20px', padding: '28px 32px',
            border: `2px solid ${getPercentColor(dayReport.percent)}20`,
            marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '28px',
            boxShadow: '0 4px 20px rgba(0,0,0,0.04)',
          }}>
            {/* Circular Progress */}
            <div style={{ position: 'relative', width: '120px', height: '120px', flexShrink: 0 }}>
              <svg width="120" height="120" viewBox="0 0 120 120">
                <circle cx="60" cy="60" r="52" fill="none" stroke="#e2e8f0" strokeWidth="10" />
                <circle
                  cx="60" cy="60" r="52" fill="none"
                  stroke={getPercentColor(dayReport.percent)}
                  strokeWidth="10" strokeLinecap="round"
                  strokeDasharray={`${(dayReport.percent / 100) * 327} 327`}
                  transform="rotate(-90 60 60)"
                  style={{ transition: 'stroke-dasharray 0.8s ease' }}
                />
              </svg>
              <div style={{
                position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
              }}>
                <span style={{
                  fontSize: '32px', fontWeight: 800, color: getPercentColor(dayReport.percent),
                  lineHeight: 1,
                }}>
                  {dayReport.percent}%
                </span>
              </div>
            </div>

            {/* Stats */}
            <div style={{ flex: 1 }}>
              <h2 style={{ fontSize: '22px', fontWeight: 700, color: '#1e293b', margin: '0 0 4px' }}>
                {t('actividades.reports.daily_compliance')}
              </h2>
              <p style={{ fontSize: '14px', color: '#64748b', margin: '0 0 16px' }}>
                {getDayNameForDate(selectedDate)} · {formatDateDisplay(selectedDate)}
                {selectedStore ? ` · ${selectedStore.name}` : ` · ${t('actividades.reports.all_stores')}`}
              </p>
              <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
                <StatPill icon={<CheckCircle2 size={16} />} color="#16a34a"
                  label={t('actividades.reports.completed')} value={String(dayReport.totalCompleted)} />
                <StatPill icon={<AlertCircle size={16} />} color="#dc2626"
                  label={t('actividades.reports.pending')} value={String(dayReport.totalActivities - dayReport.totalCompleted)} />
                <StatPill icon={<BarChart3 size={16} />} color="#6366f1"
                  label={t('actividades.reports.total')} value={String(dayReport.totalActivities)} />
              </div>
            </div>
          </div>

          {/* ─── Shift Breakdown ──────────────────────── */}
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: '16px', marginBottom: '24px',
          }}>
            {dayReport.shifts.map(s => (
              <div key={s.shift} style={{
                background: '#fff', borderRadius: '16px', padding: '20px',
                border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                  <span style={{ fontSize: '16px', fontWeight: 700, color: '#1e293b' }}>
                    {shiftEmoji[s.shift]} {shiftLabel[s.shift]}
                  </span>
                  <span style={{
                    fontSize: '20px', fontWeight: 800, color: getPercentColor(s.percent),
                  }}>
                    {s.percent}%
                  </span>
                </div>
                {/* Progress Bar */}
                <div style={{ height: '8px', borderRadius: '99px', background: '#f1f5f9', overflow: 'hidden', marginBottom: '10px' }}>
                  <div style={{
                    height: '100%', borderRadius: '99px',
                    background: `linear-gradient(90deg, ${getPercentColor(s.percent)}, ${getPercentColor(s.percent)}90)`,
                    width: `${s.percent}%`, transition: 'width 0.5s ease',
                  }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#94a3b8' }}>
                  <span>✅ {s.completed} {t('actividades.reports.completed').toLowerCase()}</span>
                  <span>❌ {s.total - s.completed} {t('actividades.reports.pending').toLowerCase()}</span>
                </div>
              </div>
            ))}
          </div>

          {/* ─── Store Comparison (only when ALL stores selected) ─── */}
          {selectedStoreId === 'ALL' && storeComparison.length > 0 && (
            <div style={{
              background: '#fff', borderRadius: '16px', padding: '24px',
              border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
            }}>
              <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#1e293b', margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <TrendingUp size={18} style={{ color: '#ea580c' }} />
                {t('actividades.reports.store_ranking')}
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {storeComparison.map((sc, idx) => (
                  <div key={sc.store.id} style={{
                    display: 'flex', alignItems: 'center', gap: '12px',
                    padding: '10px 14px', borderRadius: '10px',
                    background: idx === 0 ? '#f0fdf4' : idx < 3 ? '#fefce8' : '#f8fafc',
                    border: idx === 0 ? '1px solid #86efac' : '1px solid #e2e8f0',
                  }}>
                    <span style={{
                      width: '28px', height: '28px', borderRadius: '8px', display: 'flex',
                      alignItems: 'center', justifyContent: 'center', fontSize: '13px', fontWeight: 700,
                      background: idx === 0 ? '#dcfce7' : '#f1f5f9',
                      color: idx === 0 ? '#16a34a' : '#64748b',
                    }}>
                      {idx === 0 ? '🏆' : `#${idx + 1}`}
                    </span>
                    <span style={{ flex: 1, fontSize: '14px', fontWeight: 600, color: '#1e293b' }}>
                      {sc.store.name}
                    </span>
                    <div style={{ width: '120px', height: '6px', borderRadius: '99px', background: '#f1f5f9', overflow: 'hidden' }}>
                      <div style={{
                        height: '100%', borderRadius: '99px',
                        background: getPercentColor(sc.percent),
                        width: `${sc.percent}%`,
                      }} />
                    </div>
                    <span style={{
                      fontSize: '14px', fontWeight: 700, color: getPercentColor(sc.percent),
                      minWidth: '45px', textAlign: 'right',
                    }}>
                      {sc.percent}%
                    </span>
                    <span style={{ fontSize: '11px', color: '#94a3b8' }}>
                      {sc.totalCompleted}/{sc.totalActivities}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        /* ═══════════════ WEEK VIEW ═══════════════ */
        <>
          {/* Week Grid */}
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)',
            gap: '8px', marginBottom: '24px',
          }}>
            {weekReports.map(wr => {
              const isToday = wr.date === todayBizDate
              const isSelected = wr.date === selectedDate
              return (
                <button
                  key={wr.date}
                  onClick={() => { setSelectedDate(wr.date); setViewMode('day') }}
                  style={{
                    background: isSelected ? '#fff7ed' : '#fff',
                    borderRadius: '14px', padding: '14px 10px',
                    border: isToday ? '2px solid #ea580c' : isSelected ? '2px solid #fdba74' : '1px solid #e2e8f0',
                    cursor: 'pointer', textAlign: 'center',
                    boxShadow: isToday ? '0 2px 12px rgba(234,88,12,0.12)' : '0 1px 3px rgba(0,0,0,0.04)',
                    transition: 'all 0.2s',
                  }}
                >
                  <div style={{ fontSize: '11px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', marginBottom: '4px' }}>
                    {getDayNameForDate(wr.date).substring(0, 3)}
                  </div>
                  <div style={{ fontSize: '20px', fontWeight: 700, color: isToday ? '#ea580c' : '#1e293b', marginBottom: '8px' }}>
                    {new Date(wr.date + 'T12:00:00').getDate()}
                  </div>
                  {/* Mini circular progress */}
                  <div style={{ position: 'relative', width: '48px', height: '48px', margin: '0 auto 6px' }}>
                    <svg width="48" height="48" viewBox="0 0 48 48">
                      <circle cx="24" cy="24" r="20" fill="none" stroke="#e2e8f0" strokeWidth="4" />
                      <circle
                        cx="24" cy="24" r="20" fill="none"
                        stroke={getPercentColor(wr.percent)}
                        strokeWidth="4" strokeLinecap="round"
                        strokeDasharray={`${(wr.percent / 100) * 126} 126`}
                        transform="rotate(-90 24 24)"
                      />
                    </svg>
                    <span style={{
                      position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '11px', fontWeight: 700, color: getPercentColor(wr.percent),
                    }}>
                      {wr.percent}%
                    </span>
                  </div>
                  <div style={{ fontSize: '10px', color: '#94a3b8' }}>
                    {wr.totalCompleted}/{wr.totalActivities}
                  </div>
                </button>
              )
            })}
          </div>

          {/* Week Summary Table */}
          <div style={{
            background: '#fff', borderRadius: '16px', overflow: 'hidden',
            border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
          }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ background: '#f8fafc' }}>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 700, color: '#64748b', borderBottom: '1px solid #e2e8f0' }}>
                    {t('actividades.reports.day')}
                  </th>
                  {['Apertura', 'Regular', 'Cierre'].map(s => (
                    <th key={s} style={{ padding: '12px 16px', textAlign: 'center', fontWeight: 700, color: '#64748b', borderBottom: '1px solid #e2e8f0' }}>
                      {shiftEmoji[s]} {shiftLabel[s]}
                    </th>
                  ))}
                  <th style={{ padding: '12px 16px', textAlign: 'center', fontWeight: 700, color: '#64748b', borderBottom: '1px solid #e2e8f0' }}>
                    {t('actividades.reports.total')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {weekReports.map(wr => (
                  <tr key={wr.date} style={{
                    background: wr.date === todayBizDate ? '#fffbeb' : '#fff',
                    borderBottom: '1px solid #f1f5f9',
                  }}>
                    <td style={{ padding: '10px 16px', fontWeight: 600, color: '#1e293b' }}>
                      {getDayNameForDate(wr.date).substring(0, 3)} {new Date(wr.date + 'T12:00:00').getDate()}
                      {wr.date === todayBizDate && <span style={{ marginLeft: '6px', fontSize: '10px', color: '#ea580c', fontWeight: 700 }}>HOY</span>}
                    </td>
                    {wr.shifts.map(s => (
                      <td key={s.shift} style={{ padding: '10px 16px', textAlign: 'center' }}>
                        <span style={{
                          display: 'inline-block', padding: '3px 10px', borderRadius: '8px',
                          fontSize: '12px', fontWeight: 700,
                          color: getPercentColor(s.percent),
                          background: getPercentBg(s.percent),
                        }}>
                          {s.percent}%
                        </span>
                        <div style={{ fontSize: '10px', color: '#94a3b8', marginTop: '2px' }}>
                          {s.completed}/{s.total}
                        </div>
                      </td>
                    ))}
                    <td style={{ padding: '10px 16px', textAlign: 'center' }}>
                      <span style={{
                        fontSize: '14px', fontWeight: 800,
                        color: getPercentColor(wr.percent),
                      }}>
                        {getPercentEmoji(wr.percent)} {wr.percent}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

// ─── Subcomponents ─────────────────────────────────────────────────────────────
function StatPill({ icon, color, label, value }: { icon: React.ReactNode; color: string; label: string; value: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '8px',
      padding: '8px 14px', borderRadius: '10px',
      background: `${color}08`, border: `1px solid ${color}20`,
    }}>
      <span style={{ color }}>{icon}</span>
      <div>
        <div style={{ fontSize: '18px', fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
        <div style={{ fontSize: '10px', color: '#94a3b8', fontWeight: 500 }}>{label}</div>
      </div>
    </div>
  )
}
