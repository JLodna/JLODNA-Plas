import { sb } from '/js/supabase.js';
import { $, esc, fmtDate } from '/js/utils.js';
import { table } from './ui.js';
export async function render(el) {
  const { data, error } = await sb.from('notifications').select('*').order('created_at', { ascending: false }).limit(100); if (error) throw error;
  el.innerHTML = `<h1>Notifications</h1><div class="toolbar"><button class="btn ghost" id="all">Tout marquer comme lu</button></div>${table(['Date', 'Notification', 'Détail'], data.map((n) => `<tr style="${n.is_read ? '' : 'font-weight:700'}"><td>${fmtDate(n.created_at)}</td><td class="wrap-t">${n.link && n.link.startsWith('/') ? `<a href="${esc(n.link)}">${esc(n.title)}</a>` : esc(n.title)}</td><td class="wrap-t">${esc(n.body || '')}</td></tr>`))}`;
  $('#all').onclick = async () => { await sb.from('notifications').update({ is_read: true }).eq('is_read', false); render(el); };
}
