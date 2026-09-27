# Lynwood: conciliación piloto del 22 de septiembre de 2026

## Resultado

No aprobado para activación de descuentos ni envío automático de pedidos. Consultas reales de solo lectura a Supabase y pruebas de evidencia ejecutadas; no se modificó inventario, recetas, órdenes ni recepciones.

## Regla operativa confirmada por el usuario

El sobrante anotado en Orden Diaria representa el inventario físico al cierre efectivo del restaurante, cuando deja de atender clientes. El corte técnico de Toast a las 5:59 AM define el día comercial del sistema, pero no es el momento al que corresponde el conteo físico. Para comparar, se deben usar las ventas entre dos cierres efectivos consecutivos de esa tienda. En Lynwood, `stores.weekly_hours` indica cierre a la 1:00 AM de lunes a jueves y horarios más tarde el fin de semana; confirmar la fecha efectiva del cierre para cada conteo antes de asignar ventas.

La pantalla de Orden Diaria asocia el sobrante con `selectedOrderDate`; `updateDailyLeftover()` guarda `count_date` con esa fecha y `created_at` se genera en DB al crear la fila. Una captura posterior puede etiquetarse con una fecha operativa elegida, sin almacenar la hora real del conteo físico. `created_at` no representa necesariamente esa hora.

Consulta adicional a 763 órdenes reales de Toast del día comercial 2026-09-22: 102 tienen `closedDate || paidDate || modifiedDate` posterior a las 22:36 hora Los Ángeles y hasta la 1:00 AM configurada para el cierre. Hubo dos registros a las 6:00 AM que requieren distinguir `modifiedDate` de hora de venta; por eso no se interpretan como ventas posteriores al cierre. El conteo etiquetado 22 se creó en DB a las 22:36. Estos 102 tickets demuestran que la marca `created_at` NO se puede usar como corte seguro para comparar el sobrante con la venta del día. Script de lectura: `scripts/probe-lynwood-close-window.cjs`.

## Evidencia disponible

- Lynwood store_id 14; Toast external ID 80a1ec95-bc73-402e-8884-e5abbe9343e6.
- Reporte de simulación: 763 tickets del 2026-09-22.
- Conteos: 50 registros el 21 y 51 el 22 de septiembre.
- Pedidos diarios de ambos días con estado `sent`, no recepción verificada.
- Las columnas observadas en inventory_order_lines no incluyen cantidad recibida ni fecha de recepción.
- Sin registros en inventory_usage_log para external ID de Lynwood entre 20 y 24 de septiembre; última fecha obtenida: 21 de julio. Esto no descarta otros identificadores o fuentes.

## Comparación exploratoria, NO consumo físico validado

Supone que llegó íntegro el pedido del día anterior y que conteos/pedidos están en unidades de empaque del catálogo. No incluye traslados, desperdicios ni diferencias de horario.

| Insumo | Conteo 21 | Pedido 21 | Conteo 22 | Consumo proxy | Resultado previo por tickets |
|---|---:|---:|---:|---:|---:|
| Asada, bolsa 10 lb |16|34|15|35 bolsas = 350 lb|347.00 lb equivalentes de compra|
| Horchata, galón |15|40|20|35 galones|No conciliado|
| Mixta, caja 190 |2|3|1|760 bolsitas|1,335 bolsitas|
| Salsa roja, caja 400 |2|2|2|800 sobres|1,480 sobres|
| Salsa verde, caja 400 |3|2|2|1,200 sobres|611 sobres|

La cercanía en asada NO valida el motor ni demuestra merma o exactitud. Los tiempos `created_at` de esos conteos corresponden aproximadamente a 01:36–01:37 y 22:36–22:40 del 22 de septiembre, hora Los Ángeles. El primero tiene `count_date=2026-09-21` y el segundo `count_date=2026-09-22`. El primero ocurre antes de la apertura configurada del 21; el segundo antes del cierre configurado del 22. Esto requiere revisar si `created_at` es hora de registro/edición, cómo se etiqueta `count_date` y si el horario programado reflejaba el cierre real. No asumir que created_at es la hora en que se contó físicamente.

## Hallazgos de la simulación

Lectura completa por subagente del script y meat-allocation; comprobación Node de solo lectura exit 0:

- scripts/simulate-real-tickets-consumption.ts:336 acumula empaques por ticket; 407–435 acumula además recetas por insumo. Mixta: 799 desde recetas vs 1,335 desde tickets; roja 387 vs 1,480; verde 801 vs 611. Son vías no reconciliadas, NO evidencia de doble descuento ya efectuado en DB.
- Líneas 413–416 y 432–435 suman por insumo conservando unidad inicial sin normalizar otras unidades.
- Líneas 375 y 393 permiten receta vacía sin alarma integral; reglas virtuales/automation no se resuelven de forma completa.
- Lecturas de recetas y snapshots no paginadas: riesgo de omisión, no truncamiento actual probado.
- Desglose de modificadores solo primer nivel y cantidad 0 convertida en 1 en importación Toast.
- lib/inventory/meat-allocation.ts:95 cae a asada en ciertos casos sin identificación; 104–107 prioriza dorada sobre extra. Deben probarse combinaciones con evidencia real.

## Próximas acciones

1. Regla temporal aclarada: sobrante físico al cierre efectivo. Verificar en Lynwood qué cierre corresponde a cada `count_date` y si `created_at` refleja captura o edición posterior.
2. Ubicar evidencia real de recepciones; no convertir estado sent en received por suposición.
3. Corregir el cálculo diagnóstico para tener una sola contribución por selección/insumo, unidad normalizada, origen trazable y excepciones explícitas. No modificar producción automáticamente.
4. Reejecutar Lynwood paginado contra una ventana compatible con conteos.
5. Solo después producir pedido sugerido no enviado, con demanda hasta próxima entrega, inventario disponible, entradas pendientes y redondeo por empaque.

Prueba reproducible de solo lectura: `node scripts/probe-lynwood-reconciliation.cjs`. TypeScript `npx tsc --noEmit`: exit 0. No commit/push.
