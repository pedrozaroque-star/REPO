'use client'

/**
 * @module MilesIQPage
 * @description Master dashboard and operational module for MilesIQ supervisor mileage tracking and HR payroll dispatching.
 * @businessRules
 * - Supervisores can log personal auto drives, track business mileage, parking, and tolls, and calculate reimbursement totals.
 * - Rate per mile defaults to $0.725/mi (IRS standard reimbursement rate).
 * - Dispatches payroll summaries directly to HR via email using active logged-in session profile identity (user.email & user.name).
 * - Maintains a dynamic recurrent recipient email list for 1-click HR dispatching.
 * - Admins can review, approve, reject, mark as paid, and configure distance matrices & rates.
 * @dataFlow
 * - Client (React) <-> REST API (/api/miles/*) <-> Supabase DB tables.
 * @notes 100% bilingual i18n support using useLanguage().
 */

import React, { useState, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Car, Plus, MapPin, Calendar, DollarSign, Send, CheckCircle2,
  Clock, AlertCircle, Download, RefreshCw, Settings, Search,
  Filter, RotateCw, Trash2, Edit3, ShieldCheck, Mail, Users, FileSpreadsheet, Check
} from 'lucide-react'
import ProtectedRoute, { useAuth } from '@/components/ProtectedRoute'
import SurpriseLoader from '@/components/SurpriseLoader'
import { useLanguage } from '@/lib/i18n'
import TripModal from '@/components/miles/TripModal'

