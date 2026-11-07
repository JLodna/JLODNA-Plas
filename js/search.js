import { sb } from './supabase.js';
import { esc, debounce, fmtPrice } from './utils.js';
import { imgOf, priceOf } from './products.js';

// Recherche instantanée : nom, SKU, catégorie.
export function initSearch() {
  const input = document.getElementById('search-input'); const box = document.getElementById('search-results'); if (!input || !sb) return;
  const run = debounce(async () => {
    const q = input.value.replace(/[%,()]/g, ' ').trim();
    if (q.length < 2) { box.hidden = true; return; }
    const { data: vm } = await sb.from('product_variants').select('product_id').ilike('sku', `%${q}%`).limit(10);
    const vids = [...new Set((vm || []).map((r) => r.product_id))];
    const [{ data: prods }, { data: cats }] = await Promise.all([
      sb.from('products').select('name, slug, price, sale_price, sku, product_images(url, sort_order), product_variants(price, sale_price, status, sort_order, available_quantity)').eq('status', 'published').or(`name.ilike.%${q}%,sku.ilike.%${q}%${vids.length ? `,id.in.(${vids.join(',')})` : ''}`).limit(6),
      sb.from('categories').select('id, name').eq('is_active', true).ilike('name', `%${q}%`).limit(3),
    ]);
    const catHtml = (cats || []).map((c) => `<a class="sr-cat" href="/shop?category=${c.id}">Catégorie : ${esc(c.name)}</a>`).join('');
    const prodHtml = (prods || []).map((p) => `<a class="sr-item" href="/product?slug=${encodeURIComponent(p.slug)}"><img src="${imgOf(p)}" alt="" width="40" height="40" loading="lazy"><span>${esc(p.name)}</span><b>${fmtPrice(priceOf(p))}</b></a>`).join('');
    box.innerHTML = catHtml + prodHtml || '<p class="muted pad">Aucun résultat.</p>'; box.hidden = false;
  }, 220);
  input.addEventListener('input', run);
  input.closest('form')?.addEventListener('submit', (e) => { e.preventDefault(); const q = input.value.trim(); location.href = q ? `/shop?q=${encodeURIComponent(q)}` : '/shop'; });
  document.addEventListener('click', (e) => { if (!box.contains(e.target) && e.target !== input) box.hidden = true; });
}
