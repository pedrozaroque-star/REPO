/**
 * Converts any answer value (SI/NO, numeric, or rich object) into a numeric score.
 */
export const getNumericValue = (val: any): number | null => {
    if (val === undefined || val === null || val === '') return null

    // Handle rich objects
    if (typeof val === 'object') {
        if (val.score !== undefined) return Number(val.score)
        if (val.value !== undefined) return Number(val.value)
        if (val.response !== undefined) return Number(val.response)
    }

    const sVal = String(val).toUpperCase().trim()
    if (sVal === 'NA' || sVal === 'N/A') return null
    if (sVal === 'SI' || sVal === 'SÍ' || sVal === 'YES' || sVal === 'CUMPLE') return 100
    if (sVal === 'NO' || sVal === 'NO CUMPLE') return 0
    if (sVal === 'PARCIAL' || sVal === 'INCOMPLETO' || sVal === 'CUMPLE CON OBSERVACIONES') return 60

    const num = Number(val)
    return isNaN(num) ? null : num
}

export const calculateInspectionScore = (checklist: any, template: any) => {
    if (!template || !checklist) return checklist?.overall_score || 0

    // Supervisor Calculation (Average of Section Averages)
    let totalSectionScores = 0
    let validSections = 0
    const normalize = (t: string) => t ? t.toLowerCase().replace(/[^a-z0-9]/g, '').trim() : ''

    template.sections.forEach((section: any, sIdx: number) => {
        let sectionSum = 0
        let sectionCount = 0

        const answersObj = typeof checklist.answers === 'string'
            ? JSON.parse(checklist.answers)
            : (checklist.answers || {})

        // Robust Section Lookup
        let sectionItems = null
        const normTitle = normalize(section.title)

        // 1. Direct match
        if (answersObj[section.title]?.items) sectionItems = answersObj[section.title].items
        // 2. Normalized match
        else {
            const matchKey = Object.keys(answersObj).find(k => normalize(k) === normTitle)
            if (matchKey && answersObj[matchKey]?.items) sectionItems = answersObj[matchKey].items
        }

        section.questions.forEach((q: any, qIdx: number) => {
            let value: any = undefined

            // Strategy 0: Positional Index Match (Crucial for Supervisor V1)
            if (sectionItems && (sectionItems[`i${qIdx}`] !== undefined || sectionItems[qIdx] !== undefined)) {
                const item = sectionItems[`i${qIdx}`] || sectionItems[qIdx]
                value = (item.score !== undefined) ? item.score : item
            }

            // Strategy 1: ID match (Top Level)
            if (answersObj[q.id] !== undefined) value = answersObj[q.id]
            // Strategy 2: Text match (Top Level)
            else if (answersObj[q.text] !== undefined) value = answersObj[q.text]
            // Strategy 3: Deep Structure (Inside Section)
            else if (sectionItems) {
                const normQ = normalize(q.text)
                // Try exact label match
                const match = Object.values(sectionItems).find((itm: any) => normalize((itm as any).label) === normQ)
                if (match) {
                    value = (match as any).score !== undefined ? (match as any).score : match
                } else {
                    // Try fuzzy label match (within section)
                    const qWords = q.text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter((w: string) => w.length > 3)
                    if (qWords.length > 0) {
                        const fuzzyMatch = Object.values(sectionItems).find((itm: any) => {
                            const labelLower = ((itm as any).label || '').toLowerCase()
                            const matchCount = qWords.filter((w: string) => labelLower.includes(w)).length
                            return (matchCount / qWords.length) >= 0.5
                        })
                        if (fuzzyMatch) {
                            value = (fuzzyMatch as any).score !== undefined ? (fuzzyMatch as any).score : fuzzyMatch
                        }
                    }
                }
            }

            // Strategy 4: Aggressive Fuzzy (Flat)
            if (value === undefined) {
                const qWords = q.text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter((w: string) => w.length > 3)
                if (qWords.length > 0) {
                    for (const key of Object.keys(answersObj)) {
                        if (key === '__question_photos') continue

                        const val = answersObj[key]

                        // NEW Strategy 5: Deep Search inside items (Modal Style Logic)
                        if (val && typeof val === 'object' && val.items) {
                            for (const subKey of Object.keys(val.items)) {
                                const subItem = val.items[subKey]
                                const label = (subItem.label || subKey).toLowerCase()
                                const matchCount = qWords.filter((w: string) => label.includes(w)).length
                                if (matchCount >= 2 || (qWords.length === 1 && matchCount === 1)) {
                                    value = subItem.score !== undefined ? subItem.score : subItem
                                    break
                                }
                            }
                            if (value !== undefined) break
                        }

                        // Original Flat Strategy
                        if (typeof val !== 'object') {
                            const keyLower = key.toLowerCase()
                            const matchCount = qWords.filter((w: string) => keyLower.includes(w)).length
                            const matchRatio = matchCount / qWords.length
                            if (matchRatio >= 0.5) {
                                value = answersObj[key]
                                break
                            }
                        }
                    }
                }
            }

            const numVal = getNumericValue(value)
            if (numVal !== null) {
                sectionSum += numVal
                sectionCount++
            }
        })

        if (sectionCount > 0) {
            const sectionAvg = Math.round(sectionSum / sectionCount)
            totalSectionScores += sectionAvg
            validSections++
        }
    })

    return validSections > 0 ? Math.round(totalSectionScores / validSections) : 0
}

