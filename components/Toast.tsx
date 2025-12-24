'use client'

import { useEffect, useState } from 'react'

interface ToastProps {
  message: string
  type: 'success' | 'error' | 'info'
  onClose: () => void
}

export default function Toast({ message, type, onClose }: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(() => {
      onClose()
    }, 3000)
    return () => clearTimeout(timer)
  }, [onClose])

  const colors = {
    success: 'bg-green-600',
    error: 'bg-red-600',
    info: 'bg-blue-600'
  }

  const icons = {
    success: '✅',
    error: '❌',
    info: 'ℹ️'
  }

  return (
    <div className="fixed top-4 right-4 z-50 animate-slide-in-right">
      <div className={`${colors[type]} text-white px-6 py-4 rounded-lg shadow-2xl flex items-center space-x-3 min-w-[300px]`}>
        <span className="text-2xl">{icons[type]}</span>
        <p className="font-medium flex-1">{message}</p>
        <button 
          onClick={onClose}
          className="text-white hover:text-gray-200 font-bold text-xl"
        >
          ×
        </button>
      </div>
    </div>
  )
}