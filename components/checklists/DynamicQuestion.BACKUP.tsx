'use client'

import React, { useState, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Camera, Star, Info, X, Check, Trash2, Image as ImageIcon, Sparkles, Video, Upload, MessageSquare } from 'lucide-react'
import { uploadPhotos } from '@/lib/uploadPhotos'

interface QuestionProps {
    question: {
        id: string
        text: string
        type: string
        required_photo?: boolean
        created_at?: string
    }
    index: number
    value: any
    photos: string[]
    onChange: (val: any) => void
    onPhotosChange: (urls: string[]) => void
    comment?: string
    onCommentChange?: (val: string) => void
    checklistType?: string
}

const isNew = (dateStr?: string) => {
    if (!dateStr) return false
    const date = new Date(dateStr)
    const now = new Date()
    const diffTime = Math.abs(now.getTime() - date.getTime())
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
    return diffDays <= 180
}

const isVideo = (url: string) => {
    return url.toLowerCase().match(/\.(mp4|mov|webm|ogg|quicktime)$/)
}

export default function DynamicQuestion({ question, index, value, photos, onChange, onPhotosChange, checklistType, comment, onCommentChange }: QuestionProps) {
    const [uploading, setUploading] = useState(false)

    // Separate refs for distinct Android intents
    const photoInputRef = useRef<HTMLInputElement>(null)
    const videoInputRef = useRef<HTMLInputElement>(null)
    const galleryInputRef = useRef<HTMLInputElement>(null)

    const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files?.length) return
        setUploading(true)
        try {
            const urls = await uploadPhotos(Array.from(e.target.files), 'checklist-photos', `question-${question.id}`)
            onPhotosChange([...photos, ...urls])
        } catch (err) {
            alert('Error al subir archivo')
        } finally {
            setUploading(false)
            // Reset all inputs
            if (photoInputRef.current) photoInputRef.current.value = ''
            if (videoInputRef.current) videoInputRef.current.value = ''
            if (galleryInputRef.current) galleryInputRef.current.value = ''
        }
    }

    const removePhoto = (url: string) => {
        onPhotosChange(photos.filter(p => p !== url))
    }

    const renderInput = () => {
        switch (question.type) {
            case 'yes_no':
                return (
                    <div className="flex gap-3">
                        {['SI', 'NO', 'NA'].map(opt => (
                            <button
                                key={opt}
                                type="button"
                                onClick={() => onChange(opt)}
                                className={`flex-1 py-3 px-2 rounded-xl font-black text-sm transition-all shadow-sm border-2 ${value === opt
                                    ? opt === 'SI'
                                        ? 'bg-green-500 border-green-500 text-white shadow-green-200' : opt === 'NO'
                                            ? 'bg-red-500 border-red-500 text-white shadow-red-200'
                                            : 'bg-gray-500 border-gray-500 text-white'
                                    : 'bg-white dark:bg-slate-800 border-gray-100 dark:border-slate-700 text-gray-500 dark:text-slate-400 hover:border-green-200 dark:hover:border-green-900 hover:text-green-600 dark:hover:text-green-400'
                                    }`}
                            >
                                {opt === 'SI' ? 'SÍ' : opt === 'NO' ? 'NO' : 'N/A'}
                            </button>
                        ))}
                    </div>
                )

            case 'rating_5':
                return (
                    <div className="flex justify-between items-center py-2 px-2 bg-gray-50 dark:bg-slate-800/50 rounded-2xl border border-gray-100 dark:border-slate-800">
                        {[1, 2, 3, 4, 5].map(val => (
                            <button
                                key={val}
                                type="button"
                                onClick={() => onChange(val)}
                                className={`p-2 transition-transform active:scale-75 ${value >= val ? 'text-yellow-400 scale-110' : 'text-gray-200 dark:text-slate-700'}`}
                            >
                                <Star size={32} fill={value >= val ? 'currentColor' : 'none'} strokeWidth={3} className="drop-shadow-sm" />
                            </button>
                        ))}
                    </div>
                )

            case 'nps_10':
                return (
                    <div className="flex flex-wrap gap-2 justify-center bg-gray-50 dark:bg-slate-800/50 p-3 rounded-2xl border border-gray-100 dark:border-slate-800">
                        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(val => (
                            <button
                                key={val}
                                type="button"
                                onClick={() => onChange(val)}
                                className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs transition-all shadow-sm ${value === val
                                    ? val >= 9 ? 'bg-green-500 text-white scale-110 shadow-lg' : val >= 7 ? 'bg-yellow-500 text-white scale-110 shadow-lg' : 'bg-red-500 text-white scale-110 shadow-lg'
                                    : 'bg-white dark:bg-slate-800 text-gray-400 dark:text-slate-500 border border-gray-200 dark:border-slate-700 hover:border-gray-400 dark:hover:border-slate-500'
                                    }`}
                            >
                                {val}
                            </button>
                        ))}
                    </div>
                )

            case 'text':
                return (
                    <textarea
                        value={value || ''}
                        onChange={(e) => onChange(e.target.value)}
                        placeholder="Escribe tus observaciones aquí..."
                        className="w-full p-4 bg-gray-50 dark:bg-slate-800/50 border-2 border-transparent focus:bg-white dark:focus:bg-slate-800/80 focus:border-blue-500 dark:focus:border-blue-600 rounded-xl outline-none text-gray-900 dark:text-white font-medium placeholder:text-gray-400 dark:placeholder:text-slate-500 transition-all min-h-[100px] resize-none text-sm"
                    />
                )

            case 'number':
                const numVal = Number(value)
                const isOverLimit = checklistType === 'sobrante' && !isNaN(numVal) && numVal > 2
                return (
                    <div className="relative">
                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 dark:text-slate-500 font-bold">#</span>
                        <input
                            type="number"
                            value={value || ''}
                            onChange={(e) => onChange(e.target.value)}
                            placeholder="0"
                            className={`w-full pl-8 p-4 bg-gray-50 dark:bg-slate-800/50 border-2 rounded-xl outline-none text-gray-900 dark:text-white font-black text-xl transition-all placeholder:text-gray-300 dark:placeholder:text-slate-600 ${isOverLimit
                                ? 'border-red-500 bg-red-50 dark:bg-red-900/20 focus:bg-white dark:focus:bg-slate-800/80'
                                : 'border-transparent focus:bg-white dark:focus:bg-slate-800/80 focus:border-blue-500 dark:focus:border-blue-600'}`}
                        />
                        {isOverLimit && (
                            <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-1 text-red-600 font-bold text-[10px] animate-pulse">
                                ⚠️ {'>'} 2 Lbs
                            </div>
                        )}
                    </div>
                )

            case 'photo':
                return (
                    <div className="text-center py-6 bg-blue-50 dark:bg-blue-900/20 rounded-2xl border-2 border-dashed border-blue-200 dark:border-blue-800 text-blue-600 dark:text-blue-400">
                        <div className="w-10 h-10 bg-white dark:bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-2 shadow-sm">
                            <ImageIcon size={18} />
                        </div>
                        <p className="text-[10px] font-black uppercase tracking-widest">Foto Requerida</p>
                    </div>
                )

            case 'compliance':
            case 'score_100':
                return (
                    <div className="flex gap-2 w-full">
                        {[
                            { label: 'CUMPLE', val: 100, color: 'bg-green-500', text: 'text-green-600 dark:text-green-400', border: 'border-green-200 dark:border-green-900/40', bg: 'bg-green-50 dark:bg-green-900/20' },
                            { label: 'PARCIAL', val: 60, color: 'bg-orange-500', text: 'text-orange-600 dark:text-orange-400', border: 'border-orange-200 dark:border-orange-900/40', bg: 'bg-orange-50 dark:bg-orange-900/20' },
                            { label: 'NO', val: 0, color: 'bg-red-500', text: 'text-red-600 dark:text-red-400', border: 'border-red-200 dark:border-red-900/40', bg: 'bg-red-50 dark:bg-red-900/20' }
                        ].map(opt => {
                            const isSelected = value === opt.val
                            return (
                                <button
                                    key={opt.val}
                                    type="button"
                                    onClick={() => onChange(opt.val)}
                                    className={`flex-1 py-3 px-2 rounded-xl flex flex-col items-center justify-center gap-1 transition-all duration-200 border-2 ${isSelected
                                        ? `${opt.color} border-transparent text-white shadow-lg scale-105`
                                        : `bg-white dark:bg-slate-800/50 ${opt.border} ${opt.text} hover:bg-gray-50 dark:hover:bg-slate-700`
                                        }`}
                                >
                                    <span className="text-[10px] font-black tracking-widest leading-none">{opt.label}</span>
                                    {isSelected && <div className="w-1 h-1 bg-white rounded-full mt-1" />}
                                </button>
                            )
                        })}
                    </div>
                )

            default:
                return <div className="p-4 bg-red-50 text-red-600 font-bold rounded-lg text-sm">Error: {question.type}</div>
        }
    }

    const isAnswered = value !== undefined && value !== '' && value !== null

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-50px" }}
            className={`
                relative rounded-3xl p-5 transition-all duration-300
                ${isAnswered
                    ? 'bg-white dark:bg-slate-900 shadow-sm border border-gray-100 dark:border-slate-800 opacity-80 hover:opacity-100'
                    : 'bg-white dark:bg-slate-900 shadow-lg shadow-blue-50 dark:shadow-none border border-blue-100 dark:border-blue-900/30 z-10 scale-[1.01] ring-1 ring-blue-100 dark:ring-blue-900/20'
                }
            `}
        >
            <div className="flex flex-col gap-4">
                {/* Header: Number and Text */}
                <div className="flex gap-4 items-start">
                    <div className={`
                        w-8 h-8 rounded-full flex items-center justify-center font-black text-xs flex-shrink-0 transition-colors mt-1
                        ${isAnswered
                            ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400'
                            : 'bg-blue-600 dark:bg-blue-700 text-white shadow-blue-200 dark:shadow-none shadow-md'}
                    `}>
                        {isAnswered ? <Check size={14} strokeWidth={4} /> : index + 1}
                    </div>

                    <div className="flex-1">
                        <h4 className={`font-bold text-base leading-snug ${isAnswered ? 'text-gray-600 dark:text-slate-400' : 'text-gray-900 dark:text-white'}`}>
                            {question.text}
                            {isNew(question.created_at) && (
                                <span className="inline-flex items-center gap-1 ml-2 px-1.5 py-0.5 bg-blue-100 dark:bg-indigo-900/30 text-blue-700 dark:text-indigo-400 text-[9px] uppercase font-black rounded-full border border-blue-200 dark:border-indigo-900/50 align-middle">
                                    <Sparkles size={8} /> NEW <span className="text-blue-500 dark:text-indigo-500 font-medium normal-case tracking-normal ml-0.5">({new Date(question.created_at!).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: '2-digit' })})</span>
                                </span>
                            )}
                        </h4>

                        {question.required_photo && (
                            <div className="mt-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-[10px] font-bold uppercase tracking-wider border border-red-100 dark:border-red-900/30">
                                <Camera size={10} strokeWidth={2.5} /> Foto
                            </div>
                        )}
                    </div>
                </div>

                {/* Input Area - Full Width */}
                <div className="w-full pt-1">
                    {renderInput()}
                </div>

                {/* Photos Section */}
                <div className="flex gap-2 overflow-x-auto pb-2 pt-1 border-t border-gray-50 dark:border-slate-800/50 mt-1 scrollbar-hide">
                    <AnimatePresence>
                        {photos.map((url) => (
                            <motion.div key={url} initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} className="relative group/delete flex-shrink-0">
                                {isVideo(url) ? (
                                    <video src={url} className="w-16 h-16 object-cover rounded-xl shadow-sm border border-gray-200 dark:border-slate-700 bg-black" muted playsInline />
                                ) : (
                                    <img src={url} className="w-16 h-16 object-cover rounded-xl shadow-sm border border-gray-200 dark:border-slate-700" alt="Evidence" />
                                )}
                                <button onClick={() => removePhoto(url)} className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center shadow-md scale-0 group-hover/delete:scale-100 transition-transform z-10">
                                    <X size={12} strokeWidth={3} />
                                </button>
                            </motion.div>
                        ))}
                    </AnimatePresence>

                    {/* BUTTON 1: CAMERA (Photos) */}
                    <button
                        type="button" onClick={() => photoInputRef.current?.click()} disabled={uploading}
                        className="h-16 w-16 rounded-xl border-2 border-dashed border-gray-200 dark:border-slate-700 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 flex flex-col items-center justify-center gap-1 flex-shrink-0 hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors"
                    >
                        <Camera size={18} />
                        <span className="text-[8px] font-black uppercase">Foto</span>
                    </button>
                    <input type="file" ref={photoInputRef} onChange={handlePhotoUpload} className="hidden" accept="image/*" capture="environment" multiple />

                    {/* BUTTON 2: VIDEO (Video) */}
                    <button
                        type="button" onClick={() => videoInputRef.current?.click()} disabled={uploading}
                        className="h-16 w-16 rounded-xl border-2 border-dashed border-gray-200 dark:border-slate-700 bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400 flex flex-col items-center justify-center gap-1 flex-shrink-0 hover:bg-purple-100 dark:hover:bg-purple-900/30 transition-colors"
                    >
                        <Video size={18} />
                        <span className="text-[8px] font-black uppercase">Video</span>
                    </button>
                    <input type="file" ref={videoInputRef} onChange={handlePhotoUpload} className="hidden" accept="video/*" capture="environment" multiple />

                    {/* BUTTON 3: GALLERY */}
                    <button
                        type="button" onClick={() => galleryInputRef.current?.click()} disabled={uploading}
                        className="h-16 w-16 rounded-xl border-2 border-dashed border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/50 text-gray-400 dark:text-slate-500 flex flex-col items-center justify-center gap-1 flex-shrink-0 hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors"
                    >
                        <ImageIcon size={18} />
                        <span className="text-[8px] font-black uppercase">Galería</span>
                    </button>
                    <input type="file" ref={galleryInputRef} onChange={handlePhotoUpload} className="hidden" accept="image/*,video/*" multiple />

                </div>
                {/* Comment Input */}
                {onCommentChange && (
                    <div className="mt-3 relative">
                        <input
                            type="text"
                            value={comment || ''}
                            onChange={(e) => onCommentChange(e.target.value)}
                            placeholder="Agregar comentario..."
                            className="w-full pl-9 pr-3 py-2.5 bg-gray-50/50 dark:bg-slate-800/50 hover:bg-gray-100 dark:hover:bg-slate-800 focus:bg-white dark:focus:bg-slate-800 rounded-xl text-xs font-medium text-gray-700 dark:text-slate-300 placeholder:text-gray-400 dark:placeholder:text-slate-500 border border-transparent focus:border-blue-300 dark:focus:border-blue-700 outline-none transition-all"
                        />
                        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
                            <MessageSquare size={14} />
                        </div>
                    </div>
                )}
            </div>
        </motion.div>
    )
}
