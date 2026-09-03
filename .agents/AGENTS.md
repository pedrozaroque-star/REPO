# 📖 REGLAS DE DOCUMENTACIÓN DEL PROYECTO

## 🔒 REGLA OBLIGATORIA: Documentación de Módulos
Cada archivo `.ts` o `.tsx` que funcione como módulo (página, API route, librería, componente principal) DEBE tener un bloque de documentación JSDoc al inicio del archivo que incluya:

1. **@module** — Nombre del módulo
2. **@description** — Qué hace el módulo (en español para contexto de negocio, inglés para términos técnicos)
3. **@businessRules** — Reglas de negocio relevantes
4. **@dataFlow** — Dependencias y flujo de datos
5. **@notes** — Gotchas, bugs arreglados, o decisiones de diseño importantes

### 🚨 LECTURA OBLIGATORIA AL INICIAR UNA TAREA:
Antes de modificar, analizar o trabajar con cualquier módulo del sistema, **el agente DEBE leer la descripción completa y las reglas de negocio documentadas al inicio del archivo** para contextualizarse correctamente y evitar romper lógica existente.

### Cuándo documentar:
- ✅ Al **crear** un módulo nuevo
- ✅ Al **editar** un módulo existente que NO tenga documentación
- ✅ Al arreglar un **bug crítico** (documentar el fix en @notes)
- ❌ NO es necesario para archivos triviales (configs, types simples, etc.)

---

## 🔬 REGLA OBLIGATORIA: Protocolo de Auditoría y Revisión Exhaustiva Línea por Línea
**Queda estrictamente prohibido realizar revisiones panorámicas, superficiales, resumidas o asumir que el código funciona solo porque compila.** Cuando el usuario o una tarea solicite analizar, auditar, revisar o verificar cualquier módulo o archivo:

1. **Lectura Completa y Línea por Línea (Sin Omitir Nada)**:
   - El agente DEBE leer el archivo **completo**, función por función, validando cada condicional, operador ternario, llamada asíncrona, desestructuración y acceso a propiedades.
2. **Uso de Subagentes Especializados en Paralelo**:
   - En módulos grandes o que superen varios cientos de líneas, el agente DEBE delegar la auditoría a múltiples subagentes especializados en paralelo, dividiendo los archivos o rangos de líneas para garantizar máxima profundidad y cobertura sin atajos.
3. **Validación de Cruces Relacionales y Coherencia de Datos**:
   - Comparar exhaustivamente constantes estáticas (ej. listas de estaciones, arrays de opciones, catálogos) contra los valores renderizados en UI y los esquemas/consultas de base de datos.
   - Validar casos borde en tiempo de ejecución: valores `null`/`undefined`, coerción falsy (ej. `0` o `""`), diferencias por mayúsculas/minúsculas o tildes (ej. `"Miércoles"` vs `"Miercoles"`), desajustes de zona horaria (`America/Los_Angeles`) y saltos de medianoche / 6:00 AM.
4. **Verificación de Seguridad y Transacciones**:
   - Auditar la autenticación/autorización en el backend (no confiar en query params de cliente), sanitizar entradas a endpoints y asegurar que operaciones múltiples de DB no provoquen pérdida de datos ante fallos.
5. **Simulaciones del Sistema y Pruebas Automatizadas Obligatorias (Mandatory Runtime Simulations)**:
   - **En CADA revisión profunda, análisis o auditoría de un módulo**, el agente TIENE LA OBLIGACIÓN de crear y ejecutar scripts de prueba/simulación en tiempo real (vía `tsx` / `node`).
   - El script de simulación DEBE probar activamente los flujos completos con datos reales del negocio:
     * Comportamiento en horas límite (ej. 5:59 AM vs 6:00 AM, 4:59 PM vs 5:00 PM).
     * Manipulación de zonas horarias (`America/Los_Angeles`) y cambios de medianoche.
     * Cruces de cadenas de texto con y sin acentos (`Miércoles` vs `Miercoles`, `Sábado` vs `Sabado`), mayúsculas y minúsculas.
     * Operaciones matemáticas (prevención de divisiones por cero `0/0`, `NaN`, `Infinity`).
     * Integridad de listas y catálogos estáticos contra la base de datos.
   - Ninguna revisión se considerará finalizada ni aprobada sin la salida exitosa en terminal de dicha simulación.
6. **Cero Mocks y Cero Pruebas a Medias**:
   - Todo análisis debe ser real, ejecutado contra la lógica del sistema, identificando los números de línea exactos del problema y su impacto operativo concreto.

