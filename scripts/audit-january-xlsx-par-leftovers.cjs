/**
 * @module scripts/audit-january-xlsx-par-leftovers
 * @description Extrae en solo lectura PAR y sobrantes físicos de enero de los XLSX semanales de las 15 tiendas.
 * @businessRules El pedido candidato del día D es max(0, PAR de D+1 − sobrante de D); no se presenta como pedido enviado.
 * @dataFlow Pestañas semanales XLSX → fechas seriales de Excel → PAR C:I y sobrantes K:Q → cobertura y candidatos.
 * @notes Ignora fórmulas/cache R:AI porque algunas contienen #REF! o referencias cruzadas incorrectas; no cambia XLSX ni Supabase.
 */

const fs = require('node:fs')
const path = require('node:path')
const XLSX = require('xlsx')

const root = process.cwd()
const storeFiles = [
  ['Lynwood', 'Lynwood Order.xlsx'],
  ['Slauson', 'ordenes/Slauson Order.xlsx'],
  ['LA Central', 'ordenes/Central Order.xlsx'],
  ['Rialto', 'ordenes/Rialto Order - Experimental .xlsx'],
  ['West Covina', 'ordenes/West Covina Order - Experimental .xlsx'],
  ['Azusa', 'ordenes/Azusa Order - Experimental .xlsx'],
  ['LA Broadway', 'ordenes/Broadway Order - Experimental.xlsx'],
  ['Hollywood', 'ordenes/Hollywood Order.xlsx'],
  ['Santa Ana', 'ordenes/Santa Ana Order - Experimental .xlsx'],
  ['La Puente', 'ordenes/La Puente Order - Experimental .xlsx'],
  ['Huntington Park', 'ordenes/Huntington Park Order - Experimental .xlsx'],
  ['Norwalk', 'ordenes/Norwalk Order - Experimental .xlsx'],
  ['Bell', 'ordenes/Bell Order - Experimental .xlsx'],
  ['South Gate', 'ordenes/South Gate Order - Experimental.xlsx'],
  ['Downey', 'ordenes/Downey Order - Experimental .xlsx'],
]

function dateOf(value) {
  if (typeof value !== 'number' || value < 40000) return null
  const date = XLSX.SSF.parse_date_code(value)
  return date ? `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}` : null
}
function nextDate(day) {
  const date = new Date(`${day}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10)
}
function numeric(cell) {
  if (!cell || cell.v === '' || cell.v === null || cell.v === undefined) return null
  const value = Number(cell.v)
  return Number.isFinite(value) ? value : null
}
function cell(sheet, row, column) { return sheet[XLSX.utils.encode_cell({ r: row - 1, c: column - 1 })] }

const output = { stores: [], duplicateConflicts: [], errors: [] }
const conflictCounts = new Map()
for (const [store, relative] of storeFiles) {
  const file = path.join(root, relative)
  if (!fs.existsSync(file)) { output.errors.push(`Falta ${relative}`); continue }
  const workbook = XLSX.readFile(file, { cellFormula: true })
  const daily = new Map()
  const conflictedKeys = new Set()
  const tabs = []
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    const monday = dateOf(numeric(cell(sheet, 2, 3)))
    if (!monday || monday < '2025-12-29' || monday > '2026-01-26') continue
    if (new Date(`${monday}T12:00:00Z`).getUTCDay() !== 1) continue
    tabs.push({ sheet: sheetName, monday })
    for (let row = 3; row <= 55; row++) {
      const name = cell(sheet, row, 2)?.v
      if (typeof name !== 'string' || !name.trim()) continue
      for (let offset = 0; offset < 7; offset++) {
        const day = dateOf(numeric(cell(sheet, 2, 3 + offset)))
        if (!day || day < '2026-01-01' || day > '2026-02-01') continue
        const par = numeric(cell(sheet, row, 3 + offset))
        const leftover = numeric(cell(sheet, row, 11 + offset))
        const key = `${day}|${name.trim().toLowerCase()}`
        const prior = daily.get(key)
        if (prior) {
          if (prior.par !== par || prior.leftover !== leftover) {
            conflictedKeys.add(key)
            conflictCounts.set(store, (conflictCounts.get(store) || 0) + 1)
            if (output.duplicateConflicts.length < 12) output.duplicateConflicts.push({ store, day, item: name, firstSheet: prior.sheet, secondSheet: sheetName })
          }
          continue
        }
        daily.set(key, { day, item: name.trim(), unit: cell(sheet, row, 1)?.v || null, par, leftover, sheet: sheetName })
      }
    }
  }
  const january = [...daily.values()].filter(record => record.day <= '2026-01-31')
  let withPar = 0; let withLeftover = 0; let candidates = 0; let positiveCandidates = 0; let missingNextPar = 0; let missingLeftover = 0; let excludedConflicts = 0
  const examples = []
  for (const record of january) {
    if (conflictedKeys.has(`${record.day}|${record.item.toLowerCase()}`) || conflictedKeys.has(`${nextDate(record.day)}|${record.item.toLowerCase()}`)) { excludedConflicts++; continue }
    if (record.par !== null) withPar++
    if (record.leftover !== null) withLeftover++
    if (record.leftover === null) { missingLeftover++; continue }
    const next = daily.get(`${nextDate(record.day)}|${record.item.toLowerCase()}`)
    if (!next || next.par === null) { missingNextPar++; continue }
    const quantity = Math.max(0, next.par - record.leftover)
    candidates++
    if (quantity > 0) positiveCandidates++
    if (store === 'Lynwood' && record.item === 'Carne Asada' && ['2026-01-05', '2026-01-06', '2026-01-07'].includes(record.day)) {
      examples.push({ day: record.day, item: record.item, leftover: record.leftover, nextPar: next.par, rawCandidate: quantity, unit: record.unit })
    }
  }
  output.stores.push({ store, file: relative, tabs: tabs.length, januaryDates: new Set(january.map(record => record.day)).size, itemDays: january.length, withPar, withLeftover, candidates, positiveCandidates, missingNextPar, missingLeftover, excludedConflicts, examples })
}
output.totals = output.stores.reduce((sum, row) => {
  for (const key of ['tabs', 'itemDays', 'withPar', 'withLeftover', 'candidates', 'positiveCandidates', 'missingNextPar', 'missingLeftover', 'excludedConflicts']) sum[key] = (sum[key] || 0) + row[key]
  return sum
}, {})
output.conflictCounts = Object.fromEntries(conflictCounts)
console.log(JSON.stringify(output, null, 2))
if (output.errors.length) process.exitCode = 1
