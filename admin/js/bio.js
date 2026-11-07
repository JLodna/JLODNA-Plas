import { sb } from '/js/supabase.js';
import { $$, esc, fmtDate, toast, friendlyError } from '/js/utils.js';
import { table, confirmBox } from './ui.js';

export async function render(el) {
  const { data, error } = await sb.from('bio_profiles').select('id,user_id,slug,display_name,headline,is_public,is_blocked,updated_at,avatar_path,video_path').order('updated_at', { ascending: false }).limit(300);
  if (error) throw error;
  const site = (window.JL_CONFIG && window.JL_CONFIG.SITE_URL) || location.origin;
  el.innerHTML = `<h1>Profils BIO</h1><p class="muted">Modération : vous pouvez bloquer un profil (il est alors dépublié et ne peut pas être republié) ou le supprimer. Le contenu des profils ne peut pas être modifié par le personnel.</p>
  ${table(['Profil', 'Titre', 'Statut', 'Mis à jour', ''], data.map((p) => `<tr><td><strong>${esc(p.display_name)}</strong><br><span class="muted">/bio/u/${esc(p.slug)}</span></td><td>${esc(p.headline || '')}</td><td>${p.is_blocked ? 'Bloqué' : p.is_public ? 'Public' : 'Privé'}</td><td>${fmtDate(p.updated_at)}</td><td>${p.is_public ? `<a class="btn sm ghost" href="${esc(site)}/bio/u/${esc(p.slug)}" target="_blank" rel="noopener">Voir</a> ` : ''}<button class="btn sm" data-b="${esc(p.id)}" data-v="${p.is_blocked ? '0' : '1'}">${p.is_blocked ? 'Débloquer' : 'Bloquer'}</button> <button class="btn sm danger" data-d="${esc(p.id)}">Supprimer</button></td></tr>`))}`;
  $$('[data-b]', el).forEach((b) => (b.onclick = async () => {
    const { error: er } = await sb.from('bio_profiles').update({ is_blocked: b.dataset.v === '1' }).eq('id', b.dataset.b);
    if (er) return toast(friendlyError(er), 'err'); toast('Profil mis à jour.'); render(el);
  }));
  $$('[data-d]', el).forEach((b) => (b.onclick = async () => {
    if (!(await confirmBox('Supprimer définitivement ce profil BIO ?'))) return;
    const p = data.find((x) => x.id === b.dataset.d);
    const { error: er } = await sb.from('bio_profiles').delete().eq('id', b.dataset.d);
    if (er) return toast(friendlyError(er), 'err');
    const files = [p.avatar_path, p.video_path].filter(Boolean); if (files.length) sb.storage.from('bio-media').remove(files).catch(() => {});
    toast('Profil supprimé.'); render(el);
  }));
}
