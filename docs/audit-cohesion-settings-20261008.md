# Revisión posterior a 7b5c848

Fecha de revisión solicitada: 8 octubre 2026. Releídos JSDoc, endpoint completo de site-mappings y todos los cambios de configuración del commit, contrastados con la lectura íntegra anterior y consumidores. GL accounts no cambió en este commit. No se alteró implementación ni datos remotos.

## Correcciones comprobadas

- La UI carga los seis ajustes de workflow y los tres nuevos estados en `page.tsx:241-249`; el guardado los incluye en `341-361`.
- API `site-mappings/route.ts:73-100` acepta columnas snake_case y convierte seis aliases camelCase antes de la mutación. GET suministra aliases con nullish defaults (36-47); conserva `false`.
- Memos y facilitador ahora tienen controles con estado y handlers. Los overrides llaman `handleLineClassChange` (178-180) y ya no cambian la clase global.
- Restore API (151-170) coincide con cuentas Postmates 12051, comisiones Central/Broadway 12100 y demás defaults que antes omitía.

Estas correcciones sustituyen los hallazgos previos de falta de conexión UI/payload. La presencia real de nuevas columnas y el roundtrip de mutación requieren smoke independiente; esta prueba no escribe mappings operativos.

## Hallazgos vigentes

**P1 — Persistir no cambia el resultado contable.** `app/api/accounting/packets/route.ts:268-290` construye SiteMappingConfig sin ninguno de los nueve nuevos campos: discount_account, inc_customer_receivables, add_customer_name_memo, add_revenue_center_memo, cc_fee_validation, check_open_orders, tax_facilitator_enabled, alt_memos y line_class_overrides. Búsqueda de estos campos en lib y app/api/accounting solo encuentra declaraciones en site-mappings. Los memos, overrides y switches pueden viajar a DB pero no controlan generación/publicación. No se debe informar paridad funcional como completada.

**P1 — Autorización sigue ausente.** Site-mappings GET/PUT/PATCH/POST continúa sin verificación de sesión, rol ni alcance de sucursal; gl-accounts tampoco fue protegido. API permite valores arbitrarios de cuentas, clases, JSON y tipos sin validación de dominio. POST restore puede reactivar una tienda y vaciar toda su configuración avanzada. No se probaron escrituras anónimas.

**P2 — Modelo aún fusiona cuentas independientes.** Delivery fees y merchant fees comparten cc_fees_account (1158/1164 y tabla Payments); ambos campos Receivables comparten open_orders_account (1741-1754). Dining options y descuentos continúan agrupados; no existe granularidad equivalente al original.

**P2 — Selección vacía de override se oculta.** Por ejemplo `page.tsx:1678` usa `lineClassOverrides['cash_in'] || formData.qb_class || storeRefs.className`. Seleccionar Not Selected guarda cadena vacía pero vuelve a mostrar la clase global; el UI no representa fielmente la ausencia de override como el original.

**P2 — Permanecen catálogo estático, EBT número/ID incoherente y sincronización parcial silenciosa.** Refresh Lists solo consulta cuentas, EBT cambia número sin QB ID, y GL sync devuelve success aunque acumule errores. Ver explicación en reporte anterior: este commit no modifica esas ramas.

**P2 — Paridad original incompleta.** Las capturas siguen siendo solo Azusa; faltan opciones por marca de tarjeta, configuración de depósito mínimo y Book Detail editable. Fallback desconocido Warehouse/Azusa del mapa QB tampoco cambió.

## Prueba ejecutada

`scripts/audit-cohesion-settings-20261008.ts` evalúa el objeto original de JSON.stringify, el código original de filtrado/conversión de API y el callback original de override, sin sustituir servicios. Comprobó nueve columnas presentes, false preservado, aliases eliminados, memo correcto y clase global Azusa conservada mientras override Cash In cambia a Bell. Comprueba además los nueve campos ausentes del objeto de configuración de packets. Resultado exitoso, evidencia `docs/cohesion-audit-20261006/settings-recheck-20261008.json`.

Comando Windows: `$env:NODE_OPTIONS='--require ./scripts/tsx-user-info-fallback.cjs'; npx tsx scripts/audit-cohesion-settings-20261008.ts`.

Veredicto: avances reales de captura/serialización, sin aceptación funcional completa. No repetir el viejo script como prueba de regresión del código reparado: su objetivo era reproducir defectos ya corregidos y se conserva como evidencia histórica.
