import * as db from '../db.js';

const form = document.getElementById('login-form');
const errorEl = document.getElementById('login-error');
const submit = document.getElementById('login-submit');

/** Só aceita voltar para páginas do próprio app (evita redirecionamento aberto). */
function nextPage() {
  const next = new URLSearchParams(window.location.search).get('next') ?? '';
  return /^[a-z]+\.html(\?[^#]*)?$/.test(next) ? next : 'index.html';
}

function showError(message) {
  errorEl.textContent = message;
  errorEl.hidden = false;
}

async function init() {
  if (!db.isConfigured) {
    showError('Configure SUPABASE_URL e SUPABASE_ANON_KEY em js/config.js antes de entrar.');
    submit.disabled = true;
    return;
  }
  const { data: session } = await db.getSession();
  if (session) window.location.replace(nextPage());
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  errorEl.hidden = true;
  const email = form.email.value.trim();
  const password = form.password.value;

  if (!email || !password) {
    showError('Informe e-mail e senha.');
    (email ? form.password : form.email).focus();
    return;
  }

  submit.disabled = true;
  submit.textContent = 'Entrando…';
  const { error } = await db.signIn(email, password);
  if (error) {
    showError(error.message);
    submit.disabled = false;
    submit.textContent = 'Entrar';
    form.password.focus();
    return;
  }
  window.location.replace(nextPage());
});

init();
