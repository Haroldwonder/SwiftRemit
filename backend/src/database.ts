import { Pool, PoolClient } from 'pg';
import crypto from 'crypto';
import {
  AssetVerification,
  VerificationStatus,
  FxRate,
  FxRateRecord,
  KycStatus,
  DbUserKycStatus,
  AnchorKycConfig,
  WebhookSubscriber,
  WebhookDelivery,
} from './types';

export let pool: Pool | undefined;

export async function initDatabase() {
  let client: PoolClient | undefined;
  try {
    client = await getPool().connect();
    await client.query(`      CREATE TABLE IF NOT EXISTS transactions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        transaction_id VARCHAR(255) UNIQUE NOT NULL,
        anchor_id VARCHAR(255),
        kind VARCHAR(20) CHECK (kind IN ('deposit', 'withdrawal')),
        status VARCHAR(50),
        status_eta INTEGER,
        amount_in DECIMAL(20, 7),
        amount_out DECIMAL(20, 7),
        amount_fee DECIMAL(20, 7),
        asset_code VARCHAR(12),
        stellar_transaction_id VARCHAR(64),
        external_transaction_id VARCHAR(255),
        kyc_status VARCHAR(20),
        kyc_fields JSONB,
        kyc_rejection_reason TEXT,
        message TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS verified_assets (
        id SERIAL PRIMARY KEY,
        asset_code VARCHAR(12) NOT NULL,
        issuer VARCHAR(56) NOT NULL,
        status VARCHAR(20) NOT NULL,
        reputation_score INTEGER NOT NULL CHECK (reputation_score >= 0 AND reputation_score <= 100),
        last_verified TIMESTAMP NOT NULL DEFAULT NOW(),
        trustline_count BIGINT NOT NULL DEFAULT 0,
        has_toml BOOLEAN NOT NULL DEFAULT FALSE,
        stellar_expert_verified BOOLEAN DEFAULT FALSE,
        toml_data JSONB,
        community_reports INTEGER DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE(asset_code, issuer)
      );

      CREATE INDEX IF NOT EXISTS idx_asset_lookup ON verified_assets(asset_code, issuer);
      CREATE INDEX IF NOT EXISTS idx_status ON verified_assets(status);
      CREATE INDEX IF NOT EXISTS idx_last_verified ON verified_assets(last_verified);

      CREATE TABLE IF NOT EXISTS asset_reports (
        id SERIAL PRIMARY KEY,
        asset_code VARCHAR(12) NOT NULL,
        issuer VARCHAR(56) NOT NULL,
        reason VARCHAR(500) NOT NULL,
        reporter_id VARCHAR(100),
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_asset_reports_lookup ON asset_reports(asset_code, issuer);

      CREATE TABLE IF NOT EXISTS fx_rates (
        id SERIAL PRIMARY KEY,
        transaction_id VARCHAR(100) NOT NULL,
        rate DECIMAL(20, 8) NOT NULL,
        provider VARCHAR(100) NOT NULL,
        timestamp TIMESTAMP NOT NULL,
        from_currency VARCHAR(10) NOT NULL,
        to_currency VARCHAR(10) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE(transaction_id)
      );

      CREATE INDEX IF NOT EXISTS idx_fx_transaction ON fx_rates(transaction_id);
      CREATE INDEX IF NOT EXISTS idx_fx_timestamp ON fx_rates(timestamp);
      CREATE INDEX IF NOT EXISTS idx_fx_currencies ON fx_rates(from_currency, to_currency);

      CREATE TABLE IF NOT EXISTS anchor_kyc_configs (
        id SERIAL PRIMARY KEY,
        anchor_id VARCHAR(100) NOT NULL UNIQUE,
        kyc_server_url VARCHAR(500) NOT NULL,
        auth_token VARCHAR(500) NOT NULL,
        polling_interval_minutes INTEGER NOT NULL DEFAULT 60,
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS user_kyc_status (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(56) NOT NULL,
        anchor_id VARCHAR(100) NOT NULL,
        status VARCHAR(20) NOT NULL,
        last_checked TIMESTAMP NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMP,
        rejection_reason TEXT,
        verification_data JSONB,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE(user_id, anchor_id)
      );

      CREATE INDEX IF NOT EXISTS idx_user_kyc_status ON user_kyc_status(user_id, anchor_id);
      CREATE INDEX IF NOT EXISTS idx_kyc_status ON user_kyc_status(status);
      CREATE INDEX IF NOT EXISTS idx_kyc_last_checked ON user_kyc_status(last_checked);

      -- SEP-24 transactions table
      CREATE TABLE IF NOT EXISTS sep24_transactions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        transaction_id VARCHAR(255) UNIQUE NOT NULL,
        anchor_id VARCHAR(100) NOT NULL,
        direction VARCHAR(20) NOT NULL CHECK (direction IN ('deposit', 'withdrawal')),
        status VARCHAR(50) NOT NULL,
        asset_code VARCHAR(12) NOT NULL,
        amount VARCHAR(40),
        amount_in VARCHAR(40),
        amount_out VARCHAR(40),
        amount_fee VARCHAR(40),
        stellar_transaction_id VARCHAR(64),
        external_transaction_id VARCHAR(255),
        user_id VARCHAR(255) NOT NULL,
        interactive_url TEXT,
        instructions_url TEXT,
        kyc_status VARCHAR(20),
        kyc_web_url TEXT,
        status_eta INTEGER,
        last_polled TIMESTAMP,
        message TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_sep24_transaction_id ON sep24_transactions(transaction_id);
      CREATE INDEX IF NOT EXISTS idx_sep24_anchor_id ON sep24_transactions(anchor_id);
      CREATE INDEX IF NOT EXISTS idx_sep24_user_id ON sep24_transactions(user_id);
      CREATE INDEX IF NOT EXISTS idx_sep24_status ON sep24_transactions(status);
      CREATE INDEX IF NOT EXISTS idx_sep24_last_polled ON sep24_transactions(last_polled);

      CREATE TABLE IF NOT EXISTS contract_events (
        id              SERIAL PRIMARY KEY,
        event_type      VARCHAR(50)  NOT NULL,
        remittance_id   BIGINT,
        actor           VARCHAR(56),
        amount          NUMERIC(30, 7),
        fee             NUMERIC(30, 7),
        tx_hash         VARCHAR(64),
        ledger_sequence BIGINT,
        timestamp       TIMESTAMP    NOT NULL DEFAULT NOW(),
        raw_data        JSONB
      );

      CREATE INDEX IF NOT EXISTS idx_ce_event_type    ON contract_events(event_type);
      CREATE INDEX IF NOT EXISTS idx_ce_actor         ON contract_events(actor);
      CREATE INDEX IF NOT EXISTS idx_ce_remittance_id ON contract_events(remittance_id);
      CREATE INDEX IF NOT EXISTS idx_ce_timestamp     ON contract_events(timestamp);

      -- Idempotency store for incoming webhook nonces
      CREATE TABLE IF NOT EXISTS webhook_processed_nonces (
        nonce       VARCHAR(255) NOT NULL,
        anchor_id   VARCHAR(255) NOT NULL,
        processed_at TIMESTAMP   NOT NULL DEFAULT NOW(),
        expires_at  TIMESTAMP    NOT NULL,
        PRIMARY KEY (nonce, anchor_id)
      );

      CREATE INDEX IF NOT EXISTS idx_wpn_expires_at ON webhook_processed_nonces(expires_at);
    `);

    // Agent KYC table
    await client.query(`
      CREATE TABLE IF NOT EXISTS agent_kyc (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        agent_id VARCHAR(255) NOT NULL UNIQUE,
        business_registration JSONB,
        owner_id VARCHAR(255),
        operating_country VARCHAR(100),
        payout_address VARCHAR(255),
        contact_email VARCHAR(255),
        status VARCHAR(20) NOT NULL CHECK (status IN ('submitted','under_review','approved','rejected')),
        rejection_reason TEXT,
        sep12_customer_id VARCHAR(255),
        submitted_at TIMESTAMP NOT NULL DEFAULT NOW(),
        reviewed_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_agent_kyc_agent_id ON agent_kyc(agent_id);
      CREATE INDEX IF NOT EXISTS idx_agent_kyc_status ON agent_kyc(status);
    `);

    console.log('Database initialized successfully');
  } finally {
    client?.release();
  }
}

