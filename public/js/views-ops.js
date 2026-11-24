/* Operational views: reconciliation, counterparties, integrations, audit, reports, system. */

import {
  api, state, esc, money, num, pct, fmtDate, fmtDateTime, timeAgo, titleCase, statusChip, gradeBadge,
  empty, openModal, toast, navigate, requireBusiness, businessChooser, setCrumbs, setActiveNav, closeModal,
} from './core.js?v=20261124-3';
import { pageHead } from './views-core.js?v=20261124-3';

const canWrite = () => state.role !== 'auditor';
const canManage = () => ['system_admin', 'institution_admin', 'business_admin'].includes(state.role);

/* -------------------------------------------------------- reconciliation */

export function reconciliationsCard(rows, business) {
  return `<div class="card">
    <div class="card-head"><h3>Reconciliation runs</h3>${canWrite() ? '<button class="btn btn-sm btn-primary" data-action="run-recon">Run reconciliation</button>' : ''}</div>
    <div class="table-wrap">
      <table class="data">
        <thead><tr><th>Run</th><th>Period</th><th class="num">Transactions</th><th class="num">Invoices</th><th class="num">Exact</th><th class="num">Probable</th><th class="num">Partial</th><th class="num">Unmatched</th><th></th></tr></thead>
        <tbody>
          ${rows.length ? rows.map((r) => {
            const s = r.stats_json || {};
            return `<tr>
              <td><div class="primary">${fmtDateTime(r.created_at)}</div><div class="sub">${esc(r.run_by_name || 'System')}</div></td>
              <td class="small">${fmtDate(r.period_start)} – ${fmtDate(r.period_end)}</td>
              <td class="num">${num(r.transaction_count ?? s.transactions)}</td>
              <td class="num">${num(r.invoice_count ?? s.invoices)}</td>
              <td class="num">${num(s.exact)}</td>
              <td class="num">${num(s.probable)}</td>
              <td class="num">${num(s.partial)}</td>
              <td class="num">${num((s.unmatched_invoices || 0) + (s.unmatched_transactions || 0))}</td>
              <td class="right"><button class="btn-link" data-recon="${r.id}">Inspect</button></td>
            </tr>`;
          }).join('') : `<tr><td colspan="9">${empty('No reconciliation runs', 'Import a bank or mobile-money statement, then reconcile it against outstanding invoices.')}</td></tr>`}
        </tbody>
      </table>
    </div>
  </div>`;
}

export function bindReconciliationActions(root, business) {
  root.querySelectorAll('[data-recon]').forEach((b) => b.addEventListener('click', () => reconciliationModal(b.dataset.recon, business)));
  root.querySelector('[data-action="run-recon"]')?.addEventListener('click', () => runReconciliationModal(business));
}

export async function reconciliationView(el) {
  setActiveNav('reconciliation');
  setCrumbs([{ label: 'Trust Engine', href: '#/overview' }, { label: 'Reconciliation' }]);
  const business = requireBusiness();
  if (!business) return businessChooser(el, 'Reconciliation compares a business bank or mobile-money statement with its outstanding invoices.');
  const rows = (await api(`/reconciliation?businessId=${business.id}`)).data;
  el.innerHTML = `${pageHead({
    eyebrow: 'Payment evidence',
    title: 'Reconciliation',
    sub: `Deterministic matching of imported transactions against invoices for ${esc(business.legal_name)}. A suggested match is not evidence until a human accepts it.`,
    actions: canWrite() ? `<button class="btn" data-action="import-tx">Import statement</button><button class="btn btn-primary" data-action="run-recon">Run reconciliation</button>` : '',
  })}
    ${reconciliationsCard(rows, business)}`;
  bindReconciliationActions(el, business);
  el.querySelector('[data-action="import-tx"]')?.addEventListener('click', () => importTransactionsModal(business));
}

function runReconciliationModal(business) {
  openModal({
    title: 'Run reconciliation',
    subtitle: 'Default tolerances are applied unless overridden. Matching is rule-based and fully explained.',
    submitLabel: 'Run',
    body: `<div class="form-grid">
      <label class="field"><span>From (optional)</span><input type="date" name="from"></label>
      <label class="field"><span>To (optional)</span><input type="date" name="to"></label>
      <label class="field"><span>Date window (days)</span><input type="number" name="dateWindowDays" min="0" max="365" value="10"></label>
      <label class="field"><span>Amount tolerance (%)</span><input type="number" name="amountPercent" min="0" max="100" step="0.1" value="0.5"></label>
    </div>
    <p class="small muted" style="margin-top:10px">Only transactions and invoices inside the period are considered. Existing accepted matches are preserved.</p>`,
    onSubmit: async (fd) => {
      const body = { businessId: business.id, rules: {} };
      if (fd.get('from')) body.from = fd.get('from');
      if (fd.get('to')) body.to = fd.get('to');
      if (fd.get('dateWindowDays') !== '') body.rules.dateWindowDays = Number(fd.get('dateWindowDays'));
      if (fd.get('amountPercent') !== '') body.rules.amountPercent = Number(fd.get('amountPercent'));
      await api('/reconciliation/run', { method: 'POST', body });
      toast('Reconciliation completed.');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    },
  });
}

