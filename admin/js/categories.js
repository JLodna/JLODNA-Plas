import { sb, bucketUrl } from '/js/supabase.js';
import { $, $$, esc, slugify, toast, friendlyError, validateImage, setLoading } from '/js/utils.js';
import { table, modal, confirmBox } from './ui.js';
export async function render(el) {
  const { data, error } = await sb.from('categories').select('*').order('sort_order').order('name'); if (error) throw error;
  const name = (id) => data.find((c) => c.id === id)?.name || '—';
  el.innerHTML = `<h1>Catégories</h1><div class="toolbar"><button class="btn primary" id="add">Ajouter une catégorie</button></div>${table(['', 'Nom', 'Slug', 'Parente', 'Active', 'Actions'], data.map((c) => `<tr><td>${c.image_url ? `<img class="thumb" src="${esc(c.image_url)}" alt="">` : ''}</td><td>${esc(c.name)}</td><td>${esc(c.slug)}</td><td>${c.parent_id ? esc(name(c.parent_id)) : 'Principale'}</td><td>${c.is_active ? 'Oui' : 'Non'}</td><td><button class="btn ghost sm" data-e="${c.id}">Modifier</button> <button class="btn ghost sm" data-t="${c.id}">${c.is_active ? 'Désactiver' : 'Activer'}</button> <button class="btn danger sm" data-d="${c.id}">Supprimer</button></td></tr>`))}`;
  const edit = (c = {}) => {
    const m = modal(`<h2>${c.id ? 'Modifier' : 'Ajouter'} la catégorie</h2><form id="cf"><div class="field"><label for="cn">Nom</label><input id="cn" value="${esc(c.name || '')}" required></div><div class="field"><label for="cp">Catégorie parente</label><select id="cp"><option value="">Aucune (catégorie principale)</option>${data.filter((x) => x.id !== c.id).map((x) => `<option value="${x.id}" ${x.id === c.parent_id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div><div class="field"><label for="co">Ordre d’affichage</label><input id="co" type="number" value="${c.sort_order || 0}"></div><div class="field"><label for="ci">Image</label><input id="ci" type="file" accept="image/jpeg,image/png,image/webp"></div><label class="chk"><input type="checkbox" id="ca" ${c.is_active === false ? '' : 'checked'}> Active</label><p class="err-msg" id="ce" role="alert"></p><div class="row" style="margin-top:12px"><button class="btn primary" id="cs">Enregistrer</button><button type="button" class="btn ghost" id="cx">Annuler</button></div></form>`);
    m.querySelector('#cx').onclick = () => m.remove();
    m.querySelector('#cf').onsubmit = async (e) => {
      e.preventDefault(); const q = (s) => m.querySelector(s); const nm = q('#cn').value.trim(); if (nm.length < 2) { q('#ce').textContent = 'Saisissez un nom.'; return; }
      setLoading(q('#cs'), true); let image_url = c.image_url || null; const f = q('#ci').files[0];
      if (f) { const bad = validateImage(f); if (bad) { q('#ce').textContent = bad; setLoading(q('#cs'), false); return; } const path = `categories/${crypto.randomUUID()}.${{ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[f.type]}`; const up = await sb.storage.from('product-images').upload(path, f, { contentType: f.type }); if (up.error) { q('#ce').textContent = friendlyError(up.error); setLoading(q('#cs'), false); return; } image_url = bucketUrl(path); }
      const row = { name: nm, slug: c.slug || slugify(nm), parent_id: q('#cp').value || null, sort_order: +q('#co').value || 0, is_active: q('#ca').checked, image_url };
      const { error } = c.id ? await sb.from('categories').update(row).eq('id', c.id) : await sb.from('categories').insert(row);
      setLoading(q('#cs'), false); if (error) { q('#ce').textContent = friendlyError(error); return; } m.remove(); toast('Catégorie enregistrée.'); render(el);
    };
  };
  $('#add').onclick = () => edit();
  $$('[data-e]').forEach((b) => (b.onclick = () => edit(data.find((c) => c.id === b.dataset.e))));
  $$('[data-t]').forEach((b) => (b.onclick = async () => { const c = data.find((x) => x.id === b.dataset.t); await sb.from('categories').update({ is_active: !c.is_active }).eq('id', c.id); render(el); }));
  $$('[data-d]').forEach((b) => (b.onclick = async () => { if (!(await confirmBox('Supprimer cette catégorie ? Les produits associés resteront sans catégorie.'))) return; const { error } = await sb.from('categories').delete().eq('id', b.dataset.d); toast(error ? friendlyError(error) : 'Catégorie supprimée.', error ? 'err' : 'ok'); render(el); }));
}
