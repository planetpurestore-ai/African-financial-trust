import { z } from 'zod';
import { execute, many, one, withTransaction } from '../../db/pool.js';
import { writeAudit, writeAuditStandalone } from '../../lib/audit.js';
import { decryptSecret, encryptSecret } from '../../lib/crypto.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { ulid } from '../../lib/ids.js';
import { getProvider, PROVIDERS } from './catalogue.js';

function json(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

export async function listIntegrations(orgId) {
  const rows = await many('SELECT * FROM integrations WHERE org_id = ? ORDER BY category, display_name', [orgId]);
  const byProvider = new Map(rows.map((r) => [r.provider, r]));
  return PROVIDERS.map((definition) => {
    const row = byProvider.get(definition.provider);
    return {
      provider: definition.provider,
      name: definition.name,
      category: definition.category,
      countries: definition.countries,
      capabilities: definition.capabilities,
      docs: definition.docs,
      manual: Boolean(definition.manual),
      credential_keys: definition.credentialKeys,
      config_keys: definition.configKeys,
      id: row?.id || null,
      status: row?.status || 'not_configured',
      environment: row?.environment || null,
      config: json(row?.config_json),
      last_checked_at: row?.last_checked_at || null,
      last_error: row?.last_error || null,
      credentials_configured: Boolean(row?.id),
    };
  });
}

export async function getIntegration(orgId, id) {
  const row = await one('SELECT * FROM integrations WHERE id = ? AND org_id = ?', [id, orgId]);
  if (!row) throw notFound('Integration not found');
  const definition = getProvider(row.provider);
  const credentialRows = await many('SELECT key_name, rotated_at FROM integration_credentials WHERE integration_id = ?', [id]);
  return {
    ...row,
    config: json(row.config_json),
    definition: definition
      ? { name: definition.name, credentialKeys: definition.credentialKeys, configKeys: definition.configKeys, docs: definition.docs, manual: Boolean(definition.manual) }
      : null,
    credentials: credentialRows.map((c) => ({ key: c.key_name, configured: true, rotated_at: c.rotated_at })),
  };
}

export const createIntegrationSchema = z.object({
  provider: z.string().min(2).max(60),
  environment: z.enum(['sandbox', 'production']).default('production'),
  config: z.record(z.any()).optional(),
});

export async function createIntegration(auth, input) {
  const definition = getProvider(input.provider);
  if (!definition) throw badRequest(`Unknown provider: ${input.provider}`);
  const existing = await one('SELECT * FROM integrations WHERE org_id = ? AND provider = ? AND environment = ?', [
    auth.org.id,
    input.provider,
    input.environment,
  ]);
  if (existing) return getIntegration(auth.org.id, existing.id);
  const id = ulid();
  const config = { ...Object.fromEntries(definition.configKeys.map((k) => [k.key, k.default ?? ''])), ...(input.config || {}) };
  await execute(
    `INSERT INTO integrations (id, org_id, provider, category, display_name, status, environment, config_json, capabilities, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      auth.org.id,
      definition.provider,
      definition.category,
      definition.name,
      definition.manual ? 'configured' : 'awaiting_credentials',
      input.environment,
      JSON.stringify(config),
      JSON.stringify(definition.capabilities),
      auth.user?.id ?? null,
    ],
  );
  return getIntegration(auth.org.id, id);
}

export async function setCredentials(auth, id, credentials, ctx = {}) {
  const integration = await one('SELECT * FROM integrations WHERE id = ? AND org_id = ?', [id, auth.org.id]);
  if (!integration) throw notFound('Integration not found');
  const definition = getProvider(integration.provider);
  if (!definition) throw badRequest('Provider definition missing');
  if (!definition.credentialKeys.length) throw badRequest('This adapter does not use API credentials');

  const known = new Set(definition.credentialKeys.map((k) => k.key));
  const supplied = Object.entries(credentials).filter(([key, value]) => known.has(key) && value);
  if (!supplied.length) throw badRequest('No recognised credential fields supplied');

  return withTransaction(async (conn) => {
    for (const [key, value] of supplied) {
      const encrypted = encryptSecret(String(value));
      await conn.query(
        `INSERT INTO integration_credentials (id, integration_id, key_name, ciphertext, iv, auth_tag)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE ciphertext = VALUES(ciphertext), iv = VALUES(iv), auth_tag = VALUES(auth_tag), rotated_at = NOW(3)`,
        [ulid(), id, key, encrypted.ciphertext, encrypted.iv, encrypted.authTag],
      );
    }
    const stored = await conn.query('SELECT key_name FROM integration_credentials WHERE integration_id = ?', [id]);
    const present = new Set(stored[0].map((r) => r.key_name));
    const missing = definition.credentialKeys.filter((k) => k.required && !present.has(k.key)).map((k) => k.key);
    await conn.query('UPDATE integrations SET status = ?, last_error = NULL WHERE id = ?', [
      missing.length ? 'awaiting_credentials' : 'configured',
      id,
    ]);
    await writeAudit(conn, {
      orgId: auth.org.id,
      actorType: auth.type,
      actorId: auth.user?.id ?? auth.apiKeyId,
      action: 'integration.credentials_set',
      entityType: 'integration',
      entityId: id,
      metadata: { provider: integration.provider, keys: supplied.map(([k]) => k), missing },
      ip: ctx.ip,
    });
    return { id, status: missing.length ? 'awaiting_credentials' : 'configured', missing };
  });
}

export async function checkIntegration(auth, id, ctx = {}) {
  const integration = await one('SELECT * FROM integrations WHERE id = ? AND org_id = ?', [id, auth.org.id]);
  if (!integration) throw notFound('Integration not found');
  const definition = getProvider(integration.provider);
  if (!definition) throw badRequest('Provider definition missing');
  if (integration.status === 'disabled') throw badRequest('Integration is disabled');

  const credentialRows = await many('SELECT * FROM integration_credentials WHERE integration_id = ?', [id]);
  const creds = {};
  for (const row of credentialRows) {
    try {
      creds[row.key_name] = decryptSecret({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag });
    } catch {
      await one('UPDATE integrations SET status = ?, last_error = ? WHERE id = ?', ['error', 'Stored credential could not be decrypted', id]);
      throw badRequest('Stored credential could not be decrypted; re-enter the credentials');
    }
  }
  const missing = definition.credentialKeys.filter((k) => k.required && !creds[k.key]).map((k) => k.label);
  if (missing.length) {
    await one('UPDATE integrations SET status = ?, last_checked_at = NOW(3), last_error = ? WHERE id = ?', [
      'awaiting_credentials',
      `Missing: ${missing.join(', ')}`,
      id,
    ]);
    return { id, provider: integration.provider, status: 'awaiting_credentials', ok: false, missing };
  }

  const config = json(integration.config_json);
  let result;
  try {
    result = await definition.check(creds, config);
  } catch (error) {
    result = { ok: false, detail: `Connection failed: ${error.message}`, status: null };
  }

  const status = result.ok ? (definition.manual ? 'configured' : 'connected') : 'error';
  await one('UPDATE integrations SET status = ?, last_checked_at = NOW(3), last_error = ? WHERE id = ?', [
    status,
    result.ok ? null : result.detail,
    id,
  ]);
  await writeAuditStandalone({
    orgId: auth.org.id,
    actorType: auth.type,
    actorId: auth.user?.id ?? auth.apiKeyId,
    action: 'integration.checked',
    entityType: 'integration',
    entityId: id,
    metadata: { provider: integration.provider, status, detail: result.detail },
    ip: ctx.ip,
  }).catch(() => {});
  return { id, provider: integration.provider, status, ok: result.ok, detail: result.detail, http_status: result.status };
}

export async function updateIntegration(auth, id, input) {
  const integration = await one('SELECT * FROM integrations WHERE id = ? AND org_id = ?', [id, auth.org.id]);
  if (!integration) throw notFound('Integration not found');
  const sets = [];
  const params = [];
  if (input.status) {
    sets.push('status = ?');
    params.push(input.status);
  }
  if (input.config) {
    sets.push('config_json = ?');
    params.push(JSON.stringify({ ...json(integration.config_json), ...input.config }));
  }
  if (!sets.length) return getIntegration(auth.org.id, id);
  params.push(id);
  await one(`UPDATE integrations SET ${sets.join(', ')} WHERE id = ?`, params);
  return getIntegration(auth.org.id, id);
}
