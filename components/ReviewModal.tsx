'use client'

import { useState, useEffect } from 'react'
import { formatDateLA } from '@/lib/checklistPermissions'
import { supabase } from '@/lib/supabase'

interface ReviewModalProps {
  isOpen: boolean
  onClose: () => void
  checklists: any[]
  checklistType: 'assistant' | 'manager' | 'supervisor'
  currentUser: { id: number, name: string, email: string, role: string }
  onSave: () => void
}

// Diccionario para reconstruir preguntas de registros antiguos
const INSPECTION_DICT: any = {
  servicio: {
    label: 'Servicio al Cliente',
    items: ['Saluda y despide cordialmente', 'Atiende con paciencia y respeto', 'Entrega órdenes con frase de cierre', 'Evita charlas personales en línea']
  },
  carnes: {
    label: 'Procedimiento de Carnes',
    items: ['Controla temperatura (450°/300°) y tiempos', 'Utensilios limpios, no golpear espátulas', 'Escurre carnes y rota producto (FIFO)', 'Vigila cebolla asada y porciones']
  },
  alimentos: {
    label: 'Preparación de Alimentos',
    items: ['Respeta porciones estándar (cucharas)', 'Quesadillas bien calientes, sin quemar', 'Burritos bien enrollados, sin dorar de más', 'Stickers correctos donde aplica']
  },
  tortillas: {
    label: 'Seguimiento a Tortillas',
    items: ['Tortillas bien calientes (aceite solo en orillas)', 'Máx 5 tacos por plato (presentación)', 'Reponer a tiempo y mantener frescura']
  },
  limpieza: {
    label: 'Limpieza General y Baños',
    items: ['Cubetas rojas con sanitizer tibio', 'Plancha limpia y sin residuos', 'Baños con insumos completos y sin olores', 'Exterior y basureros limpios']
  },
  bitacoras: {
    label: 'Checklists y Bitácoras',
    items: ['Checklist apertura/cierre completo', 'Bitácora de temperaturas al día', 'Registros de limpieza firmados']
  },
  aseo: {
    label: 'Aseo Personal',
    items: ['Uniforme limpio y completo', 'Uñas cortas, sin joyas/auriculares', 'Uso correcto de gorra y guantes']
  }
}

