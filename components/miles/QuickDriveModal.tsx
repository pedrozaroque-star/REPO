/**
 * @module components/miles/QuickDriveModal
 * @description Modal rápido de 1 toque "Ir a Tienda / Iniciar Navegación" para supervisores.
 * @businessRules
 * - Autodetecta la tienda de origen mediante GPS o permite seleccionarla rápidamente.
 * - Muestra la lista de las 15 sucursales de Tacos Gavilan + Bodega Central y Oficina Corporativa con sus distancias calculadas.
 * - Al tocar cualquier tienda, guarda de inmediato el viaje en MilesIQ y abre Google Maps/Apple Maps/Waze en modo navegación en vivo.
 * @dataFlow
 * - Conecta con /api/miles/checkin para persistir el viaje.
 * - Utiliza CANONICAL_STORE_COORDINATES y findClosestStore para la geolocalización.
 * @notes
 * - Elimina la fricción de captura manual asegurando que ningún recorrido quede sin registrar.
 */

'use client'

import React, { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Navigation,
  MapPin,
  Car,
  X,
  Search,
  CheckCircle2,
  ExternalLink,
  Compass,
  ArrowRight,
  Sparkles
} from 'lucide-react'
import { useLanguage } from '@/lib/i18n'
import {
  CANONICAL_STORE_COORDINATES,
  findClosestStore,
  normalizeStoreName,
  haversineDistanceMiles
} from '@/lib/store-coordinates'

interface QuickDriveModalProps {
  isOpen: boolean
  onClose: () => void
  currentUser: {
    id: string
    name: string
    email?: string
    role?: string
  }
  onTripLogged?: () => void
}

