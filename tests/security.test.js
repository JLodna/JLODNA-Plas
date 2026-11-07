'use strict';
// Tests contact (CAPTCHA + limites), suppression de compte, notifications push — FAUX Supabase / faux Cloudflare / faux Firebase.
const test = require('node:test'); const assert = require('assert'); const crypto = require('crypto');
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
Object.assign(process.env, { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'srv', SITE_URL: 'https://www.jlodna.com', TURNSTILE_SECRET: 'tsecret', PUSH_WEBHOOK_SECRET: 'whook', RATE_LIMIT_SALT: 'salt',
  FCM_SERVICE_ACCOUNT: JSON.stringify({ client_email: 'svc@proj.iam.gserviceaccount.com', private_key: privateKey, project_id: 'jlodna-proj' }) });
const UID = '22222222-2222-2222-2222-222222222222';
let calls, st;
const json = (o, status = 200) => ({ ok: status < 400, status, text: async () => (o === null ? '' : typeof o === 'string' ? o : JSON.stringify(o)), json: async () => o });
const jwt = (iat) => `h.${Buffer.from(JSON.stringify({ iat })).toString('base64url')}.s`;
global.fetch = async (url, opts = {}) => {
  url = String(url); calls.push({ url, opts });
  if (url.includes('/auth/v1/user')) return /Bearer h\./.test(opts.headers.Authorization) ? json({ id: UID }) : json({}, 401);
  if (url.includes('rpc/rate_limit_hit')) return json(st.rl.shift() ?? true);
  if (url.includes('rpc/erase_user_data')) return st.eraseErr ? json(`{"message":"${st.eraseErr}"}`, 400) : json({ seller_id: st.seller || null });
  if (url.endsWith('/rest/v1/messages')) return json(null, 201);
  if (url.includes('challenges.cloudflare.com')) return json({ success: st.captcha !== false });
  if (url.includes('/storage/v1/object/list/')) return json([{ name: 'a.png' }, { name: 'b.mp4' }]);
  if (url.includes('/storage/v1/object/') && opts.method === 'DELETE') return json({});
  if (url.includes('/auth/v1/admin/users/')) return json({}, st.authDel === false ? 500 : 200);
  if (url.includes('device_tokens?select')) return json(st.tokens.map((token) => ({ token })));
  if (url.includes('device_tokens?token=eq.')) return json(null);
  if (url.includes('oauth2.googleapis.com/token')) return json({ access_token: 'fcmtok', expires_in: 3600 });
  if (url.includes('fcm.googleapis.com')) { const t = JSON.parse(opts.body).message.token; return t === 'DEADTOKEN' ? json({ error: { status: 'UNREGISTERED' } }, 404) : json({ name: 'ok' }); }
  return json({}, 404);
};
const mkres = () => { const r = { code: 0, body: null, status(c) { r.code = c; return r; }, setHeader() { return r; }, json(b) { r.body = b; return r; }, end() { return r; } }; return r; };
const reset = (o = {}) => { calls = []; st = { rl: [], tokens: [], ...o }; };
const post = async (file, req) => { const res = mkres(); await require(file)({ method: 'POST', headers: { origin: 'https://www.jlodna.com', 'x-forwarded-for': '1.2.3.4, 9.9.9.9' }, ...req }, res); return res; };
const good = { name: 'Marie Jean', email: 'marie@test.com', subject: 'Question', body: 'Bonjour, une question.', captcha: 'tok' };