interface TripRecord {
  id: string
  supervisor_id: string
  supervisor_name: string
  supervisor_email: string
  trip_date: string
  start_time?: string
  origin_name: string
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
  created_at: string
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
  const [currentRate, setCurrentRate] = useState<number>(0.725)
  const [editingRate, setEditingRate] = useState<string>('0.725')

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [supervisorFilter, setSupervisorFilter] = useState<string>('all')
  const [searchTerm, setSearchTerm] = useState<string>('')
  const [dateRange, setDateRange] = useState<{ start: string; end: string }>({
    start: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10),
    end: new Date().toISOString().slice(0, 10)
  })

  // HR Dispatch state
  const [selectedRecipientEmail, setSelectedRecipientEmail] = useState<string>('roque@tacosgavilan.com')
  const [customEmailInput, setCustomEmailInput] = useState<string>('')
  const [sendingHr, setSendingHr] = useState<boolean>(false)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'warning' } | null>(null)

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false)

  // Distance matrix edit state
  const [newOrigin, setNewOrigin] = useState<string>('')
  const [newDest, setNewDest] = useState<string>('')
  const [newDistMiles, setNewDistMiles] = useState<string>('')

  const showToast = (message: string, type: 'success' | 'error' | 'warning') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 4500)
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
        setCurrentRate(jsonSettings.rate_per_mile || 0.725)
        setEditingRate(String(jsonSettings.rate_per_mile || 0.725))
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

  // Handle trip creation from modal
  const handleSaveTrip = async (tripData: any) => {
    try {
      const res = await fetch('/api/miles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tripData)
      })
      const json = await res.json()
      if (json.success) {
        showToast(
          t('miles.trip_saved'),
          'success'
        )
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
  const isOwnTrip = (t: TripRecord) => {
    if (t.supervisor_id === currentUser.id) return true
    if (t.supervisor_email && currentUser.email && t.supervisor_email.toLowerCase() === currentUser.email.toLowerCase()) return true
    if (t.supervisor_name && currentUser.name && t.supervisor_name.toLowerCase() === currentUser.name.toLowerCase()) return true
    return false
  }

  // Filtered trips list
  const filteredTrips = useMemo(() => {
    return trips.filter(t => {
      if (!isAdmin && !isOwnTrip(t)) return false
      if (supervisorFilter !== 'all' && t.supervisor_id !== supervisorFilter && t.supervisor_name !== supervisorFilter) return false
      if (statusFilter !== 'all' && t.status !== statusFilter) return false
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
  }, [trips, statusFilter, supervisorFilter, searchTerm, isAdmin, currentUser])

  // Summary Metrics
  const metrics = useMemo(() => {
    const userTrips = isAdmin ? trips : trips.filter(isOwnTrip)
    const totalMiles = userTrips.reduce((s, t) => s + (Number(t.distance_miles) || 0), 0)
    const totalReimbursement = userTrips.reduce((s, t) => {
      const m = Number(t.distance_miles) || 0
      const r = Number(t.rate_per_mile) || 0.725
      const p = Number(t.parking_amount) || 0
      const to = Number(t.tolls_amount) || 0
      return s + (m * r) + p + to
    }, 0)
    const pendingCount = userTrips.filter(t => t.status === 'pending').length
    const hrCount = userTrips.filter(t => t.status === 'submitted_hr' || t.status === 'paid').length

    return {
      totalTrips: userTrips.length,
      totalMiles,
      totalReimbursement,
      pendingCount,
      hrCount
    }
  }, [trips, isAdmin, currentUser])

  // Summaries per supervisor for HR dispatch tab
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

    trips.forEach(t => {
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
      const r = Number(t.rate_per_mile) || 0.725
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
  }, [trips])

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
      <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="p-2.5 bg-blue-600/10 text-blue-600 dark:text-blue-400 rounded-xl">
                <Car size={26} />
              </div>
              <div>
                <h1 className="text-2xl font-black tracking-tight">MilesIQ</h1>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {t('miles.subtitle')}
                </p>
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-3">
            <button
              onClick={handleExportCsv}
              className="px-3.5 py-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-bold flex items-center gap-2 transition-colors border border-slate-300 dark:border-slate-700"
            >
              <Download size={16} />
              {t('miles.export_csv')}
            </button>

            <button
              onClick={() => setIsModalOpen(true)}
              className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-lg shadow-blue-600/30 transition-all"
            >
              <Plus size={18} />
              {t('miles.log_trip')}
            </button>
          </div>
        </div>

        {/* Executive KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
            <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              {t('miles.total_drives')}
            </span>
            <div className="text-2xl font-black text-slate-900 dark:text-white mt-1">
              {metrics.totalTrips}
            </div>
            <span className="text-[11px] text-slate-400">
              {isAdmin ? t('miles.all_supervisors') : currentUser.name}
            </span>
          </div>

          <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
            <span className="text-xs font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wider">
              {t('miles.total_miles')}
            </span>
            <div className="text-2xl font-black text-blue-600 dark:text-blue-400 mt-1">
              {metrics.totalMiles.toFixed(2)} <span className="text-sm font-semibold">mi</span>
            </div>
            <span className="text-[11px] text-slate-400">
              ${currentRate.toFixed(3)}/mi IRS rate
            </span>
          </div>

          <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
            <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">
              {t('miles.reimbursement')}
            </span>
            <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-1">
              ${metrics.totalReimbursement.toFixed(2)} <span className="text-sm font-semibold">USD</span>
            </div>
            <span className="text-[11px] text-slate-400">
              {t('miles.includes_tolls_parking')}
            </span>
          </div>

          <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
            <span className="text-xs font-bold text-purple-600 dark:text-purple-400 uppercase tracking-wider">
              {t('miles.sent_to_hr')}
            </span>
            <div className="text-2xl font-black text-purple-600 dark:text-purple-400 mt-1">
              {metrics.hrCount} <span className="text-sm font-semibold">{t('miles.trips_unit')}</span>
            </div>
            <span className="text-[11px] text-slate-400">
              {metrics.pendingCount} {t('miles.pending_dispatch')}
            </span>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-slate-200 dark:border-slate-800 mb-6 gap-2 overflow-x-auto">
          <button
            onClick={() => setActiveTab('trips')}
            className={`px-4 py-3 text-sm font-bold border-b-2 flex items-center gap-2 transition-colors whitespace-nowrap ${
              activeTab === 'trips'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <Car size={18} />
            {t('miles.tab_drive_log')}
          </button>

          {isAdmin && (
            <>
              <button
                onClick={() => setActiveTab('hr_dispatch')}
                className={`px-4 py-3 text-sm font-bold border-b-2 flex items-center gap-2 transition-colors whitespace-nowrap ${
                  activeTab === 'hr_dispatch'
                    ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                <Mail size={18} />
                {t('miles.tab_hr_dispatch')}
              </button>

              <button
                onClick={() => setActiveTab('history')}
                className={`px-4 py-3 text-sm font-bold border-b-2 flex items-center gap-2 transition-colors whitespace-nowrap ${
                  activeTab === 'history'
                    ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                <FileSpreadsheet size={18} />
                {t('miles.tab_history')}
              </button>

              <button
                onClick={() => setActiveTab('settings')}
                className={`px-4 py-3 text-sm font-bold border-b-2 flex items-center gap-2 transition-colors whitespace-nowrap ${
                  activeTab === 'settings'
                    ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                <Settings size={18} />
                {t('miles.tab_settings')}
              </button>
            </>
          )}
        </div>

        {/* TAB 1: DRIVE LOG */}
        {activeTab === 'trips' && (
          <div className="space-y-4">
            {/* Filter Bar */}
            <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 flex flex-col md:flex-row gap-4 items-center justify-between">
              <div className="flex items-center gap-3 w-full md:w-auto">
                <div className="relative flex-1 md:w-64">
                  <Search size={16} className="absolute left-3 top-3 text-slate-400" />
                  <input
                    type="text"
                    placeholder={t('miles.search_placeholder')}
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-medium focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <select
                  value={statusFilter}
                  onChange={e => setStatusFilter(e.target.value)}
                  className="px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-semibold"
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
                    className="px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-semibold text-blue-600 dark:text-blue-400"
                  >
                    <option value="all">{t('miles.all_supervisors')}</option>
                    {supervisorsList.map(sup => (
                      <option key={sup.id} value={sup.id}>
                        {sup.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span>{filteredTrips.length} {t('miles.trips_found')}</span>
              </div>
            </div>

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
                        const r = Number(trip.rate_per_mile) || 0.725
                        const p = Number(trip.parking_amount) || 0
                        const to = Number(trip.tolls_amount) || 0
                        const tot = (m * r) + p + to

                        return (
                          <tr key={trip.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                            <td className="py-3.5 px-4 font-semibold text-slate-900 dark:text-white whitespace-nowrap">
                              {trip.trip_date} {trip.start_time && <span className="text-[11px] text-slate-400 font-normal">({trip.start_time})</span>}
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
                  const r = Number(trip.rate_per_mile) || 0.725
                  const p = Number(trip.parking_amount) || 0
                  const to = Number(trip.tolls_amount) || 0
                  const tot = (m * r) + p + to

                  return (
                    <div key={trip.id} className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 shadow-sm space-y-2.5">
                      {/* Top Row: Date + Status + Actions */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-slate-900 dark:text-white">{trip.trip_date}</span>
                          {trip.start_time && <span className="text-[10px] text-slate-400">({trip.start_time})</span>}
                        </div>
                        <div className="flex items-center gap-1.5">
                          {trip.status === 'submitted_hr' && (
                            <span className="px-2 py-0.5 rounded-md text-[9px] font-bold bg-purple-100 text-purple-700 dark:bg-purple-950/60 dark:text-purple-400">{t('miles.badge_submitted_hr')}</span>
                          )}
                          {trip.status === 'pending' && (
                            <span className="px-2 py-0.5 rounded-md text-[9px] font-bold bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400">{t('miles.badge_pending')}</span>
                          )}
                          {trip.status === 'approved' && (
                            <span className="px-2 py-0.5 rounded-md text-[9px] font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400">{t('miles.badge_approved')}</span>
                          )}
                          {trip.status === 'paid' && (
                            <span className="px-2 py-0.5 rounded-md text-[9px] font-bold bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-400">{t('miles.badge_paid')}</span>
                          )}
                          {isAdmin && trip.status === 'pending' && (
                            <button onClick={() => handleUpdateStatus(trip.id, 'approved')} className="p-1 text-emerald-600 rounded">
                              <CheckCircle2 size={14} />
                            </button>
                          )}
                          {(trip.status === 'pending' || isAdmin) && (
                            <button onClick={() => handleDeleteTrip(trip.id)} className="p-1 text-red-500 rounded">
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Route */}
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800 dark:text-slate-200">
                        <MapPin size={12} className="text-emerald-500 shrink-0" />
                        <span className="truncate">{trip.origin_name?.replace('Tacos Gavilan ', '')}</span>
                        <span className="text-slate-400 shrink-0">→</span>
                        <span className="truncate">{trip.destination_name?.replace('Tacos Gavilan ', '')}</span>
                        {trip.is_round_trip && (
                          <span className="text-[9px] bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-400 px-1 py-0.5 rounded font-black shrink-0">
                            {t('miles.badge_round_trip')}
                          </span>
                        )}
                      </div>

                      {/* Supervisor + Purpose */}
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-slate-500 dark:text-slate-400 font-medium">{trip.supervisor_name}</span>
                        <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400">
                          {trip.purpose || 'Business'}
                        </span>
                      </div>

                      {/* Bottom: Miles + Amount */}
                      <div className="flex items-center justify-between pt-1 border-t border-slate-100 dark:border-slate-800">
                        <div className="text-xs">
                          <span className="font-bold text-blue-600 dark:text-blue-400">{m.toFixed(2)} mi</span>
                          <span className="text-slate-400 mx-1">×</span>
                          <span className="text-slate-500">${r.toFixed(3)}</span>
                        </div>
                        <span className="text-sm font-black text-emerald-600 dark:text-emerald-400">
                          ${tot.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  )
                })
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
              <div className="space-y-3">
                <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
                  {t('miles.payroll_period')}
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="text-[10px] text-slate-400 block mb-1">{t('miles.from')}</span>
                    <input
                      type="date"
                      value={dateRange.start}
                      onChange={e => setDateRange(prev => ({ ...prev, start: e.target.value }))}
                      className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-semibold"
                    />
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 block mb-1">{t('miles.to')}</span>
                    <input
                      type="date"
                      value={dateRange.end}
                      onChange={e => setDateRange(prev => ({ ...prev, end: e.target.value }))}
                      className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-semibold"
                    />
                  </div>
                </div>
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

      {/* Modal for Logging Trip */}
      <TripModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSave={handleSaveTrip}
        stores={storesList}
        distances={distances}
        supervisors={supervisorsList}
        currentRate={currentRate}
        currentUser={currentUser}
        isAdmin={isAdmin}
      />
    </div>
  )
}
