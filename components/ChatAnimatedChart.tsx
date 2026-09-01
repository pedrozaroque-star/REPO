'use client'

/**
 * @module components/ChatAnimatedChart
 * @description Interactive, animated data visualization component for TEG Assistant supporting comparative bar charts, trend lines, area curves, and distribution pie charts with toggleable table views.
 * @businessRules
 * - Automatically formats currency ($), percentages (%), hours (hrs), and pounds (lbs).
 * - Enforces responsive resizing for both mobile compact widget and expanded modal views.
 * - Supports dual language localization (Spanish / English) via useLanguage.
 * - Features Framer Motion entrance animations, custom glassmorphic tooltips, and SVG color gradients.
 * @dataFlow
 * - Props (chart: ChartConfig, language: 'es' | 'en') -> Recharts (Bar/Line/Area/Pie) / HTML Table View.
 * @notes Renders seamlessly inside assistant chat bubbles with zero layout shift.
 */

import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend
} from 'recharts'
import { BarChart3, Table as TableIcon, Sparkles, TrendingUp, DollarSign, Percent } from 'lucide-react'

export interface ChartSeries {
  key: string
  name: string
  color?: string
}

export interface ChartConfig {
  type: 'bar' | 'comparison' | 'line' | 'area' | 'pie'
  title: string
  xAxisKey?: string
  unit?: string
  series: ChartSeries[]
  data: Array<Record<string, any>>
  summary?: {
    total?: number | string
    growth?: number | string
    avg?: number | string
    label?: string
  }
}

interface ChatAnimatedChartProps {
  chart: ChartConfig
  language?: 'es' | 'en'
}

const DEFAULT_COLORS = [
  '#6366f1', // Indigo
  '#a855f7', // Purple
  '#06b6d4', // Cyan
  '#10b981', // Emerald
  '#f59e0b', // Amber
  '#ec4899', // Pink
  '#3b82f6', // Blue
  '#84cc16'  // Lime
]

