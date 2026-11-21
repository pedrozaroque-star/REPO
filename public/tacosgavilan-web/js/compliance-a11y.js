/**
 * @file compliance-a11y.js
 * @module TacosGavilanCompliance
 * @description Enterprise California CCPA/CPRA 2026 Cookie Consent & ADA Title III / WCAG 2.2 AA Accessibility Engine + Kore AI Neural Voice Player
 * @businessRules
 *   - Strictly branded as "Tacos Gavilan" (official brand name only, zero emojis).
 *   - Customer-facing Los Angeles store naming rule enforced on all spoken/extracted store cards (#5, #6, #7):
 *     * #5 (`la-broadway`): `Los Ángeles (Vernon y Broadway)` / `Los Angeles (Vernon & Broadway)`
 *     * #6 (`la-central`): `Los Ángeles (Central y Washington)` / `Los Angeles (Central & Washington)`
 *     * #7 (`slauson`): `Los Ángeles (Slauson y Broadway)` / `Los Angeles (Slauson & Broadway)`
 *   - Neural Voice Engine (`Kore`): Streams/plays 24 kHz `audio/wav` from `/api/a11y-tts` (on `tacosgavilan.com`) or
 *     `/api/web-a11y/tts` (on TEG / `localhost` / `*.vercel.app`) with an in-memory LRU audio cache (`0ms` repeat),
 *     CSP-safe same-origin URL fallback, `N+1` background chunk prefetching for seamless full-page reading, pitch-preserved
 *     speed control (`0.85x`, `1x`, `1.15x`, `1.3x`), and strict female-voice `speechSynthesis` offline fallback.
 *   - 6 Smart 1-Click Accessibility Profiles (Blind & Kore Voice, Low Vision, Dyslexia Friendly, ADHD Focus, Motor & Keyboard, Seizure Safe).
 *   - Granular WCAG 2.2 AA multi-level adjustments with 3-step visual indicators (`• • •`), horizontal Reading Mask,
 *     Reading Guide, Highlight Headings, Hide Images, Text Alignment, Line Height, Saturation, Left/Right dock switcher,
 *     `Alt + A` global keyboard shortcut, modal focus traps, and `aria-live="polite"` announcements.
 *   - California CPRA compliance: Notice at Collection, category consent, persistent "Do Not Sell or Share My Personal Information" opt-out (CPRA § 1798.135), and Global Privacy Control (GPC, 11 CCR § 7025).
 *   - Dynamic tracking pixel enforcement: controls Facebook Pixel (fbq), TikTok Pixel (ttq), and Google Tag Manager (dataLayer).
 *   - Full bilingual support (`Español` / `English`) synced in real time with site language controls.
 * @dataFlow
 *   - Accessibility Widget -> `safeStorage` (`tg_a11y_prefs`) -> DOM modifier classes + `#tg-color-filter-layer` + Kore Voice Player.
 *   - Kore Voice Player -> `GET /api/a11y-tts` or `GET /api/web-a11y/tts` -> LRU Blob/URL Cache -> `HTMLAudioElement` (fallback: verified female `speechSynthesis`).
 *   - Consent Banner / Preferences Modal -> `safeStorage` (`tg_cookie_consent`) -> Google Consent Mode v2 + GTM/Meta/TikTok gates.
 *   - First-Party Analytics (`isAnalyticsAllowed()`) -> `POST /api/track` (`page_view` / `order_click`).
 * @notes
 *   - Hardened in 2026-11 security pass: `;Secure` cookie attribute on HTTPS and `Object.prototype.hasOwnProperty.call` guards.
 *   - Upgraded in 2026-11 Accessibility & Kore AI Voice pass: fixed Windows scrollbar & bottom card clipping, prevented Chromium
 *     `position: fixed` containment bugs via `#tg-color-filter-layer`, and added CSP-compliant `blob:` -> `'self'` audio fallback.
 */

