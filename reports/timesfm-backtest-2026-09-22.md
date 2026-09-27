# 📊 INFORME EJECUTIVO FASE 2: GOOGLE TIMESFM 2.5 VS. INTELLIGENCE V3.1
**Organización:** Tacos Gavilan  
**Fecha de Emisión:** 2026-09-22  
**Período Auditado:** 2025-09-21 a 2026-09-20 (12 meses)  
**Alcance:** 1 sucursales activas | 363 evaluaciones tienda-día | $4.40M en ventas reales auditadas  
**Modelo Evaluado:** Google TimesFM 2.5 (`google/timesfm-2.5-200m-pytorch`, Apache-2.0, 200M parámetros)  

---

## 1. RESUMEN Y VEREDICTO FINAL

* **Veredicto Recomendado:** **MANTENER EN SHADOW MODE EXTENDIDO CON ENSAMBLE ADAPTATIVO (RESTRINGIDO A MIÉRCOLES-DOMINGO). NO REEMPLAZAR INTELLIGENCE V3.1 EN SU TOTALIDAD.**
* **Precisión Global en Ventas ($):**
  * **Intelligence v3.1:** WAPE **6.97%** | MAE **$845** | Sesgo **-0.78%**
  * **TimesFM 2.5 Puro:** WAPE **8.52%** | MAE **$1033** | Sesgo **-0.21%**
  * **Propuesta Híbrida ⭐:** WAPE **7.99%** | MAE **$968** | Sesgo **-0.40%**
* **Precisión en Tráfico (Tickets):**
  * El modelo Híbrido logró un WAPE de tickets de **7.34%** frente a **6.15%** de v3.1, con un sesgo de tickets de **+0.12%**.
* **Cobertura y Fallos:**
  * Cobertura de TimesFM: **100.00%** (363 éxitos, 0 fallos).
  * Cero fallbacks silenciosos a v3.1. Todos los fallos fueron aislados y reportados explícitamente.

---

## 2. TABLA COMPARATIVA GLOBAL

| Métrica | V3.1 Recalculado | V3.1 Congelado Histórico | TimesFM 2.5 Puro | Propuesta Híbrida ⭐ |
| :--- | :---: | :---: | :---: | :---: |
| **Evaluaciones** | 363 | 82 | 363 | 363 |
| **WAPE Ventas ($)** | 6.97% | 6.00% | 8.52% | **7.99%** |
| **MAE Ventas ($)** | $845 | $759 | $1033 | **$968** |
| **RMSE Ventas ($)** | $1217 | $1066 | $1510 | **$1432** |
| **Sesgo Ventas ($)** | -0.78% | -3.22% | -0.21% | **-0.40%** |
| **WAPE Tickets** | 6.15% | 5.28% | 7.34% | **7.34%** |
| **MAE Tickets** | 38.9 | 33.7 | 46.4 | **46.4** |
| **Sesgo Tickets** | -0.18% | -3.04% | +0.11% | **+0.12%** |

---

## 3. BALANCE POR SUCURSAL

| Tienda | Días | V3.1 WAPE | TimesFM WAPE | Híbrido WAPE | Variación vs V3.1 | Ganador |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Downey (DOWNEY)** | 363 | 6.97% | 8.52% | 7.99% | -1.02% | V3.1 |

* **Balance General:** La Propuesta Híbrida supera o empata a Intelligence v3.1 en **0 de 1 tiendas**.

---

## 4. EXPERIMENTO HORARIO DESACOPLADO (6:00 AM - 5:59 AM)

Se contrastaron tres modelos horarios independientes para medir su impacto real en dotación y horas pico sin reusar la curva de V3.1:
1. **V3.1 Canónico Horario:** RMSE = **$201.48/hr** | MAE = **$145.79/hr** | WAPE = **19.81%** | Correlación = **82.87%**
2. **Modelo Empírico Desacoplado:** RMSE = **$216.56/hr** | MAE = **$157.73/hr** | WAPE = **21.43%** | Correlación = **80.49%**
3. **TimesFM Neuronal Directo en Horas (Muestra 4 días):** RMSE = **$237.15/hr** | MAE = **$167.01/hr** | WAPE = **25.98%** | Correlación = **89.15%**

* **Horas Pico:**
  * Almuerzo (12pm - 2pm): V3.1 WAPE = **0.30%** | Empírico WAPE = **0.06%**
  * Cena (7pm - 10pm): V3.1 WAPE = **1.20%** | Empírico WAPE = **0.26%**
  * Noche (12am - 3am): V3.1 WAPE = **4.44%** | Empírico WAPE = **3.46%**
* **Desviación de Dotación Laboral:**
  * Cocineros BOH ($280/hr): Desviación promedio = **0.51** cocineros (V3.1) vs **0.56** cocineros (Empírico).
  * Cajeros FOH (7 tix/hr): Desviación promedio = **0.90** cajeros (V3.1) vs **1.04** cajeros (Empírico).

---

## 5. RIESGOS, LIMITACIONES Y PRÓXIMOS PASOS

1. **Riesgo del Salto Domingo-Lunes:** TimesFM retiene inercia de volumen alto del fin de semana, sobrestimando los lunes entre un 1% y 2%. Intelligence v3.1 corta esa inercia mejor con su promedio tri-anual del mismo día de la semana.
2. **Ceguera a Quincenas:** TimesFM no identifica el día 15 ni el día 30/31 como días de nómina a menos que reciba covariables exógenas de calendario.
3. **Recomendación Operativa:**
   * Utilizar un **Ensamble Adaptativo**:
     * **Miércoles a Domingo:** Utilizar la Propuesta Híbrida con TimesFM.
     * **Lunes, Martes y Quincenas:** Mantener Intelligence v3.1 como ancla principal.
