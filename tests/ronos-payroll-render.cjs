/** Render the actual payroll component and language provider using captured calculation results. */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict')
const ts=require('typescript'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server')
const root=path.resolve(__dirname,'..'),cache=new Map()
function load(file){
  const absolute=path.resolve(root,file)
  if(cache.has(absolute))return cache.get(absolute)
  const exports={};cache.set(absolute,exports)
  const code=ts.transpileModule(fs.readFileSync(absolute,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText
  vm.runInNewContext(code,{exports,console,require(name){
    if(name.startsWith('@/')||name.startsWith('.')){
      const target=name.startsWith('@/')?path.join(root,name.slice(2)):path.resolve(path.dirname(absolute),name)
      const resolved=['.ts','.tsx'].map(ext=>target+ext).find(p=>fs.existsSync(p))
      if(!resolved)throw Error('Missing module '+target)
      return load(resolved)
    }
    if(!['react','react/jsx-runtime','lucide-react'].includes(name))throw Error('Unexpected dependency '+name)
    return require(name)
  }},{filename:absolute})
  return exports
}
const Component=load('components/ronos/PayrollReconciliationTab.tsx').default
const Provider=load('lib/i18n.tsx').LanguageProvider
const reports=JSON.parse(fs.readFileSync(process.argv[2],'utf8'))
for(const report of reports){
 const html=renderToStaticMarkup(React.createElement(Provider,null,React.createElement(Component,{
  payrollData:report,payrollLoading:false,payrollError:null,payrollInvoiceMode:'consolidated',setPayrollInvoiceMode(){},
  selectedCompanyId:report.ronosCompanyId,resolvedPayrollPeriodId:'2026-08-24',payrollBiWeekly:true,onRefresh(){}
 })))
 for(const label of ['Recálculo de conceptos aprobados','Sueldo aprobado en Simplify','Factura oficial Cingular','Diferencia por investigar'])assert.ok(html.includes(label),label)
 assert.ok(!/NaN|Infinity|Exportar CSV|Fuentes conciliadas/.test(html))
}
console.log('PASS: actual payroll component and language provider render all '+reports.length+' real reports; distinct sources, no false confirmation, no CSV or invalid numbers')
