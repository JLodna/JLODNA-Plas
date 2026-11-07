// Logique pure des variantes (sans DOM ni réseau) : testée par `npm test`.
// Une variante : { id, name, attributes, price|null, sale_price|null, available_quantity, status, sort_order }.
// price/sale_price de variante à null => hérite du produit.

export const effectivePrice = (p, v) => (v ? (v.sale_price ?? v.price ?? p.sale_price ?? p.price) : (p.sale_price ?? p.price));
export const basePrice = (p, v) => v?.price ?? p.price;
export const isOnSale = (p, v) => effectivePrice(p, v) < basePrice(p, v);

export const activeVariants = (p) => [...(p.product_variants || [])].filter((v) => v.status === 'active').sort((a, b) => a.sort_order - b.sort_order);
export const availableOf = (v) => Math.max(0, v?.available_quantity ?? 0);
export const totalAvailable = (p) => activeVariants(p).reduce((n, v) => n + availableOf(v), 0);

// Fourchette de prix d'un produit (variantes actives ; à défaut prix du produit).
export function priceRange(p) {
  const vs = activeVariants(p);
  if (!vs.length) { const x = p.sale_price ?? p.price; return { min: x, max: x, from: null }; }
  const prices = vs.map((v) => effectivePrice(p, v));
  const min = Math.min(...prices); const max = Math.max(...prices);
  const cheapest = vs[prices.indexOf(min)];
  return { min, max, from: isOnSale(p, cheapest) ? basePrice(p, cheapest) : null };
}

export const variantLabel = (attrs) => Object.values(attrs || {}).join(' / ') || 'Standard';
export const isDefaultVariant = (v) => !v || Object.keys(v.attributes || {}).length === 0;

// Groupes d'options déduits des attributs : [{ name:'Taille', options:['S','M'] }] (ordre d'apparition).
export function optionGroups(variants) {
  const map = new Map();
  for (const v of variants) for (const [k, val] of Object.entries(v.attributes || {})) { if (!map.has(k)) map.set(k, []); if (!map.get(k).includes(val)) map.get(k).push(val); }
  return [...map].map(([name, options]) => ({ name, options }));
}
export const sameAttrs = (a, b) => { const ka = Object.keys(a || {}); const kb = Object.keys(b || {}); return ka.length === kb.length && ka.every((k) => (a || {})[k] === (b || {})[k]); };
export const findVariant = (variants, selection) => variants.find((v) => sameAttrs(v.attributes, selection)) || null;

// Toutes les combinaisons de groupes [{name, options:[...]}] -> [{Taille:'S', Couleur:'Noir'}, ...]
export function cartesian(groups) {
  const valid = groups.filter((g) => g.name?.trim() && g.options?.length);
  return valid.reduce((acc, g) => acc.flatMap((c) => g.options.map((o) => ({ ...c, [g.name.trim()]: o }))), [{}]);
}
export const parseOptions = (s) => [...new Set(String(s || '').split(',').map((x) => x.trim()).filter(Boolean))];

// Une option est « épuisée » si aucune variante en stock ne la porte avec le reste de la sélection courante.
export function optionAvailable(variants, groupName, value, selection) {
  return variants.some((v) => v.attributes?.[groupName] === value && availableOf(v) > 0 && Object.entries(selection).every(([k, val]) => k === groupName || v.attributes?.[k] === val));
}
