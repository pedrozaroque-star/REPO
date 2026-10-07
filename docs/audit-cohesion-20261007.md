# Auditoría independiente de Cohesion — Tacos Gavilan

Fecha: 7 de octubre de 2026. Conversación Antigravity: `3ca1503c-43d6-4e5a-bf06-92d9484aeac8` («Modulo Cohession»).

## Dictamen y alcance

**No se ha certificado una réplica funcional completa ni paridad con QuickBooks.** Se leyeron el historial, las extracciones originales de las nueve pestañas y el código del módulo mediante revisión paralela. Hay pruebas ejecutadas y hallazgos reproducidos, pero Antigravity sigue modificando los archivos. Los fingerprints de cada prueba identifican la versión realmente probada. No se modificó la implementación desde esta auditoría, ni se publicaron, borraron o corrigieron asientos en QuickBooks.

El último contexto leído llega a la petición del 7 de octubre de revisar la póliza completa, diseño y configuración, después de corregir los falsos positivos del Paso 11 por intentos de pago rechazados. Las afirmaciones anteriores de «100% funcional» no constituyen evidencia de aceptación.

## Hallazgos confirmados y vigentes en configuración

1. **P1 — Opciones de workflow que no se guardan.** `app/contabilidad/configuracion/page.tsx:147` declara seis estados independientes: cuenta de descuentos, inclusión de cuentas por cobrar, nombre del cliente en memo, revenue center en memo, validación de comisiones y validación de órdenes abiertas. `handleSave`, línea 283, envía `formData` y `store_id`; esos estados no entran en el payload. La API `app/api/accounting/site-mappings/route.ts:60` tampoco admite campos para esas reglas. Guardar puede mostrar éxito mientras esas decisiones no quedan persistidas.

2. **P1 — Clase por renglón cambia la clase general.** Por ejemplo `app/contabilidad/configuracion/page.tsx:1567` modifica `formData.qb_class` desde el control «Class Override» de una fila. No hay asignación independiente por renglón. Además `app/api/accounting/packets/[id]/publish/route.ts:186` resuelve clase y ubicación desde `getQBStoreRefs(storeName)`, y no desde la clase/ubicación configurable de las líneas. La interfaz, el motor y el payload de publicación tienen contratos diferentes.

3. **P2 — Memos editables sin persistencia.** La prueba identificó 13 inputs con `defaultValue` sin `onChange`, entre ellos `app/contabilidad/configuracion/page.tsx:1616`. Editarlos no actualiza el payload ni el memo publicado. La publicación usa `line.sourceMemo` (`publish/route.ts:223`).

4. **P1 — Restauración inconsistente.** El botón de la página asigna Postmates a `12051` y `cc_fees_account` a `12100` en Central/Broadway (`configuracion/page.tsx:263`). La restauración POST de la API usa Postmates `12050` y comisiones `51030` en todas las tiendas (`site-mappings/route.ts:138`). Son resultados distintos. Usar la cuenta de otras deducciones como cuenta global de comisiones también necesita contrastarse con Cohesion.

5. **P2 — Evidencia original limitada a Azusa.** Los nueve JSON de `cohesion_dump/live_settings` corresponden a `siteName=AZUSA`. No prueban que las nueve pestañas tengan valores y comportamiento idénticos en las otras 14 sucursales.

## Acceso y publicación

6. **P1 — Autorización de backend ausente.** Las rutas contables usan el cliente administrador sin comprobar sesión y rol administrador. El layout visual protegido no protege las rutas. Dos handlers reales recibieron peticiones sin autenticación y llegaron a validación de negocio (400), en lugar de rechazar por autenticación. La comprobación real anónima contra Supabase devolvió 200 y conteos de 15 mappings y 739 pólizas. No se probó escritura anónima. La migración contiene políticas `FOR ALL USING (true)`; el acceso de lectura fue confirmado en vivo.

7. **P1 — Prevención de duplicados permite continuar si QBO rechaza la consulta.** `publish/route.ts:270` consulta pólizas existentes. Solo bloquea dentro de `if (dupRes.ok)`; una respuesta no exitosa permite continuar hacia el POST del asiento. No hay reserva atómica ni idempotencia para dos publicaciones simultáneas. Tras crear en QBO, un fallo del UPDATE local se registra pero devuelve éxito (`publish/route.ts:340`). Se requiere reconciliación durable del identificador remoto; no se provocó un duplicado real para demostrarlo.