---

## 🛑 REGLA OBLIGATORIA: Protocolo de Columnas Generadas (PostgreSQL Generated Columns) y Pruebas Reales de Mutación en DB

### 1. Prohibición de Columnas Calculadas en Payloads de Mutación (`INSERT` / `UPDATE`)
- **Regla Estricta**: NUNCA incluir columnas autocalculadas o generadas por PostgreSQL (`GENERATED ALWAYS AS`, triggers, o defaults dinámicos) en los objetos de `INSERT` o `UPDATE` de Supabase/SQL.
- **Ejemplos en el sistema**:
  * `supervisor_mileage_trips.mileage_value` (`distance_miles * rate_per_mile`)
  * `supervisor_mileage_trips.total_reimbursement` (`mileage_value + parking_amount + tolls_amount`)
  * O cualquier columna derivada similar en tablas de ventas, inventario o nómina.
- **Principio Operativo**: El backend solo debe enviar los valores atómicos de entrada (`distance_miles`, `rate_per_mile`, `quantity`, etc.). PostgreSQL se encarga de calcular y asignar las columnas generadas automáticamente. Enviar cualquier valor explícito (incluso si coincide con el cálculo) provocará un error fatal `PostgresError 428C9: cannot insert a non-DEFAULT value into column`.

### 2. Pruebas Obligatorias de Inserción y Mutación Real en Base de Datos (Live DB Mutation Smoke Tests)
- En **CADA auditoría, refactorización, creación de endpoints o corrección de módulos** que realice operaciones de escritura en base de datos (`POST`, `PUT`, `DELETE`):
  1. **Queda estrictamente prohibido asumir que la mutación funciona solo porque TypeScript compila (`npx tsc`)**.
  2. El agente TIENE LA OBLIGACIÓN de crear y ejecutar un script de prueba real en tiempo real (vía `tsx`) que inserte un registro de prueba en la tabla de Supabase, verifique la respuesta y lo limpie (`delete`) inmediatamente.
  3. Esto garantiza que no existan discrepancias invisibles de esquema, restricciones de llaves foráneas (`foreign keys`), violaciones de columnas generadas (`428C9`), tipos incompatibles o fallos de triggers.

---

## 🤖 REGLA OBLIGATORIA: Sincronización de Conocimiento del Asistente (TEG Assistant Sync)
Cada vez que se cree, modifique, elimine o actualice una característica, lógica de negocio, endpoint de API, o tabla de base de datos en el sistema, **el desarrollador/agente DEBE de inmediato actualizar el prompt del asistente** en `app/api/support-chat/route.ts` y sus herramientas de chat en `lib/chat-tools.ts`. Esto garantiza que el TEG Assistant AI aprenda de cada actualización del sistema y mantenga un dominio preciso del 100% del ecosistema en tiempo real.

### 📌 REGLA DE COMMIT Y PUSH: Sincronización Obligatoria de Documentación y Módulo TSX
Cada vez que se realice un commit a GitHub y se haga push, **el desarrollador/agente DEBE actualizar de manera obligatoria**:
1. El repositorio de datos del módulo nativo TSX (`scripts/[mes]_full_data.json` y `lib/reports-data.ts` vía `node scripts/export-reports-data-ts.js`), registrando el desglose de horas y descripción bilingüe de actividades para el dashboard nativo `/admin/reporte-actividades`.
2. El prompt y herramientas de chat de soporte del Asistente IA para reflejar los cambios realizados en el sistema.

### 📌 REGLA OBLIGATORIA: Nombre Oficial de la Marca
El nombre oficial de la empresa y marca es estrictamente **Tacos Gavilan** (NUNCA "Tacos El Gavilan"). Todos los correos electrónicos, comunicaciones corporativas, títulos, documentación, prompts de IA y respuestas deben usar exclusivamente **Tacos Gavilan**.

---

## 📊 REGLA OBLIGATORIA: Registro Exhaustivo de TODAS las Actividades en el Módulo Nativo TSX (/admin/reporte-actividades)
**Ninguna actividad realizada en cualquier conversación puede quedar fuera del registro mensual en el módulo nativo TSX** (`app/admin/reporte-actividades/page.tsx` y `lib/reports-data.ts`). El módulo nativo es la fuente oficial de horas trabajadas y DEBE reflejar el 100% del esfuerzo real invertido.

