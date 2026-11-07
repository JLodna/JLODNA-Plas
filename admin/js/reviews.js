import { sb } from '/js/supabase.js';
import { $, $$, esc, fmtDate, toast, friendlyError } from '/js/utils.js';
import { table, confirmBox } from './ui.js';
const ST = { pending: 'En attente', approved: 'Approuvé', rejected: 'Refusé' };
export async function render(el) {
  el.innerHTML = `<h1>Avis clients</h1><div class="toolbar"><select id="st" aria-label="Statut"><option value="pending">En attente</option><option value="approved">Approuvés</option><option value="rejected">Refusés</option><option value="">Tous</option></select></div><div id="t"></div>`;
  const load = async () => {
    let q = sb.from('reviews').select('*, products(name)').order('created_at', { ascending: false }).limit(200); if ($('#st').value) q = q.eq('status', $('#st').value);
    const { data, error } = await q; if (error) throw error;
    $('#t').innerHTML = table(['Date', 'Produit', 'Auteur', 'Note', 'Commentaire', 'Statut', 'Actions'], data.map((r) => `<tr><td>${fmtDate(r.created_at)}</td><td class="wrap-t">${esc(r.products?.name || '—')}</td><td>${esc(r.author_name)}</td><td><span class="stars">${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</span></td><td class="wrap-t">${esc(r.comment || '—')}</td><td>${ST[r.status]}</td><td>${r.status !== 'approved' ? `<button class="btn primary sm" data-a="${r.id}">Approuver</button> ` : ''}${r.status !== 'rejected' ? `<button class="btn ghost sm" data-r="${r.id}">Refuser</button> ` : ''}<button class="btn danger sm" data-d="${r.id}">Supprimer</button></td></tr>`));
    const set = async (id, status) => { const { error } = await sb.from('reviews').update({ status }).eq('id', id); toast(error ? friendlyError(error) : (status === 'approved' ? 'Avis approuvé : il est maintenant public.' : 'Avis refusé.'), error ? 'err' : 'ok'); load(); };
    $$('[data-a]').forEach((b) => (b.onclick = () => set(b.dataset.a, 'approved')));
    $$('[data-r]').forEach((b) => (b.onclick = () => set(b.dataset.r, 'rejected')));
    $$('[data-d]').forEach((b) => (b.onclick = async () => { if (!(await confirmBox('Supprimer définitivement cet avis ?'))) return; const { error } = await sb.from('reviews').delete().eq('id', b.dataset.d); toast(error ? friendlyError(error) : 'Avis supprimé.', error ? 'err' : 'ok'); load(); }));
  };
  $('#st').onchange = load; await load();
}
