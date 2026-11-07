'use strict';
const L = require('../_pay/lib');
// GET /api/pay/moncash-return?transactionId=… — MonCash renvoie le client ici (adresse à déclarer dans le portail MonCash Business).
// La transaction est relue chez MonCash ; la commande est retrouvée par sa référence et le montant est comparé.
module.exports = async function handler(req, res) {
  const q = req.query || {}; const site = L.SITE();
  try {
    const p = await L.moncashRetrieve(q.transactionId);
    const order = p && await L.orderByNumber(String(p.reference || ''));
    if (!p || !order || order.payment_method !== 'moncash') return L.redirect(res, `${site}/orders?failed=1`);
    if (order.payment_status === 'paid') return L.redirect(res, `${site}/orders?paid=1`);
    const ok = String(p.message).toLowerCase() === 'successful' && Number(p.cost) >= Math.ceil(Number(order.total));
    if (!ok) { console.error('moncash verification failed', order.order_number); return L.redirect(res, `${site}/orders?failed=1`); }
    await L.rpc('confirm_payment', { p_order_id: order.id, p_method: 'moncash', p_provider_ref: String(p.transaction_id || q.transactionId) });
    return L.redirect(res, `${site}/orders?paid=1`);
  } catch (e) { console.error('moncash-return', e && e.message); return L.redirect(res, `${site}/orders?failed=1`); }
};
