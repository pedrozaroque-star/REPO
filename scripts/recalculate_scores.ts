
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'
import { calculateInspectionScore } from '../lib/scoreCalculator'

// Load environment variables manually since we can't rely on Next.js loading mechanism in a standalone script
const envPath = path.resolve(process.cwd(), '.env.local')
const envConfig = dotenv.parse(fs.readFileSync(envPath))

const supabaseUrl = envConfig.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = envConfig.SUPABASE_SERVICE_ROLE_KEY // Preferred for admin tasks

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
    process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function recalculateAll() {
    console.log('🚀 Starting Mass Score Recalculation...')

    try {
        // 1. Fetch Template
        // We assume the standard template code 'supervisor_inspection_v1'
        const { data: template, error: tmplError } = await supabase
            .from('checklist_templates')
            .select('*')
            .eq('code', 'supervisor_inspection_v1')
            .single()

        if (tmplError) throw new Error(`Template Fetch Error: ${tmplError.message}`)

        // Parse template structure if string
        const templateData = typeof template.structure === 'string'
            ? JSON.parse(template.structure)
            : template.structure

        console.log('✅ Template Loaded:', templateData.title)

        // 2. Fetch All Inspections
        // We fetch ID, answers, and current overall_score
        const { data: inspections, error: inspError } = await supabase
            .from('supervisor_inspections')
            .select('id, answers, overall_score')

        if (inspError) throw new Error(`Inspections Fetch Error: ${inspError.message}`)

        console.log(`📊 Found ${inspections.length} inspections. Processing...`)

        let updatedCount = 0
        let unchangedCount = 0
        let errorsCount = 0

        for (const insp of inspections) {
            try {
                const currentScore = insp.overall_score
                const calculatedScore = calculateInspectionScore(insp, templateData)

                // Only update if different
                if (currentScore !== calculatedScore) {
                    const { error: updateError } = await supabase
                        .from('supervisor_inspections')
                        .update({ overall_score: calculatedScore })
                        .eq('id', insp.id)

                    if (updateError) {
                        console.error(`❌ Failed update ID ${insp.id}:`, updateError.message)
                        errorsCount++
                    } else {
                        console.log(`🔄 ID ${insp.id}: ${currentScore}% -> ${calculatedScore}%`)
                        updatedCount++
                    }
                } else {
                    unchangedCount++
                }
            } catch (e: any) {
                console.error(`❌ Error processing ID ${insp.id}:`, e.message)
                errorsCount++
            }
        }

        console.log('\n🏁 Recalculation Complete!')
        console.log(`   ✅ Updated: ${updatedCount}`)
        console.log(`   ⏭️ Unchanged: ${unchangedCount}`)
        console.log(`   ❌ Errors: ${errorsCount}`)

    } catch (err: any) {
        console.error('🔥 Fatal Error:', err.message)
    }
}

recalculateAll()
