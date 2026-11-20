/**
 * @module lib/kore-shared-speech
 * @description Módulo PURO e ISOMÓRFICO (navegador + servidor) de normalización fonética Speech-to-Text (STT),
 * detección de colisiones ambiguas de carne (`"dos nada"` <-> `"de asada"`) y filtrado de monólogos de TV/radio/YouTube
 * de fondo compartido entre la Contestadora Telefónica IA (`lib/phone-agent.ts`) y Kore Drive-Thru (`lib/drive-thru-kore-order.ts`).
 *
 * @businessRules
 * - **100% Puro e Isomórfico**: CERO imports de `node:*`, `supabase` o módulos de servidor, ya que se ejecuta tanto
 *   en el navegador del simulador/altavoz Drive-Thru como en webhooks de Twilio y API routes de servidor.
 * - **Unificación Bidireccional de STT Real**:
 *   * Platillos y carnes: `"torta corona"` -> `"torta cubana"`, `"salad burrito"` -> `"asada burrito"`,
 *     `"sasada"` -> `"asada"`, `"adobada"` -> `"pastor"`, `"lingua"` -> `"lengua"`, `"puche"`/`"guche"` -> `"buche"`
 *     (respetando apellidos/nombres propios), `"muleta(s)"` -> `"mulita(s)"` (respetando objetos olvidados/muletas médicas).
 *   * Equivalencia `Supreme` = `Super`: `"supreme"` / `"supremo"` / `"suprema"` junto a `burrito`, `quesadilla`,
 *     `mulita` o `nachos` se normaliza a `"Super"`.
 *   * Combos y charolas: `"Taco Play"` -> `"taco plate"`, `"party Play"` / `"party plate"` / `"pari play"` -> `"party tray"`,
 *     `"fiesta playa"` -> `"fiesta platter"`.
 *   * Bebidas, postres, pagos y servicio: `"champorado"`/`"chapurrado"` -> `"champurrado"`, `"orchata"` -> `"horchata"`,
 *     `"un plan"`/`"el plan"` (en contexto comida/postre/orden/precio) -> `"flan"`, `"dritro"`/`"Drive Truck"` -> `"drive-thru"`,
 *     `"tarjetas abc"` -> `"ebt"`, `"cal fresh"` -> `"calfresh"`.
 * - **Colisión Fonética `"nada"` vs `"de asada"`**:
 *   * En `mode === 'phone'` (cotización telefónica sin carrito activo), `"tacos/burritos/... de nada"` y `"quiero dos nada"`
 *     se resuelven directamente a `"de asada"`.
 *   * En Drive-Thru (`detectAmbiguousMeatNadaCollision`), `"Quiero dos nada"`, `"tres nada"`, `"dame dos de nada"` o
 *     `"de nada"` disparan confirmación breve (`"¿Dos de asada?"`) antes de agregar al carrito.
 * - **Filtro de Audio de Fondo (`isLikelyBackgroundMediaSpeech`)**:
 *   * Detecta monólogos largos (`>= 18` palabras, ej. narraciones de TV/YouTube de Fórmula 1, noticias o radio) que no
 *     contienen ningún término de restaurante, comida, bebida, orden, tienda, horario, saludo, teléfono o recado.
 * - **Ventana Oficial de Desayunos (`isKoreBreakfastOpen`, 15 Sucursales)**:
 *   * En las 15 sucursales de Tacos Gavilan los desayunos (`Breakfast`: burritos de huevo, platos de huevos y tortas de huevo)
 *     están disponibles desde la apertura (`>= 06:00 AM` día laboral) hasta antes de las `2:00 PM` (`14:00` en `America/Los_Angeles`).
 *   * Bebidas como `Coffee` y `Champurrado` (`Misc. Drinks`) NO son exclusivas de desayuno y continúan después de las `2:00 PM`.
 *
 * @dataFlow
 * - Entrada cruda de usuario/herramienta -> `normalizeKoreCustomerSpeech` / `detectAmbiguousMeatNadaCollision` /
 *   `isLikelyBackgroundMediaSpeech` -> `lib/drive-thru-kore-order.ts` y `lib/phone-agent.ts`.
 *
 * @notes
 * - Creado en sincronización bidireccional 2026-11-19 a partir de hallazgos forenses reales en `phone_calls` (146 llamadas)
 *   y `dt_kore_sim_sessions` (colisión `"Quiero dos nada"` y captura de YouTube/TV Fórmula 1 Checo Pérez).
 */

