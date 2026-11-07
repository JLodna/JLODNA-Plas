import { sb } from '/js/supabase.js';
import { $, esc, fmtDate, debounce } from '/js/utils.js';
import { table } from './ui.js';
export async function render(el) {
  el.innerHTML = `<h1>Clients</h1><div class="toolbar"><input id="q" type="search" placeholder="Rechercher (nom, email, téléphone)" aria-label="Rechercher"></div><div id="t"></div>`;
  const load = async () => {
    const q = $('#q').value.replace(/[%,()]/g, ' ').trim(); let query = sb.from('profiles').select('*').order('created_at', { ascending: false }).limit(200);
    if (q) query = query.or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,email.ilike.%${q}%,phone.ilike.%${q}%`);
    const { data, error } = await query; if (error) throw error;
    $('#t').innerHTML = table(['Nom', 'Email', 'Téléphone', 'Inscription'], data.map((c) => `<tr><td>${esc([c.first_name, c.last_name].filter(Boolean).join(' ') || '—')}</td><td>${esc(c.email)}</td><td>${esc(c.phone || '—')}</td><td>${fmtDate(c.created_at)}</td></tr>`));
  };
  $('#q').oninput = debounce(load, 300); await load();
}
