/**
 * Cálculo exacto de Food Cost por Party Tray corrigiendo costo por unidad de compra
 */
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://ywwwdcvgfculqmcfkihq.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl3d3dkY3ZnZmN1bHFtY2ZraWhxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NjQyNDE4NiwiZXhwIjoyMDgyMDAwMTg2fQ.66P0FVgOuTV47tfSQ1r5FaFg8zSSwykw5DDIG33R_OA'
)

async function calculatePartyTrayFoodCosts() {
  console.log('=== CÁLCULO EXACTO DE FOOD COST POR PARTY TRAY (PRECIOS REALES POR LB/PZA) ===\n')

  const { data: items } = await supabase
    .from('inventory_items')
    .select('id, name, unit_type, purchase_unit_cost, quantity_per_unit, yield_percent, sku')

  function getItem(search: string) {
    const s = search.toLowerCase()
    return (items || []).find(i => i.name.toLowerCase().includes(s))
  }

  const asada = getItem('carne asada')
  const pollo = getItem('pollo')
  const pastor = getItem('pastor')
  const arroz = getItem('arroz')
  const frijol = getItem('frijol molido')
  const tortillaCorn = getItem('1100 tortilla')
  const tortillaFlour = getItem('358_9604bt') // 8 in
  const salsaRoja = getItem('1.5 oz salsa roja pack')
  const salsaVerde = getItem('1.5 oz salsa verde pack')
  const cebolla = getItem('1 oz bolsa de mixta')
  const limones = getItem('lima bolsita')
  const jalapeño = getItem('2 oz bolsas de rajas')
  const horchata = getItem('horchata')
  const vasos = getItem('el gavilan - cup, 22 oz')

  // Costo por libra/unidad real (dividiendo purchase_unit_cost / quantity_per_unit si aplica)
  const asadaCostPerLb = (asada?.purchase_unit_cost || 60) / (asada?.quantity_per_unit || 10) // $6/lb
  const polloCostPerLb = (pollo?.purchase_unit_cost || 15) / (pollo?.quantity_per_unit || 10) // $1.50/lb
  const pastorCostPerLb = (pastor?.purchase_unit_cost || 21.36) / (pastor?.quantity_per_unit || 10) // $2.14/lb
  const arrozCostPerLb = (arroz?.purchase_unit_cost || 4.45) / (arroz?.quantity_per_unit || 5) // $0.89/lb
  const frijolCostPerLb = (frijol?.purchase_unit_cost || 3.30) / (frijol?.quantity_per_unit || 10) // $0.33/lb

  // Costo crudo ajustado por yield %
  const costAsadaLbRaw = asadaCostPerLb / ((asada?.yield_percent || 61.5) / 100) // $9.76/lb cruda equivalente
  const costPolloLbRaw = polloCostPerLb / ((pollo?.yield_percent || 65.0) / 100) // $2.31/lb cruda equivalente
  const costPastorLbRaw = pastorCostPerLb / ((pastor?.yield_percent || 61.5) / 100) // $3.47/lb cruda equivalente

  const costCornTortillaPza = (tortillaCorn?.purchase_unit_cost || 1.50) / 60
  const costFlourTortillaPza = (tortillaFlour?.purchase_unit_cost || 1.22) / 12

  const costSalsaRojaPack = (salsaRoja?.purchase_unit_cost || 23.30) / 400
  const costSalsaVerdePack = (salsaVerde?.purchase_unit_cost || 19.10) / 400
  const costMixtaPack = (cebolla?.purchase_unit_cost || 27.18) / 190
  const costLimaPack = (limones?.purchase_unit_cost || 15.36) / 210
  const costJalapeñoOz = (jalapeño?.purchase_unit_cost || 25.00) / (165 * 2)

  const costHorchataGal = (horchata?.purchase_unit_cost || 4.50)

  // Estimación desechables estándar (platos $0.12, tenedor $0.03, cuchara $0.03, vaso $0.05, servilletas $0.01)
  const costPlato = 0.12
  const costFork = 0.03
  const costSpoon = 0.03
  const costVaso = (vasos?.purchase_unit_cost || 50.20) / (vasos?.quantity_per_unit || 1000)
  const costNapkin = 0.01

  console.log('📋 PRECIOS DE COMPRA REALES EN QUICKBOOKS:')
  console.log(`   Carne Asada: $${asadaCostPerLb.toFixed(2)}/lb (Cruda equiv con yield ${asada?.yield_percent}%: $${costAsadaLbRaw.toFixed(2)}/lb)`)
  console.log(`   Pollo: $${polloCostPerLb.toFixed(2)}/lb (Cruda equiv con yield ${pollo?.yield_percent}%: $${costPolloLbRaw.toFixed(2)}/lb)`)
  console.log(`   Pastor: $${pastorCostPerLb.toFixed(2)}/lb (Cruda equiv con yield ${pastor?.yield_percent}%: $${costPastorLbRaw.toFixed(2)}/lb)`)
  console.log(`   Arroz: $${arrozCostPerLb.toFixed(2)}/lb`)
  console.log(`   Frijol Molido: $${frijolCostPerLb.toFixed(2)}/lb`)
  console.log(`   Tortilla Maíz (60 ct): $${tortillaCorn?.purchase_unit_cost} ($${costCornTortillaPza.toFixed(4)}/ct)`)
  console.log(`   Tortilla Harina (12 ct): $${tortillaFlour?.purchase_unit_cost} ($${costFlourTortillaPza.toFixed(4)}/ct)`)
  console.log(`   Salsa Roja Pack (400 ct): $${salsaRoja?.purchase_unit_cost} ($${costSalsaRojaPack.toFixed(4)}/pack)`)
  console.log(`   Salsa Verde Pack (400 ct): $${salsaVerde?.purchase_unit_cost} ($${costSalsaVerdePack.toFixed(4)}/pack)`)
  console.log(`   Bolsita Mixta (190 ct): $${cebolla?.purchase_unit_cost} ($${costMixtaPack.toFixed(4)}/pack)`)
  console.log(`   Lima Bolsita (210 ct): $${limones?.purchase_unit_cost} ($${costLimaPack.toFixed(4)}/pack)`)
  console.log(`   Horchata Concentrado (1 gal): $${costHorchataGal.toFixed(2)}/gal`)
  console.log('\n' + '─'.repeat(90) + '\n')

  const sizes = [
    {
      name: 'Party Tray 15 - 20 People',
      price: 185.00,
      riceLbs: 3,
      beansLbs: 3,
      meatLbs: 6,
      plates: 30,
      forks: 15,
      spoons: 15,
      cups: 20,
      napkinsPks: 1,
      salsaRoja: 12,
      salsaVerde: 12,
      onions: 16,
      limes: 16,
      jalapeñosOz: 8,
      cornPks: 2, // 2 pk = 120 tortillas
      flourPks: 5, // 5 pk = 60 tortillas
      aguasGal: 3
    },
    {
      name: 'Party Tray 20 - 25 People',
      price: 235.00,
      riceLbs: 4,
      beansLbs: 4,
      meatLbs: 7.5,
      plates: 35,
      forks: 15,
      spoons: 15,
      cups: 25,
      napkinsPks: 1,
      salsaRoja: 16,
      salsaVerde: 16,
      onions: 20,
      limes: 20,
      jalapeñosOz: 12,
      cornPks: 3,
      flourPks: 7,
      aguasGal: 4
    },
    {
      name: 'Party Tray 25 - 30 People',
      price: 295.00,
      riceLbs: 6,
      beansLbs: 6,
      meatLbs: 10,
      plates: 40,
      forks: 20,
      spoons: 20,
      cups: 30,
      napkinsPks: 2,
      salsaRoja: 20,
      salsaVerde: 20,
      onions: 20,
      limes: 20,
      jalapeñosOz: 16,
      cornPks: 4,
      flourPks: 9,
      aguasGal: 5
    },
    {
      name: 'Party Tray 30 - 40 People',
      price: 365.00,
      riceLbs: 10,
      beansLbs: 10,
      meatLbs: 12,
      plates: 50,
      forks: 25,
      spoons: 25,
      cups: 40,
      napkinsPks: 3,
      salsaRoja: 24,
      salsaVerde: 24,
      onions: 30,
      limes: 30,
      jalapeñosOz: 20,
      cornPks: 5,
      flourPks: 12,
      aguasGal: 6
    }
  ]

  for (const s of sizes) {
    const costMeatAsada = s.meatLbs * costAsadaLbRaw
    const costMeatPollo = s.meatLbs * costPolloLbRaw
    const costMeatPastor = s.meatLbs * costPastorLbRaw
    const costMeatMix = (costMeatAsada + costMeatPollo) / 2 // 50% Asada + 50% Pollo

    const costRice = s.riceLbs * arrozCostPerLb
    const costBeans = s.beansLbs * frijolCostPerLb
    const costSalsas = (s.salsaRoja * costSalsaRojaPack) + (s.salsaVerde * costSalsaVerdePack)
    const costCondiments = (s.onions * costMixtaPack) + (s.limes * costLimaPack) + (s.jalapeñosOz * costJalapeñoOz)
    const costTortillas = (s.cornPks * 60 * costCornTortillaPza) + (s.flourPks * 12 * costFlourTortillaPza)
    const costAguas = s.aguasGal * costHorchataGal
    const costPackaging = (s.plates * costPlato) + (s.forks * costFork) + (s.spoons * costSpoon) + (s.cups * costVaso) + (s.napkinsPks * 50 * costNapkin)

    const totalCostAsada = costMeatAsada + costRice + costBeans + costSalsas + costCondiments + costTortillas + costAguas + costPackaging
    const totalCostPollo = costMeatPollo + costRice + costBeans + costSalsas + costCondiments + costTortillas + costAguas + costPackaging
    const totalCostMix = costMeatMix + costRice + costBeans + costSalsas + costCondiments + costTortillas + costAguas + costPackaging

    const pctAsada = (totalCostAsada / s.price) * 100
    const pctPollo = (totalCostPollo / s.price) * 100
    const pctMix = (totalCostMix / s.price) * 100

    console.log(`🎉 === ${s.name.toUpperCase()} ===`)
    console.log(`   Precio Venta POS: $${s.price.toFixed(2)}`)
    console.log(`   DESGLOSE DE COSTOS ($):`)
    console.log(`     🥩 Carne (Asada): $${costMeatAsada.toFixed(2)}  |  Pollo: $${costMeatPollo.toFixed(2)}`)
    console.log(`     🍚 Arroz (${s.riceLbs} lbs): $${costRice.toFixed(2)}`)
    console.log(`     🫘 Frijol (${s.beansLbs} lbs): $${costBeans.toFixed(2)}`)
    console.log(`     🌶️ Salsas: $${costSalsas.toFixed(2)}`)
    console.log(`     🧅 Cebolla, Limones, Jalapeños: $${costCondiments.toFixed(2)}`)
    console.log(`     🌮 Tortillas: $${costTortillas.toFixed(2)}`)
    console.log(`     🥤 Aguas Frescas: $${costAguas.toFixed(2)}`)
    console.log(`     📦 Platos, Vasos, Cubiertos, Servilletas: $${costPackaging.toFixed(2)}`)
    console.log(`   ───────────────────────────────────────────────────────────`)
    console.log(`   💵 COSTO CON ASADA: $${totalCostAsada.toFixed(2)}   ──>  FOOD COST: ${pctAsada.toFixed(2)}%`)
    console.log(`   💵 COSTO CON POLLO: $${totalCostPollo.toFixed(2)}   ──>  FOOD COST: ${pctPollo.toFixed(2)}%`)
    console.log(`   💵 COSTO MIXTO (50/50): $${totalCostMix.toFixed(2)}   ──>  FOOD COST: ${pctMix.toFixed(2)}%\n`)
  }

  console.log('=== FIN DEL CÁLCULO ===')
}

calculatePartyTrayFoodCosts().catch(console.error)
