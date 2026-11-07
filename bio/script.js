/* JLodna Plas — Social Hub — script.js (vanilla JS, aucune dépendance) */
(function () {
  'use strict';

  /* ------------------------------------------------------------------
     CONFIGURATION
     GA_MEASUREMENT_ID : laisser "" pour désactiver toute analytique.
     Exemple si activé : "G-XXXXXXXXXX". Un bandeau de consentement
     s'affiche alors et GA4 ne se charge qu'après acceptation.
  ------------------------------------------------------------------ */
  var GA_MEASUREMENT_ID = '';
  var LANG_KEY = 'jlodna_lang';
  var CONSENT_KEY = 'jlodna_analytics_consent';
  var DEFAULT_LANG = 'ht';
  var WA_BASE = 'https://wa.me/50955561461';

  /* ------------------------------------------------------------------
     TRADUCTIONS
  ------------------------------------------------------------------ */
  var I18N = {
    ht: {
      'meta.title': 'JLodna Plas | Tout Rezo Sosyal Nou Nan Yon Sèl Plas',
      'meta.desc': 'Jwenn tout rezo sosyal ofisyèl JLodna Plas yo nan yon sèl kote. Swiv nou sou Facebook, Instagram, TikTok, YouTube ak lòt platfòm. Vizite boutik nou an.',
      'meta.locale': 'ht_HT',
      'wa.msg': 'Bonjou JLodna Plas! Mwen ta renmen jwenn plis enfòmasyon sou pwodwi nou yo.',
      'skip': 'Ale nan kontni an',
      'nav.label': 'Navigasyon prensipal',
      'nav.home': 'Akèy',
      'nav.social': 'Rezo Sosyal',
      'nav.contact': 'Kontakte Nou',
      'nav.store': 'Boutik la',
      'menu.open': 'Louvri meni an',
      'menu.close': 'Fèmen meni an',
      'lang.label': 'Chwazi lang',
      'header.store': 'Vizite Boutik la',
      'hero.eyebrow': 'BYENVENI SOU JLODNA PLAS',
      'hero.title': 'Tout sa w ap chèche, nan yon sèl plas.',
      'hero.text': 'Dekouvri JLodna Plas sou rezo sosyal yo, swiv dènye nouvèl nou yo, jwenn òf espesyal epi vizite boutik nou an pou dekouvri pwodwi ki disponib yo.',
      'hero.cta1': 'Vizite Boutik la',
      'hero.cta2': 'Swiv Nou Sou Rezo Sosyal',
      'social.title': 'Jwenn Nou Sou Rezo Sosyal Yo',
      'social.text': 'Chwazi rezo sosyal ou prefere a pou rete konekte ak JLodna Plas.',
      'fb.desc': 'Nouvèl, piblikasyon ak anons JLodna Plas yo.',
      'fb.cta': 'Swiv paj nou an',
      'ig.desc': 'Foto ak piblikasyon nou yo.',
      'ig.cta': 'Dekouvri nou sou Instagram',
      'tt.desc': 'Videyo kout nou yo.',
      'tt.cta': 'Gade videyo nou yo',
      'cl.desc': 'Videyo ak kontni nou sou Clapper.',
      'cl.cta': 'Jwenn nou sou Clapper',
      'yt.desc': 'Chanèl ofisyèl nou an, ak tout videyo nou yo.',
      'yt.cta': 'Abòne ak chanèl nou an',
      'pi.desc': 'Ide ak enspirasyon nou yo.',
      'pi.cta': 'Dekouvri ide nou yo',
      'contact.title': 'Nou la pou ede w!',
      'contact.text': 'Ou gen yon kesyon sou pwodwi nou yo? Ekri nou sou WhatsApp, n ap kontan ede w.',
      'contact.cta': 'Ekri Nou Sou WhatsApp',
      'store.title': 'Pare pou dekouvri sa nou genyen pou ou?',
      'store.text': 'Vizite boutik ofisyèl JLodna Plas la pou dekouvri pwodwi ki disponib yo epi jwenn plis enfòmasyon.',
      'store.cta': 'Antre Nan Boutik la',
      'store.tag': 'JLodna Plas — Tout sa w ap chèche, nan yon sèl plas.',
      'brand.title': 'Konsènan JLodna Plas',
      'brand.text': 'JLodna Plas se yon espas kote ou ka dekouvri pwodwi nou yo, rete konekte avèk nou epi jwenn aksè rapid ak boutik nou an.',
      'footer.tag': 'JLodna Plas — Tout sa w ap chèche, nan yon sèl plas.',
      'footer.desc': 'Espas ofisyèl pou jwenn rezo sosyal JLodna Plas yo ak boutik nou an.',
      'footer.social': 'Rezo sosyal',
      'footer.links': 'Lyen itil',
      'footer.store': 'Boutik ofisyèl la',
      'footer.top': 'Retounen anlè',
      'footer.copy': '© {year} JLodna Plas. Tout dwa rezève.',
      'footer.privacy': 'Konfidansyalite : sit sa a pa mande okenn done pèsonèl. Lyen yo louvri sit ekstèn (rezo sosyal, WhatsApp, boutik la) ki gen pwòp règ konfidansyalite yo.',
      'consent.text': 'Èske ou aksepte yon analitik anonim (Google Analytics) pou ede nou amelyore sit la?',
      'consent.yes': 'Aksepte',
      'consent.no': 'Refize'
    },
    fr: {
      'meta.title': 'JLodna Plas | Tous Nos Réseaux Sociaux Au Même Endroit',
      'meta.desc': 'Retrouvez tous les réseaux sociaux officiels de JLodna Plas au même endroit. Suivez-nous sur Facebook, Instagram, TikTok et YouTube, puis visitez notre boutique.',
      'meta.locale': 'fr_FR',
      'wa.msg': 'Bonjour JLodna Plas ! J\u2019aimerais obtenir plus d\u2019informations sur vos produits.',
      'skip': 'Aller au contenu',
      'nav.label': 'Navigation principale',
      'nav.home': 'Accueil',
      'nav.social': 'Réseaux sociaux',
      'nav.contact': 'Nous contacter',
      'nav.store': 'Boutique',
      'menu.open': 'Ouvrir le menu',
      'menu.close': 'Fermer le menu',
      'lang.label': 'Choisir la langue',
      'header.store': 'Visiter la boutique',
      'hero.eyebrow': 'BIENVENUE CHEZ JLODNA PLAS',
      'hero.title': 'Tout ce que vous cherchez, au même endroit.',
      'hero.text': 'Découvrez JLodna Plas sur les réseaux sociaux, suivez nos actualités, retrouvez nos publications et visitez notre boutique pour découvrir les produits disponibles.',
      'hero.cta1': 'Visiter la boutique',
      'hero.cta2': 'Nous suivre sur les réseaux sociaux',
      'social.title': 'Retrouvez-nous sur les réseaux sociaux',
      'social.text': 'Choisissez le réseau social que vous préférez pour rester en contact avec JLodna Plas.',
      'fb.desc': 'Actualités, publications et annonces de JLodna Plas.',
      'fb.cta': 'Suivre notre page',
      'ig.desc': 'Nos photos et nos publications.',
      'ig.cta': 'Nous découvrir sur Instagram',
      'tt.desc': 'Nos vidéos courtes.',
      'tt.cta': 'Regarder nos vidéos',
      'cl.desc': 'Nos vidéos et contenus sur Clapper.',
      'cl.cta': 'Nous retrouver sur Clapper',
      'yt.desc': 'Notre chaîne officielle, avec toutes nos vidéos.',
      'yt.cta': 'S\u2019abonner à notre chaîne',
      'pi.desc': 'Nos idées et nos inspirations.',
      'pi.cta': 'Découvrir nos idées',
      'contact.title': 'Nous sommes là pour vous aider !',
      'contact.text': 'Vous avez une question sur nos produits ? Écrivez-nous sur WhatsApp, nous serons heureux de vous aider.',
      'contact.cta': 'Nous écrire sur WhatsApp',
      'store.title': 'Prêt à découvrir ce que nous avons pour vous ?',
      'store.text': 'Visitez la boutique officielle JLodna Plas pour découvrir les produits disponibles et obtenir plus d\u2019informations.',
      'store.cta': 'Accéder à la boutique',
      'store.tag': 'JLodna Plas — Tout ce que vous cherchez, au même endroit.',
      'brand.title': 'À propos de JLodna Plas',
      'brand.text': 'JLodna Plas est un espace où vous pouvez découvrir nos produits, rester en contact avec nous et accéder rapidement à notre boutique.',
      'footer.tag': 'JLodna Plas — Tout ce que vous cherchez, au même endroit.',
      'footer.desc': 'L\u2019espace officiel pour retrouver les réseaux sociaux de JLodna Plas et notre boutique.',
      'footer.social': 'Réseaux sociaux',
      'footer.links': 'Liens utiles',
      'footer.store': 'Boutique officielle',
      'footer.top': 'Retour en haut',
      'footer.copy': '© {year} JLodna Plas. Tous droits réservés.',
      'footer.privacy': 'Confidentialité : ce site ne demande aucune donnée personnelle. Les liens ouvrent des sites externes (réseaux sociaux, WhatsApp, boutique) qui ont leurs propres règles de confidentialité.',
      'consent.text': 'Acceptez-vous une mesure d\u2019audience anonyme (Google Analytics) pour nous aider à améliorer le site ?',
      'consent.yes': 'Accepter',
      'consent.no': 'Refuser'
    }
  };

  var doc = document;
  var root = doc.documentElement;
  var currentLang = DEFAULT_LANG;

  /* ---------- Stockage sécurisé ---------- */
  function store(key, value) {
    try {
      if (value === undefined) { return window.localStorage.getItem(key); }
      window.localStorage.setItem(key, value);
    } catch (e) { /* stockage indisponible : on continue sans */ }
    return null;
  }

  /* ---------- Analytique (optionnelle) ---------- */
  var gaEnabled = /^G-[A-Z0-9]{4,}$/.test(GA_MEASUREMENT_ID);
  var gaLoaded = false;

  function loadGA() {
    if (!gaEnabled || gaLoaded) { return; }
    gaLoaded = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', GA_MEASUREMENT_ID, { anonymize_ip: true });
    var s = doc.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(GA_MEASUREMENT_ID);
    doc.head.appendChild(s);
  }

  function track(eventName, params) {
    if (!gaLoaded || typeof window.gtag !== 'function') { return; }
    try { window.gtag('event', eventName, params || {}); } catch (e) { /* ignore */ }
  }

  function setupConsent() {
    if (!gaEnabled) { return; }
    var choice = store(CONSENT_KEY);
    if (choice === 'granted') { loadGA(); return; }
    if (choice === 'denied') { return; }

    var box = doc.createElement('div');
    box.className = 'consent';
    box.setAttribute('role', 'region');
    box.setAttribute('aria-label', 'Analytics');
    box.innerHTML = '<p data-i18n="consent.text"></p><div class="consent-actions">' +
      '<button type="button" class="btn btn-primary" data-consent="granted" data-i18n="consent.yes"></button>' +
      '<button type="button" class="btn btn-outline" data-consent="denied" data-i18n="consent.no"></button></div>';
    doc.body.appendChild(box);
    applyLang(currentLang, false);

    box.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-consent]');
      if (!btn) { return; }
      var value = btn.getAttribute('data-consent');
      store(CONSENT_KEY, value);
      if (value === 'granted') { loadGA(); }
      box.parentNode.removeChild(box);
    });
  }

  /* ---------- Langue ---------- */
  function setMeta(selector, attr, value) {
    var el = doc.querySelector(selector);
    if (el) { el.setAttribute(attr, value); }
  }

  function applyLang(lang, shouldTrack) {
    if (!I18N[lang]) { lang = DEFAULT_LANG; }
    var dict = I18N[lang];
    var year = String(new Date().getFullYear());
    currentLang = lang;
    root.setAttribute('lang', lang);

    var nodes = doc.querySelectorAll('[data-i18n]');
    for (var i = 0; i < nodes.length; i++) {
      var key = nodes[i].getAttribute('data-i18n');
      if (dict[key] !== undefined) { nodes[i].textContent = dict[key].replace('{year}', year); }
    }

    var aria = doc.querySelectorAll('[data-i18n-aria]');
    for (var j = 0; j < aria.length; j++) {
      var akey = aria[j].getAttribute('data-i18n-aria');
      if (dict[akey] !== undefined) { aria[j].setAttribute('aria-label', dict[akey]); }
    }

    // Bouton du menu : libellé selon l'état
    var menuBtn = doc.querySelector('.menu-btn');
    if (menuBtn) {
      var open = menuBtn.getAttribute('aria-expanded') === 'true';
      menuBtn.setAttribute('aria-label', open ? dict['menu.close'] : dict['menu.open']);
    }

    // Boutons de langue
    var langBtns = doc.querySelectorAll('.lang-btn');
    for (var k = 0; k < langBtns.length; k++) {
      langBtns[k].setAttribute('aria-pressed', langBtns[k].getAttribute('data-lang') === lang ? 'true' : 'false');
    }

    // Titre et métadonnées
    doc.title = dict['meta.title'];
    setMeta('meta[name="description"]', 'content', dict['meta.desc']);
    setMeta('meta[property="og:title"]', 'content', dict['meta.title']);
    setMeta('meta[property="og:description"]', 'content', dict['meta.desc']);
    setMeta('meta[property="og:locale"]', 'content', dict['meta.locale']);
    setMeta('meta[name="twitter:title"]', 'content', dict['meta.title']);
    setMeta('meta[name="twitter:description"]', 'content', dict['meta.desc']);

    // Liens WhatsApp : message prérempli dans la langue choisie
    var waLinks = doc.querySelectorAll('a[data-wa]');
    for (var w = 0; w < waLinks.length; w++) {
      waLinks[w].setAttribute('href', WA_BASE + '?text=' + encodeURIComponent(dict['wa.msg']));
    }

    if (shouldTrack) { track('language_change', { language: lang }); }
  }

  function setupLanguage() {
    var saved = store(LANG_KEY);
    applyLang(saved && I18N[saved] ? saved : DEFAULT_LANG, false);

    doc.addEventListener('click', function (e) {
      var btn = e.target.closest('.lang-btn');
      if (!btn) { return; }
      var lang = btn.getAttribute('data-lang');
      if (lang === currentLang) { return; }
      store(LANG_KEY, lang);
      applyLang(lang, true);
    });
  }

  /* ---------- Menu mobile ---------- */
  function setupMenu() {
    var btn = doc.querySelector('.menu-btn');
    var nav = doc.getElementById('site-nav');
    if (!btn || !nav) { return; }

    function setOpen(open) {
      nav.classList.toggle('is-open', open);
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      btn.setAttribute('aria-label', I18N[currentLang][open ? 'menu.close' : 'menu.open']);
    }

    btn.addEventListener('click', function () {
      setOpen(btn.getAttribute('aria-expanded') !== 'true');
    });

    nav.addEventListener('click', function (e) {
      if (e.target.closest('a')) { setOpen(false); }
    });

    doc.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && btn.getAttribute('aria-expanded') === 'true') {
        setOpen(false);
        btn.focus();
      }
    });

    var mq = window.matchMedia('(min-width: 860px)');
    var onChange = function () { if (mq.matches) { setOpen(false); } };
    if (mq.addEventListener) { mq.addEventListener('change', onChange); }
  }

  /* ---------- Suivi des clics ---------- */
  function setupTracking() {
    doc.addEventListener('click', function (e) {
      var el = e.target.closest('[data-track]');
      if (!el) { return; }
      track(el.getAttribute('data-track'), {
        link_label: el.getAttribute('data-track-label') || '',
        link_url: el.getAttribute('href') || '',
        language: currentLang
      });
    });
  }

  /* ---------- Démarrage ---------- */
  function init() {
    setupLanguage();
    setupMenu();
    setupTracking();
    setupConsent();
  }

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
