import { initLayout } from '../layout.js';
import { sb, SITE_URL } from '../supabase.js';
import { requireUser } from '../auth.js';
import { $, $$, esc, fmtPrice, fmtDate, setLoading, toast, friendlyError } from '../utils.js';
import { checkFile, randomName } from '../media.js';
import { cameraButton } from '../native.js';

initLayout();
const root = $('#seller-root');
let user, me, cats = [], tab = 'products';
const ST = { draft: 'Brouillon', published: 'En vente', disabled: 'Désactivé' };
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/;
const slugify = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
const E = { NOT_A_SELLER: 'Vous n’avez pas de boutique vendeur.', SELLER_NOT_APPROVED: 'Votre boutique n’est pas (ou plus) approuvée.', ALREADY_SELLER: 'Vous avez déjà une boutique.', NOT_FOUND: 'Introuvable.', NO_VARIANT: 'Ajoutez au moins une variante active.', NO_IMAGE: 'Ajoutez au moins une image avant de soumettre.', PRODUCT_LOCKED: 'Retirez d’abord le produit de la vente pour modifier ses images.', INVALID_IMAGES: 'Image invalide.', STOCK_BELOW_RESERVED: 'Le stock ne peut pas être inférieur aux quantités déjà réservées par des commandes.', INVALID_STATUS: 'Statut invalide.' };
const msg = (ex) => { const m = String(ex?.message || ''); const k = Object.keys(E).find((x) => m.includes(x)); return k ? E[k] : friendlyError(ex); };

function renderApply() {
  root.innerHTML = `<p class="muted" style="max-width:640px">Vendez vos produits sur JLODNA Plas. Notre équipe étudie votre candidature, fixe la commission et valide chaque produit avant sa mise en vente. <strong>La plateforme gère le paiement et la livraison : vous ne voyez jamais les coordonnées des acheteurs.</strong></p>
  <form class="form-card" id="ap" novalidate style="max-width:560px;margin-top:16px"><h2 style="font-size:1.3rem">Postuler comme vendeur</h2>
  <div class="field"><label for="a-n">Nom de la boutique *</label><input id="a-n" required maxlength="80"></div>
  <div class="field"><label for="a-s">Identifiant * (3–30 : minuscules, chiffres, tirets)</label><input id="a-s" required maxlength="30" autocapitalize="none"></div>
  <div class="field"><label for="a-d">Description</label><textarea id="a-d" maxlength="1000"></textarea></div>
  <div class="two"><div class="field"><label for="a-p">Téléphone *</label><input id="a-p" type="tel" required maxlength="30"></div><div class="field"><label for="a-c">Ville</label><input id="a-c" maxlength="100"></div></div>
  <p class="err-msg" id="a-e" role="alert"></p><button class="btn primary block" id="a-b">Envoyer ma candidature</button></form>`;
  $('#a-n').oninput = (e) => { if (!$('#a-s').dataset.touched) $('#a-s').value = slugify(e.target.value); };
  $('#a-s').oninput = (e) => { e.target.dataset.touched = '1'; e.target.value = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''); };
  sb.from('profiles').select('phone').eq('id', user.id).maybeSingle().then(({ data }) => { if (data?.phone && !$('#a-p').value) $('#a-p').value = data.phone; });
  $('#ap').onsubmit = async (e) => {
    e.preventDefault(); const err = $('#a-e'); err.textContent = '';
    const v = { n: $('#a-n').value.trim(), s: $('#a-s').value.trim(), d: $('#a-d').value.trim(), p: $('#a-p').value.trim(), c: $('#a-c').value.trim() };
    if (v.n.length < 2 || !SLUG_RE.test(v.s) || v.p.length < 6) { err.textContent = 'Nom, identifiant valide (3–30 caractères) et téléphone sont obligatoires.'; return; }
    setLoading($('#a-b'), true, 'Envoi…');
    const { error } = await sb.rpc('apply_seller', { p_shop_name: v.n, p_slug: v.s, p_description: v.d || null, p_phone: v.p, p_city: v.c || null });
    setLoading($('#a-b'), false);
    if (error) { err.textContent = String(error.message).includes('duplicate') ? 'Cet identifiant de boutique est déjà pris.' : msg(error); return; }
    toast('Candidature envoyée.'); boot();
  };
}

