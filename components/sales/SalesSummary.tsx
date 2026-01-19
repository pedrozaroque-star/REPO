'use client'

import React from 'react'
import { DollarSign, ShoppingBag, Tag, Clock } from 'lucide-react'
import { motion } from 'framer-motion'
import { Card } from '@/components/ui/card'

interface SummaryProps {
    data: {
        netSales: number
        grossSales: number
        discounts: number
        tips: number
        taxes: number
        orderCount: number
        guestCount: number
        laborCost: number
        laborPercentage: number
    }
}

const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2
    }).format(value)
}

export default function SalesSummary({ data }: SummaryProps) {
    // Calculate derived metrics
    const avgTicket = data.orderCount > 0 ? data.netSales / data.orderCount : 0

    const cards = [
        {
            title: 'Ventas Netas',
            value: formatCurrency(data.netSales),
            subValue: `Bruto: ${formatCurrency(data.grossSales)}`,
            icon: DollarSign,
            color: 'text-emerald-500',
            bg: 'bg-emerald-500/10',
            border: 'border-emerald-500/20'
        },
        {
            title: 'Promedio Ticket',
            value: formatCurrency(avgTicket),
            subValue: `${data.orderCount.toLocaleString('en-US')} Órdenes`,
            icon: Tag,
            color: 'text-blue-400',
            bg: 'bg-blue-500/10',
            border: 'border-blue-500/20'
        },
        {
            title: 'Total Órdenes',
            value: data.orderCount.toLocaleString('en-US'),
            subValue: `${data.guestCount.toLocaleString('en-US')} Invitados`,
            icon: ShoppingBag,
            color: 'text-purple-400',
            bg: 'bg-purple-500/10',
            border: 'border-purple-500/20'
        },
        {
            title: 'Labor Cost %',
            value: `${data.laborPercentage.toFixed(2)}%`,
            subValue: formatCurrency(data.laborCost),
            icon: Clock,
            color: 'text-orange-400',
            bg: 'bg-orange-500/10',
            border: 'border-orange-500/20'
        }
    ]

    return (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {cards.map((card, index) => (
                <motion.div
                    key={card.title}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.1 }}
                    className={`relative p-5 rounded-3xl border ${card.border} ${card.bg} backdrop-blur-xl overflow-hidden shadow-lg shadow-black/5`}
                >
                    <div className="flex justify-between items-start mb-2">
                        <div className={`p-2.5 rounded-2xl bg-white/20 dark:bg-white/5 ${card.color}`}>
                            <card.icon size={20} />
                        </div>
                    </div>

                    <div className="mt-2 relative z-10">
                        <p className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-widest mb-1">
                            {card.title}
                        </p>
                        <h3 className="text-3xl lg:text-4xl font-semibold text-slate-900 dark:text-white tracking-tighter">
                            {card.value}
                        </h3>
                        {card.subValue && (
                            <p className="text-xs text-slate-600 dark:text-slate-400 font-mono font-bold mt-1">
                                {card.subValue}
                            </p>
                        )}
                    </div>

                    {/* Decorative glow */}
                    <div className={`absolute -right-4 -bottom-4 w-20 h-20 rounded-full blur-3xl opacity-20 dark:opacity-30 ${card.color.replace('text-', 'bg-')}`} />
                </motion.div>
            ))}
        </div>
    )
}
