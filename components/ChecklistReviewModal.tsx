'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { formatDateLA } from '@/lib/checklistPermissions'
import { getManagerQuestionText, getAssistantQuestionText, getChecklistTitle } from '@/lib/legacyQuestions'
import { getSupabaseClient } from '@/lib/supabase'
import { useDynamicChecklist } from '@/hooks/useDynamicChecklist'
import {
    Activity,
    AlertCircle,
    Award,
    Calendar,
    Camera,
    CheckCircle,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    ChevronUp,
    ClipboardCheck,
    Clock,
    FileText,
    History,
    MapPin,
    MessageSquare,
    Moon,
    Printer,
    Send,
    Share2,
    Star,
    Store,
    Sunrise,
    Thermometer,
    Timer,
    User,
    X,
    XCircle,
    ZoomIn,
    Sparkles,
    Hash,
    ArrowLeft,
    MoreHorizontal,
    Image as ImageIcon
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
    'recorrido': { gradient: 'from-cyan-500 to-blue-400', accent: 'blue', icon: Store, label: 'Recorrido de Tienda' },
    'sobrante': { gradient: 'from-amber-500 to-yellow-400', accent: 'yellow', icon: Award, label: 'Producto Sobrante' },
    'manager': { gradient: 'from-slate-600 to-gray-500', accent: 'gray', icon: User, label: 'Checklist de Manager' },
    'supervisor': { gradient: 'from-violet-600 to-purple-500', accent: 'purple', icon: Star, label: 'Inspección de Supervisor' },
}

// ... helper components ...




