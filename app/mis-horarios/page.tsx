'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useLanguage } from '@/lib/i18n'
import { ShiftPool } from '@/components/self-schedule/ShiftPool'
import { ClaimModal } from '@/components/self-schedule/ClaimModal'
import { supabase } from '@/lib/supabase'
import { startOfWeek, addWeeks, format } from 'date-fns'
import { es, enUS } from 'date-fns/locale'

// Helper to check if JWT is expired
function isTokenExpired(token: string): boolean {
    try {
        const payload = JSON.parse(atob(token.split('.')[1]))
        const exp = payload.exp * 1000
        return Date.now() >= exp
    } catch {
        return true
    }
}

interface OpenShift {
    id: string
    store_id: string
    shift_date: string
    start_hour: number
    end_hour: number
    position_type: string
    required_count: number
    claimed_count: number
    available_spots: number
    is_available: boolean
    shift_claims?: any[]
}

interface MyClaim {
    id: string
    open_shift_id: string
    open_shifts: OpenShift
    store_name: string
}

export default function MisHorariosPage() {
    const router = useRouter()
    const { t, language } = useLanguage()
    const locale = language === 'es' ? es : enUS

    // Auth state
    const [isAuthed, setIsAuthed] = useState(false)
    const [userName, setUserName] = useState('')
    const [userPositionType, setUserPositionType] = useState<'kitchen' | 'cashier' | null>(null)
    const [userShiftType, setUserShiftType] = useState<'AM' | 'PM' | null>(null)
    const [userStoreIds, setUserStoreIds] = useState<string[]>([])

    // State
    const [shifts, setShifts] = useState<OpenShift[]>([])
    const [myClaims, setMyClaims] = useState<MyClaim[]>([])
    const [stores, setStores] = useState<Map<string, string>>(new Map())
    const [storeList, setStoreList] = useState<{ id: string; name: string }[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [selectedWeek, setSelectedWeek] = useState(0) // 0 = this week, 1 = next week
    const [positionFilter, setPositionFilter] = useState<'all' | 'kitchen' | 'cashier'>('all')
    const [storeFilter, setStoreFilter] = useState<string>('all') // 'all' or external_id
    const [selectedShift, setSelectedShift] = useState<OpenShift | null>(null)
    const [isClaimModalOpen, setIsClaimModalOpen] = useState(false)
    const [isClaiming, setIsClaiming] = useState(false)
    const [isDropModalOpen, setIsDropModalOpen] = useState(false)
    const [selectedClaimId, setSelectedClaimId] = useState<string | null>(null)
    const [isDropping, setIsDropping] = useState(false)

    // Auth check on mount
    useEffect(() => {
        const token = localStorage.getItem('teg_token')
        const userStr = localStorage.getItem('teg_user')

        if (!token || !userStr) {
            router.push('/login')
            return
        }

        // Check token expiration
        if (isTokenExpired(token)) {
            console.log('⏰ Session expired - redirecting to login')
            localStorage.removeItem('teg_token')
            localStorage.removeItem('teg_user')
            localStorage.removeItem('teg_user_name')
            router.replace('/login') // Use replace to prevent back navigation
            return
        }

        try {
            const user = JSON.parse(userStr)
            setUserName(user.name || '')

            console.log('👤 User loaded:', {
                name: user.name,
                position_type: user.position_type,
                shift_type: user.shift_type,
                store_ids: user.store_ids,
                user_type: user.user_type
            })

            // Set position filter based on employee's job
            if (user.position_type) {
                setUserPositionType(user.position_type)
                setPositionFilter(user.position_type) // Auto-filter to their position
            }

            // Set shift type for AM/PM filtering
            if (user.shift_type) {
                setUserShiftType(user.shift_type)
                console.log(`🕐 Employee is ${user.shift_type} shift - will filter accordingly`)
            }

            // Set store filter based on employee's stores
            if (user.store_ids && user.store_ids.length > 0) {
                setUserStoreIds(user.store_ids)
                // Auto-select first store for employees
                setStoreFilter(user.store_ids[0])
            }

            setIsAuthed(true)
        } catch {
            router.replace('/login')
        }
    }, [router])

    // 🔒 STRICT SESSION CHECK: Verify token every 30 seconds
    useEffect(() => {
        if (!isAuthed) return

        const checkSession = () => {
            const token = localStorage.getItem('teg_token')
            if (!token || isTokenExpired(token)) {
                console.log('⏰ Session expired during use - forcing logout')
                localStorage.removeItem('teg_token')
                localStorage.removeItem('teg_user')
                localStorage.removeItem('teg_user_name')
                setIsAuthed(false)
                router.replace('/login')
            }
        }

        // Check immediately, then every 30 seconds
        checkSession()
        const interval = setInterval(checkSession, 30000)

        return () => clearInterval(interval)
    }, [isAuthed, router])

    // Calculate week start dates
    const thisWeekStart = useMemo(() => startOfWeek(new Date(), { weekStartsOn: 1 }), [])
    const nextWeekStart = useMemo(() => addWeeks(thisWeekStart, 1), [thisWeekStart])
    const currentWeekStart = selectedWeek === 0 ? thisWeekStart : nextWeekStart

    // Fetch shifts and claims
    const fetchData = useCallback(async () => {
        if (!isAuthed) return

        setIsLoading(true)
        const token = localStorage.getItem('teg_token')

        try {
            // Build URL with filters
            let url = `/api/self-schedule/slots?weekStart=${format(currentWeekStart, 'yyyy-MM-dd')}`
            if (positionFilter !== 'all') {
                url += `&positionType=${positionFilter}`
            }
            if (storeFilter !== 'all') {
                url += `&storeId=${storeFilter}`
            }
            // Add shift type filter (AM employees see AM shifts, PM employees see PM shifts)
            if (userShiftType) {
                url += `&shiftType=${userShiftType}`
            }

            // Fetch available shifts
            const shiftsRes = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
            const shiftsData = await shiftsRes.json()
            setShifts(shiftsData.data || [])

            // Fetch my claims
            const claimsRes = await fetch(
                `/api/self-schedule/my-shifts`,
                { headers: { Authorization: `Bearer ${token}` } }
            )
            const claimsData = await claimsRes.json()
            setMyClaims(claimsData.data || [])

            // Get all active stores for the filter dropdown
            const { data: allStores } = await supabase
                .from('stores')
                .select('external_id, name')
                .eq('is_active', true)
                .order('name')

            if (allStores && allStores.length > 0) {
                // Create store list for dropdown
                setStoreList(allStores.map(s => ({
                    id: s.external_id,
                    name: s.name?.replace(/^Tacos Gavilan\s+/i, '') || 'Unknown'
                })))

                // Create store map for display names
                const storeMap = new Map<string, string>()
                allStores.forEach(s => storeMap.set(s.external_id, s.name?.replace(/^Tacos Gavilan\s+/i, '') || 'Unknown'))
                setStores(storeMap)
            }

        } catch (error) {
            console.error('Error fetching data:', error)
        } finally {
            setIsLoading(false)
        }
    }, [positionFilter, currentWeekStart, storeFilter, isAuthed, userShiftType])

    useEffect(() => {
        fetchData()
    }, [fetchData])

    // Setup Supabase Realtime subscription
    useEffect(() => {
        const channel = supabase
            .channel('open_shifts_realtime')
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'open_shifts'
            }, () => {
                // Refresh data when any shift changes
                fetchData()
            })
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'shift_claims'
            }, () => {
                fetchData()
            })
            .subscribe()

        return () => {
            supabase.removeChannel(channel)
        }
    }, [fetchData])

    // Get set of shift IDs that the user has claimed
    const myClaimIds = useMemo(() => {
        const ids = new Set<string>()
        myClaims.forEach(claim => {
            if (claim.open_shift_id) {
                ids.add(claim.open_shift_id)
            }
        })
        return ids
    }, [myClaims])

    // Handle slot click
    const handleSlotClick = (shift: OpenShift) => {
        if (myClaimIds.has(shift.id)) {
            // Already claimed - show unclaim/drop modal
            const claim = myClaims.find(c => c.open_shift_id === shift.id)
            if (claim) {
                setSelectedShift(shift)
                setSelectedClaimId(claim.id)
                setIsDropModalOpen(true)
            }
            return
        }
        setSelectedShift(shift)
        setIsClaimModalOpen(true)
    }

    // Handle drop confirm
    const handleDropConfirm = async () => {
        if (!selectedClaimId) return

        // 🔒 Verify session before action
        const token = localStorage.getItem('teg_token')
        if (!token || isTokenExpired(token)) {
            localStorage.removeItem('teg_token')
            localStorage.removeItem('teg_user')
            localStorage.removeItem('teg_user_name')
            router.replace('/login')
            return
        }

        setIsDropping(true)

        try {
            const res = await fetch(`/api/self-schedule/slots?claimId=${selectedClaimId}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            })

            const data = await res.json()

            if (!res.ok) {
                throw new Error(data.message_es || data.error || 'Error dropping shift')
            }

            // Success - close modal and refresh
            setIsDropModalOpen(false)
            setSelectedShift(null)
            setSelectedClaimId(null)
            fetchData()

        } catch (error: any) {
            alert(error.message)
        } finally {
            setIsDropping(false)
        }
    }

    // Handle claim confirm
    const handleClaimConfirm = async () => {
        if (!selectedShift) return

        // 🔒 Verify session before action
        const token = localStorage.getItem('teg_token')
        if (!token || isTokenExpired(token)) {
            localStorage.removeItem('teg_token')
            localStorage.removeItem('teg_user')
            localStorage.removeItem('teg_user_name')
            router.replace('/login')
            return
        }

        setIsClaiming(true)
        const userName = localStorage.getItem('teg_user_name') || ''

        try {
            const res = await fetch('/api/self-schedule/slots', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    shiftId: selectedShift.id,
                    employeeName: userName
                })
            })

            const data = await res.json()

            if (!res.ok) {
                throw new Error(data.message_es || data.error || 'Error claiming shift')
            }

            // Success - close modal and refresh
            setIsClaimModalOpen(false)
            setSelectedShift(null)
            fetchData()

        } catch (error: any) {
            throw error
        } finally {
            setIsClaiming(false)
        }
    }

    // Calculate stats
    const totalHoursThisWeek = useMemo(() => {
        return myClaims.reduce((sum, claim) => {
            const shift = claim.open_shifts
            if (shift) {
                return sum + (shift.end_hour - shift.start_hour)
            }
            return sum
        }, 0)
    }, [myClaims])

    // 🔒 STRICT: Don't render ANYTHING until authenticated
    if (!isAuthed) {
        return (
            <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500 mx-auto mb-4"></div>
                    <p className="text-zinc-400 text-sm">Verificando sesión...</p>
                </div>
            </div>
        )
    }

    return (
        <div className="min-h-screen bg-gradient-to-b from-zinc-50 to-zinc-100 dark:from-zinc-950 dark:to-zinc-900">
            {/* Header */}
            <header className="bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 sticky top-0 z-20">
                <div className="max-w-7xl mx-auto px-4 py-4">
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                        <div>
                            <h1 className="text-2xl font-bold text-zinc-800 dark:text-white flex items-center gap-2">
                                👋 {language === 'es'
                                    ? `¡Hola, ${userName.split(' ')[0] || 'Empleado'}!`
                                    : `Hello, ${userName.split(' ')[0] || 'Employee'}!`}
                            </h1>
                            <p className="text-sm text-zinc-500 dark:text-zinc-400 max-w-md">
                                {language === 'es'
                                    ? 'Este es tu panel de auto-programación. Aquí puedes ver y tomar turnos disponibles para completar tus horas de la semana.'
                                    : 'This is your self-scheduling panel. Here you can view and take available shifts to complete your weekly hours.'}
                            </p>
                        </div>

                        {/* Stats */}
                        <div className="flex items-center gap-4">
                            {/* User welcome */}
                            {userName && (
                                <div className="hidden md:flex items-center gap-2 px-4 py-2 bg-zinc-100 dark:bg-zinc-800 rounded-xl">
                                    <span className="text-sm text-zinc-600 dark:text-zinc-400">
                                        👋 {language === 'es' ? 'Hola,' : 'Hello,'}
                                    </span>
                                    <span className="text-sm font-medium text-zinc-800 dark:text-white">
                                        {userName.split(' ')[0]}
                                    </span>
                                </div>
                            )}

                            <div className="bg-emerald-50 dark:bg-emerald-900/20 px-4 py-2 rounded-xl">
                                <p className="text-xs text-emerald-600 dark:text-emerald-400">
                                    {language === 'es' ? 'Mis Turnos' : 'My Shifts'}
                                </p>
                                <p className="text-lg font-bold text-emerald-700 dark:text-emerald-300">
                                    {myClaims.length}
                                </p>
                            </div>
                            <div className="bg-blue-50 dark:bg-blue-900/20 px-4 py-2 rounded-xl">
                                <p className="text-xs text-blue-600 dark:text-blue-400">
                                    {language === 'es' ? 'Horas Totales' : 'Total Hours'}
                                </p>
                                <p className="text-lg font-bold text-blue-700 dark:text-blue-300">
                                    {totalHoursThisWeek}h
                                </p>
                            </div>

                            {/* Logout button */}
                            <button
                                onClick={() => {
                                    localStorage.removeItem('teg_token')
                                    localStorage.removeItem('teg_user')
                                    router.push('/login')
                                }}
                                className="px-3 py-2 text-sm font-medium text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20 rounded-lg transition-colors flex items-center gap-1"
                                title={language === 'es' ? 'Cerrar Sesión' : 'Logout'}
                            >
                                🚪 <span className="hidden sm:inline">{language === 'es' ? 'Salir' : 'Logout'}</span>
                            </button>
                        </div>
                    </div>

                    {/* Filters */}
                    <div className="flex flex-wrap items-center gap-4 mt-4">
                        {/* Week selector */}
                        <div className="flex bg-zinc-100 dark:bg-zinc-800 rounded-xl p-1">
                            <button
                                onClick={() => setSelectedWeek(0)}
                                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${selectedWeek === 0
                                    ? 'bg-white dark:bg-zinc-700 shadow text-zinc-800 dark:text-white'
                                    : 'text-zinc-500 hover:text-zinc-700'
                                    }`}
                            >
                                {language === 'es' ? 'Esta Semana' : 'This Week'}
                            </button>
                            <button
                                onClick={() => setSelectedWeek(1)}
                                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${selectedWeek === 1
                                    ? 'bg-white dark:bg-zinc-700 shadow text-zinc-800 dark:text-white'
                                    : 'text-zinc-500 hover:text-zinc-700'
                                    }`}
                            >
                                {language === 'es' ? 'Próxima Semana' : 'Next Week'}
                            </button>
                        </div>

                        {/* Position filter - hidden if employee has assigned position */}
                        {userPositionType ? (
                            // Show locked position badge
                            <div className={`px-4 py-2 rounded-xl flex items-center gap-2 ${userPositionType === 'kitchen'
                                ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300'
                                : 'bg-pink-100 dark:bg-pink-900/30 text-pink-700 dark:text-pink-300'
                                }`}>
                                {userPositionType === 'kitchen' ? '🍳' : '💵'}
                                <span className="font-medium">
                                    {userPositionType === 'kitchen'
                                        ? (language === 'es' ? 'Cocina' : 'Kitchen')
                                        : (language === 'es' ? 'Cajero' : 'Cashier')}
                                </span>
                            </div>
                        ) : (
                            // Show filter buttons (for managers/admins or employees without position)
                            <div className="flex bg-zinc-100 dark:bg-zinc-800 rounded-xl p-1">
                                <button
                                    onClick={() => setPositionFilter('all')}
                                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${positionFilter === 'all'
                                        ? 'bg-white dark:bg-zinc-700 shadow text-zinc-800 dark:text-white'
                                        : 'text-zinc-500 hover:text-zinc-700'
                                        }`}
                                >
                                    📋 {language === 'es' ? 'Todos' : 'All'}
                                </button>
                                <button
                                    onClick={() => setPositionFilter('kitchen')}
                                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${positionFilter === 'kitchen'
                                        ? 'bg-white dark:bg-zinc-700 shadow text-zinc-800 dark:text-white'
                                        : 'text-zinc-500 hover:text-zinc-700'
                                        }`}
                                >
                                    🍳 {language === 'es' ? 'Cocina' : 'Kitchen'}
                                </button>
                                <button
                                    onClick={() => setPositionFilter('cashier')}
                                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${positionFilter === 'cashier'
                                        ? 'bg-white dark:bg-zinc-700 shadow text-zinc-800 dark:text-white'
                                        : 'text-zinc-500 hover:text-zinc-700'
                                        }`}
                                >
                                    💵 {language === 'es' ? 'Cajero' : 'Cashier'}
                                </button>
                            </div>
                        )}

                        {/* Store filter - hidden if employee has assigned stores */}
                        {userStoreIds.length > 0 ? (
                            // Show locked store badge
                            <div className="px-4 py-2 rounded-xl bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 flex items-center gap-2">
                                📍 <span className="font-medium">{stores.get(userStoreIds[0]) || 'Mi Tienda'}</span>
                            </div>
                        ) : (
                            // Show store dropdown
                            <select
                                value={storeFilter}
                                onChange={(e) => setStoreFilter(e.target.value)}
                                className="px-4 py-2 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-white border-0 text-sm font-medium cursor-pointer"
                            >
                                <option value="all">
                                    🏪 {language === 'es' ? 'Todas las Tiendas' : 'All Stores'}
                                </option>
                                {storeList.map(store => (
                                    <option key={store.id} value={store.id}>
                                        📍 {store.name}
                                    </option>
                                ))}
                            </select>
                        )}

                        {/* Shift type badge (AM/PM) */}
                        {userShiftType && (
                            <div className={`px-4 py-2 rounded-xl flex items-center gap-2 ${userShiftType === 'AM'
                                ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
                                : 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300'
                                }`}>
                                {userShiftType === 'AM' ? '🌅' : '🌙'}
                                <span className="font-medium">
                                    {language === 'es'
                                        ? `Turno ${userShiftType}`
                                        : `${userShiftType} Shift`}
                                </span>
                            </div>
                        )}

                        {/* Week dates display */}
                        <div className="text-sm text-zinc-500 dark:text-zinc-400 ml-auto">
                            {format(currentWeekStart, 'MMM d', { locale })} - {format(addWeeks(currentWeekStart, 1), 'MMM d, yyyy', { locale })}
                        </div>
                    </div>
                </div>
            </header>

            {/* Main content */}
            <main className="max-w-7xl mx-auto px-4 py-6">
                {isLoading ? (
                    <div className="flex items-center justify-center py-20">
                        <div className="animate-spin text-4xl">⏳</div>
                    </div>
                ) : shifts.length === 0 ? (
                    <div className="text-center py-20">
                        <div className="text-6xl mb-4">📭</div>
                        <h2 className="text-xl font-semibold text-zinc-700 dark:text-zinc-300">
                            {language === 'es' ? 'No hay turnos disponibles' : 'No shifts available'}
                        </h2>
                        <p className="text-zinc-500 dark:text-zinc-400 mt-2">
                            {language === 'es'
                                ? 'El administrador aún no ha publicado los horarios para esta semana.'
                                : 'The administrator has not yet published schedules for this week.'}
                        </p>
                    </div>
                ) : (
                    <ShiftPool
                        shifts={shifts}
                        myClaimIds={myClaimIds}
                        storeMap={stores}
                        onClaimShift={handleSlotClick}
                        onDropShift={(shift) => {
                            // Find the claim ID for this shift
                            const myClaim = myClaims.find(c => c.open_shift_id === shift.id)
                            if (myClaim) {
                                setSelectedShift(shift)
                                setSelectedClaimId(myClaim.id)
                                setIsDropModalOpen(true)
                            }
                        }}
                    />
                )}

                {/* Legend */}
                <div className="flex flex-wrap items-center justify-center gap-6 mt-6 text-sm">
                    <div className="flex items-center gap-2">
                        <div className="w-4 h-4 rounded bg-gradient-to-r from-red-500 to-orange-500"></div>
                        <span className="text-zinc-600 dark:text-zinc-400">
                            {language === 'es' ? 'Cocinero' : 'Cook'}
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-4 h-4 rounded bg-gradient-to-r from-pink-500 to-rose-500"></div>
                        <span className="text-zinc-600 dark:text-zinc-400">
                            {language === 'es' ? 'Cajero' : 'Cashier'}
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-4 h-4 rounded bg-gradient-to-r from-blue-500 to-indigo-500"></div>
                        <span className="text-zinc-600 dark:text-zinc-400">
                            {language === 'es' ? 'Tu turno' : 'Your shift'}
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="bg-orange-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">🔥 RUSH</span>
                        <span className="text-zinc-600 dark:text-zinc-400">
                            {language === 'es' ? 'Hora pico' : 'Peak hour'}
                        </span>
                    </div>
                </div>
            </main>

            {/* Claim Modal */}
            <ClaimModal
                isOpen={isClaimModalOpen}
                onClose={() => {
                    setIsClaimModalOpen(false)
                    setSelectedShift(null)
                }}
                onConfirm={handleClaimConfirm}
                shift={selectedShift ? {
                    store_name: stores.get(selectedShift.store_id) || 'Unknown',
                    shift_date: selectedShift.shift_date,
                    start_hour: selectedShift.start_hour,
                    end_hour: selectedShift.end_hour,
                    position_type: selectedShift.position_type
                } : null}
                isLoading={isClaiming}
            />

            {/* Drop Modal */}
            {isDropModalOpen && selectedShift && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
                    <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
                        <div className="bg-gradient-to-r from-orange-500 to-red-500 px-6 py-4">
                            <h2 className="text-xl font-bold text-white">
                                {language === 'es' ? '¿Soltar este turno?' : 'Drop this shift?'}
                            </h2>
                        </div>
                        <div className="p-6 space-y-4">
                            <div className="space-y-3 text-sm">
                                <div className="flex items-center gap-3">
                                    <span className="text-lg">📍</span>
                                    <div>
                                        <p className="text-zinc-500 text-xs">{language === 'es' ? 'Tienda' : 'Store'}</p>
                                        <p className="font-medium text-zinc-800 dark:text-white">{stores.get(selectedShift.store_id)}</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-3">
                                    <span className="text-lg">📅</span>
                                    <div>
                                        <p className="text-zinc-500 text-xs">{language === 'es' ? 'Fecha' : 'Date'}</p>
                                        <p className="font-medium text-zinc-800 dark:text-white">{format(new Date(selectedShift.shift_date + 'T12:00:00'), 'EEEE, MMM d', { locale })}</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-3">
                                    <span className="text-lg">⏰</span>
                                    <div>
                                        <p className="text-zinc-500 text-xs">{language === 'es' ? 'Horario' : 'Time'}</p>
                                        <p className="font-medium text-zinc-800 dark:text-white">{selectedShift.start_hour}:00 - {selectedShift.end_hour}:00</p>
                                    </div>
                                </div>
                            </div>
                            <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-xl p-3 text-sm text-orange-700 dark:text-orange-300">
                                ⚠️ {language === 'es'
                                    ? 'Al soltar este turno, estará disponible para que otros empleados lo tomen.'
                                    : 'By dropping this shift, it will become available for other employees to claim.'}
                            </div>
                        </div>
                        <div className="flex gap-3 p-6 pt-0">
                            <button
                                onClick={() => {
                                    setIsDropModalOpen(false)
                                    setSelectedShift(null)
                                    setSelectedClaimId(null)
                                }}
                                className="flex-1 px-4 py-3 rounded-xl border border-zinc-200 dark:border-zinc-700 font-medium hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                            >
                                {language === 'es' ? 'Cancelar' : 'Cancel'}
                            </button>
                            <button
                                onClick={handleDropConfirm}
                                disabled={isDropping}
                                className="flex-1 px-4 py-3 rounded-xl bg-gradient-to-r from-orange-500 to-red-500 text-white font-medium hover:from-orange-600 hover:to-red-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                            >
                                {isDropping ? (
                                    <span className="animate-spin">⏳</span>
                                ) : (
                                    <>🗑️ {language === 'es' ? 'Soltar Turno' : 'Drop Shift'}</>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
