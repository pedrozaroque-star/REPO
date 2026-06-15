import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { supabaseAdmin } from '../lib/supabase'
import { getValidToken } from '../lib/basecamp-api'

async function run() {
    console.log('Querying Norwalk todo from DB to get bc_id...')
    try {
        const { data, error } = await supabaseAdmin
            .from('bc_todos')
            .select('*')
            .ilike('title', '%Norwalk-Accidente%')
            .limit(1)

        if (error) {
            console.error('DB Error:', error)
            return
        }

        if (!data || data.length === 0) {
            console.log('No todo found matching title "Norwalk-Accidente".')
            return
        }

        const dbTodo = data[0]
        console.log('DB ID:', dbTodo.id)
        console.log('BC ID:', dbTodo.bc_id)
        console.log('Project DB ID:', dbTodo.project_id)

        // Get project bc_id
        const { data: projectData } = await supabaseAdmin
            .from('bc_projects')
            .select('bc_id')
            .eq('id', dbTodo.project_id)
            .single()

        if (!projectData) {
            console.log('No project found for db todo')
            return
        }
        const projectBcId = projectData.bc_id
        console.log('Project BC ID:', projectBcId)

        const token = await getValidToken()
        const accountId = process.env.BASECAMP_ACCOUNT_ID
        const url = `https://3.basecampapi.com/${accountId}/buckets/${projectBcId}/todos/${dbTodo.bc_id}.json`
        console.log('Fetching from Basecamp API:', url)

        const res = await fetch(url, {
            headers: {
                Authorization: `Bearer ${token}`,
                'User-Agent': process.env.BASECAMP_USER_AGENT || 'SM-TEG-Sync (carlos@tacosgavilan.com)'
            }
        })

        if (!res.ok) {
            console.log('Failed to fetch from Basecamp API:', res.status, await res.text())
            return
        }

        const bcTodo = await res.json()
        console.log('Basecamp Todo JSON Keys:', Object.keys(bcTodo))
        console.log('Title:', bcTodo.title)
        console.log('Assignees:', bcTodo.assignees)
        console.log('Completor:', bcTodo.completor)
        console.log('Description Attachments:', bcTodo.description_attachments)
        console.log('Description Attachments Keys:', bcTodo.description_attachments && bcTodo.description_attachments.length > 0 ? Object.keys(bcTodo.description_attachments[0]) : 'None')
        if (bcTodo.description_attachments && bcTodo.description_attachments.length > 0) {
            console.log('First Attachment Detail:', JSON.stringify(bcTodo.description_attachments[0], null, 2))
        }
        console.log('BC Description:', bcTodo.description)
    } catch (err) {
        console.error('Catch error:', err)
    }
}

run()
