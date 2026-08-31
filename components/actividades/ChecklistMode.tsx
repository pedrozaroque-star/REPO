'use client'

/**
 * @module ChecklistMode
 * @description Modo pantalla completa de checklist para tableta vertical. Muestra las actividades del turno
 *   actual como un checklist interactivo. El manager/asistente/shift-leader toca cada actividad para marcarla
 *   como completada. Si pasan 30 minutos de la hora programada sin marcar, la card parpadea en rojo.
 * @businessRules
 *   - Cada tienda tiene su propio checklist diario independiente
 *   - El checklist se resetea cada día laboral (6:00 AM)
 *   - Solo manager, asistente y shift leader pueden marcar actividades
 *   - 30 minutos de tolerancia antes de que una actividad parpadee en rojo
 *   - Las actividades con role='ROLES_MODULE' se excluyen
 *   - Auto-scroll a la sección de la hora actual al abrir
 * @dataFlow
 *   - Lee actividades de operating_procedures vía Supabase client
 *   - Lee/escribe completados en checklist_completions vía Supabase client
 * @notes
 *   - Optimizado para tableta en orientación vertical (portrait)
 *   - Touch targets de 60px+ para uso con dedos
 *   - Reloj en vivo de Los Ángeles actualizado cada segundo
 *   - Modo CLARO (light mode) por preferencia del cliente
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X, Check, Clock, AlertTriangle, ChevronDown, Store } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/ProtectedRoute'
import { useLanguage } from '@/lib/i18n'

// ─── Types ───────────────────────────────────────────────────────────────────
interface Procedure {
  id: string
  start_time: string
  duration_minutes: number
  activity: string
  shift_type: string
  frequency: string
  role: string
  store_model?: string
  overrides?: { order_index?: number }
}

interface Completion {
  id: string
  activity_id: string
  completed_at: string
  completed_by_name: string
}

interface StoreInfo {
  id: number
  name: string
  external_id: string
}

interface ChecklistModeProps {
  onClose: () => void
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function getLATime(): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }))
}

function getBusinessDate(): string {
  const la = getLATime()
  if (la.getHours() < 6) {
    la.setDate(la.getDate() - 1)
  }
  return `${la.getFullYear()}-${String(la.getMonth() + 1).padStart(2, '0')}-${String(la.getDate()).padStart(2, '0')}`
}

function getCurrentShift(): string {
  const la = getLATime()
  const hour = la.getHours()
  // Apertura: 6:00 AM – 11:59 AM
  if (hour >= 6 && hour < 12) return 'Apertura'
  // Regular: 12:00 PM – 4:59 PM
  if (hour >= 12 && hour < 17) return 'Regular'
  // Cierre: 5:00 PM – 5:59 AM (turno PM)
  return 'Cierre'
}

function getDayName(): string {
  const la = getLATime()
  if (la.getHours() < 6) la.setDate(la.getDate() - 1)
  const days = ['Domingo', 'Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado']
  return days[la.getDay()]
}

function isFreqMatch(paFrequency: string, dayName: string): boolean {
  if (!paFrequency) return false
  const freqLower = paFrequency.toLowerCase()
  if (freqLower === 'diario') return true
  const dayNameLower = dayName.toLowerCase()
  if (freqLower === dayNameLower) return true
  // Handle multi-day frequencies like 'Jueves y Domingo'
  const dayVariants: Record<string, string[]> = {
    'lunes': ['lunes'],
    'martes': ['martes'],
    'miercoles': ['miercoles', 'miércoles'],
    'jueves': ['jueves'],
    'viernes': ['viernes'],
    'sabado': ['sabado', 'sábado'],
    'domingo': ['domingo'],
  }
  const variants = dayVariants[dayNameLower] || [dayNameLower]
  return variants.some(v => freqLower.includes(v))
}

function formatTime12(timeStr: string): string {
  if (!timeStr) return ''
  const [h, m] = timeStr.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  let h12 = h % 12
  h12 = h12 === 0 ? 12 : h12
  return `${h12}:${String(m || 0).padStart(2, '0')} ${ampm}`
}

/** Returns minutes overdue (negative = not yet due) */
function getMinutesOverdue(startTime: string, toleranceMin: number = 30): number {
  if (!startTime) return -999
  const la = getLATime()
  const [sh, sm] = startTime.split(':').map(Number)
  const targetMinutes = sh * 60 + (sm || 0) + toleranceMin
  const currentMinutes = la.getHours() * 60 + la.getMinutes()
  let adjustedTarget = targetMinutes
  let adjustedCurrent = currentMinutes
  if (sh < 6) adjustedTarget += 24 * 60
  if (la.getHours() < 6) adjustedCurrent += 24 * 60
  return adjustedCurrent - adjustedTarget
}

