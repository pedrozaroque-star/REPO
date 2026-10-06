/**
 * @module components/StaffEvaluationReviewModal
 * @description Modal ejecutivo de visualización, auditoría y revisión de evaluaciones de personal (STAFF y Corporativo).
 * Muestra el desglose completo de las 25 preguntas divididas en 5 áreas (Trabajo en equipo, Liderazgo,
 * Desempeño, Actitud, Desarrollo), fortalezas, áreas de mejora, fotos y módulo de dictamen gerencial.
 * @businessRules
 * - Jornada laboral de 6:00 AM a 5:59 AM del día siguiente para fechas de negocio.
 * - Puestos sin liderazgo omiten las preguntas de liderazgo (Sección 2 y q1_5).
 * - Evalúa correctamente tanto colaboradores de sucursal como de Oficina Central / Corporativo y RRHH.
 * - Supervisores y administradores pueden añadir observaciones administrativas y marcar como 'reviewed'.
 * @dataFlow
 * - Supabase ('staff_evaluations' + 'stores' + 'users') -> Modal State -> Mutación de revisión en DB.
 * @notes
 * - Soporta tanto columnas estructuradas (q1_1 a q5_5) como payload JSONB en 'answers'.
 * - Respeta 'answers.is_lead_role' si fue definido explícitamente en la evaluación.
 * - 100% bilingüe (ES / EN) integrado con useLanguage().
 */

'use client'

import React, { useState, useEffect } from 'react'
import {
    X, Star, CheckCircle, Clock, MapPin, Calendar, User, Briefcase,
    ThumbsUp, ThumbsDown, Award, TrendingUp, AlertCircle, Quote,
    Printer, Save, ChevronDown, ChevronUp, Image as ImageIcon
} from 'lucide-react'
import { getSupabaseClient, formatStoreName } from '@/lib/supabase'
import { formatDateLA, formatTimeLA } from '@/lib/checklistPermissions'
import { useLanguage } from '@/lib/i18n'

interface StaffEvaluationReviewModalProps {
    isOpen: boolean
    onClose: () => void
    evaluation: any
    currentUser: any
    storeName?: string
    onUpdate?: () => void
}

interface QuestionDef {
    col: string
    qid: number
    es: string
    en: string
    isLead?: boolean
}

interface SectionDef {
    id: number
    key: string
    titleEs: string
    titleEn: string
    isLeadSection?: boolean
    questions: QuestionDef[]
}

