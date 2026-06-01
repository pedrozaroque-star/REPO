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
