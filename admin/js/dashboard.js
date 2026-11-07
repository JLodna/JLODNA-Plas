import { sb } from '/js/supabase.js';
import { esc, fmtPrice, fmtDate, STATUS } from '/js/utils.js';
import { table } from './ui.js';
export async function render(el) {
  const [{ data: s, error }, { data: recent }] = await Promise.all([sb.rpc('admin_stats'), sb.from('orders').select('id, order_number, full_name, total, status, created_at').order('created_at', { ascending: false }).limit(8)]);
  if (error) throw error;
  const max = Math.max(1, ...s.by_day.map((d) => +d.revenue));
  el.innerHTML = `<h1>Tableau de bord</h1><div class="cards">
  <div class="stat"><b>${fmtPrice(s.revenue)}</b><span>Chiffre d’affaires</span></div><div class="stat"><b>${s.orders}</b><span>Commandes</span></div>
  <div class="stat"><b>${s.pending}</b><span>Commandes en attente</span></div><div class="stat"><b>${s.customers}</b><span>Clients</span></div>
  <div class="stat"><b>${s.products}</b><span>Produits</span></div><div class="stat ${s.out_of_stock ? 'warn' : ''}"><b>${s.out_of_stock}</b><span>En rupture</span></div>
  <div class="stat ${s.low_stock ? 'warn' : ''}"><b>${s.low_stock}</b><span>Stock faible</span></div>
  <div class="stat ${s.pending_reviews ? 'warn' : ''}"><b>${s.pending_reviews}</b><span>Avis à modérer</span></div>
  <div class="stat"><b>${Object.entries(s.by_status).map(([k, v]) => `${STATUS[k] || k} ${v}`).join(' · ') || '—'}</b><span>Par statut</span></div></div>
  <div class="panel-box"><strong>Ventes des 14 derniers jours</strong><div class="bars" role="img" aria-label="Graphique des ventes">${s.by_day.map((d) => `<div style="height:${Math.round((+d.revenue / max) * 100)}%" title="${esc(d.day)} : ${fmtPrice(d.revenue)} (${d.orders} commande(s))"><small>${esc(d.day.slice(8))}</small></div>`).join('')}</div><div style="height:18px"></div></div>
  <h2>Dernières commandes</h2>${table(['Numéro', 'Client', 'Date', 'Montant', 'Statut'], (recent || []).map((o) => `<tr><td><a href="#orders">${esc(o.order_number)}</a></td><td>${esc(o.full_name)}</td><td>${fmtDate(o.created_at)}</td><td>${fmtPrice(o.total)}</td><td><span class="status ${o.status}">${STATUS[o.status]}</span></td></tr>`))}`;
}
