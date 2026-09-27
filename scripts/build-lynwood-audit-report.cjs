/**
 * @module build-lynwood-audit-report
 * @description Compila informe de auditoría laboral de Lynwood y anexos trazables.
 * @businessRules Hallazgos descriptivos, evidencia favorable y desfavorable; no atribuir fraude sin prueba.
 * @dataFlow Snapshots y análisis validados → Markdown y figura SVG locales.
 * @notes No modifica reportes de actividades, horas de desarrollo ni información en producción.
 */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const dir='reports/lynwood-personnel-audit-2026-09-25',read=n=>JSON.parse(fs.readFileSync(`${dir}/${n}.json`));
const a=read('analysis'),c=read('context-analysis'),shifts=read('shifts'),employees=read('employees'),punches=read('punches'),budgets=read('budgets'),live=read('ronos-joseph-live'),coverage=read('coverage-live');
const payroll=read('payroll-validation');
const money=x=>'$'+Number(x).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const n=x=>x==null?'—':Number(x).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const signed=x=>(x>0?'+':'')+n(x),sum=(arr,f)=>arr.reduce((s,x)=>s+(Number(f(x))||0),0),round=x=>Math.round(x*100)/100;
const add=(d,n)=>new Date(Date.parse(d+'T12:00:00Z')+n*864e5).toISOString().slice(0,10);
const table=(headers,rows)=>'| '+headers.join(' | ')+' |\n| '+headers.map(()=>'---').join(' | ')+' |\n'+rows.map(r=>'| '+r.map(x=>String(x??'—').replace(/\|/g,'/').replace(/\n/g,' ')).join(' | ')+' |').join('\n');
const local=t=>new Intl.DateTimeFormat('es-MX',{timeZone:'America/Los_Angeles',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(t));
const dur=s=>{let h=(Date.parse(s.end_time)-Date.parse(s.start_time))/36e5;return h>5?h-.5:Math.max(0,h);};
const josephId=a.identity.find(e=>e.name==='Joseph Castellanos').employeeId;
const js=shifts.filter(s=>s.employee_id===josephId&&s.shift_date<='2026-09-20');
const published=js.filter(s=>s.status==='published'),draft=js.filter(s=>s.status==='draft');
const publishedHours=sum(published,dur),draftHours=sum(draft,dur);
assert.equal(published.length,56);assert.equal(draft.length,3);assert.equal(publishedHours,423);assert.equal(draftHours,22.5);
const weekly=c.liveSummary.map(w=>{let ss=js.filter(s=>s.shift_date>=w.week&&s.shift_date<=add(w.week,6));return {...w,published:round(sum(ss.filter(s=>s.status==='published'),dur)),draft:round(sum(ss.filter(s=>s.status==='draft'),dur)),autoNote:ss.filter(s=>/Auto-generado/.test(s.notes||'')).length};});
const peers=a.peers.map(p=>{let e=employees.find(e=>`${e.first_name.trim()} ${e.last_name.trim()}`===p.name);let ss=shifts.filter(s=>s.employee_id===e.id&&s.shift_date>='2026-07-20'&&s.shift_date<='2026-09-20');return {...p,published:round(sum(ss.filter(s=>s.status==='published'),dur)),draft:round(sum(ss.filter(s=>s.status==='draft'),dur)),autoNotes:ss.filter(s=>/Auto-generado/.test(s.notes||'')).length};});
const weeklyBudgets=budgets.map(b=>{let entries=Object.entries(b.sales_projections||{}).filter(([date])=>date>=b.week_start&&date<=add(b.week_start,6));return {week:b.week_start,projected:sum(entries,([,v])=>v),days:entries.length,target:b.labor_target,updated:b.updated_at};});
const postBudget=weeklyBudgets.filter(b=>b.week>='2026-07-20');
const postProjection=sum(postBudget,b=>b.projected);
const pre=a.periods.pre,post=a.periods.post,py=a.periods.priorYear;
const baselineCost=post.laborCost-post.sales*pre.laborCost/pre.sales;
const targetDates=['2026-09-07','2026-09-08','2026-08-19','2026-09-13'];
const extensions=targetDates.map(date=>{let x=a.josephDays.find(d=>d.date===date),l=c.liveDays.find(d=>d.date===date),b=weeklyBudgets.find(b=>date>=b.week&&date<=add(b.week,6)),rawb=budgets.find(z=>z.week_start===b.week);return {date,toast:x.hours,ronos:l.hours,scheduled:x.scheduledHours,in:x.in,out:x.out,sales:x.sales,labor:x.laborPct,projection:+rawb.sales_projections[date],punchId:x.id,scheduleIds:x.scheduled.map(s=>s.id)};});
const staffingContext=targetDates.map(date=>{let pp=punches.filter(p=>p.business_date===date),ss=shifts.filter(s=>s.shift_date===date&&s.status==='published');let missing=ss.filter(s=>{let e=employees.find(e=>e.id===s.employee_id);return e&&`${e.first_name.trim()} ${e.last_name.trim()}`!=='Carlos Velazquez'&&!pp.some(p=>p.employee_toast_guid===e.toast_guid||p.employee_toast_guid===e.v2_toast_guid);}).map(s=>{let e=employees.find(e=>e.id===s.employee_id);return {name:`${e.first_name.trim()} ${e.last_name.trim()}`,start:local(s.start_time),end:local(s.end_time),id:s.id};});return {date,missing};});
const proof={publishedHours,draftHours,liveHours:c.totals.hours,deltaPublished:round(c.totals.hours-publishedHours),deltaAll:round(c.totals.hours-publishedHours-draftHours),weekly,peers,weeklyBudgets,extensions,staffingContext};
fs.writeFileSync(`${dir}/report-metrics.json`,JSON.stringify(proof,null,2));
const report=`# Auditoría de registros laborales — Lynwood #14

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

${table(['Fecha','Hecho observado','Interpretación permitida'],[
 ['2023-01-01','Primera ponchada de Enrique Navarrete','Inicio del historial observado; no equivale por sí solo a fecha de contratación.'],
 ['2023-07-25','Enrique empieza a registrar Shift Leader','Cambio de puesto en ponchadas.'],
 ['2023-09-25','Primera ponchada de Enrique como Asst Manager','Desde aquí queda documentado el rol de asistente.'],
 ['2023-10-16','Creación de la ficha Toast de Carlos en Lynwood','Fecha técnica; no prueba nombramiento ni presencia física.'],
 ['2024-04-19','Primera ponchada Alexander Suarez, Prep','Alta observada en la operación.'],
 ['2024-08-27','Evento HR de Carlos: Updated to site manager','Cambio registrado ese día; existen ajustes retroactivos posteriores que deben conservarse como contexto.'],
 ['2024-09-09','Primera ponchada Alexander Villarreal, Prep','Enrique y ambos Alexander coinciden desde esta fecha.'],
 ['2025-09-21','Última ponchada Alexander Suarez','Su baja técnica Toast se registra posteriormente: 14-dic-2025 UTC.'],
 ['2026-04-24','Última ponchada Alexander Villarreal','Todavía existen turnos guardados hasta 3-may; baja técnica 10-may-2026 UTC.'],
 ['2026-07-14','Última ponchada Enrique Navarrete','Baja técnica 27-jul UTC; no consta motivo de salida.'],
 ['2026-07-17','HireDate y creación de perfil HR de Joseph','Cuenta creadora de Cingular HR; no identifica quién decidió o solicitó contratarlo.'],
 ['2026-07-20','Primera ponchada Joseph Castellanos, Prep','Seis días después de la última actividad de Enrique; rol diferente.'],
 ['2026-07-31 a 2026-08-26','Joseph registra 27 días seguidos','Señal de concentración de días; no prueba favoritismo ni infracción jurídica por sí sola.'],
 ['2026-08-13 y 2026-08-20','Turnos Joseph en draft auto-generados desde ponchadas','No deben contarse como aprobación previa.'],
 ['2026-09-07 a 2026-09-13','Joseph llega a 67.56 h RONOS','22.13 OT + 5.43 DT; semana de mayor carga.'],
 ['2026-09-17 y 2026-09-24','Otros turnos draft auto-generados','El 24-sep queda fuera de las nueve semanas cerradas.'],
 ['2026-09-24','Último día completo de Toast incluido','Semana 21–27 sep parcial: no se mezcla con las nueve semanas cerradas.']
])}

**Joseph no coincide en ponchadas con Enrique ni con los dos Alexander.** Las salidas de Suarez y Villarreal preceden por meses su primera actividad. La secuencia no acredita una sustitución dirigida por amistad; requeriría expedientes de contratación, salida y autorizaciones. La ausencia posterior de ponchadas tampoco demuestra despido: puede representar baja, traslado u otra situación.

## 4. Comparación histórica con los empleados anteriores

${table(['Empleado','Primera / última ponchada','Horas del historial','Promedio por semana con actividad*','Máxima semana Toast'],a.identity.filter(x=>x.name!=='Carlos Velazquez').map(x=>{let hist=a.historicalComparison.find(h=>h.name===x.name);return [x.name,x.first+' / '+x.last,n(x.hours),hist?n(hist.all.avg):n(484.22/9),hist?n(hist.all.max):'67.56'];}))}

*Los anteriores usan semanas con actividad, incluyendo semanas parciales de entrada/salida; Joseph usa nueve semanas cerradas para su promedio y hasta 24-sep para el total histórico de 513.45 h. Son comparaciones descriptivas, no pares equivalentes de demanda, disponibilidad o antigüedad. Enrique fue asistente, mientras Joseph y los Alexander están registrados como Prep; no se equiparan responsabilidades. El inicio de la semana de 26-dic-2022 de Enrique está fuera del resumen semanal histórico, pero sus 6.60 h del 1-ene-2023 sí están incluidas en el total histórico.*

En sus primeras nueve semanas con actividad, Suarez promedió **40.96 h** y Villarreal **41.92 h** frente a **53.80 h Toast** de Joseph. La diferencia es visible, pero sus ingresos ocurrieron en años con otra demanda. Además, Suarez alcanzó una semana de **79.98 h** y Villarreal una de **65.12 h**: el uso de semanas extensas ya existía antes de Joseph.

Las últimas nueve semanas con actividad previas a la semana final arrojan 48.04 h/semana para Suarez, 36.57 para Villarreal y 45.95 para Enrique. No se atribuye el descenso de Villarreal a una decisión del manager sin disponibilidad, ausencias y motivos de salida. El anexo conserva cada semana para evitar conclusiones basadas solamente en promedios.

## 5. Joseph semana por semana: RONOS directo y horario guardado

${table(['Semana lunes','Días','Publicadas h','Draft h','RONOS h','OT','DT','Toast h','Ventas tienda','Labor tienda'],weekly.map(w=>{let z=a.josephWeeks.find(j=>j.week===w.week);return [w.week,w.days,n(w.published),n(w.draft),n(w.total),n(w.ot),n(w.dt),n(w.toast),money(z.store.sales),n(z.store.laborPct)+'%'];}))}

Total: **${n(c.totals.hours)} h RONOS**, ${n(c.totals.regular)} regulares + ${n(c.totals.ot)} OT + ${n(c.totals.dt)} DT. Todas las nueve tarjetas devuelven employeeApproval=true y managerApproval=true; el campo semanal no identifica al aprobador. Ninguna devuelve hasRetroHours=true. Estos flags no sustituyen recibos de nómina ni certifican quién realizó cada autorización.

**Precaución sobre el horario:** existen tres borradores automáticos en este periodo, los jueves **13-ago, 20-ago y 17-sep**, de 7.50 h estimadas cada uno. Además, nueve turnos publicados conservan la nota de auto-generación, algunos posiblemente clonados; cuatro publicados se crearon después de su hora de inicio. Por tanto, incluso published no equivale necesariamente a una versión aprobada y congelada antes del turno. La diferencia de 60.77 h mide contra el estado publicado consultado, no una cantidad demostrada de horas indebidas.

El costo salarial **estimado** con tarifa Toast constante $16.90/h y categorías RONOS es **${money(c.totals.estimatedWages)}**, de los que **${money(c.totals.premiumAboveBase)}** son el recargo OT/DT sobre pagar esas mismas horas a tarifa base. No es pérdida, factura ni pago comprobado; excluye impuestos, beneficios, markup y cualquier ajuste de nómina. La cifra documental aprobada se concilia a continuación.

### Conciliación con cinco recibos aprobados de Simplify HR

${table(['Período','Regulares h','OT h','DT h','Total horas','Bruto aprobado','Estado'],payroll.periods.map(p=>[p.start+' a '+p.end,n(p.regular),n(p.ot),n(p.dt),n(p.hours),money(p.gross),p.status]))}

**Total documental aprobado: ${money(payroll.totalGross)} y ${n(payroll.totalHours)} h.** Todos los recibos corresponden a assignmentId SHR000584 y al userId de Joseph en el mismo site de Lynwood. Coinciden las horas por categoría con las dos tarjetas RONOS de cada quincena; la semana 13–19 jul se consultó en vivo y tiene cero horas. Las partidas de cada recibo suman exactamente su bruto. La quincena 24-ago–6-sep presenta **−$0.01** respecto a multiplicar las unidades por las tarifas y redondear al final; se conserva como diferencia de redondeo, no horas faltantes o sobrantes. Los demás periodos concilian al centavo bajo ese cálculo.

La estimación agregada $9,280.64 y el total de recibos $9,280.63 difieren un centavo por redondeo. El estado recibido es **approved**, no paid; no se verificó liquidación bancaria. Las referencias invoiceId están conservadas, pero el monto facturado de Cingular HR, impuestos y markup no se certifican solo con esos identificadores.

## 6. Comparación con cocineros contemporáneos

Todos los siguientes registros están bajo el mismo job GUID **Prep**. No se conoce estación específica, productividad individual ni disponibilidad contractual; compartir job no hace intercambiables a todas las personas.

${table(['Empleado','Semanas activas','Toast h','Promedio/semana activa','Días','Semanas 7 días','Publicadas h','Draft h'],peers.map(p=>[p.name,p.weeks,n(p.hours),n(p.avgActiveWeek),p.days,p.weeks7Days,n(p.published),n(p.draft)]))}

Joseph tiene más semanas de siete días que los compañeros de este grupo en el periodo, pero no lidera las horas totales. Frente a todos los turnos guardados, incluyendo drafts, la diferencia de Joseph es +38.72 h Toast, frente a +3.25 de Benjamin y −0.28 de Jonathan. Esta comparación está afectada por los borradores derivados de asistencia y por versiones del horario no conservadas; se usa para localizar casos, no para certificar una violación.

## 7. Días concretos que requieren explicación operativa

${table(['Fecha','Entrada / salida Toast, LA','RONOS h','Horario guardado neto','Diferencia RONOS','Ventas','Proyección guardada','Labor'],extensions.map(x=>[x.date,x.in+' → '+x.out,n(x.ronos),n(x.scheduled),signed(x.ronos-x.scheduled),money(x.sales),money(x.projection),n(x.labor)+'%']))}

- **7-sep:** horario guardado 09:00–17:00; Toast 07:58–23:00, RONOS 13.98 h netas. No apareció un compañero horario publicado sin ponchadas en Toast ese día, una vez separado Carlos asalariado. Las ventas superaron la proyección guardada; aun así, la extensión necesita orden de cobertura o razón de operación. No se identificaron ponchadas manualmente añadidas ese día en RONOS.
- **8-sep:** RONOS 11.52 h frente a 7.50 del horario. Venta $12,639.64, inferior a la proyección guardada $13,630; labor 24.08%. **Jose Andres Morales** estaba programado 16:00–00:00 y no tiene ponchada Toast de ese día. La variante de nombre RONOS “Jose Andres Morales Raymundo” no tiene mapeo manual confirmado; no se fuerza la identidad. La posible cobertura debe documentarse.
- **19-ago:** RONOS 12.03 h; **Irving Saca y Cruz Victorino Castillo**, programados en PM, carecen de horas y ponchadas ese día también en consulta RONOS. Hay una explicación operativa plausible para reforzar la tarde, pendiente de autorización y función cubierta.
- **13-sep:** RONOS 11.45 h, incluyendo 3.45 DT; **Fernando Lacayo Cisne y Eliuth Alvarez**, programados, registran cero horas y cero ponchadas RONOS ese día. Fernando ya tenía su última ponchada Toast el 8-sep. Un turno desactualizado tampoco prueba una falta injustificada. Se requiere confirmar qué vacantes existían y quién aprobó cubrirlas.

No se verificaron cámaras ni presencia física. Una ponchada coherente puede representar trabajo real o requerir validación adicional; los datos por sí solos no distinguen ambas situaciones.

## 8. Ponchadas añadidas y aprobaciones: evidencia concreta

Se revisaron las **240 ponchadas atómicas RONOS** de Joseph de las nueve semanas, sin IDs duplicados. Aparecen **tres con addedPunch=true** y un cuarto registro de solicitud/aprobación del manager:

${table(['Fecha / hora LA','Punch ID','Tipo interpretado','Añadida','Solicitante','Respondedor','Approver','Iniciales'],c.adjustments.map(p=>[p.localTime.slice(0,16).replace('T',' '),p.punchId,p.punchType===2?'Salida':p.punchType===3?'Inicio comida':p.date==='2026-08-10'?'Regreso comida':'Entrada',p.added?'Sí':'No',p.requesterId,p.responderId,p.approver,p.initials]))}

En 20-jul y 21-jul, managerRequest=true y requesterId/responderId **27590**, iniciales **CV**. El 21-jul se añadió la salida 17:03. El 10-ago, Joseph (**37548**) solicitó los dos registros de comida 12:17 y 12:47; responderId **68**, approver **27590**. Esos registros corresponden a una comida de 30 minutos; no es válido tratarlos automáticamente como adición de tiempo pagado. Los objetos de comentarios consultados tienen texto null.

**No se verificó una tabla que vincule formalmente la cuenta RONOS 27590 con Carlos.** Las iniciales CV y el contexto son indicios de identidad, no acreditación suficiente. El usuario interno TEG 25, el employeeUserId RONOS salarial 24433 y el actor 27590 pertenecen a identificadores distintos. No se confunden. Tampoco se obtuvo el valor anterior de cada ponchada, la hora en que se realizó el cambio o un motivo escrito. No puede calcularse tiempo regalado a partir de addedPunch.

No se encontraron duplicados, solapamientos, ponchadas abiertas, fechas laborales mal asignadas ni horas Toast superiores al intervalo entrada–salida en los 63 registros de Joseph. Sus horas Toast coinciden con entrada–salida menos comidas no pagadas dentro de la tolerancia de tres minutos aplicada. **Esto descarta esas anomalías aritméticas en la muestra completa de Joseph, no fraude por presencia falsa.**

## 9. Ventas, labor y productividad de Lynwood

Comparación de **nueve semanas completas / 63 días**, con nueve lunes, nueve martes, etc. Se excluye de estos comparadores la semana parcial de 21-sep.

${table(['Indicador','18-may–19-jul 2026','20-jul–20-sep 2026','Cambio'],[
 ['Ventas netas',money(pre.sales),money(post.sales),signed(c.changes.sales)+'%'],
 ['Tickets',pre.tickets.toLocaleString('en-US'),post.tickets.toLocaleString('en-US'),signed(c.changes.tickets)+'%'],
 ['Horas de labor (caché)',n(pre.laborHours),n(post.laborHours),signed(c.changes.laborHours)+'%'],
 ['Costo labor (caché)',money(pre.laborCost),money(post.laborCost),signed(c.changes.laborCost)+'%'],
 ['Labor / ventas',n(pre.laborPct)+'%',n(post.laborPct)+'%',signed(c.changes.laborPercentagePoints)+' puntos'],
 ['Ventas por hora labor',money(pre.splh),money(post.splh),signed(c.changes.splh)+'%']
])}

Mantener el porcentaje de labor del periodo previo sobre las ventas nuevas daría un costo aproximadamente **${money(baselineCost)} menor**. Es solo un escenario proporcional: no identifica desperdicio, no mide una plantilla óptima y **no es imputable a Joseph ni a Carlos**. La demanda creció, cambió la composición del equipo y faltan criterios de cobertura y calidad de servicio.

Comparador estacional de días equivalentes, **21-jul–21-sep 2025**: ventas ${money(py.sales)}, labor ${n(py.laborPct)}%, SPLH ${money(py.splh)}. En 2026 ventas **+17.09%**, tickets **+11.49%**, horas **+4.21%**, labor **−1.85 puntos**, SPLH **+12.37%**. Es una comparación interanual de mismos días de semana; no controla precios, promociones, cierres o mezcla de productos.

Por día de la semana:

${table(['Día','Ventas antes','Ventas después','Labor antes','Labor después','SPLH antes','SPLH después'],c.byWeekday.map(x=>[['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'][x.day],money(x.pre.sales),money(x.post.sales),n(x.pre.laborPct)+'%',n(x.post.laborPct)+'%',money(x.pre.splh),money(x.post.splh)]))}

El deterioro contemporáneo de eficiencia se concentra especialmente en **miércoles y jueves**; los sábados mejoran. Esto sugiere revisar dotación por día y franja, en lugar de atribuir toda la variación a un empleado.

Presupuestos: las nueve semanas posteriores suman **${money(postProjection)} de proyección guardada**, contra ${money(post.sales)} reales (**${n((post.sales/postProjection-1)*100)}% arriba**). Los 18 registros de weekly_budgets tienen **labor_target=null**: no hay un objetivo explícito guardado en ese campo para declarar incumplimiento. Las proyecciones son la versión actualmente conservada, algunas actualizadas durante la semana, no snapshots ex ante. Se sumó solo cada fecha de su semana; varios JSON también contienen fechas de semanas vecinas, que se excluyeron para evitar doble conteo.

## 10. Composición de horas y altas observadas

${table(['Puesto registrado','Horas antes','Horas después','Cambio'],c.jobMix.map(j=>[j.job||'Sin puesto',n(j.preHours),n(j.postHours),signed(j.postHours-j.preHours)]))}

Prep pasó de 3,651.09 a 4,798.56 h (**+31.43%**); Shift Leader bajó 250.59 h, Asst Manager 32.20 h y Cashier 48.66 h. Parte puede ser cambio de clasificación del trabajo, entradas, regresos y salidas. La caída de horas de Enrique no se traslada de forma uno a uno a un puesto equivalente de Joseph.

${table(['Empleado','Horas antes','Horas después','Diferencia'],c.allocation.map(x=>[x.name,n(x.preHours),n(x.postHours),signed(x.difference)]))}

Primeras ponchadas observadas en 2026, desde abril:

${table(['Nombre','Primera ponchada','Última al corte','Horas acumuladas al corte'],a.staffTimeline.filter(x=>x.first>='2026-04-01').map(x=>[x.name,x.first,x.last,n(x.hours)]))}

Esta lista refleja actividad observada, **no atribuye a Carlos contrataciones, parentesco ni amistad**. Puede incluir reingresos, pruebas o transferencias. Librado Mondragon reaparece en el periodo comparado pero tiene historia anterior: no se cuenta como contratación nueva. No se halló evidencia de quién solicitó, entrevistó o decidió cada contratación. La captura administrativa de algunas fichas sí queda identificada en HR, como se detalla enseguida.

### Historial de Recursos Humanos y discrepancias de catálogo

- **Joseph:** Simplify HR registra hireDate **17-jul-2026**, perfil creado el mismo día por una cuenta de **Malena, Cingular HR**; puesto **Cashier**, jornada FullTime, tarifa **$16.90/h**, OT **$25.35/h**, una entrada de empleo y una de compensación. RONOS comparte assignmentId **SHR000584** con HR y recibos. Toast registra sus 63 ponchadas como **Prep**. Es una discrepancia de puesto que necesita corrección o explicación; no se debe asumir que hace caja por la ficha HR ni que la captura por HR demuestra quién eligió al candidato.
- **Carlos:** HR lo identifica como **Site Manager / Manager**, pago **Yearly**, y conserva el evento de cambio a Site Manager del **27-ago-2024**, más ajustes de migración/corrección creados en 2026 y retroactivos a 2024. Esto confirma la clasificación salarial y advierte que fechas efectivas no siempre son fechas de captura o inicio real.
- **Enrique:** la ficha HR consultada sigue **Active**, con hireDate **13-jul-2026**, creada **28-jul-2026**, puesto **pre cook**, tarifa **$22.40/h** y assignmentId **SHR000654**. Esto contradice una lectura literal de “contratación nueva”: Toast conserva actividad desde 2023, puesto Asst Manager desde septiembre 2023 y última ponchada 14-jul-2026. Se trata de registros incompatibles en fecha/estado/puesto que requieren conciliación administrativa; no se infiere la causa ni se reemplaza el historial antiguo por esa ficha.
- Las consultas HR con active=true y active=false devolvieron los mismos tres perfiles objetivo (duplicados entre ambas consultas). Se deduplicaron por ID para interpretar los resultados. Los Alexander no aparecieron en esas respuestas; **no se considera certificado un padrón completo de inactivos** ni se infiere que no tengan expediente antiguo.

## 11. Tendencia mensual completa

Septiembre 2026 es parcial, 1–24; no se compara su total con un mes entero. Los totales de labor son los de sales_daily_cache, no nómina pagada. Días cerrados o sin labor se conservan sin dividir entre cero. Algunos días históricos tienen cero labor; el informe no presume que el negocio operó normalmente esos días.

${table(['Mes','Días','Ventas','Labor %','SPLH','Enrique h','Suarez h','Villarreal h','Joseph h'],a.monthly.map(x=>[x.month,x.days,money(x.sales),n(x.laborPct)+'%',money(x.splh),n(x.targets['Enrique Navarrete'].hours),n(x.targets['Alexander Suarez'].hours),n(x.targets['Alexander Villarreal'].hours),n(x.targets['Joseph Castellanos'].hours)]))}

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
`;
fs.writeFileSync(`${dir}/informe.md`,report);
const wk=read('employee-weeks').filter(w=>['Joseph Castellanos','Enrique Navarrete','Alexander Suarez','Alexander Villarreal'].includes(w.name));
fs.writeFileSync(`${dir}/anexo-semanal.md`,'# Anexo semanal de horas registradas — Lynwood\n\nSemanas lunes–domingo; semanas iniciales/finales pueden ser parciales. Horas programadas aquí incluyen todos los estados guardados, no acreditan autorización previa. OT Toast no separa DT.\n\n'+table(['Semana','Empleado','Días','Horas Toast','OT Toast','Horas RONOS','OT RONOS','DT RONOS','Horas horario guardado'],wk.map(w=>[w.week,w.name,w.days,n(w.hours),n(w.ot),n(w.ronosHours),n(w.ronosOt),n(w.ronosDt),n(w.scheduledHours)]))+'\n');
fs.writeFileSync(`${dir}/anexo-diario-joseph.md`,'# Anexo diario Joseph Castellanos — Lynwood\n\nHoras de Los Ángeles. Programa actual, no versión histórica. RONOS directo termina 20-sep; “—” significa no consultado.\n\n'+table(['Fecha','Entrada Toast','Salida Toast','Toast h','RONOS h','Horario neto','Estado','Origen/nota','Venta tienda','Labor tienda'],a.josephDays.map(x=>{let s=shifts.filter(s=>s.employee_id===josephId&&s.shift_date===x.date);return [x.date,x.in,x.out,n(x.hours),n(c.liveDays.find(y=>y.date===x.date)?.hours),n(x.scheduledHours),s.map(s=>s.status).join(', '),s.some(s=>/Auto-generado/.test(s.notes||''))?'Nota auto-generación':'Sin nota automática',money(x.sales),n(x.laborPct)+'%'];}))+'\n');
// Figura estática independiente con fechas extraídas de las ponchadas.
const start=Date.parse('2023-01-01'),end=Date.parse('2026-09-24'),x=v=>245+(Date.parse(v)-start)/(end-start)*810;
const people=a.identity.filter(e=>e.name!=='Carlos Velazquez');
const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;');
const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1120" height="400" viewBox="0 0 1120 400" role="img" aria-label="Primera y última ponchada de Enrique, Alexander Suarez, Alexander Villarreal y Joseph en Lynwood"><rect width="1120" height="400" fill="#f7f8fa"/><text x="30" y="38" font-family="Arial" font-size="23" fill="#172b42">Lynwood · Actividad registrada en ponchadas</text><text x="30" y="65" font-family="Arial" font-size="14" fill="#536477">Primera y última actividad observada · No representa fecha formal de contratación o despido</text>${['2023-01-01','2024-01-01','2025-01-01','2026-01-01'].map(d=>`<line x1="${x(d)}" y1="85" x2="${x(d)}" y2="340" stroke="#d7dde5"/><text x="${x(d)}" y="370" font-family="Arial" font-size="14" fill="#536477">${d.slice(0,4)}</text>`).join('')}${people.map((e,i)=>{let y=110+i*61;return `<text x="30" y="${y+17}" font-family="Arial" font-size="16" fill="#172b42">${esc(e.name)}</text><rect x="${x(e.first)}" y="${y}" width="${Math.max(5,x(e.last)-x(e.first))}" height="23" rx="4" fill="${e.name==='Joseph Castellanos'?'#137c78':'#496880'}"/><text x="${Math.min(x(e.first),830)}" y="${y+42}" font-family="Arial" font-size="13" fill="#536477">${e.first} → ${e.last}</text>`;}).join('')}<text x="1040" y="370" text-anchor="end" font-family="Arial" font-size="13" fill="#536477">24-sep-2026</text></svg>`;
fs.writeFileSync(`${dir}/linea-de-tiempo.svg`,svg);
const hashes=fs.readdirSync(dir).filter(n=>/\.json$/.test(n)&&n!=='evidence-sha256.json').map(n=>({file:n,sha256:crypto.createHash('sha256').update(fs.readFileSync(`${dir}/${n}`)).digest('hex')}));
fs.writeFileSync(`${dir}/evidence-sha256.json`,JSON.stringify({generatedAt:new Date().toISOString(),files:hashes},null,2));
console.log('REPORT BUILT',path.resolve(dir,'informe.md'),'words',report.split(/\s+/).length,'weekly rows',wk.length);
console.log('PLAN VALIDATION PASS',{published:published.length,publishedHours,draft:draft.length,draftHours,deltaPublished:proof.deltaPublished,deltaAll:proof.deltaAll});
