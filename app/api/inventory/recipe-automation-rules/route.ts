/**
 * @module api/inventory/recipe-automation-rules
 * @description Consulta y persiste reglas editables de consumo variable para recetas de Toast.
 * @businessRules Las cantidades fijas permanecen en recipes; las asignaciones históricas o
 *                provenientes de special requests se guardan separadas y nunca reemplazan recetas fijas.
 * @dataFlow toast_menu_items → recipe_automation_rules → motor único de consumo teórico.
 * @notes Las reglas aún no ejecutan pedidos: son la fuente versionada y auditable para la siguiente fase.
 */
import { NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/supabase'

const VALID_TYPES = new Set(['historical_allocation', 'special_request_protein_mix', 'channel_packaging'])

export async function GET(request: Request) {
  const guid = new URL(request.url).searchParams.get('guid')
  if (!guid) return NextResponse.json({ error: 'guid is required' }, { status: 400 })

  const supabase = await getSupabaseAdminClient()
  const { data, error } = await supabase
    .from('recipe_automation_rules')
    .select('id, rule_type, config, enabled, updated_at')
    .eq('toast_menu_item_guid', guid)
    .order('rule_type')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ rules: data || [] })
}

export async function PUT(request: Request) {
  const body = await request.json()
  const { toast_guid, rules } = body
  if (!toast_guid || !Array.isArray(rules)) {
    return NextResponse.json({ error: 'toast_guid and rules are required' }, { status: 400 })
  }
  if (rules.some((rule: any) => !VALID_TYPES.has(rule?.rule_type) || !rule?.config || typeof rule.config !== 'object')) {
    return NextResponse.json({ error: 'Invalid automation rule payload' }, { status: 400 })
  }

  const supabase = await getSupabaseAdminClient()
  const payload = rules.map((rule: any) => ({
    toast_menu_item_guid: toast_guid,
    rule_type: rule.rule_type,
    config: rule.config,
    enabled: rule.enabled !== false,
    updated_at: new Date().toISOString(),
  }))
  const { error } = await supabase
    .from('recipe_automation_rules')
    .upsert(payload, { onConflict: 'toast_menu_item_guid,rule_type' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
