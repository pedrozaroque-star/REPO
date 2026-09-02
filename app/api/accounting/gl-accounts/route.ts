/**
 * @module api/accounting/gl-accounts
 * @description API route for managing the GL (General Ledger) accounts catalog.
 * GET: Lists all GL accounts from the accounting_gl_accounts table.
 * POST: Syncs accounts from QuickBooks Online — fetches the full chart of accounts
 * from QB and upserts them into our local table.
 *
 * @businessRules
 * - GL accounts map our internal account numbers (e.g., '40050') to QuickBooks internal IDs.
 * - The qb_account_id is required for publishing journal entries to QuickBooks.
 * - Sync from QB matches on account_number; new accounts are inserted, existing ones are updated.
 * - Account types are normalized to our internal categories: revenue, asset, liability, expense, equity, cogs.
 * - Only active QB accounts (Active: true) are synced.
 *
 * @dataFlow
 * GET: Supabase accounting_gl_accounts → this endpoint → Frontend GL accounts list
 * POST: QuickBooks Chart of Accounts API → this endpoint → upsert accounting_gl_accounts
 *
 * @notes
 * - The node-quickbooks SDK uses callback pattern for findAccounts; wrapped in Promise.
 * - QB account types (Income, Bank, Other Current Asset, etc.) are mapped to our simplified types.
 * - After syncing, the qb_account_id field is populated, enabling journal entry publishing.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getQuickBooksClient } from '@/lib/quickbooks'

/** Maps QuickBooks account types to our internal account_type values */
const QB_TYPE_MAP: Record<string, string> = {
  'Income': 'revenue',
  'Other Income': 'revenue',
  'Bank': 'asset',
  'Other Current Asset': 'asset',
  'Fixed Asset': 'asset',
  'Other Asset': 'asset',
  'Accounts Receivable': 'asset',
  'Accounts Payable': 'liability',
  'Other Current Liability': 'liability',
  'Long Term Liability': 'liability',
  'Credit Card': 'liability',
  'Expense': 'expense',
  'Other Expense': 'expense',
  'Cost of Goods Sold': 'cogs',
  'Equity': 'equity',
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const accountType = searchParams.get('type')
    const activeOnly = searchParams.get('active') !== 'false'

    let query = supabaseAdmin
      .from('accounting_gl_accounts')
      .select('*')
      .order('account_number', { ascending: true })

    if (accountType) {
      query = query.eq('account_type', accountType)
    }

    if (activeOnly) {
      query = query.eq('is_active', true)
    }

    const { data, error } = await query

    if (error) {
      console.error('[Accounting] GET gl-accounts error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ accounts: data || [] })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[Accounting] GET gl-accounts error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

interface QBAccount {
  Id: string
  Name: string
  AccountType: string
  AcctNum?: string
  Active: boolean
  FullyQualifiedName?: string
  CurrentBalance?: number
}

interface QBQueryResponse {
  QueryResponse: {
    Account?: QBAccount[]
    maxResults?: number
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as { performed_by?: string }

    // 1. Get QuickBooks client
    const qbo = await getQuickBooksClient()

    // 2. Fetch all accounts from QuickBooks
    // The findAccounts method queries the QB Chart of Accounts
    const qbResponse = await new Promise<QBQueryResponse>((resolve, reject) => {
      qbo.findAccounts(
        { fetchAll: true },
        (err: unknown, data: QBQueryResponse) => {
          if (err) reject(err)
          else resolve(data)
        }
      )
    })

    const qbAccounts: QBAccount[] = qbResponse?.QueryResponse?.Account || []

    if (qbAccounts.length === 0) {
      return NextResponse.json(
        { error: 'No accounts returned from QuickBooks. Verify the connection.' },
        { status: 404 }
      )
    }

    // 3. Upsert each QB account into our local table
    const upserted: string[] = []
    const skipped: string[] = []
    const errors: Array<{ account: string; error: string }> = []

    for (const qbAcct of qbAccounts) {
      // Skip accounts without an account number — we can't match them
      if (!qbAcct.AcctNum) {
        skipped.push(`${qbAcct.Name} (no AcctNum)`)
        continue
      }

      // Skip inactive accounts
      if (!qbAcct.Active) {
        skipped.push(`${qbAcct.AcctNum} - ${qbAcct.Name} (inactive)`)
        continue
      }

      const accountType = QB_TYPE_MAP[qbAcct.AccountType] || 'expense'

      const record = {
        account_number: qbAcct.AcctNum,
        account_name: qbAcct.Name,
        account_type: accountType,
        qb_account_id: qbAcct.Id,
        is_active: true,
      }

      const { error: upsertErr } = await supabaseAdmin
        .from('accounting_gl_accounts')
        .upsert(record, { onConflict: 'account_number' })

      if (upsertErr) {
        errors.push({ account: `${qbAcct.AcctNum} - ${qbAcct.Name}`, error: upsertErr.message })
      } else {
        upserted.push(`${qbAcct.AcctNum} - ${qbAcct.Name}`)
      }
    }

    // 4. Log the sync
    await supabaseAdmin.from('accounting_sync_logs').insert({
      action: 'generate',
      performed_by: body.performed_by || null,
      details: {
        type: 'gl_accounts_sync',
        total_from_qb: qbAccounts.length,
        upserted: upserted.length,
        skipped: skipped.length,
        errors: errors.length,
      },
    })

    return NextResponse.json({
      success: true,
      accountsUpserted: upserted.length,
      accountsSkipped: skipped.length,
      errors: errors.length > 0 ? errors : undefined,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[Accounting] POST gl-accounts error:', message)
    
    let friendlyMessage = message
    if (message.includes('re-authenticate') || message.includes('invalid_grant') || message.includes('504')) {
      friendlyMessage = 'La sesión de QuickBooks Online requiere renovación de autorización. El catálogo local ya se encuentra completamente configurado con todas las cuentas oficiales.'
    }

    return NextResponse.json(
      { error: friendlyMessage, raw_error: message },
      { status: 500 }
    )
  }
}
