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

## 🤖 REGLA OBLIGATORIA: Sincronización de Conocimiento del Asistente (TEG Assistant Sync)
Cada vez que se cree, modifique, elimine o actualice una característica, lógica de negocio, endpoint de API, o tabla de base de datos en el sistema, **el desarrollador/agente DEBE de inmediato actualizar el prompt del asistente** en `app/api/support-chat/route.ts` y sus herramientas de chat en `lib/chat-tools.ts`. Esto garantiza que el TEG Assistant AI aprenda de cada actualización del sistema y mantenga un dominio preciso del 100% del ecosistema en tiempo real.

### 📌 REGLA DE COMMIT Y PUSH: Sincronización Obligatoria de Documentación
Cada vez que se realice un commit a GitHub y se haga push, **el desarrollador/agente DEBE actualizar de manera obligatoria**:
1. El documento de seguimiento de tareas y actividades del mes correspondiente (`pendientes_julio.html` o similar), registrando el desglose de horas y descripción bilingüe de actividades.
2. El prompt y herramientas de chat de soporte del Asistente IA para reflejar los cambios realizados en el sistema.
### 📌 REGLA OBLIGATORIA: Nombre Oficial de la Marca
El nombre oficial de la empresa y marca es estrictamente **Tacos Gavilan** (NUNCA "Tacos El Gavilan"). Todos los correos electrónicos, comunicaciones corporativas, títulos, documentación, prompts de IA y respuestas deben usar exclusivamente **Tacos Gavilan**.

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
