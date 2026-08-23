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

### 📌 REGLA DE COMMIT Y PUSH: Sincronización Obligatoria de Documentación
Cada vez que se realice un commit a GitHub y se haga push, **el desarrollador/agente DEBE actualizar de manera obligatoria**:
1. El documento de seguimiento de tareas y actividades del mes correspondiente (`pendientes_julio.html` o similar), registrando el desglose de horas y descripción bilingüe de actividades.
2. El prompt y herramientas de chat de soporte del Asistente IA para reflejar los cambios realizados en el sistema.
### 📌 REGLA OBLIGATORIA: Nombre Oficial de la Marca
El nombre oficial de la empresa y marca es estrictamente **Tacos Gavilan** (NUNCA "Tacos El Gavilan"). Todos los correos electrónicos, comunicaciones corporativas, títulos, documentación, prompts de IA y respuestas deben usar exclusivamente **Tacos Gavilan**.

---



## 📅 PROTOCOLO DE SEGUIMIENTO Y REGISTRO DE TRABAJO MENSUAL
1. **Registro Continuo**: El agente debe mantener un registro continuo y detallado de todas las actividades diarias de desarrollo y mantenimiento, incluyendo:
   - Fecha.
   - Rango de horario local (bajo la regla de que el día laboral inicia a las 6:00 AM y termina a las 5:59 AM del siguiente día).
   - Horas totales estimadas.
   - Módulos involucrados.
   - Descripción clara y bilingüe (Español e Inglés) de los cambios.
2. **Simplificación Comercial**: Las descripciones diarias para directivos deben evitar jergas de programación excesivas (ej. no usar OAuth2, WebRTC, React Compiler) y en su lugar usar explicaciones funcionales operativas entendibles por personal no técnico.
3. **Reporte Consolidado**: Al cierre de cada mes (ej. Julio 2026), se debe unificar el informe diario y las actividades paralelas (pruebas locales, diagnóstico de base de datos e investigación) en una pestaña autoejecutable en `pendientes.html` y en un archivo markdown específico del mes.

---

## 📊 REGLA OBLIGATORIA: Registro Exhaustivo de TODAS las Actividades en el Reporte Mensual
**Ninguna actividad realizada en cualquier conversación puede quedar fuera del reporte mensual** (`pendientes_[mes].html`). El reporte es el documento oficial de horas trabajadas y DEBE reflejar el 100% del esfuerzo real invertido.

### Qué se DEBE registrar (sin excepción):
1. **Código y commits** — Desarrollo de módulos, bug fixes, features, refactors, migraciones SQL
2. **Tech Packs y fichas técnicas** — Documentos PDF de especificaciones para fabricantes o proveedores (uniformes, desechables, carnes, lácteos, etc.)
3. **RFQ y documentos de licitación** — Bidding volumes, solicitudes de cotización, portfolios de negociación
4. **Correos profesionales** — Redacción y envío de correos a proveedores, fabricantes, socios comerciales
5. **Análisis de datos** — Análisis de CSV, Excel, auditorías de inventario, análisis laboral, reportes financieros
6. **Generación de imágenes y assets** — Imágenes de productos, referencias para fabricantes, mockups de UI
7. **Investigación y planificación** — Diseño de arquitectura, evaluación de proveedores, research técnico
8. **Pruebas y validación** — Testing en sitio, verificación con gerentes, QA de módulos
9. **Presentaciones y documentación operativa** — Guías, manuales, presentaciones HTML para directivos
10. **Soporte y debugging** — Resolución de incidentes reportados por usuarios, diagnóstico de errores en producción

### Protocolo de registro:
- **Al finalizar CADA sesión de trabajo**, el agente DEBE verificar que la actividad ya tenga una fila correspondiente en la tabla de horas del reporte del mes vigente.
- **Al hacer commit/push**, el agente DEBE escanear TODAS las conversaciones activas del mes para detectar actividades no registradas.
- **Cada fila** debe incluir: fecha, rango horario, horas, módulos involucrados (badges), y descripción bilingüe (ES/EN) detallada.
- **Las actividades que NO generan commits** (tech packs, correos, análisis) son IGUAL de importantes que el código y DEBEN tener su propia fila con horas asignadas.
- **El resumen de esfuerzo por módulo** al final del reporte debe reflejar TODAS las categorías de trabajo, incluyendo "Tech Packs, RFQ y Negociación con Proveedores" cuando aplique.

### Verificación cruzada:
Al actualizar el reporte, el agente DEBE cruzar estas fuentes para detectar trabajo faltante:
- `git log` — Commits del mes
- Directorios de conversaciones (`~/.gemini/antigravity/brain/*/`) — PDFs, imágenes, spec sheets generados
- Transcripts de conversaciones — Solicitudes del usuario que resultaron en entregables
- Archivos del proyecto modificados fuera de git — Reportes HTML, documentos operativos

---

## ⏱️ REGLA OBLIGATORIA: Protocolo de Auto-Registro en Tiempo Real y Cero Horas Perdidas (Live Auto-Logging & Continuous Activity Sync)

**Queda estrictamente prohibido que cualquier sesión, bloque de desarrollo, auditoría, análisis o conversación termine sin registrar de inmediato las horas trabajadas en el reporte mensual (`pendientes_[mes].html`).**

1. **Auto-Registro Obligatorio en Cada Intervención**:
   - En **CADA conversación y al finalizar cada respuesta o tarea**, el agente TIENE LA OBLIGACIÓN de actualizar la fila del día correspondiente en `pendientes_[mes].html` (ej: `pendientes_agosto.html`) y el bloque del planificador Gantt visual.
   - Si el día actual ya cuenta con registros previos, el agente DEBE sumar las nuevas horas transcurridas y agregar las nuevas viñetas de descripción (ES/EN) y badges de módulos trabajados, sin sobreescribir ni borrar las sesiones previas del mismo día.
2. **Recompilación Automática de PDFs Ejecutivos**:
   - Tras actualizar el archivo HTML, el agente DEBE ejecutar automáticamente el script de compilación (Puppeteer) para regenerar de inmediato `c:\Users\pedro\Desktop\Reporte_[Mes]_[Año]_TEG.pdf` y `distribucion_jornada_carlos_velazquez_[mes]_[año].pdf`.
3. **Escaneo de Conversaciones Concurrentes (Multi-Chat Awareness)**:
   - Dado que Carlos trabaja simultáneamente en múltiples conversaciones (ej. Ventas, Descansos, MilesIQ, Uniformes, etc.), el agente DEBE escanear periódicamente los directorios de transcripciones (`C:\Users\pedro\.gemini\antigravity\brain\*\.system_generated\logs\transcript.jsonl`) para consolidar todas las sesiones paralelas del día en el informe único oficial.
4. **Cero Dependencia de Petición del Usuario**:
   - El usuario NO debe tener que recordar o pedir que se registren las horas. El agente lo ejecuta proactivamente en segundo plano en cada turno.

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
