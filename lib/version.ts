/**
 * @module version
 * @description Master system version and release configuration for SM TEG (Sistema de Management Tacos Gavilan).
 * @businessRules
 * - Semantic Versioning (SemVer): v[MAJOR].[MINOR].[PATCH].
 *   * MAJOR: Reescritura integral de plataforma o cambios estructurales incompatibles (v2.0.0).
 *   * MINOR: Módulos completos nuevos o expansiones clave (v2.6.0 Contabilidad, v2.7.0 Viele & Sons, v2.8.0 Salud del Sistema).
 *   * PATCH: Correcciones de bugs, optimización de caché, calibraciones y parches operativos (v2.6.1 - v2.6.3, v2.7.5).
 * - Sincronizado permanentemente con AppSidebar (desktop/mobile), Reporte de Actividades y Asistente IA.
 * @notes Fuente única de verdad para el versionado de la aplicación en UI, chatbots y documentación.
 */

export interface VersionMilestone {
    version: string;
    date: string;
    titleEs: string;
    titleEn: string;
    highlightsEs: string[];
    highlightsEn: string[];
}

export const SYSTEM_VERSION = {
    version: 'v2.8.0',
    versionNumber: '2.8.0',
    releaseMonthEs: 'Septiembre 2026',
    releaseMonthEn: 'September 2026',
    stage: 'Producción',
    stageEn: 'Production',
    year: '2026',
    labelEs: 'Septiembre 2026 • SM TEG v2.8.0',
    labelEn: 'September 2026 • SM TEG v2.8.0',
    brand: 'SM TEG',
    lastUpdated: '2026-09-09'
} as const;

