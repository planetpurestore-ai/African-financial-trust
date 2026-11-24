-- 001: tenancy, identity, access control, country configuration
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS organisations (
  id              CHAR(26)     NOT NULL PRIMARY KEY,
  name            VARCHAR(255) NOT NULL,
  org_type        VARCHAR(24)  NOT NULL,
  country_code    CHAR(2)      NULL,
  status          VARCHAR(16)  NOT NULL DEFAULT 'active',
  created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT chk_org_type CHECK (org_type IN ('platform','institution','business')),
  CONSTRAINT chk_org_status CHECK (status IN ('active','suspended'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS users (
  id                CHAR(26)     NOT NULL PRIMARY KEY,
  org_id            CHAR(26)     NOT NULL,
  email             VARCHAR(255) NOT NULL,
  password_hash     VARCHAR(255) NOT NULL,
  full_name         VARCHAR(255) NOT NULL,
  role              VARCHAR(32)  NOT NULL,
  status            VARCHAR(16)  NOT NULL DEFAULT 'active',
  last_login_at     DATETIME(3)  NULL,
  failed_logins     INT          NOT NULL DEFAULT 0,
  locked_until      DATETIME(3)  NULL,
  created_at        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_users_email (email),
  KEY idx_users_org (org_id),
  CONSTRAINT fk_users_org FOREIGN KEY (org_id) REFERENCES organisations(id) ON DELETE RESTRICT,
  CONSTRAINT chk_user_role CHECK (role IN ('system_admin','institution_admin','institution_analyst','business_admin','business_user','auditor')),
  CONSTRAINT chk_user_status CHECK (status IN ('active','disabled','invited'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sessions (
  id            CHAR(26)    NOT NULL PRIMARY KEY,
  user_id       CHAR(26)    NOT NULL,
  token_hash    CHAR(64)    NOT NULL,
  expires_at    DATETIME(3) NOT NULL,
  revoked_at    DATETIME(3) NULL,
  ip            VARCHAR(64) NULL,
  user_agent    VARCHAR(512) NULL,
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_sessions_token (token_hash),
  KEY idx_sessions_user (user_id, expires_at),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- An institution may only read a business's record while this grant is active.
CREATE TABLE IF NOT EXISTS access_grants (
  id                  CHAR(26)    NOT NULL PRIMARY KEY,
  business_id         CHAR(26)    NOT NULL,
  institution_org_id  CHAR(26)    NOT NULL,
  scopes              JSON        NOT NULL,
  status              VARCHAR(16) NOT NULL DEFAULT 'active',
  granted_by_user_id  CHAR(26)    NULL,
  purpose             VARCHAR(255) NULL,
  expires_at          DATETIME(3) NULL,
  revoked_at          DATETIME(3) NULL,
  created_at          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_grants_business (business_id, status),
  KEY idx_grants_institution (institution_org_id, status),
  CONSTRAINT fk_grants_institution FOREIGN KEY (institution_org_id) REFERENCES organisations(id) ON DELETE CASCADE,
  CONSTRAINT chk_grant_status CHECK (status IN ('active','revoked','expired','pending'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS api_keys (
  id            CHAR(26)     NOT NULL PRIMARY KEY,
  org_id        CHAR(26)     NOT NULL,
  name          VARCHAR(120) NOT NULL,
  prefix        CHAR(12)     NOT NULL,
  key_hash      CHAR(64)     NOT NULL,
  role          VARCHAR(32)  NOT NULL,
  scopes        JSON         NOT NULL,
  status        VARCHAR(16)  NOT NULL DEFAULT 'active',
  last_used_at  DATETIME(3)  NULL,
  expires_at    DATETIME(3)  NULL,
  created_by    CHAR(26)     NULL,
  revoked_at    DATETIME(3)  NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_api_keys_prefix (prefix),
  KEY idx_api_keys_org (org_id, status),
  CONSTRAINT fk_api_keys_org FOREIGN KEY (org_id) REFERENCES organisations(id) ON DELETE CASCADE,
  CONSTRAINT chk_api_key_status CHECK (status IN ('active','revoked','expired'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Country behaviour is data, not code branches: identifier labels, currency, formats.
CREATE TABLE IF NOT EXISTS country_profiles (
  country_code            CHAR(2)      NOT NULL PRIMARY KEY,
  name                    VARCHAR(120) NOT NULL,
  currency_code           CHAR(3)      NOT NULL,
  registration_label      VARCHAR(80)  NOT NULL,
  registration_pattern    VARCHAR(255) NULL,
  tax_label               VARCHAR(80)  NOT NULL,
  tax_pattern             VARCHAR(255) NULL,
  date_format             VARCHAR(24)  NOT NULL DEFAULT 'DD/MM/YYYY',
  number_format           VARCHAR(24)  NOT NULL DEFAULT '1,234.56',
  mobile_money_providers  JSON         NOT NULL,
  registry_source         VARCHAR(255) NULL,
  registry_api_available  TINYINT(1)   NOT NULL DEFAULT 0,
  verification_notes      TEXT         NULL,
  active                  TINYINT(1)   NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS org_settings (
  org_id                    CHAR(26)    NOT NULL PRIMARY KEY,
  reconciliation_rules      JSON        NOT NULL,
  verification_policy       JSON        NOT NULL,
  retention_days            INT         NOT NULL DEFAULT 2555,
  updated_at                DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_settings_org FOREIGN KEY (org_id) REFERENCES organisations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
