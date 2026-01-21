'use client'

import { useState, useRef, useEffect } from 'react'
import { getSupabaseClient } from '@/lib/supabase'
import { formatDateLA, formatTimeLA } from '@/lib/checklistPermissions'
import {
    MapPin,
    Calendar,
    MessageSquare,
    Camera,
    User,
    Mail,
    X,
    Star,
    Send,
    ChevronLeft,
    ChevronRight,
    ZoomIn,
    Quote,
    CheckCircle
} from 'lucide-react'
import { useDynamicChecklist, Question } from '@/hooks/useDynamicChecklist'

interface FeedbackReviewModalProps {
    isOpen: boolean
    onClose: () => void
    feedback: any
    currentUser: any
    onUpdate?: () => void
}

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
    } catch (e) { }
    return url
}

// Updated Minimal Rating Item
const RatingItem = ({ label, score, photoUrls, onOpenViewer }: { label: string, score: number, photoUrls: string[], onOpenViewer: (idx: number, all: string[]) => void }) => {
    return (
        <div className="flex flex-col p-4 rounded-2xl bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 shadow-sm">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">{label}</span>
            <div className="flex items-end justify-between">
                <div className="flex gap-1 text-yellow-400">
                    {[1, 2, 3, 4, 5].map((star) => (
                        <Star key={star} size={16} fill={star <= score ? "currentColor" : "none"} strokeWidth={star <= score ? 0 : 2} className={star <= score ? "text-yellow-400" : "text-slate-200 dark:text-slate-600"} />
                    ))}
                </div>
                <span className="text-xl font-black text-slate-800 dark:text-white leading-none">{score}</span>
            </div>
            {photoUrls.length > 0 && (
                <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-700 flex gap-2 overflow-x-auto custom-scrollbar">
                    {photoUrls.map((url: string, idx: number) => (
                        <button key={idx} onClick={() => onOpenViewer(idx, photoUrls)} className="flex-none w-8 h-8 rounded-lg overflow-hidden border border-white dark:border-slate-600 shadow-sm hover:scale-110 transition-transform cursor-zoom-in">
                            <img src={getEmbeddableImageUrl(url)} alt="Evidencia" className="w-full h-full object-cover" />
                        </button>
                    ))}
                </div>
            )}
        </div>
    )
}

