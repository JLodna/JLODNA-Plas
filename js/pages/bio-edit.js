import { sb, SITE_URL } from '../supabase.js';
import { requireUser } from '../auth.js';
import { esc, safeUrl, friendlyError, toast } from '../utils.js';
import { checkFile, randomName } from '../media.js';
import { qrCanvas, qrAvailable } from '../qr.js';
import { cameraButton, setInputFile } from '../native.js';

const cfg = window.JL_CONFIG || {};
const root = document.getElementById('pf');
const BUCKET = 'bio-media';
const media = (p) => `${cfg.SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${encodeURI(p)}`;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/;
let user, prof = null, links = [], newAvatar, newVideo, removeAvatar = false, removeVideo = false;

const row = (l, i) => `<div class="pf-row" data-i="${i}"><input type="text" placeholder="Nom (ex. Facebook)" maxlength="40" value="${esc(l.label)}" aria-label="Nom du lien ${i + 1}" data-f="label"><input type="url" placeholder="https://…" maxlength="500" value="${esc(l.url)}" aria-label="Adresse du lien ${i + 1}" data-f="url"><button type="button" class="btn btn-outline btn-sm" data-del="${i}" aria-label="Supprimer le lien ${i + 1}">Retirer</button></div>`;

function draw() {
  const exists = !!prof;
  const url = exists ? `${SITE_URL}/bio/u/${prof.slug}` : '';
  root.innerHTML = `<h1 style="font-size:1.7rem">${exists ? 'Mon BIO' : 'Créer mon BIO'}</h1>
  <p class="pf-hint" style="margin-bottom:14px">Votre profil numérique : présentation, liens, vidéo et QR code à partager. Il reste <strong>privé</strong> tant que vous ne le publiez pas.</p>
  ${prof?.is_blocked ? '<div class="pf-banner" role="alert">Votre BIO a été suspendu par la modération. Contactez-nous pour en savoir plus.</div>' : ''}
  <form class="pf-form" id="f" novalidate>
    <label for="dn">Nom affiché *</label><input id="dn" type="text" maxlength="80" required value="${esc(prof?.display_name)}">
    <label for="sl">Identifiant du lien * <span class="pf-hint">(3 à 30 : minuscules, chiffres, tirets)</span></label><input id="sl" type="text" maxlength="30" required value="${esc(prof?.slug)}" autocapitalize="none" spellcheck="false">
    <p class="pf-hint">Votre adresse : ${esc(SITE_URL)}/bio/u/<strong id="slp">${esc(prof?.slug || '…')}</strong></p>
    <label for="hl">Titre / métier</label><input id="hl" type="text" maxlength="120" value="${esc(prof?.headline)}">
    <label for="ab">Présentation</label><textarea id="ab" maxlength="1000">${esc(prof?.about)}</textarea>
    <label for="av">Photo (JPG, PNG, WebP — 3 Mo max)</label>
    ${prof?.avatar_path && !removeAvatar ? `<img class="pf-av" style="margin:6px 0" src="${esc(media(prof.avatar_path))}" alt="Photo actuelle" width="112" height="112"> <button type="button" class="btn btn-outline btn-sm" id="rm-av">Retirer la photo</button>` : ''}
    <input id="av" type="file" accept="image/jpeg,image/png,image/webp">
    <label for="vd">Vidéo de présentation (MP4 ou WebM — 25 Mo max)</label>
    ${prof?.video_path && !removeVideo ? `<video class="pf-video" controls playsinline preload="metadata" src="${esc(media(prof.video_path))}"></video> <button type="button" class="btn btn-outline btn-sm" id="rm-vd">Retirer la vidéo</button>` : ''}
    <input id="vd" type="file" accept="video/mp4,video/webm">
    <label>Mes liens (réseaux sociaux, WhatsApp, site…)</label><div id="lk">${links.map(row).join('')}</div>
    <button type="button" class="btn btn-outline btn-sm" id="add-lk" ${links.length >= 12 ? 'disabled' : ''}>+ Ajouter un lien</button>
    <p class="pf-hint">Adresses complètes en https:// uniquement (WhatsApp : https://wa.me/509…). 12 liens maximum.</p>
    <label class="pf-check"><input type="checkbox" id="pub" ${prof?.is_public ? 'checked' : ''} ${prof?.is_blocked ? 'disabled' : ''}><span>Rendre mon BIO public — visible par toute personne qui a le lien.<br><span class="pf-hint" style="font-weight:400">Seul le contenu saisi ici est affiché. Votre email, téléphone, adresses et commandes ne sont jamais montrés.</span></span></label>
    <p class="pf-err" id="err" role="alert"></p>
    <div class="pf-actions" style="justify-content:flex-start"><button class="btn btn-primary" id="save" type="submit">Enregistrer</button><a class="btn btn-outline" href="/account">Retour au compte</a></div>
  </form>
  ${exists ? `<div class="pf-box"><strong>Partager mon BIO</strong>
    <p class="pf-hint">${prof.is_public ? 'Votre BIO est public.' : 'Votre BIO est privé : le lien ne fonctionnera qu’après publication.'}</p>
    <p style="overflow-wrap:anywhere;margin:6px 0"><a href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a></p>
    <div class="pf-actions" style="justify-content:flex-start"><button class="btn btn-dark btn-sm" id="copy" type="button">Copier le lien</button><button class="btn btn-outline btn-sm" id="share" type="button">Partager</button>${qrAvailable() ? '<button class="btn btn-outline btn-sm" id="qr-btn" type="button">QR code</button>' : ''}</div>
    <div class="pf-qr" id="qr" hidden></div></div>
    <div class="pf-box"><strong>Supprimer mon BIO</strong><p class="pf-hint">Efface définitivement votre profil, vos liens, votre photo et votre vidéo.</p><button class="btn btn-outline btn-sm" id="del" type="button" style="margin-top:8px">Supprimer mon BIO</button></div>` : ''}`;
  bind();
}

