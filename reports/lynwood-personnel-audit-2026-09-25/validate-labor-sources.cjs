/**
 * Auditoría de solo lectura: ejecuta extractos EXACTOS de producción sobre exportaciones reales.
 * No llama rutas, sincronizadores ni operaciones de mutación de base de datos.
 */
const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const assert = require('node:assert/strict');
const dir = __dirname;
const root = path.resolve(dir, '../..');
const read = name => JSON.parse(fs.readFileSync(path.join(dir, name + '.json'), 'utf8'));
const round = n => Math.round(n * 10000) / 10000;
function sourceFunction(file, start, end, args, returnName) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  const i = text.indexOf(start), j = text.indexOf(end, i);
  assert(i >= 0 && j > i);
  const code = ts.transpile(`function extracted(${args}) {${text.slice(i,j)}; return ${returnName};}`, { target: ts.ScriptTarget.ES2022 });
  return new Function(code + '; return extracted;')();
}
const mapPunches = sourceFunction('lib/toast-labor.ts', 'const upsertData = allPunches.map', '// Upsert in chunks', 'allPunches,storeId', 'upsertData');
const calcDuration = sourceFunction('app/api/reports/weekly-ops/route.ts', 'const calcDuration', 'const bankersRound', '', 'calcDuration')();
const aggregate = sourceFunction('lib/toast-api.ts', 'const dailyLabor:', 'return dailyLabor', 'allEntries', 'dailyLabor');
const boundaries = [
  ['2026-09-25T05:59:00-07:00','2026-09-24'],
  ['2026-09-25T06:00:00-07:00','2026-09-25'],
  ['2026-09-25T16:59:00-07:00','2026-09-25'],
  ['2026-09-25T17:00:00-07:00','2026-09-25'],
  ['2026-09-25T00:00:00-07:00','2026-09-24'],
  ['2026-03-08T05:59:00-07:00','2026-03-07'],
  ['2026-11-01T05:59:00-08:00','2026-10-31']
].map(([inDate,expected])=> {
  const actual=mapPunches([{inDate}], 'boundary')[0].business_date;
  assert.equal(actual,expected);
  return {inDate,actual};
});
const shifts=read('shifts');
const sales=read('sales');
const jobs=read('jobs');
const out={ generatedAt:new Date().toISOString(), boundaries, sourceFunctionsExecuted:['syncToastPunches exact mapping','weekly-ops calcDuration','getLaborForRange exact aggregation'], shifts:{count:shifts.length, nonfiniteDuration:0, missingJob:0, over12Hours:0}, sales:{count:sales.length, invalidNumeric:0, zeroSalesDays:0}, notes:['Source extraction preserves production formulas; local boundary inputs are not database rows.', 'Reconstructed API entries from punches cannot restore absent paidHours/DT fields. Closed entries only are aggregated to avoid estimating old open shifts as current work.']};
for (const s of shifts) {
  if(!Number.isFinite(calcDuration(s)))out.shifts.nonfiniteDuration++;
  if(calcDuration(s)>12)out.shifts.over12Hours++;
  if(s.job_id&&!jobs.some(j=>j.id===s.job_id||j.guid===s.job_id))out.shifts.missingJob++;
}
for(const s of sales){
  if(!['net_sales','labor_cost','labor_hours'].every(k=>Number.isFinite(Number(s[k]))))out.sales.invalidNumeric++;
  if(Number(s.net_sales)===0)out.sales.zeroSalesDays++;
}
if(fs.existsSync(path.join(dir,'punches.json'))){
 const punches=read('punches');
 const seen=new Set(), fingerprints=new Map(), byDay=new Map(), mismatch=[], invalid=[], open=[], missingWage=[], above12=[];
 let duplicateToastId=0, negativeHours=0;
 const api=punches.map(p=>({guid:p.toast_id,employeeReference:{guid:p.employee_toast_guid},jobReference:{guid:p.job_toast_guid},inDate:p.clock_in,outDate:p.clock_out,businessDate:p.business_date?.replaceAll('-',''),regularHours:Number(p.regular_hours),overtimeHours:Number(p.overtime_hours),hourlyWage:Number(p.hourly_wage),breaks:p.breaks}));
 const mapped=mapPunches(api,'80a1ec95-bc73-402e-8884-e5abbe9343e6');
 punches.forEach((p,i)=>{
   if(seen.has(p.toast_id))duplicateToastId++;seen.add(p.toast_id);
   const key=[p.employee_toast_guid,p.clock_in,p.clock_out].join('|');
   const arr=fingerprints.get(key)||[];arr.push(p.toast_id);fingerprints.set(key,arr);
   if(mapped[i].business_date!==p.business_date)mismatch.push({toast_id:p.toast_id,date:p.business_date,recomputed:mapped[i].business_date,clock_in:p.clock_in});
   const reg=Number(p.regular_hours),ot=Number(p.overtime_hours), wage=Number(p.hourly_wage);
   if(![reg,ot,wage].every(Number.isFinite))invalid.push(p.toast_id);
   if(reg<0||ot<0)negativeHours++;
   if(!p.clock_out)open.push({toast_id:p.toast_id,employee:p.employee_toast_guid,date:p.business_date,reg,ot});
   if(!wage&&reg+ot>0)missingWage.push({toast_id:p.toast_id,date:p.business_date,hours:reg+ot});
   if(reg+ot>12)above12.push({toast_id:p.toast_id,date:p.business_date,employee:p.employee_toast_guid,reg,ot,wage});
   const day=byDay.get(p.business_date)||{date:p.business_date,hours:0,cost:0,count:0};
   day.hours+=reg+ot;day.cost+=(reg+ot*1.5)*wage;day.count++;byDay.set(p.business_date,day);
 });
 const reconstructed=aggregate(api.filter(p=>p.outDate));
 const days=[...byDay.values()].map(d=>{
   const cached=sales.find(s=>s.business_date===d.date);
   return {...d,hours:round(d.hours),cost:round(d.cost),cacheHours:cached?.labor_hours??null,cacheCost:cached?.labor_cost??null,deltaHours:cached?round(d.hours-Number(cached.labor_hours)):null,deltaCost:cached?round(d.cost-Number(cached.labor_cost)):null,reconstructedClosedCost:reconstructed[d.date]?.laborCost??null};
 }).sort((a,b)=>a.date.localeCompare(b.date));
 out.punches={count:punches.length,duplicateToastId,duplicateFingerprints:[...fingerprints.values()].filter(a=>a.length>1),businessDateMismatch:mismatch,invalidNumeric:invalid,negativeHours,open,missingWage,above12,daysReconciled:days.length,daysCacheHoursDifferenceOverPoint11:days.filter(d=>d.deltaHours!==null&&Math.abs(d.deltaHours)>0.11).length};
 fs.writeFileSync(path.join(dir,'labor-source-reconciliation.json'),JSON.stringify(days,null,2));
}
fs.writeFileSync(path.join(dir,'labor-source-validation.json'),JSON.stringify(out,null,2));
console.log(JSON.stringify(out,null,2));
assert.equal(out.shifts.nonfiniteDuration,0);
assert.equal(out.sales.invalidNumeric,0);
console.log('PASS: source code executed, boundary assertions and real dataset numeric validation completed; anomalies retained as findings.');