8. **P1 — Fallback contable estimado.** Cuando falla la lectura granular de Toast, `app/api/accounting/packets/route.ts:216` genera cifras con proporciones fijas: 52% comedor, 70% tarjeta, 1.8% comisión y distribuciones estimadas de impuestos/delivery. El test ejecutó el bloque original y obtuvo una estimación de depósito de tarjeta de $3,134.41 frente a $2,774.70 del packet real usado. Otro caso de entrada produjo `NaN` con net sales cero. Este camino no debe certificarse como paridad real con Cohesion aunque termine balanceado.

## Defectos detectados que Antigravity está cambiando

- El detalle utilizaba `cc_gross`, `cc_deposit`, `cc_fees` y `discounts`, mientras el endpoint devolvía `total_credit_cards_gross`, `credit_card_deposit`, `credit_card_fees` y `total_discounts`. Se reprodujo la visualización de $0.00 frente a $2,774.70 real. **Una lectura posterior muestra que Antigravity ya agregó los nombres correctos y fallbacks en la página. La prueba anterior quedó desactualizada para ese archivo y requiere repetición.**
- El extractor y el journal recibieron cambios posteriores para separar Kiosk Dine In/Take Out y clasificar pagos de otras fechas. Los hashes actuales difieren de la ejecución inicial del motor. No se debe atribuir a esa ejecución cobertura de las modificaciones posteriores.
- El cron y la generación manual están cambiando la conservación del depósito previamente capturado. Es necesario repetir las verificaciones de estados y depósitos sobre una versión estable.

## Evidencia ejecutada

- Lectura real de 105 pólizas (15 sucursales × 7 fechas, 21–27 septiembre), 15 mappings y 293 cuentas del catálogo.
- `scripts/audit-cohesion-settings-20261006.ts`: reproducción exitosa de estados desconectados, override global de clase, controles sin persistencia y alcance Azusa de los dumps. Los cuatro hashes de esta evidencia seguían coincidiendo al último contraste.
- `scripts/audit-cohesion-api-20261006.ts`: 12 comprobaciones, incluyendo dos handlers reales, casos matemáticos y fechas 5:59/6:00, 16:59/17:00, medianoche y cambio de horario de noviembre. PASS significa que se reprodujeron observaciones, no que se aprobó el módulo. Hay archivos que cambiaron después.
- `scripts/audit-cohesion-engine-20261006.ts --live`: consulta real de Toast para Azusa del 21 septiembre; comprobación de finitud de valores. Reconstrucción de 105 journals desde campos persistidos. Esa reconstrucción **pierde dimensiones opcionales** y no permite certificar paridad ni atribuir sus diferencias a un bug del cálculo.
- Smoke real aislado en `accounting_sync_logs`: INSERT, SELECT, DELETE y confirmación de ausencia. **No certifica las mutaciones de packets, mappings o GL accounts.**
- TypeScript: la última ejecución falló con redeclaración de `existingPacket` en el cron (líneas 125/258), referencia a `discountsTotal` ausente del tipo (línea 304), y `fetch_schema.ts` con posible null. Antigravity estaba editando durante esta comprobación; debe repetirse tras estabilizar los archivos.

## Pendientes necesarios para cerrar la auditoría

1. Revalidar los archivos modificados y ejecutar las pruebas sobre una versión estable.
2. Completar persistencia por tienda/renglón y seguir cada regla hasta el payload de QBO.
3. Corregir autorización y políticas de acceso; eliminar la continuación insegura ante fallos de la consulta de duplicados.
4. Conectar QuickBooks: los dos intentos de consulta fallaron al renovar el token con `invalid_grant` / `Incorrect Token type or clientID`. La conexión indicada al usuario es Vercel → Contabilidad → Configuración → Reconectar QuickBooks.
5. Comparar las 105 pólizas con asientos reales de QBO por cuenta, memo, débito, crédito, clase y ubicación; después repetir contra cálculos frescos de Toast. El archivo histórico local disponible cubre enero–julio y no sustituye septiembre.

La ejecución adicional de `audit-cohesion-boundaries-20261007.ts` fue detenida porque la revisión automática de permisos no pudo completarse por el límite de uso. No se ejecutó esa simulación ni se eludió la revisión. El script queda preservado.

Los resultados y snapshots están en `docs/cohesion-audit-20261006/`; no contienen tokens de autenticación. No se realizaron commit/push ni cambios a reportes u horas.
