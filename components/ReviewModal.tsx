'use client'

import { useState, useEffect } from 'react'
import { canReviewChecklist, canChangeStatus, formatDateLA } from '@/lib/checklistPermissions'

interface ReviewModalProps {
  isOpen: boolean
  onClose: () => void
  checklists: any[]
  checklistType: 'assistant' | 'manager' | 'supervisor'
  currentUser: {
    id: number
    name: string
    email: string
    role: string
  }
  onSave: () => void
}

export default function ReviewModal({ 
  isOpen, 
  onClose, 
  checklists, 
  checklistType,
  currentUser, 
  onSave 
}: ReviewModalProps) {
  const [reviews, setReviews] = useState<{[key: number]: {
    status: string
    comments: string
  }}>({})
  const [saving, setSaving] = useState<{[key: number]: boolean}>({})

  const reviewCheck = canReviewChecklist(checklistType, currentUser.role)
  const canReview = reviewCheck.canReview
  const reviewLevel = reviewCheck.reviewLevel

  useEffect(() => {
    if (isOpen && canReview && reviewLevel) {
      const initial: any = {}
      checklists.forEach((item, idx) => {
        const currentStatus = item[`estatus_${reviewLevel}`] || 'pendiente'
        const currentComments = item[`comentarios_${reviewLevel}`] || ''
        
        initial[idx] = {
          status: currentStatus,
          comments: currentComments
        }
      })
      setReviews(initial)
    }
  }, [isOpen, checklists, canReview, reviewLevel])

  const sendNotifications = async (inspection: any, observations: string) => {
  console.log('📧 DENTRO de sendNotifications')
  console.log('Inspection:', inspection)
  console.log('Observations:', observations)
  
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    
    // 1. Obtener el nombre/código de la tienda
    console.log('📧 Obteniendo info de la tienda ID:', inspection.store_id)
    const storeRes = await fetch(
      `${url}/rest/v1/stores?select=*&id=eq.${inspection.store_id}`,
      {
        headers: { 'apikey': key || '', 'Authorization': `Bearer ${key}` }
      }
    )
    const storesData = await storeRes.json()
    const store = Array.isArray(storesData) && storesData.length > 0 ? storesData[0] : null
    
    if (!store) {
      console.error('❌ No se encontró la tienda')
      return
    }
    
    console.log('📧 Tienda encontrada:', store)
    const storeName = store.code || store.name // Usar code o name
    console.log('📧 Buscando usuarios con store_scope que contenga:', storeName)
    
    // 2. Obtener TODOS los usuarios
    const usersRes = await fetch(
      `${url}/rest/v1/users?select=*`,
      {
        headers: { 'apikey': key || '', 'Authorization': `Bearer ${key}` }
      }
    )
    const allUsers = await usersRes.json()
    
    console.log('📧 Total usuarios:', allUsers.length)
    
    // 3. Filtrar usuarios de esta tienda
    const users = Array.isArray(allUsers) 
      ? allUsers.filter(u => {
          if (!u.store_scope || !Array.isArray(u.store_scope)) return false
          // Buscar si el store_scope contiene el nombre de la tienda
          return u.store_scope.some(scope => 
            scope.toUpperCase().includes(storeName.toUpperCase()) ||
            storeName.toUpperCase().includes(scope.toUpperCase())
          )
        })
      : []
    
    console.log('📧 Usuarios de esta tienda:', users)
    
    const recipients = users.filter(u => {
      const role = u.role?.toLowerCase()
      return role === 'manager' || role === 'asistente' || role === 'user'
    })
    
    console.log('📧 Recipients filtrados (manager/asistente/user):', recipients)
    
   const notifications = recipients.map(recipient => ({
  user_id: recipient.id,  // NOT NULL - destinatario
  type: 'observacion_supervisor',  // NOT NULL
  title: '⚠️ Observaciones de Supervisor',  // NOT NULL
  message: observations,  // Mensaje
  reference_type: 'supervisor_inspection',  // Tipo de referencia
  reference_id: inspection.id,  // ID del checklist
  is_read: false,  // No leído
  store_id: inspection.store_id,
  de_user_id: currentUser.id  // Quien envía
}))
    
    console.log('📧 Notificaciones a crear:', notifications)
    
    if (notifications.length > 0) {
      console.log('📧 Creando notificaciones...')
      const notifRes = await fetch(`${url}/rest/v1/notifications`, {
        method: 'POST',
        headers: {
          'apikey': key || '',
          'Authorization': `Bearer ${key}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify(notifications)
      })
      
      console.log('📧 Response status:', notifRes.status)
      if (!notifRes.ok) {
        const errorText = await notifRes.text()
        console.error('📧 Error response:', errorText)
      } else {
        console.log('✅ Notificaciones creadas exitosamente')
      }
      
      console.log('📧 Marcando notificaciones como enviadas...')
      await fetch(`${url}/rest/v1/supervisor_inspections?id=eq.${inspection.id}`, {
        method: 'PATCH',
        headers: {
          'apikey': key || '',
          'Authorization': `Bearer ${key}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({ notificaciones_enviadas: true })
      })
      
      console.log(`✅ ${notifications.length} notificaciones enviadas`)
    } else {
      console.log('⚠️ No hay recipients para enviar notificaciones')
    }
  } catch (err) {
    console.error('❌ Error sending notifications:', err)
  }
}

  const handleStatusChange = (index: number, newStatus: string) => {
    const item = checklists[index]
    const currentStatus = item[`estatus_${reviewLevel}`] || 'pendiente'
    
    const changeCheck = canChangeStatus(currentStatus, newStatus, currentUser.role, reviewLevel!)
    
    if (!changeCheck.canChange) {
      alert(changeCheck.reason)
      return
    }
    
    setReviews(prev => ({
      ...prev,
      [index]: { ...prev[index], status: newStatus }
    }))
  }

  const handleCommentsChange = (index: number, comments: string) => {
    setReviews(prev => ({
      ...prev,
      [index]: { ...prev[index], comments }
    }))
  }

  const handleSave = async (index: number) => {
    const item = checklists[index]
    const review = reviews[index]

    if (!review || !reviewLevel) return

    setSaving(prev => ({...prev, [index]: true}))

    try {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

      let table = 'assistant_checklists'
      if (checklistType === 'manager') table = 'manager_checklists'
      if (checklistType === 'supervisor') table = 'supervisor_inspections'

      const payload = {
        [`estatus_${reviewLevel}`]: review.status,
        [`reviso_${reviewLevel}`]: currentUser.name || currentUser.email,
        [`comentarios_${reviewLevel}`]: review.comments || null,
        [`fecha_revision_${reviewLevel}`]: new Date().toISOString()
      }

      const res = await fetch(`${url}/rest/v1/${table}?id=eq.${item.id}`, {
        method: 'PATCH',
        headers: {
          'apikey': key || '',
          'Authorization': `Bearer ${key}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify(payload)
      })

      if (res.ok) {
  // Enviar notificaciones si es inspección con observaciones
  if (checklistType === 'supervisor' && reviewLevel === 'admin') {
    console.log('🔍 Verificando envío de notificaciones...')
    console.log('Item:', item)
    console.log('Observaciones originales:', item.observaciones)
    console.log('Comentarios del admin:', review.comments)
    console.log('Notificaciones enviadas antes?:', item.notificaciones_enviadas)
    
    const hasObservations = item.observaciones || review.comments
    
    console.log('Tiene observaciones?:', hasObservations)
    console.log('hasObservations es truthy?:', !!hasObservations)
    console.log('!item.notificaciones_enviadas?:', !item.notificaciones_enviadas)
    console.log('Condición completa:', !!hasObservations && !item.notificaciones_enviadas)
    
    // FORZAR ENVÍO PARA PRUEBA
    if (hasObservations) {
      console.log('✅ ENVIANDO NOTIFICACIONES (FORZADO)...')
      try {
        await sendNotifications(item, review.comments || item.observaciones)
        console.log('✅ Notificaciones enviadas exitosamente')
      } catch (err) {
        console.error('❌ Error enviando notificaciones:', err)
      }
    } else {
      console.log('❌ NO hay observaciones')
    }
  }

  alert('✅ Revisión guardada correctamente')
  setSaving(prev => ({...prev, [index]: false}))
  onSave()
}else {
        const error = await res.text()
        console.error('Error:', error)
        alert('Error al guardar la revisión')
        setSaving(prev => ({...prev, [index]: false}))
      }
    } catch (err) {
      console.error('Error:', err)
      alert('Error al guardar la revisión')
      setSaving(prev => ({...prev, [index]: false}))
    }
  }

  if (!isOpen) return null

  if (!canReview) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
        onClick={onClose}>
        <div className="bg-white rounded-xl p-8 max-w-md">
          <h3 className="text-xl font-bold text-red-600 mb-4">Acceso Denegado</h3>
          <p className="text-gray-700 mb-6">{reviewCheck.reason}</p>
          <button
            onClick={onClose}
            className="w-full bg-gray-600 hover:bg-gray-700 text-white py-3 rounded-lg font-semibold">
            Cerrar
          </button>
        </div>
      </div>
    )
  }

  const getReviewTitle = () => {
    if (checklistType === 'assistant') return 'Revisión de Checklists de Asistente'
    if (checklistType === 'manager') return 'Revisión de Checklists de Manager'
    return 'Revisión de Inspecciones de Supervisor'
  }

  const getReviewLevelLabel = () => {
    if (reviewLevel === 'manager') return 'Manager'
    if (reviewLevel === 'supervisor') return 'Supervisor'
    return 'Admin'
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}>
      <div className="bg-white rounded-xl max-w-6xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="bg-gradient-to-r from-indigo-600 to-indigo-700 text-white p-6 flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold">{getReviewTitle()}</h2>
            <p className="text-indigo-100 text-sm">Revisando como: {getReviewLevelLabel()}</p>
          </div>
          <button onClick={onClose} className="text-white hover:bg-indigo-500 rounded-lg p-2 text-3xl">
            ×
          </button>
        </div>

        <div className="flex-1 overflow-auto p-6">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b-2 border-gray-300">
                  <th className="px-4 py-3 text-left font-bold text-gray-900">Fecha</th>
                  <th className="px-4 py-3 text-left font-bold text-gray-900">Hora</th>
                  <th className="px-4 py-3 text-left font-bold text-gray-900">Sucursal</th>
                  <th className="px-4 py-3 text-left font-bold text-gray-900">Usuario</th>
                  <th className="px-4 py-3 text-left font-bold text-gray-900">Tipo</th>
                  <th className="px-4 py-3 text-left font-bold text-gray-900">Score</th>
                  <th className="px-4 py-3 text-left font-bold text-gray-900">Estado</th>
                  <th className="px-4 py-3 text-left font-bold text-gray-900">Revisó</th>
                  <th className="px-4 py-3 text-left font-bold text-gray-900">Comentarios</th>
                  <th className="px-4 py-3 text-center font-bold text-gray-900">Acción</th>
                </tr>
              </thead>
              <tbody>
                {checklists.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-8 text-center text-gray-500">
                      No hay checklists para revisar
                    </td>
                  </tr>
                ) : (
                  checklists.map((item, idx) => {
                    const currentReview = reviews[idx] || { status: 'pendiente', comments: '' }
                    const scoreColor = item.score >= 80 ? 'text-green-600' : item.score >= 60 ? 'text-orange-600' : 'text-red-600'
                    const isSaving = saving[idx]
                    
                    return (
                      <tr key={idx} className="border-b border-gray-200 hover:bg-gray-50">
                        <td className="px-4 py-3">{formatDateLA(item.checklist_date || item.inspection_date || item.created_at)}</td>
                        <td className="px-4 py-3">{item.start_time}</td>
                        <td className="px-4 py-3">{item.store_name}</td>
                        <td className="px-4 py-3">{item.assistant_name || item.manager_name || item.supervisor_name || item.created_by}</td>
                        <td className="px-4 py-3">
                          <span className="text-xs px-2 py-1 bg-blue-100 text-blue-800 rounded">
                            {item.checklist_type || checklistType}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`font-bold ${scoreColor}`}>{item.score || item.overall_score || 0}%</span>
                        </td>
                        <td className="px-4 py-3">
                          <select
                            value={currentReview.status}
                            onChange={(e) => handleStatusChange(idx, e.target.value)}
                            disabled={isSaving}
                            className="px-3 py-2 border-2 border-indigo-300 rounded-lg font-semibold text-sm focus:border-indigo-500 focus:outline-none disabled:opacity-50">
                            <option value="pendiente">Pendiente</option>
                            <option value="aprobado">Aprobado</option>
                            <option value="rechazado">Rechazado</option>
                            {currentUser.role.toLowerCase() === 'admin' && (
                              <option value="cerrado">Cerrado</option>
                            )}
                          </select>
                        </td>
                        <td className="px-4 py-3 text-sm">
                          {item[`reviso_${reviewLevel}`] || '-'}
                        </td>
                        <td className="px-4 py-3">
                          <textarea
                            value={currentReview.comments}
                            onChange={(e) => handleCommentsChange(idx, e.target.value)}
                            disabled={isSaving}
                            rows={2}
                            placeholder={`Observaciones de ${getReviewLevelLabel()}`}
                            className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg text-sm focus:border-indigo-500 focus:outline-none resize-none disabled:opacity-50"
                          />
                        </td>
                        <td className="px-4 py-3 text-center">
                          <button
                            onClick={() => handleSave(idx)}
                            disabled={isSaving}
                            className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg font-semibold text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed">
                            {isSaving ? '...' : 'Guardar'}
                          </button>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="border-t border-gray-200 p-4 bg-gray-50 flex justify-between items-center">
          <div className="flex gap-3">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 bg-yellow-500 rounded border-2 border-yellow-600"></div>
              <span className="text-sm">Pendiente</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 bg-green-500 rounded border-2 border-green-600"></div>
              <span className="text-sm">Aprobado</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 bg-red-500 rounded border-2 border-red-600"></div>
              <span className="text-sm">Rechazado</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 bg-blue-500 rounded border-2 border-blue-600"></div>
              <span className="text-sm">Cerrado</span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="px-6 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg font-semibold">
            Cerrar
          </button>
        </div>
      </div>
    </div>
  )
}