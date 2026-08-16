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

import React, { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X, Car, MapPin, ArrowRight, RotateCw, DollarSign, Gauge,
  FileText, CheckCircle, User, Navigation, LocateFixed, ExternalLink, Compass
} from 'lucide-react'
import { useLanguage } from '@/lib/i18n'
import dynamic from 'next/dynamic'

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

const FALLBACK_STORE_COORDS: Record<string, { lat: number; lng: number; address: string }> = {
  'Tacos Gavilan LA Central': { lat: 33.9947, lng: -118.2784, address: '4801 S Central Ave, Los Angeles, CA 90011' },
  'Tacos Gavilan LA Broadway': { lat: 34.0152, lng: -118.2736, address: '4363 S Broadway, Los Angeles, CA 90037' },
  'Tacos Gavilan Slauson': { lat: 33.9892, lng: -118.2560, address: '200 W Slauson Ave, Los Angeles, CA 90003' },
  'Tacos Gavilan Hollywood': { lat: 34.0983, lng: -118.3267, address: '7083 Sunset Blvd, Los Angeles, CA 90028' },
  'Tacos Gavilan Lynwood': { lat: 33.9248, lng: -118.2045, address: '3740 E Imperial Hwy, Lynwood, CA 90262' },
  'Tacos Gavilan Huntington Park': { lat: 33.9818, lng: -118.2251, address: '2652 Florence Ave, Huntington Park, CA 90255' },
  'Tacos Gavilan Bell': { lat: 33.9806, lng: -118.1867, address: '4406 E Florence Ave, Bell, CA 90201' },
  'Tacos Gavilan Downey': { lat: 33.9312, lng: -118.1251, address: '12051 Paramount Blvd, Downey, CA 90242' },
  'Tacos Gavilan Norwalk': { lat: 33.9015, lng: -118.0818, address: '12539 Rosecrans Ave, Norwalk, CA 90650' },
  'Tacos Gavilan Santa Ana': { lat: 33.7456, lng: -117.8678, address: '801 W 17th St, Santa Ana, CA 92706' },
  'Tacos Gavilan La Puente': { lat: 34.0321, lng: -117.9421, address: '13009 Valley Blvd, La Puente, CA 91746' },
  'Tacos Gavilan Azusa': { lat: 34.1336, lng: -117.9076, address: '122 N Azusa Ave, Azusa, CA 91702' },
  'Tacos Gavilan West Covina': { lat: 34.0412, lng: -117.9011, address: '2330 S Azusa Ave, West Covina, CA 91792' },
  'Tacos Gavilan South Gate': { lat: 33.9452, lng: -118.1812, address: '8940 Garfield Ave, South Gate, CA 90280' },
  'Tacos Gavilan Rialto': { lat: 34.1065, lng: -117.3701, address: '240 W Baseline Rd, Rialto, CA 92376' },
  'Bodega Central': { lat: 34.00445, lng: -118.20436, address: '5182 Malabar St, Vernon, CA 90058' },
  'Oficina Corporativa': { lat: 33.9947, lng: -118.2784, address: '5304 S Broadway, Los Angeles, CA 90037' }
}

function haversineMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.8
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