function readLinks() { return [...root.querySelectorAll('.pf-row')].map((r) => ({ label: r.querySelector('[data-f=label]').value.trim(), url: r.querySelector('[data-f=url]').value.trim() })); }

function bind() {
  const $ = (s) => root.querySelector(s);
  cameraButton($('#av'), (f) => setInputFile($('#av'), f));
  $('#sl').oninput = (e) => { e.target.value = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''); $('#slp').textContent = e.target.value || '…'; };
  $('#add-lk').onclick = () => { links = readLinks(); if (links.length < 12) links.push({ label: '', url: '' }); keep(); };
  root.querySelectorAll('[data-del]').forEach((b) => (b.onclick = () => { links = readLinks(); links.splice(Number(b.dataset.del), 1); keep(); }));
  $('#rm-av') && ($('#rm-av').onclick = () => { removeAvatar = true; keep(); });
  $('#rm-vd') && ($('#rm-vd').onclick = () => { removeVideo = true; keep(); });
  $('#f').onsubmit = save;
  if (prof) {
    const url = `${SITE_URL}/bio/u/${prof.slug}`;
    $('#copy').onclick = async () => { try { await navigator.clipboard.writeText(url); toast('Lien copié.'); } catch { toast('Copie impossible.', 'err'); } };
    $('#share').onclick = async () => { try { if (navigator.share) await navigator.share({ title: prof.display_name, url }); else { await navigator.clipboard.writeText(url); toast('Lien copié.'); } } catch { /* annulé */ } };
    const qb = $('#qr-btn');
    if (qb) qb.onclick = () => {
      const box = $('#qr'); if (!box.hidden) { box.hidden = true; return; }
      const c = qrCanvas(url, 640); box.innerHTML = ''; box.append(c);
      const a = document.createElement('button'); a.className = 'btn btn-outline btn-sm'; a.type = 'button'; a.textContent = 'Télécharger le QR code (PNG)';
      a.onclick = () => c.toBlob((b) => { const l = document.createElement('a'); l.href = URL.createObjectURL(b); l.download = `bio-${prof.slug}-qr.png`; l.click(); setTimeout(() => URL.revokeObjectURL(l.href), 2000); });
      box.append(a); box.hidden = false;
    };
    $('#del').onclick = remove;
  }
}
// Redessine en conservant la saisie en cours.
function keep() {
  const v = { dn: root.querySelector('#dn').value, sl: root.querySelector('#sl').value, hl: root.querySelector('#hl').value, ab: root.querySelector('#ab').value, pub: root.querySelector('#pub').checked };
  const keepFiles = { av: root.querySelector('#av').files, vd: root.querySelector('#vd').files };
  draw();
  root.querySelector('#dn').value = v.dn; root.querySelector('#sl').value = v.sl; root.querySelector('#slp').textContent = v.sl || '…'; root.querySelector('#hl').value = v.hl; root.querySelector('#ab').value = v.ab; root.querySelector('#pub').checked = v.pub;
  try { root.querySelector('#av').files = keepFiles.av; root.querySelector('#vd').files = keepFiles.vd; } catch { /* ignoré */ }
}

