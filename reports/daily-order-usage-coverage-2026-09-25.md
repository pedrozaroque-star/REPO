# Cobertura de consumo teórico: Orden Diaria de Lynwood

Consulta de solo lectura a Supabase el 25 de septiembre de 2026. Ventana PMIX y uso: 19–24 de septiembre; el 22 se excluye de la evaluación de ventas por instrucción del usuario. La presencia de una receta no prueba que represente el consumo físico ni todos los canales/modificadores.

## Universo y resultado

- `store_order_template` para Lynwood y `order_type=daily`: **49 SKU**, todos con registro en `inventory_items`. La acción `fetchOrderableItems` añade **Flan** y **Cheesecake** como `TRACK_ONLY`, por lo que la pantalla llega a 51 renglones; no son órdenes QB de Bodega.
- **46/49** SKU tienen al menos una fila directa en `recipes`; **3/49** no tienen ninguna. Se encontraron **824** filas de recetas relacionadas, pero no se deben interpretar como 824 recetas completas o correctas.
- **42/49** tienen al menos un GUID de receta encontrado entre los GUID de PMIX cache del 19–24; **7/49** no. Esto solo mide coincidencia de GUID en esa ventana, no demanda ni vigencia global.
- El cache PMIX existe para los seis días 19–24. `inventory_usage_log` para Lynwood tiene **0 filas** en la misma ventana, de modo que no hay consumo teórico persistido para alimentar un saldo automático. No usar cero como consumo real.
- Excluyendo el día 22: de **3,246** renglones vendidos del PMIX, **339** no tienen receta ligada a alguno de los 49 SKU de Orden Diaria (cantidad total 1,259). Incluyen separadores de tacos, bebidas y **Flan 62 / Cheesecake 42**; la métrica no es “ventas sin receta en todo el sistema” y requiere análisis por tipo de artículo.

## SKU sin coincidencia directa de receta y venta observada

| SKU | Recetas directas | Interpretación operativa |
|---|---:|---|
| Salsa Roja (galón) | 2 | Venta de salsa 20 oz puede necesitar receta virtual; uso libre del salsa bar no se observa en Toast. |
| Salsa Verde (galón) | 1 | Igual: salsa bar libre no se atribuye a tickets. |
| Onion/ Cil. Mix 1/4 (bolsa 5 lb) | 3 | Mixta a granel en salsa bar; no es convertible a bolsitas por ticket. |
| 2 oz Bolsas de Rajas con Zanahoria (caja 165) | 2 | Se ofrecen libremente; no confundir con `Rajas y Zanahorias` a granel. |
| Onion Pepper Mix | 0 | Falta receta directa; determinar si es preparación interna u otro consumo operativo. |
| Bolsa Lima 5 LB | 0 | Lima a granel en salsa bar; separar de `Lima Bolsita` (caja 210). |
| Viva Lard (Manteca) | 0 | Insumo de cocción; Toast no captura directamente cuánto se usó. Requiere estándar de producción/merma o conciliación física. |

Para los SKU con receta directa y GUID observado, tampoco se puede asumir que el total consumido sea correcto: hay ventas sin mapeo, recetas virtuales fuera de la tabla `recipes`, porciones variables, rendimiento, desperdicio y autoconsumo. Particularmente las carnes, salsas, mixta, lima y rajas deben contrastarse por presentación y unidad de inventario.

## Riesgos de unidad y cobertura

- `Pastor` y `Pollo`: etiqueta `10 lb`, factor `quantity_per_unit=5`; `Cabeza` y `Lengua`: etiqueta `5 lb`, factor `2.5`. Confirmar si la etiqueta refiere al empaque original o a unidad interna antes de automatizar pedido. No alterar factores con base solo en nombres.
- `Rajas y Zanahorias` a granel: `unit_type=6.56 lb` pero factor `6`; el usuario confirmó bolsa de **6 lb**. La etiqueta está desactualizada, el factor numérico coincide con lo confirmado.
- Insumos libres del salsa bar (`salsa` a granel, mixta en bolsitas y a granel, lima en bolsitas y a granel, rajas en bolsitas y a granel) no pueden descontarse exactamente por ticket. La demanda del ticket sirve como señal, y la salida física por SKU se mide con saldo inicial + entregas − saldo final, con inventario estimado entre conteos.
- Limpieza, empaques y otros consumibles operativos sin relación 1:1 a un ticket requieren una señal separada o tasa calibrada. No atribuirles falsa precisión.

## Ejecución y reproducción

`node scripts/audit-daily-order-recipe-coverage.cjs` consultó en vivo tablas reales sin mutaciones. Su prueba de frontera confirma que 5:59 AM de Los Ángeles pertenece al día laboral anterior y 6:00 AM al siguiente; validó además protección frente a NaN. El script imprime los 49 SKU con unidad, factor, cantidad de filas de receta, coincidencias GUID y días de consumo guardado. No emitió órdenes ni modificó inventarios.
+
## Matriz completa de los 49 SKU de Lynwood

