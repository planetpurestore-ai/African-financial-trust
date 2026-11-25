/* Workspace views: overview, business register, business record, documents, invoices. */

import {
  api, state, esc, money, num, pct, fmtDate, fmtDateTime, timeAgo, titleCase, statusChip, gradeBadge,
  provenanceLabel, empty, errorPanel, openModal, toast, navigate, requireBusiness, businessChooser,
  setCrumbs, setActiveNav,
} from './core.js?v=20261125-2';

/* --------------------------------------------------------------- shared */

export function pageHead({ eyebrow, title, sub, actions = '' }) {
  return `<div class="page-head">
    <div>${eyebrow ? `<p class="eyebrow">${esc(eyebrow)}</p>` : ''}<h1>${esc(title)}</h1>${sub ? `<p class="sub">${sub}</p>` : ''}</div>
    ${actions ? `<div class="page-actions">${actions}</div>` : ''}
  </div>`;
}

const canWrite = () => state.role !== 'auditor';
const isAdmin = () => ['system_admin', 'institution_admin'].includes(state.role);
const canManage = () => ['system_admin', 'institution_admin', 'business_admin'].includes(state.role);

function kpi(label, value, foot, tone = '') {
  return `<div class="card kpi ${tone}"><div class="label">${esc(label)}</div><div class="value">${value}</div>${foot ? `<div class="foot">${esc(foot)}</div>` : ''}</div>`;
}

function miniBar(label, value, total, suffix = '') {
  const width = total ? Math.round((value / total) * 100) : 0;
  return `<div class="mini-bar"><div class="lbl"><span>${esc(label)}</span><span>${num(value)}${suffix}</span></div><div class="track"><i style="width:${width}%"></i></div></div>`;
}

function businessLabel(b) {
  return `<div class="primary">${esc(b.legal_name)}</div><div class="sub">${esc(b.registration_number || 'No registration number')} · ${esc(b.country_code || '—')}</div>`;
}

/* ------------------------------------------------------------- overview */

