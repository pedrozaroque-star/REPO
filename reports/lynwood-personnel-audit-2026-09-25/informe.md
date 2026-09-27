# Auditoría de registros laborales — Lynwood #14

**Tacos Gavilan · Corte: 24 de septiembre de 2026 · Consulta: 25 de septiembre de 2026.**

**Conclusión:** los registros justifican revisar la asignación de días y las extensiones de jornada de Joseph Castellanos. No demuestran que Carlos Velazquez haya pagado horas no trabajadas, contratado por vínculos personales o desplazado a los empleados anteriores para favorecerlo. La señal más clara es la continuidad de trabajo y la diferencia frente al horario guardado, con una limitación decisiva: el planificador genera turnos desde la asistencia y no conserva aquí un historial de autorizaciones anterior a cada jornada.

## 1. Resultado ejecutivo

- Joseph tiene **483.77 horas en RONOS** del 20-jul al 20-sep: 360.00 regulares, 116.78 OT y 6.99 double time. Promedio de **53.75 h/semana**. Toast registra 484.22 h para las mismas nueve semanas; diferencia neta de **0.45 h (27 minutos)**. Las fuentes corroboran tiempo registrado, no certifican por sí solas presencia física ni pago efectivo.
- **Cinco recibos Simplify HR en estado approved suman $9,280.63 brutos y 483.77 h**, coincidentes por categoría y período con RONOS. No hay horas adicionales en esos recibos respecto a las tarjetas. Approved acredita un recibo aprobado, no la liquidación bancaria ni la presencia física. Se verificó la identidad por assignmentId **SHR000584**, userId y siteId.
- Trabajó **59 de 63 días**, seis o siete días en todas las semanas; **cinco semanas de siete días**. Toast muestra una racha de **27 días consecutivos, 31-jul a 26-ago**, corroborada dentro de las tarjetas RONOS consultadas, y otra de **21 días, 4 a 24-sep**, cuyos últimos cuatro días solo se contrastaron con Toast.
- Los turnos de Joseph guardados suman **423.00 h publicadas + 22.50 h en tres borradores automáticos = 445.50 h**. La diferencia RONOS es **+60.77 h frente a publicados** o **+38.27 h frente a todos los registros**. Ninguna cifra equivale automáticamente a horas no autorizadas o regaladas: faltan versiones históricas del horario y autorizaciones de cobertura.
- Joseph ocupa el **tercer lugar en horas Toast del grupo Prep** en esas nueve semanas. Jonathan Velasco acumula 526.76 h y Jose Martinez 485.34 h, frente a sus 484.22 h. Su tarifa Toast es **$16.90/h**, compartida con varios compañeros. No aparece una prima salarial exclusiva.
- La tienda aumentó ventas **4.13%**, pero horas de labor **7.97%**, frente a las nueve semanas anteriores. El labor pasó de **19.12% a 19.65%** y ventas/hora de **$103.75 a $100.05**. Sin embargo, frente al mismo tramo de días de semana de 2025, las ventas subieron **17.09%** y el labor mejoró de **21.50% a 19.65%**. No es correcto presentar un deterioro general sin mostrar ambos comparadores.
- Las extensiones no carecen siempre de contexto: el 19-ago y el 13-sep había compañeros programados sin ponchadas tanto en Toast como en las consultas RONOS realizadas. Esto es compatible con coberturas, aunque no acredita quién las pidió ni por qué se eligió a Joseph.

## 2. Alcance, identidad y calidad de evidencia

Se extrajeron **50,315 ponchadas**, **6,283 turnos**, **2,459 días de ventas** y **3,971 tarjetas semanales RONOS** de Lynwood, más 18 presupuestos, 82 proyecciones disponibles y los catálogos necesarios. Los conteos de las tres tablas principales coinciden exactamente con SELECT COUNT en Supabase. También se consultaron en vivo las **nueve tarjetas activas de Joseph**, con **240 ponchadas atómicas**, su semana anterior sin horas para completar la primera quincena, cuatro tarjetas de compañeros para verificar días sin actividad, **tres perfiles únicos de Simplify HR** y **cinco recibos**.

El análisis histórico principal comienza el **1-ene-2023**, primera ponchada de Enrique en el historial; la comparación contemporánea usa dos periodos completos de 63 días. Los registros más antiguos de 2021–2022 contienen horas nulas y se conservaron como evidencia, pero no se usan para comparar productividad o conducta. No se filtraron empleados dados de baja, para no borrar la historia de los Alexander y Enrique.

Identidades: Lynwood es store_id interno **14**, Toast restaurant **80a1ec95-bc73-402e-8884-e5abbe9343e6**, RONOS company **34**. El usuario interno **25** tiene nombre **Carlos Velazquez**, rol **manager**, sucursal **14**, y coincide con el Toast GUID de Carlos en Lynwood. Simplify HR conserva un evento de cambio a **Site Manager con fecha efectiva 27-ago-2024**, creado ese mismo día. También contiene ajustes administrativos posteriores retroactivos al 1-ene-2024; por ello no se afirma que el 27-ago sea necesariamente su primer día real como gerente. No se le atribuyen automáticamente todos los resultados anteriores.

Joseph: empleado Toast **dd2a7df2-a301-4f2b-9d37-5e246b873adb**, GUID **847e0b09-099e-4e9a-aaf5-20f51944b759**; candidato inequívoco por nombre y concordancia diaria en RONOS **employeeUserId 37548 / employeeId 36848 / assignment SHR000584**. No existe un mapeo manual Joseph en la tabla de mappings consultada; la conciliación entre sistemas se apoya en sucursal, nombre exacto, fechas y ponchadas concordantes.

## 3. Línea de tiempo comprobada

