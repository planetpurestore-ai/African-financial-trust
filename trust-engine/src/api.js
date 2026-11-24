import { Router } from 'express';
import authRoutes from './modules/auth/routes.js';
import businessRoutes from './modules/businesses/routes.js';
import documentRoutes from './modules/documents/routes.js';
import invoiceRoutes, { commercialRouter } from './modules/invoices/routes.js';
import transactionRoutes, { reconciliationRouter } from './modules/transactions/routes.js';
import trustRoutes from './modules/trust/routes.js';
import counterpartyRoutes, { publicRouter as counterpartyPublicRoutes } from './modules/counterparties/routes.js';
import integrationRoutes, { apiKeyRouter } from './modules/integrations/routes.js';
import auditRoutes from './modules/audit/routes.js';
import adminRoutes from './modules/admin/routes.js';
import reportRoutes from './modules/reports/routes.js';
import { openApiDocument } from './openapi.js';
import { forbidden, notFound } from './lib/errors.js';
import { authenticate } from './middleware/auth.js';

const api = Router();

api.get('/', (_req, res) => {
  res.json({
    data: {
      name: 'African Financial Trust — Trust Engine API',
      version: 'v1',
      documentation: '/api/v1/openapi.json',
      health: '/health',
    },
  });
});

api.get('/openapi.json', (_req, res) => res.json(openApiDocument));

// Resolve a session cookie or API key for every route below. Routes that need
// a principal apply requireAuth themselves; public routes tolerate anonymity.
api.use(authenticate);

// API keys are intentionally narrower than a human session. Business-scoped
// modules enforce their own read/write scope; these platform routes need the
// same treatment so a key issued for invoice reading cannot inspect the audit
// trail, system health or integration credentials.
api.use((req, _res, next) => {
  if (req.auth?.type !== 'api_key') return next();
  const path = req.path;
  const read = req.method === 'GET' || req.method === 'HEAD';
  let scope = null;
  if (/^\/businesses\/[^/]+\/trust-record/.test(path)) scope = read ? 'trust_record.read' : 'trust_record.write';
  else if (path === '/businesses' || path.startsWith('/businesses/')) scope = read ? 'business.read' : 'business.write';
  else if (path === '/audit' || path.startsWith('/audit/')) scope = 'audit.read';
  else if (path === '/system' || path.startsWith('/system/')) scope = 'system.read';
  else if (path === '/reports' || path.startsWith('/reports/')) scope = read ? 'reports.read' : 'reports.write';
  else if (path === '/integrations' || path.startsWith('/integrations/')) scope = read ? 'integrations.read' : 'integrations.write';
  else if (path === '/api-keys' || path.startsWith('/api-keys/')) scope = read ? 'integrations.read' : 'integrations.write';
  if (!scope) return next();
  const scopes = req.auth.scopes || [];
  if (scopes.includes('*') || scopes.includes(scope)) return next();
  return next(forbidden(`API key lacks scope ${scope}`));
});

api.use('/auth', authRoutes);
api.use('/businesses', businessRoutes);
api.use('/documents', documentRoutes);
api.use('/invoices', invoiceRoutes);
api.use('/commercial', commercialRouter);
api.use('/transactions', transactionRoutes);
api.use('/reconciliation', reconciliationRouter);
api.use('/counterparties', counterpartyRoutes);
api.use('/counterparty-confirmations', counterpartyPublicRoutes);
api.use('/integrations', integrationRoutes);
api.use('/api-keys', apiKeyRouter);
api.use('/audit', auditRoutes);
api.use('/system', adminRoutes);
api.use('/reports', reportRoutes);
api.use('/', trustRoutes);
api.use((req, _res, next) => next(notFound(`No API route matches ${req.method} ${req.originalUrl}`)));

export default api;
