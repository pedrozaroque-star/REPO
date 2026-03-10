'use client'

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ShieldCheck, Monitor, FileImage, Trash2, MapPin, Save, LockIcon } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import SurpriseLoader from '@/components/SurpriseLoader'
import ImageDropzone from '@/components/ui/ImageDropzone'
import { uploadImageNewAction, deleteImageNewAction, updateImageStoresAction } from './actions'

const STORES = [
  'AZUSA', 'BELL', 'DOWNEY', 'HOLLYWOOD', 'HUNTINGTON PARK',
  'LA BROADWAY', 'LA CENTRAL', 'LA PUENTE', 'LYNWOOD', 'NORWALK',
  'RIALTO', 'SANTA ANA', 'SLAUSON', 'SOUTH GATE', 'WEST COVINA'
]

export default function TvMenusAdminPage() {
  const [images, setImages] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  // Assignment state
  const [activeTab, setActiveTab] = useState(1) // TV 1 to 6
  const screens = [1, 2, 3, 4, 5, 6]

  // Form state for Uploader
  const [isUniversal, setIsUniversal] = useState(true)

  // Modals & Assignments
  const [editingImage, setEditingImage] = useState<any>(null)

  // Auth state
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [password, setPassword] = useState('')
  const ADMIN_PASSWORD = 'admin123'

  useEffect(() => {
    if (isAuthenticated) {
      fetchImages()
    }
  }, [isAuthenticated])

  const fetchImages = async () => {
    try {
      const { data, error } = await supabase
        .from('tv_images')
        .select('*')
        .order('screen_number', { ascending: true })
        .order('id', { ascending: false })

      if (error) throw error
      setImages(data || [])
    } catch (err) {
      console.error('Error fetching images:', err)
      alert('Error cargando las imágenes')
    } finally {
      setLoading(false)
    }
  }

  const handleUploadImages = async (files: File[]) => {
    let currentSort = images.filter(i => i.screen_number === activeTab).length

    for (const file of files) {
      try {
        const formData = new FormData()
        formData.append('file', file)

        await uploadImageNewAction(formData, currentSort, activeTab, isUniversal, [])
        currentSort++
      } catch (err) {
        console.error('Error uploading file:', err)
        alert('Hubo un error al subir alguna de las imágenes')
      }
    }
    await fetchImages()
  }

  const deleteImage = async (id: string, storagePath: string) => {
    if (!confirm('¿Seguro que deseas eliminar esta imagen permanentemente?')) return

    try {
      await deleteImageNewAction(id, storagePath)
      setImages(images.filter(img => img.id !== id))
    } catch (err) {
      console.error('Error deleting image:', err)
      alert('Error al eliminar imagen')
    }
  }

  const toggleStoreSelection = async (store: string) => {
    if (!editingImage) return

    const currentAssignments = Array.isArray(editingImage.store_assignments) ? editingImage.store_assignments : []
    let newAssignments

    if (currentAssignments.includes(store)) {
      newAssignments = currentAssignments.filter((s: string) => s !== store)
    } else {
      newAssignments = [...currentAssignments, store]
    }

    // Optimistic update for speedy UI
    setEditingImage({ ...editingImage, store_assignments: newAssignments })
    setImages(images.map(img => img.id === editingImage.id ? { ...img, store_assignments: newAssignments } : img))

    try {
      await updateImageStoresAction(editingImage.id, newAssignments)
    } catch (e) {
      console.error(e)
      alert('Error al guardar sucursal')
      // Revert changes on error
      setEditingImage({ ...editingImage, store_assignments: currentAssignments })
      setImages(images.map(img => img.id === editingImage.id ? { ...img, store_assignments: currentAssignments } : img))
    }
  }

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault()
    if (password === ADMIN_PASSWORD) {
      setIsAuthenticated(true)
    } else {
      alert('Contraseña incorrecta')
    }
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-neutral-900 flex items-center justify-center p-4 relative overflow-hidden">
        <div className="absolute inset-0 opacity-40 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')]"></div>
        <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl p-8 w-full max-w-md border border-gray-100 dark:border-slate-800 relative z-10">
          <div className="text-center mb-8">
            <div className="w-20 h-20 bg-indigo-50 dark:bg-indigo-900/20 rounded-full flex items-center justify-center mx-auto mb-4 text-indigo-600 dark:text-indigo-400">
              <LockIcon size={40} />
            </div>
            <h1 className="text-2xl font-black text-gray-900 dark:text-white mb-1">Menús TV Permanentes</h1>
            <p className="text-gray-500 dark:text-slate-400 font-medium tracking-tight">Acceso Restringido</p>
          </div>
          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label htmlFor="password" className="block text-[10px] font-black text-gray-400 dark:text-slate-500 uppercase tracking-[0.2em] mb-3">Contraseña</label>
              <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full px-4 py-3.5 bg-gray-50 dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-2xl text-gray-900 dark:text-white font-bold focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 outline-none transition-all" placeholder="••••••••" required />
            </div>
            <button type="submit" className="w-full bg-gray-900 dark:bg-slate-100 dark:text-slate-900 text-white font-black py-4 rounded-2xl transition-all shadow-xl uppercase tracking-widest">INGRESAR</button>
          </form>
        </motion.div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-transparent dark:bg-neutral-900 flex items-center justify-center p-4 relative overflow-hidden">
        <SurpriseLoader />
      </div>
    )
  }

  const activeImages = images.filter(i => i.screen_number === activeTab)
  const universalImages = activeImages.filter(i => i.is_universal === true)
  const specificImages = activeImages.filter(i => i.is_universal !== true)

  return (
    <div className="min-h-screen bg-transparent dark:bg-neutral-900 font-sans pt-20 lg:pt-0 relative">
      <div className="absolute inset-0 opacity-10 dark:opacity-40 pointer-events-none bg-[url('https://www.transparenttextures.com/patterns/cubes.png')]"></div>

      {/* HEADER */}
      <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-gray-200 dark:border-slate-800 shadow-sm sticky top-14 lg:top-0 z-20 shrink-0 transition-all">
        <div className="max-w-7xl mx-auto px-4 md:px-8 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
              <Monitor size={18} />
            </div>
            <div>
              <h1 className="text-lg md:text-xl font-black text-gray-900 dark:text-white tracking-tight leading-none">Visor Directo de TVs</h1>
              <p className="hidden md:block text-[10px] text-gray-400 dark:text-slate-500 font-bold uppercase tracking-wider">Gestión Permanentemente por Pantalla</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 md:px-8 py-8 pb-32 relative z-10">
        {/* TABS */}
        <div className="flex flex-wrap gap-2 mb-8 bg-white dark:bg-slate-800 p-2 rounded-2xl border border-gray-100 dark:border-slate-700 shadow-sm">
          {screens.map(screen => (
            <button
              key={screen}
              onClick={() => { setActiveTab(screen); setEditingImage(null); }}
              className={`flex-1 min-w-[100px] py-3 px-4 rounded-xl font-black text-center transition-all ${activeTab === screen ? 'bg-indigo-600 text-white shadow-md' : 'text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-700'}`}
            >
              <Monitor size={16} className="mx-auto mb-1 opacity-60" />
              PANTALLA {screen}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
          {/* LEFT COL: UPLOADER */}
          <div className="col-span-1 space-y-6">
            <div className="bg-white dark:bg-slate-800 p-6 rounded-3xl border border-gray-100 dark:border-slate-700 shadow-sm sticky top-24">
              <h3 className="text-lg font-black text-gray-900 dark:text-white mb-4">Añadir a Pantalla {activeTab}</h3>

              <div className="mb-6 space-y-4 bg-gray-50 dark:bg-slate-900 p-4 rounded-2xl">
                <label className="flex items-center gap-3 p-3 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl cursor-pointer hover:border-indigo-400 transition-colors">
                  <input type="radio" checked={isUniversal} onChange={() => setIsUniversal(true)} className="w-4 h-4 text-indigo-600" />
                  <div>
                    <p className="text-sm font-bold text-gray-900 dark:text-white">Menú Universal</p>
                    <p className="text-[10px] text-gray-500 leading-tight mt-0.5">La mayoría de las sucursales usarán esta foto permanentemente.</p>
                  </div>
                </label>
                <label className="flex items-center gap-3 p-3 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl cursor-pointer hover:border-indigo-400 transition-colors">
                  <input type="radio" checked={!isUniversal} onChange={() => setIsUniversal(false)} className="w-4 h-4 text-indigo-600" />
                  <div>
                    <p className="text-sm font-bold text-gray-900 dark:text-white">Menú Excepcional (Variación)</p>
                    <p className="text-[10px] text-gray-500 leading-tight mt-0.5">Versión especial solo para tiendas específicas (lo configuras más abajo una vez que se suba).</p>
                  </div>
                </label>
              </div>

              <ImageDropzone onUpload={handleUploadImages} />
            </div>
          </div>

          {/* RIGHT COL: IMAGES GALLERY */}
          <div className="col-span-1 xl:col-span-2 space-y-8">

            {/* UNIVERSAL IMAGE */}
            <div className="space-y-4">
              <h2 className="text-xl font-black text-gray-900 dark:text-white flex items-center gap-2">
                <FileImage className="text-indigo-500" /> Versión Universal (Default)
              </h2>
              <p className="text-sm text-gray-500 dark:text-slate-400">Si un restaurante no tiene asignada una "Variación", su TV {activeTab} mostrará SIEMPRE esta imagen.</p>

              {universalImages.length === 0 ? (
                <div className="p-8 border-2 border-dashed border-gray-200 dark:border-slate-700 bg-red-50/20 rounded-3xl text-center text-red-400 font-medium">
                  ¡Atención! No has subido el menú Universal. La TV estará negra en las sucursales sin asignación específica.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {universalImages.map((img, idx) => (
                    <div key={img.id} className="bg-white dark:bg-slate-800 border-2 border-indigo-100 dark:border-indigo-900/40 rounded-xl overflow-hidden shadow-md group relative">
                      <div className="aspect-video bg-gray-100 dark:bg-slate-900">
                        <img src={img.storage_path} className="w-full h-full object-cover" />
                      </div>
                      <div className="p-3 bg-indigo-50 dark:bg-indigo-900/10 flex justify-between items-center">
                        <span className="text-[11px] font-black uppercase tracking-wider text-indigo-700 dark:text-indigo-400">Default Company Wide</span>
                        <button onClick={() => deleteImage(img.id, img.storage_path)} className="bg-red-500/10 text-red-600 hover:bg-red-500 hover:text-white dark:text-red-400 p-1.5 rounded-lg transition-colors"><Trash2 size={16} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* SPECIFIC STORE IMAGES */}
            <div className="space-y-4 pt-8 border-t border-gray-200 dark:border-slate-800">
              <h2 className="text-xl font-black text-gray-900 dark:text-white flex items-center gap-2">
                <MapPin className="text-orange-500" /> Variaciones (Solo para tiendas seleccionadas)
              </h2>
              <p className="text-sm text-gray-500 dark:text-slate-400">Estas imágenes reemplazarán la Versión Universal permanentemente en las tiendas que tú palomees abajo.</p>

              {specificImages.length === 0 ? (
                <div className="p-8 border-2 border-dashed border-gray-100 dark:border-slate-800 rounded-3xl text-center text-gray-400">
                  No has creado variaciones. Todas las tiendas de la compañía comparten el Menú Universal.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {specificImages.map(img => {
                    const assignedStores = Array.isArray(img.store_assignments) ? img.store_assignments : []
                    return (
                      <div key={img.id} className={`bg-white dark:bg-slate-800 border ${editingImage?.id === img.id ? 'border-orange-500 ring-4 ring-orange-500/10' : 'border-gray-200 dark:border-slate-700'} rounded-2xl overflow-hidden shadow-sm transition-all flex flex-col`}>
                        <div className="aspect-video relative group bg-gray-100 dark:bg-slate-900">
                          <img src={img.storage_path} className="w-full h-full object-cover" />
                          <button onClick={() => deleteImage(img.id, img.storage_path)} className="absolute top-2 right-2 bg-red-500 text-white p-2 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity shadow-lg"><Trash2 size={16} /></button>
                        </div>
                        <div className="p-4 flex flex-col flex-1">
                          <div className="flex justify-between items-center mb-3">
                            <span className="bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 text-xs font-black uppercase px-2 py-1 rounded-md">
                              Variación Limitada
                            </span>
                            <button onClick={() => setEditingImage(editingImage?.id === img.id ? null : img)} className="text-indigo-600 dark:text-indigo-400 text-xs font-black uppercase tracking-wider hover:underline flex items-center gap-1">
                              <MapPin size={12} /> {editingImage?.id === img.id ? 'Cerrar Plantilla' : 'Asignar Sucursales'}
                            </button>
                          </div>

                          {!editingImage || editingImage.id !== img.id ? (
                            <div className="text-xs text-gray-600 dark:text-slate-400 font-medium">
                              {assignedStores.length > 0
                                ? <div>
                                  Visible exclusivamente en: <span className="font-bold text-gray-900 dark:text-white capitalize">{assignedStores.join(', ').toLowerCase()}</span>
                                </div>
                                : <span className="text-red-500 font-bold flex items-center gap-1">¡Advertencia! No has asignado tiendas a esta variación. Jamás se mostrará.</span>}
                            </div>
                          ) : null}

                          {/* Edit Matrix for Exceptions */}
                          <AnimatePresence>
                            {editingImage?.id === img.id && (
                              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                                <div className="mt-2 pt-4 border-t border-gray-100 dark:border-slate-700">
                                  <h4 className="text-[10px] items-center gap-2 font-black uppercase text-gray-400 mb-3 flex bg-gray-50 dark:bg-slate-900 p-2 rounded-lg"><Monitor size={14} /> Palomea en cuáles sucursales se mostrará esta variante:</h4>

                                  <div className="grid grid-cols-2 gap-2 h-48 overflow-y-auto pr-2 custom-scrollbar">
                                    {STORES.map((storeOption) => {
                                      const isChecked = assignedStores.includes(storeOption)
                                      return (
                                        <label key={storeOption} className={`flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-colors border text-xs font-bold ${isChecked ? 'bg-indigo-50 border-indigo-200 text-indigo-700 dark:bg-indigo-900/30 dark:border-indigo-800/50 dark:text-indigo-300' : 'bg-white border-gray-100 text-gray-600 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-400 hover:border-indigo-300'}`}>
                                          <input
                                            type="checkbox"
                                            checked={isChecked}
                                            onChange={() => toggleStoreSelection(storeOption)}
                                            className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500"
                                          />
                                          <span className="capitalize">{storeOption.toLowerCase()}</span>
                                        </label>
                                      )
                                    })}
                                  </div>

                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

          </div>
        </div>
      </div>
    </div>
  )
}
