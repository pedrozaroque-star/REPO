'use client'

import { useState, useEffect } from 'react'
import { useLanguage } from '@/lib/i18n'
import { useAuth } from '@/components/ProtectedRoute'
import { createClient } from '@/lib/supabase-client'
import { Store, ArrowLeft } from 'lucide-react'
import Link from 'next/link'

const DOW_MAP: Record<number, string> = {
    1: 'Lunes',
    2: 'Martes',
    3: 'Miércoles',
    4: 'Jueves',
    5: 'Viernes',
    6: 'Sábado',
    7: 'Domingo'
}

const PROTEINS = ['ASADA', 'PASTOR', 'POLLO', 'CABEZA', 'LENGUA']

function getOperationalTimeOrder() {
    const times: string[] = []
    for (let h = 8; h <= 23; h++) {
        const hh = h.toString().padStart(2, '0')
        times.push(`${hh}:00`)
        times.push(`${hh}:30`)
    }
    times.push('00:00')
    times.push('00:30')
    times.push('01:00')
    times.push('01:30')
    return times
}

const OPERATIONAL_TIMES = getOperationalTimeOrder()

export default function TablaMaximosPage() {
    const { t } = useLanguage()
    const { user } = useAuth()
    const supabase = createClient()

    const [stores, setStores] = useState<any[]>([])
    const [storeId, setStoreId] = useState('')
    const [selectedDow, setSelectedDow] = useState<number>(1)
    const [tableData, setTableData] = useState<any[]>([])
    const [loading, setLoading] = useState(false)

    useEffect(() => {
        const fetchStores = async () => {
            const { data } = await supabase.from('stores').select('id, name').order('name')
            if (data && data.length > 0) {
                setStores(data)
                const slauson = data.find(s => s.name.toLowerCase().includes('slauson'))
                setStoreId(slauson ? slauson.id : data[0].id)
            }
        }
        fetchStores()
    }, [supabase])

    useEffect(() => {
        if (!storeId) return
        const fetchHistory = async () => {
            setLoading(true)
            try {
                const res = await fetch(`/api/inventory/preparador-history?storeId=${storeId}&dow=${selectedDow}&_t=${Date.now()}`, { cache: 'no-store' })
                const json = await res.json()
                if (Array.isArray(json)) {
                    const intervalsMap: Record<string, any> = {}
                    json.forEach((d: any) => {
                        if (!intervalsMap[d.interval_start]) {
                            intervalsMap[d.interval_start] = {}
                        }
                        intervalsMap[d.interval_start][d.meat_type] = d.avg_lbs
                    })

                    const rows: any[] = []
                    OPERATIONAL_TIMES.forEach(tStr => {
                        const intervalKey = `${tStr}:00`
                        const row: any = { time: tStr }
                        PROTEINS.forEach(proto => {
                            const avg = (intervalsMap[intervalKey] && intervalsMap[intervalKey][proto]) ? intervalsMap[intervalKey][proto] : 0
                            const maxTray = Math.max(1, Math.ceil(avg))
                            row[proto] = { avg: Number(avg.toFixed(1)), maxTray }
                        })
                        rows.push(row)
                    })
                    setTableData(rows)
                }
            } catch (err) {
                console.error(err)
            } finally {
                setLoading(false)
            }
        }
        fetchHistory()
    }, [storeId, selectedDow])

    return (
        <div className="min-h-screen bg-slate-100 dark:bg-slate-950 text-slate-900 dark:text-slate-100 p-4 md:p-6 space-y-6">
            <header className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 rounded-3xl shadow-sm flex flex-col md:flex-row justify-between items-center gap-4">
                <div className="flex items-center gap-3">
                    <Link href="/inventory/preparador" className="p-2 bg-slate-100 dark:bg-slate-800 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors">
                        <ArrowLeft size={20} />
                    </Link>
                    <div>
                        <h1 className="font-black text-lg md:text-xl text-red-600 dark:text-red-500">TACOS EL GAVILAN</h1>
                        <p className="text-xs text-slate-500 font-bold">Tabla de Máximos en Charola • 8:00 AM – Cierre</p>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-800 p-2 rounded-xl border border-slate-200 dark:border-slate-700">
                        <Store size={18} className="text-red-500 shrink-0" />
                        <select 
                            value={storeId} 
                            onChange={e => setStoreId(e.target.value)}
                            className="bg-transparent font-bold text-sm text-slate-800 dark:text-white outline-none cursor-pointer"
                        >
                            {stores.map(s => <option key={s.id} value={s.id} className="text-slate-900">{s.name}</option>)}
                        </select>
                    </div>
                </div>
            </header>

            {/* DOW Tabs */}
            <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-none">
                {[1, 2, 3, 4, 5, 6, 7].map(dow => (
                    <button 
                        key={dow}
                        onClick={() => setSelectedDow(dow)}
                        className={`px-4 py-2.5 rounded-2xl font-black text-sm whitespace-nowrap transition-all duration-200 cursor-pointer ${selectedDow === dow ? 'bg-red-600 text-white shadow-md scale-105' : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-800 hover:bg-slate-50'}`}
                    >
                        {DOW_MAP[dow]}
                    </button>
                ))}
            </div>

            {/* Table Card */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl overflow-hidden shadow-sm">
                <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-900/50">
                    <h3 className="font-black text-base text-slate-900 dark:text-white flex items-center gap-2">
                        📅 {DOW_MAP[selectedDow]} — 36 Bloques Operativos
                    </h3>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                        <thead className="bg-slate-100 dark:bg-slate-950 text-slate-700 dark:text-slate-300 font-extrabold uppercase border-b border-slate-200 dark:border-slate-800">
                            <tr>
                                <th className="p-3 sticky left-0 bg-slate-100 dark:bg-slate-950 z-20 border-r border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white">Hora</th>
                                <th className="p-3 text-slate-800 dark:text-slate-200">🥩 Asada</th>
                                <th className="p-3 text-slate-800 dark:text-slate-200">🌮 Pastor</th>
                                <th className="p-3 text-slate-800 dark:text-slate-200">🍗 Pollo</th>
                                <th className="p-3 text-slate-800 dark:text-slate-200">🐮 Cabeza</th>
                                <th className="p-3 text-slate-800 dark:text-slate-200">👅 Lengua</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 dark:divide-slate-800 font-semibold">
                            {tableData.map((r, idx) => {
                                const isPeak = r.ASADA.avg >= 12.0 || r.POLLO.avg >= 3.0
                                return (
                                    <tr key={r.time} className={`hover:bg-slate-100 dark:hover:bg-slate-800/50 transition-colors ${idx % 2 === 0 ? 'bg-white dark:bg-slate-900' : 'bg-slate-50/70 dark:bg-slate-900/60'} ${isPeak ? 'bg-amber-50/30 dark:bg-amber-950/10' : ''}`}>
                                        <td className="p-3 font-black text-slate-900 dark:text-white sticky left-0 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 shadow-xs">{r.time}</td>
                                        {['ASADA', 'PASTOR', 'POLLO', 'CABEZA', 'LENGUA'].map(proto => (
                                            <td key={proto} className="p-3">
                                                <div className="font-extrabold text-slate-900 dark:text-white text-sm">{r[proto].avg} <span className="text-[10px] text-slate-500 font-normal">lbs</span></div>
                                                <div className="text-[10px] font-bold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-2 py-0.5 rounded-md inline-block mt-0.5">🔥 Máx: {r[proto].maxTray} lbs</div>
                                            </td>
                                        ))}
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    )
}
