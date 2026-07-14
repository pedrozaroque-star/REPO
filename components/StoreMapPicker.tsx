'use client'

import { useEffect, useRef, useState } from 'react'

interface StoreMapPickerProps {
    initialLat?: number
    initialLng?: number
    onChange?: (lat: number, lng: number) => void
    readOnly?: boolean
    storeName?: string
}

export default function StoreMapPicker({ initialLat, initialLng, onChange, readOnly = false }: StoreMapPickerProps) {
    const mapRef = useRef<HTMLDivElement>(null)
    const [apiKey, setApiKey] = useState<string>('')
    const [loadingKey, setLoadingKey] = useState(true)
    const [hasError, setHasError] = useState(false)

    // Fetch Google Maps API Key securely
    useEffect(() => {
        fetch('/api/admin/stores/map-key')
            .then(res => res.json())
            .then(data => {
                if (data.apiKey) {
                    setApiKey(data.apiKey)
                } else {
                    setHasError(true)
                }
                setLoadingKey(false)
            })
            .catch(err => {
                console.error('Error fetching Google Maps API key:', err)
                setHasError(true)
                setLoadingKey(false)
            })
    }, [])

    useEffect(() => {
        if (!apiKey || hasError || !mapRef.current) return

        // Global Google Maps authentication failure handler
        (window as any).gm_authFailure = () => {
            console.error('Google Maps API failed to authenticate/activate.')
            setHasError(true)
        }

        // Check if google maps script is already loaded
        const existingScript = document.getElementById('google-maps-script')
        if (!existingScript) {
            const script = document.createElement('script')
            script.id = 'google-maps-script'
            script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`
            script.async = true
            script.defer = true
            script.onload = () => initMap()
            script.onerror = () => {
                console.error('Failed to load Google Maps script.')
                setHasError(true)
            }
            document.head.appendChild(script)
        } else {
            const interval = setInterval(() => {
                if ((window as any).google) {
                    clearInterval(interval)
                    initMap()
                }
            }, 100)
        }

        let map: any
        let marker: any

        function initMap() {
            if (!mapRef.current || !(window as any).google || hasError) return

            const centerLat = initialLat || 34.0522
            const centerLng = initialLng || -118.2437
            const latLng = { lat: centerLat, lng: centerLng }

            try {
                map = new (window as any).google.maps.Map(mapRef.current, {
                    center: latLng,
                    zoom: initialLat && initialLng ? 16 : 11,
                    mapTypeControl: true,
                    streetViewControl: false,
                    fullscreenControl: true
                })

                marker = new (window as any).google.maps.Marker({
                    position: latLng,
                    map: map,
                    draggable: !readOnly,
                    animation: (window as any).google.maps.Animation.DROP
                })

                if (!readOnly) {
                    map.addListener('click', (e: any) => {
                        if (e.latLng) {
                            const newLat = e.latLng.lat()
                            const newLng = e.latLng.lng()
                            marker.setPosition(e.latLng)
                            onChange?.(newLat, newLng)
                        }
                    })

                    marker.addListener('dragend', () => {
                        const pos = marker.getPosition()
                        if (pos) {
                            onChange?.(pos.lat(), pos.lng())
                        }
                    })
                }
            } catch (err) {
                console.error('Error initializing Google Map:', err)
                setHasError(true)
            }
        }
    }, [apiKey, initialLat, initialLng, readOnly, hasError])

    if (loadingKey) {
        return (
            <div className="h-[300px] w-full bg-gray-150 dark:bg-slate-800 rounded-2xl flex items-center justify-center border border-gray-100 dark:border-slate-700 animate-pulse">
                <span className="text-xs text-gray-400 font-bold">Cargando Google Maps...</span>
            </div>
        )
    }

    if (hasError) {
        return (
            <div className="h-[300px] w-full bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/50 rounded-2xl flex flex-col items-center justify-center p-6 text-center gap-3">
                <span className="text-2xl">⚠️</span>
                <span className="text-xs text-red-600 dark:text-red-400 font-bold">
                    Error al cargar Google Maps
                </span>
                <span className="text-[10px] text-gray-500 max-w-md">
                    Por favor verifica que la clave de API en su consola de Google Cloud tenga habilitada la "Maps JavaScript API".
                </span>
            </div>
        )
    }

    return (
        <div className="h-[300px] w-full rounded-2xl overflow-hidden shadow-sm border border-gray-200 dark:border-slate-700 z-0 relative">
            <div ref={mapRef} className="w-full h-full" />
            {!readOnly && (
                <div className="absolute bottom-2 left-2 bg-white/95 dark:bg-slate-900/95 p-2 px-3 rounded-xl text-[10px] z-10 shadow border border-gray-150 dark:border-slate-800 text-gray-700 dark:text-gray-300 font-black tracking-wide uppercase">
                    📍 Haz click o arrastra el marcador para ubicar la sucursal
                </div>
            )}
        </div>
    )
}
