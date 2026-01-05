// lib/checklistPermissions.ts

// --- 1. CONFIGURACIÓN ---
const TIMEZONE = 'America/Los_Angeles';

// --- 2. HELPERS SEGUROS ---
const isValidDate = (d: any) => {
  return d instanceof Date && !isNaN(d.getTime());
};

export const getSafeLADateISO = (dateInput: any) => {
  try {
    // FECHA DE HOY (AJUSTADA A JORNADA LABORAL)
    // Si la fecha input es HOY, necesitamos ver si son las 3 AM para contar como "ayer"
    if (!dateInput) {
      const now = new Date();
      // Convertir a hora LA
      const laDateString = now.toLocaleString("en-US", { timeZone: TIMEZONE });
      const laDate = new Date(laDateString);

      // REGLA DE ORO: Si es antes de las 5am, restamos un día
      if (laDate.getHours() < 5) {
        laDate.setDate(laDate.getDate() - 1);
      }

      // Formato YYYY-MM-DD
      const y = laDate.getFullYear();
      const m = String(laDate.getMonth() + 1).padStart(2, '0');
      const d = String(laDate.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }

    // FECHA DEL REPORTE (Input)
    // Si ya viene como YYYY-MM-DD, devolverlo tal cual
    if (typeof dateInput === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
      return dateInput;
    }

    const date = new Date(dateInput);
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
    if (typeof dateString === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
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
    if (typeof dateString === 'string' && dateString.includes(':')) return dateString;
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
    case 'completado': case 'aprobado': return 'bg-green-100 text-green-800 border-green-300';
    case 'revisado': return 'bg-blue-100 text-blue-800 border-blue-300';
    case 'pendiente': return 'bg-yellow-100 text-yellow-800 border-yellow-300';
    case 'rechazado': case 'corregir': return 'bg-red-100 text-red-800 border-red-300';
    case 'cerrado': return 'bg-purple-100 text-purple-800 border-purple-300';
    default: return 'bg-gray-100 text-gray-800 border-gray-300';
  }
};

export const getStatusLabel = (status: string) => {
  if (!status) return 'Pendiente';
  return status.charAt(0).toUpperCase() + status.slice(1);
};

// --- 4. PERMISOS DE EDICIÓN (CON REGLA DE 5 AM) ---
export const canEditChecklist = (
  checklistDateInput: any,
  userRole: string,
  ownerId: string | number,
  currentUserId: string | number,
  checklistStatus?: string // [NEW] Optional status parameter
) => {
  try {
    const role = (userRole || '').toLowerCase();
    const status = (checklistStatus || '').toLowerCase();

    // 0. RECHAZADO: Excepción de Regla (Puede editar sin importar fecha)
    if (status === 'rechazado') {
      // Solo el dueño puede editarlo
      if (String(ownerId) !== String(currentUserId)) {
        return { canEdit: false, reason: 'Solo el dueño puede corregir su rechazo' };
      }
      return { canEdit: true };
    }

    // 1. ADMIN: Puede editar todo
    if (role === 'admin') return { canEdit: true };

    // 2. MANAGER y SUPERVISOR: Reglas Estrictas (Solo Dueño y Fecha)
    if (['manager', 'gerente', 'supervisor', 'asistente', 'assistant'].includes(role)) {

      // A. Validar Dueño (CRÍTICO: Managers no pueden editar inspecciones de supervisores)
      if (String(ownerId) !== String(currentUserId)) {
        return { canEdit: false, reason: 'Solo puedes editar tus propios registros' };
      }

      // B. Validar Fecha (JORNADA LABORAL HASTA 5 AM)
      const todayLaboral = getSafeLADateISO(null); // Fecha turnada (ej. Ayer si es < 5am)
      const todayCalendar = getSafeLADateISO(new Date()); // Fecha real de calendario (ej. Hoy)
      const checkDate = getSafeLADateISO(checklistDateInput);

      if (checkDate === 'Error') return { canEdit: false, reason: 'Error de fecha' };

      // [FIX] Permitir si es el día laboral O el día natural (para evitar bloqueos de madrugada)
      if (checkDate !== todayLaboral && checkDate !== todayCalendar) {
        return { canEdit: false, reason: `Cerrado. Solo editable durante la jornada del ${todayLaboral}` };
      }

      return { canEdit: true };
    }

    return { canEdit: false, reason: 'Sin permisos' };

  } catch (error) {
    console.error('Error permisos:', error);
    return { canEdit: false, reason: 'Error interno' };
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
  return { canChange: true };
};

export const isOverdue = (dateString: string, status: string) => {
  if (!dateString) return false;
  if (['aprobado', 'cerrado', 'revisado'].includes((status || '').toLowerCase())) return false;

  const created = new Date(dateString);
  const now = new Date();

  // Diferencia en días
  const diffTime = Math.abs(now.getTime() - created.getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  return diffDays > 2;
};