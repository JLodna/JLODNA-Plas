import { initLayout } from '../layout.js';
import { sb } from '../supabase.js';
import { requireUser, signOut } from '../auth.js';
import { isNative, enablePush, pushEnabled } from '../native.js';
import { $, $$, esc, fmtDate, setLoading, toast, friendlyError, emptyState } from '../utils.js';

initLayout();
let user; const box = $('#tab');
const tabs = {
  async profile() {
    const { data: p } = await sb.from('profiles').select('*').eq('id', user.id).maybeSingle();
    box.innerHTML = `<form id="pf"><div class="two"><div class="field"><label for="fn">Prénom</label><input id="fn" value="${esc(p?.first_name)}" required></div><div class="field"><label for="ln">Nom</label><input id="ln" value="${esc(p?.last_name)}" required></div></div>
    <div class="field"><label for="em">Email</label><input id="em" value="${esc(user.email)}" disabled></div><div class="field"><label for="ph">Téléphone</label><input id="ph" type="tel" value="${esc(p?.phone)}"></div><button class="btn primary" id="pb">Enregistrer</button></form>`;
    $('#pf').onsubmit = async (e) => { e.preventDefault(); setLoading($('#pb'), true); const { error } = await sb.from('profiles').update({ first_name: $('#fn').value.trim(), last_name: $('#ln').value.trim(), phone: $('#ph').value.trim() }).eq('id', user.id); setLoading($('#pb'), false); toast(error ? friendlyError(error) : 'Profil enregistré.', error ? 'err' : 'ok'); };
  },
  async orders() { box.innerHTML = '<p>Retrouvez toutes vos commandes et leur suivi.</p><a class="btn primary" href="/orders">Voir mes commandes</a>'; },
  async bio() { box.innerHTML = '<p>Créez votre profil numérique BIO : présentation, liens, vidéo et QR code à partager.</p><a class="btn primary" href="/bio/edit">Gérer mon BIO</a>'; },
  async b2b() { box.innerHTML = '<p>Suivez vos demandes d’achat en gros, devis et commandes spéciales, et échangez avec notre équipe.</p><a class="btn primary" href="/b2b#mes-demandes">Voir mes demandes B2B</a>'; },
  async seller() { box.innerHTML = '<p>Vendez vos produits sur JLODNA Plas : candidature, produits, ventes et reversements.</p><a class="btn primary" href="/seller">Mon espace vendeur</a>'; },
  async privacy() {
    box.innerHTML = `<h3>Mes données</h3><p class="muted">Vous gardez le contrôle de vos informations personnelles.</p>
    <div class="order-card"><strong>Télécharger mes données</strong><p class="muted">Profil, adresses, commandes, avis, demandes B2B et BIO, au format JSON.</p><button class="btn ghost" id="exp">Télécharger mes données</button></div>
    <div class="order-card"><strong>Supprimer mon compte</strong><p class="muted">Suppression définitive de votre compte et de vos données. Les commandes passées sont conservées mais anonymisées.</p><a class="btn ghost" href="/delete-account">Supprimer mon compte</a></div>`;
    $('#exp').onclick = async () => { setLoading($('#exp'), true, 'Préparation…'); const { data, error } = await sb.rpc('export_my_data'); setLoading($('#exp'), false); if (error) return toast(friendlyError(error), 'err'); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })); a.download = 'mes-donnees-jlodna.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
  },
  async security() {
    box.innerHTML = '<div class="sk-line"></div>';
    const { data: f } = await sb.auth.mfa.listFactors(); const ok = (f?.totp || []).filter((x) => x.status === 'verified');
    for (const x of (f?.totp || []).filter((y) => y.status !== 'verified')) await sb.auth.mfa.unenroll({ factorId: x.id }); // restes d'activations abandonnées
    if (ok.length) {
      box.innerHTML = `<h3>Double authentification (2FA)</h3><p class="order-card">✔ Activée. Un code de votre application d’authentification est demandé pour accéder à l’administration.</p><button class="btn ghost" id="mf-off">Désactiver la 2FA</button><p class="err-msg" id="mf-e" role="alert"></p>`;
      $('#mf-off').onclick = async () => { if (!confirm('Désactiver la double authentification ?')) return; const { error } = await sb.auth.mfa.unenroll({ factorId: ok[0].id }); if (error) { $('#mf-e').textContent = 'Reconnectez-vous avec votre code 2FA puis réessayez.'; return; } toast('2FA désactivée.'); show('security'); };
      return;
    }
    box.innerHTML = `<h3>Double authentification (2FA)</h3><p class="muted">Protège votre compte avec un code à usage unique (Google Authenticator, Authy, 2FAS…). <strong>Fortement recommandé pour les administrateurs.</strong></p><button class="btn primary" id="mf-on">Activer la 2FA</button><p class="err-msg" id="mf-e" role="alert"></p>`;
    $('#mf-on').onclick = async () => {
      const { data, error } = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'JLODNA Plas' });
      if (error) { $('#mf-e').textContent = 'Activation impossible pour le moment.'; return; }
      box.innerHTML = `<h3>Activer la 2FA</h3><ol><li>Scannez ce QR code avec votre application d’authentification.</li><li>Saisissez le code à 6 chiffres affiché.</li></ol><img alt="QR code 2FA" width="200" height="200" id="mf-qr"><p class="muted" style="overflow-wrap:anywhere">Ou saisissez cette clé : <code id="mf-sec"></code></p>
        <div class="field"><label for="mf-c">Code à 6 chiffres</label><input id="mf-c" inputmode="numeric" autocomplete="one-time-code" maxlength="6"></div><p class="err-msg" id="mf-e" role="alert"></p><button class="btn primary" id="mf-v">Vérifier et activer</button>`;
      $('#mf-qr').src = data.totp.qr_code; $('#mf-sec').textContent = data.totp.secret;
      $('#mf-v').onclick = async () => {
        const ch = await sb.auth.mfa.challenge({ factorId: data.id }); if (ch.error) { $('#mf-e').textContent = 'Erreur. Réessayez.'; return; }
        const vr = await sb.auth.mfa.verify({ factorId: data.id, challengeId: ch.data.id, code: $('#mf-c').value.trim() });
        if (vr.error) { $('#mf-e').textContent = 'Code incorrect.'; return; } toast('2FA activée.'); show('security');
      };
    };
  },
  async notifs() {
    const nat = isNative();
    const { data } = await sb.from('notifications').select('*').order('created_at', { ascending: false }).limit(50);
    const pushHtml = nat ? `<div class="order-card"><strong>Notifications sur ce téléphone</strong><p class="muted">Recevez une alerte pour vos commandes, paiements et réponses.</p><button class="btn ${pushEnabled() ? 'ghost' : 'primary'}" id="push-btn">${pushEnabled() ? 'Notifications activées ✔' : 'Activer les notifications'}</button><p class="err-msg" id="push-e" role="alert"></p></div>` : '';
    box.innerHTML = pushHtml + (data?.length ? data.map((n) => `<div class="order-card"><strong>${esc(n.title)}</strong><br><span class="muted">${esc(n.body || '')} · ${fmtDate(n.created_at)}</span></div>`).join('') : emptyState('Aucune notification.'));
    if (nat) $('#push-btn').onclick = async () => { try { await enablePush(); $('#push-btn').textContent = 'Notifications activées ✔'; toast('Notifications activées.'); } catch (ex) { $('#push-e').textContent = ex.message; } };
  },
  async addresses() {
    const { data } = await sb.from('addresses').select('*').order('created_at');
    box.innerHTML = (data?.length ? data.map((a) => `<div class="order-card"><strong>${esc(a.label || a.full_name)}</strong>${a.is_default ? ' <span class="status">Par défaut</span>' : ''}<br>${esc(a.full_name)} · ${esc(a.phone)}<br>${esc(a.address)}, ${esc(a.city)}, ${esc(a.department)}<br><button class="link" data-def="${a.id}">Définir par défaut</button> <button class="link" data-del="${a.id}">Supprimer</button></div>`).join('') : emptyState('Aucune adresse enregistrée.')) + `<h3 style="margin-top:20px">Ajouter une adresse</h3><form id="af"><div class="field"><label for="al">Nom de l’adresse (Maison, Bureau…)</label><input id="al"></div><div class="two"><div class="field"><label for="an">Nom complet</label><input id="an" required></div><div class="field"><label for="ap">Téléphone</label><input id="ap" type="tel" required></div></div><div class="field"><label for="aa">Adresse</label><input id="aa" required></div><div class="two"><div class="field"><label for="ac">Ville</label><input id="ac" required></div><div class="field"><label for="ad">Département</label><input id="ad" required></div></div><button class="btn primary" id="ab">Ajouter</button></form>`;
    $('#af').onsubmit = async (e) => { e.preventDefault(); setLoading($('#ab'), true); const { error } = await sb.from('addresses').insert({ user_id: user.id, label: $('#al').value.trim() || null, full_name: $('#an').value.trim(), phone: $('#ap').value.trim(), address: $('#aa').value.trim(), city: $('#ac').value.trim(), department: $('#ad').value.trim(), is_default: !data?.length }); setLoading($('#ab'), false); if (error) toast(friendlyError(error), 'err'); else { toast('Adresse ajoutée.'); tabs.addresses(); } };
    $$('[data-del]', box).forEach((b) => (b.onclick = async () => { await sb.from('addresses').delete().eq('id', b.dataset.del); tabs.addresses(); }));
    $$('[data-def]', box).forEach((b) => (b.onclick = async () => { await sb.from('addresses').update({ is_default: false }).eq('user_id', user.id); await sb.from('addresses').update({ is_default: true }).eq('id', b.dataset.def); tabs.addresses(); }));
  },
  async settings() {
    box.innerHTML = `<form id="sf"><h3>Changer le mot de passe</h3><div class="field"><label for="np">Nouveau mot de passe (8 caractères minimum)</label><input id="np" type="password" minlength="8" autocomplete="new-password" required></div><button class="btn primary" id="sb">Mettre à jour</button></form><hr style="margin:24px 0;border:0;border-top:1px solid var(--g100)"><button class="btn ghost" id="out">Se déconnecter</button>`;
    $('#sf').onsubmit = async (e) => { e.preventDefault(); if ($('#np').value.length < 8) return toast('Le mot de passe doit contenir au moins 8 caractères.', 'err'); setLoading($('#sb'), true); const { error } = await sb.auth.updateUser({ password: $('#np').value }); setLoading($('#sb'), false); toast(error ? friendlyError(error) : 'Mot de passe mis à jour.', error ? 'err' : 'ok'); e.target.reset(); };
    $('#out').onclick = signOut;
  },
};
async function show(name) { $$('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name))); box.innerHTML = '<div class="sk-line"></div><div class="sk-line short"></div>'; try { await tabs[name](); } catch { box.innerHTML = '<p>Une erreur est survenue. Veuillez réessayer.</p>'; } }
(async () => { if (!sb) return; user = await requireUser(); if (!user) return; $$('.tabs button').forEach((b) => (b.onclick = () => { history.replaceState(null, '', '#' + b.dataset.tab); show(b.dataset.tab); })); show(tabs[location.hash.slice(1)] ? location.hash.slice(1) : 'profile'); })();
