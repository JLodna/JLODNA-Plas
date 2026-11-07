import { sb, bucketUrl } from '/js/supabase.js';
import { $, $$, esc, fmtPrice, slugify, setLoading, toast, friendlyError, validateImage, debounce } from '/js/utils.js';
import { table, confirmBox } from './ui.js';
import { imgOf, stockOf } from '/js/products.js';
import { optionGroups, cartesian, parseOptions, sameAttrs, variantLabel } from '/js/variants.js';
import { ctx } from './admin.js';

const SEL = '*, product_images(id, url, alt, sort_order), product_variants(*), categories(name)';
export async function render(el, [id]) { return id ? form(el, id) : list(el); }

async function list(el) {
  el.innerHTML = `<h1>Produits</h1><div class="toolbar"><input id="q" type="search" placeholder="Rechercher (nom, SKU)" aria-label="Rechercher"><select id="st" aria-label="Statut"><option value="">Tous les statuts</option><option value="published">Publiés</option><option value="draft">Brouillons</option><option value="disabled">Désactivés</option></select><a class="btn primary" href="#products/new">Ajouter un produit</a></div><div id="t"></div>`;
  const load = async () => {
    const q = $('#q').value.replace(/[%,()]/g, ' ').trim(); let query = sb.from('products').select(SEL).order('created_at', { ascending: false }).limit(200);
    if ($('#st').value) query = query.eq('status', $('#st').value);
    if (q) { const { data: vm } = await sb.from('product_variants').select('product_id').ilike('sku', `%${q}%`).limit(30); const ids = [...new Set((vm || []).map((r) => r.product_id))]; query = query.or(`name.ilike.%${q}%,sku.ilike.%${q}%${ids.length ? `,id.in.(${ids.join(',')})` : ''}`); }
    const { data, error } = await query; if (error) throw error;
    $('#t').innerHTML = table(['', 'Nom', 'SKU', 'Prix', 'Variantes', 'Disponible', 'Statut', 'Actions'], data.map((p) => `<tr><td><img class="thumb" src="${imgOf(p)}" alt=""></td><td class="wrap-t">${esc(p.name)}${p.is_featured ? ' ★' : ''}</td><td>${esc(p.sku || '—')}</td><td>${p.sale_price != null ? `<s>${fmtPrice(p.price)}</s> ` : ''}${fmtPrice(p.sale_price ?? p.price)}</td><td>${p.product_variants.length}</td><td>${stockOf(p)}</td><td>${{ published: 'Publié', draft: 'Brouillon', disabled: 'Désactivé' }[p.status]}</td>
      <td><a class="btn ghost sm" href="#products/${p.id}">Modifier</a> <button class="btn ghost sm" data-st="${p.id}" data-to="${p.status === 'published' ? 'disabled' : 'published'}">${p.status === 'published' ? 'Désactiver' : 'Publier'}</button> <button class="btn danger sm" data-del="${p.id}">Supprimer</button></td></tr>`));
    $$('[data-st]').forEach((b) => (b.onclick = async () => { const { error } = await sb.from('products').update({ status: b.dataset.to }).eq('id', b.dataset.st); toast(error ? friendlyError(error) : 'Produit mis à jour.', error ? 'err' : 'ok'); load(); }));
    $$('[data-del]').forEach((b) => (b.onclick = async () => { if (!(await confirmBox('Supprimer définitivement ce produit et ses variantes ?'))) return; const { error } = await sb.from('products').delete().eq('id', b.dataset.del); toast(error ? friendlyError(error) : 'Produit supprimé.', error ? 'err' : 'ok'); load(); }));
  };
  $('#q').oninput = debounce(load, 300); $('#st').onchange = load; await load();
}

const defaultRow = () => ({ id: null, sku: '', price: '', sale_price: '', stock_quantity: 0, reserved_quantity: 0, low_stock_threshold: 5, status: 'active', attributes: {} });

