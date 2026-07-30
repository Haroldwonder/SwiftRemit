import { Pool } from 'pg';
import { createLogger } from './correlation-id';
import { FxRateCache } from './fx-rate-cache';

export class MetricsService {
  private pool: Pool;
  private logger = createLogger('MetricsService');
  private fxRateCache?: FxRateCache;

  // Metrics storage
  private metrics = {
    swiftremit_settlements_total: {} as Record<string, number>,
    swiftremit_webhook_deliveries_total: {} as Record<string, number>,
    swiftremit_active_remittances: 0,
    swiftremit_accumulated_fees: 0,
    swiftremit_webhook_dead_letter_count: 0,
    swiftremit_kyc_poll_runs_total: 0,
    swiftremit_kyc_poll_failures_total: 0,
    kyc_poller_last_run_timestamp_seconds: 0,
    contract_event_indexer_lag_ledgers: 0,
    swiftremit_rate_limit_exceeded_total: {} as Record<string, number>,
    swiftremit_fx_rate_staleness_seconds: {} as Record<string, number>,
    db_pool_active_connections: 0,
    db_pool_idle_connections: 0,
    db_pool_waiting_connections: 0,
    // Money-at-risk signals (SR-104)
    swiftremit_contract_paused: 0,
    swiftremit_oldest_pending_remittance_age_seconds: 0,
    swiftremit_settlement_seconds_p95: 0,
    swiftremit_failed_migrations: 0,
    swiftremit_migration_last_applied_timestamp_seconds: 0,
  };

  // Provider circuit-breaker state, 1 = open (SR-104)
  private circuitOpen: Map<string, number> = new Map();

  // HTTP request instrumentation (SR-104 — API availability and latency SLOs)
  private httpRequestsTotal: Map<string, number> = new Map();
  private httpRequestDurationBuckets: Map<string, number[]> = new Map();
  private httpRequestDurationSum: Map<string, number> = new Map();
  private httpRequestDurationCount: Map<string, number> = new Map();

  /** Upper bounds, in seconds, of the request-duration histogram. */
  static readonly HTTP_DURATION_BUCKETS = [
    0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
  ];

  // Anchor availability metrics
  private anchorAvailability: Map<string, string> = new Map();

  // FX rate staleness metrics
  private fxRateAgeSeconds: Map<string, number> = new Map();
  private fxCacheHitsTotal = 0;
  private fxCacheMissesTotal = 0;

  // Job monitoring metrics (#866)
  private jobLastRunTimestamp: Map<string, number> = new Map();
  private jobFailureTotal: Map<string, number> = new Map();

  // FX provider resilience metrics (SR-029)
  private fxProviderFailuresTotal: Map<string, number> = new Map();
  private fxProviderFailoversTotal = 0;
  private fxRateRejectedTotal: Map<string, number> = new Map();

  constructor(pool: Pool, fxRateCache?: FxRateCache) {
    this.pool = pool;
    this.fxRateCache = fxRateCache;
  }

  /** Record current availability status for an anchor. */
  recordAnchorAvailability(anchorId: string, status: string): void {
    this.anchorAvailability.set(anchorId, status);
  }

  /** Record a cache hit for a currency pair. */
  recordFxCacheHit(from: string, to: string): void {
    this.fxCacheHitsTotal++;
    // Age is 0 when served from live cache (fresh)
    const key = `${from.toUpperCase()}_${to.toUpperCase()}`;
    this.fxRateAgeSeconds.set(key, 0);
  }

  /** Record a cache miss and the age of the rate that was fetched. */
  recordFxCacheMiss(from: string, to: string, rateTimestamp: Date): void {
    this.fxCacheMissesTotal++;
    const ageSeconds = (Date.now() - rateTimestamp.getTime()) / 1000;
    const key = `${from.toUpperCase()}_${to.toUpperCase()}`;
    this.fxRateAgeSeconds.set(key, ageSeconds);
  }

  /** Update the recorded age for a currency pair (call after each successful fetch). */
  updateFxRateAge(from: string, to: string, rateTimestamp: Date): void {
    const ageSeconds = (Date.now() - rateTimestamp.getTime()) / 1000;
    const key = `${from.toUpperCase()}_${to.toUpperCase()}`;
    this.fxRateAgeSeconds.set(key, ageSeconds);
  }

