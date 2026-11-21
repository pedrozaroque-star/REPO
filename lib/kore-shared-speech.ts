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
 * - **Filtro de Audio de Fondo e Intención Directa en Turnos Mixtos (`isLikelyBackgroundMediaSpeech` + `extractDirectCustomerIntentFromNoisyTurn`)**:
 *   * `hasDirectCustomerAudioCheck` detecta interpelaciones directas de verificación de audio (`"¿me escuchas?"`, `"¿sí me escuchas o no?"`,
 *     `"can you hear me"`, `"are you there"`, `"¿estás ahí?"`).
 *   * `isLikelyBackgroundMediaSpeech` devuelve `false` siempre que el turno contenga cualquier interpelación directa o término claro de orden/restaurante
 *     de Tacos Gavilan (jamás descarta turnos mixtos TV + cliente), y devuelve `true` tanto en monólogos puros de TV/YouTube/radio (`>= 12` palabras sin
 *     dominio de restaurante/teléfono/audio-check) como en frases cortas con marcadores explícitos de YouTube/streaming/videojuegos (`"dejen su like"`,
 *     `"GTA 6"`, `"DLSS"`, `"neural rendering"`, `"Xbox"`, `"modders"`, etc.) sin intención del cliente.
 *   * `extractDirectCustomerIntentFromNoisyTurn` separa cláusulas ajenas de TV/YouTube (ej. GTA VI / Xbox / modders) del segmento real hablado por el cliente.
 * - **Ventana Oficial de Desayunos (`isKoreBreakfastOpen`, 15 Sucursales)**:
 *   * En las 15 sucursales de Tacos Gavilan los desayunos (`Breakfast`: burritos de huevo, platos de huevos y tortas de huevo)
 *     están disponibles desde la apertura (`>= 06:00 AM` día laboral) hasta antes de las `2:00 PM` (`14:00` en `America/Los_Angeles`).
 *   * Bebidas como `Coffee` y `Champurrado` (`Misc. Drinks`) NO son exclusivas de desayuno y continúan después de las `2:00 PM`.
 *
 * @dataFlow
 * - Entrada cruda de usuario/herramienta -> `normalizeKoreCustomerSpeech` / `detectAmbiguousMeatNadaCollision` /
 *   `hasDirectCustomerAudioCheck` / `extractDirectCustomerIntentFromNoisyTurn` / `isLikelyBackgroundMediaSpeech` ->
 *   `lib/drive-thru-kore-order.ts`, `lib/drive-thru-kore-learning.ts` y `lib/phone-agent.ts`.
 *
 * @notes
 * - Creado en sincronización bidireccional 2026-11-19 a partir de hallazgos forenses reales en `phone_calls` (146 llamadas)
 *   y `dt_kore_sim_sessions` (colisión `"Quiero dos nada"` y captura de YouTube/TV Fórmula 1 Checo Pérez).
 * - Calibrado 2026-11-21 con sesión forense `9026505b-9896-4635-82d0-45a580ac88e8` (`#14 Lynwood`, YouTube GTA VI/Xbox de fondo +
 *   cliente preguntando `"¿Sí me escuchas o no?"` y ordenando `"Quiero un burrito y cinco tacos de asada"`).
 * - Calibrado Fase 21 (`2026-11-21`, sesión forense `99d29f93-7ad2-478d-99f7-015f9c7f2c82` en `#14 Lynwood`):
 *   marcadores de capturadoras/30 FPS (`30 fps`, `capado a`, `capturadora`, `me patrocinó`), verbos copulativos colgantes (`es|son|sea`)
 *   y candado determinista `isExplicitWholeOrderCancelIntent` / `shouldBlockUnconfirmedCancelOrder` contra `cancel_order` ante `"Olvídalo entonces."`.
 * - Calibrado Fase 22 (`2026-11-21`, Soporte Multilingüe Universal): detector determinista `detectKoreThirdLanguage`
 *   (`ko`, `zh`, `ja`, `pt`, `fr`, `tl`, `vi`, `ar`, `ru`, `hi`, `hy`, `de`, `it`) sin falsos positivos en español/inglés,
 *   discriminación `hasMeaningfulNonLatinCustomerSpeech` vs `isNonLatinNoiseTranscript` (preservando bloqueo de `"जी के"`, `"だいたい"`,
 *   `"担当者の責任"`, `"ㅋㅋ"`, `"अ"`, `"嗯"`), y soporte multilingüe en audio-check, espera `45 s` y cancelación explícita.
 */

export type KoreSpeechChannelMode = 'phone' | 'drive_thru'

export type KoreThirdLanguageCode =
  | 'ko'
  | 'zh'
  | 'ja'
  | 'pt'
  | 'fr'
  | 'tl'
  | 'vi'
  | 'ar'
  | 'ru'
  | 'hi'
  | 'hy'
  | 'de'
  | 'it'

export interface KoreThirdLanguageMatch {
  code: KoreThirdLanguageCode
  nameEn: string
  nameEs: string
}

export const KORE_THIRD_LANGUAGES: Readonly<Record<KoreThirdLanguageCode, KoreThirdLanguageMatch>> = Object.freeze({
  ko: { code: 'ko', nameEn: 'Korean', nameEs: 'Coreano' },
  zh: { code: 'zh', nameEn: 'Chinese', nameEs: 'Chino' },
  ja: { code: 'ja', nameEn: 'Japanese', nameEs: 'Japonés' },
  pt: { code: 'pt', nameEn: 'Portuguese', nameEs: 'Portugués' },
  fr: { code: 'fr', nameEn: 'French', nameEs: 'Francés' },
  tl: { code: 'tl', nameEn: 'Tagalog', nameEs: 'Tagalo' },
  vi: { code: 'vi', nameEn: 'Vietnamese', nameEs: 'Vietnamita' },
  ar: { code: 'ar', nameEn: 'Arabic', nameEs: 'Árabe' },
  ru: { code: 'ru', nameEn: 'Russian', nameEs: 'Ruso' },
  hi: { code: 'hi', nameEn: 'Hindi', nameEs: 'Hindi' },
  hy: { code: 'hy', nameEn: 'Armenian', nameEs: 'Armenio' },
  de: { code: 'de', nameEn: 'German', nameEs: 'Alemán' },
  it: { code: 'it', nameEn: 'Italian', nameEs: 'Italiano' }
})

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
    .normalize('NFC')
    .replace(/[^\p{Script=Hangul}\p{Script=Devanagari}\p{Script=Arabic}\p{Script=Cyrillic}]+/gu, (seg) =>
      seg.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    )
    .toLowerCase()
    .replace(/đ/g, 'd')
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
 * Interpelación directa del cliente para confirmar si la asistente/bocina lo escucha
 * (ej. `"¿Me escuchas?"`, `"¿Sí me escuchas o no?"`, `"Can you hear me?"`, `"Are you there?"`).
 */
const DIRECT_CUSTOMER_AUDIO_CHECK_RE =
  /\b(?:(?:si\s+)?me\s+(?:escuchas?|oyes?|estan?\s+escuchando|entiendes?)|me\s+(?:puedes?|pueden)\s+(?:escuchar|oir)|(?:por\s*que\s+)?no\s+me\s+contestas?|me\s+contestas?|(?:por\s*que\s+)?me\s+(?:cortas?|callas?|interrumpes?|apresuras?)|te\s+estoy\s+hablando|estaba\s+hablando|tengo\s+un\s+video\s+en\s+mi\s+carro|(?:estas?|sigues?|sigue|estan)\s+ahi|hay\s+alguien(?:\s+ahi)?|(?:can|do|could)\s+you\s+hear\s+me|you\s+hear\s+me(?:\s+or\s+not)?|why\s+(?:aren\s*t|are\s+not|don\s*t|do\s+not)\s+you\s+answering|why\s+(?:do|did)\s+you\s+cut\s+me\s+off|are\s+you\s+(?:still\s+)?there|still\s+there|anyone\s+there|anybody\s+there|is\s+this\s+thing\s+on|vous\s+m\s*entendez|tu\s+m\s*entends|esta\s+me\s+ouvindo|consegue\s+me\s+ouvir)\b/i

