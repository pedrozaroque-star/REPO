# Piloto de conciliación: Lynwood, día operativo 21 de septiembre de 2026

## Corte operativo comprobado

El usuario confirmó que los sobrantes de Orden Diaria son conteos físicos al cierre real del restaurante, después del cierre o hasta 30 minutos antes. El horario configurado para Lynwood el lunes es cierre 1:00 AM del martes. Los conteos revisados del 20 se registraron el 21 alrededor de la 1:20 AM; los del 21 se registraron el 22 alrededor de la 1:37 AM, hora de Los Ángeles. Esas marcas son horas de creación en base de datos, no una columna dedicada de hora física del conteo.

Se consultaron 740 tickets no anulados de Toast, `businessDate=2026-09-21`. Ninguno tiene `openedDate`, `paidDate` ni `closedDate` después de la primera marca del conteo final (1:36 AM del 22). Una orden Toast tiene cierre después de la 1:00 AM configurada, pero antes del registro del conteo. Es una muestra temporalmente mucho más defendible que el 22 de septiembre.

## Comparación por insumo

El consumo inferido de operación en esta tabla es: sobrante del 20 + cantidad pedida el 20 − sobrante del 21. El usuario confirmó que **siempre llega completo lo pedido a través de QuickBooks**; la tienda lo cuenta y palomea en la hoja. Por tanto, para este flujo se usa la cantidad enviada a QB como entrada recibida. Aún puede haber traspasos, merma o diferencias de conteo no capturados. En Supabase la orden del 20 figura `sent` porque ese estado representa el envío, no una recepción separada.

| Insumo | Sobrante 20 | Pedido/recibido 20→21 | Sobrante 21 | Consumo inferido del inventario | Teórico tickets 21 | Diferencia |
|---|---:|---:|---:|---:|---:|---:|
| Carne Asada, bolsa 10 lb |35 bolsas|15 bolsas|16 bolsas|340 lb|361.86 lb crudos equivalentes|+21.86 lb teórico|
| Mixta, caja 190 |2 cajas|3 cajas|2 cajas|570 bolsitas|1,282 por reglas de ticket|+712 teórico|
| Onion/Cil. Mix 1/4, bolsa 5 lb |1 bolsa|3 bolsas|1 bolsa|15 lb a granel|No se identifica por ticket: uso en salsa bar|No aplica|
| Salsa roja, caja 400 |0 cajas|4 cajas|2 cajas|800 sobres|1,531 por reglas de ticket|+731 teórico|
| Salsa verde, caja 400 |3 cajas|2 cajas|3 cajas|800 sobres|526 por reglas de ticket|−274 teórico|
| Salsa roja a granel, galón |2 gal|1 gal|1 gal|2 gal|No atribuible a tickets de salsa bar|No aplica|
| Salsa verde a granel, galón |0 gal|3 gal|0 gal|3 gal|No atribuible a tickets de salsa bar|No aplica|
| Lima Bolsita, caja 210 |7 cajas|3 cajas|4 cajas|6 cajas = 1,260 bolsitas|No equivale al retiro real de clientes del salsa bar|No comparable aún|
| Bolsa Lima 5 LB |3 bolsas|1 bolsa|1 bolsa|3 bolsas = 15 lb a granel|No se identifica por ticket: uso en salsa bar|No aplica|
| 2 oz Bolsas de Rajas con Zanahoria, caja 165 |3 cajas|1 caja|2 cajas|2 cajas = 330 bolsitas|No equivale al retiro real de clientes del salsa bar|No comparable aún|
| Rajas y Zanahorias, bolsa 6 lb |8 bolsas|Sin renglón en pedido diario enviado|7 bolsas|1 bolsa = 6 lb si el Estimate de QB confirma cero recibido|No se identifica por ticket: uso en salsa bar|Provisional|
| Horchata, galón |17 gal|38 gal|15 gal|40 gal|7,498 oz de Horchata en recetas, ~58.58 gal líquidos; no se comprobó equivalencia con galones preparados|No comparable aún|

El reporte del simulador también calcula los mismos condimentos por otra vía de recetas: mixta 902 pza y salsa verde 797 pza. No deben sumarse automáticamente a la columna de reglas de ticket. El valor de salsa roja por recetas está disponible en el JSON si se necesita analizar SKU específico.

**Aclaración operativa posterior:** `1 oz Bolsa de Mixta` es una caja de 190 bolsitas individuales de cebolla/cilantro. `Onion/ Cil. Mix 1/4` es un insumo distinto: bolsa grande de 5 lb de la misma mezcla que se pone en el salsa bar. Además, se colocan bolsitas individuales en el salsa bar para que los clientes las tomen libremente. Por ello, los 1,282 calculados a partir de platillos no son una medición exacta del consumo real de bolsitas, aunque no se haya duplicado la receta; el retiro autónomo no se captura en Toast. Las 15 lb de bolsa grande tampoco se pueden convertir en cantidad de bolsitas ni sumarse a ese SKU. Para reposición sin prorrateo, usar conteo físico por SKU + entregas QB + objetivo de existencia. Mantener la estimación por tickets solo como comparación de comportamiento, etiquetada como tal, y no escribirla como consumo exacto al kardex.