export async function overviewView(el) {
  setActiveNav('overview');
  setCrumbs([{ label: 'Trust Engine', href: '#/overview' }, { label: 'Overview' }]);
  const [overview, businesses, mfa] = await Promise.all([
    api('/system/overview').then((r) => r.data),
    api('/businesses?limit=100').then((r) => r.data),
    api('/auth/mfa/status').then((r) => r.data).catch(() => ({ enabled: false })),
  ]);
  const counts = overview.counts || {};
  const gradeCounts = businesses.reduce((acc, b) => { const g = b.latest_grade || '—'; acc[g] = (acc[g] || 0) + 1; return acc; }, {});
  const verification = overview.verification_breakdown || [];
  const invoices = overview.invoice_breakdown || [];
  const totalBusinesses = counts.businesses || businesses.length || 1;

  el.innerHTML = `
    ${pageHead({
      eyebrow: 'Portfolio',
      title: 'Trust overview',
      sub: 'Live counts from the Trust Engine database. Every figure is scoped to the records your organisation is authorised to see.',
      actions: canWrite() ? `<button class="btn btn-primary" data-action="new-business">Register business</button>` : '',
    })}
    <div class="banner-strip"><span class="dot"></span> ${esc(state.org?.name || '')} · ${esc(titleCase(state.role))} · data as of ${esc(fmtDateTime(new Date()))}</div>
    <div class="notice warn" style="margin:14px 0"><span><strong>Demonstration data.</strong> The businesses and records currently shown are synthetic operational fixtures. Do not treat them as real customer data or onboard real records until production launch gates are complete.</span></div>
    ${isAdmin() ? `<div class="card pad section" style="border-left:3px solid var(--gold)"><div class="card-head"><div><h3>Account security</h3><p class="small muted">Protect this administrator account with an authenticator app. Recovery codes are shown only once.</p></div>${mfa.enabled ? statusChip('enabled', 'MFA enabled') : '<button class="btn btn-primary btn-sm" data-action="mfa-setup-overview">Set up MFA</button>'}</div><div id="mfa-overview-panel"></div></div>` : ''}
    <div class="grid k4">
      ${kpi('Businesses under coverage', num(counts.businesses), `${verification.reduce((s, v) => s + (v.status === 'verified' ? v.count : 0), 0)} independently verified`)}
      ${kpi('Invoice value recorded', money(counts.invoice_value, 'RWF'), `${num(counts.invoices)} invoices across all currencies`, 'teal')}
      ${kpi('Evidence awaiting review', num(counts.pending_matches), `${num(counts.pending_jobs)} extraction job(s) queued`)}
      ${kpi('Trust records issued', num(counts.trust_records), `${num(counts.documents)} source documents held`)}
    </div>

    <div class="grid split section">
      <div class="card">
        <div class="card-head"><h3>Business register</h3><a class="link" href="#/businesses">View all</a></div>
        <div class="table-wrap">
          <table class="data">
            <thead><tr><th>Business</th><th>Trust grade</th><th class="num">Score</th><th>Verification</th><th class="num">Invoices</th></tr></thead>
            <tbody>
              ${businesses.length ? businesses.slice(0, 7).map((b) => `
                <tr class="click" data-href="#/businesses/${b.id}">
                  <td>${businessLabel(b)}</td>
                  <td>${gradeBadge(b.latest_grade)}</td>
                  <td class="num">${b.latest_score != null ? Number(b.latest_score).toFixed(1) : '—'}</td>
                  <td>${statusChip(b.verification_status)}</td>
                  <td class="num">${num(b.invoice_count)}</td>
                </tr>`).join('') : `<tr><td colspan="5">${empty('No businesses yet', 'Register the first business to begin assembling evidence.')}</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>

      <div class="grid" style="gap:14px">
        <div class="card pad">
          <div class="section-head" style="margin-bottom:14px"><h2 style="font-size:16px">Evidence coverage</h2><span class="small muted">${num(counts.businesses)} records</span></div>
          <div class="mini-bars">
            ${verification.length ? verification.map((v) => miniBar(titleCase(v.status), v.count, totalBusinesses)).join('') : '<p class="small muted">No verification activity recorded.</p>'}
          </div>
          <div class="divider"></div>
          <div class="section-head" style="margin-bottom:12px"><h2 style="font-size:16px">Trust grades issued</h2></div>
          <div class="tag-row">
            ${['A', 'B', 'C', 'D', 'E'].map((g) => `<span class="tag-row" style="align-items:center;gap:6px">${gradeBadge(g)}<span class="small muted">${num(gradeCounts[g] || 0)}</span></span>`).join('')}
            <span class="tag-row" style="align-items:center;gap:6px">${gradeBadge(null)}<span class="small muted">${num(gradeCounts['—'] || 0)} not issued</span></span>
          </div>
        </div>
        <div class="card pad">
          <div class="section-head" style="margin-bottom:12px"><h2 style="font-size:16px">Invoice verification</h2></div>
          <div class="mini-bars">
            ${invoices.length ? invoices.map((i) => miniBar(titleCase(i.status), i.count, counts.invoices || 1)).join('') : '<p class="small muted">No invoices recorded.</p>'}
          </div>
          <p class="small muted" style="margin-top:14px">Values shown in the invoice currency; the portfolio total above mixes currencies and is therefore indicative only.</p>
        </div>
      </div>
    </div>

    <div class="grid split section">
      <div class="card">
        <div class="card-head"><h3>Recent invoices</h3><a class="link" href="#/invoices">All invoices</a></div>
        <div class="table-wrap">
          <table class="data">
            <thead><tr><th>Invoice</th><th>Business</th><th class="num">Amount</th><th>Verification</th><th>Issued</th></tr></thead>
            <tbody>
              ${(overview.recent_invoices || []).length ? overview.recent_invoices.map((i) => `
                <tr><td class="primary">${esc(i.invoice_number)}</td><td>${esc(i.legal_name)}</td>
                <td class="num">${money(i.total_amount, i.currency_code)}</td><td>${statusChip(i.verification_status)}</td><td class="small muted">${fmtDate(i.issue_date)}</td></tr>`).join('')
                : `<tr><td colspan="5">${empty('No invoices', 'Invoices appear here once recorded against a business.')}</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h3>Audit activity</h3><a class="link" href="#/audit">Audit trail</a></div>
        <div class="card-body">
          ${(overview.recent_activity || []).length ? `<div class="timeline">${overview.recent_activity.slice(0, 6).map((a) => `
            <div class="item"><div>${esc(titleCase(a.action))}</div><div class="when">${esc(titleCase(a.actor_type))} · ${timeAgo(a.created_at)}</div></div>`).join('')}</div>`
            : '<p class="small muted">No audit entries are visible for this organisation yet.</p>'}
        </div>
      </div>
    </div>`;

  el.querySelectorAll('[data-href]').forEach((row) => row.addEventListener('click', () => navigate(row.dataset.href)));
  const newBtn = el.querySelector('[data-action="new-business"]');
  if (newBtn) newBtn.addEventListener('click', () => businessModal());
  el.querySelector('[data-action="mfa-setup-overview"]')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const panel = el.querySelector('#mfa-overview-panel');
    button.disabled = true;
    button.textContent = 'Preparing…';
    panel.innerHTML = '<div class="notice info" style="margin-top:12px"><span>Preparing your secure MFA setup. Please wait…</span></div>';
    try {
      const setup = (await api('/auth/mfa/setup', { method: 'POST', body: {} })).data;
      const recoveryText = setup.recoveryCodes.join('\n');
      panel.innerHTML = `<div class="notice info" style="margin-top:12px"><span>Scan this otpauth URI in your authenticator app, or enter the secret manually.</span></div><div class="hash-box" style="margin-top:10px;word-break:break-all">${esc(setup.otpauthUri)}</div><p class="small muted" style="margin-top:8px">Manual secret:</p><div class="hash-box mono">${esc(setup.secret)}</div><button class="btn btn-sm" type="button" data-action="copy-mfa-secret-overview" style="margin-top:8px">Copy manual secret</button><p class="small muted">Save these recovery codes securely now:</p><div class="hash-box mono" id="mfa-recovery-overview">${setup.recoveryCodes.map((code) => esc(code)).join('<br>')}</div><button class="btn btn-sm" type="button" data-action="copy-recovery-overview" style="margin-top:8px">Copy recovery codes</button><form id="mfa-enable-overview-form" style="margin-top:12px;display:flex;gap:8px;align-items:end;flex-wrap:wrap"><label class="field"><span>Current authenticator code</span><input name="code" inputmode="numeric" minlength="6" maxlength="6" required></label><button class="btn btn-primary" type="submit">Enable MFA</button></form>`;
      panel.querySelector('[data-action="copy-mfa-secret-overview"]').addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(setup.secret); toast('Manual secret copied. Paste it into Google Authenticator.'); }
        catch { toast('Copy was blocked. Use the recovery copy button or try the page in Chrome.', 'error'); }
      });
      panel.querySelector('[data-action="copy-recovery-overview"]').addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(recoveryText); toast('Recovery codes copied. Paste them into your password manager.'); }
        catch { toast('Copy was blocked. Press and hold the codes to select and copy them.', 'error'); }
      });
      panel.querySelector('form').addEventListener('submit', async (submitEvent) => {
        submitEvent.preventDefault();
        const form = submitEvent.currentTarget;
        try { await api('/auth/mfa/enable', { method: 'POST', body: { code: form.code.value } }); toast('MFA enabled for this account.'); window.dispatchEvent(new HashChangeEvent('hashchange')); }
        catch (error) { toast(error.message, 'error'); }
      });
    } catch (error) { panel.innerHTML = `<div class="notice error" style="margin-top:12px"><span>${esc(error.message || 'MFA setup could not be started. Please try again.')}</span></div>`; button.disabled = false; button.textContent = 'Set up MFA'; }
  });
}

/* ------------------------------------------------------------ businesses */