(function () {
    'use strict';

    if (window.__TG_COMPLIANCE_INITIALIZED__) return;
    window.__TG_COMPLIANCE_INITIALIZED__ = true;

    /* ==========================================================================
       1. SAFE STORAGE HELPER (LOCALSTORAGE + COOKIE FALLBACK)
       ========================================================================== */
    var safeStorage = {
        getItem: function (key) {
            try {
                var item = localStorage.getItem(key);
                if (item !== null) return item;
            } catch (e) {}
            var match = document.cookie.match(new RegExp('(^|;\\s*)' + key + '=([^;]*)'));
            return match ? decodeURIComponent(match[2]) : null;
        },
        setItem: function (key, value) {
            try {
                localStorage.setItem(key, value);
                return;
            } catch (e) {}
            try {
                var d = new Date();
                d.setTime(d.getTime() + (365 * 24 * 60 * 60 * 1000));
                var secureFlag = (window.location && window.location.protocol === 'https:') ? ';Secure' : '';
                document.cookie = key + '=' + encodeURIComponent(value) + ';expires=' + d.toUTCString() + ';path=/;SameSite=Lax' + secureFlag;
            } catch (e) {}
        }
    };

    /* ==========================================================================
       2. BILINGUAL DICTIONARY (ESPAÑOL / ENGLISH)
       ========================================================================== */
    var I18N = {
        es: {
            // Accessibility Trigger & Header
            a11yTriggerLabel: 'Herramientas de Accesibilidad y Voz IA Kore (Alt + A)',
            a11yTitle: 'Accesibilidad',
            a11yShortcutHint: 'Atajo de teclado: Alt + A',
            a11yCloseLabel: 'Cerrar panel de accesibilidad',
            a11yLangAria: 'Cambiar idioma a Inglés',
            a11yReset: 'Restablecer',
            a11yStatement: 'Declaración ADA',
            langToggle: 'English',

            // Section Headings
            secProfiles: 'Perfiles Inteligentes (1 Clic)',
            secBlindness: 'Lectura por Voz Neuronal Kore',
            secVision: 'Visión, Contraste y Color',
            secContent: 'Lectura y Tipografía',
            secMotion: 'Enfoque, Navegación y Movimiento',

            // 6 Smart Profiles
            profBlindName: 'Ceguera / Voz Kore',
            profBlindSub: 'Lector Kore + Enlaces',
            profLowVisionName: 'Baja Visión',
            profLowVisionSub: 'Contraste + Texto + Cursor',
            profDyslexiaName: 'Dislexia y Lectura',
            profDyslexiaSub: 'Fuente + Espaciado + Guía',
            profAdhdName: 'Enfoque TDAH',
            profAdhdSub: 'Máscara + Sin Animación',
            profMotorName: 'Motor / Teclado',
            profMotorSub: 'Foco Teclado + Cursor',
            profSeizureName: 'Sin Destellos',
            profSeizureSub: 'Pausa + Baja Saturación',

            // Kore AI Voice Player
            koreBadge: 'Voz IA Kore',
            koreStatusReady: 'Lista para leer',
            koreStatusLoading: 'Generando voz Kore...',
            koreStatusInteractive: 'Modo Clic / Tab activo',
            koreStatusPaused: 'En pausa',
            koreSectionOf: 'Sección {x} de {y}',
            koreIdlePrompt: 'Active el Lector Kore para escuchar al tocar o enfocar, o pulse Leer Página Completa.',
            koreInteractivePrompt: 'Lector Kore activo: haga clic o navegue con Tab sobre cualquier platillo, sucursal o texto.',
            koreWelcomeInteractive: 'Lector de pantalla con voz Kore activado en Tacos Gavilan. Toque o navegue con el teclado sobre cualquier platillo, sucursal o botón para escucharlo.',
            korePageAssistEnd: 'Fin de la lectura de la página de Tacos Gavilan. Para asistencia telefónica directa, visite nuestra sección de Sucursales o escríbanos a support@tacosgavilan.com.',
            korePrevLabel: 'Sección anterior',
            korePlayLabel: 'Reproducir con voz Kore',
            korePauseLabel: 'Pausar lectura',
            koreNextLabel: 'Siguiente sección',
            koreStopLabel: 'Detener lectura',
            koreSpeedGroupLabel: 'Velocidad de lectura de voz Kore',
            speechBarStop: 'Detener Audio',

            // Granular Tools
            toolScreenReader: 'Lector Kore (Clic/Tab)',
            toolPageReader: 'Leer Página Completa',
            toolContrast: 'Alto Contraste',
            toolInvert: 'Invertir Colores',
            toolSaturation: 'Saturación',
            toolHideImages: 'Ocultar Imágenes',
            toolTextSize: 'Tamaño de Texto',
            toolSpacing: 'Espaciado de Texto',
            toolLineHeight: 'Altura de Línea',
            toolTextAlign: 'Alineación de Texto',
            toolDyslexic: 'Fuente Dislexia',
            toolHighlightHeadings: 'Resaltar Títulos',
            toolReadingMask: 'Máscara de Lectura',
            toolReadingGuide: 'Guía de Lectura',
            toolHighlight: 'Resaltar Enlaces',
            toolFocusRing: 'Foco de Teclado',
            toolCursor: 'Cursor Grande',
            toolStopAnim: 'Pausar Animaciones',

            // Multi-step Sub-labels
            satLow: 'Baja',
            satHigh: 'Alta',
            satMono: 'Monocromo',
            sizeStep1: '+15%',
            sizeStep2: '+30%',
            sizeStep3: '+45%',
            spaceStep1: 'Moderado',
            spaceStep2: 'Amplio',
            spaceStep3: 'Máximo',
            lhStep1: '1.75x',
            lhStep2: '2.0x',
            lhStep3: '2.25x',
            alignLeft: 'Izquierda',
            alignCenter: 'Centro',
            alignJustify: 'Justificado',

            // Widget Position & Announcements
            posLabel: 'Posición del botón',
            posLeft: 'Izquierda',
            posRight: 'Derecha',
            announceReset: 'Todos los ajustes de accesibilidad fueron restablecidos.',
            announceProfileOn: 'Perfil activado: ',
            announceProfileOff: 'Perfil desactivado: ',
            announcePanelOpen: 'Panel de accesibilidad abierto.',
            announcePanelClosed: 'Panel de accesibilidad cerrado.',
            imgFallbackAlt: 'Fotografía de Tacos Gavilan',

            // Cookie Banner (California CCPA / CPRA 2026)
            cookieBadge: 'Privacidad de California (CCPA / CPRA 2026)',
            cookieText: 'En Tacos Gavilan valoramos su privacidad. Utilizamos cookies esenciales para operar el sitio y analíticas/publicidad para mejorar su experiencia. Bajo la ley de California (CCPA/CPRA § 1798.135), usted tiene derecho a optar por no vender ni compartir su información personal para publicidad contextual.',
            cookieLearnMore: 'Ver Política',
            btnAcceptAll: 'Aceptar Todas',
            btnRejectAll: 'Solo Esenciales',
            btnDns: 'No Vender Mi Información',
            btnPrefs: 'Preferencias',

            // Cookie Modal
            modalTitle: 'Centro de Privacidad y Cookies de California',
            modalDesc: 'Configure sus preferencias de privacidad conforme a las leyes CCPA y CPRA. Las cookies esenciales no pueden desactivarse. Puede rechazar las categorías adicionales o ejercer su derecho de exclusión.',
            catNecessaryTitle: 'Estrictamente Necesarias',
            catNecessaryBadge: 'Siempre Activas',
            catNecessaryDesc: 'Requeridas para la seguridad, navegación básica y funciones operativas del sitio web.',
            catAnalyticsTitle: 'Analíticas y Rendimiento',
            catAnalyticsDesc: 'Nos permiten medir visitas y fuentes de tráfico para optimizar el rendimiento de la plataforma.',
            catMarketingTitle: 'Publicidad y Redes Sociales',
            catMarketingDesc: 'Utilizadas por socios como Meta (Facebook Pixel), TikTok y Google Ads para medir campañas y entrega de anuncios.',
            dnsSectionTitle: 'California: No Vender Ni Compartir Mi Información',
            dnsSectionDesc: 'Al activar esta opción, bloqueamos la transferencia de identificadores personales a terceros para publicidad contextual cruzada en pleno cumplimiento con CPRA § 1798.135.',
            dnsToggleLabel: 'Optar por no vender/compartir mi información personal',
            btnSavePrefs: 'Guardar Preferencias',

            // Footer injection
            footerDnsLink: 'No Vender Ni Compartir Mi Información Personal',
            footerA11yLink: 'Declaración de Accesibilidad',

            // Statements
            statementTitle: 'Declaración de Accesibilidad',
            statementBody: 'Tacos Gavilan trabaja continuamente hacia la conformidad con las Pautas de Accesibilidad para el Contenido Web (WCAG) 2.2 Nivel AA y evalúa y mejora constantemente el sitio web para facilitar el acceso a todas las personas.\n\nALCANCE Y MEJORAS CONTINUAS:\nImplementamos estructura HTML5 semántica, navegación por teclado (atajo rápido Alt + A), lector de voz neuronal femenina Kore en español e inglés, perfiles inteligentes de accesibilidad, trampas de foco en modales y menú móvil, etiquetas de formulario accesibles y alternativas de texto para mapas e imágenes.\n\nASISTENCIA TELEFÓNICA Y REPORTE DE BARRERAS:\nSi experimenta alguna dificultad para navegar, consultar nuestro menú o realizar un pedido en línea en order.online (operado por DoorDash, Inc.), puede llamar directamente a cualquiera de nuestras 15 sucursales listadas en /locations/ para recibir asistencia de nuestro personal, o reportar cualquier barrera de accesibilidad:\n\n• Correo Electrónico: support@tacosgavilan.com\n• Formulario de Contacto y Accesibilidad: https://tacosgavilan.com/contact/\n• Directorio de 15 Sucursales: https://tacosgavilan.com/locations/'
        },
        en: {
            // Accessibility Trigger & Header
            a11yTriggerLabel: 'Accessibility Tools & Kore AI Voice (Alt + A)',
            a11yTitle: 'Accessibility',
            a11yShortcutHint: 'Keyboard shortcut: Alt + A',
            a11yCloseLabel: 'Close accessibility panel',
            a11yLangAria: 'Switch language to Español',
            a11yReset: 'Reset All',
            a11yStatement: 'ADA Statement',
            langToggle: 'Español',

            // Section Headings
            secProfiles: 'Smart Profiles (1-Click)',
            secBlindness: 'Kore Neural Voice & Screen Reading',
            secVision: 'Vision, Contrast & Color',
            secContent: 'Reading & Typography',
            secMotion: 'Focus, Navigation & Motion',

            // 6 Smart Profiles
            profBlindName: 'Blind & Kore Voice',
            profBlindSub: 'Kore Reader + Links',
            profLowVisionName: 'Low Vision',
            profLowVisionSub: 'Contrast + Text + Cursor',
            profDyslexiaName: 'Dyslexia Friendly',
            profDyslexiaSub: 'Font + Spacing + Guide',
            profAdhdName: 'ADHD Focus',
            profAdhdSub: 'Reading Mask + No Motion',
            profMotorName: 'Motor & Keyboard',
            profMotorSub: 'Key Focus + Big Cursor',
            profSeizureName: 'Seizure Safe',
            profSeizureSub: 'Pause + Low Saturation',

            // Kore AI Voice Player
            koreBadge: 'Kore AI Voice',
            koreStatusReady: 'Ready to read',
            koreStatusLoading: 'Loading Kore voice...',
            koreStatusInteractive: 'Click / Tab mode on',
            koreStatusPaused: 'Paused',
            koreSectionOf: 'Section {x} of {y}',
            koreIdlePrompt: 'Enable Kore Reader to hear items on click or Tab focus, or press Read Full Page.',
            koreInteractivePrompt: 'Kore Reader active: click or press Tab on any menu item, location, or text to hear it.',
            koreWelcomeInteractive: 'Kore neural voice reader activated for Tacos Gavilan. Click or press Tab on any dish, location, or button to hear it.',
            korePageAssistEnd: 'End of Tacos Gavilan page reading. For direct telephone assistance, please visit our Locations section or email support@tacosgavilan.com.',
            korePrevLabel: 'Previous section',
            korePlayLabel: 'Play with Kore AI Voice',
            korePauseLabel: 'Pause reading',
            koreNextLabel: 'Next section',
            koreStopLabel: 'Stop reading',
            koreSpeedGroupLabel: 'Kore voice playback speed',
            speechBarStop: 'Stop Audio',

            // Granular Tools
            toolScreenReader: 'Kore Reader (Click/Tab)',
            toolPageReader: 'Read Full Page',
            toolContrast: 'High Contrast',
            toolInvert: 'Invert Colors',
            toolSaturation: 'Saturation',
            toolHideImages: 'Hide Images',
            toolTextSize: 'Text Size',
            toolSpacing: 'Text Spacing',
            toolLineHeight: 'Line Height',
            toolTextAlign: 'Text Align',
            toolDyslexic: 'Dyslexia Font',
            toolHighlightHeadings: 'Highlight Headings',
            toolReadingMask: 'Reading Mask',
            toolReadingGuide: 'Reading Guide',
            toolHighlight: 'Highlight Links',
            toolFocusRing: 'Keyboard Focus',
            toolCursor: 'Big Cursor',
            toolStopAnim: 'Pause Animations',

            // Multi-step Sub-labels
            satLow: 'Low',
            satHigh: 'High',
            satMono: 'Monochrome',
            sizeStep1: '+15%',
            sizeStep2: '+30%',
            sizeStep3: '+45%',
            spaceStep1: 'Moderate',
            spaceStep2: 'Wide',
            spaceStep3: 'Extra Wide',
            lhStep1: '1.75x',
            lhStep2: '2.0x',
            lhStep3: '2.25x',
            alignLeft: 'Left',
            alignCenter: 'Center',
            alignJustify: 'Justify',

            // Widget Position & Announcements
            posLabel: 'Button position',
            posLeft: 'Left',
            posRight: 'Right',
            announceReset: 'All accessibility settings have been reset.',
            announceProfileOn: 'Profile enabled: ',
            announceProfileOff: 'Profile disabled: ',
            announcePanelOpen: 'Accessibility panel opened.',
            announcePanelClosed: 'Accessibility panel closed.',
            imgFallbackAlt: 'Tacos Gavilan photograph',

            // Cookie Banner (California CCPA / CPRA 2026)
            cookieBadge: 'California Privacy (CCPA / CPRA 2026)',
            cookieText: 'At Tacos Gavilan we value your privacy. We use essential cookies to operate our site and—only with your consent—analytics and marketing tags. Under California law (CCPA/CPRA), you have the right to opt out of the sale or sharing of your personal information.',
            cookieLearnMore: 'Notice at Collection',
            btnAcceptAll: 'Accept All',
            btnRejectAll: 'Essential Only',
            btnDns: 'Do Not Sell My Info',
            btnPrefs: 'Preferences',

            // Cookie Modal
            modalTitle: 'California Privacy & Cookie Preference Center',
            modalDesc: 'Manage your privacy settings pursuant to California CCPA and CPRA. Strictly necessary cookies cannot be disabled. Non-essential analytics and marketing tags remain blocked until you opt in.',
            catNecessaryTitle: 'Strictly Necessary',
            catNecessaryBadge: 'Always Active',
            catNecessaryDesc: 'Essential for core website functionality, security, language, and accessibility settings.',
            catAnalyticsTitle: 'Analytics & Performance',
            catAnalyticsDesc: 'Allow us to count visits and traffic sources to measure and improve our site performance.',
            catMarketingTitle: 'Marketing & Social Pixels',
            catMarketingDesc: 'Used by third-party partners like Meta (Facebook Pixel), TikTok, and Google Ads to deliver relevant ads and measure campaigns.',
            dnsSectionTitle: 'California: Do Not Sell or Share My Information',
            dnsSectionDesc: 'Turning this on blocks the transfer of personal identifiers to third parties for cross-context behavioral advertising pursuant to California CPRA § 1798.135.',
            dnsToggleLabel: 'Do Not Sell or Share My Personal Information',
            btnSavePrefs: 'Save Preferences',

            // Footer injection
            footerDnsLink: 'Do Not Sell or Share My Personal Information',
            footerA11yLink: 'Accessibility Statement',

            // Statements
            statementTitle: 'Accessibility Statement',
            statementBody: 'Tacos Gavilan is working toward Web Content Accessibility Guidelines (WCAG) 2.2 Level AA conformance and continuously evaluates and improves the website to support equal access for all guests.\n\nSCOPE & NATIVE ACCESSIBILITY MEASURES:\nWe implement semantic HTML5 landmarks, keyboard navigation (Alt + A quick shortcut), our bilingual Kore neural female voice reader, smart accessibility profiles, focus traps on modals and the mobile navigation drawer, accessible form labels, and native HTML store directory alternatives alongside interactive maps.\n\nTELEPHONE ASSISTANCE & BARRIER REPORTING:\nIf you encounter any difficulty accessing our website, reviewing menus, or placing an online order on order.online (operated by DoorDash, Inc.), you may call any of our 15 Southern California restaurant locations listed at /locations/ for direct staff assistance, or report an accessibility barrier:\n\n• Email: support@tacosgavilan.com\n• Online Contact & Accessibility Form: https://tacosgavilan.com/contact/\n• 15 Restaurant Locations Directory: https://tacosgavilan.com/locations/'
        }
    };

    var currentLang = (function () {
        var saved = safeStorage.getItem('tacosgavilan_lang') || safeStorage.getItem('tg_site_lang');
        if (saved && (saved === 'es' || saved === 'en')) return saved;
        return (typeof document !== 'undefined' && document.documentElement && document.documentElement.lang === 'es') ? 'es' : 'en';
    })();

    function getDefaultA11yState() {
        return {
            contrast: false,
            invert: false,
            grayscale: false, // kept synced with saturation === 3 for backwards compatibility
            saturation: 0,    // 0: normal, 1: low, 2: high, 3: monochrome
            hideImages: false,
            fontSize: 0,      // 0: normal, 1: +15%, 2: +30%, 3: +45%
            spacing: 0,       // 0: normal, 1: moderate, 2: wide, 3: max
            lineHeight: 0,    // 0: normal, 1: 1.75x, 2: 2.0x, 3: 2.25x
            textAlign: 0,     // 0: normal, 1: left, 2: center, 3: justify
            dyslexic: false,
            highlightHeadings: false,
            readingMask: false,
            readingGuide: false,
            highlightLinks: false,
            focusEnhanced: false,
            bigCursor: false,
            stopAnim: false,
            screenReader: false,
            speechRate: 1,
            widgetPosition: 'right' // 'right' | 'left'
        };
    }

    var a11yState = getDefaultA11yState();

    // Strict Prior-Consent Default: analytics and marketing are FALSE until explicit user opt-in
    var cookieConsent = {
        necessary: true,
        analytics: false,
        marketing: false,
        doNotSell: false,
        timestamp: null,
        answered: false
    };

    function isAnalyticsAllowed() {
        var gpcActive = (typeof navigator !== 'undefined' && navigator.globalPrivacyControl === true);
        return !!(cookieConsent.answered && cookieConsent.analytics && !gpcActive);
    }

    /* ==========================================================================
       3. STORAGE & SYNC
       ========================================================================== */
    function loadSavedState() {
        try {
            var savedA11y = safeStorage.getItem('tg_a11y_prefs');
            if (savedA11y) {
                var parsedA11y = JSON.parse(savedA11y);
                for (var key in parsedA11y) {
                    if (Object.prototype.hasOwnProperty.call(a11yState, key)) {
                        a11yState[key] = parsedA11y[key];
                    }
                }
                // Backwards-compatible migrations from older boolean schema
                if (typeof a11yState.spacing === 'boolean') {
                    a11yState.spacing = a11yState.spacing ? 1 : 0;
                }
                if (a11yState.grayscale === true && (!a11yState.saturation || a11yState.saturation === 0)) {
                    a11yState.saturation = 3;
                }
                a11yState.grayscale = (a11yState.saturation === 3);
                if ([0, 1, 2, 3].indexOf(Number(a11yState.fontSize)) === -1) a11yState.fontSize = 0;
                if ([0, 1, 2, 3].indexOf(Number(a11yState.spacing)) === -1) a11yState.spacing = 0;
                if ([0, 1, 2, 3].indexOf(Number(a11yState.lineHeight)) === -1) a11yState.lineHeight = 0;
                if ([0, 1, 2, 3].indexOf(Number(a11yState.textAlign)) === -1) a11yState.textAlign = 0;
                if ([0, 1, 2, 3].indexOf(Number(a11yState.saturation)) === -1) a11yState.saturation = 0;
                if ([0.85, 1, 1.15, 1.3].indexOf(Number(a11yState.speechRate)) === -1) a11yState.speechRate = 1;
                if (a11yState.widgetPosition !== 'left' && a11yState.widgetPosition !== 'right') {
                    a11yState.widgetPosition = 'right';
                }
            }
        } catch (e) {
            console.warn('[Tacos Gavilan] Error loading A11y state:', e);
        }

        try {
            var savedConsent = safeStorage.getItem('tg_cookie_consent') || safeStorage.getItem('tacosgavilan_cookie_consent');
            if (savedConsent) {
                if (savedConsent === 'accepted') {
                    cookieConsent.necessary = true;
                    cookieConsent.analytics = true;
                    cookieConsent.marketing = true;
                    cookieConsent.doNotSell = false;
                    cookieConsent.answered = true;
                } else if (savedConsent === 'declined') {
                    cookieConsent.necessary = true;
                    cookieConsent.analytics = false;
                    cookieConsent.marketing = false;
                    cookieConsent.doNotSell = true;
                    cookieConsent.answered = true;
                } else if (savedConsent.charAt(0) === '{') {
                    var parsed = JSON.parse(savedConsent);
                    cookieConsent.necessary = true;
                    cookieConsent.analytics = parsed.analytics === true;
                    cookieConsent.marketing = parsed.marketing === true;
                    cookieConsent.doNotSell = parsed.doNotSell === true;
                    cookieConsent.timestamp = parsed.timestamp || Date.now();
                    cookieConsent.answered = true;
                }
            }

            // California Statutory Requirement: Global Privacy Control (GPC)
            if (typeof navigator !== 'undefined' && navigator.globalPrivacyControl === true) {
                cookieConsent.doNotSell = true;
                cookieConsent.marketing = false;
                cookieConsent.analytics = false;
                cookieConsent.answered = true;
            }
        } catch (e) {
            console.warn('[Tacos Gavilan] Error loading Cookie consent:', e);
        }
    }

    function saveA11yState() {
        try {
            a11yState.grayscale = (a11yState.saturation === 3);
            safeStorage.setItem('tg_a11y_prefs', JSON.stringify(a11yState));
        } catch (e) {}
    }

    function saveCookieConsent(statusStr) {
        try {
            cookieConsent.timestamp = Date.now();
            cookieConsent.answered = true;
            safeStorage.setItem('tg_cookie_consent', JSON.stringify(cookieConsent));
            // Keep legacy tacosgavilan_cookie_consent string in sync
            var computedStatus = statusStr || ((cookieConsent.marketing && !cookieConsent.doNotSell) ? 'accepted' : (cookieConsent.analytics ? 'custom' : 'declined'));
            safeStorage.setItem('tacosgavilan_cookie_consent', computedStatus);
        } catch (e) {}
    }

    function announcePolite(msg) {
        var live = document.getElementById('tg-a11y-live');
        if (!live || !msg) return;
        live.textContent = '';
        setTimeout(function () {
            live.textContent = msg;
        }, 30);
    }

    /* ==========================================================================
       4. DYNAMIC TRACKING ENFORCEMENT (CCPA/CPRA + GOOGLE CONSENT MODE V2)
       ========================================================================== */
    function purgeTrackingCookies() {
        var staticNames = ['_ga', '_gid', '_gat', '_gcl_au', '_gcl_aw', '_fbp', '_fbc', '_ttp', '_tt_enable_cookie', 'ttcsid'];
        var dynamicNames = [];
        try {
            var rawCookies = (document.cookie || '').split(';');
            for (var i = 0; i < rawCookies.length; i++) {
                var eqIdx = rawCookies[i].indexOf('=');
                var cName = (eqIdx > -1 ? rawCookies[i].slice(0, eqIdx) : rawCookies[i]).trim();
                if (cName && /^(_ga|_gid|_gat|_gcl|_fbp|_fbc|_ttp|_tt_|ttcsid)/i.test(cName)) {
                    dynamicNames.push(cName);
                }
            }
        } catch (e) {}
        var allToPurge = staticNames.concat(dynamicNames);
        var host = window.location.hostname || '';
        var hostParts = host.split('.');
        var rootDomain = hostParts.length >= 2 ? '.' + hostParts.slice(-2).join('.') : host;
        var secureFlag = (window.location && window.location.protocol === 'https:') ? ';Secure' : '';
        allToPurge.forEach(function (name) {
            try {
                document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/' + secureFlag;
                if (host) {
                    document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;domain=' + host + secureFlag;
                }
                if (rootDomain) {
                    document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;domain=' + rootDomain + secureFlag;
                }
            } catch (e) {}
        });
    }

    function syncModalCheckboxes() {
        var gpcActive = (typeof navigator !== 'undefined' && navigator.globalPrivacyControl === true);
        var anaChecked = !!(cookieConsent.answered && cookieConsent.analytics && !gpcActive);
        var mktChecked = !!(cookieConsent.answered && cookieConsent.marketing && !cookieConsent.doNotSell && !gpcActive);
        var dnsChecked = !!(cookieConsent.doNotSell || gpcActive);

        ['tg-chk-analytics', 'page-chk-analytics'].forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.checked = anaChecked;
        });
        ['tg-chk-marketing', 'page-chk-marketing'].forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.checked = mktChecked;
        });
        ['tg-chk-dns', 'page-chk-dns'].forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.checked = dnsChecked;
        });
    }

    function applyTrackingConsent() {
        var gpcActive = (typeof navigator !== 'undefined' && navigator.globalPrivacyControl === true);
        var allowMarketing = !!(cookieConsent.answered && cookieConsent.marketing && !cookieConsent.doNotSell && !gpcActive);
        var allowAnalytics = !!(cookieConsent.answered && cookieConsent.analytics && !gpcActive);

        // Disable Google Analytics tracker directly when analytics is not granted
        window['ga-disable-UA-74752614-19'] = !allowAnalytics;

        if (!allowAnalytics) {
            try {
                sessionStorage.removeItem('tg_session_id');
            } catch (e) {}
        }

        if (!allowMarketing || !allowAnalytics) {
            purgeTrackingCookies();
        }

        // Remove injected third-party scripts if consent was revoked
        if (!allowAnalytics && !allowMarketing && window.__tgGtmLoaded) {
            try {
                var gtmScripts = document.querySelectorAll('script[src*="googletagmanager.com/gtm.js"]');
                gtmScripts.forEach(function (s) { if (s.parentNode) s.parentNode.removeChild(s); });
                window.__tgGtmLoaded = false;
            } catch (e) {}
        }
        if (!allowMarketing && window.__tgMktPixelsLoaded) {
            try {
                var mktScripts = document.querySelectorAll('script[src*="connect.facebook.net"], script[src*="analytics.tiktok.com"]');
                mktScripts.forEach(function (s) { if (s.parentNode) s.parentNode.removeChild(s); });
                window.__tgMktPixelsLoaded = false;
            } catch (e) {}
        }

        // Dynamically load GTM and homepage marketing pixels ONLY if explicit consent was granted
        if (allowAnalytics || allowMarketing) {
            if (typeof window.__tgLoadGTMIfConsented === 'function') {
                window.__tgLoadGTMIfConsented(allowAnalytics, allowMarketing);
            }
        }
        if (allowMarketing) {
            if (typeof window.__tgLoadMarketingPixelsIfConsented === 'function') {
                window.__tgLoadMarketingPixelsIfConsented(true);
            }
        }

        // Meta / Facebook Pixel (if already loaded)
        if (typeof window.fbq === 'function') {
            try {
                window.fbq('consent', allowMarketing ? 'grant' : 'revoke');
            } catch (err) {
                console.warn('[Tacos Gavilan] Meta consent error:', err);
            }
        }

        // TikTok Pixel (if already loaded)
        if (window.ttq) {
            try {
                if (allowMarketing && typeof window.ttq.enableCookie === 'function') {
                    window.ttq.enableCookie();
                } else if (!allowMarketing && typeof window.ttq.disableCookie === 'function') {
                    window.ttq.disableCookie();
                }
            } catch (err) {
                console.warn('[Tacos Gavilan] TikTok consent error:', err);
            }
        }

        // Google Consent Mode v2 + Google Tag Manager dataLayer
        try {
            window.dataLayer = window.dataLayer || [];
            function gtag() { window.dataLayer.push(arguments); }
            gtag('consent', 'update', {
                ad_storage: allowMarketing ? 'granted' : 'denied',
                ad_user_data: allowMarketing ? 'granted' : 'denied',
                ad_personalization: allowMarketing ? 'granted' : 'denied',
                analytics_storage: allowAnalytics ? 'granted' : 'denied'
            });
            window.dataLayer.push({
                event: 'teg_cookie_consent_update',
                consent_analytics: allowAnalytics ? 'granted' : 'denied',
                consent_marketing: allowMarketing ? 'granted' : 'denied',
                do_not_sell_california: (cookieConsent.doNotSell || gpcActive) ? 'opt_out' : (allowMarketing ? 'opt_in' : 'prior_consent_blocked')
            });
        } catch (err) {
            console.warn('[Tacos Gavilan] GTM dataLayer error:', err);
        }

        syncModalCheckboxes();

        // Update interactive status badges on /privacy-choices/, Cookie Modal, and Cookie Banner
        var isOptedOut = gpcActive || cookieConsent.doNotSell || (cookieConsent.answered && !allowMarketing);
        var statusIds = ['tg-privacy-choices-status', 'page-dns-status'];
        statusIds.forEach(function (id) {
            var statusEl = document.getElementById(id);
            if (!statusEl) return;
            var textEs, textEn;
            if (gpcActive) {
                textEs = 'Estado Actual: Opt-out request honored — Señal Global Privacy Control (GPC) Activa (Venta/Compartición y Etiquetas Publicitarias Bloqueadas)';
                textEn = 'Current Status: Opt-out request honored — Global Privacy Control (GPC) Signal Active (Sale/Sharing & Ad Tags Blocked)';
            } else if (cookieConsent.doNotSell || (cookieConsent.answered && !allowAnalytics && !allowMarketing)) {
                textEs = 'Estado Actual: Opt-out request honored — Exclusión Activa (No Vender ni Compartir Mi Información Personal)';
                textEn = 'Current Status: Opt-out request honored — Do Not Sell or Share Active (Non-Essential Ad Tags Blocked)';
            } else if (!cookieConsent.answered) {
                textEs = 'Estado Actual: Bloqueo Previo Activo (Etiquetas no esenciales bloqueadas hasta su consentimiento)';
                textEn = 'Current Status: Prior-Consent Protection Active (Non-essential tags blocked until you opt in)';
            } else {
                textEs = 'Estado Actual: Consentimiento Personalizado Activo (Analítica: ' + (allowAnalytics ? 'Sí' : 'No') + ', Marketing: ' + (allowMarketing ? 'Sí' : 'No') + ')';
                textEn = 'Current Status: Custom Consent Active (Analytics: ' + (allowAnalytics ? 'On' : 'Off') + ', Marketing: ' + (allowMarketing ? 'On' : 'Off') + ')';
            }
            statusEl.setAttribute('data-en', textEn);
            statusEl.setAttribute('data-es', textEs);
            statusEl.textContent = currentLang === 'es' ? textEs : textEn;
        });

        var honoredBadges = [
            document.getElementById('page-gpc-honored-badge'),
            document.getElementById('tg-modal-gpc-status'),
            document.getElementById('tg-banner-gpc-status')
        ];
        honoredBadges.forEach(function (badge) {
            if (!badge) return;
            if (isOptedOut) {
                var badgeEs = gpcActive ? '✓ Opt-out request honored (Señal GPC Activa)' : '✓ Opt-out request honored (Solicitud de exclusión aplicada)';
                var badgeEn = gpcActive ? '✓ Opt-out request honored (GPC Signal Active)' : '✓ Opt-out request honored';
                badge.style.display = 'inline-flex';
                badge.setAttribute('data-en', badgeEn);
                badge.setAttribute('data-es', badgeEs);
                badge.textContent = currentLang === 'es' ? badgeEs : badgeEn;
            } else {
                badge.style.display = 'none';
            }
        });

        sendInitialPageViewIfConsented();
    }

    /* ==========================================================================
       5. CUSTOMER-FACING STORE NAMES & KORE SPEECH TEXT NORMALIZATION
       ========================================================================== */
    var CUSTOMER_STORE_SPEECH_MAP = {
        'la-broadway': {
            es: 'Tacos Gavilan en Los Ángeles (Vernon y Broadway)',
            en: 'Tacos Gavilan in Los Angeles (Vernon & Broadway)'
        },
        'la-central': {
            es: 'Tacos Gavilan en Los Ángeles (Central y Washington)',
            en: 'Tacos Gavilan in Los Angeles (Central & Washington)'
        },
        'slauson': {
            es: 'Tacos Gavilan en Los Ángeles (Slauson y Broadway)',
            en: 'Tacos Gavilan in Los Angeles (Slauson & Broadway)'
        },
        'rialto': { es: 'Tacos Gavilan Rialto', en: 'Tacos Gavilan Rialto' },
        'west-covina': { es: 'Tacos Gavilan West Covina', en: 'Tacos Gavilan West Covina' },
        'azusa': { es: 'Tacos Gavilan Azusa', en: 'Tacos Gavilan Azusa' },
        'hollywood': { es: 'Tacos Gavilan Hollywood', en: 'Tacos Gavilan Hollywood' },
        'santa-ana': { es: 'Tacos Gavilan Santa Ana', en: 'Tacos Gavilan Santa Ana' },
        'la-puente': { es: 'Tacos Gavilan La Puente', en: 'Tacos Gavilan La Puente' },
        'huntington-park': { es: 'Tacos Gavilan Huntington Park', en: 'Tacos Gavilan Huntington Park' },
        'norwalk': { es: 'Tacos Gavilan Norwalk', en: 'Tacos Gavilan Norwalk' },
        'bell': { es: 'Tacos Gavilan Bell', en: 'Tacos Gavilan Bell' },
        'lynwood': { es: 'Tacos Gavilan Lynwood', en: 'Tacos Gavilan Lynwood' },
        'south-gate': { es: 'Tacos Gavilan South Gate', en: 'Tacos Gavilan South Gate' },
        'downey': { es: 'Tacos Gavilan Downey', en: 'Tacos Gavilan Downey' }
    };

    function getCanonicalCustomerStoreLabel(slug, lang) {
        var normSlug = String(slug || '').trim().toLowerCase();
        if (normSlug && Object.prototype.hasOwnProperty.call(CUSTOMER_STORE_SPEECH_MAP, normSlug)) {
            return lang === 'es' ? CUSTOMER_STORE_SPEECH_MAP[normSlug].es : CUSTOMER_STORE_SPEECH_MAP[normSlug].en;
        }
        return '';
    }

    function normalizeKoreClientText(rawText, lang) {
        if (!rawText) return '';
        var s = String(rawText)
            .replace(/[\u0000-\u001F\u007F]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        if (!s) return '';

        // 1. Strict official brand name: Tacos Gavilan
        s = s.replace(/\bTacos\s+El\s+Gavil[aá]n\b/gi, 'Tacos Gavilan');

        // 2. Enforce Los Angeles #5, #6, #7 cross-street naming rule while preserving street addresses (4380 S. Broadway, etc.)
        if (lang === 'es') {
            s = s
                .replace(/\bLos\s+[AÁ]ngeles\s+Vernon\s*(?:&|y|and)\s*Broadway\b/gi, 'Los Ángeles (Vernon y Broadway)')
                .replace(/\bLos\s+[AÁ]ngeles\s+Central\s*(?:&|y|and)\s*Washington\b/gi, 'Los Ángeles (Central y Washington)')
                .replace(/\bLos\s+[AÁ]ngeles\s+Slauson\s*(?:&|y|and)\s*Broadway\b/gi, 'Los Ángeles (Slauson y Broadway)')
                .replace(/\b(?:LA|[Ll]\.[Aa]\.)\s+Broadway\b(?!\s*(?:&|y)\s*Vernon|\s+(?:Ave\.?|Avenue|Blvd\.?|Boulevard|St\.?|Street))/g, 'Los Ángeles (Vernon y Broadway)')
                .replace(/\b(?:LA|[Ll]\.[Aa]\.)\s+Central\b(?!\s*(?:&|y)\s*Washington|\s+(?:Ave\.?|Avenue|Blvd\.?|Boulevard|St\.?|Street))/g, 'Los Ángeles (Central y Washington)')
                .replace(/\b(?:LA|[Ll]\.[Aa]\.)\s+Slauson\b(?!\s*(?:&|y)\s*Broadway|\s+(?:Ave\.?|Avenue|Blvd\.?|Boulevard|St\.?|Street))/g, 'Los Ángeles (Slauson y Broadway)')
                .replace(/\bTacos\s+Gavil[aá]n\s+Slauson\b(?!\s*(?:&|y|\()\s*Broadway)/gi, 'Tacos Gavilan en Los Ángeles (Slauson y Broadway)');
        } else {
            s = s
                .replace(/\bLos\s+[AÁ]ngeles\s+Vernon\s*(?:&|and)\s*Broadway\b/gi, 'Los Angeles (Vernon & Broadway)')
                .replace(/\bLos\s+[AÁ]ngeles\s+Central\s*(?:&|and)\s*Washington\b/gi, 'Los Angeles (Central & Washington)')
                .replace(/\bLos\s+[AÁ]ngeles\s+Slauson\s*(?:&|and)\s*Broadway\b/gi, 'Los Angeles (Slauson & Broadway)')
                .replace(/\bL\.?A\.?\s+Broadway\b(?!\s*(?:&|and)\s*Vernon|\s+(?:Ave\.?|Avenue|Blvd\.?|Boulevard|St\.?|Street))/gi, 'Los Angeles (Vernon & Broadway)')
                .replace(/\bL\.?A\.?\s+Central\b(?!\s*(?:&|and)\s*Washington|\s+(?:Ave\.?|Avenue|Blvd\.?|Boulevard|St\.?|Street))/gi, 'Los Angeles (Central & Washington)')
                .replace(/\bL\.?A\.?\s+Slauson\b(?!\s*(?:&|and)\s*Broadway|\s+(?:Ave\.?|Avenue|Blvd\.?|Boulevard|St\.?|Street))/gi, 'Los Angeles (Slauson & Broadway)')
                .replace(/\bTacos\s+Gavil[aá]n\s+Slauson\b(?!\s*(?:&|and|\()\s*Broadway)/gi, 'Tacos Gavilan in Los Angeles (Slauson & Broadway)');
        }

        // 3. Clean catering separators, freeway abbreviations, day ranges & party tray ranges
        s = s
            .replace(/\s*[·•]\s*/g, '. ')
            .replace(/\b(\d+)\s*FWY\b/gi, '$1 Freeway');

        if (lang === 'es') {
            s = s
                .replace(/\bDom\.?\s*[–—-]\s*Mi[eé]\.?(?=$|[^A-Za-zÀ-ÿ])/gi, 'Domingo a Miércoles')
                .replace(/\bLun\.?\s*[–—-]\s*Mi[eé]\.?(?=$|[^A-Za-zÀ-ÿ])/gi, 'Lunes a Miércoles')
                .replace(/\bLun\.?\s*[–—-]\s*Jue\.?(?=$|[^A-Za-zÀ-ÿ])/gi, 'Lunes a Jueves')
                .replace(/\bDom\.?\s*[–—-]\s*Jue\.?(?=$|[^A-Za-zÀ-ÿ])/gi, 'Domingo a Jueves')
                .replace(/\bVie\.?\s*[–—-]\s*S[aá]b\.?(?=$|[^A-Za-zÀ-ÿ])/gi, 'Viernes a Sábado')
                .replace(/\bJue\.?\s+(?:y|&)\s+Dom\.?(?=$|[^A-Za-zÀ-ÿ])/gi, 'Jueves y Domingo')
                .replace(/\b(\d+)\s*[–—-]\s*(\d+)\s*(Personas|Invitados)\b/gi, '$1 a $2 $3');
        } else {
            s = s
                .replace(/\bSun\s*[–—-]\s*Wed\b/gi, 'Sunday through Wednesday')
                .replace(/\bMon\s*[–—-]\s*Wed\b/gi, 'Monday through Wednesday')
                .replace(/\bMon\s*[–—-]\s*Thu\b/gi, 'Monday through Thursday')
                .replace(/\bSun\s*[–—-]\s*Thu\b/gi, 'Sunday through Thursday')
                .replace(/\bFri\s*[–—-]\s*Sat\b/gi, 'Friday and Saturday')
                .replace(/\bThu\s*(?:&|and)\s*Sun\b/gi, 'Thursday and Sunday')
                .replace(/\b(\d+)\s*[–—-]\s*(\d+)\s*(People|Guests)\b/gi, '$1 to $2 $3');
        }

        return s
            .replace(/\.\s*\./g, '.')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function formatLocalFallbackCurrency(text, lang) {
        // Used when offline browser speechSynthesis fallback is triggered so USD amounts are always spoken in US dollars and cents
        var out = String(text || '');
        while (/\$(\d{1,3}),(\d{3})(?=\D|$)/.test(out)) {
            out = out.replace(/\$(\d{1,3}),(\d{3})(?=\D|$)/g, '$$$1$2');
        }
        if (lang === 'es') {
            out = out
                .replace(/\$(\d+)\.00(?![.,\d])/g, '$1 dólares')
                .replace(/\$(\d+)\.(\d{2})(?![.,\d])/g, '$1 dólares con $2 centavos')
                .replace(/\$(\d+)\.(\d)(?![.,\d])/g, '$1 dólares con $20 centavos')
                .replace(/\$(\d+)(?![.,\d])/g, '$1 dólares');
        } else {
            out = out
                .replace(/\$(\d+)\.00(?![.,\d])/g, '$1 dollars')
                .replace(/\$(\d+)\.(\d{2})(?![.,\d])/g, '$1 dollars and $2 cents')
                .replace(/\$(\d+)\.(\d)(?![.,\d])/g, '$1 dollars and $20 cents')
                .replace(/\$(\d+)(?![.,\d])/g, '$1 dollars');
        }
        return out;
    }

    function extractReadableTextFromElement(el) {
        if (!el) return '';
        var t = I18N[currentLang];

        if (el.tagName === 'IMG') {
            var alt = (el.getAttribute('alt') || '').trim();
            return normalizeKoreClientText(alt || t.imgFallbackAlt, currentLang);
        }

        // Check if element IS a location/store card itself
        var isStoreCardSelf = el.matches && el.matches('.location-card, .store-card');
        if (isStoreCardSelf) {
            var slug = el.getAttribute('data-store') || '';
            var canonicalStore = getCanonicalCustomerStoreLabel(slug, currentLang);
            var parts = [];
            if (canonicalStore) {
                parts.push(canonicalStore);
                // Add cross streets for non-LA stores (LA stores already include cross streets in canonicalStore)
                if (slug !== 'la-broadway' && slug !== 'la-central' && slug !== 'slauson') {
                    var crossEl = el.querySelector('.location-cross-streets, .store-card-cross-streets');
                    if (crossEl && crossEl.textContent) {
                        parts.push(crossEl.textContent.trim());
                    }
                }
            } else {
                var cityEl = el.querySelector('.location-city-name, .store-card-city');
                var crEl = el.querySelector('.location-cross-streets, .store-card-cross-streets');
                if (cityEl && crEl) {
                    parts.push(cityEl.textContent.trim() + ', ' + crEl.textContent.trim());
                }
            }
            var extraSelectors = el.querySelectorAll('.store-address, .store-hours, .schedule-row, p');
            for (var i = 0; i < extraSelectors.length; i++) {
                var rowTxt = (extraSelectors[i].textContent || '').trim();
                if (rowTxt) parts.push(rowTxt);
            }
            return normalizeKoreClientText(parts.join('. '), currentLang);
        }

        // Check if element is an action button/link INSIDE a store card (WCAG 2.4.4 context)
        if (el.matches && el.matches('a, button') && el.closest) {
            var parentStoreCard = el.closest('[data-store]');
            if (parentStoreCard) {
                var pSlug = parentStoreCard.getAttribute('data-store') || '';
                var pStoreLabel = getCanonicalCustomerStoreLabel(pSlug, currentLang);
                var btnText = (el.getAttribute('aria-label') || el.innerText || el.textContent || '').trim();
                if (pStoreLabel && btnText && btnText.toLowerCase().indexOf('los angeles') === -1 && btnText.toLowerCase().indexOf('los ángeles') === -1) {
                    if (el.classList && el.classList.contains('location-name-link')) {
                        return normalizeKoreClientText(pStoreLabel, currentLang);
                    }
                    return normalizeKoreClientText(btnText + ' — ' + pStoreLabel, currentLang);
                }
            }
        }

        // Composite Menu Item card
        if (el.matches && el.matches('.menu-item')) {
            var nameEl = el.querySelector('.menu-item-name, h3, h4');
            var descEl = el.querySelector('.menu-item-desc, p');
            var menuParts = [];
            if (nameEl && nameEl.textContent) menuParts.push(nameEl.textContent.trim());
            if (descEl && descEl.textContent) menuParts.push(descEl.textContent.trim());
            if (menuParts.length > 0) {
                return normalizeKoreClientText(menuParts.join('. '), currentLang);
            }
        }

        // Composite Catering Package / Step card
        if (el.matches && el.matches('.package-card, .step-item')) {
            var subNodes = el.querySelectorAll('h2, h3, h4, .package-size, .package-price, p, li');
            if (subNodes.length > 0) {
                var cParts = [];
                for (var j = 0; j < subNodes.length; j++) {
                    var st = (subNodes[j].textContent || '').trim();
                    if (st) cParts.push(st);
                }
                return normalizeKoreClientText(cParts.join('. '), currentLang);
            }
        }

        var raw = (el.getAttribute && el.getAttribute('aria-label')) || el.innerText || el.textContent || '';
        return normalizeKoreClientText(raw, currentLang);
    }

    function splitIntoNaturalChunks(text, maxChars) {
        var limit = maxChars || 750;
        var clean = String(text || '').trim();
        if (!clean) return [];
        if (clean.length <= limit) return [clean];

        var chunks = [];
        var remaining = clean;
        while (remaining.length > limit) {
            var slice = remaining.slice(0, limit);
            var cutIdx = -1;
            var punctMarks = ['. ', '! ', '? ', '; ', ': ', ', '];
            for (var p = 0; p < punctMarks.length; p++) {
                var idx = slice.lastIndexOf(punctMarks[p]);
                if (idx >= Math.floor(limit * 0.45)) {
                    cutIdx = idx + 1;
                    break;
                }
            }
            if (cutIdx === -1) {
                var lastSpace = slice.lastIndexOf(' ');
                cutIdx = lastSpace > 120 ? lastSpace : limit;
            }
            var piece = remaining.slice(0, cutIdx).trim();
            if (piece) chunks.push(piece);
            remaining = remaining.slice(cutIdx).trim();
        }
        if (remaining) chunks.push(remaining);
        return chunks;
    }

    function isElementVisiblyReadable(el) {
        if (!el || el.nodeType !== 1) return false;
        if (el.closest('#tg-a11y-panel, #tg-a11y-trigger, #tg-speech-bar, #tg-cookie-banner, #cookie-banner, #tg-cookie-modal, #tg-statement-modal, #tg-reading-mask, #tg-reading-guide-line, #tg-color-filter-layer, #tg-a11y-live')) {
            return false;
        }
        if (el.closest('[aria-hidden="true"], [hidden], script, style, noscript, svg, template')) {
            return false;
        }
        var cur = el;
        while (cur && cur !== document.documentElement) {
            if (cur.hasAttribute && (cur.hasAttribute('hidden') || cur.getAttribute('aria-hidden') === 'true')) {
                return false;
            }
            var cs = window.getComputedStyle ? window.getComputedStyle(cur) : null;
            if (cs && (cs.display === 'none' || cs.visibility === 'hidden')) {
                return false;
            }
            cur = cur.parentElement;
        }
        var rect = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
        if (rect && rect.width === 0 && rect.height === 0) return false;
        return true;
    }

    /* ==========================================================================
       6. KORE NEURAL VOICE ENGINE + LRU CACHE + N+1 PREFETCH + FEMALE FALLBACK
       ========================================================================== */
    var KORE_MAX_LRU = 48;
    var koreAudioLru = []; // Array of { key, blob, objectUrl, directUrl } (newest at end)
    var koreInflightMap = {}; // key -> Promise
    var cspBlocksBlobMedia = false;
    var preferredWorkingOriginPrefix = null;

    var activeAudio = null;
    var activeAbortController = null;
    var currentSpeechUtterance = null;
    var currentHighlightedEl = null;

    var koreQueue = [];       // Array of { text: string, el: Element | null }
    var koreQueueIndex = -1;
    var koreStatus = 'idle';  // 'idle' | 'loading' | 'playing' | 'paused'
    var koreMode = 'none';    // 'none' | 'single' | 'page'
    var koreLastSnippet = '';
    var korePlayToken = 0;

    var FORBIDDEN_MALE_VOICE_RE = /\b(raul|jorge|alonso|alvaro|pablo|diego|carlos|juan|andres|tomas|lorenzo|gonzalo|dario|emilio|rodrigo|mateo|sebastian|alejandro|fernando|miguel|ricardo|gerardo|enrique|david|mark|guy|christopher|eric|brian|andrew|steffan|roger|ryan|daniel|george|oliver|thomas|james|liam|orus|puck|male|hombre|masculin|masculino|masc)\b/i;
    var EXPLICIT_FEMALE_VOICE_RE = /\b(sabina|paulina|dalia|elena|paloma|helena|laura|monica|francisca|elvira|beatriz|camila|catalina|salome|ximena|larissa|paola|sofia|valentina|isabella|lucia|carmen|rosa|teresa|andrea|natalia|gabriela|daniela|mariana|fernanda|aria|jenny|zira|samantha|victoria|ava|emma|michelle|sonia|libby|maisie|natasha|clara|molly|female|femenina|femenino|mujer)\b|google\s+espa[nñ]ol|google\s+us\s+english/i;
    var cachedBrowserVoices = [];

    function warmUpBrowserVoices() {
        if (typeof window === 'undefined' || !window.speechSynthesis || typeof window.speechSynthesis.getVoices !== 'function') {
            return;
        }
        try {
            var initial = window.speechSynthesis.getVoices();
            if (initial && initial.length > 0) cachedBrowserVoices = initial;
            var refreshVoices = function () {
                try {
                    var loaded = window.speechSynthesis.getVoices();
                    if (loaded && loaded.length > 0) cachedBrowserVoices = loaded;
                } catch (e) {}
            };
            if (typeof window.speechSynthesis.addEventListener === 'function') {
                window.speechSynthesis.addEventListener('voiceschanged', refreshVoices);
            } else if ('onvoiceschanged' in window.speechSynthesis) {
                window.speechSynthesis.onvoiceschanged = refreshVoices;
            }
        } catch (e) {}
    }

    function pickBestFemaleBrowserVoice(lang) {
        if (typeof window === 'undefined' || !window.speechSynthesis || typeof window.speechSynthesis.getVoices !== 'function') {
            return null;
        }
        var liveVoices = window.speechSynthesis.getVoices() || [];
        var voices = liveVoices.length > 0 ? liveVoices : cachedBrowserVoices;
        if (!voices.length) return null;
        var prefix = lang === 'en' ? 'en' : 'es';
        var nonMaleLang = [];
        for (var i = 0; i < voices.length; i++) {
            var v = voices[i];
            if (!v || !v.lang || v.lang.toLowerCase().indexOf(prefix) !== 0) continue;
            var combined = ((v.name || '') + ' ' + (v.voiceURI || '')).normalize ? ((v.name || '') + ' ' + (v.voiceURI || '')).normalize('NFD').replace(/[\u0300-\u036f]/g, '') : ((v.name || '') + ' ' + (v.voiceURI || ''));
            if (!FORBIDDEN_MALE_VOICE_RE.test(combined)) {
                nonMaleLang.push({ voice: v, norm: combined });
            }
        }
        for (var j = 0; j < nonMaleLang.length; j++) {
            if (EXPLICIT_FEMALE_VOICE_RE.test(nonMaleLang[j].norm)) {
                return nonMaleLang[j].voice;
            }
        }
        if (nonMaleLang.length > 0) return nonMaleLang[0].voice;
        // Cross-language verified female fallback (e.g. Microsoft Zira on minimal Windows) rather than robotic male default
        for (var k = 0; k < voices.length; k++) {
            var vk = voices[k];
            var nk = ((vk.name || '') + ' ' + (vk.voiceURI || ''));
            if (!FORBIDDEN_MALE_VOICE_RE.test(nk) && EXPLICIT_FEMALE_VOICE_RE.test(nk)) {
                return vk;
            }
        }
        return null;
    }

    function getLruEntry(key) {
        for (var i = 0; i < koreAudioLru.length; i++) {
            if (koreAudioLru[i].key === key) {
                var hit = koreAudioLru.splice(i, 1)[0];
                koreAudioLru.push(hit);
                return hit;
            }
        }
        return null;
    }

    function putLruEntry(key, blob, directUrl) {
        var existing = getLruEntry(key);
        if (existing) return existing;
        var objUrl = null;
        try {
            if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
                objUrl = URL.createObjectURL(blob);
            }
        } catch (e) {}
        var entry = { key: key, blob: blob, objectUrl: objUrl, directUrl: directUrl };
        koreAudioLru.push(entry);
        while (koreAudioLru.length > KORE_MAX_LRU) {
            var evicted = koreAudioLru.shift();
            if (evicted && evicted.objectUrl && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
                try { URL.revokeObjectURL(evicted.objectUrl); } catch (e) {}
            }
        }
        return entry;
    }

    function buildKoreCandidateUrls(lang, text) {
        var qs = '?lang=' + encodeURIComponent(lang) + '&text=' + encodeURIComponent(text);
        var host = (window.location && window.location.hostname || '').toLowerCase();
        var origin = (window.location && window.location.origin && window.location.origin !== 'null') ? window.location.origin : '';
        var candidates = [];
        var seenBases = {};

        var pushUnique = function (basePrefix) {
            if (!basePrefix || Object.prototype.hasOwnProperty.call(seenBases, basePrefix)) return;
            seenBases[basePrefix] = true;
            candidates.push({ base: basePrefix, url: basePrefix + qs });
        };

        if (preferredWorkingOriginPrefix) {
            pushUnique(preferredWorkingOriginPrefix);
        }

        if (host === 'tacosgavilan.com' || host === 'www.tacosgavilan.com') {
            pushUnique((origin || '') + '/api/a11y-tts');
            pushUnique('https://tacosgavilan.vercel.app/api/web-a11y/tts');
            pushUnique('https://teg-tacosgavilan.vercel.app/api/web-a11y/tts');
        } else if (host === 'localhost' || host === '127.0.0.1' || /\.vercel\.app$/i.test(host)) {
            if (origin) {
                pushUnique(origin + '/api/web-a11y/tts');
                pushUnique(origin + '/api/a11y-tts');
            }
            if ((host === 'localhost' || host === '127.0.0.1') && window.location.port !== '3000') {
                pushUnique('http://localhost:3000/api/web-a11y/tts');
                pushUnique('http://127.0.0.1:3000/api/web-a11y/tts');
            }
            if (/\.vercel\.app$/i.test(host) && host !== 'tacosgavilan.vercel.app') {
                pushUnique('https://tacosgavilan.vercel.app/api/web-a11y/tts');
            }
        } else {
            if (origin) {
                pushUnique(origin + '/api/web-a11y/tts');
                pushUnique(origin + '/api/a11y-tts');
            }
            pushUnique('https://tacosgavilan.vercel.app/api/web-a11y/tts');
        }

        return candidates;
    }

    function fetchKoreAudioEntry(text, lang, externalSignal) {
        var clean = normalizeKoreClientText(text, lang).slice(0, 880);
        if (!clean) return Promise.reject(new Error('EMPTY_TEXT'));

        var cacheKey = lang + '|' + clean;
        var cached = getLruEntry(cacheKey);
        if (cached) return Promise.resolve(cached);

        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
            return Promise.reject(new Error('OFFLINE'));
        }

        if (!externalSignal && Object.prototype.hasOwnProperty.call(koreInflightMap, cacheKey)) {
            return koreInflightMap[cacheKey];
        }

        var candidates = buildKoreCandidateUrls(lang, clean);

        var runProbe = function (idx) {
            if (idx >= candidates.length) {
                return Promise.reject(new Error('ALL_ENDPOINTS_FAILED'));
            }
            if (externalSignal && externalSignal.aborted) {
                return Promise.reject(new Error('ABORTED'));
            }
            var item = candidates[idx];
            return fetch(item.url, {
                method: 'GET',
                headers: { 'Accept': 'audio/wav, audio/*;q=0.9, application/json;q=0.8' },
                signal: externalSignal
            }).then(function (res) {
                var cType = (res.headers && res.headers.get('content-type')) || '';
                if (res.ok && cType.toLowerCase().indexOf('audio') !== -1) {
                    return res.blob().then(function (blob) {
                        if (!blob || blob.size < 44) {
                            return runProbe(idx + 1);
                        }
                        preferredWorkingOriginPrefix = item.base;
                        return putLruEntry(cacheKey, blob, item.url);
                    });
                }
                if (res.status === 429 || res.status === 503) {
                    return res.json().catch(function () { return { fallback: true }; }).then(function (body) {
                        if (body && body.fallback) {
                            throw new Error('SERVER_FALLBACK');
                        }
                        return runProbe(idx + 1);
                    });
                }
                return runProbe(idx + 1);
            }).catch(function (err) {
                if (externalSignal && externalSignal.aborted) throw new Error('ABORTED');
                if (err && err.message === 'SERVER_FALLBACK') throw err;
                return runProbe(idx + 1);
            });
        };

        var p = runProbe(0);
        if (!externalSignal) {
            koreInflightMap[cacheKey] = p;
            p.then(function () {
                delete koreInflightMap[cacheKey];
            }, function () {
                delete koreInflightMap[cacheKey];
            });
        }
        return p;
    }

    function prefetchKoreChunk(text, lang) {
        if (!text) return;
        fetchKoreAudioEntry(text, lang, null).catch(function () {});
    }

    function applyAudioPlaybackRate(audioEl) {
        if (!audioEl) return;
        var rate = Number(a11yState.speechRate) || 1;
        try {
            if ('preservesPitch' in audioEl) audioEl.preservesPitch = true;
            if ('mozPreservesPitch' in audioEl) audioEl.mozPreservesPitch = true;
            if ('webkitPreservesPitch' in audioEl) audioEl.webkitPreservesPitch = true;
            audioEl.playbackRate = rate;
        } catch (e) {}
    }

    function highlightSpokenElement(el, shouldScroll) {
        if (currentHighlightedEl && currentHighlightedEl !== el) {
            currentHighlightedEl.classList.remove('tg-speech-active');
            currentHighlightedEl = null;
        }
        if (el && el.classList) {
            currentHighlightedEl = el;
            el.classList.add('tg-speech-active');
            if (shouldScroll && typeof el.scrollIntoView === 'function') {
                try {
                    el.scrollIntoView({
                        behavior: a11yState.stopAnim ? 'auto' : 'smooth',
                        block: 'center'
                    });
                } catch (e) {
                    el.scrollIntoView(true);
                }
            }
        }
    }

    function clearSpokenHighlight() {
        if (currentHighlightedEl) {
            currentHighlightedEl.classList.remove('tg-speech-active');
            currentHighlightedEl = null;
        }
    }

    function haltCurrentPlaybackPrimitives() {
        if (activeAbortController) {
            try { activeAbortController.abort(); } catch (e) {}
            activeAbortController = null;
        }
        if (activeAudio) {
            try {
                activeAudio.onended = null;
                activeAudio.onerror = null;
                activeAudio.pause();
                activeAudio.removeAttribute('src');
                activeAudio.load();
            } catch (e) {}
            activeAudio = null;
        }
        if (typeof window !== 'undefined' && window.speechSynthesis) {
            try { window.speechSynthesis.cancel(); } catch (e) {}
        }
        currentSpeechUtterance = null;
    }

    function stopSpeaking() {
        korePlayToken++;
        haltCurrentPlaybackPrimitives();
        clearSpokenHighlight();
        koreQueue = [];
        koreQueueIndex = -1;
        koreStatus = 'idle';
        koreMode = 'none';
        koreLastSnippet = '';
        updateKorePlayerUI();
    }

    function playFallbackSpeechSynthesis(text, lang, token, onDone) {
        if (typeof window === 'undefined' || !window.speechSynthesis || typeof SpeechSynthesisUtterance === 'undefined') {
            onDone();
            return;
        }
        var speakNowWithBestVoice = function () {
            if (token !== korePlayToken) return;
            try {
                window.speechSynthesis.cancel();
                var spokenText = formatLocalFallbackCurrency(text, lang);
                var utterance = new SpeechSynthesisUtterance(spokenText);
                var femaleVoice = pickBestFemaleBrowserVoice(lang);
                if (femaleVoice) {
                    utterance.voice = femaleVoice;
                    utterance.lang = femaleVoice.lang || (lang === 'es' ? 'es-US' : 'en-US');
                } else {
                    utterance.lang = lang === 'es' ? 'es-US' : 'en-US';
                }
                utterance.rate = Number(a11yState.speechRate) || 1;
                utterance.pitch = 1.04;

                utterance.onend = function () {
                    if (token !== korePlayToken) return;
                    currentSpeechUtterance = null;
                    onDone();
                };
                utterance.onerror = function () {
                    if (token !== korePlayToken) return;
                    currentSpeechUtterance = null;
                    onDone();
                };

                currentSpeechUtterance = utterance;
                koreStatus = 'playing';
                updateKorePlayerUI();
                window.speechSynthesis.speak(utterance);
            } catch (err) {
                onDone();
            }
        };

        try {
            var currentVoices = (window.speechSynthesis.getVoices && window.speechSynthesis.getVoices()) || cachedBrowserVoices;
            if (!currentVoices || currentVoices.length === 0) {
                var settled = false;
                var finishWait = function () {
                    if (settled) return;
                    settled = true;
                    speakNowWithBestVoice();
                };
                if (typeof window.speechSynthesis.addEventListener === 'function') {
                    window.speechSynthesis.addEventListener('voiceschanged', finishWait, { once: true });
                }
                setTimeout(finishWait, 240);
                return;
            }
            speakNowWithBestVoice();
            return;

        } catch (e) {
            onDone();
        }
    }

    function playQueueAtIndex(index) {
        if (!koreQueue.length || index < 0 || index >= koreQueue.length) {
            var finishedPage = (koreMode === 'page');
            clearSpokenHighlight();
            koreQueue = [];
            koreQueueIndex = -1;
            koreStatus = 'idle';
            koreMode = 'none';
            if (!finishedPage) koreLastSnippet = '';
            updateKorePlayerUI();
            return;
        }

        var token = ++korePlayToken;
        haltCurrentPlaybackPrimitives();

        koreQueueIndex = index;
        var item = koreQueue[index];
        koreLastSnippet = item.text;
        koreStatus = 'loading';
        highlightSpokenElement(item.el, koreMode === 'page');
        updateKorePlayerUI();

        // Background N+1 prefetch for zero-gap full-page reading
        if (index + 1 < koreQueue.length) {
            prefetchKoreChunk(koreQueue[index + 1].text, currentLang);
        }

        var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        activeAbortController = controller;

        var advanceNext = function () {
            if (token !== korePlayToken) return;
            if (index + 1 < koreQueue.length) {
                playQueueAtIndex(index + 1);
            } else {
                clearSpokenHighlight();
                koreQueue = [];
                koreQueueIndex = -1;
                koreStatus = 'idle';
                koreMode = 'none';
                updateKorePlayerUI();
            }
        };

        fetchKoreAudioEntry(item.text, currentLang, controller ? controller.signal : null)
            .then(function (entry) {
                if (token !== korePlayToken) return;
                activeAbortController = null;

                var startAudioWithSrc = function (srcUrl, allowRetryDirect) {
                    var audio = new Audio();
                    audio.preload = 'auto';
                    audio.src = srcUrl;
                    applyAudioPlaybackRate(audio);
                    activeAudio = audio;

                    audio.onended = function () {
                        if (token !== korePlayToken) return;
                        activeAudio = null;
                        advanceNext();
                    };

                    audio.onerror = function () {
                        if (token !== korePlayToken) return;
                        // If CSP default-src 'self' blocked blob: URL, retry immediately with same-origin directUrl
                        if (allowRetryDirect && entry.directUrl && srcUrl !== entry.directUrl) {
                            cspBlocksBlobMedia = true;
                            startAudioWithSrc(entry.directUrl, false);
                            return;
                        }
                        activeAudio = null;
                        playFallbackSpeechSynthesis(item.text, currentLang, token, advanceNext);
                    };

                    var playPromise = audio.play();
                    koreStatus = 'playing';
                    updateKorePlayerUI();
                    if (playPromise && typeof playPromise.catch === 'function') {
                        playPromise.catch(function () {
                            if (token !== korePlayToken) return;
                            if (allowRetryDirect && entry.directUrl && srcUrl !== entry.directUrl) {
                                cspBlocksBlobMedia = true;
                                startAudioWithSrc(entry.directUrl, false);
                                return;
                            }
                            activeAudio = null;
                            playFallbackSpeechSynthesis(item.text, currentLang, token, advanceNext);
                        });
                    }
                };

                if (!cspBlocksBlobMedia && entry.objectUrl) {
                    startAudioWithSrc(entry.objectUrl, true);
                } else {
                    startAudioWithSrc(entry.directUrl, false);
                }
            })
            .catch(function (err) {
                if (token !== korePlayToken) return;
                if (err && err.message === 'ABORTED') return;
                activeAbortController = null;
                playFallbackSpeechSynthesis(item.text, currentLang, token, advanceNext);
            });
    }

    function togglePlayPauseKore() {
        if (koreStatus === 'playing') {
            if (activeAudio) {
                try { activeAudio.pause(); } catch (e) {}
                koreStatus = 'paused';
                updateKorePlayerUI();
                return;
            }
            if (typeof window !== 'undefined' && window.speechSynthesis && window.speechSynthesis.speaking) {
                try { window.speechSynthesis.pause(); } catch (e) {}
                koreStatus = 'paused';
                updateKorePlayerUI();
                return;
            }
        } else if (koreStatus === 'paused') {
            if (activeAudio) {
                applyAudioPlaybackRate(activeAudio);
                var p = activeAudio.play();
                koreStatus = 'playing';
                updateKorePlayerUI();
                if (p && typeof p.catch === 'function') p.catch(function () {});
                return;
            }
            if (typeof window !== 'undefined' && window.speechSynthesis && window.speechSynthesis.paused) {
                try { window.speechSynthesis.resume(); } catch (e) {}
                koreStatus = 'playing';
                updateKorePlayerUI();
                return;
            }
            if (koreQueue.length > 0 && koreQueueIndex >= 0) {
                playQueueAtIndex(koreQueueIndex);
                return;
            }
        } else if (koreStatus === 'idle') {
            readFullPage();
        }
    }

    function stepKoreQueue(delta) {
        if (!koreQueue.length) return;
        var nextIdx = koreQueueIndex + delta;
        if (nextIdx < 0) nextIdx = 0;
        if (nextIdx >= koreQueue.length) return;
        playQueueAtIndex(nextIdx);
    }

    function setKoreSpeechRate(rate) {
        var num = Number(rate);
        if ([0.85, 1, 1.15, 1.3].indexOf(num) === -1) num = 1;
        a11yState.speechRate = num;
        saveA11yState();
        if (activeAudio) {
            applyAudioPlaybackRate(activeAudio);
        }
        updateKorePlayerUI();
    }

    function cycleKoreSpeechRate() {
        var rates = [0.85, 1, 1.15, 1.3];
        var idx = rates.indexOf(Number(a11yState.speechRate));
        var next = rates[(idx + 1) % rates.length];
        setKoreSpeechRate(next);
    }

    function speakText(text, targetEl) {
        var clean = normalizeKoreClientText(text, currentLang);
        if (!clean) return;
        var parts = splitIntoNaturalChunks(clean, 750);
        if (!parts.length) return;

        koreMode = 'single';
        koreQueue = parts.map(function (chunk) {
            return { text: chunk, el: targetEl || null };
        });
        playQueueAtIndex(0);
    }

    function readFullPage() {
        var t = I18N[currentLang];
        var queue = [];
        var visited = [];

        var hasVisitedAncestorOrSelf = function (node) {
            for (var i = 0; i < visited.length; i++) {
                if (visited[i] === node || (visited[i].contains && visited[i].contains(node))) {
                    return true;
                }
            }
            return false;
        };

        if (document.title) {
            var rawDocTitle = String(document.title);
            if (currentLang === 'es') {
                rawDocTitle = rawDocTitle
                    .replace(/Authentic Mexican Food Since 1992/gi, 'Auténtica Comida Mexicana desde 1992')
                    .replace(/Authentic Mexican Food\s*&\s*Online Ordering/gi, 'Auténtica Comida Mexicana y Pedidos en Línea')
                    .replace(/Locations\s*&\s*Hours/gi, 'Sucursales y Horarios')
                    .replace(/15 Stores Across Southern California/gi, '15 Sucursales en el Sur de California')
                    .replace(/Fiesta Platter\s*&\s*Catering/gi, 'Charolas para Fiestas y Eventos')
                    .replace(/Contact Us/gi, 'Contacto')
                    .replace(/Tacos Gavilan Guest Support\s*&\s*Feedback/gi, 'Atención al Cliente de Tacos Gavilan')
                    .replace(/Accessibility Statement/gi, 'Declaración de Accesibilidad')
                    .replace(/Privacy Policy\s*&\s*California Notice at Collection\s*\(CCPA\/CPRA\)/gi, 'Política de Privacidad y Aviso de Recopilación de California')
                    .replace(/Your California Privacy Choices\s*\(Do Not Sell or Share\s*\/\s*GPC\)/gi, 'Opciones de Privacidad de California, No Vender ni Compartir')
                    .replace(/Terms of Use,\s*Online Ordering\s*&\s*Allergen Notice/gi, 'Términos de Uso, Pedidos en Línea y Aviso de Alérgenos')
                    .replace(/Blog\s*&\s*News/gi, 'Blog y Noticias')
                    .replace(/Tacos Gavilan Stories,\s*Recipes\s*&\s*Community/gi, 'Historias, Recetas y Comunidad de Tacos Gavilan');
            }
            rawDocTitle = rawDocTitle.replace(/\s*\|\s*/g, '. ');
            var cleanTitle = normalizeKoreClientText(rawDocTitle, currentLang);
            if (cleanTitle) queue.push({ text: cleanTitle, el: document.querySelector('h1') || null });
        }

        var root = document.querySelector('main, #main-content') || document.body;
        var candidates = root.querySelectorAll(
            'h1, h2, .hero-subtitle, .hero-description, .menu-item, .location-card, .store-card, .package-card, .step-item, .legal-section h2, .legal-section p, .legal-section li, .fiesta-text p, .fiesta-features li, section p'
        );

        for (var idx = 0; idx < candidates.length; idx++) {
            var el = candidates[idx];
            if (hasVisitedAncestorOrSelf(el)) continue;
            if (!isElementVisiblyReadable(el)) continue;

            var extracted = extractReadableTextFromElement(el);
            if (!extracted || extracted.length < 2) continue;

            visited.push(el);
            var chunks = splitIntoNaturalChunks(extracted, 750);
            for (var c = 0; c < chunks.length; c++) {
                queue.push({ text: chunks[c], el: el });
            }
        }

        // Fallback if a minimal page had no matched selectors
        if (queue.length <= 1) {
            var fallbackNodes = document.querySelectorAll('h1, h2, h3, p');
            for (var f = 0; f < fallbackNodes.length; f++) {
                var fn = fallbackNodes[f];
                if (hasVisitedAncestorOrSelf(fn) || !isElementVisiblyReadable(fn)) continue;
                var fTxt = extractReadableTextFromElement(fn);
                if (fTxt && fTxt.length >= 3) {
                    visited.push(fn);
                    splitIntoNaturalChunks(fTxt, 750).forEach(function (ch) {
                        queue.push({ text: ch, el: fn });
                    });
                }
            }
        }

        queue.push({ text: t.korePageAssistEnd, el: null });

        koreMode = 'page';
        koreQueue = queue;
        playQueueAtIndex(0);
    }

    /* ==========================================================================
       7. SMART PROFILES & ACCESSIBILITY DOM MANIPULATION
       ========================================================================== */
    var SMART_PROFILES = {
        blind: {
            isMatch: function () {
                return !!(a11yState.screenReader && a11yState.highlightLinks);
            },
            apply: function (turnOn) {
                a11yState.screenReader = turnOn;
                a11yState.highlightLinks = turnOn;
                a11yState.focusEnhanced = turnOn;
                if (turnOn) {
                    speakText(I18N[currentLang].koreWelcomeInteractive, null);
                } else {
                    stopSpeaking();
                }
            }
        },
        lowVision: {
            isMatch: function () {
                return !!(a11yState.contrast && a11yState.fontSize >= 1 && a11yState.bigCursor);
            },
            apply: function (turnOn) {
                a11yState.contrast = turnOn;
                if (turnOn) a11yState.invert = false;
                a11yState.fontSize = turnOn ? 2 : 0;
                a11yState.bigCursor = turnOn;
            }
        },
        dyslexia: {
            isMatch: function () {
                return !!(a11yState.dyslexic && a11yState.spacing >= 1 && a11yState.readingGuide);
            },
            apply: function (turnOn) {
                a11yState.dyslexic = turnOn;
                a11yState.spacing = turnOn ? 1 : 0;
                a11yState.readingGuide = turnOn;
                if (turnOn) a11yState.readingMask = false;
            }
        },
        adhd: {
            isMatch: function () {
                return !!(a11yState.readingMask && a11yState.stopAnim);
            },
            apply: function (turnOn) {
                a11yState.readingMask = turnOn;
                a11yState.stopAnim = turnOn;
                if (turnOn) a11yState.readingGuide = false;
            }
        },
        motor: {
            isMatch: function () {
                return !!(a11yState.highlightLinks && a11yState.focusEnhanced && a11yState.bigCursor && !a11yState.screenReader);
            },
            apply: function (turnOn) {
                a11yState.highlightLinks = turnOn;
                a11yState.focusEnhanced = turnOn;
                a11yState.bigCursor = turnOn;
            }
        },
        seizure: {
            isMatch: function () {
                return !!(a11yState.stopAnim && a11yState.saturation === 1);
            },
            apply: function (turnOn) {
                a11yState.stopAnim = turnOn;
                a11yState.saturation = turnOn ? 1 : 0;
            }
        }
    };

    var lastPointerY = Math.round((typeof window !== 'undefined' ? window.innerHeight : 720) * 0.38);

    function updateMaskAndGuidePosition(clientY) {
        if (typeof clientY === 'number' && !isNaN(clientY)) {
            lastPointerY = clientY;
        }
        var guide = document.getElementById('tg-reading-guide-line');
        if (guide && a11yState.readingGuide) {
            guide.style.top = lastPointerY + 'px';
        }
        var maskTop = document.getElementById('tg-reading-mask-top');
        var maskBottom = document.getElementById('tg-reading-mask-bottom');
        if (maskTop && maskBottom && a11yState.readingMask) {
            var bandHeight = 132;
            var half = Math.round(bandHeight / 2);
            var vh = window.innerHeight || 720;
            var topH = Math.max(0, Math.min(vh - bandHeight, lastPointerY - half));
            maskTop.style.height = topH + 'px';
            maskBottom.style.top = (topH + bandHeight) + 'px';
        }
    }

    function applyA11yToDOM() {
        var html = document.documentElement;

        // Dock Position (Left / Right)
        html.classList.toggle('tg-a11y-pos-left', a11yState.widgetPosition === 'left');

        // Contrast & Invert
        html.classList.toggle('tg-high-contrast', !!a11yState.contrast);
        html.classList.toggle('tg-invert-colors', !!a11yState.invert);

        // Saturation & Monochrome
        html.classList.remove('tg-sat-low', 'tg-sat-high', 'tg-sat-mono', 'tg-grayscale');
        if (a11yState.saturation === 1) {
            html.classList.add('tg-sat-low');
        } else if (a11yState.saturation === 2) {
            html.classList.add('tg-sat-high');
        } else if (a11yState.saturation === 3) {
            html.classList.add('tg-sat-mono', 'tg-grayscale');
        }

        // Hide Images
        html.classList.toggle('tg-hide-images', !!a11yState.hideImages);

        // Font Sizing (3 steps + legacy classes)
        html.classList.remove('tg-font-large', 'tg-font-xlarge', 'tg-font-step-1', 'tg-font-step-2', 'tg-font-step-3');
        if (a11yState.fontSize === 1) {
            html.classList.add('tg-font-step-1', 'tg-font-large');
        } else if (a11yState.fontSize === 2) {
            html.classList.add('tg-font-step-2', 'tg-font-xlarge');
        } else if (a11yState.fontSize === 3) {
            html.classList.add('tg-font-step-3');
        }

        // Text Spacing (3 steps + legacy .tg-text-spacing)
        html.classList.remove('tg-text-spacing', 'tg-spacing-1', 'tg-spacing-2', 'tg-spacing-3');
        if (a11yState.spacing === 1) {
            html.classList.add('tg-spacing-1', 'tg-text-spacing');
        } else if (a11yState.spacing === 2) {
            html.classList.add('tg-spacing-2', 'tg-text-spacing');
        } else if (a11yState.spacing === 3) {
            html.classList.add('tg-spacing-3', 'tg-text-spacing');
        }

        // Line Height (3 steps)
        html.classList.remove('tg-lh-1', 'tg-lh-2', 'tg-lh-3');
        if (a11yState.lineHeight >= 1 && a11yState.lineHeight <= 3) {
            html.classList.add('tg-lh-' + a11yState.lineHeight);
        }

        // Text Alignment (3 steps)
        html.classList.remove('tg-align-left', 'tg-align-center', 'tg-align-justify');
        if (a11yState.textAlign === 1) html.classList.add('tg-align-left');
        else if (a11yState.textAlign === 2) html.classList.add('tg-align-center');
        else if (a11yState.textAlign === 3) html.classList.add('tg-align-justify');

        // Dyslexic Font & Highlight Headings
        html.classList.toggle('tg-dyslexic-font', !!a11yState.dyslexic);
        html.classList.toggle('tg-highlight-headings', !!a11yState.highlightHeadings);

        // Highlight Links, Focus Ring, Big Cursor, Stop Animations
        html.classList.toggle('tg-highlight-links', !!a11yState.highlightLinks);
        html.classList.toggle('tg-focus-enhanced', !!a11yState.focusEnhanced);
        html.classList.toggle('tg-big-cursor', !!a11yState.bigCursor);
        html.classList.toggle('tg-stop-animations', !!a11yState.stopAnim);

        if (a11yState.stopAnim && typeof document !== 'undefined') {
            var videos = document.querySelectorAll('video');
            for (var v = 0; v < videos.length; v++) {
                try { videos[v].pause(); } catch (e) {}
            }
        }

        // Reading Guide & Reading Mask
        var guide = document.getElementById('tg-reading-guide-line');
        if (guide) {
            guide.classList.toggle('is-active', !!a11yState.readingGuide);
        }
        var mask = document.getElementById('tg-reading-mask');
        if (mask) {
            mask.classList.toggle('is-active', !!a11yState.readingMask);
        }
        if (a11yState.readingGuide || a11yState.readingMask) {
            updateMaskAndGuidePosition(lastPointerY);
        }

        updateA11yUI();
        updateKorePlayerUI();
    }

    var PLAY_ICON_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
    var PAUSE_ICON_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>';

    function updateStepDots(containerId, currentLevel, subId, labelsArray) {
        var dotsWrap = document.getElementById(containerId);
        if (dotsWrap) {
            var spans = dotsWrap.querySelectorAll('span');
            for (var i = 0; i < spans.length; i++) {
                spans[i].classList.toggle('is-filled', i < currentLevel);
            }
        }
        var subEl = document.getElementById(subId);
        if (subEl) {
            subEl.textContent = (currentLevel > 0 && labelsArray[currentLevel - 1]) ? labelsArray[currentLevel - 1] : '';
        }
    }

    function updateKorePlayerUI() {
        var t = I18N[currentLang];
        var isSpeakingNow = (koreStatus === 'playing' || koreStatus === 'loading');
        var hasQueue = koreQueue.length > 0 && koreQueueIndex >= 0;
        var panel = document.getElementById('tg-a11y-panel');
        var isPanelOpen = !!(panel && panel.classList.contains('is-open'));

        // 1. Trigger acoustic halo
        var trigger = document.getElementById('tg-a11y-trigger');
        if (trigger) {
            trigger.classList.toggle('is-speaking', isSpeakingNow);
        }

        // 2. Embedded Player Card
        var playerCard = document.getElementById('tg-kore-player');
        if (playerCard) {
            playerCard.classList.toggle('is-speaking', isSpeakingNow);
        }

        var statusText = t.koreStatusReady;
        if (koreStatus === 'loading') {
            statusText = t.koreStatusLoading;
        } else if (koreMode === 'page' && hasQueue) {
            statusText = t.koreSectionOf
                .replace('{x}', String(koreQueueIndex + 1))
                .replace('{y}', String(koreQueue.length));
            if (koreStatus === 'paused') statusText += ' · ' + t.koreStatusPaused;
        } else if (koreStatus === 'paused') {
            statusText = t.koreStatusPaused;
        } else if (a11yState.screenReader) {
            statusText = t.koreStatusInteractive;
        }

        setText('tg-kore-progress', statusText);
        setText('tg-speech-bar-progress', statusText);

        var snippetText = koreLastSnippet || (a11yState.screenReader ? t.koreInteractivePrompt : t.koreIdlePrompt);
        setText('tg-kore-snippet', snippetText);
        setText('tg-speech-bar-text', snippetText);

        var playPauseBtn = document.getElementById('tg-kore-play-pause');
        if (playPauseBtn) {
            playPauseBtn.innerHTML = (koreStatus === 'playing') ? PAUSE_ICON_SVG : PLAY_ICON_SVG;
            playPauseBtn.setAttribute('aria-label', (koreStatus === 'playing') ? t.korePauseLabel : t.korePlayLabel);
        }
        var miniPlayBtn = document.getElementById('tg-mini-play-pause');
        if (miniPlayBtn) {
            miniPlayBtn.innerHTML = (koreStatus === 'playing') ? PAUSE_ICON_SVG : PLAY_ICON_SVG;
            miniPlayBtn.setAttribute('aria-label', (koreStatus === 'playing') ? t.korePauseLabel : t.korePlayLabel);
        }

        var canPrev = hasQueue && koreQueueIndex > 0;
        var canNext = hasQueue && koreQueueIndex < koreQueue.length - 1;
        var canStop = (koreStatus !== 'idle' || hasQueue || a11yState.screenReader);

        setDisabled('tg-kore-prev', !canPrev);
        setDisabled('tg-kore-next', !canNext);
        setDisabled('tg-kore-stop', !canStop && koreStatus === 'idle');
        setDisabled('tg-mini-prev', !canPrev);
        setDisabled('tg-mini-next', !canNext);

        setBtnActive('tg-tool-page-reader', koreMode === 'page' && koreStatus !== 'idle');

        // Speed buttons
        var speedBtns = document.querySelectorAll('.tg-kore-speed-btn');
        var currentRateStr = String(a11yState.speechRate || 1);
        for (var s = 0; s < speedBtns.length; s++) {
            var isRateMatch = speedBtns[s].getAttribute('data-rate') === currentRateStr;
            speedBtns[s].classList.toggle('is-active', isRateMatch);
            speedBtns[s].setAttribute('aria-pressed', isRateMatch ? 'true' : 'false');
        }
        var miniSpeed = document.getElementById('tg-mini-speed');
        if (miniSpeed) {
            miniSpeed.textContent = currentRateStr + 'x';
        }

        // 3. Floating Mini-Player visibility: shown when panel is closed AND Kore is active/reading/paused or screenReader is enabled
        var speechBar = document.getElementById('tg-speech-bar');
        if (speechBar) {
            var shouldShowMini = !isPanelOpen && (koreStatus !== 'idle' || a11yState.screenReader);
            speechBar.classList.toggle('is-visible', shouldShowMini);
            speechBar.classList.toggle('is-speaking', isSpeakingNow);
        }
    }

    function setDisabled(id, disabled) {
        var el = document.getElementById(id);
        if (el) el.disabled = !!disabled;
    }

    function updateA11yUI() {
        var t = I18N[currentLang];
        var activeCount = 0;
        if (a11yState.contrast) activeCount++;
        if (a11yState.invert) activeCount++;
        if (a11yState.saturation > 0) activeCount++;
        if (a11yState.hideImages) activeCount++;
        if (a11yState.fontSize > 0) activeCount++;
        if (a11yState.spacing > 0) activeCount++;
        if (a11yState.lineHeight > 0) activeCount++;
        if (a11yState.textAlign > 0) activeCount++;
        if (a11yState.dyslexic) activeCount++;
        if (a11yState.highlightHeadings) activeCount++;
        if (a11yState.readingMask) activeCount++;
        if (a11yState.readingGuide) activeCount++;
        if (a11yState.highlightLinks) activeCount++;
        if (a11yState.focusEnhanced) activeCount++;
        if (a11yState.bigCursor) activeCount++;
        if (a11yState.stopAnim) activeCount++;
        if (a11yState.screenReader) activeCount++;

        var badge = document.getElementById('tg-a11y-badge');
        if (badge) {
            if (activeCount > 0) {
                badge.textContent = String(activeCount);
                badge.style.display = 'flex';
            } else {
                badge.style.display = 'none';
            }
        }

        // Smart Profile active states
        setBtnActive('tg-prof-blind', SMART_PROFILES.blind.isMatch());
        setBtnActive('tg-prof-low-vision', SMART_PROFILES.lowVision.isMatch());
        setBtnActive('tg-prof-dyslexia', SMART_PROFILES.dyslexia.isMatch());
        setBtnActive('tg-prof-adhd', SMART_PROFILES.adhd.isMatch());
        setBtnActive('tg-prof-motor', SMART_PROFILES.motor.isMatch());
        setBtnActive('tg-prof-seizure', SMART_PROFILES.seizure.isMatch());

        // Granular tool active states
        setBtnActive('tg-tool-screen-reader', a11yState.screenReader);
        setBtnActive('tg-tool-contrast', a11yState.contrast);
        setBtnActive('tg-tool-invert', a11yState.invert);
        setBtnActive('tg-tool-saturation', a11yState.saturation > 0);
        setBtnActive('tg-tool-hide-images', a11yState.hideImages);
        setBtnActive('tg-tool-text-size', a11yState.fontSize > 0);
        setBtnActive('tg-tool-spacing', a11yState.spacing > 0);
        setBtnActive('tg-tool-line-height', a11yState.lineHeight > 0);
        setBtnActive('tg-tool-text-align', a11yState.textAlign > 0);
        setBtnActive('tg-tool-dyslexic', a11yState.dyslexic);
        setBtnActive('tg-tool-highlight-headings', a11yState.highlightHeadings);
        setBtnActive('tg-tool-reading-mask', a11yState.readingMask);
        setBtnActive('tg-tool-reading-guide', a11yState.readingGuide);
        setBtnActive('tg-tool-highlight', a11yState.highlightLinks);
        setBtnActive('tg-tool-focus-ring', a11yState.focusEnhanced);
        setBtnActive('tg-tool-cursor', a11yState.bigCursor);
        setBtnActive('tg-tool-stop-anim', a11yState.stopAnim);

        // Step dots & sub-labels
        updateStepDots('tg-dots-saturation', a11yState.saturation, 'tg-sub-saturation', [t.satLow, t.satHigh, t.satMono]);
        updateStepDots('tg-dots-text-size', a11yState.fontSize, 'tg-sub-text-size', [t.sizeStep1, t.sizeStep2, t.sizeStep3]);
        updateStepDots('tg-dots-spacing', a11yState.spacing, 'tg-sub-spacing', [t.spaceStep1, t.spaceStep2, t.spaceStep3]);
        updateStepDots('tg-dots-line-height', a11yState.lineHeight, 'tg-sub-line-height', [t.lhStep1, t.lhStep2, t.lhStep3]);
        updateStepDots('tg-dots-text-align', a11yState.textAlign, 'tg-sub-text-align', [t.alignLeft, t.alignCenter, t.alignJustify]);

        // Dock position buttons
        setBtnActive('tg-pos-left', a11yState.widgetPosition === 'left');
        setBtnActive('tg-pos-right', a11yState.widgetPosition !== 'left');
    }

    function setBtnActive(id, isActive) {
        var el = document.getElementById(id);
        if (el) {
            el.classList.toggle('is-active', !!isActive);
            el.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        }
    }

    /* ==========================================================================
       8. DOM CREATION & BOOTSTRAP
       ========================================================================== */
    function createDOM() {
        var t = I18N[currentLang];

        // 0. Polite ARIA Live Region + Color Filter Backdrop Layer
        if (!document.getElementById('tg-a11y-live')) {
            var live = document.createElement('div');
            live.id = 'tg-a11y-live';
            live.setAttribute('role', 'status');
            live.setAttribute('aria-live', 'polite');
            live.setAttribute('aria-atomic', 'true');
            document.body.appendChild(live);
        }

        if (!document.getElementById('tg-color-filter-layer')) {
            var filterLayer = document.createElement('div');
            filterLayer.id = 'tg-color-filter-layer';
            filterLayer.setAttribute('aria-hidden', 'true');
            document.body.appendChild(filterLayer);
        }

        // 1. Reading Guide Line & Reading Mask Curtains
        if (!document.getElementById('tg-reading-guide-line')) {
            var guide = document.createElement('div');
            guide.id = 'tg-reading-guide-line';
            guide.className = 'tg-reading-guide-line';
            guide.setAttribute('aria-hidden', 'true');
            document.body.appendChild(guide);
        }

        if (!document.getElementById('tg-reading-mask')) {
            var mask = document.createElement('div');
            mask.id = 'tg-reading-mask';
            mask.setAttribute('aria-hidden', 'true');
            mask.innerHTML =
                '<div id="tg-reading-mask-top" class="tg-mask-curtain"></div>' +
                '<div id="tg-reading-mask-bottom" class="tg-mask-curtain"></div>';
            document.body.appendChild(mask);
        }

        window.addEventListener('mousemove', function (e) {
            if (a11yState.readingGuide || a11yState.readingMask) {
                updateMaskAndGuidePosition(e.clientY);
            }
        }, { passive: true });

        window.addEventListener('touchmove', function (e) {
            if ((a11yState.readingGuide || a11yState.readingMask) && e.touches && e.touches[0]) {
                updateMaskAndGuidePosition(e.touches[0].clientY);
            }
        }, { passive: true });

        // 2. Floating Accessibility Trigger Button
        if (!document.getElementById('tg-a11y-trigger')) {
            var trigger = document.createElement('button');
            trigger.id = 'tg-a11y-trigger';
            trigger.setAttribute('type', 'button');
            trigger.setAttribute('aria-haspopup', 'dialog');
            trigger.setAttribute('aria-expanded', 'false');
            trigger.setAttribute('aria-controls', 'tg-a11y-panel');
            trigger.setAttribute('aria-label', t.a11yTriggerLabel);
            trigger.setAttribute('title', t.a11yTriggerLabel);
            trigger.innerHTML =
                '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">' +
                '  <path d="M12 2c1.1 0 2 .9 2 2s-.9 2-2 2-2-.9-2-2 .9-2 2-2zm9 7h-6v13h-2v-6h-2v6H9V9H3V7h18v2z"/>' +
                '</svg>' +
                '<span id="tg-a11y-badge" class="tg-badge">0</span>';
            document.body.appendChild(trigger);
        }

        // 3. Accessibility Flyout Panel
        if (!document.getElementById('tg-a11y-panel')) {
            var panel = document.createElement('div');
            panel.id = 'tg-a11y-panel';
            panel.setAttribute('role', 'dialog');
            panel.setAttribute('aria-modal', 'true');
            panel.setAttribute('aria-labelledby', 'tg-a11y-title');
            panel.innerHTML =
                '<div class="tg-panel-header">' +
                '  <div class="tg-panel-title-wrap">' +
                '    <h2 id="tg-a11y-title" class="tg-panel-title">' +
                '      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2c1.1 0 2 .9 2 2s-.9 2-2 2-2-.9-2-2 .9-2 2-2zm9 7h-6v13h-2v-6h-2v6H9V9H3V7h18v2z"/></svg>' +
                '      <span id="tg-a11y-title-text">' + t.a11yTitle + '</span>' +
                '    </h2>' +
                '    <kbd id="tg-kbd-hint" class="tg-kbd-hint" title="' + t.a11yShortcutHint + '">Alt+A</kbd>' +
                '  </div>' +
                '  <div class="tg-header-actions">' +
                '    <button type="button" id="tg-lang-toggle" class="tg-lang-btn" aria-label="' + t.a11yLangAria + '">' + t.langToggle + '</button>' +
                '    <button type="button" id="tg-a11y-close" class="tg-close-btn" aria-label="' + t.a11yCloseLabel + '">×</button>' +
                '  </div>' +
                '</div>' +

                '<div class="tg-panel-body">' +
                // Section 1: Smart Profiles
                '  <div class="tg-section-block">' +
                '    <div class="tg-section-label" id="tg-sec-profiles">' + t.secProfiles + '</div>' +
                '    <div class="tg-profiles-grid">' +
                '      <button type="button" id="tg-prof-blind" data-profile="blind" class="tg-profile-btn" aria-pressed="false">' +
                '        <span class="tg-profile-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 3a9 9 0 00-9 9v7c0 1.1.9 2 2 2h3v-8H5v-1a7 7 0 0114 0v1h-3v8h3c1.1 0 2-.9 2-2v-7a9 9 0 00-9-9z"/></svg></span>' +
                '        <span class="tg-profile-copy"><span class="tg-profile-name" id="tg-prof-blind-name">' + t.profBlindName + '</span><span class="tg-profile-sub" id="tg-prof-blind-sub">' + t.profBlindSub + '</span></span>' +
                '      </button>' +
                '      <button type="button" id="tg-prof-low-vision" data-profile="lowVision" class="tg-profile-btn" aria-pressed="false">' +
                '        <span class="tg-profile-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zm0 12.5a5 5 0 110-10 5 5 0 010 10zm0-8a3 3 0 100 6 3 3 0 000-6z"/></svg></span>' +
                '        <span class="tg-profile-copy"><span class="tg-profile-name" id="tg-prof-low-name">' + t.profLowVisionName + '</span><span class="tg-profile-sub" id="tg-prof-low-sub">' + t.profLowVisionSub + '</span></span>' +
                '      </button>' +
                '      <button type="button" id="tg-prof-dyslexia" data-profile="dyslexia" class="tg-profile-btn" aria-pressed="false">' +
                '        <span class="tg-profile-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 5v3h5v11h3V8h5V5H4zm14 7h-3v7h3v-7z"/></svg></span>' +
                '        <span class="tg-profile-copy"><span class="tg-profile-name" id="tg-prof-dys-name">' + t.profDyslexiaName + '</span><span class="tg-profile-sub" id="tg-prof-dys-sub">' + t.profDyslexiaSub + '</span></span>' +
                '      </button>' +
                '      <button type="button" id="tg-prof-adhd" data-profile="adhd" class="tg-profile-btn" aria-pressed="false">' +
                '        <span class="tg-profile-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M3 5h18v4H3V5zm0 10h18v4H3v-4zm2-4h14v2H5v-2z"/></svg></span>' +
                '        <span class="tg-profile-copy"><span class="tg-profile-name" id="tg-prof-adhd-name">' + t.profAdhdName + '</span><span class="tg-profile-sub" id="tg-prof-adhd-sub">' + t.profAdhdSub + '</span></span>' +
                '      </button>' +
                '      <button type="button" id="tg-prof-motor" data-profile="motor" class="tg-profile-btn" aria-pressed="false">' +
                '        <span class="tg-profile-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M20 5H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm-9 3h2v2h-2V8zm0 3h2v2h-2v-2zM8 8h2v2H8V8zm0 3h2v2H8v-2zm-1 5H5v-2h2v2zm9 0H8v-2h8v2zm0-3h-2v-2h2v2zm0-3h-2V8h2v2zm3 6h-2v-2h2v2z"/></svg></span>' +
                '        <span class="tg-profile-copy"><span class="tg-profile-name" id="tg-prof-motor-name">' + t.profMotorName + '</span><span class="tg-profile-sub" id="tg-prof-motor-sub">' + t.profMotorSub + '</span></span>' +
                '      </button>' +
                '      <button type="button" id="tg-prof-seizure" data-profile="seizure" class="tg-profile-btn" aria-pressed="false">' +
                '        <span class="tg-profile-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 2L4 5v6.09c0 5.05 3.41 9.76 8 10.91 4.59-1.15 8-5.86 8-10.91V5l-8-3zm-1 14H9V8h2v8zm4 0h-2V8h2v8z"/></svg></span>' +
                '        <span class="tg-profile-copy"><span class="tg-profile-name" id="tg-prof-seiz-name">' + t.profSeizureName + '</span><span class="tg-profile-sub" id="tg-prof-seiz-sub">' + t.profSeizureSub + '</span></span>' +
                '      </button>' +
                '    </div>' +
                '  </div>' +

                // Section 2: Kore Neural Voice Player & Modes
                '  <div class="tg-section-block">' +
                '    <div class="tg-section-label" id="tg-sec-blindness">' + t.secBlindness + '</div>' +
                '    <div id="tg-kore-player" class="tg-kore-player">' +
                '      <div class="tg-kore-header">' +
                '        <span class="tg-kore-badge">' +
                '          <span class="tg-kore-wave" aria-hidden="true"><span></span><span></span><span></span><span></span></span>' +
                '          <span id="tg-kore-badge-text">' + t.koreBadge + '</span>' +
                '        </span>' +
                '        <span id="tg-kore-progress" class="tg-kore-progress">' + t.koreStatusReady + '</span>' +
                '      </div>' +
                '      <div id="tg-kore-snippet" class="tg-kore-snippet">' + t.koreIdlePrompt + '</div>' +
                '      <div class="tg-kore-controls">' +
                '        <div class="tg-kore-transport">' +
                '          <button type="button" id="tg-kore-prev" class="tg-kore-ctrl-btn" aria-label="' + t.korePrevLabel + '" disabled>' +
                '            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>' +
                '          </button>' +
                '          <button type="button" id="tg-kore-play-pause" class="tg-kore-ctrl-btn tg-kore-play-primary" aria-label="' + t.korePlayLabel + '">' +
                PLAY_ICON_SVG +
                '          </button>' +
                '          <button type="button" id="tg-kore-next" class="tg-kore-ctrl-btn" aria-label="' + t.koreNextLabel + '" disabled>' +
                '            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>' +
                '          </button>' +
                '          <button type="button" id="tg-kore-stop" class="tg-kore-ctrl-btn" aria-label="' + t.koreStopLabel + '" disabled>' +
                '            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6h12v12H6z"/></svg>' +
                '          </button>' +
                '        </div>' +
                '        <div id="tg-kore-speeds" class="tg-kore-speeds" role="group" aria-label="' + t.koreSpeedGroupLabel + '">' +
                '          <button type="button" class="tg-kore-speed-btn" data-rate="0.85" aria-pressed="false">0.85x</button>' +
                '          <button type="button" class="tg-kore-speed-btn is-active" data-rate="1" aria-pressed="true">1x</button>' +
                '          <button type="button" class="tg-kore-speed-btn" data-rate="1.15" aria-pressed="false">1.15x</button>' +
                '          <button type="button" class="tg-kore-speed-btn" data-rate="1.3" aria-pressed="false">1.3x</button>' +
                '        </div>' +
                '      </div>' +
                '    </div>' +
                '    <div class="tg-grid-2">' +
                '      <button type="button" id="tg-tool-screen-reader" class="tg-tool-btn" aria-pressed="false">' +
                '        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a9 9 0 00-9 9v7c0 1.66 1.34 3 3 3h2v-8H5v-2a7 7 0 0114 0v2h-3v8h2c1.66 0 3-1.34 3-3v-7a9 9 0 00-9-9zm-1 11.5v5a1 1 0 002 0v-5a1 1 0 00-2 0z"/></svg>' +
                '        <span id="tg-txt-screen-reader">' + t.toolScreenReader + '</span>' +
                '      </button>' +
                '      <button type="button" id="tg-tool-page-reader" class="tg-tool-btn" aria-pressed="false">' +
                '        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>' +
                '        <span id="tg-txt-page-reader">' + t.toolPageReader + '</span>' +
                '      </button>' +
                '    </div>' +
                '  </div>' +

                // Section 3: Vision, Contrast & Color
                '  <div class="tg-section-block">' +
                '    <div class="tg-section-label" id="tg-sec-vision">' + t.secVision + '</div>' +
                '    <div class="tg-grid-2">' +
                '      <button type="button" id="tg-tool-contrast" class="tg-tool-btn" aria-pressed="false">' +
                '        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18V4c4.41 0 8 3.59 8 8s-3.59 8-8 8z"/></svg>' +
                '        <span id="tg-txt-contrast">' + t.toolContrast + '</span>' +
                '      </button>' +
                '      <button type="button" id="tg-tool-invert" class="tg-tool-btn" aria-pressed="false">' +
                '        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.34 7.93c-3.12 3.12-3.12 8.19 0 11.31s8.19 3.12 11.31 0L6.34 7.93zm12.73 9.9c1.95-1.95 2.76-4.57 2.43-7.07l-9.5 9.5c2.5.33 5.12-.48 7.07-2.43zM12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/></svg>' +
                '        <span id="tg-txt-invert">' + t.toolInvert + '</span>' +
                '      </button>' +
                '      <button type="button" id="tg-tool-saturation" class="tg-tool-btn" aria-pressed="false">' +
                '        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.69l5.66 5.66a8 8 0 11-11.31 0L12 2.69z"/></svg>' +
                '        <span id="tg-txt-saturation">' + t.toolSaturation + '</span>' +
                '        <span id="tg-sub-saturation" class="tg-tool-sub"></span>' +
                '        <span id="tg-dots-saturation" class="tg-step-dots" aria-hidden="true"><span></span><span></span><span></span></span>' +
                '      </button>' +
                '      <button type="button" id="tg-tool-hide-images" class="tg-tool-btn" aria-pressed="false">' +
                '        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 17.2L6.8 3H19c1.1 0 2 .9 2 2v12.2zM20.49 21.9l-1.49-1.49H5c-1.1 0-2-.9-2-2V5l-1.39-1.39L2.8 2.4 21.6 21.2l-1.11.7zM8.5 13.5l2.5 3.01L12.5 15l3.5 3.5H6l2.5-5z"/></svg>' +
                '        <span id="tg-txt-hide-images">' + t.toolHideImages + '</span>' +
                '      </button>' +
                '    </div>' +
                '  </div>' +

                // Section 4: Reading & Typography
                '  <div class="tg-section-block">' +
                '    <div class="tg-section-label" id="tg-sec-content">' + t.secContent + '</div>' +
                '    <div class="tg-grid-2">' +
                '      <button type="button" id="tg-tool-text-size" class="tg-tool-btn" aria-pressed="false">' +
                '        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4v3h5v12h3V7h5V4H9zm-6 8h3v7h3v-7h3V9H3v3z"/></svg>' +
                '        <span id="tg-txt-text-size">' + t.toolTextSize + '</span>' +
                '        <span id="tg-sub-text-size" class="tg-tool-sub"></span>' +
                '        <span id="tg-dots-text-size" class="tg-step-dots" aria-hidden="true"><span></span><span></span><span></span></span>' +
                '      </button>' +
                '      <button type="button" id="tg-tool-spacing" class="tg-tool-btn" aria-pressed="false">' +
                '        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 4h20v2H2V4zm0 14h20v2H2v-2zm8-6h4v3l4-4-4-4v3h-4V6l-4 4 4 4v-2z"/></svg>' +
                '        <span id="tg-txt-spacing">' + t.toolSpacing + '</span>' +
                '        <span id="tg-sub-spacing" class="tg-tool-sub"></span>' +
                '        <span id="tg-dots-spacing" class="tg-step-dots" aria-hidden="true"><span></span><span></span><span></span></span>' +
                '      </button>' +
                '      <button type="button" id="tg-tool-line-height" class="tg-tool-btn" aria-pressed="false">' +
                '        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 7h2.5L5 3.5 1.5 7H4v10H1.5L5 20.5 8.5 17H6V7zm4-2v2h12V5H10zm0 14h12v-2H10v2zm0-6h12v-2H10v2z"/></svg>' +
                '        <span id="tg-txt-line-height">' + t.toolLineHeight + '</span>' +
                '        <span id="tg-sub-line-height" class="tg-tool-sub"></span>' +
                '        <span id="tg-dots-line-height" class="tg-step-dots" aria-hidden="true"><span></span><span></span><span></span></span>' +
                '      </button>' +
                '      <button type="button" id="tg-tool-text-align" class="tg-tool-btn" aria-pressed="false">' +
                '        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 21h18v-2H3v2zm0-4h12v-2H3v2zm0-4h18v-2H3v2zm0-4h12V7H3v2zm0-6v2h18V3H3z"/></svg>' +
                '        <span id="tg-txt-text-align">' + t.toolTextAlign + '</span>' +
                '        <span id="tg-sub-text-align" class="tg-tool-sub"></span>' +
                '        <span id="tg-dots-text-align" class="tg-step-dots" aria-hidden="true"><span></span><span></span><span></span></span>' +
                '      </button>' +
                '      <button type="button" id="tg-tool-dyslexic" class="tg-tool-btn" aria-pressed="false">' +
                '        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4v3h5.5v12h3V7H19V4H5z"/></svg>' +
                '        <span id="tg-txt-dyslexic">' + t.toolDyslexic + '</span>' +
                '      </button>' +
                '      <button type="button" id="tg-tool-highlight-headings" class="tg-tool-btn" aria-pressed="false">' +
                '        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4v16h3v-6h8v6h3V4h-3v7H8V4H5z"/></svg>' +
                '        <span id="tg-txt-highlight-headings">' + t.toolHighlightHeadings + '</span>' +
                '      </button>' +
                '    </div>' +
                '  </div>' +

                // Section 5: Focus, Navigation & Motion
                '  <div class="tg-section-block">' +
                '    <div class="tg-section-label" id="tg-sec-motion">' + t.secMotion + '</div>' +
                '    <div class="tg-grid-2">' +
                '      <button type="button" id="tg-tool-reading-mask" class="tg-tool-btn" aria-pressed="false">' +
                '        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h18v5H3V4zm0 11h18v5H3v-5zm0-4h18v2H3v-2z"/></svg>' +
                '        <span id="tg-txt-reading-mask">' + t.toolReadingMask + '</span>' +
                '      </button>' +
                '      <button type="button" id="tg-tool-reading-guide" class="tg-tool-btn" aria-pressed="false">' +
                '        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg>' +
                '        <span id="tg-txt-reading-guide">' + t.toolReadingGuide + '</span>' +
                '      </button>' +
                '      <button type="button" id="tg-tool-highlight" class="tg-tool-btn" aria-pressed="false">' +
                '        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/></svg>' +
                '        <span id="tg-txt-highlight">' + t.toolHighlight + '</span>' +
                '      </button>' +
                '      <button type="button" id="tg-tool-focus-ring" class="tg-tool-btn" aria-pressed="false">' +
                '        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h4V3H5c-1.1 0-2 .9-2 2v4h2V5zm14-2h-4v2h4v4h2V5c0-1.1-.9-2-2-2zM5 19v-4H3v4c0 1.1.9 2 2 2h4v-2H5zm14-4v4h-4v2h4c1.1 0 2-.9 2-2v-4h-2zm-7-6a3 3 0 100 6 3 3 0 000-6z"/></svg>' +
                '        <span id="tg-txt-focus-ring">' + t.toolFocusRing + '</span>' +
                '      </button>' +
                '      <button type="button" id="tg-tool-cursor" class="tg-tool-btn" aria-pressed="false">' +
                '        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13.64 21.97c-.18 0-.36-.05-.52-.15l-3.87-2.47-2.31 2.31c-.39.39-1.02.39-1.41 0-.19-.19-.29-.44-.29-.71V3.5c0-.55.45-1 1-1 .27 0 .52.11.71.29l13.5 13.5c.39.39.39 1.02 0 1.41-.19.19-.44.29-.71.29h-3.41l2.42 3.79c.29.47.16 1.09-.31 1.39-.16.1-.33.15-.51.15z"/></svg>' +
                '        <span id="tg-txt-cursor">' + t.toolCursor + '</span>' +
                '      </button>' +
                '      <button type="button" id="tg-tool-stop-anim" class="tg-tool-btn" aria-pressed="false">' +
                '        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>' +
                '        <span id="tg-txt-stop-anim">' + t.toolStopAnim + '</span>' +
                '      </button>' +
                '    </div>' +
                '  </div>' +
                '</div>' +

                // Panel Footer + Position Switcher
                '<div class="tg-panel-footer">' +
                '  <div class="tg-footer-pos-row">' +
                '    <span id="tg-pos-label" class="tg-pos-label">' + t.posLabel + '</span>' +
                '    <div class="tg-pos-switch" role="group" aria-labelledby="tg-pos-label">' +
                '      <button type="button" id="tg-pos-left" class="tg-pos-btn" aria-pressed="false">← <span id="tg-pos-left-txt">' + t.posLeft + '</span></button>' +
                '      <button type="button" id="tg-pos-right" class="tg-pos-btn is-active" aria-pressed="true"><span id="tg-pos-right-txt">' + t.posRight + '</span> →</button>' +
                '    </div>' +
                '  </div>' +
                '  <div class="tg-footer-actions-row">' +
                '    <button type="button" id="tg-a11y-reset" class="tg-reset-btn">' + t.a11yReset + '</button>' +
                '    <button type="button" id="tg-statement-btn" class="tg-statement-link">' + t.a11yStatement + '</button>' +
                '  </div>' +
                '</div>';
            document.body.appendChild(panel);
        }

        // 4. Statement Modal
        if (!document.getElementById('tg-statement-modal')) {
            var stmtModal = document.createElement('div');
            stmtModal.id = 'tg-statement-modal';
            stmtModal.className = 'tg-modal-overlay';
            stmtModal.setAttribute('role', 'dialog');
            stmtModal.setAttribute('aria-modal', 'true');
            stmtModal.setAttribute('aria-labelledby', 'tg-stmt-title');
            stmtModal.style.display = 'none';
            stmtModal.innerHTML =
                '<div class="tg-modal-box">' +
                '  <div class="tg-modal-header">' +
                '    <h3 class="tg-modal-title" id="tg-stmt-title">' + t.statementTitle + '</h3>' +
                '    <button type="button" id="tg-stmt-close" class="tg-close-btn" aria-label="' + t.a11yCloseLabel + '">×</button>' +
                '  </div>' +
                '  <div class="tg-modal-body" style="white-space: pre-line; line-height: 1.6; color: #d1d5db;" id="tg-stmt-body">' +
                t.statementBody +
                '  </div>' +
                '</div>';
            document.body.appendChild(stmtModal);
        }

        // 4b. Floating Mini Kore Player Bar (visible when panel is closed while Kore is reading)
        if (!document.getElementById('tg-speech-bar')) {
            var speechBar = document.createElement('div');
            speechBar.id = 'tg-speech-bar';
            speechBar.className = 'tg-speech-bar';
            speechBar.setAttribute('role', 'region');
            speechBar.setAttribute('aria-label', t.koreBadge);
            speechBar.innerHTML =
                '<span class="tg-kore-badge">' +
                '  <span class="tg-kore-wave" aria-hidden="true"><span></span><span></span><span></span><span></span></span>' +
                '  <span>Kore</span>' +
                '</span>' +
                '<div class="tg-mini-info">' +
                '  <div class="tg-mini-meta"><span id="tg-speech-bar-progress">' + t.koreStatusReady + '</span></div>' +
                '  <span id="tg-speech-bar-text">' + t.koreInteractivePrompt + '</span>' +
                '</div>' +
                '<div class="tg-mini-controls">' +
                '  <button type="button" id="tg-mini-prev" class="tg-mini-btn" aria-label="' + t.korePrevLabel + '" disabled>' +
                '    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>' +
                '  </button>' +
                '  <button type="button" id="tg-mini-play-pause" class="tg-mini-btn tg-mini-primary" aria-label="' + t.korePlayLabel + '">' +
                PLAY_ICON_SVG +
                '  </button>' +
                '  <button type="button" id="tg-mini-next" class="tg-mini-btn" aria-label="' + t.koreNextLabel + '" disabled>' +
                '    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>' +
                '  </button>' +
                '  <button type="button" id="tg-mini-speed" class="tg-mini-btn" aria-label="' + t.koreSpeedGroupLabel + '">1x</button>' +
                '  <button type="button" id="tg-speech-stop-btn" class="tg-mini-btn" aria-label="' + t.speechBarStop + '">' +
                '    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6h12v12H6z"/></svg>' +
                '  </button>' +
                '</div>';
            document.body.appendChild(speechBar);
        }

        // 5. California CCPA Preference Center Modal
        if (!document.getElementById('tg-cookie-modal')) {
            var modal = document.createElement('div');
            modal.id = 'tg-cookie-modal';
            modal.setAttribute('role', 'dialog');
            modal.setAttribute('aria-modal', 'true');
            modal.setAttribute('aria-labelledby', 'tg-cookie-modal-title');
            modal.style.display = 'none';
            modal.innerHTML =
                '<div class="tg-modal-box">' +
                '  <div class="tg-modal-header">' +
                '    <h3 id="tg-cookie-modal-title" class="tg-modal-title">' + t.modalTitle + '</h3>' +
                '    <button type="button" id="tg-cookie-modal-close" class="tg-close-btn" aria-label="' + t.a11yCloseLabel + '">×</button>' +
                '  </div>' +
                '  <div class="tg-modal-body">' +
                '    <div id="tg-modal-gpc-status" role="status" aria-live="polite" style="display:none;align-items:center;gap:6px;background:rgba(34,197,94,0.15);border:1px solid rgba(34,197,94,0.45);color:#4ade80;padding:6px 12px;border-radius:999px;font-size:12px;font-weight:700;margin-bottom:10px;width:fit-content;">✓ Opt-out request honored</div>' +
                '    <p class="tg-modal-lead" id="tg-modal-desc">' + t.modalDesc + ' <a href="/privacy/#notice-at-collection" style="color:#f4c430;text-decoration:underline;">' + t.cookieLearnMore + '</a></p>' +
                '    <div class="tg-cookie-category">' +
                '      <div class="tg-cat-header">' +
                '        <div>' +
                '          <h4 class="tg-cat-title" id="tg-cat-nec-title">' + t.catNecessaryTitle + '</h4>' +
                '          <span class="tg-badge-always" id="tg-cat-nec-badge">' + t.catNecessaryBadge + '</span>' +
                '        </div>' +
                '        <input type="checkbox" id="tg-chk-necessary" checked disabled aria-labelledby="tg-cat-nec-title" />' +
                '      </div>' +
                '      <p class="tg-cat-desc" id="tg-cat-nec-desc">' + t.catNecessaryDesc + '</p>' +
                '    </div>' +
                '    <div class="tg-cookie-category">' +
                '      <div class="tg-cat-header">' +
                '        <h4 class="tg-cat-title" id="tg-cat-ana-title">' + t.catAnalyticsTitle + '</h4>' +
                '        <label class="tg-switch">' +
                '          <input type="checkbox" id="tg-chk-analytics" aria-labelledby="tg-cat-ana-title" ' + (cookieConsent.analytics ? 'checked' : '') + ' />' +
                '          <span class="tg-slider"></span>' +
                '        </label>' +
                '      </div>' +
                '      <p class="tg-cat-desc" id="tg-cat-ana-desc">' + t.catAnalyticsDesc + '</p>' +
                '    </div>' +
                '    <div class="tg-cookie-category">' +
                '      <div class="tg-cat-header">' +
                '        <h4 class="tg-cat-title" id="tg-cat-mkt-title">' + t.catMarketingTitle + '</h4>' +
                '        <label class="tg-switch">' +
                '          <input type="checkbox" id="tg-chk-marketing" aria-labelledby="tg-cat-mkt-title" ' + (cookieConsent.marketing ? 'checked' : '') + ' />' +
                '          <span class="tg-slider"></span>' +
                '        </label>' +
                '      </div>' +
                '      <p class="tg-cat-desc" id="tg-cat-mkt-desc">' + t.catMarketingDesc + '</p>' +
                '    </div>' +
                '    <div class="tg-cookie-category tg-dns-block">' +
                '      <div class="tg-cat-header">' +
                '        <h4 class="tg-cat-title tg-dns-title" id="tg-cat-dns-title">' + t.dnsSectionTitle + '</h4>' +
                '        <label class="tg-switch">' +
                '          <input type="checkbox" id="tg-chk-dns" aria-labelledby="tg-cat-dns-title" aria-label="' + t.dnsToggleLabel + '" ' + (cookieConsent.doNotSell ? 'checked' : '') + ' />' +
                '          <span class="tg-slider"></span>' +
                '        </label>' +
                '      </div>' +
                '      <p class="tg-cat-desc" id="tg-cat-dns-desc">' + t.dnsSectionDesc + '</p>' +
                '    </div>' +
                '  </div>' +
                '  <div class="tg-modal-footer">' +
                '    <button type="button" id="tg-save-prefs-btn" class="tg-btn-primary">' + t.btnSavePrefs + '</button>' +
                '  </div>' +
                '</div>';
            document.body.appendChild(modal);
        }

        // 6. If #cookie-banner exists in HTML, upgrade it; otherwise create #tg-cookie-banner
        var existingBanner = document.getElementById('cookie-banner');
        if (existingBanner) {
            var contentDiv = existingBanner.querySelector('.cookie-content');
            if (contentDiv && !existingBanner.querySelector('#tg-banner-gpc-status')) {
                var gpcBadge = document.createElement('span');
                gpcBadge.id = 'tg-banner-gpc-status';
                gpcBadge.setAttribute('role', 'status');
                gpcBadge.setAttribute('aria-live', 'polite');
                gpcBadge.style.cssText = 'display:none;align-items:center;gap:6px;background:rgba(34,197,94,0.16);border:1px solid rgba(34,197,94,0.45);color:#4ade80;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700;margin-bottom:6px;width:fit-content;';
                gpcBadge.textContent = '✓ Opt-out request honored';
                contentDiv.insertBefore(gpcBadge, contentDiv.firstChild);
            }
            var actions = existingBanner.querySelector('.cookie-actions');
            if (actions && !existingBanner.querySelector('#cookie-dns-btn')) {
                var dnsBtn = document.createElement('button');
                dnsBtn.type = 'button';
                dnsBtn.className = 'btn btn-outline btn-sm';
                dnsBtn.id = 'cookie-dns-btn';
                dnsBtn.style.color = '#f4c430';
                dnsBtn.style.borderColor = '#f4c430';
                dnsBtn.textContent = t.btnDns;
                actions.insertBefore(dnsBtn, actions.firstChild);

                var prefsBtn = document.createElement('button');
                prefsBtn.type = 'button';
                prefsBtn.className = 'btn btn-outline btn-sm';
                prefsBtn.id = 'cookie-prefs-btn';
                prefsBtn.textContent = t.btnPrefs;
                actions.insertBefore(prefsBtn, actions.children[2] || actions.firstChild);
            }
        } else if (!document.getElementById('tg-cookie-banner')) {
            var banner = document.createElement('aside');
            banner.id = 'tg-cookie-banner';
            banner.setAttribute('role', 'region');
            banner.setAttribute('aria-label', t.cookieBadge);
            banner.innerHTML =
                '<div class="tg-banner-container">' +
                '  <div class="tg-banner-content">' +
                '    <span class="tg-banner-badge" id="tg-banner-badge">' + t.cookieBadge + '</span>' +
                '    <span id="tg-banner-gpc-status" role="status" aria-live="polite" style="display:none;align-items:center;gap:6px;background:rgba(34,197,94,0.16);border:1px solid rgba(34,197,94,0.45);color:#4ade80;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700;margin-left:8px;width:fit-content;">✓ Opt-out request honored</span>' +
                '    <p class="tg-banner-text" id="tg-banner-text">' + t.cookieText + ' <a href="/privacy/#notice-at-collection" style="color:#f4c430;text-decoration:underline;font-weight:600;">' + t.cookieLearnMore + '</a></p>' +
                '  </div>' +
                '  <div class="tg-banner-actions">' +
                '    <button type="button" id="tg-btn-dns" class="tg-btn-dns">' +
                '      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z"/></svg>' +
                '      <span id="tg-txt-dns">' + t.btnDns + '</span>' +
                '    </button>' +
                '    <button type="button" id="tg-btn-reject-all" class="tg-btn-secondary">' + t.btnRejectAll + '</button>' +
                '    <button type="button" id="tg-btn-prefs" class="tg-btn-secondary">' + t.btnPrefs + '</button>' +
                '    <button type="button" id="tg-btn-accept-all" class="tg-btn-primary">' + t.btnAcceptAll + '</button>' +
                '  </div>' +
                '</div>';
            document.body.appendChild(banner);
        }

        // 7. Inject persistent footer links
        injectFooterLinks();
    }

    function injectFooterLinks() {
        var existingDnsBtn = document.getElementById('footer-dns-btn');
        if (existingDnsBtn) {
            existingDnsBtn.addEventListener('click', function (e) {
                e.preventDefault();
                openCookieModal();
            });
        }

        if (document.querySelector('.footer-legal-links') || existingDnsBtn) {
            return;
        }

        var t = I18N[currentLang];
        var footer = document.querySelector('.footer-bottom, .footer-legal, footer .container, footer');
        if (!footer || document.getElementById('tg-footer-compliance-links')) return;

        var wrap = document.createElement('div');
        wrap.id = 'tg-footer-compliance-links';
        wrap.className = 'tg-footer-compliance-links';
        wrap.style.marginTop = '12px';
        wrap.style.fontSize = '12px';
        wrap.style.display = 'flex';
        wrap.style.flexWrap = 'wrap';
        wrap.style.gap = '14px';
        wrap.style.justifyContent = 'center';
        wrap.style.alignItems = 'center';
        wrap.style.opacity = '0.9';

        wrap.innerHTML =
            '<button type="button" id="tg-footer-dns-link" style="background:none;border:none;color:#f4c430;text-decoration:underline;cursor:pointer;font-size:inherit;font-family:inherit;padding:0;">' +
            t.footerDnsLink +
            '</button>' +
            '<span style="opacity:0.5;">•</span>' +
            '<button type="button" id="tg-footer-a11y-link" style="background:none;border:none;color:#f4c430;text-decoration:underline;cursor:pointer;font-size:inherit;font-family:inherit;padding:0;">' +
            t.footerA11yLink +
            '</button>';

        footer.appendChild(wrap);

        var dnsLink = document.getElementById('tg-footer-dns-link');
        if (dnsLink) {
            dnsLink.addEventListener('click', function (e) {
                e.preventDefault();
                openCookieModal();
            });
        }

        var a11yLink = document.getElementById('tg-footer-a11y-link');
        if (a11yLink) {
            a11yLink.addEventListener('click', function (e) {
                e.preventDefault();
                openA11yPanel();
            });
        }
    }

    /* ==========================================================================
       9. LANGUAGE SWITCHING ENGINE (100% BILINGUAL ES / EN)
       ========================================================================== */
    function switchLanguage(lang) {
        if (lang !== 'es' && lang !== 'en') return;
        var langChanged = (currentLang !== lang);
        currentLang = lang;
        safeStorage.setItem('tacosgavilan_lang', lang);
        safeStorage.setItem('tg_site_lang', lang);
        document.documentElement.lang = currentLang;

        if (langChanged) {
            if (koreStatus !== 'idle' || koreQueue.length > 0) {
                stopSpeaking();
            } else {
                koreLastSnippet = '';
            }
        }

        var t = I18N[currentLang];

        // Trigger & Header
        var trigger = document.getElementById('tg-a11y-trigger');
        if (trigger) {
            trigger.setAttribute('aria-label', t.a11yTriggerLabel);
            trigger.setAttribute('title', t.a11yTriggerLabel);
        }
        var kbd = document.getElementById('tg-kbd-hint');
        if (kbd) kbd.setAttribute('title', t.a11yShortcutHint);

        var langBtn = document.getElementById('tg-lang-toggle');
        if (langBtn) {
            langBtn.textContent = t.langToggle;
            langBtn.setAttribute('aria-label', t.a11yLangAria);
        }
        var closeBtn = document.getElementById('tg-a11y-close');
        if (closeBtn) closeBtn.setAttribute('aria-label', t.a11yCloseLabel);

        setText('tg-a11y-title-text', t.a11yTitle);
        setText('tg-a11y-reset', t.a11yReset);
        setText('tg-statement-btn', t.a11yStatement);

        // Sections
        setText('tg-sec-profiles', t.secProfiles);
        setText('tg-sec-blindness', t.secBlindness);
        setText('tg-sec-vision', t.secVision);
        setText('tg-sec-content', t.secContent);
        setText('tg-sec-motion', t.secMotion);

        // Smart Profiles
        setText('tg-prof-blind-name', t.profBlindName);
        setText('tg-prof-blind-sub', t.profBlindSub);
        setText('tg-prof-low-name', t.profLowVisionName);
        setText('tg-prof-low-sub', t.profLowVisionSub);
        setText('tg-prof-dys-name', t.profDyslexiaName);
        setText('tg-prof-dys-sub', t.profDyslexiaSub);
        setText('tg-prof-adhd-name', t.profAdhdName);
        setText('tg-prof-adhd-sub', t.profAdhdSub);
        setText('tg-prof-motor-name', t.profMotorName);
        setText('tg-prof-motor-sub', t.profMotorSub);
        setText('tg-prof-seiz-name', t.profSeizureName);
        setText('tg-prof-seiz-sub', t.profSeizureSub);

        // Kore Player
        setText('tg-kore-badge-text', t.koreBadge);
        setAttr('tg-kore-prev', 'aria-label', t.korePrevLabel);
        setAttr('tg-kore-next', 'aria-label', t.koreNextLabel);
        setAttr('tg-kore-stop', 'aria-label', t.koreStopLabel);
        setAttr('tg-kore-speeds', 'aria-label', t.koreSpeedGroupLabel);
        setAttr('tg-speech-bar', 'aria-label', t.koreBadge);
        setAttr('tg-mini-prev', 'aria-label', t.korePrevLabel);
        setAttr('tg-mini-next', 'aria-label', t.koreNextLabel);
        setAttr('tg-mini-speed', 'aria-label', t.koreSpeedGroupLabel);
        setAttr('tg-speech-stop-btn', 'aria-label', t.speechBarStop);

        // Tools
        setText('tg-txt-screen-reader', t.toolScreenReader);
        setText('tg-txt-page-reader', t.toolPageReader);
        setText('tg-txt-contrast', t.toolContrast);
        setText('tg-txt-invert', t.toolInvert);
        setText('tg-txt-saturation', t.toolSaturation);
        setText('tg-txt-hide-images', t.toolHideImages);
        setText('tg-txt-text-size', t.toolTextSize);
        setText('tg-txt-spacing', t.toolSpacing);
        setText('tg-txt-line-height', t.toolLineHeight);
        setText('tg-txt-text-align', t.toolTextAlign);
        setText('tg-txt-dyslexic', t.toolDyslexic);
        setText('tg-txt-highlight-headings', t.toolHighlightHeadings);
        setText('tg-txt-reading-mask', t.toolReadingMask);
        setText('tg-txt-reading-guide', t.toolReadingGuide);
        setText('tg-txt-highlight', t.toolHighlight);
        setText('tg-txt-focus-ring', t.toolFocusRing);
        setText('tg-txt-cursor', t.toolCursor);
        setText('tg-txt-stop-anim', t.toolStopAnim);

        // Position Switcher
        setText('tg-pos-label', t.posLabel);
        setText('tg-pos-left-txt', t.posLeft);
        setText('tg-pos-right-txt', t.posRight);

        // Statement Modal
        setText('tg-stmt-title', t.statementTitle);
        setText('tg-stmt-body', t.statementBody);
        setAttr('tg-stmt-close', 'aria-label', t.a11yCloseLabel);

        // Cookie Modal
        setText('tg-cookie-modal-title', t.modalTitle);
        var modalDesc = document.getElementById('tg-modal-desc');
        if (modalDesc) {
            modalDesc.innerHTML = t.modalDesc + ' <a href="/privacy/#notice-at-collection" style="color:#f4c430;text-decoration:underline;">' + t.cookieLearnMore + '</a>';
        }
        setText('tg-cat-nec-title', t.catNecessaryTitle);
        setText('tg-cat-nec-badge', t.catNecessaryBadge);
        setText('tg-cat-nec-desc', t.catNecessaryDesc);
        setText('tg-cat-ana-title', t.catAnalyticsTitle);
        setText('tg-cat-ana-desc', t.catAnalyticsDesc);
        setText('tg-cat-mkt-title', t.catMarketingTitle);
        setText('tg-cat-mkt-desc', t.catMarketingDesc);
        setText('tg-cat-dns-title', t.dnsSectionTitle);
        setText('tg-cat-dns-desc', t.dnsSectionDesc);
        setText('tg-save-prefs-btn', t.btnSavePrefs);
        setAttr('tg-cookie-modal-close', 'aria-label', t.a11yCloseLabel);
        setAttr('tg-chk-dns', 'aria-label', t.dnsToggleLabel);

        // Cookie Banner
        setAttr('tg-cookie-banner', 'aria-label', t.cookieBadge);
        setText('tg-banner-badge', t.cookieBadge);
        var bannerText = document.getElementById('tg-banner-text');
        if (bannerText) {
            bannerText.innerHTML = t.cookieText + ' <a href="/privacy/#notice-at-collection" style="color:#f4c430;text-decoration:underline;font-weight:600;">' + t.cookieLearnMore + '</a>';
        }
        setText('tg-txt-dns', t.btnDns);
        setText('tg-btn-reject-all', t.btnRejectAll);
        setText('tg-btn-prefs', t.btnPrefs);
        setText('tg-btn-accept-all', t.btnAcceptAll);
        setText('cookie-dns-btn', t.btnDns);
        setText('cookie-prefs-btn', t.btnPrefs);

        // Footer
        setText('tg-footer-dns-link', t.footerDnsLink);
        setText('tg-footer-a11y-link', t.footerA11yLink);

        updateA11yUI();
        updateKorePlayerUI();
    }

    function setText(id, text) {
        var el = document.getElementById(id);
        if (el && text !== undefined && text !== null) el.textContent = text;
    }

    function setAttr(id, attr, val) {
        var el = document.getElementById(id);
        if (el && val !== undefined && val !== null) el.setAttribute(attr, val);
    }

    /* ==========================================================================
       10. MODAL INTERACTION & WCAG 2.2 AA FOCUS TRAP
       ========================================================================== */
    var lastFocusedElement = null;

    function getFocusableElements(container) {
        if (!container) return [];
        var raw = container.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
        var list = [];
        for (var i = 0; i < raw.length; i++) {
            var el = raw[i];
            if (el.offsetWidth > 0 || el.offsetHeight > 0 || el === document.activeElement) {
                list.push(el);
            }
        }
        return list;
    }

    function handleDialogFocusTrap(e) {
        if (e.key !== 'Tab' && e.keyCode !== 9) return;

        var stmtModal = document.getElementById('tg-statement-modal');
        var cookieModal = document.getElementById('tg-cookie-modal');
        var panel = document.getElementById('tg-a11y-panel');

        var activeContainer = null;
        if (stmtModal && stmtModal.style.display === 'flex') {
            activeContainer = stmtModal;
        } else if (cookieModal && cookieModal.classList.contains('is-open')) {
            activeContainer = cookieModal;
        } else if (panel && panel.classList.contains('is-open')) {
            activeContainer = panel;
        }

        if (!activeContainer) return;

        var focusables = getFocusableElements(activeContainer);
        if (!focusables.length) return;

        var first = focusables[0];
        var last = focusables[focusables.length - 1];

        if (e.shiftKey) {
            if (document.activeElement === first || !activeContainer.contains(document.activeElement)) {
                e.preventDefault();
                last.focus();
            }
        } else {
            if (document.activeElement === last || !activeContainer.contains(document.activeElement)) {
                e.preventDefault();
                first.focus();
            }
        }
    }

    function openA11yPanel() {
        var panel = document.getElementById('tg-a11y-panel');
        var trigger = document.getElementById('tg-a11y-trigger');
        if (!panel || !trigger) return;

        lastFocusedElement = document.activeElement;
        panel.classList.add('is-open');
        trigger.setAttribute('aria-expanded', 'true');
        updateKorePlayerUI();
        announcePolite(I18N[currentLang].announcePanelOpen);

        var closeBtn = document.getElementById('tg-a11y-close');
        if (closeBtn) closeBtn.focus();
    }

    function closeA11yPanel() {
        var panel = document.getElementById('tg-a11y-panel');
        var trigger = document.getElementById('tg-a11y-trigger');
        if (!panel || !panel.classList.contains('is-open')) return;

        panel.classList.remove('is-open');
        if (trigger) {
            trigger.setAttribute('aria-expanded', 'false');
        }
        updateKorePlayerUI();
        announcePolite(I18N[currentLang].announcePanelClosed);

        if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
            try { lastFocusedElement.focus(); } catch (e) {}
        } else if (trigger) {
            try { trigger.focus(); } catch (e) {}
        }
    }

    function toggleA11yPanel() {
        var panel = document.getElementById('tg-a11y-panel');
        if (panel && panel.classList.contains('is-open')) {
            closeA11yPanel();
        } else {
            openA11yPanel();
        }
    }

    function openCookieModal() {
        var modal = document.getElementById('tg-cookie-modal');
        if (!modal) return;
        lastFocusedElement = document.activeElement;
        modal.style.display = 'flex';
        modal.classList.add('is-open');
        var closeBtn = document.getElementById('tg-cookie-modal-close');
        if (closeBtn) closeBtn.focus();
    }

    function closeCookieModal() {
        var modal = document.getElementById('tg-cookie-modal');
        if (modal) {
            var wasOpen = modal.classList.contains('is-open') || modal.style.display === 'flex';
            modal.style.display = 'none';
            modal.classList.remove('is-open');
            if (wasOpen && lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
                try { lastFocusedElement.focus(); } catch (e) {}
            }
        }
    }

    function hideCookieBanner() {
        var banner = document.getElementById('tg-cookie-banner') || document.getElementById('cookie-banner');
        if (banner) {
            banner.classList.remove('is-visible', 'cookie-banner-visible');
            banner.style.display = 'none';
        }
        document.body.classList.remove('has-cookie-banner');
        var mobileStickyBar = document.getElementById('mobile-sticky-bar');
        if (mobileStickyBar && window.scrollY > 300) {
            mobileStickyBar.classList.add('is-visible');
        }
    }

    function showCookieBannerIfNeeded() {
        var consent = safeStorage.getItem('tg_cookie_consent') || safeStorage.getItem('tacosgavilan_cookie_consent');
        if (!consent) {
            var banner = document.getElementById('tg-cookie-banner') || document.getElementById('cookie-banner');
            if (banner) {
                banner.style.display = 'block';
                banner.classList.add('is-visible', 'cookie-banner-visible');
                document.body.classList.add('has-cookie-banner');
            }
        }
    }

    /* ==========================================================================
       11. EVENT BINDINGS
       ========================================================================== */
    var lastInputWasKeyboard = false;
    var keyboardFocusSpeakTimer = null;

    function bindEvents() {
        // Track keyboard vs pointer modality for Tab-to-speak
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Tab' || e.keyCode === 9 || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                lastInputWasKeyboard = true;
            }
        }, true);
        document.addEventListener('pointerdown', function () {
            lastInputWasKeyboard = false;
        }, true);

        // Floating trigger
        var trigger = document.getElementById('tg-a11y-trigger');
        if (trigger) {
            trigger.addEventListener('click', function (e) {
                e.stopPropagation();
                toggleA11yPanel();
            });
        }

        // Close panel
        var closeBtn = document.getElementById('tg-a11y-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', closeA11yPanel);
        }

        // Language toggle inside accessibility widget
        var langToggle = document.getElementById('tg-lang-toggle');
        if (langToggle) {
            langToggle.addEventListener('click', function () {
                var mainLangBtn = document.getElementById('lang-toggle');
                if (mainLangBtn) {
                    mainLangBtn.click();
                    setTimeout(function () {
                        var targetLang = document.documentElement.lang === 'es' ? 'es' : 'en';
                        if (targetLang !== currentLang) {
                            switchLanguage(targetLang);
                            applyTrackingConsent();
                        }
                    }, 20);
                } else {
                    switchLanguage(currentLang === 'es' ? 'en' : 'es');
                    applyTrackingConsent();
                }
            });
        }

        // Sync when main site language toggle (#lang-toggle) or <html lang> mutates
        var mainLangBtn = document.getElementById('lang-toggle');
        if (mainLangBtn) {
            mainLangBtn.addEventListener('click', function () {
                setTimeout(function () {
                    var docLang = document.documentElement.lang === 'es' ? 'es' : 'en';
                    if (docLang !== currentLang) {
                        switchLanguage(docLang);
                        applyTrackingConsent();
                    }
                }, 0);
            });
        }

        if (typeof MutationObserver !== 'undefined' && document.documentElement) {
            try {
                var langObs = new MutationObserver(function () {
                    var htmlLang = (document.documentElement.lang || '').toLowerCase();
                    var mapped = htmlLang.indexOf('es') === 0 ? 'es' : (htmlLang.indexOf('en') === 0 ? 'en' : null);
                    if (mapped && mapped !== currentLang) {
                        switchLanguage(mapped);
                        applyTrackingConsent();
                    }
                });
                langObs.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
            } catch (e) {}
        }

        // 1-Click Smart Profiles
        var profileBtns = document.querySelectorAll('.tg-profile-btn[data-profile]');
        for (var p = 0; p < profileBtns.length; p++) {
            (function (btn) {
                btn.addEventListener('click', function () {
                    var pKey = btn.getAttribute('data-profile');
                    if (!pKey || !Object.prototype.hasOwnProperty.call(SMART_PROFILES, pKey)) return;
                    var prof = SMART_PROFILES[pKey];
                    var turningOn = !prof.isMatch();
                    prof.apply(turningOn);
                    saveA11yState();
                    applyA11yToDOM();
                    var nameEl = btn.querySelector('.tg-profile-name');
                    var label = nameEl ? nameEl.textContent : pKey;
                    announcePolite((turningOn ? I18N[currentLang].announceProfileOn : I18N[currentLang].announceProfileOff) + label);
                });
            })(profileBtns[p]);
        }

        // Kore Player Controls (Embedded & Mini Bar)
        var onPlayPause = function (e) { e.stopPropagation(); togglePlayPauseKore(); };
        var onPrev = function (e) { e.stopPropagation(); stepKoreQueue(-1); };
        var onNext = function (e) { e.stopPropagation(); stepKoreQueue(1); };
        var onStop = function (e) { e.stopPropagation(); stopSpeaking(); };

        var korePlayBtn = document.getElementById('tg-kore-play-pause');
        if (korePlayBtn) korePlayBtn.addEventListener('click', onPlayPause);
        var korePrevBtn = document.getElementById('tg-kore-prev');
        if (korePrevBtn) korePrevBtn.addEventListener('click', onPrev);
        var koreNextBtn = document.getElementById('tg-kore-next');
        if (koreNextBtn) koreNextBtn.addEventListener('click', onNext);
        var koreStopBtn = document.getElementById('tg-kore-stop');
        if (koreStopBtn) koreStopBtn.addEventListener('click', onStop);

        var miniPlayBtn = document.getElementById('tg-mini-play-pause');
        if (miniPlayBtn) miniPlayBtn.addEventListener('click', onPlayPause);
        var miniPrevBtn = document.getElementById('tg-mini-prev');
        if (miniPrevBtn) miniPrevBtn.addEventListener('click', onPrev);
        var miniNextBtn = document.getElementById('tg-mini-next');
        if (miniNextBtn) miniNextBtn.addEventListener('click', onNext);
        var miniSpeedBtn = document.getElementById('tg-mini-speed');
        if (miniSpeedBtn) miniSpeedBtn.addEventListener('click', function (e) { e.stopPropagation(); cycleKoreSpeechRate(); });
        var stopSpeechBtn = document.getElementById('tg-speech-stop-btn');
        if (stopSpeechBtn) stopSpeechBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            a11yState.screenReader = false;
            saveA11yState();
            stopSpeaking();
            applyA11yToDOM();
        });

        var speedBtns = document.querySelectorAll('.tg-kore-speed-btn');
        for (var s = 0; s < speedBtns.length; s++) {
            (function (sBtn) {
                sBtn.addEventListener('click', function () {
                    setKoreSpeechRate(sBtn.getAttribute('data-rate'));
                });
            })(speedBtns[s]);
        }

        // Granular Accessibility Tools
        bindTool('tg-tool-contrast', function () {
            a11yState.contrast = !a11yState.contrast;
            if (a11yState.contrast) a11yState.invert = false;
        });

        bindTool('tg-tool-invert', function () {
            a11yState.invert = !a11yState.invert;
            if (a11yState.invert) a11yState.contrast = false;
        });

        bindTool('tg-tool-saturation', function () {
            a11yState.saturation = (a11yState.saturation + 1) % 4;
        });

        bindTool('tg-tool-hide-images', function () {
            a11yState.hideImages = !a11yState.hideImages;
        });

        bindTool('tg-tool-text-size', function () {
            a11yState.fontSize = (a11yState.fontSize + 1) % 4;
        });

        bindTool('tg-tool-spacing', function () {
            a11yState.spacing = (a11yState.spacing + 1) % 4;
        });

        bindTool('tg-tool-line-height', function () {
            a11yState.lineHeight = (a11yState.lineHeight + 1) % 4;
        });

        bindTool('tg-tool-text-align', function () {
            a11yState.textAlign = (a11yState.textAlign + 1) % 4;
        });

        bindTool('tg-tool-dyslexic', function () {
            a11yState.dyslexic = !a11yState.dyslexic;
        });

        bindTool('tg-tool-highlight-headings', function () {
            a11yState.highlightHeadings = !a11yState.highlightHeadings;
        });

        bindTool('tg-tool-reading-mask', function () {
            a11yState.readingMask = !a11yState.readingMask;
            if (a11yState.readingMask) a11yState.readingGuide = false;
        });

        bindTool('tg-tool-reading-guide', function () {
            a11yState.readingGuide = !a11yState.readingGuide;
            if (a11yState.readingGuide) a11yState.readingMask = false;
        });

        bindTool('tg-tool-highlight', function () {
            a11yState.highlightLinks = !a11yState.highlightLinks;
        });

        bindTool('tg-tool-focus-ring', function () {
            a11yState.focusEnhanced = !a11yState.focusEnhanced;
        });

        bindTool('tg-tool-cursor', function () {
            a11yState.bigCursor = !a11yState.bigCursor;
        });

        bindTool('tg-tool-stop-anim', function () {
            a11yState.stopAnim = !a11yState.stopAnim;
        });

        bindTool('tg-tool-screen-reader', function () {
            a11yState.screenReader = !a11yState.screenReader;
            if (a11yState.screenReader) {
                speakText(I18N[currentLang].koreWelcomeInteractive, null);
            } else {
                stopSpeaking();
            }
        });

        var pageReaderBtn = document.getElementById('tg-tool-page-reader');
        if (pageReaderBtn) {
            pageReaderBtn.addEventListener('click', function () {
                if (koreMode === 'page' && koreStatus !== 'idle') {
                    stopSpeaking();
                } else {
                    readFullPage();
                }
            });
        }

        // Dock Position Left / Right Switcher
        var posLeftBtn = document.getElementById('tg-pos-left');
        var posRightBtn = document.getElementById('tg-pos-right');
        if (posLeftBtn) {
            posLeftBtn.addEventListener('click', function () {
                a11yState.widgetPosition = 'left';
                saveA11yState();
                applyA11yToDOM();
            });
        }
        if (posRightBtn) {
            posRightBtn.addEventListener('click', function () {
                a11yState.widgetPosition = 'right';
                saveA11yState();
                applyA11yToDOM();
            });
        }

        // Global Click-to-Speak handler for Kore Screen Reader mode
        document.addEventListener('click', function (e) {
            if (e.isTrusted === false) return;
            if (!a11yState.screenReader || !e.target || !e.target.closest) return;

            if (e.target.closest('#tg-a11y-panel, #tg-a11y-trigger, #tg-speech-bar, #tg-cookie-banner, #tg-cookie-modal, #tg-statement-modal, #cookie-banner, #lang-toggle')) {
                return;
            }

            var readable = e.target.closest('button, a, .menu-item, .location-card, .store-card, .package-card, .step-item, h1, h2, h3, h4, h5, h6, p, li, [role="button"], [role="tab"], img');
            if (!readable) readable = e.target;

            var textToRead = extractReadableTextFromElement(readable);
            if (textToRead && textToRead.length > 0) {
                speakText(textToRead, readable);
            }
        }, true);

        // Global Keyboard Tab Focus-to-Speak handler for Kore Screen Reader mode
        document.addEventListener('focusin', function (e) {
            if (!a11yState.screenReader || !lastInputWasKeyboard || !e.target || !e.target.closest) return;

            if (e.target.closest('#tg-a11y-panel, #tg-a11y-trigger, #tg-speech-bar, #tg-cookie-banner, #tg-cookie-modal, #tg-statement-modal, #cookie-banner')) {
                return;
            }

            var target = e.target;
            if (keyboardFocusSpeakTimer) clearTimeout(keyboardFocusSpeakTimer);
            keyboardFocusSpeakTimer = setTimeout(function () {
                var textToRead = extractReadableTextFromElement(target);
                if (textToRead && textToRead.length > 0) {
                    speakText(textToRead, target);
                }
            }, 110);
        });

        // Reset All Accessibility Adjustments
        var resetBtn = document.getElementById('tg-a11y-reset');
        if (resetBtn) {
            resetBtn.addEventListener('click', function () {
                var keepPos = a11yState.widgetPosition;
                a11yState = getDefaultA11yState();
                a11yState.widgetPosition = keepPos;
                stopSpeaking();
                saveA11yState();
                applyA11yToDOM();
                announcePolite(I18N[currentLang].announceReset);
            });
        }

        // Statement modal open/close
        var stmtBtn = document.getElementById('tg-statement-btn');
        var stmtModal = document.getElementById('tg-statement-modal');
        var stmtClose = document.getElementById('tg-stmt-close');

        if (stmtBtn && stmtModal) {
            stmtBtn.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                stmtModal.style.display = 'flex';
                if (stmtClose) stmtClose.focus();
            });
        }
        if (stmtClose && stmtModal) {
            stmtClose.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                stmtModal.style.display = 'none';
                if (stmtBtn) stmtBtn.focus();
            });
        }

        // Global Keyboard Shortcuts: Alt + A (toggle panel), Escape (close), Tab (focus trap)
        document.addEventListener('keydown', function (e) {
            if (e.altKey && !e.ctrlKey && !e.metaKey && (e.code === 'KeyA' || e.key === 'a' || e.key === 'A')) {
                e.preventDefault();
                toggleA11yPanel();
                return;
            }

            if (e.key === 'Escape' || e.keyCode === 27) {
                if (stmtModal && stmtModal.style.display === 'flex') {
                    stmtModal.style.display = 'none';
                    if (stmtBtn) stmtBtn.focus();
                    return;
                }
                var cModal = document.getElementById('tg-cookie-modal');
                if (cModal && cModal.classList.contains('is-open')) {
                    closeCookieModal();
                    return;
                }
                closeA11yPanel();
                return;
            }

            handleDialogFocusTrap(e);
        });

        // Close on click outside panel (ignore programmatic clicks such as #lang-toggle sync)
        document.addEventListener('click', function (e) {
            if (e.isTrusted === false) return;
            if (e.target && e.target.closest && e.target.closest('#lang-toggle')) return;
            var panel = document.getElementById('tg-a11y-panel');
            var triggerEl = document.getElementById('tg-a11y-trigger');
            var stmtModalEl = document.getElementById('tg-statement-modal');
            var speechBarEl = document.getElementById('tg-speech-bar');
            if (stmtModalEl && (stmtModalEl === e.target || stmtModalEl.contains(e.target))) return;
            if (speechBarEl && (speechBarEl === e.target || speechBarEl.contains(e.target))) return;
            if (panel && panel.classList.contains('is-open')) {
                if (!panel.contains(e.target) && (!triggerEl || !triggerEl.contains(e.target))) {
                    closeA11yPanel();
                }
            }
        });

        // Cookie Banner & Privacy Choices buttons (both new and legacy IDs)
        var acceptBtns = [
            document.getElementById('tg-btn-accept-all'),
            document.getElementById('cookie-accept-btn'),
            document.getElementById('page-accept-all-btn')
        ];
        acceptBtns.forEach(function (btn) {
            if (btn) {
                btn.addEventListener('click', function (e) {
                    if (e) e.preventDefault();
                    cookieConsent.analytics = true;
                    cookieConsent.marketing = true;
                    cookieConsent.doNotSell = false;
                    saveCookieConsent('accepted');
                    applyTrackingConsent();
                    hideCookieBanner();
                });
            }
        });

        var rejectBtns = [document.getElementById('tg-btn-reject-all'), document.getElementById('cookie-decline-btn')];
        rejectBtns.forEach(function (btn) {
            if (btn) {
                btn.addEventListener('click', function (e) {
                    if (e) e.preventDefault();
                    cookieConsent.analytics = false;
                    cookieConsent.marketing = false;
                    cookieConsent.doNotSell = true;
                    saveCookieConsent('declined');
                    applyTrackingConsent();
                    hideCookieBanner();
                });
            }
        });

        var dnsBtns = [
            document.getElementById('tg-btn-dns'),
            document.getElementById('cookie-dns-btn'),
            document.getElementById('page-opt-out-dns-btn'),
            document.getElementById('page-optout-now-btn')
        ];
        dnsBtns.forEach(function (btn) {
            if (btn) {
                btn.addEventListener('click', function (e) {
                    if (e) e.preventDefault();
                    cookieConsent.doNotSell = true;
                    cookieConsent.marketing = false;
                    cookieConsent.analytics = false;
                    saveCookieConsent('declined');
                    applyTrackingConsent();
                    hideCookieBanner();
                });
            }
        });

        var prefsBtns = [
            document.getElementById('tg-btn-prefs'),
            document.getElementById('cookie-prefs-btn'),
            document.getElementById('open-cookie-settings-btn'),
            document.getElementById('page-open-cookie-prefs-btn')
        ];
        prefsBtns.forEach(function (btn) {
            if (btn) {
                btn.addEventListener('click', function (e) {
                    if (e) e.preventDefault();
                    openCookieModal();
                });
            }
        });

        var cookieModalClose = document.getElementById('tg-cookie-modal-close');
        if (cookieModalClose) {
            cookieModalClose.addEventListener('click', closeCookieModal);
        }

        // Checkbox mutual exclusivity for modal and /privacy-choices/ inline controls
        function bindCheckboxGroup(anaId, mktId, dnsId) {
            var chkAna = document.getElementById(anaId);
            var chkMkt = document.getElementById(mktId);
            var chkDns = document.getElementById(dnsId);
            if (chkAna) {
                chkAna.addEventListener('change', function () {
                    var gpc = (typeof navigator !== 'undefined' && navigator.globalPrivacyControl === true);
                    if (chkAna.checked && !gpc && chkDns) {
                        chkDns.checked = false;
                    }
                });
            }
            if (chkMkt) {
                chkMkt.addEventListener('change', function () {
                    var gpc = (typeof navigator !== 'undefined' && navigator.globalPrivacyControl === true);
                    if (chkMkt.checked && !gpc && chkDns) {
                        chkDns.checked = false;
                    }
                });
            }
            if (chkDns) {
                chkDns.addEventListener('change', function () {
                    if (chkDns.checked) {
                        if (chkMkt) chkMkt.checked = false;
                        if (chkAna) chkAna.checked = false;
                    }
                });
            }
        }
        bindCheckboxGroup('tg-chk-analytics', 'tg-chk-marketing', 'tg-chk-dns');
        bindCheckboxGroup('page-chk-analytics', 'page-chk-marketing', 'page-chk-dns');

        var btnSavePrefs = document.getElementById('tg-save-prefs-btn');
        if (btnSavePrefs) {
            btnSavePrefs.addEventListener('click', function () {
                var chkAnalytics = document.getElementById('tg-chk-analytics');
                var chkMarketing = document.getElementById('tg-chk-marketing');
                var chkDns = document.getElementById('tg-chk-dns');

                cookieConsent.analytics = chkAnalytics ? chkAnalytics.checked : false;
                cookieConsent.marketing = chkMarketing ? chkMarketing.checked : false;
                cookieConsent.doNotSell = chkDns ? chkDns.checked : false;

                if (cookieConsent.doNotSell) {
                    cookieConsent.marketing = false;
                }

                saveCookieConsent();
                applyTrackingConsent();
                closeCookieModal();
                hideCookieBanner();
            });
        }

        var btnPageSaveChoices = document.getElementById('page-save-choices-btn');
        if (btnPageSaveChoices) {
            btnPageSaveChoices.addEventListener('click', function (e) {
                if (e) e.preventDefault();
                var chkAnalytics = document.getElementById('page-chk-analytics');
                var chkMarketing = document.getElementById('page-chk-marketing');
                var chkDns = document.getElementById('page-chk-dns');

                cookieConsent.analytics = chkAnalytics ? chkAnalytics.checked : false;
                cookieConsent.marketing = chkMarketing ? chkMarketing.checked : false;
                cookieConsent.doNotSell = chkDns ? chkDns.checked : false;

                if (cookieConsent.doNotSell) {
                    cookieConsent.marketing = false;
                }

                saveCookieConsent();
                applyTrackingConsent();
                hideCookieBanner();
            });
        }
    }

    function bindTool(id, callback) {
        var el = document.getElementById(id);
        if (el) {
            el.addEventListener('click', function () {
                callback();
                saveA11yState();
                applyA11yToDOM();
            });
        }
    }

    /* ==========================================================================
       12. FIRST-PARTY WEBSITE ANALYTICS & ORDER CLICK TRACKER (PRESERVED 100%)
       ========================================================================== */
    var TOAST_CODE_TO_STORE = {
        '841931': { id: 1, name: 'Rialto' },
        '725035': { id: 3, name: 'West Covina' },
        '718169': { id: 4, name: 'Azusa' },
        '260769': { id: 5, name: 'LA Broadway' },
        '260847': { id: 6, name: 'LA Central' },
        '252169': { id: 6, name: 'LA Central' },
        '23989119': { id: 7, name: 'Slauson' },
        '551916': { id: 8, name: 'Hollywood' },
        '724574': { id: 9, name: 'Santa Ana' },
        '963464': { id: 10, name: 'La Puente' },
        '260849': { id: 11, name: 'Huntington Park' },
        '1327857': { id: 12, name: 'Norwalk' },
        '260912': { id: 13, name: 'Bell' },
        '727877': { id: 14, name: 'Lynwood' },
        '846517': { id: 15, name: 'South Gate' },
        '302620': { id: 16, name: 'Downey' }
    };

    var SLUG_TO_STORE = {
        'rialto': { id: 1, name: 'Rialto' },
        'west-covina': { id: 3, name: 'West Covina' },
        'azusa': { id: 4, name: 'Azusa' },
        'la-broadway': { id: 5, name: 'LA Broadway' },
        'la-central': { id: 6, name: 'LA Central' },
        'slauson': { id: 7, name: 'Slauson' },
        'hollywood': { id: 8, name: 'Hollywood' },
        'santa-ana': { id: 9, name: 'Santa Ana' },
        'la-puente': { id: 10, name: 'La Puente' },
        'huntington-park': { id: 11, name: 'Huntington Park' },
        'norwalk': { id: 12, name: 'Norwalk' },
        'bell': { id: 13, name: 'Bell' },
        'lynwood': { id: 14, name: 'Lynwood' },
        'south-gate': { id: 15, name: 'South Gate' },
        'downey': { id: 16, name: 'Downey' }
    };

    var PHONE_TO_STORE = {
        '9095620430': { id: 1, name: 'Rialto' },
        '6269172662': { id: 3, name: 'West Covina' },
        '6269691011': { id: 4, name: 'Azusa' },
        '3232332302': { id: 5, name: 'LA Broadway' },
        '2137426677': { id: 6, name: 'LA Central' },
        '3236150084': { id: 7, name: 'Slauson' },
        '3239637993': { id: 8, name: 'Hollywood' },
        '7144800713': { id: 9, name: 'Santa Ana' },
        '6263363000': { id: 10, name: 'La Puente' },
        '3235817309': { id: 11, name: 'Huntington Park' },
        '5626510045': { id: 12, name: 'Norwalk' },
        '3237711722': { id: 13, name: 'Bell' },
        '4247855535': { id: 14, name: 'Lynwood' },
        '5628061200': { id: 15, name: 'South Gate' },
        '5629277486': { id: 16, name: 'Downey' }
    };

    var ADDRESS_HINTS_TO_STORE = [
        { hint: '1900', id: 6, name: 'LA Central' },
        { hint: '3220', id: 14, name: 'Lynwood' },
        { hint: '4380', id: 5, name: 'LA Broadway' },
        { hint: '10968', id: 12, name: 'Norwalk' },
        { hint: '5833', id: 7, name: 'Slauson' },
        { hint: '115', id: 1, name: 'Rialto' },
        { hint: '101', id: 3, name: 'West Covina' },
        { hint: '5800', id: 15, name: 'South Gate' },
        { hint: '7947', id: 16, name: 'Downey' },
        { hint: '7070', id: 8, name: 'Hollywood' },
        { hint: '1258', id: 9, name: 'Santa Ana' },
        { hint: '2425', id: 11, name: 'Huntington Park' },
        { hint: '13009', id: 10, name: 'La Puente' },
        { hint: '887', id: 4, name: 'Azusa' },
        { hint: '4406', id: 13, name: 'Bell' }
    ];

    var initialPageViewSent = false;

    function getSessionId() {
        if (!isAnalyticsAllowed()) return null;
        try {
            var sid = sessionStorage.getItem('tg_session_id');
            if (!sid) {
                sid = 's_' + Math.random().toString(36).slice(2, 11) + '_' + Date.now().toString(36);
                sessionStorage.setItem('tg_session_id', sid);
            }
            return sid;
        } catch (e) {
            return 's_anon_' + Math.floor(Date.now() / 600000);
        }
    }

    function getDeviceType() {
        var w = window.innerWidth || 1024;
        if (w <= 640) return 'mobile';
        if (w <= 1024) return 'tablet';
        return 'desktop';
    }

    function getReferrerSource() {
        var ref = document.referrer || '';
        if (!ref) return 'direct';
        try {
            var host = new URL(ref).hostname.toLowerCase();
            if (host.indexOf('tacosgavilan.com') !== -1 || host.indexOf('localhost') !== -1) return 'internal';
            if (host.indexOf('google.') !== -1) return 'google';
            if (host.indexOf('instagram.') !== -1) return 'instagram';
            if (host.indexOf('facebook.') !== -1 || host.indexOf('fb.') !== -1) return 'facebook';
            if (host.indexOf('tiktok.') !== -1) return 'tiktok';
            if (host.indexOf('yelp.') !== -1) return 'yelp';
            if (host.indexOf('bing.') !== -1 || host.indexOf('yahoo.') !== -1) return 'search';
            return host.slice(0, 60);
        } catch (e) {
            return 'direct';
        }
    }

    function sendTrackEvent(payload) {
        if (!isAnalyticsAllowed()) return;
        try {
            if (window.self !== window.top) return;
            if (window.location.pathname.indexOf('/api/web-preview') === 0) return;

            if (!payload.session_id) {
                payload.session_id = getSessionId();
            }

            var bodyStr = JSON.stringify(payload);
            if (navigator.sendBeacon) {
                var blob = new Blob([bodyStr], { type: 'text/plain;charset=UTF-8' });
                if (navigator.sendBeacon('/api/track', blob)) return;
            }
            fetch('/api/track', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: bodyStr,
                keepalive: true
            }).catch(function () {});
        } catch (e) {}
    }

    function detectStoreFromElementOrHref(el, href) {
        var codes = Object.keys(TOAST_CODE_TO_STORE);
        for (var i = 0; i < codes.length; i++) {
            if (href.indexOf(codes[i]) !== -1) {
                return TOAST_CODE_TO_STORE[codes[i]];
            }
        }
        if (href.indexOf('tel:') === 0) {
            var digits = href.replace(/\D/g, '').slice(-10);
            if (digits && Object.prototype.hasOwnProperty.call(PHONE_TO_STORE, digits)) return PHONE_TO_STORE[digits];
        }
        if (el && el.closest) {
            var card = el.closest('[data-store]');
            if (card) {
                var slug = card.getAttribute('data-store');
                if (slug && Object.prototype.hasOwnProperty.call(SLUG_TO_STORE, slug)) return SLUG_TO_STORE[slug];
            }
            var locCard = el.closest('.location-card');
            if (locCard) {
                var detLink = locCard.querySelector('a[href*="/locations/"]');
                if (detLink) {
                    var m = (detLink.getAttribute('href') || '').match(/\/locations\/([a-z0-9-]+)\/?/i);
                    if (m && Object.prototype.hasOwnProperty.call(SLUG_TO_STORE, m[1])) return SLUG_TO_STORE[m[1]];
                }
            }
        }
        try {
            var qStore = new URLSearchParams(window.location.search).get('store');
            if (qStore && Object.prototype.hasOwnProperty.call(SLUG_TO_STORE, qStore)) return SLUG_TO_STORE[qStore];
            var pathMatch = window.location.pathname.match(/\/locations\/([a-z0-9-]+)\/?/i);
            if (pathMatch && Object.prototype.hasOwnProperty.call(SLUG_TO_STORE, pathMatch[1])) return SLUG_TO_STORE[pathMatch[1]];
        } catch (e) {}
        var decoded = '';
        try { decoded = decodeURIComponent(href); } catch (e) { decoded = href; }
        for (var j = 0; j < ADDRESS_HINTS_TO_STORE.length; j++) {
            var item = ADDRESS_HINTS_TO_STORE[j];
            if (decoded.indexOf(item.hint) !== -1) {
                return { id: item.id, name: item.name };
            }
        }
        return { id: null, name: null };
    }

    function detectButtonSource(el) {
        if (!el || !el.closest) return 'page';
        if (el.closest('#mobile-sticky-bar, .mobile-sticky-bar')) return 'mobile_sticky_bar';
        if (el.closest('#store-details-modal-overlay, .store-details-modal')) return 'store_modal';
        if (el.closest('#map-modal-overlay, #gavilan-map, .map-popup')) return 'interactive_map';
        if (el.closest('#mobile-navigation, .nav-drawer-footer')) return 'mobile_drawer';
        if (el.closest('#header, .header')) return 'header';
        if (el.closest('.hero')) return 'hero';
        if (el.closest('.location-card, .store-card, #locations, #locations-list')) return 'location_card';
        if (el.closest('#fiesta, .fiesta')) return 'fiesta_platter';
        if (el.closest('#menu, .menu')) return 'menu';
        if (el.closest('#footer, .footer')) return 'footer';
        return 'page';
    }

    function sendInitialPageViewIfConsented() {
        if (initialPageViewSent || !isAnalyticsAllowed()) return;
        initialPageViewSent = true;
        var sessionId = getSessionId();
        var lang = (document.documentElement.lang === 'es' || currentLang === 'es') ? 'es' : 'en';
        var pagePath = window.location.pathname || '/';
        var storeFromUrl = detectStoreFromElementOrHref(null, window.location.href);

        sendTrackEvent({
            event_type: 'page_view',
            session_id: sessionId,
            page_path: pagePath,
            store_id: storeFromUrl.id,
            store_name: storeFromUrl.name,
            platform: 'web',
            button_source: 'navigation',
            device_type: getDeviceType(),
            lang: lang,
            referrer: getReferrerSource()
        });
    }

    function initFirstPartyAnalytics() {
        sendInitialPageViewIfConsented();

        document.addEventListener('click', function (e) {
            if (!isAnalyticsAllowed()) return;
            var link = e.target && e.target.closest ? e.target.closest('a') : null;
            if (!link) return;
            var href = link.getAttribute('href') || '';
            if (!href) return;

            var sessionId = getSessionId();
            var activeLang = (document.documentElement.lang === 'es' || currentLang === 'es') ? 'es' : 'en';
            var lowerHref = href.toLowerCase();

            var modalMatch = href.match(/(?:^\/locations\/|^\.\/)([a-z0-9-]+)\/?$/i);
            if (modalMatch && Object.prototype.hasOwnProperty.call(SLUG_TO_STORE, modalMatch[1])) {
                var st = SLUG_TO_STORE[modalMatch[1]];
                sendTrackEvent({
                    event_type: 'page_view',
                    session_id: sessionId,
                    page_path: '/locations/' + modalMatch[1] + '/',
                    store_id: st.id,
                    store_name: st.name,
                    platform: 'web',
                    button_source: 'store_details_modal',
                    device_type: getDeviceType(),
                    lang: activeLang,
                    referrer: 'internal'
                });
                return;
            }

            var platform = null;
            if (lowerHref.indexOf('order.online') !== -1 || lowerHref.indexOf('toasttab.com') !== -1) {
                platform = 'toast';
            } else if (lowerHref.indexOf('doordash.com') !== -1) {
                platform = 'doordash';
            } else if (lowerHref.indexOf('ubereats.com') !== -1) {
                platform = 'ubereats';
            } else if (lowerHref.indexOf('grubhub.com') !== -1) {
                platform = 'grubhub';
            } else if (lowerHref.indexOf('postmates.com') !== -1) {
                platform = 'postmates';
            } else if (lowerHref.indexOf('tel:') === 0) {
                platform = 'phone';
            } else if (lowerHref.indexOf('google.com/maps') !== -1 || lowerHref.indexOf('maps.google.com') !== -1) {
                platform = 'directions';
            }

            if (!platform) return;

            var storeInfo = detectStoreFromElementOrHref(link, href);
            var btnSource = detectButtonSource(link);

            sendTrackEvent({
                event_type: 'order_click',
                session_id: sessionId,
                page_path: window.location.pathname || '/',
                store_id: storeInfo.id,
                store_name: storeInfo.name || (platform === 'toast' ? 'Selector General (15 Sucursales)' : null),
                platform: platform,
                button_source: btnSource,
                device_type: getDeviceType(),
                lang: activeLang,
                referrer: getReferrerSource(),
                target_url: href.slice(0, 200)
            });
        }, true);
    }

    /* ==========================================================================
       13. PUBLIC API & INITIALIZATION
       ========================================================================== */
    window._tgOpenA11y = openA11yPanel;
    window._tgCloseA11y = closeA11yPanel;
    window._tgOpenCookies = openCookieModal;
    window._tgCloseCookies = closeCookieModal;
    window._tgReadPageKore = readFullPage;
    window._tgStopKore = stopSpeaking;
    window.tgTrackEvent = sendTrackEvent;

    function init() {
        loadSavedState();
        warmUpBrowserVoices();
        createDOM();
        bindEvents();
        applyA11yToDOM();
        applyTrackingConsent();
        showCookieBannerIfNeeded();
        initFirstPartyAnalytics();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
