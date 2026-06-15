import { getValidToken } from '../lib/basecamp-api'
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const supabase = createClient(supabaseUrl, supabaseKey)

async function run() {
    try {
        const token = await getValidToken()
        const userAgent = process.env.BASECAMP_USER_AGENT || 'SM-TEG-Sync (carlos@tacosgavilan.com)'

        // 1. Get all comments with null author_person_id
        console.log('Fetching comments with null author_person_id...')
        const { data: comments, error: fetchErr } = await supabase
            .from('bc_comments')
            .select('id, bc_id, project_id')
            .is('author_person_id', null)

        if (fetchErr) throw fetchErr

        console.log(`Found ${comments?.length} comments with null author_person_id`)
        if (!comments || comments.length === 0) return

        // 2. Fetch the comments from Basecamp to get their creator bc_id
        // We will group by project to minimize Basecamp API calls where possible,
        // but since we don't have the parent type and parent bc_id in a unified format,
        // we can fetch the comment details individually or query them.
        // Wait! In Basecamp, can we query comment details directly if we know bucket_id and comment_id?
        // Yes: GET /buckets/:bucket_id/comments/:id.json
        
        // Find the parent project's bc_id for each comment
        const { data: projects } = await supabase.from('bc_projects').select('id, bc_id')
        const projectMap: Record<string, number> = {}
        projects?.forEach(p => {
            projectMap[p.id] = Number(p.bc_id)
        })

        // Let's get already synced people
        const { data: people } = await supabase.from('bc_people').select('id, bc_id')
        const peopleMap: Record<number, string> = {}
        people?.forEach(p => {
            peopleMap[Number(p.bc_id)] = p.id
        })

        console.log('Resolving creator IDs from Basecamp API...')
        const creatorCache: Record<number, { name: string; email: string; avatar: string; role: string; title: string }> = {}

        // To avoid hitting rate limits or taking too long, let's limit to first 100 comments first or run in batches.
        // Actually, we can fetch them sequentially.
        let resolvedCount = 0
        let updatedCount = 0

        for (let i = 0; i < comments.length; i++) {
            const c = comments[i]
            const projectBcId = projectMap[c.project_id]
            if (!projectBcId) continue

            // Fetch comment to get creator ID
            const commentUrl = `https://3.basecampapi.com/5052386/buckets/${projectBcId}/comments/${c.bc_id}.json`
            
            try {
                const res = await fetch(commentUrl, {
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'User-Agent': userAgent
                    }
                })

                if (!res.ok) {
                    if (res.status === 404) {
                        // Comment might be deleted in Basecamp, let's delete it locally or skip
                        console.log(`Comment ${c.bc_id} not found in Basecamp (404), skipping.`)
                    } else {
                        console.error(`Failed to fetch comment ${c.bc_id}: status ${res.status}`)
                    }
                    continue
                }

                const commentData = await res.json()
                const creator = commentData.creator
                if (!creator?.id) continue

                const creatorId = Number(creator.id)

                // Check if creator is already in database (maybe synced in a concurrent step)
                let personUuid = peopleMap[creatorId]

                if (!personUuid) {
                    // Check if we already fetched/inserted this person during this script run
                    if (!creatorCache[creatorId]) {
                        console.log(`👤 Syncing new person: ${creator.name} (bc_id: ${creatorId})`)
                        
                        // Insert new person
                        const { data: newPerson, error: insertErr } = await supabase
                            .from('bc_people')
                            .insert({
                                bc_id: creatorId,
                                name: creator.name,
                                email: creator.email_address || '',
                                avatar_url: creator.avatar_url || '',
                                role: creator.employee ? 'employee' : creator.client ? 'client' : 'user',
                                title: creator.title || '',
                                is_active: true
                            })
                            .select('id')
                            .single()

                        if (insertErr) {
                            console.error(`Error inserting person ${creator.name}:`, insertErr.message)
                            continue
                        }

                        if (newPerson) {
                            peopleMap[creatorId] = newPerson.id
                            personUuid = newPerson.id
                            resolvedCount++
                        }
                    } else {
                        personUuid = peopleMap[creatorId]
                    }
                }

                if (personUuid) {
                    const { error: updateErr } = await supabase
                        .from('bc_comments')
                        .update({ author_person_id: personUuid })
                        .eq('id', c.id)

                    if (!updateErr) {
                        updatedCount++
                    } else {
                        console.error(`Error updating comment ${c.id}:`, updateErr.message)
                    }
                }
            } catch (err: any) {
                console.error(`Error processing comment ${c.bc_id}:`, err.message)
            }

            // Print status every 50 comments
            if (i > 0 && i % 50 === 0) {
                console.log(`Processed ${i}/${comments.length} comments. Synced ${resolvedCount} new people. Updated ${updatedCount} comments.`)
            }
        }

        console.log(`🎉 Finished! Synced ${resolvedCount} new people. Updated ${updatedCount} comments.`)
    } catch (e: any) {
        console.error('Fatal Error:', e.message)
    }
}

run()
