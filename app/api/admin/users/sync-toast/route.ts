/**
 * @module SyncToastUsersRoute
 * @description API route to query and synchronize Toast employee promotions, role updates, and demotions with system user profiles.
 * @businessRules
 * - Levels 1 (Cooks/Cashiers) and 2 (Shift Leaders) do not have portal credentials; they exist in `toast_employees` for labor/planning.
 * - Levels 3 (Asst. Manager), 4 (Manager), 5 (Supervisor), 6 (Admin) map to `users` portal accounts.
 * - Detects active Toast employees with 'Manager' or 'Asst. Manager' jobs who lack matching portal user profiles.
 * - Flags store-level manager/assistant conflicts so admins can deactivate current active managers/assistants when promoting new ones.
 * @dataFlow
 * - GET: Toast jobs + Toast employees + Stores + Users -> Matches & returns `pendingPromotions`, `pendingDemotions`, and `toastEmployees`.
 * - POST: Applies promotions (creating Auth user + inserting/updating `public.users`) and optional deactivations.
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

        // 4. Fetch users
        const { data: dbUsers, error: usersErr } = await supabaseAdmin
            .from('users')
            .select('id, email, full_name, role, store_id, is_active, phone')

        if (usersErr) throw usersErr

        // Mappings
        const storeMap = new Map<string, { id: number; name: string }>()
        dbStores?.forEach(s => {
            if (s.external_id) storeMap.set(s.external_id, { id: Number(s.id), name: s.name })
        })

        const jobMap = new Map<string, string>()
        dbJobs?.forEach(j => {
            jobMap.set(j.guid, j.title)
        })

        const pendingPromotions: any[] = []
        const matchedUserEmails = new Set<string>()
        const allToastEmployees: any[] = []

        dbEmployees?.forEach(emp => {
            const refs = Array.isArray(emp.job_references) ? emp.job_references : []
            const titles = refs.map((r: any) => jobMap.get(r.guid)).filter(Boolean) as string[]

            const isManager = titles.includes('Manager')
            const isAsstManager = titles.includes('Asst. Manager') || titles.includes('Assistant Manager')

            const storeGuid = emp.store_ids?.[0]
            const storeInfo = storeGuid ? storeMap.get(storeGuid) : null
            const fullName = `${emp.first_name || ''} ${emp.last_name || ''}`.trim()
            const empEmail = (emp.email || '').trim().toLowerCase()

            allToastEmployees.push({
                toast_guid: emp.toast_guid,
                full_name: fullName,
                email: emp.email || '',
                phone: emp.phone || '',
                store_id: storeInfo?.id || null,
                store_name: storeInfo?.name || null,
                suggested_role: isManager ? 'manager' : (isAsstManager ? 'asistente' : null),
                job_titles: titles
            })

            if (isManager || isAsstManager) {
                const toastRole = isManager ? 'manager' : 'asistente'
                if (empEmail) matchedUserEmails.add(empEmail)

                const existingUser = dbUsers?.find(u => u.email?.trim().toLowerCase() === empEmail)
                const isFullySynced = existingUser &&
                    existingUser.is_active &&
                    existingUser.role === toastRole &&
                    Number(existingUser.store_id) === Number(storeInfo?.id)

                if (!isFullySynced) {
                    const conflictingUser = storeInfo ? dbUsers?.find(u =>
                        u.is_active &&
                        u.role === toastRole &&
                        Number(u.store_id) === Number(storeInfo.id) &&
                        u.email?.trim().toLowerCase() !== empEmail
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
                            is_active: existingUser.is_active
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

        // Detect demotions (active managers/assistants in users table who aren't managers/assistants in Toast)
        const pendingDemotions: any[] = []
        dbUsers?.forEach(user => {
            if (['manager', 'asistente'].includes(user.role) && user.is_active) {
                const uEmail = (user.email || '').trim().toLowerCase()
                if (!uEmail || !matchedUserEmails.has(uEmail)) {
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

                const uEmail = (p.email || '').trim().toLowerCase()
                if (!uEmail) continue

                const { data: existingUser } = await supabaseAdmin
                    .from('users')
                    .select('id, auth_id')
                    .eq('email', uEmail)
                    .maybeSingle()

                if (existingUser) {
                    // Update user profile and activate
                    await supabaseAdmin
                        .from('users')
                        .update({
                            role: p.role,
                            store_id: p.store_id ? Number(p.store_id) : null,
                            is_active: true,
                            phone: p.phone || null,
                            full_name: p.full_name || undefined
                        })
                        .eq('id', existingUser.id)
                    appliedPromotions++
                } else {
                    // Create in Supabase Auth + public.users
                    const defaultPassword = 'Gavilan' + new Date().getFullYear() + '!'
                    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
                        email: p.email,
                        password: defaultPassword,
                        email_confirm: true,
                        user_metadata: {
                            full_name: p.full_name
                        }
                    })

                    if (authError) {
                        console.error('❌ Auth error creating promoted user:', p.email, authError.message)
                        continue
                    }

                    const newUserId = authData.user?.id
                    if (newUserId) {
                        await supabaseAdmin
                            .from('users')
                            .insert({
                                auth_id: newUserId,
                                email: p.email,
                                full_name: p.full_name,
                                role: p.role,
                                store_id: p.store_id ? Number(p.store_id) : null,
                                phone: p.phone || null,
                                is_active: true,
                                password: defaultPassword
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
