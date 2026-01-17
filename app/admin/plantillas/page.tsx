'use client'

import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, FileText, Plus, Search, Edit } from 'lucide-react'
import SurpriseLoader from '@/components/SurpriseLoader'

interface Template {
    id: string
    code: string
    title: string
    type: string
    active: boolean
    description?: string
    created_at: string
}

export default function TemplatesPage() {
    const [templates, setTemplates] = useState<Template[]>([])
    const [loading, setLoading] = useState(true)
    const [searchTerm, setSearchTerm] = useState('')
    const router = useRouter()

    useEffect(() => {
        fetchTemplates()
    }, [])

    const fetchTemplates = async () => {
        try {
            const url = process.env.NEXT_PUBLIC_SUPABASE_URL
            const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

            const res = await fetch(`${url}/rest/v1/templates?select=*&order=title.asc`, {
                headers: {
                    'apikey': key || '',
                    'Authorization': `Bearer ${key}`
                }
            })

            if (!res.ok) throw new Error('Error fetching templates')
            const data = await res.json()
            setTemplates(data)
        } catch (error) {
            console.error('Error:', error)
            alert('Error cargando plantillas')
        } finally {
            setLoading(false)
        }
    }

    const filteredTemplates = templates.filter(template =>
        template.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        template.code.toLowerCase().includes(searchTerm.toLowerCase())
    )

    const getTypeColor = (type: string) => {
        switch (type) {
            case 'standard': return 'bg-blue-100 text-blue-800'
            case 'inspection': return 'bg-purple-100 text-purple-800'
            case 'feedback': return 'bg-green-100 text-green-800'
            case 'evaluation': return 'bg-orange-100 text-orange-800'
            default: return 'bg-gray-100 text-gray-800'
        }
    }

    return (
        <div className="flex bg-transparent font-sans w-full animate-in fade-in duration-500">
            <main className="flex-1 flex flex-col h-full w-full relative">
                {/* STICKY HEADER - Mobile & Desktop */}
                <div className="bg-white dark:bg-slate-900 border-b border-gray-200 dark:border-slate-800 shadow-sm sticky top-0 z-20 shrink-0 transition-all top-[63px]">
                    <div className="max-w-[1600px] mx-auto px-4 md:px-8 h-16 flex items-center justify-between gap-4">
                        {/* Title Area */}
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-xl bg-red-100 dark:bg-red-900/30 flex items-center justify-center text-red-600 dark:text-red-400">
                                <FileText size={18} />
                            </div>
                            <div>
                                <h1 className="text-lg md:text-xl font-black text-gray-900 dark:text-white tracking-tight leading-none">Plantillas</h1>
                                <p className="hidden md:block text-xs text-gray-400 dark:text-slate-500 font-medium">Gestión de formatos</p>
                            </div>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-3">
                            {/* Desktop Search */}
                            <div className="hidden md:flex relative group">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-red-500 transition-colors" size={16} />
                                <input
                                    type="text"
                                    placeholder="Buscar plantilla..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className="pl-9 pr-4 py-1.5 rounded-full bg-gray-100 dark:bg-slate-800 border-none outline-none focus:ring-2 focus:ring-red-200 dark:focus:ring-red-900/50 text-sm font-medium text-gray-700 dark:text-slate-300 w-64 transition-all"
                                />
                            </div>

                            <button
                                onClick={() => alert('Función de crear nueva plantilla próximamente')}
                                className="w-8 h-8 md:w-auto md:h-auto md:px-4 md:py-1.5 rounded-full bg-gray-900 dark:bg-slate-100 text-white dark:text-slate-900 flex items-center justify-center gap-2 hover:bg-black dark:hover:bg-white transition-transform active:scale-95 shadow-lg shadow-gray-200 dark:shadow-none"
                            >
                                <Plus size={16} strokeWidth={3} />
                                <span className="hidden md:inline font-bold text-xs tracking-wide">NUEVA</span>
                            </button>
                        </div>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto h-full max-w-[1600px] mx-auto px-4 md:px-8 py-8 pb-24 w-full">
                    {/* Mobile Search - Visible only on small screens */}
                    <div className="md:hidden sticky top-0 z-10 -mt-2 mb-6 w-full max-w-[calc(100vw-2rem)] overflow-hidden">
                        <div className="relative group shadow-lg shadow-gray-200/50 dark:shadow-none rounded-full">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                            <input
                                type="text"
                                placeholder="Buscar por título o código..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="w-full pl-11 pr-4 py-3 rounded-full bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 outline-none focus:border-red-300 text-sm font-bold text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-slate-500"
                            />
                        </div>
                    </div>

                    {loading ? (
                        <SurpriseLoader />
                    ) : (
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                            {filteredTemplates.map((template) => (
                                <motion.div
                                    key={template.id}
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    className="bg-white dark:bg-slate-900 rounded-3xl shadow-[0_2px_15px_-5px_rgba(0,0,0,0.05)] dark:shadow-none hover:shadow-lg transition-transform hover:-translate-y-1 border border-gray-100 dark:border-slate-800 overflow-hidden group flex flex-col h-full"
                                >
                                    <div className="p-5 flex-1">
                                        <div className="flex justify-between items-start mb-4">
                                            <span className={`px-2 py-1 rounded-md text-[10px] font-black uppercase tracking-wider ${getTypeColor(template.type)}`}>
                                                {template.type}
                                            </span>
                                            {template.active ? (
                                                <div className="flex items-center gap-1.5 bg-green-50 dark:bg-green-900/20 px-2 py-1 rounded-full border border-green-100 dark:border-green-900/30">
                                                    <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                                                    <span className="text-[10px] font-bold text-green-700 dark:text-green-400">ACTIVO</span>
                                                </div>
                                            ) : (
                                                <div className="flex items-center gap-1.5 bg-gray-50 dark:bg-slate-800 px-2 py-1 rounded-full border border-gray-200 dark:border-slate-700">
                                                    <div className="w-1.5 h-1.5 rounded-full bg-gray-400" />
                                                    <span className="text-[10px] font-bold text-gray-500 dark:text-slate-400">INACTIVO</span>
                                                </div>
                                            )}
                                        </div>

                                        <div className="mb-4">
                                            <h3 className="text-lg font-black text-gray-900 dark:text-white leading-tight mb-1 group-hover:text-red-600 dark:group-hover:text-red-400 transition-colors">
                                                {template.title}
                                            </h3>
                                            <div className="flex items-center gap-2">
                                                <span className="text-xs font-mono font-medium text-gray-400 dark:text-slate-500 bg-gray-50 dark:bg-slate-800 px-1.5 rounded">{template.code}</span>
                                                {template.description && (
                                                    <span className="text-xs text-gray-400 dark:text-slate-500 truncate max-w-[150px]">{template.description}</span>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="p-4 pt-0 mt-auto">
                                        <Link
                                            href={`/admin/plantillas/${template.id}`}
                                            className="w-full bg-gray-900 dark:bg-slate-100 text-white dark:text-slate-900 py-3 rounded-xl font-bold text-xs flex items-center justify-center gap-2 hover:bg-black dark:hover:bg-white transition-transform active:scale-95 shadow-md shadow-gray-200 dark:shadow-none"
                                        >
                                            <Edit size={14} />
                                            EDITAR PREGUNTAS
                                        </Link>
                                    </div>
                                </motion.div>
                            ))}

                            {filteredTemplates.length === 0 && (
                                <div className="col-span-full text-center py-20 opacity-50">
                                    <Search size={48} className="mx-auto text-gray-300 mb-4" />
                                    <p className="text-gray-900 font-bold">No se encontraron plantillas</p>
                                    <p className="text-sm text-gray-500">Intenta con otra búsqueda</p>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </main>
        </div>
    )
}