| Fecha | Hecho observado | Interpretación permitida |
| --- | --- | --- |
| 2023-01-01 | Primera ponchada de Enrique Navarrete | Inicio del historial observado; no equivale por sí solo a fecha de contratación. |
| 2023-07-25 | Enrique empieza a registrar Shift Leader | Cambio de puesto en ponchadas. |
| 2023-09-25 | Primera ponchada de Enrique como Asst Manager | Desde aquí queda documentado el rol de asistente. |
| 2023-10-16 | Creación de la ficha Toast de Carlos en Lynwood | Fecha técnica; no prueba nombramiento ni presencia física. |
| 2024-04-19 | Primera ponchada Alexander Suarez, Prep | Alta observada en la operación. |
| 2024-08-27 | Evento HR de Carlos: Updated to site manager | Cambio registrado ese día; existen ajustes retroactivos posteriores que deben conservarse como contexto. |
| 2024-09-09 | Primera ponchada Alexander Villarreal, Prep | Enrique y ambos Alexander coinciden desde esta fecha. |
| 2025-09-21 | Última ponchada Alexander Suarez | Su baja técnica Toast se registra posteriormente: 14-dic-2025 UTC. |
| 2026-04-24 | Última ponchada Alexander Villarreal | Todavía existen turnos guardados hasta 3-may; baja técnica 10-may-2026 UTC. |
| 2026-07-14 | Última ponchada Enrique Navarrete | Baja técnica 27-jul UTC; no consta motivo de salida. |
| 2026-07-17 | HireDate y creación de perfil HR de Joseph | Cuenta creadora de Cingular HR; no identifica quién decidió o solicitó contratarlo. |
| 2026-07-20 | Primera ponchada Joseph Castellanos, Prep | Seis días después de la última actividad de Enrique; rol diferente. |
| 2026-07-31 a 2026-08-26 | Joseph registra 27 días seguidos | Señal de concentración de días; no prueba favoritismo ni infracción jurídica por sí sola. |
| 2026-08-13 y 2026-08-20 | Turnos Joseph en draft auto-generados desde ponchadas | No deben contarse como aprobación previa. |
| 2026-09-07 a 2026-09-13 | Joseph llega a 67.56 h RONOS | 22.13 OT + 5.43 DT; semana de mayor carga. |
| 2026-09-17 y 2026-09-24 | Otros turnos draft auto-generados | El 24-sep queda fuera de las nueve semanas cerradas. |
| 2026-09-24 | Último día completo de Toast incluido | Semana 21–27 sep parcial: no se mezcla con las nueve semanas cerradas. |

**Joseph no coincide en ponchadas con Enrique ni con los dos Alexander.** Las salidas de Suarez y Villarreal preceden por meses su primera actividad. La secuencia no acredita una sustitución dirigida por amistad; requeriría expedientes de contratación, salida y autorizaciones. La ausencia posterior de ponchadas tampoco demuestra despido: puede representar baja, traslado u otra situación.

## 4. Comparación histórica con los empleados anteriores

| Empleado | Primera / última ponchada | Horas del historial | Promedio por semana con actividad* | Máxima semana Toast |
| --- | --- | --- | --- | --- |
| Enrique Navarrete | 2023-01-01 / 2026-07-14 | 8,793.45 | 48.02 | 66.13 |
| Alexander Suarez | 2024-04-19 / 2025-09-21 | 3,394.28 | 45.26 | 79.98 |
| Alexander Villarreal | 2024-09-09 / 2026-04-24 | 3,713.28 | 43.69 | 65.12 |
| Joseph Castellanos | 2026-07-20 / 2026-09-24 | 513.45 | 53.80 | 67.56 |

*Los anteriores usan semanas con actividad, incluyendo semanas parciales de entrada/salida; Joseph usa nueve semanas cerradas para su promedio y hasta 24-sep para el total histórico de 513.45 h. Son comparaciones descriptivas, no pares equivalentes de demanda, disponibilidad o antigüedad. Enrique fue asistente, mientras Joseph y los Alexander están registrados como Prep; no se equiparan responsabilidades. El inicio de la semana de 26-dic-2022 de Enrique está fuera del resumen semanal histórico, pero sus 6.60 h del 1-ene-2023 sí están incluidas en el total histórico.*

En sus primeras nueve semanas con actividad, Suarez promedió **40.96 h** y Villarreal **41.92 h** frente a **53.80 h Toast** de Joseph. La diferencia es visible, pero sus ingresos ocurrieron en años con otra demanda. Además, Suarez alcanzó una semana de **79.98 h** y Villarreal una de **65.12 h**: el uso de semanas extensas ya existía antes de Joseph.

Las últimas nueve semanas con actividad previas a la semana final arrojan 48.04 h/semana para Suarez, 36.57 para Villarreal y 45.95 para Enrique. No se atribuye el descenso de Villarreal a una decisión del manager sin disponibilidad, ausencias y motivos de salida. El anexo conserva cada semana para evitar conclusiones basadas solamente en promedios.

## 5. Joseph semana por semana: RONOS directo y horario guardado

| Semana lunes | Días | Publicadas h | Draft h | RONOS h | OT | DT | Toast h | Ventas tienda | Labor tienda |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-07-20 | 6 | 45.00 | 0.00 | 44.38 | 4.38 | 0.00 | 44.41 | $124,453.14 | 19.90% |
| 2026-07-27 | 6 | 45.00 | 0.00 | 45.93 | 5.93 | 0.00 | 45.99 | $130,214.88 | 18.93% |
| 2026-08-03 | 7 | 52.50 | 0.00 | 60.95 | 19.42 | 1.53 | 60.93 | $131,589.45 | 18.12% |
| 2026-08-10 | 7 | 45.50 | 7.50 | 58.20 | 18.20 | 0.00 | 58.18 | $123,912.58 | 20.29% |
| 2026-08-17 | 7 | 45.50 | 7.50 | 59.83 | 19.80 | 0.03 | 60.39 | $122,249.93 | 20.68% |
| 2026-08-24 | 6 | 45.50 | 0.00 | 49.81 | 9.81 | 0.00 | 49.61 | $130,514.53 | 19.58% |
| 2026-08-31 | 6 | 45.50 | 0.00 | 45.89 | 5.89 | 0.00 | 45.89 | $123,014.86 | 20.26% |
| 2026-09-07 | 7 | 53.00 | 0.00 | 67.56 | 22.13 | 5.43 | 67.56 | $131,506.40 | 19.72% |
| 2026-09-14 | 7 | 45.50 | 7.50 | 51.22 | 11.22 | 0.00 | 51.26 | $123,593.21 | 19.51% |

