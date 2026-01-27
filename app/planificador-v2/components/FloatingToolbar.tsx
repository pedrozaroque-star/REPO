import { motion, AnimatePresence } from 'framer-motion'
import { Bot, Loader2, LayoutTemplate, RefreshCcw, ArrowDownAZ, Trash2, Printer } from 'lucide-react'

export function FloatingToolbar({
    handleGenerateSmart,
    isGenerating,
    showAIInfo,
    setShowAIInfo,
    setShowTemplateModal,
    handleSyncEmployees,
    isSyncingEmployees,
    showSyncInfo,
    setShowSyncInfo,
    handleResetOrder,
    showOrderInfo,
    setShowOrderInfo,
    handleClearDrafts,
    showClearInfo,
    setShowClearInfo,
    setShowTemplateInfo,
    showTemplateInfo,
    handlePrint, // NEW
    showPrintInfo, // NEW
    setShowPrintInfo // NEW
}: any) {
    return (
        <div className="fixed right-6 top-1/2 -translate-y-1/2 z-50 flex flex-col gap-3 p-3 bg-white/90 dark:bg-slate-900/95 backdrop-blur-2xl rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.2)] border border-white/40 dark:border-slate-700 animate-in slide-in-from-right duration-500 ring-1 ring-black/5 dark:ring-white/5">
            {/* AI Button - Primary */}
            <div className="relative group/tool">
                <motion.button
                    onClick={handleGenerateSmart}
                    disabled={isGenerating}
                    onMouseEnter={() => setShowAIInfo(true)}
                    onMouseLeave={() => setShowAIInfo(false)}
                    whileHover={isGenerating ? {} : { scale: 1.05 }}
                    whileTap={isGenerating ? {} : { scale: 0.95 }}
                    className={`p-3 rounded-2xl flex items-center justify-center transition-all shadow-lg
                            ${isGenerating ? 'bg-gray-100 dark:bg-slate-800 text-gray-400' : 'bg-indigo-600 text-white hover:bg-indigo-500 shadow-indigo-500/30 dark:shadow-indigo-500/20'}
                        `}
                >
                    {isGenerating ? <Loader2 size={24} className="animate-spin" /> : <Bot size={24} />}
                </motion.button>
                {/* ... AI Info Modal ... */}
            </div>

            {/* Template Button */}
            <div className="relative group/tool">
                <motion.button
                    onClick={() => setShowTemplateModal(true)}
                    onMouseEnter={() => setShowTemplateInfo(true)}
                    onMouseLeave={() => setShowTemplateInfo(false)}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    className="p-3 bg-amber-50 dark:bg-slate-800 border border-amber-200 dark:border-slate-700 text-amber-600 dark:text-amber-500 rounded-2xl flex items-center justify-center hover:bg-amber-500 hover:text-white dark:hover:bg-amber-600 hover:border-transparent transition-all shadow-sm"
                >
                    <LayoutTemplate size={24} />
                </motion.button>
                {/* ... Template Info ... */}
            </div>

            <div className="h-px bg-gray-200 dark:bg-slate-700 mx-3 my-1" />

            {/* Sync Button */}
            <div className="relative group/tool">
                <motion.button
                    onClick={handleSyncEmployees}
                    disabled={isSyncingEmployees}
                    onMouseEnter={() => setShowSyncInfo(true)}
                    onMouseLeave={() => setShowSyncInfo(false)}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    className="p-3 bg-gray-50 dark:bg-slate-800 text-gray-400 dark:text-slate-400 hover:bg-indigo-50 dark:hover:bg-slate-700 hover:text-indigo-600 dark:hover:text-indigo-400 border border-gray-100 dark:border-slate-700 rounded-2xl flex items-center justify-center transition-all"
                >
                    <RefreshCcw size={22} className={isSyncingEmployees ? "animate-spin" : ""} />
                </motion.button>
                {/* ... Sync Info ... */}
            </div>

            {/* Print Button */}
            <div className="relative group/tool">
                <motion.button
                    onClick={handlePrint}
                    onMouseEnter={() => setShowPrintInfo(true)}
                    onMouseLeave={() => setShowPrintInfo(false)}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    className="p-3 bg-gray-50 dark:bg-slate-800 text-gray-400 dark:text-slate-400 hover:bg-indigo-50 dark:hover:bg-slate-700 hover:text-indigo-600 dark:hover:text-indigo-400 border border-gray-100 dark:border-slate-700 rounded-2xl flex items-center justify-center transition-all"
                >
                    <Printer size={22} />
                </motion.button>
                {/* ... Print Info ... */}
            </div>

            {/* Sort Button */}
            <div className="relative group/tool">
                <motion.button
                    onClick={handleResetOrder}
                    onMouseEnter={() => setShowOrderInfo(true)}
                    onMouseLeave={() => setShowOrderInfo(false)}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    className="p-3 bg-gray-50 dark:bg-slate-800 text-gray-400 dark:text-slate-400 hover:bg-indigo-50 dark:hover:bg-slate-700 hover:text-indigo-600 dark:hover:text-indigo-400 border border-gray-100 dark:border-slate-700 rounded-2xl flex items-center justify-center transition-all"
                >
                    <ArrowDownAZ size={24} />
                </motion.button>
                {/* ... Sort Info ... */}
            </div>

            <div className="h-px bg-gray-200 dark:bg-slate-700 mx-3 my-1" />

            {/* Clear Button */}
            <div className="relative group/tool">
                <motion.button
                    onClick={handleClearDrafts}
                    onMouseEnter={() => setShowClearInfo(true)}
                    onMouseLeave={() => setShowClearInfo(false)}
                    whileHover={{ scale: 1.05, backgroundColor: '#fef2f2' }} // Light red bg hover
                    whileTap={{ scale: 0.95 }}
                    className="p-3 bg-gray-50 dark:bg-slate-800 text-gray-400 dark:text-slate-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 border border-gray-100 dark:border-slate-700 rounded-2xl flex items-center justify-center transition-all"
                >
                    <Trash2 size={24} />
                </motion.button>
                {/* ... Clear Info ... */}
            </div>
        </div>
    )
}
