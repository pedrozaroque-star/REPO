/**
 * @module app/evaluacion/kiosk/page
 * @description Modo Kiosko / Tableta de Evaluación de Personal (STAFF).
 * Interfaz limpia a pantalla completa sin barras de navegación, diseñada para ser colocada en iPads
 * o tabletas Android dentro de las sucursales de Tacos Gavilan para evaluaciones rápidas en tienda.
 * @businessRules
 * - Funciona sin requerir login obligatorio para permitir captura en piso de venta.
 * - Detecta automáticamente la sucursal por geolocalización o permite selección manual.
 * - Aplica jornada laboral de 6:00 AM a 5:59 AM del día siguiente.
 * @dataFlow
 * - Carga tiendas -> Formulario -> Supabase ('staff_evaluations').
 * @notes
 * - Diseñado para pantallas táctiles y orientación vertical u horizontal.
 */

'use client'

import React from 'react'
import { motion } from 'framer-motion'
import StaffEvaluationForm from '@/components/StaffEvaluationForm'
import { useLanguage } from '@/lib/i18n'

export default function StaffEvaluationKioskPage() {
    const { t, language, setLanguage } = useLanguage()
    const isEs = language === 'es'

    return (
        <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-start p-4 sm:p-6 relative overflow-x-hidden">
            {/* Fondo sutil texturizado */}
            <div className="fixed inset-0 opacity-20 pointer-events-none bg-[url('https://www.transparenttextures.com/patterns/cubes.png')]" />

            {/* Cabecera con Logo */}
            <header className="w-full max-w-3xl z-10 my-4 text-center flex flex-col items-center">
                <div className="w-24 h-24 sm:w-28 sm:h-28 bg-white rounded-full flex items-center justify-center shadow-2xl p-2 mb-3 border-4 border-amber-400">
                    <img
                        src="/logo.png"
                        alt="Tacos Gavilan"
                        className="w-full h-full object-contain"
                    />
                </div>

                <div className="w-36 h-12 mb-2 flex items-center justify-center">
                    <img
                        src="/ya_esta.png"
                        alt="¡Ya está!"
                        className="w-full h-full object-contain"
                    />
                </div>

                <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
                    {isEs ? 'Evaluación de Personal' : 'Staff Evaluation'}
                </h1>
                <p className="text-xs sm:text-sm text-slate-400 mt-1 max-w-md">
                    {isEs
                        ? 'Crecer juntos es nuestra meta. Reconoce el esfuerzo y liderazgo de tu equipo.'
                        : 'Growing together is our goal. Recognize effort and leadership in our store team.'}
                </p>

                {/* Botón selector de idioma */}
                <div className="mt-4 flex items-center justify-center">
                    <button
                        type="button"
                        onClick={() => setLanguage(language === 'es' ? 'en' : 'es')}
                        className="px-4 py-1.5 rounded-full bg-slate-800/80 hover:bg-slate-700 border border-slate-700 text-xs font-bold text-white transition-all shadow-sm"
                    >
                        {language === 'es' ? '🇬🇧 English' : '🇪🇸 Español'}
                    </button>
                </div>
            </header>

            {/* Contenedor del Formulario */}
            <main className="w-full max-w-3xl z-10 pb-12">
                <StaffEvaluationForm isKioskMode={true} />
            </main>

            {/* Pie de Página */}
            <footer className="w-full text-center py-4 text-xs text-slate-500 z-10 border-t border-slate-900 mt-auto">
                <p>© {new Date().getFullYear()} Tacos Gavilan • {isEs ? 'Modo Kiosko Tienda' : 'Store Kiosk Mode'}</p>
            </footer>
        </div>
    )
}
