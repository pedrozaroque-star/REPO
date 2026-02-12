import { supabase } from '../lib/supabase'

    ; (async () => {
        // Jamon (019W) -> 25 pza
        const { error: errJ } = await supabase.from('inventory_items').update({ unit_type: '25 pza' }).eq('sku', '019W')
        if (errJ) console.error(errJ)

        // Salchicha (017W) -> 50 pza
        const { error: errS } = await supabase.from('inventory_items').update({ unit_type: '50 pza' }).eq('sku', '017W')
        if (errS) console.error(errS)

        console.log('✅ Jamon Pack: 25 pza')
        console.log('✅ Salchicha Bag: 50 pza')
    })()