function importTransactionsModal(business) {
  openModal({
    title: 'Import a statement',
    subtitle: 'CSV or JSON. Columns are detected automatically; amounts and dates are parsed deterministically.',
    submitLabel: 'Import',
    wide: true,
    body: `<div class="form-grid">
      <label class="field"><span>Source</span><select name="sourceType"><option value="bank">Bank statement</option><option value="mobile_money">Mobile money</option><option value="other">Other</option></select></label>
      <label class="field"><span>Provider</span><input name="provider" maxlength="120" placeholder="Bank of Kigali, MTN MoMo…"></label>
      <label class="field span2"><span>CSV file</span><input type="file" name="file" accept=".csv,.json"></label>
    </div>
    <p class="small muted" style="margin-top:10px">The file is parsed locally by the server; no external connection is implied. Imported rows retain the file name and batch reference.</p>`,
    onSubmit: async (fd) => {
      const form = new FormData();
      form.append('file', fd.get('file'));
      form.append('businessId', business.id);
      form.append('sourceType', fd.get('sourceType'));
      if (fd.get('provider')) form.append('provider', fd.get('provider'));
      await api('/transactions/import', { method: 'POST', form });
      toast('Statement imported.');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    },
  });
}

export async function reconciliationModal(id, business) {
  const recon = (await api(`/reconciliation/${id}`)).data;
  const matches = recon.matches || [];
  const s = recon.stats_json || {};
  openModal({
    title: 'Reconciliation result',
    subtitle: `${fmtDateTime(recon.created_at)} · ${s.exact || 0} exact, ${s.probable || 0} probable, ${s.partial || 0} partial`,
    wide: true,
    body: `<div class="grid k4" style="margin-bottom:16px">
      <div class="card kpi"><div class="label">Matched value</div><div class="value" style="font-size:24px">${money(s.matched_value, matches[0]?.currency_code || 'RWF')}</div></div>
      <div class="card kpi"><div class="label">Unmatched invoices</div><div class="value" style="font-size:24px">${num(s.unmatched_invoices)}</div></div>
      <div class="card kpi"><div class="label">Unmatched transactions</div><div class="value" style="font-size:24px">${num(s.unmatched_transactions)}</div></div>
      <div class="card kpi"><div class="label">Rule window</div><div class="value" style="font-size:24px">${num(recon.rules_json?.dateWindowDays)}d</div></div>
    </div>
    ${matches.length ? `<div class="table-wrap"><table class="data">
      <thead><tr><th>Invoice</th><th>Transaction</th><th class="num">Amount</th><th>Match</th><th class="num">Score</th><th>Status</th><th></th></tr></thead>
      <tbody>${matches.map((m) => `<tr>
        <td><div class="primary">${esc(m.invoice_number || '—')}</div><div class="sub">${m.issue_date ? fmtDate(m.issue_date) : ''}</div></td>
        <td><div>${esc(m.transaction_reference || '—')}</div><div class="sub">${m.transaction_date ? fmtDate(m.transaction_date) : ''} ${esc(m.counterparty_name || '')}</div></td>
        <td class="num">${money(m.amount_applied, m.currency_code)}</td>
        <td>${statusChip(m.match_type === 'exact' ? 'exact' : m.match_type === 'probable' ? 'probable' : m.match_type === 'partial' ? 'partial' : 'unmatched', titleCase(m.match_type))}</td>
        <td class="num">${pct(m.score)}</td>
        <td>${statusChip(m.status)}</td>
        <td class="right">${m.status === 'suggested' && canWrite() ? `<button class="btn btn-sm" data-match="${m.id}" data-decision="accept">Accept</button> <button class="btn btn-sm btn-danger" data-match="${m.id}" data-decision="reject">Reject</button>` : ''}</td>
      </tr>`).join('')}</tbody>
    </table></div>` : '<p class="small muted">No matches were produced.</p>'}
    <p class="small muted" style="margin-top:12px">Accepting a match creates a payment record with provenance “reconciliation”. Rejecting preserves the audit trail and leaves the transaction unmatched.</p>`,
    footer: '',
  });
  const root = document.getElementById('modal-root');
  root.querySelectorAll('[data-match]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    try {
      await api(`/reconciliation/matches/${b.dataset.match}/${b.dataset.decision}`, { method: 'POST', body: {} });
      toast(b.dataset.decision === 'accept' ? 'Match accepted; payment recorded.' : 'Match rejected.');
      closeModal();
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    } catch (error) { toast(error.message, 'error'); b.disabled = false; }
  }));
}

