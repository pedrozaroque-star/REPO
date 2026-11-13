/**
 * @module components/customer-app-v2/types
 * @description Definiciones de tipos TypeScript para el ecosistema modular de Tacos Gavilan App V2,
 * cubriendo sucursales autoritativas, catálogo visual, menú en vivo de Toast POS, bolsa de pedido,
 * cotizaciones, sesiones DoorDash Storefront, perfiles de comensal y propiedades del simulador/app web.
 *
 * @businessRules
 * - Preserva exactamente el contrato público `CustomerAppV2ProProps` esperado por `/app` y `/app/v2`.
 * - Mantiene compatibilidad tipada con los endpoints `/api/mobile/*` (`stores`, `menu`, `cart`, `favorites`,
 *   `address/autocomplete`, `order/quote`, `order/status`, `doordash/checkout-session`, `user/*`).
 *
 * @dataFlow
 * - Consumido por `useCustomerAppV2`, `V2BrandChrome`, etapas (`stories`/`hello`), pestañas y modales de V2.
 *
 * @notes
 * - `taco-buche` / Buche permanece intacto como uno de los 23 platillos oficiales del catálogo del sitio web.
 */

export type DayOfWeekIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6

export interface DailyScheduleWindow {
  openHour: number
  closeHour: number
  labelEn: string
  labelEs: string
}

export interface V2AuthoritativeStore {
  id: number
  cityTitle: string
  crossStreets: string
  name: string
  streetAddress: string
  address: string
  city: string
  state: 'CA'
  zipCode: string
  phone: string
  latitude: number
  longitude: number
  toastOrderingUrl: string
  onlineOrderingUrl?: string
  hoursEn: string
  hoursEs: string
  weeklySchedule: Record<DayOfWeekIndex, DailyScheduleWindow>
}

export interface V2StoreWithDistance extends V2AuthoritativeStore {
  distanceMiles: number | null
}

export type WebsiteMenuCategory =
  | 'tacos'
  | 'burritos'
  | 'quesadillas'
  | 'mulitas'
  | 'sopes'
  | 'tortas'
  | 'platos'
  | 'nachos'
  | 'drinks'

export type LockupVariant =
  | 'los-tacos'
  | 'el-burrito'
  | 'super-burrito'
  | 'super-mulita'
  | 'la-torta'
  | 'el-plato'
  | 'los-sopes'
  | 'super-nachos'
  | 'super-quesadilla'
  | 'la-quesadilla'
  | 'las-mulitas'
  | 'menu-taco'
  | 'single'
  | 'taco-plate'
  | 'red-word'
  | 'top-small'
  | 'top-equal'
  | 'top-red-equal'

export interface TraditionalSpecialtyCard {
  id: string
  lockupVariant: LockupVariant
  top?: string
  main: string
  altEn: string
  altEs: string
  image: string
  targetCategory: WebsiteMenuCategory
}

export interface SignatureDish {
  id: string
  category: WebsiteMenuCategory
  nameEn: string
  nameEs: string
  lockupVariantEn: LockupVariant
  lockupMainEn: string
  lockupTopEn?: string
  lockupVariantEs: LockupVariant
  lockupMainEs: string
  lockupTopEs?: string
  descEn: string
  descEs: string
  image: string
}

export type V2Stage = 'stories' | 'hello' | 'main'
export type MainTab = 'home' | 'order' | 'stores' | 'cravings' | 'account'
export type V2AuthSheet = null | 'sms-otp' | 'contact-support'
export type FulfillmentMode = 'pickup' | 'delivery'

export interface V2UserProfile {
  firstName: string
  lastName: string
  email: string
  phone?: string
  provider: 'email' | 'sms'
}

export interface CustomerAppV2ProProps {
  embedded?: boolean
  fullscreenNative?: boolean
  islandOverlayMode?: boolean
  externalStage?: V2Stage | null
  externalStoryIndex?: number | null
  externalTab?: MainTab | null
  externalAuthSheet?: V2AuthSheet
  externalLoggedInDemo?: boolean
  controlTick?: number
}

export interface LiveModifierOption {
  id?: string
  guid: string
  name: string
  price: number
  selectionType?: string
}

export interface LiveModifierGroup {
  guid: string
  name: string
  minSelections: number
  maxSelections: number
  requiredMode?: 'REQUIRED' | 'OPTIONAL' | 'OPTIONAL_FORCE_SHOW'
  selectionMode?: 'SINGLE' | 'MULTI'
  options: LiveModifierOption[]
}

export interface LiveMenuItem {
  id: string
  guid: string
  toastGuid: string
  name: string
  description: string
  price: number
  imageUrl?: string | null
  category?: string
  modifierGroupIds?: string[]
  modifierGroups?: LiveModifierGroup[]
}

export interface LiveCatalogMetadata {
  source: string
  menuId?: string
  isReconciledWithToastMenusV3?: boolean
  purchasable: boolean
  storeId: number
  channel: 'PICKUP' | 'DELIVERY'
  lastSyncedAt?: string
  warning?: string | null
}

export interface SelectedModifierChoice {
  optionGroupGuid: string
  guid: string
  name: string
  price: number
}

export interface V2BagLine {
  lineId: string
  itemGuid: string
  name: string
  unitPrice: number
  quantity: number
  modifiers: SelectedModifierChoice[]
  specialInstructions?: string
  imageUrl?: string | null
}

export interface AddressSuggestion {
  id: string
  label: string
  primaryText: string
  secondaryText: string
  street: string
  aptSuite?: string
  city: string
  state: string
  zipCode: string
}

export interface DeliveryAddressDraft {
  formattedAddress: string
  street: string
  apartmentNumber: string
  city: string
  state: string
  zipCode: string
  instructions: string
}

export interface QuoteBreakdown {
  status: 'idle' | 'loading' | 'quoted' | 'blocked_external' | 'delivery_disabled' | 'error'
  quoteId?: string | null
  subtotal: number
  taxAmount: number
  serviceChargeTotal: number
  deliveryFee: number
  tipAmount: number
  discountAmount: number
  totalAmount: number
  nonPayableEstimate?: boolean
  message?: string | null
}

export interface StorefrontSessionResult {
  status: 'idle' | 'creating' | 'ready' | 'storefront_disabled' | 'error'
  orderSessionId?: string | null
  checkoutUrl?: string | null
  message?: string | null
}

export interface ActiveOrderStatus {
  id: string
  storeId: number
  toastOrderGuid: string | null
  kitchenStatus: string
  paymentStatus: string
  deliveryStatus: string
  channel: 'PICKUP' | 'DELIVERY'
  totalAmount: number
  etaMinutes: number | null
  deliveryAddress: string | null
  updatedAt: string
}

export interface OrderSessionRecord {
  id: string
  storeId: number
  storeName: string
  cityTitle?: string
  crossStreets?: string
  address: string
  phone: string
  mode: FulfillmentMode
  url: string
  openedAt: string
}

export interface ServerFavoriteOrder {
  id: string
  storeId: number
  name: string
  items: Array<{
    itemGuid: string
    name: string
    price: number
    quantity: number
    modifiers: Array<{ guid: string; name: string; price: number }>
  }>
  createdAt: string
}

export interface V2StorySlide {
  id: string
  image: string
  kicker: string
  lines: string[]
  accentLineIndex: number
  subtitle: string
  lightLeakSide: 'left' | 'right'
}
