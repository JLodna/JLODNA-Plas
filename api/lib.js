'use strict';
// Paiements en ligne — fonctions serveur (aucune dépendance npm). Clés UNIQUEMENT dans les variables d'environnement Vercel.
const crypto = require('crypto');

const env = (k) => process.env[k] || '';
const SITE = () => (env('SITE_URL') || env('VITE_SITE_URL') || 'https://www.jlodna.com').replace(/\/$/, '');
const SB_URL = () => (env('SUPABASE_URL') || env('VITE_SUPABASE_URL')).replace(/\/$/, '');
const SB_ANON = () => env('SUPABASE_ANON_KEY') || env('VITE_SUPABASE_ANON_KEY');
const METHODS = { card: 'stripe', paypal: 'paypal', moncash: 'moncash' }; // mode de paiement de la commande -> prestataire
const T = 15000;

class PayError extends Error { constructor(code, status = 400) { super(code); this.code = code; this.status = status; } }

async function sbFetch(path, opts = {}) {
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!SB_URL() || !key) throw new PayError('NOT_CONFIGURED', 503);
  const r = await fetch(`${SB_URL()}/rest/v1/${path}`, {
    method: opts.method || 'GET',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    signal: AbortSignal.timeout(T),
  });
  const t = await r.text();
  if (!r.ok) { const code = ['ADMIN_ACCOUNT', 'SELLER_RECORDS_EXIST'].find((c) => t.includes(c)); throw new PayError(code || 'DB_ERROR', code ? 409 : 502); }
  return t ? JSON.parse(t) : null;
}
const rpc = (name, body) => sbFetch(`rpc/${name}`, { method: 'POST', body });
const ORDER_COLS = 'id,order_number,user_id,status,payment_method,payment_status,total,email,currency';
async function orderById(id) {
  if (!/^[0-9a-f-]{36}$/i.test(id || '')) return null;
  const rows = await sbFetch(`orders?select=${ORDER_COLS}&id=eq.${id}`); return rows && rows[0] || null;
}
async function orderByNumber(n) {
  if (!/^JLD-\d{3,}$/.test(n || '')) return null;
  const rows = await sbFetch(`orders?select=${ORDER_COLS}&order_number=eq.${encodeURIComponent(n)}`); return rows && rows[0] || null;
}

async function verifyUser(req) {
  const h = req.headers.authorization || ''; const token = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  if (!token || token.length > 4096 || !SB_URL()) return null;
  try {
    const r = await fetch(`${SB_URL()}/auth/v1/user`, { headers: { apikey: SB_ANON(), Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) });
    if (!r.ok) return null; const u = await r.json();
    return u && /^[0-9a-f-]{36}$/i.test(u.id) ? u.id : null;
  } catch { return null; }
}

function allowedOrigin(req) {
  const o = req.headers.origin; if (!o) return true;
  const list = (env('ALLOWED_ORIGINS') || `${SITE()},https://jlodna.com`).split(',').map((s) => s.trim());
  return list.includes(o) || (env('VERCEL_ENV') !== 'production' && /^https?:\/\/localhost(:\d+)?$/.test(o));
}

// HTG -> USD (Stripe et PayPal n'encaissent pas en gourdes). Taux = variable HTG_PER_USD (gourdes pour 1 USD), arrondi au centime SUPÉRIEUR.
function usdCents(totalHtg) {
  const rate = Number(env('HTG_PER_USD'));
  if (!(rate > 0)) throw new PayError('FX_NOT_CONFIGURED', 503);
  return Math.max(50, Math.ceil((Number(totalHtg) / rate) * 100 - 1e-9));
}
const usdString = (cents) => (cents / 100).toFixed(2);

