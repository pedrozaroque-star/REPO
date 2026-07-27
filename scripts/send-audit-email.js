/**
 * Enviar Auditoría de Templates QB por correo a carlos@tacosgavilan.com
 * Usa la misma técnica del Planificador: nodemailer stream → Gmail API
 */
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const nodemailer = require('nodemailer');

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function getGmailToken(userId) {
    const { data: user } = await supabase.from('users')
        .select('google_refresh_token, google_email_connected')
        .eq('id', userId).single();

    if (!user?.google_refresh_token) throw new Error('No Gmail token');

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
    // 1. Get Gmail credentials (Carlos, user 25)
    console.log('🔑 Obteniendo credenciales Gmail...');
    const { accessToken, fromEmail } = await getGmailToken(25);
    console.log(`✅ Gmail auth OK: ${fromEmail}`);

    // 2. Build HTML email
    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
<style>
    body { font-family: 'Segoe UI', Arial, sans-serif; margin: 0; padding: 0; background: #f5f5f5; }
    .container { max-width: 700px; margin: 20px auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 12px rgba(0,0,0,0.08); }
    .header { background: linear-gradient(135deg, #d32f2f 0%, #b71c1c 100%); color: white; padding: 28px 32px; }
    .header h1 { margin: 0; font-size: 22px; }
    .header p { margin: 8px 0 0; opacity: 0.9; font-size: 14px; }
    .content { padding: 28px 32px; }
    .summary-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 16px 0 24px; }
    .metric-card { background: #fafafa; border: 1px solid #eee; border-radius: 8px; padding: 16px; text-align: center; }
    .metric-value { font-size: 28px; font-weight: 700; color: #d32f2f; }
    .metric-label { font-size: 12px; color: #666; margin-top: 4px; }
    table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 13px; }
    th { background: #f8f8f8; padding: 10px 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #e0e0e0; }
    td { padding: 8px 12px; border-bottom: 1px solid #f0f0f0; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600; }
    .badge-ok { background: #e8f5e9; color: #2e7d32; }
    .badge-warn { background: #fff3e0; color: #e65100; }
    .badge-danger { background: #ffebee; color: #c62828; }
    .section-title { font-size: 16px; font-weight: 700; margin: 24px 0 12px; padding-bottom: 8px; border-bottom: 2px solid #d32f2f; }
    .diff-item { background: #fffde7; border-left: 4px solid #ffc107; padding: 12px 16px; margin: 10px 0; border-radius: 0 8px 8px 0; }
    .diff-item h4 { margin: 0 0 6px; color: #333; }
    .diff-present { color: #2e7d32; font-size: 12px; }
    .diff-missing { color: #c62828; font-size: 12px; font-weight: 600; }
    .footer { background: #fafafa; padding: 20px 32px; text-align: center; font-size: 11px; color: #999; border-top: 1px solid #eee; }
    .reco { background: #e3f2fd; border-radius: 8px; padding: 16px; margin: 10px 0; }
    .reco-title { font-weight: 700; color: #1565c0; margin-bottom: 6px; }
    .critical { background: #ffebee; border-left: 4px solid #c62828; }
</style>
</head>
<body>
<div class="container">
    <div class="header">
        <h1>📋 Auditoría de Templates QB — 15 Tiendas</h1>
        <p>Informe automático del sistema TEG Modernizado • ${new Date().toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
    </div>
    <div class="content">
        <div class="summary-grid">
            <div class="metric-card">
                <div class="metric-value">15</div>
                <div class="metric-label">Tiendas Auditadas</div>
            </div>
            <div class="metric-card">
                <div class="metric-value">58</div>
                <div class="metric-label">Items Únicos Totales</div>
            </div>
            <div class="metric-card">
                <div class="metric-value" style="color: #2e7d32;">46</div>
                <div class="metric-label">Items Universales ✅</div>
            </div>
            <div class="metric-card">
                <div class="metric-value" style="color: #e65100;">12</div>
                <div class="metric-label">Diferencias ⚠️</div>
            </div>
        </div>

        <div class="section-title">📊 Conteo por Tienda</div>
        <table>
            <thead>
                <tr><th>Tienda</th><th>Items</th><th>vs Max</th><th>Estado</th></tr>
            </thead>
            <tbody>
                <tr><td>La Puente</td><td>52</td><td>—</td><td><span class="badge badge-ok">✅ Completa</span></td></tr>
                <tr><td>Azusa</td><td>51</td><td>-1</td><td><span class="badge badge-warn">🟡</span></td></tr>
                <tr><td>LA Broadway</td><td>51</td><td>-1</td><td><span class="badge badge-warn">🟡</span></td></tr>
                <tr><td>Santa Ana</td><td>51</td><td>-1</td><td><span class="badge badge-warn">🟡</span></td></tr>
                <tr><td>Bell</td><td>50</td><td>-2</td><td><span class="badge badge-warn">🟡</span></td></tr>
                <tr><td>Norwalk</td><td>50</td><td>-2</td><td><span class="badge badge-warn">🟡</span></td></tr>
                <tr><td>Rialto</td><td>50</td><td>-2</td><td><span class="badge badge-warn">🟡</span></td></tr>
                <tr><td>West Covina</td><td>50</td><td>-2</td><td><span class="badge badge-warn">🟡</span></td></tr>
                <tr><td>Downey</td><td>49</td><td>-3</td><td><span class="badge badge-danger">🔴</span></td></tr>
                <tr><td>Hollywood</td><td>49</td><td>-3</td><td><span class="badge badge-danger">🔴</span></td></tr>
                <tr><td>LA Central</td><td>49</td><td>-3</td><td><span class="badge badge-danger">🔴</span></td></tr>
                <tr><td>Slauson</td><td>49</td><td>-3</td><td><span class="badge badge-danger">🔴</span></td></tr>
                <tr><td>South Gate</td><td>49</td><td>-3</td><td><span class="badge badge-danger">🔴</span></td></tr>
                <tr><td>Huntington Park</td><td>48</td><td>-4</td><td><span class="badge badge-danger">🔴</span></td></tr>
                <tr><td>Lynwood</td><td>48</td><td>-4</td><td><span class="badge badge-danger">🔴</span></td></tr>
            </tbody>
        </table>

        <div class="section-title">⚠️ 12 Diferencias Encontradas</div>

        <div class="diff-item critical">
            <h4>🔴 Slauson — Template con presentaciones diferentes</h4>
            <p style="margin: 4px 0; font-size: 13px;">
                Slauson usa <strong>Pastor 3 lbs</strong> y <strong>Pollo 3 lbs</strong> en vez del formato estándar. 
                También tiene <strong>1.5 oz Salsa Roja Taquera pack</strong> (descontinuada en las demás).
            </p>
            <p class="diff-missing">→ Le falta: Pastor (estándar), Pollo (estándar)</p>
        </div>

        <div class="diff-item">
            <h4>⚠️ Viva Lard (Manteca)</h4>
            <p class="diff-present">✅ Presente en 11 tiendas</p>
            <p class="diff-missing">❌ FALTA en: Huntington Park, Lynwood, Slauson, South Gate</p>
        </div>

        <div class="diff-item">
            <h4>⚠️ Agua Gavilan</h4>
            <p class="diff-present">✅ Presente en 6 tiendas: Azusa, Bell, La Puente, Norwalk, Rialto, South Gate</p>
            <p class="diff-missing">❌ FALTA en 9 tiendas: Downey, Hollywood, HP, Broadway, Central, Lynwood, Santa Ana, Slauson, West Covina</p>
        </div>

        <div class="diff-item">
            <h4>⚠️ Cover Para Taco</h4>
            <p class="diff-present">✅ Solo en: Azusa, La Puente</p>
            <p class="diff-missing">❌ FALTA en las otras 13 tiendas</p>
        </div>

        <div class="diff-item">
            <h4>⚠️ Gavilan Catering Box</h4>
            <p class="diff-present">✅ Solo en: La Puente, Santa Ana, West Covina</p>
            <p class="diff-missing">❌ FALTA en las otras 12 tiendas</p>
        </div>

        <div class="diff-item">
            <h4>⚠️ Items exclusivos de una tienda</h4>
            <p style="font-size: 13px;">
                • <strong>Lechuga (103 Lettuce Shredded)</strong> — Solo en LA Broadway<br>
                • <strong>Tomate Entero</strong> — Solo en LA Broadway<br>
                • <strong>Galones Vacíos</strong> — Solo en Santa Ana
            </p>
        </div>

        <div class="section-title">🎯 Recomendaciones</div>
        
        <div class="reco critical">
            <div class="reco-title">1. URGENTE — Normalizar Slauson</div>
            <p style="font-size: 13px; margin: 0;">Cambiar Pastor 3 lbs → Pastor y Pollo 3 lbs → Pollo. Quitar Salsa Roja Taquera (descontinuada).</p>
        </div>
        
        <div class="reco">
            <div class="reco-title">2. Agregar Manteca a 4 tiendas</div>
            <p style="font-size: 13px; margin: 0;">Huntington Park, Lynwood, Slauson y South Gate no tienen Viva Lard en su template.</p>
        </div>
        
        <div class="reco">
            <div class="reco-title">3. Decidir sobre Agua Gavilan</div>
            <p style="font-size: 13px; margin: 0;">¿Todas las tiendas lo venden? Si sí → agregar a las 9 faltantes. Si no → dejar como está.</p>
        </div>

        <div class="reco">
            <div class="reco-title">4. Revisar exclusivos de Broadway y Santa Ana</div>
            <p style="font-size: 13px; margin: 0;">Confirmar si Lechuga, Tomate Entero (Broadway) y Galones Vacíos (Santa Ana) son intencionales.</p>
        </div>
    </div>
    <div class="footer">
        <p>📧 Generado automáticamente por TEG Modernizado<br>
        Auditoría basada en el Estimate más reciente de cada tienda en QuickBooks</p>
    </div>
</div>
</body>
</html>`;

    // 3. Build raw email with nodemailer
    const compiler = nodemailer.createTransport({ streamTransport: true, newline: 'windows' });
    const info = await compiler.sendMail({
        from: `"${fromEmail}" <${fromEmail}>`,
        to: 'carlos@tacosgavilan.com',
        subject: '📋 Auditoría Templates QB — 12 Diferencias en 15 Tiendas',
        html: htmlContent,
    });

    const rawBuffer = await new Promise((resolve, reject) => {
        const message = info.message;
        if (Buffer.isBuffer(message)) return resolve(message);
        if (typeof message.pipe === 'function') {
            const chunks = [];
            message.on('data', c => chunks.push(c));
            message.on('end', () => resolve(Buffer.concat(chunks)));
            return;
        }
        reject(new Error('Unknown format'));
    });

    const raw = rawBuffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    // 4. Send via Gmail API
    console.log('📤 Enviando correo...');
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
    console.log('✅ ¡Correo enviado exitosamente!');
    console.log('Message ID:', result.id);
    console.log('To: carlos@tacosgavilan.com');
})();