  /**
   * Update settlement metrics
   */
  async updateSettlementMetrics(): Promise<void> {
    try {
      const result = await this.pool.query(
        `SELECT status, COUNT(*) as count 
         FROM transactions 
         WHERE kind = 'withdrawal' 
         GROUP BY status`
      );

      this.metrics.swiftremit_settlements_total = {};
      result.rows.forEach(row => {
        this.metrics.swiftremit_settlements_total[row.status] = parseInt(row.count);
      });

      this.logger.debug('Settlement metrics updated', {
        metrics: this.metrics.swiftremit_settlements_total,
      });
    } catch (error) {
      this.logger.error('Failed to update settlement metrics', error);
    }
  }

  /**
   * Update webhook delivery metrics
   */
  async updateWebhookDeliveryMetrics(): Promise<void> {
    try {
      const result = await this.pool.query(
        `SELECT status, COUNT(*) as count 
         FROM webhook_deliveries 
         GROUP BY status`
      );

      this.metrics.swiftremit_webhook_deliveries_total = {};
      result.rows.forEach(row => {
        this.metrics.swiftremit_webhook_deliveries_total[row.status] = parseInt(row.count);
      });

      this.logger.debug('Webhook delivery metrics updated', {
        metrics: this.metrics.swiftremit_webhook_deliveries_total,
      });
    } catch (error) {
      this.logger.error('Failed to update webhook delivery metrics', error);
    }
  }

  /**
   * Update active remittances gauge
   */
  async updateActiveRemittances(): Promise<void> {
    try {
      const result = await this.pool.query(
        `SELECT COUNT(*) as count 
         FROM transactions 
         WHERE status IN ('pending', 'processing', 'submitted')`
      );

      this.metrics.swiftremit_active_remittances = parseInt(result.rows[0].count);

      this.logger.debug('Active remittances updated', {
        count: this.metrics.swiftremit_active_remittances,
      });
    } catch (error) {
      this.logger.error('Failed to update active remittances', error);
    }
  }

/**
    * Update accumulated fees gauge
    */
  async updateAccumulatedFees(): Promise<void> {
    try {
      const result = await this.pool.query(
        `SELECT COALESCE(SUM(amount_fee), 0) as total_fees 
         FROM transactions 
         WHERE status = 'completed'`
      );

      this.metrics.swiftremit_accumulated_fees = parseFloat(result.rows[0].total_fees);

      this.logger.debug('Accumulated fees updated', {
        fees: this.metrics.swiftremit_accumulated_fees,
      });
    } catch (error) {
      this.logger.error('Failed to update accumulated fees', error);
    }
  }

  setFxRateStalenessMetric(from: string, to: string, stalenessSeconds: number): void {
    const pairKey = `${from.toUpperCase()}/${to.toUpperCase()}`;
    this.metrics.swiftremit_fx_rate_staleness_seconds[pairKey] = stalenessSeconds;
  }

  /**
   * Update dead-letter queue count from the database
   */
  async updateDeadLetterCount(): Promise<void> {
    try {
      const result = await this.pool.query(
        `SELECT COUNT(*) as count FROM webhook_dead_letters WHERE replayed_at IS NULL`
      );

      this.metrics.swiftremit_webhook_dead_letter_count = parseInt(result.rows[0].count);

      this.logger.debug('Dead-letter count updated', {
        count: this.metrics.swiftremit_webhook_dead_letter_count,
      });
    } catch (error) {
      this.logger.error('Failed to update dead-letter count', error);
    }
  }

  /** Increment rate-limit-exceeded counter for a given path. */
  incrementRateLimitExceeded(path: string): void {
    const key = path || 'unknown';
    this.metrics.swiftremit_rate_limit_exceeded_total[key] =
      (this.metrics.swiftremit_rate_limit_exceeded_total[key] ?? 0) + 1;
  }

  /**
   * Increment dead-letter counter (called by dispatcher on each DLQ insertion)
   */
  incrementDeadLetterCount(): void {
    this.metrics.swiftremit_webhook_dead_letter_count++;
  }

