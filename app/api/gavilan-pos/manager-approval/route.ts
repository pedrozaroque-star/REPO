/**
 * @module app/api/gavilan-pos/manager-approval/route
 * @description Autorización de gerente para Gavilan POS con PIN real (hash scrypt), reemplazando los botones
 *              `$0.00` "Empleado" / "Policia" de Toast por descuentos auditados.
 *
 * @businessRules
 * - `SET_PIN`: solo roles `admin`, `supervisor`, `manager`, `asistente` con sesión TEG válida registran/actualizan su PIN (4–8 dígitos, no trivial).
 * - `VERIFY`: cualquier usuario con sesión TEG (la cajera) solicita; el gerente teclea su PIN. Si coincide con un PIN activo:
 *   se valida el descuento (`EMPLEADO` = 50%; `POLICIA` = 50% o 100%) o la anulación (`VOID_ORDER`),
 *   se registra en `gavilan_pos_discount_approvals` y se devuelve SOLO el nombre del gerente (nunca el PIN).
 * - Anti fuerza bruta: 5 fallos en 5 minutos por usuario solicitante → 429.
 * - Fecha operativa con regla de 6:00 AM (`getCaliforniaBusinessDate`, America/Los_Angeles).
 *
 * @dataFlow
 * - `CashierRegister` (modal PIN) → POST → `gavilan_pos_manager_pins` (lectura) + `gavilan_pos_discount_approvals` (inserción).
 *
 * @notes
 * - Sin columnas generadas en los payloads (regla 428C9).
 */
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getServerUser } from '@/lib/auth-server'
import { getCaliforniaBusinessDate } from '@/lib/business-date'
import { isAllowedDiscount } from '@/lib/gavilan-pos/register-layout'
import {
    MANAGER_ROLES,
    clearAttempts,
    hashPin,
    isRateLimited,
    isValidPinFormat,
    isWeakPin,
    registerFailedAttempt,
    verifyPin,
} from '@/lib/gavilan-pos/manager-pin'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
    const user = await getServerUser(req)
    if (!user) {
        return NextResponse.json({ ok: false, error: 'No autenticado. Inicia sesión nuevamente.' }, { status: 401 })
    }

    let body: any
    try {
        body = await req.json()
    } catch {
        return NextResponse.json({ ok: false, error: 'JSON inválido' }, { status: 400 })
    }
    const action = String(body?.action || '')

    try {
        if (action === 'SET_PIN') {
            const role = String(user.role || '').toLowerCase()
            if (!MANAGER_ROLES.includes(role)) {
                return NextResponse.json({ ok: false, error: 'Solo gerentes, asistentes, supervisores o administradores pueden registrar un PIN.' }, { status: 403 })
            }
            const pin = body?.pin
            if (!isValidPinFormat(pin)) {
                return NextResponse.json({ ok: false, error: 'El PIN debe tener de 4 a 8 dígitos.' }, { status: 400 })
            }
            if (isWeakPin(pin)) {
                return NextResponse.json({ ok: false, error: 'PIN demasiado fácil (repetido o en secuencia). Elige otro.' }, { status: 400 })
            }
            // Prevent two approvers sharing the same PIN (would make the audit trail ambiguous)
            const { data: others, error: othersErr } = await supabaseAdmin
                .from('gavilan_pos_manager_pins')
                .select('approver_email, pin_salt, pin_hash')
                .eq('is_active', true)
            if (othersErr) throw othersErr
            const email = String(user.email).trim().toLowerCase()
            const clash = (others || []).some((o: any) => o.approver_email !== email && verifyPin(pin, o.pin_salt, o.pin_hash))
            if (clash) {
                return NextResponse.json({ ok: false, error: 'Ese PIN ya está en uso por otro gerente. Elige otro.' }, { status: 409 })
            }
            const { salt, hash } = hashPin(pin)
            const storeNumber = Number.isFinite(Number(user.store_id)) ? Number(user.store_id) : null
            const { error } = await supabaseAdmin
                .from('gavilan_pos_manager_pins')
                .upsert({
                    approver_email: email,
                    approver_name: user.name || email,
                    approver_role: role,
                    store_number: storeNumber,
                    pin_salt: salt,
                    pin_hash: hash,
                    is_active: true,
                    failed_attempts: 0,
                    locked_until: null,
                    updated_at: new Date().toISOString(),
                }, { onConflict: 'approver_email' })
            if (error) throw error
            return NextResponse.json({ ok: true, approverName: user.name || email })
        }

        if (action === 'VERIFY') {
            const requester = String(user.email).trim().toLowerCase()
            if (isRateLimited(requester)) {
                return NextResponse.json({ ok: false, error: 'Demasiados intentos. Espera 5 minutos.' }, { status: 429 })
            }
            const pin = body?.pin
            const approvalType = String(body?.approvalType || '')
            const discountPct = Number(body?.discountPct ?? 0)
            if (!isValidPinFormat(pin)) {
                registerFailedAttempt(requester)
                return NextResponse.json({ ok: false, error: 'PIN inválido.' }, { status: 400 })
            }
            const isVoid = approvalType === 'VOID_ORDER'
            if (!isVoid && !isAllowedDiscount(approvalType, discountPct)) {
                return NextResponse.json({ ok: false, error: 'Tipo o porcentaje de descuento no permitido.' }, { status: 400 })
            }

            const { data: pins, error: pinsErr } = await supabaseAdmin
                .from('gavilan_pos_manager_pins')
                .select('id, approver_name, approver_email, pin_salt, pin_hash')
                .eq('is_active', true)
            if (pinsErr) throw pinsErr
            const match = (pins || []).find((p: any) => verifyPin(pin, p.pin_salt, p.pin_hash))
            if (!match) {
                registerFailedAttempt(requester)
                return NextResponse.json({ ok: false, error: 'PIN incorrecto.' }, { status: 401 })
            }
            clearAttempts(requester)

            const nowIso = new Date().toISOString()
            await supabaseAdmin.from('gavilan_pos_manager_pins').update({ last_used_at: nowIso, updated_at: nowIso }).eq('id', match.id)
            const storeNumber = Number.isFinite(Number(body?.storeNumber)) ? Number(body.storeNumber) : null
            const { data: logRow, error: logErr } = await supabaseAdmin
                .from('gavilan_pos_discount_approvals')
                .insert({
                    client_order_id: body?.clientOrderId ? String(body.clientOrderId).slice(0, 120) : null,
                    store_number: storeNumber,
                    business_date: getCaliforniaBusinessDate(),
                    discount_type: isVoid ? 'VOID_ORDER' : approvalType,
                    discount_pct: isVoid ? 0 : discountPct,
                    approver_name: match.approver_name,
                    approver_email: match.approver_email,
                    requested_by_email: requester,
                    note: body?.note ? String(body.note).slice(0, 300) : null,
                })
                .select('id')
                .single()
            if (logErr) throw logErr

            return NextResponse.json({ ok: true, approverName: match.approver_name, approvalId: logRow?.id })
        }

        return NextResponse.json({ ok: false, error: `Acción desconocida: ${action}` }, { status: 400 })
    } catch (error: any) {
        console.error('[Gavilan POS Manager Approval Error]:', error)
        return NextResponse.json({ ok: false, error: error?.message || 'Error interno' }, { status: 500 })
    }
}
