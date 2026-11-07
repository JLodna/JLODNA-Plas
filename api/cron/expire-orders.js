'use strict';
const L = require('../_pay/lib');
// Tâche planifiée Vercel Cron : annule les commandes en ligne non payées (libère le stock). Protégée par CRON_SECRET.
module.exports = async function handler(req, res) {
  try {
    const secret = L.env('CRON_SECRET'); const h = req.headers.authorization || '';
    if (!secret || !L.safeEq(h, `Bearer ${secret}`)) return L.send(res, 401, { error: 'UNAUTHORIZED' });
    const minutes = Math.max(15, Number(L.env('UNPAID_ORDER_MINUTES')) || 60);
    const n = await L.rpc('cancel_unpaid_orders', { p_minutes: minutes });
    return L.send(res, 200, { cancelled: n });
  } catch (e) { console.error('expire-orders', e && e.message); return L.send(res, 500, { error: 'SERVER_ERROR' }); }
};