  /**
   * Update per-subscription DLQ depth gauge (SR-027).
   * Queries webhook_dead_letters grouped by subscription_id for entries that
   * have not been replayed or expired yet.
   * Also records the oldest unresolved entry timestamp per subscription for
   * the stale-entries alert.
   */
  async updateDlqDepthPerSubscription(): Promise<void> {
    try {
      const result = await this.pool.query(
        `SELECT COALESCE(subscription_id::text, webhook_id::text) AS sub_id,
                COUNT(*) AS depth,
                EXTRACT(EPOCH FROM MIN(created_at))::bigint AS oldest_ts
         FROM webhook_dead_letters
         WHERE replayed_at IS NULL
           AND expired_at IS NULL
         GROUP BY sub_id`
      );

      this.dlqDepthPerSubscription.clear();
      this.dlqOldestEntryTimestamp.clear();
      for (const row of result.rows) {
        this.dlqDepthPerSubscription.set(row.sub_id, parseInt(row.depth, 10));
        this.dlqOldestEntryTimestamp.set(row.sub_id, parseInt(row.oldest_ts, 10));
      }

      this.logger.debug('DLQ depth per subscription updated', {
        subscriptions: this.dlqDepthPerSubscription.size,
      });
    } catch (error) {
      this.logger.error('Failed to update DLQ depth per subscription', error);
    }
  }

  /**
   * Record that the KYC poller completed a run (call at the end of each poll cycle).
   */
  recordKycPollerRun(): void {
    this.metrics.kyc_poller_last_run_timestamp_seconds = Math.floor(Date.now() / 1000);
    this.metrics.swiftremit_kyc_poll_runs_total += 1;
  }

  /**
   * Record a KYC poll failure.
   */
  recordKycPollFailure(): void {
    this.metrics.swiftremit_kyc_poll_failures_total += 1;
  }

  /** Record a successful job run (updates last-run timestamp). */
  recordJobRun(jobName: string): void {
    this.jobLastRunTimestamp.set(jobName, Math.floor(Date.now() / 1000));
  }

  /** Record a job failure (increments failure counter). */
  recordJobFailure(jobName: string): void {
    this.jobFailureTotal.set(jobName, (this.jobFailureTotal.get(jobName) ?? 0) + 1);
  }

  /** Record an FX provider call failure (e.g. timeout, 5xx, malformed response). */
  recordFxProviderFailure(provider: string): void {
    this.fxProviderFailuresTotal.set(provider, (this.fxProviderFailuresTotal.get(provider) ?? 0) + 1);
  }

  /** Record a failover from the primary to the secondary FX provider. */
  recordFxProviderFailover(): void {
    this.fxProviderFailoversTotal += 1;
  }

  /** Record a rejected FX rate (stale-beyond-threshold or failed sanity check). */
  recordFxRateRejected(reason: 'stale' | 'sanity'): void {
    this.fxRateRejectedTotal.set(reason, (this.fxRateRejectedTotal.get(reason) ?? 0) + 1);
  }

  /**
   * Update the contract event indexer lag (ledgers behind the chain tip).
   * Call this from the Stellar event listener after each poll.
   */
  updateContractEventIndexerLag(lagLedgers: number): void {
    this.metrics.contract_event_indexer_lag_ledgers = lagLedgers;
  }

  // ── Money-at-risk signals (SR-104) ───────────────────────────────────────

  /**
   * Record whether the on-chain contract is paused. While paused no remittance
   * can settle, so this is a page-worthy condition.
   */
  setContractPaused(paused: boolean): void {
    this.metrics.swiftremit_contract_paused = paused ? 1 : 0;
  }

  /**
   * Derive the contract pause state from the indexed circuit-breaker events.
   * The contract emits ("cb", "paused") / ("cb", "unpaused"); the most recent of
   * the two wins. No events at all means the contract has never been paused.
   */
  async updateContractPauseState(): Promise<void> {
    try {
      const result = await this.pool.query(
        `SELECT event_type
           FROM contract_events
          WHERE event_type IN ('paused', 'unpaused', 'cb_paused', 'cb_unpaused')
          ORDER BY ledger_sequence DESC NULLS LAST, timestamp DESC
          LIMIT 1`
      );

      const latest: string | undefined = result.rows[0]?.event_type;
      this.setContractPaused(latest === 'paused' || latest === 'cb_paused');
    } catch (error) {
      this.logger.error('Failed to update contract pause state', error);
    }
  }

  /** Record a provider circuit-breaker transition. `open` = calls are shed. */
  setCircuitOpen(provider: string, open: boolean): void {
    this.circuitOpen.set(provider, open ? 1 : 0);
  }

