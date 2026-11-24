import fsp from 'node:fs/promises';
import path from 'node:path';
import { many, manyOn, one, oneOn, q, withTransaction } from '../../db/pool.js';
import { writeAudit, writeAuditStandalone } from '../../lib/audit.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { ulid } from '../../lib/ids.js';
import { classifyDocument } from '../extraction/classify.js';
import { extractInvoiceFields, extractGenericFields } from '../extraction/fields.js';
import { extractText } from '../extraction/text.js';
import { enqueueJob } from '../jobs/service.js';
import {
  assertFileSignature,
  extensionFor,
  materializeDocument,
  readDocumentBuffer,
  removeQuietly,
  sha256File,
  storeDocument,
} from './storage.js';

const INVOICE_TYPES = new Set(['invoice', 'credit_note']);

export async function ingestDocument({ auth, businessId, file, ip }) {
  const extension = extensionFor(file.originalname, file.mimetype);
  try {
    await assertFileSignature(file.path, file.mimetype, extension);
    const sha256 = await sha256File(file.path);
    const duplicate = await one(
      'SELECT id, storage_key FROM documents WHERE business_id = ? AND sha256 = ? AND status <> ? LIMIT 1',
      [businessId, sha256, 'duplicate'],
    );
    if (duplicate) {
      const id = ulid();
      const key = `duplicate:${duplicate.id}`;
      await q(
        `INSERT INTO documents (id, business_id, uploaded_by_user_id, original_filename, storage_key, mime_type, size_bytes,
          sha256, status, duplicate_of_id, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'duplicate', ?, 1)`,
        [id, businessId, auth.user?.id ?? null, file.originalname, key, file.mimetype, file.size, sha256, duplicate.id],
      );
      await removeQuietly(file.path);
      return { document: await getDocument(id), duplicate: true };
    }

    const id = ulid();
    const storageKey = await storeDocument({ sha256, tempPath: file.path });
    await q(
      `INSERT INTO documents (id, business_id, uploaded_by_user_id, original_filename, storage_key, mime_type, size_bytes,
        sha256, status, version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', 1)`,
      [id, businessId, auth.user?.id ?? null, file.originalname, storageKey, file.mimetype, file.size, sha256],
    );
    await enqueueJob({
      orgId: auth.org.id,
      type: 'document.extract',
      entityType: 'document',
      entityId: id,
      payload: { documentId: id },
    });
    await writeAuditStandalone({
      orgId: auth.org.id,
      actorType: auth.type,
      actorId: auth.user?.id ?? auth.apiKeyId,
      action: 'document.uploaded',
      entityType: 'document',
      entityId: id,
      metadata: { business_id: businessId, filename: file.originalname, sha256 },
      ip,
    });
    return { document: await getDocument(id), duplicate: false };
  } catch (error) {
    await removeQuietly(file.path);
    throw error;
  }
}

