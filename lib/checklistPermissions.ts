/**
 * Utilidad para determinar si un checklist puede ser editado
 * Regla: Solo se puede editar el mismo día laboral (hasta 5am del día siguiente)
 */

export function canEditChecklist(
  createdAt: string,
  userRole: string,
  checklistUserId: number,
  currentUserId: number,
  checklistDate?: string,  // ← NUEVO PARÁMETRO
  supervisorStatus?: string,  // ← NUEVO PARÁMETRO
  adminStatus?: string  // ← NUEVO PARÁMETRO
) {
  // 1. Solo el creador
  if (checklistUserId !== currentUserId) {
    return { canEdit: false, reason: '❌ Solo el creador puede editar este checklist' }
  }

  // 2. Solo si está pendiente (no revisado)
  const supStatus = supervisorStatus || 'pendiente'
  const admStatus = adminStatus || 'pendiente'
  
  if (supStatus !== 'pendiente' || admStatus !== 'pendiente') {
    return { canEdit: false, reason: '❌ No se puede editar un checklist que ya ha sido revisado' }
  }

  // 3. Solo del día actual - CORRECCIÓN
  const dateToCheck = checklistDate || createdAt.split('T')[0]
  
  const today = new Date()
  const year = today.getFullYear()
  const month = String(today.getMonth() + 1).padStart(2, '0')
  const day = String(today.getDate()).padStart(2, '0')
  const todayStr = `${year}-${month}-${day}`
  
  if (dateToCheck !== todayStr) {
    return { canEdit: false, reason: '❌ Solo se pueden editar checklists del día actual' }
  }

  return { canEdit: true, reason: '' }
}

/**
 * Determina si un usuario puede revisar un checklist basado en su rol
 */
export function canReviewChecklist(
  checklistType: 'assistant' | 'manager' | 'supervisor',
  userRole: string,
  currentStatus?: string
): {
  canReview: boolean
  reviewLevel?: 'manager' | 'supervisor' | 'admin'
  reason?: string
} {
  const role = userRole.toLowerCase()

  // ASISTENTE CHECKLISTS: Solo Manager revisa
  if (checklistType === 'assistant') {
    if (role === 'manager' || role === 'admin') {
      return { canReview: true, reviewLevel: 'manager' }
    }
    return { canReview: false, reason: 'Solo Manager puede revisar checklists de Asistente' }
  }

  // MANAGER CHECKLISTS: Supervisor revisa → Admin cierra
  if (checklistType === 'manager') {
    if (role === 'supervisor' || role === 'admin') {
      // Supervisor revisa primero
      if (!currentStatus || currentStatus === 'pendiente' || currentStatus === 'rechazado') {
        return { canReview: true, reviewLevel: role === 'supervisor' ? 'supervisor' : 'admin' }
      }
      
      // Si supervisor ya aprobó, solo admin puede cerrar
      if (role === 'admin') {
        return { canReview: true, reviewLevel: 'admin' }
      }
      
      return { canReview: false, reason: 'Supervisor ya revisó, esperando cierre de Admin' }
    }
    return { canReview: false, reason: 'Solo Supervisor y Admin pueden revisar checklists de Manager' }
  }

  // SUPERVISOR CHECKLISTS (inspecciones): Solo Admin revisa
  if (checklistType === 'supervisor') {
    if (role === 'admin') {
      return { canReview: true, reviewLevel: 'admin' }
    }
    if (role === 'manager') {
      return { canReview: false, reason: 'Solo puedes consultar (sin editar)' }
    }
    return { canReview: false, reason: 'Solo Admin puede revisar inspecciones de Supervisor' }
  }

  return { canReview: false, reason: 'Tipo de checklist no válido' }
}

/**
 * Valida si se puede cambiar a un estado específico
 */
export function canChangeStatus(
  fromStatus: string,
  toStatus: string,
  userRole: string,
  reviewLevel: 'manager' | 'supervisor' | 'admin'
): {
  canChange: boolean
  reason?: string
} {
  const role = userRole.toLowerCase()

  // Admin puede hacer cualquier cosa
  if (role === 'admin') {
    return { canChange: true }
  }

  // No se puede reabrir algo cerrado
  if (fromStatus === 'cerrado') {
    return { canChange: false, reason: 'No se puede modificar un checklist cerrado' }
  }

  // Solo admin puede cerrar
  if (toStatus === 'cerrado' && role !== 'admin') {
    return { canChange: false, reason: 'Solo Admin puede cerrar' }
  }

  return { canChange: true }
}

/**
 * Determina el color del badge según el estado
 */
export function getStatusColor(status: string): string {
  switch (status.toLowerCase()) {
    case 'pendiente':
      return 'bg-yellow-100 text-yellow-800 border-yellow-300'
    case 'aprobado':
      return 'bg-green-100 text-green-800 border-green-300'
    case 'rechazado':
      return 'bg-red-100 text-red-800 border-red-300'
    case 'cerrado':
      return 'bg-blue-100 text-blue-800 border-blue-300'
    default:
      return 'bg-gray-100 text-gray-800 border-gray-300'
  }
}

/**
 * Obtiene el label en español del estado
 */
export function getStatusLabel(status: string): string {
  switch (status.toLowerCase()) {
    case 'pendiente':
      return 'Pendiente'
    case 'aprobado':
      return 'Aprobado'
    case 'rechazado':
      return 'Rechazado'
    case 'cerrado':
      return 'Cerrado'
    default:
      return status
  }
}

/**
 * Formatea fecha para mostrar correctamente
 * Maneja tanto strings de solo fecha (YYYY-MM-DD) como timestamps completos
 * 
 * CORRECCIÓN CRÍTICA: Si recibe "2025-12-23" (sin hora), NO lo convierte a UTC
 * porque JavaScript lo interpretaría como medianoche UTC y restaría 8 horas.
 */
export function formatDateLA(dateString: string | Date): string {
  // Si es un string de solo fecha (YYYY-MM-DD), parsearlo directamente SIN conversión
  if (typeof dateString === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    const [year, month, day] = dateString.split('-')
    return `${day}/${month}/${year}`
  }
  
  // Si es un timestamp completo con hora, ajustar a zona horaria LA
  const date = new Date(dateString)
  
  // Ajustar manualmente UTC-8
  const utc = date.getTime()
  const offset = -8 * 60 * 60 * 1000 // UTC-8 hours in milliseconds
  const laDate = new Date(utc + offset)
  
  // Formatear manualmente
  const day = String(laDate.getUTCDate()).padStart(2, '0')
  const month = String(laDate.getUTCMonth() + 1).padStart(2, '0')
  const year = laDate.getUTCFullYear()
  
  return `${day}/${month}/${year}`
}

/**
 * Formatea hora ajustando manualmente a zona horaria de Los Angeles (UTC-8)
 */
export function formatTimeLA(dateString: string | Date): string {
  const date = new Date(dateString)
  
  // Ajustar manualmente UTC-8
  const utc = date.getTime()
  const offset = -8 * 60 * 60 * 1000
  const laDate = new Date(utc + offset)
  
  const hours = String(laDate.getUTCHours()).padStart(2, '0')
  const minutes = String(laDate.getUTCMinutes()).padStart(2, '0')
  
  return `${hours}:${minutes}`
}