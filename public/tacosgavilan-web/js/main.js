/**
 * @module TacosGavilan/Main
 * @description Official client-side animation engine, bilingual translation controller (EN/ES),
 * interactive Leaflet store locator map, accessible dialog overlays, and live serverless contact pipeline.
 *
 * @businessRules
 *   1. Toast POS (order.online) is the exclusive transactional ordering system for Tacos Gavilan.
 *      All corporate CTAs (Header, Hero, Mobile Drawer, Sticky Bottom Bar, Footer) route to the
 *      corporate selector: https://order.online/business/-137616.
 *   2. Exactly 15 active Southern California locations. Slauson maps to Store ID 23989119, LA Broadway
 *      to 260769, and West Covina to canonical 725035.
 *   3. Strict brand name: strictly "Tacos Gavilan" (zero "El Gavilan", zero emojis).
 *   4. Full bilingual support (EN/ES) persisted via localStorage['tacosgavilan_lang'].
 *   5. Contact form routes asynchronously to Vercel Serverless /api/contact, guarded with
 *      in-memory rate limiting and honeypot bot trap, persisting to Supabase contact_submissions.
 *   6. Pre-processed WebP assets; zero runtime canvas pixel scanning on main thread.
 *
 * @dataFlow
 *   - data/stores.json -> static HTML cards in index.html & gavilanLocations Leaflet markers.
 *   - #contact-form -> POST /api/contact -> Supabase public.contact_submissions.
 *   - Leaflet Map -> CartoDB Voyager tiles with OpenStreetMap attribution.
 *
 * @notes
 *   - Slauson / LA Broadway store ID collision resolved (Slauson assigned 23989119).
 *   - Fixed translation text node replacement to prevent destroying child SVGs.
 *   - Enhanced keyboard accessibility (WCAG 2.2 AA) with focus management and ESC listeners.
 */