Total: **483.77 h RONOS**, 360.00 regulares + 116.78 OT + 6.99 DT. Todas las nueve tarjetas devuelven employeeApproval=true y managerApproval=true; el campo semanal no identifica al aprobador. Ninguna devuelve hasRetroHours=true. Estos flags no sustituyen recibos de nómina ni certifican quién realizó cada autorización.

**Precaución sobre el horario:** existen tres borradores automáticos en este periodo, los jueves **13-ago, 20-ago y 17-sep**, de 7.50 h estimadas cada uno. Además, nueve turnos publicados conservan la nota de auto-generación, algunos posiblemente clonados; cuatro publicados se crearon después de su hora de inicio. Por tanto, incluso published no equivale necesariamente a una versión aprobada y congelada antes del turno. La diferencia de 60.77 h mide contra el estado publicado consultado, no una cantidad demostrada de horas indebidas.

El costo salarial **estimado** con tarifa Toast constante $16.90/h y categorías RONOS es **$9,280.64**, de los que **$1,104.92** son el recargo OT/DT sobre pagar esas mismas horas a tarifa base. No es pérdida, factura ni pago comprobado; excluye impuestos, beneficios, markup y cualquier ajuste de nómina. La cifra documental aprobada se concilia a continuación.

### Conciliación con cinco recibos aprobados de Simplify HR

| Período | Regulares h | OT h | DT h | Total horas | Bruto aprobado | Estado |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-07-13 a 2026-07-26 | 40.00 | 4.38 | 0.00 | 44.38 | $787.03 | approved |
| 2026-07-27 a 2026-08-09 | 80.00 | 25.35 | 1.53 | 106.88 | $2,046.34 | approved |
| 2026-08-10 a 2026-08-23 | 80.00 | 38.00 | 0.03 | 118.03 | $2,316.31 | approved |
| 2026-08-24 a 2026-09-06 | 80.00 | 15.70 | 0.00 | 95.70 | $1,749.99 | approved |
| 2026-09-07 a 2026-09-20 | 80.00 | 33.35 | 5.43 | 118.78 | $2,380.96 | approved |

**Total documental aprobado: $9,280.63 y 483.77 h.** Todos los recibos corresponden a assignmentId SHR000584 y al userId de Joseph en el mismo site de Lynwood. Coinciden las horas por categoría con las dos tarjetas RONOS de cada quincena; la semana 13–19 jul se consultó en vivo y tiene cero horas. Las partidas de cada recibo suman exactamente su bruto. La quincena 24-ago–6-sep presenta **−$0.01** respecto a multiplicar las unidades por las tarifas y redondear al final; se conserva como diferencia de redondeo, no horas faltantes o sobrantes. Los demás periodos concilian al centavo bajo ese cálculo.

La estimación agregada $9,280.64 y el total de recibos $9,280.63 difieren un centavo por redondeo. El estado recibido es **approved**, no paid; no se verificó liquidación bancaria. Las referencias invoiceId están conservadas, pero el monto facturado de Cingular HR, impuestos y markup no se certifican solo con esos identificadores.

## 6. Comparación con cocineros contemporáneos

Todos los siguientes registros están bajo el mismo job GUID **Prep**. No se conoce estación específica, productividad individual ni disponibilidad contractual; compartir job no hace intercambiables a todas las personas.

| Empleado | Semanas activas | Toast h | Promedio/semana activa | Días | Semanas 7 días | Publicadas h | Draft h |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Jonathan Velasco | 9 | 526.76 | 58.53 | 55 | 3 | 500.50 | 26.54 |
| Jose Martinez | 9 | 485.34 | 53.93 | 53 | 1 | 504.00 | 7.68 |
| Joseph Castellanos | 9 | 484.22 | 53.80 | 59 | 5 | 423.00 | 22.50 |
| Elias Morales | 9 | 481.43 | 53.49 | 52 | 0 | 495.00 | 0.00 |
| Jose Andres Morales | 9 | 441.98 | 49.11 | 48 | 0 | 452.50 | 0.00 |
| Benjamin Chay | 9 | 420.25 | 46.69 | 54 | 0 | 417.00 | 0.00 |
| Kevin Garcia | 9 | 415.40 | 46.16 | 52 | 2 | 422.50 | 0.00 |
| Alberto Benitez | 9 | 398.39 | 44.27 | 55 | 1 | 406.50 | 0.00 |
| Miguel Perez | 9 | 367.69 | 40.85 | 51 | 0 | 378.50 | 0.00 |
| Luis Heredia | 6 | 278.25 | 46.37 | 37 | 2 | 227.50 | 52.50 |
| Librado Mondragon | 7 | 248.61 | 35.52 | 40 | 0 | 232.00 | 0.00 |
| Fernando Lacayo Cisne | 5 | 182.38 | 36.48 | 24 | 0 | 175.50 | 37.50 |
| Denis Sanchez | 2 | 67.86 | 33.93 | 9 | 0 | 90.50 | 37.53 |