export async function businessesView(el) {
  setActiveNav('businesses');
  setCrumbs([{ label: 'Trust Engine', href: '#/overview' }, { label: 'Businesses' }]);
  const query = new URLSearchParams(location.hash.split('?')[1] || '');
  const search = query.get('q') || '';
  const data = (await api(`/businesses?limit=100${search ? `&search=${encodeURIComponent(search)}` : ''}`)).data;
  el.innerHTML = `
    ${pageHead({
      eyebrow: 'Register',
      title: 'Businesses',
      sub: 'Every business record is owned by one organisation. Identity claims, documents, invoices and reconciliation evidence are held against it.',
      actions: canWrite() ? `<button class="btn btn-primary" data-action="new-business">Register business</button>` : '',
    })}
    <div class="toolbar">
      <input class="input" id="biz-search" placeholder="Search legal name, registration or TIN" value="${esc(search)}">
      <button class="btn" data-action="search">Search</button>
      <div class="spacer"></div>
      <span class="small muted">${num(data.length)} record${data.length === 1 ? '' : 's'}</span>
    </div>
    <div class="card">
      <div class="table-wrap">
        <table class="data">
          <thead><tr><th>Business</th><th>Country</th><th>Verification</th><th>Trust grade</th><th class="num">Documents</th><th class="num">Invoices</th><th class="num">Counterparties</th></tr></thead>
          <tbody>
            ${data.length ? data.map((b) => `
              <tr class="click" data-href="#/businesses/${b.id}">
                <td>${businessLabel(b)}</td>
                <td>${esc(b.country_code || '—')}</td>
                <td>${statusChip(b.verification_status)}</td>
                <td><div style="display:flex;align-items:center;gap:8px">${gradeBadge(b.latest_grade)}<span class="small">${b.latest_score != null ? Number(b.latest_score).toFixed(1) : '—'}</span></div></td>
                <td class="num">${num(b.document_count)}</td>
                <td class="num">${num(b.invoice_count)}</td>
                <td class="num">${num(b.counterparty_count)}</td>
              </tr>`).join('') : `<tr><td colspan="7">${empty('No matching businesses', 'Adjust the search or register a new business.')}</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>`;
  const run = () => {
    const value = el.querySelector('#biz-search').value.trim();
    navigate(`#/businesses${value ? `?q=${encodeURIComponent(value)}` : ''}`);
  };
  el.querySelector('[data-action="search"]').addEventListener('click', run);
  el.querySelector('#biz-search').addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
  el.querySelectorAll('[data-href]').forEach((row) => row.addEventListener('click', () => navigate(row.dataset.href)));
  const btn = el.querySelector('[data-action="new-business"]');
  if (btn) btn.addEventListener('click', () => businessModal());
}

export async function businessModal() {
  const profiles = (await api('/businesses/country-profiles')).data;
  const defaultProfile = profiles.find((profile) => profile.country_code === 'RW') || profiles[0];
  openModal({
    title: 'Register a business',
    subtitle: 'The record starts as self-declared. Verification is a separate, auditable act.',
    submitLabel: 'Create record',
    body: `<div class="form-grid">
      <label class="field span2"><span>Legal name</span><input name="legalName" required maxlength="255" placeholder="Registered entity name"></label>
      <label class="field"><span>Country / jurisdiction</span><select name="countryCode" required>${profiles.map((profile) => `<option value="${esc(profile.country_code)}" ${profile.country_code === defaultProfile?.country_code ? 'selected' : ''}>${esc(profile.name)} (${esc(profile.country_code)})</option>`).join('')}</select></label>
      <label class="field"><span id="registration-label">${esc(defaultProfile?.registration_label || 'Registration number')}</span><input name="registrationNumber" maxlength="120"></label>
      <label class="field"><span id="tax-label">${esc(defaultProfile?.tax_label || 'Tax identification number')}</span><input name="taxId" maxlength="120"></label>
      <label class="field"><span>Industry</span><input name="industry" maxlength="120" placeholder="Agri-processing, logistics…"></label>
      <label class="field"><span>City</span><input name="city" maxlength="120"></label>
      <label class="field"><span>Contact email</span><input name="email" type="email" maxlength="255"></label>
      <label class="field span2"><span>Registered address</span><input name="addressLine1" maxlength="255"></label>
    </div>
    <p class="small muted" style="margin-top:10px">The registration number and TIN are recorded as self-declared identifiers until an analyst independently verifies them.</p>`,
    onSubmit: async (fd) => {
      const body = Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v).trim() || null]));
      const created = (await api('/businesses', { method: 'POST', body })).data;
      toast('Business record created.');
      navigate(`#/businesses/${created.id}`);
    },
  });
  const form = document.querySelector('#modal-form');
  const country = form.querySelector('[name="countryCode"]');
  country.addEventListener('change', () => {
    const profile = profiles.find((item) => item.country_code === country.value);
    form.querySelector('#registration-label').textContent = profile?.registration_label || 'Registration number';
    form.querySelector('#tax-label').textContent = profile?.tax_label || 'Tax identification number';
  });
}

/* -------------------------------------------------------- business record */

export async function businessDetailView(el, params) {
  setActiveNav('businesses');
  const tab = params.tab || 'profile';
  const [business, history] = await Promise.all([
    api(`/businesses/${params.id}`).then((r) => r.data),
    api(`/businesses/${params.id}/history`).then((r) => r.data).catch(() => []),
  ]);
  let trust = null;
  try { trust = (await api(`/businesses/${params.id}/trust-record`)).data; } catch (error) { if (error.status !== 404) throw error; }
  setCrumbs([{ label: 'Trust Engine', href: '#/overview' }, { label: 'Businesses', href: '#/businesses' }, { label: business.legal_name }]);

  const tabs = [
    ['profile', 'Profile & evidence'],
    ['documents', 'Documents'],
    ['invoices', 'Invoices'],
    ['reconciliation', 'Reconciliation'],
    ['counterparties', 'Counterparties'],
    ['history', 'Change history'],
  ];
  const stats = business.stats || {};
  el.innerHTML = `
    <div class="business-head">
      <div class="avatar-lg">${esc(business.legal_name.slice(0, 2).toUpperCase())}</div>
      <div style="flex:1">
        <h1>${esc(business.legal_name)}</h1>
        <div class="meta">${esc(business.registration_number || 'No registration number')} · ${esc(business.tax_id || 'No TIN')} · ${esc(business.city || '')}${business.city ? ', ' : ''}${esc(business.country_code)} · ${esc(business.industry || 'Industry not stated')}</div>
      </div>
      <div style="display:flex;align-items:center;gap:12px">
        ${gradeBadge(trust?.evidence_grade || stats.evidence_grade)}
        <div class="right"><div class="small muted">Trust score</div><div style="font-family:var(--display);font-size:24px">${trust?.evidence_score != null ? Number(trust.evidence_score).toFixed(1) : stats.evidence_score != null ? Number(stats.evidence_score).toFixed(1) : '—'}</div></div>
      </div>
    </div>
    <div class="tabs">
      ${tabs.map(([key, label]) => `<a href="#/businesses/${business.id}${key === 'profile' ? '' : `/${key}`}" class="${tab === key ? 'active' : ''}">${label}</a>`).join('')}
    </div>
    <div id="tab-body"><div class="loading">Loading</div></div>`;

  const body = el.querySelector('#tab-body');
  if (tab === 'profile') renderProfileTab(body, business, trust, history);
  if (tab === 'documents') await renderBusinessDocuments(body, business);
  if (tab === 'invoices') await renderBusinessInvoices(body, business);
  if (tab === 'reconciliation') await renderBusinessReconciliation(body, business);
  if (tab === 'counterparties') await renderBusinessCounterparties(body, business);
  if (tab === 'history') renderHistoryTab(body, history);
}