export async function upsertAgentKyc(record: any): Promise<void> {
  const query = `
    INSERT INTO agent_kyc (
      agent_id, business_registration, owner_id, operating_country, payout_address, contact_email, status, rejection_reason, sep12_customer_id, submitted_at, reviewed_at, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())
    ON CONFLICT (agent_id) DO UPDATE SET
      business_registration = EXCLUDED.business_registration,
      owner_id = EXCLUDED.owner_id,
      operating_country = EXCLUDED.operating_country,
      payout_address = EXCLUDED.payout_address,
      contact_email = EXCLUDED.contact_email,
      status = EXCLUDED.status,
      rejection_reason = EXCLUDED.rejection_reason,
      sep12_customer_id = COALESCE(EXCLUDED.sep12_customer_id, agent_kyc.sep12_customer_id),
      reviewed_at = EXCLUDED.reviewed_at,
      updated_at = NOW()
  `;

  await pool.query(query, [
    record.agent_id,
    record.business_registration ? JSON.stringify(record.business_registration) : null,
    record.owner_id || null,
    record.operating_country || null,
    record.payout_address || null,
    record.contact_email || null,
    record.status,
    record.rejection_reason || null,
    record.sep12_customer_id || null,
    record.submitted_at || new Date(),
    record.reviewed_at || null,
  ]);
}

