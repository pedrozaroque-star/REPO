
'use client'
import { useState, useEffect } from 'react'
import { getSupabaseClient } from '@/lib/supabase'
import { ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Save, MapPin } from 'lucide-react'

// Simple interface for Store
interface Store {
    id: string
    name: string
    latitude: number
    longitude: number
    address: string
}

export default function GeoAdminPage() {
    const [stores, setStores] = useState<Store[]>([])
    const [selectedStoreId, setSelectedStoreId] = useState<string | null>(null)
    const [currentLat, setCurrentLat] = useState<number>(0)
    const [currentLon, setCurrentLon] = useState<number>(0)
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)

    useEffect(() => {
        fetchStores()
    }, [])

    const fetchStores = async () => {
        setLoading(true)
        const supabase = getSupabaseClient()
        const { data, error } = await supabase.from('stores').select('id, name, latitude, longitude, address').order('name')
        if (data) {
            setStores(data)
            if (data.length > 0 && !selectedStoreId) {
                selectStore(data[0])
            }
        }
        setLoading(false)
    }

    const selectStore = (store: Store) => {
        setSelectedStoreId(store.id)
        setCurrentLat(store.latitude || 34.0000)
        setCurrentLon(store.longitude || -118.0000)
    }

    const adjust = (dLat: number, dLon: number) => {
        setCurrentLat(prev => Number((prev + dLat).toFixed(6)))
        setCurrentLon(prev => Number((prev + dLon).toFixed(6)))
    }

    const saveCoords = async () => {
        if (!selectedStoreId) return
        setSaving(true)
        try {
            const res = await fetch('/api/admin/update-coords', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ storeId: selectedStoreId, lat: currentLat, lon: currentLon })
            })
            if (res.ok) {
                alert('Coordenadas actualizadas!')
                fetchStores() // Refresh list
            } else {
                alert('Error al guardar')
            }
        } catch (e) {
            console.error(e)
            alert('Error de red')
        } finally {
            setSaving(false)
        }
    }

    const selectedStore = stores.find(s => s.id === selectedStoreId)

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-900 p-6 flex flex-col md:flex-row gap-6">

            {/* Sidebar List */}
            <div className="w-full md:w-1/4 bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-4 h-[80vh] overflow-y-auto">
                <h2 className="text-xl font-black text-slate-800 dark:text-white mb-4 flex items-center gap-2">
                    <MapPin /> Tiendas
                </h2>
                <div className="flex flex-col gap-2">
                    {stores.map(store => (
                        <button
                            key={store.id}
                            onClick={() => selectStore(store)}
                            className={`p-3 rounded-xl text-left transition-all border ${selectedStoreId === store.id
                                ? 'bg-indigo-50 dark:bg-indigo-900/30 border-indigo-200 dark:border-indigo-700 ring-1 ring-indigo-500'
                                : 'bg-slate-50 dark:bg-slate-700/50 border-transparent hover:bg-slate-100 dark:hover:bg-slate-700'}`}
                        >
                            <div className="font-bold text-slate-700 dark:text-slate-200">{store.name}</div>
                            <div className="text-xs text-slate-400 truncate">{store.address}</div>
                            <div className="text-[10px] font-mono text-slate-300 mt-1">
                                {store.latitude?.toFixed(4)}, {store.longitude?.toFixed(4)}
                            </div>
                        </button>
                    ))}
                </div>
            </div>

            {/* Main Editor */}
            <div className="flex-1 bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-1 flex flex-col overflow-hidden h-[80vh]">
                {selectedStore ? (
                    <>
                        <div className="flex-1 relative bg-slate-100">
                            {/* Google Maps Embed iframe with Satelite view (t=k) */}
                            <iframe
                                title="Map Preview"
                                width="100%"
                                height="100%"
                                frameBorder="0"
                                scrolling="no"
                                marginHeight={0}
                                marginWidth={0}
                                src={`https://maps.google.com/maps?q=${currentLat},${currentLon}&hl=es&z=19&t=k&output=embed`}
                            >
                            </iframe>

                            {/* Crosshair Overlay to show center */}
                            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                                <div className="relative">
                                    <div className="w-8 h-8 border-2 border-red-500 rounded-full shadow-sm bg-red-500/10 backdrop-blur-sm z-10"></div>
                                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1 h-1 bg-red-500 rounded-full"></div>
                                    <div className="absolute top-[-10px] left-1/2 -translate-x-1/2 -translate-y-full bg-black/70 text-white text-[10px] px-2 py-1 rounded whitespace-nowrap">
                                        Objetivo
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Controls */}
                        <div className="p-4 bg-slate-50 dark:bg-slate-900 border-t border-slate-200 dark:border-slate-700 z-10">
                            <div className="flex flex-col md:flex-row items-center justify-between gap-4">
                                <div>
                                    <h3 className="font-bold text-lg text-slate-800 dark:text-white flex items-center gap-2">
                                        {selectedStore.name}
                                        <span className="text-xs font-normal text-slate-500 px-2 py-0.5 bg-slate-200 dark:bg-slate-700 rounded-full">
                                            {selectedStore.address}
                                        </span>
                                    </h3>
                                    <div className="flex gap-4 mt-1 font-mono text-sm text-slate-600 dark:text-slate-400">
                                        <span>Lat: <b className="text-indigo-600">{currentLat}</b></span>
                                        <span>Lon: <b className="text-indigo-600">{currentLon}</b></span>
                                    </div>
                                    <p className="text-xs text-slate-400 mt-1">Usa las flechas para centrar el PIN rojo en el techo del local.</p>
                                </div>

                                {/* D-Pad Controls */}
                                <div className="flex flex-col items-center gap-1">
                                    <button
                                        onClick={() => adjust(0.00005, 0)}
                                        className="p-2 bg-slate-200 dark:bg-slate-700 rounded-lg hover:bg-slate-300 active:bg-slate-400 transition-colors"
                                        title="Norte (+5m)"
                                    >
                                        <ArrowUp size={20} />
                                    </button>
                                    <div className="flex gap-1">
                                        <button
                                            onClick={() => adjust(0, -0.00005)}
                                            className="p-2 bg-slate-200 dark:bg-slate-700 rounded-lg hover:bg-slate-300 active:bg-slate-400 transition-colors"
                                            title="Oeste (-5m)"
                                        >
                                            <ArrowLeft size={20} />
                                        </button>
                                        <div className="w-10 h-10"></div> {/* Spacer */}
                                        <button
                                            onClick={() => adjust(0, 0.00005)}
                                            className="p-2 bg-slate-200 dark:bg-slate-700 rounded-lg hover:bg-slate-300 active:bg-slate-400 transition-colors"
                                            title="Este (+5m)"
                                        >
                                            <ArrowRight size={20} />
                                        </button>
                                    </div>
                                    <button
                                        onClick={() => adjust(-0.00005, 0)}
                                        className="p-2 bg-slate-200 dark:bg-slate-700 rounded-lg hover:bg-slate-300 active:bg-slate-400 transition-colors"
                                        title="Sur (-5m)"
                                    >
                                        <ArrowDown size={20} />
                                    </button>
                                </div>

                                <button
                                    onClick={saveCoords}
                                    disabled={saving}
                                    className="flex items-center gap-2 px-6 py-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold shadow-lg shadow-emerald-200 dark:shadow-none transition-all active:scale-95 disabled:opacity-50 disabled:scale-100"
                                >
                                    <Save size={20} />
                                    {saving ? 'Guardando...' : 'Guardar Ubicación Exacta'}
                                </button>
                            </div>
                        </div>
                    </>
                ) : (
                    <div className="flex items-center justify-center h-full text-slate-400">
                        Selecciona una tienda
                    </div>
                )}
            </div>
        </div>
    )
}
