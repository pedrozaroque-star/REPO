'use client'

import { useState, useEffect, useRef } from 'react'
import { BellRing, ChefHat, Clock, AlertTriangle, Send, UtensilsCrossed, PackageOpen, X, Loader2, Play, Maximize, Minimize, HelpCircle, CheckCircle2 } from 'lucide-react'
import { useAuth } from '@/components/ProtectedRoute'
import { createClient } from '@/lib/supabase-client'
import { motion, AnimatePresence } from 'framer-motion'
        

interface MeatData {
    interval_start: string
    meat_type: string
    avg_lbs: number
    samples: number
}

const C1 = 'bg-emerald-200 border-emerald-300 text-emerald-900 hover:bg-emerald-300 dark:bg-emerald-800 dark:border-emerald-700 dark:text-emerald-50'
const C2 = 'bg-orange-200 border-orange-300 text-orange-900 hover:bg-orange-300 dark:bg-orange-800 dark:border-orange-700 dark:text-orange-50'
const C3 = 'bg-sky-200 border-sky-300 text-sky-900 hover:bg-sky-300 dark:bg-sky-800 dark:border-sky-700 dark:text-sky-50'
const C4 = 'bg-rose-200 border-rose-300 text-rose-900 hover:bg-rose-300 dark:bg-rose-800 dark:border-rose-700 dark:text-rose-50'
const C5 = 'bg-amber-200 border-amber-300 text-amber-900 hover:bg-amber-300 dark:bg-amber-800 dark:border-amber-700 dark:text-amber-50'

const ALIMENTOS = [
    { name: 'Guacamole', color: C1 }, { name: 'Crema', color: C1 }, { name: 'Mayonesa', color: C1 }, { name: 'Mulitas', color: C1 }, { name: 'Quesadillas', color: C1 },
    { name: 'Arroz', color: C2 }, { name: 'Cabeza', color: C2 }, { name: 'Lengua', color: C2 }, { name: 'Frijol molido', color: C2 },
    { name: 'Milaneza', color: C3 }, { name: 'Salchicha', color: C3 }, { name: 'Jamon', color: C3 }, { name: 'Huevos', color: C3 }, { name: 'Papelitos', color: C3 }, { name: 'Queso Jack', color: C3 }, { name: 'Queso cotija', color: C3 }, { name: 'Queso Nachos', color: C3 }, { name: 'Cebolla y cilantro', color: C3 }, { name: 'Salsa verde', color: C3 }, { name: 'Salsa roja', color: C3 },
    { name: 'Asada', color: C4 }, { name: 'Pastor', color: C4 }, { name: 'Pollo', color: C4 }, { name: 'Carnitas', color: C4 }, { name: 'Chorizo', color: C4 }, { name: 'Buche', color: C4 }, { name: 'Frijoles de la Olla', color: C4 },
    { name: 'Tortillas de maiz', color: C5 }, { name: 'Tortillas Burritos', color: C5 }, { name: 'Teleras', color: C5 }, { name: 'Chips', color: C5 }, { name: 'Manteca', color: C5 }
]

const DESECHABLES = [
    'Cover tacos', 'Papel tortas', 'Platos blancos', 'Platos nachos', 'Platos (3)', 
    'Platos sopes', 'Charolas rojas', 'Vasos 4oz', 'Vasos 8oz'
].map(n => ({ name: n, color: 'bg-slate-700 hover:bg-slate-800 text-white dark:bg-slate-800 dark:hover:bg-slate-700' }))