export async function getAgentKyc(agentId: string): Promise<any | null> {
  const query = `SELECT * FROM agent_kyc WHERE agent_id = $1`;
  const result = await pool.query(query, [agentId]);
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    agent_id: row.agent_id,
    business_registration: row.business_registration,
    owner_id: row.owner_id,
    operating_country: row.operating_country,
    payout_address: row.payout_address,
    contact_email: row.contact_email,
    status: row.status,
    rejection_reason: row.rejection_reason,
    sep12_customer_id: row.sep12_customer_id,
    submitted_at: row.submitted_at,
    reviewed_at: row.reviewed_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}


export async function saveAssetVerification(verification: AssetVerification): Promise<void> {
  const query = `
    INSERT INTO verified_assets (
      asset_code, issuer, status, reputation_score, last_verified,
      trustline_count, has_toml, stellar_expert_verified, toml_data, community_reports
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    ON CONFLICT (asset_code, issuer) 
    DO UPDATE SET
      status = EXCLUDED.status,
      reputation_score = EXCLUDED.reputation_score,
      last_verified = EXCLUDED.last_verified,
      trustline_count = EXCLUDED.trustline_count,
      has_toml = EXCLUDED.has_toml,
      stellar_expert_verified = EXCLUDED.stellar_expert_verified,
      toml_data = EXCLUDED.toml_data,
      community_reports = EXCLUDED.community_reports,
      updated_at = NOW()
  `;

  await getPool().query(query, [
    verification.asset_code,
    verification.issuer,
    verification.status,
    verification.reputation_score,
    verification.last_verified,
    verification.trustline_count,
    verification.has_toml,
    verification.stellar_expert_verified || false,
    verification.toml_data ? JSON.stringify(verification.toml_data) : null,
    verification.community_reports || 0,
  ]);
}

export async function getAssetVerification(
  assetCode: string,
  issuer: string
): Promise<AssetVerification | null> {
  const query = `
    SELECT * FROM verified_assets 
    WHERE asset_code = $1 AND issuer = $2
  `;
  const result = await getPool().query(query, [assetCode, issuer]);
  
  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    asset_code: row.asset_code,
    issuer: row.issuer,
    status: row.status as VerificationStatus,
    reputation_score: row.reputation_score,
    last_verified: row.last_verified,
    trustline_count: parseInt(row.trustline_count),
    has_toml: row.has_toml,
    stellar_expert_verified: row.stellar_expert_verified,
    toml_data: row.toml_data,
    community_reports: row.community_reports,
  };
}

export async function getStaleAssets(hoursOld: number): Promise<AssetVerification[]> {
  const query = `
    SELECT * FROM verified_assets 
    WHERE last_verified < NOW() - INTERVAL '${hoursOld} hours'
    ORDER BY last_verified ASC
    LIMIT 100
  `;
  const result = await getPool().query(query);
  
  return result.rows.map(row => ({
    asset_code: row.asset_code,
    issuer: row.issuer,
    status: row.status as VerificationStatus,
    reputation_score: row.reputation_score,
    last_verified: row.last_verified,
    trustline_count: parseInt(row.trustline_count),
    has_toml: row.has_toml,
    stellar_expert_verified: row.stellar_expert_verified,
    toml_data: row.toml_data,
    community_reports: row.community_reports,
  }));
}

export async function reportSuspiciousAsset(
  assetCode: string,
  issuer: string
): Promise<void> {
  const query = `
    UPDATE verified_assets 
    SET community_reports = community_reports + 1,
        updated_at = NOW()
    WHERE asset_code = $1 AND issuer = $2
  `;
  await getPool().query(query, [assetCode, issuer]);
}

export async function saveAssetReport(
  assetCode: string,
  issuer: string,
  reason: string,
  reporterId?: string
): Promise<void> {
  const query = `
    INSERT INTO asset_reports (asset_code, issuer, reason, reporter_id)
    VALUES ($1, $2, $3, $4)
  `;
  await getPool().query(query, [assetCode, issuer, reason, reporterId || null]);
}

export async function getVerifiedAssets(limit: number = 100): Promise<AssetVerification[]> {
  const query = `
    SELECT * FROM verified_assets 
    WHERE status = 'verified'
    ORDER BY reputation_score DESC, trustline_count DESC
    LIMIT $1
  `;
  const result = await getPool().query(query, [limit]);
  
  return result.rows.map(row => ({
    asset_code: row.asset_code,
    issuer: row.issuer,
    status: row.status as VerificationStatus,
    reputation_score: row.reputation_score,
    last_verified: row.last_verified,
    trustline_count: parseInt(row.trustline_count),
    has_toml: row.has_toml,
    stellar_expert_verified: row.stellar_expert_verified,
    toml_data: row.toml_data,
    community_reports: row.community_reports,
  }));
}

