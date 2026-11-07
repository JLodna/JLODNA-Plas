'use strict';
const L = require('../_pay/lib');
// POST /api/pay/stripe-webhook — signature Stripe OBLIGATOIRE ; montant et devise revérifiés avec la commande en base.
module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'POST') return L.send(res, 405, { error: 'METHOD_NOT_ALLOWED' });
    const raw = await L.readRaw(req);
    if (!L.verifyStripeSignature(raw, req.headers['stripe-signature'], L.env('STRIPE_WEBHOOK_SECRET'))) return L.send(res, 400, { error: 'BAD_SIGNATURE' });
    const ev = JSON.parse(raw); const s = ev && ev.data && ev.data.object;
    if (!s) return L.send(res, 200, { ignored: 'NO_OBJECT' });
    const orderId = (s.metadata && s.metadata.order_id) || s.client_reference_id;
    if (ev.type === 'checkout.session.completed' || ev.type === 'checkout.session.async_payment_succeeded') {
      if (s.payment_status !== 'paid') return L.send(res, 200, { ignored: 'NOT_PAID_YET' });
      const order = await L.orderById(orderId);
      if (!order) return L.send(res, 200, { ignored: 'UNKNOWN_ORDER' });
      if (String(s.currency).toLowerCase() !== 'usd' || Number(s.amount_total) < L.usdCents(order.total)) { console.error('stripe amount mismatch', order.order_number); return L.send(res, 200, { ignored: 'AMOUNT_MISMATCH' }); }
      const out = await L.rpc('confirm_payment', { p_order_id: order.id, p_method: 'card', p_provider_ref: String(s.payment_intent || s.id) });
      return L.send(res, 200, { ok: true, result: out });
    }
    if (ev.type === 'checkout.session.async_payment_failed') { const o = await L.orderById(orderId); if (o) await L.rpc('mark_payment_failed', { p_order_id: o.id, p_method: 'card' }); }
    return L.send(res, 200, { received: true });
  } catch (e) {
    if (e instanceof L.PayError) return L.send(res, e.status === 503 ? 503 : 500, { error: e.code }); // Stripe réessaiera
    console.error('stripe-webhook', e && e.message); return L.send(res, 500, { error: 'SERVER_ERROR' });
  }
};
module.exports.config = { api: { bodyParser: false } }; // signature calculée sur le corps BRUT
