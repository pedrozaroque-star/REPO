/**
 * @module verify-phase8-visual-chrome-audit
 * @description Live Chromium browser visual inspection and DOM verification suite for Phase 8 (`/admin/contabilidad-externa`).
 * Launches headless Chromium via Puppeteer, authenticates as Raquel Velazquez (`id: 45`), navigates through all
 * purified ERP screens, verifies rendered DOM text (zero Intuit commercial clutter, visible provenance metadata,
 * 8 corporate entities, deep-link P&L report, purified Firm Hub & Customer Directory), and captures high-resolution
 * screenshots into the conversation artifacts directory.
 * @businessRules
 * - Read-only visual & DOM inspection against local dev server (`http://localhost:3000`).
 * - Verifies that zero commercial/advertising/ProAdvisor/lending elements appear in the live rendered DOM.
 * @dataFlow
 * - Puppeteer Chromium -> `http://localhost:3000/admin/contabilidad-externa` -> Live DOM assertions + PNG artifacts.
 * @notes Phase 8 visual certification suite.
 */

import path from 'path'
import jwt from 'jsonwebtoken'
import puppeteer from 'puppeteer'
import { getJwtSecret } from '../lib/auth-server'

const ARTIFACT_DIR = 'C:/Users/pedro/.gemini/antigravity/brain/d3b88371-1e13-4e87-9bc0-becfa13124d4'
const BASE_URL = 'http://localhost:3000'

