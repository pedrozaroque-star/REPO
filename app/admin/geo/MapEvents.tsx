
'use client'
import { useMapEvents } from 'react-leaflet'

// Componente hijo que accede al contexto del mapa
export default function MapEvents({ onMove }: { onMove: (lat: number, lon: number) => void }) {
    const map = useMapEvents({
        move: () => {
            const center = map.getCenter()
            onMove(center.lat, center.lng)
        },
        moveend: () => {
            const center = map.getCenter()
            onMove(center.lat, center.lng) // Asegurar update final
        }
    })
    return null
}