function renderProfileTab(body, business, trust, history) {
  const stats = business.stats || {};
  const payload = trust?.payload || {};
  const evidence = payload.evidence || {};
  const categories = evidence.categories || [];
  const discrepancies = payload.discrepancies || [];
  const score = Number(trust?.evidence_score ?? stats.evidence_score ?? 0);
  const grade = trust?.evidence_grade || stats.evidence_grade;
  const circumference = 2 * Math.PI * 70;
  const dash = (Math.min(100, Math.max(0, score)) / 100) * circumference;
  body.innerHTML = `
    <div class="grid split">
      <div class="grid" style="gap:14px">
        <div class="card">
          <div class="card-head"><h3>Evidence assessment</h3><div class="small muted">${trust ? `Version ${trust.version} · ${fmtDateTime(trust.generated_at)}` : 'No trust record issued'}</div></div>
          <div class="trust-hero">
            <div class="ring">
              <svg width="168" height="168" viewBox="0 0 168 168" aria-hidden="true">
                <circle cx="84" cy="84" r="70" fill="none" stroke="#ece8dd" stroke-width="8"></circle>
                <circle cx="84" cy="84" r="70" fill="none" stroke="${score >= 65 ? '#39786f' : score >= 50 ? '#c69a43' : '#a8453a'}" stroke-width="8" stroke-linecap="butt" stroke-dasharray="${dash} ${circumference}"></circle>
              </svg>
              <div class="center"><div class="score">${trust ? score.toFixed(1) : '—'}</div><div class="of">of 100</div></div>
            </div>
            <div>
              <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">${gradeBadge(grade)}${statusChip(trust?.status || 'not_generated', trust ? titleCase(trust.status) : 'Not generated')}</div>
              <div class="trust-meta">
                <div><span>Coverage</span><strong>${trust ? pct(trust.coverage) : '—'}</strong></div>
                <div><span>Confidence</span><strong>${trust ? pct(trust.confidence) : '—'}</strong></div>
                <div><span>Methodology</span><strong style="font-size:14px">v${esc(trust?.methodology_version || '—')}</strong></div>
              </div>
              <p class="small muted" style="margin-top:12px">${trust ? 'Weighted across six evidence categories. Missing categories reduce coverage rather than being silently treated as positive.' : 'Generate a trust record to compute an evidence score from the records currently held.'}</p>
              <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">
                ${canWrite() ? `<button class="btn btn-gold" data-action="generate-trust">${trust ? 'Issue new version' : 'Generate trust record'}</button>` : ''}
                ${trust ? `<button class="btn" data-action="verify-hash">Verify hash</button><button class="btn" data-action="download-trust">Download JSON</button>` : ''}
              </div>
            </div>
          </div>
        </div>

        ${trust ? `<div class="card">
          <div class="card-head"><h3>Evidence categories</h3><span class="small muted">Weighted contribution</span></div>
          <div class="card-body evidence-list">
            ${categories.map((c) => {
              const value = Number(c.score || 0);
              return `<div class="evidence-row">
                <div class="top"><b>${esc(c.label)}</b><span class="val">${value.toFixed(1)} / 100 · weight ${c.weight}</span></div>
                <div class="bar"><i class="${value < 40 ? 'low' : value < 65 ? 'mid' : ''}" style="width:${Math.max(0, Math.min(100, value))}%"></i></div>
                <div class="detail">${esc(c.detail || '')}</div>
              </div>`;
            }).join('') || '<p class="small muted">No categories were applicable.</p>'}
          </div>
        </div>` : ''}

        ${discrepancies.length ? `<div class="card">
          <div class="card-head"><h3>Discrepancies</h3><span class="small muted">${discrepancies.length} flagged</span></div>
          <div class="card-body">
            ${discrepancies.map((d) => `<div class="discrepancy"><div class="sev">${statusChip(d.severity === 'high' ? 'inconsistent' : d.severity === 'medium' ? 'partial' : 'neutral', d.severity)}</div><div><b>${esc(titleCase(d.type))}</b><div class="small muted">${esc(d.description)}</div></div></div>`).join('')}
          </div>
        </div>` : ''}
      </div>

      <div class="grid" style="gap:14px">
        <div class="card">
          <div class="card-head"><h3>Identity</h3>${statusChip(business.verification_status)}</div>
          <div class="card-body">
            <dl class="defs">
              <dt>Legal name</dt><dd>${esc(business.legal_name)}</dd>
              <dt>Trading name</dt><dd>${esc(business.trading_name || '—')}</dd>
              <dt>Registration</dt><dd>${esc(business.registration_number || '—')}</dd>
              <dt>Tax ID</dt><dd>${esc(business.tax_id || '—')}</dd>
              <dt>Country</dt><dd>${esc(business.country_code)}</dd>
              <dt>Address</dt><dd>${esc([business.address_line1, business.city].filter(Boolean).join(', ') || '—')}</dd>
              <dt>Contact</dt><dd>${esc(business.email || '—')}</dd>
              <dt>Owner</dt><dd>${esc(business.owner_org_name || '—')}</dd>
              <dt>Verified</dt><dd>${business.verified_at ? `${fmtDate(business.verified_at)} · ${esc(titleCase(business.verification_method || ''))}` : 'Not independently verified'}</dd>
            </dl>
            ${isAdmin() ? `<button class="btn btn-sm" style="margin-top:14px" data-action="record-verification">Record verification decision</button>` : ''}
          </div>
        </div>

        <div class="card">
          <div class="card-head"><h3>Identifiers</h3><span class="small muted">${(business.identifiers || []).length}</span></div>
          <div class="card-body">
            ${(business.identifiers || []).length ? (business.identifiers || []).map((i) => `
              <div class="stat-line"><div><b>${esc(titleCase(i.identifier_type))}</b><div class="small muted">${esc(i.value)}</div></div><div>${statusChip(i.status)}</div></div>`).join('') : '<p class="small muted">No identifiers recorded.</p>'}
          </div>
        </div>

        <div class="card">
          <div class="card-head"><h3>Portfolio position</h3></div>
          <div class="card-body">
            <div class="stat-line"><span>Documents</span><b>${num(stats.documents)}</b></div>
            <div class="stat-line"><span>Invoices</span><b>${num(stats.invoices)}</b></div>
            <div class="stat-line"><span>Outstanding receivables</span><b>${money(stats.outstanding_receivables, business.country_code === 'KE' ? 'KES' : 'RWF')}</b></div>
            <div class="stat-line"><span>Counterparties</span><b>${num(stats.counterparties)}</b></div>
            <div class="stat-line"><span>Transactions</span><b>${num(stats.transactions)}</b></div>
            <div class="stat-line"><span>Pending matches</span><b>${num(stats.pending_matches)}</b></div>
            <div class="stat-line"><span>Inconsistent invoices</span><b>${num(stats.inconsistent_invoices)}</b></div>
          </div>
        </div>

        ${trust ? `<div class="card">
          <div class="card-head"><h3>Record integrity</h3><span class="small muted">SHA-256</span></div>
          <div class="card-body">
            <div class="small muted" style="margin-bottom:5px">Record hash</div>
            <div class="hash-box">${esc(trust.hash)}</div>
            <div class="small muted" style="margin:10px 0 5px">Previous hash</div>
            <div class="hash-box">${esc(trust.previous_hash || 'Genesis record — no predecessor')}</div>
            <div class="stat-line" style="margin-top:10px"><span>Generated by</span><b class="small">${esc(trust.generated_by_user_id || 'System')}</b></div>
            <div class="stat-line"><span>Evidence items</span><b>${num((trust.evidence || []).length)}</b></div>
          </div>
        </div>` : ''}
      </div>
    </div>`;

  const generate = body.querySelector('[data-action="generate-trust"]');
  if (generate) generate.addEventListener('click', async () => {
    generate.disabled = true;
    try {
      await api(`/businesses/${business.id}/trust-record/generate`, { method: 'POST', body: {} });
      toast('Trust record issued.');
      navigate(`#/businesses/${business.id}`);
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    } catch (error) { toast(error.message, 'error'); generate.disabled = false; }
  });
  const verify = body.querySelector('[data-action="verify-hash"]');
  if (verify) verify.addEventListener('click', async () => {
    try {
      const result = (await api(`/trust-records/${trust.id}/verify-hash`)).data;
      toast(result.valid ? 'Hash verified against stored payload.' : 'Hash mismatch — record integrity cannot be confirmed.', result.valid ? 'success' : 'error');
    } catch (error) { toast(error.message, 'error'); }
  });
  const download = body.querySelector('[data-action="download-trust"]');
  if (download) download.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(trust, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `trust-record-${business.legal_name.replace(/\W+/g, '-').toLowerCase()}-v${trust.version}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
  const record = body.querySelector('[data-action="record-verification"]');
  if (record) record.addEventListener('click', () => verificationModal(business));
}

function verificationModal(business) {
  openModal({
    title: 'Record a verification decision',
    subtitle: 'This is a human judgement and will be attributed in the audit chain.',
    submitLabel: 'Record decision',
    body: `<div class="form-grid">
      <label class="field"><span>Outcome</span><select name="outcome">
        <option value="verified">Verified</option><option value="partially_verified">Partially verified</option>
        <option value="documents_submitted">Documents submitted</option><option value="unverified">Unverified</option><option value="rejected">Rejected</option>
      </select></label>
      <label class="field"><span>Method</span><select name="method">
        <option value="manual_registry_check">Manual registry check</option><option value="document_review">Document review</option>
        <option value="counterparty_confirmation">Counterparty confirmation</option><option value="field_visit">Field visit</option><option value="other">Other</option>
      </select></label>
      <label class="field span2"><span>Reference</span><input name="reference" maxlength="255" placeholder="Registry file number, certificate reference…"></label>
      <label class="field span2"><span>Note</span><textarea name="note" maxlength="2000" placeholder="What was checked, and against which source?"></textarea></label>
    </div>
    <p class="small muted" style="margin-top:10px">AFT does not claim a registry connection. Record only checks you actually performed.</p>`,
    onSubmit: async (fd) => {
      await api(`/businesses/${business.id}/verify`, { method: 'POST', body: Object.fromEntries(fd.entries()) });
      toast('Verification decision recorded.');
      navigate(`#/businesses/${business.id}`);
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    },
  });
}

