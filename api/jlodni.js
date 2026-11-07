'use strict';
const crypto = require('crypto');
const { SYSTEM_PROMPT } = require('./_jlodni/prompt');
const { getLLM } = require('./_jlodni/llm');
const { TOOLS, runTool, rest } = require('./_jlodni/tools');

const MAX_MESSAGE = 500;
const MAX_HISTORY = 10;
const MAX_TOOL_ROUNDS = 4;
const FALLBACK =
  'Mwen gen yon ti pwoblèm teknik pou kounye a. Tanpri eseye ankò nan kèk minit. / Un petit problème technique est survenu, veuillez réessayer dans quelques minutes.';

let settingsCache = { at: 0, value: null };
async function assistantSettings() {
  if (Date.now() - settingsCache.at < 30000) return settingsCache.value;
  const rows = await rest('settings?select=value&key=eq.assistant');
  const value = (rows && rows[0] && rows[0].value) || { enabled: false };
  settingsCache = { at: Date.now(), value };
  return value;
}

function allowedOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // same-origin fetches may omit it
  const list = (process.env.ALLOWED_ORIGINS || 'https://www.jlodna.com,https://jlodna.com').split(',').map((s) => s.trim());
  return list.includes(origin) || (process.env.VERCEL_ENV !== 'production' && /^https?:\/\/localhost(:\d+)?$/.test(origin));
}

// Verify the Supabase JWT with Supabase itself. Returns user id or null.
async function verifyUser(req) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  if (!token || token.length > 4096) return null;
  try {
    const r = await fetch(`${String(process.env.SUPABASE_URL).replace(/\/$/, '')}/auth/v1/user`, {
      headers: { apikey: process.env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) return null;
    const u = await r.json();
    return u && /^[0-9a-f-]{36}$/i.test(u.id) ? u.id : null;
  } catch (_) {
    return null;
  }
}

async function rateOk(key, max, windowSeconds) {
  try {
    const ok = await rest('rpc/assistant_rate_check', {
      method: 'POST',
      body: { p_key: key, p_max: max, p_window_seconds: windowSeconds },
    });
    return ok !== false;
  } catch (_) {
    return false; // fail closed if the limiter is unavailable
  }
}

function sanitizeHistory(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string' && m.text.trim())
    .slice(-MAX_HISTORY)
    .filter((m, i, a) => a.slice(0, i + 1).some((x) => x.role === 'user')) // must start with a user turn
    .map((m) => ({ role: m.role, text: m.text.slice(0, 1500) }));
}

function send(res, status, body) {
  res.status(status).setHeader('Cache-Control', 'no-store').json(body);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'METHOD_NOT_ALLOWED' });
  if (!allowedOrigin(req)) return send(res, 403, { error: 'FORBIDDEN' });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return send(res, 503, { error: 'ASSISTANT_NOT_CONFIGURED' });

  const llm = getLLM();
  if (!llm) return send(res, 503, { error: 'ASSISTANT_NOT_CONFIGURED' });

  const body = typeof req.body === 'string' ? safeJson(req.body) : req.body;
  const message = body && typeof body.message === 'string' ? body.message.trim() : '';
  if (!message || message.length > MAX_MESSAGE) return send(res, 400, { error: 'INVALID_MESSAGE' });

  try {
    const settings = await assistantSettings();
    if (!settings.enabled) return send(res, 503, { error: 'ASSISTANT_DISABLED' });

    const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
    const ipKey = crypto.createHash('sha256').update(ip + (process.env.RATE_LIMIT_SALT || process.env.SUPABASE_SERVICE_ROLE_KEY)).digest('hex').slice(0, 32);
    const [minuteOk, dayOk] = await Promise.all([
      rateOk(`m:${ipKey}`, Number(process.env.RATE_PER_MINUTE) || 12, 60),
      rateOk(`d:${ipKey}`, Number(process.env.RATE_PER_DAY) || 300, 86400),
    ]);
    if (!minuteOk || !dayOk) return send(res, 429, { error: 'RATE_LIMITED' });

    const userId = await verifyUser(req);
    const ctx = { userId };

    const messages = [...sanitizeHistory(body.history).map((m) => (m.role === 'user' ? { role: 'user', text: m.text } : { role: 'assistant', text: m.text, calls: [] })), { role: 'user', text: message }];
    // The history must end with the new user message and alternate sensibly.
    const cards = new Map();
    const used = [];
    let needsAuth = false;
    let failed = false;
    let reply = '';

    const toolDefs = TOOLS.map(({ name, description, schema }) => ({ name, description, schema }));
    for (let round = 0; round < MAX_TOOL_ROUNDS + 1; round++) {
      const out = await llm.step({ system: SYSTEM_PROMPT, messages, tools: round < MAX_TOOL_ROUNDS ? toolDefs : [] });
      if (!out.calls.length) {
        reply = out.text;
        break;
      }
      messages.push({ role: 'assistant', text: out.text, calls: out.calls });
      const results = await Promise.all(
        out.calls.map(async (c) => {
          used.push(c.name);
          const r = await runTool(c.name, c.input, ctx);
          if (r.needsAuth) needsAuth = true;
          if (r.failed) failed = true;
          for (const card of r.cards || []) if (cards.size < 8) cards.set(card.id, card);
          // Tool output is untrusted data for the model.
          return { id: c.id, name: c.name, output: JSON.stringify({ untrusted_data: r.data }) };
        })
      );
      messages.push({ role: 'tool', results });
    }

    // stats: tool names + outcome only, never message content
    await rest('assistant_stats', {
      method: 'POST',
      body: { tools: [...new Set(used)], ok: !!reply && !failed, error_code: failed ? 'TOOL_FAILURE' : reply ? null : 'NO_REPLY', authenticated: !!userId },
      headers: { Prefer: 'return=minimal' },
    }).catch(() => {});

    return send(res, 200, { reply: reply || FALLBACK, cards: [...cards.values()], needsAuth });
  } catch (e) {
    console.error('jlodni error', e && e.message); // message only, no customer content
    return send(res, 200, { reply: FALLBACK, cards: [], needsAuth: false, degraded: true });
  }
};

function safeJson(s) {
  try { return JSON.parse(s); } catch (_) { return null; }
}