/* ---------------------------------------------------------- counterparties */

export function counterpartiesCard(rows, business) {
  return `<div class="card">
    <div class="card-head"><h3>Counterparties</h3>${canWrite() ? '<button class="btn btn-sm btn-primary" data-action="new-counterparty">Add counterparty</button>' : ''}</div>
    <div class="table-wrap">
      <table class="data">
        <thead><tr><th>Name</th><th>Relationship</th><th>Status</th><th>Confirmation</th><th class="num">Transactions</th><th></th></tr></thead>
        <tbody>
          ${rows.length ? rows.map((c) => `<tr>
            <td><div class="primary">${esc(c.name)}</div><div class="sub">${esc(c.country_code || '')} ${c.registration_number ? `· ${esc(c.registration_number)}` : ''}</div></td>
            <td>${esc(titleCase(c.relationship))}</td>
            <td>${statusChip(c.status)}</td>
            <td class="small muted">${c.confirmed_at ? `Confirmed ${fmtDate(c.confirmed_at)}` : c.confirmation_sent_at ? `Sent ${fmtDate(c.confirmation_sent_at)}` : 'Not requested'}</td>
            <td class="num">${num(c.transaction_count)}</td>
            <td class="right">${canWrite() ? `<button class="btn-link" data-confirm-cp="${c.id}">Request confirmation</button>` : ''}</td>
          </tr>`).join('') : `<tr><td colspan="6">${empty('No counterparties', 'Add the customers and suppliers whose invoices you want corroborated.')}</td></tr>`}
        </tbody>
      </table>
    </div>
  </div>`;
}

export function bindCounterpartyActions(root, business) {
  root.querySelector('[data-action="new-counterparty"]')?.addEventListener('click', () => counterpartyModal(business));
  root.querySelectorAll('[data-confirm-cp]').forEach((b) => b.addEventListener('click', () => requestConfirmationModal(b.dataset.confirmCp, business)));
}

export async function counterpartiesView(el) {
  setActiveNav('counterparties');
  setCrumbs([{ label: 'Trust Engine', href: '#/overview' }, { label: 'Counterparties' }]);
  const business = requireBusiness();
  if (!business) return businessChooser(el, 'Counterparty confirmation is recorded against a specific business and invoice.');
  const rows = (await api(`/counterparties?businessId=${business.id}`)).data;
  el.innerHTML = `${pageHead({
    eyebrow: 'Third-party corroboration',
    title: 'Counterparties',
    sub: `Counterparty confirmation is one of the strongest evidence categories. Links are single-use, expire after 14 days and expose only the invoice summary.`,
    actions: canWrite() ? `<button class="btn btn-primary" data-action="new-counterparty">Add counterparty</button>` : '',
  })}
    ${counterpartiesCard(rows, business)}`;
  bindCounterpartyActions(el, business);
}

function counterpartyModal(business) {
  openModal({
    title: 'Add a counterparty',
    subtitle: 'A counterparty is a customer or supplier on the other side of an invoice.',
    submitLabel: 'Add counterparty',
    body: `<div class="form-grid">
      <label class="field span2"><span>Name</span><input name="name" required maxlength="255"></label>
      <label class="field"><span>Relationship</span><select name="relationship"><option value="customer">Customer</option><option value="supplier">Supplier</option><option value="both">Both</option></select></label>
      <label class="field"><span>Country</span><select name="countryCode"><option value="RW">Rwanda</option><option value="KE">Kenya</option><option value="NG">Nigeria</option><option value="GH">Ghana</option><option value="ZA">South Africa</option><option value="TZ">Tanzania</option><option value="UG">Uganda</option><option value="ZM">Zambia</option></select></label>
      <label class="field"><span>Registration number</span><input name="registrationNumber" maxlength="120"></label>
      <label class="field"><span>Email for confirmation</span><input name="email" type="email" maxlength="255"></label>
    </div>`,
    onSubmit: async (fd) => {
      const body = Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v).trim() || null]));
      body.businessId = business.id;
      await api('/counterparties', { method: 'POST', body });
      toast('Counterparty added.');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    },
  });
}