Joseph tiene más semanas de siete días que los compañeros de este grupo en el periodo, pero no lidera las horas totales. Frente a todos los turnos guardados, incluyendo drafts, la diferencia de Joseph es +38.72 h Toast, frente a +3.25 de Benjamin y −0.28 de Jonathan. Esta comparación está afectada por los borradores derivados de asistencia y por versiones del horario no conservadas; se usa para localizar casos, no para certificar una violación.

## 7. Días concretos que requieren explicación operativa

| Fecha | Entrada / salida Toast, LA | RONOS h | Horario guardado neto | Diferencia RONOS | Ventas | Proyección guardada | Labor |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-09-07 | 09/07, 07:58 → 09/07, 23:00 | 13.98 | 7.50 | +6.48 | $16,633.27 | $14,147.00 | 18.33% |
| 2026-09-08 | 09/08, 08:57 → 09/08, 20:59 | 11.52 | 7.50 | +4.02 | $12,639.64 | $13,630.00 | 24.08% |
| 2026-08-19 | 08/19, 08:57 → 08/19, 22:00 | 12.03 | 7.50 | +4.53 | $14,163.29 | $13,648.00 | 18.82% |
| 2026-09-13 | 09/13, 09:02 → 09/13, 20:59 | 11.45 | 7.50 | +3.95 | $22,755.39 | $20,896.00 | 21.47% |

- **7-sep:** horario guardado 09:00–17:00; Toast 07:58–23:00, RONOS 13.98 h netas. No apareció un compañero horario publicado sin ponchadas en Toast ese día, una vez separado Carlos asalariado. Las ventas superaron la proyección guardada; aun así, la extensión necesita orden de cobertura o razón de operación. No se identificaron ponchadas manualmente añadidas ese día en RONOS.
- **8-sep:** RONOS 11.52 h frente a 7.50 del horario. Venta $12,639.64, inferior a la proyección guardada $13,630; labor 24.08%. **Jose Andres Morales** estaba programado 16:00–00:00 y no tiene ponchada Toast de ese día. La variante de nombre RONOS “Jose Andres Morales Raymundo” no tiene mapeo manual confirmado; no se fuerza la identidad. La posible cobertura debe documentarse.
- **19-ago:** RONOS 12.03 h; **Irving Saca y Cruz Victorino Castillo**, programados en PM, carecen de horas y ponchadas ese día también en consulta RONOS. Hay una explicación operativa plausible para reforzar la tarde, pendiente de autorización y función cubierta.
- **13-sep:** RONOS 11.45 h, incluyendo 3.45 DT; **Fernando Lacayo Cisne y Eliuth Alvarez**, programados, registran cero horas y cero ponchadas RONOS ese día. Fernando ya tenía su última ponchada Toast el 8-sep. Un turno desactualizado tampoco prueba una falta injustificada. Se requiere confirmar qué vacantes existían y quién aprobó cubrirlas.

No se verificaron cámaras ni presencia física. Una ponchada coherente puede representar trabajo real o requerir validación adicional; los datos por sí solos no distinguen ambas situaciones.

## 8. Ponchadas añadidas y aprobaciones: evidencia concreta

Se revisaron las **240 ponchadas atómicas RONOS** de Joseph de las nueve semanas, sin IDs duplicados. Aparecen **tres con addedPunch=true** y un cuarto registro de solicitud/aprobación del manager:

| Fecha / hora LA | Punch ID | Tipo interpretado | Añadida | Solicitante | Respondedor | Approver | Iniciales |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-07-20 09:00 | 13692559 | Entrada | No | 27590 | 27590 | 27590 | CV |
| 2026-07-21 17:03 | 13729343 | Salida | Sí | 27590 | 27590 | 0 | CV |
| 2026-08-10 12:17 | 13804925 | Inicio comida | Sí | 37548 | 68 | 27590 | JC |
| 2026-08-10 12:47 | 13804929 | Regreso comida | Sí | 37548 | 68 | 27590 | JC |

En 20-jul y 21-jul, managerRequest=true y requesterId/responderId **27590**, iniciales **CV**. El 21-jul se añadió la salida 17:03. El 10-ago, Joseph (**37548**) solicitó los dos registros de comida 12:17 y 12:47; responderId **68**, approver **27590**. Esos registros corresponden a una comida de 30 minutos; no es válido tratarlos automáticamente como adición de tiempo pagado. Los objetos de comentarios consultados tienen texto null.

**No se verificó una tabla que vincule formalmente la cuenta RONOS 27590 con Carlos.** Las iniciales CV y el contexto son indicios de identidad, no acreditación suficiente. El usuario interno TEG 25, el employeeUserId RONOS salarial 24433 y el actor 27590 pertenecen a identificadores distintos. No se confunden. Tampoco se obtuvo el valor anterior de cada ponchada, la hora en que se realizó el cambio o un motivo escrito. No puede calcularse tiempo regalado a partir de addedPunch.

No se encontraron duplicados, solapamientos, ponchadas abiertas, fechas laborales mal asignadas ni horas Toast superiores al intervalo entrada–salida en los 63 registros de Joseph. Sus horas Toast coinciden con entrada–salida menos comidas no pagadas dentro de la tolerancia de tres minutos aplicada. **Esto descarta esas anomalías aritméticas en la muestra completa de Joseph, no fraude por presencia falsa.**

## 9. Ventas, labor y productividad de Lynwood

Comparación de **nueve semanas completas / 63 días**, con nueve lunes, nueve martes, etc. Se excluye de estos comparadores la semana parcial de 21-sep.

| Indicador | 18-may–19-jul 2026 | 20-jul–20-sep 2026 | Cambio |
| --- | --- | --- | --- |
| Ventas netas | $1,095,770.81 | $1,141,048.98 | +4.13% |
| Tickets | 54,667 | 57,034 | +4.33% |
| Horas de labor (caché) | 10,562.11 | 11,404.22 | +7.97% |
| Costo labor (caché) | $209,498.56 | $224,174.21 | +7.01% |
| Labor / ventas | 19.12% | 19.65% | +0.53 puntos |
| Ventas por hora labor | $103.75 | $100.05 | -3.57% |

