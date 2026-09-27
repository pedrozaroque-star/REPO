const fs = require('fs')
const ts = require('typescript')
const Module = require('module')

function loadTypeScriptModule(path) {
  const source = fs.readFileSync(path, 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, baseUrl: process.cwd(), paths: { '@/*': ['./*'] } },
  }).outputText
  const childModule = new Module(path, module)
  childModule.filename = path
  childModule.paths = Module._nodeModulePaths(process.cwd())
  childModule.require = request => request === './recipe-channels'
    ? loadTypeScriptModule(require('path').join(process.cwd(), 'lib/inventory/recipe-channels.ts'))
    : Module.prototype.require.call(childModule, request)
  childModule._compile(output, path)
  return childModule.exports
}

const { calculateTacoTicketPackaging, calculateTicketPackaging } = loadTypeScriptModule(require('path').join(process.cwd(), 'lib/inventory/ticket-packaging.ts'))
const assert = (condition, message) => { if (!condition) throw new Error(message) }
const quantity = (result, key) => result.lines.find(line => line.key === key)?.quantity || 0
for (const diningOptionName of ['DoorDash - Takeout', 'Uber Eats - Takeout', 'GrubHub Takeout', 'Toast Online']) {
  const result = calculateTicketPackaging({ diningOptionName, diningOptionBehavior: 'TAKE_OUT', source: 'API', selections: [{ name: 'Cheesecake', quantity: 1 }, { name: 'Flan', quantity: 1 }, { name: 'Taco Asada', quantity: 3 }] })
  assert(result.channel === 'to_go' && result.packagingChannel === 'delivery', 'Sales and packaging channels must remain distinct')
  assert(quantity(result, 'WRHEFOBL') === 1 && quantity(result, 'WRHESPBL') === 1 && quantity(result, 'EL1CS2G') === 3, 'Pickup platform must use Delivery supplies')
}
const ordinaryToGo = calculateTicketPackaging({ diningOptionName: 'To Go', source: 'In Store', selections: [{ name: 'Cheesecake', quantity: 1 }] })
assert(ordinaryToGo.packagingChannel === 'to_go' && quantity(ordinaryToGo, 'HEFO') === 1 && quantity(ordinaryToGo, 'EL1CS2G') === 0, 'Cashier To Go must remain unchanged')
const tacoOnlyPickup = calculateTicketPackaging({ diningOptionName: 'DoorDash Takeout', selections: [{ name: 'Taco Asada', quantity: 3 }] })
assert(quantity(tacoOnlyPickup, 'EL1CS2G') === 1, 'Taco-only tickets need a sealed condiment bag')
const { resolveTicketChannel } = loadTypeScriptModule(require('path').join(process.cwd(), 'lib/inventory/recipe-channels.ts'))
assert(resolveTicketChannel({ diningOption: 'DoorDash - Takeout', source: 'API' }) === 'to_go', 'Takeout must prevail over platform name')
assert(resolveTicketChannel({ diningOption: 'Toast Online', behavior: 'TAKE_OUT' }) === 'to_go', 'Online uses configured behavior')
assert(resolveTicketChannel({ diningOption: 'Drive Thru', behavior: 'DINE_IN' }) === 'drive_thru', 'Explicit Drive Thru must prevail over Toast behavior')
for (const source of ['API', 'Online', 'In Store', null]) {
  const result = calculateTicketPackaging({ source, selections: [{ name: 'Taco Asada', quantity: 3 }] })
  assert(result.channel === 'unknown' && result.lines.length === 0, 'Generic origin must not invent a channel or consumption')
}

