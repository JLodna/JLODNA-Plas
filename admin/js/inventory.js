import { sb } from '/js/supabase.js';
import { $, $$, esc, fmtDate, toast, friendlyError } from '/js/utils.js';
import { table } from './ui.js';
const TYPE = { initial: 'Stock initial', adjust: 'Ajustement', reserve: 'Réservation', release: 'Libération', sale: 'Vente (livraison)', restock: 'Réapprovisionnement' };
export async function render(el) {
  const [{ data: vs, error }, { data: mov }] = await Promise.all([
    sb.from('product_variants').select('*, products(name, status)').order('available_quantity'),
    sb.from('inventory_movements').select('type, stock_delta, reserved_delta, stock_after, reserved_after, reason, created_at, products(name), product_variants(name)').order('created_at', { ascending: false }).limit(40)]);
  if (error) throw error;
  const label = (v) => `${v.products.name}${v.name !== 'Standard' ? ` — ${v.name}` : ''}`;
  const live = vs.filter((v) => v.status === 'active' && v.products.status === 'published');
  const out = live.filter((v) => v.available_quantity === 0); const low = live.filter((v) => v.available_quantity > 0 && v.available_quantity <= v.low_stock_threshold);
  el.innerHTML = `<h1>Stock</h1><p class="muted">Disponible = stock physique − réservé par les commandes en cours. Le stock sort à la livraison.</p>
  ${out.length || low.length ? `<div class="panel-box" role="alert">${out.map((v) => `<p style="margin:.2em 0"><strong>Rupture :</strong> ${esc(label(v))}</p>`).join('')}${low.map((v) => `<p style="margin:.2em 0">Attention : le produit <strong>${esc(label(v))}</strong> possède seulement ${v.available_quantity} unité(s) disponible(s).</p>`).join('')}</div>` : '<p class="muted">Aucune alerte de stock.</p>'}
  ${table(['Produit / variante', 'SKU', 'Stock', 'Réservé', 'Disponible', 'Alerte à', 'Ajuster le stock'], vs.map((v) => `<tr><td class="wrap-t">${esc(label(v))}${v.status === 'disabled' ? ' <span class="muted">(désactivée)</span>' : ''}</td><td>${esc(v.sku || '—')}</td><td>${v.stock_quantity}</td><td>${v.reserved_quantity}</td><td><strong>${v.available_quantity}</strong></td><td>${v.low_stock_threshold}</td><td><div class="row"><input type="number" min="${v.reserved_quantity}" value="${v.stock_quantity}" style="width:90px" data-q="${v.id}" aria-label="Nouveau stock physique"><button class="btn ghost sm" data-s="${v.id}">Mettre à jour</button></div></td></tr>`))}
  <h2 style="margin-top:24px">Derniers mouvements</h2>${table(['Date', 'Produit', 'Type', 'Stock', 'Réservé', 'Après (stock / réservé)', 'Motif'], (mov || []).map((m) => `<tr><td>${fmtDate(m.created_at)}</td><td class="wrap-t">${esc(m.products?.name || '—')}${m.product_variants && m.product_variants.name !== 'Standard' ? ` — ${esc(m.product_variants.name)}` : ''}</td><td>${TYPE[m.type] || esc(m.type)}</td><td>${m.stock_delta > 0 ? '+' : ''}${m.stock_delta}</td><td>${m.reserved_delta > 0 ? '+' : ''}${m.reserved_delta}</td><td>${m.stock_after} / ${m.reserved_after}</td><td class="wrap-t">${esc(m.reason)}</td></tr>`))}`;
  $$('[data-s]').forEach((b) => (b.onclick = async () => { const q = parseInt($(`[data-q="${b.dataset.s}"]`).value, 10); if (!(q >= 0)) return toast('Quantité invalide.', 'err'); const { error } = await sb.rpc('admin_set_variant_stock', { p_variant_id: b.dataset.s, p_quantity: q, p_reason: 'Ajustement manuel' }); toast(error ? friendlyError(error) : 'Stock mis à jour.', error ? 'err' : 'ok'); render(el); }));
}