export async function saveFxRate(fxRate: FxRate): Promise<void> {
  const query = `
    INSERT INTO fx_rates (
      transaction_id, rate, provider, timestamp, from_currency, to_currency
    ) VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (transaction_id) DO NOTHING
  `;

  await getPool().query(query, [
    fxRate.transaction_id,
    fxRate.rate,
    fxRate.provider,
    fxRate.timestamp,
    fxRate.from_currency,
    fxRate.to_currency,
  ]);
}

export async function getFxRate(transactionId: string): Promise<FxRateRecord | null> {
  const query = `
    SELECT * FROM fx_rates 
    WHERE transaction_id = $1
  `;
  const result = await getPool().query(query, [transactionId]);
  
  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    id: row.id,
    transaction_id: row.transaction_id,
    rate: parseFloat(row.rate),
    provider: row.provider,
    timestamp: row.timestamp,
    from_currency: row.from_currency,
    to_currency: row.to_currency,
    created_at: row.created_at,
  };
}

// KYC-related database functions
export async function saveAnchorKycConfig(config: AnchorKycConfig): Promise<void> {
  const query = `
    INSERT INTO anchor_kyc_configs (
      anchor_id, kyc_server_url, auth_token, polling_interval_minutes, enabled
    ) VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (anchor_id) 
    DO UPDATE SET
      kyc_server_url = EXCLUDED.kyc_server_url,
      auth_token = EXCLUDED.auth_token,
      polling_interval_minutes = EXCLUDED.polling_interval_minutes,
      enabled = EXCLUDED.enabled,
      updated_at = NOW()
  `;

  await getPool().query(query, [
    config.anchor_id,
    config.kyc_server_url,
    config.auth_token,
    config.polling_interval_minutes,
    config.enabled,
  ]);
}

export async function getAnchorKycConfigs(): Promise<AnchorKycConfig[]> {
  const query = `SELECT * FROM anchor_kyc_configs WHERE enabled = TRUE`;
  const result = await getPool().query(query);
  
  return result.rows.map(row => ({
    anchor_id: row.anchor_id,
    kyc_server_url: row.kyc_server_url,
    auth_token: row.auth_token,
    polling_interval_minutes: row.polling_interval_minutes,
    enabled: row.enabled,
  }));
}

export async function saveUserKycStatus(kycStatus: DbUserKycStatus): Promise<void> {
  const query = `
    INSERT INTO user_kyc_status (
      user_id, anchor_id, status, last_checked, expires_at, rejection_reason, verification_data
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (user_id, anchor_id) 
    DO UPDATE SET
      status = EXCLUDED.status,
      last_checked = EXCLUDED.last_checked,
      expires_at = EXCLUDED.expires_at,
      rejection_reason = EXCLUDED.rejection_reason,
      verification_data = EXCLUDED.verification_data,
      updated_at = NOW()
  `;

  await getPool().query(query, [
    kycStatus.user_id,
    kycStatus.anchor_id,
    kycStatus.status,
    kycStatus.last_checked,
    kycStatus.expires_at || null,
    kycStatus.rejection_reason || null,
    kycStatus.verification_data ? JSON.stringify(kycStatus.verification_data) : null,
  ]);
}

export async function getUserKycStatus(userId: string, anchorId: string): Promise<DbUserKycStatus | null> {
  const query = `
    SELECT * FROM user_kyc_status 
    WHERE user_id = $1 AND anchor_id = $2
  `;
  const result = await getPool().query(query, [userId, anchorId]);
  
  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    user_id: row.user_id,
    anchor_id: row.anchor_id,
    status: row.status as KycStatus,
    last_checked: row.last_checked,
    expires_at: row.expires_at,
    rejection_reason: row.rejection_reason,
    verification_data: row.verification_data,
  };
}

export async function getUsersNeedingKycCheck(anchorId: string, minutesSinceLastCheck: number): Promise<DbUserKycStatus[]> {
  const query = `
    SELECT * FROM user_kyc_status 
    WHERE anchor_id = $1 
      AND last_checked < NOW() - INTERVAL '${minutesSinceLastCheck} minutes'
      AND status IN ('pending', 'approved', 're_verification_pending')
    ORDER BY last_checked ASC
    LIMIT 100
  `;
  const result = await getPool().query(query, [anchorId]);
  
  return result.rows.map(row => ({
    user_id: row.user_id,
    anchor_id: row.anchor_id,
    status: row.status as KycStatus,
    last_checked: row.last_checked,
    expires_at: row.expires_at,
    rejection_reason: row.rejection_reason,
    verification_data: row.verification_data,
  }));
}

