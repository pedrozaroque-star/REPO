/**
 * @module components/customer-app-v2/hooks/useCustomerAppV2
 * @description Hook central de estado y lógica de negocio para Tacos Gavilan App V2.
 * Integra datos reales de `/api/mobile/*` (sucursales, menú vivo Toast POS, carrito nube,
 * favoritos, autocompletado de direcciones, cotizaciones, DoorDash Storefront checkout session,
 * rastreo de órdenes, OTP 6 dígitos email/SMS, perfil y borrado real de cuenta), con reloj
 * en vivo en Los Ángeles (intervalo 60s) y aislamiento estricto de Demo #12.
 *
 * @businessRules
 * - Día operativo en `America/Los_Angeles` actualizado cada 60 segundos (`clockTick`).
 * - Screen #12 (`externalLoggedInDemo`) opera en memoria efímera aislada: nunca contamina
 *   `localStorage`, `recentOrderSessions` ni ejecuta mutaciones reales contra PostgreSQL/Auth.
 * - No pisa el idioma global de TEG al montar; sincroniza bidireccionalmente con `useLanguage()`.
 * - Mutaciones `/api/mobile/user/profile`, `/api/mobile/user/delete` y `/api/mobile/favorites`
 *   verifican estrictamente `res.ok` antes de confirmar éxito al usuario.
 *
 * @dataFlow
 * - Consume `V2_STORES`, `SIGNATURE_DISHES`, `@/lib/i18n` y rutas REST `/api/mobile/*`.
 * - Exporta estado y acciones hacia `CustomerAppV2Pro` y subcomponentes de etapas/pestañas/modales.
 *
 * @notes
 * - `handleConfirmDeleteV2Account` retorna error explícito si HTTP falla o si está en Demo #12.
 * - `launchWrappedOrderOnline` aplica validación HTTPS allowlist antes de abrir cualquier ventana.
 */

'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLanguage } from '@/lib/i18n'
import {
  V2_STORES,
  calculateDistanceMiles,
  formatUsPhoneDisplay,
  getLaStatusClock,
  getLaTimeGreeting,
  getStoreStatusInLA,
  isAllowedExternalOrderUrl,
  normalizeUsPhone10,
} from '../data/stores'
import { SIGNATURE_DISHES, matchShowcaseDishForLiveItem } from '../data/catalog'
import type {
  ActiveOrderStatus,
  AddressSuggestion,
  CustomerAppV2ProProps,
  DeliveryAddressDraft,
  FulfillmentMode,
  LiveCatalogMetadata,
  LiveMenuItem,
  LiveModifierGroup,
  MainTab,
  OrderSessionRecord,
  QuoteBreakdown,
  ServerFavoriteOrder,
  SignatureDish,
  StorefrontSessionResult,
  V2AuthSheet,
  V2AuthoritativeStore,
  V2BagLine,
  V2Stage,
  V2StoreWithDistance,
  V2UserProfile,
} from '../types'

