'use strict';
// Approved backend functions the AI may call. No arbitrary SQL, no writes except log_unanswered.
// Uses the service-role key SERVER-SIDE only. user_id always comes from the verified JWT, never from the model.

const sbUrl = () => String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const sbKey = () => process.env.SUPABASE_SERVICE_ROLE_KEY;

async function rest(path, { method = 'GET', body, headers = {} } = {}) {
  const r = await fetch(`${sbUrl()}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: sbKey(),
      Authorization: `Bearer ${sbKey()}`,
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`DB_${r.status}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

const num = (v) => (v == null ? null : Number(v));
const clean = (s, n = 60) => String(s || '').normalize('NFKC').replace(/[^\p{L}\p{N} \-]/gu, ' ').trim().slice(0, n);
const words = (s) => clean(s, 80).split(/\s+/).filter((w) => w.length >= 2).slice(0, 5);

const productUrl = (slug) =>
  (process.env.PRODUCT_URL_TEMPLATE || 'https://www.jlodna.com/product?slug={slug}').replace('{slug}', encodeURIComponent(slug));

const STATUS_LABELS = {
  new: { fr: 'Nouvelle', ht: 'Nouvèl' },
  confirmed: { fr: 'Confirmée', ht: 'Konfime' },
  preparing: { fr: 'En préparation', ht: 'Ap prepare' },
  shipped: { fr: 'Expédiée', ht: 'Voye' },
  out_for_delivery: { fr: 'En livraison', ht: 'Ap livre' },
  delivered: { fr: 'Livrée', ht: 'Livre' },
  cancelled: { fr: 'Annulée', ht: 'Anile' },
};

// ---------- pricing / availability ----------
// IDENTIQUE à effectivePrice / basePrice / isOnSale de js/variants.js de la boutique, pour afficher les mêmes prix.
function variantPricing(p, v) {
  const base = num(v.price) ?? num(p.price);
  const eff = num(v.sale_price) ?? num(v.price) ?? num(p.sale_price) ?? num(p.price);
  return { price: eff, original: eff < base ? base : null };
}

function stockLabel(v) {
  const q = v.available_quantity ?? 0;
  if (q <= 0) return 'out_of_stock';
  return q <= (v.low_stock_threshold ?? 5) ? 'low_stock' : 'in_stock';
}

function shapeProduct(p, { full = false } = {}) {
  const variants = (p.product_variants || [])
    .filter((v) => v.status === 'active')
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
    .map((v) => {
      const pr = variantPricing(p, v);
      return {
        id: v.id,
        name: v.name,
        attributes: v.attributes || {},
        price: pr.price,
        original_price: pr.original,
        stock: stockLabel(v),
        available: (v.available_quantity ?? 0) > 0,
        qty: Math.max(v.available_quantity ?? 0, 0),
      };
    });
  const images = (p.product_images || []).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  const prices = variants.map((v) => v.price);
  const fallback = num(p.sale_price) ?? num(p.price);
  const out = {
    id: p.id,
    slug: p.slug,
    name: p.name,
    price_from: prices.length ? Math.min(...prices) : fallback,
    available: variants.some((v) => v.available),
    url: productUrl(p.slug),
    image: images[0] ? images[0].url : null,
    variants,
  };
  if (full) out.description = String(p.description || '').slice(0, 1200);
  return out;
}

const toCard = (s) => ({
  id: s.id,
  slug: s.slug,
  name: s.name,
  image: s.image,
  price: s.price_from,
  currency: 'HTG',
  available: s.available,
  url: s.url,
  variants: s.variants.slice(0, 8).map((v) => ({ id: v.id, name: v.name, price: v.price, available: v.available, max: Math.min(v.qty, 99) })),
});

const PRODUCT_SELECT =
  'id,name,slug,description,price,sale_price,category_id,is_featured,sold_count,' +
  'product_images(url,alt,sort_order),' +
  'product_variants(id,name,attributes,price,sale_price,available_quantity,low_stock_threshold,status,sort_order)';

async function currencyCode() {
  try {
    const rows = await rest('settings?select=value&key=eq.store');
    return (rows && rows[0] && rows[0].value && rows[0].value.currency) || 'HTG';
  } catch (_) {
    return 'HTG';
  }
}

function productQuery() {
  const qs = new URLSearchParams();
  qs.set('select', PRODUCT_SELECT);
  qs.set('status', 'eq.published');
  qs.set('product_variants.status', 'eq.active');
  return qs;
}

// ---------- tools ----------
async function search_products(a) {
  const limit = Math.min(Math.max(parseInt(a.limit, 10) || 5, 1), 8);
  const qs = productQuery();
  qs.set('order', 'is_featured.desc,sold_count.desc');
  qs.set('limit', '40');

  const ws = words(a.query);
  if (ws.length) {
    qs.set('and', `(${ws.map((w) => `or(name.ilike.*${w}*,description.ilike.*${w}*,sku.ilike.*${w}*)`).join(',')})`);
  }

  if (a.category) {
    const cats = await rest('categories?select=id,name,slug,parent_id&is_active=eq.true');
    const needle = clean(a.category, 40).toLowerCase();
    const hit = (cats || []).filter((c) => c.name.toLowerCase().includes(needle) || c.slug.toLowerCase().includes(needle));
    if (!hit.length) return { data: { products: [], note: 'category_not_found', categories: (cats || []).map((c) => c.name) } };
    const ids = new Set(hit.map((c) => c.id));
    for (const c of cats) if (c.parent_id && ids.has(c.parent_id)) ids.add(c.id);
    qs.set('category_id', `in.(${[...ids].join(',')})`);
  }

  const rows = (await rest(`products?${qs}`)) || [];
  const min = num(a.min_price);
  const max = num(a.max_price);
  let shaped = rows.map((p) => shapeProduct(p));
  if (min != null || max != null) {
    shaped = shaped.filter((s) =>
      s.variants.some((v) => (min == null || v.price >= min) && (max == null || v.price <= max))
    );
  }
  if (a.in_stock_only) shaped = shaped.filter((s) => s.available);
  shaped.sort((x, y) => Number(y.available) - Number(x.available));
  shaped = shaped.slice(0, limit);

  const currency = await currencyCode();
  return {
    data: {
      currency,
      count: shaped.length,
      products: shaped.map((s) => ({
        slug: s.slug,
        name: s.name,
        price_from: s.price_from,
        available: s.available,
        variants: s.variants.slice(0, 5).map((v) => ({ name: v.name, price: v.price, stock: v.stock })),
      })),
      note: shaped.length ? 'cards_displayed_to_customer' : 'no_results',
    },
    cards: shaped.map(toCard),
  };
}

async function get_product(a) {
  const slug = clean(a.slug, 120).replace(/ /g, '-');
  if (!slug) return { data: { error: 'INVALID_SLUG' } };
  const qs = productQuery();
  qs.set('slug', `eq.${slug}`);
  qs.set('limit', '1');
  const rows = (await rest(`products?${qs}`)) || [];
  if (!rows.length) return { data: { error: 'NOT_FOUND' } };
  const s = shapeProduct(rows[0], { full: true });
  const forModel = { ...s, image: undefined, variants: s.variants.map(({ qty, ...rest }) => rest) };
  return { data: { currency: await currencyCode(), ...forModel }, cards: [toCard(s)] };
}

async function list_categories() {
  const cats = (await rest('categories?select=name,slug,parent_id&is_active=eq.true&order=sort_order.asc')) || [];
  return { data: { categories: cats.map((c) => ({ name: c.name, slug: c.slug, parent: c.parent_id ? true : false })) } };
}

async function get_store_info() {
  const rows = (await rest('settings?select=key,value&key=in.(store,shipping,payment_methods,assistant)')) || [];
  const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const enabledPayments = Object.values(m.payment_methods || {})
    .filter((p) => p && p.enabled)
    .map((p) => p.label);
  const asst = m.assistant || {};
  const support = asst.support || {};
  return {
    data: {
      store: m.store ? { name: m.store.name, currency: m.store.currency, email: m.store.email || null, phone: m.store.phone || null } : null,
      shipping: m.shipping || null, // flat_fee / free_over, in store currency
      enabled_payment_methods: enabledPayments,
      support_contact: { email: support.email || null, phone: support.phone || null, whatsapp: support.whatsapp || null },
      approved_faqs: Array.isArray(asst.faqs) ? asst.faqs.slice(0, 40) : [],
      not_available_in_system: ['delivery_time_estimates', 'returns_and_refund_policy_unless_in_approved_faqs'],
    },
  };
}

const AUTH = { data: { error: 'AUTH_REQUIRED' }, needsAuth: true };

async function get_my_orders(a, ctx) {
  if (!ctx.userId) return AUTH;
  const rows =
    (await rest(
      `orders?select=order_number,status,payment_status,total,currency,created_at&user_id=eq.${ctx.userId}&order=created_at.desc&limit=5`
    )) || [];
  return { data: { orders: rows.map((o) => ({ ...o, status_label: STATUS_LABELS[o.status] || null })) } };
}

async function get_order(a, ctx) {
  if (!ctx.userId) return AUTH;
  const number = clean(a.order_number, 40).replace(/ /g, '');
  if (!number) return { data: { error: 'INVALID_ORDER_NUMBER' } };
  const rows =
    (await rest(
      'orders?select=order_number,status,payment_method,payment_status,subtotal,shipping_fee,discount,total,currency,city,department,created_at,updated_at,' +
        `order_items(name,variant_name,quantity,unit_price)&user_id=eq.${ctx.userId}&order_number=eq.${encodeURIComponent(number)}&limit=1`
    )) || [];
  if (!rows.length) return { data: { error: 'ORDER_NOT_FOUND_FOR_THIS_ACCOUNT' } };
  return { data: { ...rows[0], status_label: STATUS_LABELS[rows[0].status] || null } };
}

async function view_cart(a, ctx) {
  if (!ctx.userId) return AUTH;
  const rows =
    (await rest(
      'cart_items?select=quantity,products(name,price,sale_price),' +
        `product_variants(name,price,sale_price,available_quantity)&user_id=eq.${ctx.userId}`
    )) || [];
  let subtotal = 0;
  const items = rows.map((r) => {
    const p = r.products || {};
    const v = r.product_variants || {};
    const pr = variantPricing(p, v);
    const line = pr.price * r.quantity;
    subtotal += line;
    return { name: p.name, variant: v.name, quantity: r.quantity, unit_price: pr.price, line_total: line, in_stock: (v.available_quantity ?? 0) >= r.quantity };
  });
  return {
    data: {
      items,
      subtotal,
      note: 'Shipping, discounts and final total are computed by the official checkout.',
    },
  };
}

async function log_unanswered(a) {
  const topic = clean(a.topic, 100);
  if (topic) await rest('assistant_unanswered', { method: 'POST', body: { topic }, headers: { Prefer: 'return=minimal' } });
  return { data: { ok: true } };
}

const obj = (properties, required = []) => ({ type: 'object', properties, required });

const TOOLS = [
  {
    name: 'search_products',
    description: 'Search published JLodna Plas products (live database). Returns real prices/stock; cards are shown to the customer automatically.',
    schema: obj({
      query: { type: 'string', description: 'Keywords (product name/type). Optional if category is given.' },
      category: { type: 'string', description: 'Category name or slug (see list_categories).' },
      min_price: { type: 'number' },
      max_price: { type: 'number' },
      in_stock_only: { type: 'boolean' },
      limit: { type: 'integer', description: '1-8, default 5' },
    }),
    fn: search_products,
  },
  {
    name: 'get_product',
    description: 'Details of one product by slug: description, variants, prices, stock status.',
    schema: obj({ slug: { type: 'string' } }, ['slug']),
    fn: get_product,
  },
  { name: 'list_categories', description: 'List active product categories.', schema: obj({}), fn: list_categories },
  {
    name: 'get_store_info',
    description: 'Official shipping fees, enabled payment methods, support contact and approved FAQs.',
    schema: obj({}),
    fn: get_store_info,
  },
  { name: 'get_my_orders', description: "Logged-in customer's 5 most recent orders (status only).", schema: obj({}), fn: get_my_orders },
  {
    name: 'get_order',
    description: "One of the logged-in customer's own orders by order number: status, totals, items.",
    schema: obj({ order_number: { type: 'string' } }, ['order_number']),
    fn: get_order,
  },
  { name: 'view_cart', description: "Logged-in customer's current cart and subtotal.", schema: obj({}), fn: view_cart },
  {
    name: 'log_unanswered',
    description: 'Record a short generic topic (no personal data) of a legitimate question you could not answer.',
    schema: obj({ topic: { type: 'string' } }, ['topic']),
    fn: log_unanswered,
  },
];

const BY_NAME = Object.fromEntries(TOOLS.map((t) => [t.name, t]));

async function runTool(name, input, ctx) {
  const t = BY_NAME[name];
  if (!t) return { data: { error: 'UNKNOWN_TOOL' } };
  try {
    return await t.fn(input && typeof input === 'object' ? input : {}, ctx);
  } catch (e) {
    return { data: { error: 'SERVICE_TEMPORARILY_UNAVAILABLE' }, failed: true };
  }
}

module.exports = { TOOLS, runTool, rest, _internals: { variantPricing, shapeProduct, words } };
