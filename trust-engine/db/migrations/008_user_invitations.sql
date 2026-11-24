-- 008: secure user invitations and one-time password activation
CREATE TABLE IF NOT EXISTS user_invitations (
  id                  CHAR(26)     NOT NULL PRIMARY KEY,
  user_id             CHAR(26)     NOT NULL,
  email               VARCHAR(255) NOT NULL,
  token_hash          CHAR(64)     NOT NULL,
  expires_at          DATETIME(3) NOT NULL,
  used_at             DATETIME(3) NULL,
  created_by_user_id  CHAR(26)     NULL,
  created_at          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_user_invitation_token (token_hash),
  KEY idx_user_invitation_user (user_id, used_at),
  KEY idx_user_invitation_expiry (expires_at, used_at),
  CONSTRAINT fk_user_invitation_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_user_invitation_creator FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
