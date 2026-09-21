/**
 * @module audit-latest-payroll
 * @description Verifica que las horas trabajadas y las horas de enfermedad
 * se conserven íntegras sin inferencias destructivas, evaluando la lógica del calculador.
 * @businessRules Horas trabajadas y licencia de días distintos deben conservarse ambas.
 * @dataFlow Lee lib/payroll-calculator.ts; extrae su AST; no conecta a DB.
 * @notes Prueba de auditoría aislada; valida el comportamiento corregido.
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../lib/payroll-calculator.ts'), 'utf8');
const ast = ts.createSourceFile('payroll.ts', source, ts.ScriptTarget.Latest, true);

let destructiveCondition = null;
let cardCallbackCode = null;

function visit(node) {
  if (ts.isIfStatement(node) && node.expression.getText(ast).includes('cSick >= cReg')) {
    destructiveCondition = node.getText(ast);
  }
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'agg.rawCards.forEach') {
    cardCallbackCode = node.arguments[0].getText(ast);
  }
  ts.forEachChild(node, visit);
}
visit(ast);

// 1. Confirmar que el condicional destructivo fue eliminado del calculador
assert.equal(destructiveCondition, null, 'El condicional que borraba cReg no debe existir en payroll-calculator.ts');
assert.ok(cardCallbackCode, 'Debe localizar el bloque de acumulación de tarjetas en payroll-calculator.ts');

// 2. Ejecutar la función real de acumulación con múltiples escenarios de negocio
const safeNum = n => { const v = Number(n); return isNaN(v) ? 0 : v; };

function runAccumulator(cards) {
  let regHrs = 0;
  let otHrs = 0;
  let dtHrs = 0;
  let mealHrs = 0;
  let sickHrs = 0;
  let vacHrs = 0;
  let holHrs = 0;
  let grossReg = 0;
  let grossOt = 0;
  let grossDt = 0;
  let grossOther = 0;
  let invReg = 0;
  let invOt = 0;
  let invDt = 0;
  let invOther = 0;
  const payRate = 20;
  const otPayRate = 30;
  const dtPayRate = 40;
  const billRate = 25;
  const otBillRate = 37.5;
  const dtBillRate = 50;

  // Construir función que ejecuta el cuerpo real extraído del AST
  const fn = new Function(
    'cards', 'safeNum', 'payRate', 'otPayRate', 'dtPayRate', 'billRate', 'otBillRate', 'dtBillRate',
    `
    let regHrs = 0, otHrs = 0, dtHrs = 0, mealHrs = 0, sickHrs = 0, vacHrs = 0, holHrs = 0;
    let grossReg = 0, grossOt = 0, grossDt = 0, grossOther = 0;
    let invReg = 0, invOt = 0, invDt = 0, invOther = 0;
    let totPay = 0, totBill = 0;
    const callback = ${cardCallbackCode};
    for (const card of cards) {
      callback(card);
    }
    return { regHrs, sickHrs, otHrs, dtHrs, mealHrs, grossReg, grossOther, totPay, totBill };
    `
  );

  return fn(cards, safeNum, payRate, otPayRate, dtPayRate, billRate, otBillRate, dtBillRate);
}

// Escenario 1: 8 horas trabajadas y 8 sick en días distintos
const s1 = runAccumulator([{ regular_hours: 8, sick_hours: 8, overtime_hours: 0 }]);
console.log(JSON.stringify({ scenario: '8 horas trabajadas y 8 sick en días distintos', actualRegularHours: s1.regHrs, expectedRegularHours: 8, actualSickHours: s1.sickHrs, expectedSickHours: 8 }));
assert.equal(s1.regHrs, 8, 'El agregado semanal debe conservar las 8 horas trabajadas');
assert.equal(s1.sickHrs, 8, 'El agregado semanal debe conservar las 8 horas de enfermedad');

// Escenario 2: 8 horas trabajadas y 4 sick
const s2 = runAccumulator([{ regular_hours: 8, sick_hours: 4, overtime_hours: 0 }]);
assert.equal(s2.regHrs, 8, 'Debe conservar 8 horas regulares cuando sick es menor');
assert.equal(s2.sickHrs, 4, 'Debe conservar 4 horas de enfermedad');

// Escenario 3: 8 horas trabajadas, 8 sick, 2 OT
const s3 = runAccumulator([{ regular_hours: 8, sick_hours: 8, overtime_hours: 2 }]);
assert.equal(s3.regHrs, 8, 'Debe conservar 8 horas regulares con horas extras');
assert.equal(s3.sickHrs, 8, 'Debe conservar 8 horas de enfermedad con horas extras');
assert.equal(s3.otHrs, 2, 'Debe conservar las 2 horas extras');

// Escenario 4: 0 horas trabajadas y 8 sick
const s4 = runAccumulator([{ regular_hours: 0, sick_hours: 8, overtime_hours: 0 }]);
assert.equal(s4.regHrs, 0, 'Debe reflejar 0 regulares si no trabajó');
assert.equal(s4.sickHrs, 8, 'Debe reflejar 8 de enfermedad si estuvo de baja');

console.log('PASS: Todas las pruebas de conservación de horas trabajadas y conceptos de nómina pasaron con éxito.');
