'use client'

import { useState, useEffect } from 'react'

export default function SurpriseLoader() {
    const [stage, setStage] = useState(0)

    // Sequence: 
    // 0: Logo (Tacos Gavilan)
    // 1: Ya Esta (Ready!)
    const images = [
        { src: '/logo.png', alt: 'Tacos Gavilan', width: 150 },
        { src: '/ya%20esta.png', alt: '¡Ya Casi!', width: 160 }
    ]

    useEffect(() => {
        const timer = setInterval(() => {
            setStage((prev) => (prev + 1) % images.length)
        }, 600) // Change image every 600ms
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
                        <img
                            src={img.src}
                            alt={img.alt}
                            width={img.width}
                            height={150}
                            style={{ width: 'auto', height: 'auto' }}
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



            <style>{`
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
            `}</style>
        </div>
    )
}
