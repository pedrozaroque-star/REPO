# Catálogo Orden Diaria: auditoría de solo lectura (25 sep 2026)

Fuente: Supabase en vivo, tablas `stores`, `store_order_template`, `inventory_items` y `quickbooks_mappings`; script `scripts/audit-daily-order-catalog.cjs`. No se hicieron mutaciones.

## Cobertura

- 15 tiendas activas; las 15 tienen plantilla diaria.
- 741 líneas, 53 SKU distintos: 49 presentes en las 15 tiendas y 4 específicos.
- 12 tiendas tienen 49 líneas. Azusa, La Puente y Norwalk tienen 51.
- No se detectaron líneas duplicadas por SKU dentro de una tienda, referencias a artículos inexistentes, identificadores QB ausentes ni nombres internos duplicados tras normalización.

SKU específicos: `Agua Gavilan` (Norwalk), `Agua Para Los Clientes` (Azusa, La Puente, Norwalk), `Cover Para Taco` (La Puente), `Gavilan Catering box 231880` (Azusa). No son necesariamente anomalías: pueden reflejar diferencias operativas reales.

## Unidades y descripciones que requieren revisión

| Artículo | `unit_type` | Factor `quantity_per_unit` | Descripción de pedido | Interpretación |
|---|---:|---:|---|---|
| Rajas y Zanahorias | 6.56 lb | 6 lb | bolsa 6 lb 9 oz | Confirmación del usuario: son 6 lb; etiquetas desactualizadas. |
| Cabeza, Lengua | 5 lb | 2.5 lb | bolsa 2.5 lb | `unit_type` no concuerda con el factor ni la descripción. |
| Pastor, Pollo | 10 lb | 5 lb | bolsa 5 lb | `unit_type` no concuerda con el factor ni la descripción. |
| Agua Para Los Clientes | Unit | 1 pieza | caja 80 unidades | Factor posiblemente incorrecto si se calcula inventario por pieza. |
| Milaneza | 20 piezas | 20 piezas | bolsa 2.6 lb | Requiere unidad base explícita; no convertir automáticamente piezas ↔ lb. |
| Papelito Para Torta | Case | 60 piezas | paquete 3.90 oz | Confirmado previamente: 60 papelitos por caja; texto de pedido no lo expresa. |
| Queso Tortas/platos/Desayuno | 20 piezas | 20 piezas | paquete 1 lb | Requiere verificar si son 20 porciones por libra. |

Las presentaciones de mixta, lima, salsa y rajas en bolsitas y a granel están separadas correctamente como SKU distintos en las 15 plantillas; no deben fusionarse o prorratearse automáticamente.

## Prueba

El script consultó datos reales de solo lectura y verificó integridad del catálogo, normalización con/sin acentos, 5:59 vs 6:00 en `America/Los_Angeles`, y prevención de `NaN` de 0/0. La consulta terminó exitosamente.
