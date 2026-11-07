// Paiement en ligne : le navigateur ne fait que DEMANDER une page de paiement. Le montant est relu en base côté serveur,
// et seul le serveur (après vérification auprès du prestataire) peut marquer la commande « payée ».
import { getSession } from './auth.js';
export const ONLINE = ['card', 'paypal', 'moncash'];
export const PAY_STATUS = { pending: 'En attente de paiement', paid: 'Payé', failed: 'Paiement échoué', refunded: 'Remboursé' };
const MSG = { AUTH_REQUIRED: 'Session expirée : reconnectez-vous.', NOT_FOUND: 'Commande introuvable.', ORDER_NOT_PAYABLE: 'Cette commande ne peut plus être payée.', NOT_AN_ONLINE_METHOD: 'Cette commande ne se paie pas en ligne.',
  PROVIDER_NOT_CONFIGURED: 'Ce mode de paiement n’est pas encore disponible. Choisissez-en un autre ou contactez-nous.', FX_NOT_CONFIGURED: 'Ce mode de paiement n’est pas encore disponible.', PROVIDER_ERROR: 'Le service de paiement ne répond pas. Réessayez dans un instant.', FORBIDDEN: 'Action refusée.' };
export async function startPayment(orderId) {
  const s = await getSession(); if (!s) throw new Error(MSG.AUTH_REQUIRED);
  let r; try { r = await fetch('/api/pay/create', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.access_token}` }, body: JSON.stringify({ order_id: orderId }) }); } catch { throw new Error('Connexion impossible. Réessayez.'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok || typeof j.url !== 'string' || !j.url.startsWith('https://')) throw new Error(MSG[j.error] || 'Paiement indisponible pour le moment.');
  location.href = j.url;
}
