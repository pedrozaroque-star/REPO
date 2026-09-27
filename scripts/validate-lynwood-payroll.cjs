/**
 * @module validate-lynwood-payroll
 * @description Conciliación real de cinco recibos aprobados contra tarjetas RONOS completas.
 * @businessRules Identidad por assignmentId y userId; approved no prueba liquidación bancaria.
 * @dataFlow Simplify HR y RONOS directos → conciliación por período, categoría y centavos.
 * @notes Conserva diferencias de redondeo; no usa impuestos, cuentas ni deducciones personales.
 */
const fs=require('node:fs'),assert=require('node:assert/strict');
const {moneyCents,isClosedPayrollEvidence,matchPayrollEvidence}=require('../lib/payroll-evidence.ts');
const dir='reports/lynwood-personnel-audit-2026-09-25',r=n=>JSON.parse(fs.readFileSync(`${dir}/${n}.json`));
const stubs=r('hr-joseph-paystubs'),profiles=[...new Map(r('hr-profiles').map(x=>[x.id,x])).values()],j=profiles.find(x=>x.firstName==='Joseph');
const weeks=[r('ronos-joseph-prehire'),...r('ronos-joseph-live')];
const sum=(arr,f)=>arr.reduce((s,x)=>s+Number(f(x)),0),round=x=>Math.round(x*100)/100;
assert.equal(stubs.pages.length,1);assert.equal(stubs.pages[0].total,stubs.stubs.length);assert.equal(stubs.stubs.length,5);assert.equal(weeks.length,10);
const result=[];
for(let s of stubs.stubs){assert.equal(s.userId,j.userId);assert.equal(s.assignmentId,j.assignmentId);assert.equal(s.siteId,j.siteId);let start=s.payPeriodStart.slice(0,10),end=s.payPeriodEnd.slice(0,10);assert.ok(isClosedPayrollEvidence(s,start,end));
 let employee={pin:j.employeeID,fullName:'Joseph Castellanos',ronosAssignmentId:j.assignmentId};assert.equal(matchPayrollEvidence(employee,[employee],[s]).method,'assignment_id');
 let ww=weeks.filter(w=>{let first=w.data.startDate.slice(0,10);let last=new Date(Date.parse(first+'T12:00:00Z')+6*864e5).toISOString().slice(0,10);return first>=start&&last<=end;});assert.equal(ww.length,2);
 const expected={regularTime:sum(ww,w=>w.data.totalWeeklyRegHours),overtime:sum(ww,w=>w.data.totalWeeklyOverTime),doubleTime:sum(ww,w=>w.data.totalWeeklyDoubleTime)};
 const actual={};for(let code of Object.keys(expected)){actual[code]=sum(s.earnings.filter(e=>e.systemCode===code),e=>e.units);assert.ok(Math.abs(actual[code]-expected[code])<.011);}
 assert.equal(sum(s.earnings,e=>moneyCents(e.amount)),moneyCents(s.grossWages));
 const grossFromExactRates=round(sum(s.earnings,e=>e.units*e.rate));let delta=round(s.grossWages-grossFromExactRates);assert.ok(Math.abs(delta)<=.02);
 result.push({id:s.id,start,end,status:s.status,regular:round(actual.regularTime),ot:round(actual.overtime),dt:round(actual.doubleTime),hours:round(sum(ww,w=>w.data.totalWeeklyHour)),gross:s.grossWages,rateCalculation:grossFromExactRates,roundingDifference:delta,assignment:s.assignmentId,identityMethod:'assignment_id',hoursMatch:true,earningsMatchGross:true});
}
result.sort((a,b)=>a.start.localeCompare(b.start));
const out={status:'PASS',profiles:profiles.length,periods:result,totalGross:round(sum(result,x=>x.gross)),totalHours:round(sum(result,x=>x.hours)),hireDate:j.hireDate,jobTitle:j.title,payRate:j.payRate,createdBy:j.createdBy,bankSettlementVerified:false};
fs.writeFileSync(`${dir}/payroll-validation.json`,JSON.stringify(out,null,2));console.log('PAYROLL RECONCILIATION PASS',out);
