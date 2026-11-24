import { Router } from 'express';
import { z } from 'zod';
import { config } from '../../config.js';
import { serializeCookie, clearCookie } from '../../lib/cookies.js';
import { asyncHandler } from '../../lib/http.js';
import { parse } from '../../lib/validate.js';
import { loginRateLimit } from '../../middleware/rateLimit.js';
import { authenticate, requireAuth, requireRole } from '../../middleware/auth.js';
import {
  activateInvitation,
  changePassword,
  createInvitation,
  createUser,
  currentUser,
  listOrganisations,
  listUsers,
  login,
  logout,
  updateUser,
} from './service.js';
import { email } from '../../lib/validate.js';

const router = Router();

const cookieBase = {
  httpOnly: true,
  secure: config.cookieSecure,
  sameSite: config.cookieSecure ? 'None' : 'Lax',
  path: '/',
};

const loginSchema = z.object({ email, password: z.string().min(1).max(200) });

router.post(
  '/login',
  loginRateLimit,
  asyncHandler(async (req, res) => {
    const input = parse(loginSchema, req.body);
    const result = await login({ ...input, ip: req.ip, userAgent: req.get('user-agent') });
    res.setHeader('set-cookie', [
      serializeCookie(config.sessionCookie, result.token, {
        ...cookieBase,
        maxAge: config.sessionHours * 3600,
        expires: result.expires,
      }),
      serializeCookie(config.csrfCookie, result.csrf, {
        ...cookieBase,
        httpOnly: false,
        maxAge: config.sessionHours * 3600,
        expires: result.expires,
      }),
    ]);
    res.json({ data: { user: result.user, org: result.org, csrfToken: result.csrf } });
  }),
);

const activationSchema = z.object({
  token: z.string().min(20).max(200),
  password: z.string().min(14).max(200),
  fullName: z.string().trim().min(2).max(255).optional(),
});

router.post(
  '/activate',
  loginRateLimit,
  asyncHandler(async (req, res) => {
    const input = parse(activationSchema, req.body);
    res.json({ data: await activateInvitation(input) });
  }),
);

router.post(
  '/logout',
  authenticate,
  asyncHandler(async (req, res) => {
    if (req.auth?.sessionId) await logout(req.auth.sessionId);
    res.setHeader('set-cookie', [
      clearCookie(config.sessionCookie, cookieBase),
      clearCookie(config.csrfCookie, { ...cookieBase, httpOnly: false }),
    ]);
    res.json({ data: { loggedOut: true } });
  }),
);

router.get(
  '/me',
  authenticate,
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await currentUser(req.auth);
    res.json({ data: { user, org: req.auth.org, role: req.auth.role, authType: req.auth.type } });
  }),
);

const passwordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(12).max(200),
});

router.post(
  '/password',
  authenticate,
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = parse(passwordSchema, req.body);
    res.json({ data: await changePassword(req.auth, input.currentPassword, input.newPassword) });
  }),
);

router.get(
  '/users',
  authenticate,
  requireAuth,
  requireRole('system_admin', 'institution_admin', 'business_admin'),
  asyncHandler(async (req, res) => {
    res.json({ data: await listUsers(req.auth) });
  }),
);

const createUserSchema = z.object({
  email,
  fullName: z.string().trim().min(2).max(255),
  password: z.string().min(12).max(200),
  role: z.enum(['institution_admin', 'institution_analyst', 'business_admin', 'business_user', 'auditor']),
});

const invitationSchema = z.object({
  email,
  fullName: z.string().trim().min(2).max(255),
  role: z.enum(['system_admin', 'institution_admin', 'institution_analyst', 'business_admin', 'business_user', 'auditor']),
});

router.post(
  '/invitations',
  authenticate,
  requireAuth,
  requireRole('system_admin', 'institution_admin', 'business_admin'),
  asyncHandler(async (req, res) => {
    const input = parse(invitationSchema, req.body);
    if (input.role === 'system_admin' && req.auth.role !== 'system_admin') {
      return res.status(403).json({ error: { code: 'forbidden', message: 'Only a system administrator may invite system administrators' } });
    }
    const result = await createInvitation(req.auth, input);
    const origin = config.publicOrigin || `${req.protocol}://${req.get('host')}`;
    res.status(201).json({ data: { ...result, activationUrl: `${origin}/activate/${result.token}` } });
  }),
);

router.post(
  '/users',
  authenticate,
  requireAuth,
  requireRole('system_admin', 'institution_admin', 'business_admin'),
  asyncHandler(async (req, res) => {
    const input = parse(createUserSchema, req.body);
    res.status(201).json({ data: await createUser(req.auth, input) });
  }),
);

router.patch(
  '/users/:id',
  authenticate,
  requireAuth,
  requireRole('system_admin', 'institution_admin', 'business_admin'),
  asyncHandler(async (req, res) => {
    const input = parse(
      z.object({
        role: z.enum(['institution_admin', 'institution_analyst', 'business_admin', 'business_user', 'auditor']).optional(),
        status: z.enum(['active', 'disabled']).optional(),
        fullName: z.string().trim().min(2).max(255).optional(),
      }),
      req.body,
    );
    res.json({ data: await updateUser(req.auth, req.params.id, input) });
  }),
);

router.get(
  '/organisations',
  authenticate,
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ data: await listOrganisations(req.auth) });
  }),
);

export default router;