async function requestConfirmationModal(counterpartyId, business) {
  const invoices = (await api(`/invoices?businessId=${business.id}&limit=100`)).data;
  const own = invoices.filter((i) => i.counterparty_id === counterpartyId);
  openModal({
    title: 'Request counterparty confirmation',
    subtitle: 'The counterparty confirms or disputes the invoice through a single-use public link.',
    submitLabel: 'Generate link',
    body: `<label class="field"><span>Invoice</span><select name="invoiceId" required>${own.map((i) => `<option value="${i.id}">${esc(i.invoice_number)} · ${money(i.total_amount, i.currency_code)}</option>`).join('') || '<option value="">No invoice is linked to this counterparty</option>'}</select></label>
      <div class="notice info" style="margin-top:8px"><span>No email provider is configured. The link is generated for you to send through your normal channel.</span></div>`,
    onSubmit: async (fd) => {
      if (!fd.get('invoiceId')) throw new Error('Record an invoice for this counterparty first.');
      const result = (await api(`/counterparties/${counterpartyId}/request-confirmation`, {
        method: 'POST',
        body: { invoiceId: fd.get('invoiceId'), baseUrl: location.origin },
      })).data;
      openModal({
        title: 'Confirmation link generated',
        subtitle: `Expires ${fmtDate(result.expiresAt)}. Send it to the counterparty through your normal channel.`,
        body: `<p class="small muted" style="margin-bottom:8px">Single-use link</p>
          <div class="hash-box" id="confirm-url">${esc(result.confirmationUrl)}</div>
          <div style="display:flex;gap:8px;margin-top:12px"><button class="btn" type="button" data-copy>Copy link</button><a class="btn" href="${esc(result.confirmationUrl)}" target="_blank" rel="noopener">Open preview</a></div>
          <p class="small muted" style="margin-top:12px">${esc(result.note)}</p>`,
        footer: '',
      });
      document.querySelector('[data-copy]')?.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(result.confirmationUrl); toast('Link copied.'); } catch { toast('Copy failed; select the link manually.', 'error'); }
      });
    },
  });
}

/* --------------------------------------------------------------- integrations */

const INTEGRATION_TONE = {
  connected: 'ok', configured: 'warn', awaiting_credentials: 'warn', not_configured: 'neutral', error: 'bad', disabled: 'neutral',
};

export async function integrationsView(el) {
  setActiveNav('integrations');
  setCrumbs([{ label: 'Trust Engine', href: '#/overview' }, { label: 'Integrations' }]);
  const rows = (await api('/integrations')).data;
  const grouped = rows.reduce((acc, r) => { (acc[r.category] ||= []).push(r); return acc; }, {});
  el.innerHTML = `${pageHead({
    eyebrow: 'Adapters',
    title: 'Integrations',
    sub: 'Adapter catalogue with explicit connection state. An adapter is only “connected” after a real authenticated check succeeds; credentials are encrypted at rest.',
    actions: `<a class="btn" href="/api/v1/openapi.json" target="_blank" rel="noopener">API contract</a>`,
  })}
    <div class="notice" style="margin-bottom:16px"><span><strong>Honest status.</strong> No provider is connected by default. Adding credentials does not make an integration live; run “Test connection” and read the recorded result.</span></div>
    ${Object.entries(grouped).map(([category, items]) => `<div class="section">
      <div class="section-head"><h2>${esc(titleCase(category))}</h2><span class="small muted">${items.length} adapter${items.length === 1 ? '' : 's'}</span></div>
      <div class="grid k3">
        ${items.map((r) => `<div class="card pad">
          <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start">
            <div><div style="font-weight:600;font-size:13px">${esc(r.name)}</div><div class="small muted">${esc(r.provider)} · ${esc((r.countries || []).join(', '))}</div></div>
            <span class="chip ${INTEGRATION_TONE[r.status] || 'neutral'}">${esc(titleCase(r.status))}</span>
          </div>
          <div class="tag-row" style="margin-top:10px">${(r.capabilities || []).map((c) => `<span class="tag">${esc(titleCase(c))}</span>`).join('')}</div>
          ${r.last_checked_at ? `<p class="small muted" style="margin-top:8px">Checked ${timeAgo(r.last_checked_at)}${r.last_error ? ` · ${esc(r.last_error)}` : ''}</p>` : ''}
          <div style="display:flex;gap:6px;margin-top:12px;flex-wrap:wrap">
            ${canManage() ? `<button class="btn btn-sm" data-config="${r.provider}">${r.id ? 'Credentials' : 'Configure'}</button>` : ''}
            ${r.id && canManage() ? `<button class="btn btn-sm" data-check="${r.id}">Test connection</button>` : ''}
            ${r.docs ? `<a class="btn btn-sm" href="${esc(r.docs)}" target="_blank" rel="noopener">Docs</a>` : ''}
          </div>
        </div>`).join('')}
      </div>
    </div>`).join('')}`;
  el.querySelectorAll('[data-config]').forEach((b) => b.addEventListener('click', () => integrationConfigModal(rows.find((r) => r.provider === b.dataset.config))));
  el.querySelectorAll('[data-check]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    b.textContent = 'Checking…';
    try {
      const result = (await api(`/integrations/${b.dataset.check}/check`, { method: 'POST', body: {} })).data;
      toast(result.ok ? 'Authenticated check succeeded; status updated.' : `Check failed: ${result.error || 'see integration record'}`, result.ok ? 'success' : 'error');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    } catch (error) { toast(error.message, 'error'); b.disabled = false; b.textContent = 'Test connection'; }
  }));
}

