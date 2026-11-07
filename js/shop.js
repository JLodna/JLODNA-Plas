import { initLayout } from '../layout.js';
import { sb } from '../supabase.js';
import { listProducts, listCategories, productCard, bindAddButtons, PAGE_SIZE } from '../products.js';
import { $, esc, param, skeletonCards, emptyState, errorState, debounce } from '../utils.js';
import { subscribe } from '../realtime.js';

initLayout();
const S = { q: param('q') || '', category: param('category') || '', sort: param('sort') || 'new', min: '', max: '', page: 0, onSale: param('sale') === '1' };
let cats = [];
const grid = $('#grid');

async function load(reset = true) {
  if (reset) { S.page = 0; grid.innerHTML = skeletonCards(8); }
  try {
    const { items, count } = await listProducts(S);
    const html = items.map(productCard).join('');
    if (reset) grid.innerHTML = html || emptyState(S.category ? 'Il n’y a aucun produit dans cette catégorie.' : 'Aucun produit ne correspond à votre recherche.'); else grid.insertAdjacentHTML('beforeend', html);
    bindAddButtons(grid);
    $('#shop-count').textContent = `${count} produit${count > 1 ? 's' : ''}`;
    $('#more').hidden = (S.page + 1) * PAGE_SIZE >= count;
    $('#shop-title').textContent = S.q ? `Résultats pour « ${S.q} »` : (cats.find((c) => c.id === S.category)?.name || 'Boutique');
  } catch { grid.innerHTML = errorState(); }
}
async function init() {
  if (!sb) return;
  cats = await listCategories().catch(() => []);
  $('#f-cat').insertAdjacentHTML('beforeend', cats.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join(''));
  $('#f-cat').value = S.category; $('#f-sort').value = S.sort;
  $('#f-cat').onchange = (e) => { S.category = e.target.value; load(); };
  $('#f-sort').onchange = (e) => { S.sort = e.target.value; load(); };
  const price = debounce(() => { S.min = $('#f-min').value; S.max = $('#f-max').value; load(); }, 400);
  $('#f-min').oninput = price; $('#f-max').oninput = price;
  $('#more').onclick = () => { S.page++; load(false); };
  await load();
  // Temps réel : un produit ajouté/modifié dans l'admin apparaît sans recharger.
  subscribe('shop-products', { event: '*', table: 'products' }, debounce(() => load(), 800));
}
init();
