import { initLayout } from '../layout.js';
import { sb } from '../supabase.js';
import { getUser } from '../auth.js';
import { $, setLoading } from '../utils.js';
import { mountCaptcha, CAPTCHA_MSG } from '../captcha.js';

initLayout();
const root = $('#del-root');
const MSG = { REAUTH_REQUIRED: 'Reconnexion requise : réessayez en saisissant votre mot de passe.', ADMIN_ACCOUNT: 'Un compte administrateur ne peut pas être supprimé ici : contactez le super administrateur.', SELLER_RECORDS_EXIST: 'Votre boutique vendeur a un historique financier : contactez notre équipe pour la clôturer.', RATE_LIMITED: 'Trop de tentatives. Réessayez plus tard.', AUTH_DELETE_FAILED: 'Vos données sont effacées mais la clôture finale a échoué : réessayez dans un instant.', AUTH_REQUIRED: 'Session expirée : reconnectez-vous.' };
(async () => {
  if (!sb) { root.innerHTML = '<p>Configuration manquante.</p>'; return; }
  const user = await getUser();
  if (!user) { root.innerHTML = '<p>Pour supprimer votre compte, connectez-vous d’abord (cela confirme que le compte est bien le vôtre).</p><a class="btn primary" href="/login?next=/delete-account">Se connecter</a>'; return; }
  root.innerHTML = `<form id="df" novalidate><p>Compte : <strong id="em"></strong></p>
    <div class="field"><label for="pw">Mot de passe (confirmation)</label><input id="pw" type="password" autocomplete="current-password" required></div>
    <div class="field"><label for="cf">Tapez <strong>SUPPRIMER</strong> pour confirmer</label><input id="cf" autocomplete="off" required></div>
    <div id="captcha" style="margin:8px 0"></div><p class="err-msg" id="de" role="alert"></p><button class="btn primary block" id="db">Supprimer définitivement mon compte</button></form>`;
  $('#em').textContent = user.email; const cap = await mountCaptcha($('#captcha'));
  $('#df').onsubmit = async (e) => {
    e.preventDefault(); const err = $('#de'); err.textContent = '';
    if ($('#cf').value.trim() !== 'SUPPRIMER') { err.textContent = 'Tapez SUPPRIMER pour confirmer.'; return; }
    if (!$('#pw').value) { err.textContent = 'Saisissez votre mot de passe.'; return; }
    if (cap.enabled && !cap.token()) { err.textContent = CAPTCHA_MSG; return; }
    setLoading($('#db'), true, 'Suppression…');
    const re = await sb.auth.signInWithPassword({ email: user.email, password: $('#pw').value, ...(cap.token() ? { options: { captchaToken: cap.token() } } : {}) }); // connexion toute neuve exigée par le serveur
    if (re.error || !re.data.session) { cap.reset(); setLoading($('#db'), false); err.textContent = 'Mot de passe incorrect.'; return; }
    try {
      const r = await fetch('/api/account/delete', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${re.data.session.access_token}` }, body: JSON.stringify({ confirm: 'SUPPRIMER' }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setLoading($('#db'), false); cap.reset(); err.textContent = MSG[j.error] || 'Suppression impossible pour le moment.'; return; }
    } catch { setLoading($('#db'), false); err.textContent = 'Connexion impossible. Réessayez.'; return; }
    try { await sb.auth.signOut({ scope: 'local' }); } catch { /* le compte n'existe plus */ }
    localStorage.clear(); root.innerHTML = '<h2 style="font-size:1.3rem">Compte supprimé</h2><p>Votre compte et vos données ont été supprimés. Merci d’avoir utilisé JLODNA Plas.</p><a class="btn primary" href="/">Retour à l’accueil</a>';
  };
})();
