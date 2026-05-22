-- Add line_account_id to staff_members for tenant-scoped API keys
-- This enables service-account API keys that are scoped to a specific LINE account

ALTER TABLE staff_members ADD COLUMN line_account_id TEXT REFERENCES line_accounts(id) DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_staff_members_line_account_id ON staff_members(line_account_id);
