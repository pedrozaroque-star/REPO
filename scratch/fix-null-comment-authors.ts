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
        const { data: comments, error: fetchErr } = await supabase
            .from('bc_comments')
            .select('id, bc_id, project_id, parent_type, parent_id')
            .is('author_person_id', null)

        if (fetchErr) throw fetchErr

        console.log(`Found ${comments?.length} comments with null author_person_id`)

        if (!comments || comments.length === 0) return

        // Get all people to map bc_id -> uuid
        const { data: people } = await supabase.from('bc_people').select('id, bc_id')
        const peopleMap: Record<number, string> = {}
        people?.forEach(p => {
            peopleMap[Number(p.bc_id)] = p.id
        })

        // Find the parent project's bc_id for each comment
        // Since we need projectId for the Basecamp API request (e.g. GET /buckets/:projectId/recordings/:recordingId/comments)
        // Let's get a map of project UUID -> Basecamp ID
        const { data: projects } = await supabase.from('bc_projects').select('id, bc_id')
        const projectMap: Record<string, number> = {}
        projects?.forEach(p => {
            projectMap[p.id] = Number(p.bc_id)
        })

        for (const c of comments) {
            const projectBcId = projectMap[c.project_id]
            if (!projectBcId) {
                console.warn(`Project not found in map for comment ${c.id}, projectUuid=${c.project_id}`)
                continue
            }

            // In Basecamp API: GET /buckets/:bucket_id/recordings/:recording_id/comments
            // Wait, we can fetch the specific comment by its recording ID! In Basecamp, a comment is a recording.
            // GET /buckets/:bucket_id/comments/:id
            const commentUrl = `https://3.basecampapi.com/5052386/buckets/${projectBcId}/comments/${c.bc_id}.json`
            
            console.log(`Fetching comment ${c.bc_id} details from Basecamp...`)
            const res = await fetch(commentUrl, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'User-Agent': userAgent
                }
            })

            if (!res.ok) {
                console.error(`Failed to fetch comment ${c.bc_id}: status ${res.status}`)
                continue
            }

            const commentData = await res.json()
            const creatorBcId = commentData.creator?.id
            if (!creatorBcId) {
                console.warn(`No creator ID found in Basecamp response for comment ${c.bc_id}`)
                continue
            }

            const personUuid = peopleMap[Number(creatorBcId)]
            if (personUuid) {
                console.log(`Updating comment ${c.bc_id} author to ${commentData.creator?.name} (UUID: ${personUuid})`)
                const { error: updateErr } = await supabase
                    .from('bc_comments')
                    .update({ author_person_id: personUuid })
                    .eq('id', c.id)

                if (updateErr) {
                    console.error(`Error updating comment ${c.bc_id}:`, updateErr.message)
                }
            } else {
                console.warn(`Creator bc_id ${creatorBcId} (${commentData.creator?.name}) not found in bc_people!`)
            }
        }

        console.log('✅ Comments author repair completed.')
    } catch (e: any) {
        console.error('Error:', e.message)
    }
}

run()
