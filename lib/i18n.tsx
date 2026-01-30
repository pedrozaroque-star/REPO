'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

type Language = 'es' | 'en';

type Dictionary = {
    [key: string]: string | Dictionary;
};

// DICCIONARIOS
const dictionaries: Record<Language, any> = {
    es: {
        // TOP NAV
        nav: {
            title: 'Sistema de Monitoreo',
            update: 'Actualizar App',
            logout: 'Cerrar Sesión',
            profile: 'Perfil',
        },
        // SECTIONS (Groups)
        sections: {
            operations: 'OPERACIONES',
            management: 'GESTIÓN',
            analysis: 'ANÁLISIS',
            kiosks: 'KIOSKS QR',
        },
        // ITEMS
        items: {
            supervisor: 'Supervisor',
            manager: 'Manager',
            assistants: 'Asistentes',
            schedules: 'Horarios',
            dashboard: 'Dashboard',
            stores: 'Tiendas',
            users: 'Usuarios',
            templates: 'Plantillas',
            sales: 'Ventas',
            reports: 'Reportes',
            planner: 'Planificador',
            feedback: 'Feedback Clientes',
            kiosk_feedback: 'Feedback Clientes',
            eval_staff: 'Eval. Staff',
        },
        // LOGIN
        login: {
            system_title: 'Sistema de Monitoreo y Seguimiento',
            card_title: 'Ingreso al Sistema',
            user_label: 'Usuario / Correo',
            pass_label: 'Contraseña',
            user_placeholder: 'ejemplo@tacosgavilan.com',
            enter_button: 'Entrar',
            validating: 'Validando...',
            error_generic: 'Error al iniciar sesión',
            error_unexpected: 'Error inesperado. Por favor intenta de nuevo.',
            or_login_with: 'O ingresa con',
            google_button: 'Cuenta Corporativa Google',
            footer_text: 'Uso exclusivo autorizado.',
        },
        // DASHBOARD
        dashboard: {
            title: 'Dashboard',
            live: 'En Vivo',
            subtitle: 'Análisis Operativo en Tiempo Real',
            avg_efficiency: 'Eficiencia Promedio',
            global_score: 'Score Global',
            good_perf: 'Buen Desempeño',
            red_alert: 'Alerta Roja',
            nps: 'NPS Clientes',
            audits_today: 'Auditorías Hoy',
            audits_week: 'Auditorías Semana',
            audits_month: 'Auditorías Mes',
            audits_year: 'Auditorías Año',
            audits_total: 'Total Auditorías',
            perf_by_category: 'Desempeño por Categoría',
            focus_areas: 'Áreas de Enfoque',
            top_supervisors: 'Top Supervisores',
            customer_feedback: 'Feedback de Clientes',
            latest: 'Últimos',
            no_comments: 'Sin comentarios recientes',
            store_ranking: 'Ranking de Sucursales',
            store: 'Tienda',
            score: 'Score',
            activity_history: 'Historial de Actividad',
            audit_by: 'Auditoría de',
            view_detail: 'Ver detalle',
            // Categories
            cat_service: 'Servicio',
            cat_meat: 'Carnes',
            cat_food: 'Alimentos',
            cat_tortilla: 'Tortillas',
            cat_cleaning: 'Limpieza',
            cat_grooming: 'Personal'
        },
        // SALES
        sales: {
            title: 'Dashboard de Ventas',
            subtitle: 'Monitoreo en tiempo real de 15 sucursales (Toast API)',
            live_connected: 'LIVE API CONNECTED',
            connection_interrupted: 'Conexión con Toast Interrumpida',
            cache_warning: 'Mostrando datos almacenados en caché o limitados.',
            validating: 'Validando Integridad...',
            corrected: 'Datos Corregidos Auto.',
            updated: 'Actualizado',
            history: 'Historial',
            reports: 'Reportes',
            refresh: 'Actualizar',
            export_csv: 'Exportar CSV',
            detail_by_store: 'Detalle por Sucursal',
            store: 'Sucursal',
            net_sales: 'Ventas Netas',
            orders: 'Órdenes',
            avg_ticket: 'Ticket Promedio',
            labor_pct: 'Labor %',
            loading_connecting: 'Conectando con Toast API...',
            loading_fetching: 'Obteniendo datos de 15 tiendas...',
            loading_processing: 'Procesando información...',
            access_denied: 'Acceso Denegado: Sesión expirada o permisos insuficientes.',
            // Mobile cards
            sales_label: 'Ventas',
            orders_label: 'Órdenes',
            ticket_label: 'Ticket Prom.',
            labor_label: 'Labor',
            // Date labels
            today: 'Hoy',
            yesterday: 'Ayer',
            this_week: 'Esta Semana',
            current_month: 'Mes Actual',
            quarter: 'Trimestre',
            // Date Filter
            select_dates: 'Seleccionar fechas',
            custom_date: 'Fecha personalizada',
            start_date: 'Fecha inicio',
            end_date: 'Fecha fin',
            cancel: 'Cancelar',
            apply: 'Aplicar',
            last_week: 'Semana pasada',
            last_7: 'Últimos 7 días',
            last_month: 'Mes pasado',
        },
        // CHECKLISTS
        checklists: {
            title: 'Checklists',
            subtitle: 'Gestión de checklists de asistente',
            new_checklist: 'NUEVO CHECKLIST',
            total: 'Total',
            daily: 'Daily',
            temps: 'Temperaturas',
            leftover: 'Sobrante',
            tour: 'Recorrido',
            closing: 'Cierre',
            opening: 'Apertura',
            empty: 'No hay checklists registrados',
            edit: 'EDITAR',
            all_stores: 'Todas las sucursales',
            all_status: 'Todos',
            // Table
            date: 'Fecha',
            type: 'Tipo',
            store: 'Sucursal',
            shift: 'Turno',
            user: 'Usuario',
            duration: 'Duración',
            score: 'Score',
            status: 'Estado',
            actions: 'Acciones',
        },
        // STATUS
        status: {
            pendiente: 'Pendiente',
            aprobado: 'Aprobado',
            rechazado: 'Rechazado',
            corregir: 'Corregir',
            revisado: 'Revisado',
            completado: 'Completado',
            cerrado: 'Cerrado',
        },
        // SCHEDULE
        schedule: {
            title: 'Control de Operaciones',
            subtitle_view: 'Vista de lectura: Monitor de cobertura de tiendas.',
            subtitle_edit: 'Revisa el estado de tus tiendas y atiende las alertas de la semana.',
            organizer: 'Organizador de Horarios',
            organizer_subtitle: 'Asigna los turnos de tu equipo y asegura que todo esté cubierto.',
            status_label: 'ESTATUS:',
            covered: 'CUBIERTO',
            missing: 'FALTA AM/PM',
            empty: 'VACÍO',
            pending: 'PENDIENTE',
            collab: 'Colaborador',
            supervisor_zone: 'SUPERVISOR DE ZONA',
            assigned_stores: 'Tiendas Asignadas',
            last_capture: 'Última captura',
            syncing: 'Sincronizando horarios...',
            common_shifts: 'Turnos Comunes',
            alert_attention: 'ATENCIÓN',
            no_stores: 'No hay tiendas configuradas.',
            no_supervisors: 'No se encontraron supervisores asignados.',
            alert_covered: '¡Excelente! Todas las tiendas están cubiertas.',
            alert_missing_shifts: 'tiendas sin horarios programados.',
            alert_missing_coverage: 'tiene turnos descubiertos',
            save: 'Guardar cambios',
            copy_week: 'Copiar semana anterior',
            // Presets
            opening: 'Apertura',
            closing: 'Cierre',
            visit: 'Visita Sup.',
            off: 'Descanso',
            manual_schedule: 'Horario Manual',
            start_time: 'Entrada',
            end_time: 'Salida',
            copy_week_question: '¿Copiar Semana Anterior?',
            replication_text: 'Detectamos tiendas sin horarios. ¿Deseas replicar los turnos anteriores?',
            stores_to_fill: 'Tiendas a rellenar:',
            source: 'Origen:',
            destination: 'Destino:',
            no_thanks: 'No, gracias',
            yes_copy: 'Sí, Copiar',
            copying: 'Copiando...',
            alert_no_schedules: 'No se encontraron horarios en la semana anterior para esta tienda.',
            alert_copy_success: '¡Éxito! Se han copiado {n} horarios.',
            alert_copy_error: 'Hubo un error al copiar los horarios.',
        }
    },
    en: {
        // TOP NAV
        nav: {
            title: 'Monitoring System',
            update: 'Update App',
            logout: 'Log Out',
            profile: 'Profile',
        },
        // SECTIONS (Groups)
        sections: {
            operations: 'OPERATIONS',
            management: 'MANAGEMENT',
            analysis: 'ANALYSIS',
            kiosks: 'QR KIOSKS',
        },
        // ITEMS
        items: {
            supervisor: 'Supervisor',
            manager: 'Manager',
            assistants: 'Assistants',
            schedules: 'Schedules',
            dashboard: 'Dashboard',
            stores: 'Stores',
            users: 'Users',
            templates: 'Templates',
            sales: 'Sales',
            reports: 'Reports',
            planner: 'Planner',
            feedback: 'Customer Feedback',
            kiosk_feedback: 'Customer Feedback',
            eval_staff: 'Staff Eval',
        },
        // LOGIN
        login: {
            system_title: 'Monitoring & Tracking System',
            card_title: 'System Login',
            user_label: 'User / Email',
            pass_label: 'Password',
            user_placeholder: 'example@tacosgavilan.com',
            enter_button: 'Enter',
            validating: 'Validating...',
            error_generic: 'Error logging in',
            error_unexpected: 'Unexpected error. Please try again.',
            or_login_with: 'Or login with',
            google_button: 'Corporate Google Account',
            footer_text: 'Authorized use only.',
        },
        // DASHBOARD
        dashboard: {
            title: 'Dashboard',
            live: 'Live',
            subtitle: 'Real-Time Operational Analysis',
            avg_efficiency: 'Avg Efficiency',
            global_score: 'Global Score',
            good_perf: 'Good Performance',
            red_alert: 'Red Alert',
            nps: 'Customer NPS',
            audits_today: 'Audits Today',
            audits_week: 'Audits This Week',
            audits_month: 'Audits This Month',
            audits_year: 'Audits This Year',
            audits_total: 'Total Audits',
            perf_by_category: 'Performance by Category',
            focus_areas: 'Focus Areas',
            top_supervisors: 'Top Supervisors',
            customer_feedback: 'Customer Feedback',
            latest: 'Latest',
            no_comments: 'No recent comments',
            store_ranking: 'Store Ranking',
            store: 'Store',
            score: 'Score',
            activity_history: 'Activity History',
            audit_by: 'Audit by',
            view_detail: 'View detail',
            // Categories
            cat_service: 'Service',
            cat_meat: 'Meat',
            cat_food: 'Food',
            cat_tortilla: 'Tortillas',
            cat_cleaning: 'Cleaning',
            cat_grooming: 'Grooming'
        },
        // SALES
        sales: {
            title: 'Sales Dashboard',
            subtitle: 'Real-time monitoring of 15 locations (Toast API)',
            live_connected: 'LIVE API CONNECTED',
            connection_interrupted: 'Toast Connection Interrupted',
            cache_warning: 'Showing cached or limited data.',
            validating: 'Validating Integrity...',
            corrected: 'Auto-Corrected Data.',
            updated: 'Updated',
            history: 'History',
            reports: 'Reports',
            refresh: 'Refresh',
            export_csv: 'Export CSV',
            detail_by_store: 'Detail by Location',
            store: 'Location',
            net_sales: 'Net Sales',
            orders: 'Orders',
            avg_ticket: 'Avg Ticket',
            labor_pct: 'Labor %',
            loading_connecting: 'Connecting to Toast API...',
            loading_fetching: 'Fetching data from 15 stores...',
            loading_processing: 'Processing information...',
            access_denied: 'Access Denied: Session expired or insufficient permissions.',
            // Mobile cards
            sales_label: 'Sales',
            orders_label: 'Orders',
            ticket_label: 'Avg Ticket',
            labor_label: 'Labor',
            // Date labels
            today: 'Today',
            yesterday: 'Yesterday',
            this_week: 'This Week',
            current_month: 'Current Month',
            quarter: 'Quarter',
            // Date Filter
            select_dates: 'Select dates',
            custom_date: 'Custom date',
            start_date: 'Start date',
            end_date: 'End date',
            cancel: 'Cancel',
            apply: 'Apply',
            last_week: 'Last week',
            last_7: 'Last 7 days',
            last_month: 'Last month',
        },
        // CHECKLISTS
        checklists: {
            title: 'Checklists',
            subtitle: 'Assistant Checklist Management',
            new_checklist: 'NEW CHECKLIST',
            total: 'Total',
            daily: 'Daily',
            temps: 'Temps',
            leftover: 'Leftover',
            tour: 'Tour',
            closing: 'Closing',
            opening: 'Opening',
            empty: 'No checklists found',
            edit: 'EDIT',
            all_stores: 'All Locations',
            all_status: 'All',
            // Table
            date: 'Date',
            type: 'Type',
            store: 'Location',
            shift: 'Shift',
            user: 'User',
            duration: 'Duration',
            score: 'Score',
            status: 'Status',
            actions: 'Actions',
        },
        // STATUS
        status: {
            pendiente: 'Pending',
            aprobado: 'Approved',
            rechazado: 'Rejected',
            corregir: 'Fix Required',
            revisado: 'Reviewed',
            completado: 'Completed',
            cerrado: 'Closed',
        },
        // SCHEDULE
        schedule: {
            title: 'Operations Control',
            subtitle_view: 'Read-only view: Store coverage monitor.',
            subtitle_edit: 'Review store status and address weekly alerts.',
            organizer: 'Schedule Organizer',
            organizer_subtitle: 'Assign shifts to your team and ensure coverage.',
            status_label: 'STATUS:',
            covered: 'COVERED',
            missing: 'MISSING AM/PM',
            empty: 'EMPTY',
            pending: 'PENDING',
            collab: 'Collaborator',
            supervisor_zone: 'ZONE SUPERVISOR',
            assigned_stores: 'Assigned Stores',
            last_capture: 'Last capture',
            syncing: 'Syncing schedules...',
            common_shifts: 'Common Shifts',
            alert_attention: 'ATTENTION',
            no_stores: 'No stores configured.',
            no_supervisors: 'No supervisors assigned.',
            alert_covered: 'Excellent! All stores covered.',
            alert_missing_shifts: 'stores without scheduled shifts.',
            alert_missing_coverage: 'has open shifts',
            save: 'Save changes',
            copy_week: 'Copy previous week',
            // Presets
            opening: 'Opening',
            closing: 'Closing',
            visit: 'Sup. Visit',
            off: 'Off',
            manual_schedule: 'Manual Schedule',
            start_time: 'Start',
            end_time: 'End',
            copy_week_question: 'Copy Previous Week?',
            replication_text: 'We detected stores without schedules. Do you want to replicate previous shifts?',
            stores_to_fill: 'Stores to fill:',
            source: 'Source:',
            destination: 'Destination:',
            no_thanks: 'No, thanks',
            yes_copy: 'Yes, Copy',
            copying: 'Copying...',
            alert_no_schedules: 'No schedules found in previous week for this store.',
            alert_copy_success: 'Success! {n} shifts copied.',
            alert_copy_error: 'Error copying schedules.',
        }
    }
};

