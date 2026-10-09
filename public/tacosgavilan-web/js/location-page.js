/**
 * @module TacosGavilan/LocationPage
 * @description Adds bilingual EN/ES controls to the static restaurant location pages.
 * @businessRules Toast remains the exclusive ordering destination; store facts stay in static HTML.
 * @dataFlow Reads data-en/data-es attributes from each location page and stores only language preference.
 * @notes Storage failures are non-fatal and the English server-rendered content remains usable without JS.
 */

document.addEventListener('DOMContentLoaded', () => {
    const storage = {
        get(key) {
            try { return localStorage.getItem(key); } catch (error) { return null; }
        },
        set(key, value) {
            try { localStorage.setItem(key, value); } catch (error) { /* Preference persistence is optional. */ }
        }
    };

    const toggle = document.getElementById('location-lang-toggle');

    const applyLanguage = (language) => {
        const lang = language === 'es' ? 'es' : 'en';
        document.documentElement.lang = lang;
        document.querySelectorAll('[data-en][data-es]').forEach((element) => {
            element.textContent = element.dataset[lang];
        });
        document.querySelectorAll('[data-en-aria][data-es-aria]').forEach((element) => {
            element.setAttribute('aria-label', lang === 'es' ? element.dataset.esAria : element.dataset.enAria);
        });
        if (toggle) {
            toggle.textContent = lang === 'es' ? 'EN' : 'ES';
            toggle.setAttribute('aria-label', lang === 'es' ? 'Cambiar el idioma a inglés' : 'Change language to Spanish');
        }
        storage.set('tacosgavilan_lang', lang);
    };

    applyLanguage(storage.get('tacosgavilan_lang') || 'en');
    if (toggle) {
        toggle.addEventListener('click', () => {
            applyLanguage(document.documentElement.lang === 'es' ? 'en' : 'es');
        });
    }
});
