'use client'

import { useState, useEffect, useRef } from 'react'
import { BellRing, ChefHat, Clock, AlertTriangle, Send, UtensilsCrossed, PackageOpen, X, Loader2, Play, Maximize, Minimize } from 'lucide-react'
import { useAuth } from '@/components/ProtectedRoute'
import { createClient } from '@/lib/supabase-client'
        

interface MeatData {
    interval_start: string
    meat_type: string
    avg_lbs: number
    samples: number
}

const ALIMENTOS = [
    'Queso cotija', 'Queso Jack', 'Queso nachos', 'Crema', 'Guacamole', 'Mayonesa', 
    'Mulitas', 'Quesadillas', 'Milanesa', 'Salchicha', 'Jamon', 'Huevos', 'Salsa verde', 
    'Salsa roja', 'Frijol molido', 'Frijol de la Olla', 'Arroz', 'Cebolla y cilantro', 
    'Cabeza', 'Lengua', 'Asada', 'Pastor', 'Pollo', 'Carnitas', 'Buche', 'Chorizo', 
    'Chips', 'Tortillas Harina', 'Tortillas Maiz', 'Teleras', 'Papelitos', 'Manteca'
]

const DESECHABLES = [
    'Cover tacos', 'Papel tortas', 'Platos blancos', 'Platos nachos', 'Platos (3)', 
    'Platos sopes', 'Charolas rojas', 'Vasos 4oz', 'Vasos 8oz'
]

