-- 006: integrations, encrypted credentials, processing jobs, idempotency, reports
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS integrations (
  id              CHAR(26)     NOT NULL PRIMARY KEY,
  org_id          CHAR(26)     NOT NULL,
  provider        VARCHAR(60)  NOT NULL,
  category        VARCHAR(40)  NOT NULL,
  display_name    VARCHAR(120) NOT NULL,
  status          VARCHAR(32)  NOT NULL DEFAULT 'not_configured',
  environment     VARCHAR(16)  NOT NULL DEFAULT 'production',
  config_json     JSON         NULL,
  capabilities    JSON         NOT NULL,
  last_checked_at DATETIME(3)  NULL,
  last_error      TEXT         NULL,
  created_by      CHAR(26)     NULL,
  created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_integration (org_id, provider, environment),
  KEY idx_integration_org (org_id, category),
  CONSTRAINT fk_integration_org FOREIGN KEY (org_id) REFERENCES organisations(id) ON DELETE CASCADE,
  CONSTRAINT chk_integration_status CHECK (status IN ('not_configured','awaiting_credentials','configured','connected','error','disabled')),
  CONSTRAINT chk_integration_category CHECK (category IN ('mobile_money','bank','open_banking','payment_provider','accounting','erp','e_invoicing','registry','tax','logistics'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Values are AES-256-GCM ciphertext; the key lives only in the environment.
CREATE TABLE IF NOT EXISTS integration_credentials (
  id              CHAR(26)     NOT NULL PRIMARY KEY,
  integration_id  CHAR(26)     NOT NULL,
  key_name        VARCHAR(80)  NOT NULL,
  ciphertext      TEXT         NOT NULL,
  iv              VARCHAR(32)  NOT NULL,
  auth_tag        VARCHAR(32)  NOT NULL,
  key_version     INT          NOT NULL DEFAULT 1,
  created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  rotated_at      DATETIME(3)  NULL,
  UNIQUE KEY uq_credential (integration_id, key_name),
  CONSTRAINT fk_credential_integration FOREIGN KEY (integration_id) REFERENCES integrations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS processing_jobs (
  id            CHAR(26)     NOT NULL PRIMARY KEY,
  org_id        CHAR(26)     NOT NULL,
  job_type      VARCHAR(60)  NOT NULL,
  entity_type   VARCHAR(40)  NULL,
  entity_id     CHAR(26)     NULL,
  payload_json  JSON         NULL,
  status        VARCHAR(16)  NOT NULL DEFAULT 'queued',
  attempts      INT          NOT NULL DEFAULT 0,
  max_attempts  INT          NOT NULL DEFAULT 5,
  last_error    TEXT         NULL,
  run_after     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  started_at    DATETIME(3)  NULL,
  finished_at   DATETIME(3)  NULL,
  locked_by     VARCHAR(80)  NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_jobs_status (status, run_after),
  KEY idx_jobs_entity (entity_type, entity_id),
  KEY idx_jobs_org (org_id, created_at),
  CONSTRAINT fk_jobs_org FOREIGN KEY (org_id) REFERENCES organisations(id) ON DELETE CASCADE,
  CONSTRAINT chk_job_status CHECK (status IN ('queued','running','completed','failed','cancelled'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS idempotency_keys (
  id              CHAR(26)     NOT NULL PRIMARY KEY,
  org_id          CHAR(26)     NOT NULL,
  idem_key        VARCHAR(120) NOT NULL,
  endpoint        VARCHAR(160) NOT NULL,
  request_hash    CHAR(64)     NOT NULL,
  response_status INT          NULL,
  response_body   JSON         NULL,
  created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expires_at      DATETIME(3)  NOT NULL,
  UNIQUE KEY uq_idem (org_id, idem_key, endpoint),
  CONSTRAINT fk_idem_org FOREIGN KEY (org_id) REFERENCES organisations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS reports (
  id            CHAR(26)     NOT NULL PRIMARY KEY,
  org_id        CHAR(26)     NOT NULL,
  business_id   CHAR(26)     NULL,
  report_type   VARCHAR(60)  NOT NULL,
  format        VARCHAR(8)   NOT NULL,
  params_json   JSON         NULL,
  status        VARCHAR(16)  NOT NULL DEFAULT 'generated',
  filename      VARCHAR(255) NOT NULL,
  storage_key   VARCHAR(512) NOT NULL,
  size_bytes    BIGINT       NOT NULL DEFAULT 0,
  generated_by  CHAR(26)     NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_reports_org (org_id, created_at),
  CONSTRAINT fk_reports_org FOREIGN KEY (org_id) REFERENCES organisations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
