
import nodemailer from 'nodemailer'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

async function sendRealSMSTest() {
    const PHONE = '4243195019';
    console.log(`📱 Iniciando prueba REAL de SMS para el número: ${PHONE}`);

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
        `${PHONE}@txt.att.net`,       // AT&T
        `${PHONE}@tmomail.net`,       // T-Mobile
        `${PHONE}@vtext.com`,         // Verizon
        `${PHONE}@messaging.sprintpcs.com` // Sprint
    ];

    console.log(`📧 Enviando desde: ${process.env.SMTP_EMAIL}`);
    console.log(`📨 Destinos (Gateways):`);
    gateways.forEach(g => console.log(`   - ${g}`));

    try {
        await Promise.all(gateways.map(gateway =>
            transporter.sendMail({
                from: `"Sistema TEG" <${process.env.SMTP_EMAIL}>`,
                to: gateway,
                text: "TEG Alerta: Esta es una prueba real del sistema de horarios. Si recibes esto, la configuracion funciona."
            })
        ));
        console.log('\n✅ ¡Envío completado! Revisa tu celular en los próximos 10-30 segundos.');
        console.log('Nota: Solo recibirás 1 mensaje (del gateway de tu compañía), los otros 3 fallarán silenciosamente.');

    } catch (error: any) {
        console.error('❌ Error enviando:', error.message);
    }
}

sendRealSMSTest();
