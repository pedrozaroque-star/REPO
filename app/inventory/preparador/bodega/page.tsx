'use client'

import { useState, useEffect, useRef } from 'react'
import { AlertOctagon, CheckCircle2, Volume2, VolumeX, Store, Loader2, Play, Clock, Maximize, Minimize, HelpCircle, X, Calendar } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { createClient } from '@/lib/supabase-client'
import { useAuth } from '@/components/ProtectedRoute'
import { useLanguage } from '@/lib/i18n'

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
    const { t } = useLanguage()

    const [mounted, setMounted] = useState(false)
    const [systemStarted, setSystemStarted] = useState(false)
    const [stores, setStores] = useState<any[]>([])
    const [storeId, setStoreId] = useState('')
    
    // Calendar Date Selector
    const todayLAStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
    const [selectedDate, setSelectedDate] = useState<string>(todayLAStr)

    const getDowFromDate = (dateStr: string) => {
        const [y, m, d] = dateStr.split('-').map(Number)
        const dateObj = new Date(y, m - 1, d)
        const dayNum = dateObj.getDay()
        return dayNum === 0 ? 7 : dayNum
    }

    const businessDow = getDowFromDate(selectedDate)
    const isToday = selectedDate === todayLAStr
    const [viewMode, setViewMode] = useState<'30min' | 'tramos'>('30min')
    const [cardDisplayMode, setCardDisplayMode] = useState<'basic' | 'advanced'>('basic')
    
    // Alarma
    const audioRef = useRef<HTMLAudioElement | null>(null)
    const [isMuted, setIsMuted] = useState(false)
    
    // Pending Queue
    const [pendingRequests, setPendingRequests] = useState<PrepRequest[]>([])
    const [beverageAlerts, setBeverageAlerts] = useState<any[]>([])
    
    // Meat Historial Data (Cabeza, Lengua)
    const [meatData, setMeatData] = useState<MeatData[]>([])
    const [fetchingMeat, setFetchingMeat] = useState(false)
    const [carouselBuckets, setCarouselBuckets] = useState<{ id: string, name?: string, isPeak?: boolean, duration?: number, label: string, data: any[], isCurrent: boolean }[]>([])
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
            const doc = document as any;
            setIsFullscreen(!!(doc.fullscreenElement || doc.webkitFullscreenElement))
        }
        document.addEventListener('fullscreenchange', onFullscreenChange)
        document.addEventListener('webkitfullscreenchange', onFullscreenChange)
        return () => {
            document.removeEventListener('fullscreenchange', onFullscreenChange)
            document.removeEventListener('webkitfullscreenchange', onFullscreenChange)
        }
    }, [])

    const toggleFullscreen = () => {
        const doc = document as any;
        const elem = containerRef.current as any;

        if (!isFullscreen) {
            if (elem?.requestFullscreen) {
                elem.requestFullscreen().catch(() => setIsFullscreen(true));
            } else if (elem?.webkitRequestFullscreen) {
                elem.webkitRequestFullscreen();
                setTimeout(() => { if (!doc.webkitFullscreenElement) setIsFullscreen(true) }, 200);
            } else {
                setIsFullscreen(true); // Fallback manual (CSS)
            }
        } else {
            if (doc.exitFullscreen && doc.fullscreenElement) {
                doc.exitFullscreen().catch(() => setIsFullscreen(false));
            } else if (doc.webkitExitFullscreen && doc.webkitFullscreenElement) {
                doc.webkitExitFullscreen();
                setTimeout(() => { if (!doc.webkitFullscreenElement) setIsFullscreen(false) }, 200);
            } else {
                setIsFullscreen(false); // Fallback manual
            }
        }
    }

    const { user } = useAuth()
    
    // Fetch Stores
    useEffect(() => {
        const fetchStores = async () => {
            const { data } = await supabase.from('stores').select('id, name, opening_time, closing_time').eq('is_active', true).order('name')
            if (data) {
                setStores(data)
                // Forzar tienda si el usuario no es admin/supervisor y tiene tienda asignada
                const isSuper = ['admin', 'supervisor'].includes(user?.role?.toLowerCase() || '')
                if (user && !isSuper && user.store_id) {
                    setStoreId(user.store_id)
                } else {
                    // Recordar o default si es supervisor/admin
                    const saved = localStorage.getItem('teg_preparador_store')
                    if (saved && data.find(s => s.id === saved)) setStoreId(saved)
                    else setStoreId(data[0].id)
                }
            }
        }
        if (user !== undefined) fetchStores()
    }, [supabase, user])

    // Load Meat Historial (Solo Cabeza y Lengua para la Bodega)
    useEffect(() => {
        if (!storeId) return
        const fetchHistory = async () => {
            setFetchingMeat(true)
            try {
                const res = await fetch(`/api/inventory/preparador-history?storeId=${storeId}&dow=${businessDow}&_t=${Date.now()}`, { cache: 'no-store' })
                const json = await res.json()
                if (Array.isArray(json)) {
                    // Pre-filtro: La bodega proyecta Lentos y Bebidas (se requirió remover CAFE)
                    const allowedTypes = ['CABEZA', 'LENGUA', 'CHAMPURRADO', 'AGUACATE', 'FRIJOL MOLIDO', 'ARROZ']
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

    // Fetch Intelligence Projections
    const [intelligenceAcelerador, setIntelligenceAcelerador] = useState(1.0)
    const [weatherAlert, setWeatherAlert] = useState(false)

    useEffect(() => {
        if (!storeId) return;
        const fetchIntelligence = async () => {
            try {
                const res = await fetch(`/api/preparador/intelligence?store_id=${storeId}&_t=${Date.now()}`, { cache: 'no-store' })
                const data = await res.json()
                if (data && data.growth_factor) {
                    setIntelligenceAcelerador(data.growth_factor)
                }
                if (data && typeof data.weather_adjustment !== 'undefined') {
                    setWeatherAlert(data.weather_adjustment)
                }
            } catch (e) {
                console.error("No se pudo obtener la inteligencia predictiva:", e)
            }
        }
        
        fetchIntelligence()
        // Refrescar factores cada 3 minutos en tiempo real
        const int = setInterval(fetchIntelligence, 3 * 60 * 1000)
        return () => clearInterval(int)
    }, [storeId])


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
            
            // Derive store opening hour dynamically
            const activeStoreObj = stores.find(s => s.id === storeId)
            let openH = 8
            if (activeStoreObj && activeStoreObj.opening_time) {
                const parts = activeStoreObj.opening_time.split(':').map(Number)
                if (!isNaN(parts[0])) {
                    openH = Math.max(6, parts[0] - 1) // 1 hour prep lead time before public opening
                }
            }

            if (viewMode === '30min') {
                const arr: any[] = []
                let tempH = openH
                let tempM = 0
                let foundCurrentIndex = 0

                for (let i = 0; i < 48; i++) {
                    let hrStr = tempH.toString().padStart(2, '0')
                    let minStr = tempM.toString().padStart(2, '0')
                    let bucketId = `${hrStr}:${minStr}:00`

                    let nxtM = tempM === 0 ? 30 : 0
                    let nxtH = tempM === 30 ? (tempH + 1) % 24 : tempH
                    let label = `${formatTime12(tempH, tempM)} a ${formatTime12(nxtH, nxtM)}`

                    let data: any[] = []
                    if (meatData.length > 0) {
                        const allowedTypes = ['CABEZA', 'LENGUA', 'CHAMPURRADO', 'AGUACATE', 'FRIJOL MOLIDO', 'ARROZ']
                        data = allowedTypes.map(type => {
                            const mData = meatData.find(m => m.interval_start === bucketId && m.meat_type === type)
                            return {
                                interval_start: bucketId,
                                meat_type: type,
                                avg_lbs: mData ? mData.avg_lbs : 0,
                                duration: 0.5,
                                samples: mData ? mData.samples : 0
                            }
                        })
                    }

                    let isCurrent = (tempH === h && tempM === curM)
                    if (isCurrent) foundCurrentIndex = i

                    arr.push({ id: bucketId, name: '30 MIN', isPeak: false, duration: 0.5, label, isCurrent, data })

                    tempH = nxtH
                    tempM = nxtM
                }
                setCarouselBuckets(arr)
            } else {
                // Define 6 Peak & Operational Time Period Blocks
                const PEAK_PERIODS = [
                    { id: 'p1', name: 'Apertura / Desayuno', startH: openH, endH: 11, duration: Math.max(1, 11 - openH), isPeak: false },
                    { id: 'p2', name: 'HORA PICO AM', startH: 11, endH: 14, duration: 3, isPeak: true },
                    { id: 'p3', name: 'Tarde / Transición', startH: 14, endH: 17, duration: 3, isPeak: false },
                    { id: 'p4', name: 'HORA PICO PM', startH: 17, endH: 21, duration: 4, isPeak: true },
                    { id: 'p5', name: 'Noche / Cena Tardía', startH: 21, endH: 1, duration: 4, isPeak: false },
                    { id: 'p6', name: 'Madrugada / Cierre', startH: 1, endH: openH, duration: (24 - 1 + openH) % 24 || 5, isPeak: false }
                ]

                const isHourInPeriod = (hr: number, startH: number, endH: number) => {
                    if (startH < endH) return hr >= startH && hr < endH
                    return hr >= startH || hr < endH
                }

                const arr: any[] = []

                PEAK_PERIODS.forEach((period) => {
                    let startLabel = formatTime12(period.startH, 0)
                    let endLabel = formatTime12(period.endH, 0)
                    let label = `${startLabel} a ${endLabel}`
                    
                    let data: any[] = []
                    if (meatData.length > 0) {
                        const allowedTypes = ['CABEZA', 'LENGUA', 'CHAMPURRADO', 'AGUACATE', 'FRIJOL MOLIDO', 'ARROZ']
                        data = allowedTypes.map(type => {
                            let totalAvg = 0
                            let totalSamples = 0

                            meatData.forEach(m => {
                                if (m.meat_type !== type) return
                                const [hhStr] = m.interval_start.split(':')
                                const hh = parseInt(hhStr, 10)
                                if (isHourInPeriod(hh, period.startH, period.endH)) {
                                    totalAvg += m.avg_lbs
                                    totalSamples += (m.samples || 0)
                                }
                            })

                            return {
                                interval_start: `${period.startH.toString().padStart(2, '0')}:00:00`,
                                meat_type: type,
                                avg_lbs: totalAvg,
                                duration: period.duration,
                                samples: totalSamples
                            }
                        })
                    }

                    let isCurrent = isHourInPeriod(h, period.startH, period.endH)
                    arr.push({ id: period.id, name: period.name, isPeak: period.isPeak, duration: period.duration, label, isCurrent, data })
                })

                setCarouselBuckets(arr)
            }
        }
        
        updateBuckets()
        const int = setInterval(updateBuckets, 60000)
        return () => clearInterval(int)
    }, [meatData, viewMode, storeId])

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
            
            let evalH = currentH
            if (evalH < 6) evalH += 24
            
            // Evaluamos el minuto exacto considerando el shift de madrugada (24+)
            const currentTimeInMins = evalH * 60 + currentM
            
            // Reset daily counters at 6:00 AM LA Time (safe for month roll-over)
            const businessNow = new Date(now.getTime())
            if (businessNow.getHours() < 6) {
                businessNow.setDate(businessNow.getDate() - 1)
            }
            const dayStr = `${businessNow.getFullYear()}-${businessNow.getMonth()}-${businessNow.getDate()}`
            
            const savedDate = localStorage.getItem('teg_bev_date')
            if (savedDate !== dayStr) {
                localStorage.setItem('teg_bev_date', dayStr)
                localStorage.setItem('teg_galones_ack', '0')
            }
            
            // Calculamos asomándonos offsetMins en el futuro
            const getCumulativeSales = (meatType: string, offsetMins: number) => {
                let totalExpected = 0
                const evaluateTimeInMins = currentTimeInMins + offsetMins
                
                meatData.forEach(m => {
                    if (m.meat_type !== meatType) return
                    let [hh, mm] = m.interval_start.split(':').map(Number)
                    if (hh < 6) hh += 24
                    const bucketStartMins = hh * 60 + mm
                    if (bucketStartMins + 30 <= evaluateTimeInMins) {
                        totalExpected += m.avg_lbs
                    } else if (bucketStartMins < evaluateTimeInMins) {
                        const passedMins = evaluateTimeInMins - bucketStartMins
                        totalExpected += m.avg_lbs * (passedMins / 30)
                    }
                })
                return totalExpected
            }

            // Champurrado: Asomarse 6 HORAS (360 minutos) en el futuro según su vida útil.
            const baseChamp = getCumulativeSales('CHAMPURRADO', 360)
            const totalChamp = baseChamp * intelligenceAcelerador
            
            // Regla Tacos Gavilan: 1 Galón = 20 vasos. No se piden mitades. Redondeamos hacia arriba para no fallar.
            // Siempre números enteros = Math.ceil.
            const reqGalones = Math.ceil(totalChamp / 20)
            
            const ackGalones = parseInt(localStorage.getItem('teg_galones_ack') || '0', 10)
            
            let newAlerts: any[] = []
            
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
            
            setBeverageAlerts(newAlerts)
        }

        checkBeverages()
        const int = setInterval(checkBeverages, 60000)
        return () => clearInterval(int)
    }, [systemStarted, meatData, isMuted, intelligenceAcelerador])

    const handleAcknowledgeBeverage = (alert: any) => {
        if (alert.type === 'CHAMP') {
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
        // Trigger alarm state based on TOTAL pending list length (both line requests and system beverages)
        if (pendingRequests.length === 0 && beverageAlerts.length === 0) {
            stopAlarm()
        } else if (!isMuted && systemStarted) {
            playAlarm()
        }
    }, [pendingRequests.length, beverageAlerts.length, isMuted, systemStarted])

    const playAlarm = () => {
        if (audioRef.current && (pendingRequests.length > 0 || beverageAlerts.length > 0)) {
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
                    <h1 className="text-4xl font-black tracking-tighter mb-4 text-transparent bg-clip-text bg-gradient-to-br from-white to-slate-400">WAREHOUSE TABLET</h1>
                    <p className="text-slate-400 font-medium mb-12 text-lg">You must physically initialize the system so the browser allows the alarm to play when an order comes in.</p>
                    
                    <button 
                        onClick={startSystem}
                        className="w-full py-6 rounded-2xl bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 text-2xl font-black text-white shadow-[0_10px_40px_rgba(220,38,38,0.4)] transition-all active:scale-95 flex items-center justify-center gap-3"
                    >
                        <Play fill="currentColor" /> START SYSTEM
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

                    {/* Card Display Mode Switcher (Básica vs Avanzada) */}
                    <div className="flex bg-slate-800/80 p-1 rounded-lg border border-slate-700 font-bold text-xs">
                        <button 
                            onClick={() => setCardDisplayMode('basic')}
                            className={`px-2.5 py-1 rounded transition-colors cursor-pointer ${cardDisplayMode === 'basic' ? 'bg-emerald-600 text-white shadow-sm font-black' : 'text-slate-400 hover:text-white'}`}
                        >
                            {t('prep.basicMode')}
                        </button>
                        <button 
                            onClick={() => setCardDisplayMode('advanced')}
                            className={`px-2.5 py-1 rounded transition-colors cursor-pointer ${cardDisplayMode === 'advanced' ? 'bg-emerald-600 text-white shadow-sm font-black' : 'text-slate-400 hover:text-white'}`}
                        >
                            {t('prep.advancedMode')}
                        </button>
                    </div>

                    {/* View Mode Switcher (30 Min vs Tramos) */}
                    <div className="flex bg-slate-800/80 p-1 rounded-lg border border-slate-700 font-bold text-xs">
                        <button 
                            onClick={() => setViewMode('30min')}
                            className={`px-2.5 py-1 rounded transition-colors cursor-pointer ${viewMode === '30min' ? 'bg-blue-600 text-white shadow-sm font-black' : 'text-slate-400 hover:text-white'}`}
                        >
                            30 Min
                        </button>
                        <button 
                            onClick={() => setViewMode('tramos')}
                            className={`px-2.5 py-1 rounded transition-colors cursor-pointer ${viewMode === 'tramos' ? 'bg-blue-600 text-white shadow-sm font-black' : 'text-slate-400 hover:text-white'}`}
                        >
                            Tramos
                        </button>
                    </div>

                    {/* Date Picker Selector */}
                    <div className="flex items-center gap-2 bg-slate-800/80 p-1.5 rounded-lg border border-slate-700">
                        <Calendar size={16} className="text-blue-400 shrink-0" />
                        <input 
                            type="date" 
                            value={selectedDate}
                            max={todayLAStr}
                            onChange={e => setSelectedDate(e.target.value)}
                            className="bg-transparent font-bold text-sm text-white outline-none cursor-pointer"
                        />
                        {!isToday && (
                            <button 
                                onClick={() => setSelectedDate(todayLAStr)}
                                className="text-xs bg-blue-600 hover:bg-blue-700 text-white font-bold px-2 py-0.5 rounded transition-colors shrink-0 cursor-pointer"
                            >
                                {t('prep.today')}
                            </button>
                        )}
                    </div>
                </div>

                <div className="flex items-center gap-4 md:gap-6 w-full md:w-auto justify-center md:justify-end">
                    <button 
                        onClick={toggleFullscreen}
                        className={`p-3 rounded-full transition-colors ${isFullscreen ? 'bg-white/20 text-white' : 'bg-white/10 text-white hover:bg-white/20'}`}
                        title="Tablet Mode (Fullscreen)"
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
                                    <h2 className="text-2xl md:text-3xl font-black text-white uppercase tracking-wider flex items-center gap-3">
                                        Cooking Pace
                                        {intelligenceAcelerador !== 1.0 && (
                                            <span className={`text-sm px-2 py-0.5 rounded-lg border ${intelligenceAcelerador > 1 ? 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800/50 shadow-[0_0_10px_rgba(239,68,68,0.2)]' : 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800/50'}`}>
                                                Pace {intelligenceAcelerador > 1 ? '+' : ''}{((intelligenceAcelerador - 1) * 100).toFixed(0)}%
                                            </span>
                                        )}
                                    </h2>
                                    <p className="text-slate-400 font-medium md:text-lg">Live Projection for Today (Warehouse)</p>
                                </div>
                            </div>

                            {fetchingMeat ? (
                                <div className="flex flex-col items-center justify-center flex-1 text-slate-500 gap-4">
                                    <Loader2 className="w-12 h-12 animate-spin text-blue-500" />
                                    <p className="font-bold text-lg">Calculating projections...</p>
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
                                                                    {isRealCurrent && isTop ? 'NOW' : (!isTop && activeIndex === 0 ? 'NEXT' : 'PROJECTION')}
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
                                                            let val = m.avg_lbs * intelligenceAcelerador;
                                                            let unitLab = 'lbs';
                                                            let typeLab = m.meat_type;
                                                            
                                                            if (m.meat_type === 'CHAMPURRADO') {
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

                                                            const maxVal = Math.max(1, Math.ceil(val))

                                                            return (
                                                            <div key={m.meat_type} className={`rounded-xl md:rounded-2xl flex flex-col items-center justify-center border shadow-md ${isTop ? 'bg-slate-950/50 p-3 md:p-5 border-slate-700/50' : 'bg-slate-950/30 p-2 md:p-4 border-slate-800'}`}>
                                                                <span className={`font-black uppercase tracking-widest mb-1 md:mb-2 text-center leading-none ${isTop ? 'text-[10px] xl:text-sm text-slate-400' : 'text-[9px] md:text-xs text-slate-600'}`}>{typeLab}</span>
                                                                {cardDisplayMode === 'basic' ? (
                                                                    <div className="flex flex-col items-center justify-center">
                                                                        <span className={`font-black tracking-tighter flex items-baseline gap-1 ${isTop ? 'text-3xl xl:text-5xl text-white' : 'text-xl md:text-2xl text-slate-400'}`}>
                                                                            {maxVal} <span className={`font-medium opacity-50 ${isTop ? 'text-xs xl:text-base text-slate-500' : 'text-[10px] md:text-xs text-slate-600'}`}>{unitLab}</span>
                                                                        </span>
                                                                        <span className="text-[10px] text-amber-400 font-bold mt-1">🔥 {t('prep.maxTray')}</span>
                                                                    </div>
                                                                ) : (
                                                                    <span className={`font-black tracking-tighter flex items-baseline gap-1 ${isTop ? 'text-3xl xl:text-5xl text-white' : 'text-xl md:text-2xl text-slate-400'}`}>
                                                                        {val.toFixed(1)} <span className={`font-medium opacity-50 ${isTop ? 'text-xs xl:text-base text-slate-500' : 'text-[10px] md:text-xs text-slate-600'}`}>{unitLab}</span>
                                                                    </span>
                                                                )}
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
                            <h2 className="text-3xl md:text-5xl font-black text-white tracking-widest text-center">SYSTEM ON STANDBY</h2>
                            <p className="text-xl md:text-2xl text-white/70 mt-4 md:mt-6 text-center">No pending line orders.</p>
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
                                        {(req as any).is_sys ? 'QUOTA REACHED (PROJECTION):' : 'MISSING ON LINE:'}
                                    </h3>
                                    <div className="flex flex-wrap gap-4 md:gap-6">
                                        {req.items.map((item: string, i: number) => (
                                            <span key={i} className={`inline-block bg-white ${(req as any).is_sys ? 'text-orange-700' : 'text-red-700'} font-black text-3xl md:text-6xl px-6 py-4 rounded-3xl shadow-lg uppercase leading-none`}>
                                                {item}
                                            </span>
                                        ))}
                                    </div>
                                    <p className={`mt-8 ${(req as any).is_sys ? 'text-orange-200/60' : 'text-red-200/60'} font-medium text-lg flex items-center gap-2`}>
                                        <Clock size={20} /> {(req as any).is_sys ? 'Alert ' : 'Order '} {new Date(req.created_at).toLocaleTimeString('en-US', {hour: '2-digit', minute:'2-digit'})}
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
                                        <span className="font-black text-4xl uppercase tracking-tighter">DELIVERED</span>
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
                            className="bg-slate-900 border border-slate-700 w-[96vw] h-[96vh] rounded-[32px] p-6 md:p-10 shadow-2xl relative z-10 flex flex-col"
                        >
                            <button 
                                onClick={() => setShowInfoModal(false)}
                                className="absolute top-6 right-6 p-2 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
                            >
                                <X size={24} />
                            </button>
                            
                            <h2 className="text-3xl md:text-5xl font-black text-white mb-2 tracking-tight">
                                Warehouse Projections
                            </h2>
                            <p className="text-slate-400 mb-6 md:mb-8 border-b border-slate-800 pb-4 md:pb-6 text-lg md:text-2xl shrink-0">
                                How the AI system calculates these historical quantities for your store:
                            </p>
                            
                            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 md:gap-8 text-slate-300 overflow-y-auto shrink pb-2 pr-2">
                                <div className="bg-slate-800/40 p-6 md:p-8 rounded-3xl border border-slate-700/50 relative overflow-hidden">
                                    <div className="absolute top-0 right-0 w-32 h-32 bg-orange-500/10 rounded-full blur-3xl" />
                                    <h3 className="text-2xl md:text-3xl font-black tracking-widest text-white uppercase mb-4 flex items-center gap-3">
                                        <span className="text-3xl">☕</span> Slow Beverages
                                    </h3>
                                    <p className="mb-6 text-slate-400 font-medium leading-relaxed text-lg md:text-xl">
                                        The system <b className="text-white">monitors in real time</b> the projections and looks ahead based on the preparation time of each beverage. When a quota is reached, it fires a production alert with enough lead time.
                                    </p>
                                    <ul className="list-inside space-y-5 font-medium text-base md:text-xl leading-relaxed">
                                        <li className="flex items-start gap-2">
                                            <span className="text-emerald-500 mt-1">✔</span> 
                                            <span><b className="text-orange-400">Champurrado (6 hours):</b> The AI sums all demand for the next 6 hours of the product's shelf life. If it requires 2.2 Gallons, it requests <b className="text-white bg-orange-700/50 px-2 py-0.5 rounded">3 WHOLE GALLONS</b> ensuring supply without cooking impossible decimals.</span>
                                        </li>
                                    </ul>
                                </div>

                                <div className="bg-slate-800/40 p-6 md:p-8 rounded-3xl border border-slate-700/50 relative overflow-hidden">
                                    <div className="absolute top-0 right-0 w-32 h-32 bg-red-500/10 rounded-full blur-3xl" />
                                    <h3 className="text-2xl md:text-3xl font-black tracking-widest text-white uppercase mb-4 flex items-center gap-3">
                                        <span className="text-3xl">🥩</span> Slow-Cook Items
                                    </h3>
                                    <p className="mb-6 text-slate-400 font-medium text-lg md:text-xl">
                                        For Meats and Sides (Beans/Rice/Guac), the numbers represent the projected demand.
                                    </p>
                                    <ul className="list-inside space-y-5 font-medium text-base md:text-xl leading-relaxed">
                                        <li className="flex items-start gap-2">
                                            <span className="text-emerald-500 mt-1">✔</span> 
                                            <span><b>Avocado (Guacamole):</b> Total demand is calculated in ounces, converted to pounds and divided <b className="text-white">by 2</b> to directly indicate the number of <b>2lb Bags</b>.</span>
                                        </li>
                                        <li className="flex items-start gap-2">
                                            <span className="text-emerald-500 mt-1">✔</span> 
                                            <span><b>Beans and Rice:</b> Includes both what is served in dishes and what is sold as extra Sides (direct Pounds).</span>
                                        </li>
                                        <li className="flex items-start gap-2">
                                            <span className="text-emerald-500 mt-1">✔</span> 
                                            <span><b>Meats:</b> Applies the standard Tacos Gavilan cooking shrinkage in reverse to give you Raw Pounds to pull from the freezer.</span>
                                        </li>
                                    </ul>
                                </div>

                                <div className="bg-slate-800/40 p-5 md:p-6 rounded-3xl border border-slate-700/50 relative overflow-hidden">
                                    <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/10 rounded-full blur-3xl" />
                                    <h3 className="text-xl md:text-2xl font-black tracking-widest text-white uppercase mb-4 flex items-center gap-3">
                                        <span className="text-2xl">📅</span> Historical Average
                                    </h3>
                                    <p className="mb-5 text-slate-400 font-medium">
                                        Where does the AI get these numbers it asks me to thaw or boil?
                                    </p>
                                    <ul className="list-inside space-y-4 font-medium">
                                        <li className="flex items-start gap-2">
                                            <span className="text-blue-400 mt-1">✔</span> 
                                            <span>The system automatically reads all sales from the last <b>years</b> of your store.</span>
                                        </li>
                                        <li className="flex items-start gap-2">
                                            <span className="text-blue-400 mt-1">✔</span> 
                                            <span>It specifically filters <b>this 30-minute block</b> to react to your peak hour (Rush) as precisely as possible in real time without forcing you to guess.</span>
                                        </li>
                                        <li className="flex items-start gap-2">
                                            <span className="text-emerald-500 mt-1">✔</span> 
                                            <span><b>Cabeza/Lengua:</b> Shows exactly what the physical Prep line will demand in the next half hour so the Warehouse can thaw at the exact pace.</span>
                                        </li>
                                    </ul>
                                </div>
                                
                                <div className="xl:col-span-2 bg-slate-800/40 p-6 md:p-8 rounded-3xl border border-slate-700/50 relative overflow-hidden">
                                    <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/10 rounded-full blur-3xl" />
                                    <h3 className="text-2xl md:text-3xl font-black tracking-widest text-white uppercase mb-4 flex items-center gap-3">
                                        ⏱️ LIVE PACE (INTRADAY AI)
                                    </h3>
                                    <p className="mb-6 font-medium text-lg md:text-2xl text-slate-400">
                                        How does the algorithm protect you from a surprise shortage today?
                                    </p>
                                    <ul className="list-inside space-y-5 font-medium text-base md:text-xl leading-relaxed text-slate-300">
                                        <li className="flex items-start gap-2">
                                            <span className="text-amber-500 mt-1">⚡</span> 
                                            <span><b>Peak Detection:</b> Every 30 minutes, the AI connects directly to Toast to sum all cash and card money that has entered your register <b>TODAY</b> since you opened.</span>
                                        </li>
                                        <li className="flex items-start gap-2">
                                            <span className="text-amber-500 mt-1">⚡</span> 
                                            <span><b>The Accelerator:</b> If the AI detects that 20% more money has come in today than "should have" entered by this hour, it concludes the store is experiencing a peak (for example, a local event) and generates an <b>Accelerator (+20%)</b>.</span>
                                        </li>
                                        <li className="flex items-start gap-2">
                                            <span className="text-amber-500 mt-1">⚡</span> 
                                            <span><b>Auto Adjustment:</b> All projections on this screen (Coffee, Guacamole, Rice) will receive this automatic increase, ensuring the Warehouse sends additional supply before it runs out up front.</span>
                                        </li>
                                    </ul>
                                </div>
                            </div>
                            
                            <div className="mt-6 md:mt-8 pt-6 border-t border-slate-800 shrink-0">
                                <button 
                                    onClick={() => setShowInfoModal(false)}
                                    className="w-full bg-blue-600 hover:bg-blue-700 active:scale-95 text-white font-black uppercase md:text-2xl tracking-widest py-5 md:py-6 rounded-2xl transition-all shadow-xl shadow-blue-500/30"
                                >
                                    Understood!
                                </button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </div>
    )
}
