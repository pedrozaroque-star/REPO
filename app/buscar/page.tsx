'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'

import Link from 'next/link'
import { formatStoreName } from '@/lib/supabase'

export default function BuscarPage() {
  const searchParams = useSearchParams()
  const initialQuery = searchParams.get('q') || ''

  const [query, setQuery] = useState(initialQuery)
  const [results, setResults] = useState<any>({
    stores: [],
    users: [],
    inspections: [],
    feedbacks: [],
    checklists: []
  })
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [mounted, setMounted] = useState(false)

  React.useEffect(() => {
    setMounted(true)
    if (initialQuery) handleSearch()
  }, [])

  if (!mounted) return null

  const handleSearch = async () => {
    if (!query.trim()) return

    setLoading(true)
    setSearched(true)

    try {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

      // Buscar en tiendas
      const storesRes = await fetch(
        `${url}/rest/v1/stores?or=(name.ilike.*${query}*,city.ilike.*${query}*,code.ilike.*${query}*)&limit=10`,
        { headers: { 'apikey': key || '', 'Authorization': `Bearer ${key}` } }
      )
      const stores = await storesRes.json()

      // Buscar en usuarios
      const usersRes = await fetch(
        `${url}/rest/v1/users?or=(full_name.ilike.*${query}*,email.ilike.*${query}*)&limit=10`,
        { headers: { 'apikey': key || '', 'Authorization': `Bearer ${key}` } }
      )
      const users = await usersRes.json()

      // Buscar en inspecciones
      const inspRes = await fetch(
        `${url}/rest/v1/supervisor_inspections?select=*,stores(name),users(full_name)&limit=10`,
        { headers: { 'apikey': key || '', 'Authorization': `Bearer ${key}` } }
      )
      const inspections = await inspRes.json()

      // Buscar en feedbacks
      const feedbacksRes = await fetch(
        `${url}/rest/v1/customer_feedback?select=*,stores(name)&limit=10`,
        { headers: { 'apikey': key || '', 'Authorization': `Bearer ${key}` } }
      )
      const feedbacks = await feedbacksRes.json()

      // Buscar en checklists
      const checklistsRes = await fetch(
        `${url}/rest/v1/assistant_checklists?select=*,stores(name)&limit=10`,
        { headers: { 'apikey': key || '', 'Authorization': `Bearer ${key}` } }
      )
      const checklists = await checklistsRes.json()

      setResults({
        stores: Array.isArray(stores) ? stores : [],
        users: Array.isArray(users) ? users : [],
        inspections: Array.isArray(inspections) ? inspections : [],
        feedbacks: Array.isArray(feedbacks) ? feedbacks : [],
        checklists: Array.isArray(checklists) ? checklists : []
      })
    } catch (err) {
      console.error('Error:', err)
    }

    setLoading(false)
  }

  const totalResults = results.stores.length + results.users.length +
    results.inspections.length + results.feedbacks.length +
    results.checklists.length

  return (
    <div className="flex min-h-screen bg-transparent dark:bg-neutral-900 pb-20 font-sans relative overflow-hidden">
      <div className="absolute inset-0 opacity-10 dark:opacity-40 pointer-events-none bg-[url('https://www.transparenttextures.com/patterns/cubes.png')]"></div>

      <main className="flex-1 p-8">
        <div className="max-w-5xl mx-auto">
          <div className="mb-8">
            <h1 className="text-3xl font-black text-gray-900 dark:text-white tracking-tight leading-none italic uppercase">Búsqueda Global</h1>
            <p className="text-gray-400 dark:text-slate-500 mt-2 font-bold uppercase tracking-widest text-[10px]">Busca en todas las secciones del sistema</p>
          </div>

          {/* Search Bar */}
          <div className="bg-white/90 dark:bg-slate-900/90 backdrop-blur-sm rounded-[2rem] shadow-xl dark:shadow-none p-6 mb-12 border border-gray-100 dark:border-slate-800">
            <div className="flex flex-col md:flex-row gap-4">
              <input
                type="text"
                placeholder="Tiendas, usuarios, inspecciones..."
                className="flex-1 p-4 bg-gray-50 dark:bg-slate-800/50 border-gray-200 dark:border-slate-700 rounded-2xl outline-none focus:ring-2 focus:ring-indigo-100 dark:focus:ring-indigo-900/40 text-gray-900 dark:text-white font-bold transition-all"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              />
              <button
                onClick={handleSearch}
                disabled={loading}
                className="bg-gray-900 dark:bg-indigo-600 hover:bg-black dark:hover:bg-indigo-700 text-white px-8 py-4 rounded-2xl font-black uppercase tracking-widest text-xs transition-all shadow-lg active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <span>🔍 Buscar</span>}
              </button>
            </div>
          </div>

          {/* Results */}
          {searched && !loading && (
            <div className="space-y-6">
              {totalResults === 0 ? (
                <div className="text-center py-12 bg-white dark:bg-slate-900 rounded-3xl shadow-sm border border-gray-100 dark:border-slate-800">
                  <div className="text-6xl mb-4">🔍</div>
                  <p className="text-gray-600 dark:text-slate-400 font-bold">No se encontraron resultados para "{query}"</p>
                </div>
              ) : (
                <>
                  <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm p-6 border border-gray-100 dark:border-slate-800">
                    <p className="text-gray-900 dark:text-white font-bold">
                      Se encontraron <span className="text-red-600 dark:text-red-400">{totalResults}</span> resultados
                    </p>
                  </div>

                  {/* Tiendas */}
                  {results.stores.length > 0 && (
                    <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-sm p-6 border border-gray-100 dark:border-slate-800">
                      <h2 className="text-xl font-black text-gray-900 dark:text-white mb-4 uppercase tracking-tight">
                        🏪 Tiendas ({results.stores.length})
                      </h2>
                      <div className="space-y-3">
                        {results.stores.map((store: any) => (
                          <Link
                            key={store.id}
                            href="/tiendas"
                            className="block p-4 bg-gray-50 dark:bg-slate-800/50 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-2xl border border-transparent dark:border-slate-700/50 transition-all group"
                          >
                            <p className="font-bold text-gray-900 dark:text-white group-hover:text-red-600 dark:group-hover:text-red-400 transition-colors">{formatStoreName(store.name)}</p>
                            <p className="text-sm text-gray-500 dark:text-slate-400 font-medium">{store.address}, {store.city}</p>
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Usuarios */}
                  {results.users.length > 0 && (
                    <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-sm p-6 border border-gray-100 dark:border-slate-800">
                      <h2 className="text-xl font-black text-gray-900 dark:text-white mb-4 uppercase tracking-tight">
                        👥 Usuarios ({results.users.length})
                      </h2>
                      <div className="space-y-3">
                        {results.users.map((user: any) => (
                          <Link
                            key={user.id}
                            href="/usuarios"
                            className="block p-4 bg-gray-50 dark:bg-slate-800/50 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-2xl border border-transparent dark:border-slate-700/50 transition-all group"
                          >
                            <p className="font-bold text-gray-900 dark:text-white group-hover:text-red-600 dark:group-hover:text-red-400 transition-colors">{user.full_name}</p>
                            <p className="text-sm text-gray-500 dark:text-slate-400 font-medium">{user.email} • {user.role}</p>
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Inspecciones */}
                  {results.inspections.length > 0 && (
                    <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-sm p-6 border border-gray-100 dark:border-slate-800">
                      <h2 className="text-xl font-black text-gray-900 dark:text-white mb-4 uppercase tracking-tight">
                        📋 Inspecciones ({results.inspections.length})
                      </h2>
                      <div className="space-y-3">
                        {results.inspections.map((insp: any) => (
                          <Link
                            key={insp.id}
                            href="/inspecciones"
                            className="block p-4 bg-gray-50 dark:bg-slate-800/50 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-2xl border border-transparent dark:border-slate-700/50 transition-all group"
                          >
                            <p className="font-bold text-gray-900 dark:text-white group-hover:text-red-600 dark:group-hover:text-red-400 transition-colors">
                              {formatStoreName(insp.stores?.name)} - {insp.overall_score}%
                            </p>
                            <p className="text-sm text-gray-500 dark:text-slate-400 font-medium">
                              {new Date(insp.inspection_date).toLocaleDateString('es-MX')} • {insp.users?.full_name}
                            </p>
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Feedbacks */}
                  {results.feedbacks.length > 0 && (
                    <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-sm p-6 border border-gray-100 dark:border-slate-800">
                      <h2 className="text-xl font-black text-gray-900 dark:text-white mb-4 uppercase tracking-tight">
                        💬 Feedbacks ({results.feedbacks.length})
                      </h2>
                      <div className="space-y-3">
                        {results.feedbacks.map((fb: any) => (
                          <Link
                            key={fb.id}
                            href="/feedback"
                            className="block p-4 bg-gray-50 dark:bg-slate-800/50 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-2xl border border-transparent dark:border-slate-700/50 transition-all group"
                          >
                            <p className="font-bold text-gray-900 dark:text-white group-hover:text-red-600 dark:group-hover:text-red-400 transition-colors">
                              {formatStoreName(fb.stores?.name)} - NPS: {fb.nps_score}
                            </p>
                            <p className="text-sm text-gray-500 dark:text-slate-400 font-medium">
                              {new Date(fb.submission_date).toLocaleDateString('es-MX')}
                            </p>
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Checklists */}
                  {results.checklists.length > 0 && (
                    <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-sm p-6 border border-gray-100 dark:border-slate-800">
                      <h2 className="text-xl font-black text-gray-900 dark:text-white mb-4 uppercase tracking-tight">
                        ✅ Checklists ({results.checklists.length})
                      </h2>
                      <div className="space-y-3">
                        {results.checklists.map((check: any) => (
                          <Link
                            key={check.id}
                            href="/checklists"
                            className="block p-4 bg-gray-50 dark:bg-slate-800/50 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-2xl border border-transparent dark:border-slate-700/50 transition-all group"
                          >
                            <p className="font-bold text-gray-900 dark:text-white group-hover:text-red-600 dark:group-hover:text-red-400 transition-colors">
                              {formatStoreName(check.stores?.name)} - {check.checklist_type}
                            </p>
                            <p className="text-sm text-gray-500 dark:text-slate-400 font-medium">
                              {new Date(check.submission_date).toLocaleDateString('es-MX')} • {check.shift}
                            </p>
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {!searched && (
            <div className="text-center py-20 bg-white dark:bg-slate-900 rounded-[2rem] shadow-sm border border-gray-100 dark:border-slate-800">
              <div className="text-6xl mb-6 grayscale group-hover:grayscale-0 transition-all">🔎</div>
              <p className="text-gray-400 dark:text-slate-500 font-bold uppercase tracking-widest text-xs">Escribe algo para comenzar a buscar</p>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}