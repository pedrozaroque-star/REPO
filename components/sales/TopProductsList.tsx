
'use client'

import React from 'react'
import { motion } from 'framer-motion'
import { Utensils } from 'lucide-react'

export default function TopProductsList({ data }: { data: any[] }) {
    // data format: [{ name: 'Taco Asada', qty: 50, amt: 200 }, ...]
    // Ensure sorted and top 10

    if (!data || data.length === 0) {
        return (
            <div className="bg-white/60 dark:bg-slate-900/50 border border-black/5 dark:border-slate-800 rounded-3xl p-6 backdrop-blur-xl shadow-xl shadow-black/5 flex items-center justify-center">
                <p className="text-slate-400">No hay datos de productos disponibles</p>
            </div>
        )
    }

    const maxAmt = Math.max(...data.map(d => d.amt))

    return (
        <div className="bg-white/60 dark:bg-slate-900/50 border border-black/5 dark:border-slate-800 rounded-3xl p-6 backdrop-blur-xl shadow-xl shadow-black/5">
            <h3 className="text-lg text-slate-900 dark:text-white font-semibold flex items-center gap-2 mb-6">
                <span className="w-1.5 h-6 bg-orange-500 rounded-full"></span>
                Top 10 Productos
            </h3>

            <div className="space-y-4 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                {data.map((item, idx) => (
                    <div key={idx} className="relative group">
                        <div className="flex justify-between items-center mb-1 text-sm font-medium">
                            <span className="flex items-center gap-2 text-slate-700 dark:text-slate-200">
                                <span className="bg-slate-200 dark:bg-slate-800 w-5 h-5 flex items-center justify-center rounded-full text-[10px] text-slate-500">
                                    {idx + 1}
                                </span>
                                {item.name}
                            </span>
                            <span className="text-emerald-600 dark:text-emerald-400 font-bold">
                                ${item.amt.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                            </span>
                        </div>

                        {/* Progress Bar Background */}
                        <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-1.5 overflow-hidden">
                            <motion.div
                                initial={{ width: 0 }}
                                animate={{ width: `${(item.amt / maxAmt) * 100}%` }}
                                transition={{ duration: 0.8, delay: idx * 0.05 }}
                                className="h-full bg-gradient-to-r from-orange-400 to-red-500 rounded-full"
                            />
                        </div>
                        <p className="text-[10px] text-slate-400 mt-0.5 text-right">
                            {item.qty} vendidos
                        </p>
                    </div>
                ))}
            </div>
        </div>
    )
}
