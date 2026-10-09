/**
 * @module lib/mobile/payment-provider
 * @description Interfaz desacoplada y adapters de pasarela de pago para Tacos Gavilan Mobile.
 * Diseñado conforme a los estándares de seguridad bancaria PCI-DSS y arquitectura autorizada de Toast POS.
 * 
 * @businessRules
 * - Prohibición Absoluta de PAN/CVC: Este servidor nunca recibe, procesa, registra ni almacena números de tarjeta ni códigos de seguridad.
 * - Cero activación por inferencia: Tanto el Adapter A (Toast Credit Cards API) como el Adapter B (External Processor + Toast OTHER)
 *   permanecen estrictamente deshabilitados por feature flag hasta que Toast Partner Management apruebe contractualmente el mecanismo.
 * - Estados financieros rigurosamente separados: PENDING_PAYMENT -> AUTHORIZED -> PAID -> PAYMENT_FAILED / VOIDED / REFUNDED.
 * - Ninguna bandera o booleano enviado desde el teléfono puede modificar estos estados financieros.
 * 
 * @dataFlow
 * - Quote autorizada -> PaymentProvider.authorize() -> Pago bloqueado o tokenizado -> app_orders + app_payment_events -> Toast POS.
 * 
 * @notes
 * - Todo cobro o autorización requiere comprobación exacta al centavo contra la cotización autorizada (app_quotes).
 */

export type NativePaymentFinancialStatus =
  | 'PENDING_PAYMENT'
  | 'AUTHORIZED'
  | 'PAID'
  | 'PAYMENT_FAILED'
  | 'VOID_PENDING'
  | 'VOIDED'
  | 'REFUND_PENDING'
  | 'REFUNDED'

export interface AuthorizePaymentInput {
  quoteId: string
  expectedAmountCents: number
  currency: string
  orderExternalId: string
  userId?: string
  paymentToken?: string
}

export interface PaymentAuthorizationResult {
  success: boolean
  status: NativePaymentFinancialStatus
  paymentIdentifier?: string
  authCode?: string
  errorCode?: string
  errorMessage?: string
  blockedExternally?: boolean
}

export interface PaymentProvider {
  readonly providerName: 'toast_credit_cards' | 'external_toast_other'
  readonly isEnabled: boolean
  authorize(input: AuthorizePaymentInput): Promise<PaymentAuthorizationResult>
  capture(paymentIdentifier: string, amountCents: number): Promise<PaymentAuthorizationResult>
  void(paymentIdentifier: string): Promise<PaymentAuthorizationResult>
  refund(paymentIdentifier: string, amountCents: number): Promise<PaymentAuthorizationResult>
}

// ─────────────────────────────────────────────────────────────
// Adapter A — Toast Credit Cards API (Deshabilitado / Disabled)
// ─────────────────────────────────────────────────────────────
/**
 * Adapter oficial para la API nativa de tarjetas de Toast.
 * Requiere el scope 'credit_cards.authorization:write' y la clave de cifrado oficial de Toast.
 */
export class ToastCreditCardsProvider implements PaymentProvider {
  readonly providerName = 'toast_credit_cards' as const
  readonly isEnabled = false // Bloqueado externamente hasta aprobación de Toast

  async authorize(input: AuthorizePaymentInput): Promise<PaymentAuthorizationResult> {
    return {
      success: false,
      status: 'PENDING_PAYMENT',
      blockedExternally: true,
      errorCode: 'BLOCKED_EXTERNALLY',
      errorMessage: "Toast Credit Cards API requiere la asignación del scope 'credit_cards.authorization:write' y la clave de cifrado oficial del merchant UUID en Toast Partner Connect."
    }
  }

  async capture(paymentIdentifier: string, amountCents: number): Promise<PaymentAuthorizationResult> {
    return {
      success: false,
      status: 'PENDING_PAYMENT',
      blockedExternally: true,
      errorCode: 'BLOCKED_EXTERNALLY',
      errorMessage: 'Captura deshabilitada: esperando activación de Toast Credit Cards API.'
    }
  }

  async void(paymentIdentifier: string): Promise<PaymentAuthorizationResult> {
    return {
      success: false,
      status: 'VOID_PENDING',
      blockedExternally: true,
      errorCode: 'BLOCKED_EXTERNALLY',
      errorMessage: 'Cancelación / Void deshabilitado: esperando activación de Toast Credit Cards API.'
    }
  }

  async refund(paymentIdentifier: string, amountCents: number): Promise<PaymentAuthorizationResult> {
    return {
      success: false,
      status: 'REFUND_PENDING',
      blockedExternally: true,
      errorCode: 'BLOCKED_EXTERNALLY',
      errorMessage: 'Reembolso / Refund deshabilitado: esperando activación de Toast Credit Cards API.'
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Adapter B — External Processor + Toast OTHER Payment (Deshabilitado / Disabled)
// ─────────────────────────────────────────────────────────────
/**
 * Adapter para procesador de pagos externo con registro tipo 'OTHER' en Toast.
 * Solo activable si Toast confirma por escrito que Tacos Gavilan tiene permitido este modelo.
 */
export class ExternalToastOtherPaymentProvider implements PaymentProvider {
  readonly providerName = 'external_toast_other' as const
  readonly isEnabled = false // Bloqueado hasta autorización por escrito de Toast

  async authorize(input: AuthorizePaymentInput): Promise<PaymentAuthorizationResult> {
    return {
      success: false,
      status: 'PENDING_PAYMENT',
      blockedExternally: true,
      errorCode: 'BLOCKED_EXTERNALLY',
      errorMessage: "El modelo de procesador externo con pago tipo 'OTHER' en Toast requiere autorización contractual previa por escrito de Toast."
    }
  }

  async capture(paymentIdentifier: string, amountCents: number): Promise<PaymentAuthorizationResult> {
    return {
      success: false,
      status: 'PENDING_PAYMENT',
      blockedExternally: true,
      errorCode: 'BLOCKED_EXTERNALLY',
      errorMessage: 'Captura deshabilitada: esperando autorización contractual de Toast.'
    }
  }

  async void(paymentIdentifier: string): Promise<PaymentAuthorizationResult> {
    return {
      success: false,
      status: 'VOID_PENDING',
      blockedExternally: true,
      errorCode: 'BLOCKED_EXTERNALLY',
      errorMessage: 'Void deshabilitado: esperando autorización contractual de Toast.'
    }
  }

  async refund(paymentIdentifier: string, amountCents: number): Promise<PaymentAuthorizationResult> {
    return {
      success: false,
      status: 'REFUND_PENDING',
      blockedExternally: true,
      errorCode: 'BLOCKED_EXTERNALLY',
      errorMessage: 'Reembolso deshabilitado: esperando autorización contractual de Toast.'
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Factory / Dispatcher de Pasarela
// ─────────────────────────────────────────────────────────────

export function getActivePaymentProvider(): PaymentProvider {
  // Por directriz estricta de arquitectura, ningún adapter productivo se auto-activa
  // mientras las credenciales de Toast reciban 403 / 10010.
  return new ToastCreditCardsProvider()
}
