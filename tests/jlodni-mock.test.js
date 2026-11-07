'use strict';
// Runs the real handler against FAKE Supabase + FAKE LLM servers. This does NOT test your real database or AI provider.
const http = require('http');
const assert = require('assert');

const UID = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';
const db = {
  settings: [{ key: 'assistant', value: { enabled: true, faqs: [], support: {} } }, { key: 'store', value: { name: 'JLODNA Plas', currency: 'HTG' } }, { key: 'shipping', value: { flat_fee: 250, free_over: 5000 } }, { key: 'payment_methods', value: { cod: { enabled: true, label: 'Paiement à la livraison' }, moncash: { enabled: false, label: 'MonCash' } } }],
  products: [
    { id: 'p1', name: 'Téléphone Alpha', slug: 'telephone-alpha', description: 'Un téléphone', price: 10000, sale_price: 8000, category_id: null, status: 'published', is_featured: true, sold_count: 3,
      product_images: [{ url: 'https://img.example/a.jpg', sort_order: 0 }],
      product_variants: [{ id: 'v1', name: '64Go', attributes: {}, price: null, sale_price: null, available_quantity: 3, low_stock_threshold: 5, status: 'active', sort_order: 0 }, { id: 'v2', name: '128Go', attributes: {}, price: 12000, sale_price: null, available_quantity: 0, low_stock_threshold: 5, status: 'active', sort_order: 1 }] },
    { id: 'p2', name: 'Draft secret', slug: 'draft', price: 1, status: 'draft', product_images: [], product_variants: [] },
  ],
  orders: [{ order_number: 'JL-1', user_id: UID, status: 'shipped', payment_status: 'pending', total: 8250, currency: 'HTG', created_at: 'x', city: 'PAP', department: 'Ouest', order_items: [] }, { order_number: 'JL-2', user_id: OTHER, status: 'new', total: 1, currency: 'HTG' }],
};
const rateHits = {};
const requests = [];

const fakeSb = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    requests.push(req.method + ' ' + u.pathname + u.search);
    const out = (v, s = 200) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(v)); };
    if (u.pathname === '/auth/v1/user') return req.headers.authorization === 'Bearer GOOD' ? out({ id: UID }) : out({}, 401);
    if (u.pathname === '/rest/v1/rpc/assistant_rate_check') { const k = JSON.parse(body); rateHits[k.p_key] = (rateHits[k.p_key] || 0) + 1; return out(rateHits[k.p_key] <= k.p_max); }
    if (u.pathname === '/rest/v1/settings') { const keys = (u.searchParams.get('key') || '').replace(/^(eq\.|in\.\(|\))/g, '').replace(/\)$/, '').split(','); return out(db.settings.filter((s) => keys.includes(s.key.replace('eq.', '')) || keys.includes(s.key))); }
    if (u.pathname === '/rest/v1/products') { const slug = u.searchParams.get('slug'); let r = db.products.filter((p) => p.status === 'published'); if (slug) r = r.filter((p) => 'eq.' + p.slug === slug); return out(r); }
    if (u.pathname === '/rest/v1/orders') { const uid = (u.searchParams.get('user_id') || '').replace('eq.', ''); const n = (u.searchParams.get('order_number') || '').replace('eq.', ''); return out(db.orders.filter((o) => o.user_id === uid && (!n || o.order_number === n))); }
    if (u.pathname === '/rest/v1/assistant_stats' || u.pathname === '/rest/v1/assistant_unanswered') return out(null, 201);
    return out([]);
  });
});

// Fake LLM: scripted by last user message
const fakeLlm = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const b = JSON.parse(body);
    const last = b.messages[b.messages.length - 1];
    let content;
    if (last.role === 'user' && typeof last.content === 'string') {
      if (/telef|phone/i.test(last.content)) content = [{ type: 'tool_use', id: 't1', name: 'search_products', input: { query: 'téléphone' } }];
      else if (/commande/i.test(last.content)) content = [{ type: 'tool_use', id: 't2', name: 'get_order', input: { order_number: /JL-2/.test(last.content) ? 'JL-2' : 'JL-1' } }];
      else content = [{ type: 'text', text: 'Bonjou!' }];
    } else {
      content = [{ type: 'text', text: 'RESULT:' + last.content[0].content }];
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ content }));
  });
});

