import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, listBody, pagination } from '../../lib/http.js';
import { parse, uuidLike } from '../../lib/validate.js';
import { requireAuth, requireRole, requireWriteRole } from '../../middleware/auth.js';
import { getBusinessAccess } from './access.js';
import {
  createBusiness,
  createBusinessSchema,
  getBusinessDetail,
  grantInstitutionAccess,
  listAccessGrants,
  listBusinesses,
  listHistory,
  recordVerification,
  revokeAccessGrant,
  updateBusiness,
  updateBusinessSchema,
} from './service.js';
import { notFound } from '../../lib/errors.js';

const router = Router();
router.use(requireAuth);

const listQuery = z.object({
  search: z.string().trim().max(120).optional(),
  status: z
    .enum(['unverified', 'self_declared', 'documents_submitted', 'partially_verified', 'verified', 'rejected'])
    .optional(),
  country: z.string().length(2).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const query = parse(listQuery, req.query);
    const page = pagination(req);
    const { rows, total } = await listBusinesses(req.auth, { ...query, ...page });
    res.json(listBody(rows, total, page));
  }),
);

router.post(
  '/',
  requireWriteRole,
  requireRole('business_admin', 'system_admin'),
  asyncHandler(async (req, res) => {
    const input = parse(createBusinessSchema, req.body);
    const business = await createBusiness(req.auth, input, { ip: req.ip });
    res.status(201).json({ data: business });
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const access = await getBusinessAccess(req.auth, req.params.id, [
      'business.read',
      'trust_record.read',
      'documents.read',
      'invoices.read',
      'reconciliation.read',
    ]);
    if (!access) throw notFound('Business not found');
    res.json({ data: await getBusinessDetail(req.auth, req.params.id), access: { mode: access.mode } });
  }),
);

router.patch(
  '/:id',
  requireWriteRole,
  asyncHandler(async (req, res) => {
    const access = await getBusinessAccess(req.auth, req.params.id, 'business.write');
    if (!access) throw notFound('Business not found');
    if (access.mode === 'granted') throw notFound('Business not found');
    const input = parse(updateBusinessSchema, req.body);
    res.json({ data: await updateBusiness(req.auth, req.params.id, input, { ip: req.ip }) });
  }),
);

router.get(
  '/:id/history',
  asyncHandler(async (req, res) => {
    const access = await getBusinessAccess(req.auth, req.params.id, [
      'business.read',
      'trust_record.read',
      'documents.read',
      'invoices.read',
      'reconciliation.read',
    ]);
    if (!access) throw notFound('Business not found');
    res.json({ data: await listHistory(req.auth, req.params.id) });
  }),
);

const verificationSchema = z.object({
  outcome: z.enum(['unverified', 'documents_submitted', 'partially_verified', 'verified', 'rejected']),
  method: z.enum(['manual_registry_check', 'document_review', 'counterparty_confirmation', 'field_visit', 'other']),
  reference: z.string().trim().max(255).optional().nullable(),
  note: z.string().trim().max(2000).optional().nullable(),
});

router.post(
  '/:id/verify',
  requireRole('system_admin', 'institution_admin'),
  asyncHandler(async (req, res) => {
    const access = await getBusinessAccess(req.auth, req.params.id, 'business.write');
    if (!access) throw notFound('Business not found');
    const input = parse(verificationSchema, req.body);
    res.json({ data: await recordVerification(req.auth, req.params.id, input, { ip: req.ip }) });
  }),
);

const grantSchema = z.object({
  institutionOrgId: uuidLike,
  scopes: z.array(z.enum(['trust_record.read', 'documents.read', 'invoices.read', 'reconciliation.read'])).min(1),
  purpose: z.string().trim().max(255).optional().nullable(),
  expiresAt: z.string().datetime().optional().nullable(),
});

router.get(
  '/:id/access-grants',
  requireRole('business_admin', 'system_admin'),
  asyncHandler(async (req, res) => {
    const access = await getBusinessAccess(req.auth, req.params.id, 'business.write');
    if (!access) throw notFound('Business not found');
    res.json({ data: await listAccessGrants(req.params.id) });
  }),
);

router.post(
  '/:id/access-grants',
  requireRole('business_admin', 'system_admin'),
  asyncHandler(async (req, res) => {
    const access = await getBusinessAccess(req.auth, req.params.id, 'business.write');
    if (!access) throw notFound('Business not found');
    const input = parse(grantSchema, req.body);
    res.status(201).json({ data: await grantInstitutionAccess(req.auth, req.params.id, input, { ip: req.ip }) });
  }),
);

router.delete(
  '/access-grants/:grantId',
  requireRole('business_admin', 'system_admin'),
  asyncHandler(async (req, res) => {
    res.json({ data: await revokeAccessGrant(req.auth, req.params.grantId, { ip: req.ip }) });
  }),
);

export default router;
