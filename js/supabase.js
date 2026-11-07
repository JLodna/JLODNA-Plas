// Client Supabase unique (clé anon publique uniquement ; la sécurité repose sur RLS).
const cfg = window.JL_CONFIG || {};
export const configured = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase);
export const sb = configured
  ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })
  : null;
export const SITE_URL = cfg.SITE_URL || location.origin;
export const bucketUrl = (path) => `${cfg.SUPABASE_URL}/storage/v1/object/public/product-images/${path}`;
