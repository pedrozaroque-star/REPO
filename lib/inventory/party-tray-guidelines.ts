/**
 * @module lib/inventory/party-tray-guidelines
 * @description Fuente única de las cantidades operativas de Party Trays / Fiesta Platters de Tacos Gavilan.
 * @businessRules
 *   - La guía determina cantidades por rango de personas; no se infieren desde precio salvo cuando Toast omite el rango.
 *   - Maíz y harina son alternativas: si el ticket contiene ambas, cada una recibe 50% de su cantidad indicada.
 *   - Un par RC478 + 709DO protege hasta 60 tortillas (30 pares); se redondea hacia arriba por seguridad alimentaria.
 *   - Cada paquete de maíz contiene 60 tortillas y cada paquete de harina contiene 12.
 * @dataFlow
 *   Toast PMIX name/price → resolvePartyTrayGuideline() → Food Cost, detalle de receta y consumo teórico.
 * @notes
 *   - Basado en Party Tray Guidelines proporcionado por operación el 2026-09-23.
 */

export type PartyTraySize = '15-20' | '20-25' | '25-30' | '30-40'

export interface PartyTrayGuideline {
  riceLbs: number
  beansLbs: number
  meatLbs: number
  plates: number
  forks: number
  spoons: number
  cups: number
  napkinPacks: number
  salsaRojaPacks: number
  salsaVerdePacks: number
  mixtaBags: number
  limeBags: number
  jalapenoOz: number
  cornPacks: number
  flourPacks: number
  aguaGallons: number
  foodTraySize: 'third' | 'half' | 'full'
}

export const PARTY_TRAY_GUIDELINES: Record<PartyTraySize, PartyTrayGuideline> = {
  '15-20': { riceLbs: 3, beansLbs: 3, meatLbs: 6, plates: 30, forks: 15, spoons: 15, cups: 20, napkinPacks: 1, salsaRojaPacks: 12, salsaVerdePacks: 12, mixtaBags: 16, limeBags: 16, jalapenoOz: 8, cornPacks: 2, flourPacks: 5, aguaGallons: 3, foodTraySize: 'third' },
  '20-25': { riceLbs: 4, beansLbs: 4, meatLbs: 7.5, plates: 35, forks: 15, spoons: 15, cups: 25, napkinPacks: 1, salsaRojaPacks: 16, salsaVerdePacks: 16, mixtaBags: 20, limeBags: 20, jalapenoOz: 12, cornPacks: 3, flourPacks: 7, aguaGallons: 4, foodTraySize: 'half' },
  '25-30': { riceLbs: 6, beansLbs: 6, meatLbs: 10, plates: 40, forks: 20, spoons: 20, cups: 30, napkinPacks: 2, salsaRojaPacks: 20, salsaVerdePacks: 20, mixtaBags: 20, limeBags: 20, jalapenoOz: 16, cornPacks: 4, flourPacks: 9, aguaGallons: 5, foodTraySize: 'half' },
  '30-40': { riceLbs: 10, beansLbs: 10, meatLbs: 12, plates: 50, forks: 25, spoons: 25, cups: 40, napkinPacks: 3, salsaRojaPacks: 24, salsaVerdePacks: 24, mixtaBags: 30, limeBags: 30, jalapenoOz: 20, cornPacks: 5, flourPacks: 12, aguaGallons: 6, foodTraySize: 'full' },
}

export const PARTY_TRAY_FOOD_TRAY_ITEMS = {
  third: { containerId: '66da6c4c-9811-4b53-9464-c95709e8da37', lidId: '7c5de7da-9a01-4a21-ad08-8203c2d8ad91' },
  half: { containerId: 'd415c752-ee89-4ff0-af67-f1499f9d7fa3', lidId: '93379ffd-cb66-4521-8561-17b5c5f90603' },
  full: { containerId: 'e1a10e05-6810-4fd7-923a-1d1fb356019a', lidId: '7c1d3e70-0fe0-40c1-8847-0d2467020264' },
} as const

/** Cada paquete operativo de DX900GE contiene 250 servilletas; la caja contiene 24 paquetes. */
export const PARTY_TRAY_NAPKINS_PER_PACK = 250

const normalized = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

export function resolvePartyTraySize(itemName: string, unitPrice = 0): PartyTraySize {
  const name = normalized(itemName)
  if (name.includes('30-40') || name.includes('30 - 40') || unitPrice >= 310) return '30-40'
  if (name.includes('25-30') || name.includes('25 - 30') || unitPrice >= 265) return '25-30'
  if (name.includes('20-25') || name.includes('20 - 25') || unitPrice >= 220) return '20-25'
  return '15-20'
}

export function getPartyTrayTortillaAllocation(itemName: string, guideline: PartyTrayGuideline) {
  const name = normalized(itemName)
  const hasCorn = name.includes('maiz') || name.includes('corn')
  const hasFlour = name.includes('harina') || name.includes('flour')
  const splitBetweenBoth = hasCorn && hasFlour
  const cornPacks = hasCorn ? guideline.cornPacks * (splitBetweenBoth ? 0.5 : 1) : hasFlour ? 0 : guideline.cornPacks
  const flourPacks = hasFlour ? guideline.flourPacks * (splitBetweenBoth ? 0.5 : 1) : 0
  const totalTortillas = cornPacks * 60 + flourPacks * 12

  return {
    cornPacks,
    flourPacks,
    cornTortillas: cornPacks * 60,
    flourTortillas: flourPacks * 12,
    containerPairs: Math.ceil(totalTortillas / 60),
  }
}
