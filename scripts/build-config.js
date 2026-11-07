// Build Vercel : 1) génère js/config.js depuis les variables d'environnement (valeurs PUBLIQUES uniquement)
// 2) copie uniquement les fichiers du site dans dist/ (supabase/, scripts/, README ne sont pas publiés).
const fs = require('fs'); const path = require('path');
const root = path.join(__dirname, '..');
const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const key = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
const site = process.env.VITE_SITE_URL || 'https://www.jlodna.com';
if (!url || !key) console.warn('[build] ATTENTION : VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY manquants. Le site ne pourra pas se connecter à Supabase.');
if (key.startsWith('sb_secret_')) { console.error('[build] ERREUR : cette clé est une clé SECRÈTE Supabase (sb_secret_…). Utilisez la clé publique (anon ou publishable).'); process.exit(1); }
if (/service_role/i.test(key) || (key.split('.')[1] && /service_role/.test(Buffer.from(key.split('.')[1], 'base64').toString() || ''))) { console.error('[build] ERREUR : cette clé est une service_role. Utilisez la clé anon/public.'); process.exit(1); }
fs.writeFileSync(path.join(root, 'js/config.js'), `// Fichier généré automatiquement — ne pas modifier.\nwindow.JL_CONFIG = ${JSON.stringify({ SUPABASE_URL: url, SUPABASE_ANON_KEY: key, SITE_URL: site, TURNSTILE_SITE_KEY: process.env.VITE_TURNSTILE_SITE_KEY || '', CURRENCY: 'HTG' }, null, 2)};\n`);
const dist = path.join(root, 'dist'); fs.rmSync(dist, { recursive: true, force: true }); fs.mkdirSync(dist);
for (const f of fs.readdirSync(root)) {
  if (/\.html$/.test(f) || ['manifest.json', 'sw.js', 'robots.txt'].includes(f)) fs.copyFileSync(path.join(root, f), path.join(dist, f));
}
for (const d of ['admin', 'assets', 'css', 'js', 'bio', 'jlodni']) fs.cpSync(path.join(root, d), path.join(dist, d), { recursive: true, filter: (s) => !s.includes(`${path.sep}original`) });
console.log('[build] dist/ prêt.');
