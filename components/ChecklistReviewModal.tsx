'use client'

import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { formatDateLA } from '@/lib/checklistPermissions'
import { getManagerQuestionText, getAssistantQuestionText, getChecklistTitle } from '@/lib/legacyQuestions'
import { getSupabaseClient } from '@/lib/supabase'
import { useDynamicChecklist } from '@/hooks/useDynamicChecklist'
import {
    ClipboardCheck,
    Clock,
    User,
    X,
    Camera,
    MessageSquare,
    CheckCircle,
    AlertCircle,
    FileText,
    Star,
    Calendar,
    Timer,
    Thermometer,
    Sunrise,
    Moon,
    MapPin,
    Award,
    XCircle,
    Send,
    History,
    Printer
} from 'lucide-react'
import '@/app/checklists/checklists.css'

interface ChecklistReviewModalProps {
    isOpen: boolean
    onClose: () => void
    checklist: any
    currentUser: { id: string | number, role: string, name: string, email: string }
    onUpdate: () => void
}

// Gradient configs per checklist type
const TYPE_THEMES: Record<string, { gradient: string, accent: string, icon: any, label: string }> = {
    'temperaturas': { gradient: 'from-red-500 to-orange-400', accent: 'orange', icon: Thermometer, label: 'Control de Temperaturas' },
    'daily': { gradient: 'from-blue-600 to-indigo-500', accent: 'indigo', icon: ClipboardCheck, label: 'Checklist Diario' },
    'apertura': { gradient: 'from-emerald-500 to-teal-400', accent: 'teal', icon: Sunrise, label: 'Checklist de Apertura' },
    'cierre': { gradient: 'from-purple-500 to-pink-400', accent: 'pink', icon: Moon, label: 'Checklist de Cierre' },
    'recorrido': { gradient: 'from-cyan-500 to-blue-400', accent: 'blue', icon: MapPin, label: 'Recorrido de Tienda' },
    'sobrante': { gradient: 'from-amber-500 to-yellow-400', accent: 'yellow', icon: Award, label: 'Producto Sobrante' },
    'manager': { gradient: 'from-slate-600 to-gray-500', accent: 'gray', icon: User, label: 'Checklist de Manager' },
    'supervisor': { gradient: 'from-violet-600 to-purple-500', accent: 'purple', icon: Star, label: 'Inspección de Supervisor' },
}