export async function getApprovedUsers(): Promise<DbUserKycStatus[]> {
  const query = `
    SELECT * FROM user_kyc_status 
    WHERE status = 'approved' 
      AND (expires_at IS NULL OR expires_at > NOW())
    ORDER BY last_checked DESC
  `;
  const result = await getPool().query(query);
  
  return result.rows.map(row => ({
    user_id: row.user_id,
    anchor_id: row.anchor_id,
    status: row.status as KycStatus,
    last_checked: row.last_checked,
    expires_at: row.expires_at,
    rejection_reason: row.rejection_reason,
    verification_data: row.verification_data,
  }));
}

export interface AnchorPollFailureRecord {
  anchor_id: string;
  error_message: string;
  failed_at?: Date;
}

export async function saveAnchorPollFailure(failure: AnchorPollFailureRecord): Promise<void> {
  await getPool().query(
    `INSERT INTO anchor_poll_failures (anchor_id, error_message, failed_at)
     VALUES ($1, $2, $3)`,
    [failure.anchor_id, failure.error_message, failure.failed_at ?? new Date()]
  );
}

// ========== SEP-24 Transaction Functions ==========

/**
 * SEP-24 transaction record for database
 */
export interface Sep24TransactionDbRecord {
  id?: number;
  transaction_id: string;
  anchor_id: string;
  direction: 'deposit' | 'withdrawal';
  status: string;
  asset_code: string;
  amount?: string;
  amount_in?: string;
  amount_out?: string;
  amount_fee?: string;
  stellar_transaction_id?: string;
  external_transaction_id?: string;
  user_id: string;
  interactive_url?: string;
  instructions_url?: string;
  kyc_status?: string;
  kyc_web_url?: string;
  status_eta?: number;
  last_polled?: Date;
  message?: string;
  created_at?: Date;
  updated_at?: Date;
}

/**
 * Save a SEP-24 transaction
 */
export async function saveSep24Transaction(
  record: Omit<Sep24TransactionDbRecord, 'id' | 'created_at' | 'updated_at'>
): Promise<void> {
  const query = `
    INSERT INTO sep24_transactions (
      transaction_id, anchor_id, direction, status, asset_code,
      amount, amount_in, amount_out, amount_fee,
      stellar_transaction_id, external_transaction_id,
      user_id, interactive_url, instructions_url,
      kyc_status, kyc_web_url, status_eta, message
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18
    )
    ON CONFLICT (transaction_id) 
    DO UPDATE SET
      status = EXCLUDED.status,
      amount_in = COALESCE(EXCLUDED.amount_in, sep24_transactions.amount_in),
      amount_out = COALESCE(EXCLUDED.amount_out, sep24_transactions.amount_out),
      amount_fee = COALESCE(EXCLUDED.amount_fee, sep24_transactions.amount_fee),
      stellar_transaction_id = COALESCE(EXCLUDED.stellar_transaction_id, sep24_transactions.stellar_transaction_id),
      external_transaction_id = COALESCE(EXCLUDED.external_transaction_id, sep24_transactions.external_transaction_id),
      kyc_status = COALESCE(EXCLUDED.kyc_status, sep24_transactions.kyc_status),
      message = COALESCE(EXCLUDED.message, sep24_transactions.message),
      updated_at = NOW()
  `;

  await getPool().query(query, [
    record.transaction_id,
    record.anchor_id,
    record.direction,
    record.status,
    record.asset_code,
    record.amount || null,
    record.amount_in || null,
    record.amount_out || null,
    record.amount_fee || null,
    record.stellar_transaction_id || null,
    record.external_transaction_id || null,
    record.user_id,
    record.interactive_url || null,
    record.instructions_url || null,
    record.kyc_status || null,
    record.kyc_web_url || null,
    record.status_eta || null,
    record.message || null,
  ]);
}

/**
 * Get a SEP-24 transaction by transaction_id
 */
export async function getSep24Transaction(
  transactionId: string
): Promise<Sep24TransactionDbRecord | null> {
  const query = `
    SELECT * FROM sep24_transactions 
    WHERE transaction_id = $1
  `;
  const result = await getPool().query(query, [transactionId]);

  if (result.rows.length === 0) {
    return null;
  }

  return result.rows[0] as Sep24TransactionDbRecord;
}

/**
 * Get a SEP-24 transaction by ID (numeric)
 */
export async function getSep24TransactionById(
  transactionId: string
): Promise<Sep24TransactionDbRecord | null> {
  return getSep24Transaction(transactionId);
}

/**
 * Get pending SEP-24 transactions for an anchor
 */