const delivery = calculateTacoTicketPackaging({
  diningOptionName: 'DoorDash Delivery',
  selections: [
    { name: 'Taco Asada', quantity: 3 },
    { name: 'Separator', quantity: 1 },
    { name: 'Taco Pollo', quantity: 3 },
  ],
})
assert(delivery.channel === 'delivery', 'Delivery channel was not detected')
assert(JSON.stringify(delivery.tacoGroups) === JSON.stringify([3, 3]), 'Separator did not split taco groups')
assert(quantity(delivery, 'plate_9in') === 2, 'Six separated tacos need two plates')
assert(quantity(delivery, 'taco_cover') === 2, 'Delivery needs two covers')
assert(quantity(delivery, 'salsa_roja_pack') === 1 && quantity(delivery, 'salsa_verde_pack') === 1, 'Salsa colors were not allocated by meat')
assert(quantity(delivery, 'mixta_bag') === 3 && quantity(delivery, 'lime_bag') === 2, 'Taco condiment ratios are incorrect')

const forHere = calculateTacoTicketPackaging({
  diningOptionName: 'Dine In',
  selections: [{ name: 'Taco Pastor', quantity: 6 }],
})
assert(forHere.channel === 'for_here', 'For Here channel was not detected')
assert(quantity(forHere, 'plate_9in') === 2, 'Six tacos without separator need two plates')
assert(quantity(forHere, 'taco_cover') === 0, 'For Here must not use Taco Cover')

const unknown = calculateTacoTicketPackaging({
  diningOptionName: 'Drive Thru',
  selections: [{ name: 'Taco Especial', quantity: 2 }],
})
assert(unknown.unclassifiedTacoCount === 2 && unknown.warnings.length === 1, 'Unknown protein must be visible, not silently guessed')
assert(quantity(unknown, 'taco_cover') === 1, 'Drive Thru must use Taco Cover')

const mixedTicket = calculateTicketPackaging({
  diningOptionName: 'Uber Eats Delivery',
  selections: [
    { name: 'Taco Plate Pollo', quantity: 1 },
    { name: 'Sope Asada', quantity: 3 },
    { name: 'Super Mulita Pastor', quantity: 3 },
    { name: 'Quesadilla Pollo', quantity: 1 },
    { name: 'Cheesecake', quantity: 1 },
    { name: 'Flan', quantity: 1 },
  ],
})
assert(quantity(mixedTicket, '983BLKB') === 1 && quantity(mixedTicket, '983LID') === 1, 'Taco Plate must use its base and Delivery lid')
assert(quantity(mixedTicket, '981BLKB') === 1 && quantity(mixedTicket, '981LID') === 1 && quantity(mixedTicket, 'UP918PR') === 1, 'Three delivery sopes must use one pair container plus one UP918PR')
assert(quantity(mixedTicket, 'plate_9in') === 3 && quantity(mixedTicket, 'taco_cover') === 3, 'Three mulitas plus one quesadilla need three covered plates')
assert(quantity(mixedTicket, 'WRHEFOBL') === 1 && quantity(mixedTicket, 'WRHESPBL') === 1, 'Delivery desserts need black wrapped utensils')
// Pruebas añadidas: Phone -> To Go, PostMates -> Delivery, y Huevos Rancheros -> Breakfast
assert(resolveTicketChannel({ diningOption: 'Phone' }) === 'to_go', 'Phone orders must resolve to to_go')
assert(resolveTicketChannel({ diningOption: 'PostMates' }) === 'delivery', 'PostMates orders must resolve to delivery')

const breakfastTicket = calculateTicketPackaging({
  diningOptionName: 'Phone',
  selections: [
    { name: 'Huevos Rancheros', quantity: 2, modifiers: [{ name: 'Asada' }] },
  ],
})
assert(breakfastTicket.channel === 'to_go' && breakfastTicket.packagingChannel === 'to_go', 'Phone breakfast must be to_go')
assert(quantity(breakfastTicket, 'jalapeno_2oz_bag') === 2, 'Two breakfast plates need 2 jalapeno bags')
assert(quantity(breakfastTicket, 'salsa_roja_pack') === 4, 'Two breakfast plates with Asada need 4 red salsa packs')

console.log('Extended simulation passed: Taco Plate, sopes, mulitas, quesadilla, dessert utensils, sealed delivery bags, Phone/PostMates channels and Huevos Rancheros breakfast.')
console.log('Ticket packaging runtime simulation passed: delivery separators, channel covers, color allocation, ratios and unresolved-protein audit.')
