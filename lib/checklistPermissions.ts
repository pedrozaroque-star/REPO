// lib/checklistPermissions.ts

// --- 1. CONFIGURACIÓN ---
const TIMEZONE = 'America/Los_Angeles';

// --- 2. HELPERS SEGUROS (Evitan crashes) ---
const isValidDate = (d: any) => {
  return d instanceof Date && !isNaN(d.getTime());
};

const getSafeLADateISO = (dateInput: any) => {
  try {
    if (!dateInput) return new Date().toISOString().split('T')[0];
    
    let date;
    // Manejo especial para fechas string simples para no perder el día por UTC
    if (typeof dateInput === 'string' && dateInput.match(/^\d{4}-\d{2}-\d{2}$/)) {
       date = new Date(`${dateInput}T12:00:00`); 
    } else {
       date = new Date(dateInput);
    }

    if (!isValidDate(date)) return 'Invalid Date';

    return new Intl.DateTimeFormat('en-CA', {
      timeZone: TIMEZONE,
      year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(date);
  } catch (e) {
    console.error('Error calculando fecha:', e);
    return 'Error';
  }
};

// --- 3. FORMATO Y ESTILOS UI ---
export const formatDateLA = (dateString: any) => {
  if (!dateString) return 'N/A';
  try {
    // Si viene solo fecha YYYY-MM-DD, devolverla directo formateada
    if (typeof dateString === 'string' && dateString.match(/^\d{4}-\d{2}-\d{2}$/)) {
        const [y, m, d] = dateString.split('-');
        return `${d}/${m}/${y}`;
    }

    const date = new Date(dateString);
    if (!isValidDate(date)) return 'Fecha Inválida';

    return new Intl.DateTimeFormat('es-MX', {
      timeZone: TIMEZONE,
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: true
    }).format(date);
  } catch (e) {
    return 'Error Fecha';
  }
};

export const formatTimeLA = (dateString: any) => {
    if (!dateString) return '--:--';
    try {
        const date = new Date(dateString);
        if (!isValidDate(date)) return '--:--';
        return new Intl.DateTimeFormat('es-MX', {
            timeZone: TIMEZONE,
            hour: '2-digit', minute: '2-digit', hour12: true
        }).format(date);
    } catch { return '--:--' }
};

export const getStatusColor = (status: string) => {
  switch (status?.toLowerCase()) {
    case 'completado': case 'aprobado': return 'bg-green-100 text-green-800 border-green-200';
    case 'revisado': return 'bg-blue-100 text-blue-800 border-blue-200';
    case 'pendiente': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
    case 'rechazado': case 'corregir': return 'bg-red-100 text-red-800 border-red-200';
    case 'cerrado': return 'bg-purple-100 text-purple-800 border-purple-200';
    default: return 'bg-gray-100 text-gray-800 border-gray-200';
  }
};

export const getStatusLabel = (status: string) => {
  if (!status) return 'Pendiente';
  return status.charAt(0).toUpperCase() + status.slice(1);
};

// --- 4. PERMISOS DE EDICIÓN (SOLUCIÓN CRUZ CASTILLO) ---
export const canEditChecklist = (
  checklistDateInput: any,
  userRole: string,
  ownerId: string | number,
  currentUserId: string | number
) => {
  try {
    const role = (userRole || '').toLowerCase();

    // Jefes siempre pueden
    if (['admin', 'manager', 'supervisor', 'gerente'].includes(role)) {
      return { canEdit: true };
    }

    // Asistentes: Reglas estrictas
    if (role === 'asistente' || role === 'assistant') {
      
      // A. Validar Dueño (Convertimos a String para que "54" sea igual a 54)
      if (String(ownerId) !== String(currentUserId)) {
        return { canEdit: false, reason: 'Solo puedes editar tus propios checklists' };
      }

      // B. Validar Fecha (Solo hoy operativo)
      const checkDate = getSafeLADateISO(checklistDateInput);
      const today = getSafeLADateISO(new Date());

      if (checkDate === 'Error' || checkDate === 'Invalid Date') {
         // Si la fecha es corrupta, bloqueamos por seguridad
         return { canEdit: false, reason: 'Error en la fecha del checklist' };
      }

      if (checkDate !== today) {
        return { canEdit: false, reason: `Solo puedes editar checklists del día actual (${today})` };
      }

      return { canEdit: true };
    }

    return { canEdit: false, reason: 'Sin permisos para editar' };

  } catch (error) {
    console.error('Error permisos:', error);
    return { canEdit: false, reason: 'Error interno verificando permisos' };
  }
};

// --- 5. PERMISOS DE REVISIÓN ---
export const canReviewChecklist = (
  checklistType: string,
  userRole: string,
  currentStatus?: string
) => {
  const role = (userRole || '').toLowerCase();
  
  if (role === 'admin') return { canReview: true, reviewLevel: 'admin' };
  if (['assistant', 'asistente'].includes(role)) return { canReview: false };

  // Managers revisan assistant_checklists
  if (role === 'manager' && checklistType === 'assistant') {
      return { canReview: true, reviewLevel: 'manager' };
  }
  // Supervisores revisan manager_checklists
  if (role === 'supervisor' && checklistType === 'manager') {
      return { canReview: true, reviewLevel: 'supervisor' };
  }

  return { canReview: false };
};

export const canChangeStatus = (
  fromStatus: string,
  toStatus: string,
  userRole: string
) => {
  const role = (userRole || '').toLowerCase();
  
  if (role === 'admin') return { canChange: true };
  if (fromStatus === 'cerrado') return { canChange: false, reason: 'Ya está cerrado' };
  if (toStatus === 'cerrado' && role !== 'admin') return { canChange: false, reason: 'Solo Admin cierra' };
  
  return { canChange: true };
};