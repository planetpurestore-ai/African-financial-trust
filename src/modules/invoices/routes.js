import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, listBody, pagination } from '../../lib/http.js';
import { notFound } from '../../lib/errors.js';
import { parse, uuidLike } from '../../lib/validate.js';
import { requireAuth, requireWriteRole } from '../../middleware/auth.js';
import { getBusinessAccess } from '../businesses/access.js';
import {
  createContract,
  createContractSchema,
  createDelivery,
  createDeliverySchema,
  createInvoice,
  createInvoiceSchema,
  createPurchaseOrder,
  createPurchaseOrderSchema,
  getInvoice,
  listCommercialRecords,
  listInvoices,
  recordPayment,
  updateInvoice,
  verifyInvoiceRecord,
} from './service.js';

const router = Router();
router.use(requireAuth);

async function accessOr404(req, businessId, scope = 'invoices.read') {
  const access = await getBusinessAccess(req.auth, businessId, scope);
  if (!access) throw notFound('Business not found');
  return access;
}

router.post(
  '/',
  requireWriteRole,
  asyncHandler(async (req, res) => {
    const input = parse(createInvoiceSchema, req.body);
    const access = await accessOr404(req, input.businessId, 'invoices.write');
    if (access.mode === 'granted') throw notFound('Business not found');
    res.status(201).json({ data: await createInvoice(req.auth, input, { ip: req.ip }) });
  }),
);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const businessId = String(req.query.businessId || '');
    if (!businessId) throw notFound('businessId is required');
    await accessOr404(req, businessId);
    const page = pagination(req);
    const { rows, total } = await listInvoices({
      businessId,
      status: req.query.status,
      verificationStatus: req.query.verificationStatus,
      ...page,
    });
    res.json(listBody(rows, total, page));
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const invoice = await getInvoice(req.params.id);
    await accessOr404(req, invoice.business_id);
    res.json({ data: invoice });
  }),
);

router.patch(
  '/:id',
  requireWriteRole,
  asyncHandler(async (req, res) => {
    const invoice = await getInvoice(req.params.id);
    const access = await accessOr404(req, invoice.business_id, 'invoices.write');
    if (access.mode === 'granted') throw notFound('Business not found');
    const input = parse(
      z.object({
        status: z.enum(['draft', 'issued', 'partially_paid', 'paid', 'overdue', 'cancelled', 'disputed']).optional(),
        dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        description: z.string().max(500).optional(),
        poNumber: z.string().max(120).optional(),
        reason: z.string().max(500).optional(),
      }),
      req.body,
    );
    res.json({ data: await updateInvoice(req.auth, invoice.id, input, { ip: req.ip }) });
  }),
);

router.post(
  '/:id/verify',
  requireWriteRole,
  asyncHandler(async (req, res) => {
    const invoice = await getInvoice(req.params.id);
    const access = await accessOr404(req, invoice.business_id, 'invoices.write');
    if (access.mode === 'granted') throw notFound('Business not found');
    res.json({ data: await verifyInvoiceRecord(req.auth, invoice.id, { ip: req.ip }) });
  }),
);

router.get(
  '/:id/verification',
  asyncHandler(async (req, res) => {
    const invoice = await getInvoice(req.params.id);
    await accessOr404(req, invoice.business_id);
    res.json({ data: invoice.verification });
  }),
);

const paymentSchema = z.object({
  amount: z.coerce.number().positive().max(1_000_000_000_000),
  currency: z.string().length(3),
  // Accept both a calendar date and a full timestamp. Dates are a normal way
  // to record a bank settlement; MySQL stores them at midnight.
  paidAt: z.string().refine((value) => /^\d{4}-\d{2}-\d{2}([T ].*)?$/.test(value) && !Number.isNaN(Date.parse(value)), {
    message: 'paidAt must be an ISO date or date-time',
  }),
  method: z.enum(['bank_transfer', 'mobile_money', 'card', 'cash', 'cheque', 'offset', 'other']),
  reference: z.string().max(160).optional().nullable(),
  payerName: z.string().max(255).optional().nullable(),
  payeeName: z.string().max(255).optional().nullable(),
  documentId: uuidLike.optional().nullable(),
});

router.post(
  '/:id/payments',
  requireWriteRole,
  asyncHandler(async (req, res) => {
    const invoice = await getInvoice(req.params.id);
    const access = await accessOr404(req, invoice.business_id, 'invoices.write');
    if (access.mode === 'granted') throw notFound('Business not found');
    const input = parse(paymentSchema, req.body);
    res.status(201).json({ data: await recordPayment(req.auth, invoice.id, input, { ip: req.ip }) });
  }),
);

export const commercialRouter = Router();
commercialRouter.use(requireAuth);

const kinds = {
  'purchase-orders': { table: 'purchase_orders', create: createPurchaseOrder, schema: createPurchaseOrderSchema },
  contracts: { table: 'contracts', create: createContract, schema: createContractSchema },
  'delivery-evidence': { table: 'delivery_evidence', create: createDelivery, schema: createDeliverySchema },
};

for (const [path, kind] of Object.entries(kinds)) {
  commercialRouter.get(
    `/${path}`,
    asyncHandler(async (req, res) => {
      const businessId = String(req.query.businessId || '');
      await accessOr404(req, businessId);
      res.json({ data: await listCommercialRecords(businessId, kind.table) });
    }),
  );
  commercialRouter.post(
    `/${path}`,
    requireWriteRole,
    asyncHandler(async (req, res) => {
      const input = parse(kind.schema, req.body);
      const access = await accessOr404(req, input.businessId, 'invoices.write');
      if (access.mode === 'granted') throw notFound('Business not found');
      res.status(201).json({ data: await kind.create(req.auth, input) });
    }),
  );
}

export default router;
