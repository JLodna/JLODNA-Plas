import { initLayout } from '../layout.js';
import { sb } from '../supabase.js';
import { signIn, getUser, resetPassword, safeNext } from '../auth.js';
import { $, isEmail, setLoading, friendlyError, param, toast } from '../utils.js';
import { mountCaptcha, CAPTCHA_MSG } from '../captcha.js';

initLayout();
const cap = await mountCaptcha($('#captcha'));
(async () => { if (sb && await getUser()) location.replace(safeNext(param('next'))); })();
$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault(); const err = $('#err'); err.textContent = '';
  const email = $('#email').value.trim(); const password = $('#password').value;
  if (!isEmail(email) || !password) { err.textContent = 'Email ou mot de passe incorrect.'; return; }
  if (cap.enabled && !cap.token()) { err.textContent = CAPTCHA_MSG; return; }
  setLoading($('#btn'), true, 'Connexion…');
  const { error } = await signIn(email, password, cap.token()); setLoading($('#btn'), false);
  if (error) { cap.reset(); err.textContent = friendlyError(error); return; }
  location.href = safeNext(param('next'));
});
$('#forgot').addEventListener('click', async () => {
  const email = $('#email').value.trim(); if (!isEmail(email)) { $('#err').textContent = 'Saisissez votre email ci-dessus.'; return; }
  if (cap.enabled && !cap.token()) { $('#err').textContent = CAPTCHA_MSG; return; }
  await resetPassword(email, cap.token()); cap.reset(); toast('Si un compte existe, un email de réinitialisation a été envoyé.');
});