export const VERSION_HISTORY: readonly VersionMilestone[] = [
    {
        version: 'v2.8.0',
        date: '09-Sep-2026',
        titleEs: 'Centinela de Salud, Blindaje PMIX y Gobernanza del Sistema',
        titleEn: 'System Health Sentinel, PMIX Shielding & System Governance',
        highlightsEs: [
            'Centinela de Salud del Sistema (/admin/salud-sistema) con monitoreo de cuota Supabase (8GB cap) y alertas por correo',
            'Blindaje de caché PMIX write-through síncrono con salvaguarda defensiva de 120 días y seguridad Dual-Gate en cron jobs',
            'Calibración de facturación Cingular/Simplify HR (Hollywood, Bell, La Puente) y hoja de ruta ejecutiva R365',
            'Reglas estrictas de aislamiento de reportes y commits autorizados únicamente por el usuario'
        ],
        highlightsEn: [
            'System Health Sentinel (/admin/salud-sistema) with Supabase quota monitoring (8GB cap) and email alerting',
            'PMIX synchronous write-through cache hardening with 120-day defensive guard and Dual-Gate cron security',
            'Cingular/Simplify HR payroll calibration (Hollywood, Bell, La Puente) and R365 executive roadmap',
            'Strict reports isolation governance and explicit user-only commit authorizations'
        ]
    },
    {
        version: 'v2.7.5',
        date: '08-Sep-2026',
        titleEs: 'Sincronización de Ausencias RONOS y Puente Planificador-Horarios',
        titleEn: 'RONOS Absence Sync & Planner-to-Schedules Bridge',
        highlightsEs: [
            'Sincronización automatizada de ausencias aprobadas (Sick, PTO, Permisos) desde RONOS en ventana de 4 semanas',
            'Semáforos de cobertura visual (coversBlock = false) para turnos en descubierto',
            'Puente automatizado semanal entre el Planificador y los Horarios oficiales de supervisores'
        ],
        highlightsEn: [
            'Automated sync of approved absences (Sick, PTO, Leaves) from RONOS in 4-week window',
            'Visual coverage traffic lights (coversBlock = false) for uncovered shifts',
            'Automated weekly bridge between Planner and official supervisor schedules'
        ]
    },
    {
        version: 'v2.7.0',
        date: '06-07-Sep-2026',
        titleEs: 'Motor Integral de Compras Viele & Sons y Facturación Dual Sage 100',
        titleEn: 'Viele & Sons Procurement Engine & Sage 100 Dual Invoicing',
        highlightsEs: [
            'Módulo de Compras Viele & Sons (/admin/compras/viele) con catálogo de 89 insumos normalizados',
            'Checkout automatizado con partición estricta de 2 facturas independientes en Sage 100 (Sodas BIB vs Insumos Generales)',
            'Hoja de conteo físico imprimible en 2 páginas verticales (Letter Portrait)',
            'Edición dinámica de niveles PAR multi-tienda con guardado atómico y reordenamiento Drag & Drop',
            'Historial unificado multi-tienda (/admin/compras/viele/historial) con 2,614 órdenes y más de $4.01M auditables',
            'Restricción RBAC de seguridad para Stephany Torres (rol estricto planificador)'
        ],
        highlightsEn: [
            'Viele & Sons Procurement Module (/admin/compras/viele) with 89 standardized items',
            'Automated dual-invoice checkout in Sage 100 (Sodas BIB vs General Supplies)',
            'Printable physical inventory count sheet fitting exactly 2 vertical Letter pages',
            'Dynamic multi-store PAR level editor with atomic saving and Drag & Drop sorting',
            'Unified multi-store order history (/admin/compras/viele/historial) auditing 2,614 orders ($4.01M+)',
            'Strict RBAC security lock for Stephany Torres (planner-only role)'
        ]
    },
    {
        version: 'v2.6.3',
        date: '03-Sep-2026',
        titleEs: 'Centro de Configuración Contable y Bloqueador Step 11 Cohesion',
        titleEn: 'Accounting Configuration Center & Cohesion Step 11 Blocker',
        highlightsEs: [
            'Panel interactivo de configuración contable (/contabilidad/configuracion) para las 15 sucursales',
            'Validación estricta de órdenes abiertas/desbalanceadas (Step 11 de Cohesion) bloqueando envíos a QuickBooks (HTTP 422)',
            'Auditoría histórica de $32.7M USD en pólizas de diario contra QuickBooks Online',
            'Centinela de auditoría rodante de 7 días a las 6:15 AM PST para detección de reembolsos tardíos'
        ],
        highlightsEn: [
            'Interactive Accounting Configuration panel (/contabilidad/configuracion) for all 15 stores',
            'Strict open/unbalanced check validation (Cohesion Step 11) blocking QuickBooks publishing (HTTP 422)',
            'Historical audit of $32.7M USD in journal entries against QuickBooks Online',
            '6:15 AM PST 7-day rolling audit sentinel detecting late POS refunds'
        ]
    },
    {
        version: 'v2.6.2',
        date: '02-Sep-2026',
        titleEs: 'Grupo Sidebar Finanzas y Vinculación de Turnos Lynwood',
        titleEn: 'Finance Sidebar Group & Lynwood Schedule Integration',
        highlightsEs: [
            'Nuevo grupo \'Finanzas y Contabilidad\' en el sidebar para rol admin',
            'Acceso directo a Miles para Raquel Velázquez',
            'Vinculación dinámica de turnos reales de Carlos Velázquez (Lynwood #14) desde Supabase schedules'
        ],
        highlightsEn: [
            'New \'Finanzas y Contabilidad\' group in sidebar for admin role',
            'Direct shortcut to Miles for Raquel Velázquez',
            'Dynamic linking of Carlos Velázquez\'s real shifts (Lynwood #14) from Supabase schedules'
        ]
    },
    {
        version: 'v2.6.1',
        date: '01-Sep-2026',
        titleEs: 'Génesis de Reemplazo Cohesion y Dashboard TSX Nativo',
        titleEn: 'Cohesion Replacement Genesis & Native TSX Dashboard',
        highlightsEs: [
            'Ingeniería inversa de Cohesion (ahorro de $450/mes) con mapeo de 17 cuentas contables',
            'Migración integral de Reporte de Actividades a componente TSX 100% nativo con diseño PRO',
            'Auditoría de 4 pestañas de RONOS con formato de ponchadas 12h'
        ],
        highlightsEn: [
            'Reverse engineering of Cohesion ($450/month savings) mapping 17 GL accounts',
            'Full migration of Activities Report to 100% native TSX component with PRO design',
            'Audit of 4 RONOS tabs with 12h punch formatting'
        ]
    }
] as const;