const MULTILINGUAL_AUDIO_CHECK_NFC_RE =
  /(?:들려요|제\s*말\s*들려요|听得到吗?|听得见吗?|聞こえますか?|تسمعني|هل\s+تسمعني|слышите(?:\s+меня)?|меня\s+слышно|सुनाई\s*दे|सुनाई)/iu

/**
 * Respuestas o cierres directos típicos de orden en Drive-Thru que no deben descartarse cuando se mezclan con ruido.
 */
const DIRECT_ORDER_PROGRESSION_RE =
  /\b(?:ya\s+es\s+todo|eso\s+(?:es|seria)\s+todo|es\s+todo|nada\s+mas|seria\s+todo|asi\s+esta\s+bien|correcto|that\s*s\s+all|thats\s+all|(?:lo\s+quiero|la\s+quiero|lo\s+queria|la\s+queria|hazlo|hazla|ponlo|ponla|el\s+burrito|la\s+quesadilla|la\s+mulita)\s+(?:regular|super)|regular\s+o\s+super|regular\s+or\s+super)\b/i

/**
 * Marcadores inequívocos de videos de YouTube, reseñas tecnológicas/cámaras, streaming o videojuegos
 * (permite bloquear también fragmentos cortos como `"dejen su like y"` o `"es esta cámara"` cuando NO contienen
 * ninguna palabra de comida, orden ni interpelación del cliente).
 */
export const EXPLICIT_BACKGROUND_MEDIA_MARKER_RE =
  /\b(?:dejen\s+(?:su\s+)?like|dale\s+like|denle\s+like|suscrib(?:anse|ete|irse)|activar?\s+la\s+campanita|en\s+este\s+video|ver\s+todo\s+el\s+video|imaginate\s+que|es\s+esta\s+camara|el\s+sensor|camara\s+de|gta\s*(?:v|vi|5|6|cinco|seis)|grand\s+theft\s+auto|dlss|neural\s+rendering|ray\s+tracing|pc\s+gamers?|pc\s+master\s+race|computadora\s+gamers?|playstation|xbox|modders?|portear|porteo|(?:30|60|120)\s*fps|fps|capad[oa]\s+a|capturadoras?|me\s+patrocin[oó]|patrocinad[oa]\s+por|streamers?|youtubers?|videojuegos?)\b/i

export const KORE_BG_MEDIA_MIN_WORDS = 12

const NON_LATIN_KO_MEANINGFUL_RE =
  /(?:안녕|저기요|실례|주세요|할게요|로\s*할게|주문|타코|부리또|브리또|퀘사디아|물리타|토르타|소페|나초|소고기|돼지고기|닭고기|아사다|파스토르|치즈|과카몰리|사워크림|살사|음료|오르차타|밥|콩|세트|메뉴|포함|뭐가|전부|계산|얼마|가격|감사|고마워|아니요|잠시만|잠깐만|기다려|매니저|취소|다예요|들려요|됐어요|괜찮아요|^(?:네|예|끝)[.!?~\s]*$)/u

const NON_LATIN_JA_MEANINGFUL_RE =
  /(?:こんにちは|こんばんは|おはようございます|すみません|ください|お願いします|お願い|注文|タコス?|ブリトー|ケサディーヤ|ムリータ|牛肉|豚肉|鶏肉|ポーク|チキン|ビーフ|アサダ|朝田|肉|ご飯|ライス|豆|セット|メニュー|にします|にして|選べ|選び|ついて|付い|何|なに|会計|全部|そう|他|ほか|チーズ|ワカモレ|サワークリーム|飲み物|オルチャータ|いくら|ありがとう|はい|いいえ|ちょっと待って|待って|マネージャー|キャンセル|以上です|以上|聞こえます|やっぱりいい|大丈夫)/u

const NON_LATIN_ZH_MEANINGFUL_RE =
  /(?:你好|您好|请问|不好意思|我要|我想|给我|来一|来两|来二|来三|点单|点餐|订单|一个|两个|二个|三个|一份|两份|一杯|两杯|塔可|玉米饼|卷饼|布里托|牛肉|猪肉|鸡肉|米饭|套餐|菜单|有什么|包括|结账|买单|芝士|奶酪|牛油果|酸奶油|饮料|米浆|多少钱|价格|一共|谢谢|可以|好的|不要|不加|等一下|稍等|经理|取消|听得到|听得见|算了|不用了)/u

const NON_LATIN_AR_MEANINGFUL_RE =
  /(?:مرحبا|أهلا|اهلا|السلام|لو\s+سمحت|من\s+فضلك|أريد|اريد|ابغى|أبغى|عطني|أعطني|اعطني|طلب|طلبي|تاكو|بوريتو|لحم|دجاج|جبن|أرز|ارز|فاصوليا|ماذا|معه|حساب|بكم|كم\s+السعر|شكرا|نعم|لحظة|انتظر|مدير|إلغاء|الغاء|ألغ|الغ|تسمعني)/u

const NON_LATIN_RU_MEANINGFUL_RE =
  /(?:здравствуйте|привет|добрый|можно|хочу|дайте|пожалуйста|заказ|тако|буррито|кесадиль|говядин|свинин|куриц|сыр|рис|фасоль|меню|что\s+входит|счет|счёт|сколько|спасибо|подождите|секунду|менеджер|отмен|слышно|слышите)/iu

const NON_LATIN_HI_MEANINGFUL_RE =
  /(?:नमस्ते|हेलो|कृपया|मुझे|चाहिए|ऑर्डर|ताको|टाको|बुरिटो|चिकन|पनीर|चावल|राजमा|मेनू|क्या\s+मिलता|बिल|कितना|कीमत|धन्यवाद|शुक्रिया|रुकिए|एक\s+मिनट|मैनेजर|कैंसिल|सुनाई)/u

const NON_LATIN_HY_MEANINGFUL_RE =
  /(?:բարև|խնդրում|ուզում|տակո|բուրիտո|միս|հավ|պանիր|բրինձ|լոբի|մենյու|հաշիվ|ինչ\s+արժե|շնորհակալություն|սպասեք|չեղարկ)/iu

/**
 * Verifica si `rawText` contiene al menos 2 caracteres en el sistema de escritura propio de un 3.er idioma no latino
 * (`ja` -> Hiragana/Katakana/Han, `zh` -> Han, `ko` -> Hangul, `ar` -> Arabic, `ru` -> Cyrillic, `hi` -> Devanagari, `hy` -> Armenian).
 */
export function matchesThirdLanguageScript(rawText: string, code: KoreThirdLanguageCode): boolean {
  const nfc = String(rawText ?? '').normalize('NFC')
  if (!nfc) return false
  switch (code) {
    case 'ja':
      return (nfc.match(/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/gu) || []).length >= 2
    case 'zh':
      return (nfc.match(/\p{Script=Han}/gu) || []).length >= 2
    case 'ko':
      return (nfc.match(/\p{Script=Hangul}/gu) || []).length >= 2
    case 'ar':
      return (nfc.match(/\p{Script=Arabic}/gu) || []).length >= 2
    case 'ru':
      return (nfc.match(/\p{Script=Cyrillic}/gu) || []).length >= 2
    case 'hi':
      return (nfc.match(/\p{Script=Devanagari}/gu) || []).length >= 2
    case 'hy':
      return (nfc.match(/\p{Script=Armenian}/gu) || []).length >= 2
    default:
      return false
  }
}

/**
 * Retorna `true` cuando un texto en escritura no latina contiene vocabulario conversacional real de cliente
 * (saludo, cortesía, comida/bebida, cantidad, precio, espera, audio-check, confirmación o cancelación)
 * en Coreano (`ko`), Chino (`zh`), Japonés (`ja`), Árabe (`ar`), Ruso (`ru`), Hindi (`hi`) o Armenio (`hy`).
 */
