-- 007: durable, content-addressed document storage.
--
-- Published containers have ephemeral filesystems. Source evidence must survive
-- a restart, so file bytes are stored in the database keyed by their SHA-256
-- digest. Duplicate uploads share one blob and still retain their own document
-- row, audit trail and provenance.

CREATE TABLE IF NOT EXISTS document_blobs (
  sha256       CHAR(64)    NOT NULL PRIMARY KEY,
  bytes        LONGBLOB    NOT NULL,
  size_bytes   BIGINT      NOT NULL,
  created_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
