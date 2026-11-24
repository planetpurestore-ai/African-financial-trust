/* Shared front-end utilities: API client, formatting, shell and routing. */

export const state = {
  user: null,
  org: null,
  role: null,
  businesses: [],
  businessId: null,
  booted: false,
};

const ROUTES = [];
let currentCleanup = null;

/* ------------------------------------------------------------------ API */

export class ApiError extends Error {
  constructor(message, status, code, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function cookie(name) {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export async function api(path, options = {}) {
  const { method = 'GET', body, form, headers = {}, raw = false } = options;
  const init = { method, credentials: 'same-origin', headers: { accept: 'application/json', ...headers } };
  if (form) {
    init.body = form;
  } else if (body !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  if (method !== 'GET' && method !== 'HEAD') {
    const csrf = cookie('aft_csrf');
    if (csrf) init.headers['x-aft-csrf'] = csrf;
  }
  let response;
  try {
    response = await fetch(path.startsWith('/api') ? path : `/api/v1${path}`, init);
  } catch {
    throw new ApiError('The Trust Engine could not be reached. Check your connection.', 0, 'network');
  }
  if (raw && response.ok) return response;
  let payload = null;
  const text = await response.text();
  try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
  if (!response.ok) {
    const err = payload?.error || {};
    throw new ApiError(err.message || `Request failed (${response.status})`, response.status, err.code, err.details);
  }
  return payload;
}

/* ----------------------------------------------------------- formatting */

export const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

const CURRENCY_FALLBACK = { RWF: 'RWF', KES: 'KES', NGN: 'NGN', GHS: 'GHS', ZAR: 'ZAR', USD: 'USD', EUR: 'EUR', TZS: 'TZS', UGX: 'UGX', XOF: 'XOF', XAF: 'XAF', EGP: 'EGP', MAD: 'MAD', ZMW: 'ZMW' };

export const money = (amount, currency = 'RWF') => {
  const n = Number(amount || 0);
  const code = currency || 'RWF';
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: code, maximumFractionDigits: 0 }).format(n);
  } catch {
    return `${CURRENCY_FALLBACK[code] || code} ${n.toLocaleString('en-GB', { maximumFractionDigits: 0 })}`;
  }
};

export const num = (value) => Number(value || 0).toLocaleString('en-GB');

export const pct = (value, digits = 0) => `${(Number(value || 0) * 100).toFixed(digits)}%`;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function fmtDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return esc(value);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function fmtDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return esc(value);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${fmtDate(d)}, ${hh}:${mm}`;
}

export function timeAgo(value) {
  if (!value) return '—';
  const diff = Date.now() - new Date(value).getTime();
  if (Number.isNaN(diff)) return '—';
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  return fmtDate(value);
}

export const titleCase = (value) => String(value ?? '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export const initials = (name) => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

const STATUS_TONE = {
  verified: 'ok', connected: 'ok', confirmed: 'ok', accepted: 'ok', completed: 'ok', generated: 'ok', paid: 'ok',
  partially_verified: 'warn', partially_paid: 'warn', partially_evidenced: 'warn', pending_verification: 'warn',
  verification_in_progress: 'warn', evidence_insufficient: 'warn', documents_submitted: 'warn', suggested: 'warn',
  awaiting_credentials: 'warn', configured: 'warn', queued: 'warn', running: 'warn', unconfirmed: 'warn',
  inconsistent: 'bad', disputed: 'bad', duplicate_suspected: 'bad', rejected: 'bad', failed: 'bad', error: 'bad',
  conflict: 'bad', missing: 'bad', overdue: 'bad',
  verified_profile: 'ok', limited_evidence: 'warn', insufficient_evidence: 'neutral',
  self_declared: 'neutral', unverified: 'neutral', not_configured: 'neutral', disabled: 'neutral',
  draft: 'neutral', pending: 'neutral', unmatched: 'neutral', exact: 'ok', probable: 'warn', partial: 'warn',
};

export function statusChip(status, label) {
  if (!status) return '<span class="chip neutral">—</span>';
  const tone = STATUS_TONE[status] || 'neutral';
  return `<span class="chip ${tone}">${esc(label || titleCase(status))}</span>`;
}

export function gradeBadge(grade) {
  const g = ['A', 'B', 'C', 'D', 'E'].includes(grade) ? grade : null;
  return `<span class="grade ${g || 'na'}" title="Trust grade ${g || 'not available'}">${g || '—'}</span>`;
}

export function provenanceLabel(provenance) {
  const map = {
    self_declared: 'Self-declared',
    document_extracted: 'Document-extracted',
    counterparty_confirmed: 'Counterparty-confirmed',
    independently_verified: 'Independently verified',
    system_reconciled: 'System-reconciled',
    calculated: 'Calculated',
    manual: 'Manual entry',
    bank_feed: 'Bank feed',
  };
  return map[provenance] || titleCase(provenance);
}

export const empty = (title, text) => `<div class="empty"><strong>${esc(title)}</strong>${esc(text || '')}</div>`;

export const errorPanel = (error) => `<div class="error-panel"><strong>${esc(error.message || 'Something went wrong')}</strong>${
  error.details ? esc(Array.isArray(error.details) ? error.details.map((d) => `${d.field || ''} ${d.message || ''}`).join('; ') : JSON.stringify(error.details)) : ''
}</div>`;

/* --------------------------------------------------------------- toast */

export function toast(message, type = 'success') {
  const root = document.getElementById('toast-root');
  const node = document.createElement('div');
  node.className = `toast ${type}`;
  node.textContent = message;
  root.appendChild(node);
  setTimeout(() => node.remove(), 4200);
}

/* --------------------------------------------------------------- modal */

export function closeModal() {
  const root = document.getElementById('modal-root');
  root.hidden = true;
  root.innerHTML = '';
  document.body.style.overflow = '';
}

export function openModal({ title, subtitle, body, submitLabel = 'Save', onSubmit = null, wide = false, footer = null }) {
  const root = document.getElementById('modal-root');
  root.hidden = false;
  document.body.style.overflow = 'hidden';
  root.innerHTML = `
    <div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="modal-head">
        <div><h2>${esc(title)}</h2>${subtitle ? `<div class="sub">${esc(subtitle)}</div>` : ''}</div>
        <button class="modal-close" type="button" data-close aria-label="Close">×</button>
      </div>
      <form id="modal-form" novalidate>
        <div class="modal-body">
          <div class="form-error" id="modal-error" hidden></div>
          ${body}
        </div>
        <div class="modal-foot">
          ${footer || ''}
          <button type="button" class="btn" data-close>Cancel</button>
          ${onSubmit ? `<button type="submit" class="btn btn-primary" id="modal-submit">${esc(submitLabel)}</button>` : ''}
        </div>
      </form>
    </div>`;
  root.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closeModal));
  root.addEventListener('click', (event) => { if (event.target === root) closeModal(); }, { once: true });
  const form = root.querySelector('#modal-form');
  if (onSubmit) {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = root.querySelector('#modal-submit');
      const errorBox = root.querySelector('#modal-error');
      button.disabled = true;
      button.textContent = 'Working…';
      errorBox.hidden = true;
      try {
        await onSubmit(new FormData(form), form);
        closeModal();
      } catch (error) {
        errorBox.hidden = false;
        errorBox.textContent = error.message || 'The action could not be completed.';
        button.disabled = false;
        button.textContent = submitLabel;
      }
    });
  }
  const first = root.querySelector('input, select, textarea, button');
  if (first) first.focus();
}

export function confirmAction({ title, text, label = 'Confirm', danger = false, onConfirm }) {
  openModal({
    title,
    body: `<p style="font-size:13px;line-height:1.7">${esc(text)}</p>`,
    submitLabel: label,
    onSubmit: async () => { await onConfirm(); },
  });
  const submit = document.querySelector('#modal-submit');
  if (submit && danger) submit.classList.add('btn-danger');
}

/* ---------------------------------------------------------------- shell */

const NAV = [
  { section: 'Workspace' },
  { id: 'overview', label: 'Overview', href: '#/overview' },
  { id: 'businesses', label: 'Businesses', href: '#/businesses' },
  { id: 'documents', label: 'Documents', href: '#/documents' },
  { id: 'invoices', label: 'Invoices', href: '#/invoices' },
  { id: 'reconciliation', label: 'Reconciliation', href: '#/reconciliation' },
  { id: 'counterparties', label: 'Counterparties', href: '#/counterparties' },
  { section: 'Governance' },
  { id: 'trust', label: 'Trust records', href: '#/trust' },
  { id: 'audit', label: 'Audit trail', href: '#/audit' },
  { id: 'reports', label: 'Reports', href: '#/reports' },
  { id: 'integrations', label: 'Integrations', href: '#/integrations' },
  { id: 'system', label: 'System', href: '#/system' },
];

export function renderShell() {
  document.getElementById('app').hidden = false;
  document.getElementById('rail-org').innerHTML = `<span>Signed in as</span>${esc(state.org?.name || '')}`;
  document.getElementById('nav').innerHTML = NAV.map((item) => {
    if (item.section) return `<div class="nav-label">${item.section}</div>`;
    return `<a href="${item.href}" data-nav="${item.id}">${item.label}</a>`;
  }).join('');
  const chip = document.getElementById('user-chip');
  chip.innerHTML = `<div class="avatar">${esc(initials(state.user?.full_name))}</div><div class="who">${esc(state.user?.full_name || '')}<span>${esc(titleCase(state.role))}</span></div>`;
  chip.title = state.user?.email || '';
  const select = document.getElementById('business-context');
  select.innerHTML = `<option value="">All accessible businesses</option>` + state.businesses
    .map((b) => `<option value="${b.id}" ${b.id === state.businessId ? 'selected' : ''}>${esc(b.legal_name)}</option>`).join('');
  select.onchange = () => {
    state.businessId = select.value || null;
    if (state.businessId) localStorage.setItem('aft.businessId', state.businessId);
    else localStorage.removeItem('aft.businessId');
    renderRoute();
  };
}

export function setCrumbs(items) {
  document.getElementById('crumbs').innerHTML = items.map((item, i) => {
    const last = i === items.length - 1;
    const node = last ? `<span class="here">${esc(item.label)}</span>` : `<a href="${item.href || '#'}">${esc(item.label)}</a>`;
    return (i ? '<span class="sep">/</span>' : '') + node;
  }).join('');
}

export function setActiveNav(id) {
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === id));
}

export function requireBusiness() {
  return state.businesses.find((b) => b.id === state.businessId) || null;
}

export function businessChooser(el, purpose) {
  el.innerHTML = `
    <div class="page-head"><div><p class="eyebrow">Business context</p><h1>Select a business</h1>
    <p class="sub">${esc(purpose || 'Choose an accessible business from the context selector above to continue.')}</p></div></div>
    <div class="card pad">
      <p class="small muted" style="margin-bottom:12px">You have access to ${state.businesses.length} business record${state.businesses.length === 1 ? '' : 's'}.</p>
      <div class="grid k3">
        ${state.businesses.map((b) => `<a class="card pad" href="#/businesses/${b.id}" style="display:block"><div style="display:flex;justify-content:space-between;align-items:center"><strong>${esc(b.legal_name)}</strong>${gradeBadge(b.stats?.evidence_grade)}</div><div class="small muted" style="margin-top:6px">${esc(b.city || '')}${b.city ? ', ' : ''}${esc(b.country_code || '')} · ${esc(titleCase(b.verification_status))}</div></a>`).join('')}
      </div>
    </div>`;
}

/* --------------------------------------------------------------- router */

export function route(pattern, handler) {
  const keys = [];
  const regex = new RegExp(`^${pattern.replace(/:([A-Za-z]+)/g, (_, key) => { keys.push(key); return '([^/]+)'; })}/?$`);
  ROUTES.push({ regex, keys, handler });
}

export function navigate(hash) {
  if (location.hash === hash) renderRoute();
  else location.hash = hash;
}

export function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '') || 'overview';
  const [pathPart, queryPart] = raw.split('?');
  return { segments: pathPart.split('/').filter(Boolean), query: new URLSearchParams(queryPart || '') };
}

export async function renderRoute() {
  const view = document.getElementById('view');
  const { segments } = parseHash();
  const path = segments.join('/') || 'overview';
  for (const r of ROUTES) {
    const match = path.match(r.regex);
    if (match) {
      if (currentCleanup) { try { currentCleanup(); } catch { /* ignore */ } currentCleanup = null; }
      view.innerHTML = '<div class="loading">Loading</div>';
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(match[i + 1])]));
      try {
        const cleanup = await r.handler(view, params);
        if (typeof cleanup === 'function') currentCleanup = cleanup;
      } catch (error) {
        if (error.status === 401) {
          window.dispatchEvent(new CustomEvent('aft:signed-out'));
          return;
        }
        view.innerHTML = `<div class="page-head"><div><p class="eyebrow">Request failed</p><h1>Unable to load this view</h1></div></div>${errorPanel(error)}`;
      }
      return;
    }
  }
  view.innerHTML = `<div class="page-head"><div><p class="eyebrow">404</p><h1>Page not found</h1><p class="sub">The requested view does not exist.</p></div></div>`;
}

export function startRouter() {
  window.addEventListener('hashchange', renderRoute);
  if (!location.hash) location.hash = '#/overview';
  else renderRoute();
}