export default function TripModal({
  isOpen,
  onClose,
  onSave,
  stores = [],
  distances = [],
  supervisors = [],
  currentRate = 0.725,
  currentUser,
  isAdmin = false,
  editingTrip = null
}: TripModalProps) {
  const { t, language } = useLanguage()

  const [selectedSupervisorId, setSelectedSupervisorId] = useState<string>(currentUser.id)
  const [tripDate, setTripDate] = useState<string>(new Date().toISOString().slice(0, 10))
  const [startTime, setStartTime] = useState<string>('')
  const [originType, setOriginType] = useState<'store' | 'bodega' | 'office' | 'home' | 'custom'>('store')
  const [originName, setOriginName] = useState<string>('Tacos Gavilan LA Central')
  const [destinationType, setDestinationType] = useState<'store' | 'bodega' | 'office' | 'home' | 'custom'>('store')
  const [destinationName, setDestinationName] = useState<string>('Tacos Gavilan LA Broadway')
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
  const [storeCoordsMap, setStoreCoordsMap] = useState<Record<string, { lat: number; lng: number; address: string }>>(FALLBACK_STORE_COORDS)

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

  // Synchronize state when modal opens or editingTrip changes
  useEffect(() => {
    if (!isOpen) return

    if (editingTrip) {
      setSelectedSupervisorId(editingTrip.supervisor_id || currentUser.id)
      setTripDate(editingTrip.trip_date || new Date().toISOString().slice(0, 10))
      setStartTime(editingTrip.start_time || '')
      setOriginType(editingTrip.origin_type || 'store')
      setOriginName(editingTrip.origin_name || 'Tacos Gavilan LA Central')
      setDestinationType(editingTrip.destination_type || 'store')
      setDestinationName(editingTrip.destination_name || 'Tacos Gavilan LA Broadway')
      setIsRoundTrip(Boolean(editingTrip.is_round_trip))
      setPurpose(editingTrip.purpose || 'Business')
      setPurposeNotes(editingTrip.purpose_notes || '')
      setOdometerStart(editingTrip.odometer_start !== null && editingTrip.odometer_start !== undefined ? String(editingTrip.odometer_start) : '')
      setOdometerEnd(editingTrip.odometer_end !== null && editingTrip.odometer_end !== undefined ? String(editingTrip.odometer_end) : '')
      setDistanceMiles(Number(editingTrip.distance_miles) || 0)
      setParkingAmount(Number(editingTrip.parking_amount) || 0)
      setTollsAmount(Number(editingTrip.tolls_amount) || 0)
    } else {
      setSelectedSupervisorId(currentUser.id)
      setTripDate(new Date().toISOString().slice(0, 10))
      setStartTime('')
      setOriginType('store')
      setOriginName('Tacos Gavilan LA Central')
      setDestinationType('store')
      setDestinationName('Tacos Gavilan LA Broadway')
      setIsRoundTrip(false)
      setPurpose('Business')
      setPurposeNotes('')
      setOdometerStart('')
      setOdometerEnd('')
      setDistanceMiles(2.9)
      setParkingAmount(0)
      setTollsAmount(0)
    }
  }, [isOpen, editingTrip, currentUser])

  const [isCalculatingMap, setIsCalculatingMap] = useState<boolean>(false)
  const [mapRouteNote, setMapRouteNote] = useState<string>('')

  // Auto-calculate distance when origin/destination change or matrix matches
  useEffect(() => {
    if (!originName || !destinationName) return

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
  const detectClosestStore = (target: 'origin' | 'dest') => {
    if (typeof window === 'undefined' || !navigator.geolocation) {
      alert(t('miles.gps_not_supported'))
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
            const d = haversineMiles(latitude, longitude, c.lat, c.lng)
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
        alert(t('miles.gps_permission_denied'))
        setDetectingGps(null)
      },
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }

  // External Navigation Launchers
  const getOrigAddress = () => storeCoordsMap[originName]?.address || originName
  const getDestAddress = () => storeCoordsMap[destinationName]?.address || destinationName

  const handleLaunchGoogleMaps = () => {
    const url = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(getOrigAddress())}&destination=${encodeURIComponent(getDestAddress())}&travelmode=driving`
    window.open(url, '_blank')
  }

  const handleLaunchAppleMaps = () => {
    const url = `http://maps.apple.com/?saddr=${encodeURIComponent(getOrigAddress())}&daddr=${encodeURIComponent(getDestAddress())}&dirflg=d`
    window.open(url, '_blank')
  }

  const handleLaunchWaze = () => {
    const destCoord = storeCoordsMap[destinationName]
    const url = destCoord?.lat && destCoord?.lng
      ? `https://waze.com/ul?ll=${destCoord.lat},${destCoord.lng}&navigate=yes`
      : `https://waze.com/ul?q=${encodeURIComponent(getDestAddress())}`
    window.open(url, '_blank')
  }

  // Total Reimbursement calculation
  const totalMilesCalculated = isRoundTrip ? distanceMiles * 2 : distanceMiles
  const mileageValue = totalMilesCalculated * currentRate
  const totalReimbursement = mileageValue + (Number(parkingAmount) || 0) + (Number(tollsAmount) || 0)

  const handleSaveAndNavigate = async (e: React.FormEvent) => {
    e.preventDefault()
    await handleSubmit(e)
    const isIOS = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent)
    if (isIOS) {
      handleLaunchAppleMaps()
    } else {
      handleLaunchGoogleMaps()
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!distanceMiles || distanceMiles <= 0) return

    // Find targeted supervisor profile if selected
    const targetSupervisor = supervisors.find(s => s.id === selectedSupervisorId) || {
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
        start_time: startTime || null,
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
      onClose()
    } catch (err) {
      console.error('Error saving trip modal:', err)
    } finally {
      setSaving(false)
    }
  }

  if (!isOpen) return null

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl w-full max-w-xl overflow-hidden"
        >
          {/* Header */}
          <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 text-white p-5 flex items-center justify-between border-b border-slate-700">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-blue-600/30 border border-blue-400/30 rounded-xl text-blue-400">
                <Car size={24} />
              </div>
              <div>
                <h3 className="text-lg font-bold">
                  {editingTrip ? t('miles.modal_edit_title') : t('miles.modal_title')}
                </h3>
                <p className="text-xs text-slate-400">
                  {editingTrip ? t('miles.modal_edit_subtitle') : t('miles.modal_subtitle')}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              <X size={20} />
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="p-6 space-y-5 max-h-[80vh] overflow-y-auto">
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
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  {t('miles.time_optional')}
                </label>
                <input
                  type="text"
                  placeholder="02:30 PM"
                  value={startTime}
                  onChange={e => setStartTime(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                />
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

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {/* Origin */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                      {t('miles.origin_start')}
                    </label>
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
                  <select
                    value={originName}
                    onChange={e => setOriginName(e.target.value)}
                    className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                  >
                    {availableLocations.map(loc => (
                      <option key={`orig-${loc}`} value={loc}>
                        {loc}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Destination */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                      {t('miles.destination_end')}
                    </label>
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
                  <select
                    value={destinationName}
                    onChange={e => setDestinationName(e.target.value)}
                    className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                  >
                    {availableLocations.map(loc => (
                      <option key={`dest-${loc}`} value={loc}>
                        {loc}
                      </option>
                    ))}
                  </select>
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
                  onClick={handleLaunchGoogleMaps}
                  className="flex items-center justify-center gap-1.5 py-2 px-2 bg-slate-800/90 hover:bg-slate-700 text-white rounded-lg text-xs font-bold border border-slate-600 transition-all active:scale-95 shadow-sm"
                >
                  <span>🚗</span>
                  <span className="truncate">Google Maps</span>
                </button>

                <button
                  type="button"
                  onClick={handleLaunchAppleMaps}
                  className="flex items-center justify-center gap-1.5 py-2 px-2 bg-slate-800/90 hover:bg-slate-700 text-white rounded-lg text-xs font-bold border border-slate-600 transition-all active:scale-95 shadow-sm"
                >
                  <span>🗺️</span>
                  <span className="truncate">Apple Maps</span>
                </button>

                <button
                  type="button"
                  onClick={handleLaunchWaze}
                  className="flex items-center justify-center gap-1.5 py-2 px-2 bg-slate-800/90 hover:bg-slate-700 text-white rounded-lg text-xs font-bold border border-slate-600 transition-all active:scale-95 shadow-sm"
                >
                  <span>🚙</span>
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

            {/* Buttons */}
            <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors text-center"
              >
                {t('common.cancel')}
              </button>

              <button
                type="button"
                disabled={saving}
                onClick={handleSaveAndNavigate}
                className="px-4 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white rounded-xl text-sm font-bold shadow-lg shadow-emerald-600/30 flex items-center justify-center gap-1.5 transition-all disabled:opacity-50"
              >
                {saving ? <RotateCw size={16} className="animate-spin" /> : <Navigation size={16} />}
                {t('miles.save_and_navigate')}
              </button>

              <button
                type="submit"
                disabled={saving}
                className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-bold shadow-lg shadow-blue-600/30 flex items-center justify-center gap-2 transition-all disabled:opacity-50"
              >
                {saving ? (
                  <RotateCw size={16} className="animate-spin" />
                ) : (
                  <CheckCircle size={16} />
                )}
                {editingTrip ? t('miles.btn_update_trip') : t('miles.save_trip')}
              </button>
            </div>
          </form>
        </motion.div>
      </div>
    </AnimatePresence>
  )
}
