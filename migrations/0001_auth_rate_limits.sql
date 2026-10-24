CREATE TABLE IF NOT EXISTS auth_rate_limits (
  key TEXT PRIMARY KEY,
  bucket INTEGER NOT NULL,
  attempts INTEGER NOT NULL CHECK (attempts > 0)
);
CREATE INDEX IF NOT EXISTS auth_rate_limits_bucket ON auth_rate_limits(bucket);
