import { initLayout } from '../layout.js';
import { sb } from '../supabase.js';
import { getCart, setQty, removeItem } from '../cart.js';
import { getCartLines } from '../products.js';
import { variantLabel, isDefaultVariant } from '../variants.js';
import { $, esc, fmtPrice, emptyState, errorState, toast } from '../utils.js';

initLayout();
let shipping = { flat_fee: 0, free_over: null }; let coupon = null;
const sum = $('#sum'); const lines = $('#lines');
const EMPTY = () => emptyState('Votre panier est vide.', '<a class="btn primary" href="/shop">Continuer les achats</a>');

async function render() {
  const cart = getCart();
  if (!cart.length) { lines.innerHTML = EMPTY(); sum.hidden = true; return; }
  sum.hidden = false;
  let L; try { L = await getCartLines(cart); } catch { lines.innerHTML = errorState(); return; }
  let subtotal = 0; let blocked = false; let html = '';
  for (const l of L) {
    const { item, v, p } = l; const vid = item.variant_id;
    if (l.ok && l.available > 0 && item.quantity > l.available) setQty(vid, l.available); // plafonne au stock disponible
    const short = l.ok && l.available > 0 && item.quantity > l.available;
    const unavailable = !l.ok || l.available <= 0;
    if (unavailable) blocked = true; else subtotal += l.price * l.qty;
    const label = l.ok && !isDefaultVariant(v) ? `<br><span class="muted">${esc(Object.entries(v.attributes).map(([k, x]) => `${k} : ${x}`).join(', '))}</span>` : '';
    html += `<div class="cart-line"><img src="${l.image}" alt="" loading="lazy" width="90" height="90"><div>${l.ok ? `<a href="/product?slug=${encodeURIComponent(p.slug)}"><strong>${esc(p.name)}</strong></a>` : '<strong>Produit retiré de la boutique</strong>'}${label}<br>${l.ok ? fmtPrice(l.price) : ''}${unavailable ? '<br><span class="stock out">Produit actuellement indisponible</span>' : short ? `<br><span class="stock out">Quantité ajustée au stock disponible : ${l.available}</span>` : ''}</div>
      <div class="ctl"><div class="qty"><button aria-label="Moins" data-act="dec" data-id="${esc(vid)}" ${unavailable ? 'disabled' : ''}>−</button><input aria-label="Quantité" value="${l.qty}" readonly><button aria-label="Plus" data-act="inc" data-id="${esc(vid)}" ${unavailable || l.qty >= l.available ? 'disabled' : ''}>+</button></div><button class="link" data-act="rm" data-id="${esc(vid)}">Supprimer</button></div></div>`;
  }
  lines.innerHTML = html;
  lines.querySelectorAll('[data-act]').forEach((b) => (b.onclick = () => {
    const cur = getCart().find((i) => i.variant_id === b.dataset.id); if (!cur) return;
    if (b.dataset.act === 'rm') removeItem(cur.variant_id); else setQty(cur.variant_id, cur.quantity + (b.dataset.act === 'inc' ? 1 : -1));
    render();
  }));
  const fee = shipping.free_over && subtotal >= shipping.free_over ? 0 : shipping.flat_fee;
  let discount = 0;
  if (coupon && sb && subtotal > 0) { const { data } = await sb.rpc('validate_coupon', { p_code: coupon, p_subtotal: subtotal }); if (data?.valid) discount = data.discount; else { coupon = null; toast(data?.message || 'Code promo invalide ou expiré.', 'err'); } }
  sessionStorage.setItem('jl_coupon', coupon || '');
  const total = Math.max(subtotal + fee - discount, 0);
  const cant = blocked || subtotal <= 0;
  sum.innerHTML = `<h2 style="font-size:1.2rem">Résumé</h2>
    <div class="line"><span>Sous-total</span><span>${fmtPrice(subtotal)}</span></div>
    <div class="line"><span>Livraison</span><span>${fee ? fmtPrice(fee) : 'Offerte'}</span></div>
    ${discount ? `<div class="line"><span>Code ${esc(coupon)}</span><span>− ${fmtPrice(discount)}</span></div>` : ''}
    <div class="line total"><span>Total</span><span>${fmtPrice(total)}</span></div>
    ${blocked ? '<p class="err-msg">Retirez les produits indisponibles pour continuer.</p>' : ''}
    <form id="cp" class="row" style="margin-top:6px"><input id="cp-code" placeholder="Code promo" aria-label="Code promo" style="flex:1" value="${esc(coupon || '')}"><button class="btn ghost sm">Appliquer</button></form>
    <a class="btn primary block" ${cant ? 'aria-disabled="true" style="pointer-events:none;opacity:.5"' : ''} href="/checkout">Passer commande</a>
    <a class="btn ghost block" href="/shop">Continuer les achats</a>`;
  $('#cp').onsubmit = (e) => { e.preventDefault(); coupon = $('#cp-code').value.trim() || null; render(); };
}
(async () => {
  if (sb) { const { data } = await sb.from('settings').select('value').eq('key', 'shipping').maybeSingle(); if (data) shipping = data.value; }
  coupon = sessionStorage.getItem('jl_coupon') || null; render();
})();
