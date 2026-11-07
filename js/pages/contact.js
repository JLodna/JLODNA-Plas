import { initLayout } from '../layout.js';
import { $, isEmail, setLoading, toast } from '../utils.js';
import { mountCaptcha, CAPTCHA_MSG } from '../captcha.js';

initLayout();
const cap = await mountCaptcha($('#captcha'));
const MSG = { RATE_LIMITED: 'Trop de messages en peu de temps. Réessayez plus tard.', CAPTCHA_FAILED: 'Contrôle anti-robot échoué. Réessayez.', CAPTCHA_NOT_CONFIGURED: 'Formulaire momentanément indisponible. Contactez-nous par WhatsApp ou par email.', INVALID_INPUT: 'Vérifiez votre nom, votre email et votre message.' };
$('#c-form').addEventListener('submit', async (e) => {
  e.preventDefault(); const err = $('#err'); err.textContent = '';
  const v = { name: $('#name').value.trim(), email: $('#email').value.trim(), subject: $('#subject').value.trim() || null, body: $('#body').value.trim() };
  if (v.name.length < 2 || !isEmail(v.email) || v.body.length < 5) { err.textContent = 'Veuillez renseigner votre nom, un email valide et votre message.'; return; }
  if (cap.enabled && !cap.token()) { err.textContent = CAPTCHA_MSG; return; }
  setLoading($('#btn'), true, 'Envoi…');
  try {
    const r = await fetch('/api/contact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...v, captcha: cap.token(), website: $('#website').value }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { cap.reset(); err.textContent = MSG[j.error] || 'Envoi impossible. Réessayez.'; setLoading($('#btn'), false); return; }
  } catch { err.textContent = 'Connexion impossible. Réessayez.'; setLoading($('#btn'), false); return; }
  setLoading($('#btn'), false); cap.reset(); e.target.reset(); toast('Message envoyé. Nous vous répondrons rapidement.');
});