async function renderBusinessDocuments(body, business) {
  const docs = (await api(`/documents?businessId=${business.id}&limit=100`)).data;
  body.innerHTML = documentsCard(docs, business.id);
  bindDocumentActions(body, business.id);
}

async function renderBusinessInvoices(body, business) {
  const [invoices, counterparties] = await Promise.all([
    api(`/invoices?businessId=${business.id}&limit=100`).then((r) => r.data),
    api(`/counterparties?businessId=${business.id}`).then((r) => r.data),
  ]);
  body.innerHTML = invoicesCard(invoices, business, counterparties);
  bindInvoiceActions(body, business, counterparties);
}

function renderHistoryTab(body, history) {
  body.innerHTML = `<div class="card pad">
    ${(history || []).length ? `<div class="timeline">${history.map((h) => `<div class="item"><div><b>${esc(titleCase(h.change_type || h.action || 'Change'))}</b>${h.reason ? ` — ${esc(h.reason)}` : ''}</div><div class="small muted">${esc(h.note || '')}</div><div class="when">${fmtDateTime(h.created_at)} · ${esc(h.actor_id || 'System')}</div></div>`).join('')}</div>` : empty('No changes recorded', 'Identity and verification changes will appear here.')}
  </div>`;
}

/* -------------------------------------------------------------- documents */

