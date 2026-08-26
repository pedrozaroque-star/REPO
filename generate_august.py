import os
import re

source = r"c:\Users\pedro\Desktop\teg-modernizado\pendientes_julio.html"
target = r"c:\Users\pedro\Desktop\teg-modernizado\pendientes_agosto.html"

with open(source, "r", encoding="utf-8") as f:
    content = f.read()

# Replace general headers and stats
content = content.replace("Julio 2026", "Agosto 2026")
content = content.replace("Horas Julio", "Horas Agosto")
content = content.replace("117.8", "19.5")

# Replace table body using regex
content = re.sub(r"<tbody>.*?</tbody>", """<tbody>
                            <tr>
                                <td><strong>01-Aug-2026</strong></td>
                                <td>6:30 PM - 9:00 PM</td>
                                <td style="text-align: center; font-weight: 700;">4.5</td>
                                <td><span class="table-badge-module">Preparador</span> <span class="table-badge-module">Soporte IA</span></td>
                                <td>
                                    <div class="lang-split">
                                         <div class="es-desc">- **Preparador (Proyecciones por Tramos)**: Transición completa del sistema de proyecciones de carne de intervalos de 30 minutos a bloques de tramos de hora pico (Apertura, Almuerzo, Medio Día, Cena, Cierre). Implementación del ajuste dinámico del horario de apertura de cada tienda para el Tramo 1.<br>- **Preparador (Datos en Vivo)**: Se forzó la obtención de datos HTTP sin caché (`no-store`) para que las proyecciones se refresquen en tiempo real. Corrección del cálculo de REAL/hr usando horas transcurridas para el período activo en curso.<br>- **Preparador (Calendario y Vistas)**: Adición de selector interactivo de fechas para consultar proyecciones y ventas reales (`REAL lbs`) de cualquier día pasado. Restauración de la vista por defecto de 30 minutos con conmutador interactivo entre modos `30 Min` y `Tramos`.<br>- **Preparador (🔥 Máx. Charola)**: Nuevo badge de capacidad máxima de charola por tarjeta de proteína usando `Math.ceil()` para redondear al entero superior. Exportación de tabla HTML estática autocontenida para iPhone Safari y WhatsApp.<br>- **Preparador (Guía Operativa)**: Botón `VER GUÍA` con modal interactivo de guía operativa + tabla de máximos. Simplificación del diseño a estilo monocromático de alto contraste.<br>- **Soporte IA**: Sincronización del prompt del asistente de soporte con las nuevas funcionalidades del preparador.</div>
                                         <div class="en-desc">- **Prep Line (Period Blocks)**: Full transition from 30-min intervals to peak time period blocks (Opening, Lunch, Mid Day, Dinner, Close). Dynamic store opening time adjustment for Period 1.<br>- **Prep Line (Live Data)**: Enforced zero-cache HTTP fetching for real-time projection refresh. Fixed REAL/hr calculation using elapsed hours for active in-progress period.<br>- **Prep Line (Calendar & Views)**: Added interactive date picker to view projections and real sales for any past date. Restored 30-min default view with interactive view mode switcher.<br>- **Prep Line (🔥 Max Tray)**: New max holding tray capacity badge per protein card using Math.ceil(). Exported self-contained static HTML table for iPhone Safari and WhatsApp preview.<br>- **Prep Line (Operational Guide)**: VER GUÍA button with interactive operational guide modal + max tray table. Simplified to ultra-clean high-contrast monochrome design.<br>- **AI Support**: Synced support assistant prompt with new prep line features.</div>
                                    </div>
                                </td>
                            </tr>
                            <tr>
                                <td><strong>02-Aug-2026</strong></td>
                                <td>9:00 AM - 10:00 AM</td>
                                <td style="text-align: center; font-weight: 700;">1.0</td>
                                <td><span class="table-badge-module">Preparador</span></td>
                                <td>
                                    <div class="lang-split">
                                         <div class="es-desc">- **Preparador (Modo Básico vs Avanzado)**: Implementación de conmutador de modo de visualización Básico/Avanzado para tarjetas limpias de un solo número en modo básico. Se restringió el modal de alerta de "preparar siguiente bloque" exclusivamente al modo avanzado.<br>- **Preparador (Modo Tableta)**: Badge `TABLETA` prominente para botón de pantalla completa. Ocultamiento de botones y fechas no operativos en modo kiosko de pantalla completa para experiencia limpia de cocina. Auto-selección del día de la semana actual al abrir la Guía Operativa.</div>
                                         <div class="en-desc">- **Prep Line (Basic vs Advanced Mode)**: Display mode switch for clean single-number cards in basic mode. Restricted "prepare next block" alert modal to advanced mode only.<br>- **Prep Line (Tablet Mode)**: Prominent TABLETA badge for fullscreen button. Hidden non-operational buttons and dates in tablet kiosk mode for clean kitchen experience. Auto-select current day of week when opening Operational Guide.</div>
                                    </div>
                                </td>
                            </tr>
                            <tr>
                                <td><strong>03-Aug-2026</strong></td>
                                <td>5:00 PM - 5:30 PM</td>
                                <td style="text-align: center; font-weight: 700;">0.5</td>
                                <td><span class="table-badge-module">Inventario</span> <span class="table-badge-module">QuickBooks</span></td>
                                <td>
                                    <div class="lang-split">
                                         <div class="es-desc">- **Inventario (QuickBooks Estimates)**: Corrección crítica de la actualización de Estimates en QuickBooks configurando `sparse: false` para evitar que QBO elimine ítems no enviados durante guardados parciales diarios. Se implementó la preservación de ítems extraordinarios en el estado local de React.</div>
                                         <div class="en-desc">- **Inventory (QB Estimates)**: Critical fix for QuickBooks Estimate PATCH updates by setting `sparse: false` to prevent QBO from removing unlisted line items during partial daily saves. Implemented extraordinary item preservation in React local state.</div>
                                    </div>
                                </td>
                            </tr>
                            <tr>
                                <td><strong>04-Aug-2026</strong></td>
                                <td>9:45 AM - 7:00 PM</td>
                                <td style="text-align: center; font-weight: 700;">9.0</td>
                                <td><span class="table-badge-module">Preparador</span> <span class="table-badge-module">Inventario</span> <span class="table-badge-module">Reportes</span></td>
                                <td>
                                    <div class="lang-split">
                                         <div class="es-desc">- **Reportes**: Finalización del reporte de agosto con 16.5 hrs totales. Corrección de error de tipo TypeScript en preparador (`idx` → `localIndex`).<br>- **Preparador (Edición Manual)**: Implementación de edición táctil tap-to-edit para sobreescritura manual de proyecciones de carne en modo básico con almacenamiento persistente.<br>- **Preparador (Modo Manual Semanal)**: Desarrollo del botón toggle de 3 modos [Manual | Básica | Avanzada] con persistencia semanal recurrente en base de datos y almacenamiento local por día de la semana.<br>- **Preparador (Kiosko Seguro)**: Deshabilitación de la edición táctil en tarjetas del modo kiosko de tableta para prevenir ediciones accidentales del cocinero.<br>- **Inventario (PAR Semanal)**: Corrección para permitir actualizaciones inmediatas de PAR en `Configurar Semana` para tipos de orden de Líquidos y Uniformes.<br>- **Auditoría del Sistema**: Análisis completo del proyecto revisando los 20 módulos pendientes contra la funcionalidad ya implementada para determinar gaps.</div>
                                         <div class="en-desc">- **Reports**: Finalized August report at 16.5 total hrs. Fixed TypeScript type error in preparador module.<br>- **Prep Line (Manual Edit)**: Tap-to-edit manual meat projection override in basic mode with persistent storage.<br>- **Prep Line (Weekly Manual Mode)**: 3-mode toggle [Manual | Basic | Advanced] with recurring weekly database and local persistence per day of week.<br>- **Prep Line (Safe Kiosk)**: Disabled card touch-editing in tablet kiosk mode to prevent accidental cook edits.<br>- **Inventory (Weekly PAR)**: Fixed immediate PAR updates in Configure Week for Liquids and Uniforms order types.<br>- **System Audit**: Full project analysis reviewing all 20 pending modules against implemented functionality to identify gaps.</div>
                                    </div>
                                </td>
                            </tr>
                            <tr>
                                <td><strong>06-Aug-2026</strong></td>
                                <td>12:30 PM - 12:45 PM</td>
                                <td style="text-align: center; font-weight: 700;">1.0</td>
                                <td><span class="table-badge-module">Preparador</span> <span class="table-badge-module">Base de Datos</span></td>
                                <td>
                                    <div class="lang-split">
                                         <div class="es-desc">- **Preparador (Sincronización Tableta-PC)**: Integración de programación manual con polling de auto-sincronización cada 10 segundos para tableta de cocina (bodega), asegurando paridad exacta con la PC del gerente.<br>- **Base de Datos**: Aplicación de migración de tabla `prep_manual_schedule` a la base de datos de producción. Corrección del parsing numérico de `storeId` para compatibilidad entre tipos texto y numérico.<br>- **Preparador (Visibilidad Cocina)**: Agrandamiento de letras de encabezado de carne y números objetivo para máxima visibilidad en la cocina.</div>
                                         <div class="en-desc">- **Prep Line (Tablet-PC Sync)**: Manual schedule integration with 10s auto-sync polling for kitchen tablet (bodega), ensuring exact parity with manager PC.<br>- **Database**: Applied `prep_manual_schedule` table migration to production DB. Fixed numeric storeId parsing for text/numeric type compatibility.<br>- **Prep Line (Kitchen Visibility)**: Enlarged meat header letters and target numbers for maximum kitchen visibility.</div>
                                    </div>
                                </td>
                            </tr>
                            <tr>
                                <td><strong>07-Aug-2026</strong></td>
                                <td>2:30 PM - 3:00 PM</td>
                                <td style="text-align: center; font-weight: 700;">0.5</td>
                                <td><span class="table-badge-module">Horarios</span></td>
                                <td>
                                    <div class="lang-split">
                                         <div class="es-desc">- **Horarios (Notificaciones de Violaciones)**: Habilitación de notificaciones por correo electrónico para violaciones de ALMUERZO (LUNCH breaks), alertando automáticamente cuando un empleado no toma su descanso de comida requerido dentro del período establecido.</div>
                                         <div class="en-desc">- **Schedules (Violation Notifications)**: Enabled email notifications for LUNCH break violations, automatically alerting when an employee fails to take their required meal break within the established period.</div>
                                    </div>
                                </td>
                            </tr>
                            <tr>
                                <td><strong>24-Aug-2026</strong></td>
                                <td>10:30 PM - 12:30 AM</td>
                                <td style="text-align: center; font-weight: 700;">3.0</td>
                                <td><span class="table-badge-module">Horarios Móvil</span> <span class="table-badge-module">Auditoría Exhaustiva</span> <span class="table-badge-module">QA & Suite</span></td>
                                <td>
                                    <div class="lang-split">
                                         <div class="es-desc">- **Horarios (Replicación Inteligente)**: Corrección del umbral de detección de semanas incompletas al 50% para permitir copiar horarios incluso cuando existan turnos parciales o adelantados (caso Azusa).<br>- **Horarios (Versión Móvil Dedicada)**: Diseño e implementación de interfaz táctil responsiva optimizada para teléfonos de supervisores: selector de semanas (Semana 1 vs Semana 2), pestañas de filtro por sucursal con semáforo en vivo, carrusel de 7 días con indicadores de cobertura AM/PM, tarjeta maestra de turno de supervisor y tarjetas verticales de colaboradores con botón de asignación/edición.<br>- **Auditoría Exhaustiva Línea por Línea (4 Zonas Paralelas)**: Auditoría minuciosa de las 2,345 líneas del componente: corrección de desajustes de formato de tiempo en presets (`HH:mm:ss` vs `HH:mm`), protección con encadenamiento opcional para roles nulos/indefinidos, validación de seguridad `canEdit` en replicación masiva, persistencia de orden de empleados en `localStorage`, corrección del cálculo del comodín del supervisor entre tiendas y consolidación de estatus AM/PM para vista unificada.<br>- **Pruebas Automatizadas y Simulación en Vivo**: Creación y ejecución de suite de pruebas automatizadas (11/11 tests superados al 100%) incluyendo prueba de inserción real (smoke test) en base de datos.</div>
                                         <div class="en-desc">- **Schedules (Smart Replication)**: Fixed incomplete week detection threshold to 50% allowing schedule replication even when partial or advanced shifts exist (Azusa case).<br>- **Schedules (Dedicated Mobile UI)**: Designed and implemented touch-optimized responsive interface for supervisors on mobile: week switcher (Week 1 vs Week 2), store filter tabs with live status dots, 7-day carousel with AM/PM coverage indicators, supervisor master shift card, and vertical employee cards with 1-tap shift assignment.<br>- **Line-by-Line Exhaustive Audit (4 Parallel Zones)**: Thorough audit of all 2,345 lines: fixed time format mismatch in presets (HH:mm:ss vs HH:mm), added optional chaining protection for null/undefined user roles, added canEdit security validation on mass replication, persisted employee order in localStorage, fixed multi-store supervisor wildcard availability chain, and consolidated AM/PM status for multi-store view.<br>- **Automated Tests & Runtime Simulation**: Created and executed live test suite (11/11 tests passed 100%) including live database mutation smoke test.</div>
                                    </div>
                                </td>
                            </tr>
                        </tbody>""", content, flags=re.DOTALL)

