'use client'

import { useState } from 'react'
import { getSupabaseClient } from '@/lib/supabase'
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
    ClipboardCheck
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
    const [adminNotes, setAdminNotes] = useState(feedback.follow_up_notes || '')
    const [isSending, setIsSending] = useState(false)

    // -- DYNAMIC TEMPLATE (Moved up) --
    const { data: template } = useDynamicChecklist('public_feedback_v1')
    const questions = template?.sections?.flatMap(s => s.questions) || []

    if (!isOpen || !feedback) return null

    // Helper para transformar URLs de Google Drive en imágenes visibles
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
            console.error('Error parseando URL de Drive:', e)
        }
        return url
    }

    const isAdmin = currentUser.role === 'admin'

    const questionPhotosMap = feedback.answers?.['__question_photos'] || {}

    // Categoría de colores
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
                        <Star
                            key={star}
                            size={18}
                            fill={star <= score ? "currentColor" : "none"}
                            strokeWidth={star <= score ? 0 : 2}
                            className={star <= score ? "text-yellow-400" : "text-gray-300"}
                        />
                    ))}
                </div>
                <span className="text-sm font-bold text-gray-700">{score}/5</span>

                {qPhotos.length > 0 && (
                    <div className="mt-3 flex gap-1 overflow-x-auto w-full px-1 py-1">
                        {qPhotos.map((url: string, idx: number) => (
                            <a key={idx} href={url} target="_blank" rel="noopener noreferrer" className="flex-none w-10 h-10 rounded-lg overflow-hidden border border-white shadow-sm hover:scale-110 transition-transform">
                                <img src={getEmbeddableImageUrl(url)} alt="Evidence" className="w-full h-full object-cover" />
                            </a>
                        ))}
                    </div>
                )}
            </div>
        )
    }

    const handleNotifySupervisor = async () => {
        if (!adminNotes.trim()) {
            alert('Por favor escribe indicaciones antes de notificar.')
            return
        }

        setIsSending(true)
        const supabase = await getSupabaseClient()

        try {
            const { error: updateError } = await supabase
                .from('customer_feedback')
                .update({ follow_up_notes: adminNotes, requires_follow_up: true })
                .eq('id', feedback.id)

            if (updateError) throw updateError

            // 🔔 SISTEMA DE NOTIFICACIONES (Ahora manejado por Triggers de BD)
            // Ya no es necesario insertar manualmente aquí. El trigger 'notify_feedback_review'
            // se activará automáticamente al detectar el cambio en 'requires_follow_up'.
            alert('Feedback guardado exitosamente.')

            if (onUpdate) onUpdate()
            onClose()

        } catch (error: any) {
            console.error('Error:', error)
            alert('Error: ' + error.message)
        } finally {
            setIsSending(false)
        }
    }

    const handleConcludeReview = async () => {
        setIsSending(true)
        const supabase = await getSupabaseClient()

        try {
            // Actualizar a "Concluido" (requires_follow_up: false)
            const { error: updateError } = await supabase
                .from('customer_feedback')
                .update({
                    follow_up_notes: adminNotes,
                    requires_follow_up: false // Marca como concluido/revisado
                })
                .eq('id', feedback.id)

            if (updateError) throw updateError

            alert('Revisión concluida exitosamente. El caso ha sido marcado como cerrado.')

            if (onUpdate) onUpdate()
            onClose()

        } catch (error: any) {
            console.error('Error:', error)
            alert('Error al concluir: ' + error.message)
        } finally {
            setIsSending(false)
        }
    }

    return (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-in fade-in duration-300">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl max-h-[95vh] flex flex-col overflow-hidden ring-1 ring-gray-900/5">

                {/* Header Compacto */}
                <div className="flex justify-between items-center px-6 py-4 border-b border-gray-100 bg-white sticky top-0 z-10">
                    <div className="flex items-center gap-2 text-gray-400">
                        <MessageSquare size={18} />
                        <span className="text-sm font-semibold uppercase tracking-wider">Feedback ID #{feedback.id} {template && <span className="text-[10px] bg-gray-100 px-2 py-0.5 rounded ml-2">DYNAMIC MODE</span>}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <button onClick={() => window.print()} className="flex items-center gap-2 px-4 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded-xl transition print:hidden text-xs">
                            <ClipboardCheck size={14} />
                            Imprimir
                        </button>
                        <button onClick={onClose} className="text-gray-400 hover:text-gray-900 transition-colors p-1 bg-gray-100 hover:bg-gray-200 rounded-full print:hidden">
                            <X size={20} />
                        </button>
                    </div>
                </div>

                <style jsx global>{`
                    @media print {
                        body * { visibility: hidden; }
                        #printable-feedback, #printable-feedback * { visibility: visible; }
                        #printable-feedback {
                            position: absolute;
                            left: 0;
                            top: 0;
                            width: 100%;
                            background: white !important;
                        }
                        .print\\:hidden { display: none !important; }
                    }
                `}</style>

                <div id="printable-feedback" className="flex-1 overflow-y-auto bg-white">
                    {/* Hero Section */}
                    <div className="px-8 py-8 md:flex md:items-start md:justify-between bg-gradient-to-b from-white to-gray-50/50">
                        <div className="space-y-4">
                            <div>
                                <h1 className="text-3xl font-black text-gray-900">{feedback.stores?.name}</h1>
                                <div className="flex items-center gap-2 mt-2 text-gray-500 text-sm font-medium">
                                    <MapPin size={16} />
                                    <span>{feedback.stores?.city || 'Ubicación'}, {feedback.stores?.state || 'MX'}</span>
                                    <span className="text-gray-300">|</span>
                                    <Calendar size={16} />
                                    <span>{new Date(feedback.submission_date).toLocaleString('es-MX', { dateStyle: 'long', timeStyle: 'short' })}</span>
                                </div>
                            </div>

                            {(feedback.customer_name || feedback.customer_email) && (
                                <div className="flex flex-wrap gap-3 mt-4">
                                    {feedback.customer_name && (
                                        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-blue-50 text-blue-700 text-xs font-bold border border-blue-100">
                                            <User size={12} /> {feedback.customer_name}
                                        </div>
                                    )}
                                    {feedback.customer_email && (
                                        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gray-100 text-gray-600 text-xs font-bold border border-gray-200">
                                            <Mail size={12} /> {feedback.customer_email}
                                        </div>
                                    )}
                                    {feedback.customer_phone && (
                                        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gray-100 text-gray-600 text-xs font-bold border border-gray-200">
                                            <Phone size={12} /> {feedback.customer_phone}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* NPS Badge */}
                        <div className="mt-6 md:mt-0 flex flex-col items-end">
                            <div className="text-center">
                                <div className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">NPS Score</div>
                                <div className={`text-5xl font-black ${getScoreColor(feedback.nps_score)}`}>{feedback.nps_score}</div>
                                <div className={`inline-block px-3 py-1 rounded-full text-[10px] font-black uppercase mt-1 border ${getScoreBagdeColor(feedback.nps_category)}`}>
                                    {feedback.nps_category}
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="h-px bg-gray-100 mx-8"></div>

                    {/* Ratings Grid (Dynamic if template loaded, else legacy) */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 px-8 py-8">
                        {template ? (
                            questions.filter((q: Question) => q.type === 'rating_5').map((q: Question) => (
                                <RatingItem
                                    key={q.id}
                                    label={q.text}
                                    score={feedback.answers?.[q.text] || 0}
                                    qId={q.id}
                                />
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

                    {/* Other Dynamic Questions */}
                    {template && questions.filter((q: Question) => !['rating_5', 'nps_10', 'photo'].includes(q.type)).length > 0 && (
                        <div className="px-8 pb-8 space-y-4">
                            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest">Respuestas Detalladas</h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {questions.filter((q: Question) => !['rating_5', 'nps_10', 'photo'].includes(q.type)).map((q: Question) => (
                                    <div key={q.id} className="p-4 rounded-xl bg-gray-50 border border-gray-100 flex flex-col">
                                        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">{q.text}</span>
                                        <p className="text-gray-900 font-bold">{String(feedback.answers?.[q.text] || '-')}</p>

                                        {questionPhotosMap[q.id]?.length > 0 && (
                                            <div className="mt-3 flex gap-2">
                                                {questionPhotosMap[q.id].map((url: string, idx: number) => (
                                                    <a key={idx} href={url} target="_blank" rel="noopener noreferrer" className="w-12 h-12 rounded-lg overflow-hidden border border-gray-200">
                                                        <img src={getEmbeddableImageUrl(url)} alt="Evidence" className="w-full h-full object-cover" />
                                                    </a>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Customer Voice */}
                    <div className="px-8 pb-8">
                        <div className="bg-gray-50 rounded-2xl p-6 relative border border-gray-100">
                            <MessageSquare className="absolute -top-3 -left-3 text-white bg-red-600 p-1.5 rounded-xl shadow-md h-8 w-8" />
                            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3 pl-2">La Voz del Cliente</h3>
                            <p className="text-gray-800 text-lg font-medium italic leading-relaxed">
                                "{feedback.comments || feedback.customer_comments || 'El cliente no dejó comentarios adicionales.'}"
                            </p>
                        </div>
                    </div>

                    {/* Evidence Gallery */}
                    {feedback.photo_urls && feedback.photo_urls.length > 0 && (
                        <div className="px-8 pb-8">
                            <div className="flex items-center gap-2 mb-4">
                                <Camera size={18} className="text-gray-400" />
                                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest">Evidencia Adjunta</h3>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {feedback.photo_urls.map((url: string, i: number) => (
                                    <a
                                        key={i}
                                        href={url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="group relative block aspect-video rounded-2xl overflow-hidden bg-gray-100 border border-gray-200 shadow-sm"
                                    >
                                        <img
                                            src={getEmbeddableImageUrl(url)}
                                            alt={`Evidencia ${i + 1}`}
                                            referrerPolicy="no-referrer"
                                            className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                                        />
                                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all flex items-center justify-center">
                                            <div className="bg-white/90 backdrop-blur text-gray-900 text-xs font-bold px-4 py-2 rounded-full opacity-0 group-hover:opacity-100 transform translate-y-2 group-hover:translate-y-0 transition-all duration-300 shadow-lg">
                                                Ver Pantalla Completa
                                            </div>
                                        </div>
                                    </a>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {/* Admin Footer */}
                {isAdmin && (
                    <div className="bg-gray-50 border-t p-6 relative">
                        <div className="flex items-start gap-4">
                            <div className="bg-white p-2 rounded-xl border shadow-sm text-indigo-600">
                                <Shield size={24} />
                            </div>
                            <div className="flex-1">
                                <h3 className="text-sm font-bold text-gray-900">Panel de Acción Gerencial</h3>
                                <p className="text-xs text-gray-500 mb-3">Deja instrucciones claras para el seguimiento de este caso.</p>

                                <textarea
                                    className="w-full text-sm p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none resize-none h-20 bg-white transition-all shadow-sm"
                                    placeholder="Escribe instrucciones para los supervisores..."
                                    value={adminNotes}
                                    onChange={(e) => setAdminNotes(e.target.value)}
                                />

                                <div className="flex justify-end mt-3">
                                    <button
                                        onClick={handleNotifySupervisor}
                                        disabled={isSending}
                                        className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-xl text-sm font-bold shadow-lg shadow-indigo-200 transition-all flex items-center gap-2 hover:scale-[1.02] active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {isSending ? 'Procesando...' : '🔔 Notificar'}
                                    </button>
                                    <button
                                        onClick={handleConcludeReview}
                                        disabled={isSending}
                                        className="bg-green-600 hover:bg-green-700 text-white px-5 py-2.5 rounded-xl text-sm font-bold shadow-lg shadow-green-200 transition-all flex items-center gap-2 hover:scale-[1.02] active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {isSending ? 'Procesando...' : '✅ Concluir'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}
