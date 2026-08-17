/**
 * Enviar Tech Packs & RFQ Bidding Volumes 2025 por correo
 * De: carlos@tacosgavilan.com
 * Para: gonzalo@tacosgavilan.com, roberto@tacosgavilan.com
 * Adjuntos: 16 PDFs (4 productos × 2 tipos × 2 idiomas)
 * Usa la misma técnica del Planificador: nodemailer stream → Gmail API
 */
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function getGmailToken(userId) {
    const { data: user } = await supabase.from('users')
        .select('google_refresh_token, google_email_connected')
        .eq('id', userId).single();

    if (!user?.google_refresh_token) throw new Error('No Gmail token found for user ' + userId);

    const params = new URLSearchParams();
    params.append('client_id', process.env.GOOGLE_CLIENT_ID);
    params.append('client_secret', process.env.GOOGLE_CLIENT_SECRET);
    params.append('refresh_token', user.google_refresh_token);
    params.append('grant_type', 'refresh_token');

    const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params
    });
    if (!res.ok) throw new Error('Token refresh failed: ' + await res.text());
    const tokens = await res.json();
    return { accessToken: tokens.access_token, fromEmail: user.google_email_connected };
}

(async () => {
    try {
        console.log('🔑 Obteniendo credenciales Gmail de Carlos...');
        const { accessToken, fromEmail } = await getGmailToken(25);
        console.log(`✅ Gmail auth OK: ${fromEmail}`);

        const baseDir = 'c:\\Users\\pedro\\Desktop\\teg-modernizado';
        const pdfFiles = [
            'Tacos_Gavilan_Beef_Tech_Pack_2025.pdf',
            'Tacos_Gavilan_Beef_Tech_Pack_2025_EN.pdf',
            'Tacos_Gavilan_RFQ_Bidding_Volume_BEEF_2025.pdf',
            'Tacos_Gavilan_RFQ_Bidding_Volume_BEEF_2025_EN.pdf',
            'Tacos_Gavilan_Pork_Tech_Pack_2025.pdf',
            'Tacos_Gavilan_Pork_Tech_Pack_2025_EN.pdf',
            'Tacos_Gavilan_RFQ_Bidding_Volume_PORK_2025.pdf',
            'Tacos_Gavilan_RFQ_Bidding_Volume_PORK_2025_EN.pdf',
            'Tacos_Gavilan_Cilantro_Cebolla_Tech_Pack_2025.pdf',
            'Tacos_Gavilan_Cilantro_Cebolla_Tech_Pack_2025_EN.pdf',
            'Tacos_Gavilan_RFQ_Bidding_Volume_CILANTRO_CEBOLLA_2025.pdf',
            'Tacos_Gavilan_RFQ_Bidding_Volume_CILANTRO_CEBOLLA_2025_EN.pdf',
            'Tacos_Gavilan_Milk_Tech_Pack_2025.pdf',
            'Tacos_Gavilan_Milk_Tech_Pack_2025_EN.pdf',
            'Tacos_Gavilan_RFQ_Bidding_Volume_MILK_2025.pdf',
            'Tacos_Gavilan_RFQ_Bidding_Volume_MILK_2025_EN.pdf',
        ];

        const attachments = [];
        for (const fileName of pdfFiles) {
            const filePath = path.join(baseDir, fileName);
            if (!fs.existsSync(filePath)) {
                console.log(`⚠️ Archivo no encontrado: ${fileName}`);
                continue;
            }
            const stats = fs.statSync(filePath);
            console.log(`📎 Adjuntando: ${fileName} (${(stats.size / 1024).toFixed(0)} KB)`);
            attachments.push({
                filename: fileName,
                path: filePath,
                contentType: 'application/pdf'
            });
        }

        console.log(`\n📎 Total archivos adjuntos: ${attachments.length} PDFs`);

        const htmlContent = `<!DOCTYPE html>
<html>
<head>
<style>
    body { font-family: 'Segoe UI', Arial, sans-serif; margin: 0; padding: 0; background: #f5f5f5; }
    .container { max-width: 720px; margin: 20px auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 12px rgba(0,0,0,0.08); }
    .header { background: linear-gradient(135deg, #d32f2f 0%, #b71c1c 100%); color: white; padding: 28px 32px; }
    .header h1 { margin: 0; font-size: 21px; }
    .header p { margin: 8px 0 0; opacity: 0.9; font-size: 14px; }
    .content { padding: 28px 32px; color: #1f2937; font-size: 14px; line-height: 1.7; }
    .section-title { font-size: 16px; font-weight: 700; margin: 24px 0 10px; padding-bottom: 6px; border-bottom: 2px solid #d32f2f; color: #111827; }
    .product-block { background: #fafafa; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px 20px; margin: 12px 0; }
    .product-block h3 { margin: 0 0 8px; font-size: 15px; color: #b91c1c; }
    .product-block ul { margin: 6px 0; padding-left: 20px; }
    .product-block li { margin: 3px 0; font-size: 13px; color: #374151; }
    .doc-type { background: #e3f2fd; border-radius: 8px; padding: 14px 18px; margin: 12px 0; border-left: 4px solid #1565c0; }
    .doc-type h4 { margin: 0 0 6px; color: #1565c0; font-size: 14px; }
    .doc-type p { margin: 0; font-size: 13px; color: #1f2937; }
    .doc-type-rfq { background: #e8f5e9; border-left-color: #2e7d32; }
    .doc-type-rfq h4 { color: #2e7d32; }
    .footer { background: #fafafa; padding: 16px 32px; text-align: center; font-size: 11px; color: #9ca3af; border-top: 1px solid #eee; }
</style>
</head>
<body>
<div class="container">
    <div class="header">
        <h1>Tech Packs & RFQ Bidding Volumes 2025</h1>
        <p>Documentos de Auditoria de Compras y Especificaciones de Licitacion — Tacos Gavilan</p>
    </div>
    <div class="content">
        <p>Gonzalo, Roberto,</p>
        <p>Les comparto los documentos de auditoria y especificaciones tecnicas de los <strong>4 insumos principales del 2025</strong>. Para cada producto se generaron <strong>dos tipos de documentos</strong>, ambos disponibles en <strong>Espanol e Ingles</strong>:</p>

        <div class="doc-type">
            <h4>1. Tech Pack (Catalogo Tecnico y Auditoria de Compras)</h4>
            <p>Documento <strong>interno</strong> con el desglose completo: cantidades, precios unitarios por periodo, gasto total, historial de facturas, proveedores, y especificaciones tecnicas de calidad.</p>
        </div>

        <div class="doc-type doc-type-rfq">
            <h4>2. RFQ Bidding Volume (Especificacion de Volumen para Licitacion)</h4>
            <p>Documento disenado para entregar a <strong>proveedores externos</strong>. Contiene <strong>unicamente las cantidades que consumimos</strong> (volumen anual, promedio mensual, frecuencia de entrega) y las especificaciones tecnicas del producto. <strong>No muestra ningun precio ni gasto historico</strong>, para que los proveedores coticen sin conocer nuestros costos actuales.</p>
        </div>

        <div class="section-title">BEEF / CARNE ASADA (1,571,363 Lbs)</div>
        <div class="product-block">
            <h3>Beef Chuck Roll Deshuesado 2x2 (Monarch Trading / Quirch Foods)</h3>
            <ul>
                <li>Tech Pack ES: Tacos_Gavilan_Beef_Tech_Pack_2025.pdf</li>
                <li>Tech Pack EN: Tacos_Gavilan_Beef_Tech_Pack_2025_EN.pdf</li>
                <li>RFQ Volume ES: Tacos_Gavilan_RFQ_Bidding_Volume_BEEF_2025.pdf</li>
                <li>RFQ Volume EN: Tacos_Gavilan_RFQ_Bidding_Volume_BEEF_2025_EN.pdf</li>
            </ul>
        </div>

        <div class="section-title">PORK / CARNE DE CERDO (428,120 Lbs)</div>
        <div class="product-block">
            <h3>Boneless Pork Butt / Boston Butt (Del Mar Meats Inc.)</h3>
            <ul>
                <li>Tech Pack ES: Tacos_Gavilan_Pork_Tech_Pack_2025.pdf</li>
                <li>Tech Pack EN: Tacos_Gavilan_Pork_Tech_Pack_2025_EN.pdf</li>
                <li>RFQ Volume ES: Tacos_Gavilan_RFQ_Bidding_Volume_PORK_2025.pdf</li>
                <li>RFQ Volume EN: Tacos_Gavilan_RFQ_Bidding_Volume_PORK_2025_EN.pdf</li>
            </ul>
        </div>

        <div class="section-title">CILANTRO Y CEBOLLA MIX (59,607 Bolsas 5 Lbs)</div>
        <div class="product-block">
            <h3>Mix Cebolla Blanca y Cilantro Picado 1/4" (Julia's Produce)</h3>
            <ul>
                <li>Tech Pack ES: Tacos_Gavilan_Cilantro_Cebolla_Tech_Pack_2025.pdf</li>
                <li>Tech Pack EN: Tacos_Gavilan_Cilantro_Cebolla_Tech_Pack_2025_EN.pdf</li>
                <li>RFQ Volume ES: Tacos_Gavilan_RFQ_Bidding_Volume_CILANTRO_CEBOLLA_2025.pdf</li>
                <li>RFQ Volume EN: Tacos_Gavilan_RFQ_Bidding_Volume_CILANTRO_CEBOLLA_2025_EN.pdf</li>
            </ul>
        </div>

        <div class="section-title">MILK / LECHE ENTERA (85,187 Galones)</div>
        <div class="product-block">
            <h3>Grade A Whole Milk 1 Gallon (Rockview Family Farms)</h3>
            <ul>
                <li>Tech Pack ES: Tacos_Gavilan_Milk_Tech_Pack_2025.pdf</li>
                <li>Tech Pack EN: Tacos_Gavilan_Milk_Tech_Pack_2025_EN.pdf</li>
                <li>RFQ Volume ES: Tacos_Gavilan_RFQ_Bidding_Volume_MILK_2025.pdf</li>
                <li>RFQ Volume EN: Tacos_Gavilan_RFQ_Bidding_Volume_MILK_2025_EN.pdf</li>
            </ul>
        </div>

        <p style="margin-top: 20px;">Los <strong>Tech Packs</strong> son para uso interno y referencia de negociacion. Los <strong>RFQ Volumes</strong> son los que se entregan a proveedores nuevos para que coticen.</p>
        <p>Cualquier duda me avisan.</p>
        <p>Saludos,<br><strong>Carlos</strong></p>
    </div>
    <div class="footer">
        <p>Generado por TEG Modernizado — Tacos Gavilan Corporate Purchasing<br>
        Auditoria basada en facturas QuickBooks verificadas | Enero a Diciembre 2025</p>
    </div>
</div>
</body>
</html>`;

        // Build raw email with nodemailer
        const compiler = nodemailer.createTransport({ streamTransport: true, newline: 'windows' });
        const info = await compiler.sendMail({
            from: `"Carlos - Tacos Gavilan" <${fromEmail}>`,
            to: 'gonzalo@tacosgavilan.com, roberto@tacosgavilan.com',
            subject: 'Tech Packs & RFQ Bidding Volumes 2025 — Beef, Pork, Cilantro/Cebolla, Milk (ES & EN)',
            html: htmlContent,
            attachments: attachments,
        });

        const rawBuffer = await new Promise((resolve, reject) => {
            const message = info.message;
            if (Buffer.isBuffer(message)) return resolve(message);
            if (typeof message.pipe === 'function') {
                const chunks = [];
                message.on('data', c => chunks.push(c));
                message.on('end', () => resolve(Buffer.concat(chunks)));
                message.on('error', reject);
                return;
            }
            reject(new Error('Unknown message format'));
        });

        const raw = rawBuffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

        console.log(`\n📧 Tamaño total del correo: ${(rawBuffer.length / 1024 / 1024).toFixed(2)} MB`);

        // Send via Gmail API
        console.log('📤 Enviando correo via Gmail API...');

        const sendRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ raw })
        });

        if (!sendRes.ok) {
            const errText = await sendRes.text();
            console.log('❌ Gmail API Error:', errText);
            return;
        }

        const result = await sendRes.json();
        console.log('\n✅ ¡Correo enviado exitosamente!');
        console.log('Message ID:', result.id);
        console.log('From:', fromEmail);
        console.log('To: gonzalo@tacosgavilan.com, roberto@tacosgavilan.com');
        console.log(`Adjuntos: ${attachments.length} PDFs`);
    } catch (err) {
        console.error('❌ Error:', err.message);
        process.exit(1);
    }
})();