export default function FeedbackReviewModal({
    isOpen,
    onClose,
    feedback,
    currentUser,
    onUpdate
}: FeedbackReviewModalProps) {
    const [comments, setComments] = useState<any[]>([])
    const [newComment, setNewComment] = useState('')
    const [loadingComments, setLoadingComments] = useState(false)
    const [isSending, setIsSending] = useState(false)
    const chatContainerRef = useRef<HTMLDivElement>(null)

    // Notification State
    const [includeManager, setIncludeManager] = useState(false)
    const [managerName, setManagerName] = useState<string | null>(null)
    const [managerId, setManagerId] = useState<string | null>(null)
    const [supervisorId, setSupervisorId] = useState<string | null>(null)

    // Image Viewer State
    const [viewerOpen, setViewerOpen] = useState(false)
    const [currentImageIndex, setCurrentImageIndex] = useState(0)
    const [galleryImages, setGalleryImages] = useState<string[]>([])

    // Mobile Tabs State
    const [mobileTab, setMobileTab] = useState<'details' | 'chat'>('details')

    // Keyboard Navigation for Viewer & Modal
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (viewerOpen) {
                if (e.key === 'Escape') setViewerOpen(false)
                if (e.key === 'ArrowRight') nextImage()
                if (e.key === 'ArrowLeft') prevImage()
            } else {
                if (e.key === 'Escape') onClose()
            }
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [viewerOpen, currentImageIndex, galleryImages, onClose])

    const openViewer = (index: number, images: string[]) => {
        setGalleryImages(images)
        setCurrentImageIndex(index)
        setViewerOpen(true)
    }

    const nextImage = () => {
        if (galleryImages.length === 0) return
        setCurrentImageIndex(prev => (prev + 1) % galleryImages.length)
    }

    const prevImage = () => {
        if (galleryImages.length === 0) return
        setCurrentImageIndex(prev => (prev - 1 + galleryImages.length) % galleryImages.length)
    }

    // -- DYNAMIC TEMPLATE (Restored) --
    const { data: template } = useDynamicChecklist('public_feedback_v1')
    const questions = template?.sections?.flatMap(s => s.questions) || []

    const fetchComments = async () => {
        if (!feedback?.id) return
        setLoadingComments(true)
        const supabase = await getSupabaseClient()
        const { data } = await supabase
            .from('feedback_comments')
            .select('*')
            .eq('feedback_id', feedback.id)
            .order('created_at', { ascending: true })

        if (data) setComments(data)
        setLoadingComments(false)
    }

    useEffect(() => {
        if (isOpen && feedback?.id) {
            fetchComments()
            fetchRolesAndSettings()
        }
    }, [isOpen, feedback])

    const fetchRolesAndSettings = async () => {
        if (!feedback?.store_id) return
        const supabase = await getSupabaseClient()

        // 1. Get Notification Toggle Status
        const { data: fbData } = await supabase.from('customer_feedback').select('notify_manager').eq('id', feedback.id).maybeSingle()
        if (fbData) setIncludeManager(!!fbData.notify_manager)

        // 2. Get Manager
        const { data: mgr } = await supabase.from('users')
            .select('id, full_name')
            .eq('store_id', feedback.store_id)
            .in('role', ['manager', 'gerente'])
            .limit(1)
            .maybeSingle()

        if (mgr) {
            setManagerId(String(mgr.id))
            setManagerName(mgr.full_name)
        }

        // 3. Get Supervisor
        const { data: sup } = await supabase.from('users')
            .select('id')
            .eq('store_id', feedback.store_id)
            .eq('role', 'supervisor')
            .limit(1)
            .maybeSingle()

        if (sup) setSupervisorId(String(sup.id))
    }

    const toggleManager = async (checked: boolean) => {
        setIncludeManager(checked)
        const supabase = await getSupabaseClient()
        await supabase.from('customer_feedback').update({ notify_manager: checked }).eq('id', feedback.id)
    }

    // Scroll effect
    useEffect(() => {
        if (chatContainerRef.current) {
            chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight
        }
    }, [comments, isOpen])

    if (!isOpen || !feedback || !currentUser) return null

    const isAdmin = ['admin', 'administrador', 'auditor', 'manager', 'supervisor'].includes(currentUser.role?.toLowerCase())
    const questionPhotosMap = feedback.answers?.['__question_photos'] || {}

    const getScoreColor = (score: number) => {
        if (score >= 9) return 'text-green-600'
        if (score >= 7) return 'text-yellow-500'
        return 'text-red-600'
    }

    const getScoreBadgeColor = (category: string) => {
        const map: any = {
            'promoter': 'bg-green-100 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-800',
            'passive': 'bg-yellow-100 text-yellow-700 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-300 dark:border-yellow-800',
            'detractor': 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800'
        }
        return map[category] || 'bg-gray-100 text-gray-700 dark:text-slate-400 dark:bg-slate-800'
    }



    const handleSendComment = async () => {
        if (!newComment.trim()) return

        // Optimistic UI
        const tempId = Date.now()
        const tempComment = {
            id: tempId,
            feedback_id: feedback.id,
            user_id: currentUser.id,
            user_name: currentUser.name || currentUser.email,
            user_role: currentUser.role,
            content: newComment,
            created_at: new Date().toISOString()
        }
        setComments(prev => [...prev, tempComment])
        setNewComment('')

        const supabase = await getSupabaseClient()
        const { error } = await supabase.from('feedback_comments').insert({
            feedback_id: feedback.id,
            user_id: currentUser.id,
            user_name: currentUser.name || currentUser.email,
            user_role: currentUser.role,
            content: tempComment.content
        })

        if (error) {
            console.error('Error sending comment:', error)
            alert('Error al enviar mensaje (asegúrate de crear la tabla feedback_comments)')
            setComments(prev => prev.filter(c => c.id !== tempId)) // Revert
        } else {
            fetchComments()

            // 🔔 NOTIFICATIONS SYSTEM
            try {
                const notifs = []

                // 1. Notify Supervisor (ALWAYS)
                if (supervisorId && String(supervisorId) !== String(currentUser.id)) {
                    notifs.push({
                        user_id: supervisorId,
                        title: '💬 Feedback: Nueva Nota',
                        message: `${currentUser.name} comentó en el ticket #${feedback.id}`,
                        link: `/feedback?id=${feedback.id}`, // Assuming this route handles ID param or similar
                        resource_id: feedback.id,
                        type: 'info',
                        is_read: false
                    })
                }

                // 2. Notify Manager (IF TOGGLED)
                if (includeManager && managerId && String(managerId) !== String(currentUser.id)) {
                    notifs.push({
                        user_id: managerId,
                        title: '⚠️ Atención Requerida: Feedback',
                        message: `${currentUser.name} requiere tu atención en el ticket #${feedback.id}`,
                        link: `/feedback?id=${feedback.id}`,
                        resource_id: feedback.id,
                        type: 'alert',
                        is_read: false
                    })
                }

                if (notifs.length > 0) {
                    await supabase.from('notifications').insert(notifs)
                }

            } catch (err) {
                console.error('Notification Error:', err)
            }
        }
    }

    const handleConcludeReview = async () => {
        if (!confirm('¿Estás seguro de asignar el Estatus Cerrado a este caso? Ya no se podrá modificar su estatus.')) {
            return
        }

        setIsSending(true)
        const supabase = await getSupabaseClient()
        try {
            const { error: updateError } = await supabase
                .from('customer_feedback')
                .update({
                    requires_follow_up: false,
                    review_status: 'closed', // Ensure explicit closed status if used
                    admin_review_status: 'closed',
                    reviewed_by: currentUser.id,
                    reviewed_at: new Date().toISOString(),
                    admin_review_date: new Date().toISOString()
                })
                .eq('id', feedback.id)

            if (updateError) throw updateError
            alert('Revisión concluida exitosamente.')
            if (onUpdate) onUpdate()
            onClose()
        } catch (error: any) {
            alert('Error: ' + error.message)
        } finally {
            setIsSending(false)
        }
    }



    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-xl z-[5000] flex items-center justify-center p-2 sm:p-4 animate-in fade-in duration-300">
            {/* Main Container - Card Style */}
            <div className="bg-white dark:bg-slate-900 w-full max-w-6xl h-[90vh] rounded-[2rem] shadow-2xl relative flex flex-col md:flex-row overflow-hidden ring-1 ring-white/10">

                {/* Mobile Tab Bar */}
                <div className="md:hidden flex shrink-0 border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-slate-900 z-50">
                    <button
                        onClick={() => setMobileTab('details')}
                        className={`flex-1 py-4 text-xs font-bold uppercase tracking-wider transition-colors border-b-2 ${mobileTab === 'details' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-400'}`}
                    >
                        Detalles
                    </button>
                    <button
                        onClick={() => setMobileTab('chat')}
                        className={`flex-1 py-4 text-xs font-bold uppercase tracking-wider transition-colors border-b-2 ${mobileTab === 'details' ? 'border-transparent text-gray-400' : 'border-indigo-600 text-indigo-600'}`}
                    >
                        Chat y Datos
                    </button>
                    {/* Spacer for Close Button */}
                    <div className="w-16"></div>
                </div>

                {/* Close Button (Visible on all screens) */}
                <button
                    onClick={onClose}
                    className="absolute top-3 right-3 md:top-4 md:right-4 z-[60] bg-white/90 dark:bg-slate-800/90 backdrop-blur-md p-2 md:p-3 rounded-full shadow-2xl border-2 border-gray-100 dark:border-gray-700 hover:scale-110 active:scale-95 transition-all group"
                >
                    <X size={20} strokeWidth={2.5} className="text-gray-500 dark:text-gray-400 group-hover:text-red-500 dark:group-hover:text-red-400 transition-colors md:w-[28px] md:h-[28px]" />
                </button>

                {/* LEFT COLUMN: Summary & Chat (Sticky on Desktop, Tab 2 on Mobile) */}
                <div className={`${mobileTab === 'chat' ? 'flex' : 'hidden'} md:flex md:w-80 bg-slate-50 dark:bg-slate-950/50 flex-col border-r border-slate-100 dark:border-slate-800 overflow-hidden shrink-0 flex-1 md:flex-none md:h-full`}>

                    {/* Header / ID */}
                    <div className="p-6 pb-4 border-b border-slate-100 dark:border-slate-800 bg-white/50 dark:bg-slate-900/50 backdrop-blur-sm">
                        <h1 className="text-xl font-black text-slate-800 dark:text-white leading-tight">
                            {feedback.stores?.name || 'Tienda Desconocida'}
                        </h1>
                    </div>

                    <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">

                        {/* Meta Info Group */}
                        <div className="space-y-4">
                            <div className="flex items-start gap-3">
                                <div className="p-2 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg text-indigo-500 shrink-0">
                                    <MapPin size={18} />
                                </div>
                                <div>
                                    <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest">Ubicación</span>
                                    <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">{feedback.stores?.city || 'N/A'}</span>
                                </div>
                            </div>

                            <div className="flex items-start gap-3">
                                <div className="p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg text-blue-500 shrink-0">
                                    <Calendar size={18} />
                                </div>
                                <div>
                                    <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest">Fecha & Hora</span>
                                    <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                                        {formatDateLA(feedback.submission_date)}
                                        <span className="block text-xs font-normal text-slate-500">{formatTimeLA(feedback.submission_date)}</span>
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* Customer Card */}
                        {(feedback.customer_name || feedback.customer_email) && (
                            <div className="relative group">
                                <div className="absolute inset-0 bg-gradient-to-r from-indigo-500 to-purple-600 rounded-2xl blur opacity-20 group-hover:opacity-30 transition-opacity"></div>
                                <div className="relative bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-100 dark:border-slate-800 shadow-sm">
                                    <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 flex items-center justify-between">
                                        <span>Cliente</span>
                                        <User size={12} />
                                    </h3>

                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400 font-bold text-lg">
                                            {feedback.customer_name ? feedback.customer_name.charAt(0).toUpperCase() : '?'}
                                        </div>
                                        <div className="overflow-hidden">
                                            <p className="font-bold text-slate-800 dark:text-slate-200 text-sm truncate">{feedback.customer_name || 'Anónimo'}</p>
                                            {feedback.customer_email && (
                                                <p className="text-xs text-slate-500 truncate flex items-center gap-1">
                                                    {feedback.customer_email}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Chat Section (Moved to Left) */}
                    {isAdmin && (
                        <div className="flex-1 flex flex-col border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden min-h-[250px]">
                            {/* Header */}
                            <div className="px-4 py-2 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50/50 dark:bg-slate-800/50">
                                <h3 className="font-bold text-slate-600 dark:text-slate-400 text-xs flex items-center gap-2 uppercase tracking-wider">
                                    <MessageSquare size={12} />
                                    Chat de revisión
                                </h3>
                            </div>

                            {/* Messages */}
                            <div className="flex-1 overflow-y-auto p-3 space-y-3 bg-slate-50 dark:bg-slate-950 custom-scrollbar" ref={chatContainerRef}>
                                {/* ... map comments ... */}
                                {comments.length === 0 ? (
                                    <div className="h-full flex flex-col items-center justify-center text-slate-400 dark:text-slate-500 space-y-3 opacity-80">
                                        <MessageSquare size={40} strokeWidth={1.5} />
                                        <p className="text-sm font-bold uppercase tracking-widest text-center">Sin notas de revisión</p>
                                    </div>
                                ) : (
                                    comments.map((comment: any, idx: number) => {
                                        const isMe = String(comment.user_id) === String(currentUser.id)
                                        return (
                                            <div key={comment.id || idx} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} animate-in fade-in slide-in-from-bottom-1`}>
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
                            {managerName && (
                                <div className="px-3 py-2 bg-slate-50 dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800">
                                    <label className="flex items-center gap-2 cursor-pointer group">
                                        <div className={`w-8 h-4 flex items-center bg-gray-300 dark:bg-slate-700 rounded-full p-0.5 duration-300 ${includeManager ? 'bg-indigo-500' : ''}`}>
                                            <div className={`bg-white w-3 h-3 rounded-full shadow-md transform duration-300 ${includeManager ? 'translate-x-4' : ''}`}></div>
                                        </div>
                                        <input type="checkbox" className="hidden" checked={includeManager} onChange={(e) => toggleManager(e.target.checked)} />
                                        <span className="text-[10px] font-bold text-gray-600 dark:text-slate-400 group-hover:text-indigo-500 transition-colors">
                                            {includeManager ? `Avisar a ${managerName}` : 'Notificar al Manager'}
                                        </span>
                                    </label>
                                </div>
                            )}

                            {/* Input */}
                            <div className="p-2 border-t border-slate-100 dark:border-slate-800">
                                <div className="flex gap-1">
                                    <input
                                        type="text"
                                        className="flex-1 bg-slate-100 dark:bg-slate-800 border-none rounded-xl px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-indigo-500 transition-all dark:text-white"
                                        placeholder="Escribe una nota..."
                                        value={newComment}
                                        onChange={(e) => setNewComment(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && handleSendComment()}
                                    />
                                    <button
                                        onClick={handleSendComment}
                                        disabled={!newComment.trim()}
                                        className="p-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl transition shadow disabled:opacity-50 disabled:cursor-not-allowed"
                                        style={{ width: 'auto' }}
                                    >
                                        <Send size={16} />
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Actions Footer - Primary Conclude Action */}
                    <div className="p-6 border-t border-slate-100 dark:border-slate-800 bg-white/50 dark:bg-slate-900/50 backdrop-blur-sm mt-auto block">
                        <button
                            onClick={handleConcludeReview}
                            disabled={isSending}
                            className="w-full py-3 rounded-xl bg-green-500 hover:bg-green-600 text-white font-bold transition-all flex items-center justify-center gap-2 disabled:opacity-50 shadow-lg shadow-green-500/20"
                        >
                            <CheckCircle size={18} />
                            {isSending ? 'Guardando...' : 'Concluir Revisión'}
                        </button>
                    </div>
                </div>

                {/* RIGHT COLUMN: Content (Tab 1 on Mobile, Always Visible on Desktop) */}
                <div className={`${mobileTab === 'details' ? 'flex' : 'hidden'} md:flex flex-1 bg-white dark:bg-slate-900 overflow-hidden flex-col flex-1 md:h-full`}>
                    <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-6">

                        {/* 1. Client Voice (Big Quote) - Compacted */}
                        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-700 p-6 shadow-lg shadow-indigo-500/20 text-white shrink-0">
                            <div className="absolute top-0 right-0 p-24 bg-white/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/4 pointer-events-none"></div>
                            <div className="relative z-10">
                                <div className="flex items-center gap-2 mb-3 opacity-70">
                                    <MessageSquare size={14} />
                                    <span className="text-sm font-bold uppercase tracking-widest">La Voz del Cliente</span>
                                </div>
                                <Quote className="absolute top-4 right-6 w-12 h-12 text-white/10 rotate-12" />
                                <p className="text-2xl font-medium leading-relaxed font-serif italic text-white/95 pr-8">
                                    "{feedback.comments || feedback.customer_comments || 'Sin comentarios adicionales.'}"
                                </p>
                            </div>
                        </div>

                        {/* 2. NPS Question Block - Compacted */}
                        <div className="bg-slate-50 dark:bg-slate-800/50 rounded-2xl p-5 border border-slate-100 dark:border-slate-800 shrink-0">
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest">Pregunta NPS</h3>
                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wide border ${getScoreBadgeColor(feedback.nps_category)}`}>
                                    {feedback.nps_category}
                                </span>
                            </div>

                            <p className="text-lg font-bold text-slate-800 dark:text-white mb-4 text-center max-w-2xl mx-auto">
                                "{template?.sections?.[0]?.questions?.find((q: any) => q.type === 'nps')?.text || '¿Qué tan probable es que recomiendes Tacos El Gavilán a un amigo o familiar?'}"
                            </p>

                            <div className="flex flex-col items-center">
                                <div className="flex w-full max-w-2xl gap-1 mb-2 h-10">
                                    {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(num => {
                                        const isSelected = feedback.nps_score === num
                                        let bgClass = 'bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600'
                                        let textClass = 'text-slate-400 dark:text-slate-500'

                                        if (isSelected) {
                                            textClass = 'text-white'
                                            if (num <= 6) bgClass = 'bg-red-500 border-red-500 shadow-md scale-110 z-10'
                                            else if (num <= 8) bgClass = 'bg-yellow-500 border-yellow-500 shadow-md scale-110 z-10'
                                            else bgClass = 'bg-green-500 border-green-500 shadow-md scale-110 z-10'
                                        }

                                        return (
                                            <div key={num} className={`flex-1 flex flex-col items-center justify-center rounded-lg transition-all duration-300 font-black ${bgClass} ${textClass}`}>
                                                <span className="text-base">{num}</span>
                                            </div>
                                        )
                                    })}
                                </div>
                                <div className="flex justify-between w-full max-w-2xl text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1">
                                    <span>Nada Probable</span>
                                    <span>Muy Probable</span>
                                </div>
                            </div>
                        </div>

                        {/* 3. Ratings Grid - Minimal Cards (Compact Grid) */}
                        <div className="shrink-0">
                            <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                                <Star size={12} /> Evaluación Detallada
                            </h3>
                            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                                {(template && feedback.answers && Object.keys(feedback.answers).length > 0) ? (
                                    questions.filter((q: Question) => q.type === 'rating_5').map((q: Question) => (
                                        <RatingItem
                                            key={q.id}
                                            label={q.text}
                                            score={feedback.answers?.[q.text] || 0}
                                            photoUrls={questionPhotosMap[q.id] || []}
                                            onOpenViewer={openViewer}
                                        />
                                    ))
                                ) : (
                                    <>
                                        <RatingItem label="Servicio" score={feedback.service_rating} photoUrls={[]} onOpenViewer={openViewer} />
                                        <RatingItem label="Calidad" score={feedback.food_quality_rating} photoUrls={[]} onOpenViewer={openViewer} />
                                        <RatingItem label="Limpieza" score={feedback.cleanliness_rating} photoUrls={[]} onOpenViewer={openViewer} />
                                        <RatingItem label="Rapidez" score={feedback.speed_rating} photoUrls={[]} onOpenViewer={openViewer} />
                                    </>
                                )}
                            </div>
                        </div>

                        {/* 4. Evidence (Compact) */}
                        {feedback.photo_urls && feedback.photo_urls.length > 0 && (
                            <div className="shrink-0">
                                <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                                    <Camera size={12} /> Evidencia Adjunta
                                </h3>
                                <div className="grid grid-cols-4 gap-3">
                                    {feedback.photo_urls.map((url: string, i: number) => (
                                        <button
                                            key={i}
                                            onClick={() => openViewer(i, feedback.photo_urls)}
                                            className="aspect-square bg-slate-100 dark:bg-slate-800 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 relative group cursor-zoom-in shadow-sm hover:shadow-md transition-all h-20 w-20"
                                        >
                                            <img src={getEmbeddableImageUrl(url)} alt={`Evidencia ${i + 1}`} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" />
                                            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 flex items-center justify-center transition-all">
                                                <ZoomIn className="text-white opacity-0 group-hover:opacity-100 transform scale-50 group-hover:scale-100 transition-all" size={20} />
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Space for Chat at bottom */}
                        <div className="h-4"></div>
                    </div>

                    {/* Chat Section (Sticky at Bottom of Right Column) */}

                </div>
            </div>

            {/* Viewer Overlay (Same as before) -- Copied Logic */}
            {viewerOpen && (
                <div className="fixed inset-0 z-[10000] bg-black/95 backdrop-blur-xl flex flex-col animate-in fade-in duration-200" onClick={(e) => e.target === e.currentTarget && setViewerOpen(false)}>
                    {/* Header */}
                    <div className="absolute top-0 left-0 right-0 p-6 flex justify-between items-center z-50 text-white">
                        <span className="text-white/50 text-xs font-mono">{currentImageIndex + 1} / {galleryImages.length}</span>
                        <button onClick={() => setViewerOpen(false)} className="p-2 bg-white/10 rounded-full hover:bg-white/20"><X size={20} /></button>
                    </div>
                    {/* Image */}
                    <div className="flex-1 w-full h-full flex items-center justify-center p-4 overflow-hidden relative">
                        <img
                            src={getEmbeddableImageUrl(galleryImages[currentImageIndex])}
                            className="max-h-[85vh] max-w-[95vw] object-contain shadow-2xl rounded-lg"
                            alt="Zoomed evidence"
                        />
                    </div>
                    {/* Nav */}
                    {galleryImages.length > 1 && (
                        <>
                            <button onClick={(e) => { e.stopPropagation(); prevImage() }} className="absolute left-4 top-1/2 -translate-y-1/2 p-3 rounded-full bg-white/10 hover:bg-white/20 text-white backdrop-blur-md"><ChevronLeft size={24} /></button>
                            <button onClick={(e) => { e.stopPropagation(); nextImage() }} className="absolute right-4 top-1/2 -translate-y-1/2 p-3 rounded-full bg-white/10 hover:bg-white/20 text-white backdrop-blur-md"><ChevronRight size={24} /></button>
                        </>
                    )}
                </div>
            )}
        </div>
    )
}
