# 📊 INFORME EJECUTIVO OFICIAL: GOOGLE TIMESFM 2.5 VS. INTELLIGENCE V3.1 (12 MESES)
**Organización:** Tacos Gavilan  
**Fecha de Emisión:** 2026-09-22  
**Período Auditado:** 2025-09-22 a 2026-09-21 (12 meses cerrados)  
**Alcance:** 15 sucursales activas | 5420 evaluaciones tienda-día | $69.93M en ventas reales auditadas  
**Modelo Evaluado:** Google TimesFM 2.5 (`google/timesfm-2.5-200m-pytorch`, Apache-2.0, 200M parámetros)  

---

## 1. RESUMEN Y VEREDICTO FINAL

* **Veredicto Recomendado:** **MANTENER EN SHADOW MODE EXTENDIDO CON ENSAMBLE ADAPTATIVO (RESTRINGIDO A JUEVES A SÁBADO). NO REEMPLAZAR INTELLIGENCE V3.1 EN SU TOTALIDAD.**
* **Precisión Global en Ventas ($):**
  * **Intelligence v3.1:** WAPE **6.99%** | MAE **$902** | Sesgo **-0.75%**
  * **TimesFM 2.5 Puro:** WAPE **8.15%** | MAE **$1052** | Sesgo **-0.34%**
  * **Propuesta Híbrida ⭐:** WAPE **7.91%** | MAE **$1021** | Sesgo **-0.33%**
* **Precisión en Tráfico (Tickets):**
  * El modelo Híbrido logró un WAPE de tickets de **6.90%** frente a **5.83%** de v3.1, con un sesgo de tickets de **+0.12%**.
* **Cobertura y Fallos:**
  * Cobertura de TimesFM: **100.00%** (5420 éxitos, 0 fallos).
  * Cero fallbacks silenciosos a v3.1. Todos los fallos fueron aislados y reportados explícitamente.

---

## 2. TABLA COMPARATIVA GLOBAL

| Métrica | V3.1 Recalculado | V3.1 Congelado Histórico | TimesFM 2.5 Puro | Propuesta Híbrida ⭐ |
| :--- | :---: | :---: | :---: | :---: |
| **Evaluaciones** | 5420 | 1253 | 5420 | 5420 |
| **WAPE Ventas ($)** | 6.99% | 6.65% | 8.15% | **7.91%** |
| **MAE Ventas ($)** | $902 | $898 | $1052 | **$1021** |
| **RMSE Ventas ($)** | $1333 | $1208 | $1556 | **$1504** |
| **Sesgo Ventas ($)** | -0.75% | -2.99% | -0.34% | **-0.33%** |
| **WAPE Tickets** | 5.83% | 6.00% | 6.89% | **6.90%** |
| **MAE Tickets** | 39.2 | 41.1 | 46.3 | **46.3** |
| **Sesgo Tickets** | -0.28% | -3.14% | +0.12% | **+0.12%** |

---

## 3. BALANCE POR SUCURSAL

| Tienda | Días | V3.1 WAPE | TimesFM WAPE | Híbrido WAPE | Variación vs V3.1 | Ganador |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Azusa (AZUSA)** | 363 | 7.92% | 9.41% | 9.00% | -1.08% | V3.1 |
| **Bell (BELL)** | 363 | 8.40% | 9.69% | 9.55% | -1.15% | V3.1 |
| **Downey (DOWNEY)** | 363 | 6.96% | 8.52% | 7.98% | -1.02% | V3.1 |
| **Hollywood (HOLLYWOOD)** | 338 | 6.48% | 7.48% | 7.28% | -0.80% | V3.1 |
| **Huntington Park (HPARK)** | 363 | 7.34% | 8.42% | 8.37% | -1.03% | V3.1 |
| **LA Broadway (LABROADWY)** | 363 | 6.38% | 7.82% | 7.51% | -1.13% | V3.1 |
| **LA Central (LACENTRAL)** | 363 | 5.89% | 6.65% | 6.39% | -0.50% | V3.1 |
| **La Puente (LAPUENTE)** | 363 | 7.26% | 8.32% | 8.13% | -0.87% | V3.1 |
| **Lynwood (LYNWOOD)** | 363 | 7.09% | 7.87% | 7.83% | -0.75% | V3.1 |
| **Norwalk (NORWALK)** | 363 | 7.20% | 8.49% | 8.31% | -1.11% | V3.1 |
| **Rialto (RIALTO)** | 363 | 7.07% | 8.67% | 8.43% | -1.36% | V3.1 |
| **Santa Ana (SANTAANA)** | 363 | 7.50% | 8.89% | 8.70% | -1.20% | V3.1 |
| **Slauson (SLAUSON)** | 363 | 7.28% | 8.27% | 8.02% | -0.74% | V3.1 |
| **South Gate (SOUTHGATE)** | 363 | 7.31% | 8.06% | 7.94% | -0.63% | V3.1 |
| **West Covina (WCOVINA)** | 363 | 6.93% | 8.31% | 7.78% | -0.85% | V3.1 |

* **Balance General:** La Propuesta Híbrida supera o empata a Intelligence v3.1 en **0 de 15 tiendas**.

---

## 4. EXPERIMENTO HORARIO DESACOPLADO (6:00 AM - 5:59 AM)

Se contrastaron tres modelos horarios independientes para medir su impacto real en dotación y horas pico sin reusar la curva de V3.1:
1. **V3.1 Canónico Horario:** RMSE = **$184.66/hr** | MAE = **$115.79/hr** | WAPE = **18.90%** | Correlación = **92.86%**
2. **Modelo Empírico Desacoplado:** RMSE = **$193.41/hr** | MAE = **$123.05/hr** | WAPE = **20.09%** | Correlación = **91.70%**
3. **TimesFM Neuronal Directo en Horas (Muestra 60 días):** RMSE = **$186.02/hr** | MAE = **$123.79/hr** | WAPE = **22.64%** | Correlación = **94.17%**

* **Horas Pico:**
  * Almuerzo (12pm - 2pm): V3.1 WAPE = **0.78%** | Empírico WAPE = **0.05%**
  * Cena (7pm - 10pm): V3.1 WAPE = **0.92%** | Empírico WAPE = **0.52%**
  * Noche (12am - 3am): V3.1 WAPE = **2.75%** | Empírico WAPE = **1.63%**
* **Desviación de Dotación Laboral:**
  * Cocineros BOH ($280/hr): Desviación promedio = **0.41** cocineros (V3.1) vs **0.43** cocineros (Empírico).
  * Cajeros FOH (7 tix/hr): Desviación promedio = **0.77** cajeros (V3.1) vs **0.82** cajeros (Empírico).

---

## 5. RIESGOS, LIMITACIONES Y RECOMENDACIÓN FINAL

1. **Riesgo del Salto Domingo-Lunes:** TimesFM retiene inercia de volumen alto del fin de semana, sobrestimando los lunes entre un 1% y 2%. Intelligence v3.1 corta esa inercia mejor con su promedio tri-anual del mismo día de la semana.
2. **Ceguera a Quincenas y Cuaresma:** TimesFM no identifica el día 15/30 de quincena ni la abstinencia litúrgica de Cuaresma sin conocimiento explícito del negocio.
3. **Recomendación Operativa:**
   * Utilizar un **Ensamble Adaptativo Sensible al Calendario**:
     * **Jueves a Sábado:** Utilizar la Propuesta Híbrida con TimesFM para neutralizar el sesgo y maximizar precisión.
     * **Lunes, Martes, Domingos, Cuaresma y Enero:** Mantener Intelligence v3.1 como ancla principal.