export async function getPendingSep24Transactions(
  anchorId: string,
  minutesSinceLastPoll: number
): Promise<Sep24TransactionDbRecord[]> {
  const query = `
    SELECT * FROM sep24_transactions 
    WHERE anchor_id = $1 
      AND status NOT IN ('completed', 'refunded', 'expired', 'error')
      AND (last_polled IS NULL OR last_polled < NOW() - INTERVAL '${minutesSinceLastPoll} minutes')
    ORDER BY created_at ASC
    LIMIT 50
  `;
  const result = await getPool().query(query, [anchorId]);

  return result.rows as Sep24TransactionDbRecord[];
}

/**
 * Update SEP-24 transaction status
 */
export async function updateSep24TransactionStatus(
  transactionId: string,
  status: string,
  amountIn?: string,
  amountOut?: string,
  amountFee?: string,
  stellarTransactionId?: string,
  externalTransactionId?: string,
  message?: string
): Promise<void> {
  const query = `
    UPDATE sep24_transactions 
    SET status = $2,
        amount_in = COALESCE($3, amount_in),
        amount_out = COALESCE($4, amount_out),
        amount_fee = COALESCE($5, amount_fee),
        stellar_transaction_id = COALESCE($6, stellar_transaction_id),
        external_transaction_id = COALESCE($7, external_transaction_id),
        message = COALESCE($8, message),
        last_polled = NOW(),
        updated_at = NOW()
    WHERE transaction_id = $1
  `;

  await getPool().query(query, [
    transactionId,
    status,
    amountIn || null,
    amountOut || null,
    amountFee || null,
    stellarTransactionId || null,
    externalTransactionId || null,
    message || null,
  ]);
}

/**
 * Get all SEP-24 transactions for a user
 */
export async function getSep24TransactionsByUser(
  userId: string
): Promise<Sep24TransactionDbRecord[]> {
  const query = `
    SELECT * FROM sep24_transactions 
    WHERE user_id = $1
    ORDER BY created_at DESC
    LIMIT 100
  `;
  const result = await getPool().query(query, [userId]);

  return result.rows as Sep24TransactionDbRecord[];
}

function mapWebhookDeliveryRow(row: Record<string, unknown>): WebhookDelivery {
  return {
    id: String(row.id),
    event_type: String(row.event_type),
    event_key: String(row.event_key),
    subscriber_id: String(row.subscriber_id),
    target_url: String(row.target_url),
    payload: row.payload,
    status: row.status as WebhookDelivery['status'],
    attempt_count: Number(row.attempt_count),
    max_attempts: Number(row.max_attempts),
    next_retry_at: row.next_retry_at as Date,
    last_error: row.last_error as string | null | undefined,
    response_status: row.response_status as number | null | undefined,
    delivered_at: row.delivered_at as Date | null | undefined,
  };
}

export async function getActiveWebhookSubscribers(): Promise<WebhookSubscriber[]> {
  const result = await getPool().query(
    `SELECT id, url, secret, previous_secret, secret_rotated_at, active, created_at, updated_at
     FROM webhook_subscribers
     WHERE active = true`
  );
  return result.rows.map((row) => ({
    id: String(row.id),
    url: String(row.url),
    secret: row.secret as string | null,
    previous_secret: row.previous_secret as string | null,
    secret_rotated_at: row.secret_rotated_at as Date | null,
    active: Boolean(row.active),
    created_at: row.created_at as Date,
    updated_at: row.updated_at as Date,
  }));
}

export async function getWebhookSubscriberById(id: string): Promise<WebhookSubscriber | null> {
  const result = await getPool().query(
    `SELECT id, url, secret, previous_secret, secret_rotated_at, active, created_at, updated_at
     FROM webhook_subscribers
     WHERE id = $1`,
    [id]
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    id: String(row.id),
    url: String(row.url),
    secret: row.secret as string | null,
    previous_secret: row.previous_secret as string | null,
    secret_rotated_at: row.secret_rotated_at as Date | null,
    active: Boolean(row.active),
    created_at: row.created_at as Date,
    updated_at: row.updated_at as Date,
  };
}

export async function rotateWebhookSecret(id: string): Promise<{ newSecret: string; rotatedAt: Date }> {
  const newSecret = crypto.randomBytes(32).toString('hex');
  const result = await getPool().query(
    `UPDATE webhook_subscribers
     SET previous_secret = secret,
         secret = $2,
         secret_rotated_at = NOW(),
         updated_at = NOW()
     WHERE id = $1
     RETURNING secret_rotated_at`,
    [id, newSecret]
  );
  if ((result.rowCount ?? 0) === 0) {
    throw new Error(`Webhook subscriber not found: ${id}`);
  }
  return { newSecret, rotatedAt: result.rows[0].secret_rotated_at as Date };
}

