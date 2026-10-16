/**
 * @module TacosGavilan/Main
 * @description Official client-side animation engine, bilingual translation controller (EN/ES),
 * interactive Google Maps store locator with controlled retry and accessible fallback card,
 * accessible dialog overlays (WCAG 2.2 AA compliant focus traps), and live serverless contact pipeline.
 *
 * @businessRules
 *   1. Toast POS (order.online) is the exclusive transactional ordering system for Tacos Gavilan.
 *      All corporate CTAs (Header, Hero, Mobile Drawer, Sticky Bottom Bar, Footer) route to the
 *      corporate selector: https://order.online/business/-137616.
 *   2. Exactly 15 active Southern California locations. Slauson maps to Store ID 23989119, LA Broadway
 *      to 260769, and West Covina to canonical 725035.
 *   3. Strict brand name: strictly "Tacos Gavilan" (zero "El Gavilan", zero emojis).
 *   4. Full bilingual support (EN/ES) persisted via safeStorage['tacosgavilan_lang'].
 *   5. Contact form routes asynchronously to Vercel Serverless /api/contact, guarded with
 *      in-memory rate limiting and honeypot bot trap, persisting to Supabase public.customer_feedback.
 *   6. Pre-processed WebP assets; zero runtime canvas pixel scanning on main thread.
 *
 * @dataFlow
 *   - data/stores.json -> static HTML cards in index.html & gavilanLocations markers.
 *   - #contact-form -> POST /api/contact -> Supabase public.customer_feedback.
 *   - Google Maps API -> Interactive locator with dark/light/satellite themes and 15-store fallback card.
 *
 * @notes
 *   - Slauson / LA Broadway store ID collision resolved (Slauson assigned 23989119).
 *   - Fixed translation text node replacement to prevent destroying child SVGs.
 *   - Enhanced keyboard accessibility (WCAG 2.2 AA) with roving tabindex and focus traps.
 *   - Protected storage access with safeStorage helper against Private Browsing exceptions.
 *   - Privacy modal uses one trigger path so focus returns to the original contact link.
 *   - Google Maps loads only after the visitor opens the locator and falls back if tiles never load.
 *   - Location-page legal links can deep-link to the matching accessible homepage dialog.
 */

