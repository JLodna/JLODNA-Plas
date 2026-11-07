'use strict';
const L = require('../_pay/lib');
// POST /api/account/delete { confirm: "SUPPRIMER" } — suppression COMPLÈTE du compte de l'utilisateur connecté.
// Exige une connexion TOUTE RÉCENTE (moins de 5 min : le mot de passe vient d'être saisi) pour empêcher qu'une session volée efface un compte.
async function removePrefix(bucket, prefix) {
  try {
    const key = L.env('SUPABASE_SERVICE_ROLE_KEY'), base = (L.env('SUPABASE_URL') || L.env('VITE_SUPABASE_URL')).replace(/\/$/, ''), h = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
    const r = await fetch(`${base}/storage/v1/object/list/${bucket}`, { method: 'POST', headers: h, body: JSON.stringify({ prefix, limit: 1000, offset: 0 }), signal: AbortSignal.timeout(10000) });
    const items = r.ok ? await r.json() : []; const paths = (items || []).filter((i) => i && i.name).map((i) => `${prefix}/${i.name}`);
    if (paths.length) await fetch(`${base}/storage/v1/object/${bucket}`, { method: 'DELETE', headers: h, body: JSON.stringify({ prefixes: paths }), signal: AbortSignal.timeout(10000) });
  } catch (e) { console.error('account/delete storage', bucket, e && e.message); } // nettoyage au mieux : ne bloque pas l'effacement
}
module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'POST') return L.send(res, 405, { error: 'METHOD_NOT_ALLOWED' });
    if (!L.allowedOrigin(req)) return L.send(res, 403, { error: 'FORBIDDEN' });
    const uid = await L.verifyUser(req); if (!uid) return L.send(res, 401, { error: 'AUTH_REQUIRED' });
    const iat = Number(L.jwtClaims(req).iat || 0);
    if (!iat || Date.now() / 1000 - iat > 300) return L.send(res, 401, { error: 'REAUTH_REQUIRED' });
    await L.rateLimit(`delete:${uid}`, 3, 3600);
    const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    if (b.confirm !== 'SUPPRIMER') return L.send(res, 400, { error: 'CONFIRMATION_REQUIRED' });
    const out = await L.rpc('erase_user_data', { p_user: uid });           // 1) base de données (refuse admins / vendeurs avec historique AVANT toute suppression)
    await removePrefix('bio-media', uid); await removePrefix('b2b-files', uid); // 2) fichiers
    if (out && out.seller_id) await removePrefix('product-images', `sellers/${out.seller_id}`);
    const key = L.env('SUPABASE_SERVICE_ROLE_KEY'), base = (L.env('SUPABASE_URL') || L.env('VITE_SUPABASE_URL')).replace(/\/$/, '');
    const d = await fetch(`${base}/auth/v1/admin/users/${uid}`, { method: 'DELETE', headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10000) }); // 3) compte
    if (!d.ok) return L.send(res, 502, { error: 'AUTH_DELETE_FAILED' }); // les données sont déjà effacées ; l'opération est répétable
    return L.send(res, 200, { ok: true });
  } catch (e) {
    if (e instanceof L.PayError) return L.send(res, e.status, { error: e.code });
    console.error('account/delete', e && e.message); return L.send(res, 500, { error: 'SERVER_ERROR' });
  }
};
