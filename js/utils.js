export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

// Protection XSS : toute donnée dynamique passe par esc() avant d'entrer dans du HTML.
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const safeUrl = (u) => { try { const x = new URL(u, location.origin); return ['http:', 'https:'].includes(x.protocol) ? x.href : ''; } catch { return ''; } };
export const fmtPrice = (n) => `${Number(n || 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} G`;
export const fmtDate = (d) => new Date(d).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
export const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export const slugify = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export const param = (k) => new URLSearchParams(location.search).get(k);
export const isEmail = (s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s || '');

export const STATUS = {
  new: 'Nouvelle', confirmed: 'Confirmée', preparing: 'En préparation', shipped: 'Expédiée',
  out_for_delivery: 'En livraison', delivered: 'Livrée', cancelled: 'Annulée',
};

export function toast(msg, type = 'ok') {
  let box = $('#toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite'); document.body.append(box); }
  const t = document.createElement('div'); t.className = `toast ${type}`; t.textContent = msg; box.append(t);
  setTimeout(() => t.remove(), 3800);
}

// Messages d'erreur compréhensibles : jamais d'erreur technique côté client.
export function friendlyError(e) {
  const m = String(e?.message || e || '');
  if (m.includes('OUT_OF_STOCK')) return `Produit actuellement indisponible : ${m.split('OUT_OF_STOCK:')[1] || ''}`.trim();
  if (m.includes('PRODUCT_UNAVAILABLE') || m.includes('VARIANT_UNAVAILABLE')) return 'Produit actuellement indisponible.';
  if (m.includes('ORDER_FINAL')) return 'Cette commande est terminée et ne peut plus être modifiée.';
  if (m.includes('INVALID_TRANSITION')) return 'Ce changement de statut n’est pas possible.';
  if (m.includes('STOCK_BELOW_RESERVED')) return 'Le stock ne peut pas être inférieur aux quantités réservées par des commandes en cours.';
  if (m.includes('VARIANT_HAS_RESERVATIONS')) return 'Suppression impossible : des commandes en cours réservent cette variante. Désactivez-la plutôt.';
  if (m.includes('NO_VARIANT')) return 'Ajoutez au moins une variante active avant de publier.';
  if (m.includes('COUPON_INVALID')) return 'Code promo invalide ou expiré.';
  if (m.includes('INVALID_SHIPPING')) return 'Veuillez vérifier vos informations de livraison.';
  if (m.includes('PAYMENT_METHOD_UNAVAILABLE')) return 'Ce mode de paiement n’est pas disponible.';
  if (m.includes('Invalid login')) return 'Email ou mot de passe incorrect.';
  if (m.includes('Email not confirmed')) return 'Veuillez confirmer votre email avant de vous connecter.';
  if (m.includes('already registered')) return 'Un compte existe déjà avec cet email.';
  if (m.includes('FORBIDDEN') || m.includes('row-level security')) return 'Action non autorisée.';
  if (m.includes('LOGIN_REQUIRED')) return 'Veuillez vous connecter pour continuer.';
  if (m.includes('RATE_LIMITED')) return 'Trop de demandes en peu de temps. Veuillez réessayer plus tard.';
  if (m.includes('INVALID_ATTACHMENT')) return 'Pièce jointe invalide. Connectez-vous pour joindre un fichier.';
  if (m.includes('BIO_LINKS_INVALID')) return 'Un lien est invalide : utilisez des adresses https:// complètes (12 liens maximum).';
  if (m.includes('BIO_MEDIA_INVALID')) return 'Fichier média invalide.';
  if (m.includes('bio_profiles_slug_check')) return 'Cet identifiant est invalide ou réservé (3 à 30 caractères : minuscules, chiffres et tirets).';
  if (m.includes('duplicate key') && m.includes('bio_profiles')) return 'Cet identifiant BIO est déjà pris. Choisissez-en un autre.';
  if (m.includes('duplicate key')) return 'Cette valeur existe déjà (slug, SKU ou code).';
  console.error(e);
  return 'Une erreur est survenue. Veuillez réessayer.';
}

export function setLoading(btn, on, label) {
  if (!btn) return;
  if (on) { btn.dataset.label = btn.textContent; btn.disabled = true; btn.classList.add('loading'); btn.textContent = label || 'Veuillez patienter…'; }
  else { btn.disabled = false; btn.classList.remove('loading'); btn.textContent = btn.dataset.label || btn.textContent; }
}

export const skeletonCards = (n = 8) => Array.from({ length: n }, () => '<div class="card sk"><div class="sk-img"></div><div class="sk-line"></div><div class="sk-line short"></div></div>').join('');
export const emptyState = (msg, cta = '') => `<div class="empty"><span class="dot"></span><p>${esc(msg)}</p>${cta}</div>`;
export const errorState = (msg = 'Une erreur est survenue. Veuillez réessayer.') => `<div class="empty err"><p>${esc(msg)}</p><button class="btn ghost" data-reload>Réessayer</button></div>`;

export async function postJSON(url, body, token) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  return r.ok;
}

// Validation de fichiers image avant envoi vers Storage.
export function validateImage(file, maxMB = 5) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return 'Format non autorisé (JPG, PNG ou WebP).';
  if (file.size > maxMB * 1024 * 1024) return `Image trop lourde (max ${maxMB} Mo).`;
  return null;
}

document.addEventListener('click', (e) => { if (e.target.closest?.('[data-reload]')) location.reload(); });
