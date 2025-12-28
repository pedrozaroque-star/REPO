// lib/checklistPermissions.ts

// --- 1. CONFIGURACIÓN ---
const TIMEZONE = 'America/Los_Angeles';

// --- 2. HELPERS SEGUROS ---

const isValidDate = (d: any) => {
  return d instanceof Date && !isNaN(d.getTime());
};

const getSafeLADateISO = (dateInput: any) => {
  try {
    if (!dateInput) return new Date().toISOString().split('T')[0];
    
    let date;
    if (typeof dateInput === 'string' && dateInput.includes('-') && !dateInput.includes('T')) {
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

// --- 3. FORMATO Y ESTILOS ---

export const formatDateLA = (dateString: any) => {
  if (!dateString) return 'N/A';
  try {
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

export const getStatusColor = (status: string) => {
  switch (status?.toLowerCase()) {
    case 'completado': return 'bg-green-100 text-green-800 border-green-200';
    case 'revisado': return 'bg-blue-100 text-blue-800 border-blue-200';
    case 'pendiente': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
    case 'corregir': return 'bg-red-100 text-red-800 border-red-200';
    default: return 'bg-gray-100 text-gray-800 border-gray-200';
  }
};

export const getStatusLabel = (status: string) => {
  if (!status) return 'Pendiente';
  return status.charAt(0).toUpperCase() + status.slice(1);
};

// --- 4. PERMISOS DE EDICIÓN (CRUZ CASTILLO FIX) ---

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
      
      // Validar Dueño
      if (String(ownerId) !== String(currentUserId)) {
        return { canEdit: false, reason: 'No es tu checklist' };
      }

      // Validar Fecha (Hoy)
      const checkDate = getSafeLADateISO(checklistDateInput);
      const today = getSafeLADateISO(new Date());

      if (checkDate === 'Error' || checkDate === 'Invalid Date') {
         return { canEdit: false, reason: 'Error en fecha del checklist' };
      }

      if (checkDate !== today) {
        return { canEdit: false, reason: `Solo puedes editar hoy (${today})` };
      }

      return { canEdit: true };
    }

    return { canEdit: false, reason: 'Sin permisos' };

  } catch (error) {
    console.error('Error permisos:', error);
    return { canEdit: false, reason: 'Error interno' };
  }
};

// --- 5. PERMISOS DE REVISIÓN (LO QUE FALTABA) ---

// ¿Quién puede abrir el modal de revisión?
export const canReviewChecklist = (userRole: string) => {
    const role = (userRole || '').toLowerCase();
    // Solo líderes pueden revisar
    return ['admin', 'manager', 'supervisor', 'gerente'].includes(role);
};

// ¿Quién puede cambiar el estatus a "Revisado" o "Corregir"?
export const canChangeStatus = (userRole: string) => {
    const role = (userRole || '').toLowerCase();
    // Mismos roles que revisión
    return ['admin', 'manager', 'supervisor', 'gerente'].includes(role);
};