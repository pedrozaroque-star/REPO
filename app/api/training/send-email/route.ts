/**
 * @module app/api/training/send-email/route
 * @description Endpoint para enviar por correo electrónico (`sendSystemEmail`) el enlace de acceso
 * a la plataforma de entrenamiento móvil/tableta (`/training/portal`) al personal de Tacos Gavilan.
 *
 * @businessRules
 * - Exige usuario autenticado con rol de tienda/administración (`admin`, `supervisor`, `manager`, `asistente`, `assistant`, `gerente`).
 * - Si el empleado no tenía correo registrado en `toast_employees` o se actualizó, lo guarda automáticamente en `public.toast_employees`.
 * - Escapa todo texto HTML interpolado y restringe la URL base al dominio oficial de la plataforma (previniendo phishing / open redirect).
 * - Envía el enlace directo a `/training/portal?store={storeId}&emp={employeeId}` con instrucciones para ingresar con su PIN de 4 dígitos de RONOS.
 *
 * @dataFlow
 * - `POST /api/training/send-email` -> `getServerUser` -> `toast_employees.email` -> `sendSystemEmail()`
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { sendSystemEmail } from '@/lib/system-mailer';
import { formatStoreDisplayName } from '@/lib/store-display';
import { getServerUser } from '@/lib/auth-server';

const ALLOWED_EMAIL_ROLES = new Set([
  'admin',
  'supervisor',
  'manager',
  'asistente',
  'assistant',
  'gerente',
]);

function escapeHtml(raw: string): string {
  return String(raw || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function resolveSafeAppOrigin(req: NextRequest): string {
  const configured = (process.env.NEXT_PUBLIC_APP_URL || '').trim();
  if (configured.startsWith('https://') || configured.startsWith('http://localhost')) {
    return configured.replace(/\/$/, '');
  }
  const reqOrigin = req.nextUrl.origin;
  if (
    reqOrigin.startsWith('https://tacosgavilan') ||
    reqOrigin.startsWith('http://localhost:') ||
    reqOrigin.startsWith('http://127.0.0.1:')
  ) {
    return reqOrigin.replace(/\/$/, '');
  }
  return 'https://tacosgavilan.vercel.app';
}

export async function POST(req: NextRequest) {
  try {
    const serverUser = await getServerUser(req);
    if (!serverUser) {
      return NextResponse.json({ ok: false, error: 'No autenticado.' }, { status: 401 });
    }
    if (!ALLOWED_EMAIL_ROLES.has(String(serverUser.role || '').trim().toLowerCase())) {
      return NextResponse.json(
        { ok: false, error: 'Sin permiso para enviar invitaciones de capacitación.' },
        { status: 403 }
      );
    }

    const body = await req.json();
    const {
      storeId,
      storeName,
      employeeId,
      employeeName,
      email,
      stationLabel,
      trainerName,
    } = body || {};

    const cleanEmail = String(email || '').trim().toLowerCase();
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return NextResponse.json(
        { ok: false, error: 'Ingresa un correo electrónico válido para el empleado.' },
        { status: 400 }
      );
    }

    if (employeeId) {
      await supabaseAdmin
        .from('toast_employees')
        .update({ email: cleanEmail })
        .eq('id', String(employeeId));
    }

    const baseOrigin = resolveSafeAppOrigin(req);
    const portalUrl = `${baseOrigin}/training/portal?store=${encodeURIComponent(
      String(storeId || 1)
    )}&emp=${encodeURIComponent(String(employeeId || ''))}`;

    const cleanStoreLabel = formatStoreDisplayName({ id: storeId, name: storeName }) || 'Tacos Gavilan';
    const displayName = escapeHtml(String(employeeName || 'Integrante').trim());
    const displayStore = escapeHtml(cleanStoreLabel);
    const displayStation = escapeHtml(String(stationLabel || 'Puesto Operativo').trim());
    const displayTrainer = escapeHtml(String(trainerName || 'Gerente de Sucursal').trim());
    const safePortalUrl = escapeHtml(portalUrl);

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
                        <td style="padding:6px 0;font-size:13px;color:#64748B;">Puesto a Certificar:</td>
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
                      <a href="${safePortalUrl}" style="display:inline-block;background-color:#DA291C;color:#FFFFFF;text-decoration:none;font-size:16px;font-weight:800;padding:16px 32px;border-radius:14px;box-shadow:0 6px 16px rgba(218,41,28,0.28);">
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
                    <strong>Sistema de Monitoreo</strong> • Tacos Gavilan • Academia de Operaciones<br/>
                    <span style="font-size:11px;color:#94A3B8;">Enlace directo: ${safePortalUrl}</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `;

    const mailRes = await sendSystemEmail({
      fromName: 'Sistema de Monitoreo',
      to: cleanEmail,
      subject: `🎓 Tu Capacitación Oficial en Tacos Gavilan (${cleanStoreLabel})`,
      html,
    });

    return NextResponse.json({
      ok: true,
      sentTo: cleanEmail,
      fromEmail: mailRes.fromEmail,
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
