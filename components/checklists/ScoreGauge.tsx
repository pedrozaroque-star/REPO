import React from 'react'
import { motion } from 'framer-motion'

interface ScoreGaugeProps {
    score: number
    size?: number
}

export function ScoreGauge({ score, size = 120 }: ScoreGaugeProps) {
    const radius = (size - 16) / 2
    const circumference = 2 * Math.PI * radius
    // Asegurar que el score esté entre 0 y 100 para evitar errores visuales
    const clampedScore = Math.min(Math.max(score, 0), 100)
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
                <span className="text-xs text-gray-400 font-medium">Score</span>
            </div>
        </div>
    )
}
