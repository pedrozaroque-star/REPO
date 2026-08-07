'use client'

/**
 * @module FoodCostNavigationTabs
 * @description Unified top navigation tabs for the Food Cost master module.
 *   Connects Food Cost Overview (/admin/food-cost), Meat Yields (/admin/food-cost/meats),
 *   and Menu Item Margins (/inventory/costs).
 */

import React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { TrendingUp, Scale, UtensilsCrossed } from 'lucide-react'
import { useLanguage } from '@/lib/i18n'

export default function FoodCostNavigationTabs() {
    const pathname = usePathname()
    const { language } = useLanguage()

    const tabs = [
        {
            id: 'overview',
            label: language === 'en' ? '📊 Store Overview' : '📊 Visión General por Sucursal',
            path: '/admin/food-cost',
            icon: <TrendingUp size={16} />,
            exactMatch: true
        },
        {
            id: 'meats',
            label: language === 'en' ? '🥩 Meat Yields & Usage' : '🥩 Rendimiento de Carnes',
            path: '/admin/food-cost/meats',
            icon: <Scale size={16} />,
            exactMatch: false
        },
        {
            id: 'margins',
            label: language === 'en' ? '📋 Menu Item Margins' : '📋 Márgenes por Platillo',
            path: '/inventory/costs',
            icon: <UtensilsCrossed size={16} />,
            exactMatch: false
        }
    ]

    return (
        <div className="flex items-center gap-1.5 p-1.5 bg-slate-100 dark:bg-slate-800/80 rounded-xl border border-slate-200 dark:border-slate-700/60 mb-6 shadow-sm overflow-x-auto">
            {tabs.map(tab => {
                const isActive = tab.exactMatch
                    ? pathname === tab.path
                    : pathname.startsWith(tab.path)

                return (
                    <Link
                        key={tab.id}
                        href={tab.path}
                        className={`flex items-center gap-2 px-4 py-2 text-xs md:text-sm font-bold rounded-lg transition-all duration-200 whitespace-nowrap ${
                            isActive
                                ? 'bg-white dark:bg-slate-900 text-amber-600 dark:text-amber-400 shadow-md border border-amber-500/20 ring-2 ring-amber-500/20'
                                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-slate-700/50'
                        }`}
                    >
                        {tab.icon}
                        <span>{tab.label}</span>
                    </Link>
                )
            })}
        </div>
    )
}
