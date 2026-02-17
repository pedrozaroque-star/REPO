'use client'

import { useState, useRef, useMemo, useEffect } from 'react'
import { MapContainer, TileLayer, Marker, Popup, useMapEvents } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'

// Fix for default marker icons in Next.js
// Leaflet's default icon paths are broken by bundlers
const DefaultIcon = L.icon({
    iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41]
})

L.Marker.prototype.options.icon = DefaultIcon

interface StoreMapPickerProps {
    initialLat?: number
    initialLng?: number
    onChange?: (lat: number, lng: number) => void
    readOnly?: boolean
    storeName?: string
}

function LocationMarker({ position, setPosition, onChange, readOnly }: any) {
    const markerRef = useRef<any>(null)

    useMapEvents({
        click(e) {
            if (readOnly) return
            setPosition(e.latlng)
            onChange?.(e.latlng.lat, e.latlng.lng)
        },
    })

    const eventHandlers = useMemo(
        () => ({
            dragend() {
                const marker = markerRef.current
                if (marker != null) {
                    const latlng = marker.getLatLng()
                    setPosition(latlng)
                    onChange?.(latlng.lat, latlng.lng)
                }
            },
        }),
        [onChange],
    )

    return position === null ? null : (
        <Marker
            position={position}
            draggable={!readOnly}
            eventHandlers={!readOnly ? eventHandlers : {}}
            ref={markerRef}
        >
            <Popup>
                {readOnly ? 'Ubicación de la Tienda' : 'Arrastrame o haz click para mover'}
            </Popup>
        </Marker>
    )
}

export default function StoreMapPicker({ initialLat, initialLng, onChange, readOnly = false, storeName }: StoreMapPickerProps) {
    // Default to Los Angeles center if no coords provided
    const defaultCenter = { lat: 34.0522, lng: -118.2437 }

    // Initial position state
    const [position, setPosition] = useState<L.LatLng | null>(
        initialLat && initialLng ? new L.LatLng(initialLat, initialLng) : null
    )

    // Center map on position or default
    const center = position || defaultCenter
    const zoom = position ? 15 : 10

    // Force map re-render if initial props change drastically (e.g. switching stores)
    // We use a key on MapContainer to reset it
    const mapKey = `${initialLat}-${initialLng}-${readOnly}`

    return (
        <div className="h-[300px] w-full rounded-xl overflow-hidden shadow-sm border border-gray-200 dark:border-slate-700 z-0 relative">
            <MapContainer
                key={mapKey}
                center={center}
                zoom={zoom}
                scrollWheelZoom={false}
                style={{ height: '100%', width: '100%' }}
            >
                <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                <LocationMarker
                    position={position}
                    setPosition={setPosition}
                    onChange={onChange}
                    readOnly={readOnly}
                />
            </MapContainer>

            {!readOnly && (
                <div className="absolute bottom-2 left-2 bg-white/90 dark:bg-slate-900/90 p-2 rounded-lg text-xs z-[1000] shadow pointer-events-none">
                    Haz click en el mapa para ubicar la tienda
                </div>
            )}
        </div>
    )
}
