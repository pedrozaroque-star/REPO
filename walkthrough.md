# Walkthrough: Auditoría Exhaustiva y Blindaje Integral del Módulo de Ventas y Submódulos

Se completó una auditoría forense **línea por línea** del Módulo de Ventas completo y de todos sus submódulos en **Tacos Gavilan**, resolviendo discrepancias contables, desajustes de zona horaria, álgebra de descuentos/reembolsos, brechas de autenticación, y cálculos matemáticos de costo laboral.

---

## 🛠️ Resumen de Cambios Realizados

### 1. Núcleo de Ventas y Conexión Toast POS (`lib/toast-api.ts`)
- **Reembolsos Cruzados (*Cross-Date Refunds*)**: Integración de `getCrossDateRefunds` usando `/orders/v2/payments?refundBusinessDate=YYYYMMDD` para deducir devoluciones de órdenes pagadas en fechas previas (ej. orden Party Tray en Bell), logrando paridad contable exacta al centavo con el reporte oficial de Toast.
- **Álgebra de Descuentos**: Se corrigió el cálculo de `discounts` para sumar exclusivamente descuentos comerciales (`d.amount`), evitando sumar montos de reembolsos que inflaban los descuentos.
- **Doble Escritura sin Throttle**: Eliminación de escrituras redundantes a Supabase en cada consulta de lectura.
- **Deriva Horaria UTC**: Generación determinista de fechas de negocio sin desfase por huso horario del servidor.

### 2. Dashboard de Ventas Principal (`app/ventas/page.tsx`)
- **Auto-Curación (*Auto-Heal*)**: Corrección del guardado en estado para preservar `rawRows` y evitar que la vista se bloquee o pierda la granularidad diaria/horaria tras verificar un día.
- **Redistribución Laboral Proporcional**: En filtros de Comida/Cena (`sortedStoreData`), el costo laboral se prorratea según la curva de horas correspondiente.
- **Exportación CSV Real**: Conexión del manejador `handleExportCSV` con formateo de moneda y nombres de sucursal.
- **Protección contra División por Cero**: Guardas robustas (`0/0 -> 0`) en ticket promedio, porcentaje de mano de obra y costo de comida en vistas móvil y escritorio.

### 3. Historial Anual de Ventas (`app/ventas/historial/page.tsx` & `app/api/ventas/yearly/route.ts`)
- **Aritmética Limpia de Fechas**: Fechas de mes generadas directamente como `YYYY-MM-01` a `YYYY-MM-DD` sin desfase de UTC.
- **Seguridad**: Uso de `getSupabaseAdminClient()` y autorización ampliada para roles `admin`, `supervisor`, y `manager`.
- **Comparativa Año vs Año (YoY) Sin Sesgo**: Inclusión simétrica de tiendas nuevas (`isNew`) y cerradas (`isClosed`) en el análisis global para no distorsionar el porcentaje de crecimiento corporativo.
- **Exportación CSV**: Botón funcional para descargar la matriz anual completa y totales globales.
- **Internacionalización Completa**: Integración bilingüe con `useLanguage()` y `t('sales.history_page.*')`.

### 4. Reportes Operativos, Labor Log y Tab Mensual (`app/ventas/reportes/page.tsx`, `weekly-ops`, `autofill`)
- **Labor % Ponderado**: Reemplazo del promedio simple en el resumen semanal por el costo laboral ponderado real:
  $$\text{Labor \%} = \frac{\text{Costo Laboral Total}}{\text{Ventas Netas Totales}} \times 100$$
- **Ticket Promedio Semanal**: Corrección para no sumar los promedios diarios, calculando la media real entre días activos.
- **Ventanas de Turno AM/PM**:
  - Turno AM (Apertura): `06:00:00` a `17:00:00` (horas 6..16).
  - Turno PM (Cierre): `17:00:00` a `06:00:00` del día siguiente (horas 17..23 y 0..5).
- **Formatos Negativos Estándar**: Visualización limpia de variaciones negativas (`-$500.00` en lugar de `"$-500.00"`).
- **Estilos `@media print`**: Clases `no-print` en botones y controles para exportación/impresión limpia a PDF.
- **Autenticación en Autofill y Weekly Ops**: Blindaje con `verifyAuthToken` y actualización de salario mínimo a $20.00/hr (AB 1228).
- **Carga de Empleados Completa**: Consulta unificada en `toast_employees` tanto por `employee_id` (turnos) como por `employee_toast_guid` (ponches).

### 5. Componentes UI (`components/sales/*`)
- `SalesCharts.tsx`, `SalesSummary.tsx`, `TopProductsList.tsx`, `SalesMixChart.tsx`, `DateRangeFilter.tsx`:
  - 100% bilingüe con `useLanguage()` y diccionarios `es`/`en`.
  - Soporte para preset de Trimestre (*Quarter*) respetando la regla de las 6:00 AM.

---

## 🧪 Verificación y Pruebas Realizadas

### 1. Chequeo de Compilación TypeScript
```bash
npx tsc --noEmit
# Resultado: EXIT CODE 0 (Cero errores de compilación)
```

### 2. Suites de Simulación Automatizada
- **Suite Principal (`scripts/test-sales-module-verification.ts`)**:
  - Test 1: Álgebra de Descuentos y Ventas Netas -> **PASS**
  - Test 2: Frontera de Turno 6:00 AM y Timezone -> **PASS**
  - Test 3: Curvas de Labor Horario Prorrateado -> **PASS**
  - Test 4: Resiliencia a División por Cero y Nulos -> **PASS**

- **Suite de Submódulos (`scripts/test-sales-submodules-verification.ts`)**:
  - Test 1: Aritmética de 12 Meses sin Desfase UTC (12/12 meses) -> **PASS**
  - Test 2: Integridad de Comparativa YoY (Tiendas Nuevas y Cerradas) -> **PASS**
  - Test 3: Asignación de Turnos AM ($4,350) vs PM ($5,150) -> **PASS**
  - Test 4: Labor % Ponderado Real (19.75%) y Ticket Promedio ($20.00) -> **PASS**
  - Test 5: Formateo de Moneda Negativa (`-$500.25`) -> **PASS**
  - **Total de Aserciones: 39 Aprobadas / 0 Fallidas**.
