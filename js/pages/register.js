import { initLayout } from '../layout.js';
import { signUp } from '../auth.js';
import { $, isEmail, setLoading, friendlyError } from '../utils.js';
import { mountCaptcha, CAPTCHA_MSG } from '../captcha.js';

initLayout();
const cap = await mountCaptcha($('#captcha'));
$('#reg-form').addEventListener('submit', async (e) => {
  e.preventDefault(); const err = $('#err'); err.textContent = '';
  const v = { first_name: $('#first_name').value.trim(), last_name: $('#last_name').value.trim(), email: $('#email').value.trim(), phone: $('#phone').value.trim(), password: $('#password').value };
  if (!v.first_name || !v.last_name || !isEmail(v.email) || v.phone.length < 6) { err.textContent = 'Veuillez remplir correctement tous les champs.'; return; }
  if (v.password.length < 8) { err.textContent = 'Le mot de passe doit contenir au moins 8 caractères.'; return; }
  if (v.password !== $('#password2').value) { err.textContent = 'Les mots de passe ne correspondent pas.'; return; }
  if (cap.enabled && !cap.token()) { err.textContent = CAPTCHA_MSG; return; }
  setLoading($('#btn'), true, 'Création du compte…');
  const { data, error } = await signUp({ ...v, captchaToken: cap.token() }); setLoading($('#btn'), false);
  if (error) { cap.reset(); err.textContent = friendlyError(error); return; }
  if (data.session) location.href = '/account';
  else $('#reg-form').innerHTML = '<h1 style="font-size:1.6rem">Vérifiez votre email</h1><p>Un lien de confirmation vient d’être envoyé à <strong></strong>. Cliquez dessus pour activer votre compte, puis connectez-vous.</p><a class="btn primary" href="/login">Aller à la connexion</a>', $('#reg-form strong').textContent = v.email;
});
