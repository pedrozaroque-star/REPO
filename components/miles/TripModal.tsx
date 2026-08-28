'use client'

/**
 * @module TripModal
 * @description Modal component to create or edit supervisor mileage trips in MilesIQ.
 * @businessRules
 * - Automatically calculates reimbursement total using distance_miles, rate_per_mile, parking_amount, and tolls_amount.
 * - Auto-suggests distance when origin and destination match known store pairs in store_distances matrix.
 * - Dynamically lists all active stores from Stores module (/tiendas) and active supervisors from Users module (/usuarios).
 * - Supports Round Trip doubling and optional odometer inputs.
 * - Includes an interactive route map showing the visual path between origin and destination.
 * @dataFlow Component state -> API POST/PUT /api/miles -> Parent callback.
 */

import React, { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X, Car, MapPin, ArrowRight, RotateCw, DollarSign, Gauge,
  FileText, CheckCircle, User, Navigation, LocateFixed, ExternalLink, Compass, Clock
} from 'lucide-react'
import { useLanguage } from '@/lib/i18n'
import dynamic from 'next/dynamic'
import { getCaliforniaBusinessDate, getCaliforniaTime } from '@/lib/business-date'
import { CANONICAL_STORE_COORDINATES, haversineDistanceMiles } from '@/lib/store-coordinates'

// Dynamic import to prevent SSR issues with Google Maps
const RouteMap = dynamic(() => import('@/components/miles/RouteMap'), {
  ssr: false,
  loading: () => <div className="h-[180px] sm:h-[220px] w-full bg-slate-100 dark:bg-slate-800 rounded-xl animate-pulse" />
})

interface StoreOption {
  id: string
  name: string
}

interface DistanceOption {
  origin_name: string
  destination_name: string
  distance_miles: number
  notes?: string
}

interface SupervisorOption {
  id: string
  name: string
  email: string
}

interface TripModalProps {
  isOpen: boolean
  onClose: () => void
  onSave: (tripData: any) => Promise<void>
  stores: StoreOption[]
  distances: DistanceOption[]
  supervisors?: SupervisorOption[]
  currentRate: number
  currentUser: {
    id: string
    name: string
    email: string
  }
  isAdmin?: boolean
  editingTrip?: any | null
}

const INITIAL_STORE_COORDS: Record<string, { lat: number; lng: number; address: string }> = (() => {
  const map: Record<string, { lat: number; lng: number; address: string }> = {}
  Object.entries(CANONICAL_STORE_COORDINATES).forEach(([k, v]) => {
    map[k] = { lat: v.lat, lng: v.lng, address: `${v.address}, ${v.city}, ${v.state} ${v.zip_code}`.trim() }
    if (v.shortName && v.shortName !== k) {
      map[v.shortName] = map[k]
    }
  })
  return map
})()

