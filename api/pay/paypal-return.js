'use strict';
const L = require('../_pay/lib');
// GET /api/pay/paypal-return?order=<uuid>&token=<id PayPal> — retour du client : la commande PayPal est relue chez PayPal (jamais crue sur parole).
module.exports = async function handler(req, res) {
  const q = req.query || {}; const site = L.SITE();
  try {
    const order = await L.orderById(q.order);
    if (!order || order.payment_method !== 'paypal') return L.redirect(res, `${site}/orders?failed=1`);
    if (order.payment_status === 'paid') return L.redirect(res, `${site}/orders?paid=1`);
    const pp = await L.paypalFetchOrder(q.token);
    const unit = pp.purchase_units && pp.purchase_units[0]; const cap = unit && unit.payments && unit.payments.captures && unit.payments.captures[0];
    const ok = pp.status === 'COMPLETED' && cap && cap.status === 'COMPLETED' && unit.custom_id === order.id
      && cap.amount && cap.amount.currency_code === 'USD' && Math.round(Number(cap.amount.value) * 100) >= L.usdCents(order.total);
    if (!ok) { console.error('paypal verification failed', order.order_number); return L.redirect(res, `${site}/orders?failed=1`); }
    await L.rpc('confirm_payment', { p_order_id: order.id, p_method: 'paypal', p_provider_ref: String(cap.id) });
    return L.redirect(res, `${site}/orders?paid=1`);
  } catch (e) { console.error('paypal-return', e && e.message); return L.redirect(res, `${site}/orders?failed=1`); }
};
