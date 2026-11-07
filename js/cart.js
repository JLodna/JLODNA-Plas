import { sb } from './supabase.js';
import { getUser } from './auth.js';
import { toast } from './utils.js';

// Panier local (visiteurs) identifié par VARIANTE ; synchronisé avec cart_items quand le client est connecté.
// Clé v2 : l'ancien format (produit + variante JSON) est ignoré et nettoyé.
const KEY = 'jl_cart_v2';
try { localStorage.removeItem('jl_cart'); } catch {}
const read = () => { try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v.filter((i) => i && i.variant_id && i.quantity > 0) : []; } catch { return []; } };
let syncTimer;

function write(items) {
  localStorage.setItem(KEY, JSON.stringify(items));
  window.dispatchEvent(new CustomEvent('jl:cart'));
  clearTimeout(syncTimer); syncTimer = setTimeout(pushToServer, 600);
}
export const getCart = () => read();
export const cartCount = () => read().reduce((n, i) => n + i.quantity, 0);

export function addItem(variant_id, product_id, quantity = 1, max = 99) {
  const items = read(); const ex = items.find((i) => i.variant_id === variant_id);
  const next = Math.min((ex?.quantity || 0) + quantity, Math.min(max, 99));
  if (next < 1) { toast('Produit actuellement indisponible.', 'err'); return; }
  if (ex) ex.quantity = next; else items.push({ variant_id, product_id, quantity: next });
  write(items); toast('Produit ajouté au panier.');
}
export const setQty = (variant_id, quantity) => write(read().map((i) => (i.variant_id === variant_id ? { ...i, quantity: Math.max(1, Math.min(99, quantity)) } : i)));
export const removeItem = (variant_id) => write(read().filter((i) => i.variant_id !== variant_id));
export const clearCart = () => write([]);

async function pushToServer() {
  if (!sb) return; const u = await getUser(); if (!u) return;
  const items = read();
  await sb.from('cart_items').delete().eq('user_id', u.id);
  if (items.length) await sb.from('cart_items').insert(items.map((i) => ({ user_id: u.id, variant_id: i.variant_id, product_id: i.product_id, quantity: i.quantity })));
}
export async function mergeServerCart() {
  if (!sb) return; const u = await getUser(); if (!u) return;
  const { data } = await sb.from('cart_items').select('variant_id, product_id, quantity');
  if (!data?.length) return;
  const items = read();
  for (const r of data) { const ex = items.find((i) => i.variant_id === r.variant_id); if (ex) ex.quantity = Math.max(ex.quantity, r.quantity); else items.push({ variant_id: r.variant_id, product_id: r.product_id, quantity: r.quantity }); }
  localStorage.setItem(KEY, JSON.stringify(items)); window.dispatchEvent(new CustomEvent('jl:cart'));
}
