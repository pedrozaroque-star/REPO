/**
 * @module components/customer-app-v2/modals/StoreAndMapModals
 * @description Modales de selección de sucursal (`StoreSelectorModal`) y mapa interactivo en app
 * (`InteractiveMapModal`) con Google Maps SDK (temas Dark/Light/Satellite, pines personalizados
 * Tacos Gavilan, punto GPS del usuario y vista de las 15 sucursales) más respaldo automático
 * en Google Maps Embed si falla la carga de script.
 *
 * @businessRules
 * - Usa `nowDate` reactivo (cada 60s) para mostrar estado Abierto/Cerrado real en LA.
 * - Cambiar sucursal llama a `selectStoreSafely` para evitar bolsas inconsistentes entre tiendas.
 * - Textos bilingües vía `t('mobile_legal.*')`.
 *
 * @dataFlow
 * - Consume `ctrl.storesWithDistance`, `ctrl.mapFocusedStore`, `ctrl.mapModalOpen`, `ctrl.storeModalOpen`.
 *
 * @notes
 * - Respeta `!fullscreenNative && islandOverlayMode` para el espacio superior seguro del visor iPhone.
 */

'use client'

import React, { useEffect, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Check,
  ChevronRight,
  LocateFixed,
  MapPin,
  Navigation,
  Phone,
  X,
} from 'lucide-react'
import { getStoreStatusInLA } from '../data/stores'
import type { CustomerAppV2Controller } from '../hooks/useCustomerAppV2'

