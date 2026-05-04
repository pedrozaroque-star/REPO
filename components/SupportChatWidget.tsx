'use client'

import React, { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { MessageSquare, X, Send, Bot, User, Loader2, Maximize2, Minimize2, Sparkles, ArrowRight, Plus, Compass, ChevronDown } from 'lucide-react'
import { useLanguage } from '@/lib/i18n'

interface Message { id: string; role: 'user' | 'assistant'; content: string }

const PROMPTS = {
  es: {
    tabs: ['Ventas', 'Operaciones', 'Equipo', 'Calidad', 'Aprender'],
    hero: 'Administra tu negocio a la velocidad de una conversación',
    newChat: 'Nuevo chat', explore: 'Explorar', earlier: 'ANTERIORES',
    placeholder: 'Escribe tu pregunta...', heroPlaceholder: 'Inicia un nuevo chat...',
    powered: 'TEG Internal AI Core', welcome: '¡Hola! Soy TEG Assistant 🤖\nTu asistente de soporte técnico interno.\n\n¿En qué te puedo ayudar hoy con la plataforma?',
    errPrefix: 'Error de conexión.',
    cards: [
      { tag: 'VENTAS', text: '¿Cómo van las ventas hoy vs ayer?', color: 'from-red-500 to-orange-500' },
      { tag: 'EQUIPO', text: '¿Cuáles son las reglas de breaks en California?', color: 'from-blue-500 to-cyan-500' },
      { tag: 'OPS', text: '¿Cómo asigno roles en el tablero operativo?', color: 'from-purple-500 to-indigo-500' },
    ],
    prompts: [
      // Ventas
      ['Genera el reporte de rendimiento de ayer', 'Identifica las 10 tiendas con más variación en ventas', 'Proyecta las ventas netas de hoy', 'Compara las ventas de esta semana vs la semana pasada', 'Desglosa las ventas por canal (Uber, DoorDash, EBT)', 'Muestra el ticket promedio por tienda hoy', 'Ranking de las 15 tiendas por ventas netas'],
      // Operaciones
      ['¿Cómo asigno estaciones en el Tablero de Roles?', '¿Cómo activo el Modo Inmersivo para un monitor?', '¿Cómo funciona la regla de las 6 AM en ventas?', '¿Cómo configuro los horarios de apertura y cierre?', '¿Cómo uso el Preparador de producción?', '¿Qué es el motor de Descansos AI?'],
      // Equipo
      ['¿Cuáles son las leyes de breaks en California?', '¿Cómo creo un horario semanal para una tienda?', '¿Cómo funciona el Smart-Hybrid forecasting?', '¿Cómo registro un nuevo empleado en el sistema?', '¿Qué roles de usuario existen (Admin, Manager, etc)?', '¿Cómo funciona la Auto-Programación de empleados?'],
      // Calidad
      ['¿Cómo inicio una nueva inspección de supervisor?', '¿Cuántos checklists hay disponibles?', '¿Cómo funciona el Daily Checklist de 34 puntos?', '¿Cómo registro temperaturas correctamente?', '¿Qué es el Radar de Anomalías de descuentos?', '¿Cómo reviso y apruebo una inspección?'],
      // Aprender
      ['Explícame la arquitectura general de la plataforma', '¿Qué es el Food Cost y cómo se calcula?', '¿Cómo funciona la integración con Toast POS?', '¿Qué es el NPS y cómo se mide aquí?', '¿Cómo exporto reportes en PDF o CSV?', '¿Cómo cambio mi contraseña o preferencias?'],
    ]
  },
  en: {
    tabs: ['Sales', 'Operations', 'Team', 'Quality', 'Learn'],
    hero: 'Run your business at the speed of conversation',
    newChat: 'New chat', explore: 'Explore', earlier: 'EARLIER',
    placeholder: 'Type your question...', heroPlaceholder: 'Start a new chat...',
    powered: 'TEG Internal AI Core', welcome: "Hi! I'm TEG Assistant 🤖\nYour internal tech support assistant.\n\nHow can I help you today?",
    errPrefix: 'Connection error.',
    cards: [
      { tag: 'SALES', text: "How are today's sales vs yesterday?", color: 'from-red-500 to-orange-500' },
      { tag: 'TEAM', text: 'What are the California break rules?', color: 'from-blue-500 to-cyan-500' },
      { tag: 'OPS', text: 'How do I assign roles on the board?', color: 'from-purple-500 to-indigo-500' },
    ],
    prompts: [
      ["Generate yesterday's performance report", 'Identify top 10 stores with largest sales fluctuations', "Project today's net sales", 'Compare this week vs last week sales', 'Break down sales by channel (Uber, DoorDash, EBT)', 'Show average ticket by store today', 'Rank all 15 stores by net sales'],
      ['How do I assign stations on the Roles Board?', 'How do I activate Immersive Mode for a monitor?', 'How does the 6 AM Rule work for sales?', 'How do I set store open/close hours?', 'How do I use the Prep production tool?', 'What is the AI Breaks engine?'],
      ['What are the California break laws?', 'How do I create a weekly schedule?', 'How does Smart-Hybrid forecasting work?', 'How do I register a new employee?', 'What user roles exist (Admin, Manager, etc)?', 'How does employee Self-Scheduling work?'],
      ['How do I start a new supervisor inspection?', 'How many checklist types are available?', 'How does the 34-point Daily Checklist work?', 'How do I record temperatures correctly?', 'What is the Discount Anomaly Radar?', 'How do I review and approve an inspection?'],
      ['Explain the platform architecture', 'What is Food Cost and how is it calculated?', 'How does the Toast POS integration work?', 'What is NPS and how is it measured?', 'How do I export PDF or CSV reports?', 'How do I change my password or preferences?'],
    ]
  }
}

export default function SupportChatWidget() {
  const { language } = useLanguage()
  const txt = PROMPTS[language] || PROMPTS.es

  const [mounted, setMounted] = useState(false)
  const [isOpen, setIsOpen] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)
  const [showExplore, setShowExplore] = useState(true)
  const [activeTab, setActiveTab] = useState(0)
  const [hasChat, setHasChat] = useState(false)
  const [messages, setMessages] = useState<Message[]>([{ id: 'w', role: 'assistant', content: txt.welcome }])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [chatHistory, setChatHistory] = useState<string[]>([])
  
  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setMounted(true) }, [])
  useEffect(() => { if (!hasChat) setMessages([{ id: 'w', role: 'assistant', content: txt.welcome }]) }, [language])
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])
  useEffect(() => { if (isOpen && inputRef.current) setTimeout(() => inputRef.current?.focus(), 300) }, [isOpen, isExpanded, showExplore])
  useEffect(() => { if (isExpanded) { document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = '' } } }, [isExpanded])

  if (!mounted) return null

  const openChat = () => { setIsOpen(true); setIsExpanded(false) }
  const closeChat = () => { setIsOpen(false); setIsExpanded(false) }
  const toggleExpand = () => setIsExpanded(p => !p)

  const startNewChat = () => {
    // Save current chat title to history
    if (hasChat && messages.length > 1) {
      const firstUserMsg = messages.find(m => m.role === 'user')
      if (firstUserMsg) setChatHistory(prev => [firstUserMsg.content.slice(0, 50), ...prev].slice(0, 5))
    }
    // Reset ALL state
    const freshWelcome: Message = { id: 'w-' + Date.now(), role: 'assistant', content: txt.welcome }
    setMessages([freshWelcome])
    setInput('')
    setIsLoading(false)
    // Force explore view — use callback to ensure these happen together
    setHasChat(false)
    setShowExplore(true)
  }

  const send = async (text?: string) => {
    const msg = text || input.trim()
    if (!msg || isLoading) return
    if (!hasChat) { setHasChat(true); setShowExplore(false) }
    
    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: msg }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setIsLoading(true)
    
    try {
      const history = [...messages, userMsg].map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', content: m.content }))
      const res = await fetch('/api/support-chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: history, language }) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error')
      setMessages(prev => [...prev, { id: (Date.now()+1).toString(), role: 'assistant', content: data.reply }])
    } catch (e: any) {
      setMessages(prev => [...prev, { id: (Date.now()+1).toString(), role: 'assistant', content: `❌ ${txt.errPrefix}\n(${e.message})` }])
    } finally { setIsLoading(false) }
  }

  const handleSubmit = (e: React.FormEvent) => { e.preventDefault(); send() }

  // ─── Shared renders ───
  const renderMsgs = () => (
    <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4 bg-slate-50 dark:bg-slate-950 custom-scrollbar">
      {messages.map(msg => (
        <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
          <div className={`flex max-w-[85%] gap-2 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
            <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-1 ${msg.role === 'user' ? 'bg-slate-200 dark:bg-slate-800 rounded-full' : 'bg-gradient-to-br from-indigo-500 to-purple-600'}`}>
              {msg.role === 'user' ? <User size={13} className="text-slate-600 dark:text-slate-400" /> : <Bot size={13} className="text-white" />}
            </div>
            <div className={`px-4 py-2.5 rounded-2xl text-[13px] leading-relaxed whitespace-pre-wrap ${msg.role === 'user' ? 'bg-gradient-to-br from-indigo-600 to-purple-700 text-white rounded-tr-sm shadow-md' : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-100 dark:border-slate-700 shadow-sm rounded-tl-sm'}`}>
              {msg.content}
            </div>
          </div>
        </div>
      ))}
      {isLoading && (
        <div className="flex justify-start"><div className="flex gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center mt-1"><Bot size={13} className="text-white" /></div>
          <div className="px-4 py-3 bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 shadow-sm rounded-2xl rounded-tl-sm flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-indigo-400 animate-bounce" /><span className="w-2 h-2 rounded-full bg-purple-400 animate-bounce" style={{animationDelay:'150ms'}} /><span className="w-2 h-2 rounded-full bg-cyan-400 animate-bounce" style={{animationDelay:'300ms'}} />
          </div>
        </div></div>
      )}
      <div ref={endRef} />
    </div>
  )

  const renderInputBar = (ref?: any, ph?: string) => (
    <div className="p-3 bg-white dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800 flex-shrink-0">
      <form onSubmit={handleSubmit} className="relative flex items-center">
        <input ref={ref || inputRef} type="text" value={input} onChange={e => setInput(e.target.value)} placeholder={ph || txt.placeholder}
          className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-full pl-4 pr-12 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 dark:text-white transition-all" disabled={isLoading} />
        <button type="submit" disabled={!input.trim() || isLoading}
          className="absolute right-2 w-8 h-8 bg-gradient-to-br from-indigo-600 to-purple-700 disabled:from-slate-300 disabled:to-slate-400 text-white rounded-full flex items-center justify-center transition-all shadow-md disabled:shadow-none">
          {isLoading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} className="ml-0.5" />}
        </button>
      </form>
      <p className="text-center mt-1.5 text-[9px] text-slate-400 uppercase tracking-widest">{txt.powered} ✦</p>
    </div>
  )

  const renderHeader = (large?: boolean) => (
    <div className={`relative flex items-center justify-between text-white overflow-hidden flex-shrink-0 ${large ? 'p-4 sm:p-5' : 'p-4'}`}
      style={{ background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 50%, #6366f1 100%)' }}>
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 bg-white/15 backdrop-blur-sm rounded-xl flex items-center justify-center border border-white/10"><Bot size={18} /></div>
        <div>
          <h3 className="font-bold text-sm flex items-center gap-2">TEG Assistant <span className="text-[9px] font-black bg-white/15 px-1.5 py-0.5 rounded tracking-widest border border-white/10">AI</span></h3>
          <p className="text-[10px] text-indigo-100 uppercase tracking-widest flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse shadow-[0_0_6px_rgba(74,222,128,0.8)]" />Private Secure Network</p>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <button onClick={toggleExpand} className="p-1.5 hover:bg-white/20 rounded-lg transition-colors">{isExpanded ? <Minimize2 size={16}/> : <Maximize2 size={16}/>}</button>
        <button onClick={closeChat} className="p-1.5 hover:bg-white/20 rounded-lg transition-colors"><X size={18}/></button>
      </div>
    </div>
  )

  // ─── Explore Sidebar (Toast IQ style) ───
  const renderSidebar = () => (
    <div className="w-[200px] flex-shrink-0 bg-slate-50 dark:bg-slate-950 border-r border-slate-200 dark:border-slate-800 flex flex-col">
      <div className="p-3 space-y-1.5">
        <button onClick={startNewChat} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-800 transition-colors">
          <Plus size={14}/> {txt.newChat}
        </button>
        <button onClick={() => { setShowExplore(true); setHasChat(false) }}
          className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${showExplore && !hasChat ? 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300' : 'text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-800'}`}>
          <Compass size={14}/> {txt.explore}
        </button>
      </div>
      {chatHistory.length > 0 && (
        <div className="px-3 mt-2 flex-1 overflow-y-auto">
          <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-2">{txt.earlier}</p>
          {chatHistory.map((title, i) => (
            <p key={i} className="text-[11px] text-slate-500 dark:text-slate-400 truncate py-1.5 cursor-default hover:text-indigo-600 transition-colors">{title}...</p>
          ))}
        </div>
      )}
    </div>
  )

  // ─── Explore Content (prompt list) ───
  const renderExploreContent = () => (
    <div className="flex-1 flex flex-col overflow-hidden bg-white dark:bg-slate-900">
      {/* Tabs */}
      <div className="flex items-center gap-1 px-4 pt-4 pb-2 border-b border-slate-100 dark:border-slate-800 overflow-x-auto flex-shrink-0">
        {txt.tabs.map((tab, i) => (
          <button key={tab} onClick={() => setActiveTab(i)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all ${activeTab === i ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 dark:text-slate-400'}`}>
            {tab}
          </button>
        ))}
      </div>
      {/* Prompt list */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {txt.prompts[activeTab]?.map((prompt, i) => (
          <button key={i} onClick={() => send(prompt)}
            className="w-full flex items-center gap-3 p-3 rounded-xl text-left border border-slate-100 dark:border-slate-800 hover:border-indigo-200 dark:hover:border-indigo-800 hover:shadow-sm bg-white dark:bg-slate-800/50 transition-all group">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center flex-shrink-0">
              <Sparkles size={12} className="text-white" />
            </div>
            <span className="flex-1 text-[13px] text-slate-700 dark:text-slate-300 leading-snug">{prompt}</span>
            <ArrowRight size={14} className="text-slate-300 group-hover:text-indigo-500 transition-colors flex-shrink-0" />
          </button>
        ))}
      </div>
      {/* Bottom input */}
      {renderInputBar(undefined, txt.heroPlaceholder)}
    </div>
  )

  const glow = {
    boxShadow: [
      '0 0 20px rgba(99,102,241,0.3), 0 10px 40px -10px rgba(99,102,241,0.4)',
      '0 0 35px rgba(168,85,247,0.5), 0 15px 50px -10px rgba(168,85,247,0.6)',
      '0 0 25px rgba(236,72,153,0.4), 0 10px 40px -10px rgba(236,72,153,0.5)',
      '0 0 35px rgba(6,182,212,0.5), 0 15px 50px -10px rgba(6,182,212,0.6)',
      '0 0 20px rgba(99,102,241,0.3), 0 10px 40px -10px rgba(99,102,241,0.4)',
    ],
    backgroundPosition: ['0% 50%', '100% 50%', '0% 50%']
  }
  const borderStyle = {
    border: '2px solid transparent' as const,
    // Use an expanded gradient to allow for smooth panning
    backgroundImage: 'linear-gradient(#fff, #fff), linear-gradient(90deg, #6366f1, #a855f7, #ec4899, #06b6d4, #6366f1)',
    backgroundOrigin: 'border-box' as const,
    backgroundClip: 'padding-box, border-box' as const,
    backgroundSize: '100% 100%, 400% 100%'
  }



  return (
    <>
      {/* FAB */}
      <AnimatePresence>
        {!isOpen && (
          <motion.button initial={{scale:0,opacity:0}} animate={{scale:1,opacity:1}} exit={{scale:0,opacity:0}} whileHover={{scale:1.1}} whileTap={{scale:0.9}}
            onClick={openChat} className="fixed bottom-20 lg:bottom-6 right-4 lg:right-6 z-[100] group">
            <span className="absolute inset-0 rounded-full bg-indigo-500/30 animate-ping"/>
            <span className="absolute -inset-1 rounded-full bg-gradient-to-tr from-indigo-500 via-purple-500 to-cyan-400 opacity-60 blur-sm group-hover:opacity-90 transition-opacity animate-[spin_4s_linear_infinite]"/>
            <span className="relative flex items-center justify-center w-14 h-14 rounded-full bg-gradient-to-br from-indigo-600 to-purple-700 text-white shadow-2xl border border-white/20">
              <Sparkles size={24} className="fill-white/20"/>
            </span>
          </motion.button>
        )}
      </AnimatePresence>

      {/* Compact Widget */}
      <AnimatePresence>
        {isOpen && !isExpanded && (
          <motion.div key="compact" initial={{opacity:0,y:30,scale:0.9}} animate={{opacity:1,y:0,scale:1,...glow}} exit={{opacity:0,y:30,scale:0.9}}
            transition={{type:'spring',stiffness:300,damping:25,boxShadow:{duration:6,repeat:Infinity,ease:'easeInOut'},backgroundPosition:{duration:6,repeat:Infinity,ease:'linear'}}}
            className="fixed bottom-[85px] lg:bottom-6 right-4 lg:right-6 z-[100] w-[calc(100vw-32px)] sm:w-[380px] h-[500px] rounded-2xl overflow-hidden flex flex-col p-[2px]" style={{backgroundImage: 'linear-gradient(90deg, #6366f1, #a855f7, #ec4899, #06b6d4, #6366f1)', backgroundSize: '400% 100%'}}>
            <div className="flex flex-col h-full w-full bg-white dark:bg-slate-900 rounded-[14px] overflow-hidden">
              {renderHeader()}
              {renderMsgs()}
              {renderInputBar()}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Expanded Modal */}
      {isOpen && isExpanded && createPortal(
        <AnimatePresence>
          <motion.div key="bd" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} onClick={toggleExpand}
            className="fixed inset-0 z-[9998] cursor-pointer" style={{background:'radial-gradient(ellipse at center,rgba(99,102,241,0.12) 0%,rgba(0,0,0,0.5) 100%)',backdropFilter:'blur(4px)'}}/>
          <motion.div key="glow" initial={{opacity:0}} animate={{opacity:[0.25,0.5,0.25]}} transition={{duration:6,repeat:Infinity,ease:'easeInOut'}}
            className="fixed inset-0 z-[9998] pointer-events-none flex items-center justify-center">
            <div className="w-[750px] h-[650px] rounded-full" style={{background:'radial-gradient(circle,rgba(99,102,241,0.25) 0%,transparent 70%)',filter:'blur(60px)'}}/>
          </motion.div>
          <motion.div key="modal" initial={{opacity:0,scale:0.92,y:20}} animate={{opacity:1,scale:1,y:0,...glow}} exit={{opacity:0,scale:0.95,y:10}}
            transition={{type:'spring',stiffness:300,damping:28,boxShadow:{duration:6,repeat:Infinity,ease:'easeInOut'},backgroundPosition:{duration:6,repeat:Infinity,ease:'linear'}}}
            className="fixed z-[9999] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[95vw] max-w-[800px] h-[85vh] max-h-[720px] rounded-2xl overflow-hidden flex flex-col p-[2px]" style={{backgroundImage: 'linear-gradient(90deg, #6366f1, #a855f7, #ec4899, #06b6d4, #6366f1)', backgroundSize: '400% 100%'}}>
            <div className="flex flex-col h-full w-full bg-white dark:bg-slate-900 rounded-[14px] overflow-hidden">
              {renderHeader(true)}
              <div className="flex flex-1 overflow-hidden">
                {/* Sidebar - hidden on mobile */}
                <div className="hidden sm:flex">{renderSidebar()}</div>
                {/* Content */}
                {showExplore && !hasChat ? renderExploreContent() : (
                  <div className="flex-1 flex flex-col overflow-hidden bg-white dark:bg-slate-900">
                    {renderMsgs()}
                    {renderInputBar()}
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </AnimatePresence>,
        document.body
      )}
    </>
  )
}
