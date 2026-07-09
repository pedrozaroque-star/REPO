/**
 * @module inventory/orders/print-sheet
 * @description Página de impresión de hoja de sobrantes para captura manual a lápiz.
 *              Replica EXACTAMENTE el formato del Excel que se imprime en la tienda.
 *              Configurada en orientación Vertical (Portrait), utilizando los nombres
 *              del Excel y combinando unidad y nombre en la columna ITEMS.
 *
 * @businessRules
 * - Orientación: Vertical (Portrait) para fácil lectura en carpeta/tabla de apoyo.
 * - Columna ITEMS: Formato "(Unidad) Nombre Excel" (ej: "(Bag of 1 Gallon) Horchata").
 * - Sin columnas innecesarias (# o U) para maximizar el espacio horizontal del nombre.
 * - Ajuste automático de texto (wrap) para evitar que los nombres se corten.
 * - Estructura de Columnas:
 *   - ITEMS (32% del ancho)
 *   - PAR (MON a SUN) + TOTAL (Suma de PARs)
 *   - SOBRANTES (MON a SUN, vacías para llenado a lápiz) + USE (vacío)
 * - Diseño compacto con tipografía sans-serif premium para asegurar que quepa en 1 sola hoja vertical.
 */

'use client'

import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { fetchOrderableItems, fetchWeeklyData } from '../actions'
import { getMonday, addDays } from '../utils'
import { createClient } from '@/lib/supabase-client'
import type { OrderableItem } from '../utils'

/** Obtiene la fecha de negocio (día laboral empieza a las 6am) */
function getLocalBusinessDate(): string {
    const now = new Date()
    const offset = now.getTimezoneOffset()
    const local = new Date(now.getTime() - offset * 60000)
    if (local.getUTCHours() < 6) {
        local.setUTCDate(local.getUTCDate() - 1)
    }
    return local.toISOString().split('T')[0]
}

const DAY_LABELS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']
const DAY_FIELDS = ['mon_par', 'tue_par', 'wed_par', 'thu_par', 'fri_par', 'sat_par', 'sun_par']