  /**
   * Record one served HTTP request. Feeds the availability and latency SLIs.
   * `route` should be the Express route pattern, not the concrete path, so the
   * label cardinality stays bounded.
   */
  recordHttpRequest(method: string, route: string, statusCode: number, durationSeconds: number): void {
    const key = `${method.toUpperCase()}|${route}|${statusCode}`;
    this.httpRequestsTotal.set(key, (this.httpRequestsTotal.get(key) ?? 0) + 1);

    const durationKey = `${method.toUpperCase()}|${route}`;
    const buckets =
      this.httpRequestDurationBuckets.get(durationKey) ??
      new Array(MetricsService.HTTP_DURATION_BUCKETS.length).fill(0);

    MetricsService.HTTP_DURATION_BUCKETS.forEach((bound, index) => {
      if (durationSeconds <= bound) buckets[index] += 1;
    });

    this.httpRequestDurationBuckets.set(durationKey, buckets);
    this.httpRequestDurationSum.set(
      durationKey,
      (this.httpRequestDurationSum.get(durationKey) ?? 0) + durationSeconds,
    );
    this.httpRequestDurationCount.set(
      durationKey,
      (this.httpRequestDurationCount.get(durationKey) ?? 0) + 1,
    );
  }

  /**
   * Age of the oldest remittance that has not reached a terminal state. This is
   * the single clearest "money is stuck" signal the platform has.
   */
  async updateOldestPendingRemittanceAge(): Promise<void> {
    try {
      const result = await this.pool.query(
        `SELECT COALESCE(EXTRACT(EPOCH FROM (NOW() - MIN(created_at))), 0) AS age_seconds
           FROM transactions
          WHERE status NOT IN ('completed', 'refunded', 'error', 'expired')`
      );

      this.metrics.swiftremit_oldest_pending_remittance_age_seconds = parseFloat(
        result.rows[0].age_seconds,
      );
    } catch (error) {
      this.logger.error('Failed to update oldest pending remittance age', error);
    }
  }

  /**
   * 95th percentile settlement time over the last hour, in seconds. Backs the
   * remittance settlement-time SLO.
   */
  async updateSettlementDurationP95(): Promise<void> {
    try {
      const result = await this.pool.query(
        `SELECT COALESCE(
                  PERCENTILE_CONT(0.95) WITHIN GROUP (
                    ORDER BY EXTRACT(EPOCH FROM (updated_at - created_at))
                  ),
                  0
                ) AS p95
           FROM transactions
          WHERE status = 'completed'
            AND updated_at > NOW() - INTERVAL '1 hour'`
      );

      this.metrics.swiftremit_settlement_seconds_p95 = parseFloat(result.rows[0].p95);
    } catch (error) {
      this.logger.error('Failed to update settlement duration p95', error);
    }
  }

  /**
   * Migration health, read from schema_migrations so it survives a restart —
   * a migration that failed and killed the process still shows up here.
   */
  async updateMigrationStatus(): Promise<void> {
    try {
      const result = await this.pool.query(
        `SELECT COUNT(*) FILTER (WHERE failed) AS failed_count,
                COALESCE(EXTRACT(EPOCH FROM MAX(applied_at)), 0) AS last_applied
           FROM schema_migrations`
      );

      this.metrics.swiftremit_failed_migrations = parseInt(result.rows[0].failed_count, 10);
      this.metrics.swiftremit_migration_last_applied_timestamp_seconds = parseFloat(
        result.rows[0].last_applied,
      );
    } catch (error) {
      this.logger.error('Failed to update migration status', error);
    }
  }

/**
    * Update all metrics
    */
  async updateAllMetrics(): Promise<void> {
    const p = this.pool as any;
    this.metrics.db_pool_idle_connections = p.idleCount ?? 0;
    this.metrics.db_pool_waiting_connections = p.waitingCount ?? 0;
    this.metrics.db_pool_active_connections = (p.totalCount ?? 0) - (p.idleCount ?? 0);

    await Promise.all([
      this.updateSettlementMetrics(),
      this.updateWebhookDeliveryMetrics(),
      this.updateActiveRemittances(),
      this.updateAccumulatedFees(),
      this.updateDeadLetterCount(),
      this.updateOldestPendingRemittanceAge(),
      this.updateSettlementDurationP95(),
      this.updateMigrationStatus(),
      this.updateContractPauseState(),
    ]);
  }

