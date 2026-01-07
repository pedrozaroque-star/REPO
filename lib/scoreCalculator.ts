export const calculateInspectionScore = (checklist: any, template: any) => {
    if (!template || !checklist) return checklist?.overall_score || 0

    // Supervisor Calculation (Average of Section Averages)
    // This mimics the logic we established:
    // 1. Traverse sections
    // 2. Traverse questions
    // 3. Find answer (ID -> Text -> Fuzzy)
    // 4. Ignore NA/N/A
    // 5. Avg of Section Avgs

    let totalSectionScores = 0
    let validSections = 0
    const normalize = (t: string) => t ? t.toLowerCase().replace(/[^a-z0-9]/g, '').trim() : ''

    template.sections.forEach((section: any) => {
        let sectionSum = 0
        let sectionCount = 0

        section.questions.forEach((q: any) => {
            let value: any = undefined

            // 1. Try safe JSON parse if answers is string (legacy)
            const answersObj = typeof checklist.answers === 'string'
                ? JSON.parse(checklist.answers)
                : (checklist.answers || {})

            // 2. Strategy: ID match
            if (answersObj[q.id] !== undefined) value = answersObj[q.id]
            // 3. Strategy: Text match
            else if (answersObj[q.text] !== undefined) value = answersObj[q.text]
            else {
                // 4. Strategy: Deep Structure (for Rich Answers)
                if (answersObj[section.title]?.items) {
                    const items = answersObj[section.title].items
                    Object.values(items).forEach((item: any) => {
                        if (normalize(item.label) === normalize(q.text)) {
                            value = item.score !== undefined ? item.score : item
                        }
                    })
                }

                // 5. Strategy: Fuzzy Match (Legacy Flat)
                if (value === undefined) {
                    const questionWords = q.text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter((w: string) => w.length > 2)
                    for (const key of Object.keys(answersObj)) {
                        if (key === '__question_photos' || typeof answersObj[key] === 'object') continue
                        const keyLower = key.toLowerCase()
                        const matchCount = questionWords.filter((w: string) => keyLower.includes(w)).length
                        if (matchCount >= 2 || (questionWords.length === 1 && matchCount === 1)) {
                            value = answersObj[key]
                            break
                        }
                    }
                }
            }

            // IGNORE NA
            if (String(value).toUpperCase() === 'NA' || String(value).toUpperCase() === 'N/A') return

            const numVal = Number(value)
            if (!isNaN(numVal) && value !== null && value !== '' && value !== undefined) {
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