export default function ReviewModal({ isOpen, onClose, checklists, checklistType, currentUser, onSave }: ReviewModalProps) {
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [reviewStatus, setReviewStatus] = useState('')
  const [reviewComment, setReviewComment] = useState('')
  const [saving, setSaving] = useState(false)

  // Filtramos la lista para mostrar pendientes primero, o todos
  // Puedes quitar el filtro .filter(...) si quieres ver el historial completo
  const displayList = checklists // .filter(c => c.estatus_admin === 'pendiente') 
  const currentItem = checklists.find(c => c.id === selectedId)

  useEffect(() => {
    if (isOpen && displayList.length > 0 && !selectedId) {
      setSelectedId(displayList[0].id)
    }
  }, [isOpen])

  useEffect(() => {
    if (currentItem) {
      setReviewStatus(currentItem.estatus_admin || 'pendiente')
      setReviewComment(currentItem.comentarios_admin || '')
    }
  }, [currentItem])

  // --- 📸 MAGIA PARA FOTOS (DRIVE VS SUPABASE) ---
  const getImageUrl = (url: string) => {
    if (!url) return ''
    // Si es Google Drive, usamos el API de thumbnails
    if (url.includes('drive.google.com')) {
      const idMatch = url.match(/\/d\/([a-zA-Z0-9_-]+)/) || url.match(/id=([a-zA-Z0-9_-]+)/)
      if (idMatch && idMatch[1]) {
        // sz=w800 pide una imagen de 800px de ancho
        return `https://drive.google.com/thumbnail?id=${idMatch[1]}&sz=w800`
      }
    }
    // Si es Supabase u otro, lo devolvemos tal cual
    return url
  }

  const handleSave = async () => {
    if (!currentItem) return
    setSaving(true)
    try {
      await supabase.from('supervisor_inspections').update({
        estatus_admin: reviewStatus,
        comentarios_admin: reviewComment,
        reviso_admin: currentUser.name || currentUser.email,
        fecha_revision_admin: new Date().toISOString()
      }).eq('id', currentItem.id)

      alert('✅ Revisión guardada')
      onSave()
      setSaving(false)
      // Pasar al siguiente
      const nextItem = displayList.find((c: any) => c.id !== currentItem.id)
      if (nextItem) setSelectedId(nextItem.id)
      else onClose()
    } catch (err) {
      alert('Error al guardar')
      setSaving(false)
    }
  }

  const renderDetails = (item: any) => {
    let answersData = item.answers
    if (typeof answersData === 'string') {
      try { answersData = JSON.parse(answersData) } catch { answersData = {} }
    }
    if (!answersData) answersData = {}

    return Object.entries(INSPECTION_DICT).map(([areaKey, dictInfo]: [string, any]) => {
      const areaData = answersData[areaKey] || {}
      
      // Colores por área
      const colors: any = { 
        servicio: 'bg-blue-50 text-blue-800', carnes: 'bg-red-50 text-red-800',
        alimentos: 'bg-orange-50 text-orange-800', tortillas: 'bg-yellow-50 text-yellow-800',
        limpieza: 'bg-green-50 text-green-800', bitacoras: 'bg-purple-50 text-purple-800',
        aseo: 'bg-cyan-50 text-cyan-800'
      }

      // Calcular score (prioridad: json nuevo > columna sql vieja > 0)
      let areaScore = areaData.score !== undefined ? areaData.score : (item[`${areaKey}_score`] ?? 0)
      
      let renderedItems: any[] = []

      // Lógica para detectar tipo de datos (Nuevo vs Viejo)
      if (areaData.items && !Array.isArray(areaData.items)) {
        // Formato Nuevo (Rico)
        renderedItems = Object.values(areaData.items).map((subItem: any) => ({
          label: subItem.label, score: subItem.score, status: 'recorded'
        }))
      } else if (Object.keys(areaData).some(k => !isNaN(parseInt(k)))) {
        // Formato Intermedio (Indices)
        renderedItems = dictInfo.items.map((label: string, index: number) => {
          const val = areaData[index.toString()]
          return { label: label, score: val, status: val !== undefined ? 'recorded' : 'missing' }
        })
      } else {
        // Formato Viejo (Sin detalle)
        renderedItems = dictInfo.items.map((label: string) => ({ label: label, score: null, status: 'legacy' }))
      }

      return (
        <div key={areaKey} className="mb-4 border rounded-lg overflow-hidden">
          <div className={`px-4 py-2 flex justify-between font-bold uppercase text-xs ${colors[areaKey] || 'bg-gray-50'}`}>
            <span>{dictInfo.label}</span>
            <span className="bg-white/50 px-2 rounded">{areaScore}%</span>
          </div>
          <div className="divide-y text-sm text-gray-700">
            {renderedItems.map((q: any, i: number) => {
              let badge = null
              if (q.status === 'legacy') badge = <span className="text-gray-400 text-xs italic">--</span>
              else if (q.status === 'missing') badge = <span className="text-gray-300 text-xs">N/A</span>
              else badge = (
                <span className={`font-bold text-[10px] px-2 py-0.5 rounded ${q.score===100?'bg-green-100 text-green-700':q.score===60?'bg-yellow-100 text-yellow-700':'bg-red-100 text-red-700'}`}>
                  {q.score===100?'CUMPLE':q.score===60?'PARCIAL':'FALLA'}
                </span>
              )
              return (
                <div key={i} className="px-4 py-2 flex justify-between items-center hover:bg-gray-50">
                  <span className="truncate pr-2 flex-1">{q.label}</span>
                  {badge}
                </div>
              )
            })}
          </div>
        </div>
      )
    })
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-white w-full max-w-6xl h-[90vh] rounded-2xl shadow-2xl flex overflow-hidden">
        
        {/* COLUMNA IZQUIERDA: LISTA */}
        <div className="w-1/3 bg-gray-50 border-r flex flex-col">
          <div className="p-4 bg-white border-b shadow-sm z-10">
            <h3 className="font-bold text-gray-800">Inspecciones ({displayList.length})</h3>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-2">
            {displayList.length === 0 ? (
              <div className="text-center py-10 text-gray-400">No hay registros.</div>
            ) : (
              displayList.map((item: any) => (
                <button
                  key={item.id}
                  onClick={() => setSelectedId(item.id)}
                  className={`w-full text-left p-3 rounded-lg border transition-all group ${
                    selectedId === item.id 
                      ? 'bg-white border-indigo-500 shadow-md ring-1 ring-indigo-500' 
                      : 'bg-white border-gray-200 hover:border-indigo-300'
                  }`}
                >
                  <div className="flex justify-between font-bold text-sm text-gray-800 mb-1">
                    <span className="group-hover:text-indigo-600 transition-colors">{item.store_name}</span>
                    <span className={item.overall_score >= 90 ? 'text-green-600' : 'text-red-600'}>{item.overall_score}%</span>
                  </div>
                  <div className="text-xs text-gray-500 flex justify-between">
                    <span>{item.supervisor_name?.split(' ')[0]}</span>
                    <span>{formatDateLA(item.inspection_date)}</span>
                  </div>
                  {/* Etiqueta de estado pequeña */}
                  <div className="mt-1 flex justify-end">
                     <span className={`text-[10px] px-1.5 rounded ${
                       item.estatus_admin === 'cerrado' ? 'bg-blue-100 text-blue-700' : 
                       item.estatus_admin === 'rechazado' ? 'bg-red-100 text-red-700' : 
                       'bg-yellow-100 text-yellow-700'
                     }`}>
                       {item.estatus_admin || 'pendiente'}
                     </span>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* COLUMNA DERECHA: DETALLE */}
        <div className="flex-1 flex flex-col bg-white">
          {currentItem ? (
            <>
              {/* Header Detalle */}
              <div className="p-6 border-b flex justify-between items-start bg-white shadow-sm z-10">
                <div>
                  <h2 className="text-2xl font-black text-gray-900">{currentItem.store_name}</h2>
                  <div className="flex flex-wrap gap-4 text-sm text-gray-500 mt-1">
                    <span className="flex items-center gap-1">👤 <b className="text-gray-700">{currentItem.supervisor_name}</b></span>
                    <span className="flex items-center gap-1">📅 {formatDateLA(currentItem.inspection_date)}</span>
                    <span className="flex items-center gap-1">⏰ {currentItem.start_time || currentItem.inspection_time || '--:--'}</span>
                  </div>
                </div>
                <div className="text-center bg-gray-50 p-2 rounded-lg border border-gray-200">
                  <div className="text-[10px] uppercase font-bold text-gray-400">Calificación</div>
                  <div className={`text-3xl font-black ${currentItem.overall_score >= 90 ? 'text-green-600' : 'text-red-600'}`}>
                    {currentItem.overall_score}%
                  </div>
                </div>
              </div>

              {/* Contenido Scrollable */}
              <div className="flex-1 overflow-y-auto p-6 bg-gray-50">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  
                  {/* LADO IZQUIERDO: Respuestas */}
                  <div>
                    <h3 className="font-bold text-gray-700 mb-3 flex items-center gap-2">📋 Resultados</h3>
                    {renderDetails(currentItem)}
                  </div>

                  {/* LADO DERECHO: Evidencias y Acciones */}
                  <div className="space-y-6">
                    
                    {/* FOTOS (Con soporte Drive) */}
                    <div className="bg-white p-4 rounded-xl border shadow-sm">
                      <h3 className="font-bold text-gray-700 mb-3 flex justify-between">
                        <span>📸 Evidencias</span>
                        <span className="text-xs bg-gray-100 px-2 py-1 rounded text-gray-500">{currentItem.photos?.length || 0}</span>
                      </h3>
                      
                      {currentItem.photos && currentItem.photos.length > 0 ? (
                        <div className="grid grid-cols-3 gap-2">
                          {/* BLOQUE DE FOTOS CORREGIDO */}
{currentItem.photos.map((url: string, i: number) => {
  const thumbUrl = getImageUrl(url)
  const isDrive = url.includes('drive.google.com')
  return (
    <a 
      key={i} 
      href={url} 
      target="_blank" 
      rel="noopener noreferrer" 
      className="relative aspect-square rounded-lg overflow-hidden border bg-gray-100 hover:ring-2 ring-indigo-500 transition-all group"
    >
      <img 
        src={thumbUrl} 
        className="w-full h-full object-cover" 
        alt={`Evidencia ${i+1}`}
        referrerPolicy="no-referrer"  // 👈 ¡ESTA ES LA CLAVE!
        onError={(e: any) => {
          // Si falla la miniatura, intentamos con el enlace directo de visualización
          if (e.target.src.includes('thumbnail')) {
             const id = url.match(/[\w-]{25,}/)?.[0];
             if(id) e.target.src = `https://drive.google.com/uc?export=view&id=${id}`;
          } else {
             e.target.onerror = null; 
             e.target.src='https://placehold.co/400x400/e2e8f0/64748b?text=No+Vista+Previa';
          }
        }}
      />
      {isDrive && (
        <div className="absolute bottom-0 right-0 bg-blue-600 text-white text-[9px] px-1.5 py-0.5 rounded-tl-md font-bold">
          DRIVE
        </div>
      )}
    </a>
  )
})}
                        </div>
                      ) : (
                        <div className="text-sm text-gray-400 italic bg-gray-50 p-4 rounded-lg text-center border border-dashed border-gray-200">
                          Sin fotos adjuntas.
                        </div>
                      )}
                    </div>

                    {/* Observaciones */}
                    <div className="bg-white p-4 rounded-xl border shadow-sm">
                      <h3 className="font-bold text-gray-700 mb-2">📝 Notas del Supervisor</h3>
                      <p className="text-sm text-gray-600 bg-gray-50 p-3 rounded-lg border border-gray-100 italic">
                        {currentItem.observaciones || "Sin observaciones registradas."}
                      </p>
                    </div>

                    {/* Panel de Acción */}
                    <div className="bg-indigo-50 p-5 rounded-xl border border-indigo-100 shadow-sm sticky bottom-0">
                      <h3 className="font-bold text-indigo-900 mb-3 text-sm uppercase tracking-wide">👮‍♂️ Decisión Gerencial</h3>
                      
                      <div className="space-y-3">
                        <div>
                          <label className="block text-xs font-bold text-indigo-800 mb-1">Estado</label>
                          <select 
                            value={reviewStatus}
                            onChange={(e) => setReviewStatus(e.target.value)}
                            className="w-full p-2 border border-indigo-200 rounded-lg font-bold text-sm bg-white text-gray-800 focus:ring-2 focus:ring-indigo-500 outline-none"
                          >
                            <option value="pendiente">⏳ Pendiente</option>
                            <option value="cerrado">✅ Aprobar y Cerrar</option>
                            <option value="rechazado">❌ Rechazar (Corregir)</option>
                          </select>
                        </div>

                        <div>
                          <label className="block text-xs font-bold text-indigo-800 mb-1">Comentarios</label>
                          <textarea
                            value={reviewComment}
                            onChange={(e) => setReviewComment(e.target.value)}
                            placeholder="Escribe un comentario o feedback..."
                            className="w-full p-3 border border-indigo-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none text-gray-800 resize-none h-20"
                          />
                        </div>

                        <button
                          onClick={handleSave}
                          disabled={saving}
                          className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 rounded-lg shadow-md hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex justify-center items-center gap-2"
                        >
                          {saving ? 'Guardando...' : '💾 Guardar Revisión'}
                        </button>
                      </div>
                    </div>

                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-gray-300 bg-gray-50/50">
              <span className="text-4xl mb-2">👈</span>
              <p className="text-lg font-medium">Selecciona una inspección de la lista</p>
            </div>
          )}
        </div>

        {/* Botón Cerrar Flotante */}
        <button 
          onClick={onClose} 
          className="absolute top-4 right-4 bg-white/90 p-2 rounded-full shadow-lg text-gray-500 hover:text-red-600 hover:bg-white hover:scale-110 transition-all z-50"
          title="Cerrar (Esc)"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
        </button>
      </div>
    </div>
  )
}