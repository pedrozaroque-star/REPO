/**
 * @module components/checklists/ScoreGauge
 * @description Componente visual de aguja/anillo circular animado para mostrar puntajes porcentuales de checklists e inspecciones.
 * @businessRules
 * - >= 80%: Verde (Aprobatorio / Excelente).
 * - 60% - 79%: Ámbar (Alerta / Aceptable).
 * - < 60%: Rojo (Deficiente / Requiere Corrección).
 * @notes Sanitiza valores nulos, indefinidos y NaN a 0% para prevenir fallos en renderizado SVG.
 */

import React from 'react'
import { motion } from 'framer-motion'
import { useLanguage } from '@/lib/i18n'

interface ScoreGaugeProps {
    score: number
    size?: number
}

export function ScoreGauge({ score, size = 120 }: ScoreGaugeProps) {
    const { t } = useLanguage()
    const radius = (size - 16) / 2
    const circumference = 2 * Math.PI * radius
    // Sanitizar y asegurar que el score sea numérico válido entre 0 y 100
    const rawScore = typeof score === 'number' && !isNaN(score) ? score : 0
    const clampedScore = Math.min(Math.max(rawScore, 0), 100)
    const offset = circumference - (clampedScore / 100) * circumference

    const getColor = () => {
        if (clampedScore >= 80) return { stroke: '#10b981', bg: 'from-emerald-400 to-green-500', text: 'text-emerald-600' }
        if (clampedScore >= 60) return { stroke: '#f59e0b', bg: 'from-amber-400 to-orange-500', text: 'text-amber-600' }
        return { stroke: '#ef4444', bg: 'from-red-400 to-rose-500', text: 'text-red-600' }
    }

    const colors = getColor()

    return (
        <div className="relative" style={{ width: size, height: size }}>
            <svg className="transform -rotate-90" width={size} height={size}>
                <circle
                    cx={size / 2}
                    cy={size / 2}
                    r={radius}
                    fill="none"
                    stroke="#e5e7eb"
                    strokeWidth="8"
                />
                <motion.circle
                    cx={size / 2}
                    cy={size / 2}
                    r={radius}
                    fill="none"
                    stroke={colors.stroke}
                    strokeWidth="8"
                    strokeLinecap="round"
                    strokeDasharray={circumference}
                    initial={{ strokeDashoffset: circumference }}
                    animate={{ strokeDashoffset: offset }}
                    transition={{ duration: 1, ease: "easeOut" }}
                />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
                <motion.span
                    className={`text-3xl font-black ${colors.text}`}
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ delay: 0.5, type: "spring" }}
                >
                    {Math.round(clampedScore)}%
                </motion.span>
                <span className="text-xs text-gray-400 font-medium">{t('inspections.review.score')}</span>
            </div>
        </div>
    )
}