const DEMO_PREVIEW_USER: V2UserProfile = {
  firstName: 'Carlos',
  lastName: 'Gavilan',
  email: 'carlos@tacosgavilan.com',
  phone: '(213) 555-0199',
  provider: 'email',
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function getOrCreateClientSessionId(): string {
  try {
    const existing = localStorage.getItem('gavilan_v2_client_id')
    if (existing && /^[A-Za-z0-9_-]{8,64}$/.test(existing)) return existing
    const generated = `v2web_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
    localStorage.setItem('gavilan_v2_client_id', generated)
    return generated
  } catch {
    return `v2web_${Date.now().toString(36)}`
  }
}

export function useCustomerAppV2(props: CustomerAppV2ProProps) {
  const {
    externalStage,
    externalStoryIndex,
    externalTab,
    externalAuthSheet,
    externalLoggedInDemo,
    controlTick,
  } = props

  const { language, setLanguage, t } = useLanguage()
  const lang: 'es' | 'en' = language === 'en' ? 'en' : 'es'

  // Live 60s clock ticker for America/Los_Angeles open/closed & status bar time
  const [nowMs, setNowMs] = useState<number>(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])
  const nowDate = useMemo(() => new Date(nowMs), [nowMs])
  const statusClock = useMemo(() => getLaStatusClock(nowDate), [nowDate])
  const greetingText = useMemo(() => getLaTimeGreeting(lang, nowDate), [lang, nowDate])

  // Navigation & Stages
  const [stage, setStage] = useState<V2Stage>(externalStage ?? 'stories')
  const [storyIndex, setStoryIndex] = useState<number>(externalStoryIndex ?? 0)
  const [activeTab, setActiveTab] = useState<MainTab>(externalTab ?? 'home')
  const [authSheet, setAuthSheet] = useState<V2AuthSheet>(externalAuthSheet ?? null)

  // Stores state (instant local V2_STORES + background live /api/mobile/stores hydration)
  const [stores, setStores] = useState<V2AuthoritativeStore[]>(V2_STORES)
  const [selectedStoreId, setSelectedStoreId] = useState<number>(1)
  const [fulfillmentMode, setFulfillmentMode] = useState<FulfillmentMode>('pickup')
  const [selectedMenuCategory, setSelectedMenuCategory] = useState<string>('ALL')
  const [storeSearchQuery, setStoreSearchQuery] = useState('')
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [isLocating, setIsLocating] = useState(false)
  const [gpsError, setGpsError] = useState<string | null>(null)

  // Real persisted user state (completely separate from Screen #12 Demo Preview)
  const [realLoggedUser, setRealLoggedUser] = useState<V2UserProfile | null>(null)
  const [v2AccessToken, setV2AccessToken] = useState<string | null>(null)
  const [demoSignedOut, setDemoSignedOut] = useState(false)

  const isDemoPreview = Boolean(externalLoggedInDemo)
  const effectiveLoggedUser = useMemo<V2UserProfile | null>(() => {
    if (isDemoPreview) {
      return demoSignedOut ? null : DEMO_PREVIEW_USER
    }
    return realLoggedUser
  }, [demoSignedOut, isDemoPreview, realLoggedUser])

  // Favorites state (both showcase dish IDs & live server favorites)
  const [favoriteDishIds, setFavoriteDishIds] = useState<string[]>([])
  const [serverFavorites, setServerFavorites] = useState<ServerFavoriteOrder[]>([])
  const [favFilter, setFavFilter] = useState<'saved' | 'all'>('all')
  const [favoritesSyncing, setFavoritesSyncing] = useState(false)
  const [favoritesError, setFavoritesError] = useState<string | null>(null)

  // Auth OTP modal state
  const [authMethod, setAuthMethod] = useState<'email' | 'sms'>('email')
  const [phoneInput, setPhoneInput] = useState('')
  const [otpInput, setOtpInput] = useState('')
  const [otpStep, setOtpStep] = useState<1 | 2>(1)
  const [authLoading, setAuthLoading] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)

  // Modals & Transition state
  const [storeModalOpen, setStoreModalOpen] = useState(false)
  const [mapModalOpen, setMapModalOpen] = useState(false)
  const [mapFocusedStoreId, setMapFocusedStoreId] = useState<number>(1)
  const [mapTheme, setMapTheme] = useState<'dark' | 'light' | 'satellite'>('dark')
  const [mapViewAll, setMapViewAll] = useState(false)
  const [mapSdkFailed, setMapSdkFailed] = useState(false)
  const [brandLoader, setBrandLoader] = useState<{
    visible: boolean
    label: string
    done: boolean
  }>({ visible: false, label: '', done: false })

  // Live Menu state (/api/mobile/menu)
  const [menuLoading, setMenuLoading] = useState(false)
  const [menuError, setMenuError] = useState<string | null>(null)
  const [liveCategories, setLiveCategories] = useState<Record<string, LiveMenuItem[]>>({})
  const [liveCategoryOrder, setLiveCategoryOrder] = useState<string[]>([])
  const [liveModifierGroups, setLiveModifierGroups] = useState<Record<string, LiveModifierGroup>>({})
  const [catalogMetadata, setCatalogMetadata] = useState<LiveCatalogMetadata | null>(null)
  const [customizingItem, setCustomizingItem] = useState<LiveMenuItem | null>(null)

  // Live Bag / Cart & Quote & Storefront Checkout & Delivery Address state
  const [bagItems, setBagItems] = useState<V2BagLine[]>([])
  const [tipPercent, setTipPercent] = useState<number>(0)
  const [quote, setQuote] = useState<QuoteBreakdown>({
    status: 'idle',
    subtotal: 0,
    taxAmount: 0,
    serviceChargeTotal: 0,
    deliveryFee: 0,
    tipAmount: 0,
    discountAmount: 0,
    totalAmount: 0,
  })
  const [deliveryAddress, setDeliveryAddress] = useState<DeliveryAddressDraft>({
    formattedAddress: '',
    street: '',
    apartmentNumber: '',
    city: '',
    state: 'CA',
    zipCode: '',
    instructions: '',
  })
  const [addressQuery, setAddressQuery] = useState('')
  const [addressSuggestions, setAddressSuggestions] = useState<AddressSuggestion[]>([])
  const [addressLoading, setAddressLoading] = useState(false)
  const [storefrontSession, setStorefrontSession] = useState<StorefrontSessionResult>({
    status: 'idle',
  })

  // Live Order Status Lookup state
  const [orderLookupId, setOrderLookupId] = useState('')
  const [orderLookupLoading, setOrderLookupLoading] = useState(false)
  const [orderLookupError, setOrderLookupError] = useState<string | null>(null)
  const [trackedOrderStatus, setTrackedOrderStatus] = useState<ActiveOrderStatus | null>(null)

  // Order Sessions & Wrapper Controls
  const [orderSessionActive, setOrderSessionActive] = useState(false)
  const [wrapperResetModalOpen, setWrapperResetModalOpen] = useState(false)
  const [pendingModeSwitch, setPendingModeSwitch] = useState<FulfillmentMode | null>(null)
  const [wrapperNotice, setWrapperNotice] = useState<string | null>(null)
  const [wrapperWarning, setWrapperWarning] = useState<string | null>(null)
  const [recentOrderSessions, setRecentOrderSessions] = useState<OrderSessionRecord[]>([])

  // Account Edit & Delete state (explicit inline errors — never silent)
  const [isEditingProfile, setIsEditingProfile] = useState(false)
  const [editFirstName, setEditFirstName] = useState('')
  const [editLastName, setEditLastName] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [editPhone, setEditPhone] = useState('')
  const [savingProfile, setSavingProfile] = useState(false)
  const [profileNotice, setProfileNotice] = useState<string | null>(null)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [v2DeleteModalOpen, setV2DeleteModalOpen] = useState(false)
  const [deletingV2Account, setDeletingV2Account] = useState(false)
  const [deleteAccountError, setDeleteAccountError] = useState<string | null>(null)

  const bagHydratedRef = useRef(false)

  // Sync external Tester Drawer props cleanly without touching real session or localStorage
  useEffect(() => {
    if (externalStage) setStage(externalStage)
    if (typeof externalStoryIndex === 'number') setStoryIndex(externalStoryIndex)
    if (externalTab) setActiveTab(externalTab)
    if (externalAuthSheet !== undefined) setAuthSheet(externalAuthSheet)
    if (externalLoggedInDemo) {
      setDemoSignedOut(false)
    }
  }, [
    externalStage,
    externalStoryIndex,
    externalTab,
    externalAuthSheet,
    externalLoggedInDemo,
    controlTick,
  ])

  // Load persisted non-demo localStorage state once on mount
  useEffect(() => {
    try {
      const rawSessions = localStorage.getItem('gavilan_v2_order_sessions')
      if (rawSessions) {
        const parsed = JSON.parse(rawSessions)
        if (Array.isArray(parsed)) setRecentOrderSessions(parsed.slice(0, 6))
      }

      const savedProfile = localStorage.getItem('gavilan_v2_user_profile')
      let hasSavedProfile = false
      if (savedProfile) {
        const parsedProfile = JSON.parse(savedProfile) as V2UserProfile
        if (parsedProfile && parsedProfile.firstName) {
          setRealLoggedUser(parsedProfile)
          hasSavedProfile = true
        }
      }

      const savedToken = localStorage.getItem('gavilan_v2_access_token')
      if (savedToken) setV2AccessToken(savedToken)

      const savedOnboardingSeen = localStorage.getItem('gavilan_v2_onboarding_seen')
      if ((savedOnboardingSeen === '1' || hasSavedProfile) && !externalStage) {
        setStage('main')
      }

      const savedFavorites = localStorage.getItem('gavilan_v2_favorite_dishes')
      if (savedFavorites) {
        const parsedFavs = JSON.parse(savedFavorites)
        if (Array.isArray(parsedFavs)) {
          const normalized = Array.from(
            new Set(
              parsedFavs
                .filter((id): id is string => typeof id === 'string')
                .filter((id) => SIGNATURE_DISHES.some((d) => d.id === id))
            )
          )
          setFavoriteDishIds(normalized)
        }
      }

      const savedStoreId = localStorage.getItem('gavilan_v2_selected_store_id')
      const resolvedStoreId =
        savedStoreId && V2_STORES.some((s) => s.id === Number(savedStoreId))
          ? Number(savedStoreId)
          : 1
      setSelectedStoreId(resolvedStoreId)

      const savedMode = localStorage.getItem('gavilan_v2_fulfillment_mode')
      if (savedMode === 'pickup' || savedMode === 'delivery') {
        setFulfillmentMode(savedMode)
      }

      const rawBag = localStorage.getItem('gavilan_v2_bag_v1')
      if (rawBag) {
        const parsedBag = JSON.parse(rawBag) as { storeId?: number; items?: V2BagLine[] }
        if (parsedBag?.storeId === resolvedStoreId && Array.isArray(parsedBag.items)) {
          setBagItems(parsedBag.items)
        }
      }
    } catch {
      // Ignore storage read errors in restricted WebViews
    } finally {
      bagHydratedRef.current = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Hydrate 15 stores from backend /api/mobile/stores while preserving detailed schedules
  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/mobile/stores', { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data || !Array.isArray(data.stores)) return
        setStores((prev) =>
          prev.map((localStore) => {
            const remote = data.stores.find((r: Record<string, unknown>) => Number(r.id) === localStore.id)
            if (!remote) return localStore
            const remoteUrl =
              typeof remote.toastOrderingUrl === 'string' && remote.toastOrderingUrl
                ? remote.toastOrderingUrl
                : localStore.toastOrderingUrl
            return {
              ...localStore,
              name: typeof remote.name === 'string' && remote.name ? remote.name : localStore.name,
              address:
                typeof remote.address === 'string' && remote.address ? remote.address : localStore.address,
              city: typeof remote.city === 'string' && remote.city ? remote.city : localStore.city,
              phone: typeof remote.phone === 'string' && remote.phone ? remote.phone : localStore.phone,
              latitude:
                typeof remote.latitude === 'number' && Number.isFinite(remote.latitude)
                  ? remote.latitude
                  : localStore.latitude,
              longitude:
                typeof remote.longitude === 'number' && Number.isFinite(remote.longitude)
                  ? remote.longitude
                  : localStore.longitude,
              toastOrderingUrl: remoteUrl,
              onlineOrderingUrl: remoteUrl,
            }
          })
        )
      })
      .catch(() => {
        // Fallback smoothly to canonical V2_STORES
      })
    return () => controller.abort()
  }, [])

  // Persist preference updates ONLY when not isolated in external Demo #12 preview
  useEffect(() => {
    try {
      localStorage.setItem('gavilan_v2_selected_store_id', String(selectedStoreId))
    } catch {
      // ignore
    }
  }, [selectedStoreId])

  useEffect(() => {
    try {
      localStorage.setItem('gavilan_v2_fulfillment_mode', fulfillmentMode)
    } catch {
      // ignore
    }
  }, [fulfillmentMode])

  useEffect(() => {
    if (stage === 'main' && !isDemoPreview) {
      try {
        localStorage.setItem('gavilan_v2_onboarding_seen', '1')
      } catch {
        // ignore
      }
    }
  }, [isDemoPreview, stage])

  // Persist local bag cleanly
  useEffect(() => {
    if (!bagHydratedRef.current) return
    try {
      localStorage.setItem(
        'gavilan_v2_bag_v1',
        JSON.stringify({ storeId: selectedStoreId, items: bagItems })
      )
    } catch {
      // ignore
    }
  }, [bagItems, selectedStoreId])

  const storesWithDistance = useMemo<V2StoreWithDistance[]>(() => {
    const mapped = stores.map((st) => ({
      ...st,
      distanceMiles: userCoords
        ? calculateDistanceMiles(userCoords.lat, userCoords.lng, st.latitude, st.longitude)
        : null,
    }))
    if (userCoords) {
      return [...mapped].sort((a, b) => (a.distanceMiles ?? 999) - (b.distanceMiles ?? 999))
    }
    return mapped
  }, [stores, userCoords])

  const currentStore = useMemo(() => {
    return stores.find((s) => s.id === selectedStoreId) || stores[0]
  }, [selectedStoreId, stores])

  const currentStoreStatus = useMemo(
    () => getStoreStatusInLA(currentStore, lang, nowDate),
    [currentStore, lang, nowDate]
  )

  const mapFocusedStore = useMemo<V2StoreWithDistance>(() => {
    return (
      storesWithDistance.find((s) => s.id === mapFocusedStoreId) ||
      storesWithDistance.find((s) => s.id === currentStore.id) ||
      storesWithDistance[0]
    )
  }, [currentStore.id, mapFocusedStoreId, storesWithDistance])

  const mapFocusedStoreStatus = useMemo(
    () => getStoreStatusInLA(mapFocusedStore, lang, nowDate),
    [lang, mapFocusedStore, nowDate]
  )

  const currentOrderOnlineUrl = useMemo(() => {
    const base = currentStore.toastOrderingUrl.replace(/\/+$/, '')
    const param = fulfillmentMode === 'delivery' ? 'delivery=true' : 'pickup=true'
    return `${base}/?hideModal=true&${param}`
  }, [currentStore.toastOrderingUrl, fulfillmentMode])

  // Fetch live Toast POS / curated store menu whenever active store or mode changes
  useEffect(() => {
    const controller = new AbortController()
    const channelParam = fulfillmentMode === 'delivery' ? 'DELIVERY' : 'PICKUP'
    setMenuLoading(true)
    setMenuError(null)
    setSelectedMenuCategory('ALL')

    fetch(`/api/mobile/menu?storeId=${currentStore.id}&channel=${channelParam}`, {
      signal: controller.signal,
    })
      .then(async (res) => {
        const json = await res.json().catch(() => null)
        if (!res.ok || !json) {
          throw new Error(json?.error || `HTTP ${res.status}`)
        }
        return json
      })
      .then((data) => {
        setLiveCategories(
          typeof data.categories === 'object' && data.categories !== null ? data.categories : {}
        )
        setLiveCategoryOrder(Array.isArray(data.categoryOrder) ? data.categoryOrder : [])
        setLiveModifierGroups(
          typeof data.modifierGroups === 'object' && data.modifierGroups !== null
            ? data.modifierGroups
            : {}
        )
        setCatalogMetadata(data.catalogMetadata || null)
      })
      .catch((err) => {
        if (controller.signal.aborted) return
        setLiveCategories({})
        setLiveCategoryOrder([])
        setCatalogMetadata(null)
        setMenuError(err instanceof Error ? err.message : 'Catalog error')
      })
      .finally(() => {
        if (!controller.signal.aborted) setMenuLoading(false)
      })

    return () => controller.abort()
  }, [currentStore.id, fulfillmentMode])

  // Load cloud cart & cloud favorites when a real authenticated JWT is active
  useEffect(() => {
    if (!v2AccessToken || isDemoPreview) {
      setServerFavorites([])
      return
    }
    const controller = new AbortController()

    fetch('/api/mobile/favorites', {
      headers: { Authorization: `Bearer ${v2AccessToken}` },
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && Array.isArray(data.favorites)) {
          setServerFavorites(data.favorites)
        }
      })
      .catch(() => {})

    fetch('/api/mobile/cart', {
      headers: { Authorization: `Bearer ${v2AccessToken}` },
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const cloudItems = data?.cart?.items
        const cloudStoreId = Number(data?.cart?.storeId)
        if (Array.isArray(cloudItems) && cloudItems.length > 0 && cloudStoreId === currentStore.id) {
          const mapped: V2BagLine[] = cloudItems.map((ci: Record<string, unknown>, idx: number) => ({
            lineId: `cloud-${idx}-${String(ci.itemGuid || '')}`,
            itemGuid: String(ci.itemGuid || ''),
            name: String(ci.name || ''),
            unitPrice: Number(ci.unitPrice ?? ci.price ?? 0),
            quantity: Math.max(1, Number(ci.quantity ?? 1)),
            modifiers: Array.isArray(ci.modifiers)
              ? (ci.modifiers as Array<Record<string, unknown>>).map((m) => ({
                  optionGroupGuid: String(m.optionGroupGuid || ''),
                  guid: String(m.guid || ''),
                  name: String(m.name || ''),
                  price: Number(m.price ?? 0),
                }))
              : [],
            specialInstructions:
              typeof ci.specialInstructions === 'string' ? ci.specialInstructions : undefined,
          }))
          setBagItems(mapped)
        }
      })
      .catch(() => {})

    return () => controller.abort()
  }, [currentStore.id, isDemoPreview, v2AccessToken])

  // Sync bag changes back to /api/mobile/cart for authenticated users
  const syncBagToServer = useCallback(
    async (nextBag: V2BagLine[], storeId: number) => {
      if (!v2AccessToken || isDemoPreview) return
      try {
        if (nextBag.length === 0) {
          await fetch('/api/mobile/cart', {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${v2AccessToken}` },
          })
          return
        }
        await fetch('/api/mobile/cart', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${v2AccessToken}`,
          },
          body: JSON.stringify({
            storeId,
            items: nextBag.map((line) => ({
              itemGuid: line.itemGuid,
              name: line.name,
              unitPrice: line.unitPrice,
              quantity: line.quantity,
              modifiers: line.modifiers,
              specialInstructions: line.specialInstructions,
            })),
          }),
        })
      } catch {
        // Keep local bag resilient
      }
    },
    [isDemoPreview, v2AccessToken]
  )

  const bagSubtotal = useMemo(() => {
    return Number(
      bagItems
        .reduce((sum, line) => {
          const modsSum = line.modifiers.reduce((ms, m) => ms + (Number(m.price) || 0), 0)
          return sum + (line.unitPrice + modsSum) * line.quantity
        }, 0)
        .toFixed(2)
    )
  }, [bagItems])

  const bagItemCount = useMemo(
    () => bagItems.reduce((sum, line) => sum + line.quantity, 0),
    [bagItems]
  )

  const tipAmount = useMemo(
    () => Number(((bagSubtotal * tipPercent) / 100).toFixed(2)),
    [bagSubtotal, tipPercent]
  )

  // Live Financial Quote against POST /api/mobile/order/quote
  useEffect(() => {
    if (bagItems.length === 0) {
      setQuote({
        status: 'idle',
        subtotal: 0,
        taxAmount: 0,
        serviceChargeTotal: 0,
        deliveryFee: 0,
        tipAmount: 0,
        discountAmount: 0,
        totalAmount: 0,
      })
      return
    }

    const fallbackTotal = Number((bagSubtotal + tipAmount).toFixed(2))
    const allHaveUuids = bagItems.every((line) => UUID_PATTERN.test(line.itemGuid))

    if (!allHaveUuids) {
      setQuote({
        status: 'idle',
        subtotal: bagSubtotal,
        taxAmount: 0,
        serviceChargeTotal: 0,
        deliveryFee: 0,
        tipAmount,
        discountAmount: 0,
        totalAmount: fallbackTotal,
        nonPayableEstimate: true,
      })
      return
    }

    const controller = new AbortController()
    const timer = setTimeout(async () => {
      setQuote((prev) => ({
        ...prev,
        status: 'loading',
        subtotal: bagSubtotal,
        tipAmount,
        totalAmount: fallbackTotal,
      }))
      try {
        const res = await fetch('/api/mobile/order/quote', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(v2AccessToken && !isDemoPreview
              ? { Authorization: `Bearer ${v2AccessToken}` }
              : {}),
          },
          signal: controller.signal,
          body: JSON.stringify({
            storeId: currentStore.id,
            channel: fulfillmentMode === 'delivery' ? 'DELIVERY' : 'PICKUP',
            tipAmount,
            items: bagItems.map((line) => ({
              guid: line.itemGuid,
              qty: line.quantity,
              modifiers: line.modifiers.map((m) => ({
                guid: m.guid,
                optionGroupGuid: m.optionGroupGuid,
              })),
              specialInstructions: line.specialInstructions,
            })),
          }),
        })
        const data = await res.json().catch(() => null)
        if (!data) throw new Error('Invalid quote response')

        if (res.ok && data.ok === true && data.financials) {
          setQuote({
            status: 'quoted',
            quoteId: data.quoteId ?? null,
            subtotal: Number(data.financials.subtotal ?? bagSubtotal),
            taxAmount: Number(data.financials.taxAmount ?? 0),
            serviceChargeTotal: Number(data.financials.serviceChargeTotal ?? 0),
            deliveryFee: Number(data.financials.deliveryFee ?? 0),
            tipAmount: Number(data.financials.tipAmount ?? tipAmount),
            discountAmount: Number(data.financials.discountAmount ?? 0),
            totalAmount: Number(data.financials.totalAmount ?? fallbackTotal),
          })
          return
        }

        if (data.code === 'TOAST_SCOPE_BLOCKED') {
          const estSub = Number(data.estimatedReference?.catalogSubtotal ?? bagSubtotal)
          setQuote({
            status: 'blocked_external',
            quoteId: null,
            subtotal: estSub,
            taxAmount: 0,
            serviceChargeTotal: 0,
            deliveryFee: 0,
            tipAmount,
            discountAmount: 0,
            totalAmount: Number((estSub + tipAmount).toFixed(2)),
            nonPayableEstimate: true,
            message: data.estimatedReference?.disclaimer || null,
          })
          return
        }

        if (data.code === 'DELIVERY_DISABLED') {
          setQuote({
            status: 'delivery_disabled',
            subtotal: bagSubtotal,
            taxAmount: 0,
            serviceChargeTotal: 0,
            deliveryFee: 0,
            tipAmount,
            discountAmount: 0,
            totalAmount: fallbackTotal,
            nonPayableEstimate: true,
            message: data.error || null,
          })
          return
        }

        setQuote({
          status: 'error',
          subtotal: bagSubtotal,
          taxAmount: 0,
          serviceChargeTotal: 0,
          deliveryFee: 0,
          tipAmount,
          discountAmount: 0,
          totalAmount: fallbackTotal,
          nonPayableEstimate: true,
          message: data.error || null,
        })
      } catch {
        if (!controller.signal.aborted) {
          setQuote({
            status: 'idle',
            subtotal: bagSubtotal,
            taxAmount: 0,
            serviceChargeTotal: 0,
            deliveryFee: 0,
            tipAmount,
            discountAmount: 0,
            totalAmount: fallbackTotal,
            nonPayableEstimate: true,
          })
        }
      }
    }, 320)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [bagItems, bagSubtotal, currentStore.id, fulfillmentMode, isDemoPreview, tipAmount, v2AccessToken])

  // Debounced Delivery Address Autocomplete (/api/mobile/address/autocomplete)
  useEffect(() => {
    if (fulfillmentMode !== 'delivery') {
      setAddressSuggestions([])
      return
    }
    const q = addressQuery.trim()
    if (q.length < 3) {
      setAddressSuggestions([])
      return
    }
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      setAddressLoading(true)
      try {
        const lat = userCoords?.lat ?? currentStore.latitude
        const lng = userCoords?.lng ?? currentStore.longitude
        const res = await fetch(
          `/api/mobile/address/autocomplete?q=${encodeURIComponent(q)}&lat=${lat}&lng=${lng}`,
          { signal: controller.signal }
        )
        const data = await res.json().catch(() => null)
        if (res.ok && data && Array.isArray(data.suggestions)) {
          setAddressSuggestions(data.suggestions)
        } else {
          setAddressSuggestions([])
        }
      } catch {
        if (!controller.signal.aborted) setAddressSuggestions([])
      } finally {
        if (!controller.signal.aborted) setAddressLoading(false)
      }
    }, 280)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [addressQuery, currentStore.latitude, currentStore.longitude, fulfillmentMode, userCoords])

  const showTransientWrapperNotice = useCallback((msg: string) => {
    setWrapperNotice(msg)
    setTimeout(() => {
      setWrapperNotice((prev) => (prev === msg ? null : prev))
    }, 3400)
  }, [])

  const showTransientWrapperWarning = useCallback((msg: string) => {
    setWrapperWarning(msg)
    setTimeout(() => {
      setWrapperWarning((prev) => (prev === msg ? null : prev))
    }, 4500)
  }, [])

  const triggerBrandTransition = useCallback((label: string, callback: () => void) => {
    setBrandLoader({ visible: true, label, done: false })
    setTimeout(() => {
      setBrandLoader({ visible: true, label, done: true })
    }, 360)
    setTimeout(() => {
      callback()
      setBrandLoader({ visible: false, label: '', done: false })
    }, 720)
  }, [])

  // Add item to bag (direct or from ProductCustomizerModal)
  const addLineToBag = useCallback(
    (line: Omit<V2BagLine, 'lineId'>) => {
      const normalizedKey = `${line.itemGuid}::${line.modifiers
        .map((m) => `${m.optionGroupGuid}:${m.guid}`)
        .sort()
        .join(',')}::${(line.specialInstructions || '').trim()}`

      setBagItems((prev) => {
        const existingIdx = prev.findIndex((p) => {
          const pk = `${p.itemGuid}::${p.modifiers
            .map((m) => `${m.optionGroupGuid}:${m.guid}`)
            .sort()
            .join(',')}::${(p.specialInstructions || '').trim()}`
          return pk === normalizedKey
        })
        let next: V2BagLine[]
        if (existingIdx >= 0) {
          next = prev.map((p, idx) =>
            idx === existingIdx ? { ...p, quantity: Math.min(99, p.quantity + line.quantity) } : p
          )
        } else {
          next = [...prev, { ...line, lineId: `line-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` }]
        }
        syncBagToServer(next, currentStore.id)
        return next
      })

      setOrderSessionActive(true)
      setStorefrontSession({ status: 'idle' })
      showTransientWrapperNotice(`${line.name} — ${t('mobile_legal.v2_customizer_added_toast')}`)
    },
    [currentStore.id, showTransientWrapperNotice, syncBagToServer, t]
  )

  const updateBagLineQuantity = useCallback(
    (lineId: string, delta: number) => {
      setBagItems((prev) => {
        const next = prev
          .map((item) =>
            item.lineId === lineId ? { ...item, quantity: item.quantity + delta } : item
          )
          .filter((item) => item.quantity > 0)
        syncBagToServer(next, currentStore.id)
        return next
      })
    },
    [currentStore.id, syncBagToServer]
  )

  const clearBag = useCallback(() => {
    setBagItems([])
    syncBagToServer([], currentStore.id)
    setStorefrontSession({ status: 'idle' })
  }, [currentStore.id, syncBagToServer])

  // Select store safely (clears incompatible store cart lines cleanly)
  const selectStoreSafely = useCallback(
    (nextStoreId: number) => {
      if (nextStoreId !== selectedStoreId) {
        setBagItems([])
        syncBagToServer([], nextStoreId)
        setOrderSessionActive(false)
        setStorefrontSession({ status: 'idle' })
      }
      setSelectedStoreId(nextStoreId)
    },
    [selectedStoreId, syncBagToServer]
  )

  // Launch verified external order.online (or DoorDash Storefront session URL) safely
  const openSafeExternalUrl = useCallback(
    (rawUrl: string): boolean => {
      if (!isAllowedExternalOrderUrl(rawUrl)) {
        showTransientWrapperWarning(
          `${t('mobile_legal.v2_toast_scope_blocked_title')}: ${t('mobile_legal.v2_toast_scope_blocked_desc')}`
        )
        return false
      }
      if (typeof window !== 'undefined') {
        window.open(rawUrl, '_blank', 'noopener,noreferrer')
      }
      return true
    },
    [showTransientWrapperWarning, t]
  )

  const launchWrappedOrderOnline = useCallback(
    (overrideStore?: V2AuthoritativeStore, overrideMode?: FulfillmentMode) => {
      const targetStore =
        overrideStore && typeof overrideStore === 'object' && 'toastOrderingUrl' in overrideStore
          ? overrideStore
          : currentStore
      const targetMode: FulfillmentMode =
        overrideMode === 'pickup' || overrideMode === 'delivery' ? overrideMode : fulfillmentMode

      if (targetStore.id !== selectedStoreId) {
        selectStoreSafely(targetStore.id)
      }
      if (targetMode !== fulfillmentMode) {
        setFulfillmentMode(targetMode)
      }

      const base = targetStore.toastOrderingUrl.replace(/\/+$/, '')
      const param = targetMode === 'delivery' ? 'delivery=true' : 'pickup=true'
      const targetUrl = `${base}/?hideModal=true&${param}`
      if (!openSafeExternalUrl(targetUrl)) return

      setOrderSessionActive(true)
      const entry: OrderSessionRecord = {
        id: `${targetStore.id}-${Date.now()}`,
        storeId: targetStore.id,
        storeName: targetStore.name,
        cityTitle: targetStore.cityTitle,
        crossStreets: targetStore.crossStreets,
        address: targetStore.address,
        phone: targetStore.phone,
        mode: targetMode,
        url: targetUrl,
        openedAt: new Date().toISOString(),
      }
      setRecentOrderSessions((prev) => {
        const next = [
          entry,
          ...prev.filter((item) => item.storeId !== targetStore.id || item.mode !== targetMode),
        ].slice(0, 6)
        if (!isDemoPreview) {
          try {
            localStorage.setItem('gavilan_v2_order_sessions', JSON.stringify(next))
          } catch {
            // ignore
          }
        }
        return next
      })
    },
    [
      currentStore,
      fulfillmentMode,
      isDemoPreview,
      openSafeExternalUrl,
      selectStoreSafely,
      selectedStoreId,
    ]
  )

  // Camino 1 Storefront Checkout Session (POST /api/mobile/doordash/checkout-session)
  const handleStartStorefrontCheckout = useCallback(async () => {
    if (bagItems.length === 0) {
      launchWrappedOrderOnline(currentStore, fulfillmentMode)
      return
    }
    if (fulfillmentMode === 'delivery' && !deliveryAddress.street.trim()) {
      setStorefrontSession({
        status: 'error',
        message: t('mobile_legal.v2_delivery_address_required'),
      })
      return
    }

    setStorefrontSession({ status: 'creating' })
    const clientId = getOrCreateClientSessionId()
    const idempotencyKey = `v2chk_${currentStore.id}_${Date.now().toString(36)}`

    try {
      const res = await fetch('/api/mobile/doordash/checkout-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-gavilan-client': clientId,
          ...(v2AccessToken && !isDemoPreview ? { Authorization: `Bearer ${v2AccessToken}` } : {}),
        },
        body: JSON.stringify({
          storeId: currentStore.id,
          fulfillmentType: fulfillmentMode === 'delivery' ? 'DELIVERY' : 'PICKUP',
          catalog: {
            source: catalogMetadata?.source || 'toast_menu_v3',
            menuId: catalogMetadata?.menuId,
          },
          idempotencyKey,
          lines: bagItems.map((line) => ({
            itemId: line.itemGuid,
            quantity: line.quantity,
            specialInstructions: line.specialInstructions,
            extras: line.modifiers.map((m) => ({
              optionId: m.guid,
              groupId: m.optionGroupGuid,
              quantity: 1,
            })),
          })),
          ...(fulfillmentMode === 'delivery'
            ? {
                delivery: {
                  formattedAddress: deliveryAddress.formattedAddress || deliveryAddress.street,
                  street: deliveryAddress.street,
                  city: deliveryAddress.city,
                  state: deliveryAddress.state,
                  zipCode: deliveryAddress.zipCode,
                  apartmentNumber: deliveryAddress.apartmentNumber || undefined,
                  instructions: deliveryAddress.instructions || undefined,
                },
              }
            : {}),
        }),
      })
      const data = await res.json().catch(() => ({}))

      if (res.ok && typeof data.checkoutUrl === 'string' && data.checkoutUrl) {
        setStorefrontSession({
          status: 'ready',
          orderSessionId: data.orderSessionId ?? null,
          checkoutUrl: data.checkoutUrl,
        })
        showTransientWrapperNotice(t('mobile_legal.v2_checkout_session_ready_toast'))
        openSafeExternalUrl(data.checkoutUrl)
        return
      }

      if (
        res.status === 409 ||
        res.status === 501 ||
        res.status === 503 ||
        data.code === 'STOREFRONT_DISABLED' ||
        data.code === 'DOORDASH_STOREFRONT_DISABLED'
      ) {
        setStorefrontSession({
          status: 'storefront_disabled',
          message: t('mobile_legal.v2_checkout_storefront_disabled'),
        })
        return
      }

      setStorefrontSession({
        status: 'error',
        message: data.error || t('mobile_legal.v2_checkout_error_generic'),
      })
    } catch {
      setStorefrontSession({
        status: 'error',
        message: t('mobile_legal.v2_checkout_error_generic'),
      })
    }
  }, [
    bagItems,
    catalogMetadata?.menuId,
    catalogMetadata?.source,
    currentStore,
    deliveryAddress,
    fulfillmentMode,
    isDemoPreview,
    launchWrappedOrderOnline,
    openSafeExternalUrl,
    showTransientWrapperNotice,
    t,
    v2AccessToken,
  ])

  const handleLookupOrderStatus = useCallback(
    async (e?: React.FormEvent) => {
      if (e) e.preventDefault()
      const trimmed = orderLookupId.trim()
      if (!trimmed || !v2AccessToken || isDemoPreview) return
      setOrderLookupLoading(true)
      setOrderLookupError(null)
      try {
        const res = await fetch(
          `/api/mobile/order/status?orderId=${encodeURIComponent(trimmed)}`,
          {
            headers: { Authorization: `Bearer ${v2AccessToken}` },
          }
        )
        const data = await res.json().catch(() => ({}))
        if (!res.ok || !data.order) {
          throw new Error(data.error || t('mobile_legal.v2_orders_lookup_empty'))
        }
        setTrackedOrderStatus({
          id: String(data.order.id),
          storeId: Number(data.order.storeId),
          toastOrderGuid: data.order.toastOrderGuid || null,
          kitchenStatus: String(data.order.kitchenStatus || 'HOLDING'),
          paymentStatus: String(data.order.paymentStatus || 'PENDING'),
          deliveryStatus: String(data.order.deliveryStatus || 'AWAITING_ARRIVAL'),
          channel: data.order.channel === 'DELIVERY' ? 'DELIVERY' : 'PICKUP',
          totalAmount: Number(data.order.total_amount ?? 0),
          etaMinutes:
            typeof data.order.eta_minutes === 'number' ? data.order.eta_minutes : null,
          deliveryAddress: data.order.deliveryAddress || null,
          updatedAt: String(data.order.updated_at || new Date().toISOString()),
        })
      } catch (err) {
        setTrackedOrderStatus(null)
        setOrderLookupError(
          err instanceof Error ? err.message : t('mobile_legal.v2_orders_lookup_empty')
        )
      } finally {
        setOrderLookupLoading(false)
      }
    },
    [isDemoPreview, orderLookupId, t, v2AccessToken]
  )

  const handleSelectAddressSuggestion = useCallback((sugg: AddressSuggestion) => {
    setAddressQuery(sugg.label)
    setDeliveryAddress((prev) => ({
      ...prev,
      formattedAddress: sugg.label,
      street: sugg.street,
      apartmentNumber: sugg.aptSuite || prev.apartmentNumber,
      city: sugg.city,
      state: sugg.state || 'CA',
      zipCode: sugg.zipCode,
    }))
    setAddressSuggestions([])
  }, [])

  const toggleFavoriteDish = useCallback(
    (dishId: string, e?: React.MouseEvent) => {
      if (e) e.stopPropagation()
      setFavoriteDishIds((prev) => {
        const next = prev.includes(dishId)
          ? prev.filter((id) => id !== dishId)
          : [...prev, dishId]
        if (!isDemoPreview) {
          try {
            localStorage.setItem('gavilan_v2_favorite_dishes', JSON.stringify(next))
          } catch {
            // ignore
          }
        }
        return next
      })
    },
    [isDemoPreview]
  )

  const saveLiveItemToServerFavorites = useCallback(
    async (item: LiveMenuItem) => {
      if (!v2AccessToken || isDemoPreview) return
      setFavoritesSyncing(true)
      setFavoritesError(null)
      try {
        const res = await fetch('/api/mobile/favorites', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${v2AccessToken}`,
          },
          body: JSON.stringify({
            storeId: currentStore.id,
            name: item.name.slice(0, 100),
            items: [
              {
                itemGuid: item.guid,
                name: item.name,
                price: Number(item.price || 0),
                quantity: 1,
                modifiers: [],
              },
            ],
          }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok || !data.favorite) {
          throw new Error(data.error || t('mobile_legal.v2_fav_sync_error'))
        }
        setServerFavorites((prev) => [data.favorite, ...prev])
      } catch (err) {
        setFavoritesError(err instanceof Error ? err.message : t('mobile_legal.v2_fav_sync_error'))
      } finally {
        setFavoritesSyncing(false)
      }
    },
    [currentStore.id, isDemoPreview, t, v2AccessToken]
  )

  const deleteServerFavorite = useCallback(
    async (favoriteId: string) => {
      if (!v2AccessToken || isDemoPreview) return
      setFavoritesSyncing(true)
      setFavoritesError(null)
      try {
        const res = await fetch(`/api/mobile/favorites?id=${encodeURIComponent(favoriteId)}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${v2AccessToken}` },
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          throw new Error(data.error || t('mobile_legal.v2_fav_sync_error'))
        }
        setServerFavorites((prev) => prev.filter((f) => f.id !== favoriteId))
      } catch (err) {
        setFavoritesError(err instanceof Error ? err.message : t('mobile_legal.v2_fav_sync_error'))
      } finally {
        setFavoritesSyncing(false)
      }
    },
    [isDemoPreview, t, v2AccessToken]
  )

  const handleClearRecentOrderSessions = useCallback(() => {
    setRecentOrderSessions([])
    if (!isDemoPreview) {
      try {
        localStorage.removeItem('gavilan_v2_order_sessions')
      } catch {
        // ignore
      }
    }
    showTransientWrapperNotice(t('mobile_legal.v2_history_cleared_toast'))
  }, [isDemoPreview, showTransientWrapperNotice, t])

  const handleSelectOrderMode = useCallback(
    (nextMode: FulfillmentMode) => {
      if (nextMode === fulfillmentMode) return
      if (orderSessionActive || bagItems.length > 0) {
        setPendingModeSwitch(nextMode)
        return
      }
      setFulfillmentMode(nextMode)
    },
    [bagItems.length, fulfillmentMode, orderSessionActive]
  )

  const handleConfirmModeSwitch = useCallback(() => {
    if (!pendingModeSwitch) return
    setFulfillmentMode(pendingModeSwitch)
    setPendingModeSwitch(null)
    setOrderSessionActive(false)
    setStorefrontSession({ status: 'idle' })
    showTransientWrapperNotice(t('mobile_legal.wrapper_reloaded_toast'))
  }, [pendingModeSwitch, showTransientWrapperNotice, t])

  const handleWrapperResetConfirm = useCallback(() => {
    setOrderSessionActive(false)
    setBagItems([])
    syncBagToServer([], currentStore.id)
    setStorefrontSession({ status: 'idle' })
    setWrapperResetModalOpen(false)
    showTransientWrapperNotice(t('mobile_legal.wrapper_cleared_toast'))
  }, [currentStore.id, showTransientWrapperNotice, syncBagToServer, t])

  const openInAppMap = useCallback(
    (storeId?: number, viewAll = false) => {
      setMapFocusedStoreId(storeId ?? currentStore.id)
      setMapViewAll(viewAll)
      setMapModalOpen(true)
    },
    [currentStore.id]
  )

  const handleLocateGps = useCallback(
    (advanceSlideAfter = false) => {
      if (typeof navigator === 'undefined' || !navigator.geolocation) {
        setGpsError(t('mobile_legal.v2_stores_gps_denied'))
        return
      }
      setIsLocating(true)
      setGpsError(null)
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude }
          setUserCoords(coords)
          let nearest = stores[0]
          let minMiles = Infinity
          for (const st of stores) {
            const d = calculateDistanceMiles(coords.lat, coords.lng, st.latitude, st.longitude)
            if (d < minMiles) {
              minMiles = d
              nearest = st
            }
          }
          if (nearest) selectStoreSafely(nearest.id)
          setIsLocating(false)
          if (advanceSlideAfter) {
            setTimeout(() => setStoryIndex((prev) => Math.min(prev + 1, 4)), 500)
          }
        },
        () => {
          setIsLocating(false)
          setGpsError(t('mobile_legal.v2_stores_gps_denied'))
          if (advanceSlideAfter) {
            setStoryIndex((prev) => Math.min(prev + 1, 4))
          }
        },
        { enableHighAccuracy: true, timeout: 6000 }
      )
    },
    [selectStoreSafely, stores, t]
  )

  // Auth OTP Send & Verify (supports Email & Phone tabs with Accept-Language)
  const handleSendOtp = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      setAuthError(null)
      const raw = phoneInput.trim()

      if (authMethod === 'email') {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) {
          setAuthError(t('mobile_legal.v2_auth_invalid_email'))
          return
        }
      } else {
        const digits = normalizeUsPhone10(raw)
        if (digits.length !== 10) {
          setAuthError(t('mobile_legal.v2_auth_invalid_phone'))
          return
        }
      }

      setAuthLoading(true)
      try {
        const payload =
          authMethod === 'email'
            ? { email: raw.toLowerCase() }
            : { phone: normalizeUsPhone10(raw) }

        const res = await fetch('/api/mobile/auth/send-otp', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept-Language': lang,
          },
          body: JSON.stringify(payload),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          throw new Error(data.error || t('mobile_legal.v2_auth_send_failed'))
        }
        setOtpStep(2)
      } catch (err) {
        setAuthError(err instanceof Error ? err.message : t('mobile_legal.v2_auth_send_failed'))
      } finally {
        setAuthLoading(false)
      }
    },
    [authMethod, lang, phoneInput, t]
  )

  const handleVerifyOtp = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      setAuthError(null)
      const raw = phoneInput.trim()
      const code = otpInput.replace(/\D/g, '')
      if (code.length !== 6) {
        setAuthError(t('mobile_legal.v2_auth_invalid_code'))
        return
      }

      setAuthLoading(true)
      try {
        const digits = normalizeUsPhone10(raw)
        const payload =
          authMethod === 'email'
            ? { email: raw.toLowerCase(), code }
            : { phone: digits, code }

        const res = await fetch('/api/mobile/auth/verify-otp', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept-Language': lang,
          },
          body: JSON.stringify(payload),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          throw new Error(data.error || t('mobile_legal.v2_auth_verify_failed'))
        }

        const profile: V2UserProfile = {
          firstName: data?.user?.first_name || 'Tacos Gavilan',
          lastName: data?.user?.last_name || (lang === 'en' ? 'Member' : 'Cliente'),
          email: data?.user?.email || (authMethod === 'email' ? raw.toLowerCase() : ''),
          phone: formatUsPhoneDisplay(
            String(data?.user?.phone || (authMethod === 'sms' ? digits : ''))
          ),
          provider: authMethod,
        }
        const jwtToken: string | null = data?.session?.access_token || data?.token || null

        setRealLoggedUser(profile)
        if (jwtToken) setV2AccessToken(jwtToken)
        try {
          localStorage.setItem('gavilan_v2_user_profile', JSON.stringify(profile))
          if (jwtToken) localStorage.setItem('gavilan_v2_access_token', jwtToken)
        } catch {
          // ignore
        }

        setOtpStep(1)
        setOtpInput('')
        setAuthSheet(null)
        setAuthError(null)
        triggerBrandTransition(t('mobile_legal.v2_auth_signed_in_toast'), () => {
          setStage('main')
          setActiveTab('home')
        })
      } catch (err) {
        setAuthError(err instanceof Error ? err.message : t('mobile_legal.v2_auth_verify_failed'))
      } finally {
        setAuthLoading(false)
      }
    },
    [authMethod, lang, otpInput, phoneInput, t, triggerBrandTransition]
  )

  const handleOpenEditProfile = useCallback(() => {
    if (!effectiveLoggedUser) return
    setEditFirstName(effectiveLoggedUser.firstName || '')
    setEditLastName(effectiveLoggedUser.lastName || '')
    setEditEmail(effectiveLoggedUser.email || '')
    setEditPhone(effectiveLoggedUser.phone || '')
    setProfileError(null)
    setProfileNotice(null)
    setIsEditingProfile(true)
  }, [effectiveLoggedUser])

  const handleSaveV2Profile = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      if (!effectiveLoggedUser) return
      setProfileError(null)

      if (isDemoPreview) {
        setProfileError(t('mobile_legal.v2_demo_readonly_notice'))
        return
      }

      const nextFirst = editFirstName.trim() || effectiveLoggedUser.firstName
      const nextLast = editLastName.trim()
      const nextEmail = editEmail.trim() || effectiveLoggedUser.email
      const nextPhoneDigits = normalizeUsPhone10(editPhone)
      const nextPhoneFormatted =
        nextPhoneDigits.length === 10 ? formatUsPhoneDisplay(nextPhoneDigits) : editPhone.trim()

      setSavingProfile(true)
      try {
        if (v2AccessToken) {
          const res = await fetch('/api/mobile/user/profile', {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${v2AccessToken}`,
            },
            body: JSON.stringify({
              firstName: nextFirst,
              lastName: nextLast,
              email: nextEmail || null,
              phone: nextPhoneDigits.length === 10 ? nextPhoneDigits : null,
            }),
          })
          const data = await res.json().catch(() => ({}))
          if (!res.ok) {
            throw new Error(data.error || t('mobile_legal.v2_profile_error_save'))
          }
        }

        const updatedProfile: V2UserProfile = {
          ...effectiveLoggedUser,
          firstName: nextFirst,
          lastName: nextLast,
          email: nextEmail,
          phone: nextPhoneFormatted,
        }
        setRealLoggedUser(updatedProfile)
        try {
          localStorage.setItem('gavilan_v2_user_profile', JSON.stringify(updatedProfile))
        } catch {
          // ignore
        }
        setIsEditingProfile(false)
        const msg = t('mobile_legal.v2_profile_saved_toast')
        setProfileNotice(msg)
        setTimeout(() => setProfileNotice((prev) => (prev === msg ? null : prev)), 3200)
      } catch (err) {
        setProfileError(
          err instanceof Error ? err.message : t('mobile_legal.v2_profile_error_save')
        )
      } finally {
        setSavingProfile(false)
      }
    },
    [
      editEmail,
      editFirstName,
      editLastName,
      editPhone,
      effectiveLoggedUser,
      isDemoPreview,
      t,
      v2AccessToken,
    ]
  )

  const handleSignOutV2 = useCallback(() => {
    setIsEditingProfile(false)
    setProfileError(null)
    if (isDemoPreview) {
      setDemoSignedOut(true)
      return
    }
    setRealLoggedUser(null)
    setV2AccessToken(null)
    setServerFavorites([])
    try {
      localStorage.removeItem('gavilan_v2_user_profile')
      localStorage.removeItem('gavilan_v2_access_token')
    } catch {
      // ignore
    }
    const msg = t('mobile_legal.v2_account_signed_out_toast')
    setProfileNotice(msg)
    setTimeout(() => setProfileNotice((prev) => (prev === msg ? null : prev)), 3000)
  }, [isDemoPreview, t])

  const handleConfirmDeleteV2Account = useCallback(async () => {
    setDeleteAccountError(null)
    if (isDemoPreview) {
      setDeleteAccountError(t('mobile_legal.v2_demo_readonly_notice'))
      return
    }

    setDeletingV2Account(true)
    try {
      if (v2AccessToken) {
        const res = await fetch('/api/mobile/user/delete', {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${v2AccessToken}`,
          },
          body: JSON.stringify({ confirmDelete: true }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          throw new Error(data.error || t('mobile_legal.v2_delete_error_failed'))
        }
      }

      setRealLoggedUser(null)
      setV2AccessToken(null)
      setServerFavorites([])
      setIsEditingProfile(false)
      setV2DeleteModalOpen(false)
      setRecentOrderSessions([])
      setOrderSessionActive(false)
      setBagItems([])
      try {
        localStorage.removeItem('gavilan_v2_user_profile')
        localStorage.removeItem('gavilan_v2_access_token')
        localStorage.removeItem('gavilan_v2_order_sessions')
        localStorage.removeItem('gavilan_v2_bag_v1')
      } catch {
        // ignore
      }
      const msg = t('mobile_legal.delete_success_title')
      setProfileNotice(msg)
      setTimeout(() => setProfileNotice((prev) => (prev === msg ? null : prev)), 3600)
    } catch (err) {
      setDeleteAccountError(
        err instanceof Error ? err.message : t('mobile_legal.v2_delete_error_failed')
      )
    } finally {
      setDeletingV2Account(false)
    }
  }, [isDemoPreview, t, v2AccessToken])

  // Select dish from showcase (opens corresponding live item customizer if found, else goes to order hub)
  const handleSelectShowcaseDish = useCallback(
    (dish: SignatureDish) => {
      const allLiveItems = Object.values(liveCategories).flat()
      const normalizedTarget = (lang === 'en' ? dish.nameEn : dish.nameEs).toLowerCase()
      const liveMatch =
        allLiveItems.find((li) => li.name.toLowerCase().includes(normalizedTarget)) ||
        allLiveItems.find((li) => matchShowcaseDishForLiveItem(li.name)?.id === dish.id)

      if (liveMatch) {
        setCustomizingItem(liveMatch)
        return
      }
      launchWrappedOrderOnline(currentStore, fulfillmentMode)
      setActiveTab('order')
    },
    [currentStore, fulfillmentMode, lang, launchWrappedOrderOnline, liveCategories]
  )

  const toggleLang = useCallback(() => {
    setLanguage(lang === 'en' ? 'es' : 'en')
  }, [lang, setLanguage])

  return {
    lang,
    t,
    toggleLang,
    nowDate,
    statusClock,
    greetingText,
    stage,
    setStage,
    storyIndex,
    setStoryIndex,
    activeTab,
    setActiveTab,
    authSheet,
    setAuthSheet,
    stores,
    storesWithDistance,
    selectedStoreId,
    currentStore,
    currentStoreStatus,
    fulfillmentMode,
    setFulfillmentMode,
    selectedMenuCategory,
    setSelectedMenuCategory,
    storeSearchQuery,
    setStoreSearchQuery,
    userCoords,
    isLocating,
    gpsError,
    isDemoPreview,
    loggedUser: effectiveLoggedUser,
    v2AccessToken,
    favoriteDishIds,
    serverFavorites,
    favFilter,
    setFavFilter,
    favoritesSyncing,
    favoritesError,
    authMethod,
    setAuthMethod,
    phoneInput,
    setPhoneInput,
    otpInput,
    setOtpInput,
    otpStep,
    setOtpStep,
    authLoading,
    authError,
    setAuthError,
    storeModalOpen,
    setStoreModalOpen,
    mapModalOpen,
    setMapModalOpen,
    mapFocusedStore,
    mapFocusedStoreStatus,
    setMapFocusedStoreId,
    mapTheme,
    setMapTheme,
    mapViewAll,
    setMapViewAll,
    mapSdkFailed,
    setMapSdkFailed,
    brandLoader,
    triggerBrandTransition,
    menuLoading,
    menuError,
    liveCategories,
    liveCategoryOrder,
    liveModifierGroups,
    catalogMetadata,
    customizingItem,
    setCustomizingItem,
    bagItems,
    bagSubtotal,
    bagItemCount,
    tipPercent,
    setTipPercent,
    tipAmount,
    quote,
    deliveryAddress,
    setDeliveryAddress,
    addressQuery,
    setAddressQuery,
    addressSuggestions,
    addressLoading,
    handleSelectAddressSuggestion,
    storefrontSession,
    handleStartStorefrontCheckout,
    orderLookupId,
    setOrderLookupId,
    orderLookupLoading,
    orderLookupError,
    trackedOrderStatus,
    handleLookupOrderStatus,
    currentOrderOnlineUrl,
    orderSessionActive,
    wrapperResetModalOpen,
    setWrapperResetModalOpen,
    pendingModeSwitch,
    setPendingModeSwitch,
    wrapperNotice,
    wrapperWarning,
    recentOrderSessions,
    isEditingProfile,
    setIsEditingProfile,
    editFirstName,
    setEditFirstName,
    editLastName,
    setEditLastName,
    editEmail,
    setEditEmail,
    editPhone,
    setEditPhone,
    savingProfile,
    profileNotice,
    profileError,
    setProfileError,
    v2DeleteModalOpen,
    setV2DeleteModalOpen,
    deletingV2Account,
    deleteAccountError,
    setDeleteAccountError,
    addLineToBag,
    updateBagLineQuantity,
    clearBag,
    selectStoreSafely,
    launchWrappedOrderOnline,
    openSafeExternalUrl,
    toggleFavoriteDish,
    saveLiveItemToServerFavorites,
    deleteServerFavorite,
    handleClearRecentOrderSessions,
    handleSelectOrderMode,
    handleConfirmModeSwitch,
    handleWrapperResetConfirm,
    openInAppMap,
    handleLocateGps,
    handleSendOtp,
    handleVerifyOtp,
    handleOpenEditProfile,
    handleSaveV2Profile,
    handleSignOutV2,
    handleConfirmDeleteV2Account,
    handleSelectShowcaseDish,
  }
}

export type CustomerAppV2Controller = ReturnType<typeof useCustomerAppV2>
