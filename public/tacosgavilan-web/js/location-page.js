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
       3. Robust Accessible Mobile Navigation Drawer (with Focus Trap)
       ------------------------------------------------------------- */
    const mobileToggle = document.getElementById('mobile-menu-toggle');
    const nav = document.getElementById('mobile-navigation') || document.getElementById('nav');
    const navDrawerClose = document.getElementById('nav-drawer-close');

    let focusTrapCleanup = null;
    const trapFocus = (container) => {
        if (focusTrapCleanup) focusTrapCleanup();
        const getFocusable = () => Array.from(container.querySelectorAll(
            'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )).filter(el => el.offsetParent !== null);

        const handleTab = (e) => {
            if (e.key !== 'Tab') return;
            const focusable = getFocusable();
            if (focusable.length === 0) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        };

        container.addEventListener('keydown', handleTab);
        focusTrapCleanup = () => {
            container.removeEventListener('keydown', handleTab);
            focusTrapCleanup = null;
        };
    };

    const releaseFocus = () => {
        if (focusTrapCleanup) focusTrapCleanup();
    };

    if (mobileToggle && nav) {
        const navLinks = nav.querySelectorAll('.nav-link, a');

        const syncNavAccessibility = () => {
            const isOpen = nav.classList.contains('is-open') || nav.classList.contains('nav-open');
            if (window.innerWidth > 768) {
                nav.removeAttribute('aria-hidden');
            } else {
                nav.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
            }
        };
        syncNavAccessibility();

        const openMenu = () => {
            const isEs = document.documentElement.lang === 'es';
            nav.classList.add('is-open', 'nav-open', 'mobile-menu-open');
            mobileToggle.classList.add('active', 'is-open');
            mobileToggle.setAttribute('aria-expanded', 'true');
            mobileToggle.setAttribute('aria-label', isEs ? 'Cerrar menú de navegación' : 'Close navigation menu');
            nav.setAttribute('aria-hidden', 'false');
            document.body.classList.add('mobile-menu-open', 'menu-open');
            trapFocus(nav);

            const firstFocusable = nav.querySelector('button, a');
            if (firstFocusable) {
                setTimeout(() => firstFocusable.focus(), 60);
            }
        };

        const closeMenu = () => {
            if (!nav.classList.contains('is-open') && !nav.classList.contains('nav-open')) return;
            const isEs = document.documentElement.lang === 'es';
            nav.classList.remove('is-open', 'nav-open', 'mobile-menu-open');
            mobileToggle.classList.remove('active', 'is-open');
            mobileToggle.setAttribute('aria-expanded', 'false');
            mobileToggle.setAttribute('aria-label', isEs ? 'Abrir menú de navegación' : 'Open navigation menu');
            syncNavAccessibility();
            document.body.classList.remove('mobile-menu-open', 'menu-open');
            releaseFocus();

            if (mobileToggle && window.innerWidth <= 768) {
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
            syncNavAccessibility();
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

    /* -------------------------------------------------------------
       4. Footer Marquee Infinite Loop (iOS Safari / WebKit Hardened)
       ------------------------------------------------------------- */
    const marquee = document.querySelector('.footer-marquee');
    if (marquee && !marquee.classList.contains('js-footer-marquee-ready')) {
        let track = marquee.querySelector('.footer-marquee-track');
        if (track) {
            let sets = Array.from(track.querySelectorAll('.footer-marquee-set'));
            if (sets.length > 0) {
                while (sets.length < 3) {
                    const clone = sets[0].cloneNode(true);
                    clone.setAttribute('aria-hidden', 'true');
                    track.appendChild(clone);
                    sets = Array.from(track.querySelectorAll('.footer-marquee-set'));
                }
                marquee.classList.add('js-footer-marquee-ready');
                sets.forEach(s => {
                    s.style.animation = 'none';
                    s.style.webkitAnimation = 'none';
                });
                let setWidth = 0;
                let offsetX = 0;
                let lastFrameTime = performance.now();
                const footerSpeed = 0.042;
                const updateFooterMeasurements = () => {
                    const rectW = sets[0].getBoundingClientRect().width || sets[0].offsetWidth || sets[0].scrollWidth;
                    if (rectW > 0) setWidth = rectW;
                };
                updateFooterMeasurements();
                window.addEventListener('load', updateFooterMeasurements);
                window.addEventListener('resize', updateFooterMeasurements, { passive: true });
                const tickFooter = (now) => {
                    const dt = Math.min(64, Math.max(1, now - lastFrameTime));
                    lastFrameTime = now;
                    if (setWidth <= 0) updateFooterMeasurements();
                    const stopAnim = document.documentElement.classList.contains('tg-stop-animations');
                    if (!stopAnim && setWidth > 0) {
                        offsetX -= footerSpeed * dt;
                        if (offsetX <= -setWidth) offsetX = offsetX % setWidth;
                        const tx = 'translate3d(' + offsetX.toFixed(2) + 'px, 0, 0)';
                        for (let i = 0; i < sets.length; i++) {
                            sets[i].style.webkitTransform = tx;
                            sets[i].style.transform = tx;
                        }
                    }
                    requestAnimationFrame(tickFooter);
                };
                requestAnimationFrame(tickFooter);
            }
        }
    }
});