const DARK_MAP_STYLES = [
  { elementType: 'geometry', stylers: [{ color: '#212121' }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#757575' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#212121' }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ color: '#757575' }] },
  { featureType: 'road', elementType: 'geometry.fill', stylers: [{ color: '#2c2c2c' }] },
  { featureType: 'road.arterial', elementType: 'geometry', stylers: [{ color: '#373737' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#3c3c3c' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#000000' }] },
]

export function StoreAndMapModals({
  ctrl,
  fullscreenNative,
  islandOverlayMode = true,
}: {
  ctrl: CustomerAppV2Controller
  fullscreenNative?: boolean
  islandOverlayMode?: boolean
}) {
  const {
    lang,
    t,
    nowDate,
    storeModalOpen,
    setStoreModalOpen,
    storesWithDistance,
    currentStore,
    selectStoreSafely,
    mapModalOpen,
    setMapModalOpen,
    mapFocusedStore,
    mapFocusedStoreStatus,
    setMapFocusedStoreId,
    mapTheme,
    setMapTheme,
    mapViewAll,
    setMapViewAll,
    mapSdkFailed,
    setMapSdkFailed,
    userCoords,
    isLocating,
    handleLocateGps,
    fulfillmentMode,
    launchWrappedOrderOnline,
    setActiveTab,
  } = ctrl

  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const googleMapInstanceRef = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const googleMapMarkersRef = useRef<Map<number, any>>(new Map())
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const googleMapUserMarkerRef = useRef<any>(null)

  useEffect(() => {
    if (!mapModalOpen || mapSdkFailed) return
    const container = mapContainerRef.current
    if (!container) return

    const SCRIPT_ID = 'tacos-gavilan-google-maps'
    const MAPS_KEY =
      process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ||
      'AIzaSyCdu1R10kWbD-FaSMh4MMyxgqmhEG8xVko'

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any
    w.gm_authFailure = () => setMapSdkFailed(true)

    const loadScript = (): Promise<void> => {
      if (w.google?.maps) return Promise.resolve()
      return new Promise((resolve, reject) => {
        const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null
        const script = existing || document.createElement('script')
        const onLoad = () =>
          w.google?.maps ? resolve() : reject(new Error('Google Maps unavailable'))
        const onError = () => reject(new Error('Google Maps script error'))
        script.addEventListener('load', onLoad, { once: true })
        script.addEventListener('error', onError, { once: true })
        if (!existing) {
          script.id = SCRIPT_ID
          script.async = true
          script.defer = true
          script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(MAPS_KEY)}`
          document.head.appendChild(script)
        }
      })
    }

    let cancelled = false
    loadScript()
      .then(() => {
        if (cancelled || !mapContainerRef.current) return
        const gmaps = w.google?.maps
        if (!gmaps) {
          setMapSdkFailed(true)
          return
        }

        const themeOpts =
          mapTheme === 'satellite'
            ? { mapTypeId: 'hybrid', styles: [] }
            : mapTheme === 'light'
            ? { mapTypeId: 'roadmap', styles: [] }
            : { mapTypeId: 'roadmap', styles: DARK_MAP_STYLES }

        const pinIcon = {
          path: 'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z',
          fillColor: '#DA291C',
          fillOpacity: 1,
          strokeColor: '#FFC72C',
          strokeWeight: 2,
          scale: 1.5,
          anchor: new gmaps.Point(12, 22),
        }

        const activePinIcon = {
          ...pinIcon,
          strokeColor: '#F5C424',
          strokeWeight: 2.8,
          scale: 1.9,
        }

        let map = googleMapInstanceRef.current
        if (!map || map.getDiv() !== mapContainerRef.current) {
          map = new gmaps.Map(mapContainerRef.current, {
            center: { lat: mapFocusedStore.latitude, lng: mapFocusedStore.longitude },
            zoom: mapViewAll ? 10 : 14,
            styles: themeOpts.styles,
            mapTypeId: themeOpts.mapTypeId,
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: false,
            zoomControl: true,
            gestureHandling: 'greedy',
          })
          googleMapInstanceRef.current = map
          googleMapMarkersRef.current.clear()

          storesWithDistance.forEach((st) => {
            const isTarget = st.id === mapFocusedStore.id
            const marker = new gmaps.Marker({
              position: { lat: st.latitude, lng: st.longitude },
              map,
              title: `Tacos Gavilan ${st.cityTitle} (${st.crossStreets})`,
              icon: isTarget ? activePinIcon : pinIcon,
              zIndex: isTarget ? 9990 : 100,
            })
            marker.addListener('click', () => {
              setMapFocusedStoreId(st.id)
              selectStoreSafely(st.id)
              setMapViewAll(false)
            })
            googleMapMarkersRef.current.set(st.id, marker)
          })
        } else {
          map.setMapTypeId(themeOpts.mapTypeId)
          map.setOptions({ styles: themeOpts.styles })
        }

        googleMapMarkersRef.current.forEach((marker, stId) => {
          const isTarget = stId === mapFocusedStore.id
          marker.setIcon(isTarget ? activePinIcon : pinIcon)
          marker.setZIndex(isTarget ? 9990 : 100)
        })

        if (userCoords) {
          if (googleMapUserMarkerRef.current) googleMapUserMarkerRef.current.setMap(null)
          googleMapUserMarkerRef.current = new gmaps.Marker({
            position: userCoords,
            map,
            icon: {
              path: gmaps.SymbolPath.CIRCLE,
              fillColor: '#2563EB',
              fillOpacity: 1,
              strokeColor: '#FFFFFF',
              strokeWeight: 3,
              scale: 8.5,
            },
            zIndex: 9999,
          })
        }

        if (mapViewAll) {
          const bounds = new gmaps.LatLngBounds()
          storesWithDistance.forEach((st) => bounds.extend({ lat: st.latitude, lng: st.longitude }))
          if (userCoords) bounds.extend(userCoords)
          map.fitBounds(bounds, { top: 36, right: 28, bottom: 36, left: 28 })
        } else {
          map.panTo({ lat: mapFocusedStore.latitude, lng: mapFocusedStore.longitude })
          if ((map.getZoom() || 10) < 13) map.setZoom(14)
        }
      })
      .catch(() => {
        if (!cancelled) setMapSdkFailed(true)
      })

    return () => {
      cancelled = true
    }
  }, [
    mapFocusedStore,
    mapModalOpen,
    mapSdkFailed,
    mapTheme,
    mapViewAll,
    selectStoreSafely,
    setMapFocusedStoreId,
    setMapSdkFailed,
    setMapViewAll,
    storesWithDistance,
    userCoords,
  ])

  const mapTopPad = fullscreenNative
    ? 'pt-2'
    : islandOverlayMode
    ? 'pt-[48px]'
    : 'pt-8'

  return (
    <>
      {/* Store Selector Sheet */}
      <AnimatePresence>
        {storeModalOpen && (
          <motion.div
            key="v2-store-selector-modal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 bg-black/80 backdrop-blur-md flex flex-col justify-end"
          >
            <motion.div
              initial={{ y: 240 }}
              animate={{ y: 0 }}
              exit={{ y: 240 }}
              className="bg-[#18181b] rounded-t-3xl border-t border-[#FDC82F]/40 max-h-[82%] flex flex-col overflow-hidden shadow-2xl"
            >
              <div className="p-4 border-b border-white/10 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-black uppercase tracking-wider text-white">
                    {t('mobile_legal.v2_stores_title')}
                  </h3>
                  <p className="text-[11px] text-white/60">
                    {t('mobile_legal.v2_welcome_tagline')}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setStoreModalOpen(false)}
                  className="p-1.5 rounded-full bg-white/10 text-white cursor-pointer"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="p-3 overflow-y-auto space-y-2">
                {storesWithDistance.map((st) => {
                  const status = getStoreStatusInLA(st, lang, nowDate)
                  const active = st.id === currentStore.id
                  return (
                    <button
                      key={st.id}
                      type="button"
                      onClick={() => {
                        selectStoreSafely(st.id)
                        setStoreModalOpen(false)
                      }}
                      className={`w-full text-left p-3 rounded-xl border transition-all flex items-center justify-between cursor-pointer ${
                        active
                          ? 'bg-[#DA291C]/20 border-[#FDC82F] text-white'
                          : 'bg-white/5 border-white/10 text-white/85 hover:bg-white/10'
                      }`}
                    >
                      <div className="min-w-0 pr-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-black text-white">{st.cityTitle}</span>
                          <span className="text-xs font-extrabold text-[#FFC72C]">
                            {st.crossStreets}
                          </span>
                          <span
                            className={`text-[10px] font-bold ${
                              status.isOpen ? 'text-emerald-400' : 'text-amber-400'
                            }`}
                          >
                            ● {status.badgeText}
                          </span>
                        </div>
                        <p className="text-[11px] text-white/60 truncate mt-0.5">{st.address}</p>
                      </div>
                      {active && <Check size={16} className="text-[#FDC82F] shrink-0" />}
                    </button>
                  )
                })}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Interactive Map Modal */}
      <AnimatePresence>
        {mapModalOpen && (
          <motion.div
            key="v2-in-app-map-modal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className={`absolute inset-0 z-[60] bg-black/85 backdrop-blur-md flex flex-col ${mapTopPad}`}
          >
            <motion.div
              initial={{ y: 24, scale: 0.98, opacity: 0 }}
              animate={{ y: 0, scale: 1, opacity: 1 }}
              exit={{ y: 24, scale: 0.98, opacity: 0 }}
              transition={{ duration: 0.25 }}
              className="flex-1 flex flex-col bg-[#121212] rounded-t-3xl border-t border-white/15 overflow-hidden shadow-2xl"
            >
              {/* Header + Controls */}
              <div className="bg-white text-[#121212] px-3.5 py-2.5 border-b border-black/10 space-y-2 shrink-0">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="v2-outfit text-sm font-extrabold text-[#121212] truncate">
                    {t('mobile_legal.v2_map_modal_title')} · {mapFocusedStore.cityTitle}
                  </h3>
                  <button
                    type="button"
                    onClick={() => setMapModalOpen(false)}
                    className="w-8 h-8 rounded-full bg-gray-100 hover:bg-[#DA291C] text-gray-700 hover:text-white border border-black/10 flex items-center justify-center transition-all cursor-pointer shrink-0"
                  >
                    <X size={16} />
                  </button>
                </div>

                <div className="flex items-center justify-between gap-1.5 flex-wrap">
                  <div className="inline-flex items-center bg-gray-100 border border-black/10 rounded-full p-0.5 gap-0.5">
                    {(['dark', 'light', 'satellite'] as const).map((themeKey) => (
                      <button
                        key={themeKey}
                        type="button"
                        onClick={() => setMapTheme(themeKey)}
                        className={`px-2.5 py-1 rounded-full text-[11px] font-bold uppercase cursor-pointer ${
                          mapTheme === themeKey
                            ? 'bg-[#121212] text-[#FFC72C]'
                            : 'text-gray-600 hover:text-[#121212]'
                        }`}
                      >
                        {themeKey}
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        handleLocateGps(false)
                        setMapViewAll(false)
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white hover:bg-[#DA291C] text-[#121212] hover:text-white border border-[#DA291C]/35 text-[11px] font-bold cursor-pointer"
                    >
                      <LocateFixed size={12} className={isLocating ? 'animate-spin' : ''} />
                      <span>{t('mobile_legal.v2_stores_gps_btn')}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setMapViewAll((prev) => !prev)}
                      className={`px-2 py-1 rounded-lg text-[10px] font-extrabold border cursor-pointer ${
                        mapViewAll
                          ? 'bg-[#DA291C] text-white border-[#DA291C]'
                          : 'bg-gray-100 text-gray-700 border-black/10'
                      }`}
                    >
                      15
                    </button>
                  </div>
                </div>
              </div>

              {/* Quick Store Strip */}
              <div className="bg-[#18181b] border-b border-white/10 px-3 py-2 flex items-center gap-1.5 overflow-x-auto no-scrollbar shrink-0">
                {storesWithDistance.map((st) => {
                  const isFocused = st.id === mapFocusedStore.id
                  return (
                    <button
                      key={st.id}
                      type="button"
                      onClick={() => {
                        setMapFocusedStoreId(st.id)
                        selectStoreSafely(st.id)
                        setMapViewAll(false)
                      }}
                      className={`shrink-0 px-2.5 py-1 rounded-full text-[10px] font-black cursor-pointer border flex items-center gap-1 ${
                        isFocused
                          ? 'bg-[#DA291C] text-white border-[#FFC72C]'
                          : 'bg-black/60 text-white/75 border-white/15'
                      }`}
                    >
                      <span>{st.cityTitle}</span>
                      {st.distanceMiles !== null && (
                        <span className="text-[#FFC72C]">({st.distanceMiles.toFixed(1)} mi)</span>
                      )}
                    </button>
                  )
                })}
              </div>

              {/* Map Canvas + Embed Fallback */}
              <div className="relative flex-1 bg-[#141414] overflow-hidden">
                {!mapSdkFailed ? (
                  <div ref={mapContainerRef} className="w-full h-full" />
                ) : (
                  <iframe
                    key={`${mapFocusedStore.id}-${mapTheme}-${mapViewAll}-${lang}`}
                    title={`Tacos Gavilan ${mapFocusedStore.cityTitle} Map`}
                    src={`https://maps.google.com/maps?q=${encodeURIComponent(
                      `Tacos Gavilan ${mapFocusedStore.address}`
                    )}&ll=${mapFocusedStore.latitude},${mapFocusedStore.longitude}&z=${
                      mapViewAll ? 10 : 15
                    }&t=${mapTheme === 'satellite' ? 'h' : 'm'}&hl=${lang}&output=embed`}
                    className={`w-full h-full border-0 ${
                      mapTheme === 'dark'
                        ? 'invert-[90%] hue-rotate-180 contrast-[95%] brightness-[92%]'
                        : ''
                    }`}
                    loading="eager"
                    referrerPolicy="no-referrer-when-downgrade"
                  />
                )}
              </div>

              {/* Footer Popup Card */}
              <div className="p-3.5 bg-gradient-to-b from-[#17171B] to-[#0E0E11] border-t border-[#F5C424]/45 shrink-0 space-y-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <span
                      className={`text-[10px] font-black ${
                        mapFocusedStoreStatus.isOpen ? 'text-emerald-400' : 'text-amber-400'
                      }`}
                    >
                      ● {mapFocusedStoreStatus.badgeText}
                    </span>
                    <h4 className="v2-outfit text-base font-black text-white leading-tight mt-0.5">
                      {mapFocusedStore.cityTitle}{' '}
                      <span className="text-xs font-extrabold text-[#FFC72C] font-sans">
                        • {mapFocusedStore.crossStreets}
                      </span>
                    </h4>
                  </div>
                </div>

                <div className="space-y-1 text-xs text-white/80">
                  <div className="flex items-center gap-1.5">
                    <MapPin size={13} className="text-[#FFC72C] shrink-0" />
                    <span className="truncate">{mapFocusedStore.address}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <a
                      href={`tel:${mapFocusedStore.phone.replace(/[^\d+]/g, '')}`}
                      className="inline-flex items-center gap-1.5 text-[#FFC72C] font-bold hover:underline"
                    >
                      <Phone size={12} />
                      <span>{mapFocusedStore.phone}</span>
                    </a>
                    <span className="text-[11px] text-white/60 truncate">
                      {mapFocusedStoreStatus.todayHours}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 pt-1 pb-2">
                  <button
                    type="button"
                    onClick={() => {
                      selectStoreSafely(mapFocusedStore.id)
                      setMapModalOpen(false)
                      launchWrappedOrderOnline(mapFocusedStore, fulfillmentMode)
                      setActiveTab('order')
                    }}
                    className="py-2.5 px-3 rounded-xl bg-gradient-to-r from-[#DA291C] to-[#b81d13] text-white text-xs font-black uppercase tracking-wider border border-[#FFC72C]/50 flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <span>{t('mobile_legal.support_order_btn')}</span>
                    <ChevronRight size={14} />
                  </button>

                  <a
                    href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
                      mapFocusedStore.address
                    )}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="py-2.5 px-3 rounded-xl bg-white/8 hover:bg-white/15 text-[#FFC72C] text-xs font-extrabold uppercase tracking-wider border border-[#FFC72C]/35 flex items-center justify-center gap-1.5"
                  >
                    <Navigation size={13} />
                    <span>{t('mobile_legal.wrapper_directions_btn')}</span>
                  </a>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
