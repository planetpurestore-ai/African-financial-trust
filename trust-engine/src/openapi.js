const errorResponse = {
  description: 'Error',
  content: {
    'application/json': {
      schema: {
        type: 'object',
        properties: {
          error: {
            type: 'object',
            properties: {
              code: { type: 'string' },
              message: { type: 'string' },
              details: {},
              request_id: { type: 'string' },
            },
          },
        },
      },
    },
  },
};

const idParam = {
  name: 'id',
  in: 'path',
  required: true,
  schema: { type: 'string', minLength: 26, maxLength: 26 },
};

function listParams() {
  return [
    { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 25 } },
    { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0, default: 0 } },
  ];
}

export const openApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'African Financial Trust — Trust Engine API',
    version: '1.0.0',
    description:
      'Evidence ingestion, invoice verification, transaction reconciliation and auditable Trust Records for African commerce. Authentication uses an httpOnly session cookie for the dashboard or an API key (`Authorization: Bearer aft_<prefix>_<secret>`) for institutions. All business-scoped resources are tenant-isolated; institutions require an active access grant.',
    contact: { name: 'African Financial Trust', url: 'https://africanfinancialtrust.pages.dev/' },
  },
  servers: [{ url: '/api/v1', description: 'Current deployment' }],
  security: [{ sessionCookie: [] }, { apiKey: [] }],
  tags: [
    { name: 'Auth' },
    { name: 'Businesses' },
    { name: 'Documents' },
    { name: 'Invoices' },
    { name: 'Transactions' },
    { name: 'Reconciliation' },
    { name: 'Trust Records' },
    { name: 'Counterparties' },
    { name: 'Integrations' },
    { name: 'Audit' },
    { name: 'Reports' },
    { name: 'System' },
  ],
  components: {
    securitySchemes: {
      sessionCookie: { type: 'apiKey', in: 'cookie', name: 'aft_session' },
      apiKey: { type: 'http', scheme: 'bearer', bearerFormat: 'aft_<prefix>_<secret>' },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: { error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' }, request_id: { type: 'string' } } } },
      },
      Business: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          legal_name: { type: 'string' },
          trading_name: { type: 'string', nullable: true },
          country_code: { type: 'string', example: 'RW' },
          registration_number: { type: 'string', nullable: true },
          tax_id: { type: 'string', nullable: true },
          verification_status: {
            type: 'string',
            enum: ['unverified', 'self_declared', 'documents_submitted', 'partially_verified', 'verified', 'rejected'],
          },
          verification_level: { type: 'integer', minimum: 0, maximum: 4 },
        },
      },
      Invoice: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          business_id: { type: 'string' },
          counterparty_id: { type: 'string', nullable: true },
          invoice_number: { type: 'string' },
          issue_date: { type: 'string', format: 'date' },
          due_date: { type: 'string', format: 'date', nullable: true },
          currency_code: { type: 'string', example: 'RWF' },
          subtotal: { type: 'number' },
          tax_amount: { type: 'number' },
          total_amount: { type: 'number' },
          amount_paid: { type: 'number' },
          balance_due: { type: 'number' },
          verification_status: {
            type: 'string',
            enum: [
              'pending_verification',
              'evidence_insufficient',
              'verification_in_progress',
              'verified',
              'partially_verified',
              'inconsistent',
              'disputed',
              'duplicate_suspected',
              'rejected',
            ],
          },
          verification_score: { type: 'number', nullable: true },
        },
      },
      TrustRecord: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          business_id: { type: 'string' },
          version: { type: 'integer' },
          status: { type: 'string' },
          evidence_score: { type: 'number' },
          evidence_grade: { type: 'string', enum: ['A', 'B', 'C', 'D', 'E'] },
          coverage: { type: 'number' },
          confidence: { type: 'number' },
          hash: { type: 'string' },
          previous_hash: { type: 'string', nullable: true },
          payload: { type: 'object' },
        },
      },
    },
  },
  paths: {
    '/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Sign in and receive a session cookie',
        security: [],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['email', 'password'], properties: { email: { type: 'string' }, password: { type: 'string' } } } } },
        },
        responses: { 200: { description: 'Signed in' }, 401: errorResponse, 429: errorResponse },
      },
    },
    '/auth/activate': {
      post: {
        tags: ['Auth'],
        summary: 'Redeem a single-use invitation and set the initial password',
        security: [],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['token', 'password'], properties: { token: { type: 'string' }, password: { type: 'string', minLength: 14 }, fullName: { type: 'string' } } } } },
        },
        responses: { 200: { description: 'Account activated' }, 401: errorResponse, 429: errorResponse },
      },
    },
    '/auth/invitations': {
      post: {
        tags: ['Auth'],
        summary: 'Create a scoped, expiring user invitation',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['email', 'fullName', 'role'], properties: { email: { type: 'string' }, fullName: { type: 'string' }, role: { type: 'string' } } } } },
        },
        responses: { 201: { description: 'Invitation created' }, 403: errorResponse },
      },
    },
    '/auth/logout': { post: { tags: ['Auth'], summary: 'Revoke the current session', responses: { 200: { description: 'Signed out' } } } },
    '/auth/me': { get: { tags: ['Auth'], summary: 'Current user, organisation and role', responses: { 200: { description: 'Current principal' }, 401: errorResponse } } },
    '/businesses': {
      get: {
        tags: ['Businesses'],
        summary: 'List businesses visible to the caller',
        parameters: [
          { name: 'search', in: 'query', schema: { type: 'string' } },
          { name: 'status', in: 'query', schema: { type: 'string' } },
          { name: 'country', in: 'query', schema: { type: 'string', minLength: 2, maxLength: 2 } },
          ...listParams(),
        ],
        responses: { 200: { description: 'Businesses' } },
      },
      post: {
        tags: ['Businesses'],
        summary: 'Register a business (business_admin or system_admin)',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['legalName', 'countryCode'],
                properties: {
                  legalName: { type: 'string' },
                  tradingName: { type: 'string' },
                  countryCode: { type: 'string', example: 'RW' },
                  registrationNumber: { type: 'string' },
                  taxId: { type: 'string' },
                  city: { type: 'string' },
                  email: { type: 'string', format: 'email' },
                },
              },
            },
          },
        },
        responses: { 201: { description: 'Created', content: { 'application/json': { schema: { $ref: '#/components/schemas/Business' } } } }, 422: errorResponse },
      },
    },
    '/businesses/{id}': {
      get: { tags: ['Businesses'], summary: 'Business detail with identifiers and statistics', parameters: [idParam], responses: { 200: { description: 'Business' }, 404: errorResponse } },
      patch: { tags: ['Businesses'], summary: 'Update a business (changes are versioned)', parameters: [idParam], responses: { 200: { description: 'Updated' }, 404: errorResponse } },
    },
    '/businesses/{id}/verify': {
      post: {
        tags: ['Businesses'],
        summary: 'Record a manual identity verification decision',
        description: 'Requires institution_admin or system_admin. A verification reference and method are stored with the decision.',
        parameters: [idParam],
        responses: { 200: { description: 'Verification recorded' } },
      },
    },
    '/businesses/{id}/access-grants': {
      get: { tags: ['Businesses'], summary: 'List institution access grants', parameters: [idParam], responses: { 200: { description: 'Grants' } } },
      post: { tags: ['Businesses'], summary: 'Grant an institution access to this business', parameters: [idParam], responses: { 201: { description: 'Granted' } } },
    },
    '/documents': {
      post: {
        tags: ['Documents'],
        summary: 'Upload a document for extraction',
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['businessId', 'file'],
                properties: { businessId: { type: 'string' }, file: { type: 'string', format: 'binary' } },
              },
            },
          },
        },
        responses: { 201: { description: 'Queued for extraction' }, 413: errorResponse, 422: errorResponse },
      },
      get: {
        tags: ['Documents'],
        summary: 'List documents for a business',
        parameters: [{ name: 'businessId', in: 'query', required: true, schema: { type: 'string' } }, ...listParams()],
        responses: { 200: { description: 'Documents' } },
      },
    },
    '/documents/{id}': { get: { tags: ['Documents'], summary: 'Document with extraction runs and field provenance', parameters: [idParam], responses: { 200: { description: 'Document' } } } },
    '/documents/{id}/file': { get: { tags: ['Documents'], summary: 'Download the original file (access-checked)', parameters: [idParam], responses: { 200: { description: 'File' } } } },
    '/documents/{id}/process-now': { post: { tags: ['Documents'], summary: 'Process extraction synchronously', parameters: [idParam], responses: { 200: { description: 'Extraction result' } } } },
    '/invoices': {
      get: { tags: ['Invoices'], summary: 'List invoices for a business', parameters: [{ name: 'businessId', in: 'query', required: true, schema: { type: 'string' } }, ...listParams()], responses: { 200: { description: 'Invoices' } } },
      post: {
        tags: ['Invoices'],
        summary: 'Create an invoice',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Invoice' } } } },
        responses: { 201: { description: 'Created' } },
      },
    },
    '/invoices/{id}': { get: { tags: ['Invoices'], summary: 'Invoice with lines, payments and verification result', parameters: [idParam], responses: { 200: { description: 'Invoice' } } } },
    '/invoices/{id}/verify': {
      post: {
        tags: ['Invoices'],
        summary: 'Run deterministic invoice verification',
        description: 'Evaluates 12 named rules across identity, integrity, commercial, fulfilment and payment evidence. Returns the rule-level result and the derived status.',
        parameters: [idParam],
        responses: { 200: { description: 'Verification result' } },
      },
    },
    '/invoices/{id}/payments': { post: { tags: ['Invoices'], summary: 'Record a payment against an invoice', parameters: [idParam], responses: { 201: { description: 'Payment recorded' } } } },
    '/commercial/purchase-orders': {
      get: { tags: ['Invoices'], summary: 'List purchase orders', responses: { 200: { description: 'Purchase orders' } } },
      post: { tags: ['Invoices'], summary: 'Create a purchase order', responses: { 201: { description: 'Created' } } },
    },
    '/commercial/contracts': { post: { tags: ['Invoices'], summary: 'Create a contract', responses: { 201: { description: 'Created' } } } },
    '/commercial/delivery-evidence': { post: { tags: ['Invoices'], summary: 'Record delivery evidence', responses: { 201: { description: 'Created' } } } },
    '/transactions': {
      get: { tags: ['Transactions'], summary: 'List normalised transactions', parameters: [{ name: 'businessId', in: 'query', required: true, schema: { type: 'string' } }, ...listParams()], responses: { 200: { description: 'Transactions' } } },
      post: { tags: ['Transactions'], summary: 'Create a transaction manually', responses: { 201: { description: 'Created' } } },
    },
    '/transactions/import': {
      post: {
        tags: ['Transactions'],
        summary: 'Import a CSV statement or a JSON row array',
        description: 'Column mapping is auto-detected for common bank and mobile-money exports and can be overridden with a `mapping` JSON object.',
        responses: { 201: { description: 'Import summary' } },
      },
    },
    '/reconciliation/run': {
      post: {
        tags: ['Reconciliation'],
        summary: 'Reconcile open invoices against transactions',
        description: 'Scores candidate pairs on amount, reference, date, counterparty and currency, then classifies them as exact, probable, partial or unmatched. Matches are suggestions until a human accepts them.',
        responses: { 201: { description: 'Reconciliation result' } },
      },
    },
    '/reconciliation/{id}': { get: { tags: ['Reconciliation'], summary: 'Reconciliation with matches and explanations', parameters: [idParam], responses: { 200: { description: 'Reconciliation' } } } },
    '/reconciliation/matches/{id}/accept': { post: { tags: ['Reconciliation'], summary: 'Accept a suggested match and record the payment', parameters: [idParam], responses: { 200: { description: 'Accepted' } } } },
    '/businesses/{businessId}/trust-record': { get: { tags: ['Trust Records'], summary: 'Latest Trust Record for a business', parameters: [{ name: 'businessId', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Trust Record' }, 404: errorResponse } } },
    '/businesses/{businessId}/trust-record/generate': { post: { tags: ['Trust Records'], summary: 'Generate a new immutable Trust Record version', parameters: [{ name: 'businessId', in: 'path', required: true, schema: { type: 'string' } }], responses: { 201: { description: 'Trust Record' } } } },
    '/trust-records/{id}/verify-hash': { get: { tags: ['Trust Records'], summary: 'Recompute the Trust Record hash and compare', parameters: [idParam], responses: { 200: { description: 'Hash verification' } } } },
    '/counterparties': {
      get: { tags: ['Counterparties'], summary: 'List counterparties', parameters: [{ name: 'businessId', in: 'query', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Counterparties' } } },
      post: { tags: ['Counterparties'], summary: 'Create a counterparty relationship', responses: { 201: { description: 'Created' } } },
    },
    '/counterparties/{id}/request-confirmation': { post: { tags: ['Counterparties'], summary: 'Create a single-use confirmation link', parameters: [idParam], responses: { 201: { description: 'Confirmation link' } } } },
    '/counterparty-confirmations/{token}': {
      get: { tags: ['Counterparties'], summary: 'Public confirmation preview (limited fields)', security: [], responses: { 200: { description: 'Invoice summary' }, 404: errorResponse } },
      post: { tags: ['Counterparties'], summary: 'Counterparty confirms or declines', security: [], responses: { 200: { description: 'Recorded' } } },
    },
    '/integrations': {
      get: { tags: ['Integrations'], summary: 'Adapter catalogue merged with this organisation’s configuration', responses: { 200: { description: 'Integrations' } } },
      post: { tags: ['Integrations'], summary: 'Configure a provider', responses: { 201: { description: 'Configured' } } },
    },
    '/integrations/{id}/credentials': { put: { tags: ['Integrations'], summary: 'Store encrypted credentials', parameters: [idParam], responses: { 200: { description: 'Stored' } } } },
    '/integrations/{id}/check': { post: { tags: ['Integrations'], summary: 'Perform a real authenticated connection check', parameters: [idParam], responses: { 200: { description: 'Connection result' } } } },
    '/api-keys': {
      get: { tags: ['Auth'], summary: 'List API keys (hashes only)', responses: { 200: { description: 'Keys' } } },
      post: { tags: ['Auth'], summary: 'Create an API key; the secret is returned once', responses: { 201: { description: 'Key created' } } },
    },
    '/api-keys/{id}': { delete: { tags: ['Auth'], summary: 'Revoke an API key', parameters: [idParam], responses: { 200: { description: 'Revoked' } } } },
    '/audit': { get: { tags: ['Audit'], summary: 'Query the audit chain', parameters: [...listParams()], responses: { 200: { description: 'Audit entries' } } } },
    '/audit/verify': { get: { tags: ['Audit'], summary: 'Recompute the organisation audit hash chain', responses: { 200: { description: 'Chain status' } } } },
    '/reports': {
      get: { tags: ['Reports'], summary: 'List generated reports', responses: { 200: { description: 'Reports' } } },
      post: { tags: ['Reports'], summary: 'Generate a PDF or CSV report', responses: { 201: { description: 'Report metadata' } } },
    },
    '/reports/{id}/download': { get: { tags: ['Reports'], summary: 'Download a generated report', parameters: [idParam], responses: { 200: { description: 'File' } } } },
    '/system/overview': { get: { tags: ['System'], summary: 'Dashboard counts and breakdowns from live queries', responses: { 200: { description: 'Overview' } } } },
    '/system/health': { get: { tags: ['System'], summary: 'Database, storage, job and integration health', responses: { 200: { description: 'Health' } } } },
    '/system/jobs': { get: { tags: ['System'], summary: 'Processing queue', responses: { 200: { description: 'Jobs' } } } },
  },
};
