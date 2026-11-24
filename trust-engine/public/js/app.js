import { api, state, esc, money, fmtDate, titleCase, statusChip, toast, route, startRouter, renderShell, renderRoute, setCrumbs } from './core.js';
import { overviewView, businessesView, businessDetailView, documentsView, invoicesView } from './views-core.js';
import {
  reconciliationView, counterpartiesView, integrationsView, auditView, reportsView, systemView, trustIndexView,
} from './views-ops.js';

const $ = (id) => document.getElementById(id);

/* --------------------------------------------------------------- boot */

async function boot() {
  if (location.pathname.startsWith('/confirm/')) {
    renderPublicConfirmation(location.pathname.split('/').filter(Boolean)[1]);
    return;
  }
  if (location.pathname.startsWith('/activate/')) {
    renderActivation(location.pathname.split('/').filter(Boolean)[1]);
    return;
  }
  try {
    const me = (await api('/auth/me')).data;
    await enterApp(me);
  } catch (error) {
    if (error.status === 401) showLogin();
    else {
      $('boot').innerHTML = `<div class="boot-mark">AFT</div><p>Trust Engine</p><div style="max-width:360px;margin-top:14px;font-size:12px;color:#d7a79e">${esc(error.message)}</div>`;
    }
  }
}

async function renderActivation(token) {
  document.body.innerHTML = `
    <div class="login" style="grid-template-columns:1fr;min-height:100vh">
      <div style="max-width:560px;margin:0 auto;padding:48px 20px;width:100%">
        <div class="brand-lockup" style="margin-bottom:28px">
          <div class="brand-mark" style="border-color:#c69a43;color:#c69a43">AFT</div>
          <div><div class="brand-name">African Financial Trust</div><div class="brand-sub">Trust Engine</div></div>
        </div>
        <div class="card pad">
          <p class="eyebrow">Secure account activation</p>
          <h2>Create your administrator password</h2>
          <p class="muted">This invitation is single-use and expires after 48 hours. Use a unique password of at least 14 characters.</p>
          <form id="activation-form" class="login-form">
            <label class="field"><span>Full name</span><input name="fullName" autocomplete="name" required placeholder="Your full name"></label>
            <label class="field"><span>Password</span><input name="password" type="password" autocomplete="new-password" minlength="14" required></label>
            <label class="field"><span>Confirm password</span><input name="confirm" type="password" autocomplete="new-password" minlength="14" required></label>
            <div class="login-error" id="activation-error" role="alert" hidden></div>
            <button class="btn btn-primary btn-block" type="submit">Activate account</button>
          </form>
          <div id="activation-success" hidden></div>
        </div>
      </div>
    </div>`;
  const form = document.getElementById('activation-form');
  const error = document.getElementById('activation-error');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.hidden = true;
    if (form.password.value !== form.confirm.value) { error.textContent = 'Passwords do not match.'; error.hidden = false; return; }
    const button = form.querySelector('button'); button.disabled = true; button.textContent = 'Activating…';
    try {
      const result = await api('/auth/activate', { method: 'POST', body: { token, password: form.password.value, fullName: form.fullName.value } });
      form.hidden = true;
      const success = document.getElementById('activation-success');
      success.hidden = false;
      success.innerHTML = `<p class="eyebrow">Account activated</p><h3>You can now sign in</h3><p class="muted">Your administrator account for ${esc(result.data.email)} is active. Return to the sign-in page to continue.</p><a class="btn btn-primary" href="/">Go to sign in</a>`;
    } catch (e) { error.textContent = e.message; error.hidden = false; button.disabled = false; button.textContent = 'Activate account'; }
  });
}

function showLogin() {
  $('boot').hidden = true;
  $('login-screen').hidden = false;
  $('login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const errorBox = $('login-error');
    errorBox.hidden = true;
    button.disabled = true;
    button.textContent = 'Signing in…';
    try {
      await api('/auth/login', {
        method: 'POST',
        body: { email: form.email.value.trim(), password: form.password.value },
      });
      const me = (await api('/auth/me')).data;
      $('login-screen').hidden = true;
      await enterApp(me);
    } catch (error) {
      errorBox.hidden = false;
      errorBox.textContent = error.message;
      button.disabled = false;
      button.textContent = 'Sign in to the Trust Engine';
    }
  });
}

async function enterApp(me) {
  state.user = me.user;
  state.org = me.org;
  state.role = me.role;
  const businesses = (await api('/businesses?limit=100')).data;
  state.businesses = businesses;
  const stored = localStorage.getItem('aft.businessId');
  state.businessId = businesses.some((b) => b.id === stored) ? stored : businesses[0]?.id || null;
  $('boot').hidden = true;
  $('login-screen').hidden = true;
  renderShell();
  window.addEventListener('aft:signed-out', () => location.reload());
  const chip = $('user-chip');
  chip.style.cursor = 'pointer';
  chip.title = 'Click to sign out';
  chip.addEventListener('click', async () => {
    try { await api('/auth/logout', { method: 'POST', body: {} }); } catch { /* session may already be gone */ }
    location.reload();
  });
  registerRoutes();
  startRouter();
}