async function form(el, id) {
  let curId = id === 'new' ? null : id; let p = { name: '', slug: '', description: '', price: '', sale_price: '', category_id: '', sku: '', weight_grams: '', status: 'draft', is_featured: false, is_on_sale: false, product_images: [], product_variants: [] };
  if (curId) { const { data, error } = await sb.from('products').select(SEL).eq('id', curId).maybeSingle(); if (error || !data) { el.innerHTML = '<p>Produit introuvable.</p>'; return; } p = data; }
  const canStock = ctx.can('inventory.write');
  const { data: cats } = await sb.from('categories').select('id, name').order('name');
  let images = [...p.product_images].sort((a, b) => a.sort_order - b.sort_order).map((i) => ({ url: i.url, alt: i.alt })); const removedUrls = [];
  // Variantes : état d'édition
  let rows = [...p.product_variants].sort((a, b) => a.sort_order - b.sort_order).map((v) => ({ id: v.id, sku: v.sku || '', price: v.price ?? '', sale_price: v.sale_price ?? '', stock_quantity: v.stock_quantity, reserved_quantity: v.reserved_quantity, low_stock_threshold: v.low_stock_threshold, status: v.status, attributes: v.attributes || {} }));
  let groups = optionGroups(rows).map((g) => ({ name: g.name, options: g.options.join(', ') }));
  if (!rows.length) rows = [defaultRow()];

  el.innerHTML = `<p><a href="#products">← Produits</a></p><h1>${curId ? 'Modifier le produit' : 'Ajouter un produit'}</h1>
  <form id="pf" class="panel-box" novalidate style="max-width:860px">
    <div class="field"><label for="name">Nom</label><input id="name" value="${esc(p.name)}" required maxlength="200"></div>
    <div class="two"><div class="field"><label for="slug">Slug (adresse du produit)</label><input id="slug" value="${esc(p.slug)}" required></div><div class="field"><label for="sku">SKU du produit</label><input id="sku" value="${esc(p.sku || '')}"></div></div>
    <div class="field"><label for="description">Description</label><textarea id="description">${esc(p.description || '')}</textarea></div>
    <div class="two"><div class="field"><label for="price">Prix (G)</label><input id="price" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(p.price)}" required></div><div class="field"><label for="sale_price">Prix promotionnel (G)</label><input id="sale_price" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(p.sale_price ?? '')}"></div></div>
    <div class="two"><div class="field"><label for="category_id">Catégorie</label><select id="category_id"><option value="">Aucune</option>${(cats || []).map((c) => `<option value="${c.id}" ${c.id === p.category_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div><div class="field"><label for="weight">Poids (g)</label><input id="weight" type="number" min="0" inputmode="numeric" value="${esc(p.weight_grams ?? '')}"></div></div>
    <div class="field"><label for="status">Statut</label><select id="status"><option value="draft">Brouillon</option><option value="published">Publié</option><option value="disabled">Désactivé</option></select></div>
    <label class="chk"><input type="checkbox" id="is_featured" ${p.is_featured ? 'checked' : ''}> Produit vedette (recommandé)</label>
    <label class="chk" style="margin-bottom:14px"><input type="checkbox" id="is_on_sale" ${p.is_on_sale ? 'checked' : ''} disabled> Produit en promotion (automatique : dès qu’un prix promotionnel est renseigné)</label>
    <div class="field"><label>Images (JPG, PNG ou WebP, 5 Mo max)</label><div class="imgs" id="imgs"></div><input id="file" type="file" accept="image/jpeg,image/png,image/webp" multiple></div>

    <h2 style="font-size:1.2rem;margin-top:18px">Variantes et stock</h2>
    <div id="simple"></div>
    <div class="field"><label>Options (facultatif) — ex. « Taille » : S, M, L</label><div id="groups"></div>
      <div class="row"><button type="button" class="btn ghost sm" id="addg">Ajouter une option</button><button type="button" class="btn ghost sm" id="gen">Générer les variantes</button></div></div>
    <div id="vtable"></div>

    <p class="err-msg" id="err" role="alert"></p>
    <div class="row"><button class="btn primary" id="save">Enregistrer</button><a class="btn ghost" href="#products">Annuler</a></div></form>`;
  $('#status').value = p.status;

  const drawImgs = () => { $('#imgs').innerHTML = images.map((im, i) => `<div class="im"><img src="${esc(im.url)}" alt="Image ${i + 1}">${i === 0 ? '' : `<button type="button" data-first="${i}" style="right:auto;left:-6px;background:#000" aria-label="Mettre en premier">↑</button>`}<button type="button" data-rm="${i}" aria-label="Retirer l’image">×</button></div>`).join(''); $$('[data-rm]').forEach((b) => (b.onclick = () => { const [r] = images.splice(+b.dataset.rm, 1); removedUrls.push(r.url); drawImgs(); })); $$('[data-first]').forEach((b) => (b.onclick = () => { const [r] = images.splice(+b.dataset.first, 1); images.unshift(r); drawImgs(); })); };

  const drawGroups = () => {
    $('#groups').innerHTML = groups.map((g, i) => `<div class="vrow"><input data-gn="${i}" placeholder="Nom (Taille)" value="${esc(g.name)}" aria-label="Nom de l’option"><input data-go="${i}" placeholder="Valeurs séparées par des virgules" value="${esc(g.options)}" aria-label="Valeurs"><button type="button" class="btn danger sm" data-gd="${i}" aria-label="Retirer l’option">×</button></div>`).join('');
    $$('[data-gn]').forEach((i) => (i.oninput = () => (groups[+i.dataset.gn].name = i.value)));
    $$('[data-go]').forEach((i) => (i.oninput = () => (groups[+i.dataset.go].options = i.value)));
    $$('[data-gd]').forEach((b) => (b.onclick = () => { groups.splice(+b.dataset.gd, 1); drawGroups(); }));
  };
  const hasGroups = () => groups.some((g) => g.name.trim() && parseOptions(g.options).length);
  const drawVariants = () => {
    if (!hasGroups()) {
      const r = rows[0];
      $('#simple').innerHTML = `<p class="muted" style="margin-top:0">Produit simple (une seule variante). Ajoutez des options ci-dessous pour proposer des tailles, couleurs, etc.</p><div class="two"><div class="field"><label for="s-stock">Stock physique</label><input id="s-stock" type="number" min="0" inputmode="numeric" value="${r.stock_quantity}" ${canStock ? '' : 'disabled'}></div><div class="field"><label for="s-thr">Alerte stock faible à</label><input id="s-thr" type="number" min="0" inputmode="numeric" value="${r.low_stock_threshold}" ${canStock ? '' : 'disabled'}></div></div><p class="muted">Réservé par des commandes : ${r.reserved_quantity} · Disponible : ${Math.max(0, r.stock_quantity - r.reserved_quantity)}</p>`;
      $('#vtable').innerHTML = '';
      $('#s-stock').oninput = (e) => (r.stock_quantity = +e.target.value || 0); $('#s-thr').oninput = (e) => (r.low_stock_threshold = +e.target.value || 0);
      return;
    }
    $('#simple').innerHTML = '';
    $('#vtable').innerHTML = `<div class="tbl-wrap"><table><thead><tr><th>Variante</th><th>SKU</th><th>Prix (G)</th><th>Promo (G)</th><th>Stock</th><th>Réservé</th><th>Alerte</th><th>Statut</th><th></th></tr></thead><tbody>${rows.map((r, i) => `<tr>
      <td><strong>${esc(variantLabel(r.attributes))}</strong></td>
      <td><input data-f="sku" data-i="${i}" value="${esc(r.sku)}" style="min-width:120px" aria-label="SKU"></td>
      <td><input data-f="price" data-i="${i}" type="number" min="0" step="0.01" value="${esc(r.price)}" placeholder="Prix produit" style="width:110px" aria-label="Prix"></td>
      <td><input data-f="sale_price" data-i="${i}" type="number" min="0" step="0.01" value="${esc(r.sale_price)}" style="width:100px" aria-label="Prix promotionnel"></td>
      <td><input data-f="stock_quantity" data-i="${i}" type="number" min="0" value="${r.stock_quantity}" style="width:80px" ${canStock ? '' : 'disabled'} aria-label="Stock"></td>
      <td>${r.reserved_quantity}</td>
      <td><input data-f="low_stock_threshold" data-i="${i}" type="number" min="0" value="${r.low_stock_threshold}" style="width:70px" ${canStock ? '' : 'disabled'} aria-label="Alerte"></td>
      <td><select data-f="status" data-i="${i}" aria-label="Statut"><option value="active" ${r.status === 'active' ? 'selected' : ''}>Active</option><option value="disabled" ${r.status === 'disabled' ? 'selected' : ''}>Désactivée</option></select></td>
      <td><button type="button" class="btn danger sm" data-vd="${i}" aria-label="Retirer la variante">×</button></td></tr>`).join('')}</tbody></table></div>`;
    $$('[data-f]').forEach((i) => (i.oninput = i.onchange = () => { const r = rows[+i.dataset.i]; const f = i.dataset.f; r[f] = ['stock_quantity', 'low_stock_threshold'].includes(f) ? (+i.value || 0) : i.value; }));
    $$('[data-vd]').forEach((b) => (b.onclick = () => { rows.splice(+b.dataset.vd, 1); if (!rows.length) rows = [defaultRow()]; drawVariants(); }));
  };
  const generate = () => {
    const gs = groups.map((g) => ({ name: g.name.trim(), options: parseOptions(g.options) })).filter((g) => g.name && g.options.length);
    const names = gs.map((g) => g.name); if (new Set(names).size !== names.length) { toast('Deux options ont le même nom.', 'err'); return; }
    const combos = cartesian(gs);
    const next = combos.map((attrs) => rows.find((r) => sameAttrs(r.attributes, attrs)) || { ...defaultRow(), attributes: attrs, stock_quantity: 0 });
    // Variante par défaut existante transformée en 1re combinaison : on conserve son stock/SKU
    if (gs.length && rows.length === 1 && Object.keys(rows[0].attributes).length === 0 && rows[0].id && next[0] && !next[0].id) { next[0] = { ...rows[0], attributes: next[0].attributes }; }
    const dropped = rows.filter((r) => !next.includes(r) && !(next[0] && next[0].id === r.id));
    if (dropped.some((r) => r.reserved_quantity > 0)) { toast('Impossible de retirer une combinaison réservée par une commande en cours. Désactivez-la plutôt.', 'err'); return; }
    rows = next.length ? next : [defaultRow()]; drawVariants();
  };
  drawImgs(); drawGroups(); drawVariants();
  $('#addg').onclick = () => { groups.push({ name: '', options: '' }); drawGroups(); };
  $('#gen').onclick = generate;
  if (!curId) $('#name').oninput = () => { if (!$('#slug').dataset.touched) $('#slug').value = slugify($('#name').value); }; $('#slug').oninput = () => ($('#slug').dataset.touched = 1);
  $('#file').onchange = async (e) => {
    for (const f of e.target.files) {
      const bad = validateImage(f); if (bad) { toast(`${f.name} : ${bad}`, 'err'); continue; }
      const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[f.type]; const path = `products/${crypto.randomUUID()}.${ext}`;
      const { error } = await sb.storage.from('product-images').upload(path, f, { contentType: f.type, cacheControl: '31536000' });
      if (error) toast(friendlyError(error), 'err'); else { images.push({ url: bucketUrl(path), alt: $('#name').value }); drawImgs(); }
    } e.target.value = '';
  };

  $('#pf').onsubmit = async (e) => {
    e.preventDefault(); const err = $('#err'); err.textContent = '';
    const num = (s) => (s === '' || s == null ? null : Number(s));
    const row = { name: $('#name').value.trim(), slug: slugify($('#slug').value || $('#name').value), description: $('#description').value.trim() || null, price: num($('#price').value), sale_price: num($('#sale_price').value), category_id: $('#category_id').value || null, sku: $('#sku').value.trim() || null, weight_grams: num($('#weight').value), status: $('#status').value, is_featured: $('#is_featured').checked };
    if (row.name.length < 2 || row.price == null || row.price < 0 || !row.slug) { err.textContent = 'Renseignez au moins un nom, un slug et un prix valide.'; return; }
    if (row.sale_price != null && row.sale_price >= row.price) { err.textContent = 'Le prix promotionnel doit être inférieur au prix normal.'; return; }
    // Les options saisies doivent avoir été appliquées aux variantes (bouton « Générer »)
    const gsNow = groups.map((g) => ({ name: g.name.trim(), options: parseOptions(g.options) })).filter((g) => g.name && g.options.length);
    const expected = cartesian(gsNow);
    const inSync = gsNow.length ? (expected.length === rows.length && expected.every((c) => rows.some((r) => sameAttrs(r.attributes, c)))) : (rows.length === 1 && Object.keys(rows[0].attributes).length === 0);
    if (!inSync) { err.textContent = 'Cliquez sur « Générer les variantes » pour appliquer vos options avant d’enregistrer.'; return; }
    const payload = rows.map((r) => ({ id: r.id, sku: (r.sku || '').trim() || null, name: variantLabel(r.attributes), attributes: r.attributes, price: num(r.price), sale_price: num(r.sale_price), status: r.status, stock_quantity: Math.max(0, Math.floor(+r.stock_quantity || 0)), low_stock_threshold: Math.max(0, Math.floor(+r.low_stock_threshold || 0)) }));
    for (const v of payload) { if (v.price != null && v.price < 0) { err.textContent = 'Un prix de variante est invalide.'; return; } if (v.sale_price != null && (v.price ?? row.price) <= v.sale_price) { err.textContent = `Variante « ${v.name} » : le prix promotionnel doit être inférieur au prix.`; return; } }
    if (row.status === 'published' && !payload.some((v) => v.status === 'active')) { err.textContent = 'Publiez au moins une variante active.'; return; }
    row.is_on_sale = row.sale_price != null || payload.some((v) => v.sale_price != null);
    // Une publication est appliquée APRÈS l'enregistrement des variantes (le serveur refuse de publier un produit sans variante active).
    const finalStatus = row.status; const deferPublish = finalStatus === 'published' && (!curId || p.status !== 'published');
    if (deferPublish) row.status = curId ? p.status : 'draft';
    setLoading($('#save'), true, 'Enregistrement…');
    try {
      if (!curId) { const { data, error } = await sb.from('products').insert(row).select('id').single(); if (error) throw error; curId = data.id; p.status = 'draft'; }
      else { const { error } = await sb.from('products').update(row).eq('id', curId); if (error) throw error; }
      { const { error } = await sb.rpc('admin_save_variants', { p_product_id: curId, p_variants: payload }); if (error) throw error; }
      await sb.from('product_images').delete().eq('product_id', curId);
      if (images.length) { const { error } = await sb.from('product_images').insert(images.map((im, i) => ({ product_id: curId, url: im.url, alt: im.alt || row.name, sort_order: i }))); if (error) throw error; }
      if (deferPublish) { const { error } = await sb.from('products').update({ status: finalStatus }).eq('id', curId); if (error) throw error; }
      const paths = removedUrls.filter((u) => !images.some((i) => i.url === u)).map((u) => u.split('/product-images/')[1]).filter(Boolean); if (paths.length) sb.storage.from('product-images').remove(paths);
      toast('Produit enregistré.'); location.hash = '#products';
    } catch (ex) { err.textContent = friendlyError(ex); } finally { setLoading($('#save'), false); }
  };
}
