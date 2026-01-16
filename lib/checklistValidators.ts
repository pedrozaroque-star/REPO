export const getTempValidation = (questionText: string, value: number, sectionTitle?: string) => {
    const textToCheck = `${questionText} ${sectionTitle || ''}`.toLowerCase()
    const isRefrig = textToCheck.includes('refrig') || textToCheck.includes('frio')
    // Requisito: Refrigeración 34-41°F, Caliente >= 165°F
    const isValid = isRefrig ? (value >= 34 && value <= 41) : (value >= 165)
    return { isValid, isRefrig }
}
