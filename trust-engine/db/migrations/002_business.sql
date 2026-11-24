-- 002: business identity, change history, counterparties
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS businesses (
  id                    CHAR(26)     NOT NULL PRIMARY KEY,
  owner_org_id          CHAR(26)     NOT NULL,
  legal_name            VARCHAR(255) NOT NULL,
  trading_name          VARCHAR(255) NULL,
  country_code          CHAR(2)      NOT NULL,
  registration_number   VARCHAR(120) NULL,
  tax_id                VARCHAR(120) NULL,
  legal_form            VARCHAR(80)  NULL,
  incorporation_date    DATE         NULL,
  industry              VARCHAR(120) NULL,
  address_line1         VARCHAR(255) NULL,
  address_line2         VARCHAR(255) NULL,
  city                  VARCHAR(120) NULL,
  region                VARCHAR(120) NULL,
  postal_code           VARCHAR(32)  NULL,
  phone                 VARCHAR(64)  NULL,
  email                 VARCHAR(255) NULL,
  website               VARCHAR(255) NULL,
  verification_status   VARCHAR(32)  NOT NULL DEFAULT 'unverified',
  verification_level    TINYINT      NOT NULL DEFAULT 0,
  verified_at           DATETIME(3)  NULL,
  verified_by_user_id   CHAR(26)     NULL,
  verification_method   VARCHAR(64)  NULL,
  verification_reference VARCHAR(255) NULL,
  risk_flags            JSON         NULL,
  created_by_user_id    CHAR(26)     NULL,
  created_at            DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at            DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_businesses_owner (owner_org_id),
  KEY idx_businesses_country (country_code),
  KEY idx_businesses_reg (country_code, registration_number),
  KEY idx_businesses_status (verification_status),
  CONSTRAINT fk_businesses_owner FOREIGN KEY (owner_org_id) REFERENCES organisations(id) ON DELETE RESTRICT,
  CONSTRAINT chk_business_status CHECK (verification_status IN ('unverified','self_declared','documents_submitted','partially_verified','verified','rejected')),
  CONSTRAINT chk_business_level CHECK (verification_level BETWEEN 0 AND 4)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS business_identifiers (
  id                CHAR(26)     NOT NULL PRIMARY KEY,
  business_id       CHAR(26)     NOT NULL,
  identifier_type   VARCHAR(40)  NOT NULL,
  value             VARCHAR(120) NOT NULL,
  issuing_authority VARCHAR(160) NULL,
  country_code      CHAR(2)      NOT NULL,
  status            VARCHAR(24)  NOT NULL DEFAULT 'self_declared',
  verified_at       DATETIME(3)  NULL,
  verification_note TEXT         NULL,
  created_at        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_ident_business (business_id),
  UNIQUE KEY uq_ident (identifier_type, country_code, value),
  CONSTRAINT fk_ident_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  CONSTRAINT chk_ident_status CHECK (status IN ('self_declared','document_supported','independently_verified','failed'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS business_representatives (
  id            CHAR(26)     NOT NULL PRIMARY KEY,
  business_id   CHAR(26)     NOT NULL,
  full_name     VARCHAR(255) NOT NULL,
  role_title    VARCHAR(120) NULL,
  email         VARCHAR(255) NULL,
  phone         VARCHAR(64)  NULL,
  id_type       VARCHAR(60)  NULL,
  id_last4      CHAR(4)      NULL,
  authorised    TINYINT(1)   NOT NULL DEFAULT 0,
  verified_at   DATETIME(3)  NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_reps_business (business_id),
  CONSTRAINT fk_reps_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Append-only: previous values are preserved for every material change.
CREATE TABLE IF NOT EXISTS business_history (
  id            CHAR(26)    NOT NULL PRIMARY KEY,
  business_id   CHAR(26)    NOT NULL,
  field_name    VARCHAR(80) NOT NULL,
  old_value     TEXT        NULL,
  new_value     TEXT        NULL,
  reason        VARCHAR(255) NULL,
  changed_by    CHAR(26)    NULL,
  changed_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_bhist_business (business_id, changed_at),
  CONSTRAINT fk_bhist_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS counterparties (
  id                      CHAR(26)     NOT NULL PRIMARY KEY,
  business_id             CHAR(26)     NOT NULL,
  counterparty_business_id CHAR(26)    NULL,
  name                    VARCHAR(255) NOT NULL,
  country_code            CHAR(2)      NULL,
  registration_number     VARCHAR(120) NULL,
  tax_id                  VARCHAR(120) NULL,
  email                   VARCHAR(255) NULL,
  relationship            VARCHAR(16)  NOT NULL,
  status                  VARCHAR(24)  NOT NULL DEFAULT 'unconfirmed',
  first_transaction_at    DATETIME(3)  NULL,
  last_transaction_at     DATETIME(3)  NULL,
  transaction_count       INT          NOT NULL DEFAULT 0,
  total_value             DECIMAL(20,4) NOT NULL DEFAULT 0,
  currency_code           CHAR(3)      NULL,
  confirmation_token_hash CHAR(64)     NULL,
  confirmation_sent_at    DATETIME(3)  NULL,
  confirmation_expires_at DATETIME(3)  NULL,
  confirmed_at            DATETIME(3)  NULL,
  confirmed_by_email      VARCHAR(255) NULL,
  conflict_note           TEXT         NULL,
  created_at              DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at              DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_cp_business (business_id, relationship),
  KEY idx_cp_linked (counterparty_business_id),
  CONSTRAINT fk_cp_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  CONSTRAINT fk_cp_linked FOREIGN KEY (counterparty_business_id) REFERENCES businesses(id) ON DELETE SET NULL,
  CONSTRAINT chk_cp_relationship CHECK (relationship IN ('customer','supplier','both')),
  CONSTRAINT chk_cp_status CHECK (status IN ('unconfirmed','confirmation_sent','confirmed','conflict','declined'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE access_grants
  ADD CONSTRAINT fk_grants_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
