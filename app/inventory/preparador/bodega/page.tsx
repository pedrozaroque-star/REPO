'use client'

import { useState, useEffect, useRef } from 'react'
import { AlertOctagon, CheckCircle2, Volume2, VolumeX, Store, Loader2, Play, Clock, Maximize, Minimize } from 'lucide-react'
import { createClient } from '@/lib/supabase-client'
        

interface PrepRequest {
    id: string
    store_id: string
    sender_name: string
    items: string[]
    status: string
    created_at: string
}

export default function BodegaPWA() {
    const supabase = createClient()

    const [mounted, setMounted] = useState(false)
    const [systemStarted, setSystemStarted] = useState(false)
    const [stores, setStores] = useState<any[]>([])
    const [storeId, setStoreId] = useState('')
    
    // Alarma
    const audioRef = useRef<HTMLAudioElement | null>(null)
    const [isMuted, setIsMuted] = useState(false)
    
    // Pending Queue
    const [pendingRequests, setPendingRequests] = useState<PrepRequest[]>([])
    
    // Fullscreen Mode
    const containerRef = useRef<HTMLDivElement>(null)
    const [isFullscreen, setIsFullscreen] = useState(false)
    
    useEffect(() => { setMounted(true) }, [])

    useEffect(() => {
        const onFullscreenChange = () => {
            setIsFullscreen(!!document.fullscreenElement)
        }
        document.addEventListener('fullscreenchange', onFullscreenChange)
        return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
    }, [])

    const toggleFullscreen = () => {
        if (!document.fullscreenElement) {
            containerRef.current?.requestFullscreen().catch(err => {
                alert(`Error intentando Fullscreen: ${err.message}`)
            })
        } else {
            document.exitFullscreen()
        }
    }

    // Fetch Stores
    useEffect(() => {
        const fetchStores = async () => {
            const { data } = await supabase.from('stores').select('id, name').eq('is_active', true).order('name')
            if (data) {
                setStores(data)
                // Use localStorage for persistence on tablets
                const saved = localStorage.getItem('teg_bodega_store')
                if (saved && data.find(s => s.id === saved)) setStoreId(saved)
                else setStoreId(data[0].id)
            }
        }
        fetchStores()
    }, [supabase])

    const startSystem = () => {
        // Unlock audio context trick
        if (audioRef.current) {
            audioRef.current.play().then(() => {
                audioRef.current!.pause()
                audioRef.current!.currentTime = 0
            }).catch(e => console.error("Audio unlock err:", e))
        }
        setSystemStarted(true)
    }

    // Main Logic: Load existing pending & Listen for Realtime inserts
    useEffect(() => {
        if (!storeId || !systemStarted) return
        localStorage.setItem('teg_bodega_store', storeId)

        const fetchPending = async () => {
            const { data, error } = await supabase
                .from('preparador_requests')
                .select('*')
                .eq('store_id', storeId)
                .eq('status', 'PENDING')
                .order('created_at', { ascending: true })
                
            if (data) {
                setPendingRequests(data)
                if (data.length > 0 && !isMuted) playAlarm()
                else stopAlarm()
            }
        }
        
        fetchPending()

        // Realtime Subscription
        const channel = supabase.channel('schema-db-changes')
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'preparador_requests',
                    filter: `store_id=eq.${storeId}`
                },
                (payload) => {
                    console.log("🔥 ALARMA ENTRANTE:", payload.new)
                    setPendingRequests(prev => [...prev, payload.new as PrepRequest])
                    if (!isMuted) playAlarm()
                }
            )
            .on(
                'postgres_changes',
                {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'preparador_requests',
                    filter: `store_id=eq.${storeId}`
                },
                (payload) => {
                    const updated = payload.new as PrepRequest
                    if (updated.status === 'ACKNOWLEDGED') {
                        setPendingRequests(prev => prev.filter(p => p.id !== updated.id))
                    }
                }
            )
            .subscribe()

        return () => {
            supabase.removeChannel(channel)
            stopAlarm()
        }
    }, [storeId, systemStarted, isMuted])

    useEffect(() => {
        // Trigger alarm state based on pending list length
        if (pendingRequests.length === 0) {
            stopAlarm()
        } else if (!isMuted && systemStarted) {
            playAlarm()
        }
    }, [pendingRequests.length, isMuted, systemStarted])

    const playAlarm = () => {
        if (audioRef.current && pendingRequests.length > 0) {
            audioRef.current.loop = true
            const playPromise = audioRef.current.play()
            if (playPromise !== undefined) {
                playPromise.catch(e => console.warn("Autoplay blocked/failed.", e))
            }
        }
    }

    const stopAlarm = () => {
        if (audioRef.current) {
            audioRef.current.pause()
            audioRef.current.currentTime = 0
        }
    }

    const handleAcknowledge = async (id: string) => {
        // optimistically remove
        setPendingRequests(prev => prev.filter(p => p.id !== id))
        
        const { error } = await supabase
            .from('preparador_requests')
            .update({ status: 'ACKNOWLEDGED', acknowledged_at: new Date().toISOString() })
            .eq('id', id)

        if (error) {
            console.error("Error al actualizar estado:", error)
        }
    }

    if (!mounted) return null

    if (!systemStarted) {
        return (
            <div className="flex flex-col items-center justify-center h-screen bg-slate-900 text-white p-6 relative overflow-hidden">
                {/* Background decorative pulsing circles */}
                <div className="absolute w-[800px] h-[800px] rounded-full border border-red-500/20 animate-ping" style={{ animationDuration: '4s' }} />
                <div className="absolute w-[1200px] h-[1200px] rounded-full border border-orange-500/10 animate-ping" style={{ animationDuration: '5s', animationDelay: '1s' }} />
                
                <div className="z-10 bg-slate-800/80 p-10 rounded-3xl border border-slate-700 max-w-xl w-full text-center shadow-2xl backdrop-blur-sm">
                    <AlertOctagon className="w-24 h-24 text-red-500 mx-auto mb-6 drop-shadow-[0_0_15px_rgba(239,68,68,0.5)]" />
                    <h1 className="text-4xl font-black tracking-tighter mb-4 text-transparent bg-clip-text bg-gradient-to-br from-white to-slate-400">TABLETA BODEGA</h1>
                    <p className="text-slate-400 font-medium mb-12 text-lg">Debes inicializar el sistema físicamente para que el navegador permita reproducir la alarma sonora cuando entre un pedido.</p>
                    
                    <button 
                        onClick={startSystem}
                        className="w-full py-6 rounded-2xl bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 text-2xl font-black text-white shadow-[0_10px_40px_rgba(220,38,38,0.4)] transition-all active:scale-95 flex items-center justify-center gap-3"
                    >
                        <Play fill="currentColor" /> INICIAR SISTEMA
                    </button>
                    
                    {/* Elemento oculto para precargar el audio de la alarma */}
                    <audio ref={audioRef} src="/sounds/alarm.mp3" preload="auto" className="hidden" />
                </div>
            </div>
        )
    }

    const hasAlert = pendingRequests.length > 0

    return (
        <div ref={containerRef} className={`flex flex-col overflow-hidden transition-colors duration-500 ${hasAlert ? 'bg-red-950' : 'bg-slate-950'} ${isFullscreen ? 'fixed inset-0 z-[9999] h-screen w-screen' : 'h-screen'}`}>
            <audio ref={audioRef} src="/sounds/alarm.mp3" preload="auto" className="hidden" />

            {/* Header / StatusBar */}
            <div className={`p-4 flex justify-between items-center transition-colors ${hasAlert ? 'bg-red-900 border-b border-red-800' : 'bg-slate-900 border-b border-slate-800'}`}>
                <div className="flex items-center gap-4">
                    <div className="bg-black/20 p-2 rounded-xl border border-white/10 text-white">
                        <Store size={20} />
                    </div>
                    <select 
                        value={storeId} 
                        onChange={e => setStoreId(e.target.value)}
                        className="bg-transparent border-none font-black text-xl text-white focus:ring-4 focus:ring-white/20 outline-none rounded-lg cursor-pointer hover:bg-white/5 py-1"
                    >
                        {stores.map(s => <option key={s.id} value={s.id} className="text-slate-900">{s.name}</option>)}
                    </select>
                </div>

                <div className="flex items-center gap-6">
                    <button 
                        onClick={toggleFullscreen}
                        className={`p-3 rounded-full transition-colors ${isFullscreen ? 'bg-white/20 text-white' : 'bg-white/10 text-white hover:bg-white/20'}`}
                        title="Modo Tableta (Pantalla Completa)"
                    >
                        {isFullscreen ? <Minimize size={24} /> : <Maximize size={24} />}
                    </button>
                    <button 
                        onClick={() => setIsMuted(!isMuted)}
                        className={`p-3 rounded-full transition-colors ${isMuted ? 'bg-slate-800 text-slate-400' : 'bg-white/10 text-white hover:bg-white/20'}`}
                    >
                        {isMuted ? <VolumeX size={24} /> : <Volume2 size={24} />}
                    </button>
                    <div className="bg-black/40 px-5 py-2 rounded-full font-mono text-white/70 font-bold tracking-widest text-sm border border-white/5">
                        LISTENING...
                    </div>
                </div>
            </div>

            {/* Main Alert Area */}
            <div className="flex-1 overflow-y-auto p-4 md:p-8 flex items-center justify-center">
                {!hasAlert ? (
                    <div className="text-center opacity-30 animate-pulse flex flex-col items-center">
                        <CheckCircle2 size={120} className="text-white mb-6" />
                        <h2 className="text-3xl font-black text-white tracking-widest">SISTEMA EN ESPERA</h2>
                        <p className="text-xl text-white/70 mt-4">No hay pedidos pendientes de línea.</p>
                    </div>
                ) : (
                    // Multiple alerts can exist, but we show the oldest (index 0) huge
                    <div className="w-full max-w-6xl mx-auto flex flex-col gap-6 animate-in zoom-in-95 duration-300">
                        {pendingRequests.map((req, idx) => (
                            <div 
                                key={req.id} 
                                className={`rounded-[40px] border flex flex-col md:flex-row overflow-hidden shadow-2xl transition-all
                                    ${idx === 0 
                                        ? 'bg-red-600 border-red-400 ring-8 ring-red-500/50 shadow-[0_0_100px_rgba(220,38,38,0.8)] scale-100 z-10' 
                                        : 'bg-red-900 border-red-800 scale-95 opacity-80 mt-[-20px] -z-10 blur-[1px]'}`}
                            >
                                {/* Peticiones (Items) */}
                                <div className="flex-1 p-8 md:p-14 flex flex-col justify-center text-white">
                                    <h3 className="text-red-200 font-bold tracking-widest uppercase text-sm md:text-xl mb-6">FALTA EN LÍNEA:</h3>
                                    <div className="flex flex-wrap gap-4 md:gap-6">
                                        {req.items.map((item, i) => (
                                            <span key={i} className="inline-block bg-white text-red-700 font-black text-3xl md:text-6xl px-6 py-4 rounded-3xl shadow-lg uppercase leading-none">
                                                {item}
                                            </span>
                                        ))}
                                    </div>
                                    <p className="mt-8 text-red-200/60 font-medium text-lg flex items-center gap-2">
                                        <Clock size={20} /> Pedido {new Date(req.created_at).toLocaleTimeString('en-US', {hour: '2-digit', minute:'2-digit'})}
                                    </p>
                                </div>

                                {/* Accion */}
                                <div className="bg-black/20 p-8 md:p-14 flex items-center justify-center md:w-[400px]">
                                    <button 
                                        onClick={() => handleAcknowledge(req.id)}
                                        className="w-full h-full min-h-[150px] md:min-h-full rounded-3xl bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 border-4 border-emerald-400 shadow-[0_0_40px_rgba(16,185,129,0.5)] flex flex-col items-center justify-center gap-4 text-white hover:scale-[1.02] transition-transform active:scale-95"
                                    >
                                        <CheckCircle2 size={80} strokeWidth={3} />
                                        <span className="font-black text-4xl uppercase tracking-tighter">ENTREGADO</span>
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
            
            {/* Visual Flasher when Alert is active */}
            {hasAlert && (
                <div className="absolute inset-0 pointer-events-none bg-red-500 opacity-20 animate-[pulse_1s_ease-in-out_infinite]" />
            )}
        </div>
    )
}