export type KoreSpeechChannelMode = 'phone' | 'drive_thru'

export interface NormalizeKoreSpeechOptions {
  mode?: KoreSpeechChannelMode
}

export interface AmbiguousMeatNadaCollision {
  matched: boolean
  quantity: number | null
}

const SPANISH_ENGLISH_QTY_WORDS: Readonly<Record<string, number>> = Object.freeze({
  un: 1,
  uno: 1,
  una: 1,
  one: 1,
  dos: 2,
  two: 2,
  tres: 3,
  three: 3,
  cuatro: 4,
  four: 4,
  cinco: 5,
  five: 5,
  seis: 6,
  six: 6,
  siete: 7,
  seven: 7,
  ocho: 8,
  eight: 8,
  nueve: 9,
  nine: 9,
  diez: 10,
  ten: 10,
  once: 11,
  eleven: 11,
  doce: 12,
  twelve: 12
})

function stripDiacriticsLower(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

function parseQtyToken(rawToken: string | undefined): number | null {
  if (!rawToken) return null
  const clean = stripDiacriticsLower(rawToken.trim())
  if (!clean) return null
  if (/^\d{1,2}$/.test(clean)) {
    const n = Number(clean)
    return n >= 1 && n <= 50 ? n : null
  }
  return SPANISH_ENGLISH_QTY_WORDS[clean] ?? null
}

/**
 * Unifica todas las correcciones fonéticas reales de Speech-to-Text (STT) observadas en
 * llamadas telefónicas (`phone_calls`) y sesiones de altavoz (`dt_kore_sim_sessions`).
 */
export function normalizeKoreCustomerSpeech(rawText: string, opts?: NormalizeKoreSpeechOptions): string {
  const input = String(rawText ?? '')
  if (!input) return ''
  const mode: KoreSpeechChannelMode = opts?.mode === 'phone' ? 'phone' : 'drive_thru'

  const hasDeliveryDriverContext =
    /\b(uber(?:\s*eats)?|doordash|door\s*dash|grubhub|postmates|caviar|repartidor(?:es)?|asignad[oa]s?|entreg[aoó]|delivery\s+driver)\b/i.test(
      input
    )

  const hasMedicalOrLostCrutchesContext =
    /\b(dej[eé]|olvid[eé]|perd[ií]|extravi[eé]|buscando|caminar|fractur|yeso|hospital|silla\s+de\s+ruedas)\b/i.test(
      input
    ) || /\bmis\s+muletas\b/i.test(input)

  const hasProperNamePucheContext =
    /\b(?:soy|me\s+llamo|mi\s+nombre\s+es|habla|apellido|se[ñn]or|sr\.?|sra\.?)\s+(?:[A-Za-zÁÉÍÓÚÑáéíóúñ]+\s+){0,2}(?:puche|guche)\b/i.test(
      input
    )

  let out = input
    // Platillos y especialidades con colisión STT
    .replace(/\btorta(?:s)?\s+coronas?\b/gi, (m) => (/^tortas/i.test(m) ? 'tortas cubanas' : 'torta cubana'))
    .replace(/\ba\s+salad\s+(burritos?)\b/gi, 'asada $1')
    .replace(/\bsalad\s+(burritos?)\b/gi, 'asada $1')
    .replace(/\bfiesta\s+(?:playas?|platers?|platos?|plaza|planes|plays?)\b/gi, 'fiesta platter')
    .replace(/\b(?:party|pari)\s+(?:play|plays|plate|plates|trey|treys)\b/gi, 'party tray')
    .replace(/\btacos?\s+plays\b/gi, 'taco plates')
    .replace(/\btacos?\s+play\b/gi, 'taco plate')
    // Equivalencia Supreme / Supremo / Suprema -> Super junto a burrito, quesadilla, mulita o nachos
    .replace(
      /\b(?:supreme|supremos?|supremas?)\b(?=\s+(?:(?:de|con|of|with|regular|meat|only|all|a|an|el|la|los|las|asada|pastor|adobada|pollo|chicken|steak|cabeza|lengua|buche|chorizo|carnitas|vegetariano|vegetariana|veggie)\s+){0,3}(?:burritos?|quesadillas?|mulitas?|nachos?)\b)/gi,
      'Super'
    )
    .replace(
      /\b(burritos?|quesadillas?|mulitas?|nachos?)(\s+(?:(?:de|con|of|with)\s+)?(?:asada|pastor|adobada|pollo|chicken|steak|cabeza|lengua|buche|chorizo|carnitas|vegetariano|vegetariana|veggie))?\s+(?:supreme|supremos?|supremas?)\b/gi,
      'Super $1$2'
    )
    // Carnes y sinónimos regionales / fonéticos
    .replace(/\b(?:sasadas?|sazadas?|zazadas?)\b/gi, 'asada')
    .replace(/\badobadas?\b/gi, 'pastor')
    .replace(/\badobados?\b/gi, 'pastor')
    .replace(/\blinguas?\b/gi, (m) => (/s$/i.test(m) ? 'lenguas' : 'lengua'))
    // Bebidas
    .replace(/\bch[ao]mpur{1,2}ado(s?)\b/gi, 'champurrado$1')
    .replace(/\b(?:chapurrado|champorado)(s?)\b/gi, 'champurrado$1')
    .replace(/\borchata(s?)\b/gi, 'horchata$1')
    // Festivos, urgencias, pagos y servicio Drive-Thru
    .replace(/\b(?:thansgiving|thanks\s+giving)\b/gi, 'thanksgiving')
    .replace(/\bes\s+insurgente\b/gi, 'es urgente')
    .replace(
      /\b(drive\s*tru|drive\s*true|drive\s*through|drive\s*truck|dritro|dritru|drai\s*tru|draiv\s*tru|dray\s*tru|dry\s*thru|ray\s*tru|raid\s*(?:tru|true|thru|through|threw))\b/gi,
      'drive-thru'
    )
    .replace(
      /\b(tienen?|hay|cuentan?\s+con|con|por\s+el|en\s+el|al|del)\s+(?:raid|ride|drai|dray|dry|drive)\b(?!\s*(?:thru|through|tru|true|-|to\b|in\b|from\b|home\b|away\b|back\b))/gi,
      '$1 drive-thru'
    )
    .replace(/\b(?:tiquet|tique|tiket|tiquete)(s?)\b/gi, 'ticket$1')
    .replace(/\b(?:cal|call|car)\s+fresh\b/gi, 'calfresh')
    .replace(/\b(?:e[\s.-]*b[\s.-]*t\.?|i[\s.-]*b[\s.-]*t\.?|e[\s.-]*v[\s.-]*t\.?|i[\s.-]*v[\s.-]*t\.?|ibiti|ebiti)\b/gi, 'ebt')
    .replace(/\b(?:tarjetas?\s+(?:abc|ibt|evt|ivit)|(?:abc|ibt|evt|ivit)\s+(?:cards?|tarjetas?))\b/gi, 'ebt')

  if (!hasMedicalOrLostCrutchesContext) {
    out = out
      .replace(/(?<!\b(?:dej[eé]|olvid[eé]|perd[ií]|mis?)\s+)\bmuletas\b/gi, 'mulitas')
      .replace(/(?<!\b(?:dej[eé]|olvid[eé]|perd[ií]|mi)\s+)\bmuleta\b/gi, 'mulita')
  }

  if (!hasProperNamePucheContext) {
    out = out.replace(/\b(?:puche|guche)\b/gi, 'buche')
  }

  if (!hasDeliveryDriverContext) {
    out = out.replace(
      /\b(tienen?|con|hay|por\s+el|en\s+el|al|del)\s+drivers?\b(?!\s+(?:de|for|from|assigned|is|was|never|has|did))/gi,
      '$1 drive-thru'
    )
  }

  // "un plan" / "el plan" -> "flan" en contexto de comida, postre, orden o precio (excluyendo planes telefónicos/comerciales)
  const hasTelecomOrBusinessPlanContext =
    /\b(datos|celular|telef[oó]nico|m[oó]vil|internet|pago\s+mensual|negocio|marketing|seguro)\b/i.test(out)
  const hasFoodDessertOrOrderContext =
    /\b(?:cheesecakes?|postres?|desserts?|dulces?|falt[oó]|faltaron|pusieron|ped[ií]|cu[aá]nto|cuesta|cuestan|precio|precios|venden|quiero|dame|deme|me\s+da(?:s)?|agr[eé]ga(?:le|me)?|pon(?:le|me)?|orden(?:ar)?|tacos?|burritos?|tortas?|quesadillas?|mulitas?|sopes?|platos?|nachos?|horchatas?|jamaicas?|aguas?|champurrados?|caf[eé]s?|sodas?|refrescos?|para\s+llevar)\b/i.test(
      out
    ) || (mode === 'drive_thru' && /^\s*(?:un|el|otro)\s+plan\s*[.!?]*\s*$/i.test(out))

  if (!hasTelecomOrBusinessPlanContext && hasFoodDessertOrOrderContext) {
    out = out.replace(/\b(un|el|mi|del|otro)\s+plan\b/gi, '$1 flan')
  }

  // En modo teléfono (cotización informativa de precios): "tacos/burritos/... de nada" y "quiero dos nada" -> "de asada"
  if (mode === 'phone') {
    out = out
      .replace(
        /\b(tacos?|burritos?|tortas?|mulitas?|quesadillas?|sopes?|platos?)\s+(?:de\s+)?nada\b(?!\s+(?:m[aá]s|de)\b)/gi,
        '$1 de asada'
      )
      .replace(
        /(?<!\b(?:no|ni|sin)\s+)\b((?:quiero|quisiera|dame|deme|me\s+das?|cu[aá]nto\s+(?:es|ser[ií]a|ser[ií]an|cuesta|cuestan|sale|salen|vale|valen)(?:\s+por)?|y)\s+)?(un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|doce|\d{1,2})\s+(?:de\s+)?nada\b(?!\s+(?:m[aá]s|de)\b)/gi,
        (_m, prefix: string | undefined, qtyWord: string) => `${prefix || ''}${qtyWord} de asada`
      )
  }

  return out
}

/**
 * Detecta la colisión fonética real de Drive-Thru donde el cliente pide carne asada (`"dos de asada"`, `"de asada"`)
 * y el motor de transcripción escucha `"Quiero dos nada"`, `"tres nada"`, `"dame dos de nada"` o `"de nada"`.
 * Excluye frases legítimas de cierre o negación (`"nada"`, `"nada más"`, `"no quiero nada"`, `"sin nada"`, `"nada de salsa"`).
 */
export function detectAmbiguousMeatNadaCollision(rawText: string): AmbiguousMeatNadaCollision {
  const raw = String(rawText ?? '').trim()
  if (!raw) return { matched: false, quantity: null }

  const norm = stripDiacriticsLower(raw)
    .replace(/[¿¡"“”'’()[\]]+/g, ' ')
    .replace(/[,;.!?]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!norm || norm === 'nada') return { matched: false, quantity: null }
  if (/\b(?:gracias|thank\s+you|thanks)\b/.test(norm) && /\bde\s+nada\b/.test(norm)) {
    return { matched: false, quantity: null }
  }
  if (/\b(?:no|ya\s+no|tampoco)\s+(?:quiero|queria|pedi|ocupo|necesito)\s+nada\b/.test(norm)) {
    return { matched: false, quantity: null }
  }
  if (/\bsin\s+nada\b|\bnada\s+(?:mas|de\b|adicional|extra)\b/.test(norm)) {
    return { matched: false, quantity: null }
  }

  // 1) "<cantidad> [platillo] [de] nada" (ej. "quiero dos nada", "tres nada", "dame dos de nada", "2 burritos de nada")
  const qtyNadaRe =
    /(?<!\b(?:no|sin)\s+)\b(un|uno|una|one|dos|two|tres|three|cuatro|four|cinco|five|seis|six|siete|seven|ocho|eight|nueve|nine|diez|ten|once|eleven|doce|twelve|\d{1,2})\s+(?:(?:tacos?|burritos?|tortas?|mulitas?|quesadillas?|sopes?|platos?|ordenes?|orden)\s+)?(?:de\s+)?nada\b(?!\s+(?:mas|de\b))/i
  const qtyMatch = norm.match(qtyNadaRe)
  if (qtyMatch) {
    return { matched: true, quantity: parseQtyToken(qtyMatch[1]) }
  }

  // 2) "<platillo> [de] nada" sin número inicial (ej. "tacos de nada", "burrito de nada", "burrito nada")
  const dishNadaRe =
    /(?<!\b(?:no|sin)\s+)\b(?:tacos?|burritos?|tortas?|mulitas?|quesadillas?|sopes?|platos?)\s+(?:de\s+)?nada\b(?!\s+(?:mas|de\b))/i
  if (dishNadaRe.test(norm)) {
    return { matched: true, quantity: null }
  }

  // 3) Verbo de pedido + "de nada" o respuesta corta exacta "de nada" tras pregunta "¿De qué carne?"
  if (
    /(?<!\b(?:no|sin)\s+)\b(?:quiero|quisiera|dame|deme|me\s+das?|ponme|ponle|agrega(?:le|me)?|serian?|son)\s+de\s+nada\b(?!\s+(?:mas|de\b))/i.test(
      norm
    ) ||
    /^de\s+nada$/.test(norm)
  ) {
    return { matched: true, quantity: null }
  }

  return { matched: false, quantity: null }
}

/**
 * Vocabulario amplio de dominio de restaurante, menú, orden, sucursal, horarios, pagos, delivery,
 * recursos humanos, saludo telefónico y atención post-orden. Si un monólogo largo (`>= 18` palabras)
 * carece por completo de cualquier término de este dominio, es audio de TV/YouTube/radio/conversación ajena.
 */
const RESTAURANT_OR_CALL_DOMAIN_RE =
  /\b(tacos?|burritos?|quesadillas?|mulitas?|tortas?|sopes?|nachos?|platos?|plates?|combos?|flan(?:es)?|cheesecakes?|postres?|desserts?|pastel(?:es)?|cakes?|churros?|charolas?|platters?|trays?|catering|taquizas?|desayunos?|breakfasts?|huevos?|eggs?|rancheros?|menudo|birria|pozole|suadero|tripas?|asada|pastor|adobada|pollo|chicken|steak|beef|cabeza|lengua|tongue|buche|chorizo|carnitas|milanesa|cuban[oa]s?|vegetarian[oa]s?|veggie|carne|meat|frijol(?:es)?|beans?|arroz|rice|queso|cheese|crema|guacamole|aguacate|avocado|cebollas?|onions?|cilantro|salsas?|limon(?:es)?|limes?|jalapenos?|tortillas?|maiz|corn|harina|flour|chips|totopos|horchatas?|jamaicas?|tamarindos?|pinas?|pineapples?|limonadas?|lemonades?|champurrados?|cafes?|coffees?|cocas?|cokes?|sprites?|fantas?|sodas?|refrescos?|aguas?|waters?|bebidas?|drinks?|galon(?:es)?|gallons?|onzas?|orden(?:es)?|ordenar|orders?|ordering|pedidos?|pedir|precios?|prices?|cuanto|cuesta|cuestan|costs?|subtotal|cobran|cobro|cobraron|pagar|pago|efectivo|cash|tarjetas?|cards?|ebt|calfresh|reembolsos?|refunds?|tickets?|recibos?|receipts?|menu|comida|food|comer|cenar|desayunar|almorzar|llevar|takeout|pickup|recoger|ventanilla|drive|thru|bocina|altavoz|speaker|comedor|restaurantes?|taquerias?|mostrador|caja|gavilan|sucursal(?:es)?|tiendas?|stores?|locations?|abiert[oa]s?|abren|cerrad[oa]s?|cierran|open|closed|close|horarios?|hours?|direccion(?:es)?|domicilio|ubicad[oa]s?|ubicacion|address|estacionamiento|parking|banos?|restrooms?|lynwood|downey|south\s+gate|norwalk|huntington|slauson|broadway|vernon|central|washington|hollywood|covina|azusa|la\s+puente|santa\s+ana|rialto|hola|buenos\s+dias|buenas\s+tardes|buenas\s+noches|disculp[ae]|senorita|oiga|hello|good\s+morning|good\s+afternoon|good\s+evening|excuse\s+me|por\s+favor|please|gracias|thank\s+you|thanks|llamad[oa]s?|llamar|llamando|llame|telefonos?|celulares?|phones?|calling|callback|recados?|mensajes?|messages?|gerentes?|managers?|supervisor(?:es)?|encargad[oa]s?|emplead[oa]s?|employees?|turnos?|shifts?|empleo|vacantes?|contratando|hiring|solicitud|repartidor(?:es)?|doordash|uber|grubhub|postmates|caviar|quejas?|complaints?|equivocad[oa]s?|incomplet[oa]s?|falto|faltaron|missing|olvide|perdi|deje\s+mi|cartera|wallet|bolsa|llaves|keys|proveedor(?:es)?|vendors?|tecnicos?|technicians?|mantenimiento|google\s+listing|seo|paneles\s+solares|solar\s+panels|prestamo\s+comercial|merchant\s+cash)\b/i

/**
 * Detecta si un texto transcrito corresponde probablemente a TV, YouTube, radio, narración deportiva
 * (ej. Fórmula 1 / noticias) o conversación externa captada por el micrófono:
 * - Requiere al menos 18 palabras reales (`>= 18`).
 * - Sin secuencia de teléfono de 7–10 dígitos.
 * - CERO términos de comida, bebida, menú, orden, sucursal, horario, saludo, llamada o recado.
 */
export function isLikelyBackgroundMediaSpeech(rawText: string): boolean {
  const raw = String(rawText ?? '').trim()
  if (!raw) return false

  const norm = stripDiacriticsLower(
    normalizeKoreCustomerSpeech(raw, { mode: 'drive_thru' })
  )
    .replace(/[^\p{L}\p{N}\s-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!norm) return false

  const words = norm.split(' ').filter((w) => w.length > 0)
  if (words.length < 18) return false

  // Si dicta un número telefónico de 7-10 dígitos, nunca clasificar como TV/radio
  const digitsOnly = raw.replace(/\D/g, '')
  if (digitsOnly.length >= 7) return false

  if (RESTAURANT_OR_CALL_DOMAIN_RE.test(norm)) {
    return false
  }

  return true
}

/** Corte oficial de desayunos (regla del dueño, 15 sucursales): disponibles desde las 06:00 hasta antes de las 14:00 PT. */
export const KORE_BREAKFAST_START_MINUTES = 6 * 60
export const KORE_BREAKFAST_CUTOFF_MINUTES = 14 * 60
export const KORE_BREAKFAST_CUTOFF_LABEL = '2:00 PM'

export interface KoreBreakfastWindow {
  open: boolean
  localTimeLabel: string
  hour: number
  minute: number
}

/**
 * Ventana oficial de desayunos en hora local de California (`America/Los_Angeles`, maneja PST/PDT automáticamente):
 * abierta si `06:00 <= hh:mm < 14:00`; cerrada de `14:00` a `05:59` (tarde, turno PM y madrugada).
 */
export function isKoreBreakfastOpen(now: Date = new Date()): KoreBreakfastWindow {
  const safeNow = now instanceof Date && Number.isFinite(now.getTime()) ? now : new Date()
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(safeNow)
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0) % 24
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0)
  const total = hour * 60 + minute
  const h12 = hour % 12 === 0 ? 12 : hour % 12
  const localTimeLabel = `${h12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'} PT`
  return {
    open: total >= KORE_BREAKFAST_START_MINUTES && total < KORE_BREAKFAST_CUTOFF_MINUTES,
    localTimeLabel,
    hour,
    minute
  }
}

/** Platillos exclusivos de desayuno: categoría Toast `Breakfast` (bebidas como Coffee/Champurrado viven en `Misc. Drinks`). */
export function isKoreBreakfastCategory(category: string | null | undefined): boolean {
  return /^\s*(?:breakfast|desayunos?)\s*$/i.test(String(category || ''))
}
