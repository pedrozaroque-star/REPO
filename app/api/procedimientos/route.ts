import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { authorizeStoreScope, getServerUser } from '@/lib/auth-server';
import {
    evaluateProcedureSafetyReview,
    hasUnsafeChemicalMixture,
    sanitizeUnsafeProcedureDescription,
} from '@/lib/actividades-resolution';
import { parseTimeToMinutesStrict } from '@/lib/store-time-offset';

/**
 * @module ProcedimientosAPI
 * @description CRUD API para `operating_procedures` (catálogo corporativo de actividades).
 * @businessRules
 *   - GET requiere sesión autenticada válida (`A18`) y devuelve descripciones sanitizadas + banderas de revisión de seguridad (`requires_safety_review`, `needs_review`).
 *   - POST/PATCH requieren rol `admin` o `supervisor` (`action: 'manage_catalog'`; `manager` y `shift_leader` tienen acceso de solo lectura al catálogo global).
 *   - POST/PATCH rechazan cualquier instrucción que sugiera mezclar cloro con desengrasante, ácido, amoníaco o jabón (`hasUnsafeChemicalMixture`), y marcan los procedimientos nuevos o editados con `needs_manager_safety_review: true` hasta su validación.
 *   - DELETE requiere exclusivamente rol `admin` (`A19`).
 *   - Registra trazabilidad de auditoría (`created_by_*`, `updated_by_*`) desde el JWT verificado.
 * @dataFlow
 *   - Reads/writes to `operating_procedures` table via `supabaseAdmin`.
 */

