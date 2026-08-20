'use client'

/**
 * @module RouteMap
 * @description Componente de mapa interactivo que muestra la ruta REAL de manejo (calles/freeways)
 *              entre origen y destino en el módulo MilesIQ.
 *              Usa Google Maps para el mapa. Para la ruta de manejo intenta Google Directions API
 *              primero, y si no está habilitada usa OSRM como fallback (gratuito).
 * @businessRules
 * - Muestra marcador verde (A: origen) y rojo (B: destino) con etiquetas.
 * - Intenta Google Directions API primero para ruta real de calles.
 * - Si Directions API falla, usa OSRM (Open Source Routing Machine) como fallback.
 * - Ajusta el zoom automáticamente para encuadrar la ruta completa.
 * - Si las coordenadas no están disponibles, el mapa se oculta.
 * @dataFlow Props → fetch store-coordinates → Google Directions || OSRM fallback → Google Maps render
 * @notes
 * - To use Google Directions natively, enable "Directions API" in Google Cloud Console.
 * - OSRM fallback: https://router.project-osrm.org (free, no key needed)
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import { useLanguage } from '@/lib/i18n'
import { CANONICAL_STORE_COORDINATES } from '@/lib/store-coordinates'

interface RouteMapProps {
  originName: string
  destinationName: string
  distanceMiles: number
}

interface StoreCoord {
  lat: number
  lng: number
  address: string
}

const INITIAL_COORDS: Record<string, StoreCoord> = (() => {
  const map: Record<string, StoreCoord> = {}
  Object.entries(CANONICAL_STORE_COORDINATES).forEach(([k, v]) => {
    map[k] = { lat: v.lat, lng: v.lng, address: `${v.address}, ${v.city}, ${v.state} ${v.zip_code}`.trim() }
    if (v.shortName && v.shortName !== k) {
      map[v.shortName] = map[k]
    }
  })
  return map
})()

export default function RouteMap({ originName, destinationName, distanceMiles }: RouteMapProps) {
  const mapRef = useRef<HTMLDivElement>(null)
  const { t } = useLanguage()
  const [apiKey, setApiKey] = useState<string>('')
  const [coordinates, setCoordinates] = useState<Record<string, StoreCoord>>(INITIAL_COORDS)
  const [loadingKey, setLoadingKey] = useState(true)
  const [hasError, setHasError] = useState(false)
  const mapInstanceRef = useRef<any>(null)
  const markersRef = useRef<any[]>([])
  const polylineRef = useRef<any>(null)

  // Fetch API key and store coordinates on mount
  useEffect(() => {
    const safeJson = async (url: string) => {
      const res = await fetch(url)
      if (!res.ok) return null
      const ct = res.headers.get('content-type') || ''
      if (!ct.includes('application/json')) return null
      return res.json()
    }

    Promise.all([
      safeJson('/api/admin/stores/map-key'),
      safeJson('/api/miles/store-coordinates')
    ])
      .then(([keyData, coordData]) => {
        if (keyData?.apiKey) {
          setApiKey(keyData.apiKey)
        } else {
          setHasError(true)
        }
        if (coordData?.success && coordData.coordinates) {
          setCoordinates(coordData.coordinates)
        }
        setLoadingKey(false)
      })
      .catch(err => {
        console.error('Error loading map data:', err)
        setHasError(true)
        setLoadingKey(false)
      })
  }, [])

  const findCoords = useCallback((name: string): StoreCoord | null => {
    if (coordinates[name]) return coordinates[name]
    const normalized = name.toLowerCase().trim()
    for (const [key, val] of Object.entries(coordinates)) {
      if (key.toLowerCase().trim() === normalized) return val
      if (key.toLowerCase().includes(normalized) || normalized.includes(key.toLowerCase())) return val
    }
    return null
  }, [coordinates])

  // Load Google Maps script once
  useEffect(() => {
    if (!apiKey || hasError) return
    const existingScript = document.getElementById('google-maps-script-miles')
    if (!existingScript && !(window as any).google) {
      const script = document.createElement('script')
      script.id = 'google-maps-script-miles'
      script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}`
      script.async = true
      script.defer = true
      script.onerror = () => setHasError(true)
      document.head.appendChild(script)
    }
  }, [apiKey, hasError])

  // Fetch OSRM driving route as fallback (free, no API key needed)
  async function fetchOSRMRoute(
    orig: { lat: number; lng: number },
    dest: { lat: number; lng: number }
  ): Promise<{ lat: number; lng: number }[]> {
    try {
      const url = `https://router.project-osrm.org/route/v1/driving/${orig.lng},${orig.lat};${dest.lng},${dest.lat}?overview=full&geometries=geojson`
      const res = await fetch(url)
      if (!res.ok) return []
      const data = await res.json()
      if (data.code !== 'Ok' || !data.routes?.[0]?.geometry?.coordinates) return []
      // GeoJSON = [lng, lat] → convert to {lat, lng}
      return data.routes[0].geometry.coordinates.map((c: number[]) => ({
        lat: c[1],
        lng: c[0]
      }))
    } catch {
      return []
    }
  }

  // Clear all overlays
  function clearOverlays() {
    markersRef.current.forEach(m => m.setMap(null))
    markersRef.current = []
    if (polylineRef.current) {
      polylineRef.current.setMap(null)
      polylineRef.current = null
    }
  }

  // Track render version to cancel stale async renders
  const renderIdRef = useRef(0)

  // Render the route whenever origin/destination/coordinates change
  useEffect(() => {
    if (!apiKey || hasError || !mapRef.current || Object.keys(coordinates).length === 0) return

    // Increment render ID — any previous async render becomes stale
    const currentRenderId = ++renderIdRef.current

    const tryRender = async () => {
      if (!(window as any).google) return

      const google = (window as any).google
      const origCoord = findCoords(originName)
      const destCoord = findCoords(destinationName)

      if (!origCoord || !destCoord) return
      if (originName.toLowerCase().trim() === destinationName.toLowerCase().trim()) return

      const origLatLng = new google.maps.LatLng(origCoord.lat, origCoord.lng)
      const destLatLng = new google.maps.LatLng(destCoord.lat, destCoord.lng)

      // Create map if not exists
      if (!mapInstanceRef.current) {
        mapInstanceRef.current = new google.maps.Map(mapRef.current, {
          center: origLatLng,
          zoom: 12,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true,
          zoomControl: true,
          styles: [
            { featureType: 'poi', stylers: [{ visibility: 'off' }] },
            { featureType: 'transit', stylers: [{ visibility: 'simplified' }] }
          ]
        })
      }

      const map = mapInstanceRef.current
      clearOverlays()

      // ── Get real driving route from OSRM ──
      const routePoints = await fetchOSRMRoute(origCoord, destCoord)

      // Check if this render is still current (user may have changed selection during fetch)
      if (renderIdRef.current !== currentRenderId) return

      if (routePoints.length > 0) {
        polylineRef.current = new google.maps.Polyline({
          path: routePoints.map(p => new google.maps.LatLng(p.lat, p.lng)),
          geodesic: false,
          strokeColor: '#2563eb',
          strokeOpacity: 0.9,
          strokeWeight: 5
        })
        polylineRef.current.setMap(map)

        const bounds = new google.maps.LatLngBounds()
        routePoints.forEach(p => bounds.extend(new google.maps.LatLng(p.lat, p.lng)))
        map.fitBounds(bounds, { top: 50, bottom: 50, left: 50, right: 50 })
      } else {
        // Fallback: fit to markers only
        const bounds = new google.maps.LatLngBounds()
        bounds.extend(origLatLng)
        bounds.extend(destLatLng)
        map.fitBounds(bounds, { top: 50, bottom: 50, left: 50, right: 50 })
      }

      // Check again after route draw
      if (renderIdRef.current !== currentRenderId) return

      // ── Custom markers (always) ──
      const originMarker = new google.maps.Marker({
        position: origLatLng,
        map,
        title: originName,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 10,
          fillColor: '#16a34a',
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 3
        },
        label: { text: 'A', color: '#ffffff', fontSize: '11px', fontWeight: 'bold' }
      })

      const destMarker = new google.maps.Marker({
        position: destLatLng,
        map,
        title: destinationName,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 10,
          fillColor: '#dc2626',
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 3
        },
        label: { text: 'B', color: '#ffffff', fontSize: '11px', fontWeight: 'bold' }
      })

      markersRef.current = [originMarker, destMarker]
    }

    let intervalId: ReturnType<typeof setInterval> | null = null

    if ((window as any).google) {
      tryRender()
    } else {
      intervalId = setInterval(() => {
        if ((window as any).google) {
          clearInterval(intervalId!)
          intervalId = null
          tryRender()
        }
      }, 200)
      setTimeout(() => { if (intervalId) clearInterval(intervalId) }, 10000)
    }

    // Cleanup: cancel polling interval on re-render
    return () => {
      if (intervalId) clearInterval(intervalId)
    }
  }, [apiKey, hasError, coordinates, originName, destinationName, findCoords])

  const origCoord = findCoords(originName)
  const destCoord = findCoords(destinationName)
  const canShowMap = origCoord && destCoord && originName.toLowerCase() !== destinationName.toLowerCase()

  if (loadingKey) {
    return (
      <div className="h-[180px] sm:h-[220px] w-full bg-slate-100 dark:bg-slate-800 rounded-xl animate-pulse flex items-center justify-center">
        <span className="text-xs text-slate-400 font-bold">🗺️ {t('miles.loading_map')}</span>
      </div>
    )
  }

  if (hasError || !canShowMap) {
    if (!canShowMap && !hasError) return null
    return (
      <div className="h-[120px] w-full bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/50 rounded-xl flex flex-col items-center justify-center gap-1.5 text-center px-4">
        <span className="text-lg">⚠️</span>
        <span className="text-[10px] text-amber-600 dark:text-amber-400 font-bold">
          {t('miles.map_unavailable')}
        </span>
      </div>
    )
  }

  return (
    <div className="relative">
      <div
        ref={mapRef}
        className="h-[180px] sm:h-[220px] w-full rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 shadow-sm"
      />
      <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between gap-1 pointer-events-none">
        <div className="bg-white/95 dark:bg-slate-900/95 text-[9px] sm:text-[10px] font-bold text-emerald-700 dark:text-emerald-400 px-2 py-1 rounded-lg shadow border border-emerald-200 dark:border-emerald-800 truncate max-w-[40%]">
          📍 A: {originName.replace('Tacos Gavilan ', '')}
        </div>
        <div className="bg-blue-600 text-white text-[9px] sm:text-[10px] font-black px-2.5 py-1 rounded-lg shadow">
          🚗 {distanceMiles.toFixed(1)} mi
        </div>
        <div className="bg-white/95 dark:bg-slate-900/95 text-[9px] sm:text-[10px] font-bold text-red-700 dark:text-red-400 px-2 py-1 rounded-lg shadow border border-red-200 dark:border-red-800 truncate max-w-[40%]">
          📍 B: {destinationName.replace('Tacos Gavilan ', '')}
        </div>
      </div>
    </div>
  )
}
