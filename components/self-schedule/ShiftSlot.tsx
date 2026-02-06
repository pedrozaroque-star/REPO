'use client'

import { useLanguage } from '@/lib/i18n'

interface ShiftSlotProps {
    shift: {
        id: string
        store_id: string
        shift_date: string
        start_hour: number
        end_hour: number
        position_type: string
        required_count: number
        claimed_count: number
        available_spots: number
        is_available: boolean
        shift_claims?: any[]
    }
    storeName: string
    isMyShift?: boolean
    showSpan?: boolean
    onClick: () => void
}

export function ShiftSlot({ shift, storeName, isMyShift = false, showSpan = false, onClick }: ShiftSlotProps) {
    const { language } = useLanguage()

    const formatHour = (hour: number) => {
        // Handle overnight hours (e.g., 25 = 1AM, 26 = 2AM)
        const h24 = hour >= 24 ? hour - 24 : hour
        const suffix = h24 >= 12 ? 'PM' : 'AM'
        const h = h24 > 12 ? h24 - 12 : h24 === 0 ? 12 : h24
        return `${h}${suffix}`
    }

    // Determine slot state
    const isFull = shift.claimed_count >= shift.required_count
    const hasSpots = shift.available_spots > 0

    // Base styles
    let bgColor = 'bg-gradient-to-r from-emerald-400 to-teal-400 hover:from-emerald-500 hover:to-teal-500'
    let textColor = 'text-white'
    let cursor = 'cursor-pointer'
    let opacity = ''

    if (isMyShift) {
        bgColor = 'bg-gradient-to-r from-blue-500 to-indigo-500'
        textColor = 'text-white'
    } else if (isFull) {
        bgColor = 'bg-zinc-300 dark:bg-zinc-700'
        textColor = 'text-zinc-500 dark:text-zinc-400'
        cursor = 'cursor-not-allowed'
        opacity = 'opacity-60'
    }

    const positionIcon = shift.position_type === 'kitchen' ? '🍳' : '💵'
    const spotsText = hasSpots
        ? (language === 'es' ? `${shift.available_spots} disponible${shift.available_spots > 1 ? 's' : ''}` : `${shift.available_spots} available`)
        : (language === 'es' ? 'Lleno' : 'Full')

    return (
        <button
            onClick={() => !isFull && onClick()}
            disabled={isFull && !isMyShift}
            className={`
                ${bgColor} ${textColor} ${cursor} ${opacity}
                ${showSpan ? 'w-full h-full' : 'min-w-[120px]'}
                rounded-lg px-3 py-2 text-sm font-medium
                transition-all duration-200 transform hover:scale-[1.01]
                shadow-md hover:shadow-lg
                flex items-center justify-center gap-2
            `}
        >
            <span>{positionIcon}</span>
            <div className="flex flex-col items-center text-center">
                <span className="font-bold text-xs whitespace-nowrap">
                    {formatHour(shift.start_hour)} - {formatHour(shift.end_hour)}
                </span>
                <span className="text-xs opacity-80">
                    {isMyShift ? (language === 'es' ? 'Tu turno' : 'Your shift') : spotsText}
                </span>
            </div>
            {isMyShift && <span className="ml-auto">✓</span>}
        </button>
    )
}
