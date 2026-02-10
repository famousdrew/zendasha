ALTER TABLE tickets ADD COLUMN IF NOT EXISTS first_pending_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_tickets_first_pending_at ON tickets(first_pending_at);