export async function enqueueWebhookDelivery(
  eventType: string,
  eventKey: string,
  subscriber: WebhookSubscriber,
  payload: unknown,
  maxAttempts: number
): Promise<WebhookDelivery> {
  const result = await getPool().query(
    `INSERT INTO webhook_deliveries (
       event_type, event_key, subscriber_id, target_url, payload,
       max_attempts, status, attempt_count, next_retry_at
     ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, 'pending', 0, NOW())
     ON CONFLICT (event_type, event_key, subscriber_id)
     DO UPDATE SET
       payload = EXCLUDED.payload,
       max_attempts = EXCLUDED.max_attempts,
       status = 'pending',
       attempt_count = 0,
       next_retry_at = NOW(),
       updated_at = NOW()
     RETURNING *`,
    [eventType, eventKey, subscriber.id, subscriber.url, JSON.stringify(payload), maxAttempts]
  );
  return mapWebhookDeliveryRow(result.rows[0] as Record<string, unknown>);
}

export async function getPendingWebhookDeliveries(limit: number): Promise<WebhookDelivery[]> {
  const result = await getPool().query(
    `SELECT * FROM webhook_deliveries
     WHERE status = 'pending' AND next_retry_at <= NOW()
     ORDER BY next_retry_at ASC
     LIMIT $1`,
    [limit]
  );
  return result.rows.map((row) => mapWebhookDeliveryRow(row as Record<string, unknown>));
}

export async function markWebhookDeliverySuccess(id: string, responseStatus: number): Promise<void> {
  await getPool().query(
    `UPDATE webhook_deliveries
     SET status = 'success', response_status = $2, delivered_at = NOW(), updated_at = NOW()
     WHERE id = $1`,
    [id, responseStatus]
  );
}

export async function markWebhookDeliveryFailure(
  id: string,
  attemptCount: number,
  maxAttempts: number,
  nextRetryAt: Date,
  message: string,
  responseStatus: number | null
): Promise<void> {
  const status: WebhookDelivery['status'] = attemptCount >= maxAttempts ? 'failed' : 'pending';
  await getPool().query(
    `UPDATE webhook_deliveries
     SET attempt_count = $2,
         status = $3,
         next_retry_at = $4,
         last_error = $5,
         response_status = $6,
         updated_at = NOW()
     WHERE id = $1`,
    [id, attemptCount, status, nextRetryAt, message, responseStatus]
  );
}

export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('Missing required environment variable: DATABASE_URL');
    }
    pool = new Pool({
      connectionString,
      max: parseInt(process.env.DB_POOL_MAX ?? '20', 10),
      min: parseInt(process.env.DB_POOL_MIN ?? '2', 10),
      idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE_TIMEOUT_MS ?? '30000', 10),
      connectionTimeoutMillis: parseInt(process.env.DB_POOL_CONNECTION_TIMEOUT_MS ?? '2000', 10),
    });
  }
  return pool;
}

/** Drain and close the PostgreSQL connection pool. Safe to call multiple times. */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
  }
}

// ── Contract Events ──────────────────────────────────────────────────────────

export interface ContractEvent {
  id?: number;
  event_type: string;
  remittance_id?: number | null;
  actor?: string | null;
  amount?: string | null;
  fee?: string | null;
  tx_hash?: string | null;
  ledger_sequence?: number | null;
  timestamp: Date;
  raw_data?: Record<string, unknown> | null;
}

export interface ContractEventFilter {
  event_type?: string;
  actor?: string;
  remittance_id?: number;
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
}

export async function saveContractEvent(event: ContractEvent): Promise<void> {
  await getPool().query(
    `INSERT INTO contract_events
       (event_type, remittance_id, actor, amount, fee, tx_hash, ledger_sequence, timestamp, raw_data)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT DO NOTHING`,
    [
      event.event_type,
      event.remittance_id ?? null,
      event.actor ?? null,
      event.amount ?? null,
      event.fee ?? null,
      event.tx_hash ?? null,
      event.ledger_sequence ?? null,
      event.timestamp,
      event.raw_data ? JSON.stringify(event.raw_data) : null,
    ]
  );
}

// ── Webhook Idempotency ──────────────────────────────────────────────────────

/**
 * Attempts to record a nonce as processed. Returns true if the nonce is new
 * (safe to process), false if it was already seen (duplicate delivery).
 *
 * @param nonce     - The x-nonce header value from the incoming webhook
 * @param anchorId  - The anchor that sent the webhook
 * @param ttlSeconds - How long to retain the nonce record (default: 24 h)
 */
export async function recordWebhookNonce(
  nonce: string,
  anchorId: string,
  ttlSeconds: number = 86400
): Promise<boolean> {
  const result = await getPool().query(
    `INSERT INTO webhook_processed_nonces (nonce, anchor_id, expires_at)
     VALUES ($1, $2, NOW() + ($3 || ' seconds')::INTERVAL)
     ON CONFLICT (nonce, anchor_id) DO NOTHING
     RETURNING nonce`,
    [nonce, anchorId, ttlSeconds]
  );
  // If a row was inserted, the nonce is new; if nothing was inserted it's a duplicate
  return result.rowCount !== null && result.rowCount > 0;
}