test('contact : méthode, origine, champ piège, validation', async () => {
  reset(); let r = await post('../api/contact', { method: 'GET', body: good }); assert.strictEqual(r.code, 405);
  r = await post('../api/contact', { headers: { origin: 'https://pirate.example' }, body: good }); assert.strictEqual(r.code, 403);
  r = await post('../api/contact', { body: { ...good, website: 'http://spam' } }); assert.strictEqual(r.code, 200); assert.ok(!calls.some((c) => c.url.endsWith('/messages')), 'robot : rien enregistré');
  r = await post('../api/contact', { body: { ...good, email: 'pas-un-email' } }); assert.strictEqual(r.body.error, 'INVALID_INPUT');
  r = await post('../api/contact', { body: { ...good, body: 'x'.repeat(4001) } }); assert.strictEqual(r.body.error, 'INVALID_INPUT');
});
test('contact : limitation, CAPTCHA, enregistrement', async () => {
  reset({ rl: [false] }); let r = await post('../api/contact', { body: good }); assert.strictEqual(r.code, 429); assert.ok(!calls.some((c) => c.url.includes('cloudflare')), 'limite atteinte : pas même de vérification CAPTCHA');
  reset({ captcha: false }); r = await post('../api/contact', { body: good }); assert.strictEqual(r.body.error, 'CAPTCHA_FAILED'); assert.ok(!calls.some((c) => c.url.endsWith('/messages')));
  reset({ rl: [true, false] }); r = await post('../api/contact', { body: good }); assert.strictEqual(r.code, 429); // limite par email
  const sec = process.env.TURNSTILE_SECRET; delete process.env.TURNSTILE_SECRET; reset(); r = await post('../api/contact', { body: good }); assert.strictEqual(r.code, 503); assert.strictEqual(r.body.error, 'CAPTCHA_NOT_CONFIGURED'); process.env.TURNSTILE_SECRET = sec;
  reset(); r = await post('../api/contact', { body: good }); assert.strictEqual(r.code, 200);
  const ins = calls.find((c) => c.url.endsWith('/messages')); assert.deepStrictEqual(JSON.parse(ins.opts.body), { name: 'Marie Jean', email: 'marie@test.com', subject: 'Question', body: 'Bonjour, une question.' });
  const ts = calls.find((c) => c.url.includes('cloudflare')); assert.ok(String(ts.opts.body).includes('remoteip=1.2.3.4'), 'première adresse de X-Forwarded-For');
  const keys = calls.filter((c) => c.url.includes('rate_limit_hit')).map((c) => JSON.parse(c.opts.body).p_key).join(' '); assert.ok(!keys.includes('1.2.3.4') && !keys.includes('marie@test.com'), 'ni IP ni email en clair dans les clés de limitation');
});
test('suppression de compte : connexion récente, confirmation, ordre des opérations, refus admin', async () => {
  const del = (token, body) => post('../api/account/delete', { headers: { origin: 'https://www.jlodna.com', authorization: `Bearer ${token}` }, body });
  const now = Math.floor(Date.now() / 1000);
  reset(); let r = await post('../api/account/delete', { body: { confirm: 'SUPPRIMER' } }); assert.strictEqual(r.code, 401);
  r = await del(jwt(now - 4000), { confirm: 'SUPPRIMER' }); assert.strictEqual(r.body.error, 'REAUTH_REQUIRED'); assert.ok(!calls.some((c) => c.url.includes('erase_user_data')), 'session ancienne : rien n\'est effacé');
  r = await del(jwt(now), { confirm: 'oui' }); assert.strictEqual(r.body.error, 'CONFIRMATION_REQUIRED'); assert.ok(!calls.some((c) => c.url.includes('erase_user_data')));
  reset({ rl: [false] }); r = await del(jwt(now), { confirm: 'SUPPRIMER' }); assert.strictEqual(r.code, 429);
  reset({ eraseErr: 'ADMIN_ACCOUNT' }); r = await del(jwt(now), { confirm: 'SUPPRIMER' }); assert.strictEqual(r.code, 409); assert.strictEqual(r.body.error, 'ADMIN_ACCOUNT'); assert.ok(!calls.some((c) => c.url.includes('/auth/v1/admin/users/')), 'compte admin : le compte n\'est pas supprimé');
  reset({ eraseErr: 'SELLER_RECORDS_EXIST' }); r = await del(jwt(now), { confirm: 'SUPPRIMER' }); assert.strictEqual(r.body.error, 'SELLER_RECORDS_EXIST');
  reset({ seller: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }); r = await del(jwt(now), { confirm: 'SUPPRIMER' }); assert.strictEqual(r.code, 200);
  const order = calls.map((c) => c.url).filter((u) => /erase_user_data|storage\/v1\/object\/list|auth\/v1\/admin/.test(u)).map((u) => (u.includes('erase') ? 'db' : u.includes('list') ? u.split('/list/')[1] : 'auth'));
  assert.deepStrictEqual(order, ['db', 'bio-media', 'b2b-files', 'product-images', 'auth']); // base -> fichiers -> compte
  const lst = calls.filter((c) => c.url.includes('/object/list/')).map((c) => JSON.parse(c.opts.body).prefix); assert.deepStrictEqual(lst, [UID, UID, 'sellers/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa']);
  reset({ authDel: false }); r = await del(jwt(now), { confirm: 'SUPPRIMER' }); assert.strictEqual(r.body.error, 'AUTH_DELETE_FAILED');
});
test('push : secret du webhook, jetons, nettoyage, signature Firebase', async () => {
  const hook = (secret, body) => post('../api/push/send', { headers: { 'x-webhook-secret': secret }, body });
  const ev = { type: 'INSERT', table: 'notifications', record: { user_id: UID, title: 'Commande expédiée', body: 'JLD-000042', link: '/orders' } };
  reset(); let r = await hook('mauvais', ev); assert.strictEqual(r.code, 401); r = await hook(undefined, ev); assert.strictEqual(r.code, 401);
  r = await hook('whook', { ...ev, table: 'autre' }); assert.strictEqual(r.body.ignored, true);
  r = await hook('whook', { ...ev, record: { ...ev.record, user_id: "1' or 1=1" } }); assert.strictEqual(r.body.ignored, true);
  reset({ tokens: [] }); r = await hook('whook', ev); assert.strictEqual(r.body.sent, 0);
  reset({ tokens: ['GOODTOKEN', 'DEADTOKEN'] }); r = await hook('whook', ev); assert.strictEqual(r.body.sent, 1);
  assert.ok(calls.some((c) => c.url.includes('device_tokens?token=eq.DEADTOKEN') && c.opts.method === 'DELETE'), 'jeton invalide supprimé');
  const tok = calls.find((c) => c.url.includes('oauth2.googleapis.com')); const assertion = new URLSearchParams(tok.opts.body).get('assertion'); const [h, p, s] = assertion.split('.');
  assert.ok(crypto.createVerify('RSA-SHA256').update(`${h}.${p}`).verify(publicKey, s, 'base64url'), 'assertion signée RS256 valide');
  const cl = JSON.parse(Buffer.from(p, 'base64url')); assert.strictEqual(cl.iss, 'svc@proj.iam.gserviceaccount.com'); assert.strictEqual(cl.scope, 'https://www.googleapis.com/auth/firebase.messaging');
  const msg = JSON.parse(calls.find((c) => c.url.includes('fcm.googleapis.com/v1/projects/jlodna-proj/')).opts.body).message; assert.strictEqual(msg.notification.title, 'Commande expédiée'); assert.strictEqual(msg.data.link, '/orders');
  reset({ tokens: ['GOODTOKEN'] }); await hook('whook', { ...ev, record: { ...ev.record, link: '//evil.example' } });
  assert.strictEqual(JSON.parse(calls.find((c) => c.url.includes('fcm.googleapis.com')).opts.body).message.data.link, '/', 'lien externe neutralisé');
  const acc = process.env.FCM_SERVICE_ACCOUNT; process.env.FCM_SERVICE_ACCOUNT = ''; reset({ tokens: ['GOODTOKEN'] }); r = await hook('whook', ev); assert.strictEqual(r.body.skipped, 'FCM_NOT_CONFIGURED'); process.env.FCM_SERVICE_ACCOUNT = acc;
  const ws = process.env.PUSH_WEBHOOK_SECRET; process.env.PUSH_WEBHOOK_SECRET = ''; r = await hook('', ev); assert.strictEqual(r.code, 401, 'sans secret configuré : tout est refusé'); process.env.PUSH_WEBHOOK_SECRET = ws;
});
