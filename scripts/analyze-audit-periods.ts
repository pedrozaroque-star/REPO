import fs from 'fs'
import path from 'path'

// Read the CSV
const csvPath = path.join(process.cwd(), 'audit_historic_2024_2026.csv')
const rawData = fs.readFileSync(csvPath, 'utf-8')
const lines = rawData.split('\n').filter(l => l.trim() !== '')

// Remove Header
const header = lines.shift()

// Structures to hold aggregates
const weeklyStats: Record<string, { forecast: number, actual: number, days: number, dailyErrors: number[] }> = {}
const monthlyStats: Record<string, { forecast: number, actual: number, days: number, dailyErrors: number[] }> = {}

function getWeekNumber(d: Date): string {
    d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7))
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
    const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
    return `${d.getUTCFullYear()}-W${weekNo.toString().padStart(2, '0')}`
}

lines.forEach(line => {
    const cols = line.split(',')
    if (cols.length < 5) return

    const dateStr = cols[0]
    // Force noon to avoid timezone drifts implicitly
    const dateObj = new Date(dateStr + 'T12:00:00')
    const forecast = parseFloat(cols[2])
    const actual = parseFloat(cols[3])

    // Only count days with actual sales > 0 for error calculation
    if (actual <= 0 && forecast <= 0) return // Skip closed days entirely
    if (actual <= 0) return // Skip days with missing data

    const weekKey = getWeekNumber(dateObj)
    const monthKey = dateStr.substring(0, 7) // 2024-01

    // Weekly Accumulator
    if (!weeklyStats[weekKey]) weeklyStats[weekKey] = { forecast: 0, actual: 0, days: 0, dailyErrors: [] }
    weeklyStats[weekKey].forecast += forecast
    weeklyStats[weekKey].actual += actual
    weeklyStats[weekKey].days += 1
    weeklyStats[weekKey].dailyErrors.push(Math.abs(actual - forecast))

    // Monthly Accumulator
    if (!monthlyStats[monthKey]) monthlyStats[monthKey] = { forecast: 0, actual: 0, days: 0, dailyErrors: [] }
    monthlyStats[monthKey].forecast += forecast
    monthlyStats[monthKey].actual += actual
    monthlyStats[monthKey].days += 1
})

// Generate Report
let report = `# 📅 PERIODIC ACCURACY AUDIT (2024-2026)\n\n`

// --- MONTHLY REPORT ---
report += `## 🌙 Monthly Accuracy\n`
report += `| Month | Forecast | Actual | Diff $ | Error % |\n`
report += `|-------|----------|--------|--------|---------|\n`

const sortedMonths = Object.keys(monthlyStats).sort()
let totalMonthError = 0

sortedMonths.forEach(m => {
    const valid = monthlyStats[m].actual > 1000 // Ignore partial/empty months
    if (!valid) return

    const f = monthlyStats[m].forecast
    const a = monthlyStats[m].actual
    const diff = a - f
    const err = Math.abs(diff) / a * 100

    totalMonthError += err

    report += `| ${m} | $${(f / 1000).toFixed(1)}k | $${(a / 1000).toFixed(1)}k | ${diff > 0 ? '+' : ''}$${(diff / 1000).toFixed(1)}k | **${err.toFixed(1)}%** |\n`
})
report += `\n**Avg Monthly Variance:** ${(totalMonthError / sortedMonths.length).toFixed(1)}%\n\n`


// --- WEEKLY REPORT ---
report += `## 📆 Weekly Accuracy (Samples)\n`
report += `| Week | Forecast | Actual | Diff $ | Error % |\n`
report += `|------|----------|--------|--------|---------|\n`

const sortedWeeks = Object.keys(weeklyStats).sort()
let totalWeekError = 0
let weekCount = 0

sortedWeeks.forEach(w => {
    // Only show weeks with substantial data (e.g. not partial weeks at start/end of data)
    // Assuming a "full week" is roughly > $5ksales to avoid noise
    if (weeklyStats[w].actual < 5000) return

    const f = weeklyStats[w].forecast
    const a = weeklyStats[w].actual
    const diff = a - f
    const err = Math.abs(diff) / a * 100

    totalWeekError += err
    weekCount++

    // Only print last 15 weeks to save space in markdown, but calculate avg on ALL
    if (sortedWeeks.indexOf(w) > sortedWeeks.length - 15) {
        report += `| ${w} | $${(f / 1000).toFixed(1)}k | $${(a / 1000).toFixed(1)}k | ${diff > 0 ? '+' : ''}$${(diff / 1000).toFixed(1)}k | ${err.toFixed(1)}% |\n`
    }
})

report += `\n**Global Weekly Accuracy:** ${(100 - (totalWeekError / weekCount)).toFixed(1)}% (Avg Error: ${(totalWeekError / weekCount).toFixed(1)}%)\n`

fs.writeFileSync('audit_periodic_summary.md', report)
console.log('Report generated: audit_periodic_summary.md')