Mantener el porcentaje de labor del periodo previo sobre las ventas nuevas daría un costo aproximadamente **$6,018.99 menor**. Es solo un escenario proporcional: no identifica desperdicio, no mide una plantilla óptima y **no es imputable a Joseph ni a Carlos**. La demanda creció, cambió la composición del equipo y faltan criterios de cobertura y calidad de servicio.

Comparador estacional de días equivalentes, **21-jul–21-sep 2025**: ventas $974,465.34, labor 21.50%, SPLH $89.04. En 2026 ventas **+17.09%**, tickets **+11.49%**, horas **+4.21%**, labor **−1.85 puntos**, SPLH **+12.37%**. Es una comparación interanual de mismos días de semana; no controla precios, promociones, cierres o mezcla de productos.

Por día de la semana:

| Día | Ventas antes | Ventas después | Labor antes | Labor después | SPLH antes | SPLH después |
| --- | --- | --- | --- | --- | --- | --- |
| Domingo | $178,460.44 | $192,671.21 | 20.39% | 20.81% | $114.56 | $111.51 |
| Lunes | $119,371.68 | $128,901.96 | 19.35% | 19.65% | $97.85 | $95.08 |
| Martes | $126,666.07 | $129,864.98 | 19.17% | 20.02% | $96.97 | $91.26 |
| Miércoles | $131,787.20 | $133,221.05 | 18.05% | 19.74% | $104.08 | $95.32 |
| Jueves | $151,582.56 | $149,671.26 | 18.69% | 20.48% | $102.60 | $92.77 |
| Viernes | $193,743.71 | $195,028.28 | 19.04% | 19.23% | $101.75 | $99.54 |
| Sábado | $194,159.15 | $211,690.24 | 18.91% | 18.09% | $106.07 | $109.83 |

El deterioro contemporáneo de eficiencia se concentra especialmente en **miércoles y jueves**; los sábados mejoran. Esto sugiere revisar dotación por día y franja, en lugar de atribuir toda la variación a un empleado.

Presupuestos: las nueve semanas posteriores suman **$1,072,244.00 de proyección guardada**, contra $1,141,048.98 reales (**6.42% arriba**). Los 18 registros de weekly_budgets tienen **labor_target=null**: no hay un objetivo explícito guardado en ese campo para declarar incumplimiento. Las proyecciones son la versión actualmente conservada, algunas actualizadas durante la semana, no snapshots ex ante. Se sumó solo cada fecha de su semana; varios JSON también contienen fechas de semanas vecinas, que se excluyeron para evitar doble conteo.

## 10. Composición de horas y altas observadas

| Puesto registrado | Horas antes | Horas después | Cambio |
| --- | --- | --- | --- |
| Prep | 3,651.09 | 4,798.56 | +1,147.47 |
| Cashier | 3,582.03 | 3,533.37 | -48.66 |
| Shift Leader | 2,499.13 | 2,248.54 | -250.59 |
| Asst Manager | 867.25 | 835.05 | -32.20 |
| Sin puesto | 7.85 | 0.00 | -7.85 |

Prep pasó de 3,651.09 a 4,798.56 h (**+31.43%**); Shift Leader bajó 250.59 h, Asst Manager 32.20 h y Cashier 48.66 h. Parte puede ser cambio de clasificación del trabajo, entradas, regresos y salidas. La caída de horas de Enrique no se traslada de forma uno a uno a un puesto equivalente de Joseph.

| Empleado | Horas antes | Horas después | Diferencia |
| --- | --- | --- | --- |
| Joseph Castellanos | 0.00 | 484.22 | +484.22 |
| Luis Heredia | 0.00 | 278.25 | +278.25 |
| Librado Mondragon | 0.00 | 248.61 | +248.61 |
| Fernando Lacayo Cisne | 0.00 | 182.38 | +182.38 |
| Benjamin Chay | 251.94 | 420.25 | +168.31 |
| Maria Gonzalez | 245.14 | 386.59 | +141.45 |
| Denis Sanchez | 0.00 | 67.86 | +67.86 |
| Martha Lemus | 346.53 | 377.55 | +31.02 |
| Jose Andres Morales | 412.47 | 441.98 | +29.51 |
| Heidy Rodarte | 275.68 | 296.35 | +20.67 |
| Elias Morales | 461.56 | 481.43 | +19.87 |
| Miguel Perez | 351.92 | 367.69 | +15.77 |
| Jennifer Ortiz | 306.37 | 318.54 | +12.17 |
| Alberto Benitez | 396.04 | 398.39 | +2.35 |
| Victor Muñoz | 402.80 | 404.64 | +1.84 |
| Brenda Flores | 476.53 | 477.59 | +1.06 |
| Maritza Avilez | 310.32 | 310.64 | +0.32 |
| Blanca Zarat | 438.36 | 438.47 | +0.11 |
| Sugey Reyes | 472.08 | 469.40 | -2.68 |
| Jose Martinez | 490.96 | 485.34 | -5.62 |
| Cruz Victorino Castillo | 488.68 | 482.96 | -5.72 |
| Cristian Ajeataz | 467.69 | 457.57 | -10.12 |
| Maria T Alejandre | 329.74 | 319.47 | -10.27 |
| Eliuth Alvarez | 287.94 | 273.65 | -14.29 |
| Maria Tapia | 379.50 | 364.05 | -15.45 |
| Carlos Arteaga | 514.06 | 495.08 | -18.98 |
| Irving Saca | 378.39 | 354.26 | -24.13 |
| Jazmin Balcazar | 28.11 | 0.00 | -28.11 |
| Valentina Valladares | 421.92 | 390.15 | -31.77 |
| Jonathan Velasco | 560.25 | 526.76 | -33.49 |
| Jose Morales | 66.96 | 0.00 | -66.96 |
| Kevin Garcia | 484.84 | 415.40 | -69.44 |
| Luis Martinez | 182.00 | 0.00 | -182.00 |
| Enrique Navarrete | 378.57 | 0.00 | -378.57 |

