'use client'

import React, { useState, useRef } from 'react'
import { Camera, X, Image as ImageIcon, Loader2, Star, Check, AlertCircle } from 'lucide-react'
import { getSupabaseClient } from '@/lib/supabase'
import { motion, AnimatePresence } from 'framer-motion'

interface DynamicQuestionProps {
    question: {
        id: string
        text: string
        type: string // 'yes_no', 'text', 'rating_5', 'nps_10', 'photo', 'temperature', 'sobrante', etc.
        options?: string[]
        required_photo?: boolean
        description?: string
    }
    value: any
    photos: string[]
    onChange: (value: any) => void
    onPhotosChange: (urls: string[]) => void
    disabled?: boolean
    index?: number
    checklistType?: string
}

export default function DynamicQuestion({
    question,
    value,
    photos = [],
    onChange,
    onPhotosChange,
    disabled = false,
    index,
    checklistType
}: DynamicQuestionProps) {
    const [uploading, setUploading] = useState(false)
    const fileInputRef = useRef<HTMLInputElement>(null)

    const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files
        if (!files || files.length === 0) return

        setUploading(true)
        try {
            const supabase = await getSupabaseClient()
            const newUrls: string[] = []

            for (let i = 0; i < files.length; i++) {
                const file = files[i]
                const fileExt = file.name.split('.').pop()
                const fileName = `${Math.random().toString(36).substring(2, 15)}_${Date.now()}.${fileExt}`
                const filePath = `uploads/${fileName}`

                const { error: uploadError } = await supabase.storage
                    .from('checklist-photos')
                    .upload(filePath, file)

                if (uploadError) throw uploadError

                const { data: { publicUrl } } = supabase.storage
                    .from('checklist-photos')
                    .getPublicUrl(filePath)

                newUrls.push(publicUrl)
            }

            onPhotosChange([...photos, ...newUrls])
        } catch (error) {
            console.error('Error uploading photo:', error)
            alert('Error al subir la imagen. Intenta de nuevo.')
        } finally {
            setUploading(false)
            if (fileInputRef.current) fileInputRef.current.value = ''
        }
    }

    const removePhoto = (indexToRemove: number) => {
        onPhotosChange(photos.filter((_, i) => i !== indexToRemove))
    }

    const renderInput = () => {
        switch (question.type) {
            case 'yes_no':
                return (
                    <div className="flex gap-2">
                        {['SI', 'NO', 'NA'].map((option) => {
                            const isActive = value === option
                            let colorClass = 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                            if (isActive) {
                                if (option === 'SI') colorClass = 'bg-green-100 text-green-700 border-green-200 ring-2 ring-green-500 ring-offset-1'
                                if (option === 'NO') colorClass = 'bg-red-100 text-red-700 border-red-200 ring-2 ring-red-500 ring-offset-1'
                                if (option === 'NA') colorClass = 'bg-gray-800 text-white border-gray-700 ring-2 ring-gray-900 ring-offset-1'
                            }

                            return (
                                <button
                                    key={option}
                                    type="button"
                                    disabled={disabled}
                                    onClick={() => onChange(option)}
                                    className={`flex-1 py-3 px-4 rounded-xl font-black text-sm transition-all border border-transparent ${colorClass} disabled:opacity-50`}
                                >
                                    {option}
                                </button>
                            )
                        })}
                    </div>
                )

            case 'rating_5':
                return (
                    <div className="flex gap-2 justify-center py-2">
                        {[1, 2, 3, 4, 5].map((rating) => (
                            <button
                                key={rating}
                                type="button"
                                disabled={disabled}
                                onClick={() => onChange(rating)}
                                className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${value === rating
                                        ? 'bg-yellow-400 text-white transform scale-110 shadow-lg'
                                        : 'bg-gray-100 text-gray-400 hover:bg-yellow-100'
                                    }`}
                            >
                                <Star size={20} className={value === rating ? 'fill-current' : ''} />
                            </button>
                        ))}
                    </div>
                )

            case 'nps_10':
                return (
                    <div className="flex flex-wrap gap-1 justify-center py-2">
                        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((rating) => {
                            let bgClass = 'bg-red-100 text-red-600'
                            if (rating >= 7) bgClass = 'bg-yellow-100 text-yellow-600'
                            if (rating >= 9) bgClass = 'bg-green-100 text-green-600'

                            const isActive = value === rating
                            return (
                                <button
                                    key={rating}
                                    type="button"
                                    disabled={disabled}
                                    onClick={() => onChange(rating)}
                                    className={`w-8 h-8 rounded-lg text-xs font-bold transition-all ${isActive
                                            ? 'bg-gray-900 text-white transform scale-110 shadow-lg z-10'
                                            : `${bgClass} hover:opacity-80`
                                        }`}
                                >
                                    {rating}
                                </button>
                            )
                        })}
                    </div>
                )

            case 'text':
            case 'textarea':
                return (
                    <textarea
                        value={value || ''}
                        disabled={disabled}
                        onChange={(e) => onChange(e.target.value)}
                        placeholder="Escribe tu respuesta aquí..."
                        className="w-full p-4 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all resize-none min-h-[100px]"
                    />
                )

            case 'photo':
                return (
                    <div className="bg-blue-50 p-4 rounded-xl border border-blue-100 text-center">
                        <p className="text-blue-600 text-xs font-bold mb-2">Esta pregunta requiere evidencia fotográfica obligatoria</p>
                    </div>
                )

            case 'temperature':
                return (
                    <div className="flex items-center gap-2">
                        <input
                            type="number"
                            value={value || ''}
                            disabled={disabled}
                            onChange={(e) => onChange(e.target.value)}
                            placeholder="0.0"
                            step="0.1"
                            className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-lg font-bold text-center focus:ring-2 focus:ring-blue-500 outline-none"
                        />
                        <span className="text-gray-500 font-bold">°C</span>
                    </div>
                )

            case 'sobrante':
                return (
                    <div className="flex items-center gap-2">
                        <input
                            type="number"
                            value={value || ''}
                            disabled={disabled}
                            onChange={(e) => onChange(e.target.value)}
                            placeholder="0"
                            className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-lg font-bold text-center focus:ring-2 focus:ring-blue-500 outline-none"
                        />
                        <span className="text-gray-500 font-bold">Unidades</span>
                    </div>
                )

            default:
                // Default to text input for unknown types
                return (
                    <input
                        type="text"
                        value={value || ''}
                        disabled={disabled}
                        onChange={(e) => onChange(e.target.value)}
                        placeholder="Respuesta..."
                        className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                    />
                )
        }
    }

    return (
        <div className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
            <div className="flex items-start gap-4 mb-4">
                {index !== undefined && (
                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-gray-100 text-gray-500 flex items-center justify-center text-[10px] font-black">
                        {index + 1}
                    </span>
                )}
                <div className="flex-1">
                    <p className="font-bold text-gray-900 text-sm leading-relaxed">
                        {question.text}
                        {question.required_photo && <span className="ml-2 text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-black uppercase tracking-wider">Foto</span>}
                    </p>
                    {question.description && (
                        <p className="text-xs text-gray-400 mt-1">{question.description}</p>
                    )}
                </div>
            </div>

            <div className="space-y-4">
                {/* Input Area */}
                {renderInput()}

                {/* Photos Area */}
                <div className="space-y-3">
                    {photos.length > 0 && (
                        <div className="grid grid-cols-4 gap-2">
                            <AnimatePresence>
                                {photos.map((url, i) => (
                                    <motion.div
                                        key={url}
                                        initial={{ opacity: 0, scale: 0.8 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        exit={{ opacity: 0, scale: 0.8 }}
                                        className="relative aspect-square rounded-xl overflow-hidden group"
                                    >
                                        <img src={url} alt="Evidencia" className="w-full h-full object-cover" />
                                        {!disabled && (
                                            <button
                                                type="button"
                                                onClick={() => removePhoto(i)}
                                                className="absolute top-1 right-1 bg-black/50 hover:bg-red-500 text-white p-1 rounded-full backdrop-blur-sm transition-colors opacity-0 group-hover:opacity-100"
                                            >
                                                <X size={12} />
                                            </button>
                                        )}
                                    </motion.div>
                                ))}
                            </AnimatePresence>
                        </div>
                    )}

                    {!disabled && (
                        <div className="flex justify-end">
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/*"
                                multiple
                                className="hidden"
                                onChange={handlePhotoUpload}
                            />
                            <button
                                type="button"
                                disabled={uploading}
                                onClick={() => fileInputRef.current?.click()}
                                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${photos.length > 0
                                        ? 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                        : 'bg-blue-50 text-blue-600 hover:bg-blue-100'
                                    }`}
                            >
                                {uploading ? (
                                    <>
                                        <Loader2 size={14} className="animate-spin" />
                                        <span>Subiendo...</span>
                                    </>
                                ) : (
                                    <>
                                        <Camera size={14} />
                                        <span>{photos.length > 0 ? 'Agregar más fotos' : 'Agregar foto'}</span>
                                    </>
                                )}
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
