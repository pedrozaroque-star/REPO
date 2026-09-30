/**
 * @module StoreTimeOffset
 * @description Calcula y aplica desfases horarios (time offsets) para los horarios de actividades
 *   de cada tienda, relativo a la tienda base/referencia (Slauson).
 *   Calculates and applies time offsets for store-specific activity schedules
 *   relative to the base/reference store (Slauson).
 * @businessRules
 * - Tienda base/referencia: Slauson (abre al público 10:00 AM, cierra 1:00 AM)
 *   Base/reference store: Slauson (opens 10:00 AM to customers, closes 1:00 AM)
 * - El personal llega siempre 1 hora antes de abrir al público
 *   Staff always arrives 1 hour before customer opening
 * - El personal se va siempre 1 hora después de cerrar al público
 *   Staff always departs 1 hour after customer closing
 * - Actividades de Apertura y Regular se recorren por el offset de apertura
 *   Apertura & Regular activities shift by the opening offset
 * - Actividades de Cierre se recorren por el offset de cierre
 *   Cierre activities shift by the closing offset
 * - El cambio de turno a las 5:00 PM es FIJO y nunca se mueve
 *   The 5:00 PM shift change is FIXED and never moves
 * @dataFlow
 * - Lee opening_time y closing_time de la tabla stores en Supabase
 *   Reads opening_time and closing_time from stores table
 * - Se aplica a nivel de presentación/display, NO se modifica la base de datos
 *   Applied at the display/presentation layer, NOT stored in DB
 * @notes
 * - Los tiempos en operating_procedures están calibrados para Slauson
 *   Times in operating_procedures are calibrated for Slauson
 * - Slauson: personal llega 9:00 AM (1h antes de 10 AM), última actividad cierre 2:00 AM (1h después de 1 AM)
 */

// ═══════════════════════════════════════════════════════════════
// Slauson base times (reference store / tienda de referencia)
// ═══════════════════════════════════════════════════════════════
const BASE_OPENING_MINUTES = 10 * 60; // 10:00 AM = 600 minutes (apertura al público)
// Cierre: 1:00 AM = hora 25 en notación 24h+ (1 + 24 = 25), 25 * 60 = 1500
const BASE_CLOSING_MINUTES = 25 * 60; // 1:00 AM next day = 1500 minutes

/**
 * Convierte un string de hora (HH:MM:SS o HH:MM) a minutos desde medianoche.
 * Para horas de cierre que caen en la madrugada (< 6:00 AM), suma 24 horas
 * para mantener la continuidad del día laboral TEG (6:00 AM a 5:59 AM).
 *
 * Converts a time string to minutes from midnight.
 * For closing times past midnight (< 6 AM), adds 24 hours to maintain
 * TEG business day continuity (6:00 AM to 5:59 AM).
 */
function parseTimeToMinutes(timeStr: string | null, isClosingTime: boolean = false): number {
  if (!timeStr) return 0;
  const parts = timeStr.split(':');
  let h = parseInt(parts[0], 10);
  const m = parseInt(parts[1] || '0', 10);
  if (isNaN(h) || isNaN(m)) return 0;
  // Para horas de cierre en madrugada (00:00 a 05:59), sumar 24h
  if (isClosingTime && h < 6) h += 24;
  return h * 60 + m;
}

/**
 * Interfaz que contiene los dos desfases calculados para una tienda.
 * Interface containing the two calculated offsets for a store.
 */
export interface StoreOffsets {
  /** Desfase en minutos para actividades de Apertura y Regular */
  openingOffsetMinutes: number;
  /** Desfase en minutos para actividades de Cierre */
  closingOffsetMinutes: number;
}

/**
 * Calcula los desfases horarios de una tienda relativo a Slauson.
 * Calculates the time offsets for a store relative to Slauson.
 *
 * @param openingTime - Hora de apertura al público de la tienda (ej. "08:00:00")
 * @param closingTime - Hora de cierre al público de la tienda (ej. "02:00:00")
 * @returns StoreOffsets con openingOffsetMinutes y closingOffsetMinutes
 *
 * @example
 * // LA Central: abre 8 AM, cierra 2 AM
 * calculateStoreOffsets("08:00:00", "02:00:00")
 * // → { openingOffsetMinutes: -120, closingOffsetMinutes: 60 }
 * // Apertura/Regular se recorren 2 horas antes, Cierre 1 hora después
 *
 * @example
 * // Slauson (base): abre 10 AM, cierra 1 AM
 * calculateStoreOffsets("10:00:00", "01:00:00")
 * // → { openingOffsetMinutes: 0, closingOffsetMinutes: 0 }
 * // Sin desfase (es la tienda de referencia)
 *
 * @example
 * // Azusa: abre 10 AM, cierra 11 PM
 * calculateStoreOffsets("10:00:00", "23:00:00")
 * // → { openingOffsetMinutes: 0, closingOffsetMinutes: -120 }
 * // Apertura sin cambio, Cierre 2 horas antes
 */
