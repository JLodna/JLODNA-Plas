import { sb } from './supabase.js';
const channels = new Map();
// Abonnement Supabase Realtime (les politiques RLS s'appliquent aussi aux événements).
export function subscribe(name, filter, cb) {
  if (!sb || channels.has(name)) return;
  const ch = sb.channel(name).on('postgres_changes', { schema: 'public', ...filter }, cb).subscribe();
  channels.set(name, ch);
}
export function unsubscribeAll() { channels.forEach((c) => sb.removeChannel(c)); channels.clear(); }
