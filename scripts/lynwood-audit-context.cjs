/**
 * @module lynwood-audit-context
 * @description Contrasta extensiones, reparto de horas, continuidad y evidencia RONOS.
 * @businessRules Comparaciones descriptivas; no atribuir intención ni autor sin identificador comprobado.
 * @dataFlow Evidencia local inmutable → métricas derivadas y validaciones reales.
 * @notes Las horas programadas descuentan 0.5h por turno >5h como la UI; no prueban pago.
 */
const fs=require('node:fs'),assert=require('node:assert/strict'),d='reports/lynwood-personnel-audit-2026-09-25';
const r=n=>JSON.parse(fs.readFileSync(`${d}/${n}.json`));const save=(n,x)=>fs.writeFileSync(`${d}/${n}.json`,JSON.stringify(x,null,2));
const a=r('analysis'),es=r('employees'),ps=r('punches'),ss=r('shifts'),sales=r('sales'),live=r('ronos-joseph-live'),cards=r('ronos-cards'),weeks=r('ronos-weeks');
const em=new Map(es.flatMap(e=>[[e.toast_guid,e],[e.v2_toast_guid,e]]));
const name=p=>{let e=em.get(p.employee_toast_guid);return `${e.first_name.trim()} ${e.last_name.trim()}`;};
const sum=(xs,f)=>xs.reduce((s,x)=>s+(Number(f(x))||0),0),round=x=>Math.round(x*100)/100,h=p=>(+p.regular_hours||0)+(+p.overtime_hours||0);
const range=(x,s,e)=>x>=s&&x<=e,add=(d,n)=>new Date(Date.parse(d+'T12:00:00Z')+n*864e5).toISOString().slice(0,10);
const periods=a.periods,pre=periods.pre,post=periods.post;
const changes={};for(let k of ['sales','tickets','laborHours','laborCost','splh'])changes[k]=round((post[k]/pre[k]-1)*100);changes.laborPercentagePoints=round(post.laborPct-pre.laborPct);
const priorYearChanges={};for(let k of ['sales','tickets','laborHours','laborCost','splh'])priorYearChanges[k]=round((post[k]/periods.priorYear[k]-1)*100);priorYearChanges.laborPercentagePoints=round(post.laborPct-periods.priorYear.laborPct);
const allocation=[...new Set(ps.filter(p=>range(p.business_date,pre.start,post.end)).map(name))].map(n=>{let pp=ps.filter(p=>name(p)===n);let b=pp.filter(p=>range(p.business_date,pre.start,pre.end)),c=pp.filter(p=>range(p.business_date,post.start,post.end));return {name:n,preHours:round(sum(b,h)),postHours:round(sum(c,h)),difference:round(sum(c,h)-sum(b,h)),preDays:new Set(b.map(p=>p.business_date)).size,postDays:new Set(c.map(p=>p.business_date)).size,postOt:round(sum(c,p=>p.overtime_hours))};}).sort((a,b)=>b.difference-a.difference);
const jp=ps.filter(p=>name(p)==='Joseph Castellanos').sort((a,b)=>a.business_date.localeCompare(b.business_date));let runs=[],run=[];for(let p of jp){if(run.length&&p.business_date!==add(run.at(-1),1)){runs.push(run);run=[];}run.push(p.business_date);}if(run.length)runs.push(run);
const continuity=runs.map(x=>({first:x[0],last:x.at(-1),days:x.length})).sort((a,b)=>b.days-a.days);
const liveSummary=live.map(w=>{let raw=w.data;let week=raw.startDate.slice(0,10),cw=a.josephWeeks.find(w=>w.week===week);return {week,weekId:w.weekId,regular:raw.totalWeeklyRegHours,ot:raw.totalWeeklyOverTime,dt:raw.totalWeeklyDoubleTime,total:raw.totalWeeklyHour,toast:cw.hours,difference:round(cw.hours-raw.totalWeeklyHour),scheduled:cw.scheduledHours,aboveScheduled:round(raw.totalWeeklyHour-cw.scheduledHours),approval:raw.payrollCheck,retro:raw.hasRetroHours,days:raw.workDays.filter(x=>x.totalHours>0).length};}).sort((a,b)=>a.week.localeCompare(b.week));
const livePunches=live.flatMap(w=>w.data.workDays.flatMap(day=>(day.punches||[]).map(p=>({week:w.data.startDate.slice(0,10),date:day.startTime.slice(0,10),...p}))));
const adjustments=livePunches.filter(p=>p.addedPunch||p.managerRequest||p.responderId||p.requesterId||p.approver).map(p=>({date:p.date,punchId:p.punchId,approvalId:p.clockPunchApprovalId,localTime:p.localTime,punchType:p.punchType,added:p.addedPunch,approval:p.approval,requesterId:p.requesterId,responderId:p.responderId,approver:p.approver,initials:p.initials,managerRequest:p.managerRequest}));
const liveDays=live.flatMap(w=>w.data.workDays.map(x=>({date:x.startTime.slice(0,10),hours:x.totalHours,regular:x.regularTime,ot:x.overTime,dt:x.doubleTime,lunch:x.lunchHours,punches:(x.punches||[]).map(p=>({id:p.punchId,type:p.punchType,localTime:p.localTime,added:p.addedPunch})),comments:x.comments}))).sort((a,b)=>a.date.localeCompare(b.date));
const totals={regular:sum(liveSummary,w=>w.regular),ot:sum(liveSummary,w=>w.ot),dt:sum(liveSummary,w=>w.dt),hours:sum(liveSummary,w=>w.total),toast:sum(liveSummary,w=>w.toast),scheduled:sum(liveSummary,w=>w.scheduled)};
totals.estimatedWages=totals.regular*16.9+totals.ot*16.9*1.5+totals.dt*16.9*2;totals.premiumAboveBase=totals.ot*16.9*.5+totals.dt*16.9;
Object.keys(totals).forEach(k=>totals[k]=round(totals[k]));
const deviations=a.josephDays.filter(x=>x.hours-x.scheduledHours>=1).map(x=>({...x,above:round(x.hours-x.scheduledHours)})).sort((a,b)=>b.above-a.above);
const peerDeviations=a.peers.filter(p=>p.weeks===9).map(p=>({name:p.name,hours:p.hours,scheduled:p.scheduledHours,delta:round(p.hours-p.scheduledHours),percent:round(100*(p.hours/p.scheduledHours-1))})).sort((a,b)=>b.delta-a.delta);
const byWeekday=Array.from({length:7},(_,day)=>{function calc(start,end){let rows=sales.filter(s=>range(s.business_date,start,end)&&new Date(s.business_date+'T12:00Z').getUTCDay()===day);let salesN=sum(rows,x=>x.net_sales),hoursN=sum(rows,x=>x.labor_hours),costN=sum(rows,x=>x.labor_cost);return {days:rows.length,sales:round(salesN),hours:round(hoursN),laborPct:round(costN/salesN*100),splh:round(salesN/hoursN)};}return {day,pre:calc(pre.start,pre.end),post:calc(post.start,post.end)};});
const jobMix=[...new Set(ps.filter(p=>range(p.business_date,pre.start,post.end)).map(p=>p.job_toast_guid))].map(j=>{let title=r('jobs').find(x=>x.guid===j)?.title||j;return {job:title,preHours:round(sum(ps.filter(p=>p.job_toast_guid===j&&range(p.business_date,pre.start,pre.end)),h)),postHours:round(sum(ps.filter(p=>p.job_toast_guid===j&&range(p.business_date,post.start,post.end)),h))};});
const targets=new Set(a.identity.map(x=>x.name));
const historicalAnomalies=Object.fromEntries(Object.entries(r('anomalies')).map(([k,arr])=>[k,arr.filter(x=>targets.has(x.name))]));
const yearCoverage=[2023,2024,2025,2026].map(y=>{let p=ps.filter(x=>x.business_date.startsWith(''+y));return {year:y,punches:p.length,days:new Set(p.map(x=>x.business_date)).size,missingHours:p.filter(x=>x.regular_hours==null||x.overtime_hours==null).length,missingWages:p.filter(x=>!(+x.hourly_wage>0)).length,missingBreaks:p.filter(x=>x.breaks==null).length};});
const result={changes,priorYearChanges,allocation,continuity,liveSummary,liveDays,adjustments,livePunchCount:livePunches.length,totals,deviations,peerDeviations,byWeekday,jobMix,historicalAnomalies,yearCoverage};
assert.equal(liveSummary.length,9);assert.ok(Math.abs(totals.regular+totals.ot+totals.dt-totals.hours)<0.02);assert.equal(livePunches.length,new Set(livePunches.map(p=>p.punchId)).size);for(let w of live){assert.equal(w.data.companyId,34);assert.ok(Math.abs(sum(w.data.workDays,x=>x.totalHours)-w.data.totalWeeklyHour)<0.08);assert.ok(w.data.workDays.flatMap(d=>d.punches||[]).every(p=>p.employeeId===36848));}
save('context-analysis',result);save('live-validation',{status:'PASS',weeks:9,punches:livePunches.length,checks:['Company 34','Employee 36848','IDs de ponchadas sin duplicados','Suma diaria-semanal','Reg+OT+DT conciliados']});
console.log('LIVE VALIDATION PASS');console.log(JSON.stringify({...result,allocation:allocation.slice(0,12),liveDays:undefined,deviations:deviations.slice(0,10),historicalAnomalies:Object.fromEntries(Object.entries(historicalAnomalies).map(([k,v])=>[k,v.length]))},null,2));