export const EVALUATION_SECTIONS: SectionDef[] = [
    {
        id: 1,
        key: 'teamwork',
        titleEs: 'Trabajo en equipo',
        titleEn: 'Teamwork',
        questions: [
            { col: 'q1_1', qid: 1609, es: '¿Se comunica de manera clara?', en: 'Communicates clearly?' },
            { col: 'q1_2', qid: 1610, es: '¿Escucha a los demás?', en: 'Listens to others?' },
            { col: 'q1_3', qid: 1611, es: '¿Apoya cuando está ocupado?', en: 'Supports during busy times?' },
            { col: 'q1_4', qid: 1612, es: '¿Fomenta ambiente positivo?', en: 'Fosters a positive environment?' },
            { col: 'q1_5', qid: 1613, es: '¿Resuelve conflictos? (Líder)', en: 'Resolves conflicts? (Lead)', isLead: true }
        ]
    },
    {
        id: 2,
        key: 'leadership',
        titleEs: 'Liderazgo',
        titleEn: 'Leadership',
        isLeadSection: true,
        questions: [
            { col: 'q2_1', qid: 1614, es: '¿Motiva al equipo?', en: 'Motivates the team?' },
            { col: 'q2_2', qid: 1615, es: '¿Da feedback constructivo?', en: 'Provides constructive feedback?' },
            { col: 'q2_3', qid: 1616, es: '¿Es justo asignando tareas?', en: 'Assigns tasks fairly?' },
            { col: 'q2_4', qid: 1617, es: '¿Apoya en dificultades?', en: 'Supports during difficulties?' },
            { col: 'q2_5', qid: 1618, es: '¿Es ejemplo a seguir?', en: 'Is a role model to follow?' }
        ]
    },
    {
        id: 3,
        key: 'performance',
        titleEs: 'Desempeño',
        titleEn: 'Performance',
        questions: [
            { col: 'q3_1', qid: 1619, es: '¿Cumple sin supervisión?', en: 'Delivers without supervision?' },
            { col: 'q3_2', qid: 1620, es: '¿Mantiene limpieza?', en: 'Maintains cleanliness?' },
            { col: 'q3_3', qid: 1621, es: '¿Sigue procedimientos?', en: 'Follows standard procedures?' },
            { col: 'q3_4', qid: 1622, es: '¿Rápido y preciso?', en: 'Fast and accurate?' },
            { col: 'q3_5', qid: 1623, es: '¿Tiene iniciativa? (Líder)', en: 'Shows initiative? (Lead)', isLead: true }
        ]
    },
    {
        id: 4,
        key: 'attitude',
        titleEs: 'Actitud',
        titleEn: 'Attitude',
        questions: [
            { col: 'q4_1', qid: 1624, es: '¿Actitud positiva?', en: 'Positive attitude?' },
            { col: 'q4_2', qid: 1625, es: '¿Respetuoso sin favoritismos?', en: 'Respectful without favoritism?' },
            { col: 'q4_3', qid: 1626, es: '¿Representa bien la marca?', en: 'Represents the brand well?' },
            { col: 'q4_4', qid: 1627, es: '¿Recibe críticas bien?', en: 'Accepts feedback well?' },
            { col: 'q4_5', qid: 1628, es: '¿Contribuye al ambiente?', en: 'Contributes to great atmosphere?' }
        ]
    },
    {
        id: 5,
        key: 'growth',
        titleEs: 'Desarrollo y Aprendizaje',
        titleEn: 'Development & Growth',
        questions: [
            { col: 'q5_1', qid: 1629, es: '¿Interés en aprender?', en: 'Interest in learning?' },
            { col: 'q5_2', qid: 1630, es: '¿Busca crecer?', en: 'Seeks professional growth?' },
            { col: 'q5_3', qid: 1631, es: '¿Ayuda a entrenar?', en: 'Helps train others?' },
            { col: 'q5_4', qid: 1632, es: '¿Aplica lo aprendido?', en: 'Applies what they learned?' },
            { col: 'q5_5', qid: 1633, es: '¿Abierto a cambios?', en: 'Open to operational changes?' }
        ]
    }
]