const STATUS_CONFIG: Record<string, { bg: string, text: string, border: string, icon: any, label: string }> = {
    'pendiente': { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-300', icon: Clock, label: 'Pendiente' },
    'aprobado': { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-300', icon: CheckCircle, label: 'Aprobado' },
    'rechazado': { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-300', icon: XCircle, label: 'Rechazado' },
    'cerrado': { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-300', icon: ClipboardCheck, label: 'Cerrado' },
}

const SECTION_SCORES_MAP: Record<string, string> = {
    'Servicio al Cliente': 'service_score',
    'Procedimiento de Carnes': 'meat_score',
    'Preparación de Alimentos': 'food_score',
    'Seguimiento a Tortillas': 'tortilla_score',
    'Limpieza General y Baños': 'cleaning_score',
    'Checklists y Bitácoras': 'log_score',
    'Aseo Personal': 'grooming_score'
}

import { calculateInspectionScore, getNumericValue } from '@/lib/scoreCalculator'

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

const isNew = (dateStr?: string) => {
    if (!dateStr) return false
    const date = new Date(dateStr)
    const now = new Date()
    const diffTime = Math.abs(now.getTime() - date.getTime())
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
    return diffDays <= 180
}

export default function ChecklistReviewModal({ isOpen, onClose, checklist, currentUser, onUpdate }: ChecklistReviewModalProps) {
    const [activeTab, setActiveTab] = useState<'answers' | 'photos'>('answers')
    const [reviewComment, setReviewComment] = useState('') // Deprecated for UI but kept for logic compat if needed
    const [saving, setSaving] = useState(false)

    // Chat State
    const [comments, setComments] = useState<any[]>([])
    const [newComment, setNewComment] = useState('')
    const [loadingComments, setLoadingComments] = useState(false)
    const [includeManager, setIncludeManager] = useState(false)
    const [hoveredBtn, setHoveredBtn] = useState<string | null>(null)
    const [managerName, setManagerName] = useState<string | null>(null)
    const [managerId, setManagerId] = useState<string | null>(null) // State for ID
    const [chatOpen, setChatOpen] = useState(false) // Floating Chat State
    const chatContainerRef = useRef<HTMLDivElement>(null)

    // Image Viewer State
    const [viewerOpen, setViewerOpen] = useState(false)
    const [currentImageIndex, setCurrentImageIndex] = useState(0)
    const [galleryImages, setGalleryImages] = useState<string[]>([])

    // Helper for Drive Images
    const getEmbeddableImageUrl = (url: string) => {
        if (!url) return ''
        if (url.includes('lh3.googleusercontent.com')) return url

        try {
            let id = ''
            const idMatch = url.match(/[?&]id=([a-zA-Z0-9_-]+)/)
            if (idMatch) {
                id = idMatch[1]
            } else if (url.includes('/file/d/')) {
                const parts = url.split('/file/d/')
                if (parts.length > 1) {
                    id = parts[1].split('/')[0]
                }
            }

            if (id) {
                return `https://lh3.googleusercontent.com/d/${id}`
            }
        } catch (e) {
            console.error('Error parsing Drive URL:', e)
        }
        return url
    }

    // Load Data Effect
    useEffect(() => {
        if (isOpen && checklist?.id) {
            fetchComments()
            fetchManagerStatus()
        }
    }, [isOpen, checklist])

    // Keyboard Navigation for Viewer
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (!viewerOpen) return
            if (e.key === 'Escape') setViewerOpen(false)
            if (e.key === 'ArrowRight') nextImage()
            if (e.key === 'ArrowLeft') prevImage()
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [viewerOpen, currentImageIndex, galleryImages])

    // Scroll to bottom effect
    useEffect(() => {
        if (chatContainerRef.current) {
            chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight
        }
    }, [comments, isOpen])

    const fetchComments = async () => {
        setLoadingComments(true)
        const supabase = await getSupabaseClient()
        const { data } = await supabase
            .from('inspection_comments')
            .select('*')
            .eq('inspection_id', checklist.id)
            .order('created_at', { ascending: true })

        if (data) setComments(data)
        setLoadingComments(false)
    }

    const fetchManagerStatus = async () => {
        if (type !== 'supervisor') return
        const supabase = await getSupabaseClient()

        // Fetch current toggle status
        const { data: inspection } = await supabase
            .from('supervisor_inspections')
            .select('notify_manager, store_id')
            .eq('id', checklist.id)
            .single()

        if (inspection) {
            setIncludeManager(!!inspection.notify_manager)

            // Fetch Manager Name based on Store ID
            if (inspection.store_id) {
                const { data: manager } = await supabase
                    .from('users')
                    .select('full_name, id')
                    .eq('store_id', inspection.store_id)
                    .eq('role', 'manager')
                    .single()

                if (manager) {
                    setManagerName(manager.full_name)
                    setManagerId(String(manager.id))
                }
            }
        }
    }

    const handleSendComment = async () => {
        if (!newComment.trim()) return

        // Optimistic UI
        const tempId = Date.now()
        const tempComment = {
            id: tempId,
            inspection_id: checklist.id,
            user_id: currentUser.id,
            user_name: currentUser.name,
            user_role: currentUser.role,
            content: newComment,
            created_at: new Date().toISOString()
        }
        setComments(prev => [...prev, tempComment])
        setNewComment('')

        const supabase = await getSupabaseClient()
        const { error } = await supabase.from('inspection_comments').insert({
            inspection_id: checklist.id,
            user_id: String(currentUser.id), // Ensure string format
            user_name: currentUser.name,
            user_role: currentUser.role,
            content: tempComment.content
        })

        if (error) {
            console.error('Error sending comment:', error)
            alert('Error al enviar mensaje')
            setComments(prev => prev.filter(c => c.id !== tempId)) // Revert
        } else {
            fetchComments() // Refresh for real ID
        }
    }

    const toggleManager = async (checked: boolean) => {
        setIncludeManager(checked)
        const supabase = await getSupabaseClient()
        const { error } = await supabase
            .from('supervisor_inspections')
            .update({ notify_manager: checked })
            .eq('id', checklist.id)

        if (error) {
            console.error('Error updating manager notify:', error)
            setIncludeManager(!checked) // Revert
        }
    }

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
    const answersData = typeof checklist?.answers === 'string' ? JSON.parse(checklist.answers) : (checklist?.answers || {})
    const questionPhotosMap = answersData['__question_photos'] || answersData['question_photos'] || answersData['photos'] || {}

    // Aggregate unique photos from all possible sources
    const allInspectionPhotos = useMemo(() => {
        const photos = new Set<string>()

        // 1. From explicit question photos map
        Object.values(questionPhotosMap).forEach((val: any) => {
            if (Array.isArray(val)) val.forEach(url => photos.add(url))
            else if (typeof val === 'string') photos.add(val)
        })

        // 2. From text-based permanent anchors
        if (answersData['__text_photos']) {
            Object.values(answersData['__text_photos']).forEach((val: any) => {
                if (Array.isArray(val)) val.forEach(url => photos.add(url))
                else if (typeof val === 'string') photos.add(val)
            })
        }

        // 3. Deep search for any 'photos' or 'photo' keys in answers (Legacy/Dynamic mix)
        const deepExtract = (obj: any) => {
            if (!obj || typeof obj !== 'object') return
            if (Array.isArray(obj.photos)) obj.photos.forEach((url: any) => typeof url === 'string' && photos.add(url))
            if (typeof obj.photo === 'string') photos.add(obj.photo)
            Object.values(obj).forEach(deepExtract)
        }
        deepExtract(answersData)

        return Array.from(photos).filter(url => url && typeof url === 'string' && url.length > 10)
    }, [answersData, questionPhotosMap])



    const handlePrint = () => {
        window.print()
    }

    const openViewer = (index: number, images: string[]) => {
        setGalleryImages(images)
        setCurrentImageIndex(index)
        setViewerOpen(true)
    }

    const nextImage = () => {
        setCurrentImageIndex(prev => (prev + 1) % galleryImages.length)
    }

    const prevImage = () => {
        setCurrentImageIndex(prev => (prev - 1 + galleryImages.length) % galleryImages.length)
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
        if (value && typeof value === 'object') {
            if (value.value !== undefined) value = value.value
            else if (value.score !== undefined) value = value.score
            else if (value.response !== undefined) value = value.response
        }
        const displayValue = String(value ?? 'N/A')
        const numValue = Number(value)
        const isAnswered = value !== undefined && value !== '' && value !== null

        // YES/NO TYPE (Blocky Buttons style)
        if (question.type === 'yes_no' || displayValue.toUpperCase() === 'SI' || displayValue.toUpperCase() === 'NO' || displayValue.toUpperCase() === 'NA' || displayValue.toUpperCase() === 'N/A') {
            const valUpper = displayValue.toUpperCase().replace('Í', 'I')
            // Normalizing input to align with button keys
            const target = valUpper === 'SI' ? 'SI' : valUpper === 'NO' ? 'NO' : 'NA'

            return (
                <div className="flex gap-2 min-w-[120px]">
                    {['SI', 'NO', 'NA'].map(opt => {
                        const isActive = target === opt
                        let activeClass = ''
                        if (isActive) {
                            if (opt === 'SI') activeClass = 'bg-green-600 border-green-600 text-white shadow-green-200'
                            else if (opt === 'NO') activeClass = 'bg-red-600 border-red-600 text-white shadow-red-200'
                            else activeClass = 'bg-gray-600 border-gray-600 text-white'
                        } else {
                            // Inactive read-only state
                            activeClass = 'bg-gray-100/80 border-gray-400 text-gray-700 font-bold'
                        }
                        return (
                            <div key={opt} className={`flex-1 py-3 px-2 rounded-xl font-bold text-xs text-center transition-all border-2 ${activeClass}`}>
                                {opt === 'SI' ? 'SÍ' : opt === 'NO' ? 'NO' : 'N/A'}
                            </div>
                        )
                    })}
                </div>
            )
        }

        // RATING 5 (Stars)
        if (question.type === 'rating_5') {
            return (
                <div className="flex items-center gap-1 bg-gray-50 rounded-2xl border border-gray-100 px-2 py-1">
                    {[1, 2, 3, 4, 5].map(val => (
                        <Star
                            key={val}
                            size={16}
                            fill={numValue >= val ? '#facc15' : 'none'}
                            className={numValue >= val ? 'text-yellow-400' : 'text-gray-200'}
                            strokeWidth={3}
                        />
                    ))}
                </div>
            )
        }

        // NPS 10 (Circles)
        if (question.type === 'nps_10') {
            return (
                <div className="flex items-center gap-1">
                    <div
                        className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs shadow-sm border
                        ${numValue >= 9 ? 'bg-green-500 text-white border-green-600' :
                                numValue >= 7 ? 'bg-yellow-500 text-white border-yellow-600' :
                                    'bg-red-500 text-white border-red-600'}`}
                    >
                        {numValue}
                    </div>
                    <span className="text-[10px] font-bold text-gray-400">NPS</span>
                </div>
            )
        }

        // SCORE 100 (Cumple/Parcial/No) - used in Supervisor
        if (type === 'supervisor' && (numValue === 100 || numValue === 60 || numValue === 0)) {
            return (
                <div className="flex gap-1 min-w-[150px]">
                    {[
                        { label: 'CUMPLE', val: 100, color: 'bg-green-500', bgOff: 'bg-green-50' },
                        { label: 'PARCIAL', val: 60, color: 'bg-orange-500', bgOff: 'bg-orange-50' },
                        { label: 'NO', val: 0, color: 'bg-red-500', bgOff: 'bg-red-50' }
                    ].map(opt => {
                        const isSelected = numValue === opt.val
                        return (
                            <div
                                key={opt.val}
                                className={`flex-1 py-2 px-1 rounded-lg flex flex-col items-center justify-center gap-0.5 transition-all text-xs font-bold border-2
                                ${isSelected ? `${opt.color} text-white border-transparent shadow-sm` : 'bg-gray-100 text-gray-500 border-gray-300'}`}
                            >
                                {opt.label}
                            </div>
                        )
                    })}
                </div>
            )
        }

        // TEMPERATURES
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

        // SOBRANTES
        if (type === 'sobrante' && !isNaN(numValue) && value !== null && value !== '') {
            const isAlarm = numValue > 2
            return (
                <div className="relative">
                    <div className={`w-full px-4 py-2 bg-gray-50 border-2 rounded-xl text-gray-900 font-black text-lg transition-all text-center
                        ${isAlarm ? 'border-red-500 bg-red-50' : 'border-emerald-200'}`}>
                        {displayValue} <span className="text-xs font-normal text-gray-500">Lbs</span>
                    </div>
                </div>
            )
        }

        // TEXT / DEFAULT
        if (displayValue && displayValue !== 'undefined' && displayValue !== 'null') {
            return (
                <div className="px-4 py-2 rounded-xl bg-gray-50 text-gray-700 font-medium text-sm border border-gray-200 max-w-[200px] truncate" title={displayValue}>
                    {displayValue}
                </div>
            )
        }

        return <span className="text-gray-300 text-xs italic">Sin respuesta</span>
    }
    // -- END HELPERS --

    // Dynamic Score Calculation (especially for Sobrantes/Temperaturas with rules changing)
    const finalScore = useMemo(() => {
        if (!template || !checklist) return checklist?.score || checklist?.overall_score || 0
        if (type !== 'sobrante' && type !== 'temperaturas' && type !== 'supervisor') return checklist?.score || checklist?.overall_score || 0

        // Supervisor Calculation (Average of Section Averages)
        if (type === 'supervisor') {
            // [FIX] Prioritize Historical Score to match List View (avoid recalculating with new template rules)
            if (checklist.overall_score !== undefined && checklist.overall_score !== null && checklist.overall_score > 0) {
                return checklist.overall_score
            }
            return calculateInspectionScore(checklist, template)
        }

        // Logic for Sobrante/Temperaturas (Flat List)
        const allQuestions = template.sections.flatMap((s: any) =>
            s.questions.map((q: any) => ({ ...q, sectionTitle: s.title }))
        )
        if (allQuestions.length === 0) return 0

        let validCount = 0
        let capturedCount = 0

        allQuestions.forEach((q: any) => {
            let value: any = undefined
            // Helper for flat answers
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

            const numVal = getNumericValue(value)

            if (numVal !== null) {
                capturedCount++
                if (type === 'sobrante') {
                    if (numVal <= 2) validCount++
                } else if (type === 'temperaturas') {
                    const { isValid } = getTempValidation(q.text, numVal, q.sectionTitle)
                    if (isValid) validCount++
                }
            } else {
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
            key !== '__question_photos' && !key.startsWith('__') && !usedKeys.has(key) && checklist.answers[key] !== undefined && checklist.answers[key] !== null
        )
    }, [template, checklist])

    // Removed duplicate getEmbeddableImageUrl


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
    const status = (
        (type === 'supervisor' ? checklist?.estatus_admin :
            type === 'manager' ? (checklist?.estatus_admin || checklist?.estatus_supervisor) :
                checklist?.estatus_manager) || 'pendiente'
    ).toLowerCase()
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
        // Validation: require comment ONLY if rejecting AND no chat history
        // Supervisors can approve/close without comment
        if (newStatus === 'rechazado' && comments.length === 0 && !newComment.trim()) {
            alert('Por favor explica la razón del rechazo en el chat o comentario.')
            return
        }

        const tableName = type === 'supervisor' ? 'supervisor_inspections' :
            type === 'manager' ? 'manager_checklists' :
                'assistant_checklists'

        setSaving(true)
        try {
            // Send pending comment if exists
            if (newComment.trim()) {
                await handleSendComment()
            }

            const supabase = await getSupabaseClient()
            const updates: any = {}
            const lastComment = newComment.trim() || (comments.length > 0 ? comments[comments.length - 1].content : '')

            if (tableName === 'assistant_checklists') {
                updates.estatus_manager = newStatus
                if (role === 'manager') {
                    updates.reviso_manager = currentUser.name || currentUser.email
                    updates.fecha_revision_manager = new Date().toISOString()
                    updates.comentarios_manager = lastComment
                } else if (role === 'supervisor' || role === 'admin') {
                    updates.estatus_admin = newStatus
                    updates.reviso_admin = currentUser.name || currentUser.email
                    updates.fecha_revision_admin = new Date().toISOString()
                    updates.comentarios_admin = lastComment
                }
            } else if (tableName === 'supervisor_inspections') {
                updates.estatus_admin = newStatus
                updates.reviso_admin = currentUser.name || currentUser.email
                updates.fecha_revision_admin = new Date().toISOString()
                updates.comentarios_admin = lastComment

                // Save Manager Notification Preference
                if (includeManager && managerName) {
                    updates.notify_manager = true
                    updates.manager_name_for_notification = managerName
                } else {
                    updates.notify_manager = false
                    updates.manager_name_for_notification = null
                }
            } else if (tableName === 'manager_checklists') {
                const suffix = role === 'admin' ? 'admin' : 'supervisor'
                updates[`estatus_${suffix}`] = newStatus
                updates[`reviso_${suffix}`] = currentUser.name || currentUser.email
                updates[`fecha_revision_${suffix}`] = new Date().toISOString()
                updates[`comentarios_${suffix}`] = lastComment
            }

            if (role === 'asistente' && tableName === 'assistant_checklists') {
                updates.estatus_manager = 'cerrado'
                updates.comments = checklist.comments ? `${checklist.comments}\n[${formatDateLA(new Date())}] Asistente: ${lastComment}` : lastComment
            }

            const { error } = await supabase.from(tableName).update(updates).eq('id', checklist.id)
            if (error) throw error

            // Handle Notifications
            if (newStatus === 'rechazado' && tableName === 'manager_checklists') {
                await supabase.from('notifications').insert({
                    user_id: checklist.user_id,
                    title: 'Checklist de Manager RECHAZADO',
                    message: `Tu checklist ha sido rechazado.`,
                    link: '/checklists-manager',
                    resource_id: checklist.id,
                    type: 'alert'
                })
            }

            // NOTIFICACIÓN AL GERENTE (Desde Inspección de Supervisor)
            if (tableName === 'supervisor_inspections' && includeManager && managerId && newStatus !== 'pendiente') {
                await supabase.from('notifications').insert({
                    user_id: managerId, // ID del Gerente
                    title: `Revisión de Inspección: ${newStatus.toUpperCase()}`,
                    message: `La inspección de ${checklist.store_name} ha sido marcada como ${newStatus}.`,
                    link: '/inspecciones', // O el link adecuado para que el manager vea
                    resource_id: checklist.id,
                    type: 'info'
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
        <>
            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        key="modal-overlay"
                        className="fixed inset-0 z-[9999] pb-32 text-left overflow-hidden bg-gray-50"
                        initial={{ opacity: 0, y: 50 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 50 }}
                    >
                        {/* Background Pattern */}
                        <div
                            className="absolute inset-0 z-0 opacity-[0.3] invert pointer-events-none bg-[url('https://www.transparenttextures.com/patterns/cubes.png')]"
                            aria-hidden="true"
                        />

                        {/* CLOSE BUTTON (Floating Top Right) */}
                        <button
                            onClick={onClose}
                            className="fixed top-6 right-6 z-[100] p-2 bg-white rounded-full shadow-lg hover:bg-gray-100 border border-gray-200 text-gray-500 transition-colors"
                        >
                            <X size={24} />
                        </button>

                        {/* 1. FLOATING HEADER PILL (Fixed at top) */}
                        <div className="fixed top-6 left-0 right-0 z-50 flex justify-center px-4 pointer-events-none">
                            <div className="pointer-events-auto bg-white/95 backdrop-blur-xl shadow-[0_10px_40px_rgba(0,0,0,0.15)] rounded-full px-6 py-4 flex items-center gap-6 max-w-4xl w-full justify-between ring-1 ring-black/5">

                                <div className="flex items-center gap-4 pl-1">
                                    <button onClick={onClose} className="w-12 h-12 rounded-full bg-gray-50 flex items-center justify-center text-gray-900 hover:bg-gray-100 hover:text-black transition-colors border-2 border-gray-200 shadow-sm">
                                        <ArrowLeft size={24} strokeWidth={3} />
                                    </button>
                                    <div className="flex flex-col gap-0.5">
                                        <h1 className="text-lg font-black text-gray-900 tracking-tight leading-none uppercase">{theme.label}</h1>
                                        <div className="flex items-center gap-3 hidden sm:flex">
                                            <div className="text-xs flex items-center gap-1 font-bold text-gray-600 uppercase">
                                                <Store size={14} strokeWidth={2.5} /> {checklist.store_name || 'Tienda'}
                                            </div>
                                            {checklist.supervisor_name && (
                                                <div className="text-xs flex items-center gap-1 font-bold text-gray-600 uppercase border-l-2 border-gray-300 pl-3">
                                                    <User size={14} strokeWidth={2.5} /> {checklist.supervisor_name}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* Progress Pill */}
                                <div className="flex items-center gap-3 pr-1">
                                    <div className="text-right hidden sm:block">
                                        <div className="text-[11px] font-black text-gray-900 uppercase tracking-widest leading-none mb-1">PUNTAJE</div>
                                    </div>
                                    <div className={`px-6 py-2.5 rounded-full font-black text-2xl shadow-md border-2 flex items-center gap-1 ${finalScore >= 80 ? 'bg-emerald-50 text-emerald-600 border-emerald-200' :
                                        finalScore >= 60 ? 'bg-amber-50 text-amber-600 border-amber-200' :
                                            'bg-red-50 text-red-600 border-red-200'
                                        }`}>
                                        {finalScore}%
                                    </div>
                                    <div className="relative group/more">
                                        <button className="w-12 h-12 rounded-full bg-gray-950 text-white flex items-center justify-center shadow-xl hover:scale-105 active:scale-95 transition-transform border-2 border-white/20">
                                            <MoreHorizontal size={24} strokeWidth={3} />
                                        </button>

                                        {/* Dropdown for Status Actions */}
                                        <div className="absolute right-0 mt-2 w-48 bg-white rounded-xl shadow-xl border border-gray-100 p-2 invisible group-hover:visible opacity-0 group-hover:opacity-100 transition-all transform origin-top-right z-50">
                                            {(canApprove || canSupervisorFinalApprove) && status !== 'cerrado' && (
                                                <button onClick={() => handleStatusChange('aprobado')} className="w-full flex items-center gap-2 px-3 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors">
                                                    <CheckCircle size={14} /> Aprobar
                                                </button>
                                            )}
                                            {canReject && status !== 'cerrado' && (
                                                <button onClick={() => handleStatusChange('rechazado')} className="w-full flex items-center gap-2 px-3 py-2 text-xs font-bold text-rose-700 hover:bg-rose-50 rounded-lg transition-colors">
                                                    <XCircle size={14} /> Rechazar
                                                </button>
                                            )}
                                            {canClose && status !== 'cerrado' && (
                                                <button onClick={() => handleStatusChange('cerrado')} className="w-full flex items-center gap-2 px-3 py-2 text-xs font-bold text-purple-700 hover:bg-purple-50 rounded-lg transition-colors">
                                                    <Send size={14} /> Cerrar Ticket
                                                </button>
                                            )}
                                            <button onClick={handlePrint} className="w-full flex items-center gap-2 px-3 py-2 text-xs font-bold text-gray-700 hover:bg-gray-50 rounded-lg transition-colors border-t border-gray-100 mt-1">
                                                <Printer size={14} /> Imprimir
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* MAIN CONTENT CONTAINERS (Scrollable) */}
                        <div className="h-full overflow-y-auto no-scrollbar">
                            <div className="max-w-3xl mx-auto px-4 pt-36 space-y-8 relative z-10 pb-40">

                                {/* 3. METADATA BUBBLE */}
                                <div className="bg-white/95 backdrop-blur-sm rounded-3xl p-6 shadow-[0_10px_40px_-10px_rgba(0,0,0,0.05)] text-center relative overflow-hidden group border border-gray-100 ring-1 ring-black/5">
                                    <div className={`absolute top-0 left-0 w-full h-1 bg-gradient-to-r ${theme.gradient}`} />

                                    <h2 className="text-xl font-black text-gray-900 mb-5 tracking-tight">Detalles de Visita</h2>

                                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                                        <div className="bg-white rounded-xl p-3 border-2 border-gray-200 shadow-sm transition-all hover:border-blue-300">
                                            <label className="text-[10px] font-black text-gray-900 uppercase tracking-widest mb-1.5 block">Sucursal</label>
                                            <div className="text-base font-black text-gray-950 leading-tight">{checklist.store_name}</div>
                                        </div>

                                        <div className="bg-white rounded-xl p-3 border-2 border-gray-200 shadow-sm transition-all hover:border-purple-300">
                                            <label className="text-[10px] font-black text-gray-900 uppercase tracking-widest mb-1.5 block">Turno</label>
                                            <div className="text-base font-black text-gray-950 leading-tight">{checklist.shift || 'N/A'}</div>
                                        </div>

                                        <div className="bg-white rounded-xl p-3 border-2 border-gray-200 shadow-sm transition-all hover:border-pink-300">
                                            <label className="text-[10px] font-black text-gray-900 uppercase tracking-widest mb-1.5 block">Fecha</label>
                                            <div className="text-base font-black text-gray-950 leading-tight">{formatDateLA(checklist.inspection_date)}</div>
                                        </div>

                                        <div className="bg-white rounded-xl p-3 border-2 border-gray-200 shadow-sm transition-all hover:border-indigo-300">
                                            <label className="text-[10px] font-black text-gray-900 uppercase tracking-widest mb-1.5 block">Hora Inicial</label>
                                            <div className="text-base font-black text-indigo-700 leading-tight">{checklist.start_time || 'N/A'}</div>
                                        </div>

                                        <div className="bg-white rounded-xl p-3 border-2 border-gray-200 shadow-sm transition-all hover:border-emerald-300">
                                            <label className="text-[10px] font-black text-gray-900 uppercase tracking-widest mb-1.5 block">Hora Final</label>
                                            <div className="text-base font-black text-emerald-700 leading-tight">{checklist.end_time || 'N/A'}</div>
                                        </div>

                                        <div className="bg-white rounded-xl p-3 border-2 border-gray-200 shadow-sm transition-all hover:border-orange-300">
                                            <label className="text-[10px] font-black text-gray-900 uppercase tracking-widest mb-1.5 block">Duración</label>
                                            <div className="text-base font-black text-gray-950 leading-tight">{getDuration()}</div>
                                        </div>
                                    </div>
                                </div>

                                {/* 4. SECTIONS LOOP (TEMPLATE DATA) */}
                                {templateLoading ? (
                                    <div className="flex justify-center py-20">
                                        <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
                                    </div>
                                ) : template ? (
                                    template.sections.map((section: any, sIdx: number) => {
                                        // 1. Calculate Score for this Section ON THE FLY
                                        let sSum = 0
                                        let sCount = 0

                                        section.questions.forEach((q: any) => {
                                            // --- Reusing same value lookup logic as below ---
                                            let value: any = undefined
                                            if (checklist.answers?.[q.id] !== undefined && checklist.answers?.[q.id] !== null) value = checklist.answers[q.id]
                                            if ((value === undefined || value === null) && checklist.answers?.[q.text] !== undefined) value = checklist.answers[q.text]
                                            if ((value === undefined || value === null) && checklist.answers) {
                                                const questionWords = q.text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter((w: string) => w.length > 2)
                                                for (const answerKey of Object.keys(checklist.answers)) {
                                                    if (answerKey === '__question_photos') continue
                                                    let keyText = answerKey
                                                    const answerVal = checklist.answers[answerKey]
                                                    // Handle Supervisor Nested
                                                    if (type === 'supervisor' && answerVal && typeof answerVal === 'object' && answerVal.items) {
                                                        for (const subKey of Object.keys(answerVal.items)) {
                                                            const subItem = answerVal.items[subKey]
                                                            const subMatchCount = questionWords.filter((word: string) => (subItem.label || subKey).toLowerCase().includes(word)).length
                                                            if (subMatchCount >= 2) {
                                                                value = subItem.score !== undefined ? subItem.score : subItem
                                                                break
                                                            }
                                                        }
                                                        if (value !== undefined) break
                                                        continue
                                                    }
                                                    // Handle Flat Keys
                                                    if (type === 'manager') keyText = getManagerQuestionText(answerKey)
                                                    else keyText = getAssistantQuestionText(type, answerKey)
                                                    const keyLower = keyText.toLowerCase().replace(/\(lbs\)/g, '').trim()
                                                    const matchCount = questionWords.filter((word: string) => keyLower.includes(word) && word.length > 2).length
                                                    if (matchCount >= 2 || (questionWords.length === 1 && matchCount === 1)) {
                                                        value = checklist.answers[answerKey]
                                                        break
                                                    }
                                                }
                                            }
                                            // --- End Lookup --- 

                                            const numVal = getNumericValue(value)
                                            if (numVal !== null) {
                                                sSum += numVal
                                                sCount++
                                            }
                                        })

                                        const sectionAvg = sCount > 0 ? Math.round(sSum / sCount) : null

                                        return (
                                            <div key={`section-${sIdx}`} className="relative bg-white/40 backdrop-blur-sm rounded-[2rem] p-3 md:p-6 border border-white/60 shadow-sm mb-12 ring-1 ring-black/5">
                                                {/* Section Header */}
                                                <div className="sticky md:static top-0 z-40 -mx-3 md:-mx-6 px-3 md:px-6 py-4 bg-slate-900 md:bg-white/40 backdrop-blur-xl md:backdrop-blur-sm shadow-lg md:shadow-none mb-6 flex items-center gap-4 rounded-t-[2rem] transition-all border-b border-white/10 md:border-transparent">
                                                    <span className="shrink-0 bg-white md:bg-gray-900 text-slate-900 md:text-white w-8 h-8 md:w-10 md:h-10 rounded-xl flex items-center justify-center font-black text-sm md:text-base shadow-lg shadow-black/20 md:shadow-purple-900/20">
                                                        {sIdx + 1}
                                                    </span>
                                                    <h3 className="text-sm md:text-lg font-black text-white md:text-gray-900 uppercase tracking-tight leading-snug">
                                                        {section.title}
                                                    </h3>
                                                    {/* DYNAMIC SCORE (Replaces Database Value) */}
                                                    {type === 'supervisor' && sectionAvg !== null && (
                                                        <span className={`ml-auto px-2 py-0.5 rounded text-xs font-bold ${sectionAvg >= 80 ? 'bg-emerald-100 text-emerald-700' :
                                                            sectionAvg >= 60 ? 'bg-amber-100 text-amber-700' :
                                                                'bg-red-100 text-red-700'
                                                            }`}>
                                                            {sectionAvg}%
                                                        </span>
                                                    )}
                                                </div>

                                                <div className="space-y-4 md:space-y-6">
                                                    {section.questions.map((q: any, qIdx: number) => {
                                                        // COMPREHENSIVE ANSWER LOOKUP WITH FALLBACK
                                                        let value: any = undefined

                                                        // Strategy 0: Structured Section/Index Lookup (Supervisor V1)
                                                        if (type === 'supervisor' && section.title && checklist.answers?.[section.title]?.items) {
                                                            const item = checklist.answers[section.title].items[`i${qIdx}`] || checklist.answers[section.title].items[qIdx]
                                                            if (item !== undefined) {
                                                                value = (item.score !== undefined) ? item.score : item
                                                            }
                                                        }

                                                        // Strategy 1: Direct ID match (for new dynamic templates)
                                                        if (checklist.answers?.[q.id] !== undefined && checklist.answers?.[q.id] !== null) {
                                                            value = checklist.answers[q.id]
                                                        }

                                                        // Strategy 2: Direct text match (for legacy templates stored by question text)
                                                        if ((value === undefined || value === null) && checklist.answers?.[q.text] !== undefined) {
                                                            value = checklist.answers[q.text]
                                                        }

                                                        // Strategy 3: Fuzzy match on old descriptive IDs (e.g. "refrig1_papelitos_mayo")
                                                        if ((value === undefined || value === null) && checklist.answers) {
                                                            const questionWords = q.text.toLowerCase()
                                                                .replace(/[^a-z0-9\s]/g, '')
                                                                .split(/\s+/)
                                                                .filter((w: string) => w.length > 2)

                                                            for (const answerKey of Object.keys(checklist.answers)) {
                                                                if (answerKey === '__question_photos') continue

                                                                let keyText = answerKey
                                                                const answerVal = checklist.answers[answerKey]

                                                                if (type === 'supervisor' && answerVal && typeof answerVal === 'object' && answerVal.items) {
                                                                    for (const subKey of Object.keys(answerVal.items)) {
                                                                        const subItem = answerVal.items[subKey]
                                                                        const subLabel = subItem.label || subKey
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
                                                                    continue
                                                                }

                                                                if (type === 'manager') {
                                                                    keyText = getManagerQuestionText(answerKey)
                                                                } else {
                                                                    keyText = getAssistantQuestionText(type, answerKey)
                                                                }

                                                                const keyLower = keyText.toLowerCase()
                                                                    .replace(/\(lbs\)/g, '')
                                                                    .trim()

                                                                const matchCount = questionWords.filter((word: string) =>
                                                                    keyLower.includes(word) && word.length > 2
                                                                ).length

                                                                if (matchCount >= 2 || (questionWords.length === 1 && matchCount === 1)) {
                                                                    value = checklist.answers[answerKey]
                                                                    break
                                                                }
                                                            }
                                                        }

                                                        // Try to find photos for this question using multiple strategies
                                                        let qPhotos: string[] = []

                                                        // Explicit fallback for known legacy question "Escurre carnes y rota producto (FIFO)"
                                                        if (q.text && q.text.toLowerCase().includes('escurre carnes')) {
                                                            if (questionPhotosMap['1585']) {
                                                                qPhotos = questionPhotosMap['1585']
                                                            }
                                                        }

                                                        // Helper for aggressive text matching
                                                        const normalize = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, '').trim()
                                                        const normalizedTarget = normalize(q.text)

                                                        // Strategy 1: Direct ID match
                                                        if (questionPhotosMap[q.id]) {
                                                            qPhotos = questionPhotosMap[q.id]
                                                        }
                                                        // Strategy 2: Try question text as key
                                                        else if (questionPhotosMap[q.text]) {
                                                            qPhotos = questionPhotosMap[q.text]
                                                        }
                                                        // Strategy 2.5: Try __text_photos with lowercase text (NEW for ID drift immunity)
                                                        else if (answersData['__text_photos'] && answersData['__text_photos'][q.text.toLowerCase().trim()]) {
                                                            qPhotos = answersData['__text_photos'][q.text.toLowerCase().trim()]
                                                        }
                                                        // Strategy 2.6: Hardcoded Legacy ID Map (Keyword-based for robustness)
                                                        else {
                                                            const legacyRules = [
                                                                { keywords: ['escurre', 'carnes', 'fifo'], id: '1585' },
                                                                { keywords: ['frijoles', 'olla', 'cebollas'], id: '1774' },
                                                                { keywords: ['controla', 'temperatura', '450'], id: '1584' },
                                                                { keywords: ['utensilios', 'limpios', 'golpear'], id: '1586' },
                                                                { keywords: ['vigila', 'cebolla', 'asada'], id: '1587' },
                                                                { keywords: ['apertura', 'cierre', 'completo'], id: '1566' },
                                                                { keywords: ['temperatura', 'agua', 'caliente'], id: '1556' }
                                                            ]

                                                            const qTextLower = q.text.toLowerCase()
                                                            for (const rule of legacyRules) {
                                                                if (rule.keywords.every(k => qTextLower.includes(k))) {
                                                                    if (questionPhotosMap[rule.id]) {
                                                                        qPhotos = questionPhotosMap[rule.id]
                                                                        break
                                                                    }
                                                                }
                                                            }
                                                        }

                                                        // Strategy 3: Try fuzzy match in questionPhotosMap keys directly
                                                        if (qPhotos.length === 0) {
                                                            for (const k of Object.keys(questionPhotosMap)) {
                                                                if (normalize(k) === normalizedTarget && normalizedTarget.length > 5) {
                                                                    qPhotos = questionPhotosMap[k]
                                                                    break
                                                                }
                                                            }
                                                        }



                                                        // Strategy 4: Cross-reference via ALL saved answer labels (IMPROVED BRIDGE)
                                                        if (qPhotos.length === 0 && checklist.answers) {
                                                            // Search for text match in EVERY property of checklist.answers
                                                            for (const key of Object.keys(checklist.answers)) {
                                                                const section = checklist.answers[key]

                                                                // Is it a section object with items?
                                                                if (section && typeof section === 'object' && section.items) {
                                                                    for (const iKey of Object.keys(section.items)) {
                                                                        const item = section.items[iKey]
                                                                        const itemLabel = item?.label || ''

                                                                        if (normalize(itemLabel) === normalizedTarget && normalizedTarget.length > 5) {


                                                                            // Try many possible photo keys
                                                                            const numericIndex = iKey.startsWith('i') ? iKey.substring(1) : iKey
                                                                            const possibleKeys = [
                                                                                numericIndex,  // Try the numeric index first (e.g., "0" from "i0")
                                                                                iKey,          // Try the full key (e.g., "i0")
                                                                                item.id,       // Try stored ID
                                                                                item.question_id,
                                                                                item.label,
                                                                                q.id
                                                                            ].filter(Boolean)

                                                                            for (const pKey of possibleKeys) {
                                                                                if (pKey && questionPhotosMap[pKey]) {
                                                                                    qPhotos = questionPhotosMap[pKey]

                                                                                    break
                                                                                }
                                                                            }
                                                                        }
                                                                        if (qPhotos.length > 0) break
                                                                    }
                                                                }
                                                                // Is it a direct answer with text mapping? (Strategy 4b)
                                                                else if (key === '__text_photos' && section) {
                                                                    for (const tKey of Object.keys(section)) {
                                                                        if (normalize(tKey) === normalizedTarget) {
                                                                            qPhotos = section[tKey]
                                                                            break
                                                                        }
                                                                    }
                                                                }

                                                                if (qPhotos.length > 0) break
                                                            }
                                                        }

                                                        // Strategy 5: Keyword match for highly specific tags (e.g. FIFO)
                                                        if (qPhotos.length === 0) {
                                                            const keywords = ['FIFO', 'NPS', 'TEMP', 'CARNES', 'BAÑOS']
                                                            for (const kw of keywords) {
                                                                if (q.text.toUpperCase().includes(kw)) {
                                                                    for (const pk of Object.keys(questionPhotosMap)) {
                                                                        if (pk.toUpperCase().includes(kw)) {
                                                                            qPhotos = questionPhotosMap[pk]
                                                                            break
                                                                        }
                                                                    }
                                                                }
                                                                if (qPhotos.length > 0) break
                                                            }
                                                        }

                                                        // Strategy 6: Fuzzy match by question text words (Final resort)
                                                        if (qPhotos.length === 0) {
                                                            const targetWords = q.text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter((w: string) => w.length > 3)
                                                            for (const photoKey of Object.keys(questionPhotosMap)) {
                                                                const kLower = photoKey.toLowerCase()
                                                                const matchCount = targetWords.filter((word: string) => kLower.includes(word)).length
                                                                if (matchCount >= 2 || (targetWords.length === 1 && matchCount === 1)) {
                                                                    qPhotos = questionPhotosMap[photoKey]
                                                                    break
                                                                }
                                                            }
                                                        }

                                                        // Strategy 7: Deep recursion search (Search for ANY property that matches normalized text)
                                                        if (qPhotos.length === 0 && checklist.answers) {
                                                            const deepSearch = (obj: any): string[] | null => {
                                                                if (!obj || typeof obj !== 'object') return null
                                                                // If it's an item with label match
                                                                if (obj.label && normalize(String(obj.label)) === normalizedTarget) {
                                                                    if (Array.isArray(obj.photos)) return obj.photos
                                                                    if (typeof obj.photo === 'string') return [obj.photo]
                                                                    // Check if the parent/map has photos for this label
                                                                    if (questionPhotosMap[obj.label]) return questionPhotosMap[obj.label]
                                                                }
                                                                // Recursively search children
                                                                for (const k of Object.keys(obj)) {
                                                                    const r = deepSearch(obj[k])
                                                                    if (r) return r
                                                                }
                                                                return null
                                                            }
                                                            const res = deepSearch(checklist.answers)
                                                            if (res) qPhotos = res
                                                        }

                                                        return (
                                                            <div key={`q-${sIdx}-${qIdx}`} className="relative rounded-3xl p-5 transition-all duration-300 bg-white shadow-sm border border-gray-100 opacity-90 hover:opacity-100">
                                                                <div className="flex flex-col gap-4">

                                                                    {/* Header: Number and Text */}
                                                                    <div className="flex gap-4 items-start">
                                                                        <div className={`w-8 h-8 rounded-full flex items-center justify-center font-black text-xs flex-shrink-0 transition-colors mt-1 ${value !== undefined ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'
                                                                            }`}>
                                                                            {qIdx + 1}
                                                                        </div>

                                                                        <div className="flex-1">
                                                                            <h4 className="font-bold text-base leading-snug text-gray-600">
                                                                                {q.text}
                                                                                {isNew(q.created_at) && (
                                                                                    <span className="inline-flex items-center gap-1 ml-2 px-1.5 py-0.5 bg-blue-100 text-blue-700 text-[9px] uppercase font-black rounded-full border border-blue-200 align-middle">
                                                                                        <Sparkles size={8} /> NEW <span className="text-blue-500 font-medium normal-case tracking-normal ml-0.5">({new Date(q.created_at!).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: '2-digit' })})</span>
                                                                                    </span>
                                                                                )}
                                                                            </h4>
                                                                            {/* Render Answer HERE for better mobile flow */}
                                                                            <div className="mt-4">
                                                                                {renderAnswerValue(q, value, section.title)}
                                                                            </div>
                                                                        </div>
                                                                    </div>


                                                                    {qPhotos.length > 0 && (
                                                                        <div className="flex justify-center gap-3 overflow-x-auto pb-2 pt-1 border-t border-gray-50 mt-1">
                                                                            {qPhotos.map((url: string, idx: number) => {
                                                                                const isVideo = (u: string) => u.toLowerCase().match(/\.(mp4|webm|ogg|mov)$/)
                                                                                const isVid = isVideo(url)
                                                                                const finalUrl = getEmbeddableImageUrl(url)

                                                                                return (
                                                                                    <div
                                                                                        key={`q-evidence-${sIdx}-${qIdx}-${idx}`}
                                                                                        onClick={() => openViewer(idx, qPhotos)}
                                                                                        className="relative group/delete flex-shrink-0 cursor-pointer hover:scale-105 transition-transform"
                                                                                    >
                                                                                        {isVid ? (
                                                                                            <div className="w-16 h-16 rounded-xl shadow-sm border border-gray-200 bg-black flex items-center justify-center relative overflow-hidden">
                                                                                                <video src={finalUrl} className="w-full h-full object-cover opacity-80" muted playsInline />
                                                                                                <div className="absolute inset-0 flex items-center justify-center">
                                                                                                    <div className="bg-white/30 rounded-full p-1 backdrop-blur-sm">
                                                                                                        <div className="w-0 h-0 border-l-[6px] border-l-white border-y-[4px] border-y-transparent ml-0.5"></div>
                                                                                                    </div>
                                                                                                </div>
                                                                                            </div>
                                                                                        ) : (
                                                                                            <img src={finalUrl} alt="Evidence" className="w-16 h-16 object-cover rounded-xl shadow-sm border border-gray-200" referrerPolicy="no-referrer" />
                                                                                        )}
                                                                                    </div>
                                                                                )
                                                                            })}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        )
                                                    })}
                                                </div>
                                            </div>
                                        )
                                    })
                                ) : null}




                                {/* 6. OBSERVATIONS */}
                                {(checklist.comments || checklist.observaciones) && (
                                    <div className="bg-white/95 backdrop-blur-sm rounded-[2.5rem] p-8 border-2 border-dashed border-yellow-400 text-center shadow-sm">
                                        <h3 className="font-bold text-yellow-700 uppercase tracking-widest text-sm mb-4">Notas Finales</h3>
                                        <p className="text-lg font-medium text-gray-800 italic">
                                            "{checklist.comments || checklist.observaciones}"
                                        </p>
                                    </div>
                                )}

                                {/* 7. CLOSED STATUS NOTICE */}
                                {status === 'cerrado' && (
                                    <motion.div
                                        initial={{ opacity: 0, scale: 0.95 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        className="bg-slate-900 border-2 border-slate-700 rounded-[2.5rem] p-8 text-center shadow-2xl relative overflow-hidden"
                                    >
                                        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-slate-700 via-slate-500 to-slate-700" />
                                        <div className="flex flex-col items-center gap-4">
                                            <div className="w-16 h-16 bg-slate-800 rounded-full flex items-center justify-center text-slate-400 border border-slate-700">
                                                <ClipboardCheck size={32} />
                                            </div>
                                            <div>
                                                <h3 className="text-xl font-black text-white tracking-tight uppercase">Checklist Cerrado</h3>
                                                <p className="text-slate-400 text-sm font-medium mt-1">
                                                    Esta inspección ha sido finalizada y se encuentra en modo de solo lectura.
                                                </p>
                                            </div>
                                        </div>
                                    </motion.div>
                                )}

                                {/* Global Gallery Removed */}

                            </div>
                        </div>

                    </motion.div>
                )}
            </AnimatePresence>

            {/* FLOATING CHAT BUBBLE */}
            <AnimatePresence>
                {chatOpen && (
                    <motion.div
                        initial={{ opacity: 0, scale: 0.9, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.9, y: 20 }}
                        className="fixed bottom-20 right-4 z-[10000] w-[350px] max-w-[90vw] h-[500px] max-h-[60vh] bg-white rounded-2xl shadow-2xl border border-gray-200 flex flex-col overflow-hidden"
                    >
                        {/* Chat Header */}
                        <div className="bg-indigo-600 text-white p-3 flex justify-between items-center shadow-md">
                            <div className="flex items-center gap-2">
                                <MessageSquare size={18} />
                                <span className="font-bold text-sm">Chat de Revisión</span>
                            </div>
                            <button onClick={() => setChatOpen(false)} className="p-1 hover:bg-white/20 rounded-full transition">
                                <X size={16} />
                            </button>
                        </div>

                        {/* Messages */}
                        <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50 relative" ref={chatContainerRef}>
                            {loadingComments && comments.length === 0 ? (
                                <div className="flex justify-center p-8"><div className="w-5 h-5 border-2 border-indigo-500 rounded-full animate-spin border-t-transparent"></div></div>
                            ) : (
                                comments.map((comment: any, idx: number) => {
                                    const isMe = String(comment.user_id) === String(currentUser.id)
                                    return (
                                        <div key={`chat-${idx}`} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} animate-in fade-in slide-in-from-bottom-1`}>
                                            <div className={`max-w-[85%] px-3 py-2 rounded-xl text-xs shadow-sm ${isMe ? 'bg-indigo-600 text-white rounded-br-none' : 'bg-slate-800 text-white border border-slate-700 rounded-bl-none'}`}>
                                                {comment.content}
                                            </div>
                                            <span className="text-[9px] text-gray-400 mt-1 px-1">{isMe ? 'Tú' : comment.user_name} • {formatDateLA(comment.created_at).split(',')[1]}</span>
                                        </div>
                                    )
                                })
                            )}
                        </div>

                        {/* Manager Toggle */}
                        {status !== 'cerrado' && (type === 'supervisor' && role !== 'manager') && (
                            <div className="px-3 py-2 bg-gray-50 border-t border-gray-100">
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <div className={`w-8 h-4 flex items-center bg-gray-300 rounded-full p-0.5 duration-300 ${includeManager ? 'bg-indigo-500' : ''}`}>
                                        <div className={`bg-white w-3 h-3 rounded-full shadow-md transform duration-300 ${includeManager ? 'translate-x-4' : ''}`}></div>
                                    </div>
                                    <input type="checkbox" className="hidden" checked={includeManager} onChange={(e) => toggleManager(e.target.checked)} />
                                    <span className="text-[10px] font-bold text-gray-600">{includeManager && managerName ? `Avisar a ${managerName}` : 'Notificar al Manager'}</span>
                                </label>
                            </div>
                        )}

                        {/* Input */}
                        <div className="p-2 bg-white border-t border-gray-200 flex gap-2">
                            <input
                                value={newComment}
                                onChange={(e) => setNewComment(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSendComment()}
                                placeholder={status === 'cerrado' && !['supervisor', 'admin'].includes(role) ? "El chat está cerrado" : "Escribe un mensaje..."}
                                disabled={status === 'cerrado' && !['supervisor', 'admin'].includes(role)}
                                className="flex-1 px-3 py-2 bg-gray-100 rounded-xl text-xs border-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
                            />
                            <button
                                onClick={handleSendComment}
                                disabled={!newComment.trim() || saving || (status === 'cerrado' && !['supervisor', 'admin'].includes(role))}
                                className="p-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl transition shadow disabled:opacity-50"
                            >
                                <Send size={16} />
                            </button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* CHAT TOOLTIP ANIMATION (Spectacular!) */}
            <AnimatePresence>
                {isOpen && !chatOpen && !viewerOpen && (
                    <motion.div
                        key="chat-tooltip"
                        initial={{ opacity: 0, y: 50, scale: 0.3, rotate: 15, filter: 'blur(10px)' }}
                        animate={{
                            opacity: 1,
                            y: 0,
                            scale: 1,
                            rotate: 0,
                            filter: 'blur(0px)',
                            transition: {
                                delay: 1.2,
                                type: "spring",
                                bounce: 0.6,
                                duration: 1
                            }
                        }}
                        exit={{ opacity: 0, scale: 0.5, y: 20, transition: { duration: 0.2 } }}
                        className="fixed bottom-[152px] right-6 z-[10002] flex flex-col items-end pointer-events-none"
                    >
                        <motion.div
                            animate={{
                                y: [0, -6, 0],
                                scale: [1, 1.02, 1],
                            }}
                            transition={{
                                duration: 3,
                                repeat: Infinity,
                                ease: "easeInOut"
                            }}
                            className="bg-white/95 backdrop-blur-xl px-5 py-3 rounded-[1.25rem] shadow-[0_20px_50px_rgba(79,70,229,0.3)] border border-indigo-100 relative max-w-[240px] text-center ring-1 ring-black/5 overflow-hidden group"
                        >
                            {/* Animated Background Glow */}
                            <motion.div
                                animate={{
                                    opacity: [0.3, 0.6, 0.3],
                                    scale: [1, 1.2, 1]
                                }}
                                transition={{ duration: 4, repeat: Infinity }}
                                className="absolute inset-0 bg-gradient-to-br from-indigo-50/50 via-transparent to-purple-50/50 pointer-events-none"
                            />

                            <p className="text-[13px] font-black leading-tight relative z-10 bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
                                Puedes dejar comentarios al Supervisor y/o Manager
                            </p>

                            {/* Speech bubble arrow */}
                            <div className="absolute -bottom-1.5 right-6 w-3 h-3 bg-white border-b border-r border-indigo-100 transform rotate-45 shadow-sm" />
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* STATUS ACTION BAR (CENTERED) */}
            <AnimatePresence>
                {isOpen && status !== 'cerrado' && (role === 'supervisor' || role === 'admin') && (
                    <motion.div
                        initial={{ opacity: 0, y: 100 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 100 }}
                        className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999] flex items-center gap-1 p-2 bg-white/80 backdrop-blur-xl rounded-full border border-white/20 shadow-[0_20px_50px_rgba(0,0,0,0.2)] ml-1 mr-1"
                    >
                        <button
                            onClick={() => handleStatusChange('pendiente')}
                            disabled={saving}
                            onMouseEnter={() => setHoveredBtn('pendiente')}
                            onMouseLeave={() => setHoveredBtn(null)}
                            className="relative w-12 h-12 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center hover:bg-amber-100 hover:scale-110 active:scale-95 transition-all disabled:opacity-50 border border-amber-200/50 group"
                        >
                            <Clock size={20} />
                            <AnimatePresence>
                                {hoveredBtn === 'pendiente' && (
                                    <motion.div
                                        initial={{ opacity: 0, y: -5 }}
                                        animate={{ opacity: 1, y: -40 }}
                                        exit={{ opacity: 0, y: -5 }}
                                        className="absolute z-[10001] bg-gray-900 text-white text-[11px] font-medium px-3 py-1.5 rounded-lg whitespace-nowrap pointer-events-none shadow-xl"
                                    >
                                        Marcar Pendiente
                                        <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-gray-900 transform rotate-45" />
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </button>

                        <button
                            onClick={() => handleStatusChange('rechazado')}
                            disabled={saving}
                            onMouseEnter={() => setHoveredBtn('rechazado')}
                            onMouseLeave={() => setHoveredBtn(null)}
                            className="relative w-12 h-12 rounded-full bg-rose-50 text-rose-600 flex items-center justify-center hover:bg-rose-100 hover:scale-110 active:scale-95 transition-all disabled:opacity-50 border border-rose-200/50 group"
                        >
                            <XCircle size={20} />
                            <AnimatePresence>
                                {hoveredBtn === 'rechazado' && (
                                    <motion.div
                                        initial={{ opacity: 0, y: -5 }}
                                        animate={{ opacity: 1, y: -40 }}
                                        exit={{ opacity: 0, y: -5 }}
                                        className="absolute z-[10001] bg-gray-900 text-white text-[11px] font-medium px-3 py-1.5 rounded-lg whitespace-nowrap pointer-events-none shadow-xl"
                                    >
                                        Rechazar / Corregir
                                        <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-gray-900 transform rotate-45" />
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </button>

                        <button
                            onClick={() => handleStatusChange('cerrado')}
                            disabled={saving}
                            onMouseEnter={() => setHoveredBtn('cerrado')}
                            onMouseLeave={() => setHoveredBtn(null)}
                            className="relative w-12 h-12 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center hover:bg-indigo-100 hover:scale-110 active:scale-95 transition-all disabled:opacity-50 border border-indigo-200/50 group"
                        >
                            <CheckCircle size={20} />
                            <AnimatePresence>
                                {hoveredBtn === 'cerrado' && (
                                    <motion.div
                                        initial={{ opacity: 0, y: -5 }}
                                        animate={{ opacity: 1, y: -40 }}
                                        exit={{ opacity: 0, y: -5 }}
                                        className="absolute z-[10001] bg-indigo-600 text-white text-[11px] font-medium px-3 py-1.5 rounded-lg whitespace-nowrap pointer-events-none shadow-xl"
                                    >
                                        Aprobar y Cerrar
                                        <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-indigo-600 transform rotate-45" />
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </button>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* SEPARATE GALLERY FAB (CENTER-LEFT) */}
            <AnimatePresence>
                {isOpen && !viewerOpen && allInspectionPhotos.length > 0 && (
                    <motion.button
                        initial={{ scale: 0, x: -20 }}
                        animate={{ scale: 1, x: 0 }}
                        exit={{ scale: 0, x: -20 }}
                        onClick={() => openViewer(0, allInspectionPhotos)}
                        className="fixed bottom-24 left-6 z-[9999] w-12 h-12 rounded-full bg-white text-indigo-600 flex items-center justify-center transition-all hover:scale-110 active:scale-95 border-2 border-indigo-100 shadow-xl group"
                        title="Mostrar Galeria completa de fotos"
                    >
                        <ImageIcon size={24} />
                        <span className="absolute -top-1 -right-1 bg-indigo-600 text-white text-[10px] font-black w-5 h-5 rounded-full flex items-center justify-center border-2 border-white shadow-sm group-hover:bg-indigo-700 transition-colors">
                            {allInspectionPhotos.length}
                        </span>
                    </motion.button>
                )}
            </AnimatePresence>

            {/* SEPARATE CHAT FAB (RIGHT) */}
            <AnimatePresence>
                {isOpen && !viewerOpen && (
                    <motion.button
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        exit={{ scale: 0 }}
                        onClick={() => setChatOpen(!chatOpen)}
                        className={`fixed bottom-6 right-6 z-[9999] w-14 h-14 rounded-full flex items-center justify-center transition-all hover:scale-110 active:scale-95 border-2 border-white/20 shadow-2xl ${chatOpen ? 'bg-white text-indigo-600' : 'bg-indigo-600 text-white'}`}
                    >
                        {comments.length > 0 && !chatOpen && <span className="absolute top-0 right-0 w-4 h-4 bg-red-500 rounded-full border-2 border-white"></span>}
                        {chatOpen ? <X size={24} /> : <MessageSquare size={24} />}
                    </motion.button>
                )}
            </AnimatePresence >

            <AnimatePresence>
                {viewerOpen && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[10000] bg-black/95 flex items-center justify-center backdrop-blur-sm"
                        onClick={() => setViewerOpen(false)}
                    >
                        {/* Close Button */}
                        <button
                            className="absolute top-4 right-4 p-2 bg-white/10 hover:bg-white/20 rounded-full text-white transition z-20"
                            onClick={() => setViewerOpen(false)}
                        >
                            <X size={24} />
                        </button>

                        {/* Navigation Buttons */}
                        {galleryImages.length > 1 && (
                            <>
                                <button
                                    className="absolute left-4 p-3 bg-white/10 hover:bg-white/20 rounded-full text-white transition z-20"
                                    onClick={(e) => { e.stopPropagation(); prevImage() }}
                                >
                                    <ChevronLeft size={32} />
                                </button>
                                <button
                                    className="absolute right-4 p-3 bg-white/10 hover:bg-white/20 rounded-full text-white transition z-20"
                                    onClick={(e) => { e.stopPropagation(); nextImage() }}
                                >
                                    <ChevronRight size={32} />
                                </button>
                            </>
                        )}

                        {/* Image Container */}
                        <div className="relative w-full h-full max-w-7xl max-h-screen p-4 flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
                            {(() => {
                                const currentUrl = getEmbeddableImageUrl(galleryImages[currentImageIndex])
                                const isVideo = currentUrl?.toLowerCase().match(/\.(mp4|webm|ogg|mov)$/)

                                return isVideo ? (
                                    <motion.video
                                        key={`vid-${currentImageIndex}`}
                                        initial={{ opacity: 0, scale: 0.9 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        transition={{ type: "spring", stiffness: 300, damping: 30 }}
                                        src={currentUrl}
                                        className="max-w-full max-h-full object-contain rounded-lg shadow-2xl bg-black"
                                        controls
                                        autoPlay
                                        playsInline
                                    />
                                ) : (
                                    <motion.img
                                        key={currentImageIndex}
                                        initial={{ opacity: 0, scale: 0.9 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        transition={{ type: "spring", stiffness: 300, damping: 30 }}
                                        src={currentUrl}
                                        alt="Evidence Fullscreen"
                                        className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
                                    />
                                )
                            })()}

                            {/* Counter */}
                            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 bg-black/50 backdrop-blur rounded-full text-white text-sm font-medium">
                                {currentImageIndex + 1} / {galleryImages.length}
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
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
        </>
    )
}
