-- 005: reconciliation, Trust Records, evidence, verification events, tamper-evident audit
SET NAMES utf8mb4;

ALTER TABLE payment_records
  ADD CONSTRAINT fk_pay_txn FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS reconciliations (
  id            CHAR(26)     NOT NULL PRIMARY KEY,
  business_id   CHAR(26)     NOT NULL,
  status        VARCHAR(16)  NOT NULL DEFAULT 'completed',
  rules_json    JSON         NOT NULL,
  stats_json    JSON         NOT NULL,
  transaction_count INT      NOT NULL DEFAULT 0,
  invoice_count INT          NOT NULL DEFAULT 0,
  run_by_user_id CHAR(26)    NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_recon_business (business_id, created_at),
  CONSTRAINT fk_recon_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  CONSTRAINT chk_recon_status CHECK (status IN ('running','completed','failed'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS reconciliation_matches (
  id                CHAR(26)      NOT NULL PRIMARY KEY,
  reconciliation_id CHAR(26)      NOT NULL,
  invoice_id        CHAR(26)      NULL,
  transaction_id    CHAR(26)      NULL,
  match_type        VARCHAR(16)   NOT NULL,
  score             DECIMAL(5,4)  NOT NULL,
  amount_applied    DECIMAL(20,4) NULL,
  currency_code     CHAR(3)       NULL,
  differences_json  JSON          NULL,
  explanation_json  JSON          NOT NULL,
  status            VARCHAR(16)   NOT NULL DEFAULT 'suggested',
  reviewed_by       CHAR(26)      NULL,
  reviewed_at       DATETIME(3)   NULL,
  created_at        DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_match_recon (reconciliation_id, match_type),
  KEY idx_match_invoice (invoice_id),
  KEY idx_match_txn (transaction_id),
  CONSTRAINT fk_match_recon FOREIGN KEY (reconciliation_id) REFERENCES reconciliations(id) ON DELETE CASCADE,
  CONSTRAINT fk_match_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
  CONSTRAINT fk_match_txn FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE,
  CONSTRAINT chk_match_type CHECK (match_type IN ('exact','probable','partial','unmatched')),
  CONSTRAINT chk_match_status CHECK (status IN ('suggested','accepted','rejected'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS trust_records (
  id                CHAR(26)      NOT NULL PRIMARY KEY,
  business_id       CHAR(26)      NOT NULL,
  version           INT           NOT NULL,
  status            VARCHAR(32)   NOT NULL,
  evidence_score    DECIMAL(5,2)  NULL,
  evidence_grade    CHAR(1)       NULL,
  coverage          DECIMAL(5,4)  NOT NULL DEFAULT 0,
  confidence        DECIMAL(5,4)  NOT NULL DEFAULT 0,
  payload           JSON          NOT NULL,
  methodology_version VARCHAR(16) NOT NULL,
  hash              CHAR(64)      NOT NULL,
  previous_hash     CHAR(64)      NULL,
  generated_by_user_id CHAR(26)   NULL,
  generated_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  superseded_by_id  CHAR(26)      NULL,
  UNIQUE KEY uq_trust_version (business_id, version),
  KEY idx_trust_business (business_id, generated_at),
  CONSTRAINT fk_trust_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  CONSTRAINT fk_trust_superseded FOREIGN KEY (superseded_by_id) REFERENCES trust_records(id) ON DELETE SET NULL,
  CONSTRAINT chk_trust_grade CHECK (evidence_grade IS NULL OR evidence_grade IN ('A','B','C','D','E'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS evidence_items (
  id              CHAR(26)      NOT NULL PRIMARY KEY,
  business_id     CHAR(26)      NOT NULL,
  trust_record_id CHAR(26)      NULL,
  category        VARCHAR(40)   NOT NULL,
  source_type     VARCHAR(40)   NOT NULL,
  source_id       CHAR(26)      NULL,
  provenance      VARCHAR(32)   NOT NULL,
  weight          DECIMAL(5,2)  NOT NULL DEFAULT 0,
  confidence      DECIMAL(5,4)  NOT NULL DEFAULT 0,
  status          VARCHAR(16)   NOT NULL,
  description     VARCHAR(500)  NOT NULL,
  observed_at     DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_evidence_business (business_id, category),
  KEY idx_evidence_trust (trust_record_id),
  CONSTRAINT fk_evidence_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  CONSTRAINT fk_evidence_trust FOREIGN KEY (trust_record_id) REFERENCES trust_records(id) ON DELETE SET NULL,
  CONSTRAINT chk_evidence_provenance CHECK (provenance IN ('self_declared','document_extracted','counterparty_confirmed','independently_verified')),
  CONSTRAINT chk_evidence_status CHECK (status IN ('positive','negative','neutral','missing'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS verification_events (
  id            CHAR(26)     NOT NULL PRIMARY KEY,
  business_id   CHAR(26)     NULL,
  entity_type   VARCHAR(40)  NOT NULL,
  entity_id     CHAR(26)     NULL,
  event_type    VARCHAR(60)  NOT NULL,
  outcome       VARCHAR(32)  NOT NULL,
  rules_json    JSON         NULL,
  explanation   TEXT         NULL,
  actor_type    VARCHAR(16)  NOT NULL DEFAULT 'system',
  actor_id      CHAR(26)     NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_vevents_business (business_id, created_at),
  KEY idx_vevents_entity (entity_type, entity_id),
  CONSTRAINT fk_vevents_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Append-only audit log. hash = SHA-256(prev_hash || canonical payload).
CREATE TABLE IF NOT EXISTS audit_chain_heads (
  org_id      CHAR(26)    NOT NULL PRIMARY KEY,
  last_hash   CHAR(64)    NOT NULL,
  last_seq    BIGINT      NOT NULL DEFAULT 0,
  updated_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_chain_org FOREIGN KEY (org_id) REFERENCES organisations(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_logs (
  id            CHAR(26)     NOT NULL PRIMARY KEY,
  org_id        CHAR(26)     NOT NULL,
  seq           BIGINT       NOT NULL,
  actor_type    VARCHAR(16)  NOT NULL,
  actor_id      CHAR(26)     NULL,
  actor_label   VARCHAR(255) NULL,
  action        VARCHAR(80)  NOT NULL,
  entity_type   VARCHAR(40)  NOT NULL,
  entity_id     CHAR(26)     NULL,
  metadata_json JSON         NULL,
  ip            VARCHAR(64)  NULL,
  prev_hash     CHAR(64)     NULL,
  hash          CHAR(64)     NOT NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_audit_seq (org_id, seq),
  KEY idx_audit_org (org_id, created_at),
  KEY idx_audit_entity (entity_type, entity_id),
  CONSTRAINT fk_audit_org FOREIGN KEY (org_id) REFERENCES organisations(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
