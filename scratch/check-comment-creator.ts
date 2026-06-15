import { getValidToken, fetchComments } from '../lib/basecamp-api'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

async function run() {
    try {
        const token = await getValidToken()
        const projectId = 21853276
        const messageBcId = 9720175016
        
        console.log(`Fetching comments for message ${messageBcId}...`)
        const comments = await fetchComments(projectId, messageBcId)
        
        console.log(`Found ${comments.length} comments.`)
        if (comments.length > 0) {
            console.log('First comment creator:', comments[0].creator)
            console.log('First comment keys:', Object.keys(comments[0]))
            
            // Print all creators
            comments.forEach((c: any, i: number) => {
                console.log(`Comment ${i}: id=${c.id}, creator.id=${c.creator?.id}, creator.name=${c.creator?.name}`)
            })
        }
    } catch (e: any) {
        console.error('Error:', e.message)
    }
}

run()