> [!IMPORTANT]
> **PROHIBICIÓN ESTRICTA DE GENERACIÓN DE HTML Y PDFS:**
> Queda estrictamente prohibido generar archivos HTML (`pendientes_*.html`) o compilar PDFs (`Reporte_*.pdf`, `generate-all-desktop-pdfs.js`). Todo el registro y visualización ejecutiva se gestiona 100% en el componente nativo Next.js/React TSX `/admin/reporte-actividades`.

### Qué se DEBE registrar (sin excepción):
1. **Código y commits** — Desarrollo de módulos, bug fixes, features, refactors, migraciones SQL
2. **Tech Packs y fichas técnicas** — Documentos de especificaciones para fabricantes o proveedores (uniformes, desechables, carnes, lácteos, etc.)
3. **RFQ y documentos de licitación** — Bidding volumes, solicitudes de cotización, portfolios de negociación
4. **Correos profesionales** — Redacción y envío de correos a proveedores, fabricantes, socios comerciales
5. **Análisis de datos** — Análisis de CSV, Excel, auditorías de inventario, análisis laboral, reportes financieros
6. **Generación de imágenes y assets** — Imágenes de productos, referencias para fabricantes, mockups de UI
7. **Investigación y planificación** — Diseño de arquitectura, evaluación de proveedores, research técnico
8. **Pruebas y validación** — Testing en sitio, verificación con gerentes, QA de módulos
9. **Presentaciones y documentación operativa** — Guías, manuales, dashboards ejecutivos
10. **Soporte y debugging** — Resolución de incidentes reportados por usuarios, diagnóstico de errores en producción

### Protocolo de registro:
- **Al finalizar CADA sesión de trabajo**, el agente DEBE verificar que la actividad ya tenga una fila correspondiente en la tabla de horas de `scripts/[mes]_full_data.json` y actualizar `lib/reports-data.ts` ejecutando `node scripts/export-reports-data-ts.js`.
- **Al hacer commit/push**, el agente DEBE escanear TODAS las conversaciones activas del mes para detectar actividades no registradas.
- **Cada fila** debe incluir: fecha, rango horario, horas, módulos involucrados (badges), y descripción bilingüe (ES/EN) detallada.
- **Las actividades que NO generan commits** (tech packs, correos, análisis) son IGUAL de importantes que el código y DEBEN tener su propia fila con horas asignadas.
- **El resumen de esfuerzo por módulo** en el dashboard debe reflejar TODAS las categorías de trabajo, incluyendo "Tech Packs, RFQ y Negociación con Proveedores" cuando aplique.

### Verificación cruzada:
Al actualizar los datos, el agente DEBE cruzar estas fuentes para detectar trabajo faltante:
- `git log` — Commits del mes
- Directorios de conversaciones (`~/.gemini/antigravity/brain/*/`) — Archivos generados, imágenes, spec sheets
- Transcripts de conversaciones — Solicitudes del usuario que resultaron en entregables

---

## ⏱️ REGLA OBLIGATORIA: Protocolo de Auto-Registro en Tiempo Real, Conciliación Multi-Chat y Fusión No Destructiva (Multi-Chat Forensic Reconciliation & Non-Destructive Merge Protocol)

**Queda estrictamente prohibido que cualquier sesión, bloque de desarrollo, auditoría, análisis o conversación termine sin registrar de inmediato las horas trabajadas en el módulo nativo TSX (`lib/reports-data.ts` / `/admin/reporte-actividades`) o que se sobreescriban/omitan sesiones concurrentes de otros chats.**

1. **Escaneo y Conciliación Multi-Chat Obligatoria (Multi-Chat Cross-Scan)**:
   - Dado que Carlos trabaja simultáneamente en múltiples conversaciones (ej. Ventas Toast, Radar de Precios, Descansos, MilesIQ, Cohesion, RONOS, etc.), el agente TIENE LA OBLIGACIÓN de escanear los directorios de transcripciones (`C:\Users\pedro\.gemini\antigravity\brain\*\.system_generated\logs\transcript.jsonl`) y el `git log` antes de actualizar la tabla de horas.
   - Debe cruzar 4 fuentes de verdad:
     a) `transcript.jsonl` de todos los chats activos del día (para capturar peticiones, análisis de CSVs, diseño de tech packs y correos).
     b) `git log` del día (para capturar todos los commits, archivos modificados y branches).
     c) Base de datos de Supabase (`schedules` table para los turnos reales de Carlos como General Manager en Lynwood #14, `user_id: 25`).
     d) Archivos de entregables generados fuera de git.

