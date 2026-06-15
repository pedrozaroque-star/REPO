import { supabaseAdmin } from '../lib/supabase'

async function run() {
    console.log('Querying Norwalk todo...')
    try {
        const { data, error } = await supabaseAdmin
            .from('bc_todos')
            .select('*')
            .ilike('title', '%Norwalk-Accidente%')
            .limit(1)

        if (error) {
            console.error('Error:', error)
            return
        }

        if (!data || data.length === 0) {
            console.log('No todo found matching title "Norwalk-Accidente". Let us list some open todos.')
            const { data: listData } = await supabaseAdmin
                .from('bc_todos')
                .select('id, title, is_completed')
                .limit(20)
            console.log('Todos list:', listData)
            return
        }

        const todo = data[0]
        console.log('ID:', todo.id)
        console.log('Title:', todo.title)
        console.log('Description length:', todo.description?.length)
        console.log('Description:', todo.description)
    } catch (err) {
        console.error('Catch error:', err)
    }
}

run()
