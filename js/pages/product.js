import { initLayout } from '../layout.js';
import { reportButton } from '../report.js';
import { sb, SITE_URL } from '../supabase.js';
import { getProduct, listProducts, productCard, bindAddButtons, imgOf } from '../products.js';
import { addItem } from '../cart.js';
import { getUser } from '../auth.js';
import { activeVariants, optionGroups, findVariant, optionAvailable, effectivePrice, basePrice, availableOf, totalAvailable, priceRange, isDefaultVariant } from '../variants.js';
import { $, esc, fmtPrice, fmtDate, param, safeUrl, emptyState, errorState, toast, friendlyError, setLoading } from '../utils.js';
import { subscribe } from '../realtime.js';

initLayout();
const root = $('#pp');
(async () => {
  if (!sb) return;
  const slug = param('slug');
  try {
    const p = slug ? await getProduct(slug) : null;
    if (!p) { root.innerHTML = emptyState('Ce produit est introuvable.', '<a class="btn primary" href="/shop">Retour à la boutique</a>'); return; }
    render(p); reviews(p); similar(p); seo(p);
    { const h = document.createElement('p'); h.className = 'muted'; h.style.cssText = 'text-align:center;font-size:.85rem'; root.after(h); reportButton(h, { type: 'product', target: p.id }); }
  } catch { root.innerHTML = errorState(); }
})();

function render(p) {
  let variants = activeVariants(p);
  const groups = optionGroups(variants);
  const multi = variants.length > 1 || (variants[0] && !isDefaultVariant(variants[0]));
  const first = variants.find((v) => availableOf(v) > 0) || variants[0] || null;
  const sel = { ...(first?.attributes || {}) };
  const imgs = [...(p.product_images || [])].sort((a, b) => a.sort_order - b.sort_order).map((i) => ({ ...i, url: safeUrl(i.url) })).filter((i) => i.url);
  if (!imgs.length) imgs.push({ url: '/assets/icons/icon-512.png', alt: p.name });
  document.title = `${p.name} — JLODNA Plas`;
  $('#crumbs').innerHTML = `<a href="/">Accueil</a> / <a href="/shop">Boutique</a>${p.categories ? ` / <a href="/shop?category=${esc(p.category_id)}">${esc(p.categories.name)}</a>` : ''} / <span>${esc(p.name)}</span>`;
  root.innerHTML = `<div class="pp">
  <div class="gallery"><div class="main"><img id="main-img" src="${imgs[0].url}" alt="${esc(imgs[0].alt || p.name)}" width="700" height="700"></div>
    ${imgs.length > 1 ? `<div class="thumbs">${imgs.map((i, n) => `<button data-i="${n}" aria-label="Image ${n + 1}" ${n === 0 ? 'aria-current="true"' : ''}><img src="${i.url}" alt="" loading="lazy"></button>`).join('')}</div>` : ''}</div>
  <div><h1 style="font-size:1.8rem">${esc(p.name)}</h1>
    <p class="price" id="price"></p><p class="stock" id="stock" aria-live="polite"></p><p class="muted" id="sku"></p>
    <div id="variants"></div>
    <div class="field"><label for="qty">Quantité</label><div class="qty"><button type="button" id="q-" aria-label="Moins">−</button><input id="qty" type="number" value="1" min="1" max="99" inputmode="numeric"><button type="button" id="q+" aria-label="Plus">+</button></div></div>
    <div class="row"><button class="btn primary" id="add">Ajouter au panier</button><button class="btn dark" id="buy">Acheter maintenant</button></div>
    <div class="prose" style="padding-top:20px;white-space:pre-line">${esc(p.description || '')}</div></div></div>`;

  const q = $('#qty');
  const current = () => findVariant(variants, sel) || (!multi ? variants[0] : null);
  const clamp = () => { const v = current(); const max = Math.max(availableOf(v), 1); q.max = max; q.value = Math.max(1, Math.min(max, +q.value || 1)); };
