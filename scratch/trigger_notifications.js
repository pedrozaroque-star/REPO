async function run() {
    const payload = {
        store_id: '9625621e-1b5e-48d7-87ae-7094fab5a4fd',
        start_date: '2026-04-13',
        end_date: '2026-04-19', // SEMANA COMPLETA
        sender_user_id: 39
    };

    console.log('🚀 DISPARANDO NOTIFICACIONES SEMANALES PARA SLAUSON...');
    console.log('Manager:', 'Jesús Ramos (39)');
    console.log('Fechas:', '2026-04-13 al 2026-04-19');
    console.log('Tienda:', '9625621e... (Slauson)');

    try {
        const response = await fetch('http://localhost:3000/api/notifications/publish-schedule', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const result = await response.json();
        console.log('\n✅ RESULTADO:', JSON.stringify(result, null, 2));
    } catch (error) {
        console.error('\n❌ ERROR AL LLAMAR A LA API:', error.message);
    }
}

run();