export function documentsCard(docs, businessId, { action = true } = {}) {
  return `<div class="card">
    <div class="card-head"><h3>Documents</h3><span class="small muted">${docs.length} file${docs.length === 1 ? '' : 's'}</span>${action && canWrite() ? `<button class="btn btn-sm btn-primary" data-action="upload-doc" data-business="${businessId}">Upload document</button>` : ''}</div>
    <div class="table-wrap">
      <table class="data">
        <thead><tr><th>File</th><th>Detected type</th><th>Extraction</th><th>Status</th><th class="num">Confidence</th><th>Received</th><th></th></tr></thead>
        <tbody>
          ${docs.length ? docs.map((d) => `<tr>
            <td><div class="primary">${esc(d.original_filename)}</div><div class="sub">${esc(d.mime_type)} · ${(Number(d.size_bytes) / 1024).toFixed(0)} KB</div></td>
            <td>${esc(titleCase(d.doc_type || 'unclassified'))}</td>
            <td>${d.extraction_method ? `<span class="small">${esc(titleCase(d.extraction_method))}</span>` : '<span class="small muted">Not extracted</span>'}</td>
            <td>${statusChip(d.status)}${d.duplicate_of_id ? ' <span class="small muted">duplicate</span>' : ''}</td>
            <td class="num">${d.extraction_confidence != null ? pct(d.extraction_confidence) : '—'}</td>
            <td class="small muted nowrap">${fmtDate(d.created_at)}</td>
            <td class="right"><button class="btn-link" data-doc="${d.id}">Open</button></td>
          </tr>`).join('') : `<tr><td colspan="7">${empty('No documents', 'Upload an invoice, purchase order, delivery note or contract to begin extraction.')}</td></tr>`}
        </tbody>
      </table>
    </div>
  </div>`;
}

export function bindDocumentActions(root, businessId) {
  root.querySelectorAll('[data-doc]').forEach((b) => b.addEventListener('click', () => documentModal(b.dataset.doc, businessId)));
  const upload = root.querySelector('[data-action="upload-doc"]');
  if (upload) upload.addEventListener('click', () => uploadModal(businessId));
}

export async function documentsView(el) {
  setActiveNav('documents');
  setCrumbs([{ label: 'Trust Engine', href: '#/overview' }, { label: 'Documents' }]);
  const business = requireBusiness();
  if (!business) return businessChooser(el, 'Documents are held against a specific business. Choose one to view its evidence library.');
  const docs = (await api(`/documents?businessId=${business.id}&limit=100`)).data;
  el.innerHTML = `${pageHead({ eyebrow: 'Evidence library', title: 'Documents', sub: `Source files held for ${esc(business.legal_name)}. Extraction is deterministic and every field retains its provenance.`, actions: canWrite() ? `<button class="btn btn-primary" data-action="upload-doc" data-business="${business.id}">Upload document</button>` : '' })}
    ${documentsCard(docs, business.id, { action: false })}`;
  bindDocumentActions(el, business.id);
}

export function uploadModal(businessId) {
  openModal({
    title: 'Upload a source document',
    subtitle: 'PDF, PNG, JPEG, CSV or XLSX. Files are hashed, stored privately and deduplicated by content.',
    submitLabel: 'Upload and extract',
    body: `<label class="field"><span>File</span><input type="file" name="file" required accept=".pdf,.png,.jpg,.jpeg,.csv,.xlsx,.xls"></label>
      <div class="notice info" style="margin-top:6px"><span>Extraction reads text and tabular content. It does not verify the document; fields must be reviewed before use.</span></div>`,
    onSubmit: async (fd) => {
      const form = new FormData();
      form.append('file', fd.get('file'));
      form.append('businessId', businessId);
      const result = (await api('/documents', { method: 'POST', form })).data;
      toast(result.duplicate ? 'Document already held; duplicate recorded.' : 'Document uploaded and queued for extraction.');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    },
  });
}

export async function documentModal(id, businessId) {
  const doc = (await api(`/documents/${id}`)).data;
  const fields = doc.fields || [];
  const extractions = doc.extractions || [];
  openModal({
    title: doc.original_filename,
    subtitle: `${titleCase(doc.doc_type || 'unclassified')} · ${doc.status} · received ${fmtDate(doc.created_at)}`,
    wide: true,
    body: `<div class="grid k2">
      <div>
        <div class="section-head"><h2 style="font-size:16px">Extracted fields</h2><span class="small muted">${fields.length} fields</span></div>
        ${fields.length ? `<div class="table-wrap"><table class="data"><thead><tr><th>Field</th><th>Value</th><th>Provenance</th><th></th></tr></thead><tbody>
          ${fields.map((f) => `<tr><td>${esc(titleCase(f.field_name))}</td><td class="primary">${esc(f.field_value)}</td><td><span class="provenance" title="Confidence ${pct(f.confidence)}">${esc(provenanceLabel(f.provenance || 'document_extracted'))}</span></td>
          <td class="right">${canWrite() ? `<button class="btn-link" data-field="${f.id}" data-name="${esc(f.field_name)}" data-value="${esc(f.field_value)}">Review</button>` : ''}</td></tr>`).join('')}
        </tbody></table></div>` : '<p class="small muted">No fields were extracted. The file may be scanned without OCR text or unsupported.</p>'}
      </div>
      <div>
        <div class="section-head"><h2 style="font-size:16px">Extraction runs</h2></div>
        ${extractions.length ? extractions.map((x) => `<div class="stat-line"><span>${esc(titleCase(x.method))} · ${x.status}</span><b>${x.confidence != null ? pct(x.confidence) : '—'}</b></div>`).join('') : '<p class="small muted">No extraction runs recorded.</p>'}
        <div class="divider"></div>
        <dl class="defs">
          <dt>Document type</dt><dd>${esc(titleCase(doc.doc_type || '—'))} ${doc.doc_type_confidence != null ? `<span class="small muted">(${pct(doc.doc_type_confidence)})</span>` : ''}</dd>
          <dt>SHA-256</dt><dd class="mono" style="word-break:break-all">${esc(doc.content_hash || '—')}</dd>
          <dt>Pages</dt><dd>${esc(doc.page_count ?? '—')}</dd>
          <dt>Duplicate of</dt><dd>${doc.duplicate_of_id ? esc(doc.duplicate_of_id) : 'No'}</dd>
          <dt>Error</dt><dd>${esc(doc.error_message || 'None')}</dd>
        </dl>
        <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">
          <a class="btn btn-sm" href="/api/v1/documents/${doc.id}/file" target="_blank" rel="noopener">Open original</a>
          ${canWrite() ? `<button class="btn btn-sm" data-action="reprocess">Re-run extraction</button>` : ''}
        </div>
      </div>
    </div>`,
    footer: '',
  });
  const root = document.getElementById('modal-root');
  root.querySelector('[data-action="reprocess"]')?.addEventListener('click', async (event) => {
    event.target.disabled = true;
    try {
      await api(`/documents/${doc.id}/process-now`, { method: 'POST', body: {} });
      toast('Extraction completed.');
      closeAndRefresh();
    } catch (error) { toast(error.message, 'error'); event.target.disabled = false; }
  });
  root.querySelectorAll('[data-field]').forEach((b) => b.addEventListener('click', () => reviewFieldModal(doc.id, b.dataset.field, b.dataset.name, b.dataset.value)));
}

