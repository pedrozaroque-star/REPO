/**
 * @module validate-lynwood-source
 * @description Ejecuta helpers reales del sistema sobre evidencia de Lynwood y casos límite.
 * @businessRules Sin mocks, sin DB mutation y sin afirmar pago sin recibo verificado.
 * @dataFlow Código fuente real + snapshots → validación independiente del informe.
 * @notes Ejecutar con npx tsx scripts/validate-lynwood-source.cjs.
 */
const fs=require('node:fs'),assert=require('node:assert/strict'),vm=require('node:vm'),ts=require('typescript');
const {normalizePayrollName,moneyCents,comparePayrollGross}=require('../lib/payroll-evidence.ts');
const dir='reports/lynwood-personnel-audit-2026-09-25';
const source=fs.readFileSync('app/api/reports/weekly-ops/route.ts','utf8');
const match=source.match(/const calcDuration = \(s: any\) => \{[\s\S]*?\n\}/);assert.ok(match,'Helper fuente localizado');
const script=ts.transpileModule(match[0]+'\n;globalThis.sourceDuration = calcDuration',{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
const context={};vm.createContext(context);vm.runInContext(script,context);
const shifts=JSON.parse(fs.readFileSync(`${dir}/shifts.json`));let checked=0,total=0,published=0;
for(const s of shifts){const v=context.sourceDuration(s);assert.ok(Number.isFinite(v)&&v>=0);checked++;if(s.employee_id==='dd2a7df2-a301-4f2b-9d37-5e246b873adb'&&s.shift_date<='2026-09-20'){total+=v;if(s.status==='published')published+=v;}}
assert.equal(total,445.5);assert.equal(published,423);
assert.equal(normalizePayrollName(' Miércoles '),normalizePayrollName('MIERCOLES'));assert.equal(normalizePayrollName('Sábado'),normalizePayrollName('Sabado'));
assert.equal(moneyCents(0/0),null);assert.equal(moneyCents(Infinity),null);assert.equal(moneyCents(null),null);assert.equal(moneyCents(''),null);assert.equal(moneyCents(0),0);
const contextAnalysis=JSON.parse(fs.readFileSync(`${dir}/context-analysis.json`));
assert.equal(comparePayrollGross(contextAnalysis.totals.estimatedWages,undefined,false).auditStatus,'estimated');
const result={status:'PASS',shiftsChecked:checked,realHelpers:['weekly-ops calcDuration extracted verbatim','normalizePayrollName imported','moneyCents imported','comparePayrollGross imported'],josephAllHours:total,josephPublishedHours:published,unverifiedPayrollStatus:'estimated'};
fs.writeFileSync(`${dir}/source-validation.json`,JSON.stringify(result,null,2));console.log('SOURCE SIMULATION PASS',result);
