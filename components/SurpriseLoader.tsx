'use client'

import { useState, useEffect } from 'react'
import Image from 'next/image'

export default function SurpriseLoader() {
    const [stage, setStage] = useState(0)

    // Sequence: 
    // 0: Logo (Tacos Gavilan)
    // 1: Tacos (Cooking...)
    // 2: Ya Esta (Ready!)
    const images = [
        { src: '/logo.png', alt: 'Tacos Gavilan', width: 150 },
        { src: '/tacos.png', alt: 'Preparando Tacos...', width: 180 },
        { src: '/ya esta.png', alt: '¡Ya Casi!', width: 160 }
    ]

    useEffect(() => {
        const timer = setInterval(() => {
            setStage((prev) => (prev + 1) % images.length)
        }, 800) // Change image every 800ms
        return () => clearInterval(timer)
    }, [])

    return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50">
            <div className="relative w-64 h-64 flex items-center justify-center mb-8">
                {/* We absolutely position images to cross-fade or just swap cleanly */}
                {images.map((img, index) => (
                    <div
                        key={img.src}
                        className={`absolute transition-all duration-500 ease-in-out transform ${index === stage
                            ? 'opacity-100 scale-110 rotate-0'
                            : 'opacity-0 scale-75 rotate-12'
                            }`}
                    >
                        <Image
                            src={img.src}
                            alt={img.alt}
                            width={img.width}
                            height={150}
                            style={{ width: 'auto', height: 'auto' }}
                            priority={index === 0}
                            className="drop-shadow-xl object-contain"
                        />
                    </div>
                ))}

                {/* Orbiting particles for extra "Surprise" effect */}
                <div
                    className="absolute inset-0 pointer-events-none"
                    style={{ animation: 'spin 3s linear infinite' }}
                >
                    <div className="absolute top-0 left-1/2 w-4 h-4 bg-red-500 rounded-full blur-sm opacity-50"></div>
                    <div className="absolute bottom-0 left-1/2 w-4 h-4 bg-yellow-500 rounded-full blur-sm opacity-50"></div>
                </div>
            </div>

            <div className="text-center">
                <h2 className="text-2xl font-bold text-gray-800 animate-pulse">
                    {stage === 0 && 'Cargando Sistema...'}
                    {stage === 1 && 'Preparando Ingredientes...'}
                    {stage === 2 && '¡Ya casi está listo!'}
                </h2>
                <div className="flex justify-center space-x-2 mt-4">
                    <div className={`w-3 h-3 rounded-full transition-colors duration-300 ${stage === 0 ? 'bg-red-600 scale-125' : 'bg-gray-300'}`}></div>
                    <div className={`w-3 h-3 rounded-full transition-colors duration-300 ${stage === 1 ? 'bg-yellow-500 scale-125' : 'bg-gray-300'}`}></div>
                    <div className={`w-3 h-3 rounded-full transition-colors duration-300 ${stage === 2 ? 'bg-green-600 scale-125' : 'bg-gray-300'}`}></div>
                </div>
            </div>

            <style>{`
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
            `}</style>
        </div>
    )
}
