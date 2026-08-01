'use client'

import { useState, useEffect, useRef } from 'react'
import { useLanguage } from '@/lib/i18n'
import { BellRing, ChefHat, Clock, AlertTriangle, Send, UtensilsCrossed, PackageOpen, X, Loader2, Play, Maximize, Minimize, HelpCircle, CheckCircle2, TrendingDown } from 'lucide-react'
import { useAuth } from '@/components/ProtectedRoute'
import { createClient } from '@/lib/supabase-client'
import { motion, AnimatePresence } from 'framer-motion'
        

interface MeatData {
    interval_start: string
    meat_type: string
    avg_lbs: number
    samples: number
    real_lbs?: number
}

const C1 = 'bg-emerald-200 border-emerald-300 text-emerald-900 hover:bg-emerald-300 dark:bg-emerald-800 dark:border-emerald-700 dark:text-emerald-50'
const C2 = 'bg-orange-200 border-orange-300 text-orange-900 hover:bg-orange-300 dark:bg-orange-800 dark:border-orange-700 dark:text-orange-50'
const C3 = 'bg-sky-200 border-sky-300 text-sky-900 hover:bg-sky-300 dark:bg-sky-800 dark:border-sky-700 dark:text-sky-50'
const C4 = 'bg-rose-200 border-rose-300 text-rose-900 hover:bg-rose-300 dark:bg-rose-800 dark:border-rose-700 dark:text-rose-50'
const C5 = 'bg-amber-200 border-amber-300 text-amber-900 hover:bg-amber-300 dark:bg-amber-800 dark:border-amber-700 dark:text-amber-50'

const ALIMENTOS = [
    { name: 'Guacamole', color: C1 }, { name: 'Crema', color: C1 }, { name: 'Mayonesa', color: C1 }, { name: 'Mulitas', color: C1 }, { name: 'Quesadillas', color: C1 },
    { name: 'Arroz', color: C2 }, { name: 'Cabeza', color: C2 }, { name: 'Lengua', color: C2 }, { name: 'Frijol molido', color: C2 },
    { name: 'Milaneza', color: C3 }, { name: 'Salchicha', color: C3 }, { name: 'Jamon', color: C3 }, { name: 'Huevos', color: C3 }, { name: 'Papelitos', color: C3 }, { name: 'Queso Jack', color: C3 }, { name: 'Queso Fresco', color: C3 }, { name: 'Queso cotija', color: C3 }, { name: 'Queso Nachos', color: C3 }, { name: 'Cebolla y cilantro', color: C3 }, { name: 'Salsa verde', color: C3 }, { name: 'Salsa roja', color: C3 },
    { name: 'Asada', color: C4 }, { name: 'Pastor', color: C4 }, { name: 'Pollo', color: C4 }, { name: 'Carnitas', color: C4 }, { name: 'Chorizo', color: C4 }, { name: 'Buche', color: C4 }, { name: 'Cebolla Asada', color: C4 }, { name: 'Frijoles de la Olla', color: C4 },
    { name: 'Tortillas de maiz', color: C5 }, { name: 'Tortillas Burritos', color: C5 }, { name: 'Teleras', color: C5 }, { name: 'Chips', color: C5 }, { name: 'Manteca', color: C5 }
]

const DESECHABLES = [
    'Cover tacos', 'Papel tortas', 'Platos blancos', 'Platos nachos', 'Platos (3)', 
    'Platos sopes', 'Charolas rojas', 'Vasos 4oz', 'Vasos 8oz'
].map(n => ({ name: n, color: 'bg-slate-700 hover:bg-slate-800 text-white dark:bg-slate-800 dark:hover:bg-slate-700' }))

