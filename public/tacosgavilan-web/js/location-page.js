/**
 * @module TacosGavilan/LocationPage
 * @description Provides bilingual EN/ES translation engine and accessible mobile drawer navigation
 * for static restaurant landing pages, 404 error page, and legal policy pages.
 * @businessRules Toast remains the exclusive ordering destination; store facts stay in static HTML.
 * @dataFlow Reads data-en/data-es attributes and persists language preference via safeStorage.
 * @notes Accessible without JS; progressive enhancement adds smooth client-side interactions.
 */

document.addEventListener('DOMContentLoaded', () => {
    /* -------------------------------------------------------------
       1. Safe Storage Helper
       ------------------------------------------------------------- */
    const safeStorage = {
        get(key) {
            try { return localStorage.getItem(key); } catch (e) { return null; }
        },
        set(key, value) {
            try { localStorage.setItem(key, value); } catch (e) {}
        }
    };

    /* -------------------------------------------------------------
       2. Bilingual Language Toggle Engine
       ------------------------------------------------------------- */
    const toggle = document.getElementById('location-lang-toggle') || document.getElementById('lang-toggle');

    const applyLanguage = (language) => {
        const lang = language === 'es' ? 'es' : 'en';
        document.documentElement.lang = lang;

        document.querySelectorAll('[data-en][data-es]').forEach((element) => {
            element.innerHTML = element.dataset[lang];
        });

        document.querySelectorAll('[data-en-aria][data-es-aria]').forEach((element) => {
            element.setAttribute('aria-label', lang === 'es' ? element.dataset.esAria : element.dataset.enAria);
        });

        document.querySelectorAll('[data-en-placeholder][data-es-placeholder]').forEach((element) => {
            element.placeholder = lang === 'es' ? element.dataset.esPlaceholder : element.dataset.enPlaceholder;
        });

        if (toggle) {
            toggle.textContent = lang === 'es' ? 'EN' : 'ES';
            toggle.setAttribute('aria-label', lang === 'es' ? 'Switch language to English' : 'Cambiar idioma a Español');
        }

        safeStorage.set('tacosgavilan_lang', lang);
    };

    applyLanguage(safeStorage.get('tacosgavilan_lang') || 'en');

    if (toggle) {
        toggle.addEventListener('click', () => {
            applyLanguage(document.documentElement.lang === 'es' ? 'en' : 'es');
        });
    }

    /* -------------------------------------------------------------
       3. Robust Accessible Mobile Navigation Drawer
       ------------------------------------------------------------- */
    const mobileToggle = document.getElementById('mobile-menu-toggle');
    const nav = document.getElementById('mobile-navigation') || document.getElementById('nav');
    const navDrawerClose = document.getElementById('nav-drawer-close');

    if (mobileToggle && nav) {
        const navLinks = nav.querySelectorAll('.nav-link, a');

        const openMenu = () => {
            nav.classList.add('is-open', 'nav-open', 'mobile-menu-open');
            mobileToggle.classList.add('active', 'is-open');
            mobileToggle.setAttribute('aria-expanded', 'true');
            mobileToggle.setAttribute('aria-label', 'Close navigation menu');
            nav.setAttribute('aria-hidden', 'false');
            document.body.classList.add('mobile-menu-open', 'menu-open');

            const firstFocusable = nav.querySelector('a, button');
            if (firstFocusable) {
                setTimeout(() => firstFocusable.focus(), 60);
            }
        };

        const closeMenu = () => {
            if (!nav.classList.contains('is-open') && !nav.classList.contains('nav-open')) return;
            nav.classList.remove('is-open', 'nav-open', 'mobile-menu-open');
            mobileToggle.classList.remove('active', 'is-open');
            mobileToggle.setAttribute('aria-expanded', 'false');
            mobileToggle.setAttribute('aria-label', 'Open navigation menu');
            nav.setAttribute('aria-hidden', 'true');
            document.body.classList.remove('mobile-menu-open', 'menu-open');

            if (mobileToggle) {
                mobileToggle.focus();
            }
        };

        mobileToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            if (nav.classList.contains('is-open') || nav.classList.contains('nav-open')) {
                closeMenu();
            } else {
                openMenu();
            }
        });

        if (navDrawerClose) {
            navDrawerClose.addEventListener('click', (e) => {
                e.stopPropagation();
                closeMenu();
            });
        }

        // Close on internal link click
        navLinks.forEach(link => {
            link.addEventListener('click', () => {
                closeMenu();
            });
        });

        // Close on outside click
        document.addEventListener('click', (e) => {
            if ((nav.classList.contains('is-open') || nav.classList.contains('nav-open')) &&
                !nav.contains(e.target) &&
                !mobileToggle.contains(e.target)) {
                closeMenu();
            }
        });

        // Close on Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && (nav.classList.contains('is-open') || nav.classList.contains('nav-open'))) {
                closeMenu();
            }
        });

        // Close on desktop resize
        window.addEventListener('resize', () => {
            if (window.innerWidth > 768 && (nav.classList.contains('is-open') || nav.classList.contains('nav-open'))) {
                closeMenu();
            }
        });

        // Close when switching language
        if (toggle) {
            toggle.addEventListener('click', () => {
                if (nav.classList.contains('is-open') || nav.classList.contains('nav-open')) {
                    closeMenu();
                }
            });
        }
    }
});