interface LanguageContextType {
    language: Language;
    setLanguage: (lang: Language) => void;
    t: (key: string) => string; // Translator function
    dictionary: any; // Raw dictionary access
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export function LanguageProvider({ children }: { children: ReactNode }) {
    const [language, setLanguage] = useState<Language>('es');

    // Persist preference
    useEffect(() => {
        const saved = localStorage.getItem('teg_language') as Language;
        if (saved && (saved === 'es' || saved === 'en')) {
            setLanguage(saved);
        }
    }, []);

    const changeLanguage = (lang: Language) => {
        setLanguage(lang);
        localStorage.setItem('teg_language', lang);
    };

    // Helper to access nested keys like "nav.title"
    const t = (path: string): string => {
        const keys = path.split('.');
        let current = dictionaries[language];
        for (const key of keys) {
            if (current[key] === undefined) return path; // Return key if not found
            current = current[key];
        }
        return typeof current === 'string' ? current : path;
    };

    return (
        <LanguageContext.Provider value={{ language, setLanguage: changeLanguage, t, dictionary: dictionaries[language] }}>
            {children}
        </LanguageContext.Provider>
    );
}

export function useLanguage() {
    const context = useContext(LanguageContext);
    if (!context) {
        throw new Error('useLanguage must be used within a LanguageProvider');
    }
    return context;
}