2. **Fusión Acumulativa No Destructiva (Non-Destructive Cumulative Merge)**:
   - **Regla Estricta**: NUNCA reemplazar la fila de un día asumiendo únicamente el trabajo de la conversación actual.
   - Si el día actual ya cuenta con registros o sesiones previas:
     * **Horarios (Time Slots)**: Se concatenan todas las sesiones separadas por ` & ` (ej. `6:09 AM - 8:30 AM & 11:30 AM - 1:45 PM & 4:30 PM - 5:30 PM & 7:15 PM - 9:30 PM`).
     * **Horas Totales**: Se suman aritméticamente las horas de cada bloque (`hours = sum(session_hours)`).
     * **Viñetas de Descripción**: Se anexan con `<br>• ` todas las actividades realizadas en el día sin sobreescribir ni resumir las sesiones anteriores.
     * **Badges Temáticos**: Se unen en un conjunto único sin duplicados (ej. `['Radar de Precios', 'Viele & Sons v3', 'Descansos IA', 'Cohesion']`).

3. **Inclusión Obligatoria de Actividades No-Code**:
   - Todo trabajo técnico u operativo (redacción de Tech Packs, análisis de datos en Excel/CSV, correos de licitación a proveedores, presentaciones ejecutivas y diseño de arquitectura) DEBE tener su fila con horas asignadas, incluso si no generó un commit directo en el repositorio.

4. **Actualización Directa al Módulo Nativo TSX (Cero PDFs / Cero HTMLs)**:
   - Tras registrar o actualizar el archivo de datos del mes (`scripts/[mes]_full_data.json`), el agente DEBE ejecutar automáticamente `node scripts/export-reports-data-ts.js` para propagar los cambios inmediatamente a `lib/reports-data.ts`, reflejándose en `/admin/reporte-actividades`. NO compilar ni generar PDFs ni archivos HTML.

5. **Cero Dependencia de Petición del Usuario**:
   - El usuario NO debe tener que recordar o pedir que se registren las horas. El agente lo ejecuta proactivamente en segundo plano en cada intervención.

---

## 🏗️ ARQUITECTURA DEL SISTEMA — Tacos El Gavilan (TEG)

### Inventario y Costos
- **La Bodega** es el almacén central de Tacos Gavilan. Compra al proveedor externo y revende a los restaurantes.
- Los items tienen `is_bodega`: `true` = WAREHOUSE (bodega), `false` = RESTAURANT
- QuickBooks sync usa `PurchaseCost` (costo real del proveedor) para todos los items
- Las recetas usan `inventory_items.purchase_unit_cost` dividido entre `quantity_per_unit` para obtener el costo por unidad
- Los ingredientes tienen `type`: `'food'`, `'raw'`, `'cooked'` (todos son food cost), `'cogs_dine_in'`, `'cogs_delivery'`, `'cogs_takeout'` (son packaging/supplies)

### Food Cost Pipeline
```
QuickBooks → sync-quickbooks (prices) → inventory_items
Toast API → pmix (product mix) → pmix_daily_cache
Recipes + PMIX + Prices → /api/inventory/food-cost → food_cost_daily_cache
Cron sync-food-cost → pre-calcula cache mensual
```

### Party Trays (Recetas Virtuales)
- Los Party Trays no tienen receta en DB — se generan dinámicamente en `/api/inventory/food-cost`
- Se parsean los modificadores del nombre (e.g., "30-40 People (Asada, Pollo, Maiz)")
- Tamaños: 15-20, 20-25, 25-30, 30-40 personas con cantidades escaladas
- Incluyen: carnes, aguas, arroz, frijol, salsas, tortillas, desechables

### Tiendas
- 15 sucursales activas
- Cada tienda tiene un UUID en `stores` table y un Toast External ID
- El día laboral empieza a las 6:00 AM y termina a las 5:59 AM del siguiente día
- El turno PM inicia a las 5:00 PM

### Preparador (Prep Line / Cooking Pace)
- El módulo proyecta **libras crudas** que el taquero debe poner en la parrilla por bloques de 30 minutos
- Solo se proyectan carnes de **PARRILLA** que requieren anticipación: `ASADA, PASTOR, POLLO, CABEZA, LENGUA`
- **Buche, Chorizo y Carnitas se cocinan AL MOMENTO** bajo demanda — NO necesitan proyección de pace
- CARNITAS se rastrea en el CRON para datos de bodega, pero se filtra del carousel de la tablet de parrilla
- El acelerador intraday compara ventas reales de hoy vs proyección histórica para ajustar el pace en tiempo real
- Los datos REAL (verde) vienen de `meat_consumption_history` y se refrescan cada 3 minutos
