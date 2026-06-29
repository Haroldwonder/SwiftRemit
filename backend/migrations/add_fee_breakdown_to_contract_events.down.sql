-- Rollback: remove fee breakdown columns from contract_events (#844)

ALTER TABLE contract_events
  DROP COLUMN IF EXISTS platform_fee,
  DROP COLUMN IF EXISTS protocol_fee,
  DROP COLUMN IF EXISTS net_amount;
