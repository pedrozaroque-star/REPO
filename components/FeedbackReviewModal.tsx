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
    Phone,
    Shield,
    X,
    Star,
    CheckCircle,
    AlertCircle,
    ClipboardCheck,
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
        setCurrentImageIndex(prev => (prev + 1) % galleryImages.length)
    }

    const prevImage = () => {
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

    if (!isOpen || !feedback) return null

    // -- HELPERS (Restored) --
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

    const isAdmin = currentUser.role === 'admin'
    const questionPhotosMap = feedback.answers?.['__question_photos'] || {}

    const getScoreColor = (score: number) => {
        if (score >= 9) return 'text-green-600'
        if (score >= 7) return 'text-yellow-500'
        return 'text-red-600'
    }

    const getScoreBagdeColor = (category: string) => {
        const map: any = {
            'promoter': 'bg-green-100 text-green-700 border-green-200',
            'passive': 'bg-yellow-100 text-yellow-700 border-yellow-200',
            'detractor': 'bg-red-100 text-red-700 border-red-200'
        }
        return map[category] || 'bg-gray-100 text-gray-700'
    }

    const RatingItem = ({ label, score, qId }: { label: string, score: number, qId?: string }) => {
        const qPhotos = qId ? (questionPhotosMap[qId] || []) : []
        return (
            <div className="flex flex-col items-center p-3 rounded-xl bg-gray-50 border border-gray-100 group">
                <span className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2 text-center h-8 flex items-center">{label}</span>
                <div className="flex gap-1 text-yellow-400 mb-2">
                    {[1, 2, 3, 4, 5].map((star) => (
                        <Star key={star} size={18} fill={star <= score ? "currentColor" : "none"} strokeWidth={star <= score ? 0 : 2} className={star <= score ? "text-yellow-400" : "text-gray-300"} />
                    ))}
                </div>
                <span className="text-sm font-bold text-gray-700">{score}/5</span>
                {qPhotos.length > 0 && (
                    <div className="mt-3 flex gap-1 overflow-x-auto w-full px-1 py-1">
                        {qPhotos.map((url: string, idx: number) => (
                            <button key={idx} onClick={() => openViewer(idx, qPhotos)} className="flex-none w-10 h-10 rounded-lg overflow-hidden border border-white shadow-sm hover:scale-110 transition-transform cursor-zoom-in">
                                <img src={getEmbeddableImageUrl(url)} alt="Evidence" className="w-full h-full object-cover" />
                            </button>
                        ))}
                    </div>
                )}
            </div>
        )
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
    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-xl z-[5000] flex items-center justify-center p-2 sm:p-6 animate-in fade-in duration-300">
            {/* Modal Container */}
            <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-5xl h-[90vh] flex flex-col relative overflow-hidden ring-1 ring-gray-900/5">

                {/* Close Button (Floating & Always Visible) */}
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 z-50 bg-white/50 hover:bg-white text-gray-500 hover:text-gray-900 p-2.5 rounded-full transition-all backdrop-blur-md shadow-sm border border-gray-100"
                >
                    <X size={26} />
                </button>

                {/* Header Info (Integrated) */}
                <div className="px-8 pt-8 pb-2 bg-white shrink-0">
                    <div className="flex items-center gap-2 text-xs font-bold text-gray-400 uppercase tracking-widest">
                        <MessageSquare size={14} />
                        <span>Feedback ID #{feedback.id}</span>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto bg-white">
                    {/* INFO PRINCIPAL */}
                    <div className="px-8 py-8 md:flex md:items-start md:justify-between bg-gradient-to-b from-white to-gray-50/50">
                        <div className="space-y-4">
                            <div>
                                <h1 className="text-3xl font-black text-gray-900">{feedback.stores?.name}</h1>
                                <div className="flex items-center gap-2 mt-2 text-gray-500 text-sm font-medium">
                                    <MapPin size={16} />
                                    <span>{feedback.stores?.city || 'Ubicación'}</span>
                                    <span className="text-gray-300">|</span>
                                    <Calendar size={16} />
                                    <span>{formatDateLA(feedback.submission_date)} • {formatTimeLA(feedback.submission_date)}</span>
                                </div>
                            </div>
                            {/* User details... */}
                            {(feedback.customer_name || feedback.customer_email) && (
                                <div className="flex flex-wrap gap-3 mt-4">
                                    {feedback.customer_name && <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-blue-50 text-blue-700 text-xs font-bold border border-blue-100"><User size={12} /> {feedback.customer_name}</div>}
                                    {feedback.customer_email && <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gray-100 text-gray-600 text-xs font-bold border border-gray-200"><Mail size={12} /> {feedback.customer_email}</div>}
                                </div>
                            )}
                        </div>
                        {/* NPS Badge */}
                        <div className="mt-6 md:mt-0 flex flex-col items-end">
                            <div className="text-center">
                                <div className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">NPS Score</div>
                                <div className={`text-5xl font-black ${getScoreColor(feedback.nps_score)}`}>{feedback.nps_score}</div>
                                <div className={`inline-block px-3 py-1 rounded-full text-[10px] font-black uppercase mt-1 border ${getScoreBagdeColor(feedback.nps_category)}`}>{feedback.nps_category}</div>
                            </div>
                        </div>
                    </div>

                    <div className="h-px bg-gray-100 mx-8"></div>

                    {/* RATINGS */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 px-8 py-8">
                        {(template && feedback.answers && Object.keys(feedback.answers).length > 0) ? (
                            questions.filter((q: Question) => q.type === 'rating_5').map((q: Question) => (
                                <RatingItem key={q.id} label={q.text} score={feedback.answers?.[q.text] || 0} qId={q.id} />
                            ))
                        ) : (
                            <>
                                <RatingItem label="Servicio" score={feedback.service_rating} />
                                <RatingItem label="Calidad" score={feedback.food_quality_rating} />
                                <RatingItem label="Limpieza" score={feedback.cleanliness_rating} />
                                <RatingItem label="Rapidez" score={feedback.speed_rating} />
                            </>
                        )}
                    </div>

                    {/* COMENTARIO CLIENTE */}
                    <div className="px-8 pb-8">
                        <div className="bg-gray-50 rounded-2xl p-6 relative border border-gray-100">
                            <MessageSquare className="absolute -top-3 -left-3 text-white bg-red-600 p-1.5 rounded-xl shadow-md h-8 w-8" />
                            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3 pl-2">La Voz del Cliente</h3>
                            <p className="text-gray-800 text-lg font-medium italic leading-relaxed">"{feedback.comments || feedback.customer_comments || 'Sin comentarios'}"</p>
                        </div>
                    </div>

                    {/* EVIDENCIA */}
                    {feedback.photo_urls && feedback.photo_urls.length > 0 && (
                        <div className="px-8 pb-8">
                            <div className="flex items-center gap-2 mb-4"><Camera size={18} className="text-gray-400" /><h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest">Evidencia</h3></div>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                {feedback.photo_urls.map((url: string, i: number) => (
                                    <button
                                        key={i}
                                        onClick={() => openViewer(i, feedback.photo_urls)}
                                        className="aspect-video bg-gray-100 rounded-xl overflow-hidden border border-gray-200 relative group cursor-zoom-in"
                                    >
                                        <img src={getEmbeddableImageUrl(url)} className="w-full h-full object-cover transition-transform group-hover:scale-105" />
                                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 flex items-center justify-center transition-all">
                                            <ZoomIn className="text-white opacity-0 group-hover:opacity-100 transform scale-50 group-hover:scale-100 transition-all" size={24} />
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* --- CHAT SECTION --- */}
                    {isAdmin && (
                        <div className="border-t border-gray-100 bg-gray-50/50">
                            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-white sticky top-0">
                                <h3 className="font-bold text-gray-900 flex items-center gap-2"><MessageSquare size={16} className="text-indigo-600" /> Seguimiento y Discusión</h3>
                                <button onClick={handleConcludeReview} className="text-xs font-bold bg-green-100 text-green-700 px-3 py-1 rounded-lg border border-green-200 hover:bg-green-200">✅ Marcar como Resuelto</button>
                            </div>

                            {/* Messages Area */}
                            <div className="h-64 overflow-y-auto p-6 space-y-4 bg-gray-50" ref={chatContainerRef}>
                                {comments.length === 0 ? (
                                    <div className="text-center text-gray-400 text-xs py-10 italic">No hay comentarios de seguimiento aún.</div>
                                ) : (
                                    comments.map((c) => {
                                        const isMe = String(c.user_id) === String(currentUser.id)
                                        return (
                                            <div key={c.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                                                <div className="flex items-center gap-2 mb-1 px-1">
                                                    <span className="text-[10px] font-bold text-gray-500 uppercase">{c.user_name} ({c.user_role})</span>
                                                    <span className="text-[10px] text-gray-300">{new Date(c.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                                </div>
                                                <div className={`px-4 py-2 rounded-2xl max-w-[80%] text-sm font-medium border shadow-sm ${isMe ? 'bg-indigo-600 text-white rounded-tr-none border-indigo-700' : 'bg-white text-gray-700 rounded-tl-none border-gray-200'
                                                    }`}>
                                                    {c.content}
                                                </div>
                                            </div>
                                        )
                                    })
                                )}
                            </div>

                            {/* Input Area */}
                            <div className="p-4 bg-white border-t border-gray-200">
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        className="flex-1 bg-gray-100 border border-transparent focus:bg-white focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100 rounded-xl px-4 py-3 outline-none transition-all text-sm font-medium"
                                        placeholder="Escribe un comentario..."
                                        value={newComment}
                                        onChange={(e) => setNewComment(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && handleSendComment()}
                                    />
                                    <button
                                        onClick={handleSendComment}
                                        disabled={!newComment.trim()}
                                        className="bg-gray-900 text-white px-4 rounded-xl font-bold hover:bg-black disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                    >
                                        <Send size={18} />
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* IMAGE VIEWER OVERLAY */}
            {viewerOpen && (
                <div className="fixed inset-0 z-[10000] bg-black/95 backdrop-blur-xl flex flex-col animate-in fade-in duration-200" onClick={(e) => e.target === e.currentTarget && setViewerOpen(false)}>
                    {/* Viewer Header */}
                    <div className="absolute top-0 left-0 right-0 p-6 flex justify-between items-center z-50 text-white">
                        <div className="flex items-center gap-3">
                            <span className="bg-white/10 px-3 py-1 rounded-full text-sm font-mono border border-white/10">
                                {currentImageIndex + 1} / {galleryImages.length}
                            </span>
                        </div>
                        <button onClick={() => setViewerOpen(false)} className="p-2 hover:bg-white/10 rounded-full transition-colors">
                            <X size={24} />
                        </button>
                    </div>

                    {/* Main Image */}
                    <div className="flex-1 flex items-center justify-center p-4 md:p-10 relative overflow-hidden">
                        <img
                            src={getEmbeddableImageUrl(galleryImages[currentImageIndex])}
                            className="max-h-full max-w-full object-contain rounded-lg shadow-2xl animate-in zoom-in-95 duration-300"
                        />

                        {/* Nav Buttons */}
                        {galleryImages.length > 1 && (
                            <>
                                <button onClick={(e) => { e.stopPropagation(); prevImage() }} className="absolute left-4 md:left-8 p-3 rounded-full bg-white/10 hover:bg-white/20 text-white backdrop-blur-md border border-white/10 transition-all active:scale-95">
                                    <ChevronLeft size={32} />
                                </button>
                                <button onClick={(e) => { e.stopPropagation(); nextImage() }} className="absolute right-4 md:right-8 p-3 rounded-full bg-white/10 hover:bg-white/20 text-white backdrop-blur-md border border-white/10 transition-all active:scale-95">
                                    <ChevronRight size={32} />
                                </button>
                            </>
                        )}
                    </div>

                    {/* Thumbnails Strip */}
                    {galleryImages.length > 1 && (
                        <div className="h-20 md:h-24 bg-black/50 backdrop-blur-md flex items-center justify-center gap-2 p-2 overflow-x-auto">
                            {galleryImages.map((img, idx) => (
                                <button
                                    key={idx}
                                    onClick={(e) => { e.stopPropagation(); setCurrentImageIndex(idx) }}
                                    className={`relative h-full aspect-square rounded-lg overflow-hidden transition-all border-2 ${idx === currentImageIndex ? 'border-white scale-100 opacity-100' : 'border-transparent scale-90 opacity-50 hover:opacity-100'}`}
                                >
                                    <img src={getEmbeddableImageUrl(img)} className="w-full h-full object-cover" />
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}
