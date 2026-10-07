# Contrato de reconciliación de la Orden Diaria — Tacos Gavilan

Estado: diseño de corrección, **no autorización de pedidos autónomos**. Piloto supervisado: Lynwood y Slauson; pruebas históricas de esta fase: solo Lynwood. Viele & Sons permanece manual.

## Tres hechos distintos

1. **Venta física registrada:** unidades y selecciones efectivamente cerradas en tickets Toast del día de negocio y tienda. PMIX es un control agregado, no sustituye tickets porque pierde canal, pedido y modificadores.
2. **Consumo teórico por receta:** ingredientes y empaques obtenidos al aplicar la receta vigente a cada selección real de Toast. Si falta canal, modificador, receta, unidad o ticket, el consumo de ese SKU queda `no_certificado`; no se rellena con porcentaje del PAR ni se reparte entre carnes/sabores sin una regla explícita y trazable.
3. **Sobrante físico:** cantidad que el manager cuenta al cierre en la unidad definida para ese SKU. Es la fuente oficial del pedido mientras dura el piloto.

No se fuerza `teórico = físico` por calibración. Se calcula y explica la diferencia. Una igualdad contable requiere registrar todas las entradas, ventas, aperturas, mermas, traslados, cortesías y consumo de salsabar en unidades compatibles.

## Dos balances que no deben mezclarse

Para un insumo medido por peso/piezas totales:

`stock_total_teórico_cierre = stock_total_físico_apertura + recepción_verificada + ajustes_entrada - consumo_recetas_Toast - otras_salidas_registradas`.

`variación = stock_total_físico_cierre - stock_total_teórico_cierre`. Un valor negativo es una alerta, no se trunca a cero ni se esconde en rendimiento.

Para artículos que se cuentan **solo en bolsas/cajas cerradas**:

`cerradas_cierre = cerradas_apertura + cerradas_recibidas - envases_abiertos`.

Los envases abiertos no se cuentan, por decisión operativa. `envases_abiertos` **no es igual** a `onzas servidas / onzas por bolsa`: una bolsa de Pastor de 5 lb deja de ser una bolsa cerrada al servir el primer taco aunque conserve casi todo su contenido. Sin pesar o registrar aperturas, el sobrante cerrado teórico no puede igualarse de forma verificable al físico. Debe aparecer como `no_observable`, no como precisión perfecta. El conteo físico cerrado sigue siendo suficiente para calcular el pedido.

## Pedido oficial y unidades

`necesidad_neta = MAX(0, PAR_mañana - sobrante_físico_hoy)`.

`pedido = redondeo_a_presentación_de_compra(necesidad_neta)` solo si el SKU tiene una regla de múltiplo comprobada. El PAR, el conteo y la necesidad deben estar en la **misma unidad**; el redondeo jamás se aplica al consumo por receta. Ningún colchón se suma fuera del PAR. Cualquier ajuste del manager se muestra y audita por separado.

Si falta cualquier conteo físico obligatorio, PAR válido o unidad homologada, **no existe pedido oficial**. No se interpreta `null` como cero. Un cero capturado expresamente sí es válido.

Ejemplo Papelito Para Torta: se consume y cuenta por **pieza** (también las piezas de una caja abierta), la presentación de compra es una caja de 60, y el múltiplo operativo del pedido se aplica a la necesidad en piezas. Papelito preparado no es papel wax `EL1254`.

## Cierre verificable

- La fecha de negocio se toma de Toast y de `America/Los_Angeles`, con corte a las 6:00 AM; el cálculo definitivo se ejecuta al dejar de vender la tienda, nunca por asumir que un cron del día siguiente ya terminó.
- Guardar un snapshot inmutable de tickets con IDs, canal, selecciones, modificadores, estado/void/refund, hora de cierre, conteo y checksum. Conciliar cantidad por GUID con PMIX; diferencias bloquean certificación.
- Conservar versión de receta, rendimiento y presentación **por tienda y fecha**. Los tamaños anteriores de bolsas de enero no deben reescribirse con los tamaños actuales.
- Registrar por separado recepción (Estimate entregado y validado), conteo físico, consumo Toast, otras salidas y variación; toda conversión indica unidad de origen y destino.
- El servidor recalcula PAR, conteos y pedido desde fuentes persistidas. No confía en sobrante teórico, PAR ni cantidades calculadas enviados por el navegador.
- Cerrar conteo y guardar líneas en una transacción; invalidar el cierre si cambian tickets, PAR, conteo o receta. QuickBooks necesita clave estable por orden/revisión y conciliación antes de reintentar.

