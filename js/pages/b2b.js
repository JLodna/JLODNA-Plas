import { initLayout } from '../layout.js';
import { sb } from '../supabase.js';
import { getUser } from '../auth.js';
import { $, $$, esc, fmtDate, setLoading, toast, friendlyError, isEmail, emptyState } from '../utils.js';
import { B2B_TYPES, B2B_STATUS } from '../b2b-common.js';
import { checkFile, randomName } from '../media.js';
import { cameraButton, setInputFile } from '../native.js';

initLayout();
cameraButton($('#b-file'), (f) => setInputFile($('#b-file'), f));
let user = null;
const FILE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

function thread(msgs) {
  return `<div class="b2b-thread">${msgs.map((m) => m.kind === 'status'
    ? `<div class="b2b-msg sys">Statut : ${esc(B2B_STATUS[m.body] || m.body)} · ${fmtDate(m.created_at)}</div>`
    : `<div class="b2b-msg ${m.is_staff ? 'staff' : ''}"><small>${m.is_staff ? 'JLODNA Plas' : 'Vous'} · ${fmtDate(m.created_at)}</small>${esc(m.body)}</div>`).join('')}</div>`;
}

async function loadMine() {
  const box = $('#mine');
  if (!user) { box.innerHTML = '<p class="muted">Connectez-vous pour suivre vos demandes et échanger avec notre équipe. <a href="/login?next=/b2b">Se connecter</a></p>'; return; }
  const { data, error } = await sb.from('b2b_requests').select('id,ref,request_type,product,quantity,status,created_at').order('created_at', { ascending: false }).limit(30);
  if (error) { box.innerHTML = '<p class="muted">Impossible de charger vos demandes pour le moment.</p>'; return; }
  box.innerHTML = data.length ? data.map((r) => `<details class="order-card b2b-req" data-id="${esc(r.id)}"><summary>${esc(r.ref)} — ${esc(B2B_TYPES[r.request_type] || r.request_type)} <span class="status">${esc(B2B_STATUS[r.status] || r.status)}</span><br><span class="muted" style="font-weight:400">${esc(r.product)} · ${esc(r.quantity)} · ${fmtDate(r.created_at)}</span></summary><div class="b2b-body"></div></details>`).join('')
    : emptyState('Vous n’avez pas encore envoyé de demande.');
  $$('details.b2b-req', box).forEach((d) => d.addEventListener('toggle', () => { if (d.open && !d.dataset.loaded) { d.dataset.loaded = '1'; openThread(d); } }));
}

async function openThread(d) {
  const body = $('.b2b-body', d); const id = d.dataset.id;
  body.innerHTML = '<div class="sk-line"></div>';
  const { data, error } = await sb.from('b2b_messages').select('*').eq('request_id', id).order('created_at');
  if (error) { body.innerHTML = '<p class="muted">Impossible de charger les échanges.</p>'; return; }
  body.innerHTML = `${data.length ? thread(data) : '<p class="muted">Aucun échange pour le moment.</p>'}
    <form class="b2b-reply"><div class="field"><label>Votre message<textarea required maxlength="4000"></textarea></label></div><button class="btn primary sm">Envoyer</button></form>`;
  $('form', body).onsubmit = async (e) => {
    e.preventDefault(); const ta = $('textarea', body); const txt = ta.value.trim(); if (!txt) return;
    const btn = $('button', body); setLoading(btn, true, 'Envoi…');
    const { error: er } = await sb.rpc('post_b2b_message', { p_request_id: id, p_body: txt });
    setLoading(btn, false);
    if (er) return toast(friendlyError(er), 'err');
    openThread(d);
  };
}

(async () => {
  if (!sb) return;
  user = await getUser();
  if (!user) { // Connexion obligatoire : le formulaire n'est pas proposé aux visiteurs
    $('#b2b-form').hidden = true;
    const d = $('#b-done'); d.hidden = false;
    d.innerHTML = '<h2 style="font-size:1.3rem">Connexion requise</h2><p class="muted">Pour envoyer une demande B2B, suivre son avancement et échanger avec notre équipe commerciale, connectez-vous ou créez un compte gratuit.</p><a class="btn primary" href="/login?next=/b2b">Se connecter</a> <a class="btn ghost" href="/register">Créer un compte</a>';
    loadMine(); return;
  }
  const { data: p } = await sb.from('profiles').select('first_name,last_name,phone').eq('id', user.id).maybeSingle();
  $('#b-name').value = [p?.first_name, p?.last_name].filter(Boolean).join(' ');
  $('#b-email').value = user.email || ''; $('#b-phone').value = p?.phone || '';
  loadMine();
})();

$('#b2b-form').addEventListener('submit', async (e) => {
  e.preventDefault(); const err = $('#b-err'); err.textContent = '';
  if ($('#b-web').value) return; // champ piège : seuls les robots le remplissent
  const v = { name: $('#b-name').value.trim(), company: $('#b-company').value.trim(), phone: $('#b-phone').value.trim(), email: $('#b-email').value.trim(), country: $('#b-country').value.trim(),
    type: $('#b-type').value, product: $('#b-product').value.trim(), qty: parseInt($('#b-qty').value, 10), budget: $('#b-budget').value.trim(), desc: $('#b-desc').value.trim() };
  if (v.name.length < 2 || v.phone.length < 6 || !isEmail(v.email) || v.country.length < 2 || v.product.length < 2 || !(v.qty > 0) || v.desc.length < 5) { err.textContent = 'Veuillez renseigner tous les champs obligatoires (*) avec des informations valides.'; return; }
  if (!user) { err.textContent = 'Veuillez vous connecter.'; return; }
  if (!B2B_TYPES[v.type]) { err.textContent = 'Type de demande invalide.'; return; }
  const btn = $('#b-btn'); setLoading(btn, true, 'Envoi…');
  let path = null;
  try {
    const f = $('#b-file').files[0];
    if (f) {
      const chk = await checkFile(f, { types: FILE_TYPES, maxMB: 10 });
      if (chk.error) { err.textContent = chk.error; setLoading(btn, false); return; }
      path = `${user.id}/${randomName(chk.mime)}`;
      const up = await sb.storage.from('b2b-files').upload(path, f, { contentType: chk.mime, upsert: false });
      if (up.error) throw up.error;
    }
    const { data: ref, error } = await sb.rpc('submit_b2b_request', { p_full_name: v.name, p_company: v.company || null, p_phone: v.phone, p_email: v.email, p_country: v.country, p_type: v.type, p_product: v.product, p_quantity: v.qty, p_budget: v.budget || null, p_description: v.desc, p_attachment: path });
    if (error) { if (path) await sb.storage.from('b2b-files').remove([path]); throw error; }
    $('#b2b-form').hidden = true;
    const done = $('#b-done'); done.hidden = false;
    done.innerHTML = `<h2 style="font-size:1.3rem">Demande envoyée</h2><p>Votre référence : <strong>${esc(ref)}</strong></p><p class="muted">Notre équipe commerciale vous répondra rapidement; vous pouvez suivre cette demande ci-dessous.</p><button class="btn ghost" id="b-again">Nouvelle demande</button>`;
    $('#b-again').onclick = () => { $('#b2b-form').reset(); $('#b2b-form').hidden = false; done.hidden = true; };
    toast('Demande envoyée.'); loadMine();
  } catch (ex) { err.textContent = friendlyError(ex); }
  setLoading(btn, false);
});
