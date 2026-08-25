'use client'

/**
 * @module MilesIQPage
 * @description Master dashboard and operational module for MilesIQ supervisor mileage tracking and HR payroll dispatching.
 * @businessRules
 * - Supervisores can log personal auto drives, track business mileage, parking, and tolls, and calculate reimbursement totals.
 * - Rate per mile defaults to $0.760/mi (IRS standard reimbursement rate).
 * - Dispatches payroll summaries directly to HR via email using active logged-in session profile identity (user.email & user.name).
 * - Maintains a dynamic recurrent recipient email list for 1-click HR dispatching.
 * - Admins can review, approve, reject, mark as paid, and configure distance matrices & rates.
 * @dataFlow
 * - Client (React) <-> REST API (/api/miles/*) <-> Supabase DB tables.
 * @notes 100% bilingual i18n support using useLanguage().
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Car, Plus, MapPin, Calendar, DollarSign, Send, CheckCircle2,
  Clock, AlertCircle, Download, RefreshCw, Settings, Search,
  Filter, RotateCw, Trash2, Edit3, ShieldCheck, Mail, Users, FileSpreadsheet, Check,
  Navigation, Sparkles, RotateCcw
} from 'lucide-react'
import ProtectedRoute, { useAuth } from '@/components/ProtectedRoute'
import SurpriseLoader from '@/components/SurpriseLoader'
import { useLanguage } from '@/lib/i18n'
import TripModal from '@/components/miles/TripModal'
import QuickDriveModal from '@/components/miles/QuickDriveModal'
import DateRangeFilter from '@/components/sales/DateRangeFilter'
import { getCaliforniaBusinessDate, getCaliforniaDate, getCaliforniaTime } from '@/lib/business-date'
import { CANONICAL_STORE_COORDINATES, haversineDistanceMiles, normalizeStoreName } from '@/lib/store-coordinates'

interface TripRecord {
  id: string
  supervisor_id: string
  supervisor_name: string
  supervisor_email: string
  trip_date: string
  start_time?: string
  end_time?: string
  origin_type?: 'store' | 'custom'
  origin_name: string
  destination_type?: 'store' | 'custom'
  destination_name: string
  is_round_trip: boolean
  purpose: 'Business' | 'Personal' | 'Commute'
  purpose_notes?: string
  odometer_start?: number
  odometer_end?: number
  distance_miles: number
  rate_per_mile: number
  mileage_value: number
  parking_amount: number
  tolls_amount: number
  total_reimbursement: number
  status: 'draft' | 'pending' | 'approved' | 'submitted_hr' | 'paid' | 'rejected'
  hr_submission_id?: string
  hr_submitted_at?: string
  approved_by?: string
  approved_at?: string
  rejection_reason?: string
  created_at: string
  updated_at?: string
}

interface RecurrentEmail {
  id: string
  email: string
  label?: string
  use_count: number
}

interface StoreDistance {
  id: string
  origin_name: string
  destination_name: string
  distance_miles: number
  notes?: string
}

export default function MilesIQPage() {
  return (
    <ProtectedRoute allowedRoles={['admin', 'supervisor']}>
      <MilesIQContent />
    </ProtectedRoute>
  )
}

function MilesIQContent() {
  const { user } = useAuth()
  const { t, language } = useLanguage()

  const currentUser = useMemo(() => ({
    id: String(user?.id || '00000000-0000-0000-0000-000000000000'),
    name: user?.name || 'Supervisor',
    email: user?.email || 'supervisor@tacosgavilan.com'
  }), [user])

  const isAdmin = user?.role === 'admin'

  const [activeTab, setActiveTab] = useState<'trips' | 'hr_dispatch' | 'history' | 'settings'>('trips')
  const [loading, setLoading] = useState<boolean>(true)
  const [trips, setTrips] = useState<TripRecord[]>([])
  const [recurrentEmails, setRecurrentEmails] = useState<RecurrentEmail[]>([])
  const [distances, setDistances] = useState<StoreDistance[]>([])
  const [currentRate, setCurrentRate] = useState<number>(0.76)
  const [editingRate, setEditingRate] = useState<string>('0.76')

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [supervisorFilter, setSupervisorFilter] = useState<string>('all')
  const [searchTerm, setSearchTerm] = useState<string>('')
  const [period, setPeriod] = useState<string>('month')
  const [startDate, setStartDate] = useState<string>(() => {
    const today = getCaliforniaBusinessDate()
    return `${today.slice(0, 7)}-01`
  })
  const [endDate, setEndDate] = useState<string>(() => {
    return getCaliforniaBusinessDate()
  })
  const [dateRange, setDateRange] = useState<{ start: string; end: string }>(() => {
    const today = getCaliforniaBusinessDate()
    const firstDay = `${today.slice(0, 7)}-01`
    return { start: firstDay, end: today }
  })

  // HR Dispatch state
  const [selectedRecipientEmail, setSelectedRecipientEmail] = useState<string>('roque@tacosgavilan.com')
  const [customEmailInput, setCustomEmailInput] = useState<string>('')
  const [sendingHr, setSendingHr] = useState<boolean>(false)
  const [syncingInspections, setSyncingInspections] = useState<boolean>(false)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'warning' } | null>(null)

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false)
  const [isQuickDriveOpen, setIsQuickDriveOpen] = useState<boolean>(false)
  const [editingTrip, setEditingTrip] = useState<TripRecord | null>(null)

  // Distance matrix edit state
  const [newOrigin, setNewOrigin] = useState<string>('')
  const [newDest, setNewDest] = useState<string>('')
  const [newDistMiles, setNewDistMiles] = useState<string>('')

  const showToast = (message: string, type: 'success' | 'error' | 'warning') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 4500)
  }

  // 1-click Gap Resolver (Registers the omitted leg for that specific supervisor and date)
  const handleCreateGapTrip = async (gap: {
    origin: string
    dest: string
    supId: string
    supName: string
    supEmail: string
    date: string
    startTime?: string
    distance: number
    amount: number
  }) => {
    try {
      const res = await fetch('/api/miles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          supervisor_id: gap.supId || currentUser.id,
          supervisor_name: gap.supName || currentUser.name,
          supervisor_email: gap.supEmail || currentUser.email,
          trip_date: gap.date,
          start_time: gap.startTime,
          origin_name: gap.origin,
          destination_name: gap.dest,
          distance_miles: gap.distance,
          rate_per_mile: currentRate,
          purpose: 'Business',
          purpose_notes: `Ruta intermedia detectada (${gap.origin.replace('Tacos Gavilan ', '')} → ${gap.dest.replace('Tacos Gavilan ', '')})`,
          is_round_trip: false,
          parking_amount: 0,
          tolls_amount: 0,
          status: 'pending'
        })
      })
      const data = await res.json()
      if (data.success) {
        showToast(t('miles.gap_trip_added'), 'success')
        fetchInitialData()
      } else {
        showToast(data.error || t('miles.error_save'), 'error')
      }
    } catch (err: any) {
      showToast(err.message || t('miles.error_connection'), 'error')
    }
  }

  // Sync trips from supervisor's quality inspections of the day
  const handleSyncInspections = async () => {
    setSyncingInspections(true)
    try {
      const res = await fetch('/api/miles/sync-inspections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: dateRange.end || getCaliforniaBusinessDate(),
          supervisor_name: !isAdmin ? currentUser.name : (supervisorFilter !== 'all' ? supervisorFilter : undefined),
          supervisor_id: !isAdmin ? currentUser.id : undefined
        })
      })
      const data = await res.json()
      if (data.success) {
        showToast(data.message || t('miles.sync_inspections_success'), 'success')
        fetchInitialData()
      } else {
        showToast(data.error || t('miles.sync_inspections_error'), 'error')
      }
    } catch (err: any) {
      showToast(err.message || t('miles.error_connection'), 'error')
    } finally {
      setSyncingInspections(false)
    }
  }

  // Open modal in create mode
  const handleOpenNewTripModal = () => {
    setEditingTrip(null)
    setIsModalOpen(true)
  }

  // Open modal in edit mode
  const handleOpenEditModal = (trip: TripRecord) => {
    if (trip.status !== 'pending' && !isAdmin) {
      showToast(t('miles.cannot_edit_submitted'), 'warning')
      return
    }
    setEditingTrip(trip)
    setIsModalOpen(true)
  }

  // Dynamic Lists from Database
  const [storesList, setStoresList] = useState<{ id: string; name: string }[]>([])
  const [supervisorsList, setSupervisorsList] = useState<{ id: string; name: string; email: string }[]>([])

  // Submissions Log state
  const [submissions, setSubmissions] = useState<any[]>([])

  // Safety: non-admins are restricted to the Drive Log tab
  useEffect(() => {
    if (!isAdmin && activeTab !== 'trips') {
      setActiveTab('trips')
    }
  }, [isAdmin, activeTab])

  // Load initial data
  useEffect(() => {
    fetchInitialData()
  }, [])

  const fetchInitialData = async () => {
    try {
      setLoading(true)

      // 1. Fetch Stores from Stores Module (/tiendas)
      try {
        const resStores = await fetch('/api/stores')
        const jsonStores = await resStores.json()
        if (Array.isArray(jsonStores)) {
          const formattedStores = jsonStores.map((s: any) => ({
            id: String(s.id),
            name: s.name.startsWith('Tacos Gavilan') ? s.name : `Tacos Gavilan ${s.name}`
          }))
          setStoresList(formattedStores)
        }
      } catch (errStore) {
        console.warn('Error fetching stores:', errStore)
      }

      // 2. Fetch Supervisors from Users Module (/usuarios)
      try {
        const resSups = await fetch('/api/miles/supervisors')
        const jsonSups = await resSups.json()
        if (jsonSups.success && Array.isArray(jsonSups.supervisors)) {
          setSupervisorsList(jsonSups.supervisors)
        }
      } catch (errSup) {
        console.warn('Error fetching supervisors:', errSup)
      }

      // 3. Fetch Trips
      const resTrips = await fetch('/api/miles')
      const jsonTrips = await resTrips.json()
      if (jsonTrips.success) {
        setTrips(jsonTrips.trips || [])
      }

      // 4. Fetch Recurrent Emails
      const resEmails = await fetch('/api/miles/recurrent-emails')
      const jsonEmails = await resEmails.json()
      if (jsonEmails.success && jsonEmails.emails?.length > 0) {
        setRecurrentEmails(jsonEmails.emails)
        setSelectedRecipientEmail(jsonEmails.emails[0].email)
      }

      // 5. Fetch Settings & Distance Matrix
      const resSettings = await fetch('/api/miles/settings')
      const jsonSettings = await resSettings.json()
      if (jsonSettings.success) {
        setCurrentRate(jsonSettings.rate_per_mile || 0.76)
        setEditingRate(String(jsonSettings.rate_per_mile || 0.76))
        setDistances(jsonSettings.distances || [])
      }

      // 6. Fetch Submissions Log
      try {
        const resSubs = await fetch('/api/miles/submissions')
        const jsonSubs = await resSubs.json()
        if (jsonSubs.success) {
          setSubmissions(jsonSubs.submissions || [])
        }
      } catch (errSubs) {
        console.warn('Error fetching submissions:', errSubs)
      }
    } catch (err) {
      console.error('Error loading MilesIQ data:', err)
    } finally {
      setLoading(false)
    }
  }

  // Handle trip creation or update from modal
  const handleSaveTrip = async (tripData: any) => {
    try {
      const isEdit = Boolean(tripData.id)
      const url = isEdit ? `/api/miles/${tripData.id}` : '/api/miles'
      const method = isEdit ? 'PUT' : 'POST'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tripData)
      })
      const json = await res.json()
      if (json.success) {
        showToast(
          isEdit ? t('miles.trip_updated') : t('miles.trip_saved'),
          'success'
        )
        setEditingTrip(null)
        fetchInitialData()
      } else {
        showToast(json.error || t('miles.error_save'), 'error')
      }
    } catch (err: any) {
      showToast(err.message || t('miles.error_connection'), 'error')
    }
  }

  // Delete trip
  const handleDeleteTrip = async (id: string) => {
    if (!confirm(t('miles.confirm_delete'))) return
    try {
      const res = await fetch(`/api/miles/${id}`, { method: 'DELETE' })
      const json = await res.json()
      if (json.success) {
        showToast(t('miles.trip_deleted'), 'warning')
        setTrips(prev => prev.filter(t => t.id !== id))
      }
    } catch (err: any) {
      showToast(err.message, 'error')
    }
  }

  // Update trip status
  const handleUpdateStatus = async (id: string, newStatus: string) => {
    try {
      const res = await fetch(`/api/miles/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      })
      const json = await res.json()
      if (json.success) {
        showToast(`${t('miles.status_updated')}: ${newStatus}`, 'success')
        fetchInitialData()
      }
    } catch (err: any) {
      showToast(err.message, 'error')
    }
  }

  // Dispatch batch report to HR
  const handleSendToHr = async () => {
    const emailToUse = customEmailInput.trim() || selectedRecipientEmail
    if (!emailToUse || !emailToUse.includes('@')) {
      showToast(t('miles.valid_email_required'), 'warning')
      return
    }

    try {
      setSendingHr(true)
      const res = await fetch('/api/miles/send-hr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sender_id: currentUser.id,
          sender_name: currentUser.name,
          sender_email: currentUser.email,
          recipient_email: emailToUse,
          period_start: dateRange.start,
          period_end: dateRange.end
        })
      })

      const json = await res.json()
      if (json.success) {
        showToast(
            `${t('miles.report_sent')} ${emailToUse}`,
          'success'
        )
        setCustomEmailInput('')
        fetchInitialData()
      } else {
        showToast(json.error || t('miles.error_send_hr'), 'error')
      }
    } catch (err: any) {
      showToast(err.message || t('miles.error_send_email'), 'error')
    } finally {
      setSendingHr(false)
    }
  }

  // Save mileage rate update
  const handleSaveRate = async () => {
    const val = parseFloat(editingRate)
    if (isNaN(val) || val <= 0) return

    try {
      const res = await fetch('/api/miles/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_rate',
          rate_per_mile: val,
          updated_by: currentUser.id
        })
      })
      const json = await res.json()
      if (json.success) {
        setCurrentRate(val)
        showToast(`${t('miles.rate_updated')}: $${val.toFixed(3)}/mi`, 'success')
      }
    } catch (err: any) {
      showToast(err.message, 'error')
    }
  }

  const [isPopulatingMatrix, setIsPopulatingMatrix] = useState<boolean>(false)

  // Auto-populate entire distance matrix using Map Traffic Evasion Model
  const handleAutoPopulateMatrix = async () => {
    if (!confirm(t('miles.confirm_generate'))) return

    try {
      setIsPopulatingMatrix(true)
      const res = await fetch('/api/miles/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'auto_populate_matrix' })
      })
      const json = await res.json()
      if (json.success) {
        if (json.distances && json.distances.length > 0) {
          setDistances(json.distances)
        }
        showToast(json.message || t('miles.matrix_updated'), 'success')
        fetchInitialData()
      } else {
        showToast(json.error || t('miles.error_matrix'), 'error')
      }
    } catch (err: any) {
      showToast(err.message || t('miles.error_auto_calc'), 'error')
    } finally {
      setIsPopulatingMatrix(false)
    }
  }

  // Save new store distance pair
  const handleSaveDistancePair = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newOrigin || !newDest || !newDistMiles) return

    try {
      const res = await fetch('/api/miles/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'upsert_distance',
          origin_name: newOrigin.trim(),
          destination_name: newDest.trim(),
          distance_miles: parseFloat(newDistMiles)
        })
      })
      const json = await res.json()
      if (json.success) {
        showToast(t('miles.distance_saved'), 'success')
        setNewOrigin('')
        setNewDest('')
        setNewDistMiles('')
        fetchInitialData()
      }
    } catch (err: any) {
      showToast(err.message, 'error')
    }
  }

  // Export CSV
  const handleExportCsv = () => {
    const url = `/api/miles/export?start_date=${dateRange.start}&end_date=${dateRange.end}&status=${statusFilter}`
    window.open(url, '_blank')
  }

  // Helper to check if a trip belongs to the current user
  const isOwnTrip = useCallback((t: TripRecord) => {
    if (t.supervisor_id === currentUser.id) return true
    if (t.supervisor_email && currentUser.email && t.supervisor_email.toLowerCase() === currentUser.email.toLowerCase()) return true
    if (t.supervisor_name && currentUser.name && t.supervisor_name.toLowerCase() === currentUser.name.toLowerCase()) return true
    return false
  }, [currentUser])

  // Return Trip Handler (creates a new trip inverting origin and destination)
  const handleReturnTrip = (trip: TripRecord) => {
    setEditingTrip({
      id: '',
      supervisor_id: trip.supervisor_id,
      supervisor_name: trip.supervisor_name,
      supervisor_email: trip.supervisor_email,
      trip_date: getCaliforniaBusinessDate(),
      start_time: getCaliforniaTime(),
      origin_type: trip.destination_type || 'store',
      origin_name: trip.destination_name,
      destination_type: trip.origin_type || 'store',
      destination_name: trip.origin_name,
      is_round_trip: false,
      purpose: trip.purpose || 'Business',
      purpose_notes: `Retorno de ${trip.destination_name} a ${trip.origin_name}`,
      distance_miles: trip.distance_miles,
      rate_per_mile: currentRate,
      mileage_value: parseFloat((trip.distance_miles * currentRate).toFixed(2)),
      parking_amount: 0,
      tolls_amount: 0,
      total_reimbursement: parseFloat((trip.distance_miles * currentRate).toFixed(2)),
      status: 'pending',
      created_at: new Date().toISOString()
    })
    setIsModalOpen(true)
  }

  // Filtered trips list (dynamically filtered by Supervisor, Status, Date Range, and Search Term)
  const filteredTrips = useMemo(() => {
    return trips.filter(t => {
      if (!isAdmin && !isOwnTrip(t)) return false
      if (supervisorFilter !== 'all' && t.supervisor_id !== supervisorFilter && t.supervisor_name !== supervisorFilter) return false
      if (statusFilter !== 'all' && t.status !== statusFilter) return false
      if (startDate && t.trip_date < startDate) return false
      if (endDate && t.trip_date > endDate) return false
      if (searchTerm) {
        const term = searchTerm.toLowerCase()
        const matchName = (t.supervisor_name || '').toLowerCase().includes(term)
        const matchOrig = (t.origin_name || '').toLowerCase().includes(term)
        const matchDest = (t.destination_name || '').toLowerCase().includes(term)
        const matchNotes = (t.purpose_notes || '').toLowerCase().includes(term)
        if (!matchName && !matchOrig && !matchDest && !matchNotes) return false
      }
      return true
    })
  }, [trips, statusFilter, supervisorFilter, startDate, endDate, searchTerm, isAdmin, currentUser])

  // Summary Metrics (dynamically computed from active filtered trips)
  const metrics = useMemo(() => {
    const totalMiles = filteredTrips.reduce((s, t) => s + (Number(t.distance_miles) || 0), 0)
    const totalReimbursement = filteredTrips.reduce((s, t) => {
      const m = Number(t.distance_miles) || 0
      const r = Number(t.rate_per_mile) || currentRate
      const p = Number(t.parking_amount) || 0
      const to = Number(t.tolls_amount) || 0
      return s + (m * r) + p + to
    }, 0)
    const pendingCount = filteredTrips.filter(t => t.status === 'pending').length
    const hrCount = filteredTrips.filter(t => t.status === 'submitted_hr' || t.status === 'paid').length

    return {
      totalTrips: filteredTrips.length,
      totalMiles,
      totalReimbursement,
      pendingCount,
      hrCount
    }
  }, [filteredTrips, currentRate])

  // Summaries per supervisor for HR dispatch tab (Filtered by selected date range)
  const supervisorSummaries = useMemo(() => {
    const map: Record<string, {
      id: string
      name: string
      email: string
      tripsCount: number
      totalMiles: number
      totalParking: number
      totalTolls: number
      totalAmount: number
    }> = {}

    // Filter trips by active payroll date range
    const targetTrips = trips.filter(t => {
      if (dateRange.start && t.trip_date < dateRange.start) return false
      if (dateRange.end && t.trip_date > dateRange.end) return false
      return true
    })

    targetTrips.forEach(t => {
      const key = t.supervisor_id || t.supervisor_name
      if (!map[key]) {
        map[key] = {
          id: key,
          name: t.supervisor_name,
          email: t.supervisor_email,
          tripsCount: 0,
          totalMiles: 0,
          totalParking: 0,
          totalTolls: 0,
          totalAmount: 0
        }
      }

      const m = Number(t.distance_miles) || 0
      const r = Number(t.rate_per_mile) || currentRate
      const p = Number(t.parking_amount) || 0
      const to = Number(t.tolls_amount) || 0
      const tot = (m * r) + p + to

      map[key].tripsCount += 1
      map[key].totalMiles += m
      map[key].totalParking += p
      map[key].totalTolls += to
      map[key].totalAmount += tot
    })

    return Object.values(map)
  }, [trips, dateRange, currentRate])

  // Intelligent Route Gap Detector (Grouped by Supervisor and Date with Exact Canonical Distances)
  const detectedRouteGapsGrouped = useMemo(() => {
    // Converts 12h AM/PM strings (e.g. "09:30 AM", "02:15 PM") or timestamps into 0-1439 minutes of the day
    const parseTimeToMinutes = (timeStr?: string, createdAt?: string): number => {
      if (timeStr && timeStr.trim()) {
        const match = timeStr.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i)
        if (match) {
          let hours = parseInt(match[1], 10)
          const minutes = parseInt(match[2], 10)
          const ampm = match[3]?.toUpperCase()
          if (ampm === 'PM' && hours < 12) hours += 12
          if (ampm === 'AM' && hours === 12) hours = 0
          return hours * 60 + minutes
        }
      }
      if (createdAt) {
        const d = new Date(createdAt)
        if (!isNaN(d.getTime())) {
          return d.getHours() * 60 + d.getMinutes()
        }
      }
      return 0
    }

    const formatMinutesToTime = (totalMinutes: number): string => {
      const m = Math.max(0, Math.min(1439, totalMinutes))
      let hours = Math.floor(m / 60)
      const minutes = m % 60
      const ampm = hours >= 12 ? 'PM' : 'AM'
      if (hours > 12) hours -= 12
      if (hours === 0) hours = 12
      const minStr = minutes < 10 ? `0${minutes}` : `${minutes}`
      const hourStr = hours < 10 ? `0${hours}` : `${hours}`
      return `${hourStr}:${minStr} ${ampm}`
    }

    const getExactDistance = (orig: string, dest: string): number => {
      const normOrig = normalizeStoreName(orig)
      const normDest = normalizeStoreName(dest)
      const match = distances.find(
        d =>
          (d.origin_name === orig && d.destination_name === dest) ||
          (d.origin_name === dest && d.destination_name === orig) ||
          (normalizeStoreName(d.origin_name) === normOrig && normalizeStoreName(d.destination_name) === normDest) ||
          (normalizeStoreName(d.origin_name) === normDest && normalizeStoreName(d.destination_name) === normOrig)
      )
      if (match && Number(match.distance_miles) > 0) {
        return Number(match.distance_miles)
      }
      const c1 = CANONICAL_STORE_COORDINATES[normOrig] || CANONICAL_STORE_COORDINATES[orig]
      const c2 = CANONICAL_STORE_COORDINATES[normDest] || CANONICAL_STORE_COORDINATES[dest]
      if (c1 && c2 && c1.lat && c2.lat) {
        return parseFloat((haversineDistanceMiles(c1.lat, c1.lng, c2.lat, c2.lng) * 1.33).toFixed(2))
      }
      return 4.0
    }

    const bySupAndDate: Record<string, {
      supId: string
      supName: string
      supEmail: string
      date: string
      trips: TripRecord[]
    }> = {}

    trips.forEach(t => {
      if (!isAdmin && !isOwnTrip(t)) return
      if (supervisorFilter !== 'all' && t.supervisor_id !== supervisorFilter && t.supervisor_name !== supervisorFilter) return
      
      // Ricardo Velazquez y Estefani Duran inician el 1 de Septiembre 2026
      if (t.trip_date < '2026-09-01' && /estefani|ricardo/i.test(t.supervisor_name || '')) return

      const supKey = t.supervisor_name || t.supervisor_id || 'Unknown'
      const key = `${supKey}__${t.trip_date}`
      if (!bySupAndDate[key]) {
        bySupAndDate[key] = {
          supId: t.supervisor_id,
          supName: t.supervisor_name,
          supEmail: t.supervisor_email,
          date: t.trip_date,
          trips: []
        }
      }
      bySupAndDate[key].trips.push(t)
    })

    const groups: {
      supervisorId: string
      supervisorName: string
      supervisorEmail: string
      date: string
      gaps: {
        origin: string
        dest: string
        supId: string
        supName: string
        supEmail: string
        date: string
        startTime?: string
        distance: number
        amount: number
      }[]
    }[] = []

    Object.values(bySupAndDate).forEach(item => {
      const dayTrips = item.trips
      const sorted = [...dayTrips].sort((a, b) => {
        const minA = parseTimeToMinutes(a.start_time, a.created_at)
        const minB = parseTimeToMinutes(b.start_time, b.created_at)
        return minA - minB
      })

      const dayGaps: {
        origin: string
        dest: string
        supId: string
        supName: string
        supEmail: string
        date: string
        startTime?: string
        distance: number
        amount: number
      }[] = []

      for (let i = 0; i < sorted.length - 1; i++) {
        const current = sorted[i]
        const next = sorted[i + 1]
        
        const origStore = current.destination_name
        const destStore = next.origin_name

        if (origStore && destStore && origStore !== destStore) {
          const alreadyLogged = dayTrips.some(
            t =>
              (t.origin_name === origStore && t.destination_name === destStore) ||
              (t.is_round_trip && t.origin_name === destStore && t.destination_name === origStore)
          )

          if (!alreadyLogged) {
            const dist = getExactDistance(origStore, destStore)
            const amt = parseFloat((dist * currentRate).toFixed(2))

            // Compute interpolated timestamp between current and next trip
            const minCurrent = parseTimeToMinutes(current.start_time, current.created_at)
            const minNext = parseTimeToMinutes(next.start_time, next.created_at)

            let estimatedStartTime = ''
            if (minCurrent > 0 && minNext > minCurrent) {
              const mid = Math.round((minCurrent + minNext) / 2)
              estimatedStartTime = formatMinutesToTime(mid)
            } else if (minCurrent > 0) {
              estimatedStartTime = formatMinutesToTime(minCurrent + 25)
            } else if (minNext > 25) {
              estimatedStartTime = formatMinutesToTime(minNext - 25)
            }
            
            if (!dayGaps.some(g => g.origin === origStore && g.dest === destStore)) {
              dayGaps.push({
                origin: origStore,
                dest: destStore,
                supId: item.supId,
                supName: item.supName,
                supEmail: item.supEmail,
                date: item.date,
                startTime: estimatedStartTime,
                distance: dist,
                amount: amt
              })
            }
          }
        }
      }

      if (dayGaps.length > 0) {
        groups.push({
          supervisorId: item.supId,
          supervisorName: item.supName,
          supervisorEmail: item.supEmail,
          date: item.date,
          gaps: dayGaps
        })
      }
    })

    return groups.sort((a, b) => b.date.localeCompare(a.date))
  }, [trips, isAdmin, isOwnTrip, supervisorFilter, distances, currentRate])

  const totalPendingGapsCount = useMemo(() => {
    return detectedRouteGapsGrouped.reduce((acc, g) => acc + g.gaps.length, 0)
  }, [detectedRouteGapsGrouped])

  if (loading) {
    return <SurpriseLoader />
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 pb-16">
      {/* Toast Notification */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className={`fixed top-20 right-6 z-[9999] px-4 py-3 rounded-xl shadow-2xl flex items-center gap-3 text-sm font-semibold border backdrop-blur-md ${
              toast.type === 'success'
                ? 'bg-emerald-600/95 text-white border-emerald-500'
                : toast.type === 'warning'
                ? 'bg-amber-600/95 text-white border-amber-500'
                : 'bg-red-600/95 text-white border-red-500'
            }`}
          >
            <CheckCircle2 size={18} />
            {toast.message}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Container */}
      <div className="max-w-7xl mx-auto px-3 sm:px-6 pt-4 sm:pt-6 pb-28 sm:pb-12">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4 sm:mb-6 bg-white dark:bg-slate-900 p-4 sm:p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-blue-600/10 text-blue-600 dark:text-blue-400 rounded-xl shrink-0">
              <Car size={26} />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-black tracking-tight">MilesIQ</h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t('miles.subtitle')}
              </p>
            </div>
          </div>

          {/* Action buttons: Responsive 2x2 grid on mobile, flex on desktop */}
          <div className="grid grid-cols-2 sm:flex sm:items-center gap-2 sm:gap-2.5 w-full sm:w-auto">
            <button
              onClick={() => setIsQuickDriveOpen(true)}
              className="px-3 sm:px-4 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white rounded-xl text-xs font-black flex items-center justify-center gap-1.5 shadow-lg shadow-emerald-600/25 transition-all active:scale-[0.98]"
            >
              <Navigation size={15} />
              <span>{t('miles.quick_drive')}</span>
            </button>

            <button
              onClick={handleSyncInspections}
              disabled={syncingInspections}
              className="px-3 sm:px-3.5 py-2.5 bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:hover:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors border border-emerald-300 dark:border-emerald-700"
              title={t('miles.sync_inspections_desc')}
            >
              <ShieldCheck size={15} className={syncingInspections ? 'animate-spin' : ''} />
              <span className="truncate">{syncingInspections ? t('miles.syncing_inspections') : t('miles.sync_inspections')}</span>
            </button>

            <button
              onClick={handleExportCsv}
              className="px-3 sm:px-3.5 py-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors border border-slate-300 dark:border-slate-700"
            >
              <Download size={15} />
              <span>{t('miles.export_csv')}</span>
            </button>

            <button
              onClick={handleOpenNewTripModal}
              className="px-3 sm:px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 shadow-lg shadow-blue-600/30 transition-all"
            >
              <Plus size={16} />
              <span>{t('miles.log_trip')}</span>
            </button>
          </div>
        </div>

        {/* Executive KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 sm:gap-4 mb-4 sm:mb-6">
          <div className="bg-white dark:bg-slate-900 p-3.5 sm:p-4 rounded-xl sm:rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
            <span className="text-[11px] sm:text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
              {t('miles.total_drives')}
            </span>
            <div className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white mt-0.5 sm:mt-1">
              {metrics.totalTrips}
            </div>
            <span className="text-[10px] sm:text-[11px] text-slate-400 truncate block">
              {isAdmin 
                ? (supervisorFilter !== 'all' 
                    ? (supervisorsList.find(s => String(s.id) === String(supervisorFilter) || s.name === supervisorFilter)?.name || supervisorFilter)
                    : t('miles.all_supervisors')) 
                : currentUser.name}
            </span>
          </div>

          <div className="bg-white dark:bg-slate-900 p-3.5 sm:p-4 rounded-xl sm:rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
            <span className="text-[11px] sm:text-xs font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wider block">
              {t('miles.total_miles')}
            </span>
            <div className="text-xl sm:text-2xl font-black text-blue-600 dark:text-blue-400 mt-0.5 sm:mt-1">
              {metrics.totalMiles.toFixed(2)} <span className="text-xs sm:text-sm font-semibold">mi</span>
            </div>
            <span className="text-[10px] sm:text-[11px] text-slate-400 truncate block">
              ${currentRate.toFixed(3)}/mi IRS rate
            </span>
          </div>

          <div className="bg-white dark:bg-slate-900 p-3.5 sm:p-4 rounded-xl sm:rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
            <span className="text-[11px] sm:text-xs font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider block">
              {t('miles.reimbursement')}
            </span>
            <div className="text-xl sm:text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-0.5 sm:mt-1">
              ${metrics.totalReimbursement.toFixed(2)} <span className="text-xs sm:text-sm font-semibold">USD</span>
            </div>
            <span className="text-[10px] sm:text-[11px] text-slate-400 truncate block">
              {t('miles.includes_tolls_parking')}
            </span>
          </div>

          <div className="bg-white dark:bg-slate-900 p-3.5 sm:p-4 rounded-xl sm:rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
            <span className="text-[11px] sm:text-xs font-bold text-purple-600 dark:text-purple-400 uppercase tracking-wider block">
              {t('miles.sent_to_hr')}
            </span>
            <div className="text-xl sm:text-2xl font-black text-purple-600 dark:text-purple-400 mt-0.5 sm:mt-1">
              {metrics.hrCount} <span className="text-xs sm:text-sm font-semibold">{t('miles.trips_unit')}</span>
            </div>
            <span className="text-[10px] sm:text-[11px] text-slate-400 truncate block">
              {metrics.pendingCount} {t('miles.pending_dispatch')}
            </span>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-slate-200 dark:border-slate-800 mb-4 sm:mb-6 gap-1 sm:gap-2 overflow-x-auto no-scrollbar scrollbar-none pb-0.5">
          <button
            onClick={() => setActiveTab('trips')}
            className={`px-3 sm:px-4 py-2.5 sm:py-3 text-xs sm:text-sm font-bold border-b-2 flex items-center gap-1.5 sm:gap-2 transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'trips'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <Car size={16} />
            <span>{t('miles.tab_drive_log')}</span>
          </button>

          {isAdmin && (
            <>
              <button
                onClick={() => setActiveTab('hr_dispatch')}
                className={`px-3 sm:px-4 py-2.5 sm:py-3 text-xs sm:text-sm font-bold border-b-2 flex items-center gap-1.5 sm:gap-2 transition-colors whitespace-nowrap shrink-0 ${
                  activeTab === 'hr_dispatch'
                    ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                <Mail size={16} />
                <span>{t('miles.tab_hr_dispatch')}</span>
              </button>

              <button
                onClick={() => setActiveTab('history')}
                className={`px-3 sm:px-4 py-2.5 sm:py-3 text-xs sm:text-sm font-bold border-b-2 flex items-center gap-1.5 sm:gap-2 transition-colors whitespace-nowrap shrink-0 ${
                  activeTab === 'history'
                    ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                <FileSpreadsheet size={16} />
                <span>{t('miles.tab_history')}</span>
              </button>

              <button
                onClick={() => setActiveTab('settings')}
                className={`px-3 sm:px-4 py-2.5 sm:py-3 text-xs sm:text-sm font-bold border-b-2 flex items-center gap-1.5 sm:gap-2 transition-colors whitespace-nowrap shrink-0 ${
                  activeTab === 'settings'
                    ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                <Settings size={16} />
                <span>{t('miles.tab_settings')}</span>
              </button>
            </>
          )}
        </div>

        {/* TAB 1: DRIVE LOG */}
        {activeTab === 'trips' && (
          <div className="space-y-4">
            {/* Filter Bar */}
            <div className="bg-white dark:bg-slate-900 p-3 sm:p-4 rounded-xl border border-slate-200 dark:border-slate-800 flex flex-col xl:flex-row gap-3 sm:gap-4 items-stretch xl:items-center justify-between shadow-xs">
              <div className="flex flex-col md:flex-row items-stretch md:items-center gap-2.5 w-full xl:w-auto flex-wrap">
                {/* Search Input */}
                <div className="relative w-full md:w-56">
                  <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    placeholder={t('miles.search_placeholder')}
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-medium focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {/* Professional Date Range & Presets Filter (Sales Module Style) */}
                <div className="w-full md:w-auto">
                  <DateRangeFilter
                    period={period}
                    startDate={startDate}
                    endDate={endDate}
                    onChange={(p, s, e) => {
                      setPeriod(p as string)
                      setStartDate(s)
                      setEndDate(e)
                      setDateRange({ start: s, end: e })
                    }}
                    className="w-full md:w-auto"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center sm:gap-2 w-full md:w-auto">
                  <select
                    value={statusFilter}
                    onChange={e => setStatusFilter(e.target.value)}
                    className="w-full sm:w-auto px-2.5 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-semibold truncate cursor-pointer"
                  >
                    <option value="all">{t('miles.all_statuses')}</option>
                    <option value="pending">{t('miles.status_pending')}</option>
                    <option value="submitted_hr">{t('miles.status_submitted_hr')}</option>
                    <option value="approved">{t('miles.status_approved')}</option>
                    <option value="paid">{t('miles.status_paid')}</option>
                  </select>

                  {/* Supervisor Filter Dropdown (Admins only) */}
                  {isAdmin && supervisorsList.length > 0 && (
                    <select
                      value={supervisorFilter}
                      onChange={e => setSupervisorFilter(e.target.value)}
                      className="w-full sm:w-auto px-2.5 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-semibold text-blue-600 dark:text-blue-400 truncate cursor-pointer"
                    >
                      <option value="all">{t('miles.all_supervisors')}</option>
                      {supervisorsList
                        .filter(sup => {
                          const isPreSept = getCaliforniaBusinessDate() < '2026-09-01'
                          if (isPreSept && /estefani|ricardo/i.test(sup.name)) return false
                          return true
                        })
                        .map(sup => (
                          <option key={sup.id} value={sup.id}>
                            {sup.name}
                          </option>
                        ))}
                    </select>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between sm:justify-end gap-2 text-xs text-slate-500 pt-1 xl:pt-0 border-t xl:border-t-0 border-slate-100 dark:border-slate-800">
                <span className="font-semibold text-slate-700 dark:text-slate-300">{filteredTrips.length} {t('miles.trips_found')}</span>
              </div>
            </div>

            {/* Intelligent Route Gap Detector Banner (Grouped by Supervisor & Date) */}
            {detectedRouteGapsGrouped.length > 0 && (
              <div className="bg-gradient-to-r from-amber-500/15 via-amber-500/10 to-amber-500/5 border border-amber-400/50 dark:border-amber-500/40 rounded-2xl p-4 sm:p-5 shadow-sm space-y-3.5">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-amber-500 text-white rounded-xl shrink-0 shadow-md shadow-amber-500/20">
                    <Sparkles size={20} />
                  </div>
                  <div>
                    <h4 className="text-xs font-black uppercase tracking-wider text-amber-900 dark:text-amber-200 flex items-center gap-2">
                      <span>{t('miles.gap_detector_title')}</span>
                      <span className="px-2 py-0.5 bg-amber-200 dark:bg-amber-900/60 text-amber-950 dark:text-amber-100 rounded-full text-[10px] font-black">
                        {totalPendingGapsCount} pendiente{totalPendingGapsCount > 1 ? 's' : ''}
                      </span>
                    </h4>
                    <p className="text-xs text-amber-800 dark:text-amber-300 mt-0.5 font-medium">
                      {t('miles.gap_detector_desc')}
                    </p>
                  </div>
                </div>

                {/* Supervisor & Date Breakdown Cards */}
                <div className="grid grid-cols-1 gap-2.5 pt-1">
                  {detectedRouteGapsGrouped.map((group, gIdx) => (
                    <div
                      key={`${group.supervisorName}_${group.date}_${gIdx}`}
                      className="bg-white/90 dark:bg-slate-900/90 border border-amber-300/80 dark:border-amber-700/60 rounded-xl p-3 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3"
                    >
                      {/* Supervisor Avatar & Info */}
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 flex items-center justify-center font-black text-xs shrink-0 border border-amber-300/60">
                          {group.supervisorName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-black text-slate-900 dark:text-slate-100">
                              {group.supervisorName}
                            </span>
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                              📅 {group.date}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400">
                            {group.gaps.length} {group.gaps.length === 1 ? 'recorrido pendiente' : 'recorridos pendientes'} detectados
                          </p>
                        </div>
                      </div>

                      {/* 1-Click Action Buttons for this supervisor & date */}
                      <div className="flex items-center gap-2 flex-wrap">
                        {group.gaps.map((gap, idx) => (
                          <button
                            key={idx}
                            onClick={() => handleCreateGapTrip(gap)}
                            className="px-3.5 py-2 bg-amber-600 hover:bg-amber-700 active:scale-95 text-white text-xs font-black rounded-xl shadow-md shadow-amber-600/20 flex items-center gap-2 transition-all"
                            title={`Registrar viaje ${gap.origin} → ${gap.dest} para ${gap.supName} el ${gap.date}`}
                          >
                            <Plus size={14} />
                            <span>
                              {gap.origin.replace('Tacos Gavilan ', '')} → {gap.dest.replace('Tacos Gavilan ', '')}
                              <span className="opacity-90 font-semibold ml-1.5 text-[11px]">
                                ({gap.distance.toFixed(2)} mi • ${gap.amount.toFixed(2)})
                              </span>
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Trips Table — Desktop */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm hidden md:block">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider border-b border-slate-200 dark:border-slate-800">
                    <tr>
                      <th className="py-3.5 px-4">{t('miles.th_when')}</th>
                      <th className="py-3.5 px-4">{t('miles.th_supervisor')}</th>
                      <th className="py-3.5 px-4">{t('miles.th_why')}</th>
                      <th className="py-3.5 px-4">{t('miles.th_route')}</th>
                      <th className="py-3.5 px-4 text-right">{t('miles.th_distance')}</th>
                      <th className="py-3.5 px-4 text-right">{t('miles.th_rate')}</th>
                      <th className="py-3.5 px-4 text-right">{t('miles.th_reimbursement')}</th>
                      <th className="py-3.5 px-4 text-center">{t('miles.th_status')}</th>
                      <th className="py-3.5 px-4 text-right">{t('miles.th_actions')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {filteredTrips.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="py-12 text-center text-slate-400">
                          {t('miles.empty_table')}
                        </td>
                      </tr>
                    ) : (
                      filteredTrips.map(trip => {
                        const m = Number(trip.distance_miles) || 0
                        const r = Number(trip.rate_per_mile) || 0.76
                        const p = Number(trip.parking_amount) || 0
                        const to = Number(trip.tolls_amount) || 0
                        const tot = (m * r) + p + to

                        return (
                          <tr key={trip.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                            <td className="py-3.5 px-4 whitespace-nowrap">
                              <div className="font-bold text-slate-900 dark:text-white text-xs">
                                {trip.trip_date}
                              </div>
                              {trip.start_time && (
                                <div className="text-[11px] text-slate-400 font-medium mt-0.5">
                                  {trip.start_time}
                                </div>
                              )}
                            </td>
                            <td className="py-3.5 px-4 font-medium text-slate-700 dark:text-slate-300">
                              {trip.supervisor_name}
                            </td>
                            <td className="py-3.5 px-4">
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400">
                                {trip.purpose || 'Business'}
                              </span>
                              {trip.purpose_notes && <p className="text-[10px] text-slate-400 mt-0.5 truncate max-w-xs">{trip.purpose_notes}</p>}
                            </td>
                            <td className="py-3.5 px-4">
                              <div className="flex items-center gap-1.5 font-semibold text-slate-800 dark:text-slate-200">
                                <span>{trip.origin_name}</span>
                                <span className="text-slate-400">→</span>
                                <span>{trip.destination_name}</span>
                                {trip.is_round_trip && (
                                  <span className="text-[10px] bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-400 px-1.5 py-0.5 rounded font-black">
                                    {t('miles.badge_round_trip')}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="py-3.5 px-4 text-right font-bold text-blue-600 dark:text-blue-400">
                              {m.toFixed(2)} mi
                            </td>
                            <td className="py-3.5 px-4 text-right text-slate-500 font-medium">
                              ${r.toFixed(3)}
                            </td>
                            <td className="py-3.5 px-4 text-right font-black text-emerald-600 dark:text-emerald-400 text-sm">
                              ${tot.toFixed(2)}
                            </td>
                            <td className="py-3.5 px-4 text-center">
                              {trip.status === 'submitted_hr' && (
                                <span className="px-2.5 py-1 rounded-md text-[10px] font-bold bg-purple-100 text-purple-700 dark:bg-purple-950/60 dark:text-purple-400 border border-purple-200 dark:border-purple-800">
                                  {t('miles.badge_submitted_hr')}
                                </span>
                              )}
                              {trip.status === 'pending' && (
                                <span className="px-2.5 py-1 rounded-md text-[10px] font-bold bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400 border border-amber-200 dark:border-amber-800">
                                  {t('miles.badge_pending')}
                                </span>
                              )}
                              {trip.status === 'approved' && (
                                <span className="px-2.5 py-1 rounded-md text-[10px] font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
                                  {t('miles.badge_approved')}
                                </span>
                              )}
                              {trip.status === 'paid' && (
                                <span className="px-2.5 py-1 rounded-md text-[10px] font-bold bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-400 border border-blue-200 dark:border-blue-800">
                                  {t('miles.badge_paid')}
                                </span>
                              )}
                            </td>
                            <td className="py-3.5 px-4 text-right whitespace-nowrap">
                              <div className="flex items-center justify-end gap-1">
                                <button
                                  onClick={() => handleReturnTrip(trip)}
                                  title={t('miles.return_trip_btn')}
                                  className="p-1.5 text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-950/40 rounded-lg transition-colors"
                                >
                                  <RotateCcw size={16} />
                                </button>
                                {(trip.status === 'pending' || isAdmin) && (
                                  <button
                                    onClick={() => handleOpenEditModal(trip)}
                                    title={t('miles.edit_trip')}
                                    className="p-1.5 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40 rounded-lg transition-colors"
                                  >
                                    <Edit3 size={16} />
                                  </button>
                                )}
                                {isAdmin && trip.status === 'pending' && (
                                  <button
                                    onClick={() => handleUpdateStatus(trip.id, 'approved')}
                                    title={t('miles.approve_trip')}
                                    className="p-1.5 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 rounded-lg transition-colors"
                                  >
                                    <CheckCircle2 size={16} />
                                  </button>
                                )}
                                {(trip.status === 'pending' || isAdmin) && (
                                  <button
                                    onClick={() => handleDeleteTrip(trip.id)}
                                    title={t('miles.delete_trip')}
                                    className="p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg transition-colors"
                                  >
                                    <Trash2 size={16} />
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                  {filteredTrips.length > 0 && (
                    <tfoot className="bg-slate-100 dark:bg-slate-800/80 font-bold border-t-2 border-slate-300 dark:border-slate-700">
                      <tr>
                        <td colSpan={4} className="py-3.5 px-4 text-slate-800 dark:text-slate-200 uppercase tracking-wider text-xs font-black">
                          {t('miles.table_subtotal')} ({filteredTrips.length} {filteredTrips.length === 1 ? t('miles.trip_singular') : t('miles.trips_plural')})
                        </td>
                        <td className="py-3.5 px-4 text-right text-blue-600 dark:text-blue-400 font-black text-sm">
                          {filteredTrips.reduce((s, t) => s + (Number(t.distance_miles) || 0), 0).toFixed(2)} mi
                        </td>
                        <td className="py-3.5 px-4 text-right text-slate-400 text-[11px]">
                          —
                        </td>
                        <td className="py-3.5 px-4 text-right font-black text-emerald-600 dark:text-emerald-400 text-sm">
                          ${filteredTrips.reduce((s, t) => {
                            const m = Number(t.distance_miles) || 0
                            const r = Number(t.rate_per_mile) || 0.76
                            const p = Number(t.parking_amount) || 0
                            const to = Number(t.tolls_amount) || 0
                            return s + (m * r) + p + to
                          }, 0).toFixed(2)} USD
                        </td>
                        <td colSpan={2} className="py-3.5 px-4 text-slate-400 text-center text-[10px]">
                          {filteredTrips.some(t => Number(t.parking_amount) > 0 || Number(t.tolls_amount) > 0) && (
                            <span>
                              Incl. ${filteredTrips.reduce((s, t) => s + (Number(t.parking_amount) || 0) + (Number(t.tolls_amount) || 0), 0).toFixed(2)} gastos
                            </span>
                          )}
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>

            {/* Trips Cards — Mobile */}
            <div className="md:hidden space-y-3">
              {filteredTrips.length === 0 ? (
                <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-8 text-center text-slate-400 text-xs">
                  {t('miles.empty_table')}
                </div>
              ) : (
                filteredTrips.map(trip => {
                  const m = Number(trip.distance_miles) || 0
                  const r = Number(trip.rate_per_mile) || 0.76
                  const p = Number(trip.parking_amount) || 0
                  const to = Number(trip.tolls_amount) || 0
                  const tot = (m * r) + p + to

                  return (
                    <div key={trip.id} className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 shadow-xs space-y-3">
                      {/* Top Row: Date/Time + Status Badge */}
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-xs font-black text-slate-900 dark:text-white">{trip.trip_date}</div>
                          {trip.start_time && <div className="text-[10px] text-slate-400 font-semibold mt-0.5">{trip.start_time}</div>}
                        </div>
                        <div>
                          {trip.status === 'submitted_hr' && (
                            <span className="px-2.5 py-1 rounded-md text-[10px] font-bold bg-purple-100 text-purple-700 dark:bg-purple-950/60 dark:text-purple-400 border border-purple-200 dark:border-purple-800">{t('miles.badge_submitted_hr')}</span>
                          )}
                          {trip.status === 'pending' && (
                            <span className="px-2.5 py-1 rounded-md text-[10px] font-bold bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400 border border-amber-200 dark:border-amber-800">{t('miles.badge_pending')}</span>
                          )}
                          {trip.status === 'approved' && (
                            <span className="px-2.5 py-1 rounded-md text-[10px] font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">{t('miles.badge_approved')}</span>
                          )}
                          {trip.status === 'paid' && (
                            <span className="px-2.5 py-1 rounded-md text-[10px] font-bold bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-400 border border-blue-200 dark:border-blue-800">{t('miles.badge_paid')}</span>
                          )}
                        </div>
                      </div>

                      {/* Route Box */}
                      <div className="bg-slate-50 dark:bg-slate-800/60 p-2.5 rounded-xl border border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800 dark:text-slate-200 min-w-0">
                          <MapPin size={13} className="text-emerald-500 shrink-0" />
                          <span className="truncate">{trip.origin_name?.replace('Tacos Gavilan ', '')}</span>
                          <span className="text-slate-400 shrink-0">→</span>
                          <span className="truncate">{trip.destination_name?.replace('Tacos Gavilan ', '')}</span>
                        </div>
                        {trip.is_round_trip && (
                          <span className="text-[9px] bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-400 px-1.5 py-0.5 rounded font-black shrink-0">
                            {t('miles.badge_round_trip')}
                          </span>
                        )}
                      </div>

                      {/* Supervisor + Purpose */}
                      <div className="flex items-center justify-between text-[11px] gap-2">
                        <span className="text-slate-600 dark:text-slate-400 font-semibold truncate">
                          👤 {trip.supervisor_name}
                        </span>
                        <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400 shrink-0">
                          {trip.purpose || 'Business'}
                        </span>
                      </div>

                      {trip.purpose_notes && (
                        <p className="text-[10px] text-slate-400 dark:text-slate-500 italic truncate">
                          📝 {trip.purpose_notes}
                        </p>
                      )}

                      {/* Bottom Row: Money & Generous Touch Target Action Buttons */}
                      <div className="flex items-center justify-between pt-2.5 border-t border-slate-100 dark:border-slate-800">
                        <div>
                          <div className="text-[10px] text-slate-400 font-medium">
                            <span className="font-bold text-blue-600 dark:text-blue-400">{m.toFixed(2)} mi</span> × ${r.toFixed(3)}
                          </div>
                          <div className="text-base font-black text-emerald-600 dark:text-emerald-400">
                            ${tot.toFixed(2)} <span className="text-[10px] font-bold text-slate-400">USD</span>
                          </div>
                        </div>

                        {/* Action Buttons */}
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => handleReturnTrip(trip)}
                            title={t('miles.return_trip_btn')}
                            className="w-8 h-8 flex items-center justify-center text-purple-600 bg-purple-50 hover:bg-purple-100 dark:bg-purple-950/50 dark:hover:bg-purple-900/50 rounded-lg transition-colors border border-purple-200 dark:border-purple-800"
                          >
                            <RotateCcw size={15} />
                          </button>
                          {(trip.status === 'pending' || isAdmin) && (
                            <button
                              onClick={() => handleOpenEditModal(trip)}
                              title={t('miles.edit_trip')}
                              className="w-8 h-8 flex items-center justify-center text-blue-600 bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/50 dark:hover:bg-blue-900/50 rounded-lg transition-colors border border-blue-200 dark:border-blue-800"
                            >
                              <Edit3 size={15} />
                            </button>
                          )}
                          {isAdmin && trip.status === 'pending' && (
                            <button
                              onClick={() => handleUpdateStatus(trip.id, 'approved')}
                              title={t('miles.approve_trip')}
                              className="w-8 h-8 flex items-center justify-center text-emerald-600 bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/50 dark:hover:bg-emerald-900/50 rounded-lg transition-colors border border-emerald-200 dark:border-emerald-800"
                            >
                              <CheckCircle2 size={15} />
                            </button>
                          )}
                          {(trip.status === 'pending' || isAdmin) && (
                            <button
                              onClick={() => handleDeleteTrip(trip.id)}
                              title={t('miles.delete_trip')}
                              className="w-8 h-8 flex items-center justify-center text-red-500 bg-red-50 hover:bg-red-100 dark:bg-red-950/50 dark:hover:bg-red-900/50 rounded-lg transition-colors border border-red-200 dark:border-red-800"
                            >
                              <Trash2 size={15} />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })
              )}

              {/* Mobile Subtotal Card */}
              {filteredTrips.length > 0 && (
                <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 text-white p-4 rounded-xl border border-slate-700 shadow-md flex items-center justify-between">
                  <div>
                    <span className="text-[10px] uppercase tracking-wider font-bold text-slate-400">
                      {t('miles.table_subtotal')} ({filteredTrips.length} {filteredTrips.length === 1 ? t('miles.trip_singular') : t('miles.trips_plural')})
                    </span>
                    <div className="text-xs font-semibold text-blue-400 mt-0.5">
                      {filteredTrips.reduce((s, t) => s + (Number(t.distance_miles) || 0), 0).toFixed(2)} mi totales
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-base font-black text-emerald-400">
                      ${filteredTrips.reduce((s, t) => {
                        const m = Number(t.distance_miles) || 0
                        const r = Number(t.rate_per_mile) || 0.76
                        const p = Number(t.parking_amount) || 0
                        const to = Number(t.tolls_amount) || 0
                        return s + (m * r) + p + to
                      }, 0).toFixed(2)} USD
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 2: HR PAYROLL DISPATCH */}
        {activeTab === 'hr_dispatch' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left: Email Dispatch Card */}
            <div className="lg:col-span-1 bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-5">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-blue-600/10 text-blue-600 dark:text-blue-400 rounded-xl">
                  <Mail size={24} />
                </div>
                <div>
                  <h3 className="text-lg font-bold">{t('miles.hr_dispatch_title')}</h3>
                  <p className="text-xs text-slate-500">{t('miles.hr_dispatch_subtitle')}</p>
                </div>
              </div>

              {/* Sender Account Display */}
              <div className="bg-slate-50 dark:bg-slate-800/60 p-3.5 rounded-xl border border-slate-200 dark:border-slate-700">
                <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                  {t('miles.sender_label')}
                </span>
                <div className="font-bold text-sm text-slate-900 dark:text-white mt-0.5">
                  {currentUser.name}
                </div>
                <div className="text-xs text-blue-600 dark:text-blue-400 font-mono mt-0.5">
                  {currentUser.email}
                </div>
              </div>

              {/* Date Period Filters */}
              <div className="space-y-2">
                <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
                  {t('miles.payroll_period')}
                </label>
                <DateRangeFilter
                  period={period}
                  startDate={startDate}
                  endDate={endDate}
                  onChange={(p, s, e) => {
                    setPeriod(p as string)
                    setStartDate(s)
                    setEndDate(e)
                    setDateRange({ start: s, end: e })
                  }}
                  className="w-full"
                />
              </div>

              {/* Recurrent Recipient Email Selector */}
              <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-800">
                <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
                  {t('miles.recipient_label')}
                </label>

                {/* Recurrent Email Chips */}
                {recurrentEmails.length > 0 && (
                  <div className="space-y-1.5">
                    <span className="text-[11px] text-slate-400">{t('miles.recurrent_emails')}</span>
                    <div className="flex flex-wrap gap-1.5">
                      {recurrentEmails.map(rec => (
                        <button
                          key={rec.id}
                          type="button"
                          onClick={() => {
                            setSelectedRecipientEmail(rec.email)
                            setCustomEmailInput('')
                          }}
                          className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all border ${
                            selectedRecipientEmail === rec.email && !customEmailInput
                              ? 'bg-blue-600 text-white border-blue-500 shadow-md shadow-blue-600/30'
                              : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700'
                          }`}
                        >
                          {rec.email}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Custom Email Input */}
                <div>
                  <span className="text-[11px] text-slate-400 block mb-1">{t('miles.custom_email')}</span>
                  <input
                    type="email"
                    placeholder="email@tacosgavilan.com"
                    value={customEmailInput}
                    onChange={e => setCustomEmailInput(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-medium focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              {/* Submit Button */}
              <button
                onClick={handleSendToHr}
                disabled={sendingHr}
                className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-sm flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/30 transition-all disabled:opacity-50"
              >
                {sendingHr ? (
                  <RotateCw size={18} className="animate-spin" />
                ) : (
                  <Send size={18} />
                )}
                {t('miles.send_report')}
              </button>
            </div>

            {/* Right: Consolidated Summary Table */}
            <div className="lg:col-span-2 bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold">{t('miles.summary_title')}</h3>
                  <p className="text-xs text-slate-500">{t('miles.summary_subtitle')}</p>
                </div>
                <span className="text-xs font-bold px-3 py-1 bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-400 rounded-full border border-blue-200 dark:border-blue-800">
                  {supervisorSummaries.length} {t('miles.supervisors_unit')}
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider border-b border-slate-200 dark:border-slate-800">
                    <tr>
                      <th className="py-3 px-4">{t('miles.th_supervisor')}</th>
                      <th className="py-3 px-4 text-center">{t('miles.th_trips')}</th>
                      <th className="py-3 px-4 text-right">{t('miles.th_total_miles')}</th>
                      <th className="py-3 px-4 text-right">{t('miles.th_parking')}</th>
                      <th className="py-3 px-4 text-right">{t('miles.th_tolls')}</th>
                      <th className="py-3 px-4 text-right">{t('miles.th_total_reimbursement')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {supervisorSummaries.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-12 text-center text-slate-400">
                          {t('miles.no_data_period')}
                        </td>
                      </tr>
                    ) : (
                      supervisorSummaries.map(s => (
                        <tr key={s.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                          <td className="py-3.5 px-4 font-bold text-slate-900 dark:text-white">
                            {s.name}
                            <p className="text-[10px] text-slate-400 font-normal">{s.email}</p>
                          </td>
                          <td className="py-3.5 px-4 text-center font-semibold text-slate-600 dark:text-slate-400">
                            {s.tripsCount}
                          </td>
                          <td className="py-3.5 px-4 text-right font-bold text-blue-600 dark:text-blue-400">
                            {s.totalMiles.toFixed(2)} mi
                          </td>
                          <td className="py-3.5 px-4 text-right text-slate-500">
                            ${s.totalParking.toFixed(2)}
                          </td>
                          <td className="py-3.5 px-4 text-right text-slate-500">
                            ${s.totalTolls.toFixed(2)}
                          </td>
                          <td className="py-3.5 px-4 text-right font-black text-emerald-600 dark:text-emerald-400 text-sm">
                            ${s.totalAmount.toFixed(2)} USD
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: SUBMISSIONS LOG */}
        {activeTab === 'history' && (
          <div className="space-y-4">
            <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-bold">{t('miles.history_title')}</h3>
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-400">
                    {submissions.length}
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">{t('miles.history_subtitle')}</p>
              </div>
            </div>

            {submissions.length === 0 ? (
              <div className="bg-white dark:bg-slate-900 p-12 text-center text-slate-400 text-xs border border-dashed border-slate-300 dark:border-slate-800 rounded-2xl">
                <FileSpreadsheet size={36} className="mx-auto mb-3 text-slate-400" />
                <p className="max-w-md mx-auto leading-relaxed">{t('miles.history_empty')}</p>
              </div>
            ) : (
              <>
                {/* Desktop Table */}
                <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm hidden md:block">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider border-b border-slate-200 dark:border-slate-800">
                        <tr>
                          <th className="py-3.5 px-4">{t('miles.th_sent_at')}</th>
                          <th className="py-3.5 px-4">{t('miles.th_period_covered')}</th>
                          <th className="py-3.5 px-4">{t('miles.th_sender')}</th>
                          <th className="py-3.5 px-4">{t('miles.th_recipient')}</th>
                          <th className="py-3.5 px-4 text-center">{t('miles.th_supervisors_count')}</th>
                          <th className="py-3.5 px-4 text-right">{t('miles.th_total_miles')}</th>
                          <th className="py-3.5 px-4 text-right">{t('miles.th_total_reimbursed')}</th>
                          <th className="py-3.5 px-4 text-center">{t('miles.th_delivery_status')}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                        {submissions.map((sub: any) => {
                          const isSent = sub.email_status === 'sent'
                          const dateFormatted = sub.created_at
                            ? new Date(sub.created_at).toLocaleString('es-MX', {
                                dateStyle: 'medium',
                                timeStyle: 'short',
                                timeZone: 'America/Los_Angeles'
                              })
                            : '—'

                          return (
                            <tr key={sub.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                              <td className="py-3.5 px-4 font-semibold text-slate-900 dark:text-white whitespace-nowrap">
                                <div className="flex items-center gap-1.5">
                                  <Clock size={13} className="text-slate-400" />
                                  <span>{dateFormatted}</span>
                                </div>
                              </td>
                              <td className="py-3.5 px-4">
                                <span className="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                                  {sub.period_start} → {sub.period_end}
                                </span>
                              </td>
                              <td className="py-3.5 px-4">
                                <div className="font-medium text-slate-800 dark:text-slate-200">{sub.sender_name}</div>
                                <div className="text-[10px] text-slate-400 truncate max-w-xs">{sub.sender_email}</div>
                              </td>
                              <td className="py-3.5 px-4">
                                <div className="flex items-center gap-1.5 text-slate-700 dark:text-slate-300">
                                  <Mail size={12} className="text-blue-500 shrink-0" />
                                  <span className="font-semibold truncate max-w-xs">{sub.recipient_email}</span>
                                </div>
                              </td>
                              <td className="py-3.5 px-4 text-center">
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-400">
                                  {sub.total_supervisors}
                                </span>
                              </td>
                              <td className="py-3.5 px-4 text-right font-bold text-blue-600 dark:text-blue-400">
                                {Number(sub.total_miles || 0).toFixed(2)} mi
                              </td>
                              <td className="py-3.5 px-4 text-right font-black text-emerald-600 dark:text-emerald-400 text-sm">
                                ${Number(sub.total_reimbursement || 0).toFixed(2)} USD
                              </td>
                              <td className="py-3.5 px-4 text-center">
                                {isSent ? (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
                                    <CheckCircle2 size={11} />
                                    {t('miles.status_sent')}
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-bold bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-400 border border-red-200 dark:border-red-800" title={sub.email_status}>
                                    <AlertCircle size={11} />
                                    {t('miles.status_failed')}
                                  </span>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Mobile Cards */}
                <div className="md:hidden space-y-3">
                  {submissions.map((sub: any) => {
                    const isSent = sub.email_status === 'sent'
                    const dateFormatted = sub.created_at
                      ? new Date(sub.created_at).toLocaleDateString('es-MX', {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        })
                      : '—'

                    return (
                      <div key={sub.id} className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 shadow-sm space-y-2.5">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                            <Clock size={12} className="text-slate-400" />
                            {dateFormatted}
                          </span>
                          {isSent ? (
                            <span className="px-2 py-0.5 rounded-md text-[9px] font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400">
                              {t('miles.status_sent')}
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-md text-[9px] font-bold bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-400">
                              {t('miles.status_failed')}
                            </span>
                          )}
                        </div>

                        <div className="text-xs text-slate-600 dark:text-slate-300">
                          <div className="font-semibold text-[11px] text-slate-400 uppercase tracking-wider mb-0.5">
                            {t('miles.th_period_covered')}
                          </div>
                          <div className="font-medium bg-slate-50 dark:bg-slate-800 p-1.5 rounded-md">
                            {sub.period_start} → {sub.period_end}
                          </div>
                        </div>

                        <div className="flex items-center justify-between text-xs pt-1">
                          <span className="text-slate-500 truncate max-w-[55%] flex items-center gap-1">
                            <Mail size={11} className="text-blue-500 shrink-0" />
                            {sub.recipient_email}
                          </span>
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-400">
                            {sub.total_supervisors} {t('miles.supervisors_unit')}
                          </span>
                        </div>

                        <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800 text-xs">
                          <span className="font-bold text-blue-600 dark:text-blue-400">
                            {Number(sub.total_miles || 0).toFixed(2)} mi
                          </span>
                          <span className="font-black text-emerald-600 dark:text-emerald-400 text-sm">
                            ${Number(sub.total_reimbursement || 0).toFixed(2)} USD
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        )}

        {/* TAB 4: SETTINGS & MATRIX */}
        {activeTab === 'settings' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Rate Settings Card */}
            <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-emerald-600/10 text-emerald-600 dark:text-emerald-400 rounded-xl">
                  <DollarSign size={24} />
                </div>
                <div>
                  <h3 className="text-lg font-bold">{t('miles.rate_title')}</h3>
                  <p className="text-xs text-slate-500">{t('miles.rate_subtitle')}</p>
                </div>
              </div>

              <div className="flex items-center gap-3 pt-2">
                <input
                  type="number"
                  step="0.005"
                  value={editingRate}
                  onChange={e => setEditingRate(e.target.value)}
                  className="px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-lg font-bold text-emerald-600 dark:text-emerald-400 w-36"
                />
                <span className="text-sm font-semibold text-slate-500">{t('miles.rate_unit')}</span>

                <button
                  onClick={handleSaveRate}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-blue-600/20"
                >
                  {t('miles.save_rate')}
                </button>
              </div>

              <p className="text-xs text-slate-400" dangerouslySetInnerHTML={{ __html: t('miles.rate_note') }} />
            </div>

            {/* Distance Matrix Form Card */}
            <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-purple-600/10 text-purple-600 dark:text-purple-400 rounded-xl">
                    <MapPin size={24} />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold">{t('miles.matrix_title')}</h3>
                    <p className="text-xs text-slate-500">{t('miles.matrix_subtitle')}</p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleAutoPopulateMatrix}
                  disabled={isPopulatingMatrix}
                  className="px-4 py-2.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-purple-600/20 flex items-center gap-2 disabled:opacity-50"
                >
                  {isPopulatingMatrix ? (
                    <RotateCw size={14} className="animate-spin" />
                  ) : (
                    <span>✨</span>
                  )}
                  {t('miles.generate_matrix')}
                </button>
              </div>

              <form onSubmit={handleSaveDistancePair} className="space-y-3 pt-2">
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    placeholder={t('miles.origin_placeholder')}
                    value={newOrigin}
                    onChange={e => setNewOrigin(e.target.value)}
                    className="px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-xs"
                    required
                  />
                  <input
                    type="text"
                    placeholder={t('miles.dest_placeholder')}
                    value={newDest}
                    onChange={e => setNewDest(e.target.value)}
                    className="px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-xs"
                    required
                  />
                </div>

                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    step="0.1"
                    placeholder={t('miles.miles_placeholder')}
                    value={newDistMiles}
                    onChange={e => setNewDistMiles(e.target.value)}
                    className="px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-bold text-blue-600 w-32"
                    required
                  />
                  <button
                    type="submit"
                    className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-xs font-bold transition-all"
                  >
                    {t('miles.add_route')}
                  </button>
                </div>
              </form>

              {/* Distance Pairs Table */}
              <div className="max-h-48 overflow-y-auto border border-slate-200 dark:border-slate-800 rounded-xl mt-3">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-800 text-slate-500 font-bold uppercase">
                    <tr>
                      <th className="py-2 px-3">{t('miles.th_origin')}</th>
                      <th className="py-2 px-3">{t('miles.th_dest')}</th>
                      <th className="py-2 px-3 text-right">{t('miles.th_miles')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {distances.map(d => (
                      <tr key={d.id || `${d.origin_name}-${d.destination_name}`}>
                        <td className="py-2 px-3 font-semibold">{d.origin_name}</td>
                        <td className="py-2 px-3 font-semibold">{d.destination_name}</td>
                        <td className="py-2 px-3 text-right font-bold text-blue-600">{Number(d.distance_miles).toFixed(2)} mi</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Modal for Logging / Editing Trip */}
      <TripModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false)
          setEditingTrip(null)
        }}
        onSave={handleSaveTrip}
        stores={storesList}
        distances={distances}
        supervisors={supervisorsList}
        currentRate={currentRate}
        currentUser={currentUser}
        isAdmin={isAdmin}
        editingTrip={editingTrip}
      />

      {/* Quick 1-Tap Drive & Live Navigation Modal */}
      <QuickDriveModal
        isOpen={isQuickDriveOpen}
        onClose={() => setIsQuickDriveOpen(false)}
        currentUser={currentUser}
        onTripLogged={fetchInitialData}
      />
    </div>
  )
}