const shell = (inner) => `<p class="muted"><strong>${esc(me.shop_name)}</strong> · ${me.status === 'approved' ? 'Boutique approuvée' : 'Boutique suspendue'}</p>
  ${me.status === 'suspended' ? '<p class="order-card" role="alert">Votre boutique est suspendue : vos produits sont retirés de la vente. Contactez-nous. Vous gardez l’accès à vos ventes et à vos soldes.</p>' : ''}
  <div class="tabs" role="tablist" style="margin:12px 0">${[['products', 'Mes produits'], ['sales', 'Ventes & reversements']].filter(([k]) => me.status === 'approved' || k === 'sales').map(([k, l]) => `<button role="tab" aria-selected="${tab === k}" data-t="${k}">${l}</button>`).join('')}</div><div id="tab">${inner}</div>`;

async function dashboard() {
  if (me.status !== 'approved') tab = 'sales';
  root.innerHTML = shell('<div class="sk-line"></div>');
  $$('[data-t]', root).forEach((b) => (b.onclick = () => { tab = b.dataset.t; dashboard(); }));
  if (tab === 'sales') return sales(); return products();
}

async function products() {
  const { data, error } = await sb.rpc('seller_my_products');
  if (error) { $('#tab').innerHTML = '<p class="muted">Impossible de charger vos produits.</p>'; return; }
  $('#tab').innerHTML = `<p><button class="btn primary" id="new">+ Nouveau produit</button></p>
  ${data.length ? data.map((p) => `<div class="order-card"><div class="row" style="gap:12px;align-items:center">${p.image ? `<img src="${esc(p.image)}" alt="" width="64" height="64" style="object-fit:cover;border-radius:8px">` : ''}<div style="flex:1"><strong>${esc(p.name)}</strong><br><span class="muted">${fmtPrice(p.price)} · ${p.variants} variante(s) · stock ${p.available}</span><br><span class="status">${p.status === 'draft' && p.submitted_at ? 'En validation' : ST[p.status] || p.status}</span></div>
  <div><button class="btn ghost sm" data-e="${esc(p.id)}">Modifier</button> ${p.status !== 'draft' || p.submitted_at ? `<button class="btn ghost sm" data-w="${esc(p.id)}">Retirer</button>` : ''}</div></div></div>`).join('') : '<p class="muted">Aucun produit. Créez le premier : il sera soumis à la validation de notre équipe.</p>'}`;
  $('#new').onclick = () => editor(null);
  $$('[data-e]').forEach((b) => (b.onclick = () => editor(b.dataset.e)));
  $$('[data-w]').forEach((b) => (b.onclick = async () => { if (!confirm('Retirer ce produit de la vente ? Il repasse en brouillon.')) return; const { error: er } = await sb.rpc('seller_withdraw_product', { p_id: b.dataset.w }); if (er) return toast(msg(er), 'err'); toast('Produit retiré.'); products(); }));
}

const vrow = (v, i) => `<div class="two b2b-var" data-i="${i}" data-id="${esc(v.id || '')}"><div class="field"><label>Variante (ex. Taille M)<input data-f="name" maxlength="200" value="${esc(v.name || '')}"></label></div>
  <div class="field"><label>Stock<input data-f="stock" type="number" min="0" step="1" value="${esc(v.stock_quantity ?? 0)}"></label></div>
  <div class="field"><label>Prix (si différent)<input data-f="price" type="number" min="0" step="0.01" value="${esc(v.price ?? '')}"></label></div>
  <div class="field"><label>SKU (facultatif)<input data-f="sku" maxlength="60" value="${esc(v.sku || '')}"></label></div></div>`;

