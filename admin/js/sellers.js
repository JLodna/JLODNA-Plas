import { sb } from '/js/supabase.js';
import { $, $$, esc, fmtDate, fmtPrice, toast, friendlyError } from '/js/utils.js';
import { table, modal } from './ui.js';

const ST = { pending: 'En attente', approved: 'Approuvé', suspended: 'Suspendu', rejected: 'Refusé' };
let filter = '';

export async function render(el) {
  let q = sb.from('sellers').select('*').order('created_at', { ascending: false }).limit(300); if (filter) q = q.eq('status', filter);
  const { data, error } = await q; if (error) throw error;
  el.innerHTML = `<h1>Vendeurs</h1><p class="muted">Approuvez les candidatures, fixez la commission, validez les produits soumis (section Produits) et enregistrez les reversements.</p>
  <select id="f" aria-label="Filtrer"><option value="">Tous les statuts</option>${Object.entries(ST).map(([k, v]) => `<option value="${k}" ${filter === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
  ${table(['Boutique', 'Contact', 'Statut', 'Commission', 'Candidature', ''], data.map((s) => `<tr style="${s.status === 'pending' ? 'font-weight:700' : ''}"><td>${esc(s.shop_name)}<br><span class="muted">${esc(s.slug)}</span></td><td>${esc(s.phone)}${s.city ? '<br>' + esc(s.city) : ''}</td><td>${ST[s.status]}</td><td>${esc(s.commission_percent)} %</td><td>${fmtDate(s.created_at)}</td><td><button class="btn sm" data-o="${esc(s.id)}">Ouvrir</button></td></tr>`))}`;
  $('#f', el).onchange = (e) => { filter = e.target.value; render(el); };
  $$('[data-o]', el).forEach((b) => (b.onclick = () => open(data.find((x) => x.id === b.dataset.o), el)));
}

async function open(s, el) {
  const m = modal('<div class="sk-line"></div>'); const box = m.firstElementChild;
  const [sum, pay, prods] = await Promise.all([sb.rpc('admin_seller_summary', { p_id: s.id }), sb.from('seller_payouts').select('*').eq('seller_id', s.id).order('paid_at', { ascending: false }),
    sb.from('products').select('id,name,status,submitted_at').eq('seller_id', s.id).order('created_at', { ascending: false }).limit(50)]);
  const u = sum.data || {};
  box.innerHTML = `<h2 style="margin-top:0">${esc(s.shop_name)}</h2><p class="muted">${esc(s.description || '')}<br>${esc(s.phone)}${s.city ? ' · ' + esc(s.city) : ''}</p>
  <div class="field"><label for="st">Statut</label><select id="st">${Object.entries(ST).map(([k, v]) => `<option value="${k}" ${s.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
  <div class="field"><label for="cm">Commission (%)</label><input id="cm" type="number" min="0" max="100" step="0.01" value="${esc(s.commission_percent)}"></div>
  <button class="btn primary" id="sv">Enregistrer</button> <span class="muted">Suspendre ou refuser retire immédiatement les produits de la vente.</span>
  <h3>Finances</h3><p>Brut livré et payé : <strong>${fmtPrice(u.gross)}</strong> · Commission : ${fmtPrice(u.commission)} · Net : ${fmtPrice(u.net)}<br>Déjà reversé : ${fmtPrice(u.paid_out)} · <strong>Solde dû : ${fmtPrice(u.balance)}</strong> · En cours : ${fmtPrice(u.pending_gross)}</p>
  <div class="two"><div class="field"><label for="pa">Montant du reversement</label><input id="pa" type="number" min="0" step="0.01"></div><div class="field"><label for="pm">Mode (MonCash, virement…)</label><input id="pm" maxlength="60"></div></div>
  <div class="field"><label for="pn">Note</label><input id="pn" maxlength="300"></div><button class="btn ghost" id="po">Enregistrer le reversement</button>
  ${(pay.data || []).length ? `<ul>${pay.data.map((x) => `<li>${fmtDate(x.paid_at)} — ${fmtPrice(x.amount)} ${esc(x.method || '')} ${esc(x.note || '')}</li>`).join('')}</ul>` : ''}
  <h3>Produits</h3>${(prods.data || []).length ? `<ul>${prods.data.map((p) => `<li>${esc(p.name)} — ${p.status === 'draft' && p.submitted_at ? '<strong>à valider</strong> (ouvrez Produits pour publier)' : esc(p.status)}</li>`).join('')}</ul>` : '<p class="muted">Aucun produit.</p>'}
  <button class="btn ghost" id="cl">Fermer</button>`;
  $('#cl', box).onclick = () => { m.remove(); render(el); };
  $('#sv', box).onclick = async () => { const { error } = await sb.rpc('admin_set_seller_status', { p_id: s.id, p_status: $('#st', box).value, p_commission: Number($('#cm', box).value) }); if (error) return toast(friendlyError(error), 'err'); toast('Vendeur mis à jour.'); m.remove(); render(el); };
  $('#po', box).onclick = async () => { const a = Number($('#pa', box).value); if (!(a > 0)) return toast('Montant invalide.', 'err'); const { error } = await sb.rpc('admin_record_payout', { p_seller_id: s.id, p_amount: a, p_method: $('#pm', box).value || null, p_note: $('#pn', box).value || null }); if (error) return toast(String(error.message).includes('EXCEEDS_BALANCE') ? 'Le montant dépasse le solde dû.' : friendlyError(error), 'err'); toast('Reversement enregistré.'); m.remove(); open(s, el); };
}
