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
    ZoomIn
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

const RatingItem = ({ label, score, photoUrls, onOpenViewer }: { label: string, score: number, photoUrls: string[], onOpenViewer: (idx: number, all: string[]) => void }) => {
    return (
        <div className="flex flex-col items-center p-3 rounded-xl bg-gray-50 border border-gray-100 group">
            <span className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2 text-center h-8 flex items-center">{label}</span>
            <div className="flex gap-1 text-yellow-400 mb-2">
                {[1, 2, 3, 4, 5].map((star) => (
                    <Star key={star} size={18} fill={star <= score ? "currentColor" : "none"} strokeWidth={star <= score ? 0 : 2} className={star <= score ? "text-yellow-400" : "text-gray-300"} />
                ))}
            </div>
            <span className="text-sm font-bold text-gray-700">{score}/5</span>
            {photoUrls.length > 0 && (
                <div className="mt-3 flex gap-1 overflow-x-auto w-full px-1 py-1 custom-scrollbar">
                    {photoUrls.map((url: string, idx: number) => (
                        <button key={idx} onClick={() => onOpenViewer(idx, photoUrls)} className="flex-none w-10 h-10 rounded-lg overflow-hidden border border-white shadow-sm hover:scale-110 transition-transform cursor-zoom-in">
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

    // Image Viewer State
    const [viewerOpen, setViewerOpen] = useState(false)
    const [currentImageIndex, setCurrentImageIndex] = useState(0)
    const [galleryImages, setGalleryImages] = useState<string[]>([])

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

    // Load Comments
    useEffect(() => {
        if (isOpen && feedback?.id) {
            fetchComments()
        }
    }, [isOpen, feedback])

    // Scroll effect
    useEffect(() => {
        if (chatContainerRef.current) {
            chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight
        }
    }, [comments, isOpen])

    if (!isOpen || !feedback || !currentUser) return null

    const isAdmin = ['admin', 'administrador', 'auditor'].includes(currentUser.role)
    const questionPhotosMap = feedback.answers?.['__question_photos'] || {}

    const getScoreColor = (score: number) => {
        if (score >= 9) return 'text-green-600'
        if (score >= 7) return 'text-yellow-500'
        return 'text-red-600'
    }

    const getScoreBadgeColor = (category: string) => {
        const map: any = {
            'promoter': 'bg-green-100 text-green-700 border-green-200',
            'passive': 'bg-yellow-100 text-yellow-700 border-yellow-200',
            'detractor': 'bg-red-100 text-red-700 border-red-200'
        }
        return map[category] || 'bg-gray-100 text-gray-700'
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
        }
    }

    const handleConcludeReview = async () => {
        setIsSending(true)
        const supabase = await getSupabaseClient()
        try {
            const { error: updateError } = await supabase
                .from('customer_feedback')
                .update({ requires_follow_up: false }) // Marca como concluido
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

                {/* Close Button (Mobile Only / Floating) */}
                <button
                    onClick={onClose}
                    className="md:hidden absolute top-4 right-4 z-50 bg-white/80 dark:bg-black/50 backdrop-blur-md p-2 rounded-full shadow-lg border border-gray-200 dark:border-gray-700"
                >
                    <X size={20} className="text-gray-900 dark:text-white" />
                </button>

                {/* LEFT COLUMN: Summary (Sticky on Desktop) */}
                <div className="md:w-1/3 bg-slate-50 dark:bg-slate-950/50 p-6 md:p-8 flex flex-col border-r border-slate-100 dark:border-slate-800 overflow-y-auto custom-scrollbar md:h-full shrink-0">

                    {/* Header Info */}
                    <div className="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase tracking-widest mb-6">
                        <MessageSquare size={14} />
                        <span>ID #{feedback.id}</span>
                    </div>

                    {/* Store Title */}
                    <h1 className="text-2xl md:text-3xl font-black text-slate-900 dark:text-white leading-tight mb-2">
                        {feedback.stores?.name || 'Tienda Desconocida'}
                    </h1>

                    <div className="flex flex-col gap-2 text-sm text-slate-500 dark:text-slate-400 font-medium mb-8">
                        <div className="flex items-center gap-2">
                            <MapPin size={16} className="text-indigo-500" />
                            <span>{feedback.stores?.city || 'Sin ubicación'}</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <Calendar size={16} className="text-indigo-500" />
                            <span>{formatDateLA(feedback.submission_date)} • {formatTimeLA(feedback.submission_date)}</span>
                        </div>
                    </div>

                    {/* NPS Score Card */}
                    <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 shadow-sm border border-slate-100 dark:border-slate-800 mb-6 text-center">
                        <div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">NPS Score</div>
                        <div className={`text-6xl font-black mb-2 ${getScoreColor(feedback.nps_score)}`}>{feedback.nps_score}</div>
                        <div className={`inline-block px-3 py-1 rounded-full text-[10px] font-black uppercase border ${getScoreBadgeColor(feedback.nps_category)}`}>
                            {feedback.nps_category}
                        </div>
                    </div>

                    {/* Check Details */}
                    {/* User Info */}
                    {(feedback.customer_name || feedback.customer_email) && (
                        <div className="p-4 bg-indigo-50 dark:bg-indigo-900/20 rounded-2xl border border-indigo-100 dark:border-indigo-900/30">
                            <h3 className="text-xs font-bold text-indigo-900 dark:text-indigo-300 uppercase tracking-widest mb-3 flex items-center gap-2">
                                <User size={14} /> Cliente
                            </h3>
                            {feedback.customer_name && <p className="font-bold text-slate-700 dark:text-slate-200 text-sm mb-1">{feedback.customer_name}</p>}
                            {feedback.customer_email && <p className="text-slate-500 dark:text-slate-400 text-xs break-all flex items-center gap-1"><Mail size={12} /> {feedback.customer_email}</p>}
                        </div>
                    )}

                    {/* Desktop Close Button (Bottom) */}
                    <div className="mt-auto pt-8 hidden md:block">
                        <button
                            onClick={onClose}
                            className="w-full py-3 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 font-bold hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors flex items-center justify-center gap-2"
                        >
                            <X size={18} /> Cerrar Revisión
                        </button>
                    </div>
                </div>

                {/* RIGHT COLUMN: Content (Scrollable) */}
                <div className="flex-1 bg-white dark:bg-slate-900 overflow-hidden flex flex-col h-full">
                    <div className="flex-1 overflow-y-auto custom-scrollbar p-6 md:p-10 space-y-10">

                        {/* 1. Client Voice (Big Quote) */}
                        <div className="relative">
                            <MessageSquare className="absolute -top-4 -left-2 text-indigo-100 dark:text-indigo-900/20 w-16 h-16 transform -rotate-12" />
                            <div className="relative z-10 pl-6 border-l-4 border-indigo-500">
                                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">La Voz del Cliente</h3>
                                <p className="text-xl md:text-2xl font-medium text-slate-800 dark:text-slate-200 italic leading-relaxed">
                                    "{feedback.comments || feedback.customer_comments || 'Sin comentarios adicionales.'}"
                                </p>
                            </div>
                        </div>

                        {/* 2. Ratings Grid */}
                        <div>
                            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                                <Star size={14} /> Evaluación Detallada
                            </h3>
                            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
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

                        {/* 3. Evidence */}
                        {feedback.photo_urls && feedback.photo_urls.length > 0 && (
                            <div>
                                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                                    <Camera size={14} /> Evidencia Adjunta
                                </h3>
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                    {feedback.photo_urls.map((url: string, i: number) => (
                                        <button
                                            key={i}
                                            onClick={() => openViewer(i, feedback.photo_urls)}
                                            className="aspect-video bg-slate-100 dark:bg-slate-800 rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-700 relative group cursor-zoom-in shadow-sm hover:shadow-md transition-all"
                                        >
                                            <img src={getEmbeddableImageUrl(url)} alt={`Evidencia ${i + 1}`} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" />
                                            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 flex items-center justify-center transition-all">
                                                <ZoomIn className="text-white opacity-0 group-hover:opacity-100 transform scale-50 group-hover:scale-100 transition-all" size={24} />
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
                    {isAdmin && (
                        <div className="border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 backdrop-blur-sm">
                            {/* Chat Header */}
                            <div className="px-6 py-3 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-white/80 dark:bg-slate-900/80">
                                <h3 className="font-bold text-slate-700 dark:text-slate-300 text-sm flex items-center gap-2">
                                    <MessageSquare size={16} className="text-indigo-500" />
                                    Discusión Interna
                                </h3>
                                <button
                                    onClick={handleConcludeReview}
                                    disabled={isSending}
                                    className="text-[10px] font-black uppercase tracking-wider bg-green-500 text-white px-3 py-1.5 rounded-lg shadow-md  hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                                >
                                    {isSending ? 'Guardando...' : 'Marcar Resuelto'}
                                </button>
                            </div>

                            {/* Chat Messages (Small Scrollable Area) */}
                            <div className="h-40 overflow-y-auto p-4 space-y-3 bg-slate-50 dark:bg-slate-950" ref={chatContainerRef}>
                                {comments.length === 0 ? (
                                    <div className="h-full flex flex-col items-center justify-center text-slate-400 space-y-2 opacity-60">
                                        <MessageSquare size={20} />
                                        <p className="text-xs italic">Sin notas de seguimiento.</p>
                                    </div>
                                ) : (
                                    comments.map((c) => {
                                        const isMe = String(c.user_id) === String(currentUser.id)
                                        return (
                                            <div key={c.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                                                <div className="flex items-center gap-2 mb-1 px-1">
                                                    <span className="text-[9px] font-bold text-slate-400 uppercase">{c.user_name}</span>
                                                </div>
                                                <div className={`px-3 py-2 rounded-2xl max-w-[85%] text-sm font-medium shadow-sm ${isMe
                                                        ? 'bg-indigo-600 text-white rounded-tr-none'
                                                        : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-tl-none'
                                                    }`}>
                                                    {c.content}
                                                </div>
                                            </div>
                                        )
                                    })
                                )}
                            </div>

                            {/* Chat Input */}
                            <div className="p-3 bg-white dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800">
                                <div className="flex gap-2 relative">
                                    <input
                                        type="text"
                                        className="flex-1 bg-slate-100 dark:bg-slate-800 border-none rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500 transition-all dark:text-white"
                                        placeholder="Escribe una nota interna..."
                                        value={newComment}
                                        onChange={(e) => setNewComment(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && handleSendComment()}
                                    />
                                    <button
                                        onClick={handleSendComment}
                                        disabled={!newComment.trim()}
                                        className="absolute right-1 top-1 bottom-1 aspect-square bg-indigo-600 text-white rounded-lg flex items-center justify-center hover:bg-indigo-700 disabled:opacity-0 disabled:scale-0 transition-all duration-200 shadow-sm"
                                    >
                                        <Send size={16} />
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
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
                    <div className="flex-1 flex items-center justify-center p-4">
                        <img src={getEmbeddableImageUrl(galleryImages[currentImageIndex])} className="max-h-full max-w-full object-contain shadow-2xl rounded-lg" alt="Zoomed evidence" />
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
