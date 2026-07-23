-- Rollback: agent_analytics_indexes (Issue #947)
DROP INDEX IF EXISTS idx_ce_actor_completed_ts;
DROP INDEX IF EXISTS idx_ce_actor_event_ts;
