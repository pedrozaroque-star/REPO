import dotenv from 'dotenv';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';
import fs from 'fs';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Fallback: Obtain Gmail API access using Carlos's master account.
 */
async function getSystemTransporter() {
    // We use Carlos's token as the system fallback for this script
    const { data: user, error } = await supabase.from('users')
        .select('google_refresh_token, google_email_connected')
        .eq('email', 'carlos@tacosgavilan.com')
        .single();

    if (error || !user?.google_refresh_token) {
        throw new Error('No se encontro a Carlos en la BD o no tiene token configurado para fallback.');
    }

    console.log(`✅ [AUTH] Usando la cuenta de respaldo de sistema: ${user.google_email_connected}`);

    const tokenUrl = 'https://oauth2.googleapis.com/token';
    const params = new URLSearchParams();
    params.append('client_id', process.env.GOOGLE_CLIENT_ID!);
    params.append('client_secret', process.env.GOOGLE_CLIENT_SECRET!);
    params.append('refresh_token', user.google_refresh_token);
    params.append('grant_type', 'refresh_token');

    const refreshRes = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params
    });

    if (!refreshRes.ok) throw new Error('Falló la actualización del token para la cuenta de respaldo.');

    const tokens = await refreshRes.json();
    return { accessToken: tokens.access_token, fromEmail: user.google_email_connected };
}