export default function PreparadorLineaPage() {
    const { user, loading: authLoading } = useAuth()
    const supabase = createClient()

    const [mounted, setMounted] = useState(false)
    const [stores, setStores] = useState<any[]>([])
    const [storeId, setStoreId] = useState('')
    const [businessDow, setBusinessDow] = useState<number | null>(null)
    
    // Meat Historial Data
    const [meatData, setMeatData] = useState<MeatData[]>([])
    const [fetchingMeat, setFetchingMeat] = useState(false)
    const [carouselBuckets, setCarouselBuckets] = useState<{ id: string, label: string, isCurrent: boolean, data: MeatData[] }[]>([])
    const [activeIndex, setActiveIndex] = useState(0)

    // Touch handlers for Carousel
    const [touchStart, setTouchStart] = useState<number | null>(null)
    const [touchEnd, setTouchEnd] = useState<number | null>(null)
    const [showInfoModal, setShowInfoModal] = useState(false)

    // Inactivity Reset Effect (Aero snap-back)
    useEffect(() => {
        if (activeIndex === 0) return;
        
        const timer = setTimeout(() => {
            setActiveIndex(0) // Snap back to current time bucket
        }, 5000)
        
        return () => clearTimeout(timer)
    }, [activeIndex])

    // Request Cart
    const [activeTab, setActiveTab] = useState<'alimentos'|'desechables'>('alimentos')
    const [cart, setCart] = useState<{name: string, qty: number}[]>([])
    const [sending, setSending] = useState(false)
    const [showDayModal, setShowDayModal] = useState(false)
    
    // Alarma de Cocción
    const [showCookAlert, setShowCookAlert] = useState(false)
    const [nextBlockLabel, setNextBlockLabel] = useState('')
    const cookAlarmRef = useRef<HTMLAudioElement | null>(null)
    const lastCookAlertRef = useRef<string | null>(null)

    // Agrupación de datos para el Modal
    const getHourlyData = () => {
        const validData = meatData.filter(m => m.meat_type !== 'CARNITAS')
        const hourlyMap = new Map<string, { ASADA: number, CABEZA: number, LENGUA: number, PASTOR: number, POLLO: number }>()
        const dayTotals = { ASADA: 0, CABEZA: 0, LENGUA: 0, PASTOR: 0, POLLO: 0 }
        let grandTotal = 0

        validData.forEach(m => {
            const hourPrefix = m.interval_start.split(':')[0] + ':00'
            if (!hourlyMap.has(hourPrefix)) {
                hourlyMap.set(hourPrefix, { ASADA: 0, CABEZA: 0, LENGUA: 0, PASTOR: 0, POLLO: 0 })
            }
            const hourData = hourlyMap.get(hourPrefix)!
            const key = m.meat_type as keyof typeof dayTotals
            if (key in hourData) {
                hourData[key] += m.avg_lbs
                dayTotals[key] += m.avg_lbs
                grandTotal += m.avg_lbs
            }
        })

        const sortedHours = Array.from(hourlyMap.keys()).sort((a,b) => {
            let ha = parseInt(a.split(':')[0], 10)
            let hb = parseInt(b.split(':')[0], 10)
            if (ha < 6) ha += 24
            if (hb < 6) hb += 24
            return ha - hb
        })
        return { sortedHours, hourlyMap, dayTotals, grandTotal }
    }
    // Fullscreen Mode
    const containerRef = useRef<HTMLDivElement>(null)
    const [isFullscreen, setIsFullscreen] = useState(false)

    useEffect(() => { setMounted(true) }, [])

    // Listen to native fullscreen changes (por si cierran con ESC)
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

    // Load Stores
    useEffect(() => {
        const fetchStores = async () => {
            const { data } = await supabase.from('stores').select('id, name, external_id').eq('is_active', true).order('name')
            if (data) {
                setStores(data)
                
                // Si el usuario no es admin/supervisor y tiene tienda asignada, fijamos su tienda automáticamente
                const isSuper = ['admin', 'supervisor'].includes(user?.role?.toLowerCase() || '')
                if (user && !isSuper && user.store_id) {
                    setStoreId(user.store_id)
                } else {
                    // Si es admin, recordamos su última selección en la tableta o tomamos la primera
                    const saved = localStorage.getItem('teg_preparador_store')
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

    // Load Meat Historial
    useEffect(() => {
        if (!storeId || businessDow === null) return
        const fetchHistory = async () => {
            setFetchingMeat(true)
            try {
                const res = await fetch(`/api/inventory/preparador-history?storeId=${storeId}&dow=${businessDow}`)
                const json = await res.json()
                if (Array.isArray(json)) {
                    // Pre-filtro: La tablet 1 excluye CAFE y CHAMPURRADO
                    const tablet1Proteins = ['ASADA', 'PASTOR', 'POLLO', 'CARNITAS', 'CABEZA', 'LENGUA']
                    setMeatData(json.filter(m => tablet1Proteins.includes(m.meat_type)))
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
            let tempH = h // FIXED: using `h` instead of the undefined `curH`
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
                    data = meatData.filter(m => m.interval_start === bucketId && !['CARNITAS', 'CABEZA', 'LENGUA'].includes(m.meat_type))
                        .sort((a,b) => a.meat_type === 'ASADA' ? -1 : b.meat_type === 'ASADA' ? 1 : a.meat_type.localeCompare(b.meat_type))
                }
                
                arr.push({ id: bucketId, label, isCurrent: i === 0, data })
                
                tempH = nxtH
                tempM = nxtM
            }

            setCarouselBuckets(arr)

            // Trigger Alert 6 minutes before the hour/half-hour (at :24 or :54)
            if ((m === 24 || m === 54) && arr.length > 1) {
                const signature = `${h}-${m}`
                if (lastCookAlertRef.current !== signature) {
                    lastCookAlertRef.current = signature
                    setNextBlockLabel(arr[1].label)
                    setShowCookAlert(true)
                    // Play sound if available
                    if (cookAlarmRef.current) {
                        // Reset audio and play
                        cookAlarmRef.current.currentTime = 0
                        cookAlarmRef.current.volume = 1.0
                        cookAlarmRef.current.play().catch(e => console.error("Audio block:", e))
                    }
                }
            }
        }
        
        updateBuckets()
        const int = setInterval(updateBuckets, 60000) // update every minute
        return () => clearInterval(int)
    }, [meatData])

    const addToCart = (item: string) => {
        setCart(prev => {
            const existing = prev.find(p => p.name === item)
            if (existing) {
                return prev.map(p => p.name === item ? { ...p, qty: p.qty + 1 } : p)
            }
            return [...prev, { name: item, qty: 1 }]
        })
    }

    const decreaseItem = (item: string) => {
        setCart(prev => {
            const existing = prev.find(p => p.name === item)
            if (existing && existing.qty > 1) {
                return prev.map(p => p.name === item ? { ...p, qty: p.qty - 1 } : p)
            }
            return prev.filter(p => p.name !== item)
        })
    }

    const sendRequest = async () => {
        if (cart.length === 0 || !storeId) return
        setSending(true)
        
        const stringifiedItems = cart.map(c => c.qty > 1 ? `${c.qty}x ${c.name}` : c.name)

        const { error } = await supabase.from('preparador_requests').insert({
            store_id: storeId,
            sender_name: user?.name || 'Linea',
            items: stringifiedItems,
            status: 'PENDING'
        })
        
        if (error) {
            console.error("Error enviando alerta:", error)
        } else {
            setCart([])
            // Sonido local para feedback (Opcional, previene que duden si se mandó)
            const au = new Audio('/sounds/success.mp3') // Placeholder, si no existe no pasa nada (ignora error)
            au.play().catch(()=>{})
        }
        setSending(false)
    }

    if (!mounted || authLoading) return <div className="p-8 flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-blue-500" /></div>

    if (!user || !['admin', 'manager', 'supervisor'].includes(user.role?.toLowerCase() || '')) {
        return <div className="p-8 text-center text-red-500 text-2xl font-bold">🚫 ACCESO DENEGADO</div>
    }

    return (
        <div ref={containerRef} className={`flex flex-col overflow-hidden bg-slate-100 dark:bg-slate-950 transition-all ${isFullscreen ? 'fixed inset-0 z-[9999] h-screen w-screen' : 'h-[calc(100vh-64px)]'}`}>
            <audio ref={cookAlarmRef} src="/sounds/alarm1.mp3" preload="auto" className="hidden" />

            {/* Modal Alerta de Cocción (6 minutos antes del bloque) */}
            <AnimatePresence>
                {showCookAlert && (
                    <motion.div 
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[99999] bg-red-950/90 backdrop-blur-md flex items-center justify-center p-4 xl:p-10"
                    >
                        <motion.div 
                            initial={{ scale: 0.9, y: 50 }}
                            animate={{ scale: 1, y: 0 }}
                            exit={{ scale: 0.9, y: 50 }}
                            className="bg-slate-900 border-2 border-red-500 max-w-4xl w-full rounded-[40px] shadow-[0_0_150px_rgba(239,68,68,0.4)] p-8 md:p-16 flex flex-col items-center text-center"
                        >
                            <BellRing size={120} className="text-red-500 animate-bounce mb-8" />
                            <h2 className="text-4xl md:text-6xl font-black text-white px-4 leading-tight uppercase mb-6 tracking-tighter">
                                ¡PREPARA EL SIGUIENTE BLOQUE!
                            </h2>
                            <p className="text-red-200 font-medium text-2xl md:text-4xl mb-12 uppercase tracking-wide bg-red-950/50 py-4 px-8 rounded-2xl border border-red-500/30">
                                SIGUIENTE HORARIO:<br/>
                                <span className="text-white font-black">{nextBlockLabel}</span>
                            </p>
                            <button 
                                onClick={() => {
                                    setShowCookAlert(false)
                                    if (cookAlarmRef.current) {
                                        cookAlarmRef.current.pause()
                                        cookAlarmRef.current.currentTime = 0
                                    }
                                }}
                                className="w-full md:w-[400px] bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 text-white font-black text-3xl px-10 py-8 rounded-3xl shadow-[0_0_50px_rgba(16,185,129,0.3)] transition-transform active:scale-95 border-b-8 border-emerald-700 flex flex-col items-center justify-center"
                            >
                                <CheckCircle2 size={40} className="mb-2" />
                                ENTENDIDO
                            </button>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Header / Config Bar */}
            <div className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 p-4 flex flex-col md:flex-row gap-4 justify-between items-center shadow-sm shrink-0">
                <div className="flex items-center gap-3 w-full md:w-auto justify-center md:justify-start">
                    <div className="bg-gradient-to-r from-red-600 to-orange-500 p-2 rounded-lg text-white shadow-md shrink-0">
                        <ChefHat size={24} />
                    </div>
                    <div>
                        <h1 className="text-xl font-black text-slate-800 dark:text-white leading-tight">PREPARADOR (LÍNEA)</h1>
                        <p className="text-xs text-slate-500 font-medium">Control de Ritmo y Abastecimiento</p>
                    </div>
                </div>
                
                <div className="flex items-center justify-center gap-2 md:gap-4 flex-wrap w-full md:w-auto">
                    <button 
                        onClick={toggleFullscreen}
                        className="flex items-center gap-2 bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 px-3 py-2 rounded-lg font-bold text-sm transition-colors"
                        title="Modo Tableta (Pantalla Completa)"
                    >
                        {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
                        <span className="hidden sm:inline">{isFullscreen ? 'SALIR' : 'TABLETA'}</span>
                    </button>
                    
                    {(() => {
                        const isSuper = ['admin', 'supervisor'].includes(user?.role?.toLowerCase() || '')
                        return (
                            <select 
                                value={storeId} 
                                onChange={e => {
                                    setStoreId(e.target.value)
                                    localStorage.setItem('teg_preparador_store', e.target.value)
                                }}
                                disabled={!isSuper}
                                className={`border-none rounded-lg p-2 font-bold focus:ring-2 focus:ring-red-500 outline-none relative z-50 ${!isSuper ? 'bg-slate-200 dark:bg-slate-900 text-slate-500 dark:text-slate-600 cursor-not-allowed' : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 cursor-pointer'}`}
                            >
                                {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                            </select>
                        )
                    })()}
                    
                    <a href="/inventory/preparador/bodega" target="_blank" className="flex items-center gap-2 bg-slate-800 hover:bg-black text-white px-4 py-2 rounded-lg font-bold text-sm transition-colors shadow-lg shadow-slate-900/20">
                        <BellRing size={16} className="animate-pulse" />
                        <span className="hidden sm:inline">ABRIR BODEGA</span>
                    </a>
                </div>
            </div>

            {/* Split Screen Container */}
            <div className="flex flex-col lg:flex-row flex-1 overflow-y-auto lg:overflow-hidden">
                
                {/* LADO IZQUIERDO: PROYECCIÓN (oculta en md pero visible apilada en movil/tablet portrait si ajustamos breakpoints. Usaremos lg para side-by-side) */}
                <div className="w-full lg:w-[48%] border-b lg:border-b-0 lg:border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 md:p-6 xl:p-8 flex flex-col shrink-0 lg:shrink lg:overflow-y-auto">
                    <div className="flex justify-between items-center mb-6 bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                        <div className="flex items-center gap-4">
                            <Clock className="w-10 h-10 md:w-12 md:h-12 text-blue-500 shrink-0" />
                            <div>
                                <h2 className="font-black text-slate-800 dark:text-white uppercase tracking-wider text-lg lg:text-2xl">Ritmo de Cocción</h2>
                                <p className="text-sm md:text-base text-slate-500 font-medium hidden sm:block">Promedio histórico esperado</p>
                            </div>
                        </div>
                        <button onClick={() => setShowDayModal(true)} className="bg-blue-100 hover:bg-blue-200 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300 dark:hover:bg-blue-900 px-4 md:px-6 py-2 md:py-3 rounded-xl text-sm md:text-lg font-black transition-colors shrink-0 shadow-sm ml-2">
                            VER DÍA
                        </button>
                    </div>

                    {fetchingMeat ? (
                        <div className="flex flex-col items-center justify-center flex-1 text-slate-400 gap-3">
                            <Loader2 className="w-10 h-10 animate-spin text-blue-500" />
                            <p className="font-bold">Calculando Histórico...</p>
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
                                        className="w-full max-w-[95%] md:max-w-md shrink-0 origin-center select-none"
                                        style={{ transformStyle: 'preserve-3d' }}
                                    >
                                        <div 
                                            onClick={() => { if (isTop) setShowInfoModal(true) }}
                                            className={`rounded-3xl border border-slate-200/50 dark:border-slate-700/50 p-6 xl:p-8 shadow-2xl transition-all duration-500 overflow-hidden relative ${
                                            isTop 
                                                ? 'bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/40 dark:to-indigo-900/30 cursor-pointer hover:ring-2 hover:ring-blue-500/50' 
                                                : 'bg-white/95 dark:bg-slate-800/95 backdrop-blur-md scale-[0.98] opacity-90'
                                        }`}>
                                            <div className="absolute inset-0 bg-gradient-to-tl from-white/10 to-transparent pointer-events-none" />
                                            
                                            <div className="flex justify-between items-center mb-6 pb-4 border-b border-slate-200/50 dark:border-slate-700/50">
                                                <div className={`font-black tracking-tight flex items-center gap-3 ${isTop ? 'text-blue-900 dark:text-blue-300' : 'text-slate-800 dark:text-slate-200'}`}>
                                                    {isRealCurrent && <div className="w-4 h-4 rounded-full bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.8)] animate-pulse" />}
                                                            <div className="flex flex-col md:flex-row md:items-center gap-1 md:gap-4">
                                                                <span className="uppercase text-lg md:text-2xl flex items-center gap-2">
                                                                    {isRealCurrent && isTop ? 'AHORA' : (!isTop && activeIndex === 0 ? 'SIGUIENTE' : 'PROYECCIÓN')}
                                                                    {isTop && <HelpCircle size={20} className="text-blue-500/50 hover:text-blue-500 transition-colors" />}
                                                                </span>
                                                                <span className={`text-2xl md:text-4xl font-black lowercase tracking-tighter [font-feature-settings:'tnum'] ${isTop ? 'opacity-90 text-blue-950 dark:text-blue-100' : 'opacity-60'}`}>
                                                                    {bucket.label}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    
                                                    <div className="grid grid-cols-2 gap-3 xl:gap-5">
                                                        {bucket.data.length > 0 ? bucket.data.map(m => (
                                                            <div key={m.meat_type} className={`bg-white/60 dark:bg-slate-900/60 p-4 xl:p-6 rounded-2xl flex flex-col items-center justify-center shadow-sm w-full ${m.meat_type === 'ASADA' ? 'col-span-2 shadow-md border border-blue-200/50 dark:border-blue-800/50 bg-blue-50/50 dark:bg-blue-900/30 py-8 xl:py-10' : 'border border-slate-100 dark:border-slate-800 py-6 xl:py-8'}`}>
                                                                <span className={`uppercase tracking-widest text-slate-600 dark:text-slate-300 mb-2 md:mb-4 ${m.meat_type === 'ASADA' ? 'text-xl md:text-3xl font-black text-blue-800 dark:text-blue-300' : 'text-lg md:text-2xl font-black'}`}>{m.meat_type}</span>
                                                                <div className="flex flex-col items-center justify-center leading-none">
                                                                    <span className={`font-black tracking-tighter leading-none ${m.meat_type === 'ASADA' ? 'text-7xl xl:text-[7rem] text-blue-700 dark:text-blue-400 drop-shadow-sm' : 'text-6xl xl:text-7xl text-slate-800 dark:text-white'}`}>
                                                                        {m.avg_lbs}
                                                                    </span>
                                                                    <span className="text-xl md:text-2xl font-black text-black dark:text-white tracking-widest lowercase mt-2 xl:mt-4">lbs</span>
                                                                </div>
                                                            </div>
                                                )) : <p className="col-span-2 text-center text-sm font-medium text-slate-400 py-10 opacity-70">No hay proyectado</p>}
                                            </div>
                                        </div>
                                    </motion.div>
                                )
                            })}
                            </AnimatePresence>
                            
                            {/* Pagination Indicators - Hint of remaining buckets */}
                            <div className="absolute top-0 right-0 h-full w-8 flex flex-col items-center justify-center gap-1 opacity-30 z-10 pointer-events-none hidden md:flex">
                                {carouselBuckets.map((b, i) => (
                                    <div key={b.id} className={`w-1.5 h-1.5 rounded-full transition-all duration-300 ${i === activeIndex ? 'bg-blue-600 scale-150' : i === activeIndex + 1 ? 'bg-slate-600' : 'bg-slate-300'}`} />
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {/* LADO DERECHO: GRID DE SOLICITUDES */}
                <div className="w-full lg:flex-1 flex flex-col bg-slate-100 dark:bg-slate-950 shrink-0 lg:shrink min-h-[600px]">
                    
                    {/* TABS */}
                    <div className="flex p-4 gap-4 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 shadow-sm shrink-0">
                        <button 
                            onClick={() => setActiveTab('alimentos')}
                            className={`flex-1 py-4 font-black flex items-center justify-center gap-2 rounded-xl transition-all shadow-sm
                                ${activeTab === 'alimentos' ? 'bg-orange-100 text-orange-700 border-2 border-orange-500 dark:bg-orange-900/30 dark:text-orange-300' : 'bg-slate-50 text-slate-500 hover:bg-slate-200 border-2 border-transparent dark:bg-slate-800'}`}
                        >
                            <UtensilsCrossed size={20} /> ALIMENTOS
                        </button>
                        <button 
                            onClick={() => setActiveTab('desechables')}
                            className={`flex-1 py-4 font-black flex items-center justify-center gap-2 rounded-xl transition-all shadow-sm
                                ${activeTab === 'desechables' ? 'bg-blue-100 text-blue-700 border-2 border-blue-500 dark:bg-blue-900/30 dark:text-blue-300' : 'bg-slate-50 text-slate-500 hover:bg-slate-200 border-2 border-transparent dark:bg-slate-800'}`}
                        >
                            <PackageOpen size={20} /> DESECHABLES
                        </button>
                    </div>

                    {/* BOTONES LISTA */}
                    <div className="flex-1 overflow-y-auto p-4">
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                            {(activeTab === 'alimentos' ? ALIMENTOS : DESECHABLES).map(itemObj => {
                                const cartItem = cart.find(c => c.name === itemObj.name)
                                const isSelected = !!cartItem
                                
                                const baseStyle = isSelected 
                                    ? `ring-[3px] ring-offset-2 ring-slate-800 dark:ring-white dark:ring-offset-slate-900 scale-[0.97] opacity-100 shadow-[inset_0_8px_15px_rgba(0,0,0,0.2)] dark:shadow-[inset_0_8px_15px_rgba(0,0,0,0.6)] brightness-95 saturate-150 blur-[0.2px] ${itemObj.color}` 
                                    : `border border-black/5 dark:border-white/5 hover:scale-[1.02] shadow-sm ${itemObj.color}`
                                
                                return (
                                <button
                                    key={itemObj.name}
                                    onClick={() => addToCart(itemObj.name)}
                                    className={`relative h-16 md:h-20 lg:h-[84px] rounded-2xl flex flex-col items-center justify-center p-2 active:scale-95 transition-all outline-none ${baseStyle} overflow-hidden`}
                                >
                                    
                                    <span className={`relative w-full px-1 text-center text-base md:text-xl lg:text-2xl leading-tight md:leading-snug font-sans tracking-tighter z-10 ${isSelected ? 'font-black scale-105 drop-shadow-sm' : 'font-bold'}`}>
                                        {itemObj.name}
                                    </span>
                                    {cartItem && cartItem.qty >= 1 && (
                                        <div className="absolute top-2 right-2 bg-slate-900 text-white text-[11px] md:text-xs w-6 h-6 md:w-7 md:h-7 flex items-center justify-center rounded-full font-black shadow-xl animate-in zoom-in duration-200 ring-2 ring-white/50 dark:ring-black/50 z-20">
                                            {cartItem.qty}
                                        </div>
                                    )}
                                </button>
                            )})}
                        </div>
                    </div>

                    {/* BARRA INFERIOR (CART & SEND) */}
                    {cart.length > 0 && (
                        <div className="bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 p-4 shrink-0 shadow-[0_-10px_40px_rgba(0,0,0,0.1)] animate-in slide-in-from-bottom-5">
                            <div className="flex flex-col md:flex-row gap-4">
                                {/* CART ITEMS */}
                                <div className="flex-1 flex gap-2 overflow-x-auto py-2 shrink-0">
                                    {cart.map(c => (
                                        <div 
                                            key={c.name} 
                                            onClick={() => decreaseItem(c.name)}
                                            className="relative bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 px-4 py-3 md:px-5 md:py-4 rounded-xl flex items-center gap-3 shrink-0 group shadow-sm cursor-pointer select-none active:scale-95 transition-transform"
                                        >
                                            <span className="bg-white dark:bg-slate-700 text-slate-800 dark:text-white font-black w-8 h-8 md:w-10 md:h-10 rounded-full flex items-center justify-center text-sm md:text-lg shadow-sm">
                                                {c.qty}
                                            </span>
                                            <span className="font-bold text-slate-700 dark:text-slate-200 text-sm md:text-base whitespace-nowrap pr-2">{c.name}</span>
                                            
                                            {/* El ícono de menos/borrar gigante para asegurar visibilidad en pantalla normal y touch */}
                                            <div className="absolute -top-2 -right-2 md:-top-3 md:-right-3 bg-red-500 hover:bg-red-600 text-white rounded-full p-1 border-2 border-white dark:border-slate-900 shadow-md transition-colors opacity-100">
                                                <X size={14} strokeWidth={4} />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                                
                                {/* SEND BUTTON */}
                                <button 
                                    onClick={sendRequest}
                                    disabled={sending}
                                    className="bg-red-600 hover:bg-red-700 text-white font-black text-lg md:text-2xl px-8 py-4 rounded-2xl flex items-center justify-center gap-3 shadow-[0_0_25px_rgba(220,38,38,0.5)] active:scale-95 transition-all disabled:opacity-50 h-[80px] w-full md:w-[300px] shrink-0"
                                >
                                    {sending ? <Loader2 className="animate-spin w-8 h-8" /> : (
                                        <>
                                            <AlertTriangle size={30} className="animate-pulse" />
                                            ENVIAR
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>
                    )}
                </div>

            </div>
            {/* Modal de Proyección del Día */}
            {showDayModal && (() => {
                const { sortedHours, hourlyMap, dayTotals, grandTotal } = getHourlyData()
                return (
                    <div className="fixed inset-0 z-[99999] bg-slate-900/80 backdrop-blur-sm flex justify-center items-center p-4 xl:p-10 transition-all">
                        <div className="bg-white dark:bg-slate-900 w-full max-w-5xl h-full max-h-[90vh] rounded-3xl shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-200 border border-slate-200 dark:border-slate-800">
                            {/* Header */}
                            <div className="flex justify-between items-center p-6 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 shrink-0">
                                <div>
                                    <h2 className="text-2xl font-black text-slate-800 dark:text-white uppercase tracking-tighter">Proyección del Día</h2>
                                    <p className="text-slate-500 font-medium text-sm">Consumo promedio histórico esperado por hora (Libras Crudas)</p>
                                </div>
                                <button onClick={() => setShowDayModal(false)} className="bg-slate-200 hover:bg-red-500 hover:text-white cursor-pointer dark:bg-slate-800 dark:hover:bg-red-600 text-slate-700 dark:text-slate-300 p-2 rounded-full transition-colors active:scale-95 shadow-sm">
                                    <X size={28} />
                                </button>
                            </div>
                            
                            {/* Body (Tabla) */}
                            <div className="flex-1 overflow-y-auto bg-slate-100 dark:bg-slate-950">
                                <table className="w-full text-left border-collapse">
                                    <thead className="bg-white dark:bg-slate-800 sticky top-0 shadow-sm z-10">
                                        <tr>
                                            <th className="p-4 font-bold text-slate-400 text-sm tracking-widest pl-6">HORA</th>
                                            <th className="p-4 font-black text-blue-600 dark:text-blue-400 tracking-wider">ASADA</th>
                                            <th className="p-4 font-bold text-slate-500 dark:text-slate-400">CABEZA</th>
                                            <th className="p-4 font-bold text-slate-500 dark:text-slate-400">LENGUA</th>
                                            <th className="p-4 font-bold text-slate-500 dark:text-slate-400">PASTOR</th>
                                            <th className="p-4 font-bold text-slate-500 dark:text-slate-400">POLLO</th>
                                            <th className="p-4 font-black text-slate-800 dark:text-white tracking-widest pr-6 text-right">HORA TOTAL</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {sortedHours.map(hour => {
                                            const data = hourlyMap.get(hour)!
                                            const hrTotal = data.ASADA + data.CABEZA + data.LENGUA + data.PASTOR + data.POLLO
                                            if (hrTotal === 0) return null;
                                            return (
                                                <tr key={hour} className="border-b border-slate-200 dark:border-slate-800/50 hover:bg-white dark:hover:bg-slate-900 transition-colors">
                                                    <td className="p-4 font-black text-slate-600 dark:text-slate-300 pl-6 text-lg">{hour}</td>
                                                    <td className="p-4 font-black text-blue-700 dark:text-blue-400 text-xl">{data.ASADA > 0 ? data.ASADA.toFixed(1) : '-'}</td>
                                                    <td className="p-4 font-bold text-slate-700 dark:text-slate-200">{data.CABEZA > 0 ? data.CABEZA.toFixed(1) : '-'}</td>
                                                    <td className="p-4 font-bold text-slate-700 dark:text-slate-200">{data.LENGUA > 0 ? data.LENGUA.toFixed(1) : '-'}</td>
                                                    <td className="p-4 font-bold text-slate-700 dark:text-slate-200">{data.PASTOR > 0 ? data.PASTOR.toFixed(1) : '-'}</td>
                                                    <td className="p-4 font-bold text-slate-700 dark:text-slate-200">{data.POLLO > 0 ? data.POLLO.toFixed(1) : '-'}</td>
                                                    <td className="p-4 font-black text-slate-800 dark:text-white text-right pr-6">{hrTotal.toFixed(1)} <span className="text-xs opacity-50 font-bold ml-1">lbs</span></td>
                                                </tr>
                                            )
                                        })}
                                    </tbody>
                                </table>
                            </div>

                            {/* Footer (Totales) */}
                            <div className="bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 p-6 flex flex-wrap gap-4 justify-between items-center shadow-[0_-10px_40px_rgba(0,0,0,0.05)] shrink-0 z-20">
                                <div className="flex gap-3 overflow-x-auto pb-2 md:pb-0">
                                    <div className="bg-blue-50 dark:bg-blue-900/30 px-6 py-3 flex flex-col items-center justify-center rounded-2xl border border-blue-200 dark:border-blue-800 shrink-0">
                                        <span className="text-xs uppercase font-bold text-blue-600 dark:text-blue-400">Total Asada</span>
                                        <span className="font-black text-blue-700 dark:text-blue-300 text-3xl">{dayTotals.ASADA.toFixed(1)} <span className="text-sm font-bold opacity-50">lbs</span></span>
                                    </div>
                                    {['CABEZA', 'LENGUA', 'PASTOR', 'POLLO'].map(meat => (
                                        <div key={meat} className="bg-slate-50 dark:bg-slate-800 px-5 py-3 flex flex-col items-center justify-center rounded-2xl border border-slate-200 dark:border-slate-700 shrink-0">
                                            <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">{meat}</span>
                                            <span className="font-bold text-slate-700 dark:text-slate-300 text-xl">{dayTotals[meat as keyof typeof dayTotals].toFixed(1)}</span>
                                        </div>
                                    ))}
                                </div>
                                
                                <div className="bg-slate-800 text-white dark:bg-white dark:text-slate-900 px-8 py-4 rounded-2xl flex flex-col items-center justify-center shadow-lg shrink-0">
                                    <span className="text-xs uppercase font-bold text-blue-200 dark:text-blue-700 tracking-widest">Ritmo Diario Total</span>
                                    <span className="font-black text-4xl">{grandTotal.toFixed(1)} <span className="text-sm opacity-60 ml-1">LBS</span></span>
                                </div>
                            </div>
                        </div>
                    </div>
                )
            })()}

            <audio id="audio-tick" src="/sounds/tick.mp3" preload="auto" />

            {/* Info Modal */}
            <AnimatePresence>
                {showInfoModal && (
                    <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4">
                        <motion.div 
                            initial={{ opacity: 0 }} 
                            animate={{ opacity: 1 }} 
                            exit={{ opacity: 0 }} 
                            className="absolute inset-0 bg-slate-900/80 backdrop-blur-sm"
                            onClick={() => setShowInfoModal(false)}
                        />
                        <motion.div 
                            initial={{ opacity: 0, scale: 0.95, y: 20 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95, y: 20 }}
                            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 w-full max-w-[95vw] md:max-w-5xl rounded-3xl p-6 md:p-10 shadow-2xl relative z-10 max-h-[95vh] flex flex-col"
                        >
                            <button 
                                onClick={() => setShowInfoModal(false)}
                                className="absolute top-6 right-6 p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-800 dark:hover:text-white transition-colors"
                            >
                                <X size={24} />
                            </button>
                            
                            <h2 className="text-2xl md:text-3xl font-black text-slate-800 dark:text-white mb-2 tracking-tight">
                                Proyección de Carnes
                            </h2>
                            <p className="text-slate-500 mb-6 md:mb-8 border-b border-slate-200 dark:border-slate-800 pb-4 md:pb-6 text-sm md:text-base shrink-0">
                                Cómo la Inteligencia Artificial calcula estas libras históricas para la mesa de línea:
                            </p>
                            
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 text-slate-600 dark:text-slate-300 overflow-y-auto shrink pb-2">
                                <div className="bg-slate-50 dark:bg-slate-800/50 p-5 md:p-6 rounded-2xl border border-slate-200 dark:border-slate-700/50 relative overflow-hidden">
                                    <div className="absolute top-0 right-0 w-32 h-32 bg-red-500/5 dark:bg-red-500/10 rounded-full blur-3xl" />
                                    <h3 className="text-xl md:text-2xl font-black tracking-widest text-slate-800 dark:text-slate-100 uppercase mb-4 flex items-center gap-3">
                                        🥩 LIBRAS CRUDAS
                                    </h3>
                                    <p className="mb-5 font-medium">
                                        Para Asada, Pastor, Pollo, Cabeza y Lengua, los números gigantes representan la demanda física proyectada en <b className="text-red-600 dark:text-red-400">Libras Crudas (No Cocidas)</b>.
                                    </p>
                                    <ul className="list-inside space-y-4 font-medium text-sm md:text-base">
                                        <li className="flex items-start gap-2">
                                            <span className="text-emerald-600 dark:text-emerald-500 mt-1">1.</span> 
                                            <span>El sistema extrae el número de mulitas, tacos, burritos, etc., vendidos a esta hora a lo largo de los años.</span>
                                        </li>
                                        <li className="flex items-start gap-2">
                                            <span className="text-emerald-600 dark:text-emerald-500 mt-1">2.</span> 
                                            <span>Multiplica cada platillo por su peso de receta en onzas y luego aplica la <b className="text-slate-800 dark:text-white">merma de cocción (Yield)</b> en reversa para saber cuánto pesaba la carne cruda original.</span>
                                        </li>
                                        <li className="flex items-start gap-2">
                                            <span className="text-emerald-600 dark:text-emerald-500 mt-1">3.</span> 
                                            <span><b>Explicación final:</b> El número en pantalla es exactamente la cantidad de carne cruda que el preparador o taquero deberá sacer y poner a la lumbre o plancha para sostener el ritmo de esa media hora, sin que le falte ni le sobre demasiado.</span>
                                        </li>
                                    </ul>
                                </div>

                                <div className="bg-slate-50 dark:bg-slate-800/50 p-5 md:p-6 rounded-2xl border border-slate-200 dark:border-slate-700/50 relative overflow-hidden">
                                    <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/5 dark:bg-blue-500/10 rounded-full blur-3xl" />
                                    <h3 className="text-xl md:text-2xl font-black tracking-widest text-slate-800 dark:text-slate-100 uppercase mb-4 flex items-center gap-3">
                                        📅 PROMEDIO HISTÓRICO
                                    </h3>
                                    <p className="mb-5 font-medium">
                                        ¿De dónde saca la IA estos números que me pide cocinar?
                                    </p>
                                    <ul className="list-inside space-y-4 font-medium text-sm md:text-base">
                                        <li className="flex items-start gap-2">
                                            <span className="text-blue-600 dark:text-blue-500 mt-1">✔</span> 
                                            <span>El sistema lee el historial analítico de transacciones de los últimos <b>años</b> de esta misma sucursal.</span>
                                        </li>
                                        <li className="flex items-start gap-2">
                                            <span className="text-blue-600 dark:text-blue-500 mt-1">✔</span> 
                                            <span>Busca específicamente <b>este día de la semana</b> (ej. si hoy es Lunes, promedia todos los últimos Lunes).</span>
                                        </li>
                                        <li className="flex items-start gap-2">
                                            <span className="text-blue-600 dark:text-blue-500 mt-1">✔</span> 
                                            <span>Promedia exclusivamente <b>este bloque de media hora</b>, garantizando que el Ritmo de Cocción siga fielmente la hora pico local de la tienda sin que tengas que adivinar.</span>
                                        </li>
                                    </ul>
                                </div>
                            </div>
                            
                            <div className="mt-6 md:mt-8 pt-6 border-t border-slate-200 dark:border-slate-800 shrink-0">
                                <button 
                                    onClick={() => setShowInfoModal(false)}
                                    className="w-full bg-blue-600 hover:bg-blue-700 active:scale-95 text-white font-black uppercase md:text-xl tracking-widest py-4 rounded-xl transition-all shadow-lg shadow-blue-500/30"
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
