/**
 * @module components/miles/SupervisorAutoTracker
 * @description Hook y widget de detección pasiva por GPS para supervisores en Tacos Gavilan.
 * @businessRules
 * - Monitorea de forma ligera la presencia física del supervisor en sucursales.
 * - Al detectar que el supervisor arribó a una tienda diferente a la anterior (ej. de Lynwood a South Gate), emite una tarjeta interactiva flotante para registrar el traslado en 1 clic.
 * - Soporta modo de auto-guardado en segundo plano cuando el usuario activa la preferencia.
 * @dataFlow
 * - Utiliza navigator.geolocation y findClosestStore.
 * - Envía check-in y crea viajes en /api/miles/checkin.
 * @notes
 * - Solo se activa para roles de supervisor y admin.
 * - Minimiza el consumo de batería ejecutando el chequeo en visibilitychange y en intervalos throttled.
 */

'use client'

import React, { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Car, MapPin, CheckCircle2, X, Sparkles, Navigation } from 'lucide-react'
import { useAuth } from '@/components/ProtectedRoute'
import { useLanguage } from '@/lib/i18n'
import { findClosestStore, normalizeStoreName } from '@/lib/store-coordinates'

interface DetectedArrival {
  origin_name: string
  destination_name: string
  distance_miles: number
  total_reimbursement: number
  start_time?: string
}

