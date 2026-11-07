import { sb, configured } from './supabase.js';
import { getUser, getAdminRole, signOut } from './auth.js';
import { cartCount, mergeServerCart } from './cart.js';
import { initNotifications } from './notifications.js';
import { initSearch } from './search.js';
import { esc } from './utils.js';

const NAV = [['/', 'Accueil'], ['/shop', 'Boutique'], ['/shop#categories', 'Catégories'], ['/b2b', 'B2B'], ['/bio', 'BIO'], ['/about', 'À propos'], ['/contact', 'Contact']];

export async function initLayout() {
  const path = location.pathname.replace(/\.html$/, '') || '/';
  const h = document.getElementById('app-header');
  if (h) h.innerHTML = `
  <header class="site-header"><div class="wrap bar">
    <button class="icon-btn menu-btn" id="menu-btn" aria-label="Menu" aria-expanded="false"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M3 12h18M3 18h18"/></svg></button>
    <a class="logo" href="/" aria-label="JLODNA Plas — accueil"><img src="/assets/logo/logo.webp" alt="JLODNA Plas." width="130" height="83"></a>
    <nav class="nav" id="nav" aria-label="Navigation principale">${NAV.map(([href, l]) => `<a href="${href}" ${path === href.split('#')[0] && !href.includes('#') ? 'aria-current="page"' : ''}>${l}</a>`).join('')}</nav>
    <form class="search" role="search" autocomplete="off"><input id="search-input" type="search" placeholder="Rechercher un produit, une catégorie, un SKU" aria-label="Rechercher"><div id="search-results" class="search-results" hidden></div></form>
    <div class="actions">
      <div id="notif-root" class="notif" hidden></div>
      <a class="icon-btn" id="account-link" href="/login" aria-label="Mon compte"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg></a>
      <a class="icon-btn" href="/cart" aria-label="Panier"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 4h2l2.4 11h10.2L20 7H6"/><circle cx="9" cy="19.5" r="1.5"/><circle cx="17" cy="19.5" r="1.5"/></svg><span class="badge-count" id="cart-count" hidden>0</span></a>
    </div></div></header>
  ${configured ? '' : '<div class="notice">Configuration Supabase manquante : renseignez VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY (voir README).</div>'}`;
  const f = document.getElementById('app-footer');
  if (f) f.innerHTML = `<footer class="site-footer"><div class="wrap grid">
    <div><img src="/assets/logo/logo.webp" alt="JLODNA Plas." width="120" height="77" loading="lazy" class="flogo"><p>JLODNA Plas — Magazin global en Haïti.</p></div>
    <div><h4>Boutique</h4><a href="/shop">Tous les produits</a><a href="/cart">Panier</a><a href="/orders">Mes commandes</a></div>
    <div><h4>JLODNA Plas</h4><a href="/about">À propos</a><a href="/contact">Contact</a><a href="/b2b">B2B — Achat en gros</a><a href="/bio">BIO</a><a href="/bio/edit">Créer mon BIO</a><a href="/seller">Devenir vendeur</a><a href="/account">Mon compte</a><a href="/delete-account">Supprimer mon compte</a></div>
    <div><h4>Newsletter</h4><form id="news-form" class="news"><input type="email" id="news-email" placeholder="Votre email" required aria-label="Email"><button class="btn primary">S’abonner</button></form></div>
  </div><div class="wrap copy">© ${new Date().getFullYear()} JLODNA Plas. Tous droits réservés.</div></footer>`;

  const mb = document.getElementById('menu-btn'); const nav = document.getElementById('nav');
  mb?.addEventListener('click', () => { const o = nav.classList.toggle('open'); mb.setAttribute('aria-expanded', String(o)); });
  const upd = () => { const c = cartCount(); const b = document.getElementById('cart-count'); if (b) { b.textContent = c; b.hidden = !c; } };
  upd(); window.addEventListener('jl:cart', upd); window.addEventListener('storage', upd);
  initSearch();
  document.getElementById('news-form')?.addEventListener('submit', async (e) => {
    e.preventDefault(); const email = document.getElementById('news-email').value.trim();
    const { error } = await sb.from('newsletter').insert({ email });
    const { toast } = await import('./utils.js');
    toast(error && !String(error.message).includes('duplicate') ? 'Une erreur est survenue. Veuillez réessayer.' : 'Merci ! Vous êtes inscrit(e).', error && !String(error.message).includes('duplicate') ? 'err' : 'ok'); e.target.reset();
  });
  if (sb) {
    const u = await getUser();
    if (u) {
      const a = document.getElementById('account-link'); a.href = '/account';
      initNotifications(); mergeServerCart();
      getAdminRole().then((r) => { if (r) a.insertAdjacentHTML('afterend', '<a class="icon-btn adm" href="/admin/" aria-label="Espace admin" title="Admin">⚙</a>'); });
    }
  }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  import('./native.js').then((m) => m.initNative()).catch(() => {}); // application Android : notifications (si déjà autorisées)
  import('./jlodni-loader.js').catch(() => {}); // JLodni : assistant d'achat (chargé en temps libre, sans bloquer la page)
}
export { signOut, esc };
