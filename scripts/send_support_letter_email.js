const nodemailer = require('nodemailer');
const path = require('path');
const fs = require('fs');

async function main() {
  const smtpUser = process.env.SMTP_EMAIL || 'carlos@tacosgavilan.com';
  const smtpPass = (process.env.SMTP_PASSWORD || '').replace(/\s+/g, ''); // strip any spaces in app password

  if (!smtpPass) {
    console.error('[ERROR] SMTP_PASSWORD not found in environment.');
    process.exit(1);
  }

  const docPath = path.join(process.cwd(), 'docs', 'Letter_of_Support_Lilia_Judith_Campos_Martinez.docx');
  if (!fs.existsSync(docPath)) {
    console.error('[ERROR] Word file not found at:', docPath);
    process.exit(1);
  }

  const recipients = ['carlos@tacosgavilan.com', 'pedrozaroque@gmail.com'];
  console.log(`[EMAIL] Preparing to send letter to: ${recipients.join(', ')}`);

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: smtpUser.trim(),
      pass: smtpPass.trim()
    }
  });

  const mailOptions = {
    from: `"Roberto Carlos Pedroza" <${smtpUser.trim()}>`,
    to: recipients.join(', '),
    subject: '📄 Carta de Apoyo en Word — Lilia Judith Campos Martinez (Immigration Matter)',
    text: `Hola Carlos,

Adjunto te comparto el archivo en formato Microsoft Word (.docx) con la Carta de Apoyo para Lilia Judith Campos Martinez (asunto de inmigración).

El documento cuenta con el formato estándar legal/USCIS:
- Márgenes de 1 pulgada (1 inch)
- Tipografía Times New Roman 12pt con espaciado de 1.15
- Párrafos estructurados y bloque formal de firma

Recuerda revisar los campos entre corchetes antes de imprimir o enviar:
- [Your Full Name] / [Your Full Legal Name]
- Teléfono, correo y dirección en el bloque inferior de firma.

Saludos,
Tu Asistente Antigravity / SM TEG`,
    html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #1e293b; margin: 0; padding: 24px; }
    .container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); }
    .header { background: #0f172a; color: #ffffff; padding: 24px 28px; }
    .header h2 { margin: 0 0 6px 0; font-size: 20px; font-weight: 700; }
    .header p { margin: 0; font-size: 13px; color: #94a3b8; }
    .content { padding: 28px; line-height: 1.6; font-size: 14px; }
    .badge { display: inline-block; background: #e0f2fe; color: #0369a1; padding: 4px 10px; border-radius: 6px; font-weight: 600; font-size: 12px; margin-bottom: 16px; }
    .box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 16px 0; }
    .box ul { margin: 8px 0 0 0; padding-left: 20px; }
    .box li { margin-bottom: 4px; font-size: 13px; color: #475569; }
    .footer { background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 16px 28px; text-align: center; font-size: 12px; color: #64748b; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2>📄 Carta de Apoyo Generada</h2>
      <p>Lilia Judith Campos Martinez · Asunto de Inmigración</p>
    </div>
    <div class="content">
      <span class="badge">Documento Word (.docx) Listo</span>
      <p>Hola Carlos,</p>
      <p>Te he generado el archivo formal en formato <strong>Microsoft Word (.docx)</strong> con la carta completa en inglés tal como me lo solicitaste.</p>
      
      <div class="box">
        <strong>📋 Características del formato legal incluido:</strong>
        <ul>
          <li>Márgenes estándar de 1 pulgada (1 inch) para trámites oficiales / USCIS.</li>
          <li>Tipografía oficial <strong>Times New Roman (12 pt)</strong> con espaciado de 1.15 líneas.</li>
          <li>Estructura formal con fecha, encabezado <em>To Whom It May Concern</em> y asunto de referencia <em>RE</em>.</li>
          <li>Bloque final de firma con líneas para firma autógrafa, fecha, teléfono, correo y dirección.</li>
        </ul>
      </div>

      <p style="font-size: 13px; color: #64748b;">
        📎 <strong>Archivo adjunto:</strong> <code>Letter_of_Support_Lilia_Judith_Campos_Martinez.docx</code>
      </p>
    </div>
    <div class="footer">
      Documento generado y enviado automáticamente para Carlos Pedroza.
    </div>
  </div>
</body>
</html>
    `,
    attachments: [
      {
        filename: 'Letter_of_Support_Lilia_Judith_Campos_Martinez.docx',
        path: docPath,
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      }
    ]
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(`[SUCCESS] Email sent successfully! MessageId: ${info.messageId}`);
    console.log(`[SUCCESS] Delivered to: ${recipients.join(', ')}`);
  } catch (err) {
    console.error('[ERROR] Failed to send email:', err);
    process.exit(1);
  }
}

main();
