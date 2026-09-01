const fs = require('fs');

const augustData = JSON.parse(fs.readFileSync('scripts/august_full_data.json', 'utf-8'));

const septemberData = {
    totalHours: 1.75,
    rows: [
        {
            date: "01-Sep-2026",
            time: "2:00 AM - 3:45 AM",
            hours: 1.75,
            badges: [
                "Soporte IA Natural",
                "Versionado v2.6.0",
                "Reportes Septiembre"
            ],
            descEs: "• <strong>Soporte IA (Chatbot Natural & Cero Jerga Técnica)</strong>: Reestructuración integral del prompt y tono del asistente para eliminar toda la jerga técnica (SQL, bases de datos, crons, endpoints) y adaptar el lenguaje a gerentes y supervisores de restaurante en tono 100% humano y cálido.<br>• <strong>Contador de Versiones UI (v2.6.0)</strong>: Centralización del sistema de versionado en lib/version.ts y despliegue automático de la nueva versión oficial SM TEG v2.6.0 (Septiembre 2026 • Producción).<br>• <strong>Reportes Mensuales (Pestaña Septiembre 2026)</strong>: Creación y activación de la nueva pestaña y reporte de Septiembre 2026 en el visualizador /admin/reporte-actividades, generando el entorno de pendientes y horas para el nuevo mes.",
            descEn: "• <strong>AI Support (Natural Chatbot & Zero Tech Jargon)</strong>: Comprehensive overhaul of assistant prompt and persona, removing all programming jargon (SQL, databases, crons) in favor of 100% human, warm, restaurant operational language for store managers and staff.<br>• <strong>UI Version Counter (v2.6.0)</strong>: Centralized automated versioning system in lib/version.ts and rolled out canonical SM TEG v2.6.0 (September 2026 • Production).<br>• <strong>Monthly Reports (September 2026 Tab)</strong>: Created and activated the new September 2026 tab and standalone report in /admin/reporte-actividades to track the new month's roadmap."
        }
    ],
    effort: [
        { module: "Mantenimiento General, Crons y Reportes", hours: 0.75 },
        { module: "Soporte IA & Asistente Conversacional", hours: 0.50 },
        { module: "Contador de Versiones UI & Navegación", hours: 0.50 }
    ],
    tasks: augustData.tasks
};

fs.writeFileSync('scripts/september_full_data.json', JSON.stringify(septemberData, null, 2), 'utf-8');
console.log('✅ Created scripts/september_full_data.json with 27 tasks and Day 1 entries!');