function integrationConfigModal(item) {
  openModal({
    title: item.name,
    subtitle: 'Credentials are encrypted with AES-256-GCM before storage and never returned by the API.',
    submitLabel: 'Save credentials',
    body: `<div class="form-grid">
      ${(item.credential_keys || []).map((k) => `<label class="field ${k.required ? '' : ''}"><span>${esc(k.label)}${k.required ? '' : ' (optional)'}</span><input name="cred_${esc(k.key)}" autocomplete="off" ${item.credentials_configured ? 'placeholder="Leave blank to keep existing"' : ''}></label>`).join('')}
      ${(item.config_keys || []).map((k) => `<label class="field"><span>${esc(k.label)}</span><input name="cfg_${esc(k.key)}" value="${esc(item.config?.[k.key] ?? k.default ?? '')}"></label>`).join('')}
      <label class="field"><span>Environment</span><select name="environment"><option value="sandbox" ${item.environment === 'sandbox' ? 'selected' : ''}>Sandbox</option><option value="production" ${item.environment === 'production' ? 'selected' : ''}>Production</option></select></label>
    </div>
    <p class="small muted" style="margin-top:10px">Saving credentials marks the adapter “configured”, not “connected”. Use Test connection to perform an authenticated request.</p>`,
    onSubmit: async (fd) => {
      let id = item.id;
      if (!id) {
        const created = (await api('/integrations', { method: 'POST', body: { provider: item.provider, environment: fd.get('environment') || 'sandbox', config: {} } })).data;
        id = created.id;
      }
      const credentials = {};
      const config = {};
      for (const [key, value] of fd.entries()) {
        if (key.startsWith('cred_') && String(value).trim()) credentials[key.slice(5)] = String(value).trim();
        if (key.startsWith('cfg_')) config[key.slice(4)] = String(value);
      }
      if (Object.keys(credentials).length) await api(`/integrations/${id}/credentials`, { method: 'PUT', body: credentials });
      await api(`/integrations/${id}`, { method: 'PATCH', body: { config, status: 'configured' } });
      toast('Integration configuration saved. Run a connection test to verify it.');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    },
  });
}

/* ---------------------------------------------------------------- audit */

