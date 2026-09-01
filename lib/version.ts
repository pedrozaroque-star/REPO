/**
 * @module version
 * @description Master system version and release configuration for SM TEG (Sistema de Management Tacos Gavilan).
 * @businessRules
 * - Semantic Versioning (SemVer): v[MAJOR].[MINOR].[PATCH].
 * - Automatically maintained by Antigravity on monthly rollouts (v2.6.0 for September 2026) and operational patch releases.
 * - Displayed prominently in user profile menus across desktop and mobile.
 * @notes Single source of truth for app versioning across UI, chatbots, and documentation.
 */

export const SYSTEM_VERSION = {
    version: 'v2.6.0',
    versionNumber: '2.6.0',
    releaseMonthEs: 'Septiembre 2026',
    releaseMonthEn: 'September 2026',
    stage: 'Producción',
    stageEn: 'Production',
    year: '2026',
    labelEs: 'Septiembre 2026 • Producción',
    labelEn: 'September 2026 • Production',
    brand: 'SM TEG'
} as const;
