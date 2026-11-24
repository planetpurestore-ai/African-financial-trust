import { processDocument } from './modules/documents/service.js';
import { generateTrustRecord } from './modules/trust/service.js';
import { registerJobHandler } from './modules/jobs/service.js';
import { one } from './db/pool.js';

export function registerJobHandlers() {
  registerJobHandler('document.extract', async ({ payload }) => {
    await processDocument(payload.documentId);
  });

  registerJobHandler('trust.generate', async ({ job, payload }) => {
    const business = await one('SELECT owner_org_id FROM businesses WHERE id = ?', [payload.businessId]);
    if (!business) throw new Error('Business not found');
    const auth = {
      type: 'system',
      org: { id: business.owner_org_id, orgType: 'business' },
      role: 'system_admin',
      user: null,
      apiKeyId: null,
    };
    await generateTrustRecord(auth, payload.businessId, {});
  });
}