export default function TripModal({
  isOpen,
  onClose,
  onSave,
  stores = [],
  distances = [],
  supervisors = [],
  currentRate = 0.76,
  currentUser,
  isAdmin = false,
  editingTrip = null
}: TripModalProps) {
  const { t, language } = useLanguage()

  const [selectedSupervisorId, setSelectedSupervisorId] = useState<string>(currentUser.id)
  const [tripDate, setTripDate] = useState<string>(getCaliforniaBusinessDate())
  const [startTime, setStartTime] = useState<string>(getCaliforniaTime())
  const [originType, setOriginType] = useState<'store' | 'bodega' | 'office' | 'home' | 'custom'>('store')
  const [originName, setOriginName] = useState<string>('Tacos Gavilan LA Central')
  const [originMode, setOriginMode] = useState<'store' | 'custom'>('store')
  const [destinationType, setDestinationType] = useState<'store' | 'bodega' | 'office' | 'home' | 'custom'>('store')
  const [destinationName, setDestinationName] = useState<string>('Tacos Gavilan LA Broadway')
  const [destMode, setDestMode] = useState<'store' | 'custom'>('store')
  const [isRoundTrip, setIsRoundTrip] = useState<boolean>(false)
  const [purpose, setPurpose] = useState<'Business' | 'Personal' | 'Commute'>('Business')
  const [purposeNotes, setPurposeNotes] = useState<string>('')
  const [odometerStart, setOdometerStart] = useState<string>('')
  const [odometerEnd, setOdometerEnd] = useState<string>('')
  const [distanceMiles, setDistanceMiles] = useState<number>(2.9)
  const [parkingAmount, setParkingAmount] = useState<number>(0)
  const [tollsAmount, setTollsAmount] = useState<number>(0)
  const [saving, setSaving] = useState<boolean>(false)

  // GPS & Navigation state
  const [detectingGps, setDetectingGps] = useState<'origin' | 'dest' | null>(null)
  const [gpsFeedback, setGpsFeedback] = useState<string>('')
  const [storeCoordsMap, setStoreCoordsMap] = useState<Record<string, { lat: number; lng: number; address: string }>>(INITIAL_STORE_COORDS)

  useEffect(() => {
    fetch('/api/miles/store-coordinates')
      .then(res => res.json())
      .then(data => {
        if (data.coordinates && Object.keys(data.coordinates).length > 0) {
          setStoreCoordsMap(prev => ({ ...prev, ...data.coordinates }))
        }
      })
      .catch(() => {})
  }, [])

  // Default preset store options if stores prop is empty
  const storePresets = [
    'Tacos Gavilan LA Central',
    'Tacos Gavilan LA Broadway',
    'Tacos Gavilan Slauson',
    'Tacos Gavilan Hollywood',
    'Tacos Gavilan Lynwood',
    'Tacos Gavilan Huntington Park',
    'Tacos Gavilan Bell',
    'Tacos Gavilan Downey',
    'Tacos Gavilan Norwalk',
    'Tacos Gavilan Santa Ana',
    'Tacos Gavilan La Puente',
    'Tacos Gavilan Azusa',
    'Tacos Gavilan West Covina',
    'Tacos Gavilan South Gate',
    'Tacos Gavilan Rialto',
    'Bodega Central',
    'Oficina Corporativa'
  ]

  const availableLocations = stores.length > 0 ? stores.map(s => s.name) : storePresets
  const isInitialEditLoadRef = useRef(false)

  // Synchronize state when modal opens or editingTrip changes
  useEffect(() => {
    if (!isOpen) return

    if (editingTrip) {
      isInitialEditLoadRef.current = true
      const origName = editingTrip.origin_name || 'Tacos Gavilan LA Central'
      const dstName = editingTrip.destination_name || 'Tacos Gavilan LA Broadway'
      const isOrigCustom = editingTrip.origin_type === 'custom' || !availableLocations.includes(origName)
      const isDestCustom = editingTrip.destination_type === 'custom' || !availableLocations.includes(dstName)

      setSelectedSupervisorId(editingTrip.supervisor_id || currentUser.id)
      setTripDate(editingTrip.trip_date || getCaliforniaBusinessDate())
      setStartTime(editingTrip.start_time || '')
      setOriginType(isOrigCustom ? 'custom' : (editingTrip.origin_type || 'store'))
      setOriginName(origName)
      setOriginMode(isOrigCustom ? 'custom' : 'store')
      setDestinationType(isDestCustom ? 'custom' : (editingTrip.destination_type || 'store'))
      setDestinationName(dstName)
      setDestMode(isDestCustom ? 'custom' : 'store')
      setIsRoundTrip(Boolean(editingTrip.is_round_trip))
      setPurpose(editingTrip.purpose || 'Business')
      setPurposeNotes(editingTrip.purpose_notes || '')
      setOdometerStart(editingTrip.odometer_start !== null && editingTrip.odometer_start !== undefined ? String(editingTrip.odometer_start) : '')
      setOdometerEnd(editingTrip.odometer_end !== null && editingTrip.odometer_end !== undefined ? String(editingTrip.odometer_end) : '')
      const baseMiles = Number(editingTrip.distance_miles) || 0
      setDistanceMiles(editingTrip.is_round_trip ? parseFloat((baseMiles / 2).toFixed(2)) : baseMiles)
      setParkingAmount(Number(editingTrip.parking_amount) || 0)
      setTollsAmount(Number(editingTrip.tolls_amount) || 0)
    } else {
      isInitialEditLoadRef.current = false
      setSelectedSupervisorId(currentUser.id)
      setTripDate(getCaliforniaBusinessDate())
      setStartTime(getCaliforniaTime())
      setOriginType('store')
      setOriginName('Tacos Gavilan Lynwood')
      setOriginMode('store')
      setDestinationType('store')
      setDestinationName('Tacos Gavilan South Gate')
      setDestMode('store')
      setIsRoundTrip(false)
      setPurpose('Business')
      setPurposeNotes('')
      setOdometerStart('')
      setOdometerEnd('')
      setDistanceMiles(3.0)
      setParkingAmount(0)
      setTollsAmount(0)

      // Auto-detect current physical location on modal open
      if (typeof window !== 'undefined' && navigator.geolocation) {
        setTimeout(() => {
          detectClosestStore('origin', true)
        }, 150)
      }
    }
  }, [isOpen, editingTrip, currentUser])

  const [isCalculatingMap, setIsCalculatingMap] = useState<boolean>(false)
  const [mapRouteNote, setMapRouteNote] = useState<string>('')

  // Auto-calculate distance when origin/destination change or matrix matches
  useEffect(() => {
    if (!originName || !destinationName) return

    if (isInitialEditLoadRef.current) {
      isInitialEditLoadRef.current = false
      return
    }

    // If odometer end and start are valid, calculate from odometer
    if (odometerStart && odometerEnd) {
      const oStart = parseFloat(odometerStart)
      const oEnd = parseFloat(odometerEnd)
      if (!isNaN(oStart) && !isNaN(oEnd) && oEnd >= oStart) {
        setDistanceMiles(parseFloat((oEnd - oStart).toFixed(2)))
        setMapRouteNote('')
        return
      }
    }

    // Lookup in distances matrix
    const match = distances.find(
      d =>
        (d.origin_name.toLowerCase() === originName.toLowerCase() && d.destination_name.toLowerCase() === destinationName.toLowerCase()) ||
        (d.origin_name.toLowerCase() === destinationName.toLowerCase() && d.destination_name.toLowerCase() === originName.toLowerCase())
    )

    if (match) {
      setDistanceMiles(match.distance_miles)
      setMapRouteNote(match.notes || t('miles.standard_matrix'))
    } else {
      // Trigger automatic map calculation if pair not in matrix
      autoCalculateFromMap(originName, destinationName)
    }
  }, [originName, destinationName, odometerStart, odometerEnd, distances])

  const autoCalculateFromMap = async (orig: string, dest: string) => {
    if (!orig || !dest || orig.trim().toLowerCase() === dest.trim().toLowerCase()) {
      setMapRouteNote('')
      return
    }
    try {
      setIsCalculatingMap(true)
      const res = await fetch(`/api/miles/calculate-distance?origin=${encodeURIComponent(orig)}&destination=${encodeURIComponent(dest)}`)
      const json = await res.json()
      if (json.success && json.distance_miles > 0) {
        setDistanceMiles(json.distance_miles)
        setMapRouteNote(json.notes || t('miles.traffic_route'))
      }
    } catch (err) {
      console.warn('Error auto-calculating map distance:', err)
    } finally {
      setIsCalculatingMap(false)
    }
  }

  // GPS Auto-detection Handler
  const detectClosestStore = (target: 'origin' | 'dest', silent = false) => {
    if (typeof window === 'undefined' || !navigator.geolocation) {
      if (!silent) alert(t('miles.gps_not_supported'))
      return
    }

    setDetectingGps(target)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords
        let closestName = ''
        let minDistance = Infinity

        Object.entries(storeCoordsMap).forEach(([name, c]) => {
          if (c.lat && c.lng) {
            const d = haversineDistanceMiles(latitude, longitude, c.lat, c.lng)
            if (d < minDistance) {
              minDistance = d
              closestName = name
            }
          }
        })

        if (closestName) {
          if (target === 'origin') {
            setOriginName(closestName)
          } else {
            setDestinationName(closestName)
          }
          setGpsFeedback(`📍 ${closestName} (${minDistance.toFixed(2)} mi)`)
          setTimeout(() => setGpsFeedback(''), 6000)
        }
        setDetectingGps(null)
      },
      (err) => {
        console.warn('GPS error:', err)
        if (!silent) alert(t('miles.gps_permission_denied'))
        setDetectingGps(null)
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
    )
  }

  // External Navigation Launchers (Save trip first, then launch navigation)
  const getOrigAddress = () => storeCoordsMap[originName]?.address || originName
  const getDestAddress = () => storeCoordsMap[destinationName]?.address || destinationName

  const executeSaveTrip = async (): Promise<boolean> => {
    if (!distanceMiles || distanceMiles <= 0) return false

    // Find targeted supervisor profile if selected
    const targetSupervisor = supervisors.find(s => String(s.id) === String(selectedSupervisorId)) || {
      id: currentUser.id,
      name: currentUser.name,
      email: currentUser.email
    }

    try {
      setSaving(true)
      const payload: any = {
        supervisor_id: targetSupervisor.id,
        supervisor_name: targetSupervisor.name,
        supervisor_email: targetSupervisor.email,
        trip_date: tripDate,
        start_time: (startTime && startTime.trim() !== '') ? startTime.trim() : getCaliforniaTime(),
        origin_type: originType,
        origin_name: originName,
        destination_type: destinationType,
        destination_name: destinationName,
        is_round_trip: isRoundTrip,
        purpose,
        purpose_notes: purposeNotes,
        odometer_start: odometerStart ? parseFloat(odometerStart) : null,
        odometer_end: odometerEnd ? parseFloat(odometerEnd) : null,
        distance_miles: distanceMiles,
        rate_per_mile: currentRate,
        parking_amount: parkingAmount,
        tolls_amount: tollsAmount
      }

      if (editingTrip?.id) {
        payload.id = editingTrip.id
      }

      await onSave(payload)

      // Sync active store in localStorage for the passive GPS tracker
      if (String(selectedSupervisorId) === String(currentUser.id) && tripDate === getCaliforniaBusinessDate()) {
        const finalActiveStore = isRoundTrip ? originName : destinationName
        if (finalActiveStore) {
          localStorage.setItem('teg_supervisor_active_store', finalActiveStore)
          localStorage.setItem('teg_supervisor_active_store_date', getCaliforniaBusinessDate())
        }
      }

      onClose()
      return true
    } catch (err) {
      console.error('Error saving trip modal:', err)
      return false
    } finally {
      setSaving(false)
    }
  }

  const handleLaunchGoogleMaps = async () => {
    const dest = encodeURIComponent(getDestAddress())
    // Omitting origin and adding dir_action=navigate forces Google Maps to start LIVE turn-by-turn navigation from the phone's GPS position
    const url = `https://www.google.com/maps/dir/?api=1&destination=${dest}&travelmode=driving&dir_action=navigate`
    const saved = await executeSaveTrip()
    if (saved) {
      window.location.href = url
    }
  }

  const handleLaunchAppleMaps = async () => {
    const dest = encodeURIComponent(getDestAddress())
    // Omitting saddr forces Apple Maps to navigate live from the phone's GPS position
    const url = `http://maps.apple.com/?daddr=${dest}&dirflg=d`
    const saved = await executeSaveTrip()
    if (saved) {
      window.location.href = url
    }
  }

  const handleLaunchWaze = async () => {
    const destCoord = storeCoordsMap[destinationName]
    const url = destCoord?.lat && destCoord?.lng
      ? `https://waze.com/ul?ll=${destCoord.lat},${destCoord.lng}&navigate=yes`
      : `https://waze.com/ul?q=${encodeURIComponent(getDestAddress())}&navigate=yes`
    const saved = await executeSaveTrip()
    if (saved) {
      window.location.href = url
    }
  }

  // Total Reimbursement calculation
  const totalMilesCalculated = isRoundTrip ? distanceMiles * 2 : distanceMiles
  const mileageValue = totalMilesCalculated * currentRate
  const totalReimbursement = mileageValue + (Number(parkingAmount) || 0) + (Number(tollsAmount) || 0)

  const handleSaveAndNavigate = async (e: React.FormEvent) => {
    e.preventDefault()
    const isIOS = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent)
    if (isIOS) {
      await handleLaunchAppleMaps()
    } else {
      await handleLaunchGoogleMaps()
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    await executeSaveTrip()
  }

  if (!isOpen) return null

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 backdrop-blur-sm p-2 sm:p-4 overflow-y-auto">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl sm:rounded-3xl shadow-2xl w-full max-w-xl max-h-[94dvh] sm:max-h-[88vh] flex flex-col overflow-hidden"
        >
          {/* Header */}
          <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 text-white p-4 sm:p-5 flex items-center justify-between border-b border-slate-700 shrink-0">
            <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
              <div className="p-2 sm:p-2.5 bg-blue-600/30 border border-blue-400/30 rounded-xl text-blue-400 shrink-0">
                <Car size={22} className="sm:w-6 sm:h-6" />
              </div>
              <div className="min-w-0">
                <h3 className="text-base sm:text-lg font-bold truncate">
                  {editingTrip ? t('miles.modal_edit_title') : t('miles.modal_title')}
                </h3>
                <p className="text-[11px] sm:text-xs text-slate-400 truncate">
                  {editingTrip ? t('miles.modal_edit_subtitle') : t('miles.modal_subtitle')}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors shrink-0"
            >
              <X size={20} />
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
            {/* Scrollable Body */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 sm:space-y-5 overscroll-contain">
            {/* Supervisor Selector (Admins can select any supervisor; supervisors are fixed to themselves) */}
            {isAdmin && supervisors.length > 0 ? (
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1 flex items-center gap-1.5">
                  <User size={14} className="text-blue-500" />
                  {t('miles.supervisor_driver')}
                </label>
                <select
                  value={selectedSupervisorId}
                  onChange={e => setSelectedSupervisorId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-sm font-semibold focus:ring-2 focus:ring-blue-500"
                >
                  {supervisors.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.email || t('miles.no_email')})
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="bg-slate-50 dark:bg-slate-800/60 p-3 rounded-xl border border-slate-200 dark:border-slate-700/60 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded-lg">
                    <User size={15} />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-800 dark:text-slate-200">{currentUser.name}</div>
                    <div className="text-[11px] text-slate-400">{currentUser.email}</div>
                  </div>
                </div>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                  {t('miles.supervisor_driver')}
                </span>
              </div>
            )}

            {/* GPS Feedback Alert */}
            {gpsFeedback && (
              <div className="text-xs font-semibold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/60 p-2.5 rounded-xl border border-blue-200 dark:border-blue-800 flex items-center gap-2">
                <LocateFixed size={14} className="text-blue-500 shrink-0" />
                <span>{t('miles.gps_detected')} <strong>{gpsFeedback}</strong></span>
              </div>
            )}

            {/* Date & Time */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  {t('miles.date')}
                </label>
                <input
                  type="date"
                  value={tripDate}
                  onChange={e => setTripDate(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-sm font-medium focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400">
                    {t('miles.time_label')}
                  </label>
                  <button
                    type="button"
                    onClick={() => setStartTime(getCaliforniaTime())}
                    className="text-[11px] font-bold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 flex items-center gap-1 transition-colors"
                  >
                    <Clock size={11} />
                    {t('miles.time_now')}
                  </button>
                </div>
                <div className="relative">
                  <input
                    type="text"
                    placeholder="02:30 PM"
                    value={startTime}
                    onChange={e => setStartTime(e.target.value)}
                    className="w-full pl-8 pr-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-sm font-semibold text-slate-800 dark:text-slate-200 focus:ring-2 focus:ring-blue-500"
                  />
                  <Clock size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                </div>
              </div>
            </div>

            {/* Origin & Destination */}
            <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-200 dark:border-slate-700 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                  <MapPin size={14} className="text-blue-500" />
                  {t('miles.route_info')}
                </span>
                <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 px-2.5 py-1 rounded-md border border-blue-200 dark:border-blue-800">
                  <input
                    type="checkbox"
                    checked={isRoundTrip}
                    onChange={e => setIsRoundTrip(e.target.checked)}
                    className="rounded text-blue-600"
                  />
                  <RotateCw size={14} />
                  {t('miles.round_trip')}
                </label>
              </div>

              {mapRouteNote && (
                <div className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-3 py-1.5 rounded-lg border border-emerald-200 dark:border-emerald-800/50 flex items-center gap-1.5">
                  <span>🗺️</span>
                  <span>{mapRouteNote}</span>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Origin */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400">
                      {t('miles.origin_start')}
                    </label>
                    <div className="flex items-center gap-1 bg-slate-200/70 dark:bg-slate-700/70 p-0.5 rounded-lg text-[10px] font-bold">
                      <button
                        type="button"
                        onClick={() => {
                          setOriginMode('store')
                          setOriginType('store')
                          if (!availableLocations.includes(originName)) {
                            setOriginName('Tacos Gavilan Lynwood')
                          }
                        }}
                        className={`px-2 py-0.5 rounded-md transition-all ${
                          originMode === 'store'
                            ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs'
                            : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                        }`}
                      >
                        🏪 {t('miles.store_location')}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setOriginMode('custom')
                          setOriginType('custom')
                          if (availableLocations.includes(originName)) {
                            setOriginName('Home Depot')
                          }
                        }}
                        className={`px-2 py-0.5 rounded-md transition-all ${
                          originMode === 'custom'
                            ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs'
                            : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                        }`}
                      >
                        📍 {t('miles.custom_location')}
                      </button>
                    </div>
                  </div>

                  {originMode === 'store' ? (
                    <div className="space-y-1.5">
                      <select
                        value={originName}
                        onChange={e => setOriginName(e.target.value)}
                        className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-sm font-medium focus:ring-2 focus:ring-blue-500"
                      >
                        {availableLocations.map(loc => (
                          <option key={`orig-${loc}`} value={loc}>
                            {loc}
                          </option>
                        ))}
                      </select>
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={() => detectClosestStore('origin')}
                          disabled={detectingGps !== null}
                          title={t('miles.detect_gps_origin')}
                          className="text-[10px] font-bold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 bg-blue-50 dark:bg-blue-950/60 px-2 py-0.5 rounded border border-blue-200 dark:border-blue-800"
                        >
                          {detectingGps === 'origin' ? (
                            <RotateCw size={10} className="animate-spin" />
                          ) : (
                            <LocateFixed size={10} />
                          )}
                          {t('miles.detect_gps_origin')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <input
                        type="text"
                        placeholder={t('miles.custom_place_placeholder')}
                        value={originName}
                        onChange={e => setOriginName(e.target.value)}
                        className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-blue-300 dark:border-blue-700 rounded-lg text-sm font-semibold text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-blue-500 shadow-xs"
                        required
                      />
                      <div className="flex flex-wrap gap-1">
                        {[
                          { name: 'Home Depot', tag: 'Mantenimiento' },
                          { name: 'Restaurant Depot / Costco', tag: 'Suministros' },
                          { name: 'Banco (Wells Fargo / Chase)', tag: 'Depósito' },
                          { name: 'Clínica / Salubridad', tag: 'Salubridad' }
                        ].map(p => (
                          <button
                            key={`orig-chip-${p.name}`}
                            type="button"
                            onClick={() => {
                              setOriginName(p.name)
                              if (!purposeNotes) setPurposeNotes(p.tag)
                            }}
                            className="text-[10px] font-medium bg-slate-100 dark:bg-slate-800 hover:bg-blue-50 dark:hover:bg-blue-900/30 text-slate-700 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700 transition-colors"
                          >
                            {p.name.split(' ')[0]} {p.name.includes('Home') ? '🛠️' : p.name.includes('Costco') ? '🛒' : p.name.includes('Banco') ? '🏦' : '🏥'}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Destination */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400">
                      {t('miles.destination_end')}
                    </label>
                    <div className="flex items-center gap-1 bg-slate-200/70 dark:bg-slate-700/70 p-0.5 rounded-lg text-[10px] font-bold">
                      <button
                        type="button"
                        onClick={() => {
                          setDestMode('store')
                          setDestinationType('store')
                          if (!availableLocations.includes(destinationName)) {
                            setDestinationName('Tacos Gavilan South Gate')
                          }
                        }}
                        className={`px-2 py-0.5 rounded-md transition-all ${
                          destMode === 'store'
                            ? 'bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 shadow-xs'
                            : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                        }`}
                      >
                        🏪 {t('miles.store_location')}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDestMode('custom')
                          setDestinationType('custom')
                          if (availableLocations.includes(destinationName)) {
                            setDestinationName('Home Depot')
                          }
                        }}
                        className={`px-2 py-0.5 rounded-md transition-all ${
                          destMode === 'custom'
                            ? 'bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 shadow-xs'
                            : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                        }`}
                      >
                        📍 {t('miles.custom_location')}
                      </button>
                    </div>
                  </div>

                  {destMode === 'store' ? (
                    <div className="space-y-1.5">
                      <select
                        value={destinationName}
                        onChange={e => setDestinationName(e.target.value)}
                        className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-sm font-medium focus:ring-2 focus:ring-blue-500"
                      >
                        {availableLocations.map(loc => (
                          <option key={`dest-${loc}`} value={loc}>
                            {loc}
                          </option>
                        ))}
                      </select>
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={() => detectClosestStore('dest')}
                          disabled={detectingGps !== null}
                          title={t('miles.detect_gps_dest')}
                          className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-1 bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-200 dark:border-emerald-800"
                        >
                          {detectingGps === 'dest' ? (
                            <RotateCw size={10} className="animate-spin" />
                          ) : (
                            <LocateFixed size={10} />
                          )}
                          {t('miles.detect_gps_dest')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <input
                        type="text"
                        placeholder={t('miles.custom_place_placeholder')}
                        value={destinationName}
                        onChange={e => setDestinationName(e.target.value)}
                        className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-emerald-300 dark:border-emerald-700 rounded-lg text-sm font-semibold text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-emerald-500 shadow-xs"
                        required
                      />
                      <div className="flex flex-wrap gap-1">
                        {[
                          { name: 'Home Depot', tag: 'Mantenimiento' },
                          { name: 'Restaurant Depot / Costco', tag: 'Suministros' },
                          { name: 'Banco (Wells Fargo / Chase)', tag: 'Depósito' },
                          { name: 'Clínica / Salubridad', tag: 'Salubridad' }
                        ].map(p => (
                          <button
                            key={`dest-chip-${p.name}`}
                            type="button"
                            onClick={() => {
                              setDestinationName(p.name)
                              if (!purposeNotes) setPurposeNotes(p.tag)
                            }}
                            className="text-[10px] font-medium bg-slate-100 dark:bg-slate-800 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 text-slate-700 dark:text-slate-300 hover:text-emerald-600 dark:hover:text-emerald-400 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700 transition-colors"
                          >
                            {p.name.split(' ')[0]} {p.name.includes('Home') ? '🛠️' : p.name.includes('Costco') ? '🛒' : p.name.includes('Banco') ? '🏦' : '🏥'}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Route Map Preview */}
            <RouteMap
              originName={originName}
              destinationName={destinationName}
              distanceMiles={isRoundTrip ? distanceMiles * 2 : distanceMiles}
            />

            {/* External Navigation Shortcuts */}
            <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 text-white p-3 rounded-xl border border-slate-700 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-bold">
                  <Navigation size={13} className="text-blue-400" />
                  <span>{t('miles.launch_navigation')}</span>
                </div>
                <span className="text-[10px] text-slate-400 hidden sm:inline">{t('miles.navigation_desc')}</span>
              </div>

              <div className="grid grid-cols-3 gap-2 pt-0.5">
                <button
                  type="button"
                  disabled={saving}
                  onClick={handleLaunchGoogleMaps}
                  title={t('miles.open_google_maps')}
                  className="flex items-center justify-center gap-1.5 py-2 px-2 bg-slate-800/90 hover:bg-slate-700 text-white rounded-lg text-xs font-bold border border-slate-600 transition-all active:scale-95 shadow-sm disabled:opacity-50"
                >
                  {saving ? <RotateCw size={12} className="animate-spin text-blue-400" /> : <span>🚗</span>}
                  <span className="truncate">Google Maps</span>
                </button>

                <button
                  type="button"
                  disabled={saving}
                  onClick={handleLaunchAppleMaps}
                  title={t('miles.open_apple_maps')}
                  className="flex items-center justify-center gap-1.5 py-2 px-2 bg-slate-800/90 hover:bg-slate-700 text-white rounded-lg text-xs font-bold border border-slate-600 transition-all active:scale-95 shadow-sm disabled:opacity-50"
                >
                  {saving ? <RotateCw size={12} className="animate-spin text-blue-400" /> : <span>🗺️</span>}
                  <span className="truncate">Apple Maps</span>
                </button>

                <button
                  type="button"
                  disabled={saving}
                  onClick={handleLaunchWaze}
                  title={t('miles.open_waze')}
                  className="flex items-center justify-center gap-1.5 py-2 px-2 bg-slate-800/90 hover:bg-slate-700 text-white rounded-lg text-xs font-bold border border-slate-600 transition-all active:scale-95 shadow-sm disabled:opacity-50"
                >
                  {saving ? <RotateCw size={12} className="animate-spin text-blue-400" /> : <span>🚙</span>}
                  <span className="truncate">Waze</span>
                </button>
              </div>
            </div>

            {/* Distance & Odometer */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="col-span-1">
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  {t('miles.distance_miles_label')}
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="0.1"
                  value={distanceMiles}
                  onChange={e => setDistanceMiles(parseFloat(e.target.value) || 0)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-sm font-bold text-blue-600 dark:text-blue-400 focus:ring-2 focus:ring-blue-500"
                  required
                />
                <button
                  type="button"
                  onClick={() => autoCalculateFromMap(originName, destinationName)}
                  disabled={isCalculatingMap}
                  className="mt-1 text-[10px] font-bold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
                >
                  {isCalculatingMap ? (
                    <RotateCw size={10} className="animate-spin" />
                  ) : (
                    <span>✨ {t('miles.recalculate_map')}</span>
                  )}
                </button>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                  {t('miles.odometer_start')}
                </label>
                <input
                  type="number"
                  placeholder="e.g. 45200"
                  value={odometerStart}
                  onChange={e => setOdometerStart(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                  {t('miles.odometer_end')}
                </label>
                <input
                  type="number"
                  placeholder="e.g. 45206"
                  value={odometerEnd}
                  onChange={e => setOdometerEnd(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            {/* Parking & Tolls Expenses */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                  {t('miles.parking_usd')}
                </label>
                <input
                  type="number"
                  step="0.50"
                  min="0"
                  value={parkingAmount}
                  onChange={e => setParkingAmount(parseFloat(e.target.value) || 0)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                  {t('miles.tolls_usd')}
                </label>
                <input
                  type="number"
                  step="0.50"
                  min="0"
                  value={tollsAmount}
                  onChange={e => setTollsAmount(parseFloat(e.target.value) || 0)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            {/* Classification & Purpose Notes */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                  {t('miles.classification')}
                </label>
                <select
                  value={purpose}
                  onChange={e => setPurpose(e.target.value as any)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                >
                  <option value="Business">{t('miles.purpose_business')}</option>
                  <option value="Personal">{t('miles.purpose_personal')}</option>
                  <option value="Commute">{t('miles.purpose_commute')}</option>
                </select>
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                  {t('miles.notes_details')}
                </label>
                <input
                  type="text"
                  placeholder={t('miles.notes_placeholder')}
                  value={purposeNotes}
                  onChange={e => setPurposeNotes(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                />
                <div className="flex flex-wrap items-center gap-1.5 pt-1.5">
                  <span className="text-[10px] font-bold text-slate-400">{t('miles.quick_purposes')}</span>
                  {[
                    { label: t('miles.tag_maintenance'), text: 'Mantenimiento y reparación' },
                    { label: t('miles.tag_supplies'), text: 'Suministros de emergencia' },
                    { label: t('miles.tag_bank'), text: 'Depósito bancario / Caja fuerte' },
                    { label: t('miles.tag_health'), text: 'Trámite de salubridad / Clínica' },
                    { label: t('miles.tag_inspection'), text: 'Auditoría de calidad' }
                  ].map((tag, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setPurposeNotes(prev => prev ? `${prev} - ${tag.text}` : tag.text)}
                      className="text-[10px] font-medium bg-slate-100 dark:bg-slate-800 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 text-slate-700 dark:text-slate-300 hover:text-emerald-600 dark:hover:text-emerald-400 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700 transition-colors"
                    >
                      {tag.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Executive Reimbursement Card */}
            <div className="bg-gradient-to-r from-emerald-900/90 to-teal-900/90 border border-emerald-500/30 rounded-xl p-4 text-white flex items-center justify-between">
              <div>
                <span className="text-xs uppercase tracking-wider font-semibold text-emerald-300">
                  {t('miles.calculated_reimbursement')}
                </span>
                <div className="text-2xl font-black text-white mt-0.5">
                  ${totalReimbursement.toFixed(2)} USD
                </div>
                <div className="text-[11px] text-emerald-200/80">
                  {totalMilesCalculated.toFixed(2)} mi × ${currentRate.toFixed(3)}/mi
                  {parkingAmount > 0 ? ` + $${parkingAmount.toFixed(2)} parking` : ''}
                  {tollsAmount > 0 ? ` + $${tollsAmount.toFixed(2)} tolls` : ''}
                </div>
              </div>
              <div className="p-3 bg-white/10 rounded-xl">
                <DollarSign size={28} className="text-emerald-400" />
              </div>
            </div>
            {/* End of Scrollable Body */}
            </div>

            {/* Sticky Modal Footer */}
            <div className="p-3.5 sm:p-4 bg-slate-50 dark:bg-slate-900/90 border-t border-slate-200 dark:border-slate-800 shrink-0 flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2 sm:gap-2.5">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs sm:text-sm font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors text-center"
              >
                {t('common.cancel')}
              </button>

              {!editingTrip && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={handleSaveAndNavigate}
                  className="px-4 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white rounded-xl text-xs sm:text-sm font-bold shadow-lg shadow-emerald-600/30 flex items-center justify-center gap-1.5 transition-all disabled:opacity-50"
                >
                  {saving ? <RotateCw size={15} className="animate-spin" /> : <Navigation size={15} />}
                  <span>{t('miles.save_and_navigate')}</span>
                </button>
              )}

              <button
                type="submit"
                disabled={saving}
                className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs sm:text-sm font-bold shadow-lg shadow-blue-600/30 flex items-center justify-center gap-2 transition-all disabled:opacity-50"
              >
                {saving ? (
                  <RotateCw size={15} className="animate-spin" />
                ) : (
                  <CheckCircle size={15} />
                )}
                <span>{editingTrip ? t('miles.btn_update_trip') : t('miles.save_trip')}</span>
              </button>
            </div>
          </form>
        </motion.div>
      </div>
    </AnimatePresence>
  )
}