# Replace .parallel-grid using regex
content = re.sub(r'<div class="parallel-grid">.*?</div>\s*</div>\s*</div>\s*</div>', """<div class="parallel-grid">
                    <div class="parallel-card">
                        <h4>
                            <span>Pruebas en Sucursal/Local</span>
                            <span class="hours">3.0 hrs</span>
                        </h4>
                        <p>
                            Testing preparador tablet kiosk mode at stores, validating manual mode sync between manager PC and kitchen tablet.
                            <span class="en-text">Pruebas en sitio del kiosko y sincronización manual.</span>
                        </p>
                    </div>
                    <div class="parallel-card">
                        <h4>
                            <span>Monitoreo DB y APIs</span>
                            <span class="hours">2.0 hrs</span>
                        </h4>
                        <p>
                            Monitoring Supabase prep_manual_schedule table, QuickBooks Estimate sync, and violation email delivery.
                            <span class="en-text">Monitoreo de sincronización y envíos de correo.</span>
                        </p>
                    </div>
                    <div class="parallel-card">
                        <h4>
                            <span>Planificación y Diseño</span>
                            <span class="hours">1.0 hrs</span>
                        </h4>
                        <p>
                            Planning the max tray holding capacity system and 3-mode toggle architecture (Manual/Basic/Advanced).
                            <span class="en-text">Planificación de arquitectura de 3 modos y charolas.</span>
                        </p>
                    </div>
                </div>""", content, flags=re.DOTALL)

