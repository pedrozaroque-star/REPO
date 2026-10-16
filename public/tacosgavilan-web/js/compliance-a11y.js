/**
 * @file compliance-a11y.js
 * @module TacosGavilanCompliance
 * @description Enterprise California CCPA/CPRA 2026 Cookie Consent & ADA Title III / WCAG 2.2 AA Handicap Accessibility Engine
 * @businessRules
 *   - Strictly branded as "Tacos Gavilan" (official brand name only, zero emojis).
 *   - California CPRA compliance: Notice at Collection, category consent, persistent "Do Not Sell or Share My Personal Information" opt-out (CPRA § 1798.135).
 *   - Respects Global Privacy Control (GPC) standard (11 CCR § 7025).
 *   - Dynamic tracking pixel enforcement: controls Facebook Pixel (fbq), TikTok Pixel (ttq), and Google Tag Manager (dataLayer).
 *   - ADA Handicap Widget: Floating middle-right button (top: 50%, right: 18px), keyboard focus trap, high contrast, dyslexia font, font scaling, reading guide, stop animations.
 *   - Full bilingual support (English / Spanish with correct "Español" spelling and accents).
 *   - Client-side persistence in safe storage (localStorage and cookie fallback).
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
            } catch (e) {}
            try {
                var d = new Date();
                d.setTime(d.getTime() + (365 * 24 * 60 * 60 * 1000));
                document.cookie = key + '=' + encodeURIComponent(value) + ';expires=' + d.toUTCString() + ';path=/;SameSite=Lax';
            } catch (e) {}
        }
    };

    /* ==========================================================================
       2. BILINGUAL DICTIONARY (ESPAÑOL / ENGLISH)
       ========================================================================== */
    var I18N = {
        es: {
            // Handicap Accessibility Widget
            a11yTriggerLabel: 'Herramientas de Accesibilidad (ADA Title III & California)',
            a11yTitle: 'Accesibilidad',
            a11yReset: 'Restablecer',
            a11yStatement: 'Declaración ADA',
            langToggle: 'English',
            secVision: 'Ajustes Visuales y Contraste',
            secBlindness: 'Ciegos y Débiles Visuales (Lector de Voz)',
            secContent: 'Lectura y Tipografía',
            secMotion: 'Navegación y Movimiento',
            toolContrast: 'Alto Contraste',
            toolInvert: 'Invertir Colores',
            toolGrayscale: 'Escala de Grises',
            toolScreenReader: 'Lector de Voz',
            toolPageReader: 'Leer Toda la Página',
            toolTextSize: 'Tamaño de Texto',
            toolDyslexic: 'Fuente Dislexia',
            toolSpacing: 'Espaciado de Texto',
            toolHighlight: 'Resaltar Enlaces',
            toolCursor: 'Cursor Grande',
            toolStopAnim: 'Pausar Animaciones',
            toolReadingGuide: 'Guía de Lectura',
            speechBarStop: 'Detener Audio',

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
            statementBody: 'Tacos Gavilan trabaja continuamente hacia la conformidad con las Pautas de Accesibilidad para el Contenido Web (WCAG) 2.2 Nivel AA y evalúa y mejora constantemente el sitio web para facilitar el acceso a todas las personas.\n\nALCANCE Y MEJORAS CONTINUAS:\nImplementamos estructura HTML5 semántica, navegación por teclado, trampas de foco en modales y menú móvil, etiquetas de formulario accesibles y alternativas de texto para mapas e imágenes.\n\nASISTENCIA TELEFÓNICA Y REPORTE DE BARRERAS:\nSi experimenta alguna dificultad para navegar, consultar nuestro menú o realizar un pedido en línea en order.online (operado por DoorDash, Inc.), puede llamar directamente a cualquiera de nuestras 15 sucursales listadas en /locations/ para recibir asistencia de nuestro personal, o reportar cualquier barrera de accesibilidad:\n\n• Correo Electrónico: info@tacosgavilan.com\n• Formulario de Contacto y Accesibilidad: https://tacosgavilan.com/contact/\n• Directorio de 15 Sucursales: https://tacosgavilan.com/locations/'
        },
        en: {
            // Handicap Accessibility Widget
            a11yTriggerLabel: 'Accessibility Tools (ADA Title III & California)',
            a11yTitle: 'Accessibility',
            a11yReset: 'Reset All',
            a11yStatement: 'ADA Statement',
            langToggle: 'Español',
            secVision: 'Vision & Contrast Adjustments',
            secBlindness: 'Blindness & Audio Reading (Text to Speech)',
            secContent: 'Content & Reading',
            secMotion: 'Navigation & Motion',
            toolContrast: 'High Contrast',
            toolInvert: 'Invert Colors',
            toolGrayscale: 'Monochrome',
            toolScreenReader: 'Screen Reader',
            toolPageReader: 'Read Full Page',
            toolTextSize: 'Text Size',
            toolDyslexic: 'Dyslexia Font',
            toolSpacing: 'Text Spacing',
            toolHighlight: 'Highlight Links',
            toolCursor: 'Big Cursor',
            toolStopAnim: 'Pause Animations',
            toolReadingGuide: 'Reading Guide',
            speechBarStop: 'Stop Audio',

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
            statementBody: 'Tacos Gavilan is working toward Web Content Accessibility Guidelines (WCAG) 2.2 Level AA conformance and continuously evaluates and improves the website to support equal access for all guests.\n\nSCOPE & NATIVE ACCESSIBILITY MEASURES:\nWe implement semantic HTML5 landmarks, keyboard navigation, focus traps on modals and the mobile navigation drawer, accessible form labels, and native HTML store directory alternatives alongside interactive maps.\n\nTELEPHONE ASSISTANCE & BARRIER REPORTING:\nIf you encounter any difficulty accessing our website, reviewing menus, or placing an online order on order.online (operated by DoorDash, Inc.), you may call any of our 15 Southern California restaurant locations listed at /locations/ for direct staff assistance, or report an accessibility barrier:\n\n• Email: info@tacosgavilan.com\n• Online Contact & Accessibility Form: https://tacosgavilan.com/contact/\n• 15 Restaurant Locations Directory: https://tacosgavilan.com/locations/'
        }
    };

    var currentLang = (function () {
        var saved = safeStorage.getItem('tacosgavilan_lang') || safeStorage.getItem('tg_site_lang');
        if (saved && (saved === 'es' || saved === 'en')) return saved;
        var browser = (navigator.language || navigator.userLanguage || '').toLowerCase();
        return browser.indexOf('es') === 0 ? 'es' : 'en';
    })();

    var a11yState = {
        contrast: false,
        invert: false,
        grayscale: false,
        fontSize: 0, // 0: normal, 1: +18%, 2: +35%
        dyslexic: false,
        spacing: false,
        highlightLinks: false,
        bigCursor: false,
        stopAnim: false,
        readingGuide: false,
        screenReader: false
    };

    // Strict Prior-Consent Default: analytics and marketing are FALSE until explicit user opt-in
    var cookieConsent = {
        necessary: true,
        analytics: false,
        marketing: false,
        doNotSell: false,
        timestamp: null,
        answered: false
    };

    /* ==========================================================================
       3. STORAGE & SYNC
       ========================================================================== */
    function loadSavedState() {
        try {
            var savedA11y = safeStorage.getItem('tg_a11y_prefs');
            if (savedA11y) {
                var parsedA11y = JSON.parse(savedA11y);
                for (var key in parsedA11y) {
                    if (a11yState.hasOwnProperty(key)) {
                        a11yState[key] = parsedA11y[key];
                    }
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
            safeStorage.setItem('tg_a11y_prefs', JSON.stringify(a11yState));
        } catch (e) {}
    }

    function saveCookieConsent(statusStr) {
        try {
            cookieConsent.timestamp = Date.now();
            cookieConsent.answered = true;
            safeStorage.setItem('tg_cookie_consent', JSON.stringify(cookieConsent));
            // Keep legacy tacosgavilan_cookie_consent string in sync
            safeStorage.setItem('tacosgavilan_cookie_consent', statusStr || (cookieConsent.marketing && !cookieConsent.doNotSell ? 'accepted' : 'declined'));
        } catch (e) {}
    }

    /* ==========================================================================
       4. DYNAMIC TRACKING ENFORCEMENT (CCPA/CPRA + GOOGLE CONSENT MODE V2)
       ========================================================================== */
    function purgeTrackingCookies() {
        var cookiesToPurge = ['_ga', '_gid', '_gat', '_gcl_au', '_gcl_aw', '_fbp', '_fbc', '_ttp'];
        var hostParts = (window.location.hostname || '').split('.');
        var rootDomain = hostParts.length >= 2 ? '.' + hostParts.slice(-2).join('.') : window.location.hostname;
        cookiesToPurge.forEach(function (name) {
            try {
                document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/';
                if (rootDomain) {
                    document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;domain=' + rootDomain;
                }
            } catch (e) {}
        });
    }

    function syncModalCheckboxes() {
        var gpcActive = (typeof navigator !== 'undefined' && navigator.globalPrivacyControl === true);
        var chkAnalytics = document.getElementById('tg-chk-analytics');
        var chkMarketing = document.getElementById('tg-chk-marketing');
        var chkDns = document.getElementById('tg-chk-dns');
        if (chkAnalytics) chkAnalytics.checked = !!(cookieConsent.answered && cookieConsent.analytics && !cookieConsent.doNotSell && !gpcActive);
        if (chkMarketing) chkMarketing.checked = !!(cookieConsent.answered && cookieConsent.marketing && !cookieConsent.doNotSell && !gpcActive);
        if (chkDns) chkDns.checked = !!(cookieConsent.doNotSell || gpcActive);
    }

    function applyTrackingConsent() {
        var gpcActive = (typeof navigator !== 'undefined' && navigator.globalPrivacyControl === true);
        var allowMarketing = cookieConsent.answered && cookieConsent.marketing && !cookieConsent.doNotSell && !gpcActive;
        var allowAnalytics = cookieConsent.answered && cookieConsent.analytics && !cookieConsent.doNotSell && !gpcActive;

        // Disable Google Analytics tracker directly when analytics/sale is not granted
        window['ga-disable-UA-74752614-19'] = !allowAnalytics;

        if (!allowMarketing || !allowAnalytics) {
            purgeTrackingCookies();
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
            if (currentLang === 'es') {
                if (gpcActive) {
                    statusEl.textContent = 'Estado Actual: Opt-out request honored — Señal Global Privacy Control (GPC) Activa (Venta/Compartición y Etiquetas Publicitarias Bloqueadas)';
                } else if (isOptedOut) {
                    statusEl.textContent = 'Estado Actual: Opt-out request honored — Exclusión Activa (No Vender ni Compartir Mi Información Personal)';
                } else if (!cookieConsent.answered) {
                    statusEl.textContent = 'Estado Actual: Bloqueo Previo Activo (Etiquetas no esenciales bloqueadas hasta su consentimiento)';
                } else {
                    statusEl.textContent = 'Estado Actual: Consentimiento Personalizado Activo (Analítica: ' + (allowAnalytics ? 'Sí' : 'No') + ', Marketing: ' + (allowMarketing ? 'Sí' : 'No') + ')';
                }
            } else {
                if (gpcActive) {
                    statusEl.textContent = 'Current Status: Opt-out request honored — Global Privacy Control (GPC) Signal Active (Sale/Sharing & Ad Tags Blocked)';
                } else if (isOptedOut) {
                    statusEl.textContent = 'Current Status: Opt-out request honored — Do Not Sell or Share Active (Non-Essential Ad Tags Blocked)';
                } else if (!cookieConsent.answered) {
                    statusEl.textContent = 'Current Status: Prior-Consent Protection Active (Non-essential tags blocked until you opt in)';
                } else {
                    statusEl.textContent = 'Current Status: Custom Consent Active (Analytics: ' + (allowAnalytics ? 'On' : 'Off') + ', Marketing: ' + (allowMarketing ? 'On' : 'Off') + ')';
                }
            }
        });

        var honoredBadges = [
            document.getElementById('page-gpc-honored-badge'),
            document.getElementById('tg-modal-gpc-status'),
            document.getElementById('tg-banner-gpc-status')
        ];
        honoredBadges.forEach(function (badge) {
            if (!badge) return;
            if (isOptedOut) {
                badge.style.display = 'inline-flex';
                badge.textContent = currentLang === 'es'
                    ? (gpcActive ? '✓ Opt-out request honored (Señal GPC Activa)' : '✓ Opt-out request honored (Solicitud de exclusión aplicada)')
                    : (gpcActive ? '✓ Opt-out request honored (GPC Signal Active)' : '✓ Opt-out request honored');
            } else {
                badge.style.display = 'none';
            }
        });
    }

    /* ==========================================================================
       5. ACCESSIBILITY DOM MANIPULATION
       ========================================================================== */
    function applyA11yToDOM() {
        var html = document.documentElement;

        // Contrast
        html.classList.toggle('tg-high-contrast', !!a11yState.contrast);

        // Invert
        html.classList.toggle('tg-invert-colors', !!a11yState.invert);

        // Grayscale
        html.classList.toggle('tg-grayscale', !!a11yState.grayscale);

        // Font Sizing
        html.classList.remove('tg-font-large', 'tg-font-xlarge');
        if (a11yState.fontSize === 1) {
            html.classList.add('tg-font-large');
        } else if (a11yState.fontSize === 2) {
            html.classList.add('tg-font-xlarge');
        }

        // Dyslexic Font
        html.classList.toggle('tg-dyslexic-font', !!a11yState.dyslexic);

        // Text Spacing
        html.classList.toggle('tg-text-spacing', !!a11yState.spacing);

        // Highlight Links
        html.classList.toggle('tg-highlight-links', !!a11yState.highlightLinks);

        // Big Cursor
        html.classList.toggle('tg-big-cursor', !!a11yState.bigCursor);

        // Stop Animations
        html.classList.toggle('tg-stop-animations', !!a11yState.stopAnim);

        // Reading Guide Ruler
        var guide = document.getElementById('tg-reading-guide-line');
        if (guide) {
            guide.classList.toggle('is-active', !!a11yState.readingGuide);
        }

        // Update button states in UI
        updateA11yUI();
    }

    /* Speech Synthesis / Text-to-Speech Engine */
    var currentSpeechUtterance = null;
    var currentHighlightedEl = null;

    function stopSpeaking() {
        if (typeof window !== 'undefined' && window.speechSynthesis) {
            try {
                window.speechSynthesis.cancel();
            } catch (e) {}
        }
        if (currentHighlightedEl) {
            currentHighlightedEl.classList.remove('tg-speech-active');
            currentHighlightedEl = null;
        }
        var speechBar = document.getElementById('tg-speech-bar');
        if (speechBar && !a11yState.screenReader) {
            speechBar.classList.remove('is-visible');
        }
    }

    function speakText(text, targetEl) {
        if (!text || typeof window === 'undefined' || !window.speechSynthesis) return;

        stopSpeaking();

        if (targetEl && targetEl.classList) {
            currentHighlightedEl = targetEl;
            targetEl.classList.add('tg-speech-active');
        }

        var speechBar = document.getElementById('tg-speech-bar');
        var speechBarText = document.getElementById('tg-speech-bar-text');
        if (speechBar) {
            speechBar.classList.add('is-visible');
            if (speechBarText) {
                speechBarText.textContent = text.length > 55 ? text.substring(0, 52) + '...' : text;
            }
        }

        try {
            var utterance = new SpeechSynthesisUtterance(text);
            utterance.lang = currentLang === 'es' ? 'es-US' : 'en-US';
            utterance.rate = 0.95;
            utterance.pitch = 1.0;

            utterance.onend = function () {
                if (currentHighlightedEl) {
                    currentHighlightedEl.classList.remove('tg-speech-active');
                    currentHighlightedEl = null;
                }
                if (speechBarText && a11yState.screenReader) {
                    speechBarText.textContent = currentLang === 'es' ? 'Lector de Voz Activo (Toque cualquier texto)' : 'Voice Reader Active (Tap any text)';
                }
            };

            utterance.onerror = function () {
                if (currentHighlightedEl) {
                    currentHighlightedEl.classList.remove('tg-speech-active');
                    currentHighlightedEl = null;
                }
            };

            currentSpeechUtterance = utterance;
            window.speechSynthesis.speak(utterance);
        } catch (e) {
            console.warn('[Tacos Gavilan] Speech error:', e);
        }
    }

    function readFullPage() {
        var parts = [];
        var title = document.title;
        if (title) parts.push(title);

        var headings = document.querySelectorAll('main h1, main h2, main h3, #main-content h1, #main-content h2, #main-content h3');
        if (headings && headings.length > 0) {
            headings.forEach(function (h) {
                var txt = (h.textContent || '').trim();
                if (txt) parts.push(txt);
            });
        } else {
            var allH = document.querySelectorAll('h1, h2, h3');
            allH.forEach(function (h) {
                var txt = (h.textContent || '').trim();
                if (txt && !h.closest('#tg-a11y-panel') && !h.closest('#tg-cookie-banner')) {
                    parts.push(txt);
                }
            });
        }

        if (currentLang === 'es') {
            parts.push('Para asistencia telefónica, visite nuestra sección de Sucursales o escríbanos a info@tacosgavilan.com.');
        } else {
            parts.push('For phone assistance, please visit our Locations section or email info@tacosgavilan.com.');
        }

        var fullText = parts.join('. ');
        speakText(fullText, null);
    }

    function updateA11yUI() {
        var activeCount = 0;
        if (a11yState.contrast) activeCount++;
        if (a11yState.invert) activeCount++;
        if (a11yState.grayscale) activeCount++;
        if (a11yState.fontSize > 0) activeCount++;
        if (a11yState.dyslexic) activeCount++;
        if (a11yState.spacing) activeCount++;
        if (a11yState.highlightLinks) activeCount++;
        if (a11yState.bigCursor) activeCount++;
        if (a11yState.stopAnim) activeCount++;
        if (a11yState.readingGuide) activeCount++;
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

        setBtnActive('tg-tool-contrast', a11yState.contrast);
        setBtnActive('tg-tool-invert', a11yState.invert);
        setBtnActive('tg-tool-grayscale', a11yState.grayscale);
        setBtnActive('tg-tool-text-size', a11yState.fontSize > 0);
        setBtnActive('tg-tool-dyslexic', a11yState.dyslexic);
        setBtnActive('tg-tool-spacing', a11yState.spacing);
        setBtnActive('tg-tool-highlight', a11yState.highlightLinks);
        setBtnActive('tg-tool-cursor', a11yState.bigCursor);
        setBtnActive('tg-tool-stop-anim', a11yState.stopAnim);
        setBtnActive('tg-tool-reading-guide', a11yState.readingGuide);
        setBtnActive('tg-tool-screen-reader', a11yState.screenReader);
    }

    function setBtnActive(id, isActive) {
        var el = document.getElementById(id);
        if (el) {
            el.classList.toggle('is-active', !!isActive);
            el.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        }
    }

    /* ==========================================================================
       6. DOM CREATION & BOOTSTRAP
       ========================================================================== */
    function createDOM() {
        var t = I18N[currentLang];

        // 1. Reading Guide Element
        if (!document.getElementById('tg-reading-guide-line')) {
            var guide = document.createElement('div');
            guide.id = 'tg-reading-guide-line';
            guide.className = 'tg-reading-guide-line';
            guide.setAttribute('aria-hidden', 'true');
            document.body.appendChild(guide);

            window.addEventListener('mousemove', function (e) {
                if (a11yState.readingGuide && guide) {
                    guide.style.top = e.clientY + 'px';
                }
            }, { passive: true });
        }

        // 2. Floating Handicap Trigger Button (Middle-Right: top 50%, right 18px)
        if (!document.getElementById('tg-a11y-trigger')) {
            var trigger = document.createElement('button');
            trigger.id = 'tg-a11y-trigger';
            trigger.setAttribute('type', 'button');
            trigger.setAttribute('aria-haspopup', 'dialog');
            trigger.setAttribute('aria-expanded', 'false');
            trigger.setAttribute('aria-controls', 'tg-a11y-panel');
            trigger.setAttribute('aria-label', t.a11yTriggerLabel);
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
                '  <h2 id="tg-a11y-title" class="tg-panel-title">' +
                '    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2c1.1 0 2 .9 2 2s-.9 2-2 2-2-.9-2-2 .9-2 2-2zm9 7h-6v13h-2v-6h-2v6H9V9H3V7h18v2z"/></svg>' +
                '    <span id="tg-a11y-title-text">' + t.a11yTitle + '</span>' +
                '  </h2>' +
                '  <div class="tg-header-actions">' +
                '    <button type="button" id="tg-lang-toggle" class="tg-lang-btn" aria-label="Cambiar idioma / Switch language">' + t.langToggle + '</button>' +
                '    <button type="button" id="tg-a11y-close" class="tg-close-btn" aria-label="Close / Cerrar">×</button>' +
                '  </div>' +
                '</div>' +
                '<div class="tg-panel-body">' +
                '  <div>' +
                '    <div class="tg-section-label" id="tg-sec-vision">' + t.secVision + '</div>' +
                '    <div class="tg-grid-2">' +
                '      <button type="button" id="tg-tool-contrast" class="tg-tool-btn" aria-pressed="false">' +
                '        <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18V4c4.41 0 8 3.59 8 8s-3.59 8-8 8z"/></svg>' +
                '        <span id="tg-txt-contrast">' + t.toolContrast + '</span>' +
                '      </button>' +
                '      <button type="button" id="tg-tool-invert" class="tg-tool-btn" aria-pressed="false">' +
                '        <svg viewBox="0 0 24 24"><path d="M6.34 7.93c-3.12 3.12-3.12 8.19 0 11.31s8.19 3.12 11.31 0l-11.31-11.31zm12.73 9.9c1.95-1.95 2.76-4.57 2.43-7.07l-9.5 9.5c2.5.33 5.12-.48 7.07-2.43zM12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/></svg>' +
                '        <span id="tg-txt-invert">' + t.toolInvert + '</span>' +
                '      </button>' +
                '      <button type="button" id="tg-tool-grayscale" class="tg-tool-btn" aria-pressed="false">' +
                '        <svg viewBox="0 0 24 24"><path d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-.99 0-.83.67-1.5 1.5-1.5H16c2.76 0 5-2.24 5-5 0-4.42-4.03-8-9-8zm-5.5 9c-.83 0-1.5-.67-1.5-1.5S5.67 9 6.5 9 8 9.67 8 10.5 7.33 12 6.5 12zm3-4C8.67 8 8 7.33 8 6.5S8.67 5 9.5 5s1.5.67 1.5 1.5S10.33 8 9.5 8zm5 0c-.83 0-1.5-.67-1.5-1.5S13.67 5 14.5 5s1.5.67 1.5 1.5S15.33 8 14.5 8zm3 4c-.83 0-1.5-.67-1.5-1.5S16.67 9 17.5 9s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/></svg>' +
                '        <span id="tg-txt-grayscale">' + t.toolGrayscale + '</span>' +
                '      </button>' +
                '      <button type="button" id="tg-tool-highlight" class="tg-tool-btn" aria-pressed="false">' +
                '        <svg viewBox="0 0 24 24"><path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/></svg>' +
                '        <span id="tg-txt-highlight">' + t.toolHighlight + '</span>' +
                '      </button>' +
                '    </div>' +
                '  </div>' +
                '  <div>' +
                '    <div class="tg-section-label" id="tg-sec-blindness">' + t.secBlindness + '</div>' +
                '    <div class="tg-grid-2">' +
                '      <button type="button" id="tg-tool-screen-reader" class="tg-tool-btn" aria-pressed="false">' +
                '        <svg viewBox="0 0 24 24"><path d="M12 3v9.28a4.39 4.39 0 00-1.5-.28C8.01 12 6 14.01 6 16.5S8.01 21 10.5 21c2.31 0 4.2-1.75 4.45-4H15V6h4V3h-7z"/></svg>' +
                '        <span id="tg-txt-screen-reader">' + t.toolScreenReader + '</span>' +
                '      </button>' +
                '      <button type="button" id="tg-tool-page-reader" class="tg-tool-btn">' +
                '        <svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>' +
                '        <span id="tg-txt-page-reader">' + t.toolPageReader + '</span>' +
                '      </button>' +
                '    </div>' +
                '  </div>' +
                '  <div>' +
                '    <div class="tg-section-label" id="tg-sec-content">' + t.secContent + '</div>' +
                '    <div class="tg-grid-2">' +
                '      <button type="button" id="tg-tool-text-size" class="tg-tool-btn" aria-pressed="false">' +
                '        <svg viewBox="0 0 24 24"><path d="M9 4v3h5v12h3V7h5V4H9zm-6 8h3v7h3v-7h3V9H3v3z"/></svg>' +
                '        <span id="tg-txt-text-size">' + t.toolTextSize + '</span>' +
                '      </button>' +
                '      <button type="button" id="tg-tool-dyslexic" class="tg-tool-btn" aria-pressed="false">' +
                '        <svg viewBox="0 0 24 24"><path d="M5 4v3h5.5v12h3V7H19V4H5z"/></svg>' +
                '        <span id="tg-txt-dyslexic">' + t.toolDyslexic + '</span>' +
                '      </button>' +
                '      <button type="button" id="tg-tool-spacing" class="tg-tool-btn" aria-pressed="false">' +
                '        <svg viewBox="0 0 24 24"><path d="M2 4h20v2H2V4zm0 14h20v2H2v-2zm8-6h4v3l4-4-4-4v3h-4V6l-4 4 4 4v-2z"/></svg>' +
                '        <span id="tg-txt-spacing">' + t.toolSpacing + '</span>' +
                '      </button>' +
                '      <button type="button" id="tg-tool-reading-guide" class="tg-tool-btn" aria-pressed="false">' +
                '        <svg viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg>' +
                '        <span id="tg-txt-reading-guide">' + t.toolReadingGuide + '</span>' +
                '      </button>' +
                '    </div>' +
                '  </div>' +
                '  <div>' +
                '    <div class="tg-section-label" id="tg-sec-motion">' + t.secMotion + '</div>' +
                '    <div class="tg-grid-2">' +
                '      <button type="button" id="tg-tool-cursor" class="tg-tool-btn" aria-pressed="false">' +
                '        <svg viewBox="0 0 24 24"><path d="M13.64 21.97c-.18 0-.36-.05-.52-.15l-3.87-2.47-2.31 2.31c-.39.39-1.02.39-1.41 0-.19-.19-.29-.44-.29-.71V3.5c0-.55.45-1 1-1 .27 0 .52.11.71.29l13.5 13.5c.39.39.39 1.02 0 1.41-.19.19-.44.29-.71.29h-3.41l2.42 3.79c.29.47.16 1.09-.31 1.39-.16.1-.33.15-.51.15z"/></svg>' +
                '        <span id="tg-txt-cursor">' + t.toolCursor + '</span>' +
                '      </button>' +
                '      <button type="button" id="tg-tool-stop-anim" class="tg-tool-btn" aria-pressed="false">' +
                '        <svg viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>' +
                '        <span id="tg-txt-stop-anim">' + t.toolStopAnim + '</span>' +
                '      </button>' +
                '    </div>' +
                '  </div>' +
                '</div>' +
                '<div class="tg-panel-footer">' +
                '  <button type="button" id="tg-a11y-reset" class="tg-reset-btn">' + t.a11yReset + '</button>' +
                '  <button type="button" id="tg-statement-btn" class="tg-statement-link">' + t.a11yStatement + '</button>' +
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
            stmtModal.style.display = 'none';
            stmtModal.innerHTML =
                '<div class="tg-modal-box">' +
                '  <div class="tg-modal-header">' +
                '    <h3 class="tg-modal-title" id="tg-stmt-title">' + t.statementTitle + '</h3>' +
                '    <button type="button" id="tg-stmt-close" class="tg-close-btn" aria-label="Close">×</button>' +
                '  </div>' +
                '  <div class="tg-modal-body" style="white-space: pre-line; line-height: 1.6; color: #d1d5db;" id="tg-stmt-body">' +
                t.statementBody +
                '  </div>' +
                '</div>';
            document.body.appendChild(stmtModal);
        }

        // 4b. Floating Speech Bar
        if (!document.getElementById('tg-speech-bar')) {
            var speechBar = document.createElement('div');
            speechBar.id = 'tg-speech-bar';
            speechBar.className = 'tg-speech-bar';
            speechBar.setAttribute('role', 'status');
            speechBar.setAttribute('aria-live', 'polite');
            speechBar.innerHTML =
                '<svg width="18" height="18" viewBox="0 0 24 24" fill="#f4c430" aria-hidden="true"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/></svg>' +
                '<span id="tg-speech-bar-text" style="max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">' + (currentLang === 'es' ? 'Lector de Voz Activo (Toque cualquier texto)' : 'Voice Reader Active (Tap any text)') + '</span>' +
                '<button type="button" id="tg-speech-stop-btn" aria-label="' + t.speechBarStop + '">' +
                '  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h12v12H6z"/></svg>' +
                '</button>';
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
                '    <button type="button" id="tg-cookie-modal-close" class="tg-close-btn" aria-label="Close">×</button>' +
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
                '        <input type="checkbox" checked disabled aria-label="Necessary cookies active" />' +
                '      </div>' +
                '      <p class="tg-cat-desc" id="tg-cat-nec-desc">' + t.catNecessaryDesc + '</p>' +
                '    </div>' +
                '    <div class="tg-cookie-category">' +
                '      <div class="tg-cat-header">' +
                '        <h4 class="tg-cat-title" id="tg-cat-ana-title">' + t.catAnalyticsTitle + '</h4>' +
                '        <label class="tg-switch">' +
                '          <input type="checkbox" id="tg-chk-analytics" ' + (cookieConsent.analytics ? 'checked' : '') + ' />' +
                '          <span class="tg-slider"></span>' +
                '        </label>' +
                '      </div>' +
                '      <p class="tg-cat-desc" id="tg-cat-ana-desc">' + t.catAnalyticsDesc + '</p>' +
                '    </div>' +
                '    <div class="tg-cookie-category">' +
                '      <div class="tg-cat-header">' +
                '        <h4 class="tg-cat-title" id="tg-cat-mkt-title">' + t.catMarketingTitle + '</h4>' +
                '        <label class="tg-switch">' +
                '          <input type="checkbox" id="tg-chk-marketing" ' + (cookieConsent.marketing ? 'checked' : '') + ' />' +
                '          <span class="tg-slider"></span>' +
                '        </label>' +
                '      </div>' +
                '      <p class="tg-cat-desc" id="tg-cat-mkt-desc">' + t.catMarketingDesc + '</p>' +
                '    </div>' +
                '    <div class="tg-cookie-category tg-dns-block">' +
                '      <div class="tg-cat-header">' +
                '        <h4 class="tg-cat-title tg-dns-title" id="tg-cat-dns-title">' + t.dnsSectionTitle + '</h4>' +
                '        <label class="tg-switch">' +
                '          <input type="checkbox" id="tg-chk-dns" ' + (cookieConsent.doNotSell ? 'checked' : '') + ' />' +
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
            // Upgrade existing banner with Do Not Sell and Preferences buttons if not present
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
            banner.setAttribute('aria-label', 'California Privacy & Cookie Consent');
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

        // If the canonical .footer-legal-links block already exists in the footer, do not inject a duplicate link row
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

    /* ==========================================================
       7. LANGUAGE SWITCHING ENGINE
       ========================================================== */
    function switchLanguage(lang) {
        if (lang !== 'es' && lang !== 'en') return;
        currentLang = lang;
        safeStorage.setItem('tacosgavilan_lang', lang);
        safeStorage.setItem('tg_site_lang', lang);
        document.documentElement.lang = currentLang;

        var t = I18N[currentLang];

        // Update Handicap Widget Labels
        var trigger = document.getElementById('tg-a11y-trigger');
        if (trigger) trigger.setAttribute('aria-label', t.a11yTriggerLabel);

        var langBtn = document.getElementById('tg-lang-toggle');
        if (langBtn) langBtn.textContent = t.langToggle;

        setText('tg-a11y-title-text', t.a11yTitle);
        setText('tg-a11y-reset', t.a11yReset);
        setText('tg-statement-btn', t.a11yStatement);
        setText('tg-sec-vision', t.secVision);
        setText('tg-sec-blindness', t.secBlindness);
        setText('tg-sec-content', t.secContent);
        setText('tg-sec-motion', t.secMotion);
        setText('tg-txt-contrast', t.toolContrast);
        setText('tg-txt-invert', t.toolInvert);
        setText('tg-txt-grayscale', t.toolGrayscale);
        setText('tg-txt-highlight', t.toolHighlight);
        setText('tg-txt-screen-reader', t.toolScreenReader);
        setText('tg-txt-page-reader', t.toolPageReader);
        setText('tg-txt-text-size', t.toolTextSize);
        setText('tg-txt-dyslexic', t.toolDyslexic);
        setText('tg-txt-spacing', t.toolSpacing);
        setText('tg-txt-cursor', t.toolCursor);
        setText('tg-txt-stop-anim', t.toolStopAnim);
        setText('tg-txt-reading-guide', t.toolReadingGuide);
        var stopBtn = document.getElementById('tg-speech-stop-btn');
        if (stopBtn) stopBtn.setAttribute('aria-label', t.speechBarStop);

        // Update Statement Modal
        setText('tg-stmt-title', t.statementTitle);
        setText('tg-stmt-body', t.statementBody);

        // Update Cookie Modal
        setText('tg-cookie-modal-title', t.modalTitle);
        setText('tg-modal-desc', t.modalDesc);
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

        // Update Cookie Banner
        setText('tg-banner-badge', t.cookieBadge);
        setText('tg-banner-text', t.cookieText);
        setText('tg-txt-dns', t.btnDns);
        setText('tg-btn-reject-all', t.btnRejectAll);
        setText('tg-btn-prefs', t.btnPrefs);
        setText('tg-btn-accept-all', t.btnAcceptAll);
        setText('cookie-dns-btn', t.btnDns);
        setText('cookie-prefs-btn', t.btnPrefs);

        // Update Footer
        setText('tg-footer-dns-link', t.footerDnsLink);
        setText('tg-footer-a11y-link', t.footerA11yLink);
    }

    function setText(id, text) {
        var el = document.getElementById(id);
        if (el && text) el.textContent = text;
    }

    /* ==========================================================
       8. MODAL INTERACTION & FOCUS TRAP
       ========================================================== */
    var lastFocusedElement = null;

    function openA11yPanel() {
        var panel = document.getElementById('tg-a11y-panel');
        var trigger = document.getElementById('tg-a11y-trigger');
        if (!panel || !trigger) return;

        lastFocusedElement = document.activeElement;
        panel.classList.add('is-open');
        trigger.setAttribute('aria-expanded', 'true');

        var closeBtn = document.getElementById('tg-a11y-close');
        if (closeBtn) closeBtn.focus();
    }

    function closeA11yPanel() {
        var panel = document.getElementById('tg-a11y-panel');
        var trigger = document.getElementById('tg-a11y-trigger');
        if (!panel) return;

        panel.classList.remove('is-open');
        if (trigger) {
            trigger.setAttribute('aria-expanded', 'false');
            if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
                lastFocusedElement.focus();
            }
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
        modal.style.display = 'flex';
        modal.classList.add('is-open');
        var closeBtn = document.getElementById('tg-cookie-modal-close');
        if (closeBtn) closeBtn.focus();
    }

    function closeCookieModal() {
        var modal = document.getElementById('tg-cookie-modal');
        if (modal) {
            modal.style.display = 'none';
            modal.classList.remove('is-open');
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
            setTimeout(function () {
                var banner = document.getElementById('tg-cookie-banner') || document.getElementById('cookie-banner');
                if (banner) {
                    banner.style.display = 'block';
                    banner.offsetHeight;
                    banner.classList.add('is-visible', 'cookie-banner-visible');
                    document.body.classList.add('has-cookie-banner');
                }
            }, 1000);
        }
    }

    /* ==========================================================
       9. EVENT BINDINGS
       ========================================================== */
    function bindEvents() {
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

        // Language toggle inside handicap widget
        var langToggle = document.getElementById('tg-lang-toggle');
        if (langToggle) {
            langToggle.addEventListener('click', function () {
                switchLanguage(currentLang === 'es' ? 'en' : 'es');
                // Also trigger site-wide lang toggle if present
                var mainLangBtn = document.getElementById('lang-toggle');
                if (mainLangBtn) mainLangBtn.click();
            });
        }

        // Handicap tools
        bindTool('tg-tool-contrast', function () {
            a11yState.contrast = !a11yState.contrast;
            if (a11yState.contrast) a11yState.invert = false;
        });

        bindTool('tg-tool-invert', function () {
            a11yState.invert = !a11yState.invert;
            if (a11yState.invert) a11yState.contrast = false;
        });

        bindTool('tg-tool-grayscale', function () {
            a11yState.grayscale = !a11yState.grayscale;
        });

        bindTool('tg-tool-text-size', function () {
            a11yState.fontSize = (a11yState.fontSize + 1) % 3;
        });

        bindTool('tg-tool-dyslexic', function () {
            a11yState.dyslexic = !a11yState.dyslexic;
        });

        bindTool('tg-tool-spacing', function () {
            a11yState.spacing = !a11yState.spacing;
        });

        bindTool('tg-tool-highlight', function () {
            a11yState.highlightLinks = !a11yState.highlightLinks;
        });

        bindTool('tg-tool-cursor', function () {
            a11yState.bigCursor = !a11yState.bigCursor;
        });

        bindTool('tg-tool-stop-anim', function () {
            a11yState.stopAnim = !a11yState.stopAnim;
        });

        bindTool('tg-tool-reading-guide', function () {
            a11yState.readingGuide = !a11yState.readingGuide;
        });

        bindTool('tg-tool-screen-reader', function () {
            a11yState.screenReader = !a11yState.screenReader;
            var speechBar = document.getElementById('tg-speech-bar');
            if (a11yState.screenReader) {
                if (speechBar) speechBar.classList.add('is-visible');
                var welcome = currentLang === 'es'
                    ? 'Lector de voz activado. Toque cualquier platillo o texto para escucharlo.'
                    : 'Voice reader activated. Tap any item or text to hear it.';
                speakText(welcome, null);
            } else {
                stopSpeaking();
                if (speechBar) speechBar.classList.remove('is-visible');
            }
        });

        var pageReaderBtn = document.getElementById('tg-tool-page-reader');
        if (pageReaderBtn) {
            pageReaderBtn.addEventListener('click', function () {
                readFullPage();
            });
        }

        var stopSpeechBtn = document.getElementById('tg-speech-stop-btn');
        if (stopSpeechBtn) {
            stopSpeechBtn.addEventListener('click', function () {
                stopSpeaking();
            });
        }

        // Global click-to-speak handler for screenReader mode
        document.addEventListener('click', function (e) {
            if (!a11yState.screenReader) return;

            // Do not read clicks inside compliance widgets/dialogs
            if (e.target.closest('#tg-a11y-panel') ||
                e.target.closest('#tg-a11y-trigger') ||
                e.target.closest('#tg-speech-bar') ||
                e.target.closest('#tg-cookie-banner') ||
                e.target.closest('#tg-cookie-modal') ||
                e.target.closest('#cookie-banner')) {
                return;
            }

            var target = e.target;
            var readable = target.closest('button, a, h1, h2, h3, h4, h5, h6, p, li, [role="button"], [role="tab"], .menu-item, .location-card, img');
            if (!readable) readable = target;

            var textToRead = '';
            if (readable.tagName === 'IMG') {
                textToRead = readable.getAttribute('alt') || (currentLang === 'es' ? 'Fotografía de platillo' : 'Dish photograph');
            } else {
                textToRead = (readable.getAttribute('aria-label') || readable.innerText || readable.textContent || '').trim();
            }

            if (textToRead && textToRead.length > 0) {
                speakText(textToRead, readable);
            }
        }, true);

        // Reset A11y
        var resetBtn = document.getElementById('tg-a11y-reset');
        if (resetBtn) {
            resetBtn.addEventListener('click', function () {
                a11yState = {
                    contrast: false,
                    invert: false,
                    grayscale: false,
                    fontSize: 0,
                    dyslexic: false,
                    spacing: false,
                    highlightLinks: false,
                    bigCursor: false,
                    stopAnim: false,
                    readingGuide: false,
                    screenReader: false
                };
                stopSpeaking();
                var speechBar = document.getElementById('tg-speech-bar');
                if (speechBar) {
                    speechBar.classList.remove('is-visible');
                }
                saveA11yState();
                applyA11yToDOM();
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
            });
        }

        // Close on escape key
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' || e.keyCode === 27) {
                closeA11yPanel();
                closeCookieModal();
                if (stmtModal) stmtModal.style.display = 'none';
            }
        });

        // Close on click outside panel
        document.addEventListener('click', function (e) {
            var panel = document.getElementById('tg-a11y-panel');
            var trigger = document.getElementById('tg-a11y-trigger');
            var stmtModal = document.getElementById('tg-statement-modal');
            if (stmtModal && (stmtModal === e.target || stmtModal.contains(e.target))) return;
            if (panel && panel.classList.contains('is-open')) {
                if (!panel.contains(e.target) && !trigger.contains(e.target)) {
                    closeA11yPanel();
                }
            }
        });

        // Cookie Banner buttons (both new and legacy IDs)
        var acceptBtns = [document.getElementById('tg-btn-accept-all'), document.getElementById('cookie-accept-btn')];
        acceptBtns.forEach(function (btn) {
            if (btn) {
                btn.addEventListener('click', function () {
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
                btn.addEventListener('click', function () {
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

                saveCookieConsent(cookieConsent.marketing && !cookieConsent.doNotSell ? 'accepted' : 'declined');
                applyTrackingConsent();
                closeCookieModal();
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

    /* ==========================================================
       10. FIRST-PARTY WEBSITE ANALYTICS & ORDER CLICK TRACKER
       ========================================================== */
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

    function getSessionId() {
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
        try {
            // Skip tracking when loaded inside an admin preview iframe
            if (window.self !== window.top) return;
            if (window.location.pathname.indexOf('/api/web-preview') === 0) return;

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
        // 1. Check Toast URL code
        var codes = Object.keys(TOAST_CODE_TO_STORE);
        for (var i = 0; i < codes.length; i++) {
            if (href.indexOf(codes[i]) !== -1) {
                return TOAST_CODE_TO_STORE[codes[i]];
            }
        }
        // 2. Check tel: number
        if (href.indexOf('tel:') === 0) {
            var digits = href.replace(/\D/g, '').slice(-10);
            if (PHONE_TO_STORE[digits]) return PHONE_TO_STORE[digits];
        }
        // 3. Check closest store-card [data-store]
        if (el && el.closest) {
            var card = el.closest('[data-store]');
            if (card) {
                var slug = card.getAttribute('data-store');
                if (SLUG_TO_STORE[slug]) return SLUG_TO_STORE[slug];
            }
            var locCard = el.closest('.location-card');
            if (locCard) {
                var detLink = locCard.querySelector('a[href*="/locations/"]');
                if (detLink) {
                    var m = (detLink.getAttribute('href') || '').match(/\/locations\/([a-z0-9-]+)\/?/i);
                    if (m && SLUG_TO_STORE[m[1]]) return SLUG_TO_STORE[m[1]];
                }
            }
        }
        // 4. Check URL query ?store= or current pathname /locations/{slug}/
        try {
            var qStore = new URLSearchParams(window.location.search).get('store');
            if (qStore && SLUG_TO_STORE[qStore]) return SLUG_TO_STORE[qStore];
            var pathMatch = window.location.pathname.match(/\/locations\/([a-z0-9-]+)\/?/i);
            if (pathMatch && SLUG_TO_STORE[pathMatch[1]]) return SLUG_TO_STORE[pathMatch[1]];
        } catch (e) {}
        // 5. Check address hint in Google Maps link
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

    function initFirstPartyAnalytics() {
        var sessionId = getSessionId();
        var lang = (document.documentElement.lang === 'es' || currentLang === 'es') ? 'es' : 'en';
        var pagePath = window.location.pathname || '/';
        var storeFromUrl = detectStoreFromElementOrHref(null, window.location.href);

        // 1. Track Initial Page View
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

        // 2. Track Outbound Order Clicks, Phone Calls, Directions, and Store Details Modal
        document.addEventListener('click', function (e) {
            var link = e.target && e.target.closest ? e.target.closest('a') : null;
            if (!link) return;
            var href = link.getAttribute('href') || '';
            if (!href) return;

            var activeLang = (document.documentElement.lang === 'es' || currentLang === 'es') ? 'es' : 'en';
            var lowerHref = href.toLowerCase();

            // Check if user opened a Store Details modal (/locations/{slug}/ or ./{slug}/)
            var modalMatch = href.match(/(?:^\/locations\/|^\.\/)([a-z0-9-]+)\/?$/i);
            if (modalMatch && SLUG_TO_STORE[modalMatch[1]]) {
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

    /* ==========================================================
       11. PUBLIC API & INITIALIZATION
       ========================================================== */
    window._tgOpenA11y = openA11yPanel;
    window._tgCloseA11y = closeA11yPanel;
    window._tgOpenCookies = openCookieModal;
    window._tgCloseCookies = closeCookieModal;
    window.tgTrackEvent = sendTrackEvent;

    function init() {
        loadSavedState();
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

