'use client'

import React, { useEffect, useState } from 'react'
import { Star, X, Trophy, Medal, Award } from 'lucide-react'
import { formatStoreName } from '@/lib/supabase'

interface LeaderboardProps {
    isOpen: boolean
    onClose: () => void
    data: any[]
}

export default function FeedbackLeaderboardModal({ isOpen, onClose, data }: LeaderboardProps) {
    if (!isOpen) return null

    // Calculate Store Averages
    const storeStats = data.reduce((acc: any, curr: any) => {
        const storeId = curr.store_id
        if (!storeId || !curr.stores?.name) return acc

        if (!acc[storeId]) {
            acc[storeId] = {
                name: formatStoreName(curr.stores.name),
                total: 0,
                sum: 0,
                npsSum: 0
            }
        }

        // Calculate Average Rating (Service, Quality, Cleanliness, Speed)
        const avgRating = (
            (curr.service_rating || 0) +
            (curr.food_quality_rating || 0) +
            (curr.cleanliness_rating || 0) +
            (curr.speed_rating || 0)
        ) / 4

        acc[storeId].total += 1
        acc[storeId].sum += avgRating
        acc[storeId].npsSum += (curr.nps_score || 0)

        return acc
    }, {})

    const leaderboard = Object.values(storeStats)
        .map((s: any) => ({
            ...s,
            average: s.sum / s.total,
            avgNps: Math.round(s.npsSum / s.total)
        }))
        .sort((a: any, b: any) => b.average - a.average)

    return (
        <div className="fixed inset-0 z-[6000] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-300 p-4">
            <div className="bg-white dark:bg-slate-900 w-full max-w-4xl rounded-3xl shadow-2xl relative overflow-hidden flex flex-col max-h-[90vh]">

                {/* Header with Trophy */}
                <div className="bg-gradient-to-r from-yellow-400 to-orange-500 p-6 flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-4">
                        <div className="p-3 bg-white/20 rounded-full backdrop-blur-sm">
                            <Trophy className="text-white w-8 h-8 md:w-10 md:h-10" />
                        </div>
                        <div>
                            <h2 className="text-2xl md:text-3xl font-black text-white uppercase tracking-tight">Top Tiendas</h2>
                            <p className="text-white/80 font-bold text-sm">Ranking en tiempo real basado en Feedback</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 bg-white/20 hover:bg-white/30 rounded-full text-white transition-colors"
                    >
                        <X size={24} />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-4">
                    {leaderboard.map((item: any, index: number) => {
                        // Top 3 Styling
                        let rankColor = 'bg-gray-50 dark:bg-slate-800'
                        let rankIcon = <span className="text-xl font-bold text-gray-400">#{index + 1}</span>
                        let borderClass = 'border-transparent'

                        if (index === 0) {
                            rankColor = 'bg-yellow-50 dark:bg-yellow-900/10'
                            borderClass = 'border-yellow-200 dark:border-yellow-700'
                            rankIcon = <Trophy className="text-yellow-500 w-8 h-8 drop-shadow-sm" />
                        } else if (index === 1) {
                            rankColor = 'bg-slate-50 dark:bg-slate-800'
                            borderClass = 'border-slate-200 dark:border-slate-700'
                            rankIcon = <Medal className="text-slate-400 w-8 h-8 drop-shadow-sm" />
                        } else if (index === 2) {
                            rankColor = 'bg-orange-50 dark:bg-orange-900/10'
                            borderClass = 'border-orange-200 dark:border-orange-700'
                            rankIcon = <Award className="text-orange-500 w-8 h-8 drop-shadow-sm" />
                        }

                        return (
                            <div
                                key={item.name}
                                className={`flex items-center gap-4 p-4 rounded-2xl border ${borderClass} ${rankColor} transition-transform hover:scale-[1.01]`}
                            >
                                <div className="w-12 h-12 flex items-center justify-center shrink-0">
                                    {rankIcon}
                                </div>

                                <div className="flex-1">
                                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-1">
                                        <h3 className="text-lg md:text-xl font-black text-gray-800 dark:text-white leading-tight">
                                            {item.name}
                                        </h3>
                                        <div className="flex items-center gap-1">
                                            {[1, 2, 3, 4, 5].map((star) => (
                                                <Star
                                                    key={star}
                                                    size={20}
                                                    className={`${star <= Math.round(item.average) ? 'fill-yellow-400 text-yellow-400' : 'text-gray-300 dark:text-gray-600'}`}
                                                />
                                            ))}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-4 mt-2 text-xs font-bold text-gray-500 dark:text-gray-400">
                                        <span className="bg-white dark:bg-black/20 px-2 py-1 rounded-md">
                                            {item.total} reseñas
                                        </span>
                                        <span className="bg-white dark:bg-black/20 px-2 py-1 rounded-md text-indigo-500">
                                            NPS: {item.avgNps}
                                        </span>
                                        <span className="flex-1 text-right text-base font-black text-gray-900 dark:text-white md:hidden">
                                            {item.average.toFixed(1)}
                                        </span>
                                    </div>
                                </div>

                                <div className="hidden md:flex flex-col items-end shrink-0">
                                    <span className="text-3xl font-black text-gray-900 dark:text-white">
                                        {item.average.toFixed(1)}
                                    </span>
                                    <span className="text-[10px] uppercase font-bold text-gray-400">Promedio</span>
                                </div>
                            </div>
                        )
                    })}
                </div>

            </div>
        </div>
    )
}