export async function auditView(el) {
  setActiveNav('audit');
  setCrumbs([{ label: 'Trust Engine', href: '#/overview' }, { label: 'Audit trail' }]);
  const [entries, verify] = await Promise.all([
    api('/audit?limit=100').then((r) => r.data),
    api('/audit/verify').then((r) => r.data).catch((e) => ({ valid: false, error: e.message })),
  ]);
  el.innerHTML = `${pageHead({
    eyebrow: 'Governance',
    title: 'Audit trail',
    sub: 'Each organisation has an append-only SHA-256 hash chain. Any alteration to a stored entry breaks verification from that point onward.',
    actions: `<button class="btn" data-action="verify-chain">Verify chain</button>`,
  })}
    <div class="grid k3 section" style="margin-top:0">
      <div class="card kpi ${verify.valid ? 'teal' : ''}"><div class="label">Chain status</div><div class="value" style="font-size:24px">${verify.valid ? 'Intact' : 'Broken'}</div><div class="foot">${num(verify.count ?? verify.entries ?? entries.length)} entries checked</div></div>
      <div class="card kpi plain"><div class="label">Head hash</div><div class="mono" style="margin-top:10px;word-break:break-all">${esc(String(verify.head?.hash || verify.head_hash || '—').slice(0, 40))}…</div><div class="foot">Sequence ${esc(String(verify.head?.seq ?? '—'))}</div></div>
      <div class="card kpi plain"><div class="label">Broken at</div><div class="value" style="font-size:20px">${esc(String(verify.broken_at || verify.brokenAt || verify.broken?.seq || 'None'))}</div><div class="foot">Entry identifier if integrity failed</div></div>
    </div>
    <div class="card section">
      <div class="card-head"><h3>Recent entries</h3><span class="small muted">Newest first</span></div>
      <div class="table-wrap">
        <table class="data">
          <thead><tr><th>When</th><th>Action</th><th>Entity</th><th>Actor</th><th>Hash</th></tr></thead>
          <tbody>
            ${entries.length ? entries.map((a) => `<tr>
              <td class="small nowrap">${fmtDateTime(a.created_at)}</td>
              <td class="primary">${esc(titleCase(a.action))}</td>
              <td class="small">${esc(titleCase(a.entity_type || '—'))}<div class="sub mono">${esc((a.entity_id || '').slice(-8))}</div></td>
              <td class="small">${esc(titleCase(a.actor_type))}<div class="sub">${esc(a.actor_id || '')}</div></td>
              <td class="mono" style="max-width:220px;overflow:hidden;text-overflow:ellipsis" title="${esc(a.hash || '')}">${esc((a.hash || '').slice(0, 18))}…</td>
            </tr>`).join('') : `<tr><td colspan="5">${empty('No audit entries', 'Actions performed through the API will be recorded here.')}</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>`;
  el.querySelector('[data-action="verify-chain"]').addEventListener('click', async () => {
    try {
      const result = (await api('/audit/verify')).data;
      toast(result.valid ? `Chain intact across ${result.entries} entries.` : `Chain verification failed at ${result.broken_at || 'an unknown entry'}.`, result.valid ? 'success' : 'error');
    } catch (error) { toast(error.message, 'error'); }
  });
}

/* --------------------------------------------------------------- reports */

export async function reportsView(el) {
  setActiveNav('reports');
  setCrumbs([{ label: 'Trust Engine', href: '#/overview' }, { label: 'Reports' }]);
  const [types, reports] = await Promise.all([
    api('/reports/types').then((r) => r.data),
    api('/reports').then((r) => r.data),
  ]);
  const business = requireBusiness();
  el.innerHTML = `${pageHead({
    eyebrow: 'Evidence packs',
    title: 'Reports',
    sub: 'Generated documents state their sources, methodology version and limitations. PDF and CSV are rendered from the same underlying record.',
    actions: `<button class="btn btn-primary" data-action="new-report" ${canWrite() ? '' : 'disabled'}>Generate report</button>`,
  })}
    <div class="card">
      <div class="card-head"><h3>Available report types</h3><span class="small muted">${types.length} types</span></div>
      <div class="card-body"><div class="grid k3">${types.map((t) => `<div style="border-left:2px solid var(--line-dark);padding:4px 0 4px 12px"><div style="font-weight:600;font-size:12.5px">${esc(titleCase(t))}</div><div class="small muted">${reportDescription(t)}</div></div>`).join('')}</div></div>
    </div>
    <div class="card section">
      <div class="card-head"><h3>Generated reports</h3><span class="small muted">Stored privately</span></div>
      <div class="table-wrap">
        <table class="data">
          <thead><tr><th>Type</th><th>Format</th><th>Business</th><th>Generated</th><th class="num">Size</th><th></th></tr></thead>
          <tbody>
            ${reports.length ? reports.map((r) => `<tr>
              <td class="primary">${esc(titleCase(r.report_type))}</td><td>${esc(r.format.toUpperCase())}</td>
              <td class="small">${esc(r.business_id ? (state.businesses.find((b) => b.id === r.business_id)?.legal_name || r.business_id) : 'Organisation-wide')}</td>
              <td class="small muted">${fmtDateTime(r.created_at)}</td><td class="num">${(Number(r.size_bytes) / 1024).toFixed(0)} KB</td>
              <td class="right"><a class="btn-link" href="/api/v1/reports/${r.id}/download">Download</a></td>
            </tr>`).join('') : `<tr><td colspan="6">${empty('No reports generated', 'Generate a report to produce a dated evidence pack.')}</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>`;
  el.querySelector('[data-action="new-report"]')?.addEventListener('click', () => reportModal(types, business));
}

function reportDescription(type) {
  return {
    business_verification: 'Identity, identifiers and verification decisions.',
    invoice_verification: 'Invoice-level rule results and provenance.',
    receivables: 'Outstanding balances and ageing.',
    reconciliation: 'Match decisions and unmatched items.',
    counterparty: 'Confirmation status and conflicts.',
    trust_record: 'Full trust record with evidence and hash.',
    evidence_completeness: 'Coverage by evidence category.',
    discrepancies: 'Flagged inconsistencies and duplicates.',
    audit: 'Organisation audit chain extract.',
  }[type] || '';
}

function reportModal(types, business) {
  openModal({
    title: 'Generate a report',
    subtitle: 'Reports are written to private storage and linked to the generating organisation.',
    submitLabel: 'Generate',
    body: `<div class="form-grid">
      <label class="field"><span>Report type</span><select name="type">${types.map((t) => `<option value="${t}">${esc(titleCase(t))}</option>`).join('')}</select></label>
      <label class="field"><span>Format</span><select name="format"><option value="pdf">PDF</option><option value="csv">CSV</option></select></label>
      <label class="field span2"><span>Business</span><select name="businessId" ${business ? '' : 'required'}><option value="">${business ? 'Organisation-wide (audit only)' : 'Select a business'}</option>${state.businesses.map((b) => `<option value="${b.id}" ${business?.id === b.id ? 'selected' : ''}>${esc(b.legal_name)}</option>`).join('')}</select></label>
    </div>`,
    onSubmit: async (fd) => {
      const body = { type: fd.get('type'), format: fd.get('format') };
      if (fd.get('businessId')) body.businessId = fd.get('businessId');
      await api('/reports', { method: 'POST', body });
      toast('Report generated.');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    },
  });
}

/* ---------------------------------------------------------------- system */

export async function systemView(el) {
  setActiveNav('system');
  setCrumbs([{ label: 'Trust Engine', href: '#/overview' }, { label: 'System' }]);
  const [health, jobs, mfa] = await Promise.all([
    api('/system/health').then((r) => r.data),
    api('/system/jobs?limit=50').then((r) => r.data).catch(() => []),
    api('/auth/mfa/status').then((r) => r.data).catch(() => ({ enabled: false })),
  ]);
  const failed = jobs.filter((j) => j.status === 'failed');
  el.innerHTML = `${pageHead({
    eyebrow: 'Operations',
    title: 'System health',
    sub: 'Runtime state, database connectivity, storage usage and the durable extraction queue.',
    actions: `<button class="btn" data-action="refresh">Refresh</button>`,
  })}
    <div class="card pad section">
      <div class="card-head"><div><h3>Multi-factor authentication</h3><p class="small muted">Protect this account with a TOTP authenticator app. Recovery codes are shown only once.</p></div>${mfa.enabled ? statusChip('enabled', 'Enabled') : '<button class="btn btn-primary btn-sm" data-action="mfa-setup">Set up MFA</button>'}</div>
      <div id="mfa-panel"></div>
    </div>
    <div class="grid k4">
      <div class="card kpi ${health.status === 'operational' ? 'teal' : ''}"><div class="label">Status</div><div class="value" style="font-size:24px">${esc(titleCase(health.status))}</div><div class="foot">v${esc(health.version)} · ${esc(health.environment)}</div></div>
      <div class="card kpi"><div class="label">Database</div><div class="value" style="font-size:24px">${health.database?.connected ? 'Connected' : 'Unavailable'}</div><div class="foot">${num(health.database?.latency_ms)} ms · ${health.database?.error ? esc(health.database.error) : 'TLS connection'}</div></div>
      <div class="card kpi plain"><div class="label">Uptime</div><div class="value" style="font-size:24px">${Math.floor((health.uptime_seconds || 0) / 3600)}h ${Math.floor(((health.uptime_seconds || 0) % 3600) / 60)}m</div><div class="foot">${num(health.memory_mb)} MB resident</div></div>
      <div class="card kpi plain"><div class="label">Storage</div><div class="value" style="font-size:24px">${(Number(health.storage?.bytes || 0) / 1048576).toFixed(1)} MB</div><div class="foot">Private document store</div></div>
    </div>
    <div class="grid k2 section">
      <div class="card pad">
        <div class="section-head"><h2 style="font-size:16px">Job queue</h2><span class="small muted">${num(health.jobs?.queued)} queued · ${num(health.jobs?.failed)} failed</span></div>
        <div class="stat-line"><span>Completed</span><b>${num(health.jobs?.completed)}</b></div>
        <div class="stat-line"><span>Running</span><b>${num(health.jobs?.running)}</b></div>
        <div class="stat-line"><span>Failed (all time)</span><b>${num(health.jobs?.failed_total)}</b></div>
        <div class="stat-line"><span>Integrations connected</span><b>${num(health.integrations_live)}</b></div>
      </div>
      <div class="card pad">
        <div class="section-head"><h2 style="font-size:16px">Operational limits</h2></div>
        <div class="checklist">
          <div><span class="tick">•</span> Deterministic invoice rules; no model decides validity.</div>
          <div><span class="tick">•</span> Extraction confidence is recorded, never treated as verification.</div>
          <div><span class="tick">•</span> Missing evidence reduces coverage; it is not silently positive.</div>
          <div><span class="tick">•</span> External registries require credentials and are off by default.</div>
        </div>
      </div>
    </div>
    <div class="card section">
      <div class="card-head"><h3>Recent jobs</h3><span class="small muted">${failed.length} failed</span></div>
      <div class="table-wrap"><table class="data">
        <thead><tr><th>Type</th><th>Entity</th><th>Status</th><th class="num">Attempts</th><th>Last error</th><th>Finished</th><th></th></tr></thead>
        <tbody>${jobs.length ? jobs.map((j) => `<tr>
          <td class="primary">${esc(j.job_type)}</td><td class="mono">${esc((j.entity_id || '').slice(-10))}</td><td>${statusChip(j.status)}</td>
          <td class="num">${num(j.attempts)} / ${num(j.max_attempts)}</td><td class="small muted">${esc(j.last_error || '—')}</td><td class="small muted">${j.finished_at ? timeAgo(j.finished_at) : '—'}</td>
          <td class="right">${j.status === 'failed' && canWrite() ? `<button class="btn btn-sm" data-retry="${j.id}">Retry</button>` : ''}</td>
        </tr>`).join('') : `<tr><td colspan="7">${empty('No jobs', 'Document extraction jobs appear here.')}</td></tr>`}</tbody>
      </table></div>
    </div>`;
  el.querySelector('[data-action="refresh"]').addEventListener('click', () => window.dispatchEvent(new HashChangeEvent('hashchange')));
  el.querySelector('[data-action="mfa-setup"]')?.addEventListener('click', async (event) => {
    event.currentTarget.disabled = true;
    try {
      const setup = (await api('/auth/mfa/setup', { method: 'POST', body: {} })).data;
      const panel = el.querySelector('#mfa-panel');
      panel.innerHTML = `<div class="notice info" style="margin-top:12px"><span>Scan this otpauth URI in your authenticator app, or enter the secret manually.</span></div><div class="hash-box" style="margin-top:10px;word-break:break-all">${esc(setup.otpauthUri)}</div><p class="small muted" style="margin-top:8px">Manual secret: <span class="mono">${esc(setup.secret)}</span></p><p class="small muted">Recovery codes (save securely now):</p><div class="hash-box mono">${setup.recoveryCodes.map((code) => esc(code)).join('<br>')}</div><form id="mfa-enable-form" style="margin-top:12px;display:flex;gap:8px;align-items:end;flex-wrap:wrap"><label class="field"><span>Current authenticator code</span><input name="code" inputmode="numeric" minlength="6" maxlength="6" required></label><button class="btn btn-primary" type="submit">Enable MFA</button></form>`;
      panel.querySelector('form').addEventListener('submit', async (submitEvent) => {
        submitEvent.preventDefault();
        const form = submitEvent.currentTarget;
        try { await api('/auth/mfa/enable', { method: 'POST', body: { code: form.code.value } }); toast('MFA enabled for this account.'); window.dispatchEvent(new HashChangeEvent('hashchange')); }
        catch (error) { toast(error.message, 'error'); }
      });
    } catch (error) { toast(error.message, 'error'); event.currentTarget.disabled = false; }
  });
  el.querySelectorAll('[data-retry]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    try { await api(`/system/jobs/${b.dataset.retry}/retry`, { method: 'POST', body: {} }); toast('Job re-queued.'); window.dispatchEvent(new HashChangeEvent('hashchange')); }
    catch (error) { toast(error.message, 'error'); b.disabled = false; }
  }));
}

