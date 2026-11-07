import { sb } from '/js/supabase.js';
import { $, $$, esc, fmtDate, toast, friendlyError, setLoading } from '/js/utils.js';
import { B2B_TYPES, B2B_STATUS, B2B_STATUS_KEYS } from '/js/b2b-common.js';
import { table, modal } from './ui.js';

let state = { status: '', q: '' };

export async function render(el) {
  el.innerHTML = '<h1>Demandes B2B</h1><div class="sk-line"></div>';
  let q = sb.from('b2b_requests').select('*').order('created_at', { ascending: false }).limit(200);
  if (state.status) q = q.eq('status', state.status);
  const { data, error } = await q; if (error) throw error;
  const s = state.q.toLowerCase();
  const rows = (s ? data.filter((r) => [r.ref, r.full_name, r.company, r.email, r.phone, r.product, r.country].some((x) => String(x || '').toLowerCase().includes(s))) : data);
  el.innerHTML = `<h1>Demandes B2B</h1>
  <div class="row" style="gap:8px;flex-wrap:wrap;margin-bottom:12px"><select id="f-st" aria-label="Filtrer par statut"><option value="">Tous les statuts</option>${B2B_STATUS_KEYS.map((k) => `<option value="${k}" ${state.status === k ? 'selected' : ''}>${esc(B2B_STATUS[k])}</option>`).join('')}</select><input id="f-q" type="search" placeholder="Rechercher (réf., nom, entreprise, email, produit)" value="${esc(state.q)}" aria-label="Rechercher"></div>
  ${table(['Réf.', 'Date', 'Client', 'Type', 'Produit × quantité', 'Statut', ''], rows.map((r) => `<tr style="${r.status === 'new' ? 'font-weight:700' : ''}"><td>${esc(r.ref)}</td><td>${fmtDate(r.created_at)}</td><td>${esc(r.full_name)}${r.company ? `<br><span class="muted">${esc(r.company)}</span>` : ''}<br><span class="muted">${r.user_id ? 'Compte client' : 'Visiteur'}</span></td><td>${esc(B2B_TYPES[r.request_type] || r.request_type)}</td><td>${esc(r.product)} × ${esc(r.quantity)}</td><td>${esc(B2B_STATUS[r.status] || r.status)}</td><td><button class="btn sm" data-o="${esc(r.id)}">Ouvrir</button></td></tr>`))}`;
  $('#f-st', el).onchange = (e) => { state.status = e.target.value; render(el); };
  $('#f-q', el).onchange = (e) => { state.q = e.target.value.trim(); render(el); };
  $$('[data-o]', el).forEach((b) => (b.onclick = () => open(rows.find((r) => r.id === b.dataset.o), el)));
}

async function open(r, el) {
  const m = modal('<div class="sk-line"></div>');
  const box = m.firstElementChild;
  async function draw() {
    const { data: msgs } = await sb.from('b2b_messages').select('*').eq('request_id', r.id).order('created_at');
    let file = '';
    if (r.attachment_path) {
      const { data: sg } = await sb.storage.from('b2b-files').createSignedUrl(r.attachment_path, 300); // lien temporaire (5 min)
      file = sg?.signedUrl ? `<p><a href="${esc(sg.signedUrl)}" target="_blank" rel="noopener noreferrer">Ouvrir la pièce jointe</a> <span class="muted">(lien valable 5 minutes)</span></p>` : '<p class="muted">Pièce jointe indisponible.</p>';
    }
    box.innerHTML = `<h2 style="margin-top:0">${esc(r.ref)} — ${esc(B2B_TYPES[r.request_type] || '')}</h2>
    <p><strong>${esc(r.full_name)}</strong>${r.company ? ' · ' + esc(r.company) : ''} <span class="muted">(${r.user_id ? 'compte client' : 'visiteur'})</span><br>
    <a href="mailto:${esc(r.email)}?subject=${encodeURIComponent('Votre demande ' + r.ref + ' — JLODNA Plas')}">${esc(r.email)}</a> · <a href="tel:${esc(r.phone)}">${esc(r.phone)}</a> · ${esc(r.country)}</p>
    <p><strong>Produit :</strong> ${esc(r.product)}<br><strong>Quantité :</strong> ${esc(r.quantity)}${r.budget ? `<br><strong>Budget :</strong> ${esc(r.budget)}` : ''}<br><span class="muted">Reçue le ${fmtDate(r.created_at)}</span></p>
    <p style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(r.description)}</p>${file}
    <div class="field"><label for="st">Statut</label><select id="st">${B2B_STATUS_KEYS.map((k) => `<option value="${k}" ${r.status === k ? 'selected' : ''}>${esc(B2B_STATUS[k])}</option>`).join('')}</select></div>
    <h3>Historique des échanges</h3>
    <div class="b2b-thread">${(msgs || []).map((x) => x.kind === 'status' ? `<div class="b2b-msg sys">Statut → ${esc(B2B_STATUS[x.body] || x.body)} · ${fmtDate(x.created_at)}</div>` : `<div class="b2b-msg ${x.is_staff ? 'staff' : ''}"><small>${x.is_staff ? 'Équipe' : esc(r.full_name)} · ${fmtDate(x.created_at)}</small>${esc(x.body)}</div>`).join('') || '<p class="muted">Aucun échange.</p>'}</div>
    ${r.user_id ? `<div class="field"><label for="rp">Répondre (visible par le client dans son compte)</label><textarea id="rp" maxlength="4000"></textarea></div><button class="btn primary" id="send">Envoyer la réponse</button>` : '<p class="muted">Visiteur sans compte : répondez par email ou téléphone (liens ci-dessus), puis mettez à jour le statut.</p>'}
    <button class="btn ghost" id="close" style="margin-left:8px">Fermer</button>`;
    $('#st', box).onchange = async (e) => {
      const { error } = await sb.rpc('admin_set_b2b_status', { p_id: r.id, p_status: e.target.value });
      if (error) { toast(friendlyError(error), 'err'); e.target.value = r.status; return; }
      r.status = e.target.value; toast('Statut mis à jour.'); draw();
    };
    $('#send', box) && ($('#send', box).onclick = async () => {
      const t = $('#rp', box).value.trim(); if (!t) return;
      setLoading($('#send', box), true, 'Envoi…');
      const { error } = await sb.rpc('post_b2b_message', { p_request_id: r.id, p_body: t });
      if (error) { setLoading($('#send', box), false); return toast(friendlyError(error), 'err'); }
      toast('Réponse envoyée.'); draw();
    });
    $('#close', box).onclick = () => { m.remove(); render(el); };
  }
  draw();
}
