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
            history_page: {
                title: "Historial Anual",
                subtitle: "Matriz de rendimiento mensual",
                best_month: "Mejor Mes",
                worst_month: "Peor Mes",
                store: "Sucursal",
                total: "TOTAL",
                global: "GLOBAL",
                loading: "Consultando Archivos Históricos...",
                analysis: {
                    title: "Análisis de Crecimiento",
                    subtitle: "Comparativa vs. Año Anterior",
                    growth_card: "Crecimiento Global",
                    mvp_card: {
                        badge: "MVP",
                        label: "Mayor Crecimiento"
                    },
                    alert_card: {
                        badge: "ALERTA",
                        label: "Mayor Caída"
                    },
                    table_title: "Desglose por Sucursal (Año vs Año)",
                    columns: {
                        store: "Sucursal",
                        sales_prev: "Venta",
                        sales_curr: "Venta",
                        diff: "Diferencia $",
                        growth: "Crecimiento %"
                    }
                }
            },
            reports_page: {
                title: "Reportes Operativos",
                concept: "Concepto",
                weekly_summary: "Resumen Semanal",
                monthly_totals: "Totales Mensuales",
                labor_table: {
                    day: "Día",
                    morning: "Mañana (AM)",
                    night: "Noche (PM)",
                    total: "Total Día"
                },
                controls: {
                    select_store: "Seleccionar Tienda",
                    all_stores: "Todas las Tiendas",
                    week_of: "Semana del",
                    update: "Actualizar",
                    export_pdf: "Exportar PDF"
                },
                tabs: {
                    ops: "Operaciones",
                    labor: "Bitácora Laboral",
                    monthly: "Mensual"
                },
                structure: {
                    sales_header: "Ventas",
                    proj_sales: "Ventas Proyectadas",
                    act_sales: "Ventas Reales (TOAST)",
                    diff_sales: "+ o - Ventas",
                    hours_header: "Horas",
                    sched_hours: "Horas Programadas",
                    act_hours: "Horas Reales (DSR)",
                    diff_hours: "+ o - Horas",
                    ot_hours: "Horas Extra",
                    kpi_header: "KPIs",
                    target_avg: "Ticket Promedio Meta",
                    act_avg: "Ticket Promedio Real",
                    diff_avg: "Ticket Promedio + o -",
                    labor_header: "Costo Laboral %",
                    proj_labor: "Laboral Proyectado %",
                    act_labor: "Laboral Real %",
                    diff_labor: "+ o - LABORAL",
                    ops_header: "Operaciones",
                    daily_cars: "Carros Diarios",
                    sos_time: "Tiempo SOS",
                    morning_leader: "Líder Mañana",
                    late_leader: "Líder Tarde"
                },
                monthly_cols: {
                    date: "FECHA",
                    sale: "VENTA",
                    open: "ABRIR",
                    close: "CERRAR",
                    order: "TICKET",
                    uber: "Uber/Post",
                    doordash: "Doordash",
                    grubhub: "Grubhub",
                    ebt: "EBT",
                    cars: "CARROS",
                    time: "TIEMPO",
                    week_sales: "Venta Semanal"
                },
                days: {
                    monday: "Lunes",
                    tuesday: "Martes",
                    wednesday: "Miércoles",
                    thursday: "Jueves",
                    friday: "Viernes",
                    saturday: "Sábado",
                    sunday: "Domingo"
                }
            }
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
            manager: 'Manager',
            // CREATION MENU
            creation: {
                title: 'Crear Nuevo Checklist',
                subtitle: 'Selecciona el tipo de checklist que deseas crear',
                back: 'Volver a Checklists',
                assistant_section: 'Asistente',
                manager_section: 'Manager',
                no_permission: 'No tienes permisos para crear checklists',
                start: 'Comenzar',
                locked_title: 'Sin permisos',
            },
            // CAPTURE FORM
            form: {
                store: 'Sucursal',
                date: 'Fecha',
                shift: 'Turno',
                shift_am: 'AM (Mañana)',
                shift_pm: 'PM (Tarde/Noche)',
                comments_label: 'Observaciones Adicionales',
                comments_placeholder: 'Escribe aquí cualquier detalle extra...',
                submit: 'Finalizar Checklist',
                loading: 'Finalizando...',
                offline: 'Offline',
                error_session: 'Error: Sesión no válida',
                error_missing: '⚠️ Faltan {n} preguntas por responder.',
                error_photos: '📸 Hay {n} preguntas que requieren foto obligatoria.',
                select: 'Selecciona...',
                feedback_label: 'Feedback General del Checklist',
                feedback_placeholder: 'Notas generales sobre la operación de hoy...',
            },
            // SUCCESS SCREEN
            success: {
                title: '¡Completado!',
                subtitle: 'El checklist ha sido registrado correctamente.',
                manager_title: '¡Todo Listo!',
                manager_subtitle: 'El checklist de manager ha sido registrado correctamente.',
                back_home: 'Volver al Inicio',
            },
            // DESCRIPTIONS
            descriptions: {
                daily: '34 verificaciones diarias',
                temperaturas: '21 lecturas de temperatura',
                sobrante: '11 productos en libras',
                recorrido: 'Salón, cocina y parking',
                cierre: '51 verificaciones de cierre',
                apertura: '13 procedimientos de apertura',
                manager: '53 preguntas de gestión',
                daily_title: 'Daily Checklist',
                temperaturas_title: 'Control de Temperaturas',
                sobrante_title: 'Producto Sobrante',
                recorrido_title: 'Recorrido de Limpieza',
                cierre_title: 'Inspección de Cierre',
                apertura_title: 'Inspección de Apertura',
                manager_title: 'Manager Checklist',
            }
        },
        // MANAGER CHECKLISTS
        manager_checklists: {
            subtitle: 'Gestión de supervisión (53 pts)',
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
        },
        // INSPECTIONS
        inspections: {
            title: 'Inspecciones de Supervisor',
            subtitle: 'Auditoría y control de calidad',
            new_inspection: 'Nueva Inspección',
            stats: {
                total: 'Total',
                average: 'Promedio',
                pending: 'Pendientes',
                approved: 'Aprobados'
            },
            filters: {
                all_stores: '🏪 Todas las Tiendas',
                all_supervisors: '🧑‍🏫 Todos los Supervisores',
                all: 'Todos',
                pending: 'Pendientes',
                approved: 'Aprobados',
                rejected: 'Rechazados',
            },
            table: {
                store: 'Tienda',
                supervisor: 'Supervisor',
                date: 'Fecha',
                shift: 'Turno',
                duration: 'Duración',
                score: 'Score',
                status: 'Estado',
                reviewed_by: 'Revisó',
                evidence: 'Evidencia',
                actions: 'Acciones',
                photos_count: 'Fotos',
            },
            list: {
                empty: 'No hay inspecciones.',
                empty_search: 'No se encontraron inspecciones.',
            },
            alerts: {
                no_permission: 'No tienes permiso para editar esta inspección.',
                load_error: 'Error al cargar inspecciones',
            },
            form: {
                title: 'Configuración de Visita',
                supervision_header: 'Supervisión',
                fields: {
                    store: 'Sucursal',
                    select_placeholder: 'Seleccionar...',
                    shift: 'Turno',
                    morning: 'Mañana (AM)',
                    afternoon: 'Tarde (PM)',
                    date: 'Fecha',
                    time: 'Hora',
                },
                evidence: {
                    title: 'EVIDENCIA DE VISITA',
                    subtitle: 'Firma Digital Visual',
                    take_selfie: 'Tomar Selfie',
                    uploading: 'Subiendo...',
                    mandatory: 'Obligatorio dentro de tienda',
                    missing: '📸 Falta evidencia: Debes tomarte una selfie dentro de la tienda.',
                },
                final_notes: {
                    title: 'Notas Finales',
                    placeholder: 'Escribe comentarios adicionales...',
                },
                actions: {
                    validate_location: 'VALIDAR UBICACIÓN',
                    finish: 'FINALIZAR INSPECCIÓN',
                    progress: 'Avance',
                    complete_requirement: 'Completa el 95%',
                    back_confirm: '⚠️ ¿Estás seguro de salir?\n\nPerderás todo el progreso de esta inspección no guardada.',
                },
                alerts: {
                    session_expired: 'Sesión expirada',
                    select_store: 'Selecciona una sucursal',
                    missing_items: '❌ Faltan {n} puntos por evaluar.',
                    saving: 'Guardando Inspección...',
                    syncing: 'Sincronizando fotos y evidencias con la nube.',
                    location_error: 'Error obteniendo ubicación.',
                    gps_timeout: 'Tiempo de espera agotado obteniendo GPS.',
                    location_far: '🚫 ESTÁS LEJOS DE LA TIENDA',
                    location_success: '✅ Ubicación validada!',
                    error_saving: 'Error guardando inspección',
                },
                dynamic: {
                    photo_label: 'Foto',
                    video_label: 'Video',
                    add_comment: 'Agregar comentario...',
                    photo_required: 'Foto Requerida',
                    upload_error: 'Error al subir archivo',
                    yes: 'SÍ',
                    no: 'NO',
                    na: 'N/A',
                    new_badge: 'NUEVO',
                    placeholder_text: 'Escribe tus observaciones aquí...',
                    over_limit: '⚠️ > 2 Lbs'
                }
            },
            review: {
                details: 'Detalles de Visita',
                store: 'Sucursal',
                shift: 'Turno',
                date: 'Fecha',
                start_time: 'Hora Inicial',
                end_time: 'Hora Final',
                duration: 'Duración',
                score: 'Puntaje',
                approve: 'Aprobar',
                reject: 'Rechazar',
                close_ticket: 'Cerrar Ticket',
                print: 'Imprimir',
                inspector_evidence: 'Evidencia de Visita',
                digital_signature: 'Firma Digital Visual',
            },
            edit: {
                error_title: 'No puedes editar esto',
                error_back: 'Volver a Inspecciones',
            },
        },

        // TIENDAS
        tiendas: {
            title: "Sucursales",
            new_store: "NUEVA TIENDA",
            search_placeholder: "Buscar por nombre, código, ciudad...",
            total: "Total",
            active: "Activas",
            supervisor_label: "Supervisor",
            view_details: "VER DETALLES",
            hide_details: "OCULTAR DETALLES",
            address: "Dirección",
            phone: "Teléfono",
            hours: "Horario",
            empty_title: "No se encontraron tiendas",
            empty_subtitle: "Prueba con otro término",
            modal: {
                edit_title: "Editar Sucursal",
                create_title: "Nueva Sucursal",
                cancel: "Cancelar",
                save: "GUARDAR CAMBIOS",
                saving: "GUARDANDO...",
                fields: {
                    name: "Nombre",
                    code: "Código",
                    address: "Dirección",
                    city: "Ciudad",
                    state: "Estado",
                    phone: "Teléfono",
                    hours: "Horario",
                    supervisor: "Supervisor"
                }
            }
        },

        // USUARIOS
        usuarios: {
            title: "Usuarios",
            subtitle: "Gestión de personal",
            new_user: "NUEVO USUARIO",
            search_placeholder: "Buscar usuario...",
            roles: {
                all: "Todos",
                admin: "Admin",
                supervisor: "Supervisor",
                manager: "Manager",
                asistente: "Asistente"
            },
            table: {
                user: "Usuario",
                role: "Rol",
                location: "Ubicación",
                status: "Estado",
                active: "Activo",
                inactive: "Inactivo"
            },
            modal: {
                edit_title: "Editar Usuario",
                create_title: "Nuevo Usuario",
                subtitle: "Gestione los accesos y roles del personal de manera segura.",
                sidebar: {
                    security_title: "Seguridad Primero",
                    security_description: "Configura roles específicos para limitar el acceso a datos sensibles.",
                    assignment_title: "Asignación Inteligente",
                    assignment_description: "Vincula usuarios a una o múltiples tiendas según su función."
                },
                sections: {
                    personal: "Información Personal",
                    security: "Seguridad",
                    roles: "Roles y Permisos",
                    roles_permissions: "Roles y Permisos"
                },
                fields: {
                    full_name: "Nombre Completo",
                    email: "Email Corporativo",
                    phone: "Teléfono",
                    is_active: "Cuenta Activa",
                    password: "Nueva Contraseña",
                    confirm_password: "Confirmar Contraseña",
                    role: "Rol del Usuario",
                    user_role: "Rol del Usuario",
                    assigned_store: "Tienda Asignada",
                    supervision_scope: "Supervisión (Múltiple)"
                },
                admin_access_title: "Acceso Global",
                admin_access_desc: "Los administradores tienen acceso irrestricto a todas las tiendas.",
                admin_scope: {
                    title: "Acceso Global",
                    description: "Los administradores tienen acceso irrestricto a todas las tiendas."
                },
                staff_scope: {
                    description: "La tienda principal donde este usuario registra su actividad."
                },
                roles: {
                    admin: "Admin",
                    supervisor: "Supervisor",
                    manager: "Manager",
                    asistente: "Asistente"
                },
                placeholders: {
                    name: "Ej. Juan Pérez",
                    email: "juan@tacosgavilan.com",
                    password: "••••••••",
                    keep_password: "Dejar vacío para mantener",
                    confirm_password: "Repetir contraseña",
                    select_store: "Seleccionar",
                    phone: "(555) 000-0000"
                },
                errors: {
                    pass_mismatch: "Las contraseñas no coinciden",
                    pass_length: "La contraseña debe tener al menos 6 caracteres",
                    name_email_required: "Nombre y Email son obligatorios",
                    password_required: "La contraseña es obligatoria"
                },
                buttons: {
                    cancel: "Cancelar",
                    save: "Guardar Cambios",
                    create: "Crear Usuario"
                }
            }
        },

        // PLANTILLAS
        plantillas: {
            title: "Plantillas",
            subtitle: "Gestión de formatos",
            new_template: "NUEVA",
            search_placeholder: "Buscar plantilla...",
            edit_questions: "EDITAR PREGUNTAS",
            active: "ACTIVO",
            inactive: "INACTIVO",
            empty_title: "No se encontraron plantillas",
            editor: {
                question_types: {
                    yes_no: "Sí / No",
                    rating_5: "Estrellas (1-5)",
                    nps_10: "NPS (0-10)",
                    text: "Texto Libre",
                    number: "Número",
                    photo: "Solo Foto",
                    compliance: "Cumple / Parcial / No Cumple"
                },
                errors: {
                    not_found: "Plantilla no encontrada",
                    load_error: "Error cargando datos",
                    save_order_success: "✅ Orden guardado exitosamente",
                    save_order_error: "Error al guardar el orden",
                    create_section_prompt: "Nombre de la nueva sección:",
                    create_question_prompt: "Escribe la nueva pregunta:",
                    session_expired: "Tu sesión ha expirado. Por favor recarga la página para volver a ingresar.",
                    create_question_error: "Error al crear pregunta: ",
                    delete_confirm: "¿Borrar esta pregunta?",
                    update_error: "Error al actualizar: ",
                    delete_error: "Error al eliminar: ",
                    network_error: "Error de red"
                },
                saving: "Guardando...",
                save_order: "Guardar Orden",
                empty_section: "Sin preguntas en esta sección",
                labels: {
                    question_text: "Texto de la Pregunta",
                    section: "Sección",
                    response_type: "Tipo de Respuesta",
                    photo_required: "Foto Obligatoria",
                    photo_req_badge: "Foto Req.",
                    ready: "Listo",
                    new_badge: "NUEVO",
                    add_question: "Agregar Pregunta",
                    empty_template: "Esta plantilla está vacía. ¡Comienza agregando una sección!",
                    create_first_section: "Crear Primera Sección",
                    new_section: "NUEVA SECCIÓN"
                }
            }
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
            history_page: {
                title: "Annual History",
                subtitle: "Monthly Performance Matrix",
                best_month: "Best Month",
                worst_month: "Worst Month",
                store: "Store",
                total: "TOTAL",
                global: "GLOBAL",
                loading: "Querying Historical Archives...",
                analysis: {
                    title: "Growth Analysis",
                    subtitle: "Comparison vs. Previous Year",
                    growth_card: "Global Growth",
                    mvp_card: {
                        badge: "MVP",
                        label: "Highest Growth"
                    },
                    alert_card: {
                        badge: "ALERT",
                        label: "Biggest Drop"
                    },
                    table_title: "Breakdown by Store (Year vs Year)",
                    columns: {
                        store: "Store",
                        sales_prev: "Sales",
                        sales_curr: "Sales",
                        diff: "Diff $",
                        growth: "Growth %"
                    }
                }
            },
            reports_page: {
                title: "Operational Reports",
                concept: "Concept",
                weekly_summary: "Weekly Summary",
                monthly_totals: "Monthly Totals",
                labor_table: {
                    day: "Day",
                    morning: "Morning (AM)",
                    night: "Night (PM)",
                    total: "Day Total"
                },
                controls: {
                    select_store: "Select Store",
                    all_stores: "All Stores",
                    week_of: "Week of",
                    update: "Update",
                    export_pdf: "Export PDF"
                },
                tabs: {
                    ops: "Operations",
                    labor: "Labor Log",
                    monthly: "Monthly"
                },
                structure: {
                    sales_header: "Sales",
                    proj_sales: "Projected Sales",
                    act_sales: "Actual Sales (TOAST)",
                    diff_sales: "+ or - Sales",
                    hours_header: "Hours",
                    sched_hours: "Scheduled Hours",
                    act_hours: "Actual Hours (DSR)",
                    diff_hours: "+ or - Hours",
                    ot_hours: "Overtime Hours",
                    kpi_header: "KPIs",
                    target_avg: "Target Avg Order",
                    act_avg: "Actual Avg Order",
                    diff_avg: "Avg Order + or -",
                    labor_header: "Labor Cost %",
                    proj_labor: "Projected Labor %",
                    act_labor: "Actual Labor %",
                    diff_labor: "+ or - LABOR",
                    ops_header: "Operations",
                    daily_cars: "Daily Cars",
                    sos_time: "SOS Time",
                    morning_leader: "Morning Leader",
                    late_leader: "Late Leader"
                },
                monthly_cols: {
                    date: "DATE",
                    sale: "SALE",
                    open: "OPEN",
                    close: "CLOSE",
                    order: "TICKET",
                    uber: "Uber/Post",
                    doordash: "Doordash",
                    grubhub: "Grubhub",
                    ebt: "EBT",
                    cars: "CARS",
                    time: "TIME",
                    week_sales: "Week Sales"
                },
                days: {
                    monday: "Monday",
                    tuesday: "Tuesday",
                    wednesday: "Wednesday",
                    thursday: "Thursday",
                    friday: "Friday",
                    saturday: "Saturday",
                    sunday: "Sunday"
                }
            }
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
            manager: 'Manager',
            // CREATION MENU
            creation: {
                title: 'Create New Checklist',
                subtitle: 'Select the type of checklist you want to create',
                back: 'Back to Checklists',
                assistant_section: 'Assistant',
                manager_section: 'Manager',
                no_permission: 'You do not have permission to create checklists',
                start: 'Start',
                locked_title: 'No Permission',
            },
            // CAPTURE FORM
            form: {
                store: 'Branch',
                date: 'Date',
                shift: 'Shift',
                shift_am: 'AM (Morning)',
                shift_pm: 'PM (Afternoon/Evening)',
                comments_label: 'Additional Observations',
                comments_placeholder: 'Write any extra details here...',
                submit: 'Finalize Checklist',
                loading: 'Finalizing...',
                offline: 'Offline',
                error_session: 'Error: Invalid Session',
                error_missing: '⚠️ {n} questions remaining.',
                error_photos: '📸 {n} questions require a mandatory photo.',
                select: 'Select...',
                feedback_label: 'General Checklist Feedback',
                feedback_placeholder: 'General notes on today\'s operation...',
            },
            // SUCCESS SCREEN
            success: {
                title: 'Completed!',
                subtitle: 'The checklist has been successfully registered.',
                manager_title: 'All Set!',
                manager_subtitle: 'The manager checklist has been successfully registered.',
                back_home: 'Back to Home',
            },
            // DESCRIPTIONS
            descriptions: {
                daily: '34 daily verifications',
                temperaturas: '21 temperature readings',
                sobrante: '11 products in lbs',
                recorrido: 'Dining, kitchen, and parking',
                cierre: '51 closing verifications',
                apertura: '13 opening procedures',
                manager: '53 management questions',
                daily_title: 'Daily Checklist',
                temperaturas_title: 'Temperature Control',
                sobrante_title: 'Leftover Product',
                recorrido_title: 'Cleaning Tour',
                cierre_title: 'Closing Inspection',
                apertura_title: 'Opening Inspection',
                manager_title: 'Manager Checklist',
            }
        },
        // MANAGER CHECKLISTS
        manager_checklists: {
            subtitle: 'Supervision Management (53 pts)',
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
        },
        // INSPECTIONS
        inspections: {
            title: 'Supervisor Inspections',
            subtitle: 'Audit and quality control',
            new_inspection: 'New Inspection',
            stats: {
                total: 'Total',
                average: 'Average',
                pending: 'Pending',
                approved: 'Approved'
            },
            filters: {
                all_stores: '🏪 All Stores',
                all_supervisors: '🧑‍🏫 All Supervisors',
                all: 'All',
                pending: 'Pending',
                approved: 'Approved',
                rejected: 'Rejected',
            },
            table: {
                store: 'Store',
                supervisor: 'Supervisor',
                date: 'Date',
                shift: 'Shift',
                duration: 'Duration',
                score: 'Score',
                status: 'Status',
                reviewed_by: 'Reviewed by',
                evidence: 'Evidence',
                actions: 'Actions',
                photos_count: 'Photos',
            },
            list: {
                empty: 'No inspections found.',
                empty_search: 'No inspections found.',
            },
            alerts: {
                no_permission: 'You do not have permission to edit this inspection.',
                load_error: 'Error loading inspections',
            },
            form: {
                title: 'Visit Settings',
                supervision_header: 'Supervision',
                fields: {
                    store: 'Branch',
                    select_placeholder: 'Select...',
                    shift: 'Shift',
                    morning: 'Morning (AM)',
                    afternoon: 'Afternoon (PM)',
                    date: 'Date',
                    time: 'Time',
                },
                evidence: {
                    title: 'VISIT EVIDENCE',
                    subtitle: 'Visual Digital Signature',
                    take_selfie: 'Take Selfie',
                    uploading: 'Uploading...',
                    mandatory: 'Mandatory inside store',
                    missing: '📸 Missing evidence: You must take a selfie inside the store.',
                },
                final_notes: {
                    title: 'Final Notes',
                    placeholder: 'Write additional comments...',
                },
                actions: {
                    validate_location: 'VALIDATE LOCATION',
                    finish: 'FINISH INSPECTION',
                    progress: 'Progress',
                    complete_requirement: 'Complete 95%',
                    back_confirm: '⚠️ Are you sure you want to leave?\n\nYou will lose all progress of this unsaved inspection.',
                },
                alerts: {
                    session_expired: 'Session expired',
                    select_store: 'Select a branch',
                    missing_items: '❌ {n} items remaining to evaluate.',
                    saving: 'Saving Inspection...',
                    syncing: 'Syncing photos and evidence with the cloud.',
                    location_error: 'Error getting location.',
                    gps_timeout: 'Timeout getting GPS.',
                    location_far: '🚫 YOU ARE FAR FROM THE STORE',
                    location_success: '✅ Location validated!',
                    error_saving: 'Error saving inspection',
                },
                dynamic: {
                    photo_label: 'Photo',
                    video_label: 'Video',
                    add_comment: 'Add comment...',
                    photo_required: 'Photo Required',
                    upload_error: 'Error uploading file',
                    yes: 'YES',
                    no: 'NO',
                    na: 'N/A',
                    new_badge: 'NEW',
                    placeholder_text: 'Write your observations here...',
                    over_limit: '⚠️ > 2 Lbs'
                }
            },
            review: {
                details: 'Visit Details',
                store: 'Branch',
                shift: 'Shift',
                date: 'Date',
                start_time: 'Start Time',
                end_time: 'End Time',
                duration: 'Duration',
                score: 'Score',
                approve: 'Approve',
                reject: 'Reject',
                close_ticket: 'Close Ticket',
                print: 'Print',
                inspector_evidence: 'Visit Evidence',
                digital_signature: 'Visual Digital Signature',
            },
            edit: {
                error_title: 'You cannot edit this',
                error_back: 'Back to Inspections',
            }
        },

        // STORES
        tiendas: {
            title: "Branches",
            new_store: "NEW STORE",
            search_placeholder: "Search by name, code, city...",
            total: "Total",
            active: "Active",
            supervisor_label: "Supervisor",
            view_details: "VIEW DETAILS",
            hide_details: "HIDE DETAILS",
            address: "Address",
            phone: "Phone",
            hours: "Hours",
            empty_title: "No stores found",
            empty_subtitle: "Try another search term",
            modal: {
                edit_title: "Edit Store",
                create_title: "New Store",
                cancel: "Cancel",
                save: "SAVE CHANGES",
                saving: "SAVING...",
                fields: {
                    name: "Name",
                    code: "Code",
                    address: "Address",
                    city: "City",
                    state: "State",
                    phone: "Phone",
                    hours: "Hours",
                    supervisor: "Supervisor"
                }
            }
        },

        // USERS
        usuarios: {
            title: "Users",
            subtitle: "Personnel Management",
            new_user: "NEW USER",
            search_placeholder: "Search user...",
            roles: {
                all: "All",
                admin: "Admin",
                supervisor: "Supervisor",
                manager: "Manager",
                asistente: "Assistant"
            },
            table: {
                user: "User",
                role: "Role",
                location: "Location",
                status: "Status",
                active: "Active",
                inactive: "Inactive"
            },
            modal: {
                edit_title: "Edit User",
                create_title: "New User",
                subtitle: "Manage personnel access and roles securely.",
                sidebar: {
                    security_title: "Security First",
                    security_description: "Configure specific roles to limit access to sensitive data.",
                    assignment_title: "Smart Assignment",
                    assignment_description: "Link users to one or multiple stores based on their role."
                },
                sections: {
                    personal: "Personal Information",
                    security: "Security",
                    roles: "Roles & Permissions",
                    roles_permissions: "Roles & Permissions"
                },
                fields: {
                    full_name: "Full Name",
                    email: "Corporate Email",
                    phone: "Phone",
                    is_active: "Active Account",
                    password: "New Password",
                    confirm_password: "Confirm Password",
                    role: "User Role",
                    user_role: "User Role",
                    assigned_store: "Assigned Store",
                    supervision_scope: "Supervision (Multiple)"
                },
                admin_access_title: "Global Access",
                admin_access_desc: "Administrators have unrestricted access to all stores.",
                admin_scope: {
                    title: "Global Access",
                    description: "Administrators have unrestricted access to all stores."
                },
                staff_scope: {
                    description: "The main store where this user logs their activity."
                },
                roles: {
                    admin: "Admin",
                    supervisor: "Supervisor",
                    manager: "Manager",
                    asistente: "Assistant"
                },
                placeholders: {
                    name: "Ex. John Doe",
                    email: "john@tacosgavilan.com",
                    password: "••••••••",
                    keep_password: "Leave empty to keep current",
                    confirm_password: "Repeat password",
                    select_store: "Select",
                    phone: "(555) 000-0000"
                },
                errors: {
                    pass_mismatch: "Passwords do not match",
                    pass_length: "Password must be at least 6 characters",
                    name_email_required: "Name and Email are required",
                    password_required: "Password is required"
                },
                buttons: {
                    cancel: "Cancel",
                    save: "Save Changes",
                    create: "Create User"
                }
            }
        },

        // TEMPLATES
        plantillas: {
            title: "Templates",
            subtitle: "Format Management",
            new_template: "NEW",
            search_placeholder: "Search template...",
            edit_questions: "EDIT QUESTIONS",
            active: "ACTIVE",
            inactive: "INACTIVE",
            empty_title: "No templates found",
            editor: {
                question_types: {
                    yes_no: "Yes / No",
                    rating_5: "Stars (1-5)",
                    nps_10: "NPS (0-10)",
                    text: "Free Text",
                    number: "Number",
                    photo: "Photo Only",
                    compliance: "Pass / Partial / Fail"
                },
                errors: {
                    not_found: "Template not found",
                    load_error: "Error loading data",
                    save_order_success: "✅ Order saved successfully",
                    save_order_error: "Error saving order",
                    create_section_prompt: "New section name:",
                    create_question_prompt: "Enter new question:",
                    session_expired: "Your session has expired. Please reload the page to log in again.",
                    create_question_error: "Error creating question: ",
                    delete_confirm: "Delete this question?",
                    update_error: "Error updating: ",
                    delete_error: "Error deleting: ",
                    network_error: "Network error"
                },
                saving: "Saving...",
                save_order: "Save Order",
                empty_section: "No questions in this section",
                labels: {
                    question_text: "Question Text",
                    section: "Section",
                    response_type: "Response Type",
                    photo_required: "Photo Required",
                    photo_req_badge: "Photo Req.",
                    ready: "Done",
                    new_badge: "NEW",
                    add_question: "Add Question",
                    empty_template: "This template is empty. Start by adding a section!",
                    create_first_section: "Create First Section",
                    new_section: "NEW SECTION"
                }
            }
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
