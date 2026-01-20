
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function testEmail() {
    console.log('--- Iniciando Prueba de Correo ---');
    console.log('SMTP Configurado para usuario:', process.env.SMTP_EMAIL);

    if (!process.env.SMTP_EMAIL || !process.env.SMTP_PASSWORD) {
        console.error('❌ ERROR: Faltan credenciales SMTP_EMAIL o SMTP_PASSWORD en .env.local');
        return;
    }

    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.SMTP_EMAIL,
            pass: process.env.SMTP_PASSWORD
        }
    });

    try {
        console.log('Intentando verificar conexión SMTP...');
        await transporter.verify();
        console.log('✅ Conexión SMTP Exitosa (Login correcto)');

        console.log('Enviando correo de prueba a:', process.env.SMTP_EMAIL);
        const info = await transporter.sendMail({
            from: `"Prueba TEG" <${process.env.SMTP_EMAIL}>`,
            to: process.env.SMTP_EMAIL, // Send to self
            subject: '🔔 Prueba de Configuración de Correo TEG',
            text: 'Si estás leyendo esto, la configuración de correo NO-REPLY funciona correctamente.',
            html: `
                <div style="font-family: sans-serif; padding: 20px; border: 1px solid #ddd; border-radius: 8px;">
                    <h2 style="color: #4f46e5;">Configuración Exitosa</h2>
                    <p>El sistema de notificaciones está listo para enviar correos.</p>
                    <p><strong>Cuenta:</strong> ${process.env.SMTP_EMAIL}</p>
                    <p><strong>Fecha:</strong> ${new Date().toLocaleString()}</p>
                </div>
            `
        });

        console.log('✅ Correo enviado correctamente!');
        console.log('Message ID:', info.messageId);

    } catch (error: any) {
        console.error('❌ FALLÓ EL ENVÍO:');
        console.error(error.message);

        if (error.code === 'EAUTH') {
            console.log('\n--- DIAGNÓSTICO ---');
            console.log('El error es de AUTENTICACIÓN. Causas probables:');
            console.log('1. La contraseña es incorrecta.');
            console.log('2. La cuenta tiene 2-Pasos activado y necesitas una "App Password".');
            console.log('3. Google bloqueó el acceso por seguridad ("Less Secure Apps").');
        }
    }
}

testEmail();