// Format value with unit
function formatChartValue(val: any, unit?: string): string {
  if (val === undefined || val === null) return '-'
  const num = Number(val)
  if (isNaN(num)) return String(val)

  if (unit === '$') {
    return `$${num.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
  }
  if (unit === '%') {
    return `${num.toFixed(1)}%`
  }
  if (unit === 'hrs' || unit === 'h') {
    return `${num.toFixed(1)}h`
  }
  if (unit === 'lbs') {
    return `${num.toLocaleString('en-US', { maximumFractionDigits: 1 })} lbs`
  }

  if (num > 1000) {
    return num.toLocaleString('en-US', { maximumFractionDigits: 2 })
  }
  return num.toString()
}

// Custom Glassmorphic Tooltip
const CustomChartTooltip = ({ active, payload, label, unit }: any) => {
  if (!active || !payload || !payload.length) return null

  return (
    <div className="bg-slate-900/95 dark:bg-slate-950/95 text-white p-2.5 rounded-xl shadow-xl border border-slate-700/80 backdrop-blur-md text-xs min-w-[140px] z-50">
      {label && <p className="font-bold text-slate-200 mb-1.5 border-b border-slate-700/60 pb-1">{label}</p>}
      <div className="space-y-1">
        {payload.map((entry: any, index: number) => {
          const formatted = formatChartValue(entry.value, unit)
          return (
            <div key={`tip-${index}`} className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-1.5 text-slate-300">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color || entry.fill }} />
                {entry.name}:
              </span>
              <span className="font-semibold text-white">{formatted}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function ChatAnimatedChart({ chart, language = 'es' }: ChatAnimatedChartProps) {
  const [viewMode, setViewMode] = useState<'chart' | 'table'>('chart')

  if (!chart || !Array.isArray(chart.data) || chart.data.length === 0) {
    return null
  }

  const { type, title, xAxisKey = 'name', unit = '', series = [], data = [], summary } = chart
  const isSpanish = language === 'es'

  // Ensure series has colors
  const enhancedSeries = series.map((s, idx) => ({
    ...s,
    color: s.color || DEFAULT_COLORS[idx % DEFAULT_COLORS.length]
  }))

  const isPie = type === 'pie'
  const isLine = type === 'line'
  const isArea = type === 'area'

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96, y: 8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      className="my-3 w-full rounded-2xl border border-indigo-100 dark:border-indigo-900/50 bg-gradient-to-b from-white via-indigo-50/20 to-slate-50/40 dark:from-slate-800/90 dark:via-slate-800/60 dark:to-slate-900/90 shadow-sm overflow-hidden"
    >
      {/* Header with Title & View Mode Toggle */}
      <div className="px-3.5 py-2.5 bg-indigo-50/60 dark:bg-indigo-950/40 border-b border-indigo-100/60 dark:border-indigo-900/40 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-6 h-6 rounded-lg bg-indigo-600 text-white flex items-center justify-center flex-shrink-0 shadow-xs">
            <BarChart3 size={13} />
          </div>
          <h4 className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate leading-snug">
            {title}
          </h4>
        </div>

        <div className="flex items-center gap-1 bg-white/80 dark:bg-slate-800/80 p-0.5 rounded-lg border border-indigo-100 dark:border-slate-700 flex-shrink-0">
          <button
            onClick={() => setViewMode('chart')}
            className={`px-2 py-1 rounded text-[10px] font-semibold flex items-center gap-1 transition-all ${
              viewMode === 'chart'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
            title={isSpanish ? 'Ver Gráfica Animada' : 'View Animated Chart'}
          >
            <BarChart3 size={11} /> {isSpanish ? 'Gráfica' : 'Chart'}
          </button>
          <button
            onClick={() => setViewMode('table')}
            className={`px-2 py-1 rounded text-[10px] font-semibold flex items-center gap-1 transition-all ${
              viewMode === 'table'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
            title={isSpanish ? 'Ver Tabla de Datos' : 'View Data Table'}
          >
            <TableIcon size={11} /> {isSpanish ? 'Tabla' : 'Table'}
          </button>
        </div>
      </div>

      {/* KPI Summary Cards (if provided) */}
      {summary && (
        <div className="px-3.5 pt-2.5 pb-1 flex flex-wrap items-center gap-2 text-xs">
          {summary.total !== undefined && (
            <div className="px-2.5 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-100 dark:border-indigo-900/60 flex items-center gap-1.5">
              <span className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">
                {isSpanish ? 'Total:' : 'Total:'}
              </span>
              <span className="font-bold text-indigo-700 dark:text-indigo-300">
                {formatChartValue(summary.total, unit)}
              </span>
            </div>
          )}
          {summary.growth !== undefined && (
            <div className="px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-100 dark:border-emerald-900/60 flex items-center gap-1.5">
              <span className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">
                {isSpanish ? 'Crecimiento:' : 'Growth:'}
              </span>
              <span className="font-bold text-emerald-700 dark:text-emerald-300 flex items-center gap-0.5">
                <TrendingUp size={11} /> {summary.growth}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Main Content: Animated Chart or Data Table */}
      <div className="p-3">
        <AnimatePresence mode="wait">
          {viewMode === 'chart' ? (
            <motion.div
              key="chart-view"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="w-full h-[220px] sm:h-[260px]"
            >
              <ResponsiveContainer width="100%" height="100%">
                {isPie ? (
                  <PieChart>
                    <Tooltip content={<CustomChartTooltip unit={unit} />} />
                    <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} />
                    <Pie
                      data={data}
                      dataKey={enhancedSeries[0]?.key || 'value'}
                      nameKey={xAxisKey}
                      cx="50%"
                      cy="50%"
                      innerRadius={45}
                      outerRadius={75}
                      paddingAngle={3}
                      animationDuration={1200}
                    >
                      {data.map((_, index) => (
                        <Cell key={`cell-${index}`} fill={DEFAULT_COLORS[index % DEFAULT_COLORS.length]} />
                      ))}
                    </Pie>
                  </PieChart>
                ) : isLine ? (
                  <LineChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" opacity={0.6} />
                    <XAxis dataKey={xAxisKey} tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} tickFormatter={(v) => formatChartValue(v, unit)} />
                    <Tooltip content={<CustomChartTooltip unit={unit} />} />
                    {enhancedSeries.length > 1 && <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '6px' }} />}
                    {enhancedSeries.map((s) => (
                      <Line
                        key={s.key}
                        type="monotone"
                        dataKey={s.key}
                        name={s.name}
                        stroke={s.color}
                        strokeWidth={2.5}
                        dot={{ r: 3, fill: s.color }}
                        activeDot={{ r: 5, stroke: '#fff', strokeWidth: 2 }}
                        animationDuration={1200}
                      />
                    ))}
                  </LineChart>
                ) : isArea ? (
                  <AreaChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <defs>
                      {enhancedSeries.map((s, idx) => (
                        <linearGradient key={`grad-${idx}`} id={`area-grad-${idx}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={s.color} stopOpacity={0.4} />
                          <stop offset="95%" stopColor={s.color} stopOpacity={0.02} />
                        </linearGradient>
                      ))}
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" opacity={0.6} />
                    <XAxis dataKey={xAxisKey} tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} tickFormatter={(v) => formatChartValue(v, unit)} />
                    <Tooltip content={<CustomChartTooltip unit={unit} />} />
                    {enhancedSeries.length > 1 && <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '6px' }} />}
                    {enhancedSeries.map((s, idx) => (
                      <Area
                        key={s.key}
                        type="monotone"
                        dataKey={s.key}
                        name={s.name}
                        stroke={s.color}
                        strokeWidth={2.5}
                        fill={`url(#area-grad-${idx})`}
                        animationDuration={1200}
                      />
                    ))}
                  </AreaChart>
                ) : (
                  /* Standard / Comparison Bar Chart */
                  <BarChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" opacity={0.6} />
                    <XAxis dataKey={xAxisKey} tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} tickFormatter={(v) => formatChartValue(v, unit)} />
                    <Tooltip content={<CustomChartTooltip unit={unit} />} />
                    {enhancedSeries.length > 1 && <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '6px' }} />}
                    {enhancedSeries.map((s, idx) => (
                      <Bar
                        key={s.key}
                        dataKey={s.key}
                        name={s.name}
                        fill={s.color || DEFAULT_COLORS[idx % DEFAULT_COLORS.length]}
                        radius={[4, 4, 0, 0]}
                        animationDuration={1200}
                      />
                    ))}
                  </BarChart>
                )}
              </ResponsiveContainer>
            </motion.div>
          ) : (
            <motion.div
              key="table-view"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="max-h-[220px] sm:max-h-[260px] overflow-y-auto custom-scrollbar"
            >
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 sticky top-0">
                    <th className="p-2 font-semibold text-slate-700 dark:text-slate-300">
                      {xAxisKey === 'name' ? (isSpanish ? 'Concepto / Tienda' : 'Item / Store') : xAxisKey}
                    </th>
                    {enhancedSeries.map((s) => (
                      <th key={s.key} className="p-2 font-semibold text-slate-700 dark:text-slate-300 text-right">
                        {s.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {data.map((row, rIdx) => (
                    <tr key={rIdx} className="hover:bg-indigo-50/40 dark:hover:bg-slate-800/40 transition-colors">
                      <td className="p-2 font-medium text-slate-800 dark:text-slate-200">
                        {row[xAxisKey] || `Fila ${rIdx + 1}`}
                      </td>
                      {enhancedSeries.map((s) => (
                        <td key={s.key} className="p-2 text-right font-semibold text-slate-700 dark:text-slate-300">
                          {formatChartValue(row[s.key], unit)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  )
}