Primeras ponchadas observadas en 2026, desde abril:

| Nombre | Primera ponchada | Última al corte | Horas acumuladas al corte |
| --- | --- | --- | --- |
| Maria Lua Sanchez | 2026-05-08 | 2026-05-08 | 6.48 |
| Melody Reyes | 2026-05-11 | 2026-05-11 | 7.49 |
| Kevin Garcia | 2026-05-13 | 2026-09-24 | 969.06 |
| Jazmin Balcazar | 2026-05-25 | 2026-05-28 | 28.11 |
| Luis Martinez | 2026-05-28 | 2026-06-25 | 182.00 |
| Maria Gonzalez | 2026-06-04 | 2026-09-24 | 655.96 |
| Benjamin Chay | 2026-06-13 | 2026-09-24 | 690.53 |
| Joseph Castellanos | 2026-07-20 | 2026-09-24 | 513.45 |
| Denis Sanchez | 2026-07-29 | 2026-08-06 | 67.86 |
| Luis Heredia | 2026-08-10 | 2026-09-24 | 306.81 |
| Fernando Lacayo Cisne | 2026-08-12 | 2026-09-08 | 182.38 |
| Adrian Hernandez | 2026-09-22 | 2026-09-24 | 23.09 |

Esta lista refleja actividad observada, **no atribuye a Carlos contrataciones, parentesco ni amistad**. Puede incluir reingresos, pruebas o transferencias. Librado Mondragon reaparece en el periodo comparado pero tiene historia anterior: no se cuenta como contratación nueva. No se halló evidencia de quién solicitó, entrevistó o decidió cada contratación. La captura administrativa de algunas fichas sí queda identificada en HR, como se detalla enseguida.

### Historial de Recursos Humanos y discrepancias de catálogo

- **Joseph:** Simplify HR registra hireDate **17-jul-2026**, perfil creado el mismo día por una cuenta de **Malena, Cingular HR**; puesto **Cashier**, jornada FullTime, tarifa **$16.90/h**, OT **$25.35/h**, una entrada de empleo y una de compensación. RONOS comparte assignmentId **SHR000584** con HR y recibos. Toast registra sus 63 ponchadas como **Prep**. Es una discrepancia de puesto que necesita corrección o explicación; no se debe asumir que hace caja por la ficha HR ni que la captura por HR demuestra quién eligió al candidato.
- **Carlos:** HR lo identifica como **Site Manager / Manager**, pago **Yearly**, y conserva el evento de cambio a Site Manager del **27-ago-2024**, más ajustes de migración/corrección creados en 2026 y retroactivos a 2024. Esto confirma la clasificación salarial y advierte que fechas efectivas no siempre son fechas de captura o inicio real.
- **Enrique:** la ficha HR consultada sigue **Active**, con hireDate **13-jul-2026**, creada **28-jul-2026**, puesto **pre cook**, tarifa **$22.40/h** y assignmentId **SHR000654**. Esto contradice una lectura literal de “contratación nueva”: Toast conserva actividad desde 2023, puesto Asst Manager desde septiembre 2023 y última ponchada 14-jul-2026. Se trata de registros incompatibles en fecha/estado/puesto que requieren conciliación administrativa; no se infiere la causa ni se reemplaza el historial antiguo por esa ficha.
- Las consultas HR con active=true y active=false devolvieron los mismos tres perfiles objetivo (duplicados entre ambas consultas). Se deduplicaron por ID para interpretar los resultados. Los Alexander no aparecieron en esas respuestas; **no se considera certificado un padrón completo de inactivos** ni se infiere que no tengan expediente antiguo.

## 11. Tendencia mensual completa

Septiembre 2026 es parcial, 1–24; no se compara su total con un mes entero. Los totales de labor son los de sales_daily_cache, no nómina pagada. Días cerrados o sin labor se conservan sin dividir entre cero. Algunos días históricos tienen cero labor; el informe no presume que el negocio operó normalmente esos días.