function reviewFieldModal(docId, fieldId, name, value) {
  openModal({
    title: `Review ${titleCase(name)}`,
    subtitle: 'A corrected value is recorded as human-reviewed and attributed in the audit chain.',
    submitLabel: 'Save review',
    body: `<label class="field"><span>Value</span><input name="value" value="${esc(value)}" required maxlength="500"></label>`,
    onSubmit: async (fd) => {
      await api(`/documents/${docId}/fields/${fieldId}`, { method: 'PATCH', body: { value: fd.get('value') } });
      toast('Field review recorded.');
      closeAndRefresh();
    },
  });
}

function closeAndRefresh() {
  document.getElementById('modal-root').hidden = true;
  document.getElementById('modal-root').innerHTML = '';
  document.body.style.overflow = '';
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

/* --------------------------------------------------------------- invoices */

export function invoicesCard(invoices, business, counterparties, { action = true } = {}) {
  return `<div class="card">
    <div class="card-head"><h3>Invoices</h3><span class="small muted">${invoices.length} record${invoices.length === 1 ? '' : 's'}</span>${action && canWrite() ? `<button class="btn btn-sm btn-primary" data-action="new-invoice">Record invoice</button>` : ''}</div>
    <div class="table-wrap">
      <table class="data">
        <thead><tr><th>Invoice</th><th>Counterparty</th><th class="num">Total</th><th class="num">Outstanding</th><th>Verification</th><th>Payment</th><th>Due</th><th></th></tr></thead>
        <tbody>
          ${invoices.length ? invoices.map((i) => `<tr>
            <td><div class="primary">${esc(i.invoice_number)}</div><div class="sub">${esc(titleCase(i.source || 'manual'))}${i.po_number ? ` · PO ${esc(i.po_number)}` : ''}</div></td>
            <td>${esc(i.counterparty_name || '—')}</td>
            <td class="num">${money(i.total_amount, i.currency_code)}</td>
            <td class="num">${money(i.balance_due, i.currency_code)}</td>
            <td>${statusChip(i.verification_status)}${i.verification_score != null ? `<div class="sub">${Number(i.verification_score).toFixed(1)} / 100</div>` : ''}</td>
            <td>${statusChip(i.status)}</td>
            <td class="small muted nowrap">${fmtDate(i.due_date)}</td>
            <td class="right"><button class="btn-link" data-invoice="${i.id}">Open</button></td>
          </tr>`).join('') : `<tr><td colspan="8">${empty('No invoices', 'Record an invoice manually or upload a source document.')}</td></tr>`}
        </tbody>
      </table>
    </div>
  </div>`;
}

export function bindInvoiceActions(root, business, counterparties) {
  root.querySelectorAll('[data-invoice]').forEach((b) => b.addEventListener('click', () => invoiceModal(b.dataset.invoice, business, counterparties)));
  root.querySelector('[data-action="new-invoice"]')?.addEventListener('click', () => invoiceFormModal(business, counterparties));
}

export async function invoicesView(el) {
  setActiveNav('invoices');
  setCrumbs([{ label: 'Trust Engine', href: '#/overview' }, { label: 'Invoices' }]);
  const business = requireBusiness();
  if (!business) return businessChooser(el, 'Invoices belong to a business record. Choose one to inspect its receivables and verification results.');
  const [invoices, counterparties] = await Promise.all([
    api(`/invoices?businessId=${business.id}&limit=100`).then((r) => r.data),
    api(`/counterparties?businessId=${business.id}`).then((r) => r.data),
  ]);
  el.innerHTML = `${pageHead({ eyebrow: 'Receivables', title: 'Invoices', sub: `Invoice integrity is assessed against purchase orders, delivery evidence, payments and duplicate checks for ${esc(business.legal_name)}.`, actions: canWrite() ? `<button class="btn btn-primary" data-action="new-invoice">Record invoice</button>` : '' })}
    ${invoicesCard(invoices, business, counterparties, { action: false })}`;
  bindInvoiceActions(el, business, counterparties);
}

function invoiceFormModal(business, counterparties) {
  const today = new Date().toISOString().slice(0, 10);
  openModal({
    title: 'Record an invoice',
    subtitle: 'Amounts are checked arithmetically before the invoice can be verified.',
    submitLabel: 'Record invoice',
    wide: true,
    body: `<div class="form-grid">
      <label class="field"><span>Invoice number</span><input name="invoiceNumber" required maxlength="120"></label>
      <label class="field"><span>Counterparty</span><select name="counterpartyId"><option value="">Not linked</option>${counterparties.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></label>
      <label class="field"><span>Issue date</span><input type="date" name="issueDate" value="${today}" required></label>
      <label class="field"><span>Due date</span><input type="date" name="dueDate"></label>
      <label class="field"><span>Currency</span><select name="currency">${['RWF', 'KES', 'NGN', 'GHS', 'ZAR', 'USD', 'EUR', 'TZS', 'UGX', 'XOF', 'EGP'].map((c) => `<option>${c}</option>`).join('')}</select></label>
      <label class="field"><span>Total amount</span><input name="totalAmount" type="number" step="0.01" min="0.01" required></label>
      <label class="field"><span>Subtotal (optional)</span><input name="subtotal" type="number" step="0.01" min="0"></label>
      <label class="field"><span>Tax amount (optional)</span><input name="taxAmount" type="number" step="0.01" min="0"></label>
      <label class="field"><span>Purchase order number</span><input name="poNumber" maxlength="120"></label>
      <label class="field"><span>Description</span><input name="description" maxlength="500"></label>
    </div>`,
    onSubmit: async (fd) => {
      const body = Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v).trim() === '' ? null : String(v).trim()]));
      body.businessId = business.id;
      for (const key of ['totalAmount', 'subtotal', 'taxAmount']) if (body[key] != null) body[key] = Number(body[key]);
      await api('/invoices', { method: 'POST', body });
      toast('Invoice recorded.');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    },
  });
}

