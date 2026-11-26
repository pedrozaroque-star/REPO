/**
 * @module components/customer-app-v2/hooks/useCustomerAppV2
 * @description Hook central de estado y lógica de negocio para Tacos Gavilan App V2.
 * Conecta el Explorador de Menú en Vivo (`/api/mobile/menu`), directorio de 15 sucursales
 * hidratado desde `/api/mobile/stores`, localizador GPS Haversine, mapa interactivo,
 * favoritos sincronizados (`/api/mobile/favorites`), autenticación real por OTP de 6 dígitos
 * (correo y SMS), perfil/eliminación estricta (`/api/mobile/user/profile`, `/api/mobile/user/delete`),
 * reloj en vivo en `America/Los_Angeles` (60s) y lanzamiento directo verificado por sucursal.
 *
 * @businessRules
 * - Día operativo en `America/Los_Angeles` actualizado cada 60 segundos (`nowMs`).
 * - Sucursal inicial por defecto: `#6` (`V2_STORES[0]`, Los Angeles Central & Washington).
 * - Screen #12 (`externalLoggedInDemo`) opera en memoria efímera aislada sin mutar `localStorage` ni servidor.
 * - Cero carritos sin salida ni modales falsos de "recarga de tienda": el pedido se lanza con enlaces
 *   `<a>` HTTPS verificados por lista blanca (`isAllowedExternalOrderUrl`) directamente a la sucursal
 *   con `?hideModal=true&pickup=true|delivery=true`.
 * - Mutaciones `/api/mobile/user/profile`, `/api/mobile/user/delete` y `/api/mobile/favorites`
 *   verifican estrictamente `res.ok` antes de confirmar éxito al usuario.
 *
 * @dataFlow
 * - Consume `V2_STORES`, `SIGNATURE_DISHES`, `@/lib/i18n` y rutas REST `/api/mobile/*`.
 * - Exporta estado y acciones hacia `CustomerAppV2Pro` y subcomponentes de etapas/pestañas/modales.
 *
 * @notes
 * - 2026-11-24: Eliminado el teatro de carrito/checkout sin salida (`order_session` declinado por DoorDash,
 *   cotizaciones `TOAST_SCOPE_BLOCKED`/`DELIVERY_DISABLED`, modales falsos de reinicio y delay artificial de 720ms).
 */

'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLanguage } from '@/lib/i18n'
import { formatCustomerStoreName } from '@/lib/customer-store-names'
import { sortStoresAlphabetically } from '@/lib/store-display'
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
  CustomerAppV2ProProps,
  FulfillmentMode,
  LiveCatalogMetadata,
  LiveMenuItem,
  LiveModifierGroup,
  MainTab,
  OrderSessionRecord,
  ServerFavoriteOrder,
  SignatureDish,
  V2AuthSheet,
  V2AuthoritativeStore,
  V2Stage,
  V2StoreWithDistance,
  V2UserProfile,
} from '../types'

const DEMO_PREVIEW_USER: V2UserProfile = {
  firstName: 'Cliente',
  lastName: 'Gavilan',
  email: 'noreply@tacosgavilan.com',
  phone: '(213) 555-0199',
  provider: 'email',
}