document.addEventListener('DOMContentLoaded', () => {

    /* ==========================================================
       0. SHARED STATE & INITIALIZATION
       ========================================================== */
    const savedLang = localStorage.getItem('tacosgavilan_lang');
    let currentLang = (savedLang === 'es' || savedLang === 'en') ? savedLang : 'en';
    const isDesktop = window.matchMedia('(pointer: fine)').matches;

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

    const closeMenu = () => {
        if (mobileToggle) {
            mobileToggle.classList.remove('active');
            mobileToggle.setAttribute('aria-expanded', 'false');
        }
        if (nav) nav.classList.remove('nav-open');
        document.body.classList.remove('menu-open');
    };

    if (mobileToggle && nav) {
        mobileToggle.addEventListener('click', () => {
            const isOpen = nav.classList.toggle('nav-open');
            mobileToggle.classList.toggle('active', isOpen);
            mobileToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
            document.body.classList.toggle('menu-open', isOpen);
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
                mobileToggle.focus();
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
       Robust progressive enhancement:
       - Content is 100% visible by default in HTML/CSS.
       - Only enables animations if JS is running, IntersectionObserver
         is supported, and user does NOT prefer reduced motion.
       - Initial viewport & hero elements get .is-visible immediately.
       - As elements enter viewport, adds .is-visible.
       - Fallback automatically reveals everything if any failure occurs.
       ========================================================== */
    const animSelector = '.animate-up, .fade-in-up, .fade-in-left, .fade-in-right, .fade-in, .text-reveal';
    const animElements = document.querySelectorAll(animSelector);

    const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (!prefersReducedMotion && 'IntersectionObserver' in window && animElements.length > 0) {
        try {
            // Enable animation classes in CSS now that JS and IntersectionObserver are verified
            document.documentElement.classList.add('js-animations-enabled');

            // Helper to reveal an element safely
            const revealElement = (el) => {
                el.classList.add('is-visible');
                el.classList.add('is-revealed'); // Backwards-compatible duplicate
            };

            // Observer for scroll-triggered elements
            const revealObserver = new IntersectionObserver((entries, observer) => {
                entries.forEach(entry => {
                    // Check either isIntersecting or if element has already scrolled into view
                    if (entry.isIntersecting || entry.boundingClientRect.top < window.innerHeight) {
                        revealElement(entry.target);
                        observer.unobserve(entry.target);
                    }
                });
            }, {
                root: null,
                rootMargin: '0px 0px 80px 0px', // Pre-trigger 80px before entering viewport
                threshold: 0.01 // Trigger as soon as 1% is visible
            });

            animElements.forEach(el => {
                // If element is in hero or already within the visible viewport on load, reveal immediately!
                const rect = el.getBoundingClientRect();
                const isHero = el.closest('.hero, #home, #hero') !== null;
                const isInInitialViewport = rect.top < (window.innerHeight || document.documentElement.clientHeight);

                if (isHero || isInInitialViewport) {
                    revealElement(el);
                } else {
                    revealObserver.observe(el);
                }
            });

            // Safety net: on full window load or after 500ms, reveal any elements currently in viewport
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
        // Fallback: If no IntersectionObserver or reduced motion, reveal everything immediately
        animElements.forEach(el => {
            el.classList.add('is-visible');
            el.classList.add('is-revealed');
        });
    }

    /* ==========================================================
       7. MENU CATEGORY TABS & ARIA TABLIST FILTERING
       Smooth Cross-Fade Transition & Default Tacos Filter
       ========================================================== */
    const menuTabs = document.querySelectorAll('.menu-tab');
    const menuItems = document.querySelectorAll('.menu-item');
    const menuGrid = document.getElementById('menu-grid');
    let isMenuTransitioning = false;

    function filterMenuCategory(category, isImmediate = false) {
        if (!menuGrid || menuItems.length === 0) return;

        // Update active tab & ARIA attributes
        menuTabs.forEach(t => {
            const isSelected = t.getAttribute('data-category') === category;
            t.classList.toggle('active', isSelected);
            t.setAttribute('aria-selected', isSelected ? 'true' : 'false');
            if (isSelected && t.id) {
                menuGrid.setAttribute('aria-labelledby', t.id);
            }
        });

        if (isImmediate) {
            // Immediate filter without transition (used on initial page load)
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
            return;
        }

        if (isMenuTransitioning) return;
        isMenuTransitioning = true;

        // Lock container height to prevent jarring layout jump during fade-out
        const currentHeight = menuGrid.offsetHeight;
        menuGrid.style.minHeight = `${currentHeight}px`;

        // Phase 1: Smoothly fade out currently visible items
        const visibleItems = Array.from(menuItems).filter(item => item.style.display !== 'none');
        visibleItems.forEach(item => {
            item.style.transition = 'opacity 0.15s ease, transform 0.15s ease';
            item.style.opacity = '0';
            item.style.transform = 'translateY(8px) scale(0.98)';
        });

        // Phase 2: After fade-out, switch visibility and stagger fade-in matching items
        setTimeout(() => {
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

            // Trigger reflow then stagger animate incoming items
            requestAnimationFrame(() => {
                incomingItems.forEach((item, index) => {
                    setTimeout(() => {
                        item.style.transition = 'opacity 0.28s cubic-bezier(0.16, 1, 0.3, 1), transform 0.28s cubic-bezier(0.16, 1, 0.3, 1)';
                        item.style.opacity = '1';
                        item.style.transform = 'translateY(0) scale(1)';
                    }, index * 30);
                });

                // Release minHeight smoothly after incoming animation completes
                setTimeout(() => {
                    menuGrid.style.transition = 'min-height 0.3s ease';
                    menuGrid.style.minHeight = '';
                    isMenuTransitioning = false;
                }, Math.max(300, incomingItems.length * 30 + 200));
            });
        }, 150);
    }

    if (menuTabs.length > 0 && menuItems.length > 0) {
        menuTabs.forEach(tab => {
            tab.addEventListener('click', () => {
                if (tab.classList.contains('active')) return;
                const category = tab.getAttribute('data-category');
                filterMenuCategory(category, false);
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
                // Silent bot trap: pretend success
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

            // Set sending state
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
            'showcase.title':       'Made Fresh Daily',
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
            'about.p2':        'We pride ourselves on using fresh ingredients, traditional recipes, and cooking with passion. From our al pastor spinning on the trompo to our handmade salsas, every bite is a celebration of our heritage.',
            'about.locations': 'Locations',
            'about.since':     'Since',
            'about.meats':     'Meat Options',

            // Menu
            'menu.title':    'Our Menu',
            'menu.subtitle': 'Choose your favorite from 9 categories, each made fresh with traditional flavors.',

            'menu.tab.tacos':       'Tacos',
            'menu.tab.burritos':    'Burritos',
            'menu.tab.quesadillas': 'Quesadillas',
            'menu.tab.mulitas':     'Mulitas',
            'menu.tab.sopes':       'Sopes',
            'menu.tab.tortas':      'Tortas',
            'menu.tab.platos':      'Platos',
            'menu.tab.nachos':      'Nachos',
            'menu.tab.drinks':      'Drinks',
            'menu.tab.desserts':    'Desserts',

            'menu.tacos.name':           'Tacos de Asada',
            'menu.tacos.desc':           'Charbroiled steak served on warm corn tortillas topped with fresh cilantro, diced onions, and your favorite salsa.',
            'menu.tacoPastor.name':      'Tacos al Pastor',
            'menu.tacoPastor.desc':      'Tender marinated pork roasted on the vertical trompo, sliced thin with fresh cilantro, diced onions, and signature salsas.',
            'menu.tacoPollo.name':       'Tacos de Pollo',
            'menu.tacoPollo.desc':       'Citrus-marinated grilled chicken breast, chopped fresh with cilantro and onion on warm corn tortillas.',
            'menu.tacoCarnitas.name':    'Tacos de Carnitas',
            'menu.tacoCarnitas.desc':    'Slow-simmered, tender Michoacán-style pork carnitas served on warm corn tortillas with cilantro, onions, and salsa.',
            'menu.tacoCabeza.name':      'Tacos de Cabeza',
            'menu.tacoCabeza.desc':      'Steam-cooked, tender beef head meat seasoned to perfection, served melt-in-your-mouth soft with cilantro and onions.',
            'menu.tacoLengua.name':      'Tacos de Lengua',
            'menu.tacoLengua.desc':      'Tender, slow-braised beef tongue sliced and lightly seared, served on warm corn tortillas with cilantro and diced onions.',
            'menu.tacoBuche.name':       'Tacos de Buche',
            'menu.tacoBuche.desc':       'Crispy yet tender pork stomach simmered in its own juices and finished on the comal with fresh cilantro and onions.',
            'menu.tacoChorizo.name':     'Tacos de Chorizo',
            'menu.tacoChorizo.desc':     'Artisanal Mexican spiced pork sausage seared to perfection on the comal with cilantro and onion.',
            'menu.tacoTripa.name':       'Tacos de Tripa',
            'menu.tacoTripa.desc':       'Crispy golden beef tripe seared to order on the hot comal, served on corn tortillas with onions, cilantro, and salsa.',
            'menu.tacoPlate.name':       'Taco Plate',
            'menu.tacoPlate.desc':       'Three tacos of your choice served with seasoned Mexican rice and slow-cooked pinto beans.',
            'menu.burrito.name':         'Burrito',
            'menu.burrito.desc':         'Your choice of meat wrapped in a large flour tortilla with rice, pinto beans, onions, and cilantro.',
            'menu.superBurrito.name':    'Super Burrito',
            'menu.superBurrito.desc':    'Loaded burrito packed with choice of meat, rice, beans, Monterey Jack cheese, sour cream, and fresh guacamole.',
            'menu.quesadilla.name':      'Quesadilla',
            'menu.quesadilla.desc':      'Golden-toasted flour tortilla melted with premium Monterey Jack cheese and your choice of meat.',
            'menu.superQuesadilla.name': 'Super Quesadilla',
            'menu.superQuesadilla.desc': 'Melted cheese quesadilla stuffed with meat, crowned with fresh guacamole and cool Mexican crema.',
            'menu.mulita.name':          'Mulita',
            'menu.mulita.desc':          'Two handmade corn tortillas toasted with melted cheese, your choice of meat, onions, and cilantro.',
            'menu.superMulita.name':     'Super Mulita',
            'menu.superMulita.desc':     'Double-stacked mulita layered with melted cheese, choice of meat, creamy avocado guacamole, and crema.',
            'menu.sopes.name':           'Sopes',
            'menu.sopes.desc':           'Handmade thick masa cake with pinched edges, refried beans, meat, crisp shredded lettuce, crema, and cotija cheese.',
            'menu.torta.name':           'Torta',
            'menu.torta.desc':           'Toasted telera bread layered with choice of meat, mayo, fresh avocado, lettuce, tomato, beans, and queso.',
            'menu.plato.name':           'Plato',
            'menu.plato.desc':           'Hearty dinner plate with your choice of meat, seasoned rice, refried beans, garden salad, guacamole, and warm tortillas.',
            'menu.nachos.name':          'Super Nachos',
            'menu.nachos.desc':          'Crisp tortilla chips drenched in warm cheese, piled high with meat, pinto beans, sour cream, and guacamole.',
            'menu.horchata.name':        'Horchata Artesanal',
            'menu.horchata.desc':        'Traditional refreshing rice drink crafted daily with real milk, Mexican cinnamon, and a touch of vanilla.',
            'menu.jamaica.name':         'Agua de Jamaica',
            'menu.jamaica.desc':         'Tart and refreshing steeped hibiscus flower infusion, sweetened to perfection and served ice cold.',
            'menu.tamarindo.name':       'Agua de Tamarindo',
            'menu.tamarindo.desc':       'Authentic Mexican tamarind fruit agua fresca, tart, sweet, and made fresh daily.',
            'menu.meatCalloutTitle':     'All items available with:',
            'menu.meatList':             'Asada · Pastor · Pollo · Carnitas · Cabeza · Lengua · Buche · Chorizo · Tripa · Vegetarian',
            'menu.meatOptions':          'All items available with: Asada · Pastor · Pollo · Carnitas · Cabeza · Lengua · Buche · Chorizo · Tripa · Vegetarian',

            // Fiesta / Catering
            'fiesta.title':    'Fiesta Platters',
            'fiesta.subtitle': 'Feed 15 to 40+ guests',
            'fiesta.desc':     'Make your event unforgettable. Our Fiesta Platters include your choice of meats, rice, beans, aguas frescas, salsas, and all the serving essentials. Same-day pickup and catering orders available.',
            'fiesta.f1':       'Office meetings & corporate events',
            'fiesta.f2':       'Birthdays & quinceañeras',
            'fiesta.f3':       'Family gatherings',
            'fiesta.f4':       'Game day & watch parties',
            'fiesta.btn':      'Inquire Now',

            // Locations
            'locations.title':      'Our Locations',
            'locations.subtitle':   'Find the nearest Tacos Gavilan and order online.',
            'locations.mapBtn':     'Find Nearest Location on Map',
            'locations.mapTitle':   'Find Your Nearest Location',
            'locations.orderBtn':   'Order Online',
            'locations.hoursBadge': 'Open Daily · Morning to Late Night',

            // Map
            'map.findMe': 'Find Me',

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
            'footer.hoursOpen':      'Open Daily',
            'footer.hoursDetail':    'Morning to Late Night',
            'footer.hoursText':      'Open Daily — Morning to Late Night',
            'footer.contactHeading': 'CONTACT',
            'footer.privacy':        'Privacy Policy',
            'footer.terms':          'Terms of Use',
            'footer.accessibility':  'Accessibility',
            'footer.cookieSettings': 'Do Not Sell My Info',

            // Cookies
            'cookie.title':   'Privacy & Cookie Choices',
            'cookie.message': 'We use cookies to improve your browsing experience, remember language preferences, and analyze site traffic in compliance with California privacy standards (CCPA).',
            'cookie.accept':  'Accept All',
            'cookie.decline': 'Decline',

            // Legal Modals
            'privacy.title': 'Privacy Policy & California Privacy Notice (CCPA/CPRA)',
            'privacy.intro': 'Tacos Gavilan ("we", "our", or "us") values your privacy. This notice explains how we collect, use, and protect your information in accordance with California law.',
            'privacy.h1':    '1. Information We Collect',
            'privacy.p1':    'We only collect standard technical data (such as IP address, browser type, and language preference) needed to provide our website services. When you place an online order, you are securely transferred to Toast POS (order.online), which processes payments under strict PCI-DSS security standards.',
            'privacy.h2':    '2. Do Not Sell or Share My Personal Information',
            'privacy.p2':    'We do not sell, rent, or trade your personal information to third parties. We do not sell or share personal information of consumers under 16 years of age.',
            'privacy.h3':    '3. Your California Privacy Rights',
            'privacy.p3':    'California residents have the right to know, delete, and opt out of the sale or sharing of personal information. To exercise your rights, contact us at info@tacosgavilan.com or call (310) 870-7009.',

            'terms.title': 'Terms of Use',
            'terms.intro': 'Welcome to Tacos Gavilan. By accessing or using our website, you agree to comply with and be bound by the following Terms of Use.',
            'terms.h1':    '1. Online Ordering & External Payment Processing',
            'terms.p1':    'All online food orders, pickup, delivery, pricing, payment processing, and transaction receipts are powered exclusively through Toast POS / order.online. Tacos Gavilan does not store or process payment card details on this website.',
            'terms.h2':    '2. Intellectual Property & Brand Standards',
            'terms.p2':    'All content, logos, food photography, graphics, and trade dress on this website are the property of Tacos Gavilan. Reproduction or redistribution without prior written authorization is strictly prohibited.',
            'terms.h3':    '3. Accuracy of Information',
            'terms.p3':    'While we strive for complete accuracy, menu offerings, ingredients, item availability, and operating hours may vary by restaurant location and day. Refer to order.online for real-time item availability at each location.',

            'accessibility.title': 'Accessibility Statement',
            'accessibility.intro': 'Tacos Gavilan is committed to digital accessibility and ensuring our website is welcoming and accessible to all guests, including individuals with disabilities.',
            'accessibility.h1':    'Our Standards & Conformance',
            'accessibility.p1':    'We continually improve the user experience for everyone, applying the relevant Web Content Accessibility Guidelines (WCAG 2.2 AA). Our site features keyboard-accessible navigation, high-contrast typography, text resize support, descriptive alternative text, and screen reader-friendly interactive elements.',
            'accessibility.h2':    'Feedback & Assistance',
            'accessibility.p2':    'If you encounter any difficulty viewing or navigating content on this website, or notice any feature that you believe is not fully accessible, please contact our team at (310) 870-7009 or email info@tacosgavilan.com with "Website Accessibility" in the subject line. We welcome your feedback and are glad to assist.'
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
            'showcase.title':       'Hecho Fresco Cada Día',
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
            'about.p2':        'Nos enorgullece usar ingredientes frescos, recetas tradicionales y cocinar con pasión. Desde nuestro al pastor girando en el trompo hasta nuestras salsas hechas a mano, cada bocado es una celebración de nuestra herencia.',
            'about.locations': 'Ubicaciones',
            'about.since':     'Desde',
            'about.meats':     'Tipos de Carne',

            // Menú
            'menu.title':    'Nuestro Menú',
            'menu.subtitle': 'Elige tu favorito de 9 categorías preparadas al momento con sazón tradicional.',

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
            'menu.tacos.desc':           'Carne asada a la parrilla servida en tortillas de maíz con cilantro fresco, cebolla picada y tu salsa favorita.',
            'menu.tacoPastor.name':      'Tacos al Pastor',
            'menu.tacoPastor.desc':      'Carne de cerdo marinada al trompo tradicional con cilantro fresco, cebolla picada y salsas de la casa.',
            'menu.tacoPollo.name':       'Tacos de Pollo',
            'menu.tacoPollo.desc':       'Pechuga de pollo marinada en cítricos y asada a la parrilla, con cilantro y cebolla en tortilla de maíz.',
            'menu.tacoCarnitas.name':    'Tacos de Carnitas',
            'menu.tacoCarnitas.desc':    'Carnitas estilo Michoacán cocinadas a fuego lento, tiernas y jugosas en tortillas de maíz con cilantro, cebolla y salsa.',
            'menu.tacoCabeza.name':      'Tacos de Cabeza',
            'menu.tacoCabeza.desc':      'Carne de cabeza de res al vapor, suave y jugosa, sazonada a la perfección con cilantro, cebolla y salsa.',
            'menu.tacoLengua.name':      'Tacos de Lengua',
            'menu.tacoLengua.desc':      'Lengua de res cocinada a fuego lento, tierna y suave, servida en tortillas de maíz con cilantro fresco y cebolla.',
            'menu.tacoBuche.name':       'Tacos de Buche',
            'menu.tacoBuche.desc':       'Buche de cerdo dorado al comal, suave por dentro y crujiente por fuera, servido con cilantro fresco y cebolla.',
            'menu.tacoChorizo.name':     'Tacos de Chorizo',
            'menu.tacoChorizo.desc':     'Chorizo de cerdo artesanal sazonado con especias tradicionales, dorado al comal con cilantro y cebolla.',
            'menu.tacoTripa.name':       'Tacos de Tripa',
            'menu.tacoTripa.desc':       'Tripa de res bien dorada al comal a fuego vivo, crujiente y deliciosa en tortillas de maíz con cilantro y cebolla.',
            'menu.tacoPlate.name':       'Plato de Tacos',
            'menu.tacoPlate.desc':       'Tres tacos a tu elección servidos con arroz mexicano sazonado y frijoles refritos cocinados a fuego lento.',
            'menu.burrito.name':         'Burrito',
            'menu.burrito.desc':         'Tu elección de carne envuelta en tortilla de harina grande con arroz, frijoles, cebolla y cilantro fresco.',
            'menu.superBurrito.name':    'Súper Burrito',
            'menu.superBurrito.desc':    'Burrito gigante con tu carne favorita, arroz, frijoles, queso Monterrey derretido, crema y guacamole.',
            'menu.quesadilla.name':      'Quesadilla',
            'menu.quesadilla.desc':      'Tortilla de harina dorada al comal con abundante queso Monterrey derretido y tu carne preferida.',
            'menu.superQuesadilla.name': 'Súper Quesadilla',
            'menu.superQuesadilla.desc': 'Quesadilla dorada con queso y carne, coronada con guacamole fresco de aguacate y crema mexicana.',
            'menu.mulita.name':          'Mulita',
            'menu.mulita.desc':          'Dos tortillas de maíz hechas a mano con queso derretido, tu carne favorita, cebolla y cilantro.',
            'menu.superMulita.name':     'Súper Mulita',
            'menu.superMulita.desc':     'Doble piso de tortilla con queso fundido, carne al gusto, guacamole artesanal y crema agria.',
            'menu.sopes.name':           'Sopes',
            'menu.sopes.desc':           'Base gruesa de maíz pellizcada a mano con frijoles refritos, carne, lechuga fresca, crema y queso cotija.',
            'menu.torta.name':           'Torta',
            'menu.torta.desc':           'Telera tostada con mayonesa, tu carne favorita, aguacate fresco, lechuga, tomate, frijoles y queso.',
            'menu.plato.name':           'Plato',
            'menu.plato.desc':           'Platillo completo con tu carne preferida, arroz sazonado, frijoles, ensalada fresca, guacamole y tortillas calientes.',
            'menu.nachos.name':          'Súper Nachos',
            'menu.nachos.desc':          'Totopos crujientes de maíz bañados en queso caliente, frijoles, tu carne favorita, crema y guacamole.',
            'menu.horchata.name':        'Horchata Artesanal',
            'menu.horchata.desc':        'Agua fresca tradicional de arroz, leche entera, canela en raja y un toque de vainilla preparada diariamente.',
            'menu.jamaica.name':         'Agua de Jamaica',
            'menu.jamaica.desc':         'Infusión natural de flor de jamaica 100% auténtica, dulce, refrescante y servida con mucho hielo.',
            'menu.tamarindo.name':       'Agua de Tamarindo',
            'menu.tamarindo.desc':       'Auténtica agua fresca natural de pulpa de tamarindo, agridulce, refrescante y elaborada a diario.',
            'menu.meatCalloutTitle':     'Todos los platillos disponibles con:',
            'menu.meatList':             'Asada · Pastor · Pollo · Carnitas · Cabeza · Lengua · Buche · Chorizo · Tripa · Vegetariano',
            'menu.meatOptions':          'Todos los platillos disponibles con: Asada · Pastor · Pollo · Carnitas · Cabeza · Lengua · Buche · Chorizo · Tripa · Vegetariano',

            // Fiesta / Eventos
            'fiesta.title':    'Fiesta Platters',
            'fiesta.subtitle': 'Para 15 a 40+ invitados',
            'fiesta.desc':     'Haz tu evento inolvidable. Nuestras charolas de fiesta incluyen carnes al gusto, arroz, frijoles, aguas frescas, salsas y desechables. Órdenes para el mismo día disponibles.',
            'fiesta.f1':       'Reuniones de trabajo y eventos corporativos',
            'fiesta.f2':       'Cumpleaños y quinceañeras',
            'fiesta.f3':       'Reuniones familiares y aniversarios',
            'fiesta.f4':       'Partidos y eventos deportivos',
            'fiesta.btn':      'Cotizar Ahora',

            // Ubicaciones
            'locations.title':      'Nuestras Ubicaciones',
            'locations.subtitle':   'Encuentra tu Tacos Gavilan más cercano y ordena en línea.',
            'locations.mapBtn':     'Ver Sucursales en el Mapa',
            'locations.mapTitle':   'Encuentra Tu Sucursal Más Cercana',
            'locations.orderBtn':   'Ordenar en Línea',
            'locations.hoursBadge': 'Abierto Todos los Días · Desde la Mañana',

            // Mapa
            'map.findMe': 'Ubicarme',

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
            'footer.hoursOpen':      'Abierto Todos los Días',
            'footer.hoursDetail':    'Desde la Mañana hasta la Noche',
            'footer.hoursText':      'Abierto Todos los Días — Desde la Mañana hasta la Noche',
            'footer.contactHeading': 'CONTACTO',
            'footer.privacy':        'Política de Privacidad',
            'footer.terms':          'Términos de Uso',
            'footer.accessibility':  'Accesibilidad',
            'footer.cookieSettings': 'No Vender Mi Información',

            // Cookies
            'cookie.title':   'Opciones de Privacidad y Cookies',
            'cookie.message': 'Utilizamos cookies técnicas para garantizar el funcionamiento del sitio, recordar tu idioma y analizar visitas de acuerdo con las leyes de California (CCPA).',
            'cookie.accept':  'Aceptar Todo',
            'cookie.decline': 'Rechazar',

            // Modales Legales
            'privacy.title': 'Política de Privacidad y Aviso de California (CCPA/CPRA)',
            'privacy.intro': 'Tacos Gavilan ("nosotros" o "nuestro") valora tu privacidad. Este aviso explica cómo tratamos tu información conforme a la legislación de California.',
            'privacy.h1':    '1. Información que Recopilamos',
            'privacy.p1':    'Solo recopilamos datos técnicos habituales (dirección IP, navegador y preferencia de idioma) para ofrecer nuestros servicios. Los pedidos y pagos se procesan de manera externa y segura a través de Toast POS (order.online) con certificación PCI-DSS.',
            'privacy.h2':    '2. No Venta ni Cesión de Datos Personales',
            'privacy.p2':    'No vendemos ni comercializamos tus datos personales a terceros. No vendemos datos personales de menores de 16 años.',
            'privacy.h3':    '3. Tus Derechos de Privacidad en California',
            'privacy.p3':    'Los residentes de California tienen derecho a conocer, eliminar y optar por no participar en la venta de sus datos. Para ejercerlos, contáctanos a info@tacosgavilan.com o al (310) 870-7009.',

            'terms.title': 'Términos de Uso',
            'terms.intro': 'Bienvenido a Tacos Gavilan. Al acceder y navegar en nuestro sitio web, aceptas quedar sujeto a los siguientes Términos de Uso.',
            'terms.h1':    '1. Pedidos en Línea y Pagos Externos',
            'terms.p1':    'Todos los pedidos en línea, menú transaccional, precios y cobros se gestionan de forma independiente a través de Toast POS (order.online). Tacos Gavilan no guarda datos de pago en este sitio de marca.',
            'terms.h2':    '2. Propiedad Intelectual y Normas de Marca',
            'terms.p2':    'Todos los contenidos, nombres comerciales, fotografías y diseños son propiedad exclusiva de Tacos Gavilan. Queda prohibida su reproducción sin consentimiento expreso por escrito.',
            'terms.h3':    '3. Exactitud de la Información',
            'terms.p3':    'Las recetas, insumos, disponibilidad de platillos y horarios pueden tener ligeras variaciones por sucursal. Consulta en order.online para conocer la disponibilidad exacta al momento de tu orden.',

            'accessibility.title': 'Declaración de Accesibilidad',
            'accessibility.intro': 'Tacos Gavilan promueve la accesibilidad universal para que todas las personas disfruten de nuestra experiencia digital sin barreras.',
            'accessibility.h1':    'Nuestros Estándares y Cumplimiento',
            'accessibility.p1':    'Diseñamos conforme a las Pautas de Accesibilidad para el Contenido Web (WCAG 2.2 AA), incluyendo navegación por teclado, alto contraste, textos alternativos y soporte para lectores de pantalla.',
            'accessibility.h2':    'Asistencia y Contacto',
            'accessibility.p2':    'Si encuentras alguna dificultad al navegar o requieres apoyo, llámanos al (310) 870-7009 o escríbenos a info@tacosgavilan.com con el asunto "Accesibilidad Web". Estaremos atentos a asistirte.'
        }
    };

    const applyTranslations = () => {
        const elements = document.querySelectorAll('[data-i18n]');
        elements.forEach(el => {
            const key = el.getAttribute('data-i18n');
            const translation = translations[currentLang]?.[key];
            if (translation === undefined) return;

            // Safe update: if element has child elements, look for text span or text node
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
                    // Element has only text-level children, safe to update innerHTML or textContent
                    if (translation.includes('<') && translation.includes('>')) {
                        el.innerHTML = translation;
                    } else {
                        el.textContent = translation;
                    }
                } else {
                    // Update text node without deleting SVGs
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
        localStorage.setItem('tacosgavilan_lang', currentLang);

        const langToggleBtn = document.getElementById('lang-toggle');
        if (langToggleBtn) {
            langToggleBtn.textContent = currentLang === 'en' ? 'ES' : 'EN';
            langToggleBtn.setAttribute('aria-label', currentLang === 'en' ? 'Switch language to Spanish' : 'Cambiar idioma a Inglés');
        }
    };

    const langToggleBtn = document.getElementById('lang-toggle');
    if (langToggleBtn) {
        langToggleBtn.addEventListener('click', () => {
            currentLang = currentLang === 'en' ? 'es' : 'en';
            applyTranslations();
        });
    }

    // Apply saved or default language on load
    applyTranslations();

    /* ==========================================================
       12. INTERACTIVE LEAFLET STORE LOCATOR MAP
       ========================================================== */
    const mapOverlay = document.getElementById('map-modal-overlay');
    const mapOpenBtn = document.getElementById('open-map-btn');
    const mapCloseBtn = document.getElementById('map-modal-close');

    let mapInitialized = false;

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

    const openMapModal = () => {
        if (!mapOverlay) return;
        mapOverlay.style.display = 'flex';
        mapOverlay.offsetHeight; // trigger reflow
        mapOverlay.classList.add('is-open');
        document.body.style.overflow = 'hidden';

        setTimeout(() => {
            if (!mapInitialized) {
                if (typeof google !== 'undefined' && google.maps) {
                    mapInitialized = true;
                    initGavilanGoogleMap();
                } else {
                    let attempts = 0;
                    const checkGoogle = setInterval(() => {
                        attempts++;
                        if (typeof google !== 'undefined' && google.maps) {
                            clearInterval(checkGoogle);
                            mapInitialized = true;
                            initGavilanGoogleMap();
                        } else if (attempts > 50) {
                            clearInterval(checkGoogle);
                            console.warn('Google Maps script load timeout');
                        }
                    }, 100);
                }
            } else if (window._gavilanGoogleMap) {
                google.maps.event.trigger(window._gavilanGoogleMap, 'resize');
                if (window._gavilanBounds) {
                    window._gavilanGoogleMap.fitBounds(window._gavilanBounds);
                }
            }
        }, 200);
    };

    const closeMapModal = () => {
        if (!mapOverlay) return;
        mapOverlay.classList.remove('is-open');
        setTimeout(() => {
            mapOverlay.style.display = 'none';
            document.body.style.overflow = '';
        }, 300);
        if (mapOpenBtn) mapOpenBtn.focus();
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

    function initGavilanGoogleMap() {
        const mapContainer = document.getElementById('gavilan-map');
        if (!mapContainer || typeof google === 'undefined' || !google.maps) return;

        // Luxury Dark Theme Styles matching Tacos Gavilan branding (#151513)
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

        const map = new google.maps.Map(mapContainer, {
            center: { lat: 33.98, lng: -118.15 },
            zoom: 10,
            styles: darkMapStyles,
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: false,
            zoomControl: true,
            gestureHandling: 'greedy'
        });
        window._gavilanGoogleMap = map;

        const bounds = new google.maps.LatLngBounds();
        const infoWindow = new google.maps.InfoWindow();
        window._gavilanInfoWindow = infoWindow;

        // Custom Branded SVG Pin (Red fill with Gold border)
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

        const buildPopupContent = (loc, distance) => {
            const distHtml = (distance !== null && !isNaN(distance))
                ? `<div class="map-popup-distance">${distance.toFixed(1)} ${currentLang === 'es' ? 'millas de ti' : 'miles from you'}</div>`
                : '';
            const dirUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(loc.address)}`;
            const orderText = currentLang === 'es' ? 'Ordenar en Línea' : 'Order Online';
            const dirText = currentLang === 'es' ? 'Cómo llegar' : 'Directions';

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

        // Fit all 15 stores within view bounds
        setTimeout(() => {
            google.maps.event.trigger(map, 'resize');
            map.fitBounds(bounds);
        }, 150);
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
    };

    const closeLightbox = () => {
        if (!lightboxOverlay) return;
        lightboxOverlay.classList.remove('is-open');
        setTimeout(() => {
            lightboxOverlay.style.display = 'none';
            document.body.style.overflow = '';
        }, 300);
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
        };

        const closeModal = () => {
            overlay.classList.remove('is-open');
            setTimeout(() => {
                overlay.style.display = 'none';
                document.body.style.overflow = '';
            }, 300);
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

    // Delegated click handler for dynamically translated legal links (e.g. inside form privacy notice)
    document.addEventListener('click', (e) => {
        const link = e.target.closest('#contact-privacy-link');
        if (link) {
            e.preventDefault();
            const privacyOverlay = document.getElementById('privacy-modal-overlay');
            if (privacyOverlay) {
                privacyOverlay.style.display = 'flex';
                privacyOverlay.offsetHeight;
                privacyOverlay.classList.add('is-open');
                document.body.style.overflow = 'hidden';
            }
        }
    });

    /* ==========================================================
       15. COOKIE CONSENT BANNER (CCPA / CPRA COMPLIANT)
       ========================================================== */
    const cookieBanner = document.getElementById('cookie-banner');
    const cookieAcceptBtn = document.getElementById('cookie-accept-btn');
    const cookieDeclineBtn = document.getElementById('cookie-decline-btn');

    const showCookieBanner = () => {
        if (!cookieBanner) return;
        const consent = localStorage.getItem('tacosgavilan_cookie_consent');
        if (!consent) {
            setTimeout(() => {
                cookieBanner.style.display = 'block';
                cookieBanner.offsetHeight;
                cookieBanner.classList.add('cookie-banner-visible');
            }, 1200);
        }
    };

    const hideCookieBanner = () => {
        if (!cookieBanner) return;
        cookieBanner.classList.remove('cookie-banner-visible');
        setTimeout(() => {
            cookieBanner.style.display = 'none';
        }, 400);
    };

    if (cookieAcceptBtn) {
        cookieAcceptBtn.addEventListener('click', () => {
            localStorage.setItem('tacosgavilan_cookie_consent', 'accepted');
            hideCookieBanner();
        });
    }

    if (cookieDeclineBtn) {
        cookieDeclineBtn.addEventListener('click', () => {
            localStorage.setItem('tacosgavilan_cookie_consent', 'declined');
            hideCookieBanner();
        });
    }

    showCookieBanner();

    /* ==========================================================
       16. MOBILE STICKY BOTTOM ACTION BAR CONTROLLER
       ========================================================== */
    const mobileStickyBar = document.getElementById('mobile-sticky-bar');

    if (mobileStickyBar) {
        const updateStickyBar = () => {
            if (window.innerWidth > 768) {
                mobileStickyBar.classList.remove('is-visible');
                return;
            }

            const isMenuOpen = document.body.classList.contains('menu-open');
            const isModalOpen = document.querySelector('.map-modal-overlay.is-open, .lightbox-modal-overlay.is-open, .privacy-modal-overlay.is-open');

            if (isMenuOpen || isModalOpen) {
                mobileStickyBar.classList.remove('is-visible');
                return;
            }

            // Reveal after scrolling down past the hero
            if (window.scrollY > 280) {
                mobileStickyBar.classList.add('is-visible');
            } else {
                mobileStickyBar.classList.remove('is-visible');
            }
        };

        window.addEventListener('scroll', updateStickyBar, { passive: true });
        window.addEventListener('resize', updateStickyBar, { passive: true });
        updateStickyBar();
    }

});
