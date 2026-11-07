import { sb, configured } from '/js/supabase.js';
import { getUser, signIn, signOut, getAdminRole } from '/js/auth.js';
import { initNotifications } from '/js/notifications.js';
import { subscribe } from '/js/realtime.js';
import { $, esc, isEmail, setLoading, friendlyError, toast, debounce } from '/js/utils.js';

const ROLE_LABEL = { SUPER_ADMIN: 'Super admin', ADMIN: 'Admin', MANAGER: 'Manager', EDITOR: 'Éditeur', SUPPORT: 'Support' };
// [hash, libellé, permission requise, module]
const ROUTES = [
  ['dashboard', 'Tableau de bord', null, 'dashboard.js'],
  ['products', 'Produits', 'products.write', 'products.js'],
  ['categories', 'Catégories', 'categories.write', 'categories.js'],
  ['orders', 'Commandes', 'orders.write', 'orders.js'],
  ['customers', 'Clients', 'customers.read', 'customers.js'],
  ['inventory', 'Stock', 'inventory.write', 'inventory.js'],
  ['coupons', 'Promotions', 'coupons.write', 'coupons.js'],
  ['reviews', 'Avis', 'reviews.moderate', 'reviews.js'],
  ['notifications', 'Notifications', null, 'notifications.js'],
  ['messages', 'Messages', 'messages.write', 'messages.js'],
  ['settings', 'Paramètres', 'settings.write', 'settings.js'],
  ['b2b', 'Demandes B2B', 'b2b.manage', 'b2b.js'],
  ['reports', 'Signalements', 'reports.manage', 'reports.js'],
  ['sellers', 'Vendeurs', 'sellers.manage', 'sellers.js'],
  ['bio', 'Profils BIO', 'bio.moderate', 'bio.js'],
  ['assistant', 'JLodni (assistant)', 'settings.write', 'assistant.js'],
  ['audit-logs', 'Journal d’audit', 'audit.read', 'audit.js'],
];
export const ctx = { role: null, perms: new Set(), user: null, can(p) { return !p || this.role === 'SUPER_ADMIN' || this.perms.has(p); } };

// 2FA : si l'administrateur a activé la double authentification, le code est exigé avant d'ouvrir l'administration.
async function mfaGate() {
  const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal && aal.nextLevel === 'aal2' && aal.currentLevel !== 'aal2') {
    return new Promise((ok) => {
      const ov = document.createElement('div'); ov.style.cssText = 'position:fixed;inset:0;background:#fff;z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
      ov.innerHTML = '<form style="max-width:360px;width:100%"><h1 style="font-size:1.5rem">Vérification en 2 étapes</h1><p>Saisissez le code à 6 chiffres de votre application d’authentification.</p><input id="mf-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" style="width:100%;min-height:48px;font-size:1.2rem;margin:8px 0" aria-label="Code 2FA"><p id="mf-err" role="alert" style="color:#B00020;min-height:1.2em"></p><button style="min-height:48px;width:100%;font-weight:700">Vérifier</button><p><a href="#" id="mf-out">Se déconnecter</a></p></form>';
      document.body.append(ov); ov.querySelector('#mf-code').focus();
      ov.querySelector('#mf-out').onclick = async (e) => { e.preventDefault(); await sb.auth.signOut(); location.reload(); };
      ov.querySelector('form').onsubmit = async (e) => {
        e.preventDefault(); const er = ov.querySelector('#mf-err'); er.textContent = '';
        const { data: f } = await sb.auth.mfa.listFactors(); const fac = (f?.totp || []).find((x) => x.status === 'verified'); if (!fac) { er.textContent = 'Aucun facteur 2FA trouvé.'; return; }
        const ch = await sb.auth.mfa.challenge({ factorId: fac.id }); if (ch.error) { er.textContent = 'Erreur. Réessayez.'; return; }
        const vr = await sb.auth.mfa.verify({ factorId: fac.id, challengeId: ch.data.id, code: ov.querySelector('#mf-code').value.trim() });
        if (vr.error) { er.textContent = 'Code incorrect.'; return; } ov.remove(); ok(true);
      };
    });
  }
  if (!aal || aal.currentLevel !== 'aal2') setTimeout(() => $('#app')?.insertAdjacentHTML('afterbegin', '<p role="status" style="margin:0;padding:10px 16px;background:#FFF3E6;border-bottom:1px solid #FD7425">Sécurité : activez la double authentification (2FA) pour protéger ce compte administrateur — <a href="/account#security">Activer maintenant</a></p>'), 0);
  return true;
}

async function boot() {
  if (!configured) { $('#login').hidden = false; $('#err').textContent = 'Configuration Supabase manquante (voir README).'; return; }
  const u = await getUser(); const role = u ? await getAdminRole() : null;
  if (!u) return showLogin();
  if (!role) { await sb.auth.signOut(); showLogin('Accès réservé aux administrateurs.'); return; }
  ctx.user = u; ctx.role = role;
  const mf = await mfaGate(); if (!mf) return;
  const { data } = await sb.from('admin_permissions').select('permission').eq('role', role); ctx.perms = new Set((data || []).map((r) => r.permission));
  $('#login').hidden = true; $('#app').hidden = false; $('#a-role').textContent = ROLE_LABEL[role];
  $('#a-side').innerHTML = ROUTES.filter((r) => ctx.can(r[2])).map((r) => `<a href="#${r[0]}" data-r="${r[0]}">${r[1]}</a>`).join('') + '<a href="/">← Voir la boutique</a>';
  $('#a-menu').onclick = () => $('#a-side').classList.toggle('open');
  $('#a-out').onclick = signOut;
  initNotifications();
  // Temps réel : toute nouvelle commande ou changement de stock rafraîchit la vue concernée.
  const refresh = debounce(() => { if (['dashboard', 'orders', 'inventory'].includes(current())) route(); }, 600);
  subscribe('adm-orders', { event: '*', table: 'orders' }, refresh);
  subscribe('adm-inv', { event: 'UPDATE', table: 'product_variants' }, refresh);
  window.addEventListener('hashchange', route); route();
  sb.rpc('log_admin_login').then(() => {});
}
function showLogin(msg = '') { $('#app').hidden = true; $('#login').hidden = false; $('#err').textContent = msg; }
$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault(); const err = $('#err'); err.textContent = '';
  const email = $('#email').value.trim(); const pw = $('#password').value;
  if (!isEmail(email) || !pw) { err.textContent = 'Email ou mot de passe incorrect.'; return; }
  setLoading($('#btn'), true, 'Connexion…'); const { error } = await signIn(email, pw); setLoading($('#btn'), false);
  if (error) { err.textContent = friendlyError(error); return; }
  boot();
});
const current = () => (location.hash.slice(1).split('/')[0] || 'dashboard');
async function route() {
  const name = current(); const r = ROUTES.find((x) => x[0] === name) || ROUTES[0];
  document.querySelectorAll('#a-side a').forEach((a) => (a.dataset.r === r[0] ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  $('#a-side').classList.remove('open');
  const v = $('#view');
  if (!ctx.can(r[2])) { v.innerHTML = '<h1>Accès refusé</h1><p>Votre rôle ne permet pas d’ouvrir cette page.</p>'; return; }
  v.innerHTML = '<div class="sk-line"></div><div class="sk-line short"></div>';
  try { const m = await import(`./${r[3]}`); await m.render(v, location.hash.slice(1).split('/').slice(1)); }
  catch (e) { console.error(e); v.innerHTML = '<div class="empty err"><p>Une erreur est survenue. Veuillez réessayer.</p></div>'; }
}
boot();
