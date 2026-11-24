'use client'

/**
 * @module components/food-cost/FoodCostNavigationTabs
 * @description Pestañas superiores unificadas para el ecosistema Food Cost de Tacos Gavilan.
 *   Conecta Visión General (`/admin/food-cost`), Rendimiento de Carnes (`/admin/food-cost/meats`),
 *   Márgenes por Platillo (`/inventory/costs`) y Varianza AvT (`/admin/food-cost/varianza`).
 *
 * @businessRules
 * - 100% bilingüe (`ES` / `EN`) mediante `useLanguage()` (`lib/i18n.tsx`).
 * - Preserva los parámetros de contexto (`startDate`, `endDate`, `period`, `store`, `storeId`) al cambiar de pestaña.
 *
 * @dataFlow
 * - `usePathname()` + parámetros opcionales / `window.location.search` -> `<Link>` con query string preservado.
 *
 * @notes
 * - [2026-11-23] Migrado a `t('food_cost.nav_*')` y preservación segura de filtros sin requerir `<Suspense>` forzado.
 */

import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { TrendingUp, Scale, UtensilsCrossed } from 'lucide-react'
import { useLanguage } from '@/lib/i18n'

interface FoodCostNavigationTabsProps {
    preserveParams?: {
        startDate?: string
        endDate?: string
        period?: string
        store?: string
        storeId?: string
    }
}

export default function FoodCostNavigationTabs({ preserveParams }: FoodCostNavigationTabsProps = {}) {
    const pathname = usePathname()
    const { t } = useLanguage()
    const [browserQuery, setBrowserQuery] = useState('')

    useEffect(() => {
        if (typeof window === 'undefined') return
        const sp = new URLSearchParams(window.location.search)
        const forward = new URLSearchParams()
        for (const key of ['startDate', 'endDate', 'period', 'store', 'storeId']) {
            const val = sp.get(key)
            if (val) forward.set(key, val)
        }
        const qs = forward.toString()
        setBrowserQuery(qs ? `?${qs}` : '')
    }, [pathname])

    let suffix = browserQuery
    if (preserveParams) {
        const sp = new URLSearchParams()
        if (preserveParams.startDate) sp.set('startDate', preserveParams.startDate)
        if (preserveParams.endDate) sp.set('endDate', preserveParams.endDate)
        if (preserveParams.period) sp.set('period', preserveParams.period)
        if (preserveParams.store && preserveParams.store !== 'all') sp.set('store', preserveParams.store)
        if (preserveParams.storeId && preserveParams.storeId !== 'all') sp.set('storeId', preserveParams.storeId)
        const qs = sp.toString()
        suffix = qs ? `?${qs}` : ''
    }

    const tabs = [
        {
            id: 'overview',
            label: t('food_cost.nav_overview'),
            path: '/admin/food-cost',
            icon: <TrendingUp size={16} />,
            exactMatch: true
        },
        {
            id: 'meats',
            label: t('food_cost.nav_meats'),
            path: '/admin/food-cost/meats',
            icon: <Scale size={16} />,
            exactMatch: false
        },
        {
            id: 'margins',
            label: t('food_cost.nav_margins'),
            path: '/inventory/costs',
            icon: <UtensilsCrossed size={16} />,
            exactMatch: false
        },
        {
            id: 'varianza',
            label: t('food_cost.nav_variance'),
            path: '/admin/food-cost/varianza',
            icon: <Scale size={16} />,
            exactMatch: false
        }
    ]

    return (
        <div className="flex items-center gap-1.5 p-1.5 bg-slate-100 dark:bg-slate-800/80 rounded-xl border border-slate-200 dark:border-slate-700/60 mb-6 shadow-sm overflow-x-auto">
            {tabs.map(tab => {
                const isActive = tab.exactMatch
                    ? pathname === tab.path || (pathname.startsWith('/admin/food-cost/') && !pathname.startsWith('/admin/food-cost/meats') && !pathname.startsWith('/admin/food-cost/varianza'))
                    : pathname.startsWith(tab.path)

                return (
                    <Link
                        key={tab.id}
                        href={`${tab.path}${suffix}`}
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
