import { initLayout } from '../layout.js';
import { sb } from '../supabase.js';
import { listProducts, listCategories, productCard, bindAddButtons } from '../products.js';
import { $, esc, safeUrl, skeletonCards, emptyState, errorState } from '../utils.js';

initLayout();
async function fill(sel, opts, empty) {
  const el = $(sel); el.innerHTML = skeletonCards(4);
  try { const { items } = await listProducts({ limit: 8, ...opts }); el.innerHTML = items.length ? items.map(productCard).join('') : emptyState(empty); bindAddButtons(el); if (!items.length && sel === '#sale') $('#sale-sec').hidden = true; }
  catch { el.innerHTML = errorState(); }
}
if (sb) {
  listCategories().then((c) => { $('#cats').innerHTML = c.length ? c.slice(0, 8).map((x) => `<a class="cat" href="/shop?category=${x.id}">${x.image_url && safeUrl(x.image_url) ? `<img src="${safeUrl(x.image_url)}" alt="" loading="lazy">` : ''}<span>${esc(x.name)}</span></a>`).join('') : emptyState('Les catégories arrivent bientôt.'); }).catch(() => ($('#cats').innerHTML = errorState()));
  fill('#popular', { sort: 'popular' }, 'Aucun produit pour le moment.');
  fill('#news', { sort: 'new' }, 'Aucun produit pour le moment.');
  fill('#sale', { onSale: true }, 'Aucune promotion en cours.');
  fill('#reco', { featured: true }, 'Aucune recommandation pour le moment.');
}
