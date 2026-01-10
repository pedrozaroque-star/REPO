'use client'

import React, { useState, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Camera, Star, Info, X, Check, Trash2, Image as ImageIcon, Sparkles } from 'lucide-react'
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
    checklistType?: string
}

// Helper to check if question is new (7 days)
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

export default function DynamicQuestion({ question, index, value, photos, onChange, onPhotosChange, checklistType }: QuestionProps) {
    const [uploading, setUploading] = useState(false)
    const fileInputRef = useRef<HTMLInputElement>(null)

    const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files?.length) return
        setUploading(true)
        try {
            const urls = await uploadPhotos(Array.from(e.target.files), 'checklist-photos', `question-${question.id}`)
            onPhotosChange([...photos, ...urls])
        } catch (err) {
            alert('Error al subir foto')
        } finally {
            setUploading(false)
            if (fileInputRef.current) fileInputRef.current.value = ''
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
                                    ? opt === 'SI' ? 'bg-blue-600 border-blue-600 text-white shadow-blue-200' : opt === 'NO' ? 'bg-pink-600 border-pink-600 text-white shadow-pink-200' : 'bg-gray-600 border-gray-600 text-white'
                                    : 'bg-white border-gray-100 text-gray-500 hover:border-blue-200 hover:text-blue-600'
                                    }`}
                            >
                                {opt === 'SI' ? 'SÍ' : opt === 'NO' ? 'NO' : 'N/A'}
                            </button>
                        ))}
                    </div>
                )

            case 'rating_5':
                return (
                    <div className="flex justify-between items-center py-2 px-2 bg-gray-50 rounded-2xl border border-gray-100">
                        {[1, 2, 3, 4, 5].map(val => (
                            <button
                                key={val}
                                type="button"
                                onClick={() => onChange(val)}
                                className={`p-2 transition-transform active:scale-75 ${value >= val ? 'text-yellow-400 scale-110' : 'text-gray-200'}`}
                            >
                                <Star size={32} fill={value >= val ? 'currentColor' : 'none'} strokeWidth={3} className="drop-shadow-sm" />
                            </button>
                        ))}
                    </div>
                )

            case 'nps_10':
                return (
                    <div className="flex flex-wrap gap-2 justify-center bg-gray-50 p-3 rounded-2xl border border-gray-100">
                        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(val => (
                            <button
                                key={val}
                                type="button"
                                onClick={() => onChange(val)}
                                className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs transition-all shadow-sm ${value === val
                                    ? val >= 9 ? 'bg-green-500 text-white scale-110 shadow-lg' : val >= 7 ? 'bg-yellow-500 text-white scale-110 shadow-lg' : 'bg-red-500 text-white scale-110 shadow-lg'
                                    : 'bg-white text-gray-400 border border-gray-200 hover:border-gray-400'
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
                        className="w-full p-4 bg-gray-50 border-2 border-transparent focus:bg-white focus:border-blue-500 rounded-xl outline-none text-gray-900 font-medium placeholder:text-gray-400 transition-all min-h-[100px] resize-none text-sm"
                    />
                )

            case 'number':
                const numVal = Number(value)
                const isOverLimit = checklistType === 'sobrante' && !isNaN(numVal) && numVal > 2
                return (
                    <div className="relative">
                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 font-bold">#</span>
                        <input
                            type="number"
                            value={value || ''}
                            onChange={(e) => onChange(e.target.value)}
                            placeholder="0"
                            className={`w-full pl-8 p-4 bg-gray-50 border-2 rounded-xl outline-none text-gray-900 font-black text-xl transition-all placeholder:text-gray-300 ${isOverLimit
                                ? 'border-red-500 bg-red-50 focus:bg-white'
                                : 'border-transparent focus:bg-white focus:border-blue-500'}`}
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
                    <div className="text-center py-6 bg-blue-50 rounded-2xl border-2 border-dashed border-blue-200 text-blue-600">
                        <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center mx-auto mb-2 shadow-sm">
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
                            { label: 'CUMPLE', val: 100, color: 'bg-green-500', text: 'text-green-600', border: 'border-green-200', bg: 'bg-green-50' },
                            { label: 'PARCIAL', val: 60, color: 'bg-orange-500', text: 'text-orange-600', border: 'border-orange-200', bg: 'bg-orange-50' },
                            { label: 'NO', val: 0, color: 'bg-red-500', text: 'text-red-600', border: 'border-red-200', bg: 'bg-red-50' }
                        ].map(opt => {
                            const isSelected = value === opt.val
                            return (
                                <button
                                    key={opt.val}
                                    type="button"
                                    onClick={() => onChange(opt.val)}
                                    className={`flex-1 py-3 px-2 rounded-xl flex flex-col items-center justify-center gap-1 transition-all duration-200 border-2 ${isSelected
                                        ? `${opt.color} border-transparent text-white shadow-lg scale-105`
                                        : `bg-white ${opt.border} ${opt.text} hover:bg-gray-50`
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
                    ? 'bg-white shadow-sm border border-gray-100 opacity-80 hover:opacity-100'
                    : 'bg-white shadow-lg shadow-blue-50 border border-blue-100 z-10 scale-[1.01] ring-1 ring-blue-100'
                }
            `}
        >
            <div className="flex flex-col gap-4">
                {/* Header: Number and Text */}
                <div className="flex gap-4 items-start">
                    <div className={`
                        w-8 h-8 rounded-full flex items-center justify-center font-black text-xs flex-shrink-0 transition-colors mt-1
                        ${isAnswered ? 'bg-green-100 text-green-700' : 'bg-blue-600 text-white shadow-blue-200 shadow-md'}
                    `}>
                        {isAnswered ? <Check size={14} strokeWidth={4} /> : index + 1}
                    </div>

                    <div className="flex-1">
                        <h4 className={`font-bold text-base leading-snug ${isAnswered ? 'text-gray-600' : 'text-gray-900'}`}>
                            {question.text}
                            {isNew(question.created_at) && (
                                <span className="inline-flex items-center gap-1 ml-2 px-1.5 py-0.5 bg-blue-100 text-blue-700 text-[9px] uppercase font-black rounded-full border border-blue-200 align-middle">
                                    <Sparkles size={8} /> NEW <span className="text-blue-500 font-medium normal-case tracking-normal ml-0.5">({new Date(question.created_at!).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: '2-digit' })})</span>
                                </span>
                            )}
                        </h4>

                        {question.required_photo && (
                            <div className="mt-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-red-50 text-red-600 text-[10px] font-bold uppercase tracking-wider border border-red-100">
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
                <div className="flex gap-3 overflow-x-auto pb-2 pt-1 border-t border-gray-50 mt-1">
                    <AnimatePresence>
                        {photos.map((url) => (
                            <motion.div key={url} initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} className="relative group/delete flex-shrink-0">
                                {isVideo(url) ? (
                                    <video src={url} className="w-16 h-16 object-cover rounded-xl shadow-sm border border-gray-200 bg-black" muted playsInline />
                                ) : (
                                    <img src={url} className="w-16 h-16 object-cover rounded-xl shadow-sm border border-gray-200" alt="Evidence" />
                                )}
                                <button onClick={() => removePhoto(url)} className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center shadow-md scale-0 group-hover/delete:scale-100 transition-transform z-10">
                                    <X size={12} strokeWidth={3} />
                                </button>
                            </motion.div>
                        ))}
                    </AnimatePresence>

                    <button
                        type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading}
                        className={`
                            h-16 w-16 rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-1 transition-all flex-shrink-0
                            ${(photos.length === 0 && !isAnswered) ? 'border-gray-300 text-gray-400 bg-gray-50' : 'border-gray-200 text-gray-300'}
                            hover:border-blue-400 hover:text-blue-500 hover:bg-blue-50
                        `}
                    >
                        <Camera size={20} />
                        <span className="text-[9px] font-bold uppercase">Foto/Video</span>
                    </button>
                    <input type="file" ref={fileInputRef} onChange={handlePhotoUpload} className="hidden" accept="image/*,video/*" multiple />
                </div>
            </div>
        </motion.div>
    )
}
