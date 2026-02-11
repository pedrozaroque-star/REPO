# Informe de Arquitectura: The Intelligence v4.0 - Generador de Estructura Laboral

**Para**: Dirección General / Propietario  
**De**: Departamento de Tecnología y Analítica  
**Asunto**: Anatomía Profunda del Motor "Intelligence Hybrid" (Auto-Schedule)

---

## 1. Visión General: El Paradigma "Open Shift"

A diferencia de los sistemas tradicionales que intentan asignar nombres a turnos fijos, **Intelligence v4.0** adopta un enfoque moderno de **"Estructura de Demanda"**.

El sistema no dice *"Juan trabaja el lunes"*.
El sistema dice: *"El lunes necesitamos 3 Cocineros a las 11:00 AM y 2 Cajeros a las 5:00 PM para cubrir la venta proyectada con el mínimo desperdicio"*.

Esta estructura de turnos perfectos ("Open Shifts") es lo que se publica, permitiendo luego una gestión flexible (Self-Schedule o Asignación Gerencial).

---

## 2. El Núcleo del Algoritmo: Lógica Híbrida (Smart-Hybrid)

El motor utiliza un enfoque único que combina la seguridad de una plantilla fija con la eficiencia de la demanda variable.

### Fase 1: Ingesta de Datos y Configuración
El sistema inicia leyendo la realidad operativa de cada tienda:
*   **Staffing Baseline:** La plantilla base configurada (ej. "Esta tienda opera con 4 Cocineros AM y 5 PM").
*   **Horarios Dinámicos:** Lee el cierre exacto de cada día (ej. viernes cierra 3 AM, lunes 1 AM) para ajustar los turnos de cierre y limpieza.
*   **Factor de Liderazgo:** Detecta cuántos Managers/Líderes están programados. Si un Líder está en turno, el algoritmo reduce automáticamente la necesidad de "Crew", ahorrando costos laborales innecesarios (Logic: *Role-Awareness*).

### Fase 2: Ingeniría de Demanda (Staggered Entry)
En lugar de que todos entren a la misma hora (lo que genera tiempos muertos al inicio y caos al final), el algoritmo usa la **Curva de Demanda Horaria** para "escalonar" las entradas:

*   **Pertura (Opening):** Asigna el personal mínimo estricto para abrir (Prep).
*   **Escalonamiento (Staggering):**
    *   Si la venta sube a las 11 AM, el 2º y 3º empleado entran a las 10:30 y 11:00 respectivamente.
    *   Esto garantiza que el personal llegue *exactamente* cuando los clientes llegan, ni antes (costo) ni después (mal servicio).
*   **Cierre y "Wash Crew":** El sistema genera automáticamente turnos especiales de limpieza ("Wash Crew") que inician antes del cierre y terminan exactamente 1 hora después, garantizando el cierre operativo sin horas extra excesivas.

### Fase 3: Reglas de Humanización (Constraints)
Aunque el sistema genera "huecos", estos huecos respetan reglas humanas pre-calculadas:
*   **Duración Garantizada:** El algoritmo está forzado a crear turnos de entre 6 y 8 horas. No crea "micro-turnos" de 2 horas que son inútiles para el empleado, ni turnos de 12 horas que generan fatiga.
*   **Protección de Transición (AM/PM):** Analiza el volumen de venta de 4 PM a 6 PM. Si es alto, extiende los turnos de la mañana o adelanta la entrada de la tarde para crear un "puente" de cobertura robusto.

---

## 3. Flujo de Trabajo (Workflow)

1.  **Cálculo**: El Admin ejecuta "Generar Semana". Inteligencia v4.0 procesa 15 tiendas x 7 días en segundos.
2.  **Deduplicación Inteligente**: Si el cálculo sugiere dos turnos idénticos, los fusiona para mantener la base de datos limpia.
3.  **Publicación de Estructura**: Se generan los "Open Shifts" (Turnos Abiertos).
4.  **Llenado (Fase Humana)**:
    *   Los empleados (via Mis Horarios) o el Gerente asignan los nombres a estos turnos perfectos.
    *   Como los turnos ya tienen la duración legal correcta (6-8h), el riesgo de error humano en la asignación se minimiza drásticamente.

---

## 4. Conclusión

**Intelligence v4.0** no reemplaza al Gerente, lo potencia.
Le entrega un "esqueleto" de horarios matemáticamente perfecto, optimizado para el costo y la venta. El Gerente solo tiene que poner la "carne" (los nombres), sabiendo que la estructura financiera de la semana ya está blindada por el algoritmo.
