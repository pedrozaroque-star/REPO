'use client'

import React, { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { motion, Reorder } from 'framer-motion'
import { Trash2, Plus, GripVertical, Save, Edit2, Camera, Star, BarChart3, Type, Hash, CheckSquare, ArrowLeft, Sparkles, ClipboardList } from 'lucide-react'
import { getSupabaseClient } from '@/lib/supabase'
import SurpriseLoader from '@/components/SurpriseLoader'
import { useLanguage } from '@/lib/i18n'

// --- Types ---
interface Question {
    id: string
    text: string
    type: string
    order_index: number
    section_id: string
    required_photo?: boolean
    created_at?: string
}

// Helper to check if question is new (6 months approx 180 days)
const isNew = (dateStr?: string) => {
    if (!dateStr) return false
    const date = new Date(dateStr)
    const now = new Date()
    const diffTime = Math.abs(now.getTime() - date.getTime())
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
    return diffDays <= 180
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
    { value: 'yes_no', icon: CheckSquare },
    { value: 'rating_5', icon: Star },
    { value: 'nps_10', icon: BarChart3 },
    { value: 'text', icon: Type },
    { value: 'number', icon: Hash },
    { value: 'photo', icon: Camera },
    { value: 'compliance', icon: ClipboardList },
]

export default function TemplateEditorPage() {
    const { t, language } = useLanguage()
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
            if (!dataT || dataT.length === 0) throw new Error(t('plantillas.editor.errors.not_found'))
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
            alert(t('plantillas.editor.errors.load_error'))
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

            alert(t('plantillas.editor.errors.save_order_success'))
        } catch (err) {
            console.error(err)
            alert(t('plantillas.editor.errors.save_order_error'))
        } finally {
            setSavingOrder(false)
        }
    }

    const handleAddSection = async () => {
        const title = prompt(t('plantillas.editor.errors.create_section_prompt'))
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
            alert(t('plantillas.editor.errors.network_error'))
        }
    }

    const handleUpdateQuestion = async (qId: string, updates: Partial<Question>) => {
        setSections(prev => {
            // If strictly creating/updating simple fields and NOT moving sections
            if (!updates.section_id) {
                return prev.map(sec => ({
                    ...sec,
                    questions: sec.questions.map(q => q.id === qId ? { ...q, ...updates } : q)
                }))
            }

            // If moving to another section:
            let questionToMove: Question | undefined

            // 1. Find and remove from old section
            const sectionsWithoutQ = prev.map(sec => {
                const q = sec.questions.find(q => q.id === qId)
                if (q) {
                    questionToMove = { ...q, ...updates } // Capture with updates
                    // Remove from this section
                    return { ...sec, questions: sec.questions.filter(q => q.id !== qId) }
                }
                return sec
            })

            if (!questionToMove) return prev

            // 2. Add to new section
            return sectionsWithoutQ.map(sec => {
                if (sec.id === updates.section_id) {
                    return { ...sec, questions: [...sec.questions, questionToMove!] }
                }
                return sec
            })
        })

        try {
            const supabase = await getSupabaseClient()
            const { error } = await supabase.from('template_questions').update(updates).eq('id', qId)
            if (error) {
                console.error(error)
                alert(t('plantillas.editor.errors.update_error') + error.message)
            }
        } catch (err: any) {
            console.error(err)
            alert(t('plantillas.editor.errors.network_error') + ': ' + err.message)
        }
    }

    const handleDeleteQuestion = async (qId: string) => {
        if (!confirm(t('plantillas.editor.errors.delete_confirm'))) return

        setSections(prev => prev.map(sec => ({
            ...sec,
            questions: sec.questions.filter(q => q.id !== qId)
        })))

        try {
            const supabase = await getSupabaseClient()
            const { error } = await supabase.from('template_questions').delete().eq('id', qId)
            if (error) {
                console.error(error)
                alert(t('plantillas.editor.errors.delete_error') + error.message)
            }
        } catch (err: any) {
            console.error(err)
            alert(t('plantillas.editor.errors.delete_error') + (err.message || 'Desconocido'))
            // Revert state if needed (complex for delete, assume refresh or ignore for now, but ideally we revert)
        }
    }

    const handleAddQuestion = async (sectionId: string) => {
        const text = prompt(t('plantillas.editor.errors.create_question_prompt'))
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

            if (error) {
                console.error(error)
                if (error.code === '42501' || error.message?.includes('row-level security')) {
                    alert(t('plantillas.editor.errors.session_expired'))
                } else {
                    alert(t('plantillas.editor.errors.create_question_error') + error.message)
                }
                return
            }

            if (data) {
                const newQ = data[0]
                setSections(prev => prev.map(sec => {
                    if (sec.id === sectionId) return { ...sec, questions: [...sec.questions, newQ] }
                    return sec
                }))
            }
        } catch (err: any) {
            console.error('Error adding question:', err)
            alert(t('plantillas.editor.errors.create_question_error') + (err.message || 'Desconocido'))
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

    if (loading) return <SurpriseLoader />
    if (!template) return <div className="p-10 text-center">No encontrado.</div>

    return (
        <div className="min-h-screen bg-transparent pb-32">
            {/* Header */}
            <div className="sticky top-16 md:top-0 z-40 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-gray-100 dark:border-slate-800 shadow-[0_4px_20px_-10px_rgba(0,0,0,0.05)]">
                <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <Link href="/admin/plantillas" className="w-10 h-10 rounded-xl bg-gray-100 dark:bg-slate-800 flex items-center justify-center text-gray-600 dark:text-slate-400 hover:bg-gray-200 dark:hover:bg-slate-700 transition-colors">
                            <ArrowLeft size={20} />
                        </Link>
                        <div>
                            <h1 className="text-xl font-black text-gray-900 dark:text-white leading-none">{template.title}</h1>
                            <p className="text-xs text-gray-400 dark:text-slate-500 font-mono mt-0.5">{template.code}</p>
                        </div>
                    </div>
                    <div className="flex gap-2">
                        <button
                            onClick={handleSaveOrder}
                            disabled={savingOrder}
                            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition shadow-lg shadow-indigo-100 dark:shadow-none disabled:opacity-50 text-sm"
                        >
                            <Save size={16} />
                            {savingOrder ? t('plantillas.editor.saving') : t('plantillas.editor.save_order')}
                        </button>
                    </div>
                </div>
            </div>

            <main className="max-w-5xl mx-auto px-4 py-8">
                <Reorder.Group axis="y" values={sections} onReorder={handleReorderSections} className="space-y-8">
                    {sections.map((section) => (
                        <Reorder.Item key={section.id} value={section} className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-gray-200 dark:border-slate-800 overflow-hidden group/section">
                            {/* Section Header */}
                            <div className="px-6 py-4 border-b border-gray-100 dark:border-slate-800 flex justify-between items-center bg-gray-50/50 dark:bg-slate-800/50">
                                <div className="flex items-center gap-3">
                                    <div className="cursor-grab active:cursor-grabbing text-gray-400 dark:text-slate-600">
                                        <GripVertical size={20} />
                                    </div>
                                    <h2 className="font-bold text-gray-800 dark:text-white flex items-center gap-2">
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
                            <div className="bg-white dark:bg-slate-900/40">
                                <Reorder.Group axis="y" values={section.questions} onReorder={(newQs) => handleReorderQuestions(section.id, newQs)} className="divide-y divide-gray-100 dark:divide-slate-800">
                                    {section.questions.length === 0 && (
                                        <div className="p-8 text-center text-gray-400 dark:text-slate-600 italic text-sm">
                                            {t('plantillas.editor.empty_section')}
                                        </div>
                                    )}
                                    {section.questions.map((q) => (
                                        <Reorder.Item key={q.id} value={q} className="p-5 hover:bg-gray-50/80 dark:hover:bg-slate-800/50 transition flex flex-col gap-4 group">
                                            <div className="flex items-start gap-4">
                                                <div className="mt-1 text-gray-300 dark:text-slate-700 cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <GripVertical size={18} />
                                                </div>

                                                <div className="flex-1">
                                                    {editingQuestion === q.id ? (
                                                        <div className="space-y-4 bg-indigo-50/50 dark:bg-indigo-900/10 p-4 rounded-xl border border-indigo-100 dark:border-indigo-900/30">
                                                            <div>
                                                                <label className="text-[10px] font-black text-indigo-400 uppercase mb-1 block">{t('plantillas.editor.labels.question_text')}</label>
                                                                <input
                                                                    autoFocus
                                                                    defaultValue={q.text}
                                                                    onBlur={(e) => handleUpdateQuestion(q.id, { text: e.target.value })}
                                                                    className="w-full p-2.5 bg-white dark:bg-slate-800 border border-indigo-200 dark:border-indigo-900/50 rounded-lg outline-none focus:ring-2 focus:ring-indigo-200 dark:focus:ring-indigo-900/30 text-gray-900 dark:text-white font-medium"
                                                                />
                                                            </div>

                                                            <div className="flex flex-wrap gap-4">
                                                                <div className="min-w-[200px]">
                                                                    <label className="text-[10px] font-black text-indigo-400 uppercase mb-1 block">{t('plantillas.editor.labels.section')}</label>
                                                                    <select
                                                                        value={q.section_id}
                                                                        onChange={(e) => handleUpdateQuestion(q.id, { section_id: e.target.value })}
                                                                        className="w-full p-2 bg-white dark:bg-slate-800 border border-indigo-200 dark:border-indigo-900/50 text-gray-900 dark:text-slate-200 rounded-lg text-sm outline-none"
                                                                    >
                                                                        {sections.map(s => (
                                                                            <option key={s.id} value={s.id}>{s.title}</option>
                                                                        ))}
                                                                    </select>
                                                                </div>

                                                                <div className="flex-1 min-w-[200px]">
                                                                    <label className="text-[10px] font-black text-indigo-400 uppercase mb-1 block">{t('plantillas.editor.labels.response_type')}</label>
                                                                    <select
                                                                        value={q.type}
                                                                        onChange={(e) => handleUpdateQuestion(q.id, { type: e.target.value })}
                                                                        className="w-full p-2 bg-white dark:bg-slate-800 border border-indigo-200 dark:border-indigo-900/50 text-gray-900 dark:text-slate-200 rounded-lg text-sm outline-none"
                                                                    >
                                                                        {QUESTION_TYPES.map(tq => (
                                                                            <option key={tq.value} value={tq.value}>{t(`plantillas.editor.question_types.${tq.value}`)}</option>
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
                                                                            <Camera size={14} /> {t('plantillas.editor.labels.photo_required')}
                                                                        </span>
                                                                    </label>
                                                                </div>
                                                            </div>

                                                            <div className="flex justify-end pt-2">
                                                                <button onClick={() => setEditingQuestion(null)} className="px-4 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-bold shadow-sm">
                                                                    {t('plantillas.editor.labels.ready')}
                                                                </button>
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <div className="space-y-2">
                                                            <div
                                                                onClick={() => setEditingQuestion(q.id)}
                                                                className="text-gray-800 dark:text-slate-100 font-bold cursor-text hover:text-indigo-700 dark:hover:text-indigo-400 transition-colors"
                                                            >
                                                                <span className="text-indigo-400 dark:text-indigo-500 mr-2 opacity-50 font-mono">#{q.order_index + 1}</span>
                                                                {q.text}
                                                                {isNew(q.created_at) && (
                                                                    <span className="inline-flex items-center gap-1 ml-2 px-1.5 py-0.5 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 text-[10px] uppercase font-black rounded-full border border-indigo-200 dark:border-indigo-900/50">
                                                                        <Sparkles size={10} /> {t('plantillas.editor.labels.new_badge')} <span className="text-indigo-400 dark:text-indigo-500 font-medium normal-case tracking-normal ml-1">({new Date(q.created_at!).toLocaleDateString(language === 'es' ? 'es-MX' : 'en-US', { day: '2-digit', month: 'short', year: '2-digit' })})</span>
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <div className="flex items-center gap-3">
                                                                <div className="flex items-center gap-1 px-2 py-0.5 bg-gray-100 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded text-[10px] uppercase font-black text-gray-500 dark:text-slate-400">
                                                                    {React.createElement(QUESTION_TYPES.find(qt => qt.value === q.type)?.icon || CheckSquare, { size: 12 })}
                                                                    {t(`plantillas.editor.question_types.${q.type}`)}
                                                                </div>
                                                                {q.required_photo && (
                                                                    <div className="flex items-center gap-1 px-2 py-0.5 bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-900/30 rounded text-[10px] uppercase font-black text-red-500 dark:text-red-400">
                                                                        <Camera size={12} /> {t('plantillas.editor.labels.photo_req_badge')}
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
                                className="w-full py-4 bg-gray-50/50 dark:bg-slate-800/50 hover:bg-indigo-50/30 dark:hover:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 font-black text-xs uppercase tracking-widest flex items-center justify-center gap-2 transition-all border-t border-gray-100 dark:border-slate-800"
                            >
                                <Plus size={16} />
                                {t('plantillas.editor.labels.add_question')}
                            </button>
                        </Reorder.Item>
                    ))}
                </Reorder.Group>

                {sections.length === 0 && (
                    <div className="text-center py-20 bg-white dark:bg-slate-900 rounded-3xl border-2 border-dashed border-gray-200 dark:border-slate-800 shadow-inner dark:shadow-none">
                        <div className="w-20 h-20 bg-gray-50 dark:bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-6 text-4xl">📋</div>
                        <p className="text-gray-500 dark:text-slate-400 mb-6 font-medium">{t('plantillas.editor.labels.empty_template')}</p>
                        <button
                            onClick={handleAddSection}
                            className="bg-indigo-600 dark:bg-slate-100 text-white dark:text-slate-900 px-8 py-4 rounded-2xl font-black hover:bg-indigo-700 dark:hover:bg-white transition shadow-xl shadow-indigo-100 dark:shadow-none flex items-center gap-2 mx-auto"
                        >
                            <Plus size={20} />
                            {t('plantillas.editor.labels.create_first_section')}
                        </button>
                    </div>
                )}

                {/* Floating Add Section Button */}
                {sections.length > 0 && (
                    <div className="flex justify-center pt-10">
                        <button
                            onClick={handleAddSection}
                            className="bg-gray-900 dark:bg-slate-100 text-white dark:text-slate-900 px-8 py-4 rounded-2xl font-black hover:bg-black dark:hover:bg-white transition shadow-2xl dark:shadow-none flex items-center gap-3 hover:-translate-y-1 transform duration-200"
                        >
                            <Plus size={24} />
                            {t('plantillas.editor.labels.new_section')}
                        </button>
                    </div>
                )}
            </main>
        </div>
    )
}