export function hasMeaningfulNonLatinCustomerSpeech(rawText: string): boolean {
  const nfc = String(rawText ?? '').normalize('NFC').trim()
  if (!nfc) return false
  if (/\p{Script=Hangul}/u.test(nfc) && NON_LATIN_KO_MEANINGFUL_RE.test(nfc)) return true
  if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(nfc) && NON_LATIN_JA_MEANINGFUL_RE.test(nfc)) return true
  if (/\p{Script=Han}/u.test(nfc) && !/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(nfc) && NON_LATIN_ZH_MEANINGFUL_RE.test(nfc)) {
    return true
  }
  if (/\p{Script=Arabic}/u.test(nfc) && NON_LATIN_AR_MEANINGFUL_RE.test(nfc.toLowerCase())) return true
  if (/\p{Script=Cyrillic}/u.test(nfc) && NON_LATIN_RU_MEANINGFUL_RE.test(nfc.toLowerCase())) return true
  if (/\p{Script=Devanagari}/u.test(nfc) && NON_LATIN_HI_MEANINGFUL_RE.test(nfc)) return true
  if (/\p{Script=Armenian}/u.test(nfc) && NON_LATIN_HY_MEANINGFUL_RE.test(nfc.toLowerCase())) return true
  return false
}

/**
 * Retorna `true` cuando el texto tiene escritura no latina y **NO** contiene habla real de cliente/restaurante,
 * bloqueando alucinaciones STT o TV ajena (`"जी के"`, `"だいたい"`, `"担当者の責任"`, `"ㅋㅋ"`, `"अ"`, `"嗯"` cuando `activeThirdLangCode` es `null`).
 * Si la sesión ya fijó un 3.er idioma no latino (`activeThirdLangCode`) y el texto coincide con su escritura (`>= 2` caracteres),
 * retorna `false` para jamás silenciar respuestas de seguimiento del cliente (ej. `"朝田にします。あとそれには何がついていますか?"`).
 */
export function isNonLatinNoiseTranscript(
  rawText: string,
  activeThirdLangCode?: KoreThirdLanguageCode | null
): boolean {
  const raw = String(rawText ?? '').trim()
  if (!raw) return false
  if (/[\p{Script=Latin}0-9]/u.test(raw)) return false
  if (activeThirdLangCode && matchesThirdLanguageScript(raw, activeThirdLangCode)) return false
  if (hasMeaningfulNonLatinCustomerSpeech(raw)) return false
  return /\p{L}|\p{Script=Devanagari}|\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}|\p{Script=Arabic}|\p{Script=Cyrillic}|\p{Script=Armenian}|\p{Script=Thai}/u.test(
    raw
  )
}

const EXPLICIT_SWITCH_TO_ES_RE =
  /\b(?:(?:en|al|a)\s+espanol|espanol\s+por\s+favor|(?:habla(?:me|nos|r)?|hable(?:me|nos)?|hablemos|puedes?\s+hablar|podemos\s+hablar|cambia(?:r)?|cambie(?:mos)?)\s+(?:en\s+|a\s+|al\s+)?espanol|(?:in|to)\s+spanish|spanish\s+please|(?:speak|talk|switch)\s+(?:in\s+|to\s+)?spanish|can\s+(?:we|you)\s+speak\s+(?:in\s+)?spanish|solo\s+hablo\s+espanol|no\s+me\s+habl(?:es|as|e)\s+en\s+(?:ingles|japones|chino|mandarin|coreano|frances|portugues|aleman|italiano|ruso|arabe|tagalo|vietnamita|armenio|hindi))\b/i

const EXPLICIT_SWITCH_TO_EN_RE =
  /\b(?:(?:in|to)\s+english|english\s+please|(?:speak|talk|switch)\s+(?:in\s+|to\s+)?english|(?:can|could|do)\s+(?:we|you)\s+speak\s+(?:in\s+)?english|only\s+speak\s+english|(?:en|al|a)\s+ingles|ingles\s+por\s+favor|(?:habla(?:me|nos|r)?|hable(?:me|nos)?|hablemos|puedes?\s+hablar|podemos\s+hablar|cambia(?:r)?|cambie(?:mos)?)\s+(?:en\s+|a\s+|al\s+)?ingles|(?:don\s*t|do\s+not)\s+speak\s+(?:spanish|japanese|chinese|korean|french|portuguese|german|italian|russian|arabic|tagalog|vietnamese|armenian|hindi))\b/i

/**
 * Retorna `'es'` o `'en'` ÚNICAMENTE cuando el cliente pide de forma explícita cambiar el idioma de atención a español o inglés
 * (`"en español por favor"`, `"habla en español"`, `"in English please"`, `"speak English"`).
 * Retorna `null` ante comentarios de terceros o frases sin comando de cambio de idioma (ej. `"Las dos se quedaron calladas."`).
 */
