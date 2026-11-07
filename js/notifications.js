import { sb } from './supabase.js';
import { getUser } from './auth.js';
import { esc, fmtDate, toast } from './utils.js';
import { subscribe } from './realtime.js';

let list = [];
const bell = () => document.getElementById('notif-root');

export async function initNotifications() {
  const root = bell(); if (!root || !sb) return;
  const u = await getUser();
  if (!u) { root.hidden = true; return; }
  root.hidden = false;
  root.innerHTML = `<button class="icon-btn" id="notif-btn" aria-label="Notifications" aria-expanded="false"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8M10 20a2 2 0 0 0 4 0"/></svg><span class="badge-count" id="notif-count" hidden>0</span></button>
  <div class="panel" id="notif-panel" hidden><div class="panel-head"><strong>Notifications</strong><button class="link" id="notif-readall">Tout marquer comme lu</button></div><ul id="notif-list"></ul></div>`;
  await load();
  root.querySelector('#notif-btn').addEventListener('click', (e) => { const p = root.querySelector('#notif-panel'); p.hidden = !p.hidden; e.currentTarget.setAttribute('aria-expanded', String(!p.hidden)); });
  document.addEventListener('click', (e) => { if (!root.contains(e.target)) root.querySelector('#notif-panel').hidden = true; });
  root.querySelector('#notif-readall').addEventListener('click', async () => { await sb.from('notifications').update({ is_read: true }).eq('user_id', u.id).eq('is_read', false); list.forEach((n) => (n.is_read = true)); render(); });
  // Temps réel : une nouvelle notification apparaît sans actualiser la page.
  subscribe(`notifs-${u.id}`, { event: '*', table: 'notifications', filter: `user_id=eq.${u.id}` }, (p) => {
    if (p.eventType === 'INSERT') { list.unshift(p.new); toast(p.new.title); try { navigator.vibrate?.(60); } catch {} }
    else if (p.eventType === 'UPDATE') list = list.map((n) => (n.id === p.new.id ? p.new : n));
    else if (p.eventType === 'DELETE') list = list.filter((n) => n.id !== p.old.id);
    render(); window.dispatchEvent(new CustomEvent('jl:notification', { detail: p }));
  });
}
async function load() {
  const { data } = await sb.from('notifications').select('*').order('created_at', { ascending: false }).limit(30);
  list = data || []; render();
}
function render() {
  const unread = list.filter((n) => !n.is_read).length;
  const c = document.getElementById('notif-count'); if (c) { c.textContent = unread > 99 ? '99+' : unread; c.hidden = !unread; }
  const ul = document.getElementById('notif-list'); if (!ul) return;
  ul.innerHTML = list.length ? list.map((n) => `<li class="${n.is_read ? '' : 'unread'}" data-id="${n.id}"><a href="${esc(n.link && n.link.startsWith('/') ? n.link : '#')}" class="n-main"><strong>${esc(n.title)}</strong><span>${esc(n.body || '')}</span><time>${fmtDate(n.created_at)}</time></a><button class="link n-del" data-del="${n.id}" aria-label="Supprimer">×</button></li>`).join('') : '<li class="muted">Aucune notification.</li>';
  ul.querySelectorAll('li[data-id] .n-main').forEach((a) => a.addEventListener('click', async () => { const id = a.parentElement.dataset.id; await sb.from('notifications').update({ is_read: true }).eq('id', id); }));
  ul.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => { await sb.from('notifications').delete().eq('id', b.dataset.del); list = list.filter((n) => n.id !== b.dataset.del); render(); }));
}