export default function QuickDriveModal({
  isOpen,
  onClose,
  currentUser,
  onTripLogged
}: QuickDriveModalProps) {
  const { t } = useLanguage()
  const [searchTerm, setSearchTerm] = useState('')
  const [originStore, setOriginStore] = useState<string>('Tacos Gavilan Lynwood')
  const [isLocating, setIsLocating] = useState(false)
  const [preferredApp, setPreferredApp] = useState<'google' | 'apple' | 'waze'>('google')
  const [isSaving, setIsSaving] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  // Load preferred map app from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('teg_preferred_nav_app')
    if (saved === 'apple' || saved === 'waze' || saved === 'google') {
      setPreferredApp(saved)
    }
  }, [])

  // Auto-detect origin GPS on modal open
  useEffect(() => {
    if (isOpen) {
      setSuccessMessage(null)
      setIsSaving(null)
      detectCurrentLocation()
    }
  }, [isOpen])

  const detectCurrentLocation = () => {
    if (!navigator.geolocation) return
    setIsLocating(true)
    navigator.geolocation.getCurrentPosition(
      pos => {
        const closest = findClosestStore(pos.coords.latitude, pos.coords.longitude)
        if (closest && closest.name) {
          setOriginStore(closest.name)
          localStorage.setItem('teg_supervisor_active_store', closest.name)
        }
        setIsLocating(false)
      },
      () => {
        setIsLocating(false)
        const last = localStorage.getItem('teg_supervisor_active_store')
        if (last) setOriginStore(last)
      },
      { timeout: 6000, enableHighAccuracy: true }
    )
  }

  const handleSetPreferredApp = (app: 'google' | 'apple' | 'waze') => {
    setPreferredApp(app)
    localStorage.setItem('teg_preferred_nav_app', app)
  }

  const handleStartDrive = async (destinationName: string) => {
    if (destinationName === originStore) return
    setIsSaving(destinationName)

    try {
      // 1. Guardar el viaje en la base de datos a través de checkin
      const res = await fetch('/api/miles/checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          supervisor_id: currentUser.id,
          supervisor_name: currentUser.name,
          supervisor_email: currentUser.email,
          previous_store_name: originStore,
          store_name: destinationName,
          auto_create_trip: true,
          source: 'quick_drive_modal'
        })
      })

      const data = await res.json()
      if (data.success) {
        localStorage.setItem('teg_supervisor_active_store', destinationName)
        setSuccessMessage(`¡Viaje guardado! (${data.distance_miles || ''} mi • $${data.total_reimbursement || ''} USD)`)
        if (onTripLogged) onTripLogged()
      }

      // 2. Abrir la app de mapas con navegación paso a paso
      const destCoords = CANONICAL_STORE_COORDINATES[destinationName]
      if (destCoords) {
        let navUrl = ''
        if (preferredApp === 'apple') {
          navUrl = `http://maps.apple.com/?daddr=${destCoords.lat},${destCoords.lng}&dirflg=d`
        } else if (preferredApp === 'waze') {
          navUrl = `https://waze.com/ul?ll=${destCoords.lat},${destCoords.lng}&navigate=yes`
        } else {
          // Google Maps live navigation
          navUrl = `https://www.google.com/maps/dir/?api=1&destination=${destCoords.lat},${destCoords.lng}&travelmode=driving&dir_action=navigate`
        }

        window.open(navUrl, '_blank')
      }

      setTimeout(() => {
        setIsSaving(null)
        onClose()
      }, 1200)

    } catch (err) {
      console.error('Error in handleStartDrive:', err)
      setIsSaving(null)
    }
  }

  // Lista de todas las tiendas ordenadas alfabéticamente o por distancia desde el origen
  const originCoords = CANONICAL_STORE_COORDINATES[originStore]
  const allDestinations = Object.keys(CANONICAL_STORE_COORDINATES)
    .filter(name => name !== originStore)
    .map(name => {
      const coords = CANONICAL_STORE_COORDINATES[name]
      let dist = 0
      if (originCoords && coords) {
        dist = parseFloat((haversineDistanceMiles(originCoords.lat, originCoords.lng, coords.lat, coords.lng) * 1.33).toFixed(2))
      }
      return { name, dist, coords }
    })
    .sort((a, b) => a.dist - b.dist)

  const filteredDestinations = allDestinations.filter(d =>
    d.name.toLowerCase().includes(searchTerm.toLowerCase())
  )

  if (!isOpen) return null

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 15 }}
          transition={{ duration: 0.2 }}
          className="relative w-full max-w-lg bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col max-h-[90vh]"
        >
          {/* Header */}
          <div className="p-5 bg-gradient-to-r from-emerald-600 to-teal-700 text-white flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-white/20 backdrop-blur-md rounded-2xl">
                <Car className="w-6 h-6 text-white" />
              </div>
              <div>
                <h3 className="text-lg font-black tracking-tight">{t('miles.quick_drive')}</h3>
                <p className="text-xs text-emerald-100 font-medium">{t('miles.quick_drive_subtitle')}</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 text-white/80 hover:text-white hover:bg-white/10 rounded-full transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Success Banner */}
          {successMessage && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className="bg-emerald-500 text-white px-4 py-2.5 text-xs font-bold flex items-center justify-center gap-2"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>{successMessage}</span>
            </motion.div>
          )}

          {/* Origin Bar */}
          <div className="p-4 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <MapPin className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <div className="min-w-0">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                  {t('miles.origin_detected')}
                </span>
                <select
                  value={originStore}
                  onChange={e => setOriginStore(e.target.value)}
                  className="text-xs font-black text-slate-800 dark:text-slate-100 bg-transparent border-0 p-0 focus:ring-0 cursor-pointer truncate max-w-[200px]"
                >
                  {Object.keys(CANONICAL_STORE_COORDINATES).map(s => (
                    <option key={s} value={s} className="dark:bg-slate-900">
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <button
              onClick={detectCurrentLocation}
              disabled={isLocating}
              className="shrink-0 text-[11px] font-bold text-emerald-700 dark:text-emerald-400 hover:underline flex items-center gap-1"
            >
              <Compass className={`w-3.5 h-3.5 ${isLocating ? 'animate-spin' : ''}`} />
              <span>{isLocating ? t('miles.gps_detecting') : 'GPS'}</span>
            </button>
          </div>

          {/* App Selector & Search */}
          <div className="p-4 pb-2 space-y-3">
            <div className="flex items-center justify-between text-xs font-bold text-slate-600 dark:text-slate-300">
              <span>{t('miles.nav_app_label')}</span>
              <div className="flex gap-1.5">
                {(['google', 'apple', 'waze'] as const).map(app => (
                  <button
                    key={app}
                    type="button"
                    onClick={() => handleSetPreferredApp(app)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-extrabold uppercase transition-all ${
                      preferredApp === app
                        ? 'bg-emerald-600 text-white shadow-sm'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200'
                    }`}
                  >
                    {app === 'google' ? 'Google Maps' : app === 'apple' ? 'Apple Maps' : 'Waze'}
                  </button>
                ))}
              </div>
            </div>

            {/* Search Input */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                placeholder={t('miles.search_dest_placeholder')}
                className="w-full pl-9 pr-4 py-2 bg-slate-100 dark:bg-slate-800 text-xs font-medium rounded-xl border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
          </div>

          {/* Destinations Grid */}
          <div className="p-4 pt-1 overflow-y-auto flex-1 divide-y divide-slate-100 dark:divide-slate-800/60">
            <div className="text-[11px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-2">
              {t('miles.destination_select')}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {filteredDestinations.map(dest => {
                const isCurrentSaving = isSaving === dest.name
                return (
                  <button
                    key={dest.name}
                    type="button"
                    disabled={isSaving !== null}
                    onClick={() => handleStartDrive(dest.name)}
                    className="flex items-center justify-between p-3 rounded-2xl border border-slate-200 dark:border-slate-800 hover:border-emerald-500 hover:bg-emerald-50/50 dark:hover:bg-emerald-950/20 text-left transition-all group active:scale-[0.98]"
                  >
                    <div className="min-w-0 pr-2">
                      <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100 group-hover:text-emerald-700 dark:group-hover:text-emerald-400 truncate">
                        {dest.name.replace('Tacos Gavilan ', '')}
                      </h4>
                      <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                        {dest.dist > 0 ? `${dest.dist} mi • ~$${(dest.dist * 0.76).toFixed(2)}` : 'Distancia estándar'}
                      </span>
                    </div>

                    <div className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 group-hover:bg-emerald-600 group-hover:text-white text-slate-700 dark:text-slate-300 font-bold text-xs transition-colors">
                      {isCurrentSaving ? (
                        <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <>
                          <span>{t('miles.go_btn')}</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Footer Note */}
          <div className="p-3 bg-slate-50 dark:bg-slate-800/80 border-t border-slate-200 dark:border-slate-800 text-center">
            <p className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center justify-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-amber-500" />
              <span>{t('miles.quick_drive_footer_note')}</span>
            </p>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  )
}
