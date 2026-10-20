/**
 * @module lib/gavilan-pos/manager-pin
 * @description Utilidades de servidor para el PIN de autorización de gerente de Gavilan POS
 *              (descuentos Empleado / Policía y anulaciones). Hash `scrypt` + salt aleatorio por PIN.
 *
 * @businessRules
 * - El PIN nunca se almacena ni se registra en claro (solo `pin_salt` + `pin_hash` en `gavilan_pos_manager_pins`).
 * - PIN de 4 a 8 dígitos. Se rechazan PINs triviales (repetidos como 1111, secuencias como 1234 / 9876).
 * - Comparación en tiempo constante (`timingSafeEqual`) para evitar ataques de tiempo.
 * - Anti fuerza bruta: 5 intentos fallidos por usuario solicitante en 5 minutos → bloqueo temporal (429).
 *
 * @dataFlow
 * - `POST /api/gavilan-pos/manager-approval` (SET_PIN / VERIFY) usa estas funciones.
 *
 * @notes
 * - El limitador en memoria es por instancia serverless; la bitácora `gavilan_pos_discount_approvals`
 *   conserva el rastro de auditoría de cada autorización exitosa.
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto'

const KEY_LEN = 32

export function isValidPinFormat(pin: unknown): pin is string {
    return typeof pin === 'string' && /^\d{4,8}$/.test(pin)
}

export function isWeakPin(pin: string): boolean {
    if (/^(\d)\1+$/.test(pin)) return true
    const digits = pin.split('').map(Number)
    const asc = digits.every((d, i) => i === 0 || d === (digits[i - 1] + 1) % 10)
    const desc = digits.every((d, i) => i === 0 || d === (digits[i - 1] + 9) % 10)
    return asc || desc
}

export function hashPin(pin: string, salt?: string): { salt: string; hash: string } {
    const useSalt = salt || randomBytes(16).toString('hex')
    const hash = scryptSync(pin, useSalt, KEY_LEN).toString('hex')
    return { salt: useSalt, hash }
}

export function verifyPin(pin: string, salt: string, expectedHash: string): boolean {
    try {
        const candidate = scryptSync(pin, salt, KEY_LEN)
        const expected = Buffer.from(expectedHash, 'hex')
        if (expected.length !== candidate.length) return false
        return timingSafeEqual(candidate, expected)
    } catch {
        return false
    }
}

const attempts = new Map<string, { count: number; firstAt: number }>()
const WINDOW_MS = 5 * 60 * 1000
const MAX_FAILS = 5

export function isRateLimited(key: string, now = Date.now()): boolean {
    const a = attempts.get(key)
    if (!a) return false
    if (now - a.firstAt > WINDOW_MS) { attempts.delete(key); return false }
    return a.count >= MAX_FAILS
}

export function registerFailedAttempt(key: string, now = Date.now()): void {
    const a = attempts.get(key)
    if (!a || now - a.firstAt > WINDOW_MS) attempts.set(key, { count: 1, firstAt: now })
    else a.count++
}

export function clearAttempts(key: string): void {
    attempts.delete(key)
}

export const MANAGER_ROLES = ['admin', 'supervisor', 'manager', 'asistente']