/**
 * Purges expired nonce records. Call this periodically (e.g. from a cron job).
 */
export async function purgeExpiredWebhookNonces(): Promise<void> {
  await getPool().query(
    `DELETE FROM webhook_processed_nonces WHERE expires_at < NOW()`
  );
}

// ── Anchor Health History ─────────────────────────────────────────────────────

export interface AnchorHealthRecord {
  id?: number;
  anchor_id: string;
  status: 'online' | 'degraded' | 'offline';
  response_time_ms?: number;
  error_message?: string;
  checked_at?: Date;
}

export async function saveAnchorHealthCheck(record: AnchorHealthRecord): Promise<void> {
  await getPool().query(
    `INSERT INTO anchor_health_history (anchor_id, status, response_time_ms, error_message, checked_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      record.anchor_id,
      record.status,
      record.response_time_ms ?? null,
      record.error_message ?? null,
      record.checked_at ?? new Date(),
    ]
  );
}

export async function getAnchorHealthHistory(
  anchorId: string,
  limit: number = 50
): Promise<AnchorHealthRecord[]> {
  const result = await getPool().query(
    `SELECT id, anchor_id, status, response_time_ms, error_message, checked_at
     FROM anchor_health_history
     WHERE anchor_id = $1
     ORDER BY checked_at DESC
     LIMIT $2`,
    [anchorId, limit]
  );

  return result.rows.map(row => ({
    id: row.id,
    anchor_id: row.anchor_id,
    status: row.status,
    response_time_ms: row.response_time_ms,
    error_message: row.error_message,
    checked_at: row.checked_at,
  }));
}

export async function getLatestAnchorHealth(
  anchorId: string
): Promise<AnchorHealthRecord | null> {
  const result = await getPool().query(
    `SELECT id, anchor_id, status, response_time_ms, error_message, checked_at
     FROM anchor_health_history
     WHERE anchor_id = $1
     ORDER BY checked_at DESC
     LIMIT 1`,
    [anchorId]
  );

  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    id: row.id,
    anchor_id: row.anchor_id,
    status: row.status,
    response_time_ms: row.response_time_ms,
    error_message: row.error_message,
    checked_at: row.checked_at,
  };
}

export async function getAnchorHealthUptime(
  anchorId: string,
  sinceHours: number = 24
): Promise<number> {
  const result = await getPool().query(
    `SELECT
       COUNT(*) as total,
       SUM(CASE WHEN status = 'online' THEN 1 ELSE 0 END) as online
     FROM anchor_health_history
     WHERE anchor_id = $1 AND checked_at > NOW() - ($2 || ' hours')::INTERVAL`,
    [anchorId, sinceHours]
  );

  const total = parseInt(result.rows[0].total, 10);
  if (total === 0) return 100;
  const online = parseInt(result.rows[0].online, 10);
  return Math.round((online / total) * 100 * 100) / 100;
}

// ── Anchor Listing (shared with API schema) ───────────────────────────────────

export interface AnchorRow {
  id: string;
  name: string;
  domain: string;
  home_domain: string | null;
  enabled: boolean;
}

export async function getEnabledAnchors(): Promise<AnchorRow[]> {
  const result = await getPool().query(
    `SELECT id, name, domain, home_domain, enabled
     FROM anchors
     WHERE enabled = true`
  );
  return result.rows.map(row => ({
    id: row.id,
    name: row.name,
    domain: row.domain,
    home_domain: row.home_domain,
    enabled: row.enabled,
  }));
}

export async function queryContractEvents(
  filter: ContractEventFilter
): Promise<{ events: ContractEvent[]; total: number }> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (filter.event_type) {
    conditions.push(`event_type = $${idx++}`);
    params.push(filter.event_type);
  }
  if (filter.actor) {
    conditions.push(`actor = $${idx++}`);
    params.push(filter.actor);
  }
  if (filter.remittance_id !== undefined) {
    conditions.push(`remittance_id = $${idx++}`);
    params.push(filter.remittance_id);
  }
  if (filter.from) {
    conditions.push(`timestamp >= $${idx++}`);
    params.push(filter.from);
  }
  if (filter.to) {
    conditions.push(`timestamp <= $${idx++}`);
    params.push(filter.to);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Math.min(filter.limit ?? 50, 200);
  const offset = filter.offset ?? 0;

  const [dataResult, countResult] = await Promise.all([
    getPool().query(
      `SELECT * FROM contract_events ${where} ORDER BY timestamp DESC LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    ),
    getPool().query(`SELECT COUNT(*) FROM contract_events ${where}`, params),
  ]);

  return {
    events: dataResult.rows,
    total: parseInt(countResult.rows[0].count, 10),
  };
}
