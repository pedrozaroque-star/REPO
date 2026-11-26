/**
 * @module SyncToastUsersRoute
 * @description API route to query and synchronize Toast employee promotions, role updates, and demotions with system user profiles.
 * @businessRules
 * - Levels 1 (Cooks/Cashiers) and 2 (Shift Leaders) do not have portal credentials; they exist in `toast_employees` for labor/planning.
 * - Levels 3 (Asst. Manager), 4 (Manager), 5 (Supervisor), 6 (Admin) map to `users` portal accounts.
 * - Detects active Toast employees with 'Manager' or 'Asst Manager' jobs who lack matching portal user profiles.
 * - Uses TRIPLE MATCHING strategy: toast_guid > email > name+store to link Toast employees to system users.
 * - Job titles are NORMALIZED (case-insensitive, punctuation-stripped) to handle variations like "Asst Manager" vs "Asst. Manager".
 * - Flags store-level manager/assistant conflicts so admins can deactivate current active managers/assistants when promoting new ones.
 * @dataFlow
 * - GET: Toast jobs + Toast employees + Stores + Users -> Matches & returns `pendingPromotions`, `pendingDemotions`, and `toastEmployees`.
 * - POST: Applies promotions (creating Auth user + inserting/updating `public.users`) and optional deactivations.
 * @notes
 * - BUG FIX (2026-07-24): 14 of 15 stores used "Asst Manager" (no period) while code only checked "Asst. Manager" (with period).
 *   Now uses normalizeJobTitle() to strip punctuation and lowercase before comparison.
 * - IMPROVEMENT (2026-07-24): Added toast_guid column to users table and triple matching (guid > email > name+store)
 *   to handle assistants who have personal emails in Toast but corporate emails in system.
 */

import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { invalidateActiveUserStatusCache, verifyStaffAuth } from '@/lib/auth-server'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder'

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
        persistSession: false,
        autoRefreshToken: false
    }
})

const PROTECTED_TEG_ROLES = new Set([
    'admin',
    'administrador',
    'supervisor',
    'regional_manager',
    'planificador',
    'basecamp',
    'accounting',
    'contador',
    'auditor',
])

// ── Utility: Normalize job title to handle all variations ──
// "Asst. Manager" -> "asst manager"
// "Asst Manager"  -> "asst manager"
// "ASST MANAGER"  -> "asst manager"
// "Manager"       -> "manager"
function normalizeJobTitle(title: string): string {
    return title
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\./g, '')
        .replace(/\s+/g, ' ')
        .trim()
}

// ── Utility: Normalize full name for fuzzy matching ──
// Removes accents, extra spaces, and lowercases
function normalizeName(name: string): string {
    return name
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove accents (ñ -> n, etc.)
        .replace(/\s+/g, ' ')
        .trim()
}

// ── Detect role from normalized job titles ──
function detectRole(titles: string[]): 'manager' | 'asistente' | null {
    const normalized = titles.map(normalizeJobTitle)
    if (normalized.includes('manager') || normalized.includes('general manager') || normalized.includes('gerente')) {
        return 'manager'
    }
    if (normalized.some(t => t === 'asst manager' || t === 'assistant manager' || t === 'asistente')) {
        return 'asistente'
    }
    return null
}

function hasShiftLeaderTitle(titles: string[]): boolean {
    const normalized = titles.map(normalizeJobTitle)
    return normalized.some(
        t =>
            t === 'shift leader' ||
            t === 'shift lead' ||
            t === 'shiftleader' ||
            t === 'lider de turno'
    )
}