async function main() {
    try {
        console.log('\n=============================================');
        console.log('🚀 REENVÍO DE HORARIOS - TIENDA BELL');
        console.log('=============================================\n');

        // 1. Get Bell Store
        const { data: storeData } = await supabase.from('stores')
            .select('id, name, external_id')
            .ilike('name', '%Bell%')
            .single();

        if (!storeData) throw new Error('No se encontró la tienda Bell en la base de datos.');
        const storeId = storeData.external_id;
        const storeName = storeData.name;
        console.log(`📍 Tienda localizada: ${storeName} (${storeId})`);

        // Rango de la semana actual (Lunes 16 Mar a Domingo 22 Mar)
        const startDate = '2026-03-16';
        const endDate = '2026-03-22';
        
        console.log(`📅 Buscando turnos publicados entre ${startDate} y ${endDate}...`);

        // 2. Obtain shifts
        const { data: shifts, error: shiftError } = await supabase
            .from('shifts')
            .select('*')
            .eq('store_id', storeId)
            .eq('status', 'published')
            .gte('shift_date', startDate)
            .lte('shift_date', endDate);

        if (shiftError || !shifts || shifts.length === 0) {
            console.log('⚠️ No hay turnos publicados para Bell en ese rango de fechas.');
            return;
        }

        console.log(`✅ ¡Encontrados ${shifts.length} turnos publicados! Procesando empleados...`);

        // 3. Find unique employees
        const employeeIds = [...new Set(shifts.map(s => s.employee_id).filter(Boolean))];
        const { data: employees } = await supabase
            .from('toast_employees')
            .select('id, first_name, last_name, email')
            .in('id', employeeIds);

        if (!employees || employees.length === 0) {
            console.log('⚠️ No se encontraron empleados con IDs asignados.');
            return;
        }

        // 4. Authenticate Emisor
        const { accessToken, fromEmail } = await getSystemTransporter();

        // 5. Send Emails
        let successCount = 0;
        let failCount = 0;

        for (const emp of employees) {
            if (!emp.email) {
                console.log(`⏭️ Saltando empleado ${emp.first_name} ${emp.last_name}: No tiene correo electrónico.`);
                continue;
            }

            const empShifts = shifts
                .filter(s => s.employee_id === emp.id)
                .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());

            if (empShifts.length === 0) continue;

            const shiftRows = empShifts.map(s => {
                const sDate = new Date(s.start_time);
                const eDate = new Date(s.end_time);

                const dayName = sDate.toLocaleDateString('es-US', { weekday: 'long', timeZone: 'America/Los_Angeles' });
                const dayNum = sDate.toLocaleDateString('es-US', { day: 'numeric', timeZone: 'America/Los_Angeles' });
                const month = sDate.toLocaleDateString('es-US', { month: 'short', timeZone: 'America/Los_Angeles' });
                const start = sDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Los_Angeles' });
                const end = eDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Los_Angeles' });

                return `
                    <tr>
                        <td style="padding: 16px; border-bottom: 1px solid #e5e7eb; font-weight: 600; color: #4f46e5; text-transform: capitalize;">
                            ${dayName}<br>
                            <span style="font-size: 24px; font-weight: 800; color: #1f2937;">${dayNum}</span>
                            <span style="font-size: 12px; color: #6b7280; text-transform: uppercase; margin-left: 4px;">${month}</span>
                        </td>
                        <td style="padding: 16px; border-bottom: 1px solid #e5e7eb; text-align: center; font-size: 16px; font-weight: 600; color: #1f2937;">
                            ${start} - ${end}
                        </td>
                    </tr>
                `;
            }).join('');

            const fullHtml = `
                <!DOCTYPE html>
                <html>
                <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, Arial, sans-serif; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 20px;">
                    <table role="presentation" style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 24px; overflow: hidden; box-shadow: 0 20px 50px rgba(0,0,0,0.2);">
                        <tr>
                            <td style="background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%); padding: 40px 30px; text-align: center;">
                                <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 800;">📅 Tu Nuevo Horario</h1>
                                <p style="margin: 10px 0 0 0; color: rgba(255,255,255,0.9); font-size: 14px;">${storeName}</p>
                            </td>
                        </tr>
                        <tr>
                            <td style="padding: 40px 30px 20px 30px;">
                                <h2 style="margin: 0 0 16px 0; color: #1f2937; font-size: 24px;">¡Hola, ${emp.first_name}! 👋</h2>
                                <p style="margin: 0; color: #6b7280; font-size: 16px; line-height: 1.6;">Aquí tienes tu horario publicado:</p>
                            </td>
                        </tr>
                            <tr>
                            <td style="padding: 0 30px 40px 30px;">
                                <table role="presentation" style="width: 100%; border-collapse: collapse; background: #f9fafb; border-radius: 16px; overflow: hidden; border: 2px solid #e5e7eb;">
                                    <thead><tr><th style="padding:16px;">Día</th><th style="padding:16px;">Horario</th></tr></thead>
                                    <tbody>${shiftRows}</tbody>
                                </table>
                            </td>
                        </tr>
                            <tr>
                            <td style="padding: 30px; background: #f9fafb; border-top: 1px solid #e5e7eb; text-align: center;">
                                <p style="margin: 0; color: #9ca3af; font-size: 13px;">Mensaje enviado por el sistema de recuperación.</p>
                            </td>
                        </tr>
                    </table>
                </body>
                </html>
            `;

            const mailOptions = {
                from: `"${storeName} Schedule" <${fromEmail}>`,
                to: emp.email,
                subject: `📅 Horario: ${storeName}`,
                html: fullHtml,
            };

            try {
                // Compilar con nodemailer sin enviar directo
                const compiler = nodemailer.createTransport({ streamTransport: true, newline: 'windows' });
                const info = await compiler.sendMail(mailOptions);
                
                const rawBuffer = await new Promise<Buffer>((resolve, reject) => {
                    const message = info.message as any;
                    if (Buffer.isBuffer(message)) return resolve(message);
                    if (typeof message.pipe === 'function') {
                        const chunks: Buffer[] = [];
                        message.on('data', (chunk: Buffer) => chunks.push(chunk));
                        message.on('end', () => resolve(Buffer.concat(chunks)));
                        message.on('error', (err: Error) => reject(err));
                        return;
                    }
                    reject(new Error('Formato desconocido de Nodemailer'));
                });

                const raw = rawBuffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

                const sendRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ raw })
                });

                if (!sendRes.ok) {
                    throw new Error(`Google API respondió con status ${sendRes.status}`);
                }

                console.log(`✅ Correo enviado con éxito a: ${emp.first_name} (${emp.email})`);
                successCount++;
            } catch (err: any) {
                console.error(`❌ Falló envío a ${emp.email}:`, err.message);
                failCount++;
            }

            // Pausa de cortesía para no saturar a Google
            await new Promise(r => setTimeout(r, 600));
        }

        console.log('\n=============================================');
        console.log(`🎉 PROCESO FINALIZADO. OK: ${successCount} | Fallos: ${failCount}`);
        console.log('=============================================\n');

    } catch(err: any) {
        console.error('💥 ERROR CRÍTICO:', err.message);
    }
}

main();
