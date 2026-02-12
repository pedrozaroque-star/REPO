'use client'

import { useState, useEffect } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import Link from 'next/link'
import { CheckCircle2, Circle, ArrowRight, Utensils, Package, FileText, ChevronRight, AlertCircle, TrendingUp } from 'lucide-react'

export default function InventoryDashboard() {
    const [stats, setStats] = useState({
        menuItems: 0,
        ingredients: 0,
        recipes: 0
    })
    const [loading, setLoading] = useState(true)

    const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )

    useEffect(() => {
        async function loadStats() {
            const { count: menuCount } = await supabase.from('toast_menu_items').select('*', { count: 'exact', head: true })
            const { count: ingCount } = await supabase.from('inventory_items').select('*', { count: 'exact', head: true })
            const { count: recipeCount } = await supabase.from('recipes').select('*', { count: 'exact', head: true })

            setStats({
                menuItems: menuCount || 0,
                ingredients: ingCount || 0,
                recipes: recipeCount || 0
            })
            setLoading(false)
        }
        loadStats()
    }, [])

    const steps = [
        {
            id: 1,
            title: "1. Sincronizar Menú (Toast)",
            desc: "Trae tus Tacos, Burritos y Platillos desde el POS.",
            icon: Utensils,
            href: "/inventory/menu",
            count: stats.menuItems,
            target: "items",
            status: stats.menuItems > 0 ? 'completed' : 'pending',
            action: "Ver Menú"
        },
        {
            id: 2,
            title: "2. Crear Insumos (Compras)",
            desc: "Registra tus materias primas: Carne, Aguacate, Tortillas.",
            icon: Package,
            href: "/inventory/items",
            count: stats.ingredients,
            target: "insumos",
            status: stats.ingredients > 0 ? 'completed' : 'current',
            action: "Crear Insumos"
        },
        {
            id: 3,
            title: "3. Mapear Recetas (El Puente)",
            desc: "Conecta: 1 Taco de Asada = 0.15lb Carne.",
            icon: FileText,
            href: "/inventory/menu",
            count: stats.recipes,
            target: "recetas",
            status: stats.recipes > 0 ? 'completed' : (stats.ingredients > 0 ? 'current' : 'locked'),
            action: "Crear Recetas"
        }
    ]

    return (
        <div className="p-8 max-w-6xl mx-auto">
            <header className="mb-10 text-center">
                <h1 className="text-4xl font-extrabold text-slate-900 dark:text-white mb-2">Configuración de Inventario</h1>
                <p className="text-lg text-slate-600 dark:text-slate-400 max-w-2xl mx-auto">
                    Para que el sistema calcule cuánto debes comprar, necesitamos entender cómo se construyen tus platillos. Sigue estos 3 pasos.
                </p>
            </header>

            {/* Steps Wizard */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative">
                {/* Connector Lines (Desktop) */}
                <div className="hidden md:block absolute top-12 left-[16%] right-[16%] h-1 bg-slate-200 dark:bg-slate-700 -z-10"></div>

                {steps.map((step, idx) => {
                    const isCompleted = step.status === 'completed'
                    const isCurrent = step.status === 'current'
                    const isLocked = step.status === 'locked'

                    return (
                        <div key={step.id} className={`relative flex flex-col items-center text-center group ${isLocked ? 'opacity-50 grayscale' : ''}`}>
                            <div className={`w-24 h-24 rounded-full flex items-center justify-center mb-6 shadow-xl transition-all duration-300 ${isCompleted ? 'bg-emerald-500 text-white scale-105' :
                                isCurrent ? 'bg-indigo-600 text-white ring-4 ring-indigo-100 dark:ring-indigo-900 scale-110' :
                                    'bg-white dark:bg-slate-800 text-slate-400 border-2 border-slate-200 dark:border-slate-700'
                                }`}>
                                <step.icon size={32} strokeWidth={1.5} />
                                {isCompleted && (
                                    <div className="absolute -right-2 -top-2 bg-white text-emerald-500 rounded-full p-1 shadow-sm">
                                        <CheckCircle2 size={24} fill="currentColor" className="text-white" />
                                    </div>
                                )}
                            </div>

                            <h3 className={`text-xl font-bold mb-2 ${isCurrent ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-800 dark:text-white'}`}>
                                {step.title}
                            </h3>
                            <p className="text-sm text-slate-500 dark:text-slate-400 mb-6 px-4 h-10">
                                {step.desc}
                            </p>

                            <div className="bg-slate-100 dark:bg-slate-800/50 rounded-lg px-4 py-2 mb-6 font-mono text-sm font-medium text-slate-600 dark:text-slate-300 flex items-center gap-2">
                                {loading ? (
                                    <div className="h-4 w-12 bg-slate-200 dark:bg-slate-700 rounded animate-pulse" />
                                ) : (
                                    <>
                                        <b className={step.count > 0 ? "text-emerald-600 dark:text-emerald-400" : ""}>{step.count}</b> {step.target}
                                    </>
                                )}
                            </div>

                            {!isLocked ? (
                                <Link
                                    href={step.href}
                                    className={`inline-flex items-center gap-2 px-6 py-2.5 rounded-full font-medium transition-all ${isCurrent
                                        ? 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-lg hover:shadow-indigo-500/25'
                                        : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 hover:border-indigo-300 dark:hover:border-indigo-700'
                                        }`}
                                >
                                    {step.action} <ChevronRight size={16} />
                                </Link>
                            ) : (
                                <button disabled className="px-6 py-2.5 text-slate-400 cursor-not-allowed font-medium">
                                    Bloqueado
                                </button>
                            )}
                        </div>
                    )
                })}
            </div>

            {/* Analysis Section */}
            <div className="mt-12">
                <h2 className="text-2xl font-bold text-slate-800 dark:text-white mb-6 flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                        <TrendingUp size={20} />
                    </div>
                    Análisis & Reportes
                </h2>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Cost Report Card */}
                    <div
                        onClick={() => window.location.href = '/inventory/costs'}
                        className="bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 hover:shadow-md transition-all cursor-pointer group flex items-start gap-5"
                    >
                        <div className="h-14 w-14 bg-emerald-100 dark:bg-emerald-900/30 rounded-xl flex-shrink-0 flex items-center justify-center text-emerald-600 dark:text-emerald-400 group-hover:scale-110 transition-transform">
                            <TrendingUp size={28} />
                        </div>
                        <div>
                            <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
                                Reporte de Costos Teóricos
                            </h3>
                            <p className="text-slate-500 text-sm mb-4">
                                Analiza el <strong>Food Cost %</strong> de cada platillo basado en tus recetas y precios de compra actuales. Detecta ítems de bajo margen.
                            </p>
                            <span className="inline-flex items-center text-sm font-medium text-emerald-600 dark:text-emerald-400 group-hover:underline">
                                Ver Reporte <ArrowRight size={16} className="ml-1" />
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Contextual Help */}
            <div className="mt-16 bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 rounded-2xl p-6 flex items-start gap-4 max-w-4xl mx-auto">
                <div className="bg-blue-100 dark:bg-blue-800 p-2 rounded-lg text-blue-600 dark:text-blue-300 mt-1">
                    <AlertCircle size={24} />
                </div>
                <div>
                    <h4 className="font-bold text-blue-900 dark:text-blue-100 text-lg mb-1">¿Por qué necesito esto?</h4>
                    <p className="text-blue-800 dark:text-blue-200 leading-relaxed">
                        El sistema necesita saber <strong>qué vendes</strong> (Toast) y <strong>qué compras</strong> (Insumos) y <strong>cómo se relacionan</strong> (Recetas).
                        <br /><br />
                        Solo así podremos generar órdenes de compra automáticas y calcular tu costo real (Food Cost).
                    </p>
                </div>
            </div>
        </div>
    )
}