async function upload(file, types, maxMB) {
  const chk = await checkFile(file, { types, maxMB });
  if (chk.error) throw new Error('UPLOAD:' + chk.error);
  const path = `${user.id}/${randomName(chk.mime)}`;
  const { error } = await sb.storage.from(BUCKET).upload(path, file, { contentType: chk.mime, upsert: false });
  if (error) throw error;
  return path;
}

async function save(e) {
  e.preventDefault();
  const err = root.querySelector('#err'); err.textContent = '';
  const btn = root.querySelector('#save');
  const v = { display_name: root.querySelector('#dn').value.trim(), slug: root.querySelector('#sl').value.trim().toLowerCase(), headline: root.querySelector('#hl').value.trim() || null, about: root.querySelector('#ab').value.trim() || null, is_public: root.querySelector('#pub').checked };
  const ls = readLinks().filter((l) => l.label || l.url);
  if (v.display_name.length < 2) { err.textContent = 'Indiquez votre nom (2 caractères minimum).'; return; }
  if (!SLUG_RE.test(v.slug)) { err.textContent = 'Identifiant invalide (3 à 30 caractères : minuscules, chiffres, tirets).'; return; }
  for (const l of ls) { if (!l.label || !safeUrl(l.url).startsWith('https://') || !l.url.startsWith('https://')) { err.textContent = 'Chaque lien doit avoir un nom et une adresse commençant par https://'; return; } }
  btn.disabled = true; btn.textContent = 'Enregistrement…';
  const uploaded = [];
  try {
    const af = root.querySelector('#av').files[0], vf = root.querySelector('#vd').files[0];
    let avatar_path = removeAvatar ? null : prof?.avatar_path || null, video_path = removeVideo ? null : prof?.video_path || null;
    if (af) { avatar_path = await upload(af, ['image/jpeg', 'image/png', 'image/webp'], 3); uploaded.push(avatar_path); }
    if (vf) { video_path = await upload(vf, ['video/mp4', 'video/webm'], 25); uploaded.push(video_path); }
    const payload = { ...v, links: ls, avatar_path, video_path };
    const q = prof ? sb.from('bio_profiles').update(payload).eq('user_id', user.id) : sb.from('bio_profiles').insert({ ...payload, user_id: user.id });
    const { data, error } = await q.select().single();
    if (error) throw error;
    const old = [prof?.avatar_path !== avatar_path ? prof?.avatar_path : null, prof?.video_path !== video_path ? prof?.video_path : null].filter(Boolean);
    if (old.length) sb.storage.from(BUCKET).remove(old).catch(() => {});
    prof = data; links = data.links || []; removeAvatar = removeVideo = false;
    toast('BIO enregistré.'); draw();
  } catch (ex) {
    if (uploaded.length) sb.storage.from(BUCKET).remove(uploaded).catch(() => {});
    err.textContent = String(ex?.message || '').startsWith('UPLOAD:') ? ex.message.slice(7) : friendlyError(ex);
    btn.disabled = false; btn.textContent = 'Enregistrer';
  }
}

async function remove() {
  if (!confirm('Supprimer définitivement votre BIO (profil, photo, vidéo) ?')) return;
  const files = [prof.avatar_path, prof.video_path].filter(Boolean);
  const { error } = await sb.from('bio_profiles').delete().eq('user_id', user.id);
  if (error) return toast(friendlyError(error), 'err');
  if (files.length) sb.storage.from(BUCKET).remove(files).catch(() => {});
  prof = null; links = []; toast('BIO supprimé.'); draw();
}

(async () => {
  if (!sb) { root.innerHTML = '<p>Configuration manquante.</p>'; return; }
  user = await requireUser();
  if (!user) return;
  const { data, error } = await sb.from('bio_profiles').select('*').eq('user_id', user.id).maybeSingle();
  if (error) { root.innerHTML = '<p>Impossible de charger votre BIO pour le moment.</p>'; return; }
  prof = data; links = data?.links || [];
  draw();
})();
