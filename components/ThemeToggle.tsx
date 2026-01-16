'use client'

import { useState, useEffect } from 'react'
import { Sun, Moon } from 'lucide-react'
import { motion } from 'framer-motion'

export default function ThemeToggle() {
    const [isDark, setIsDark] = useState(false)

    useEffect(() => {
        // Al montar, revisar si ya existe una preferencia o si el sistema prefiere oscuro
        const savedTheme = localStorage.getItem('teg-theme')
        const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches

        if (savedTheme === 'dark' || (!savedTheme && systemPrefersDark)) {
            setIsDark(true)
            document.documentElement.classList.add('dark')
        }
    }, [])

    const toggleTheme = () => {
        const newTheme = !isDark ? 'dark' : 'light'
        setIsDark(!isDark)

        if (newTheme === 'dark') {
            document.documentElement.classList.add('dark')
            localStorage.setItem('teg-theme', 'dark')
        } else {
            document.documentElement.classList.remove('dark')
            localStorage.setItem('teg-theme', 'light')
        }
    }

    return (
        <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={toggleTheme}
            className="p-2 rounded-xl bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-slate-400 hover:bg-gray-200 dark:hover:bg-slate-700 transition-all border border-gray-200 dark:border-slate-700 flex items-center justify-center"
            title={isDark ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
        >
            {isDark ? (
                <Sun size={20} className="text-yellow-500" />
            ) : (
                <Moon size={20} className="text-indigo-600" />
            )}
        </motion.button>
    )
}
