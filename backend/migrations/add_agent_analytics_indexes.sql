-- Migration: agent_analytics_indexes (Issue #947)
-- Adds compound indexes on contract_events to support fast per-agent
-- analytics queries (payout count, volume, fees, confirmation time).

-- Compound index on (actor, event_type, timestamp) — the primary query
-- pattern for the GET /api/agents/:id/analytics endpoint which filters
-- by actor and event type over a rolling date range.
CREATE INDEX IF NOT EXISTS idx_ce_actor_event_ts
  ON contract_events (actor, event_type, timestamp DESC);

-- Partial index covering only completed payout events so the time-series
-- aggregation query (GROUP BY day/week/month) stays narrow.
CREATE INDEX IF NOT EXISTS idx_ce_actor_completed_ts
  ON contract_events (actor, timestamp DESC)
  WHERE event_type = 'remittance_completed';
