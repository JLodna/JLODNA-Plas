'use strict';
const L = require('../_pay/lib');
// POST /api/pay/create  { order_id }  (Authorization: Bearer <jeton Supabase>)  ->  { url } vers la page de paiement du prestataire.
// Le MONTANT n'est jamais fourni par le navigateur : il est relu en base.
module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'POST') return L.send(res, 405, { error: 'METHOD_NOT_ALLOWED' });
    if (!L.allowedOrigin(req)) return L.send(res, 403, { error: 'FORBIDDEN' });
    const uid = await L.verifyUser(req); if (!uid) return L.send(res, 401, { error: 'AUTH_REQUIRED' });
    await L.rateLimit(`pay:${uid}`, 10, 60); // 10 demandes de paiement par minute et par client
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const order = await L.orderById(body.order_id);
    if (!order || order.user_id !== uid) return L.send(res, 404, { error: 'NOT_FOUND' }); // même réponse pour « inconnue » et « pas la vôtre »
    const provider = L.METHODS[order.payment_method];
    if (!provider) return L.send(res, 400, { error: 'NOT_AN_ONLINE_METHOD' });
    if (order.status !== 'new' || !['pending', 'failed'].includes(order.payment_status)) return L.send(res, 409, { error: 'ORDER_NOT_PAYABLE' });
    const url = provider === 'stripe' ? await L.stripeCreateSession(order) : provider === 'paypal' ? await L.paypalCreate(order) : await L.moncashCreate(order);
    return L.send(res, 200, { url });
  } catch (e) {
    if (e instanceof L.PayError) return L.send(res, e.status, { error: e.code });
    console.error('pay/create', e && e.message); return L.send(res, 500, { error: 'SERVER_ERROR' });
  }
};