export default function PreparadorLineaPage() {
    const { user, loading: authLoading } = useAuth()
    const supabase = createClient()

    const [mounted, setMounted] = useState(false)
    const [stores, setStores] = useState<any[]>([])
    const [storeId, setStoreId] = useState('')
    
    // Meat Historial Data
    const [meatData, setMeatData] = useState<MeatData[]>([])
    const [fetchingMeat, setFetchingMeat] = useState(false)
    const [currentTimeData, setCurrentTimeData] = useState<MeatData[]>([])
    const [nextTimeData, setNextTimeData] = useState<MeatData[]>([])
    const [currentBucketLabel, setCurrentBucketLabel] = useState('')
    const [nextBucketLabel, setNextBucketLabel] = useState('')

    // Request Cart
    const [activeTab, setActiveTab] = useState<'alimentos'|'desechables'>('alimentos')
    const [cart, setCart] = useState<{name: string, qty: number}[]>([])
    const [sending, setSending] = useState(false)
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
                // Default Norwalk o el de user
                setStoreId(data[0].id)
            }
        }
        fetchStores()
    }, [supabase])

    // Load Meat Historial
    useEffect(() => {
        if (!storeId) return
        const fetchHistory = async () => {
            setFetchingMeat(true)
            try {
                // Get LA ISODOW
                const d = new Date()
                const options: Intl.DateTimeFormatOptions = { timeZone: 'America/Los_Angeles', weekday: 'short' } // Mon, Tue...
                // Quick hack for dow 1-7 (Mon=1, Sun=7)
                let dayNum = d.getDay() // 0=Sun, 1=Mon
                let dow = dayNum === 0 ? 7 : dayNum
                
                const res = await fetch(`/api/inventory/preparador-history?storeId=${storeId}&dow=${dow}`)
                const json = await res.json()
                if (Array.isArray(json)) {
                    setMeatData(json)
                }
            } catch (err) {
                console.error(err)
            } finally {
                setFetchingMeat(false)
            }
        }
        fetchHistory()
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
            let curHStr = h.toString().padStart(2, '0')
            let curMStr = curM.toString().padStart(2, '0')
            const currentBucket = `${curHStr}:${curMStr}:00`
            
            // Next Bucket
            let nxtM = curM === 0 ? 30 : 0
            let nxtH = curM === 30 ? (h + 1) % 24 : h
            let nxtHStr = nxtH.toString().padStart(2, '0')
            let nxtMStr = nxtM.toString().padStart(2, '0')
            const nextBucket = `${nxtHStr}:${nxtMStr}:00`
            
            setCurrentBucketLabel(`${curHStr}:${curMStr}`)
            setNextBucketLabel(`${nxtHStr}:${nxtMStr}`)

            if (meatData.length > 0) {
                setCurrentTimeData(meatData.filter(m => m.interval_start === currentBucket))
                setNextTimeData(meatData.filter(m => m.interval_start === nextBucket))
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

    const removeItem = (item: string) => {
        setCart(prev => prev.filter(p => p.name !== item))
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

    if (!user || !['admin', 'manager'].includes(user.role?.toLowerCase() || '')) {
        return <div className="p-8 text-center text-red-500 text-2xl font-bold">🚫 ACCESO DENEGADO</div>
    }

    return (
        <div ref={containerRef} className={`flex flex-col overflow-hidden bg-slate-100 dark:bg-slate-950 transition-all ${isFullscreen ? 'fixed inset-0 z-[9999] h-screen w-screen' : 'h-[calc(100vh-64px)]'}`}>
            {/* Header / Config Bar */}
            <div className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 p-4 flex justify-between items-center shadow-sm shrink-0">
                <div className="flex items-center gap-3">
                    <div className="bg-gradient-to-r from-red-600 to-orange-500 p-2 rounded-lg text-white shadow-md">
                        <ChefHat size={24} />
                    </div>
                    <div>
                        <h1 className="text-xl font-black text-slate-800 dark:text-white leading-tight">PREPARADOR (LÍNEA)</h1>
                        <p className="text-xs text-slate-500 font-medium">Control de Ritmo y Abastecimiento</p>
                    </div>
                </div>
                
                <div className="flex items-center gap-2 md:gap-4 overflow-x-auto">
                    <button 
                        onClick={toggleFullscreen}
                        className="flex items-center gap-2 bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 px-3 py-2 rounded-lg font-bold text-sm transition-colors"
                        title="Modo Tableta (Pantalla Completa)"
                    >
                        {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
                        <span className="hidden md:inline">{isFullscreen ? 'SALIR' : 'TABLETA'}</span>
                    </button>
                    
                    <select 
                        value={storeId} 
                        onChange={e => setStoreId(e.target.value)}
                        className="bg-slate-100 dark:bg-slate-800 border-none rounded-lg p-2 font-bold text-slate-700 dark:text-slate-300 focus:ring-2 focus:ring-red-500 outline-none"
                    >
                        {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                    
                    <a href="/inventory/preparador/bodega" target="_blank" className="flex items-center gap-2 bg-slate-800 hover:bg-black text-white px-4 py-2 rounded-lg font-bold text-sm transition-colors shadow-lg shadow-slate-900/20">
                        <BellRing size={16} className="animate-pulse" />
                        ABRIR MODO BODEGA
                    </a>
                </div>
            </div>

            {/* Split Screen Container */}
            <div className="flex flex-1 overflow-hidden">
                
                {/* LADO IZQUIERDO: PROYECCIÓN (48% de la pantalla) */}
                <div className="w-[48%] border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 xl:p-8 flex flex-col overflow-y-auto hidden md:flex">
                    <div className="flex items-center gap-3 mb-6 bg-slate-50 dark:bg-slate-800/50 p-3 rounded-xl border border-slate-200 dark:border-slate-700">
                        <Clock className="w-8 h-8 text-blue-500 shrink-0" />
                        <div>
                            <h2 className="font-bold text-slate-800 dark:text-white uppercase tracking-wider text-sm">Ritmo de Cocción</h2>
                            <p className="text-xs text-slate-500 font-medium">Promedio histórico del día actual (últimos 3 años)</p>
                        </div>
                    </div>

                    {fetchingMeat ? (
                        <div className="flex flex-col items-center justify-center flex-1 text-slate-400 gap-3">
                            <Loader2 className="w-10 h-10 animate-spin text-blue-500" />
                            <p className="font-bold">Calculando Histórico...</p>
                        </div>
                    ) : (
                        <div className="space-y-6 flex-1">
                            {/* BLOQUE ACTUAL */}
                            <div className="bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/10 rounded-2xl border border-blue-200 dark:border-blue-800/50 p-5 shadow-inner">
                                <div className="flex justify-between items-center mb-4 border-b border-blue-200 dark:border-blue-800/50 pb-2">
                                    <h3 className="font-black text-blue-900 dark:text-blue-300 flex items-center gap-2">
                                        <div className="w-3 h-3 rounded-full bg-red-500 animate-pulse" /> 
                                        AHORA ({currentBucketLabel})
                                    </h3>
                                    <span className="text-xs font-bold text-blue-600 bg-blue-100 dark:bg-blue-900/50 px-2 py-1 rounded-md">Libras Crudas</span>
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    {currentTimeData.length > 0 ? currentTimeData
                                        .filter(m => m.meat_type !== 'CARNITAS')
                                        .sort((a,b) => a.meat_type === 'ASADA' ? -1 : b.meat_type === 'ASADA' ? 1 : a.meat_type.localeCompare(b.meat_type))
                                        .map(m => (
                                        <div key={m.meat_type} className={`bg-white/80 dark:bg-slate-800/80 p-3 rounded-xl flex flex-col items-center justify-center shadow-sm ${m.meat_type === 'ASADA' ? 'col-span-2 shadow-md border border-blue-100 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-900/30 py-5' : ''}`}>
                                            <span className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">{m.meat_type}</span>
                                            <span className={`${m.meat_type === 'ASADA' ? 'text-4xl text-blue-700 dark:text-blue-400' : 'text-2xl text-slate-800 dark:text-white'} font-black`}>{m.avg_lbs} <span className="text-sm font-medium opacity-50 text-slate-500">lbs</span></span>
                                        </div>
                                    )) : <p className="col-span-2 text-center text-sm font-medium text-slate-500 opacity-70">No data para este intervalo</p>}
                                </div>
                            </div>

                            {/* BLOQUE PRÓXIMO */}
                            <div className="bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 p-5">
                                <h3 className="font-bold text-slate-600 dark:text-slate-400 mb-4 border-b border-slate-200 dark:border-slate-700 pb-2 flex items-center gap-2">
                                    SIGUIENTE ({nextBucketLabel})
                                </h3>
                                <div className="grid grid-cols-2 gap-3 opacity-80">
                                    {nextTimeData.length > 0 ? nextTimeData
                                        .filter(m => m.meat_type !== 'CARNITAS')
                                        .sort((a,b) => a.meat_type === 'ASADA' ? -1 : b.meat_type === 'ASADA' ? 1 : a.meat_type.localeCompare(b.meat_type))
                                        .map(m => (
                                        <div key={m.meat_type} className={`bg-white dark:bg-slate-900 p-3 rounded-xl flex flex-col items-center justify-center border border-slate-100 dark:border-slate-800 ${m.meat_type === 'ASADA' ? 'col-span-2 bg-slate-100 dark:bg-slate-800/50 py-4' : ''}`}>
                                            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{m.meat_type}</span>
                                            <span className={`${m.meat_type === 'ASADA' ? 'text-3xl text-slate-600 dark:text-slate-400' : 'text-xl text-slate-700 dark:text-slate-300'} font-black`}>{m.avg_lbs} <span className="text-xs font-medium opacity-50 text-slate-500">lbs</span></span>
                                        </div>
                                    )) : <p className="col-span-2 text-center text-sm font-medium text-slate-400">No data</p>}
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* LADO DERECHO: TABLETA REQUESTS (60% de la pantalla) */}
                <div className="flex-1 flex flex-col bg-slate-100 dark:bg-slate-950">
                    
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
                            {(activeTab === 'alimentos' ? ALIMENTOS : DESECHABLES).map(item => {
                                const cartItem = cart.find(c => c.name === item)
                                const isSelected = !!cartItem
                                return (
                                <button
                                    key={item}
                                    onClick={() => addToCart(item)}
                                    className={`relative h-20 md:h-24 rounded-2xl flex flex-col items-center justify-center p-2 active:scale-95 transition-all outline-none ${isSelected ? 'bg-blue-50 border-2 border-blue-500 shadow-md dark:bg-blue-900/30 dark:border-blue-400' : 'bg-white border border-slate-200 shadow-sm hover:bg-blue-50 hover:border-blue-400 dark:bg-slate-800 dark:border-slate-700 dark:hover:bg-slate-700'}`}
                                >
                                    <span className={`font-bold text-center text-sm md:text-base leading-tight font-sans tracking-tight ${isSelected ? 'text-blue-700 dark:text-blue-300' : 'text-slate-800 dark:text-slate-200'}`}>
                                        {item}
                                    </span>
                                    {cartItem && cartItem.qty > 1 && (
                                        <div className="absolute top-2 right-2 bg-blue-500 text-white text-[11px] w-5 h-5 flex items-center justify-center rounded-full font-black shadow-sm animate-in zoom-in duration-200">
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
                                        <div key={c.name} className="relative bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 px-4 py-3 rounded-xl flex items-center gap-3 shrink-0 group shadow-sm">
                                            <span className="bg-white dark:bg-slate-700 text-slate-800 dark:text-white font-black w-8 h-8 rounded-full flex items-center justify-center text-sm shadow-sm">
                                                {c.qty}
                                            </span>
                                            <span className="font-bold text-slate-700 dark:text-slate-200 text-sm whitespace-nowrap pr-2">{c.name}</span>
                                            <button 
                                                onClick={() => removeItem(c.name)}
                                                className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity shadow-md"
                                            >
                                                <X size={14} strokeWidth={3} />
                                            </button>
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
        </div>
    )
}
