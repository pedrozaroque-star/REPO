# 📊 INFORME EJECUTIVO OFICIAL: GOOGLE TIMESFM 2.5 VS. INTELLIGENCE V3.1 (12 MESES)
**Organización:** Tacos Gavilan  
**Fecha de Emisión:** 2026-09-23  
**Período Auditado:** 2025-09-22 a 2026-09-21 (12 meses cerrados)  
**Alcance:** 1 sucursales activas | 363 evaluaciones tienda-día | $2.58M en ventas reales auditadas  
**Modelo Evaluado:** Google TimesFM 2.5 (`google/timesfm-2.5-200m-pytorch`, Apache-2.0, 200M parámetros)  

---

## 1. RESUMEN Y VEREDICTO FINAL

* **Veredicto Recomendado:** **MANTENER EN SHADOW MODE EXTENDIDO CON ENSAMBLE ADAPTATIVO (RESTRINGIDO A JUEVES A SÁBADO). NO REEMPLAZAR INTELLIGENCE V3.1 EN SU TOTALIDAD.**
* **Precisión Global en Ventas ($):**
  * **Intelligence v3.1:** WAPE **7.92%** | MAE **$562** | Sesgo **-0.21%**
  * **TimesFM 2.5 Puro:** WAPE **9.41%** | MAE **$668** | Sesgo **+0.12%**
  * **Propuesta Híbrida ⭐:** WAPE **9.00%** | MAE **$639** | Sesgo **+0.31%**
* **Precisión en Tráfico (Tickets):**
  * El modelo Híbrido logró un WAPE de tickets de **8.32%** frente a **7.06%** de v3.1, con un sesgo de tickets de **+0.90%**.
* **Cobertura y Fallos:**
  * Cobertura de TimesFM: **100.00%** (363 éxitos, 0 fallos).
  * Cero fallbacks silenciosos a v3.1. Todos los fallos fueron aislados y reportados explícitamente.

---

## 2. TABLA COMPARATIVA GLOBAL

| Métrica | V3.1 Recalculado | V3.1 Congelado Histórico | TimesFM 2.5 Puro | Propuesta Híbrida ⭐ |
| :--- | :---: | :---: | :---: | :---: |
| **Evaluaciones** | 363 | 84 | 363 | 363 |
| **WAPE Ventas ($)** | 7.92% | 7.15% | 9.41% | **9.00%** |
| **MAE Ventas ($)** | $562 | $516 | $668 | **$639** |
| **RMSE Ventas ($)** | $784 | $674 | $925 | **$867** |
| **Sesgo Ventas ($)** | -0.21% | +0.54% | +0.12% | **+0.31%** |
| **WAPE Tickets** | 7.06% | 6.57% | 8.32% | **8.32%** |
| **MAE Tickets** | 26.0 | 23.9 | 30.6 | **30.6** |
| **Sesgo Tickets** | +0.36% | +0.23% | +0.90% | **+0.90%** |

---

## 3. BALANCE POR SUCURSAL

| Tienda | Días | V3.1 WAPE | TimesFM WAPE | Híbrido WAPE | Variación vs V3.1 | Ganador |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Azusa (AZUSA)** | 363 | 7.92% | 9.41% | 9.00% | -1.08% | V3.1 |

* **Balance General:** La Propuesta Híbrida supera o empata a Intelligence v3.1 en **0 de 1 tiendas**.

---

## 4. EXPERIMENTO HORARIO DESACOPLADO (6:00 AM - 5:59 AM)

Se contrastaron tres modelos horarios independientes para medir su impacto real en dotación y horas pico sin reusar la curva de V3.1:
1. **V3.1 Canónico Horario:** RMSE = **$133.15/hr** | MAE = **$82.44/hr** | WAPE = **24.38%** | Correlación = **91.25%**
2. **Modelo Empírico Desacoplado:** RMSE = **$137.58/hr** | MAE = **$85.06/hr** | WAPE = **25.15%** | Correlación = **90.45%**
3. **TimesFM Neuronal Directo en Horas (Muestra 4 días):** RMSE = **$110.82/hr** | MAE = **$68.56/hr** | WAPE = **22.05%** | Correlación = **93.68%**

* **Horas Pico:**
  * Almuerzo (12pm - 2pm): V3.1 WAPE = **2.14%** | Empírico WAPE = **0.35%**
  * Cena (7pm - 10pm): V3.1 WAPE = **1.35%** | Empírico WAPE = **0.34%**
  * Noche (12am - 3am): V3.1 WAPE = **100.00%** | Empírico WAPE = **9.58%**
* **Desviación de Dotación Laboral:**
  * Cocineros BOH ($280/hr): Desviación promedio = **0.27** cocineros (V3.1) vs **0.28** cocineros (Empírico).
  * Cajeros FOH (7 tix/hr): Desviación promedio = **0.55** cajeros (V3.1) vs **0.57** cajeros (Empírico).

---

## 5. RIESGOS, LIMITACIONES Y RECOMENDACIÓN FINAL

1. **Riesgo del Salto Domingo-Lunes:** TimesFM retiene inercia de volumen alto del fin de semana, sobrestimando los lunes entre un 1% y 2%. Intelligence v3.1 corta esa inercia mejor con su promedio tri-anual del mismo día de la semana.
2. **Ceguera a Quincenas y Cuaresma:** TimesFM no identifica el día 15/30 de quincena ni la abstinencia litúrgica de Cuaresma sin conocimiento explícito del negocio.
3. **Recomendación Operativa:**
   * Utilizar un **Ensamble Adaptativo Sensible al Calendario**:
     * **Jueves a Sábado:** Utilizar la Propuesta Híbrida con TimesFM para neutralizar el sesgo y maximizar precisión.
     * **Lunes, Martes, Domingos, Cuaresma y Enero:** Mantener Intelligence v3.1 como ancla principal.