// ═══════════════════════════════════════
// GET - Obtener todos los procedimientos
// ═══════════════════════════════════════
export async function GET(request: Request) {
    try {
        const user = await getServerUser(request);
        if (!user) {
            return NextResponse.json(
                { success: false, error: 'No autenticado. Inicia sesión para consultar el catálogo.' },
                { status: 401 }
            );
        }

        const { data, error } = await supabaseAdmin
            .from('operating_procedures')
            .select('*')
            .order('start_time', { ascending: true });

        if (error) throw error;

        const enriched = (data || []).map((proc: any) => {
            const safety = evaluateProcedureSafetyReview(proc);
            return {
                ...proc,
                description: sanitizeUnsafeProcedureDescription(proc.description),
                requires_safety_review: safety.requiresSafetyReview,
                safety_review_categories: safety.categories,
                needs_review: safety.needsReview,
            };
        });

        return NextResponse.json({ success: true, data: enriched, procedures: enriched });
    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}

// ═══════════════════════════════════════
// PATCH - Editar un procedimiento (SOLO ADMIN / SUPERVISOR)
// ═══════════════════════════════════════
export async function PATCH(request: Request) {
    try {
        const user = await getServerUser(request);
        const authScope = await authorizeStoreScope(user, null, supabaseAdmin, {
            action: 'manage_catalog',
            allowedRoles: ['admin', 'supervisor'],
        });
        if (!authScope.authorized || !user) {
            return NextResponse.json(
                {
                    error:
                        authScope.error ||
                        'Acceso denegado: Solo Admin o Supervisor pueden modificar el catálogo corporativo.',
                },
                { status: authScope.status || 403 }
            );
        }

        const body = await request.json();
        const {
            id,
            start_time,
            duration_minutes,
            activity,
            frequency,
            role,
            description,
            shift_type,
            shift,
            overrides,
            store_model,
            safety_approved,
        } = body;

        if (!id) {
            return NextResponse.json({ success: false, error: 'ID is required' }, { status: 400 });
        }

        if (
            (description !== undefined && hasUnsafeChemicalMixture(String(description))) ||
            (activity !== undefined && hasUnsafeChemicalMixture(String(activity)))
        ) {
            return NextResponse.json(
                {
                    success: false,
                    error: 'Por seguridad industrial, está prohibido instruir la mezcla de cloro con desengrasante, ácido, amoníaco o jabón.',
                },
                { status: 400 }
            );
        }

        if (start_time !== undefined && start_time !== null && String(start_time).trim() !== '') {
            if (parseTimeToMinutesStrict(String(start_time).trim()) === null) {
                return NextResponse.json(
                    {
                        success: false,
                        error: `Formato de start_time inválido ("${String(start_time)}"). Use HH:MM o HH:MM:SS válido (00:00–23:59).`,
                        code: 'INVALID_START_TIME',
                    },
                    { status: 400 }
                );
            }
        }

        if (overrides && typeof overrides === 'object' && overrides.stores && typeof overrides.stores === 'object') {
            for (const [storeKey, storeOv] of Object.entries(overrides.stores as Record<string, Record<string, unknown>>)) {
                const ovTime = storeOv?.start_time ?? storeOv?.startTime;
                if (ovTime !== undefined && ovTime !== null && String(ovTime).trim() !== '') {
                    if (parseTimeToMinutesStrict(String(ovTime).trim()) === null) {
                        return NextResponse.json(
                            {
                                success: false,
                                error: `Formato de start_time inválido en override de tienda "${storeKey}" ("${String(ovTime)}").`,
                                code: 'INVALID_STORE_OVERRIDE_START_TIME',
                            },
                            { status: 400 }
                        );
                    }
                }
            }
        }

        const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };
        if (start_time !== undefined) updateData.start_time = start_time ? String(start_time).trim() : null;
        if (duration_minutes !== undefined) {
            const parsedDuration = Number(duration_minutes);
            updateData.duration_minutes =
                duration_minutes !== null &&
                duration_minutes !== '' &&
                Number.isFinite(parsedDuration)
                    ? parsedDuration
                    : null;
        }
        if (activity !== undefined) updateData.activity = String(activity).trim();
        if (shift_type !== undefined) updateData.shift_type = String(shift_type).trim();
        if (frequency !== undefined) updateData.frequency = String(frequency).trim();
        if (role !== undefined) updateData.role = role;
        if (description !== undefined) {
            updateData.description = sanitizeUnsafeProcedureDescription(String(description));
        }
        if (shift !== undefined) updateData.shift = shift;

        if (
            overrides !== undefined ||
            activity !== undefined ||
            description !== undefined ||
            safety_approved !== undefined
        ) {
            const { data: existingRow, error: existingErr } = await supabaseAdmin
                .from('operating_procedures')
                .select('id, overrides')
                .eq('id', id)
                .maybeSingle();

            if (existingErr) {
                return NextResponse.json(
                    {
                        success: false,
                        error: `No se pudo leer el estado actual de overrides antes de guardar: ${existingErr.message}`,
                        code: 'PROCEDIMIENTO_OVERRIDE_READ_FAILED',
                    },
                    { status: 500 }
                );
            }
            if (!existingRow) {
                return NextResponse.json(
                    { success: false, error: 'Procedimiento no encontrado.' },
                    { status: 404 }
                );
            }

            const prevOverrides =
                existingRow.overrides && typeof existingRow.overrides === 'object'
                    ? { ...existingRow.overrides }
                    : {};
            const incomingOverrides =
                overrides && typeof overrides === 'object' ? { ...overrides } : {};

            const mergedStores = {
                ...(prevOverrides.stores && typeof prevOverrides.stores === 'object'
                    ? prevOverrides.stores
                    : {}),
                ...(incomingOverrides.stores && typeof incomingOverrides.stores === 'object'
                    ? incomingOverrides.stores
                    : {}),
            };

            const baseOverrides: Record<string, unknown> = {
                ...prevOverrides,
                ...incomingOverrides,
            };
            if (Object.keys(mergedStores).length > 0 || incomingOverrides.stores !== undefined) {
                baseOverrides.stores = mergedStores;
            }

            if (safety_approved === true && user.role === 'admin') {
                baseOverrides.needs_manager_safety_review = false;
                baseOverrides.safety_approved_by = user.name || user.email;
                baseOverrides.safety_approved_at = new Date().toISOString();
            } else if (activity !== undefined || description !== undefined) {
                baseOverrides.needs_manager_safety_review = true;
            }

            updateData.overrides = baseOverrides;
        }

        if (store_model !== undefined) updateData.store_model = store_model;

        if (user.id) updateData.updated_by_id = String(user.id);
        if (user.name) updateData.updated_by_name = user.name;

        const { data, error } = await supabaseAdmin
            .from('operating_procedures')
            .update(updateData)
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;

        return NextResponse.json({ success: true, data });
    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message }, { status: 400 });
    }
}

