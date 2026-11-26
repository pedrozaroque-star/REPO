/**
 * @module TacosGavilan/LocationPage
 * @description Provides bilingual EN/ES translation engine and accessible mobile drawer navigation
 * for static restaurant landing pages, 404 error page, and legal policy pages.
 * @businessRules DoorDash Storefront (order.online synced to Toast POS) is the exclusive ordering
 * destination; all store order links include ?hideModal=true&pickup=true or &delivery=true and
 * display live Open/Closed status in America/Los_Angeles with overnight rollover support.
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

        if (window.__tgHolidayEngine && typeof window.__tgHolidayEngine.syncUI === 'function') {
            window.__tgHolidayEngine.syncUI();
        }
    };

    const yearEl = document.getElementById('year');
    if (yearEl && !yearEl.textContent.trim()) {
        yearEl.textContent = String(new Date().getFullYear());
    }

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

    /* -------------------------------------------------------------
       5. Individual Store Page: Live America/Los_Angeles Status &
          Pickup / Delivery Toggle (?hideModal=true&pickup|delivery=true)
       ------------------------------------------------------------- */
    const STORE_WEEKLY_SCHEDULES = {
        'la-central':      { 0:[8,26], 1:[8,26], 2:[8,26], 3:[8,26], 4:[8,27], 5:[8,28], 6:[8,28] },
        'lynwood':         { 0:[10,25],1:[10,25],2:[10,25],3:[10,25],4:[10,26],5:[10,27],6:[10,27] },
        'la-broadway':     { 0:[8,26], 1:[8,25], 2:[8,25], 3:[8,25], 4:[8,26], 5:[8,28], 6:[8,28] },
        'norwalk':         { 0:[10,25],1:[10,25],2:[10,25],3:[10,25],4:[10,25],5:[10,27],6:[10,27] },
        'slauson':         { 0:[10,25],1:[10,25],2:[10,25],3:[10,25],4:[10,25],5:[10,27],6:[10,27] },
        'west-covina':     { 0:[10,25],1:[10,25],2:[10,25],3:[10,25],4:[10,25],5:[10,27],6:[10,27] },
        'rialto':          { 0:[10,24],1:[10,24],2:[10,24],3:[10,24],4:[10,24],5:[10,26],6:[10,26] },
        'south-gate':      { 0:[10,24],1:[10,24],2:[10,24],3:[10,24],4:[10,24],5:[10,27],6:[10,27] },
        'downey':          { 0:[10,24],1:[10,24],2:[10,24],3:[10,24],4:[10,25],5:[10,27],6:[10,27] },
        'hollywood':       { 0:[9,24], 1:[9,24], 2:[9,24], 3:[9,24], 4:[9,24], 5:[9,27], 6:[9,27] },
        'santa-ana':       { 0:[10,24],1:[10,24],2:[10,24],3:[10,24],4:[10,24],5:[10,26],6:[10,26] },
        'huntington-park': { 0:[10,24],1:[10,24],2:[10,24],3:[10,24],4:[10,25],5:[10,27],6:[10,27] },
        'la-puente':       { 0:[10,24],1:[10,24],2:[10,24],3:[10,24],4:[10,24],5:[10,26],6:[10,26] },
        'azusa':           { 0:[10,23],1:[10,23],2:[10,23],3:[10,23],4:[10,23],5:[10,24],6:[10,24] },
        'bell':            { 0:[10,24],1:[10,24],2:[10,24],3:[10,24],4:[10,24],5:[10,26],6:[10,26] }
    };

    const detailsCard = document.querySelector('.location-details-card');
    if (detailsCard) {
        const pathMatch = window.location.pathname.match(/\/locations\/([a-z0-9-]+)\/?/i);
        const pageSlug = pathMatch ? pathMatch[1].toLowerCase() : null;
        let orderMode = safeStorage.get('tacosgavilan_order_mode') === 'delivery' ? 'delivery' : 'pickup';

        const formatHour12 = (hour24) => {
            const h = ((hour24 % 24) + 24) % 24;
            if (h === 0) return '12:00 AM';
            if (h === 12) return '12:00 PM';
            return h < 12 ? (h + ':00 AM') : ((h - 12) + ':00 PM');
        };

        const getOfficialHolidayRule = (dateStr) => {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
            const year = Number(dateStr.slice(0, 4));
            if (!Number.isInteger(year) || year < 2020 || year > 2100) return null;
            const a = year % 19, b = Math.floor(year / 100), c = year % 100;
            const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
            const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
            const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
            const m = Math.floor((a + 11 * h + 22 * l) / 451);
            const eMonth = Math.floor((h + l - 7 * m + 114) / 31);
            const eDay = ((h + l - 7 * m + 114) % 31) + 1;
            const goodFriday = new Date(Date.UTC(year, eMonth - 1, eDay - 2, 12, 0, 0)).toISOString().slice(0, 10);
            const nov1Dow = new Date(Date.UTC(year, 10, 1, 12, 0, 0)).getUTCDay();
            const fourthThuDay = 1 + ((4 - nov1Dow + 7) % 7) + 21;
            const thanksgiving = new Date(Date.UTC(year, 10, fourthThuDay, 12, 0, 0)).toISOString().slice(0, 10);
            const blackFriday = new Date(Date.UTC(year, 10, fourthThuDay + 1, 12, 0, 0)).toISOString().slice(0, 10);
            if (dateStr === year + '-01-01') return { isClosed: false, openHour: 11, closeHour: null, nameEn: "New Year's Day", nameEs: 'Año Nuevo' };
            if (dateStr === goodFriday) return { isClosed: true, openHour: null, closeHour: null, nameEn: 'Good Friday', nameEs: 'Viernes Santo' };
            if (dateStr === thanksgiving) return { isClosed: false, openHour: null, closeHour: 16, nameEn: 'Thanksgiving', nameEs: 'Día de Acción de Gracias' };
            if (dateStr === blackFriday) return { isClosed: false, openHour: 11, closeHour: null, nameEn: 'Black Friday', nameEs: 'Horario Especial' };
            if (dateStr === year + '-12-24') return { isClosed: false, openHour: null, closeHour: 16, nameEn: 'Christmas Eve', nameEs: 'Nochebuena' };
            if (dateStr === year + '-12-25') return { isClosed: true, openHour: null, closeHour: null, nameEn: 'Christmas Day', nameEs: 'Navidad' };
            if (dateStr === year + '-12-31') return { isClosed: false, openHour: null, closeHour: 16, nameEn: "New Year's Eve", nameEs: 'Fin de Año' };
            return null;
        };

        const shiftDateUTC = (dateStr, delta) => {
            const s = dateStr.split('-').map(Number);
            return new Date(Date.UTC(s[0], s[1] - 1, s[2] + delta, 12, 0, 0)).toISOString().slice(0, 10);
        };

        const resolveEffectiveWin = (regWin, dateStr) => {
            const rule = getOfficialHolidayRule(dateStr);
            if (!rule) return { isClosedAllDay: false, openHour: regWin[0], closeHour: regWin[1], isEarlyClose: false, isLateOpen: false, rule: null };
            if (rule.isClosed) return { isClosedAllDay: true, openHour: 0, closeHour: 0, isEarlyClose: false, isLateOpen: false, rule };
            const openHour = rule.openHour != null ? rule.openHour : regWin[0];
            const closeHour = rule.closeHour != null ? rule.closeHour : regWin[1];
            return { isClosedAllDay: false, openHour, closeHour, isEarlyClose: rule.closeHour != null && closeHour < regWin[1], isLateOpen: rule.openHour != null && openHour > regWin[0], rule };
        };

        const computeStatus = (slug, lang, nowDate = new Date()) => {
            const sched = (slug && Object.prototype.hasOwnProperty.call(STORE_WEEKLY_SCHEDULES, slug)) ? STORE_WEEKLY_SCHEDULES[slug] : null;
            if (!sched) return null;
            const isEs = lang === 'es';
            const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
            const parts = new Intl.DateTimeFormat('en-US', {
                timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false
            }).formatToParts(nowDate);
            const yearStr = parts.find(p => p.type === 'year')?.value || '2026';
            const monthStr = parts.find(p => p.type === 'month')?.value || '01';
            const dayStr = parts.find(p => p.type === 'day')?.value || '01';
            const wdStr = parts.find(p => p.type === 'weekday')?.value || 'Mon';
            const rawHour = Number(parts.find(p => p.type === 'hour')?.value ?? '12');
            const minute = Number(parts.find(p => p.type === 'minute')?.value ?? '0');
            const hour = rawHour === 24 ? 0 : rawHour;
            const dayIdx = Object.prototype.hasOwnProperty.call(weekdayMap, wdStr) ? weekdayMap[wdStr] : 1;
            const nowMins = hour * 60 + minute;

            const todayDateStr = yearStr + '-' + monthStr + '-' + dayStr;
            const prevEff = resolveEffectiveWin(sched[(dayIdx + 6) % 7], shiftDateUTC(todayDateStr, -1));
            const todayEff = resolveEffectiveWin(sched[dayIdx], todayDateStr);
            const nextEff = resolveEffectiveWin(sched[(dayIdx + 1) % 7], shiftDateUTC(todayDateStr, 1));

            if (!prevEff.isClosedAllDay && prevEff.closeHour > 24 && nowMins < (prevEff.closeHour - 24) * 60) {
                const c = formatHour12(prevEff.closeHour);
                return { isOpen: true, label: isEs ? ('Abierto hasta ' + c) : ('Open until ' + c) };
            }
            if (todayEff.isClosedAllDay) {
                const hn = isEs ? todayEff.rule.nameEs : todayEff.rule.nameEn;
                return { isOpen: false, label: isEs ? ('Cerrado por Día Festivo (' + hn + ')') : ('Closed for Holiday (' + hn + ')') };
            }
            if (nowMins >= todayEff.openHour * 60 && nowMins < todayEff.closeHour * 60) {
                const c = formatHour12(todayEff.closeHour);
                return {
                    isOpen: true,
                    label: todayEff.isEarlyClose
                        ? (isEs ? ('Abierto · Cierre temprano ' + c) : ('Open · Closes early ' + c))
                        : (isEs ? ('Abierto hasta ' + c) : ('Open until ' + c))
                };
            }
            if (nowMins < todayEff.openHour * 60) {
                const o = formatHour12(todayEff.openHour);
                return {
                    isOpen: false,
                    label: todayEff.isLateOpen
                        ? (isEs ? ('Horario festivo · Abre a las ' + o) : ('Holiday hours · Opens at ' + o))
                        : (isEs ? ('Abre a las ' + o) : ('Opens at ' + o))
                };
            }
            if (nextEff.isClosedAllDay) {
                const nh = isEs ? nextEff.rule.nameEs : nextEff.rule.nameEn;
                return {
                    isOpen: false,
                    label: todayEff.isEarlyClose
                        ? (isEs ? ('Cerrado · Festivo (' + formatHour12(todayEff.closeHour) + ')') : ('Closed · Holiday (' + formatHour12(todayEff.closeHour) + ')'))
                        : (isEs ? ('Cerrado · Mañana cerrado (' + nh + ')') : ('Closed · Closed tomorrow (' + nh + ')'))
                };
            }
            const no = formatHour12(nextEff.openHour);
            return {
                isOpen: false,
                label: todayEff.isEarlyClose
                    ? (isEs ? ('Cerrado · Abre mañana ' + no) : ('Closed · Opens tomorrow ' + no))
                    : (isEs ? ('Abre mañana ' + no) : ('Opens tomorrow ' + no))
            };
        };
        window.__tgComputeLocationStatus = computeStatus;

        const buildUrl = (href, mode) => {
            const clean = String(href || '').split('?')[0].replace(/\/+$/, '');
            return clean + '/?hideModal=true&' + (mode === 'delivery' ? 'delivery=true' : 'pickup=true');
        };

        const statusWrap = document.createElement('div');
        statusWrap.className = 'tg-locpage-status-wrap';
        const h2 = detailsCard.querySelector('h2');
        if (h2 && h2.parentNode) h2.parentNode.insertBefore(statusWrap, h2.nextSibling);

        const modeWrap = document.createElement('div');
        modeWrap.className = 'tg-locpage-mode-wrap';
        modeWrap.innerHTML = `
            <div class="tg-fulfillment-toggle" role="radiogroup" aria-label="Order Type">
                <button type="button" class="tg-mode-btn" data-tg-loc-mode="pickup" role="radio" aria-checked="true">Pickup</button>
                <button type="button" class="tg-mode-btn" data-tg-loc-mode="delivery" role="radio" aria-checked="false">Delivery</button>
            </div>
        `;
        const ctaGroup = detailsCard.querySelector('.location-cta-group');
        if (ctaGroup && ctaGroup.parentNode) ctaGroup.parentNode.insertBefore(modeWrap, ctaGroup);

        const syncLocationPageOrderUI = () => {
            const lang = document.documentElement.lang === 'es' ? 'es' : 'en';
            const isEs = lang === 'es';
            const st = computeStatus(pageSlug, lang);
            statusWrap.innerHTML = st
                ? `<span class="tg-live-status-pill ${st.isOpen ? 'is-open' : 'is-closed'}"><span class="tg-live-status-dot" aria-hidden="true"></span><span>${st.label}</span></span>`
                : '';

            modeWrap.querySelectorAll('.tg-mode-btn[data-tg-loc-mode]').forEach(btn => {
                const m = btn.getAttribute('data-tg-loc-mode');
                const active = m === orderMode;
                btn.classList.toggle('is-active', active);
                btn.setAttribute('aria-checked', active ? 'true' : 'false');
                btn.textContent = m === 'delivery'
                    ? (isEs ? 'A Domicilio' : 'Delivery')
                    : (isEs ? 'Para Recoger' : 'Pickup');
            });

            document.querySelectorAll('a[href*="order.online/store/"]').forEach(link => {
                link.href = buildUrl(link.href, orderMode);
                if (link.closest('.location-cta-group')) {
                    link.textContent = orderMode === 'delivery'
                        ? (isEs ? 'Ordenar Delivery' : 'Order Delivery')
                        : (isEs ? 'Ordenar Pickup' : 'Order Pickup');
                }
            });
        };

        modeWrap.addEventListener('click', (e) => {
            const btn = e.target.closest('.tg-mode-btn[data-tg-loc-mode]');
            if (!btn) return;
            orderMode = btn.getAttribute('data-tg-loc-mode') === 'delivery' ? 'delivery' : 'pickup';
            safeStorage.set('tacosgavilan_order_mode', orderMode);
            syncLocationPageOrderUI();
        });

        if (toggle) {
            toggle.addEventListener('click', () => {
                setTimeout(syncLocationPageOrderUI, 0);
            });
        }

        syncLocationPageOrderUI();
    }

    /* ==========================================================
       5. OFFICIAL HOLIDAY HOURS LIVE NOTICE & SCHEDULE ENGINE
       Perpetual 7 official Tacos Gavilan holidays (America/Los_Angeles).
       Renders ZERO DOM/CSS on normal non-holiday days. On any of the 7
       official holiday dates, displays a dismissible WCAG AA bilingual
       (EN/ES) top banner plus store-specific holiday hours & live status.
       ========================================================== */
    const TG_STORE_WEEKLY_HOURS = {
        'la-central':      { 0:[8,26], 1:[8,26], 2:[8,26], 3:[8,26], 4:[8,27], 5:[8,28], 6:[8,28] },
        'lynwood':         { 0:[10,25],1:[10,25],2:[10,25],3:[10,25],4:[10,26],5:[10,27],6:[10,27] },
        'la-broadway':     { 0:[8,26], 1:[8,25], 2:[8,25], 3:[8,25], 4:[8,26], 5:[8,28], 6:[8,28] },
        'norwalk':         { 0:[10,25],1:[10,25],2:[10,25],3:[10,25],4:[10,25],5:[10,27],6:[10,27] },
        'slauson':         { 0:[10,25],1:[10,25],2:[10,25],3:[10,25],4:[10,25],5:[10,27],6:[10,27] },
        'west-covina':     { 0:[10,25],1:[10,25],2:[10,25],3:[10,25],4:[10,25],5:[10,27],6:[10,27] },
        'rialto':          { 0:[10,24],1:[10,24],2:[10,24],3:[10,24],4:[10,24],5:[10,26],6:[10,26] },
        'south-gate':      { 0:[10,24],1:[10,24],2:[10,24],3:[10,24],4:[10,24],5:[10,27],6:[10,27] },
        'downey':          { 0:[10,24],1:[10,24],2:[10,24],3:[10,24],4:[10,25],5:[10,27],6:[10,27] },
        'hollywood':       { 0:[9,24], 1:[9,24], 2:[9,24], 3:[9,24], 4:[9,24], 5:[9,27], 6:[9,27] },
        'santa-ana':       { 0:[10,24],1:[10,24],2:[10,24],3:[10,24],4:[10,24],5:[10,26],6:[10,26] },
        'huntington-park': { 0:[10,24],1:[10,24],2:[10,24],3:[10,24],4:[10,25],5:[10,27],6:[10,27] },
        'la-puente':       { 0:[10,24],1:[10,24],2:[10,24],3:[10,24],4:[10,24],5:[10,26],6:[10,26] },
        'azusa':           { 0:[10,23],1:[10,23],2:[10,23],3:[10,23],4:[10,23],5:[10,24],6:[10,24] },
        'bell':            { 0:[10,24],1:[10,24],2:[10,24],3:[10,24],4:[10,24],5:[10,26],6:[10,26] }
    };
    const TG_DRIVE_THRU_SLUGS = {
        'la-central': true,
        'lynwood': true,
        'downey': true,
        'west-covina': true,
        'rialto': true,
        'azusa': true
    };

    const tgFormatHour12 = (hour24) => {
        const h = ((hour24 % 24) + 24) % 24;
        if (h === 0) return '12:00 AM';
        if (h === 12) return '12:00 PM';
        return h < 12 ? (h + ':00 AM') : ((h - 12) + ':00 PM');
    };

    const tgShiftDateUTC = (dateStr, deltaDays) => {
        const p = dateStr.split('-').map(Number);
        return new Date(Date.UTC(p[0], p[1] - 1, p[2] + deltaDays, 12, 0, 0)).toISOString().slice(0, 10);
    };

    const tgGetLAParts = (nowDate = new Date()) => {
        const wdMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/Los_Angeles',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            weekday: 'short',
            hour: 'numeric',
            minute: 'numeric',
            hour12: false
        }).formatToParts(nowDate);
        const yearStr = parts.find(p => p.type === 'year')?.value || '2026';
        const monthStr = parts.find(p => p.type === 'month')?.value || '01';
        const dayStr = parts.find(p => p.type === 'day')?.value || '01';
        const wdStr = parts.find(p => p.type === 'weekday')?.value || 'Mon';
        const rawHour = Number(parts.find(p => p.type === 'hour')?.value ?? '12');
        const minute = Number(parts.find(p => p.type === 'minute')?.value ?? '0');
        const hour = rawHour === 24 ? 0 : rawHour;
        const dayIdx = Object.prototype.hasOwnProperty.call(wdMap, wdStr) ? wdMap[wdStr] : 1;
        return {
            dateStr: yearStr + '-' + monthStr + '-' + dayStr,
            dayIdx,
            hour,
            minute,
            nowMins: hour * 60 + minute
        };
    };

    const tgGetOfficialHolidayRule = (dateStr) => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
        const year = Number(dateStr.slice(0, 4));
        if (!Number.isInteger(year) || year < 2020 || year > 2100) return null;
        // Meeus/Jones/Butcher Gregorian Easter -> Good Friday (-2 days)
        const a = year % 19;
        const b = Math.floor(year / 100);
        const c = year % 100;
        const d = Math.floor(b / 4);
        const e = b % 4;
        const f = Math.floor((b + 8) / 25);
        const g = Math.floor((b - f + 1) / 3);
        const h = (19 * a + b - d - g + 15) % 30;
        const i = Math.floor(c / 4);
        const k = c % 4;
        const l = (32 + 2 * e + 2 * i - h - k) % 7;
        const m = Math.floor((a + 11 * h + 22 * l) / 451);
        const eMonth = Math.floor((h + l - 7 * m + 114) / 31);
        const eDay = ((h + l - 7 * m + 114) % 31) + 1;
        const goodFriday = new Date(Date.UTC(year, eMonth - 1, eDay - 2, 12, 0, 0)).toISOString().slice(0, 10);
        // 4th Thursday of November (Thanksgiving) + Day After (Black Friday)
        const nov1Dow = new Date(Date.UTC(year, 10, 1, 12, 0, 0)).getUTCDay();
        const fourthThuDay = 1 + ((4 - nov1Dow + 7) % 7) + 21;
        const thanksgiving = new Date(Date.UTC(year, 10, fourthThuDay, 12, 0, 0)).toISOString().slice(0, 10);
        const blackFriday = new Date(Date.UTC(year, 10, fourthThuDay + 1, 12, 0, 0)).toISOString().slice(0, 10);

        if (dateStr === year + '-01-01') {
            return { key: 'new_years_day', isClosed: false, openHour: 11, closeHour: null, nameEn: "New Year's Day", nameEs: 'Año Nuevo', shortEn: "New Year's Day", shortEs: 'Año Nuevo' };
        }
        if (dateStr === goodFriday) {
            return { key: 'good_friday', isClosed: true, openHour: null, closeHour: null, nameEn: 'Good Friday', nameEs: 'Viernes Santo', shortEn: 'Good Friday', shortEs: 'Viernes Santo' };
        }
        if (dateStr === thanksgiving) {
            return { key: 'thanksgiving', isClosed: false, openHour: null, closeHour: 16, nameEn: 'Thanksgiving', nameEs: 'Día de Acción de Gracias', shortEn: 'Thanksgiving', shortEs: 'Acción de Gracias' };
        }
        if (dateStr === blackFriday) {
            return { key: 'day_after_thanksgiving', isClosed: false, openHour: 11, closeHour: null, nameEn: 'Holiday Hours', nameEs: 'Horario Festivo', shortEn: 'Holiday Hours', shortEs: 'Horario Especial' };
        }
        if (dateStr === year + '-12-24') {
            return { key: 'christmas_eve', isClosed: false, openHour: null, closeHour: 16, nameEn: 'Christmas Eve', nameEs: 'Nochebuena', shortEn: 'Christmas Eve', shortEs: 'Nochebuena' };
        }
        if (dateStr === year + '-12-25') {
            return { key: 'christmas_day', isClosed: true, openHour: null, closeHour: null, nameEn: 'Christmas Day', nameEs: 'Navidad', shortEn: 'Christmas Day', shortEs: 'Navidad' };
        }
        if (dateStr === year + '-12-31') {
            return { key: 'new_years_eve', isClosed: false, openHour: null, closeHour: 16, nameEn: "New Year's Eve", nameEs: 'Fin de Año', shortEn: "New Year's Eve", shortEs: 'Fin de Año' };
        }
        return null;
    };

    const tgResolveEffectiveWindow = (regWin, dateStr) => {
        const rule = tgGetOfficialHolidayRule(dateStr);
        if (!rule) {
            return { isClosedAllDay: false, openHour: regWin[0], closeHour: regWin[1], isEarlyClose: false, isLateOpen: false, rule: null };
        }
        if (rule.isClosed) {
            return { isClosedAllDay: true, openHour: 0, closeHour: 0, isEarlyClose: false, isLateOpen: false, rule };
        }
        const openHour = rule.openHour != null ? rule.openHour : regWin[0];
        const closeHour = rule.closeHour != null ? rule.closeHour : regWin[1];
        return {
            isClosedAllDay: false,
            openHour,
            closeHour,
            isEarlyClose: rule.closeHour != null && closeHour < regWin[1],
            isLateOpen: rule.openHour != null && openHour > regWin[0],
            rule
        };
    };

    const tgBuildHolidayBannerPayload = (lang, nowDate = new Date()) => {
        const la = tgGetLAParts(nowDate);
        const rule = tgGetOfficialHolidayRule(la.dateStr);
        if (!rule) return null;
        const isEs = lang === 'es';
        const pastEarlyClose = rule.closeHour != null && la.nowMins >= rule.closeHour * 60;

        let badge = isEs ? 'HORARIO FESTIVO' : 'HOLIDAY HOURS';
        let tone = 'gold';
        let messageHtml = '';

        if (rule.isClosed) {
            badge = isEs ? 'CERRADO HOY' : 'CLOSED TODAY';
            tone = 'red';
            if (rule.key === 'good_friday') {
                messageHtml = isEs
                    ? '<strong>Viernes Santo:</strong> Las 15 sucursales de Tacos Gavilan permanecen <strong>cerradas hoy</strong>. Reabrimos mañana en horario regular.'
                    : '<strong>Good Friday:</strong> All 15 Tacos Gavilan locations are <strong>closed today</strong>. We reopen tomorrow at regular hours.';
            } else {
                messageHtml = isEs
                    ? '<strong>Navidad:</strong> Las 15 sucursales de Tacos Gavilan permanecen <strong>cerradas hoy</strong>. Reabrimos mañana en horario regular.'
                    : '<strong>Christmas Day:</strong> All 15 Tacos Gavilan locations are <strong>closed today</strong>. We reopen tomorrow at regular hours.';
            }
        } else if (rule.closeHour != null) {
            if (pastEarlyClose) {
                badge = isEs ? 'CERRADO · FESTIVO' : 'CLOSED FOR HOLIDAY';
                tone = 'red';
            }
            if (rule.key === 'thanksgiving') {
                messageHtml = pastEarlyClose
                    ? (isEs
                        ? '<strong>Día de Acción de Gracias:</strong> Las 15 sucursales de Tacos Gavilan cerraron hoy a las <strong>4:00 PM</strong>. Mañana abrimos a las <strong>11:00 AM</strong>.'
                        : '<strong>Thanksgiving:</strong> All 15 Tacos Gavilan locations closed early at <strong>4:00 PM</strong> today. Tomorrow we open at <strong>11:00 AM</strong>.')
                    : (isEs
                        ? '<strong>Horario de Acción de Gracias:</strong> Las 15 sucursales de Tacos Gavilan cierran hoy temprano a las <strong>4:00 PM</strong> (incl. Drive-Thru). Mañana abrimos a las <strong>11:00 AM</strong>.'
                        : '<strong>Thanksgiving Hours:</strong> All 15 Tacos Gavilan locations close early today at <strong>4:00 PM</strong> (incl. Drive-Thru). Tomorrow we open at <strong>11:00 AM</strong>.');
            } else if (rule.key === 'christmas_eve') {
                messageHtml = pastEarlyClose
                    ? (isEs
                        ? '<strong>Nochebuena:</strong> Las 15 sucursales de Tacos Gavilan cerraron hoy a las <strong>4:00 PM</strong>. Mañana cerrado por Navidad.'
                        : '<strong>Christmas Eve:</strong> All 15 Tacos Gavilan locations closed early at <strong>4:00 PM</strong> today. Closed tomorrow for Christmas Day.')
                    : (isEs
                        ? '<strong>Horario de Nochebuena:</strong> Las 15 sucursales de Tacos Gavilan cierran hoy temprano a las <strong>4:00 PM</strong> (incl. Drive-Thru). Mañana cerrado por Navidad.'
                        : '<strong>Christmas Eve Hours:</strong> All 15 Tacos Gavilan locations close early today at <strong>4:00 PM</strong> (incl. Drive-Thru). Closed tomorrow for Christmas Day.');
            } else {
                messageHtml = pastEarlyClose
                    ? (isEs
                        ? '<strong>Fin de Año:</strong> Las 15 sucursales de Tacos Gavilan cerraron hoy a las <strong>4:00 PM</strong>. Mañana (Año Nuevo) abrimos a las <strong>11:00 AM</strong>.'
                        : "<strong>New Year's Eve:</strong> All 15 Tacos Gavilan locations closed early at <strong>4:00 PM</strong> today. Tomorrow (New Year's Day) we open at <strong>11:00 AM</strong>.")
                    : (isEs
                        ? '<strong>Horario de Fin de Año:</strong> Las 15 sucursales de Tacos Gavilan cierran hoy temprano a las <strong>4:00 PM</strong> (incl. Drive-Thru). Mañana (Año Nuevo) abrimos a las <strong>11:00 AM</strong>.'
                        : "<strong>New Year's Eve Hours:</strong> All 15 Tacos Gavilan locations close early today at <strong>4:00 PM</strong> (incl. Drive-Thru). Tomorrow (New Year's Day) we open at <strong>11:00 AM</strong>.");
            }
        } else if (rule.key === 'new_years_day') {
            messageHtml = isEs
                ? '<strong>Horario de Año Nuevo:</strong> Las 15 sucursales de Tacos Gavilan abren hoy a las <strong>11:00 AM</strong> y cierran en su horario regular.'
                : "<strong>New Year's Day Hours:</strong> All 15 Tacos Gavilan locations open at <strong>11:00 AM</strong> today and close at regular hours.";
        } else {
            messageHtml = isEs
                ? '<strong>Horario Festivo:</strong> Las 15 sucursales de Tacos Gavilan abren hoy a las <strong>11:00 AM</strong> y cierran en su horario regular de viernes.'
                : '<strong>Holiday Hours:</strong> All 15 Tacos Gavilan locations open at <strong>11:00 AM</strong> today and close at regular Friday hours.';
        }

        return {
            dateStr: la.dateStr,
            rule,
            badge,
            tone,
            messageHtml,
            ariaLabel: isEs ? 'Aviso de horario festivo de Tacos Gavilan' : 'Tacos Gavilan holiday hours notice',
            dismissLabel: isEs ? 'Cerrar aviso de horario festivo' : 'Dismiss holiday hours notice'
        };
    };

    const tgGetStoreHolidayInfo = (slug, lang, nowDate = new Date()) => {
        if (!slug || !Object.prototype.hasOwnProperty.call(TG_STORE_WEEKLY_HOURS, slug)) return null;
        const la = tgGetLAParts(nowDate);
        const rule = tgGetOfficialHolidayRule(la.dateStr);
        if (!rule) return null;

        const sched = TG_STORE_WEEKLY_HOURS[slug];
        const isEs = lang === 'es';
        const prevEff = tgResolveEffectiveWindow(sched[(la.dayIdx + 6) % 7], tgShiftDateUTC(la.dateStr, -1));
        const todayEff = tgResolveEffectiveWindow(sched[la.dayIdx], la.dateStr);
        const nextEff = tgResolveEffectiveWindow(sched[(la.dayIdx + 1) % 7], tgShiftDateUTC(la.dateStr, 1));
        const hasDriveThru = Boolean(TG_DRIVE_THRU_SLUGS[slug]);

        const dayLabel = (isEs ? 'Hoy · ' : 'Today · ') + (isEs ? rule.shortEs : rule.shortEn);
        const timeRange = todayEff.isClosedAllDay
            ? (isEs ? 'Cerrado todo el día' : 'Closed All Day')
            : (tgFormatHour12(todayEff.openHour) + ' – ' + tgFormatHour12(todayEff.closeHour));
        const subNote = (todayEff.isEarlyClose && hasDriveThru)
            ? (isEs ? 'Comedor y Drive-Thru' : 'Dining & Drive-Thru')
            : '';

        let isOpen = false;
        let statusLabel = '';
        if (!prevEff.isClosedAllDay && prevEff.closeHour > 24 && la.nowMins < (prevEff.closeHour - 24) * 60) {
            isOpen = true;
            const c = tgFormatHour12(prevEff.closeHour);
            statusLabel = isEs ? ('Abierto hasta ' + c) : ('Open until ' + c);
        } else if (todayEff.isClosedAllDay) {
            isOpen = false;
            statusLabel = isEs ? 'Cerrado hoy' : 'Closed today';
        } else if (la.nowMins >= todayEff.openHour * 60 && la.nowMins < todayEff.closeHour * 60) {
            isOpen = true;
            const c = tgFormatHour12(todayEff.closeHour);
            statusLabel = todayEff.isEarlyClose
                ? (isEs ? ('Abierto · Cierra ' + c) : ('Open · Closes ' + c))
                : (isEs ? ('Abierto hasta ' + c) : ('Open until ' + c));
        } else if (la.nowMins < todayEff.openHour * 60) {
            isOpen = false;
            const o = tgFormatHour12(todayEff.openHour);
            statusLabel = isEs ? ('Abre hoy ' + o) : ('Opens today ' + o);
        } else if (nextEff.isClosedAllDay) {
            isOpen = false;
            const nh = isEs ? nextEff.rule.shortEs : nextEff.rule.shortEn;
            statusLabel = isEs ? ('Cerrado · Mañana cerrado (' + nh + ')') : ('Closed · Closed tomorrow (' + nh + ')');
        } else {
            isOpen = false;
            const no = tgFormatHour12(nextEff.openHour);
            statusLabel = isEs ? ('Cerrado · Abre mañana ' + no) : ('Closed · Opens tomorrow ' + no);
        }

        return {
            slug,
            dateStr: la.dateStr,
            rule,
            dayLabel,
            timeRange,
            subNote,
            isOpen,
            isClosedAllDay: todayEff.isClosedAllDay,
            statusLabel
        };
    };

    const tgEnsureHolidayStyles = () => {
        if (document.getElementById('tg-holiday-notice-styles')) return;
        const styleEl = document.createElement('style');
        styleEl.id = 'tg-holiday-notice-styles';
        styleEl.textContent = `
            .tg-holiday-banner {
                position: relative;
                z-index: 950;
                width: 100%;
                margin-top: var(--header-height, 142px);
                background: linear-gradient(90deg, #1d100c 0%, #151210 50%, #1d100c 100%);
                border-top: 1px solid rgba(255, 199, 44, 0.25);
                border-bottom: 2px solid #FFC72C;
                color: #ffffff;
                box-shadow: 0 8px 28px rgba(0, 0, 0, 0.48);
            }
            .tg-holiday-banner-inner {
                max-width: 1240px;
                margin: 0 auto;
                padding: 0.78rem 2.9rem 0.78rem 1.25rem;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 0.75rem;
                flex-wrap: wrap;
                text-align: center;
                position: relative;
            }
            .tg-holiday-banner-badge {
                display: inline-flex;
                align-items: center;
                gap: 0.4rem;
                padding: 0.24rem 0.68rem;
                border-radius: 999px;
                font-size: 0.72rem;
                font-weight: 800;
                letter-spacing: 0.08em;
                text-transform: uppercase;
                background: #DA291C;
                color: #ffffff;
                white-space: nowrap;
                flex-shrink: 0;
            }
            .tg-holiday-banner--gold .tg-holiday-banner-badge {
                background: #FFC72C;
                color: #14110e;
            }
            .tg-holiday-banner-text {
                margin: 0;
                font-size: 0.92rem;
                line-height: 1.45;
                color: rgba(255, 255, 255, 0.95);
                font-weight: 500;
            }
            .tg-holiday-banner-text strong {
                color: #FFC72C;
                font-weight: 800;
            }
            .tg-holiday-banner-close {
                position: absolute;
                right: 0.75rem;
                top: 50%;
                transform: translateY(-50%);
                width: 32px;
                height: 32px;
                border-radius: 50%;
                border: 1px solid rgba(255, 255, 255, 0.22);
                background: rgba(255, 255, 255, 0.06);
                color: #ffffff;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                transition: background 0.2s, border-color 0.2s, color 0.2s;
            }
            .tg-holiday-banner-close:hover,
            .tg-holiday-banner-close:focus-visible {
                background: #DA291C;
                border-color: #DA291C;
                color: #ffffff;
                outline: 2px solid #FFC72C;
                outline-offset: 2px;
            }
            html.tg-holiday-banner-active .hero {
                margin-top: 0 !important;
            }
            html.tg-holiday-banner-active .page-content-wrapper,
            html.tg-holiday-banner-active .legal-page-wrapper,
            html.tg-holiday-banner-active .error-page-wrapper {
                padding-top: 2rem !important;
            }
            html.tg-holiday-banner-active .location-page-hero {
                padding-top: 2.75rem !important;
            }
            @media (max-width: 768px) {
                .tg-holiday-banner {
                    margin-top: calc(var(--header-height, 108px) + var(--sat, 0px));
                }
                .tg-holiday-banner-inner {
                    padding: 0.7rem 2.6rem 0.7rem 0.95rem;
                    justify-content: flex-start;
                    text-align: left;
                    gap: 0.45rem;
                }
                .tg-holiday-banner-text {
                    font-size: 0.84rem;
                }
                .tg-holiday-banner-close {
                    top: 0.65rem;
                    right: 0.55rem;
                    transform: none;
                }
            }
            .tg-holiday-schedule-row {
                display: flex;
                justify-content: space-between;
                align-items: flex-start;
                gap: 0.75rem;
                padding: 0.55rem 0.7rem;
                margin-bottom: 0.45rem;
                border-radius: 9px;
                background: rgba(255, 199, 44, 0.12);
                border: 1px solid rgba(255, 199, 44, 0.48);
            }
            .tg-holiday-schedule-row.is-closed-day {
                background: rgba(218, 41, 28, 0.16);
                border-color: rgba(218, 41, 28, 0.55);
            }
            .tg-holiday-row-left {
                display: flex;
                flex-direction: column;
                gap: 0.25rem;
                min-width: 0;
            }
            .tg-holiday-row-day {
                font-size: 0.84rem;
                font-weight: 800;
                color: #FFC72C;
                line-height: 1.25;
            }
            .tg-holiday-schedule-row.is-closed-day .tg-holiday-row-day {
                color: #ff9c94;
            }
            .tg-holiday-row-right {
                display: flex;
                flex-direction: column;
                align-items: flex-end;
                gap: 0.15rem;
                flex-shrink: 0;
            }
            .tg-holiday-row-time {
                font-size: 0.88rem;
                font-weight: 800;
                color: #ffffff;
                font-variant-numeric: tabular-nums;
                white-space: nowrap;
            }
            .tg-holiday-row-sub {
                font-size: 0.7rem;
                font-weight: 600;
                color: rgba(255, 255, 255, 0.78);
                white-space: nowrap;
            }
            .tg-holiday-status-pill {
                display: inline-flex;
                align-items: center;
                gap: 0.35rem;
                width: fit-content;
                font-size: 0.72rem;
                font-weight: 700;
                padding: 0.16rem 0.52rem;
                border-radius: 999px;
                line-height: 1.25;
            }
            .tg-holiday-status-pill.is-open {
                background: rgba(34, 197, 94, 0.18);
                border: 1px solid rgba(74, 222, 128, 0.45);
                color: #86efac;
            }
            .tg-holiday-status-pill.is-closed {
                background: rgba(218, 41, 28, 0.24);
                border: 1px solid rgba(248, 113, 113, 0.48);
                color: #fecaca;
            }
            .tg-holiday-status-dot {
                width: 6px;
                height: 6px;
                border-radius: 50%;
                background: currentColor;
                flex-shrink: 0;
            }
            .tg-home-holiday-pill {
                display: inline-flex;
                align-items: center;
                gap: 0.4rem;
                margin: 0.45rem auto 0.25rem;
                padding: 0.28rem 0.65rem;
                border-radius: 999px;
                font-size: 0.76rem;
                font-weight: 700;
                line-height: 1.3;
                background: rgba(255, 199, 44, 0.12);
                border: 1px solid rgba(255, 199, 44, 0.42);
                color: #FFC72C;
                max-width: 100%;
                flex-wrap: wrap;
                justify-content: center;
            }
            .tg-home-holiday-pill.is-closed {
                background: rgba(218, 41, 28, 0.2);
                border-color: rgba(248, 113, 113, 0.48);
                color: #fecaca;
            }
            .tg-home-holiday-pill .tg-holiday-status-dot {
                background: #4ade80;
            }
            .tg-home-holiday-pill.is-closed .tg-holiday-status-dot {
                background: #f87171;
            }
            .map-popup-hour-line.is-holiday {
                background: rgba(255, 199, 44, 0.14);
                border: 1px solid rgba(255, 199, 44, 0.42);
                border-radius: 6px;
                padding: 0.25rem 0.45rem;
                margin-bottom: 0.3rem;
            }
            .map-popup-hour-line.is-holiday .map-popup-hour-day,
            .map-popup-hour-line.is-holiday .map-popup-hour-time {
                color: #FFC72C;
                font-weight: 800;
            }
        `;
        document.head.appendChild(styleEl);
    };

    const tgRenderHolidayScheduleRowHtml = (info) => {
        if (!info) return '';
        return `
            <div class="tg-holiday-schedule-row${info.isClosedAllDay ? ' is-closed-day' : ''}" data-tg-holiday-injected="1">
                <div class="tg-holiday-row-left">
                    <span class="tg-holiday-row-day">${info.dayLabel}</span>
                    <span class="tg-holiday-status-pill ${info.isOpen ? 'is-open' : 'is-closed'}">
                        <span class="tg-holiday-status-dot" aria-hidden="true"></span>
                        <span>${info.statusLabel}</span>
                    </span>
                </div>
                <div class="tg-holiday-row-right">
                    <span class="tg-holiday-row-time">${info.timeRange}</span>
                    ${info.subNote ? `<span class="tg-holiday-row-sub">${info.subNote}</span>` : ''}
                </div>
            </div>
        `;
    };

    const tgSyncHolidayNoticeUI = (nowDate = new Date()) => {
        const lang = document.documentElement.lang === 'es' ? 'es' : 'en';
        const bannerData = tgBuildHolidayBannerPayload(lang, nowDate);

        if (!bannerData) {
            const existingBanner = document.getElementById('tg-holiday-banner');
            if (existingBanner) existingBanner.remove();
            document.documentElement.classList.remove('tg-holiday-banner-active');
            document.querySelectorAll('[data-tg-holiday-injected="1"]').forEach(el => el.remove());
            return null;
        }

        tgEnsureHolidayStyles();

        // 1. Top Bilingual Holiday Banner (unless user dismissed for today's date in this session)
        let dismissed = false;
        try {
            dismissed = sessionStorage.getItem('tg_holiday_banner_dismissed_' + bannerData.dateStr) === '1';
        } catch (e) {}

        let bannerEl = document.getElementById('tg-holiday-banner');
        if (dismissed) {
            if (bannerEl) bannerEl.remove();
            document.documentElement.classList.remove('tg-holiday-banner-active');
        } else {
            if (!bannerEl) {
                bannerEl = document.createElement('div');
                bannerEl.id = 'tg-holiday-banner';
                const headerEl = document.getElementById('header') || document.querySelector('header.header');
                if (headerEl && headerEl.parentNode) {
                    headerEl.insertAdjacentElement('afterend', bannerEl);
                } else {
                    document.body.prepend(bannerEl);
                }
            }
            bannerEl.className = 'tg-holiday-banner tg-holiday-banner--' + bannerData.tone;
            bannerEl.setAttribute('role', 'region');
            bannerEl.setAttribute('aria-label', bannerData.ariaLabel);
            bannerEl.innerHTML = `
                <div class="tg-holiday-banner-inner">
                    <span class="tg-holiday-banner-badge">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                        <span>${bannerData.badge}</span>
                    </span>
                    <p class="tg-holiday-banner-text">${bannerData.messageHtml}</p>
                    <button type="button" class="tg-holiday-banner-close" id="tg-holiday-banner-close" aria-label="${bannerData.dismissLabel}">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                </div>
            `;
            document.documentElement.classList.add('tg-holiday-banner-active');

            const closeBtn = document.getElementById('tg-holiday-banner-close');
            if (closeBtn) {
                closeBtn.addEventListener('click', () => {
                    try {
                        sessionStorage.setItem('tg_holiday_banner_dismissed_' + bannerData.dateStr, '1');
                    } catch (e) {}
                    bannerEl.remove();
                    document.documentElement.classList.remove('tg-holiday-banner-active');
                });
            }
        }

        // 2. Per-Store Holiday Hours Row on /locations/ directory cards (.store-card[data-store])
        document.querySelectorAll('.store-card[data-store]').forEach((card) => {
            const slug = card.getAttribute('data-store');
            const rowsWrap = card.querySelector('.schedule-rows');
            if (!slug || !rowsWrap) return;
            rowsWrap.querySelectorAll('[data-tg-holiday-injected="1"]').forEach(el => el.remove());
            const info = tgGetStoreHolidayInfo(slug, lang, nowDate);
            if (info) {
                rowsWrap.insertAdjacentHTML('afterbegin', tgRenderHolidayScheduleRowHtml(info));
            }
        });

        // 3. Individual Store Landing Page (/locations/<slug>/index.html)
        const detailsCardEl = document.querySelector('.location-details-card');
        if (detailsCardEl) {
            const pathMatch = window.location.pathname.match(/\/locations\/([a-z0-9-]+)\/?/i);
            const pageSlug = pathMatch ? pathMatch[1].toLowerCase() : null;
            const rowsWrap = detailsCardEl.querySelector('.schedule-rows');
            if (pageSlug && rowsWrap) {
                rowsWrap.querySelectorAll('[data-tg-holiday-injected="1"]').forEach(el => el.remove());
                const info = tgGetStoreHolidayInfo(pageSlug, lang, nowDate);
                if (info) {
                    rowsWrap.insertAdjacentHTML('afterbegin', tgRenderHolidayScheduleRowHtml(info));
                }
            }
        }

        return bannerData;
    };

    window.__tgHolidayEngine = {
        getOfficialHolidayRule: tgGetOfficialHolidayRule,
        buildBannerPayload: tgBuildHolidayBannerPayload,
        getStoreHolidayInfo: tgGetStoreHolidayInfo,
        renderScheduleRowHtml: tgRenderHolidayScheduleRowHtml,
        syncUI: tgSyncHolidayNoticeUI,
        schedules: TG_STORE_WEEKLY_HOURS,
        driveThruSlugs: TG_DRIVE_THRU_SLUGS
    };

    tgSyncHolidayNoticeUI();
    setInterval(() => {
        if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
            tgSyncHolidayNoticeUI();
        }
    }, 60000);

});
