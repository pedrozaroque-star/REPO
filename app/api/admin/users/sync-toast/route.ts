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
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder'

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
        persistSession: false,
        autoRefreshToken: false
    }
})

// ── Utility: Normalize job title to handle all variations ──
// "Asst. Manager" -> "asst manager"
// "Asst Manager"  -> "asst manager"
// "ASST MANAGER"  -> "asst manager"
// "Manager"       -> "manager"
function normalizeJobTitle(title: string): string {
    return title.toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim()
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
    if (normalized.includes('manager')) return 'manager'
    if (normalized.some(t => t === 'asst manager' || t === 'assistant manager')) return 'asistente'
    return null
}

export async function GET() {
    try {
        // 1. Fetch active stores
        const { data: dbStores, error: storesErr } = await supabaseAdmin
            .from('stores')
            .select('id, name, external_id')
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
            .select('id, email, full_name, role, store_id, is_active, phone, toast_guid')

        if (usersErr) throw usersErr

        // ── Mappings ──
        const storeMap = new Map<string, { id: number; name: string }>()
        dbStores?.forEach(s => {
            if (s.external_id) storeMap.set(s.external_id, { id: Number(s.id), name: s.name })
        })

        const jobMap = new Map<string, string>()
        dbJobs?.forEach(j => {
            jobMap.set(j.guid, j.title)
        })

        const pendingPromotions: any[] = []
        const matchedUserIds = new Set<number>() // Track matched users by ID (not email) to avoid false demotions
        const allToastEmployees: any[] = []

        // ── TRIPLE MATCHING FUNCTION ──
        // Priority: 1) toast_guid  2) email  3) name + store
        function findMatchingUser(toastGuid: string, email: string, fullName: string, storeId: number | null) {
            // Match 1: By toast_guid (strongest, permanent link)
            const byGuid = dbUsers?.find(u => u.toast_guid && u.toast_guid === toastGuid)
            if (byGuid) return byGuid

            // Match 2: By email (case-insensitive)
            const normEmail = email.trim().toLowerCase()
            if (normEmail) {
                const byEmail = dbUsers?.find(u => u.email?.trim().toLowerCase() === normEmail)
                if (byEmail) return byEmail
            }

            // Match 3: By normalized name + same store (fuzzy fallback)
            const normName = normalizeName(fullName)
            if (normName && storeId) {
                const byName = dbUsers?.find(u => {
                    if (!u.full_name || !u.is_active) return false
                    return normalizeName(u.full_name) === normName &&
                        Number(u.store_id) === storeId
                })
                if (byName) return byName
            }

            return null
        }

        dbEmployees?.forEach(emp => {
            const refs = Array.isArray(emp.job_references) ? emp.job_references : []
            const titles = refs.map((r: any) => jobMap.get(r.guid)).filter(Boolean) as string[]
            const toastRole = detectRole(titles)

            const storeGuid = emp.store_ids?.[0]
            const storeInfo = storeGuid ? storeMap.get(storeGuid) : null
            const fullName = `${emp.first_name || ''} ${emp.last_name || ''}`.trim()

            allToastEmployees.push({
                toast_guid: emp.toast_guid,
                full_name: fullName,
                email: emp.email || '',
                phone: emp.phone || '',
                store_id: storeInfo?.id || null,
                store_name: storeInfo?.name || null,
                suggested_role: toastRole,
                job_titles: titles
            })

            if (toastRole) {
                // Use triple matching to find existing user
                const existingUser = findMatchingUser(
                    emp.toast_guid,
                    emp.email || '',
                    fullName,
                    storeInfo?.id || null
                )

                if (existingUser) {
                    matchedUserIds.add(existingUser.id)
                }

                const isFullySynced = existingUser &&
                    existingUser.is_active &&
                    existingUser.role === toastRole &&
                    Number(existingUser.store_id) === Number(storeInfo?.id)

                if (!isFullySynced) {
                    // Conflict detection ONLY applies to MANAGERS (stores only have 1 Manager, but can have multiple Assistants like AM/PM)
                    const conflictingUser = (storeInfo && toastRole === 'manager') ? dbUsers?.find(u =>
                        u.is_active &&
                        u.role === 'manager' &&
                        Number(u.store_id) === Number(storeInfo.id) &&
                        u.id !== existingUser?.id
                    ) : null

                    pendingPromotions.push({
                        toast_guid: emp.toast_guid,
                        full_name: fullName,
                        email: emp.email || '',
                        phone: emp.phone || '',
                        role: toastRole,
                        store_id: storeInfo?.id || null,
                        store_name: storeInfo?.name || 'Desconocida',
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

        // Detect demotions (active managers/assistants NOT matched by ANY method)
        const pendingDemotions: any[] = []
        dbUsers?.forEach(user => {
            if (['manager', 'asistente'].includes(user.role) && user.is_active) {
                if (!matchedUserIds.has(user.id)) {
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
    try {
        const body = await req.json()
        const { promotions, demotions } = body

        let appliedPromotions = 0
        let appliedDemotions = 0

        // Process promotions
        if (Array.isArray(promotions)) {
            for (const p of promotions) {
                // Deactivate conflicting user if requested
                if (p.deactivateCurrentId) {
                    await supabaseAdmin
                        .from('users')
                        .update({ is_active: false })
                        .eq('id', p.deactivateCurrentId)
                }

                // Try to find existing user by toast_guid first, then email
                let existingUser: any = null

                if (p.toast_guid) {
                    const { data } = await supabaseAdmin
                        .from('users')
                        .select('id, auth_id')
                        .eq('toast_guid', p.toast_guid)
                        .maybeSingle()
                    existingUser = data
                }

                if (!existingUser) {
                    const uEmail = (p.email || '').trim().toLowerCase()
                    if (uEmail) {
                        const { data } = await supabaseAdmin
                            .from('users')
                            .select('id, auth_id')
                            .eq('email', uEmail)
                            .maybeSingle()
                        existingUser = data
                    }
                }

                if (existingUser) {
                    // Update user profile, activate, and link toast_guid
                    await supabaseAdmin
                        .from('users')
                        .update({
                            role: p.role,
                            store_id: p.store_id ? Number(p.store_id) : null,
                            is_active: true,
                            phone: p.phone || null,
                            full_name: p.full_name || undefined,
                            toast_guid: p.toast_guid || undefined
                        })
                        .eq('id', existingUser.id)
                    appliedPromotions++
                } else {
                    // Create in Supabase Auth + public.users with toast_guid
                    const defaultPassword = 'Gavilan' + new Date().getFullYear() + '!'
                    const emailToUse = (p.email || '').trim()
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
                        await supabaseAdmin
                            .from('users')
                            .insert({
                                auth_id: newUserId,
                                email: emailToUse,
                                full_name: p.full_name,
                                role: p.role,
                                store_id: p.store_id ? Number(p.store_id) : null,
                                phone: p.phone || null,
                                is_active: true,
                                password: defaultPassword,
                                toast_guid: p.toast_guid || null
                            })
                        appliedPromotions++
                    }
                }
            }
        }

        // Process demotions
        if (Array.isArray(demotions)) {
            for (const d of demotions) {
                await supabaseAdmin
                    .from('users')
                    .update({ is_active: false })
                    .eq('id', d.id)
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
