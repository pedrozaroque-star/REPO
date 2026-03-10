'use client'

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ShieldCheck, Monitor, Clock, FileImage, Trash2, Calendar as CalendarIcon, Save, LockIcon } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import SurpriseLoader from '@/components/SurpriseLoader'
import ImageDropzone from '@/components/ui/ImageDropzone'
import { uploadImageNewAction, deleteImageNewAction, updateImageSchedulesAction } from './actions'

export default function TvMenusAdminPage() {
  const [images, setImages] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  // Assignment state
  const [activeTab, setActiveTab] = useState(1) // TV 1 to 6
  const screens = [1, 2, 3, 4, 5, 6]

  // Form state for Uploader
  const [isAlways, setIsAlways] = useState(true)
  const [uploadStart, setUploadStart] = useState('06:00')
  const [uploadEnd, setUploadEnd] = useState('11:00')

  // Modals & Scheduling
  const [editingImage, setEditingImage] = useState<any>(null)
  const [exceptionStore, setExceptionStore] = useState('LYNWOOD')
  const [exceptionStart, setExceptionStart] = useState('06:00')
  const [exceptionEnd, setExceptionEnd] = useState('11:00')

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

        const start = isAlways ? null : uploadStart
        const end = isAlways ? null : uploadEnd

        await uploadImageNewAction(formData, currentSort, activeTab, isAlways, start, end, [])
        currentSort++
      } catch (err) {
        console.error('Error uploading file:', err)
        alert('Hubo un error al subir alguna de las imágenes')
      }
    }
    await fetchImages()
  }

  const deleteImage = async (id: string, storagePath: string) => {
    if (!confirm('¿Seguro que deseas eliminar esta imagen?')) return

    try {
      await deleteImageNewAction(id, storagePath)
      setImages(images.filter(img => img.id !== id))
    } catch (err) {
      console.error('Error deleting image:', err)
      alert('Error al eliminar imagen')
    }
  }

  const formatTime = (timeInfo: string) => {
    if (!timeInfo) return '--:--'
    const [hours, minutes] = timeInfo.split(':')
    let h = parseInt(hours)
    const ampm = h >= 12 ? 'PM' : 'AM'
    h = h % 12 || 12
    return `${h}:${minutes} ${ampm}`
  }

  const addException = async () => {
    if (!editingImage) return
    const newSchedule = { store_id: exceptionStore, start_time: exceptionStart, end_time: exceptionEnd }
    const currentSchedules = editingImage.custom_schedules || []
    const existing = currentSchedules.filter((s: any) => s.store_id !== exceptionStore)
    const updated = [...existing, newSchedule]

    try {
      await updateImageSchedulesAction(editingImage.id, updated)
      setEditingImage({ ...editingImage, custom_schedules: updated })
      setImages(images.map(img => img.id === editingImage.id ? { ...img, custom_schedules: updated } : img))
    } catch (e) {
      alert('Error al guardar horario excepcional')
    }
  }

  const removeException = async (storeId: string) => {
    if (!editingImage) return
    const currentSchedules = editingImage.custom_schedules || []
    const updated = currentSchedules.filter((s: any) => s.store_id !== storeId)

    try {
      await updateImageSchedulesAction(editingImage.id, updated)
      setEditingImage({ ...editingImage, custom_schedules: updated })
      setImages(images.map(img => img.id === editingImage.id ? { ...img, custom_schedules: updated } : img))
    } catch (e) {
      alert('Error al eliminar horario excepcional')
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
            <h1 className="text-2xl font-black text-gray-900 dark:text-white mb-1">Menús TV</h1>
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
  const alwaysImages = activeImages.filter(i => i.is_always)
  const scheduledImages = activeImages.filter(i => !i.is_always)

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
              <h1 className="text-lg md:text-xl font-black text-gray-900 dark:text-white tracking-tight leading-none">Menús Digitales TV</h1>
              <p className="hidden md:block text-[10px] text-gray-400 dark:text-slate-500 font-bold uppercase tracking-wider">Gestión por Pantalla</p>
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
          {/* LEFT COL: UPLOADER & CURRENT SETTINGS */}
          <div className="col-span-1 space-y-6">
            <div className="bg-white dark:bg-slate-800 p-6 rounded-3xl border border-gray-100 dark:border-slate-700 shadow-sm sticky top-24">
              <h3 className="text-lg font-black text-gray-900 dark:text-white mb-4">Añadir a Pantalla {activeTab}</h3>

              <div className="mb-6 space-y-4 bg-gray-50 dark:bg-slate-900 p-4 rounded-2xl">
                <label className="flex items-center gap-3 p-3 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl cursor-pointer hover:border-indigo-400 transition-colors">
                  <input type="radio" checked={isAlways} onChange={() => setIsAlways(true)} className="w-4 h-4 text-indigo-600" />
                  <div>
                    <p className="text-sm font-bold text-gray-900 dark:text-white">Se Muestra Siempre</p>
                    <p className="text-xs text-gray-500">La imagen estará visible todo el tiempo.</p>
                  </div>
                </label>
                <label className="flex flex-col gap-3 p-3 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl cursor-pointer hover:border-indigo-400 transition-colors">
                  <div className="flex items-center gap-3">
                    <input type="radio" checked={!isAlways} onChange={() => setIsAlways(false)} className="w-4 h-4 text-indigo-600" />
                    <div>
                      <p className="text-sm font-bold text-gray-900 dark:text-white">Horario Específico</p>
                      <p className="text-xs text-gray-500">Ej: Solo para Desayunos.</p>
                    </div>
                  </div>

                  {!isAlways && (
                    <div className="flex gap-2 mt-2 pt-3 border-t border-gray-100 dark:border-slate-700">
                      <div className="flex-1">
                        <label className="text-xs font-bold text-gray-400">De (Hora):</label>
                        <input type="time" value={uploadStart} onChange={e => setUploadStart(e.target.value)} className="w-full bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-600 rounded-lg px-2 py-1 text-sm outline-none" />
                      </div>
                      <div className="flex-1">
                        <label className="text-xs font-bold text-gray-400">A (Hora):</label>
                        <input type="time" value={uploadEnd} onChange={e => setUploadEnd(e.target.value)} className="w-full bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-600 rounded-lg px-2 py-1 text-sm outline-none" />
                      </div>
                    </div>
                  )}
                </label>
              </div>

              <ImageDropzone onUpload={handleUploadImages} />
            </div>
          </div>

          {/* RIGHT COL: IMAGES GALLERY */}
          <div className="col-span-1 xl:col-span-2 space-y-8">
            {/* SCHEDULED IMAGES (BREAKFAST ETC) */}
            <div className="space-y-4">
              <h2 className="text-xl font-black text-gray-900 dark:text-white flex items-center gap-2">
                <Clock className="text-orange-500" /> Imágenes por Horario (Prioridad Alta)
              </h2>
              <p className="text-sm text-gray-500 dark:text-slate-400">Estas imágenes reemplazarán a las imágenes "Fijas" durante las horas establecidas.</p>

              {scheduledImages.length === 0 ? (
                <div className="p-8 border-2 border-dashed border-gray-200 dark:border-slate-700 rounded-3xl text-center text-gray-400">
                  No hay imágenes programadas en esta pantalla.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {scheduledImages.map(img => (
                    <div key={img.id} className={`bg-white dark:bg-slate-800 border ${editingImage?.id === img.id ? 'border-indigo-500 ring-4 ring-indigo-500/10' : 'border-gray-200 dark:border-slate-700'} rounded-2xl overflow-hidden shadow-sm transition-all`}>
                      <div className="aspect-video relative group bg-gray-100 dark:bg-slate-900">
                        <img src={img.storage_path} className="w-full h-full object-cover" />
                        <button onClick={() => deleteImage(img.id, img.storage_path)} className="absolute top-2 right-2 bg-red-500 text-white p-2 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 size={16} /></button>
                      </div>
                      <div className="p-4">
                        <div className="flex justify-between items-center mb-3">
                          <span className="bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 text-xs font-black uppercase px-2 py-1 rounded-md">
                            {formatTime(img.start_time)} - {formatTime(img.end_time)}
                          </span>
                          <button onClick={() => setEditingImage(editingImage?.id === img.id ? null : img)} className="text-indigo-600 dark:text-indigo-400 text-xs font-bold hover:underline">
                            {editingImage?.id === img.id ? 'Ocultar Tiendas' : 'Ajustar x Tienda'}
                          </button>
                        </div>

                        <div className="text-xs text-gray-500 dark:text-slate-400 font-medium">
                          {(img.custom_schedules || []).length > 0
                            ? <span className="text-indigo-500 font-bold">{(img.custom_schedules).length} excepción(es) de tienda</span>
                            : 'Aplica igual para todas las tiendas.'}
                        </div>

                        {/* Edit Matrix for Exceptions */}
                        <AnimatePresence>
                          {editingImage?.id === img.id && (
                            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                              <div className="mt-4 pt-4 border-t border-gray-100 dark:border-slate-700">
                                <h4 className="text-[10px] font-black uppercase text-gray-400 mb-2">Ajustar horario en otra sucursal:</h4>
                                <div className="space-y-2 mb-4">
                                  {(editingImage.custom_schedules || []).map((s: any, i: number) => (
                                    <div key={i} className="flex justify-between items-center text-xs bg-gray-50 dark:bg-slate-900 p-2 rounded-lg">
                                      <span className="font-bold">{s.store_id}</span>
                                      <div className="flex items-center gap-2">
                                        <span className="text-gray-500">{formatTime(s.start_time)} - {formatTime(s.end_time)}</span>
                                        <button onClick={() => removeException(s.store_id)} className="text-red-500"><Trash2 size={14} /></button>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                                <div className="flex flex-col gap-2">
                                  <select value={exceptionStore} onChange={e => setExceptionStore(e.target.value)} className="text-xs p-2 rounded border dark:bg-slate-900 border-gray-200 dark:border-slate-700 outline-none w-full">
                                    <option value="AZUSA">Azusa</option>
                                    <option value="BELL">Bell</option>
                                    <option value="DOWNEY">Downey</option>
                                    <option value="HOLLYWOOD">Hollywood</option>
                                    <option value="HUNTINGTON PARK">Huntington Park</option>
                                    <option value="LA BROADWAY">LA Broadway</option>
                                    <option value="LA CENTRAL">LA Central</option>
                                    <option value="LA PUENTE">La Puente</option>
                                    <option value="LYNWOOD">Lynwood</option>
                                    <option value="NORWALK">Norwalk</option>
                                    <option value="RIALTO">Rialto</option>
                                    <option value="SANTA ANA">Santa Ana</option>
                                    <option value="SLAUSON">Slauson</option>
                                    <option value="SOUTH GATE">South Gate</option>
                                    <option value="WEST COVINA">West Covina</option>
                                  </select>
                                  <div className="flex gap-2">
                                    <input type="time" value={exceptionStart} onChange={e => setExceptionStart(e.target.value)} className="w-1/2 text-xs p-2 rounded border border-gray-200 dark:border-slate-700 dark:bg-slate-900 outline-none" />
                                    <input type="time" value={exceptionEnd} onChange={e => setExceptionEnd(e.target.value)} className="w-1/2 text-xs p-2 rounded border border-gray-200 dark:border-slate-700 dark:bg-slate-900 outline-none" />
                                  </div>
                                  <button onClick={addException} className="w-full bg-indigo-100 hover:bg-indigo-200 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400 dark:hover:bg-indigo-900/50 py-2 rounded-lg text-xs font-bold transition-colors">Vincular a Sucursal</button>
                                </div>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ALWAYS ON IMAGES */}
            <div className="space-y-4 pt-8 border-t border-gray-200 dark:border-slate-800">
              <h2 className="text-xl font-black text-gray-900 dark:text-white flex items-center gap-2">
                <FileImage className="text-indigo-500" /> Imágenes Siempre Visibles (Fijas)
              </h2>
              <p className="text-sm text-gray-500 dark:text-slate-400">Este es el menú base. Se muestra siempre que no haya un horario especial activo.</p>

              {alwaysImages.length === 0 ? (
                <div className="p-8 border-2 border-dashed border-gray-200 dark:border-slate-700 rounded-3xl text-center text-gray-400">
                  No hay imágenes fijas en esta pantalla. (La pantalla se quedará en negro si no hay menú base).
                </div>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {alwaysImages.map((img, idx) => (
                    <div key={img.id} className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl overflow-hidden shadow-sm group relative">
                      <div className="aspect-video bg-gray-100 dark:bg-slate-900">
                        <img src={img.storage_path} className="w-full h-full object-cover" />
                      </div>
                      <div className="absolute top-2 left-2 bg-black/60 backdrop-blur-md text-white px-2 py-0.5 rounded text-[10px] font-bold">
                        Fija - {idx + 1}
                      </div>
                      <button onClick={() => deleteImage(img.id, img.storage_path)} className="absolute top-2 right-2 bg-red-500 text-white p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 size={14} /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>
        </div>
      </div>
    </div>
  )
}