function call(handler, { message, token, ip = '1.1.1.1', origin }) {
  return new Promise((resolve) => {
    const req = { method: 'POST', headers: { 'x-forwarded-for': ip, ...(token ? { authorization: 'Bearer ' + token } : {}), ...(origin ? { origin } : {}) }, body: { message, history: [] }, socket: {} };
    const res = { _h: {}, status(s) { this.s = s; return this; }, setHeader(k, v) { this._h[k] = v; return this; }, json(o) { resolve({ status: this.s, body: o }); } };
    handler(req, res);
  });
}

(async () => {
  await new Promise((r) => fakeSb.listen(0, r));
  await new Promise((r) => fakeLlm.listen(0, r));
  process.env.SUPABASE_URL = 'http://localhost:' + fakeSb.address().port;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'srk';
  process.env.SUPABASE_ANON_KEY = 'anon';
  process.env.AI_API_KEY = 'k';
  process.env.AI_MODEL = 'm';
  process.env.AI_BASE_URL = 'http://localhost:' + fakeLlm.address().port;
  const handler = require('../api/jlodni');

  let r = await call(handler, { message: 'Ki telefòn ki disponib?' });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.cards.length, 1, 'one published product only');
  assert.strictEqual(r.body.cards[0].price, 8000, 'sale price applied');
  assert.strictEqual(r.body.cards[0].available, true);
  assert.deepStrictEqual(r.body.cards[0].variants.map((v) => v.price), [8000, 12000], 'same prices as shop effectivePrice (variants.js)');
  assert.strictEqual(r.body.cards[0].variants.length, 2);
  assert.ok(!JSON.stringify(r.body).includes('Draft secret'), 'draft hidden');
  console.log('ok product search: sale price, stock flags, drafts hidden');

  r = await call(handler, { message: 'commande JL-1' });
  assert.ok(r.body.needsAuth && r.body.reply.includes('AUTH_REQUIRED'), 'unauth order -> AUTH_REQUIRED');
  console.log('ok unauthenticated order lookup refused');

  r = await call(handler, { message: 'commande JL-1', token: 'GOOD' });
  assert.ok(r.body.reply.includes('"order_number":"JL-1"') && r.body.reply.includes('Expédiée'), 'own order returned with label');
  console.log('ok authenticated customer sees own order');

  r = await call(handler, { message: 'commande JL-2', token: 'GOOD' });
  assert.ok(r.body.reply.includes('ORDER_NOT_FOUND_FOR_THIS_ACCOUNT') && !r.body.reply.includes('"total":1'), 'other customer order not exposed');
  console.log("ok other customer's order not exposed");

  r = await call(handler, { message: 'commande JL-1', token: 'BAD' });
  assert.ok(r.body.needsAuth, 'invalid token treated as anonymous');
  console.log('ok invalid token = anonymous');

  r = await call(handler, { message: 'x'.repeat(600) });
  assert.strictEqual(r.status, 400);
  r = await call(handler, { message: 'hi', origin: 'https://evil.example' });
  assert.strictEqual(r.status, 403);
  console.log('ok input validation + origin check');

  let limited = false;
  for (let i = 0; i < 15; i++) { r = await call(handler, { message: 'bonjou', ip: '9.9.9.9' }); if (r.status === 429) limited = true; }
  assert.ok(limited, 'rate limit triggers');
  console.log('ok rate limiting (against mocked limiter RPC)');

  db.settings[0].value.enabled = false;
  await new Promise((r2) => setTimeout(r2, 31000 * 0)); // cache is 30s; bypass by re-requiring
  delete require.cache[require.resolve('../api/jlodni')];
  const h2 = require('../api/jlodni');
  r = await call(h2, { message: 'bonjou', ip: '3.3.3.3' });
  assert.strictEqual(r.status, 503);
  console.log('ok assistant disabled via settings');

  console.log('\nALL MOCK TESTS PASSED (mocks only — not your real DB/AI)');
  process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
