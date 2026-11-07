// Bouton « Signaler » (obligatoire pour les contenus d'utilisateurs). Connexion requise ; l'équipe est alertée.
import { sb } from './supabase.js';
import { getUser } from './auth.js';
const REASONS = { inappropriate: 'Contenu inapproprié', illegal: 'Contenu illégal', spam: 'Spam / publicité', fake: 'Faux / trompeur', other: 'Autre' };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function reportButton(host, { type, target }) {
  if (!host || !sb) return;
  const a = document.createElement('button'); a.type = 'button'; a.textContent = 'Signaler'; a.style.cssText = 'background:none;border:0;color:inherit;text-decoration:underline;cursor:pointer;font:inherit;padding:8px 4px';
  a.onclick = async () => {
    if (!(await getUser())) { location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`; return; }
    const ov = document.createElement('div'); ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', 'Signaler');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:16px;z-index:9999';
    ov.innerHTML = `<form style="background:#fff;color:#000;border-radius:14px;padding:20px;max-width:420px;width:100%;text-align:left"><h2 style="font-size:1.2rem;margin:0 0 10px">Signaler ce contenu</h2>
      <label style="display:block;font-weight:600;margin:8px 0 4px" for="rp-r">Motif</label><select id="rp-r" style="width:100%;min-height:44px;font:inherit">${Object.entries(REASONS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select>
      <label style="display:block;font-weight:600;margin:8px 0 4px" for="rp-d">Précisions (facultatif)</label><textarea id="rp-d" maxlength="1000" style="width:100%;min-height:80px;font:inherit"></textarea>
      <p id="rp-e" role="alert" style="color:#B00020;min-height:1.2em;margin:6px 0"></p>
      <div style="display:flex;gap:8px;justify-content:flex-end"><button type="button" id="rp-x" style="min-height:44px;padding:0 16px">Annuler</button><button id="rp-s" style="min-height:44px;padding:0 16px;font-weight:700">Envoyer</button></div></form>`;
    document.body.append(ov);
    const close = () => ov.remove(); ov.querySelector('#rp-x').onclick = close; ov.onclick = (e) => { if (e.target === ov) close(); };
    ov.querySelector('form').onsubmit = async (e) => {
      e.preventDefault(); const b = ov.querySelector('#rp-s'); b.disabled = true;
      const { error } = await sb.rpc('submit_report', { p_type: type, p_target: String(target), p_reason: ov.querySelector('#rp-r').value, p_details: ov.querySelector('#rp-d').value.trim() || null });
      if (error) { b.disabled = false; ov.querySelector('#rp-e').textContent = /RATE_LIMITED/.test(error.message) ? 'Trop de signalements aujourd’hui.' : /NOT_FOUND/.test(error.message) ? 'Ce contenu n’existe plus.' : 'Envoi impossible. Réessayez.'; return; }
      ov.querySelector('form').innerHTML = '<h2 style="font-size:1.2rem;margin:0 0 10px">Merci</h2><p>Votre signalement a été transmis à notre équipe.</p><button type="button" id="rp-ok" style="min-height:44px;padding:0 16px;font-weight:700">Fermer</button>'; ov.querySelector('#rp-ok').onclick = close;
    };
  };
  host.append(a);
}
