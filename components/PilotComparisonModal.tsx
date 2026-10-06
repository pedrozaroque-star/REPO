/**
 * @module PilotComparisonModal
 * @description Modal de auditoría y comparación detallada entre el conteo físico real capturado
 * por el manager y la proyección teórica automática (generada con tickets Toast, PMIX y recetas).
 * Permite visualizar insumo por insumo la varianza, el margen de tolerancia y el impacto que
 * tendría en el pedido de Bodega.
 * 
 * @businessRules
 * 1. El conteo físico capturado por el manager es la ÚNICA base oficial del pedido a Bodega.
 * 2. El cálculo teórico se revela únicamente después del cierre del conteo ciego (blind count).
 * 3. Tolerancia: 1 unidad para productos unitarios/discretos, o MAX(1, 15% del sobrante físico).
 * 4. Pedido Oficial = MAX(0, PAR - Sobrante Físico).
 * 5. Pedido Teórico = MAX(0, PAR - Sobrante Teórico).
 * 
 * @dataFlow
 * Recibe las líneas comparativas desde `inventory_automation_pilot_lines` (Supabase) o
 * directamente desde la sesión activa de la orden diaria en `page.tsx`.
 * 
 * @notes
 * Creado para que Carlos y supervisores puedan auditar de un vistazo la precisión de las
 * recetas y el comportamiento del motor de consumo teórico sin salir de la pantalla de pedidos.
 */

'use client'

import React, { useState, useMemo, useEffect } from 'react'
import { X, Search, CheckCircle2, AlertTriangle, Copy, Check, Filter } from 'lucide-react'
import { useLanguage } from '@/lib/i18n'

export interface PilotComparisonItem {
    inventory_item_id: string
    item_name: string
    physical_leftover: number | null
    automatic_leftover: number | null
    variance: number | null
    tolerance_value: number | null
    within_tolerance: boolean | null
    par_value: number
    automatic_order_qty: number | null
    official_order_qty: number | null
    unit_description?: string
}

interface PilotComparisonModalProps {
    isOpen: boolean
    onClose: () => void
    storeName: string
    businessDate: string
    completedBy?: string | null
    completedAt?: string | null
    lines: PilotComparisonItem[]
}

