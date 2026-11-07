// Admin — Assistant JLodni : activation, contact support, FAQ approuvées, statistiques réelles.
// Données : settings(key='assistant'), assistant_stats, assistant_unanswered (voir supabase/modules/20_jlodni.sql).
// Aucun secret ici : la clé IA et le modèle se configurent uniquement dans les variables d'environnement Vercel.
import { sb } from '/js/supabase.js';
import { esc, isEmail, setLoading, friendlyError, toast } from '/js/utils.js';

const KEY = 'assistant';
const DAYS = 30;
const LIMIT = 5000;
const MAX_FAQ = 40;
const fmt = (n) => Number(n || 0).toLocaleString('fr-FR');

async function loadSettings() {
  const { data, error } = await sb.from('settings').select('value').eq('key', KEY).maybeSingle();
  if (error) throw error;
  return data ? data.value || {} : null;
}

async function loadStats() {
  const since = new Date(Date.now() - DAYS * 864e5).toISOString();
  const [s, u] = await Promise.all([
    sb.from('assistant_stats').select('created_at,ok,tools,error_code,authenticated').gte('created_at', since).order('created_at', { ascending: false }).limit(LIMIT),
    sb.from('assistant_unanswered').select('topic,created_at').gte('created_at', since).order('created_at', { ascending: false }).limit(500),
  ]);
  return { stats: s.error ? null : s.data || [], unanswered: u.error ? null : u.data || [] };
}

function summarize(rows) {
  const out = { total: rows.length, ok: 0, errors: 0, auth: 0, err24: 0, tools: new Map(), days: new Map() };
  const d24 = Date.now() - 864e5;
  for (const r of rows) {
    if (r.ok) out.ok++; else out.errors++;
    if (r.authenticated) out.auth++;
    if (!r.ok && new Date(r.created_at).getTime() > d24) out.err24++;
    for (const t of r.tools || []) out.tools.set(t, (out.tools.get(t) || 0) + 1);
    const day = String(r.created_at).slice(0, 10);
    out.days.set(day, (out.days.get(day) || 0) + 1);
  }
  return out;
}