/* -------------------------------------------------------------- routes */

let registered = false;

function registerRoutes() {
  if (registered) return;
  registered = true;
  route('overview', overviewView);
  route('businesses', businessesView);
  route('businesses/:id', async (el, params) => {
    syncBusiness(params.id);
    return businessDetailView(el, params);
  });
  route('businesses/:id/:tab', async (el, params) => {
    syncBusiness(params.id);
    return businessDetailView(el, params);
  });
  route('documents', documentsView);
  route('invoices', invoicesView);
  route('reconciliation', reconciliationView);
  route('counterparties', counterpartiesView);
  route('trust', trustIndexView);
  route('audit', auditView);
  route('reports', reportsView);
  route('integrations', integrationsView);
  route('system', systemView);
}

function syncBusiness(id) {
  if (!state.businesses.some((b) => b.id === id)) return;
  state.businessId = id;
  localStorage.setItem('aft.businessId', id);
  const select = document.getElementById('business-context');
  if (select) select.value = id;
}

/* ------------------------------------------------ public confirmation page */

async function renderPublicConfirmation(token) {
  document.body.innerHTML = `
    <div class="login" style="grid-template-columns:1fr;min-height:100vh">
      <div style="max-width:640px;margin:0 auto;padding:48px 20px;width:100%">
        <div class="brand-lockup" style="margin-bottom:28px">
          <div class="brand-mark" style="border-color:#c69a43;color:#c69a43">AFT</div>
          <div><div class="brand-name">African Financial Trust</div><div class="brand-sub">Counterparty confirmation</div></div>
        </div>
        <div id="confirm-body" class="card pad"><div class="loading">Loading confirmation request</div></div>
        <p class="small muted" style="margin-top:18px">This is a single-use confirmation link. It shows only the invoice summary supplied by the issuer. Confirming records that your organisation recognises the invoice; it does not transfer funds or create a payment obligation.</p>
      </div>
    </div>`;

  const body = document.getElementById('confirm-body');
  let preview;
  try {
    preview = (await api(`/counterparty-confirmations/${encodeURIComponent(token)}`)).data;
  } catch (error) {
    body.innerHTML = `<h2 style="font-size:24px">Link unavailable</h2><p class="muted" style="margin-top:8px">${esc(error.message)}</p>`;
    return;
  }
  const already = preview.status === 'confirmed' || preview.status === 'conflict';
  body.innerHTML = `
    <p class="eyebrow">Invoice confirmation</p>
    <h2 style="font-size:28px;margin:8px 0 6px">${esc(preview.issuer_name)}</h2>
    <p class="muted small">requests confirmation of the following invoice.</p>
    <div class="divider"></div>
    <dl class="defs">
      <dt>Invoice number</dt><dd>${esc(preview.invoice_number || '—')}</dd>
      <dt>Issue date</dt><dd>${fmtDate(preview.issue_date)}</dd>
      <dt>Amount</dt><dd style="font-family:var(--display);font-size:20px">${money(preview.total_amount, preview.currency_code)}</dd>
      <dt>Issuer country</dt><dd>${esc(preview.country_code || '—')}</dd>
      <dt>Status</dt><dd>${statusChip(preview.status)}</dd>
    </dl>
    ${already ? `<div class="notice info" style="margin-top:16px"><span>This request has already been answered. No further action is required.</span></div>` : `
      <form id="confirm-form" style="margin-top:18px">
        <div class="form-error" id="confirm-error" hidden></div>
        <div class="form-grid">
          <label class="field"><span>Your name</span><input name="name" maxlength="255" required></label>
          <label class="field"><span>Your email</span><input name="email" type="email" maxlength="255" required></label>
          <label class="field span2"><span>Note (optional)</span><textarea name="note" maxlength="1000" placeholder="Any qualification to this confirmation"></textarea></label>
        </div>
        <div style="display:flex;gap:8px;margin-top:14px">
          <button class="btn btn-primary" type="submit" name="decision" value="confirm">Confirm invoice</button>
          <button class="btn btn-danger" type="submit" name="decision" value="decline">Dispute / decline</button>
        </div>
      </form>`}`;

  const form = document.getElementById('confirm-form');
  if (!form) return;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submitter = event.submitter;
    const data = new FormData(form);
    const payload = { decision: submitter?.value || 'confirm', name: data.get('name'), email: data.get('email') };
    if (data.get('note')) payload.note = data.get('note');
    const buttons = form.querySelectorAll('button');
    buttons.forEach((b) => { b.disabled = true; });
    try {
      await api(`/counterparty-confirmations/${encodeURIComponent(token)}`, { method: 'POST', body: payload });
      body.innerHTML = `<div style="text-align:center;padding:20px 0"><div style="font-family:var(--display);font-size:44px;color:#39786f">Recorded</div><p class="muted" style="margin-top:8px">Your response has been written to the issuer's audit trail. You may close this page.</p></div>`;
    } catch (error) {
      const box = document.getElementById('confirm-error');
      box.hidden = false;
      box.textContent = error.message;
      buttons.forEach((b) => { b.disabled = false; });
    }
  });
}

boot();
