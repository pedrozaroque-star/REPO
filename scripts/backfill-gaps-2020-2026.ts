
import { runBackfillRange } from './backfill-runner'

// The user requested a "Gap Fill" from 2020 up to Jan 24, 2026.
// Daily cron jobs will handle Jan 25 onwards.

async function main() {
    console.log('🌟 Starting Master Backfill: 2020 through Jan 24, 2026')
    // We run it as one big range. 
    // The runner handles year boundaries (Date object handles it).

    // START: Jan 23, 2026 (Priority)
    const start = '2026-01-23'

    // END: Nov 1, 2020
    const end = '2020-11-01'

    await runBackfillRange(start, end)
}

main()
