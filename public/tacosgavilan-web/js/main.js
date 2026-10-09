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
            if (el && !container.contains(el)) {
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

    const releaseFocus = () => {
        if (trapKeyHandler) {
            document.removeEventListener('keydown', trapKeyHandler);
            trapKeyHandler = null;
        }

        const landmarks = ['#header', '#main-content', '#footer'];
        landmarks.forEach(sel => {
            const el = document.querySelector(sel);
            if (el) el.removeAttribute('inert');
        });

        if (previousActiveElement && typeof previousActiveElement.focus === 'function') {
            previousActiveElement.focus();
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
    const nav = document.getElementById('nav');
    const navDrawerClose = document.getElementById('nav-drawer-close');
    const navLinks = document.querySelectorAll('.nav-link');

    const openMenu = () => {
        if (!mobileToggle || !nav) return;
        nav.classList.add('nav-open');
        mobileToggle.classList.add('active');
        mobileToggle.setAttribute('aria-expanded', 'true');
        document.body.classList.add('menu-open');
        trapFocus(nav);
    };

    const closeMenu = () => {
        if (!nav || !nav.classList.contains('nav-open')) return;
        nav.classList.remove('nav-open');
        if (mobileToggle) {
            mobileToggle.classList.remove('active');
            mobileToggle.setAttribute('aria-expanded', 'false');
        }
        document.body.classList.remove('menu-open');
        releaseFocus();
    };

    if (mobileToggle && nav) {
        mobileToggle.addEventListener('click', () => {
            if (nav.classList.contains('nav-open')) {
                closeMenu();
            } else {
                openMenu();
            }
        });

        if (navDrawerClose) {
            navDrawerClose.addEventListener('click', closeMenu);
        }

        navLinks.forEach(link => {
            link.addEventListener('click', closeMenu);
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && nav.classList.contains('nav-open')) {
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
                const offsetPosition = elementPosition + window.scrollY - headerHeight;

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

                const response = await fetch('/api/contact', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                const result = await response.json();

                if (response.ok && (result.ok || result.success)) {
                    contactForm.reset();
                    if (contactStatus) {
                        contactStatus.className = 'contact-status success';
                        contactStatus.textContent = translations[currentLang]['contact.successMsg'];
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

    // Careers preselection from URL hash or link click
    const handleCareersPreselection = () => {
        const hash = window.location.hash;
        const reasonSelect = document.getElementById('reason');
        if (hash === '#careers' && reasonSelect) {
            reasonSelect.value = 'careers';
            const contactSec = document.getElementById('contact');
            if (contactSec) {
                const headerHeight = header ? header.offsetHeight : 70;
                const top = contactSec.getBoundingClientRect().top + window.scrollY - headerHeight;
                window.scrollTo({ top, behavior: 'smooth' });
            }
        }
    };

    window.addEventListener('hashchange', handleCareersPreselection);
    handleCareersPreselection();

    /* ==========================================================
       11. BILINGUAL DICTIONARY & SAFE DOM TRANSLATION ENGINE
       ========================================================== */
    const translations = {
        en: {
            'a11y.skipToContent': 'Skip to main content',

            // Navigation
            'nav.about':     'About',
            'nav.menu':      'Menu',
            'nav.catering':  'Catering',
            'nav.locations': 'Locations',
            'nav.contact':   'Contact',
            'nav.order':     'Order Now',

            // Hero
            'hero.badge':    'TRADITION SINCE 1992 · 15 LOCATIONS IN SOUTHERN CALIFORNIA',
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

            // Menu
            'menu.title':    'Our Menu',
            'menu.subtitle': 'Choose your favorite from 9 categories, each prepared with traditional recipes and authentic flavor.',

            'menu.tab.tacos':       'Tacos',
            'menu.tab.burritos':    'Burritos',
            'menu.tab.quesadillas': 'Quesadillas',
            'menu.tab.mulitas':     'Mulitas',
            'menu.tab.sopes':       'Sopes',
            'menu.tab.tortas':      'Tortas',
            'menu.tab.platos':      'Platos',
            'menu.tab.nachos':      'Nachos',
            'menu.tab.drinks':      'Aguas Frescas',

            'menu.tacos.name':           'Tacos de Asada',
            'menu.tacos.desc':           'Charbroiled steak served plain on warm corn tortillas. Customize your order through Toast.',
            'menu.tacoPastor.name':      'Tacos al Pastor',
            'menu.tacoPastor.desc':      'Al pastor served plain on warm corn tortillas. Customize your order through Toast.',
            'menu.tacoPollo.name':       'Tacos de Pollo',
            'menu.tacoPollo.desc':       'Chicken served plain on warm corn tortillas. Customize your order through Toast.',
            'menu.tacoCarnitas.name':    'Tacos de Carnitas',
            'menu.tacoCarnitas.desc':    'Carnitas served plain on warm corn tortillas. Customize your order through Toast.',
            'menu.tacoCabeza.name':      'Tacos de Cabeza',
            'menu.tacoCabeza.desc':      'Cabeza served plain on warm corn tortillas. Customize your order through Toast.',
            'menu.tacoLengua.name':      'Tacos de Lengua',
            'menu.tacoLengua.desc':      'Lengua served plain on warm corn tortillas. Customize your order through Toast.',
            'menu.tacoBuche.name':       'Tacos de Buche',
            'menu.tacoBuche.desc':       'Buche served plain on warm corn tortillas. Customize your order through Toast.',
            'menu.tacoChorizo.name':     'Tacos de Chorizo',
            'menu.tacoChorizo.desc':     'Mexican sausage served plain on warm corn tortillas. Customize your order through Toast.',
            'menu.tacoPlate.name':       'Taco Plate',
            'menu.tacoPlate.desc':       'Three tacos of your choice served with seasoned Mexican rice and slow-cooked pinto beans.',
            'menu.burrito.name':         'Burrito',
            'menu.burrito.desc':         'Your choice of meat wrapped in a large flour tortilla with rice, pinto beans, onions, and cilantro.',
            'menu.superBurrito.name':    'Super Burrito',
            'menu.superBurrito.desc':    'Choice of meat with rice, beans, cheese, sour cream, and guacamole.',
            'menu.quesadilla.name':      'Quesadilla',
            'menu.quesadilla.desc':      'Flour tortilla with melted cheese and your choice of meat.',
            'menu.superQuesadilla.name': 'Super Quesadilla',
            'menu.superQuesadilla.desc': 'Melted cheese quesadilla stuffed with meat, crowned with fresh guacamole and cool Mexican crema.',
            'menu.mulita.name':          'Mulita',
            'menu.mulita.desc':          'Two warm corn tortillas toasted with melted cheese, your choice of meat, onions, and cilantro.',
            'menu.superMulita.name':     'Super Mulita',
            'menu.superMulita.desc':     'Double-stacked mulita layered with melted cheese, choice of meat, creamy avocado guacamole, and crema.',
            'menu.sopes.name':           'Sopes',
            'menu.sopes.desc':           'Traditional thick corn base with refried beans, choice of meat, crisp shredded lettuce, crema, and cotija cheese.',
            'menu.torta.name':           'Torta',
            'menu.torta.desc':           'Toasted telera bread layered with choice of meat, mayo, fresh avocado, lettuce, tomato, beans, and queso.',
            'menu.plato.name':           'Plato',
            'menu.plato.desc':           'Hearty dinner plate with your choice of meat, seasoned rice, refried beans, garden salad, guacamole, and warm tortillas.',
            'menu.nachos.name':          'Super Nachos',
            'menu.nachos.desc':          'Crisp tortilla chips drenched in warm cheese, piled high with meat, pinto beans, sour cream, and guacamole.',
            'menu.horchata.name':        'Agua de Horchata',
            'menu.horchata.desc':        'Traditional refreshing Mexican rice and cinnamon agua fresca, served cold over ice.',
            'menu.jamaica.name':         'Agua de Jamaica',
            'menu.jamaica.desc':         'Tart and refreshing steeped hibiscus flower infusion, sweetened to perfection and served ice cold.',
            'menu.tamarindo.name':       'Agua de Tamarindo',
            'menu.tamarindo.desc':       'Traditional Mexican tamarind agua fresca, tart, sweet, and served cold over ice.',
            'menu.meatCalloutTitle':     'All items available with:',
            'menu.meatList':             'Asada · Pastor · Pollo · Carnitas · Cabeza · Lengua · Buche · Chorizo · Vegetarian',
            'menu.meatOptions':          'All items available with: Asada · Pastor · Pollo · Carnitas · Cabeza · Lengua · Buche · Chorizo · Vegetarian',

            // Fiesta / Catering
            'fiesta.title':    'Fiesta Platters',
            'fiesta.subtitle': 'Feed 15 to 40+ guests',
            'fiesta.desc':     'Make your event unforgettable. Our Fiesta Platters include your choice of meats, rice, beans, aguas frescas, salsas, and all the serving essentials. Catering platters available across our locations.',
            'fiesta.f1':       'Office meetings & corporate events',
            'fiesta.f2':       'Birthdays & quinceañeras',
            'fiesta.f3':       'Family gatherings',
            'fiesta.f4':       'Game day & watch parties',
            'fiesta.btn':      'Inquire Now',

            // Locations
            'locations.title':        'Our Locations',
            'locations.subtitle':     'Find the nearest Tacos Gavilan and order online.',
            'locations.mapBtn':       'Find Nearest Location on Map',
            'locations.mapTitle':     'Find Your Nearest Location',
            'locations.orderBtn':     'Order Online',
            'locations.directions':   'Directions',
            'locations.storeDetails': 'Store Details',
            'locations.hoursBadge':   '15 Southern California Locations',

            // Map
            'map.findMe':          'Find Me',
            'map.themeDark':       'Dark',
            'map.themeLight':      'Light',
            'map.themeSatellite':  'Satellite',
            'map.errorTitle':      'Map Unavailable',
            'map.errorDesc':       'We were unable to load the interactive map right now. You can still access direct directions and online ordering for all 15 locations below.',
            'map.retry':           'Try Again',
            'map.milesFromYou':    'miles from you',
            'map.popupOrder':      'Order Online',
            'map.popupDirections': 'Directions',

            // Contact
            'contact.title':          'Get in Touch',
            'contact.subtitle':       'Have questions about catering, careers, or just want to say hi? We\'d love to hear from you.',
            'contact.name':           'Name *',
            'contact.email':          'Email *',
            'contact.phone':          'Phone (Optional)',
            'contact.reason':         'Topic *',
            'contact.reasonGeneral':  'General Inquiry',
            'contact.reasonCatering': 'Fiesta / Catering',
            'contact.reasonFeedback': 'Customer Feedback',
            'contact.reasonCareers':  'Careers & Employment',
            'contact.reasonAccessibility': 'Accessibility Assistance',
            'contact.reasonOther':    'Other Inquiry',
            'contact.store':          'Nearest Store (Optional)',
            'contact.storeSelect':    'Select a location...',
            'contact.message':        'Message *',
            'contact.privacyNotice':  'By submitting, you agree to our <a href="#" id="contact-privacy-link">Privacy Policy</a>.',
            'contact.send':           'Send Message',
            'contact.sending':        'Sending...',
            'contact.sent':           'Message Sent!',
            'contact.successMsg':     'Thank you! Your message has been received. Our team will get back to you shortly.',
            'contact.errorMsg':       'Could not send message. Please verify your details or call us at (310) 870-7009.',

            // Footer
            'footer.desc':           'Authentic Mexican food serving Southern California since 1992. From our family to yours — Ya está.',
            'footer.quickLinks':     'Quick Links',
            'footer.hoursHeading':   'HOURS',
            'footer.hoursText':      'Hours vary by location — check your nearest restaurant',
            'footer.contactHeading': 'CONTACT',
            'footer.privacy':        'Privacy Policy',
            'footer.terms':          'Terms of Use',
            'footer.accessibility':  'Accessibility',
            'footer.cookieSettings': 'Privacy Choices',

            // Cookies
            'cookie.title':   'Privacy & Cookie Choices',
            'cookie.message': 'This site stores functional preferences such as language and map theme. Google Maps loads only when you open the interactive locator. We do not currently use advertising or analytics cookies.',
            'cookie.accept':  'Allow Preferences',
            'cookie.decline': 'Necessary Only',

            // Legal Modals
            'privacy.title':        'Privacy Policy & California Privacy Notice (CCPA/CPRA)',
            'privacy.intro':        'Effective and last updated October 9, 2026. Tacos Gavilan explains here what this website collects, why it is used, and the choices available to California visitors.',
            'privacy.h1':           '1. Information We Collect',
            'privacy.p1':           'Our hosting and security services may process IP address, browser User Agent, request time, and language preferences to deliver and protect the site. Vercel hosts the website; Supabase stores contact submissions; Toast handles orders; Google provides fonts and the optional interactive map.',
            'privacy.formFieldsH':  '2. Contact Form Inquiries',
            'privacy.formFieldsP':  'When you submit our contact form, we collect your name, email address, phone number (optional), nearest store selection, topic, and message solely to respond to your inquiry and prevent automated abuse.',
            'privacy.retentionH':   '3. Data Retention Criteria',
            'privacy.retentionP':   'Contact messages are retained according to operational and legal needs and then deleted or de-identified. Tacos Gavilan must approve a specific retention schedule before one is promised publicly.',
            'privacy.h2':           '4. Do Not Sell or Share Personal Information',
            'privacy.p2':           'This website is not used to sell personal information or share it for cross-context behavioral advertising. It does not use advertising cookies. Google Maps loads only after you request the interactive locator; Toast processes orders on its own website.',
            'privacy.rightsH':      '5. Your California Privacy Rights (CCPA / CPRA)',
            'privacy.rightsP':      'California residents may request access, correction, or deletion and will not receive discriminatory treatment for exercising applicable rights. Email info@tacosgavilan.com or call (310) 870-7009. We may request information needed to verify the request. Because this website does not sell or share data for behavioral advertising, Global Privacy Control does not change advertising behavior here.',

            'terms.title': 'Terms of Use',
            'terms.intro': 'Welcome to Tacos Gavilan. By accessing or using our website, you agree to comply with and be bound by the following Terms of Use.',
            'terms.h1':    '1. Online Ordering & External Payment Processing',
            'terms.p1':    'All online food orders, pickup, delivery, pricing, payment processing, and transaction receipts are powered exclusively through Toast POS / order.online. Tacos Gavilan does not store or process payment card details on this website.',
            'terms.h2':    '2. Intellectual Property & Brand Standards',
            'terms.p2':    'All content, logos, food photography, graphics, and trade dress on this website are the property of Tacos Gavilan. Reproduction or redistribution without prior written authorization is strictly prohibited.',
            'terms.h3':    '3. Accuracy of Information',
            'terms.p3':    'While we strive for complete accuracy, menu offerings, ingredients, item availability, and operating hours may vary by restaurant location and day. Refer to order.online for real-time item availability at each location.',

            'accessibility.title':        'Accessibility Statement',
            'accessibility.intro':        'Tacos Gavilan is committed to digital accessibility and ensuring our website is welcoming and accessible to all guests, including individuals with disabilities.',
            'accessibility.h1':           'Our Standards & Conformance',
            'accessibility.p1':           'We use WCAG 2.2 AA as our accessibility target and continue testing keyboard navigation, contrast, text resizing, alternative text, focus management, and screen-reader semantics. This statement describes an ongoing effort, not a certification of perfect conformance.',
            'accessibility.lastUpdatedH': 'Last Reviewed & Alternatives',
            'accessibility.lastUpdatedP': 'Last reviewed: October 2026. If any portion of the site presents an accessibility barrier, you may also place orders directly via Toast POS (order.online) or contact your nearest location by phone.',
            'accessibility.h2':           'Feedback & Assistance',
            'accessibility.p2':           'If you encounter any difficulty viewing or navigating content on this website, or notice any feature that you believe is not fully accessible, please contact our team at (310) 870-7009 or email info@tacosgavilan.com with "Website Accessibility" in the subject line. We welcome your feedback and are glad to assist.'
        },

        es: {
            'a11y.skipToContent': 'Saltar al contenido principal',

            // Navegación
            'nav.about':     'Nosotros',
            'nav.menu':      'Menú',
            'nav.catering':  'Eventos',
            'nav.locations': 'Ubicaciones',
            'nav.contact':   'Contacto',
            'nav.order':     'Ordenar',

            // Hero
            'hero.badge':    'TRADICIÓN DESDE 1992 · 15 SUCURSALES EN EL SUR DE CALIFORNIA',
            'hero.title':    'Auténtica\nComida\nMexicana',
            'hero.subtitle': 'Desde 1992 · 15 Ubicaciones · Los Ángeles y el Sur de California',
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
            'showcase.nachos':      'Súper Nachos',
            'showcase.quesadillas': 'Quesadillas',

            // Nosotros
            'about.tag':       'TRADICIÓN & PASIÓN',
            'about.title':     'Nuestra Historia',
            'about.p1':        'Desde 1992, Tacos Gavilan ha llevado el auténtico sabor de México a Los Ángeles. Lo que comenzó como una sola taquería se ha convertido en 15 ubicaciones sirviendo a miles de familias cada día.',
            'about.p2':        'Nos enorgullece preparar recetas tradicionales y cocinar con pasión. Desde nuestro tradicional al pastor hasta nuestras salsas de la casa, cada comida refleja décadas de dedicación culinaria.',
            'about.locations': 'Ubicaciones',
            'about.since':     'Desde',
            'about.meats':     'Tipos de Carne',

            // Menú
            'menu.title':    'Nuestro Menú',
            'menu.subtitle': 'Elige tu favorito de 9 categorías preparadas con recetas tradicionales y sabor auténtico.',

            'menu.tab.tacos':       'Tacos',
            'menu.tab.burritos':    'Burritos',
            'menu.tab.quesadillas': 'Quesadillas',
            'menu.tab.mulitas':     'Mulitas',
            'menu.tab.sopes':       'Sopes',
            'menu.tab.tortas':      'Tortas',
            'menu.tab.platos':      'Platos',
            'menu.tab.nachos':      'Nachos',
            'menu.tab.drinks':      'Aguas Frescas',

            'menu.tacos.name':           'Tacos de Asada',
            'menu.tacos.desc':           'Carne asada servida sola en tortillas de maíz calientes. Personaliza tu orden en Toast.',
            'menu.tacoPastor.name':      'Tacos al Pastor',
            'menu.tacoPastor.desc':      'Al pastor servido solo en tortillas de maíz calientes. Personaliza tu orden en Toast.',
            'menu.tacoPollo.name':       'Tacos de Pollo',
            'menu.tacoPollo.desc':       'Pollo servido solo en tortillas de maíz calientes. Personaliza tu orden en Toast.',
            'menu.tacoCarnitas.name':    'Tacos de Carnitas',
            'menu.tacoCarnitas.desc':    'Carnitas servidas solas en tortillas de maíz calientes. Personaliza tu orden en Toast.',
            'menu.tacoCabeza.name':      'Tacos de Cabeza',
            'menu.tacoCabeza.desc':      'Cabeza servida sola en tortillas de maíz calientes. Personaliza tu orden en Toast.',
            'menu.tacoLengua.name':      'Tacos de Lengua',
            'menu.tacoLengua.desc':      'Lengua servida sola en tortillas de maíz calientes. Personaliza tu orden en Toast.',
            'menu.tacoBuche.name':       'Tacos de Buche',
            'menu.tacoBuche.desc':       'Buche servido solo en tortillas de maíz calientes. Personaliza tu orden en Toast.',
            'menu.tacoChorizo.name':     'Tacos de Chorizo',
            'menu.tacoChorizo.desc':     'Salchicha mexicana servida sola en tortillas de maíz calientes. Personaliza tu orden en Toast.',
            'menu.tacoPlate.name':       'Plato de Tacos',
            'menu.tacoPlate.desc':       'Tres tacos a tu elección servidos con arroz mexicano sazonado y frijoles refritos cocinados a fuego lento.',
            'menu.burrito.name':         'Burrito',
            'menu.burrito.desc':         'Tu elección de carne envuelta en tortilla de harina grande con arroz, frijoles, cebolla y cilantro fresco.',
            'menu.superBurrito.name':    'Súper Burrito',
            'menu.superBurrito.desc':    'Tu elección de carne con arroz, frijoles, queso, crema y guacamole.',
            'menu.quesadilla.name':      'Quesadilla',
            'menu.quesadilla.desc':      'Tortilla de harina con queso fundido y tu carne preferida.',
            'menu.superQuesadilla.name': 'Súper Quesadilla',
            'menu.superQuesadilla.desc': 'Quesadilla dorada con queso y carne, coronada con guacamole fresco de aguacate y crema mexicana.',
            'menu.mulita.name':          'Mulita',
            'menu.mulita.desc':          'Dos tortillas de maíz con queso fundido, tu carne preferida, cebolla y cilantro.',
            'menu.superMulita.name':     'Súper Mulita',
            'menu.superMulita.desc':     'Doble piso de tortilla con queso fundido, carne al gusto, guacamole artesanal y crema agria.',
            'menu.sopes.name':           'Sopes',
            'menu.sopes.desc':           'Base tradicional de maíz con frijoles refritos, tu carne preferida, lechuga fresca, crema y queso cotija.',
            'menu.torta.name':           'Torta',
            'menu.torta.desc':           'Telera tostada con mayonesa, tu carne favorita, aguacate fresco, lechuga, tomate, frijoles y queso.',
            'menu.plato.name':           'Plato',
            'menu.plato.desc':           'Platillo completo con tu carne preferida, arroz sazonado, frijoles, ensalada fresca, guacamole y tortillas calientes.',
            'menu.nachos.name':          'Súper Nachos',
            'menu.nachos.desc':          'Totopos crujientes de maíz bañados en queso caliente, frijoles, tu carne favorita, crema y guacamole.',
            'menu.horchata.name':        'Agua de Horchata',
            'menu.horchata.desc':        'Agua fresca tradicional de arroz y canela servida con hielo.',
            'menu.jamaica.name':         'Agua de Jamaica',
            'menu.jamaica.desc':         'Infusión natural de flor de jamaica 100% auténtica, dulce, refrescante y servida con mucho hielo.',
            'menu.tamarindo.name':       'Agua de Tamarindo',
            'menu.tamarindo.desc':       'Agua fresca tradicional de tamarindo, refrescante y servida bien fría.',
            'menu.meatCalloutTitle':     'Todos los platillos disponibles con:',
            'menu.meatList':             'Asada · Pastor · Pollo · Carnitas · Cabeza · Lengua · Buche · Chorizo · Vegetariano',
            'menu.meatOptions':          'Todos los platillos disponibles con: Asada · Pastor · Pollo · Carnitas · Cabeza · Lengua · Buche · Chorizo · Vegetariano',

            // Fiesta / Eventos
            'fiesta.title':    'Fiesta Platters',
            'fiesta.subtitle': 'Para 15 a 40+ invitados',
            'fiesta.desc':     'Haz tu evento inolvidable. Nuestras charolas de fiesta incluyen carnes al gusto, arroz, frijoles, aguas frescas, salsas y desechables. Charolas para eventos disponibles en todas nuestras sucursales.',
            'fiesta.f1':       'Reuniones de trabajo y eventos corporativos',
            'fiesta.f2':       'Cumpleaños y quinceañeras',
            'fiesta.f3':       'Reuniones familiares y aniversarios',
            'fiesta.f4':       'Partidos y eventos deportivos',
            'fiesta.btn':      'Cotizar Ahora',

            // Ubicaciones
            'locations.title':        'Nuestras Ubicaciones',
            'locations.subtitle':     'Encuentra tu Tacos Gavilan más cercano y ordena en línea.',
            'locations.mapBtn':       'Ver Sucursales en el Mapa',
            'locations.mapTitle':     'Encuentra Tu Sucursal Más Cercana',
            'locations.orderBtn':     'Ordenar en Línea',
            'locations.directions':   'Cómo llegar',
            'locations.storeDetails': 'Ver Sucursal',
            'locations.hoursBadge':   '15 Sucursales en el Sur de California',

            // Mapa
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
            'contact.title':          'Contáctanos',
            'contact.subtitle':       '¿Tienes preguntas sobre taquizas, empleo o comentarios? Nos encantará atenderte.',
            'contact.name':           'Nombre *',
            'contact.email':          'Correo Electrónico *',
            'contact.phone':          'Teléfono (Opcional)',
            'contact.reason':         'Motivo de Consulta *',
            'contact.reasonGeneral':  'Consulta General',
            'contact.reasonCatering': 'Fiesta / Eventos',
            'contact.reasonFeedback': 'Comentarios de Servicio',
            'contact.reasonCareers':  'Empleo y Oportunidades',
            'contact.reasonAccessibility': 'Asistencia de Accesibilidad',
            'contact.reasonOther':    'Otra Consulta',
            'contact.store':          'Sucursal Más Cercana (Opcional)',
            'contact.storeSelect':    'Selecciona una sucursal...',
            'contact.message':        'Mensaje *',
            'contact.privacyNotice':  'Al enviar este formulario, aceptas nuestra <a href="#" id="contact-privacy-link">Política de Privacidad</a>.',
            'contact.send':           'Enviar Mensaje',
            'contact.sending':        'Enviando...',
            'contact.sent':           '¡Mensaje Enviado!',
            'contact.successMsg':     '¡Gracias! Tu mensaje ha sido recibido. Nuestro equipo te responderá a la brevedad.',
            'contact.errorMsg':       'No se pudo enviar el mensaje. Por favor verifica tus datos o llámanos al (310) 870-7009.',

            // Footer
            'footer.desc':           'Auténtica comida mexicana sirviendo al Sur de California desde 1992. De nuestra familia a la tuya — Ya está.',
            'footer.quickLinks':     'Enlaces Rápidos',
            'footer.hoursHeading':   'HORARIO',
            'footer.hoursText':      'Los horarios varían por sucursal — consulta tu restaurante más cercano',
            'footer.contactHeading': 'CONTACTO',
            'footer.privacy':        'Política de Privacidad',
            'footer.terms':          'Términos de Uso',
            'footer.accessibility':  'Accesibilidad',
            'footer.cookieSettings': 'Opciones de Privacidad',

            // Cookies
            'cookie.title':   'Opciones de Privacidad y Cookies',
            'cookie.message': 'Este sitio guarda preferencias funcionales como idioma y tema del mapa. Google Maps se carga sólo al abrir el localizador interactivo. Actualmente no usamos cookies de publicidad ni analítica.',
            'cookie.accept':  'Permitir Preferencias',
            'cookie.decline': 'Sólo Necesarias',

            // Modales Legales
            'privacy.title':        'Política de Privacidad y Aviso de California (CCPA/CPRA)',
            'privacy.intro':        'Vigente y actualizada el 9 de octubre de 2026. Tacos Gavilan explica aquí qué recopila este sitio, para qué se usa y qué opciones tienen los visitantes de California.',
            'privacy.h1':           '1. Información que Recopilamos',
            'privacy.p1':           'Los servicios de alojamiento y seguridad pueden procesar dirección IP, User Agent, hora de solicitud y preferencias de idioma para entregar y proteger el sitio. Vercel aloja la web; Supabase guarda formularios; Toast procesa pedidos; Google proporciona fuentes y el mapa interactivo opcional.',
            'privacy.formFieldsH':  '2. Formulario de Contacto',
            'privacy.formFieldsP':  'Al enviar el formulario de contacto, recopilamos tu nombre, correo, teléfono (opcional), sucursal elegida, motivo y mensaje únicamente para responder tu solicitud y prevenir abusos automatizados.',
            'privacy.retentionH':   '3. Criterios de Retención de Datos',
            'privacy.retentionP':   'Los mensajes se conservan según necesidades operativas y legales y después se eliminan o desidentifican. Tacos Gavilan debe aprobar un plazo específico antes de prometerlo públicamente.',
            'privacy.h2':           '4. No Venta ni Cesión de Datos Personales',
            'privacy.p2':           'Este sitio no se utiliza para vender información personal ni compartirla para publicidad conductual entre contextos. No usa cookies publicitarias. Google Maps se carga sólo al solicitar el localizador y Toast procesa pedidos en su propio sitio.',
            'privacy.rightsH':      '5. Tus Derechos de Privacidad en California (CCPA / CPRA)',
            'privacy.rightsP':      'Los residentes de California pueden solicitar acceso, corrección o eliminación sin recibir trato discriminatorio por ejercer derechos aplicables. Escribe a info@tacosgavilan.com o llama al (310) 870-7009. Podremos solicitar datos para verificar la petición. Como este sitio no vende ni comparte datos para publicidad conductual, Global Privacy Control no cambia el comportamiento publicitario aquí.',

            'terms.title': 'Términos de Uso',
            'terms.intro': 'Bienvenido a Tacos Gavilan. Al acceder y navegar en nuestro sitio web, aceptas quedar sujeto a los siguientes Términos de Uso.',
            'terms.h1':    '1. Pedidos en Línea y Pagos Externos',
            'terms.p1':    'Todos los pedidos en línea, menú transaccional, precios y cobros se gestionan de forma independiente a través de Toast POS (order.online). Tacos Gavilan no guarda datos de pago en este sitio de marca.',
            'terms.h2':    '2. Propiedad Intelectual y Normas de Marca',
            'terms.p2':    'Todos los contenidos, nombres comerciales, fotografías y diseños son propiedad exclusiva de Tacos Gavilan. Queda prohibida su reproducción sin consentimiento expreso por escrito.',
            'terms.h3':    '3. Exactitud de la Información',
            'terms.p3':    'Las recetas, insumos, disponibilidad de platillos y horarios pueden tener ligeras variaciones por sucursal. Consulta en order.online para conocer la disponibilidad exacta al momento de tu orden.',

            'accessibility.title':        'Declaración de Accesibilidad',
            'accessibility.intro':        'Tacos Gavilan promueve la accesibilidad universal para que todas las personas disfruten de nuestra experiencia digital sin barreras.',
            'accessibility.h1':           'Nuestros Estándares y Cumplimiento',
            'accessibility.p1':           'Usamos WCAG 2.2 AA como objetivo y seguimos evaluando teclado, contraste, ampliación de texto, textos alternativos, manejo del foco y semántica para lectores de pantalla. Esta declaración describe un esfuerzo continuo, no una certificación de conformidad perfecta.',
            'accessibility.lastUpdatedH': 'Última Revisión y Alternativas',
            'accessibility.lastUpdatedP': 'Última revisión: Octubre 2026. Si alguna sección del sitio presenta una barrera de acceso, puedes realizar pedidos directamente mediante Toast POS (order.online) o comunicarte vía telefónica con tu sucursal más cercana.',
            'accessibility.h2':           'Asistencia y Contacto',
            'accessibility.p2':           'Si encuentras alguna dificultad al navegar o requieres apoyo, llámanos al (310) 870-7009 o escríbenos a info@tacosgavilan.com con el asunto "Accesibilidad Web". Estaremos atentos a asistirte.'
        }
    };

    const applyTranslations = () => {
        const elements = document.querySelectorAll('[data-i18n]');
        elements.forEach(el => {
            const key = el.getAttribute('data-i18n');
            const translation = translations[currentLang]?.[key];
            if (translation === undefined) return;

            const hasChildren = el.children.length > 0;
            if (!hasChildren) {
                if (translation.includes('<') && translation.includes('>')) {
                    el.innerHTML = translation;
                } else {
                    el.textContent = translation;
                }
            } else {
                const targetSpan = el.querySelector('span:not([aria-hidden="true"])') || el.querySelector('span');
                if (targetSpan) {
                    targetSpan.textContent = translation;
                } else if (!el.querySelector('svg, img, canvas')) {
                    if (translation.includes('<') && translation.includes('>')) {
                        el.innerHTML = translation;
                    } else {
                        el.textContent = translation;
                    }
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
                id: 'e0345b1f-d6d6-40b2-bd06-5f9f4fd944e8',
                code: 'AZUSA',
                name: 'Azusa',
                address: '887 S. Azusa Ave, Azusa, CA 91702',
                phone: '(626) 969-7988',
                lat: 34.107074,
                lng: -117.908194,
                order: 'https://order.online/store/tacos-gavilan-azusa-718169'
            },
            {
                id: 'a83901db-2431-4283-834e-9502a2ba4b3b',
                code: 'BELL',
                name: 'Bell',
                address: '4406 E Florence Ave, Bell, CA 90201',
                phone: '(323) 560-8451',
                lat: 33.970395,
                lng: -118.188871,
                order: 'https://order.online/store/tacos-gavilan-bell-260912'
            },
            {
                id: 'b7f63b01-f089-4ad7-a346-afdb1803dc1a',
                code: 'DOWNEY',
                name: 'Downey',
                address: '7947 E. Florence Ave, Downey, CA 90240',
                phone: '(562) 806-0310',
                lat: 33.953703,
                lng: -118.130299,
                order: 'https://order.online/store/tacos-gavilan-downey-302620'
            },
            {
                id: '5fbb58f5-283c-4ea4-9415-04100ee6978b',
                code: 'HOLLYWOOD',
                name: 'Hollywood',
                address: '7070 Sunset Blvd, Los Angeles, CA 90028',
                phone: '(323) 469-2313',
                lat: 34.097757,
                lng: -118.34389,
                order: 'https://order.online/store/tacos-gavilan-los-angeles-551916'
            },
            {
                id: '47256ade-2cd4-4073-9632-84567ad9e2c8',
                code: 'HPARK',
                name: 'Huntington Park',
                address: '2425 E. Florence Ave, Huntington Park, CA 90255',
                phone: '(323) 583-0940',
                lat: 33.975055,
                lng: -118.229235,
                order: 'https://order.online/store/tacos-gavilan-huntington-park-260849'
            },
            {
                id: '3a803939-eb13-4def-a1a4-462df8e90623',
                code: 'LAPUENTE',
                name: 'La Puente',
                address: '13009 Valley Blvd, La Puente, CA 91746',
                phone: '(626) 968-3565',
                lat: 34.053251,
                lng: -118.001777,
                order: 'https://order.online/store/tacos-gavilan-la-puente-963464'
            },
            {
                id: '475bc112-187d-4b9c-884d-1f6a041698ce',
                code: 'LABROADWY',
                name: 'LA Broadway',
                address: '4380 S. Broadway, Los Angeles, CA 90037',
                phone: '(323) 235-5858',
                lat: 34.004005,
                lng: -118.278106,
                order: 'https://order.online/store/tacos-gavilan-los-angeles-260769'
            },
            {
                id: '8685e942-3f07-403a-afb6-faec697cd2cb',
                code: 'LACENTRAL',
                name: 'LA Central',
                address: '1900 S. Central Ave, Los Angeles, CA 90011',
                phone: '(213) 749-0117',
                lat: 34.023884,
                lng: -118.250561,
                order: 'https://order.online/store/tacos-gavilan-los-angeles-260847'
            },
            {
                id: '80a1ec95-bc73-402e-8884-e5abbe9343e6',
                code: 'LYNWOOD',
                name: 'Lynwood',
                address: '3220 E. Imperial Hwy, Lynwood, CA 90262',
                phone: '(310) 639-6799',
                lat: 33.930001,
                lng: -118.21232,
                order: 'https://order.online/store/tacos-gavilan-lynwood-727877'
            },
            {
                id: '42ed15a6-106b-466a-9076-1e8f72451f6b',
                code: 'NORWALK',
                name: 'Norwalk',
                address: '10968 Rosecrans Ave, Norwalk, CA 90650',
                phone: '(562) 868-8099',
                lat: 33.90181,
                lng: -118.100403,
                order: 'https://order.online/store/tacos-gavilan-norwalk-1327857'
            },
            {
                id: 'acf15327-54c8-4da4-8d0d-3ac0544dc422',
                code: 'RIALTO',
                name: 'Rialto',
                address: '115 E. Baseline Rd, Rialto, CA 92376',
                phone: '(909) 877-0331',
                lat: 34.1211,
                lng: -117.370048,
                order: 'https://order.online/store/tacos-gavilan-rialto-841931'
            },
            {
                id: '3c2d8251-c43c-43b8-8306-387e0a4ed7c2',
                code: 'SANTAANA',
                name: 'Santa Ana',
                address: '1258 E. 17th St, Santa Ana, CA 92701',
                phone: '(714) 543-8226',
                lat: 33.759621,
                lng: -117.852252,
                order: 'https://order.online/store/tacos-gavilan-santa-ana-724574'
            },
            {
                id: '9625621e-1b5e-48d7-87ae-7094fab5a4fd',
                code: 'SLAUSON',
                name: 'Slauson',
                address: '5833 S. Broadway, Los Angeles, CA 90003',
                phone: '(323) 232-2300',
                lat: 33.98894,
                lng: -118.278609,
                order: 'https://order.online/store/tacos-gavilan-slauson-broadway-23989119'
            },
            {
                id: '95866cfc-eeb8-4af9-9586-f78931e1ea04',
                code: 'SOUTHGATE',
                name: 'South Gate',
                address: '5800 Firestone Blvd, South Gate, CA 90280',
                phone: '(562) 928-8777',
                lat: 33.948795,
                lng: -118.164767,
                order: 'https://order.online/store/tacos-gavilan-south-gate-846517'
            },
            {
                id: '5f4a006e-9a6e-4bcf-b5bd-7f5e9d801a02',
                code: 'WCOVINA',
                name: 'West Covina',
                address: '101 S. Azusa Ave, West Covina, CA 91791',
                phone: '(626) 915-0551',
                lat: 34.070966,
                lng: -117.90815,
                order: 'https://order.online/store/tacos-gavilan-west-covina-725035'
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

        return `<div class="map-popup">
            <div class="map-popup-name">${loc.name}</div>
            <div class="map-popup-address">${loc.address}</div>
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
            return `
                <div class="map-fallback-item">
                    <div class="map-fallback-item-info">
                        <h4>${loc.name}</h4>
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
        if (window._gavilanGoogleMap && mapOverlay && mapOverlay.classList.contains('is-open')) {
            google.maps.event.trigger(window._gavilanGoogleMap, 'resize');
            if (window._gavilanBounds) {
                window._gavilanGoogleMap.fitBounds(window._gavilanBounds);
            }
        }
    }, { passive: true });

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

    setupModal('privacy-modal-overlay', ['open-privacy-btn', 'open-cookie-settings-btn', 'contact-privacy-link'], ['privacy-modal-close']);
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

    const showCookieBanner = () => {
        if (!cookieBanner) return;
        const consent = safeStorage.getItem('tacosgavilan_cookie_consent');
        if (!consent) {
            setTimeout(() => {
                cookieBanner.style.display = 'block';
                cookieBanner.offsetHeight;
                cookieBanner.classList.add('cookie-banner-visible');
                document.body.classList.add('has-cookie-banner');
                if (mobileStickyBar) mobileStickyBar.classList.remove('is-visible');
            }, 1200);
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
            hideCookieBanner();
        });
    }

    if (cookieDeclineBtn) {
        cookieDeclineBtn.addEventListener('click', () => {
            safeStorage.setItem('tacosgavilan_cookie_consent', 'declined');
            safeStorage.removeItem('tacosgavilan_lang');
            safeStorage.removeItem('tg_map_theme');
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

});
