'use strict';
// Envoi de notifications push via Firebase Cloud Messaging (API HTTP v1) — sans dépendance. Compte de service dans FCM_SERVICE_ACCOUNT (JSON).
const crypto = require('crypto');
let cache = { token: '', exp: 0 };
function account() { try { const a = JSON.parse(process.env.FCM_SERVICE_ACCOUNT || ''); return a.client_email && a.private_key && a.project_id ? a : null; } catch { return null; } }
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
async function accessToken(acc) {
  const now = Math.floor(Date.now() / 1000); if (cache.token && cache.exp - 60 > now) return cache.token;
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: acc.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })}`;
  const sig = crypto.createSign('RSA-SHA256').update(unsigned).sign(acc.private_key, 'base64url');
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${sig}` }), signal: AbortSignal.timeout(10000) });
  const j = await r.json().catch(() => ({})); if (!r.ok || !j.access_token) throw new Error('FCM_AUTH_FAILED');
  cache = { token: j.access_token, exp: now + (Number(j.expires_in) || 3600) }; return cache.token;
}
const safeLink = (l) => (typeof l === 'string' && l.startsWith('/') && !l.startsWith('//') && l.length <= 200 ? l : '/');
// Retourne 'ok' | 'invalid' (jeton à supprimer) | 'error'.
async function sendPush(token, { title, body, link }) {
  const acc = account(); if (!acc) throw new Error('FCM_NOT_CONFIGURED');
  const at = await accessToken(acc);
  const r = await fetch(`https://fcm.googleapis.com/v1/projects/${acc.project_id}/messages:send`, { method: 'POST', headers: { Authorization: `Bearer ${at}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(10000),
    body: JSON.stringify({ message: { token, notification: { title: String(title || 'JLODNA Plas').slice(0, 100), body: String(body || '').slice(0, 200) }, data: { link: safeLink(link) }, android: { priority: 'HIGH' } } }) });
  if (r.ok) return 'ok';
  const j = await r.json().catch(() => ({})); const st = j && j.error && j.error.status;
  return r.status === 404 || st === 'NOT_FOUND' || st === 'UNREGISTERED' || st === 'INVALID_ARGUMENT' ? 'invalid' : 'error';
}
module.exports = { sendPush, configured: () => !!account(), safeLink };
