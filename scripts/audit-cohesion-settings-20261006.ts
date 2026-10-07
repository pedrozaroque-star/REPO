/**
 * @module audit-cohesion-settings-20261006
 * @description Auditoría reproducible de configuración Cohesion con AST, callbacks originales y capturas reales.
 * @businessRules No modifica configuración ni publica pólizas; verifica el contrato de persistencia.
 * @dataFlow Código TSX/API + capturas Cohesion + snapshot Supabase -> evidencia JSON local.
 * @notes Ejecuta expresiones originales; no sustituye clientes externos ni afirma un smoke de mutación.
 */
import fs from 'node:fs'
import vm from 'node:vm'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import ts from 'typescript'
import { getQBStoreRefs } from '../lib/qb-classes-locations'

const paths = ['app/contabilidad/configuracion/page.tsx', 'app/api/accounting/site-mappings/route.ts', 'app/api/accounting/gl-accounts/route.ts', 'lib/qb-classes-locations.ts']
const sources = paths.map(p => fs.readFileSync(p, 'utf8'))
const page = ts.createSourceFile(paths[0], sources[0], ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const nodes: ts.Node[] = []
function walk(n: ts.Node) { nodes.push(n); ts.forEachChild(n, walk) }
walk(page)
const variable = (name: string) => nodes.find(n => ts.isVariableDeclaration(n) && n.name.getText(page) === name) as ts.VariableDeclaration
const run = (code: string, context: Record<string, unknown> = {}) => vm.runInNewContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context)
const snapshot = JSON.parse(fs.readFileSync('docs/cohesion-audit-20261006/db-snapshot.json', 'utf8'))
const catalog = JSON.parse(fs.readFileSync('docs/cohesion-audit-20261006/db-access-catalog.json', 'utf8'))
const mappings = snapshot.mappings as Record<string, any>[]
const stores = snapshot.stores as Record<string, any>[]
assert.equal(mappings.length, 15)
assert.equal(stores.length, 15)
const controls = nodes.filter(n => ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n)).map(n => {
  const e = n as ts.JsxSelfClosingElement
  const attrs = Object.fromEntries(e.attributes.properties.filter(ts.isJsxAttribute).map(a => [a.name.getText(page), a.initializer?.getText(page) || 'true']))
  return { tag: e.tagName.getText(page), line: page.getLineAndCharacterOfPosition(n.getStart(page)).line + 1, attrs }
}).filter(e => ['input', 'select', 'AccountSelect', 'ClassSelect'].includes(e.tag))
const localStates = ['discountAccount', 'incCustomerReceivables', 'addCustomerNameMemo', 'addRevenueCenterMemo', 'ccFeeValidation', 'checkOpenOrders']
const save = variable('handleSave').initializer!.getText(page)
const disconnected = localStates.filter(s => !new RegExp(`\\b${s}\\b`).test(save))
assert.equal(disconnected.length, 6, 'Six local workflow settings are absent from save payload')
const classHandler = nodes.find(n => ts.isJsxAttribute(n) && n.name.getText(page) === 'onChange' && n.initializer?.getText(page).includes('qb_class: v')) as ts.JsxAttribute
let result: any
run(`(${(classHandler.initializer as ts.JsxExpression).expression!.getText(page)})('Bell')`, { formData: mappings[0], setFormData: (v: unknown) => { result = v } })
assert.equal(result.qb_class, 'Bell', 'Row override changes store-wide class')
const api = sources[1]
const allow = run(`(${api.match(/const allowedFields = (\[[\s\S]*?\])/ )![1]})`) as string[]
assert(!allow.some(s => /memo|discount|validation|facilitator/.test(s)))
const unloaded = controls.filter(c => c.tag === 'input' && !c.attrs.onChange && (c.attrs.defaultValue || c.attrs.defaultChecked))
assert(unloaded.length > 0)
const captured = fs.readdirSync('cohesion_dump/live_settings').filter(f => /^0[1-9].*json$/.test(f)).map(file => {
  const x = JSON.parse(fs.readFileSync(`cohesion_dump/live_settings/${file}`, 'utf8'))
  return { file, tab: x.activeTab, sites: [...new Set(x.allTabs.map((a: any) => new URL(a.href, 'https://capture.invalid').searchParams.get('siteName')))], selects: x.selects.map((a: any) => ({ id: a.id, name: a.name, selectedText: a.selectedText })), inputs: x.inputs.map((a: any) => ({ id: a.id, name: a.name, value: a.value, checked: a.checked })) }
})
assert.equal(captured.length, 9)
assert(captured.every(x => x.sites.length === 1 && x.sites[0] === 'AZUSA'))
const gl = catalog.glAccounts as any[]
const missing = mappings.flatMap(m => Object.entries(m).filter(([k,v]) => (k.endsWith('_account') || k === 'bank_account_number') && v && !gl.some(a => a.account_number === v)).map(([field,value]) => ({ store_id: m.store_id, field, value })))
const refs = stores.map(s => ({ id: s.id, name: s.name, refs: getQBStoreRefs(s.name) }))
const unknown = ['', 'Tienda Desconocida', 'Miércoles', 'Miercoles', 'Sábado', 'Sabado'].map(name => ({ name, refs: getQBStoreRefs(name) }))
assert.equal(getQBStoreRefs('').cohCustomerName, 'AZUSA-COH')
assert.equal(getQBStoreRefs('Tienda Desconocida').bankAccount, '10000')
const evidence = { capturedAt: new Date().toISOString(), hashes: Object.fromEntries(paths.map((p,i) => [p, crypto.createHash('sha256').update(sources[i]).digest('hex')])), checks: 'PASS: reproduction of defects, not acceptance of module', disconnected, unloaded, controls, original: captured, mappingAccountMissingFromCatalog: missing, stores: refs, unknownNames: unknown, allowedFields: allow, snapshotCapturedAt: snapshot.capturedAt }
fs.writeFileSync('docs/cohesion-audit-20261006/settings-evidence.json', JSON.stringify(evidence, null, 2))
console.log(JSON.stringify({ result: evidence.checks, stores: refs.length, tabs: captured.length, disconnected, uncontrolled: unloaded.length, missingCatalogAccounts: missing.length, snapshot: snapshot.capturedAt }, null, 2))