export function calculateStoreOffsets(
  openingTime: string | null,
  closingTime: string | null
): StoreOffsets {
  const storeOpening = parseTimeToMinutes(openingTime, false);
  const storeClosing = parseTimeToMinutes(closingTime, true);

  return {
    openingOffsetMinutes: storeOpening - BASE_OPENING_MINUTES,
    closingOffsetMinutes: storeClosing - BASE_CLOSING_MINUTES,
  };
}

/**
 * Aplica el desfase horario a una hora de actividad según su tipo de turno.
 * Applies the time offset to an activity time based on its shift type.
 *
 * @param timeStr - Hora original de la actividad (ej. "09:00:00")
 * @param shiftType - Tipo de turno: "Apertura", "Regular", o "Cierre"
 * @param offsets - Desfases calculados por calculateStoreOffsets()
 * @returns Hora ajustada como string "HH:MM:SS", o null si la entrada es null
 *
 * @example
 * const offsets = { openingOffsetMinutes: -120, closingOffsetMinutes: 60 };
 * applyTimeOffset("09:00:00", "Apertura", offsets) // → "07:00:00"
 * applyTimeOffset("14:00:00", "Regular", offsets)  // → "12:00:00"
 * applyTimeOffset("23:00:00", "Cierre", offsets)   // → "00:00:00"
 */
export function applyTimeOffset(
  timeStr: string | null,
  shiftType: string,
  offsets: StoreOffsets
): string | null {
  if (!timeStr) return timeStr;

  // Determinar cuál offset aplicar según el tipo de turno
  const offset =
    shiftType === 'Cierre'
      ? offsets.closingOffsetMinutes
      : offsets.openingOffsetMinutes;

  // Si el offset es 0, no hay nada que hacer (misma tienda base o mismo horario)
  if (offset === 0) return timeStr;

  // REGLA DE NEGOCIO: El cambio de turno a las 5:00 PM (17:00) es FIJO y NUNCA se mueve
  // (The 5:00 PM shift change is FIXED and never moves regardless of store offset)
  const parts0 = timeStr.split(':');
  const h0 = parseInt(parts0[0], 10);
  const m0 = parseInt(parts0[1] || '0', 10);
  if (h0 === 17 && m0 === 0) return timeStr;

  const parts = timeStr.split(':');
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1] || '0', 10);
  const s = parts[2] || '00';

  if (isNaN(h) || isNaN(m)) return timeStr;

  let totalMinutes = h * 60 + m + offset;

  // Normalizar al rango 0-1439 (24 horas)
  while (totalMinutes < 0) totalMinutes += 1440;
  while (totalMinutes >= 1440) totalMinutes -= 1440;

  const newH = Math.floor(totalMinutes / 60);
  const newM = totalMinutes % 60;

  return `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}:${s}`;
}

/**
 * Verifica si una tienda es la tienda base/referencia (Slauson).
 * Checks if a store is the base/reference store (Slauson).
 * Útil para evitar cálculos innecesarios cuando los offsets son 0.
 */
export function isBaseStore(openingTime: string | null, closingTime: string | null): boolean {
  const offsets = calculateStoreOffsets(openingTime, closingTime);
  return offsets.openingOffsetMinutes === 0 && offsets.closingOffsetMinutes === 0;
}

/**
 * Formatea una hora con offset aplicado para mostrar en la UI.
 * Formats a time with offset applied for UI display.
 * Convierte "HH:MM:SS" a "H:MM AM/PM".
 */
export function formatOffsetTime(
  timeStr: string | null,
  shiftType: string,
  offsets: StoreOffsets
): string {
  const adjusted = applyTimeOffset(timeStr, shiftType, offsets);
  if (!adjusted) return '';

  const parts = adjusted.split(':');
  let h = parseInt(parts[0], 10);
  const m = parts[1] || '00';

  if (isNaN(h)) return '';

  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${m} ${ampm}`;
}