const safeEq = (a, b) => { const x = Buffer.from(String(a)); const y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

// ---------- Stripe ----------
async function stripeCreateSession(order) {
  const key = env('STRIPE_SECRET_KEY'); if (!key) throw new PayError('PROVIDER_NOT_CONFIGURED', 503);
  const cents = usdCents(order.total);
  const b = new URLSearchParams({
    mode: 'payment', client_reference_id: order.id, customer_email: order.email,
    success_url: `${SITE()}/orders?paid=1`, cancel_url: `${SITE()}/orders?cancelled=1`,
    'metadata[order_id]': order.id, 'payment_intent_data[metadata][order_id]': order.id,
    'line_items[0][quantity]': '1', 'line_items[0][price_data][currency]': 'usd', 'line_items[0][price_data][unit_amount]': String(cents),
    'line_items[0][price_data][product_data][name]': `Commande ${order.order_number} — JLODNA Plas`,
  });
  const r = await fetch('https://api.stripe.com/v1/checkout/sessions', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Idempotency-Key': `jlod-${order.id}-${Math.floor(Date.now() / 600000)}` }, body: b, signal: AbortSignal.timeout(T) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.url) throw new PayError('PROVIDER_ERROR', 502);
  return j.url;
}
function verifyStripeSignature(raw, header, secret, now = Date.now() / 1000, tolerance = 300) {
  if (!header || !secret) return false;
  const p = String(header).split(',').map((x) => x.split('=')); const t = (p.find((x) => x[0] === 't') || [])[1];
  const sigs = p.filter((x) => x[0] === 'v1').map((x) => x[1]); if (!t || !sigs.length || Math.abs(now - Number(t)) > tolerance) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex');
  return sigs.some((s) => safeEq(s, expected));
}

// ---------- PayPal ----------
const ppBase = () => (env('PAYPAL_ENV') === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com');
async function ppToken() {
  const id = env('PAYPAL_CLIENT_ID'), sec = env('PAYPAL_CLIENT_SECRET'); if (!id || !sec) throw new PayError('PROVIDER_NOT_CONFIGURED', 503);
  const r = await fetch(`${ppBase()}/v1/oauth2/token`, { method: 'POST', headers: { Authorization: 'Basic ' + Buffer.from(`${id}:${sec}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials', signal: AbortSignal.timeout(T) });
  const j = await r.json().catch(() => ({})); if (!r.ok || !j.access_token) throw new PayError('PROVIDER_ERROR', 502); return j.access_token;
}
async function paypalCreate(order) {
  const cents = usdCents(order.total); const tok = await ppToken();
  const r = await fetch(`${ppBase()}/v2/checkout/orders`, { method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json', 'PayPal-Request-Id': `jlod-${order.id}-${Math.floor(Date.now() / 600000)}` }, signal: AbortSignal.timeout(T),
    body: JSON.stringify({ intent: 'CAPTURE', purchase_units: [{ custom_id: order.id, description: `Commande ${order.order_number}`, amount: { currency_code: 'USD', value: usdString(cents) } }],
      application_context: { brand_name: 'JLODNA Plas', user_action: 'PAY_NOW', return_url: `${SITE()}/api/pay/paypal-return?order=${order.id}`, cancel_url: `${SITE()}/orders?cancelled=1` } }) });
  const j = await r.json().catch(() => ({}));
  const link = (j.links || []).find((l) => l.rel === 'approve' || l.rel === 'payer-action');
  if (!r.ok || !link) throw new PayError('PROVIDER_ERROR', 502); return link.href;
}
async function paypalFetchOrder(ppOrderId) {
  if (!/^[A-Z0-9]{10,30}$/i.test(ppOrderId || '')) throw new PayError('BAD_REQUEST', 400);
  const tok = await ppToken(); const h = { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' };
  let r = await fetch(`${ppBase()}/v2/checkout/orders/${ppOrderId}`, { headers: h, signal: AbortSignal.timeout(T) });
  let j = await r.json().catch(() => ({})); if (!r.ok) throw new PayError('PROVIDER_ERROR', 502);
  if (j.status === 'APPROVED') { // le client a validé : on encaisse
    r = await fetch(`${ppBase()}/v2/checkout/orders/${ppOrderId}/capture`, { method: 'POST', headers: h, signal: AbortSignal.timeout(T) });
    j = await r.json().catch(() => ({})); if (!r.ok) throw new PayError('PROVIDER_ERROR', 502);
  }
  return j;
}

// ---------- MonCash (Digicel) — implémenté d'après la documentation publique : À VALIDER avec vos identifiants sandbox ----------
const mcHost = () => (env('MONCASH_ENV') === 'live' ? 'https://moncashbutton.digicelgroup.com' : 'https://sandbox.moncashbutton.digicelgroup.com');
async function mcToken() {
  const id = env('MONCASH_CLIENT_ID'), sec = env('MONCASH_CLIENT_SECRET'); if (!id || !sec) throw new PayError('PROVIDER_NOT_CONFIGURED', 503);
  const r = await fetch(`${mcHost()}/Api/oauth/token`, { method: 'POST', headers: { Authorization: 'Basic ' + Buffer.from(`${id}:${sec}`).toString('base64'), Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'scope=read,write&grant_type=client_credentials', signal: AbortSignal.timeout(T) });
  const j = await r.json().catch(() => ({})); if (!r.ok || !j.access_token) throw new PayError('PROVIDER_ERROR', 502); return j.access_token;
}
async function moncashCreate(order) {
  const tok = await mcToken();
  const r = await fetch(`${mcHost()}/Api/v1/CreatePayment`, { method: 'POST', headers: { Authorization: `Bearer ${tok}`, Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ amount: Math.ceil(Number(order.total)), orderId: order.order_number }), signal: AbortSignal.timeout(T) });
  const j = await r.json().catch(() => ({})); const t = j && j.payment_token && j.payment_token.token;
  if (!r.ok || !t) throw new PayError('PROVIDER_ERROR', 502);
  return `${mcHost()}/Moncash-middleware/Payment/Redirect?token=${encodeURIComponent(t)}`;
}
async function moncashRetrieve(transactionId) {
  if (!/^\d{5,30}$/.test(String(transactionId || ''))) throw new PayError('BAD_REQUEST', 400);
  const tok = await mcToken();
  const r = await fetch(`${mcHost()}/Api/v1/RetrieveTransactionPayment`, { method: 'POST', headers: { Authorization: `Bearer ${tok}`, Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ transactionId: String(transactionId) }), signal: AbortSignal.timeout(T) });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new PayError('PROVIDER_ERROR', 502); return j.payment || null;
}

// ---------- Limitation de requêtes (côté base) + anti-robots ----------
const sha = (v) => crypto.createHash('sha256').update(env('RATE_LIMIT_SALT') + String(v)).digest('hex').slice(0, 32); // jamais d'IP/email en clair dans la base
const clientIp = (req) => String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || (req.socket && req.socket.remoteAddress) || 'unknown';
async function rateLimit(key, max, seconds) {
  const ok = await rpc('rate_limit_hit', { p_key: key, p_limit: max, p_window_seconds: seconds }); // échec de la base => erreur (on refuse plutôt que de laisser passer)
  if (ok !== true) throw new PayError('RATE_LIMITED', 429);
}
async function turnstileVerify(token, ip) {
  const secret = env('TURNSTILE_SECRET'); if (!secret) throw new PayError('CAPTCHA_NOT_CONFIGURED', 503);
  if (!token || String(token).length > 2048) return false;
  const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ secret, response: String(token), remoteip: ip || '' }), signal: AbortSignal.timeout(8000) });
  const j = await r.json().catch(() => ({})); return r.ok && j.success === true;
}
function jwtClaims(req) { try { const t = (req.headers.authorization || '').slice(7); return JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()); } catch { return {}; } }

function send(res, status, body) { res.status(status).setHeader('Cache-Control', 'no-store').json(body); }
function redirect(res, url) { res.setHeader('Location', url); res.setHeader('Cache-Control', 'no-store'); res.status(303).end(); }
async function readRaw(req) { const c = []; for await (const x of req) c.push(Buffer.from(x)); return Buffer.concat(c).toString('utf8'); }

module.exports = { sha, clientIp, rateLimit, turnstileVerify, jwtClaims, env, SITE, METHODS, PayError, sbFetch, rpc, orderById, orderByNumber, verifyUser, allowedOrigin, usdCents, usdString, safeEq,
  stripeCreateSession, verifyStripeSignature, paypalCreate, paypalFetchOrder, moncashCreate, moncashRetrieve, send, redirect, readRaw };