La lima se maneja igual de separada en inventario: `Lima Bolsita` es caja de 210 bolsitas; `Bolsa Lima 5 LB` es bolsa de 5 lb a granel. Ambas se colocan en salsa bar. No convertir libras a bolsitas ni cargar automáticamente a un platillo las bolsitas tomadas libremente.

Los jalapeños con zanahoria también son dos SKU de Orden Diaria: `2 oz Bolsas de Rajas con Zanahoria`, caja de 165 bolsitas, y `Rajas y Zanahorias`, bolsa a granel de **6 lb**, según la corrección del usuario. En Supabase, `quantity_per_unit = 6` es correcto; `unit_type = 6.56 lb` es la etiqueta desactualizada que debe corregirse antes de confiar en todas las rutas de conversión. El usuario aclaró que el pedido depende del PAR: si PAR menos sobrante no requiere rajas, no se piden. La orden diaria de Lynwood del 20 de septiembre está `sent`, tiene Estimate de QB `575249` y 38 renglones, pero no incluye rajas a granel; los pedidos del 22 al 24 sí incluyen ese SKU. La ausencia es compatible con un pedido de cero según PAR, no con que el SKU no esté disponible. La ruta de envío construye el Estimate desde los renglones guardados y omite cantidades cero. Si el Estimate no fue alterado fuera de la app y no hubo entregas extraordinarias, el cambio de 8 a 7 bolsas implica 1 bolsa (6 lb) de salida. No incorporarlo todavía como consumo confirmado hasta verificar el Estimate histórico o la hoja de recepción.

### Revisión extendida de mixta, salsas, lima y jalapeños en Lynwood

Consulta de solo lectura de 24 de agosto al 24 de septiembre de 2026, excluyendo totalmente el 22 de septiembre y también el 23 como movimiento porque necesitaría el conteo del 22. Se incluyeron únicamente pares de fechas consecutivas con conteo de ambos cierres y renglón de pedido diario enviado por QB. Sin extrapolar días faltantes:

| Insumo | Pares de conteos consecutivos | Salida observada de almacén |
|---|---:|---:|
| 1 oz Bolsa de Mixta |20|88 cajas = 16,720 bolsitas|
| Onion/ Cil. Mix 1/4 |21|75 bolsas = 375 lb|
| 1.5 oz Salsa Roja Pack |21|50 cajas = 20,000 sobres|
| 1.5 oz Salsa Verde Pack |20|54 cajas = 21,600 sobres|
| Salsa Roja a granel |18|26 galones|
| Salsa Verde a granel |21|45 galones|
| Lima Bolsita |21|151 cajas = 31,710 bolsitas|
| Bolsa Lima 5 LB |19|62 bolsas = 310 lb|
| 2 oz Bolsas de Rajas con Zanahoria |20|50 cajas = 8,250 bolsitas|
| Rajas y Zanahorias a granel |11|31 bolsas = 186 lb; pendiente de corregir la etiqueta `unit_type`|

Son sumas de los días con datos, no un total del mes ni una tasa diaria extrapolada. Bolsas grandes, bolsitas, galones y sobres se mantienen como SKUs separados. Parte del consumo ocurre en salsa bar y no se vincula a tickets individuales; para estos SKU el conteo y las entregas QB proporcionan la demanda observada cuando existen ambos conteos y el renglón del pedido. En rajas a granel se excluyeron 8 pares sin conteo, 9 sin renglón de pedido y un balance negativo (25 de agosto: −3 bolsas), que requiere revisión. Script reproducible: `scripts/audit-lynwood-mixta-physical.cjs`.

## Estado de automatización

La simulación procesó 740 tickets, 3,183 selecciones y 1,485 modificadores. Generó [`simulation-lynwood-2026-09-21.json`](simulation-lynwood-2026-09-21.json) sin escribir inventario ni enviar órdenes. La recepción completa está confirmada como regla operativa por el usuario. Para un pedido automático fiable faltan: reconciliar el origen único de condimentos, normalizar unidades y separar uso vendido de mermas/traslados. El consumo inferido de asada es 340 lb frente a 361.86 lb calculadas desde tickets; la diferencia de 21.86 lb requiere investigación, no asignación automática a merma.

### Flujo físico de recepción confirmado por operación

- La tienda recibe los productos de la Orden Diaria, los cuenta físicamente y palomea la hoja generada mediante QuickBooks desde la app.
- Orden de líquidos, Viele & Sons, flanes y cheesecakes se reciben semanalmente.
- El usuario confirmó que siempre llega lo pedido a través de QuickBooks. La hoja palomeada verifica esa entrega en tienda. `inventory_orders.status = sent` refleja envío del Estimate a QuickBooks; la cantidad recibida no se guarda en una columna separada porque operación reporta que coincide con la pedida.
- En `app/inventory/orders/actions.ts` el cálculo actual lee las cantidades `final_qty` del pedido anterior y las agrega a `arrivedMap`. Esta regla es consistente con la confirmación del usuario para pedidos QB, pero debe limitarse al pedido realmente enviado y a su fecha de entrega.

La digitalización de la hoja palomeada no es requisito para este piloto bajo la regla operativa confirmada. Si en el futuro ocurre una entrega incompleta, debe registrarse como excepción para que el cálculo no confunda pedido con recibido.

Scripts de lectura: `scripts/probe-lynwood-alternate-day.cjs` y simulación `SIM_LYNWOOD_2026_09_21=1 npx tsx scripts/simulate-real-tickets-consumption.ts`. No commit ni push.
