'use client'

/**
 * @module app/checklists/page
 * @description Tablero principal y listado de checklists operativos de asistentes para Tacos Gavilan.
 * @businessRules
 * - Asistentes solo pueden consultar y editar los checklists de su tienda y autoría propia.
 * - Gerentes y Supervisores pueden auditar y revisar checklists de sus tiendas asignadas.
 * - Respeta la regla de jornada laboral (6:00 AM a 5:59 AM) y corte de turno PM (5:00 PM).
 * @dataFlow
 * - Supabase ('assistant_checklists' + 'stores' + 'users') -> Filtros React -> Tabla / Tarjetas Mobile -> ChecklistReviewModal.
 * @notes Corrige loops de reapertura de modal en deep links, normaliza conteos de estadísticas y soporta estado 'cerrado'.
 */

import { useEffect, useState, useMemo, useRef, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { FileText, Plus, Filter } from 'lucide-react'
import ProtectedRoute, { useAuth } from '@/components/ProtectedRoute'
import ChecklistReviewModal from '@/components/ChecklistReviewModal'
import { canEditChecklist, getStatusColor, getStatusLabel, formatDateLA, isOverdue } from '@/lib/checklistPermissions'
import { getSupabaseClient, formatStoreName } from '@/lib/supabase'
import SurpriseLoader from '@/components/SurpriseLoader'
import { useLanguage } from '@/lib/i18n'

function ChecklistsContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user } = useAuth()
  const { t } = useLanguage()
  const [checklists, setChecklists] = useState<any[]>([])
  const [stats, setStats] = useState({
    total: 0,
    daily: 0,
    temperaturas: 0,
    sobrante: 0,
    recorrido: 0,
    cierre: 0,
    apertura: 0
  })
  const [loading, setLoading] = useState(true)
  const [typeFilter, setTypeFilter] = useState('all')
  const [storeFilter, setStoreFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [stores, setStores] = useState<any[]>([])
  const [showReviewModal, setShowReviewModal] = useState(false)
  const [selectedChecklist, setSelectedChecklist] = useState<any>(null)
  const processedDeepLinkIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (user) {
      fetchStores()
    }
  }, [user])

  useEffect(() => {
    if (user) {
      fetchData()
    }
  }, [typeFilter, storeFilter, statusFilter, user, stores])

  // 🔗 EFECTO: Abrir modal si viene ID en la URL (Notificaciones)
  useEffect(() => {
    const checkUrlForModal = async () => {
      const id = searchParams.get('id')
      if (id && processedDeepLinkIdRef.current !== id) {
        // 1. Buscar en la lista ya cargada (comparando como string)
        const found = checklists.find(c => c.id.toString() === id)

        if (found) {
          processedDeepLinkIdRef.current = id
          setSelectedChecklist(found)
          setShowReviewModal(true)
        } else {
          // 2. Si no está (ej. filtro activo o muy viejo), buscarlo individualmente
          try {
            const supabase = await getSupabaseClient()
            const { data, error } = await supabase
              .from('assistant_checklists')
              .select('*, stores(name, code), users!user_id(full_name)')
              .eq('id', id)
              .single()

            if (data && !error) {
              const formatted = {
                ...data,
                store_name: formatStoreName((data as any).stores?.name) || 'N/A'
              }
              processedDeepLinkIdRef.current = id
              setSelectedChecklist(formatted)
              setShowReviewModal(true)
            }
          } catch (e) {
            console.error('Error fetching deep link checklist', e)
          }
        }
      }

      // 🔄 AUTO-OPEN LATEST (Fallback para notificaciones)
      const autoOpen = searchParams.get('auto_open')
      if (autoOpen === 'latest' && user && !processedDeepLinkIdRef.current) {
        try {
          const supabase = await getSupabaseClient()
          const { data, error } = await supabase
            .from('assistant_checklists')
            .select('*, stores(name, code), users!user_id(full_name)')
            .eq('user_id', user.id)
            .order('fecha_revision_manager', { ascending: false })
            .limit(1)
            .single()

          if (data && !error) {
            const formatted = {
              ...data,
              store_name: formatStoreName((data as any).stores?.name) || 'N/A'
            }
            processedDeepLinkIdRef.current = `latest-${data.id}`
            setSelectedChecklist(formatted)
            setShowReviewModal(true)
          }
        } catch (e) {
          console.error('Error auto-opening latest:', e)
        }
      }
    }
    checkUrlForModal()
  }, [searchParams, checklists, loading, user])

  const fetchStores = async () => {
    try {
      const supabase = await getSupabaseClient()
      const res = await supabase.from('stores').select('*')
      const data = res.data
      let loadedStores = Array.isArray(data) ? data : []

      const userScope = (user as any)?.store_scope
      if (user?.role === 'asistente' && Array.isArray(userScope) && userScope.length > 0) {
        loadedStores = loadedStores.filter(s => userScope.includes(s.code) || userScope.includes(s.name))
      }

      setStores(loadedStores)
    } catch (err) {
      console.error('Error tiendas:', err)
    }
  }

  const fetchData = async () => {
    try {
      const supabase = await getSupabaseClient()

      // Construcción de Query con Cliente Supabase
      let query = supabase
        .from('assistant_checklists')
        .select('*, stores(name, code), users!user_id(full_name)')
        .order('checklist_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(100)

      if (typeFilter !== 'all') query = query.eq('checklist_type', typeFilter)
      if (storeFilter !== 'all') query = query.eq('store_id', storeFilter)

      const userScope = (user as any)?.store_scope

      // 🔒 FILTRO PARA ASISTENTES - Solo su tienda Y sus checklists
      if (user?.role === 'asistente') {
        let allowedStoreIds: any[] = []
        if (Array.isArray(userScope) && userScope.length > 0) {
          allowedStoreIds = stores
            .filter(s => userScope.includes(s.code) || userScope.includes(s.name))
            .map(s => s.id)
        }
        if (allowedStoreIds.length > 0) {
          query = query.in('store_id', allowedStoreIds)
        }

        // SOLO sus propios checklists
        query = query.eq('user_id', user.id)
      }
      // 🔒 FILTRO PARA MANAGERS - Solo su tienda asignada
      else if (user?.role === 'manager' && (user as any)?.store_id) {
        query = query.eq('store_id', (user as any).store_id)
      }

      const { data: checkData, error } = await query

      if (error) throw error

      const formattedData = Array.isArray(checkData) ? checkData.map(item => ({
        ...item,
        store_name: formatStoreName(item.stores?.name) || 'N/A'
      })) : []

      // 🔍 Filtrado Frontend por Status
      const filteredData = statusFilter === 'all'
        ? formattedData
        : formattedData.filter(item => (item.estatus_manager || 'pendiente') === statusFilter)

      setChecklists(filteredData)

      // Stats
      let statsQuery = supabase.from('assistant_checklists').select('checklist_type')

      if (user?.role === 'asistente') {
        let allowedStoreIds: any[] = []
        if (Array.isArray(userScope) && userScope.length > 0) {
          allowedStoreIds = stores
            .filter(s => userScope.includes(s.code) || userScope.includes(s.name))
            .map(s => s.id)
        }
        if (allowedStoreIds.length > 0) {
          statsQuery = statsQuery.in('store_id', allowedStoreIds)
        }
        statsQuery = statsQuery.eq('user_id', user.id)
      } else if (user?.role === 'manager' && (user as any)?.store_id) {
        statsQuery = statsQuery.eq('store_id', (user as any).store_id)
      }

      const { data: allChecks, error: errStats } = await statsQuery
      if (errStats) throw errStats
      const allChecksArray = Array.isArray(allChecks) ? allChecks : []

      setStats({
        total: allChecksArray.length,
        daily: allChecksArray.filter(c => c.checklist_type === 'daily').length,
        temperaturas: allChecksArray.filter(c => c.checklist_type === 'temperaturas').length,
        sobrante: allChecksArray.filter(c => c.checklist_type === 'sobrante').length,
        recorrido: allChecksArray.filter(c => c.checklist_type === 'recorrido').length,
        cierre: allChecksArray.filter(c => c.checklist_type === 'cierre').length,
        apertura: allChecksArray.filter(c => c.checklist_type === 'apertura').length
      })

      setLoading(false)
    } catch (err) {
      console.error('Error:', err)
      setLoading(false)
    }
  }

  const checklistTypes = [
    { value: 'daily', label: t('checklists.daily'), icon: '📝', color: 'border-blue-600' },
    { value: 'temperaturas', label: t('checklists.temps'), icon: '🌡️', color: 'border-red-600' },
    { value: 'sobrante', label: t('checklists.leftover'), icon: '📦', color: 'border-yellow-600' },
    { value: 'recorrido', label: t('checklists.tour'), icon: '🚶', color: 'border-green-600' },
    { value: 'cierre', label: t('checklists.closing'), icon: '🌙', color: 'border-purple-600' },
    { value: 'apertura', label: t('checklists.opening'), icon: '🌅', color: 'border-orange-600' }
  ]

  const getTypeInfo = (type: string) => {
    return checklistTypes.find(t => t.value === type) || checklistTypes[0]
  }

  const getStatusBadge = (item: any) => {
    let status = item.estatus_manager || 'pendiente'

    // Override: Si Supervisor/Admin ya aprobó, mostrar ese estado
    let extraLabel = ''
    if (item.estatus_admin && item.estatus_admin !== 'pendiente') {
      status = item.estatus_admin
      extraLabel = ' (Sup)'
    }

    const colorClass = getStatusColor(status)
    const label = (t(`status.${status.toLowerCase()}`) || getStatusLabel(status)) + extraLabel

    return (
      <span className={`px-2 py-1 rounded text-xs font-semibold border ${colorClass}`}>
        {label}
      </span>
    )
  }

  const canReview = () => {
    const role = user?.role?.toLowerCase()
    return role === 'manager' || role === 'admin'
  }

  const handleEdit = (item: any) => {
    if (!user) return

    const dateToCheck = item.checklist_date || item.created_at
    const editCheck = canEditChecklist(dateToCheck, user.role, item.user_id, user.id, item.estatus_manager)

    if (!editCheck.canEdit) {
      alert(editCheck.reason)
      return
    }

    router.push(`/checklists/editar/${item.checklist_type}/${item.id}`)
  }

  const canUserEdit = (item: any) => {
    if (!user) return false
    const dateToCheck = item.checklist_date || item.created_at
    const editCheck = canEditChecklist(dateToCheck, user.role, item.user_id, user.id, item.estatus_manager)
    return editCheck.canEdit
  }

  const handleRowClick = (item: any) => {
    // Only open modal if not clicking edit button
    setSelectedChecklist(item)
    setShowReviewModal(true)
  }

  if (loading) {
    return <SurpriseLoader />
  }

  if (!user) return null

  // --- DISEÑO ACTUALIZADO MOBILE-FIRST ---
  return (
    <div className="flex bg-transparent dark:bg-neutral-900 pb-20 font-sans relative overflow-hidden w-full">
      <div className="absolute inset-0 opacity-10 dark:opacity-40 pointer-events-none bg-[url('https://www.transparenttextures.com/patterns/cubes.png')]"></div>
      <main className="flex-1 flex flex-col h-full w-full relative">

        {/* STICKY HEADER - Mobile & Desktop */}
        <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-gray-200 dark:border-slate-800 shadow-sm sticky top-14 lg:top-0 z-30 shrink-0 transition-all">
          <div className="max-w-7xl mx-auto px-4 md:px-8 h-16 flex items-center justify-between gap-4">
            {/* Title Area */}
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                <FileText size={18} />
              </div>
              <div>
                <h1 className="text-lg md:text-xl font-black text-gray-900 dark:text-white tracking-tight leading-none">{t('checklists.title')}</h1>
                <p className="hidden md:block text-[10px] text-gray-400 dark:text-slate-500 font-bold uppercase tracking-widest mt-1">{t('checklists.subtitle')}</p>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3">
              {/* Desktop Filter */}
              <div className="hidden md:block">
                <select
                  value={storeFilter}
                  onChange={(e) => setStoreFilter(e.target.value)}
                  className="px-3 py-1.5 rounded-full bg-gray-100 dark:bg-slate-800 border-none outline-none focus:ring-2 focus:ring-indigo-200 dark:focus:ring-indigo-900/50 text-sm font-bold text-gray-600 dark:text-slate-300 cursor-pointer transition-all"
                >
                  <option value="all">{t('checklists.all_stores')}</option>
                  {stores.map(store => (
                    <option key={store.id} value={store.id}>{formatStoreName(store.name)}</option>
                  ))}
                </select>
              </div>

              <button
                onClick={() => router.push('/checklists/crear')}
                className="w-8 h-8 md:w-auto md:h-auto md:px-4 md:py-1.5 rounded-full bg-blue-600 dark:bg-slate-100 text-white dark:text-slate-900 flex items-center justify-center gap-2 hover:bg-blue-700 dark:hover:bg-white transition-transform active:scale-95 shadow-lg shadow-blue-200 dark:shadow-none"
              >
                <Plus size={16} strokeWidth={3} />
                <span className="hidden md:inline font-bold text-xs tracking-wide">{t('checklists.new_checklist')}</span>
              </button>
            </div>
          </div>
        </div>

        {/* SCROLLABLE CONTENT */}
        <div className="w-full max-w-7xl mx-auto p-4 md:p-8 pb-24">

          {/* Mobile Filters */}
          <div className="md:hidden sticky top-0 z-10 -mt-2 mb-6 space-y-3">
            <div className="relative group shadow-lg shadow-gray-200/50 dark:shadow-none rounded-full">
              <select
                value={storeFilter}
                onChange={(e) => setStoreFilter(e.target.value)}
                className="w-full pl-4 pr-10 py-3 rounded-full bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 outline-none focus:border-indigo-300 dark:focus:border-indigo-800 text-sm font-bold text-gray-900 dark:text-white appearance-none transition-all"
              >
                <option value="all">{t('checklists.all_stores')}</option>
                {stores.map(store => (
                  <option key={store.id} value={store.id}>{formatStoreName(store.name)}</option>
                ))}
              </select>
              <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-gray-500 dark:text-slate-400">
                <Filter size={16} />
              </div>
            </div>

            <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar">
              {['all', 'pendiente', 'aprobado', 'rechazado', 'cerrado'].map(status => (
                <button
                  key={status}
                  onClick={() => setStatusFilter(status)}
                  className={`px-4 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-colors border ${statusFilter === status
                    ? 'bg-gray-900 dark:bg-slate-100 text-white dark:text-slate-900 border-gray-900 dark:border-slate-100'
                    : 'bg-white dark:bg-slate-800 text-gray-500 dark:text-slate-400 border-gray-200 dark:border-slate-700'
                    }`}
                >
                  {status === 'all' ? t('checklists.all_status') : (t(`status.${status}`) || getStatusLabel(status))}
                </button>
              ))}
            </div>
          </div>

          {/* Stats Cards - Adaptive Grid */}
          <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-3 mb-6">
            <div className="bg-white/90 dark:bg-slate-900/90 backdrop-blur-sm rounded-2xl shadow-sm p-3 md:p-4 border-l-4 border-indigo-600 border-y border-r border-gray-100 dark:border-slate-800 transition-all">
              <p className="text-[10px] md:text-xs font-bold text-gray-400 dark:text-slate-500 uppercase">{t('checklists.total')}</p>
              <p className="text-xl md:text-2xl font-black text-gray-900 dark:text-white md:mt-1">{stats.total}</p>
            </div>
            <div className="bg-white/90 dark:bg-slate-900/90 backdrop-blur-sm rounded-2xl shadow-sm p-3 md:p-4 border-l-4 border-blue-600 border-y border-r border-gray-100 dark:border-slate-800 transition-all">
              <p className="text-[10px] md:text-xs font-bold text-gray-400 dark:text-slate-500 uppercase">📝 {t('checklists.daily')}</p>
              <p className="text-xl md:text-2xl font-black text-gray-900 dark:text-white md:mt-1">{stats.daily}</p>
            </div>
            <div className="bg-white/90 dark:bg-slate-900/90 backdrop-blur-sm rounded-2xl shadow-sm p-3 md:p-4 border-l-4 border-red-600 border-y border-r border-gray-100 dark:border-slate-800 transition-all">
              <p className="text-[10px] md:text-xs font-bold text-gray-400 dark:text-slate-500 uppercase">🌡️ {t('checklists.temps')}</p>
              <p className="text-xl md:text-2xl font-black text-gray-900 dark:text-white md:mt-1">{stats.temperaturas}</p>
            </div>
            <div className="bg-white/90 dark:bg-slate-900/90 backdrop-blur-sm rounded-2xl shadow-sm p-3 md:p-4 border-l-4 border-yellow-600 border-y border-r border-gray-100 dark:border-slate-800 transition-all">
              <p className="text-[10px] md:text-xs font-bold text-gray-400 dark:text-slate-500 uppercase">📦 {t('checklists.leftover')}</p>
              <p className="text-xl md:text-2xl font-black text-gray-900 dark:text-white md:mt-1">{stats.sobrante}</p>
            </div>
            <div className="bg-white/90 dark:bg-slate-900/90 backdrop-blur-sm rounded-2xl shadow-sm p-3 md:p-4 border-l-4 border-green-600 border-y border-r border-gray-100 dark:border-slate-800 transition-all">
              <p className="text-[10px] md:text-xs font-bold text-gray-400 dark:text-slate-500 uppercase">🚶 {t('checklists.tour')}</p>
              <p className="text-xl md:text-2xl font-black text-gray-900 dark:text-white md:mt-1">{stats.recorrido}</p>
            </div>
            <div className="bg-white/90 dark:bg-slate-900/90 backdrop-blur-sm rounded-2xl shadow-sm p-3 md:p-4 border-l-4 border-purple-600 border-y border-r border-gray-100 dark:border-slate-800 transition-all">
              <p className="text-[10px] md:text-xs font-bold text-gray-400 dark:text-slate-500 uppercase">🌙 {t('checklists.closing')}</p>
              <p className="text-xl md:text-2xl font-black text-gray-900 dark:text-white md:mt-1">{stats.cierre}</p>
            </div>
            <div className="bg-white/90 dark:bg-slate-900/90 backdrop-blur-sm rounded-2xl shadow-sm p-3 md:p-4 border-l-4 border-orange-600 border-y border-r border-gray-100 dark:border-slate-800 col-span-2 md:col-span-1 transition-all">
              <p className="text-[10px] md:text-xs font-bold text-gray-400 dark:text-slate-500 uppercase tracking-widest">🌅 {t('checklists.opening')}</p>
              <p className="text-xl md:text-2xl font-black text-gray-900 dark:text-white md:mt-1">{stats.apertura}</p>
            </div>
          </div>

          {/* CHECKLISTS LIST - Mobile Cards & Desktop Table */}
          {checklists.length === 0 ? (
            <div className="text-center py-20 opacity-50">
              <FileText size={64} className="mx-auto text-gray-300 mb-4" />
              <p className="text-gray-900 font-bold">{t('checklists.empty')}</p>
            </div>
          ) : (
            <>
              {/* MOBILE CARDS (Hidden on Desktop) */}
              <div className="lg:hidden space-y-4">
                {checklists.map((item) => {
                  const typeInfo = getTypeInfo(item.checklist_type)
                  const scoreColor = item.score >= 87 ? 'text-green-600' : item.score >= 70 ? 'text-orange-600' : 'text-red-600'
                  const canEdit = canUserEdit(item)
                  const isItemOverdue = isOverdue(item.created_at, item.estatus_admin || item.estatus_manager)

                  return (
                    <div
                      key={`card-${item.id}-${item.checklist_type}`}
                      onClick={() => handleRowClick(item)}
                      className={`bg-white/90 dark:bg-slate-900/90 backdrop-blur-sm rounded-3xl p-5 shadow-[0_2px_15px_-5px_rgba(0,0,0,0.05)] dark:shadow-none border transition-all active:scale-[0.98] ${isItemOverdue ? 'border-red-200 dark:border-red-900/50 bg-red-50/30' : 'border-gray-100 dark:border-slate-800'}`}
                    >
                      <div className="flex justify-between items-start mb-3">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="font-black text-lg text-gray-900 dark:text-white">{item.store_name}</h3>
                            <span className={`px-2 py-0.5 rounded-md text-[10px] font-black uppercase ${item.shift === 'AM' ? 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-400' : 'bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-300'}`}>
                              {item.shift}
                            </span>
                          </div>
                          <p className="text-xs text-gray-500 dark:text-slate-400 font-medium">
                            {formatDateLA(item.checklist_date || item.created_at)} • {item.start_time?.split('.')[0]} - {item.end_time?.split('.')[0]}
                          </p>
                        </div>
                        <div className="text-right">
                          <span className={`text-2xl font-black ${scoreColor}`}>{item.score}%</span>
                          <div className="mt-1">{getStatusBadge(item)}</div>
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-3 border-t border-dashed border-gray-100 dark:border-slate-800">
                        <div className="flex items-center gap-2 text-sm font-bold text-gray-700 dark:text-slate-300">
                          <span className="text-lg">{typeInfo.icon}</span>
                          {typeInfo.label}
                        </div>
                        {canEdit && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              handleEdit(item)
                            }}
                            className="px-3 py-1.5 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-lg text-xs font-bold"
                          >
                            ✏️ {t('checklists.edit')}
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* DESKTOP TABLE (Hidden on Mobile) */}
              <div className="hidden lg:block bg-white dark:bg-slate-900 rounded-xl shadow-md dark:shadow-none overflow-hidden border border-gray-100 dark:border-slate-800">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50 dark:bg-slate-800/50 border-b border-gray-200 dark:border-slate-800">
                      <tr>
                        <th className="px-6 py-4 text-left text-xs font-bold text-gray-400 dark:text-slate-500 uppercase tracking-wider">{t('checklists.date')}</th>
                        <th className="px-6 py-4 text-left text-xs font-bold text-gray-400 dark:text-slate-500 uppercase tracking-wider">{t('checklists.type')}</th>
                        <th className="px-6 py-4 text-left text-xs font-bold text-gray-400 dark:text-slate-500 uppercase tracking-wider">{t('checklists.store')}</th>
                        <th className="px-6 py-4 text-left text-xs font-bold text-gray-400 dark:text-slate-500 uppercase tracking-wider">{t('checklists.shift')}</th>
                        <th className="px-6 py-4 text-left text-xs font-bold text-gray-400 dark:text-slate-500 uppercase tracking-wider">{t('checklists.user')}</th>
                        <th className="px-6 py-4 text-center text-xs font-bold text-gray-400 dark:text-slate-500 uppercase tracking-wider">{t('checklists.duration')}</th>
                        <th className="px-6 py-4 text-center text-xs font-bold text-gray-400 dark:text-slate-500 uppercase tracking-wider">{t('checklists.score')}</th>
                        <th className="px-6 py-4 text-center text-xs font-bold text-gray-400 dark:text-slate-500 uppercase tracking-wider">{t('checklists.status')}</th>
                        <th className="px-6 py-4 text-center text-xs font-bold text-gray-400 dark:text-slate-500 uppercase tracking-wider">{t('checklists.actions')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                      {checklists.map((item) => {
                        const typeInfo = getTypeInfo(item.checklist_type)
                        const isItemOverdue = isOverdue(item.created_at, item.estatus_admin || item.estatus_manager)
                        const canEdit = canUserEdit(item)

                        // Calculate Duration
                        let duration = 'N/A'
                        if (item.start_time && item.end_time) {
                          try {
                            const startParts = item.start_time.split(':').map(Number)
                            const endParts = item.end_time.split(':').map(Number)
                            if (startParts.length >= 2 && endParts.length >= 2) {
                              const startMinutes = startParts[0] * 60 + startParts[1]
                              const endMinutes = endParts[0] * 60 + endParts[1]
                              let diff = endMinutes - startMinutes
                              if (diff < 0) diff += 24 * 60
                              const hours = Math.floor(diff / 60)
                              const mins = diff % 60
                              duration = hours > 0 ? `${hours}h ${mins}m` : `${mins} min`
                            }
                          } catch (e) { }
                        }

                        return (
                          <tr
                            key={`row-${item.id}-${item.checklist_type}`}
                            className={`hover:bg-gray-50/80 dark:hover:bg-slate-800/50 transition-colors cursor-pointer ${isItemOverdue ? 'bg-red-50/50 dark:bg-red-900/10' : ''} border-b border-gray-100 dark:border-slate-800`}
                            onClick={() => handleRowClick(item)}
                          >
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="text-sm font-bold text-gray-900 dark:text-white">{formatDateLA(item.checklist_date || item.created_at)}</div>
                              <div className="text-xs text-gray-400 dark:text-slate-500">{item.start_time?.split('.')[0]} - {item.end_time?.split('.')[0]}</div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-700 dark:text-slate-200">
                              <span className="flex items-center gap-2">
                                <span className="text-lg">{typeInfo.icon}</span>
                                {typeInfo.label}
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 dark:text-slate-400">{item.store_name}</td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <span className={`px-2 py-1 rounded text-xs font-bold ${item.shift === 'AM' ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400' : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'}`}>
                                {item.shift}
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 dark:text-slate-400 truncate max-w-[150px]">{item.users?.full_name || 'N/A'}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-center">
                              <span className="text-xs font-bold text-gray-500 dark:text-slate-400 bg-gray-100 dark:bg-slate-800 px-2 py-1 rounded-full">{duration}</span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-center">
                              <span className={`text-lg font-black ${item.score >= 87 ? 'text-green-600' : item.score >= 70 ? 'text-orange-600' : 'text-red-600'}`}>{item.score}%</span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-center">
                              {getStatusBadge(item)}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-center">
                              {canEdit && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    handleEdit(item)
                                  }}
                                  className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-bold text-xs bg-blue-50 dark:bg-blue-900/30 px-3 py-1.5 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors"
                                >
                                  {t('checklists.edit')}
                                </button>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

        </div>
      </main>

      {showReviewModal && user && selectedChecklist && (
        <ChecklistReviewModal
          isOpen={showReviewModal}
          onClose={() => setShowReviewModal(false)}
          checklist={selectedChecklist}
          currentUser={{
            id: user.id,
            name: user.name || user.email,
            email: user.email,
            role: user.role
          }}
          onUpdate={() => {
            setShowReviewModal(false)
            fetchData()
          }}
        />
      )}
    </div>
  )
}

export default function ChecklistsPage() {
  return (
    <ProtectedRoute>
      <Suspense fallback={
        <div className="min-h-screen flex items-center justify-center dark:bg-neutral-900">
          <SurpriseLoader />
        </div>
      }>
        <ChecklistsContent />
      </Suspense>
    </ProtectedRoute>
  )
}