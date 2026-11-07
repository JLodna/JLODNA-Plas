import { sb } from '/js/supabase.js';
import { $$, esc, fmtDate } from '/js/utils.js';
import { table } from './ui.js';
export async function render(el) {
  const { data, error } = await sb.from('messages').select('*').order('created_at', { ascending: false }).limit(100); if (error) throw error;
  el.innerHTML = `<h1>Messages</h1>${table(['Date', 'De', 'Sujet', 'Message', ''], data.map((m) => `<tr style="${m.is_read ? '' : 'font-weight:700'}"><td>${fmtDate(m.created_at)}</td><td>${esc(m.name)}<br><a href="mailto:${esc(m.email)}">${esc(m.email)}</a></td><td class="wrap-t">${esc(m.subject || '—')}</td><td class="wrap-t">${esc(m.body)}</td><td>${m.is_read ? '' : `<button class="btn ghost sm" data-r="${m.id}">Marquer comme lu</button>`}</td></tr>`))}`;
  $$('[data-r]').forEach((b) => (b.onclick = async () => { await sb.from('messages').update({ is_read: true }).eq('id', b.dataset.r); render(el); }));
}