  /**
   * Sanitize a Prometheus label value by escaping backslashes, double quotes,
   * and newlines to prevent label injection or broken text format output.
   */
  private sanitizeLabelValue(value: string): string {
    return value
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n');
  }

  /**
   * Generate Prometheus text format output
   */
  generatePrometheusText(): string {
    const lines: string[] = [];

    // Settlements counter
    lines.push('# HELP swiftremit_settlements_total Total number of settlements by status');
    lines.push('# TYPE swiftremit_settlements_total counter');
    Object.entries(this.metrics.swiftremit_settlements_total).forEach(([status, count]) => {
      lines.push(`swiftremit_settlements_total{status="${this.sanitizeLabelValue(status)}"} ${count}`);
    });

    // Webhook deliveries counter
    lines.push('# HELP swiftremit_webhook_deliveries_total Total number of webhook deliveries by result');
    lines.push('# TYPE swiftremit_webhook_deliveries_total counter');
    Object.entries(this.metrics.swiftremit_webhook_deliveries_total).forEach(([result, count]) => {
      lines.push(`swiftremit_webhook_deliveries_total{result="${this.sanitizeLabelValue(result)}"} ${count}`);
    });

    // Active remittances gauge
    lines.push('# HELP swiftremit_active_remittances Number of active remittances');
    lines.push('# TYPE swiftremit_active_remittances gauge');
    lines.push(`swiftremit_active_remittances ${this.metrics.swiftremit_active_remittances}`);

    // Accumulated fees gauge
    lines.push('# HELP swiftremit_accumulated_fees Total accumulated fees from completed transactions');
    lines.push('# TYPE swiftremit_accumulated_fees gauge');
    lines.push(`swiftremit_accumulated_fees ${this.metrics.swiftremit_accumulated_fees}`);

    // Anchor availability gauge
    lines.push('# HELP swiftremit_anchor_availability Current availability status of each anchor');
    lines.push('# TYPE swiftremit_anchor_availability gauge');
    this.anchorAvailability.forEach((status, anchorId) => {
      lines.push(`swiftremit_anchor_availability{anchor_id="${this.sanitizeLabelValue(anchorId)}",status="${this.sanitizeLabelValue(status)}"} 1`);
    });

    // FX rate age gauge (per currency pair)
    lines.push('# HELP fx_rate_age_seconds Age of the cached FX rate in seconds');
    lines.push('# TYPE fx_rate_age_seconds gauge');
    this.fxRateAgeSeconds.forEach((ageSeconds, key) => {
      const [from, to] = key.split('_');
      lines.push(`fx_rate_age_seconds{from="${from}",to="${to}"} ${ageSeconds.toFixed(3)}`);
    });

    // FX cache hit counter
    lines.push('# HELP fx_rate_cache_hits_total Total number of FX rate cache hits');
    lines.push('# TYPE fx_rate_cache_hits_total counter');
    lines.push(`fx_rate_cache_hits_total ${this.fxCacheHitsTotal}`);

    // FX cache miss counter
    lines.push('# HELP fx_rate_cache_misses_total Total number of FX rate cache misses');
    lines.push('# TYPE fx_rate_cache_misses_total counter');
    lines.push(`fx_rate_cache_misses_total ${this.fxCacheMissesTotal}`);

    // DB pool connection gauges
    lines.push('# HELP db_pool_active_connections Number of active (checked-out) connections in the PostgreSQL pool');
    lines.push('# TYPE db_pool_active_connections gauge');
    lines.push(`db_pool_active_connections ${this.metrics.db_pool_active_connections}`);

    lines.push('# HELP db_pool_idle_connections Number of idle connections in the PostgreSQL pool');
    lines.push('# TYPE db_pool_idle_connections gauge');
    lines.push(`db_pool_idle_connections ${this.metrics.db_pool_idle_connections}`);

    lines.push('# HELP db_pool_waiting_connections Number of requests waiting for a connection from the PostgreSQL pool');
    lines.push('# TYPE db_pool_waiting_connections gauge');
    lines.push(`db_pool_waiting_connections ${this.metrics.db_pool_waiting_connections}`);

    // KYC poller last run timestamp
    lines.push('# HELP kyc_poller_last_run_timestamp_seconds Unix timestamp of the last successful KYC poller run');
    lines.push('# TYPE kyc_poller_last_run_timestamp_seconds gauge');
    lines.push(`kyc_poller_last_run_timestamp_seconds ${this.metrics.kyc_poller_last_run_timestamp_seconds}`);

    // KYC poller counters
    lines.push('# HELP swiftremit_kyc_poll_runs_total Total number of KYC poll cycles executed');
    lines.push('# TYPE swiftremit_kyc_poll_runs_total counter');
    lines.push(`swiftremit_kyc_poll_runs_total ${this.metrics.swiftremit_kyc_poll_runs_total}`);
    lines.push('# HELP swiftremit_kyc_poll_failures_total Total number of KYC poll failures');
    lines.push('# TYPE swiftremit_kyc_poll_failures_total counter');
    lines.push(`swiftremit_kyc_poll_failures_total ${this.metrics.swiftremit_kyc_poll_failures_total}`);

    // Contract event indexer lag
    lines.push('# HELP contract_event_indexer_lag_ledgers Number of ledgers the event indexer is behind the chain tip');
    lines.push('# TYPE contract_event_indexer_lag_ledgers gauge');
    lines.push(`contract_event_indexer_lag_ledgers ${this.metrics.contract_event_indexer_lag_ledgers}`);

    // Dead-letter queue count
    lines.push('# HELP swiftremit_webhook_dead_letter_count Total number of webhook deliveries in the dead-letter queue');
    lines.push('# TYPE swiftremit_webhook_dead_letter_count gauge');
    lines.push(`swiftremit_webhook_dead_letter_count ${this.metrics.swiftremit_webhook_dead_letter_count}`);

    // Per-subscription DLQ depth gauge (SR-027)
    lines.push('# HELP swiftremit_webhook_dlq_depth Number of pending dead-letter entries per webhook subscription');
    lines.push('# TYPE swiftremit_webhook_dlq_depth gauge');
    this.dlqDepthPerSubscription.forEach((depth, subscriptionId) => {
      lines.push(`swiftremit_webhook_dlq_depth{subscription_id="${this.sanitizeLabelValue(subscriptionId)}"} ${depth}`);
    });

    // Per-subscription oldest unresolved DLQ entry timestamp (SR-027)
    // Used by stale-entry alerts: (time() - metric) > threshold
    lines.push('# HELP swiftremit_webhook_dlq_oldest_entry_timestamp_seconds Unix timestamp of the oldest unresolved DLQ entry per subscription');
    lines.push('# TYPE swiftremit_webhook_dlq_oldest_entry_timestamp_seconds gauge');
    this.dlqOldestEntryTimestamp.forEach((ts, subscriptionId) => {
      lines.push(`swiftremit_webhook_dlq_oldest_entry_timestamp_seconds{subscription_id="${this.sanitizeLabelValue(subscriptionId)}"} ${ts}`);
    });

    // Rate limit exceeded counter
    lines.push('# HELP swiftremit_rate_limit_exceeded_total Total number of rate limit exceeded events by path');
    lines.push('# TYPE swiftremit_rate_limit_exceeded_total counter');
    Object.entries(this.metrics.swiftremit_rate_limit_exceeded_total).forEach(([path, count]) => {
      lines.push(`swiftremit_rate_limit_exceeded_total{path="${this.sanitizeLabelValue(path)}"} ${count}`);
    });

    // Job monitoring metrics (#866)
    lines.push('# HELP swiftremit_job_last_run_timestamp Unix timestamp of the last run for each background job');
    lines.push('# TYPE swiftremit_job_last_run_timestamp gauge');
    this.jobLastRunTimestamp.forEach((ts, jobName) => {
      lines.push(`swiftremit_job_last_run_timestamp{job_name="${this.sanitizeLabelValue(jobName)}"} ${ts}`);
    });

    lines.push('# HELP swiftremit_job_failure_total Total number of failures per background job');
    lines.push('# TYPE swiftremit_job_failure_total counter');
    this.jobFailureTotal.forEach((count, jobName) => {
      lines.push(`swiftremit_job_failure_total{job_name="${this.sanitizeLabelValue(jobName)}"} ${count}`);
    });

    // ── Money-at-risk signals (SR-104) ─────────────────────────────────────
    lines.push('# HELP swiftremit_contract_paused 1 when the on-chain contract is paused, 0 otherwise');
    lines.push('# TYPE swiftremit_contract_paused gauge');
    lines.push(`swiftremit_contract_paused ${this.metrics.swiftremit_contract_paused}`);

    lines.push('# HELP swiftremit_oldest_pending_remittance_age_seconds Age of the oldest remittance that has not reached a terminal state');
    lines.push('# TYPE swiftremit_oldest_pending_remittance_age_seconds gauge');
    lines.push(
      `swiftremit_oldest_pending_remittance_age_seconds ${this.metrics.swiftremit_oldest_pending_remittance_age_seconds}`,
    );

    lines.push('# HELP swiftremit_settlement_seconds_p95 95th percentile remittance settlement time over the last hour');
    lines.push('# TYPE swiftremit_settlement_seconds_p95 gauge');
    lines.push(`swiftremit_settlement_seconds_p95 ${this.metrics.swiftremit_settlement_seconds_p95}`);

    lines.push('# HELP swiftremit_circuit_open 1 when a provider circuit breaker is open (calls are being shed)');
    lines.push('# TYPE swiftremit_circuit_open gauge');
    this.circuitOpen.forEach((state, provider) => {
      lines.push(`swiftremit_circuit_open{provider="${this.sanitizeLabelValue(provider)}"} ${state}`);
    });

    lines.push('# HELP swiftremit_failed_migrations Number of migrations recorded as failed in schema_migrations');
    lines.push('# TYPE swiftremit_failed_migrations gauge');
    lines.push(`swiftremit_failed_migrations ${this.metrics.swiftremit_failed_migrations}`);

    lines.push('# HELP swiftremit_migration_last_applied_timestamp_seconds Unix timestamp of the most recent migration record');
    lines.push('# TYPE swiftremit_migration_last_applied_timestamp_seconds gauge');
    lines.push(
      `swiftremit_migration_last_applied_timestamp_seconds ${this.metrics.swiftremit_migration_last_applied_timestamp_seconds}`,
    );

    // ── HTTP request instrumentation (SR-104 — availability / latency SLIs) ─
    lines.push('# HELP swiftremit_http_requests_total Total HTTP requests served, by method, route and status code');
    lines.push('# TYPE swiftremit_http_requests_total counter');
    this.httpRequestsTotal.forEach((count, key) => {
      const [method, route, status] = key.split('|');
      lines.push(
        `swiftremit_http_requests_total{method="${this.sanitizeLabelValue(method)}",` +
          `route="${this.sanitizeLabelValue(route)}",status="${this.sanitizeLabelValue(status)}"} ${count}`,
      );
    });

    lines.push('# HELP swiftremit_http_request_duration_seconds HTTP request duration in seconds');
    lines.push('# TYPE swiftremit_http_request_duration_seconds histogram');
    this.httpRequestDurationBuckets.forEach((buckets, key) => {
      const [method, route] = key.split('|');
      const labels =
        `method="${this.sanitizeLabelValue(method)}",route="${this.sanitizeLabelValue(route)}"`;
      MetricsService.HTTP_DURATION_BUCKETS.forEach((bound, index) => {
        lines.push(
          `swiftremit_http_request_duration_seconds_bucket{${labels},le="${bound}"} ${buckets[index]}`,
        );
      });
      const count = this.httpRequestDurationCount.get(key) ?? 0;
      const sum = this.httpRequestDurationSum.get(key) ?? 0;
      lines.push(`swiftremit_http_request_duration_seconds_bucket{${labels},le="+Inf"} ${count}`);
      lines.push(`swiftremit_http_request_duration_seconds_sum{${labels}} ${sum}`);
      lines.push(`swiftremit_http_request_duration_seconds_count{${labels}} ${count}`);
    });

    // On-chain reconciler metrics (Feature C)
    try {
      const { reconcilerMetricsText } = require('./reconciler');
      lines.push(reconcilerMetricsText());
    } catch {
      // reconciler not loaded yet — safe to skip
    }

    return lines.join('\n') + '\n';
  }

  /**
   * Get metrics in Prometheus format
   */
  async getMetrics(): Promise<string> {
    await this.updateAllMetrics();
    return this.generatePrometheusText();
  }
}

// Singleton instance
let metricsServiceInstance: MetricsService | null = null;

export function getMetricsService(pool: Pool, fxRateCache?: FxRateCache): MetricsService {
  if (!metricsServiceInstance) {
    metricsServiceInstance = new MetricsService(pool, fxRateCache);
  }
  return metricsServiceInstance;
}