La columna «Coincidencias PMIX» cuenta filas de receta cuyo GUID aparece en el cache del 19–24 de septiembre; no certifica que la receta esté completa ni equivale a unidades vendidas. Todos los SKU tienen **0 fechas** de consumo persistido en esa ventana.

| # | Producto | Factor / etiqueta de unidad | Filas de receta | Coincidencias PMIX |
|---:|---|---|---:|---:|
| 1 | Horchata | 1 1 Gallon | 5 | 2 |
| 2 | Tamarindo Concentrate | 1 1 Gallon | 4 | 2 |
| 3 | Jamaica Concentrate | 1 1 Gallon | 4 | 2 |
| 4 | Piña Concentrate | 1 1 Gallon | 4 | 2 |
| 5 | Salsa Roja | 1 1 gal | 2 | 0 |
| 6 | Salsa Verde | 1 1 Gallon | 1 | 0 |
| 7 | 1.5 oz Salsa Roja Pack | 400 400 ct | 11 | 5 |
| 8 | 1.5 oz Salsa Verde Pack | 400 400 ct | 9 | 2 |
| 9 | Carne Asada | 10 10 lb | 18 | 16 |
| 10 | Pastor | 5 10 lb | 14 | 12 |
| 11 | Cabeza | 2.5 5 lb | 14 | 13 |
| 12 | Lengua | 2.5 5 lb | 14 | 12 |
| 13 | Buche 6 oz | 6 6 oz | 14 | 10 |
| 14 | Carnitas 6 oz | 6 6 oz | 14 | 11 |
| 15 | Pollo | 5 10 lb | 14 | 12 |
| 16 | Chorizo 8 oz | 8 8 oz | 17 | 14 |
| 17 | Salchicha Bag | 1 1 lb | 4 | 2 |
| 18 | Milaneza | 20 20 pza | 3 | 3 |
| 19 | Jamon Pack | 2 2 lb | 10 | 5 |
| 20 | Arroz | 5 5 lb | 60 | 48 |
| 21 | Frijol Entero | 10 10 lb | 3 | 2 |
| 22 | Frijol Molido | 10 10 lb | 92 | 76 |
| 23 | Papelito Para Torta | 60 Case | 41 | 35 |
| 24 | 1 oz Bolsa de Mixta | 190 190 ct | 10 | 4 |
| 25 | Onion/ Cil. Mix 1/4 | 5 5 lb | 3 | 0 |
| 26 | Bolsa Aguacate | 2 2 lb | 92 | 70 |
| 27 | Mulitas Con Queso | 12 12 pza | 19 | 17 |
| 28 | Bolsa Crema | 1.5 1.5 lb | 62 | 47 |
| 29 | Bolsa Mayonesa | 1.5 1.5 lb | 21 | 17 |
| 30 | Queso Rayado | 2 2 lb | 33 | 17 |
| 31 | Queso Cotija 021 | 12 12 oz | 28 | 25 |
| 32 | Queso Tortas/platos/Desayuno | 20 20 pza | 4 | 3 |
| 33 | Quesadilla Bodega | 12 12 ct | 20 | 17 |
| 34 | Huevo | 180 180 pza | 19 | 16 |
| 35 | Salsa Huevos Rancheros | 2.3 2.30 lb | 1 | 1 |
| 36 | Rajas y Zanahorias | 6 6.56 lb | 5 | 1 |
| 37 | 2 oz Bolsas de Rajas con Zanahoria | 165 165 pza | 2 | 0 |
| 38 | Onion Pepper Mix | 5 5 lb | 0 | 0 |
| 39 | Lima Bolsita | 210 210 ct | 9 | 2 |
| 40 | Bolsa Lima 5 LB | 5 5 lb | 0 | 0 |
| 41 | Champurrado Mix | 1 1 Gallon | 4 | 3 |
| 42 | Amarillo Cheese | 560 560 oz | 14 | 9 |
| 43 | Tortilla Nachos | 1 4.5 oz | 10 | 9 |
| 44 | 1100 Tortilla,White Corn 4.7OZ 60CT | 60 5 dz | 15 | 10 |
| 45 | 358-9673BT 13” Flour Tortilla | 12 1 dz | 44 | 36 |
| 46 | 358_9604BT Tortilla Regular 8 in | 12 1 dz | 5 | 1 |
| 47 | Teleras | 6 6 pza | 22 | 18 |
| 48 | Sopes | 12 1 dz | 10 | 10 |
| 49 | Viva Lard (Manteca) | 48 Case of 48 lb | 0 | 0 |