# Replace .modules-summary using regex
content = re.sub(r'<div class="modules-summary">.*?</div>\s*</div>\s*</div>\s*</div>\s*</div>\s*</div>\s*</div>', """<div class="modules-summary">
                    <div class="module-summary-item">
                        <span>Preparador de Carne y Cocina KDS / Prep Line & Kitchen KDS</span>
                        <span class="hours">12.5 hrs</span>
                    </div>
                    <div class="module-summary-item">
                        <span>Inventario, Pedidos y Sincronización QuickBooks / Inventory & QuickBooks</span>
                        <span class="hours">2.0 hrs</span>
                    </div>
                    <div class="module-summary-item">
                        <span>Actividades, Planificador y Horarios / Activities & Scheduling</span>
                        <span class="hours">0.5 hrs</span>
                    </div>
                    <div class="module-summary-item">
                        <span>Mantenimiento General y Soporte Técnico / General Maintenance & Support</span>
                        <span class="hours">1.5 hrs</span>
                    </div>
                    <div class="module-summary-item">
                        <span>Clon y Sincronizador de Basecamp / Basecamp Integration</span>
                        <span class="hours">0.0 hrs</span>
                    </div>
                    <div class="module-summary-item">
                        <span>Procedimientos, Fotos e Inspecciones / Procedures & Camera Inspections</span>
                        <span class="hours">0.0 hrs</span>
                    </div>
                </div>""", content, flags=re.DOTALL)

with open(target, "w", encoding="utf-8") as f:
    f.write(content)
print("HTML successfully generated!")
