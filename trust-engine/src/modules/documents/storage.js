import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { config } from '../../config.js';
import { badRequest } from '../../lib/errors.js';
import { one, q } from '../../db/pool.js';

const EXTENSIONS = {
  'application/pdf': 'pdf',
  'text/csv': 'csv',
  'application/csv': 'csv',
  'application/vnd.ms-excel': 'csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/json': 'json',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/tiff': 'tiff',
  'text/plain': 'txt',
};

export function extensionFor(filename, mimeType) {
  const fromName = path.extname(String(filename || '')).replace('.', '').toLowerCase();
  if (fromName && /^[a-z0-9]{1,8}$/.test(fromName)) return fromName;
  return EXTENSIONS[mimeType] || 'bin';
}

export async function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function header(filePath, length = 8) {
  const handle = await fsp.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/** Reject files whose bytes do not match their declared type. */
export async function assertFileSignature(filePath, mimeType, extension) {
  const bytes = await header(filePath, 8);
  const hex = bytes.toString('hex').toLowerCase();
  const ascii = bytes.toString('latin1');
  const ext = String(extension).toLowerCase();

  if (ext === 'pdf' || mimeType === 'application/pdf') {
    if (!ascii.startsWith('%PDF')) throw badRequest('File is not a valid PDF');
    return;
  }
  if (ext === 'png' || mimeType === 'image/png') {
    if (!hex.startsWith('89504e47')) throw badRequest('File is not a valid PNG image');
    return;
  }
  if (['jpg', 'jpeg'].includes(ext) || mimeType === 'image/jpeg') {
    if (!hex.startsWith('ffd8ff')) throw badRequest('File is not a valid JPEG image');
    return;
  }
  if (['tif', 'tiff'].includes(ext)) {
    if (!(hex.startsWith('49492a00') || hex.startsWith('4d4d002a'))) throw badRequest('File is not a valid TIFF image');
    return;
  }
  if (ext === 'xlsx') {
    if (!hex.startsWith('504b0304')) throw badRequest('File is not a valid XLSX workbook');
    return;
  }
  if (['csv', 'txt', 'json'].includes(ext)) {
    const sample = await header(filePath, 64);
    if (sample.includes(0)) throw badRequest('Text file contains binary data');
  }
}

/**
 * Store bytes in the database under their content hash. The container
 * filesystem is temporary in production; the database is the durable source of
 * truth. Returns a `blob:<sha256>` storage key.
 */
export async function storeDocument({ sha256, tempPath }) {
  const bytes = await fsp.readFile(tempPath);
  await q('INSERT IGNORE INTO document_blobs (sha256, bytes, size_bytes) VALUES (?, ?, ?)', [sha256, bytes, bytes.length]);
  await removeQuietly(tempPath);
  return `blob:${sha256}`;
}

/** Read the original bytes for a storage key, supporting legacy disk keys. */
export async function readDocumentBuffer(storageKey) {
  const key = String(storageKey || '');
  if (key.startsWith('blob:')) {
    const digest = key.slice(5);
    const row = await one('SELECT bytes FROM document_blobs WHERE sha256 = ?', [digest]);
    if (!row) throw badRequest('Stored document content is unavailable');
    return Buffer.isBuffer(row.bytes) ? row.bytes : Buffer.from(row.bytes);
  }
  return fsp.readFile(absolutePath(key));
}

/**
 * Write a temporary working copy for tools (pdftotext, tesseract, exceljs)
 * that require a filesystem path. Callers must remove the returned path.
 */
export async function materializeDocument(storageKey, extension) {
  const tmpDir = path.join(config.storageDir, 'tmp');
  await fsp.mkdir(tmpDir, { recursive: true });
  const target = path.join(tmpDir, `extract-${Date.now()}-${Math.random().toString(36).slice(2)}.${extension || 'bin'}`);
  await fsp.writeFile(target, await readDocumentBuffer(storageKey));
  return target;
}

export function absolutePath(storageKey) {
  const resolved = path.resolve(config.storageDir, storageKey);
  if (!resolved.startsWith(path.resolve(config.storageDir))) throw badRequest('Invalid storage path');
  return resolved;
}

export async function removeQuietly(filePath) {
  try {
    await fsp.unlink(filePath);
  } catch {
    /* already gone */
  }
}
