import { sb } from '/js/supabase.js';
import { $, $$, esc, fmtPrice, fmtDate, STATUS, toast, friendlyError, debounce, postJSON } from '/js/utils.js';
import { getSession } from '/js/auth.js';
import { table, modal, confirmBox } from './ui.js';

const ORDER = ['new', 'confirmed', 'preparing', 'shipped', 'out_for_delivery', 'delivered'];
const PAY = { pending: 'En attente', paid: 'Payé', failed: 'Échec', refunded: 'Remboursé' };
export async function render(el) {
  el.innerHTML = `<h1>Commandes</h1><div class="toolbar"><input id="q" type="search" placeholder="Rechercher (numéro, client, téléphone)" aria-label="Rechercher"><select id="st" aria-label="Statut"><option value="">Tous les statuts</option>${Object.entries(STATUS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div><div id="t"></div>`;
  const load = async () => {
    const q = $('#q').value.replace(/[%,()]/g, ' ').trim(); let query = sb.from('orders').select('*, order_items(name, variant_name, quantity, unit_price, variant, sku)').order('created_at', { ascending: false }).limit(200);
    if ($('#st').value) query = query.eq('status', $('#st').value); if (q) query = query.or(`order_number.ilike.%${q}%,full_name.ilike.%${q}%,phone.ilike.%${q}%,email.ilike.%${q}%`);
    const { data, error } = await query; if (error) throw error;
    $('#t').innerHTML = table(['Numéro', 'Client', 'Date', 'Produits', 'Montant', 'Paiement', 'Statut', 'Actions'], data.map((o) => `<tr><td><strong>${esc(o.order_number)}</strong></td><td>${esc(o.full_name)}<br><span class="muted">${esc(o.phone)}</span></td><td>${fmtDate(o.created_at)}</td><td class="wrap-t">${o.order_items.map((i) => `${esc(i.name)}${i.variant && Object.keys(i.variant).length ? ` (${esc(i.variant_name)})` : ''} ×${i.quantity}`).join('<br>')}</td><td>${fmtPrice(o.total)}</td><td>${esc(o.payment_method)} · ${PAY[o.payment_status]}</td><td><span class="status ${o.status}">${STATUS[o.status]}</span></td>
      <td><button class="btn ghost sm" data-v="${o.id}">Voir</button> ${o.status === 'new' ? `<button class="btn primary sm" data-c="${o.id}">Confirmer</button>` : ''} ${['delivered', 'cancelled'].includes(o.status) ? '' : `<button class="btn danger sm" data-x="${o.id}">Annuler</button>`}</td></tr>`));
    const byId = (id) => data.find((o) => o.id === id);
    $$('[data-v]').forEach((b) => (b.onclick = () => view(byId(b.dataset.v), load)));
    $$('[data-c]').forEach((b) => (b.onclick = () => setStatus(b.dataset.c, 'confirmed', load)));
    $$('[data-x]').forEach((b) => (b.onclick = async () => { if (await confirmBox('Annuler cette commande ? Le stock réservé sera libéré.')) setStatus(b.dataset.x, 'cancelled', load); }));
  };
  $('#q').oninput = debounce(load, 300); $('#st').onchange = load; await load();
}
async function setStatus(id, status, reload) {
  const { error } = await sb.rpc('set_order_status', { p_order_id: id, p_status: status });
  if (error) { toast(friendlyError(error), 'err'); return; }
  toast('Statut mis à jour. Le client est notifié.'); const s = await getSession(); postJSON('/api/notify', { event: 'order_status', order_id: id }, s?.access_token).catch(() => {}); reload?.();
}
function view(o, reload) {
  const m = modal(`<h2>${esc(o.order_number)} <span class="status ${o.status}">${STATUS[o.status]}</span></h2>
  <p>${fmtDate(o.created_at)}<br><strong>${esc(o.full_name)}</strong> · ${esc(o.phone)} · ${esc(o.email)}<br>${esc(o.address)}, ${esc(o.city)}, ${esc(o.department)}${o.notes ? `<br><em>${esc(o.notes)}</em>` : ''}</p>
  ${table(['Produit', 'Qté', 'Prix'], o.order_items.map((i) => `<tr><td class="wrap-t">${esc(i.name)}${i.variant && Object.keys(i.variant).length ? ` (${esc(i.variant_name)})` : ''}${i.sku ? `<br><span class="muted">${esc(i.sku)}</span>` : ''}</td><td>${i.quantity}</td><td>${fmtPrice(i.unit_price * i.quantity)}</td></tr>`))}
  <p>Sous-total ${fmtPrice(o.subtotal)} · Livraison ${fmtPrice(o.shipping_fee)} · Réduction ${fmtPrice(o.discount)}<br><strong>Total ${fmtPrice(o.total)}</strong></p>
  <div class="two"><div class="field"><label for="ns">Changer le statut</label><select id="ns" ${['delivered','cancelled'].includes(o.status) ? 'disabled' : ''}>${Object.entries(STATUS).filter(([k]) => k === o.status || k === 'cancelled' || ORDER.indexOf(k) > ORDER.indexOf(o.status)).map(([k, v]) => `<option value="${k}" ${k === o.status ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
  <div class="field"><label for="ps">Paiement</label><select id="ps">${Object.entries(PAY).map(([k, v]) => `<option value="${k}" ${k === o.payment_status ? 'selected' : ''}>${v}</option>`).join('')}</select></div></div>
  <div class="row"><button class="btn primary" id="sv">Enregistrer</button><button class="btn ghost" id="pr">Imprimer</button><button class="btn ghost" id="cl">Fermer</button></div>`);
  m.querySelector('#cl').onclick = () => m.remove();
  m.querySelector('#sv').onclick = async () => {
    const st = m.querySelector('#ns').value; const ps = m.querySelector('#ps').value;
    if (ps !== o.payment_status) { const { error } = await sb.from('orders').update({ payment_status: ps }).eq('id', o.id); if (error) { toast(friendlyError(error), 'err'); return; } }
    if (st !== o.status) await setStatus(o.id, st); else toast('Commande enregistrée.'); m.remove(); reload();
  };
  m.querySelector('#pr').onclick = () => { const w = window.open('', '_blank'); if (!w) return; w.document.write(`<!doctype html><title>${esc(o.order_number)}</title><body style="font-family:sans-serif"><h1>JLODNA Plas — ${esc(o.order_number)}</h1><p>${fmtDate(o.created_at)}<br>${esc(o.full_name)} — ${esc(o.phone)}<br>${esc(o.address)}, ${esc(o.city)}, ${esc(o.department)}</p><ul>${o.order_items.map((i) => `<li>${esc(i.name)} × ${i.quantity} — ${fmtPrice(i.unit_price * i.quantity)}</li>`).join('')}</ul><p>Livraison : ${fmtPrice(o.shipping_fee)}<br><strong>Total : ${fmtPrice(o.total)}</strong><br>Paiement : ${esc(o.payment_method)}</p>`); w.document.close(); w.focus(); setTimeout(() => w.print(), 300); };
}
