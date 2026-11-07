'use strict';
const L = require('./_pay/lib');
// POST /api/contact — formulaire de contact : CAPTCHA (Cloudflare Turnstile) + limitation de requêtes + champ piège.
// Le navigateur n'a plus le droit d'écrire directement dans la table des messages.
module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'POST') return L.send(res, 405, { error: 'METHOD_NOT_ALLOWED' });
    if (!L.allowedOrigin(req)) return L.send(res, 403, { error: 'FORBIDDEN' });
    const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    if (b.website) return L.send(res, 200, { ok: true }); // champ piège rempli = robot : on fait semblant d'accepter
    const name = String(b.name || '').trim(), email = String(b.email || '').trim(), subject = String(b.subject || '').trim() || null, body = String(b.body || '').trim();
    if (name.length < 2 || name.length > 120 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 200 || body.length < 5 || body.length > 4000 || (subject && subject.length > 200)) return L.send(res, 400, { error: 'INVALID_INPUT' });
    const ip = L.clientIp(req);
    await L.rateLimit(`contact:ip:${L.sha(ip)}`, 5, 3600);
    if (!(await L.turnstileVerify(b.captcha, ip))) return L.send(res, 400, { error: 'CAPTCHA_FAILED' });
    await L.rateLimit(`contact:email:${L.sha(email.toLowerCase())}`, 3, 3600);
    await L.sbFetch('messages', { method: 'POST', body: { name, email, subject, body } });
    return L.send(res, 200, { ok: true });
  } catch (e) {
    if (e instanceof L.PayError) return L.send(res, e.status, { error: e.code });
    console.error('contact', e && e.message); return L.send(res, 500, { error: 'SERVER_ERROR' });
  }
};
