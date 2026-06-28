import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Load env variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function main() {
  console.log('--- Preparando el envío del correo de Peacock TV ---');
  
  const smtpEmail = process.env.SMTP_EMAIL;
  const smtpPassword = process.env.SMTP_PASSWORD;

  if (!smtpEmail || !smtpPassword) {
    console.error('❌ Error: Falta SMTP_EMAIL o SMTP_PASSWORD en .env.local');
    process.exit(1);
  }

  // Load the HTML content (Now email-mundial-peacock.html)
  const htmlPath = path.resolve(process.cwd(), 'email-mundial-peacock.html');
  if (!fs.existsSync(htmlPath)) {
    console.error(`❌ Error: No se encontró el archivo HTML en: ${htmlPath}`);
    process.exit(1);
  }
  const htmlContent = fs.readFileSync(htmlPath, 'utf8');

  // Configure transporter
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: smtpEmail,
      pass: smtpPassword
    }
  });

  // Verify connection
  try {
    await transporter.verify();
    console.log('✅ Conexión SMTP verificada con éxito.');
  } catch (err: any) {
    console.error('❌ Falló la conexión SMTP:', err.message);
    process.exit(1);
  }

  // Recipients
  const toList = [
    'javier@tacosgavilan.com',
    'ricardo@tacosgavilan.com',
    'willian@tacosgavilan.com',
    'estefani@tacosgavilan.com'
  ];

  const ccList = [
    'raquel@tacosgavilan.com',
    'gonzalo@tacosgavilan.com',
    'carlos@tacosgavilan.com'
  ];

  const mailOptions = {
    from: `"Carlos Velazquez" <${smtpEmail}>`,
    to: toList.join(', '),
    cc: ccList.join(', '),
    subject: '⚽ Peacock TV Mundial de Fútbol - Cuentas para Sucursales',
    html: htmlContent
  };

  console.log('Enviando correo...');
  console.log(`Para: ${mailOptions.to}`);
  console.log(`CC: ${mailOptions.cc}`);

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('✅ Correo enviado con éxito!');
    console.log('ID del mensaje:', info.messageId);
  } catch (err: any) {
    console.error('❌ Error al enviar el correo:', err.message);
    process.exit(1);
  }
}

main();