| Mes | Días | Ventas | Labor % | SPLH | Enrique h | Suarez h | Villarreal h | Joseph h |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2023-01 | 31 | $498,752.30 | 20.36% | $73.66 | 230.86 | 0.00 | 0.00 | 0.00 |
| 2023-02 | 28 | $464,210.45 | 19.25% | $74.16 | 205.83 | 0.00 | 0.00 | 0.00 |
| 2023-03 | 31 | $505,825.19 | 19.45% | $74.68 | 255.61 | 0.00 | 0.00 | 0.00 |
| 2023-04 | 30 | $475,504.58 | 21.82% | $75.88 | 213.49 | 0.00 | 0.00 | 0.00 |
| 2023-05 | 31 | $483,955.78 | 22.53% | $76.20 | 204.55 | 0.00 | 0.00 | 0.00 |
| 2023-06 | 30 | $477,709.13 | 21.92% | $78.63 | 217.33 | 0.00 | 0.00 | 0.00 |
| 2023-07 | 31 | $508,673.85 | 22.28% | $79.47 | 248.84 | 0.00 | 0.00 | 0.00 |
| 2023-08 | 31 | $508,970.26 | 22.13% | $82.18 | 216.78 | 0.00 | 0.00 | 0.00 |
| 2023-09 | 30 | $517,008.17 | 22.12% | $78.81 | 211.66 | 0.00 | 0.00 | 0.00 |
| 2023-10 | 31 | $549,324.91 | 21.65% | $82.19 | 225.86 | 0.00 | 0.00 | 0.00 |
| 2023-11 | 30 | $523,139.33 | 14,874.55% | $0.12 | 227.67 | 0.00 | 0.00 | 0.00 |
| 2023-12 | 31 | $546,176.10 | 20.51% | $84.91 | 228.83 | 0.00 | 0.00 | 0.00 |
| 2024-01 | 31 | $507,758.89 | 22.81% | $78.27 | 214.96 | 0.00 | 0.00 | 0.00 |
| 2024-02 | 29 | $500,481.96 | 21.44% | $85.39 | 195.75 | 0.00 | 0.00 | 0.00 |
| 2024-03 | 31 | $522,546.17 | 20.51% | $89.20 | 161.40 | 0.00 | 0.00 | 0.00 |
| 2024-04 | 30 | $504,014.82 | 22.55% | $82.56 | 221.54 | 73.13 | 0.00 | 0.00 |
| 2024-05 | 31 | $529,168.45 | 22.72% | $82.01 | 230.42 | 181.63 | 0.00 | 0.00 |
| 2024-06 | 30 | $527,464.14 | 22.34% | $84.52 | 232.51 | 204.98 | 0.00 | 0.00 |
| 2024-07 | 31 | $547,654.73 | 21.55% | $87.59 | 226.30 | 237.44 | 0.00 | 0.00 |
| 2024-08 | 31 | $548,833.39 | 22.05% | $85.80 | 218.22 | 196.07 | 0.00 | 0.00 |
| 2024-09 | 30 | $499,260.54 | 23.66% | $79.91 | 224.78 | 211.58 | 121.50 | 0.00 |
| 2024-10 | 31 | $509,760.66 | 22.03% | $83.71 | 204.07 | 194.11 | 187.69 | 0.00 |
| 2024-11 | 30 | $499,384.70 | 2,480.21% | $0.72 | 162.03 | 195.37 | 191.14 | 0.00 |
| 2024-12 | 31 | $515,231.13 | 19.87% | $93.46 | 221.93 | 210.42 | 166.09 | 0.00 |
| 2025-01 | 31 | $483,911.15 | 22.13% | $85.80 | 206.23 | 198.61 | 199.19 | 0.00 |
| 2025-02 | 28 | $459,549.50 | 20.60% | $92.21 | 200.21 | 178.06 | 166.50 | 0.00 |
| 2025-03 | 31 | $499,763.28 | 21.37% | $90.29 | 209.16 | 209.08 | 215.90 | 0.00 |
| 2025-04 | 30 | $460,692.79 | 21.46% | $88.63 | 208.01 | 166.70 | 175.17 | 0.00 |
| 2025-05 | 31 | $487,747.71 | 22.11% | $86.51 | 227.12 | 183.03 | 196.89 | 0.00 |
| 2025-06 | 30 | $446,142.91 | 22.84% | $82.12 | 203.60 | 181.46 | 192.27 | 0.00 |
| 2025-07 | 31 | $459,717.58 | 22.55% | $84.29 | 212.38 | 188.21 | 205.87 | 0.00 |
| 2025-08 | 31 | $489,950.32 | 21.53% | $89.24 | 147.43 | 224.96 | 254.14 | 0.00 |
| 2025-09 | 30 | $458,787.40 | 20.99% | $91.16 | 198.23 | 159.44 | 217.06 | 0.00 |
| 2025-10 | 31 | $492,323.95 | 20.18% | $95.27 | 235.44 | 0.00 | 152.01 | 0.00 |
| 2025-11 | 30 | $481,602.06 | 20.82% | $92.18 | 144.36 | 0.00 | 229.02 | 0.00 |
| 2025-12 | 31 | $496,952.67 | 19.71% | $94.48 | 183.79 | 0.00 | 200.10 | 0.00 |
| 2026-01 | 31 | $482,559.14 | 20.61% | $89.62 | 208.12 | 0.00 | 194.16 | 0.00 |
| 2026-02 | 28 | $447,465.68 | 20.39% | $96.55 | 159.41 | 0.00 | 175.24 | 0.00 |
| 2026-03 | 31 | $510,137.47 | 18.72% | $104.26 | 173.57 | 0.00 | 162.73 | 0.00 |
| 2026-04 | 30 | $489,216.24 | 19.18% | $101.13 | 181.81 | 0.00 | 110.61 | 0.00 |
| 2026-05 | 31 | $540,661.91 | 19.40% | $103.65 | 208.13 | 0.00 | 0.00 | 0.00 |
| 2026-06 | 30 | $520,100.98 | 18.97% | $103.67 | 195.45 | 0.00 | 0.00 | 0.00 |
| 2026-07 | 31 | $541,407.75 | 19.47% | $102.12 | 89.78 | 0.00 | 0.00 | 74.62 |
| 2026-08 | 31 | $570,771.80 | 19.49% | $100.39 | 0.00 | 0.00 | 0.00 | 252.49 |
| 2026-09 | 24 | $421,817.07 | 19.95% | $98.78 | 0.00 | 0.00 | 0.00 | 186.34 |

## 12. Límites que cambian el dictamen

