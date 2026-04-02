'use client'

import { useState, useEffect, useRef } from 'react'
import { AlertOctagon, CheckCircle2, Volume2, VolumeX, Store, Loader2, Play, Clock, Maximize, Minimize, HelpCircle, X } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { createClient } from '@/lib/supabase-client'
import { useAuth } from '@/components/ProtectedRoute'

interface PrepRequest {
    id: string
    store_id: string
    sender_name: string
    items: string[]
    status: string
    created_at: string
}

interface MeatData {
    interval_start: string
    meat_type: string
    avg_lbs: number
    samples: number
}

export default function BodegaPWA() {
    const supabase = createClient()

    const [mounted, setMounted] = useState(false)
    const [systemStarted, setSystemStarted] = useState(false)
    const [stores, setStores] = useState<any[]>([])
    const [storeId, setStoreId] = useState('')
    const [businessDow, setBusinessDow] = useState<number | null>(null)
    
    // Alarma
    const audioRef = useRef<HTMLAudioElement | null>(null)
    const [isMuted, setIsMuted] = useState(false)
    
    // Pending Queue
    const [pendingRequests, setPendingRequests] = useState<PrepRequest[]>([])
    const [beverageAlerts, setBeverageAlerts] = useState<any[]>([])
    
    // Meat Historial Data (Cabeza, Lengua)
    const [meatData, setMeatData] = useState<MeatData[]>([])
    const [fetchingMeat, setFetchingMeat] = useState(false)
    const [carouselBuckets, setCarouselBuckets] = useState<{id: string, label: string, data: MeatData[], isCurrent: boolean}[]>([])
    const [activeIndex, setActiveIndex] = useState(0)
    
    // Touch handlers for carousel swipe
    const [touchStart, setTouchStart] = useState<number | null>(null)
    const [touchEnd, setTouchEnd] = useState<number | null>(null)
    const [showInfoModal, setShowInfoModal] = useState(false)

    // Snap back timer: si mueves el carrusel, a los 5 seg regresa solito a AHORA
    useEffect(() => {
        let timer: NodeJS.Timeout
        if (activeIndex !== 0) {
            timer = setTimeout(() => {
                setActiveIndex(0)
            }, 5000)
        }
        return () => clearTimeout(timer)
    }, [activeIndex])

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

    const { user } = useAuth()
    
    // Fetch Stores
    useEffect(() => {
        const fetchStores = async () => {
            const { data } = await supabase.from('stores').select('id, name').eq('is_active', true).order('name')
            if (data) {
                setStores(data)
                // Forzar tienda si el usuario no es admin/supervisor y tiene tienda asignada
                const isSuper = ['admin', 'supervisor'].includes(user?.role?.toLowerCase() || '')
                if (user && !isSuper && user.store_id) {
                    setStoreId(user.store_id)
                } else {
                    // Recordar o default si es supervisor/admin
                    const saved = localStorage.getItem('teg_bodega_store')
                    if (saved && data.find(s => s.id === saved)) setStoreId(saved)
                    else setStoreId(data[0].id)
                }
            }
        }
        if (user !== undefined) fetchStores()
    }, [supabase, user])

    // Track Business DOW dynamically (rolls over at 6:00 AM LA time)
    useEffect(() => {
        const updateBusinessDow = () => {
            const laTimeStr = new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })
            const laDate = new Date(laTimeStr)
            
            // Regla de Tacos Gavilan: El día cambia a las 6:00 AM, no a la medianoche.
            if (laDate.getHours() < 6) {
                laDate.setDate(laDate.getDate() - 1)
            }
            
            const dayNum = laDate.getDay() // 0 = Sunday
            const currentDow = dayNum === 0 ? 7 : dayNum // 1-7 format mapping
            
            setBusinessDow(prev => {
                if (prev !== currentDow) return currentDow
                return prev
            })
        }
        
        updateBusinessDow()
        const interval = setInterval(updateBusinessDow, 60000)
        return () => clearInterval(interval)
    }, [])

    // Load Meat Historial (Solo Cabeza y Lengua para la Bodega)
    useEffect(() => {
        if (!storeId || businessDow === null) return
        const fetchHistory = async () => {
            setFetchingMeat(true)
            try {
                const res = await fetch(`/api/inventory/preparador-history?storeId=${storeId}&dow=${businessDow}`)
                const json = await res.json()
                if (Array.isArray(json)) {
                    // Pre-filtro: La bodega proyecta Lentos y Bebidas
                    const allowedTypes = ['CABEZA', 'LENGUA', 'CAFE', 'CHAMPURRADO', 'AGUACATE', 'FRIJOL MOLIDO', 'ARROZ']
                    const filtered = json.filter(m => allowedTypes.includes(m.meat_type))
                    setMeatData(filtered)
                }
            } catch (err) {
                console.error(err)
            } finally {
                setFetchingMeat(false)
            }
        }
        fetchHistory()
    }, [storeId, businessDow])

    // Clock Bucket Updater
    useEffect(() => {
        const updateBuckets = () => {
            const d = new Date()
            const formatter = new Intl.DateTimeFormat('en-US', {
                timeZone: 'America/Los_Angeles', hour: 'numeric', minute: 'numeric', hour12: false
            });
            let timeParts = formatter.format(d).split(':')
            let h = parseInt(timeParts[0], 10)
            let m = parseInt(timeParts[1], 10)
            if (h === 24) h = 0;
            
            // Current Bucket
            let curM = m >= 30 ? 30 : 0
            
            const formatTime12 = (hr: number, min: number) => {
                const p = hr >= 12 ? 'pm' : 'am'
                let h12 = hr % 12
                if (h12 === 0) h12 = 12
                return `${h12}:${min.toString().padStart(2, '0')}${p}`
            }
            
            const arr = []
            let curHStr = h.toString().padStart(2, '0')
            let curMStr = curM.toString().padStart(2, '0')
            let tempH = h
            let tempM = curM
            
            // Generate next 10 buckets for the carousel
            for (let i = 0; i < 10; i++) {
                let hrStr = tempH.toString().padStart(2, '0')
                let minStr = tempM.toString().padStart(2, '0')
                let bucketId = `${hrStr}:${minStr}:00`
                
                let nxtM = tempM === 0 ? 30 : 0
                let nxtH = tempM === 30 ? (tempH + 1) % 24 : tempH
                
                let label = `${formatTime12(tempH, tempM)} a ${formatTime12(nxtH, nxtM)}`
                
                let data: MeatData[] = []
                if (meatData.length > 0) {
                    data = meatData.filter(m => m.interval_start === bucketId)
                }
                
                arr.push({ id: bucketId, label, isCurrent: i === 0, data })
                
                tempH = nxtH
                tempM = nxtM
            }

            setCarouselBuckets(arr)
        }
        
        updateBuckets()
        const int = setInterval(updateBuckets, 60000)
        return () => clearInterval(int)
    }, [meatData])

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
    
    // --- LÓGICA DE CUOTAS DE BEBIDAS (15 MINUTOS) ---
    useEffect(() => {
        if (!systemStarted || meatData.length === 0) return

        const checkBeverages = () => {
            const laTimeStr = new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })
            const now = new Date(laTimeStr)
            
            const currentH = now.getHours()
            const currentM = now.getMinutes()
            
            // Limit fractions to 15 min chunks to match exactly 15 min intervals tracking
            const currentMinRounded = Math.floor(currentM / 15) * 15
            const currentTimeInMins = currentH * 60 + currentMinRounded
            
            // Reset daily counters at 6:00 AM LA Time
            const dayStr = currentH < 6 ? `${now.getDate() - 1}` : `${now.getDate()}`
            const savedDate = localStorage.getItem('teg_bev_date')
            if (savedDate !== dayStr) {
                localStorage.setItem('teg_bev_date', dayStr)
                localStorage.setItem('teg_cafeteras_ack', '0')
                localStorage.setItem('teg_galones_ack', '0')
            }
            
            const getCumulativeSales = (meatType: string) => {
                let totalExpected = 0
                meatData.forEach(m => {
                    if (m.meat_type !== meatType) return
                    let [hh, mm] = m.interval_start.split(':').map(Number)
                    if (hh < 6) hh += 24
                    const bucketStartMins = hh * 60 + mm
                    if (bucketStartMins + 30 <= currentTimeInMins) {
                        totalExpected += m.avg_lbs
                    } else if (bucketStartMins < currentTimeInMins) {
                        const passedMins = currentTimeInMins - bucketStartMins
                        totalExpected += m.avg_lbs * (passedMins / 30)
                    }
                })
                return totalExpected
            }

            const totalCafe = getCumulativeSales('CAFE')
            const totalChamp = getCumulativeSales('CHAMPURRADO')
            
            // Cuotas: 1 Cafetera = 4 cafés (alerta al 75% = >= 3). 1 Galón = 20 champurrados (alerta al 75% = >= 15)
            const reqCafeteras = Math.floor(totalCafe / 4) + (totalCafe % 4 >= 3 ? 1 : 0)
            const reqGalones = Math.floor(totalChamp / 20) + (totalChamp % 20 >= 15 ? 1 : 0)
            
            const ackCafeteras = parseInt(localStorage.getItem('teg_cafeteras_ack') || '0', 10)
            const ackGalones = parseInt(localStorage.getItem('teg_galones_ack') || '0', 10)
            
            let newAlerts: any[] = []
            
            if (reqCafeteras > ackCafeteras) {
                const diff = reqCafeteras - ackCafeteras
                for (let i = 0; i < diff; i++) {
                    newAlerts.push({ 
                        id: `SYS_CAFE_${ackCafeteras + i + 1}`, 
                        items: ['1 CAFETERA'], 
                        type: 'CAFE', 
                        number: ackCafeteras + i + 1,
                        created_at: now.toISOString(),
                        is_sys: true
                    })
                }
            }
            
            if (reqGalones > ackGalones) {
                const diff = reqGalones - ackGalones
                for (let i = 0; i < diff; i++) {
                    newAlerts.push({ 
                        id: `SYS_CHAMP_${ackGalones + i + 1}`, 
                        items: ['1 GALON CHAMPURRADO'], 
                        type: 'CHAMP', 
                        number: ackGalones + i + 1,
                        created_at: now.toISOString(),
                        is_sys: true
                    })
                }
            }
            
            setBeverageAlerts(prev => {
                if (newAlerts.length > prev.length) {
                    if (audioRef.current && !isMuted) {
                        audioRef.current.currentTime = 0
                        audioRef.current.play().catch(()=>{})
                    }
                }
                return newAlerts
            })
        }

        checkBeverages()
        const int = setInterval(checkBeverages, 60000)
        return () => clearInterval(int)
    }, [systemStarted, meatData, isMuted])

    const handleAcknowledgeBeverage = (alert: any) => {
        if (alert.type === 'CAFE') {
            localStorage.setItem('teg_cafeteras_ack', alert.number.toString())
        } else {
            localStorage.setItem('teg_galones_ack', alert.number.toString())
        }
        setBeverageAlerts(prev => prev.filter(a => a.id !== alert.id))
    }
    // --- FIN LÓGICA DE BEBIDAS ---

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
            }
        }
        
        fetchPending()

        // 1. RECOVERY POLLER: Las cocinas pierden WiFi. Un "latido" cada 20 segundos asegura que nunca se quede trabado si el Websocket falla.
        const fallbackSafetyNet = setInterval(() => {
            fetchPending()
        }, 20000)

        // 2. REALTIME WEBSOCKET
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
                    console.log("🔥 ALARMA ENTRANTE (WS):", payload.new)
                    fetchPending() // Fetch full truth for safety rather than mutating array
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
                    fetchPending()
                }
            )
            .subscribe((status) => {
                if (status === 'SUBSCRIBED') {
                    // Si el internet regresó y el websocket vuelve a revivir, descarga los perdidos de inmediato
                    fetchPending()
                }
            })

        return () => {
            clearInterval(fallbackSafetyNet)
            supabase.removeChannel(channel)
            stopAlarm()
        }
    }, [storeId, systemStarted]) // Nota: isMuted fue removido de la dependencia para no tumbar la conexión cada vez que mutean

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

    const allAlerts = [...pendingRequests, ...beverageAlerts].sort((a,b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    const hasAlert = allAlerts.length > 0

    return (
        <div ref={containerRef} className={`flex flex-col overflow-hidden transition-colors duration-500 ${hasAlert ? 'bg-red-950' : 'bg-slate-950'} ${isFullscreen ? 'fixed inset-0 z-[9999] h-screen w-screen' : 'h-screen'}`}>
            <audio ref={audioRef} src="/sounds/alarm.mp3" preload="auto" className="hidden" />

            {/* Header / StatusBar */}
            <div className={`p-4 flex flex-col md:flex-row gap-4 justify-between items-center transition-colors shadow-sm shrink-0 ${hasAlert ? 'bg-red-900 border-b border-red-800' : 'bg-slate-900 border-b border-slate-800'}`}>
                <div className="flex items-center gap-4 w-full md:w-auto justify-center md:justify-start">
                    <div className="bg-black/20 p-2 rounded-xl border border-white/10 text-white">
                        <Store size={20} />
                    </div>
                    {(() => {
                        const isSuper = ['admin', 'supervisor'].includes(user?.role?.toLowerCase() || '')
                        return (
                            <select 
                                value={storeId} 
                                onChange={e => {
                                    setStoreId(e.target.value)
                                    localStorage.setItem('teg_bodega_store', e.target.value)
                                }}
                                disabled={!isSuper}
                                className={`border-none font-black text-xl focus:ring-4 focus:ring-white/20 outline-none rounded-lg py-1 ${!isSuper ? 'bg-transparent text-slate-400 cursor-not-allowed opacity-80' : 'bg-transparent text-white cursor-pointer hover:bg-white/5'}`}
                            >
                                {stores.map(s => <option key={s.id} value={s.id} className="text-slate-900">{s.name}</option>)}
                            </select>
                        )
                    })()}
                </div>

                <div className="flex items-center gap-4 md:gap-6 w-full md:w-auto justify-center md:justify-end">
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
                    <div className="w-full h-full flex flex-col lg:flex-row gap-8 items-stretch justify-center max-w-[1600px] mx-auto animate-in fade-in duration-500 py-4">
                        {/* LADO IZQUIERDO: RITMO DE COCCIÓN (Cabeza y Lengua) */}
                        <div className="w-full lg:w-1/2 bg-slate-900 border border-slate-800 rounded-3xl p-6 md:p-10 flex flex-col shadow-2xl relative overflow-hidden shrink-0 lg:shrink">
                            {/* Decorative glow */}
                            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 to-indigo-500" />
                            
                            <div className="flex items-center gap-4 mb-8 shrink-0">
                                <Clock className="w-10 h-10 md:w-12 md:h-12 text-blue-500" />
                                <div>
                                    <h2 className="text-2xl md:text-3xl font-black text-white uppercase tracking-wider">Ritmo de Cocción</h2>
                                    <p className="text-slate-400 font-medium md:text-lg">Proyección Histórica (Bodega)</p>
                                </div>
                            </div>

                            {fetchingMeat ? (
                                <div className="flex flex-col items-center justify-center flex-1 text-slate-500 gap-4">
                                    <Loader2 className="w-12 h-12 animate-spin text-blue-500" />
                                    <p className="font-bold text-lg">Calculando proyecciones...</p>
                                </div>
                            ) : (
                                <div 
                                    className="flex-1 flex flex-col items-center gap-6 xl:gap-8 overflow-hidden touch-none py-4 px-2 [perspective:1200px]"
                                    onWheel={(e) => {
                                        if (e.deltaY > 0 && activeIndex < carouselBuckets.length - 2) setActiveIndex(prev => prev + 1)
                                        if (e.deltaY < 0 && activeIndex > 0) setActiveIndex(prev => prev - 1)
                                    }}
                                    onTouchStart={(e) => {
                                        setTouchEnd(null)
                                        setTouchStart(e.targetTouches[0].clientY)
                                    }}
                                    onTouchMove={(e) => {
                                        setTouchEnd(e.targetTouches[0].clientY)
                                    }}
                                    onTouchEnd={() => {
                                        if (!touchStart || !touchEnd) return
                                        const distance = touchStart - touchEnd
                                        const isSwipeUp = distance > 50
                                        const isSwipeDown = distance < -50
                                        
                                        if (isSwipeUp && activeIndex < carouselBuckets.length - 2) {
                                            setActiveIndex(prev => prev + 1)
                                        }
                                        if (isSwipeDown && activeIndex > 0) {
                                            setActiveIndex(prev => prev - 1)
                                        }
                                    }}
                                >
                                    <AnimatePresence mode="popLayout">
                                    {carouselBuckets.slice(activeIndex, activeIndex + 2).map((bucket, localIndex) => {
                                        const isTop = localIndex === 0;
                                        const isRealCurrent = bucket.isCurrent;
                                        
                                        return (
                                            <motion.div 
                                                key={bucket.id}
                                                layout
                                                initial={{ opacity: 0, rotateX: -60, y: 150, z: -300 }}
                                                animate={{ opacity: 1, rotateX: 0, y: 0, z: 0 }}
                                                exit={{ opacity: 0, rotateX: 60, y: -150, z: -300 }}
                                                transition={{ duration: 0.6, type: 'spring', bounce: 0.2 }}
                                                className="w-full shrink-0 origin-center select-none"
                                                style={{ transformStyle: 'preserve-3d' }}
                                            >
                                                <div 
                                                    onClick={() => { if (isTop) setShowInfoModal(true) }}
                                                    className={`rounded-3xl border border-slate-700 p-6 xl:p-8 shadow-2xl transition-all duration-500 overflow-hidden relative ${
                                                    isTop 
                                                        ? 'bg-slate-800/80 shadow-inner cursor-pointer hover:ring-2 hover:ring-blue-500/50' 
                                                        : 'bg-slate-900/50 border-dashed opacity-60'
                                                }`}>
                                                    
                                                    <div className="flex justify-between items-center mb-6 pb-4 border-b border-slate-700/50">
                                                        <div className={`font-black tracking-tight flex items-center gap-3 ${isTop ? 'text-blue-400' : 'text-slate-500'}`}>
                                                            {isRealCurrent && <div className="w-4 h-4 rounded-full bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.8)] animate-pulse" />}
                                                            <div className="flex flex-col md:flex-row md:items-center gap-1 md:gap-4">
                                                                <span className="uppercase text-lg md:text-2xl flex items-center gap-2">
                                                                    {isRealCurrent && isTop ? 'AHORA' : (!isTop && activeIndex === 0 ? 'SIGUIENTE' : 'PROYECCIÓN')}
                                                                    {isTop && <HelpCircle size={20} className="text-blue-500/50" />}
                                                                </span>
                                                                <span className={`text-base md:text-xl font-bold [font-feature-settings:'tnum'] ${isTop ? 'opacity-90' : 'opacity-60'}`}>
                                                                    {bucket.label}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                                                                   {(() => {
                                                        const renderMeatCard = (meatKey: string) => {
                                                            const m = bucket.data.find((d: any) => d.meat_type === meatKey) || { meat_type: meatKey, avg_lbs: 0 };
                                                            let val = m.avg_lbs;
                                                            let unitLab = 'lbs';
                                                            let typeLab = m.meat_type;
                                                            
                                                            if (m.meat_type === 'CAFE') {
                                                                val = m.avg_lbs / 4;
                                                                unitLab = 'cafeteras';
                                                                typeLab = 'CAFÉ';
                                                            } else if (m.meat_type === 'CHAMPURRADO') {
                                                                val = m.avg_lbs / 20;
                                                                unitLab = 'porciones';
                                                            } else if (m.meat_type === 'AGUACATE') {
                                                                val = m.avg_lbs / 2;
                                                                unitLab = 'bolsas';
                                                                typeLab = 'GUACAMOLE';
                                                            } else if (m.meat_type === 'FRIJOL MOLIDO') {
                                                                unitLab = 'lbs';
                                                                typeLab = 'FRIJOL MOLIDO';
                                                            } else if (m.meat_type === 'ARROZ') {
                                                                unitLab = 'lbs';
                                                                typeLab = 'ARROZ';
                                                            }

                                                            return (
                                                            <div key={m.meat_type} className={`rounded-xl md:rounded-2xl flex flex-col items-center justify-center border shadow-md ${isTop ? 'bg-slate-950/50 p-3 md:p-5 border-slate-700/50' : 'bg-slate-950/30 p-2 md:p-4 border-slate-800'}`}>
                                                                <span className={`font-black uppercase tracking-widest mb-1 md:mb-2 text-center leading-none ${isTop ? 'text-[10px] xl:text-sm text-slate-400' : 'text-[9px] md:text-xs text-slate-600'}`}>{typeLab}</span>
                                                                <span className={`font-black tracking-tighter flex items-baseline gap-1 ${isTop ? 'text-3xl xl:text-5xl text-white' : 'text-xl md:text-2xl text-slate-400'}`}>
                                                                    {val.toFixed(1)} <span className={`font-medium opacity-50 ${isTop ? 'text-xs xl:text-base text-slate-500' : 'text-[10px] md:text-xs text-slate-600'}`}>{unitLab}</span>
                                                                </span>
                                                            </div>
                                                        )};

                                                        return (
                                                            <div className="flex flex-col gap-3 lg:gap-4">
                                                                <div className="grid grid-cols-2 lg:grid-cols-2 gap-3 lg:gap-4">
                                                                    {['CABEZA', 'LENGUA'].map(renderMeatCard)}
                                                                </div>
                                                                <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 lg:gap-4">
                                                                    {['AGUACATE', 'FRIJOL MOLIDO', 'ARROZ'].map(renderMeatCard)}
                                                                </div>
                                                            </div>
                                                        );
                                                    })()}
                                                </div>
                                            </motion.div>
                                        )
                                    })}
                                    </AnimatePresence>
                                    
                                    {/* Pagination Indicators */}
                                    <div className="absolute top-0 right-0 h-full w-8 flex flex-col items-center justify-center gap-1 opacity-30 z-10 pointer-events-none hidden md:flex">
                                        {carouselBuckets.map((b, i) => (
                                            <div key={b.id} className={`w-1.5 h-1.5 rounded-full transition-all duration-300 ${i === activeIndex ? 'bg-blue-500 scale-150' : i === activeIndex + 1 ? 'bg-slate-600' : 'bg-slate-800'}`} />
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* LADO DERECHO: ESTADO SISTEMA (ESPERA) */}
                        <div className="w-full lg:w-1/2 flex flex-col items-center justify-center opacity-30 animate-pulse py-10 lg:py-0 shrink-0 lg:shrink">
                            <CheckCircle2 size={160} className="text-white mb-6 md:mb-10 w-32 h-32 md:w-40 md:h-40 shrink-0" />
                            <h2 className="text-3xl md:text-5xl font-black text-white tracking-widest text-center">SISTEMA EN ESPERA</h2>
                            <p className="text-xl md:text-2xl text-white/70 mt-4 md:mt-6 text-center">No hay pedidos pendientes de línea.</p>
                        </div>
                    </div>
                ) : (
                    // Render all alerts as fully visible, actionable cards in a scrollable list
                    <div className="w-full max-w-6xl mx-auto flex flex-col gap-6 lg:gap-10 animate-in zoom-in-95 duration-300 pb-20">
                        {allAlerts.map((req, idx) => (
                            <div 
                                key={req.id} 
                                className={`rounded-[40px] border flex flex-col lg:flex-row overflow-hidden shadow-2xl shrink-0 transition-transform hover:scale-[1.01] ${(req as any).is_sys ? 'bg-orange-600 border-orange-400' : 'bg-red-600 border-red-400'} ${idx === 0 ? `ring-8 ${(req as any).is_sys ? 'ring-orange-500/50 shadow-[0_0_100px_rgba(234,88,12,0.6)]' : 'ring-red-500/50 shadow-[0_0_100px_rgba(220,38,38,0.6)]'}` : `shadow-[0_20px_50px_${(req as any).is_sys ? 'rgba(234,88,12,0.3)' : 'rgba(220,38,38,0.3)'}]`}`}
                            >
                                {/* Peticiones (Items) */}
                                <div className="flex-1 p-8 md:p-14 flex flex-col justify-center text-white">
                                    <h3 className={`${(req as any).is_sys ? 'text-orange-200' : 'text-red-200'} font-bold tracking-widest uppercase text-sm md:text-xl mb-6`}>
                                        {(req as any).is_sys ? 'CUOTA ALCANZADA (PROYECCIÓN):' : 'FALTA EN LÍNEA:'}
                                    </h3>
                                    <div className="flex flex-wrap gap-4 md:gap-6">
                                        {req.items.map((item: string, i: number) => (
                                            <span key={i} className={`inline-block bg-white ${(req as any).is_sys ? 'text-orange-700' : 'text-red-700'} font-black text-3xl md:text-6xl px-6 py-4 rounded-3xl shadow-lg uppercase leading-none`}>
                                                {item}
                                            </span>
                                        ))}
                                    </div>
                                    <p className={`mt-8 ${(req as any).is_sys ? 'text-orange-200/60' : 'text-red-200/60'} font-medium text-lg flex items-center gap-2`}>
                                        <Clock size={20} /> {(req as any).is_sys ? 'Alerta ' : 'Pedido '} {new Date(req.created_at).toLocaleTimeString('en-US', {hour: '2-digit', minute:'2-digit'})}
                                    </p>
                                </div>

                                {/* Accion */}
                                <div className="bg-black/20 p-8 md:p-14 flex items-center justify-center md:w-[400px]">
                                    <button 
                                        onClick={() => {
                                            if ((req as any).is_sys) {
                                                handleAcknowledgeBeverage(req)
                                            } else {
                                                handleAcknowledge(req.id)
                                            }
                                        }}
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

            {/* Info Modal */}
            <AnimatePresence>
                {showInfoModal && (
                    <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4">
                        <motion.div 
                            initial={{ opacity: 0 }} 
                            animate={{ opacity: 1 }} 
                            exit={{ opacity: 0 }} 
                            className="absolute inset-0 bg-slate-950/80 backdrop-blur-md"
                            onClick={() => setShowInfoModal(false)}
                        />
                        <motion.div 
                            initial={{ opacity: 0, scale: 0.95, y: 20 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95, y: 20 }}
                            className="bg-slate-900 border border-slate-700 w-full max-w-[95vw] 2xl:max-w-7xl rounded-[32px] p-6 md:p-10 shadow-2xl relative z-10 max-h-[95vh] flex flex-col"
                        >
                            <button 
                                onClick={() => setShowInfoModal(false)}
                                className="absolute top-6 right-6 p-2 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
                            >
                                <X size={24} />
                            </button>
                            
                            <h2 className="text-2xl md:text-3xl font-black text-white mb-2 tracking-tight">
                                Proyecciones de Bodega
                            </h2>
                            <p className="text-slate-400 mb-6 md:mb-8 border-b border-slate-800 pb-4 md:pb-6 text-sm md:text-base shrink-0">
                                Cómo el sistema de Inteligencia Artificial calcula estas cantidades históricas para tu tienda:
                            </p>
                            
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 text-slate-300 overflow-y-auto shrink pb-2">
                                <div className="bg-slate-800/40 p-5 md:p-6 rounded-3xl border border-slate-700/50 relative overflow-hidden">
                                    <div className="absolute top-0 right-0 w-32 h-32 bg-orange-500/10 rounded-full blur-3xl" />
                                    <h3 className="text-xl md:text-2xl font-black tracking-widest text-white uppercase mb-4 flex items-center gap-3">
                                        <span className="text-2xl">☕</span> Bebidas Lentas
                                    </h3>
                                    <p className="mb-5 text-slate-400 font-medium leading-relaxed">
                                        El sistema <b className="text-white">monitorea en segundo plano</b> las proyecciones de ventas cada 15 minutos en lugar de mostrar decimales. Al alcanzar una cuota, dispara una alerta de producción.
                                    </p>
                                    <ul className="list-inside space-y-4 font-medium">
                                        <li className="flex items-start gap-2">
                                            <span className="text-emerald-500 mt-1">✔</span> 
                                            <span><b className="text-orange-400">1 Cafetera (4 vasos):</b> El sistema acumula ventas y cuando proyecta que se necesitará el <b>75% (3 cafés)</b>, dispara una alerta Naranja pidiéndote <b className="text-white bg-orange-700/50 px-2 py-0.5 rounded">1 CAFETERA</b> extra.</span>
                                        </li>
                                        <li className="flex items-start gap-2">
                                            <span className="text-emerald-500 mt-1">✔</span> 
                                            <span><b className="text-orange-400">1 Galón (20 Champurrados):</b> Cuando matemáticamente se proyecte la venta de <b>15 porciones (75%)</b>, la tableta disparará el pedido de <b className="text-white bg-orange-700/50 px-2 py-0.5 rounded">1 GALÓN</b> automáticamente.</span>
                                        </li>
                                    </ul>
                                </div>

                                <div className="bg-slate-800/40 p-5 md:p-6 rounded-3xl border border-slate-700/50 relative overflow-hidden">
                                    <div className="absolute top-0 right-0 w-32 h-32 bg-red-500/10 rounded-full blur-3xl" />
                                    <h3 className="text-xl md:text-2xl font-black tracking-widest text-white uppercase mb-4 flex items-center gap-3">
                                        <span className="text-2xl">🥩</span> Alimentos Lentos
                                    </h3>
                                    <p className="mb-5 text-slate-400 font-medium text-sm md:text-base">
                                        Para Carnes y Acompañamientos (Frijol/Arroz/Guaca), los números representan la demanda proyectada.
                                    </p>
                                    <ul className="list-inside space-y-4 font-medium text-sm md:text-base">
                                        <li className="flex items-start gap-2">
                                            <span className="text-emerald-500 mt-1">✔</span> 
                                            <span><b>Aguacate (Guacamole):</b> Se calcula la demanda total en onzas, se convierte a libras y se divide <b className="text-white">entre 2</b> para indicarte directamente el número de <b>Bolsas de 2lb</b>.</span>
                                        </li>
                                        <li className="flex items-start gap-2">
                                            <span className="text-emerald-500 mt-1">✔</span> 
                                            <span><b>Frijol y Arroz:</b> Se incluye tanto lo servido en platillos como lo vendido extra en Sides (Libras directas).</span>
                                        </li>
                                        <li className="flex items-start gap-2">
                                            <span className="text-emerald-500 mt-1">✔</span> 
                                            <span><b>Carnes:</b> Aplica la merma estándar de Tacos Gavilan hacia atrás para darte Libras Crudas que sacarás de congelador.</span>
                                        </li>
                                    </ul>
                                </div>

                                <div className="bg-slate-800/40 p-5 md:p-6 rounded-3xl border border-slate-700/50 relative overflow-hidden">
                                    <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/10 rounded-full blur-3xl" />
                                    <h3 className="text-xl md:text-2xl font-black tracking-widest text-white uppercase mb-4 flex items-center gap-3">
                                        <span className="text-2xl">📅</span> Promedio Histórico
                                    </h3>
                                    <p className="mb-5 text-slate-400 font-medium">
                                        ¿De dónde saca la IA estos números que me pide descongelar o hervir?
                                    </p>
                                    <ul className="list-inside space-y-4 font-medium">
                                        <li className="flex items-start gap-2">
                                            <span className="text-blue-400 mt-1">✔</span> 
                                            <span>El sistema lee automáticamente todas las ventas de los últimos <b>años</b> de tu tienda.</span>
                                        </li>
                                        <li className="flex items-start gap-2">
                                            <span className="text-blue-400 mt-1">✔</span> 
                                            <span>Busca un patrón aislando <b>este mismo día de la semana</b> (si hoy es Lunes, promedia todos los Lunes pasados).</span>
                                        </li>
                                        <li className="flex items-start gap-2">
                                            <span className="text-blue-400 mt-1">✔</span> 
                                            <span>Filtra específicamente <b>este bloque de 30 minutos</b> para reaccionar a tu hora pico (Rush) de la manera más exacta posible en tiempo real sin obligarte a adivinar.</span>
                                        </li>
                                    </ul>
                                </div>
                            </div>
                            
                            <div className="mt-6 md:mt-8 pt-6 border-t border-slate-800 shrink-0">
                                <button 
                                    onClick={() => setShowInfoModal(false)}
                                    className="w-full bg-blue-600 hover:bg-blue-500 active:scale-95 text-white font-black uppercase md:text-xl tracking-widest py-4 rounded-2xl transition-all shadow-[0_0_20px_rgba(37,99,235,0.4)]"
                                >
                                    ¡Comprendido!
                                </button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </div>
    )
}
