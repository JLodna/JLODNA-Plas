// Fonctions de l'application Android (Capacitor) : appareil photo et notifications push. Sur le web, tout est inactif (aucune erreur).
import { sb } from './supabase.js';
export const isNative = () => !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform());
const plug = (n) => (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins[n]) || null;
const TOKEN_KEY = 'jl_push_token';

// Prend une photo (caméra ou galerie) et la renvoie comme File (jpeg/png/webp), ou null si annulé.
export async function takePhoto() {
  const Cam = plug('Camera'); if (!Cam) return null;
  try {
    const p = await Cam.getPhoto({ quality: 80, width: 1600, correctOrientation: true, resultType: 'base64', source: 'PROMPT' });
    if (!p || !p.base64String) return null;
    const fmt = ['jpeg', 'png', 'webp'].includes(p.format) ? p.format : 'jpeg';
    const bin = atob(p.base64String); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new File([bytes], `photo-${Date.now()}.${fmt === 'jpeg' ? 'jpg' : fmt}`, { type: `image/${fmt}` });
  } catch { return null; } // annulé ou permission refusée
}
export function cameraButton(input, onFile) {
  if (!isNative() || !input || input.dataset.cam) return; input.dataset.cam = '1';
  const b = document.createElement('button'); b.type = 'button'; b.className = 'btn ghost sm'; b.textContent = 'Prendre une photo'; b.style.margin = '6px 0';
  b.onclick = async () => { const f = await takePhoto(); if (f) onFile(f); };
  input.after(b);
}
export function setInputFile(input, file) { const dt = new DataTransfer(); dt.items.add(file); input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true })); }

let listening = false;
function listen(P) {
  if (listening) return; listening = true;
  P.addListener('registration', async (t) => { try { await sb.rpc('register_device_token', { p_token: t.value, p_platform: 'android' }); localStorage.setItem(TOKEN_KEY, t.value); } catch { /* réessayé au prochain démarrage */ } });
  P.addListener('pushNotificationActionPerformed', (a) => { const l = a && a.notification && a.notification.data && a.notification.data.link; if (typeof l === 'string' && l.startsWith('/') && !l.startsWith('//')) location.href = l; });
}
// Au démarrage : si l'utilisateur a DÉJÀ accepté les notifications, on rafraîchit son jeton (aucune fenêtre n'est affichée).
export async function initNative() {
  if (!isNative()) return; const P = plug('PushNotifications'); if (!P || !sb) return;
  listen(P);
  try { const { data } = await sb.auth.getSession(); if (!data.session) return; const perm = await P.checkPermissions(); if (perm.receive === 'granted') await P.register(); } catch { /* ignoré */ }
}
// Appelé depuis un bouton (la permission Android 13+ ne se demande qu'à la demande de l'utilisateur).
export async function enablePush() {
  const P = plug('PushNotifications'); if (!P) throw new Error('Notifications indisponibles sur cet appareil.');
  listen(P); let perm = await P.checkPermissions(); if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') perm = await P.requestPermissions();
  if (perm.receive !== 'granted') throw new Error('Notifications refusées. Vous pouvez les autoriser dans les réglages Android.');
  await P.register();
}
export async function disablePush() {
  const t = localStorage.getItem(TOKEN_KEY); if (!t || !sb) return;
  try { await sb.rpc('unregister_device_token', { p_token: t }); } catch { /* ignoré */ } localStorage.removeItem(TOKEN_KEY);
}
export const pushEnabled = () => !!localStorage.getItem(TOKEN_KEY);
