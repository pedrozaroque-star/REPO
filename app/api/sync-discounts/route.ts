import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const TOAST_API_HOST = process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com'
const TOAST_CLIENT_ID = process.env.TOAST_CLIENT_ID || ''
const TOAST_CLIENT_SECRET = process.env.TOAST_CLIENT_SECRET || ''

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const TOAST_GUID_MAP: Record<string, string> = {
    "acf15327-54c8-4da4-8d0d-3ac0544dc422": "Rialto",
    "e0345b1f-d6d6-40b2-bd06-5f9f4fd944e8": "Azusa",
    "42ed15a6-106b-466a-9076-1e8f72451f6b": "Norwalk",
    "b7f63b01-f089-4ad7-a346-afdb1803dc1a": "Downey",
    "475bc112-187d-4b9c-884d-1f6a041698ce": "LA Broadway",
    "a83901db-2431-4283-834e-9502a2ba4b3b": "Bell",
    "5fbb58f5-283c-4ea4-9415-04100ee6978b": "Hollywood",
    "47256ade-2cd4-4073-9632-84567ad9e2c8": "Huntington Park",
    "8685e942-3f07-403a-afb6-faec697cd2cb": "LA Central",
    "3a803939-eb13-4def-a1a4-462df8e90623": "La Puente",
    "80a1ec95-bc73-402e-8884-e5abbe9343e6": "Lynwood",
    "3c2d8251-c43c-43b8-8306-387e0a4ed7c2": "Santa Ana",
    "9625621e-1b5e-48d7-87ae-7094fab5a4fd": "Slauson",
    "95866cfc-eeb8-4af9-9586-f78931e1ea04": "South Gate",
    "5f4a006e-9a6e-4bcf-b5bd-7f5e9d801a02": "West Covina"
}