const STATUS_CONFIG: Record<string, { bg: string, text: string, border: string, icon: any, label: string }> = {
    'pendiente': { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-300', icon: Clock, label: 'Pendiente' },
    'aprobado': { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-300', icon: CheckCircle, label: 'Aprobado' },
    'rechazado': { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-300', icon: XCircle, label: 'Rechazado' },
    'cerrado': { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-300', icon: ClipboardCheck, label: 'Cerrado' },
}

// Animated Score Gauge Component
function ScoreGauge({ score, size = 120 }: { score: number, size?: number }) {
    const radius = (size - 16) / 2
    const circumference = 2 * Math.PI * radius
    const offset = circumference - (score / 100) * circumference

    const getColor = () => {
        if (score >= 80) return { stroke: '#10b981', bg: 'from-emerald-400 to-green-500', text: 'text-emerald-600' }
        if (score >= 60) return { stroke: '#f59e0b', bg: 'from-amber-400 to-orange-500', text: 'text-amber-600' }
        return { stroke: '#ef4444', bg: 'from-red-400 to-rose-500', text: 'text-red-600' }
    }

    const colors = getColor()

    return (
        <div className="relative" style={{ width: size, height: size }}>
            <svg className="transform -rotate-90" width={size} height={size}>
                <circle
                    cx={size / 2}
                    cy={size / 2}
                    r={radius}
                    fill="none"
                    stroke="#e5e7eb"
                    strokeWidth="8"
                />
                <motion.circle
                    cx={size / 2}
                    cy={size / 2}
                    r={radius}
                    fill="none"
                    stroke={colors.stroke}
                    strokeWidth="8"
                    strokeLinecap="round"
                    strokeDasharray={circumference}
                    initial={{ strokeDashoffset: circumference }}
                    animate={{ strokeDashoffset: offset }}
                    transition={{ duration: 1, ease: "easeOut" }}
                />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
                <motion.span
                    className={`text-3xl font-black ${colors.text}`}
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ delay: 0.5, type: "spring" }}
                >
                    {score}%
                </motion.span>
                <span className="text-xs text-gray-400 font-medium">Score</span>
            </div>
        </div>
    )
}

export default function ChecklistReviewModal({ isOpen, onClose, checklist, currentUser, onUpdate }: ChecklistReviewModalProps) {
    const [activeTab, setActiveTab] = useState<'answers' | 'photos'>('answers')
    const [reviewComment, setReviewComment] = useState('')
    const [saving, setSaving] = useState(false)

    const type = checklist?.checklist_type || (checklist?.inspector_id ? 'supervisor' : 'daily')
    const theme = TYPE_THEMES[type] || TYPE_THEMES['daily']
    const ThemeIcon = theme.icon

    const getTemplateCode = (t: string) => {
        switch (t) {
            case 'daily': return 'daily_checklist_v1'
            case 'apertura': return 'apertura_v1'
            case 'cierre': return 'cierre_v1'
            case 'recorrido': return 'recorrido_v1'
            case 'sobrante': return 'sobrante_v1'
            case 'temperaturas': return 'temperaturas_v1'
            case 'manager': return 'manager_checklist_v1'
            case 'supervisor': return 'supervisor_inspection_v1'
            default: return null
        }
    }

    const templateCode = getTemplateCode(type)
    const { data: template, loading: templateLoading } = useDynamicChecklist(templateCode || '')
    const questionPhotosMap = checklist?.answers?.['__question_photos'] || {}

    const handlePrint = () => {
        window.print()
    }

    // -- MOVE HELPERS HERE --
    const getTempValidation = (questionText: string, value: number, sectionTitle?: string) => {
        const textToCheck = `${questionText} ${sectionTitle || ''}`.toLowerCase()
        const isRefrig = textToCheck.includes('refrig') || textToCheck.includes('frio')
        const isValid = isRefrig ? (value >= 34 && value <= 41) : (value >= 165)
        return { isValid, isRefrig }
    }

    const renderAnswerValue = (question: any, rawValue: any, sectionTitle?: string) => {
        let value = rawValue
        if (value && typeof value === 'object' && value.value !== undefined) {
            value = value.value
        }
        const displayValue = String(value ?? 'N/A')
        const numValue = Number(value)

        if (type === 'supervisor' && !isNaN(numValue) && value !== null && value !== '' && value !== undefined) {
            if (numValue === 100) {
                return (
                    <span className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-emerald-100 text-emerald-700 font-bold text-xs border border-emerald-200">
                        <CheckCircle size={14} /> CUMPLE
                    </span>
                )
            }
            if (numValue === 60) {
                return (
                    <span className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-amber-100 text-amber-700 font-bold text-xs border border-amber-200">
                        <AlertCircle size={14} /> CUMPLE PARCIAL
                    </span>
                )
            }
            if (numValue === 0) {
                return (
                    <span className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-red-100 text-red-700 font-bold text-xs border border-red-200">
                        <XCircle size={14} /> NO CUMPLE
                    </span>
                )
            }
        }

        if (type === 'temperaturas' && !isNaN(numValue) && value !== null && value !== '') {
            const { isValid } = getTempValidation(question.text, numValue, sectionTitle)
            return (
                <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border-2 font-bold text-sm ${isValid
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                    : 'bg-red-50 text-red-700 border-red-300'
                    }`}>
                    <span>{displayValue}°F</span>
                    {isValid ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
                </div>
            )
        }

        const upperVal = displayValue.toUpperCase()
        if (upperVal === 'SI' || upperVal === 'SÍ') {
            return (
                <span className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-emerald-100 text-emerald-700 font-bold text-xs border border-emerald-200">
                    <CheckCircle size={14} /> SÍ
                </span>
            )
        }
        if (upperVal === 'NO') {
            return (
                <span className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-red-100 text-red-700 font-bold text-xs border border-red-200">
                    <XCircle size={14} /> NO
                </span>
            )
        }
        if (upperVal === 'N/A' || upperVal === 'NA') {
            return (
                <span className="px-3 py-1 rounded-lg bg-gray-100 text-gray-500 font-bold text-xs border border-gray-200">
                    N/A
                </span>
            )
        }

        if (type === 'sobrante' && !isNaN(numValue) && value !== null && value !== '') {
            const isAlarm = numValue > 2
            return (
                <span className={`flex items-center gap-1.5 px-3 py-1 rounded-lg font-semibold text-sm border ${isAlarm
                    ? 'bg-red-50 text-red-700 border-red-200 animate-pulse'
                    : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    }`}>
                    {displayValue} Lbs {isAlarm && <AlertCircle size={14} />}
                </span>
            )
        }

        return (
            <span className="px-3 py-1 rounded-lg bg-gray-100 text-gray-700 font-semibold text-sm border border-gray-200">
                {displayValue}{type === 'sobrante' && !isNaN(numValue) && value !== null && value !== '' ? ' Lbs' : ''}
            </span>
        )
    }
    // -- END HELPERS --

    // Dynamic Score Calculation (especially for Sobrantes/Temperaturas with rules changing)
    const finalScore = useMemo(() => {
        if (!template || !checklist) return checklist?.score || checklist?.overall_score || 0
        if (type !== 'sobrante' && type !== 'temperaturas') return checklist?.score || checklist?.overall_score || 0

        const allQuestions = template.sections.flatMap((s: any) =>
            s.questions.map((q: any) => ({ ...q, sectionTitle: s.title }))
        )
        if (allQuestions.length === 0) return 0

        let validCount = 0
        let capturedCount = 0

        allQuestions.forEach((q: any) => {
            let value: any = undefined
            if (checklist.answers?.[q.id] !== undefined) value = checklist.answers[q.id]
            else if (checklist.answers?.[q.text] !== undefined) value = checklist.answers[q.text]
            else {
                const questionWords = q.text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter((w: string) => w.length > 2)
                for (const key of Object.keys(checklist.answers || {})) {
                    if (key === '__question_photos') continue
                    const keyLower = key.toLowerCase()
                    const matchCount = questionWords.filter((w: string) => keyLower.includes(w)).length
                    if (matchCount >= 2 || (questionWords.length === 1 && matchCount === 1)) {
                        value = checklist.answers[key]
                        break
                    }
                }
            }

            const numVal = Number(value)
            const isCaptured = !isNaN(numVal) && value !== null && value !== '' && value !== undefined

            if (isCaptured) {
                capturedCount++
                if (type === 'sobrante') {
                    if (numVal <= 2) validCount++
                } else if (type === 'temperaturas') {
                    const { isValid } = getTempValidation(q.text, numVal, q.sectionTitle)
                    if (isValid) validCount++
                }
            } else {
                // For scoring, non-captured items in new templates act as neutral or pending
                // but if and only if they were never answered.
                // However, for sobrante we previously did 'withinLimit++'.
                // Let's stick to (Valid / Captured) for Temperatures, and (<=2 / Total) for Sobrante as requested.
                if (type === 'sobrante') validCount++
            }
        })

        if (type === 'temperaturas') {
            return capturedCount === 0 ? 100 : Math.round((validCount / capturedCount) * 100)
        }
        return Math.round((validCount / allQuestions.length) * 100)
    }, [template, checklist, type])

    // Identify answers that were NOT matched by any template question (Legacy Data)
    const orphanedAnswers = useMemo(() => {
        if (!template || !checklist?.answers) return []
        const usedKeys = new Set<string>()
        const allQuestions = template.sections.flatMap((s: any) => s.questions)

        allQuestions.forEach((q: any) => {
            // Check direct ID or Text match
            if (checklist.answers[q.id] !== undefined) { usedKeys.add(q.id); return }
            if (checklist.answers[q.text] !== undefined) { usedKeys.add(q.text); return }

            // Check Fuzzy logic (mirroring the render loop)
            const questionWords = q.text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter((w: string) => w.length > 2)
            for (const key of Object.keys(checklist.answers)) {
                if (key === '__question_photos') continue
                const keyLower = key.toLowerCase().replace(/\(lbs\)/g, '').trim()
                const matchCount = questionWords.filter((w: string) => keyLower.includes(w)).length
                if (matchCount >= 2 || (questionWords.length === 1 && matchCount === 1)) {
                    usedKeys.add(key)
                    break
                }
            }
        })

        return Object.keys(checklist.answers).filter(key =>
            key !== '__question_photos' && !usedKeys.has(key) && checklist.answers[key] !== undefined && checklist.answers[key] !== null
        )
    }, [template, checklist])

    const getEmbeddableImageUrl = (url: string) => {
        if (!url) return ''
        if (url.includes('lh3.googleusercontent.com')) return url
        try {
            let id = ''
            const idMatch = url.match(/[?&]id=([a-zA-Z0-9_-]+)/)
            if (idMatch) id = idMatch[1]
            else if (url.includes('/file/d/')) {
                const parts = url.split('/file/d/')
                if (parts.length > 1) id = parts[1].split('/')[0]
            }
            if (id) return `https://lh3.googleusercontent.com/d/${id}`
        } catch (e) {
            console.error('Error parseando URL de Drive:', e)
        }
        return url
    }

    const getDuration = () => {
        if (!checklist?.start_time || !checklist?.end_time) return 'N/A'
        try {
            const startParts = checklist.start_time.split(':').map(Number)
            const endParts = checklist.end_time.split(':').map(Number)
            if (startParts.length < 2 || endParts.length < 2) return `${checklist.start_time} - ${checklist.end_time}`
            const startMinutes = startParts[0] * 60 + startParts[1]
            const endMinutes = endParts[0] * 60 + endParts[1]
            let diff = endMinutes - startMinutes
            if (diff < 0) diff += 24 * 60
            const hours = Math.floor(diff / 60)
            const mins = diff % 60
            return hours > 0 ? `${hours}h ${mins}m` : `${mins} min`
        } catch (e) {
            return `${checklist.start_time} - ${checklist.end_time}`
        }
    }

    const role = currentUser?.role?.toLowerCase() || ''
    const status = (checklist?.estatus_manager || 'pendiente').toLowerCase()
    const supervisorStatus = (checklist?.estatus_supervisor || 'pendiente').toLowerCase()
    const isOwner = checklist && currentUser && String(checklist.user_id) === String(currentUser.id)
    const statusConfig = STATUS_CONFIG[status] || STATUS_CONFIG['pendiente']
    const StatusIcon = statusConfig.icon

    const canApprove =
        (type !== 'manager' && (
            (['manager', 'admin'].includes(role) && status !== 'aprobado') ||
            (role === 'supervisor' && status === 'aprobado' && (!checklist?.estatus_admin || checklist.estatus_admin === 'pendiente'))
        )) ||
        (type === 'manager' && (role === 'supervisor' || role === 'admin') && supervisorStatus !== 'aprobado')

    const canReject =
        (type !== 'manager' && (
            (['manager', 'admin'].includes(role) && status !== 'aprobado' && status !== 'rechazado') ||
            (role === 'supervisor' && status === 'aprobado')
        )) ||
        (type === 'manager' && (role === 'supervisor' || role === 'admin') && supervisorStatus !== 'aprobado' && supervisorStatus !== 'rechazado')

    const canClose = role === 'asistente' && isOwner && status === 'rechazado'
    const canSupervisorFinalApprove = role === 'supervisor' && type !== 'manager' && (status === 'cerrado' || status === 'aprobado')

    const handleStatusChange = async (newStatus: string) => {
        if ((newStatus === 'rechazado' || newStatus === 'cerrado') && !reviewComment.trim()) {
            alert('Por favor agrega un comentario para justificar esta acción.')
            return
        }

        const tableName = type === 'supervisor' ? 'supervisor_inspections' :
            type === 'manager' ? 'manager_checklists' :
                'assistant_checklists'

        setSaving(true)
        try {
            const supabase = await getSupabaseClient()
            const updates: any = {}

            if (tableName === 'assistant_checklists') {
                updates.estatus_manager = newStatus
                if (role === 'manager') {
                    updates.reviso_manager = currentUser.name || currentUser.email
                    updates.fecha_revision_manager = new Date().toISOString()
                    updates.comentarios_manager = reviewComment
                } else if (role === 'supervisor' || role === 'admin') {
                    updates.estatus_admin = newStatus
                    updates.reviso_admin = currentUser.name || currentUser.email
                    updates.fecha_revision_admin = new Date().toISOString()
                    updates.comentarios_admin = reviewComment
                }
            } else if (tableName === 'supervisor_inspections') {
                updates.estatus_admin = newStatus
                updates.reviso_admin = currentUser.name || currentUser.email
                updates.fecha_revision_admin = new Date().toISOString()
                updates.comentarios_admin = reviewComment
            } else if (tableName === 'manager_checklists') {
                const suffix = role === 'admin' ? 'admin' : 'supervisor'
                updates[`estatus_${suffix}`] = newStatus
                updates[`reviso_${suffix}`] = currentUser.name || currentUser.email
                updates[`fecha_revision_${suffix}`] = new Date().toISOString()
                updates[`comentarios_${suffix}`] = reviewComment
            }

            if (role === 'asistente' && tableName === 'assistant_checklists') {
                updates.estatus_manager = 'cerrado'
                updates.comments = checklist.comments ? `${checklist.comments}\n[${formatDateLA(new Date())}] Asistente: ${reviewComment}` : reviewComment
            }

            const { error } = await supabase.from(tableName).update(updates).eq('id', checklist.id)
            if (error) throw error

            if (newStatus === 'rechazado' && tableName === 'manager_checklists') {
                await supabase.from('notifications').insert({
                    user_id: checklist.user_id,
                    title: 'Checklist de Manager RECHAZADO',
                    message: `Tu checklist ha sido rechazado por ${currentUser.name || 'Supervisor'}.`,
                    link: '/checklists-manager',
                    resource_id: checklist.id,
                    type: 'alert'
                })
            }

            alert(`Checklist actualizado a: ${newStatus.toUpperCase()}`)
            onUpdate()
            onClose()
        } catch (e: any) {
            console.error(e)
            alert('Error al actualizar: ' + e.message)
        } finally {
            setSaving(false)
        }
    }

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[9999] flex items-end md:items-center justify-center p-0 md:p-4"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                >
                    <motion.div
                        className="bg-white rounded-t-3xl md:rounded-3xl shadow-2xl w-full max-w-6xl h-[90vh] md:h-[90vh] flex flex-col md:flex-row overflow-hidden relative"
                        initial={{ y: "100%" }}
                        animate={{ y: 0 }}
                        exit={{ y: "100%" }}
                        transition={{ type: "spring", damping: 25, stiffness: 200 }}
                    >
                        {/* MOBILE CLOSE HANDLE */}
                        <div className="md:hidden w-full flex justify-center pt-3 pb-1 bg-gray-50 border-b border-gray-100 flex-shrink-0 cursor-grab active:cursor-grabbing" onClick={onClose}>
                            <div className="w-16 h-1.5 bg-gray-300 rounded-full"></div>
                        </div>

                        {/* LEFT PANEL - Fixed Info & Actions */}
                        <div className="w-full md:w-[340px] flex-shrink-0 flex flex-col bg-gray-50 border-r border-gray-200 overflow-y-auto md:overflow-visible max-h-[40vh] md:max-h-full">
                            {/* Gradient Header */}
                            <div className={`bg-gradient-to-br ${theme.gradient} p-6 text-white sticky top-0 z-10`}>
                                <div className="flex items-start justify-between mb-4">
                                    <div className="flex items-center gap-3">
                                        <div className="w-12 h-12 bg-white/20 backdrop-blur rounded-xl flex items-center justify-center">
                                            <ThemeIcon size={24} />
                                        </div>
                                        <div>
                                            <p className="text-xs font-medium opacity-80 uppercase tracking-wider">{theme.label}</p>
                                            <h2 className="text-lg font-bold leading-tight">{checklist.store_name}</h2>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <button onClick={handlePrint} className="p-2 hover:bg-white/20 rounded-full transition text-white/80 hover:text-white" title="Imprimir / Guardar PDF">
                                            <Printer size={22} />
                                        </button>
                                        <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-full transition text-white/80 hover:text-white">
                                            <X size={24} />
                                        </button>
                                    </div>
                                </div>

                                {/* Status Badge */}
                                <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full ${statusConfig.bg} ${statusConfig.text} ${statusConfig.border} border font-bold text-xs`}>
                                    <StatusIcon size={14} />
                                    {statusConfig.label.toUpperCase()}
                                </div>
                            </div>

                            {/* Score Gauge */}
                            <div className="flex justify-center py-6 border-b border-gray-200 bg-gray-50">
                                <ScoreGauge score={finalScore} />
                            </div>

                            {/* Metadata */}
                            <div className="p-4 space-y-3 border-b border-gray-200 bg-gray-50 text-xs md:text-sm">
                                <div className="flex items-center gap-3 text-gray-600">
                                    <User size={16} className="text-gray-400" />
                                    <span className="font-medium">{checklist.users?.full_name || checklist.user_name || checklist.supervisor_name || 'N/A'}</span>
                                </div>
                                <div className="flex items-center gap-3 text-gray-600">
                                    <Calendar size={16} className="text-gray-400" />
                                    <span className="font-medium">{formatDateLA(checklist.checklist_date || checklist.inspection_date)}</span>
                                </div>
                                {(checklist.start_time || checklist.inspection_time) && (
                                    <div className="flex items-center gap-3 text-gray-600">
                                        <Clock size={16} className="text-gray-400" />
                                        <span className="font-medium">{checklist.shift === 'AM' ? '🌅 AM' : '🌙 PM'} • {checklist.inspection_time || checklist.start_time}</span>
                                    </div>
                                )}
                            </div>

                            {/* Review Actions - Only visible if actionable */}
                            {(canApprove || canReject || canClose || canSupervisorFinalApprove) && (
                                <div className="p-4 flex-1 flex flex-col bg-gray-50">
                                    <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                                        <MessageSquare size={14} /> Revisión
                                    </h3>
                                    <textarea
                                        value={reviewComment}
                                        onChange={(e) => setReviewComment(e.target.value)}
                                        placeholder="Agregar comentario..."
                                        className="w-full p-3 border border-gray-200 rounded-xl text-sm resize-none h-24 focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 transition bg-white text-gray-800"
                                    />

                                    <div className="mt-4 space-y-2">
                                        {(canApprove || canSupervisorFinalApprove) && (
                                            <button
                                                onClick={() => handleStatusChange('aprobado')}
                                                disabled={saving}
                                                className="w-full flex items-center justify-center gap-2 py-3 bg-gradient-to-r from-emerald-500 to-green-500 hover:from-emerald-600 hover:to-green-600 text-white font-bold rounded-xl shadow-lg shadow-emerald-100 transition disabled:opacity-50"
                                            >
                                                <CheckCircle size={18} /> Aprobar
                                            </button>
                                        )}
                                        {canReject && (
                                            <button
                                                onClick={() => handleStatusChange('rechazado')}
                                                disabled={saving}
                                                className="w-full flex items-center justify-center gap-2 py-3 bg-gradient-to-r from-red-500 to-rose-500 hover:from-red-600 hover:to-rose-600 text-white font-bold rounded-xl shadow-lg shadow-red-100 transition disabled:opacity-50"
                                            >
                                                <XCircle size={18} /> Rechazar
                                            </button>
                                        )}
                                        {canClose && (
                                            <button
                                                onClick={() => handleStatusChange('cerrado')}
                                                disabled={saving}
                                                className="w-full flex items-center justify-center gap-2 py-3 bg-gradient-to-r from-purple-500 to-violet-500 hover:from-purple-600 hover:to-violet-600 text-white font-bold rounded-xl shadow-lg shadow-purple-100 transition disabled:opacity-50"
                                            >
                                                <Send size={18} /> Cerrar Ticket
                                            </button>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* RIGHT PANEL - Scrollable Content */}
                        <div className="flex-1 flex flex-col min-h-0 bg-white h-full relative z-0">
                            {/* Desktop Close Button */}
                            <div className="hidden md:flex justify-end p-4 border-b border-gray-100 absolute top-0 right-0 z-20">
                                <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
                                    <X size={22} className="text-gray-400" />
                                </button>
                            </div>

                            {/* Tabs */}
                            <div className="flex gap-2 px-6 py-3 border-b border-gray-100 shrink-0 sticky top-0 bg-white z-10 overflow-x-auto">
                                <button
                                    onClick={() => setActiveTab('answers')}
                                    className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold transition whitespace-nowrap ${activeTab === 'answers'
                                        ? `bg-gradient-to-r ${theme.gradient} text-white shadow-lg`
                                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                        }`}
                                >
                                    <FileText size={16} /> <span className="hidden sm:inline">Respuestas</span>
                                </button>
                                <button
                                    onClick={() => setActiveTab('photos')}
                                    className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold transition whitespace-nowrap ${activeTab === 'photos'
                                        ? `bg-gradient-to-r ${theme.gradient} text-white shadow-lg`
                                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                        }`}
                                >
                                    <Camera size={16} /> <span className="hidden sm:inline">Evidencias</span>
                                </button>
                            </div>

                            {/* Content */}
                            <div className="flex-1 overflow-y-auto p-4 md:p-6 pb-20 md:pb-6">
                                {activeTab === 'answers' && (
                                    <div className="space-y-6">
                                        {templateLoading ? (
                                            <div className="flex justify-center py-20">
                                                <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
                                            </div>
                                        ) : template ? (
                                            template.sections.map((section: any) => (
                                                <div key={section.id} className="bg-gray-50 rounded-2xl p-4 md:p-5 border border-gray-100">
                                                    <h3 className="text-xs md:text-sm font-bold text-gray-500 uppercase tracking-wider mb-4 pb-2 border-b border-gray-200">
                                                        {section.title}
                                                    </h3>
                                                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                                                        {section.questions.map((q: any) => {
                                                            // COMPREHENSIVE ANSWER LOOKUP WITH FALLBACK
                                                            let value: any = undefined

                                                            // Strategy 1: Direct ID match (for new dynamic templates)
                                                            if (checklist.answers?.[q.id] !== undefined && checklist.answers?.[q.id] !== null) {
                                                                value = checklist.answers[q.id]
                                                            }

                                                            // Strategy 2: Direct text match (for legacy templates stored by question text)
                                                            if ((value === undefined || value === null) && checklist.answers?.[q.text] !== undefined) {
                                                                value = checklist.answers[q.text]
                                                            }

                                                            // Strategy 3: Fuzzy match on old descriptive IDs (e.g. "refrig1_papelitos_mayo")
                                                            // This is critical for old checklists created before template refactoring
                                                            if ((value === undefined || value === null) && checklist.answers) {
                                                                // Convert question text to potential old ID format
                                                                // "Refrig 1 - Papelitos con mayo" -> look for keys containing "refrig" and "papelito"
                                                                const questionWords = q.text.toLowerCase()
                                                                    .replace(/[^a-z0-9\s]/g, '') // Remove special chars
                                                                    .split(/\s+/)
                                                                    .filter((w: string) => w.length > 2) // Only keep meaningful words

                                                                // Try to find answer key that matches these words
                                                                for (const answerKey of Object.keys(checklist.answers)) {
                                                                    if (answerKey === '__question_photos') continue

                                                                    // Resolve the answer key to its text representation if possible
                                                                    let keyText = answerKey
                                                                    const answerVal = checklist.answers[answerKey]

                                                                    // Handle Supervisor Nested Structure
                                                                    if (type === 'supervisor' && answerVal && typeof answerVal === 'object' && answerVal.items) {
                                                                        // If it's a supervisor section object, look inside its items
                                                                        for (const subKey of Object.keys(answerVal.items)) {
                                                                            const subItem = answerVal.items[subKey]
                                                                            const subLabel = subItem.label || subKey

                                                                            // Fuzzy match the sub-item label against current question text
                                                                            const subLabelLower = subLabel.toLowerCase()
                                                                            const subMatchCount = questionWords.filter((word: string) =>
                                                                                subLabelLower.includes(word)
                                                                            ).length

                                                                            if (subMatchCount >= 2) {
                                                                                value = subItem.score !== undefined ? subItem.score : subItem
                                                                                break
                                                                            }
                                                                        }
                                                                        if (value !== undefined) break
                                                                        continue // Skip top-level matching for section objects
                                                                    }

                                                                    if (type === 'manager') {
                                                                        keyText = getManagerQuestionText(answerKey)
                                                                    } else {
                                                                        // For daily/recorrido/etc
                                                                        keyText = getAssistantQuestionText(type, answerKey)
                                                                    }

                                                                    const keyLower = keyText.toLowerCase()
                                                                        .replace(/\(lbs\)/g, '') // Clean units for better matching
                                                                        .trim()

                                                                    // Check if key contains significant words from the question
                                                                    const matchCount = questionWords.filter((word: string) =>
                                                                        keyLower.includes(word) && word.length > 2
                                                                    ).length

                                                                    // If at least 2 significant words match or 100% of small questions (like ChecklistForm)
                                                                    if (matchCount >= 2 || (questionWords.length === 1 && matchCount === 1)) {
                                                                        value = checklist.answers[answerKey]
                                                                        break
                                                                    }
                                                                }
                                                            }

                                                            const qPhotos = questionPhotosMap[q.id] || []

                                                            return (
                                                                <div key={q.id} className="bg-white p-3 md:p-4 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
                                                                    <div className="flex justify-between items-start gap-3">
                                                                        <span className="text-xs md:text-sm text-gray-700 leading-snug flex-1 font-medium">{q.text}</span>
                                                                        <div className="shrink-0">{renderAnswerValue(q, value, section.title)}</div>
                                                                    </div>
                                                                    {qPhotos.length > 0 && (
                                                                        <div className="mt-3 flex gap-2 overflow-x-auto pb-1 no-scrollbar">
                                                                            {qPhotos.map((url: string, idx: number) => (
                                                                                <a key={idx} href={url} target="_blank" rel="noopener noreferrer" className="flex-none w-12 h-12 md:w-14 md:h-14 rounded-lg overflow-hidden border border-gray-200 hover:scale-105 transition-transform">
                                                                                    <img src={getEmbeddableImageUrl(url)} alt="Evidence" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                                                                                </a>
                                                                            ))}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            )
                                                        })}
                                                    </div>
                                                </div>
                                            ))
                                        ) : null}

                                        {/* SECTION FOR ORPHANED / LEGACY DATA (Answers found in DB but not in current template) */}
                                        {orphanedAnswers.length > 0 && (
                                            <div className="bg-amber-50 rounded-2xl p-4 md:p-5 border border-amber-100 mt-6">
                                                <div className="flex items-center gap-2 mb-4 pb-2 border-b border-amber-200">
                                                    <History size={16} className="text-amber-600" />
                                                    <h3 className="text-xs md:text-sm font-bold text-amber-700 uppercase tracking-wider">
                                                        Información Histórica (Preguntas Anteriores)
                                                    </h3>
                                                </div>
                                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                                                    {orphanedAnswers.map((key) => {
                                                        const rawValue = checklist.answers[key]
                                                        const qPhotos = questionPhotosMap[key] || []

                                                        return (
                                                            <div key={key} className="bg-white p-3 md:p-4 rounded-xl border border-amber-100 hover:shadow-md transition-shadow">
                                                                <div className="flex justify-between items-start gap-3">
                                                                    <span className="text-xs md:text-sm text-gray-700 leading-snug flex-1 font-medium">{key}</span>
                                                                    <div className="shrink-0">{renderAnswerValue({ text: key }, rawValue)}</div>
                                                                </div>
                                                                {qPhotos.length > 0 && (
                                                                    <div className="mt-3 flex gap-2 overflow-x-auto pb-1 no-scrollbar">
                                                                        {qPhotos.map((url: string, idx: number) => (
                                                                            <a key={idx} href={url} target="_blank" rel="noopener noreferrer" className="flex-none w-12 h-12 md:w-14 md:h-14 rounded-lg overflow-hidden border border-gray-200">
                                                                                <img src={getEmbeddableImageUrl(url)} alt="Evidence" className="w-full h-full object-cover" />
                                                                            </a>
                                                                        ))}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        )
                                                    })}
                                                </div>
                                            </div>
                                        )}

                                        {/* Comments Section */}
                                        {(checklist.comments || checklist.observaciones) && (
                                            <div className="bg-blue-50 rounded-2xl p-5 border border-blue-100">
                                                <h3 className="text-sm font-bold text-blue-700 uppercase tracking-wider mb-2 flex items-center gap-2">
                                                    <MessageSquare size={16} /> Observaciones
                                                </h3>
                                                <p className="text-blue-800 text-sm italic">"{checklist.comments || checklist.observaciones}"</p>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {activeTab === 'photos' && (
                                    <div className="bg-gray-50 rounded-2xl p-5 border border-gray-100">
                                        {(!checklist.photos || checklist.photos.length === 0) && Object.keys(questionPhotosMap).length === 0 ? (
                                            <div className="text-center py-16">
                                                <Camera size={48} className="mx-auto text-gray-300 mb-4" />
                                                <p className="text-gray-400 font-medium">No hay evidencias fotográficas</p>
                                            </div>
                                        ) : (
                                            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                                                {[...(checklist.photos || []), ...Object.values(questionPhotosMap).flat()].map((url: string, i: number) => (
                                                    <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="aspect-square rounded-xl overflow-hidden border border-gray-200 hover:scale-105 hover:shadow-lg transition-all">
                                                        <img src={getEmbeddableImageUrl(url)} className="w-full h-full object-cover" alt="Evidence" referrerPolicy="no-referrer" />
                                                    </a>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    </motion.div>
                </motion.div>
            )}
            <style jsx global>{`
                @media print {
                    body * {
                        visibility: hidden;
                    }
                    .fixed.inset-0, .fixed.inset-0 * {
                        visibility: visible;
                    }
                    .fixed.inset-0 {
                        position: absolute;
                        left: 0;
                        top: 0;
                        margin: 0;
                        padding: 0;
                        width: 100%;
                        background: white !important;
                    }
                    .rounded-t-3xl, .rounded-3xl {
                        border-radius: 0 !important;
                    }
                    .shadow-2xl, .shadow-lg {
                        box-shadow: none !important;
                    }
                    button, .md\\:hidden, .hidden.md\\:flex {
                        display: none !important;
                    }
                    .max-h-\\[90vh\\], .overflow-y-auto {
                        max-height: none !important;
                        overflow: visible !important;
                    }
                    .flex-col.md\\:flex-row {
                        flex-direction: column !important;
                    }
                    .md\\:w-\\[340px\\] {
                        width: 100% !important;
                        border-right: none !important;
                        border-bottom: 2px solid #eee;
                    }
                    .sticky {
                        position: static !important;
                    }
                    .p-6, .p-8 {
                        padding: 1rem !important;
                    }
                    .bg-gray-50, .bg-white {
                        background: white !important;
                    }
                    .no-scrollbar::-webkit-scrollbar {
                        display: none;
                    }
                }
            `}</style>
        </AnimatePresence>
    )
}