1. **Recibos aprobados no equivalen a liquidación bancaria ni presencia.** Se conciliaron cinco paystubs approved con RONOS y se consultaron perfiles HR. No se verificaron liquidación bancaria, monto total de invoices, expedientes de selección/contratación, cámaras, disponibilidad o testimonios. Las horas concilian, pero la presencia física y la intención de favorecer no quedan demostradas.
2. **Horarios sin versión histórica ni autor.** shifts no contiene created_by/updated_by; activity_logs tiene 15 entradas globales y ninguna para user_id 25. La ausencia de log no demuestra ausencia de cambios. El planificador auto-genera drafts desde ponchadas y puede publicarlos después.
3. **Horas extra de Toast y RONOS no son categorías idénticas.** punches guarda regular_hours y overtime_hours, sin columna DT. Joseph tiene 124.22 h en el campo OT Toast, frente a 116.78 OT + 6.99 DT RONOS. Se usa RONOS para separar categorías y estimar recargos; no se añade DT nuevamente al total Toast.
4. **Caché de labor independiente.** Del 20-jul al 20-sep, las ponchadas suman 11,415.52 h frente a 11,404.22 del caché: **11.30 h de diferencia**. En el periodo previo son 45.24 h. No se fuerza igualdad ni se atribuyen esas diferencias al manager. El código del caché tiene su propio tratamiento de paidHours y DT, por lo que el costo de labor es indicativo.
5. **Historia incompleta de breaks y salario.** En 2023–2025 los breaks están ausentes de la extracción; hay tasas nulas en algunos registros históricos. Se pueden sumar las horas registradas, pero no verificar cada comida ni reconstruir con certeza toda la nómina antigua. En 2026 sí existen breaks y Joseph no tiene anomalías de duración.
6. **Carlos asalariado.** No tiene ponchadas Toast en Lynwood, pero sí turnos y tarjetas RONOS. No se interpreta como cero trabajo ni como ausencias. El labor Toast no certifica que incluya salario de gerencia, cargas patronales o costo facturado total.
7. **Identidad de actores.** La cuenta RONOS 27590, iniciales CV, requiere enlace formal a persona. Nombre o iniciales aislados no bastan para imputación.
8. **Causalidad y equidad.** No se conocen solicitudes de más horas, competencias, estación, antigüedad contractual, capacitación ni disponibilidad. Las comparaciones no estiman el efecto causal de una preferencia del manager.
9. **Corte de RONOS distinto al documentado en TEG.** Las tarjetas RONOS directas delimitan las semanas desde lunes **05:30** hasta el siguiente lunes **05:29:59**, mientras TEG documenta 06:00. Para la conciliación se usaron los días de cada tarjeta y las semanas de nómina; ninguna entrada de Joseph cae en 05:30–05:59. La diferencia de corte no cambia sus horas comparadas.

## 13. Cierre de investigación propuesto

La revisión humana debe concentrarse en evidencia concreta:

- Confirmar la identidad RONOS **27590** y exportar el historial anterior/posterior y motivo de **approvalIds 2390268, 2394769, 2406255 y 2406258**. Preservar las evidencias antes de cualquier corrección.
- Obtener la autorización de trabajo de los **jueves 13-ago, 20-ago, 17-sep y 24-sep** y de las extensiones **7-sep, 8-sep, 19-ago y 13-sep**. Preguntar qué puesto cubrió, quién faltó y qué alternativas había.
- Revisar con el mismo criterio a **Jonathan Velasco, Jose Martinez y Elias Morales**, que también acumulan cargas altas. Confirmar disponibilidad y rotación de días de descanso para todos.
- Confirmar la liquidación de los **cinco recibos approved ya conciliados**, y contrastar las fechas seleccionadas con evidencia de presencia y operación. No solicitar reintegros ni tomar medidas disciplinarias únicamente con estos indicadores.
- Obtener los expedientes de salida de Enrique y los Alexander y de incorporación de Joseph; verificar fechas, solicitante, aprobador y razones. Esto responde la hipótesis de contratación preferencial, que los registros de horas no resuelven.
- Evaluar dotación de **miércoles y jueves** y preservar versiones de horarios publicadas con autor, fecha, motivo de extensión y estado previo/posterior.

**Dictamen limitado a los registros consultados:** concentración elevada de días y extensiones documentables; control insuficiente de historial de horarios; algunas correcciones de ponchadas identificadas. **Favoritismo, contratación por relación personal y pago de horas no trabajadas: no acreditados con esta evidencia.**

## 14. Reproducibilidad y archivos

Toda la consulta fue de lectura: SELECT en Supabase, autenticación RONOS/Simplify HR y sus endpoints de consulta. No se alteraron empleados, horarios, ponchadas, ventas ni nómina; no se hizo commit o push. Los scripts de cálculo y las evidencias se guardaron localmente.

Validaciones ejecutadas: conteos remotos contra descarga paginada, IDs únicos, conciliación diaria/semanal RONOS, sumas regulares/OT/DT, identidad y partidas de cinco recibos approved, mapa tienda/empleado/puesto, fechas 05:59/06:00, 16:59/17:00, medianoche, cambios DST, acentos, nulos y división por cero. También se ejecutaron helpers reales de duración y evidencia de nómina del sistema sobre los registros extraídos. Todas finalizaron **PASS**. **npx tsc --noEmit** terminó sin errores. Estas verificaciones certifican consistencia del cálculo, no veracidad material de asistencia.

Archivos en esta misma carpeta: **anexo-semanal.md** (semanas históricas de los cuatro empleados), **anexo-diario-joseph.md** (63 jornadas, estados de horario y horas de cada fuente), **analysis.json**, **context-analysis.json**, **report-metrics.json**, **count-validation.json**, **validation.json**, **live-validation.json**, **ronos-joseph-live.json**, **coverage-live.json**, snapshots originales y **evidence-sha256.json**. Los JSON incluyen claves primarias para reproducir cada consulta.

Referencias de implementación que afectan la interpretación: app/planificador/page.tsx:667–735 (borradores de asistencia), app/api/reports/weekly-ops/route.ts:21–26 (duración neta programada) y :123–125 (exclusión Carlos del costo horario programado), lib/toast-labor.ts:314–349 (día laboral y campos de ponchadas), lib/toast-api.ts:999–1020 (costo del caché), lib/ronos-api.ts:1325–1390 (consulta de tarjeta individual). Se revisaron para interpretar la evidencia; este entregable no es una certificación integral del código de esos módulos.
