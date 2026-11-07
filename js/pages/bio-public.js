import { sb, SITE_URL } from '../supabase.js';
import { esc, safeUrl } from '../utils.js';
import { qrCanvas, qrAvailable } from '../qr.js';
import { reportButton } from '../report.js';

const cfg = window.JL_CONFIG || {};
const root = document.getElementById('pf');
const media = (p) => `${cfg.SUPABASE_URL}/storage/v1/object/public/bio-media/${encodeURI(p)}`;
const slug = (location.pathname.match(/^\/bio\/u\/([a-z0-9-]{3,30})\/?$/i)?.[1] || new URLSearchParams(location.search).get('slug') || '').toLowerCase();
const initials = (n) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');

function notFound() {
  root.innerHTML = '<div class="pf-card"><h1>Profil introuvable</h1><p class="pf-about">Ce profil n’existe pas ou n’est pas public.</p><div class="pf-actions"><a class="btn btn-primary" href="/bio">Voir BIO JLodna Plas</a></div></div>';
}

(async () => {
  if (!sb || !/^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/.test(slug)) return notFound();
  const { data: p, error } = await sb.rpc('get_public_bio', { p_slug: slug });
  if (error || !p) return notFound();
  document.title = `${p.display_name} — BIO JLodna Plas`;
  const url = `${SITE_URL}/bio/u/${p.slug}`;
  const links = (p.links || []).map((l) => ({ label: String(l.label || ''), href: safeUrl(l.url) })).filter((l) => l.label && l.href.startsWith('https://'));
  root.innerHTML = `<div class="pf-card">
    ${p.avatar_path ? `<img class="pf-av" src="${esc(media(p.avatar_path))}" alt="Photo de ${esc(p.display_name)}" width="112" height="112" decoding="async">` : `<div class="pf-av pf-ini" aria-hidden="true">${esc(initials(p.display_name))}</div>`}
    <h1>${esc(p.display_name)}</h1>
    ${p.headline ? `<p class="pf-head">${esc(p.headline)}</p>` : ''}
    ${p.about ? `<p class="pf-about">${esc(p.about)}</p>` : ''}
    ${p.video_path ? `<video class="pf-video" controls playsinline preload="metadata" src="${esc(media(p.video_path))}">Votre navigateur ne lit pas cette vidéo.</video>` : ''}
    ${links.length ? `<ul class="pf-links">${links.map((l) => `<li><a class="btn btn-outline btn-block" href="${esc(l.href)}" target="_blank" rel="noopener noreferrer nofollow ugc">${esc(l.label)}</a></li>`).join('')}</ul>` : ''}
    <div class="pf-actions"><button class="btn btn-dark" id="share" type="button">Partager</button>${qrAvailable() ? '<button class="btn btn-outline" id="qr-btn" type="button">QR code</button>' : ''}</div>
    <div class="pf-qr" id="qr" hidden></div>
    <p class="pf-note">Profil créé avec BIO — JLodna Plas. <a href="/bio">En savoir plus</a></p></div>`;
  reportButton(root.querySelector('.pf-note'), { type: 'bio', target: p.slug });
  document.getElementById('share').onclick = async () => {
    try { if (navigator.share) await navigator.share({ title: p.display_name, url }); else { await navigator.clipboard.writeText(url); document.getElementById('share').textContent = 'Lien copié ✓'; } } catch { /* annulé */ }
  };
  const qb = document.getElementById('qr-btn');
  if (qb) qb.onclick = () => {
    const box = document.getElementById('qr');
    if (!box.hidden) { box.hidden = true; return; }
    const c = qrCanvas(url, 640); box.innerHTML = ''; box.append(c);
    const a = document.createElement('button'); a.className = 'btn btn-outline btn-sm'; a.type = 'button'; a.textContent = 'Télécharger le QR code (PNG)';
    a.onclick = () => c.toBlob((b) => { const l = document.createElement('a'); l.href = URL.createObjectURL(b); l.download = `bio-${p.slug}-qr.png`; l.click(); setTimeout(() => URL.revokeObjectURL(l.href), 2000); });
    box.append(a); box.hidden = false;
  };
})();