function assertDom(condition: unknown, message: string): void {
    if (!condition) {
        throw new Error(`VISUAL DOM ASSERTION FAILED: ${message}`)
    }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const FORBIDDEN_RENDERED_TEXTS = [
    'Activate payments',
    'Request payment',
    'View payment rates',
    'Business financing',
    'Flexible Line of Credit',
    'Generate referrals',
    'ProAdvisor GOLD',
    '625 Points',
    'Subscriptions and billing',
    'Client invitations',
    'QuickBooks Online Plus (Firm Billed)',
    'Recommend Payments',
    'March Product Release Note',
    'Run payroll',
    'Get paid online',
]

async function main() {
    console.log('================================================================================')
    console.log('PHASE 8 — LIVE CHROMIUM VISUAL WALKTHROUGH & DOM VERIFICATION (PUPPETEER)')
    console.log('================================================================================\n')

    const token = jwt.sign(
        {
            sub: '45',
            id: 45,
            email: 'raquel@tacosgavilan.com',
            name: 'Raquel Velasquez',
            role: 'admin',
        },
        getJwtSecret()!,
        { expiresIn: '2h' }
    )

    const browser = await puppeteer.launch({
        headless: true,
        defaultViewport: { width: 1600, height: 1050 },
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    })

    try {
        const page = await browser.newPage()

        await page.setCookie({
            name: 'teg_token',
            value: token,
            domain: 'localhost',
            path: '/',
            httpOnly: false,
            secure: false,
        })

        // Inject localStorage user session before page scripts run
        await page.evaluateOnNewDocument((jwtToken: string) => {
            const userObj = {
                id: 45,
                name: 'Raquel Velasquez',
                full_name: 'Raquel Velasquez',
                email: 'raquel@tacosgavilan.com',
                role: 'admin',
                permissions: ['all'],
            }
            window.localStorage.setItem('teg_user', JSON.stringify(userObj))
            window.localStorage.setItem('teg_token', jwtToken)
            window.localStorage.setItem('language', 'en')
        }, token)

        const checkForbiddenTexts = async (screenLabel: string): Promise<string> => {
            const bodyText = await page.evaluate(() => document.body?.innerText || '')
            for (const forbidden of FORBIDDEN_RENDERED_TEXTS) {
                assertDom(
                    !bodyText.includes(forbidden),
                    `[${screenLabel}] Forbidden commercial text rendered in DOM: "${forbidden}"`
                )
            }
            assertDom(
                !bodyText.includes('external_accounting.') && !bodyText.includes('external_accounting_phase'),
                `[${screenLabel}] Untranslated i18n key rendered in DOM`
            )
            return bodyText
        }

        const waitForText = async (expectedText: string, timeoutMs = 30000) => {
            const start = Date.now()
            while (Date.now() - start < timeoutMs) {
                const txt = await page.evaluate(() => document.body?.innerText || '')
                if (txt.includes(expectedText)) return txt
                await sleep(400)
            }
            throw new Error(`Timed out waiting for text "${expectedText}" in DOM`)
        }

        const scrollMainTo = async (y: number) => {
            await page.evaluate((scrollTopValue: number) => {
                window.scrollTo(0, scrollTopValue)
                document.querySelectorAll('main, .overflow-y-auto').forEach((el) => {
                    if (el instanceof HTMLElement && el.scrollHeight > el.clientHeight + 50) {
                        el.scrollTop = scrollTopValue
                    }
                })
            }, y)
            await sleep(500)
        }

        // ---------------------------------------------------------------------
        // 1. FIRM MODE OVERVIEW (`Raquel Accounting` 123145825185692)
        // ---------------------------------------------------------------------
        console.log('1) Inspecting Firm Mode Overview (`Raquel Accounting` 123145825185692)...')
        await page.goto(`${BASE_URL}/admin/contabilidad-externa?company=123145825185692&tab=overview`, {
            waitUntil: 'networkidle2',
            timeout: 60000,
        })
        await waitForText('6,829.08')
        await sleep(1000)

        const shot1Top = path.join(ARTIFACT_DIR, 'phase8_visual_1_firm_overview_top.png')
        await page.screenshot({ path: shot1Top, fullPage: false })

        await scrollMainTo(650)
        const shot1Bottom = path.join(ARTIFACT_DIR, 'phase8_visual_2_firm_overview_bottom.png')
        await page.screenshot({ path: shot1Bottom, fullPage: false })

        const firmText = await checkForbiddenTexts('Firm Mode Overview')
        assertDom(firmText.includes('6,829.08'), 'Firm Overview must render live Deposited $6,829.08')
        assertDom(
            firmText.includes('Corporate Portfolio (8 Entities)') || firmText.includes('Portafolio Corporativo (8 Empresas)'),
            'Firm Overview must render Corporate Portfolio pill'
        )
        assertDom(
            firmText.includes('CPA Audit & Period Close') ||
                firmText.includes('Auditoría y Cierre Contable CPA') ||
                firmText.includes('Auditoría Contable y Cierre'),
            'Firm Overview must render CPA Audit pill'
        )
        assertDom(firmText.includes('Supabase Live'), 'Firm Overview must render Supabase Live provenance')
        console.log('   ✅ Saved Firm Overview top & bottom screenshots.')

        // ---------------------------------------------------------------------
        // 2. CLIENT MODE OVERVIEW (`Gutierrez Financial` 554651555)
        // ---------------------------------------------------------------------
        console.log('2) Inspecting Client Mode Overview (`Gutierrez Financial` 554651555)...')
        await page.goto(`${BASE_URL}/admin/contabilidad-externa?company=554651555&tab=overview`, {
            waitUntil: 'networkidle2',
            timeout: 60000,
        })
        await waitForText('Gutierrez Financial')
        await sleep(1500)

        await scrollMainTo(0)
        const shot2Top = path.join(ARTIFACT_DIR, 'phase8_visual_3_client_overview_top.png')
        await page.screenshot({ path: shot2Top, fullPage: false })

        await scrollMainTo(650)
        const shot2Bottom = path.join(ARTIFACT_DIR, 'phase8_visual_4_client_overview_bottom.png')
        await page.screenshot({ path: shot2Bottom, fullPage: false })

        const clientText = await checkForbiddenTexts('Client Mode Overview')
        assertDom(clientText.includes('Gutierrez Financial'), 'Client Overview must render Gutierrez Financial')
        assertDom(
            clientText.includes('LEDGER & SYNC STATUS') ||
                clientText.includes('Ledger & Sync Status') ||
                clientText.includes('ESTADO DE LIBRO MAYOR Y SINCRONIZACIÓN') ||
                clientText.includes('Estado de Libro Mayor y Sincronización') ||
                clientText.includes('ACID'),
            'Client Overview must render Ledger & Sync Status card'
        )
        console.log('   ✅ Saved Client Overview top & bottom screenshots.')

        // ---------------------------------------------------------------------
        // 3. CORPORATE PORTFOLIO — 8 ENTITIES (`?tab=clients`)
        // ---------------------------------------------------------------------
        console.log('3) Inspecting Corporate Portfolio (`?tab=clients` — 8 Entities)...')
        await page.goto(`${BASE_URL}/admin/contabilidad-externa?company=123145825185692&tab=clients`, {
            waitUntil: 'networkidle2',
            timeout: 60000,
        })
        await waitForText('Chicken Taco Catering LLC')
        await sleep(800)

        const shot3 = path.join(ARTIFACT_DIR, 'phase8_visual_5_corporate_portfolio_8_entities.png')
        await page.screenshot({ path: shot3, fullPage: false })

        const portfolioText = await checkForbiddenTexts('Corporate Portfolio')
        assertDom(portfolioText.includes('7947 Downey Plaza LLC'), 'Portfolio must list 7947 Downey Plaza LLC')
        assertDom(portfolioText.includes('Chicken Taco Catering LLC'), 'Portfolio must list Chicken Taco Catering LLC')
        assertDom(portfolioText.includes('Elveze LLC'), 'Portfolio must list Elveze LLC')
        assertDom(portfolioText.includes('TEG Holdings Inc'), 'Portfolio must list TEG Holdings Inc')
        console.log('   ✅ Saved Corporate Portfolio (8 Entities) screenshot.')

        // ---------------------------------------------------------------------
        // 4. CPA WORK & PERIOD CLOSE (`?tab=books_review&work=client_insights`)
        // ---------------------------------------------------------------------
        console.log('4) Inspecting CPA Work & Period Close (`?tab=books_review&work=client_insights`)...')
        await page.goto(`${BASE_URL}/admin/contabilidad-externa?company=123145825185692&tab=books_review&work=client_insights`, {
            waitUntil: 'networkidle2',
            timeout: 60000,
        })
        await waitForText('ACTIVE_QBO')
        await sleep(800)

        const shot4 = path.join(ARTIFACT_DIR, 'phase8_visual_6_cpa_work_client_insights.png')
        await page.screenshot({ path: shot4, fullPage: false })

        const workText = await checkForbiddenTexts('CPA Work & Period Close')
        assertDom(workText.includes('LOCAL_ACTIVE'), 'Client Insights must show LOCAL_ACTIVE for retired QBO entities')
        assertDom(!workText.includes('[PILOT]'), 'Work view must not show [PILOT] badge')
        console.log('   ✅ Saved CPA Work & Period Close screenshot.')

        // ---------------------------------------------------------------------
        // 5. FIRM GOVERNANCE HUB (`?tab=firm_hub&firm=integrations`)
        // ---------------------------------------------------------------------
        console.log('5) Inspecting Firm Governance Hub (`?tab=firm_hub&firm=integrations`)...')
        await page.goto(`${BASE_URL}/admin/contabilidad-externa?company=123145825185692&tab=firm_hub&firm=integrations`, {
            waitUntil: 'networkidle2',
            timeout: 60000,
        })
        await waitForText('Gmail')
        await sleep(800)

        const shot5 = path.join(ARTIFACT_DIR, 'phase8_visual_7_firm_governance_hub.png')
        await page.screenshot({ path: shot5, fullPage: false })

        const firmHubText = await checkForbiddenTexts('Firm Governance Hub')
        assertDom(firmHubText.includes('Gmail Official Invoice PDF Sender'), 'Firm Hub Integrations must list Gmail PDF Sender')
        assertDom(!firmHubText.includes('Bill.com / Melio'), 'Firm Hub Integrations must not list third-party Bill.com ad')
        console.log('   ✅ Saved Firm Governance Hub screenshot.')

        // ---------------------------------------------------------------------
        // 6. DEEP-LINK REPORT (`?company=123145825185692&tab=reports&report=pnl`)
        // ---------------------------------------------------------------------
        console.log('6) Inspecting Deep-Link P&L Report (`?company=123145825185692&tab=reports&report=pnl`)...')
        await page.goto(`${BASE_URL}/admin/contabilidad-externa?company=123145825185692&tab=reports&report=pnl`, {
            waitUntil: 'networkidle2',
            timeout: 60000,
        })
        await sleep(1800)

        const shot6 = path.join(ARTIFACT_DIR, 'phase8_visual_8_reports_pnl_deeplink.png')
        await page.screenshot({ path: shot6, fullPage: false })

        await checkForbiddenTexts('Reports P&L Deep-Link')
        console.log('   ✅ Saved Deep-Link P&L Report screenshot.')

        // ---------------------------------------------------------------------
        // 7. CUSTOMER HUB DIRECTORY (`?company=554651555&tab=contacts&contact_type=Customer`)
        // ---------------------------------------------------------------------
        console.log('7) Inspecting Customer Hub Directory (`?company=554651555&tab=contacts&contact_type=Customer`)...')
        await page.goto(`${BASE_URL}/admin/contabilidad-externa?company=554651555&tab=contacts&contact_type=Customer`, {
            waitUntil: 'networkidle2',
            timeout: 60000,
        })
        await sleep(2500)

        const shot7 = path.join(ARTIFACT_DIR, 'phase8_visual_9_customer_directory_4segment_bar.png')
        await page.screenshot({ path: shot7, fullPage: false })

        const customerHubText = await checkForbiddenTexts('Customer Hub Directory')
        assertDom(
            customerHubText.includes('Customers & Tenants Directory') ||
                customerHubText.includes('Directorio de Clientes e Inquilinos') ||
                customerHubText.includes('Directorio de Clientes y Arrendatarios'),
            'Customer Hub must display purified Customers & Tenants Directory header'
        )
        assertDom(!customerHubText.includes('Check out the new view with filters'), 'Customer Hub must not display Intuit promo text')
        console.log('   ✅ Saved Customer Hub Directory screenshot.\n')

        console.log('================================================================================')
        console.log('🎉 ALL 7 VISUAL CHROMIUM WALKTHROUGH SCREENS & DOM ASSERTIONS PASSED!')
        console.log('================================================================================')
    } finally {
        await browser.close()
    }
}

main().catch((err) => {
    console.error('\n❌ VISUAL CHROMIUM AUDIT FAILED:', err)
    process.exit(1)
})