// ═══════════════════════════════════════
// POST - Crear un nuevo procedimiento (SOLO ADMIN / SUPERVISOR)
// ═══════════════════════════════════════
export async function POST(request: Request) {
    try {
        const user = await getServerUser(request);
        const authScope = await authorizeStoreScope(user, null, supabaseAdmin, {
            action: 'manage_catalog',
            allowedRoles: ['admin', 'supervisor'],
        });
        if (!authScope.authorized || !user) {
            return NextResponse.json(
                {
                    error:
                        authScope.error ||
                        'Acceso denegado: Solo Admin o Supervisor pueden crear actividades en el catálogo corporativo.',
                },
                { status: authScope.status || 403 }
            );
        }

        const body = await request.json();
        const {
            start_time,
            duration_minutes,
            activity,
            frequency,
            role,
            description,
            shift_type,
            shift,
            overrides,
            store_model,
        } = body;

        if (!activity || !shift_type) {
            return NextResponse.json(
                {
                    success: false,
                    error: 'Actividad y categoría son obligatorios',
                },
                { status: 400 }
            );
        }

        if (
            hasUnsafeChemicalMixture(String(description || '')) ||
            hasUnsafeChemicalMixture(String(activity || ''))
        ) {
            return NextResponse.json(
                {
                    success: false,
                    error: 'Por seguridad industrial, está prohibido instruir la mezcla de cloro con desengrasante, ácido, amoníaco o jabón.',
                },
                { status: 400 }
            );
        }

        if (start_time !== undefined && start_time !== null && String(start_time).trim() !== '') {
            if (parseTimeToMinutesStrict(String(start_time).trim()) === null) {
                return NextResponse.json(
                    {
                        success: false,
                        error: `Formato de start_time inválido ("${String(start_time)}"). Use HH:MM o HH:MM:SS válido (00:00–23:59).`,
                        code: 'INVALID_START_TIME',
                    },
                    { status: 400 }
                );
            }
        }

        const parsedDuration = Number(duration_minutes);
        const preparedOverrides = {
            ...(overrides && typeof overrides === 'object' ? overrides : {}),
            needs_manager_safety_review: true,
        };

        const insertData: Record<string, unknown> = {
            start_time: start_time ? String(start_time).trim() : null,
            duration_minutes:
                duration_minutes !== null &&
                duration_minutes !== undefined &&
                duration_minutes !== '' &&
                Number.isFinite(parsedDuration)
                    ? parsedDuration
                    : null,
            activity: String(activity).trim(),
            shift_type: String(shift_type).trim(),
            frequency: frequency ? String(frequency).trim() : 'Diario',
            role: role || null,
            description: description ? sanitizeUnsafeProcedureDescription(String(description)) : null,
            shift: shift || 'AMBOS',
            overrides: preparedOverrides,
            store_model: store_model || 'AMBOS',
        };

        if (user.id) {
            insertData.created_by_id = String(user.id);
            insertData.updated_by_id = String(user.id);
        }
        if (user.name) {
            insertData.created_by_name = user.name;
            insertData.updated_by_name = user.name;
        }

        const { data, error } = await supabaseAdmin
            .from('operating_procedures')
            .insert(insertData)
            .select()
            .single();

        if (error) throw error;

        return NextResponse.json({ success: true, data });
    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message }, { status: 400 });
    }
}

// ═══════════════════════════════════════
// DELETE - Eliminar un procedimiento (SOLO ADMIN)
// ═══════════════════════════════════════
export async function DELETE(request: Request) {
    try {
        const user = await getServerUser(request);
        const authScope = await authorizeStoreScope(user, null, supabaseAdmin, {
            action: 'manage_catalog',
            allowedRoles: ['admin'],
        });
        if (!authScope.authorized || !user) {
            return NextResponse.json(
                {
                    success: false,
                    error: 'ADMIN_ONLY',
                    message: authScope.error || 'Solo la cuenta de Administrador puede eliminar actividades',
                },
                { status: authScope.status || 403 }
            );
        }

        const body = await request.json();
        const { id } = body;

        if (!id) {
            return NextResponse.json({ success: false, error: 'ID is required' }, { status: 400 });
        }

        const { error } = await supabaseAdmin.from('operating_procedures').delete().eq('id', id);

        if (error) throw error;

        return NextResponse.json({ success: true });
    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message }, { status: 400 });
    }
}
