import { Router } from 'express';
import { z } from 'zod';
import { many, one } from '../../db/pool.js';
import { writeAuditStandalone } from '../../lib/audit.js';
import { hashToken, randomToken } from '../../lib/crypto.js';
import { asyncHandler } from '../../lib/http.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { ulid } from '../../lib/ids.js';
import { parse } from '../../lib/validate.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import {
  checkIntegration,
  createIntegration,
  createIntegrationSchema,
  getIntegration,
  listIntegrations,
  setCredentials,
  updateIntegration,
} from './service.js';

const router = Router();
router.use(requireAuth);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json({ data: await listIntegrations(req.auth.org.id) });
  }),
);

router.post(
  '/',
  requireRole('system_admin', 'institution_admin', 'business_admin'),
  asyncHandler(async (req, res) => {
    const input = parse(createIntegrationSchema, req.body);
    res.status(201).json({ data: await createIntegration(req.auth, input) });
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json({ data: await getIntegration(req.auth.org.id, req.params.id) });
  }),
);

router.put(
  '/:id/credentials',
  requireRole('system_admin', 'institution_admin', 'business_admin'),
  asyncHandler(async (req, res) => {
    const input = parse(z.record(z.string().min(1).max(2000)), req.body);
    res.json({ data: await setCredentials(req.auth, req.params.id, input, { ip: req.ip }) });
  }),
);

router.post(
  '/:id/check',
  requireRole('system_admin', 'institution_admin', 'business_admin'),
  asyncHandler(async (req, res) => {
    res.json({ data: await checkIntegration(req.auth, req.params.id, { ip: req.ip }) });
  }),
);

router.patch(
  '/:id',
  requireRole('system_admin', 'institution_admin', 'business_admin'),
  asyncHandler(async (req, res) => {
    const input = parse(
      z.object({
        status: z.enum(['not_configured', 'awaiting_credentials', 'configured', 'connected', 'error', 'disabled']).optional(),
        config: z.record(z.any()).optional(),
      }),
      req.body,
    );
    res.json({ data: await updateIntegration(req.auth, req.params.id, input) });
  }),
);

export const apiKeyRouter = Router();
apiKeyRouter.use(requireAuth);

apiKeyRouter.get(
  '/',
  requireRole('system_admin', 'institution_admin', 'business_admin'),
  asyncHandler(async (req, res) => {
    const rows = await many(
      `SELECT id, name, prefix, role, scopes, status, last_used_at, expires_at, created_at, revoked_at
         FROM api_keys WHERE org_id = ? ORDER BY created_at DESC`,
      [req.auth.org.id],
    );
    res.json({ data: rows });
  }),
);

apiKeyRouter.post(
  '/',
  requireRole('system_admin', 'institution_admin', 'business_admin'),
  asyncHandler(async (req, res) => {
    const input = parse(
      z.object({
        name: z.string().trim().min(2).max(120),
        role: z.enum(['institution_admin', 'institution_analyst', 'business_admin', 'business_user', 'auditor']),
        scopes: z.array(z.string().max(60)).min(1),
        expiresAt: z.string().datetime().optional().nullable(),
      }),
      req.body,
    );
    const prefix = randomToken(6).replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).toUpperCase();
    const secret = randomToken(32);
    const key = `aft_${prefix}_${secret}`;
    const id = ulid();
    await one(
      `INSERT INTO api_keys (id, org_id, name, prefix, key_hash, role, scopes, status, expires_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
      [id, req.auth.org.id, input.name, prefix, hashToken(key), input.role, JSON.stringify(input.scopes), input.expiresAt ?? null, req.auth.user?.id ?? null],
    );
    await writeAuditStandalone({
      orgId: req.auth.org.id,
      actorType: req.auth.type,
      actorId: req.auth.user?.id ?? req.auth.apiKeyId,
      action: 'api_key.created',
      entityType: 'api_key',
      entityId: id,
      metadata: { name: input.name, role: input.role, scopes: input.scopes },
      ip: req.ip,
    });
    res.status(201).json({
      data: { id, name: input.name, prefix, role: input.role, scopes: input.scopes, key },
      warning: 'Copy this key now. It is stored only as a SHA-256 hash and cannot be shown again.',
    });
  }),
);

apiKeyRouter.delete(
  '/:id',
  requireRole('system_admin', 'institution_admin', 'business_admin'),
  asyncHandler(async (req, res) => {
    const key = await one('SELECT * FROM api_keys WHERE id = ? AND org_id = ?', [req.params.id, req.auth.org.id]);
    if (!key) throw notFound('API key not found');
    if (key.id === req.auth.apiKeyId) throw badRequest('You cannot revoke the key used for this request');
    await one("UPDATE api_keys SET status = 'revoked', revoked_at = NOW(3) WHERE id = ?", [key.id]);
    await writeAuditStandalone({
      orgId: req.auth.org.id,
      actorType: req.auth.type,
      actorId: req.auth.user?.id ?? req.auth.apiKeyId,
      action: 'api_key.revoked',
      entityType: 'api_key',
      entityId: key.id,
      metadata: { prefix: key.prefix },
      ip: req.ip,
    });
    res.json({ data: { id: key.id, status: 'revoked' } });
  }),
);

export default router;
