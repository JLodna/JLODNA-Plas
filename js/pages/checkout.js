import { initLayout } from '../layout.js';
import { sb } from '../supabase.js';
import { requireUser, getSession } from '../auth.js';
import { getCart, clearCart } from '../cart.js';
import { getCartLines } from '../products.js';
import { isDefaultVariant } from '../variants.js';
import { $, esc, fmtPrice, fmtDate, isEmail, setLoading, friendlyError, postJSON, STATUS } from '../utils.js';
import { ONLINE, startPayment } from '../pay.js';

initLayout();
let user; let totals = { subtotal: 0, fee: 0, discount: 0, total: 0 };
const coupon = sessionStorage.getItem('jl_coupon') || null;

(async () => {
  if (!sb) return;
  user = await requireUser(); if (!user) return;
  const cart = getCart();
  if (!cart.length) { $('#co-root').innerHTML = '<div class="empty"><span class="dot"></span><p>Votre panier est vide.</p><a class="btn primary" href="/shop">Continuer les achats</a></div>'; return; }
  const [L, ship, pm, prof, addr] = await Promise.all([
    getCartLines(cart),
    sb.from('settings').select('value').eq('key', 'shipping').maybeSingle(),
    sb.from('settings').select('value').eq('key', 'payment_methods').maybeSingle(),
    sb.from('profiles').select('*').eq('id', user.id).maybeSingle(),
    sb.from('addresses').select('*').eq('is_default', true).maybeSingle(),
  ]);
  let subtotal = 0; let lines = ''; let blocked = false;
  for (const l of L) {
    const nm = l.ok ? `${esc(l.p.name)}${isDefaultVariant(l.v) ? '' : ` (${esc(l.v.name)})`}` : 'Produit';
    if (!l.ok || l.available < l.item.quantity) { blocked = true; lines += `<div class="line"><span>${nm} × ${l.item.quantity}</span><span class="stock out">Indisponible</span></div>`; continue; }
    subtotal += l.price * l.item.quantity; lines += `<div class="line"><span>${nm} × ${l.item.quantity}</span><span>${fmtPrice(l.price * l.item.quantity)}</span></div>`;
  }
  const sv = ship.data?.value || { flat_fee: 0 }; const fee = sv.free_over && subtotal >= sv.free_over ? 0 : sv.flat_fee || 0;
  let discount = 0; if (coupon) { const { data } = await sb.rpc('validate_coupon', { p_code: coupon, p_subtotal: subtotal }); if (data?.valid) discount = data.discount; }
  totals = { subtotal, fee, discount, total: Math.max(subtotal + fee - discount, 0) };
  $('#co-sum').innerHTML = `<h2 style="font-size:1.2rem">Résumé</h2>${lines}<div class="line"><span>Sous-total</span><span>${fmtPrice(subtotal)}</span></div><div class="line"><span>Livraison</span><span>${fee ? fmtPrice(fee) : 'Offerte'}</span></div>${discount ? `<div class="line"><span>Réduction</span><span>− ${fmtPrice(discount)}</span></div>` : ''}<div class="line total"><span>Total</span><span>${fmtPrice(totals.total)}</span></div>`;
  const methods = Object.entries(pm.data?.value || {}).filter(([, v]) => v.enabled);
  $('#pay').innerHTML = methods.length ? methods.map(([k, v], i) => `<label style="display:flex;gap:10px;align-items:center;font-weight:400"><input type="radio" name="pay" value="${esc(k)}" style="width:auto;min-height:0" ${i === 0 ? 'checked' : ''}> ${esc(v.label)}</label>`).join('') : '<p class="err-msg">Aucun mode de paiement disponible.</p>';
  const f = $('#co-form');
  f.full_name.value = addr.data?.full_name || [prof.data?.first_name, prof.data?.last_name].filter(Boolean).join(' ');
  f.phone.value = addr.data?.phone || prof.data?.phone || ''; f.email.value = user.email || '';
  if (addr.data) { f.address.value = addr.data.address; f.city.value = addr.data.city; f.department.value = addr.data.department; }
  if (blocked) { $('#co-err').textContent = 'Certains produits ne sont plus disponibles. Modifiez votre panier.'; $('#co-btn').disabled = true; }

  f.addEventListener('submit', async (e) => {
    e.preventDefault(); const err = $('#co-err'); err.textContent = '';
    const d = Object.fromEntries(new FormData(f)); const method = d.pay; delete d.pay;
    if (d.full_name.trim().length < 2 || d.phone.trim().length < 6 || d.address.trim().length < 3 || d.city.trim().length < 2 || !d.department || !isEmail(d.email)) { err.textContent = 'Veuillez remplir correctement tous les champs obligatoires.'; return; }
    if (!method) { err.textContent = 'Choisissez un mode de paiement.'; return; }
    const btn = $('#co-btn'); setLoading(btn, true, 'Envoi de la commande…');
    const items = getCart().map((i) => ({ variant_id: i.variant_id, quantity: i.quantity }));
    const { data, error } = await sb.rpc('create_order', { p_items: items, p_shipping: d, p_coupon: coupon, p_payment_method: method });
    setLoading(btn, false);
    if (error) { err.textContent = friendlyError(error); return; }
    clearCart(); sessionStorage.removeItem('jl_coupon');
    const s = await getSession(); postJSON('/api/notify', { event: 'order_created', order_id: data.id }, s?.access_token).catch(() => {});
    const { data: o } = await sb.from('orders').select('*, order_items(name, variant_name, variant, quantity, unit_price)').eq('id', data.id).maybeSingle();
    $('#co-root').innerHTML = `<div class="form-card" style="max-width:560px"><h2>Votre commande a été enregistrée.</h2>
      <p><strong>Numéro : ${esc(o.order_number)}</strong></p><p>Date : ${fmtDate(o.created_at)}<br>Statut : <span class="status new">${STATUS[o.status]}</span><br>Paiement : ${esc(methods.find(([k]) => k === o.payment_method)?.[1].label || o.payment_method)}</p>
      <div class="summary">${o.order_items.map((i) => `<div class="line"><span>${esc(i.name)}${i.variant && Object.keys(i.variant).length ? ` (${esc(i.variant_name)})` : ''} × ${i.quantity}</span><span>${fmtPrice(i.unit_price * i.quantity)}</span></div>`).join('')}<div class="line"><span>Livraison</span><span>${o.shipping_fee ? fmtPrice(o.shipping_fee) : 'Offerte'}</span></div>${o.discount > 0 ? `<div class="line"><span>Réduction</span><span>− ${fmtPrice(o.discount)}</span></div>` : ''}<div class="line total"><span>Montant</span><span>${fmtPrice(o.total)}</span></div></div>
      <div id="pay-box"></div><p style="margin-top:16px" class="row"><a class="btn primary" href="/orders">Suivre mes commandes</a><a class="btn ghost" href="/shop">Continuer les achats</a></p></div>`;
    window.scrollTo(0, 0);
    const meta = methods.find(([k]) => k === method)?.[1] || {};
    const box = $('#pay-box');
    if (ONLINE.includes(method)) {
      box.innerHTML = '<p class="muted" id="pay-msg">Paiement sécurisé : redirection en cours…</p><button class="btn primary" id="pay-now" type="button">Payer maintenant</button>';
      const go = async () => { const b = $('#pay-now'); setLoading(b, true, 'Redirection…'); try { await startPayment(data.id); } catch (ex) { setLoading(b, false); $('#pay-msg').textContent = ex.message; } };
      $('#pay-now').onclick = go; setTimeout(go, 400);
    } else if (meta.instructions) { box.innerHTML = `<div class="order-card"><strong>Instructions de paiement</strong><p style="white-space:pre-wrap">${esc(meta.instructions)}</p><p class="muted">Indiquez le numéro de commande ${esc(o.order_number)}. Votre commande sera confirmée dès réception du paiement.</p></div>`; }
  });
})();