## Prueba histórica que sí certifica

Reproducir cada tienda-día usando únicamente datos disponibles **hasta ese cierre**. Calcular consumo por tickets y sobrante teórico sin suministrar al motor el sobrante físico de ese día. Comparar después con conteo y Estimate real, por SKU, unidad y fecha. Reportar los faltantes y excluidos, no solo porcentajes sobre líneas presentes. Separar artículos observables (piezas cerradas/conteo compatible) de autoservicio y envases abiertos no medidos. Calibraciones se entrenan en un periodo y se evalúan en otro; nunca se valida con el día usado para ajustarlas.

## Estado actual y pendientes bloqueantes

- Se eliminó el consumo ficticio de 20% PAR y el colchón fuera del PAR del pedido oficial; el físico sigue mandando.
- El motor corrigió unidades confirmadas de Papelito, Pastor/Pollo/Cabeza/Lengua, Queso Rayado y Queso Amarillo en código. El catálogo aún tiene `unit_type` antiguo para cuatro carnes y 560 oz para Queso Amarillo, por lo que **no está homologado**.
- La sincronización productiva todavía convierte PMIX diario en un ticket ficticio `Take Out`; debe migrar a tickets completos y demostrar cobertura/conciliación antes de usar sus números como sobrante certificado.
- Party Trays, salsa 20 oz, autoservicio, recetas/modificadores no cubiertos, recepciones reales y seguridad/idempotencia de QuickBooks siguen requiriendo implementación y pruebas.
- Ningún porcentaje de similitud entre pedidos históricos calculados con sobrante físico autoriza operación autónoma.

## Evidencia de esta iteración (Lynwood, solo lectura)

- 22-sep-2026: 763 tickets y 3,249 selecciones coinciden entre el archivo local y `toast_ticket_consumption_snapshots`; también coinciden canal, consumo por SKU y casos sin receta. Esto demuestra paridad de **fuente** para ese día, no completitud de todos los días.
- Una consulta independiente de Toast `ordersBulk` para el mismo día devolvió 764 órdenes, de las cuales 763 estaban activas. Sus 763 GUID y selecciones coinciden exactamente con los 763 snapshots. El control negativo del 23-sep-2026 rechazó correctamente el cierre: Toast tenía 763 órdenes activas y Supabase **cero** snapshots.
- La conciliación del fin de semana respeta la operación: el cierre del viernes 18-sep alimenta el intervalo sábado 19 + domingo 20, con 1,982 tickets entre ambos días y un único pedido del viernes para recibir el sábado. No se interpreta el sábado sin conteo separado como error de captura.
- 15-sep-2026: 817 tickets y 3,498 selecciones; 41 SKU tienen conteo de apertura/cierre y salida calculada. Ocho carnes se cuentan solo en bolsas cerradas, de modo que su consumo en onzas no es comparable con ese conteo. Flan y cheesecake tienen posibles recepciones semanales fuera de la orden diaria y se separan. Entre las otras 31 líneas exploratorias, 12 están a ±2 unidades; el resultado aún incluye autoservicio no observado y no certifica exactitud.
- `Papelito Para Torta` pasó a unidades de pieza (167 piezas de consumo teórico calculado en la muestra), sin confundirlo con cajas ni con papel wax. Se detectaron discrepancias restantes que no deben ajustarse artificialmente: por ejemplo flan, cheesecake, tortillas de maíz y sabores de aguas de autoservicio.
