import { sb } from '/js/supabase.js';
import { $, $$, esc, toast, friendlyError, isEmail } from '/js/utils.js';
import { table } from './ui.js';
import { ctx } from './admin.js';
const ROLES = ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'EDITOR', 'SUPPORT'];
export async function render(el) {
  const { data: rows, error } = await sb.from('settings').select('*').in('key', ['store', 'shipping', 'payment_methods']); if (error) throw error;
  const S = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const pm = S.payment_methods || {};
  el.innerHTML = `<h1>Paramètres</h1>
  <form id="sf" class="panel-box" style="max-width:640px"><h2>Boutique</h2>
  <div class="two"><div class="field"><label for="sn">Nom</label><input id="sn" value="${esc(S.store?.name || 'JLODNA Plas')}"></div><div class="field"><label for="sp">Téléphone</label><input id="sp" value="${esc(S.store?.phone || '')}"></div></div>
  <h2>Livraison</h2><div class="two"><div class="field"><label for="sh">Frais de livraison (G)</label><input id="sh" type="number" min="0" value="${S.shipping?.flat_fee ?? 0}"></div><div class="field"><label for="sf2">Livraison offerte dès (G, 0 = jamais)</label><input id="sf2" type="number" min="0" value="${S.shipping?.free_over ?? 0}"></div></div>
  <h2>Modes de paiement</h2><p class="muted">Seul le paiement à la livraison est opérationnel. Les autres passerelles doivent d’abord être configurées (voir README) avant d’être activées.</p>
  ${Object.entries(pm).map(([k, v]) => `<label class="chk"><input type="checkbox" data-pm="${esc(k)}" ${v.enabled ? 'checked' : ''} ${k === 'cod' ? '' : 'disabled'}> ${esc(v.label)}${k === 'cod' ? '' : ' (non configuré)'}</label>`).join('')}
  <div style="margin-top:14px"><button class="btn primary" id="sb">Enregistrer</button></div></form>
  ${ctx.role === 'SUPER_ADMIN' ? '<div id="team"></div>' : ''}`;
  $('#sf').onsubmit = async (e) => {
    e.preventDefault();
    const next = { store: { ...S.store, name: $('#sn').value.trim() || 'JLODNA Plas', phone: $('#sp').value.trim() }, shipping: { flat_fee: +$('#sh').value || 0, free_over: +$('#sf2').value || null },
      payment_methods: Object.fromEntries(Object.entries(pm).map(([k, v]) => [k, { ...v, enabled: k === 'cod' ? $(`[data-pm="cod"]`).checked : v.enabled }])) };
    for (const [key, value] of Object.entries(next)) { const { error } = await sb.from('settings').upsert({ key, value }); if (error) return toast(friendlyError(error), 'err'); }
    toast('Paramètres enregistrés.');
  };
  if (ctx.role === 'SUPER_ADMIN') team(el.querySelector('#team'));
}
async function team(box) {
  const [{ data: roles }, { data: profs }] = await Promise.all([sb.from('admin_roles').select('*'), sb.from('profiles').select('id, email, first_name, last_name')]);
  const P = new Map((profs || []).map((p) => [p.id, p]));
  box.innerHTML = `<div class="panel-box" style="max-width:640px"><h2>Équipe et rôles</h2>${table(['Utilisateur', 'Rôle', ''], (roles || []).map((r) => `<tr><td>${esc(P.get(r.user_id)?.email || r.user_id)}</td><td><select data-role="${r.user_id}" ${r.user_id === ctx.user.id ? 'disabled' : ''}>${ROLES.map((x) => `<option ${x === r.role ? 'selected' : ''}>${x}</option>`).join('')}</select></td><td>${r.user_id === ctx.user.id ? '' : `<button class="btn danger sm" data-rm="${r.user_id}">Retirer</button>`}</td></tr>`))}
  <h3 style="margin-top:16px">Ajouter un membre</h3><p class="muted">La personne doit d’abord avoir créé un compte sur le site.</p><form id="tf" class="row"><input id="te" type="email" placeholder="Email du compte" required aria-label="Email" style="flex:2"><select id="tr" aria-label="Rôle" style="flex:1">${ROLES.filter((r) => r !== 'SUPER_ADMIN').map((x) => `<option>${x}</option>`).join('')}</select><button class="btn primary">Ajouter</button></form></div>`;
  box.querySelectorAll('[data-role]').forEach((s) => (s.onchange = async () => { const { error } = await sb.from('admin_roles').update({ role: s.value }).eq('user_id', s.dataset.role); toast(error ? friendlyError(error) : 'Rôle mis à jour.', error ? 'err' : 'ok'); }));
  box.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = async () => { const { error } = await sb.from('admin_roles').delete().eq('user_id', b.dataset.rm); toast(error ? friendlyError(error) : 'Membre retiré.', error ? 'err' : 'ok'); team(box); }));
  box.querySelector('#tf').onsubmit = async (e) => { e.preventDefault(); const email = box.querySelector('#te').value.trim().toLowerCase(); if (!isEmail(email)) return toast('Email invalide.', 'err'); const { data: p } = await sb.from('profiles').select('id').ilike('email', email).maybeSingle(); if (!p) return toast('Aucun compte trouvé avec cet email.', 'err'); const { error } = await sb.from('admin_roles').upsert({ user_id: p.id, role: box.querySelector('#tr').value }); toast(error ? friendlyError(error) : 'Membre ajouté.', error ? 'err' : 'ok'); team(box); };
}
