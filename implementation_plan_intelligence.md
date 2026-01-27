# Plan de Implementación: Inteligencia Operativa y Móvil

Este documento define la estrategia para capitalizar la base de datos histórica validada (2025) y transformarla en herramientas de decisión operativa en tiempo real.

## Fase 1: Motor de Inteligencia (Labor Standards)
**Objetivo:** Establecer una línea base de eficiencia por tienda basada en datos reales históricos.

### 1.1 Análisis de Datos Históricos (Minería)
Crear scripts de análisis (`scripts/mining/analyze-standards.ts`) que respondan:
- **Eficiencia Base (SPLH):** ¿Cuál fue el promedio de 2025?
- **Validación Actual (2026):** ¿Se mantiene ese promedio en lo que va de Enero 2026 o ha cambiado? (Ajuste por inflación/precios nuevos).
- **Sensibilidad de Volumen:** ¿Cómo cambia la eficiencia los viernes vs. los lunes?
- **Grado de Labor Fijo:** Determinar cuántas horas se usan "solo para abrir la puerta".

### 1.2 Tabla de Objetivos (`store_targets`)
Crear una estructura en Supabase para almacenar las metas calculadas:
- `target_splh` (Meta combinada 2025 histórico + ajustada por realidad 2026)
- `min_staffing` (Personal mínimo)
- `growth_target` (Crecimiento real observado en 2026 vs 2025)

---

## Fase 2: Smart Scheduling (Planificador Inteligente)
**Objetivo:** Reducir el tiempo de creación de horarios y optimizar el costo laboral.

### 2.1 Proyección de Ventas (Forecast)
Implementar algoritmo de predicción híbrido:
- **Base:** Mismo día del año anterior (2025).
- **Realidad Actual:** Tendencia de las últimas 6 semanas de 2026 (Trend Factor).
- **Fórmula:** `Venta2025 * (Venta2026_Reciente / Venta2025_Reciente)`
- **Eventos:** Ajuste manual por feriados o eventos locales.

### 2.2 Generador de Guías de Personal
- Integrar la proyección de ventas en el Planificador.
- Mostrar una "Curva de Personal Ideal" sobre el calendario.
- **Alerta de Sobrecosto:** Si el gerente programa más horas de las recomendadas por la eficiencia meta, el widget de presupuesto se pondrá rojo con el mensaje: *"Sobrepresupuesto: -$450"*.

---

## Fase 3: Dashboard Operativo Móvil (Mobile Ops)
**Objetivo:** Entregar control en tiempo real a los gerentes de distrito y tienda.

### 3.1 UX/UI Mobile First (`/ops/live`)
Diseñar una interfaz ultra-ligera optimizada para vertical:
- **Header:** Tienda + Hora Actual.
- **Semáforo Financiero:** 
  - 🟢 Labor < 22%
  - 🟡 Labor 22-25%
  - 🔴 Labor > 25%
- **Acciones Rápidas:** Botón "Llamar Tienda", Botón "Ver Detalle".

### 3.2 Notificaciones Inteligentes (Proactivas)
- Configurar Cron Jobs cada 30 min (9am - 9pm).
- Si `ActualLabor > TargetLabor + 3%`, enviar alerta (Email/SMS/Push).

---

## Próximos Pasos Inmediatos
1. Ejecutar análisis de SPLH 2025 para tener la "Tabla de la Verdad" de eficiencia.
2. Definir wireframe de la vista móvil.