export async function GET(request: NextRequest) {
    const auth = await verifyStaffAuth(request, { allowedRoles: ['admin', 'supervisor'] })
    if (!auth.authorized) return auth.response!

    try {
        // 1. Fetch active stores
        const { data: dbStores, error: storesErr } = await supabaseAdmin
            .from('stores')
            .select('id, name, code, external_id')
            .eq('is_active', true)

        if (storesErr) throw storesErr

        // 2. Fetch active jobs
        const { data: dbJobs, error: jobsErr } = await supabaseAdmin
            .from('toast_jobs')
            .select('guid, title')
            .eq('deleted', false)

        if (jobsErr) throw jobsErr

        // 3. Fetch active employees
        const { data: dbEmployees, error: empErr } = await supabaseAdmin
            .from('toast_employees')
            .select('toast_guid, first_name, last_name, email, phone, job_references, store_ids')
            .eq('deleted', false)

        if (empErr) throw empErr

        // 4. Fetch users (including toast_guid for triple matching)
        const { data: dbUsers, error: usersErr } = await supabaseAdmin
            .from('users')
            .select('id, email, full_name, role, store_id, is_active, phone, toast_guid, position_type')

        if (usersErr) throw usersErr

        // ── Mappings ──
        const storeMap = new Map<string, { id: number; name: string; code: string | null }>()
        const genericStoreIdentifiers = new Set<string>()
        dbStores?.forEach(s => {
            if (s.external_id) {
                storeMap.set(s.external_id, { id: Number(s.id), name: s.name, code: s.code || null })
            }
            if (s.name) {
                genericStoreIdentifiers.add(normalizeName(s.name))
                genericStoreIdentifiers.add(normalizeName(s.name).replace(/\s+/g, ''))
            }
            if (s.code) {
                genericStoreIdentifiers.add(normalizeName(s.code))
                genericStoreIdentifiers.add(normalizeName(s.code).replace(/\s+/g, ''))
            }
        })

        const jobMap = new Map<string, string>()
        dbJobs?.forEach(j => {
            jobMap.set(j.guid, j.title)
        })

        const pendingPromotions: any[] = []
        const matchedUserIds = new Set<number>() // Track matched users by ID (not email) to avoid false demotions
        const allToastEmployees: any[] = []

        // ── TRIPLE MATCHING FUNCTION ──
        // Priority: 1) toast_guid  2) email  3) name + store (checking all employee stores)
        function findMatchingUser(toastGuid: string, email: string, fullName: string, storeIds: number[]) {
            // Match 1: By toast_guid (strongest, permanent link)
            const byGuid = dbUsers?.find(u => u.toast_guid && u.toast_guid === toastGuid)
            if (byGuid) return byGuid

            // Match 2: By email (case-insensitive)
            const normEmail = email.trim().toLowerCase()
            if (normEmail) {
                const byEmail = dbUsers?.find(u => u.email?.trim().toLowerCase() === normEmail)
                if (byEmail) return byEmail
            }

            // Match 3: By normalized name + any assigned store (fuzzy fallback)
            const normName = normalizeName(fullName)
            if (normName && storeIds.length > 0) {
                const byName = dbUsers?.find(u => {
                    if (!u.full_name || !u.is_active) return false
                    return normalizeName(u.full_name) === normName &&
                        storeIds.includes(Number(u.store_id))
                })
                if (byName) return byName
            }

            return null
        }

        dbEmployees?.forEach(emp => {
            const refs = Array.isArray(emp.job_references) ? emp.job_references : []
            const titles = refs.map((r: any) => jobMap.get(r.guid)).filter(Boolean) as string[]
            const toastRole = detectRole(titles)
            const isShiftLead = hasShiftLeaderTitle(titles)

            const empStores = (Array.isArray(emp.store_ids) ? emp.store_ids : [])
                .map((g: string) => storeMap.get(g))
                .filter(Boolean) as { id: number; name: string; code: string | null }[]
            const empStoreIds = empStores.map(s => Number(s.id))
            const primaryStoreInfo = empStores[0] || null
            const fullName = `${emp.first_name || ''} ${emp.last_name || ''}`.trim()

            // Use triple matching across all employee stores
            const existingUser = findMatchingUser(
                emp.toast_guid,
                emp.email || '',
                fullName,
                empStoreIds
            )

            // Prefer the store matching existingUser.store_id if the employee belongs to multiple stores in Toast
            const matchedStoreInfo =
                (existingUser?.store_id
                    ? empStores.find(s => Number(s.id) === Number(existingUser.store_id))
                    : null) || primaryStoreInfo

            allToastEmployees.push({
                toast_guid: emp.toast_guid,
                full_name: fullName,
                email: emp.email || '',
                phone: emp.phone || '',
                store_id: matchedStoreInfo?.id || null,
                store_name: matchedStoreInfo?.name || null,
                suggested_role: toastRole || (isShiftLead ? 'asistente' : null),
                job_titles: titles
            })

            // Prevent false demotion of Shift Leaders who have active Assistant portal accounts
            if (existingUser && (toastRole || isShiftLead)) {
                matchedUserIds.add(existingUser.id)
            }

            if (toastRole) {
                const existingRoleNorm = String(existingUser?.role || '').trim().toLowerCase()

                // NEVER flag or demote Admins, Supervisors, Planificador, or Basecamp accounts into single-store Manager/Asistente
                if (existingUser && PROTECTED_TEG_ROLES.has(existingRoleNorm)) {
                    matchedUserIds.add(existingUser.id)
                    return
                }

                // Do not auto-prompt reactivation of Carlos's inactive legacy manager row (#25)
                if (
                    existingUser &&
                    !existingUser.is_active &&
                    String(existingUser.email || '').trim().toLowerCase() === 'carlos@tacosgavilan.com'
                ) {
                    matchedUserIds.add(existingUser.id)
                    return
                }

                const matchesAnyEmpStore =
                    existingUser &&
                    (empStoreIds.includes(Number(existingUser.store_id)) ||
                        (empStoreIds.length === 0 && !existingUser.store_id))

                const isFullySynced = Boolean(
                    existingUser &&
                    existingUser.is_active &&
                    existingRoleNorm === toastRole &&
                    matchesAnyEmpStore
                )

                if (!isFullySynced) {
                    const targetStoreInfo = matchedStoreInfo
                    // Conflict detection ONLY applies to MANAGERS (stores only have 1 Manager, but can have multiple Assistants like AM/PM)
                    const conflictingUser = (targetStoreInfo && toastRole === 'manager') ? dbUsers?.find(u =>
                        u.is_active &&
                        u.role === 'manager' &&
                        Number(u.store_id) === Number(targetStoreInfo.id) &&
                        u.id !== existingUser?.id
                    ) : null

                    pendingPromotions.push({
                        toast_guid: emp.toast_guid,
                        full_name: fullName,
                        email: emp.email || existingUser?.email || '',
                        phone: emp.phone || existingUser?.phone || '',
                        role: toastRole,
                        store_id: targetStoreInfo?.id || null,
                        store_name: targetStoreInfo?.name || 'Desconocida',
                        existing_user: existingUser ? {
                            id: existingUser.id,
                            role: existingUser.role,
                            store_id: existingUser.store_id,
                            is_active: existingUser.is_active,
                            email: existingUser.email
                        } : null,
                        conflict: conflictingUser ? {
                            id: conflictingUser.id,
                            full_name: conflictingUser.full_name,
                            email: conflictingUser.email
                        } : null
                    })
                }
            }
        })

        // Detect demotions (active managers/assistants NOT matched by ANY method, excluding generic store accounts and Shift Leaders)
        const pendingDemotions: any[] = []
        dbUsers?.forEach(user => {
            const roleNorm = String(user.role || '').trim().toLowerCase()
            if (['manager', 'asistente'].includes(roleNorm) && user.is_active) {
                if (!matchedUserIds.has(user.id)) {
                    const normUserName = normalizeName(user.full_name || '')
                    const emailLocal = normalizeName(String(user.email || '').split('@')[0] || '').replace(/\s+/g, '')

                    // Exclude generic store accounts (e.g. "Bell" / bell@tacosgavilan.com without toast_guid)
                    const isGenericStoreAccount =
                        !user.toast_guid &&
                        (genericStoreIdentifiers.has(normUserName) ||
                            genericStoreIdentifiers.has(normUserName.replace(/\s+/g, '')) ||
                            genericStoreIdentifiers.has(emailLocal))

                    if (isGenericStoreAccount) {
                        return
                    }

                    // Double-check if linked by toast_guid to an active Toast employee with Shift Leader / Manager / Asst Manager title
                    if (user.toast_guid) {
                        const linkedEmp = dbEmployees?.find(e => e.toast_guid === user.toast_guid)
                        if (linkedEmp) {
                            const refs = Array.isArray(linkedEmp.job_references) ? linkedEmp.job_references : []
                            const titles = refs.map((r: any) => jobMap.get(r.guid)).filter(Boolean) as string[]
                            if (detectRole(titles) || (roleNorm === 'asistente' && hasShiftLeaderTitle(titles))) {
                                return
                            }
                        }
                    }

                    const storeObj = dbStores?.find(s => Number(s.id) === Number(user.store_id))
                    pendingDemotions.push({
                        id: user.id,
                        full_name: user.full_name,
                        email: user.email || '',
                        role: user.role,
                        store_id: user.store_id,
                        store_name: storeObj?.name || 'Desconocida'
                    })
                }
            }
        })

        return NextResponse.json({
            success: true,
            pendingPromotions,
            pendingDemotions,
            toastEmployees: allToastEmployees,
            stores: dbStores || []
        })

    } catch (err: any) {
        console.error('❌ Error in sync-toast GET:', err)
        return NextResponse.json({ success: false, error: err.message }, { status: 500 })
    }
}

