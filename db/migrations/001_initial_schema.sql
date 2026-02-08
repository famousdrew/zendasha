-- Zendasha initial schema
-- No FK constraints: keeps sync ordering flexible and suits analytics workload.

-- Sync cursor tracking
CREATE TABLE IF NOT EXISTS sync_state (
  entity VARCHAR(50) PRIMARY KEY,
  last_synced_at BIGINT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Dimension tables

CREATE TABLE IF NOT EXISTS brands (
  id BIGINT PRIMARY KEY,
  name VARCHAR(255),
  subdomain VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS groups (
  id BIGINT PRIMARY KEY,
  name VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS agents (
  id BIGINT PRIMARY KEY,
  name VARCHAR(255),
  email VARCHAR(255),
  role VARCHAR(50),
  active BOOLEAN,
  default_group_id BIGINT
);

-- Core tables

CREATE TABLE IF NOT EXISTS tickets (
  id BIGINT PRIMARY KEY,
  brand_id BIGINT,
  status VARCHAR(20),
  priority VARCHAR(20),
  assignee_id BIGINT,
  group_id BIGINT,
  tags TEXT[],
  language_code VARCHAR(10),
  language_name VARCHAR(50),
  subject TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  solved_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS ticket_metrics (
  ticket_id BIGINT PRIMARY KEY,
  reply_time_calendar_minutes NUMERIC,
  reply_time_business_minutes NUMERIC,
  full_resolution_time_calendar_minutes NUMERIC,
  full_resolution_time_business_minutes NUMERIC,
  agent_wait_time_minutes NUMERIC,
  requester_wait_time_minutes NUMERIC,
  first_resolution_time_minutes NUMERIC,
  reopens INT,
  replies INT,
  sla_breach BOOLEAN,
  created_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS satisfaction_ratings (
  id BIGINT PRIMARY KEY,
  ticket_id BIGINT,
  score VARCHAR(20),
  comment TEXT,
  assignee_id BIGINT,
  group_id BIGINT,
  created_at TIMESTAMPTZ
);

-- Indexes for common query patterns

CREATE INDEX IF NOT EXISTS idx_tickets_brand_id ON tickets(brand_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_assignee_id ON tickets(assignee_id);
CREATE INDEX IF NOT EXISTS idx_tickets_group_id ON tickets(group_id);
CREATE INDEX IF NOT EXISTS idx_tickets_created_at ON tickets(created_at);
CREATE INDEX IF NOT EXISTS idx_tickets_updated_at ON tickets(updated_at);
CREATE INDEX IF NOT EXISTS idx_tickets_language_code ON tickets(language_code);

CREATE INDEX IF NOT EXISTS idx_satisfaction_ratings_ticket_id ON satisfaction_ratings(ticket_id);
CREATE INDEX IF NOT EXISTS idx_satisfaction_ratings_assignee_id ON satisfaction_ratings(assignee_id);
CREATE INDEX IF NOT EXISTS idx_satisfaction_ratings_created_at ON satisfaction_ratings(created_at);
