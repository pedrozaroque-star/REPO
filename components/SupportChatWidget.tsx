'use client'

/**
 * @module components/SupportChatWidget
 * @description Interactive floating AI assistant widget for TEG managers with persistent conversation history, animated data charts (Recharts + Framer Motion), AI predictive follow-up questions, and full Spanish/English support.
 * @businessRules
 * - Automatically saves all user queries and AI responses to Supabase linked by user credentials.
 * - Forces generation of animated data charts for comparisons, trends, rankings, and breakdowns, omitting for conceptual queries.
 * - Predicts and suggests next-step contextual questions after each response and on the welcome screen.
 * - Enforces dynamic i18n localization (English/Spanish) for all controls, prompts, and timestamps.
 * - Fits within custom role mappings of Tacos Gavilan (Admin, Manager, Supervisor).
 * @dataFlow
 * - User Input -> POST /api/support-chat (with conversation_id & user metadata) -> Gemini Tool Loop & Animated Chart Extraction -> Supabase persistence -> Markdown Render with Recharts Visualizations & Interactive Suggestion Pills.
 * - History Navigation -> GET /api/support-chat/conversations -> GET /api/support-chat/conversations/[id] -> Load thread (rehydrates charts & suggestions).
 * - Predictive Starters -> GET /api/support-chat/conversations/predictive-suggestions -> Personalize initial cards.
 * @notes Permanent spinning circular bubble without periodic size expansion, with dual compact history drawer and expanded sidebar.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { 
  MessageSquare, X, Send, Bot, User, Loader2, Maximize2, Minimize2, 
  Sparkles, ArrowRight, Plus, Compass, History, Trash2, Clock, CheckCircle2,
  HelpCircle, ChevronRight, BarChart2
} from 'lucide-react'
import { useLanguage } from '@/lib/i18n'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import ChatAnimatedChart, { ChartConfig } from '@/components/ChatAnimatedChart'

interface Message { 
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt?: string
  suggestedQuestions?: string[]
  chart?: ChartConfig | null
}

interface SavedConversation {
  id: string
  title: string
  created_at: string
  updated_at: string
}

interface AuthUser {
  id: number | string
  email: string
  name: string
  role: string
  store_id?: string | null
}

// Parse message content to extract embedded charts and suggestions
function parseMessageContent(rawContent: string): { text: string; chart: ChartConfig | null; suggestions: string[] } {
  let text = rawContent || ''
  let chart: ChartConfig | null = null
  let suggestions: string[] = []

  // Extract chart
  const chartMatch = text.match(/(?:<<<CHART>>>|\[CHART\])([\s\S]*?)(?:<<<END_CHART>>>|<<<CHART>>>|\[END_CHART\]|$)/i)
  if (chartMatch) {
    try {
      chart = JSON.parse(chartMatch[1].trim())
      text = text.replace(/(?:<<<CHART>>>|\[CHART\])[\s\S]*?(?:<<<END_CHART>>>|<<<CHART>>>|\[END_CHART\]|$)/i, '').trim()
    } catch (e) {
      console.warn('Failed to parse chart in message content:', e)
    }
  }

  // Extract suggestions
  const sugMatch = text.match(/(?:<<<SUGGESTIONS>>>|\[SUGGESTIONS\])([\s\S]*?)(?:<<<END_SUGGESTIONS>>>|<<<SUGGESTIONS>>>|\[END_SUGGESTIONS\]|$)/i)
  if (sugMatch) {
    suggestions = sugMatch[1]
      .split('\n')
      .map(l => l.replace(/^[-*•\d.)\s]+/, '').trim())
      .filter(l => l.length >= 5 && l.length <= 160)
    text = text.replace(/(?:<<<SUGGESTIONS>>>|\[SUGGESTIONS\])[\s\S]*?(?:<<<END_SUGGESTIONS>>>|<<<SUGGESTIONS>>>|\[END_SUGGESTIONS\]|$)/i, '').trim()
  }

  return { text, chart, suggestions }
}

const PROMPTS = {
  es: {
    tabs: ['Ventas', 'Operaciones', 'Equipo', 'Calidad', 'Aprender'],
    hero: 'Administra tu tienda con datos claros al instante',
    newChat: 'Nueva consulta', 
    explore: 'Explorar', 
    earlier: 'CONSULTAS ANTERIORES',
    historyTitle: 'Historial de Consultas',
    noHistory: 'No tienes consultas previas guardadas.',
    historyBtn: 'Historial',
    deleteChat: 'Eliminar conversación',
    deleting: 'Eliminando...',
    activeBadge: 'Activa',
    suggestedNext: 'PREGUNTAS SUGERIDAS DE SEGUIMIENTO',
    predictiveSection: 'SUGERENCIAS PARA TI',
    predictiveSubtitle: 'Preguntas inteligentes basadas en tu historial y tienda',
    placeholder: 'Pregúntame sobre ventas, comida, horarios...', 
    heroPlaceholder: 'Hazme una pregunta sobre la tienda...',
    powered: 'Asistente Operativo Tacos Gavilan', 
    welcome: '¡Hola! Soy tu Asistente de Operaciones de Tacos Gavilan 🌮\n\nPuedo darte las ventas en vivo, generar gráficas interactivas comparativas, costos de comida, revisar descansos de ley, proyectar la carne de parrilla o ayudarte con cualquier duda de tu restaurante.\n\nTodas tus preguntas y gráficas se guardan automáticamente.\n\n¿Qué te gustaría revisar hoy?',
    errPrefix: 'Error de conexión.',
    cards: [
      { tag: 'VENTAS', text: '¿Cómo van las ventas hoy vs ayer?', color: 'from-red-500 to-orange-500' },
      { tag: 'EQUIPO', text: '¿Cuáles son las reglas de breaks en California?', color: 'from-blue-500 to-cyan-500' },
      { tag: 'CARNE', text: '¿Cuánta carne poner en parrilla hoy?', color: 'from-purple-500 to-indigo-500' },
    ],
    prompts: [
      // Ventas
      ['¿Cómo van las ventas hoy en mi tienda?', 'Compara las ventas de hoy vs ayer con gráfica', 'Compara las ventas de la semana pasada con la antepasada', 'Desglosa las ventas por canal (Uber, DoorDash, EBT)', '¿Cuál es el ticket promedio de hoy?', 'Ranking de las 15 tiendas por ventas netas hoy', 'Compara las ventas de esta semana vs la semana pasada'],
      // Operaciones
      ['¿Cuánta carne poner en parrilla para el siguiente tramo?', 'Calcula los descansos (breaks) de comida de hoy para Lynwood', '¿Cómo funcionan los pedidos diarios a La Bodega?', '¿Cómo funciona la regla de las 6 AM en el restaurante?', '¿Cómo uso el botón Despertar Tableta en cocina?', '¿Cómo registro el conteo de la Caja Fuerte?'],
      // Equipo
      ['¿Cuáles son las reglas de descansos y comida en California?', '¿Cómo genero el horario de la próxima semana?', 'Audita el costo de labor de Lynwood de la semana pasada', '¿Cómo registro un nuevo empleado en mi tienda?', '¿Cuáles son los roles de acceso en el sistema?', '¿Cómo se asignan las estaciones de trabajo?'],
      // Calidad
      ['¿Cómo inicio una inspección de calidad?', '¿Cuántos checklists diarios tenemos que hacer?', '¿Cómo registro las temperaturas de refrigeradores y parrillas?', '¿Cómo funciona la auditoría de descuentos?', '¿Cómo reviso las observaciones de supervisión?'],
      // Aprender
      ['¿Qué es el Food Cost y cuál es la meta (<32%)?', '¿Cómo funciona la conexión con las cajas registradoras Toast?', '¿Cómo reviso las opiniones de clientes (Google / NPS)?', '¿Cómo descargo reportes en PDF o Excel?', '¿Cómo cambio mi contraseña o idioma?'],
    ]
  },
  en: {
    tabs: ['Sales', 'Operations', 'Team', 'Quality', 'Learn'],
    hero: 'Manage your restaurant with instant clear numbers',
    newChat: 'New chat', 
    explore: 'Explore', 
    earlier: 'PAST CONVERSATIONS',
    historyTitle: 'Chat History',
    noHistory: 'No previous conversations saved yet.',
    historyBtn: 'History',
    deleteChat: 'Delete conversation',
    deleting: 'Deleting...',
    activeBadge: 'Active',
    suggestedNext: 'SUGGESTED NEXT QUESTIONS',
    predictiveSection: 'SUGGESTIONS FOR YOU',
    predictiveSubtitle: 'Smart questions tailored to your history and store',
    placeholder: 'Ask about sales, food cost, schedules...', 
    heroPlaceholder: 'Ask a question about the store...',
    powered: 'Tacos Gavilan Operations Assistant', 
    welcome: "Hi! I'm your Tacos Gavilan Operations Assistant 🌮\n\nI can help you check live sales, generate interactive comparison charts, food cost, review break compliance, calculate grill pace, or answer questions about your restaurant.\n\nAll your questions and charts are saved automatically.\n\nHow can I help you today?",
    errPrefix: 'Connection error.',
    cards: [
      { tag: 'SALES', text: "How are today's sales vs yesterday?", color: 'from-red-500 to-orange-500' },
      { tag: 'TEAM', text: 'What are the California break rules?', color: 'from-blue-500 to-cyan-500' },
      { tag: 'MEAT', text: 'How much meat to prep on the grill today?', color: 'from-purple-500 to-indigo-500' },
    ],
    prompts: [
      // Sales
      ["How are today's sales in my store?", "Compare today's sales vs yesterday with chart", 'Compare last week sales vs two weeks ago', 'Break down sales by channel (Uber, DoorDash, EBT)', 'What is the average ticket today?', 'Rank all 15 stores by net sales today', 'Compare this week vs last week sales'],
      // Operations
      ['How much meat to put on the grill for the next period?', 'Calculate meal break compliance for Lynwood today', 'How do daily warehouse orders work?', 'How does the 6 AM restaurant business day work?', 'How do I use the Awake Tablet button in the kitchen?', 'How do I log Safe Box cash counts?'],
      // Team
      ['What are California meal and rest break rules?', 'How do I create next week schedule?', 'Audit labor cost for Lynwood last week', 'How do I register a new employee?', 'What user roles exist in the platform?', 'How do I assign kitchen stations?'],
      // Quality
      ['How do I start a supervisor quality audit?', 'How many daily checklists do we need to complete?', 'How do I log fridge and grill temperatures?', 'How does the discount anomaly radar work?', 'How do I review supervisor feedback?'],
      // Learn
      ['What is Food Cost and what is our target (<32%)?', 'How does the live sync with Toast POS work?', 'How do I check customer reviews (Google / NPS)?', 'How do I export PDF or Excel reports?', 'How do I change my password or language preferences?'],
    ]
  }
}

// Relative time formatter
function formatTimeAgo(isoString: string, lang: 'es' | 'en'): string {
  try {
    const d = new Date(isoString)
    const now = new Date()
    const diffMs = now.getTime() - d.getTime()
    const diffMins = Math.floor(diffMs / (1000 * 60))
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

    if (diffMins < 2) return lang === 'es' ? 'Ahora' : 'Now'
    if (diffMins < 60) return `${diffMins}m`
    if (diffHours < 24) return `${diffHours}h`
    if (diffDays === 1) return lang === 'es' ? 'Ayer' : 'Yesterday'
    if (diffDays < 7) return `${diffDays}d`
    
    return d.toLocaleDateString(lang === 'es' ? 'es-MX' : 'en-US', { month: 'short', day: 'numeric' })
  } catch {
    return ''
  }
}

export default function SupportChatWidget() {
  const { language } = useLanguage()
  const txt = PROMPTS[language] || PROMPTS.es

  const [mounted, setMounted] = useState(false)
  const [isOpen, setIsOpen] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)
  const [showExplore, setShowExplore] = useState(true)
  const [showHistoryCompact, setShowHistoryCompact] = useState(false)
  const [activeTab, setActiveTab] = useState(0)
  const [hasChat, setHasChat] = useState(false)
  const [messages, setMessages] = useState<Message[]>([{ id: 'w', role: 'assistant', content: txt.welcome }])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  
  // User & DB Conversations
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null)
  const [savedConversations, setSavedConversations] = useState<SavedConversation[]>([])
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
  const [isLoadingHistory, setIsLoadingHistory] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  
  // Predictive smart starters
  const [predictiveStarters, setPredictiveStarters] = useState<string[]>([])
  
  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Load user from localStorage
  useEffect(() => {
    setMounted(true)
    try {
      const userStr = localStorage.getItem('teg_user')
      if (userStr) {
        const u = JSON.parse(userStr) as AuthUser
        setCurrentUser(u)
      }
    } catch (e) {
      console.error('Error reading teg_user:', e)
    }
  }, [])

  // Fetch saved conversations from Supabase
  const loadSavedConversations = useCallback(async () => {
    if (!currentUser?.email && !currentUser?.id) return
    try {
      setIsLoadingHistory(true)
      const params = new URLSearchParams()
      if (currentUser.email) params.append('user_email', currentUser.email)
      if (currentUser.id) params.append('user_id', String(currentUser.id))

      const res = await fetch(`/api/support-chat/conversations?${params.toString()}`)
      if (!res.ok) return
      const data = await res.json()
      if (Array.isArray(data.conversations)) {
        setSavedConversations(data.conversations)
      }
    } catch (e) {
      console.error('Error fetching conversations:', e)
    } finally {
      setIsLoadingHistory(false)
    }
  }, [currentUser])

  // Fetch predictive starter suggestions based on user history
  const loadPredictiveSuggestions = useCallback(async () => {
    try {
      const params = new URLSearchParams()
      if (currentUser?.email) params.append('user_email', currentUser.email)
      if (currentUser?.id) params.append('user_id', String(currentUser.id))
      if (currentUser?.store_id) params.append('store_id', String(currentUser.store_id))
      params.append('language', language)

      const res = await fetch(`/api/support-chat/conversations/predictive-suggestions?${params.toString()}`)
      if (!res.ok) return
      const data = await res.json()
      if (Array.isArray(data.suggestions) && data.suggestions.length > 0) {
        setPredictiveStarters(data.suggestions)
      }
    } catch (e) {
      console.error('Error fetching predictive suggestions:', e)
    }
  }, [currentUser, language])

  // Load history & predictive suggestions on mount or when user changes
  useEffect(() => {
    if (currentUser) {
      loadSavedConversations()
      loadPredictiveSuggestions()
    }
  }, [currentUser, loadSavedConversations, loadPredictiveSuggestions])

  useEffect(() => { 
    if (!hasChat && !activeConversationId) {
      setMessages([{ id: 'w', role: 'assistant', content: txt.welcome }]) 
    }
  }, [language, hasChat, activeConversationId, txt.welcome])

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])
  useEffect(() => { if (isOpen && inputRef.current) setTimeout(() => inputRef.current?.focus(), 300) }, [isOpen, isExpanded, showExplore, showHistoryCompact])
  useEffect(() => { if (isExpanded) { document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = '' } } }, [isExpanded])

  const openChat = () => { 
    setIsOpen(true)
    setIsExpanded(false)
    setShowHistoryCompact(false)
    loadSavedConversations()
    loadPredictiveSuggestions()
  }

  const closeChat = () => { 
    setIsOpen(false) 
    setIsExpanded(false) 
    setShowHistoryCompact(false)
  }

  const toggleExpand = () => {
    setIsExpanded(p => !p)
    setShowHistoryCompact(false)
  }

  // Start fresh chat session
  const startNewChat = () => {
    const freshWelcome: Message = { id: 'w-' + Date.now(), role: 'assistant', content: txt.welcome }
    setMessages([freshWelcome])
    setInput('')
    setIsLoading(false)
    setHasChat(false)
    setShowExplore(true)
    setShowHistoryCompact(false)
    setActiveConversationId(null)
    loadPredictiveSuggestions()
  }

  // Load a specific historical conversation (rehydrates charts & suggestions)
  const selectConversation = async (convId: string) => {
    try {
      setIsLoading(true)
      const res = await fetch(`/api/support-chat/conversations/${convId}`)
      if (!res.ok) throw new Error('Error loading conversation')
      const data = await res.json()
      
      if (Array.isArray(data.messages) && data.messages.length > 0) {
        const loadedMsgs: Message[] = data.messages.map((m: any) => {
          const parsed = parseMessageContent(m.content)
          return {
            id: m.id || String(Math.random()),
            role: m.role as 'user' | 'assistant',
            content: parsed.text,
            createdAt: m.created_at,
            chart: parsed.chart,
            suggestedQuestions: parsed.suggestions
          }
        })
        setMessages(loadedMsgs)
        setActiveConversationId(convId)
        setHasChat(true)
        setShowExplore(false)
        setShowHistoryCompact(false)
      }
    } catch (e: any) {
      console.error('Error opening conversation:', e)
    } finally {
      setIsLoading(false)
    }
  }

  // Delete a saved conversation
  const deleteConversation = async (convId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      setDeletingId(convId)
      const res = await fetch(`/api/support-chat/conversations/${convId}`, { method: 'DELETE' })
      if (res.ok) {
        setSavedConversations(prev => prev.filter(c => c.id !== convId))
        if (activeConversationId === convId) {
          startNewChat()
        }
      }
    } catch (e) {
      console.error('Error deleting conversation:', e)
    } finally {
      setDeletingId(null)
    }
  }

  // Send message
  const send = async (text?: string) => {
    const msg = text || input.trim()
    if (!msg || isLoading) return
    if (!hasChat) { setHasChat(true); setShowExplore(false); setShowHistoryCompact(false) }
    
    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: msg }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setIsLoading(true)
    
    try {
      const history = [...messages, userMsg].map(m => ({ 
        role: m.role === 'assistant' ? 'model' : 'user', 
        content: m.content 
      }))

      const payload = {
        messages: history,
        language,
        conversation_id: activeConversationId,
        user: currentUser ? {
          id: currentUser.id,
          email: currentUser.email,
          name: currentUser.name,
          role: currentUser.role,
          store_id: currentUser.store_id
        } : null
      }

      const res = await fetch('/api/support-chat', { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify(payload) 
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error')
      
      const parsed = parseMessageContent(data.reply)
      const assistantMsg: Message = { 
        id: (Date.now() + 1).toString(), 
        role: 'assistant', 
        content: parsed.text,
        chart: data.chart || parsed.chart,
        suggestedQuestions: Array.isArray(data.suggested_questions) && data.suggested_questions.length > 0 
          ? data.suggested_questions 
          : parsed.suggestions
      }

      setMessages(prev => [...prev, assistantMsg])

      if (data.conversation_id && data.conversation_id !== activeConversationId) {
        setActiveConversationId(data.conversation_id)
      }
      
      // Refresh sidebar conversation list in background
      loadSavedConversations()

    } catch (e: any) {
      setMessages(prev => [...prev, { 
        id: (Date.now() + 1).toString(), 
        role: 'assistant', 
        content: `❌ ${txt.errPrefix}\n(${e.message})` 
      }])
    } finally { 
      setIsLoading(false) 
    }
  }

  const handleSubmit = (e: React.FormEvent) => { e.preventDefault(); send() }

  // ─── Shared renders ───
  const renderMsgs = () => (
    <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4 bg-slate-50 dark:bg-slate-950 custom-scrollbar">
      {messages.map((msg, idx) => {
        const isLastAssistant = msg.role === 'assistant' && idx === messages.length - 1
        const hasSuggestions = isLastAssistant && msg.suggestedQuestions && msg.suggestedQuestions.length > 0 && !isLoading

        return (
          <div key={msg.id} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
            <div className={`flex max-w-[96%] sm:max-w-[92%] gap-2 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
              <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-1 ${msg.role === 'user' ? 'bg-slate-200 dark:bg-slate-800 rounded-full' : 'bg-gradient-to-br from-indigo-500 to-purple-600'}`}>
                {msg.role === 'user' ? <User size={13} className="text-slate-600 dark:text-slate-400" /> : <Bot size={13} className="text-white" />}
              </div>
              <div className={`px-4 py-2.5 rounded-2xl text-[13px] leading-relaxed break-words ${msg.role === 'user' ? 'bg-gradient-to-br from-indigo-600 to-purple-700 text-white rounded-tr-sm shadow-md' : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-100 dark:border-slate-700 shadow-sm rounded-tl-sm w-full overflow-hidden'}`}>
                {msg.role === 'user' ? (
                  <div className="whitespace-pre-wrap">{msg.content}</div>
                ) : (
                  <div className="w-full overflow-hidden">
                    <ReactMarkdown 
                      remarkPlugins={[remarkGfm]}
                      components={{
                        table: ({node, ...props}) => <div className="overflow-x-auto my-4"><table className="w-full border-collapse text-xs sm:text-[13px]" {...props} /></div>,
                        th: ({node, ...props}) => <th className="border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 p-2 sm:p-2.5 text-left font-semibold text-slate-800 dark:text-slate-200" {...props} />,
                        td: ({node, ...props}) => <td className="border border-slate-200 dark:border-slate-700 p-2 sm:p-2.5 text-slate-700 dark:text-slate-300" {...props} />,
                        p: ({node, ...props}) => <p className="mb-3 last:mb-0 leading-relaxed" {...props} />,
                        a: ({node, ...props}) => <a className="text-indigo-600 dark:text-indigo-400 hover:underline font-medium" {...props} />,
                        ul: ({node, ...props}) => <ul className="list-disc pl-5 mb-4 space-y-1" {...props} />,
                        ol: ({node, ...props}) => <ol className="list-decimal pl-5 mb-4 space-y-1" {...props} />,
                        li: ({node, ...props}) => <li className="pl-1" {...props} />,
                        h3: ({node, ...props}) => <h3 className="text-[15px] font-semibold mt-5 mb-2.5 text-slate-900 dark:text-white flex items-center gap-2" {...props} />,
                        h4: ({node, ...props}) => <h4 className="text-[14px] font-semibold mt-4 mb-2 text-slate-800 dark:text-slate-100" {...props} />,
                        strong: ({node, ...props}) => <strong className="font-semibold text-slate-900 dark:text-white" {...props} />
                      }}
                    >
                      {msg.content}
                    </ReactMarkdown>

                    {/* Animated Data Visualization Chart (Recharts + Framer Motion) */}
                    {msg.chart && (
                      <ChatAnimatedChart chart={msg.chart} language={language} />
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* AI Predictive Follow-up Questions (Chips) */}
            {hasSuggestions && (
              <motion.div 
                initial={{ opacity: 0, y: 6 }} 
                animate={{ opacity: 1, y: 0 }} 
                transition={{ delay: 0.15 }}
                className="mt-2.5 ml-9 flex flex-col gap-1.5 max-w-[92%]"
              >
                <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest flex items-center gap-1.5">
                  <Sparkles size={11} className="text-amber-500" /> {txt.suggestedNext}
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {msg.suggestedQuestions!.map((sug, sIdx) => (
                    <button
                      key={sIdx}
                      onClick={() => send(sug)}
                      className="group text-left text-xs px-3 py-1.5 rounded-full bg-white dark:bg-slate-800 hover:bg-indigo-50 dark:hover:bg-indigo-950/60 text-slate-700 dark:text-slate-200 hover:text-indigo-600 dark:hover:text-indigo-300 border border-slate-200 dark:border-slate-700 hover:border-indigo-300 dark:hover:border-indigo-800 shadow-xs transition-all flex items-center gap-1.5"
                    >
                      <Sparkles size={10} className="text-indigo-500 opacity-60 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                      <span className="font-medium">{sug}</span>
                      <ArrowRight size={11} className="opacity-40 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all text-indigo-500 flex-shrink-0" />
                    </button>
                  ))}
                </div>
              </motion.div>
            )}
          </div>
        )
      })}

      {isLoading && (
        <div className="flex justify-start">
          <div className="flex gap-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center mt-1">
              <Bot size={13} className="text-white" />
            </div>
            <div className="px-4 py-3 bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 shadow-sm rounded-2xl rounded-tl-sm flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-indigo-400 animate-bounce" />
              <span className="w-2 h-2 rounded-full bg-purple-400 animate-bounce" style={{animationDelay:'150ms'}} />
              <span className="w-2 h-2 rounded-full bg-cyan-400 animate-bounce" style={{animationDelay:'300ms'}} />
            </div>
          </div>
        </div>
      )}
      <div ref={endRef} />
    </div>
  )

  const renderInputBar = (ref?: any, ph?: string) => (
    <div className="p-3 bg-white dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800 flex-shrink-0">
      <form onSubmit={handleSubmit} className="relative flex items-center">
        <input 
          ref={ref || inputRef} 
          type="text" 
          value={input} 
          onChange={e => setInput(e.target.value)} 
          placeholder={ph || txt.placeholder}
          className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-full pl-4 pr-12 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 dark:text-white transition-all" 
          disabled={isLoading} 
        />
        <button 
          type="submit" 
          disabled={!input.trim() || isLoading}
          className="absolute right-2 w-8 h-8 bg-gradient-to-br from-indigo-600 to-purple-700 disabled:from-slate-300 disabled:to-slate-400 text-white rounded-full flex items-center justify-center transition-all shadow-md disabled:shadow-none"
        >
          {isLoading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} className="ml-0.5" />}
        </button>
      </form>
      <p className="text-center mt-1.5 text-[9px] text-slate-400 uppercase tracking-widest">{txt.powered} ✦</p>
    </div>
  )

  const renderHeader = (large?: boolean) => (
    <div 
      className={`relative flex items-center justify-between text-white overflow-hidden flex-shrink-0 ${large ? 'p-4 sm:p-5' : 'p-3.5 sm:p-4'}`}
      style={{ background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 50%, #6366f1 100%)' }}
    >
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 bg-white/15 backdrop-blur-sm rounded-xl flex items-center justify-center border border-white/10">
          <Bot size={18} />
        </div>
        <div>
          <h3 className="font-bold text-sm flex items-center gap-2">
            TEG Assistant 
            <span className="text-[9px] font-black bg-white/15 px-1.5 py-0.5 rounded tracking-widest border border-white/10">AI</span>
          </h3>
          <p className="text-[10px] text-indigo-100 uppercase tracking-widest flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse shadow-[0_0_6px_rgba(74,222,128,0.8)]" />
            Private Secure Network
          </p>
        </div>
      </div>
      <div className="flex items-center gap-1">
        {/* Compact History Toggle Button */}
        {!large && (
          <button 
            onClick={() => setShowHistoryCompact(prev => !prev)} 
            title={txt.historyTitle}
            className={`p-1.5 rounded-lg transition-colors ${showHistoryCompact ? 'bg-white/30 text-white font-bold' : 'hover:bg-white/20 text-white/90'}`}
          >
            <History size={16}/>
          </button>
        )}
        <button 
          onClick={toggleExpand} 
          title={isExpanded ? "Minimizar" : "Pantalla completa"}
          className="p-1.5 hover:bg-white/20 rounded-lg transition-colors"
        >
          {isExpanded ? <Minimize2 size={16}/> : <Maximize2 size={16}/>}
        </button>
        <button 
          onClick={closeChat} 
          title="Cerrar"
          className="p-1.5 hover:bg-white/20 rounded-lg transition-colors"
        >
          <X size={18}/>
        </button>
      </div>
    </div>
  )

  // ─── Explore & History Sidebar (Expanded Modal) ───
  const renderSidebar = () => (
    <div className="w-[230px] flex-shrink-0 bg-slate-50 dark:bg-slate-950 border-r border-slate-200 dark:border-slate-800 flex flex-col justify-between">
      <div className="p-3 space-y-1.5 flex-shrink-0">
        <button 
          onClick={startNewChat} 
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-white dark:hover:bg-slate-800 border border-slate-200/60 dark:border-slate-800 shadow-sm transition-all"
        >
          <Plus size={14} className="text-indigo-600 dark:text-indigo-400"/> {txt.newChat}
        </button>
        <button 
          onClick={() => { setShowExplore(true); setHasChat(false) }}
          className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${showExplore && !hasChat ? 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 font-semibold' : 'text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-800'}`}
        >
          <Compass size={14}/> {txt.explore}
        </button>
      </div>

      {/* Historical conversations list */}
      <div className="px-3 mt-1 flex-1 overflow-y-auto custom-scrollbar flex flex-col">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1">
            <Clock size={10} /> {txt.earlier}
          </p>
          {isLoadingHistory && <Loader2 size={10} className="animate-spin text-slate-400" />}
        </div>

        {savedConversations.length === 0 ? (
          <p className="text-[11px] text-slate-400 dark:text-slate-500 py-3 text-center italic">
            {txt.noHistory}
          </p>
        ) : (
          <div className="space-y-1 pb-4">
            {savedConversations.map((conv) => {
              const isActive = activeConversationId === conv.id
              const isDeleting = deletingId === conv.id
              return (
                <div
                  key={conv.id}
                  onClick={() => selectConversation(conv.id)}
                  className={`group relative flex items-center justify-between p-2 rounded-lg text-xs cursor-pointer transition-all border ${
                    isActive 
                      ? 'bg-indigo-50 dark:bg-indigo-950/60 border-indigo-200 dark:border-indigo-800/80 text-indigo-900 dark:text-indigo-200 font-medium shadow-xs' 
                      : 'border-transparent text-slate-600 dark:text-slate-400 hover:bg-white dark:hover:bg-slate-800/80 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0 pr-1">
                    <MessageSquare size={13} className={`flex-shrink-0 ${isActive ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400 group-hover:text-indigo-500'}`} />
                    <div className="truncate">
                      <p className="truncate text-[12px] leading-tight">{conv.title}</p>
                      <span className="text-[10px] text-slate-400 dark:text-slate-500">{formatTimeAgo(conv.updated_at, language)}</span>
                    </div>
                  </div>

                  <button
                    onClick={(e) => deleteConversation(conv.id, e)}
                    disabled={isDeleting}
                    title={txt.deleteChat}
                    className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-100 dark:hover:bg-red-950/60 rounded text-slate-400 hover:text-red-600 transition-all flex-shrink-0"
                  >
                    {isDeleting ? <Loader2 size={12} className="animate-spin text-red-500" /> : <Trash2 size={12} />}
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {currentUser && (
        <div className="p-3 border-t border-slate-200 dark:border-slate-800 flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
          <div className="w-5 h-5 rounded-full bg-indigo-100 dark:bg-indigo-900/60 flex items-center justify-center text-indigo-700 dark:text-indigo-300 font-bold text-[9px]">
            {currentUser.name?.[0]?.toUpperCase() || 'U'}
          </div>
          <span className="truncate">{currentUser.name || currentUser.email}</span>
        </div>
      )}
    </div>
  )

  // ─── Compact History Drawer (For Compact Mobile/Desktop Widget) ───
  const renderCompactHistoryDrawer = () => (
    <div className="flex-1 flex flex-col overflow-hidden bg-white dark:bg-slate-900">
      <div className="p-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <History size={15} className="text-indigo-600 dark:text-indigo-400" />
          <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider">{txt.historyTitle}</h4>
        </div>
        <button 
          onClick={startNewChat}
          className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-300 hover:bg-indigo-100 transition-colors"
        >
          <Plus size={12} /> {txt.newChat}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-1.5 custom-scrollbar">
        {savedConversations.length === 0 ? (
          <div className="text-center py-10 px-4">
            <Clock size={28} className="mx-auto text-slate-300 dark:text-slate-600 mb-2" />
            <p className="text-xs text-slate-500 dark:text-slate-400">{txt.noHistory}</p>
          </div>
        ) : (
          savedConversations.map((conv) => {
            const isActive = activeConversationId === conv.id
            const isDeleting = deletingId === conv.id
            return (
              <div
                key={conv.id}
                onClick={() => selectConversation(conv.id)}
                className={`group relative flex items-center justify-between p-2.5 rounded-xl border text-xs cursor-pointer transition-all ${
                  isActive 
                    ? 'bg-indigo-50 dark:bg-indigo-950/60 border-indigo-200 dark:border-indigo-800 text-indigo-900 dark:text-indigo-200 font-medium shadow-xs' 
                    : 'bg-slate-50 dark:bg-slate-800/40 border-slate-100 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:border-indigo-200 dark:hover:border-indigo-800'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0 pr-2">
                  <div className={`w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 ${isActive ? 'bg-indigo-600 text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-400'}`}>
                    <MessageSquare size={12} />
                  </div>
                  <div className="truncate">
                    <p className="truncate text-[12px] font-medium leading-snug">{conv.title}</p>
                    <span className="text-[10px] text-slate-400 dark:text-slate-500">{formatTimeAgo(conv.updated_at, language)}</span>
                  </div>
                </div>

                <button
                  onClick={(e) => deleteConversation(conv.id, e)}
                  disabled={isDeleting}
                  title={txt.deleteChat}
                  className="opacity-60 hover:opacity-100 p-1.5 hover:bg-red-100 dark:hover:bg-red-950/60 rounded text-slate-400 hover:text-red-600 transition-all flex-shrink-0"
                >
                  {isDeleting ? <Loader2 size={12} className="animate-spin text-red-500" /> : <Trash2 size={13} />}
                </button>
              </div>
            )
          })
        )}
      </div>

      <div className="p-2 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/50 text-center">
        <button 
          onClick={() => setShowHistoryCompact(false)}
          className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline py-1"
        >
          {hasChat ? '← Volver al chat' : '← Volver al inicio'}
        </button>
      </div>
    </div>
  )

  // ─── Explore Content (prompt list + predictive starters) ───
  const renderExploreContent = () => (
    <div className="flex-1 flex flex-col overflow-hidden bg-white dark:bg-slate-900">
      {/* Predictive Smart Suggestions Card (If available based on history) */}
      {predictiveStarters.length > 0 && (
        <div className="p-4 bg-gradient-to-r from-indigo-50/80 via-purple-50/60 to-cyan-50/80 dark:from-indigo-950/40 dark:via-purple-950/30 dark:to-cyan-950/40 border-b border-indigo-100/80 dark:border-indigo-900/40 flex-shrink-0">
          <div className="flex items-center gap-1.5 mb-2">
            <Sparkles size={14} className="text-indigo-600 dark:text-indigo-400 animate-pulse" />
            <h4 className="text-[11px] font-bold text-indigo-900 dark:text-indigo-200 uppercase tracking-wider">{txt.predictiveSection}</h4>
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-2.5">{txt.predictiveSubtitle}</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {predictiveStarters.map((sug, i) => (
              <button
                key={i}
                onClick={() => send(sug)}
                className="text-left p-2.5 rounded-xl bg-white/90 dark:bg-slate-800/90 hover:bg-white dark:hover:bg-slate-800 border border-indigo-100 dark:border-indigo-900/60 hover:border-indigo-300 dark:hover:border-indigo-700 shadow-xs hover:shadow-sm transition-all group flex flex-col justify-between"
              >
                <span className="text-[12px] font-medium text-slate-800 dark:text-slate-200 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 leading-snug line-clamp-2 mb-1.5">{sug}</span>
                <span className="text-[10px] text-indigo-600 dark:text-indigo-400 font-semibold flex items-center gap-1 opacity-80 group-hover:opacity-100">
                  Consultar <ArrowRight size={10} className="group-hover:translate-x-0.5 transition-transform" />
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-1 px-4 pt-3 pb-2 border-b border-slate-100 dark:border-slate-800 overflow-x-auto flex-shrink-0">
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

  return (
    <>
      {/* FAB - Meta AI "Ask" Style */}
      <AnimatePresence>
        {!isOpen && (
          <motion.button
            layout
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            whileHover={{ scale: 1 }}
            whileTap={{ scale: 0.95 }}
            onClick={openChat}
            className="fixed bottom-20 lg:bottom-6 right-4 lg:right-6 z-[100] group"
          >
            {/* Outer glow ring - spinning gradient */}
            <span className="absolute -inset-1 rounded-full bg-gradient-to-tr from-indigo-500 via-purple-500 to-cyan-400 opacity-50 blur-sm group-hover:opacity-80 transition-opacity animate-[spin_4s_linear_infinite]"/>
            {/* Main pill container */}
            <motion.span
              layout
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              className="relative flex items-center gap-2.5 rounded-full bg-gradient-to-r from-indigo-600 via-purple-600 to-indigo-700 text-white shadow-2xl border border-white/20 overflow-hidden"
              style={{ padding: '14px' }}
            >
              <motion.span layout="position" className="flex-shrink-0">
                <Sparkles size={24} className="fill-white/20" />
              </motion.span>
            </motion.span>
          </motion.button>
        )}
      </AnimatePresence>

      {/* Compact Widget */}
      <AnimatePresence>
        {isOpen && !isExpanded && (
          <motion.div 
            key="compact" 
            initial={{opacity:0,y:30,scale:0.9}} 
            animate={{opacity:1,y:0,scale:1,...glow}} 
            exit={{opacity:0,y:30,scale:0.9}}
            transition={{type:'spring',stiffness:300,damping:25,boxShadow:{duration:6,repeat:Infinity,ease:'easeInOut'},backgroundPosition:{duration:6,repeat:Infinity,ease:'linear'}}}
            className="fixed bottom-[85px] lg:bottom-6 right-4 lg:right-6 z-[100] w-[calc(100vw-32px)] sm:w-[420px] h-[560px] rounded-2xl overflow-hidden flex flex-col p-[2px]" 
            style={{backgroundImage: 'linear-gradient(90deg, #6366f1, #a855f7, #ec4899, #06b6d4, #6366f1)', backgroundSize: '400% 100%'}}
          >
            <div className="flex flex-col h-full w-full bg-white dark:bg-slate-900 rounded-[14px] overflow-hidden">
              {renderHeader()}
              {showHistoryCompact ? (
                renderCompactHistoryDrawer()
              ) : (
                <>
                  {renderMsgs()}
                  {renderInputBar()}
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Expanded Modal */}
      {isOpen && isExpanded && createPortal(
        <AnimatePresence>
          <motion.div 
            key="bd" 
            initial={{opacity:0}} 
            animate={{opacity:1}} 
            exit={{opacity:0}} 
            onClick={toggleExpand}
            className="fixed inset-0 z-[9998] cursor-pointer" 
            style={{background:'radial-gradient(ellipse at center, rgba(99,102,241,0.45) 0%, rgba(139,92,246,0.35) 25%, rgba(79,70,229,0.25) 50%, rgba(15,10,40,0.8) 100%)',backdropFilter:'blur(8px)'}}
          />
          <motion.div 
            key="glow" 
            initial={{opacity:0}} 
            animate={{opacity:[0.25,0.5,0.25]}} 
            transition={{duration:6,repeat:Infinity,ease:'easeInOut'}}
            className="fixed inset-0 z-[9998] pointer-events-none flex items-center justify-center"
          >
            <div className="w-[2000px] h-[1500px] rounded-full" style={{background:'radial-gradient(circle,rgba(99,102,241,0.35) 0%,rgba(139,92,246,0.2) 30%,rgba(79,70,229,0.08) 55%,transparent 75%)',filter:'blur(100px)'}}/>
          </motion.div>
          <motion.div 
            key="modal" 
            initial={{opacity:0,scale:0.92,y:20}} 
            animate={{opacity:1,scale:1,y:0,...glow}} 
            exit={{opacity:0,scale:0.95,y:10}}
            transition={{type:'spring',stiffness:300,damping:28,boxShadow:{duration:6,repeat:Infinity,ease:'easeInOut'},backgroundPosition:{duration:6,repeat:Infinity,ease:'linear'}}}
            className="fixed z-[9999] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[95vw] max-w-[1100px] h-[90vh] max-h-[850px] rounded-2xl overflow-hidden flex flex-col p-[2px]" 
            style={{backgroundImage: 'linear-gradient(90deg, #6366f1, #a855f7, #ec4899, #06b6d4, #6366f1)', backgroundSize: '400% 100%'}}
          >
            <div className="flex flex-col h-full w-full bg-white dark:bg-slate-900 rounded-[14px] overflow-hidden">
              {renderHeader(true)}
              <div className="flex flex-1 overflow-hidden">
                {/* Sidebar with Live Saved Conversations */}
                <div className="hidden sm:flex">{renderSidebar()}</div>
                {/* Main Chat / Explore Content */}
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
