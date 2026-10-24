CREATE TABLE IF NOT EXISTS auth_sessions (
  id TEXT PRIMARY KEY,
  expires INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_sessions_expires ON auth_sessions(expires);
