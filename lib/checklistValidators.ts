/**
 * @module lib/checklistValidators
 * @description Funciones de validación para parámetros de control de calidad e inocuidad alimentaria en Tacos Gavilan.
 * @businessRules
 * - Refrigeración (Cold holding): 34°F - 41°F.
 * - Congelación (Freezer): <= 32°F (óptimo 0°F).
 * - Mantenimiento caliente (Hot holding / Vaporeras): >= 165°F (mínimo ServSafe 140°F).
 * @notes Normaliza tildes y mayúsculas para coincidencia bilingüe exacta.
 */

export const getTempValidation = (questionText: string = '', value: number, sectionTitle?: string) => {
    // Normalizar quitando tildes y pasando a minúsculas
    const normalized = `${questionText || ''} ${sectionTitle || ''}`
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();

    const isFreezer = normalized.includes('freezer') || normalized.includes('congelador') || normalized.includes('nieve');
    const isRefrig = !isFreezer && (
        normalized.includes('refrig') ||
        normalized.includes('frio') ||
        normalized.includes('fria') ||
        normalized.includes('cold') ||
        normalized.includes('cooler') ||
        normalized.includes('walk-in') ||
        normalized.includes('walking')
    );

    const num = Number(value);
    if (isNaN(num)) {
        return { isValid: false, isRefrig, isFreezer };
    }

    let isValid = false;
    if (isFreezer) {
        isValid = num <= 32; // Congelador debe estar en punto de congelación o menor
    } else if (isRefrig) {
        isValid = num >= 34 && num <= 41; // Rango de refrigeración seguro
    } else {
        isValid = num >= 140; // Mantenimiento caliente seguro (norma salud >= 140°F, ideal >= 165°F)
    }

    return { isValid, isRefrig, isFreezer };
};

