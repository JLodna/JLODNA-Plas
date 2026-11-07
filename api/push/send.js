'use strict';
const L = require('../_pay/lib'); const P = require('../_push');
// POST /api/push/send — reçoit le « Database Webhook » Supabase (INSERT sur la table notifications) et envoie la notification push
// aux appareils de l'utilisateur concerné. Protégé par le secret PUSH_WEBHOOK_SECRET (en-tête x-webhook-secret).
module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'POST') return L.send(res, 405, { error: 'METHOD_NOT_ALLOWED' });
    const secret = L.env('PUSH_WEBHOOK_SECRET');
    if (!secret || !L.safeEq(String(req.headers['x-webhook-secret'] || ''), secret)) return L.send(res, 401, { error: 'UNAUTHORIZED' });
    const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const rec = b.record; if (b.type !== 'INSERT' || b.table !== 'notifications' || !rec || !/^[0-9a-f-]{36}$/i.test(rec.user_id || '')) return L.send(res, 200, { ignored: true });
    if (!P.configured()) return L.send(res, 200, { skipped: 'FCM_NOT_CONFIGURED' }); // 200 : le webhook ne doit pas réessayer
    const rows = await L.sbFetch(`device_tokens?select=token&user_id=eq.${rec.user_id}&limit=10`);
    let sent = 0;
    for (const { token } of rows || []) {
      const out = await P.sendPush(token, { title: rec.title, body: rec.body, link: rec.link });
      if (out === 'ok') sent++; else if (out === 'invalid') await L.sbFetch(`device_tokens?token=eq.${encodeURIComponent(token)}`, { method: 'DELETE' });
    }
    return L.send(res, 200, { sent });
  } catch (e) {
    if (e instanceof L.PayError) return L.send(res, e.status, { error: e.code });
    console.error('push/send', e && e.message); return L.send(res, 500, { error: 'SERVER_ERROR' });
  }
};
