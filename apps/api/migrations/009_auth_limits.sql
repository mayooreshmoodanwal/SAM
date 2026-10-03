CREATE TABLE auth_login_attempts (
  key_hash text PRIMARY KEY,
  failures integer NOT NULL DEFAULT 0,
  reset_at timestamptz NOT NULL
);
CREATE INDEX auth_login_attempts_reset_idx ON auth_login_attempts(reset_at);
CREATE INDEX sessions_expires_idx ON sessions(expires_at);
