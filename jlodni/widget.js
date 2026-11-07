/* JLodni — chat widget (vanilla JS, no dependencies). Include with: <script src="/jlodni/widget.js" defer></script> */
(function () {
  'use strict';
  if (window.__jlodni) return;
  window.__jlodni = true;

  var cfg = Object.assign(
    {
      endpoint: '/api/jlodni',
      avatar: '/assets/jlodni/jlodni-avatar.webp',
      avatarFallback: '/assets/jlodni/jlodni-avatar.png',
      loginUrl: '/login',
      getAccessToken: null, // async () => supabase access_token ; fallback below reads Supabase's own session storage
      addToCart: null, // async ({productId, variantId, slug, quantity}) => void ; or listen to 'jlodni:add-to-cart'
      brandColor: '#f26a1b',
      offsetBottom: 16,
      offsetRight: 16,
      lang: (document.documentElement.lang || '').slice(0, 2) === 'fr' ? 'fr' : 'ht',
    },
    window.JLODNI_CONFIG || {}
  );

  var T = {
    ht: {
      welcome: 'Bonjou! Mwen se JLodni, asistan vityèl ofisyèl JLodna Plas la. Mwen la pou ede w jwenn pwodwi, konprann kijan mache a fonksyone, epi pase kòmand ou fasil. Kisa mwen ka fè pou ou jodi a?',
      name: 'JLodni', sub: 'Asistan vityèl JLodna Plas', open: 'Louvri chat JLodni', close: 'Fèmen chat la',
      placeholder: 'Ekri mesaj ou…', send: 'Voye', typing: 'JLodni ap ekri', view: 'Wè pwodwi a', add: 'Ajoute nan panyen',
      added: 'Ajoute!', soldout: 'Fini', inStock: 'Disponib', login: 'Konekte', option: 'Opsyon',
      err: 'Mwen pa ka reponn pou kounye a. Tanpri eseye ankò.', off: 'Asistan an pa disponib pou kounye a.', retry: 'Eseye ankò',
      limit: 'Ou voye twòp mesaj. Tann yon ti moman epi eseye ankò.', ai: 'Asistan IA – li ka fè erè. Verifye detay yo sou paj pwodwi a.',
      quick: [['Jwenn yon pwodwi', 'Mwen vle jwenn yon pwodwi.'], ['Kijan pou m achte?', 'Kijan pou m achte sou JLodna Plas?'], ['Swiv kòmand mwen', 'Ki kote kòmand mwen an rive?'], ['Metòd peman', 'Ki metòd peman ki disponib?'], ['Livrezon', 'Kijan livrezon an fonksyone?'], ['Kont mwen', 'Kijan pou m kreye oswa jere kont mwen?']],
    },
    fr: {
      welcome: 'Bonjour ! Je suis JLodni, l’assistant virtuel officiel de JLodna Plas. Je vous aide à trouver des produits, comprendre le fonctionnement du marché et passer commande facilement. Que puis-je faire pour vous aujourd’hui ?',
      name: 'JLodni', sub: 'Assistant virtuel JLodna Plas', open: 'Ouvrir le chat JLodni', close: 'Fermer le chat',
      placeholder: 'Écrivez votre message…', send: 'Envoyer', typing: 'JLodni écrit', view: 'Voir le produit', add: 'Ajouter au panier',
      added: 'Ajouté !', soldout: 'Épuisé', inStock: 'Disponible', login: 'Se connecter', option: 'Option',
      err: 'Je ne peux pas répondre pour le moment. Veuillez réessayer.', off: 'L’assistant est indisponible pour le moment.', retry: 'Réessayer',
      limit: 'Trop de messages envoyés. Patientez un instant puis réessayez.', ai: 'Assistant IA – il peut se tromper. Vérifiez les détails sur la page du produit.',
      quick: [['Trouver un produit', 'Je cherche un produit.'], ['Comment acheter ?', 'Comment acheter sur JLodna Plas ?'], ['Suivre ma commande', 'Où en est ma commande ?'], ['Moyens de paiement', 'Quels moyens de paiement sont disponibles ?'], ['Livraison', 'Comment fonctionne la livraison ?'], ['Mon compte', 'Comment créer ou gérer mon compte ?']],
    },
  };
  var t = T[cfg.lang];

  var CSS =
    '.jas{--c:' + cfg.brandColor + ';font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;font-size:15px;line-height:1.4;color:#111}' +
    '.jas *{box-sizing:border-box}' +
    '.jas-fab{position:fixed;right:' + cfg.offsetRight + 'px;bottom:calc(' + cfg.offsetBottom + 'px + env(safe-area-inset-bottom,0px));width:60px;height:60px;border-radius:50%;border:3px solid var(--c);background:#fff;padding:0;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.3);z-index:2147483000;overflow:hidden}' +
    '.jas-fab:focus-visible,.jas button:focus-visible,.jas input:focus-visible,.jas select:focus-visible,.jas a:focus-visible{outline:3px solid #111;outline-offset:2px}' +
    '.jas-av{width:100%;height:100%;object-fit:cover;object-position:50% 20%;transform:scale(1.3);transform-origin:50% 28%;display:block;background:#fff}' +
    '.jas-panel{position:fixed;right:' + cfg.offsetRight + 'px;bottom:calc(' + cfg.offsetBottom + 'px + env(safe-area-inset-bottom,0px));width:min(380px,calc(100vw - 24px));height:min(620px,calc(100dvh - 32px));background:#fff;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.35);display:none;flex-direction:column;overflow:hidden;z-index:2147483001}' +
    '.jas-panel.open{display:flex}' +
    '.jas-head{display:flex;align-items:center;gap:10px;padding:10px 12px;background:#111;color:#fff}' +
    '.jas-head .jas-ha{width:42px;height:42px;border-radius:50%;overflow:hidden;border:2px solid var(--c);background:#fff;flex:none}' +
    '.jas-head b{display:block;font-size:15px}.jas-head small{color:#ccc;font-size:12px}' +
    '.jas-x{margin-left:auto;background:none;border:0;color:#fff;font-size:26px;line-height:1;cursor:pointer;padding:4px 8px;min-width:44px;min-height:44px}' +
    '.jas-log{flex:1;overflow-y:auto;padding:12px;background:#f4f4f5;display:flex;flex-direction:column;gap:8px}' +
    '.jas-m{max-width:88%;padding:9px 12px;border-radius:14px;word-wrap:break-word;overflow-wrap:anywhere}' +
    '.jas-m.bot{background:#fff;border:1px solid #e4e4e7;align-self:flex-start;border-bottom-left-radius:4px}' +
    '.jas-m.me{background:var(--c);color:#111;align-self:flex-end;border-bottom-right-radius:4px}' +
    '.jas-m a{color:#b34700}' +
    '.jas-note{font-size:11px;color:#71717a;text-align:center;padding:2px 8px}' +
    '.jas-q{display:flex;gap:6px;overflow-x:auto;padding:8px 10px;background:#f4f4f5;border-top:1px solid #e4e4e7;scrollbar-width:thin}' +
    '.jas-q button{flex:none;border:1px solid var(--c);background:#fff;color:#111;border-radius:999px;padding:8px 12px;font-size:13px;cursor:pointer;min-height:36px}' +
    '.jas-q button:hover{background:var(--c)}' +
    '.jas-form{display:flex;gap:8px;padding:10px;border-top:1px solid #e4e4e7;background:#fff}' +
    '.jas-form input{flex:1;border:1px solid #a1a1aa;border-radius:999px;padding:10px 14px;font-size:16px;min-width:0}' +
    '.jas-form button{border:0;background:var(--c);color:#111;font-weight:600;border-radius:999px;padding:0 16px;cursor:pointer;min-height:44px}' +
    '.jas-form button:disabled{opacity:.5;cursor:default}' +
    '.jas-dots{display:flex;gap:4px;padding:12px}.jas-dots i{width:7px;height:7px;border-radius:50%;background:#a1a1aa;animation:jb 1s infinite}.jas-dots i:nth-child(2){animation-delay:.15s}.jas-dots i:nth-child(3){animation-delay:.3s}' +
    '@keyframes jb{0%,60%,100%{transform:translateY(0)}30%{transform:translateY(-5px)}}' +
    '.jas-cards{display:flex;gap:8px;overflow-x:auto;padding:2px 0 6px;align-self:stretch;scroll-snap-type:x mandatory}' +
    '.jas-card{flex:none;width:200px;background:#fff;border:1px solid #e4e4e7;border-radius:12px;overflow:hidden;scroll-snap-align:start;display:flex;flex-direction:column}' +
    '.jas-card img{width:100%;height:120px;object-fit:cover;background:#e4e4e7;display:block}' +
    '.jas-cb{padding:8px;display:flex;flex-direction:column;gap:5px;flex:1}.jas-cb h4{margin:0;font-size:14px;line-height:1.25}' +
    '.jas-p{font-weight:700}.jas-p s{font-weight:400;color:#71717a;margin-left:4px;font-size:12px}' +
    '.jas-s{font-size:12px}.jas-s.ok{color:#15803d}.jas-s.no{color:#b91c1c}' +
    '.jas-card select{width:100%;padding:6px;font-size:13px;border:1px solid #a1a1aa;border-radius:8px;background:#fff}' +
    '.jas-card .jas-btn{display:block;text-align:center;text-decoration:none;border:1px solid #111;background:#fff;color:#111;border-radius:8px;padding:8px;font-size:13px;cursor:pointer;min-height:36px}' +
    '.jas-card .jas-btn.pri{background:#111;color:#fff}.jas-card .jas-btn:disabled{opacity:.45;cursor:default}' +
    '.jas-login{align-self:flex-start;border:0;background:#111;color:#fff;border-radius:999px;padding:9px 16px;cursor:pointer;min-height:40px;text-decoration:none}' +
    '@media (max-width:480px){.jas-panel{right:0;bottom:0;width:100vw;height:min(88dvh,100dvh);border-radius:16px 16px 0 0}}' +
    '@media (prefers-reduced-motion:reduce){.jas-dots i{animation:none}}';

  var STORE = 'jlodni:v1';
  var state = { open: false, msgs: [], busy: false };
  try {
    var saved = JSON.parse(sessionStorage.getItem(STORE) || 'null');
    if (saved && Array.isArray(saved.msgs)) { state.msgs = saved.msgs.slice(-40); state.open = !!saved.open; }
  } catch (e) { /* ignore */ }
  function persist() {
    try { sessionStorage.setItem(STORE, JSON.stringify({ open: state.open, msgs: state.msgs.slice(-40) })); } catch (e) { /* ignore */ }
  }

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') n.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), attrs[k]);
      else n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }
  function safeUrl(u) {
    try { var x = new URL(u, location.origin); return /^https?:$/.test(x.protocol) ? x.href : null; } catch (e) { return null; }
  }
  function fmt(n) { return Number(n).toLocaleString('fr-FR', { maximumFractionDigits: 2 }) + ' HTG'; }
  function avatarImg(cls) {
    var i = el('img', { src: cfg.avatar, alt: 'JLodni virtual shopping assistant', class: cls || 'jas-av', width: '60', height: '60', decoding: 'async' });
    i.addEventListener('error', function () { if (i.src.indexOf(cfg.avatarFallback) < 0) i.src = cfg.avatarFallback; }, { once: true });
    return i;
  }

  // text -> DOM (no innerHTML): **bold** and links to https URLs only
  function renderText(container, text) {
    String(text).split('\n').forEach(function (line, li) {
      if (li) container.appendChild(document.createElement('br'));
      var re = /(\*\*[^*]+\*\*|https?:\/\/[^\s)]+)/g, last = 0, m;
      while ((m = re.exec(line))) {
        if (m.index > last) container.appendChild(document.createTextNode(line.slice(last, m.index)));
        if (m[0].charAt(0) === '*') container.appendChild(el('strong', { text: m[0].slice(2, -2) }));
        else {
          var href = safeUrl(m[0]);
          container.appendChild(href ? el('a', { href: href, target: '_blank', rel: 'noopener noreferrer', text: m[0] }) : document.createTextNode(m[0]));
        }
        last = m.index + m[0].length;
      }
      if (last < line.length) container.appendChild(document.createTextNode(line.slice(last)));
    });
  }

  // ---- DOM ----
  var host = el('div', { class: 'jas' });
  host.appendChild(el('style', { text: CSS }));
  var fab = el('button', { class: 'jas-fab', type: 'button', 'aria-label': t.open, 'aria-haspopup': 'dialog', 'aria-expanded': 'false', onclick: function () { setOpen(true); } }, [avatarImg()]);
  var log = el('div', { class: 'jas-log', role: 'log', 'aria-live': 'polite', 'aria-label': t.name });
  var quick = el('div', { class: 'jas-q', role: 'group', 'aria-label': 'Quick replies' });
  var input = el('input', { type: 'text', maxlength: '500', placeholder: t.placeholder, 'aria-label': t.placeholder, autocomplete: 'off', enterkeyhint: 'send' });
  var sendBtn = el('button', { type: 'submit', text: t.send });
  var form = el('form', { class: 'jas-form', onsubmit: function (e) { e.preventDefault(); submit(input.value); } }, [input, sendBtn]);
  var closeBtn = el('button', { class: 'jas-x', type: 'button', 'aria-label': t.close, text: '×', onclick: function () { setOpen(false); } });
  var head = el('div', { class: 'jas-head' }, [el('div', { class: 'jas-ha' }, [avatarImg()]), el('div', {}, [el('b', { text: t.name }), el('small', { text: t.sub })]), closeBtn]);
  var panel = el('div', { class: 'jas-panel', role: 'dialog', 'aria-label': t.name, 'aria-modal': 'false' }, [head, log, quick, form]);
  panel.addEventListener('keydown', function (e) { if (e.key === 'Escape') setOpen(false); });
  host.appendChild(fab);
  host.appendChild(panel);

  t.quick.forEach(function (q) { quick.appendChild(el('button', { type: 'button', text: q[0], onclick: function () { submit(q[1]); } })); });

  function setOpen(v) {
    state.open = v;
    panel.classList.toggle('open', v);
    fab.style.display = v ? 'none' : '';
    fab.setAttribute('aria-expanded', String(v));
    persist();
    if (v) { scrollDown(); setTimeout(function () { input.focus(); }, 50); }
    else fab.focus();
  }
  function scrollDown() { log.scrollTop = log.scrollHeight; }

  function cardNode(c) {
    var avail = c.variants.filter(function (v) { return v.available; });
    var sel = null;
    if (avail.length > 1) {
      sel = el('select', { 'aria-label': t.option + ' – ' + c.name }, avail.map(function (v) { return el('option', { value: v.id, text: v.name + ' – ' + fmt(v.price) }); }));
    }
    var priceTxt = c.price != null ? fmt(c.price) : '';
    var img = safeUrl(c.image);
    var addBtn = el('button', { type: 'button', class: 'jas-btn pri', text: t.add, onclick: function () { addToCart(c, sel ? sel.value : avail[0] && avail[0].id, addBtn); } });
    if (!c.available) addBtn.disabled = true;
    var url = safeUrl(c.url);
    return el('div', { class: 'jas-card' }, [
      img ? el('img', { src: img, alt: c.name, loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' }) : null,
      el('div', { class: 'jas-cb' }, [
        el('h4', { text: c.name }),
        el('div', { class: 'jas-p', text: priceTxt }),
        el('div', { class: 'jas-s ' + (c.available ? 'ok' : 'no'), text: c.available ? t.inStock : t.soldout }),
        sel,
        url ? el('a', { class: 'jas-btn', href: url, text: t.view }) : null,
        addBtn,
      ]),
    ]);
  }

  function addToCart(c, variantId, btn) {
    var vv = c.variants.filter(function (x) { return x.id === variantId; })[0];
    var detail = { productId: c.id, variantId: variantId, slug: c.slug, quantity: 1, max: (vv && vv.max) || 99 };
    var done = function () { btn.textContent = t.added; setTimeout(function () { btn.textContent = t.add; }, 2000); };
    if (typeof cfg.addToCart === 'function') {
      Promise.resolve(cfg.addToCart(detail)).then(done).catch(function () { location.href = c.url; });
      return;
    }
    // cancelable event: a site handler calls preventDefault() to signal it handled the action
    var handled = !document.dispatchEvent(new CustomEvent('jlodni:add-to-cart', { detail: detail, cancelable: true }));
    if (handled) done(); else location.href = c.url; // fallback: official product page
  }

  // returns the customer to the current page after login (site supports ?next=)
  function loginHref() {
    return cfg.loginUrl + (cfg.loginUrl.indexOf('?') < 0 ? '?' : '&') + 'next=' + encodeURIComponent(location.pathname + location.search);
  }

  function renderMsg(m) {
    if (m.role === 'user') return el('div', { class: 'jas-m me', text: m.text });
    var b = el('div', { class: 'jas-m bot' });
    renderText(b, m.text);
    return b;
  }
  function renderAll() {
    log.textContent = '';
    log.appendChild(el('div', { class: 'jas-note', text: t.ai }));
    var w = el('div', { class: 'jas-m bot' }); renderText(w, t.welcome); log.appendChild(w);
    state.msgs.forEach(function (m) {
      log.appendChild(renderMsg(m));
      if (m.cards && m.cards.length) log.appendChild(el('div', { class: 'jas-cards' }, m.cards.map(cardNode)));
      if (m.needsAuth) log.appendChild(el('a', { class: 'jas-login', href: loginHref(), text: t.login }));
    });
    scrollDown();
  }

  function setBusy(v) {
    state.busy = v; sendBtn.disabled = v; input.disabled = v;
    var d = log.querySelector('.jas-typing');
    if (v && !d) {
      log.appendChild(el('div', { class: 'jas-m bot jas-typing', role: 'status', 'aria-label': t.typing }, [el('div', { class: 'jas-dots' }, [el('i'), el('i'), el('i')])]));
      scrollDown();
    } else if (!v && d) d.remove();
    if (!v && state.open) input.focus();
  }

  async function token() {
    try {
      if (cfg.getAccessToken) return (await cfg.getAccessToken()) || null;
      for (var i = 0; i < localStorage.length; i++) { // fallback: Supabase JS stores the session under sb-<ref>-auth-token
        var k = localStorage.key(i);
        if (/^sb-.+-auth-token$/.test(k)) { var s = JSON.parse(localStorage.getItem(k)); return (s && (s.access_token || (s.currentSession && s.currentSession.access_token))) || null; }
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  async function submit(text) {
    text = String(text || '').trim().slice(0, 500);
    if (!text || state.busy) return;
    input.value = '';
    var history = state.msgs.slice(-10).map(function (m) { return { role: m.role, text: m.text }; });
    state.msgs.push({ role: 'user', text: text });
    persist(); renderAll(); setBusy(true);
    var reply;
    try {
      var tk = await token();
      var r = await fetch(cfg.endpoint, {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, tk ? { Authorization: 'Bearer ' + tk } : {}),
        body: JSON.stringify({ message: text, history: history }),
        signal: AbortSignal.timeout ? AbortSignal.timeout(40000) : undefined,
      });
      var data = await r.json().catch(function () { return {}; });
      if (r.status === 429) reply = { role: 'assistant', text: t.limit };
      else if (r.status === 503) reply = { role: 'assistant', text: t.off };
      else if (!r.ok || !data.reply) reply = { role: 'assistant', text: t.err };
      else reply = { role: 'assistant', text: data.reply, cards: (data.cards || []).slice(0, 8), needsAuth: !!data.needsAuth };
    } catch (e) {
      reply = { role: 'assistant', text: t.err };
    }
    state.msgs.push(reply);
    persist(); setBusy(false); renderAll();
  }

  function mount() {
    document.body.appendChild(host);
    renderAll();
    setOpen(state.open);
  }
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
})();
