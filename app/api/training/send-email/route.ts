/**
 * @module app/api/training/send-email/route
 * @description Endpoint para enviar por correo electrónico (Gmail OAuth2) el enlace de acceso
 * a la plataforma de entrenamiento móvil/tableta al personal de nuevo ingreso de Tacos Gavilan.
 *
 * @businessRules
 * - Utiliza las credenciales OAuth2 de Gmail conectadas en `public.users` (`google_refresh_token` y `google_email_connected`),
 *   priorizando al usuario autenticado, al Gerente de la Sucursal seleccionada o a la cuenta corporativa autorizada.
 * - Si el empleado no tenía correo registrado en `toast_employees` o se actualizó, lo guarda automáticamente en `public.toast_employees`.
 * - El correo incluye el botón directo a `/training/portal?store={storeId}&emp={employeeId}` e instrucciones claras para ingresar
 *   con su clave de 4 dígitos de RONOS.
 *
 * @dataFlow
 * - `POST /api/training/send-email` -> actualiza `toast_employees.email` -> Gmail API (`/gmail/v1/users/me/messages/send`)
 */

import { NextRequest, NextResponse } from 'next/server';
import nodemailer from 'nodemailer';
import { supabaseAdmin } from '@/lib/supabase';
import { getServerUser } from '@/lib/auth-server';

