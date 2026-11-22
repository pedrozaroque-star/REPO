/**
 * @module lib/checklistValidators
 * @description Funciones de validación para parámetros de control de calidad e inocuidad alimentaria en Tacos Gavilan.
 * @businessRules
 * - Alimentos y equipos fríos / Refrigeración (Cold holding): <= 40°F (40°F o menos).
 * - Congelación (Freezer): <= 32°F (óptimo 0°F).
 * - Mantenimiento caliente (Hot holding / Vaporeras): >= 140°F.
 * @notes Normaliza tildes y mayúsculas para coincidencia bilingüe exacta y prioriza contexto caliente (vaporera/caliente/carnes/huevo ranchero) antes de palabras frías genéricas como 'salsa'.
 */

export const getTempValidation = (questionText: string = '', value: number, sectionTitle?: string) => {
    // Normalizar quitando tildes y pasando a minúsculas
    const normalized = `${questionText || ''} ${sectionTitle || ''}`
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();

    const isFreezer =
        normalized.includes('freezer') ||
        normalized.includes('congelador') ||
        normalized.includes('nieve');

    const hasColdEquipment =
        normalized.includes('refrig') ||
        normalized.includes('frio') ||
        normalized.includes('fria') ||
        /\bcold\b/.test(normalized) ||
        normalized.includes('cooler') ||
        normalized.includes('walk-in') ||
        normalized.includes('walking') ||
        normalized.includes('hiel');

    const isHotHolding =
        !isFreezer &&
        (normalized.includes('vaporera') ||
            normalized.includes('caliente') ||
            normalized.includes('steam') ||
            normalized.includes('parrilla') ||
            normalized.includes('plancha') ||
            /\bhot\b/.test(normalized) ||
            normalized.includes('huevo ranchero') ||
            (!hasColdEquipment &&
                (normalized.includes('arroz') ||
                    normalized.includes('frijol') ||
                    normalized.includes('frijo') ||
                    normalized.includes('carnitas') ||
                    normalized.includes('cabeza') ||
                    normalized.includes('lengua') ||
                    normalized.includes('buche') ||
                    normalized.includes('chorizo') ||
                    normalized.includes('asada') ||
                    normalized.includes('pastor') ||
                    normalized.includes('pollo') ||
                    normalized.includes('champurrado'))));

    const isRefrig = !isFreezer && !isHotHolding && (
        hasColdEquipment ||
        normalized.includes('salsa')
    );

    const num = Number(value);
    if (value === null || value === undefined || (typeof value === 'string' && value === '') || isNaN(num)) {
        return { isValid: false, isRefrig, isFreezer };
    }

    let isValid = false;
    if (isFreezer) {
        isValid = num <= 32; // Congelador debe estar en punto de congelación o menor
    } else if (isRefrig) {
        isValid = num <= 40; // 40°F o menos es lo requerido para lo frío
    } else {
        isValid = num >= 140; // Mantenimiento caliente seguro (>= 140°F)
    }

    return { isValid, isRefrig, isFreezer };
};