const DEFAULT_STORE_ID = V2_STORES[0]?.id ?? 6

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
  const [selectedStoreId, setSelectedStoreId] = useState<number>(DEFAULT_STORE_ID)
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

  // Modals state
  const [storeModalOpen, setStoreModalOpen] = useState(false)
  const [mapModalOpen, setMapModalOpen] = useState(false)
  const [mapFocusedStoreId, setMapFocusedStoreId] = useState<number>(DEFAULT_STORE_ID)
  const [mapTheme, setMapTheme] = useState<'dark' | 'light' | 'satellite'>('dark')
  const [mapViewAll, setMapViewAll] = useState(false)
  const [mapSdkFailed, setMapSdkFailed] = useState(false)

  // Live Menu state (/api/mobile/menu)
  const [menuLoading, setMenuLoading] = useState(false)
  const [menuError, setMenuError] = useState<string | null>(null)
  const [liveCategories, setLiveCategories] = useState<Record<string, LiveMenuItem[]>>({})
  const [liveCategoryOrder, setLiveCategoryOrder] = useState<string[]>([])
  const [liveModifierGroups, setLiveModifierGroups] = useState<Record<string, LiveModifierGroup>>({})
  const [catalogMetadata, setCatalogMetadata] = useState<LiveCatalogMetadata | null>(null)
  const [customizingItem, setCustomizingItem] = useState<LiveMenuItem | null>(null)

  // Order Sessions & Transient Notices
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
          : DEFAULT_STORE_ID
      setSelectedStoreId(resolvedStoreId)

      const savedMode = localStorage.getItem('gavilan_v2_fulfillment_mode')
      if (savedMode === 'pickup' || savedMode === 'delivery') {
        setFulfillmentMode(savedMode)
      }
    } catch {
      // Ignore storage read errors in restricted WebViews
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

  // Persist preference updates cleanly
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
    return sortStoresAlphabetically(mapped, (st) => formatCustomerStoreName(st, lang))
  }, [lang, stores, userCoords])

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

  const buildBranchOrderUrl = useCallback(
    (store: V2AuthoritativeStore, mode: FulfillmentMode): string => {
      const base = store.toastOrderingUrl.replace(/\/+$/, '')
      const param = mode === 'delivery' ? 'delivery=true' : 'pickup=true'
      const candidate = `${base}/?hideModal=true&${param}`
      if (isAllowedExternalOrderUrl(candidate)) {
        return candidate
      }
      return 'https://order.online/business/-137616'
    },
    []
  )

  const currentOrderOnlineUrl = useMemo(
    () => buildBranchOrderUrl(currentStore, fulfillmentMode),
    [buildBranchOrderUrl, currentStore, fulfillmentMode]
  )

  // Fetch live branch menu whenever active store or mode changes
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

  // Load cloud favorites when a real authenticated JWT is active
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

    return () => controller.abort()
  }, [isDemoPreview, v2AccessToken])

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

  const selectStoreSafely = useCallback((nextStoreId: number) => {
    setSelectedStoreId(nextStoreId)
  }, [])

  const recordOrderHandoff = useCallback(
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

      const targetUrl = buildBranchOrderUrl(targetStore, targetMode)
      if (!isAllowedExternalOrderUrl(targetUrl)) {
        showTransientWrapperWarning(
          `${t('mobile_legal.v2_toast_scope_blocked_title')}: ${t('mobile_legal.v2_toast_scope_blocked_desc')}`
        )
        return
      }

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
      buildBranchOrderUrl,
      currentStore,
      fulfillmentMode,
      isDemoPreview,
      selectStoreSafely,
      selectedStoreId,
      showTransientWrapperWarning,
      t,
    ]
  )

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
        showTransientWrapperNotice(`${item.name} — ${t('mobile_legal.v2_customizer_saved_fav')}`)
      } catch (err) {
        setFavoritesError(err instanceof Error ? err.message : t('mobile_legal.v2_fav_sync_error'))
      } finally {
        setFavoritesSyncing(false)
      }
    },
    [currentStore.id, isDemoPreview, showTransientWrapperNotice, t, v2AccessToken]
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

  const handleSelectOrderMode = useCallback((nextMode: FulfillmentMode) => {
    setFulfillmentMode(nextMode)
  }, [])

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
        setStage('main')
        setActiveTab('home')
        showTransientWrapperNotice(t('mobile_legal.v2_auth_signed_in_toast'))
      } catch (err) {
        setAuthError(err instanceof Error ? err.message : t('mobile_legal.v2_auth_verify_failed'))
      } finally {
        setAuthLoading(false)
      }
    },
    [authMethod, lang, otpInput, phoneInput, showTransientWrapperNotice, t]
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

  // Select dish from showcase: opens corresponding live menu item details if found, else goes cleanly to Order hub
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
      setActiveTab('order')
    },
    [lang, liveCategories]
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
    menuLoading,
    menuError,
    liveCategories,
    liveCategoryOrder,
    liveModifierGroups,
    catalogMetadata,
    customizingItem,
    setCustomizingItem,
    buildBranchOrderUrl,
    currentOrderOnlineUrl,
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
    selectStoreSafely,
    recordOrderHandoff,
    toggleFavoriteDish,
    saveLiveItemToServerFavorites,
    deleteServerFavorite,
    handleClearRecentOrderSessions,
    handleSelectOrderMode,
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
