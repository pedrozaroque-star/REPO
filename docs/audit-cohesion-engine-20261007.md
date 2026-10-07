# Revisión motor posterior a respuesta Antigravity step6109

Lectura completa de ambos módulos y JSDoc, con segunda lectura del segmento truncado por terminal. SHA256 accounting-journal: 433252DA93B7C5845892D5029945748E72CE14E4FABB1767ECE9076C3D4F4741. SHA256 toast-accounting: 0CE25526EC8A5B5E4071473C7497333CA00E2154EC682DF6A6CC88EA08664097. Ninguna implementación modificada.

## Avances confirmados

- Kiosk Dine In y Kiosk Take Out ya tienen acumuladores, campos y líneas propias; se incluyen en net sales y cálculo de efectivo.
- Validación ahora excluye los mismos estados de pago inválidos que cálculo.
- Cross-date ahora reconoce OTHER Uber/DoorDash/GrubHub/EBT por nombre. Ya no aplica el hallazgo general de que todos los OTHER se omiten.
- Cuentas básicas configurables conectadas al motor. No corresponde afirmar que todas siguen hardcodeadas.

## Hallazgos vigentes

1. **P1, cross-date aún incompleto:** toast-accounting bloque 535–570 procesa CREDIT/CASH/delivery/EBT, pero GIFT_CARD sólo aumenta paidIn; no aumenta giftCardRedemption. El efectivo esperado absorbe el importe que realmente procede de tarjeta regalo. CREDIT cross-date no añade mcaRepaymentAmount, a diferencia de pagos de órdenes actuales. Además CREDIT precede a detección EBT, contrario a clasificador principal.
2. **P1, errores silenciosos Paid In:** lista HTTP fallida se ignora (`if (pListRes.ok)`); detalle HTTP fallido retorna; catch warning sigue devolviendo resultado. validationPassed sólo depende de órdenes, no integridad de descarga. Puede declararse lista una póliza incompleta. Inspección de código, no fallo remoto inducido.
3. **P1, refunds cross-date ausentes:** extractor consulta ordersBulk por fecha de orden y payments por paidBusinessDate, nunca refundBusinessDate. Restar refundAmount del pedido original al recalcular no acredita devolución en fecha del reembolso. Regla contradice JSDoc de toast-api; confirmar datos reales antes de aprobar paridad.
4. **P2, descuentos incluyen reembolsos:** resta rAmt de p y agrega p a checkItemNetSum; después calcula itemLevelDiscounts=checkItemGrossSum-checkItemNetSum. Todo reembolso de selección sin descuento incrementa discountsTotal. Es un error de clasificación determinado por flujo aritmético, pendiente cuantificar incidencia real.
5. **P1, penny plug con debit y credit simultáneos:** accounting-journal ajuste <=0.05 agrega al lado opuesto de línea existente sin netear. Publicador usa debit>0 ? debit : credit, por lo que una línea bilateral no representa mismo total en QBO. No se encontró caso real en muestra; riesgo concreto de rama, no reproducción completa.
6. **P2, fees estimados:** si originalProcessingFee total es cero, se imputa 1.919% de gross sin bandera de estimación. No demuestra centavo a centavo ni distingue fee real cero de dato ausente.
7. **P2, validación se aparta de regla documentada:** isCheckClosed usa closedDate OR status CLOSED; checks abiertos pagados o vacíos se permiten. JSDoc dice bloquear por closedDate nulo OR status distinto CLOSED. No puede aprobarse la equivalencia al workflow sin definir cuál regla se desea.
8. **P2, deleted y catálogo:** cálculo omite voided pero no deleted a nivel check; validación sí omite ambos. ar_postmates_account/cash_on_hand_account/cogs_account declarados pero no leídos; Postmates sigue fusionado con Uber. MCA account aún depende de nombre Broadway/Central.

## Pruebas y límites

Evidencia anterior preservada: `engine-runtime.json` contiene ejecución real exitosa de Toast Azusa 2026-09-21, 4629.57 net sales, 481.44 taxes, 1535.64 cash y cero órdenes pendientes, junto con 105 packets Supabase reales recalculados. Los 105 balanceados NO implican paridad: faltan dimensiones en columnas históricas; cinco totales distintos y cash compensatorio esconden diferencias. Es prueba del motor anterior, no aprobación de hashes actuales.

Nuevo script `scripts/audit-cohesion-engine-20261007.ts` añade live->SalesPacketData con kiosks, cálculo journal y comparación de líneas contra snapshot (NO QBO). Ejecución local falló antes de cargar lógica con `uv_os_get_passwd ENOMEM` en tsx. La solicitud previa de ejecución escalada fue bloqueada por fallo de auto-review por cuota, no por riesgo de la acción; no se evadió. Nueva prueba pendiente, por tanto revisión funcional NO aprobada.

Fechas 05:59/06:00, 16:59/17:00, medianoche/DST y nombres de días no se transforman dentro de estos dos motores: reciben businessDate. Auditor principal cubre helper de fechas. No se fabricaron fixtures, no se escribieron DB/pólizas ni QuickBooks, no commits.