export async function invoiceModal(id, business, counterparties) {
  const invoice = (await api(`/invoices/${id}`)).data;
  const verification = invoice.verification;
  const result = verification?.rules_json || {};
  const rules = result.rules || [];
  openModal({
    title: `Invoice ${invoice.invoice_number}`,
    subtitle: `${business.legal_name} → ${invoice.counterparty_name || 'Unlinked counterparty'} · ${fmtDate(invoice.issue_date)}`,
    wide: true,
    body: `<div class="grid k2">
      <div>
        <div class="section-head"><h2 style="font-size:16px">Verification</h2>${statusChip(invoice.verification_status)}</div>
        ${verification ? `<p class="small muted" style="margin-bottom:10px">Score ${Number(result.score ?? invoice.verification_score ?? 0).toFixed(2)} / 100 · coverage ${pct((result.coverage ?? 0) / 100)} · ${fmtDateTime(verification.created_at)}</p>${result.summary ? `<p class="small" style="margin-bottom:10px">${esc(result.summary)}</p>` : ''}` : '<p class="small muted" style="margin-bottom:10px">This invoice has not been through the verification engine.</p>'}
        ${rules.length ? rules.map((r) => `<div class="stat-line"><div><b>${esc(r.label || titleCase(r.id))}</b><div class="small muted">${esc(r.detail || '')}</div></div><div>${r.status === 'pass' ? '<span class="chip ok">Pass</span>' : r.status === 'warn' ? '<span class="chip warn">Review</span>' : r.status === 'missing' ? '<span class="chip neutral">Missing</span>' : '<span class="chip bad">Fail</span>'}</div></div>`).join('') : ''}
        ${canWrite() ? `<button class="btn btn-sm btn-primary" style="margin-top:12px" data-action="verify">${verification ? 'Re-run verification' : 'Verify invoice'}</button>` : ''}
        <div class="divider"></div>
        <div class="section-head"><h2 style="font-size:16px">Line items</h2></div>
        ${(invoice.lines || []).length ? `<div class="table-wrap"><table class="data"><thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Unit</th><th class="num">Total</th></tr></thead><tbody>
          ${invoice.lines.map((l) => `<tr><td>${esc(l.description)}</td><td class="num">${num(l.quantity)}</td><td class="num">${money(l.unit_price, invoice.currency_code)}</td><td class="num">${money(l.line_total, invoice.currency_code)}</td></tr>`).join('')}
        </tbody></table></div>` : '<p class="small muted">No line items recorded.</p>'}
      </div>
      <div>
        <dl class="defs">
          <dt>Total</dt><dd>${money(invoice.total_amount, invoice.currency_code)}</dd>
          <dt>Paid</dt><dd>${money(invoice.amount_paid, invoice.currency_code)}</dd>
          <dt>Outstanding</dt><dd>${money(invoice.balance_due, invoice.currency_code)}</dd>
          <dt>Status</dt><dd>${statusChip(invoice.status)}</dd>
          <dt>Issue date</dt><dd>${fmtDate(invoice.issue_date)}</dd>
          <dt>Due date</dt><dd>${fmtDate(invoice.due_date)}</dd>
          <dt>Purchase order</dt><dd>${esc(invoice.po_number || '—')}</dd>
          <dt>Document</dt><dd>${invoice.document_id ? `<a class="btn-link" href="#" data-open-doc="${invoice.document_id}">View source</a>` : 'Not linked'}</dd>
        </dl>
        <div class="divider"></div>
        <div class="section-head"><h2 style="font-size:16px">Payments</h2>${canWrite() ? '<button class="btn-link" data-action="payment">Record payment</button>' : ''}</div>
        ${(invoice.payments || []).length ? invoice.payments.map((p) => `<div class="stat-line"><div><b>${money(p.amount, p.currency_code)}</b><div class="small muted">${fmtDate(p.paid_at)} · ${esc(titleCase(p.method))}${p.reference ? ` · ${esc(p.reference)}` : ''}</div></div>${statusChip(p.source === 'reconciliation' ? 'accepted' : 'confirmed', titleCase(p.source))}</div>`).join('') : '<p class="small muted">No payments recorded.</p>'}
      </div>
    </div>`,
    footer: '',
  });
  const root = document.getElementById('modal-root');
  root.querySelector('[data-action="verify"]')?.addEventListener('click', async (event) => {
    event.target.disabled = true;
    try {
      await api(`/invoices/${invoice.id}/verify`, { method: 'POST', body: {} });
      toast('Verification completed.');
      closeAndRefresh();
    } catch (error) { toast(error.message, 'error'); event.target.disabled = false; }
  });
  root.querySelector('[data-action="payment"]')?.addEventListener('click', () => paymentModal(invoice));
  root.querySelector('[data-open-doc]')?.addEventListener('click', (event) => { event.preventDefault(); closeAndRefresh(); documentModal(event.target.dataset.openDoc, business.id); });
}

function paymentModal(invoice) {
  openModal({
    title: 'Record a payment',
    subtitle: `Against invoice ${invoice.invoice_number}. This is a manually captured payment, not a bank confirmation.`,
    submitLabel: 'Record payment',
    body: `<div class="form-grid">
      <label class="field"><span>Amount</span><input name="amount" type="number" step="0.01" min="0.01" required value="${Math.max(0, Number(invoice.balance_due || 0))}"></label>
      <label class="field"><span>Currency</span><input name="currency" value="${esc(invoice.currency_code)}" required maxlength="3"></label>
      <label class="field"><span>Paid on</span><input name="paidAt" type="date" value="${new Date().toISOString().slice(0, 10)}" required></label>
      <label class="field"><span>Method</span><select name="method"><option value="bank_transfer">Bank transfer</option><option value="mobile_money">Mobile money</option><option value="cash">Cash</option><option value="cheque">Cheque</option><option value="other">Other</option></select></label>
      <label class="field span2"><span>Reference</span><input name="reference" maxlength="120"></label>
    </div>`,
    onSubmit: async (fd) => {
      const body = Object.fromEntries(fd.entries());
      body.amount = Number(body.amount);
      await api(`/invoices/${invoice.id}/payments`, { method: 'POST', body });
      toast('Payment recorded.');
      closeAndRefresh();
    },
  });
}

/* ------------------------------------------------- business sub-resources */

async function renderBusinessReconciliation(body, business) {
  const { reconciliationsCard, bindReconciliationActions } = await import('./views-ops.js');
  const rows = (await api(`/reconciliation?businessId=${business.id}`)).data;
  body.innerHTML = reconciliationsCard(rows, business);
  bindReconciliationActions(body, business);
}

async function renderBusinessCounterparties(body, business) {
  const { counterpartiesCard, bindCounterpartyActions } = await import('./views-ops.js');
  const rows = (await api(`/counterparties?businessId=${business.id}`)).data;
  body.innerHTML = counterpartiesCard(rows, business);
  bindCounterpartyActions(body, business);
}