function topTopics(rows) {
  const m = new Map();
  for (const r of rows) {
    const k = String(r.topic || '').trim().toLowerCase();
    if (k) m.set(k, (m.get(k) || 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
}

const table = (head, rows, empty) =>
  rows.length
    ? `<div style="overflow-x:auto"><table class="tbl"><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows
        .map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`)
        .join('')}</tbody></table></div>`
    : `<p class="muted">${esc(empty)}</p>`;

const faqRow = (f, i) => `
  <div class="faq-row" data-i="${i}" style="border:1px solid #ddd;border-radius:10px;padding:10px;margin-bottom:10px">
    <div class="field"><label>Question ${i + 1}</label><input class="faq-q" maxlength="200" value="${esc(f.q)}"></div>
    <div class="field"><label>Réponse officielle</label><textarea class="faq-a" rows="3" maxlength="1000">${esc(f.a)}</textarea></div>
    <button type="button" class="btn ghost sm faq-del">Supprimer</button>
  </div>`;

export async function render(v) {
  let settings;
  try { settings = await loadSettings(); } catch (e) { v.innerHTML = `<div class="empty err"><p>${esc(friendlyError(e))}</p></div>`; return; }
  if (settings === null) {
    v.innerHTML = '<h1>Assistant JLodni</h1><div class="empty"><p>La configuration n’existe pas encore. Exécutez d’abord la migration <code>supabase/modules/20_jlodni.sql</code>.</p></div>';
    return;
  }
  const support = settings.support || {};
  let faqs = Array.isArray(settings.faqs) ? settings.faqs.map((f) => ({ q: String(f.q || ''), a: String(f.a || '') })) : [];

  v.innerHTML = '<h1>Assistant JLodni</h1><div class="sk-line"></div>';
  const { stats, unanswered } = await loadStats();
  const sm = stats ? summarize(stats) : null;
  const days = sm ? [...sm.days.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 14) : [];
  const tools = sm ? [...sm.tools.entries()].sort((a, b) => b[1] - a[1]) : [];
  const topics = unanswered ? topTopics(unanswered) : [];

  v.innerHTML = `
  <h1>Assistant JLodni</h1>
  <p class="muted">Statistiques agrégées réelles des ${DAYS} derniers jours. Le contenu des conversations n’est jamais enregistré.</p>

  <section class="form-card" style="max-width:none;margin-bottom:16px">
    <h2 style="font-size:1.1rem">Activation</h2>
    <label style="display:flex;gap:10px;align-items:center;cursor:pointer">
      <input type="checkbox" id="as-enabled" ${settings.enabled ? 'checked' : ''}>
      <span>Assistant activé sur la boutique <strong id="as-state">${settings.enabled ? '(actif)' : '(désactivé)'}</strong></span>
    </label>
    <p class="muted">Modèle et fournisseur IA : variables d’environnement Vercel (<code>AI_PROVIDER</code>, <code>AI_MODEL</code>, <code>AI_API_KEY</code>). Elles ne sont jamais affichées ici. Un changement d’activation peut mettre jusqu’à 30 secondes à s’appliquer.</p>
  </section>

  <section style="margin-bottom:16px">
    <h2 style="font-size:1.1rem">Statistiques</h2>
    ${
      sm
        ? `<p><strong>${fmt(sm.total)}</strong> messages traités · <strong>${fmt(sm.ok)}</strong> réussis · <strong>${fmt(sm.errors)}</strong> en erreur (<strong>${fmt(sm.err24)}</strong> sur 24 h) · <strong>${fmt(sm.auth)}</strong> par des clients connectés${stats.length >= LIMIT ? ` <span class="muted">(limité aux ${fmt(LIMIT)} plus récents)</span>` : ''}</p>
           <h3 style="font-size:1rem">Messages par jour</h3>${table(['Jour', 'Messages'], days.map(([d, n]) => [d, fmt(n)]), 'Aucune donnée pour le moment.')}
           <h3 style="font-size:1rem">Outils utilisés</h3>${table(['Outil', 'Appels'], tools.map(([t, n]) => [t, fmt(n)]), 'Aucune donnée pour le moment.')}`
        : '<p class="muted">Statistiques indisponibles (table absente ou accès refusé pour votre rôle).</p>'
    }
  </section>

  <section style="margin-bottom:16px">
    <h2 style="font-size:1.1rem">Questions non résolues (sujets fréquents)</h2>
    ${unanswered ? table(['Sujet', 'Occurrences'], topics.map(([t, n]) => [t, fmt(n)]), 'Aucune question non résolue enregistrée.') : '<p class="muted">Indisponible (accès refusé pour votre rôle).</p>'}
  </section>

  <form class="form-card" id="as-form" style="max-width:none" novalidate>
    <h2 style="font-size:1.1rem">Contact du support humain</h2>
    <p class="muted">Laissez vide si aucun contact n’est disponible : l’assistant dira qu’il n’en a pas, il n’en inventera pas.</p>
    <div class="field"><label for="as-email">Email support</label><input id="as-email" type="email" value="${esc(support.email || '')}"></div>
    <div class="field"><label for="as-phone">Téléphone support</label><input id="as-phone" type="tel" maxlength="40" value="${esc(support.phone || '')}"></div>
    <div class="field"><label for="as-wa">WhatsApp support</label><input id="as-wa" type="tel" maxlength="40" value="${esc(support.whatsapp || '')}"></div>

    <h2 style="font-size:1.1rem">FAQ approuvées</h2>
    <p class="muted">L’assistant s’appuie sur ces réponses officielles (livraison, retours, remboursements…). Maximum ${MAX_FAQ}.</p>
    <div id="as-faqs"></div>
    <button type="button" class="btn ghost sm" id="as-add">+ Ajouter une FAQ</button>
    <p class="err-msg" id="as-err" role="alert"></p>
    <button class="btn primary" id="as-save">Enregistrer</button>
  </form>`;

  const box = v.querySelector('#as-faqs');
  const err = v.querySelector('#as-err');
  const drawFaqs = () => {
    box.innerHTML = faqs.length ? faqs.map(faqRow).join('') : '<p class="muted">Aucune FAQ pour le moment.</p>';
    box.querySelectorAll('.faq-del').forEach((b) => (b.onclick = () => { collect(); faqs.splice(Number(b.closest('.faq-row').dataset.i), 1); drawFaqs(); }));
  };
  const collect = () => {
    const rows = [...box.querySelectorAll('.faq-row')];
    if (rows.length || !faqs.length) faqs = rows.map((r) => ({ q: r.querySelector('.faq-q').value, a: r.querySelector('.faq-a').value }));
  };
  drawFaqs();
  v.querySelector('#as-add').onclick = () => { collect(); if (faqs.length >= MAX_FAQ) { err.textContent = `Maximum ${MAX_FAQ} FAQ.`; return; } faqs.push({ q: '', a: '' }); drawFaqs(); };
  v.querySelector('#as-enabled').onchange = (e) => { v.querySelector('#as-state').textContent = e.target.checked ? '(sera actif après enregistrement)' : '(sera désactivé après enregistrement)'; };

  v.querySelector('#as-form').onsubmit = async (e) => {
    e.preventDefault();
    err.textContent = '';
    collect();
    const email = v.querySelector('#as-email').value.trim();
    const phone = v.querySelector('#as-phone').value.trim();
    const wa = v.querySelector('#as-wa').value.trim();
    if (email && !isEmail(email)) { err.textContent = 'Email support invalide.'; return; }
    const clean = faqs.map((f) => ({ q: f.q.trim(), a: f.a.trim() })).filter((f) => f.q || f.a);
    if (clean.some((f) => !f.q || !f.a)) { err.textContent = 'Chaque FAQ doit avoir une question et une réponse.'; return; }
    const value = { ...settings, enabled: v.querySelector('#as-enabled').checked, support: { email: email || null, phone: phone || null, whatsapp: wa || null }, faqs: clean };
    const btn = v.querySelector('#as-save');
    setLoading(btn, true, 'Enregistrement…');
    try {
      const { data, error } = await sb.from('settings').update({ value, updated_at: new Date().toISOString() }).eq('key', KEY).select('key');
      if (error) throw error;
      if (!data || !data.length) throw new Error('Enregistrement refusé : permission insuffisante.');
      settings = value;
      faqs = clean;
      drawFaqs();
      v.querySelector('#as-state').textContent = value.enabled ? '(actif)' : '(désactivé)';
      toast('Paramètres de l’assistant enregistrés.');
    } catch (ex) {
      err.textContent = ex && ex.message && /refusé/.test(ex.message) ? ex.message : friendlyError(ex);
    } finally {
      setLoading(btn, false);
    }
  };
}
