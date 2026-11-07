const URL_ = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL; const ANON = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const SITE = process.env.VITE_SITE_URL || 'https://www.jlodna.com';
module.exports = async (req, res) => {
  const pages = ['/', '/shop', '/b2b', '/bio', '/delete-account', '/about', '/contact'].map((p) => `<url><loc>${SITE}${p}</loc></url>`);
  let prods = [];
  try { if (URL_ && ANON) prods = await fetch(`${URL_}/rest/v1/products?select=slug,updated_at&status=eq.published&limit=5000`, { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } }).then((r) => (r.ok ? r.json() : [])); } catch {}
  const x = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
  const body = pages.concat(prods.map((p) => `<url><loc>${SITE}/product?slug=${encodeURIComponent(p.slug)}</loc><lastmod>${x(p.updated_at.slice(0, 10))}</lastmod></url>`));
  res.setHeader('Content-Type', 'application/xml; charset=utf-8'); res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');
  res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body.join('')}</urlset>`);
};
