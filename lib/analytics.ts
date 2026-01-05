/**
 * Analytics utilities for dynamic checklists and feedbacks
 */

export const calculateAverageScore = (records: any[], key: string) => {
    if (!records || records.length === 0) return 0
    const values = records
        .map(r => {
            const val = r.answers?.[key] ?? r[key]
            return typeof val === 'number' ? val : parseFloat(val)
        })
        .filter(v => !isNaN(v))

    if (values.length === 0) return 0
    return values.reduce((a, b) => a + b, 0) / values.length
}

export const getRecordsTrend = (records: any[], dateField: string, scoreField: string = 'score') => {
    if (!records || records.length === 0) return []

    // Group by date
    const groups: { [key: string]: number[] } = {}
    records.forEach(r => {
        const date = r[dateField]?.split('T')[0] || 'N/A'
        if (!groups[date]) groups[date] = []
        groups[date].push(r[scoreField] || 0)
    })

    return Object.entries(groups)
        .map(([date, scores]) => ({
            date,
            score: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
        }))
        .sort((a, b) => a.date.localeCompare(b.date))
}

export const calculateNPS = (records: any[]) => {
    if (!records || records.length === 0) return 0
    const scores = records.map(r => {
        // Try top level first
        if (typeof r.nps_score === 'number') return r.nps_score

        // Try dynamic answers (multiple possible keys)
        const ans = r.answers || {}
        const npsVal = ans['NPS'] ?? ans['nps_10'] ?? ans['nps'] ?? ans['Recomendación']

        return typeof npsVal === 'number' ? npsVal : parseFloat(npsVal)
    }).filter(v => !isNaN(v)) as number[]

    if (scores.length === 0) return 0
    const promoters = scores.filter(v => v >= 9).length
    const detractors = scores.filter(v => v <= 6).length
    return Math.round(((promoters - detractors) / scores.length) * 100)
}
