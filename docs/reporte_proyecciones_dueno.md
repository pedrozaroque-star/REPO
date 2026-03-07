**Asunto: Aclaración sobre el cambio en las Proyecciones de Ventas (Planificador/Ventas)**

Hola,

Quería aprovechar para explicarte qué estaba pasando con las proyecciones de ventas de esta semana, por qué notaste que el número de $227K cambió a $218K en el transcurso del mismo día, y de paso, detallarte cómo funciona exactamente este cálculo.

### 1. ¿Cómo calcula el sistema tu Proyección?
El "Motor de Inteligencia" no lanza números al azar. Su fórmula matemática funciona así:

- **Base Histórica (Estacionalidad):** Toma las ventas exactamente del mismo día pero del año pasado. Si va a proyectar un Viernes, busca cómo estuvo ese mismo Viernes hace un año.
- **Factor de Crecimiento Dinámico:**  Esta es la parte inteligente. El sistema revisa los últimos 28 días de la tienda para calcular si actualmente la tienda está vendiendo un "5% más" o un "3% menos" en comparación con el año pasado. Si el año pasado el Viernes vendió $10,000, pero la tendencia reciente es de +5%, proyecta $10,500.
- **Clima y Horarios Especiales:** Finalmente, revisa si hay tormentas severas (-5%) o si la tienda va a cerrar temprano, y recorta la venta en consecuencia.

### 2. ¿Qué estaba fallando? (El blanco en movimiento)
El problema era que el "Factor de Crecimiento Dinámico" estaba operando *demasiado en tiempo real*. 

Por ejemplo, si hoy es Miércoles, el sistema recalculaba la tendencia de la tienda usando las ventas reales del Lunes y Martes de **esta misma semana**. Esto causaba que la proyección del fin de semana (Viernes, Sábado) subiera o bajara un poco cada hora basada en si los cajeros estaban vendiendo mucho o poco ese mismo día. Así, la meta total de la semana completa se movía constantemente frente a nuestros ojos.

Esto nos destrozaba la planeación operativa, porque si los horarios del personal se arman el Lunes asumiendo una venta esperada de $227K, no nos sirve que el sistema cambie la meta a $218K el Miércoles, ya que el personal ya está comprometido en el "Planificador".

### 3. La Solución ("El Ancla del Domingo")
Aplicamos un candado al cerebro del sistema para que se "congele" al inicio de nuestra semana operativa oficial (el Lunes a las 6:00 AM). 

A partir de ahora, el sistema tomará la "foto" de crecimiento mirando como límite **exactamente el Domingo anterior a las 5:59 AM**. Durante el transcurso de la semana nueva, el sistema será "ciego" a las ventas de esta misma semana al momento de hacer sus predicciones.

### ¿Qué significa esto para ti y los gerentes?
1. **Un solo número fijo:** La proyección que veas el Lunes a primera hora para la semana será matemáticamente idéntica a la que verás el Viernes por la tarde. El número ya no va a "bailar".
2. **Mejor planificación:** Los gerentes podrán confiar al 100% en la meta de "Projected" en su herramienta de presupuesto para agendar el personal correcto, ajustándose a un número sólido de principio a fin de la semana.

Con estos cambios, las pantallas de Ventas y del Planificador quedaron completamente alineadas, estables y matemáticamente blindadas.

Cualquier duda, estoy a la orden.
