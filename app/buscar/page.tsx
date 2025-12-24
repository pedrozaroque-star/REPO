'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import Link from 'next/link'

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
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      
      <main className="flex-1 p-8">
        <div className="max-w-5xl mx-auto">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900">Búsqueda Global</h1>
            <p className="text-gray-600 mt-2">Busca en todas las secciones del sistema</p>
          </div>

          {/* Search Bar */}
          <div className="bg-white rounded-xl shadow-md p-6 mb-8">
            <div className="flex space-x-4">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                placeholder="Buscar tiendas, usuarios, inspecciones..."
                className="flex-1 px-4 py-3 border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-red-500"
              />
              <button
                onClick={handleSearch}
                disabled={loading}
                className="px-8 py-3 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg transition-colors disabled:bg-gray-400"
              >
                {loading ? '⏳' : '🔍'} Buscar
              </button>
            </div>
          </div>

          {/* Results */}
          {searched && !loading && (
            <div className="space-y-6">
              {totalResults === 0 ? (
                <div className="text-center py-12 bg-white rounded-xl shadow-md">
                  <div className="text-6xl mb-4">🔍</div>
                  <p className="text-gray-600">No se encontraron resultados para "{query}"</p>
                </div>
              ) : (
                <>
                  <div className="bg-white rounded-xl shadow-md p-6">
                    <p className="text-gray-900 font-semibold">
                      Se encontraron <span className="text-red-600">{totalResults}</span> resultados
                    </p>
                  </div>

                  {/* Tiendas */}
                  {results.stores.length > 0 && (
                    <div className="bg-white rounded-xl shadow-md p-6">
                      <h2 className="text-xl font-bold text-gray-900 mb-4">
                        🏪 Tiendas ({results.stores.length})
                      </h2>
                      <div className="space-y-3">
                        {results.stores.map((store: any) => (
                          <Link
                            key={store.id}
                            href="/tiendas"
                            className="block p-4 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors"
                          >
                            <p className="font-semibold text-gray-900">{store.name}</p>
                            <p className="text-sm text-gray-600">{store.address}, {store.city}</p>
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Usuarios */}
                  {results.users.length > 0 && (
                    <div className="bg-white rounded-xl shadow-md p-6">
                      <h2 className="text-xl font-bold text-gray-900 mb-4">
                        👥 Usuarios ({results.users.length})
                      </h2>
                      <div className="space-y-3">
                        {results.users.map((user: any) => (
                          <Link
                            key={user.id}
                            href="/usuarios"
                            className="block p-4 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors"
                          >
                            <p className="font-semibold text-gray-900">{user.full_name}</p>
                            <p className="text-sm text-gray-600">{user.email} • {user.role}</p>
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Inspecciones */}
                  {results.inspections.length > 0 && (
                    <div className="bg-white rounded-xl shadow-md p-6">
                      <h2 className="text-xl font-bold text-gray-900 mb-4">
                        📋 Inspecciones ({results.inspections.length})
                      </h2>
                      <div className="space-y-3">
                        {results.inspections.map((insp: any) => (
                          <Link
                            key={insp.id}
                            href="/inspecciones"
                            className="block p-4 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors"
                          >
                            <p className="font-semibold text-gray-900">
                              {insp.stores?.name} - {insp.overall_score}%
                            </p>
                            <p className="text-sm text-gray-600">
                              {new Date(insp.inspection_date).toLocaleDateString('es-MX')} • {insp.users?.full_name}
                            </p>
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Feedbacks */}
                  {results.feedbacks.length > 0 && (
                    <div className="bg-white rounded-xl shadow-md p-6">
                      <h2 className="text-xl font-bold text-gray-900 mb-4">
                        💬 Feedbacks ({results.feedbacks.length})
                      </h2>
                      <div className="space-y-3">
                        {results.feedbacks.map((fb: any) => (
                          <Link
                            key={fb.id}
                            href="/feedback"
                            className="block p-4 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors"
                          >
                            <p className="font-semibold text-gray-900">
                              {fb.stores?.name} - NPS: {fb.nps_score}
                            </p>
                            <p className="text-sm text-gray-600">
                              {new Date(fb.submission_date).toLocaleDateString('es-MX')}
                            </p>
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Checklists */}
                  {results.checklists.length > 0 && (
                    <div className="bg-white rounded-xl shadow-md p-6">
                      <h2 className="text-xl font-bold text-gray-900 mb-4">
                        ✅ Checklists ({results.checklists.length})
                      </h2>
                      <div className="space-y-3">
                        {results.checklists.map((check: any) => (
                          <Link
                            key={check.id}
                            href="/checklists"
                            className="block p-4 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors"
                          >
                            <p className="font-semibold text-gray-900">
                              {check.stores?.name} - {check.checklist_type}
                            </p>
                            <p className="text-sm text-gray-600">
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
            <div className="text-center py-12 bg-white rounded-xl shadow-md">
              <div className="text-6xl mb-4">🔎</div>
              <p className="text-gray-600">Escribe algo para comenzar a buscar</p>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}