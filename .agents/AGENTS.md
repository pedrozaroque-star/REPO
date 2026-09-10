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

### 📌 REGLA ESTRICTA DE COMMITS: Solo por Solicitud Explícita del Usuario
- **PROHIBICIÓN DE AUTO-COMMITS**: Queda **TERMINANTEMENTE PROHIBIDO** que cualquier agente o subagente ejecute `git commit` o `git push` de forma automática o por iniciativa propia.
- **SOLO BAJO INSTRUCCIÓN DIRECTA**: El agente **ÚNICAMENTE** debe hacer commit y push cuando Carlos (el usuario) lo solicite o autorice expresamente en la conversación (ej. *"commit"*, *"haz commit"*, *"sube esto"*).
- Al finalizar un desarrollo, corrección o análisis, el agente debe reportar el resultado, validar que TypeScript no tenga errores (`npx tsc --noEmit`) y **esperar la indicación del usuario**.
- **Cuando el usuario ordene el commit**:
  1. Correr `npx tsc --noEmit` para garantizar cero errores antes de hacer el commit.
  2. Si se agregaron/modificaron features o endpoints, actualizar el prompt y herramientas del Asistente IA (`app/api/support-chat/route.ts` y `lib/chat-tools.ts`).
  3. **PROHIBIDO**: En chats de desarrollo, NO tocar reportes ni horas (`scripts/*_full_data.json` o `lib/reports-data.ts`). Dicha labor está estrictamente asignada al Chat de Pendientes.

### 📌 REGLA OBLIGATORIA: Nombre Oficial de la Marca
El nombre oficial de la empresa y marca es estrictamente **Tacos Gavilan** (NUNCA "Tacos El Gavilan"). Todos los correos electrónicos, comunicaciones corporativas, títulos, documentación, prompts de IA y respuestas deben usar exclusivamente **Tacos Gavilan**.

---

## 🛑 REGLA OBLIGATORIA: AISLAMIENTO EXCLUSIVO DE REPORTES Y HORAS AL CHAT DE PENDIENTES
> [!CAUTION]
> **PROHIBICIÓN ESTRICTA PARA CHATS DE DESARROLLO / OTRAS CONVERSACIONES:**
> Queda **TERMINANTEMENTE PROHIBIDO** que cualquier conversación, subagente o chat enfocado en tareas de desarrollo específicas (ej. Viele & Sons, RONOS, Radar de Precios, Descansos, Toast, Inventario, Contabilidad, etc.) realice actualizaciones de horas o reportes.
> 
> En dichos chats de desarrollo está **ESTRICTAMENTE PROHIBIDO**:
> 1. Modificar, editar o crear `scripts/*_full_data.json` (ej. `scripts/september_full_data.json`).
> 2. Modificar o editar `lib/reports-data.ts`.
> 3. Ejecutar scripts de reportes como `node scripts/export-reports-data-ts.js`.
> 4. Generar archivos HTML (`pendientes_*.html`) o compilar PDFs de horas.
> 5. Escanear transcripciones de otros chats para conciliar horas.
> 
> **Motivo**: Carlos trabaja en múltiples tareas simultáneas y el auto-registro en cada chat consume tiempo innecesario y ralentiza el flujo de trabajo. En los chats de desarrollo, el agente DEBE concentrarse al 100% en la funcionalidad técnica solicitada y terminarla sin tocar los módulos de reportes.

---

## 📊 REGLA OBLIGATORIA: Gestión Centralizada de Horas (EXCLUSIVA del Chat de Pendientes)
**La actualización, conciliación y registro de horas y actividades mensuales se ejecuta ÚNICA Y EXCLUSIVAMENTE en el Chat Dedicado de Pendientes y Reportes** (`Conversation ID: 72f704bf-fc24-425d-8dbd-e2a211289a28` o conversación oficial de control de pendientes):

1. **Fuente Oficial Única**:
   - El módulo nativo TSX (`app/admin/reporte-actividades/page.tsx` y `lib/reports-data.ts`) es la fuente oficial ejecutiva de horas trabajadas y actividades.
   - Queda estrictamente prohibido generar archivos HTML (`pendientes_*.html`) o compilar PDFs (`Reporte_*.pdf`). Todo se gestiona en el componente nativo TSX.

2. **Protocolo de Conciliación Centralizada (Solo en el Chat de Pendientes)**:
   - Cuando el usuario solicite en el Chat de Pendientes actualizar reportes u horas, el agente de este chat es el ÚNICO autorizado para realizar el escaneo multi-chat cruzando:
     a) Transcripciones de todos los chats activos (`C:\Users\pedro\.gemini\antigravity\brain\*\.system_generated\logs\transcript.jsonl`) para capturar solicitudes, análisis, tech packs y correos.
     b) `git log` del mes/día para detectar commits de todos los branches y conversaciones.
     c) Base de datos de Supabase (`schedules` table para los turnos de Carlos como General Manager en Lynwood #14, `user_id: 25`).
     d) Archivos de entregables generados fuera de git (Tech Packs, RFQs, correos, análisis de datos).

3. **Fusión Acumulativa No Destructiva (Non-Destructive Cumulative Merge)**:
   - Al actualizar en el Chat de Pendientes, NUNCA sobreescribir sesiones existentes del mismo día:
     * **Horarios (Time Slots)**: Se concatenan todas las sesiones separadas por ` & ` (ej. `6:09 AM - 8:30 AM & 11:30 AM - 1:45 PM & 4:30 PM - 5:30 PM & 7:15 PM - 9:30 PM`).
     * **Horas Totales**: Se suman aritméticamente las horas de cada bloque (`hours = sum(session_hours)`).
     * **Viñetas de Descripción**: Se anexan con `<br>• ` todas las actividades sin perder registros anteriores.
     * **Badges**: Se unen sin duplicados.

4. **Propagación a Producción**:
   - Tras actualizar `scripts/[mes]_full_data.json`, el agente del Chat de Pendientes ejecuta `node scripts/export-reports-data-ts.js` para compilar `lib/reports-data.ts`, verifica TypeScript (`npx tsc --noEmit`) y realiza commit/push cuando sea solicitado por el usuario.

5. **Versionado Automático SemVer y Registro en Changelog (`lib/version.ts`)**:
   - En cada ciclo de consolidación de actividades o previo a cada commit/push autorizado por el usuario, el agente del Chat de Pendientes TIENE LA OBLIGACIÓN AUTOMÁTICA de:
     * Auditar los commits y desarrollos completados desde el último hito.
     * Incrementar la versión SemVer en `lib/version.ts` (`v[MAJOR].[MINOR].[PATCH]`) según la magnitud del cambio:
       - **MINOR** (`v2.X.0`): Nuevos módulos funcionales completos (ej. Viele & Sons, Salud del Sistema).
       - **PATCH** (`v2.X.X`): Mejoras, puentes, calibraciones y correcciones operativas.
     * Agregar el nuevo bloque estructurado en `VERSION_HISTORY` con títulos y viñetas descriptivas en español e inglés.
     * Sincronizar la versión en el prompt del Asistente IA (`app/api/support-chat/route.ts`).
   - Esto garantiza que el número de versión y el modal visual de Changelog se mantengan permanentemente actualizados en tiempo real sin requerir recordatorios del usuario.

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
