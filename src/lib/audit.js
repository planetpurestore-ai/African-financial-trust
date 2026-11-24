import { canonicalJson, sha256Hex } from './crypto.js';
import { ulid } from './ids.js';
import { many, one, withTransaction } from '../db/pool.js';

function mysqlDate(date = new Date()) {
  return date.toISOString().replace('T', ' ').replace('Z', '');
}

function digest(entry) {
  return sha256Hex(
    canonicalJson({
      seq: entry.seq,
      org_id: entry.orgId,
      actor_type: entry.actorType,
      actor_id: entry.actorId ?? null,
      action: entry.action,
      entity_type: entry.entityType,
      entity_id: entry.entityId ?? null,
      metadata: entry.metadata ?? null,
      prev_hash: entry.prevHash ?? null,
      created_at: entry.createdAt,
    }),
  );
}

/**
 * Append an audit entry inside the caller's transaction.
 * The chain head row is locked so concurrent writers cannot fork the chain.
 */
export async function writeAudit(conn, entry) {
  const orgId = entry.orgId;
  if (!orgId) throw new Error('audit entry requires orgId');

  await conn.query(
    'INSERT INTO audit_chain_heads (org_id, last_hash, last_seq) VALUES (?, ?, 0) ON DUPLICATE KEY UPDATE org_id = org_id',
    [orgId, ''],
  );
  const [[head]] = await conn.query(
    'SELECT last_hash, last_seq FROM audit_chain_heads WHERE org_id = ? FOR UPDATE',
    [orgId],
  );

  const seq = Number(head.last_seq) + 1;
  const createdAt = mysqlDate();
  const record = {
    seq,
    orgId,
    actorType: entry.actorType || 'system',
    actorId: entry.actorId || null,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId || null,
    metadata: entry.metadata ?? null,
    prevHash: head.last_hash || null,
    createdAt,
  };
  const hash = digest(record);
  const id = ulid();

  await conn.query(
    `INSERT INTO audit_logs
      (id, org_id, seq, actor_type, actor_id, actor_label, action, entity_type, entity_id, metadata_json, ip, prev_hash, hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      orgId,
      seq,
      record.actorType,
      record.actorId,
      entry.actorLabel || null,
      record.action,
      record.entityType,
      record.entityId,
      record.metadata === null ? null : JSON.stringify(record.metadata),
      entry.ip || null,
      record.prevHash,
      hash,
      record.createdAt,
    ],
  );
  await conn.query('UPDATE audit_chain_heads SET last_hash = ?, last_seq = ? WHERE org_id = ?', [hash, seq, orgId]);
  return { id, hash, seq };
}

/** Recompute an organisation's chain from the stored rows. */
export async function verifyAuditChain(orgId) {
  const rows = await many(
    `SELECT id, seq, actor_type, actor_id, action, entity_type, entity_id, metadata_json, prev_hash, hash, created_at
       FROM audit_logs WHERE org_id = ? ORDER BY seq ASC`,
    [orgId],
  );
  let prev = null;
  for (const row of rows) {
    const expected = digest({
      seq: Number(row.seq),
      orgId,
      actorType: row.actor_type,
      actorId: row.actor_id,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      metadata: row.metadata_json ?? null,
      prevHash: row.prev_hash,
      createdAt: row.created_at instanceof Date ? mysqlDate(row.created_at) : String(row.created_at),
    });
    if (row.prev_hash !== prev || row.hash !== expected) {
      return { valid: false, count: rows.length, broken_at: row.id, seq: Number(row.seq) };
    }
    prev = row.hash;
  }
  const head = await one('SELECT last_hash, last_seq FROM audit_chain_heads WHERE org_id = ?', [orgId]);
  const headOk = !head || (head.last_hash === prev && Number(head.last_seq) === rows.length);
  return { valid: headOk, count: rows.length, head: head ? { hash: head.last_hash, seq: Number(head.last_seq) } : null };
}

/** Audit helper for read paths that do not need a transaction. */
export async function auditEvent(conn, entry) {
  return writeAudit(conn, entry);
}

/** Write an audit entry in its own transaction (for flows that already committed). */
export async function writeAuditStandalone(entry) {
  return withTransaction((conn) => writeAudit(conn, entry));
}