export function isExplicitBaseLanguageSwitchRequest(rawText: string): 'es' | 'en' | null {
  const raw = String(rawText ?? '').trim()
  if (!raw) return null
  const norm = stripDiacriticsLower(raw)
    .replace(/['’`]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!norm) return null
  // Cuidado: "no me hablas en inglés" / "no me hables en inglés" pide español, no inglés!
  if (/\bno\s+me\s+habl(?:es|as|e)\s+en\s+ingles\b/i.test(norm)) return 'es'
  if (/\b(?:no\s+hablo|don\s*t\s+speak|do\s+not\s+speak|can\s*t\s+speak|cannot\s+speak)\s+espanol\b|\b(?:don\s*t|do\s+not|can\s*t|cannot)\s+speak\s+spanish\b/i.test(norm)) {
    return 'en'
  }
  if (/\bno\s+hablo\s+ingles\b/i.test(norm)) return 'es'
  if (EXPLICIT_SWITCH_TO_ES_RE.test(norm)) return 'es'
  if (EXPLICIT_SWITCH_TO_EN_RE.test(norm)) return 'en'
  return null
}

const EXPLICIT_THIRD_LANG_REQUEST_MAP: ReadonlyArray<readonly [RegExp, KoreThirdLanguageCode]> = [
  [/\b(?:korean|coreano|한국어)\b/i, 'ko'],
  [/\b(?:chinese|mandarin|cantonese|chino|mandar[ií]n|canton[eé]s|中文|普通话|广东话)\b/i, 'zh'],
  [/\b(?:japanese|japon[eé]s|日本語)\b/i, 'ja'],
  [/\b(?:portuguese|portugu[eé]s)\b/i, 'pt'],
  [/\b(?:french|franc[eé]s|français)\b/i, 'fr'],
  [/\b(?:tagalog|filipino|tagalo)\b/i, 'tl'],
  [/\b(?:vietnamese|vietnamita|tiếng\s+việt|tieng\s+viet)\b/i, 'vi'],
  [/\b(?:arabic|[aá]rabe)\b/i, 'ar'],
  [/\b(?:russian|ruso)\b/i, 'ru'],
  [/\b(?:hindi)\b/i, 'hi'],
  [/\b(?:armenian|armenio)\b/i, 'hy'],
  [/\b(?:german|alem[aá]n|deutsch)\b/i, 'de'],
  [/\b(?:italian|italiano)\b/i, 'it']
]

/**
 * Detecta si el cliente está hablando en un 3.er idioma distinto de Español e Inglés (`ko`, `zh`, `ja`, `pt`, `fr`,
 * `tl`, `vi`, `ar`, `ru`, `hi`, `hy`, `de`, `it`), exigiendo marcadores exclusivos que JAMÁS colisionen con palabras
 * compartidas de Español, Inglés o nombres del menú mexicano.
 */
export function detectKoreThirdLanguage(rawText: string): KoreThirdLanguageMatch | null {
  const raw = String(rawText ?? '').trim()
  if (!raw || isNonLatinNoiseTranscript(raw)) return null
  const nfc = raw.normalize('NFC')
  const nfcLower = nfc.toLowerCase()

  // 1) Escrituras no latinas con habla real de cliente verificada
  if (/\p{Script=Hangul}/u.test(nfc) && NON_LATIN_KO_MEANINGFUL_RE.test(nfc)) return KORE_THIRD_LANGUAGES.ko
  if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(nfc) && NON_LATIN_JA_MEANINGFUL_RE.test(nfc)) {
    return KORE_THIRD_LANGUAGES.ja
  }
  if (/\p{Script=Han}/u.test(nfc) && !/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(nfc) && NON_LATIN_ZH_MEANINGFUL_RE.test(nfc)) {
    return KORE_THIRD_LANGUAGES.zh
  }
  if (/\p{Script=Arabic}/u.test(nfc) && NON_LATIN_AR_MEANINGFUL_RE.test(nfcLower)) return KORE_THIRD_LANGUAGES.ar
  if (/\p{Script=Cyrillic}/u.test(nfc) && NON_LATIN_RU_MEANINGFUL_RE.test(nfcLower)) return KORE_THIRD_LANGUAGES.ru
  if (/\p{Script=Devanagari}/u.test(nfc) && NON_LATIN_HI_MEANINGFUL_RE.test(nfc)) return KORE_THIRD_LANGUAGES.hi
  if (/\p{Script=Armenian}/u.test(nfc) && NON_LATIN_HY_MEANINGFUL_RE.test(nfcLower)) return KORE_THIRD_LANGUAGES.hy

  const asciiNorm = stripDiacriticsLower(nfc)
    .replace(/['’`]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!asciiNorm) return null

  // 2) Solicitud explícita de 3.er idioma en ES/EN/nativo (sin negación tipo "no hablo...", "I don't speak...", "I can't speak...")
  if (
    !/\b(?:no\s+(?:hablo|hablas?|se\s+hablar|entiendo)|don\s*t\s+speak|do\s+not\s+speak|can\s*t\s+speak|cannot\s+speak|only\s+speak\s+(?:english|spanish)|solo\s+hablo\s+(?:espanol|ingles))\b/i.test(
      asciiNorm
    ) &&
    /\b(?:do\s+you\s+speak|can\s+(?:you|we)\s+speak|speak(?:\s+in)?|hablas?|hablan|puedes?\s+hablar|fala(?:m)?|parlez(?:\s+vous)?|sprechen\s+sie|parla(?:te)?|marunong\s+ka)\b/i.test(
      asciiNorm
    )
  ) {
    for (const [langRe, code] of EXPLICIT_THIRD_LANG_REQUEST_MAP) {
      if (langRe.test(nfc) || langRe.test(asciiNorm)) {
        return KORE_THIRD_LANGUAGES[code]
      }
    }
  }

  // 3) Idiomas en alfabeto latino (exclusivamente marcadores inequívocos ausentes en Español e Inglés)
  if (
    /\b(?:xin\s+chao|cam\s+on|cho\s+toi|bao\s+nhieu|tieng\s+viet|huy\s+don\s+hang|cho\s+mot\s+chut|banh\s+mi)\b/i.test(
      asciiNorm
    ) ||
    (/[ăắằẳẵặấầẩẫậđếềểễệốồổỗộơớờởỡợưứừửữự]/iu.test(nfcLower) && /\b(?:toi|cho|hai|mot|cam|huy|don|xin)\b/i.test(asciiNorm))
  ) {
    return KORE_THIRD_LANGUAGES.vi
  }

  if (
    /\b(?:kumusta|gusto\s+ko(?:\s+ng)?|dalawa(?:ng)?|tatlo(?:ng)?|salamat|magkano|sandali\s+lang|ikansela\s+ang|kanselahin\s+ang|pakisuyo)\b/i.test(
      asciiNorm
    )
  ) {
    return KORE_THIRD_LANGUAGES.tl
  }

  if (
    /(?:^|[^\p{L}])(?:olá|não|você|vocês|pão|feijão|então)(?![\p{L}])/iu.test(nfcLower) ||
    /\b(?:obrigad[oa]s?|eu\s+(?:quero|gostaria|vou\s+querer)|gostaria\s+de|voce|voces|frango|queijo|abacate|esta\s+me\s+ouvindo|espera\s+um\s+pouco|so\s+um\s+minuto|deixa\s+pra\s+la|cancela(?:r)?\s+(?:o\s+)?meu\s+pedido|cancelar\s+o\s+pedido\s+todo|bom\s+dia|boa\s+tarde|boa\s+noite|por\s+gentileza)\b/i.test(
      asciiNorm
    )
  ) {
    return KORE_THIRD_LANGUAGES.pt
  }

  if (
    /\b(?:bonjour|bonsoir|je\s+(?:voudrais|veux|prends|vais\s+prendre)|s\s+il\s+vous\s+plait|sil\s+vous\s+plait|s\s+il\s+te\s+plait|merci(?:\s+beaucoup)?|combien(?:\s+ca\s+coute)?|deux\s+tacos?|trois\s+tacos?|avec\s+du|sans\s+creme|vous\s+m\s*entendez|attendez(?:\s+un\s+instant)?|un\s+instant|laisse(?:z)?\s+tomber|annule(?:r|z)?\s+(?:ma|la|toute\s+la)\s+commande)\b/i.test(
      asciiNorm
    )
  ) {
    return KORE_THIRD_LANGUAGES.fr
  }

  if (
    /\b(?:guten\s+(?:tag|morgen|abend)|ich\s+(?:mochte|will|hatte\s+gern|nehme)|zwei\s+tacos?|drei\s+tacos?|bitte(?:\s+schon)?|danke(?:\s+schon)?|wie\s+viel\s+kostet|entschuldigung|einen\s+moment(?:\s+bitte)?|meine\s+bestellung\s+stornieren|bestellung\s+stornieren)\b/i.test(
      asciiNorm
    )
  ) {
    return KORE_THIRD_LANGUAGES.de
  }

  if (
    /\b(?:buongiorno|buonasera|vorrei|per\s+favore|grazie(?:\s+mille)?|quanto\s+costa(?:no)?|due\s+tacos?|tre\s+tacos?|formaggio|senza\s+panna|un\s+attimo|aspetta\s+un\s+attimo|annulla(?:re)?\s+(?:il\s+mio\s+|tutto\s+l\s*|l\s*)ordine)\b/i.test(
      asciiNorm
    )
  ) {
    return KORE_THIRD_LANGUAGES.it
  }

  return null
}

export interface NoisyTurnCustomerIntent {
  isPureBackgroundMedia: boolean
  hasAudioCheck: boolean
  hasOrderOrDomainIntent: boolean
  hasMixedBackgroundNoise: boolean
  extractedCustomerSegment: string | null
}

/**
 * Devuelve `true` si el texto contiene una pregunta/verificación directa de audio hacia Kore o la línea
 * (`"¿me escuchas?"`, `"¿sí me escuchas o no?"`, `"can you hear me?"`, `"are you there?"`).
 */
export function hasDirectCustomerAudioCheck(rawText: string): boolean {
  const raw = String(rawText ?? '').trim()
  if (!raw) return false
  if (MULTILINGUAL_AUDIO_CHECK_NFC_RE.test(raw.normalize('NFC'))) return true
  const norm = stripDiacriticsLower(raw)
    .replace(/['’`]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return Boolean(norm && DIRECT_CUSTOMER_AUDIO_CHECK_RE.test(norm))
}

/**
 * Devuelve `true` si el texto contiene marcadores explícitos de YouTube, streaming o videojuegos.
 */
export function hasExplicitBackgroundMediaMarkers(rawText: string): boolean {
  const raw = String(rawText ?? '').trim()
  if (!raw) return false
  const norm = stripDiacriticsLower(raw)
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return Boolean(norm && EXPLICIT_BACKGROUND_MEDIA_MARKER_RE.test(norm))
}

/**
 * Detecta si un texto transcrito corresponde probablemente a un monólogo o fragmento 100% ajeno de TV, YouTube,
 * videojuegos, radio o narración deportiva captado por el micrófono:
 * - Devuelve `false` si dicta teléfono (7+ dígitos) o contiene CUALQUIER interpelación directa (`"¿me escuchas?"`,
 *   `"can you hear me?"`) o término de comida, bebida, menú, orden, sucursal, horario, saludo, llamada o recado.
 * - Devuelve `true` si tiene `>= 12` palabras sin dominio de restaurante/audio-check, O si contiene marcadores
 *   inequívocos de YouTube/streaming/videojuegos (`"dejen su like"`, `"GTA 6"`, `"DLSS"`, `"Xbox"`, `"modders"`, etc.).
 * Nunca descarta turnos mixtos donde la TV suena de fondo pero el cliente también habló o preguntó.
 */
export function isLikelyBackgroundMediaSpeech(
  rawText: string,
  activeThirdLangCode?: KoreThirdLanguageCode | null
): boolean {
  const raw = String(rawText ?? '').trim()
  if (!raw) return false
  if (isNonLatinNoiseTranscript(raw, activeThirdLangCode)) return true

  const norm = stripDiacriticsLower(
    normalizeKoreCustomerSpeech(raw, { mode: 'drive_thru' })
  )
    .replace(/[^\p{L}\p{N}\s-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!norm) return false

  // Si dicta un número telefónico de 7-10 dígitos, nunca clasificar como TV/radio
  const digitsOnly = raw.replace(/\D/g, '')
  if (digitsOnly.length >= 7) return false

  if (
    hasDirectCustomerAudioCheck(raw) ||
    RESTAURANT_OR_CALL_DOMAIN_RE.test(norm) ||
    DIRECT_ORDER_PROGRESSION_RE.test(norm) ||
    ((detectKoreThirdLanguage(raw) !== null ||
      Boolean(activeThirdLangCode && matchesThirdLanguageScript(raw, activeThirdLangCode))) &&
      !EXPLICIT_BACKGROUND_MEDIA_MARKER_RE.test(norm))
  ) {
    return false
  }

  if (EXPLICIT_BACKGROUND_MEDIA_MARKER_RE.test(norm)) {
    return true
  }

  const words = norm.split(' ').filter((w) => w.length > 0)
  return words.length >= KORE_BG_MEDIA_MIN_WORDS
}

/**
 * Analiza un turno ruidoso o mezclado (ej. YouTube/TV de fondo + voz cercana del cliente) y extrae
 * el segmento real dirigido a Kore (pedido, respuesta o `"¿Sí me escuchas o no?"`), distinguiéndolo
 * de un monólogo 100% ajeno de TV/radio.
 */
export function extractDirectCustomerIntentFromNoisyTurn(rawText: string): NoisyTurnCustomerIntent {
  const raw = String(rawText ?? '').trim()
  if (!raw) {
    return {
      isPureBackgroundMedia: false,
      hasAudioCheck: false,
      hasOrderOrDomainIntent: false,
      hasMixedBackgroundNoise: false,
      extractedCustomerSegment: null
    }
  }

  const normalized = normalizeKoreCustomerSpeech(raw, { mode: 'drive_thru' })
  const norm = stripDiacriticsLower(normalized)
    .replace(/[^\p{L}\p{N}\s-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const hasAudioCheck = hasDirectCustomerAudioCheck(raw)
  const hasOrderOrDomainIntent =
    RESTAURANT_OR_CALL_DOMAIN_RE.test(norm) ||
    DIRECT_ORDER_PROGRESSION_RE.test(norm) ||
    detectKoreThirdLanguage(raw) !== null ||
    /^(?:regular|super|si|no|ok|okay)$/i.test(norm)

  if (isLikelyBackgroundMediaSpeech(raw)) {
    return {
      isPureBackgroundMedia: true,
      hasAudioCheck: false,
      hasOrderOrDomainIntent: false,
      hasMixedBackgroundNoise: false,
      extractedCustomerSegment: null
    }
  }

  if (!hasAudioCheck && !hasOrderOrDomainIntent) {
    return {
      isPureBackgroundMedia: false,
      hasAudioCheck: false,
      hasOrderOrDomainIntent: false,
      hasMixedBackgroundNoise: false,
      extractedCustomerSegment: null
    }
  }

  // Segmentar por puntuación o por anclas claras de inicio de habla del cliente a mitad de un monólogo de TV
  const withMidTurnDelims = raw
    .replace(/([.!?]+)\s+/g, '$1\n')
    .replace(/\s+(?=[¿¡])/g, '\n')
    .replace(
      /\s+(?=(?:hola|buenos\s+d[ií]as|buenas\s+(?:tardes|noches)|disculp[ae]|quiero|quisiera|dame|deme|me\s+das?|ponme|agr[eé]game|(?:s[ií]\s+)?me\s+(?:escuchas?|oyes?)|est[aá]s?\s+ah[ií]|sigues?\s+ah[ií]|ya\s+es\s+todo|es\s+todo|hi|hello|excuse\s+me|i\s+want|i'?d\s+like|can\s+i\s+(?:get|have)|(?:can|do|could)\s+you\s+hear\s+me|are\s+you\s+(?:still\s+)?there)\b)/gi,
      '\n'
    )

  const rawClauses = withMidTurnDelims
    .split('\n')
    .map((c) => c.trim())
    .filter(Boolean)

  const customerClauses: string[] = []
  let noiseWordCount = 0

  for (const clause of rawClauses) {
    const cNorm = stripDiacriticsLower(normalizeKoreCustomerSpeech(clause, { mode: 'drive_thru' }))
      .replace(/[^\p{L}\p{N}\s-]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (!cNorm) continue
    const isCustClause =
      DIRECT_CUSTOMER_AUDIO_CHECK_RE.test(cNorm) ||
      RESTAURANT_OR_CALL_DOMAIN_RE.test(cNorm) ||
      DIRECT_ORDER_PROGRESSION_RE.test(cNorm) ||
      /^(?:regular|super|si|no|ok|okay)$/i.test(cNorm)
    if (isCustClause) {
      customerClauses.push(clause)
    } else {
      noiseWordCount += cNorm.split(' ').filter(Boolean).length
    }
  }

  return {
    isPureBackgroundMedia: false,
    hasAudioCheck,
    hasOrderOrDomainIntent,
    hasMixedBackgroundNoise: noiseWordCount >= 4 && customerClauses.length > 0,
    extractedCustomerSegment: customerClauses.length > 0 ? customerClauses.join(' ').trim() : raw
  }
}

/**
 * Vocabulario que JAMÁS puede ser un fragmento colgante truncado (respuestas válidas de 1–3 palabras:
 * sí/no, carnes, sabores, tamaños, variantes Regular/Super, números cardinales completos como `"uno"`/`"dos"`,
 * platillos, bebidas, cierres, saludos o formas de pago).
 */
const VALID_STANDALONE_ANSWER_VETO_RE =
  /\b(?:si|yes|yep|yeah|no|nope|asi|ok|okay|sale|va|claro|correcto|exacto|perfecto|listo|gracias|thanks|thank|hola|hello|hi|bueno|adelante|regular|super|supreme|supremo|suprema|mediana|mediano|medianas|medianos|grande|grandes|medium|large|galon|gallon|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d+|todo|todos|nada|mas|all|mejor|cambio|cambiar|quitar|quita|cancelar|efectivo|cash|tarjeta|card|ebt|calfresh|doordash|uber|grubhub|maiz|corn|harina|flour|roja|verde)\b/i

/**
 * Arranques truncados a mitad de oración cuando el cliente hace una pausa pensando qué pedir
 * (ej. `"Quiero"`, `"Quiero una"`, `"Dame un"`, `"Me das"`, `"Este"`, `"Eh"`, `"Un"`, `"Una"`, `"I want"`, `"Can I get"`).
 */
const DANGLING_INCOMPLETE_ORDER_FRAGMENT_RE =
  /^(?:(?:y|o|pero|pues|este|eh+|em+|um+|uh+|ah+|mm+|hmm+|entonces|tambien|ademas|oye|oiga)\s+)*(?:(?:yo\s+)?(?:quiero|quisiera|querria|estoy\s+queriendo|dame|deme|me\s+(?:das?|da|pones?|pone|traes?|regalas?|agregas?)|ponme|ponle|agregame|agrega|seria|serian)(?:\s+(?:un|una|unos|unas|el|la|los|las|otro|otra|otros|otras))?|(?:un|una|unos|unas)|(?:este|eh+|em+|um+|uh+|ah+|mm+|hmm+)|(?:(?:and|also|um+|uh+|well)\s+)*(?:i\s+(?:want|would\s+like)|id\s+like|(?:can|could|may)\s+i(?:\s+(?:get|have))?|give\s+me|lemme\s+get|let\s+me\s+(?:get|have))(?:\s+(?:a|an|the|another|some))?|(?:a|an))$/i

/**
 * Retorna `true` únicamente cuando todo el texto del turno es un arranque truncado sin platillo,
 * carne, sabor, tamaño, cantidad completa (`"uno"`/`"dos"`) ni respuesta válida (`"Sí"`, `"No"`, `"Jamaica"`, `"carnitas"`, `"regular"`).
 */
export function isDanglingIncompleteOrderFragment(rawText: string): boolean {
  const raw = String(rawText ?? '').trim()
  if (!raw) return false

  const norm = stripDiacriticsLower(raw)
    .replace(/['’`]+/g, '')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!norm) return false

  const words = norm.split(' ').filter(Boolean)
  if (words.length === 0 || words.length > 4) return false

  if (
    VALID_STANDALONE_ANSWER_VETO_RE.test(norm) ||
    RESTAURANT_OR_CALL_DOMAIN_RE.test(norm) ||
    DIRECT_CUSTOMER_AUDIO_CHECK_RE.test(norm) ||
    DIRECT_ORDER_PROGRESSION_RE.test(norm)
  ) {
    return false
  }

  return DANGLING_INCOMPLETE_ORDER_FRAGMENT_RE.test(norm)
}

const COMPOUND_ITEM_HEAD_FAMILY_MAP: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b__item_taco_plate__\b/, 'taco_plate'],
  [/\b__item_brc_burrito__\b/, 'burrito'],
  [/\b__item_nachos__\b/, 'nachos'],
  [/\b__item_courtesy_beans__\b/, 'courtesy_beans'],
  [/\b__item_courtesy_onions__\b/, 'courtesy_onions'],
  [/\btacos?\b/, 'taco'],
  [/\bburritos?\b/, 'burrito'],
  [/\bquesadillas?\b/, 'quesadilla'],
  [/\bmulitas?\b/, 'mulita'],
  [/\btortas?\b/, 'torta'],
  [/\bsopes?\b/, 'sope'],
  [/\bnachos?\b/, 'nachos'],
  [/\b(?:platos?|plates?)\b/, 'plato'],
  [/\bhuevos?\b/, 'breakfast_eggs'],
  [/\b(?:horchatas?|jamaicas?|tamarindos?|pinas?|limonadas?|lemonades?|champurrados?|cafes?|coffees?|cocas?|cokes?|sprites?|fantas?|sodas?|refrescos?|aguas?|waters?)\b/, 'drink'],
  [/\b(?:flan(?:es)?|cheesecakes?|postres?|desserts?)\b/, 'dessert']
]

/**
 * Retorna `true` cuando el turno del cliente pidió más artículos/familias distintas de comida o bebida
 * de los que se agregaron realmente en esa llamada a herramienta (ej. `"Quiero un taco de asada y dos burritos."`
 * con `addedItemsCount === 1`, porque los burritos aún requieren aclarar `Regular o Super`), evitando que un
 * fast-clip parcial (`ack_1_taco_asada`) silencie la pregunta de Kore sobre los artículos restantes.
 */
export function hasUnresolvedCompoundOrderItems(customerTurnText: string, addedItemsCount: number): boolean {
  const safeAdded = Number.isFinite(addedItemsCount) ? Math.max(0, Math.trunc(addedItemsCount)) : 0
  if (safeAdded <= 0) return false
  const raw = String(customerTurnText ?? '').trim()
  if (!raw) return false

  const noisy = extractDirectCustomerIntentFromNoisyTurn(raw)
  const targetText = noisy.extractedCustomerSegment || raw

  let norm = stripDiacriticsLower(normalizeKoreCustomerSpeech(targetText, { mode: 'drive_thru' }))
    .replace(/[^\p{L}\p{N}\s,;/-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!norm) return false

  // Si es una corrección/reemplazo ("cambiar X por Y", "en vez de X"), no tratar el platillo viejo como item faltante
  if (/\b(?:cambiar|cambia|cambialo|cambiame|en\s+vez\s+de|en\s+lugar\s+de|instead\s+of|change|swap|replace)\b/.test(norm)) {
    return false
  }

  // Colapsar platillos compuestos de 1 solo SKU antes de contar cláusulas
  norm = norm
    .replace(/\b(?:taco\s+plates?|platos?\s+de\s+(?:tres|3)\s+tacos?|combos?\s+de\s+(?:tres|3)\s+tacos?)\b/g, ' __item_taco_plate__ ')
    .replace(/\b(?:super\s+)?burritos?\s+(?:de\s+)?(?:frijol(?:es)?|arroz|queso)(?:[\s,y/]+(?:frijol(?:es)?|arroz|queso))*\b/g, ' __item_brc_burrito__ ')
    .replace(/\b(?:beans?|rice|cheese)(?:[\s,/]+(?:and\s+)?(?:beans?|rice|cheese))+\s+burritos?\b/g, ' __item_brc_burrito__ ')
    .replace(/\bsuper\s+nachos?\b/g, ' __item_nachos__ ')
    .replace(/\b(?:con|with)\s+(?:cebollas?\s+asadas?|cebollitas?(?:\s+asadas?)?|frijol(?:es)?\s+de\s+la\s+olla)\b/g, ' ')
    .replace(/\bfrijol(?:es)?\s+de\s+la\s+olla\b/g, ' __item_courtesy_beans__ ')
    .replace(/\b(?:cebollas?\s+asadas?|cebollitas?(?:\s+asadas?)?)\b/g, ' __item_courtesy_onions__ ')
    .replace(/\b(?:sin|without|no)\s+[a-z]+(?:\s+(?:y|ni|and|or)\s+[a-z]+)?\b/g, ' ')

  const clauses = norm
    .split(/\s+(?:y|e|tambien|ademas|mas|and|plus|also)\s+|[,;]+/)
    .map((c) => c.trim())
    .filter(Boolean)

  let specificItemClauses = 0
  let genericUmbrellaDrinkClauses = 0
  const distinctFamilies = new Set<string>()

  for (const clause of clauses) {
    let matchedSpecificInClause = false
    for (const [re, fam] of COMPOUND_ITEM_HEAD_FAMILY_MAP) {
      if (re.test(clause)) {
        matchedSpecificInClause = true
        distinctFamilies.add(fam)
      }
    }
    if (matchedSpecificInClause) {
      specificItemClauses++
    } else if (/\b(?:bebidas?|drinks?)\b/.test(clause)) {
      genericUmbrellaDrinkClauses++
    }
  }

  const totalMentionedItems =
    specificItemClauses > 0
      ? Math.max(specificItemClauses, distinctFamilies.size)
      : genericUmbrellaDrinkClauses

  return totalMentionedItems > safeAdded
}

const CUSTOMER_HOLD_REQUEST_RE =
  /\b(?:espera(?:me|te)?|espere(?:me)?|estoy\s+pensando|deja(?:me)?\s+(?:pensar|ver|checar)|deme\s+un\s+(?:momento|segundo|minuto)|dame\s+(?:un\s+(?:momento|momentito|segundo|segundito|minuto)|tantito|chance)|un\s+(?:momento|momentito|segundo|segundito)|aguanta(?:me)?|permite(?:me)?|no\s+me\s+apresures?|ahi\s+voy|hold\s+on|wait(?:\s+a\s+(?:second|sec|moment|minute))?|give\s+me\s+a\s+(?:second|sec|moment|minute)|one\s+(?:second|sec|moment)|just\s+a\s+(?:second|sec|moment)|let\s+me\s+(?:think|see|check)|don\s*t\s+rush\s+me|do\s+not\s+rush\s+me|attendez(?:\s+un\s+instant)?|un\s+instant|espera\s+um\s+pouco|so\s+um\s+minuto|aguarde\s+um\s+momento|sandali\s+lang|cho\s+mot\s+chut|einen\s+moment|un\s+attimo|aspetta\s+un\s+attimo)\b/i

const MULTILINGUAL_HOLD_REQUEST_NFC_RE =
  /(?:잠시만요?|잠깐만요?|기다려\s*주세요|等一下|稍等(?:一下)?|ちょっと待って(?:ください)?|待ってください|لحظة(?:\s+من\s+فضلك)?|انتظر\s+قليلا|подождите(?:\s+секунду)?|секунду|एक\s+मिनट|रुकिए|սպասեք)/iu

const MULTILINGUAL_CONCRETE_ORDER_NFC_RE =
  /(?:타코|부리또|브리또|퀘사디아|물리타|오르차타|タコス?|ブリトー|ケサディーヤ|塔可|玉米饼|卷饼|布里托|تاكو|بوريتو|тако|буррито|кесадиль|ताको|टाको|बुरिटो|տակո|բուրիտո)/iu

const CONCRETE_ORDER_OR_CLOSING_IN_HOLD_RE =
  /\b(?:tacos?|burritos?|quesadillas?|mulitas?|tortas?|sopes?|nachos?|platos?|plates?|combos?|flan(?:es)?|cheesecakes?|postres?|desserts?|charolas?|platters?|trays?|desayunos?|breakfasts?|huevos?|eggs?|asada|pastor|adobada|pollo|chicken|steak|cabeza|lengua|buche|chorizo|carnitas|milanesa|cuban[oa]s?|vegetarian[oa]s?|veggie|horchatas?|jamaicas?|tamarindos?|pinas?|limonadas?|lemonades?|champurrados?|cafes?|coffees?|cocas?|cokes?|sprites?|fantas?|sodas?|refrescos?|aguas?|waters?|bebidas?|drinks?|regular|super|supreme|mediana|mediano|grande|medium|large|galon|gallon|es\s+todo|ya\s+es\s+todo|nada\s+mas|that\s*s\s+all|thats\s+all|cambiar|cambia|cambialo|quitar|quita|cancelar|cuanto\s+cuesta|precio|subtotal|ebt|calfresh|doordash|uber|grubhub)\b/i

/**
 * Retorna `true` cuando el cliente pide tiempo para pensar o que no lo apresuren
 * (`"Ahi voy, espérame, estoy pensando"`, `"Hold on, let me think"`, `"잠시만요"`, `"等一下"`, `"Attendez un instant"`, `"Espera um pouco"`),
 * siempre que en esa misma frase NO venga ya un pedido concreto (ej. `"espera, mejor dame un flan"` -> `false`).
 */
export function detectKoreCustomerHoldRequest(
  rawText: string,
  activeThirdLangCode?: KoreThirdLanguageCode | null
): boolean {
  const raw = String(rawText ?? '').trim()
  if (!raw || isNonLatinNoiseTranscript(raw, activeThirdLangCode)) return false
  const nfc = raw.normalize('NFC')
  if (MULTILINGUAL_CONCRETE_ORDER_NFC_RE.test(nfc)) return false

  const norm = stripDiacriticsLower(normalizeKoreCustomerSpeech(raw, { mode: 'drive_thru' }))
    .replace(/['’`]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!norm) return false
  if (CONCRETE_ORDER_OR_CLOSING_IN_HOLD_RE.test(norm)) return false
  if (MULTILINGUAL_HOLD_REQUEST_NFC_RE.test(nfc)) return true
  return CUSTOMER_HOLD_REQUEST_RE.test(norm)
}

const CUSTOMER_RESUME_FROM_HOLD_INTENT_RE =
  /\b(?:ya\s+estoy\s+list[oa]|estoy\s+list[oa]|ya\s+list[oa]|list[oa]s?|ready|i\s*m\s+ready|i\s+am\s+ready|ahora\s+si|ya\s+se|ya\s+decidi|quiero|quisiera|querria|dame|deme|me\s+(?:das?|da|pones?|pone|traes?|regalas?)|ponme|ponle|agregame|agrega|i\s+want|i\s*d\s+like|i\s+would\s+like|can\s+i\s+(?:get|have)|give\s+me|que\s+mas\s+(?:tienes?|tienen|hay|me\s+ofreces?)|que\s+me\s+recomiendas?|cual\s+es|cuanto\s+es|oye|oiga|senorita|disculp[ae]|hola|hello|hi|excuse\s+me|eres\s+voz)\b/i

/**
 * Mientras `holdActive` está vigente (tras `"espérame, estoy pensando"` / `"잠시만요"` / `"等一下"`), retorna `true` ÚNICAMENTE cuando
 * el nuevo turno contiene intención real del cliente dirigida a Kore (platillo/bebida/menú, cierre `"es todo"`,
 * pedido en cualquier idioma válido, `"¿me escuchas?"`, `"sí"/"no"` o nueva petición de espera),
 * y retorna `false` ante ruido/video del carro (`"de repente me di"`, `"es esta cámara"`, `"जी के"`, `"だいたい"`).
 */
export function isCustomerResumingFromHold(
  rawText: string,
  activeThirdLangCode?: KoreThirdLanguageCode | null
): boolean {
  const raw = String(rawText ?? '').trim()
  if (!raw) return false
  if (isNonLatinNoiseTranscript(raw, activeThirdLangCode)) return false

  const norm = stripDiacriticsLower(normalizeKoreCustomerSpeech(raw, { mode: 'drive_thru' }))
    .replace(/['’`]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!norm) return false

  if (detectKoreCustomerHoldRequest(raw, activeThirdLangCode)) return true
  if (hasDirectCustomerAudioCheck(raw)) return true
  if (detectKoreThirdLanguage(raw) !== null) return true
  if (activeThirdLangCode && matchesThirdLanguageScript(raw, activeThirdLangCode)) return true

  if (
    CONCRETE_ORDER_OR_CLOSING_IN_HOLD_RE.test(norm) ||
    DIRECT_ORDER_PROGRESSION_RE.test(norm) ||
    CUSTOMER_RESUME_FROM_HOLD_INTENT_RE.test(norm) ||
    RESTAURANT_OR_CALL_DOMAIN_RE.test(norm) ||
    /^(?:si|yes|yep|yeah|no|nope|ok|okay|asi|uno|dos|tres|cuatro|cinco|one|two|three|\d+)$/i.test(norm)
  ) {
    return true
  }

  return false
}

const DANGLING_CLAUSE_CONNECTOR_TAIL_RE =
  /(?:^|\s)(?:y|e|o|u|pero|aunque|porque|que|de|del|con|sin|para|por|en|a|al|el|la|los|las|un|una|unos|unas|es|son|sea|(?:es\s+)?(?:la|el|los|las)\s+mas|cual\s+es\s+(?:la|el)|estoy|estas|voy\s+a|quiero|quisiera|dame|deme|me\s+das?|ponme|and|or|but|because|with|without|for|to|of|in|the|a|an|(?:is\s+)?the\s+most|i\s+want|can\s+i(?:\s+get)?|give\s+me)$/i

/**
 * Retorna `true` para frases de cualquier longitud (incluso si contienen términos de comida) que terminaron
 * claramente cortadas a mitad de idea en un conector, preposición, artículo, verbo copulativo o comparativo colgante
 * (ej. `"carne es la más"`, `"híbrida y el Super Burrito no crema es"`, `"No. Me refería a hablar con el"`),
 * permitiendo activar la ventana de continuación suave sin bloquear frases completas (`"Sí, gracias"`, `"Así es"`).
 */
export function endsWithDanglingClauseConnector(rawText: string): boolean {
  const raw = String(rawText ?? '').trim()
  if (!raw || isNonLatinNoiseTranscript(raw)) return false

  const norm = stripDiacriticsLower(raw)
    .replace(/['’`]+/g, '')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!norm) return false
  if (/^(?:si|yes|no|ok|okay|asi|gracias|thanks|hola|hello|bueno|es\s+todo|nada\s+mas|ya\s+es\s+todo)$/i.test(norm)) {
    return false
  }
  if (/(?:^|\s)(?:asi\s+es|eso\s+es|ya\s+estuvo)$/i.test(norm)) {
    return false
  }
  return DANGLING_CLAUSE_CONNECTOR_TAIL_RE.test(norm)
}

const KORE_EBT_CANCEL_REASON_RE =
  /\b(?:ebt|calfresh|cal\s*fresh|food\s*stamps?|estampillas?(?:\s+de\s+comida)?|cupones?\s+de\s+comida|snap)\b/i

const KORE_KEEP_ORDER_VETO_RE =
  /\b(?:(?:la|mi)\s+orden\s+si\s+la\s+quiero|si\s+quiero\s+(?:la|mi)\s+orden|no\s+canceles\s+(?:la|mi)\s+orden|sin\s+cancelar\s+(?:la|mi)\s+orden|(?:don\s*t|do\s+not)\s+cancel\s+(?:my|the)\s+order|keep\s+(?:my|the)\s+order|i\s+still\s+want\s+(?:my|the)\s+order)\b/i

const KORE_SUBTOPIC_CANCEL_VETO_RE =
  /\bcancel(?:a|ar|e|en|ing|ed)?\s+(?:lo\s+(?:de|del)\s+)?(?:hablar|platicar|el\s+manager|al\s+manager|el\s+gerente|al\s+gerente|el\s+encargado|al\s+encargado|la\s+pregunta|eso\s+del\s+manager|speaking|talking|asking|the\s+manager|the\s+question)\b/i

const KORE_EXPLICIT_WHOLE_ORDER_CANCEL_ES_RE =
  /\b(?:cancel(?:a|ar|ame|eme|en|e|alo|ala)\s+(?:por\s+favor\s+)?(?:toda\s+|todo\s+)?(?:mi\s+|la\s+|el\s+|nuestra\s+|nuestro\s+)?(?:orden|pedido|compra|cuenta|ticket|todo)|(?:toda\s+|mi\s+|la\s+)(?:orden|compra|cuenta)\s+cancelad[oa]|ya\s+no\s+(?:quiero|voy\s+a\s+(?:querer|llevar|pedir|ordenar)|llevo)\s+(?:nada|la\s+orden|mi\s+orden|el\s+pedido|todo)|no\s+voy\s+a\s+(?:llevar|querer|pedir|ordenar)\s+(?:nada|la\s+orden|mi\s+orden|el\s+pedido)|no\s+quiero\s+(?:la\s+orden|mi\s+orden|el\s+pedido|nada(?:\s+de\s+nada)?)|me\s+voy\s+sin\s+nada)\b/i

const KORE_EXPLICIT_WHOLE_ORDER_CANCEL_EN_RE =
  /\b(?:cancel\s+(?:please\s+)?(?:my\s+|the\s+|our\s+)?(?:whole\s+|entire\s+|full\s+)?(?:order|everything|it\s+all)|(?:i|we)\s+(?:don\s*t|do\s+not)\s+want\s+(?:anything(?:\s+at\s+all|\s+anymore)?|(?:my|the|our)\s+(?:whole\s+|entire\s+)?order(?:\s+anymore)?)|(?:i|we)\s+(?:won\s*t|will\s+not|am\s+not\s+going\s+to|are\s+not\s+going\s+to)\s+(?:take|get|order)\s+anything)\b/i

const KORE_EXPLICIT_WHOLE_ORDER_CANCEL_LATIN_MULTI_RE =
  /\b(?:cancela(?:r)?\s+(?:o\s+)?meu\s+pedido|cancela(?:r)?\s+o\s+pedido\s+todo|nao\s+quero\s+mais\s+nada|annule(?:r|z)?\s+(?:ma|la|toute\s+la|notre)\s+commande|je\s+ne\s+veux\s+plus\s+rien|ikansela\s+ang\s+(?:buong\s+)?order|kanselahin\s+ang\s+order|huy\s+(?:toan\s+bo\s+)?don\s+hang|(?:meine\s+)?bestellung\s+(?:stornieren|abbrechen)|annulla(?:re)?\s+(?:il\s+mio\s+|tutto\s+l\s*|l\s*)ordine)\b/i

const KORE_EXPLICIT_WHOLE_ORDER_CANCEL_NFC_RE =
  /(?:주문을?\s*취소|전체\s*취소|取消(?:我的|全部|整个)?订单|订单取消|全部取消|不要了全部|注文を?キャンセル|全部キャンセル|ألغ\s+طلبي|الغ\s+طلبي|إلغاء\s+الطلب|الغاء\s+الطلب|отмени(?:те)?\s+(?:мой\s+|весь\s+)?заказ|कैंसिल\s+कर|ऑर्डर\s+कैंसिल|չեղարկ(?:ել|եք)\s+պատվեր)/iu

/**
 * Retorna `true` ÚNICAMENTE cuando el cliente pide explícitamente cancelar **toda la orden / el pedido / la compra**
 * o irse sin llevar nada, o menciona EBT/CalFresh/Food Stamps.
 * Retorna `false` ante descartes ambiguos de subtema (`"Olvídalo entonces."`, `"Mejor no"`, `"Never mind"`, `"算了"`, `"됐어요"`, `"Deixa pra lá"`, `"Laisse tomber"`)
 * y cuando `"cancelar"` aplica a otro subtema (`"Entiende, me refería a cancelar hablar con el manager la orden si la quiero"`).
 */
export function isExplicitWholeOrderCancelIntent(rawText: string): boolean {
  const raw = String(rawText ?? '').trim()
  if (!raw || isNonLatinNoiseTranscript(raw)) return false
  const nfc = raw.normalize('NFC')

  const norm = stripDiacriticsLower(raw)
    .replace(/['’`]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!norm) return false
  if (KORE_KEEP_ORDER_VETO_RE.test(norm)) return false
  if (KORE_SUBTOPIC_CANCEL_VETO_RE.test(norm)) return false
  if (KORE_EBT_CANCEL_REASON_RE.test(norm)) return true
  if (KORE_EXPLICIT_WHOLE_ORDER_CANCEL_NFC_RE.test(nfc)) return true

  return (
    KORE_EXPLICIT_WHOLE_ORDER_CANCEL_ES_RE.test(norm) ||
    KORE_EXPLICIT_WHOLE_ORDER_CANCEL_EN_RE.test(norm) ||
    KORE_EXPLICIT_WHOLE_ORDER_CANCEL_LATIN_MULTI_RE.test(norm)
  )
}

/**
 * Determina si una invocación de `cancel_order` sobre una orden activa debe bloquearse por falta de confirmación
 * explícita del cliente: permite EBT en `cancelReason` o intención explícita en `customerTurnText`; bloquea todo lo demás.
 */
export function shouldBlockUnconfirmedCancelOrder(
  customerTurnText: string,
  cancelReason?: string | null
): boolean {
  const reasonNorm = stripDiacriticsLower(String(cancelReason ?? ''))
    .replace(/['’`]+/g, '')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (reasonNorm && KORE_EBT_CANCEL_REASON_RE.test(reasonNorm)) {
    return false
  }
  return !isExplicitWholeOrderCancelIntent(customerTurnText)
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
