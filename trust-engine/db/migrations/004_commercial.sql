-- 004: commercial records — invoices, purchase orders, contracts, delivery evidence, payments, transactions
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS invoices (
  id                    CHAR(26)      NOT NULL PRIMARY KEY,
  business_id           CHAR(26)      NOT NULL,
  counterparty_id       CHAR(26)      NULL,
  invoice_number        VARCHAR(120)  NOT NULL,
  issue_date            DATE          NOT NULL,
  due_date              DATE          NULL,
  currency_code         CHAR(3)       NOT NULL,
  subtotal              DECIMAL(20,4) NOT NULL DEFAULT 0,
  tax_amount            DECIMAL(20,4) NOT NULL DEFAULT 0,
  total_amount          DECIMAL(20,4) NOT NULL,
  amount_paid           DECIMAL(20,4) NOT NULL DEFAULT 0,
  balance_due           DECIMAL(20,4) NOT NULL DEFAULT 0,
  po_number             VARCHAR(120)  NULL,
  description           VARCHAR(500)  NULL,
  source                VARCHAR(16)   NOT NULL DEFAULT 'manual',
  document_id           CHAR(26)      NULL,
  status                VARCHAR(24)   NOT NULL DEFAULT 'issued',
  verification_status   VARCHAR(32)   NOT NULL DEFAULT 'pending_verification',
  verification_score    DECIMAL(5,2)  NULL,
  verified_at           DATETIME(3)   NULL,
  last_verified_at      DATETIME(3)   NULL,
  extraction_confidence DECIMAL(5,4)  NULL,
  created_by_user_id    CHAR(26)      NULL,
  created_at            DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at            DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_inv_business (business_id, issue_date),
  KEY idx_inv_number (business_id, invoice_number),
  KEY idx_inv_cp (counterparty_id),
  KEY idx_inv_status (verification_status),
  CONSTRAINT fk_inv_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  CONSTRAINT fk_inv_cp FOREIGN KEY (counterparty_id) REFERENCES counterparties(id) ON DELETE SET NULL,
  CONSTRAINT fk_inv_doc FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE SET NULL,
  CONSTRAINT chk_inv_status CHECK (status IN ('draft','issued','partially_paid','paid','overdue','cancelled','disputed')),
  CONSTRAINT chk_inv_vstatus CHECK (verification_status IN ('pending_verification','evidence_insufficient','verification_in_progress','verified','partially_verified','inconsistent','disputed','duplicate_suspected','rejected'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS invoice_lines (
  id            CHAR(26)      NOT NULL PRIMARY KEY,
  invoice_id    CHAR(26)      NOT NULL,
  line_no       INT           NOT NULL,
  description   VARCHAR(500)  NULL,
  quantity      DECIMAL(20,4) NULL,
  unit_price    DECIMAL(20,4) NULL,
  line_total    DECIMAL(20,4) NOT NULL,
  tax_rate      DECIMAL(7,4)  NULL,
  KEY idx_lines_invoice (invoice_id, line_no),
  CONSTRAINT fk_lines_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS invoice_status_history (
  id            CHAR(26)     NOT NULL PRIMARY KEY,
  invoice_id    CHAR(26)     NOT NULL,
  from_status   VARCHAR(32)  NULL,
  to_status     VARCHAR(32)  NOT NULL,
  reason        VARCHAR(500) NULL,
  actor_id      CHAR(26)     NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_invhist_invoice (invoice_id, created_at),
  CONSTRAINT fk_invhist_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS purchase_orders (
  id              CHAR(26)      NOT NULL PRIMARY KEY,
  business_id     CHAR(26)      NOT NULL,
  counterparty_id CHAR(26)      NULL,
  po_number       VARCHAR(120)  NOT NULL,
  issue_date      DATE          NOT NULL,
  currency_code   CHAR(3)       NOT NULL,
  total_amount    DECIMAL(20,4) NOT NULL,
  status          VARCHAR(24)   NOT NULL DEFAULT 'open',
  document_id     CHAR(26)      NULL,
  notes           VARCHAR(500)  NULL,
  created_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_po_business (business_id, po_number),
  CONSTRAINT fk_po_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  CONSTRAINT fk_po_cp FOREIGN KEY (counterparty_id) REFERENCES counterparties(id) ON DELETE SET NULL,
  CONSTRAINT fk_po_doc FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS contracts (
  id                CHAR(26)      NOT NULL PRIMARY KEY,
  business_id       CHAR(26)      NOT NULL,
  counterparty_id   CHAR(26)      NULL,
  contract_number   VARCHAR(120)  NOT NULL,
  title             VARCHAR(255)  NULL,
  start_date        DATE          NULL,
  end_date          DATE          NULL,
  currency_code     CHAR(3)       NULL,
  contract_value    DECIMAL(20,4) NULL,
  status            VARCHAR(24)   NOT NULL DEFAULT 'active',
  document_id       CHAR(26)      NULL,
  created_at        DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_contract_business (business_id, contract_number),
  CONSTRAINT fk_contract_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  CONSTRAINT fk_contract_cp FOREIGN KEY (counterparty_id) REFERENCES counterparties(id) ON DELETE SET NULL,
  CONSTRAINT fk_contract_doc FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS delivery_evidence (
  id                  CHAR(26)     NOT NULL PRIMARY KEY,
  business_id         CHAR(26)     NOT NULL,
  invoice_id          CHAR(26)     NULL,
  delivery_note_number VARCHAR(120) NOT NULL,
  delivery_date       DATE         NOT NULL,
  recipient_name      VARCHAR(255) NULL,
  status              VARCHAR(24)  NOT NULL DEFAULT 'recorded',
  document_id         CHAR(26)     NULL,
  notes               VARCHAR(500) NULL,
  created_at          DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_delivery_business (business_id),
  KEY idx_delivery_invoice (invoice_id),
  CONSTRAINT fk_delivery_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  CONSTRAINT fk_delivery_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE SET NULL,
  CONSTRAINT fk_delivery_doc FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payment_records (
  id                CHAR(26)      NOT NULL PRIMARY KEY,
  business_id       CHAR(26)      NOT NULL,
  invoice_id        CHAR(26)      NULL,
  transaction_id    CHAR(26)      NULL,
  amount            DECIMAL(20,4) NOT NULL,
  currency_code     CHAR(3)       NOT NULL,
  paid_at           DATETIME(3)   NOT NULL,
  method            VARCHAR(40)   NOT NULL,
  reference         VARCHAR(160)  NULL,
  payer_name        VARCHAR(255)  NULL,
  payee_name        VARCHAR(255)  NULL,
  source            VARCHAR(24)   NOT NULL DEFAULT 'manual',
  document_id       CHAR(26)      NULL,
  created_at        DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_pay_business (business_id, paid_at),
  KEY idx_pay_invoice (invoice_id),
  CONSTRAINT fk_pay_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  CONSTRAINT fk_pay_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE SET NULL,
  CONSTRAINT fk_pay_doc FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE SET NULL,
  CONSTRAINT chk_pay_method CHECK (method IN ('bank_transfer','mobile_money','card','cash','cheque','offset','other'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS import_batches (
  id            CHAR(26)     NOT NULL PRIMARY KEY,
  business_id   CHAR(26)     NOT NULL,
  source_type   VARCHAR(24)  NOT NULL,
  provider      VARCHAR(60)  NULL,
  filename      VARCHAR(255) NULL,
  row_count     INT          NOT NULL DEFAULT 0,
  imported      INT          NOT NULL DEFAULT 0,
  duplicates    INT          NOT NULL DEFAULT 0,
  failed        INT          NOT NULL DEFAULT 0,
  status        VARCHAR(16)  NOT NULL DEFAULT 'completed',
  created_by    CHAR(26)     NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_batch_business (business_id, created_at),
  CONSTRAINT fk_batch_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS transactions (
  id                CHAR(26)      NOT NULL PRIMARY KEY,
  business_id       CHAR(26)      NOT NULL,
  batch_id          CHAR(26)      NULL,
  source_type       VARCHAR(24)   NOT NULL,
  provider          VARCHAR(60)   NULL,
  external_id       VARCHAR(160)  NULL,
  direction         VARCHAR(8)    NOT NULL,
  amount            DECIMAL(20,4) NOT NULL,
  fee_amount        DECIMAL(20,4) NOT NULL DEFAULT 0,
  currency_code     CHAR(3)       NOT NULL,
  value_date        DATE          NOT NULL,
  posted_at         DATETIME(3)   NULL,
  reference         VARCHAR(160)  NULL,
  description       VARCHAR(500)  NULL,
  counterparty_name VARCHAR(255)  NULL,
  raw_json          JSON          NULL,
  created_at        DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_txn_business (business_id, value_date),
  KEY idx_txn_ref (business_id, reference),
  UNIQUE KEY uq_txn_external (business_id, source_type, external_id),
  CONSTRAINT fk_txn_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  CONSTRAINT fk_txn_batch FOREIGN KEY (batch_id) REFERENCES import_batches(id) ON DELETE SET NULL,
  CONSTRAINT chk_txn_source CHECK (source_type IN ('bank','mobile_money','payment_provider','accounting','manual')),
  CONSTRAINT chk_txn_direction CHECK (direction IN ('credit','debit'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