export default function PrintSheetPage() {
    const searchParams = useSearchParams()
    const storeIdParam = searchParams.get('storeId') || '14'
    const orderTypeParam = (searchParams.get('orderType') || 'daily') as 'daily' | 'liquids' | 'uniforms'
    const weekParam = searchParams.get('week')

    const [items, setItems] = useState<OrderableItem[]>([])
    const [pars, setPars] = useState<Record<string, any>>({})
    const [counts, setCounts] = useState<Record<string, Record<string, number>>>({})
    const [storeName, setStoreName] = useState('')
    const [weekStart, setWeekStart] = useState('')
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        async function load() {
            try {
                const storeId = parseInt(storeIdParam)
                const monday = weekParam || getMonday(new Date(getLocalBusinessDate() + 'T12:00:00'))

                setWeekStart(monday)

                // Fetch items del template en orden (sort_position)
                const templateItems = await fetchOrderableItems(storeId, orderTypeParam)
                setItems(templateItems)

                // Fetch PAR data
                const weekData = await fetchWeeklyData(storeId, monday, orderTypeParam)
                setPars(weekData.bases)
                setCounts(weekData.counts || {})

                // Fetch store name
                const supabase = createClient()
                const { data: storeData } = await supabase
                    .from('stores')
                    .select('name')
                    .eq('id', storeId)
                    .single()
                setStoreName(storeData?.name || `Tienda #${storeId}`)
            } catch (err) {
                console.error('Error loading print data:', err)
            } finally {
                setLoading(false)
            }
        }
        load()
    }, [storeIdParam, orderTypeParam, weekParam])

    // Auto-print cuando los datos estén listos
    useEffect(() => {
        if (!loading && items.length > 0) {
            setTimeout(() => window.print(), 500)
        }
    }, [loading, items])

    if (loading) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', fontFamily: 'sans-serif' }}>
                <p style={{ fontSize: 18, color: '#666' }}>Generando formato vertical...</p>
            </div>
        )
    }

    const typeLabel = orderTypeParam === 'liquids' ? 'LÍQUIDOS' : orderTypeParam === 'uniforms' ? 'UNIFORMES' : 'DIARIO'

    return (
        <>
            <style>{`
                @media print {
                    @page {
                        size: portrait;
                        margin: 0.15in;
                    }
                    * {
                        -webkit-print-color-adjust: exact !important;
                        print-color-adjust: exact !important;
                    }
                    body { margin: 0; padding: 0; background: white; }
                    .no-print { display: none !important; }
                    .print-container { margin-top: 0 !important; }
                }
                @media screen {
                    body { background: #f1f5f9; padding-bottom: 40px; }
                    .print-container {
                        max-width: 8.5in;
                        margin: 60px auto 20px auto;
                        background: white;
                        padding: 20px;
                        box-shadow: 0 4px 12px rgba(0,0,0,0.1);
                        border-radius: 8px;
                    }
                }
                .print-container {
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                    color: #000;
                }
                .header-section {
                    display: flex;
                    justify-content: space-between;
                    align-items: flex-end;
                    margin-bottom: 6px;
                    border-bottom: 2px solid #000;
                    padding-bottom: 4px;
                }
                .store-title {
                    font-size: 16px;
                    font-weight: 800;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                }
                .meta-info {
                    font-size: 10px;
                    text-align: right;
                    color: #334155;
                }
                .excel-table {
                    width: 100%;
                    border-collapse: collapse;
                    font-size: 8px;
                    table-layout: fixed;
                }
                .excel-table th, .excel-table td {
                    border: 1.5px solid #000;
                    padding: 2px 2px;
                    text-align: center;
                    vertical-align: middle;
                    height: 18px;
                    overflow: hidden;
                }
                /* Header Styles */
                .excel-table thead tr:first-child th {
                    font-size: 8px;
                    font-weight: 800;
                    color: #000;
                    text-transform: uppercase;
                    height: 16px;
                }
                .excel-table thead tr:last-child th {
                    font-size: 7px;
                    font-weight: 700;
                    height: 14px;
                }
                .store-header {
                    background-color: #fbbf24 !important; /* Yellow-400 */
                    font-size: 10px !important;
                    font-weight: 900 !important;
                    text-align: left !important;
                    padding-left: 6px !important;
                }
                .par-section-header {
                    background-color: #fef08a !important; /* Yellow-200 */
                }
                .sob-section-header {
                    background-color: #e2e8f0 !important; /* Slate-200 */
                }
                /* Column Widths (Sum to exactly 100%) */
                .col-item-header {
                    width: 32%;
                }
                .col-day-par {
                    background-color: #fef9c3 !important; /* Yellow-100 */
                    width: 4.2%;
                }
                .col-total {
                    background-color: #fecaca !important; /* Red-200 */
                    font-weight: bold;
                    width: 4.6%;
                }
                .col-day-sob {
                    background-color: #ffffff !important;
                    width: 4.2%;
                }
                .col-use {
                    background-color: #fed7aa !important; /* Orange-200 */
                    font-weight: bold;
                    width: 4.6%;
                }
                /* Cells content */
                .item-cell {
                    text-align: left !important;
                    font-weight: 700;
                    font-size: 8px;
                    padding-left: 6px !important;
                    white-space: normal !important; /* Permitir wrap de texto */
                    line-height: 1.1;
                }
                .par-val {
                    font-weight: 700;
                }
            `}</style>

            {/* Toolbar para pantalla */}
            <div className="no-print" style={{ 
                position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100,
                background: '#0f172a', color: 'white', padding: '10px 20px',
                display: 'flex', alignItems: 'center', gap: 16, fontFamily: 'sans-serif'
            }}>
                <button onClick={() => window.history.back()} 
                    style={{ background: '#334155', color: 'white', border: 'none', padding: '8px 16px', borderRadius: 6, cursor: 'pointer', fontWeight: 'bold' }}>
                    ← Volver
                </button>
                <span style={{ fontSize: 14, fontWeight: 'bold' }}>
                    🖨️ Formato de Captura Manual (Vertical)
                </span>
                <span style={{ flex: 1 }} />
                <button onClick={() => window.print()} 
                    style={{ background: '#2563eb', color: 'white', border: 'none', padding: '8px 20px', borderRadius: 6, cursor: 'pointer', fontWeight: 'bold', fontSize: 14 }}>
                    🖨️ Imprimir Hoja
                </button>
            </div>

            <div className="print-container">
                <div className="header-section">
                    <div className="store-title">
                        📋 {storeName} — SOBRANTES & PAR ({typeLabel})
                    </div>
                    <div className="meta-info">
                        Semana: <strong>{weekStart}</strong> | Generado: {new Date().toLocaleDateString('es-MX')}
                    </div>
                </div>

                <table className="excel-table">
                    <thead>
                        <tr>
                            <th className="store-header col-item-header" style={{ textTransform: 'uppercase' }}>
                                {storeName}
                            </th>
                            <th colSpan={8} className="par-section-header" style={{ borderLeft: '2px solid #000' }}>
                                PAR
                            </th>
                            <th colSpan={8} className="sob-section-header" style={{ borderLeft: '2px solid #000' }}>
                                SOBRANTES / USE
                            </th>
                        </tr>
                        <tr>
                            <th className="col-item-header" style={{ textAlign: 'left', paddingLeft: '6px' }}>ITEMS</th>
                            {DAY_LABELS.map(day => (
                                <th key={`h-par-${day}`} className="col-day-par" style={{ fontSize: 6.5 }}>{day}</th>
                            ))}
                            <th className="col-total" style={{ fontSize: 6.5 }}>TOTAL</th>
                            {DAY_LABELS.map(day => (
                                <th key={`h-sob-${day}`} className="col-day-sob" style={{ fontSize: 6.5 }}>{day}</th>
                            ))}
                            <th className="col-use" style={{ fontSize: 6.5 }}>USE</th>
                        </tr>
                    </thead>
                    <tbody>
                        {items.map((item) => {
                            const parData = pars[item.id]
                            const parValues = DAY_FIELDS.map(f => parData ? Number((parData as any)[f]) || 0 : 0)
                            const totalPar = parValues.reduce((sum, val) => sum + val, 0)

                            // Limpiar paréntesis dobles del formato de unidad
                            let rawDesc = (item.order_unit_description || '').trim()
                            if (rawDesc.startsWith('(') && rawDesc.endsWith(')')) {
                                rawDesc = rawDesc.substring(1, rawDesc.length - 1).trim()
                            }
                            
                            const unitPrefix = rawDesc ? `(${rawDesc}) ` : ''
                            const itemDisplayName = `${unitPrefix}${item.excel_reference || item.name}`

                            return (
                                <tr key={item.id}>
                                    <td className="item-cell">
                                        {itemDisplayName}
                                    </td>
                                    {parValues.map((val, i) => (
                                        <td key={`p-val-${i}`} className="col-day-par par-val">
                                            {val > 0 ? val : ''}
                                        </td>
                                    ))}
                                    <td className="col-total">{totalPar > 0 ? totalPar : ''}</td>
                                    {DAY_LABELS.map((_, i) => {
                                        const dateStr = weekStart ? addDays(weekStart, i) : ''
                                        const itemCounts = counts[item.id]
                                        const val = (itemCounts && dateStr) ? itemCounts[dateStr] : undefined
                                        const hasVal = val !== undefined && val !== null
                                        return (
                                            <td key={`s-val-${i}`} className="col-day-sob" style={{ fontWeight: hasVal ? 'bold' : 'normal' }}>
                                                {hasVal ? val : ''}
                                            </td>
                                        )
                                    })}
                                    <td className="col-use"></td>
                                </tr>
                            )
                        })}
                    </tbody>
                </table>
            </div>
        </>
    )
}
