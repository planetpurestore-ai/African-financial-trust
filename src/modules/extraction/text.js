import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { parse as parseCsv } from 'csv-parse/sync';
import ExcelJS from 'exceljs';

const run = promisify(execFile);

const toolCache = new Map();

export async function hasTool(name) {
  if (toolCache.has(name)) return toolCache.get(name);
  try {
    await run('which', [name], { timeout: 3000 });
    toolCache.set(name, true);
  } catch {
    toolCache.set(name, false);
  }
  return toolCache.get(name);
}

async function exec(file, args, options = {}) {
  const { stdout } = await run(file, args, { maxBuffer: 40 * 1024 * 1024, timeout: 60_000, ...options });
  return stdout;
}

export async function pdfText(filePath) {
  if (!(await hasTool('pdftotext'))) return null;
  const out = await exec('pdftotext', ['-layout', '-enc', 'UTF-8', filePath, '-']);
  return out;
}

export async function ocrImage(filePath, { languages = process.env.OCR_LANGUAGES || 'eng' } = {}) {
  if (!(await hasTool('tesseract'))) {
    throw new Error('OCR is unavailable on this host: tesseract is not installed');
  }
  const out = await exec('tesseract', [filePath, 'stdout', '-l', languages, '--psm', '6'], { timeout: 120_000 });
  return out;
}

export async function pdfToImages(filePath) {
  if (!(await hasTool('pdftoppm'))) return [];
  const dir = await fs.mkdtemp('/tmp/aft-ocr-');
  await exec('pdftoppm', ['-r', '200', '-png', filePath, path.join(dir, 'page')], { timeout: 120_000 });
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.png')).sort();
  return files.map((f) => path.join(dir, f));
}

export async function spreadsheetText(filePath, extension) {
  const workbook = new ExcelJS.Workbook();
  if (extension === 'csv') {
    const raw = await fs.readFile(filePath, 'utf8');
    const rows = parseCsv(raw, { relaxColumnCount: true, skipEmptyLines: true, bom: true });
    return { text: rows.map((row) => row.join('\t')).join('\n'), rows, sheetNames: [] };
  }
  await workbook.xlsx.readFile(filePath);
  const lines = [];
  const rows = [];
  const sheetNames = [];
  workbook.eachSheet((sheet) => {
    sheetNames.push(sheet.name);
    lines.push(`## ${sheet.name}`);
    sheet.eachRow((row) => {
      const values = row.values.slice(1).map((v) => {
        if (v === null || v === undefined) return '';
        if (v instanceof Date) return v.toISOString().slice(0, 10);
        if (typeof v === 'object' && v.text) return v.text;
        if (typeof v === 'object' && v.result !== undefined) return String(v.result);
        return String(v);
      });
      lines.push(values.join('\t'));
      rows.push(values);
    });
  });
  return { text: lines.join('\n'), rows, sheetNames };
}

/**
 * Extract text from an uploaded document.
 * Returns { text, method, engine, pageCount, confidence, warnings }.
 */
export async function extractText({ filePath, mimeType, extension }) {
  const ext = String(extension || '').toLowerCase();
  const warnings = [];

  if (mimeType === 'application/pdf' || ext === 'pdf') {
    const text = await pdfText(filePath);
    if (text && text.trim().length >= 40) {
      const pageCount = (text.match(/\f/g) || []).length + 1;
      return { text, method: 'pdf_text', engine: 'pdftotext', pageCount, confidence: 0.9, warnings };
    }
    if (!(await hasTool('pdftoppm'))) {
      throw new Error('PDF has no text layer and pdftoppm is unavailable for OCR');
    }
    const images = await pdfToImages(filePath);
    if (!images.length) throw new Error('PDF produced no pages for OCR');
    const pages = [];
    for (const image of images) pages.push(await ocrImage(image));
    return {
      text: pages.join('\n\f\n'),
      method: 'ocr',
      engine: 'tesseract',
      pageCount: images.length,
      confidence: 0.6,
      warnings: ['Scanned PDF processed with OCR; field values require review'],
    };
  }

  if (mimeType === 'text/csv' || ext === 'csv') {
    const { text, rows } = await spreadsheetText(filePath, 'csv');
    return { text, method: 'csv', engine: 'csv-parse', pageCount: null, confidence: 0.85, warnings, rows };
  }

  if (['xlsx', 'xls'].includes(ext) || String(mimeType).includes('spreadsheet')) {
    if (ext === 'xls') throw new Error('Legacy .xls files are not supported; save as .xlsx or CSV');
    const { text, rows, sheetNames } = await spreadsheetText(filePath, 'xlsx');
    return { text, method: 'xlsx', engine: 'exceljs', pageCount: null, confidence: 0.85, warnings, rows, sheetNames };
  }

  if (mimeType === 'application/json' || ext === 'json') {
    const raw = await fs.readFile(filePath, 'utf8');
    return { text: raw, method: 'json', engine: 'json', pageCount: null, confidence: 0.9, warnings };
  }

  if (['png', 'jpg', 'jpeg', 'tif', 'tiff'].includes(ext) || String(mimeType).startsWith('image/')) {
    const text = await ocrImage(filePath);
    return {
      text,
      method: 'ocr',
      engine: 'tesseract',
      pageCount: 1,
      confidence: 0.6,
      warnings: ['Image processed with OCR; field values require review'],
    };
  }

  const raw = await fs.readFile(filePath, 'utf8');
  return { text: raw, method: 'pdf_text', engine: 'plain', pageCount: null, confidence: 0.5, warnings };
}
