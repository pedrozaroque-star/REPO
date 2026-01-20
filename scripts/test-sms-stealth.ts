
import nodemailer from 'nodemailer'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

async function sendStealthSMSTest() {
    const PHONE = '4243195019'; // Tu número
    console.log(`🥷 Iniciando prueba 'SIGILO' de SMS para: ${PHONE}`);

    if (!process.env.SMTP_EMAIL || !process.env.SMTP_PASSWORD) {
        console.error('❌ Faltan credenciales SMTP');
        return;
    }

    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.SMTP_EMAIL,
            pass: process.env.SMTP_PASSWORD
        }
    });

    const gateways = [
        `${PHONE}@txt.att.net`,
        `${PHONE}@tmomail.net`,
        `${PHONE}@vtext.com`,
        `${PHONE}@messaging.sprintpcs.com`
    ];

    console.log(`📨 Enviando mensaje 'Humanizado' a ${gateways.length} gateways...`);

    // Mensaje con contenido aleatorio para parecer único
    const uniqueRef = Date.now().toString().slice(-4);
    const body = `Prueba Stealth v2.\nSi recibes esto, el filtro fue evadido.\n\nRef: ${uniqueRef}`;

    try {
        await Promise.all(gateways.map(async (gateway) => {
            console.log(`   -> Intentando ${gateway}...`);
            await transporter.sendMail({
                from: `"TEG Sistemas" <${process.env.SMTP_EMAIL}>`, // Nombre real
                to: gateway,
                subject: 'TEG Aviso', // ASUNTO REAL (Importante para Verizon)
                text: body
            });
        }));

        console.log('\n✅ Correos enviados. Espera 20 segundos.');
        console.log('Si no recibes nada o recibes un "Failure" de nuevo, entonces el bloqueo es a nivel de Cuenta de Google.');

    } catch (error: any) {
        console.error('❌ Error enviando:', error.message);
    }
}

sendStealthSMSTest();
