import { sb } from '/js/supabase.js';
import { esc, fmtDate } from '/js/utils.js';
import { table } from './ui.js';
export async function render(el) {
  const { data, error } = await sb.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(300); if (error) throw error;
  el.innerHTML = `<h1>Journal d’audit</h1><p class="muted">Les adresses IP ne sont volontairement pas collectées.</p>${table(['Date', 'Utilisateur', 'Action', 'Élément', 'Détails'], data.map((l) => `<tr><td>${fmtDate(l.created_at)}</td><td>${esc(l.user_email || '—')}</td><td>${esc(l.action)}</td><td>${esc(l.entity || '')}</td><td class="wrap-t"><code style="font-size:.75rem">${esc(JSON.stringify(l.details || {}))}</code></td></tr>`))}`;
}
