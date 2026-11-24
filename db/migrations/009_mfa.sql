-- 009: TOTP multi-factor authentication and one-time login challenges
CREATE TABLE IF NOT EXISTS user_mfa (
  user_id               CHAR(26)     NOT NULL PRIMARY KEY,
  secret_ciphertext     TEXT         NOT NULL,
  secret_iv             VARCHAR(64)  NOT NULL,
  secret_auth_tag       VARCHAR(64)  NOT NULL,
  recovery_code_hashes  JSON         NOT NULL,
  enabled_at            DATETIME(3)  NULL,
  created_at            DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at            DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_user_mfa_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mfa_challenges (
  id             CHAR(26)     NOT NULL PRIMARY KEY,
  user_id        CHAR(26)     NOT NULL,
  token_hash     CHAR(64)     NOT NULL,
  expires_at     DATETIME(3)  NOT NULL,
  attempts       INT          NOT NULL DEFAULT 0,
  used_at        DATETIME(3)  NULL,
  ip             VARCHAR(64)  NULL,
  user_agent     VARCHAR(512) NULL,
  created_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_mfa_challenge_token (token_hash),
  KEY idx_mfa_challenge_user (user_id, created_at),
  KEY idx_mfa_challenge_expiry (expires_at, used_at),
  CONSTRAINT fk_mfa_challenge_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