export default function SupervisorAutoTracker() {
  const { user } = useAuth()
  const { t } = useLanguage()

  const [detectedArrival, setDetectedArrival] = useState<DetectedArrival | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [justSaved, setJustSaved] = useState<string | null>(null)
  const [autoLogEnabled, setAutoLogEnabled] = useState(false)
  const lastCheckTimestamp = useRef<number>(0)

  const isSupervisorOrAdmin = user && (
    (user.role || '').toLowerCase() === 'supervisor' ||
    (user.role || '').toLowerCase() === 'admin'
  )

  // Load autoLog preference
  useEffect(() => {
    const pref = localStorage.getItem('teg_miles_auto_log_enabled')
    if (pref === 'true') setAutoLogEnabled(true)
  }, [])

  const handleToggleAutoLog = (enabled: boolean) => {
    setAutoLogEnabled(enabled)
    localStorage.setItem('teg_miles_auto_log_enabled', enabled ? 'true' : 'false')
  }

  const performLocationCheck = async () => {
    if (!isSupervisorOrAdmin || !navigator.geolocation) return

    // Throttle checks to at least 90 seconds apart unless forced
    const now = Date.now()
    if (now - lastCheckTimestamp.current < 90 * 1000) return
    lastCheckTimestamp.current = now

    navigator.geolocation.getCurrentPosition(
      async pos => {
        const closest = findClosestStore(pos.coords.latitude, pos.coords.longitude)
        if (!closest || !closest.name || closest.distanceMiles > 0.35) return

        const currentStore = normalizeStoreName(closest.name)
        const previousStore = localStorage.getItem('teg_supervisor_active_store')

        // If at a new store different from last recorded store
        if (previousStore && previousStore !== currentStore) {
          const autoSavePref = localStorage.getItem('teg_miles_auto_log_enabled') === 'true'

          try {
            const res = await fetch('/api/miles/checkin', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                supervisor_id: user.id,
                supervisor_name: user.name || 'Supervisor',
                supervisor_email: user.email,
                previous_store_name: previousStore,
                store_name: currentStore,
                latitude: pos.coords.latitude,
                longitude: pos.coords.longitude,
                auto_create_trip: autoSavePref,
                source: 'passive_gps_tracker'
              })
            })

            const data = await res.json()
            localStorage.setItem('teg_supervisor_active_store', currentStore)

            if (data.trip_created) {
              setJustSaved(`${previousStore} → ${currentStore}`)
              setTimeout(() => setJustSaved(null), 5000)
            } else if (data.trip_suggested) {
              setDetectedArrival({
                origin_name: data.origin_name,
                destination_name: data.destination_name,
                distance_miles: data.distance_miles,
                total_reimbursement: data.total_reimbursement,
                start_time: data.start_time
              })
            }
          } catch (e) {
            console.warn('Auto tracker checkin error:', e)
          }
        } else {
          // Just update current store if not set
          localStorage.setItem('teg_supervisor_active_store', currentStore)
        }
      },
      err => {
        // Silent failure for background geolocation
      },
      { timeout: 8000, enableHighAccuracy: true }
    )
  }

  // Check on mount, window focus and periodic interval
  useEffect(() => {
    if (!isSupervisorOrAdmin) return

    performLocationCheck()

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        performLocationCheck()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    const interval = setInterval(performLocationCheck, 4 * 60 * 1000) // Every 4 mins

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      clearInterval(interval)
    }
  }, [isSupervisorOrAdmin, user])

  const handleConfirmTrip = async () => {
    if (!detectedArrival || !user) return
    setIsSaving(true)

    try {
      const res = await fetch('/api/miles/checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          supervisor_id: user.id,
          supervisor_name: user.name || 'Supervisor',
          supervisor_email: user.email,
          previous_store_name: detectedArrival.origin_name,
          store_name: detectedArrival.destination_name,
          auto_create_trip: true,
          source: 'arrival_toast_confirm'
        })
      })

      const data = await res.json()
      if (data.success) {
        setJustSaved(`${detectedArrival.origin_name} → ${detectedArrival.destination_name}`)
        setDetectedArrival(null)
        setTimeout(() => setJustSaved(null), 5000)
      }
    } catch (e) {
      console.error('Error confirming trip:', e)
    } finally {
      setIsSaving(false)
    }
  }

  if (!isSupervisorOrAdmin) return null

  return (
    <>
      {/* Toast de Guardado Automático */}
      <AnimatePresence>
        {justSaved && (
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 50, scale: 0.9 }}
            className="fixed bottom-20 lg:bottom-6 right-4 z-50 max-w-sm bg-emerald-600 text-white p-4 rounded-2xl shadow-2xl flex items-center gap-3 border border-emerald-400/30"
          >
            <div className="p-2 bg-white/20 rounded-xl shrink-0">
              <CheckCircle2 className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0">
              <h5 className="text-xs font-black">{t('miles.trip_saved')}</h5>
              <p className="text-[11px] text-emerald-100 truncate">{justSaved}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating Arrival Card for 1-Click Confirmation */}
      <AnimatePresence>
        {detectedArrival && (
          <motion.div
            initial={{ opacity: 0, y: 60, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 60, scale: 0.95 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed bottom-20 lg:bottom-6 right-4 z-50 w-[calc(100vw-32px)] max-w-md bg-white dark:bg-slate-900 border-2 border-emerald-500 rounded-3xl shadow-2xl p-5 overflow-hidden"
          >
            {/* Ambient background glow */}
            <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/10 rounded-full blur-2xl pointer-events-none" />

            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2.5 bg-emerald-100 dark:bg-emerald-950/60 rounded-2xl text-emerald-600 dark:text-emerald-400">
                  <Car className="w-5 h-5" />
                </div>
                <div>
                  <span className="text-[10px] font-black uppercase tracking-wider text-emerald-600 dark:text-emerald-400 block">
                    {t('miles.arrival_toast_title')}
                  </span>
                  <h4 className="text-sm font-black text-slate-900 dark:text-slate-100 truncate">
                    {detectedArrival.destination_name}
                  </h4>
                </div>
              </div>

              <button
                onClick={() => setDetectedArrival(null)}
                className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-300 mb-3">
              {t('miles.arrival_toast_desc')
                .replace('{store}', detectedArrival.destination_name)
                .replace('{from}', detectedArrival.origin_name)
                .replace('{miles}', String(detectedArrival.distance_miles))
                .replace('{amount}', String(detectedArrival.total_reimbursement))}
            </p>

            <div className="flex items-center gap-2 mb-3">
              <button
                onClick={handleConfirmTrip}
                disabled={isSaving}
                className="flex-1 py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] text-white text-xs font-black rounded-xl shadow-md shadow-emerald-600/20 flex items-center justify-center gap-1.5 transition-all"
              >
                {isSaving ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    <span>{t('miles.log_detected_drive')}</span>
                  </>
                )}
              </button>

              <button
                onClick={() => setDetectedArrival(null)}
                className="py-2.5 px-3 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs font-bold rounded-xl transition-colors"
              >
                {t('miles.dismiss')}
              </button>
            </div>

            {/* Toggle auto-log preference */}
            <label className="flex items-center gap-2 cursor-pointer text-[11px] text-slate-500 dark:text-slate-400 select-none">
              <input
                type="checkbox"
                checked={autoLogEnabled}
                onChange={e => handleToggleAutoLog(e.target.checked)}
                className="w-3.5 h-3.5 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500"
              />
              <span>{t('miles.auto_log_setting')}</span>
            </label>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
