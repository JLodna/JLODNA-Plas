'use strict';
// Tests des fonctions de paiement avec FAUX Supabase / faux prestataires (aucun appel réseau réel).
const test = require('node:test'); const assert = require('assert'); const crypto = require('crypto'); const { Readable } = require('stream');
Object.assign(process.env, { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'srv', SITE_URL: 'https://www.jlodna.com', HTG_PER_USD: '135',
  STRIPE_SECRET_KEY: 'sk_test', STRIPE_WEBHOOK_SECRET: 'whsec_test', PAYPAL_CLIENT_ID: 'pid', PAYPAL_CLIENT_SECRET: 'psec', MONCASH_CLIENT_ID: 'mid', MONCASH_CLIENT_SECRET: 'msec', CRON_SECRET: 'cronsecret' });
const L = require('../api/_pay/lib');
const OID = '11111111-1111-1111-1111-111111111111', UID = '22222222-2222-2222-2222-222222222222';
const ORDER = { id: OID, order_number: 'JLD-000042', user_id: UID, status: 'new', payment_method: 'card', payment_status: 'pending', total: 2700, email: 'c@test.com', currency: 'HTG' };
let order, calls;
const json = (o, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(o), json: async () => o });
global.fetch = async (url, opts = {}) => {
  url = String(url); calls.push({ url, opts });
  if (url.includes('/auth/v1/user')) return (opts.headers.Authorization === 'Bearer goodtoken') ? json({ id: UID }) : json({}, 401);
  if (url.includes('/rest/v1/orders')) { const m = url.match(/id=eq\.([^&]+)/); const n = url.match(/order_number=eq\.([^&]+)/); return json(order && ((m && m[1] === order.id) || (n && decodeURIComponent(n[1]) === order.order_number)) ? [order] : []); }
  if (url.includes('/rest/v1/rpc/rate_limit_hit')) return json(global.__rl !== false);
  if (url.includes('/rest/v1/rpc/')) return json('paid');
  if (url.includes('api.stripe.com/v1/checkout/sessions')) return json({ url: 'https://checkout.stripe.com/pay/cs_1' });
  if (url.includes('/v1/oauth2/token')) return json({ access_token: 'pptok' });
  if (url.endsWith('/v2/checkout/orders')) return json({ links: [{ rel: 'approve', href: 'https://paypal.test/approve' }] });
  if (/\/v2\/checkout\/orders\/[A-Z0-9]+\/capture/.test(url)) return json(global.__pp);
  if (/\/v2\/checkout\/orders\/[A-Z0-9]+$/.test(url)) return json(global.__pp);
  if (url.includes('/Api/oauth/token')) return json({ access_token: 'mctok' });
  if (url.includes('/Api/v1/CreatePayment')) return json({ payment_token: { token: 'MCTOKEN' } });
  if (url.includes('/Api/v1/RetrieveTransactionPayment')) return json({ payment: global.__mc });
  return json({}, 404);
};
const mkres = () => { const r = { code: 0, headers: {}, body: null, ended: false, status(c) { r.code = c; return r; }, setHeader(k, v) { r.headers[k] = v; return r; }, json(b) { r.body = b; return r; }, end() { r.ended = true; return r; } }; return r; };
const rpcCalls = () => calls.filter((c) => c.url.includes('/rpc/') && !c.url.includes('rate_limit_hit')).map((c) => ({ name: c.url.split('/rpc/')[1], body: JSON.parse(c.opts.body) }));
const reset = () => { calls = []; order = { ...ORDER }; global.__rl = true; };
test('create : limitation de requêtes par client (429)', async () => {
  const create = require('../api/pay/create'); reset(); global.__rl = false;
  const res = mkres(); await create({ method: 'POST', headers: { origin: 'https://www.jlodna.com', authorization: 'Bearer goodtoken' }, body: { order_id: OID } }, res);
  assert.strictEqual(res.code, 429); assert.strictEqual(res.body.error, 'RATE_LIMITED'); assert.ok(!calls.some((c) => c.url.includes('api.stripe.com')), 'aucun appel au prestataire');
});

