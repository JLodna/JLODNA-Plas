import test from 'node:test';
import assert from 'node:assert/strict';
import * as V from '../js/variants.js';

const P = { price: 1000, sale_price: null, product_variants: [] };
const v = (o) => ({ status: 'active', sort_order: 0, available_quantity: 5, attributes: {}, price: null, sale_price: null, ...o });

test('prix effectif : hérite du produit, puis promo produit, puis prix variante, puis promo variante', () => {
  assert.equal(V.effectivePrice(P, v({})), 1000);
  assert.equal(V.effectivePrice({ ...P, sale_price: 800 }, v({})), 800);
  assert.equal(V.effectivePrice({ ...P, sale_price: 800 }, v({ price: 1200 })), 1200);
  assert.equal(V.effectivePrice(P, v({ price: 1200, sale_price: 900 })), 900);
  assert.equal(V.basePrice(P, v({ price: 1200 })), 1200);
  assert.equal(V.isOnSale(P, v({ price: 1200, sale_price: 900 })), true);
  assert.equal(V.isOnSale(P, v({})), false);
});
test('stock : somme du DISPONIBLE des variantes actives uniquement', () => {
  const p = { ...P, product_variants: [v({ available_quantity: 3 }), v({ available_quantity: 4, status: 'disabled' }), v({ available_quantity: -2 })] };
  assert.equal(V.totalAvailable(p), 3);
  assert.equal(V.availableOf(null), 0);
});
test('fourchette de prix', () => {
  const p = { ...P, product_variants: [v({ attributes: { T: 'S' }, price: 900 }), v({ attributes: { T: 'L' }, price: 1500, sale_price: 1400, sort_order: 1 })] };
  assert.deepEqual(V.priceRange(p), { min: 900, max: 1400, from: null });
  assert.deepEqual(V.priceRange({ ...P, sale_price: 700 }), { min: 700, max: 700, from: null });
  const promo = { ...P, product_variants: [v({ price: 1500, sale_price: 1000 })] };
  assert.deepEqual(V.priceRange(promo), { min: 1000, max: 1000, from: 1500 });
});
test('groupes d\'options et recherche de variante', () => {
  const vs = [v({ attributes: { Taille: 'S', Couleur: 'Noir' } }), v({ attributes: { Taille: 'S', Couleur: 'Blanc' } }), v({ attributes: { Taille: 'M', Couleur: 'Noir' } })];
  assert.deepEqual(V.optionGroups(vs), [{ name: 'Taille', options: ['S', 'M'] }, { name: 'Couleur', options: ['Noir', 'Blanc'] }]);
  assert.equal(V.findVariant(vs, { Taille: 'M', Couleur: 'Noir' }), vs[2]);
  assert.equal(V.findVariant(vs, { Taille: 'M', Couleur: 'Blanc' }), null);
  assert.equal(V.findVariant(vs, { Taille: 'M' }), null);
});
test('combinaisons (produit cartésien) et options', () => {
  assert.deepEqual(V.cartesian([]), [{}]);
  assert.deepEqual(V.cartesian([{ name: 'T', options: ['S', 'M'] }, { name: 'C', options: ['a', 'b'] }]).length, 4);
  assert.deepEqual(V.cartesian([{ name: 'T', options: ['S'] }, { name: '', options: ['x'] }, { name: 'C', options: [] }]), [{ T: 'S' }]);
  assert.deepEqual(V.parseOptions(' S, M ,S,, L'), ['S', 'M', 'L']);
  assert.equal(V.variantLabel({ T: 'M', C: 'Noir' }), 'M / Noir');
  assert.equal(V.variantLabel({}), 'Standard');
});
test('option épuisée selon la sélection courante', () => {
  const vs = [v({ attributes: { T: 'S', C: 'N' }, available_quantity: 0 }), v({ attributes: { T: 'M', C: 'N' } }), v({ attributes: { T: 'S', C: 'B' } })];
  assert.equal(V.optionAvailable(vs, 'T', 'S', { T: 'S', C: 'N' }), false);
  assert.equal(V.optionAvailable(vs, 'T', 'M', { T: 'S', C: 'N' }), true);
  assert.equal(V.optionAvailable(vs, 'T', 'S', { T: 'S', C: 'B' }), true);
});
