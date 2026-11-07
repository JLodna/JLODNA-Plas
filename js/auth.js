import { sb } from './supabase.js';

export async function getSession() { if (!sb) return null; const { data } = await sb.auth.getSession(); return data.session; }
export async function getUser() { return (await getSession())?.user || null; }

export async function requireUser(redirect = true) {
  const u = await getUser();
  if (!u && redirect) location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
  return u;
}
export async function signUp({ first_name, last_name, email, phone, password, captchaToken }) {
  return sb.auth.signUp({ email, password, options: { data: { first_name, last_name, phone }, emailRedirectTo: location.origin + '/login', ...(captchaToken ? { captchaToken } : {}) } });
}
export const signIn = (email, password, captchaToken) => sb.auth.signInWithPassword({ email, password, ...(captchaToken ? { options: { captchaToken } } : {}) });
export const signOut = async () => { try { (await import('./native.js')).disablePush(); } catch { /* ignoré */ } await sb.auth.signOut(); localStorage.removeItem('jl_cart_v2'); location.href = '/'; };
export const resetPassword = (email, captchaToken) => sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + '/account', ...(captchaToken ? { captchaToken } : {}) });

export async function getAdminRole() {
  const u = await getUser(); if (!u) return null;
  const { data } = await sb.from('admin_roles').select('role').eq('user_id', u.id).maybeSingle();
  return data?.role || null;
}
export const safeNext = (n) => (n && n.startsWith('/') && !n.startsWith('//') ? n : '/account');