async function editor(id) {
  let p = { name: '', description: '', price: '', sale_price: '', weight_grams: '', category_id: '', variants: [{ name: 'Standard', stock_quantity: 0 }], images: [] };
  if (id) { const { data, error } = await sb.rpc('seller_get_product', { p_id: id }); if (error) return toast(msg(error), 'err'); p = data; }
  let images = [...p.images]; const newFiles = [];
  const draw = () => {
    $('#tab').innerHTML = `<form class="form-card" id="pf" novalidate style="max-width:640px"><h2 style="font-size:1.3rem">${id ? 'Modifier le produit' : 'Nouveau produit'}</h2>
    ${id && p.status !== 'draft' ? '<p class="muted">Toute modification retire le produit de la vente jusqu’à nouvelle validation.</p>' : ''}
    <div class="field"><label for="p-n">Nom *<input id="p-n" maxlength="200" value="${esc(p.name)}"></label></div>
    <div class="field"><label for="p-d">Description<textarea id="p-d" maxlength="4000">${esc(p.description || '')}</textarea></label></div>
    <div class="two"><div class="field"><label>Catégorie<select id="p-c"><option value="">—</option>${cats.map((c) => `<option value="${esc(c.id)}" ${c.id === p.category_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label></div>
    <div class="field"><label>Poids (g)<input id="p-w" type="number" min="0" step="1" value="${esc(p.weight_grams ?? '')}"></label></div></div>
    <div class="two"><div class="field"><label>Prix (G) *<input id="p-p" type="number" min="0" step="0.01" value="${esc(p.price)}"></label></div><div class="field"><label>Prix promo<input id="p-s" type="number" min="0" step="0.01" value="${esc(p.sale_price ?? '')}"></label></div></div>
    <h3 style="margin:12px 0 6px">Variantes et stock</h3><div id="vs">${p.variants.map(vrow).join('')}</div><button type="button" class="btn ghost sm" id="addv">+ Variante</button>
    <h3 style="margin:14px 0 6px">Images (JPG, PNG, WebP — 5 Mo — 8 max)</h3>
    <div class="row" style="flex-wrap:wrap;gap:8px">${images.map((im, i) => `<span><img src="${esc(im.url)}" alt="" width="72" height="72" style="object-fit:cover;border-radius:8px"><br><button type="button" class="btn ghost sm" data-ri="${i}">Retirer</button></span>`).join('')}${newFiles.map((f, i) => `<span class="muted">${esc(f.name)} <button type="button" class="btn ghost sm" data-rn="${i}">Retirer</button></span>`).join('')}</div>
    <input id="p-f" type="file" accept="image/jpeg,image/png,image/webp" multiple>
    <p class="err-msg" id="p-e" role="alert"></p>
    <div class="row" style="gap:8px;flex-wrap:wrap"><button class="btn ghost" id="p-save" type="submit">Enregistrer le brouillon</button><button class="btn primary" id="p-sub" type="button">Enregistrer et soumettre</button><button class="btn ghost" id="p-x" type="button">Annuler</button></div></form>`;
    $('#addv').onclick = () => { p.variants = readVariants(); p.variants.push({ name: '', stock_quantity: 0 }); keepDraw(); };
    $$('[data-ri]').forEach((b) => (b.onclick = () => { images.splice(Number(b.dataset.ri), 1); keepDraw(); }));
    $$('[data-rn]').forEach((b) => (b.onclick = () => { newFiles.splice(Number(b.dataset.rn), 1); keepDraw(); }));
    $('#p-f').onchange = async (e) => {
      for (const f of e.target.files) { if (images.length + newFiles.length >= 8) break; const chk = await checkFile(f, { types: ['image/jpeg', 'image/png', 'image/webp'], maxMB: 5 }); if (chk.error) { toast(`${f.name} : ${chk.error}`, 'err'); continue; } f._mime = chk.mime; newFiles.push(f); }
      keepDraw();
    };
    cameraButton($('#p-f'), async (f) => { const chk = await checkFile(f, { types: ['image/jpeg', 'image/png', 'image/webp'], maxMB: 5 }); if (chk.error) return toast(chk.error, 'err'); if (images.length + newFiles.length >= 8) return; f._mime = chk.mime; newFiles.push(f); keepDraw(); });
    $('#p-x').onclick = products;
    $('#pf').onsubmit = (e) => { e.preventDefault(); save(false); };
    $('#p-sub').onclick = () => save(true);
  };
  const readVariants = () => $$('.b2b-var').map((r) => ({ id: r.dataset.id || undefined, name: $('[data-f=name]', r).value.trim(), stock_quantity: parseInt($('[data-f=stock]', r).value, 10) || 0, price: $('[data-f=price]', r).value, sale_price: '', sku: $('[data-f=sku]', r).value.trim() }));
  const keepDraw = () => { p = { ...p, name: $('#p-n').value, description: $('#p-d').value, price: $('#p-p').value, sale_price: $('#p-s').value, weight_grams: $('#p-w').value, category_id: $('#p-c').value, variants: readVariants() }; draw(); };
  async function save(submit) {
    const err = $('#p-e'); err.textContent = '';
    const prod = { id: id || undefined, name: $('#p-n').value.trim(), description: $('#p-d').value.trim(), price: $('#p-p').value, sale_price: $('#p-s').value, category_id: $('#p-c').value, weight_grams: $('#p-w').value };
    const vars = readVariants().map((v) => ({ ...v, name: v.name || 'Standard' }));
    if (prod.name.length < 2 || prod.price === '' || Number(prod.price) < 0) { err.textContent = 'Nom et prix sont obligatoires.'; return; }
    if (prod.sale_price !== '' && Number(prod.sale_price) >= Number(prod.price)) { err.textContent = 'Le prix promo doit être inférieur au prix.'; return; }
    const btn = $(submit ? '#p-sub' : '#p-save'); setLoading(btn, true, 'Enregistrement…'); const up = [];
    try {
      const urls = images.map((i) => ({ url: i.url, alt: prod.name }));
      for (const f of newFiles) { const path = `sellers/${me.id}/${randomName(f._mime)}`; const { error } = await sb.storage.from('product-images').upload(path, f, { contentType: f._mime, upsert: false }); if (error) throw error; up.push(path); urls.push({ url: sb.storage.from('product-images').getPublicUrl(path).data.publicUrl, alt: prod.name }); }
      const { data: pid, error } = await sb.rpc('seller_save_product', { p_product: prod, p_variants: vars }); if (error) throw error;
      const r2 = await sb.rpc('seller_set_images', { p_product_id: pid, p_images: urls }); if (r2.error) throw r2.error;
      if (submit) { const r3 = await sb.rpc('seller_submit_product', { p_id: pid }); if (r3.error) throw r3.error; }
      toast(submit ? 'Produit soumis à la validation.' : 'Brouillon enregistré.'); products();
    } catch (ex) { if (up.length) sb.storage.from('product-images').remove(up).catch(() => {}); err.textContent = msg(ex); setLoading(btn, false); }
  }
  draw();
}

async function sales() {
  const { data, error } = await sb.rpc('seller_sales', { p_limit: 100 });
  if (error) { $('#tab').innerHTML = '<p class="muted">Impossible de charger vos ventes.</p>'; return; }
  const s = data.summary;
  $('#tab').innerHTML = `<div class="two"><div class="order-card"><span class="muted">Ventes livrées et payées</span><br><strong>${fmtPrice(s.gross)}</strong></div><div class="order-card"><span class="muted">Commission (${esc(s.commission_percent)} %)</span><br><strong>− ${fmtPrice(s.commission)}</strong></div></div>
  <div class="two"><div class="order-card"><span class="muted">Déjà reversé</span><br><strong>${fmtPrice(s.paid_out)}</strong></div><div class="order-card" style="border-color:var(--orange,#FD7425)"><span class="muted">Solde à recevoir</span><br><strong>${fmtPrice(s.balance)}</strong></div></div>
  <p class="muted">En cours de traitement (non encore livré/payé) : ${fmtPrice(s.pending_gross)}. Les reversements sont enregistrés par notre équipe.</p>
  <h3>Lignes vendues</h3>${data.items.length ? `<div class="tbl-wrap"><table><thead><tr><th>Commande</th><th>Date</th><th>Produit</th><th>Qté</th><th>Total</th><th>Statut</th></tr></thead><tbody>${data.items.map((i) => `<tr><td>${esc(i.order_number)}</td><td>${fmtDate(i.date)}</td><td>${esc(i.name)}${i.variant && i.variant !== 'Standard' ? ` (${esc(i.variant)})` : ''}</td><td>${esc(i.quantity)}</td><td>${fmtPrice(i.line_total)}</td><td>${esc(i.order_status)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Aucune vente pour le moment.</p>'}
  <p class="muted" style="font-size:.85rem">Pour protéger la vie privée des acheteurs, leurs coordonnées ne sont jamais communiquées aux vendeurs.</p>
  ${data.payouts.length ? `<h3>Reversements reçus</h3><ul>${data.payouts.map((x) => `<li>${fmtDate(x.paid_at)} — ${fmtPrice(x.amount)}${x.method ? ' · ' + esc(x.method) : ''}${x.note ? ' · ' + esc(x.note) : ''}</li>`).join('')}</ul>` : ''}`;
}

async function boot() {
  const { data, error } = await sb.from('sellers').select('*').eq('user_id', user.id).maybeSingle();
  if (error) { root.innerHTML = '<p class="muted">Impossible de charger votre espace pour le moment.</p>'; return; }
  me = data;
  if (!me) return renderApply();
  if (me.status === 'pending') { root.innerHTML = `<div class="order-card"><h2 style="font-size:1.3rem">Candidature en cours d’examen</h2><p class="muted">Boutique « ${esc(me.shop_name)} » — envoyée le ${fmtDate(me.created_at)}. Vous serez notifié dès la décision.</p></div>`; return; }
  if (me.status === 'rejected') { root.innerHTML = `<div class="order-card"><h2 style="font-size:1.3rem">Candidature non retenue</h2><p class="muted">Contactez-nous pour en savoir plus.</p><a class="btn ghost" href="/contact">Nous contacter</a></div>`; return; }
  const { data: c } = await sb.from('categories').select('id,name').order('name'); cats = c || [];
  dashboard();
}
(async () => { if (!sb) return; user = await requireUser(); if (!user) return; boot(); })();