export async function POST(req: NextRequest) {
    const auth = await verifyStaffAuth(req, { allowedRoles: ['admin', 'supervisor'] })
    if (!auth.authorized) return auth.response!

    try {
        const body = await req.json()
        const { promotions, demotions } = body

        let appliedPromotions = 0
        let appliedDemotions = 0

        const { data: dbStores } = await supabaseAdmin
            .from('stores')
            .select('id, code, name')
        const storeCodeById = new Map<number, string>()
        dbStores?.forEach((s: any) => {
            if (s.id && typeof s.code === 'string' && s.code.trim()) {
                storeCodeById.set(Number(s.id), s.code.trim())
            }
        })

        // Process promotions
        if (Array.isArray(promotions)) {
            for (const p of promotions) {
                // Try to find existing user by toast_guid first, then email
                let existingUser: any = null

                if (p.toast_guid) {
                    const { data } = await supabaseAdmin
                        .from('users')
                        .select('id, auth_id, email, role, phone, position_type')
                        .eq('toast_guid', p.toast_guid)
                        .maybeSingle()
                    existingUser = data
                }

                if (!existingUser) {
                    const uEmail = (p.email || '').trim().toLowerCase()
                    if (uEmail) {
                        const { data } = await supabaseAdmin
                            .from('users')
                            .select('id, auth_id, email, role, phone, position_type')
                            .eq('email', uEmail)
                            .maybeSingle()
                        existingUser = data
                    }
                }

                if (existingUser && PROTECTED_TEG_ROLES.has(String(existingUser.role || '').trim().toLowerCase())) {
                    // Never demote or overwrite an Admin, Supervisor, Planificador, or Basecamp account
                    continue
                }

                const parsedStoreId = p.store_id ? Number(p.store_id) : null
                const storeCode = parsedStoreId ? storeCodeById.get(parsedStoreId) || null : null
                const resolvedScope = storeCode ? [storeCode] : null
                let promoSucceeded = false

                if (existingUser) {
                    // Update user profile, activate, sync store_scope, and link toast_guid
                    const { error: updErr } = await supabaseAdmin
                        .from('users')
                        .update({
                            role: p.role,
                            store_id: parsedStoreId,
                            store_scope: resolvedScope,
                            position_type: existingUser.position_type || 'kitchen',
                            is_active: true,
                            phone: p.phone || existingUser.phone || null,
                            full_name: p.full_name || undefined,
                            toast_guid: p.toast_guid || undefined,
                            updated_at: new Date().toISOString()
                        })
                        .eq('id', existingUser.id)

                    if (!updErr) {
                        invalidateActiveUserStatusCache(existingUser.id, existingUser.email)
                        appliedPromotions++
                        promoSucceeded = true
                    }
                } else {
                    // Create in Supabase Auth + public.users with toast_guid and bcrypt password
                    const defaultPassword = 'Gavilan' + new Date().getFullYear() + '!'
                    const emailToUse = (p.email || '').trim().toLowerCase()
                    if (!emailToUse) continue

                    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
                        email: emailToUse,
                        password: defaultPassword,
                        email_confirm: true,
                        user_metadata: {
                            full_name: p.full_name
                        }
                    })

                    if (authError) {
                        console.error('❌ Auth error creating promoted user:', emailToUse, authError.message)
                        continue
                    }

                    const newUserId = authData.user?.id
                    if (newUserId) {
                        const hashedPassword = await bcrypt.hash(defaultPassword, 12)
                        const { data: inserted, error: insErr } = await supabaseAdmin
                            .from('users')
                            .insert({
                                auth_id: newUserId,
                                email: emailToUse,
                                full_name: p.full_name,
                                role: p.role,
                                store_id: parsedStoreId,
                                store_scope: resolvedScope,
                                position_type: 'kitchen',
                                phone: p.phone || null,
                                is_active: true,
                                password: hashedPassword,
                                toast_guid: p.toast_guid || null
                            })
                            .select('id, email')
                            .single()

                        if (!insErr && inserted) {
                            invalidateActiveUserStatusCache(inserted.id, inserted.email)
                            appliedPromotions++
                            promoSucceeded = true
                        } else if (insErr) {
                            await supabaseAdmin.auth.admin.deleteUser(newUserId)
                        }
                    }
                }

                // Deactivate conflicting user AFTER promotion succeeds
                if (promoSucceeded && p.deactivateCurrentId) {
                    const { data: deactTarget } = await supabaseAdmin
                        .from('users')
                        .select('id, email, role')
                        .eq('id', Number(p.deactivateCurrentId))
                        .maybeSingle()
                    if (
                        deactTarget &&
                        !PROTECTED_TEG_ROLES.has(String(deactTarget.role || '').trim().toLowerCase())
                    ) {
                        await supabaseAdmin
                            .from('users')
                            .update({ is_active: false, updated_at: new Date().toISOString() })
                            .eq('id', deactTarget.id)
                        invalidateActiveUserStatusCache(deactTarget.id, deactTarget.email)
                    }
                }
            }
        }

        // Process demotions
        if (Array.isArray(demotions)) {
            for (const d of demotions) {
                const targetId = Number(d?.id)
                if (!Number.isFinite(targetId) || targetId <= 0) continue
                const { data: demoteTarget } = await supabaseAdmin
                    .from('users')
                    .select('id, email, role')
                    .eq('id', targetId)
                    .maybeSingle()
                if (
                    !demoteTarget ||
                    PROTECTED_TEG_ROLES.has(String(demoteTarget.role || '').trim().toLowerCase())
                ) {
                    continue
                }
                await supabaseAdmin
                    .from('users')
                    .update({ is_active: false, updated_at: new Date().toISOString() })
                    .eq('id', demoteTarget.id)
                invalidateActiveUserStatusCache(demoteTarget.id, demoteTarget.email)
                appliedDemotions++
            }
        }

        return NextResponse.json({
            success: true,
            appliedPromotions,
            appliedDemotions
        })

    } catch (err: any) {
        console.error('❌ Error in sync-toast POST:', err)
        return NextResponse.json({ success: false, error: err.message }, { status: 500 })
    }
}
