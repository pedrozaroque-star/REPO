'use client'

import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-red-500 to-red-700 flex items-center justify-center p-8">
      <div className="text-center text-white">
        <div className="text-9xl font-bold mb-4">404</div>
        <div className="text-6xl mb-8">🌮</div>
        <h1 className="text-4xl font-bold mb-4">¡Página No Encontrada!</h1>
        <p className="text-xl mb-8 text-red-100">
          Parece que este taco se escapó del menú...
        </p>
        <Link
          href="/dashboard"
          className="inline-block px-8 py-4 bg-white text-red-600 font-bold text-lg rounded-lg hover:bg-red-50 transition-colors shadow-lg"
        >
          🏠 Volver al Dashboard
        </Link>
      </div>
    </div>
  )
}