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
});