// --- HELPER: GET DINING OPTIONS MAP ---
async function getDiningOptionsMap(token: string, storeId: string): Promise<Record<string, string>> {
    try {
        const url = new URL(`${TOAST_API_HOST}/config/v2/diningOptions`)
        const res = await fetch(url.toString(), {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Toast-Restaurant-External-ID': storeId
            }
        })
        if (!res.ok) return {}
        const data = await res.json()
        const map: Record<string, string> = {}
        if (Array.isArray(data)) {
            data.forEach((opt: any) => {
                if (opt.guid && opt.name) map[opt.guid] = opt.name
            })
        }
        return map
    } catch (e) {
        return {}
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const dateStr = body.date;
        if (!dateStr) {
            return NextResponse.json({ error: 'Falta la fecha' }, { status: 400 });
        }

        const formattedDate = dateStr.split('-').join('')

        // 1. Auth
        const authRes = await fetch(`${TOAST_API_HOST}/authentication/v1/authentication/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                clientId: TOAST_CLIENT_ID,
                clientSecret: TOAST_CLIENT_SECRET,
                userAccessType: 'TOAST_MACHINE_CLIENT'
            })
        })
        if (!authRes.ok) throw new Error('Fallo al autenticar Toast')
        const token = (await authRes.json()).token.accessToken

        // 2. Cargar Mapa de Empleados (Supabase) con bucle para saltar límite de 1000 registros
        let allEmployees: any[] = []
        let empPage = 0
        while (true) {
            const { data } = await supabase
                .from('toast_employees')
                .select('toast_guid, first_name, last_name, chosen_name')
                .range(empPage * 1000, (empPage + 1) * 1000 - 1)
            
            if (!data || data.length === 0) break
            allEmployees = [...allEmployees, ...data]
            if (data.length < 1000) break
            empPage++
        }

        const employeeMap = new Map<string, string>()
        allEmployees.forEach(emp => {
            const name = emp.chosen_name || `${emp.first_name || ''} ${emp.last_name || ''}`.trim()
            if (name) employeeMap.set(emp.toast_guid, name)
        })
        
        // 3. Cargar diccionario de Dining Options para resolver transacciones digitales
        const storeDiningMaps: Record<string, Record<string, string>> = {}
        for (const [storeId] of Object.entries(TOAST_GUID_MAP)) {
            storeDiningMaps[storeId] = await getDiningOptionsMap(token, storeId)
        }

        let totalInserted = 0

        for (const [storeId, storeName] of Object.entries(TOAST_GUID_MAP)) {
            let page = 1;
            let hasMore = true;

            while (hasMore) {
                const url = new URL(`${TOAST_API_HOST}/orders/v2/ordersBulk`)
                url.searchParams.append('businessDate', formattedDate)
                url.searchParams.append('pageSize', '100')
                url.searchParams.append('page', String(page))

                // Hemos quitado "fields" para traer todo el JSON y auditar cada flag de anulación posible
                const res = await fetch(url.toString(), {
                    headers: { 'Authorization': `Bearer ${token}`, 'Toast-Restaurant-External-ID': storeId }
                })
                
                if (!res.ok) {
                    if (res.status === 429) {
                        await new Promise(r => setTimeout(r, 4000));
                        continue;
                    }
                    break;
                }
                
                const orders = await res.json()
                if (!Array.isArray(orders) || orders.length === 0) {
                    hasMore = false; break;
                }

                // Creador de nombres Inteligente (Prioridad: 1. Mapa BD -> 2. Nombres -> 3. Limpieza de Toast)
                const buildName = (obj: any, fallback: string) => {
                    if (!obj) return fallback
                    if (typeof obj === 'string') {
                        if (employeeMap.has(obj)) return employeeMap.get(obj)!
                        return obj === 'Unknown Server' ? 'Caja / Sistema Automático' : obj
                    }

                    // 1. Prioridad Máxima: Cruce Exacto de Base de Datos
                    const idToUse = obj.guid || obj.id
                    if (idToUse && employeeMap.has(idToUse)) {
                        return employeeMap.get(idToUse)!
                    }

                    // 2. Respaldo: Propiedades separadas
                    if (obj.firstName || obj.lastName) return `${obj.firstName || ''} ${obj.lastName || ''}`.trim()
                    
                    // 3. Respaldo Final: obj.name (Limpiando basuras de Toast)
                    if (obj.name) {
                        return obj.name === 'Unknown Server' ? 'Caja / Sistema Automático' : obj.name
                    }

                    return fallback
                }

                const allDiscountsToInsert: any[] = []
                orders.forEach(order => {
                    if (order.voided || order.deleted || order.createdInTestMode) return;

                    let fallbackName = 'Sistema Automático'
                    const diningOptionsMap = storeDiningMaps[storeId] || {}
                    if (order.diningOption) {
                        const optId = order.diningOption.guid || order.diningOption.id
                        if (optId && diningOptionsMap[optId]) {
                            fallbackName = `Integración: ${diningOptionsMap[optId]}`
                        }
                    }

                    const serverNameOrder = buildName(order.server, fallbackName)
                    const openedDate = order.openedDate
                    
                    order.checks?.forEach((check: any) => {
                        // REGLA ESTRICTA: Toast Web ignora tickets Abiertos o Impagados
                        if (check.voided || check.deleted || (check.paymentStatus !== 'CLOSED' && check.paymentStatus !== 'PAID')) return; 

                        // Filtro agresivo de Reembolsos (Refunds)
                        const isRefundedCheck = check.payments?.some((p:any) => p.refundStatus && p.refundStatus !== 'NONE') || false;
                        if (isRefundedCheck) return; 
                        
                        // ESCUDO MATEMÁTICO: Validar que el cheque realmente tenga un descuento
                        const subtotalBruto = check.selections?.filter((s:any)=> !s.deleted && !s.voided).reduce((sum: number, sel: any) => {
                            const qty = sel.quantity || 1;
                            const unitPrice = Number(sel.receiptLinePrice || (Number(sel.price) / qty) || 0);
                            return sum + (unitPrice * qty);
                        }, 0) || 0;
                        const subtotalNeto = Number(check.amount || 0);
                        const totalRealDiscount = Math.max(0, subtotalBruto - subtotalNeto);
                        
                        // Si matemáticamente no hubo diferencia entre el cobro y el precio real, no hay descuentos reales.
                        if (totalRealDiscount < 0.01) return;
                        
                        // Nivel Check
                        if (check.appliedDiscounts) {
                            check.appliedDiscounts.forEach((disc: any) => {
                                if (disc.voided || disc.deleted || disc.state === 'VOIDED' || disc.state === 'REMOVED' || disc.applied === false) return;
                                if (Number(disc.discountAmount||0) > 0) {
                                    allDiscountsToInsert.push({
                                        store_id: storeId, store_name: storeName, business_date: dateStr, discount_name: disc.name || 'Unknown', discount_amount: Number(disc.discountAmount), approver_name: buildName(disc.approver, serverNameOrder), server_name: serverNameOrder, order_id: String(order.guid || order.id || 'N/A'), check_id: String(check.displayNumber || order.displayNumber || check.guid || check.id || 'N/A'), opened_date: openedDate
                                    })
                                }
                            })
                        }
                        // Nivel Platillo (ITEM) - LOS SENIORS
                        if (check.selections) {
                            check.selections.forEach((sel: any) => {
                                // Quitamos receiptLinePrice === 0 porque los descuentos de 100% hacen que la linea valga 0, pero SÍ son descuentos validos.
                                if (sel.voided || sel.deleted || sel.deferred || sel.state === 'VOIDED' || sel.state === 'REMOVED' || sel.refundDetails) return; 

                                if (sel.appliedDiscounts) {
                                    sel.appliedDiscounts.forEach((disc: any) => {
                                        if (disc.voided || disc.deleted || disc.state === 'VOIDED' || disc.state === 'REMOVED' || disc.applied === false) return;
                                        if (Number(disc.discountAmount||0) > 0) {
                                            allDiscountsToInsert.push({
                                                store_id: storeId, store_name: storeName, business_date: dateStr, discount_name: disc.name || 'Unknown', discount_amount: Number(disc.discountAmount), approver_name: buildName(disc.approver, serverNameOrder), server_name: serverNameOrder, order_id: String(order.guid || order.id || 'N/A'), check_id: String(check.displayNumber || order.displayNumber || check.guid || check.id || 'N/A'), opened_date: openedDate
                                            })
                                        }
                                    })
                                }
                            })
                        }
                    })
                })

                // Limpiar primera vez
                if (page === 1) {
                    await supabase.from('sales_discounts_log').delete().eq('store_id', storeId).eq('business_date', dateStr)
                }

                if (allDiscountsToInsert.length > 0) {
                    await supabase.from('sales_discounts_log').insert(allDiscountsToInsert)
                    totalInserted += allDiscountsToInsert.length
                }

                if (orders.length < 100) hasMore = false;
                else page++;
            }
        }

        return NextResponse.json({ success: true, date: dateStr, total_inserted: totalInserted })
    } catch (e: any) {
        return NextResponse.json({ success: false, error: e.message }, { status: 500 })
    }
}