export async function processDocument(documentId) {
  const doc = await one('SELECT * FROM documents WHERE id = ?', [documentId]);
  if (!doc) throw notFound('Document not found');
  if (doc.status === 'duplicate') return { skipped: true, reason: 'duplicate' };

  await q("UPDATE documents SET status = 'processing', error_message = NULL WHERE id = ?", [documentId]);
  const started = Date.now();
  try {
    const extension = path.extname(doc.original_filename || '').replace('.', '') || 'bin';
    const filePath = await materializeDocument(doc.storage_key, extension);
    let textResult;
    try {
      textResult = await extractText({ filePath, mimeType: doc.mime_type, extension });
    } finally {
      await removeQuietly(filePath);
    }
    const classification = classifyDocument(textResult.text, {
      filename: doc.original_filename,
      sheetNames: textResult.sheetNames || [],
    });
    const fields = INVOICE_TYPES.has(classification.type)
      ? extractInvoiceFields(textResult.text)
      : extractGenericFields(textResult.text);

    await withTransaction(async (conn) => {
      const extractionId = ulid();
      await conn.query(
        `INSERT INTO document_extractions (id, document_id, method, engine, status, raw_text, confidence, duration_ms)
         VALUES (?, ?, ?, ?, 'succeeded', ?, ?, ?)`,
        [
          extractionId,
          documentId,
          textResult.method,
          textResult.engine,
          textResult.text.slice(0, 2_000_000),
          textResult.confidence,
          Date.now() - started,
        ],
      );
      await conn.query('DELETE FROM extracted_fields WHERE document_id = ?', [documentId]);
      for (const field of fields) {
        await conn.query(
          `INSERT INTO extracted_fields (id, document_id, extraction_id, field_name, field_value, normalized_value, confidence, snippet, method)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            ulid(),
            documentId,
            extractionId,
            field.fieldName,
            field.value === null || field.value === undefined ? null : String(field.value),
            field.normalizedValue === null || field.normalizedValue === undefined ? null : String(field.normalizedValue),
            field.confidence ?? 0,
            field.snippet ? String(field.snippet).slice(0, 500) : null,
            textResult.method,
          ],
        );
      }
      const status = textResult.confidence < 0.7 || classification.confidence < 0.5 ? 'needs_review' : 'extracted';
      await conn.query(
        `UPDATE documents SET status = ?, doc_type = ?, doc_type_confidence = ?, extraction_method = ?,
          extraction_confidence = ?, page_count = ?, processed_at = NOW(3), error_message = NULL,
          metadata_json = ? WHERE id = ?`,
        [
          status,
          classification.type,
          classification.confidence,
          textResult.method,
          textResult.confidence,
          textResult.pageCount ?? null,
          JSON.stringify({ warnings: textResult.warnings, alternatives: classification.alternatives }),
          documentId,
        ],
      );
      await conn.query(
        `INSERT INTO verification_events (id, business_id, entity_type, entity_id, event_type, outcome, explanation, actor_type)
         VALUES (?, ?, 'document', ?, 'document_extraction', ?, ?, 'system')`,
        [
          ulid(),
          doc.business_id,
          documentId,
          status,
          `Classified as ${classification.type} (${Math.round(classification.confidence * 100)}% confidence) with ${fields.length} extracted field(s)`,
        ],
      );
    });
    return { document: await getDocument(documentId), fields: fields.length };
  } catch (error) {
    await q("UPDATE documents SET status = 'failed', error_message = ? WHERE id = ?", [String(error.message).slice(0, 2000), documentId]);
    throw error;
  }
}

export async function getDocument(id, conn = null) {
  const read = conn ? (sql, params) => oneOn(conn, sql, params) : (sql, params) => one(sql, params);
  const readMany = conn ? (sql, params) => manyOn(conn, sql, params) : (sql, params) => many(sql, params);
  const doc = await read('SELECT * FROM documents WHERE id = ?', [id]);
  if (!doc) throw notFound('Document not found');
  const [extractions, fields] = await Promise.all([
    readMany('SELECT id, method, engine, status, confidence, duration_ms, created_at FROM document_extractions WHERE document_id = ? ORDER BY created_at DESC', [id]),
    readMany('SELECT * FROM extracted_fields WHERE document_id = ? ORDER BY field_name', [id]),
  ]);
  // The storage column is named `sha256`; the public contract uses
  // `content_hash` so clients are not coupled to the database schema. Every
  // extracted field is document-derived until a reviewer or counterparty
  // explicitly upgrades its provenance.
  return {
    ...doc,
    content_hash: doc.sha256,
    extractions,
    fields: fields.map((field) => ({ ...field, provenance: 'document_extracted' })),
  };
}

export async function listDocuments({ businessId, type, status, limit, offset }) {
  const clauses = ['business_id = ?'];
  const params = [businessId];
  if (type) {
    clauses.push('doc_type = ?');
    params.push(type);
  }
  if (status) {
    clauses.push('status = ?');
    params.push(status);
  }
  const where = clauses.join(' AND ');
  const [{ total }] = await many(`SELECT COUNT(*) AS total FROM documents WHERE ${where}`, params);
  const rows = await many(
    `SELECT id, business_id, original_filename, mime_type, size_bytes, doc_type, doc_type_confidence, status,
            extraction_method, extraction_confidence, page_count, duplicate_of_id, created_at, processed_at, error_message
       FROM documents WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  return { rows, total: Number(total) };
}

export async function reviewField({ auth, documentId, fieldId, value, ip }) {
  return withTransaction(async (conn) => {
    const [rows] = await conn.query('SELECT * FROM extracted_fields WHERE id = ? AND document_id = ? FOR UPDATE', [fieldId, documentId]);
    const field = rows[0];
    if (!field) throw notFound('Extracted field not found');
    await conn.query(
      'UPDATE extracted_fields SET field_value = ?, normalized_value = ?, confidence = 1, reviewed = 1, method = ? WHERE id = ?',
      [String(value), String(value), 'manual', fieldId],
    );
    await writeAudit(conn, {
      orgId: auth.org.id,
      actorType: auth.type,
      actorId: auth.user?.id ?? auth.apiKeyId,
      action: 'document.field_reviewed',
      entityType: 'document',
      entityId: documentId,
      metadata: { field: field.field_name, previous: field.field_value, next: String(value) },
      ip,
    });
    return getDocument(documentId, conn);
  });
}

export async function fileForDocument(id) {
  const doc = await one('SELECT * FROM documents WHERE id = ?', [id]);
  if (!doc) throw notFound('Document not found');
  if (String(doc.storage_key).startsWith('duplicate:')) {
    const originalId = doc.storage_key.split(':')[1];
    const original = await one('SELECT * FROM documents WHERE id = ?', [originalId]);
    if (!original) throw notFound('Original document not found');
    return {
      document: doc,
      buffer: await readDocumentBuffer(original.storage_key),
      filename: original.original_filename,
      mimeType: original.mime_type,
    };
  }
  return {
    document: doc,
    buffer: await readDocumentBuffer(doc.storage_key),
    filename: doc.original_filename,
    mimeType: doc.mime_type,
  };
}

export async function markSuperseded(previousId, newId) {
  await q('UPDATE documents SET supersedes_id = ? WHERE id = ?', [previousId, newId]);
}

export async function documentStats(businessId) {
  const rows = await many(
    `SELECT status, COUNT(*) AS count FROM documents WHERE business_id = ? GROUP BY status`,
    [businessId],
  );
  const out = {};
  for (const row of rows) out[row.status] = Number(row.count);
  return out;
}

export async function storageUsage(businessId) {
  const row = await one('SELECT COALESCE(SUM(size_bytes),0) AS bytes, COUNT(*) AS files FROM documents WHERE business_id = ?', [businessId]);
  return { bytes: Number(row.bytes), files: Number(row.files) };
}

export async function cleanupTemp(filePath) {
  await removeQuietly(filePath);
}

export async function ensureUploadDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
  return dir;
}
