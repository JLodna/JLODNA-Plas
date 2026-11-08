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
  } catch (e) { root.innerHTML = errorState('Erreur : ' + (e?.message || e)); }
  )();

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
  const drawOptions = () => {
    if (!multi) { $('#variants').innerHTML = ''; return; }
    $('#variants').innerHTML = groups.map((g, gi) => `<fieldset style="border:0;padding:0;margin:0 0 12px"><legend style="font-weight:600;margin-bottom:6px">${esc(g.name)}</legend><div class="opt">${g.options.map((o) => {
      const ok = optionAvailable(variants, g.name, o, sel);
      return `<label><input type="radio" name="g${gi}" value="${esc(o)}" data-g="${esc(g.name)}" ${sel[g.name] === o ? 'checked' : ''}><span class="${ok ? '' : 'na'}">${esc(o)}${ok ? '' : ' (épuisé)'}</span></label>`;
    }).join('')}</div></fieldset>`).join('');
    root.querySelectorAll('#variants input').forEach((i) => (i.onchange = () => { sel[i.dataset.g] = i.value; refresh(); }));
  };
  const refresh = () => {
    drawOptions();
    const v = current(); const stock = availableOf(v);
    if (!v) {
      $('#price').innerHTML = `<strong>${fmtPrice(priceRange(p).min)}</strong>`;
      $('#stock').className = 'stock out'; $('#stock').textContent = 'Cette combinaison n’est pas disponible.'; $('#sku').textContent = '';
    } else {
      const eff = effectivePrice(p, v); const base = basePrice(p, v);
      $('#price').innerHTML = `${eff < base ? `<s>${fmtPrice(base)}</s>` : ''}<strong>${fmtPrice(eff)}</strong>`;
      $('#stock').className = `stock ${stock > 0 ? 'in' : 'out'}`;
      $('#stock').textContent = stock > 0 ? (stock <= 5 ? `Plus que ${stock} en stock` : 'En stock') : 'Rupture de stock';
      $('#sku').textContent = (v.sku || p.sku) ? `SKU : ${v.sku || p.sku}` : '';
    }
    $('#add').disabled = $('#buy').disabled = stock <= 0;
    $('#add').textContent = stock <= 0 ? 'Rupture de stock' : 'Ajouter au panier';
    clamp();
  };
  refresh();
  $('#q-').onclick = () => { q.value = +q.value - 1; clamp(); }; $('#q+').onclick = () => { q.value = +q.value + 1; clamp(); }; q.onchange = clamp;
  root.querySelectorAll('.thumbs button').forEach((b) => (b.onclick = () => { const i = imgs[+b.dataset.i]; $('#main-img').src = i.url; root.querySelectorAll('.thumbs button').forEach((x) => x.removeAttribute('aria-current')); b.setAttribute('aria-current', 'true'); }));
  const add = (go) => { const v = current(); if (!v || availableOf(v) <= 0) return; addItem(v.id, p.id, +q.value, availableOf(v)); if (go) location.href = '/checkout'; };
  $('#add').onclick = () => add(false); $('#buy').onclick = () => add(true);

  // Temps réel : stock / prix / statut des variantes à jour sans recharger la page.
  subscribe(`variants-${p.id}`, { event: '*', table: 'product_variants', filter: `product_id=eq.${p.id}` }, async () => {
    const { data } = await sb.from('product_variants').select('*').eq('product_id', p.id).eq('status', 'active').order('sort_order');
    if (data) { variants = data; p.product_variants = data; refresh(); }
  });
}

async function reviews(p) {
  $('#reviews-sec').hidden = false;
  const { data } = await sb.from('reviews').select('author_name, rating, comment, created_at').eq('product_id', p.id).eq('status', 'approved').order('created_at', { ascending: false }).limit(30);
  const avg = data?.length ? data.reduce((s, r) => s + r.rating, 0) / data.length : 0;
  $('#reviews').innerHTML = data?.length ? `<p><span class="stars">${'★'.repeat(Math.round(avg))}${'☆'.repeat(5 - Math.round(avg))}</span> ${avg.toFixed(1)} / 5 (${data.length} avis)</p>` + data.map((r) => `<div class="review"><span class="stars">${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</span> <strong>${esc(r.author_name)}</strong> <time class="muted">${fmtDate(r.created_at)}</time><p>${esc(r.comment || '')}</p></div>`).join('') : '<p class="muted">Aucun avis pour le moment.</p>';
  const u = await getUser();
  $('#review-form').innerHTML = u ? `<form id="rf" style="max-width:520px;margin-top:12px"><h3>Donner votre avis</h3><p class="muted">Votre avis sera publié après vérification.</p><div class="field"><label for="rt">Note</label><select id="rt"><option>5</option><option>4</option><option>3</option><option>2</option><option>1</option></select></div><div class="field"><label for="rc">Commentaire</label><textarea id="rc" maxlength="1000"></textarea></div><button class="btn primary" id="rb">Envoyer mon avis</button></form>` : '<p><a href="/login?next=' + encodeURIComponent(location.pathname + location.search) + '">Connectez-vous</a> pour donner votre avis.</p>';
  $('#rf')?.addEventListener('submit', async (e) => {
    e.preventDefault(); const b = $('#rb'); setLoading(b, true);
    const { data: prof } = await sb.from('profiles').select('first_name').eq('id', u.id).maybeSingle();
    const { error } = await sb.from('reviews').insert({ product_id: p.id, user_id: u.id, author_name: prof?.first_name || 'Client', rating: +$('#rt').value, comment: $('#rc').value.trim() || null });
    setLoading(b, false);
    if (error) toast(String(error.message).includes('duplicate') ? 'Vous avez déjà donné votre avis sur ce produit.' : friendlyError(error), 'err');
    else { toast('Merci ! Votre avis sera publié après modération.'); $('#review-form').innerHTML = '<p class="muted">Merci ! Votre avis sera publié après modération.</p>'; }
  });
}
async function similar(p) {
  if (!p.category_id) return;
  const { items } = await listProducts({ category: p.category_id, exclude: p.id, limit: 4 }).catch(() => ({ items: [] }));
  if (!items.length) return; $('#similar-sec').hidden = false; $('#similar').innerHTML = items.map(productCard).join(''); bindAddButtons($('#similar'));
}
function seo(p) {
  const s = document.createElement('script'); s.type = 'application/ld+json';
  const url = `${SITE_URL}/product?slug=${encodeURIComponent(p.slug)}`; const r = priceRange(p); const inStock = totalAvailable(p) > 0;
  const availability = inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock';
  const offers = r.min !== r.max
    ? { '@type': 'AggregateOffer', priceCurrency: 'HTG', lowPrice: r.min, highPrice: r.max, offerCount: activeVariants(p).length, availability, url }
    : { '@type': 'Offer', url, priceCurrency: 'HTG', price: r.min, availability };
  s.textContent = JSON.stringify([
    { '@context': 'https://schema.org', '@type': 'Product', name: p.name, description: (p.description || '').slice(0, 300), sku: p.sku || undefined, image: [imgOf(p)], offers },
    { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Accueil', item: SITE_URL + '/' }, { '@type': 'ListItem', position: 2, name: 'Boutique', item: SITE_URL + '/shop' }, { '@type': 'ListItem', position: 3, name: p.name, item: url }] },
  ]);
  document.head.append(s);
  const d = document.querySelector('meta[name=description]'); if (d) d.content = `${p.name} — ${(p.description || 'Disponible chez JLODNA Plas').slice(0, 140)}`;
  const c = document.querySelector('link[rel=canonical]'); if (c) c.href = url;
}