function getSortValue(timeStr: string): number {
  if (!timeStr) return 0
  const [h, m] = timeStr.split(':').map(Number)
  return h < 6 ? (h + 24) * 60 + (m || 0) : h * 60 + (m || 0)
}

/** Find the closest time group to current LA time */
function findCurrentTimeGroup(groups: { time: string }[]): string | null {
  const la = getLATime()
  const nowMinutes = la.getHours() * 60 + la.getMinutes()
  let closest: { time: string; diff: number } | null = null

  for (const g of groups) {
    if (!g.time) continue
    const [h, m] = g.time.split(':').map(Number)
    let gMinutes = h * 60 + (m || 0)
    // Adjust for business day wrapping
    if (h < 6) gMinutes += 24 * 60
    let adjustedNow = nowMinutes
    if (la.getHours() < 6) adjustedNow += 24 * 60

    const diff = adjustedNow - gMinutes
    // We want the group that is closest to now but <= now (current or most recently passed)
    if (diff >= 0 && (!closest || diff < closest.diff)) {
      closest = { time: g.time, diff }
    }
  }
  return closest?.time || groups[0]?.time || null
}

// ─── Component ───────────────────────────────────────────────────────────────
export default function ChecklistMode({ onClose }: ChecklistModeProps) {
  const { user } = useAuth()
  const { t } = useLanguage()

  // State
  const [stores, setStores] = useState<StoreInfo[]>([])
  const [selectedStoreId, setSelectedStoreId] = useState<string>('')
  const [procedures, setProcedures] = useState<Procedure[]>([])
  const [completions, setCompletions] = useState<Completion[]>([])
  const [shiftFilter, setShiftFilter] = useState<string>(getCurrentShift())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [clock, setClock] = useState(getLATime())
  const [showStoreDropdown, setShowStoreDropdown] = useState(false)
  const [hasScrolled, setHasScrolled] = useState(false)
  const storeDropdownRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const timeGroupRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  // Reactive to date changes across live shifts (e.g. 6:00 AM cutoff)
  const businessDate = useMemo(() => getBusinessDate(), [clock.getHours() === 6 && clock.getMinutes() === 0 ? clock : null])
  const dayName = useMemo(() => getDayName(), [clock.getHours() === 6 && clock.getMinutes() === 0 ? clock : null])

  // ─── Live clock ──────────────────────────────────────────────────────────
  useEffect(() => {
    const interval = setInterval(() => setClock(getLATime()), 1000)
    return () => clearInterval(interval)
  }, [])

  // ─── Close store dropdown on outside click ───────────────────────────────
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (storeDropdownRef.current && !storeDropdownRef.current.contains(e.target as Node)) {
        setShowStoreDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // ─── Fetch stores ────────────────────────────────────────────────────────
  useEffect(() => {
    async function fetchStores() {
      const { data, error } = await supabase.from('stores').select('id, name, external_id').order('name')
      if (error) {
        console.error('Error fetching stores:', error.message)
        setLoading(false)
        return
      }
      if (data) {
        setStores(data as StoreInfo[])
        const userStoreId = user?.store_id
        if (userStoreId && data.find((s: StoreInfo) => String(s.id) === String(userStoreId))) {
          setSelectedStoreId(String(userStoreId))
        } else if (data.length > 0) {
          setSelectedStoreId(String(data[0].id))
        }
      }
    }
    fetchStores()
  }, [user])

  // ─── Derived store info ──────────────────────────────────────────────────
  const selectedStore = useMemo(() => {
    return stores.find(s => String(s.id) === String(selectedStoreId))
  }, [stores, selectedStoreId])

  // ─── Fetch procedures ────────────────────────────────────────────────────
  useEffect(() => {
    async function fetchProcedures() {
      const { data } = await supabase
        .from('operating_procedures')
        .select('id, start_time, duration_minutes, activity, shift_type, frequency, role, store_model, overrides')
      if (data) {
        const filtered = data.filter((p: Procedure) => p.role !== 'ROLES_MODULE')
        setProcedures(filtered)
      }
    }
    fetchProcedures()
  }, [])

  // ─── Fetch completions for today ─────────────────────────────────────────
  const fetchCompletions = useCallback(async () => {
    if (!selectedStore) return
    try {
      const { data, error } = await supabase
        .from('checklist_completions')
        .select('id, activity_id, completed_at, completed_by_name')
        .eq('store_id', selectedStore.external_id)
        .eq('checklist_date', businessDate)
      if (error) {
        console.warn('checklist_completions query error (table may not exist yet):', error.message)
        setCompletions([])
        return
      }
      if (data) setCompletions(data)
    } catch (err) {
      console.warn('Error fetching completions:', err)
      setCompletions([])
    }
  }, [selectedStore, businessDate])

  const fetchProcedures = useCallback(async () => {
    const { data } = await supabase
      .from('operating_procedures')
      .select('id, start_time, duration_minutes, activity, shift_type, frequency, role, description, overrides, store_model, shift')
      .order('start_time', { ascending: true })
    if (data) {
      const filtered = data.filter((p: Procedure) => p.role !== 'ROLES_MODULE')
      setProcedures(filtered)
    }
  }, [])

  useEffect(() => {
    if (selectedStore) {
      setLoading(true)
      fetchCompletions().finally(() => setLoading(false))
    }
  }, [selectedStore, fetchCompletions])

  // ─── Supabase Realtime Live Sync for Tablet Checklist ────────────────────
  useEffect(() => {
    let debounceTimer: NodeJS.Timeout | null = null

    const triggerRefresh = () => {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        fetchProcedures()
        fetchCompletions()
      }, 500)
    }

    const channel = supabase
      .channel('checklist-mode-realtime')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'operating_procedures',
      }, triggerRefresh)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'checklist_completions',
      }, triggerRefresh)
      .subscribe()

    const heartbeat = setInterval(() => {
      fetchProcedures()
      fetchCompletions()
    }, 3 * 60 * 1000)

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      clearInterval(heartbeat)
      supabase.removeChannel(channel)
    }
  }, [fetchProcedures, fetchCompletions])

  // ─── Filter procedures ──────────────────────────────────────────────────
  const filteredProcedures = useMemo(() => {
    return procedures
      .filter(p => {
        if (shiftFilter !== 'Todos' && p.shift_type !== shiftFilter) return false
        if (!isFreqMatch(p.frequency, dayName)) return false
        return true
      })
      .sort((a, b) => {
        const av = getSortValue(a.start_time)
        const bv = getSortValue(b.start_time)
        if (av !== bv) return av - bv
        const ai = a.overrides?.order_index ?? 999
        const bi = b.overrides?.order_index ?? 999
        return ai - bi
      })
  }, [procedures, shiftFilter, dayName])

  // ─── Completion map ──────────────────────────────────────────────────────
  const completionMap = useMemo(() => {
    const map = new Map<string, Completion>()
    completions.forEach(c => map.set(c.activity_id, c))
    return map
  }, [completions])

  const completedCount = useMemo(() => {
    return filteredProcedures.filter(p => completionMap.has(p.id)).length
  }, [filteredProcedures, completionMap])

  const progressPercent = filteredProcedures.length > 0
    ? Math.round((completedCount / filteredProcedures.length) * 100)
    : 0

  // ─── Toggle completion ──────────────────────────────────────────────────
  const toggleCompletion = useCallback(async (activityId: string) => {
    if (!selectedStore || saving) return
    setSaving(activityId)

    const existing = completionMap.get(activityId)

    if (existing) {
      await supabase.from('checklist_completions').delete().eq('id', existing.id)
    } else {
      await supabase.from('checklist_completions').upsert({
        store_id: selectedStore.external_id,
        checklist_date: businessDate,
        shift_type: procedures.find(p => p.id === activityId)?.shift_type || shiftFilter,
        activity_id: activityId,
        completed_at: new Date().toISOString(),
        completed_by: String(user?.id || ''),
        completed_by_name: user?.name || 'Unknown',
      }, { onConflict: 'store_id,checklist_date,shift_type,activity_id' })
    }

    await fetchCompletions()
    setSaving(null)
  }, [selectedStore, saving, completionMap, businessDate, shiftFilter, user, fetchCompletions, procedures])

  // ─── Group by time ───────────────────────────────────────────────────────
  const groupedByTime = useMemo(() => {
    const groups: { time: string; label: string; items: Procedure[] }[] = []
    let currentTime = ''
    filteredProcedures.forEach(p => {
      const t = p.start_time || '00:00:00'
      if (t !== currentTime) {
        currentTime = t
        groups.push({ time: t, label: formatTime12(t), items: [] })
      }
      groups[groups.length - 1].items.push(p)
    })
    return groups
  }, [filteredProcedures])

  // ─── Auto-scroll to current time group ───────────────────────────────────
  useEffect(() => {
    if (!loading && groupedByTime.length > 0 && !hasScrolled) {
      const targetTime = findCurrentTimeGroup(groupedByTime)
      if (targetTime) {
        // Small delay to let DOM render
        setTimeout(() => {
          const el = timeGroupRefs.current.get(targetTime)
          if (el && bodyRef.current) {
            el.scrollIntoView({ behavior: 'smooth', block: 'start' })
            setHasScrolled(true)
          }
        }, 300)
      }
    }
  }, [loading, groupedByTime, hasScrolled])

  // ─── Format clock ────────────────────────────────────────────────────────
  const clockStr = useMemo(() => {
    const h = clock.getHours()
    const m = clock.getMinutes()
    const s = clock.getSeconds()
    const ampm = h >= 12 ? 'PM' : 'AM'
    const h12 = h % 12 || 12
    return `${h12}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')} ${ampm}`
  }, [clock])

  // ─── Shift labels ───────────────────────────────────────────────────────
  const SHIFTS = [
    { key: 'Apertura', label: t('actividades.checklist.shift_apertura'), emoji: '🌅' },
    { key: 'Regular', label: t('actividades.checklist.shift_regular'), emoji: '☀️' },
    { key: 'Cierre', label: t('actividades.checklist.shift_cierre'), emoji: '🌙' },
  ]

  // ─── Render (LIGHT MODE) ─────────────────────────────────────────────────
  const content = (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 99999,
        background: '#f1f5f9',
        display: 'flex', flexDirection: 'column',
        fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
        overflow: 'hidden',
      }}
    >
      {/* ─── HEADER ─────────────────────────────────────────────── */}
      <div style={{
        background: 'linear-gradient(90deg, #ea580c 0%, #f97316 100%)',
        padding: '14px 20px',
        display: 'flex', flexDirection: 'column', gap: '10px',
        boxShadow: '0 4px 20px rgba(234,88,12,0.25)',
      }}>
        {/* Top row: Title + Clock + Close */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontSize: '26px' }}>☑️</span>
            <div>
              <h1 style={{ color: '#fff', fontSize: '18px', fontWeight: 700, margin: 0, lineHeight: 1.2 }}>
                {t('actividades.checklist.title')}
              </h1>
              <p style={{ color: 'rgba(255,255,255,0.85)', fontSize: '12px', margin: 0 }}>
                {selectedStore?.name || '...'} · {dayName} · {businessDate}
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              background: 'rgba(0,0,0,0.2)', borderRadius: '10px', padding: '5px 12px',
              fontFamily: "'JetBrains Mono', 'Courier New', monospace",
              color: '#fff', fontSize: '16px', fontWeight: 600, letterSpacing: '1px',
            }}>
              🕐 {clockStr}
            </div>
            <button
              onClick={onClose}
              style={{
                background: 'rgba(0,0,0,0.2)', border: 'none', borderRadius: '12px',
                width: '40px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', color: '#fff', transition: 'background 0.2s',
              }}
              onMouseOver={e => (e.currentTarget.style.background = 'rgba(0,0,0,0.35)')}
              onMouseOut={e => (e.currentTarget.style.background = 'rgba(0,0,0,0.2)')}
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Store Selector + Shift Tabs */}
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Store Selector */}
          <div ref={storeDropdownRef} style={{ position: 'relative' }}>
            <button
              onClick={() => setShowStoreDropdown(!showStoreDropdown)}
              style={{
                background: 'rgba(0,0,0,0.15)', border: '1px solid rgba(255,255,255,0.25)',
                borderRadius: '10px', padding: '7px 12px', color: '#fff', fontSize: '13px',
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px',
                minWidth: '150px',
              }}
            >
              <Store size={14} />
              <span style={{ flex: 1, textAlign: 'left' }}>{selectedStore?.name || '...'}</span>
              <ChevronDown size={14} />
            </button>
            {showStoreDropdown && (
              <div style={{
                position: 'absolute', top: '100%', left: 0, marginTop: '4px',
                background: '#fff', border: '1px solid #e2e8f0',
                borderRadius: '12px', padding: '4px', zIndex: 10,
                maxHeight: '300px', overflowY: 'auto', minWidth: '200px',
                boxShadow: '0 10px 40px rgba(0,0,0,0.15)',
              }}>
                {stores.map(s => (
                  <button
                    key={s.id}
                    onClick={() => { setSelectedStoreId(String(s.id)); setShowStoreDropdown(false) }}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left',
                      padding: '10px 14px', border: 'none', borderRadius: '8px',
                      background: String(s.id) === selectedStoreId ? '#fff7ed' : 'transparent',
                      color: String(s.id) === selectedStoreId ? '#ea580c' : '#334155',
                      fontSize: '14px', fontWeight: String(s.id) === selectedStoreId ? 600 : 400,
                      cursor: 'pointer',
                    }}
                    onMouseOver={e => { if (String(s.id) !== selectedStoreId) e.currentTarget.style.background = '#f8fafc' }}
                    onMouseOut={e => { if (String(s.id) !== selectedStoreId) e.currentTarget.style.background = 'transparent' }}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Shift Tabs */}
          <div style={{ display: 'flex', gap: '5px' }}>
            {SHIFTS.map(s => (
              <button
                key={s.key}
                onClick={() => { setShiftFilter(s.key); setHasScrolled(false) }}
                style={{
                  padding: '7px 14px', borderRadius: '10px', border: 'none',
                  background: shiftFilter === s.key ? '#fff' : 'rgba(255,255,255,0.2)',
                  color: shiftFilter === s.key ? '#ea580c' : '#fff',
                  fontWeight: 600, fontSize: '13px', cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
              >
                {s.emoji} {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Progress Bar */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
            <span style={{ color: 'rgba(255,255,255,0.95)', fontSize: '12px', fontWeight: 600 }}>
              ✅ {completedCount} {t('actividades.checklist.of')} {filteredProcedures.length} {t('actividades.checklist.completed')}
            </span>
            <span style={{ color: 'rgba(255,255,255,0.95)', fontSize: '12px', fontWeight: 700 }}>
              {progressPercent}%
            </span>
          </div>
          <div style={{
            height: '6px', borderRadius: '99px', background: 'rgba(0,0,0,0.2)', overflow: 'hidden',
          }}>
            <div style={{
              height: '100%', borderRadius: '99px',
              background: progressPercent === 100
                ? 'linear-gradient(90deg, #22c55e, #4ade80)'
                : 'linear-gradient(90deg, #fbbf24, #f59e0b)',
              width: `${progressPercent}%`,
              transition: 'width 0.5s ease',
            }} />
          </div>
        </div>
      </div>

      {/* ─── BODY (LIGHT) ──────────────────────────────────────── */}
      <div
        ref={bodyRef}
        style={{
          flex: 1, overflowY: 'auto', padding: '16px 16px 100px',
          WebkitOverflowScrolling: 'touch',
          background: '#f1f5f9',
        }}
      >
        {loading ? (
          <div style={{ textAlign: 'center', color: '#94a3b8', paddingTop: '60px', fontSize: '16px' }}>
            {t('actividades.checklist.loading')}
          </div>
        ) : filteredProcedures.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#94a3b8', paddingTop: '60px', fontSize: '16px' }}>
            {t('actividades.checklist.no_activities')}
          </div>
        ) : (
          <>
            {progressPercent === 100 && (
              <div style={{
                background: 'linear-gradient(135deg, #dcfce7, #bbf7d0)', borderRadius: '16px',
                padding: '20px', textAlign: 'center', marginBottom: '20px',
                border: '1px solid #86efac',
              }}>
                <span style={{ fontSize: '40px', display: 'block', marginBottom: '6px' }}>🎉</span>
                <p style={{ color: '#166534', fontSize: '18px', fontWeight: 700, margin: 0 }}>
                  {t('actividades.checklist.all_done')}
                </p>
              </div>
            )}
            {renderGroups()}
          </>
        )}
      </div>

      {/* ─── Pulse-red animation (CSS injected) ──────────────── */}
      <style>{`
        @keyframes checklist-pulse-red {
          0%, 100% { 
            background: #fff5f5;
            border-color: #fca5a5;
            box-shadow: 0 0 0 0 rgba(239,68,68,0);
          }
          50% { 
            background: #fef2f2;
            border-color: #ef4444;
            box-shadow: 0 0 16px 2px rgba(239,68,68,0.15);
          }
        }
        .checklist-overdue {
          animation: checklist-pulse-red 1.5s ease-in-out infinite;
        }
        .checklist-card:active {
          transform: scale(0.97);
        }
      `}</style>
    </div>
  )

  function renderGroups() {
    return groupedByTime.map((group, idx) => {
      // Determine if this is the "current" time group
      const currentTimeGroup = findCurrentTimeGroup(groupedByTime)
      const isCurrentGroup = group.time === currentTimeGroup

      return (
        <div
          key={`${group.time}-${idx}`}
          ref={el => { if (el) timeGroupRefs.current.set(group.time, el) }}
          style={{ marginBottom: '20px' }}
        >
          {/* Time separator */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px',
            position: 'sticky', top: 0, zIndex: 5,
            background: 'linear-gradient(180deg, #f1f5f9 0%, #f1f5f9 80%, rgba(241,245,249,0) 100%)',
            paddingTop: '6px', paddingBottom: '10px',
          }}>
            <Clock size={16} style={{ color: isCurrentGroup ? '#ea580c' : '#94a3b8' }} />
            <span style={{
              color: isCurrentGroup ? '#ea580c' : '#64748b',
              fontWeight: 700, fontSize: '16px',
              fontFamily: "'JetBrains Mono', 'Courier New', monospace",
            }}>
              {group.label || t('actividades.checklist.no_time')}
            </span>
            {isCurrentGroup && (
              <span style={{
                fontSize: '10px', fontWeight: 700, color: '#ea580c',
                background: '#fff7ed', border: '1px solid #fed7aa',
                borderRadius: '6px', padding: '2px 8px', textTransform: 'uppercase',
              }}>
                {t('actividades.checklist.now')}
              </span>
            )}
            <div style={{ flex: 1, height: '1px', background: isCurrentGroup ? '#fdba74' : '#e2e8f0' }} />
          </div>

          {/* Activity cards */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {group.items.map(proc => {
              const isCompleted = completionMap.has(proc.id)
              const completion = completionMap.get(proc.id)
              const minutesOverdue = getMinutesOverdue(proc.start_time)
              const isOverdue = !isCompleted && minutesOverdue > 0
              const isSaving = saving === proc.id

              return (
                <button
                  key={proc.id}
                  className={`checklist-card ${isOverdue ? 'checklist-overdue' : ''}`}
                  onClick={() => toggleCompletion(proc.id)}
                  disabled={isSaving}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '12px',
                    width: '100%', textAlign: 'left',
                    padding: '14px 16px',
                    borderRadius: '12px',
                    border: isCompleted
                      ? '2px solid #86efac'
                      : isOverdue
                      ? '2px solid #fca5a5'
                      : '2px solid #e2e8f0',
                    background: isCompleted
                      ? '#f0fdf4'
                      : isOverdue
                      ? undefined // handled by animation
                      : '#fff',
                    cursor: isSaving ? 'wait' : 'pointer',
                    transition: 'all 0.2s',
                    opacity: isSaving ? 0.6 : 1,
                    minHeight: '60px',
                    boxShadow: isCompleted
                      ? 'none'
                      : isOverdue
                      ? 'none'
                      : '0 1px 3px rgba(0,0,0,0.06)',
                  }}
                >
                  {/* Checkbox */}
                  <div style={{
                    width: '40px', height: '40px', borderRadius: '10px', flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: isCompleted
                      ? 'linear-gradient(135deg, #22c55e, #16a34a)'
                      : isOverdue
                      ? '#fef2f2'
                      : '#f8fafc',
                    border: isCompleted
                      ? 'none'
                      : isOverdue
                      ? '2px solid #ef4444'
                      : '2px solid #cbd5e1',
                    transition: 'all 0.3s',
                  }}>
                    {isCompleted ? (
                      <Check size={22} style={{ color: '#fff' }} />
                    ) : isOverdue ? (
                      <AlertTriangle size={18} style={{ color: '#ef4444' }} />
                    ) : null}
                  </div>

                  {/* Text */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{
                      color: isCompleted ? '#a3a3a3' : '#1e293b',
                      fontSize: '14px', fontWeight: 600, margin: 0,
                      textDecoration: isCompleted ? 'line-through' : 'none',
                      lineHeight: 1.3,
                    }}>
                      {proc.activity}
                    </p>

                    {/* Metadata row */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '3px', flexWrap: 'wrap' }}>
                      {proc.duration_minutes > 0 && (
                        <span style={{
                          fontSize: '10px', color: '#94a3b8',
                          background: '#f1f5f9', borderRadius: '5px', padding: '1px 6px',
                        }}>
                          ⏱ {proc.duration_minutes} min
                        </span>
                      )}
                      {isCompleted && completion && (
                        <span style={{
                          fontSize: '10px', color: '#16a34a',
                          background: '#f0fdf4', borderRadius: '5px', padding: '1px 6px',
                        }}>
                          ✓ {new Date(completion.completed_at).toLocaleTimeString('en-US', {
                            hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Los_Angeles',
                          })} {t('actividades.checklist.by')} {completion.completed_by_name}
                        </span>
                      )}
                      {isOverdue && (
                        <span style={{
                          fontSize: '10px', color: '#dc2626', fontWeight: 700,
                          background: '#fef2f2', borderRadius: '5px', padding: '1px 6px',
                          border: '1px solid #fecaca',
                        }}>
                          ⚠ {t('actividades.checklist.overdue')} {Math.round(minutesOverdue)} min
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )
    })
  }

  // Portal to body to escape any parent overflow/z-index
  if (typeof window === 'undefined') return null
  return createPortal(content, document.body)
}
