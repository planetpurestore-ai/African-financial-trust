-- 003: document ingestion, extraction runs, field provenance
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS documents (
  id                    CHAR(26)     NOT NULL PRIMARY KEY,
  business_id           CHAR(26)     NOT NULL,
  uploaded_by_user_id   CHAR(26)     NULL,
  original_filename     VARCHAR(255) NOT NULL,
  storage_key           VARCHAR(512) NOT NULL,
  mime_type             VARCHAR(120) NOT NULL,
  size_bytes            BIGINT       NOT NULL,
  sha256                CHAR(64)     NOT NULL,
  doc_type              VARCHAR(40)  NOT NULL DEFAULT 'unclassified',
  doc_type_confidence   DECIMAL(5,4) NOT NULL DEFAULT 0,
  status                VARCHAR(24)  NOT NULL DEFAULT 'uploaded',
  duplicate_of_id       CHAR(26)     NULL,
  page_count            INT          NULL,
  extraction_method     VARCHAR(32)  NULL,
  extraction_confidence DECIMAL(5,4) NULL,
  error_message         TEXT         NULL,
  version               INT          NOT NULL DEFAULT 1,
  supersedes_id         CHAR(26)     NULL,
  metadata_json         JSON         NULL,
  created_at            DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  processed_at          DATETIME(3)  NULL,
  KEY idx_docs_business (business_id, created_at),
  KEY idx_docs_sha (business_id, sha256),
  KEY idx_docs_status (status),
  CONSTRAINT fk_docs_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  CONSTRAINT fk_docs_duplicate FOREIGN KEY (duplicate_of_id) REFERENCES documents(id) ON DELETE SET NULL,
  CONSTRAINT fk_docs_supersedes FOREIGN KEY (supersedes_id) REFERENCES documents(id) ON DELETE SET NULL,
  CONSTRAINT chk_doc_status CHECK (status IN ('uploaded','queued','processing','extracted','needs_review','failed','duplicate')),
  CONSTRAINT chk_doc_type CHECK (doc_type IN ('unclassified','invoice','purchase_order','contract','delivery_note','receipt','bank_statement','payment_confirmation','credit_note','supplier_statement','accounting_export','other'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS document_extractions (
  id              CHAR(26)     NOT NULL PRIMARY KEY,
  document_id     CHAR(26)     NOT NULL,
  method          VARCHAR(24)  NOT NULL,
  engine          VARCHAR(80)  NULL,
  status          VARCHAR(16)  NOT NULL,
  raw_text        LONGTEXT     NULL,
  confidence      DECIMAL(5,4) NULL,
  error_message   TEXT         NULL,
  duration_ms     INT          NULL,
  created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_extractions_doc (document_id, created_at),
  CONSTRAINT fk_extractions_doc FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
  CONSTRAINT chk_extraction_method CHECK (method IN ('pdf_text','csv','xlsx','json','ocr','manual','ai')),
  CONSTRAINT chk_extraction_status CHECK (status IN ('succeeded','failed','partial'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS extracted_fields (
  id               CHAR(26)     NOT NULL PRIMARY KEY,
  document_id      CHAR(26)     NOT NULL,
  extraction_id    CHAR(26)     NULL,
  field_name       VARCHAR(80)  NOT NULL,
  field_value      TEXT         NULL,
  normalized_value TEXT         NULL,
  confidence       DECIMAL(5,4) NOT NULL DEFAULT 0,
  page             INT          NULL,
  snippet          VARCHAR(512) NULL,
  method           VARCHAR(24)  NOT NULL,
  reviewed         TINYINT(1)   NOT NULL DEFAULT 0,
  created_at       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_fields_doc (document_id, field_name),
  CONSTRAINT fk_fields_doc FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
  CONSTRAINT fk_fields_extraction FOREIGN KEY (extraction_id) REFERENCES document_extractions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