test('conversion HTG -> USD : arrondi supérieur, refus sans taux', () => {
  assert.strictEqual(L.usdCents(2700), 2000); assert.strictEqual(L.usdCents(2701), 2001); assert.strictEqual(L.usdString(2001), '20.01');
  const r = process.env.HTG_PER_USD; delete process.env.HTG_PER_USD; assert.throws(() => L.usdCents(100), /FX_NOT_CONFIGURED/); process.env.HTG_PER_USD = r;
});
test('signature Stripe : valide, falsifiée, expirée, absente', () => {
  const raw = '{"a":1}', t = Math.floor(Date.now() / 1000); const sig = crypto.createHmac('sha256', 'whsec_test').update(`${t}.${raw}`).digest('hex');
  assert.ok(L.verifyStripeSignature(raw, `t=${t},v1=${sig}`, 'whsec_test'));
  assert.ok(!L.verifyStripeSignature(raw + ' ', `t=${t},v1=${sig}`, 'whsec_test'));
  assert.ok(!L.verifyStripeSignature(raw, `t=${t - 4000},v1=${sig}`, 'whsec_test'));
  assert.ok(!L.verifyStripeSignature(raw, `t=${t},v1=${sig}`, 'autre_secret'));
  assert.ok(!L.verifyStripeSignature(raw, '', 'whsec_test'));
});
test('create : authentification, propriétaire, mode, statut, montant relu en base', async () => {
  const create = require('../api/pay/create'); reset();
  const run = async (headers, body, method = 'POST') => { const res = mkres(); await create({ method, headers: { origin: 'https://www.jlodna.com', ...headers }, body }, res); return res; };
  assert.strictEqual((await run({}, { order_id: OID })).code, 401);
  assert.strictEqual((await run({ authorization: 'Bearer mauvais' }, { order_id: OID })).code, 401);
  assert.strictEqual((await run({ authorization: 'Bearer goodtoken' }, { order_id: OID }, 'GET')).code, 405);
  order.user_id = '99999999-9999-9999-9999-999999999999';
  assert.strictEqual((await run({ authorization: 'Bearer goodtoken' }, { order_id: OID })).code, 404); // pas la commande de ce client
  reset(); order.payment_method = 'cod';
  assert.strictEqual((await run({ authorization: 'Bearer goodtoken' }, { order_id: OID })).body.error, 'NOT_AN_ONLINE_METHOD');
  reset(); order.payment_status = 'paid';
  assert.strictEqual((await run({ authorization: 'Bearer goodtoken' }, { order_id: OID })).code, 409);
  reset(); const ok = await run({ authorization: 'Bearer goodtoken' }, { order_id: OID, amount: 1 }); // « amount » du client ignoré
  assert.strictEqual(ok.code, 200); assert.ok(ok.body.url.startsWith('https://checkout.stripe.com/'));
  const st = calls.find((c) => c.url.includes('api.stripe.com')); assert.ok(String(st.opts.body).includes('unit_amount%5D=2000'), 'montant 2700 G / 135 = 20,00 USD');
  const bad = await run({ authorization: 'Bearer goodtoken', origin: 'https://pirate.example' }, { order_id: OID }); assert.strictEqual(bad.code, 403);
  reset(); order.payment_method = 'paypal'; assert.strictEqual((await run({ authorization: 'Bearer goodtoken' }, { order_id: OID })).body.url, 'https://paypal.test/approve');
  reset(); order.payment_method = 'moncash'; assert.ok((await run({ authorization: 'Bearer goodtoken' }, { order_id: OID })).body.url.includes('Moncash-middleware/Payment/Redirect?token=MCTOKEN'));
  const mc = calls.find((c) => c.url.includes('CreatePayment')); assert.deepStrictEqual(JSON.parse(mc.opts.body), { amount: 2700, orderId: 'JLD-000042' });
});
const stripeEvent = (over = {}) => { const ev = { type: 'checkout.session.completed', data: { object: { id: 'cs_1', payment_intent: 'pi_123', payment_status: 'paid', currency: 'usd', amount_total: 2000, metadata: { order_id: OID }, ...over } } }; const raw = JSON.stringify(ev); const t = Math.floor(Date.now() / 1000);
  return { raw, sig: `t=${t},v1=${crypto.createHmac('sha256', 'whsec_test').update(`${t}.${raw}`).digest('hex')}` }; };