export default function StaffEvaluationReviewModal({
    isOpen,
    onClose,
    evaluation,
    currentUser,
    storeName,
    onUpdate
}: StaffEvaluationReviewModalProps) {
    const { t, language } = useLanguage()
    const isEs = language === 'es'

    const [adminStatus, setAdminStatus] = useState<string>('pending')
    const [adminObs, setAdminObs] = useState<string>('')
    const [saving, setSaving] = useState(false)
    const [savedSuccess, setSavedSuccess] = useState(false)
    const [reviewerName, setReviewerName] = useState<string>('')
    const [activeSectionAccordion, setActiveSectionAccordion] = useState<Record<number, boolean>>({
        1: true, 2: true, 3: true, 4: true, 5: true
    })
    const [selectedPhoto, setSelectedPhoto] = useState<string | null>(null)

    useEffect(() => {
        if (evaluation) {
            setAdminStatus(evaluation.review_status || 'pending')
            setAdminObs(evaluation.admin_observation || '')
            setSavedSuccess(false)

            if (evaluation.reviewed_by) {
                fetchReviewerName(evaluation.reviewed_by)
            } else {
                setReviewerName('')
            }
        }
    }, [evaluation])

    // Keyboard ESC to close
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                if (selectedPhoto) setSelectedPhoto(null)
                else onClose()
            }
        }
        if (isOpen) window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [isOpen, selectedPhoto, onClose])

    const fetchReviewerName = async (userId: any) => {
        try {
            const supabase = await getSupabaseClient()
            const { data } = await supabase.from('users').select('full_name, name').eq('id', userId).maybeSingle()
            if (data) setReviewerName(data.full_name || data.name || '')
        } catch (e) {
            console.error('Error fetching reviewer:', e)
        }
    }

    if (!isOpen || !evaluation) return null

    const isLeadRole = evaluation.answers?.is_lead_role !== undefined
        ? Boolean(evaluation.answers.is_lead_role)
        : ['shift leader', 'asistente', 'manager', 'supervisor', 'recursos humanos (rrhh)', 'recursos humanos', 'rrhh']
            .includes((evaluation.evaluated_role || '').toLowerCase().trim())

    // Score calculations
    const getAnswerValue = (col: string, qid: number): number | null => {
        if (evaluation[col] !== undefined && evaluation[col] !== null) {
            return Number(evaluation[col])
        }
        if (evaluation.answers && evaluation.answers[qid] !== undefined) {
            return Number(evaluation.answers[qid])
        }
        return null
    }

    const calcSectionAvg = (section: SectionDef): { avg: number | null, count: number } => {
        if (section.isLeadSection && !isLeadRole) return { avg: null, count: 0 }
        let total = 0
        let count = 0
        section.questions.forEach(q => {
            if (q.isLead && !isLeadRole) return
            const val = getAnswerValue(q.col, q.qid)
            if (val !== null && !isNaN(val)) {
                total += val
                count++
            }
        })
        return { avg: count > 0 ? Number((total / count).toFixed(1)) : null, count }
    }

    const handleSaveReview = async () => {
        try {
            setSaving(true)
            const supabase = await getSupabaseClient()
            const updatePayload: any = {
                review_status: adminStatus,
                admin_observation: adminObs,
                reviewed_at: new Date().toISOString()
            }
            if (currentUser?.id) {
                updatePayload.reviewed_by = currentUser.id
            }

            const { error } = await supabase
                .from('staff_evaluations')
                .update(updatePayload)
                .eq('id', evaluation.id)

            if (error) throw error

            setSavedSuccess(true)
            if (currentUser?.full_name || currentUser?.name) {
                setReviewerName(currentUser.full_name || currentUser.name)
            }
            if (onUpdate) onUpdate()
            setTimeout(() => setSavedSuccess(false), 3000)
        } catch (err: any) {
            alert((isEs ? 'Error al guardar revisión: ' : 'Error saving review: ') + err.message)
        } finally {
            setSaving(false)
        }
    }

    const handlePrint = () => {
        window.print()
    }

    const toggleSection = (id: number) => {
        setActiveSectionAccordion(prev => ({ ...prev, [id]: !prev[id] }))
    }

    const overallScore = evaluation.desempeno_general ?? 0
    const isRecommended = (evaluation.recomendaria || '').toLowerCase() === 'si'

    // Extract photos
    const photos: string[] = []
    if (Array.isArray(evaluation.photo_urls)) {
        photos.push(...evaluation.photo_urls)
    }
    if (evaluation.answers?.__question_photos) {
        const qPhotos = Object.values(evaluation.answers.__question_photos).flat() as string[]
        photos.push(...qPhotos)
    }
    const uniquePhotos = Array.from(new Set(photos.filter(p => !!p)))

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/70 backdrop-blur-sm overflow-y-auto animate-in fade-in duration-200 print:p-0 print:bg-white print:static">
            <div className="bg-white dark:bg-slate-900 w-full max-w-4xl rounded-2xl sm:rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col max-h-[92vh] overflow-hidden my-auto print:max-h-none print:shadow-none print:border-none print:rounded-none">

                {/* HEADER MODAL */}
                <div className="p-5 sm:p-6 bg-gradient-to-r from-red-600 to-red-800 text-white flex items-start justify-between relative print:bg-red-800 print:text-white">
                    <div className="space-y-1 pr-8">
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-black uppercase tracking-widest px-2.5 py-0.5 rounded-full bg-white/20 text-white border border-white/30">
                                {isEs ? 'Evaluación de Staff' : 'Staff Evaluation'} #{evaluation.id}
                            </span>
                            <span className={`text-xs font-black uppercase tracking-wider px-2.5 py-0.5 rounded-full ${
                                evaluation.review_status === 'reviewed'
                                    ? 'bg-emerald-500 text-white'
                                    : 'bg-amber-400 text-amber-950 font-bold'
                            }`}>
                                {evaluation.review_status === 'reviewed'
                                    ? (isEs ? 'Revisado' : 'Reviewed')
                                    : (isEs ? 'Pendiente' : 'Pending')}
                            </span>
                        </div>
                        <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-white flex items-center gap-2 pt-1">
                            <User size={26} className="text-amber-300" />
                            {evaluation.evaluated_name}
                        </h2>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-white/90 pt-0.5">
                            <span className="flex items-center gap-1 font-semibold">
                                <Briefcase size={15} className="text-white/80" />
                                {evaluation.evaluated_role}
                            </span>
                            <span className="flex items-center gap-1">
                                <MapPin size={15} className="text-white/80" />
                                {evaluation.location_name || storeName || (evaluation.store_id ? formatStoreName(`Tienda ${evaluation.store_id}`) : (isEs ? 'Oficina Central / Corporativo' : 'Corporate / Central Office'))}
                            </span>
                            <span className="flex items-center gap-1">
                                <Calendar size={15} className="text-white/80" />
                                {formatDateLA(evaluation.evaluation_date)} {formatTimeLA(evaluation.evaluation_date)}
                            </span>
                        </div>
                    </div>

                    <div className="flex items-center gap-2 print:hidden">
                        <button
                            onClick={handlePrint}
                            title={isEs ? 'Imprimir Ficha' : 'Print Review'}
                            className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors"
                        >
                            <Printer size={20} />
                        </button>
                        <button
                            onClick={onClose}
                            className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors"
                        >
                            <X size={20} />
                        </button>
                    </div>
                </div>

                {/* MODAL BODY */}
                <div className="p-5 sm:p-6 overflow-y-auto space-y-6 flex-1 custom-scrollbar text-slate-800 dark:text-slate-200">

                    {/* SCORE SUMMARY CARDS */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        {/* Overall Score */}
                        <div className="p-4 rounded-2xl bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-800/80 dark:to-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col justify-between">
                            <div className="flex items-center justify-between text-xs font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">
                                <span>{isEs ? 'Desempeño General' : 'Overall Performance'}</span>
                                <Award size={18} className="text-red-600 dark:text-red-400" />
                            </div>
                            <div className="my-2 flex items-baseline gap-2">
                                <span className={`text-4xl font-black tracking-tight ${
                                    overallScore >= 8 ? 'text-emerald-600 dark:text-emerald-400' :
                                    overallScore >= 6 ? 'text-amber-500 dark:text-amber-400' : 'text-red-600 dark:text-red-400'
                                }`}>
                                    {overallScore}
                                </span>
                                <span className="text-slate-400 text-lg font-bold">/ 10</span>
                            </div>
                            <div className="text-xs text-slate-500 dark:text-slate-400">
                                {overallScore >= 8 ? (isEs ? 'Excelente desempeño' : 'Outstanding rating') :
                                 overallScore >= 6 ? (isEs ? 'Desempeño competente' : 'Satisfactory rating') :
                                 (isEs ? 'Requiere plan de mejora' : 'Action plan needed')}
                            </div>
                        </div>

                        {/* Recommendation */}
                        <div className="p-4 rounded-2xl bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-800/80 dark:to-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col justify-between">
                            <div className="flex items-center justify-between text-xs font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">
                                <span>{isEs ? '¿Recomienda al Staff?' : 'Recommended?'}</span>
                                {isRecommended ? (
                                    <ThumbsUp size={18} className="text-emerald-600 dark:text-emerald-400" />
                                ) : (
                                    <ThumbsDown size={18} className="text-red-600 dark:text-red-400" />
                                )}
                            </div>
                            <div className="my-2 flex items-center gap-3">
                                <span className={`text-2xl font-black uppercase tracking-tight flex items-center gap-2 ${
                                    isRecommended ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
                                }`}>
                                    {isRecommended ? (isEs ? '✓ SÍ RECOMENDADO' : '✓ RECOMMENDED') : (isEs ? '✗ NO RECOMENDADO' : '✗ NOT RECOMMENDED')}
                                </span>
                            </div>
                            <div className="text-xs text-slate-500 dark:text-slate-400">
                                {isRecommended
                                    ? (isEs ? 'Apto para retención y crecimiento' : 'Eligible for advancement')
                                    : (isEs ? 'Monitorear áreas críticas' : 'Requires active coaching')}
                            </div>
                        </div>

                        {/* Evaluator info */}
                        <div className="p-4 rounded-2xl bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-800/80 dark:to-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col justify-between">
                            <div className="flex items-center justify-between text-xs font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">
                                <span>{isEs ? 'Evaluado por' : 'Evaluated By'}</span>
                                <User size={18} className="text-blue-600 dark:text-blue-400" />
                            </div>
                            <div className="my-2">
                                <span className="text-lg font-black text-slate-800 dark:text-white block truncate">
                                    {evaluation.evaluator_name || (isEs ? 'No especificado (Tienda)' : 'Unspecified (Store)')}
                                </span>
                                <span className="text-xs text-slate-500 dark:text-slate-400 block mt-0.5">
                                    {isEs ? 'Idioma original:' : 'Language:'} {evaluation.language?.toUpperCase() || 'ES'}
                                </span>
                            </div>
                            <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1">
                                <Clock size={12} /> {formatDateLA(evaluation.created_at)}
                            </div>
                        </div>
                    </div>

                    {/* CATEGORY RADAR CARDS (5 Áreas) */}
                    <div>
                        <h3 className="text-xs font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-3 flex items-center gap-2">
                            <TrendingUp size={15} />
                            {isEs ? 'Desglose por Áreas de Desempeño' : 'Performance Area Averages'}
                        </h3>
                        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                            {EVALUATION_SECTIONS.map(sec => {
                                const { avg } = calcSectionAvg(sec)
                                if (sec.isLeadSection && !isLeadRole) {
                                    return (
                                        <div key={sec.id} className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-dashed border-slate-200 dark:border-slate-800 opacity-60">
                                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block truncate">
                                                {isEs ? sec.titleEs : sec.titleEn}
                                            </span>
                                            <span className="text-sm font-bold text-slate-400 mt-1 block">N/A (Operativo)</span>
                                        </div>
                                    )
                                }
                                return (
                                    <div key={sec.id} className="p-3 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col justify-between">
                                        <span className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-wider block truncate">
                                            {isEs ? sec.titleEs : sec.titleEn}
                                        </span>
                                        <div className="flex items-center justify-between mt-2">
                                            <span className="text-xl font-black text-slate-800 dark:text-white">
                                                {avg !== null ? avg : '-'}
                                            </span>
                                            <div className="flex text-amber-400">
                                                <Star size={14} fill="currentColor" />
                                            </div>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    </div>

                    {/* FORTALEZAS & MEJORAS */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {/* Strengths */}
                        <div className="p-5 rounded-2xl bg-emerald-50/70 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800/40 space-y-2">
                            <div className="flex items-center gap-2 text-xs font-black text-emerald-800 dark:text-emerald-300 uppercase tracking-wider">
                                <Award size={16} />
                                {isEs ? 'Fortalezas Identificadas' : 'Identified Strengths'}
                            </div>
                            <p className="text-sm text-slate-700 dark:text-slate-200 whitespace-pre-wrap leading-relaxed font-medium">
                                {evaluation.fortalezas || (isEs ? 'Sin fortalezas registradas' : 'No strengths recorded')}
                            </p>
                        </div>

                        {/* Areas of Improvement */}
                        <div className="p-5 rounded-2xl bg-amber-50/70 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/40 space-y-2">
                            <div className="flex items-center gap-2 text-xs font-black text-amber-800 dark:text-amber-300 uppercase tracking-wider">
                                <AlertCircle size={16} />
                                {isEs ? 'Áreas de Oportunidad / Mejora' : 'Areas for Improvement'}
                            </div>
                            <p className="text-sm text-slate-700 dark:text-slate-200 whitespace-pre-wrap leading-relaxed font-medium">
                                {evaluation.areas_mejora || (isEs ? 'Sin áreas registradas' : 'No improvement areas recorded')}
                            </p>
                        </div>
                    </div>

                    {/* COMMENTS */}
                    {evaluation.comentarios && (
                        <div className="p-5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800 space-y-2">
                            <div className="flex items-center gap-2 text-xs font-black text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                <Quote size={16} />
                                {isEs ? 'Comentarios Adicionales del Evaluador' : 'Additional Evaluator Comments'}
                            </div>
                            <p className="text-sm text-slate-700 dark:text-slate-200 whitespace-pre-wrap leading-relaxed font-medium">
                                {evaluation.comentarios}
                            </p>
                        </div>
                    )}

                    {/* DETALLE PREGUNTA POR PREGUNTA (25 PREGUNTAS) */}
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <h3 className="text-xs font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">
                                {isEs ? 'Detalle de Criterios Evaluados (25 Puntos)' : 'Criteria Breakdown (25 Questions)'}
                            </h3>
                            <button
                                type="button"
                                onClick={() => {
                                    const allOpen = Object.values(activeSectionAccordion).every(v => v)
                                    setActiveSectionAccordion({
                                        1: !allOpen, 2: !allOpen, 3: !allOpen, 4: !allOpen, 5: !allOpen
                                    })
                                }}
                                className="text-xs font-bold text-red-600 dark:text-red-400 hover:underline"
                            >
                                {Object.values(activeSectionAccordion).every(v => v)
                                    ? (isEs ? 'Colapsar Todo' : 'Collapse All')
                                    : (isEs ? 'Expandir Todo' : 'Expand All')}
                            </button>
                        </div>

                        {EVALUATION_SECTIONS.map(section => {
                            if (section.isLeadSection && !isLeadRole) return null
                            const isOpen = activeSectionAccordion[section.id]
                            const { avg } = calcSectionAvg(section)

                            return (
                                <div key={section.id} className="rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm bg-white dark:bg-slate-900">
                                    <button
                                        type="button"
                                        onClick={() => toggleSection(section.id)}
                                        className="w-full px-5 py-3.5 bg-slate-50 dark:bg-slate-800/80 flex items-center justify-between hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                                    >
                                        <div className="flex items-center gap-3">
                                            <span className="w-6 h-6 rounded-full bg-red-600 text-white font-black text-xs flex items-center justify-center">
                                                {section.id}
                                            </span>
                                            <span className="font-bold text-sm text-slate-800 dark:text-white">
                                                {isEs ? section.titleEs : section.titleEn}
                                            </span>
                                            {avg !== null && (
                                                <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300">
                                                    ★ {avg}
                                                </span>
                                            )}
                                        </div>
                                        <div className="text-slate-400">
                                            {isOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                                        </div>
                                    </button>

                                    {isOpen && (
                                        <div className="divide-y divide-slate-100 dark:divide-slate-800">
                                            {section.questions.map((q, idx) => {
                                                if (q.isLead && !isLeadRole) return null
                                                const score = getAnswerValue(q.col, q.qid)

                                                return (
                                                    <div key={q.qid} className="p-4 sm:px-6 flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                                                        <div className="space-y-0.5">
                                                            <span className="text-xs text-slate-400 font-mono">
                                                                {section.id}.{idx + 1}
                                                            </span>
                                                            <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
                                                                {isEs ? q.es : q.en}
                                                            </p>
                                                        </div>

                                                        <div className="flex items-center gap-3 self-end sm:self-auto">
                                                            {score !== null ? (
                                                                <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 px-3 py-1 rounded-xl">
                                                                    <div className="flex text-amber-400">
                                                                        {[1, 2, 3, 4, 5].map(star => (
                                                                            <Star
                                                                                key={star}
                                                                                size={15}
                                                                                fill={star <= score ? "currentColor" : "none"}
                                                                                className={star <= score ? "text-amber-400" : "text-slate-300 dark:text-slate-600"}
                                                                            />
                                                                        ))}
                                                                    </div>
                                                                    <span className="font-black text-sm text-slate-800 dark:text-white pl-1">
                                                                        {score}
                                                                    </span>
                                                                </div>
                                                            ) : (
                                                                <span className="text-xs text-slate-400 font-bold px-2 py-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
                                                                    N/A
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    )}
                                </div>
                            )
                        })}
                    </div>

                    {/* PHOTO GALLERY */}
                    {uniquePhotos.length > 0 && (
                        <div className="space-y-3">
                            <h3 className="text-xs font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest flex items-center gap-2">
                                <ImageIcon size={15} />
                                {isEs ? 'Fotos de Evidencia' : 'Photo Evidence'} ({uniquePhotos.length})
                            </h3>
                            <div className="flex flex-wrap gap-3">
                                {uniquePhotos.map((url, idx) => (
                                    <button
                                        key={idx}
                                        type="button"
                                        onClick={() => setSelectedPhoto(url)}
                                        className="w-20 h-20 rounded-xl overflow-hidden border-2 border-slate-200 dark:border-slate-700 shadow-sm hover:scale-105 transition-transform"
                                    >
                                        <img src={url} alt="Evidencia" className="w-full h-full object-cover" />
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* ADMINISTRATIVE REVIEW SECTION (Supervisors / Admins) */}
                    <div className="p-5 rounded-2xl bg-gradient-to-br from-slate-100 to-slate-200/70 dark:from-slate-800 dark:to-slate-850 border border-slate-300 dark:border-slate-700 space-y-4 print:hidden">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 text-xs font-black text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                                <CheckCircle size={17} className="text-red-600 dark:text-red-400" />
                                {isEs ? 'Dictamen Administrativo / Seguimiento' : 'Management Review & Action Notes'}
                            </div>
                            {evaluation.reviewed_at && (
                                <span className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1">
                                    <Clock size={12} /> {formatDateLA(evaluation.reviewed_at)}
                                    {reviewerName ? ` (${reviewerName})` : ''}
                                </span>
                            )}
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider mb-2">
                                    {isEs ? 'Estatus de la Evaluación' : 'Evaluation Status'}
                                </label>
                                <select
                                    value={adminStatus}
                                    onChange={e => setAdminStatus(e.target.value)}
                                    className="w-full px-4 py-2.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl font-bold text-sm text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-red-600"
                                >
                                    <option value="pending">{isEs ? '⏳ Pendiente de Revisión' : '⏳ Pending Review'}</option>
                                    <option value="reviewed">{isEs ? '✅ Revisado y Aprobado' : '✅ Reviewed & Approved'}</option>
                                    <option value="action_needed">{isEs ? '⚠️ Requiere Plan de Acción' : '⚠️ Action Plan Required'}</option>
                                </select>
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider mb-2">
                                    {isEs ? 'Confidencialidad' : 'Confidentiality'}
                                </label>
                                <div className="px-4 py-2.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-sm font-semibold text-slate-600 dark:text-slate-300">
                                    {evaluation.is_confidential
                                        ? (isEs ? '🔒 Solo Dirección General y RRHH' : '🔒 HR & Executive Only')
                                        : (isEs ? '👥 Visible para Gerencia de Tienda' : '👥 Visible to Store Management')}
                                </div>
                            </div>
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider mb-2">
                                {isEs ? 'Observaciones del Supervisor / Gerencia' : 'Supervisor / Management Observations'}
                            </label>
                            <textarea
                                value={adminObs}
                                onChange={e => setAdminObs(e.target.value)}
                                rows={3}
                                placeholder={isEs ? 'Escribe aquí acuerdos con el empleado, metas para el siguiente periodo o justificación salarial...' : 'Record coaching agreements, next review goals, or salary merit notes...'}
                                className="w-full p-3 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-sm text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-red-600 resize-none font-medium"
                            />
                        </div>

                        <div className="flex items-center justify-between pt-2">
                            <div>
                                {savedSuccess && (
                                    <span className="text-xs font-black text-emerald-600 dark:text-emerald-400 animate-in fade-in">
                                        ✓ {isEs ? '¡Dictamen guardado exitosamente!' : 'Review saved successfully!'}
                                    </span>
                                )}
                            </div>
                            <button
                                type="button"
                                onClick={handleSaveReview}
                                disabled={saving}
                                className="px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl shadow-md transition-all flex items-center gap-2 text-sm disabled:opacity-50"
                            >
                                {saving ? (
                                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                ) : (
                                    <Save size={16} />
                                )}
                                <span>{isEs ? 'Guardar Dictamen' : 'Save Review'}</span>
                            </button>
                        </div>
                    </div>
                </div>

                {/* MODAL FOOTER */}
                <div className="p-4 sm:p-5 bg-slate-50 dark:bg-slate-850 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 print:hidden">
                    <span>
                        Tacos Gavilan • {isEs ? 'Sistema Corporativo de Evaluación STAFF' : 'Corporate STAFF Evaluation System'}
                    </span>
                    <button
                        onClick={onClose}
                        className="px-4 py-2 rounded-xl bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-white font-bold hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors"
                    >
                        {isEs ? 'Cerrar' : 'Close'}
                    </button>
                </div>
            </div>

            {/* FULL PHOTO VIEWER MODAL */}
            {selectedPhoto && (
                <div className="fixed inset-0 z-[60] bg-black/90 flex items-center justify-center p-4">
                    <button
                        onClick={() => setSelectedPhoto(null)}
                        className="absolute top-4 right-4 p-3 bg-white/10 hover:bg-white/20 text-white rounded-full transition-colors"
                    >
                        <X size={24} />
                    </button>
                    <img
                        src={selectedPhoto}
                        alt="Evidencia Ampliada"
                        className="max-w-full max-h-[90vh] object-contain rounded-2xl shadow-2xl"
                    />
                </div>
            )}
        </div>
    )
}
