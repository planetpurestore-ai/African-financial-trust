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
import { notFound } from './lib/errors.js';
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
