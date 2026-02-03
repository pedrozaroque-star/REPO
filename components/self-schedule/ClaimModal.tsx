'use client'

import { useState } from 'react'
import { useLanguage } from '@/lib/i18n'

interface ClaimModalProps {
    isOpen: boolean
    onClose: () => void
    onConfirm: () => Promise<void>
    shift: {
        store_name: string
        shift_date: string
        start_hour: number
        end_hour: number
        position_type: string
    } | null
    isLoading?: boolean
}

export function ClaimModal({ isOpen, onClose, onConfirm, shift, isLoading = false }: ClaimModalProps) {
    const { t, language } = useLanguage()
    const [error, setError] = useState<string | null>(null)

    if (!isOpen || !shift) return null

    const formatHour = (hour: number) => {
        const suffix = hour >= 12 ? 'PM' : 'AM'
        const h = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour
        return `${h}:00 ${suffix}`
    }

    const formatDate = (dateStr: string) => {
        const date = new Date(dateStr + 'T12:00:00')
        return date.toLocaleDateString(language === 'es' ? 'es-MX' : 'en-US', {
            weekday: 'long',
            month: 'short',
            day: 'numeric'
        })
    }

    const handleConfirm = async () => {
        setError(null)
        try {
            await onConfirm()
        } catch (err: any) {
            setError(err.message || 'Error al reclamar turno')
        }
    }

    const positionLabel = shift.position_type === 'kitchen'
        ? (language === 'es' ? '🍳 Cocinero' : '🍳 Kitchen')
        : (language === 'es' ? '💵 Cajero' : '💵 Cashier')

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl max-w-md w-full overflow-hidden animate-in zoom-in-95 duration-200">
                {/* Header */}
                <div className="bg-gradient-to-r from-emerald-500 to-teal-500 px-6 py-4">
                    <h2 className="text-xl font-bold text-white">
                        {language === 'es' ? '¿Reclamar este turno?' : 'Claim this shift?'}
                    </h2>
                </div>

                {/* Content */}
                <div className="p-6 space-y-4">
                    <div className="bg-zinc-50 dark:bg-zinc-800 rounded-xl p-4 space-y-3">
                        <div className="flex items-center gap-3">
                            <span className="text-2xl">📍</span>
                            <div>
                                <p className="text-sm text-zinc-500">{language === 'es' ? 'Tienda' : 'Store'}</p>
                                <p className="font-semibold">{shift.store_name}</p>
                            </div>
                        </div>

                        <div className="flex items-center gap-3">
                            <span className="text-2xl">📅</span>
                            <div>
                                <p className="text-sm text-zinc-500">{language === 'es' ? 'Fecha' : 'Date'}</p>
                                <p className="font-semibold capitalize">{formatDate(shift.shift_date)}</p>
                            </div>
                        </div>

                        <div className="flex items-center gap-3">
                            <span className="text-2xl">⏰</span>
                            <div>
                                <p className="text-sm text-zinc-500">{language === 'es' ? 'Horario' : 'Time'}</p>
                                <p className="font-semibold">
                                    {formatHour(shift.start_hour)} - {formatHour(shift.end_hour)}
                                </p>
                            </div>
                        </div>

                        <div className="flex items-center gap-3">
                            <span className="text-2xl">{shift.position_type === 'kitchen' ? '🍳' : '💵'}</span>
                            <div>
                                <p className="text-sm text-zinc-500">{language === 'es' ? 'Posición' : 'Position'}</p>
                                <p className="font-semibold">{positionLabel}</p>
                            </div>
                        </div>
                    </div>

                    {error && (
                        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 text-red-700 dark:text-red-400 text-sm">
                            {error}
                        </div>
                    )}

                    <p className="text-sm text-zinc-500 text-center">
                        {language === 'es'
                            ? 'Una vez que confirmes, este turno será tuyo y otros empleados no podrán tomarlo.'
                            : 'Once you confirm, this shift will be yours and other employees won\'t be able to take it.'}
                    </p>
                </div>

                {/* Actions */}
                <div className="flex gap-3 p-6 pt-0">
                    <button
                        onClick={onClose}
                        disabled={isLoading}
                        className="flex-1 py-3 px-4 rounded-xl border-2 border-zinc-200 dark:border-zinc-700 font-semibold hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50"
                    >
                        {language === 'es' ? 'Cancelar' : 'Cancel'}
                    </button>
                    <button
                        onClick={handleConfirm}
                        disabled={isLoading}
                        className="flex-1 py-3 px-4 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 text-white font-semibold hover:from-emerald-600 hover:to-teal-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                        {isLoading ? (
                            <>
                                <span className="animate-spin">⏳</span>
                                {language === 'es' ? 'Reclamando...' : 'Claiming...'}
                            </>
                        ) : (
                            <>
                                ✅ {language === 'es' ? 'Confirmar' : 'Confirm'}
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    )
}