/* ------------------------------------------------------------ trust index */

export async function trustIndexView(el) {
  setActiveNav('trust');
  setCrumbs([{ label: 'Trust Engine', href: '#/overview' }, { label: 'Trust records' }]);
  const businesses = (await api('/businesses?limit=100')).data;
  el.innerHTML = `${pageHead({
    eyebrow: 'Verifiable records',
    title: 'Trust records',
    sub: 'Versioned, hash-chained assessments. Each version references its predecessor, so the history cannot be rewritten without detection.',
  })}
    <div class="card">
      <div class="table-wrap"><table class="data">
        <thead><tr><th>Business</th><th>Grade</th><th class="num">Score</th><th class="num">Coverage</th><th>Status</th><th>Generated</th><th></th></tr></thead>
        <tbody>${businesses.length ? businesses.map((b) => `<tr>
          <td>${esc(b.legal_name)}<div class="sub">${esc(b.country_code)} · ${esc(titleCase(b.verification_status))}</div></td>
          <td>${gradeBadge(b.latest_grade)}</td><td class="num">${b.latest_score != null ? Number(b.latest_score).toFixed(1) : '—'}</td>
          <td class="num">${b.stats?.coverage != null ? pct(b.stats.coverage) : '—'}</td>
          <td>${statusChip(b.stats?.trust_status || (b.latest_grade ? 'verified_profile' : 'not_configured'), b.stats?.trust_status ? titleCase(b.stats.trust_status) : b.latest_grade ? 'Issued' : 'Not issued')}</td>
          <td class="small muted">${b.stats?.trust_record_generated_at ? fmtDateTime(b.stats.trust_record_generated_at) : '—'}</td>
          <td class="right"><a class="btn-link" href="#/businesses/${b.id}">Open</a></td>
        </tr>`).join('') : `<tr><td colspan="7">${empty('No businesses', 'Register a business before issuing a trust record.')}</td></tr>`}</tbody>
      </table></div>
    </div>`;
}
