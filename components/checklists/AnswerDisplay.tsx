import React from 'react'
import { Star, CheckCircle, AlertCircle } from 'lucide-react'
import { getTempValidation } from '@/lib/checklistValidators'

interface AnswerDisplayProps {
    question: {
        type?: string
        text: string
        [key: string]: any
    }
    value: any
    type: string
    sectionTitle?: string
}

export function AnswerDisplay({ question, value: rawValue, type, sectionTitle }: AnswerDisplayProps) {
    let value = rawValue
    // Normalización del objeto valor (para compatibilidad con diferentes versiones de datos)
    if (value && typeof value === 'object') {
        if (value.value !== undefined) value = value.value
        else if (value.score !== undefined) value = value.score
        else if (value.response !== undefined) value = value.response
    }

    // Si el valor es undefined o null explícito, y no es 0
    const isAnswered = value !== undefined && value !== '' && value !== null
    const displayValue = String(value ?? 'N/A')
    const numValue = Number(value)

    if (!isAnswered && displayValue === 'N/A') {
        return <span className="text-gray-300 dark:text-slate-600 text-xs italic">Sin respuesta</span>
    }

    // YES/NO TYPE (Blocky Buttons style)
    if (question.type === 'yes_no' || displayValue.toUpperCase() === 'SI' || displayValue.toUpperCase() === 'NO' || displayValue.toUpperCase() === 'NA' || displayValue.toUpperCase() === 'N/A') {
        const valUpper = displayValue.toUpperCase().replace('Í', 'I')
        // Normalizing input to align with button keys
        const target = valUpper === 'SI' ? 'SI' : valUpper === 'NO' ? 'NO' : 'NA'

        return (
            <div className="flex gap-2 min-w-[120px]">
                {['SI', 'NO', 'NA'].map(opt => {
                    const isActive = target === opt
                    let activeClass = ''
                    if (isActive) {
                        if (opt === 'SI') activeClass = 'bg-green-600 border-green-600 text-white shadow-green-200 dark:shadow-green-900/20'
                        else if (opt === 'NO') activeClass = 'bg-red-600 border-red-600 text-white shadow-red-200 dark:shadow-red-900/20'
                        else activeClass = 'bg-gray-600 dark:bg-slate-700 border-gray-600 dark:border-slate-600 text-white'
                    } else {
                        // Inactive read-only state
                        activeClass = 'bg-gray-100/80 dark:bg-slate-800/50 border-gray-400 dark:border-slate-700 text-gray-700 dark:text-slate-400 font-bold'
                    }
                    return (
                        <div key={opt} className={`flex-1 py-3 px-2 rounded-xl font-bold text-xs text-center transition-all border-2 ${activeClass}`}>
                            {opt === 'SI' ? 'SÍ' : opt === 'NO' ? 'NO' : 'N/A'}
                        </div>
                    )
                })}
            </div>
        )
    }

    // RATING 5 (Stars)
    if (question.type === 'rating_5') {
        return (
            <div className="flex items-center gap-1 bg-gray-50 dark:bg-slate-800/50 rounded-2xl border border-gray-100 dark:border-slate-800 px-2 py-1">
                {[1, 2, 3, 4, 5].map(val => (
                    <Star
                        key={val}
                        size={16}
                        fill={numValue >= val ? '#facc15' : 'none'}
                        className={numValue >= val ? 'text-yellow-400' : 'text-gray-200 dark:text-slate-700'}
                        strokeWidth={3}
                    />
                ))}
            </div>
        )
    }

    // NPS 10 (Circles)
    if (question.type === 'nps_10') {
        return (
            <div className="flex items-center gap-1">
                <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs shadow-sm border
                    ${numValue >= 9 ? 'bg-green-500 text-white border-green-600' :
                            numValue >= 7 ? 'bg-yellow-500 text-white border-yellow-600' :
                                'bg-red-500 text-white border-red-600'}`}
                >
                    {numValue}
                </div>
                <span className="text-[10px] font-bold text-gray-400 dark:text-slate-500">NPS</span>
            </div>
        )
    }

    // SCORE 100 (Cumple/Parcial/No) - used in Supervisor
    if (type === 'supervisor' && (numValue === 100 || numValue === 60 || numValue === 0)) {
        return (
            <div className="flex gap-1 min-w-[150px]">
                {[
                    { label: 'CUMPLE', val: 100, color: 'bg-green-500', bgOff: 'bg-green-50' },
                    { label: 'PARCIAL', val: 60, color: 'bg-orange-500', bgOff: 'bg-orange-50' },
                    { label: 'NO', val: 0, color: 'bg-red-500', bgOff: 'bg-red-50' }
                ].map(opt => {
                    const isSelected = numValue === opt.val
                    return (
                        <div
                            key={opt.val}
                            className={`flex-1 py-2 px-1 rounded-lg flex flex-col items-center justify-center gap-0.5 transition-all text-xs font-bold border-2
                            ${isSelected ? `${opt.color} text-white border-transparent shadow-sm` : 'bg-gray-100 dark:bg-slate-800/50 text-gray-500 dark:text-slate-500 border-gray-300 dark:border-slate-700'}`}
                        >
                            {opt.label}
                        </div>
                    )
                })}
            </div>
        )
    }

    // TEMPERATURES
    if (type === 'temperaturas' && !isNaN(numValue) && value !== null && value !== '') {
        const { isValid } = getTempValidation(question.text, numValue, sectionTitle)
        return (
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border-2 font-bold text-sm ${isValid
                ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 border-emerald-300 dark:border-emerald-800'
                : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border-red-300 dark:border-red-800'
                }`}>
                <span>{displayValue}°F</span>
                {isValid ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
            </div>
        )
    }

    // SOBRANTES
    if (type === 'sobrante' && !isNaN(numValue) && value !== null && value !== '') {
        const isAlarm = numValue > 2
        return (
            <div className="relative">
                <div className={`w-full px-4 py-2 bg-gray-50 dark:bg-slate-800/50 border-2 rounded-xl text-gray-900 dark:text-white font-black text-lg transition-all text-center
                    ${isAlarm ? 'border-red-500 bg-red-50 dark:bg-red-900/20' : 'border-emerald-200 dark:border-emerald-900/50'}`}>
                    {displayValue} <span className="text-xs font-normal text-gray-500 dark:text-slate-400">Lbs</span>
                </div>
            </div>
        )
    }

    // TEXT / DEFAULT
    if (displayValue && displayValue !== 'undefined' && displayValue !== 'null') {
        return (
            <div className="px-4 py-2 rounded-xl bg-gray-50 dark:bg-slate-800/50 text-gray-700 dark:text-slate-300 font-medium text-sm border border-gray-200 dark:border-slate-700 max-w-[200px] truncate" title={displayValue}>
                {displayValue}
            </div>
        )
    }

    return <span className="text-gray-300 dark:text-slate-600 text-xs italic">Sin respuesta</span>
}
