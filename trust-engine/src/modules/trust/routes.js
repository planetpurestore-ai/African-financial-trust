import { Router } from 'express';
import { asyncHandler } from '../../lib/http.js';
import { notFound } from '../../lib/errors.js';
import { requireAuth, requireWriteRole } from '../../middleware/auth.js';
import { getBusinessAccess } from '../businesses/access.js';
import { generateTrustRecord, getTrustRecord, latestTrustRecord, listTrustRecords, verifyTrustRecordHash } from './service.js';

const router = Router();

async function accessOr404(req, businessId, scope = 'trust_record.read') {
  const access = await getBusinessAccess(req.auth, businessId, scope);
  if (!access) throw notFound('Business not found');
  return access;
}

router.get(
  '/businesses/:businessId/trust-record',
  requireAuth,
  asyncHandler(async (req, res) => {
    await accessOr404(req, req.params.businessId);
    const record = await latestTrustRecord(req.params.businessId);
    if (!record) throw notFound('No Trust Record has been generated for this business');
    res.json({ data: record });
  }),
);

router.get(
  '/businesses/:businessId/trust-records',
  requireAuth,
  asyncHandler(async (req, res) => {
    await accessOr404(req, req.params.businessId);
    res.json({ data: await listTrustRecords(req.params.businessId) });
  }),
);

router.post(
  '/businesses/:businessId/trust-record/generate',
  requireAuth,
  requireWriteRole,
  asyncHandler(async (req, res) => {
    const access = await accessOr404(req, req.params.businessId, 'trust_record.write');
    if (access.mode === 'granted') throw notFound('Business not found');
    res.status(201).json({ data: await generateTrustRecord(req.auth, req.params.businessId, { ip: req.ip }) });
  }),
);

router.get(
  '/trust-records/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const record = await getTrustRecord(req.params.id);
    if (!record) throw notFound('Trust Record not found');
    await accessOr404(req, record.business_id);
    res.json({ data: record });
  }),
);

router.get(
  '/trust-records/:id/verify-hash',
  requireAuth,
  asyncHandler(async (req, res) => {
    const record = await getTrustRecord(req.params.id);
    if (!record) throw notFound('Trust Record not found');
    await accessOr404(req, record.business_id);
    res.json({ data: await verifyTrustRecordHash(req.params.id) });
  }),
);

export default router;
