-- Webhook System Monitoring Queries
-- Use these queries to monitor webhook health and detect issues

-- ============================================
-- HEALTH METRICS
-- ============================================

-- Overall webhook success rate (last 24 hours)
SELECT 
  COUNT(*) as total_webhooks,
  SUM(CASE WHEN verified = true THEN 1 ELSE 0 END) as verified,
  SUM(CASE WHEN verified = false THEN 1 ELSE 0 END) as failed,
  ROUND(100.0 * SUM(CASE WHEN verified = true THEN 1 ELSE 0 END) / COUNT(*), 2) as success_rate_pct
FROM webhook_logs
WHERE received_at > NOW() - INTERVAL '24 hours';

-- Average processing time by event type
SELECT 
  event_type,
  COUNT(*) as count,
  ROUND(AVG(processing_time_ms), 2) as avg_ms,
  MAX(processing_time_ms) as max_ms,
  MIN(processing_time_ms) as min_ms
FROM webhook_logs
WHERE received_at > NOW() - INTERVAL '24 hours'
  AND processing_time_ms IS NOT NULL
GROUP BY event_type
ORDER BY avg_ms DESC;

-- Webhook volume by hour
SELECT 
  DATE_TRUNC('hour', received_at) as hour,
  COUNT(*) as webhook_count,
  SUM(CASE WHEN verified = true THEN 1 ELSE 0 END) as verified_count
FROM webhook_logs
WHERE received_at > NOW() - INTERVAL '24 hours'
GROUP BY hour
ORDER BY hour DESC;

-- ============================================
-- ANCHOR PERFORMANCE
-- ============================================

-- Per-anchor success rates
SELECT 
  anchor_id,
  COUNT(*) as total,
  SUM(CASE WHEN verified = true THEN 1 ELSE 0 END) as verified,
  ROUND(100.0 * SUM(CASE WHEN verified = true THEN 1 ELSE 0 END) / COUNT(*), 2) as success_rate_pct
FROM webhook_logs
WHERE received_at > NOW() - INTERVAL '24 hours'
GROUP BY anchor_id
ORDER BY success_rate_pct ASC;

-- Anchors with high failure rates (>10%)
SELECT 
  anchor_id,
  COUNT(*) as total,
  SUM(CASE WHEN verified = false THEN 1 ELSE 0 END) as failed,
  ROUND(100.0 * SUM(CASE WHEN verified = false THEN 1 ELSE 0 END) / COUNT(*), 2) as failure_rate_pct
FROM webhook_logs
WHERE received_at > NOW() - INTERVAL '24 hours'
GROUP BY anchor_id
HAVING SUM(CASE WHEN verified = false THEN 1 ELSE 0 END) > 0
  AND 100.0 * SUM(CASE WHEN verified = false THEN 1 ELSE 0 END) / COUNT(*) > 10
ORDER BY failure_rate_pct DESC;

-- ============================================
-- SUSPICIOUS ACTIVITY
-- ============================================

-- Recent suspicious activity (uninvestigated)
SELECT 
  sw.id,
  sw.anchor_id,
  sw.reason,
  sw.detected_at,
  a.name as anchor_name
FROM suspicious_webhooks sw
LEFT JOIN anchors a ON sw.anchor_id = a.id
WHERE sw.investigated = false
ORDER BY sw.detected_at DESC
LIMIT 50;

-- Suspicious activity summary by reason
SELECT 
  reason,
  COUNT(*) as count,
  COUNT(DISTINCT anchor_id) as affected_anchors
FROM suspicious_webhooks
WHERE detected_at > NOW() - INTERVAL '7 days'
GROUP BY reason
ORDER BY count DESC;

-- Anchors with most suspicious activity
SELECT 
  anchor_id,
  COUNT(*) as suspicious_count,
  MAX(detected_at) as last_incident
FROM suspicious_webhooks
WHERE detected_at > NOW() - INTERVAL '7 days'
GROUP BY anchor_id
ORDER BY suspicious_count DESC
LIMIT 20;

-- ============================================
-- TRANSACTION STATE TRACKING
-- ============================================

-- Transaction state distribution
SELECT 
  status,
  kind,
  COUNT(*) as count
FROM transactions
GROUP BY status, kind
ORDER BY kind, count DESC;

-- Recent state transitions
SELECT 
  tsh.transaction_id,
  t.kind,
  tsh.from_status,
  tsh.to_status,
  tsh.changed_at,
  t.anchor_id
FROM transaction_state_history tsh
JOIN transactions t ON tsh.transaction_id = t.transaction_id
WHERE tsh.changed_at > NOW() - INTERVAL '1 hour'
ORDER BY tsh.changed_at DESC
LIMIT 100;

-- Stuck transactions (no state change in 24 hours)
SELECT 
  t.transaction_id,
  t.anchor_id,
  t.kind,
  t.status,
  t.updated_at,
  EXTRACT(EPOCH FROM (NOW() - t.updated_at))/3600 as hours_stuck
FROM transactions t
WHERE t.status NOT IN ('completed', 'refunded', 'error', 'expired')
  AND t.updated_at < NOW() - INTERVAL '24 hours'
ORDER BY t.updated_at ASC;

-- ============================================
-- ERROR ANALYSIS
-- ============================================

-- Recent failed webhooks with details
SELECT 
  wl.id,
  wl.anchor_id,
  wl.transaction_id,
  wl.event_type,
  wl.received_at,
  wl.payload->>'status' as attempted_status,
  wl.payload->>'message' as message
FROM webhook_logs wl
WHERE wl.verified = false
  AND wl.received_at > NOW() - INTERVAL '24 hours'
ORDER BY wl.received_at DESC
LIMIT 50;

-- Failed verification patterns
SELECT 
  DATE_TRUNC('hour', received_at) as hour,
  anchor_id,
  COUNT(*) as failed_count
FROM webhook_logs
WHERE verified = false
  AND received_at > NOW() - INTERVAL '24 hours'
GROUP BY hour, anchor_id
HAVING COUNT(*) > 5
ORDER BY hour DESC, failed_count DESC;

-- ============================================
-- PERFORMANCE MONITORING
-- ============================================

-- Slow webhooks (>500ms processing time)
SELECT 
  id,
  anchor_id,
  transaction_id,
  event_type,
  processing_time_ms,
  received_at
FROM webhook_logs
WHERE processing_time_ms > 500
  AND received_at > NOW() - INTERVAL '24 hours'
ORDER BY processing_time_ms DESC
LIMIT 50;

-- Processing time percentiles
SELECT 
  PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY processing_time_ms) as p50_ms,
  PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY processing_time_ms) as p90_ms,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY processing_time_ms) as p95_ms,
  PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY processing_time_ms) as p99_ms
FROM webhook_logs
WHERE received_at > NOW() - INTERVAL '24 hours'
  AND processing_time_ms IS NOT NULL;

-- ============================================
-- CLEANUP & MAINTENANCE
-- ============================================

-- Old webhook logs (for archival consideration)
SELECT 
  DATE_TRUNC('day', received_at) as day,
  COUNT(*) as count,
  pg_size_pretty(SUM(pg_column_size(payload))) as payload_size
FROM webhook_logs
WHERE received_at < NOW() - INTERVAL '90 days'
GROUP BY day
ORDER BY day;

-- Database table sizes
SELECT 
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('webhook_logs', 'suspicious_webhooks', 'transactions', 'transaction_state_history')
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
