'use client'

import React, { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { motion, Reorder } from 'framer-motion'
import { Trash2, Plus, GripVertical, Save, Edit2, Camera, Star, BarChart3, Type, Hash, CheckSquare, ArrowLeft } from 'lucide-react'
import { getSupabaseClient } from '@/lib/supabase'

// --- Types ---
interface Question {
    id: string
    text: string
    type: string
    order_index: number
    section_id: string
    required_photo?: boolean
}

interface Section {
    id: string
    title: string
    color_theme: string
    order_index: number
    questions: Question[]
}

interface Template {
    id: string
    title: string
    code: string
    type: string
}

const QUESTION_TYPES = [
    { value: 'yes_no', label: 'Sí / No', icon: CheckSquare },
    { value: 'rating_5', label: 'Estrellas (1-5)', icon: Star },
    { value: 'nps_10', label: 'NPS (0-10)', icon: BarChart3 },
    { value: 'text', label: 'Texto Libre', icon: Type },
    { value: 'number', label: 'Número', icon: Hash },
    { value: 'photo', label: 'Solo Foto', icon: Camera },
]

export default function TemplateEditorPage() {
    const params = useParams()
    const router = useRouter()
    const templateId = params.id as string

    const [template, setTemplate] = useState<Template | null>(null)
    const [sections, setSections] = useState<Section[]>([])
    const [loading, setLoading] = useState(true)
    const [savingOrder, setSavingOrder] = useState(false)

    // UI State
    const [editingSection, setEditingSection] = useState<string | null>(null)
    const [editingQuestion, setEditingQuestion] = useState<string | null>(null)

    useEffect(() => {
        if (templateId) fetchTemplateData()
    }, [templateId])

    const fetchTemplateData = async () => {
        try {
            const url = process.env.NEXT_PUBLIC_SUPABASE_URL
            const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

            const resT = await fetch(`${url}/rest/v1/templates?id=eq.${templateId}&select=*`, {
                headers: { 'apikey': key || '', 'Authorization': `Bearer ${key}` }
            })
            const dataT = await resT.json()
            if (!dataT || dataT.length === 0) throw new Error('Plantilla no encontrada')
            setTemplate(dataT[0])

            const resDeep = await fetch(`${url}/rest/v1/template_sections?template_id=eq.${templateId}&select=*,questions:template_questions(*)&order=order_index.asc`, {
                headers: { 'apikey': key || '', 'Authorization': `Bearer ${key}` }
            })
            const dataDeep = await resDeep.json()

            const sortedSections = dataDeep.map((sec: any) => ({
                ...sec,
                questions: (sec.questions || []).sort((a: any, b: any) => a.order_index - b.order_index)
            }))

            setSections(sortedSections)
        } catch (err) {
            console.error(err)
            alert('Error cargando datos')
        } finally {
            setLoading(false)
        }
    }

    const handleSaveOrder = async () => {
        setSavingOrder(true)
        try {
            const supabase = await getSupabaseClient()

            // 1. Update Sections Order
            const sectionUpdates = sections.map((sec, idx) => ({
                id: sec.id,
                order_index: idx
            }))

            for (const update of sectionUpdates) {
                await supabase.from('template_sections').update({ order_index: update.order_index }).eq('id', update.id)
            }

            // 2. Update Questions Order
            for (const sec of sections) {
                const questionUpdates = sec.questions.map((q, idx) => ({
                    id: q.id,
                    order_index: idx
                }))
                for (const qUpdate of questionUpdates) {
                    await supabase.from('template_questions').update({ order_index: qUpdate.order_index }).eq('id', qUpdate.id)
                }
            }

            alert('✅ Orden guardado exitosamente')
        } catch (err) {
            console.error(err)
            alert('Error al guardar el orden')
        } finally {
            setSavingOrder(false)
        }
    }

    const handleAddSection = async () => {
        const title = prompt('Nombre de la nueva sección:')
        if (!title) return

        const newOrder = sections.length
        try {
            const supabase = await getSupabaseClient()
            const { data, error } = await supabase.from('template_sections').insert({
                template_id: templateId,
                title: title,
                order_index: newOrder,
                color_theme: 'gray'
            }).select()

            if (data) {
                const newSec = data[0]
                setSections([...sections, { ...newSec, questions: [] }])
            }
        } catch (e) {
            alert('Error de red')
        }
    }

    const handleUpdateQuestion = async (qId: string, updates: Partial<Question>) => {
        setSections(prev => prev.map(sec => ({
            ...sec,
            questions: sec.questions.map(q => q.id === qId ? { ...q, ...updates } : q)
        })))

        try {
            const supabase = await getSupabaseClient()
            await supabase.from('template_questions').update(updates).eq('id', qId)
        } catch (err) {
            console.error(err)
        }
    }

    const handleDeleteQuestion = async (qId: string) => {
        if (!confirm('¿Borrar esta pregunta?')) return

        setSections(prev => prev.map(sec => ({
            ...sec,
            questions: sec.questions.filter(q => q.id !== qId)
        })))

        try {
            const supabase = await getSupabaseClient()
            await supabase.from('template_questions').delete().eq('id', qId)
        } catch (err) {
            console.error(err)
        }
    }

    const handleAddQuestion = async (sectionId: string) => {
        const text = prompt('Escribe la nueva pregunta:')
        if (!text) return

        const section = sections.find(s => s.id === sectionId)
        const newOrder = section ? section.questions.length : 0

        try {
            const supabase = await getSupabaseClient()
            const { data, error } = await supabase.from('template_questions').insert({
                section_id: sectionId,
                text: text,
                type: 'yes_no',
                order_index: newOrder
            }).select()

            if (data) {
                const newQ = data[0]
                setSections(prev => prev.map(sec => {
                    if (sec.id === sectionId) return { ...sec, questions: [...sec.questions, newQ] }
                    return sec
                }))
            }
        } catch (err) {
            console.error(err)
        }
    }

    const handleReorderSections = (newSections: Section[]) => {
        setSections(newSections)
    }

    const handleReorderQuestions = (sectionId: string, newQuestions: Question[]) => {
        setSections(prev => prev.map(sec => {
            if (sec.id === sectionId) return { ...sec, questions: newQuestions }
            return sec
        }))
    }

    if (loading) return <div className="p-10 text-center animate-pulse">Cargando editor premium...</div>
    if (!template) return <div className="p-10 text-center">No encontrado.</div>

    return (
        <div className="min-h-screen bg-gray-50 pb-32">
            {/* Header */}
            <div className="sticky top-16 md:top-0 z-40 bg-white/80 backdrop-blur-md border-b border-gray-100 shadow-[0_4px_20px_-10px_rgba(0,0,0,0.05)]">
                <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <Link href="/admin/plantillas" className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center text-gray-600 hover:bg-gray-200 transition-colors">
                            <ArrowLeft size={20} />
                        </Link>
                        <div>
                            <h1 className="text-xl font-black text-gray-900 leading-none">{template.title}</h1>
                            <p className="text-xs text-gray-400 font-mono mt-0.5">{template.code}</p>
                        </div>
                    </div>
                    <div className="flex gap-2">
                        <button
                            onClick={handleSaveOrder}
                            disabled={savingOrder}
                            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition shadow-lg shadow-indigo-100 disabled:opacity-50 text-sm"
                        >
                            <Save size={16} />
                            {savingOrder ? 'Guardando...' : 'Guardar Orden'}
                        </button>
                    </div>
                </div>
            </div>

            <main className="max-w-5xl mx-auto px-4 py-8">
                <Reorder.Group axis="y" values={sections} onReorder={handleReorderSections} className="space-y-8">
                    {sections.map((section) => (
                        <Reorder.Item key={section.id} value={section} className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden group/section">
                            {/* Section Header */}
                            <div className={`px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50`}>
                                <div className="flex items-center gap-3">
                                    <div className="cursor-grab active:cursor-grabbing text-gray-400">
                                        <GripVertical size={20} />
                                    </div>
                                    <h2 className="font-bold text-gray-800 flex items-center gap-2">
                                        <span className="w-3 h-3 rounded-full bg-indigo-500"></span>
                                        {section.title}
                                    </h2>
                                </div>
                                <div className="flex gap-2">
                                    <button className="p-2 text-gray-400 hover:text-blue-600 transition">
                                        <Edit2 size={16} />
                                    </button>
                                </div>
                            </div>

                            {/* Questions List */}
                            <div className="bg-white">
                                <Reorder.Group axis="y" values={section.questions} onReorder={(newQs) => handleReorderQuestions(section.id, newQs)} className="divide-y divide-gray-100">
                                    {section.questions.length === 0 && (
                                        <div className="p-8 text-center text-gray-400 italic text-sm">
                                            Sin preguntas en esta sección
                                        </div>
                                    )}
                                    {section.questions.map((q) => (
                                        <Reorder.Item key={q.id} value={q} className="p-5 hover:bg-gray-50/80 transition flex flex-col gap-4 group">
                                            <div className="flex items-start gap-4">
                                                <div className="mt-1 text-gray-300 cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <GripVertical size={18} />
                                                </div>

                                                <div className="flex-1">
                                                    {editingQuestion === q.id ? (
                                                        <div className="space-y-4 bg-indigo-50/50 p-4 rounded-xl border border-indigo-100">
                                                            <div>
                                                                <label className="text-[10px] font-black text-indigo-400 uppercase mb-1 block">Texto de la Pregunta</label>
                                                                <input
                                                                    autoFocus
                                                                    defaultValue={q.text}
                                                                    onBlur={(e) => handleUpdateQuestion(q.id, { text: e.target.value })}
                                                                    className="w-full p-2.5 bg-white border border-indigo-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-200 font-medium"
                                                                />
                                                            </div>

                                                            <div className="flex flex-wrap gap-4">
                                                                <div className="flex-1 min-w-[200px]">
                                                                    <label className="text-[10px] font-black text-indigo-400 uppercase mb-1 block">Tipo de Respuesta</label>
                                                                    <select
                                                                        value={q.type}
                                                                        onChange={(e) => handleUpdateQuestion(q.id, { type: e.target.value })}
                                                                        className="w-full p-2 bg-white border border-indigo-200 rounded-lg text-sm"
                                                                    >
                                                                        {QUESTION_TYPES.map(t => (
                                                                            <option key={t.value} value={t.value}>{t.label}</option>
                                                                        ))}
                                                                    </select>
                                                                </div>

                                                                <div className="flex items-end pb-1">
                                                                    <label className="flex items-center gap-2 cursor-pointer group/toggle">
                                                                        <div className="relative">
                                                                            <input
                                                                                type="checkbox"
                                                                                className="sr-only"
                                                                                checked={q.required_photo || false}
                                                                                onChange={(e) => handleUpdateQuestion(q.id, { required_photo: e.target.checked })}
                                                                            />
                                                                            <div className={`w-10 h-5 rounded-full transition-colors ${q.required_photo ? 'bg-indigo-600' : 'bg-gray-200'}`}></div>
                                                                            <div className={`absolute top-1 left-1 bg-white w-3 h-3 rounded-full transition-transform ${q.required_photo ? 'translate-x-5' : ''}`}></div>
                                                                        </div>
                                                                        <span className="text-xs font-bold text-gray-500 flex items-center gap-1">
                                                                            <Camera size={14} /> Foto Obligatoria
                                                                        </span>
                                                                    </label>
                                                                </div>
                                                            </div>

                                                            <div className="flex justify-end pt-2">
                                                                <button onClick={() => setEditingQuestion(null)} className="px-4 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-bold shadow-sm">
                                                                    Listo
                                                                </button>
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <div className="space-y-2">
                                                            <div
                                                                onClick={() => setEditingQuestion(q.id)}
                                                                className="text-gray-800 font-bold cursor-text hover:text-indigo-700 transition-colors"
                                                            >
                                                                <span className="text-indigo-400 mr-2 opacity-50 font-mono">#{q.order_index + 1}</span>
                                                                {q.text}
                                                            </div>
                                                            <div className="flex items-center gap-3">
                                                                <div className="flex items-center gap-1 px-2 py-0.5 bg-gray-100 border border-gray-200 rounded text-[10px] uppercase font-black text-gray-500">
                                                                    {React.createElement(QUESTION_TYPES.find(t => t.value === q.type)?.icon || CheckSquare, { size: 12 })}
                                                                    {QUESTION_TYPES.find(t => t.value === q.type)?.label}
                                                                </div>
                                                                {q.required_photo && (
                                                                    <div className="flex items-center gap-1 px-2 py-0.5 bg-red-50 border border-red-100 rounded text-[10px] uppercase font-black text-red-500">
                                                                        <Camera size={12} /> Foto Req.
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>

                                                {/* Actions */}
                                                {!editingQuestion && (
                                                    <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
                                                        <button
                                                            onClick={() => setEditingQuestion(q.id)}
                                                            className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                                                        >
                                                            <Edit2 size={16} />
                                                        </button>
                                                        <button
                                                            onClick={() => handleDeleteQuestion(q.id)}
                                                            className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                                        >
                                                            <Trash2 size={16} />
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        </Reorder.Item>
                                    ))}
                                </Reorder.Group>
                            </div>

                            {/* Add Question Footer */}
                            <button
                                onClick={() => handleAddQuestion(section.id)}
                                className="w-full py-4 bg-gray-50/50 hover:bg-indigo-50/30 text-indigo-600 font-black text-xs uppercase tracking-widest flex items-center justify-center gap-2 transition-all border-t border-gray-100"
                            >
                                <Plus size={16} />
                                Agregar Pregunta
                            </button>
                        </Reorder.Item>
                    ))}
                </Reorder.Group>

                {sections.length === 0 && (
                    <div className="text-center py-20 bg-white rounded-3xl border-2 border-dashed border-gray-200 shadow-inner">
                        <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-6 text-4xl">📋</div>
                        <p className="text-gray-500 mb-6 font-medium">Esta plantilla está vacía. ¡Comienza agregando una sección!</p>
                        <button
                            onClick={handleAddSection}
                            className="bg-indigo-600 text-white px-8 py-4 rounded-2xl font-black hover:bg-indigo-700 transition shadow-xl shadow-indigo-100 flex items-center gap-2 mx-auto"
                        >
                            <Plus size={20} />
                            Crear Primera Sección
                        </button>
                    </div>
                )}

                {/* Floating Add Section Button */}
                {sections.length > 0 && (
                    <div className="flex justify-center pt-10">
                        <button
                            onClick={handleAddSection}
                            className="bg-gray-900 text-white px-8 py-4 rounded-2xl font-black hover:bg-black transition shadow-2xl flex items-center gap-3 hover:-translate-y-1 transform duration-200"
                        >
                            <Plus size={24} />
                            NUEVA SECCIÓN
                        </button>
                    </div>
                )}
            </main>
        </div>
    )
}
