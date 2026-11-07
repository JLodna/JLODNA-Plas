import { sb } from './supabase.js';
import { esc, fmtPrice, safeUrl } from './utils.js';
import { addItem } from './cart.js';
import { activeVariants, totalAvailable, priceRange, effectivePrice, availableOf } from './variants.js';

const SELECT = '*, product_images(url, alt, sort_order), product_variants(*), categories(name, slug)';
export const PAGE_SIZE = 12;

export const imgOf = (p) => safeUrl([...(p.product_images || [])].sort((a, b) => a.sort_order - b.sort_order)[0]?.url) || '/assets/icons/icon-192.png';
export const stockOf = (p) => totalAvailable(p);          // stock DISPONIBLE (physique - réservé), variantes actives
export const priceOf = (p) => priceRange(p).min;

export async function listProducts({ q, category, min, max, sort = 'new', page = 0, featured, onSale, limit = PAGE_SIZE, exclude } = {}) {
  let query = sb.from('products').select(SELECT, { count: 'exact' }).eq('status', 'published');
  if (category) query = query.eq('category_id', category);
  if (featured) query = query.eq('is_featured', true);
  if (onSale) query = query.eq('is_on_sale', true);
  if (exclude) query = query.neq('id', exclude);
  if (q) {
    const s = q.replace(/[%,()]/g, ' ').trim();
    const { data: vm } = await sb.from('product_variants').select('product_id').ilike('sku', `%${s}%`).limit(30); // SKU de variante
    const ids = [...new Set((vm || []).map((r) => r.product_id))];
    query = query.or(`name.ilike.%${s}%,sku.ilike.%${s}%${ids.length ? `,id.in.(${ids.join(',')})` : ''}`);
  }
  if (min != null && min !== '') query = query.gte('price', min);
  if (max != null && max !== '') query = query.lte('price', max);
  if (sort === 'price_asc') query = query.order('price', { ascending: true });
  else if (sort === 'price_desc') query = query.order('price', { ascending: false });
  else if (sort === 'popular') query = query.order('sold_count', { ascending: false });
  else query = query.order('created_at', { ascending: false });
  const from = page * limit; query = query.range(from, from + limit - 1);
  const { data, error, count } = await query; if (error) throw error;
  return { items: data || [], count: count || 0 };
}
export async function getProduct(slug) {
  const { data, error } = await sb.from('products').select(SELECT).eq('slug', slug).eq('status', 'published').maybeSingle();
  if (error) throw error; return data;
}
export async function listCategories() {
  const { data, error } = await sb.from('categories').select('*').eq('is_active', true).order('sort_order'); if (error) throw error; return data || [];
}

// Lignes du panier enrichies (variante + produit + prix + stock disponible). Les prix affichés sont indicatifs :
// le serveur (create_order) recalcule tout au moment de la commande.
export async function getCartLines(cart) {
  if (!cart.length) return [];
  const { data, error } = await sb.from('product_variants')
    .select('*, products(id, name, slug, status, price, sale_price, product_images(url, sort_order))')
    .in('id', cart.map((i) => i.variant_id));
  if (error) throw error;
  const map = new Map((data || []).map((v) => [v.id, v]));
  return cart.map((item) => {
    const v = map.get(item.variant_id); const p = v?.products || null;
    const ok = !!(v && v.status === 'active' && p && p.status === 'published');
    const available = ok ? availableOf(v) : 0;
    return { item, v, p, ok, available, price: ok ? effectivePrice(p, v) : 0, qty: ok ? Math.min(item.quantity, Math.max(available, 1)) : item.quantity, image: ok ? imgOf(p) : '/assets/icons/icon-192.png' };
  });
}

export function productCard(p) {
  const vs = activeVariants(p); const stock = stockOf(p); const r = priceRange(p);
  const href = `/product?slug=${encodeURIComponent(p.slug)}`;
  const simple = vs.length === 1;
  return `<article class="card product">
    <a class="pimg" href="${href}" aria-label="${esc(p.name)}">
      <img src="${imgOf(p)}" alt="${esc(p.name)}" loading="lazy" width="400" height="400">
      ${r.from != null ? '<span class="badge sale">Promo</span>' : ''}
    </a>
    <div class="pbody">
      <h3><a href="${href}">${esc(p.name)}</a></h3>
      <p class="price">${r.from != null ? `<s>${fmtPrice(r.from)}</s>` : ''}${r.min !== r.max ? '<small>À partir de </small>' : ''}<strong>${fmtPrice(r.min)}</strong></p>
      <p class="stock ${stock > 0 ? 'in' : 'out'}">${stock > 0 ? 'En stock' : 'Rupture de stock'}</p>
      <div class="row">
        ${stock > 0 && simple ? `<button class="btn primary" data-add="${vs[0].id}" data-pid="${p.id}" data-max="${availableOf(vs[0])}">Ajouter au panier</button>` : ''}
        <a class="btn ghost" href="${href}">${stock > 0 && !simple ? 'Choisir une option' : 'Voir détails'}</a>
      </div>
    </div></article>`;
}
export function bindAddButtons(root = document) {
  root.querySelectorAll('[data-add]').forEach((b) => { if (b.dataset.bound) return; b.dataset.bound = 1; b.addEventListener('click', () => addItem(b.dataset.add, b.dataset.pid, 1, +b.dataset.max || 99)); });
}
