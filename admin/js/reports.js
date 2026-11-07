import { sb } from '/js/supabase.js';
import { $, $$, esc, fmtDate, toast, friendlyError } from '/js/utils.js';
import { table } from './ui.js';

const ST = { open: 'À traiter', reviewed: 'Examiné', dismissed: 'Rejeté', actioned: 'Mesure appliquée' };
const RS = { inappropriate: 'Contenu inapproprié', illegal: 'Contenu illégal', spam: 'Spam / publicité', fake: 'Faux / trompeur', other: 'Autre' };
let filter = 'open';

export async function render(el) {
  let q = sb.from('reports').select('*').order('created_at', { ascending: false }).limit(300); if (filter) q = q.eq('status', filter);
  const { data, error } = await q; if (error) throw error;
  el.innerHTML = `<h1>Signalements</h1><p class="muted">Contenus signalés par les utilisateurs (BIO, produits). « Appliquer la mesure » bloque le BIO ou retire le produit de la vente.</p>
  <select id="f" aria-label="Filtrer"><option value="">Tous</option>${Object.entries(ST).map(([k, v]) => `<option value="${k}" ${filter === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
  ${table(['Date', 'Contenu', 'Motif', 'Précisions', 'Statut', ''], data.map((r) => `<tr><td>${fmtDate(r.created_at)}</td><td>${r.target_type === 'bio' ? `BIO · <a href="/bio/u/${esc(r.target_id)}" target="_blank" rel="noopener">${esc(r.target_label || r.target_id)}</a>` : `Produit · <a href="#products">${esc(r.target_label || r.target_id)}</a>`}</td><td>${esc(RS[r.reason] || r.reason)}</td><td>${esc(r.details || '')}</td><td>${ST[r.status]}</td>
  <td>${r.status === 'open' ? `<button class="btn sm" data-a="${esc(r.id)}" data-s="actioned">Appliquer la mesure</button> <button class="btn sm ghost" data-a="${esc(r.id)}" data-s="dismissed">Rejeter</button>` : ''}</td></tr>`))}`;
  $('#f', el).onchange = (e) => { filter = e.target.value; render(el); };
  $$('[data-a]', el).forEach((b) => (b.onclick = async () => {
    const apply = b.dataset.s === 'actioned'; if (apply && !confirm('Bloquer le BIO / retirer le produit de la vente ?')) return;
    const { error: er } = await sb.rpc('admin_set_report_status', { p_id: b.dataset.a, p_status: b.dataset.s, p_apply: apply });
    if (er) return toast(String(er.message).includes('FORBIDDEN') ? 'Permission insuffisante pour cette mesure.' : friendlyError(er), 'err');
    toast('Signalement traité.'); render(el);
  }));
}
