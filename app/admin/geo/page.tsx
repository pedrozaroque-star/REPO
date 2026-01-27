
'use client'
import { useState, useEffect } from 'react'
import { getSupabaseClient } from '@/lib/supabase'
import { ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Save, MapPin, Loader2, Plus, Minus } from 'lucide-react'

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
    const [currentLat, setCurrentLat] = useState<number>(34.000000)
    const [currentLon, setCurrentLon] = useState<number>(-118.000000)
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [step, setStep] = useState<number>(0.00005) // Paso de movimiento (~5 metros)

    useEffect(() => { fetchStores() }, [])

    const fetchStores = async () => {
        setLoading(true)
        const supabase = await getSupabaseClient()
        const { data } = await supabase.from('stores').select('*').order('name')
        if (data) {
            setStores(data)
            if (data.length > 0 && !selectedStoreId) selectStore(data[0])
        }
        setLoading(false)
    }

    const selectStore = (store: Store) => {
        setSelectedStoreId(store.id)
        setCurrentLat(store.latitude || 34.0522)
        setCurrentLon(store.longitude || -118.2437)
    }

    const move = (dLat: number, dLon: number) => {
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
                alert('✅ Guardado!')
                fetchStores()
            } else {
                alert('❌ Error')
            }
        } catch (e) { alert('Error de red') }
        finally { setSaving(false) }
    }

    const selectedStore = stores.find(s => s.id === selectedStoreId)

    return (
        <div className="h-screen flex flex-col md:flex-row bg-slate-900 text-white overflow-hidden">
            {/* Sidebar List */}
            <div className="w-full md:w-80 bg-slate-800 border-r border-slate-700 flex flex-col z-20 shadow-xl">
                <div className="p-4 border-b border-slate-700">
                    <h2 className="text-xl font-bold flex items-center gap-2 text-emerald-400">
                        <MapPin /> Geo Ajuste Google
                    </h2>
                    <p className="text-xs text-slate-400">Selecciona tienda y ajusta con flechas.</p>
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-1">
                    {stores.map(store => (
                        <button
                            key={store.id}
                            onClick={() => selectStore(store)}
                            className={`w-full text-left p-3 rounded transition-colors ${selectedStoreId === store.id ? 'bg-emerald-900/50 border border-emerald-500/50 text-emerald-200' : 'hover:bg-slate-700/50 text-slate-300'
                                }`}
                        >
                            <div className="font-bold text-sm truncate">{store.name}</div>
                            <div className="text-[10px] text-slate-500 font-mono mt-1">
                                {store.latitude?.toFixed(4)}, {store.longitude?.toFixed(4)}
                            </div>
                        </button>
                    ))}
                </div>
            </div>

            {/* Main Area */}
            <div className="flex-1 relative bg-black flex flex-col">
                {selectedStore ? (
                    <>
                        {/* Google Maps Embed iframe (Satelite Híbrido 'h' o 'y') */}
                        <div className="flex-1 relative">
                            <iframe
                                title="Google Map"
                                width="100%"
                                height="100%"
                                frameBorder="0"
                                scrolling="no"
                                src={`https://maps.google.com/maps?q=${currentLat},${currentLon}&hl=es&z=20&t=k&output=embed`}
                                className="filter brightness-110 contrast-125"
                            ></iframe>

                            {/* Crosshair Overlay */}
                            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                                <div className="relative transform -translate-y-[10px]"> {/* Ajuste visual pin google */}
                                    <div className="w-16 h-16 border-2 border-red-500 rounded-full shadow-[0_0_20px_rgba(239,68,68,0.6)] bg-red-500/5 backdrop-blur-[1px]"></div>
                                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1 h-3 bg-red-500"></div>
                                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-3 h-1 bg-red-500"></div>
                                    <div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-black/80 text-white text-[10px] px-2 py-0.5 rounded font-bold whitespace-nowrap border border-red-500/50">
                                        OBJETIVO AQUÍ
                                    </div>
                                </div>
                            </div>

                            {/* Floating Controls */}
                            <div className="absolute bottom-6 right-6 flex flex-col gap-2 p-4 bg-slate-900/90 backdrop-blur-md rounded-2xl border border-slate-700 shadow-2xl z-10 w-64">
                                <div className="text-center mb-2">
                                    <div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Mover Mapa</div>
                                    <div className="font-mono text-[10px] text-emerald-400">
                                        {currentLat.toFixed(6)}, {currentLon.toFixed(6)}
                                    </div>
                                </div>

                                <div className="grid grid-cols-3 gap-2 justify-items-center mb-4">
                                    <div></div>
                                    <button onClick={() => move(step, 0)} className="w-12 h-12 bg-slate-700 hover:bg-slate-600 rounded-xl flex items-center justify-center active:scale-95 shadow-lg border-b-4 border-slate-900 active:border-b-0 active:translate-y-1 transition-all"><ArrowUp /></button>
                                    <div></div>

                                    <button onClick={() => move(0, -step)} className="w-12 h-12 bg-slate-700 hover:bg-slate-600 rounded-xl flex items-center justify-center active:scale-95 shadow-lg border-b-4 border-slate-900 active:border-b-0 active:translate-y-1 transition-all"><ArrowLeft /></button>
                                    <div className="w-12 h-12 flex items-center justify-center">
                                        <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
                                    </div>
                                    <button onClick={() => move(0, step)} className="w-12 h-12 bg-slate-700 hover:bg-slate-600 rounded-xl flex items-center justify-center active:scale-95 shadow-lg border-b-4 border-slate-900 active:border-b-0 active:translate-y-1 transition-all"><ArrowRight /></button>

                                    <div></div>
                                    <button onClick={() => move(-step, 0)} className="w-12 h-12 bg-slate-700 hover:bg-slate-600 rounded-xl flex items-center justify-center active:scale-95 shadow-lg border-b-4 border-slate-900 active:border-b-0 active:translate-y-1 transition-all"><ArrowDown /></button>
                                    <div></div>
                                </div>

                                <div className="flex justify-between items-center text-xs text-slate-500 px-2 mb-2">
                                    <span>Precisión:</span>
                                    <div className="flex gap-1 bg-slate-800 rounded p-1">
                                        <button onClick={() => setStep(0.00002)} className={`px-2 py-0.5 rounded ${step < 0.00005 ? 'bg-emerald-600 text-white' : ''}`}>Fina</button>
                                        <button onClick={() => setStep(0.0001)} className={`px-2 py-0.5 rounded ${step > 0.00005 ? 'bg-emerald-600 text-white' : ''}`}>Rápida</button>
                                    </div>
                                </div>

                                <button onClick={saveCoords} disabled={saving} className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl shadow-lg shadow-emerald-900/50 active:scale-95 transition-all flex items-center justify-center gap-2">
                                    {saving ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
                                    GUARDAR
                                </button>
                            </div>
                        </div>
                    </>
                ) : (
                    <div className="flex items-center justify-center h-full text-slate-500">Selecciona una tienda</div>
                )}
            </div>
        </div>
    )
}