export default function PreparadorLineaPage() {
    const { user, loading: authLoading } = useAuth()
    const { t } = useLanguage()
    const supabase = createClient()

    const [mounted, setMounted] = useState(false)
    const [stores, setStores] = useState<any[]>([])
    const [storeId, setStoreId] = useState('')
    const [businessDow, setBusinessDow] = useState<number | null>(null)
    
    // Meat Historial Data
    const [meatData, setMeatData] = useState<MeatData[]>([])
    const [realMeatData, setRealMeatData] = useState<{interval_start: string, meat_type: string, real_lbs: number}[]>([])
    const [fetchingMeat, setFetchingMeat] = useState(false)
    const [carouselBuckets, setCarouselBuckets] = useState<{ id: string, label: string, isCurrent: boolean, data: MeatData[] }[]>([])
    const [intelligenceAcelerador, setIntelligenceAcelerador] = useState(1.0)
    const [weatherAlert, setWeatherAlert] = useState(false)
    const [activeIndex, setActiveIndex] = useState(0)
    const [currentBucketIndex, setCurrentBucketIndex] = useState(0)
    const hasInitializedRef = useRef(false)

    // Touch handlers for Carousel
    const [touchStart, setTouchStart] = useState<number | null>(null)
    const [touchEnd, setTouchEnd] = useState<number | null>(null)
    const [showInfoModal, setShowInfoModal] = useState(false)

    // Inactivity Reset Effect (Aero snap-back)
    useEffect(() => {
        if (activeIndex === currentBucketIndex) return;
        
        const timer = setTimeout(() => {
            setActiveIndex(currentBucketIndex) // Snap back to current time bucket
        }, 5000)
        
        return () => clearTimeout(timer)
    }, [activeIndex, currentBucketIndex])

    // Request Cart
    const [activeTab, setActiveTab] = useState<'alimentos'|'desechables'>('alimentos')
    const [cart, setCart] = useState<{name: string, qty: number}[]>([])
    const [sending, setSending] = useState(false)
    const [showDayModal, setShowDayModal] = useState(false)
    
    // Waste Dashboard Modal
    const [showWasteModal, setShowWasteModal] = useState(false)
    const [selectedWasteDate, setSelectedWasteDate] = useState('')
    const [wasteData, setWasteData] = useState<any[]>([])
    const [loadingWasteData, setLoadingWasteData] = useState(false)
    const [showWasteInfo, setShowWasteInfo] = useState(false)

    // Carga de Datos de Merma (para el día de hoy o días pasados)
    useEffect(() => {
        if (!showWasteModal || !storeId) return

        // Función para obtener la fecha local de LA de hoy
        const getLATodayStr = () => {
            const laTimeStr = new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })
            const laDate = new Date(laTimeStr)
            if (laDate.getHours() < 6) laDate.setDate(laDate.getDate() - 1)
            return laDate.getFullYear() + '-' + String(laDate.getMonth() + 1).padStart(2, '0') + '-' + String(laDate.getDate()).padStart(2, '0')
        }

        const todayStr = getLATodayStr()
        
        // Si no se ha inicializado la fecha seleccionada, la ponemos en hoy
        if (!selectedWasteDate) {
            setSelectedWasteDate(todayStr)
            return
        }

        const loadData = async () => {
            setLoadingWasteData(true)
            const proteins = ['ASADA', 'PASTOR', 'POLLO', 'CABEZA', 'LENGUA']
            const isToday = selectedWasteDate === todayStr

            if (isToday) {
                // Para hoy, calculamos en base a los datos en vivo que ya están cargados en el componente
                // 1. Obtener la hora actual en LA para ver qué bloques ya se completaron
                const d = new Date()
                const formatter = new Intl.DateTimeFormat('en-US', {
                    timeZone: 'America/Los_Angeles', hour: 'numeric', minute: 'numeric', hour12: false
                });
                let timeParts = formatter.format(d).split(':')
                let h = parseInt(timeParts[0], 10)
                let m = parseInt(timeParts[1], 10)
                if (h === 24) h = 0;
                const curMin = h * 60 + m;

                const stats = proteins.map(proto => {
                    let totalProj = 0
                    let totalReal = 0
                    let count = 0

                    carouselBuckets.forEach((bucket) => {
                        const [bh, bm] = bucket.id.split(':').map(Number)
                        const bMin = bh * 60 + bm
                        
                        const adjustedBMin = bh < 6 ? bMin + 24 * 60 : bMin
                        const adjustedCurMin = h < 6 ? curMin + 24 * 60 : curMin
                        
                        if (adjustedBMin < adjustedCurMin) {
                            const item = bucket.data.find(d => d.meat_type === proto)
                            if (item) {
                                totalProj += item.avg_lbs * intelligenceAcelerador
                                if (item.real_lbs !== undefined) {
                                    totalReal += item.real_lbs
                                    count++
                                }
                            }
                        }
                    })

                    return {
                        proto,
                        totalProj,
                        totalReal,
                        hasRealData: count > 0
                    }
                })
                setWasteData(stats)
                setLoadingWasteData(false)
            } else {
                // Para días pasados: cargamos dinámicamente de la base de datos y la API
                try {
                    // A. Calcular el DOW de la fecha seleccionada
                    const parts = selectedWasteDate.split('-').map(Number)
                    const parsedDate = new Date(parts[0], parts[1] - 1, parts[2])
                    const jsDow = parsedDate.getDay()
                    const targetDOW = jsDow === 0 ? 7 : jsDow

                    // B. Carga de proyecciones históricas (promedios) para ese DOW
                    const resHistory = await fetch(`/api/inventory/preparador-history?storeId=${storeId}&dow=${targetDOW}`)
                    const historyJson = await resHistory.json()

                    // C. Carga de factor de inteligencia de ese día
                    const resIntel = await fetch(`/api/preparador/intelligence?store_id=${storeId}&date=${selectedWasteDate}`)
                    const intelJson = resIntel.ok ? await resIntel.json() : { growth_factor: 1.0 }
                    const factor = intelJson.growth_factor || 1.0

                    // D. Carga de consumos reales grabados en DB para ese día
                    const { data: realData, error: dbErr } = await supabase
                        .from('meat_consumption_history')
                        .select('interval_start, meat_type, raw_lbs')
                        .eq('store_id', storeId)
                        .eq('business_date', selectedWasteDate)

                    if (dbErr) throw dbErr

                    const stats = proteins.map(proto => {
                        let totalProj = 0
                        let totalReal = 0
                        let count = 0

                        // El histórico tiene intervalos de 30 mins (igual que hoy)
                        if (Array.isArray(historyJson)) {
                            const filteredHist = historyJson.filter((m: any) => m.meat_type === proto)
                            filteredHist.forEach((item: any) => {
                                totalProj += item.avg_lbs * factor
                            })
                        }

                        // Consumo real registrado
                        if (Array.isArray(realData)) {
                            const filteredReal = realData.filter((d: any) => d.meat_type === proto)
                            filteredReal.forEach((item: any) => {
                                totalReal += Number(item.raw_lbs || 0)
                                count++
                            })
                        }

                        return {
                            proto,
                            totalProj,
                            totalReal,
                            hasRealData: count > 0
                        }
                    })
                    setWasteData(stats)
                } catch (e) {
                    console.error("Error loading past waste data:", e)
                    setWasteData([])
                } finally {
                    setLoadingWasteData(false)
                }
            }
        }

        loadData()
    }, [showWasteModal, selectedWasteDate, storeId, carouselBuckets, intelligenceAcelerador, supabase])

    // Wake Lock Effect to keep screen active on tablets
    useEffect(() => {
        let wakeLock: any = null;
        async function requestWakeLock() {
            try {
                if ('wakeLock' in navigator) {
                    wakeLock = await (navigator as any).wakeLock.request('screen');
                    console.log("Wake Lock acquired successfully");
                }
            } catch (err) {
                console.warn("Wake Lock failed:", err);
            }
        }
        requestWakeLock();
        
        const handleVisibilityChange = () => {
            if (wakeLock !== null && document.visibilityState === 'visible') {
                requestWakeLock();
            }
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            if (wakeLock) {
                wakeLock.release().then(() => {
                    wakeLock = null;
                });
            }
        };
    }, []);

    // Alarma de Cocción
    const [showCookAlert, setShowCookAlert] = useState(false)
    const [nextBlockLabel, setNextBlockLabel] = useState('')
    const cookAlarmRef = useRef<HTMLAudioElement | null>(null)
    const lastCookAlertRef = useRef<string | null>(null)

    // Agrupación de datos para el Modal VIEW DAY
    // @businessRule: Solo se proyectan las carnes de PARRILLA (Asada, Pastor, Pollo, Cabeza, Lengua).
    // Buche, Chorizo y Carnitas se cocinan AL MOMENTO y no requieren proyección de pace.
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
                const res = await fetch(`/api/inventory/preparador-history?storeId=${storeId}&dow=${businessDow}&_t=${Date.now()}`, { cache: 'no-store' })
                const json = await res.json()
                if (Array.isArray(json)) {
                    // @businessRule: Solo se proyectan carnes de PARRILLA que necesitan anticipación.
                    const tablet1Proteins = ['ASADA', 'PASTOR', 'POLLO', 'CARNITAS', 'CABEZA', 'LENGUA']
                    setMeatData(json.filter((m: any) => tablet1Proteins.includes(m.meat_type)))
                    localStorage.setItem(`prep_meat_history_${storeId}_${businessDow}`, JSON.stringify(json))
                }
            } catch (err) {
                console.error(err)
                const cached = localStorage.getItem(`prep_meat_history_${storeId}_${businessDow}`)
                if (cached) {
                    try {
                        const json = JSON.parse(cached)
                        const tablet1Proteins = ['ASADA', 'PASTOR', 'POLLO', 'CARNITAS', 'CABEZA', 'LENGUA']
                        setMeatData(json.filter((m: any) => tablet1Proteins.includes(m.meat_type)))
                    } catch (e) {}
                }
            } finally {
                setFetchingMeat(false)
            }
        }
        fetchHistory()
    }, [storeId, businessDow])

    // Load Real Meat Consumptions for TODAY
    useEffect(() => {
        if (!storeId) return
        const fetchRealD = async () => {
            const laTimeStr = new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })
            const laDate = new Date(laTimeStr)
            if (laDate.getHours() < 6) laDate.setDate(laDate.getDate() - 1)
            const dStr = laDate.getFullYear() + '-' + String(laDate.getMonth() + 1).padStart(2, '0') + '-' + String(laDate.getDate()).padStart(2, '0')

            try {
                const { data } = await supabase.from('meat_consumption_history')
                    .select('interval_start, meat_type, raw_lbs')
                    .eq('store_id', storeId)
                    .eq('business_date', dStr)
                    
                if (data) {
                    setRealMeatData(data.map(d => ({
                        interval_start: d.interval_start,
                        meat_type: d.meat_type,
                        real_lbs: d.raw_lbs
                    })))
                    localStorage.setItem(`prep_real_meat_${storeId}`, JSON.stringify(data))
                }
            } catch (err) {
                console.error("Real meat fetch error:", err)
                const cached = localStorage.getItem(`prep_real_meat_${storeId}`)
                if (cached) {
                    try {
                        const data = JSON.parse(cached)
                        setRealMeatData(data.map((d: any) => ({
                            interval_start: d.interval_start,
                            meat_type: d.meat_type,
                            real_lbs: d.raw_lbs
                        })))
                    } catch (e) {}
                }
            }
        }
        fetchRealD()
        const int = setInterval(fetchRealD, 3 * 60 * 1000) // update every 3m
        return () => clearInterval(int)
    }, [storeId, supabase])

    // Intelligence Fetcher (Opción 2 - Proyección Dinámica viva)
    useEffect(() => {
        if (!storeId) return
        const fetchIntelligence = async () => {
            try {
                const res = await fetch(`/api/preparador/intelligence?store_id=${storeId}&_t=${Date.now()}`, { cache: 'no-store' })
                if (res.ok) {
                    const data = await res.json()
                    setIntelligenceAcelerador(data.growth_factor || 1.0)
                    setWeatherAlert(data.weather_adjustment || false)
                    localStorage.setItem(`prep_intelligence_${storeId}`, JSON.stringify(data))
                }
            } catch (err) {
                console.error("Intelligence error:", err)
                const cached = localStorage.getItem(`prep_intelligence_${storeId}`)
                if (cached) {
                    try {
                        const data = JSON.parse(cached)
                        setIntelligenceAcelerador(data.growth_factor || 1.0)
                        setWeatherAlert(data.weather_adjustment || false)
                    } catch (e) {}
                }
            }
        }
        fetchIntelligence()
        const int = setInterval(fetchIntelligence, 3 * 60 * 1000) // Refrescar acelerador vivo cada 3 minutos
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
            
            const arr = []
            let tempH = 6 
            let tempM = 0
            let foundCurrentIndex = 0
            
            // Generate full 48 buckets (6:00 AM to 5:30 AM)
            for (let i = 0; i < 48; i++) {
                let hrStr = tempH.toString().padStart(2, '0')
                let minStr = tempM.toString().padStart(2, '0')
                let bucketId = `${hrStr}:${minStr}:00`
                
                let nxtM = tempM === 0 ? 30 : 0
                let nxtH = tempM === 30 ? (tempH + 1) % 24 : tempH
                
                let label = `${formatTime12(tempH, tempM)} a ${formatTime12(nxtH, nxtM)}`
                
                let data: MeatData[] = []
                if (meatData.length > 0) {
                    const sortOrder: Record<string, number> = { 'ASADA': 1, 'PASTOR': 2, 'POLLO': 3, 'CABEZA': 4, 'LENGUA': 5, 'CARNITAS': 6 }
                    data = meatData.filter(m => m.interval_start === bucketId && m.meat_type !== 'CARNITAS')
                        .sort((a,b) => (sortOrder[a.meat_type] || 99) - (sortOrder[b.meat_type] || 99))
                        .map(m => {
                             const realD = realMeatData.find(rm => rm.interval_start === bucketId && rm.meat_type === m.meat_type)
                             return { ...m, real_lbs: realD ? realD.real_lbs : undefined }
                        })
                }
                
                let isCurrent = (tempH === h && tempM === curM)
                if (isCurrent) foundCurrentIndex = i

                arr.push({ id: bucketId, label, isCurrent, data })
                
                tempH = nxtH
                tempM = nxtM
            }

            setCurrentBucketIndex(foundCurrentIndex)
            if (!hasInitializedRef.current) {
                setActiveIndex(foundCurrentIndex)
                hasInitializedRef.current = true
            }
            
            setCarouselBuckets(arr)

            // Trigger Alert 10 minutes before the hour/half-hour (at :20 or :50)
            if ((m === 20 || m === 50) && arr.length > 1 && foundCurrentIndex < 47) {
                const signature = `${h}-${m}`
                if (lastCookAlertRef.current !== signature) {
                    lastCookAlertRef.current = signature
                    setNextBlockLabel(arr[foundCurrentIndex + 1].label)
                    setShowCookAlert(true)
                    // Haptic feedback / vibration for tablet alerts
                    if (typeof navigator !== 'undefined' && navigator.vibrate) {
                        navigator.vibrate([500, 200, 500])
                    }
                    // Play sound if available
                    if (cookAlarmRef.current) {
                        // Reset audio and play
                        try {
                            cookAlarmRef.current.src = "/sounds/alarm.mp3"
                            cookAlarmRef.current.muted = false
                            cookAlarmRef.current.volume = 1.0
                            const playPromise = cookAlarmRef.current.play()
                            if (playPromise !== undefined) {
                                playPromise.catch(e => console.error("Audio block:", e))
                            }
                        } catch(err) {}
                    }
                }
            }
        }
        
        updateBuckets()
        const int = setInterval(updateBuckets, 60000) // update every minute
        return () => clearInterval(int)
    }, [meatData, realMeatData])

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
        return <div className="p-8 text-center text-red-500 text-2xl font-bold">{t('prep.accessDenied')}</div>
    }

    return (
        <div ref={containerRef} className={`flex flex-col overflow-hidden bg-slate-100 dark:bg-slate-950 transition-all ${isFullscreen ? 'fixed inset-0 z-[9999] h-screen w-screen' : 'h-[calc(100vh-64px)]'}`}>
            <audio ref={cookAlarmRef} src="/sounds/alarm.mp3" preload="auto" loop className="hidden" />

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
                                {t('prep.prepareNextBlock')}
                            </h2>
                            <p className="text-red-200 font-medium text-2xl md:text-4xl mb-12 uppercase tracking-wide bg-red-950/50 py-4 px-8 rounded-2xl border border-red-500/30">
                                {t('prep.nextSchedule')}<br/>
                                <span className="text-white font-black">{nextBlockLabel}</span>
                            </p>
                            <button 
                                onClick={() => {
                                    setShowCookAlert(false)
                                    if (cookAlarmRef.current) {
                                        try {
                                            cookAlarmRef.current.muted = true
                                            cookAlarmRef.current.volume = 0
                                            cookAlarmRef.current.pause()
                                            cookAlarmRef.current.removeAttribute('src')
                                            cookAlarmRef.current.load()
                                        } catch(e) {}
                                    }
                                }}
                                className="w-full md:w-[400px] bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 text-white font-black text-3xl px-10 py-8 rounded-3xl shadow-[0_0_50px_rgba(16,185,129,0.3)] transition-transform active:scale-95 border-b-8 border-emerald-700 flex flex-col items-center justify-center"
                            >
                                <CheckCircle2 size={40} className="mb-2" />
                                {t('prep.understood')}
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
                        <h1 className="text-xl font-black text-slate-800 dark:text-white leading-tight">{t('prep.title')}</h1>
                        <p className="text-xs text-slate-500 font-medium">{t('prep.subtitle')}</p>
                    </div>
                </div>
                
                <div className="flex items-center justify-center gap-2 md:gap-4 flex-wrap w-full md:w-auto">
                    <button 
                        onClick={toggleFullscreen}
                        className="flex items-center gap-2 bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 px-3 py-2 rounded-lg font-bold text-sm transition-colors"
                        title={t('prep.tabletMode')}
                    >
                        {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
                        <span className="hidden sm:inline">{isFullscreen ? t('prep.exit') : t('prep.tablet')}</span>
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
                    
                    <button 
                        onClick={() => setShowWasteModal(true)} 
                        className="flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg font-bold text-sm transition-colors shadow-lg shadow-red-900/20 cursor-pointer"
                    >
                        <TrendingDown size={16} />
                        <span className="hidden sm:inline">{t('prep.wasteReportBtn')}</span>
                    </button>

                    <a href="/inventory/preparador/bodega" target="_blank" className="flex items-center gap-2 bg-slate-800 hover:bg-black text-white px-4 py-2 rounded-lg font-bold text-sm transition-colors shadow-lg shadow-slate-900/20">
                        <BellRing size={16} className="animate-pulse" />
                        <span className="hidden sm:inline">{t('prep.openWarehouse')}</span>
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
                                <h2 className="font-black text-slate-800 dark:text-white uppercase tracking-wider text-lg lg:text-2xl flex items-center gap-2">
                                    {t('prep.cookingPace')}
                                    {intelligenceAcelerador !== 1.0 && (
                                        <span className={`text-sm px-2 py-0.5 rounded-lg border ${intelligenceAcelerador > 1 ? 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800/50 shadow-[0_0_10px_rgba(239,68,68,0.2)]' : 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800/50'}`}>
                                            Pace {intelligenceAcelerador > 1 ? '+' : ''}{((intelligenceAcelerador - 1) * 100).toFixed(0)}%
                                        </span>
                                    )}
                                </h2>
                                <p className="text-sm md:text-base text-slate-500 font-medium hidden sm:block">{t('prep.liveProjection')}</p>
                            </div>
                        </div>
                        <button onClick={() => setShowDayModal(true)} className="bg-blue-100 hover:bg-blue-200 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300 dark:hover:bg-blue-900 px-4 md:px-6 py-2 md:py-3 rounded-xl text-sm md:text-lg font-black transition-colors shrink-0 shadow-sm ml-2">
                            {t('prep.viewDay')}
                        </button>
                    </div>

                    {fetchingMeat ? (
                        <div className="flex flex-col items-center justify-center flex-1 text-slate-400 gap-3">
                            <Loader2 className="w-10 h-10 animate-spin text-blue-500" />
                            <p className="font-bold">{t('prep.calculatingHistory')}</p>
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
                                        className="w-full max-w-[95%] md:max-w-[480px] lg:max-w-lg shrink-0 origin-center select-none"
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
                                                                    {isRealCurrent ? t('prep.now') : (localIndex === 1 && activeIndex === currentBucketIndex ? t('prep.next') : (activeIndex < currentBucketIndex ? t('prep.past') : t('prep.projection')))}
                                                                    {isTop && <HelpCircle size={20} className="text-blue-500/50 hover:text-blue-500 transition-colors" />}
                                                                </span>
                                                                <span className={`text-2xl md:text-4xl font-black lowercase tracking-tighter [font-feature-settings:'tnum'] ${isTop ? 'opacity-90 text-blue-950 dark:text-blue-100' : 'opacity-60'}`}>
                                                                    {bucket.label}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    
                                                    <div className="grid grid-cols-2 gap-3 xl:gap-4">
                                                        {bucket.data.length > 0 ? bucket.data.map(m => (
                                                            <div key={m.meat_type} className={`bg-white/60 dark:bg-slate-900/60 p-3 xl:p-4 rounded-2xl flex flex-col items-center justify-center shadow-sm w-full ${m.meat_type === 'ASADA' ? 'col-span-2 shadow-md border border-blue-200/50 dark:border-blue-800/50 bg-blue-50/50 dark:bg-blue-900/30 py-4 xl:py-6' : 'border border-slate-100 dark:border-slate-800 py-4 xl:py-5'}`}>
                                                                <span className={`uppercase tracking-widest text-slate-600 dark:text-slate-300 mb-1 md:mb-2 ${m.meat_type === 'ASADA' ? 'text-lg md:text-2xl font-black text-blue-800 dark:text-blue-300' : 'text-base md:text-xl font-black'}`}>{m.meat_type}</span>
                                                                
                                                                <div className="flex w-full items-center justify-center gap-4">
                                                                    {/* Projected Column (attenuated when real data exists) */}
                                                                    <div className={`flex flex-col items-center justify-center leading-none transition-all duration-300 ${m.real_lbs !== undefined ? 'opacity-40 scale-90' : 'opacity-100'}`}>
                                                                        <span className={`font-black tracking-tighter leading-none ${m.meat_type === 'ASADA' ? 'text-6xl xl:text-[5.5rem] text-blue-700 dark:text-blue-400 drop-shadow-sm' : 'text-5xl xl:text-6xl text-slate-800 dark:text-white'}`}>
                                                                            {(m.avg_lbs * intelligenceAcelerador).toFixed(1)}
                                                                        </span>
                                                                        <span className="text-[10px] md:text-xs font-bold text-slate-500 dark:text-slate-400 tracking-wider mt-2 bg-white/50 dark:bg-slate-800/50 px-2 py-0.5 rounded-md">{t('prep.proy')} {m.avg_lbs.toFixed(1)}</span>
                                                                    </div>
                                                                    
                                                                    {/* Real Consumed Column */}
                                                                    {m.real_lbs !== undefined ? (
                                                                        <>
                                                                            <div className="h-16 w-px bg-slate-300/50 dark:bg-slate-700/50"></div>
                                                                            <div className="flex flex-col items-center justify-center leading-none">
                                                                                <span className={`font-black tracking-tighter leading-none text-emerald-600 dark:text-emerald-400 ${m.meat_type === 'ASADA' ? 'text-4xl xl:text-5xl animate-pulse' : 'text-3xl xl:text-4xl animate-pulse'}`}>
                                                                                    {m.real_lbs.toFixed(1)}
                                                                                </span>
                                                                                <span className="text-[10px] md:text-xs font-bold text-emerald-700 dark:text-emerald-500 tracking-wider mt-2 bg-emerald-500/10 px-2 py-0.5 rounded-md">{t('prep.real')}</span>
                                                                            </div>
                                                                        </>
                                                                    ) : (activeIndex < currentBucketIndex) && (
                                                                        <>
                                                                            <div className="h-16 w-px bg-slate-300/50 dark:bg-slate-700/50"></div>
                                                                            <div className="flex flex-col items-center justify-center leading-none">
                                                                                <span className="text-[10px] md:text-xs font-bold text-amber-600 dark:text-amber-400 tracking-wide mt-2 bg-amber-500/10 px-2 py-1 rounded-md animate-pulse">
                                                                                    {t('prep.syncing')}
                                                                                </span>
                                                                            </div>
                                                                        </>
                                                                    )}
                                                                </div>
                                                            </div>
                                                )) : <p className="col-span-2 text-center text-sm font-medium text-slate-400 py-6 opacity-70">{t('prep.noProjectionData')}</p>}
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
                            <UtensilsCrossed size={20} /> {t('prep.foodItems')}
                        </button>
                        <button 
                            onClick={() => setActiveTab('desechables')}
                            className={`flex-1 py-4 font-black flex items-center justify-center gap-2 rounded-xl transition-all shadow-sm
                                ${activeTab === 'desechables' ? 'bg-blue-100 text-blue-700 border-2 border-blue-500 dark:bg-blue-900/30 dark:text-blue-300' : 'bg-slate-50 text-slate-500 hover:bg-slate-200 border-2 border-transparent dark:bg-slate-800'}`}
                        >
                            <PackageOpen size={20} /> {t('prep.disposables')}
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
                                            {t('prep.send')}
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
                                    <h2 className="text-2xl font-black text-slate-800 dark:text-white uppercase tracking-tighter">{t('prep.dayProjection')}</h2>
                                    <p className="text-slate-500 font-medium text-sm">{t('prep.dayProjectionDesc')}</p>
                                </div>
                                <button onClick={() => setShowDayModal(false)} className="bg-slate-200 hover:bg-red-500 hover:text-white cursor-pointer dark:bg-slate-800 dark:hover:bg-red-600 text-slate-700 dark:text-slate-300 p-2 rounded-full transition-colors active:scale-95 shadow-sm">
                                    <X size={28} />
                                </button>
                            </div>
                            
                            {/* Body (Tabla) */}
                            <div className="flex-1 overflow-x-auto overflow-y-auto bg-slate-100 dark:bg-slate-950 custom-scrollbar">
                                <table className="w-full text-left border-collapse">
                                    <thead className="bg-white dark:bg-slate-800 sticky top-0 shadow-sm z-10">
                                        <tr>
                                            <th className="p-4 font-bold text-slate-400 text-sm tracking-widest pl-6">{t('prep.hour')}</th>
                                            <th className="p-4 font-black text-blue-600 dark:text-blue-400 tracking-wider">ASADA</th>
                                            <th className="p-4 font-bold text-slate-500 dark:text-slate-400">POLLO</th>
                                            <th className="p-4 font-bold text-slate-500 dark:text-slate-400">PASTOR</th>
                                            <th className="p-4 font-bold text-slate-500 dark:text-slate-400">CABEZA</th>
                                            <th className="p-4 font-bold text-slate-500 dark:text-slate-400">LENGUA</th>
                                            <th className="p-4 font-black text-slate-800 dark:text-white tracking-widest pr-6 text-right">{t('prep.hourTotal')}</th>
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
                                                    <td className="p-4 font-bold text-slate-700 dark:text-slate-200">{data.POLLO > 0 ? data.POLLO.toFixed(1) : '-'}</td>
                                                    <td className="p-4 font-bold text-slate-700 dark:text-slate-200">{data.PASTOR > 0 ? data.PASTOR.toFixed(1) : '-'}</td>
                                                    <td className="p-4 font-bold text-slate-700 dark:text-slate-200">{data.CABEZA > 0 ? data.CABEZA.toFixed(1) : '-'}</td>
                                                    <td className="p-4 font-bold text-slate-700 dark:text-slate-200">{data.LENGUA > 0 ? data.LENGUA.toFixed(1) : '-'}</td>
                                                    <td className="p-4 font-black text-slate-800 dark:text-white text-right pr-6">{hrTotal.toFixed(1)} <span className="text-xs opacity-50 font-bold ml-1">{t('prep.lbs')}</span></td>
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
                                        <span className="text-xs uppercase font-bold text-blue-600 dark:text-blue-400">{t('prep.totalLabel')} Asada</span>
                                        <span className="font-black text-blue-700 dark:text-blue-300 text-3xl">{dayTotals.ASADA.toFixed(1)} <span className="text-sm font-bold opacity-50">{t('prep.lbs')}</span></span>
                                    </div>
                                    {['POLLO', 'PASTOR', 'CABEZA', 'LENGUA'].map(meat => (
                                        <div key={meat} className="bg-slate-50 dark:bg-slate-800 px-5 py-3 flex flex-col items-center justify-center rounded-2xl border border-slate-200 dark:border-slate-700 shrink-0">
                                            <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">{meat}</span>
                                            <span className="font-bold text-slate-700 dark:text-slate-300 text-xl">{dayTotals[meat as keyof typeof dayTotals].toFixed(1)}</span>
                                        </div>
                                    ))}
                                </div>
                                
                                <div className="bg-slate-800 text-white dark:bg-white dark:text-slate-900 px-8 py-4 rounded-2xl flex flex-col items-center justify-center shadow-lg shrink-0">
                                    <span className="text-xs uppercase font-bold text-blue-200 dark:text-blue-700 tracking-widest">{t('prep.dailyPaceTotal')}</span>
                                    <span className="font-black text-4xl">{grandTotal.toFixed(1)} <span className="text-sm opacity-60 ml-1">{t('prep.lbs').toUpperCase()}</span></span>
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
                            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 w-[96vw] h-[96vh] rounded-3xl p-6 md:p-10 shadow-2xl relative z-10 flex flex-col"
                        >
                            <button 
                                onClick={() => setShowInfoModal(false)}
                                className="absolute top-6 right-6 p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-800 dark:hover:text-white transition-colors"
                            >
                                <X size={24} />
                            </button>
                            
                            <h2 className="text-3xl md:text-5xl font-black text-slate-800 dark:text-white mb-2 tracking-tight">
                                {t('prep.meatProjection')}
                            </h2>
                            <p className="text-slate-500 mb-6 md:mb-8 border-b border-slate-200 dark:border-slate-800 pb-4 md:pb-6 text-lg md:text-2xl shrink-0">
                                {t('prep.meatProjectionDesc')}
                            </p>
                            
                            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 md:gap-8 text-slate-600 dark:text-slate-300 overflow-y-auto shrink pb-2 pr-2">
                                <div className="bg-slate-50 dark:bg-slate-800/50 p-6 md:p-8 rounded-3xl border border-slate-200 dark:border-slate-700/50 relative overflow-hidden">
                                    <div className="absolute top-0 right-0 w-32 h-32 bg-red-500/5 dark:bg-red-500/10 rounded-full blur-3xl" />
                                    <h3 className="text-2xl md:text-3xl font-black tracking-widest text-slate-800 dark:text-slate-100 uppercase mb-4 flex items-center gap-3">
                                        {t('prep.rawPoundsTitle')}
                                    </h3>
                                    <p className="mb-6 font-medium text-lg md:text-2xl" dangerouslySetInnerHTML={{ __html: t('prep.rawPoundsDesc') }} />
                                    <ul className="list-inside space-y-5 font-medium text-base md:text-xl leading-relaxed">
                                        <li className="flex items-start gap-2">
                                            <span className="text-emerald-600 dark:text-emerald-500 mt-1">1.</span> 
                                            <span>{t('prep.rawPoundsStep1')}</span>
                                        </li>
                                        <li className="flex items-start gap-2">
                                            <span className="text-emerald-600 dark:text-emerald-500 mt-1">2.</span> 
                                            <span dangerouslySetInnerHTML={{ __html: t('prep.rawPoundsStep2') }} />
                                        </li>
                                        <li className="flex items-start gap-2">
                                            <span className="text-emerald-600 dark:text-emerald-500 mt-1">3.</span> 
                                            <span dangerouslySetInnerHTML={{ __html: t('prep.rawPoundsStep3') }} />
                                        </li>
                                    </ul>
                                </div>

                                <div className="bg-slate-50 dark:bg-slate-800/50 p-6 md:p-8 rounded-3xl border border-slate-200 dark:border-slate-700/50 relative overflow-hidden">
                                    <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/5 dark:bg-blue-500/10 rounded-full blur-3xl" />
                                    <h3 className="text-2xl md:text-3xl font-black tracking-widest text-slate-800 dark:text-slate-100 uppercase mb-4 flex items-center gap-3">
                                        {t('prep.histAvgTitle')}
                                    </h3>
                                    <p className="mb-6 font-medium text-lg md:text-2xl">
                                        {t('prep.histAvgDesc')}
                                    </p>
                                    <ul className="list-inside space-y-5 font-medium text-base md:text-xl leading-relaxed">
                                        <li className="flex items-start gap-2">
                                            <span className="text-blue-600 dark:text-blue-500 mt-1">✔</span> 
                                            <span dangerouslySetInnerHTML={{ __html: t('prep.histAvgPoint1') }} />
                                        </li>
                                        <li className="flex items-start gap-2">
                                            <span className="text-blue-600 dark:text-blue-500 mt-1">✔</span> 
                                            <span dangerouslySetInnerHTML={{ __html: t('prep.histAvgPoint2') }} />
                                        </li>
                                        <li className="flex items-start gap-2">
                                            <span className="text-blue-600 dark:text-blue-500 mt-1">✔</span> 
                                            <span dangerouslySetInnerHTML={{ __html: t('prep.histAvgPoint3') }} />
                                        </li>
                                    </ul>
                                </div>
                                
                                <div className="xl:col-span-2 bg-slate-50 dark:bg-slate-800/50 p-6 md:p-8 rounded-3xl border border-slate-200 dark:border-slate-700/50 relative overflow-hidden">
                                    <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/5 dark:bg-amber-500/10 rounded-full blur-3xl" />
                                    <h3 className="text-2xl md:text-3xl font-black tracking-widest text-slate-800 dark:text-slate-100 uppercase mb-4 flex items-center gap-3">
                                        {t('prep.livePaceTitle')}
                                    </h3>
                                    <p className="mb-6 font-medium text-lg md:text-2xl">
                                        {t('prep.livePaceDesc')}
                                    </p>
                                    <ul className="list-inside space-y-5 font-medium text-base md:text-xl leading-relaxed">
                                        <li className="flex items-start gap-2">
                                            <span className="text-amber-600 dark:text-amber-500 mt-1">⚡</span> 
                                            <span dangerouslySetInnerHTML={{ __html: t('prep.livePacePoint1') }} />
                                        </li>
                                        <li className="flex items-start gap-2">
                                            <span className="text-amber-600 dark:text-amber-500 mt-1">⚡</span> 
                                            <span dangerouslySetInnerHTML={{ __html: t('prep.livePacePoint2') }} />
                                        </li>
                                        <li className="flex items-start gap-2">
                                            <span className="text-amber-600 dark:text-amber-500 mt-1">⚡</span> 
                                            <span dangerouslySetInnerHTML={{ __html: t('prep.livePacePoint3') }} />
                                        </li>
                                    </ul>
                                </div>
                            </div>
                            
                            <div className="mt-6 md:mt-8 pt-6 border-t border-slate-200 dark:border-slate-800 shrink-0">
                                <button 
                                    onClick={() => setShowInfoModal(false)}
                                    className="w-full bg-blue-600 hover:bg-blue-700 active:scale-95 text-white font-black uppercase md:text-2xl tracking-widest py-5 md:py-6 rounded-2xl transition-all shadow-xl shadow-blue-500/30"
                                >
                                    {t('prep.understoodBtn')}
                                </button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            {/* Waste Dashboard Modal */}
            <AnimatePresence>
                {showWasteModal && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md">
                        <motion.div 
                            initial={{ scale: 0.95, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.95, opacity: 0 }}
                            className="bg-white dark:bg-slate-900 rounded-3xl w-full max-w-4xl p-6 md:p-8 shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col max-h-[90vh]"
                        >
                            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6 border-b border-slate-200 dark:border-slate-800 pb-4 shrink-0">
                                <div>
                                    <h2 className="text-2xl md:text-3xl font-black text-slate-800 dark:text-white uppercase tracking-wider flex items-center gap-3">
                                        <TrendingDown className="text-red-500 w-8 h-8" />
                                        <span>{t('prep.wasteReport')}</span>
                                        <button 
                                            onClick={() => setShowWasteInfo(!showWasteInfo)} 
                                            className="text-slate-400 hover:text-blue-500 transition-colors p-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 focus:outline-none cursor-pointer"
                                            title="Información del cálculo"
                                        >
                                            <HelpCircle size={20} />
                                        </button>
                                    </h2>
                                    <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">
                                        {t('prep.wasteReportDesc')}
                                    </p>
                                </div>
                                <div className="flex items-center gap-3 w-full sm:w-auto">
                                    <input 
                                        type="date" 
                                        value={selectedWasteDate}
                                        onChange={(e) => setSelectedWasteDate(e.target.value)}
                                        className="bg-slate-100 dark:bg-slate-800 border-none font-bold text-sm text-slate-700 dark:text-slate-300 rounded-xl p-3 focus:ring-2 focus:ring-red-500 outline-none cursor-pointer w-full sm:w-auto"
                                    />
                                    <button 
                                        onClick={() => setShowWasteModal(false)}
                                        className="p-3 hover:bg-slate-105 dark:hover:bg-slate-800 rounded-xl transition-colors cursor-pointer text-slate-500 hover:text-slate-700"
                                    >
                                        <X size={20} />
                                    </button>
                                </div>
                            </div>

                            <AnimatePresence>
                                {showWasteInfo && (
                                    <motion.div 
                                        initial={{ height: 0, opacity: 0 }}
                                        animate={{ height: 'auto', opacity: 1 }}
                                        exit={{ height: 0, opacity: 0 }}
                                        className="bg-blue-50/50 dark:bg-blue-900/10 border border-blue-200/50 dark:border-blue-800/30 p-4 rounded-2xl mb-6 text-sm leading-relaxed text-slate-600 dark:text-slate-300 shrink-0 overflow-hidden"
                                    >
                                        <h4 className="font-bold text-blue-900 dark:text-blue-300 mb-2 flex items-center gap-2">
                                            <HelpCircle size={16} />
                                            {t('prep.meatProjection')}
                                        </h4>
                                        <ul className="list-disc pl-5 space-y-2 font-medium">
                                            <li><span className="font-bold text-slate-750 dark:text-slate-200">{t('prep.wasteInfoProj')}</span></li>
                                            <li><span className="font-bold text-slate-750 dark:text-slate-200">{t('prep.wasteInfoReal')}</span></li>
                                            <li><span className="font-bold text-slate-750 dark:text-slate-200">{t('prep.wasteInfoVar')}</span></li>
                                            <li><span className="font-bold text-slate-750 dark:text-slate-200">{t('prep.wasteInfoStatus')}</span></li>
                                        </ul>
                                    </motion.div>
                                )}
                            </AnimatePresence>

                            <div className="overflow-y-auto pr-2 space-y-6 flex-1 flex flex-col justify-center min-h-[250px]">
                                {loadingWasteData ? (
                                    <div className="flex flex-col items-center justify-center py-12 gap-3">
                                        <Loader2 className="animate-spin text-red-500 w-12 h-12" />
                                        <span className="text-sm font-bold text-slate-500 dark:text-slate-400 animate-pulse">{t('prep.calculatingHistory')}</span>
                                    </div>
                                ) : (
                                    (() => {
                                        const stats = wasteData.map(s => {
                                            const diff = s.totalReal - s.totalProj
                                            const diffPct = s.totalProj > 0 ? (diff / s.totalProj) * 100 : 0

                                            let statusKey = 'prep.onTrack'
                                            let statusColor = 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300'
                                            
                                            if (diffPct > 10) {
                                                statusKey = 'prep.underPrep'
                                                statusColor = 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'
                                            } else if (diffPct < -10) {
                                                statusKey = 'prep.overPrep'
                                                statusColor = 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'
                                            }

                                            return {
                                                ...s,
                                                diff,
                                                diffPct,
                                                statusKey,
                                                statusColor
                                            }
                                        })

                                        return (
                                            <div className="border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shrink-0">
                                                <table className="w-full text-left border-collapse">
                                                    <thead>
                                                        <tr className="bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 font-bold text-sm border-b border-slate-200 dark:border-slate-800 uppercase tracking-wider">
                                                            <th className="p-4">Proteína</th>
                                                            <th className="p-4 text-center">Proyectado (lbs)</th>
                                                            <th className="p-4 text-center">Consumido Real (lbs)</th>
                                                            <th className="p-4 text-center">{t('prep.variance')}</th>
                                                            <th className="p-4 text-center">{t('prep.status')}</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-base font-semibold">
                                                        {stats.map(s => (
                                                            <tr key={s.proto} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                                                                <td className="p-4 font-bold text-slate-800 dark:text-slate-200 uppercase">{s.proto}</td>
                                                                <td className="p-4 text-center text-slate-600 dark:text-slate-400">{s.totalProj.toFixed(1)}</td>
                                                                <td className="p-4 text-center text-slate-800 dark:text-slate-200">
                                                                    {s.hasRealData ? s.totalReal.toFixed(1) : <span className="text-slate-400 dark:text-slate-600 italic">No Data</span>}
                                                                </td>
                                                                <td className={`p-4 text-center font-black ${s.diff > 0 ? 'text-red-500' : 'text-emerald-500'}`}>
                                                                    {s.hasRealData ? (
                                                                        <>
                                                                            {s.diff > 0 ? '+' : ''}{s.diff.toFixed(1)} ({s.diffPct > 0 ? '+' : ''}{s.diffPct.toFixed(0)}%)
                                                                        </>
                                                                    ) : '-'}
                                                                </td>
                                                                <td className="p-4 text-center">
                                                                    {s.hasRealData ? (
                                                                        <span className={`px-3 py-1 rounded-full text-xs font-bold ${s.statusColor}`}>
                                                                            {t(s.statusKey)}
                                                                        </span>
                                                                    ) : (
                                                                        <span className="text-xs text-slate-400 dark:text-slate-600 font-normal">Pending Sync</span>
                                                                    )}
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        )
                                    })()
                                )}
                            </div>

                            <div className="mt-6 pt-4 border-t border-slate-200 dark:border-slate-800 shrink-0">
                                <button 
                                    onClick={() => setShowWasteModal(false)}
                                    className="w-full bg-slate-800 hover:bg-black dark:bg-slate-700 dark:hover:bg-slate-650 text-white font-bold py-4 rounded-xl transition-all uppercase tracking-wider text-sm cursor-pointer"
                                >
                                    {t('prep.understood')}
                                </button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </div>
    )
}
