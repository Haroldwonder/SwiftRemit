"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pool = void 0;
exports.initDatabase = initDatabase;
exports.saveAssetVerification = saveAssetVerification;
exports.getAssetVerification = getAssetVerification;
exports.getStaleAssets = getStaleAssets;
exports.reportSuspiciousAsset = reportSuspiciousAsset;
exports.saveAssetReport = saveAssetReport;
exports.getVerifiedAssets = getVerifiedAssets;
exports.saveFxRate = saveFxRate;
exports.getFxRate = getFxRate;
exports.saveAnchorKycConfig = saveAnchorKycConfig;
exports.getAnchorKycConfigs = getAnchorKycConfigs;
exports.saveUserKycStatus = saveUserKycStatus;
exports.getUserKycStatus = getUserKycStatus;
exports.getUsersNeedingKycCheck = getUsersNeedingKycCheck;
exports.getApprovedUsers = getApprovedUsers;
exports.saveSep24Transaction = saveSep24Transaction;
exports.getSep24Transaction = getSep24Transaction;
exports.getSep24TransactionById = getSep24TransactionById;
exports.getPendingSep24Transactions = getPendingSep24Transactions;
exports.updateSep24TransactionStatus = updateSep24TransactionStatus;
exports.getSep24TransactionsByUser = getSep24TransactionsByUser;
exports.getPool = getPool;
const pg_1 = require("pg");
const pool = new pg_1.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
});
exports.pool = pool;
async function initDatabase() {
    const client = await pool.connect();
    try {
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

      CREATE TABLE IF NOT EXISTS user_kyc_status (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR(255) NOT NULL,
        anchor_id VARCHAR(255) NOT NULL,
        kyc_status VARCHAR(20) NOT NULL CHECK (kyc_status IN ('pending', 'approved', 'rejected')),
        kyc_level VARCHAR(20) CHECK (kyc_level IN ('basic', 'intermediate', 'advanced')),
        rejection_reason TEXT,
        verified_at TIMESTAMP NOT NULL,
        expires_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_user_anchor UNIQUE (user_id, anchor_id)
      );

      CREATE INDEX IF NOT EXISTS idx_kyc_status_user_id ON user_kyc_status(user_id);
      CREATE INDEX IF NOT EXISTS idx_kyc_status_status ON user_kyc_status(kyc_status);
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
    `);
        console.log('Database initialized successfully');
    }
    finally {
        client.release();
    }
}
async function saveAssetVerification(verification) {
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
    await pool.query(query, [
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
async function getAssetVerification(assetCode, issuer) {
    const query = `
    SELECT * FROM verified_assets 
    WHERE asset_code = $1 AND issuer = $2
  `;
    const result = await pool.query(query, [assetCode, issuer]);
    if (result.rows.length === 0) {
        return null;
    }
    const row = result.rows[0];
    return {
        asset_code: row.asset_code,
        issuer: row.issuer,
        status: row.status,
        reputation_score: row.reputation_score,
        last_verified: row.last_verified,
        trustline_count: parseInt(row.trustline_count),
        has_toml: row.has_toml,
        stellar_expert_verified: row.stellar_expert_verified,
        toml_data: row.toml_data,
        community_reports: row.community_reports,
    };
}
async function getStaleAssets(hoursOld) {
    const query = `
    SELECT * FROM verified_assets 
    WHERE last_verified < NOW() - INTERVAL '${hoursOld} hours'
    ORDER BY last_verified ASC
    LIMIT 100
  `;
    const result = await pool.query(query);
    return result.rows.map(row => ({
        asset_code: row.asset_code,
        issuer: row.issuer,
        status: row.status,
        reputation_score: row.reputation_score,
        last_verified: row.last_verified,
        trustline_count: parseInt(row.trustline_count),
        has_toml: row.has_toml,
        stellar_expert_verified: row.stellar_expert_verified,
        toml_data: row.toml_data,
        community_reports: row.community_reports,
    }));
}
async function reportSuspiciousAsset(assetCode, issuer) {
    const query = `
    UPDATE verified_assets 
    SET community_reports = community_reports + 1,
        updated_at = NOW()
    WHERE asset_code = $1 AND issuer = $2
  `;
    await pool.query(query, [assetCode, issuer]);
}
async function saveAssetReport(assetCode, issuer, reason, reporterId) {
    const query = `
    INSERT INTO asset_reports (asset_code, issuer, reason, reporter_id)
    VALUES ($1, $2, $3, $4)
  `;
    await pool.query(query, [assetCode, issuer, reason, reporterId || null]);
}
async function getVerifiedAssets(limit = 100) {
    const query = `
    SELECT * FROM verified_assets 
    WHERE status = 'verified'
    ORDER BY reputation_score DESC, trustline_count DESC
    LIMIT $1
  `;
    const result = await pool.query(query, [limit]);
    return result.rows.map(row => ({
        asset_code: row.asset_code,
        issuer: row.issuer,
        status: row.status,
        reputation_score: row.reputation_score,
        last_verified: row.last_verified,
        trustline_count: parseInt(row.trustline_count),
        has_toml: row.has_toml,
        stellar_expert_verified: row.stellar_expert_verified,
        toml_data: row.toml_data,
        community_reports: row.community_reports,
    }));
}
async function saveFxRate(fxRate) {
    const query = `
    INSERT INTO fx_rates (
      transaction_id, rate, provider, timestamp, from_currency, to_currency
    ) VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (transaction_id) DO NOTHING
  `;
    await pool.query(query, [
        fxRate.transaction_id,
        fxRate.rate,
        fxRate.provider,
        fxRate.timestamp,
        fxRate.from_currency,
        fxRate.to_currency,
    ]);
}
async function getFxRate(transactionId) {
    const query = `
    SELECT * FROM fx_rates 
    WHERE transaction_id = $1
  `;
    const result = await pool.query(query, [transactionId]);
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
async function saveAnchorKycConfig(config) {
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
    await pool.query(query, [
        config.anchor_id,
        config.kyc_server_url,
        config.auth_token,
        config.polling_interval_minutes,
        config.enabled,
    ]);
}
async function getAnchorKycConfigs() {
    const query = `SELECT * FROM anchor_kyc_configs WHERE enabled = TRUE`;
    const result = await pool.query(query);
    return result.rows.map(row => ({
        anchor_id: row.anchor_id,
        kyc_server_url: row.kyc_server_url,
        auth_token: row.auth_token,
        polling_interval_minutes: row.polling_interval_minutes,
        enabled: row.enabled,
    }));
}
async function saveUserKycStatus(kycStatus) {
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
    await pool.query(query, [
        kycStatus.user_id,
        kycStatus.anchor_id,
        kycStatus.status,
        kycStatus.last_checked,
        kycStatus.expires_at || null,
        kycStatus.rejection_reason || null,
        kycStatus.verification_data ? JSON.stringify(kycStatus.verification_data) : null,
    ]);
}
async function getUserKycStatus(userId, anchorId) {
    const query = `
    SELECT * FROM user_kyc_status 
    WHERE user_id = $1 AND anchor_id = $2
  `;
    const result = await pool.query(query, [userId, anchorId]);
    if (result.rows.length === 0) {
        return null;
    }
    const row = result.rows[0];
    return {
        user_id: row.user_id,
        anchor_id: row.anchor_id,
        status: row.status,
        last_checked: row.last_checked,
        expires_at: row.expires_at,
        rejection_reason: row.rejection_reason,
        verification_data: row.verification_data,
    };
}
async function getUsersNeedingKycCheck(anchorId, minutesSinceLastCheck) {
    const query = `
    SELECT * FROM user_kyc_status 
    WHERE anchor_id = $1 
      AND last_checked < NOW() - INTERVAL '${minutesSinceLastCheck} minutes'
      AND status IN ('pending', 'approved')
    ORDER BY last_checked ASC
    LIMIT 100
  `;
    const result = await pool.query(query, [anchorId]);
    return result.rows.map(row => ({
        user_id: row.user_id,
        anchor_id: row.anchor_id,
        status: row.status,
        last_checked: row.last_checked,
        expires_at: row.expires_at,
        rejection_reason: row.rejection_reason,
        verification_data: row.verification_data,
    }));
}
async function getApprovedUsers() {
    const query = `
    SELECT * FROM user_kyc_status 
    WHERE status = 'approved' 
      AND (expires_at IS NULL OR expires_at > NOW())
    ORDER BY last_checked DESC
  `;
    const result = await pool.query(query);
    return result.rows.map(row => ({
        user_id: row.user_id,
        anchor_id: row.anchor_id,
        status: row.status,
        last_checked: row.last_checked,
        expires_at: row.expires_at,
        rejection_reason: row.rejection_reason,
        verification_data: row.verification_data,
    }));
}
/**
 * Save a SEP-24 transaction
 */
async function saveSep24Transaction(record) {
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
    await pool.query(query, [
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
async function getSep24Transaction(transactionId) {
    const query = `
    SELECT * FROM sep24_transactions 
    WHERE transaction_id = $1
  `;
    const result = await pool.query(query, [transactionId]);
    if (result.rows.length === 0) {
        return null;
    }
    return result.rows[0];
}
/**
 * Get a SEP-24 transaction by ID (numeric)
 */
async function getSep24TransactionById(transactionId) {
    return getSep24Transaction(transactionId);
}
/**
 * Get pending SEP-24 transactions for an anchor
 */
async function getPendingSep24Transactions(anchorId, minutesSinceLastPoll) {
    const query = `
    SELECT * FROM sep24_transactions 
    WHERE anchor_id = $1 
      AND status NOT IN ('completed', 'refunded', 'expired', 'error')
      AND (last_polled IS NULL OR last_polled < NOW() - INTERVAL '${minutesSinceLastPoll} minutes')
    ORDER BY created_at ASC
    LIMIT 50
  `;
    const result = await pool.query(query, [anchorId]);
    return result.rows;
}
/**
 * Update SEP-24 transaction status
 */
async function updateSep24TransactionStatus(transactionId, status, amountIn, amountOut, amountFee, stellarTransactionId, externalTransactionId, message) {
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
    await pool.query(query, [
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
async function getSep24TransactionsByUser(userId) {
    const query = `
    SELECT * FROM sep24_transactions 
    WHERE user_id = $1
    ORDER BY created_at DESC
    LIMIT 100
  `;
    const result = await pool.query(query, [userId]);
    return result.rows;
}
function getPool() {
    return pool;
}
