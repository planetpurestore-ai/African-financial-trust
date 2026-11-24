import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { config } from '../../config.js';
import { asyncHandler, listBody, pagination } from '../../lib/http.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { parse } from '../../lib/validate.js';
import { requireAuth, requireWriteRole } from '../../middleware/auth.js';
import { getBusinessAccess } from '../businesses/access.js';
import { processDocument, getDocument, ingestDocument, listDocuments, reviewField, fileForDocument } from './service.js';
import { enqueueJob } from '../jobs/service.js';

const router = Router();
router.use(requireAuth);

const upload = multer({
  dest: path.join(config.storageDir, 'tmp'),
  limits: { fileSize: config.maxUploadBytes, files: 1 },
  fileFilter(_req, file, cb) {
    if (!config.allowedUploadTypes.includes(file.mimetype)) {
      return cb(badRequest(`Unsupported file type: ${file.mimetype}`));
    }
    return cb(null, true);
  },
});

async function accessOr404(req, businessId, scope = 'documents.read') {
  const access = await getBusinessAccess(req.auth, businessId, scope);
  if (!access) throw notFound('Business not found');
  return access;
}

router.post(
  '/',
  requireWriteRole,
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw badRequest('A file is required in the "file" field');
    const businessId = String(req.body.businessId || '');
    if (!businessId) throw badRequest('businessId is required');
    const access = await accessOr404(req, businessId, 'documents.write');
    if (access.mode === 'granted') throw notFound('Business not found');
    const result = await ingestDocument({ auth: req.auth, businessId, file: req.file, ip: req.ip });
    res.status(201).json({ data: result.document, duplicate: result.duplicate });
  }),
);

const listQuery = z.object({
  businessId: z.string().length(26),
  type: z.string().max(40).optional(),
  status: z.string().max(24).optional(),
});

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const query = parse(listQuery, req.query);
    await accessOr404(req, query.businessId);
    const page = pagination(req);
    const { rows, total } = await listDocuments({ ...query, ...page });
    res.json(listBody(rows, total, page));
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const doc = await getDocument(req.params.id);
    await accessOr404(req, doc.business_id);
    res.json({ data: doc });
  }),
);

router.get(
  '/:id/file',
  asyncHandler(async (req, res) => {
    const file = await fileForDocument(req.params.id);
    await accessOr404(req, file.document.business_id);
    res.setHeader('content-type', file.mimeType);
    res.setHeader('content-disposition', `inline; filename="${file.filename.replace(/["\r\n]/g, '')}"`);
    res.setHeader('x-content-type-options', 'nosniff');
    res.send(file.buffer);
  }),
);

router.post(
  '/:id/reprocess',
  requireWriteRole,
  asyncHandler(async (req, res) => {
    const doc = await getDocument(req.params.id);
    const access = await accessOr404(req, doc.business_id, 'documents.write');
    if (access.mode === 'granted') throw notFound('Business not found');
    await enqueueJob({
      orgId: req.auth.org.id,
      type: 'document.extract',
      entityType: 'document',
      entityId: doc.id,
      payload: { documentId: doc.id },
    });
    res.status(202).json({ data: { id: doc.id, status: 'queued' } });
  }),
);

// Synchronous processing is useful for small files and for operators waiting on a result.
router.post(
  '/:id/process-now',
  requireWriteRole,
  asyncHandler(async (req, res) => {
    const doc = await getDocument(req.params.id);
    const access = await accessOr404(req, doc.business_id, 'documents.write');
    if (access.mode === 'granted') throw notFound('Business not found');
    const result = await processDocument(doc.id);
    res.json({ data: result });
  }),
);

const reviewSchema = z.object({ value: z.string().min(1).max(500) });

router.patch(
  '/:id/fields/:fieldId',
  requireWriteRole,
  asyncHandler(async (req, res) => {
    const doc = await getDocument(req.params.id);
    const access = await accessOr404(req, doc.business_id, 'documents.write');
    if (access.mode === 'granted') throw notFound('Business not found');
    const input = parse(reviewSchema, req.body);
    res.json({
      data: await reviewField({ auth: req.auth, documentId: doc.id, fieldId: req.params.fieldId, value: input.value, ip: req.ip }),
    });
  }),
);

export default router;