document.addEventListener('DOMContentLoaded', () => {

    /* ==========================================================
       0. SHARED STATE, SAFE STORAGE & FOCUS MANAGEMENT
       ========================================================== */
    const safeStorage = {
        getItem: (key) => {
            try { return localStorage.getItem(key); } catch (e) { return null; }
        },
        setItem: (key, val) => {
            try { localStorage.setItem(key, val); } catch (e) {}
        },
        removeItem: (key) => {
            try { localStorage.removeItem(key); } catch (e) {}
        }
    };

    const savedLang = safeStorage.getItem('tacosgavilan_lang');
    let currentLang = (savedLang === 'es' || savedLang === 'en') ? savedLang : 'en';
    const isDesktop = window.matchMedia('(pointer: fine)').matches;

    // Focus trap manager for WCAG 2.2 AA modal and drawer compliance
    let trapKeyHandler = null;
    let previousActiveElement = null;

    const trapFocus = (container) => {
        if (!container) return;
        previousActiveElement = document.activeElement;

        const focusables = Array.from(container.querySelectorAll(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )).filter(el => el.offsetWidth > 0 || el.offsetHeight > 0 || el === document.activeElement);

        const firstEl = focusables[0];
        const lastEl = focusables[focusables.length - 1];

        // Isolate background landmarks from screen readers and keyboard navigation
        const landmarks = ['#header', '#main-content', '#footer'];
        landmarks.forEach(sel => {
            const el = document.querySelector(sel);
            if (el && !container.contains(el) && !el.contains(container)) {
                el.setAttribute('inert', '');
            }
        });

        if (trapKeyHandler) document.removeEventListener('keydown', trapKeyHandler);

        trapKeyHandler = (e) => {
            if (e.key !== 'Tab') return;
            if (e.shiftKey) {
                if (document.activeElement === firstEl) {
                    e.preventDefault();
                    if (lastEl) lastEl.focus();
                }
            } else {
                if (document.activeElement === lastEl) {
                    e.preventDefault();
                    if (firstEl) firstEl.focus();
                }
            }
        };

        document.addEventListener('keydown', trapKeyHandler);
        if (firstEl) firstEl.focus();
    };

    const releaseFocus = (returnFocus = true) => {
        if (trapKeyHandler) {
            document.removeEventListener('keydown', trapKeyHandler);
            trapKeyHandler = null;
        }

        const landmarks = ['#header', '#main-content', '#footer'];
        landmarks.forEach(sel => {
            const el = document.querySelector(sel);
            if (el) el.removeAttribute('inert');
        });

        if (returnFocus && previousActiveElement && typeof previousActiveElement.focus === 'function') {
            try {
                previousActiveElement.focus({ preventScroll: true });
            } catch (_) {
                previousActiveElement.focus();
            }
        }
        previousActiveElement = null;
    };

    /* ==========================================================
       1. FOOTER DYNAMIC COPYRIGHT YEAR
       ========================================================== */
    const yearEl = document.getElementById('year');
    if (yearEl) yearEl.textContent = new Date().getFullYear();

    /* ==========================================================
       2. SCROLL PROGRESS BAR
       ========================================================== */
    const scrollProgressEl = document.getElementById('scroll-progress');
    let scrollTicking = false;

    const updateScrollProgress = () => {
        if (!scrollProgressEl) return;
        const docHeight = document.documentElement.scrollHeight;
        const winHeight = window.innerHeight;
        const scrollable = docHeight - winHeight;
        if (scrollable <= 0) {
            scrollProgressEl.style.width = '0%';
            return;
        }
        const pct = (window.scrollY / scrollable) * 100;
        scrollProgressEl.style.width = `${Math.min(pct, 100)}%`;
    };

    if (scrollProgressEl) {
        window.addEventListener('scroll', () => {
            if (!scrollTicking) {
                requestAnimationFrame(() => {
                    updateScrollProgress();
                    scrollTicking = false;
                });
                scrollTicking = true;
            }
        }, { passive: true });
        updateScrollProgress();
    }

    /* ==========================================================
       3. HEADER SCROLL FROSTED GLASS EFFECT
       ========================================================== */
    const header = document.getElementById('header');

    const handleHeaderScroll = () => {
        if (!header) return;
        if (window.scrollY > 40) {
            header.classList.add('scrolled');
        } else {
            header.classList.remove('scrolled');
        }
    };

    window.addEventListener('scroll', handleHeaderScroll, { passive: true });
    handleHeaderScroll();

    /* ==========================================================
       4. MOBILE MENU & ACCESSIBLE DRAWER CONTROLLER
       ========================================================== */
    const mobileToggle = document.getElementById('mobile-menu-toggle');
    const nav = document.getElementById('mobile-navigation') || document.getElementById('nav');
    const navDrawerClose = document.getElementById('nav-drawer-close');

    const openMenu = () => {
        if (!mobileToggle || !nav) return;
        nav.classList.add('is-open', 'nav-open', 'mobile-menu-open');
        mobileToggle.classList.add('active', 'is-open');
        mobileToggle.setAttribute('aria-expanded', 'true');
        mobileToggle.setAttribute('aria-label', currentLang === 'es' ? 'Cerrar menú de navegación' : 'Close navigation menu');
        nav.setAttribute('aria-hidden', 'false');
        document.body.classList.add('mobile-menu-open', 'menu-open');

        const firstFocusable = nav.querySelector('a, button');
        if (firstFocusable) {
            setTimeout(() => firstFocusable.focus(), 60);
        }
        trapFocus(nav);
    };

    const closeMenu = (returnFocus = true) => {
        if (!nav) return;
        if (!nav.classList.contains('is-open') && !nav.classList.contains('nav-open')) return;
        nav.classList.remove('is-open', 'nav-open', 'mobile-menu-open');
        if (mobileToggle) {
            mobileToggle.classList.remove('active', 'is-open');
            mobileToggle.setAttribute('aria-expanded', 'false');
            mobileToggle.setAttribute('aria-label', currentLang === 'es' ? 'Abrir menú de navegación' : 'Open navigation menu');
        }
        nav.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('mobile-menu-open', 'menu-open');
        releaseFocus(returnFocus);

        if (returnFocus && mobileToggle) {
            try {
                mobileToggle.focus({ preventScroll: true });
            } catch (_) {
                mobileToggle.focus();
            }
        }
    };

    // Expose closeMenu for modals and external triggers
    window._closeGavilanMobileMenu = closeMenu;

    if (mobileToggle && nav) {
        mobileToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            if (nav.classList.contains('is-open') || nav.classList.contains('nav-open')) {
                closeMenu(true);
            } else {
                openMenu();
            }
        });

        if (navDrawerClose) {
            navDrawerClose.addEventListener('click', () => closeMenu(true));
        }

        // Close on internal link click without fighting navigation focus
        nav.querySelectorAll('.nav-link, a').forEach(link => {
            link.addEventListener('click', () => {
                closeMenu(false);
            });
        });

        // Close on outside click (excluding lang-toggle so users can toggle language inside drawer)
        document.addEventListener('click', (e) => {
            if ((nav.classList.contains('is-open') || nav.classList.contains('nav-open')) &&
                !nav.contains(e.target) &&
                !mobileToggle.contains(e.target) &&
                !e.target.closest('#lang-toggle')) {
                closeMenu(true);
            }
        });

        // Close on Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && (nav.classList.contains('is-open') || nav.classList.contains('nav-open'))) {
                closeMenu();
            }
        });

        // Close on resize to desktop (> 768px)
        window.addEventListener('resize', () => {
            if (window.innerWidth > 768 && (nav.classList.contains('is-open') || nav.classList.contains('nav-open'))) {
                closeMenu();
            }
        });
    }

    /* ==========================================================
       5. SMOOTH ANCHOR SCROLLING (OFFSET FOR FIXED HEADER)
       ========================================================== */
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function(e) {
            const targetId = this.getAttribute('href');
            if (targetId === '#' || !targetId.startsWith('#')) return;

            const targetElement = document.querySelector(targetId);
            if (targetElement) {
                e.preventDefault();
                const headerHeight = header ? header.offsetHeight : 70;
                const elementPosition = targetElement.getBoundingClientRect().top;
                const offsetPosition = Math.max(0, elementPosition + window.scrollY - headerHeight);

                window.scrollTo({
                    top: offsetPosition,
                    behavior: 'smooth'
                });

                // Accessible focus
                targetElement.setAttribute('tabindex', '-1');
                targetElement.focus({ preventScroll: true });
            }
        });
    });

    /* ==========================================================
       6. SCROLL REVEAL ANIMATIONS (INTERSECTION OBSERVER)
       ========================================================== */
    const animSelector = '.animate-up, .fade-in-up, .fade-in-left, .fade-in-right, .fade-in, .text-reveal';
    const animElements = document.querySelectorAll(animSelector);

    const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (!prefersReducedMotion && 'IntersectionObserver' in window && animElements.length > 0) {
        try {
            document.documentElement.classList.add('js-animations-enabled');

            const revealElement = (el) => {
                el.classList.add('is-visible');
                el.classList.add('is-revealed');
            };

            const revealObserver = new IntersectionObserver((entries, observer) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting || entry.boundingClientRect.top < window.innerHeight) {
                        revealElement(entry.target);
                        observer.unobserve(entry.target);
                    }
                });
            }, {
                root: null,
                rootMargin: '0px 0px 80px 0px',
                threshold: 0.01
            });

            animElements.forEach(el => {
                const rect = el.getBoundingClientRect();
                const isHero = el.closest('.hero, #home, #hero') !== null;
                const isInInitialViewport = rect.top < (window.innerHeight || document.documentElement.clientHeight);

                if (isHero || isInInitialViewport) {
                    revealElement(el);
                } else {
                    revealObserver.observe(el);
                }
            });

            const safetyCheck = () => {
                const vh = window.innerHeight || document.documentElement.clientHeight;
                animElements.forEach(el => {
                    if (!el.classList.contains('is-visible')) {
                        const r = el.getBoundingClientRect();
                        if (r.top < vh + 100) {
                            revealElement(el);
                            revealObserver.unobserve(el);
                        }
                    }
                });
            };

            window.addEventListener('load', safetyCheck, { once: true });
            setTimeout(safetyCheck, 500);

        } catch (err) {
            console.warn('Scroll reveal observer error, revealing all elements:', err);
            animElements.forEach(el => {
                el.classList.add('is-visible');
                el.classList.add('is-revealed');
            });
            document.documentElement.classList.remove('js-animations-enabled');
        }
    } else {
        animElements.forEach(el => {
            el.classList.add('is-visible');
            el.classList.add('is-revealed');
        });
    }

    /* ==========================================================
       7. MENU CATEGORY TABS & ARIA TABLIST FILTERING
       Smooth Cross-Fade Transition, Roving Tabindex & Rapid Clicks Safe
       ========================================================== */
    const menuTabs = Array.from(document.querySelectorAll('.menu-tab'));
    const menuItems = Array.from(document.querySelectorAll('.menu-item'));
    const menuGrid = document.getElementById('menu-grid');
    let isMenuTransitioning = false;
    let menuFadeOutTimer = null;
    let menuReleaseTimer = null;

    function filterMenuCategory(category, isImmediate = false) {
        if (!menuGrid || menuItems.length === 0) return;

        // Cancel any pending transition timers from rapid clicks
        if (menuFadeOutTimer) {
            clearTimeout(menuFadeOutTimer);
            menuFadeOutTimer = null;
        }
        if (menuReleaseTimer) {
            clearTimeout(menuReleaseTimer);
            menuReleaseTimer = null;
        }

        // Update active tab & ARIA attributes with roving tabindex
        menuTabs.forEach(t => {
            const isSelected = t.getAttribute('data-category') === category;
            t.classList.toggle('active', isSelected);
            t.setAttribute('aria-selected', isSelected ? 'true' : 'false');
            t.setAttribute('tabindex', isSelected ? '0' : '-1');
            if (isSelected && t.id) {
                menuGrid.setAttribute('aria-labelledby', t.id);
            }
        });

        if (isImmediate) {
            menuItems.forEach(item => {
                const itemCat = item.getAttribute('data-category');
                if (category === 'all' || itemCat === category) {
                    item.style.display = '';
                    item.style.opacity = '1';
                    item.style.transform = 'translateY(0) scale(1)';
                    item.classList.remove('category-hidden');
                    item.classList.add('category-visible');
                } else {
                    item.style.display = 'none';
                    item.style.opacity = '0';
                    item.classList.add('category-hidden');
                    item.classList.remove('category-visible');
                }
            });
            isMenuTransitioning = false;
            return;
        }

        // Lock container height to prevent jarring layout jump during fade-out
        const currentHeight = menuGrid.offsetHeight;
        menuGrid.style.minHeight = `${currentHeight}px`;

        // Phase 1: Smoothly fade out currently visible items
        const visibleItems = menuItems.filter(item => item.style.display !== 'none');
        visibleItems.forEach(item => {
            item.style.transition = 'opacity 0.15s ease, transform 0.15s ease';
            item.style.opacity = '0';
            item.style.transform = 'translateY(8px) scale(0.98)';
        });

        // Phase 2: Switch visibility and stagger fade-in matching items
        menuFadeOutTimer = setTimeout(() => {
            const incomingItems = [];

            menuItems.forEach(item => {
                const itemCat = item.getAttribute('data-category');
                if (category === 'all' || itemCat === category) {
                    item.style.display = '';
                    item.style.opacity = '0';
                    item.style.transform = 'translateY(12px) scale(0.97)';
                    item.classList.remove('category-hidden');
                    item.classList.add('category-visible');
                    incomingItems.push(item);
                } else {
                    item.style.display = 'none';
                    item.style.opacity = '0';
                    item.classList.add('category-hidden');
                    item.classList.remove('category-visible');
                }
            });

            requestAnimationFrame(() => {
                incomingItems.forEach((item, index) => {
                    setTimeout(() => {
                        item.style.transition = 'opacity 0.28s cubic-bezier(0.16, 1, 0.3, 1), transform 0.28s cubic-bezier(0.16, 1, 0.3, 1)';
                        item.style.opacity = '1';
                        item.style.transform = 'translateY(0) scale(1)';
                    }, index * 25);
                });

                menuReleaseTimer = setTimeout(() => {
                    menuGrid.style.transition = 'min-height 0.3s ease';
                    menuGrid.style.minHeight = '';
                    isMenuTransitioning = false;
                }, Math.max(250, incomingItems.length * 25 + 150));
            });
        }, 140);
    }

    if (menuTabs.length > 0 && menuItems.length > 0) {
        menuTabs.forEach((tab, idx) => {
            tab.addEventListener('click', () => {
                tab.focus();
                if (tab.classList.contains('active')) return;
                const category = tab.getAttribute('data-category');
                filterMenuCategory(category, false);
            });

            // Arrow key navigation (roving tabindex)
            tab.addEventListener('keydown', (e) => {
                let targetIdx = null;
                if (e.key === 'ArrowRight') {
                    targetIdx = (idx + 1) % menuTabs.length;
                } else if (e.key === 'ArrowLeft') {
                    targetIdx = (idx - 1 + menuTabs.length) % menuTabs.length;
                } else if (e.key === 'Home') {
                    targetIdx = 0;
                } else if (e.key === 'End') {
                    targetIdx = menuTabs.length - 1;
                }

                if (targetIdx !== null) {
                    e.preventDefault();
                    const targetTab = menuTabs[targetIdx];
                    targetTab.click();
                    targetTab.focus();
                }
            });
        });

        // Pre-select and filter 'tacos' by default on page load!
        filterMenuCategory('tacos', true);
    }

    /* ==========================================================
       8. ANIMATED STATS COUNTERS (EASE-OUT CUBIC)
       ========================================================== */
    const counters = document.querySelectorAll('.counter');

    if (counters.length > 0 && 'IntersectionObserver' in window) {
        const animateCounter = (el) => {
            const target = parseInt(el.getAttribute('data-target'), 10);
            if (isNaN(target)) return;

            const duration = 1800;
            const startVal = target === 1992 ? 1980 : 0;
            let startTime = null;

            const step = (timestamp) => {
                if (!startTime) startTime = timestamp;
                const elapsed = timestamp - startTime;
                const progress = Math.min(elapsed / duration, 1);
                const eased = 1 - Math.pow(1 - progress, 3);
                const currentValue = Math.round(startVal + eased * (target - startVal));

                el.textContent = currentValue;

                if (progress < 1) {
                    requestAnimationFrame(step);
                } else {
                    el.textContent = target;
                }
            };

            requestAnimationFrame(step);
        };

        const counterObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    animateCounter(entry.target);
                    counterObserver.unobserve(entry.target);
                }
            });
        }, { threshold: 0.3 });

        counters.forEach(counter => counterObserver.observe(counter));
    }

    /* ==========================================================
       9. HERO PARALLAX BACKGROUND (DESKTOP / POINTER FINE)
       ========================================================== */
    const heroBgImg = document.querySelector('.hero-bg img');

    if (heroBgImg && isDesktop) {
        const handleParallax = () => {
            const scrolled = window.scrollY;
            if (scrolled < window.innerHeight) {
                heroBgImg.style.transform = `scale(1.08) translateY(${scrolled * 0.25}px)`;
            }
        };
        window.addEventListener('scroll', handleParallax, { passive: true });
    }

    /* ==========================================================
       10. ASYNCHRONOUS CONTACT FORM SUBMISSION ENGINE
       ========================================================== */
    const contactForm = document.getElementById('contact-form');
    const contactStatus = document.getElementById('contact-status');

    if (contactForm) {
        contactForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const submitBtn = document.getElementById('contact-submit-btn') || contactForm.querySelector('button[type="submit"]');
            const btnSpan = submitBtn ? submitBtn.querySelector('span') : null;
            const originalText = btnSpan ? btnSpan.textContent : 'Send Message';

            // Anti-Spam Honeypot check
            const honeypot = contactForm.querySelector('#b_company_website');
            if (honeypot && honeypot.value.trim() !== '') {
                contactForm.reset();
                if (contactStatus) {
                    contactStatus.className = 'contact-status success';
                    contactStatus.textContent = translations[currentLang]['contact.successMsg'];
                }
                return;
            }

            const nameInput = contactForm.querySelector('#name');
            const emailInput = contactForm.querySelector('#email');
            const phoneInput = contactForm.querySelector('#phone');
            const reasonInput = contactForm.querySelector('#reason');
            const storeInput = contactForm.querySelector('#store');
            const messageInput = contactForm.querySelector('#message');

            if (!nameInput.value.trim() || !emailInput.value.trim() || !messageInput.value.trim()) {
                if (contactStatus) {
                    contactStatus.className = 'contact-status error';
                    contactStatus.textContent = currentLang === 'es'
                        ? 'Por favor completa todos los campos obligatorios (*).'
                        : 'Please complete all required fields (*).';
                }
                return;
            }

            if (submitBtn) submitBtn.disabled = true;
            if (btnSpan) btnSpan.textContent = translations[currentLang]['contact.sending'];
            if (contactStatus) {
                contactStatus.className = 'contact-status';
                contactStatus.textContent = '';
            }

            try {
                const payload = {
                    name: nameInput.value.trim(),
                    email: emailInput.value.trim(),
                    phone: phoneInput ? phoneInput.value.trim() : '',
                    reason: reasonInput ? reasonInput.value : 'general',
                    store: storeInput ? storeInput.value : '',
                    message: messageInput.value.trim(),
                    b_company_website: honeypot ? honeypot.value : ''
                };

                const response = await fetch('/api/contact/', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                const result = await response.json();

                if (response.ok && (result.ok || result.success)) {
                    contactForm.reset();
                    if (contactStatus) {
                        contactStatus.className = 'contact-status success';
                        const baseMsg = translations[currentLang]['contact.successMsg'];
                        const refSuffix = result.reference_id
                            ? (currentLang === 'es'
                                ? ` (ID de Confirmación: ${result.reference_id} | Fecha/Hora UTC: ${result.submitted_at || ''})`
                                : ` (Confirmation Reference ID: ${result.reference_id} | UTC Timestamp: ${result.submitted_at || ''})`)
                            : '';
                        contactStatus.textContent = baseMsg + refSuffix;
                    }
                    if (btnSpan) btnSpan.textContent = translations[currentLang]['contact.sent'];
                } else {
                    throw new Error(result.error || 'Server error');
                }
            } catch (err) {
                if (contactStatus) {
                    contactStatus.className = 'contact-status error';
                    contactStatus.textContent = translations[currentLang]['contact.errorMsg'];
                }
            } finally {
                if (submitBtn) submitBtn.disabled = false;
                setTimeout(() => {
                    if (btnSpan) btnSpan.textContent = translations[currentLang]['contact.send'];
                }, 3500);
            }
        });
    }

    /* ==========================================================
       11. BILINGUAL DICTIONARY & SAFE DOM TRANSLATION ENGINE
       ========================================================== */
    const translations = {
        en: {
            'a11y.skipToContent': 'Skip to main content',

            // Navigation
            'nav.home':      'Home',
            'nav.about':     'About',
            'nav.menu':      'Menu',
            'nav.catering':  'Fiesta Platter',
            'nav.locations': 'Locations',
            'nav.contact':   'Contact',
            'nav.blog':      'Blog',
            'nav.hours':     'Hours',
            'nav.order':     'Order Now',

            // Hero
            'hero.badge':    '<span class="badge-part">Tradition Since 1992</span><span class="badge-sep" aria-hidden="true"> · </span><span class="badge-part">15 Locations in Southern California</span>',
            'hero.title':    'Authentic\nMexican Food',
            'hero.subtitle': 'Since 1992 · 15 Locations · Los Angeles & Southern California',
            'hero.orderBtn': 'Order Online',
            'hero.menuBtn':  'View Menu',

            // Showcase
            'showcase.title':       'Traditional Specialties',
            'showcase.asada':       'Tacos de Asada',
            'showcase.burritos':    'Burritos',
            'showcase.mulitas':     'Mulitas',
            'showcase.tortas':      'Tortas',
            'showcase.platos':      'Platos',
            'showcase.sopes':       'Sopes',
            'showcase.nachos':      'Super Nachos',
            'showcase.quesadillas': 'Quesadillas',

            // About
            'about.tag':       'TRADITION & PASSION',
            'about.title':     'Our Story',
            'about.p1':        'Since 1992, Tacos Gavilan has been bringing the authentic taste of Mexico to Los Angeles. What started as a single taqueria has grown into 15 locations serving thousands of families every day.',
            'about.p2':        'We pride ourselves on using traditional recipes and cooking with passion. From our al pastor to our signature salsas, every meal reflects decades of culinary dedication.',
            'about.locations': 'Locations',
            'about.since':     'Since',
            'about.meats':     'Meat Options',

            // Menu (Homepage & Menu Page)
            'menu.tag':        'AUTHENTIC STREET FOOD',
            'menu.title':      'Our Full Menu',
            'menu.subtitle':   'Generational Mexican recipes made fresh daily. Order for pickup at any of our 15 locations.',
            'menu.orderOnlineBtn': 'Order Online',

            // Menu Categories Tabs
            'menu.tab.tacos':       'Tacos',
            'menu.tab.burritos':    'Burritos',
            'menu.tab.quesadillas': 'Quesadillas',
            'menu.tab.mulitas':     'Mulitas',
            'menu.tab.sopes':       'Sopes',
            'menu.tab.tortas':      'Tortas',
            'menu.tab.platos':      'Platos',
            'menu.tab.nachos':      'Nachos',
            'menu.tab.drinks':      'Drinks',

            // Menu Page Food Items
            'menu.tacosTitle':        'Tacos',
            'menu.tacosDesc':         'Served Plain',
            'menu.burritosTitle':     'Burritos & Super Burritos',
            'menu.burritosDesc':      'Wrapped with Rice & Beans · Super includes sour cream, cheese, and guacamole',
            'menu.quesadillasTitle':  'Quesadillas & Super Quesadillas',
            'menu.quesadillasDesc':   'Choice of meat & melted cheese · Super includes sour cream, guacamole, and cheese',
            'menu.sopesTitle':        'Sopes',
            'menu.sopesDesc':         'A thick tortilla topped with beans, sour cream, and cheese',
            'menu.mulitasTitle':      'Mulitas & Super Mulitas',
            'menu.mulitasDesc':       'Meat served in-between two tortillas with melted cheese · Super includes guacamole and sour cream',
            'menu.tortasTitle':       'Tortas',
            'menu.tortasDesc':        'Choice of meat - Lettuce, Tomato, Mayo, Guacamole, Beans, and Cheese',
            'menu.platosTitle':       'Platos',
            'menu.platosDesc':        'Includes a small side salad, rice, beans, guacamole, and tortillas of your choice',
            'menu.nachosTitle':       'Super Nachos',
            'menu.nachosDesc':        'Choice of meat - Nacho cheese, sour cream, and guacamole',

            // Menu Meats Showcase
            'menu.meatsTitle':        'Available Meats',
            'menu.meatsSubtitle':     'Choose your favorite protein for any taco, burrito, quesadilla, mulita, sope, or plato.',
            'menu.meatAsada':         'Asada',
            'menu.meatAsadaSub':      'Grilled Beef',
            'menu.meatPastor':        'Al Pastor',
            'menu.meatPastorSub':     'Marinated Pork',
            'menu.meatPollo':         'Pollo',
            'menu.meatPolloSub':      'Grilled Chicken',
            'menu.meatCarnitas':      'Carnitas',
            'menu.meatCarnitasSub':   'Braised Pork',
            'menu.meatCabeza':        'Cabeza',
            'menu.meatCabezaSub':     'Steamed Beef Head',
            'menu.meatLengua':        'Lengua',
            'menu.meatLenguaSub':     'Steamed Beef Tongue',
            'menu.meatBuche':         'Buche',
            'menu.meatBucheSub':      'Grilled Pork Maw',
            'menu.meatChorizo':       'Chorizo',
            'menu.meatChorizoSub':    'Mexican Sausage',

            // Menu Sides & Drinks
            'menu.sidesTitle':        'Traditional Sides / Guarniciones',
            'menu.sideRice':          'Seasoned red rice',
            'menu.sideBeans':         'Slow-simmered pinto beans',
            'menu.sideGuac':          'Fresh mashed avocados and lime',
            'menu.sideCrema':         'Authentic Mexican sour cream',
            'menu.sideCheese':        'Crumbled Mexican artisan cheese',
            'menu.sideChips':         'House-made chips & roasted salsa',
            'menu.drinksTitle':       'Aguas Frescas & Drinks',
            'menu.drinkHorchata':     'Sweet rice, cinnamon & milk',
            'menu.drinkJamaica':      'Tart hibiscus flower tea',
            'menu.drinkPina':         'Refreshing sweet pineapple agua fresca',
            'menu.drinkTamarindo':    'Tangy tamarind pulp infusion',
            'menu.drinkChampurrado':  'Traditional hot Mexican spiced chocolate',
            'menu.drinkSodas':        'Jarritos, Coca-Cola Mexicana',
            'menu.drinkCoffee':       'Fresh Coffee & Bottled Water',

            // Menu Legacy Individual Keys
            'menu.tacos.name': 'Taco de Asada',
            'menu.tacos.desc': '1 Grilled Beef Taco - Served Plain',
            'menu.tacoPastor.name': 'Tacos al Pastor',
            'menu.tacoPastor.desc': '1 Marinated Pork Taco - Served Plain',
            'menu.tacoPollo.name': 'Tacos de Pollo',
            'menu.tacoPollo.desc': '1 Grilled Chicken Taco - Served Plain',
            'menu.tacoCarnitas.name': 'Tacos de Carnitas',
            'menu.tacoCarnitas.desc': '1 Braised Pork Taco - Served Plain',
            'menu.tacoCabeza.name': 'Tacos de Cabeza',
            'menu.tacoCabeza.desc': '1 Steamed Beef Head Taco - Served Plain',
            'menu.tacoLengua.name': 'Tacos de Lengua',
            'menu.tacoLengua.desc': '1 Steamed Beef Tongue Taco - Served Plain',
            'menu.tacoBuche.name': 'Tacos de Buche',
            'menu.tacoBuche.desc': '1 Grilled Pork Maw Taco - Served Plain',
            'menu.tacoChorizo.name': 'Tacos de Chorizo',
            'menu.tacoChorizo.desc': '1 Mexican Sausage Taco - Served Plain',
            'menu.tacoPlate.name': 'Taco Plate',
            'menu.tacoPlate.desc': 'Three Tacos Of Your Choice - Served Plain - Accompanied By Beans And Rice',
            'menu.burrito.name': 'Burrito',
            'menu.burrito.desc': 'Choice of meat - Wrapped with Rice and Beans',
            'menu.superBurrito.name': 'Super Burrito',
            'menu.superBurrito.desc': 'Choice of meat - Includes rice, beans, sour cream, cheese, and guacamole',
            'menu.quesadilla.name': 'Quesadilla',
            'menu.quesadilla.desc': 'Grilled meat and melted cheese',
            'menu.superQuesadilla.name': 'Super Quesadilla',
            'menu.superQuesadilla.desc': 'Choice of meat - Sour cream, guacamole, and melted cheese',
            'menu.mulita.name': 'Mulita',
            'menu.mulita.desc': 'Meat served in-between two tortillas with melted cheese',
            'menu.superMulita.name': 'Super Mulita',
            'menu.superMulita.desc': 'Meat served in-between two tortillas with melted cheese, guacamole, and sour cream',
            'menu.sopes.name': 'Sopes',
            'menu.sopes.desc': 'A thick tortilla topped with beans, sour cream, and cheese',
            'menu.torta.name': 'Torta',
            'menu.torta.desc': 'Choice of meat - Lettuce, Tomato, Mayo, Guacamole, Beans, and Cheese',
            'menu.plato.name': 'Plato',
            'menu.plato.desc': 'Includes a small side salad, rice, beans, guacamole, and tortillas of your choice',
            'menu.nachos.name': 'Super Nachos',
            'menu.nachos.desc': 'Choice of meat - Nacho cheese, sour cream, and guacamole',
            'menu.horchata.name': 'Agua de Horchata',
            'menu.horchata.desc': 'Sweet rice milk drink with cinnamon and vanilla.',
            'menu.jamaica.name': 'Agua de Jamaica',
            'menu.jamaica.desc': 'Hibiscus flower infusion with a vibrant red hue and a subtly sweet, tart flavor.',
            'menu.pina.name': 'Agua de Piña',
            'menu.pina.desc': 'Refreshing tropical pineapple agua fresca made with sweet, ripe pineapple and served ice-cold.',
            'menu.tamarindo.name': 'Agua de Tamarindo',
            'menu.tamarindo.desc': 'Traditional Mexican tamarind agua fresca, tart, sweet, and served cold over ice.',
            'menu.meatCalloutTitle': 'Available Meats',
            'menu.meatList': 'Asada · Al Pastor · Pollo · Carnitas · Cabeza · Lengua · Buche · Chorizo',
            'menu.meatOptions': '8 Meat Options Available for Every Dish',

            // Fiesta Platter (Homepage & Fiesta Page)
            'fiesta.badge':            'CATERING & BANQUETS',
            'fiesta.title':            'Fiesta Platters',
            'fiesta.subtitle':         'Catering for your special events',
            'fiesta.desc':             'Authentic Mexican food catering for parties, corporate events, and family gatherings. Made fresh and ready to serve.',
            'fiesta.f1':               'Serves 15 to 40 people with generous portions',
            'fiesta.f2':               'Choice of traditional meats, rice, beans & fresh salsas',
            'fiesta.f3':               'Warm handmade corn tortillas included with every order',
            'fiesta.f4':               'Ready for pickup in under 1 hour at your nearest location',
            'fiesta.btn':              'Explore Fiesta Platters',
            'fiesta.heroTitle':        'Our Famous <span>Fiesta Platter</span>',
            'fiesta.heroLead':         'Authentic Mexican taquiza catering made simple! Same-day ordering is available for pickup at all 15 locations. Order as little as 1 hour in advance for group sizes from 15 to 40 people.',
            'fiesta.orderToastBtn':    'Order Online',
            'fiesta.packagesTitle':    'Catering Packages by Group Size',
            'fiesta.packagesSubtitle': 'Each package includes your choice of meats, Mexican rice, refried pinto beans, Agua Fresca, corn or flour tortillas, red & green salsas, condiments, and utensils.',
            'fiesta.pkg15Title':       '15 – 20 People',
            'fiesta.pkg15Desc':        '6 lbs Meat · Medium Rice & Beans · 3 Gallons Agua Fresca',
            'fiesta.pkg20Title':       '20 – 25 People',
            'fiesta.pkg20Desc':        '7.5 lbs Meat · 1/2 Tray Rice & Beans · 4 Gallons Agua Fresca',
            'fiesta.pkg25Title':       '25 – 30 People',
            'fiesta.pkg25Desc':        '10 lbs Meat · 3/4 Tray Rice & Beans · 5 Gallons Agua Fresca',
            'fiesta.pkg30Title':       '30 – 40 People',
            'fiesta.pkg30Desc':        '12 lbs Meat · Full Tray Rice & Beans · 6 Gallons Agua Fresca',
            'fiesta.orderBtn':         'Order Online',
            'fiesta.whatsIncludedTitle': 'What\'s Included in Every Fiesta Platter',
            'fiesta.incMeatsTitle':    'Meat of Choice (6 to 12 lbs)',
            'fiesta.incMeatsDesc':     'Choose from Carne Asada, Pollo (Chicken), or Al Pastor freshly grilled to order.',
            'fiesta.incSidesTitle':    'Mexican Rice & Pinto Beans',
            'fiesta.incSidesDesc':     '3 to 10 lbs of seasoned Mexican rice and 3 to 10 lbs of slow-cooked refried pinto beans.',
            'fiesta.incTortillasTitle':'Corn or Flour Tortillas',
            'fiesta.incTortillasDesc': '2 to 5 packs of Corn Tortillas (10 to 20 Dozen) or 5 to 12 packs of Flour Tortillas (5 to 10 Dozen).',
            'fiesta.incGarnishTitle':  'Salsas & Condiments',
            'fiesta.incGarnishDesc':   'Red & green salsa packets, chopped cilantro & onion packets, limes, and pickled carrots & jalapeños.',
            'fiesta.incUtensilsTitle': 'Plates, Forks, Spoons, Cups & Napkins',
            'fiesta.incUtensilsDesc':  '30 to 50 plates, 15 to 25 forks & spoons, 20 to 40 cups, and 1 to 3 packs of napkins.',
            'fiesta.incChipsTitle':    'Agua Fresca (3 to 6 Gallons)',
            'fiesta.incChipsDesc':     '3 to 6 gallons of Agua Fresca of your choice: Jamaica, Horchata, Piña, or Tamarindo.',
            'fiesta.stepsH2': '5 Easy Steps to Order Your Taquiza',
            'fiesta.s1Title': 'Choose Store',
            'fiesta.s1Desc': 'Select your nearest Tacos Gavilan location for pickup.',
            'fiesta.s2Title': 'Group Size',
            'fiesta.s2Desc': 'Pick the package that matches your guest count (15 to 40+).',
            'fiesta.s3Title': 'Choose Meats',
            'fiesta.s3Desc': 'Select Carne Asada, Pollo (Chicken), or Al Pastor.',
            'fiesta.s4Title': 'Pick Up',
            'fiesta.s4Desc': 'Hot, freshly prepared food ready in as little as 1 hour.',
            'fiesta.s5Title': '¡Disfruta!',
            'fiesta.s5Desc': 'Authentic street taco experience at your event!',
            'fiesta.incTag': 'EVERYTHING INCLUDED',
            'fiesta.incTitle': 'What Comes With Every Fiesta Platter',
            'fiesta.incSubtitle': 'Every Fiesta Platter is prepared fresh to order with exact portions of meats, rice, beans, Agua Fresca, tortillas, salsas, condiments, and complete serving utensils.',
            'fiesta.boxMeatsH': 'Meat of Choice (6 to 12 lbs)',
            'fiesta.boxMeatsP': 'Your choice of freshly grilled Carne Asada, Pollo (Chicken), or Al Pastor served hot in aluminum party trays.',
            'fiesta.boxSidesH': 'Mexican Rice, Beans & Tortillas',
            'fiesta.boxSidesP': 'Traditional Mexican rice (3 to 10 lbs), refried pinto beans (3 to 10 lbs), and warm Corn or Flour tortillas.',
            'fiesta.boxSalsasH': 'Salsas & Condiments',
            'fiesta.boxSalsasP': 'Signature Red & Green salsas, chopped cilantro & white onion packets, fresh limes, and pickled carrots & jalapeños.',
            'fiesta.boxDrinksH': 'Aguas Frescas & Utensils',
            'fiesta.boxDrinksP': '3 to 6 Gallons of Agua Fresca (Jamaica, Horchata, Piña, or Tamarindo) plus plates, forks, spoons, cups, and napkins.',
            'fiesta.exclusiveH3': 'Online Ordering Exclusively',
            'fiesta.exclusiveP': 'To guarantee fast preparation and accurate scheduling, all catering and Fiesta Platter orders are placed exclusively through our official online ordering platform. Select your nearest restaurant, configure your party size, and schedule pickup directly.',
            'fiesta.contactBtn': 'Questions? Contact Us',
            'fiesta.stepsTitle':       'How to Order Your Fiesta Platter in 5 Easy Steps',
            'fiesta.step1Title':       'Choose Your Package Size',
            'fiesta.step1Desc':        'Select from 15-20, 20-25, 25-30, or 30-40 people depending on your guest count.',
            'fiesta.step2Title':       'Pick Your Meats & Fixings',
            'fiesta.step2Desc':        'Select your protein combinations and let us know your tortilla preferences.',
            'fiesta.step3Title':       'Select Your Nearest Store',
            'fiesta.step3Desc':        'Pick from any of our 15 Southern California locations for fast pickup.',
            'fiesta.step4Title':       'Place Order Online',
            'fiesta.step4Desc':        'Order directly online with as little as 1 hour advance notice.',
            'fiesta.step5Title':       'Pickup Hot & Fresh',
            'fiesta.step5Desc':        'Arrive at your chosen location, pick up your packaged trays, and enjoy the party!',

            // Locations (Homepage & Directory)
            'locations.tag':          '15 SOUTHERN CALIFORNIA RESTAURANTS',
            'locations.title':        'Find Your Nearest Tacos Gavilan',
            'locations.subtitle':     '',
            'locations.mapBtn':       'View Interactive Map',
            'locations.mapTitle':     'Interactive Store Locator',
            'locations.orderBtn':     'Order Now',
            'locations.detailsBtn':   'Details',
            'locations.directions':   'Directions',
            'locations.storeDetails': 'Store Details',
            'locations.hoursBadge':   '15 Southern California Locations',
            'locations.hoursOpenDaily': 'Open Daily',
            'locations.searchPlaceholder': 'Search by city, address or zip...',

            // Interactive Map
            'map.findMe':          'Find Me',
            'map.themeDark':       'Dark',
            'map.themeLight':      'Light',
            'map.themeSatellite':  'Satellite',
            'map.errorTitle':      'Map Unavailable',
            'map.errorDesc':       'The interactive map could not be loaded at this time. You can still view store addresses and order online below.',
            'map.retry':           'Retry Map',
            'map.milesFromYou':    'miles from you',
            'map.popupOrder':      'Order Online',
            'map.popupDirections': 'Directions',

            // Contact
            'contact.title':               'Get in Touch',
            'contact.subtitle':            'Have questions about catering, fiesta platters, accessibility, or privacy rights? We\'d love to hear from you.',
            'contact.name':                'Name *',
            'contact.email':               'Email *',
            'contact.phone':               'Phone (Optional)',
            'contact.reason':              'Topic / Request Type *',
            'contact.reasonGeneral':       'General Inquiry',
            'contact.reasonCatering':      'Fiesta / Catering',
            'contact.reasonFeedback':      'Customer Feedback',
            'contact.reasonEmployment':    'Employment / Careers Inquiry',
            'contact.reasonAccessibility': 'Website Accessibility / ADA Assistance',
            'contact.reasonCcpaKnow':      'Privacy Request: Right to Know / Access (CCPA)',
            'contact.reasonCcpaDelete':    'Privacy Request: Right to Delete (CCPA)',
            'contact.reasonCcpaCorrect':   'Privacy Request: Right to Correct (CCPA)',
            'contact.reasonCcpaOptOut':    'Privacy Request: Opt-Out of Sale/Sharing (CCPA)',
            'contact.reasonCcpaAgent':     'Privacy Request: Authorized Agent / Appeal',
            'contact.reasonOther':         'Other Inquiry',
            'contact.store':               'Nearest Store (Optional)',
            'contact.storeSelect':         'Select a location...',
            'contact.message':             'Message *',
            'contact.noticeAtCollection':  '<strong>California Notice at Collection:</strong> We collect the name, email, phone number, store preference, and message you submit solely to respond to your inquiry or process your privacy request. We do not sell or share form submissions for advertising. Please <strong>do not submit sensitive personal information</strong> (such as Social Security numbers, payment card numbers, government IDs, or medical/health details) in this form. Review our <a href="/privacy/#notice-at-collection" style="color:#FFC72C;text-decoration:underline;">Notice at Collection</a>, <a href="/privacy/" style="color:#FFC72C;text-decoration:underline;">Privacy Policy</a>, and <a href="/privacy-choices/" style="color:#FFC72C;text-decoration:underline;">Your Privacy Choices</a>.',
            'contact.privacyNotice':       'By submitting, you agree to our <a href="/privacy/#notice-at-collection" id="contact-privacy-link">Privacy Policy &amp; Notice at Collection</a>.',
            'contact.send':                'Send Message',
            'contact.sending':             'Sending...',
            'contact.sent':                'Message Sent!',
            'contact.successMsg':          'Thank you! Your submission has been received by Tacos Gavilan.',
            'contact.errorMsg':            'Could not send message. Please verify your details or email us at info@tacosgavilan.com.',

            // Contact Page Details
            'contact.tag':                 'Get In Touch',
            'contact.lead':                'Have questions about our menu, catering, dining experience, accessibility, or California privacy rights? Reach out to our corporate team or send us a request below.',
            'contact.guestSupport':        'Guest Support & Inquiries',
            'contact.corporateOffice':     'Corporate Office',
            'contact.addressLabel':        'Headquarters Address',
            'contact.phoneLabel':          'Telephone',
            'contact.emailLabel':          'Email Inquiries & Privacy Requests',
            'contact.storeOrdersLabel':    'Phone Orders & Store Inquiries',
            'contact.storeOrdersDesc':     'To place phone orders or speak directly with a restaurant, please call your nearest location directly.',
            'contact.officeHoursLabel':    'Office Support Hours',
            'contact.officeHoursValue':    'Monday – Friday: 8:00 AM – 5:00 PM',
            'contact.restaurantHoursLabel':'Hours of Operation',
            'contact.restaurantHoursValue':'Open Daily 8:00 AM – Late Night (Hours vary by location)',
            'contact.restaurantHoursDesc': 'Open daily for lunch, dinner, and late night. Hours vary by location with drive-thru service at select stores.',
            'contact.viewAllStores':       'View All 15 Store Locations & Phone Numbers',
            'contact.sendMessageTitle':    'Send Us a Message',
            'contact.fieldName':           'Full Name *',
            'contact.fieldEmail':          'Email Address *',
            'contact.fieldPhone':          'Phone Number (Optional)',
            'contact.fieldStore':          'Store Location (Optional)',
            'contact.fieldType':           'Inquiry Subject / Privacy Request Type',
            'contact.fieldMessage':        'Message *',
            'contact.fieldMessagePlaceholder': 'How can we help you?',
            'contact.submitBtn':           'Send Message',
            'contact.optCorporate':        'Corporate / General Inquiry',
            'contact.optCatering':         'Catering & Fiesta Platters',
            'contact.optFeedback':         'Customer Feedback & Guest Experience',
            'contact.optMedia':            'Corporate & Media',
            'contact.optOther':            'Other',

            // Blog
            'blog.tag':                    'Stories & News',
            'blog.title':                  'Tacos Gavilan Blog',
            'blog.lead':                   'Explore our culinary roots, authentic recipes, holiday fiesta catering guides, and community initiatives in Southern California.',
            'blog.readArticle':            'Read Article →',
            'blog.post1Title': 'The Best Champurrado Near Me',
            'blog.post1Desc': 'During a chilly night, nothing beats peak coziness with a warm cup of authentic Mexican champurrado. Discover the history and where to find the best champurrado in Southern California.',
            'blog.post2Title': 'Mexico Celebrates with a Taquiza',
            'blog.post2Desc': 'Taquiza, also known as a taco party, is a highlight of gatherings, celebrations, holidays, and family in the Mexican tradition. Learn how the Taquiza tradition is reborn in Los Angeles.',
            'blog.post3Title': 'History of Tacos Gavilan',
            'blog.post3Desc': 'Founded on the corner of Gage & Main in Los Angeles in 1992, Tacos Gavilan has grown into a beloved Southern California fast-casual Mexican food icon across 15 locations.',
            'blog.post4Title': 'First Annual Taco Eating Contest Celebrates Hispanic Heritage Month',
            'blog.post4Desc': 'Tacos Gavilan celebrated Hispanic Heritage Month with its first annual taco eating contest, bringing together the community and donating to local educational programs.',
            'blog.post5Title': 'Tacos Gavilan Thanksgiving Fiesta Platter Is Here',
            'blog.post5Desc': 'Celebrate Thanksgiving this year with an authentic Mexican taquiza. Our Fiesta Platters provide generous portions of meats, tortillas, and sides ready for your family gathering.',
            'blog.post6Title': 'Top 5 Mexican Foods To Try In Azusa, CA',
            'blog.post6Desc': 'Looking for authentic Mexican food in Azusa? From freshly chopped street tacos to handcrafted sopes and mulitas, discover the top 5 specialties you must try.',
            'blog.post7Title': 'Discovering The Best Tacos In Los Angeles',
            'blog.post7Desc': 'Los Angeles is the taco capital of the United States. Explore how Tacos Gavilan preserves generational family recipes and traditional street taquería flavors.',
            'blog.read4Min': '4 min read',
            'blog.read5Min': '5 min read',

            'blog.catTraditions':          'Culinary Traditions',
            'blog.catCatering':            'Culture & Catering',
            'blog.catStory':               'Our Story',
            'blog.catCommunity':           'Community',
            'blog.catHoliday': 'Holiday Catering',
            'blog.catLocal': 'Local Guides',
            'blog.catGivingBack': 'Community & Giving Back',
            'blog.catReviews': 'Food Reviews',
            'blog.read3Min': '3 min read',

            'blog.minRead':                'min read',

            // Footer
            'footer.desc':               'Authentic Mexican food serving Southern California since 1992. From our family to yours — Ya está.',
            'footer.quickLinks':         'Quick Links',
            'footer.resourcesHeading':   'Resources & Archive',
            'footer.fiestaPlatters':     'Fiesta Platters',
            'footer.brochurePdf':        'Party Tray Brochure (PDF)',
            'footer.fullMenu':           'Full Menu Page',
            'footer.allLocations':       '15 Store Locations',
            'footer.blog':               'Official Gavilan Blog',
            'footer.hoursHeading':       'HOURS',
            'footer.hoursText':          'Hours vary by location — check your nearest restaurant',
            'footer.contactHeading':     'CONTACT',
            'footer.privacy':            'Privacy Policy',
            'footer.noticeAtCollection': 'Notice at Collection',
            'footer.terms':              'Terms of Use',
            'footer.accessibility':      'Accessibility',
            'footer.cookieSettings':     'Privacy Choices',
            'footer.dns':                'Your Privacy Choices (Do Not Sell or Share)',
            'footer.aboutText':          'Authentic Mexican food crafted with generational recipes since 1992. 15 locations across Southern California.',
            'footer.hours':              'Contact & Support',
            'footer.legal':              'Legal & Privacy',
            'footer.navigation':         'Navigation',
            'footer.privacyChoices':     'Your Privacy Choices',
            'footer.storePhoneDesc':     '15 Locations across Southern California',
            'footer.findStore':          'Find Your Store →',
            'footer.copyright':          '© 2026 Tacos Gavilan. All rights reserved.',

            // Cookies
            'cookie.title':      'California Privacy Notice & Cookie Choices (CCPA/CPRA)',
            'cookie.message':    'We use essential storage to operate this site. Non-essential analytics and advertising tags (Google Tag Manager, Meta Pixel, TikTok Pixel) remain blocked unless you grant consent. Under California law (CCPA/CPRA), you may opt out of the sale or sharing of personal information at any time.',
            'cookie.noticeLink': 'Read Notice at Collection',
            'cookie.accept':     'Accept All',
            'cookie.decline':    'Essential Only',
            'cookie.dns':        'Do Not Sell or Share',
            'cookie.prefs':      'Preferences',

            // Modals
            'privacy.title':        'Privacy Policy & California Notice at Collection (CCPA/CPRA)',
            'privacy.intro':        'Effective Date: October 16, 2026 · Last Updated: October 16, 2026 · Version: 2026.2. Trade Name: Tacos Gavilan · Legal Entity & Postal Address: [REQUIRES OWNER/LEGAL APPROVAL: LEGAL ENTITY AND POSTAL ADDRESS] · Contact: info@tacosgavilan.com. Read the complete policy and Category Retention Table at /privacy/.',
            'privacy.h1':           '1. Information We Collect & Location Data',
            'privacy.p1':           'Our hosting and database infrastructure (Vercel, Supabase) processes technical request data (IP address, browser User-Agent, timestamp, language/accessibility preferences). If you click the optional "Find Me" store locator button, your browser calculates distance to our 15 locations locally without transmitting or storing GPS coordinates on our servers. Online food orders and payments are processed on order.online (operated by DoorDash, Inc., integrated with Toast POS); we never collect payment card numbers on this website.',
            'privacy.formFieldsH':  '2. Contact, Catering, Employment & Privacy Requests (Notice at Collection)',
            'privacy.formFieldsP':  'When you submit our form, we collect your name, email, optional phone number, store preference, topic/request type, and message solely to respond to your inquiry or fulfill your CCPA request. We do not operate an automated marketing newsletter or resume upload portal on this site. Please do not submit sensitive personal information (SSN, payment cards, health data). See /privacy/#notice-at-collection.',
            'privacy.retentionH':   '3. Data Retention, Security Safeguards & Breach Notification',
            'privacy.retentionP':   'Contact inquiries are retained for 24 months after resolution; CCPA privacy request logs are retained for 24 months as required by 11 CCR § 7101(a) [RETENTION PERIOD REQUIRES OWNER/LEGAL APPROVAL]. We use reasonable administrative, technical, and organizational safeguards appropriate to the information processed, and will investigate and notify affected individuals of security incidents as required by applicable law.',
            'privacy.h2':           '4. Cookies, Prior-Consent Gating & Global Privacy Control (GPC)',
            'privacy.p2':           'Tacos Gavilan does not sell personal information for monetary consideration. Non-essential analytics and advertising tags (Google Tag Manager GTM-WW2N58Z, Meta Pixel, TikTok Pixel) are blocked by default until you grant consent, and are automatically disabled when a Global Privacy Control (navigator.globalPrivacyControl === true) signal or Opt-Out is active.',
            'privacy.rightsH':      '5. Your California Privacy Rights (CCPA / CPRA)',
            'privacy.rightsP':      'California residents have the Right to Know/Access, Delete, Correct, Opt Out of Sale/Sharing, Limit Sensitive Info, and Non-Discrimination, including via an Authorized Agent. Submit requests via our Contact Form (receiving a confirmation Reference ID and timestamp) or email info@tacosgavilan.com.',

            'terms.title': 'Terms of Use & Conditions',
            'terms.intro': 'Effective Date: October 16, 2026 · Last Updated: October 16, 2026 · Version: 2026.2. Trade Name: Tacos Gavilan · Responsible Entity: [REQUIRES OWNER/LEGAL APPROVAL: LEGAL ENTITY AND POSTAL ADDRESS]. Full Terms of Use available at /terms/.',
            'terms.h1':    '1. Online Ordering (order.online / DoorDash & Toast POS), Pricing & Refunds',
            'terms.p1':    'Online ordering links direct you to order.online (operated by DoorDash, Inc.) integrated with our Toast POS system. Payment processing and delivery dispatch are handled by DoorDash/Toast; food preparation is performed by the selected Tacos Gavilan restaurant. Prices, Fiesta Platter packages, and availability may vary by store and between in-store and delivery platforms. When a store is closed, ordering is disabled for that store. For order issues or refund requests, contact the fulfilling restaurant directly by telephone or via /contact/.',
            'terms.h2':    '2. Food Allergen & Shared Kitchen Cross-Contact Notice',
            'terms.p2':    'Menu items and ingredients may change without notice. Food is prepared in shared commercial kitchens handling wheat/gluten, milk/dairy, eggs, soy, sesame, and meats. Because of shared cooking equipment and prep surfaces, Tacos Gavilan cannot guarantee that any menu item is 100% free of allergens. Guests with severe allergies must consult the restaurant before ordering.',
            'terms.h3':    '3. Intellectual Property, Disclaimer & Governing Law [REQUIRES LEGAL COUNSEL REVIEW]',
            'terms.p3':    'All content and trademarks ("Tacos Gavilan", "Ya está.") are owned by Tacos Gavilan. The website is provided on an "AS IS" and "AS AVAILABLE" basis to the fullest extent permitted by law. Governed by California law [REQUIRES LEGAL COUNSEL REVIEW: LIABILITY CAP, INDEMNIFICATION, AND VENUE].',

            'accessibility.title':        'Website Accessibility Statement',
            'accessibility.intro':        'Effective Date: October 16, 2026 · Last Updated: October 16, 2026 · Version: 2026.2 · Entity: Tacos Gavilan [REQUIRES OWNER/LEGAL APPROVAL: LEGAL ENTITY AND POSTAL ADDRESS]. Full Accessibility Statement available at /accessibility/.',
            'accessibility.h1':           'Our Commitment & Technical Standards',
            'accessibility.p1':           'Tacos Gavilan is working toward Web Content Accessibility Guidelines (WCAG) 2.2 Level AA and continuously evaluates and improves the website. We provide semantic landmarks, keyboard navigation, focus management, and an optional assistive toolbar. Certain third-party embeds (such as order.online checkout pages or Google Maps tiles) are controlled by external providers.',
            'accessibility.lastUpdatedH': 'Telephone Assistance & Alternative Access',
            'accessibility.lastUpdatedP': 'If you experience difficulty using any part of this website or placing an online order, please call your nearest Tacos Gavilan restaurant directly (all 15 store phone numbers are listed on our Locations page) and our team will gladly assist you with menu information and telephone ordering.',
            'accessibility.h2':           'Feedback & Barrier Reporting',
            'accessibility.p2':           'To report an accessibility barrier or request assistance, email info@tacosgavilan.com or submit a request via /contact/ selecting "Website Accessibility / ADA Assistance".'
        },
        es: {
            'a11y.skipToContent': 'Saltar al contenido principal',

            // Navegación
            'nav.home':      'Inicio',
            'nav.about':     'Nosotros',
            'nav.menu':      'Menú',
            'nav.catering':  'Fiesta Platter',
            'nav.locations': 'Ubicaciones',
            'nav.contact':   'Contacto',
            'nav.blog':      'Blog',
            'nav.hours':     'Horas',
            'nav.order':     'Ordenar',

            // Hero
            'hero.badge':    '<span class="badge-part">Tradición Desde 1992</span><span class="badge-sep" aria-hidden="true"> · </span><span class="badge-part">15 Sucursales en el Sur de California</span>',
            'hero.title':    'Auténtica\nComida Mexicana',
            'hero.subtitle': 'Desde 1992 · 15 Sucursales · Los Ángeles y Sur de California',
            'hero.orderBtn': 'Ordenar en Línea',
            'hero.menuBtn':  'Ver Menú',

            // Showcase
            'showcase.title':       'Especialidades Tradicionales',
            'showcase.asada':       'Tacos de Asada',
            'showcase.burritos':    'Burritos',
            'showcase.mulitas':     'Mulitas',
            'showcase.tortas':      'Tortas',
            'showcase.platos':      'Platos',
            'showcase.sopes':       'Sopes',
            'showcase.nachos':      'Super Nachos',
            'showcase.quesadillas': 'Quesadillas',

            // Nosotros
            'about.tag':       'TRADICIÓN Y PASIÓN',
            'about.title':     'Nuestra Historia',
            'about.p1':        'Desde 1992, Tacos Gavilan ha llevado el auténtico sabor de México a Los Ángeles. Lo que comenzó como una taquería familiar ha crecido hasta convertirse en 15 sucursales que sirven a miles de familias todos los días.',
            'about.p2':        'Nos enorgullece cocinar con pasión y recetas tradicionales. Desde nuestro pastor marinado hasta nuestras salsas de la casa, cada platillo refleja décadas de entrega culinaria.',
            'about.locations': 'Sucursales',
            'about.since':     'Desde',
            'about.meats':     'Opciones de Carne',

            // Menú (Página de Inicio y Menú Completo)
            'menu.tag':        'AUTÉNTICA COMIDA DE CALLE',
            'menu.title':      'Nuestro Menú Completo',
            'menu.subtitle':   'Recetas tradicionales mexicanas preparadas diariamente. Ordena para recoger en cualquiera de nuestras 15 sucursales.',
            'menu.orderOnlineBtn': 'Ordenar en Línea',

            // Pestañas de Menú
            'menu.tab.tacos':       'Tacos',
            'menu.tab.burritos':    'Burritos',
            'menu.tab.quesadillas': 'Quesadillas',
            'menu.tab.mulitas':     'Mulitas',
            'menu.tab.sopes':       'Sopes',
            'menu.tab.tortas':      'Tortas',
            'menu.tab.platos':      'Platos',
            'menu.tab.nachos':      'Nachos',
            'menu.tab.drinks':      'Bebidas',

            // Platillos de Menú
            'menu.tacosTitle':        'Tacos',
            'menu.tacosDesc':         'Servidos solo con carne',
            'menu.burritosTitle':     'Burritos y Súper Burritos',
            'menu.burritosDesc':      'Envuelto con arroz y frijoles · Súper incluye crema, queso y guacamole',
            'menu.quesadillasTitle':  'Quesadillas y Súper Quesadillas',
            'menu.quesadillasDesc':   'Carne a tu elección y queso fundido · Súper incluye crema, guacamole y queso',
            'menu.sopesTitle':        'Sopes',
            'menu.sopesDesc':         'Tortilla gruesa cubierta con frijoles, crema y queso',
            'menu.mulitasTitle':      'Mulitas y Súper Mulitas',
            'menu.mulitasDesc':       'Carne servida entre dos tortillas con queso fundido · Súper incluye guacamole y crema',
            'menu.tortasTitle':       'Tortas',
            'menu.tortasDesc':        'Carne a tu elección - Lechuga, jitomate, mayonesa, guacamole, frijoles y queso',
            'menu.platosTitle':       'Platos',
            'menu.platosDesc':        'Incluye ensalada pequeña, arroz, frijoles, guacamole y tortillas a tu elección',
            'menu.nachosTitle':       'Súper Nachos',
            'menu.nachosDesc':        'Carne a tu elección - Queso nacho, crema y guacamole',

            // Carnes Disponibles
            'menu.meatsTitle':        'Carnes Disponibles',
            'menu.meatsSubtitle':     'Elige tu proteína favorita para cualquier taco, burrito, quesadilla, mulita, sope o plato.',
            'menu.meatAsada':         'Asada',
            'menu.meatAsadaSub':      'Carne de res asada',
            'menu.meatPastor':        'Al Pastor',
            'menu.meatPastorSub':     'Carne de cerdo marinada',
            'menu.meatPollo':         'Pollo',
            'menu.meatPolloSub':      'Pollo asado',
            'menu.meatCarnitas':      'Carnitas',
            'menu.meatCarnitasSub':   'Carne de cerdo sazonada',
            'menu.meatCabeza':        'Cabeza',
            'menu.meatCabezaSub':     'Cabeza de res al vapor',
            'menu.meatLengua':        'Lengua',
            'menu.meatLenguaSub':     'Lengua de res al vapor',
            'menu.meatBuche':         'Buche',
            'menu.meatBucheSub':      'Buche de cerdo a la plancha',
            'menu.meatChorizo':       'Chorizo',
            'menu.meatChorizoSub':    'Chorizo mexicano',

            // Guarniciones y Bebidas
            'menu.sidesTitle':        'Guarniciones Tradicionales',
            'menu.sideRice':          'Arroz rojo sazonado',
            'menu.sideBeans':         'Frijoles pintos a fuego lento',
            'menu.sideGuac':          'Aguacate fresco machacado con limón',
            'menu.sideCrema':         'Auténtica crema mexicana',
            'menu.sideCheese':        'Queso artesanal mexicano',
            'menu.sideChips':         'Totopos hechos en casa y salsa tatemada',
            'menu.drinksTitle':       'Aguas Frescas y Bebidas',
            'menu.drinkHorchata':     'Arroz dulce, canela y leche',
            'menu.drinkJamaica':      'Té refrescante de flor de jamaica',
            'menu.drinkPina':         'Agua fresca natural de piña dulce',
            'menu.drinkTamarindo':    'Infusión agridulce de pulpa de tamarindo',
            'menu.drinkChampurrado':  'Bebida tradicional de chocolate mexicano caliente',
            'menu.drinkSodas':        'Jarritos, Coca-Cola Mexicana',
            'menu.drinkCoffee':       'Café recién hecho y agua embotellada',

            // Platillos Clásicos
            'menu.tacos.name': 'Taco de Asada',
            'menu.tacos.desc': '1 Taco de Carne Asada - Servido solo con carne',
            'menu.tacoPastor.name': 'Tacos al Pastor',
            'menu.tacoPastor.desc': '1 Taco de Cerdo Marinado - Servido solo con carne',
            'menu.tacoPollo.name': 'Tacos de Pollo',
            'menu.tacoPollo.desc': '1 Taco de Pollo Asado - Servido solo con carne',
            'menu.tacoCarnitas.name': 'Tacos de Carnitas',
            'menu.tacoCarnitas.desc': '1 Taco de Cerdo Sazonado - Servido solo con carne',
            'menu.tacoCabeza.name': 'Tacos de Cabeza',
            'menu.tacoCabeza.desc': '1 Taco de Cabeza de Res al Vapor - Servido solo con carne',
            'menu.tacoLengua.name': 'Tacos de Lengua',
            'menu.tacoLengua.desc': '1 Taco de Lengua de Res al Vapor - Servido solo con carne',
            'menu.tacoBuche.name': 'Tacos de Buche',
            'menu.tacoBuche.desc': '1 Taco de Buche de Cerdo - Servido solo con carne',
            'menu.tacoChorizo.name': 'Tacos de Chorizo',
            'menu.tacoChorizo.desc': '1 Taco de Chorizo Mexicano - Servido solo con carne',
            'menu.tacoPlate.name': 'Plato de Tacos',
            'menu.tacoPlate.desc': 'Tres tacos a tu elección - Servidos solo con carne - Acompañados de frijoles y arroz',
            'menu.burrito.name': 'Burrito',
            'menu.burrito.desc': 'Carne a tu elección - Envuelto con arroz y frijoles',
            'menu.superBurrito.name': 'Súper Burrito',
            'menu.superBurrito.desc': 'Carne a tu elección - Incluye arroz, frijoles, crema, queso y guacamole',
            'menu.quesadilla.name': 'Quesadilla',
            'menu.quesadilla.desc': 'Carne a tu elección y queso fundido',
            'menu.superQuesadilla.name': 'Súper Quesadilla',
            'menu.superQuesadilla.desc': 'Carne a tu elección - Crema, guacamole y queso fundido',
            'menu.mulita.name': 'Mulita',
            'menu.mulita.desc': 'Carne servida entre dos tortillas con queso fundido',
            'menu.superMulita.name': 'Súper Mulita',
            'menu.superMulita.desc': 'Carne servida entre dos tortillas con queso fundido, guacamole y crema',
            'menu.sopes.name': 'Sopes',
            'menu.sopes.desc': 'Tortilla gruesa cubierta con frijoles, crema y queso',
            'menu.torta.name': 'Torta',
            'menu.torta.desc': 'Carne a tu elección - Lechuga, jitomate, mayonesa, guacamole, frijoles y queso',
            'menu.plato.name': 'Plato',
            'menu.plato.desc': 'Incluye ensalada pequeña, arroz, frijoles, guacamole y tortillas a tu elección',
            'menu.nachos.name': 'Súper Nachos',
            'menu.nachos.desc': 'Carne a tu elección - Queso nacho, crema y guacamole',
            'menu.horchata.name': 'Agua de Horchata',
            'menu.horchata.desc': 'Bebida tradicional de arroz con canela y vainilla.',
            'menu.jamaica.name': 'Agua de Jamaica',
            'menu.jamaica.desc': 'Infusión de flor de jamaica con color vibrante y sabor fresco agridulce.',
            'menu.pina.name': 'Agua de Piña',
            'menu.pina.desc': 'Refrescante agua fresca de piña natural, dulce y servida bien fría con hielo.',
            'menu.tamarindo.name': 'Agua de Tamarindo',
            'menu.tamarindo.desc': 'Agua fresca tradicional de tamarindo, agridulce y servida bien fría.',
            'menu.meatCalloutTitle': 'Carnes Disponibles',
            'menu.meatList': 'Asada · Al Pastor · Pollo · Carnitas · Cabeza · Lengua · Buche · Chorizo',
            'menu.meatOptions': '8 Opciones de Carne Disponibles para Cada Platillo',

            // Fiesta Platter (Página de Inicio y Fiesta Platter)
            'fiesta.badge':            'BANQUETES Y FIESTAS',
            'fiesta.title':            'Charolas para Fiestas',
            'fiesta.subtitle':         'Banquetes para tus eventos especiales',
            'fiesta.desc':             'Auténtica comida mexicana para fiestas, eventos empresariales y reuniones familiares. Lista para disfrutar.',
            'fiesta.f1':               'Para 15 a 40 personas con porciones muy generosas',
            'fiesta.f2':               'Elección de carnes tradicionales, arroz, frijoles y salsas',
            'fiesta.f3':               'Tortillas de maíz hechas a mano incluidas en cada orden',
            'fiesta.f4':               'Lista para recoger en menos de 1 hora en tu sucursal más cercana',
            'fiesta.btn':              'Ver Charolas para Fiestas',
            'fiesta.heroTitle':        'Nuestras Famosas <span>Charolas para Fiesta</span>',
            'fiesta.heroLead':         '¡Auténtica taquiza mexicana fácil y rápida! Disponible para recoger el mismo día en nuestras 15 sucursales. Ordena con solo 1 hora de anticipación para grupos de 15 a 40 personas.',
            'fiesta.orderToastBtn':    'Ordenar en Línea',
            'fiesta.packagesTitle':    'Paquetes de Banquete por Tamaño de Grupo',
            'fiesta.packagesSubtitle': 'Cada paquete incluye tu elección de carnes, arroz mexicano, frijoles pintos refritos, Agua Fresca, tortillas de maíz o harina, salsas roja y verde, condimentos y utensilios.',
            'fiesta.pkg15Title':       '15 a 20 Personas',
            'fiesta.pkg15Desc':        '6 lbs de Carne · Arroz y Frijol Mediano · 3 Galones de Agua Fresca',
            'fiesta.pkg20Title':       '20 a 25 Personas',
            'fiesta.pkg20Desc':        '7.5 lbs de Carne · 1/2 Charola Arroz y Frijol · 4 Galones de Agua Fresca',
            'fiesta.pkg25Title':       '25 a 30 Personas',
            'fiesta.pkg25Desc':        '10 lbs de Carne · 3/4 Charola Arroz y Frijol · 5 Galones de Agua Fresca',
            'fiesta.pkg30Title':       '30 a 40 Personas',
            'fiesta.pkg30Desc':        '12 lbs de Carne · Charola Completa Arroz y Frijol · 6 Galones de Agua Fresca',
            'fiesta.orderBtn':         'Ordenar en Línea',
            'fiesta.whatsIncludedTitle': 'Qué Incluye Cada Charola Fiesta Platter',
            'fiesta.incMeatsTitle':    'Carne a Elegir (6 a 12 lbs)',
            'fiesta.incMeatsDesc':     'Elige entre Carne Asada, Pollo o Al Pastor recién asada al momento.',
            'fiesta.incSidesTitle':    'Arroz Mexicano y Frijoles Pintos',
            'fiesta.incSidesDesc':     'De 3 a 10 lbs de arroz rojo mexicano sazonado y de 3 a 10 lbs de frijoles pintos refritos.',
            'fiesta.incTortillasTitle':'Tortillas de Maíz o Harina',
            'fiesta.incTortillasDesc': 'De 2 a 5 paquetes de tortilla de maíz (10 a 20 docenas) o de 5 a 12 paquetes de harina (5 a 10 docenas).',
            'fiesta.incGarnishTitle':  'Salsas y Condimentos',
            'fiesta.incGarnishDesc':   'Sobres de salsa roja y verde, bolsitas de cebolla con cilantro fresco, limones y zanahorias con jalapeños.',
            'fiesta.incUtensilsTitle': 'Platos, Tenedores, Cucharas, Vasos y Servilletas',
            'fiesta.incUtensilsDesc':  'De 30 a 50 platos, 15 a 25 tenedores y cucharas, 20 a 40 vasos y 1 a 3 paquetes de servilletas.',
            'fiesta.incChipsTitle':    'Agua Fresca (3 a 6 Galones)',
            'fiesta.incChipsDesc':     'De 3 a 6 galones de Agua Fresca a elegir: Jamaica, Horchata, Piña o Tamarindo.',
            'fiesta.stepsH2': '5 Pasos Sencillos para Ordenar tu Taquiza',
            'fiesta.s1Title': 'Elige Sucursal',
            'fiesta.s1Desc': 'Selecciona tu sucursal más cercana para recoger.',
            'fiesta.s2Title': 'Tamaño de Grupo',
            'fiesta.s2Desc': 'Elige el paquete según tu número de invitados (15 a 40+ personas).',
            'fiesta.s3Title': 'Elige tus Carnes',
            'fiesta.s3Desc': 'Elige Carne Asada, Pollo o Al Pastor.',
            'fiesta.s4Title': 'Recoge en Tienda',
            'fiesta.s4Desc': 'Comida caliente y recién hecha lista en tan solo 1 hora.',
            'fiesta.s5Title': '¡Disfruta!',
            'fiesta.s5Desc': '¡Auténtica experiencia taquera en tu evento!',
            'fiesta.incTag': 'TODO INCLUIDO',
            'fiesta.incTitle': 'Qué Incluye Cada Charola Fiesta Platter',
            'fiesta.incSubtitle': 'Cada Fiesta Platter se prepara caliente al momento con las porciones exactas de carne, arroz, frijoles, Agua Fresca, tortillas, salsas, condimentos y utensilios completos.',
            'fiesta.boxMeatsH': 'Carne a Elegir (6 a 12 lbs)',
            'fiesta.boxMeatsP': 'Tu elección de Carne Asada, Pollo o Al Pastor recién asada en la parrilla y servida caliente en charolas para fiesta.',
            'fiesta.boxSidesH': 'Arroz Mexicano, Frijoles y Tortillas',
            'fiesta.boxSidesP': 'Arroz rojo mexicano tradicional (3 a 10 lbs), frijoles pintos refritos (3 a 10 lbs) y tortillas calientes de maíz o harina.',
            'fiesta.boxSalsasH': 'Salsas y Condimentos',
            'fiesta.boxSalsasP': 'Salsas roja y verde de la casa, bolsitas de cebolla con cilantro fresco, limones y zanahorias con chiles jalapeños en escabeche.',
            'fiesta.boxDrinksH': 'Aguas Frescas y Utensilios',
            'fiesta.boxDrinksP': 'De 3 a 6 galones de Agua Fresca (Jamaica, Horchata, Piña o Tamarindo), además de platos, tenedores, cucharas, vasos y servilletas.',
            'fiesta.exclusiveH3': 'Pedidos Exclusivamente en Línea',
            'fiesta.exclusiveP': 'Para garantizar una preparación rápida y puntualidad exacta, todos los pedidos de banquetes y Fiesta Platters se realizan exclusivamente a través de nuestra plataforma oficial de pedidos en línea. Selecciona tu sucursal más cercana, configura el tamaño de tu paquete y programa tu recolección directamente.',
            'fiesta.contactBtn': '¿Preguntas? Contáctanos',
            'fiesta.stepsTitle':       'Cómo Ordenar tu Charola en 5 Pasos Sencillos',
            'fiesta.step1Title':       'Elige el Tamaño del Paquete',
            'fiesta.step1Desc':        'Selecciona entre 15-20, 20-25, 25-30 o 30-40 personas según el número de invitados.',
            'fiesta.step2Title':       'Elige tus Carnes y Complementos',
            'fiesta.step2Desc':        'Selecciona tus combinaciones de carne y especifica tus preferencias de tortilla.',
            'fiesta.step3Title':       'Selecciona tu Sucursal Más Cercana',
            'fiesta.step3Desc':        'Elige cualquiera de nuestras 15 sucursales del Sur de California para recoger rápidamente.',
            'fiesta.step4Title':       'Realiza tu Pedido en Línea',
            'fiesta.step4Desc':        'Ordena directamente en línea con tan solo 1 hora de anticipación.',
            'fiesta.step5Title':       'Recoge Caliente y Fresco',
            'fiesta.step5Desc':        'Llega a tu sucursal seleccionada, recoge tus charolas empaquetadas ¡y a disfrutar la fiesta!',

            // Ubicaciones
            'locations.tag':          '15 RESTAURANTES EN EL SUR DE CALIFORNIA',
            'locations.title':        'Encuentra tu Tacos Gavilan Más Cercano',
            'locations.subtitle':     '',
            'locations.mapBtn':       'Ver Mapa Interactivo',
            'locations.mapTitle':     'Localizador Interactivo de Sucursales',
            'locations.orderBtn':     'Ordenar',
            'locations.detailsBtn':   'Detalles',
            'locations.directions':   'Cómo llegar',
            'locations.storeDetails': 'Detalles de Sucursal',
            'locations.hoursBadge':   '15 Sucursales en el Sur de California',
            'locations.hoursOpenDaily': 'Abierto Diario',
            'locations.searchPlaceholder': 'Buscar por ciudad, dirección o código postal...',

            // Mapa Interactivo
            'map.findMe':          'Ubicarme',
            'map.themeDark':       'Oscuro',
            'map.themeLight':      'Claro',
            'map.themeSatellite':  'Satélite',
            'map.errorTitle':      'Mapa no disponible',
            'map.errorDesc':       'No se pudo cargar el mapa interactivo en este momento. Puedes consultar las direcciones y ordenar en línea de nuestras 15 sucursales a continuación.',
            'map.retry':           'Intentar de nuevo',
            'map.milesFromYou':    'millas de ti',
            'map.popupOrder':      'Ordenar en Línea',
            'map.popupDirections': 'Cómo llegar',

            // Contacto
            'contact.title':               'Contáctanos',
            'contact.subtitle':            '¿Tienes preguntas sobre banquetes, fiesta platters, accesibilidad o derechos de privacidad? Nos encantará atenderte.',
            'contact.name':                'Nombre *',
            'contact.email':               'Correo Electrónico *',
            'contact.phone':               'Teléfono (Opcional)',
            'contact.reason':              'Motivo / Tipo de Solicitud *',
            'contact.reasonGeneral':       'Consulta General',
            'contact.reasonCatering':      'Fiesta / Eventos',
            'contact.reasonFeedback':      'Comentarios de Servicio',
            'contact.reasonEmployment':    'Consulta de Empleo / Vacantes',
            'contact.reasonAccessibility': 'Accesibilidad Web / Asistencia ADA',
            'contact.reasonCcpaKnow':      'Solicitud de Privacidad: Derecho a Conocer / Acceso (CCPA)',
            'contact.reasonCcpaDelete':    'Solicitud de Privacidad: Derecho de Eliminación (CCPA)',
            'contact.reasonCcpaCorrect':   'Solicitud de Privacidad: Derecho de Corrección (CCPA)',
            'contact.reasonCcpaOptOut':    'Solicitud de Privacidad: Exclusión de Venta/Sharing (CCPA)',
            'contact.reasonCcpaAgent':     'Solicitud de Privacidad: Agente Autorizado / Apelación',
            'contact.reasonOther':         'Otra Consulta',
            'contact.store':               'Sucursal Más Cercana (Opcional)',
            'contact.storeSelect':         'Selecciona una sucursal...',
            'contact.message':             'Mensaje *',
            'contact.noticeAtCollection':  '<strong>Aviso en el Momento de la Recopilación de California (Notice at Collection):</strong> Recopilamos el nombre, correo electrónico, teléfono, sucursal y mensaje que usted envía únicamente para responder su consulta o procesar su solicitud de privacidad. No vendemos ni compartimos los envíos de formularios para publicidad. Por favor <strong>no envíe información personal sensible</strong> (como números de Seguro Social, tarjetas de pago, identificaciones oficiales o datos médicos) en este formulario. Consulte nuestro <a href="/privacy/#notice-at-collection" style="color:#FFC72C;text-decoration:underline;">Aviso de Recopilación</a>, <a href="/privacy/" style="color:#FFC72C;text-decoration:underline;">Política de Privacidad</a> y <a href="/privacy-choices/" style="color:#FFC72C;text-decoration:underline;">Sus Opciones de Privacidad</a>.',
            'contact.privacyNotice':       'Al enviar este formulario, aceptas nuestra <a href="/privacy/#notice-at-collection" id="contact-privacy-link">Política de Privacidad y Aviso de Recopilación</a>.',
            'contact.send':                'Enviar Mensaje',
            'contact.sending':             'Enviando...',
            'contact.sent':                '¡Mensaje Enviado!',
            'contact.successMsg':          '¡Gracias! Tu solicitud ha sido recibida por Tacos Gavilan.',
            'contact.errorMsg':            'No se pudo enviar el mensaje. Por favor verifica tus datos o escríbenos a info@tacosgavilan.com.',

            // Detalles de Página de Contacto
            'contact.tag':                 'Ponte en Contacto',
            'contact.lead':                '¿Tienes preguntas sobre nuestro menú, platillos para eventos, experiencia, accesibilidad o derechos de privacidad en California? Contáctanos o envíanos una solicitud.',
            'contact.guestSupport':        'Atención al Cliente y Consultas',
            'contact.corporateOffice':     'Oficina Corporativa',
            'contact.addressLabel':        'Dirección Corporativa',
            'contact.phoneLabel':          'Teléfono',
            'contact.emailLabel':          'Correo Electrónico y Solicitudes de Privacidad',
            'contact.storeOrdersLabel':    'Pedidos por Teléfono y Sucursales',
            'contact.storeOrdersDesc':     'Para realizar pedidos por teléfono o hablar directamente con un restaurante, llama a tu sucursal más cercana.',
            'contact.officeHoursLabel':    'Horario de Soporte Corporativo',
            'contact.officeHoursValue':    'Lunes a Viernes: 8:00 AM – 5:00 PM',
            'contact.restaurantHoursLabel':'Horario de Restaurantes',
            'contact.restaurantHoursValue':'Abierto Diario de 8:00 AM hasta la madrugada (Horarios varían por sucursal)',
            'contact.restaurantHoursDesc': 'Abierto todos los días para comida, cena y madrugada. Los horarios varían por sucursal con servicio de drive-thru en tiendas seleccionadas.',
            'contact.viewAllStores':       'Ver las 15 Sucursales y Teléfonos',
            'contact.sendMessageTitle':    'Envíanos un Mensaje',
            'contact.fieldName':           'Nombre Completo *',
            'contact.fieldEmail':          'Correo Electrónico *',
            'contact.fieldPhone':          'Teléfono (Opcional)',
            'contact.fieldStore':          'Sucursal (Opcional)',
            'contact.fieldType':           'Motivo de Contacto / Solicitud de Privacidad',
            'contact.fieldMessage':        'Mensaje *',
            'contact.fieldMessagePlaceholder': '¿En qué te podemos ayudar?',
            'contact.submitBtn':           'Enviar Mensaje',
            'contact.optCorporate':        'Consulta Corporativa / General',
            'contact.optCatering':         'Banquetes y Charolas para Fiestas',
            'contact.optFeedback':         'Comentarios y Experiencia del Cliente',
            'contact.optMedia':            'Corporativo y Medios',
            'contact.optOther':            'Otro',

            // Blog
            'blog.tag':                    'Historias y Noticias',
            'blog.title':                  'Blog de Tacos Gavilan',
            'blog.lead':                   'Explora nuestras raíces culinarias, recetas auténticas, guías de banquetes e iniciativas comunitarias en el sur de California.',
            'blog.readArticle':            'Leer Artículo →',
            'blog.post1Title': 'El Mejor Champurrado Cerca de Mí',
            'blog.post1Desc': 'En una noche fresca, nada supera la calidez de una taza de auténtico champurrado mexicano. Descubre su historia y dónde encontrar el mejor champurrado en el Sur de California.',
            'blog.post2Title': 'México Celebra con una Taquiza',
            'blog.post2Desc': 'La taquiza es el centro de reuniones, celebraciones, días festivos y convivencia familiar en la tradición mexicana. Conoce cómo la tradición de la taquiza renace en Los Ángeles.',
            'blog.post3Title': 'Historia de Tacos Gavilan',
            'blog.post3Desc': 'Fundado en la esquina de Gage y Main en Los Ángeles en 1992, Tacos Gavilan se ha convertido en un ícono de la comida mexicana rápida y auténtica con 15 sucursales en el Sur de California.',
            'blog.post4Title': 'Primer Concurso Anual de Comer Tacos Celebra el Mes de la Herencia Hispana',
            'blog.post4Desc': 'Tacos Gavilan celebró el Mes de la Herencia Hispana con su primer concurso de comer tacos, reuniendo a la comunidad y apoyando a programas educativos locales.',
            'blog.post5Title': 'Llegó la Charola Fiesta Platter de Acción de Gracias de Tacos Gavilan',
            'blog.post5Desc': 'Celebra este Día de Acción de Gracias con una auténtica taquiza mexicana. Nuestras charolas Fiesta Platter ofrecen porciones generosas listas para tu reunión familiar.',
            'blog.post6Title': 'Los 5 Mejores Platillos Mexicanos para Probar en Azusa, CA',
            'blog.post6Desc': '¿Buscas auténtica comida mexicana en Azusa? Desde tacos recién picados hasta sopes artesanales y mulitas, descubre las 5 especialidades que debes probar.',
            'blog.post7Title': 'Descubriendo los Mejores Tacos en Los Ángeles',
            'blog.post7Desc': 'Los Ángeles es la capital del taco en Estados Unidos. Explora cómo Tacos Gavilan mantiene vivas las recetas familiares y el sabor tradicional en cada bocado.',
            'blog.read4Min': '4 min de lectura',
            'blog.read5Min': '5 min de lectura',

            'blog.catTraditions':          'Tradiciones Culinarias',
            'blog.catCatering':            'Cultura y Banquetes',
            'blog.catStory':               'Nuestra Historia',
            'blog.catCommunity':           'Comunidad',
            'blog.catHoliday': 'Banquetes de Temporada',
            'blog.catLocal': 'Guías Locales',
            'blog.catGivingBack': 'Comunidad y Apoyo Local',
            'blog.catReviews': 'Reseñas Culinarias',
            'blog.read3Min': '3 min de lectura',

            'blog.minRead':                'min de lectura',

            // Pie de Página
            'footer.desc':               'Auténtica comida mexicana sirviendo al Sur de California desde 1992. De nuestra familia a la tuya — Ya está.',
            'footer.quickLinks':         'Enlaces Rápidos',
            'footer.resourcesHeading':   'Recursos y Archivo',
            'footer.fiestaPlatters':     'Charolas para Fiestas',
            'footer.brochurePdf':        'Folleto de Charolas (PDF)',
            'footer.fullMenu':           'Página de Menú Completo',
            'footer.allLocations':       'Nuestras 15 Sucursales',
            'footer.blog':               'Blog Oficial Gavilan',
            'footer.hoursHeading':       'HORARIO',
            'footer.hoursText':          'Los horarios varían por sucursal — consulta tu restaurante más cercano',
            'footer.contactHeading':     'CONTACTO',
            'footer.privacy':            'Política de Privacidad',
            'footer.noticeAtCollection': 'Aviso de Recopilación',
            'footer.terms':              'Términos de Uso',
            'footer.accessibility':      'Accesibilidad',
            'footer.cookieSettings':     'Opciones de Privacidad',
            'footer.dns':                'Sus Opciones de Privacidad (No Vender ni Compartir)',
            'footer.aboutText':          'Auténtica comida mexicana preparada con recetas de familia desde 1992. 15 sucursales en el Sur de California.',
            'footer.hours':              'Contacto y Soporte',
            'footer.legal':              'Legal y Privacidad',
            'footer.navigation':         'Navegación',
            'footer.privacyChoices':     'Sus Opciones de Privacidad',
            'footer.storePhoneDesc':     '15 Sucursales en el Sur de California',
            'footer.findStore':          'Encuentra tu Sucursal →',
            'footer.copyright':          '© 2026 Tacos Gavilan. Todos los derechos reservados.',

            // Cookies
            'cookie.title':      'Aviso de Privacidad y Opciones de Cookies de California (CCPA/CPRA)',
            'cookie.message':    'Utilizamos almacenamiento esencial para operar este sitio. Las etiquetas no esenciales de analítica y publicidad (Google Tag Manager, Meta Pixel, TikTok Pixel) permanecen bloqueadas salvo que otorgue su consentimiento. Bajo la ley de California (CCPA/CPRA), puede optar por no vender ni compartir su información personal en cualquier momento.',
            'cookie.noticeLink': 'Leer Aviso de Recopilación',
            'cookie.accept':     'Aceptar Todas',
            'cookie.decline':    'Solo Esenciales',
            'cookie.dns':        'No Vender ni Compartir',
            'cookie.prefs':      'Preferencias',

            // Modales Legales
            'privacy.title':        'Política de Privacidad y Aviso de Recopilación de California (CCPA/CPRA)',
            'privacy.intro':        'Fecha de Entrada en Vigor: 16 de octubre de 2026 · Última Actualización: 16 de octubre de 2026 · Versión: 2026.2. Nombre Comercial: Tacos Gavilan · Entidad Legal y Dirección Postal: [REQUIRES OWNER/LEGAL APPROVAL: LEGAL ENTITY AND POSTAL ADDRESS] · Contacto: info@tacosgavilan.com. Consulte la política completa y la Tabla de Retención en /privacy/.',
            'privacy.h1':           '1. Información que Recopilamos y Datos de Ubicación',
            'privacy.p1':           'Nuestra infraestructura de alojamiento y base de datos (Vercel, Supabase) procesa datos técnicos de solicitudes (dirección IP, navegador User-Agent, fecha/hora y preferencias de idioma/accesibilidad). Si utiliza el botón opcional "Ubicarme" en el mapa interactivo, su navegador calcula la distancia hacia nuestras 15 sucursales localmente sin transmitir ni almacenar coordenadas GPS en nuestros servidores. Los pedidos de comida y pagos en línea se procesan en order.online (operado por DoorDash, Inc., integrado con Toast POS); nunca recopilamos números de tarjetas de pago en este sitio.',
            'privacy.formFieldsH':  '2. Contacto, Banquetes, Empleo y Solicitudes de Privacidad (Notice at Collection)',
            'privacy.formFieldsP':  'Al enviar nuestro formulario, recopilamos su nombre, correo electrónico, teléfono opcional, sucursal seleccionada, motivo/tipo de solicitud y mensaje únicamente para responder su consulta o procesar su solicitud CCPA. No operamos un boletín automatizado de marketing ni un portal de carga de currículums en este sitio. Por favor no envíe información personal sensible (Seguro Social, tarjetas de pago, datos médicos). Consulte /privacy/#notice-at-collection.',
            'privacy.retentionH':   '3. Retención de Datos, Salvaguardas de Seguridad y Notificación de Incidentes',
            'privacy.retentionP':   'Las consultas de contacto se conservan durante 24 meses tras su resolución; los registros de solicitudes de privacidad CCPA se conservan durante 24 meses conforme a 11 CCR § 7101(a) [RETENTION PERIOD REQUIRES OWNER/LEGAL APPROVAL]. Utilizamos salvaguardas administrativas, técnicas y organizativas razonables apropiadas para la información procesada, e investigaremos y notificaremos incidentes de seguridad conforme a la ley aplicable.',
            'privacy.h2':           '4. Cookies, Bloqueo Previo al Consentimiento y Global Privacy Control (GPC)',
            'privacy.p2':           'Tacos Gavilan no vende información personal a cambio de dinero. Las etiquetas no esenciales de analítica y publicidad (Google Tag Manager GTM-WW2N58Z, Meta Pixel, TikTok Pixel) están bloqueadas por defecto hasta que usted otorgue su consentimiento, y se desactivan automáticamente cuando se detecta una señal Global Privacy Control (navigator.globalPrivacyControl === true) o exclusión voluntaria.',
            'privacy.rightsH':      '5. Sus Derechos de Privacidad en California (CCPA / CPRA)',
            'privacy.rightsP':      'Los residentes de California tienen Derecho a Conocer/Acceder, Eliminar, Corregir, Optar por No Vender ni Compartir, Limitar Información Sensible y No Discriminación, incluso mediante Agente Autorizado. Envíe solicitudes mediante nuestro Formulario de Contacto (recibiendo un ID de Confirmación y marca de tiempo) o al correo info@tacosgavilan.com.',

            'terms.title': 'Términos y Condiciones de Uso',
            'terms.intro': 'Fecha de Entrada en Vigor: 16 de octubre de 2026 · Última Actualización: 16 de octubre de 2026 · Versión: 2026.2. Nombre Comercial: Tacos Gavilan · Entidad Responsable: [REQUIRES OWNER/LEGAL APPROVAL: LEGAL ENTITY AND POSTAL ADDRESS]. Consulte los Términos de Uso completos en /terms/.',
            'terms.h1':    '1. Pedidos en Línea (order.online / DoorDash y Toast POS), Precios y Reembolsos',
            'terms.p1':    'Los enlaces de pedidos en línea dirigen a order.online (operado por DoorDash, Inc.) integrado con nuestro sistema Toast POS. El procesamiento del pago y el despacho de entrega son gestionados por DoorDash/Toast; la preparación de alimentos la realiza la sucursal de Tacos Gavilan seleccionada. Los precios, paquetes Fiesta Platter y disponibilidad pueden variar por sucursal y entre restaurante y plataformas de entrega. Cuando una sucursal está cerrada, los pedidos se deshabilitan para esa tienda. Para problemas con pedidos o reembolsos, comuníquese por teléfono con el restaurante correspondiente o mediante /contact/.',
            'terms.h2':    '2. Aviso sobre Alérgenos Alimentarios y Contacto Cruzado en Cocina Compartida',
            'terms.p2':    'Los platillos e ingredientes pueden cambiar sin previo aviso. Los alimentos se preparan en cocinas comerciales compartidas que manejan trigo/gluten, leche/lácteos, huevo, soya, ajonjolí y carnes. Debido al uso de equipos y superficies compartidas, Tacos Gavilan no puede garantizar que ningún platillo esté 100% libre de alérgenos. Los clientes con alergias severas deben consultar al restaurante antes de ordenar.',
            'terms.h3':    '3. Propiedad Intelectual, Exención de Garantías y Ley Aplicable [REQUIRES LEGAL COUNSEL REVIEW]',
            'terms.p3':    'Todos los contenidos y marcas ("Tacos Gavilan", "Ya está.") son propiedad de Tacos Gavilan. El sitio se proporciona "TAL CUAL" ("AS IS") y "SEGÚN DISPONIBILIDAD" en la máxima medida permitida por la ley. Regido por las leyes de California [REQUIRES LEGAL COUNSEL REVIEW: LIABILITY CAP, INDEMNIFICATION, AND VENUE].',

            'accessibility.title':        'Declaración de Accesibilidad Web',
            'accessibility.intro':        'Fecha de Entrada en Vigor: 16 de octubre de 2026 · Última Actualización: 16 de octubre de 2026 · Versión: 2026.2 · Entidad: Tacos Gavilan [REQUIRES OWNER/LEGAL APPROVAL: LEGAL ENTITY AND POSTAL ADDRESS]. Consulte la Declaración de Accesibilidad completa en /accessibility/.',
            'accessibility.h1':           'Nuestro Compromiso y Estándares Técnicos',
            'accessibility.p1':           'Tacos Gavilan trabaja continuamente hacia las Pautas de Accesibilidad para el Contenido Web (WCAG) 2.2 Nivel AA y evalúa y mejora continuamente el sitio web. Ofrecemos regiones semánticas, navegación por teclado, gestión de foco y una barra de asistencia opcional. Ciertas integraciones de terceros (como páginas de pago en order.online o mapas de Google Maps) son controladas por proveedores externos.',
            'accessibility.lastUpdatedH': 'Asistencia Telefónica y Acceso Alternativo',
            'accessibility.lastUpdatedP': 'Si experimenta alguna dificultad para utilizar cualquier parte de este sitio web o realizar un pedido en línea, llame directamente a su restaurante Tacos Gavilan más cercano (los 15 números telefónicos están disponibles en nuestra página de Ubicaciones) y nuestro equipo con gusto le asistirá con información del menú y pedidos telefónicos.',
            'accessibility.h2':           'Comentarios y Reporte de Barreras',
            'accessibility.p2':           'Para reportar una barrera de accesibilidad o solicitar asistencia, escriba a info@tacosgavilan.com o envíe una solicitud en /contact/ seleccionando "Accesibilidad Web / Asistencia ADA".'
        }
    };

    const applyTranslations = () => {
        // 1. Central dictionary data-i18n elements
        const elements = document.querySelectorAll('[data-i18n]');
        elements.forEach(el => {
            const key = el.getAttribute('data-i18n');
            const translation = translations[currentLang]?.[key];
            if (translation === undefined) return;

            const hasChildren = el.children.length > 0;
            if (translation.includes('<') && translation.includes('>')) {
                el.innerHTML = translation;
            } else if (!hasChildren) {
                el.textContent = translation;
            } else {
                const targetSpan = el.querySelector('span:not([aria-hidden="true"])') || el.querySelector('span');
                if (targetSpan) {
                    targetSpan.textContent = translation;
                } else if (!el.querySelector('svg, img, canvas')) {
                    el.textContent = translation;
                } else {
                    for (let i = 0; i < el.childNodes.length; i++) {
                        if (el.childNodes[i].nodeType === Node.TEXT_NODE && el.childNodes[i].nodeValue.trim().length > 0) {
                            el.childNodes[i].nodeValue = ' ' + translation.trim() + ' ';
                            break;
                        }
                    }
                }
            }
        });

        // 2. Inline data-en and data-es elements
        document.querySelectorAll('[data-en][data-es]').forEach(el => {
            const val = currentLang === 'es' ? el.getAttribute('data-es') : el.getAttribute('data-en');
            if (val) {
                if (val.includes('<') && val.includes('>')) {
                    el.innerHTML = val;
                } else {
                    el.textContent = val;
                }
            }
        });

        // 3. Translated placeholders
        document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
            const key = el.getAttribute('data-i18n-placeholder');
            const val = translations[currentLang]?.[key];
            if (val) el.placeholder = val;
        });
        document.querySelectorAll('[data-en-placeholder][data-es-placeholder]').forEach(el => {
            const val = currentLang === 'es' ? el.getAttribute('data-es-placeholder') : el.getAttribute('data-en-placeholder');
            if (val) el.placeholder = val;
        });

        // 4. Translated aria labels
        document.querySelectorAll('[data-i18n-aria]').forEach(el => {
            const key = el.getAttribute('data-i18n-aria');
            const val = translations[currentLang]?.[key];
            if (val) el.setAttribute('aria-label', val);
        });
        document.querySelectorAll('[data-en-aria][data-es-aria]').forEach(el => {
            const val = currentLang === 'es' ? el.getAttribute('data-es-aria') : el.getAttribute('data-en-aria');
            if (val) el.setAttribute('aria-label', val);
        });

        document.documentElement.lang = currentLang;
        safeStorage.setItem('tacosgavilan_lang', currentLang);

        const langToggleBtn = document.getElementById('lang-toggle');
        if (langToggleBtn) {
            langToggleBtn.textContent = currentLang === 'en' ? 'ES' : 'EN';
            langToggleBtn.setAttribute('aria-label', currentLang === 'en' ? 'Switch language to Spanish' : 'Cambiar idioma a Inglés');
        }

        // Live update active map popup if open
        if (window._gavilanInfoWindow && window._activeGavilanMarker) {
            const loc = window._activeGavilanMarker._gavilanData;
            if (loc && typeof buildPopupContent === 'function') {
                window._gavilanInfoWindow.setContent(buildPopupContent(loc, loc._lastDistance || null));
            }
        }

        // Live update fallback card if currently visible
        if (document.querySelector('.map-fallback-card') && typeof renderMapFallback === 'function') {
            renderMapFallback();
        }
    };

    const langToggleBtn = document.getElementById('lang-toggle');
    if (langToggleBtn) {
        langToggleBtn.addEventListener('click', () => {
            currentLang = currentLang === 'en' ? 'es' : 'en';
            applyTranslations();
        });
    }

    applyTranslations();

    /* ==========================================================
       12. INTERACTIVE GOOGLE MAPS STORE LOCATOR
       With Safe Fallback Card, Controlled Retry & Live Bilingual Popups
       ========================================================== */
    const mapOverlay = document.getElementById('map-modal-overlay');
    const mapOpenBtn = document.getElementById('open-map-btn');
    const mapCloseBtn = document.getElementById('map-modal-close');

    let mapInitialized = false;
    let googleMapsLoadPromise = null;
    let mapTilesTimer = null;
    const GOOGLE_MAPS_SCRIPT_ID = 'tacos-gavilan-google-maps';
    const GOOGLE_MAPS_BROWSER_KEY = 'AIzaSyCdu1R10kWbD-FaSMh4MMyxgqmhEG8xVko';

    const loadGoogleMapsApi = () => {
        if (window.google && window.google.maps) return Promise.resolve();
        if (googleMapsLoadPromise) return googleMapsLoadPromise;

        googleMapsLoadPromise = new Promise((resolve, reject) => {
            const existing = document.getElementById(GOOGLE_MAPS_SCRIPT_ID);
            const script = existing || document.createElement('script');

            const cleanup = () => {
                script.removeEventListener('load', onLoad);
                script.removeEventListener('error', onError);
            };
            const onLoad = () => {
                cleanup();
                if (window.google && window.google.maps) resolve();
                else reject(new Error('Google Maps loaded without the Maps API namespace.'));
            };
            const onError = () => {
                cleanup();
                googleMapsLoadPromise = null;
                reject(new Error('Google Maps script failed to load.'));
            };

            script.addEventListener('load', onLoad, { once: true });
            script.addEventListener('error', onError, { once: true });
            if (!existing) {
                script.id = GOOGLE_MAPS_SCRIPT_ID;
                script.async = true;
                script.defer = true;
                script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(GOOGLE_MAPS_BROWSER_KEY)}`;
                document.head.appendChild(script);
            }
        });

        return googleMapsLoadPromise;
    };

    const gavilanLocations = [
            {
                id: '8685e942-3f07-403a-afb6-faec697cd2cb',
                code: 'LACENTRAL',
                city: 'Los Angeles',
                crossStreets: 'Central/Washington',
                name: 'Los Angeles Central/Washington',
                address: '1900 S. Central Ave, Los Angeles, CA 90011',
                phone: '(213) 742-6677',
                lat: 34.023884,
                lng: -118.250561,
                order: 'https://order.online/store/tacos-gavilan-los-angeles-260847'
            },
            {
                id: '80a1ec95-bc73-402e-8884-e5abbe9343e6',
                code: 'LYNWOOD',
                city: 'Lynwood',
                crossStreets: 'Imperial/Long Beach',
                name: 'Lynwood Imperial/Long Beach',
                address: '3220 E. Imperial Hwy, Lynwood, CA 90262',
                phone: '(424) 785-5535',
                lat: 33.930001,
                lng: -118.21232,
                order: 'https://order.online/store/tacos-gavilan-lynwood-727877'
            },
            {
                id: '475bc112-187d-4b9c-884d-1f6a041698ce',
                code: 'LABROADWY',
                city: 'Los Angeles',
                crossStreets: 'Vernon/Broadway',
                name: 'Los Angeles Vernon/Broadway',
                address: '4380 S. Broadway, Los Angeles, CA 90037',
                phone: '(323) 233-2302',
                lat: 34.004005,
                lng: -118.278106,
                order: 'https://order.online/store/tacos-gavilan-los-angeles-260769'
            },
            {
                id: '42ed15a6-106b-466a-9076-1e8f72451f6b',
                code: 'NORWALK',
                city: 'Norwalk',
                crossStreets: 'Rosecrans/Studebaker',
                name: 'Norwalk Rosecrans/Studebaker',
                address: '10968 Rosecrans Ave, Norwalk, CA 90650',
                phone: '(562) 651-0045',
                lat: 33.90181,
                lng: -118.100403,
                order: 'https://order.online/store/tacos-gavilan-norwalk-1327857'
            },
            {
                id: '9625621e-1b5e-48d7-87ae-7094fab5a4fd',
                code: 'SLAUSON',
                city: 'Los Angeles',
                crossStreets: 'Slauson/Broadway',
                name: 'Los Angeles Slauson/Broadway',
                address: '5833 S. Broadway, Los Angeles, CA 90003',
                phone: '(323) 615-0084',
                lat: 33.98894,
                lng: -118.278609,
                order: 'https://order.online/store/tacos-gavilan-slauson-broadway-23989119'
            },
            {
                id: 'acf15327-54c8-4da4-8d0d-3ac0544dc422',
                code: 'RIALTO',
                city: 'Rialto',
                crossStreets: 'Baseline/Riverside',
                name: 'Rialto Baseline/Riverside',
                address: '115 E. Baseline Rd, Rialto, CA 92376',
                phone: '(909) 562-0430',
                lat: 34.1211,
                lng: -117.370048,
                order: 'https://order.online/store/tacos-gavilan-rialto-841931'
            },
            {
                id: '5f4a006e-9a6e-4bcf-b5bd-7f5e9d801a02',
                code: 'WCOVINA',
                city: 'West Covina',
                crossStreets: '10 FWY/Azusa',
                name: 'West Covina 10 FWY/Azusa',
                address: '101 S. Azusa Ave, West Covina, CA 91791',
                phone: '(626) 917-2662',
                lat: 34.070966,
                lng: -117.90815,
                order: 'https://order.online/store/tacos-gavilan-west-covina-725035'
            },
            {
                id: '95866cfc-eeb8-4af9-9586-f78931e1ea04',
                code: 'SOUTHGATE',
                city: 'South Gate',
                crossStreets: 'Firestone/Garfield',
                name: 'South Gate Firestone/Garfield',
                address: '5800 Firestone Blvd, South Gate, CA 90280',
                phone: '(562) 806-1200',
                lat: 33.948795,
                lng: -118.164767,
                order: 'https://order.online/store/tacos-gavilan-south-gate-846517'
            },
            {
                id: 'b7f63b01-f089-4ad7-a346-afdb1803dc1a',
                code: 'DOWNEY',
                city: 'Downey',
                crossStreets: 'Florence/Paramount',
                name: 'Downey Florence/Paramount',
                address: '7947 E. Florence Ave, Downey, CA 90240',
                phone: '(562) 927-7486',
                lat: 33.953703,
                lng: -118.130299,
                order: 'https://order.online/store/tacos-gavilan-downey-302620'
            },
            {
                id: '5fbb58f5-283c-4ea4-9415-04100ee6978b',
                code: 'HOLLYWOOD',
                city: 'Hollywood',
                crossStreets: 'Sunset/La Brea',
                name: 'Hollywood Sunset/La Brea',
                address: '7070 Sunset Blvd, Los Angeles, CA 90028',
                phone: '(323) 963-7993',
                lat: 34.097757,
                lng: -118.34389,
                order: 'https://order.online/store/tacos-gavilan-los-angeles-551916'
            },
            {
                id: '3c2d8251-c43c-43b8-8306-387e0a4ed7c2',
                code: 'SANTAANA',
                city: 'Santa Ana',
                crossStreets: '17th/Grand',
                name: 'Santa Ana 17th/Grand',
                address: '1258 E. 17th St, Santa Ana, CA 92701',
                phone: '(714) 480-0713',
                lat: 33.759621,
                lng: -117.852252,
                order: 'https://order.online/store/tacos-gavilan-santa-ana-724574'
            },
            {
                id: '47256ade-2cd4-4073-9632-84567ad9e2c8',
                code: 'HPARK',
                city: 'Huntington Park',
                crossStreets: 'Florence/Santa Fe',
                name: 'Huntington Park Florence/Santa Fe',
                address: '2425 E. Florence Ave, Huntington Park, CA 90255',
                phone: '(323) 581-7309',
                lat: 33.975055,
                lng: -118.229235,
                order: 'https://order.online/store/tacos-gavilan-huntington-park-260849'
            },
            {
                id: '3a803939-eb13-4def-a1a4-462df8e90623',
                code: 'LAPUENTE',
                city: 'La Puente',
                crossStreets: '605 FWY/Valley',
                name: 'La Puente 605 FWY/Valley',
                address: '13009 Valley Blvd, La Puente, CA 91746',
                phone: '(626) 336-3000',
                lat: 34.053251,
                lng: -118.001777,
                order: 'https://order.online/store/tacos-gavilan-la-puente-963464'
            },
            {
                id: 'e0345b1f-d6d6-40b2-bd06-5f9f4fd944e8',
                code: 'AZUSA',
                city: 'Azusa',
                crossStreets: 'Azusa/Arrow',
                name: 'Azusa Azusa/Arrow',
                address: '887 S. Azusa Ave, Azusa, CA 91702',
                phone: '(626) 969-1011',
                lat: 34.107074,
                lng: -117.908194,
                order: 'https://order.online/store/tacos-gavilan-azusa-718169'
            },
            {
                id: 'a83901db-2431-4283-834e-9502a2ba4b3b',
                code: 'BELL',
                city: 'Bell',
                crossStreets: 'Florence/Atlantic',
                name: 'Bell Florence/Atlantic',
                address: '4406 E Florence Ave, Bell, CA 90201',
                phone: '(323) 771-1722',
                lat: 33.970395,
                lng: -118.188871,
                order: 'https://order.online/store/tacos-gavilan-bell-260912'
            }
    ];

    const buildPopupContent = (loc, distance) => {
        const isEs = currentLang === 'es';
        const distHtml = (distance !== null && !isNaN(distance))
            ? `<div class="map-popup-distance">${distance.toFixed(1)} ${isEs ? 'millas de ti' : 'miles from you'}</div>`
            : '';
        const dirUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(loc.address)}`;
        const orderText = isEs ? 'Ordenar en Línea' : 'Order Online';
        const dirText = isEs ? 'Cómo llegar' : 'Directions';
        const phoneE164 = loc.phone ? `+1${loc.phone.replace(/\D/g, '')}` : '';
        const phoneHtml = loc.phone
            ? `<div class="map-popup-phone" style="margin-top: 4px; font-weight: 600;"><a href="tel:${phoneE164}" style="color: #FFC72C; text-decoration: none;">${loc.phone}</a></div>`
            : '';
        const titleHtml = loc.crossStreets
            ? `<div class="map-popup-name"><span class="map-popup-city">${loc.city || loc.name}</span> <span class="map-popup-cross" style="color: #FFC72C; font-weight: 700; display: block; font-size: 0.85em; margin-top: 2px;">${loc.crossStreets}</span></div>`
            : `<div class="map-popup-name">${loc.name}</div>`;

        return `<div class="map-popup">
            ${titleHtml}
            <div class="map-popup-address">${loc.address}</div>
            ${phoneHtml}
            ${distHtml}
            <div class="map-popup-actions">
                <a href="${loc.order}" target="_blank" rel="noopener noreferrer" class="map-popup-btn-order">${orderText}</a>
                <a href="${dirUrl}" target="_blank" rel="noopener noreferrer" class="map-popup-btn-directions">${dirText}</a>
            </div>
        </div>`;
    };

    const renderMapFallback = () => {
        const mapContainer = document.getElementById('gavilan-map');
        if (!mapContainer) return;

        const isEs = currentLang === 'es';
        const title = isEs ? 'Mapa no disponible' : 'Map Unavailable';
        const desc = isEs
            ? 'No se pudo cargar el mapa interactivo en este momento. Puedes consultar las direcciones y ordenar en línea de nuestras 15 sucursales a continuación.'
            : 'We were unable to load the interactive map right now. You can still access direct directions and online ordering for all 15 locations below.';
        const retryText = isEs ? 'Intentar de nuevo' : 'Try Again';
        const dirText = isEs ? 'Cómo llegar' : 'Directions';
        const orderText = isEs ? 'Ordenar en Línea' : 'Order Online';

        const itemsHtml = gavilanLocations.map(loc => {
            const dest = encodeURIComponent(loc.address);
            const dirUrl = `https://www.google.com/maps/dir/?api=1&destination=${dest}`;
            const headerHtml = loc.crossStreets
                ? `<h4>${loc.city || loc.name} <span style="color: #FFC72C; font-weight: 700; font-size: 0.88em;">${loc.crossStreets}</span></h4>`
                : `<h4>${loc.name}</h4>`;
            return `
                <div class="map-fallback-item">
                    <div class="map-fallback-item-info">
                        ${headerHtml}
                        <p>${loc.address} · ${loc.phone}</p>
                    </div>
                    <div class="map-fallback-item-actions">
                        <a href="${dirUrl}" target="_blank" rel="noopener noreferrer" class="map-fallback-btn-dir">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>
                            ${dirText}
                        </a>
                        <a href="${loc.order}" target="_blank" rel="noopener noreferrer" class="map-fallback-btn-order">
                            ${orderText}
                        </a>
                    </div>
                </div>
            `;
        }).join('');

        mapContainer.innerHTML = `
            <div class="map-fallback-card" role="region" aria-label="${title}">
                <svg class="map-fallback-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="8" x2="12" y2="12"></line>
                    <line x1="12" y1="16" x2="12.01" y2="16"></line>
                </svg>
                <h3 class="map-fallback-title">${title}</h3>
                <p class="map-fallback-desc">${desc}</p>
                <button type="button" class="map-fallback-retry-btn" id="map-retry-btn">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
                    <span>${retryText}</span>
                </button>
                <div class="map-fallback-list">
                    ${itemsHtml}
                </div>
            </div>
        `;

        const retryBtn = document.getElementById('map-retry-btn');
        if (retryBtn) {
            retryBtn.addEventListener('click', () => {
                mapInitialized = false;
                mapContainer.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#FFC72C;font-family:var(--ff-heading);font-weight:700;">${isEs ? 'Cargando mapa...' : 'Loading map...'}</div>`;
                setTimeout(() => {
                    initGavilanGoogleMap();
                }, 300);
            });
        }
    };

    function initGavilanGoogleMap() {
        const mapContainer = document.getElementById('gavilan-map');
        if (!mapContainer) return;

        if (typeof google === 'undefined' || !google.maps) {
            loadGoogleMapsApi()
                .then(tryInitMap)
                .catch((error) => {
                    console.warn('Google Maps is unavailable:', error);
                    mapInitialized = false;
                    renderMapFallback();
                });
            return;
        }

        tryInitMap();

        function tryInitMap() {
            try {
                mapContainer.innerHTML = '';

                const darkMapStyles = [
                    { elementType: "geometry", stylers: [{ color: "#212121" }] },
                    { elementType: "labels.icon", stylers: [{ visibility: "off" }] },
                    { elementType: "labels.text.fill", stylers: [{ color: "#757575" }] },
                    { elementType: "labels.text.stroke", stylers: [{ color: "#212121" }] },
                    { featureType: "administrative", elementType: "geometry", stylers: [{ color: "#757575" }] },
                    { featureType: "administrative.country", elementType: "labels.text.fill", stylers: [{ color: "#9e9e9e" }] },
                    { featureType: "administrative.locality", elementType: "labels.text.fill", stylers: [{ color: "#bdbdbd" }] },
                    { featureType: "poi", elementType: "labels.text.fill", stylers: [{ color: "#757575" }] },
                    { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#181818" }] },
                    { featureType: "poi.park", elementType: "labels.text.fill", stylers: [{ color: "#616161" }] },
                    { featureType: "poi.park", elementType: "labels.text.stroke", stylers: [{ color: "#1b1b1b" }] },
                    { featureType: "road", elementType: "geometry.fill", stylers: [{ color: "#2c2c2c" }] },
                    { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#8a8a8a" }] },
                    { featureType: "road.arterial", elementType: "geometry", stylers: [{ color: "#373737" }] },
                    { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#3c3c3c" }] },
                    { featureType: "road.highway.controlled_access", elementType: "geometry", stylers: [{ color: "#4e4e4e" }] },
                    { featureType: "road.local", elementType: "labels.text.fill", stylers: [{ color: "#616161" }] },
                    { featureType: "transit", elementType: "labels.text.fill", stylers: [{ color: "#757575" }] },
                    { featureType: "water", elementType: "geometry", stylers: [{ color: "#000000" }] },
                    { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#3d3d3d" }] }
                ];

                let savedTheme = safeStorage.getItem('tg_map_theme') || 'dark';

                const getThemeOptions = (theme) => {
                    if (theme === 'satellite') {
                        return { mapTypeId: 'hybrid', styles: [] };
                    }
                    if (theme === 'light') {
                        return { mapTypeId: 'roadmap', styles: [] };
                    }
                    return { mapTypeId: 'roadmap', styles: darkMapStyles };
                };

                const initialThemeOpts = getThemeOptions(savedTheme);

                const map = new google.maps.Map(mapContainer, {
                    center: { lat: 33.98, lng: -118.15 },
                    zoom: 10,
                    styles: initialThemeOpts.styles,
                    mapTypeId: initialThemeOpts.mapTypeId,
                    mapTypeControl: false,
                    streetViewControl: false,
                    fullscreenControl: false,
                    zoomControl: true,
                    gestureHandling: 'greedy'
                });
                window._gavilanGoogleMap = map;

                clearTimeout(mapTilesTimer);
                mapTilesTimer = setTimeout(() => {
                    if (!mapInitialized) {
                        console.warn('Google Maps tiles did not finish loading; showing accessible fallback.');
                        renderMapFallback();
                    }
                }, 12000);

                google.maps.event.addListenerOnce(map, 'tilesloaded', () => {
                    clearTimeout(mapTilesTimer);
                    mapInitialized = true;
                });

                const setMapTheme = (theme) => {
                    savedTheme = theme;
                    safeStorage.setItem('tg_map_theme', theme);
                    const opts = getThemeOptions(theme);
                    map.setMapTypeId(opts.mapTypeId);
                    map.setOptions({ styles: opts.styles });

                    const themeBtns = document.querySelectorAll('.map-theme-btn');
                    themeBtns.forEach(btn => {
                        const isActive = btn.getAttribute('data-theme') === theme;
                        btn.classList.toggle('is-active', isActive);
                        btn.setAttribute('aria-checked', isActive ? 'true' : 'false');
                    });
                };

                const themeBtns = document.querySelectorAll('.map-theme-btn');
                themeBtns.forEach(btn => {
                    btn.addEventListener('click', () => {
                        const theme = btn.getAttribute('data-theme');
                        if (theme) setMapTheme(theme);
                    });
                });

                setMapTheme(savedTheme);

                const bounds = new google.maps.LatLngBounds();
                const infoWindow = new google.maps.InfoWindow();
                window._gavilanInfoWindow = infoWindow;

                const pinIcon = {
                    path: "M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z",
                    fillColor: "#DA291C",
                    fillOpacity: 1,
                    strokeColor: "#FFC72C",
                    strokeWeight: 2,
                    scale: 1.5,
                    anchor: new google.maps.Point(12, 22)
                };

                const calcDistanceMiles = (lat1, lon1, lat2, lon2) => {
                    const R = 3958.8;
                    const dLat = (lat2 - lat1) * Math.PI / 180;
                    const dLon = (lon2 - lon1) * Math.PI / 180;
                    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                        Math.sin(dLon/2) * Math.sin(dLon/2);
                    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
                };

                const markers = gavilanLocations.map(loc => {
                    const marker = new google.maps.Marker({
                        position: { lat: loc.lat, lng: loc.lng },
                        map: map,
                        title: loc.name,
                        icon: pinIcon
                    });

                    bounds.extend(marker.getPosition());
                    marker._gavilanData = loc;

                    marker.addListener('click', () => {
                        window._activeGavilanMarker = marker;
                        infoWindow.setContent(buildPopupContent(loc, loc._lastDistance || null));
                        infoWindow.open(map, marker);
                    });

                    return marker;
                });

                window._gavilanMarkers = markers;
                window._gavilanBounds = bounds;

                // Geolocation "Find Me"
                const locateBtn = document.getElementById('map-locate-btn');
                const nearestInfo = document.getElementById('map-nearest-info');
                const nearestText = document.getElementById('map-nearest-text');
                let userMarker = null;

                if (locateBtn) {
                    locateBtn.addEventListener('click', () => {
                        if (!navigator.geolocation) {
                            if (nearestText && nearestInfo) {
                                nearestText.textContent = currentLang === 'es'
                                    ? 'Geolocalización no soportada en tu navegador.'
                                    : 'Geolocation is not supported by your browser.';
                                nearestInfo.style.display = 'flex';
                            }
                            return;
                        }

                        locateBtn.classList.add('locating');
                        const btnSpan = locateBtn.querySelector('span');
                        const originalText = btnSpan ? btnSpan.textContent : 'Find Me';
                        if (btnSpan) btnSpan.textContent = currentLang === 'es' ? 'Buscando...' : 'Locating...';

                        navigator.geolocation.getCurrentPosition(
                            (pos) => {
                                const userLatLng = { lat: pos.coords.latitude, lng: pos.coords.longitude };

                                if (userMarker) userMarker.setMap(null);

                                userMarker = new google.maps.Marker({
                                    position: userLatLng,
                                    map: map,
                                    title: currentLang === 'es' ? 'Tu ubicación' : 'Your Location',
                                    icon: {
                                        path: google.maps.SymbolPath.CIRCLE,
                                        fillColor: "#2563EB",
                                        fillOpacity: 1,
                                        strokeColor: "#FFFFFF",
                                        strokeWeight: 3,
                                        scale: 9
                                    },
                                    zIndex: 9999
                                });

                                userMarker.addListener('click', () => {
                                    infoWindow.setContent(`<div class="map-popup"><div class="map-popup-name">${currentLang === 'es' ? 'Tu ubicación' : 'Your Location'}</div></div>`);
                                    infoWindow.open(map, userMarker);
                                });

                                let nearest = null;
                                let minDist = Infinity;
                                let nearestMarker = null;

                                markers.forEach(m => {
                                    const loc = m._gavilanData;
                                    const d = calcDistanceMiles(userLatLng.lat, userLatLng.lng, loc.lat, loc.lng);
                                    loc._lastDistance = d;
                                    if (d < minDist) {
                                        minDist = d;
                                        nearest = loc;
                                        nearestMarker = m;
                                    }
                                });

                                if (nearest && nearestInfo && nearestText) {
                                    nearestText.textContent = currentLang === 'es'
                                        ? `Más cercano: ${nearest.name} (${minDist.toFixed(1)} mi)`
                                        : `Nearest: ${nearest.name} (${minDist.toFixed(1)} mi)`;
                                    nearestInfo.style.display = 'flex';
                                }

                                if (nearest && nearestMarker) {
                                    const userBounds = new google.maps.LatLngBounds();
                                    userBounds.extend(userLatLng);
                                    userBounds.extend(nearestMarker.getPosition());
                                    map.fitBounds(userBounds);

                                    setTimeout(() => {
                                        window._activeGavilanMarker = nearestMarker;
                                        infoWindow.setContent(buildPopupContent(nearest, minDist));
                                        infoWindow.open(map, nearestMarker);
                                    }, 500);
                                }

                                locateBtn.classList.remove('locating');
                                if (btnSpan) btnSpan.textContent = currentLang === 'es' ? 'Ubicado' : 'Located';
                                setTimeout(() => { if (btnSpan) btnSpan.textContent = originalText; }, 3000);
                            },
                            (err) => {
                                locateBtn.classList.remove('locating');
                                if (btnSpan) btnSpan.textContent = originalText;
                                if (nearestText && nearestInfo) {
                                    nearestText.textContent = currentLang === 'es'
                                        ? 'No se pudo acceder a tu ubicación. Verifica permisos.'
                                        : 'Location access denied or unavailable.';
                                    nearestInfo.style.display = 'flex';
                                }
                            },
                            { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
                        );
                    });
                }

                setTimeout(() => {
                    google.maps.event.trigger(map, 'resize');
                    map.fitBounds(bounds);
                }, 150);

            } catch (err) {
                console.error('Error during Google Maps initialization:', err);
                clearTimeout(mapTilesTimer);
                mapInitialized = false;
                renderMapFallback();
            }
        }
    }

    const openMapModal = () => {
        if (!mapOverlay) return;
        mapOverlay.style.display = 'flex';
        mapOverlay.offsetHeight;
        mapOverlay.classList.add('is-open');
        document.body.style.overflow = 'hidden';
        trapFocus(mapOverlay);

        setTimeout(() => {
            if (!mapInitialized) {
                initGavilanGoogleMap();
            } else if (window._gavilanGoogleMap) {
                google.maps.event.trigger(window._gavilanGoogleMap, 'resize');
                if (window._gavilanBounds) {
                    window._gavilanGoogleMap.fitBounds(window._gavilanBounds);
                }
            }
        }, 150);
    };

    const closeMapModal = () => {
        if (!mapOverlay || !mapOverlay.classList.contains('is-open')) return;
        mapOverlay.classList.remove('is-open');
        setTimeout(() => {
            mapOverlay.style.display = 'none';
            document.body.style.overflow = '';
        }, 300);
        releaseFocus();
    };

    if (mapOpenBtn) mapOpenBtn.addEventListener('click', openMapModal);
    if (mapCloseBtn) mapCloseBtn.addEventListener('click', closeMapModal);

    if (mapOverlay) {
        mapOverlay.addEventListener('click', (e) => {
            if (e.target === mapOverlay) closeMapModal();
        });
    }

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && mapOverlay && mapOverlay.classList.contains('is-open')) {
            closeMapModal();
        }
    });

    window.addEventListener('resize', () => {
        if (window._gavilanGoogleMap) {
            const isModalOpen = mapOverlay && mapOverlay.classList.contains('is-open');
            const mapEl = document.getElementById('gavilan-map');
            const isInline = mapEl && !mapEl.closest('.map-modal-overlay');
            if (isModalOpen || isInline) {
                google.maps.event.trigger(window._gavilanGoogleMap, 'resize');
                if (window._gavilanBounds) {
                    window._gavilanGoogleMap.fitBounds(window._gavilanBounds);
                }
            }
        }
    }, { passive: true });

    // Auto-initialize inline Google Map if container is embedded on page (e.g. /locations/)
    const inlineMapContainer = document.getElementById('gavilan-map');
    if (inlineMapContainer && !inlineMapContainer.closest('.map-modal-overlay')) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => initGavilanGoogleMap());
        } else {
            initGavilanGoogleMap();
        }
    }

    /* ==========================================================
       13. DISH PREVIEW LIGHTBOX MODAL
       ========================================================== */
    const lightboxOverlay = document.getElementById('lightbox-modal-overlay');
    const lightboxImg = document.getElementById('lightbox-img');
    const lightboxTitle = document.getElementById('lightbox-title');
    const lightboxDesc = document.getElementById('lightbox-desc');
    const lightboxCloseBtn = document.getElementById('lightbox-close');

    const openLightbox = (imgSrc, title, desc) => {
        if (!lightboxOverlay || !lightboxImg) return;
        lightboxImg.src = imgSrc;
        lightboxImg.alt = title || 'Tacos Gavilan';
        lightboxTitle.textContent = title || 'Tacos Gavilan';
        lightboxDesc.textContent = desc || 'Authentic Mexican food made fresh daily since 1992.';
        lightboxOverlay.style.display = 'flex';
        lightboxOverlay.offsetHeight;
        lightboxOverlay.classList.add('is-open');
        document.body.style.overflow = 'hidden';
        trapFocus(lightboxOverlay);
    };

    const closeLightbox = () => {
        if (!lightboxOverlay || !lightboxOverlay.classList.contains('is-open')) return;
        lightboxOverlay.classList.remove('is-open');
        setTimeout(() => {
            lightboxOverlay.style.display = 'none';
            document.body.style.overflow = '';
        }, 300);
        releaseFocus();
    };

    document.addEventListener('click', (e) => {
        const card = e.target.closest('.menu-item, .showcase-card');
        if (!card) return;
        if (e.target.tagName === 'A' || e.target.closest('a')) return;

        const img = card.querySelector('img');
        const nameEl = card.querySelector('.menu-item-name, .showcase-card-name');
        const descEl = card.querySelector('.menu-item-desc');

        if (img) {
            const titleText = nameEl ? nameEl.textContent.trim() : '';
            const descText = descEl ? descEl.textContent.trim() : '';
            openLightbox(img.src, titleText, descText);
        }
    });

    if (lightboxCloseBtn) lightboxCloseBtn.addEventListener('click', closeLightbox);

    if (lightboxOverlay) {
        lightboxOverlay.addEventListener('click', (e) => {
            if (e.target === lightboxOverlay) closeLightbox();
        });
    }

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && lightboxOverlay && lightboxOverlay.classList.contains('is-open')) {
            closeLightbox();
        }
    });

    /* ==========================================================
       14. LEGAL DIALOG CONTROLLER (PRIVACY, TERMS, ACCESSIBILITY)
       ========================================================== */
    const setupModal = (overlayId, openTriggerIds, closeTriggerIds) => {
        const overlay = document.getElementById(overlayId);
        if (!overlay) return;

        const openModal = (e) => {
            if (e) e.preventDefault();
            overlay.style.display = 'flex';
            overlay.offsetHeight;
            overlay.classList.add('is-open');
            document.body.style.overflow = 'hidden';
            trapFocus(overlay);
        };

        const closeModal = () => {
            if (!overlay.classList.contains('is-open')) return;
            overlay.classList.remove('is-open');
            setTimeout(() => {
                overlay.style.display = 'none';
                document.body.style.overflow = '';
            }, 300);
            releaseFocus();
        };

        openTriggerIds.forEach(id => {
            const btn = document.getElementById(id);
            if (btn) btn.addEventListener('click', openModal);
        });

        closeTriggerIds.forEach(id => {
            const btn = document.getElementById(id);
            if (btn) btn.addEventListener('click', closeModal);
        });

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeModal();
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && overlay.classList.contains('is-open')) {
                closeModal();
            }
        });
    };

    setupModal('privacy-modal-overlay', ['open-privacy-btn', 'contact-privacy-link'], ['privacy-modal-close']);
    setupModal('terms-modal-overlay', ['open-terms-btn'], ['terms-modal-close']);
    setupModal('accessibility-modal-overlay', ['open-accessibility-btn'], ['accessibility-modal-close']);

    const requestedLegalDialog = new URLSearchParams(window.location.search).get('legal');
    const legalDialogTriggers = {
        privacy: 'open-privacy-btn',
        terms: 'open-terms-btn',
        accessibility: 'open-accessibility-btn'
    };
    if (legalDialogTriggers[requestedLegalDialog]) {
        document.getElementById(legalDialogTriggers[requestedLegalDialog])?.click();
    }

    /* ==========================================================
       15. COOKIE CONSENT BANNER (CCPA / CPRA COMPLIANT)
       ========================================================= */
    const cookieBanner = document.getElementById('cookie-banner');
    const cookieAcceptBtn = document.getElementById('cookie-accept-btn');
    const cookieDeclineBtn = document.getElementById('cookie-decline-btn');

    const applyTrackingConsent = (isAccepted) => {
        const allowMarketing = isAccepted && !(typeof navigator !== 'undefined' && navigator.globalPrivacyControl === true);
        const allowAnalytics = isAccepted;

        window['ga-disable-UA-74752614-19'] = !allowAnalytics;

        if (typeof window.__tgLoadGTMIfConsented === 'function' && (allowAnalytics || allowMarketing)) {
            window.__tgLoadGTMIfConsented(allowAnalytics, allowMarketing);
        }
        if (typeof window.__tgLoadMarketingPixelsIfConsented === 'function' && allowMarketing) {
            window.__tgLoadMarketingPixelsIfConsented(allowMarketing);
        }

        // Meta / Facebook Pixel
        if (typeof window.fbq === 'function') {
            try {
                window.fbq('consent', allowMarketing ? 'grant' : 'revoke');
                if (!allowMarketing) {
                    window.fbq('dataProcessingOptions', ['LDU'], 1, 1000);
                } else {
                    window.fbq('dataProcessingOptions', []);
                }
            } catch (err) {
                console.warn('[Tacos Gavilan] Meta consent error:', err);
            }
        }

        // TikTok Pixel
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

        // Google Consent Mode v2 + Google Tag Manager / Analytics via dataLayer
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
                do_not_sell_california: allowMarketing ? 'opt_in' : 'opt_out'
            });
        } catch (err) {
            console.warn('[Tacos Gavilan] GTM dataLayer error:', err);
        }
    };

    const showCookieBanner = () => {
        if (!cookieBanner) return;
        // Respect California GPC
        if (typeof navigator !== 'undefined' && navigator.globalPrivacyControl === true) {
            safeStorage.setItem('tacosgavilan_cookie_consent', 'declined');
            applyTrackingConsent(false);
            return;
        }

        const consent = safeStorage.getItem('tacosgavilan_cookie_consent');
        if (!consent) {
            setTimeout(() => {
                cookieBanner.style.display = 'block';
                cookieBanner.offsetHeight;
                cookieBanner.classList.add('cookie-banner-visible');
                document.body.classList.add('has-cookie-banner');
                if (mobileStickyBar) mobileStickyBar.classList.remove('is-visible');
            }, 1200);
        } else {
            applyTrackingConsent(consent === 'accepted');
        }
    };

    const hideCookieBanner = () => {
        if (!cookieBanner) return;
        cookieBanner.classList.remove('cookie-banner-visible');
        document.body.classList.remove('has-cookie-banner');
        setTimeout(() => {
            cookieBanner.style.display = 'none';
            if (typeof updateStickyBar === 'function') updateStickyBar();
        }, 400);
    };

    if (cookieAcceptBtn) {
        cookieAcceptBtn.addEventListener('click', () => {
            safeStorage.setItem('tacosgavilan_cookie_consent', 'accepted');
            applyTrackingConsent(true);
            hideCookieBanner();
        });
    }

    if (cookieDeclineBtn) {
        cookieDeclineBtn.addEventListener('click', () => {
            safeStorage.setItem('tacosgavilan_cookie_consent', 'declined');
            safeStorage.removeItem('tacosgavilan_lang');
            safeStorage.removeItem('tg_map_theme');
            applyTrackingConsent(false);
            hideCookieBanner();
        });
    }

    showCookieBanner();

    /* ==========================================================
       16. MOBILE STICKY BOTTOM ACTION BAR CONTROLLER
       ========================================================== */
    const mobileStickyBar = document.getElementById('mobile-sticky-bar');

    const updateStickyBar = () => {
        if (!mobileStickyBar) return;
        if (window.innerWidth > 768) {
            mobileStickyBar.classList.remove('is-visible');
            return;
        }

        const isMenuOpen = document.body.classList.contains('menu-open');
        const isCookieOpen = document.body.classList.contains('has-cookie-banner');
        const isModalOpen = document.querySelector('.map-modal-overlay.is-open, .lightbox-modal-overlay.is-open, .privacy-modal-overlay.is-open');

        if (isMenuOpen || isModalOpen || isCookieOpen) {
            mobileStickyBar.classList.remove('is-visible');
            return;
        }

        if (window.scrollY > 280) {
            mobileStickyBar.classList.add('is-visible');
        } else {
            mobileStickyBar.classList.remove('is-visible');
        }
    };

    if (mobileStickyBar) {
        window.addEventListener('scroll', updateStickyBar, { passive: true });
        window.addEventListener('resize', updateStickyBar, { passive: true });
        updateStickyBar();
    }

    /* ==========================================================
       17. FOOTER MARQUEE FULL-WIDTH DUAL-TRACK CONTROLLER
       Ensures brand logos loop seamlessly across any screen resolution (1080p, 1440p, 4K).
       ========================================================== */
    const initFooterMarquee = () => {
        const marquee = document.querySelector('.footer-marquee');
        if (!marquee) return;

        let track = marquee.querySelector('.footer-marquee-track');
        // Backward compatibility if legacy .marquee-content is loaded
        if (!track) {
            const legacyContent = marquee.querySelector('.marquee-content');
            if (legacyContent) {
                track = document.createElement('div');
                track.className = 'footer-marquee-track';
                legacyContent.className = 'footer-marquee-set';
                track.appendChild(legacyContent);
                marquee.appendChild(track);
            }
        }
        if (!track) return;

        let sets = track.querySelectorAll('.footer-marquee-set');
        if (sets.length === 0) return;

        // If only 1 set exists, duplicate it so we have a 2-track seamless conveyor
        if (sets.length === 1) {
            const clone = sets[0].cloneNode(true);
            clone.setAttribute('aria-hidden', 'true');
            track.appendChild(clone);
            sets = track.querySelectorAll('.footer-marquee-set');
        }

        // Measure width: each set must be wider than the viewport + 400px
        const ensureSufficientWidth = () => {
            const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1920;
            const primarySet = sets[0];
            if (!primarySet) return;

            let currentWidth = primarySet.scrollWidth;
            let safetyLimit = 0;
            while (currentWidth > 0 && currentWidth < viewportWidth + 600 && safetyLimit < 5) {
                const items = Array.from(primarySet.children);
                items.forEach(child => {
                    primarySet.appendChild(child.cloneNode(true));
                });
                currentWidth = primarySet.scrollWidth;
                safetyLimit++;
            }

            // Sync second set with first set
            if (sets[1]) {
                sets[1].innerHTML = primarySet.innerHTML;
            }
        };

        ensureSufficientWidth();
        window.addEventListener('resize', ensureSufficientWidth, { passive: true });
    };

    initFooterMarquee();

    /* ==========================================================
       18. STORE DETAILS MODAL CONTROLLER (BILINGUAL IN-PAGE MODAL)
       Intercepts "Store Details" / "Details" links on Homepage and
       Locations page to display a rich modal instead of navigating away.
       Also auto-opens when ?store={slug} is present in the URL.
       ========================================================== */
    const storeCatalogBySlug = {
        'la-central': {
            code: 'LACENTRAL',
            thumb: '/img/Central_Gavilan_small-600.jpg',
            rows: [
                { dayEn: 'Sun – Wed', dayEs: 'Dom – Mié', time: '8:00 AM – 2:00 AM', highlight: false },
                { dayEn: 'Thursday', dayEs: 'Jueves', time: '8:00 AM – 3:00 AM', highlight: false },
                { dayEn: 'Fri – Sat', dayEs: 'Vie – Sáb', time: '8:00 AM – 4:00 AM', highlight: true }
            ]
        },
        'lynwood': {
            code: 'LYNWOOD',
            thumb: '/img/lynwood_thumb_new-600.jpg',
            rows: [
                { dayEn: 'Sun – Wed', dayEs: 'Dom – Mié', time: '10:00 AM – 1:00 AM', highlight: false },
                { dayEn: 'Thursday', dayEs: 'Jueves', time: '10:00 AM – 2:00 AM', highlight: false },
                { dayEn: 'Fri – Sat', dayEs: 'Vie – Sáb', time: '10:00 AM – 3:00 AM', highlight: true }
            ]
        },
        'la-broadway': {
            code: 'LABROADWY',
            thumb: '/img/broadway_thumb-600.jpg',
            rows: [
                { dayEn: 'Mon – Wed', dayEs: 'Lun – Mié', time: '8:00 AM – 1:00 AM', highlight: false },
                { dayEn: 'Thu & Sun', dayEs: 'Jue y Dom', time: '8:00 AM – 2:00 AM', highlight: false },
                { dayEn: 'Fri – Sat', dayEs: 'Vie – Sáb', time: '8:00 AM – 4:00 AM', highlight: true }
            ]
        },
        'norwalk': {
            code: 'NORWALK',
            thumb: '/img/norwalk_thumb.jpg',
            rows: [
                { dayEn: 'Sun – Thu', dayEs: 'Dom – Jue', time: '10:00 AM – 1:00 AM', highlight: false },
                { dayEn: 'Fri – Sat', dayEs: 'Vie – Sáb', time: '10:00 AM – 3:00 AM', highlight: true }
            ]
        },
        'slauson': {
            code: 'SLAUSON',
            thumb: '/img/broadway_thumb-600.jpg',
            rows: [
                { dayEn: 'Sun – Thu', dayEs: 'Dom – Jue', time: '10:00 AM – 1:00 AM', highlight: false },
                { dayEn: 'Fri – Sat', dayEs: 'Vie – Sáb', time: '10:00 AM – 3:00 AM', highlight: true }
            ]
        },
        'rialto': {
            code: 'RIALTO',
            thumb: '/img/rioalto_thumb-600.jpg',
            rows: [
                { dayEn: 'Sun – Thu', dayEs: 'Dom – Jue', time: '10:00 AM – 12:00 AM', highlight: false },
                { dayEn: 'Fri – Sat', dayEs: 'Vie – Sáb', time: '10:00 AM – 2:00 AM', highlight: true }
            ]
        },
        'west-covina': {
            code: 'WCOVINA',
            thumb: '/img/azusa_thumb-600.jpg',
            rows: [
                { dayEn: 'Sun – Thu', dayEs: 'Dom – Jue', time: '10:00 AM – 1:00 AM', highlight: false },
                { dayEn: 'Fri – Sat', dayEs: 'Vie – Sáb', time: '10:00 AM – 3:00 AM', highlight: true }
            ]
        },
        'south-gate': {
            code: 'SOUTHGATE',
            thumb: '/img/south_gate_thumb-600.jpg',
            rows: [
                { dayEn: 'Sun – Thu', dayEs: 'Dom – Jue', time: '10:00 AM – 12:00 AM', highlight: false },
                { dayEn: 'Fri – Sat', dayEs: 'Vie – Sáb', time: '10:00 AM – 3:00 AM', highlight: true }
            ]
        },
        'downey': {
            code: 'DOWNEY',
            thumb: '/img/downeylocation-600.jpg',
            rows: [
                { dayEn: 'Sun – Thu', dayEs: 'Dom – Jue', time: '10:00 AM – 12:00 AM', highlight: false },
                { dayEn: 'Fri – Sat', dayEs: 'Vie – Sáb', time: '10:00 AM – 3:00 AM', highlight: true }
            ]
        },
        'hollywood': {
            code: 'HOLLYWOOD',
            thumb: '/img/Hollywood_thumb-600.jpg',
            rows: [
                { dayEn: 'Sun – Thu', dayEs: 'Dom – Jue', time: '9:00 AM – 12:00 AM', highlight: false },
                { dayEn: 'Fri – Sat', dayEs: 'Vie – Sáb', time: '9:00 AM – 3:00 AM', highlight: true }
            ]
        },
        'santa-ana': {
            code: 'SANTAANA',
            thumb: '/img/Santa_Ana_Gavilan_small-600.jpg',
            rows: [
                { dayEn: 'Sun – Thu', dayEs: 'Dom – Jue', time: '10:00 AM – 12:00 AM', highlight: false },
                { dayEn: 'Fri – Sat', dayEs: 'Vie – Sáb', time: '10:00 AM – 2:00 AM', highlight: true }
            ]
        },
        'huntington-park': {
            code: 'HPARK',
            thumb: '/img/hp_thumb-600.jpg',
            rows: [
                { dayEn: 'Sun – Wed', dayEs: 'Dom – Mié', time: '10:00 AM – 12:00 AM', highlight: false },
                { dayEn: 'Thursday', dayEs: 'Jueves', time: '10:00 AM – 2:00 AM', highlight: false },
                { dayEn: 'Fri – Sat', dayEs: 'Vie – Sáb', time: '10:00 AM – 3:00 AM', highlight: true }
            ]
        },
        'la-puente': {
            code: 'LAPUENTE',
            thumb: '/img/Gavilan-Location-Thumbs-La_Puente.jpg',
            rows: [
                { dayEn: 'Sun – Thu', dayEs: 'Dom – Jue', time: '10:00 AM – 12:00 AM', highlight: false },
                { dayEn: 'Fri – Sat', dayEs: 'Vie – Sáb', time: '10:00 AM – 2:00 AM', highlight: true }
            ]
        },
        'azusa': {
            code: 'AZUSA',
            thumb: '/img/azusa_thumb-600.jpg',
            rows: [
                { dayEn: 'Sun – Thu', dayEs: 'Dom – Jue', time: '10:00 AM – 11:00 PM', highlight: false },
                { dayEn: 'Fri – Sat', dayEs: 'Vie – Sáb', time: '10:00 AM – 12:00 AM', highlight: true }
            ]
        },
        'bell': {
            code: 'BELL',
            thumb: '/img/bell_thumb-600.jpg',
            rows: [
                { dayEn: 'Sun – Thu', dayEs: 'Dom – Jue', time: '10:00 AM – 12:00 AM', highlight: false },
                { dayEn: 'Fri – Sat', dayEs: 'Vie – Sáb', time: '10:00 AM – 2:00 AM', highlight: true }
            ]
        }
    };

    let activeStoreSlug = null;

    const ensureStoreDetailsModalDom = () => {
        let overlay = document.getElementById('store-details-modal-overlay');
        if (overlay) return overlay;

        const styleEl = document.createElement('style');
        styleEl.id = 'store-details-modal-styles';
        styleEl.textContent = `
            .store-details-modal-overlay {
                position: fixed;
                inset: 0;
                z-index: 10050;
                background: rgba(0, 0, 0, 0.82);
                backdrop-filter: blur(10px);
                -webkit-backdrop-filter: blur(10px);
                display: none;
                align-items: center;
                justify-content: center;
                padding: 1rem;
                opacity: 0;
                transition: opacity 0.25s ease;
            }
            .store-details-modal-overlay.is-open {
                opacity: 1;
            }
            .store-details-modal {
                position: relative;
                width: 100%;
                max-width: 480px;
                max-height: 92dvh;
                overflow-y: auto;
                background: #161412;
                border: 1px solid rgba(255, 199, 44, 0.28);
                border-radius: 18px;
                box-shadow: 0 28px 80px rgba(0, 0, 0, 0.85);
                color: #ffffff;
                transform: translateY(14px) scale(0.98);
                transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1);
            }
            .store-details-modal-overlay.is-open .store-details-modal {
                transform: translateY(0) scale(1);
            }
            .store-modal-banner {
                position: relative;
                width: 100%;
                height: 165px;
                background: #222;
                overflow: hidden;
            }
            .store-modal-banner img {
                width: 100%;
                height: 100%;
                object-fit: cover;
                display: block;
            }
            .store-modal-banner::after {
                content: '';
                position: absolute;
                inset: 0;
                background: linear-gradient(180deg, rgba(0,0,0,0.35) 0%, rgba(22,20,18,0.98) 100%);
            }
            .store-modal-close {
                position: absolute;
                top: 12px;
                right: 12px;
                z-index: 3;
                width: 42px;
                height: 42px;
                border-radius: 50%;
                background: rgba(0, 0, 0, 0.72);
                border: 1px solid rgba(255, 199, 44, 0.45);
                color: #ffffff;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                transition: background 0.2s, transform 0.2s, border-color 0.2s;
            }
            .store-modal-close:hover {
                background: #DA291C;
                border-color: #DA291C;
                transform: scale(1.06);
            }
            .store-modal-body {
                padding: 0 1.5rem 1.6rem;
                margin-top: -1.4rem;
                position: relative;
                z-index: 2;
            }
            .store-modal-tag {
                display: inline-block;
                font-size: 0.7rem;
                font-weight: 800;
                letter-spacing: 0.1em;
                text-transform: uppercase;
                color: #FFC72C;
                background: rgba(255, 199, 44, 0.12);
                border: 1px solid rgba(255, 199, 44, 0.3);
                padding: 0.25rem 0.65rem;
                border-radius: 999px;
                margin-bottom: 0.55rem;
            }
            .store-modal-title {
                margin: 0 0 0.9rem;
                font-family: var(--ff-heading, sans-serif);
                display: flex;
                flex-direction: column;
                gap: 0.15rem;
            }
            .store-modal-city {
                font-size: 1.65rem;
                font-weight: 800;
                color: #ffffff;
                line-height: 1.15;
            }
            .store-modal-cross {
                font-size: 1.02rem;
                font-weight: 700;
                color: #FFC72C;
                letter-spacing: 0.02em;
            }
            .store-modal-info-list {
                display: flex;
                flex-direction: column;
                gap: 0.6rem;
                margin-bottom: 1rem;
            }
            .store-modal-info-item {
                display: flex;
                align-items: center;
                gap: 0.65rem;
                font-size: 0.95rem;
                color: rgba(255, 255, 255, 0.9);
            }
            .store-modal-info-item svg {
                flex-shrink: 0;
                stroke: #FFC72C;
            }
            .store-modal-info-item a {
                color: #FFC72C;
                font-weight: 700;
                text-decoration: none;
            }
            .store-modal-info-item a:hover {
                text-decoration: underline;
                color: #ffffff;
            }
            .store-modal-schedule {
                background: rgba(0, 0, 0, 0.52);
                border: 1px solid rgba(255, 199, 44, 0.22);
                border-radius: 12px;
                padding: 0.85rem 1.05rem;
                margin: 0.85rem 0 1.25rem;
                display: flex;
                flex-direction: column;
                gap: 0.45rem;
            }
            .store-modal-schedule-header {
                display: flex;
                align-items: center;
                gap: 0.45rem;
                font-size: 0.73rem;
                font-weight: 700;
                text-transform: uppercase;
                letter-spacing: 0.08em;
                color: #FFC72C;
                padding-bottom: 0.4rem;
                border-bottom: 1px solid rgba(255, 255, 255, 0.08);
            }
            .store-modal-schedule-header svg {
                stroke: #FFC72C;
                flex-shrink: 0;
            }
            .store-modal-schedule-rows {
                display: flex;
                flex-direction: column;
                gap: 0.35rem;
            }
            .store-modal-schedule-row {
                display: flex;
                justify-content: space-between;
                align-items: center;
                font-size: 0.88rem;
                line-height: 1.35;
                gap: 0.75rem;
            }
            .store-modal-schedule-day {
                color: rgba(255, 255, 255, 0.84);
                font-weight: 500;
            }
            .store-modal-schedule-time {
                color: #ffffff;
                font-weight: 700;
                font-variant-numeric: tabular-nums;
                text-align: right;
                white-space: nowrap;
            }
            .store-modal-schedule-row.is-highlight .store-modal-schedule-time {
                color: #FFC72C;
            }
            .store-modal-actions {
                display: flex;
                flex-direction: column;
                gap: 0.65rem;
            }
            .store-modal-btn-order {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                gap: 0.5rem;
                width: 100%;
                padding: 0.9rem 1.2rem;
                background: #DA291C;
                color: #ffffff;
                font-weight: 800;
                font-size: 0.95rem;
                text-transform: uppercase;
                letter-spacing: 0.04em;
                border-radius: 10px;
                text-decoration: none;
                transition: background 0.2s, transform 0.15s;
            }
            .store-modal-btn-order:hover {
                background: #b91c1c;
                transform: translateY(-1px);
            }
            .store-modal-btn-directions {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                gap: 0.5rem;
                width: 100%;
                padding: 0.8rem 1.2rem;
                background: rgba(255, 255, 255, 0.06);
                border: 1px solid rgba(255, 255, 255, 0.25);
                color: #ffffff;
                font-weight: 700;
                font-size: 0.9rem;
                border-radius: 10px;
                text-decoration: none;
                transition: border-color 0.2s, color 0.2s, background 0.2s;
            }
            .store-modal-btn-directions:hover {
                border-color: #FFC72C;
                color: #FFC72C;
                background: rgba(255, 199, 44, 0.08);
            }
        `;
        document.head.appendChild(styleEl);

        overlay = document.createElement('div');
        overlay.id = 'store-details-modal-overlay';
        overlay.className = 'store-details-modal-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-labelledby', 'store-modal-title');
        overlay.innerHTML = `<div class="store-details-modal" id="store-details-modal-content"></div>`;
        document.body.appendChild(overlay);

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeStoreDetailsModal();
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && overlay.classList.contains('is-open')) {
                closeStoreDetailsModal();
            }
        });

        return overlay;
    };

    const renderStoreDetailsModalContent = (slug) => {
        const meta = storeCatalogBySlug[slug];
        if (!meta) return false;
        const loc = gavilanLocations.find(l => l.code === meta.code);
        if (!loc) return false;

        const isEs = currentLang === 'es';
        const phoneE164 = `+1${loc.phone.replace(/\D/g, '')}`;
        const dirUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(loc.address)}`;
        const tagText = isEs ? 'Tacos Gavilan · Detalles de Sucursal' : 'Tacos Gavilan · Store Details';
        const hoursTitle = isEs ? 'Horarios' : 'Hours';
        const orderBtnText = isEs ? 'Ordenar en Línea' : 'Order Online';
        const dirBtnText = isEs ? 'Cómo llegar en Google Maps' : 'Get Directions in Google Maps';
        const closeLabel = isEs ? 'Cerrar detalles de sucursal' : 'Close store details';

        const scheduleRowsHtml = meta.rows.map(r => `
            <div class="store-modal-schedule-row${r.highlight ? ' is-highlight' : ''}">
                <span class="store-modal-schedule-day">${isEs ? r.dayEs : r.dayEn}</span>
                <span class="store-modal-schedule-time">${r.time}</span>
            </div>
        `).join('');

        const container = document.getElementById('store-details-modal-content');
        if (!container) return false;

        container.innerHTML = `
            <div class="store-modal-banner">
                <img src="${meta.thumb}" alt="Tacos Gavilan ${loc.name}" loading="eager">
                <button type="button" class="store-modal-close" id="store-details-modal-close" aria-label="${closeLabel}">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
            </div>
            <div class="store-modal-body">
                <span class="store-modal-tag">${tagText}</span>
                <h2 class="store-modal-title" id="store-modal-title">
                    <span class="store-modal-city">${loc.city}</span>
                    <span class="store-modal-cross">${loc.crossStreets}</span>
                </h2>
                <div class="store-modal-info-list">
                    <div class="store-modal-info-item">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                        <span>${loc.address}</span>
                    </div>
                    <div class="store-modal-info-item">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                        <a href="tel:${phoneE164}">${loc.phone}</a>
                    </div>
                </div>
                <div class="store-modal-schedule">
                    <div class="store-modal-schedule-header">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                        <span>${hoursTitle}</span>
                    </div>
                    <div class="store-modal-schedule-rows">
                        ${scheduleRowsHtml}
                    </div>
                </div>
                <div class="store-modal-actions">
                    <a href="${loc.order}" target="_blank" rel="noopener noreferrer" class="store-modal-btn-order">${orderBtnText}</a>
                    <a href="${dirUrl}" target="_blank" rel="noopener noreferrer" class="store-modal-btn-directions">${dirBtnText}</a>
                </div>
            </div>
        `;

        const closeBtn = document.getElementById('store-details-modal-close');
        if (closeBtn) closeBtn.addEventListener('click', closeStoreDetailsModal);
        return true;
    };

    const openStoreDetailsModal = (slug) => {
        if (!storeCatalogBySlug[slug]) return;
        activeStoreSlug = slug;
        const overlay = ensureStoreDetailsModalDom();
        if (!renderStoreDetailsModalContent(slug)) return;

        overlay.style.display = 'flex';
        overlay.offsetHeight;
        overlay.classList.add('is-open');
        document.body.style.overflow = 'hidden';
        if (typeof updateStickyBar === 'function') updateStickyBar();
        trapFocus(overlay);
    };

    const closeStoreDetailsModal = () => {
        const overlay = document.getElementById('store-details-modal-overlay');
        if (!overlay || !overlay.classList.contains('is-open')) return;
        overlay.classList.remove('is-open');
        activeStoreSlug = null;

        // Clean ?store= from URL if present so refreshing doesn't re-trigger
        try {
            const url = new URL(window.location.href);
            if (url.searchParams.has('store')) {
                url.searchParams.delete('store');
                window.history.replaceState({}, '', url.pathname + url.search + url.hash);
            }
        } catch (e) {}

        setTimeout(() => {
            overlay.style.display = 'none';
            document.body.style.overflow = '';
            if (typeof updateStickyBar === 'function') updateStickyBar();
        }, 250);
        releaseFocus();
    };

    // Intercept clicks on any store details link (/locations/{slug}/ or ./{slug}/)
    document.addEventListener('click', (e) => {
        const link = e.target.closest('a');
        if (!link) return;
        const rawHref = link.getAttribute('href') || '';
        // Match /locations/{slug}/ or ./{slug}/
        const match = rawHref.match(/(?:^\/locations\/|^\.\/)([a-z0-9-]+)\/?$/i);
        if (match && storeCatalogBySlug[match[1]]) {
            e.preventDefault();
            openStoreDetailsModal(match[1]);
        }
    });

    // Re-render modal content live if language is toggled while modal is open
    if (langToggleBtn) {
        langToggleBtn.addEventListener('click', () => {
            if (activeStoreSlug) {
                renderStoreDetailsModalContent(activeStoreSlug);
            }
        });
    }

    // Auto-open modal if URL has ?store={slug}
    const initialStoreSlug = new URLSearchParams(window.location.search).get('store');
    if (initialStoreSlug && storeCatalogBySlug[initialStoreSlug]) {
        openStoreDetailsModal(initialStoreSlug);
    }

});

