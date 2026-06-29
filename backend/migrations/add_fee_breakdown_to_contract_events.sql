-- Migration: add fee breakdown columns to contract_events (#844)
-- Adds platform_fee, protocol_fee, and net_amount so analytics can query
-- the full fee split without re-deriving it from on-chain config.

ALTER TABLE contract_events
  ADD COLUMN IF NOT EXISTS platform_fee NUMERIC(30, 7),
  ADD COLUMN IF NOT EXISTS protocol_fee NUMERIC(30, 7),
  ADD COLUMN IF NOT EXISTS net_amount   NUMERIC(30, 7);
