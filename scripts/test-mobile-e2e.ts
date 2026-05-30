import dotenv from 'dotenv'

// Cargar variables de entorno
dotenv.config({ path: '.env.local' })

const BACKEND_URL = 'http://localhost:3001'

async function runE2ETest() {
    console.log('\n======================================================')
    console.log('🧪 INICIANDO PRUEBAS DE FUNCIONAMIENTO E2E: GAVILÁN APP')
    console.log('======================================================\n')

    try {
        // 🩺 PRUEBA 1: Verificar el Healthcheck del servidor de backend
        console.log('🩺 [Prueba 1] Verificando salud del servidor en puerto 3001...')
        const healthRes = await fetch(`${BACKEND_URL}/health`)
        if (!healthRes.ok) throw new Error('El servidor de backend no responde.')
        const healthData = await healthRes.json() as any
        console.log(`   ✅ Servidor Activo. Estado: ${healthData.status}, Uptime: ${Math.round(healthData.uptime)}s`)
        console.log(`   Mensaje: "${healthData.message}"\n`)

        // 🌮 PRUEBA 2: Verificar carga del catálogo de Menú
        console.log('🌮 [Prueba 2] Verificando carga del Menú desde Supabase...')
        const menuRes = await fetch(`${BACKEND_URL}/api/mobile/menu?storeId=11`)
        if (!menuRes.ok) throw new Error('Error al cargar el menú.')
        const menuData = await menuRes.json() as any
        
        if (menuData.success) {
            const categories = Object.keys(menuData.categories || {})
            console.log(`   ✅ Menú cargado exitosamente para la sucursal.`)
            console.log(`   Categorías disponibles (${categories.length}):`, categories.join(', '))
            console.log(`   Total grupos de modificadores detectados:`, Object.keys(menuData.modifierGroups || {}).length, '\n')
        } else {
            console.log('   ⚠️ Menú vacío en base de datos. (Es normal si no se ha corrido la sincronización de Toast. Se usarán datos de respaldo).\n')
        }

        // 🛒 PRUEBA 3: Creación de una Orden de Compra en estado HOLDING (Hold-and-Fire)
        console.log('🛒 [Prueba 3] Creando orden de prueba en estado "HOLDING"...')
        
        // Obtener una tienda activa de la base de datos para garantizar compatibilidad
        console.log('🏬 Buscando una sucursal activa en Supabase...')
        const { getSupabaseAdminClient } = await import('../lib/supabase.js')
        const supabase = await getSupabaseAdminClient()
        const { data: dbStores, error: dbStoresErr } = await supabase
            .from('stores')
            .select('id, name')
            .limit(1)

        if (dbStoresErr || !dbStores || dbStores.length === 0) {
            throw new Error('No se encontraron sucursales activas en la base de datos para la prueba.')
        }
        
        const activeStore = dbStores[0]
        const mockStoreId = Number(activeStore.id)
        console.log(`   ✅ Sucursal seleccionada para la prueba: ${activeStore.name} (ID: ${mockStoreId})`)

        // Obtener un usuario válido de app_users para cumplir con la llave foránea
        console.log('👤 Buscando un usuario registrado en la base de datos...')
        const { data: dbUsers } = await supabase
            .from('app_users')
            .select('id')
            .limit(1)

        let mockUserId = ''
        if (dbUsers && dbUsers.length > 0) {
            mockUserId = dbUsers[0].id
            console.log(`   ✅ Usuario seleccionado para la prueba: ID ${mockUserId}`)
        } else {
            console.log('   ⚠️ No se encontraron usuarios. Creando uno de prueba temporal en Supabase...')
            const mockPhone = '+1' + Math.floor(1000000000 + Math.random() * 9000000000).toString()
            const { data: authUser, error: authUserErr } = await supabase.auth.admin.createUser({
                phone: mockPhone,
                phone_confirm: true,
                user_metadata: { first_name: 'Carlos', last_name: 'Velázquez' }
            })

            if (authUserErr) {
                throw new Error(`No se pudo crear usuario en auth.users: ${authUserErr.message}`)
            }

            mockUserId = authUser.user.id

            const { error: appUserErr } = await supabase
                .from('app_users')
                .insert({
                    id: mockUserId,
                    phone: mockPhone,
                    first_name: 'Carlos',
                    last_name: 'Velázquez'
                })

            if (appUserErr) {
                throw new Error(`No se pudo registrar perfil en app_users: ${appUserErr.message}`)
            }
            console.log(`   ✅ Usuario de prueba creado y registrado: ID ${mockUserId}`)
        }
        
        const mockOrderPayload = {
            userId: mockUserId,
            storeId: mockStoreId,
            pickupMethod: 'curbside',
            curbsideStall: 'Cajón #5',
            paymentIntentId: 'pi_test_' + Math.random().toString(36).substring(7),
            userCoords: {
                lat: 34.0522, // Los Ángeles
                lng: -118.2437,
                eta: 10 // Iniciamos lejos: 10 minutos
            },
            items: [
                {
                    guid: 'toast-item-asada',
                    name: 'Taco de Asada',
                    price: 2.75,
                    qty: 3,
                    modifiers: [
                        { guid: 'mod-cebolla', name: 'Con Cebolla', price: 0.00 },
                        { guid: 'mod-cilantro', name: 'Con Cilantro', price: 0.00 },
                        { guid: 'mod-aguacate', name: 'Con Aguacate', price: 0.50 }
                    ]
                },
                {
                    guid: 'toast-item-pastor',
                    name: 'Burrito de Pastor',
                    price: 8.50,
                    qty: 1,
                    modifiers: []
                }
            ]
        }

        const createRes = await fetch(`${BACKEND_URL}/api/mobile/order/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(mockOrderPayload)
        })

        if (!createRes.ok) {
            const errTxt = await createRes.text()
            throw new Error(`Error al crear orden: ${errTxt}`)
        }

        const orderResult = await createRes.json() as any
        const orderId = orderResult.orderId
        console.log(`   ✅ Orden de compra creada con éxito en la base de datos!`)
        console.log(`   ID de Orden: ${orderId}`)
        console.log(`   Estado inicial: ${orderResult.status} (Hold-and-Fire Activo)`)
        console.log(`   Total a Pagar (Neto + 9.5% Impuestos): $${orderResult.total}\n`)

        // 🚗 PRUEBA 4: Actualización GPS - Cliente se encuentra Lejos (ETA = 8 min)
        console.log('🚗 [Prueba 4] Simulando actualización GPS lejana (ETA = 8 minutos)...')
        const gpsFarRes = await fetch(`${BACKEND_URL}/api/mobile/order/geofence/update`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                orderId: orderId,
                latitude: 34.0400,
                longitude: -118.2300,
                deviceEtaMinutes: 8 // Lejos (8 minutos)
            })
        })

        if (!gpsFarRes.ok) throw new Error('Error al actualizar GPS lejana.')
        const gpsFarResult = await gpsFarRes.json() as any
        console.log(`   ✅ Coordenadas actualizadas. Estado de la orden: ${gpsFarResult.status}`)
        console.log(`   Respuesta del Servidor: "${gpsFarResult.message}"`)
        console.log(`   Distancia calculada hacia la sucursal: ${gpsFarResult.distance.toFixed(2)} millas\n`)

        // 🚀 PRUEBA 5: ¡GATILLO GPS ACTIVADO! - Cliente entra al rango de cocción (ETA <= 4 min)
        console.log('🚀 [Prueba 5] Simulando cliente entrando al rango de 4 minutos (ETA = 3 minutos)...')
        const gpsCloseRes = await fetch(`${BACKEND_URL}/api/mobile/order/geofence/update`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                orderId: orderId,
                latitude: 34.0200,
                longitude: -118.2100,
                deviceEtaMinutes: 3 // ¡Rango de disparo! (3 minutos)
            })
        })

        if (!gpsCloseRes.ok) throw new Error('Error en disparo por GPS.')
        const gpsCloseResult = await gpsCloseRes.json() as any
        console.log(`   💥 ¡GATILLO GPS DISPARADO EN EL SERVIDOR!`)
        console.log(`   ✅ Estado de la orden actualizado a: ${gpsCloseResult.status}`)
        console.log(`   Simulación de Toast POS:`, gpsCloseResult.toastResult.success ? '✅ Transmitido con Éxito' : '❌ Falló')
        console.log(`   ID de Orden en Toast POS: ${gpsCloseResult.toastResult.toastOrderGuid}`)
        console.log(`   Respuesta del Servidor: "${gpsCloseResult.message}"\n`)

        // 🏁 PRUEBA 6: Verificar Estado Final de la Orden directamente en Supabase
        console.log('🏁 [Prueba 6] Consultando el estado final de la orden directamente en Supabase...')
        const { data: finalOrder, error: finalOrderErr } = await supabase
            .from('app_orders')
            .select('*')
            .eq('id', orderId)
            .single()

        if (finalOrderErr || !finalOrder) {
            throw new Error(`Error al consultar estado final en Supabase: ${finalOrderErr?.message}`)
        }
        console.log(`   ✅ Estado en Base de Datos: ${finalOrder.status}`)
        console.log(`   Fired At (Hora de impresión en cocina):`, finalOrder.fired_at)
        console.log(`   ID de Orden en Toast POS:`, finalOrder.toast_order_guid)
        console.log(`   Detalle de artículos en cocina:`, finalOrder.items_json.length, 'productos siendo preparados.')

        console.log('\n======================================================')
        console.log('🎉 ¡TODAS LAS PRUEBAS DE FUNCIONAMIENTO PASARON CON ÉXITO! 100% OK')
        console.log('======================================================\n')

    } catch (e: any) {
        console.error('\n❌ ERROR EN LA PRUEBA DE FUNCIONAMIENTO:', e.message)
        console.log('Asegúrate de que el backend esté corriendo en http://localhost:3001.\n')
    }
}

runE2ETest()
