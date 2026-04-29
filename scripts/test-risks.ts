import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
)

async function run() {
    const d2 = new Date();
    const eDate = d2.toISOString().split('T')[0];
    const d = new Date();
    d.setDate(d.getDate() - 15);
    const sDate = d.toISOString().split('T')[0];

    let allRisks: any[] = [];
    let from = 0;
    const pageSize = 1000;
    let hasMore = true;

    while (hasMore) {
        const { data, error } = await supabase.from('sales_discounts_log')
            .select('store_name, discount_name, discount_amount, approver_name, server_name')
            .in('discount_name', ['First Responder Discount', 'Employee Discount', 'Senior Discount', 'Senior'])
            .gte('business_date', sDate)
            .lte('business_date', eDate)
            .order('id')
            .range(from, from + pageSize - 1);
        
        if (error) {
            console.error('ERROR EN SUPABASE:', error)
            break;
        }
        
        if (data) allRisks = [...allRisks, ...data];
        if (!data || data.length < pageSize) {
            hasMore = false;
        } else {
            from += pageSize;
        }
    }

    console.log(`Total records fetched: ${allRisks.length}`)

    // Agrupar por cajero
    const grouped = allRisks.reduce((acc, curr) => {
        const emp = curr.approver_name || curr.server_name || 'Autoservicio';
        if (!acc[emp]) acc[emp] = { firstResponderTotal: 0, employeeTotal: 0, seniorTotal: 0, stores: {} };
        
        if (curr.discount_name === 'First Responder Discount') {
            acc[emp].firstResponderTotal += Number(curr.discount_amount);
        } else if (curr.discount_name === 'Employee Discount') {
            acc[emp].employeeTotal += Number(curr.discount_amount);
        } else if (curr.discount_name === 'Senior Discount' || curr.discount_name === 'Senior') {
            acc[emp].seniorTotal += Number(curr.discount_amount);
        }

        if (!acc[emp].stores[curr.store_name]) acc[emp].stores[curr.store_name] = 0;
        acc[emp].stores[curr.store_name] += Number(curr.discount_amount);
        
        return acc;
    }, {} as Record<string, any>);

    const structured = Object.entries(grouped)
        .map(([emp, vals]: [string, any]) => {
            const topStore = Object.entries(vals.stores).sort((a: any, b: any) => b[1] - a[1])[0]?.[0] || 'Desconocida';
            
            let cause = "Investigar patrón";
            const fr = vals.firstResponderTotal;
            const em = vals.employeeTotal;
            const sen = vals.seniorTotal;

            const maxAmt = Math.max(fr, em, sen);

            if (maxAmt === fr && fr > 50) cause = "Posible colusión en First Responder";
            else if (maxAmt === em && em > 50) cause = "Posible abuso de Privilegio Interno";
            else if (maxAmt === sen && sen > 50) cause = "Abuso de Descuento Senior (Falsos Mayores)";
            else if ((fr > 0 && em > 0) || (sen > 0 && em > 0)) cause = "Patrón mixto altamente atípico";
            else cause = "Volumen sospechoso general";

            return {
                employee: emp,
                highestStore: topStore,
                firstResponderTotal: vals.firstResponderTotal,
                employeeTotal: vals.employeeTotal,
                seniorTotal: vals.seniorTotal,
                totalRisk: vals.firstResponderTotal + vals.employeeTotal + vals.seniorTotal,
                probableCause: cause
            };
        })
        .filter(r => r.totalRisk > 50) // WAIT, DID I ADD A FILTER IN PAGE.TSX? NO. BUT I ADD IT HERE JUST TO SEE
        .sort((a, b) => b.totalRisk - a.totalRisk)
        .slice(0, 5); 

    console.log('Structured Result:', structured)
}
run()
