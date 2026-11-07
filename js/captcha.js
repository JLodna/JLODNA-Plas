// Anti-robots Cloudflare Turnstile. Clé de SITE (publique) dans VITE_TURNSTILE_SITE_KEY ; le secret reste côté serveur / Supabase.
const KEY = () => (window.JL_CONFIG && window.JL_CONFIG.TURNSTILE_SITE_KEY) || '';
let loading;
const load = () => loading || (loading = new Promise((ok, ko) => { const s = document.createElement('script'); s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'; s.async = true; s.onload = ok; s.onerror = ko; document.head.append(s); }));
export async function mountCaptcha(el) {
  if (!KEY() || !el) return { enabled: false, token: () => '', reset() {} };
  await load().catch(() => {});
  let tok = '', id;
  if (window.turnstile) id = window.turnstile.render(el, { sitekey: KEY(), callback: (t) => (tok = t), 'expired-callback': () => (tok = ''), 'error-callback': () => (tok = '') });
  return { enabled: true, token: () => tok, reset() { tok = ''; try { window.turnstile.reset(id); } catch { /* ignoré */ } } };
}
export const CAPTCHA_MSG = 'Veuillez valider le contrôle anti-robot.';