const hook = async (raw, sig) => { const wh = require('../api/pay/stripe-webhook'); const res = mkres(); const req = Readable.from([Buffer.from(raw)]); req.method = 'POST'; req.headers = { 'stripe-signature': sig }; await wh(req, res); return res; };
test('webhook Stripe : signature, montant, devise, idempotence', async () => {
  reset(); let e = stripeEvent(); let r = await hook(e.raw, 'v1=faux'); assert.strictEqual(r.code, 400); assert.strictEqual(rpcCalls().length, 0);
  reset(); e = stripeEvent(); r = await hook(e.raw, e.sig); assert.strictEqual(r.code, 200); assert.deepStrictEqual(rpcCalls(), [{ name: 'confirm_payment', body: { p_order_id: OID, p_method: 'card', p_provider_ref: 'pi_123' } }]);
  reset(); e = stripeEvent({ amount_total: 100 }); r = await hook(e.raw, e.sig); assert.strictEqual(r.body.ignored, 'AMOUNT_MISMATCH'); assert.strictEqual(rpcCalls().length, 0);
  reset(); e = stripeEvent({ currency: 'htg', amount_total: 2700 }); r = await hook(e.raw, e.sig); assert.strictEqual(r.body.ignored, 'AMOUNT_MISMATCH');
  reset(); e = stripeEvent({ payment_status: 'unpaid' }); r = await hook(e.raw, e.sig); assert.strictEqual(r.body.ignored, 'NOT_PAID_YET'); assert.strictEqual(rpcCalls().length, 0);
  reset(); e = stripeEvent({ metadata: { order_id: '33333333-3333-3333-3333-333333333333' } }); r = await hook(e.raw, e.sig); assert.strictEqual(r.body.ignored, 'UNKNOWN_ORDER');
});
const ret = async (file, query) => { const h = require(file); const res = mkres(); await h({ query }, res); return res; };
test('retour PayPal : confirme seulement si commande, montant et capture correspondent', async () => {
  const good = { status: 'COMPLETED', purchase_units: [{ custom_id: OID, payments: { captures: [{ id: 'CAP123456', status: 'COMPLETED', amount: { currency_code: 'USD', value: '20.00' } }] } }] };
  reset(); order.payment_method = 'paypal'; global.__pp = good; let r = await ret('../api/pay/paypal-return', { order: OID, token: 'PPORDER12345' });
  assert.ok(r.headers.Location.endsWith('/orders?paid=1')); assert.deepStrictEqual(rpcCalls()[0].body, { p_order_id: OID, p_method: 'paypal', p_provider_ref: 'CAP123456' });
  reset(); order.payment_method = 'paypal'; global.__pp = { ...good, purchase_units: [{ ...good.purchase_units[0], custom_id: 'autre' }] }; r = await ret('../api/pay/paypal-return', { order: OID, token: 'PPORDER12345' });
  assert.ok(r.headers.Location.endsWith('failed=1')); assert.strictEqual(rpcCalls().length, 0);
  reset(); order.payment_method = 'paypal'; global.__pp = { ...good, purchase_units: [{ ...good.purchase_units[0], payments: { captures: [{ id: 'C1234', status: 'COMPLETED', amount: { currency_code: 'USD', value: '1.00' } }] } }] }; r = await ret('../api/pay/paypal-return', { order: OID, token: 'PPORDER12345' });
  assert.ok(r.headers.Location.endsWith('failed=1')); assert.strictEqual(rpcCalls().length, 0);
});
test('retour MonCash : relit la transaction, compare référence et montant', async () => {
  reset(); order.payment_method = 'moncash'; global.__mc = { reference: 'JLD-000042', transaction_id: '1234567890', cost: '2700', message: 'successful' };
  let r = await ret('../api/pay/moncash-return', { transactionId: '1234567890' }); assert.ok(r.headers.Location.endsWith('paid=1')); assert.strictEqual(rpcCalls()[0].body.p_provider_ref, '1234567890');
  reset(); order.payment_method = 'moncash'; global.__mc = { reference: 'JLD-000042', transaction_id: '1234567890', cost: '100', message: 'successful' };
  r = await ret('../api/pay/moncash-return', { transactionId: '1234567890' }); assert.ok(r.headers.Location.endsWith('failed=1')); assert.strictEqual(rpcCalls().length, 0);
  reset(); order.payment_method = 'moncash'; global.__mc = { reference: 'JLD-000042', transaction_id: '1234567890', cost: '2700', message: 'failed' };
  r = await ret('../api/pay/moncash-return', { transactionId: '1234567890' }); assert.strictEqual(rpcCalls().length, 0);
  r = await ret('../api/pay/moncash-return', { transactionId: "1;drop" }); assert.ok(r.headers.Location.endsWith('failed=1'));
});
test('cron : secret obligatoire', async () => {
  const cron = require('../api/cron/expire-orders'); reset();
  let res = mkres(); await cron({ headers: {} }, res); assert.strictEqual(res.code, 401);
  res = mkres(); await cron({ headers: { authorization: 'Bearer faux' } }, res); assert.strictEqual(res.code, 401); assert.strictEqual(rpcCalls().length, 0);
  res = mkres(); await cron({ headers: { authorization: 'Bearer cronsecret' } }, res); assert.strictEqual(res.code, 200); assert.strictEqual(rpcCalls()[0].name, 'cancel_unpaid_orders');
});
