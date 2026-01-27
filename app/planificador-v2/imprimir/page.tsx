'use client'

import { useEffect, useState, useMemo, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { getSupabaseClient } from '@/lib/supabase'
import { addDays, formatDateISO, getMonday, getRoleWeight, stringToColor } from '../lib/utils'
import { Loader2, Printer } from 'lucide-react'

// Force dynamic rendering
export const dynamic = 'force-dynamic'

function PrintViewContent() {
    const searchParams = useSearchParams()
    const storeId = searchParams.get('storeId')
    const startParam = searchParams.get('startDate') // YYYY-MM-DD

    const [loading, setLoading] = useState(true)
    const [store, setStore] = useState<any>(null)
    const [shifts, setShifts] = useState<any[]>([])
    const [employees, setEmployees] = useState<any[]>([])
    const [jobs, setJobs] = useState<any[]>([])

    const weekStart = useMemo(() => startParam ? new Date(startParam + 'T12:00:00') : getMonday(new Date()), [startParam])
    const weekDays = useMemo(() => Array.from({ length: 7 }).map((_, i) => addDays(weekStart, i)), [weekStart])

    useEffect(() => {
        async function load() {
            if (!storeId) return
            setLoading(true)
            const supabase = await getSupabaseClient()

            // 1. Store Info
            const { data: storeData } = await supabase.from('stores').select('*').eq('external_id', storeId).single()
            setStore(storeData)

            // 2. Fetch Data
            const startStr = formatDateISO(weekStart)
            const endStr = formatDateISO(addDays(weekStart, 6))

            const [shiftsRes, empsRes, jobsRes] = await Promise.all([
                supabase.from('shifts').select('*').eq('store_id', storeId).gte('shift_date', startStr).lte('shift_date', endStr),
                supabase.from('toast_employees').select('*').eq('deleted', false),
                supabase.from('toast_jobs').select('*')
            ])

            if (shiftsRes.data) setShifts(shiftsRes.data)
            if (empsRes.data) {
                const relevant = empsRes.data.filter((e: any) => {
                    const ids = e.store_ids
                    if (Array.isArray(ids)) return ids.includes(storeId)
                    if (typeof ids === 'string') return ids.includes(storeId)
                    return false
                })
                setEmployees(relevant)
            }
            if (jobsRes.data) setJobs(jobsRes.data)

            setLoading(false)
        }
        load()
    }, [storeId, weekStart])

    // --- AM/PM & ROLE LOGIC ---
    const { amEmployees, pmEmployees } = useMemo(() => {
        const draftShifts = shifts.filter(s => s.status === 'draft')
        const am: any[] = []
        const pm: any[] = []

        if (employees.length === 0) return { amEmployees: [], pmEmployees: [] }

        // First distribute based on average time
        employees.forEach(emp => {
            const empShifts = draftShifts.filter(s => s.employee_id === emp.id)
            if (empShifts.length === 0) return

            let totalHour = 0
            empShifts.forEach(s => {
                const hour = new Date(s.start_time).getHours()
                totalHour += hour
            })
            const avg = totalHour / empShifts.length

            if (avg < 14) am.push(emp)
            else pm.push(emp)
        })

        // Strict Sorter for Hierarchy based on ACTUAL SCHEDULED SHIFTS
        const getRank = (title: string) => {
            const t = (title || '').toLowerCase()
            if (t.includes('manager') && !t.includes('asst') && !t.includes('shift') && !t.includes('assist')) return 1
            if (t.includes('asst') || t.includes('assist') || t.includes('asistente')) return 2
            if (t.includes('shift') || t.includes('leader') || t.includes('encargado')) return 3
            if (t.includes('cashier') || t.includes('cajero') || t.includes('cajera') || t.includes('frente')) return 4
            if (t.includes('cook') || t.includes('cocina') || t.includes('cocinero') || t.includes('prep') || t.includes('taquero') || t.includes('tortilla')) return 5
            return 99
        }

        const getEmployeeBestRank = (emp: any) => {
            // 1. Check Scheduled Shifts (Primary Source of Truth for this week)
            const myShifts = draftShifts.filter(s => s.employee_id === emp.id)
            let bestRank = 99

            if (myShifts.length > 0) {
                myShifts.forEach(s => {
                    const job = jobs.find(j => j.id === s.job_id)
                    if (job) {
                        const r = getRank(job.title)
                        if (r < bestRank) bestRank = r
                    }
                })
            }

            // 2. If no shifts or rank still 99, check Job References (Profile)
            if (bestRank === 99 && emp.job_references && emp.job_references.length > 0) {
                emp.job_references.forEach((ref: any) => {
                    const r = getRank(ref.title)
                    if (r < bestRank) bestRank = r
                })
            }

            return bestRank
        }

        const sorter = (a: any, b: any) => {
            const rankA = getEmployeeBestRank(a)
            const rankB = getEmployeeBestRank(b)

            // Primary Sort: Rank
            if (rankA !== rankB) return rankA - rankB

            // Secondary Sort: Name
            return a.first_name.localeCompare(b.first_name)
        }

        return { amEmployees: am.sort(sorter), pmEmployees: pm.sort(sorter) }
    }, [employees, shifts, jobs])

    const totalEmployees = amEmployees.length + pmEmployees.length
    // Lower threshold to be safer (approx 12-14 rows max fit comfortably on one page with headers)
    const shouldBreak = totalEmployees > 17

    const renderTable = (team: any[], title: string, forceBreak: boolean) => {
        if (team.length === 0) return null

        // Filter ONLY Drafts for display
        const visibleShifts = shifts.filter(s => s.status === 'draft')

        return (
            <div className={`mb-8 ${forceBreak ? 'break-after-page' : 'break-inside-avoid'}`}>
                <h2 className="text-xl font-bold mb-2 uppercase border-b-2 border-black pb-1 flex justify-between">
                    {title}
                    <span className="text-sm font-normal normal-case text-gray-500">{team.length} empleados</span>
                </h2>
                <table className="w-full text-sm border-collapse border border-gray-400">
                    <thead>
                        <tr className="bg-[#333333] text-white print:bg-[#333333] print:text-white">
                            <th className="py-2 px-1 text-left border border-gray-500 w-[150px] pl-2">Name</th>
                            {weekDays.map((d, i) => (
                                <th key={i} className="py-2 px-1 text-center border border-gray-500 w-[11%]">
                                    <div>{d.toLocaleString('es-US', { weekday: 'short' })} {d.getDate()}</div>
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {team.map((emp, idx) => (
                            <tr key={emp.id} className={`${idx % 2 === 0 ? 'bg-white' : 'bg-gray-100'} print:bg-white`}>
                                <td className="py-1 px-2 border border-gray-300 font-bold text-xs">
                                    {emp.first_name} {emp.last_name}
                                </td>
                                {weekDays.map((date, i) => {
                                    const dateStr = formatDateISO(date)
                                    const dayShifts = visibleShifts.filter(s => s.employee_id === emp.id && s.shift_date === dateStr)
                                    return (
                                        <td key={i} className="py-1 px-1 text-center border border-gray-300 align-top h-[50px]">
                                            {dayShifts.map(s => {
                                                const job = jobs.find(j => j.id === s.job_id)
                                                const jobTitle = job?.title || emp.job_references?.[0]?.title || '?'

                                                // Use stringToColor from utils for hex
                                                const badgeColor = stringToColor(jobTitle)
                                                // Determine text color (simple check, assume light text on dark bg mostly except yellow)
                                                const textColor = '#FFFFFF'

                                                return (
                                                    <div key={s.id} className="flex flex-col items-center mb-1">
                                                        <span className="font-bold text-[11px] leading-tight mb-0.5">
                                                            {(() => {
                                                                const format = (iso: string) => {
                                                                    const d = new Date(iso)
                                                                    const h = d.getHours()
                                                                    const m = d.getMinutes()
                                                                    const ampm = h >= 12 ? 'pm' : 'am'
                                                                    const h12 = h % 12 || 12
                                                                    return m === 0 ? `${h12}${ampm}` : `${h12}:${m.toString().padStart(2, '0')}${ampm}`
                                                                }
                                                                return `${format(s.start_time)} - ${format(s.end_time)}`
                                                            })()}
                                                        </span>
                                                        <span
                                                            className="text-[9px] px-2 py-0.5 rounded-full font-bold uppercase tracking-tight print-color-exact truncate max-w-[90%]"
                                                            style={{ backgroundColor: badgeColor, color: textColor }}
                                                        >
                                                            {jobTitle
                                                                .replace('Front of House', 'FOH')
                                                                .replace('Back of House', 'BOH')
                                                                .replace('Assistant', 'Asst')
                                                                .replace('Manager', 'Mgr')
                                                            }
                                                        </span>
                                                    </div>
                                                )
                                            })}
                                        </td>
                                    )
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        )
    }

    if (loading) return <div className="p-10 flex text-gray-500"><Loader2 className="animate-spin mr-2" /> Generando vista de impresión...</div>

    return (
        <div className="min-h-screen bg-white text-black p-4 print:p-0 font-sans">
            {/* HEADER */}
            <div className="flex justify-between items-center mb-4 border-b pb-2">
                <h1 className="text-xl font-bold">
                    {weekStart.toLocaleString('es-US', { month: 'long', day: 'numeric' })} - {addDays(weekStart, 6).toLocaleString('es-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                    <span className="mx-2">|</span>
                    Employees @ {store?.name || 'Lynwood'}
                </h1>
                <button
                    onClick={() => window.print()}
                    className="print:hidden flex items-center gap-2 bg-black text-white px-3 py-1 rounded hover:bg-gray-800"
                >
                    <Printer size={14} /> Imprimir
                </button>
            </div>

            {/* AM PAGE */}
            {renderTable(amEmployees, 'Turno AM (Morning Shift)', shouldBreak)}

            {/* PM PAGE */}
            {renderTable(pmEmployees, 'Turno PM (Night Shift)', false)}

            <style jsx global>{`
                @media print {
                    @page { size: portrait; margin: 0.25in; }
                    body { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
                    .print-color-exact { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
                    .break-after-page { page-break-after: always; }
                    .break-inside-avoid { break-inside: avoid; page-break-inside: avoid; }
                    nav, header, .no-print { display: none !important; }
                }
            `}</style>
        </div>
    )
}

export default function PrintPage() {
    return (
        <Suspense fallback={<div>Cargando...</div>}>
            <PrintViewContent />
        </Suspense>
    )
}