async function resolveGmailSender(storeId?: number, authUserId?: string | number | null) {
  const candidates: any[] = [];

  if (authUserId) {
    const { data: u } = await supabaseAdmin
      .from('users')
      .select('id, full_name, email, google_refresh_token, google_email_connected')
      .eq('id', authUserId)
      .maybeSingle();
    if (u?.google_refresh_token && u?.google_email_connected) {
      candidates.push(u);
    }
  }

  if (storeId && storeId > 0) {
    const { data: storeUsers } = await supabaseAdmin
      .from('users')
      .select('id, full_name, email, google_refresh_token, google_email_connected')
      .eq('store_id', storeId)
      .not('google_refresh_token', 'is', null);
    for (const su of storeUsers || []) {
      if (su.google_refresh_token && su.google_email_connected) {
        candidates.push(su);
      }
    }
  }

  const corpId = process.env.CORPORATE_SCHEDULE_SENDER_USER_ID?.trim();
  if (corpId) {
    const { data: cu } = await supabaseAdmin
      .from('users')
      .select('id, full_name, email, google_refresh_token, google_email_connected')
      .eq('id', corpId)
      .maybeSingle();
    if (cu?.google_refresh_token && cu?.google_email_connected) {
      candidates.push(cu);
    }
  }

  // Respaldo a cualquier cuenta corporativa conectada en users (ej. id 25)
  const { data: fallbackUsers } = await supabaseAdmin
    .from('users')
    .select('id, full_name, email, google_refresh_token, google_email_connected')
    .not('google_refresh_token', 'is', null)
    .order('id', { ascending: true })
    .limit(5);

  for (const fu of fallbackUsers || []) {
    if (fu.google_refresh_token && fu.google_email_connected) {
      candidates.push(fu);
    }
  }

  let lastErr = 'No hay cuenta de Gmail conectada en el sistema.';

  for (const targetUser of candidates) {
    try {
      const params = new URLSearchParams();
      params.append('client_id', process.env.GOOGLE_CLIENT_ID || '');
      params.append('client_secret', process.env.GOOGLE_CLIENT_SECRET || '');
      params.append('refresh_token', targetUser.google_refresh_token);
      params.append('grant_type', 'refresh_token');

      const refreshRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params,
      });

      if (!refreshRes.ok) {
        const errData = await refreshRes.json().catch(() => ({}));
        lastErr = errData.error_description || errData.error || 'Token refresh failed';
        continue;
      }

      const tokens = await refreshRes.json();
      const accessToken = tokens.access_token;

      return {
        accessToken,
        fromEmail: targetUser.google_email_connected || targetUser.email,
        senderName: targetUser.full_name || 'Academia SOP Tacos Gavilan',
      };
    } catch (e: any) {
      lastErr = e?.message || 'OAuth error';
    }
  }

  throw new Error(`No fue posible autenticar con Gmail OAuth2: ${lastErr}`);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      storeId,
      storeName,
      employeeId,
      employeeName,
      email,
      stationLabel,
      trainerName,
      originUrl,
    } = body || {};

    const cleanEmail = String(email || '').trim().toLowerCase();
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return NextResponse.json(
        { ok: false, error: 'Ingresa un correo electrónico válido para el empleado.' },
        { status: 400 }
      );
    }

    // Si tenemos employeeId de toast_employees, guardar/actualizar su email en el Planificador
    if (employeeId) {
      await supabaseAdmin
        .from('toast_employees')
        .update({ email: cleanEmail })
        .eq('id', String(employeeId));
    }

    const authUser = await getServerUser(req).catch(() => null);
    const { accessToken, fromEmail } = await resolveGmailSender(
      Number(storeId || 0),
      authUser?.id
    );

    const baseOrigin =
      originUrl ||
      process.env.NEXT_PUBLIC_APP_URL ||
      req.headers.get('origin') ||
      'https://teg-modernizado.vercel.app';

    const portalUrl = `${baseOrigin.replace(/\/$/, '')}/training/portal?store=${encodeURIComponent(
      String(storeId || 1)
    )}&emp=${encodeURIComponent(String(employeeId || ''))}`;

    const displayName = String(employeeName || 'Integrante').trim();
    const displayStore = String(storeName || 'Tacos Gavilan').trim();
    const displayStation = String(stationLabel || 'Estación Operativa').trim();
    const displayTrainer = String(trainerName || 'Gerente de Sucursal').trim();

    const html = `
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      </head>
      <body style="margin:0;padding:0;background-color:#FFFAF5;font-family:'Segoe UI',Arial,sans-serif;color:#0F172A;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#FFFAF5;padding:24px 12px;">
          <tr>
            <td align="center">
              <table width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;background-color:#FFFFFF;border-radius:20px;border:2px solid #F1E4D8;overflow:hidden;box-shadow:0 12px 30px rgba(218,41,28,0.08);">
                <tr>
                  <td style="background:linear-gradient(90deg,#DA291C 0%,#B91C1C 60%,#FE5000 100%);height:8px;"></td>
                </tr>
                <tr>
                  <td style="padding:28px 28px 18px 28px;text-align:center;border-bottom:1px solid #F5EBE1;">
                    <div style="display:inline-block;background-color:#FFF5F5;color:#DA291C;font-size:11px;font-weight:800;letter-spacing:1.5px;padding:6px 14px;border-radius:999px;border:1px solid #FECACA;text-transform:uppercase;">
                      ACADEMIA CORPORATIVA SOP • TACOS GAVILAN
                    </div>
                    <h1 style="margin:14px 0 6px 0;font-size:24px;font-weight:900;color:#0F172A;">
                      ¡Bienvenido a tu Entrenamiento Oficial!
                    </h1>
                    <p style="margin:0;font-size:14px;color:#475569;">
                      Hola <strong>${displayName}</strong>, tu acceso a la plataforma de capacitación de <strong>Tacos Gavilan</strong> está listo.
                    </p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:24px 28px;">
                    <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#FFFDF9;border:1px solid #F1E4D8;border-radius:14px;padding:16px;margin-bottom:22px;">
                      <tr>
                        <td style="padding:6px 0;font-size:13px;color:#64748B;">Sucursal Asignada:</td>
                        <td style="padding:6px 0;font-size:14px;font-weight:800;color:#0F172A;text-align:right;">${displayStore}</td>
                      </tr>
                      <tr>
                        <td style="padding:6px 0;font-size:13px;color:#64748B;">Estación de Entrenamiento:</td>
                        <td style="padding:6px 0;font-size:14px;font-weight:800;color:#DA291C;text-align:right;">${displayStation}</td>
                      </tr>
                      <tr>
                        <td style="padding:6px 0;font-size:13px;color:#64748B;">Entrenador / Manager:</td>
                        <td style="padding:6px 0;font-size:14px;font-weight:700;color:#0F172A;text-align:right;">${displayTrainer}</td>
                      </tr>
                      <tr>
                        <td style="padding:6px 0;font-size:13px;color:#64748B;">Clave de Acceso:</td>
                        <td style="padding:6px 0;font-size:13px;font-weight:800;color:#B45309;text-align:right;">Tu PIN de 4 dígitos de RONOS</td>
                      </tr>
                    </table>

                    <div style="text-align:center;margin:26px 0;">
                      <a href="${portalUrl}" style="display:inline-block;background-color:#DA291C;color:#FFFFFF;text-decoration:none;font-size:16px;font-weight:800;padding:16px 32px;border-radius:14px;box-shadow:0 6px 16px rgba(218,41,28,0.28);">
                        📱 Abrir Mi Entrenamiento en el Teléfono
                      </a>
                    </div>

                    <div style="background-color:#FFFBEB;border:1px solid #FDE68A;border-radius:12px;padding:14px 16px;font-size:13px;color:#92400E;line-height:1.5;">
                      <strong>¿Cómo ingresar?</strong><br/>
                      1. Toca el botón rojo desde tu teléfono o tableta.<br/>
                      2. Tu nombre y sucursal aparecerán seleccionados automáticamente.<br/>
                      3. Ingresa tu <strong>clave de 4 dígitos de RONOS</strong> para iniciar tus videos paso a paso con voz instructora.
                    </div>
                  </td>
                </tr>
                <tr>
                  <td style="background-color:#F8FAFC;padding:16px 28px;text-align:center;border-top:1px solid #E2E8F0;font-size:12px;color:#64748B;">
                    <strong>Tacos Gavilan</strong> • Academia de Operaciones & Estándares de Receta<br/>
                    <span style="font-size:11px;color:#94A3B8;">Enlace directo: ${portalUrl}</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `;

    const compiler = nodemailer.createTransport({
      streamTransport: true,
      newline: 'windows',
    });

    const info = await compiler.sendMail({
      from: `"Academia SOP Tacos Gavilan" <${fromEmail}>`,
      to: cleanEmail,
      subject: `🎓 Tu Capacitación Oficial en Tacos Gavilan (${displayStore})`,
      html,
    });

    const rawBuffer = await new Promise<Buffer>((resolve, reject) => {
      const message = info.message as any;
      if (Buffer.isBuffer(message)) return resolve(message);
      const chunks: Buffer[] = [];
      message.on('data', (chunk: Buffer) => chunks.push(chunk));
      message.on('end', () => resolve(Buffer.concat(chunks)));
      message.on('error', (err: Error) => reject(err));
    });

    const raw = rawBuffer
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const sendRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw }),
    });

    if (!sendRes.ok) {
      const errTxt = await sendRes.text();
      throw new Error(`Error enviando correo vía Gmail API: ${errTxt}`);
    }

    return NextResponse.json({
      ok: true,
      sentTo: cleanEmail,
      fromEmail,
      portalUrl,
    });
  } catch (err: any) {
    console.error('[POST /api/training/send-email] Error:', err);
    return NextResponse.json(
      { ok: false, error: err?.message || 'Error al enviar correo de capacitación.' },
      { status: 500 }
    );
  }
}