export default function PilotComparisonModal({
    isOpen,
    onClose,
    storeName,
    businessDate,
    completedBy,
    completedAt,
    lines,
}: PilotComparisonModalProps) {
    const { t } = useLanguage()
    const [searchTerm, setSearchTerm] = useState('')
    const [filterType, setFilterType] = useState<'all' | 'within' | 'outside'>('all')
    const [copied, setCopied] = useState(false)

    // Cerrar con Escape
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose()
        }
        if (isOpen) {
            window.addEventListener('keydown', handleKeyDown)
            return () => window.removeEventListener('keydown', handleKeyDown)
        }
    }, [isOpen, onClose])

    // Estadísticas agregadas
    const stats = useMemo(() => {
        const total = lines.length
        let withinCount = 0
        let outsideCount = 0
        let totalOfficialOrder = 0
        let totalTheoreticalOrder = 0

        lines.forEach(line => {
            if (line.within_tolerance === true) withinCount++
            else outsideCount++

            totalOfficialOrder += line.official_order_qty || 0
            totalTheoreticalOrder += line.automatic_order_qty || 0
        })

        const accuracyRate = total > 0 ? Math.round((withinCount / total) * 100) : 0

        return {
            total,
            withinCount,
            outsideCount,
            accuracyRate,
            totalOfficialOrder,
            totalTheoreticalOrder,
            orderDiff: totalTheoreticalOrder - totalOfficialOrder,
        }
    }, [lines])

    // Filtrado de líneas
    const filteredLines = useMemo(() => {
        return lines.filter(line => {
            const matchesSearch = line.item_name.toLowerCase().includes(searchTerm.toLowerCase().trim())
            if (!matchesSearch) return false

            if (filterType === 'within') return line.within_tolerance === true
            if (filterType === 'outside') return line.within_tolerance === false
            return true
        })
    }, [lines, searchTerm, filterType])

    // Copiar tabla como texto / CSV
    const handleCopyData = () => {
        const header = 'Insumo\tFísico\tTeórico\tVarianza\tTolerancia\tEstado\tPAR\tPedido Oficial\tPedido Teórico\tDif. Pedido\n'
        const rows = lines.map(l => {
            const status = l.within_tolerance ? 'Dentro' : 'Fuera'
            const orderDiff = (l.automatic_order_qty ?? 0) - (l.official_order_qty ?? 0)
            return `${l.item_name}\t${l.physical_leftover ?? '-'}\t${l.automatic_leftover ?? '-'}\t${l.variance ?? '-'}\t${l.tolerance_value ?? '-'}\t${status}\t${l.par_value}\t${l.official_order_qty ?? '-'}\t${l.automatic_order_qty ?? '-'}\t${orderDiff}`
        }).join('\n')

        navigator.clipboard.writeText(header + rows)
        setCopied(true)
        setTimeout(() => setCopied(false), 2500)
    }

    if (!isOpen) return null

    // Formatear hora si está disponible
    let formattedTime = ''
    if (completedAt) {
        try {
            formattedTime = new Date(completedAt).toLocaleTimeString('en-US', {
                hour: 'numeric',
                minute: '2-digit',
                hour12: true,
                timeZone: 'America/Los_Angeles'
            })
        } catch {
            formattedTime = completedAt
        }
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 md:p-6 bg-slate-950/70 backdrop-blur-sm overflow-y-auto animate-in fade-in duration-200">
            <div className="relative bg-white rounded-2xl max-w-5xl w-full max-h-[92vh] overflow-hidden shadow-2xl border border-slate-200 flex flex-col">
                
                {/* Header */}
                <div className="sticky top-0 bg-gradient-to-r from-emerald-600 via-teal-700 to-slate-800 text-white px-6 py-4 flex items-center justify-between z-10 shadow-sm">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-white/10 backdrop-blur-md flex items-center justify-center text-xl font-black border border-white/20 shadow-inner">
                            📊
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h3 className="text-base font-black tracking-wide text-white">
                                    {t('bodegaOrders.pilotComparisonTitle')}
                                </h3>
                                <span className="bg-emerald-400/20 text-emerald-100 text-[11px] font-bold px-2 py-0.5 rounded-full border border-emerald-300/30">
                                    {storeName} · {businessDate}
                                </span>
                            </div>
                            <p className="text-xs text-emerald-100/90 mt-0.5">
                                {t('bodegaOrders.pilotComparisonSubtitle')}
                                {completedBy ? ` · ${completedBy}${formattedTime ? ` (${formattedTime})` : ''}` : ''}
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={handleCopyData}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-semibold transition-all border border-white/15"
                            title={t('bodegaOrders.pilotCopyTable')}
                        >
                            {copied ? <Check size={14} className="text-emerald-300" /> : <Copy size={14} />}
                            <span>{copied ? t('bodegaOrders.pilotCopied') : t('bodegaOrders.pilotCopyTable')}</span>
                        </button>
                        <button
                            type="button"
                            onClick={onClose}
                            className="p-1.5 text-white/80 hover:text-white hover:bg-white/10 rounded-full transition-all"
                        >
                            <X size={20} />
                        </button>
                    </div>
                </div>

                {/* KPI Summary Cards */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 bg-slate-50 border-b border-slate-200">
                    <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-xs">
                        <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                            {t('bodegaOrders.pilotEvaluatedItems')}
                        </div>
                        <div className="text-2xl font-black text-slate-800 mt-1">
                            {stats.total}
                        </div>
                        <div className="text-[10px] text-slate-400 mt-0.5">
                            100% de la orden diaria
                        </div>
                    </div>

                    <div className="bg-emerald-50/60 p-3 rounded-xl border border-emerald-200 shadow-xs">
                        <div className="text-[11px] font-bold text-emerald-700 uppercase tracking-wider flex items-center gap-1">
                            <CheckCircle2 size={13} />
                            {t('bodegaOrders.pilotWithinTolerance')}
                        </div>
                        <div className="text-2xl font-black text-emerald-700 mt-1">
                            {stats.withinCount} <span className="text-sm font-semibold text-emerald-600">({stats.accuracyRate}%)</span>
                        </div>
                        <div className="text-[10px] text-emerald-600 mt-0.5">
                            Concordancia directa
                        </div>
                    </div>

                    <div className="bg-amber-50/60 p-3 rounded-xl border border-amber-200 shadow-xs">
                        <div className="text-[11px] font-bold text-amber-800 uppercase tracking-wider flex items-center gap-1">
                            <AlertTriangle size={13} />
                            {t('bodegaOrders.pilotOutsideTolerance')}
                        </div>
                        <div className="text-2xl font-black text-amber-800 mt-1">
                            {stats.outsideCount} <span className="text-sm font-semibold text-amber-700">({100 - stats.accuracyRate}%)</span>
                        </div>
                        <div className="text-[10px] text-amber-700 mt-0.5">
                            Revisión de merma / porción
                        </div>
                    </div>

                    <div className="bg-blue-50/60 p-3 rounded-xl border border-blue-200 shadow-xs">
                        <div className="text-[11px] font-bold text-blue-700 uppercase tracking-wider">
                            {t('bodegaOrders.pilotOfficialOrder')}
                        </div>
                        <div className="text-xl font-black text-blue-800 mt-1 flex items-baseline gap-1.5">
                            <span>{stats.totalOfficialOrder}</span>
                            <span className="text-xs font-normal text-slate-500">vs</span>
                            <span className="text-sm font-bold text-indigo-600">{stats.totalTheoreticalOrder} teór.</span>
                        </div>
                        <div className="text-[10px] text-blue-600 mt-0.5">
                            Impacto: {stats.orderDiff > 0 ? `+${stats.orderDiff}` : stats.orderDiff} unidades
                        </div>
                    </div>
                </div>

                {/* Filter & Search Bar */}
                <div className="px-5 py-3 bg-white border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
                    <div className="relative flex-1 min-w-[220px] max-w-md">
                        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                            type="text"
                            placeholder={t('bodegaOrders.pilotSearchPlaceholder')}
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                            className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 bg-slate-50/50"
                        />
                    </div>

                    <div className="flex items-center gap-1.5">
                        <Filter size={13} className="text-slate-400 mr-1" />
                        <button
                            type="button"
                            onClick={() => setFilterType('all')}
                            className={`px-2.5 py-1 text-xs rounded-lg font-bold transition-all ${
                                filterType === 'all'
                                    ? 'bg-slate-800 text-white shadow-xs'
                                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                            }`}
                        >
                            {t('bodegaOrders.pilotFilterAll')} ({lines.length})
                        </button>
                        <button
                            type="button"
                            onClick={() => setFilterType('within')}
                            className={`px-2.5 py-1 text-xs rounded-lg font-bold transition-all ${
                                filterType === 'within'
                                    ? 'bg-emerald-700 text-white shadow-xs'
                                    : 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100 border border-emerald-200'
                            }`}
                        >
                            ✅ {t('bodegaOrders.pilotFilterWithin')} ({stats.withinCount})
                        </button>
                        <button
                            type="button"
                            onClick={() => setFilterType('outside')}
                            className={`px-2.5 py-1 text-xs rounded-lg font-bold transition-all ${
                                filterType === 'outside'
                                    ? 'bg-amber-700 text-white shadow-xs'
                                    : 'bg-amber-50 text-amber-800 hover:bg-amber-100 border border-amber-200'
                            }`}
                        >
                            ⚠️ {t('bodegaOrders.pilotFilterOutside')} ({stats.outsideCount})
                        </button>
                    </div>
                </div>

                {/* Table Content */}
                <div className="flex-1 overflow-y-auto max-h-[55vh]">
                    <table className="w-full border-collapse text-left text-xs">
                        <thead className="sticky top-0 bg-slate-100 text-slate-600 uppercase text-[10px] font-black tracking-wider border-b border-slate-200 shadow-2xs z-10">
                            <tr>
                                <th className="p-2.5 pl-4">Insumo</th>
                                <th className="p-2.5 text-center bg-orange-50/60 text-orange-950">{t('bodegaOrders.pilotPhysicalLeftover')}</th>
                                <th className="p-2.5 text-center bg-amber-50/60 text-amber-950">{t('bodegaOrders.pilotTheoreticalLeftover')}</th>
                                <th className="p-2.5 text-center">{t('bodegaOrders.pilotVariance')}</th>
                                <th className="p-2.5 text-center">{t('bodegaOrders.pilotTolerance')}</th>
                                <th className="p-2.5 text-center">{t('bodegaOrders.pilotPrecision')}</th>
                                <th className="p-2.5 text-center bg-slate-50 font-bold">PAR</th>
                                <th className="p-2.5 text-center bg-blue-50/60 text-blue-900 font-black">{t('bodegaOrders.pilotOfficialOrder')}</th>
                                <th className="p-2.5 text-center bg-indigo-50/60 text-indigo-900 font-black">{t('bodegaOrders.pilotTheoreticalOrder')}</th>
                                <th className="p-2.5 text-center pr-4">{t('bodegaOrders.pilotOrderDiff')}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 font-medium">
                            {filteredLines.length === 0 ? (
                                <tr>
                                    <td colSpan={10} className="p-8 text-center text-slate-400 text-xs">
                                        No se encontraron insumos con el filtro aplicado.
                                    </td>
                                </tr>
                            ) : (
                                filteredLines.map((line, idx) => {
                                    const isWithin = line.within_tolerance === true
                                    const diff = line.variance ?? 0
                                    const orderDiff = (line.automatic_order_qty ?? 0) - (line.official_order_qty ?? 0)

                                    return (
                                        <tr
                                            key={line.inventory_item_id || idx}
                                            className={`hover:bg-slate-50/80 transition-colors ${
                                                !isWithin ? 'bg-amber-50/20' : ''
                                            }`}
                                        >
                                            <td className="p-2.5 pl-4 font-bold text-slate-900">
                                                <div>{line.item_name}</div>
                                                {line.unit_description && (
                                                    <span className="text-[10px] text-slate-400 font-normal">
                                                        {line.unit_description}
                                                    </span>
                                                )}
                                            </td>

                                            {/* Sobrante Físico */}
                                            <td className="p-2.5 text-center font-black text-orange-950 bg-orange-50/30">
                                                {line.physical_leftover ?? '-'}
                                            </td>

                                            {/* Sobrante Teórico */}
                                            <td className="p-2.5 text-center font-black text-amber-900 bg-amber-50/30">
                                                {line.automatic_leftover ?? '-'}
                                            </td>

                                            {/* Varianza */}
                                            <td className="p-2.5 text-center">
                                                {line.variance !== null && line.variance !== undefined ? (
                                                    <span className={`inline-block font-black px-1.5 py-0.5 rounded text-[11px] ${
                                                        diff === 0
                                                            ? 'bg-slate-100 text-slate-700'
                                                            : isWithin
                                                            ? 'bg-emerald-100 text-emerald-800'
                                                            : Math.abs(diff) <= 2
                                                            ? 'bg-amber-100 text-amber-800'
                                                            : 'bg-red-100 text-red-800'
                                                    }`}>
                                                        {diff > 0 ? `+${diff}` : diff}
                                                    </span>
                                                ) : '-'}
                                            </td>

                                            {/* Tolerancia */}
                                            <td className="p-2.5 text-center text-slate-500 font-semibold text-[11px]">
                                                {line.tolerance_value !== null ? `±${line.tolerance_value}` : '-'}
                                            </td>

                                            {/* Precisión */}
                                            <td className="p-2.5 text-center">
                                                {isWithin ? (
                                                    <span className="inline-flex items-center gap-1 text-[10px] font-black text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-full">
                                                        <CheckCircle2 size={11} /> En tolerancia
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1 text-[10px] font-black text-amber-800 bg-amber-100 px-2 py-0.5 rounded-full">
                                                        <AlertTriangle size={11} /> Desviación
                                                    </span>
                                                )}
                                            </td>

                                            {/* PAR */}
                                            <td className="p-2.5 text-center font-bold text-slate-700 bg-slate-50/50">
                                                {line.par_value}
                                            </td>

                                            {/* Pedido Oficial */}
                                            <td className="p-2.5 text-center font-black text-blue-900 bg-blue-50/30 text-sm">
                                                {line.official_order_qty ?? '-'}
                                            </td>

                                            {/* Pedido Teórico */}
                                            <td className="p-2.5 text-center font-black text-indigo-900 bg-indigo-50/30 text-sm">
                                                {line.automatic_order_qty ?? '-'}
                                            </td>

                                            {/* Diferencia en Pedido */}
                                            <td className="p-2.5 text-center pr-4 font-bold">
                                                {orderDiff === 0 ? (
                                                    <span className="text-slate-400 font-normal">0 (exacto)</span>
                                                ) : orderDiff > 0 ? (
                                                    <span className="text-amber-700 font-black">+{orderDiff} más</span>
                                                ) : (
                                                    <span className="text-blue-700 font-black">{orderDiff} menos</span>
                                                )}
                                            </td>
                                        </tr>
                                    )
                                })
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Footer */}
                <div className="sticky bottom-0 bg-slate-50 px-6 py-3 border-t border-slate-200 flex items-center justify-between z-10">
                    <div className="text-[11px] text-slate-500">
                        Mostrando <strong className="text-slate-800">{filteredLines.length}</strong> de <strong className="text-slate-800">{lines.length}</strong> productos evaluados.
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-5 py-2 rounded-xl bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold transition-all shadow-xs cursor-pointer"
                    >
                        {t('bodegaOrders.pilotClose')}
                    </button>
                </div>
            </div>
        </div>
    )
}
