import { calculateInventoryUsage } from '../lib/inventory/conversions'

console.log("🛠️ Testing Conversions Logic...")

try {
    // Escenario 1: Libras -> Libras
    const u1 = calculateInventoryUsage(1, 'lb', '10 lb')
    console.log(`1 lb vs 10 lb Bag -> Expect 0.1: Got ${u1}`)

    // Escenario 2: Onzas -> Libras
    const u2 = calculateInventoryUsage(16, 'oz', '10 lb')
    console.log(`16 oz vs 10 lb Bag -> Expect 0.1: Got ${u2}`)

    // Escenario 3: Piezas -> Piezas Paquete
    const u3 = calculateInventoryUsage(2, 'pza', '25 pza')
    console.log(`2 pza vs 25 pza Pack -> Expect 0.08: Got ${u3}`)

    // Escenario 4: Galones
    const u4 = calculateInventoryUsage(1, 'gal', '1 gal')
    console.log(`1 gal vs 1 gal -> Expect 1: Got ${u4}`)

} catch (e) {
    console.error("❌ CRASHED:", e)
}
